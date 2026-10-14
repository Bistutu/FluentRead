import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {mockConfig} = vi.hoisted(() => ({
    mockConfig: {
        service: 'claude',
        aiRequestTimeoutMs: undefined as number | undefined,
        to: 'zh-Hans',
        token: {claude: 'claude-secret'} as Record<string, string>,
        model: {claude: 'claude-haiku-4-5'} as Record<string, string>,
        customModel: {} as Record<string, string>,
        modelThinking: {claude: {'claude-haiku-4-5': true}} as Record<string, Record<string, boolean>>,
        customBody: {} as Record<string, string>,
        proxy: {} as Record<string, string>,
        system_role: {claude: 'You are a translator.'} as Record<string, string>,
        user_role: {claude: 'Translate to {{to}}: {{origin}}'} as Record<string, string>,
    },
}));

vi.mock('@/src/services/config/store', () => ({config: mockConfig}));

import claude from '@/src/providers/translation/claude';

const fetchMock = vi.fn<typeof fetch>();

function response(content: unknown): Response {
    return new Response(JSON.stringify({
        model: 'claude-haiku-4-5',
        content,
        usage: {input_tokens: 2, output_tokens: 3},
    }), {status: 200, headers: {'content-type': 'application/json'}});
}

beforeEach(() => {
    fetchMock.mockReset();
    mockConfig.aiRequestTimeoutMs = undefined;
    mockConfig.modelThinking = {claude: {'claude-haiku-4-5': true}};
    mockConfig.customBody = {};
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('Claude Thinking 响应', () => {
    it('忽略思考块并拼接所有最终文本块', async () => {
        fetchMock.mockResolvedValue(response([
            {type: 'thinking', thinking: 'private reasoning'},
            {type: 'text', text: '译文'},
            {text: '结束'},
        ]));

        await expect(claude({origin: 'hello'})).resolves.toBe('译文结束');
        const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(request.thinking).toEqual({type: 'enabled', budget_tokens: 1024});
    });

    it('没有最终文本块时返回明确错误', async () => {
        fetchMock.mockResolvedValue(response([{type: 'thinking', thinking: 'private reasoning'}]));

        await expect(claude({origin: 'hello'})).rejects.toThrow('Claude 返回数据格式异常：缺少文本内容');
    });
});


describe('claude AI 请求超时预算', () => {
    it('直接调用默认允许 60 秒响应，完成后清理超时计时器', async () => {
        vi.useFakeTimers();
        let resolve!: (value: Response) => void;
        let signal!: AbortSignal;
        fetchMock.mockImplementation((_input, init) => {
            signal = init!.signal!;
            return new Promise<Response>(done => {resolve = done;});
        });
        const result = claude({origin: 'Slow native AI source'});
        await vi.advanceTimersByTimeAsync(60_000);
        expect(signal.aborted).toBe(false);
        resolve(response([{type: 'text', text: '缓慢模型译文'}]));
        await expect(result).resolves.toBe('缓慢模型译文');
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        {configured: 10_000, explicit: undefined, deadline: 10_000},
        {configured: 600_000, explicit: 500, deadline: 500},
        {configured: 10_000, explicit: 180_000, deadline: 180_000},
    ])('配置与显式剩余预算在精确截止 abort：$deadline 毫秒', async ({configured, explicit, deadline}) => {
        vi.useFakeTimers();
        mockConfig.aiRequestTimeoutMs = configured;
        let signal!: AbortSignal;
        fetchMock.mockImplementation((_input, init) => {
            signal = init!.signal!;
            return new Promise((_, reject) => signal.addEventListener('abort',
                () => reject(new DOMException('aborted', 'AbortError')), {once: true}));
        });
        const outcome = claude({origin: 'Native AI deadline source', requestTimeoutMs: explicit}).catch(error => error);
        await vi.advanceTimersByTimeAsync(deadline - 1);
        expect(signal.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(outcome).resolves.toMatchObject({kind: 'timeout', retryable: true});
        expect(signal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('用户取消立即传播，与延长后的等待时间无关', async () => {
        vi.useFakeTimers();
        mockConfig.aiRequestTimeoutMs = 600_000;
        const controller = new AbortController();
        let signal!: AbortSignal;
        fetchMock.mockImplementation((_input, init) => {
            signal = init!.signal!;
            return new Promise((_, reject) => signal.addEventListener('abort',
                () => reject(new DOMException('aborted', 'AbortError')), {once: true}));
        });
        const outcome = claude({origin: 'Cancelled native AI source', abortSignal: controller.signal}).catch(error => error);
        controller.abort();
        await expect(outcome).resolves.toMatchObject({name: 'AbortError'});
        expect(signal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});

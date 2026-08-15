import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {mockConfig} = vi.hoisted(() => ({
    mockConfig: {
        from: 'auto',
        to: 'zh-Hans',
    },
}));

vi.mock('@/entrypoints/utils/config', () => ({config: mockConfig}));

import google, {
    parseGoogleBatchResponse,
    translateGoogleText,
} from '@/entrypoints/service/google';

const fetchMock = vi.fn<typeof fetch>();

function createBatchResponse(translations: string[]): string {
    const payload = [
        null,
        [[[
            null,
            null,
            null,
            null,
            null,
            translations.map(text => [text]),
        ]]],
    ];
    const records = [
        ['wrb.fr', 'MkEWBc', JSON.stringify(payload), null, null, null, 'generic'],
        ['di', 123],
    ];
    return `)]}'\n\n${JSON.stringify(records)}`;
}

function mockResponse(overrides: Partial<Response> = {}): Response {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(createBatchResponse(['此域名仅用于文档中的示例。'])),
        ...overrides,
    } as unknown as Response;
}

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('谷歌翻译适配器', () => {
    it('通过无需 API Key 的 batchexecute 端点发送请求并返回译文', async () => {
        fetchMock.mockResolvedValue(mockResponse());

        await expect(google({origin: 'This domain is for use in documents.'}))
            .resolves.toBe('此域名仅用于文档中的示例。');

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe('https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?rpcids=MkEWBc');
        expect(init).toMatchObject({
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
        });
        expect(init?.headers).not.toHaveProperty('X-Goog-API-Key');

        const requestBody = new URLSearchParams(String(init?.body)).get('f.req');
        expect(requestBody).not.toBeNull();
        const batchRequest = JSON.parse(requestBody!);
        expect(batchRequest[0][0][0]).toBe('MkEWBc');
        expect(batchRequest[0][0][2]).toBeNull();
        expect(batchRequest[0][0][3]).toBe('generic');
        expect(JSON.parse(batchRequest[0][0][1])).toEqual([
            ['This domain is for use in documents.', 'auto', 'zh-Hans', true],
            [null],
        ]);
    });

    it('按服务端片段原样拼接译文，不额外插入空格', () => {
        expect(parseGoogleBatchResponse(createBatchResponse(['第一句话。', '第二句话！'])))
            .toBe('第一句话。第二句话！');
    });

    it('保留换行和普通文本中的 HTML 字符', async () => {
        fetchMock.mockResolvedValue(mockResponse({
            text: vi.fn().mockResolvedValue(createBatchResponse(['如果 x < 3 && y > 1\n', '下一行'])),
        }));

        await expect(translateGoogleText('if x < 3 && y > 1\nNext line', 'en', 'zh-Hans'))
            .resolves.toBe('如果 x < 3 && y > 1\n下一行');
    });

    it('忽略防劫持前缀、长度行和无关记录', () => {
        const response = createBatchResponse(['测试成功']).replace('\n\n', '\n\n1234\nnot-json\n');
        expect(parseGoogleBatchResponse(response)).toBe('测试成功');
    });

    it('保留服务端错误状态和响应正文', async () => {
        fetchMock.mockResolvedValue(mockResponse({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            text: vi.fn().mockResolvedValue('rate limited'),
        }));

        await expect(translateGoogleText('hello', 'en', 'zh-Hans'))
            .rejects.toThrow('翻译失败: 429 Too Many Requests body: rate limited');
    });

    it('拒绝无法识别的响应结构', async () => {
        fetchMock.mockResolvedValue(mockResponse({
            text: vi.fn().mockResolvedValue(`)]}'\n\n[["unexpected", true]]`),
        }));

        await expect(translateGoogleText('hello', 'en', 'zh-Hans'))
            .rejects.toThrow('谷歌翻译返回格式异常');
    });

    it('把网络异常转换为可读错误', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(translateGoogleText('hello', 'en', 'zh-Hans'))
            .rejects.toThrow('谷歌翻译网络请求失败: Failed to fetch');
    });

    it('拒绝批量文本输入', async () => {
        await expect(google({origin: ['hello']} as unknown as {origin: string}))
            .rejects.toThrow('谷歌翻译仅支持单条文本');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

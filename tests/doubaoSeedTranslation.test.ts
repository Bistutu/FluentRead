import {withProviderSnapshot} from './helpers/providerSnapshot';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {config} = vi.hoisted(() => ({config: {} as Record<string, any>}));
vi.mock('@/src/services/config/store', () => ({config}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {id: 'test', getURL: (path: string) => path}}}));

import {Config} from '@/src/core/config/model';
import {models, services, servicesType} from '@/src/core/config/catalog';
import {supportsVisionTransport} from '@/src/core/config/vision';
import {supportsTranslationGlossary} from '@/src/services/translation/capabilities';
import {
    DOUBAO_SEED_TRANSLATION_LANGUAGES,
    DOUBAO_SEED_TRANSLATION_MODEL_ID,
    isDoubaoSeedTranslationModel,
    resolveDoubaoSeedTranslationLanguage,
} from '@/src/core/config/doubaoSeedTranslation';
import {buildOpenAIApiEndpoint, readResponsesApiText} from '@/src/providers/translation/responses-api';
import doubaoSeedTranslation, {
    buildDoubaoSeedTranslationRequestBody,
    resolveDoubaoSeedTranslationEndpoint,
} from '@/src/providers/translation/doubao-seed-translation';
import {translationProviderRegistry} from '@/src/providers/translation/registry';

const ARK_RESPONSES_URL = 'https://ark.cn-beijing.volces.com/api/v3/responses';
const fetchMock = vi.fn<typeof fetch>();
const json = (value: unknown, init?: ResponseInit) => new Response(JSON.stringify(value), init);
const respond = (value: unknown, init?: ResponseInit) => fetchMock.mockImplementation(async () => json(value, init));
const responsesBody = (text: string, usage?: unknown) => ({
    id: 'resp_1',
    model: DOUBAO_SEED_TRANSLATION_MODEL_ID,
    output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text}]}],
    ...(usage === undefined ? {} : {usage}),
});
const lastCall = () => {
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    return {
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body ?? '{}')),
        signal: init?.signal,
    };
};

beforeEach(() => {
    Object.assign(config, new Config(), {
        from: 'auto',
        to: 'zh-Hans',
        service: services.doubao,
        model: {[services.doubao]: DOUBAO_SEED_TRANSLATION_MODEL_ID},
        token: {[services.doubao]: 'ark-key'},
    });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('Doubao-Seed-Translation 模型识别与语言映射', () => {
    it('按系列前缀识别翻译专用模型，忽略大小写与两侧空白', () => {
        expect(isDoubaoSeedTranslationModel(DOUBAO_SEED_TRANSLATION_MODEL_ID)).toBe(true);
        expect(isDoubaoSeedTranslationModel('  Doubao-Seed-Translation-260101  ')).toBe(true);
        expect(isDoubaoSeedTranslationModel('doubao-seed-translation')).toBe(true);
        expect(isDoubaoSeedTranslationModel('doubao-seed-1-6-250615')).toBe(false);
        expect(isDoubaoSeedTranslationModel('')).toBe(false);
        expect(isDoubaoSeedTranslationModel()).toBe(false);
    });

    it('把 FluentRead 语言码映射为方舟翻译语言码，自动与未支持语言都返回 undefined', () => {
        expect(resolveDoubaoSeedTranslationLanguage('zh-Hans')).toBe('zh');
        expect(resolveDoubaoSeedTranslationLanguage('zh-TW')).toBe('zh-Hant');
        expect(resolveDoubaoSeedTranslationLanguage(' en ')).toBe('en');
        expect(resolveDoubaoSeedTranslationLanguage('auto')).toBeUndefined();
        expect(resolveDoubaoSeedTranslationLanguage('')).toBeUndefined();
        expect(resolveDoubaoSeedTranslationLanguage()).toBeUndefined();
        // 官方目录未收录的语言不能回退为默认值，只能由调用方明确拒绝。
        expect(resolveDoubaoSeedTranslationLanguage('he')).toBeUndefined();
        expect(Object.keys(DOUBAO_SEED_TRANSLATION_LANGUAGES)).toHaveLength(28);
    });

    it('模型进入豆包候选列表，并关闭提示词上下文、术语库与视觉能力', () => {
        expect(models.get(services.doubao)).toContain(DOUBAO_SEED_TRANSLATION_MODEL_ID);
        expect(servicesType.isUseAIContext(services.doubao, DOUBAO_SEED_TRANSLATION_MODEL_ID)).toBe(false);
        expect(servicesType.isUseAIContext(services.doubao, 'doubao-seed-1-6-250615')).toBe(true);
        expect(supportsTranslationGlossary(services.doubao, DOUBAO_SEED_TRANSLATION_MODEL_ID)).toBe(true);
        expect(supportsVisionTransport(services.doubao, DOUBAO_SEED_TRANSLATION_MODEL_ID)).toBe(false);
        expect(supportsVisionTransport(services.doubao, 'doubao-seed-1-6-250615')).toBe(true);
    });
});

describe('OpenAI Responses 协议共享工具', () => {
    it('在 chat/completions 与 responses 之间互换路径并保留查询和 hash', () => {
        expect(buildOpenAIApiEndpoint('https://ark.cn-beijing.volces.com/api/v3/chat/completions', 'responses')).toBe(ARK_RESPONSES_URL);
        expect(buildOpenAIApiEndpoint('https://ark.cn-beijing.volces.com/api/v3/responses/', 'responses')).toBe(ARK_RESPONSES_URL);
        expect(buildOpenAIApiEndpoint('https://ark.cn-beijing.volces.com/api/v3//', 'responses')).toBe(ARK_RESPONSES_URL);
        expect(buildOpenAIApiEndpoint(ARK_RESPONSES_URL, 'chat')).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
        expect(buildOpenAIApiEndpoint('https://proxy.example.com/v1/responses?key=1#frag', 'chat'))
            .toBe('https://proxy.example.com/v1/chat/completions?key=1#frag');
        // 非绝对地址的代理配置仍保持查询与 hash 不被拼进路径。
        expect(buildOpenAIApiEndpoint('/api/v3/chat/completions?key=1#frag', 'responses')).toBe('/api/v3/responses?key=1#frag');
        expect(buildOpenAIApiEndpoint('/api/v3', 'responses')).toBe('/api/v3/responses');
        expect(buildOpenAIApiEndpoint('', 'responses')).toBe('/responses');
    });

    it('优先读取 output_text，其次拼接 output 中的助手文本，缺失时返回空串', () => {
        expect(readResponsesApiText({output_text: '直接文本'})).toBe('直接文本');
        expect(readResponsesApiText(responsesBody('分段译文'))).toBe('分段译文');
        expect(readResponsesApiText({
            output_text: '',
            output: [
                {type: 'reasoning', content: [{type: 'output_text', text: '思考'}]},
                {type: 'message', content: [{type: 'reasoning_text', text: '忽略'}, {type: 'output_text', text: 'A'}, {type: 'output_text', text: 'B'}]},
            ],
        })).toBe('AB');
        expect(readResponsesApiText({output: [{type: 'message', content: 'not-array'}]})).toBe('');
        expect(readResponsesApiText({})).toBe('');
        expect(readResponsesApiText(null)).toBe('');
        expect(readResponsesApiText(undefined)).toBe('');
    });
});

describe('Doubao-Seed-Translation provider', () => {
    it('构造 Responses API 的 translation_options 载荷，自动源语言时省略 source_language', () => {
        expect(buildDoubaoSeedTranslationRequestBody('hello', 'zh', undefined, 'm')).toEqual({
            model: 'm',
            input: [{role: 'user', content: [{type: 'input_text', text: 'hello', translation_options: {target_language: 'zh'}}]}],
        });
        expect(buildDoubaoSeedTranslationRequestBody('hello', 'zh', 'en', 'm', '{"thinking":{"type":"disabled"}}'))
            .toMatchObject({thinking: {type: 'disabled'}});
        expect(buildDoubaoSeedTranslationRequestBody('hello', 'zh', 'en', 'm').input[0].content[0].translation_options)
            .toEqual({source_language: 'en', target_language: 'zh'});
    });

    it('把配置端点改写到 /responses，并在缺少端点时报错', () => {
        expect(resolveDoubaoSeedTranslationEndpoint({proxy: {}} as any, services.doubao)).toBe(ARK_RESPONSES_URL);
        expect(resolveDoubaoSeedTranslationEndpoint({proxy: {[services.doubao]: ' https://proxy.example.com/v1/chat/completions '}} as any, services.doubao))
            .toBe('https://proxy.example.com/v1/responses');
        expect(() => resolveDoubaoSeedTranslationEndpoint({proxy: {}} as any, 'unknown-service')).toThrow('未找到翻译服务接口');
    });

    it('发出带 Bearer 的 Responses 请求并返回译文', async () => {
        respond(responsesBody('你好', {input_tokens: 12, output_tokens: 3, total_tokens: 15}));
        const signal = new AbortController().signal;

        await expect(doubaoSeedTranslation(withProviderSnapshot({origin: 'hello', abortSignal: signal} as any, config))).resolves.toBe('你好');

        const call = lastCall();
        expect(call.url).toBe(ARK_RESPONSES_URL);
        expect(call.headers.get('Authorization')).toBe('Bearer ark-key');
        expect(call.headers.get('Content-Type')).toBe('application/json');
        expect(call.signal).toBe(signal);
        expect(call.body).toEqual({
            model: DOUBAO_SEED_TRANSLATION_MODEL_ID,
            input: [{role: 'user', content: [{type: 'input_text', text: 'hello', translation_options: {target_language: 'zh'}}]}],
        });
    });

    it('显式源语言随请求发出，源语言与目标语言相同时直接返回原文', async () => {
        Object.assign(config, {from: 'en', to: 'zh-Hant'});
        respond(responsesBody('你好'));
        await expect(doubaoSeedTranslation(withProviderSnapshot({origin: 'hello'} as any, config))).resolves.toBe('你好');
        expect(lastCall().body.input[0].content[0].translation_options)
            .toEqual({source_language: 'en', target_language: 'zh-Hant'});

        Object.assign(config, {from: 'zh-Hans', to: 'zh-CN'});
        await expect(doubaoSeedTranslation(withProviderSnapshot({origin: '你好'} as any, config))).resolves.toBe('你好');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('批量原文按顺序串行翻译并保持等长数组', async () => {
        fetchMock.mockImplementation(async (_url, init) => {
            const text = JSON.parse(String(init?.body)).input[0].content[0].text;
            return json(responsesBody(`译:${text}`));
        });

        await expect(doubaoSeedTranslation(withProviderSnapshot({origin: ['a', 'b']} as any, config))).resolves.toEqual(['译:a', '译:b']);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('拒绝不支持的目标语言与未配置的模型，不发出请求', async () => {
        Object.assign(config, {to: 'he'});
        await expect(doubaoSeedTranslation(withProviderSnapshot({origin: 'hello'} as any, config))).rejects.toThrow('不支持该目标语言');

        Object.assign(config, {to: 'zh-Hans', model: {[services.doubao]: ''}});
        await expect(doubaoSeedTranslation(withProviderSnapshot({origin: 'hello'} as any, config))).rejects.toThrow('模型尚未配置');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('HTTP 失败与缺少输出文本都抛出可读错误', async () => {
        respond({error: {message: 'bad model'}}, {status: 400});
        await expect(doubaoSeedTranslation(withProviderSnapshot({origin: 'hello'} as any, config))).rejects.toThrow('火山方舟翻译请求失败: 400');

        respond({id: 'resp_2', output: []});
        await expect(doubaoSeedTranslation(withProviderSnapshot({origin: 'hello'} as any, config))).rejects.toThrow('缺少 Responses API 输出文本');

        fetchMock.mockImplementation(async () => new Response('not json', {status: 200}));
        await expect(doubaoSeedTranslation(withProviderSnapshot({origin: 'hello'} as any, config))).rejects.toThrow('火山方舟返回的不是有效 JSON');
    });

    it('注册表按生效模型分流：翻译模型走 Responses，其余模型仍走 chat/completions', async () => {
        respond(responsesBody('你好'));
        await expect(translationProviderRegistry[services.doubao](withProviderSnapshot({origin: 'hello'}, config))).resolves.toBe('你好');
        expect(lastCall().url).toBe(ARK_RESPONSES_URL);

        Object.assign(config, {model: {[services.doubao]: 'doubao-seed-1-6-250615'}});
        respond({choices: [{message: {role: 'assistant', content: '你好'}, finish_reason: 'stop'}]});
        await expect(translationProviderRegistry[services.doubao](withProviderSnapshot({origin: 'hello'}, config))).resolves.toBe('你好');
        expect(lastCall().url).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
    });
});

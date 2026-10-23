import {withProviderSnapshot} from './helpers/providerSnapshot';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {currentModelIds, customModelString, services} from '@/src/core/config/catalog';
import {tongyiTokenPlanUrl} from '@/src/core/config/constants';

const {mockConfig} = vi.hoisted(() => ({
    mockConfig: {
        service: 'tongyi',
        to: 'zh-Hans',
        token: {tongyi: 'tongyi-secret'} as Record<string, string>,
        model: {tongyi: 'qwen3.6-flash'} as Record<string, string>,
        customModel: {} as Record<string, string>,
        customBody: {} as Record<string, string>,
        proxy: {} as Record<string, string>,
        system_role: {tongyi: 'You are a translator.'} as Record<string, string>,
        user_role: {tongyi: 'Translate to {{to}}: {{origin}}'} as Record<string, string>,
    },
}));

vi.mock('@/src/services/config/store', () => ({config: mockConfig}));

import tongyi from '@/src/providers/translation/tongyi';

const fetchMock = vi.fn<typeof fetch>();

function successResponse(): Response {
    return new Response(JSON.stringify({
        model: currentModelIds.tongyiTokenPlan,
        choices: [{message: {content: '译文'}}],
        usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
    }), {
        status: 200,
        headers: {'content-type': 'application/json'},
    });
}

describe('通义实际模型与 endpoint 路由', () => {
    beforeEach(() => {
        fetchMock.mockReset().mockResolvedValue(successResponse());
        vi.stubGlobal('fetch', fetchMock);
        mockConfig.model = {[services.tongyi]: 'qwen3.6-flash'};
        mockConfig.customModel = {};
        mockConfig.customBody = {};
        mockConfig.proxy = {};
    });

    afterEach(() => {
        mockConfig.customBody = {};
        vi.unstubAllGlobals();
    });

    it('自定义模型 sentinel 解析为 Token Plan 模型时使用 Token Plan endpoint', async () => {
        mockConfig.model[services.tongyi] = customModelString;
        mockConfig.customModel[services.tongyi] = currentModelIds.tongyiTokenPlan;

        await expect(tongyi(withProviderSnapshot({origin: 'hello'}, mockConfig))).resolves.toBe('译文');

        expect(fetchMock).toHaveBeenCalledWith(
            tongyiTokenPlanUrl,
            expect.objectContaining({method: 'POST'}),
        );
        const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
        expect(headers.get('Authorization')).toBe('Bearer tongyi-secret');
    });

    it('普通自定义模型继续使用标准 DashScope endpoint', async () => {
        mockConfig.model[services.tongyi] = customModelString;
        mockConfig.customModel[services.tongyi] = 'qwen-private-compatible';

        await expect(tongyi(withProviderSnapshot({origin: 'hello', serviceOverride: services.tongyi}, mockConfig))).resolves.toBe('译文');

        expect(fetchMock.mock.calls[0]![0]).toBe(
            'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        );
    });

    it('Qwen-MT 请求发送自定义术语时保留源语言和目标语言', async () => {
        mockConfig.customBody[services.tongyi] = JSON.stringify({translation_options: {terms: [{source: 'Token', target: 'Token'}]}});
        await expect(tongyi(withProviderSnapshot({origin: 'Token', serviceOverride: services.tongyi, modelOverride: 'qwen-mt-flash', sourceLanguage: 'auto', targetLanguage: 'en'}, mockConfig))).resolves.toBe('译文');

        const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(body.translation_options).toEqual({source_lang: 'auto', target_lang: 'en', terms: [{source: 'Token', target: 'Token'}]});
    });
});

it('Qwen-MT 的真实 provider 传递繁体源与简体目标，不受全局目标语言影响', async () => {
    fetchMock.mockReset().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);
    try {
        await tongyi(withProviderSnapshot({origin: '繁體中文', serviceOverride: services.tongyi, modelOverride: 'qwen-mt-plus', sourceLanguage: 'zh-Hant', targetLanguage: 'zh-Hans'}, mockConfig));
        const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(body.translation_options).toEqual({source_lang: 'zh_tw', target_lang: 'zh'});
    } finally {
        vi.unstubAllGlobals();
    }
});

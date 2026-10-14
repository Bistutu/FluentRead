import {describe, expect, it, vi} from 'vitest';
import {withProviderSnapshot} from './helpers/providerSnapshot';

vi.mock('webextension-polyfill', () => ({default: {storage: {
    session: {get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined)},
    onChanged: {addListener: vi.fn(), removeListener: vi.fn()},
}}}));

// 注册表测试只需核对适配器身份，避免在 Node 环境启动 WXT 存储监听。
vi.mock('@/src/services/config/store', () => ({config: {}}));
import {services} from '@/src/core/config/catalog';
import {translationProviderRegistry} from '@/src/providers/translation/registry';
import {
    AI_SDK_SERVICE_IDS,
} from '@/src/providers/translation/ai-sdk/endpoints';
import {translateWithOpenAICompatibleAiSdk} from '@/src/providers/translation/ai-sdk/openai-compatible';

describe('translation provider registry', () => {
    it('每个公开翻译服务都有唯一适配器，迁移不能遗漏 provider', () => {
        expect(Object.keys(translationProviderRegistry).sort()).toEqual(Object.values(services).sort());
    });

    it('AI SDK 服务共享统一 transport，Azure 与豆包保留专用前置分流', () => {
        // Azure 先校验 endpoint/key，豆包先按生效模型区分 chat/completions 与 Responses 协议。
        const preRouted = [services.azureOpenai, services.doubao];
        for (const service of AI_SDK_SERVICE_IDS) {
            if (preRouted.includes(service)) continue;
            expect(translationProviderRegistry[service]).toBe(translateWithOpenAICompatibleAiSdk);
        }
        for (const service of preRouted) {
            expect(translationProviderRegistry[service]).not.toBe(translateWithOpenAICompatibleAiSdk);
        }
    });
    it('单条适配器在网络之前拒绝数组，原生数组适配器要求可信配置快照', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        try {
            await expect(translationProviderRegistry[services.gemini]({origin: ['first', 'second']}))
                .rejects.toThrow('仅支持单条文本请求');
            await expect(translationProviderRegistry[services.microsoft]({origin: 'Hello'}))
                .rejects.toMatchObject({code: 'TRANSLATION_PROVIDER_CONFIG_REQUIRED'});
            expect(fetch).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('单条注册包装保留快照及取消signal，并向原协议交付文本', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({tgt_text: '你好'}));
        const controller = new AbortController();
        vi.stubGlobal('fetch', fetch);
        try {
            const request = withProviderSnapshot({origin: 'Hello', abortSignal: controller.signal}, {
                service: services.xiaoniu, from: 'en', to: 'zh-Hans', token: {[services.xiaoniu]: 'fixture-key'},
            });
            await expect(translationProviderRegistry[services.xiaoniu](request)).resolves.toBe('你好');
            expect(fetch).toHaveBeenCalledOnce();
            expect(fetch.mock.calls[0][1]?.signal).toBe(controller.signal);
            const body = new URLSearchParams(String(fetch.mock.calls[0][1]?.body));
            expect(body.get('src_text')).toBe('Hello');
            expect(body.get('from')).toBe('en');
            expect(body.get('to')).toBe('zh');
        } finally {
            vi.unstubAllGlobals();
        }
    });

});

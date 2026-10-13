import {afterEach, describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {resolveConfiguredModel, services, servicesType} from '@/src/core/config/catalog';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {createTranslationBroker} from '@/src/services/translation/broker';
import {resolveTranslationLanguages} from '@/src/core/translation/languages';
import {
    attachTranslationImageInput, attachTranslationRequestControl, getTranslationImageInput,
    getTranslationProviderConfig, getTranslationRequestScheduler, markTranslationRemainingBudget,
    reportTranslationModelUsage,
} from '@/src/services/translation/requestSnapshot';
import type {TranslationModelUsageRecord, TranslationProvider, TranslationProviderRegistry} from '@/src/services/translation/types';

const group = 'composite:test';
const sourceText = 'This paragraph explains how translation works.';
const translatedText = '这一段解释翻译如何工作。';

function setup(members: string[] = [services.google, services.microsoft]) {
    const config = Object.assign(new Config(), {
        service: group, useCache: true, enableAIContext: false, from: 'en', to: 'zh-Hans',
        compositeTranslationProviders: [{id: group, name: '组合测试', strategy: 'sequential' as const,
            services: members, timeoutMs: 1_000}],
    });
    config.token.openai = 'fixture-composite-openai';
    config.model.openai = 'gpt-4.1-mini';
    config.customModel.openai = '';
    const providers: TranslationProviderRegistry = {};
    for (const service of members) providers[service] = vi.fn<TranslationProvider>(async () => translatedText);
    const cacheStore = new Map<string, string>();
    const cacheKeys = vi.fn((identity: Record<string, unknown>) => JSON.stringify(identity));
    const recordRequest = vi.fn();
    const recordUsage = vi.fn(async (_events: readonly TranslationModelUsageRecord[], _generation: number) => undefined);
    const broker = createTranslationBroker({
        ready: Promise.resolve(), getConfig: () => config, providers,
        cache: {get: async key => cacheStore.get(key) ?? null, set: async (key, value) => {
            cacheStore.set(key, value); return true;
        }, clear: async () => {cacheStore.clear();}, cleanup: async () => undefined},
        serviceTypes: servicesType,
        endpointResolver: {resolveOpenAICompatibleEndpoint: service => ({endpoint: `https://${service}.example/v1/chat/completions`}),
            aiSdkTransportProfile: 'fixture-ai-sdk'},
        promptBuilder: {buildPageSummaryPrompt: context => `summarize:${context}`, buildPageSummarySystemPrompt: () => 'summary-system'},
        getMissingCredentialMessage,
        getTranslationLanguages: override => resolveTranslationLanguages(override, {sourceLanguage: config.from, targetLanguage: config.to}),
        resolveConfiguredModel, buildTranslationCacheKey: cacheKeys,
        recordTranslationRequest: recordRequest, recordModelUsage: recordUsage,
        logger: {warn: vi.fn()},
    });
    return {broker, config, providers, cacheKeys, cacheStore, recordRequest, recordUsage};
}

afterEach(() => vi.useRealTimers());

describe('组合翻译真实 broker 接入', () => {
    it('智能策略从真实上游失败学习，下一次优先使用成功成员', async () => {
        const h = setup();
        Object.assign(h.config.compositeTranslationProviders[0], {strategy: 'smart'});
        h.providers.google = vi.fn(async () => {throw new Error('unavailable');});
        await expect(h.broker.translateWithCache({origin: sourceText, useCache: false})).resolves.toBe(translatedText);
        await expect(h.broker.translateWithCache({origin: sourceText, useCache: false})).resolves.toBe(translatedText);
        expect(h.providers.google).toHaveBeenCalledOnce();
        expect(h.providers.microsoft).toHaveBeenCalledTimes(2);
    });

    it('顺序失败回退仍用成员的冻结凭据、模型与 Thinking 设置', async () => {
        const h = setup([services.google, services.openai]);
        h.config.modelThinking.openai = {'gpt-4.1-mini': true};
        h.providers.google = vi.fn(async () => {
            h.config.token.openai = 'changed-during-request';
            h.config.model.openai = 'changed-model';
            h.config.compositeTranslationProviders[0].services.reverse();
            throw new Error('first member failed');
        });
        h.providers.openai = vi.fn(async message => {
            const snapshot = getTranslationProviderConfig(message, h.config);
            expect(snapshot.token.openai).toBe('fixture-composite-openai');
            expect(snapshot.model.openai).toBe('gpt-4.1-mini');
            expect(message.modelOverride).toBeUndefined();
            expect(message.thinkingOverride).toBe(true);
            expect(getTranslationRequestScheduler(message)?.identity).toEqual({service: 'openai', model: 'gpt-4.1-mini'});
            return translatedText;
        });
        await expect(h.broker.translateWithCache({origin: sourceText, useCache: false,
            modelOverride: 'group-model', thinkingOverride: false})).resolves.toBe(translatedText);
        expect(h.providers.google).toHaveBeenCalledOnce();
        expect(h.providers.openai).toHaveBeenCalledOnce();
        expect(h.recordRequest).toHaveBeenCalledOnce();
        expect(h.recordRequest.mock.calls[0][0]).toMatchObject({serviceId: group, model: 'gpt-4.1-mini',
            upstreamCalls: 2, routes: ['google', 'openai'], outcome: 'success'});
    });

    it('显式数组按成员合批偏好原子返回，不继承组合的合批覆盖', async () => {
        const h = setup();
        h.config.nativeBatchTranslationEnabled.microsoft = false;
        h.providers.google = vi.fn(async () => {throw new Error('network unavailable');});
        h.providers.microsoft = vi.fn(async message => {
            expect(message.enableNativeBatch).toBe(false);
            expect(typeof message.origin).toBe('string');
            return `译文：${message.origin}`;
        });
        const origins = [sourceText, 'The second paragraph describes caching.'];
        await expect(h.broker.translateWithCache({origin: origins, enableNativeBatch: true, useCache: false}))
            .resolves.toEqual(origins.map(origin => `译文：${origin}`));
        expect(h.providers.microsoft).toHaveBeenCalledTimes(2);
        expect(h.recordRequest.mock.calls[0][0]).toMatchObject({serviceId: group, mode: 'batch', segmentCount: 2, upstreamCalls: 3});
    });

    it('只有单条协议的成员也能完成组合数组，失败批次不发布部分缓存', async () => {
        const h = setup([services.claude, services.google]);
        h.config.token.claude = 'fixture-claude';
        h.providers.claude = vi.fn(async message => {
            expect(typeof message.origin).toBe('string');
            if (message.origin === 'The second paragraph describes caching.') throw new Error('second item failed');
            return translatedText;
        });
        h.providers.google = vi.fn(async message => (message.origin as string[]).map(() => translatedText));
        const origins = [sourceText, 'The second paragraph describes caching.'];
        await expect(h.broker.translateWithCache({origin: origins})).resolves.toEqual([translatedText, translatedText]);
        expect(h.providers.claude).toHaveBeenCalledTimes(2);
        expect(h.providers.google).toHaveBeenCalledOnce();
        expect([...h.cacheStore.keys()].some(key => JSON.parse(key).service === 'claude')).toBe(false);
        h.providers.claude = vi.fn(async message => {
            expect(typeof message.origin).toBe('string');
            return translatedText;
        });
        await expect(h.broker.translateWithCache({origin: origins})).resolves.toEqual([translatedText, translatedText]);
        expect(h.providers.claude).toHaveBeenCalledTimes(2);
    });

    it('缓存身份属于真实成员，同服务的直接请求复用组合成功译文', async () => {
        const h = setup([services.google]);
        await expect(h.broker.translateWithCache({origin: sourceText})).resolves.toBe(translatedText);
        await expect(h.broker.translateWithCache({origin: sourceText})).resolves.toBe(translatedText);
        await expect(h.broker.translateWithCache({origin: sourceText, serviceOverride: services.google})).resolves.toBe(translatedText);
        expect(h.providers.google).toHaveBeenCalledOnce();
        expect(h.cacheKeys.mock.calls.every(([identity]) => identity.service === 'google')).toBe(true);
        expect(h.recordRequest.mock.calls[1][0]).toMatchObject({serviceId: group, source: 'cache', cachedSegments: 1, upstreamCalls: 0});
    });

    it('未配置密钥的成员在 provider 前跳过，继续调用可用机器服务', async () => {
        const h = setup([services.openai, services.google]);
        h.config.token.openai = '';
        h.config.apiKeys.openai = [];
        await expect(h.broker.translateWithCache({origin: sourceText, useCache: false})).resolves.toBe(translatedText);
        expect(h.providers.openai).not.toHaveBeenCalled();
        expect(h.providers.google).toHaveBeenCalledOnce();
    });

    it('取消保留内部控制所有权，中止成员且不启动回退', async () => {
        const h = setup();
        const controller = new AbortController();
        let signal!: AbortSignal;
        h.providers.google = vi.fn(async message => {
            signal = message.abortSignal as AbortSignal;
            return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
                const error = new Error('cancelled'); error.name = 'AbortError'; reject(error);
            }, {once: true}));
        });
        const request = h.broker.translateWithCache(attachTranslationRequestControl({origin: sourceText, useCache: false},
            {signal: controller.signal, ownershipKey: 'composite-owner'}));
        const settled = request.catch(error => error);
        await vi.waitFor(() => expect(h.providers.google).toHaveBeenCalledOnce());
        controller.abort();
        await expect(settled).resolves.toMatchObject({name: 'AbortError'});
        expect(signal.aborted).toBe(true);
        expect(h.providers.microsoft).not.toHaveBeenCalled();
        expect(h.recordRequest.mock.calls[0][0]).toMatchObject({outcome: 'cancelled'});
    });

    it('单成员超时后可回退，每个新成员继承整组剩余预算', async () => {
        vi.useFakeTimers();
        const h = setup();
        let firstSignal!: AbortSignal;
        h.providers.google = vi.fn(async message => {
            firstSignal = message.abortSignal as AbortSignal;
            return new Promise((_resolve, reject) => firstSignal.addEventListener('abort', () => reject(new Error('transport aborted')), {once: true}));
        });
        const request = h.broker.translateWithCache({origin: sourceText, useCache: false, requestTimeoutMs: 2_500});
        await vi.advanceTimersByTimeAsync(1_001);
        await expect(request).resolves.toBe(translatedText);
        expect(firstSignal.aborted).toBe(true);
        expect(h.providers.microsoft).toHaveBeenCalledOnce();
        expect(h.recordRequest.mock.calls[0][0]).toMatchObject({serviceId: group, upstreamCalls: 2});
    });

    it('受信外层剩余预算耗尽后不会给下一成员重新取得时间', async () => {
        vi.useFakeTimers();
        const h = setup();
        h.providers.google = vi.fn(async message => new Promise((_resolve, reject) =>
            (message.abortSignal as AbortSignal).addEventListener('abort', () => reject(new Error('transport aborted')), {once: true})));
        const request = h.broker.translateWithCache(markTranslationRemainingBudget({origin: sourceText, useCache: false, requestTimeoutMs: 40}));
        const settled = request.catch(error => error);
        await vi.advanceTimersByTimeAsync(41);
        await expect(settled).resolves.toMatchObject({name: 'TranslationProviderDeadlineError'});
        expect(h.providers.microsoft).not.toHaveBeenCalled();
    });

    it('回退到 AI 后才生成页面摘要，摘要与翻译用量归属真实成员', async () => {
        const h = setup([services.google, services.openai]);
        h.config.enableAIContext = true;
        h.providers.google = vi.fn(async () => {throw new Error('machine unavailable');});
        h.providers.openai = vi.fn(async message => {
            reportTranslationModelUsage(message, {usageAvailability: 'reported', totalTokens: 3});
            return message.summaryPrompt ? 'This page explains translation.' : translatedText;
        });
        await expect(h.broker.translateWithCache({origin: sourceText, pageContext: 'A page about translation services.', useCache: false}))
            .resolves.toBe(translatedText);
        expect(h.providers.openai).toHaveBeenCalledTimes(2);
        expect(h.recordUsage.mock.calls.flatMap(call => call[0]).map(event => [event.serviceId, event.purpose]))
            .toEqual([['openai', 'page-summary'], ['openai', 'translation']]);
        expect(h.recordRequest.mock.calls[0][0]).toMatchObject({serviceId: group, upstreamCalls: 3});
    });

    it('图片仅交给具备视觉传输的真实成员，内部图片 symbol 被保留', async () => {
        const h = setup([services.google, services.openai]);
        const image = 'data:image/png;base64,AAAA';
        h.providers.openai = vi.fn(async message => {
            expect(getTranslationImageInput(message)).toBe(image);
            return translatedText;
        });
        await expect(h.broker.translateWithCache(attachTranslationImageInput({origin: 'Transcribe the image.', useCache: false}, image)))
            .resolves.toBe(translatedText);
        expect(h.providers.google).not.toHaveBeenCalled();
        expect(h.providers.openai).toHaveBeenCalledOnce();
        expect(h.cacheStore.size).toBe(0);
    });

    it('成员多 Key 轮换继续使用成员自己的 scheduler 和模型身份', async () => {
        const h = setup([services.openai]);
        h.config.apiKeys.openai = ['fixture-composite-key-one', 'fixture-composite-key-two'];
        h.config.token.openai = h.config.apiKeys.openai[0];
        const used: string[] = [];
        h.providers.openai = vi.fn(async message => {
            used.push(getTranslationProviderConfig(message, h.config).token.openai);
            expect(getTranslationRequestScheduler(message)?.identity).toEqual({service: 'openai', model: 'gpt-4.1-mini'});
            if (used.length === 1) throw Object.assign(new Error('unauthorized'), {statusCode: 401});
            return translatedText;
        });
        await expect(h.broker.translateWithCache({origin: sourceText, useCache: false})).resolves.toBe(translatedText);
        expect(used).toEqual(h.config.apiKeys.openai);
    });

    it('成员两次回显原文仍失败时，回退到下一成员并拒绝缓存损坏译文', async () => {
        const h = setup();
        h.providers.google = vi.fn(async () => sourceText);
        await expect(h.broker.translateWithCache({origin: sourceText})).resolves.toBe(translatedText);
        expect(h.providers.google).toHaveBeenCalledTimes(2);
        expect(h.providers.microsoft).toHaveBeenCalledOnce();
        expect([...h.cacheStore.values()]).toEqual([translatedText]);
    });

    it('删除或空组合报明确配置错误，不调用任何成员', async () => {
        const h = setup();
        h.config.compositeTranslationProviders[0].services = [];
        await expect(h.broker.translateWithCache({origin: sourceText})).rejects.toThrow('添加至少一个服务');
        h.config.compositeTranslationProviders = [];
        await expect(h.broker.translateWithCache({origin: sourceText})).rejects.toThrow('已被删除');
        expect(h.providers.google).not.toHaveBeenCalled();
    });
});

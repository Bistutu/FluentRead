import {withProviderSnapshot} from './helpers/providerSnapshot';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createHash, createHmac} from 'node:crypto';

const {config} = vi.hoisted(() => ({config: {} as Record<string, any>}));
vi.mock('@/src/services/config/store', () => ({config}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {id: 'cloudprovidersAudit', getURL: (path: string) => path}}}));

import {Config} from '@/src/core/config/model';
import {services, servicesType, customModelString, resolveConfiguredModel} from '@/src/core/config/catalog';
import {resolveTranslationLanguages} from '@/src/core/translation/languages';
import {createTranslationBroker, type TranslationBrokerDependencies} from '@/src/services/translation/broker';
import {createTranslationRequestScheduler} from '@/src/services/translation/requestScheduler';
import {runWithApiKeyRotation} from '@/src/services/translation/apiKeyRotation';
import {createApiKeyCheckRevision, matchesApiKeyCheckRevision} from '@/src/core/config/apiKeyCheckIdentity';
import {runTranslationServiceConnectionTest} from '@/src/providers/translation/connectionTest';
import {buildTranslationCacheKey} from '@/src/services/translation/cache';
import {commonMsgTemplate} from '@/src/services/translation/templates';
import {attachTranslationProviderConfig, attachTranslationRequestControl, createTranslationProviderConfigSnapshot, attachTranslationModelUsageObserver} from '@/src/services/translation/requestSnapshot';
import type {TranslationProviderRegistry} from '@/src/services/translation/types';
import {TRANSLATION_CANCEL_MESSAGE_TYPE} from '@/src/services/translation/types';
import {createBackgroundMessageRouter} from '@/src/services/messaging/backgroundRouter';
import {createTranslationCancelHandler, createTranslationRequestRegistry} from '@/src/app/background/handlers/translation';
import {setRuntimeFetch, type RuntimeFetch} from '@/src/platform/http/runtime';
import baidu from '@/src/providers/translation/baidu-translation';
import google from '@/src/providers/translation/google-cloud-translation';
import azure from '@/src/providers/translation/azure-translator';
import aliyun, {buildAliyunSignedForm} from '@/src/providers/translation/aliyun-translation';
import volc, {buildVolcAuthorization} from '@/src/providers/translation/volc-translation';
import youdao from '@/src/providers/translation/youdao';
import tencent from '@/src/providers/translation/tencent';
import hunyuan from '@/src/providers/translation/hunyuan-translation';
import xiaoniu from '@/src/providers/translation/xiaoniu';
import {CLOUD_LANGUAGE_MAPS, resolveCloudLanguages} from '@/src/providers/translation/cloud/languages';
import {md5Hex, percentEncode, canonicalQueryString, sha256Hex, hmacSha1, hmacSha256, toHex, toBase64} from '@/src/providers/translation/cloud/signature';

const adapters = {baiduTranslation: baidu, googleCloudTranslation: google, azureTranslator: azure,
    aliyunTranslation: aliyun, volcTranslation: volc, youdao, tencent, huanYuanTranslation: hunyuan, xiaoniu};
type Service = keyof typeof adapters;
const fixed = ['baiduTranslation', 'googleCloudTranslation', 'azureTranslator', 'aliyunTranslation', 'volcTranslation', 'youdao'] as const;
const proxyConsumers = ['tencent', 'huanYuanTranslation', 'xiaoniu'] as const;
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);
function success(service: Service, text = '确定的译文') {
    return json({baiduTranslation: {trans_result: [{dst: text}]}, googleCloudTranslation: {data: {translations: [{translatedText: text}]}},
        azureTranslator: [{translations: [{text}]}], aliyunTranslation: {Code: 200, Data: {Translated: text}},
        volcTranslation: {TranslationList: [{Translation: text}]}, youdao: {errorCode: '0', translation: [text]},
        tencent: {Response: {TargetText: text}}, huanYuanTranslation: {Response: {Choices: [{Message: {Content: text}}]}},
        xiaoniu: {tgt_text: text}}[service]);
}
const transport = vi.fn<RuntimeFetch>();
function install(service: Service) {
    Object.assign(config, new Config(), {service, from: 'en', to: 'zh-Hans', useCache: true, enableAIContext: false,
        maxConcurrentTranslations: 2, translationRequestsPerSecond: 0, translationRequestsPerMinute: 0,
        token: Object.fromEntries(Object.keys(adapters).map(id => [id, 'synthetic-key'])),
        secret: Object.fromEntries(Object.keys(adapters).map(id => [id, 'synthetic-secret'])), apiKeys: {},
        tencentSecretId: 'synthetic-secret-id', tencentSecretKey: 'synthetic-secret-key',
        youdaoAppKey: 'synthetic-app-key', youdaoAppSecret: 'synthetic-app-secret',
        model: {[services.huanYuanTranslation]: 'hunyuan-translation'}, customModel: {}, proxy: {}, serviceRegion: {},
    });
    transport.mockImplementation(async () => success(service));
}
function broker(overrides: Partial<TranslationBrokerDependencies> = {}) {
    const cache = new Map<string, string>();
    const identities: Record<string, unknown>[] = [];
    const stats: any[] = [];
    const value = createTranslationBroker({ready: Promise.resolve(), getConfig: () => config as any,
        providers: adapters as unknown as TranslationProviderRegistry,
        cache: {get: async key => cache.get(key) ?? null, set: async (key, text) => {cache.set(key, text); return true;},
            clear: async () => {cache.clear();}, cleanup: async () => undefined},
        serviceTypes: servicesType,
        endpointResolver: {resolveOpenAICompatibleEndpoint: () => ({endpoint: 'unused'}), aiSdkTransportProfile: 'audit'},
        promptBuilder: {buildPageSummaryPrompt: text => text, buildPageSummarySystemPrompt: () => 'summary'},
        getMissingCredentialMessage: () => null,
        getTranslationLanguages: overrides => resolveTranslationLanguages(overrides, {sourceLanguage: config.from, targetLanguage: config.to}),
        resolveConfiguredModel, buildTranslationCacheKey: identity => {identities.push(identity); return buildTranslationCacheKey(identity);},
        recordTranslationRequest: event => {stats.push(event);}, now: () => 1000,
        ...overrides,
    });
    return {...value, cache, identities, stats};
}
const request = {origin: 'A complete source sentence.', requestTimeoutMs: 5000};
async function drain() {for (let index = 0; index < 20; index += 1) await Promise.resolve();}
async function untilCalls(count: number) {await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(count), {timeout: 1500, interval: 5});}

beforeEach(() => {vi.restoreAllMocks(); transport.mockReset(); install('googleCloudTranslation'); setRuntimeFetch(transport);});
afterEach(() => {setRuntimeFetch(); vi.restoreAllMocks(); vi.useRealTimers();});

describe('cloudprovidersAudit actual broker and adapter boundaries', () => {
    it.each(['baiduTranslation', 'googleCloudTranslation', 'azureTranslator', 'volcTranslation', 'youdao',
        'tencent', 'huanYuanTranslation', 'xiaoniu'] as const)('%s releases an unread HTTP failure without waiting for its endless body', async service => {
        install(service);
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        transport.mockResolvedValueOnce(new Response(new ReadableStream({cancel}), {status: 429, headers: {'Retry-After': '2'}}));
        await expect(adapters[service](withProviderSnapshot(request, config))).rejects.toMatchObject({statusCode: 429, retryAfterMs: 2000});
        expect(cancel).toHaveBeenCalledOnce();
        expect(transport).toHaveBeenCalledOnce();
    });

    it.each(fixed)('%s ignores an unused proxy for successful cache identity', async service => {
        install(service); const b = broker();
        config.proxy[service] = 'https://first.invalid/unused';
        expect(await b.translateWithCache(request)).toBe('确定的译文');
        const firstUrl = String(transport.mock.calls[0][0]);
        config.proxy[service] = 'https://second.invalid/unused';
        expect(await b.translateWithCache(request)).toBe('确定的译文');
        expect(transport).toHaveBeenCalledTimes(1);
        expect(b.identities[0].endpoint).toBe(b.identities[1].endpoint);
        expect(firstUrl).not.toContain('invalid');
        expect(b.stats.map(x => x.source)).toEqual(['network', 'cache']);
    });

    it.each(fixed)('%s shares pending work after an unused proxy edit', async service => {
        install(service); const b = broker(); let release!: () => void;
        const gate = new Promise<void>(resolve => {release = resolve;});
        transport.mockImplementation(async () => {await gate; return success(service);});
        const first = b.translateWithCache({...request, useCache: false}); await untilCalls(1);
        config.proxy[service] = 'https://second.invalid/unused';
        const second = b.translateWithCache({...request, useCache: false}); await drain();
        release();
        expect(await Promise.all([first, second])).toEqual(['确定的译文', '确定的译文']);
        expect(transport).toHaveBeenCalledTimes(1);
        expect(b.stats.some(x => x.source === 'shared')).toBe(true);
    });

    it.each(proxyConsumers)('%s isolates the proxy that its actual adapter consumes', async service => {
        install(service); const b = broker();
        config.proxy[service] = 'https://first.invalid/translation';
        await b.translateWithCache(request);
        config.proxy[service] = 'https://second.invalid/translation';
        await b.translateWithCache(request);
        expect(transport.mock.calls.map(x => String(x[0]))).toEqual(['https://first.invalid/translation', 'https://second.invalid/translation']);
        expect(b.identities[0].endpoint).not.toBe(b.identities[1].endpoint);
    });

    it('Aliyun normalizes default region aliases while isolating a consumed region endpoint', async () => {
        install('aliyunTranslation'); const b = broker();
        await b.translateWithCache(request);
        config.serviceRegion.aliyunTranslation = 'invalid-region'; await b.translateWithCache(request);
        config.serviceRegion.aliyunTranslation = ' ap-southeast-1 '; await b.translateWithCache(request);
        expect(transport.mock.calls.map(x => String(x[0]))).toEqual(['https://mt.cn-hangzhou.aliyuncs.com/', 'https://mt.ap-southeast-1.aliyuncs.com/']);
        expect(b.identities[0].endpoint).toBe(b.identities[1].endpoint);
    });

    it.each(Object.keys(adapters) as Service[])('%s freezes credentials and isolates pending work after credential changes', async service => {
        install(service); const b = broker(); let release!: () => void;
        const gate = new Promise<void>(resolve => {release = resolve;});
        transport.mockImplementation(async () => {await gate; return success(service);});
        const first = b.translateWithCache({...request, useCache: false}); await untilCalls(1);
        config.token[service] = 'synthetic-new-key'; config.secret[service] = 'synthetic-new-secret';
        config.tencentSecretKey = 'synthetic-new-tencent-secret'; config.youdaoAppSecret = 'synthetic-new-app-secret';
        const second = b.translateWithCache({...request, useCache: false});
        // Both actual signing chains receive a fresh Response after the same controlled gate.
        await drain(); release();
        expect(await Promise.all([first, second])).toEqual(['确定的译文', '确定的译文']);
        expect(transport).toHaveBeenCalledTimes(2);
        const calls = transport.mock.calls.map(([, init]) => ({body: String(init?.body), headers: new Headers(init?.headers)}));
        if (service === 'googleCloudTranslation') {
            expect(calls.map(x => x.headers.get('x-goog-api-key'))).toEqual(['synthetic-key', 'synthetic-new-key']);
        } else if (service === 'azureTranslator') {
            expect(calls.map(x => x.headers.get('Ocp-Apim-Subscription-Key'))).toEqual(['synthetic-key', 'synthetic-new-key']);
        } else expect(calls[0]).not.toEqual(calls[1]);
    });

    it.each(['azureTranslator', 'volcTranslation'] as const)('%s isolates consumed region headers while a previous request is pending', async service => {
        install(service); const b = broker(); let release!: () => void;
        const gate = new Promise<void>(resolve => {release = resolve;});
        transport.mockImplementation(async () => {await gate; return success(service);});
        const first = b.translateWithCache({...request, useCache: false}); await untilCalls(1);
        config.serviceRegion[service] = service === 'azureTranslator' ? 'eastasia' : 'ap-southeast-1';
        const second = b.translateWithCache({...request, useCache: false});
        await drain(); release();
        expect(await Promise.all([first, second])).toEqual(['确定的译文', '确定的译文']);
        expect(transport).toHaveBeenCalledTimes(2);
        const headers = transport.mock.calls.map(([, init]) => new Headers(init?.headers));
        if (service === 'azureTranslator') expect(headers.map(x => x.get('Ocp-Apim-Subscription-Region'))).toEqual([null, 'eastasia']);
        else {expect(headers[0].get('Authorization')).toContain('/cn-north-1/'); expect(headers[1].get('Authorization')).toContain('/ap-southeast-1/');}
    });

    it('actual adapter cancellation releases pending work, and retry succeeds without caching failure', async () => {
        install('youdao'); const b = broker(); const controller = new AbortController();
        transport.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
            init!.signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), {once: true});
        }));
        const pending = b.translateWithCache(attachTranslationRequestControl({...request}, {signal: controller.signal, ownershipKey: 'audit'}));
        const rejection = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        await untilCalls(1); controller.abort(); await rejection; await drain();
        expect(b.cache.size).toBe(0);
        transport.mockImplementation(async () => success('youdao'));
        expect(await b.translateWithCache(request)).toBe('确定的译文');
        expect(b.stats[0].outcome).toBe('cancelled');
    });

    it('same-key waiter cancellation keeps the uncancelled owner and its adapter request alive', async () => {
        const b = broker(); let release!: (response: Response) => void;
        transport.mockImplementation(() => new Promise(resolve => {release = resolve;}));
        const owner = b.translateWithCache(attachTranslationRequestControl({...request, useCache: false}, {signal: new AbortController().signal, ownershipKey: 'shared-audit'})); await untilCalls(1);
        const controller = new AbortController();
        const waiter = b.translateWithCache(attachTranslationRequestControl({...request, useCache: false}, {signal: controller.signal, ownershipKey: 'shared-audit'}));
        const rejected = expect(waiter).rejects.toMatchObject({name: 'AbortError'});
        await drain(); controller.abort(); await rejected;
        expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(false);
        release(success('googleCloudTranslation')); expect(await owner).toBe('确定的译文');
        expect(transport).toHaveBeenCalledTimes(1);
    });
});

describe('cloudprovidersAudit resumed immutable policy and consumed identity', () => {
    it('routes the typed cancellation protocol through the real handler and broker to abort only its owning fetch', async () => {
        const registry = createTranslationRequestRegistry(); const router = createBackgroundMessageRouter([createTranslationCancelHandler(registry)]);
        const context = {sender: {id: 'audit-extension', tab: {id: 47}, frameId: 0, documentId: 'synthetic-document'}};
        const b = broker();
        transport.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
            init!.signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), {once: true});
        }));
        const pending = registry.run('cloudprovidersAudit-runtime-cancel', context, (signal, ownershipKey) =>
            b.translateWithCache(attachTranslationRequestControl({...request}, {signal, ownershipKey})));
        const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        try {
            await untilCalls(1);
            const message = {type: TRANSLATION_CANCEL_MESSAGE_TYPE, clientRequestId: 'cloudprovidersAudit-runtime-cancel'};
            expect(await router.dispatch(message, {sender: {...context.sender, documentId: 'another-document'}}))
                .toMatchObject({handled: true, response: {cancelled: false}});
            expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(false);
            expect(await router.dispatch(message, context)).toMatchObject({handled: true, response: {cancelled: true}});
            await rejected; expect(b.cache.size).toBe(0);
            transport.mockImplementation(async () => success('googleCloudTranslation'));
            expect(await b.translateWithCache(request)).toBe('确定的译文');
        } finally {registry.cancel('cloudprovidersAudit-runtime-cancel', context); await rejected;}
    });

    it('copies and freezes the typed rotation policy, including the absent-map default', () => {
        const policy = {googleCloudTranslation: true}; config.apiKeyRotationEnabled = policy;
        const snapshot = createTranslationProviderConfigSnapshot(config as any);
        policy.googleCloudTranslation = false;
        expect(snapshot.apiKeyRotationEnabled).toEqual({googleCloudTranslation: true});
        expect(snapshot.apiKeyRotationEnabled).not.toBe(policy);
        expect(Object.isFrozen(snapshot.apiKeyRotationEnabled)).toBe(true);
        config.apiKeyRotationEnabled = undefined;
        expect(createTranslationProviderConfigSnapshot(config as any).apiKeyRotationEnabled).toEqual({});
    });

    it.each([true, false])('keeps captured rotation=%s through cache wait, actual scheduler queue and actual key attempts', async enabled => {
        config.maxConcurrentTranslations = 1;
        config.apiKeys.googleCloudTranslation = [`synthetic-policy-${enabled}-a`, `synthetic-policy-${enabled}-b`];
        config.apiKeyRotationEnabled = {googleCloudTranslation: enabled};
        const keys = [...config.apiKeys.googleCloudTranslation];
        const scheduler = createTranslationRequestScheduler(() => config, {now: () => 1000});
        let releaseSlot!: () => void;
        const slotGate = new Promise<void>(resolve => {releaseSlot = resolve;});
        const occupied = scheduler.schedule(lease => {lease.holdUntil(slotGate); return slotGate;});
        let releaseCache!: () => void;
        const cacheGate = new Promise<void>(resolve => {releaseCache = resolve;});
        const cacheRead = vi.fn(async () => {await cacheGate; return null;});
        const b = broker({requestScheduler: scheduler, cache: {get: cacheRead,
            set: async () => true, clear: async () => undefined, cleanup: async () => undefined}});
        transport.mockImplementation(async (_url, init) => new Headers(init?.headers).get('x-goog-api-key') === keys[0]
            ? json({}, {status: 429, headers: {'Retry-After': '60'}}) : success('googleCloudTranslation'));
        const pending = b.translateWithCache(request).catch(error => error);
        try {
            await vi.waitFor(() => expect(cacheRead).toHaveBeenCalledTimes(1));
            config.apiKeyRotationEnabled.googleCloudTranslation = !enabled;
            releaseCache(); await drain();
            expect(transport).not.toHaveBeenCalled(); // real scheduler slot is still held
            releaseSlot(); await occupied;
            const result = await pending;
            if (enabled) expect(result).toBe('确定的译文');
            else expect(result).toMatchObject({statusCode: 429});
            expect(transport.mock.calls.map(([, init]) => new Headers(init?.headers).get('x-goog-api-key')))
                .toEqual(enabled ? keys : [keys[0]]);
        } finally {releaseCache(); releaseSlot(); await occupied; await pending;}
    });

    it.each(fixed)('%s keeps a connection-check revision after an unconsumed proxy edit and invokes its real adapter', async service => {
        install(service); const revision = createApiKeyCheckRevision(config, service);
        config.proxy[service] = 'https://unused-edited.invalid/translation';
        const snapshot = createTranslationProviderConfigSnapshot(config as any);
        const result = await runTranslationServiceConnectionTest(service, {configSnapshot: snapshot,
            keyIndex: 0, keyRevision: revision, now: () => 1000}).catch(error => error);
        expect(result).toEqual({durationMs: 0});
        expect(matchesApiKeyCheckRevision(snapshot, service, revision)).toBe(true);
        expect(transport).toHaveBeenCalledTimes(1);
        expect(String(transport.mock.calls[0][0])).not.toContain('invalid');
    });

    it.each(proxyConsumers)('%s rejects an old detection revision when its consumed proxy changes', async service => {
        install(service); const revision = createApiKeyCheckRevision(config, service);
        config.proxy[service] = 'https://consumed-edited.invalid/translation';
        await expect(runTranslationServiceConnectionTest(service, {configSnapshot: createTranslationProviderConfigSnapshot(config as any),
            keyIndex: 0, keyRevision: revision, now: () => 1000})).rejects.toThrow('服务配置已更改');
        expect(transport).not.toHaveBeenCalled();
    });

    it.each(['baiduTranslation', 'googleCloudTranslation', 'azureTranslator', 'aliyunTranslation', 'volcTranslation'] as const)(
        '%s retains key cooldown after an unused proxy edit rather than spending another rejected attempt', async service => {
            install(service); config.apiKeys[service] = [`synthetic-health-${service}-a`, `synthetic-health-${service}-b`];
            const invoke = () => runWithApiKeyRotation(createTranslationProviderConfigSnapshot(config as any), service,
                selected => adapters[service](withProviderSnapshot(attachTranslationProviderConfig({...request}, selected), config)), {now: () => 1000});
            transport.mockImplementation(async (_url, init) => {
                const headers = new Headers(init?.headers); const form = new URLSearchParams(String(init?.body));
                const key = service === 'googleCloudTranslation' ? headers.get('x-goog-api-key')
                    : service === 'azureTranslator' ? headers.get('Ocp-Apim-Subscription-Key')
                    : service === 'baiduTranslation' ? form.get('appid')
                    : service === 'aliyunTranslation' ? form.get('AccessKeyId')
                    : headers.get('Authorization')?.match(/Credential=([^/]+)/u)?.[1];
                return key === config.apiKeys[service][0]
                    ? json({}, {status: 429, headers: {'Retry-After': '60'}}) : success(service);
            });
            expect(await invoke()).toBe('确定的译文');
            config.proxy[service] = 'https://unused-health-edit.invalid/translation';
            expect(await invoke()).toBe('确定的译文');
            expect(transport).toHaveBeenCalledTimes(3);
            // Exact request credentials distinguish the healthy second key from a scope reset to the first.
            const calls = transport.mock.calls.map(([, init]) => ({body: String(init?.body), headers: new Headers(init?.headers)}));
            if (service === 'googleCloudTranslation') expect(calls[2].headers.get('x-goog-api-key')).toBe(config.apiKeys[service][1]);
            else if (service === 'azureTranslator') expect(calls[2].headers.get('Ocp-Apim-Subscription-Key')).toBe(config.apiKeys[service][1]);
            else if (service === 'baiduTranslation') expect(new URLSearchParams(calls[2].body).get('appid')).toBe(config.apiKeys[service][1]);
            else if (service === 'aliyunTranslation') expect(new URLSearchParams(calls[2].body).get('AccessKeyId')).toBe(config.apiKeys[service][1]);
            else expect(calls[2].headers.get('Authorization')).toContain(config.apiKeys[service][1]);
        });

    it('Xiaoniu starts independent key health at a genuinely different consumed proxy', async () => {
        install('xiaoniu'); config.apiKeys.xiaoniu = ['synthetic-health-proxy-a', 'synthetic-health-proxy-b'];
        config.proxy.xiaoniu = 'https://first-health.invalid/translation';
        const invoke = () => runWithApiKeyRotation(createTranslationProviderConfigSnapshot(config as any), 'xiaoniu',
            selected => xiaoniu(withProviderSnapshot(attachTranslationProviderConfig({...request}, selected), config)), {now: () => 1000});
        transport.mockImplementationOnce(async () => json({}, {status: 429})).mockImplementation(async () => success('xiaoniu'));
        await invoke(); config.proxy.xiaoniu = 'https://second-health.invalid/translation'; await invoke();
        expect(transport.mock.calls.map(([url]) => String(url))).toEqual([
            'https://first-health.invalid/translation', 'https://first-health.invalid/translation', 'https://second-health.invalid/translation']);
        expect(new URLSearchParams(String(transport.mock.calls[2][1]?.body)).get('apikey')).toBe(config.apiKeys.xiaoniu[0]);
    });

    it.each(['baiduTranslation', 'aliyunTranslation', 'volcTranslation', 'youdao', 'tencent', 'huanYuanTranslation'] as const)(
        '%s rejects a stale key-check revision after an actually consumed signing credential changes', async service => {
            install(service); const revision = createApiKeyCheckRevision(config, service);
            if (service === 'youdao') config.youdaoAppSecret = 'synthetic-replaced-app-secret';
            else if (service === 'tencent' || service === 'huanYuanTranslation') config.tencentSecretKey = 'synthetic-replaced-tencent-secret';
            else config.secret[service] = 'synthetic-replaced-signing-secret';
            await expect(runTranslationServiceConnectionTest(service, {configSnapshot: createTranslationProviderConfigSnapshot(config as any),
                keyIndex: 0, keyRevision: revision, now: () => 1000})).rejects.toThrow('服务配置已更改');
            expect(transport).not.toHaveBeenCalled();
        });

    it.each(['youdao', 'tencent', 'huanYuanTranslation'] as const)(
        '%s also rejects a stale check when the dedicated signing ID changes', async service => {
            install(service); const revision = createApiKeyCheckRevision(config, service);
            if (service === 'youdao') config.youdaoAppKey = 'synthetic-replaced-app-id';
            else config.tencentSecretId = 'synthetic-replaced-tencent-id';
            await expect(runTranslationServiceConnectionTest(service, {configSnapshot: createTranslationProviderConfigSnapshot(config as any),
                keyIndex: 0, keyRevision: revision, now: () => 1000})).rejects.toThrow('服务配置已更改');
            expect(transport).not.toHaveBeenCalled();
        });

    it.each(['azureTranslator', 'aliyunTranslation', 'volcTranslation'] as const)(
        '%s retains detection protection when its consumed region changes alongside an unused proxy', async service => {
            install(service); const revision = createApiKeyCheckRevision(config, service);
            config.proxy[service] = 'https://unused-region.invalid/translation';
            config.serviceRegion[service] = service === 'azureTranslator' ? 'eastasia' : 'ap-southeast-1';
            await expect(runTranslationServiceConnectionTest(service, {configSnapshot: createTranslationProviderConfigSnapshot(config as any),
                keyIndex: 0, keyRevision: revision, now: () => 1000})).rejects.toThrow('服务配置已更改');
            expect(transport).not.toHaveBeenCalled();
        });

    it.each(['key row', 'request header rule'] as const)('retains detection protection after a %s changes', async field => {
        const revision = createApiKeyCheckRevision(config, 'googleCloudTranslation');
        config.proxy.googleCloudTranslation = 'https://unused-check.invalid/translation';
        if (field === 'key row') config.apiKeys.googleCloudTranslation = ['synthetic-replaced-row'];
        else config.requestHeaderRules = [{domain: 'translation.googleapis.com', removeOrigin: true, removeReferer: true}];
        await expect(runTranslationServiceConnectionTest('googleCloudTranslation', {configSnapshot: createTranslationProviderConfigSnapshot(config as any),
            keyIndex: 0, keyRevision: revision, now: () => 1000})).rejects.toThrow('服务配置已更改');
        expect(transport).not.toHaveBeenCalled();
    });

    it.each(['baiduTranslation', 'aliyunTranslation', 'volcTranslation'] as const)(
        '%s retries a corrected signing credential instead of inheriting both old key cooldowns', async service => {
            install(service); config.apiKeys[service] = [`synthetic-secret-scope-${service}-a`, `synthetic-secret-scope-${service}-b`];
            const invoke = () => runWithApiKeyRotation(createTranslationProviderConfigSnapshot(config as any), service,
                selected => adapters[service](withProviderSnapshot(attachTranslationProviderConfig({...request}, selected), config)), {now: () => 1000});
            transport.mockImplementation(async () => json({}, {status: 401}));
            await expect(invoke()).rejects.toMatchObject({statusCode: 401});
            expect(transport).toHaveBeenCalledTimes(2);
            config.secret[service] = 'synthetic-corrected-signing-secret';
            transport.mockImplementation(async () => success(service));
            expect(await invoke()).toBe('确定的译文'); expect(transport).toHaveBeenCalledTimes(3);
        });
});

describe('cloudprovidersAudit protocol and error contracts', () => {
    it('Youdao retains HTTP retry metadata and never echoes provider response bodies', async () => {
        install('youdao'); transport.mockResolvedValue(json({secret: 'private remote detail'}, {status: 429, headers: {'Retry-After': '3'}}));
        await expect(youdao(withProviderSnapshot(request, config))).rejects.toMatchObject({statusCode: 429, retryAfterMs: 3000, message: '有道翻译请求失败: 429'});
    });

    it('Youdao uses one clock snapshot, floors epoch seconds, and signs original reserved/unicode text', async () => {
        install('youdao'); const clock = vi.spyOn(Date, 'now').mockReturnValue(1760000000999);
        const query = "符号 +&%😀/".repeat(8);
        await youdao(withProviderSnapshot({...request, origin: query, sourceLanguage: 'zh-TW', targetLanguage: 'en'}, config));
        const params = new URLSearchParams(String(transport.mock.calls[0][1]?.body));
        expect(params.get('curtime')).toBe('1760000000'); expect(params.get('salt')).toBe('1760000000999');
        expect(clock).toHaveBeenCalledTimes(1); expect(params.get('q')).toBe(query); expect(params.get('from')).toBe('zh-CHT');
        const input = query.slice(0, 10) + query.length + query.slice(-10);
        expect(params.get('sign')).toBe(createHash('sha256').update('synthetic-app-key' + input + '1760000000999' + '1760000000' + 'synthetic-app-secret').digest('hex'));
    });

    it.each(Object.keys(adapters) as Service[])('%s forwards its abort signal and rejects malformed JSON without input previews', async service => {
        install(service); const controller = new AbortController();
        transport.mockResolvedValue(new Response('private-source synthetic-key malformed'));
        const error = await adapters[service](withProviderSnapshot({...request, abortSignal: controller.signal}, config)).catch(x => x);
        expect(error).toBeInstanceOf(Error); expect(error.message).toMatch(/有效 JSON/u); expect(error.message).not.toMatch(/private-source|synthetic-key/);
        expect(transport.mock.calls[0][1]?.signal).toBe(controller.signal);
    });

    it.each(Object.keys(adapters) as Service[])('%s converts null JSON to a safe protocol error', async service => {
        install(service); transport.mockResolvedValue(json(null));
        const error = await adapters[service](withProviderSnapshot(request, config)).catch(x => x);
        expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(TypeError);
        expect(error.message).toMatch(/格式异常|翻译错误|API错误|未返回译文/u);
    });

    it.each([['baiduTranslation', {trans_result: [null]}], ['youdao', {errorCode: '0', translation: [123]}],
        ['tencent', {Response: {TargetText: {secret: 'not text'}}}],
        ['huanYuanTranslation', {Response: {Choices: [null]}}], ['huanYuanTranslation', {Response: {Choices: [{Message: {Content: {secret: 'not text'}}}]}}]] as const)(
        '%s rejects non-text or null nested output %j', async (service, body) => {
            install(service); transport.mockResolvedValue(json(body)); await expect(adapters[service](withProviderSnapshot(request, config))).rejects.toBeInstanceOf(Error);
        });

    it('Hunyuan sends the resolved custom model, reports usage, and rejects auto target before fetch', async () => {
        install('huanYuanTranslation'); config.model.huanYuanTranslation = customModelString;
        config.customModel.huanYuanTranslation = 'hunyuan-custom-model';
        const observations: any[] = [];
        await hunyuan(withProviderSnapshot(attachTranslationModelUsageObserver({...request}, x => observations.push(x)), config));
        expect(JSON.parse(String(transport.mock.calls[0][1]?.body)).Model).toBe('hunyuan-custom-model');
        expect(observations[0]).toMatchObject({actualModel: 'hunyuan-custom-model', outcome: 'success'});
        transport.mockClear(); await expect(hunyuan(withProviderSnapshot({...request, targetLanguage: 'auto'}, config))).rejects.toThrow('不支持该目标语言');
        expect(transport).not.toHaveBeenCalled();
    });

    it.each(Object.keys(CLOUD_LANGUAGE_MAPS) as Array<keyof typeof CLOUD_LANGUAGE_MAPS>)('%s passes inherited-looking language codes through as strings', vendor => {
        for (const code of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
            expect(resolveCloudLanguages(vendor, code, code)).toEqual({source: code, target: code});
        }
    });

    it.each(['youdao', 'tencent', 'huanYuanTranslation', 'xiaoniu'] as const)('%s preserves unknown codes instead of inherited object members', async service => {
        install(service);
        await adapters[service](withProviderSnapshot({...request, sourceLanguage: 'constructor', targetLanguage: 'toString'}, config));
        const raw = String(transport.mock.calls[0][1]?.body);
        if (service === 'tencent') expect(JSON.parse(raw)).toMatchObject({Source: 'constructor', Target: 'toString'});
        else if (service === 'huanYuanTranslation') expect(JSON.parse(raw).Target).toBe('toString');
        else expect(Object.fromEntries(new URLSearchParams(raw))).toMatchObject({from: 'constructor', to: 'toString'});
    });

    it('frozen provider symbols beat live fallback credentials and languages remain explicit', async () => {
        install('googleCloudTranslation'); const snapshot = createTranslationProviderConfigSnapshot(config as any);
        config.token.googleCloudTranslation = 'synthetic-live-change';
        await google(withProviderSnapshot(attachTranslationProviderConfig({...request, sourceLanguage: 'ja', targetLanguage: 'zh-TW'}, snapshot), config));
        const init = transport.mock.calls[0][1]!;
        expect(new Headers(init.headers).get('x-goog-api-key')).toBe('synthetic-key');
        expect(JSON.parse(String(init.body))).toMatchObject({source: 'ja', target: 'zh-TW'});
    });

    it('signature primitives preserve RFC3986 reserved characters and match independent Node crypto over padding boundaries', async () => {
        expect(percentEncode("~!'()* +/%😀")).toBe('~%21%27%28%29%2A%20%2B%2F%25%F0%9F%98%80');
        expect(canonicalQueryString({b: '%', a: '+', '空格': ''})).toBe('a=%2B&b=%25&%E7%A9%BA%E6%A0%BC=');
        for (const count of [0, 1, 55, 56, 63, 64, 65, 127, 128]) {
            const input = 'x'.repeat(count) + '😀'; expect(md5Hex(input)).toBe(createHash('md5').update(input).digest('hex'));
        }
        const key = new Uint8Array([0, 255, 127]).buffer;
        expect(toHex(await hmacSha256(key, '正文'))).toBe(createHmac('sha256', Buffer.from(key)).update('正文').digest('hex'));
        expect(toBase64(await hmacSha1(key, '正文'))).toBe(createHmac('sha1', Buffer.from(key)).update('正文').digest('base64'));
        expect(await sha256Hex('正文')).toBe(createHash('sha256').update('正文').digest('hex'));
        const ali = await buildAliyunSignedForm({accessKeyId: 'synthetic', accessKeySecret: 'synthetic', parameters: {SourceText: '+%😀'}, now: new Date('2026-01-01T00:00:00.999Z'), nonce: 'fixed'});
        expect(ali.Timestamp).toBe('2026-01-01T00:00:00Z');
        const vol = await buildVolcAuthorization({accessKeyId: 'synthetic', secretAccessKey: 'synthetic', region: 'cn-north-1', host: 'translate.volcengineapi.com', query: {}, body: '+%😀', now: new Date('2026-01-01T00:00:00.999Z')});
        expect(vol['X-Date']).toBe('20260101T000000Z');
        expect(vol['X-Content-Sha256']).toBe(createHash('sha256').update('+%😀').digest('hex'));
    });
});

describe('cloudprovidersAudit actual template parse hot path', () => {
    it('parses each custom JSON body once with identical output and explicit thinking precedence', () => {
        config.service = services.openai; config.model = {[services.openai]: 'gpt-5'};
        const raw = JSON.stringify({temperature: 0.25, reasoning_effort: 'minimal', metadata: {label: 'same'}});
        config.customBody = {[services.openai]: raw};
        const originalParse = JSON.parse;
        const parser = vi.spyOn(JSON, 'parse'); const iterations = 50;
        const output = Array.from({length: iterations}, () => commonMsgTemplate({origin: 'Source with $&', targetLanguage: 'zh-Hans', current: config as any}));
        const parseCalls = parser.mock.calls.filter(call => call[0] === raw).length;
        const expected = originalParse(output[0]);
        expect(expected).toMatchObject({temperature: 0.25, reasoning_effort: 'minimal', metadata: {label: 'same'}});
        expect(new Set(output).size).toBe(1);
        console.info('[cloudprovidersAudit-performance]', JSON.stringify({iterations, parseCalls, inputSha256: createHash('sha256').update(raw).digest('hex'), outputSha256: createHash('sha256').update(output[0]).digest('hex')}));
        expect(parseCalls).toBe(iterations);
    });
});

describe('cloudprovidersAudit failure, queue, and model contracts', () => {
    it.each(['youdao', 'tencent', 'huanYuanTranslation'] as const)('%s stops before transport when credentials are missing', async service => {
        install(service); config.youdaoAppKey = ''; config.tencentSecretId = '';
        await expect(adapters[service](withProviderSnapshot(request, config))).rejects.toThrow(/配置/u); expect(transport).not.toHaveBeenCalled();
    });

    it.each(['tencent', 'huanYuanTranslation'] as const)('%s rejects incomplete credential pairs and explicit auto targets', async service => {
        install(service); config.tencentSecretKey = 'short';
        await expect(adapters[service](withProviderSnapshot(request, config))).rejects.toThrow('格式不正确');
        config.tencentSecretKey = 'synthetic-secret-key';
        await expect(adapters[service](withProviderSnapshot({...request, targetLanguage: 'auto'}, config))).rejects.toThrow(/不支持/u);
        expect(transport).not.toHaveBeenCalled();
    });

    it.each(['tencent', 'huanYuanTranslation', 'xiaoniu'] as const)('%s preserves HTTP failures and Retry-After metadata', async service => {
        install(service); transport.mockResolvedValue(json({message: 'private provider detail'}, {status: 503, headers: {'Retry-After': '2'}}));
        await expect(adapters[service](withProviderSnapshot(request, config))).rejects.toMatchObject({statusCode: 503, retryAfterMs: 2000});
    });

    it.each(['tencent', 'huanYuanTranslation'] as const)('%s handles safe provider errors without reporting translation success', async service => {
        install(service); const observations: any[] = [];
        transport.mockResolvedValue(json({Response: {Error: {Code: 123, Message: 'private diagnostic'}, Model: ' reported-model ', Usage: {PromptTokens: 2, CompletionTokens: 3, TotalTokens: 5}}}));
        await expect(adapters[service](withProviderSnapshot(attachTranslationModelUsageObserver({...request}, x => observations.push(x)), config))).rejects.toThrow('错误码 123');
        if (service === 'huanYuanTranslation') expect(observations).toEqual([expect.objectContaining({outcome: 'error', actualModel: 'reported-model', totalTokens: 5})]);
    });

    it('Youdao directly preserves AbortError identity rather than turning cancellation into failure', async () => {
        install('youdao'); const original = new DOMException('Synthetic cancellation', 'AbortError'); transport.mockRejectedValue(original);
        await expect(youdao(withProviderSnapshot(request, config))).rejects.toBe(original);
    });

    it.each(['101', 'constructor', '__proto__', 'unexpected'])('Youdao error code %s uses own known messages and never provider reflection', async code => {
        install('youdao'); transport.mockResolvedValue(json({errorCode: code, message: 'private provider detail'}));
        const error = await youdao(withProviderSnapshot(request, config)).catch(x => x);
        expect(error.message).toBe(code === '101' ? '有道翻译API错误: 缺少必填的参数' : '有道翻译API错误: 未知错误');
    });

    it('Hunyuan uses default model fallback, explicit override, payload Model precedence, and reported usage model', async () => {
        install('huanYuanTranslation'); config.model = {}; const observations: any[] = [];
        await hunyuan(withProviderSnapshot(request, config)); expect(JSON.parse(String(transport.mock.calls[0][1]?.body)).Model).toBe('hunyuan-translation');
        config.customBody.huanYuanTranslation = '{"Model":"body-model"}';
        transport.mockResolvedValue(json({Response: {Model: 'reported-model', Usage: {PromptTokens: 2, CompletionTokens: 3, TotalTokens: 5}, Choices: [{Message: {Content: '译文'}}]}}));
        await hunyuan(withProviderSnapshot(attachTranslationModelUsageObserver({...request, modelOverride: 'override-model', serviceOverride: services.huanYuanTranslation}, x => observations.push(x)), config));
        expect(JSON.parse(String(transport.mock.calls[1][1]?.body)).Model).toBe('body-model');
        expect(observations[0]).toMatchObject({actualModel: 'reported-model', outcome: 'success', totalTokens: 5});
        transport.mockImplementation(async () => success('huanYuanTranslation'));
        await hunyuan(withProviderSnapshot(attachTranslationModelUsageObserver({...request}, x => observations.push(x)), config));
        expect(observations[1]).toMatchObject({actualModel: 'body-model', outcome: 'success'});
    });

    it('Hunyuan broker scheduling identity agrees with the uppercase Model field consumed by the adapter', async () => {
        install('huanYuanTranslation'); config.customBody.huanYuanTranslation = '{"Model":"body-model"}';
        const b = broker(); await b.translateWithCache(request);
        expect(b.stats[0].model).toBe('body-model');
        expect(JSON.parse(String(transport.mock.calls[0][1]?.body)).Model).toBe('body-model');
    });

    it('Google credential correction does not inherit an older pending authentication failure', async () => {
        const b = broker(); let release!: () => void;
        const gate = new Promise<void>(resolve => {release = resolve;});
        transport.mockImplementation(async (_url, init) => {
            await gate; return new Headers(init?.headers).get('x-goog-api-key') === 'synthetic-key'
                ? json({}, {status: 401}) : success('googleCloudTranslation');
        });
        const first = b.translateWithCache({...request, useCache: false}).catch(x => x); await untilCalls(1);
        config.token.googleCloudTranslation = 'synthetic-corrected-key';
        const next = b.translateWithCache({...request, useCache: false}).catch(x => x); await drain(); release();
        const [old, corrected] = await Promise.all([first, next]);
        expect(old).toMatchObject({statusCode: 401}); expect(corrected).toBe('确定的译文');
        expect(transport).toHaveBeenCalledTimes(2);
    });

    it('actual fetch cancellation frees the scheduler slot for a distinct queued request', async () => {
        config.maxConcurrentTranslations = 1; const b = broker(); const controller = new AbortController();
        transport.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
            init!.signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), {once: true});
        })).mockImplementation(async () => success('googleCloudTranslation'));
        const first = b.translateWithCache(attachTranslationRequestControl({...request, useCache: false}, {signal: controller.signal, ownershipKey: 'first'}));
        const rejected = expect(first).rejects.toMatchObject({name: 'AbortError'}); await untilCalls(1);
        const queued = b.translateWithCache({...request, origin: 'Another complete sentence.', useCache: false});
        await drain(); expect(transport).toHaveBeenCalledTimes(1);
        controller.abort(); await rejected; expect(await queued).toBe('确定的译文'); expect(transport).toHaveBeenCalledTimes(2);
    });

    it.each(['googleCloudTranslation', 'azureTranslator', 'xiaoniu'] as const)('%s ignores another unused secret edit when sharing a pending token-only request', async service => {
        install(service); const b = broker(); let release!: () => void;
        const gate = new Promise<void>(resolve => {release = resolve;});
        transport.mockImplementation(async () => {await gate; return success(service);});
        const first = b.translateWithCache({...request, useCache: false}); await untilCalls(1);
        config.secret[service] = 'synthetic-unused-secret';
        const second = b.translateWithCache({...request, useCache: false}); await drain(); release();
        expect(await Promise.all([first, second])).toEqual(['确定的译文', '确定的译文']); expect(transport).toHaveBeenCalledTimes(1);
    });
});

describe('cloudprovidersAudit independent TC3 golden contracts', () => {
    it.each(['tencent', 'huanYuanTranslation'] as const)('%s signs the exact UTF-8 body using UTC seconds even through a proxy', async service => {
        install(service); config.proxy[service] = 'https://relay.invalid/translation';
        vi.spyOn(Date, 'now').mockReturnValue(1760000000999);
        await adapters[service](withProviderSnapshot({...request, origin: '原文 +%😀'}, config));
        const init = transport.mock.calls[0][1]!; const headers = new Headers(init.headers);
        const expectedService = service === 'tencent' ? 'tmt' : 'hunyuan';
        const expectedHash = service === 'tencent' ? '87e051e1d23b7cb164a50b04751e64698321bfcdc88bd52d73f428793ce5a7e2' : 'f4593107c3044811115426b6917a6fa7ab2147ebd63eb1529d62693692514a83';
        // Golden values were calculated using independent Node crypto, see evidence/tc3-golden.cjs.
        const expectedSignature = service === 'tencent' ? '2b8879f3cba8afa4111ea951d1a860d2705bab30d0ef2dfd6780661451794521' : 'b35d3990cd5a1351d41889ff17802c3fcea2e8443a80a403e0199353a1625298';
        expect(String(transport.mock.calls[0][0])).toBe('https://relay.invalid/translation');
        expect(headers.get('Host')).toBe(expectedService + '.tencentcloudapi.com');
        expect(headers.get('X-TC-Timestamp')).toBe('1760000000');
        expect(createHash('sha256').update(String(init.body)).digest('hex')).toBe(expectedHash);
        expect(headers.get('Authorization')).toBe(`TC3-HMAC-SHA256 Credential=synthetic-secret-id/2025-10-09/${expectedService}/tc3_request, SignedHeaders=content-type;host, Signature=${expectedSignature}`);
    });
});

describe('cloudprovidersAudit advanced body and key rotation boundaries', () => {
    it('Hunyuan keeps diagnostic model fallback when an incomplete custom selector or invalid Model body is rejected', async () => {
        install('huanYuanTranslation'); config.model.huanYuanTranslation = customModelString;
        config.customModel.huanYuanTranslation = '';
        transport.mockImplementation(async () => json({Response: {Error: {Code: 400, Message: 'private diagnostic'}}}));
        await expect(hunyuan(withProviderSnapshot(request, config))).rejects.toThrow('错误码 400');
        expect(JSON.parse(String(transport.mock.calls[0][1]?.body)).Model).toBe(customModelString);
        config.model.huanYuanTranslation = 'hunyuan-translation'; config.customBody.huanYuanTranslation = '{"Model":null}';
        const observations: any[] = [];
        await expect(hunyuan(withProviderSnapshot(attachTranslationModelUsageObserver({...request}, x => observations.push(x)), config))).rejects.toThrow('错误码 400');
        expect(JSON.parse(String(transport.mock.calls[1][1]?.body)).Model).toBeNull();
        expect(observations[0]).toMatchObject({actualModel: 'hunyuan-translation', outcome: 'error'});
    });

    it('Google actual key rotation retries only the distinct second key after 429 and preserves the original pool snapshot', async () => {
        config.apiKeys.googleCloudTranslation = ['synthetic-multi-a', 'synthetic-multi-b'];
        const keys = [...config.apiKeys.googleCloudTranslation]; const b = broker();
        transport.mockImplementation(async (_url, init) => new Headers(init?.headers).get('x-goog-api-key') === keys[0]
            ? json({}, {status: 429, headers: {'Retry-After': '1'}}) : success('googleCloudTranslation'));
        expect(await b.translateWithCache(request)).toBe('确定的译文');
        expect(transport.mock.calls.map(([, init]) => new Headers(init?.headers).get('x-goog-api-key'))).toEqual(keys);
        expect(config.apiKeys.googleCloudTranslation).toEqual(keys);
        expect(b.stats[0]).toMatchObject({outcome: 'success', upstreamCalls: 2});
        expect(b.cache.size).toBe(1);
    });
});

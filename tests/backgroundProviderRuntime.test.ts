import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ConnectionTestUsageOptions} from '@/src/providers/translation/connectionTest';
import {createVisionProbeIdentity, type VisionProbeResult} from '@/src/core/config/visionProbe';
import type {VisionProbeConfig, VisionProbeOptions} from '@/src/services/translation/visionProbe';
import {createBackgroundMessageRouter} from '@/src/services/messaging/backgroundRouter';
import {CONNECTION_TEST_MESSAGE_TYPE} from '@/src/app/background/handlers/connectionTest';
import {VISION_PROBE_MESSAGE, VISION_PROBE_CANCEL_MESSAGE} from '@/src/services/translation/types';

const mocks = vi.hoisted(() => ({
    captureGeneration: vi.fn(() => 11),
    recordMany: vi.fn(async (_events: unknown, _generation: number) => 1),
    resolveConfiguredModel: vi.fn((_selected?: string, _custom?: string) => 'resolved-model'),
    runConnectionTest: vi.fn(async (_service: string, _options: ConnectionTestUsageOptions) => ({durationMs: 25})),
    formatError: vi.fn((service: string, error: unknown) => `${service}:${error instanceof Error ? error.message : String(error)}`),
    resolveVisionProbe: vi.fn(async (_config: VisionProbeConfig, _service: string, _model: string, _options: VisionProbeOptions): Promise<VisionProbeResult> =>
        ({capability: 'supported', source: 'probe', checkedAt: 123})),
    ready: Promise.resolve() as Promise<void>,
    config: {model: {moonshot: 'kimi-k2.6'}, customModel: {moonshot: ''}, token: {moonshot: 'fixture-key'}},
    getFreeTranslationWeightSnapshot: vi.fn(async (_snapshot: unknown) => ({total: 100, observedAt: 1, entries: []})),
}));

vi.mock('@/src/providers/translation/connectionTest', () => ({
    formatConnectionTestError: mocks.formatError,
    runTranslationServiceConnectionTest: mocks.runConnectionTest,
}));
vi.mock('@/src/providers/translation/free-translation', () => ({
    getFreeTranslationWeightSnapshot: mocks.getFreeTranslationWeightSnapshot,
}));
vi.mock('@/src/app/translation/runtime', () => ({
    translateWithCache: vi.fn(async () => 'UNKNOWN'),
    translationRequestScheduler: {
        schedule: vi.fn(async (task: (lease: any) => Promise<unknown>) => task({holdUntil: vi.fn()})),
    },
}));
vi.mock('@/src/services/translation/broker', () => ({
    resolveTranslationRequestModel: vi.fn(() => 'resolved-model'),
}));
vi.mock('@/src/services/config/store', async () => {
    const {Config} = await import('@/src/core/config/model');
    Object.assign(mocks.config, new Config(), {model: {moonshot: 'kimi-k2.6'}, customModel: {moonshot: ''}, token: {moonshot: 'fixture-key'}});
    return {
        configReady: {then: (yes: (value: void) => unknown, no: (error: unknown) => unknown) => mocks.ready.then(yes, no)},
        config: mocks.config,
    };
});
vi.mock('@/src/core/config/catalog', async importOriginal => {
    const original = await importOriginal<typeof import('@/src/core/config/catalog')>();
    return {...original, resolveConfiguredModel: mocks.resolveConfiguredModel,
        servicesType: {...original.servicesType, isAiSdk: vi.fn(() => false)}};
});
vi.mock('@/src/app/translation/visionProbeRuntime', () => ({modelVisionProbe: {resolve: mocks.resolveVisionProbe}}));
vi.mock('@/src/platform/storage/modelUsageRepository', () => ({
    getModelUsageRepository: () => ({
        captureGeneration: mocks.captureGeneration,
        recordMany: mocks.recordMany,
    }),
}));

import {createProviderTestRuntimeHandlers, getFreeTranslationWeightSnapshot, runTranslationServiceConnectionTestWithUsage} from '@/src/app/background/providerRuntime';

describe('background provider runtime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ready = Promise.resolve();
        mocks.config.token.moonshot = 'fixture-key';
        mocks.runConnectionTest.mockReset().mockResolvedValue({durationMs: 25});
        vi.stubGlobal('browser', {runtime: {getURL: (path: string) => `chrome-extension://provider-fixture${path}`}});
    });
    afterEach(() => vi.unstubAllGlobals());

    it('captures reset generation before connection test and injects model usage persistence', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const events = [{serviceId: 'moonshot'}] as never;

        await expect(runTranslationServiceConnectionTestWithUsage('moonshot'))
            .resolves.toEqual({durationMs: 25});

        expect(mocks.captureGeneration).toHaveBeenCalledOnce();
        const options = mocks.runConnectionTest.mock.calls[0][1];
        expect(options.configuredModel).toBe('resolved-model');
        await options.recordModelUsage!(events);
        expect(mocks.recordMany).toHaveBeenCalledWith(events, 11);

        const failure = new Error('usage write failed');
        options.warn!('usage warning', failure);
        expect(warn).toHaveBeenCalledWith('usage warning', failure);
        warn.mockRestore();
    });

    it('exposes the provider-owned free translation weight snapshot through the composition root', async () => {
        await expect(getFreeTranslationWeightSnapshot()).resolves.toEqual({total: 100, observedAt: 1, entries: []});
        expect(mocks.getFreeTranslationWeightSnapshot).toHaveBeenCalledOnce();
        expect(mocks.getFreeTranslationWeightSnapshot).toHaveBeenCalledWith(expect.objectContaining({model: {moonshot: 'kimi-k2.6'}}));
        expect(Object.isFrozen(mocks.getFreeTranslationWeightSnapshot.mock.calls[0][0])).toBe(true);
    });

    it('dispatches connection and vision messages through the public assembly only after shared config readiness', async () => {
        let ready!: () => void;
        mocks.ready = new Promise<void>(resolve => {ready = resolve;});
        const handlers = createProviderTestRuntimeHandlers();
        expect(handlers.map(handler => handler.type)).toEqual([CONNECTION_TEST_MESSAGE_TYPE, VISION_PROBE_MESSAGE, VISION_PROBE_CANCEL_MESSAGE]);
        const router = createBackgroundMessageRouter(handlers);
        const connection = router.dispatch({type: CONNECTION_TEST_MESSAGE_TYPE, service: 'moonshot', keyIndex: 2, keyRevision: 'a'.repeat(64)}, {});
        const vision = router.dispatch({type: VISION_PROBE_MESSAGE, service: 'moonshot', model: 'kimi-k2.6', requestId: 'runtime-ready',
            identity: createVisionProbeIdentity(mocks.config, 'moonshot', 'kimi-k2.6')},
        {sender: {url: 'chrome-extension://provider-fixture/options.html?service=moonshot#vision'}});
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
        expect(mocks.runConnectionTest).not.toHaveBeenCalled();
        expect(mocks.resolveVisionProbe).not.toHaveBeenCalled();
        ready();
        await expect(connection).resolves.toEqual({handled: true, response: {success: true, durationMs: 25}});
        await expect(vision).resolves.toEqual({handled: true, response: {success: true, capability: 'supported', source: 'probe', checkedAt: 123}});
        expect(mocks.runConnectionTest).toHaveBeenCalledWith('moonshot', expect.objectContaining({keyIndex: 2, keyRevision: 'a'.repeat(64),
            configuredModel: 'resolved-model', effectiveModel: 'resolved-model', config: expect.objectContaining({token: {moonshot: 'fixture-key'}})}));
        const [snapshot, service, model, options] = mocks.resolveVisionProbe.mock.calls[0];
        expect(snapshot).not.toBe(mocks.config);
        expect(snapshot.token).toEqual({moonshot: 'fixture-key'});
        expect(service).toBe('moonshot'); expect(model).toBe('kimi-k2.6');
        expect(options).toMatchObject({force: true, timeoutMs: 30_000});
        expect(options.signal?.aborted).toBe(false);
    });

    it.each([undefined, 'https://example.com/options.html', 'chrome-extension://provider-fixture/popup.html',
        'chrome-extension://provider-fixture/options.html/extra'])('the assembled vision route rejects non-settings sender %s', async url => {
        const router = createBackgroundMessageRouter(createProviderTestRuntimeHandlers());
        await expect(router.dispatch({type: VISION_PROBE_MESSAGE, service: 'moonshot', model: 'kimi-k2.6', requestId: 'wrong-source'},
            {sender: {url}})).rejects.toThrow('仅可从设置页');
        expect(mocks.resolveVisionProbe).not.toHaveBeenCalled();
    });

    it('reads the live config after readiness and rejects an identity captured before credentials changed', async () => {
        let ready!: () => void;
        mocks.ready = new Promise<void>(resolve => {ready = resolve;});
        const router = createBackgroundMessageRouter(createProviderTestRuntimeHandlers());
        const pending = router.dispatch({type: VISION_PROBE_MESSAGE, service: 'moonshot', model: 'kimi-k2.6', requestId: 'live-identity',
            identity: createVisionProbeIdentity(mocks.config, 'moonshot', 'kimi-k2.6')}, {sender: {url: 'chrome-extension://provider-fixture/options.html'}});
        const failure = expect(pending).rejects.toThrow('服务配置已更改');
        mocks.config.token.moonshot = 'new-fixture-key';
        ready(); await failure;
        expect(mocks.resolveVisionProbe).not.toHaveBeenCalled();
        await expect(router.dispatch({type: VISION_PROBE_MESSAGE, service: 'moonshot', model: 'kimi-k2.6', requestId: 'live-identity-retry',
            identity: createVisionProbeIdentity(mocks.config, 'moonshot', 'kimi-k2.6')}, {sender: {url: 'chrome-extension://provider-fixture/options.html'}}))
            .resolves.toMatchObject({handled: true, response: {success: true, capability: 'supported'}});
        expect(mocks.resolveVisionProbe.mock.calls[0][0].token).toEqual({moonshot: 'new-fixture-key'});
    });

    it('assembles the matching cancellation route so a pending-ready vision request never reaches its provider', async () => {
        let ready!: () => void;
        mocks.ready = new Promise<void>(resolve => {ready = resolve;});
        const router = createBackgroundMessageRouter(createProviderTestRuntimeHandlers());
        const context = {sender: {url: 'chrome-extension://provider-fixture/options.html#vision'}};
        const pending = router.dispatch({type: VISION_PROBE_MESSAGE, service: 'moonshot', model: 'kimi-k2.6', requestId: 'assembly-cancel',
            identity: createVisionProbeIdentity(mocks.config, 'moonshot', 'kimi-k2.6')}, context);
        const failure = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        await expect(router.dispatch({type: VISION_PROBE_CANCEL_MESSAGE, requestId: 'assembly-cancel'}, context))
            .resolves.toMatchObject({handled: true, response: {cancelled: true}});
        await failure; ready();
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
        expect(mocks.resolveVisionProbe).not.toHaveBeenCalled();
    });

    it('classifies legacy provider failures through the assembled route without exposing raw formatter output', async () => {
        const failure = new Error('provider unavailable: fixture-private-endpoint');
        mocks.runConnectionTest.mockRejectedValueOnce(failure);
        const router = createBackgroundMessageRouter(createProviderTestRuntimeHandlers());
        await expect(router.dispatch({type: CONNECTION_TEST_MESSAGE_TYPE, service: 'moonshot'}, {}))
            .resolves.toEqual({handled: true, response: {success: false, error: '翻译未完成', diagnostic: {
                code: 'unknown', titleKey: 'diagnostics.unknown.title', detailKey: 'diagnostics.unknown.detail',
                actions: ['retry', 'services', 'dismiss'],
            }}});
        expect(mocks.formatError).toHaveBeenCalledWith('moonshot', failure);
    });
});

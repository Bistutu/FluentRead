import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {} as Config,
    ready: Promise.resolve(), subscribe: vi.fn(), createHandler: vi.fn(), createRuntime: vi.fn(), createConversation: vi.fn(), createSessions: vi.fn(), createMemories: vi.fn(), createRecall: vi.fn(), recall: vi.fn(), memories: vi.fn(), memoryRepository: {}, attachPort: vi.fn(),
    handler: {handle: vi.fn(), cancelAll: vi.fn(), cancelDisallowed: vi.fn(), cancelTab: vi.fn()},
    runtime: {run: vi.fn()}, conversation: {run: vi.fn()}, sessions: vi.fn(), repository: {prune: vi.fn(), recoverInterrupted: vi.fn()},
    removed: vi.fn(), updated: vi.fn(), record: vi.fn(), generation: vi.fn(() => 9), connect: vi.fn(), alarmListener: vi.fn(), createAlarm: vi.fn(),
    extension: {inIncognitoContext: false as boolean | undefined},
}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {id: 'extension', getURL: (path: string) => `chrome-extension://extension/${path}`, onConnect: {addListener: mocks.connect}}, extension: mocks.extension, alarms: {onAlarm: {addListener: mocks.alarmListener}, create: mocks.createAlarm}, tabs: {onRemoved: {addListener: mocks.removed}, onUpdated: {addListener: mocks.updated}}}}));
vi.mock('@/src/services/config/store', () => ({config: mocks.config, configReady: mocks.ready, subscribeConfig: mocks.subscribe}));
vi.mock('@/src/features/reading-assistant/background', () => ({createReadingAssistantHandler: mocks.createHandler}));
vi.mock('@/src/services/harness/runtime', () => ({createHarnessRuntime: mocks.createRuntime}));
vi.mock('@/src/services/harness/conversation', () => ({createHarnessConversationRuntime: mocks.createConversation}));
vi.mock('@/src/features/reading-assistant/sessionHandler', () => ({createReadingSessionHandler: mocks.createSessions}));
vi.mock('@/src/features/reading-assistant/memoryHandler', () => ({createLearningMemoryHandler: mocks.createMemories}));
vi.mock('@/src/services/harness/memoryRecall', () => ({createLearningMemoryRecall: mocks.createRecall}));
vi.mock('@/src/platform/storage/learningMemoryRepository', () => ({learningMemoryRepository: mocks.memoryRepository}));
vi.mock('@/src/features/reading-assistant/streamPort', () => ({attachReadingStreamPort: mocks.attachPort}));
vi.mock('@/src/platform/storage/harnessSessionRepository', () => ({harnessSessionRepository: mocks.repository}));
vi.mock('@/src/platform/storage/modelUsageRepository', () => ({getModelUsageRepository: () => ({recordMany: mocks.record, captureGeneration: mocks.generation})}));
import {installHarnessBackgroundRuntime} from '@/src/app/background/harnessRuntime';
import {Config} from '@/src/core/config/model';
const tick = async () => {for (let i=0; i<5; i++) await Promise.resolve();};

describe('Harness background composition', () => {
    beforeEach(() => {
        vi.clearAllMocks(); Object.assign(mocks.config, new Config());
        mocks.config.on = true; mocks.config.harness.enabled = true;
        mocks.config.disabledExtensionDomains = ['blocked.test']; mocks.extension.inIncognitoContext = false;
        mocks.createHandler.mockReturnValue(mocks.handler); mocks.createRuntime.mockReturnValue(mocks.runtime);
        mocks.createConversation.mockReturnValue(mocks.conversation); mocks.createSessions.mockReturnValue(mocks.sessions);
        mocks.createMemories.mockReturnValue(mocks.memories); mocks.createRecall.mockReturnValue(mocks.recall);
        mocks.record.mockResolvedValue(1); mocks.repository.prune.mockResolvedValue(0); mocks.repository.recoverInterrupted.mockResolvedValue(undefined); mocks.createAlarm.mockResolvedValue(undefined);
    });
    it('binds configuration, owner eligibility, navigation, ports and generation-scoped usage', async () => {
        const cancelWriting = vi.fn();
        const router = installHarnessBackgroundRuntime(cancelWriting);
        expect(router.type).toBe('fluentReadHarness');
        const [getConfig, createSink, memory] = mocks.createRuntime.mock.calls[0];
        expect(getConfig()).toBe(mocks.config);
        expect(memory.recall).toBe(mocks.recall); expect(mocks.createRecall).toHaveBeenCalledWith(mocks.memoryRepository);
        const sink = createSink(); const event = {purpose: 'reading'}; sink(event);
        expect(mocks.record).toHaveBeenCalledWith([event], 9);
        mocks.record.mockRejectedValueOnce(new Error('storage unavailable')); sink(event); await tick();
        const dependencies = mocks.createHandler.mock.calls[0][0];
        expect(dependencies.extensionId).toBe('extension');
        expect(dependencies.eligibility({})).toBeUndefined();
        expect(dependencies.eligibility({url: 'https://allowed.test', tab: {url: 'https://allowed.test'}})).toBeUndefined();
        expect(dependencies.eligibility({url: 'https://blocked.test'})).toContain('禁用');
        expect(dependencies.eligibility({tab: {url: 'https://blocked.test'}})).toContain('禁用');
        mocks.config.on = false; expect(dependencies.eligibility({})).toContain('停用');
        mocks.config.on = true; mocks.config.harness.enabled = false; expect(dependencies.eligibility({})).toContain('停用');
        const signal = new AbortController().signal; const progress = vi.fn();
        dependencies.run('request', signal, progress);
        expect(mocks.conversation.run).toHaveBeenLastCalledWith('request', signal, progress, false);
        dependencies.run('private', signal, progress, {tab: {incognito: true}});
        expect(mocks.conversation.run).toHaveBeenLastCalledWith('private', signal, progress, true);
        mocks.extension.inIncognitoContext = true; dependencies.run('private-extension', signal, progress, {});
        expect(mocks.conversation.run).toHaveBeenLastCalledWith('private-extension', signal, progress, true);
        expect(mocks.createConversation.mock.calls[0][0].preferences()).toBe(mocks.config.harness);
        const memoryDeps = mocks.createMemories.mock.calls[0][0];
        expect(memoryDeps.optionsUrl).toBe('chrome-extension://extension/options.html');
        expect(memoryDeps.privateContext()).toBe(true);
        expect(memoryDeps.eligibility({})).toBeUndefined();
        expect(memoryDeps.eligibility({url: 'https://blocked.test'})).toContain('禁用');
        expect(memoryDeps.eligibility({tab: {url: 'https://blocked.test'}})).toContain('禁用');
        memoryDeps.cancelActive(); expect(cancelWriting).toHaveBeenCalledOnce(); expect(mocks.handler.cancelAll).toHaveBeenCalledOnce(); mocks.handler.cancelAll.mockClear();
        const sessionDeps = mocks.createSessions.mock.calls[0][0];
        expect(sessionDeps.optionsUrl).toBe('chrome-extension://extension/options.html'); expect(sessionDeps.privateContext()).toBe(true);
        mocks.extension.inIncognitoContext = undefined; expect(sessionDeps.privateContext()).toBe(false);
        expect(memoryDeps.privateContext()).toBe(false);
        const port = {name: 'stream'}; mocks.connect.mock.calls[0][0](port); expect(mocks.attachPort).toHaveBeenCalledWith(port, mocks.handler);
        const changed = mocks.subscribe.mock.calls[0][0];
        changed({...mocks.config, harness: {...mocks.config.harness, enabled: true}}); expect(mocks.handler.cancelAll).not.toHaveBeenCalled();
        changed({...mocks.config, harness: {...mocks.config.harness, enabled: false}}); expect(mocks.handler.cancelAll).toHaveBeenCalledOnce();
        expect(mocks.handler.cancelDisallowed).toHaveBeenCalledTimes(2);
        mocks.removed.mock.calls[0][0](7); const updated = mocks.updated.mock.calls[0][0];
        updated(8, {status: 'loading'}); updated(9, {url: 'https://new.test'}); updated(10, {status: 'complete'});
        expect(mocks.handler.cancelTab.mock.calls).toEqual([[7], [8], [9]]);
        await router.handle({type: 'a'}, {sender: {id: 'extension'}}); await router.handle({type: 'b'}, {});
        await router.handle({type: 'fluentReadHarness', action: 'sessions-list'} as any, {});
        await router.handle({type: 'fluentReadHarness', action: 'memory-list'} as any, {sender: {id: 'extension'}});
        expect(mocks.memories).toHaveBeenCalledWith({type: 'fluentReadHarness', action: 'memory-list'}, {id: 'extension'});
        await router.handle({type: 'fluentReadHarness', action: 4} as any, {});
        expect(mocks.sessions).toHaveBeenCalledWith({type: 'fluentReadHarness', action: 'sessions-list'}, {});
        expect(mocks.handler.handle).toHaveBeenCalledTimes(3);
        await router.handle(null as any, {});
        await router.handle('malformed' as any, {});
    });
    it('cleans expired sessions at startup and alarms, without exposing storage or alarm failures', async () => {
        mocks.repository.recoverInterrupted.mockRejectedValueOnce(new Error('recovery storage'));
        mocks.repository.prune.mockRejectedValueOnce(new Error('storage'));
        mocks.createAlarm.mockRejectedValueOnce(new Error('alarm'));
        installHarnessBackgroundRuntime(); await tick();
        expect(mocks.createAlarm).toHaveBeenCalledWith('fluentReadHarnessSessionCleanup', {periodInMinutes: 60});
        const onAlarm = mocks.alarmListener.mock.calls[0][0];
        onAlarm({name: 'other'}); expect(mocks.repository.prune).toHaveBeenCalledOnce();
        onAlarm({name: 'fluentReadHarnessSessionCleanup'}); await tick(); expect(mocks.repository.prune).toHaveBeenCalledTimes(2);
    });
    it('never opens history storage from an incognito background context', async () => {
        mocks.extension.inIncognitoContext = true;
        installHarnessBackgroundRuntime(); await tick();
        expect(mocks.repository.recoverInterrupted).not.toHaveBeenCalled();
        expect(mocks.repository.prune).not.toHaveBeenCalled();
    });
    it('keeps an anonymous B站 request alive for unused model or credential edits and cancels real service changes', () => {
        mocks.config.harness.service = 'bilibili';
        installHarnessBackgroundRuntime();
        const changed = mocks.subscribe.mock.calls[0][0];
        const unused = {...mocks.config, harness: {...mocks.config.harness, model: 'unused-model'},
            token: {...mocks.config.token, bilibili: 'test-only-unused'}, proxy: {...mocks.config.proxy, bilibili: 'https://unused.test'},
            apiKeys: {...mocks.config.apiKeys, bilibili: ['test-only-unused']},
            customHeaders: {...mocks.config.customHeaders, bilibili: '{"x-unused":"test"}'}};
        changed(unused);
        expect(mocks.handler.cancelAll).not.toHaveBeenCalled();
        changed({...unused, harness: {...unused.harness, service: 'openai', model: 'reader'}});
        expect(mocks.handler.cancelAll).toHaveBeenCalledOnce();
        expect(mocks.handler.cancelDisallowed).toHaveBeenCalledTimes(2);
    });
});

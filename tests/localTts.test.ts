import {afterEach, describe, expect, it, vi} from 'vitest';

import {
    LOCAL_TTS_MODE_OPTIONS,
    localTtsLanguageFamily,
    localTtsVoiceForLanguage,
    normalizeLocalTtsMode,
    normalizeLocalTtsVoice,
    supportsLocalTtsLanguage,
} from '@/src/core/config/localTts';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {prepareConfigForExport, prepareConfigForImport} from '@/src/core/config/transfer';
import {
    LocalTtsLanguageUnsupportedError,
    LocalTtsModelNotDownloadedError,
    localTtsErrorCode,
} from '@/src/features/local-tts/protocol';
import {
    getLocalTtsModelFileUrl,
    getLocalTtsModelLoaderUrl,
} from '@/src/features/local-tts/offscreen/modelCache';
import {createSelectionTtsSynthesizer} from '@/src/features/selection-translation/background/selectionTtsSynthesis';
import type {SelectionTtsAudio} from '@/src/features/selection-translation/background/ttsHandler';
import type {LocalTtsAudio} from '@/src/features/local-tts/protocol';
import {createLocalInferenceBudget} from '@/src/shared/onnx/resources';

function onlineAudio(): SelectionTtsAudio {
    return {audio: new Uint8Array([1]).buffer, contentType: 'audio/mpeg', voice: 'edge-voice'};
}

function localAudio(): LocalTtsAudio {
    return {audio: new Uint8Array([2]).buffer, contentType: 'audio/wav', voice: 'zf_001', backend: 'wasm'};
}

function subject(mode: string, overrides: Partial<Parameters<typeof createSelectionTtsSynthesizer>[0]> = {}) {
    const synthesizeOnline = vi.fn(async () => onlineAudio());
    const synthesizeLocal = vi.fn(async () => localAudio());
    const synthesize = createSelectionTtsSynthesizer({
        getMode: () => mode,
        getLocalVoice: () => 'auto',
        getOnlineVoices: () => ['edge-voice'],
        synthesizeOnline,
        synthesizeLocal,
        ...overrides,
    });
    return {synthesize, synthesizeLocal, synthesizeOnline};
}

describe('local TTS configuration', () => {
    it('normalizes strategy and voice values without overwriting valid settings', () => {
        expect(LOCAL_TTS_MODE_OPTIONS.map((item) => item.value)).toEqual([
            'online-first', 'local-first', 'online-only', 'local-only',
        ]);
        expect(normalizeLocalTtsMode('local-first')).toBe('local-first');
        expect(normalizeLocalTtsMode('bad')).toBe('online-first');
        expect(normalizeLocalTtsVoice('zf_001')).toBe('zf_001');
        expect(normalizeLocalTtsVoice('bad')).toBe('auto');
        expect(localTtsLanguageFamily('cmn')).toBe('zh');
        expect(localTtsLanguageFamily('en-GB')).toBe('en');
        expect(localTtsLanguageFamily('fr-FR')).toBeNull();
        expect(localTtsVoiceForLanguage('zh-CN', 'af_maple')).toBe('zf_001');
        expect(localTtsVoiceForLanguage('en-US', 'bf_vale')).toBe('bf_vale');
        expect(localTtsVoiceForLanguage('zh_TW', 'zm_010')).toBe('zm_010');
        expect(localTtsVoiceForLanguage('en', 'unknown-voice')).toBe('af_maple');
        expect(localTtsVoiceForLanguage('fr-FR', 'zf_002')).toBe('af_maple');
        for (const [language, family] of [['cmn', 'zh'], ['zho', 'zh'], ['ZH', 'zh'], ['eng', 'en'], ['en-GB', 'en'], ['fr', null], [42, null]] as const) {
            expect(localTtsLanguageFamily(language), String(language)).toBe(family);
            expect(supportsLocalTtsLanguage(language)).toBe(family !== null);
        }
        expect(new Config().selectionTtsMode).toBe('online-first');
        expect(new Config().selectionTtsLocalVoice).toBe('auto');
        expect(normalizeConfig({selectionTtsMode: 'local-only', selectionTtsLocalVoice: 'zf_001'})).toMatchObject({
            selectionTtsMode: 'local-only',
            selectionTtsLocalVoice: 'zf_001',
        });
    });

    it('keeps the pinned download URL and the Transformers.js main cache alias distinct', () => {
        const pinned = getLocalTtsModelFileUrl('onnx/model.onnx');
        const loader = getLocalTtsModelLoaderUrl('onnx/model.onnx');
        expect(pinned).toContain('/resolve/6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3/');
        expect(loader).toContain('/resolve/main/');
        expect(loader).not.toBe(pinned);
    });

    it('round-trips the user TTS choice while legacy backups keep the online-first default', () => {
        const source = normalizeConfig({
            ...new Config(),
            selectionTtsMode: 'local-only',
            selectionTtsLocalVoice: 'zf_001',
        });
        const exported = prepareConfigForExport(source);
        expect(exported).toMatchObject({selectionTtsMode: 'local-only', selectionTtsLocalVoice: 'zf_001'});
        expect(prepareConfigForImport(exported, new Config())).toMatchObject({
            selectionTtsMode: 'local-only',
            selectionTtsLocalVoice: 'zf_001',
        });

        const {selectionTtsMode: _mode, selectionTtsLocalVoice: _voice, ...legacyBackup} = exported;
        expect(prepareConfigForImport(legacyBackup, new Config())).toMatchObject({
            selectionTtsMode: 'online-first',
            selectionTtsLocalVoice: 'auto',
        });
        expect(JSON.stringify(exported)).not.toContain('onnx');
    });
});

describe('selection TTS source policy', () => {
    it('online-first does not initialize local speech when online succeeds', async () => {
        const state = subject('online-first');
        await expect(state.synthesize('hello', 'en-US', [], undefined)).resolves.toEqual(onlineAudio());
        expect(state.synthesizeOnline).toHaveBeenCalledOnce();
        expect(state.synthesizeLocal).not.toHaveBeenCalled();
    });

    it('online-first falls back to local speech after an online failure', async () => {
        const state = subject('online-first', {
            synthesizeOnline: vi.fn(async () => { throw new Error('network down'); }),
        });
        await expect(state.synthesize('你好', 'zh-CN', [], undefined)).resolves.toMatchObject({contentType: 'audio/wav', voice: 'zf_001'});
        expect(state.synthesizeLocal).toHaveBeenCalledOnce();
    });

    it('online-first reports an actionable missing-model error and never downloads automatically', async () => {
        const state = subject('online-first', {
            synthesizeOnline: vi.fn(async () => { throw new Error('network down'); }),
            synthesizeLocal: vi.fn(async () => { throw new LocalTtsModelNotDownloadedError(); }),
        });
        await expect(state.synthesize('你好', 'zh-CN', [], undefined)).rejects.toMatchObject({
            code: 'local-tts-model-not-downloaded',
        });
    });

    it('local-first uses local speech and falls online only when local is unavailable', async () => {
        const first = subject('local-first');
        await expect(first.synthesize('你好', 'zh-CN', [], undefined)).resolves.toMatchObject({contentType: 'audio/wav'});
        expect(first.synthesizeOnline).not.toHaveBeenCalled();

        const fallback = subject('local-first', {
            synthesizeLocal: vi.fn(async () => { throw new LocalTtsModelNotDownloadedError(); }),
        });
        await expect(fallback.synthesize('hello', 'en-US', [], undefined)).resolves.toEqual(onlineAudio());
        expect(fallback.synthesizeOnline).toHaveBeenCalledOnce();
    });

    it('本地音色为空时按自动音色交给本地合成', async () => {
        const state = subject('local-only', {getLocalVoice: () => ''});
        await state.synthesize('你好', 'zh-CN', [], undefined);
        expect(state.synthesizeLocal).toHaveBeenCalledWith('你好', 'zh-CN', 'auto', undefined);
    });

    it('only-online and only-local modes remain strict', async () => {
        const online = subject('online-only');
        await expect(online.synthesize('hello', 'en-US', [], undefined)).resolves.toEqual(onlineAudio());
        expect(online.synthesizeLocal).not.toHaveBeenCalled();

        const local = subject('local-only');
        await expect(local.synthesize('你好', 'zh-CN', [], undefined)).resolves.toMatchObject({contentType: 'audio/wav'});
        expect(local.synthesizeOnline).not.toHaveBeenCalled();
    });

    it('local-first treats unsupported local languages as an online fallback', async () => {
        const state = subject('local-first', {
            synthesizeLocal: vi.fn(async () => { throw new LocalTtsLanguageUnsupportedError('fr-FR'); }),
        });
        await expect(state.synthesize('bonjour', 'fr-FR', [], undefined)).resolves.toEqual(onlineAudio());
        expect(state.synthesizeOnline).toHaveBeenCalledOnce();
    });

    // 回归：本地错误经 Offscreen 消息返回后只剩普通 Error + code，instanceof 判断会失效。
    it.each([
        ['local-tts-model-not-downloaded'],
        ['local-tts-language-unsupported'],
    ])('local-first 把跨消息边界的 %s 视为本地不可用，直接交给在线结果或在线错误', async (code) => {
        const remoteError = () => Object.assign(new Error('offscreen said no'), {code});
        const fallback = subject('local-first', {synthesizeLocal: vi.fn(async () => { throw remoteError(); })});
        await expect(fallback.synthesize('hello', 'en-US', [], undefined)).resolves.toEqual(onlineAudio());

        const onlineFailure = new Error('network down');
        const bothUnavailable = subject('local-first', {
            synthesizeLocal: vi.fn(async () => { throw remoteError(); }),
            synthesizeOnline: vi.fn(async () => { throw onlineFailure; }),
        });
        await expect(bothUnavailable.synthesize('hello', 'en-US', [], undefined)).rejects.toBe(onlineFailure);
    });

    it('local-first 在真实本地合成失败后尝试在线，并在两者都失败时同时给出原因', async () => {
        const state = subject('local-first', {
            synthesizeLocal: vi.fn(async () => { throw new Error('worker crashed'); }),
            synthesizeOnline: vi.fn(async () => { throw 'offline'; }),
        });
        await expect(state.synthesize('你好', 'zh-CN', [], undefined)).rejects.toThrow('本地 TTS 和在线 TTS 均失败：worker crashed；offline');
    });

    it('online-first 在线失败时，本地不支持该语言则保留在线错误，本地真实失败则同时给出两侧原因', async () => {
        const onlineFailure = new Error('network down');
        const unsupported = subject('online-first', {
            synthesizeOnline: vi.fn(async () => { throw onlineFailure; }),
            synthesizeLocal: vi.fn(async () => { throw Object.assign(new Error('remote'), {code: 'local-tts-language-unsupported'}); }),
        });
        await expect(unsupported.synthesize('bonjour', 'fr-FR', [], undefined)).rejects.toBe(onlineFailure);

        const bothFailed = subject('online-first', {
            synthesizeOnline: vi.fn(async () => { throw 'edge offline'; }),
            synthesizeLocal: vi.fn(async () => { throw new Error('worker crashed'); }),
        });
        await expect(bothFailed.synthesize('你好', 'zh-CN', [], undefined)).rejects.toThrow('在线 TTS 和本地 TTS 均失败：edge offline；worker crashed');

        const missingModel = subject('online-first', {
            synthesizeOnline: vi.fn(async () => { throw onlineFailure; }),
            synthesizeLocal: vi.fn(async () => { throw Object.assign(new Error('remote'), {code: 'local-tts-model-not-downloaded'}); }),
        });
        await expect(missingModel.synthesize('你好', 'zh-CN', [], undefined)).rejects.toThrow('在线 TTS 失败；本地 TTS 模型尚未下载');
    });

    it('错误码读取只接受字符串 code', () => {
        expect(localTtsErrorCode(new LocalTtsModelNotDownloadedError())).toBe('local-tts-model-not-downloaded');
        expect(localTtsErrorCode(Object.assign(new Error('x'), {code: 7}))).toBeUndefined();
        expect(localTtsErrorCode(null)).toBeUndefined();
        expect(localTtsErrorCode('local-tts-model-not-downloaded')).toBeUndefined();
    });
});

class LocalTtsOwnerFakeWorker {
    static instances: LocalTtsOwnerFakeWorker[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;
    lastMessage: any;

    constructor() { LocalTtsOwnerFakeWorker.instances.push(this); }
    postMessage(message: any): void { this.lastMessage = message; }
    terminate(): void { this.terminated = true; }
    reply(response: Record<string, unknown>): void { this.onmessage?.({data: response} as MessageEvent); }
    fail(message = 'worker failed'): void { this.onerror?.({message} as ErrorEvent); }
}

const ownedLocalTtsModules = new Set<typeof import('@/src/features/local-tts/offscreen/tts')>();

async function ownerWorkerAt(index: number): Promise<LocalTtsOwnerFakeWorker> {
    // 等实际公共调用发出 Worker 消息，保留真实资源预算；不假设固定两次 microtask 就已获准。
    await vi.waitFor(() => {
        expect(LocalTtsOwnerFakeWorker.instances.length).toBeGreaterThan(index);
        expect(LocalTtsOwnerFakeWorker.instances[index].lastMessage).toBeDefined();
    });
    return LocalTtsOwnerFakeWorker.instances[index];
}

async function loadLocalTtsOwner(overrides: Partial<Pick<typeof import('@/src/features/local-tts/offscreen/modelCache'),
    'cacheLocalTtsModelFiles' | 'isLocalTtsModelCached' | 'removeLocalTtsModelFiles'>> = {},
    budget?: typeof import('@/src/shared/onnx/resources')['withLocalInferenceBudget'],
): Promise<typeof import('@/src/features/local-tts/offscreen/tts')> {
    vi.resetModules();
    vi.doMock('@/src/features/local-tts/offscreen/modelCache', () => ({
        cacheLocalTtsModelFiles: vi.fn(async () => undefined),
        isLocalTtsModelCached: vi.fn(async () => true),
        removeLocalTtsModelFiles: vi.fn(async () => undefined),
        ...overrides,
    }));
    if (budget) vi.doMock('@/src/shared/onnx/resources', async original => ({
        ...await original<typeof import('@/src/shared/onnx/resources')>(),
        withLocalInferenceBudget: budget,
    }));
    vi.stubGlobal('Worker', LocalTtsOwnerFakeWorker);
    vi.stubGlobal('window', {location: {href: 'chrome-extension://test/offscreen.html'}, setTimeout, clearTimeout});
    const owner = await import('@/src/features/local-tts/offscreen/tts');
    ownedLocalTtsModules.add(owner);
    return owner;
}

describe('local TTS offscreen worker owner', () => {
    afterEach(() => {
        for (const owner of ownedLocalTtsModules) owner.disposeLocalTtsWorker();
        ownedLocalTtsModules.clear();
        vi.unstubAllGlobals();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.doUnmock('@/src/features/local-tts/offscreen/modelCache');
        vi.doUnmock('@/src/shared/onnx/resources');
        LocalTtsOwnerFakeWorker.instances = [];
    });

    it.each([
        [4, 60_000], [8, 180_000], [undefined, 120_000],
    ])('设备内存%s时跨越30秒仍复用Worker，并在%s毫秒连续空闲后释放', async (memory, idleMs) => {
        vi.useFakeTimers();
        vi.stubGlobal('navigator', {deviceMemory: memory});
        const owner = await loadLocalTtsOwner();
        const first = owner.synthesizeLocalTts('first', 'en-US', 'auto');
        const worker = await ownerWorkerAt(0);
        worker.reply({requestId: worker.lastMessage.requestId, success: true, audio: new ArrayBuffer(4)});
        await first;
        await vi.advanceTimersByTimeAsync(40_000);
        expect(worker.terminated).toBe(false);
        const firstId = worker.lastMessage.requestId;
        const next = owner.synthesizeLocalTts('next', 'en-US', 'auto');
        await vi.waitFor(() => expect(worker.lastMessage.requestId).toBeGreaterThan(firstId));
        expect(LocalTtsOwnerFakeWorker.instances).toHaveLength(1);
        worker.reply({requestId: worker.lastMessage.requestId, success: true, audio: new ArrayBuffer(4)});
        await next;
        await vi.advanceTimersByTimeAsync(idleMs - 1);
        expect(worker.terminated).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(worker.terminated).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('新请求开始校验缓存时撤销旧回收计时，迟到的校验继续使用暖Worker', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('navigator', {});
        let checked!: (value: boolean) => void;
        const deferredCheck = new Promise<boolean>(resolve => {checked = resolve;});
        const cacheCheck = vi.fn(async () => true).mockImplementationOnce(async () => true)
            .mockImplementationOnce(() => deferredCheck);
        const owner = await loadLocalTtsOwner({isLocalTtsModelCached: cacheCheck});
        const first = owner.synthesizeLocalTts('first', 'en-US', 'auto');
        const worker = await ownerWorkerAt(0);
        worker.reply({requestId: worker.lastMessage.requestId, success: true, audio: new ArrayBuffer(4)});
        await first;
        const firstId = worker.lastMessage.requestId;
        await vi.advanceTimersByTimeAsync(119_999);
        const next = owner.synthesizeLocalTts('next', 'en-US', 'auto');
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(120_001);
        expect(worker.terminated).toBe(false);
        checked(true);
        await vi.waitFor(() => expect(worker.lastMessage.requestId).toBeGreaterThan(firstId));
        expect(LocalTtsOwnerFakeWorker.instances).toHaveLength(1);
        worker.reply({requestId: worker.lastMessage.requestId, success: true, audio: new ArrayBuffer(4)});
        await next;
        await vi.advanceTimersByTimeAsync(120_000);
        expect(worker.terminated).toBe(true);
    });

    it('共享计算预算排队超过保温时间时保留暖Worker，获准后续用并重新计时', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('navigator', {});
        const budget = createLocalInferenceBudget(1);
        const owner = await loadLocalTtsOwner({}, budget);
        const first = owner.synthesizeLocalTts('first', 'en-US', 'auto');
        const worker = await ownerWorkerAt(0);
        worker.reply({requestId: worker.lastMessage.requestId, success: true, audio: new ArrayBuffer(4)});
        await first;
        const firstId = worker.lastMessage.requestId;
        let release!: () => void;
        const occupying = budget(() => new Promise<void>(resolve => {release = resolve;}));
        const next = owner.synthesizeLocalTts('next', 'en-US', 'auto');
        await vi.advanceTimersByTimeAsync(180_000);
        expect(vi.getTimerCount()).toBe(0);
        expect(worker.terminated).toBe(false);
        expect(worker.lastMessage.requestId).toBe(firstId);
        release();await occupying;
        await vi.waitFor(() => expect(worker.lastMessage.requestId).toBeGreaterThan(firstId));
        expect(LocalTtsOwnerFakeWorker.instances).toHaveLength(1);
        worker.reply({requestId: worker.lastMessage.requestId, success: true, audio: new ArrayBuffer(4)});
        await next;
        await vi.advanceTimersByTimeAsync(120_000);
        expect(worker.terminated).toBe(true);
    });

    it('rebuilds one fresh WASM worker after GPU failure and ignores an old worker error', async () => {
        const owner = await loadLocalTtsOwner();
        const pending = owner.synthesizeLocalTts('hello', 'en-US', 'auto');
        const first = await ownerWorkerAt(0);
        expect(first.lastMessage.device).toBeUndefined();
        first.fail('GPU worker failed');
        const replacement = await ownerWorkerAt(1);
        expect(LocalTtsOwnerFakeWorker.instances).toHaveLength(2);
        expect(replacement.lastMessage.device).toBe('wasm');
        first.fail('late stale error');
        replacement.reply({requestId: replacement.lastMessage.requestId, success: true, audio: new ArrayBuffer(4), backend: 'wasm'});
        await expect(pending).resolves.toMatchObject({contentType: 'audio/wav', backend: 'wasm'});
        expect(replacement.terminated).toBe(false);
        owner.disposeLocalTtsWorker();
    });

    it('does not retry after AbortSignal cancellation', async () => {
        const owner = await loadLocalTtsOwner();
        const controller = new AbortController();
        const pending = owner.synthesizeLocalTts('hello', 'en-US', 'auto', controller.signal);
        await ownerWorkerAt(0);
        controller.abort();
        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        expect(LocalTtsOwnerFakeWorker.instances).toHaveLength(1);
        owner.disposeLocalTtsWorker();
    });

    it('共享预算交接时取消请求不会创建Worker或留下超时计时器', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const owner = await loadLocalTtsOwner({}, async operation => {
            // 外部资源调度在交接处触发取消，owner 必须在实际创建 Worker 前再核对。
            controller.abort();
            return operation();
        });
        await expect(owner.synthesizeLocalTts('hello', 'en-US', 'auto', controller.signal))
            .rejects.toMatchObject({name: 'AbortError'});
        expect(LocalTtsOwnerFakeWorker.instances).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('retries once on a structured GPU failure hint and sends the retry to a fresh CPU worker', async () => {
        const owner = await loadLocalTtsOwner();
        const pending = owner.synthesizeLocalTts('hello', 'en-US', 'auto');
        const first = await ownerWorkerAt(0);
        first.reply({requestId: first.lastMessage.requestId, success: false, retryWithCpu: true, error: 'GPU init failed'});
        const replacement = await ownerWorkerAt(1);
        expect(LocalTtsOwnerFakeWorker.instances).toHaveLength(2);
        expect(replacement.lastMessage.device).toBe('wasm');
        replacement.reply({requestId: replacement.lastMessage.requestId, success: true, audio: new ArrayBuffer(4), backend: 'wasm'});
        await expect(pending).resolves.toMatchObject({backend: 'wasm'});
        expect(LocalTtsOwnerFakeWorker.instances).toHaveLength(2);
        owner.disposeLocalTtsWorker();
    });

    it('does not rebuild a worker for an unhinted business failure', async () => {
        const owner = await loadLocalTtsOwner();
        const pending = owner.synthesizeLocalTts('hello', 'en-US', 'auto');
        const worker = await ownerWorkerAt(0);
        worker.reply({requestId: worker.lastMessage.requestId, success: false, error: 'invalid voice'});
        await expect(pending).rejects.toThrow('invalid voice');
        expect(LocalTtsOwnerFakeWorker.instances).toHaveLength(1);
        owner.disposeLocalTtsWorker();
    });

    it('uses separate 60 second phases for the first attempt and the single CPU retry', async () => {
        vi.useFakeTimers();
        const owner = await loadLocalTtsOwner();
        const pending = owner.synthesizeLocalTts('hello', 'en-US', 'auto');
        const rejected = expect(pending).rejects.toBeInstanceOf(Error);
        await ownerWorkerAt(0);
        vi.advanceTimersByTime(60_001);
        const replacement = await ownerWorkerAt(1);
        expect(LocalTtsOwnerFakeWorker.instances).toHaveLength(2);
        expect(replacement.lastMessage.device).toBe('wasm');
        vi.advanceTimersByTime(60_000);
        await rejected;
        expect(LocalTtsOwnerFakeWorker.instances).toHaveLength(2);
    });

    it('disposes queued ownership and excludes stale replies while allowing a fresh timed synthesis', async () => {
        const owner = await loadLocalTtsOwner();
        const firstRequest = owner.synthesizeLocalTts('old one', 'en-US', 'auto');
        const queuedRequest = owner.synthesizeLocalTts('old two', 'en-US', 'auto');
        const canceled = Promise.allSettled([firstRequest, queuedRequest]);
        const oldWorker = await ownerWorkerAt(0);
        owner.disposeLocalTtsWorker();
        const results = await canceled;
        expect(results).toHaveLength(2);
        for (const result of results) {
            expect(result.status).toBe('rejected');
            if (result.status === 'rejected') expect(result.reason).toMatchObject({name: 'AbortError'});
        }
        expect(oldWorker.terminated).toBe(true);
        expect(LocalTtsOwnerFakeWorker.instances).toHaveLength(1);
        const fresh = owner.synthesizeLocalTts('fresh', 'en-US', 'auto');
        const nextWorker = await ownerWorkerAt(1);
        oldWorker.reply({requestId: oldWorker.lastMessage.requestId, success: true, audio: new ArrayBuffer(1)});
        const timings = [{startChar: 0, endChar: 5, startTime: 0, endTime: 0.5}];
        nextWorker.reply({requestId: nextWorker.lastMessage.requestId, success: true, audio: new ArrayBuffer(4), timings, backend: 'wasm'});
        await expect(fresh).resolves.toMatchObject({voice: 'af_maple', backend: 'wasm', timings});
        expect(nextWorker.terminated).toBe(false);
    });

    it('forwards supplied byte progress and refuses removal while public preparation owns the cache', async () => {
        let complete!: () => void;
        const downloading = new Promise<void>(resolve => { complete = resolve; });
        const cache = vi.fn(async (onProgress?: (value: {loaded: number; total: number}) => void) => {
            onProgress?.({loaded: 3, total: 10});
            await downloading;
        });
        const owner = await loadLocalTtsOwner({cacheLocalTtsModelFiles: cache});
        const progress = vi.fn();
        const prepared = owner.prepareLocalTtsModel(false, progress);
        expect(progress).toHaveBeenCalledWith({loaded: 3, total: 10});
        await expect(owner.removeLocalTtsModel()).rejects.toThrow('正在下载');
        expect(LocalTtsOwnerFakeWorker.instances).toHaveLength(0);
        complete();
        await expect(prepared).resolves.toMatchObject({warm: false});
        await owner.removeLocalTtsModel();
        expect(cache).toHaveBeenCalledWith(progress);
    });
});

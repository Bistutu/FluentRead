import {afterEach, describe, expect, it, vi} from 'vitest';
import {createVideoSubtitleBackgroundHandlers, releaseVideoSubtitleOwnerForTab} from '@/src/features/video-subtitle/background/handlers';
import {getVideoAiModelFileUrl, VIDEO_AI_Q4_MODEL_FILES, VIDEO_AI_SMALL_MODEL_FILES} from '@/src/features/video-subtitle/offscreen/modelCache';

afterEach(() => vi.unstubAllGlobals());
function installModelKeys(models: string[]) {
    const urls = new Set(models.flatMap(model => (model === 'small' ? VIDEO_AI_SMALL_MODEL_FILES : VIDEO_AI_Q4_MODEL_FILES).map(file => getVideoAiModelFileUrl(model, file))));
    const keys = vi.fn(async () => [...urls].map(url => new Request(url)));
    const open = vi.fn(async () => ({keys}));
    vi.stubGlobal('caches', {has: async () => true, open});
    return {urls, keys, open};
}

function setup(response: unknown = {success: true, backend: 'wasm'}) {
    const offscreen = {
        hasDocument: vi.fn(async () => true),
        ensureDocument: vi.fn(async () => undefined),
        send: vi.fn(async <TResponse>() => response as TResponse),
        sendIfPresent: vi.fn(async <TResponse>() => ({success: true} as TResponse)),
    };
    const offscreenClient = offscreen as unknown as import('@/src/platform/offscreen/client').OffscreenClient;
    const storage = {get: vi.fn(async () => ({fluentReadVideoLocalTranscriptionModels: [] as string[]})), set: vi.fn(async () => undefined)};
    const handlers = createVideoSubtitleBackgroundHandlers({offscreen: offscreenClient, storage});
    return {offscreen, storage, handlers};
}
const context = (id: number) => ({sender: {tab: {id}}});
const find = (handlers: readonly {type: string; handle: Function}[], type: string) => handlers.find((item) => item.type === type)!;

describe('video subtitle background ownership', () => {
    it.each(['official', 'mirror', 'auto', 'https://untrusted.invalid', undefined])('validates cache-download source preference %s before forwarding', async preference => {
        const {handlers, offscreen} = setup();
        await find(handlers, 'fluentReadPrepareLocalVideoModel').handle({model: 'small', preference}, context(1));
        expect(offscreen.send).toHaveBeenCalledWith({type: 'VIDEO_AI_PREPARE', model: 'small', keepWarm: false, preference: preference === 'official' || preference === 'mirror' ? preference : 'auto'}, {timeoutMs: 630_000});
    });
    it.each(['tiny', 'base'])('gives %s the downloader total budget plus cleanup time', async model => {
        const {handlers, offscreen} = setup();
        await find(handlers, 'fluentReadPrepareLocalVideoModel').handle({model}, context(1));
        expect(offscreen.send).toHaveBeenCalledWith({type: 'VIDEO_AI_PREPARE', model, keepWarm: false, preference: 'auto'}, {timeoutMs: 630_000});
    });
    it.each([
        ['tiny', 'tiny', 40_000], ['base', 'base', 40_000], ['small', 'small', 200_000], ['unknown', 'small', 200_000],
    ])('transcription request %s uses its bounded model budget without enlarging invalid models', async (model, normalized, timeoutMs) => {
        const {handlers, offscreen} = setup({success: true, text: 'bounded result'});
        await find(handlers, 'fluentReadTranscribeLocalVideoAudio').handle({model, streamId: 'budget', generation: 1, audioPcm16Base64: 'AAAAAA=='}, context(1));
        expect(offscreen.send).toHaveBeenCalledWith(expect.objectContaining({type: 'VIDEO_AI_TRANSCRIBE', model: normalized}), expect.objectContaining({timeoutMs, cancelMessage: expect.objectContaining({type: 'VIDEO_AI_CANCEL'})}));
    });
    it('cache prepare does not require stream/generation', async () => {
        const {handlers, storage} = setup();
        const result = await find(handlers, 'fluentReadPrepareLocalVideoModel').handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: false}, context(1));
        expect(result.success).toBe(true);
        expect(storage.set).toHaveBeenCalledTimes(1);
    });
    it('returns normalized downloaded model state through a background-only query', async () => {
        const {handlers} = setup();
        const result = await find(handlers, 'fluentReadGetLocalVideoModelState').handle({type: 'fluentReadGetLocalVideoModelState'}, context(1));
        expect(result).toEqual({success: true, models: [], available: {tiny: false, base: false, small: false}});
    });
    it('filters a missing model file from availability while keeping its receipt and avoiding Offscreen or network', async () => {
        const {urls} = installModelKeys(['tiny', 'base', 'small']);
        urls.delete(getVideoAiModelFileUrl('tiny', 'tokenizer.json'));
        const {handlers, offscreen, storage} = setup();
        storage.get.mockResolvedValue({fluentReadVideoLocalTranscriptionModels: ['tiny', 'base', 'small']});
        const fetcher = vi.fn(), worker = vi.fn(); vi.stubGlobal('fetch', fetcher); vi.stubGlobal('Worker', worker);
        await expect(find(handlers, 'fluentReadGetLocalVideoModelState').handle({}, context(1))).resolves.toEqual({success: true, models: ['base', 'small'], available: {tiny: false, base: true, small: true}});
        expect(storage.set).not.toHaveBeenCalled(); expect(offscreen.send).not.toHaveBeenCalled(); expect(offscreen.ensureDocument).not.toHaveBeenCalled();
        expect(fetcher).not.toHaveBeenCalled(); expect(worker).not.toHaveBeenCalled();
    });
    it('propagates cache-read failure without deleting download receipts or starting Offscreen', async () => {
        const {handlers, offscreen, storage} = setup();
        storage.get.mockResolvedValue({fluentReadVideoLocalTranscriptionModels: ['tiny']});
        vi.stubGlobal('caches', {has: async () => {throw new Error('storage failed');}});
        await expect(find(handlers, 'fluentReadGetLocalVideoModelState').handle({}, context(1))).rejects.toThrow('无法读取模型缓存');
        expect(storage.set).not.toHaveBeenCalled(); expect(offscreen.send).not.toHaveBeenCalled();
    });
    it('does not erase a later successful download receipt while an older cache-key read is pending', async () => {
        const {keys} = installModelKeys(['base']);
        let resolveKeys!: (keys: Request[]) => void;
        keys.mockReturnValueOnce(new Promise(resolve => {resolveKeys = resolve;}));
        const state: Record<string, unknown> = {fluentReadVideoLocalTranscriptionModels: ['tiny']};
        const {offscreen} = setup();
        const storage = {get: async () => ({...state}), set: vi.fn(async (next: Record<string, unknown>) => {Object.assign(state, next);})};
        const handlers = createVideoSubtitleBackgroundHandlers({offscreen: offscreen as any, storage});
        const status = find(handlers, 'fluentReadGetLocalVideoModelState');
        const older = status.handle({}, context(1));
        for (let n = 0; n < 8; n++) await Promise.resolve();
        await find(handlers, 'fluentReadPrepareLocalVideoModel').handle({model: 'base'}, context(1));
        resolveKeys([]); await expect(older).resolves.toMatchObject({models: []});
        expect(state.fluentReadVideoLocalTranscriptionModels).toEqual(['tiny', 'base']);
        expect(storage.set).toHaveBeenCalledOnce();
        await expect(status.handle({}, context(1))).resolves.toMatchObject({models: ['base']});
    });

    it('serializes concurrent cache writes so Tiny and Base state are merged', async () => {
        const stored: Record<string, unknown> = {fluentReadVideoLocalTranscriptionModels: []};
        const offscreen = {
            send: vi.fn(async () => ({success: true})),
            sendIfPresent: vi.fn(async () => ({success: true})),
        } as any;
        const storage = {
            get: vi.fn(async () => ({...stored})),
            set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(stored, value); }),
        };
        const handlers = createVideoSubtitleBackgroundHandlers({offscreen, storage});
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        const [tiny, base, small] = await Promise.all([
            prepare.handle({model: 'tiny'}, context(1)),
            prepare.handle({model: 'base'}, context(1)),
            prepare.handle({model: 'small'}, context(1)),
        ]);
        expect(tiny.models).toEqual(['tiny']);
        expect(base.models).toEqual(['tiny', 'base']);
        expect(small.models).toEqual(['tiny', 'base', 'small']);
        expect(stored.fluentReadVideoLocalTranscriptionModels).toEqual(['tiny', 'base', 'small']);
    });
    it.each(['tiny', 'small'])('does not mark failed %s prepare as downloaded', async model => {
        const {handlers, storage} = setup({success: false, error: 'failed'});
        const result = await find(handlers, 'fluentReadPrepareLocalVideoModel').handle({type: 'fluentReadPrepareLocalVideoModel', model}, context(1));
        expect(result.success).toBe(false);
        expect(storage.set).not.toHaveBeenCalled();
    });
    it('Small prepares use ten minutes, expose availability, and delete only their state receipt', async () => {
        installModelKeys(['tiny', 'base', 'small']);
        const state: Record<string, unknown> = {fluentReadVideoLocalTranscriptionModels: ['tiny', 'base']};
        const {offscreen} = setup();
        const storage = {get: async () => ({...state}), set: async (value: Record<string, unknown>) => {Object.assign(state, value);}};
        const handlers = createVideoSubtitleBackgroundHandlers({offscreen: offscreen as any, storage});
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        await prepare.handle({model: 'small'}, context(1));
        expect(offscreen.send).toHaveBeenLastCalledWith(expect.objectContaining({model: 'small', keepWarm: false}), {timeoutMs: 630_000});
        await expect(find(handlers, 'fluentReadGetLocalVideoModelState').handle({}, context(1))).resolves.toMatchObject({available: {tiny: true, base: true, small: true}});
        await prepare.handle({model: 'small', keepWarm: true, streamId: 'small-owner', generation: 1}, context(1));
        expect(offscreen.send).toHaveBeenLastCalledWith(expect.objectContaining({model: 'small', keepWarm: true}), expect.objectContaining({timeoutMs: 600_000}));
        await find(handlers, 'fluentReadCancelLocalVideoTranscription').handle({streamId: 'small-owner', generation: 1}, context(1));
        await expect(find(handlers, 'fluentReadRemoveLocalVideoModel').handle({model: 'small'})).resolves.toMatchObject({models: ['tiny', 'base']});
        expect(offscreen.send).toHaveBeenLastCalledWith({type: 'VIDEO_AI_REMOVE_MODEL', model: 'small'}, {timeoutMs: 30_000});
    });
    it('rejects another tab while an owner is warm', async () => {
        const {handlers} = setup();
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        await prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's', generation: 1}, context(1));
        await expect(prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's2', generation: 1}, context(2))).rejects.toThrow('另一个标签页');
    });
    it('cancellation uses sendIfPresent and releases the matching generation', async () => {
        const {handlers, offscreen} = setup();
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        const cancel = find(handlers, 'fluentReadCancelLocalVideoTranscription');
        await prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's', generation: 1}, context(1));
        await cancel.handle({type: 'fluentReadCancelLocalVideoTranscription', streamId: 's', generation: 1}, context(1));
        expect(offscreen.sendIfPresent).toHaveBeenCalled();
    });
    it('tab release cancels the owner and allows another tab to acquire it', async () => {
        const {handlers, offscreen} = setup();
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        await prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's', generation: 1}, context(1));
        releaseVideoSubtitleOwnerForTab(1);
        await expect(prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's2', generation: 1}, context(2))).resolves.toMatchObject({success: true});
        expect(offscreen.sendIfPresent).toHaveBeenCalled();
    });
    it('rejects malformed warm and cancel messages', async () => {
        const {handlers} = setup();
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        const cancel = find(handlers, 'fluentReadCancelLocalVideoTranscription');
        await expect(prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true}, context(1))).rejects.toThrow('缺少流标识');
        await expect(cancel.handle({type: 'fluentReadCancelLocalVideoTranscription', streamId: '', generation: 1}, context(1))).rejects.toThrow('缺少流标识');
    });
    it('forwards successful transcription and cancels the previous generation', async () => {
        const {handlers, offscreen} = setup({success: true, text: 'ok', segments: []});
        const transcribe = find(handlers, 'fluentReadTranscribeLocalVideoAudio');
        const first = await transcribe.handle({type: 'fluentReadTranscribeLocalVideoAudio', streamId: 's', generation: 1, audioPcm16Base64: 'AAAAAA=='}, context(1));
        expect(first).toMatchObject({success: true, text: 'ok'});
        const second = await transcribe.handle({type: 'fluentReadTranscribeLocalVideoAudio', streamId: 's', generation: 2, audioPcm16Base64: 'AAAAAA=='}, context(1));
        expect(second.success).toBe(true);
        expect(offscreen.sendIfPresent).toHaveBeenCalled();
    });
    it('rejects cancelled and conflicting generations without touching Offscreen', async () => {
        const {handlers, offscreen} = setup();
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        const cancel = find(handlers, 'fluentReadCancelLocalVideoTranscription');
        await prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's', generation: 1}, context(1));
        await cancel.handle({type: 'fluentReadCancelLocalVideoTranscription', streamId: 's', generation: 1}, context(1));
        const calls = offscreen.sendIfPresent.mock.calls.length;
        await expect(prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's', generation: 1}, context(1))).rejects.toThrow('已取消');
        await expect(prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 'other', generation: 1}, context(2))).resolves.toMatchObject({success: true});
        releaseVideoSubtitleOwnerForTab(999);
        expect(offscreen.sendIfPresent.mock.calls.length).toBeGreaterThanOrEqual(calls);
    });
    it('ignores a stale cancel so it cannot terminate a newer generation', async () => {
        const {handlers, offscreen} = setup();
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        const cancel = find(handlers, 'fluentReadCancelLocalVideoTranscription');
        await prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's', generation: 2}, context(1));
        offscreen.sendIfPresent.mockClear();
        const result = await cancel.handle({type: 'fluentReadCancelLocalVideoTranscription', streamId: 's', generation: 1}, context(1));
        expect(result).toMatchObject({success: true, stale: true});
        expect(offscreen.sendIfPresent).not.toHaveBeenCalled();
        await cancel.handle({type: 'fluentReadCancelLocalVideoTranscription', streamId: 's', generation: 2}, context(1));
    });
});

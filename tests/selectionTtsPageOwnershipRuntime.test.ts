/**
 * Public runtime-listener -> router -> selection TTS handler -> actual strategy
 * synthesizer coverage for extension-page request ownership. Only synthesis and
 * playback adapters are controlled; no private Map/helper/export is inspected.
 * Providers deliberately ignore abort so delayed resolve/reject ordering can be
 * exercised through ordinary runtime messages. Default imports use real src.
 */
import {randomUUID} from 'node:crypto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    createBackgroundMessageRouter,
    createBackgroundRuntimeMessageListener,
} from '@/src/services/messaging/backgroundRouter';
import {
    createSelectionTtsBackgroundHandlers,
    SELECTION_TTS_GOOGLE_MESSAGE_TYPE,
    SELECTION_TTS_MESSAGE_TYPE,
    SELECTION_TTS_STOP_MESSAGE_TYPE,
    type SelectionTtsContext,
} from '@/src/features/selection-translation/background/ttsHandler';
import {createSelectionTtsSynthesizer} from '@/src/features/selection-translation/background/selectionTtsSynthesis';
import type {LocalTtsAudio} from '@/src/features/local-tts/protocol';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}

const audio = (): LocalTtsAudio => ({
    audio: new Uint8Array([1, 2]).buffer,
    contentType: 'audio/wav', voice: 'af_heart', backend: 'wasm',
});
const page = () => ({url: 'chrome-extension://controlled-extension/options.html#settings-vocabulary'});
const pageAudio = {
    success: true, transport: 'page', audioBase64: 'AQI=', contentType: 'audio/wav', voice: 'af_heart',
};
const cancelled = {success: false, error: '语音合成已取消'};
async function flush() {for (let i = 0; i < 24; i++) await Promise.resolve();}

function createRuntime() {
    const jobs: Array<{
        text: string;
        signal?: AbortSignal;
        abortEvents: number;
        settled: boolean;
        task: ReturnType<typeof deferred<LocalTtsAudio>>;
    }> = [];
    const responses: Promise<unknown>[] = [];
    let abortListeners = 0;
    const local = vi.fn((text: string, _language: string, _voice: string, signal?: AbortSignal) => {
        const job = {text, signal, abortEvents: 0, settled: false, task: deferred<LocalTtsAudio>()};
        jobs.push(job);
        const onAbort = () => {job.abortEvents++;};
        if (signal) {signal.addEventListener('abort', onAbort); abortListeners++;}
        // No AbortSignal rejection here: the public handler must reject stale
        // successes, and its catch path must not release replacement ownership.
        return job.task.promise.finally(() => {
            job.settled = true;
            if (signal) {signal.removeEventListener('abort', onAbort); abortListeners--;}
        });
    });
    const online = vi.fn(async (): Promise<never> => {throw new Error('Unexpected online fallback');});
    const synthesize = createSelectionTtsSynthesizer({
        getMode: () => 'local-only', getLocalVoice: () => 'af_heart', getOnlineVoices: () => [],
        synthesizeLocal: local, synthesizeOnline: online,
    });
    const play = vi.fn(async () => {}), stop = vi.fn(async () => {}), notify = vi.fn(async () => {});
    const handlers = createSelectionTtsBackgroundHandlers({
        getPreferredVoices: () => [], synthesize,
        playWithOffscreen: play, stopWithOffscreen: stop, seekWithOffscreen: async () => {throw Error('Unexpected seek in page ownership fixture');}, sendTabMessage: notify,
    });
    const router = createBackgroundMessageRouter<SelectionTtsContext>(handlers);
    // Same sender passthrough as the production background composition root.
    const listener = createBackgroundRuntimeMessageListener(router,
        sender => ({sender: sender as SelectionTtsContext['sender']}));
    function send(message: unknown, sender: unknown): Promise<unknown> {
        const response = listener(message, sender); responses.push(response); return response;
    }
    const start = (sender: unknown, id: unknown, text = 'art') =>
        send({type: SELECTION_TTS_MESSAGE_TYPE, text, language: 'en-US', clientRequestId: id}, sender);
    const stopPage = (sender: unknown, id?: unknown) =>
        send({type: SELECTION_TTS_STOP_MESSAGE_TYPE, clientRequestId: id}, sender);
    const subject = {jobs, local, online, play, stop, notify, send, start, stopPage,
        async cleanup() {
            await flush();
            for (const job of jobs) job.task.resolve(audio());
            await Promise.all(responses);
            expect(jobs.every(job => job.settled)).toBe(true);
            expect(abortListeners).toBe(0);
            expect(online).not.toHaveBeenCalled();
        }};
    runtimes.push(subject);
    return subject;
}

const runtimes: Array<{cleanup(): Promise<void>}> = [];
afterEach(async () => {
    for (const rt of runtimes.splice(0)) await rt.cleanup();
    vi.restoreAllMocks();
});

describe('extension-page TTS ownership at the public handler/router boundary', () => {
    it.each([
        {name: 'missing sender', sender: undefined},
        {name: 'missing url', sender: {}},
        {name: 'null url', sender: {url: null}},
        {name: 'numeric url', sender: {url: 7}},
        {name: 'empty url', sender: {url: ''}},
        {name: 'relative url', sender: {url: '/options.html'}},
        {name: 'malformed absolute url', sender: {url: 'https://['}},
    ])('keeps legacy unowned page audio and no-op STOP for $name', async ({sender}) => {
        const rt = createRuntime(), id = randomUUID();
        const response = rt.start(sender, id); await flush();
        expect(rt.jobs).toHaveLength(1); expect(rt.jobs[0].signal).toBeUndefined();
        await expect(rt.stopPage(sender, id)).resolves.toEqual({success: true});
        // No owner means the legacy STOP does not parse a supplied invalid ID.
        await expect(rt.stopPage(sender, ' ')).resolves.toEqual({success: true});
        await expect(rt.send({type: SELECTION_TTS_GOOGLE_MESSAGE_TYPE, text: 'art', clientRequestId: id}, sender))
            .resolves.toEqual({success: false, error: '无法确定当前标签页'});
        rt.jobs[0].task.resolve(audio());
        await expect(response).resolves.toEqual(pageAudio);
        expect(rt.jobs[0].abortEvents).toBe(0);
        expect(rt.play).not.toHaveBeenCalled(); expect(rt.stop).not.toHaveBeenCalled();
        expect(rt.notify).not.toHaveBeenCalled();
    });

    it.each(['reject', 'resolve'] as const)(
        'keeps replacement ownership when the aborted old adapter finishes with %s', async outcome => {
            const rt = createRuntime(), sender = page(), id = randomUUID();
            const old = rt.start(sender, id, 'old'); await flush();
            const replacementSender = {...sender, url: 'chrome-extension://controlled-extension/options.html#settings-history'};
            const next = rt.start(replacementSender, id, 'replacement'); await flush();
            expect(rt.jobs.map(job => job.text)).toEqual(['old', 'replacement']);
            const [previous, current] = rt.jobs;
            expect(previous.signal).toBeInstanceOf(AbortSignal); expect(current.signal).toBeInstanceOf(AbortSignal);
            expect(previous.signal?.aborted).toBe(true); expect(previous.abortEvents).toBe(1);
            expect(current.signal?.aborted).toBe(false); expect(current.signal).not.toBe(previous.signal);
            if (outcome === 'reject') previous.task.reject(new Error('old adapter rejected'));
            else previous.task.resolve(audio());
            await expect(old).resolves.toMatchObject(outcome === 'reject'
                ? {success: false, error: 'old adapter rejected'} : cancelled);
            expect(previous.settled).toBe(true); expect(current.signal?.aborted).toBe(false);
            // The old provider's finally and old handler's catch/success ran.
            // Public STOP must still find, abort and release the NEW request.
            await expect(rt.stopPage(sender, id)).resolves.toEqual({success: true});
            expect(current.signal?.aborted).toBe(true); expect(current.abortEvents).toBe(1);
            current.task.resolve(audio()); await expect(next).resolves.toEqual(cancelled);
            expect(rt.play).not.toHaveBeenCalled(); expect(rt.stop).not.toHaveBeenCalled();
        });

    it('replaces before provider entry without stale preflight releasing the new UUID', async () => {
        const rt = createRuntime(), sender = page(), id = randomUUID();
        const old = rt.start(sender, id, 'preflight old');
        const next = rt.start(sender, id, 'preflight replacement');
        await expect(old).resolves.toEqual(cancelled); await flush();
        expect(rt.jobs.map(job => job.text)).toEqual(['preflight replacement']);
        expect(rt.jobs[0].signal).toBeInstanceOf(AbortSignal); expect(rt.jobs[0].signal?.aborted).toBe(false);
        await rt.stopPage(sender, id); expect(rt.jobs[0].signal?.aborted).toBe(true);
        rt.jobs[0].task.resolve(audio()); await expect(next).resolves.toEqual(cancelled);
        expect(rt.local).toHaveBeenCalledOnce(); expect(rt.play).not.toHaveBeenCalled();
    });

    it.each([
        {name: 'query', url: 'chrome-extension://controlled-extension/options.html?view=other'},
        {name: 'path', url: 'chrome-extension://controlled-extension/other.html'},
        {name: 'extension host', url: 'chrome-extension://other-extension/options.html'},
    ])('isolates active same-UUID requests whose owner differs by $name', async ({url}) => {
        const rt = createRuntime(), first = page(), other = {url}, id = randomUUID();
        const firstResponse = rt.start(first, id, 'first owner'); await flush();
        const otherResponse = rt.start(other, id, 'other owner'); await flush();
        expect(rt.jobs).toHaveLength(2); const [left, right] = rt.jobs;
        expect(left.signal).toBeInstanceOf(AbortSignal); expect(right.signal).toBeInstanceOf(AbortSignal);
        expect(left.signal?.aborted).toBe(false); expect(right.signal?.aborted).toBe(false);
        await rt.stopPage(first, id);
        expect(left.signal?.aborted).toBe(true); expect(right.signal?.aborted).toBe(false);
        left.task.resolve(audio()); await expect(firstResponse).resolves.toEqual(cancelled);
        // Old owner's late cleanup must not remove the different URL's bucket.
        await rt.stopPage(other, id); expect(right.signal?.aborted).toBe(true);
        right.task.resolve(audio()); await expect(otherResponse).resolves.toEqual(cancelled);
        expect(rt.play).not.toHaveBeenCalled(); expect(rt.stop).not.toHaveBeenCalled();
    });

    it('releases successful UUIDs while keeping sibling ownership and permitting UUID reuse', async () => {
        const rt = createRuntime(), sender = page(), firstId = randomUUID(), siblingId = randomUUID();
        const first = rt.start(sender, firstId, 'completed'); await flush();
        const sibling = rt.start(sender, siblingId, 'sibling'); await flush();
        const [completed, other] = rt.jobs;
        completed.task.resolve(audio()); await expect(first).resolves.toEqual(pageAudio);
        await rt.stopPage(sender, firstId);
        expect(completed.signal?.aborted).toBe(false); expect(other.signal?.aborted).toBe(false);
        const reused = rt.start(sender, firstId, 'reused completed id'); await flush();
        expect(completed.signal?.aborted).toBe(false); expect(other.signal?.aborted).toBe(false);
        rt.jobs[2].task.resolve(audio()); await expect(reused).resolves.toEqual(pageAudio);
        await rt.stopPage(sender, siblingId); expect(other.signal?.aborted).toBe(true);
        other.task.resolve(audio()); await expect(sibling).resolves.toEqual(cancelled);
        await rt.stopPage(sender, siblingId); expect(other.abortEvents).toBe(1);
        expect(rt.play).not.toHaveBeenCalled(); expect(rt.stop).not.toHaveBeenCalled();
    });

    it('releases only a currently failing UUID while keeping a same-owner sibling stoppable', async () => {
        const rt = createRuntime(), sender = page(), firstId = randomUUID(), siblingId = randomUUID();
        const failing = rt.start(sender, firstId, 'failure'); await flush();
        const sibling = rt.start(sender, siblingId, 'sibling'); await flush();
        rt.jobs[0].task.reject(new Error('local adapter failed'));
        await expect(failing).resolves.toMatchObject({success: false, error: 'local adapter failed'});
        await rt.stopPage(sender, firstId); expect(rt.jobs[0].signal?.aborted).toBe(false);
        expect(rt.jobs[1].signal?.aborted).toBe(false);
        await rt.stopPage(sender, siblingId); expect(rt.jobs[1].signal?.aborted).toBe(true);
        rt.jobs[1].task.resolve(audio()); await expect(sibling).resolves.toEqual(cancelled);
        const reused = rt.start(sender, firstId, 'after owner emptied'); await flush();
        expect(rt.jobs[2].signal).toBeInstanceOf(AbortSignal); expect(rt.jobs[2].signal?.aborted).toBe(false);
        rt.jobs[2].task.resolve(audio()); await expect(reused).resolves.toEqual(pageAudio);
        expect(rt.play).not.toHaveBeenCalled(); expect(rt.stop).not.toHaveBeenCalled();
    });

    it('keeps a reused UUID registered after a stopped older provider rejects late', async () => {
        const rt = createRuntime(), sender = page(), id = randomUUID();
        const old = rt.start(sender, id, 'stopped old'); await flush();
        await rt.stopPage(sender, id); expect(rt.jobs[0].signal?.aborted).toBe(true);
        const next = rt.start(sender, id, 'reused after STOP'); await flush();
        rt.jobs[0].task.reject(new Error('stopped adapter finally rejected'));
        await expect(old).resolves.toMatchObject({success: false, error: 'stopped adapter finally rejected'});
        expect(rt.jobs[1].signal?.aborted).toBe(false);
        await rt.stopPage(sender, id); expect(rt.jobs[1].signal?.aborted).toBe(true);
        rt.jobs[1].task.resolve(audio()); await expect(next).resolves.toEqual(cancelled);
        expect(rt.play).not.toHaveBeenCalled(); expect(rt.stop).not.toHaveBeenCalled();
    });

    it.each(['reject', 'resolve'] as const)(
        'preserves a sibling when STOP removed the old UUID and its provider finishes with %s', async outcome => {
            const rt = createRuntime(), sender = page(), oldId = randomUUID(), siblingId = randomUUID();
            const old = rt.start(sender, oldId, 'stopped UUID'); await flush();
            const sibling = rt.start(sender, siblingId, 'retained sibling'); await flush();
            await rt.stopPage(sender, oldId); expect(rt.jobs[0].signal?.aborted).toBe(true);
            if (outcome === 'reject') rt.jobs[0].task.reject(new Error('removed UUID rejected'));
            else rt.jobs[0].task.resolve(audio());
            await expect(old).resolves.toMatchObject(outcome === 'reject'
                ? {success: false, error: 'removed UUID rejected'} : cancelled);
            expect(rt.jobs[1].signal?.aborted).toBe(false);
            await rt.stopPage(sender, siblingId); expect(rt.jobs[1].signal?.aborted).toBe(true);
            rt.jobs[1].task.resolve(audio()); await expect(sibling).resolves.toEqual(cancelled);
            expect(rt.play).not.toHaveBeenCalled(); expect(rt.stop).not.toHaveBeenCalled();
        });

    it('does not let an old rejection after replacement success damage a later fresh owner bucket', async () => {
        const rt = createRuntime(), sender = page(), id = randomUUID();
        const old = rt.start(sender, id, 'old pending'); await flush();
        const next = rt.start(sender, id, 'replacement completes'); await flush();
        rt.jobs[1].task.resolve(audio()); await expect(next).resolves.toEqual(pageAudio);
        rt.jobs[0].task.reject(new Error('old rejects after owner emptied'));
        await expect(old).resolves.toMatchObject({success: false, error: 'old rejects after owner emptied'});
        const fresh = rt.start(sender, id, 'fresh bucket'); await flush();
        expect(rt.jobs[1].signal?.aborted).toBe(false);
        await rt.stopPage(sender, id); expect(rt.jobs[2].signal?.aborted).toBe(true);
        rt.jobs[2].task.resolve(audio()); await expect(fresh).resolves.toEqual(cancelled);
        expect(rt.play).not.toHaveBeenCalled(); expect(rt.stop).not.toHaveBeenCalled();
    });

    it('validates owned STOP IDs without affecting the request on missing, unknown or invalid IDs', async () => {
        const rt = createRuntime(), sender = page(), id = randomUUID();
        const response = rt.start(sender, id); await flush();
        await expect(rt.stopPage(sender)).resolves.toEqual({success: true});
        await expect(rt.stopPage(sender, randomUUID())).resolves.toEqual({success: true});
        for (const invalid of [null, ' ', 'x'.repeat(129)]) {
            await expect(rt.stopPage(sender, invalid)).resolves.toMatchObject({
                success: false, error: 'TTS clientRequestId 必须是非空字符串',
            });
            expect(rt.jobs[0].signal?.aborted).toBe(false);
        }
        // Public parsing normalizes the ID before finding the owned request.
        await rt.stopPage(sender, ` ${id} `); expect(rt.jobs[0].signal?.aborted).toBe(true);
        rt.jobs[0].task.resolve(audio()); await expect(response).resolves.toEqual(cancelled);
        expect(rt.play).not.toHaveBeenCalled(); expect(rt.stop).not.toHaveBeenCalled();
    });

    it('rejects malformed START messages before they can replace existing page ownership', async () => {
        const rt = createRuntime(), sender = page(), id = randomUUID();
        const active = rt.start(sender, id); await flush();
        for (const invalid of [undefined, null, ' ', 'x'.repeat(129)]) {
            await expect(rt.start(sender, invalid)).resolves.toMatchObject({
                success: false, error: 'TTS clientRequestId 必须是非空字符串',
            });
            expect(rt.local).toHaveBeenCalledOnce(); expect(rt.jobs[0].signal?.aborted).toBe(false);
        }
        await expect(rt.start(sender, id, ' ')).resolves.toMatchObject({success: false, error: 'TTS 文本为空'});
        expect(rt.local).toHaveBeenCalledOnce(); expect(rt.jobs[0].signal?.aborted).toBe(false);
        await rt.stopPage(sender, id); expect(rt.jobs[0].signal?.aborted).toBe(true);
        rt.jobs[0].task.resolve(audio()); await expect(active).resolves.toEqual(cancelled);
        expect(rt.play).not.toHaveBeenCalled(); expect(rt.stop).not.toHaveBeenCalled();
    });

    it('gives a valid tab route priority over its URL and isolates legacy no-URL synthesis from content', async () => {
        const rt = createRuntime(), sender = page(), id = randomUUID();
        const pageResponse = rt.start(sender, id, 'page'); await flush();
        const content = {...sender, tab: {id: 0}};
        const contentResponse = rt.start(content, id, 'content'); await flush();
        const legacyResponse = rt.start({}, id, 'legacy'); await flush();
        expect(rt.jobs).toHaveLength(3);
        expect(rt.jobs[0].signal).toBeInstanceOf(AbortSignal);
        expect(rt.jobs[1].signal).toBeInstanceOf(AbortSignal); expect(rt.jobs[2].signal).toBeUndefined();
        expect(rt.jobs[0].signal?.aborted).toBe(false); expect(rt.jobs[1].signal?.aborted).toBe(false);
        await rt.stopPage({}, id); expect(rt.jobs[1].signal?.aborted).toBe(false);
        await rt.stopPage({url: 'https://['}, id);
        await expect(rt.send({type: SELECTION_TTS_GOOGLE_MESSAGE_TYPE, text: 'art', clientRequestId: id}, {}))
            .resolves.toEqual({success: false, error: '无法确定当前标签页'});
        expect(rt.jobs[0].signal?.aborted).toBe(false); expect(rt.jobs[1].signal?.aborted).toBe(false);
        await rt.stopPage(sender, id);
        expect(rt.jobs[0].signal?.aborted).toBe(true); expect(rt.jobs[1].signal?.aborted).toBe(false);
        rt.jobs[0].task.resolve(audio()); await expect(pageResponse).resolves.toEqual(cancelled);
        rt.jobs[2].task.resolve(audio()); await expect(legacyResponse).resolves.toEqual(pageAudio);
        rt.jobs[1].task.resolve(audio()); await expect(contentResponse).resolves.toEqual({
            success: true, transport: 'offscreen', voice: 'af_heart',
        });
        expect(rt.play).toHaveBeenCalledOnce();
        expect(rt.play).toHaveBeenCalledWith(expect.objectContaining({tabId: 0, clientRequestId: id}), rt.jobs[1].signal);
        await rt.stopPage(content, id);
        expect(rt.jobs[1].signal?.aborted).toBe(true);
        expect(rt.stop).toHaveBeenCalledOnce();
        expect(rt.stop).toHaveBeenCalledWith(expect.objectContaining({tabId: 0, clientRequestId: id}));
    });
});

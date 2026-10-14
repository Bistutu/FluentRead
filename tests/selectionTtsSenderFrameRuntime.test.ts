/**
 * @file tests/selectionTtsSenderFrameRuntime.test.ts
 * 文件职责：经公开 runtime listener、路由器、TTS handler、adapter 与真实播放器验证发送方和 frame/page 播放归属。
 * 主要内容：受控浏览器发送方、Audio/时钟与传输端口；业务模块使用真实源文件，覆盖恶意状态、跨 frame 控制、worker 重建、迟到播放及旧路由兼容。
 * 模块边界：不读取私有 Map，不执行真实合成、网络或浏览器。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createBackgroundMessageRouter, createBackgroundRuntimeMessageListener} from '@/src/services/messaging/backgroundRouter';
import {createOffscreenMessageListener} from '@/src/app/offscreen/messageRouter';
import {createCapabilityGatedSelectionTtsTransport} from '@/src/app/background/capabilityRegistry';
import {resolveBrowserCapabilities} from '@/src/platform/browser/capabilities';
import {createSelectionTtsClientRequestId, sameSelectionTtsRoute} from '@/src/features/selection-translation/protocol';
import {createSelectionTtsPlayer, type SelectionAudioPort} from '@/src/app/offscreen/ttsPlayback';
import {createSelectionTtsOffscreenAdapter} from '@/src/features/selection-translation/background/offscreenAdapter';
import {createSelectionTtsBackgroundHandlers, type SelectionTtsContext} from '@/src/features/selection-translation/background/ttsHandler';
import {parseSelectionTtsRoute, type SelectionTtsPlaybackRequest} from '@/src/features/selection-translation/protocol';
import {createOffscreenClient, OFFSCREEN_READY_MESSAGE_TYPE, type OffscreenClient, type OffscreenSendOptions} from '@/src/platform/offscreen/client';

vi.mock('@/src/platform/offscreen/extensionClient', () => ({extensionDomClient: {}}));
const extensionId = 'controlled-extension';
const offscreenUrl = `chrome-extension://${extensionId}/offscreen.html`;
const offscreenSender = {id: extensionId, url: offscreenUrl};
const backgroundSender = {id: extensionId};
const owner = (frameId = 3, url = 'https://controlled.example/read#first'): SelectionTtsContext['sender'] =>
    ({id: extensionId, tab: {id: 0}, frameId, url, documentId: `document:${url.split('#')[0]}`});
const audioResult = () => ({audio: new Uint8Array([1, 2]).buffer, contentType: 'audio/wav', voice: 'controlled'});
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}
async function flush() {for (let i = 0; i < 96; i++) await Promise.resolve();}
class AudioPort implements SelectionAudioPort {
    currentTime = 2;
    duration = 12;
    preload = '';
    src = '';
    onended: SelectionAudioPort['onended'] = null;
    onerror: SelectionAudioPort['onerror'] = null;
    pause = vi.fn();
    load = vi.fn();
    removeAttribute = vi.fn((name: string) => {if (name === 'src') this.src = '';});
    constructor(readonly play: () => Promise<void>) {}
}
const disposers: Array<() => void> = [];
afterEach(() => {for (const dispose of disposers.splice(0)) dispose(); vi.restoreAllMocks(); vi.useRealTimers();});

function runtime(nativeRecovery = false) {
    vi.useFakeTimers();
    const audios: AudioPort[] = [];
    const audioPlays: Array<Promise<void>> = [];
    // Delay arrival at the public receiver independently from Audio.play().
    const playDispatches: Array<Promise<void>> = [];
    const traffic: Array<Record<string, unknown>> = [];
    const sendOptions: Array<OffscreenSendOptions | undefined> = [];
    const stageDispatches: Array<{type: string; gate: Promise<void>}> = [];
    const contextQueries: Array<Promise<unknown[]>> = [];
    const plays: SelectionTtsPlaybackRequest[] = [];
    const signals: Array<AbortSignal | undefined> = [];
    const sendTabMessage = vi.fn(async (_tabId: number, _message: unknown, _options?: {frameId: number}) => undefined);
    const synthesize = vi.fn(async (_text: string, _language: string, _voices: unknown, signal?: AbortSignal) => {
        signals.push(signal); return audioResult();
    });
    let dispatch!: ReturnType<typeof createBackgroundRuntimeMessageListener<SelectionTtsContext>>;
    const player = createSelectionTtsPlayer({
        createAudio: () => {const play = audioPlays.shift() ?? Promise.resolve(); const audio = new AudioPort(() => play); audios.push(audio); return audio;},
        decodeBase64: () => new Uint8Array([1, 2]), createObjectUrl: () => `blob:controlled-${audios.length}`, revokeObjectUrl: vi.fn(),
        notifyProgress: (request, progress, position) => {void dispatch({type: 'selectionTtsPlaybackState', ...parseSelectionTtsRoute(request), state: 'progress', progress, position}, offscreenSender);},
        notify: (request, state, error) => {void dispatch({type: 'selectionTtsPlaybackState', ...parseSelectionTtsRoute(request), state, error}, offscreenSender);},
    });
    disposers.push(() => player.dispose());
    const listener = createOffscreenMessageListener({runtimeId: extensionId, ttsPlayer: player,
        translate: async () => {throw new Error('Unexpected translation');}, fetchImage: async () => {throw new Error('Unexpected image fetch');},
        translateImage: async () => {throw new Error('Unexpected image OCR');}, translateArea: async () => {throw new Error('Unexpected area OCR');},
        downloadOcrLanguages: async () => {throw new Error('Unexpected download');}});
    function direct(message: Record<string, unknown>, sender: unknown) {
        return new Promise<any>((resolve, reject) => {
            if (!listener({...message, target: 'offscreen'}, sender, resolve)) reject(new Error('Unexpected unhandled offscreen message'));
        });
    }
    let client = {
        send: async (message: Record<string, unknown>, options?: OffscreenSendOptions) => {
            traffic.push(message); sendOptions.push(options);
            const stage = stageDispatches.findIndex(row => row.type === message.type);
            if (stage >= 0) await stageDispatches.splice(stage, 1)[0].gate;
            if (message.type === 'PLAY_SELECTION_TTS') {
                plays.push(message as unknown as SelectionTtsPlaybackRequest);
                const dispatchGate = playDispatches.shift();
                if (dispatchGate) await dispatchGate;
            }
            return direct(message, backgroundSender);
        },
        sendIfPresent: async (message: Record<string, unknown>) => {traffic.push(message); return direct(message, backgroundSender);},
    } as unknown as OffscreenClient;
    let oldReceiverFailure: (() => void) | undefined;
    const closeDocument = vi.fn(async () => player.dispose());
    if (nativeRecovery) {
        let lastError: {message: string} | undefined;
        let heldOldAttempt = false;
        const nativeRuntime = {
            getContexts: async () => contextQueries.shift() ?? [{}],
            get lastError() {return lastError;},
            sendMessage: (message: unknown, callback: (response: unknown) => void) => {
                const row = message as Record<string, unknown>; traffic.push(row);
                if (row.type === OFFSCREEN_READY_MESSAGE_TYPE) {callback({success: true, ready: true}); return;}
                if (row.type === 'PLAY_SELECTION_TTS') {
                    plays.push(row as unknown as SelectionTtsPlaybackRequest);
                    if (row.clientRequestId === 'native-old' && !heldOldAttempt) {
                        heldOldAttempt = true;
                        oldReceiverFailure = () => {
                            lastError = {message: 'Could not establish connection. Receiving end does not exist.'};
                            callback(undefined); lastError = undefined;
                        };
                        return;
                    }
                }
                if (!listener(row, backgroundSender, callback)) throw new Error('Unexpected native message');
            },
        };
        client = createOffscreenClient({getRuntime: () => nativeRuntime,
            getOffscreen: () => ({createDocument: async () => undefined, closeDocument})});
    }
    const failOldReceiver = () => {
        if (!oldReceiverFailure) throw new Error('Old native PLAY was not pending');
        oldReceiverFailure();
    };
    const adapter = createSelectionTtsOffscreenAdapter(client);
    function restart() {
        const transport = createCapabilityGatedSelectionTtsTransport(
            resolveBrowserCapabilities({browser: 'firefox', manifestVersion: 2}), adapter);
        const handlers = createSelectionTtsBackgroundHandlers({
            playbackStateSender: {runtimeId: extensionId, url: offscreenUrl}, getPreferredVoices: () => [], synthesize,
            playWithOffscreen: transport.play, stopWithOffscreen: transport.stop, seekWithOffscreen: adapter.seek, sendTabMessage,
        });
        dispatch = createBackgroundRuntimeMessageListener(createBackgroundMessageRouter<SelectionTtsContext>(handlers),
            sender => ({sender: sender as SelectionTtsContext['sender']}));
    }
    restart();
    const send = (message: unknown, sender: unknown) => dispatch(message, sender);
    const start = (sender = owner(), clientRequestId = 'shared-id') => send({type: 'selectionTts', text: 'Hello world', clientRequestId}, sender);
    const seek = (sender = owner(), extra = {}) => send({type: 'selectionTtsSeek', clientRequestId: 'shared-id', offsetSeconds: 5, ...extra}, sender);
    const stop = (sender = owner()) => send({type: 'selectionTtsStop', clientRequestId: 'shared-id'}, sender);
    return {audios, audioPlays, playDispatches, stageDispatches, contextQueries, sendOptions, plays, player, traffic, signals, synthesize, sendTabMessage, restart, direct, send, start, seek, stop, failOldReceiver, closeDocument};
}

describe('public TTS sender and frame/page ownership', () => {

    it('cancels through real client preparation while letting B use the shared initial preparation', async () => {
        const rt = runtime(true), query = deferred<unknown[]>(); rt.contextQueries.push(query.promise);
        const old = rt.start(owner(3), 'preparing-old'); await flush();
        expect(rt.plays).toHaveLength(0);
        await rt.send({type: 'selectionTtsStop', clientRequestId: 'preparing-old'}, owner(3));
        expect(rt.signals[0]?.aborted).toBe(true); expect(await old).toMatchObject({success: false});
        const next = rt.start(owner(4), 'prepared-B'); await flush();
        query.resolve([{}]); expect(await next).toMatchObject({success: true, transport: 'offscreen'});
        expect(rt.plays.map(row => row.clientRequestId)).toEqual(['prepared-B']);
        expect(rt.closeDocument).not.toHaveBeenCalled();
        await rt.send({type: 'selectionTtsStop', clientRequestId: 'prepared-B'}, owner(4));
        expect(vi.getTimerCount()).toBe(0);
    });

    it('propagates Google playback cancellation through the capability transport and receiver admission', async () => {
        const rt = runtime(), arrival = deferred<void>(); rt.playDispatches.push(arrival.promise);
        const old = rt.send({type: 'selectionTtsGoogle', text: 'Hello', clientRequestId: 'google-old'}, owner(3));
        await flush(); expect(rt.plays).toHaveLength(1);
        const signal = rt.sendOptions[0]?.signal; expect(signal).toBeInstanceOf(AbortSignal);
        await rt.start(owner(4), 'edge-new'); const current = rt.audios[0];
        expect(signal?.aborted).toBe(true);
        expect(rt.sendOptions.slice(0, 3).every(options => options?.signal === signal)).toBe(true);
        arrival.resolve(); expect(await old).toMatchObject({success: false});
        expect(current.pause).not.toHaveBeenCalled();
        await rt.send({type: 'selectionTtsStop', clientRequestId: 'edge-new'}, owner(4));
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cannot use a permit in a rebuilt receiver or reserve before reading its version', async () => {
        const old = runtime(); await old.start(owner(3), 'old-document'); const oldPlay = old.plays[0];
        await old.send({type: 'selectionTtsStop', clientRequestId: 'old-document'}, owner(3));
        const fresh = runtime();
        expect(await fresh.direct({type: 'RESERVE_SELECTION_TTS', tabId: 0, clientRequestId: 'early', expectedRevision: 'old'}, backgroundSender))
            .toEqual({success: false, conflict: true});
        await fresh.start(owner(4), 'fresh-document'); const current = fresh.audios[0];
        expect(await fresh.direct({type: 'PLAY_SELECTION_TTS', ...oldPlay}, backgroundSender)).toMatchObject({success: false});
        expect(current.pause).not.toHaveBeenCalled();
        await fresh.send({type: 'selectionTtsStop', clientRequestId: 'fresh-document'}, owner(4));
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['synthesis', 'audio-play'] as const)('honors old Firefox SPA STOP while %s is pending', async stage => {
        const rt = runtime(), gate = deferred<void>();
        const before = {id: extensionId, tab: {id: 0}, frameId: 0, url: 'https://controlled.example/read'};
        const after = {...before, url: 'https://controlled.example/chapter?q=2'};
        if (stage === 'audio-play') rt.audioPlays.push(gate.promise);
        else rt.synthesize.mockImplementationOnce(async (_text, _language, _voices, signal) => {
            rt.signals.push(signal); await gate.promise; return audioResult();
        });
        const pending = rt.start(before); await flush(); await rt.stop(after);
        expect(rt.signals[0]?.aborted).toBe(true); gate.resolve();
        expect(await pending).toMatchObject({success: false});
        if (stage === 'synthesis') expect(rt.audios).toHaveLength(0);
        else expect(rt.audios[0].pause).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels a forced rebuild before its delayed context query can close B, and lets the same client serve B', async () => {
        vi.useFakeTimers();
        const controller = new AbortController(), contexts = deferred<unknown[]>();
        const closeDocument = vi.fn(async () => undefined), createDocument = vi.fn(async () => undefined);
        let reads = 0, lastError: {message: string} | undefined;
        const attempts: string[] = [];
        const nativeRuntime = {
            getContexts: async () => ++reads === 2 ? contexts.promise : [{}],
            get lastError() {return lastError;},
            sendMessage: (message: unknown, callback: (response: unknown) => void) => {
                const row = message as {type: string};
                if (row.type === OFFSCREEN_READY_MESSAGE_TYPE) {callback({success: true, ready: true}); return;}
                attempts.push(row.type);
                if (row.type === 'OLD_PLAY') {
                    lastError = {message: 'Could not establish connection. Receiving end does not exist.'};
                    callback(undefined); lastError = undefined; return;
                }
                callback({success: true});
            },
        };
        const client = createOffscreenClient({getRuntime: () => nativeRuntime,
            getOffscreen: () => ({closeDocument, createDocument})});
        const pending = client.send({type: 'OLD_PLAY'}, {signal: controller.signal});
        await flush(); expect(reads).toBe(2);
        controller.abort(); await expect(pending).rejects.toMatchObject({name: 'AbortError'}); await flush();
        await expect(client.send({type: 'B_PLAY'})).resolves.toEqual({success: true});
        contexts.resolve([{}]); await flush();
        expect(attempts).toEqual(['OLD_PLAY', 'B_PLAY']);
        expect(closeDocument).not.toHaveBeenCalled(); expect(createDocument).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not recreate or retry a cancelled request after an already-issued close finishes', async () => {
        vi.useFakeTimers();
        const controller = new AbortController(), closing = deferred<void>();
        const createDocument = vi.fn(async () => undefined), closeDocument = vi.fn(() => closing.promise);
        let lastError: {message: string} | undefined;
        const nativeRuntime = {
            getContexts: async () => [{}],
            get lastError() {return lastError;},
            sendMessage: (message: unknown, callback: (response: unknown) => void) => {
                if ((message as {type: string}).type === OFFSCREEN_READY_MESSAGE_TYPE) {callback({success: true, ready: true}); return;}
                lastError = {message: 'Could not establish connection. Receiving end does not exist.'};
                callback(undefined); lastError = undefined;
            },
        };
        const client = createOffscreenClient({getRuntime: () => nativeRuntime,
            getOffscreen: () => ({closeDocument, createDocument})});
        const pending = client.send({type: 'OLD_PLAY'}, {signal: controller.signal});
        await flush(); expect(closeDocument).toHaveBeenCalledOnce();
        controller.abort(); await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        closing.resolve(); await flush();
        expect(createDocument).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });

    it.each([false, true])('keeps Firefox without documentId SPA control and frame isolation after reconstruction=%s', async reconstruct => {
        const rt = runtime();
        const before = {id: extensionId, tab: {id: 0}, frameId: 0, url: 'https://controlled.example/read?q=1'};
        const after = {...before, url: 'https://controlled.example/chapter?q=2'};
        const id = createSelectionTtsClientRequestId();
        await rt.start(before, id); await flush();
        expect(parseSelectionTtsRoute(rt.plays[0])).toEqual({tabId: 0, frameId: 0, clientRequestId: id});
        if (reconstruct) rt.restart();
        const seek = (sender: unknown, offsetSeconds: number) => rt.send({type: 'selectionTtsSeek', clientRequestId: id, offsetSeconds}, sender);
        expect(await seek({...after, frameId: 1}, 5)).toEqual({success: false});
        await rt.send({type: 'selectionTtsStop', clientRequestId: id}, {...after, frameId: 1});
        expect(rt.audios[0].pause).not.toHaveBeenCalled();
        expect(await seek(after, 5)).toEqual({success: true}); expect(rt.audios[0].currentTime).toBe(7);
        expect(await seek(after, -5)).toEqual({success: true}); expect(rt.audios[0].currentTime).toBe(2);
        expect(await seek(after, 15)).toMatchObject({success: false});
        await rt.send({type: 'selectionTtsStop', clientRequestId: id}, after);
        expect(rt.audios[0].pause).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    });

    it('uses documentId to reject same-frame same-URL same-UUID controls from another document', async () => {
        const rt = runtime(), before = {...owner(0), documentId: 'document-A'}, other = {...before, documentId: 'document-B'};
        await rt.start(before); rt.restart();
        expect(await rt.seek(other)).toEqual({success: false}); await rt.stop(other);
        expect(await rt.seek({...other, documentId: undefined})).toEqual({success: false});
        await rt.stop({...other, documentId: undefined});
        expect(rt.audios[0].pause).not.toHaveBeenCalled();
        expect(await rt.seek({...before, url: 'https://controlled.example/changed?q=9'})).toEqual({success: true});
        await rt.stop(before); expect(vi.getTimerCount()).toBe(0);
    });

    it('documents the old Firefox fallback: fresh UUID isolates navigation, deliberately reusing it cannot prove document identity', async () => {
        const rt = runtime();
        const before = {id: extensionId, tab: {id: 0}, frameId: 0, url: 'https://controlled.example/read'};
        const next = {...before, url: 'https://controlled.example/other'};
        const first = createSelectionTtsClientRequestId(), second = createSelectionTtsClientRequestId();
        expect(second).not.toBe(first);
        await rt.start(before, first); rt.restart();
        expect(await rt.send({type: 'selectionTtsSeek', clientRequestId: second, offsetSeconds: 5}, next)).toEqual({success: false});
        await rt.send({type: 'selectionTtsStop', clientRequestId: second}, next);
        expect(rt.audios[0].pause).not.toHaveBeenCalled();
        // This successful control is the explicit fallback limit, not a document-isolation claim.
        expect(await rt.send({type: 'selectionTtsSeek', clientRequestId: first, offsetSeconds: 5}, next)).toEqual({success: true});
        await rt.send({type: 'selectionTtsStop', clientRequestId: first}, next); expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['READ_SELECTION_TTS_REVISION', 'RESERVE_SELECTION_TTS'])('does not send PLAY after cancellation while %s delivery is pending', async type => {
        const rt = runtime(), gate = deferred<void>(); rt.stageDispatches.push({type, gate: gate.promise});
        const old = rt.start(owner(3), 'cancelled-stage'); await flush();
        await rt.send({type: 'selectionTtsStop', clientRequestId: 'cancelled-stage'}, owner(3));
        const signal = rt.signals[0]; expect(signal?.aborted).toBe(true);
        gate.resolve(); await expect(old).resolves.toMatchObject({success: false});
        expect(rt.plays).toHaveLength(0); expect(rt.audios).toHaveLength(0);
        expect(rt.sendOptions.every(options => options?.signal === signal)).toBe(true);
        expect(rt.traffic.every(row => !Object.hasOwn(row, 'signal'))).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not let a delayed pre-STOP reservation overwrite B even after B consumed its permit', async () => {
        const rt = runtime(), gate = deferred<void>(); rt.stageDispatches.push({type: 'RESERVE_SELECTION_TTS', gate: gate.promise});
        const old = rt.start(owner(3), 'old-reserve'); await flush();
        await rt.start(owner(4), 'new-reserve'); const current = rt.audios[0];
        gate.resolve(); await expect(old).resolves.toMatchObject({success: false});
        expect(rt.audios).toHaveLength(1); expect(current.pause).not.toHaveBeenCalled();
        await rt.send({type: 'selectionTtsStop', clientRequestId: 'new-reserve'}, owner(4));
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects replayed consumed PLAY and old permits without needing an evictable cancellation history', async () => {
        const rt = runtime(); await rt.start(owner(3), 'consumed'); const old = rt.plays[0];
        await rt.start(owner(4), 'new-current'); const current = rt.audios[1];
        // Arbitrarily many unknown STOPs may advance the version; no old permit becomes valid again.
        for (let i = 0; i < 300; i++) await rt.direct({type: 'STOP_SELECTION_TTS', tabId: 0, frameId: 9, clientRequestId: `irrelevant-${i}`}, backgroundSender);
        await expect(rt.direct({type: 'PLAY_SELECTION_TTS', ...old}, backgroundSender)).resolves.toMatchObject({success: false});
        expect(rt.audios).toHaveLength(2); expect(current.pause).not.toHaveBeenCalled();
        expect(await rt.send({type: 'selectionTtsSeek', clientRequestId: 'new-current', offsetSeconds: 5}, owner(4))).toEqual({success: true});
        await rt.send({type: 'selectionTtsStop', clientRequestId: 'new-current'}, owner(4)); expect(vi.getTimerCount()).toBe(0);
    });

    it('requires a permit at the public receiver, rejects mismatched routes and keeps B pending through late STOP(A)', async () => {
        const rt = runtime(); const route = {tabId: 0, frameId: 4, documentId: 'doc-B', clientRequestId: 'reserved-B'};
        const read = await rt.direct({type: 'READ_SELECTION_TTS_REVISION'}, backgroundSender);
        expect(await rt.direct({type: 'RESERVE_SELECTION_TTS', ...route, expectedRevision: 'stale'}, backgroundSender)).toEqual({success: false, conflict: true});
        const permit = await rt.direct({type: 'RESERVE_SELECTION_TTS', ...route, expectedRevision: read.revision}, backgroundSender);
        const play = {type: 'PLAY_SELECTION_TTS', ...route, sourceUrl: 'https://controlled.example/audio', playbackToken: permit.playbackToken};
        for (const extra of [{playbackToken: undefined}, {playbackToken: 'wrong'}, {frameId: 5}, {documentId: 'doc-A'}, {clientRequestId: 'other'}]) {
            expect(await rt.direct({...play, ...extra}, backgroundSender)).toMatchObject({success: false});
        }
        await rt.direct({type: 'STOP_SELECTION_TTS', tabId: 0, frameId: 3, clientRequestId: 'old-A'}, backgroundSender);
        expect(await rt.direct(play, backgroundSender)).toEqual({success: true});
        expect(await rt.direct(play, backgroundSender)).toMatchObject({success: false});
        expect(rt.audios).toHaveLength(1); expect(rt.audios[0].pause).not.toHaveBeenCalled();
        await rt.direct({type: 'STOP_SELECTION_TTS', ...route}, backgroundSender); expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves sender documentId and ignores a forged payload documentId', async () => {
        const rt = runtime();
        await rt.send({type: 'selectionTts', text: 'Hello', clientRequestId: 'shared-id', documentId: 'forged'}, {...owner(), documentId: 'real-doc'});
        expect(rt.plays[0].documentId).toBe('real-doc');
        expect(await rt.seek({...owner(), documentId: 'forged'}, {documentId: 'real-doc'})).toEqual({success: false});
        await rt.stop({...owner(), documentId: 'real-doc'});
        expect(sameSelectionTtsRoute({tabId: 0, clientRequestId: 'x', documentId: 'd', ownerUrl: 'https://a.test/'},
            {tabId: 0, clientRequestId: 'x', documentId: 'd', ownerUrl: 'https://b.test/'})).toBe(true);
        for (const documentId of [null, 7, '', ' ', 'x'.repeat(129)]) {
            expect(() => parseSelectionTtsRoute({tabId: 0, clientRequestId: 'x', documentId})).toThrow();
        }
        expect(vi.getTimerCount()).toBe(0);
    });


    it('does not rebuild away replacement audio for a cancelled PLAY whose native missing-receiver callback arrives late', async () => {
        const rt = runtime(true);
        const old = rt.start(owner(3), 'native-old'); await flush();
        expect(rt.plays).toHaveLength(1); expect(rt.audios).toHaveLength(0);
        await expect(rt.start(owner(4), 'native-replacement')).resolves.toMatchObject({success: true, transport: 'offscreen'});
        const current = rt.audios[0];
        expect(rt.signals[0]?.aborted).toBe(true);
        expect(rt.closeDocument).not.toHaveBeenCalled();
        rt.failOldReceiver();
        await expect(old).resolves.toMatchObject({success: false}); await flush();
        expect(rt.closeDocument).not.toHaveBeenCalled();
        expect(current.pause).not.toHaveBeenCalled();
        await rt.send({type: 'selectionTtsStop', clientRequestId: 'native-replacement'}, owner(4));
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([false, true])('keeps same-document SPA seek and stop working after worker reconstruction=%s', async reconstruct => {
        const rt = runtime();
        // A real same-document navigation retains documentId and the content UUID.
        const before = {...owner(3, 'https://controlled.example/read?q=1'), documentId: 'same-document'};
        const after = {...before, url: 'https://controlled.example/chapter?q=2'};
        await rt.start(before); await flush();
        const current = rt.audios[0];
        if (reconstruct) rt.restart();
        expect(await rt.seek(after)).toEqual({success: true});
        expect(current.currentTime).toBe(7);
        await rt.stop(after);
        expect(current.pause).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([false, true])('honors SPA stop during synthesis and pending PLAY, playbackStarted=%s', async playbackStarted => {
        const rt = runtime(), gate = deferred<void>();
        const before = {...owner(3, 'https://controlled.example/read?q=1'), documentId: 'same-document'};
        const after = {...before, url: 'https://controlled.example/chapter?q=2'};
        if (playbackStarted) rt.audioPlays.push(gate.promise);
        else rt.synthesize.mockImplementationOnce(async (_text, _language, _voices, signal) => {
            rt.signals.push(signal); await gate.promise; return audioResult();
        });
        const pending = rt.start(before); await flush();
        await rt.stop(after);
        const cancelled = rt.signals[0]?.aborted;
        gate.resolve();
        const response = await pending; await flush();
        expect(cancelled).toBe(true);
        expect(response).toMatchObject({success: false});
        if (!playbackStarted) expect(rt.audios).toHaveLength(0);
        else expect(rt.audios[0].pause).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not let an old PLAY arriving after its STOP interrupt newer playback', async () => {
        const rt = runtime(), arrival = deferred<void>();
        rt.playDispatches.push(arrival.promise);
        const old = rt.start(owner(3), 'older-id'); await flush();
        expect(rt.plays).toHaveLength(1); expect(rt.audios).toHaveLength(0);
        const replacement = await rt.start(owner(4), 'replacement-id'); await flush();
        expect(replacement).toMatchObject({success: true, transport: 'offscreen'});
        const current = rt.audios[0];
        expect(rt.traffic.filter(row => row.type === 'STOP_SELECTION_TTS')).toContainEqual(
            expect.objectContaining({clientRequestId: 'older-id', frameId: 3}));
        arrival.resolve();
        await expect(old).resolves.toMatchObject({success: false}); await flush();
        expect(current.pause).not.toHaveBeenCalled();
        expect(await rt.send({type: 'selectionTtsSeek', clientRequestId: 'replacement-id', offsetSeconds: 5}, owner(4)))
            .toEqual({success: true});
        await rt.send({type: 'selectionTtsStop', clientRequestId: 'replacement-id'}, owner(4));
        expect(vi.getTimerCount()).toBe(0);
    });
    it.each([
        undefined, {}, {id: 'another-extension', url: offscreenUrl},
        {id: extensionId, url: 'https://controlled.example/'},
        {id: extensionId, url: offscreenUrl, tab: {id: 0}},
    ])('rejects forged progress and terminal states before touching active ownership: %j', async sender => {
        const rt = runtime(); await rt.start(); await flush(); rt.sendTabMessage.mockClear();
        const route = parseSelectionTtsRoute(rt.plays[0]);
        for (const state of ['progress', 'ended', 'error', 'stopped']) {
            await expect(rt.send({type: 'selectionTtsPlaybackState', ...route, state,
                progress: {start: 0, end: 5, fraction: 0.5, estimated: true}, position: {currentTime: 7, duration: 12}}, sender))
                .resolves.toEqual({success: false});
        }
        expect(rt.sendTabMessage).not.toHaveBeenCalled(); expect(rt.signals[0]?.aborted).toBe(false);
        await rt.start(owner(), 'replacement');
        expect(rt.signals[0]?.aborted).toBe(true);
        expect(rt.traffic.filter(row => row.type === 'STOP_SELECTION_TTS')).toContainEqual(expect.objectContaining(route));
    });

    it.each(['READ_SELECTION_TTS_REVISION', 'RESERVE_SELECTION_TTS', 'PLAY_SELECTION_TTS', 'STOP_SELECTION_TTS', 'SEEK_SELECTION_TTS'])('blocks direct content commands at the offscreen %s entry', async type => {
        const rt = runtime(); await rt.start(); await flush();
        const current = rt.audios[0], route = parseSelectionTtsRoute(rt.plays[0]);
        const message = {type, ...route, sourceUrl: 'https://controlled.example/sound', offsetSeconds: 5};
        for (const sender of [undefined, {id: 'other'}, owner()]) {
            await expect(rt.direct(message, sender)).resolves.toMatchObject({success: false});
        }
        expect(rt.audios).toHaveLength(1); expect(current.currentTime).toBe(2); expect(current.pause).not.toHaveBeenCalled();
        expect(await rt.seek()).toEqual({success: true}); expect(current.currentTime).toBe(7);
    });

    it('derives tab/frame/page from real sender, keeps hash cancellation, and ignores forged payload routing', async () => {
        const rt = runtime();
        await rt.send({type: 'selectionTts', text: 'Hello world', clientRequestId: 'shared-id', tabId: 9, frameId: 99, ownerUrl: 'https://evil.example/'}, owner());
        expect(parseSelectionTtsRoute(rt.plays[0])).toEqual({tabId: 0, clientRequestId: 'shared-id', frameId: 3, ownerUrl: 'https://controlled.example/read', documentId: 'document:https://controlled.example/read'});
        expect(await rt.seek(owner(4), {tabId: 0, frameId: 3, ownerUrl: 'https://controlled.example/read'})).toEqual({success: false});
        expect(await rt.seek(owner(3, 'https://controlled.example/read?other=1'))).toEqual({success: false});
        await rt.stop(owner(4)); await rt.stop(owner(3, 'https://controlled.example/another'));
        expect(rt.audios[0].pause).not.toHaveBeenCalled(); expect(rt.signals[0]?.aborted).toBe(false);
        expect(await rt.seek(owner(3, 'https://controlled.example/read#next'))).toEqual({success: true});
        expect(rt.audios[0].currentTime).toBe(7);
        await rt.stop(owner(3, 'https://controlled.example/read#later'));
        expect(rt.signals[0]?.aborted).toBe(true); expect(rt.audios[0].pause).toHaveBeenCalledOnce();
    });

    it('preserves seek/stop ownership and targets progress to the originating frame after worker reconstruction', async () => {
        const rt = runtime(); await rt.start(); await flush(); rt.restart(); rt.sendTabMessage.mockClear();
        expect(await rt.seek(owner(8))).toEqual({success: false}); expect(rt.audios[0].currentTime).toBe(2);
        await rt.stop(owner(8)); expect(rt.audios[0].pause).not.toHaveBeenCalled();
        expect(await rt.seek()).toEqual({success: true}); await flush();
        expect(rt.sendTabMessage).toHaveBeenLastCalledWith(0, expect.objectContaining({clientRequestId: 'shared-id', state: 'progress', position: {currentTime: 7, duration: 12}}), {frameId: 3});
        await rt.seek(); expect(rt.audios[0].currentTime).toBe(12);
        await rt.send({type: 'selectionTtsSeek', clientRequestId: 'shared-id', offsetSeconds: -5}, owner()); expect(rt.audios[0].currentTime).toBe(7);
        await rt.stop(); expect(rt.audios[0].pause).toHaveBeenCalledOnce();
        expect(rt.synthesize).toHaveBeenCalledOnce(); expect(rt.plays).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['resolve', 'reject'] as const)('late old PLAY %s with the same UUID in another frame cannot stop replacement playback', async outcome => {
        const rt = runtime(), oldPlay = deferred<void>(); rt.audioPlays.push(oldPlay.promise);
        const previous = rt.start(owner(3)); await flush(); expect(rt.plays).toHaveLength(1);
        const replacement = await rt.start(owner(4)); expect(replacement).toMatchObject({success: true, transport: 'offscreen'});
        const current = rt.audios[1]; rt.sendTabMessage.mockClear();
        if (outcome === 'resolve') oldPlay.resolve(); else oldPlay.reject(new Error('old play failure'));
        await expect(previous).resolves.toEqual({success: false, error: '语音播放已取消'}); await flush();
        expect(current.pause).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(1);
        expect(await rt.seek(owner(4))).toEqual({success: true}); expect(current.currentTime).toBe(7);
        expect(rt.sendTabMessage).toHaveBeenLastCalledWith(0, expect.objectContaining({state: 'progress'}), {frameId: 4});
        await rt.stop(owner(4)); expect(vi.getTimerCount()).toBe(0);
    });

    it('retains legacy tab-zero routing and rejects invalid seeks before playback mutation', async () => {
        const rt = runtime(), legacy = {tab: {id: 0}}; await rt.start(legacy); await flush();
        expect(parseSelectionTtsRoute(rt.plays[0])).toEqual({tabId: 0, clientRequestId: 'shared-id'});
        await expect(rt.seek(legacy, {offsetSeconds: 15})).resolves.toMatchObject({success: false});
        expect(rt.audios[0].currentTime).toBe(2); expect(await rt.seek(legacy)).toEqual({success: true});
        await rt.stop(legacy); expect(rt.signals[0]?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps no-tab page synthesis isolated, cancels across hash navigation and rejects delayed page success', async () => {
        const rt = runtime(), page = {url: `chrome-extension://${extensionId}/options.html#book`};
        const task = deferred<ReturnType<typeof audioResult>>(); let pageSignal: AbortSignal | undefined;
        rt.synthesize.mockImplementationOnce(async (_text, _language, _voices, signal) => {pageSignal = signal; return task.promise;});
        const pending = rt.start(page); await flush();
        await rt.stop({url: `chrome-extension://${extensionId}/options.html?other=1`}); expect(pageSignal?.aborted).toBe(false);
        await rt.stop({url: `chrome-extension://${extensionId}/options.html#settings`}); expect(pageSignal?.aborted).toBe(true);
        task.resolve(audioResult()); await expect(pending).resolves.toEqual({success: false, error: '语音合成已取消'});
        expect(rt.audios).toHaveLength(0); expect(rt.traffic).toEqual([]);
        await expect(rt.start({})).resolves.toMatchObject({success: true, transport: 'page'});
        expect(rt.signals.at(-1)).toBeUndefined();
    });
});

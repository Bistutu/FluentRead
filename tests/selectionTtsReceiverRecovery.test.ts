/**
 * 接收端实际重建后，仍存活的听读请求必须重新领取当前实例的播放许可。
 * 不读取私有状态、不替换业务方法；仅注入 native runtime/document/Audio 外部端口。
 * READ 后丢接收端是对照；RESERVE 后或 PLAY 投递时丢接收端是 P2 活性候选。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createBackgroundMessageRouter, createBackgroundRuntimeMessageListener} from '@/src/services/messaging/backgroundRouter';
import {createCapabilityGatedSelectionTtsTransport} from '@/src/app/background/capabilityRegistry';
import {resolveBrowserCapabilities} from '@/src/platform/browser/capabilities';
import {createOffscreenClient, type OffscreenRuntimeApi} from '@/src/platform/offscreen/client';
import {createOffscreenMessageListener} from '@/src/app/offscreen/messageRouter';
import {createSelectionTtsPlayer, type SelectionAudioPort} from '@/src/app/offscreen/ttsPlayback';
import {createSelectionTtsOffscreenAdapter} from '@/src/features/selection-translation/background/offscreenAdapter';
import {createSelectionTtsBackgroundHandlers, type SelectionTtsContext} from '@/src/features/selection-translation/background/ttsHandler';
import {parseSelectionTtsRoute} from '@/src/features/selection-translation/protocol';

const disposers: Array<() => void> = [];
afterEach(() => {for (const dispose of disposers.splice(0)) dispose(); vi.restoreAllMocks();});

type LossPoint = 'after-read' | 'after-reserve' | 'at-play';
type Provider = 'google' | 'edge';
type ReceiverResponse = {
    success?: boolean; error?: string; errorCode?: string; receiverId?: string;
    revision?: string; playbackToken?: string; conflict?: boolean;
};
interface RecoveryOptions {
    readonly holdInvalidResponse?: boolean;
    readonly playLosses?: number;
    readonly edgeAudio?: boolean;
    readonly playError?: string;
    readonly queuePlaybackStates?: boolean;
    readonly holdFirstAudioPlay?: boolean;
}

function subject(lossPoint: LossPoint, options: RecoveryOptions = {}) {
    const runtimeId = 'controlled-recovery-extension';
    const offscreenSender = {id: runtimeId, url: `chrome-extension://${runtimeId}/offscreen.html`};
    const sender = {id: runtimeId, tab: {id: 7}, frameId: 0, documentId: 'document-A', url: 'https://controlled.example/read'};
    const traffic: Array<Record<string, unknown>> = [];
    const replies: Array<{message: Record<string, unknown>; response: ReceiverResponse}> = [];
    const audios: SelectionAudioPort[] = [];
    const playedSources: string[] = [];
    const receivers: Array<ReturnType<typeof createOffscreenMessageListener>> = [];
    const queuedStates: Array<() => Promise<unknown>> = [];
    const decodeBase64 = vi.fn((encoded: string) => Uint8Array.from(atob(encoded), char => char.charCodeAt(0)));
    const createObjectUrl = vi.fn((_bytes: Uint8Array, _contentType: string) => 'blob:controlled');
    const revokeObjectUrl = vi.fn();
    const sendTabMessage = vi.fn(async (_tabId: number, _message: unknown, _options?: {frameId: number}) => undefined);
    const synthesize = vi.fn(async (_text: string, _language: string, _voices: unknown, _signal?: AbortSignal) => {
        if (!options.edgeAudio) throw new Error('Google entry must not synthesize');
        return {audio: new Uint8Array([1, 2, 3]).buffer, contentType: 'audio/mpeg', voice: 'controlled-Edge-voice'};
    });
    let present = true;
    let available = true;
    let dropped = false;
    let playLosses = 0;
    let retransmittingPlay = false;
    let releaseHeldResponse: (() => void) | undefined;
    let signalInvalidResponse!: () => void;
    const invalidResponseReady = new Promise<void>(resolve => {signalInvalidResponse = resolve;});
    let runtimeError: {message: string} | undefined;
    let rejectHeldAudioPlay: ((error: Error) => void) | undefined;
    let signalAudioPlayReady!: () => void;
    const audioPlayReady = new Promise<void>(resolve => {signalAudioPlayReady = resolve;});
    let background!: ReturnType<typeof createBackgroundRuntimeMessageListener<SelectionTtsContext>>;
    let player!: ReturnType<typeof createSelectionTtsPlayer>;
    let receiver!: ReturnType<typeof createOffscreenMessageListener>;
    const missing = (callback: (response: unknown) => void) => {
        runtimeError = {message: 'Could not establish connection. Receiving end does not exist.'};
        callback(undefined);
        runtimeError = undefined;
    };
    const installReceiver = () => {
        player = createSelectionTtsPlayer({
            createAudio: () => {
                const audio: SelectionAudioPort = {preload: '', src: '', onended: null, onerror: null,
                    pause: vi.fn(), load: vi.fn(), play: vi.fn(async () => {
                        playedSources.push(audio.src);
                        if (options.holdFirstAudioPlay && audios.length === 1) {
                            await new Promise<void>((_resolve, reject) => {
                                rejectHeldAudioPlay = reject; signalAudioPlayReady();
                            });
                        }
                        if (options.playError) throw new Error(options.playError);
                    }),
                    removeAttribute(name: string) {if (name === 'src') this.src = '';}};
                audios.push(audio); return audio;
            },
            decodeBase64, createObjectUrl, revokeObjectUrl,
            notify: (request, state, error) => {
                const deliver = () => background({type: 'selectionTtsPlaybackState', ...parseSelectionTtsRoute(request), state,
                    ...(error instanceof Error ? {error: error.message} : {})}, offscreenSender);
                if (options.queuePlaybackStates) queuedStates.push(deliver);
                else void deliver();
            },
        });
        const ownedPlayer = player;
        disposers.push(() => ownedPlayer.dispose());
        receiver = createOffscreenMessageListener({runtimeId, ttsPlayer: player,
            translate: async () => {throw new Error('unexpected translation');},
            fetchImage: async () => {throw new Error('unexpected fetch');},
            translateImage: async () => {throw new Error('unexpected OCR');},
            translateArea: async () => {throw new Error('unexpected area');}, downloadOcrLanguages: async () => undefined});
        receivers.push(receiver);
    };
    installReceiver();
    const createDocument = vi.fn(async () => {present = true; available = true; installReceiver();});
    const closeDocument = vi.fn(async () => {player.dispose(); present = false; available = false;});
    const native: OffscreenRuntimeApi = {
        getContexts: async () => present ? [{}] : [],
        get lastError() {return runtimeError;},
        sendMessage(message, callback) {
            const row = message as Record<string, unknown>; traffic.push(row);
            if (!available) {missing(callback); return;}
            // 每轮仅丢首次 PLAY，client 的同消息重发交给实际新 router 拒绝旧 token。
            if (lossPoint === 'at-play' && row.type === 'PLAY_SELECTION_TTS') {
                if (!retransmittingPlay && playLosses < (options.playLosses ?? 1)) {
                    playLosses += 1; retransmittingPlay = true; available = false; missing(callback); return;
                }
                retransmittingPlay = false;
            }
            const handled = receiver(row, {id: runtimeId}, response => {
                const result = response as ReceiverResponse;
                replies.push({message: row, response: result});
                // 只延迟真实 router 已计算的响应；不制造 receiverId/token/errorCode。
                if (options.holdInvalidResponse && result.errorCode === 'selection-tts-permit-invalid') {
                    releaseHeldResponse = () => callback(response);
                    signalInvalidResponse();
                    return;
                }
                // Callback 先返回正常版本/许可，再让接收端在下一阶段之前丢失。
                callback(response);
                if (!dropped && result.success && (
                    (lossPoint === 'after-read' && row.type === 'READ_SELECTION_TTS_REVISION')
                    || (lossPoint === 'after-reserve' && row.type === 'RESERVE_SELECTION_TTS'))) {
                    dropped = true; available = false;
                }
            });
            if (!handled) throw new Error('unexpected message');
        },
    };
    const client = createOffscreenClient({getRuntime: () => native,
        getOffscreen: () => ({createDocument, closeDocument}), readyRetryAttempts: 1});
    const adapter = createSelectionTtsOffscreenAdapter(client);
    const transport = createCapabilityGatedSelectionTtsTransport(
        resolveBrowserCapabilities({browser: 'firefox', manifestVersion: 2}), adapter);
    const handlers = createSelectionTtsBackgroundHandlers({
        playbackStateSender: {runtimeId, url: offscreenSender.url}, getPreferredVoices: () => [], synthesize,
        playWithOffscreen: transport.play, stopWithOffscreen: transport.stop, seekWithOffscreen: adapter.seek,
        sendTabMessage,
    });
    background = createBackgroundRuntimeMessageListener(createBackgroundMessageRouter<SelectionTtsContext>(handlers),
        value => ({sender: value as SelectionTtsContext['sender']}));
    const start = (clientRequestId = 'live-A', provider: Provider = 'google') => background({
        type: provider === 'google' ? 'selectionTtsGoogle' : 'selectionTts',
        text: clientRequestId === 'live-B' ? 'Only B speaks' : 'Hello world', language: 'en-US', clientRequestId}, sender);
    const stop = (clientRequestId = 'live-A') => background({type: 'selectionTtsStop', clientRequestId}, sender);
    const releaseInvalidResponse = () => {
        if (!releaseHeldResponse) throw new Error('No actual receiver response is held');
        const release = releaseHeldResponse; releaseHeldResponse = undefined; release();
    };
    const flushPlaybackStates = async () => {await Promise.all(queuedStates.splice(0).map(deliver => deliver()));};
    return {start, stop, traffic, audios, closeDocument, createDocument, receivers, replies, playedSources,
        synthesize, decodeBase64, createObjectUrl, revokeObjectUrl, sendTabMessage,
        invalidResponseReady, releaseInvalidResponse, flushPlaybackStates, audioPlayReady,
        rejectAudioPlay: () => {
            if (!rejectHeldAudioPlay) throw new Error('No native Audio.play is held');
            const reject = rejectHeldAudioPlay; rejectHeldAudioPlay = undefined;
            reject(new Error('controlled late Audio.play rejection'));
        }};
}

describe('public Google TTS receiver recovery with one loss and no competition', () => {
    it.each(['after-read', 'after-reserve', 'at-play'] as const)(
        'completes a still-live request after loss at %s by acquiring a permit in the current receiver', async point => {
            const rt = subject(point);
            const response = await rt.start();
            expect(response).toMatchObject({success: true, transport: 'offscreen'});
            expect(rt.closeDocument).toHaveBeenCalledOnce();
            expect(rt.createDocument).toHaveBeenCalledOnce();
            expect(rt.audios).toHaveLength(1);
            expect(rt.audios[0].play).toHaveBeenCalledOnce();
            await rt.stop();
            expect(rt.audios[0].pause).toHaveBeenCalledOnce();
        });
});

// 所有许可均由实际安装的 router 签发，仅控制外部端口时序。
const permitTraffic = (rt: ReturnType<typeof subject>) => rt.traffic.filter(row =>
    ['READ_SELECTION_TTS_REVISION', 'RESERVE_SELECTION_TTS', 'PLAY_SELECTION_TTS'].includes(row.type as string));
const oneLossSuccessTrace = [
    'READ_SELECTION_TTS_REVISION', 'RESERVE_SELECTION_TTS', 'PLAY_SELECTION_TTS', 'PLAY_SELECTION_TTS',
    'READ_SELECTION_TTS_REVISION', 'RESERVE_SELECTION_TTS', 'PLAY_SELECTION_TTS',
];

describe('public TTS recovery combined with cancellation, ownership and playback failures', () => {
    it.each([
        {provider: 'google' as const, order: 'before' as const},
        {provider: 'edge' as const, order: 'after' as const},
    ])('STOP cancels $provider $order the replacement rejection callback without reacquiring', async ({provider, order}) => {
        const rt = subject('at-play', {holdInvalidResponse: true, edgeAudio: provider === 'edge'});
        const pending = rt.start('live-A', provider);
        await rt.invalidResponseReady;
        expect(rt.receivers).toHaveLength(2);
        expect(rt.replies.filter(row => row.response.errorCode === 'selection-tts-permit-invalid')).toHaveLength(1);
        // 同一 JS turn 中控制 callback 与公共 STOP 的先后；不靠 sleep/microtask 次数猜时序。
        if (order === 'after') rt.releaseInvalidResponse();
        const stopped = rt.stop();
        if (order === 'before') rt.releaseInvalidResponse();
        expect(await stopped).toEqual({success: true});
        expect(await pending).toEqual({success: false, error: '语音播放已取消'});
        expect(permitTraffic(rt).map(row => row.type)).toEqual([
            'READ_SELECTION_TTS_REVISION', 'RESERVE_SELECTION_TTS', 'PLAY_SELECTION_TTS', 'PLAY_SELECTION_TTS',
        ]);
        expect(rt.closeDocument).toHaveBeenCalledOnce();
        expect(rt.createDocument).toHaveBeenCalledOnce();
        expect(rt.audios).toHaveLength(0);
        expect(rt.playedSources).toEqual([]);
        expect(rt.createObjectUrl).not.toHaveBeenCalled();
        expect(rt.synthesize).toHaveBeenCalledTimes(provider === 'edge' ? 1 : 0);
    });

    it('B takes over the actual replacement receiver and a late A callback or STOP cannot interrupt B', async () => {
        const rt = subject('at-play', {holdInvalidResponse: true});
        const pendingA = rt.start();
        await rt.invalidResponseReady;
        expect(rt.receivers).toHaveLength(2);
        expect(await rt.start('live-B')).toEqual({success: true, transport: 'offscreen'});
        expect(rt.audios).toHaveLength(1);
        expect(rt.playedSources).toEqual([
            'https://translate.google.com/translate_tts?ie=UTF-8&tl=en-US&client=tw-ob&q=Only%20B%20speaks',
        ]);
        expect(rt.audios[0].play).toHaveBeenCalledOnce();
        const beforeLateReply = permitTraffic(rt).length;
        rt.releaseInvalidResponse();
        expect(await pendingA).toEqual({success: false, error: '语音播放已取消'});
        expect(await rt.stop()).toEqual({success: true});
        expect(rt.audios).toHaveLength(1);
        expect(rt.playedSources).toEqual([
            'https://translate.google.com/translate_tts?ie=UTF-8&tl=en-US&client=tw-ob&q=Only%20B%20speaks',
        ]);
        expect(permitTraffic(rt)).toHaveLength(beforeLateReply);
        expect(rt.traffic.filter(row => row.type === 'RESERVE_SELECTION_TTS' && row.clientRequestId === 'live-A')).toHaveLength(1);
        expect(rt.audios[0].pause).not.toHaveBeenCalled();
        expect(rt.audios[0].src).toBe(rt.playedSources[0]);
        expect(rt.closeDocument).toHaveBeenCalledOnce();
        expect(rt.createDocument).toHaveBeenCalledOnce();
        expect(rt.receivers).toHaveLength(2);
        await rt.stop('live-B');
        expect(rt.audios[0].pause).toHaveBeenCalledOnce();
        expect(rt.audios[0].src).toBe('');
    });

    it('Edge synthesizes once and only the replacement receiver decodes and plays its audioBase64', async () => {
        const rt = subject('at-play', {edgeAudio: true});
        expect(await rt.start('live-A', 'edge')).toEqual({success: true, transport: 'offscreen', voice: 'controlled-Edge-voice'});
        expect(rt.synthesize).toHaveBeenCalledOnce();
        expect(rt.synthesize.mock.calls[0].slice(0, 3)).toEqual(['Hello world', 'en-US', []]);
        expect(permitTraffic(rt).map(row => row.type)).toEqual(oneLossSuccessTrace);
        expect(rt.traffic.filter(row => row.type === 'PLAY_SELECTION_TTS').map(row => row.audioBase64)).toEqual(['AQID', 'AQID', 'AQID']);
        expect(rt.decodeBase64).toHaveBeenCalledOnce();
        expect(rt.decodeBase64).toHaveBeenCalledWith('AQID');
        expect(rt.createObjectUrl).toHaveBeenCalledOnce();
        expect(rt.createObjectUrl).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'audio/mpeg');
        expect(rt.receivers).toHaveLength(2);
        expect(rt.closeDocument).toHaveBeenCalledOnce();
        expect(rt.createDocument).toHaveBeenCalledOnce();
        expect(rt.audios).toHaveLength(1);
        expect(rt.playedSources).toEqual(['blob:controlled']);
        expect(rt.audios[0].play).toHaveBeenCalledOnce();
        await rt.stop();
        expect(rt.audios[0].pause).toHaveBeenCalledOnce();
        expect(rt.revokeObjectUrl).toHaveBeenCalledOnce();
        expect(rt.revokeObjectUrl).toHaveBeenCalledWith('blob:controlled');
    });

    it.each([
        {provider: 'google' as const, queued: false}, {provider: 'google' as const, queued: true},
        {provider: 'edge' as const, queued: false}, {provider: 'edge' as const, queued: true},
    ])('$provider startup rejection returns the same fallback result with queued=$queued notification delivery', async ({provider, queued}) => {
        const rt = subject('at-play', {edgeAudio: provider === 'edge', playError: 'controlled Audio.play rejection', queuePlaybackStates: queued});
        expect(await rt.start('live-A', provider)).toEqual(provider === 'google'
            ? {success: false, error: 'controlled Audio.play rejection'}
            : {success: true, transport: 'page', audioBase64: 'AQID', contentType: 'audio/mpeg', voice: 'controlled-Edge-voice'});
        expect(permitTraffic(rt).map(row => row.type)).toEqual(oneLossSuccessTrace);
        expect(rt.synthesize).toHaveBeenCalledTimes(provider === 'edge' ? 1 : 0);
        expect(rt.receivers).toHaveLength(2);
        expect(rt.createDocument).toHaveBeenCalledOnce();
        expect(rt.closeDocument).toHaveBeenCalledOnce();
        expect(rt.audios).toHaveLength(1);
        expect(rt.audios[0].play).toHaveBeenCalledOnce();
        expect(rt.audios[0].pause).toHaveBeenCalledOnce();
        expect(rt.audios[0].src).toBe('');
        expect(rt.revokeObjectUrl).toHaveBeenCalledTimes(provider === 'edge' ? 1 : 0);
        expect(rt.replies.filter(row => row.message.type === 'PLAY_SELECTION_TTS').at(-1)?.response)
            .toEqual({success: false, error: 'controlled Audio.play rejection'});
        await rt.flushPlaybackStates();
        expect(rt.sendTabMessage).not.toHaveBeenCalled();
        expect(permitTraffic(rt).map(row => row.type)).toEqual(oneLossSuccessTrace);
    });

    it('an accepted playback still forwards its real later media error once', async () => {
        const rt = subject('at-play', {edgeAudio: true, queuePlaybackStates: true});
        expect(await rt.start('live-A', 'edge')).toMatchObject({success: true, transport: 'offscreen'});
        const staleError = rt.audios[0].onerror;
        expect(staleError).toBeTypeOf('function');
        staleError?.(new Event('error'));
        staleError?.(new Event('error'));
        await rt.flushPlaybackStates();
        expect(rt.sendTabMessage).toHaveBeenCalledOnce();
        expect(rt.sendTabMessage).toHaveBeenCalledWith(7,
            {type: 'selectionTtsState', clientRequestId: 'live-A', state: 'error', error: '扩展音频解码或播放失败'}, {frameId: 0});
        expect(rt.audios[0].pause).toHaveBeenCalledOnce();
        expect(rt.revokeObjectUrl).toHaveBeenCalledOnce();
        expect(rt.synthesize).toHaveBeenCalledOnce();
    });

    it('STOP while native Audio.play is pending cancels Edge and late rejection never returns page audio', async () => {
        const rt = subject('at-play', {edgeAudio: true, holdFirstAudioPlay: true});
        const pending = rt.start('live-A', 'edge');
        await rt.audioPlayReady;
        expect(await rt.stop()).toEqual({success: true});
        rt.rejectAudioPlay();
        expect(await pending).toEqual({success: false, error: '语音播放已取消'});
        expect(rt.audios).toHaveLength(1);
        expect(rt.audios[0].play).toHaveBeenCalledOnce();
        expect(rt.audios[0].pause).toHaveBeenCalledOnce();
        expect(rt.audios[0].src).toBe('');
        expect(rt.revokeObjectUrl).toHaveBeenCalledOnce();
        expect(rt.synthesize).toHaveBeenCalledOnce();
        expect(rt.traffic.filter(row => row.type === 'RESERVE_SELECTION_TTS')).toHaveLength(2);
        expect(rt.sendTabMessage.mock.calls.some(([, message]) => (message as {state: string}).state === 'error')).toBe(false);
    });

    it('new owner B keeps playing after pending Edge A rejects and receives a late STOP(A)', async () => {
        const rt = subject('at-play', {edgeAudio: true, holdFirstAudioPlay: true});
        const pendingA = rt.start('live-A', 'edge');
        await rt.audioPlayReady;
        expect(await rt.start('live-B', 'edge')).toMatchObject({success: true, transport: 'offscreen'});
        rt.rejectAudioPlay();
        expect(await pendingA).toEqual({success: false, error: '语音播放已取消'});
        await rt.stop('live-A');
        expect(rt.synthesize).toHaveBeenCalledTimes(2);
        expect(rt.audios).toHaveLength(2);
        expect(rt.audios[0].pause).toHaveBeenCalledOnce();
        expect(rt.audios[1].play).toHaveBeenCalledOnce();
        expect(rt.audios[1].pause).not.toHaveBeenCalled();
        expect(rt.audios[1].src).toBe('blob:controlled');
        expect(rt.traffic.filter(row => row.type === 'RESERVE_SELECTION_TTS' && row.clientRequestId === 'live-A')).toHaveLength(2);
        expect(rt.sendTabMessage.mock.calls.some(([, message]) => (message as {state: string}).state === 'error')).toBe(false);
        await rt.stop('live-B');
        expect(rt.audios[1].pause).toHaveBeenCalledOnce();
    });

    it('three actual receiver replacements exhaust one shared three-attempt budget without entering Audio', async () => {
        const rt = subject('at-play', {playLosses: 3});
        expect(await rt.start()).toEqual({success: false, error: '语音播放未能启动，请重试'});
        const attempt = ['READ_SELECTION_TTS_REVISION', 'RESERVE_SELECTION_TTS', 'PLAY_SELECTION_TTS', 'PLAY_SELECTION_TTS'];
        expect(permitTraffic(rt).map(row => row.type)).toEqual([...attempt, ...attempt, ...attempt]);
        const snapshots = rt.replies.filter(row => row.message.type === 'READ_SELECTION_TTS_REVISION');
        const invalid = rt.replies.filter(row => row.response.errorCode === 'selection-tts-permit-invalid');
        expect(snapshots).toHaveLength(3);
        expect(invalid).toHaveLength(3);
        for (let index = 0; index < 3; index += 1) {
            expect(typeof snapshots[index].response.receiverId).toBe('string');
            expect(typeof invalid[index].response.receiverId).toBe('string');
            expect(invalid[index].response.receiverId).not.toBe(snapshots[index].response.receiverId);
            if (index < 2) expect(invalid[index].response.receiverId).toBe(snapshots[index + 1].response.receiverId);
        }
        expect(new Set([...snapshots, ...invalid].map(row => row.response.receiverId)).size).toBe(4);
        expect(rt.receivers).toHaveLength(4);
        expect(rt.closeDocument).toHaveBeenCalledTimes(3);
        expect(rt.createDocument).toHaveBeenCalledTimes(3);
        expect(rt.audios).toHaveLength(0);
        expect(rt.playedSources).toEqual([]);
        expect(rt.synthesize).not.toHaveBeenCalled();
        expect(rt.decodeBase64).not.toHaveBeenCalled();
        expect(rt.createObjectUrl).not.toHaveBeenCalled();
        expect(rt.sendTabMessage).not.toHaveBeenCalled();
    });
});

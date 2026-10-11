/**
 * @file tests/progressiveReadingTtsTransport.test.ts
 * 文件职责：经公开后台路由验证学习面板显式接收页面音频的朗读传输契约。
 * 主要内容：校验 page 请求不自动播放、旧入口缺省保持 Offscreen、非法模式无副作用，并覆盖既有策略、停止/替换迟到结果与 tab/frame/document/UUID 所有权。
 * 模块边界：控制合成与播放端口，不访问 handler 私有状态，不调用网络或浏览器。
 */
import {describe, expect, it, vi} from 'vitest';
import {createBackgroundMessageRouter, type BackgroundMessageHandler} from '@/src/app/background/messageRouter';
import {
    createSelectionTtsBackgroundHandlers,
    type SelectionTtsAudio,
    type SelectionTtsBackgroundDependencies,
    type SelectionTtsContext,
} from '@/src/features/selection-translation/background/ttsHandler';
import {createSelectionTtsSynthesizer} from '@/src/features/selection-translation/background/selectionTtsSynthesis';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}
const audio = (): SelectionTtsAudio => ({audio: new Uint8Array([1, 2, 3]).buffer, contentType: 'audio/wav', voice: 'configured-voice',
    timings: [{startChar: 0, endChar: 5, startTime: 0, endTime: 2}]});
const sender: SelectionTtsContext = {sender: {tab: {id: 0}, frameId: 3, documentId: 'document-a', url: 'https://controlled.example/read'}};
const request = (id = 'reading-a', extra: Record<string, unknown> = {}): Record<string, unknown> =>
    ({type: 'selectionTts', text: ' hello ', language: 'en-US', clientRequestId: id, playback: 'page', ...extra});
const result = {handled: true, response: {success: true, transport: 'page', audioBase64: 'AQID', contentType: 'audio/wav', voice: 'configured-voice',
    timings: [{startChar: 0, endChar: 5, startTime: 0, endTime: 2}]}};
const cancelled = {handled: true, response: {success: false, error: '语音合成已取消'}};
const flush = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};
function fixture(overrides: Partial<SelectionTtsBackgroundDependencies> = {}) {
    const dependencies: SelectionTtsBackgroundDependencies = {
        getPreferredVoices: vi.fn(() => ['configured-voice']), synthesize: vi.fn(async () => audio()),
        playWithOffscreen: vi.fn(async () => undefined), stopWithOffscreen: vi.fn(async () => undefined),
        seekWithOffscreen: vi.fn(async () => true), sendTabMessage: vi.fn(async () => undefined), warn: vi.fn(), ...overrides,
    };
    const router = createBackgroundMessageRouter<SelectionTtsContext>(createSelectionTtsBackgroundHandlers(dependencies) as Array<BackgroundMessageHandler<SelectionTtsContext>>);
    return {dependencies, send: (message: unknown, context = sender) => router.dispatch(message, context),
        stop: (id = 'reading-a', context = sender, extra: Record<string, unknown> = {}) => router.dispatch({type: 'selectionTtsStop', clientRequestId: id, ...extra}, context)};
}

describe('progressive reading page-owned TTS transport', () => {
    it('returns exact synthesized bytes and timings without creating or playing Offscreen audio', async () => {
        const f = fixture();
        await expect(f.send(request())).resolves.toEqual(result);
        expect(f.dependencies.synthesize).toHaveBeenCalledWith('hello', 'en-US', ['configured-voice'], expect.any(AbortSignal));
        expect(f.dependencies.playWithOffscreen).not.toHaveBeenCalled();
        expect(f.dependencies.stopWithOffscreen).not.toHaveBeenCalled();
        expect(f.dependencies.warn).not.toHaveBeenCalled();
    });

    it.each(['omitted', 'undefined'])('keeps default %s playback on the existing Offscreen route', async kind => {
        const f = fixture(), message = request();
        if (kind === 'omitted') delete message.playback;
        else message.playback = undefined;
        await expect(f.send(message)).resolves.toEqual({handled: true, response: {success: true, transport: 'offscreen', voice: 'configured-voice'}});
        expect(f.dependencies.playWithOffscreen).toHaveBeenCalledWith(expect.objectContaining({tabId: 0, frameId: 3, documentId: 'document-a', clientRequestId: 'reading-a'}), expect.any(AbortSignal));
    });

    it.each([null, '', 'offscreen', 'PAGE', 0, false, {}, []].map(playback => ({playback})))('rejects malformed playback=$playback before synthesis or ownership changes', async ({playback}) => {
        const f = fixture();
        await expect(f.send(request('invalid', {playback}))).rejects.toThrow('TTS playback');
        expect(f.dependencies.getPreferredVoices).not.toHaveBeenCalled();
        expect(f.dependencies.synthesize).not.toHaveBeenCalled();
        expect(f.dependencies.playWithOffscreen).not.toHaveBeenCalled();
        expect(f.dependencies.stopWithOffscreen).not.toHaveBeenCalled();
    });

    it('preserves local-only synthesis policy and the configured local voice', async () => {
        const local = vi.fn(async () => ({...audio(), contentType: 'audio/wav' as const, backend: 'wasm' as const})), online = vi.fn(async () => audio());
        const synthesize = createSelectionTtsSynthesizer({getMode: () => 'local-only', getLocalVoice: () => 'zf_001', getOnlineVoices: () => ['unused-online'],
            synthesizeLocal: local, synthesizeOnline: online});
        const f = fixture({synthesize});
        await expect(f.send(request('local', {language: 'zh-CN'}))).resolves.toEqual(result);
        expect(local).toHaveBeenCalledWith('hello', 'zh-CN', 'zf_001', expect.any(AbortSignal));
        expect(online).not.toHaveBeenCalled();
        expect(f.dependencies.playWithOffscreen).not.toHaveBeenCalled();
    });

    it('keeps no-tab vocabulary page requests returning bytes without changing their URL/UUID cancellation', async () => {
        const f = fixture();
        await expect(f.send(request('vocabulary', {playback: undefined}), {sender: {url: 'chrome-extension://controlled/options.html#vocabulary'}})).resolves.toEqual(result);
        expect(f.dependencies.playWithOffscreen).not.toHaveBeenCalled();
    });

    it('aborts a stopped pending page request and rejects a provider that resolves after STOP', async () => {
        const task = deferred<SelectionTtsAudio>(), synthesize = vi.fn((_text: string, _language: string, _voices: unknown, _signal?: AbortSignal) => task.promise);
        const f = fixture({synthesize});
        const pending = f.send(request());
        await flush();
        const signal = synthesize.mock.calls[0][3]!;
        await f.stop();
        expect(signal.aborted).toBe(true);
        task.resolve(audio());
        await expect(pending).resolves.toEqual(cancelled);
        expect(f.dependencies.playWithOffscreen).not.toHaveBeenCalled();
    });

    it.each(['tab', 'frame', 'document', 'uuid'])('ignores cross-%s STOP despite forged payload ownership and still accepts the exact owner', async field => {
        const task = deferred<SelectionTtsAudio>(), synthesize = vi.fn((_text: string, _language: string, _voices: unknown, _signal?: AbortSignal) => task.promise);
        const f = fixture({synthesize});
        const pending = f.send(request());
        await flush();
        const signal = synthesize.mock.calls[0][3]!;
        const other: SelectionTtsContext = {sender: {...sender.sender, ...(field === 'tab' ? {tab: {id: 1}} : {}),
            ...(field === 'frame' ? {frameId: 4} : {}), ...(field === 'document' ? {documentId: 'document-b'} : {})}};
        await f.stop(field === 'uuid' ? 'reading-b' : 'reading-a', other, {tabId: 0, frameId: 3, documentId: 'document-a'});
        expect(signal.aborted).toBe(false);
        await f.stop();
        expect(signal.aborted).toBe(true);
        task.resolve(audio());
        await expect(pending).resolves.toEqual(cancelled);
        expect(f.dependencies.playWithOffscreen).not.toHaveBeenCalled();
    });

    it('rejects a replaced delayed page result without letting its old STOP cancel the replacement', async () => {
        const first = deferred<SelectionTtsAudio>(), second = deferred<SelectionTtsAudio>();
        const synthesize = vi.fn((_text: string, _language: string, _voices: unknown, _signal?: AbortSignal) => first.promise).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
        const f = fixture({synthesize});
        const old = f.send(request('old')); await flush();
        const next = f.send(request('next')); await flush();
        const oldSignal = synthesize.mock.calls[0][3]!, nextSignal = synthesize.mock.calls[1][3]!;
        expect(oldSignal.aborted).toBe(true);
        await f.stop('old'); expect(nextSignal.aborted).toBe(false);
        first.resolve(audio()); await expect(old).resolves.toEqual(cancelled);
        second.resolve(audio()); await expect(next).resolves.toEqual(result);
        expect(f.dependencies.playWithOffscreen).not.toHaveBeenCalled();
    });

    it('preserves the replacement when an old cancelled synthesis rejects, allowing exact STOP of the new request', async () => {
        const first = deferred<SelectionTtsAudio>(), second = deferred<SelectionTtsAudio>();
        const synthesize = vi.fn((_text: string, _language: string, _voices: unknown, _signal?: AbortSignal) => first.promise).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
        const f = fixture({synthesize});
        const old = f.send(request('old')); const rejection = expect(old).rejects.toThrow('late failure'); await flush();
        const next = f.send(request('next')); await flush();
        first.reject(new Error('late failure')); await rejection;
        const nextSignal = synthesize.mock.calls[1][3]!;
        expect(nextSignal.aborted).toBe(false);
        await f.stop('next'); expect(nextSignal.aborted).toBe(true);
        second.resolve(audio()); await expect(next).resolves.toEqual(cancelled);
        expect(f.dependencies.playWithOffscreen).not.toHaveBeenCalled();
    });

    it('releases an older Offscreen owner before returning explicit page bytes while a later default request still uses Offscreen', async () => {
        const f = fixture();
        await f.send(request('selection', {playback: undefined}));
        await expect(f.send(request('reading'))).resolves.toEqual(result);
        expect(f.dependencies.stopWithOffscreen).toHaveBeenCalledWith(expect.objectContaining({tabId: 0, frameId: 3, documentId: 'document-a', clientRequestId: 'selection'}));
        expect(f.dependencies.playWithOffscreen).toHaveBeenCalledTimes(1);
        await f.send(request('next-selection', {playback: undefined}));
        expect(f.dependencies.playWithOffscreen).toHaveBeenCalledTimes(2);
    });

    it('supersedes a Google fallback waiting for old Offscreen STOP without starting its obsolete audio', async () => {
        const stopping = deferred<void>(), stopWithOffscreen = vi.fn(() => stopping.promise);
        const f = fixture({stopWithOffscreen});
        await f.send(request('selection', {playback: undefined}));
        const google = f.send({type: 'selectionTtsGoogle', text: 'obsolete fallback', clientRequestId: 'google'});
        await flush();
        expect(stopWithOffscreen).toHaveBeenCalledOnce();
        await expect(f.send(request('current-reading'))).resolves.toEqual(result);
        stopping.resolve();
        await expect(google).resolves.toEqual({handled: true, response: {success: false, error: '语音播放已取消'}});
        expect(f.dependencies.playWithOffscreen).toHaveBeenCalledTimes(1);
    });
});

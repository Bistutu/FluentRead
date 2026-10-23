import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {prepareImageOcrLanguages as prepare} from '@/src/features/image-translation/services/client';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}

type Message = {type: string; requestId?: string; languages?: string[]; timeoutMs?: number};
type Change = Record<string, {newValue?: unknown}>;
type StorageListener = (changes: Change, area: string) => void;
type Outcome = {state: 'pending' | 'resolved' | 'rejected'; name?: string; message?: string};
let status: ReturnType<typeof deferred<any>>;
let download: ReturnType<typeof deferred<any>>;
let send: ReturnType<typeof vi.fn>;
let storageListeners: Set<StorageListener>;
let runtimeListeners: Set<unknown>;
let storageAdds: ReturnType<typeof vi.fn>;
let controllers: AbortController[];
let signalListeners: Set<unknown>[];
let operations: Promise<unknown>[];

function controller() {
    const control = new AbortController();
    const listeners = new Set<unknown>();
    const add = control.signal.addEventListener.bind(control.signal);
    const remove = control.signal.removeEventListener.bind(control.signal);
    vi.spyOn(control.signal, 'addEventListener').mockImplementation((type, listener, options) => {
        if (type === 'abort') listeners.add(listener);
        add(type, listener, options);
    });
    vi.spyOn(control.signal, 'removeEventListener').mockImplementation((type, listener, options) => {
        if (type === 'abort') listeners.delete(listener);
        remove(type, listener, options);
    });
    controllers.push(control);
    signalListeners.push(listeners);
    return control;
}

function observe(promise: Promise<void>) {
    const result: {value: Outcome} = {value: {state: 'pending'}};
    const settled = promise.then(
        () => {result.value = {state: 'resolved'};},
        error => {result.value = {state: 'rejected', name: error.name, message: error.message};},
    );
    operations.push(settled);
    return result;
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const progressKey = (language: string) => `fluentReadDownloadProgress:ocr-language:${language}`;
function emit(changes: Change) {
    for (const listener of storageListeners) listener(changes, 'local');
}
function expectAbort(result: {value: Outcome}) {
    expect(result.value).toEqual({state: 'rejected', name: 'AbortError', message: '图片 OCR 请求已取消'});
}

beforeEach(() => {
    vi.useFakeTimers();
    status = deferred();
    download = deferred();
    storageListeners = new Set();
    runtimeListeners = new Set();
    controllers = [];
    signalListeners = [];
    operations = [];
    send = vi.fn((message: Message) => {
        if (message.type === 'fluentReadImageOcrStatus') return status.promise;
        if (message.type === 'fluentReadImageOcrDownload') return download.promise;
        if (message.type === 'fluentReadImageCancel') return Promise.resolve({success: true});
        throw new Error(`Unexpected runtime message: ${message.type}`);
    });
    storageAdds = vi.fn((listener: StorageListener) => storageListeners.add(listener));
    vi.stubGlobal('browser', {
        runtime: {sendMessage: send, onMessage: {
            addListener: (listener: unknown) => runtimeListeners.add(listener),
            removeListener: (listener: unknown) => runtimeListeners.delete(listener),
        }},
        storage: {onChanged: {
            addListener: storageAdds,
            removeListener: (listener: StorageListener) => storageListeners.delete(listener),
        }},
    });
});

afterEach(async () => {
    // 基线失败时也释放受控端口；不能把未完成的 Promise 留给下一用例。
    for (const control of controllers) control.abort();
    status.resolve({success: true, languages: []});
    download.resolve({success: true});
    await flush();
    await Promise.all(operations);
    expect(storageListeners.size).toBe(0);
    expect(runtimeListeners.size).toBe(0);
    expect(signalListeners.every(listeners => listeners.size === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('image OCR preparation status cancellation at the client public entry', () => {
    it.each(['resolve', 'reject'] as const)('starts the bounded download after stalled status and ignores its late %s', async late => {
        const control = controller();
        const progress = vi.fn();
        const result = observe(prepare('ja', control.signal, progress));
        await vi.advanceTimersByTimeAsync(4_999);
        expect(send).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(send.mock.calls[1][0]).toMatchObject({type: 'fluentReadImageOcrDownload', languages: ['jpn', 'eng'], timeoutMs: 300_000});
        expect(storageListeners.size).toBe(1);
        if (late === 'resolve') status.resolve({success: true, languages: ['eng']});
        else status.reject(new Error('Late status failure'));
        await flush();
        emit({[progressKey('jpn')]: {newValue: {loaded: 1, total: 2}}});
        expect(progress).toHaveBeenLastCalledWith(25);
        expect(send).toHaveBeenCalledTimes(2);
        download.resolve({success: true});
        await flush();
        expect(result.value).toEqual({state: 'resolved'});
        expect(signalListeners[0].size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('rejects an already-aborted signal without starting a never-returning status query', async () => {
        const control = controller();
        control.abort();
        const progress = vi.fn();
        const result = observe(prepare('ja', control.signal, progress));
        await flush();
        expectAbort(result);
        expect(send).not.toHaveBeenCalled();
        expect(storageAdds).not.toHaveBeenCalled();
        expect(progress).not.toHaveBeenCalled();
    });

    it.each(['resolve', 'reject'] as const)('settles abort while status remains pending and ignores its late %s', async (late) => {
        const control = controller();
        const progress = vi.fn();
        const result = observe(prepare('ja', control.signal, progress));
        await flush();
        expect(send.mock.calls.map(([message]) => message)).toEqual([{type: 'fluentReadImageOcrStatus'}]);
        expect(result.value.state).toBe('pending');
        control.abort();
        await flush();
        // status 此刻仍未返回：取消是否独立结束等待是本用例的关键观察点。
        expectAbort(result);
        expect(signalListeners[0].size).toBe(0);
        expect(storageAdds).not.toHaveBeenCalled();
        if (late === 'resolve') status.resolve({success: true, languages: ['eng']});
        else status.reject(new Error('late controlled status failure'));
        await flush();
        emit({[progressKey('jpn')]: {newValue: {loaded: 1, total: 2}}});
        expectAbort(result);
        expect(send).toHaveBeenCalledTimes(1);
        expect(storageAdds).not.toHaveBeenCalled();
        expect(progress).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not subscribe to downloads when the status port aborts synchronously before replying', async () => {
        const control = controller();
        send.mockImplementationOnce(() => {
            control.abort();
            return Promise.resolve({success: true, languages: ['eng']});
        });
        const progress = vi.fn();
        const result = observe(prepare('ja', control.signal, progress));
        await flush();
        expectAbort(result);
        expect(send).toHaveBeenCalledTimes(1);
        expect(storageAdds).not.toHaveBeenCalled();
        expect(progress).not.toHaveBeenCalled();
    });

    it('keeps cached languages out of the progress denominator and preserves normal download messages', async () => {
        const progress = vi.fn();
        const result = observe(prepare('auto', undefined, progress));
        status.resolve({success: true, languages: ['chi_tra', 'unknown']});
        await flush();
        expect(storageListeners.size).toBe(1);
        expect(send.mock.calls[0][0]).toEqual({type: 'fluentReadImageOcrStatus'});
        expect(send.mock.calls[1][0]).toEqual({
            type: 'fluentReadImageOcrDownload', languages: ['chi_sim', 'chi_tra', 'eng', 'jpn'],
            requestId: expect.any(String), timeoutMs: 300_000,
        });
        emit({[progressKey('chi_tra')]: {newValue: {loaded: 1, total: 2}}});
        expect(progress).not.toHaveBeenCalled();
        emit({[progressKey('chi_sim')]: {newValue: {loaded: 1, total: 2}}});
        emit({[progressKey('chi_sim')]: {}});
        emit({[progressKey('eng')]: {newValue: {loaded: 0, total: 6}}});
        emit({[progressKey('eng')]: {newValue: {loaded: 6, total: 6}}, [progressKey('jpn')]: {newValue: {loaded: 2, total: 4}}});
        emit({[progressKey('jpn')]: {}});
        expect(progress.mock.calls.map(([percent]) => percent)).toEqual([16, 33, 33, 66, 83, 100]);
        download.resolve({success: true});
        await flush();
        expect(result.value).toEqual({state: 'resolved'});
        expect(storageListeners.size).toBe(0);
    });

    it.each(['throw', 'reject'] as const)('preserves all-required progress and download fallback when status %s fails', async (failure) => {
        send.mockImplementationOnce(() => {
            if (failure === 'throw') throw new Error('controlled synchronous status failure');
            return Promise.reject(new Error('controlled rejected status failure'));
        });
        const progress = vi.fn();
        const result = observe(prepare('en', undefined, progress));
        await flush();
        expect(send.mock.calls[1][0]).toEqual({
            type: 'fluentReadImageOcrDownload', languages: ['eng'], requestId: expect.any(String), timeoutMs: 300_000,
        });
        emit({[progressKey('eng')]: {newValue: {loaded: 1, total: 4}}});
        expect(progress).toHaveBeenLastCalledWith(25);
        download.resolve({success: true});
        await flush();
        expect(result.value).toEqual({state: 'resolved'});
        expect(storageListeners.size).toBe(0);
    });

    it('preserves download cancellation notification and releases progress after a successful status reply', async () => {
        const control = controller();
        const progress = vi.fn();
        const result = observe(prepare('ja', control.signal, progress));
        status.resolve({success: true, languages: ['eng']});
        await flush();
        const request = send.mock.calls[1][0] as Message;
        emit({[progressKey('jpn')]: {newValue: {loaded: 1, total: 4}}});
        expect(progress).toHaveBeenLastCalledWith(25);
        control.abort();
        await flush();
        expectAbort(result);
        expect(send.mock.calls[2][0]).toEqual({type: 'fluentReadImageCancel', requestId: request.requestId});
        expect(storageListeners.size).toBe(0);
        download.resolve({success: true});
        emit({[progressKey('jpn')]: {}});
        await flush();
        expectAbort(result);
        expect(progress.mock.calls.map(([percent]) => percent)).toEqual([25]);
        expect(vi.getTimerCount()).toBe(0);
    });
});

/**
 * @file tests/downloadProgressTransport.test.ts
 * 文件职责：验证下载进度从离屏页面经后台转存、再由界面订阅的整条通道只接受可信来源，并且结束通知不会被进度覆盖。
 * 主要内容：覆盖受信发布与内容脚本单键查询的来源校验、串行写入、受限存储隔离，以及内容查询的重试、单路调度、结束事件、十分钟上限与迟到取消。
 * 模块边界：使用内存存储端口和假的变化事件，不启动浏览器、不发起下载。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createDownloadProgressHandler, createDownloadProgressQueryHandler} from '@/src/app/background/handlers/downloadProgress';
import {DOWNLOAD_PROGRESS_MESSAGE, DOWNLOAD_PROGRESS_QUERY_MESSAGE, downloadProgressKey, type DownloadProgress} from '@/src/core/download/progress';
import {watchContentDownloadProgress, watchDownloadProgress} from '@/src/platform/storage/downloadProgress';
import {createBackgroundMessageRouter, createBackgroundRuntimeMessageListener} from '@/src/app/background/messageRouter';

const runtimeId = 'fluentread-extension';
const offscreenUrl = 'chrome-extension://fluentread-extension/offscreen.html';
const trusted = {sender: {id: runtimeId, url: offscreenUrl}};

afterEach(() => {vi.unstubAllGlobals(); vi.useRealTimers();});

function createHandler() {
    const values = new Map<string, unknown>();
    const operations: string[] = [];
    const storage = {
        get: vi.fn(async (key: string) => ({[key]: values.get(key)})),
        set: vi.fn(async (value: Record<string, unknown>) => {
            for (const [key, item] of Object.entries(value)) { values.set(key, item); operations.push(`set:${key}`); }
        }),
        remove: vi.fn(async (key: string) => { values.delete(key); operations.push(`remove:${key}`); }),
    };
    const handler = createDownloadProgressHandler({runtimeId, offscreenUrl, storage});
    const query = createDownloadProgressQueryHandler({runtimeId, storage});
    const send = (message: Record<string, unknown>, context: unknown = trusted) =>
        handler.handle({type: DOWNLOAD_PROGRESS_MESSAGE, ...message}, context);
    return {handler, query, send, storage, values, operations};
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => {resolve = yes;});
    return {promise, resolve};
}

async function settle() {for (let index = 0; index < 8; index++) await Promise.resolve();}

describe('content-only background download progress query', () => {
    const context = {sender: {id: runtimeId, tab: {id: 7}}};
    it('carries whitelisted connection status through trusted storage and content query', async () => {
        const f = createHandler(), id = 'video-model:small';
        const transfer = {source: 'hf-mirror', state: 'connecting', attempt: 2, attempts: 3};
        await f.send({id, progress: {loaded: 0, total: 590_000_000, transfer: {...transfer, url: 'https://private.invalid/'}}});
        await expect(f.query.handle({type: DOWNLOAD_PROGRESS_QUERY_MESSAGE, id, since: 0}, context)).resolves.toEqual({success: true, progress: {loaded: 0, total: 590_000_000, transfer}});
        expect(f.values.get(downloadProgressKey(id))).toEqual(expect.objectContaining({transfer}));
    });
    it('reads only the named progress key and returns normalized bytes without exposing other storage', async () => {
        const f = createHandler();
        const id = 'video-model:small', key = downloadProgressKey(id);
        f.values.set(key, {loaded: 20, total: 10, updatedAt: 1000});
        f.values.set('config', {token: 'unrelated-private-setting'});
        expect(f.query.type).toBe(DOWNLOAD_PROGRESS_QUERY_MESSAGE);
        await expect(f.query.handle({type: DOWNLOAD_PROGRESS_QUERY_MESSAGE, id, since: 1000}, context)).resolves.toEqual({success: true, progress: {loaded: 20, total: 20}});
        expect(f.storage.get).toHaveBeenCalledOnce(); expect(f.storage.get).toHaveBeenCalledWith(key);
        expect(f.storage.set).not.toHaveBeenCalled(); expect(f.storage.remove).not.toHaveBeenCalled();
        f.values.delete(key);
        await expect(f.query.handle({type: DOWNLOAD_PROGRESS_QUERY_MESSAGE, id, since: 1000}, context)).resolves.toEqual({success: true, progress: undefined});
        f.values.set(key, {loaded: -1, total: 10, updatedAt: 1000});
        await expect(f.query.handle({type: DOWNLOAD_PROGRESS_QUERY_MESSAGE, id, since: 1000}, context)).resolves.toEqual({success: true, progress: undefined});
    });
    it('rejects foreign, extension-page or invalid-tab senders and invalid ids before reading storage', async () => {
        const f = createHandler();
        for (const sender of [undefined, {}, {id: 'foreign', tab: {id: 7}}, {id: runtimeId}, ...[undefined, '7', NaN, Infinity, -1, 1.5].map(id => ({id: runtimeId, tab: {id}}))]) {
            await expect(f.query.handle({type: DOWNLOAD_PROGRESS_QUERY_MESSAGE, id: 'video-model:small', since: 0}, sender ? {sender} : undefined)).resolves.toEqual({success: false});
        }
        for (const id of [undefined, '../config', 'Not An Id']) await expect(f.query.handle({type: DOWNLOAD_PROGRESS_QUERY_MESSAGE, id, since: 0}, context)).resolves.toEqual({success: false});
        for (const since of [undefined, '1000', NaN, Infinity, -1]) await expect(f.query.handle({type: DOWNLOAD_PROGRESS_QUERY_MESSAGE, id: 'video-model:small', since}, context)).resolves.toEqual({success: false});
        expect(f.storage.get).not.toHaveBeenCalled();
    });
    it('reports read failure without manufacturing a completed download and succeeds on a later request', async () => {
        const f = createHandler();
        f.storage.get.mockRejectedValueOnce(new Error('storage temporarily unavailable'));
        const message = {type: DOWNLOAD_PROGRESS_QUERY_MESSAGE, id: 'video-model:base', since: 1000} as const;
        await expect(f.query.handle(message, context)).resolves.toEqual({success: false});
        f.values.set(downloadProgressKey(message.id), {loaded: 3, total: 0, updatedAt: 1000});
        await expect(f.query.handle(message, context)).resolves.toEqual({success: true, progress: {loaded: 3, total: 0}});
    });
    it('ignores an old or unstamped residual key until a new trusted publication begins', async () => {
        vi.useFakeTimers(); vi.setSystemTime(2000);
        const f = createHandler(), id = 'video-model:small', key = downloadProgressKey(id);
        const message = {type: DOWNLOAD_PROGRESS_QUERY_MESSAGE, id, since: 2000} as const;
        for (const updatedAt of [undefined, 1999, '2000', NaN, Infinity]) {
            f.values.set(key, {loaded: 100, total: 100, updatedAt});
            await expect(f.query.handle(message, context)).resolves.toEqual({success: true, progress: undefined});
        }
        await f.send({id, progress: {loaded: 25, total: 100}});
        expect(f.values.get(key)).toEqual({loaded: 25, total: 100, updatedAt: 2000});
        await expect(f.query.handle(message, context)).resolves.toEqual({success: true, progress: {loaded: 25, total: 100}});
    });
});

describe('bounded content download progress watcher', () => {
    it('delivers real publish→background write→content query progress and finish without a content storage port', async () => {
        vi.useFakeTimers();
        const f = createHandler(), id = 'video-model:small';
        const runtime = createBackgroundRuntimeMessageListener(createBackgroundMessageRouter([f.handler, f.query]), sender => ({sender}));
        const send = vi.fn((message: {type: typeof DOWNLOAD_PROGRESS_QUERY_MESSAGE; id: string; since: number}) => runtime(message, {id: runtimeId, tab: {id: 3}}));
        const received: Array<DownloadProgress | undefined> = [];
        const stop = watchContentDownloadProgress(id, progress => received.push(progress), send);
        await settle();
        await runtime({type: DOWNLOAD_PROGRESS_MESSAGE, id, progress: {loaded: 25, total: 100}}, trusted.sender);
        await vi.advanceTimersByTimeAsync(500);
        await runtime({type: DOWNLOAD_PROGRESS_MESSAGE, id, progress: {loaded: 75, total: 100}}, trusted.sender);
        await vi.advanceTimersByTimeAsync(500);
        await runtime({type: DOWNLOAD_PROGRESS_MESSAGE, id}, trusted.sender);
        await vi.advanceTimersByTimeAsync(500);
        expect(received).toEqual([undefined, {loaded: 25, total: 100}, {loaded: 75, total: 100}, undefined]);
        expect(send).toHaveBeenCalledTimes(4); expect(f.storage.get.mock.calls.every(([key]) => key === downloadProgressKey(id))).toBe(true);
        stop(); stop(); expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(1000); expect(send).toHaveBeenCalledTimes(4);
        expect(new Set(send.mock.calls.map(([message]) => message.since)).size).toBe(1);
    });
    it('keeps one pending query and ignores its late result after stop', async () => {
        vi.useFakeTimers();
        const gate = deferred<unknown>(), send = vi.fn(() => gate.promise), listener = vi.fn();
        const stop = watchContentDownloadProgress('video-model:small', listener, send);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(send).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
        stop(); gate.resolve({success: true, progress: {loaded: 1, total: 2}}); await settle();
        expect(listener).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });
    it('automatically stops after 600 seconds even when its query never returned', async () => {
        vi.useFakeTimers();
        const gate = deferred<unknown>(), send = vi.fn(() => gate.promise), listener = vi.fn();
        watchContentDownloadProgress('video-model:small', listener, send);
        await vi.advanceTimersByTimeAsync(599_999); expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1); expect(vi.getTimerCount()).toBe(0);
        gate.resolve({success: true, progress: {loaded: 1, total: 2}}); await settle();
        expect(listener).not.toHaveBeenCalled(); expect(send).toHaveBeenCalledOnce();
    });
    it('retries failures and malformed replies without resetting the last valid progress', async () => {
        vi.useFakeTimers();
        const send = vi.fn<NonNullable<Parameters<typeof watchContentDownloadProgress>[2]>>()
            .mockResolvedValueOnce({success: true, progress: {loaded: 2, total: 8}})
            .mockRejectedValueOnce(new Error('message port interrupted'))
            .mockResolvedValueOnce({success: false})
            .mockResolvedValueOnce(undefined).mockResolvedValueOnce(5)
            .mockResolvedValueOnce({success: true, progress: 'corrupt'})
            .mockResolvedValueOnce({success: true, progress: {loaded: 4, total: 8}});
        const listener = vi.fn(), stop = watchContentDownloadProgress('video-model:small', listener, send);
        await settle(); await vi.advanceTimersByTimeAsync(3000);
        expect(listener.mock.calls).toEqual([[{loaded: 2, total: 8}], [{loaded: 4, total: 8}]]);
        stop(); expect(vi.getTimerCount()).toBe(0);
    });
    it('allows the callback to end its owner without scheduling a later query', async () => {
        vi.useFakeTimers();
        const gate = deferred<unknown>(), send = vi.fn(() => gate.promise);
        const stop = watchContentDownloadProgress('video-model:base', () => stop(), send);
        gate.resolve({success: true}); await settle();
        expect(vi.getTimerCount()).toBe(0); expect(send).toHaveBeenCalledOnce();
    });
    it('uses the runtime bridge by default and makes invalid ids a timer-free no-op', async () => {
        vi.useFakeTimers();
        const sendMessage = vi.fn(async () => ({success: true, progress: {loaded: 1, total: 0}})), listener = vi.fn();
        vi.stubGlobal('browser', {runtime: {sendMessage}});
        const ignored = watchContentDownloadProgress('../config', listener); ignored();
        expect(sendMessage).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
        const stop = watchContentDownloadProgress('video-model:tiny', listener); await settle();
        expect(sendMessage).toHaveBeenCalledWith({type: DOWNLOAD_PROGRESS_QUERY_MESSAGE, id: 'video-model:tiny', since: Date.now()});
        expect(listener).toHaveBeenCalledWith({loaded: 1, total: 0}); stop();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('background download progress handler', () => {
    it('stores normalized progress from the offscreen document and removes the key when the download ends', async () => {
        vi.useFakeTimers(); vi.setSystemTime(1000);
        const {handler, send, values, operations} = createHandler();
        expect(handler.type).toBe(DOWNLOAD_PROGRESS_MESSAGE);
        const key = downloadProgressKey('local-tts');
        await expect(send({id: 'local-tts', progress: {loaded: 12, total: 10}})).resolves.toEqual({success: true});
        expect(values.get(key)).toEqual({loaded: 12, total: 12, updatedAt: 1000});
        // 进度与结束通知几乎同时到达时，删除必须排在写入之后。
        const results = await Promise.all([
            send({id: 'local-tts', progress: {loaded: 20, total: 40}}),
            send({id: 'local-tts'}),
        ]);
        expect(results).toEqual([{success: true}, {success: true}]);
        expect(operations).toEqual([`set:${key}`, `set:${key}`, `remove:${key}`]);
        expect(values.has(key)).toBe(false);
    });

    it('ignores other senders, malformed ids and malformed progress without touching storage', async () => {
        const {send, storage} = createHandler();
        const progress = {loaded: 1, total: 2};
        for (const context of [
            null,
            {},
            {sender: {id: 'another-extension', url: offscreenUrl}},
            {sender: {id: runtimeId, url: 'chrome-extension://fluentread-extension/options.html'}},
            {sender: {id: runtimeId, url: 'https://example.com/offscreen.html'}},
        ]) {
            await expect(send({id: 'local-tts', progress}, context)).resolves.toEqual({success: false});
        }
        for (const message of [
            {progress},
            {id: 'Not An Id', progress},
            {id: 'local-tts', progress: {loaded: -1, total: 2}},
            {id: 'local-tts', progress: 'half'},
            {id: 'local-tts', progress: null},
        ]) {
            await expect(send(message)).resolves.toEqual({success: false});
        }
        expect(storage.set).not.toHaveBeenCalled();
        expect(storage.remove).not.toHaveBeenCalled();
    });

    it('keeps accepting progress after a storage write fails', async () => {
        vi.useFakeTimers(); vi.setSystemTime(1000);
        const {send, storage, values} = createHandler();
        storage.set.mockRejectedValueOnce(new Error('quota'));
        await expect(send({id: 'video-model:tiny', progress: {loaded: 1, total: 4}})).resolves.toEqual({success: true});
        await expect(send({id: 'video-model:tiny', progress: {loaded: 2, total: 4}})).resolves.toEqual({success: true});
        expect(values.get(downloadProgressKey('video-model:tiny'))).toEqual({loaded: 2, total: 4, updatedAt: 1000});
    });
    it('uses an injected clock for the trusted internal stamp without changing the normalized bytes', async () => {
        const storage = {set: vi.fn(async (_value: Record<string, unknown>) => undefined), remove: vi.fn(async (_key: string) => undefined)};
        const handler = createDownloadProgressHandler({runtimeId, offscreenUrl, storage, now: () => 42});
        await handler.handle({type: DOWNLOAD_PROGRESS_MESSAGE, id: 'video-model:small', progress: {loaded: 1, total: 2}}, trusted);
        expect(storage.set).toHaveBeenCalledWith({[downloadProgressKey('video-model:small')]: {loaded: 1, total: 2, updatedAt: 42}});
    });
});

describe('download progress subscription', () => {
    function createEvents() {
        const listeners = new Set<(changes: Record<string, {newValue?: unknown}>, areaName: string) => void>();
        return {
            listeners,
            addListener: (listener: (changes: Record<string, {newValue?: unknown}>, areaName: string) => void) => { listeners.add(listener); },
            removeListener: (listener: (changes: Record<string, {newValue?: unknown}>, areaName: string) => void) => { listeners.delete(listener); },
            emit(changes: Record<string, {newValue?: unknown}>, areaName = 'local') { for (const listener of listeners) listener(changes, areaName); },
        };
    }

    it('delivers progress and finish events only for watched ids in the local area', () => {
        const events = createEvents();
        const received: Array<[string, DownloadProgress | undefined]> = [];
        const stop = watchDownloadProgress(['local-tts', 'video-model:tiny'], (id, progress) => received.push([id, progress]), events);
        events.emit({[downloadProgressKey('local-tts')]: {newValue: {loaded: 3, total: 9}}, [downloadProgressKey('ocr-language:eng')]: {newValue: {loaded: 1, total: 2}}});
        events.emit({[downloadProgressKey('video-model:tiny')]: {newValue: {loaded: 1, total: 2}}}, 'sync');
        events.emit({unrelated: {newValue: 1}});
        events.emit({[downloadProgressKey('video-model:tiny')]: {newValue: 'corrupt'}});
        events.emit({[downloadProgressKey('local-tts')]: {}});
        expect(received).toEqual([
            ['local-tts', {loaded: 3, total: 9}],
            ['video-model:tiny', undefined],
            ['local-tts', undefined],
        ]);
        stop();
        expect(events.listeners.size).toBe(0);
        events.emit({[downloadProgressKey('local-tts')]: {newValue: {loaded: 9, total: 9}}});
        expect(received).toHaveLength(3);
    });

    it('subscribes to the extension storage change event by default', () => {
        const events = createEvents();
        vi.stubGlobal('browser', {storage: {onChanged: events}});
        const listener = vi.fn();
        const stop = watchDownloadProgress(['local-tts'], listener);
        events.emit({[downloadProgressKey('local-tts')]: {newValue: {loaded: 1, total: 0}}});
        expect(listener).toHaveBeenCalledWith('local-tts', {loaded: 1, total: 0});
        stop();
        expect(events.listeners.size).toBe(0);
    });
});

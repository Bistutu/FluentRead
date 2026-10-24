import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
    CONFIG_HISTORY_MESSAGE_TYPE,
    createConfigHistoryHandler,
} from '@/src/app/background/handlers/configHistory';
import {
    CLEAR_TRANSLATION_CACHE_MESSAGE,
    TRANSLATION_CACHE_CLEARED_MESSAGE,
    createTranslationCacheHandler,
    createTranslationCacheInvalidationBroadcaster,
    createTranslationCacheHandlers,
    GET_TRANSLATION_CACHE_STATS_MESSAGE,
} from '@/src/app/background/handlers/translationCache';
import {createBackgroundMessageRouter} from '@/src/services/messaging/backgroundRouter';

describe('background core message handlers', () => {
    it('返回后台真实缓存用量，统计失败由 router 边界报告', async () => {
        const stats = {bytes: 1024, entries: 2, maxBytes: 5242880, maxEntries: 2000};
        const read = vi.fn().mockResolvedValueOnce(stats).mockRejectedValueOnce(new Error('stats unavailable'));
        const router = createBackgroundMessageRouter(createTranslationCacheHandlers(async () => undefined, read, async () => undefined));
        await expect(router.dispatch({type: GET_TRANSLATION_CACHE_STATS_MESSAGE}, undefined)).resolves.toEqual({
            handled: true, response: {success: true, stats},
        });
        await expect(router.dispatch({type: GET_TRANSLATION_CACHE_STATS_MESSAGE}, undefined)).rejects.toThrow('stats unavailable');
    });
    it('清理 broker 缓存成功后返回明确响应', async () => {
        const clear = vi.fn(async () => undefined);
        const broadcast = vi.fn(async () => undefined);
        const router = createBackgroundMessageRouter([
            createTranslationCacheHandler(clear, broadcast),
        ]);

        await expect(router.dispatch({type: CLEAR_TRANSLATION_CACHE_MESSAGE}, undefined)).resolves.toEqual({
            handled: true,
            response: {success: true},
        });
        expect(clear).toHaveBeenCalledOnce();
        expect(broadcast).toHaveBeenCalledOnce();
        expect(clear.mock.invocationCallOrder[0]).toBeLessThan(broadcast.mock.invocationCallOrder[0]!);
    });

    it('缓存清理失败时把错误交给统一 router 边界', async () => {
        const failure = new Error('clear failed');
        const broadcast = vi.fn(async () => undefined);
        const router = createBackgroundMessageRouter([
            createTranslationCacheHandler(async () => { throw failure; }, broadcast),
        ]);

        await expect(router.dispatch({type: CLEAR_TRANSLATION_CACHE_MESSAGE}, undefined)).rejects.toBe(failure);
        expect(broadcast).not.toHaveBeenCalled();
    });

    it('清理成功后向所有有效 tab 广播会话缓存失效', async () => {
        const sendTabMessage = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('restricted page'));
        const warn = vi.fn();
        const broadcast = createTranslationCacheInvalidationBroadcaster({
            queryTabs: async () => [{id: 3}, {}, {id: 9}],
            sendTabMessage,
            warn,
        });

        await expect(broadcast()).resolves.toBeUndefined();
        expect(sendTabMessage).toHaveBeenCalledTimes(2);
        expect(sendTabMessage).toHaveBeenNthCalledWith(1, 3, {type: TRANSLATION_CACHE_CLEARED_MESSAGE});
        expect(sendTabMessage).toHaveBeenNthCalledWith(2, 9, {type: TRANSLATION_CACHE_CLEARED_MESSAGE});
        expect(warn).not.toHaveBeenCalled();

        const queryFailure = new Error('tabs unavailable');
        const failedBroadcast = createTranslationCacheInvalidationBroadcaster({
            queryTabs: async () => { throw queryFailure; },
            sendTabMessage,
            warn,
        });
        await expect(failedBroadcast()).resolves.toBe(true);
        expect(warn).toHaveBeenCalledWith(
            '[FluentRead] 翻译缓存清理完成广播失败',
            queryFailure,
        );
    });

    it.each([
        ['undo', 8],
        ['redo', undefined],
        ['restore', undefined],
    ] as const)('执行有效配置历史操作 %s', async (action, expectedVersion) => {
        const apply = vi.fn(async () => ({action, version: expectedVersion}));
        const router = createBackgroundMessageRouter([
            createConfigHistoryHandler(apply),
        ]);
        const version = action === 'undo' ? 8 : action === 'redo' ? Number.NaN : 'latest';

        await expect(router.dispatch({
            type: CONFIG_HISTORY_MESSAGE_TYPE,
            action,
            version,
        }, undefined)).resolves.toEqual({
            handled: true,
            response: {
                success: true,
                history: {action, version: expectedVersion},
            },
        });
        expect(apply).toHaveBeenCalledWith(action, expectedVersion);
    });

    it('拒绝未知配置历史操作且不调用 service', async () => {
        const apply = vi.fn();
        const router = createBackgroundMessageRouter([
            createConfigHistoryHandler(apply),
        ]);

        await expect(router.dispatch({
            type: CONFIG_HISTORY_MESSAGE_TYPE,
            action: 'drop-all',
        }, undefined)).resolves.toEqual({
            handled: true,
            response: {success: false, error: '无效的配置历史操作'},
        });
        expect(apply).not.toHaveBeenCalled();
    });

    it('配置历史 service 失败时保留原始错误', async () => {
        const failure = new Error('history failed');
        const router = createBackgroundMessageRouter([
            createConfigHistoryHandler(async () => { throw failure; }),
        ]);

        await expect(router.dispatch({
            type: CONFIG_HISTORY_MESSAGE_TYPE,
            action: 'undo',
        }, undefined)).rejects.toBe(failure);
    });
});

describe('缓存清理后的页面失效宽限', () => {
    beforeEach(() => {vi.useFakeTimers();});
    afterEach(() => {
        expect(vi.getTimerCount()).toBe(0);
        vi.useRealTimers();
    });

    it('清库挂起不启动广播或宽限，底层完成后才开始等待页面', async () => {
        let finishClear!: () => void;
        let finishBroadcast!: () => void;
        const clear = new Promise<void>(resolve => {finishClear = resolve;});
        const broadcast = vi.fn(() => new Promise<void>(resolve => {finishBroadcast = resolve;}));
        const settled = vi.fn();
        const handler = createTranslationCacheHandler(() => clear, broadcast);
        const request = Promise.resolve(handler.handle({type: CLEAR_TRANSLATION_CACHE_MESSAGE}, undefined)).then(settled);
        try {
            await vi.advanceTimersByTimeAsync(60_000);
            expect(settled).not.toHaveBeenCalled();
            expect(broadcast).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            finishClear();
            await vi.advanceTimersByTimeAsync(0);
            expect(broadcast).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(999);
            expect(settled).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(settled).toHaveBeenCalledWith({success: true, invalidationPending: true});
        } finally {
            finishClear();
            finishBroadcast();
            await request;
        }
    });

    it.each([undefined, false, true])('广播在宽限内返回 %s 时保留明确的完成状态', async result => {
        const handler = createTranslationCacheHandler(async () => undefined, async () => result);
        await expect(handler.handle({type: CLEAR_TRANSLATION_CACHE_MESSAGE}, undefined)).resolves.toEqual(
            result === true ? {success: true, invalidationPending: true} : {success: true},
        );
    });

    it('广播在第999毫秒完成时返回完整成功并释放宽限计时器', async () => {
        let finish!: () => void;
        const handler = createTranslationCacheHandler(async () => undefined, () => new Promise<void>(resolve => {finish = resolve;}));
        const request = handler.handle({type: CLEAR_TRANSLATION_CACHE_MESSAGE}, undefined);
        await vi.advanceTimersByTimeAsync(999);
        finish();
        await expect(request).resolves.toEqual({success: true});
    });

    it.each(['sync', 'async'] as const)('注入广播在宽限内%s拒绝时仍把原错误交给router', async kind => {
        const failure = new Error('injected broadcast failed');
        const broadcast = () => {
            if (kind === 'sync') throw failure;
            return Promise.reject(failure);
        };
        const router = createBackgroundMessageRouter([createTranslationCacheHandler(async () => undefined, broadcast)]);
        await expect(router.dispatch({type: CLEAR_TRANSLATION_CACHE_MESSAGE}, undefined)).rejects.toBe(failure);
    });

    it('宽限后注入广播的迟到拒绝已被观察，不能二次回复', async () => {
        let fail!: (error: Error) => void;
        const settled = vi.fn();
        const handler = createTranslationCacheHandler(async () => undefined, () => new Promise<void>((_, reject) => {fail = reject;}));
        const request = Promise.resolve(handler.handle({type: CLEAR_TRANSLATION_CACHE_MESSAGE}, undefined)).then(settled);
        try {
            await vi.advanceTimersByTimeAsync(1_000);
            expect(settled).toHaveBeenCalledWith({success: true, invalidationPending: true});
        } finally {
            fail(new Error('late injected broadcast failure'));
            await request;
        }
        await vi.advanceTimersByTimeAsync(10_000);
        expect(settled).toHaveBeenCalledTimes(1);
    });
});

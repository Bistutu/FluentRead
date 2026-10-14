import {describe, expect, it, vi} from 'vitest';

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
        await expect(failedBroadcast()).resolves.toBeUndefined();
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

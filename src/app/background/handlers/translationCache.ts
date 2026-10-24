/**
 * @file src/app/background/handlers/translationCache.ts
 * 文件职责：把翻译缓存用量统计与清空封装为类型化后台消息处理器，为设置、popup 和旧 content 消息提供一致响应。
 * 主要内容：声明统计、clearTranslationCache 请求与清理完成广播，严格等待底层清理后给网页失效通知一秒宽限，区分后台已清空与部分页面通知尚未确认，并兼容原逐标签适配器。
 * 模块边界：本文件不直接访问 IndexedDB、内存缓存或页面 localStorage，也不决定清理代次；缓存一致性和旧写入排空由 translation cache 服务负责。
 */
import type {BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';
import type {TranslationCacheStats} from '@/src/services/translation/cache';

export const CLEAR_TRANSLATION_CACHE_MESSAGE = 'clearTranslationCache' as const;
export const TRANSLATION_CACHE_CLEARED_MESSAGE = 'translationCacheCleared' as const;
export const GET_TRANSLATION_CACHE_STATS_MESSAGE = 'getTranslationCacheStats' as const;
const INVALIDATION_GRACE_MS = 1_000;

/** 统计由后台缓存所有者读取，不暴露任何缓存键、译文或用户凭据。 */
export function createTranslationCacheStatsHandler(
    getStats: () => Promise<TranslationCacheStats>,
): BackgroundMessageHandler<unknown, {type: typeof GET_TRANSLATION_CACHE_STATS_MESSAGE}> {
    return {
        type: GET_TRANSLATION_CACHE_STATS_MESSAGE,
        async handle() {
            return {success: true, stats: await getStats()};
        },
    };
}

/** 将设置用量查询与已有清空协议注册为同一组缓存能力。 */
export function createTranslationCacheHandlers(
    clear: () => Promise<void>,
    getStats: () => Promise<TranslationCacheStats>,
    broadcast: () => Promise<void | boolean>,
): Array<BackgroundMessageHandler<unknown>> {
    return [createTranslationCacheHandler(clear, broadcast), createTranslationCacheStatsHandler(getStats)];
}

export interface ClearTranslationCacheMessage {
    type: typeof CLEAR_TRANSLATION_CACHE_MESSAGE;
}
export interface ClearTranslationCacheResponse {
    success: true;
    invalidationPending?: true;
}

export interface TranslationCacheInvalidationBroadcastAdapter {
    broadcastTabMessage?(message: {type: typeof TRANSLATION_CACHE_CLEARED_MESSAGE}): Promise<void>;
    queryTabs(): Promise<Array<{id?: number}>>;
    sendTabMessage(tabId: number, message: {type: typeof TRANSLATION_CACHE_CLEARED_MESSAGE}): Promise<unknown>;
    warn(message: string, error: unknown): void;
}

/** 逐标签页通知 content；受限页面或已关闭 tab 不回滚已完成的缓存清理。 */
export function createTranslationCacheInvalidationBroadcaster(
    adapter: TranslationCacheInvalidationBroadcastAdapter,
): () => Promise<void | boolean> {
    return async () => {
        try {
            if (adapter.broadcastTabMessage) {
                await adapter.broadcastTabMessage({type: TRANSLATION_CACHE_CLEARED_MESSAGE});
                return;
            }
            const tabs = await adapter.queryTabs();
            await Promise.allSettled(tabs
                .filter((tab): tab is {id: number} => typeof tab.id === 'number')
                .map((tab) => adapter.sendTabMessage(tab.id, {type: TRANSLATION_CACHE_CLEARED_MESSAGE})));
        } catch (error) {
            adapter.warn('[FluentRead] 翻译缓存清理完成广播失败', error);
            return true;
        }
    };
}

/** 创建翻译缓存清理 handler；具体缓存实现由 composition root 注入。 */
export function createTranslationCacheHandler(
    clearTranslationCache: () => Promise<void>,
    broadcastInvalidation: () => Promise<void | boolean>,
): BackgroundMessageHandler<unknown, ClearTranslationCacheMessage, ClearTranslationCacheResponse> {
    return {
        type: CLEAR_TRANSLATION_CACHE_MESSAGE,
        async handle() {
            // 步骤 1：同时清理持久译文缓存和 broker 的页面摘要缓存。
            await clearTranslationCache();
            // 步骤 2：底层成功后再失效 content 会话缓存，清理失败时保留当前会话。
            // 挂起页面不应拖住管理界面；这里只限制回复等待，原广播继续投递，
            // Promise.race 也会观察它的迟到拒绝。注入端口在宽限内拒绝仍交给 router。
            let timer: ReturnType<typeof setTimeout>;
            const timeout = new Promise<true>(resolve => {
                timer = setTimeout(() => resolve(true), INVALIDATION_GRACE_MS);
            });
            try {
                const pending = await Promise.race([broadcastInvalidation(), timeout]);
                return pending === true ? {success: true, invalidationPending: true} : {success: true};
            } finally {
                clearTimeout(timer!);
            }
        },
    };
}

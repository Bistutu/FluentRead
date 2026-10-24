/**
 * @file src/services/translation/cacheRequest.ts
 * 文件职责：为缓存统计和清理消息提供共享的有界等待及调用者取消协议。
 * 主要内容：以十五秒单请求上限和可选的单调时钟截止限制等待，离页时立即移除计时器与取消监听；迟到响应和拒绝只由既有竞速接住，不改变已经结束的结果。声明清库确认后页面同步仍可能未完成的结果类型。
 * 模块边界：不导入浏览器单例、不访问缓存、不取消后台清库或释放存储屏障；消息传输由调用方注入，界面负责区分未确认清理与已清库但页面仍同步。
 */
export const CACHE_REQUEST_TIMEOUT_MS = 15_000;
export type TranslationCacheRequestType = 'getTranslationCacheStats' | 'clearTranslationCache';
export interface CacheRequestOptions {
    signal?: AbortSignal;
    /** 与 performance.now() 相同的时间域，供清库及随后统计共享整体等待预算。 */
    deadline?: number;
}
export interface TranslationCacheClearResult {
    invalidationPending: boolean;
}

export class TranslationCacheRequestTimeoutError extends Error {
    constructor() {
        super('缓存管理请求超时');
        this.name = 'TranslationCacheRequestTimeoutError';
    }
}

export async function sendTranslationCacheRequest<T extends TranslationCacheRequestType>(
    sendMessage: (message: {type: T}) => Promise<unknown>,
    type: T,
    {signal, deadline}: CacheRequestOptions = {},
): Promise<unknown> {
    const remaining = deadline === undefined ? CACHE_REQUEST_TIMEOUT_MS
        : Math.min(CACHE_REQUEST_TIMEOUT_MS, deadline - performance.now());
    if (signal?.aborted) throw new DOMException('缓存管理等待已取消', 'AbortError');
    if (!(remaining > 0)) throw new TranslationCacheRequestTimeoutError();
    let timer!: ReturnType<typeof setTimeout>;
    let cancel!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
        cancel = () => reject(new DOMException('缓存管理等待已取消', 'AbortError'));
        signal?.addEventListener('abort', cancel, {once: true});
        timer = setTimeout(() => reject(new TranslationCacheRequestTimeoutError()), remaining);
    });
    try {
        // 同步抛错也转成已被竞速观察的拒绝；发送端同步取消后抛错时，
        // 取消 Promise 不能因参数求值提前退出而成为未处理拒绝。
        const response = new Promise<unknown>(resolve => resolve(sendMessage({type})));
        return await Promise.race([response, interrupted]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
    }
}

/**
 * @file src/app/popup/cache.ts
 * 文件职责：为 Popup 的缓存清理按钮提供小型协议适配器，把 runtime.sendMessage 的未知返回值收窄成明确成功或抛错行为。
 * 主要内容：定义 clearTranslationCache 请求结构，复用可取消的有界消息等待，验证 response.success 和页面失效同步状态；失败时优先使用后台返回的 error 字符串，否则抛出统一的缓存清理失败错误。取消和超时只结束当前调用者等待，不取消后台清理。
 * 模块边界：本文件不访问任何缓存介质、不更新 Popup 通知状态，也不安装消息监听；实际清理由 background handler 与 translation cache 服务执行。
 */
import {sendTranslationCacheRequest, type CacheRequestOptions, type TranslationCacheClearResult} from '@/src/services/translation/cacheRequest';

export interface TranslationCacheClearRequest {
    type: 'clearTranslationCache';
}

/** Popup 直接请求后台清库，并且只把后台明确确认的成功当作成功。 */
export async function requestTranslationCacheClear(
    sendMessage: (message: TranslationCacheClearRequest) => Promise<unknown>,
    options: CacheRequestOptions = {},
): Promise<TranslationCacheClearResult> {
    const response = await sendTranslationCacheRequest(sendMessage, 'clearTranslationCache', options);
    if (response && typeof response === 'object' && (response as {success?: unknown}).success === true) {
        const {invalidationPending} = response as {invalidationPending?: unknown};
        if (invalidationPending !== undefined && typeof invalidationPending !== 'boolean') throw new Error('后台缓存清理同步状态无效');
        return {invalidationPending: invalidationPending === true};
    }

    const error = response && typeof response === 'object'
        && typeof (response as {error?: unknown}).error === 'string'
        ? (response as {error: string}).error
        : '后台未确认缓存清理成功';
    throw new Error(error);
}

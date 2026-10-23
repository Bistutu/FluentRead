/**
 * @file src/app/content/cacheMessage.ts
 * 文件职责：兼容旧 content clearCache 消息，把页面侧请求安全转发到新的类型化后台缓存清理 handler，并保留真实失败信息。
 * 主要内容：定义旧响应结构，调用 clearTranslationCache 后台消息，验证 success 确认；对同步发送失效、非预期响应和 Promise rejection 分别生成可传输错误并调用原 sendResponse。
 * 模块边界：这里只承担协议桥接，不直接清理页面或扩展缓存、不吞掉后台错误，也不注册 runtime listener；新协议实现位于 background/handlers/translationCache。
 */
export interface LegacyCacheClearResponse {
    success: boolean;
    error?: string;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 把旧 content `clearCache` 消息转发给类型化后台 handler，并保留真实失败。 */
export function forwardLegacyCacheClear(
    sendBackgroundMessage: (message: {type: 'clearTranslationCache'}) => Promise<unknown>,
    sendResponse: (response: LegacyCacheClearResponse) => void,
): void {
    let request: Promise<unknown>;
    try { request = sendBackgroundMessage({type: 'clearTranslationCache'}); }
    catch (error) { sendResponse({success: false, error: errorMessage(error)}); return; }
    void request
        .then((response: unknown) => {
            if (response && typeof response === 'object'
                && (response as {success?: unknown}).success === true) {
                sendResponse({success: true});
                return;
            }
            const error = response && typeof response === 'object'
                && typeof (response as {error?: unknown}).error === 'string'
                ? (response as {error: string}).error
                : '后台未确认缓存清理成功';
            sendResponse({success: false, error});
        })
        .catch((error: unknown) => sendResponse({success: false, error: errorMessage(error)}));
}

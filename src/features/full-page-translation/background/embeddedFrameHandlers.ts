/**
 * @file src/features/full-page-translation/background/embeddedFrameHandlers.ts
 * 文件职责：在受支持文章顶层与跨域正文 iframe 之间转发全文会话状态。
 * 主要内容：凭浏览器提供的 tab、frameId 和 URL 验证来源，向顶层请求状态，并向同标签页广播刷新。
 * 模块边界：不读取页面凭据、正文或 DOM；真实会话快照只由经过认证的顶层 content 返回。
 */
import type {BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';
import {
    EMBEDDED_FRAME_CHANGED, EMBEDDED_FRAME_COMMAND, EMBEDDED_FRAME_REFRESH,
    EMBEDDED_FRAME_REQUEST, isSupportedEmbeddedFramePair, isSupportedEmbeddedTopUrl,
    parseEmbeddedFrameRequest, type EmbeddedFrameRequest,
} from '../embeddedFrames';

export interface EmbeddedFrameBackgroundContext {
    sender?: {frameId?: number; url?: string; tab?: {id?: number; url?: string}};
}

export interface EmbeddedFrameHandlerDependencies {
    sendTabMessage(tabId: number, message: unknown, options?: {frameId: number}): Promise<unknown>;
}

function senderTab(context: EmbeddedFrameBackgroundContext): {tabId: number; frameId: number; url: string; topUrl: string} | null {
    const sender = context.sender;
    const tabId = sender?.tab?.id;
    const frameId = sender?.frameId;
    const url = sender?.url;
    const topUrl = sender?.tab?.url;
    return Number.isSafeInteger(tabId) && tabId! >= 0 && Number.isSafeInteger(frameId) && frameId! >= 0 &&
        typeof url === 'string' && typeof topUrl === 'string'
        ? {tabId: tabId!, frameId: frameId!, url, topUrl} : null;
}

export function createEmbeddedFrameBackgroundHandlers(
    dependencies: EmbeddedFrameHandlerDependencies,
): [BackgroundMessageHandler<EmbeddedFrameBackgroundContext, EmbeddedFrameRequest>,
    BackgroundMessageHandler<EmbeddedFrameBackgroundContext, {type: typeof EMBEDDED_FRAME_CHANGED}>] {
    return [
        {
            type: EMBEDDED_FRAME_REQUEST,
            async handle(message, context) {
                const sender = senderTab(context);
                const request = parseEmbeddedFrameRequest(message);
                if (!sender || sender.frameId === 0 || !request ||
                    !isSupportedEmbeddedFramePair(sender.topUrl, sender.url)) return {success: false};
                try {
                    return await dependencies.sendTabMessage(sender.tabId, {
                        type: EMBEDDED_FRAME_COMMAND, action: request.action,
                        ...(request.invocation ? {invocation: request.invocation} : {}),
                    }, {frameId: 0});
                } catch { return {success: false}; }
            },
        },
        {
            type: EMBEDDED_FRAME_CHANGED,
            async handle(message, context) {
                const sender = senderTab(context);
                if (!sender || sender.frameId !== 0 || sender.url !== sender.topUrl ||
                    !isSupportedEmbeddedTopUrl(sender.url) || !message ||
                    Object.keys(message).length !== 1) return {success: false};
                try { await dependencies.sendTabMessage(sender.tabId, {type: EMBEDDED_FRAME_REFRESH}); }
                catch { /* iframe 可能尚未载入；下次初始化会主动读取会话。 */ }
                return {success: true};
            },
        },
    ];
}

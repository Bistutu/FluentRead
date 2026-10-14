/**
 * @file src/features/full-page-translation/background/neteaseMailFrameHandlers.ts
 * 文件职责：仅为网易免费邮箱阅读页向正文子 frame 转发翻译会话状态。
 * 主要内容：核对标签页、顶层阅读路由、子文档 URL 与 frameId，拒绝未知消息字段并定向转发。
 * 模块边界：不读取邮件、sid 或配置；顶层内容脚本仍拥有全文会话真值。
 */
import type {BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';
import {
    isNeteaseMailChildUrl, isNeteaseMailReadUrl, isNeteaseMailTopUrl, parseNeteaseMailFrameChanged,
    parseNeteaseMailFrameRequest, NETEASE_MAIL_FRAME_CHANGED_MESSAGE_TYPE,
    NETEASE_MAIL_FRAME_COMMAND_MESSAGE_TYPE, NETEASE_MAIL_FRAME_REFRESH_MESSAGE_TYPE,
    NETEASE_MAIL_FRAME_REQUEST_MESSAGE_TYPE, type NeteaseMailFrameRequest,
} from '../neteaseMailFrames';

export interface NeteaseMailFrameBackgroundContext {
    sender?: {frameId?: number; url?: string; origin?: string; tab?: {id?: number; url?: string}};
}

export function createNeteaseMailFrameBackgroundHandlers(dependencies: {
    sendTabMessage(tabId: number, message: unknown, options?: {frameId: number}): Promise<unknown>;
}): BackgroundMessageHandler<NeteaseMailFrameBackgroundContext>[] {
    const senderTab = (context: NeteaseMailFrameBackgroundContext) => {
        const sender = context.sender;
        const tabId = sender?.tab?.id;
        return sender && Number.isSafeInteger(tabId) && typeof tabId === 'number' && tabId >= 0
            ? {sender, tabId} : null;
    };
    return [
        {
            type: NETEASE_MAIL_FRAME_REQUEST_MESSAGE_TYPE,
            async handle(message: NeteaseMailFrameRequest, context) {
                const value = senderTab(context);
                const request = parseNeteaseMailFrameRequest(message);
                if (!value || !Number.isSafeInteger(value.sender.frameId) || value.sender.frameId! <= 0
                    || !isNeteaseMailReadUrl(value.sender.tab?.url)
                    || !isNeteaseMailChildUrl(value.sender.url, value.sender.tab?.url)
                    || (value.sender.origin !== undefined
                        && value.sender.origin !== new URL(value.sender.tab!.url!).origin)
                    || !request) return {success: false};
                try {
                    return await dependencies.sendTabMessage(value.tabId, {
                        type: NETEASE_MAIL_FRAME_COMMAND_MESSAGE_TYPE,
                        action: request.action,
                        ...(request.invocation ? {invocation: request.invocation} : {}),
                    }, {frameId: 0});
                } catch { return {success: false}; }
            },
        },
        {
            type: NETEASE_MAIL_FRAME_CHANGED_MESSAGE_TYPE,
            async handle(message, context) {
                const value = senderTab(context);
                if (!value || value.sender.frameId !== 0
                    || !isNeteaseMailTopUrl(value.sender.url)
                    || !isNeteaseMailTopUrl(value.sender.tab?.url)
                    || new URL(value.sender.url!).origin !== new URL(value.sender.tab!.url!).origin
                    || !parseNeteaseMailFrameChanged(message)) return {success: false};
                try {
                    await dependencies.sendTabMessage(value.tabId, {type: NETEASE_MAIL_FRAME_REFRESH_MESSAGE_TYPE});
                } catch { /* 子文档尚未创建或已卸载。 */ }
                return {success: true};
            },
        },
    ];
}

/**
 * @file src/app/content/pageTranslationFontMessage.ts
 * 文件职责：把 popup 的当前页字体查询与切换消息映射到文档私有控制器，并拒绝其他扩展或过期页面命令。
 * 主要内容：验证扩展 sender、页面启用与上下文状态，使用全文文档实例标识和当前完整 URL 校验写入请求，返回可供界面复验的快照。
 * 模块边界：不注册监听器、不写配置、不持有 DOM 样式；字体控制器由当前 content composition root 注入，未装配的上下文返回 unavailable。
 */
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import {config} from '@/src/services/config/store';
import {getFullPageTranslationDocumentToken} from './features';
import type {PageTranslationFontRuntime} from './pageTranslationFont';

export interface PageTranslationFontMessageState {
    isSiteDisabled(): boolean;
    isPageSuspended?(): boolean;
    pageTranslationFont?: PageTranslationFontRuntime;
}

export function handlePageTranslationFontMessage(
    payload: Record<string, unknown>, sender: unknown, ctx: ContentScriptContext,
    state: PageTranslationFontMessageState, sendResponse: (response?: unknown) => void,
): boolean | undefined {
    if (payload.type !== 'getPageTranslationFontState' && payload.type !== 'setPageTranslationFont') return undefined;
    const senderId = sender && typeof sender === 'object' ? (sender as {id?: unknown}).id : undefined;
    let extensionId: string | undefined;
    try { extensionId = browser.runtime.id; } catch { /* 扩展重载后 runtime 访问本身可能失效。 */ }
    if (typeof extensionId !== 'string' || !extensionId || senderId !== extensionId || ctx.isInvalid || config.on === false ||
        state.isPageSuspended?.() || !state.pageTranslationFont) {
        sendResponse({status: 'unavailable'});
        return true;
    }
    if (state.isSiteDisabled()) {
        sendResponse({status: 'disabled'});
        return true;
    }
    const documentToken = getFullPageTranslationDocumentToken();
    const pageUrl = window.location.href;
    if (payload.type === 'setPageTranslationFont') {
        if (typeof payload.browserDefault !== 'boolean') {
            sendResponse({status: 'unavailable'});
            return true;
        }
        if (payload.documentToken !== documentToken || payload.pageUrl !== pageUrl) {
            sendResponse({status: 'stale'});
            return true;
        }
        if (!state.pageTranslationFont.set(payload.browserDefault)) {
            sendResponse({status: 'unavailable'});
            return true;
        }
    }
    sendResponse({status: 'success', browserDefault: state.pageTranslationFont.read(), documentToken, pageUrl});
    return true;
}

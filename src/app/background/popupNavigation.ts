/**
 * @file src/app/background/popupNavigation.ts
 * 文件职责：为悬浮球默认 popup 导航装配浏览器端口，统一原生面板和兼容小窗的页面来源。
 * 主要内容：按 manifest 版本选择 action/browserAction，读取已声明的默认 popup，为兼容小窗携带来源标签页标识。
 * 模块边界：仅装配浏览器 API；消息校验和降级顺序属于 floating-ball feature，来源网页解析属于 popup app。
 */
import {createOpenPopupHandler} from '@/src/features/floating-ball/background/popupHandler';
export type {PopupContext} from '@/src/features/floating-ball/background/popupHandler';

export function createPopupNavigationHandler(manifestVersion: 2 | 3) {
    return createOpenPopupHandler({
        openNativePopup: (options) => (manifestVersion === 3 ? browser.action : browser.browserAction).openPopup(options),
        openPopupWindow: async (tabId) => {
            const manifest = browser.runtime.getManifest();
            const popup = manifest.action?.default_popup || manifest.browser_action?.default_popup;
            if (!popup) throw new Error('未配置扩展快捷面板');
            const url = new URL(browser.runtime.getURL(popup));
            url.searchParams.set('sourceTabId', String(tabId));
            await browser.windows.create({url: url.href, type: 'popup', width: 420, height: 640});
        },
    });
}

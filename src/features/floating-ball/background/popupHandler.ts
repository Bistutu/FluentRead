/**
 * @file src/features/floating-ball/background/popupHandler.ts
 * 文件职责：接收悬浮球打开扩展快捷面板的请求，调用浏览器已声明的默认 popup。
 * 主要内容：从浏览器消息发送方读取来源标签页与窗口，优先打开原生 popup；浏览器拒绝时用相同 popup 页打开关联来源网页的小窗。
 * 模块边界：不创建设置页、不读取网页传入的窗口或标签页标识；浏览器 API 与 popup URL 由 app 组合根注入。
 */
export interface PopupContext {
    sender?: {tab?: {id?: number; windowId?: number}};
}

export interface PopupNavigation {
    openNativePopup(options: {windowId: number}): Promise<unknown>;
    openPopupWindow(tabId: number): Promise<unknown>;
}

/** 保持浏览器原生 popup 与当前网页的关联；失败交由统一消息路由器返回。 */
export function createOpenPopupHandler(navigation: PopupNavigation) {
    return {
        type: 'openPopup' as const,
        async handle(_message: {type: 'openPopup'}, context: PopupContext): Promise<{success: true}> {
            const windowId = context.sender?.tab?.windowId;
            const tabId = context.sender?.tab?.id;
            if (typeof windowId !== 'number' || !Number.isInteger(windowId) || windowId < 0
                || typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId < 0) {
                throw new TypeError('无法确定悬浮球所在窗口');
            }
            try {
                await navigation.openNativePopup({windowId});
            } catch {
                // 旧版 Chromium 与 Firefox 的用户手势限制不应把入口退回完整设置页。
                await navigation.openPopupWindow(tabId);
            }
            return {success: true};
        },
    };
}

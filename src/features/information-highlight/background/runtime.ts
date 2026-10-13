/**
 * @file src/features/information-highlight/background/runtime.ts
 * 文件职责：装配信息高亮后台 handler 与已有扩展 DOM 传输。
 * 主要内容：注入扩展 ID 和 options/popup 来源白名单，注册公开消息；不持有模型或页面正文。
 * 模块边界：平台装配只在本组合出口，算法和下载在独立离屏 Worker 能力内。
 */
import {createInformationHighlightBackgroundHandlers} from './handlers';
import {createInformationHighlightOffscreenAdapter} from './offscreenAdapter';
export function createInformationHighlightBackgroundRuntime() {
    const urls = [browser.runtime.getURL('/options.html'), browser.runtime.getURL('/popup.html')];
    return createInformationHighlightBackgroundHandlers({runtimeId: browser.runtime.id, offscreen: createInformationHighlightOffscreenAdapter(),
        isUi: url => urls.includes(url.split(/[?#]/u)[0]), isDocument: url => url.split(/[?#]/u)[0] === browser.runtime.getURL('/document.html')});
}

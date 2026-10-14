/**
 * @file userscript/languageBundles.ts
 * 文件职责：在构建期保留 userscript 可呈现的界面文案，维持已发布语言资源的固定内容。
 * 主要内容：剔除没有扩展 popup 和本地模型后端的信息高亮文案、没有原生右键菜单发送者的操作失败通知，以及没有视频字幕运行时的完整句学习文案、扩展 Popup 专用缩写和新增文档页的进度、续译与旧校订文案；已发布远程词典中的旧文档键保留原内容。脚本内联动态模块与样式，五种固定远程词典不新增扩展分块加载失败或 AI 翻译超时文案，注册时由脚本补齐；中英内嵌词典保留可用页面的新文案。
 * 模块边界：只投影静态字典，不改变扩展词典、资源提交号或运行时语言装载协议。
 */
import {UI_LANGUAGE_BUNDLES as extensionBundles} from '../src/core/i18n/bundles';
import {zhCNMessages as extensionChinese} from '../src/core/i18n/messages/zh-CN';
export function userscriptMessages<T extends Record<string, string>>(messages: T): T {
    return Object.fromEntries(Object.entries(messages).filter(([key]) => !key.startsWith('informationHighlight.')
        && !key.startsWith('contextMenu.notice.') && !key.startsWith('video.learning.')
        && !key.startsWith('popup.compact.') && !key.startsWith('document.translationRecovery.')
        && !key.startsWith('document.retainedRevisions.') && !key.startsWith('document.translationProgress.'))) as T;
}
export const zhCNMessages = userscriptMessages(extensionChinese);
export const UI_LANGUAGE_BUNDLES = Object.fromEntries(Object.entries(extensionBundles).map(([language, bundle]) => {
    const messages: Record<string, string> = userscriptMessages(bundle.messages);
    if (language !== 'en-US') {
        delete messages['learning.panelLoadError'];
        delete messages['learning.reloadPage'];
        // 新超时文案随脚本注册补齐，保持已发布远端资源的内容摘要与固定提交号。
        delete messages['settings.requestLimits.aiTimeout'];
        delete messages['settings.requestLimits.aiTimeoutHelp'];
        delete messages['settings.requestLimits.seconds'];
    }
    return [language, {...bundle, messages}];
})) as typeof extensionBundles;

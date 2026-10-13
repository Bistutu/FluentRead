/**
 * @file src/app/document-translation/page.ts
 * 文件职责：提供文档翻译页面的最小 Vue 挂载函数，把 WXT 页面入口与 DocumentApp 组件及其页面样式连接起来。
 * 主要内容：导入 DocumentApp 与页面样式，创建 Vue 应用和按需 PDF 划词卡片；页面卸载同步释放两者的运行时资源。
 * 模块边界：这里不处理文件或配置；WXT entrypoint 决定启动时机，文档业务在组件与 feature 中，划词生命周期由 selectionRuntime 管理。
 */
import {createApp} from 'vue';
import DocumentApp from './DocumentApp.vue';
import './document-page.css';
import {createUiI18nPlugin} from '@/src/ui/i18n';
import {mountDocumentSelectionTranslation} from './selectionRuntime';

/** 文档翻译 WXT 页面唯一挂载入口。 */
export function mountDocumentTranslationApp(selector: string): void {
    const app = createApp(DocumentApp);
    app.use(createUiI18nPlugin({documentRoot: document.body, documentTitleKey: 'metadata.documentTitle'}));
    app.mount(selector);
    const selection = mountDocumentSelectionTranslation({root: document.body});
    app.onUnmount(selection.dispose);
}

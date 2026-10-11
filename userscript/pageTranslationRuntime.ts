/**
 * @file userscript/pageTranslationRuntime.ts
 * 文件职责：提供 userscript 启动消息桥需要的三个页面翻译控制出口。
 * 主要内容：仅再导出全文翻译、活动状态查询和恢复原文，避免启动并发加载物化所有内容 feature 的命名空间。
 * 模块边界：复用既有 feature 公共实现，不挂载内容、不注册监听器；仍由 main 动态加载。
 */
export {
    autoTranslateEnglishPage,
    isFullPageTranslationActive,
    restoreOriginalContent,
} from '@/src/app/content/features';

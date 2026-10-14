/**
 * @file src/features/full-page-translation/background/index.ts
 * 文件职责：提供全文翻译后台状态子模块的单一导入入口，把标签页翻译状态和站点禁用状态处理器契约集中暴露给后台注册表。
 * 主要内容：文件完整再导出 stateHandlers.ts 中的消息常量、运行时消息类型、存储依赖和 createFullPageTranslationStateHandlers 工厂。
 * 模块边界：此处不监听 browser.runtime，也不持有标签页状态；实际校验与读写在 stateHandlers，handler 注册和统一错误响应属于 src/services/messaging/backgroundRouter。
 */
export * from './stateHandlers';

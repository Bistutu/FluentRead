/**
 * @file src/features/full-page-translation/content/public.ts
 * 文件职责：向其他内容功能提供已注册译文根的只读查询、公共样式与当前页字体的专属根订阅及外观变化前的受控渲染清理端口。
 * 主要内容：导出可见译文根查询、公共样式的开放根订阅、覆盖自有闭合仅译文槽的字体根登记与文档内旧尺寸隔离的撤销，保持译文工件所有权，不暴露会话或翻译运行时。
 * 模块边界：这是无平台依赖的 content 公共出口，正文收集、文档评分与样式接线不会间接启动完整翻译或配置存储。
 */
export {readVisibleTranslationRoot} from './visibleTranslation';
export {releaseDocumentBilingualRenderingContainment} from './state';
export {subscribeTranslationStyleRoots} from './styleRoots';
export {subscribeTranslationFontStyleRoots, type TranslationFontStyleRoot} from './fontStyleRoots';

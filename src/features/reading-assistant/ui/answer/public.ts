/**
 * @file src/features/reading-assistant/ui/answer/public.ts
 * 文件职责：公开阅读回答的纯展示组件，供写作草稿、设置预览和词书共用。
 * 主要内容：仅导出 ReadingAnswer 及其组件自有样式，保持安全 Markdown 与句子结构呈现。
 * 模块边界：不引入有交互状态的 ReadingPanel 或设置页记录管理界面；请求与生命周期仍由调用方负责。
 */
export {default as ReadingAnswer} from '../ReadingAnswer.vue';

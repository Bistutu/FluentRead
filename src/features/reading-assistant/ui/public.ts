/**
 * @file src/features/reading-assistant/ui/public.ts
 * 文件职责：向学习中心公开阅读记录管理界面，避免划词和网页写作装载仅设置页使用的管理样式。
 * 主要内容：静态导出 HarnessReadingHistory 组件，由学习中心负责挂载、导航和页面生命周期。
 * 模块边界：此入口只提供设置页管理 UI；网页阅读卡和回答分别通过 ui/panel/public.ts 与 ui/answer/public.ts 公开，流式请求与选区契约继续使用 reading-assistant/public.ts。
 */
export {default as HarnessReadingHistory} from './HarnessReadingHistory.vue';

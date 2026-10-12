/**
 * @file src/features/writing-assistant/public.ts
 * 文件职责：提供写作助手的公开内容生命周期，并保留已有偏好选项组件导出契约。
 * 主要内容：为支持的网页导出挂载状态；设置页通过独立 ui/public.ts 取得 WritingChoices，避免加载网页写作卡片。
 * 模块边界：此入口供内容组合层挂载真实写作能力，选项组件不保存配置或请求模型，后台协议由应用层单独组装。
 */
export {mountWritingAssistant, unmountWritingAssistant, isWritingAssistantMounted} from './content';
export {default as WritingChoices} from './ui/WritingChoices.vue';

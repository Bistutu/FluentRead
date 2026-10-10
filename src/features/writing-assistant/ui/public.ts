/**
 * @file src/features/writing-assistant/ui/public.ts
 * 文件职责：向设置页提供写作偏好共用的互斥选项组件，避免加载网页写作卡片。
 * 主要内容：仅导出 WritingChoices，由调用方传入选项、选中值与禁用状态并处理修改。
 * 模块边界：不引入写作内容生命周期、编辑器适配或模型客户端；真实写作卡片继续由 writing-assistant/public.ts 挂载。
 */
export {default as WritingChoices} from './WritingChoices.vue';

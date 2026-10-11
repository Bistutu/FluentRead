/**
 * @file src/features/progressive-reading/public.ts
 * 文件职责：公开渐进阅读辅助的主动入口与内容生命周期。
 * 主要内容：供应用组合根静态注册和消息路由调用 mount/open/unmount，隐藏会话、原文快照与 Vue 状态。
 * 模块边界：仅静态再导出，不挂载、不扫描、不保存用户偏好或学习数据。
 */
export {mountProgressiveReading, openProgressiveReading, unmountProgressiveReading} from './content';

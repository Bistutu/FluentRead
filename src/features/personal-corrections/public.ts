/**
 * @file src/features/personal-corrections/public.ts
 * 文件职责：向内容 composition root 公开网页个人校订的生命周期与端口契约。
 * 主要内容：导出封闭 Shadow UI 的挂载和卸载入口、原译文对与页面读取刷新契约。
 * 模块边界：不在顶层挂载 UI，不导出控制器私有状态；全文翻译保持自己的 DOM 与会话所有权。
 */
export {mountPersonalCorrections, unmountPersonalCorrections} from './content/runtime';
export type {PersonalCorrectionPair, PersonalCorrectionUiPorts} from './types';

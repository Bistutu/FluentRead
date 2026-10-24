/**
 * @file src/features/full-page-translation/ui/public.ts
 * 文件职责：向实际显示进度浮层的内容应用公开进度面板生命周期。
 * 主要内容：重导出面板挂载与卸载，让只使用翻译控制和状态的受限 frame 不引入 Vue 面板样式。
 * 模块边界：只提供 UI 装配出口；进度状态仍从 feature 根 public 读取，面板实现继续由 content/progressPanel 拥有。
 */
export {mountTranslationProgressPanel, unmountTranslationProgressPanel} from '../content/progressPanel';

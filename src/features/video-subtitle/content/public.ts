/**
 * @file src/features/video-subtitle/content/public.ts
 * 文件职责：向材料恢复适配器公开当前媒体的可靠来源识别。
 * 主要内容：复用字幕学习已使用的 YouTube 与 X 视频身份核对，不加载 Vue、字幕运行时或翻译服务。
 * 模块边界：仅来源适配器可见，不暴露播放器节点所有权或改变播放状态。
 */
export {getVideoLearningSource} from './learningSource';

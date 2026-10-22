/**
 * @file src/app/offscreen/readingAnnotationWorker.ts
 * 文件职责：提供读音标注 Worker 的静态应用组合入口。
 * 主要内容：将视频读音 feature 的 Worker 启动函数公开给 WXT 独立脚本入口。
 * 模块边界：不处理浏览器消息、初始化词典或拥有请求队列；这些职责由 reading feature 与离屏运行时管理。
 */
export {startReadingAnnotationWorker as startReadingAnnotationWorkerApp} from '@/src/features/video-subtitle/reading/worker';

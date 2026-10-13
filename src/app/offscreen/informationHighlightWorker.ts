/**
 * @file src/app/offscreen/informationHighlightWorker.ts
 * 文件职责：提供信息高亮模型 Worker 的静态应用组合出口。
 * 主要内容：转出 feature Worker 启动函数；模型和协议不放入 WXT 入口。
 * 模块边界：不管理下载、不接触网页或持久偏好。
 */
export {startInformationHighlightWorker as startInformationHighlightWorkerApp} from '@/src/features/information-highlight/offscreen/worker';

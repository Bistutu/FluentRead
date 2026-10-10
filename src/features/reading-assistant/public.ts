/**
 * @file src/features/reading-assistant/public.ts
 * 文件职责：提供可被划词翻译和设置页复用的阅读卡、回答呈现、选区捕获及纯数据契约。
 * 主要内容：导出阅读卡、共用 Markdown 回答及纯文本结构解析、选区捕获、流式阅读与学习记忆客户端；仅设置页使用的阅读记录管理界面由 ui/public.ts 单独公开。
 * 模块边界：此入口不引入阅读记录管理组件及其样式，不注册事件或初始化模型；跨 feature 的阅读交互保持在这个公开入口。
 */
export {default as ReadingPanel} from './ui/ReadingPanel.vue';
export {default as ReadingAnswer} from './ui/ReadingAnswer.vue';
export {readingAnswerBlocks, readingAnswerSpans} from './answerFormat';
export {captureReadingSelection} from './selectionContext';
export {createReadingEvidenceAnchor} from './evidenceAnchor';
export type {ReadingEvidenceAnchor} from './evidenceAnchor';
export {buildReadingEvidence, parseReadingEvidence} from '@/src/core/harness/evidence';
export type {ReadingEvidenceSource} from '@/src/core/harness/evidence';
export type {ReadingSelection} from './types';
export {streamReading} from './client';
export {clearLearningMemories, deleteLearningMemory, listLearningMemories, saveLearningMemory} from './client';
export type {LearningMemory} from '@/src/services/harness/learningMemory';

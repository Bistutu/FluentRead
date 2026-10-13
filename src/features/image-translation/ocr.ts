/**
 * @file src/features/image-translation/ocr.ts
 * 文件职责：为扩展自身页面提供“只识别文字、不翻译”的领域出口，让文档翻译页面可以识别扫描版 PDF 的页面图像。
 * 主要内容：再导出图片文字识别函数与识别行类型；识别语言包、Worker 与缓存沿用图片翻译已有的运行时和下载位置。
 * 模块边界：只能在拥有扩展源的页面里使用（文档页、离屏文档），内容脚本仍通过 services/client 的消息通道；本文件不触发翻译，也不暴露 Worker 细节。
 */
export {recognizeImage as recognizeImageText} from './services/ocrRuntime';
export type {OcrLine} from '@/src/shared/image/types';

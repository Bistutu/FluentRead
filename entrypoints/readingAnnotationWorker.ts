/**
 * @file entrypoints/readingAnnotationWorker.ts
 * 文件职责：声明读音标注的独立 WXT Worker 产物。
 * 主要内容：将读音应用组合入口注册为 unlisted script，供离屏页面按扩展 URL 创建模块 Worker。
 * 模块边界：只绑定构建入口，不加载词典或处理字幕请求。
 */
import {startReadingAnnotationWorkerApp} from '@/src/app/offscreen/readingAnnotationWorker';
export default defineUnlistedScript(() => startReadingAnnotationWorkerApp(self));

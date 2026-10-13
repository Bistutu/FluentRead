/**
 * @file entrypoints/informationHighlightWorker.ts
 * 文件职责：声明信息高亮的静态模块 Worker 构建入口。
 * 主要内容：绑定 app Worker 启动函数，运行时由扩展离屏页按包内 URL 创建。
 * 模块边界：仅声明 WXT 入口，不下载模型、不实施评分。
 */
import {startInformationHighlightWorkerApp} from '@/src/app/offscreen/informationHighlightWorker';
export default defineUnlistedScript(() => startInformationHighlightWorkerApp());

/**
 * @file src/features/video-subtitle/reading/worker.ts
 * 文件职责：在扩展自有 Worker 中校验并执行视频字幕读音标注。
 * 主要内容：按请求语言延迟加载本地引擎，词典下载来源和版本由本地数据层固定，字幕只在本机处理，结果以纯 DTO 回复；异常不会终止消息循环。
 * 模块边界：不读取网页、用户配置或页面提供的下载来源，不决定媒体代次；请求所有权和 Worker 释放由离屏编排控制。
 */
import {isReadingAnnotationWorkerRequest, type ReadingAnnotationWorkerResponse} from '@/src/core/messaging/readingAnnotation';
import {annotateReading} from './engine';
interface ReadingWorkerScope {
  location: {href: string};
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: ReadingAnnotationWorkerResponse): void;
}
export function startReadingAnnotationWorker(scope: ReadingWorkerScope): void {
  scope.addEventListener('message', event => {
    const request: unknown = event.data;
    if (!isReadingAnnotationWorkerRequest(request)) return;
    void annotateReading(request.text, request.language, new URL('./reading-dictionary/ja/', scope.location.href).href)
      .then(result => scope.postMessage({id:request.id,ok:true,result} satisfies ReadingAnnotationWorkerResponse),
        () => scope.postMessage({id:request.id,ok:false,error:'读音暂不可用'} satisfies ReadingAnnotationWorkerResponse));
  });
}

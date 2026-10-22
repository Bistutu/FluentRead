/**
 * @file src/features/video-subtitle/content/readingAnnotationClient.ts
 * 文件职责：将播放器读音请求通过现有 runtime 消息送到本地扩展引擎。
 * 主要内容：在无适用语言时提前返回，以独立请求标识传递取消并验证响应，拒绝取消后的迟到回包。
 * 模块边界：不加载词典或创建 Worker，不发送远程注音请求；后台统一管理本地资源与发送方隔离。
 */
import {sendRuntimeMessage} from '@/src/platform/browser/runtimeMessages';
import {browserCapabilities} from '@/src/platform/browser/capabilities';
import {getReadingAnnotationLanguage} from '@/src/core/readingAnnotation';
import {parseReadingAnnotationResponse, type VideoReadingAnnotation} from '@/src/core/messaging/readingAnnotation';

export async function annotateVideoReading(text: string, language: string, signal: AbortSignal): Promise<VideoReadingAnnotation | null> {
  const resolved = getReadingAnnotationLanguage(text, language);
  if (!resolved) return null;
  if (!browserCapabilities.extensionDom) throw new Error('读音标注目前需要浏览器扩展版');
  const abortError = () => new DOMException('读音标注已取消', 'AbortError');
  if (signal.aborted) throw abortError();
  const requestId = `reading:${crypto.randomUUID?.() || `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`}`;
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancel = () => {
    void sendRuntimeMessage({type: 'fluentReadCancelVideoReading', requestId}).catch(() => undefined);
    rejectAbort(abortError());
  };
  signal.addEventListener('abort', cancel, {once: true});
  try {
    const raw = await Promise.race([sendRuntimeMessage({type: 'fluentReadAnnotateVideoReading', text, language: resolved, requestId}), aborted]);
    if (signal.aborted) throw abortError();
    const response = parseReadingAnnotationResponse(raw);
    if (!response.success) throw new Error(response.error || '读音暂不可用');
    return response.result;
  } finally { signal.removeEventListener('abort', cancel); }
}

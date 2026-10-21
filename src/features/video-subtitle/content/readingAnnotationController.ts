/**
 * @file src/features/video-subtitle/content/readingAnnotationController.ts
 * 文件职责：为播放器当前可见原句编排读音状态和迟到结果提交资格。
 * 主要内容：在原语言与原句变化时同步清除旧读音，合并相同更新，隐藏与关闭立即取消，错误等待显式重试；使用有界会话缓存避免重复分词。
 * 模块边界：不访问 DOM、翻译服务、词典或浏览器；适配器负责当前原句与模式，onChange 只更新自有读音行及菜单。
 */
import {getReadingAnnotationLanguage} from '@/src/core/readingAnnotation';
import {VideoReadingAnnotationSession, type VideoReadingAnnotator, type VideoReadingAnnotation} from './readingAnnotationSession';
export interface VideoReadingState {status: 'idle'|'loading'|'ready'|'error'; result: VideoReadingAnnotation|null; source: string; language: string}
export function createVideoReadingController(annotate: VideoReadingAnnotator, onChange: (state: VideoReadingState) => void) {
  const session = new VideoReadingAnnotationSession(annotate);
  let state: VideoReadingState = {status:'idle',result:null,source:'',language:''};
  let currentKey = '', generation = 0, disposed = false;
  const publish = (next: VideoReadingState) => {
    if (state.status===next.status && state.source===next.source && state.language===next.language
      && state.result?.text===next.result?.text && state.result?.scheme===next.result?.scheme) return;
    state=next; onChange(state);
  };
  const clear = () => {
    generation++; currentKey=''; session.cancelPending();
    if (state.status !== 'idle' || state.source) publish({status:'idle',result:null,source:'',language:''});
  };
  return {
    get state() {return state;},
    peek: (text: string, language: string) => {
      const resolved=getReadingAnnotationLanguage(text,language);
      return resolved ? session.peek(text,resolved) : null;
    },
    sync(text: string, sourceLanguage: string, enabled: boolean): void {
      if (disposed) return;
      const source=text.replace(/[\s\u3000]+/gu,' ').trim();
      const language=enabled ? getReadingAnnotationLanguage(source,sourceLanguage) : null;
      if (!language) {clear(); return;}
      const key=JSON.stringify([source,language]);
      if (key===currentKey) return;
      currentKey=key;
      const epoch=++generation;
      const cached=session.peek(source,language);
      publish({status:cached === undefined ? 'loading' : cached ? 'ready' : 'idle',result:cached || null,source,language});
      void session.request(source,language).then(result => {
        if (!disposed && generation===epoch) publish({status:result ? 'ready':'idle',result,source,language});
      }, () => {
        // 自身切换/关闭已推进generation；仍属于当前句的异常必须结束loading，包括引擎自行中断。
        if (!disposed && generation===epoch) publish({status:'error',result:null,source,language});
      });
    },
    clear,
    retry() { currentKey=''; },
    reset() {clear(); session.clear();},
    destroy() {clear(); disposed=true; session.destroy();},
  };
}

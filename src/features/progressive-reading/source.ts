/**
 * @file src/features/progressive-reading/source.ts
 * 文件职责：将用户主动选择的网页正文转换为可复验的阅读快照。
 * 主要内容：复用阅读选区的敏感区域过滤与上下文捕获，拒绝扩展 UI、表单及代码，精确核对既有双语摘录；保留 Range 和段落所有权以拒绝 DOM/路由变化后的迟到结果。
 * 模块边界：只读原生 Selection 与真实译文公共合同，不修改、包裹或高亮宿主文字，不扫描整页、不持久化选区。
 */
import {captureReadingSelection} from '@/src/features/reading-assistant/public';
import {readBilingualExcerpt} from '@/src/features/full-page-translation/public';
import {normalizeReadingText} from './hints';
import type {ReadingSource} from './session';

const EXCLUDED = 'script,style,noscript,template,svg,math,aside,[data-fluent-read-ui],input,textarea,select,button,code,pre,nav,[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="button"],.notranslate,[data-notranslate="true"],[translate="no"],.fluent-read-bilingual-content';
export interface ReadingDomSource extends ReadingSource {range: Range; root: Element}

export function captureProgressiveSource(document: Document): ReadingDomSource | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const selected = normalizeReadingText(range.toString());
  const start = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement;
  const end = range.endContainer.nodeType === 1 ? range.endContainer as Element : range.endContainer.parentElement;
  if (!start || !end || start.closest(EXCLUDED) || end.closest(EXCLUDED) || !selected || selected.length > 4096) return null;
  const root = start.closest('p,li,blockquote,dd,dt,figcaption,h1,h2,h3,h4,h5,h6') ?? start;
  if (!root.contains(range.endContainer) || root.matches('body,html,main,article,section')) return null;
  // 选区跨越任何受保护后代时拒绝整段，不能把编辑区或代码作为普通正文送出。
  for (const element of root.querySelectorAll(EXCLUDED)) if (range.intersectsNode(element)) return null;
  const captured = captureReadingSelection(range, selected, 4000);
  const text = captured.context || captured.text;
  if (!text || text.length > 4096) return null;
  const href = document.location.href;
  let translation = '';
  for (const node of root.querySelectorAll('.fluent-read-bilingual-content[data-fr-translation-owned="true"]')) {
    const excerpt = readBilingualExcerpt(node);
    if (excerpt && normalizeReadingText(excerpt.original) === text) {translation = excerpt.translation; break;}
  }
  return {text, selected, translation, range, root, valid() {
    if (document.location.href !== href || !root.isConnected || !range.startContainer.isConnected || !range.endContainer.isConnected
      || !root.contains(range.startContainer) || !root.contains(range.endContainer) || normalizeReadingText(range.toString()) !== selected) return false;
    const currentStart = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement!;
    const currentEnd = range.endContainer.nodeType === 1 ? range.endContainer as Element : range.endContainer.parentElement!;
    if (currentStart.closest(EXCLUDED) || currentEnd.closest(EXCLUDED)) return false;
    for (const element of root.querySelectorAll(EXCLUDED)) if (range.intersectsNode(element)) return false;
    const view = document.defaultView;
    if (typeof view?.getComputedStyle === 'function') {
      for (let element: Element | null = root; element; element = element.parentElement) {
        const style = view.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
    }
    const latest = captureReadingSelection(range, selected, 4000);
    return (latest.context || latest.text) === text;
  }};
}

/**
 * @file src/features/reading-assistant/evidenceAnchor.ts
 * 文件职责：把阅读解释已校验的引文重新绑定到用户原选区所在的有限正文块。
 * 主要内容：仅保存用户许可快照、正文摘要及真实选区偏移，排除扩展译文与交互内容，临时建立有界文字映射恢复等价 DOM，并绘制短期原句高亮。
 * 模块边界：只接收可信快照和引用文字，不使用模型网址或选择器、不扫描整页、不调用翻译服务；内容变化、导航及关闭后释放所有临时资源。
 */
import type {ReadingSelection} from './types';
import {sha256Hex} from '@/src/shared/function/sha256';

export type ReadingEvidenceLocation = 'located' | 'changed' | 'navigated' | 'unavailable';
export interface ReadingEvidenceCitation {
    quote: string;
    sourceText: string;
    kind?: 'selection' | 'context';
    /** sourceText 在该 kind 已提供文本中的归一化字符起点；由本地来源构建器提供。 */
    sourceOffset?: number;
}
export interface ReadingEvidenceAnchor {
    locate(citation: ReadingEvidenceCitation): ReadingEvidenceLocation;
    /** 同步检查迟到结果仍属于当前正文，不绘制高亮。 */
    check(): ReadingEvidenceLocation;
    clear(): void;
    /** 停止本轮任务观察；后续显式检查或定位会重新启用。 */
    suspend(): void;
    dispose(): void;
}
export interface ReadingEvidenceAnchorOptions {
    signal?: AbortSignal;
    onInvalidate?: (state: 'changed' | 'navigated') => void;
}

const PROSE = 'p,li,blockquote,dd,dt,figcaption,h1,h2,h3,h4,h5,h6';
const EXCLUDED = 'script,style,noscript,template,textarea,input,select,button,code,pre,svg,math,nav,aside,[inert],[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="button"],.notranslate,[data-notranslate="true"],[data-fluent-read-ui],.fluent-read-bilingual-content';
const HIDDEN = '[hidden],[aria-hidden="true"]';
const MAX_NODES = 2000;
const MAX_TEXT = 64_000;
let nextAnchorId = 0;
interface Point {node: Text; start: number; end: number}
interface TextMap {text: string; points: Point[]}
type EvidenceWindow = Omit<Window, 'CSS' | 'Highlight'> & {
    MutationObserver?: typeof MutationObserver;
    Highlight?: new (...ranges: Range[]) => Set<Range>;
    CSS?: {highlights?: Map<string, Set<Range>>};
};
const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();

function hidden(element: Element): boolean {
    if (element.matches(HIDDEN)) return true;
    const view = element.ownerDocument.defaultView;
    const style = typeof view?.getComputedStyle === 'function' ? view.getComputedStyle(element) : (element as HTMLElement).style;
    return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
}

/** 限定一个最小正文块；按 UTF-16 偏移保留每个规范化字符对应的真实文字节点。 */
function collect(root: Element, includeHidden = false, mapPoints = true): TextMap | null {
    const points: Point[] = [];
    let text = '';
    let space: Point | undefined;
    let visited = 0;
    let rawLength = 0;
    const stack: Node[] = [root];
    while (stack.length) {
        const node = stack.pop()!;
        if (++visited > MAX_NODES) return null;
        if (node.nodeType === 1) {
            const element = node as Element;
            if (element.matches(EXCLUDED) || (!includeHidden && hidden(element))) continue;
            if (node.childNodes.length + visited > MAX_NODES) return null;
            stack.push(...Array.from(node.childNodes).reverse());
        } else if (node.nodeType === 3) {
            const raw = node.textContent!;
            rawLength += raw.length;
            if (rawLength > MAX_TEXT) return null;
            if (!mapPoints) {text += raw; continue;}
            for (let index = 0; index < raw.length; index++) {
                const point = {node: node as Text, start: index, end: index + 1};
                if (/\s/u.test(raw[index])) {space ??= point; continue;}
                if (space && text) {text += ' '; points.push(space);}
                space = undefined;
                text += raw[index]; points.push(point);
            }
        }
    }
    return {text: mapPoints ? text : normalize(text), points};
}

function occurrences(text: string, value: string): number[] {
    const result: number[] = [];
    for (let index = text.indexOf(value); index >= 0; index = text.indexOf(value, index + 1)) result.push(index);
    return result;
}

function selectionStart(map: TextMap, range: Range): number {
    const container = range.startContainer;
    const boundary = container.nodeType === 1 ? container.childNodes[range.startOffset] : undefined;
    const offset = map.points.findIndex(point => container.nodeType === 3
        ? point.node === container && point.start >= range.startOffset
        : !!boundary && (point.node === boundary || boundary.contains(point.node)));
    let start = offset;
    while (start >= 0 && map.text[start] === ' ') start++;
    return start;
}

/** 只从已经捕获的本块快照推导来源基址；不能将重复句的第一处匹配当作用户选区。 */
function sourceSpan(snapshot: string, selection: ReadingSelection, selectedStart: number, citation: ReadingEvidenceCitation): number | undefined {
    const source = normalize(citation.sourceText);
    const quote = normalize(citation.quote);
    if (!source || !quote || !source.includes(quote) || occurrences(source, quote).length !== 1) return undefined;
    const candidates = citation.kind === 'context' ? [normalize(selection.context)]
        : citation.kind === 'selection' ? [normalize(selection.text), normalize(selection.sentence)]
            : [normalize(selection.text), normalize(selection.sentence), normalize(selection.context)];
    const spans = new Set<number>();
    for (const candidate of candidates) {
        if (!candidate) continue;
        const prefix = candidate.startsWith('…') ? 1 : 0;
        const body = candidate.slice(prefix, candidate.endsWith('…') ? -1 : undefined);
        if (!body) continue;
        const bases = occurrences(snapshot, body).filter(start => start <= selectedStart && start + body.length >= selectedStart + normalize(selection.text).length);
        if (bases.length !== 1) continue;
        const suppliedOffset = citation.sourceOffset;
        const offsets = suppliedOffset === undefined ? occurrences(candidate, source)
            : Number.isInteger(suppliedOffset) && suppliedOffset >= prefix && candidate.slice(suppliedOffset, suppliedOffset + source.length) === source ? [suppliedOffset] : [];
        if (offsets.length === 1) spans.add(bases[0] + offsets[0] - prefix + source.indexOf(quote));
    }
    return spans.size === 1 ? [...spans][0] : undefined;
}

export function createReadingEvidenceAnchor(range: Range, selection: ReadingSelection, options: ReadingEvidenceAnchorOptions = {}): ReadingEvidenceAnchor {
    selection = {...selection};
    const start = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement;
    let root = start?.closest(PROSE) ?? start;
    const document = range.startContainer.ownerDocument;
    const view = document?.defaultView as EvidenceWindow | null;
    let captured = root && !root.matches('body,html,main,article,section') && !root.closest(`${EXCLUDED},${HIDDEN}`)
        && root.contains(range.endContainer) && range.startContainer.isConnected ? collect(root) : null;
    const selectedStart = captured ? selectionStart(captured, range) : -1;
    const valid = !!captured && !!normalize(selection.text) && selectedStart >= 0 && captured.text.slice(selectedStart, selectedStart + normalize(selection.text).length) === normalize(selection.text);
    const fingerprint = captured ? sha256Hex(JSON.stringify(captured.text)) : '';
    // 未许可的段落余文及其逐字节点映射只用于本次本地校验，不留在阅读会话中。
    captured = null;
    const parent = root?.parentElement;
    const previous = root?.previousElementSibling;
    const next = root?.nextElementSibling;
    const tag = root?.tagName;
    const id = root?.id;
    const initialUrl = view?.location?.href;
    const highlightName = `fluentread-reading-evidence-${++nextAnchorId}`;
    let state: 'changed' | 'navigated' | undefined;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let paint: Set<Range> | undefined;
    let style: HTMLStyleElement | undefined;
    let overlay: HTMLDivElement | undefined;
    let observer: MutationObserver | undefined;
    let listening = false;
    const registry = view?.CSS?.highlights;

    function clear(): void {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        if (paint && registry?.get(highlightName) === paint) registry.delete(highlightName);
        paint = undefined;
        style?.remove(); style = undefined;
        overlay?.remove(); overlay = undefined;
    }
    function stopListening(): void {
        listening = false;
        observer?.disconnect(); observer = undefined;
        if (poll !== undefined) clearInterval(poll);
        poll = undefined;
        view?.removeEventListener('popstate', navigation);
        view?.removeEventListener('hashchange', navigation);
        view?.removeEventListener('pagehide', pagehide);
        view?.removeEventListener('scroll', scroll, true);
        view?.removeEventListener('resize', clear);
        options.signal?.removeEventListener('abort', dispose);
    }
    function invalidate(reason: 'changed' | 'navigated'): void {
        if (disposed || state) return;
        state = reason; clear(); stopListening(); options.onInvalidate?.(reason);
    }
    function navigation(): void {if (view?.location?.href !== initialUrl) invalidate('navigated');}
    function pagehide(): void {invalidate('navigated');}
    function currentMap(mapPoints = true): TextMap | null {
        if (!valid || !root) return null;
        if (!root.isConnected) {
            const replacement = previous?.isConnected ? previous.nextElementSibling : parent?.firstElementChild;
            if (!parent?.isConnected || (previous && !previous.isConnected) || !replacement || replacement.parentElement !== parent || replacement.nextElementSibling !== next
                || replacement.tagName !== tag || replacement.id !== id) {invalidate('changed'); return null;}
            root = replacement;
        }
        if (root.closest(EXCLUDED)) {invalidate('changed'); return null;}
        for (let ancestor: Element | null = root; ancestor; ancestor = ancestor.parentElement) {
            if (hidden(ancestor)) {clear(); return null;}
        }
        const map = collect(root, false, mapPoints);
        if (map && sha256Hex(JSON.stringify(map.text)) === fingerprint) return map;
        // 原文暂时隐藏时保留快照，但不可对不可见内容绘制高亮；恢复显示后可重新核对。
        const hiddenMap = collect(root, true, false);
        if (hiddenMap && sha256Hex(JSON.stringify(hiddenMap.text)) === fingerprint) {clear(); return null;}
        invalidate('changed'); return null;
    }
    function dispose(): void {if (!disposed) {disposed = true; clear(); stopListening();}}
    function suspend(): void {clear(); stopListening();}
    function check(): ReadingEvidenceLocation {
        if (options.signal?.aborted) dispose();
        if (disposed) return 'unavailable';
        navigation();
        if (state) return state;
        const map = currentMap(false);
        if (!map) return state ?? 'unavailable';
        listen();
        return 'located';
    }
    function locate(citation: ReadingEvidenceCitation): ReadingEvidenceLocation {
        if (options.signal?.aborted) dispose();
        if (disposed) return 'unavailable';
        navigation();
        if (state) return state;
        const map = currentMap();
        if (!map) return state ?? 'unavailable';
        const offset = sourceSpan(map.text, selection, selectedStart, citation);
        const quote = normalize(citation.quote);
        if (offset === undefined || map.text.slice(offset, offset + quote.length) !== quote) return 'unavailable';
        try {
            const citationRanges: Range[] = [];
            for (let index = offset; index < offset + quote.length;) {
                const first = map.points[index]; let last = first;
                while (++index < offset + quote.length && map.points[index].node === first.node) last = map.points[index];
                const citationRange = document!.createRange();
                citationRange.setStart(first.node, first.start); citationRange.setEnd(last.node, last.end);
                citationRanges.push(citationRange);
            }
            clear();
            root!.scrollIntoView?.({block: 'nearest', inline: 'nearest', behavior: 'instant'});
            if (view?.Highlight && registry) {
                paint = new view.Highlight(...citationRanges); registry.set(highlightName, paint);
                style = document!.createElement('style'); style.dataset.fluentReadUi = 'reading-evidence-highlight';
                style.textContent = `::highlight(${highlightName}){background-color:#ffe08a;color:inherit}`;
                (document!.head ?? document!.documentElement).append(style);
            } else {
                overlay = document!.createElement('div'); overlay.dataset.fluentReadUi = 'reading-evidence-highlight-overlay';
                overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
                for (const rect of citationRanges.flatMap(citationRange => Array.from(citationRange.getClientRects()))) {
                    if (rect.width <= 0 || rect.height <= 0) continue;
                    const box = document!.createElement('div');
                    box.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:#ffe08a;opacity:.45;border-radius:2px;`;
                    overlay.append(box);
                }
                if (!overlay.childElementCount) {clear(); return 'unavailable';}
                document!.documentElement.append(overlay);
            }
            timer = setTimeout(clear, 3500);
            listen();
            return 'located';
        } catch {clear(); return 'unavailable';}
    }
    function listen(): void {
        if (!valid || !view || disposed || state || listening) return;
        listening = true;
        if (view.MutationObserver && parent) {
            observer = new view.MutationObserver(records => {
                navigation();
                // fixed 回退矩形不会跟随宿主重排；本段父范围内任一变化先撤掉它。
                if (overlay) clear();
                if (!disposed && !state && records.some(record => root!.contains(record.target)
                    || Array.from(record.removedNodes).some(node => node === root || node.contains(root!)))) {
                    clear(); currentMap(false);
                }
            });
            observer.observe(parent, {subtree: true, childList: true, characterData: true, attributes: true});
        }
        view.addEventListener('popstate', navigation); view.addEventListener('hashchange', navigation); view.addEventListener('pagehide', pagehide);
        view.addEventListener('scroll', scroll, true); view.addEventListener('resize', clear);
        poll = setInterval(navigation, 250);
        options.signal?.addEventListener('abort', dispose, {once: true});
    }
    function scroll(): void {if (overlay) clear();}
    if (options.signal?.aborted) disposed = true;
    else listen();
    return {locate, check, clear, suspend, dispose};
}

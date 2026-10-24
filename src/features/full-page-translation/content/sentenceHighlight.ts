/**
 * @file src/features/full-page-translation/content/sentenceHighlight.ts
 * 文件职责：在双语段落中定位鼠标下的句子，并同步绘制原文和译文的文字范围。
 * 主要内容：沿命中节点祖先读取共享状态索引，避免每帧扫描文章的兄弟段落；每次复核已提交双语工件的身份与在位关系，恢复、模式切换和重挂后不沿用旧映射；分帧只读遍历并提前限制文字量，排除空文本、按坐标索引句子范围，逐帧合并指针事件并使用原生 Highlight 绘制；离开、选择、滚动、节点变化和卸载时取消收集并释放范围与监听器。
 * 模块边界：仅消费 state 登记、renderer 创建的双语容器，不拆分宿主文本、不更改排版、不调用 provider；旧浏览器缺少绘制能力时安全停用。
 */
import {alignBilingualSentences, type SentenceSpan} from '@/src/core/translation/sentenceAlignment';
import {getTranslationState} from './state';

export const BILINGUAL_HIGHLIGHT_NAME = 'fluentread-bilingual-sentence';
const wrapperSelector = '.fluent-read-bilingual-content[data-fr-translation-owned="true"]';
const excludedSelector = 'script, style, textarea, input, select, button, svg, math, mjx-container, .katex, [hidden], [aria-hidden="true"], [translate="no"], [contenteditable]:not([contenteditable="false"]), [data-fr-translation-owned="true"]';
interface TextRun {node: Text; start: number; end: number}
interface TextMap {text: string; runs: TextRun[]}
interface Pair {source: Range[]; translation: Range[]}
type HighlightView = Window & typeof globalThis & {
    Highlight?: new (...ranges: Range[]) => Set<Range>;
    CSS?: {highlights?: Map<string, Set<Range>>};
};

function textCollector(root: Element, maxLength: number): () => TextMap | null | undefined {
    const chunks: string[] = [];
    const runs: TextRun[] = [];
    const siblings: Node[] = [];
    let length = 0;
    let next: Node | undefined = root;
    return () => {
        const started = performance.now();
        // 深层和稀疏段落仍完整收集；每帧限制节点数与时间，不能仅靠末尾字符检查。
        for (let steps = 0; next && steps < 16_384; steps++) {
            if (steps && steps % 64 === 0 && performance.now() - started >= 4) break;
            const node: Node = next;
            if (node !== root && node.nextSibling) siblings.push(node.nextSibling);
            next = siblings.pop();
            let text = '';
            if (node.nodeType === 3) text = (node as Text).data;
            else if (node.nodeType === 1) {
                const element = node as Element;
                if (element !== root && element.matches(excludedSelector)) continue;
                const style = root.ownerDocument.defaultView!.getComputedStyle(element);
                if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') continue;
                if (element.tagName === 'BR') text = '\n';
                else if (element.firstChild) {
                    if (next) siblings.push(next);
                    next = element.firstChild;
                }
            }
            if (!text) continue;
            if (text.length > maxLength - length) return null;
            chunks.push(text);
            if (node.nodeType === 3) runs.push({node: node as Text, start: length, end: length + text.length});
            length += text.length;
        }
        return next ? undefined : {text: chunks.join(''), runs};
    };
}

function rangesFor(map: TextMap, span: SentenceSpan): Range[] {
    const ranges: Range[] = [];
    let first = 0;
    let last = map.runs.length;
    while (first < last) {
        const middle = (first + last) >>> 1;
        if (map.runs[middle].end <= span.start) first = middle + 1;
        else last = middle;
    }
    for (let index = first; index < map.runs.length && map.runs[index].start < span.end; index++) {
        const run = map.runs[index];
        const start = Math.max(span.start, run.start);
        const end = Math.min(span.end, run.end);
        const range = run.node.ownerDocument.createRange();
        range.setStart(run.node, start - run.start);
        range.setEnd(run.node, end - run.start);
        ranges.push(range);
    }
    return ranges;
}

/** 只认真实状态持有的直属工件；DOM 上复制的公开标记不能建立翻译所有权。 */
function ownedBilingualContent(owner: Element): HTMLElement | undefined {
    const state = getTranslationState(owner as HTMLElement);
    if (!state || state.phase !== 'translated' || state.mode !== 'bilingual' || state.kind !== 'content') return;
    const wrapper = state.bilingualContent;
    return wrapper?.parentElement === owner && wrapper.matches(wrapperSelector) ? wrapper : undefined;
}

function ownerFor(target: Element): {owner: Element; wrapper: HTMLElement} | null {
    const translation = target.closest(wrapperSelector);
    if (translation) {
        const owner = translation.parentElement;
        if (!owner || ownedBilingualContent(owner) !== translation) return null;
        return {owner, wrapper: translation as HTMLElement};
    }
    if (target.closest(excludedSelector)) return null;
    for (let owner: Element | null = target; owner; owner = owner.parentElement) {
        const wrapper = ownedBilingualContent(owner);
        if (wrapper) return {owner, wrapper};
    }
    return null;
}

export function installBilingualSentenceHighlight(document: Document): () => void {
    const view = document.defaultView as HighlightView | null;
    const registry = view?.CSS?.highlights;
    if (!view?.Highlight || !registry) return () => undefined;
    const paint = new view.Highlight();
    let owner: Element | null = null;
    let ownerWrapper: HTMLElement | null = null;
    let installed = true;
    let pairs: Pair[] = [];
    let collecting: {wrapper: Element; source: () => TextMap | null | undefined; sourceMap?: TextMap;
        translation?: () => TextMap | null | undefined} | undefined;
    let active: Pair | undefined;
    let pending: {event: PointerEvent; target: Element | null} | null = null;
    let frame: number | null = null;
    const ownerAncestors: Node[] = [];
    const observer = new view.MutationObserver(records => {
        if (owner && (!owner.isConnected || records.some(record => owner!.contains(record.target)
            || ownerAncestors.some(ancestor => record.target.contains(ancestor))))) clear();
    });
    function clear(): void {
        paint.clear();
        active = undefined;
        owner = null;
        ownerWrapper = null;
        ownerAncestors.length = 0;
        pairs = [];
        collecting = undefined;
        pending = null;
        if (frame !== null) view!.cancelAnimationFrame(frame);
        frame = null;
        observer.disconnect();
    }
    const flush = (): void => {
        frame = null;
        const point = pending;
        if (!point || point.event.buttons || document.getSelection()?.isCollapsed === false) return clear();
        const {event, target: hit} = point;
        const next = hit && ownerFor(hit);
        if (!next?.owner.isConnected) return clear();
        if (next.owner !== owner || next.wrapper !== ownerWrapper) {
            clear();
            owner = next.owner;
            ownerWrapper = next.wrapper;
            const wrappers = Array.from(owner.children).filter(child => child.matches(wrapperSelector));
            if (wrappers.length !== 1) return clear();
            collecting = {wrapper: ownerWrapper, source: textCollector(owner, 100_000)};
            pending = point;
            // 收集期间也观察，避免跨帧使用已经变更或脱离页面的节点。
            // document 的观察不穿透 Shadow DOM；同时观察每层实际根及其宿主祖先。
            const options = {subtree: true, childList: true, characterData: true, attributes: true};
            let ancestor: Node = owner;
            while (true) {
                ownerAncestors.push(ancestor);
                const root = ancestor.getRootNode();
                observer.observe(root, options);
                if (root === document) break;
                ancestor = (root as ShadowRoot).host;
            }
        }
        if (collecting) {
            const source = collecting.sourceMap ?? collecting.source();
            if (source === null) return clear();
            if (source === undefined) {frame = view.requestAnimationFrame(flush); return;}
            collecting.sourceMap = source;
            collecting.translation ??= textCollector(collecting.wrapper, 100_000 - source.text.length);
            const translation = collecting.translation();
            if (translation === null) return clear();
            if (translation === undefined) {frame = view.requestAnimationFrame(flush); return;}
            pairs = alignBilingualSentences(source.text, translation.text).map(pair => ({
                source: rangesFor(source, pair.source), translation: rangesFor(translation, pair.translation),
            }));
            collecting = undefined;
        }
        pending = null;
        let hitSentence: {pair: Pair} | undefined;
        for (const pair of pairs) {
            for (const side of ['source', 'translation'] as const) {
                for (const range of pair[side]) {
                    for (const rect of range.getClientRects()) {
                        if (rect.width > 0 && rect.height > 0 && event.clientX >= rect.left && event.clientX <= rect.right
                            && event.clientY >= rect.top && event.clientY <= rect.bottom) {
                            hitSentence = {pair}; break;
                        }
                    }
                    if (hitSentence) break;
                }
                if (hitSentence) break;
            }
            if (hitSentence) break;
        }
        const pair = hitSentence?.pair;
        if (pair !== active) {
            paint.clear();
            active = pair;
            if (pair) {
                for (const range of [...pair.source, ...pair.translation]) paint.add(range);
                registry.set(BILINGUAL_HIGHLIGHT_NAME, paint);
            }
        }
    };
    const move = (event: PointerEvent): void => {
        // composedPath 在事件派发后会清空，必须在当前事件内保留真实目标。
        const target = event.composedPath().find(node => node instanceof view.Element) as Element | undefined;
        pending = {event, target: target ?? null};
        if (frame === null) frame = view.requestAnimationFrame(flush);
    };
    const leave = (event: PointerEvent): void => {if (!event.relatedTarget) clear();};
    document.addEventListener('pointermove', move, {passive: true, capture: true});
    document.addEventListener('pointerout', leave, true);
    document.addEventListener('scroll', clear, true);
    document.addEventListener('selectionchange', clear);
    view.addEventListener('blur', clear);
    view.addEventListener('resize', clear);
    view.addEventListener('pagehide', clear);
    return () => {
        if (!installed) return;
        installed = false;
        clear();
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerout', leave, true);
        document.removeEventListener('scroll', clear, true);
        document.removeEventListener('selectionchange', clear);
        view.removeEventListener('blur', clear);
        view.removeEventListener('resize', clear);
        view.removeEventListener('pagehide', clear);
        if (registry.get(BILINGUAL_HIGHLIGHT_NAME) === paint) registry.delete(BILINGUAL_HIGHLIGHT_NAME);
    };
}

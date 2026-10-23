/**
 * @file src/features/full-page-translation/content/manpagePreparation.ts
 * 文件职责：为已启用内置 man7 规则的真实手册 PRE 建立可恢复的自然段边界。
 * 主要内容：核验域名、路径与 h2/PRE 结构，只切直属 Text、移动原行内节点，把代码和全部间隔放入禁译片段；恢复时合并本次创建的 Text 并保留原对象及宿主后来写入的内容。
 * 模块边界：只负责翻译开始与增量发现之前的 DOM 准备和对应清理，不请求 provider、不另建观察器、不替换宿主 innerHTML；候选和译文仍由既有全文/悬浮管线处理。
 */
import {registerManpagePreparation, unregisterManpagePreparation, splitManpageText} from '@/src/core/translation/manpage';
import type {TranslationSiteAdapter} from '@/src/core/translation/types';

interface SplitText {original: Text; pieces: Text[]}
interface Preparation {pre: HTMLElement; wrappers: HTMLElement[]; paragraphs: HTMLElement[]; splits: SplitText[]}
const preparations = new Set<Preparation>();
const byPre = new WeakMap<Element, Preparation>();
const allowedInline = new Set(['a', 'b', 'i', 'em', 'strong', 'span']);

function isManpageURL(url: URL): boolean {
    return /^(?:http|https):$/u.test(url.protocol) && url.hostname === 'man7.org'
        && /^\/linux\/man-pages\/man[1-9][a-z]*\/[^/]+\.html$/u.test(url.pathname);
}

function eligiblePre(pre: Element): boolean {
    const heading = pre.previousElementSibling;
    return pre.localName === 'pre' && heading?.localName === 'h2'
        && Boolean(heading.querySelector('a[id]')) && !heading.querySelector('a[id="SYNOPSIS"]')
        && !pre.closest('[translate="no"],.notranslate,[data-notranslate="true"],[contenteditable]:not([contenteditable="false"])');
}

/** 先完整检查，再移动节点；跨越行内元素的切点保守拒绝，绝不克隆链接或事件宿主。 */
function prepareNodes(pre: HTMLElement, nodes: readonly ChildNode[], record: Preparation): void {
    const text = nodes.map(node => node.textContent!).join('');
    const segments = splitManpageText(text);
    if (!segments.length || (!record.paragraphs.length && !segments.some(segment => segment.prose))) return;
    const boundaries = new Set(segments.map(segment => segment.end));
    let offset = 0;
    for (const node of nodes) {
        const end = offset + node.textContent!.length;
        if (node.nodeType !== 3 && (node.nodeType !== 1 || !allowedInline.has((node as Element).localName)
            || Array.from((node as Element).querySelectorAll('*')).some(child => !allowedInline.has(child.localName))
            || Array.from(boundaries).some(boundary => offset < boundary && boundary < end))) return;
        offset = end;
    }
    const wrappers = segments.map(segment => {
        const wrapper = pre.ownerDocument.createElement('span');
        wrapper.setAttribute(segment.prose ? 'data-fr-manpage-paragraph' : 'data-fr-manpage-literal', 'true');
        if (!segment.prose) wrapper.setAttribute('translate', 'no');
        record.wrappers.push(wrapper);
        if (segment.prose) record.paragraphs.push(wrapper);
        return wrapper;
    });
    pre.insertBefore(wrappers[0]!, nodes[0]!);
    offset = 0;
    let index = 0;
    for (const node of nodes) {
        const value = node.textContent!;
        const end = offset + value.length;
        if (node.nodeType === 3) {
            const pieces: Text[] = [];
            let cursor = offset;
            do {
                while (index + 1 < segments.length && cursor >= segments[index]!.end) index++;
                const next = Math.min(end, segments[index]!.end);
                const piece = pieces.length ? pre.ownerDocument.createTextNode(value.slice(cursor - offset, next - offset)) : node as Text;
                piece.data = value.slice(cursor - offset, next - offset);
                wrappers[index]!.appendChild(piece);
                pieces.push(piece);
                cursor = next;
            } while (cursor < end);
            if (pieces.length > 1) record.splits.push({original: node as Text, pieces});
        } else {
            while (index + 1 < segments.length && offset >= segments[index]!.end) index++;
            wrappers[index]!.appendChild(node);
        }
        offset = end;
    }
    // 每个 wrapper 按原始片段顺序插入，原 PRE 的字面 textContent 不变。
    const first = wrappers[0]!;
    let previous = first;
    for (const wrapper of wrappers.slice(1)) {previous.after(wrapper); previous = wrapper;}
    registerManpagePreparation(pre, record.paragraphs);
}

/** 新增 PRE 和已准备 PRE 外侧追加的片段共用入口；已有译文和原段节点不重新包装。 */
export function prepareManpageContent(root: Node, url: URL | undefined, adapters: readonly TranslationSiteAdapter[] | undefined): void {
    if (!url || !adapters || !isManpageURL(url) || !adapters.some(adapter => adapter.preformattedProse === 'manpage' && adapter.matches(url))) return;
    const parentPre = root.nodeType === 1 ? (root as Element).closest('pre') : root.parentElement?.closest('pre');
    const pres = parentPre ? [parentPre] : 'querySelectorAll' in root ? Array.from((root as ParentNode).querySelectorAll('pre')) : [];
    for (const pre of pres) {
        if (!eligiblePre(pre)) continue;
        let record = byPre.get(pre);
        if (!record) {
            record = {pre: pre as HTMLElement, wrappers: [], paragraphs: [], splits: []};
            byPre.set(pre, record);
            preparations.add(record);
        }
        const existingWrappers = new Set(record.wrappers);
        let nodes: ChildNode[] = [];
        const flush = () => {if (nodes.length) prepareNodes(pre as HTMLElement, nodes, record!); nodes = [];};
        for (const node of Array.from(pre.childNodes)) {
            if (existingWrappers.has(node as HTMLElement)) flush();
            else nodes.push(node);
        }
        flush();
    }
}

/** 必须在既有译文恢复后调用；仅合并仍连续存在的本次 Text，不覆盖宿主新写入。 */
export function restoreManpageContent(): void {
    for (const record of preparations) {
        unregisterManpagePreparation(record.pre, record.paragraphs);
        for (const wrapper of record.wrappers) wrapper.replaceWith(...Array.from(wrapper.childNodes));
        for (const split of record.splits) {
            if (!split.pieces.every((piece, index) => piece.parentNode === split.original.parentNode
                && (index === 0 || split.pieces[index - 1]!.nextSibling === piece))) continue;
            // 未变化的来源恢复精确原值；外部文字改动保留在同一个原始 Text 中。
            split.original.data = split.pieces.map(piece => piece.data).join('');
            split.pieces.slice(1).forEach(piece => piece.remove());
        }
        byPre.delete(record.pre);
    }
    preparations.clear();
}

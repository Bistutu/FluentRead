/**
 * @file src/features/full-page-translation/content/manpageLayout.ts
 * 文件职责：为已核验的 man7 手册说明段恢复译文缩进，并去除固定列宽排版留下的断行。
 * 主要内容：只在运行时登记的段落上处理自有译文，折叠来源骨架换行；有界读取原文前两条非空行的首字形位置，按源字体实际布局设置普通或悬挂缩进，并补偿逐行标记的内层留白；按共享原文正文栏约束译文最大宽度。
 * 模块边界：不修改原文、候选权限、翻译请求或宿主样式；几何不可用时保留普通译文布局，渲染层负责在插入后调用对齐。
 */
import {isPreparedManpageParagraph, isPreparedManpagePre} from '@/src/core/translation/manpage';

const artifactSelector = '[data-fr-translation-owned="true"],.fluent-read-loading,.fluent-read-retry-wrapper,[data-fr-manpage-literal]';
const maxSourceNodes = 2048;
const maxSourceLength = 16_384;

/** 重复复核不得制造 style mutation 回路；只有数值或优先级变化才写自有工件。 */
function setLayoutProperty(content: HTMLElement, property: string, value: string): void {
    if (content.style.getPropertyValue(property) === value &&
        content.style.getPropertyPriority?.(property) === 'important') return;
    content.style.setProperty(property, value, 'important');
}

/** 用户主动启用的按句换行在此步骤之后执行；这里只撤销手册固定列宽产生的断行。 */
export function prepareManpageTranslation(node: HTMLElement, content: HTMLElement): void {
    if (!isPreparedManpageParagraph(node)) return;
    content.style.setProperty('white-space', 'normal', 'important');
    content.querySelectorAll('br').forEach(br => br.replaceWith(content.ownerDocument.createTextNode(' ')));
}

interface LineStart {node: Text; offset: number}

/** 跨行内链接和强调追踪物理行，至多扫描有界数量的文本，不为每个字符创建 Range。 */
function sourceLineStarts(node: HTMLElement): LineStart[] {
    const starts: LineStart[] = [];
    const walker = node.ownerDocument.createTreeWalker(node, 4);
    let atLineStart = true, length = 0, visited = 0;
    for (let current = walker.nextNode(); current && starts.length < 2 && visited < maxSourceNodes && length < maxSourceLength; current = walker.nextNode()) {
        visited++;
        if (current.parentElement?.closest(artifactSelector)) continue;
        const value = current.nodeValue!.slice(0, maxSourceLength - length);
        length += value.length;
        let offset = 0;
        while (offset < value.length && starts.length < 2) {
            if (atLineStart) {
                const match = /^[^\S\n]*([^\s\n]|\n)/u.exec(value.slice(offset));
                if (!match) break;
                offset += match[0].length;
                if (match[1] !== '\n') {
                    starts.push({node: current as Text, offset: offset - match[1]!.length});
                    atLineStart = false;
                }
            } else {
                const newline = value.indexOf('\n', offset);
                if (newline < 0) break;
                offset = newline + 1;
                atLineStart = true;
            }
        }
    }
    return starts;
}

interface ColumnReference {pre: HTMLElement; end: LineStart; columns: number}

/** 只扫描文字挑选最长折行正文；小标题、短单行和字面代码不决定共享正文栏。 */
function widestWrappedLine(pre: HTMLElement): ColumnReference | null {
    let widest: ColumnReference | null = null;
    for (const paragraph of Array.from(pre.children).slice(0, 256)) {
        if (!isPreparedManpageParagraph(paragraph)) continue;
        const lines: {end: LineStart; columns: number}[] = [];
        const walker = paragraph.ownerDocument.createTreeWalker(paragraph, 4);
        let columns = 0, lastColumns = 0, length = 0, visited = 0;
        let end: LineStart | null = null;
        const finish = () => {
            if (end) lines.push({end, columns: lastColumns});
            columns = 0; end = null;
        };
        for (let text = walker.nextNode(); text && visited < maxSourceNodes && length < maxSourceLength; text = walker.nextNode()) {
            visited++;
            if (text.parentElement?.closest(artifactSelector)) continue;
            const value = text.nodeValue!.slice(0, maxSourceLength - length);
            length += value.length;
            let offset = 0;
            for (const character of value) {
                if (character === '\n') finish();
                else {
                    columns += character === '\t' ? 8 - columns % 8 : 1;
                    if (/\S/u.test(character)) {end = {node: text as Text, offset}; lastColumns = columns;}
                }
                offset += character.length;
            }
        }
        finish();
        // 非末行有后续正文，能证明手册按固定列宽折行；段落末尾的短行不作为栏宽。
        for (const line of lines.slice(0, -1)) {
            if (!widest || line.columns > widest.columns) widest = {pre, ...line};
        }
    }
    return widest;
}

/** 同 PRE 共用正文右栏；仅有短标题的 PRE 可借用同页已核验正文，度量始终来自原文。 */
function constrainManpageWidth(node: HTMLElement, content: HTMLElement, box: DOMRect): void {
    const pre = node.closest<HTMLElement>('pre');
    if (!pre || !isPreparedManpagePre(pre)) return;
    let reference = widestWrappedLine(pre);
    if (!reference) {
        for (const other of Array.from(node.ownerDocument.querySelectorAll<HTMLElement>('pre')).slice(0, 64)) {
            if (other === pre || !isPreparedManpagePre(other)) continue;
            const candidate = widestWrappedLine(other);
            if (candidate && (!reference || candidate.columns > reference.columns)) reference = candidate;
        }
    }
    if (!reference) return;
    const range = node.ownerDocument.createRange();
    range.setStart(reference.end.node, reference.end.offset);
    range.setEnd(reference.end.node, reference.end.offset + 1);
    const last = range.getBoundingClientRect();
    if (!Number.isFinite(last.right) || last.width <= 0 || last.height <= 0) return;
    const shift = reference.pre === pre ? 0 : pre.getBoundingClientRect().left - reference.pre.getBoundingClientRect().left;
    const width = last.right + shift - box.left;
    if (!Number.isFinite(width) || width <= 0) return;
    // 百分比宽度适应窄视口，border-box 上限覆盖右侧装饰，避免译文外框超过原文正文栏。
    setLayoutProperty(content, 'box-sizing', 'border-box');
    setLayoutProperty(content, 'width', '100%');
    setLayoutProperty(content, 'max-width', `${width}px`);
}

/** 插入完成后以源字形坐标对齐；译文在前和刷新场景均排除已有自有译文。 */
export function alignManpageTranslation(node: HTMLElement, content: HTMLElement): void {
    if (!isPreparedManpageParagraph(node)) return;
    try {
        const starts = sourceLineStarts(node);
        if (!starts.length) return;
        const positions = starts.map(start => {
            const range = node.ownerDocument.createRange();
            range.setStart(start.node, start.offset);
            range.setEnd(start.node, start.offset + 1);
            return range.getBoundingClientRect();
        });
        const box = content.getBoundingClientRect();
        if (![box, ...positions].every(rect => Number.isFinite(rect.left) && rect.width > 0 && rect.height > 0)) return;
        const border = Number.parseFloat(node.ownerDocument.defaultView?.getComputedStyle(content).borderLeftWidth ?? '0') || 0;
        const markedText = content.querySelector<HTMLElement>(':scope > .fluent-read-translation-text');
        // 胶囊标记的 box-decoration-break:clone 在每条续行重复内边距，文字也需扣除这段偏移。
        const markedPadding = markedText
            ? Number.parseFloat(node.ownerDocument.defaultView?.getComputedStyle(markedText).paddingLeft ?? '0') || 0 : 0;
        const base = box.left + border + markedPadding;
        const first = positions[0]!.left - base;
        const subsequent = (positions[1] ?? positions[0])!.left - base;
        if (first < 0 || subsequent < 0 || !Number.isFinite(subsequent)) return;
        setLayoutProperty(content, 'padding-left', `${subsequent}px`);
        setLayoutProperty(content, 'text-indent', `${first - subsequent}px`);
        constrainManpageWidth(node, content, box);
    } catch {
        // 脱离文档、无布局实现或宿主同步移除节点时，不改动原文也不猜测字体宽度。
    }
}

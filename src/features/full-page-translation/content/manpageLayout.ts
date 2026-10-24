/**
 * @file src/features/full-page-translation/content/manpageLayout.ts
 * 文件职责：为已核验的 man7 手册说明段恢复译文缩进，并去除固定列宽排版留下的断行。
 * 主要内容：只在运行时登记的段落上处理自有译文，折叠来源骨架换行；有界读取原文前两条非空行的首字形位置，按源字体实际布局设置普通或悬挂缩进，并补偿逐行标记的内层留白。
 * 模块边界：不修改原文、候选权限、翻译请求或宿主样式；几何不可用时保留普通译文布局，渲染层负责在插入后调用对齐。
 */
import {isPreparedManpageParagraph} from '@/src/core/translation/manpage';

const artifactSelector = '[data-fr-translation-owned="true"],.fluent-read-loading,.fluent-read-retry-wrapper';
const maxSourceNodes = 2048;
const maxSourceLength = 16_384;

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
        content.style.setProperty('padding-left', `${subsequent}px`, 'important');
        content.style.setProperty('text-indent', `${first - subsequent}px`, 'important');
    } catch {
        // 脱离文档、无布局实现或宿主同步移除节点时，不改动原文也不猜测字体宽度。
    }
}

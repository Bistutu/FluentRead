/**
 * @file src/features/reading-assistant/answerFormat.ts
 * 文件职责：把模型回答转换为阅读卡和历史详情共用的安全 Markdown 结构。
 * 主要内容：解析标题、段落、列表、引用、围栏代码、简单表格与行内强调，保留表格内原文引用协议、流式未闭合文本和旧版纯文本回答。
 * 模块边界：只生成文本结构，不生成 HTML、不执行脚本、不创建链接或加载远程图片，不参与模型请求。
 */
export type ReadingAnswerBlock =
    | {kind: 'heading'; text: string; level: number}
    | {kind: 'paragraph' | 'quote' | 'code'; text: string}
    | {kind: 'list'; ordered: boolean; start: number; items: string[]}
    | {kind: 'table'; headers: string[]; rows: string[][]};
export interface ReadingAnswerSpan {text: string; kind: 'text' | 'strong' | 'emphasis' | 'code'}

const LIST_ITEM = /^([-*+]|\d+[.)])\s+(.+)$/u;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/u;
const FENCE = /^(`{3,}|~{3,})(.*)$/u;
function tableCells(line: string): string[] {
    const text = line.trim().replace(/^\||\|$/gu, '');
    const cells = [''];
    for (let index = 0; index < text.length; index += 1) {
        if (text.startsWith('[[cite:', index)) {
            const end = text.indexOf(']]', index + 7);
            // 引文里的 pipe 与反斜杠是原句，不是表格分隔符；流式未闭合标记也留在当前格。
            cells[cells.length - 1] += text.slice(index, end < 0 ? undefined : end + 2);
            index = end < 0 ? text.length : end + 1;
        } else if (text[index] === '\\' && text[index + 1] === '|') {
            cells[cells.length - 1] += '|'; index += 1;
        } else if (text[index] === '|') cells.push('');
        else cells[cells.length - 1] += text[index];
    }
    return cells.map(cell => cell.trim());
}

function isTableDivider(line: string): boolean {
    const cells = tableCells(line);
    return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/u.test(cell));
}

/** 按块解析，允许最后一段和代码围栏尚未闭合，以便实时显示正在生成的回答。 */
export function readingAnswerBlocks(answer: string): ReadingAnswerBlock[] {
    const lines = answer.replace(/\r\n?/gu, '\n').split('\n');
    const blocks: ReadingAnswerBlock[] = [];
    let index = 0;
    while (index < lines.length) {
        const text = lines[index].trim();
        index += 1;
        if (!text || RULE.test(text)) continue;
        const fence = text.match(FENCE);
        if (fence) {
            const code: string[] = [];
            const close = new RegExp(`^${fence[1][0]}{${fence[1].length},}\\s*$`, 'u');
            while (index < lines.length && !close.test(lines[index].trim())) code.push(lines[index++]);
            if (index < lines.length) index += 1;
            blocks.push({kind: 'code', text: code.join('\n')});
            continue;
        }
        const heading = text.match(/^(#{1,6})\s+(.+)$/u);
        if (heading) { blocks.push({kind: 'heading', text: heading[2].replace(/\s+#+\s*$/u, ''), level: heading[1].length}); continue; }
        if (index < lines.length && text.includes('|') && isTableDivider(lines[index])) {
            index += 1;
            const rows: string[][] = [];
            while (index < lines.length && lines[index].includes('|')) rows.push(tableCells(lines[index++]));
            blocks.push({kind: 'table', headers: tableCells(text), rows});
            continue;
        }
        const item = text.match(LIST_ITEM);
        if (item) {
            const ordered = /^\d/u.test(item[1]);
            const items = [item[2]];
            while (index < lines.length) {
                const next = lines[index].trim().match(LIST_ITEM);
                if (!next || /^\d/u.test(next[1]) !== ordered) break;
                items.push(next[2]); index += 1;
            }
            blocks.push({kind: 'list', ordered, start: ordered ? Number.parseInt(item[1], 10) : 1, items});
            continue;
        }
        if (text.startsWith('>')) {
            const quote = [text.replace(/^>\s?/u, '')];
            while (index < lines.length && lines[index].trim().startsWith('>')) quote.push(lines[index++].trim().replace(/^>\s?/u, ''));
            blocks.push({kind: 'quote', text: quote.join('\n')});
            continue;
        }
        // 软换行保留为同一段，空行和明确 Markdown 标记才开始下一个块。
        const paragraph = [text];
        while (index < lines.length) {
            const next = lines[index].trim();
            if (!next || RULE.test(next) || FENCE.test(next) || /^(?:#{1,6}\s|>)/u.test(next) || LIST_ITEM.test(next) || (next.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1]))) break;
            paragraph.push(next); index += 1;
        }
        blocks.push({kind: 'paragraph', text: paragraph.join('\n')});
    }
    return blocks;
}

/** 只识别闭合的行内标记；HTML、链接、图片和未闭合标记始终作为普通文本保留。 */
export function readingAnswerSpans(text: string): ReadingAnswerSpan[] {
    const spans: ReadingAnswerSpan[] = [];
    let end = 0;
    for (const match of text.matchAll(/`[^`\n]+`|\*\*[^*]+\*\*|__[^_]+__|(?<!\*)\*[^*\n]+\*(?!\*)|(?<![\p{L}\p{N}_])_[^_\n]+_(?![\p{L}\p{N}_])/gu)) {
        if (match.index > end) spans.push({text: text.slice(end, match.index), kind: 'text'});
        const part = match[0];
        const strong = part.startsWith('**') || part.startsWith('__');
        spans.push({text: part.slice(strong ? 2 : 1, strong ? -2 : -1), kind: strong ? 'strong' : part.startsWith('`') ? 'code' : 'emphasis'});
        end = match.index + part.length;
    }
    if (end < text.length) spans.push({text: text.slice(end), kind: 'text'});
    return spans;
}

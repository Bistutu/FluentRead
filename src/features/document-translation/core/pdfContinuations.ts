/**
 * @file src/features/document-translation/core/pdfContinuations.ts
 * 文件职责：为专业文档阅读器标记相邻 PDF 页之间可并列查看的高置信正文接续。
 * 主要内容：按真实页号和已有阅读顺序定位页末、页首正文，以字符加权正文基准字号排除小字脚注，并核对字体、版心位置、小写开头与未结束句；区分行尾断词提示和普通段落接续，保持两端片段编号与全部源文本原样。
 * 模块边界：只读 ParsedDocument 的纯算法，不拼接或重译段落、不猜断词、不修改人工校订，不操作 DOM、存储、网络或导出；界面按返回定位提供可选上下文查看。
 */
import type {ParsedDocument, PdfDocumentBlock, PdfDocumentPage} from './document';

export interface PdfContinuationPoint {pageNumber: number; segmentIndex: number}
export interface PdfContinuation {
    id: string;
    kind: 'paragraph' | 'word-break';
    from: PdfContinuationPoint;
    to: PdfContinuationPoint;
}
interface BodyBlock {block: PdfDocumentBlock; source: string; order: number}
const usableFont = (block: PdfDocumentBlock) => Number.isFinite(block.fontSize) && block.fontSize > 0;
const validRect = (block: PdfDocumentBlock) => [block.x, block.y, block.width, block.height].every(Number.isFinite) && block.width > 0 && block.height > 0;

function bodyBlocks(document: ParsedDocument, page: PdfDocumentPage): BodyBlock[] {
    return page.blocks.flatMap((block, index) => {
        const segment = document.segments[block.segmentIndex], source = segment?.source.trim();
        if ((block.kind ?? 'text') !== 'text' || block.segmentIndex < 0 || ['note', 'title', 'heading', 'header', 'footer'].includes(segment?.role ?? '')
            || !source || !usableFont(block) || !validRect(block)) return [];
        return [{block, source, order: block.readingOrder ?? index}];
    }).sort((a, b) => a.order - b.order);
}

/** 段落长度加权的中位数字号，防止多条短脚注或作者小字成为正文基准。 */
function bodyFont(blocks: readonly BodyBlock[]): number {
    if (!blocks.length) return 0;
    const sized = [...blocks].sort((a, b) => a.block.fontSize - b.block.fontSize);
    let remaining = sized.reduce((sum, entry) => sum + entry.source.length, 0) / 2;
    return sized.find(entry => (remaining -= entry.source.length) <= 0)!.block.fontSize;
}
const pageHeight = (page: PdfDocumentPage) => page.rotation === 90 || page.rotation === 270 ? page.width : page.height;
const normalSize = (entry: BodyBlock, font: number) => entry.block.fontSize >= font * .9 && entry.block.fontSize <= font * 1.12;

/** 返回查看提示；连字符和段落边界始终属于各自原片段，不在此处进行任何合并。 */
export function findPdfContinuations(document: ParsedDocument): PdfContinuation[] {
    if (document.binary?.kind !== 'pdf') return [];
    const result: PdfContinuation[] = [], pages = document.binary.pages;
    for (let index = 0; index + 1 < pages.length; index += 1) {
        const previous = pages[index], next = pages[index + 1];
        if (!Number.isSafeInteger(previous.pageNumber) || previous.pageNumber < 1 || next.pageNumber !== previous.pageNumber + 1) continue;
        const previousBody = bodyBlocks(document, previous), nextBody = bodyBlocks(document, next);
        const previousFont = bodyFont(previousBody), nextFont = bodyFont(nextBody);
        const from = previousBody.filter(entry => normalSize(entry, previousFont)).at(-1);
        const to = nextBody.find(entry => normalSize(entry, nextFont));
        if (!from || !to || from.block.segmentIndex === to.block.segmentIndex) continue;
        const firstHeight = pageHeight(previous), nextHeight = pageHeight(next);
        if (!(firstHeight > 0 && nextHeight > 0) || !Number.isFinite(firstHeight + nextHeight)
            || from.block.y + from.block.height < firstHeight * .55 || to.block.y > nextHeight * .32) continue;
        if (Math.abs(from.block.fontSize - to.block.fontSize) > Math.max(.6, from.block.fontSize * .08)
            || from.block.fontFamily !== to.block.fontFamily) continue;
        if (next.blocks.some((block, position) => block.kind === 'heading' && (block.readingOrder ?? position) < to.order)) continue;
        if (/[.!?。！？][\p{Pe}"'”’]*$/u.test(from.source) || !/^\p{Ll}/u.test(to.source)
            || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(from.source + to.source)) continue;
        result.push({id: `pdf-continuation-${previous.pageNumber}-${from.block.segmentIndex}-${next.pageNumber}-${to.block.segmentIndex}`,
            kind: /[-‐‑\u00AD]$/u.test(from.source) ? 'word-break' : 'paragraph',
            from: {pageNumber: previous.pageNumber, segmentIndex: from.block.segmentIndex},
            to: {pageNumber: next.pageNumber, segmentIndex: to.block.segmentIndex}});
    }
    return result;
}

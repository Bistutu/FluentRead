/**
 * @file src/features/document-translation/services/pdfOcr.ts
 * 文件职责：让没有文字层的扫描版 PDF 也能进入同一套版面分析与翻译流程：把逐页文字识别的结果换算成版面分析所需的字形，重建各页的段落与待翻译片段。
 * 主要内容：找出解析时标记为扫描页的页（含文字 PDF 里夹着的扫描页）；按给定顺序逐页调用注入的识别器，报告进度并响应取消；识别出的文字行按页面坐标转成字形后交给版面分析，与已有文字的页一起重排全文片段编号；旋转的扫描页按展示方向识别和排版，原页的旋转角另记给导出使用；识别失败或取消时不改动原文档。
 * 模块边界：不渲染页面、不加载识别引擎、不发起翻译；页面图像与识别引擎由应用层注入（图像按展示方向渲染），版面规则归 core/pdfLayoutAnalysis。
 */
import type {DocumentSegment, ParsedDocument, PdfDocumentPage} from '../core/document';
import {analyzePdfPageLayout, type PdfLayoutAtom} from '../core/pdfLayoutAnalysis';
import {pdfPageSegments} from './binary';

/** 一行识别出的文字及其在页面上的位置（PDF 点，原点在页面左上角）。 */
export interface PdfOcrLine {text: string; x: number; y: number; width: number; height: number}
export interface PdfPageRecognitionInput {bytes: Uint8Array; pageNumber: number; width: number; height: number; signal?: AbortSignal}
export type PdfPageRecognizer = (input: PdfPageRecognitionInput) => Promise<readonly PdfOcrLine[]>;
export interface RecognizePdfOptions {
    signal?: AbortSignal;
    /** 希望先识别的页（从 0 开始），例如正在阅读的那一页；其余页按原顺序接在后面。 */
    startPage?: number;
    onProgress?: (progress: {completed: number; total: number}) => void;
}

/** 需要文字识别的页：解析时标记为扫描页（整页图像、没有文字）。文字 PDF 里夹着的扫描页和旋转的扫描页同样在内，空白页不在内。 */
export function pdfPagesNeedingOcr(document: ParsedDocument | null | undefined): number[] {
    if (document?.binary?.kind !== 'pdf') return [];
    return document.binary.pages.flatMap((page, index) => page.scanned ? [index] : []);
}

/** 识别框的高度包含上伸与下伸部分；字号约为框高的八成半，基线在框底向上约两成处。 */
function ocrAtoms(lines: readonly PdfOcrLine[]): PdfLayoutAtom[] {
    return lines.flatMap(line => {
        const text = line.text.replace(/\s+/gu, ' ').trim();
        if (!text || !(line.width > 0) || !(line.height > 0)) return [];
        return [{text, x: line.x, y: line.y, width: line.width, height: line.height, baseline: line.y + line.height * 0.8, fontSize: line.height * 0.85, fontFamily: 'sans-serif'}];
    });
}

/**
 * 逐页识别扫描页并返回带有新片段的文档；原文档对象保持不变。没有需要识别的页时原样返回。
 */
export async function recognizePdfDocument(document: ParsedDocument, recognize: PdfPageRecognizer, options: RecognizePdfOptions = {}): Promise<ParsedDocument> {
    const pending = pdfPagesNeedingOcr(document);
    if (document.binary?.kind !== 'pdf' || !pending.length) return document;
    const binary = document.binary;
    const start = pending.findIndex(index => index >= (options.startPage ?? 0));
    const order = start > 0 ? [...pending.slice(start), ...pending.slice(0, start)] : pending;
    const recognized = new Map<number, ReturnType<typeof analyzePdfPageLayout>>();
    options.onProgress?.({completed: 0, total: order.length});
    for (const index of order) {
        options.signal?.throwIfAborted();
        const page = binary.pages[index];
        const lines = await recognize({bytes: binary.bytes, pageNumber: page.pageNumber, width: page.width, height: page.height, signal: options.signal});
        options.signal?.throwIfAborted();
        recognized.set(index, analyzePdfPageLayout({atoms: ocrAtoms(lines), graphics: [], width: page.width, height: page.height}));
        options.onProgress?.({completed: recognized.size, total: order.length});
    }
    // 已有文字的页保留原来的版面块，只把片段编号按全文顺序重排。
    const segments: DocumentSegment[] = [];
    const pages: PdfDocumentPage[] = binary.pages.map((page, index) => {
        const layout = recognized.get(index);
        // 识别过的页不再标记为扫描页：即使一个字也没认出来，也不会反复识别。
        if (layout) {
            // 识别在展示方向上进行，版面块已是展示坐标：去掉 rotation，原页的旋转角留给导出。
            const {rotation, ...upright} = page;
            return {...upright, ...(rotation ? {sourceRotation: rotation} : {}), ...pdfPageSegments(layout.blocks, page.pageNumber, segments), preservedRegions: layout.preservedRegions, scanned: false};
        }
        const segmentIndexes: number[] = [];
        const blocks = page.blocks.map(block => {
            if (block.segmentIndex < 0) return block;
            const id = segments.length;
            segments.push({...document.segments[block.segmentIndex], id});
            segmentIndexes.push(id);
            return {...block, segmentIndex: id};
        });
        return {...page, blocks, segmentIndexes};
    });
    return {...document, segments, binary: {...binary, pages}};
}

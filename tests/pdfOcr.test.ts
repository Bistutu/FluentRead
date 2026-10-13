/**
 * @file tests/pdfOcr.test.ts
 * 文件职责：验证扫描版 PDF 的逐页文字识别结果能重建成可翻译的段落，并与已有文字的页一起得到连续的片段编号。
 * 主要内容：只识别标记为扫描页且未旋转的页（空白页不识别），识别后取消标记，从阅读位置开始并回绕；识别行经版面分析合并成段落；已有文字页的块与片段原样保留并重排编号；空白与无效识别行被丢弃；进度逐页上报；取消与识别失败不改动原文档；没有可识别的页或不是 PDF 时原样返回。
 * 模块边界：识别器由测试注入，不渲染页面也不加载识别引擎；版面规则本身由版面分析测试覆盖。
 */
import {describe, expect, it, vi} from 'vitest';
import type {ParsedDocument, PdfDocumentBlock, PdfDocumentPage} from '@/src/features/document-translation/core/document';
import {pdfPagesNeedingOcr, recognizePdfDocument, type PdfOcrLine} from '@/src/features/document-translation/services/pdfOcr';

const block = (segmentIndex: number, overrides: Partial<PdfDocumentBlock> = {}): PdfDocumentBlock => ({segmentIndex, x: 50, y: 60, width: 300, height: 12, fontSize: 10, lineHeight: 12, lineCount: 1, fontFamily: 'serif', fontWeight: 400, textAlign: 'left', ...overrides});
// 没有版面块的页默认是扫描页；需要空白页时显式传入 scanned: false。
const page = (pageNumber: number, blocks: PdfDocumentBlock[] = [], extra: Partial<PdfDocumentPage> = {}): PdfDocumentPage => ({pageNumber, width: 600, height: 800, segmentIndexes: blocks.filter(entry => entry.segmentIndex >= 0).map(entry => entry.segmentIndex), blocks, ...(blocks.length ? {} : {scanned: true}), ...extra});
const pdf = (pages: PdfDocumentPage[], sources: string[] = []): ParsedDocument => ({fileName: 'scan.pdf', format: 'pdf', label: 'PDF', parts: [],
    segments: sources.map((source, id) => ({id, source, role: 'paragraph' as const})), binary: {kind: 'pdf', bytes: new Uint8Array([1, 2, 3]), pages}} as unknown as ParsedDocument);
const paragraph = (tag: string): PdfOcrLine[] => [0, 1, 2].map(row => ({text: `${tag} line ${row} is a complete recognised line of ordinary body text`, x: 60, y: 100 + row * 14, width: 440, height: 12}));

describe('scanned PDF recognition', () => {
    it('lists scanned PDF pages, rotated ones included', () => {
        // 文字页和空白页不识别；夹在文字页之间的扫描页、旋转的扫描页都要识别。
        expect(pdfPagesNeedingOcr(pdf([page(1, [block(0)]), page(2), page(3, [], {rotation: 90}), page(4), page(5, [], {scanned: false})], ['kept']))).toEqual([1, 2, 3]);
        expect(pdfPagesNeedingOcr({fileName: 'a.txt', format: 'txt', segments: [], parts: []} as unknown as ParsedDocument)).toEqual([]);
        expect(pdfPagesNeedingOcr(null)).toEqual([]);
    });

    it('recognises from the reading position, rebuilds paragraphs and renumbers every segment in page order', async () => {
        const source = pdf([page(1), page(2, [block(0), block(-1, {kind: 'formula', preserveSource: true}), block(1, {y: 200})]), page(3), page(4, [], {rotation: 180, scanned: false})], ['existing first', 'existing second']);
        const before = JSON.stringify(source);
        const recognize = vi.fn(async ({pageNumber}: {pageNumber: number}) => pageNumber === 1
            ? [...paragraph('First'), {text: '   ', x: 60, y: 300, width: 40, height: 12}, {text: 'ghost', x: 60, y: 320, width: 0, height: 12}, {text: 'flat', x: 60, y: 340, width: 40, height: 0}]
            : [{text: 'A  short\nheading', x: 60, y: 80, width: 120, height: 22}, ...paragraph('Third')]);
        const progress: Array<[number, number]> = [];
        const result = await recognizePdfDocument(source, recognize, {startPage: 2, onProgress: ({completed, total}) => progress.push([completed, total])});
        // 从第 3 页（下标 2）开始，回绕到第 1 页；已有文字的页和空白页不识别。
        expect(recognize.mock.calls.map(([input]) => input.pageNumber)).toEqual([3, 1]);
        expect(recognize.mock.calls[0][0]).toMatchObject({width: 600, height: 800, bytes: new Uint8Array([1, 2, 3])});
        expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]);
        expect(result.segments.map(segment => [segment.id, segment.source.slice(0, 22)])).toEqual([
            [0, 'First line 0 is a comp'], [1, 'existing first'], [2, 'existing second'], [3, 'A short heading'], [4, 'Third line 0 is a comp'],
        ]);
        const pages = (result.binary as {pages: PdfDocumentPage[]}).pages;
        expect(pages.map(entry => entry.segmentIndexes)).toEqual([[0], [1, 2], [3, 4], []]);
        // 三行识别结果并成一个段落；已有文字页保留公式块与原来的几何。
        expect(pages[0].blocks).toHaveLength(1);
        expect(pages[0].blocks[0]).toMatchObject({segmentIndex: 0, lineCount: 3});
        expect(pages[1].blocks.map(entry => [entry.segmentIndex, entry.kind, entry.y])).toEqual([[1, undefined, 60], [-1, 'formula', 60], [2, undefined, 200]]);
        expect(pages[2].blocks.find(entry => entry.segmentIndex === 3)?.kind).toBe('heading');
        // 识别过的页不再是扫描页，已有文字的页与空白页的标记不变。
        expect(pages.map(entry => entry.scanned)).toEqual([false, undefined, false, false]);
        expect(pages.map(entry => [entry.rotation, entry.sourceRotation])).toEqual([[undefined, undefined], [undefined, undefined], [undefined, undefined], [180, undefined]]);
        expect(pdfPagesNeedingOcr(result)).toEqual([]);
        expect(JSON.stringify(source)).toBe(before);
    });

    it('recognises a rotated scan in its display orientation and keeps the page angle only for export', async () => {
        // 展示方向是 800×600 的横页；识别器收到展示尺寸，返回的也是展示坐标。
        const source = pdf([{...page(1, [], {rotation: 90}), width: 800, height: 600}]);
        const recognize = vi.fn(async (_input: unknown) => paragraph('Sideways'));
        const result = await recognizePdfDocument(source, recognize);
        expect((recognize.mock.calls as any[])[0][0]).toMatchObject({pageNumber: 1, width: 800, height: 600});
        const [recognised] = (result.binary as {pages: PdfDocumentPage[]}).pages;
        expect(recognised).toMatchObject({width: 800, height: 600, sourceRotation: 90, scanned: false, segmentIndexes: [0]});
        expect('rotation' in recognised).toBe(false);
        expect(recognised.blocks[0]).toMatchObject({segmentIndex: 0, lineCount: 3, x: 60});
        expect(pdfPagesNeedingOcr(result)).toEqual([]);
    });

    it('starts from the first empty page by default and returns the same document when nothing needs recognition', async () => {
        const recognize = vi.fn(async () => paragraph('Only'));
        const result = await recognizePdfDocument(pdf([page(1), page(2)]), recognize);
        expect(recognize.mock.calls.map(([input]: any) => input.pageNumber)).toEqual([1, 2]);
        expect(result.segments).toHaveLength(2);
        // 阅读位置在所有待识别页之后时，从头开始。
        const late = vi.fn(async () => paragraph('Late'));
        await recognizePdfDocument(pdf([page(1), page(2), page(3, [block(0)])], ['kept']), late, {startPage: 2});
        expect(late.mock.calls.map(([input]: any) => input.pageNumber)).toEqual([1, 2]);
        const complete = pdf([page(1, [block(0)])], ['kept']);
        expect(await recognizePdfDocument(complete, recognize)).toBe(complete);
        const text = {fileName: 'a.txt', format: 'txt', segments: [], parts: []} as unknown as ParsedDocument;
        expect(await recognizePdfDocument(text, recognize)).toBe(text);
    });

    it('stops on cancellation or a recogniser failure', async () => {
        const controller = new AbortController();
        const recognize = vi.fn(async ({pageNumber, signal}: {pageNumber: number; signal?: AbortSignal}) => {expect(signal).toBe(controller.signal); if (pageNumber === 1) controller.abort(); return paragraph('Any');});
        await expect(recognizePdfDocument(pdf([page(1), page(2)]), recognize, {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
        expect(recognize).toHaveBeenCalledTimes(1);
        const aborted = new AbortController(); aborted.abort();
        await expect(recognizePdfDocument(pdf([page(1)]), recognize, {signal: aborted.signal})).rejects.toMatchObject({name: 'AbortError'});
        await expect(recognizePdfDocument(pdf([page(1)]), async () => {throw new Error('engine missing');})).rejects.toThrow('engine missing');
    });
});

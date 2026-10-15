import {describe, expect, it} from 'vitest';
import {findPdfContinuations} from '@/src/features/document-translation/core/pdfContinuations';
import type {ParsedDocument, PdfDocumentBlock, PdfDocumentPage} from '@/src/features/document-translation/core/document';

const block = (segmentIndex: number, overrides: Partial<PdfDocumentBlock> = {}): PdfDocumentBlock => ({segmentIndex, x: 50, y: 690, width: 230, height: 40,
    fontSize: 10, fontFamily: 'serif', lineHeight: 12, lineCount: 3, textAlign: 'left', fontWeight: 400, kind: 'text', ...overrides});
const page = (pageNumber: number, blocks: PdfDocumentBlock[], overrides: Partial<PdfDocumentPage> = {}): PdfDocumentPage => ({pageNumber, width: 612, height: 792,
    blocks, segmentIndexes: blocks.map(block => block.segmentIndex).filter(index => index >= 0), ...overrides});
const document = (sources: string[], pages = [page(1, [block(0)]), page(2, [block(1, {y: 60})])]): ParsedDocument => ({fileName: 'paper.pdf', format: 'pdf', label: 'PDF', parts: [],
    segments: sources.map((source, id) => ({id, source, role: 'paragraph'})), binary: {kind: 'pdf', bytes: new Uint8Array([37, 80, 68, 70]), pages}});

describe('PDF adjacent-page viewing context', () => {
    it('marks an actual hyphenated boundary without joining source, changing identities or modifying the document', () => {
        const doc = document(['Other theories have attributed this ef-', 'fect to an alternative explanation of the reading times.']);
        const before = JSON.stringify(doc);
        expect(findPdfContinuations(doc)).toEqual([{id: 'pdf-continuation-1-0-2-1', kind: 'word-break', from: {pageNumber: 1, segmentIndex: 0}, to: {pageNumber: 2, segmentIndex: 1}}]);
        expect(JSON.stringify(doc)).toBe(before);
    });
    it('recognises ordinary sentence continuation and typographic word-break markers without guessing words', () => {
        expect(findPdfContinuations(document(['The output is computed as a weighted sum', 'of the values according to the given weights.']))[0].kind).toBe('paragraph');
        for (const mark of ['-', '‐', '‑', '\u00AD']) expect(findPdfContinuations(document([`The paragraph ends with a word${mark}`, 'continuation on the next source page.']))[0].kind).toBe('word-break');
    });
    it('ignores footnotes, formulas, tables, source-only metadata and trailing page labels', () => {
        const sources = ['A long complete body paragraph supplies the normal body type size, and continues with the words', 'on the next page of this same body paragraph.', 'A small footnote that does not belong to the paragraph', 'another small footnote'];
        const doc = document(sources, [page(1, [block(0), block(2, {y: 750, fontSize: 8, readingOrder: 2}), block(-1, {kind: 'footer', y: 780})]),
            page(2, [block(-1, {kind: 'metadata', y: 30}), block(3, {kind: 'formula', y: 40}), block(1, {y: 60})])]);
        expect(findPdfContinuations(doc)[0]).toMatchObject({from: {segmentIndex: 0}, to: {segmentIndex: 1}});
        doc.segments[0].role = 'note';
        expect(findPdfContinuations(doc)).toEqual([]);
        expect(findPdfContinuations(document(sources, [page(1, [block(0, {kind: 'table'})]), page(2, [block(1, {y: 60})])]))).toEqual([]);
    });
    it('uses explicit reading order in two columns and rejects preceding next-page section headings', () => {
        const doc = document(['Left column ends in a complete statement.', 'Right column continues with', 'the next page source text.'],
            [page(1, [block(1, {x: 318, readingOrder: 1}), block(0, {readingOrder: 0})]), page(2, [block(2, {y: 60, readingOrder: 1})])]);
        expect(findPdfContinuations(doc)[0]).toMatchObject({from: {segmentIndex: 1}, to: {segmentIndex: 2}});
        if (doc.binary?.kind === 'pdf') doc.binary.pages[1].blocks.unshift(block(-1, {kind: 'heading', y: 40, readingOrder: 0}));
        expect(findPdfContinuations(doc)).toEqual([]);
        if (doc.binary?.kind === 'pdf') delete doc.binary.pages[1].blocks[0].readingOrder;
        expect(findPdfContinuations(doc)).toEqual([]);
    });
    it('rejects sentence endings, uppercase starts, mismatched typography, nonadjacent pages and content away from the page boundary', () => {
        for (const ending of ['.', '!”', '?)', '。', '!']) expect(findPdfContinuations(document([`The previous sentence ends${ending}`, 'lowercase is insufficient on its own.']))).toEqual([]);
        expect(findPdfContinuations(document(['The previous paragraph continues', 'An uppercase start is not enough evidence.']))).toEqual([]);
        for (const overrides of [{fontSize: 12}, {fontFamily: 'sans-serif'}, {y: 400}, {width: NaN}, {fontSize: 0}]) {
            expect(findPdfContinuations(document(['The previous paragraph continues', 'across pages.'], [page(1, [block(0)]), page(2, [block(1, {y: 60, ...overrides})])]))).toEqual([]);
        }
        for (const next of [1, 3]) expect(findPdfContinuations(document(['Previous continues', 'across pages.'], [page(1, [block(0)]), page(next, [block(1, {y: 60})])]))).toEqual([]);
        expect(findPdfContinuations(document(['Previous continues', 'across pages.'], [page(1, [block(0, {y: 100})]), page(2, [block(1, {y: 60})])]))).toEqual([]);
    });
    it('handles rotation-aware page bounds, legacy unspecified block kinds, empty/non-PDF data and corrupt indexes conservatively', () => {
        const doc = document(['The previous paragraph continues', 'across the next source page.'], [page(1, [block(0, {kind: undefined, y: 690})], {rotation: 90, width: 792, height: 612}), page(2, [block(1, {y: 60})])]);
        expect(findPdfContinuations(doc)).toHaveLength(1);
        for (const pages of [[], [page(1, [block(0)])], [page(1, [block(12)]), page(2, [block(1, {y: 60})])], [page(0, [block(0)]), page(1, [block(1, {y: 60})])],
            [page(1, [block(0)], {height: Infinity}), page(2, [block(1, {y: 60})])]]) expect(findPdfContinuations(document(['Previous continues', 'across pages.'], pages))).toEqual([]);
        expect(findPdfContinuations({...doc, binary: undefined})).toEqual([]);
        expect(findPdfContinuations(document(['Previous \u0093 continues', 'across pages.']))).toEqual([]);
    });
});

import {describe, expect, it, vi} from 'vitest';
import {isPdfReadingVariationSelector, paginatePdfReadingPlan, pdfReadingFont, wrapPdfReadingText} from '@/src/features/document-translation/core/pdfTextLayout';
import type {PdfReadingPlan} from '@/src/features/document-translation/core/pdfReadingPlan';

const body = pdfReadingFont('paragraph');
const measure = (text: string) => Array.from(text).length * 12;
const textPlan = (text: string): PdfReadingPlan => ({pageNumber: 1, hasTranslation: true, entries: [{kind: 'text', id: 's0', pageNumber: 1, segmentIndex: 0, role: 'paragraph', source: 'Source', text, translated: true, sourceRect: {x: 0, y: 0, width: 100, height: 20}}]});

describe('PDF fixed-font complete-text pagination', () => {
    it('keeps title, heading, caption, metadata and body hierarchy readable', () => {
        expect(['title', 'heading', 'caption', 'metadata', 'footer', 'note', 'paragraph'].map(role => pdfReadingFont(role).size)).toEqual([20, 16, 11.5, 11, 11, 11, 12]);
        expect(body.lineHeight).toBe(19.2);
    });
    it('preserves complete Chinese, words, emoji and blank paragraphs without shrinking', () => {
        const value = '中文。继续阅读，不截断末尾。 👩‍💻\r\n\r\nEnglish verylongunbrokenword tail';
        const lines = wrapPdfReadingText(value, 72, body, measure);
        expect(lines.join('').replace(/\s/gu, '')).toBe(value.replace(/\s/gu, ''));
        expect(lines).toContain('');
        expect(lines.some(line => line.startsWith('。'))).toBe(false);
        expect(lines.some(line => line.includes('👩‍💻'))).toBe(true);
        expect(lines.filter(Boolean).every(line => measure(line) <= 72)).toBe(true);
    });
    it('bounds repeated Chinese width measurements and handles unavailable segmentation and invalid measurements', () => {
        const measured = vi.fn(measure);
        const lines = wrapPdfReadingText('重复中文'.repeat(10000), 528, body, measured);
        expect(lines.join('')).toHaveLength(40000);
        expect(measured).toHaveBeenCalledTimes(4);
        const segmenter = Intl.Segmenter;
        try {
            Object.defineProperty(Intl, 'Segmenter', {value: undefined, configurable: true});
            expect(wrapPdfReadingText('ab', NaN, body, () => Infinity)).toEqual(['a', 'b']);
            expect(wrapPdfReadingText('a b', 10, body, () => -1)).toEqual(['a b']);
        } finally {Object.defineProperty(Intl, 'Segmenter', {value: segmenter, configurable: true});}
    });
    it('retains unique characters when the bounded measurement cache fills', () => {
        const value = Array.from({length: 600}, (_, index) => String.fromCodePoint(0x4e00 + index)).join('');
        const lines = wrapPdfReadingText(value, 100, body, measure);
        expect(lines.join('')).toBe(value);
        expect(wrapPdfReadingText('  甲 乙', 12, body, measure)).toEqual(['甲', '乙']);
    });
    it('keeps BMP and supplementary variation selectors with their base at word and CJK wrap boundaries, including without Segmenter', () => {
        expect([0xFDFF, 0xFE00, 0xFE0F, 0xFE10, 0xE00FF, 0xE0100, 0xE01EF, 0xE01F0].map(code =>
            isPdfReadingVariationSelector(String.fromCodePoint(code)))).toEqual([false, true, true, false, false, true, true, false]);
        const value = '𝒱︀C︀S︀葛\u{E0100}葛\u{E01EF}';
        const width = (text: string) => Array.from(text).filter(character => !isPdfReadingVariationSelector(character)).length * 12;
        const expected = ['𝒱︀', 'C︀', 'S︀', '葛\u{E0100}', '葛\u{E01EF}'];
        expect(wrapPdfReadingText(value, 12, body, width)).toEqual(expected);
        const segmenter = Intl.Segmenter;
        try {
            Object.defineProperty(Intl, 'Segmenter', {value: undefined, configurable: true});
            expect(wrapPdfReadingText(value, 12, body, width)).toEqual(expected);
            expect(wrapPdfReadingText('︀C', 12, body, width).join('')).toBe('︀C');
        } finally {Object.defineProperty(Intl, 'Segmenter', {value: segmenter, configurable: true});}
    });
    it('paginates 4x paragraphs completely at 12pt with no items outside page margins', () => {
        const value = ('译文保持完整，公式和图表保留原图。'.repeat(1200)) + '【最终尾文】';
        const pages = paginatePdfReadingPlan(textPlan(value), measure);
        expect(pages.length).toBeGreaterThan(10);
        const items = pages.flatMap(page => page.items);
        expect(items.map(item => item.kind === 'text' ? item.text : '').join('')).toBe(value);
        expect(items.every(item => item.kind === 'text' && item.font.size === 12 && item.y >= 42 && item.y + item.font.lineHeight <= 750)).toBe(true);
        expect(paginatePdfReadingPlan({...textPlan(''), entries: []}, measure)).toEqual([]);
    });
    it('continues every strip of a tall image once and ignores invalid geometry', () => {
        const plan: PdfReadingPlan = {pageNumber: 1, hasTranslation: true, entries: [
            {...textPlan('前文').entries[0]},
            {kind: 'region', id: 'figure', pageNumber: 1, role: 'figure', sourceRect: {x: 10, y: 20, width: 100, height: 2000}, segmentIndexes: []},
            {kind: 'region', id: 'invalid', pageNumber: 1, role: 'figure', sourceRect: {x: 0, y: 0, width: NaN, height: -1}, segmentIndexes: []},
            {...textPlan('尾文').entries[0], id: 'last'},
        ]};
        const pages = paginatePdfReadingPlan(plan, measure);
        const strips = pages.flatMap(page => page.items).filter(item => item.kind === 'region');
        expect(strips.reduce((sum, item) => sum + item.sourceRect.height, 0)).toBeCloseTo(2000);
        expect(strips[0].sourceRect.y).toBe(20);
        expect(strips.at(-1)!.sourceRect.y + strips.at(-1)!.sourceRect.height).toBeCloseTo(2020);
        expect(strips.every(item => item.y + item.height <= 750)).toBe(true);
        const narrow = {...plan, entries: [{kind: 'region' as const, id: 'wide', pageNumber: 1, role: 'table', sourceRect: {x: 0, y: 0, width: 1000, height: 10}, segmentIndexes: []}]};
        expect(paginatePdfReadingPlan(narrow, measure)[0].items[0]).toMatchObject({width: 528, height: 5.28});
    });
    it('moves an entire fitting formula to the next page rather than clipping it to the remaining space', () => {
        const prior = textPlan('前文\n'.repeat(31)).entries[0];
        const picture = {kind: 'region' as const, id: 'formula', pageNumber: 1, role: 'formula', sourceRect: {x: 20, y: 30, width: 352, height: 80}, segmentIndexes: []};
        const pages = paginatePdfReadingPlan({pageNumber: 1, hasTranslation: true, entries: [prior, picture]}, measure);
        expect(pages).toHaveLength(2); expect(pages[0].items.every(item => item.kind === 'text')).toBe(true);
        expect(pages[1].items).toEqual([{kind: 'region', entryId: 'formula', sourceRect: picture.sourceRect, x: 42, y: 42, width: 528, height: 120}]);
        const exact = {...picture, sourceRect: {...picture.sourceRect, height: 472}};
        expect(paginatePdfReadingPlan({pageNumber: 1, hasTranslation: true, entries: [prior, exact]}, measure)[1].items[0]).toMatchObject({height: 708, sourceRect: exact.sourceRect});
    });
    it('rejects unbounded source strips and consumes subpixel tails without extra loops', () => {
        const region = (width: number, height: number): PdfReadingPlan => ({pageNumber: 1, hasTranslation: true, entries: [{kind: 'region', id: 'r', pageNumber: 1, role: 'figure', sourceRect: {x: 0, y: 0, width, height}, segmentIndexes: []}]});
        expect(() => paginatePdfReadingPlan(region(100, Number.MAX_VALUE), measure)).toThrow('合理页数');
        const pages = paginatePdfReadingPlan(region(100, 944.0000000000001), measure);
        const strips = pages.flatMap(page => page.items).filter(item => item.kind === 'region');
        expect(strips.length).toBeLessThanOrEqual(3);
        expect(strips.reduce((sum, item) => sum + item.sourceRect.height, 0)).toBeCloseTo(944.0000000000001);
        expect(paginatePdfReadingPlan(region(Number.MAX_VALUE, Number.MIN_VALUE), measure)).toEqual([]);
    });
    it('bounds continuation page allocation for an oversized text entry', () => {
        expect(() => paginatePdfReadingPlan(textPlan('line\n'.repeat(160_000)), measure)).toThrow('单页内容过长');
    });
    it('fails fast when a damaged geometry port changes its validated height before strip consumption', () => {
        // 防御性 fault injection：正常解析的 PDF 使用稳定数据对象；这里显式模拟读取途中损坏的端口。
        const heights = [100, 100, 100, 100, -1];
        const sourceRect = {x: 0, y: 0, width: 100, get height() {return heights.shift() ?? -1;}};
        const plan: PdfReadingPlan = {pageNumber: 1, hasTranslation: true, entries: [
            {kind: 'region', id: 'damaged', pageNumber: 1, role: 'figure', sourceRect, segmentIndexes: []},
        ]};
        expect(() => paginatePdfReadingPlan(plan, measure)).toThrow('原图分页无法继续');
    });
});

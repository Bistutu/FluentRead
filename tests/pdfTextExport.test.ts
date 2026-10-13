import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {PDFDict, PDFDocument, PDFName, PDFRawStream} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {TextItem} from 'pdfjs-dist/types/src/display/api';
import {describe, expect, it, vi} from 'vitest';
import type {ParsedDocument} from '@/src/features/document-translation/core/document';
import {createDocumentDownload, parseBinaryDocument, type PdfReadingRenderer} from '@/src/features/document-translation/services/binary';
import {embedPdfReadingFont} from '@/src/features/document-translation/services/pdfReadingFont';
import {renderPdfReadingPages} from '@/src/features/document-translation/ui/pdfPreview';
import {paginatePdfReadingPlan} from '@/src/features/document-translation/core/pdfTextLayout';

const fontBytes = new Uint8Array(readFileSync(new URL('../assets/pdf-fonts/FluentReadNotoSansSC-Regular.woff2', import.meta.url)));
const textOnlyOptions = {pdfReadingRenderer: renderPdfReadingPages, pdfFontLoader: async () => fontBytes};
const compact = (text: string) => text.replace(/\s/gu, '');

async function fixture(): Promise<ParsedDocument> {
    const source = await PDFDocument.create();
    source.addPage([600, 800]).drawText('Original selectable source page', {x: 42, y: 720, size: 14});
    return {fileName: 'copyable.pdf', format: 'pdf', label: 'PDF 文件', parts: [],
        segments: [{id: 0, source: 'Original title', contextLabel: '第 1 页', role: 'title'},
            {id: 1, source: 'Original paragraph', contextLabel: '第 1 页', role: 'paragraph'}],
        binary: {kind: 'pdf', bytes: await source.save(), pages: [{pageNumber: 1, width: 600, height: 800,
            segmentIndexes: [0, 1], blocks: [0, 1].map(segmentIndex => ({segmentIndex,
                x: 42, y: 50 + segmentIndex * 60, width: 500, height: 40,
                kind: segmentIndex === 0 ? 'heading' as const : 'text' as const,
                fontSize: 14, lineHeight: 20, lineCount: 2, fontFamily: 'sans-serif', fontWeight: 400 as const, textAlign: 'left' as const,
            }))}]}};
}

async function extract(bytes: Uint8Array): Promise<string[]> {
    const task = getDocument({data: bytes.slice(), disableFontFace: true, isEvalSupported: false});
    const pdf = await task.promise;
    try {
        const texts: string[] = [];
        for (let index = 1; index <= pdf.numPages; index++) {
            const page = await pdf.getPage(index);
            texts.push((await page.getTextContent({disableNormalization: true})).items.filter((item): item is TextItem => 'str' in item).map(item => item.str).join('\n'));
            page.cleanup();
        }
        return texts;
    } finally {await task.destroy();}
}

function saveEvidence(name: string, bytes: Uint8Array): void {
    const directory = process.env.FLUENTREAD_PDF_EVIDENCE_DIR;
    if (!directory) return;
    mkdirSync(directory, {recursive: true});
    writeFileSync(join(directory, name), bytes);
}

describe('visible Unicode PDF reading export', () => {
    it('retains every visible glyph outline after subsetting, including odd-length Chinese/Latin records', async () => {
        const font = fontkit.create(fontBytes);
        const subset = font.createSubset();
        const glyphs = font.layout('中文译文标题 Mixed English 123，标点。éü①② ∗ϵŁłĐđɃɐἀὯ∀∑∫≠⊗⋆⨀⩽𝒜𝜖𝟟 ‣⌀⟶⟺ 、︁。︁！︁', {liga: false}).glyphs;
        const pairs = glyphs.map(glyph => ({original: glyph, index: subset.includeGlyph(glyph)}));
        const bytes = await new Promise<Uint8Array>((resolve, reject) => {
            const parts: Uint8Array[] = [];
            const stream = subset.encodeStream() as unknown as import('node:stream').Readable;
            stream.on('data', part => parts.push(part)).on('error', reject).on('end', () => resolve(Buffer.concat(parts)));
        });
        const embedded = fontkit.create(bytes);
        for (const {original, index} of pairs) expect(embedded.getGlyph(index).path.toSVG()).toBe(original.path.toSVG());
    });
    it('covers complete Latin Extended A/B and mathematical operator ranges and retains Unicode identities when copied', async () => {
        const font = fontkit.create(fontBytes);
        const supported = new Set(font.characterSet);
        const full = [[0x0100, 0x024F], [0x2200, 0x22FF], [0x2A00, 0x2AFF]].flatMap(([lo, hi]) =>
            Array.from({length: hi - lo + 1}, (_, index) => String.fromCodePoint(lo + index)));
        expect(full.every(character => supported.has(character.codePointAt(0)!))).toBe(true);
        const reviewed = ['‣', '⌀', '⟶', '⟺'];
        expect(reviewed.every(character => supported.has(character.codePointAt(0)!))).toBe(true);
        expect(reviewed.every(character => font.layout(character).glyphs[0].id !== 0 && font.layout(character).glyphs[0].path.toSVG())).toBe(true);
        const translations = ['扩展字符与数学符号', full.join('') + ' ∗ϵŁł ἀὯ𝒜𝜖𝟟 ‣ ⌀ ⟶ ⟺ 中文唯一尾部：完。'];
        const download = await createDocumentDownload(await fixture(), translations, 'translated', textOnlyOptions);
        const extracted = await extract(download.data as Uint8Array);
        expect(compact(extracted.join(''))).toBe(compact(translations.join('')));
        expect(extracted.at(-1)).toContain('中文唯一尾部：完。');
    });
    it('writes Chinese, Latin, punctuation and tabs as actual extractable text with a small font subset', async () => {
        const translations = ['中文译文标题', '中文译文可直接复制和搜索。Mixed English 123\t中英混合，标点：？！“引号”《书名》；①②。·• 兀兀'];
        const download = await createDocumentDownload(await fixture(), translations, 'translated', textOnlyOptions);
        const bytes = download.data as Uint8Array;
        const pages = await extract(bytes);
        expect(pages).toHaveLength(1);
        expect(compact(pages.join(''))).toBe(compact(translations.join('')));
        expect(bytes.byteLength).toBeLessThan(160_000);
        saveEvidence('chinese-mixed-selectable.pdf', bytes);
    });

    it.each([
        '𝒱 𝒱︀ 𝒱 𝒞 𝒞︀ 𝒞 𝒮 𝒮︀ 𝒮 C C︀ C S S︀ S 葛 葛\u{E0100} 葛 𝒱\uFE0F 葛\u{E01EF} 𝒱︀ 。 。︁ 。',
        '𝒱︀ 𝒱 𝒱︀ 𝒞︀ 𝒞 𝒞︀ 𝒮︀ 𝒮 𝒮︀ C︀ C C︀ S︀ S S︀ 葛\u{E0100} 葛 葛\u{E0100} 𝒱\uFE0F 葛\u{E01EF} 𝒱 。︁ 。 。︁',
    ])('preserves bare and variant sequence copying in either order without assigning selectors to bare same-gid glyphs: %s', async text => {
        const translations = ['数学变体复制验证', text + ' 完整尾部。'];
        const download = await createDocumentDownload(await fixture(), translations, 'translated', textOnlyOptions);
        const extracted = await extract(download.data as Uint8Array);
        expect(compact(extracted.join(''))).toBe(compact(translations.join('')));
    }, 30_000);

    it('uses a separate cached subset per exact variant sequence and measures and draws identical runs', async () => {
        const pdf = await PDFDocument.create();
        const embed = vi.spyOn(pdf, 'embedFont');
        const embedded = await embedPdfReadingFont(pdf, fontBytes);
        const text = 'C C︀ C︀ S︀ 𝒱︀ 葛\u{E0100} C';
        await embedded.prepareText(text);
        await embedded.prepareText('C︀ S︀');
        expect(embed).toHaveBeenCalledTimes(5);
        const page = pdf.addPage();
        const draw = vi.spyOn(page, 'drawText');
        embedded.drawText(page, text, {x: 42, y: 700, size: 12});
        expect(draw.mock.calls.map(call => call[0]).join('')).toBe(text);
        expect(draw.mock.calls[1][1]!.font).toBe(draw.mock.calls[3][1]!.font);
        expect(draw.mock.calls[1][1]!.font).not.toBe(embedded.font);
        const expectedWidth = draw.mock.calls.reduce((sum, [run, options]) => sum + options!.font!.widthOfTextAtSize(run, 12), 0);
        expect(embedded.measureText(text, 12)).toBe(expectedWidth);
        expect(draw.mock.calls.at(-1)![1]!.x! + embedded.font.widthOfTextAtSize(' C', 12)).toBeCloseTo(42 + expectedWidth);
        expect(embedded.measureText('', 12)).toBe(0);
        const count = draw.mock.calls.length;
        embedded.drawText(page, '', {x: 42, y: 700, size: 12});
        expect(draw).toHaveBeenCalledTimes(count);
        expect(() => embedded.measureText('Q︀', 12)).toThrow('尚未准备');
        expect(compact((await extract(await pdf.save())).join(''))).toBe(compact(text));
    }, 30_000);

    it('retains the bundled font base outlines for unsupported variation mappings while keeping each full sequence identity', () => {
        // 数学补充字形未携带其 donor 的变体映射；这些序列按该字体回退到基础轮廓，仍保留选择符。
        for (const sequence of ['𝒱︀', '𝒞︀', '𝒮︀', 'C︀', 'S︀', '葛\u{E0100}']) {
            const base = Array.from(sequence)[0];
            const normal = fontkit.create(fontBytes).layout(base, {liga: false}).glyphs;
            const variant = fontkit.create(fontBytes).layout(sequence, {liga: false}).glyphs;
            expect(variant).toHaveLength(1);
            expect(variant[0].codePoints).toEqual(Array.from(sequence, character => character.codePointAt(0)!));
            expect(variant[0].path.toSVG()).toBe(normal[0].path.toSVG());
        }
    });

    it('retains genuinely different CJK punctuation variation outlines supplied by the bundled font', () => {
        for (const sequence of ['、︁', '。︁', '！︁']) {
            const base = Array.from(sequence)[0];
            const normal = fontkit.create(fontBytes).layout(base, {liga: false}).glyphs[0];
            const variant = fontkit.create(fontBytes).layout(sequence, {liga: false}).glyphs[0];
            expect(variant.id).not.toBe(normal.id);
            expect(variant.path.toSVG()).not.toBe(normal.path.toSVG());
            expect(variant.codePoints).toEqual(Array.from(sequence, character => character.codePointAt(0)!));
        }
    });

    it('rejects genuinely missing bases and isolated or repeated selectors without dropping real text', async () => {
        const embedded = await embedPdfReadingFont(await PDFDocument.create(), fontBytes);
        for (const text of ['︀C', '\u{E0100}葛', 'C ︀', 'C\t︀', 'C\n︀', 'C︀︁']) {
            expect(() => embedded.assertSupported(text)).toThrow('孤立变体选择符');
        }
        await expect(embedded.prepareText('🦄︀')).rejects.toThrow('U+1F984');
        expect(() => embedded.assertSupported('C\uFFFE')).toThrow('U+FFFE');
        expect(() => embedded.assertSupported('\u0093idΓ')).toThrow('U+93');
    });

    it('checks cancellation before variant preparation and after a distinct sequence subset is embedded', async () => {
        const controller = new AbortController();
        const pdf = await PDFDocument.create();
        const embedded = await embedPdfReadingFont(pdf, fontBytes, controller.signal);
        const embedFont = pdf.embedFont.bind(pdf);
        const spy = vi.spyOn(pdf, 'embedFont').mockImplementation(async (bytes, options) => {
            const font = await embedFont(bytes, options);
            controller.abort(new Error('Variant embedding canceled'));
            return font;
        });
        await expect(embedded.prepareText('C︀')).rejects.toThrow('Variant embedding canceled');
        expect(spy).toHaveBeenCalledOnce();
        await expect(embedded.prepareText('S︀')).rejects.toThrow('Variant embedding canceled');
        expect(spy).toHaveBeenCalledOnce();
    });

    it('continues long Chinese text at a fixed readable size and keeps every paragraph including the tail', async () => {
        const paragraph = '长文译文自动续页，完整保留每一句中文及标点。';
        const translations = ['长文续页验证', paragraph.repeat(600) + '唯一末尾字符：完。'];
        const progress: string[] = [];
        const download = await createDocumentDownload(await fixture(), translations, 'translated', {...textOnlyOptions,
            onPdfProgress: value => progress.push(`${value.phase}:${value.completedPages}/${value.totalPages}`),
        });
        const bytes = download.data as Uint8Array;
        const pages = await extract(bytes);
        expect(pages.length).toBeGreaterThan(5);
        expect(compact(pages.join(''))).toBe(compact(translations.join('')));
        expect(pages.at(-1)).toContain('唯一末尾字符：完。');
        expect(progress).toEqual(['rendering:0/1', 'rendering:1/1', 'saving:1/1']);
        const pdf = await PDFDocument.load(bytes);
        expect(pdf.getPages().every(page => page.getWidth() === 612 && page.getHeight() === 792)).toBe(true);
        saveEvidence('chinese-long-continuation.pdf', bytes);
    });

    it('preserves selectable original pages followed by selectable translation only for explicit readable output', async () => {
        const translations = ['双语对照标题', '原论文页继续保留，译文页可以复制。'];
        const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlY4AAAAASUVORK5CYII=', 'base64'));
        const raster = vi.fn(async () => png);
        const download = await createDocumentDownload(await fixture(), translations, 'bilingual', {
            ...textOnlyOptions, pdfPresentation: 'readable', pdfPageRasterizer: raster,
        });
        const bytes = download.data as Uint8Array;
        const pages = await extract(bytes);
        expect(pages).toHaveLength(2);
        expect(pages[0]).toContain('Original selectable source page');
        expect(compact(pages[1])).toBe(compact(translations.join('')));
        expect(raster).not.toHaveBeenCalled();
        saveEvidence('bilingual-original-and-translation.pdf', bytes);
    });

    it('embeds a renderer region image alongside selectable translated text on the same reading page', async () => {
        const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlY4AAAAASUVORK5CYII=', 'base64'));
        const source = await PDFDocument.create();
        const page = source.addPage([600, 800]);
        page.drawText('Original paragraph before the figure.', {x: 42, y: 700, size: 12});
        page.drawImage(await source.embedPng(png), {x: 42, y: 500, width: 120, height: 80});
        page.drawText('Figure 1. Original retained illustration', {x: 42, y: 480, size: 10});
        page.drawText('Original paragraph after the figure.', {x: 42, y: 440, size: 12});
        const document = await parseBinaryDocument('figure.pdf', await source.save());
        const translations = document.segments.map((_segment, index) => `中文译文第${index + 1}段。`);
        let renderedRegions = 0;
        const renderer: PdfReadingRenderer = async function* (input) {
            // 控制浏览器 PNG 端口，分页、字体、PDF 嵌入和文本导出仍执行真实生产模块。
            for (const output of paginatePdfReadingPlan(input.plan, input.measureText)) {
                if (output.items.some(item => item.kind === 'region')) {renderedRegions++;yield {...output, regionImage: png};}
                else yield output;
            }
        };
        const download = await createDocumentDownload(document, translations, 'translated', {...textOnlyOptions, pdfReadingRenderer: renderer});
        expect(renderedRegions).toBe(1);
        const bytes = download.data as Uint8Array;
        expect(compact((await extract(bytes)).join(''))).toBe(compact(translations.join('')));
        const output = await PDFDocument.load(bytes);
        expect(output.getPageCount()).toBe(1);
        const images = output.getPages()[0].node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
        expect(images.values().some(value => {
            const object = output.context.lookup(value);
            return object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image');
        })).toBe(true);
        expect(document.segments.map(segment => segment.source).join('')).toContain('Original paragraph before the figure.');
    });

    it('keeps the default layout paired on one page even when a readable renderer is available', async () => {
        const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlY4AAAAASUVORK5CYII=', 'base64'));
        const raster = vi.fn(async () => png);
        const renderer = vi.fn(renderPdfReadingPages);
        const loader = vi.fn(async () => fontBytes);
        const download = await createDocumentDownload(await fixture(), ['对照标题', '原版排版译文'], 'bilingual', {
            pdfPageRasterizer: raster, pdfReadingRenderer: renderer, pdfFontLoader: loader,
        });
        const pdf = await PDFDocument.load(download.data as Uint8Array);
        expect(pdf.getPageCount()).toBe(1);
        expect(pdf.getPage(0).getSize()).toEqual({width: 1215, height: 800});
        expect((await extract(download.data as Uint8Array))[0]).toContain('Original selectable source page');
        expect(raster).toHaveBeenCalledOnce();
        expect(renderer).not.toHaveBeenCalled();
        expect(loader).not.toHaveBeenCalled();
    });

    it('cancels a font loader that remains pending without waiting for its completion', async () => {
        const controller = new AbortController();
        await expect(createDocumentDownload(await fixture(), ['标题', '译文'], 'translated', {...textOnlyOptions,
            signal: controller.signal, pdfFontLoader: async () => {
                controller.abort(new Error('Pending font canceled'));
                return new Promise<Uint8Array>(() => {});
            },
        })).rejects.toThrow('Pending font canceled');
    });

    it('does not load fonts for an unchanged bilingual document', async () => {
        const document = await fixture();
        const loader = vi.fn(async () => fontBytes);
        const download = await createDocumentDownload(document, document.segments.map(segment => segment.source), 'bilingual', {...textOnlyOptions, pdfFontLoader: loader});
        expect(loader).not.toHaveBeenCalled();
        expect((await extract(download.data as Uint8Array))[0]).toContain('Original selectable source page');
    });

    it('rejects missing glyphs explicitly instead of producing a broken downloadable PDF', async () => {
        await expect(createDocumentDownload(await fixture(), ['标题', '不支持的字符🦄'], 'translated', textOnlyOptions)).rejects.toThrow('U+1F984');
    });

    it('checks cancellation after font loading and closes a continuation iterator without changing translations', async () => {
        const controller = new AbortController();
        await expect(createDocumentDownload(await fixture(), ['标题', '译文'], 'translated', {...textOnlyOptions, signal: controller.signal,
            pdfFontLoader: async () => {controller.abort(new Error('Font loading canceled')); return fontBytes;},
        })).rejects.toThrow('Font loading canceled');
        const continuation = new AbortController();
        let released = false;
        const renderer: PdfReadingRenderer = async function* (input) {
            try {
                for await (const page of renderPdfReadingPages(input)) {
                    yield page;
                    continuation.abort(new Error('Continuation canceled'));
                }
            } finally {released = true;}
        };
        const translations = ['标题', '长文译文。'.repeat(1000)];
        await expect(createDocumentDownload(await fixture(), translations, 'translated', {...textOnlyOptions,
            pdfReadingRenderer: renderer, signal: continuation.signal,
        })).rejects.toThrow('Continuation canceled');
        expect(released).toBe(true);
        expect(translations).toEqual(['标题', '长文译文。'.repeat(1000)]);
    });

    it('cancels before fontkit initialization, during its lazy import, and after font embedding', async () => {
        const pdf = await PDFDocument.create();
        const before = new AbortController();
        before.abort(new Error('Before fontkit initialization'));
        await expect(embedPdfReadingFont(pdf, fontBytes, before.signal)).rejects.toThrow('Before fontkit initialization');
        const importing = new AbortController();
        const imported = embedPdfReadingFont(pdf, fontBytes, importing.signal);
        importing.abort(new Error('During fontkit initialization'));
        await expect(imported).rejects.toThrow('During fontkit initialization');
        const embedding = new AbortController();
        const embedFont = pdf.embedFont.bind(pdf);
        const spy = vi.spyOn(pdf, 'embedFont').mockImplementation(async (bytes, options) => {
            const font = await embedFont(bytes, options);
            embedding.abort(new Error('After embedding')); return font;
        });
        await expect(embedPdfReadingFont(pdf, fontBytes, embedding.signal)).rejects.toThrow('After embedding');
        spy.mockRestore();
        const ready = await embedPdfReadingFont(pdf, fontBytes);
        expect(() => ready.assertSupported('\n\r\t中文')).not.toThrow();
        expect(() => ready.assertSupported('')).not.toThrow();
    });
});

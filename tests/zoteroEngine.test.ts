import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ParsedDocument} from '../src/features/document-translation/core/document';
import type {AttachmentSource} from '../integrations/zotero/contracts';
import {defaultSettings} from '../integrations/zotero/settings';

const ports = vi.hoisted(() => ({parse: vi.fn(), download: vi.fn(), acquire: vi.fn(), release: vi.fn(), resources: vi.fn(), font: vi.fn(),
    translate: vi.fn(), selection: vi.fn(), rasterize: vi.fn(), reading: vi.fn()}));
vi.mock('../src/features/document-translation/services/binary', () => ({parseDocumentFile: ports.parse, createDocumentDownload: ports.download}));
vi.mock('../src/features/document-translation/services/pdfResources', () => ({configurePdfResources: ports.resources}));
vi.mock('../src/features/document-translation/services/pdfReadingFont', () => ({createPdfReadingFontLoader: ports.font}));
vi.mock('../src/features/document-translation/ui/pdfPreview', () => ({acquirePdfDocument: ports.acquire, rasterizePdfTranslationPage: ports.rasterize,
    rasterizePdfReadingPages: ports.reading, releasePdfDocument: ports.release}));
vi.mock('../integrations/zotero/translation', () => ({createZoteroTranslator: () => ({segments: ports.translate, selection: ports.selection})}));
import {createZoteroEngine} from '../integrations/zotero/engine';

const pdf = (): ParsedDocument => ({fileName: 'paper.pdf', format: 'pdf', label: 'PDF', parts: [], segments: [{id: 0, source: 'Paper'}],
    binary: {kind: 'pdf', bytes: new Uint8Array([1]), pages: []}});
const source = (): AttachmentSource => ({id: 1, libraryID: 1, key: 'PAPERKEY', title: 'Paper', fileName: 'paper.pdf',
    bytes: new TextEncoder().encode('%PDF-fixture'), fingerprint: 'hash'});
beforeEach(() => {vi.clearAllMocks(); ports.parse.mockResolvedValue(pdf()); ports.font.mockReturnValue(async () => new Uint8Array([7]));});
afterEach(() => vi.restoreAllMocks());
describe('Zotero document engine composition', () => {
    it('configures packaged Gecko PDF resources and copies source bytes at the parse boundary', async () => {
        const engine = createZoteroEngine(); const input = source(), progress = vi.fn();
        await engine.parse(input, new AbortController().signal, progress);
        expect(ports.resources).toHaveBeenCalledWith({assetRoot: 'chrome://fluentread/content/pdfjs', workerUrl: 'chrome://fluentread/content/pdfjs/pdf.worker.min.mjs'});
        const [file, options] = ports.parse.mock.calls[0];
        expect(file.name).toBe('paper.pdf'); expect(file.size).toBe(input.bytes.byteLength);
        const bytes = new Uint8Array(await file.arrayBuffer());
        expect(bytes).toEqual(input.bytes); expect(bytes).not.toBe(input.bytes);
        expect(await file.text()).toBe('%PDF-fixture');
        options.onPdfProgress({completed: 2, total: 4});
        expect(progress).toHaveBeenLastCalledWith({phase: '正在解析 PDF', completed: 2, total: 4});
    });
    it('does not silently produce incomplete results for a scanned or empty PDF', async () => {
        const engine = createZoteroEngine(); const parsed = pdf();
        parsed.segments = [];
        ports.parse.mockResolvedValueOnce(parsed);
        await expect(engine.parse(source(), new AbortController().signal, vi.fn())).rejects.toThrow('OCR');
        ports.parse.mockResolvedValueOnce({...pdf(), binary: {kind: 'pdf', bytes: new Uint8Array([1]), pages: [{pageNumber: 1, width: 10, height: 10,
            segmentIndexes: [], blocks: [], scanned: true}]}});
        await expect(engine.parse(source(), new AbortController().signal, vi.fn())).rejects.toThrow('扫描页');
    });
    it('passes checkpoints and immediate segment progress into the existing document translator', async () => {
        const engine = createZoteroEngine(); const segment = vi.fn(), progress = vi.fn();
        ports.translate.mockImplementation(async (_segments, options) => {
            options.onSegment({id: 0, translation: '论文'}); options.onProgress({completed: 1, total: 1});
            options.onRetry({delayMs: 1200}); return ['论文'];
        });
        expect(await engine.translate(pdf(), defaultSettings, new AbortController().signal, ['saved'], segment, progress)).toEqual(['论文']);
        expect(ports.translate.mock.calls[0][1]).toMatchObject({initialTranslations: ['saved'], batchConcurrency: 2,
            retryBackoff: {maxWaitMs: 60_000, maxDurationMs: 180_000}});
        expect(segment).toHaveBeenCalledWith(0, '论文');
        expect(progress).toHaveBeenCalledWith({phase: '正在翻译', completed: 1, total: 1});
        expect(progress).toHaveBeenLastCalledWith({phase: '服务繁忙，2 秒后重试'});
    });
    it.each(['success', 'failure', 'cancel'] as const)('holds and releases PDF resources after export %s', async phase => {
        const release = vi.fn(), controller = new AbortController(); const progress = vi.fn();
        ports.acquire.mockReturnValue({promise: Promise.resolve({}), release});
        ports.download.mockImplementation(async (_document, _translations, _mode, options) => {
            expect(options.pdfPageRasterizer).toBe(ports.rasterize);
            expect(options.pdfReadingRasterizer).toBe(ports.reading);
            options.onPdfProgress({phase: 'rendering', completedPages: 1, totalPages: 2});
            options.onPdfProgress({phase: 'saving', completedPages: 2, totalPages: 2});
            if (phase === 'failure') throw new Error('render failed');
            if (phase === 'cancel') controller.abort(new Error('canceled export'));
            return {data: new Uint8Array([3])};
        });
        const work = createZoteroEngine().export(pdf(), ['论文'], defaultSettings, controller.signal, progress);
        if (phase === 'success') expect(await work).toEqual(new Uint8Array([3]));
        else await expect(work).rejects.toThrow(phase === 'failure' ? 'render failed' : 'canceled export');
        expect(release).toHaveBeenCalledOnce();
        expect(progress).toHaveBeenCalledWith({phase: '正在保存 PDF', completed: 2, total: 2});
    });
    it('supports injected font resources, releases documents, and delegates selected text', async () => {
        const font = vi.fn(); const engine = createZoteroEngine({pdfFontLoader: font}); const parsed = pdf();
        ports.acquire.mockReturnValue({promise: Promise.resolve({}), release: vi.fn()});
        ports.download.mockResolvedValue({data: 'text export'});
        expect(await engine.export(parsed, [], defaultSettings, new AbortController().signal, vi.fn())).toEqual(new TextEncoder().encode('text export'));
        expect(ports.download.mock.calls[0][3].pdfFontLoader).toBe(font);
        engine.release(parsed); expect(ports.release).toHaveBeenCalledWith(parsed.binary?.bytes);
        ports.selection.mockResolvedValue('论文');
        expect(await engine.selection('Paper', defaultSettings, new AbortController().signal)).toBe('论文');
    });
    it('reuses validated default font bytes across exports without exposing the stored array', async () => {
        const underlying = vi.fn(async () => new Uint8Array([7]));
        ports.font.mockReturnValueOnce(underlying);
        ports.acquire.mockReturnValue({promise: Promise.resolve({}), release: vi.fn()});
        ports.download.mockImplementation(async (_document, _translations, _mode, options) => {
            const bytes = await options.pdfFontLoader();
            expect(bytes).toEqual(new Uint8Array([7])); bytes[0] = 99;
            return {data: new Uint8Array([1])};
        });
        const engine = createZoteroEngine();
        await engine.export(pdf(), [], defaultSettings, new AbortController().signal, vi.fn());
        await engine.export(pdf(), [], defaultSettings, new AbortController().signal, vi.fn());
        expect(underlying).toHaveBeenCalledOnce();
    });
});

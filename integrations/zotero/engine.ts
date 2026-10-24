/**
 * @file integrations/zotero/engine.ts
 * 文件职责：在 Zotero 内容窗口中组装 FluentRead 的本地文档解析、翻译与保版式 PDF 导出。
 * 主要内容：使用统一 PDF.js 资源地址、分段续译和原版光栅端口；导出期间持有 PDF 加载租约，完成、失败及任务释放时清理资源，字体沿用经过完整性校验的按需下载。
 * 模块边界：不读取 Zotero 文献库或写入附件、不拥有持久队列；宿主提供文件字节和请求端口，任务控制器负责写回资格。
 */
import {parseDocumentFile, createDocumentDownload} from '../../src/features/document-translation/services/binary';
import {configurePdfResources, type PdfRuntimeResources} from '../../src/features/document-translation/services/pdfResources';
import {createPdfReadingFontLoader} from '../../src/features/document-translation/services/pdfReadingFont';
import {acquirePdfDocument, rasterizePdfReadingPages, rasterizePdfTranslationPage, releasePdfDocument} from '../../src/features/document-translation/ui/pdfPreview';
import type {ZoteroEngine} from './contracts';
import {memoizeZoteroFontLoader} from './fontCache';
import {createZoteroTranslator, type ZoteroTranslationOptions} from './translation';

export interface ZoteroEngineOptions extends ZoteroTranslationOptions {
    pdfResources?: PdfRuntimeResources;
    pdfFontLoader?: (signal?: AbortSignal) => Promise<Uint8Array>;
}

export function createZoteroEngine(options: ZoteroEngineOptions = {}): ZoteroEngine {
    configurePdfResources(options.pdfResources ?? {assetRoot: 'chrome://fluentread/content/pdfjs',
        workerUrl: 'chrome://fluentread/content/pdfjs/pdf.worker.min.mjs'});
    const fontLoader = options.pdfFontLoader ?? memoizeZoteroFontLoader(createPdfReadingFontLoader({
        fetch: options.fetch ?? ((...args) => globalThis.fetch(...args)),
    }));
    return {
        async parse(source, signal, progress) {
            signal.throwIfAborted();
            progress({phase: '正在解析 PDF'});
            const bytes = source.bytes.slice();
            const parsed = await parseDocumentFile({name: source.fileName, size: bytes.byteLength,
                arrayBuffer: async () => bytes.buffer, text: async () => new TextDecoder().decode(bytes)}, {
                signal, onPdfProgress: value => progress({phase: '正在解析 PDF', ...value}),
            });
            signal.throwIfAborted();
            if (!parsed.segments.length || parsed.binary?.kind === 'pdf' && parsed.binary.pages.some(page => page.scanned)) {
                throw new Error('这份 PDF 含有需要文字识别的扫描页，请先完成 OCR 后再翻译；没有生成不完整的译文');
            }
            return parsed;
        },
        translate(document, settings, signal, initial, segment, progress) {
            return createZoteroTranslator(settings, options).segments(document.segments, {
                fileName: document.fileName, sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage,
                serviceOverride: settings.service, modelOverride: settings.model, signal, initialTranslations: initial,
                batchConcurrency: 2, retryBackoff: {maxWaitMs: 60_000, maxDurationMs: 180_000},
                onSegment: value => segment(value.id, value.translation),
                onProgress: value => progress({phase: '正在翻译', ...value}),
                onRetry: value => progress({phase: `服务繁忙，${Math.ceil(value.delayMs / 1000)} 秒后重试`}),
            });
        },
        async export(document, translations, settings, signal, progress) {
            signal.throwIfAborted();
            progress({phase: '正在生成译文 PDF'});
            const lease = document.binary?.kind === 'pdf' ? acquirePdfDocument(document.binary.bytes) : undefined;
            void lease?.promise.catch(() => undefined);
            try {
                const result = await createDocumentDownload(document, translations, settings.output, {
                    signal, pdfPageRasterizer: rasterizePdfTranslationPage, pdfReadingRasterizer: rasterizePdfReadingPages,
                    pdfFontLoader: fontLoader,
                    onPdfProgress: value => progress({phase: value.phase === 'saving' ? '正在保存 PDF' : '正在生成译文 PDF',
                        completed: value.completedPages, total: value.totalPages}),
                });
                signal.throwIfAborted();
                return typeof result.data === 'string' ? new TextEncoder().encode(result.data) : result.data;
            } finally {lease?.release();}
        },
        selection(text, settings, signal) {return createZoteroTranslator(settings, options).selection(text, signal);},
        release(document) {if (document.binary?.kind === 'pdf') releasePdfDocument(document.binary.bytes);},
    };
}

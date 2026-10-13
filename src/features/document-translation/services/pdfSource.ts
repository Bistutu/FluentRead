/**
 * @file src/features/document-translation/services/pdfSource.ts
 * 文件职责：从用户指定的在线地址获取 PDF，沿用文档大小限制并支持可取消、可报告进度的导入。
 * 主要内容：逐块读取并在超限时停止下载，校验 PDF 文件签名，生成安全文件名，释放流读取器；原文件仅在当前扩展页面使用。
 * 模块边界：仅负责文件获取，不解析 PDF、不发起翻译；URL 校验归 core/pdfSource，解析沿用 binary 服务。
 */
import {PDF_MAX_BYTES} from '../core/document';
import {normalizeOnlinePdfUrl} from '../core/pdfSource';

export interface PdfDownloadProgress {received: number; total?: number}
export interface FetchPdfOptions {
    signal?: AbortSignal;
    onProgress?: (progress: PdfDownloadProgress) => void;
    fetch?: typeof fetch;
}

function fileNameFromUrl(url: string): string {
    let name: string;
    try {name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) || 'document');}
    catch {name = 'document';}
    name = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/gu, '_').slice(0, 160);
    return /\.pdf$/iu.test(name) ? name : `${name}.pdf`;
}

export async function fetchOnlinePdf(value: string, options: FetchPdfOptions = {}): Promise<File> {
    const url = normalizeOnlinePdfUrl(value);
    if (!url) throw new Error('请输入有效的 HTTP 或 HTTPS PDF 链接');
    options.signal?.throwIfAborted();
    const response = await (options.fetch ?? fetch)(url, {signal: options.signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (!response.ok) throw new Error(`PDF 下载失败（HTTP ${response.status}），可下载文件后导入`);
    const size = Number(response.headers.get('content-length'));
    const total = Number.isFinite(size) && size > 0 ? size : undefined;
    const sizeError = () => new Error(`PDF 超过 ${Math.round(PDF_MAX_BYTES / 1024 / 1024)} MB，请先拆分后导入`);
    if (total && total > PDF_MAX_BYTES) {await response.body?.cancel(); throw sizeError();}
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    const abort = () => {void reader?.cancel(options.signal!.reason).catch(() => undefined);};
    options.signal?.addEventListener('abort', abort, {once: true});
    try {
        if (reader) {
            while (true) {
                options.signal?.throwIfAborted();
                const result = await reader.read();
                options.signal?.throwIfAborted();
                if (result.done) break;
                received += result.value.byteLength;
                if (received > PDF_MAX_BYTES) throw sizeError();
                chunks.push(result.value);
                options.onProgress?.({received, total});
            }
        } else {
            const bytes = new Uint8Array(await response.arrayBuffer());
            options.signal?.throwIfAborted();
            received = bytes.byteLength;
            if (received > PDF_MAX_BYTES) throw sizeError();
            chunks.push(bytes);
            options.onProgress?.({received, total});
        }
        const prefix = chunks.flatMap(chunk => [...chunk.slice(0, 5)]).slice(0, 5);
        if (String.fromCharCode(...prefix) !== '%PDF-') throw new Error('链接未返回有效 PDF，可能需要登录；请下载文件后导入');
        options.signal?.throwIfAborted();
        return new File(chunks as BlobPart[], fileNameFromUrl(response.url || url), {type: 'application/pdf'});
    } finally {
        options.signal?.removeEventListener('abort', abort);
        if (reader) {
            try {await reader.cancel();} catch { /* 已中止的流无需再次处理。 */ }
            reader.releaseLock();
        }
    }
}

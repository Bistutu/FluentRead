/**
 * @file src/features/document-translation/services/pdfReadingFont.ts
 * 文件职责：在首次导出可读 PDF 时按需取得开放字体，校验并缓存后嵌入可见文字及 Unicode 映射。
 * 主要内容：固定字体版本、长度和 SHA-256，通过国内及全球数据源有界下载、超时回退与持久缓存；共享在途下载但独立处理各调用方取消。使用 pdf-lib 官方 fontkit 子集机制，并提前拒绝缺字。
 * 模块边界：属于文档二进制服务；远程仅下载无用户内容或凭据的字体数据，不执行远程 JS/WASM，不进入内容脚本字体或界面字体注册链路。不保存字体解析器或导出文档的全局引用。
 */
import type {PDFDocument, PDFFont} from 'pdf-lib';

export const PDF_READING_FONT_PATH = '/pdf-fonts/FluentReadNotoSansSC-Regular.woff2';
export const PDF_READING_FONT_BYTES = 4_977_684;
export const PDF_READING_FONT_SHA256 = 'ea983e51e010c28a6a03839cffea942243e49342be7307be4f2f283e73ab8127';
export const PDF_READING_FONT_REVISION = '55d1219bd62e059f921b639b658a2a0a8e36d53d';
export const PDF_READING_FONT_CACHE = 'fluentread-pdf-reading-font-v1';
export const PDF_READING_FONT_CACHE_KEY = `https://fluentread.app/__optional_assets__/pdf-font/${PDF_READING_FONT_SHA256}.woff2`;

/** 语言仅提供尝试顺序提示，不探测所在地；各来源必须返回同一固定版本的字体。 */
export function getPdfReadingFontSources(locale: string): string[] {
    const resource = `FluentRead/FluentRead@${PDF_READING_FONT_REVISION}/public${PDF_READING_FONT_PATH}`;
    const china = [`https://cdn.jsdmirror.com/gh/${resource}`, `https://jsd.onmicrosoft.cn/gh/${resource}`];
    const global = [`https://cdn.jsdelivr.net/gh/${resource}`,
        `https://raw.githubusercontent.com/FluentRead/FluentRead/${PDF_READING_FONT_REVISION}/public${PDF_READING_FONT_PATH}`];
    return /^zh(?:$|-CN|-Hans)/iu.test(locale) ? [...china, ...global] : [...global, ...china];
}

export interface PdfReadingFontLoaderDependencies {
    fetch: typeof fetch;
    openCache: () => Promise<Pick<Cache, 'match' | 'put' | 'delete'>>;
    digest: (data: ArrayBuffer) => Promise<ArrayBuffer>;
    locale: () => string;
    timeoutMs: number;
}

/** 不合作的网络、流或缓存端口也不能阻塞调用方取消。迟到结果只负责释放监听。 */
function withAbort<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return Promise.resolve().then(operation);
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, {once: true});
        void Promise.resolve().then(() => {signal.throwIfAborted(); return operation();})
            .then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

export function createPdfReadingFontLoader(overrides: Partial<PdfReadingFontLoaderDependencies> = {}) {
    const deps: PdfReadingFontLoaderDependencies = {
        fetch: (...args) => globalThis.fetch(...args),
        openCache: () => caches.open(PDF_READING_FONT_CACHE),
        digest: data => crypto.subtle.digest('SHA-256', data),
        locale: () => typeof navigator === 'undefined' ? '' : navigator.language,
        timeoutMs: 25_000,
        ...overrides,
    };
    type Download = {controller: AbortController; subscribers: number; promise: Promise<Uint8Array>};
    let pending: Download | undefined;

    async function readVerified(response: Response, signal: AbortSignal): Promise<Uint8Array> {
        if (!response.ok || !response.body || /text\/html/iu.test(response.headers.get('Content-Type') || '')) {
            throw new Error('PDF 导出字体来源不可用');
        }
        if (!response.headers.get('Content-Encoding') && Number(response.headers.get('Content-Length')) > PDF_READING_FONT_BYTES) {
            throw new Error('PDF 导出字体超过预期大小');
        }
        const reader = response.body.getReader();
        const bytes = new Uint8Array(PDF_READING_FONT_BYTES);
        let offset = 0;
        try {
            while (true) {
                const chunk = await withAbort(() => reader.read(), signal);
                if (chunk.done) break;
                if (offset + chunk.value.byteLength > bytes.byteLength) throw new Error('PDF 导出字体超过预期大小');
                bytes.set(chunk.value, offset);
                offset += chunk.value.byteLength;
            }
        } finally {void reader.cancel().catch(() => undefined);}
        if (offset !== bytes.byteLength) throw new Error('PDF 导出字体不完整');
        const digest = await withAbort(() => deps.digest(bytes.buffer), signal);
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== PDF_READING_FONT_SHA256) throw new Error('PDF 导出字体完整性校验失败');
        signal.throwIfAborted();
        return bytes;
    }

    async function run(signal: AbortSignal): Promise<Uint8Array> {
        const cache = await withAbort(() => deps.openCache(), signal).catch(() => undefined);
        signal.throwIfAborted();
        if (cache) {
            try {
                const response = await withAbort(() => cache.match(PDF_READING_FONT_CACHE_KEY), signal);
                if (response) return await readVerified(response, signal);
            } catch {
                signal.throwIfAborted();
                await withAbort(() => cache.delete(PDF_READING_FONT_CACHE_KEY), signal).catch(() => undefined);
                signal.throwIfAborted();
            }
        }
        let failure: unknown;
        for (const source of getPdfReadingFontSources(deps.locale())) {
            signal.throwIfAborted();
            const controller = new AbortController();
            const abort = () => controller.abort(signal.reason);
            signal.addEventListener('abort', abort, {once: true});
            const timer = setTimeout(() => controller.abort(new DOMException('PDF 导出字体下载超时', 'TimeoutError')), deps.timeoutMs);
            try {
                const response = await withAbort(() => deps.fetch(source, {
                    signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
                }), controller.signal);
                const bytes = await readVerified(response, controller.signal);
                signal.throwIfAborted();
                if (cache) await withAbort(() => cache.put(PDF_READING_FONT_CACHE_KEY,
                    new Response(bytes, {headers: {'Content-Type': 'font/woff2'}})), signal).catch(() => undefined);
                signal.throwIfAborted();
                return bytes;
            } catch (error) {signal.throwIfAborted(); failure = error;}
            finally {clearTimeout(timer); controller.abort(); signal.removeEventListener('abort', abort);}
        }
        throw new Error('PDF 导出字体下载失败，请检查网络后重试', {cause: failure});
    }

    return async (signal?: AbortSignal): Promise<Uint8Array> => {
        signal?.throwIfAborted();
        if (!pending) {
            const controller = new AbortController();
            const download: Download = {controller, subscribers: 0,
                promise: Promise.resolve().then(() => run(controller.signal)).finally(() => {if (pending === download) pending = undefined;}),
            };
            // 最后一位订阅者可能在安装 await 之前退出，仍须接住后台任务的取消拒绝。
            void download.promise.catch(() => undefined);
            pending = download;
        }
        const download = pending;
        download.subscribers++;
        try {return await withAbort(() => download.promise, signal);}
        finally {
            download.subscribers--;
            if (download.subscribers === 0 && pending === download) {
                pending = undefined;
                download.controller.abort(new DOMException('PDF 导出字体下载已取消', 'AbortError'));
            }
        }
    };
}

export const loadPdfReadingFontBytes = createPdfReadingFontLoader();

export interface PdfReadingEmbeddedFont {font: PDFFont; assertSupported(text: string): void}

export async function embedPdfReadingFont(pdf: PDFDocument, bytes: Uint8Array, signal?: AbortSignal): Promise<PdfReadingEmbeddedFont> {
    signal?.throwIfAborted();
    const {default: fontkit} = await import('@pdf-lib/fontkit');
    signal?.throwIfAborted();
    pdf.registerFontkit(fontkit);
    // 不依赖字体默认启用的拉丁连字；测量和输出都使用同一套可见字形。
    const font = await pdf.embedFont(bytes, {subset: true, features: {liga: false}});
    const supported = new Set(font.getCharacterSet());
    signal?.throwIfAborted();
    return {font, assertSupported(text) {
        for (const character of text) {
            if (/^[\n\r\t]$/u.test(character)) continue;
            const code = character.codePointAt(0)!;
            if (!supported.has(code)) {
                throw new Error(`PDF 导出字体缺少字符 ${character} (U+${code.toString(16).toUpperCase()})，请校订该字符后重试；没有生成缺字的 PDF`);
            }
        }
    }};
}

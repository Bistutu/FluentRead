/**
 * @file src/features/document-translation/core/pdfSource.ts
 * 文件职责：规范在线 PDF 的入口地址和文档阅读页链接，避免把任意浏览器内部页或本地文件地址当作网络文件请求。
 * 主要内容：严格限制无凭据的 HTTP/HTTPS 地址；识别 PDF 后缀与 arXiv 论文路径；源地址放在 fragment 中，供阅读页显式导入。
 * 模块边界：纯地址处理，不访问标签页、网络或 DOM；下载归 services/pdfSource，入口跳转归 app。
 */
export function normalizeOnlinePdfUrl(value: string): string | null {
    try {
        const url = new URL(value.trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        url.hash = '';
        return url.href;
    } catch {return null;}
}

/** 自动判断只接受明确的 PDF 路径；手动导入可使用没有后缀的下载地址。 */
export function getPdfSourceUrl(value: string): string | null {
    const normalized = normalizeOnlinePdfUrl(value);
    if (!normalized) return null;
    const url = new URL(normalized);
    return /\.pdf$/iu.test(url.pathname)
        || ((url.hostname === 'arxiv.org' || url.hostname === 'www.arxiv.org') && /^\/pdf\/[^/]+\/?$/u.test(url.pathname))
        ? normalized : null;
}

export function createPdfReaderUrl(readerUrl: string, sourceUrl: string): string {
    const normalized = normalizeOnlinePdfUrl(sourceUrl);
    if (!normalized) throw new Error('请输入有效的 HTTP 或 HTTPS PDF 链接');
    return `${readerUrl.split('#')[0]}#${new URLSearchParams({pdf: normalized})}`;
}

export function readPdfSourceFragment(fragment: string): string | null {
    const value = new URLSearchParams(fragment.replace(/^#/u, '')).get('pdf');
    return value ? normalizeOnlinePdfUrl(value) : null;
}

/**
 * @file src/features/document-translation/services/pdfReadingFont.ts
 * 文件职责：仅在导出可读 PDF 时加载随扩展提供的开放字体，嵌入可见文字及 Unicode 映射。
 * 主要内容：按需读取固定 Noto CJK 字体，包含离线补充的拉丁扩展、希腊文与数学符号；使用 pdf-lib 官方 fontkit 子集机制，提前拒绝仍未覆盖的字形；变体序列各用独立子集，避免与普通字符共用字形时覆盖 Unicode 映射。不保存字体解析器或导出文档的全局引用。
 * 模块边界：属于文档二进制服务，不进入内容脚本字体或界面字体下载链路，不请求第三方网络。
 */
import type {PDFDocument, PDFFont, PDFPage, PDFPageDrawTextOptions} from 'pdf-lib';
import {isPdfReadingVariationSelector} from '../core/pdfTextLayout';

export const PDF_READING_FONT_PATH = '/pdf-fonts/FluentReadNotoSansSC-Regular.woff2';
export const PDF_READING_FONT_BYTES = 5_112_688;

export async function loadPdfReadingFontBytes(signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted();
    const response = await fetch(PDF_READING_FONT_PATH, {signal, cache: 'force-cache'});
    if (!response.ok) throw new Error('PDF 导出字体加载失败，请重新打开文档后重试');
    const bytes = new Uint8Array(await response.arrayBuffer());
    signal?.throwIfAborted();
    if (bytes.byteLength !== PDF_READING_FONT_BYTES) throw new Error('PDF 导出字体不完整，请重新安装正式扩展后重试');
    return bytes;
}

export interface PdfReadingEmbeddedFont {
    font: PDFFont;
    assertSupported(text: string): void;
    prepareText(text: string): Promise<void>;
    measureText(text: string, size: number): number;
    drawText(page: PDFPage, text: string, options: Pick<PDFPageDrawTextOptions, 'color'> & {x: number; y: number; size: number}): void;
}

const VARIATION_SEQUENCE = /[^\uFE00-\uFE0F\u{E0100}-\u{E01EF}][\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;

export async function embedPdfReadingFont(pdf: PDFDocument, bytes: Uint8Array, signal?: AbortSignal): Promise<PdfReadingEmbeddedFont> {
    signal?.throwIfAborted();
    const {default: fontkit} = await import('@pdf-lib/fontkit');
    signal?.throwIfAborted();
    pdf.registerFontkit(fontkit);
    // 不依赖字体默认启用的拉丁连字；测量和输出都使用同一套可见字形。
    const font = await pdf.embedFont(bytes, {subset: true, features: {liga: false}});
    const supported = new Set(font.getCharacterSet());
    signal?.throwIfAborted();
    const variationFonts = new Map<string, PDFFont>();
    const assertSupported = (text: string) => {
        let previous = '';
        for (const character of text) {
            const code = character.codePointAt(0)!;
            if (isPdfReadingVariationSelector(character)) {
                if (!previous || /\s/u.test(previous) || isPdfReadingVariationSelector(previous)) {
                    throw new Error(`PDF 导出文字包含孤立变体选择符 (U+${code.toString(16).toUpperCase()})，请校订该字符后重试`);
                }
            } else if (!/^[\n\r\t]$/u.test(character) && !supported.has(code)) {
                throw new Error(`PDF 导出字体缺少字符 ${character} (U+${code.toString(16).toUpperCase()})，请校订该字符后重试；没有生成缺字的 PDF`);
            }
            previous = character;
        }
    };
    const runs = (text: string): {text: string; font: PDFFont}[] => {
        const result: {text: string; font: PDFFont}[] = [];
        let cursor = 0;
        for (const match of text.matchAll(VARIATION_SEQUENCE)) {
            if (match.index > cursor) result.push({text: text.slice(cursor, match.index), font});
            const variant = variationFonts.get(match[0]);
            if (!variant) throw new Error('PDF 变体字符尚未准备，请重新生成文件');
            result.push({text: match[0], font: variant});
            cursor = match.index + match[0].length;
        }
        if (cursor < text.length) result.push({text: text.slice(cursor), font});
        return result;
    };
    return {font, assertSupported, async prepareText(text) {
        signal?.throwIfAborted();
        assertSupported(text);
        for (const match of text.matchAll(VARIATION_SEQUENCE)) {
            if (variationFonts.has(match[0])) continue;
            // fontkit 与 pdf-lib 都按 glyph id 复用映射；一个序列一份子集，完整保留 base + VS 的复制身份。
            // 字体有对应变体时由 fontkit 选择；否则使用该字体的基础字形，不删除选择符。
            const variant = await pdf.embedFont(bytes, {subset: true, features: {liga: false}});
            signal?.throwIfAborted();
            variant.widthOfTextAtSize(match[0], 1);
            variationFonts.set(match[0], variant);
        }
    }, measureText(text, size) {
        return runs(text).reduce((width, run) => width + run.font.widthOfTextAtSize(run.text, size), 0);
    }, drawText(page, text, options) {
        let x = options.x;
        for (const run of runs(text)) {
            page.drawText(run.text, {...options, font: run.font, x});
            x += run.font.widthOfTextAtSize(run.text, options.size);
        }
    }};
}

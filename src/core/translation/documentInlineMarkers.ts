/**
 * @file src/core/translation/documentInlineMarkers.ts
 * 文件职责：保留文档整句翻译的编号行内标签，让标签中的文字正常参与翻译。
 * 主要内容：共享实体、全角和空白写法归一，逐槽检查每个编号的次数、配对、自闭合和嵌套父子关系；允许兄弟节点随译句重排，兼容自闭合标记被写成空标签对；在实际目标语言下拒绝唯一平级节点的普通正文原样返回，显式术语、代码、专名及歧义嵌套保持保守。
 * 模块边界：纯文本协议，不读取配置或调用服务；只由文档入口启用，不评价一般语义质量，也无法识别两个结构相同槽的正文被交换。
 */
import {isLikelyUntranslatedInlineResponse} from './resultValidation';

export interface DocumentInlineValidationContext {
    targetLanguage: string;
    protectedTokens?: readonly string[];
}

export class DocumentInlineTextError extends Error {
    readonly kind = 'response';
    readonly code = 'DOCUMENT_INLINE_TEXT_UNTRANSLATED';
    readonly retryable = false;
    constructor(text: string) {
        super(`翻译服务未翻译文档行内正文：${text.slice(0, 80)}`);
        this.name = 'DocumentInlineTextError';
    }
}

export class DocumentInlineMarkerError extends Error {
    readonly code = 'DOCUMENT_INLINE_MARKER_INVALID';
    readonly retryable = false;
    constructor() {
        super('翻译服务未完整保留文档行内格式，请重试或切换翻译服务');
        this.name = 'DocumentInlineMarkerError';
    }
}

/** 只规范编号标签，不解码或改写正文中的其他实体。 */
export function normalizeDocumentInlineMarkers(text: string): string {
    return text.replace(/(?:&(?:lt|#0*60|#x0*3c);|[<＜〈（(])\s*([\/／]?)\s*[gＧｇ]\s*([0-9０-９]+)\s*([\/／]?)\s*(?:&(?:gt|#0*62|#x0*3e);|[>＞〉）)])/giu,
        (_, open: string, id: string, close: string) => `<${open ? '/' : ''}g${id.replace(/[０-９]/gu, value => String(value.charCodeAt(0) - 0xff10))}${close ? '/' : ''}>`);
}

/** Canonical 内部语法从术语正文匹配中排除，用户的同名短词仍可匹配标签之间的文字。 */
export function documentInlineMarkerRanges(text: string): Array<{start: number; end: number}> {
    return [...text.matchAll(/<\/?g[1-9]\d*\/?\s*>/gu)].map(match => ({start: match.index, end: match.index + match[0].length}));
}

function structure(text: string): {counts: Map<string, number>; selfClosingIds: Set<string>} | null {
    const counts = new Map<string, number>(), selfClosingIds = new Set<string>();
    const open: string[] = [];
    for (const match of text.matchAll(/<(\/?)g(\d+)(\/?)>/gu)) {
        const [, closing, id, selfClosing] = match;
        if (!/^[1-9]\d*$/u.test(id!) || closing && selfClosing) return null;
        if (closing) {
            if (open.pop() !== id) return null;
        } else {
            const key = `${id}:${open.at(-1) ?? ''}:${selfClosing ? 'self' : 'pair'}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
            if (selfClosing) selfClosingIds.add(id!);
            else open.push(id!);
        }
    }
    return open.length ? null : {counts, selfClosingIds};
}

/** 源文不是完整内部协议时保留字面写法；合法文档协议必须在候选胜出前完整保留。 */
export function validateDocumentInlineMarkers(origin: string, result: unknown, context?: DocumentInlineValidationContext): unknown {
    const expected = structure(origin);
    if (!expected?.counts.size) return result;
    if (typeof result !== 'string') throw new DocumentInlineMarkerError();
    const normalized = normalizeDocumentInlineMarkers(result).replace(/<g(\d+)>\s*<\/g\1>/gu,
        (pair, id: string) => expected.selfClosingIds.has(id) ? `<g${id}/>` : pair);
    const actual = structure(normalized);
    if (!actual || actual.counts.size !== expected.counts.size
        || [...expected.counts].some(([key, count]) => actual.counts.get(key) !== count)) throw new DocumentInlineMarkerError();
    if (context) {
        const paired = (text: string) => new Map([...text.matchAll(/<g(\d+)>([\s\S]*?)<\/g\1>/gu)].map(match => [match[1]!, match[2]!]));
        const translations = paired(normalized);
        for (const [id, source] of paired(origin)) {
            // 重复编号或嵌套正文缺少唯一的独立节点身份，不猜测哪处文字应当翻译。
            if ([...expected.counts].filter(([key]) => key.startsWith(`${id}:`)).reduce((sum, [, count]) => sum + count, 0) !== 1
                || /<\/?g\d+\/?\s*>/u.test(source)) continue;
            const target = translations.get(id)!;
            if (context.protectedTokens?.some(token => source.includes(token) || target.includes(token))) continue;
            if (isLikelyUntranslatedInlineResponse(source, target, context.targetLanguage, origin)) throw new DocumentInlineTextError(source);
        }
    }
    return normalized;
}

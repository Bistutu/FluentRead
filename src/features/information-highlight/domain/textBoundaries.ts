/**
 * @file src/features/information-highlight/domain/textBoundaries.ts
 * 文件职责：为评分和段落切分保留原文 UTF-16 字素边界，防止切断 emoji、组合重音或代理对。
 * 主要内容：优先使用标准字素分段，缺失时合并 Unicode mark、连接符及相邻连接字符；提供完整边界及受限切片终点。
 * 模块边界：纯文本工具，不规范化或改写原文、不访问网页与平台模型，所有偏移仍对应调用方的原始字符串。
 */
export function informationGraphemeBoundaries(text: string): Set<number> {
    const boundaries = new Set<number>([0, text.length]);
    if (Intl.Segmenter) {
        for (const part of new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text)) boundaries.add(part.index);
    } else {
        let index = 0, joinNext = false;
        for (const character of text) {
            if (index && !joinNext && character !== '\u200d' && !/[\p{M}\uFE0F\u{1F3FB}-\u{1F3FF}]/u.test(character)) boundaries.add(index);
            joinNext = character === '\u200d'; index += character.length;
        }
    }
    return boundaries;
}
export function informationSliceEnd(text: string, start: number, maximum: number): number {
    const target = Math.min(text.length, start + maximum);
    if (target === text.length) return target;
    if (Intl.Segmenter) {
        const segment = new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text).containing(target)!;
        return segment.index > start ? segment.index : segment.index + segment.segment.length;
    }
    let end = target;
    if (/[\uDC00-\uDFFF]/u.test(text[end])) end--;
    while (end < text.length && (/[\p{M}\uFE0F]/u.test(text[end]) || text[end] === '\u200d' || text[end - 1] === '\u200d')) {
        const code = text.codePointAt(end)!; end += code > 0xffff ? 2 : 1;
    }
    return end;
}

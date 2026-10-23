/**
 * @file src/features/information-highlight/domain/textBoundaries.ts
 * 文件职责：为评分和段落切分保留原文 UTF-16 字素边界，防止切断 emoji、组合重音或代理对。
 * 主要内容：优先使用标准字素分段，缺失时合并 Unicode mark、肤色修饰、旗帜对、CRLF 和连接符序列，切片复用同一边界并保证首个字素过长时仍向前推进；提供完整边界及受限切片终点。
 * 模块边界：纯文本工具，不规范化或改写原文、不访问网页与平台模型，所有偏移仍对应调用方的原始字符串。
 */
export function informationGraphemeBoundaries(text: string): Set<number> {
    const boundaries = new Set<number>([0, text.length]);
    if (Intl.Segmenter) {
        for (const part of new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text)) boundaries.add(part.index);
    } else {
        let index = 0, joinNext = false, regionalCount = 0, previous = '';
        for (const character of text) {
            const regional = /[\u{1F1E6}-\u{1F1FF}]/u.test(character);
            if (index && !joinNext && character !== '\u200d' && !/[\p{M}\uFE0F\u{1F3FB}-\u{1F3FF}]/u.test(character)
                && !(regional && regionalCount % 2 === 1) && !(previous === '\r' && character === '\n')) boundaries.add(index);
            regionalCount = regional ? regionalCount + 1 : 0;
            joinNext = character === '\u200d'; previous = character; index += character.length;
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
    const boundaries = informationGraphemeBoundaries(text);
    let before = start, after = text.length;
    for (const boundary of boundaries) {
        if (boundary <= target && boundary > before) before = boundary;
        if (boundary > target && boundary < after) after = boundary;
    }
    // 与原生分段一致：优先不超过预算；首个完整字素比预算长时取它的结尾，不能返回原位置。
    return before > start ? before : after;
}

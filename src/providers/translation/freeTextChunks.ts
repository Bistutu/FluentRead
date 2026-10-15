/**
 * @file src/providers/translation/freeTextChunks.ts
 * 文件职责：免费网页服务按 Unicode 码点或 UTF-16 预算分块，保持完整 emoji 字素及术语保护标记并优先保留句子和词语边界。
 * 主要内容：扫描 FRTERM 与 emoji 原子范围并映射码点位置，切点遇到原子时退到原子前；请求默认优先完整句子与词语，识别句末引号、常见缩写和数字单位，单个字素或标记超过硬预算时在请求前明确拒绝。
 * 模块边界：纯文本分块，不解码槽包、不恢复术语、不自行请求网络；共享循环保持换行、边缘空白与取消，provider 仅注入逐块传输。
 */
import {abortErrorFromSignal} from '@/src/platform/http/runtime';
import {findEmojiLiteralRanges} from '@/src/core/translation/emojiLiterals';

const CLOSING_PUNCTUATION = /["'”’»」』）)\]}]/u;
const TITLE_OR_INITIAL = /(?:^|[\s"'“‘(])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|[A-Z])\.$/u;
const ABBREVIATION = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|(?:[A-Za-z]\.)+[A-Za-z])\.$/iu;
// 仅保护明确的数字+单位组合；不把所有数字后的普通单词视为不可拆单位。
const UNIT_START = /^(?:[yzafpnumcdhkMGTPEZYµμ]?(?:s|g|m|A|K|Hz|W|J|V|Pa|B)|min|h|mol|cd|KiB|MiB|GiB|TiB|°[CF]|%|‰)(?![\p{L}\p{N}_])/u;

/** 预算内先取后半段的完整句子，再取安全词界；前半段词界能避免拆开一个本可装下的长词。 */
function preferredBoundary(points: string[], start: number, end: number): number {
    const middle = start + Math.ceil((end - start) / 2);
    let sentence = 0, word = 0, early = 0, terminal = '';
    let hasContent = false;
    for (let cut = start + 1; cut <= end; cut++) {
        const previous = points[cut - 1]!;
        const whitespace = /\s/u.test(previous);
        if (!whitespace) hasContent = true;
        if (!whitespace && !CLOSING_PUNCTUATION.test(previous)) terminal = previous;
        if (whitespace && (!hasContent || /\s/u.test(points[cut]!))) continue;
        const cjkSentence = /[。！？]/u.test(terminal) && !CLOSING_PUNCTUATION.test(points[cut]!);
        if (!whitespace && !cjkSentence) continue;
        const before = points.slice(Math.max(start, cut - 32), cut).join('').trimEnd();
        if (whitespace && (
            /[\u00a0\u202f]/u.test(previous)
            || TITLE_OR_INITIAL.test(before)
            || (/\d$/u.test(before) && UNIT_START.test(points.slice(cut, cut + 16).join('')))
        )) continue;
        const unquoted = before.replace(/["'”’»」』）)\]}]+$/u, '');
        const endsSentence = cjkSentence || (/[.!?]$/u.test(unquoted) && !ABBREVIATION.test(unquoted));
        if (cut >= middle) {
            word = cut;
            if (endsSentence) sentence = cut;
        } else early = cut;
    }
    return sentence || word || early || end;
}

export function* splitFreeTextChunks(text: string, limit: number, words = false, utf16 = false): Generator<string> {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('分块字符预算必须为正整数');
    const points = Array.from(text);
    const spans: Array<[start: number, end: number]> = [];
    let point = 0, offset = 0;
    // 与术语保护链的 ASCII FRTERM 语法一致；只把完整标记视为不可拆单元。
    const atomic = [...text.matchAll(/__FRTERM_[a-z0-9_]+?__/giu)].map(match => {
        if (match[0].length > limit) throw Object.assign(new Error('术语保护标记超过翻译服务字符预算'), {freeFailure: 'request'});
        return {start: match.index, end: match.index + match[0].length};
    });
    for (const range of findEmojiLiteralRanges(text)) {
        const value = text.slice(range.start, range.end);
        if ((utf16 ? value.length : Array.from(value).length) > limit) throw Object.assign(
            new RangeError('分块字符预算不足以容纳一个完整 emoji 字素'), {freeFailure: 'request'});
        atomic.push(range);
    }
    for (const range of atomic.sort((a, b) => a.start - b.start)) {
        while (offset < range.start) offset += points[point++]!.length;
        const start = point;
        while (offset < range.end) offset += points[point++]!.length;
        spans.push([start, point]);
    }
    let start = 0, spanIndex = 0;
    while (start < points.length) {
        let end = Math.min(points.length, start + limit);
        if (utf16) {
            end = start;
            let length = 0;
            while (end < points.length && length + points[end]!.length <= limit) length += points[end++]!.length;
            if (end === start) throw new RangeError('分块字符预算不足以容纳一个 Unicode 码点');
        }
        if (words && end < points.length) end = preferredBoundary(points, start, end);
        // 当前块从原子开始时，词界至少通过整个原子；预算已预验，不会产生空块或越界请求。
        if (spans[spanIndex]?.[0] === start) end = Math.max(end, spans[spanIndex]![1]);
        while (spans[spanIndex] && spans[spanIndex]![1] <= end) spanIndex++;
        const span = spans[spanIndex];
        if (span && span[0] < end) end = span[0];
        yield points.slice(start, end).join('');
        start = end;
    }
}

/** 默认保留逐行语义；允许服务整段处理换行，每块传输后检查取消，不提交迟到内容。 */
export async function translateFreeTextChunks(text: string, limit: number, translate: (text: string) => Promise<string>, signal?: AbortSignal, words = true, options: {utf16?: boolean; splitLines?: boolean} = {}): Promise<string> {
    let output = '';
    for (const line of options.splitLines === false ? [text] : text.split(/([\r\n]+)/u)) {
        for (const chunk of splitFreeTextChunks(line, limit, words, options.utf16)) {
            if (signal?.aborted) throw abortErrorFromSignal(signal);
            const content = chunk.trim();
            if (!content) { output += chunk; continue; }
            const prefix = chunk.slice(0, chunk.indexOf(content));
            const suffix = chunk.slice(prefix.length + content.length);
            const translated = await translate(content);
            if (signal?.aborted) throw abortErrorFromSignal(signal);
            output += prefix + translated + suffix;
        }
    }
    return output;
}

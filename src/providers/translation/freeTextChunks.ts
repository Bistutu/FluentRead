/**
 * @file src/providers/translation/freeTextChunks.ts
 * 文件职责：免费网页服务按 Unicode 码点或 UTF-16 预算分块，保持术语保护标记完整。
 * 主要内容：一次扫描 FRTERM 标记及码点位置，切点遇到标记时退到标记前；有道保留既有句末/空白优先规则，超长单标记明确拒绝。
 * 模块边界：纯文本分块，不解码槽包、不恢复术语、不自行请求网络；共享循环保持换行、边缘空白与取消，provider 仅注入逐块传输。
 */
import {abortErrorFromSignal} from '@/src/platform/http/runtime';

export function* splitFreeTextChunks(text: string, limit: number, words = false, utf16 = false): Generator<string> {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('分块字符预算必须为正整数');
    const points = Array.from(text);
    const spans: Array<[start: number, end: number]> = [];
    let point = 0, offset = 0;
    // 与术语保护链的 ASCII FRTERM 语法一致；只把完整标记视为不可拆单元。
    for (const match of text.matchAll(/__FRTERM_[a-z0-9_]+?__/giu)) {
        if (match[0].length > limit) throw Object.assign(new Error('术语保护标记超过翻译服务字符预算'), {freeFailure: 'request'});
        while (offset < match.index) offset += points[point++]!.length;
        spans.push([point, point + match[0].length]);
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
        if (words && end < points.length) {
            let sentence = 0, word = 0;
            for (let index = start + Math.ceil((end - start) / 2); index < end; index++) {
                const value = points[index]!;
                if (/\s/u.test(value)) {
                    word = index + 1;
                    if (/[.!?]/u.test(points[index - 1]!)) sentence = word;
                } else if (/[。！？]/u.test(value)) sentence = index + 1;
            }
            end = sentence || word || end;
        }
        while (spans[spanIndex] && spans[spanIndex]![1] <= end) spanIndex++;
        const span = spans[spanIndex];
        if (span && span[0] < end) end = span[0];
        yield points.slice(start, end).join('');
        start = end;
    }
}

/** 默认保留逐行语义；允许服务整段处理换行，每块传输后检查取消，不提交迟到内容。 */
export async function translateFreeTextChunks(text: string, limit: number, translate: (text: string) => Promise<string>, signal?: AbortSignal, words = false, options: {utf16?: boolean; splitLines?: boolean} = {}): Promise<string> {
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

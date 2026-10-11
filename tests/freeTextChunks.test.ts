/**
 * @file tests/freeTextChunks.test.ts
 * 文件职责：验证免费翻译分块不会损坏文档术语标记或 Unicode 正文。
 * 主要内容：回放真实长数学段的 60 个保护标记（52 次变量与 8 次集合运算符），检查精确匹配身份、长度预算、边缘切点、无丢重、严格恢复、普通文本兼容和大输入推进。
 * 模块边界：离线纯文本测试，不把模拟回显当作实际翻译服务证据。
 */
import {describe, expect, it, vi} from 'vitest';
import {splitFreeTextChunks, translateFreeTextChunks} from '@/src/providers/translation/freeTextChunks';
import {documentLongMathParagraph, protectedDocumentLongMathParagraph} from './fixtures/documentLongMathParagraph';

const marker = '__FRTERM_0123456789ab_0__';

describe('bounded free translation chunks', () => {
    it.each([500, 1000, 2000])('keeps all 60 actual mathematical occurrences intact at %i codepoints', limit => {
        const packet = protectedDocumentLongMathParagraph();
        expect(documentLongMathParagraph).toHaveLength(2083);
        // 技术字面值保护补充了原段中 3 次交集、3 次并集和 2 次属于；不是扩大到普通正文或词库。
        expect(packet.matches.filter(match => /^[∩∪∈]$/u.test(match.value)).map(match => match.value))
            .toEqual(['∩', '∪', '∈', '∩', '∪', '∪', '∈', '∩']);
        expect(packet.matches.filter(match => !/^[∩∪∈]$/u.test(match.value))).toHaveLength(52);
        expect(packet.tokens).toEqual(Array.from({length: 60}, (_, index) => `__FRTERM_28c76d055506_${index}__`));
        expect(packet.matches.map(match => match.token)).toEqual(packet.tokens);
        for (const match of packet.matches) expect(packet.text.slice(match.start, match.end)).toBe(match.token);
        expect(packet.text).toHaveLength(3450);
        for (const words of [false, true]) {
            const chunks = [...splitFreeTextChunks(packet.text, limit, words)];
            expect(chunks.join('')).toBe(packet.text);
            expect(chunks.every(chunk => [...chunk].length <= limit)).toBe(true);
            for (const token of packet.tokens) expect(chunks.filter(chunk => chunk.includes(token))).toHaveLength(1);
            expect(packet.restore(chunks.join(''))).toBe(documentLongMathParagraph);
            expect(packet.restore(chunks.join('').replace('(2) Here', '(2) 这里'))).toBe(documentLongMathParagraph.replace('(2) Here', '(2) 这里'));
            expect(() => packet.restore(chunks.join('').replace(packet.tokens[0]!, ''))).toThrow('未完整保留术语');
            expect(() => packet.restore(chunks.join('') + packet.tokens[0])).toThrow('未完整保留术语');
            expect(() => packet.restore(chunks.join('') + '__FRTERM_unknown_0__')).toThrow('未完整保留术语');
        }
    });

    it('retreats before a marker and preserves adjacent tokens, edge tokens and supplementary characters', () => {
        const source = '😀'.repeat(492) + marker + marker.replace('_0__', '_1__') + '尾'.repeat(520);
        const chunks = [...splitFreeTextChunks(source, 500)];
        expect(chunks[0]).toBe('😀'.repeat(492));
        expect(chunks.join('')).toBe(source);
        expect(chunks.every(chunk => [...chunk].length <= 500)).toBe(true);
        expect([...splitFreeTextChunks(marker + 'a'.repeat(500 - marker.length), 500)]).toEqual([marker + 'a'.repeat(500 - marker.length)]);
        expect([...splitFreeTextChunks('a'.repeat(500 - marker.length) + marker, 500)]).toEqual(['a'.repeat(500 - marker.length) + marker]);
        expect([...splitFreeTextChunks(marker, marker.length)]).toEqual([marker]);
    });

    it('rejects an oversized complete marker before yielding any transport block', () => {
        const chunks = splitFreeTextChunks('a'.repeat(600) + '__FRTERM_' + 'x'.repeat(500) + '__', 500);
        expect(() => chunks.next()).toThrow('术语保护标记超过');
        try { [...splitFreeTextChunks(marker, 5)]; } catch (error) { expect(error).toMatchObject({freeFailure: 'request'}); }
    });

    it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid character budget %s', limit => {
        expect(() => [...splitFreeTextChunks('text', limit)]).toThrow(RangeError);
    });

    it('keeps ordinary fixed codepoint chunks and literal incomplete marker text', () => {
        const text = '😀abc\r\n'.repeat(150) + '__FRTERM_not_closed';
        const points = [...text];
        expect([...splitFreeTextChunks(text, 500)]).toEqual([points.slice(0, 500).join(''), points.slice(500).join('')]);
        expect([...splitFreeTextChunks('', 500)]).toEqual([]);
        expect([...splitFreeTextChunks('__frterm_lower_0__', 500)]).toEqual(['__frterm_lower_0__']);
    });

    it('preserves the existing Youdao sentence, word and hard-cut priority', () => {
        const sentence = 'a'.repeat(280) + '. ' + 'b'.repeat(215) + ' ' + 'c'.repeat(20);
        expect([...splitFreeTextChunks(sentence, 500, true)][0]).toBe('a'.repeat(280) + '. ');
        const cjk = 'a'.repeat(280) + '。' + 'b'.repeat(220);
        expect([...splitFreeTextChunks(cjk, 500, true)][0]).toBe('a'.repeat(280) + '。');
        const word = 'a'.repeat(490) + ' ' + 'b'.repeat(30);
        expect([...splitFreeTextChunks(word, 500, true)][0]).toBe('a'.repeat(490) + ' ');
        expect([...splitFreeTextChunks('x'.repeat(501), 500, true)]).toEqual(['x'.repeat(500), 'x']);
        expect([...splitFreeTextChunks('  short ', 500, true)]).toEqual(['  short ']);
    });

    it('advances through a large mixed input with intact markers and no loss or duplication', () => {
        const source = ('😀'.repeat(30) + marker + ' prose ').repeat(4000);
        const chunks = [...splitFreeTextChunks(source, 500, true)];
        expect(chunks.join('')).toBe(source);
        expect(chunks.every(chunk => [...chunk].length <= 500)).toBe(true);
        expect(chunks.flatMap(chunk => [...chunk.matchAll(/__FRTERM_0123456789ab_0__/gu)])).toHaveLength(4000);
    });

    it('shares transport while preserving exact empty lines and edge whitespace', async () => {
        const translate = vi.fn(async (text: string) => `译:${text}`);
        await expect(translateFreeTextChunks(' \r\n  Hello \n\tBye  \r\n', 500, translate)).resolves.toBe(' \r\n  译:Hello \n\t译:Bye  \r\n');
        expect(translate.mock.calls.map(([text]) => text)).toEqual(['Hello', 'Bye']);
        const active = new AbortController();
        await expect(translateFreeTextChunks('short', 500, translate, active.signal, true)).resolves.toBe('译:short');
        await expect(translateFreeTextChunks('', 500, translate)).resolves.toBe('');
    });

    it('refuses cancellation before transport and after a pending response without starting another block', async () => {
        const early = new AbortController(); early.abort();
        const translate = vi.fn(async (text: string) => text);
        await expect(translateFreeTextChunks('text', 500, translate, early.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(translate).not.toHaveBeenCalled();
        const late = new AbortController();
        translate.mockImplementationOnce(async text => {late.abort(); return text;});
        await expect(translateFreeTextChunks('a'.repeat(501), 500, translate, late.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(translate).toHaveBeenCalledTimes(1);
    });

    it('keeps provider failures and invalid whole-marker budgets from issuing later blocks', async () => {
        const failure = new Error('upstream failure');
        const translate = vi.fn(async () => {throw failure;});
        await expect(translateFreeTextChunks('a'.repeat(501), 500, translate)).rejects.toBe(failure);
        expect(translate).toHaveBeenCalledTimes(1);
        translate.mockClear();
        await expect(translateFreeTextChunks('a'.repeat(600) + '__FRTERM_' + 'x'.repeat(500) + '__', 500, translate)).rejects.toMatchObject({freeFailure: 'request'});
        expect(translate).not.toHaveBeenCalled();
    });
});

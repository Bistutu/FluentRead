/**
 * @file tests/freeTextChunks.test.ts
 * 文件职责：验证免费翻译分块不会损坏文档术语标记或 Unicode 正文。
 * 主要内容：回放真实长数学段的 60 个保护标记，检查精确匹配身份、长度预算、严格恢复和大输入推进；对照短语、缩写、引号句末、数字单位、换行与取消的实际请求边界。
 * 模块边界：离线纯文本测试，不把模拟回显当作实际翻译服务证据。
 */
import {describe, expect, it, vi} from 'vitest';
import {splitFreeTextChunks, translateFreeTextChunks} from '@/src/providers/translation/freeTextChunks';
import {documentLongMathParagraph, protectedDocumentLongMathParagraph} from './fixtures/documentLongMathParagraph';

const marker = '__FRTERM_0123456789ab_0__';

describe('bounded free translation chunks', () => {
    it('UTF-16 预算不拆代理对或术语标记，保持完整原文和句末优先', async () => {
        for (const source of ['😀'.repeat(1501), 'a'.repeat(1499) + '😀' + marker, '😀'.repeat(400) + '。' + '😀'.repeat(400), marker]) {
            const chunks = [...splitFreeTextChunks(source, 1500, true, true)];
            expect(chunks.join('')).toBe(source);
            expect(chunks.every(chunk => chunk.length <= 1500 && !/[\uD800-\uDBFF]$/u.test(chunk) && !/^[\uDC00-\uDFFF]/u.test(chunk))).toBe(true);
            expect(chunks.filter(chunk => chunk.includes(marker))).toHaveLength(source.includes(marker) ? 1 : 0);
            await expect(translateFreeTextChunks(source, 1500, async chunk => chunk, undefined, true, {utf16: true, splitLines: false})).resolves.toBe(source);
        }
        expect(() => [...splitFreeTextChunks('😀', 1, false, true)]).toThrow('分块字符预算不足');
    });
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

    it.each([
        ['The control group remained stable. Ask Dr. Smith to check the final measurements.', 60, 'The control group remained stable. '],
        ['The operator said, "Do not restart." Leave the controller disabled until Friday.', 58, 'The operator said, "Do not restart." '],
        ['务必保留对照组的完整记录。「不要重启！」保持控制器关闭，直到工程师确认。', 24, '务必保留对照组的完整记录。「不要重启！」'],
    ])('keeps title and quoted-sentence context in bounded requests: %s', (source, limit, first) => {
        const chunks = [...splitFreeTextChunks(source, limit, true)];
        expect(chunks[0]).toBe(first);
        expect(chunks.join('')).toBe(source);
        expect(chunks.every(chunk => [...chunk].length <= limit)).toBe(true);
    });

    it.each(['3.5 kg', '25 °C', '12 ms', '16 MiB', '9.8 m/s²', '20 %', '3.5\u00a0kg', '3.5\u202fkg'])('keeps the quantity %s with its unit when both fit one request', quantity => {
        const prefix = 'Keep the output steady and do not exceed ';
        const source = `${prefix}${quantity} while the alarm is active.`;
        const chunks = [...splitFreeTextChunks(source, prefix.length + quantity.search(/\s/u) + 2, true)];
        expect(chunks[0]).toBe(prefix);
        expect(chunks.some(chunk => chunk.includes(quantity))).toBe(true);
        expect(chunks.join('')).toBe(source);
    });

    it('uses an earlier safe word boundary instead of splitting a word that fits the budget', () => {
        expect([...splitFreeTextChunks('Use electroencephalography before treatment.', 25, true)])
            .toEqual(['Use ', 'electroencephalography ', 'before treatment.']);
        expect([...splitFreeTextChunks('Ask J. Smith to repeat the measurements.', 8, true)])
            .toEqual(['Ask ', 'J. Smith', ' to ', 'repeat ', 'the ', 'measurem', 'ents.']);
        // 超过上限的单词仍须推进；不能为了词界产生空请求或越过供应商预算。
        expect([...splitFreeTextChunks('x'.repeat(51), 25, true)])
            .toEqual(['x'.repeat(25), 'x'.repeat(25), 'x']);
    });

    it('defaults every shared transport to word boundaries and keeps decimals intact', async () => {
        const translate = vi.fn(async (text: string) => text);
        const source = 'Keep reading 12.375 volts until the system is stopped.';
        await expect(translateFreeTextChunks(source, 18, translate)).resolves.toBe(source);
        expect(translate.mock.calls.map(([text]) => text)).toEqual(['Keep reading', '12.375 volts', 'until the system', 'is stopped.']);
        translate.mockClear();
        await expect(translateFreeTextChunks('electroencephalography', 18, translate, undefined, false)).resolves.toBe('electroencephalography');
        expect(translate.mock.calls.map(([text]) => text)).toEqual(['electroencephalogr', 'aphy']);
    });

    it('preserves mixed-language lines and request context with terms, quotes and full-paragraph opt-in', async () => {
        const source = `  Keep ${marker} at 3.5 kg.\r\n他说：「不要重启！」\n\n`;
        const translate = vi.fn(async (text: string) => text);
        await expect(translateFreeTextChunks(source, 60, translate)).resolves.toBe(source);
        expect(translate.mock.calls.map(([text]) => text)).toEqual([`Keep ${marker} at 3.5 kg.`, '他说：「不要重启！」']);
        translate.mockClear();
        await expect(translateFreeTextChunks(source, 100, translate, undefined, true, {splitLines: false})).resolves.toBe(source);
        expect(translate.mock.calls.map(([text]) => text)).toEqual([source.trim()]);
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

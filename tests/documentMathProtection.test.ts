/**
 * @file tests/documentMathProtection.test.ts
 * 文件职责：验证文档自动数学合并的原始匹配身份、有限边界和严格恢复，回放实际失败的公开论文 Proof 段。
 * 主要内容：核对同一公开输入的 52→14 占位符及精确 wire，覆盖用户词库、正文、格式标签、引号、规范化、槽和长度边界，拒绝缺失、重复、未知与已淘汰的原标记；观察器偏移须来自首次已经接受的匹配。
 * 模块边界：确定性纯算法测试，不调用翻译服务；实际服务保留与语义验收由隔离浏览器证据单独证明。
 */
import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {protectGlossaryText, type GlossaryProtectedMatch, type GlossaryProtectionEntry} from '@/src/core/glossary';
import {documentInlineMarkerRanges, findDocumentLiteralTerms, protectDocumentMathText, serializeTranslationSlots} from '@/src/core/translation/public';

const proof = 'Proof. On the base types ≃𝑆 is an equivalence, by Definition 33 and Lemma 32. For functions, symmetry is symmetry of the base relations applied at input and output, and transitivity reads the middle map at 𝛾′ ≃𝑆 𝛾′: from 𝑓 ≃𝑆 𝑔, 𝑔 ≃𝑆 ℎ, and 𝛾 ≃𝑆 𝛾′ follow 𝑓(𝛾) ≃𝑆 𝑔(𝛾′) and 𝑔(𝛾′) ≃𝑆 ℎ(𝛾′), whence 𝑓(𝛾) ≃𝑆 ℎ(𝛾′); products inherit both componentwise and 𝖬𝖺𝗒𝖻𝖾 by cases. For iterators, the inverse 𝑅−1 and the composite 𝑅 ∘ 𝑅 of the greatest relation 𝑅 satisfy the unfolding again, by the two arguments above read coinductively, so both are contained in 𝑅. Then 𝑓 ≃𝑆 𝑔 gives 𝑓 ≃𝑆 𝑓 by symmetry and transitivity, which is respect.';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const prepare = (source: string, users: GlossaryProtectionEntry[] = []) => {
    const automatic = findDocumentLiteralTerms(source, users), entries = [...users, ...automatic];
    const excluded = documentInlineMarkerRanges(source);
    return {packet: protectDocumentMathText(source, entries, automatic, '0', excluded),
        old: protectGlossaryText(source, entries, '0', excluded)};
};

describe('document automatic math expression protection', () => {
    it('reduces the exact actual page-24 Proof to the experimentally accepted 14/890 wire and restores original bytes', () => {
        const automatic = findDocumentLiteralTerms(proof);
        const old = protectGlossaryText(proof, automatic, '3');
        const packet = protectDocumentMathText(proof, automatic, automatic, '3');
        expect(proof).toHaveLength(667);
        expect(hash(proof)).toBe('431630b33202f4193e4e17f8caf03dee84ae424384c48cf66af696cf34c17c6c');
        expect(old.tokens).toHaveLength(52); expect(old.text).toHaveLength(1912);
        expect(hash(old.text)).toBe('0a2c7be65a1caa04f0ba95388d83a934d14c49e0c2297e8947a4014af27cf958');
        expect(packet.tokens).toHaveLength(14); expect(packet.text).toHaveLength(890);
        expect(hash(packet.text)).toBe('7390774e794afc5aa9d1e02e64d9385373255f0ec390fb424ad0a7d464bd365a');
        expect(packet.restore(packet.text)).toBe(proof);
        expect(packet.restore(packet.text.replace('Proof.', '证明。').replace('which is respect.', '即尊重。')))
            .toBe(proof.replace('Proof.', '证明。').replace('which is respect.', '即尊重。'));
        for (const result of [null, packet.text.replace(packet.tokens[0], ''), packet.text + packet.tokens[0],
            packet.text + '__FRTERM_unknown_0__', packet.text + old.tokens.find(token => !packet.tokens.includes(token)),
            packet.text.replace(packet.tokens[0], packet.tokens[0].toUpperCase())])
            expect(() => packet.restore(result)).toThrow('未完整保留术语');
    });

    it.each([
        ['ordinary prose stops a run', 'Compare 𝑓 with 𝑔 and prove 𝛾 ≃𝑆 𝛾′.', 3],
        ['g syntax remains visible and does not join siblings', '𝑓 <g1>≃𝑆</g1> 𝑔', 3],
        ['HTML syntax stops a run', '𝑓 <b>≃𝑆</b> 𝑔', 5],
        ['newline stops a run', '𝑓\n𝛾', 2],
        ['carriage return stops a run', '𝑓\r𝛾', 2],
        ['long whitespace stops a run', '𝑓' + ' '.repeat(17) + '𝑔', 2],
        ['zero width gap stops a run', '𝑓\u200b𝑔', 2],
        ['finite ASCII math operators join a run', '𝑓(𝛾) = 𝑔(𝛾′)', 1],
        ['ASCII quote stops a gap', "The label 𝑓'𝑔 is a variable.", 2],
        ['both ASCII quotes remain in prose', "The labels '𝑓,𝑔' are variables.", 1],
        ['plain NFC prose remains outside math', 'é 𝑓 ≃𝑆 𝑔', 1],
        ['unmatched closer leaves the original packet intact', '𝑓([𝛾)]).', 2],
        ['closer without a group opener remains visible', '𝑓,𝑔)', 1],
        ['mismatched closer inside a gap stops a group', '𝑓) + 𝑔', 2],
        ['a prose opener before the first token keeps its matching closer visible', 'Let (𝑓) + 𝑔 be the sum.', 2],
        ['a protected half-open interval does not acquire an outside closer', '𝑓 + [0,1)]', 1],
        ['a matched closer inside the next gap completes local ownership', '𝑓(𝛾) + 𝑔', 1],
        ['four-prime suffix limit leaves the fifth outside', '𝑓 + 𝑔′′′′′', 1],
        ['radical and interval automatic literals may join', '√x + (a,b)', 1],
        ['ASCII bearing code-like math names remain separate', '𝑓x 𝑔', 2],
        ['URL and ordinary code identifiers remain separate', '𝑓 https://example.org PageInfo Δx 𝑔', 5],
        ['single automatic math literal needs no wrapper', '𝑓′ next', 1],
        ['no literal leaves ordinary prose unchanged', 'Translate this ordinary sentence.', 0],
        ['non math literals need no wrapper', 'https://example.org PageInfo', 2],
    ])('%s', (_name, source, count) => {
        const {packet, old} = prepare(String(source));
        expect(packet.tokens).toHaveLength(Number(count));
        expect(packet.restore(packet.text)).toBe(old.restore(old.text));
        expect(packet.text.split("'")).toHaveLength(String(source).split("'").length);
    });

    it('respects user target and empty target identities, even when their values look mathematical', () => {
        for (const target of ['𝑆', '', '用户指定符号']) {
            const users = [{source: 'S', target, caseSensitive: true}];
            const {packet, old} = prepare('𝑓 S 𝛾', users);
            expect(packet.tokens).toHaveLength(3);
            expect(packet.text).toBe(old.text);
            expect(packet.restore(packet.text)).toBe(`𝑓 ${target || 'S'} 𝛾`);
        }
        for (const target of ['', '用户指定符号']) {
            const {packet, old} = prepare('𝑓 ≃𝑆 𝑔', [{source: '𝑆', target, caseSensitive: true}]);
            expect(packet.tokens).toHaveLength(3);
            expect(packet.restore(packet.text)).toBe(old.restore(old.text));
        }
        const {packet, old} = prepare('𝑓 ≃𝑆 𝑔', [{source: '𝑓 ≃𝑆 𝑔', target: '固定整个表达式', caseSensitive: true}]);
        expect(packet.text).toBe(old.text); expect(packet.restore(packet.text)).toBe('固定整个表达式');
    });

    it('keeps NFC composition, serialized ownership syntax and preexisting marker packets unchanged', () => {
        for (const source of ['e\u0301 𝑓 ≃𝑆 𝑔', 'Literal __FRTERM_user_0__ and 𝑓 ≃𝑆 𝑔',
            serializeTranslationSlots(['𝑓 ≃𝑆', '𝑔'], 'math_test').payload]) {
            const {packet, old} = prepare(source);
            expect(packet.text).toBe(old.text); expect(packet.tokens).toEqual(old.tokens);
            expect(packet.restore(packet.text)).toBe(source);
        }
    });

    it('bounds token count, original expression length and Unicode suffix size without dropping characters', () => {
        const bounded = prepare(Array.from({length: 17}, () => '𝑓').join(' '));
        expect(bounded.packet.tokens).toHaveLength(2);
        expect(bounded.packet.restore(bounded.packet.text)).toBe(bounded.old.restore(bounded.old.text));
        const tooLong = prepare('𝑓'.repeat(95) + ' 𝑔');
        expect(tooLong.packet.tokens).toHaveLength(2); expect(tooLong.packet.text).toBe(tooLong.old.text);
        const suffix = prepare('𝑓'.repeat(94) + ' 𝑔′″');
        expect(suffix.packet.tokens).toHaveLength(1); expect(suffix.packet.text.endsWith('′″')).toBe(true);
        expect(suffix.packet.restore(suffix.packet.text)).toBe(suffix.old.restore(suffix.old.text));
    });

    it('leaves outside closers visible without interpreting a protected half-open interval as an open gap bracket', () => {
        const prose = prepare('Let (𝑓) + 𝑔 be the sum.');
        expect(prose.packet.text).toMatch(/^Let \(__FRTERM_[a-z0-9_]+__\) \+ __FRTERM_[a-z0-9_]+__ be the sum\.$/u);
        const interval = prepare('𝑓 + [0,1)]');
        expect(interval.packet.text).toMatch(/^__FRTERM_[a-z0-9_]+__\]$/u);
        expect(interval.packet.restore(interval.packet.text)).toBe('𝑓 + [0,1)]');
    });

    it('keeps the original packet when a length, token or prose boundary would leave a locally opened bracket unclosed', () => {
        for (const source of ['Let 𝑓(𝛾 + ' + '𝑔'.repeat(95) + ') be the sum.',
            '𝑓(' + Array.from({length: 16}, () => '𝛾').join(' + ') + ')',
            '𝑓(𝛾 plus 𝑔)', '𝑓'.repeat(94) + '(𝑔)′']) {
            const {packet, old} = prepare(source);
            expect(packet.text).toBe(old.text); expect(packet.tokens).toEqual(old.tokens);
            expect(packet.restore(packet.text)).toBe(source);
        }
        const maximum = prepare('𝑓'.repeat(94) + '(𝑔)');
        expect(maximum.packet.tokens).toHaveLength(1);
        expect(maximum.packet.restore(maximum.packet.text)).toBe(maximum.old.restore(maximum.old.text));
    });

    it('reports only accepted matches with exact entry identity and protected offsets across excluded ranges and slots', () => {
        const entry = {source: 'API', target: '接口', caseSensitive: true};
        const source = 'API <g1>API</g1> ' + serializeTranslationSlots(['API', 'API'], 'observer').payload;
        const matches: GlossaryProtectedMatch[] = [];
        const excluded = [{start: 0, end: 3}, ...documentInlineMarkerRanges(source)];
        const packet = protectGlossaryText(source, [entry], 'observe', excluded, match => {matches.push(match);});
        expect(matches).toHaveLength(3);
        expect(matches.map(match => match.token)).toEqual(packet.tokens);
        for (const match of matches) {
            expect(match.entry).toBe(entry); expect(match.value).toBe('接口');
            expect(packet.text.slice(match.start, match.end)).toBe(match.token);
        }
        expect(packet.restore(packet.text)).toBe(source.replaceAll('API', '接口').replace(/^接口/u, 'API'));
        // Defaults and an explicit empty automatic plan retain the shared protection behavior.
        expect(protectDocumentMathText('API', [entry], []).restore(protectGlossaryText('API', [entry]).text)).toBe('接口');
    });
});

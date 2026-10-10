/**
 * @file tests/documentMathLiterals.test.ts
 * 文件职责：验证文档 Unicode 数学标识原码点保护，防止真实翻译服务吞掉变量或改成空引号。
 * 主要内容：实际92页论文的段600/604完整源文经过现有术语保护链，检验缺失/重复/跨槽拒绝与完整回填；覆盖数学单字、复合、Greek前缀、Letterlike、整词边界、用户/NFC优先及文档与网页隔离。
 * 模块边界：纯算法和供应商协议恢复测试，不读取用户凭据、运行在线服务或推断论文领域词汇译法。
 */
import {describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {GlossaryPlaceholderError, validateGlossaryProtectedTokens} from '@/src/core/glossary';
import {findDocumentLiteralTerms, serializeTranslationSlots} from '@/src/core/translation/public';
import {getGlossaryProtectionEntries, prepareGlossaryRequest} from '@/src/services/translation/glossaryProtection';
import {createTranslationProviderConfigSnapshot, getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

vi.mock('@/src/services/config/store', () => ({config: {to: 'zh-Hans'}}));

const documentConfig = () => ({...createTranslationProviderConfigSnapshot(new Config()),
    glossaryMatchContext: {context: 'document' as const, sourceLanguage: 'en', targetLanguage: 'zh-hans'}});
const sources = [
    'That is, applying 𝑛’s accumulator at 𝛾𝑢 leaves every fiber’s table where those same steps would have left it from 𝛾𝑏, the control fields lying outside the comparison. Reading the right side as the state reached had 𝑛 never begun assumes that no fiber 𝑛 instantiates take a step in [𝑏, 𝑢), since a fiber 𝑛 instantiates is one that would not be there to take it.',
    'Where the rule is L-Leave, an aborting L-Divert, or an O-Retire of 𝑛, Table 1 gives Ψ𝑢 = idΓ and 𝑔𝑛𝑢+1 = 𝑔𝑛𝑢, so the same equation holds with ℎ = idΓ. Either way the induction hypothesis carries over with the index set unchanged, which is the computation of Theorem 7 one step at a time.',
];
const oldTargets = [
    "也就是说，在处应用's累加器会离开每个光纤的表，而这些相同的步骤会将其从，位于比较之外的控制字段。读取右侧，因为状态达到了。从未开始假设没有光纤实例化在 [𝑏, 𝑢), 中迈出一步，因为光纤实例化是一个不会在那里接受它的。",
    '当规则是L-Leave、中止的L-Divert或O-Retire为“”时，表1给出“” = idΓ和“” +1 = “” ，因此相同的方程式适用于“” = idΓ。 无论哪种方式，归纳假设都会以不变的指数集继续进行，这是定理7的计算，一次一步。',
];

describe('document Unicode math literal protection', () => {
    it.each(['𝑛', '𝛾𝑢', '𝛾𝑏', 'Ψ𝑢', '𝑔𝑛𝑢', 'ℎ', 'ℂ', 'ℝ', '𝟏', '𝑛_12', 'α𝑛', '𝑛x', 'x𝑛suffix', 'ℎα\u0301', '𝑛\u20d7'])
    ('keeps the full mathematical identifier %s in its original Unicode form', source => {
        expect(findDocumentLiteralTerms(`Use (${source}) now.`)).toEqual([{source: source.normalize('NFC'), target: '', caseSensitive: true}]);
        const request = prepareGlossaryRequest({origin: `Use (${source}) now.`}, documentConfig());
        expect(request.message.origin).not.toContain(source);
        expect(request.restore(String(request.message.origin).replace('Use', '使用').replace('now.', '。'))).toBe(`使用 (${source}) 。`);
    });

    it.each(['normal_ascii_123', 'αλφα', 'αβ', 'Ψ', 'idΓ', 'n', 'K', '℃', '℡', '№', '中文𝑛正文', '日本語𝑛本文', 'é𝑛', '𝑛é'])
    ('does not protect ordinary prose or a partial word in %s', source => {
        expect(findDocumentLiteralTerms(source)).toEqual([]);
    });

    it.each(['𝛁', '𝛛', '℘'])('keeps operator %s outside mathematical letter identifiers while protecting adjacent variables', operator => {
        expect(findDocumentLiteralTerms(operator)).toEqual([]);
        const origin = `Use 𝑛${operator}ℎ now.`;
        expect(findDocumentLiteralTerms(origin)).toEqual(['𝑛', 'ℎ'].map(source => ({source, target: '', caseSensitive: true})));
        const request = prepareGlossaryRequest({origin}, documentConfig());
        expect(request.message.origin).toContain(operator);
        expect(request.message.origin).not.toContain('𝑛');
        expect(request.message.origin).not.toContain('ℎ');
        expect(request.restore(String(request.message.origin).replace('Use', '使用').replace('now.', '。'))).toBe(`使用 𝑛${operator}ℎ 。`);
    });

    it('retains the established URL, HTML, root, Greek-ASCII, CamelCase and model boundaries', () => {
        const tag = '<span title="𝑛 > ℎ">';
        const words = [tag, 'https://example.test/𝑛', 'author@example.test', '√dmodel', 'ϵls', 'DeepSeek', 'GNMT + RL'];
        expect(findDocumentLiteralTerms(`${words.join(' ')} </span> <g1>bold</g1> αλφα`)
            .map(term => term.source)).toEqual([...words, '</span>']);
        expect(findDocumentLiteralTerms('𝑔𝑛𝑢+1 = ℎ')).toEqual(['𝑔𝑛𝑢', 'ℎ'].map(source => ({source, target: '', caseSensitive: true})));
        expect(findDocumentLiteralTerms('ordinaryword'.repeat(10_000))).toEqual([]);
    });

    it('accepts Greek and Letterlike mixtures but linearly rejects a very long invalid mathematical word', () => {
        expect(findDocumentLiteralTerms('ℎΩ𝑛').map(term => term.source)).toEqual(['ℎΩ𝑛'.normalize('NFC')]);
        expect(findDocumentLiteralTerms(`ℎ${'Ω'.repeat(10_000)}é`)).toEqual([]);
    });

    it('retains adjacent URL scanning without protecting a truncated mathematical prefix or changing glossary word boundaries', () => {
        const url = 'https://example.test/𝑛';
        for (const prefix of ['链接', 'see', '中文see', 'x𝑛', '中文𝑛']) {
            expect(findDocumentLiteralTerms(`${prefix}${url}`)).toEqual([{source: url, target: url, caseSensitive: true}]);
        }
        for (const source of ['𝑛httpvalue', '𝑛https']) {
            expect(findDocumentLiteralTerms(source)).toEqual([{source, target: '', caseSensitive: true}]);
        }
        expect(findDocumentLiteralTerms('链接http://example.test/ℎ').map(term => term.source)).toEqual(['http://example.test/ℎ']);
        const request = prepareGlossaryRequest({origin: `链接${url}。`}, documentConfig());
        expect(request.message.origin).not.toContain(url);
        expect(request.restore(String(request.message.origin).replace('链接', '网址'))).toBe(`网址${url}。`);
        // 旧 scanner 可识别紧邻 ASCII 的 URL，但既有术语词边界不替换它；本规则不扩大该契约。
        const adjacentAscii = prepareGlossaryRequest({origin: `see${url}`}, documentConfig());
        expect(adjacentAscii.message.origin).toBe(`see${url}`);
        expect(adjacentAscii.restore(adjacentAscii.message.origin)).toBe(`see${url}`);
    });

    it.each([0, 1])('rejects the actual old glyph-dropping response for source fixture %s and restores every Unicode occurrence', index => {
        const origin = sources[index]!, request = prepareGlossaryRequest({origin}, documentConfig());
        const protectedOrigin = String(request.message.origin);
        const tokens = getTranslationProviderConfig(request.message, documentConfig()).glossaryProtectedTokens!;
        expect(tokens.length).toBeGreaterThan(1);
        for (const literal of findDocumentLiteralTerms(origin)) expect(protectedOrigin).not.toContain(literal.source);
        expect(() => validateGlossaryProtectedTokens(protectedOrigin, oldTargets[index], tokens)).toThrow(GlossaryPlaceholderError);
        expect(() => request.restore(oldTargets[index])).toThrow(GlossaryPlaceholderError);
        const translated = protectedOrigin.replace(index ? 'Where the rule is' : 'That is, applying', index ? '规则为' : '也就是说，应用');
        expect(() => validateGlossaryProtectedTokens(protectedOrigin, translated, tokens)).not.toThrow();
        expect(request.restore(translated)).toBe(origin.replace(index ? 'Where the rule is' : 'That is, applying', index ? '规则为' : '也就是说，应用'));
        expect(request.restore(protectedOrigin)).toBe(origin);
        expect(() => request.restore(translated.replace(tokens[0]!, ''))).toThrow(GlossaryPlaceholderError);
        expect(() => request.restore(`${translated} ${tokens[0]}`)).toThrow(GlossaryPlaceholderError);
    });

    it('deduplicates literals but independently protects repeated occurrences and array slots', () => {
        expect(findDocumentLiteralTerms(['𝑛 + 𝑛', 'Ψ𝑢 ℎ', 'ℎ'])).toEqual(['𝑛', 'Ψ𝑢', 'ℎ'].map(source => ({source, target: '', caseSensitive: true})));
        const origin = ['Use 𝑛 + 𝑛.', 'Then Ψ𝑢 = ℎ.'];
        const request = prepareGlossaryRequest({origin}, documentConfig());
        const encoded = request.message.origin as string[];
        const tokens = getTranslationProviderConfig(request.message, documentConfig()).glossaryProtectedTokens!;
        expect(tokens).toHaveLength(4);
        expect(request.restore(encoded.map(text => text.replace('Use', '使用').replace('Then', '然后')))).toEqual(['使用 𝑛 + 𝑛.', '然后 Ψ𝑢 = ℎ.']);
        expect(() => request.restore([encoded[1], encoded[0]])).toThrow(GlossaryPlaceholderError);
        expect(() => request.restore([encoded[0]!.replace(tokens[0]!, tokens[1]!), encoded[1]])).toThrow(GlossaryPlaceholderError);
    });

    it('protects serialized batch slots and rejects movement of mathematical tokens between their slots', () => {
        const source = serializeTranslationSlots(['Use 𝑛.', 'Then ℎ.'], 'unicode_math');
        const request = prepareGlossaryRequest({origin: source.payload}, documentConfig());
        const encoded = String(request.message.origin), tokens = getTranslationProviderConfig(request.message, documentConfig()).glossaryProtectedTokens!;
        const translated = encoded.replace('Use', '使用').replace('Then', '然后');
        expect(request.restore(translated)).toBe(source.payload.replace('Use', '使用').replace('Then', '然后'));
        const swap = translated.replace(tokens[0]!, 'TEMP_TOKEN').replace(tokens[1]!, tokens[0]!).replace('TEMP_TOKEN', tokens[1]!);
        expect(() => request.restore(swap)).toThrow(GlossaryPlaceholderError);
    });

    it('respects explicit single-glyph translations, word boundaries, case choices and NFC without NFKC conversion', () => {
        const origin = '𝑔𝑛𝑢 + ℎ + ℎα\u0301 + x𝑛suffix + GNMT + RL';
        const entries = [
            {source: 'ℎ', target: '用户逆映射', caseSensitive: true},
            {source: 'ℎά', target: '用户复合变量', caseSensitive: true},
            {source: 'X𝑛suffix', target: '用户标识', caseSensitive: false},
            {source: 'RL', target: '用户组合后半', caseSensitive: true},
        ];
        expect(findDocumentLiteralTerms(origin, entries)).toEqual([{source: '𝑔𝑛𝑢', target: '', caseSensitive: true}]);
        expect(findDocumentLiteralTerms('x𝑛suffix', [{...entries[2]!, caseSensitive: true}]).map(term => term.source)).toEqual(['x𝑛suffix']);
        expect(findDocumentLiteralTerms('𝑔𝑛𝑢', [{source: '𝑛', target: '用户n', caseSensitive: true}]).map(term => term.source)).toEqual(['𝑔𝑛𝑢']);
        const current = {...documentConfig(), glossaryEnabled: true, glossaryTerms: entries,
            glossaryLibraries: [{id: 'user', name: 'User', enabled: true, sourceLanguage: '', targetLanguage: 'zh-hans', domains: [],
                entries: entries.map((entry, id) => ({...entry, id: String(id)}))}]};
        const request = prepareGlossaryRequest({origin}, current);
        expect(request.restore(request.message.origin)).toBe('𝑔𝑛𝑢 + 用户逆映射 + 用户复合变量 + 用户标识 + GNMT + 用户组合后半');
        expect(findDocumentLiteralTerms('𝑛')[0]!.source).not.toBe('𝑛'.normalize('NFKC'));
        expect(findDocumentLiteralTerms('ℎ + ℎ', entries)).toEqual([]);
    });

    it('matches NFC while restoring each actual NFD/NFC spelling independently in both single and array requests', () => {
        const nfd = 'ℎα\u0301', nfc = nfd.normalize('NFC');
        expect(findDocumentLiteralTerms([nfd, nfc])).toEqual([{source: nfc, target: '', caseSensitive: true}]);
        for (const origin of [`Use ${nfd}, then ${nfc}.`, [`Use ${nfd}.`, `Then ${nfc}.`],
            serializeTranslationSlots([`Use ${nfd}.`, `Then ${nfc}.`], 'unicode_nfc').payload]) {
            const request = typeof origin === 'string'
                ? prepareGlossaryRequest({origin}, documentConfig())
                : prepareGlossaryRequest({origin}, documentConfig());
            expect(request.restore(request.message.origin)).toEqual(origin);
        }
    });

    it('does not change page or summary requests, and leaves surrounding ordinary words translatable', () => {
        const document = documentConfig(), origin = 'Use 𝑛 and ℎ to compute the result.';
        const page = {...document, glossaryMatchContext: {...document.glossaryMatchContext, context: 'page' as const}};
        expect(getGlossaryProtectionEntries(page, origin)).toEqual([]);
        expect(prepareGlossaryRequest({origin}, page).message.origin).toBe(origin);
        const summaryRequest = {origin, summaryPrompt: 'Summarize the passage.'};
        expect(prepareGlossaryRequest(summaryRequest, document).message.origin).toBe(origin);
        const request = prepareGlossaryRequest({origin}, document);
        expect(request.restore(String(request.message.origin).replace('Use', '使用').replace('and', '和').replace('to compute the result.', '计算结果。')))
            .toBe('使用 𝑛 和 ℎ 计算结果。');
    });
});

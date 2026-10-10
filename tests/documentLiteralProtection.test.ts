/**
 * @file tests/documentLiteralProtection.test.ts
 * 文件职责：验证真实文档中行内语法、根号标识、URL、邮箱、代码式专名及 GNMT+RL 的自动原样保护边界。
 * 主要内容：检验带引号的 HTML、根号和专名保护；内部 g 原样送翻并逐槽验证编号、配对、嵌套、实体/全角与自闭合，强调文字可译、用户短词不改语法；覆盖缓存身份及文档/网页边界。
 * 模块边界：纯规则及保护链测试，实际免费服务结果由隔离浏览器测试另行验证。
 */
import {describe, expect, it, vi} from 'vitest';
import {documentInlineMarkerRanges, findDocumentLiteralTerms, normalizeDocumentInlineMarkers, serializeTranslationSlots, validateDocumentInlineMarkers} from '@/src/core/translation/public';
import {validateGlossaryProtectedTokens} from '@/src/core/glossary';
import {Config} from '@/src/core/config/model';
import {resolveConfiguredModel, servicesType} from '@/src/core/config/catalog';
import {createTranslationBroker} from '@/src/services/translation/broker';
import {prepareGlossaryRequest, getGlossaryProtectionEntries, isGlossaryOnlyResult, validateDocumentTranslationResult} from '@/src/services/translation/glossaryProtection';
import {createTranslationProviderConfigSnapshot, getTranslationGlossaryTerms, getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';
import {parseDocument, renderDocument} from '@/src/features/document-translation/core/document';

vi.mock('@/src/services/config/store', () => ({config: {to: 'zh-Hans'}}));

const documentConfig = () => ({...createTranslationProviderConfigSnapshot(new Config()),
    glossaryMatchContext: {context: 'document' as const, sourceLanguage: 'en', targetLanguage: 'zh-hans'}});

describe('document literal protection', () => {
    it('keeps paired, nested and self-closing syntax exactly while leaving the words between tags translatable', () => {
        const tag = `<details title="1 > 0" data-kind='a > b'>`;
        const source = `${tag}Expand <g1>nested <g2>bold</g2></g1><g3/> now.</details>`;
        const syntax = [tag, '</details>'];
        expect(findDocumentLiteralTerms(source).map(term => term.source)).toEqual(syntax);
        expect(findDocumentLiteralTerms('a < b > c; unclosed <summary title="not closed; <!-- comment -->')).toEqual([]);
        const current = documentConfig();
        const packet = prepareGlossaryRequest({origin: source}, current);
        expect(packet.message.origin).not.toMatch(/<\/?details/u);
        expect(packet.message.origin).toContain('<g1>nested <g2>bold</g2></g1><g3/>');
        expect(packet.message.origin).toContain('nested');
        expect(packet.restore(String(packet.message.origin).replace('Expand', '展开').replace('nested', '嵌套').replace('bold', '粗体')))
            .toBe(`${tag}展开 <g1>嵌套 <g2>粗体</g2></g1><g3/> now.</details>`);
        expect(getTranslationGlossaryTerms(current, source)).toEqual(syntax.map(source => ({source, target: source})));
        const page = {...current, glossaryMatchContext: {...current.glossaryMatchContext, context: 'page' as const}};
        expect(getGlossaryProtectionEntries(page, source)).toEqual([]);
        expect(prepareGlossaryRequest({origin: source}, page).message.origin).toBe(source);
    });

    it('does not let short glossary words change tag syntax, but still applies those words in prose', () => {
        const current = {...documentConfig(), glossaryEnabled: true, glossaryTerms: [{source: 'g1', target: '用户编号'}, {source: 'summary', target: '摘要'}],
            glossaryLibraries: [{id: 'user', name: 'User', enabled: true, sourceLanguage: '', targetLanguage: 'zh-hans', domains: [],
                entries: [{id: 'g', source: 'g1', target: '用户编号', caseSensitive: false}, {id: 'summary', source: 'summary', target: '摘要', caseSensitive: false}]}]};
        const source = '<summary><g1>g1 summary</g1></summary>';
        const entries = getGlossaryProtectionEntries(current, source);
        expect(entries.filter(entry => entry.source.startsWith('<')).map(entry => entry.source))
            .toEqual(['<summary>', '</summary>']);
        const packet = prepareGlossaryRequest({origin: source}, current);
        expect(packet.restore(packet.message.origin)).toBe('<summary><g1>用户编号 摘要</g1></summary>');
        expect(getTranslationGlossaryTerms(current, source)).toEqual(entries.map(({source, target}) => ({source, target})));
    });

    it('preserves only the confirmed radical identifier and lets explicit user spelling take priority', () => {
        expect(findDocumentLiteralTerms('Multiply by √dmodel, √dk and √hidden_2; √2 + 3 stays mathematical prose.').map(term => term.source))
            .toEqual(['√dmodel', '√dk', '√hidden_2']);
        const source = 'Multiply by √dmodel.';
        const packet = prepareGlossaryRequest({origin: source}, documentConfig());
        expect(packet.message.origin).not.toContain('dmodel');
        expect(packet.restore(String(packet.message.origin).replace('Multiply by', '乘以'))).toBe('乘以 √dmodel.');
        expect(findDocumentLiteralTerms(source, [{source: 'dmodel', target: '用户符号', caseSensitive: true}])).toEqual([]);
    });

    it('restores Markdown emphasis/code/links and nested HTML after the same protected translation chain', () => {
        const markdown = parseDocument('sample.md', 'Read **bold**, use `npm install`, and [link](https://example.com).', {markdownSentences: true});
        const html = parseDocument('sample.html', '<p>Read <strong><em>bold</em></strong> now.</p>');
        for (const [document, replacements, expected] of [
            [markdown, [['Read', '阅读'], ['bold', '粗体'], ['use', '运行'], ['and', '并看'], ['link', '链接']], '阅读 **粗体**, 运行 `npm install`, 并看 [链接](https://example.com).'],
            [html, [['Read', '阅读'], ['bold', '粗体'], ['now.', '。']], '<p>阅读 <strong><em>粗体</em></strong> 。</p>'],
        ] as const) {
            const packet = prepareGlossaryRequest({origin: document.segments[0].source}, documentConfig());
            expect(String(packet.message.origin)).toMatch(/<g1>/u);
            let translated = String(packet.message.origin);
            for (const [source, target] of replacements) translated = translated.replace(source, target);
            expect(renderDocument(document, [packet.restore(translated) as string], 'translated')).toBe(expected);
        }
    });

    it('gives every HTML occurrence its own token and rejects lost, repeated and foreign paragraph syntax', () => {
        const origins = ['<summary>More</summary> then <summary>Again</summary>', '<details>Expand</details><g2/>'];
        const packet = prepareGlossaryRequest({origin: origins}, documentConfig());
        const protectedOrigins = packet.message.origin as string[];
        const tokens = getTranslationProviderConfig(packet.message, documentConfig()).glossaryProtectedTokens!;
        expect(tokens).toHaveLength(6);
        expect(packet.restore(protectedOrigins)).toEqual(origins);
        for (const first of [protectedOrigins[0].replace(tokens[0], ''), protectedOrigins[0] + tokens[0], protectedOrigins[0] + tokens[4]]) {
            expect(() => validateGlossaryProtectedTokens(protectedOrigins[0], first, tokens)).toThrow('未完整保留术语');
            expect(() => packet.restore([first, protectedOrigins[1]])).toThrow('未完整保留术语');
        }
    });

    it('normalizes only document marker spellings and preserves pairing, parent relationships and sibling reordering', () => {
        const source = 'Read <g1>outer <g2>bold</g2></g1>, then <g3/> and <g4>link</g4>.';
        const translated = '先 <g3></g3>，再（Ｇ４）链接（／g４）与 &lt; G1 &gt;外层&#60;g2&#62;粗体&#x3c;/g2&#x3e;&lt;/g1&gt;。';
        expect(validateDocumentInlineMarkers(source, translated)).toBe('先 <g3/>，再<g4>链接</g4>与 <g1>外层<g2>粗体</g2></g1>。');
        expect(normalizeDocumentInlineMarkers('正文 &amp; &lt;summary&gt; ＜g１／＞'))
            .toBe('正文 &amp; &lt;summary&gt; <g1/>');
        expect(documentInlineMarkerRanges('x<g1>bold</g1><g2/>')).toEqual([{start: 1, end: 5}, {start: 9, end: 14}, {start: 14, end: 19}]);
        expect(documentInlineMarkerRanges('plain <summary>')).toEqual([]);
        expect(validateDocumentInlineMarkers('<g1>literal unclosed', null)).toBeNull();
        expect(validateDocumentInlineMarkers('Plain words.', 3)).toBe(3);
        expect(validateDocumentInlineMarkers('<g1>one</g1><g1>two</g1>', '<g1>一</g1><g1>二</g1>'))
            .toBe('<g1>一</g1><g1>二</g1>');
        expect(validateDocumentInlineMarkers('<g1>bold</g1>', '<g1></g1>')).toBe('<g1></g1>');
    });

    it('rejects missing, repeated, foreign, wrongly paired and reparented markers before accepting a candidate', () => {
        const source = '<g1>outer <g2>bold</g2></g1> and <g3/>.';
        for (const result of [null, '无标签', '<g1>外层<g2>粗体</g1></g2><g3/>',
            '<g1>外层</g1><g2>粗体</g2><g3/>', '<g2>粗体<g1>外层</g1></g2><g3/>',
            '<g1>外层<g2>粗体</g2></g1><g3/><g3/>', '<g1>外层<g2>粗体</g2></g1><g4/>',
            '<g1>外层<g2>粗体</g2></g1><g3>被修改的代码</g3>', '<g1>外层<g2>粗体</g2></g1></g3/>',
            '<g1>外层<g2>粗体</g2></g1><g3/><g0/>', '<g1>外层<g2>粗体</g2></g1><g3/></g9>',
            '<g1>外层<g2>粗体</g2></g1><g3/><g99>未闭合'])
            expect(() => validateDocumentInlineMarkers(source, result), String(result)).toThrow('未完整保留文档行内格式');
        expect(() => validateDocumentInlineMarkers('<g1>first</g1>', '<g2>串槽</g2>')).toThrow();
        // 两槽恰好使用相同编号和结构时，标签本身无法验证正文所属位置；数组/slot 协议负责位置。
        expect(validateDocumentInlineMarkers('<g1>first</g1>', '<g1>另一槽文字</g1>')).toBe('<g1>另一槽文字</g1>');
        expect(validateDocumentInlineMarkers('</g1/> literal', '普通译文')).toBe('普通译文');
        expect(validateDocumentInlineMarkers('<g0>literal</g0>', '普通译文')).toBe('普通译文');
    });

    it('validates document-only arrays and serialized slots during every provider restore, including g-only requests', () => {
        const current = documentConfig();
        const originals = ['Keep <g1>bold</g1>.', 'Run <g2/>.'];
        const packet = prepareGlossaryRequest({origin: originals}, current);
        expect(getTranslationProviderConfig(packet.message, current).glossaryMatchContext?.context).toBe('document');
        expect(packet.restore(['保留&lt;g1&gt;粗体&lt;/g1&gt;。', '运行＜g2／＞。']))
            .toEqual(['保留<g1>粗体</g1>。', '运行<g2/>。']);
        for (const result of [null, ['少一槽'], ['丢失粗体', '运行<g2/>。']]) expect(() => packet.restore(result)).toThrow('未完整保留文档行内格式');
        expect(() => prepareGlossaryRequest({origin: originals[0]}, current).restore('丢掉标签')).toThrow();
        const sources = ['Keep <g1>bold</g1>.', 'Keep <g2>link</g2>.'];
        const sourcePacket = serializeTranslationSlots(sources, 'custom_nested_BEGIN_nonce');
        const request = prepareGlossaryRequest({origin: sourcePacket.payload}, current);
        const target = serializeTranslationSlots(['保留&lt;g1&gt;粗体&lt;/g1&gt;。', '保留（g2）链接（/g2）。'], 'custom_nested_BEGIN_nonce');
        expect(request.restore(target.payload)).toBe(serializeTranslationSlots(['保留<g1>粗体</g1>。', '保留<g2>链接</g2>。'], 'custom_nested_BEGIN_nonce').payload);
        expect(() => request.restore(serializeTranslationSlots(['保留<g2>链接</g2>。', '保留<g1>粗体</g1>。'], 'custom_nested_BEGIN_nonce').payload)).toThrow();
        for (const result of [null, '<g1>粗体</g1><g2>链接</g2>']) expect(() => request.restore(result)).toThrow();
        const plain = serializeTranslationSlots(['First.', 'Second.']);
        expect(validateDocumentTranslationResult(current, plain.payload, '普通译文')).toBe('普通译文');
        const page = {...current, glossaryMatchContext: {...current.glossaryMatchContext, context: 'page' as const}};
        expect(validateDocumentTranslationResult(page, sourcePacket.payload, '网页结果不改变')).toBe('网页结果不改变');
    });

    it('retains explicit glossary selection and empty summary handling without weakening non-document array validation', () => {
        const current = {...documentConfig(), glossaryTerms: [{source: 'API', target: '接口'}],
            glossaryMatchContext: {context: 'page' as const, sourceLanguage: 'en', targetLanguage: 'zh-hans', glossaryIds: ['user']},
            glossaryLibraries: [{id: 'user', name: 'User', enabled: true, sourceLanguage: '', targetLanguage: 'zh-hans', domains: [],
                entries: [{id: 'api', source: 'API', target: '接口', caseSensitive: true}]}]};
        expect(getGlossaryProtectionEntries({...current, glossaryMatchContext: undefined}, 'API')).toEqual([]);
        expect(getGlossaryProtectionEntries({...current, glossaryLibraries: undefined}, 'API')).toEqual([]);
        const packet = prepareGlossaryRequest({origin: ['API'], summaryPrompt: ''}, current);
        expect(packet.restore(packet.message.origin)).toEqual(['接口']);
        for (const result of [null, []]) expect(() => packet.restore(result)).toThrow('未完整保留术语');
        const summary = prepareGlossaryRequest({origin: 'API', summaryPrompt: 'Summarize'}, current);
        expect(summary.message.origin).toBe('API');
        expect(summary.restore('摘要')).toBe('摘要');
    });

    it('caches translated inline words with raw g identity, without reusing earlier FRTERM identity results', async () => {
        const config = Object.assign(new Config(), {service: 'microsoft', from: 'en', to: 'zh-Hans', useCache: true});
        const cache = new Map<string, string>(), identities: Record<string, unknown>[] = [];
        const origin = 'Translate this paragraph and keep <g1>bold</g1> text.';
        const provider = vi.fn(async (message: Record<string, unknown>) => {
            expect(message.origin).toBe(origin);
            expect(getTranslationProviderConfig(message, createTranslationProviderConfigSnapshot(config)).glossaryProtectedTokens).toBeUndefined();
            return '翻译这一段，并保留&lt;g1&gt;粗体&lt;/g1&gt;文本。';
        });
        const broker = createTranslationBroker({ready: Promise.resolve(), getConfig: () => config, providers: {microsoft: provider},
            cache: {get: async key => cache.get(key) ?? null, set: async (key, value) => {cache.set(key, value); return true;}, clear: async () => {cache.clear();}, cleanup: async () => {}},
            serviceTypes: servicesType, resolveConfiguredModel, getMissingCredentialMessage: () => null,
            endpointResolver: {resolveOpenAICompatibleEndpoint: () => ({endpoint: 'https://fixture.invalid/v1'}), aiSdkTransportProfile: 'fixture'},
            promptBuilder: {buildPageSummaryPrompt: text => text, buildPageSummarySystemPrompt: () => ''},
            getTranslationLanguages: () => ({sourceLanguage: 'en', targetLanguage: 'zh-Hans'}),
            buildTranslationCacheKey: identity => {
                identities.push(identity);
                const oldTerms = ['<g1>', '</g1>'].map(source => ({source, target: source}));
                const oldIdentity = {...identity, glossaryTerms: oldTerms, glossaryProtection: {version: 1, entries: oldTerms.map(term => ({...term, caseSensitive: true}))}};
                cache.set(JSON.stringify(oldIdentity), '旧译文：保留<g1>bold</g1>文本。');
                return JSON.stringify(identity);
            }, logger: {warn: vi.fn()},
        });
        await expect(broker.translateWithCache({origin, glossaryContext: 'document'})).resolves.toBe('翻译这一段，并保留<g1>粗体</g1>文本。');
        await expect(broker.translateWithCache({origin, glossaryContext: 'document'})).resolves.toBe('翻译这一段，并保留<g1>粗体</g1>文本。');
        expect(provider).toHaveBeenCalledOnce();
        expect(identities[0].glossaryTerms ?? []).toEqual([]);
        expect(cache.size).toBe(2);
        config.glossaryEnabled = true;
        const userSource = 'The developer improves the documentation for this project.';
        config.glossaryLibraries = [{id: 'user', name: 'User', enabled: true, sourceLanguage: '', targetLanguage: 'zh-hans', domains: [],
            entries: [{id: 'developer', source: userSource, target: userSource, caseSensitive: true}]}];
        provider.mockImplementation(async (message: Record<string, unknown>) => String(message.origin));
        const emphasized = `<g1>${userSource}</g1>`;
        await expect(broker.translateWithCache({origin: emphasized, glossaryContext: 'document'})).resolves.toBe(emphasized);
        await expect(broker.translateWithCache({origin: emphasized, glossaryContext: 'document'})).resolves.toBe(emphasized);
        expect(provider).toHaveBeenCalledTimes(2);
        const current = {...createTranslationProviderConfigSnapshot(config), glossaryTerms: [{source: userSource, target: userSource}],
            glossaryMatchContext: {context: 'document' as const, sourceLanguage: 'en', targetLanguage: 'zh-hans'}};
        expect(isGlossaryOnlyResult(current, emphasized, emphasized)).toBe(true);
        expect(isGlossaryOnlyResult(current, `<g1>${userSource} extra</g1>`, `<g1>${userSource} extra</g1>`)).toBe(false);
        expect(isGlossaryOnlyResult({...current, glossaryMatchContext: {...current.glossaryMatchContext, context: 'page'}}, emphasized, emphasized)).toBe(false);
    });

    it('keeps URLs, emails, code-style product names and compound model names with exact spelling', () => {
        const terms = findDocumentLiteralTerms('Use FluentRead with GNMT+RL and https://github.com/tensorflow/tensor2tensor. Email ai+docs@example.org!');
        expect(terms.map(term => term.source)).toEqual(['FluentRead', 'GNMT+RL', 'https://github.com/tensorflow/tensor2tensor', 'ai+docs@example.org']);
        expect(terms.every(term => term.target === term.source && term.caseSensitive)).toBe(true);
        expect(findDocumentLiteralTerms('访问 https://example.com。请继续翻译后面的说明。参阅（https://example.org）后继续。'))
            .toEqual(['https://example.com', 'https://example.org'].map(source => ({source, target: source, caseSensitive: true})));
        expect(findDocumentLiteralTerms('https://example.com、下一项需要翻译'))
            .toEqual([{source: 'https://example.com', target: 'https://example.com', caseSensitive: true}]);
    });
    it('deduplicates repeated literals across paragraphs and leaves normal prose and incomplete identifiers alone', () => {
        expect(findDocumentLiteralTerms(['FluentRead and DeepSeek', 'FluentRead again', 'ABSTRACT Transformer line structure snake_case', 'GNMT+ and no@address']))
            .toEqual(['FluentRead', 'DeepSeek'].map(source => ({source, target: source, caseSensitive: true})));
        expect(findDocumentLiteralTerms([])).toEqual([]);
        expect(findDocumentLiteralTerms('')).toEqual([]);
    });
    it('rejects missing, duplicate, unknown and foreign paragraph tokens before a free route wins', () => {
        const token = '__FRTERM_123456789abc_0__', other = '__FRTERM_123456789abc_1__';
        expect(() => validateGlossaryProtectedTokens('plain', null)).not.toThrow();
        expect(() => validateGlossaryProtectedTokens('plain', null, [])).not.toThrow();
        expect(() => validateGlossaryProtectedTokens(token, `译文${token}`, [token, other])).not.toThrow();
        for (const result of [null, '丢失', `${token}${token}`, `${token}${other}`, `${token}__FRTERM_unknown_0__`])
            expect(() => validateGlossaryProtectedTokens(token, result, [token, other])).toThrow('未完整保留术语');
        expect(() => validateGlossaryProtectedTokens(`${token} __FRTERM_literal_0__`, `${token} __FRTERM_literal_0__`, [token])).not.toThrow();
    });
    it('protects only document requests and gives provider and cache the same identity terms without global glossary changes', () => {
        const current = documentConfig();
        const origin = 'Use FluentRead and GNMT+RL at https://github.com/tensorflow/tensor2tensor.';
        const entries = getGlossaryProtectionEntries(current, origin);
        expect(entries).toEqual(findDocumentLiteralTerms(origin));
        expect(getTranslationGlossaryTerms(current, origin)).toEqual(entries.map(({source, target}) => ({source, target})));
        const packet = prepareGlossaryRequest({origin}, current);
        expect(packet.message.origin).not.toContain('tensorflow');
        expect(packet.restore(packet.message.origin)).toBe(origin);
        expect(() => packet.restore('模型名称已经丢失')).toThrow('未完整保留术语');
        expect(getGlossaryProtectionEntries({...current, glossaryMatchContext: {...current.glossaryMatchContext, context: 'page'}}, origin)).toEqual([]);
        expect(getTranslationGlossaryTerms({...current, glossaryMatchContext: {...current.glossaryMatchContext, context: 'page'}}, origin)).toEqual([]);
    });

    it('lets explicit short user terms win over automatic long names with the same boundaries, case and NFC rules', () => {
        const term = {source: 'GNMT', target: '用户译法', caseSensitive: true};
        expect(findDocumentLiteralTerms('GNMT+RL GNMT+RL FluentRead', [term]))
            .toEqual([{source: 'FluentRead', target: 'FluentRead', caseSensitive: true}]);
        expect(findDocumentLiteralTerms('GNMT+RL', [{...term, source: 'gnmt', caseSensitive: false}])).toEqual([]);
        for (const source of ['gnmt', 'NMT', 'unrelated'])
            expect(findDocumentLiteralTerms('GNMT+RL', [{...term, source}]))
                .toEqual([{source: 'GNMT+RL', target: 'GNMT+RL', caseSensitive: true}]);
        expect(findDocumentLiteralTerms('GNMT+RL model GNMT+RL', [{...term, source: 'model'}]))
            .toEqual([{source: 'GNMT+RL', target: 'GNMT+RL', caseSensitive: true}]);
        expect(findDocumentLiteralTerms('https://example.com/Cafe\u0301', [{source: 'Café', target: '用户拼写', caseSensitive: true}])).toEqual([]);
        expect(findDocumentLiteralTerms('https://example.com/Café', [{source: 'Cafe\u0301', target: '用户拼写', caseSensitive: true}])).toEqual([]);
        expect(findDocumentLiteralTerms('https://example.com/Cafe\u0301', [{source: 'different', target: '', caseSensitive: true}]))
            .toEqual([{source: 'https://example.com/Cafe\u0301', target: 'https://example.com/Cafe\u0301', caseSensitive: true}]);
    });

    it('restores GNMT user spelling through broker, provider tokens and cache without changing page requests', async () => {
        const config = Object.assign(new Config(), {service: 'microsoft', from: 'en', to: 'zh-Hans', useCache: true, glossaryEnabled: true,
            glossaryLibraries: [{id: 'user', name: 'User terms', enabled: true, sourceLanguage: '', targetLanguage: 'zh-hans', domains: [],
                entries: [{id: 'gnmt', source: 'GNMT', target: '用户译法', caseSensitive: true}]}]});
        const before = JSON.stringify(config.glossaryLibraries);
        const cache = new Map<string, string>(), identities: Record<string, unknown>[] = [];
        const provider = vi.fn(async (message: Record<string, unknown>) => {
            const snapshot = getTranslationProviderConfig(message, createTranslationProviderConfigSnapshot(config));
            expect(snapshot.glossaryProtectedTokens).toHaveLength(2);
            expect(message.origin).not.toContain('GNMT'); expect(message.origin).not.toContain('FluentRead');
            expect(message.origin).toContain('+RL');
            return `译文:${message.origin}`;
        });
        const broker = createTranslationBroker({ready: Promise.resolve(), getConfig: () => config, providers: {microsoft: provider},
            cache: {get: async key => cache.get(key) ?? null, set: async (key, value) => {cache.set(key, value); return true;}, clear: async () => {cache.clear();}, cleanup: async () => {}},
            serviceTypes: servicesType, resolveConfiguredModel, getMissingCredentialMessage: () => null,
            endpointResolver: {resolveOpenAICompatibleEndpoint: () => ({endpoint: 'https://fixture.invalid/v1'}), aiSdkTransportProfile: 'fixture'},
            promptBuilder: {buildPageSummaryPrompt: text => text, buildPageSummarySystemPrompt: () => ''},
            getTranslationLanguages: request => ({sourceLanguage: request?.sourceLanguage ?? 'en', targetLanguage: request?.targetLanguage ?? 'zh-Hans'}),
            buildTranslationCacheKey: identity => {identities.push(identity); return JSON.stringify(identity);}, logger: {warn: vi.fn()},
        });
        const origin = 'Use GNMT+RL with FluentRead.';
        await expect(broker.translateWithCache({origin, glossaryContext: 'document'})).resolves.toBe('译文:Use 用户译法+RL with FluentRead.');
        expect(identities[0]).toMatchObject({glossaryTerms: [{source: 'GNMT', target: '用户译法'}, {source: 'FluentRead', target: 'FluentRead'}],
            glossaryProtection: {entries: [{source: 'GNMT', target: '用户译法', caseSensitive: true}, {source: 'FluentRead', target: 'FluentRead', caseSensitive: true}]}});
        await expect(broker.translateWithCache({origin, glossaryContext: 'document'})).resolves.toBe('译文:Use 用户译法+RL with FluentRead.');
        expect(provider).toHaveBeenCalledOnce();
        expect(JSON.stringify(config.glossaryLibraries)).toBe(before);

        const current = {...documentConfig(), glossaryTerms: [{source: 'GNMT', target: 'GNMT'}],
            glossaryLibraries: [{...config.glossaryLibraries[0], entries: [{id: 'gnmt', source: 'GNMT', target: '', caseSensitive: true}]}]};
        const entries = getGlossaryProtectionEntries(current, origin);
        expect(entries.map(entry => entry.source)).toEqual(['GNMT', 'FluentRead']);
        expect(getTranslationGlossaryTerms(current, origin)).toEqual(entries.map(({source, target}) => ({source, target: target || source})));
        const packet = prepareGlossaryRequest({origin}, current);
        expect(packet.restore(packet.message.origin)).toBe(origin);
    });
});

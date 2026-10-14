import type {TranslationProviderRequest} from '@/src/services/translation/types';
import {describe, expect, it, vi} from 'vitest';
import {decodeGlossaryText, parseGlossaryImport, protectGlossaryText, resolveGlossaryEntries,
    type GlossaryLibrary} from '@/src/core/glossary';
import {findGlossaryMatches, findGlossaryRanges} from '@/src/core/glossary/match';
import {Config} from '@/src/core/config/model';
import {resolveConfiguredModel, servicesType} from '@/src/core/config/catalog';
import {createTranslationBroker} from '@/src/services/translation/broker';
import {attachTranslationGlossaryContext, createTranslationProviderConfigSnapshot} from '@/src/services/translation/requestSnapshot';
import {isGlossaryOnlyResult, prepareGlossaryRequest} from '@/src/services/translation/glossaryProtection';

const term = (source: string, target = '', caseSensitive = false) => ({source, target, caseSensitive});
const library = (entries: ReturnType<typeof term>[]): GlossaryLibrary => ({
    id: 'audit', name: '审计', enabled: true, sourceLanguage: '', targetLanguage: '', domains: [],
    entries: entries.map((entry, index) => ({...entry, id: `entry-${index}`})),
});
const resolve = (text: string | string[], entries: ReturnType<typeof term>[]) =>
    resolveGlossaryEntries([library(entries)], {text, sourceLanguage: 'en', targetLanguage: 'zh-Hans'});

function brokerHarness(originals: string[]) {
    const config = Object.assign(new Config(), {service: 'openai', from: 'en', to: 'zh-Hans', useCache: true,
        glossaryEnabled: true, glossaryLibraries: [library(originals.map(original => term(original.normalize('NFC'))))]});
    config.model.openai = 'model-fixture';
    const cache = new Map<string, string>();
    const provider = vi.fn(async (message: TranslationProviderRequest): Promise<unknown> => message.origin);
    const cacheSet = vi.fn(async (key: string, value: string) => {cache.set(key, value); return true;});
    const broker = createTranslationBroker({ready: Promise.resolve(), getConfig: () => config,
        providers: {openai: provider}, cache: {get: async key => cache.get(key) ?? null, set: cacheSet, clear: async () => {cache.clear();}, cleanup: async () => {}},
        serviceTypes: servicesType,
        endpointResolver: {resolveOpenAICompatibleEndpoint: () => ({endpoint: 'https://fixture.invalid/v1'}), aiSdkTransportProfile: 'fixture'},
        promptBuilder: {buildPageSummaryPrompt: text => text, buildPageSummarySystemPrompt: () => 'fixture'},
        getMissingCredentialMessage: () => null, getTranslationLanguages: () => ({sourceLanguage: 'en', targetLanguage: 'zh-Hans'}),
        resolveConfiguredModel, buildTranslationCacheKey: identity => JSON.stringify(identity), logger: {warn: vi.fn()},
    });
    const request = (origin: string | string[]) => broker.translateWithCache(attachTranslationGlossaryContext(
        Array.isArray(origin) ? {origin} : {origin}, {context: 'page', pageUrl: 'https://fixture.invalid'}));
    return {config, request, provider, cacheSet};
}

describe('术语库审计的匹配与原文边界', () => {
    it('长词占用后从剩余正文继续匹配相邻重复的 CJK 短词', () => {
        const text = '长词哈哈哈哈';
        const entries = [term('长词哈', '长'), term('哈哈', '短')];
        expect(findGlossaryMatches(text, entries).map(({start, end}) => [start, end])).toEqual([[0, 3], [3, 5]]);
        const packet = protectGlossaryText(text, entries);
        expect(packet.restore(packet.text)).toBe('长短哈');
        expect(resolve(text, entries).terms).toEqual(entries);
    });

    it('边界不合格的长命中不消耗其后合法的重叠标点词', () => {
        expect(findGlossaryRanges('ax.x.x.', 'x.x.', false)).toEqual([{start: 3, end: 7}]);
        const packet = protectGlossaryText('ax.x.x.', [term('x.x.', '末尾')]);
        expect(packet.restore(packet.text)).toBe('ax.末尾');
    });

    it('命中其他术语时仍逐字保留未命中的分解 Unicode 与首尾空白', () => {
        const original = '  cafe\u0301 API\r\n가\t';
        const packet = protectGlossaryText(original, [term('API', '接口')]);
        expect(packet.text).toBe(original.replace('API', packet.tokens[0]));
        expect(packet.restore(packet.text)).toBe(original.replace('API', '接口'));
    });

    it('空译文保留原文的大小写与分解写法，NFC 术语仍能命中', () => {
        const original = 'CAFE\u0301 cafe\u0301';
        const packet = protectGlossaryText(original, [term('café')]);
        expect(packet.tokens).toHaveLength(2);
        expect(packet.restore(packet.text)).toBe(original);
    });

    it('槽协议不改写旁边未命中内容，替换目标不递归处理', () => {
        const original = '___FLUENTREAD_a_0_BEGIN___cafe\u0301 API___FLUENTREAD_a_0_END___';
        const packet = protectGlossaryText(original, [term('API', '$& <tag> cafe\u0301')]);
        expect(packet.restore(packet.text)).toBe(original.replace('API', () => '$& <tag> cafe\u0301'));
    });

    it('Hangul 跨字母组合、补充平面字符和未合成附加符映射回原始范围', () => {
        const original = '각 나 😀 cafe\u0301 API';
        const packet = protectGlossaryText(original, [term('각', '甲'), term('나', '乙'), term('😀', '星'), term('API', '接口')]);
        expect(packet.tokens).toHaveLength(4);
        expect(packet.restore(packet.text)).toBe('甲 乙 星 cafe\u0301 接口');
        const preserved = protectGlossaryText(original, [term('각'), term('나'), term('😀')]);
        expect(preserved.restore(preserved.text)).toBe(original);
    });

    it('不切开组合字符内部，完整组合仍可保护和恢复', () => {
        const original = 'カ\u3099\u0301 API';
        const partial = protectGlossaryText(original, [term('ガ', '半个'), term('\u0301', '附加符'), term('API', '接口')]);
        expect(partial.tokens).toHaveLength(1);
        expect(partial.restore(partial.text)).toBe(original.replace('API', '接口'));
        const complete = protectGlossaryText(original, [term('ガ\u0301', '完整'), term('API', '接口')]);
        expect(complete.tokens).toHaveLength(2);
        expect(complete.restore(complete.text)).toBe('完整 接口');
    });

    it('保留同源优先级、敏感词并存、显式空选择及输入对象身份', () => {
        const entries = [term('US', '美国', true), term('us', '我们', true), term('Us', '替代'), term('USA', '美利坚')];
        const before = structuredClone(entries);
        const result = resolve('US us USA', entries);
        expect(result.terms).toEqual([entries[3], entries[0], entries[1]]);
        expect(result.conflicts).toEqual([{source: 'Us', keptTarget: '美国', ignoredTarget: '替代', libraryId: 'audit', entryId: 'entry-2'}]);
        expect(entries).toEqual(before);
        expect(resolveGlossaryEntries([library(entries)], {text: 'US us', sourceLanguage: 'auto', targetLanguage: 'en', glossaryIds: []}).terms).toEqual([]);
    });

    it('跨文字槽不制造短语，最长词只占用实际合格范围', () => {
        expect(resolve(['machine', 'learning'], [term('machine learning', '机器学习')]).terms).toEqual([]);
        expect(resolve('Chort bayonet / Chort Bay', [term('Chort Bay', '湾'), term('Chort', '城')]).terms)
            .toEqual([term('Chort Bay', '湾'), term('Chort', '城')]);
        expect(findGlossaryMatches('😀API😀 𐐀API API𐐀', [term('API')]).map(({start, end}) => [start, end])).toEqual([[2, 5]]);
    });

    it('原文控制字符与孤立代理项不被删除或替换后制造虚假术语命中', () => {
        for (const original of ['AP\u0000I', 'AP\u0008I', 'AP\uD800I']) {
            const entries = [term('API', '接口'), term('AP�I', '假词')];
            expect(resolve(original, entries).terms).toEqual([]);
            const packet = protectGlossaryText(original, entries);
            expect(packet.tokens).toEqual([]);
            expect(packet.restore(packet.text)).toBe(original);
        }
        expect(resolveGlossaryEntries([library([term('API')])], {
            text: [null, 'API'] as unknown as string[], sourceLanguage: 'en', targetLanguage: 'en',
        }).terms).toEqual([term('API')]);
    });

    it('同源索引与库条目顺序一致，敏感组合不会把早先赢家覆盖', () => {
        const spellings = ['US', 'us', 'Us'];
        for (let mask = 0; mask < 8; mask += 1) {
            for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2]]) {
                const entries = order.map((index) => term(spellings[index], `译法${index}`, Boolean(mask & (1 << index))));
                const chosen: ReturnType<typeof term>[] = [];
                const conflicts: {source: string; keptTarget: string; ignoredTarget: string; libraryId: string; entryId: string}[] = [];
                entries.forEach((entry, index) => {
                    const previous = chosen.find(item => item.source === entry.source
                        || ((!item.caseSensitive || !entry.caseSensitive) && item.source.toLowerCase() === entry.source.toLowerCase()));
                    if (previous) conflicts.push({source: entry.source, keptTarget: previous.target, ignoredTarget: entry.target, libraryId: 'audit', entryId: `entry-${index}`});
                    else chosen.push(entry);
                });
                expect(resolve('US us Us', entries)).toEqual({terms: chosen, conflicts});
            }
        }
    });
});

describe('术语库审计的真实文件输入规范化', () => {
    it('明确 UTF-8 BOM 的损坏文件不能降级成代码页乱码，非 BOM 旧编码继续兼容', () => {
        const bom = [0xef, 0xbb, 0xbf];
        const valid = Uint8Array.from([...bom, ...new TextEncoder().encode('source,target\nAPI,接口')]);
        expect(decodeGlossaryText(valid.buffer)).toBe('source,target\nAPI,接口');
        const invalid = Uint8Array.from([...bom, ...new TextEncoder().encode('source,target\nAPI,'), 0xff]);
        expect(() => decodeGlossaryText(invalid.buffer)).toThrow();
        for (const legacy of [[0xef, 0xba], [0xef, 0xbb, 0xc1, 0xc1]]) {
            expect(() => decodeGlossaryText(Uint8Array.from(legacy).buffer)).not.toThrow();
            expect(decodeGlossaryText(Uint8Array.from(legacy).buffer)).not.toContain('�');
        }
    });

    it.each([
        [0xff, 0xfe, 0x41], [0xfe, 0xff, 0x00],
        [0xff, 0xfe, 0x00, 0xd8], [0xfe, 0xff, 0xdc, 0x00],
    ].map(bytes => ({bytes})))('有明确 UTF-16 BOM 的损坏文件必须报错，不能静默产生替换字符 %#', ({bytes}) => {
        expect(() => decodeGlossaryText(Uint8Array.from(bytes).buffer)).toThrow();
    });

    it('JSON 的 auto 与表格相同地清理空白和大小写', () => {
        const preview = parseGlossaryImport(JSON.stringify({sourceLanguage: ' AUTO ', targetLanguage: 'Auto', entries: [{source: 'API'}]}), 'json');
        expect(preview.errors).toEqual([]);
        expect(preview.libraries[0]).toMatchObject({sourceLanguage: '', targetLanguage: ''});
    });

    it.each(['false', 0, null, {}])('JSON 非布尔启用状态不能悄悄变成启用 %#', enabled => {
        const preview = parseGlossaryImport(JSON.stringify({enabled, entries: [{source: 'API'}]}), 'json');
        expect(preview.errors.join('')).toContain('启用状态需要布尔值');
    });
});

describe('术语库审计的实际服务消费者', () => {
    it('纯术语判断比较规范写法，单条与批量回填保留实际原文字节', () => {
        const original = 'cafe\u0301';
        const config = new Config();
        config.glossaryLibraries = [library([term('café')])];
        const current = {...createTranslationProviderConfigSnapshot(config), glossaryTerms: [{source: 'café', target: 'café'}],
            glossaryMatchContext: {sourceLanguage: 'en', targetLanguage: 'zh-Hans', glossaryIds: null}};
        const packet = prepareGlossaryRequest({origin: [original, original.toUpperCase()]}, current);
        expect(packet.restore(packet.message.origin)).toEqual([original, original.toUpperCase()]);
        expect(isGlossaryOnlyResult(current, original, original)).toBe(true);
        expect(isGlossaryOnlyResult(current, original, original.normalize('NFC'))).toBe(true);
        expect(isGlossaryOnlyResult(current, original, 'different')).toBe(false);
        expect(isGlossaryOnlyResult(current, `${original} extra`, `${original} extra`)).toBe(false);
    });

    it('真实 broker 接受整句 NFD 保留原文并复用缓存，服务只调用一次', async () => {
        const original = 'The cafe\u0301 serves fresh coffee every morning.';
        const h = brokerHarness([original]);
        await expect(h.request(original)).resolves.toBe(original);
        await expect(h.request(original)).resolves.toBe(original);
        expect(h.provider).toHaveBeenCalledOnce();
        expect(h.cacheSet).toHaveBeenCalled();
        expect(h.provider.mock.calls[0][0].origin).not.toBe(original);
    });

    it('批量纯术语槽恢复各自的 NFD 原文并缓存，不进入回显恢复重试', async () => {
        const originals = ['The cafe\u0301 serves fresh coffee every morning.', 'This cafe\u0301 welcomes visitors every afternoon.'];
        const h = brokerHarness(originals);
        await expect(h.request(originals)).resolves.toEqual(originals);
        expect(h.provider.mock.calls.length).toBeLessThanOrEqual(originals.length);
        const calls = h.provider.mock.calls.length;
        await expect(h.request(originals)).resolves.toEqual(originals);
        expect(h.provider.mock.calls.length).toBe(calls);
        expect(h.cacheSet).toHaveBeenCalled();
    });
});

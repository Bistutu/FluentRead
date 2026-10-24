import {afterEach, describe, expect, it, vi} from 'vitest';
import {createZoteroTranslator, parseZoteroGlossary} from '../integrations/zotero/translation';
import {defaultSettings, normalizeCompatibleEndpoint, normalizeSettings} from '../integrations/zotero/settings';
import type {TranslationSettings} from '../integrations/zotero/contracts';
import type {RuntimeFetch} from '../src/platform/http/runtime';

const response = (text: string) => new Response(JSON.stringify({choices: [{message: {role: 'assistant', content: text}, finish_reason: 'stop'}]}));
const settings = (extra: Partial<TranslationSettings> = {}): TranslationSettings => ({...defaultSettings, ...extra});
const compatible = (extra: Partial<TranslationSettings> = {}) => settings({service: 'compatible', endpoint: 'https://model.example/v1', model: 'academic-model', apiKey: 'private-test-key', ...extra});
const signal = () => new AbortController().signal;
const body = (init?: RequestInit) => JSON.parse(String(init?.body));
const microsoft = (transform: (source: string) => string): RuntimeFetch => async (_url, init) => new Response(JSON.stringify(
    (body(init) as string[]).map(text => ({translations: [{text: transform(text)}]})),
));
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

describe('Zotero settings and endpoint trust boundary', () => {
    it.each(['https://user:secret@example.com/v1', 'https://example.com/v1?key=private', 'https://example.com/#secret',
        'http://example.com/v1', 'file:///tmp/api', 'javascript:alert(1)', 'not-url'])('rejects unsafe endpoint without reflecting it: %s', value => {
        expect(() => normalizeCompatibleEndpoint(value)).toThrow();
        expect(normalizeSettings({endpoint: value}).endpoint).toBe('');
    });
    it.each([
        ['https://model.example', 'https://model.example/v1/chat/completions'],
        ['https://model.example/v1/', 'https://model.example/v1/chat/completions'],
        ['http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434/v1/chat/completions'],
        ['http://[::1]:8080/chat/completions', 'http://[::1]:8080/chat/completions'],
        ['http://localhost:8080/custom', 'http://localhost:8080/custom'],
    ])('accepts secure or local endpoint %s', (value, expected) => expect(normalizeCompatibleEndpoint(value)).toBe(expected));
    it('normalizes only bounded explicit fields and never trusts prototype data', () => {
        expect(normalizeSettings(null)).toEqual(defaultSettings);
        expect(normalizeSettings({sourceLanguage: 'xx-TEST', targetLanguage: 'auto', service: 'other', model: ' m ', autoOpen: false,
            output: 'translated', apiKey: ' x ', glossary: ' s = t '})).toEqual({...defaultSettings, sourceLanguage: 'xx-TEST', model: 'm', autoOpen: false,
                output: 'translated', apiKey: 'x', glossary: 's = t'});
        expect(normalizeSettings({sourceLanguage: 'invalid source language', targetLanguage: 'en', glossary: 'a'.repeat(30_000)}).glossary).toHaveLength(20_000);
        expect(defaultSettings.apiKey).toBe('');
        expect(normalizeSettings(Object.create({service: 'compatible', apiKey: 'inherited'}))).toEqual(defaultSettings);
    });
    it('parses strict literal glossary data', () => {
        expect(parseZoteroGlossary('# comment\nTransformer = 变换器\nattention\t注意力\n')).toEqual([
            {source: 'Transformer', target: '变换器', caseSensitive: false}, {source: 'attention', target: '注意力', caseSensitive: false},
        ]);
        expect(() => parseZoteroGlossary('missing delimiter')).toThrow('原词');
        expect(() => parseZoteroGlossary(Array.from({length: 501}, (_, i) => `source${i} = target`).join('\n'))).toThrow('500');
    });
});

describe('Zotero translation uses shared protocols', () => {
    it('preserves glossary spelling in Microsoft translation and uses a credential-free fixed endpoint', async () => {
        const fetch = vi.fn(microsoft(source => source.replace(' learns', ' 学习')));
        const translator = createZoteroTranslator(settings({glossary: 'Transformer = 变换器'}), {fetch});
        expect(await translator.selection('Transformer learns', signal())).toBe('变换器 学习');
        const [url, init] = fetch.mock.calls[0];
        expect(String(url)).toContain('https://edge.microsoft.com/translate/translatetext');
        expect(init).toMatchObject({credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error'});
        expect(new Headers(init?.headers).has('authorization')).toBe(false);
    });
    it('freezes settings before async requests and resumes only missing document segments', async () => {
        const original = settings();
        const fetch = vi.fn(microsoft(text => `译文 ${text}`));
        const translator = createZoteroTranslator(original, {fetch});
        original.targetLanguage = 'fr';
        const segment = vi.fn(), progress = vi.fn();
        expect(await translator.segments([{id: 0, source: 'First sentence.'}, {id: 1, source: 'Second sentence.'}], {
            fileName: 'paper.pdf', signal: signal(), initialTranslations: ['已完成'], onSegment: segment, onProgress: progress,
        })).toEqual(['已完成', '译文 Second sentence.']);
        expect(String(fetch.mock.calls[0][0])).toContain('to=zh-Hans');
        expect(fetch.mock.calls.flatMap(([, init]) => body(init))).toEqual(['Second sentence.']);
        expect(segment).toHaveBeenCalledWith({id: 1, translation: '译文 Second sentence.'});
        expect(progress).toHaveBeenLastCalledWith({completed: 2, total: 2});
    });
    it('uses shared AI payload, preserves terms and strips reasoning before display', async () => {
        const fetch = vi.fn(async (_url, init) => {
            const prompt = body(init).messages.at(-1).content as string;
            const token = prompt.match(/__FRTERM_[a-z0-9_]+__/u)![0];
            return response(`<think>internal</think>${token} 学习`);
        }) as unknown as RuntimeFetch;
        const translator = createZoteroTranslator(compatible({glossary: 'Transformer = 变换器'}), {fetch});
        expect(await translator.selection('Transformer learns', signal())).toBe('变换器 学习');
        const [url, init] = vi.mocked(fetch).mock.calls[0];
        expect(String(url)).toBe('https://model.example/v1/chat/completions');
        expect(body(init)).toMatchObject({model: 'academic-model', stream: false});
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private-test-key');
    });
    it('strictly validates AI multi-segment results and automatically falls back to single segments', async () => {
        const fetch = vi.fn(async (_url, init) => {
            const prompt = body(init).messages.at(-1).content as string;
            if (prompt.includes('___FLUENTREAD_')) return response('lost markers');
            return response(prompt.includes('Alpha sentence.') ? '阿尔法句。' : '贝塔句。');
        }) as unknown as RuntimeFetch;
        const result = await createZoteroTranslator(compatible(), {fetch}).segments([
            {id: 0, source: 'Alpha sentence.'}, {id: 1, source: 'Beta sentence.'},
        ], {fileName: 'paper.pdf', signal: signal()});
        expect(result).toEqual(['阿尔法句。', '贝塔句。']);
        expect(fetch).toHaveBeenCalledTimes(3);
    });
    it('uses one AI request for a valid ordered multi-segment response', async () => {
        const fetch = vi.fn(async (_url, init) => {
            const prompt = body(init).messages.at(-1).content as string;
            const packet = prompt.match(/___FLUENTREAD_([a-z0-9_-]+)_0_BEGIN___[\s\S]+?___FLUENTREAD_\1_1_END___/u)![0];
            return response(packet.replace('Alpha sentence.', '阿尔法句。').replace('Beta sentence.', '贝塔句。'));
        }) as unknown as RuntimeFetch;
        expect(await createZoteroTranslator(compatible(), {fetch}).segments([
            {id: 0, source: 'Alpha sentence.'}, {id: 1, source: 'Beta sentence.'},
        ], {fileName: 'paper.pdf', signal: signal()})).toEqual(['阿尔法句。', '贝塔句。']);
        expect(fetch).toHaveBeenCalledOnce();
    });
    it('rejects a lost glossary token rather than displaying broken terminology', async () => {
        await expect(createZoteroTranslator(compatible({glossary: 'Transformer = 变换器'}), {fetch: async () => response('lost token')})
            .selection('Transformer learns', signal())).rejects.toMatchObject({code: 'GLOSSARY_PLACEHOLDER_INVALID'});
    });
    it('masks credentials in provider failures', async () => {
        const fetch: RuntimeFetch = async () => new Response(JSON.stringify({error: {message: 'Rejected private-test-key'}}), {status: 401});
        await expect(createZoteroTranslator(compatible(), {fetch}).selection('Paper', signal())).rejects.toSatisfy((error: unknown) =>
            error instanceof Error && !error.message.includes('private-test-key') && error.message.length > 0);
    });
    it('keeps Microsoft rate limits and Retry-After available to the document retry budget', async () => {
        const fetch: RuntimeFetch = async () => new Response('upstream text is hidden', {status: 429, headers: {'Retry-After': '3'}});
        await expect(createZoteroTranslator(settings(), {fetch}).selection('Paper', signal())).rejects.toMatchObject({
            kind: 'rate-limit', statusCode: 429, retryable: true, retryAfterMs: 3000,
        });
    });
    it('fails locally for missing endpoint or model without sending text', async () => {
        const fetch = vi.fn();
        await expect(createZoteroTranslator(compatible({endpoint: ''}), {fetch}).selection('Paper', signal())).rejects.toThrow();
        await expect(createZoteroTranslator(compatible({model: ''}), {fetch}).selection('Paper', signal())).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
    });
    it('cancels a transport that ignores AbortSignal and observes its late rejection', async () => {
        let reject!: (error: Error) => void;
        const fetch = vi.fn(() => new Promise<Response>((_resolve, no) => {reject = no;}));
        const controller = new AbortController();
        const work = createZoteroTranslator(settings(), {fetch}).selection('Paper', controller.signal);
        const settled = expect(work).rejects.toMatchObject({name: 'AbortError'});
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        controller.abort();
        await settled;
        reject(new Error('late failure')); await Promise.resolve();
    });
    it('bounds a stalled request with its own deadline', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn(() => new Promise<Response>(() => {}));
        const work = createZoteroTranslator(compatible(), {fetch, timeoutMs: 50}).selection('Paper', signal());
        const settled = expect(work).rejects.toMatchObject({kind: 'timeout'});
        await vi.advanceTimersByTimeAsync(51);
        await settled;
    });
    it('rejects canceled or oversized selections before sending', async () => {
        const fetch = vi.fn(); const controller = new AbortController(); controller.abort();
        const translator = createZoteroTranslator(settings(), {fetch});
        await expect(translator.selection('Paper', controller.signal)).rejects.toThrow();
        await expect(translator.selection(' ', signal())).rejects.toThrow('请选择');
        await expect(translator.selection('x'.repeat(30_001), signal())).rejects.toThrow('30000');
        expect(fetch).not.toHaveBeenCalled();
    });
});

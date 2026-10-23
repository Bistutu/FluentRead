import {withProviderSnapshot} from './helpers/providerSnapshot';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {mockConfig} = vi.hoisted(() => ({mockConfig: {
    from: 'auto', to: 'zh-Hans', service: 'myMemory',
    proxy: {} as Record<string, string>, token: {} as Record<string, string>,
    myMemoryEmail: undefined as string | undefined,
}}));
vi.mock('@/src/services/config/store', () => ({config: mockConfig}));

import myMemory, {MY_MEMORY_MAX_BYTES, translateMyMemoryText} from '@/src/providers/translation/mymemory';
import {parseTranslationSlots, serializeTranslationSlots} from '@/src/core/translation/serialization';
import {attachTranslationProviderConfig, createTranslationProviderConfigSnapshot} from '@/src/services/translation/requestSnapshot';
import type {TranslationConfigSource} from '@/src/services/translation/types';
import {setRuntimeFetch} from '@/src/platform/http/runtime';

const fetchMock = vi.fn<typeof fetch>();
const english = 'This is a deliberately long English paragraph with enough alphabetic characters for reliable language detection.';
const reply = (text: unknown = '译文', extra: Record<string, unknown> = {}) => Response.json({
    responseStatus: 200, quotaFinished: false, responseData: {translatedText: text}, ...extra,
});
const requestUrl = (index = 0) => new URL(String(fetchMock.mock.calls[index]![0]));

beforeEach(() => {
    fetchMock.mockReset();
    mockConfig.from = 'auto';
    mockConfig.to = 'zh-Hans';
    mockConfig.proxy = {};
    mockConfig.myMemoryEmail = undefined;
    setRuntimeFetch(fetchMock);
});
afterEach(() => setRuntimeFetch());

describe('MyMemory 官方免费翻译适配器', () => {
    it('通过公开 get 端点发送显式语言对并保留首尾空白，不携带共享密钥', async () => {
        fetchMock.mockResolvedValue(reply('  你好 & 再见  '));
        await expect(myMemory(withProviderSnapshot({origin: '  hello & goodbye < 3 ?\t', sourceLanguage: 'en'}, mockConfig)))
            .resolves.toBe('  你好 & 再见\t');
        const url = requestUrl();
        expect(url.origin + url.pathname).toBe('https://api.mymemory.translated.net/get');
        expect(url.searchParams.get('q')).toBe('hello & goodbye < 3 ?');
        expect(url.searchParams.get('langpair')).toBe('en|zh-CN');
        expect([...url.searchParams.keys()]).toEqual(['q', 'langpair']);
        expect(fetchMock.mock.calls[0]![1]).toEqual({method: 'GET', signal: undefined});
    });

    it('邮箱和缺省语言来自冻结请求快照，残留代理设置不会接收邮箱', async () => {
        const snapshot = createTranslationProviderConfigSnapshot({
            ...mockConfig, from: 'en', to: 'zh-Hant', myMemoryEmail: ' user@example.com ',
            proxy: {myMemory: 'https://example.com/translate?existing=1'},
        } as unknown as TranslationConfigSource);
        mockConfig.from = 'ja';
        mockConfig.to = 'fr';
        mockConfig.myMemoryEmail = 'new@example.com';
        fetchMock.mockResolvedValue(reply('測試'));
        await expect(myMemory(withProviderSnapshot(attachTranslationProviderConfig({origin: 'test'}, snapshot), mockConfig))).resolves.toBe('測試');
        expect(requestUrl().origin).toBe('https://api.mymemory.translated.net');
        expect(requestUrl().searchParams.get('langpair')).toBe('en|zh-TW');
        expect(requestUrl().searchParams.get('de')).toBe('user@example.com');
        expect(requestUrl().searchParams.has('existing')).toBe(false);
    });

    it.each([
        [english, 'en'],
        ['Cette phrase française est suffisamment longue pour identifier la langue avec une confiance raisonnable.', 'fr'],
        ['Este es un párrafo suficientemente largo en español para reconocer el idioma de manera correcta y fiable.', 'es'],
        ['今日は良い天気です。', 'ja'],
        ['이 문장은 한국어로 작성되었습니다.', 'ko'],
        ['这是中文测试。', 'zh-CN'],
        ['繁體中文測試。', 'zh-TW'],
    ])('本地可靠推断源语言后才查询官方 API %#', async (text, source) => {
        fetchMock.mockResolvedValue(reply());
        await expect(translateMyMemoryText(text, withProviderSnapshot({targetLanguage: 'de'}, mockConfig))).resolves.toBe('译文');
        expect(requestUrl().searchParams.get('langpair')).toBe(`${source}|de`);
    });

    it('语言代码经统一规范化：地区与三字母代码折算，无法规范化的取值原样交给服务报错', async () => {
        fetchMock.mockImplementation(async () => reply());
        await translateMyMemoryText('hello', withProviderSnapshot({sourceLanguage: 'eng', targetLanguage: 'pt-BR'}, mockConfig));
        expect(requestUrl().searchParams.get('langpair')).toBe('en|pt');
        await translateMyMemoryText('hello', withProviderSnapshot({sourceLanguage: 'en', targetLanguage: '123'}, mockConfig));
        expect(requestUrl(1).searchParams.get('langpair')).toBe('en|123');
    });

    it.each(['hello', 'Bonjour le monde.', '12345', '日本語文章'])('不确定文本不猜测源语言，也不外发 auto %#', async text => {
        await expect(translateMyMemoryText(text, withProviderSnapshot({}, mockConfig))).rejects.toMatchObject({statusCode: 400});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('精确按 UTF-8 字节拆分长文本，保持 emoji 完整和原始空白、标点、换行', async () => {
        const text = `  ${'中文😀 word, '.repeat(70)}\r\n\t${'😀'.repeat(127)}。\n   `;
        fetchMock.mockImplementation(async url => reply(new URL(String(url)).searchParams.get('q')));
        await expect(translateMyMemoryText(text, withProviderSnapshot({sourceLanguage: 'en'}, mockConfig))).resolves.toBe(text);
        expect(fetchMock.mock.calls.length).toBeGreaterThan(3);
        for (const [input] of fetchMock.mock.calls) {
            const q = new URL(String(input)).searchParams.get('q')!;
            expect(new TextEncoder().encode(q).length).toBeLessThanOrEqual(MY_MEMORY_MAX_BYTES);
            expect(q).not.toContain('\ufffd');
            expect(q).not.toMatch(/[\r\n]/u);
        }
    });

    it('500 字节临界文本不多分片，无分词边界的长词按字节继续完整处理', async () => {
        fetchMock.mockImplementation(async url => reply(new URL(String(url)).searchParams.get('q')));
        await expect(translateMyMemoryText('a'.repeat(500), withProviderSnapshot({sourceLanguage: 'en'}, mockConfig))).resolves.toBe('a'.repeat(500));
        expect(fetchMock).toHaveBeenCalledOnce();
        fetchMock.mockClear();
        await expect(translateMyMemoryText('a'.repeat(501), withProviderSnapshot({sourceLanguage: 'en'}, mockConfig))).resolves.toBe('a'.repeat(501));
        expect(fetchMock.mock.calls.map((_, index) => requestUrl(index).searchParams.get('q')!.length)).toEqual([500, 1]);
    });

    it('仅本地重建完整文本槽协议，500 字节拆分不切断标记', async () => {
        const packet = serializeTranslationSlots([english.repeat(6), english], 'provider-test');
        fetchMock.mockImplementation(async input => {
            const q = new URL(String(input)).searchParams.get('q')!;
            expect(q).not.toContain('___FLUENTREAD_');
            return reply(q);
        });
        const result = await translateMyMemoryText(packet.payload, withProviderSnapshot({}, mockConfig));
        expect(parseTranslationSlots(packet, result)).toEqual([english.repeat(6), english]);
        expect(requestUrl().searchParams.get('langpair')).toBe('en|zh-CN');
    });

    it('短文本不会因槽标记带有大量英文字符而误判源语言', async () => {
        const packet = serializeTranslationSlots(['Bonjour'], 'a-long-marker-with-english-content');
        await expect(translateMyMemoryText(packet.payload, withProviderSnapshot({}, mockConfig))).rejects.toMatchObject({statusCode: 400});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('批量消息串行保序，空数组和全空白输入不查询', async () => {
        fetchMock.mockResolvedValueOnce(reply('甲')).mockResolvedValueOnce(reply('乙'));
        await expect(myMemory(withProviderSnapshot({origin: ['one', 'two'], sourceLanguage: 'en'}, mockConfig))).resolves.toEqual(['甲', '乙']);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        fetchMock.mockClear();
        await expect(myMemory(withProviderSnapshot({origin: []}, mockConfig))).resolves.toEqual([]);
        await expect(translateMyMemoryText(' \t\r\n', withProviderSnapshot({}, mockConfig))).resolves.toBe(' \t\r\n');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('拒绝非文本单条或批量输入', async () => {
        await expect(translateMyMemoryText(42 as unknown as string, withProviderSnapshot({}, mockConfig))).rejects.toMatchObject({statusCode: 400});
        await expect(myMemory(withProviderSnapshot({origin: 42} as never, mockConfig))).rejects.toMatchObject({statusCode: 400});
        await expect(myMemory(withProviderSnapshot({origin: [42]} as never, mockConfig))).rejects.toMatchObject({statusCode: 400});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        [null, 'MyMemory 翻译失败'],
        [{responseStatus: '403', responseDetails: 'secret original'}, 'MyMemory 翻译失败（错误码 403）'],
        [{responseStatus: 'secret original'}, 'MyMemory 翻译失败'],
        [{responseStatus: 200}, 'MyMemory 未返回有效译文'],
        [{responseStatus: 200, responseData: {}}, 'MyMemory 未返回有效译文'],
        [{responseStatus: 200, responseData: {translatedText: 12}}, 'MyMemory 未返回有效译文'],
        [{responseStatus: 200, responseData: {translatedText: '  '}}, 'MyMemory 未返回有效译文'],
    ])('拒绝协议失败和无效译文，不把上游正文写入错误 %#', async (payload, message) => {
        fetchMock.mockResolvedValue(Response.json(payload));
        await expect(translateMyMemoryText('test', withProviderSnapshot({sourceLanguage: 'en'}, mockConfig))).rejects.toThrow(message);
    });

    it('字符串成功码有效，但 quotaFinished 优先于看似成功的译文', async () => {
        fetchMock.mockResolvedValueOnce(reply('有效', {responseStatus: '200'}));
        await expect(translateMyMemoryText('test', withProviderSnapshot({sourceLanguage: 'en'}, mockConfig))).resolves.toBe('有效');
        fetchMock.mockResolvedValueOnce(reply('limit text', {quotaFinished: true}));
        await expect(translateMyMemoryText('test', withProviderSnapshot({sourceLanguage: 'en'}, mockConfig))).rejects.toMatchObject({statusCode: 429});
    });

    it('HTTP 和 JSON 错误只提供安全提示', async () => {
        fetchMock.mockResolvedValueOnce(new Response('secret original', {status: 503}));
        await expect(translateMyMemoryText('test', withProviderSnapshot({sourceLanguage: 'en'}, mockConfig))).rejects.toThrow('MyMemory 翻译失败: 503');
        fetchMock.mockResolvedValueOnce(new Response('secret invalid JSON'));
        await expect(translateMyMemoryText('test', withProviderSnapshot({sourceLanguage: 'en'}, mockConfig))).rejects.toThrow('MyMemory 返回的不是有效 JSON');
    });

    it('已取消请求不发送，服务忽略取消的迟到响应也不会变成成功', async () => {
        const controller = new AbortController();
        controller.abort('stop');
        await expect(translateMyMemoryText('test', withProviderSnapshot({sourceLanguage: 'en', abortSignal: controller.signal}, mockConfig)))
            .rejects.toMatchObject({name: 'AbortError'});
        expect(fetchMock).not.toHaveBeenCalled();

        const duringFetch = new AbortController();
        fetchMock.mockImplementationOnce(async (_url, init) => {
            expect(init?.signal).toBe(duringFetch.signal);
            duringFetch.abort(new Error('取消中的请求'));
            return reply();
        });
        await expect(translateMyMemoryText('test', withProviderSnapshot({sourceLanguage: 'en', abortSignal: duringFetch.signal}, mockConfig)))
            .rejects.toThrow('取消中的请求');

        const duringJson = new AbortController();
        fetchMock.mockResolvedValueOnce({ok: true, json: async () => {
            duringJson.abort(new Error('取消解析'));
            return {responseStatus: 200, responseData: {translatedText: 'late'}};
        }} as Response);
        await expect(translateMyMemoryText('test', withProviderSnapshot({sourceLanguage: 'en', abortSignal: duringJson.signal}, mockConfig)))
            .rejects.toThrow('取消解析');
    });

    it('分片前观察到取消时停止后续网络请求', async () => {
        let checks = 0;
        const signal = {get aborted() { return ++checks > 1; }, reason: new Error('分片已取消')} as AbortSignal;
        await expect(translateMyMemoryText('test', withProviderSnapshot({sourceLanguage: 'en', abortSignal: signal}, mockConfig)))
            .rejects.toThrow('分片已取消');
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each(['http', 'abort'] as const)('MyMemory %s headers 后取消未读正文，不等待其结束或取消握手', async mode => {
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        const response = new Response(new ReadableStream<Uint8Array>({cancel}),
            {status: mode === 'http' ? 429 : 200, headers: {'Retry-After': '12'}});
        const signal = new AbortController();
        const reason = new Error('cancelled after headers');
        fetchMock.mockImplementationOnce(async () => {if (mode === 'abort') signal.abort(reason); return response;});
        let settled = false;
        const result = translateMyMemoryText('Hello', withProviderSnapshot({sourceLanguage: 'en', abortSignal: signal.signal}, mockConfig)).then(
            () => {settled = true; throw new Error('unexpected success');},
            error => {settled = true; return error;},
        );
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(settled).toBe(true);
        expect(cancel).toHaveBeenCalledOnce();
        const error = await result;
        if (mode === 'abort') expect(error).toBe(reason);
        else expect(error).toMatchObject({statusCode: 429, retryAfterMs: 12000});
    });

    it('MyMemory 错误正文取消失败不覆盖原 HTTP 状态', async () => {
        const cancel = vi.fn(() => Promise.reject(new Error('cleanup failure')));
        const response = new Response(new ReadableStream<Uint8Array>({cancel}), {status: 503});
        fetchMock.mockImplementationOnce(async () => response);
        const result = translateMyMemoryText('Hello', withProviderSnapshot({sourceLanguage: 'en'}, mockConfig)).catch(error => error);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(cancel).toHaveBeenCalledOnce();
        expect(await result).toMatchObject({statusCode: 503});
    });

});

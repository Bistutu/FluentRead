/**
 * @file tests/freeOfficialWebProviders.test.ts
 * 文件职责：验证新增官方匿名服务的请求协议、固定节点边界、错误和取消。
 * 主要内容：覆盖四家服务的语言、分块、空白、槽协议与业务错误，并验证实际免费入口在历史私有凭据存在时仍只发送匿名网页请求。
 * 模块边界：使用可替换 HTTP 端口验证协议；真实可用性另由低频在线探测与隔离浏览器报告佐证。
 */
import {protectedDocumentLongMathParagraph} from './fixtures/documentLongMathParagraph';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {translateOfficialFreeWebText, translateOfficialFreeWebProvider, type OfficialFreeWebProvider} from '@/src/providers/translation/free-official-web';
import {setRuntimeFetch} from '@/src/platform/http/runtime';
import {parseTranslationSlots, serializeTranslationSlots} from '@/src/core/translation/serialization';

const providers: OfficialFreeWebProvider[] = ['alibabaFree', 'modernMtFree', 'laraFree', 'lingvanexFree'];
const fetchMock = vi.fn<typeof fetch>();
const authPage = () => new Response('const API_BEARER_TOKEN = "Bearer public-web-token";');
function response(provider: OfficialFreeWebProvider, translation: unknown = '中文译文'): Response {
    return Response.json(provider === 'alibabaFree' ? {success: true, data: {translateText: translation}}
        : provider === 'modernMtFree' ? {status: 200, data: {translation}}
            : provider === 'laraFree' ? {status: 200, content: {translations: [{translation}]}}
                : {err: null, result: translation});
}
function install(provider: OfficialFreeWebProvider): void {
    fetchMock.mockImplementation(async input => {
        const url = String(input);
        if (url.endsWith('/csrftoken')) return Response.json({token: 'anonymous-csrf', headerName: 'X-XSRF-TOKEN_PROPERTY_ITEM'});
        if (url === 'https://lingvanex.com/en/translate/') return authPage();
        return response(provider);
    });
}
const responseStages = [
    ['alibabaFree', 'csrf'], ['alibabaFree', 'translation'],
    ['modernMtFree', 'translation'], ['laraFree', 'translation'],
    ['lingvanexFree', 'home'], ['lingvanexFree', 'translation'],
] as const;

function installBeforeResponse(provider: OfficialFreeWebProvider, stage: typeof responseStages[number][1]): void {
    if (provider === 'alibabaFree' && stage === 'translation') {
        fetchMock.mockResolvedValueOnce(Response.json({token: 'anonymous-csrf', headerName: 'X-XSRF-TOKEN_PROPERTY_ITEM'}));
    }
    if (provider === 'lingvanexFree' && stage === 'translation') fetchMock.mockResolvedValueOnce(authPage());
}

function streamingResponse(status: number) {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({start(controller) {body = controller;}, cancel}), {
        status, headers: {'Retry-After': '60'},
    });
    return {response, body, cancel};
}
beforeEach(() => {vi.restoreAllMocks(); fetchMock.mockReset(); setRuntimeFetch(fetchMock);});
afterEach(() => setRuntimeFetch());

describe('official anonymous web translation providers', () => {
    it.each(responseStages)('%s %s cancels a streaming HTTP failure without waiting for EOF or cleanup', async (provider, stage) => {
        installBeforeResponse(provider, stage);
        const {response, cancel} = streamingResponse(429);
        fetchMock.mockResolvedValueOnce(response);
        const pending = translateOfficialFreeWebText(provider, 'Hello', 'en', 'zh-Hans')
            .catch(error => error);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        expect(cancel).toHaveBeenCalledOnce();
        await expect(pending).resolves.toMatchObject({statusCode: 429, retryAfterMs: 60000});
        expect(fetchMock).toHaveBeenCalledTimes(stage === 'translation' && (provider === 'alibabaFree' || provider === 'lingvanexFree') ? 2 : 1);
    });

    it.each(responseStages)('%s %s cancels a late response and preserves owner cancellation if cleanup rejects', async (provider, stage) => {
        installBeforeResponse(provider, stage);
        const controller = new AbortController();
        const reason = new Error('owner cancelled before headers');
        const {response, cancel} = streamingResponse(200);
        cancel.mockImplementationOnce(() => Promise.reject(new Error('cleanup failure')));
        let deliver!: (response: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => {deliver = resolve;}));
        const pending = translateOfficialFreeWebText(provider, 'Hello', 'en', 'zh-Hans', controller.signal)
            .catch(error => error);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        controller.abort(reason);
        deliver(response);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        expect(cancel).toHaveBeenCalledOnce();
        await expect(pending).resolves.toBe(reason);
        expect(fetchMock).toHaveBeenCalledTimes(stage === 'translation' && (provider === 'alibabaFree' || provider === 'lingvanexFree') ? 2 : 1);
    });

    it.each(providers)('%s sends every actual mathematical token intact across bounded requests', async provider => {
        const packet = protectedDocumentLongMathParagraph(), observed: string[] = [];
        fetchMock.mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.endsWith('/csrftoken')) return Response.json({token: 'anonymous-csrf', headerName: 'X-XSRF-TOKEN_PROPERTY_ITEM'});
            if (url === 'https://lingvanex.com/en/translate/') return authPage();
            const text = provider === 'alibabaFree' ? (init!.body as FormData).get('query') as string : (() => {const body = JSON.parse(String(init?.body)); return body.q ?? body.text;})();
            observed.push(text); return response(provider, text);
        });
        const slots = serializeTranslationSlots([packet.text, 'tail'], 'protected-official');
        expect(parseTranslationSlots(slots, await translateOfficialFreeWebText(provider, slots.payload, 'en', 'zh-Hans'))).toEqual([packet.text, 'tail']);
        expect(observed.every(text => [...text].length <= 1000 && !text.includes('___FLUENTREAD'))).toBe(true);
        for (const token of packet.tokens) expect(observed.filter(text => text.includes(token))).toHaveLength(1);
    });

    it.each(providers)('%s 直连官方节点且保留换行、空白和完整文本槽', async provider => {
        install(provider);
        const slots = serializeTranslationSlots([' Hello \r\n World ', '  ', 'Next'], 'official-test');
        const translated = await translateOfficialFreeWebText(provider, slots.payload, 'en', 'zh-Hans');
        expect(parseTranslationSlots(slots, translated)).toEqual([' 中文译文 \r\n 中文译文 ', '  ', '中文译文']);
        const domains = new Set(['translate.alibaba.com', 'webapi.modernmt.com', 'webapi.laratranslate.com', 'lingvanex.com', 'api-b2b.backenster.com']);
        for (const [url, init] of fetchMock.mock.calls) {
            expect(domains.has(new URL(String(url)).hostname)).toBe(true);
            expect(init?.credentials).toBe('omit');
            expect(init?.headers ?? {}).not.toHaveProperty('Cookie');
        }
    });

    it('阿里只接受固定 CSRF 头并用 multipart 正确发送文本和语言', async () => {
        install('alibabaFree');
        await translateOfficialFreeWebText('alibabaFree', 'Hello', 'auto', 'zh-Hant');
        const init = fetchMock.mock.calls[1]![1]!;
        expect(init.headers).toEqual({'X-XSRF-TOKEN_PROPERTY_ITEM': 'anonymous-csrf'});
        expect(init.body).toBeInstanceOf(FormData);
        expect(Object.fromEntries((init.body as FormData).entries())).toEqual({query: 'Hello', srcLang: 'auto', tgtLang: 'zh-tw', domain: 'general', _csrf: 'anonymous-csrf'});
    });

    it('ModernMT 使用官方网页校验且 Lara 拼接完整句子结果', async () => {
        install('modernMtFree');
        await translateOfficialFreeWebText('modernMtFree', 'Hello', 'auto', 'zh');
        expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toMatchObject({q: 'Hello', source: '', target: 'zh-CN', verify: expect.stringMatching(/^[a-f0-9]{32}$/u), ts: expect.any(Number)});
        fetchMock.mockResolvedValue(Response.json({status: 200, content: {translations: [{translation: '第一句。'}, {translation: '第二句。'}]}}));
        await expect(translateOfficialFreeWebText('laraFree', 'First. Second.', 'en', 'zh-cn')).resolves.toBe('第一句。第二句。');
    });

    it('Lingvanex 从官网读取本次网页参数，自动识别来源并映射地区代码', async () => {
        install('lingvanexFree');
        await translateOfficialFreeWebText('lingvanexFree', 'Hello', 'auto', 'zh-Hant');
        expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({text: 'Hello', to: 'zh-Hant_TW', platform: 'dp'});
        expect(fetchMock.mock.calls[1]![1]?.headers).toEqual({'Content-Type': 'application/json', Authorization: 'Bearer public-web-token'});
        await translateOfficialFreeWebText('lingvanexFree', 'Hello', 'en-US', 'ja');
        expect(JSON.parse(String(fetchMock.mock.calls[3]![1]?.body))).toMatchObject({from: 'en_GB', to: 'ja_JP'});
    });

    it.each(providers)('%s 按 Unicode 码点分块并处理普通语言方向', async provider => {
        install(provider);
        await expect(translateOfficialFreeWebText(provider, '😀'.repeat(1001), 'en', 'fr')).resolves.toBe('中文译文中文译文');
        const calls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
        expect(calls).toHaveLength(2);
        const texts = calls.map(([, init]) => init?.body instanceof FormData ? init.body.get('query') : JSON.parse(String(init?.body))[provider === 'lingvanexFree' ? 'text' : 'q']);
        expect(texts).toEqual(['😀'.repeat(1000), '😀']);
    });

    it.each(providers)('%s 不请求空白、相同语言或非法输入', async provider => {
        await expect(translateOfficialFreeWebText(provider, ' \r\n', 'auto', 'zh')).resolves.toBe(' \r\n');
        await expect(translateOfficialFreeWebText(provider, 'Hello', 'en', 'en')).resolves.toBe('Hello');
        for (const [text, from, to] of [[42, 'en', 'zh'], ['Hello', 'en', 'auto'], ['Hello', 'bad@lang', 'zh'], ['Hello', 'en', '']]) {
            await expect(translateOfficialFreeWebText(provider, text as string, String(from), String(to))).rejects.toMatchObject({statusCode: 400, freeFailure: 'request'});
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('Lingvanex 未映射的语言由免费池换线，不发送错误代码', async () => {
        await expect(translateOfficialFreeWebText('lingvanexFree', 'Hello', 'en', 'xx')).rejects.toMatchObject({statusCode: 400, freeFailure: 'request'});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['modernMtFree', 'laraFree'] as const)('%s 显式保留繁体目标语言', async provider => {
        install(provider);
        await translateOfficialFreeWebText(provider, 'Hello', 'en', 'zh-Hant');
        expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).target).toBe('zh-TW');
    });

    it.each(providers)('%s 拒绝空译文及 malformed 响应', async provider => {
        for (const value of ['', null, 123, '   ']) {
            install(provider);
            const setup = provider === 'alibabaFree' || provider === 'lingvanexFree';
            if (setup) fetchMock.mockResolvedValueOnce(provider === 'alibabaFree' ? Response.json({token: 'anonymous-csrf', headerName: 'X-XSRF-TOKEN_PROPERTY_ITEM'}) : authPage());
            fetchMock.mockResolvedValueOnce(response(provider, value));
            await expect(translateOfficialFreeWebText(provider, 'Hello', 'en', 'zh')).rejects.toMatchObject({freeFailure: 'unavailable'});
        }
    });

    it.each([null, {}, {token: 'secret', headerName: 'Authorization'}, {token: '\r\nunsafe', headerName: 'X-XSRF-TOKEN_PROPERTY_ITEM'}])('阿里拒绝错误的网页参数 %#', async value => {
        fetchMock.mockResolvedValue(Response.json(value));
        await expect(translateOfficialFreeWebText('alibabaFree', 'Hello', 'en', 'zh')).rejects.toMatchObject({statusCode: 502});
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it.each([null, {}, {status: 200}, {status: 200, content: {translations: []}}, {status: 200, content: {translations: [null]}}])('Lara 拒绝不完整结果 %#', async value => {
        fetchMock.mockResolvedValue(Response.json(value));
        await expect(translateOfficialFreeWebText('laraFree', 'Hello', 'en', 'zh')).rejects.toMatchObject({statusCode: 502});
    });

    it.each([400, 401, 402, 429, 456, 503])('业务状态 %s 正确分类且不泄漏正文', async status => {
        for (const provider of providers) {
            fetchMock.mockReset(); install(provider);
            if (provider === 'alibabaFree') fetchMock.mockResolvedValueOnce(Response.json({token: 'anonymous-csrf', headerName: 'X-XSRF-TOKEN_PROPERTY_ITEM'}));
            if (provider === 'lingvanexFree') fetchMock.mockResolvedValueOnce(authPage());
            fetchMock.mockResolvedValueOnce(Response.json(provider === 'alibabaFree' ? {success: false, httpStatusCode: status, message: 'private text'}
                : provider === 'lingvanexFree' ? {err: {code: status, message: 'private text'}} : {status, message: 'private text'}));
            const error = await translateOfficialFreeWebText(provider, 'Hello', 'en', 'zh').catch(error => error);
            expect(error.statusCode).toBe(status);
            expect(error.message).not.toContain('private');
        }
    });

    it.each(providers)('%s 保留 HTTP Retry-After 和 JSON 安全错误', async provider => {
        fetchMock.mockResolvedValue(new Response('private text', {status: 429, headers: {'Retry-After': '60'}}));
        await expect(translateOfficialFreeWebText(provider, 'Hello', 'en', 'zh')).rejects.toMatchObject({statusCode: 429, retryAfterMs: 60000});
        fetchMock.mockResolvedValue(new Response('private text'));
        await expect(translateOfficialFreeWebText(provider, 'Hello', 'en', 'zh')).rejects.not.toThrow('private');
    });

    it.each(providers)('%s 取消后不请求下一块或读取迟到结果', async provider => {
        const controller = new AbortController(); controller.abort();
        await expect(translateOfficialFreeWebText(provider, 'Hello', 'en', 'zh', controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(fetchMock).not.toHaveBeenCalled();
        const later = new AbortController();
        fetchMock.mockImplementation(async () => {later.abort(); return response(provider);});
        await expect(translateOfficialFreeWebText(provider, 'Hello', 'en', 'zh', later.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('provider 请求边界传递冻结语言与取消信号', async () => {
        install('modernMtFree'); const controller = new AbortController();
        await expect(translateOfficialFreeWebProvider('modernMtFree', {origin: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh-Hans', abortSignal: controller.signal})).resolves.toBe('中文译文');
        expect(fetchMock.mock.calls[0]![1]?.signal).toBe(controller.signal);
    });
});

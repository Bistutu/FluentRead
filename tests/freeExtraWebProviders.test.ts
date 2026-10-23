import {protectedDocumentLongMathParagraph} from './fixtures/documentLongMathParagraph';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {translateExtraFreeWebText, isKnownUnsupportedApertiumDirection} from '@/src/providers/translation/free-extra-web';
import {setRuntimeFetch} from '@/src/platform/http/runtime';
import {serializeTranslationSlots, parseTranslationSlots} from '@/src/core/translation/serialization';

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); setRuntimeFetch(fetchMock); });
afterEach(() => setRuntimeFetch());

function home() { return new Response('<script>window.__INITIAL_STATE__={"common":{"CONFIG":{"secretCode":109984457}}}</script>'); }
function result(text: string) { return Response.json({status: 0, data: {translate: {dit: `译:${text}`}}}); }

const responseStages = [
    ['sogouFree', 'home'], ['sogouFree', 'translation'],
    ['reversoFree', 'translation'],
    ['apertiumFree', 'pairs'], ['apertiumFree', 'translation'],
] as const;

function installBeforeResponse(id: typeof responseStages[number][0], stage: typeof responseStages[number][1]): void {
    if (id === 'sogouFree' && stage === 'translation') fetchMock.mockResolvedValueOnce(home());
    if (id === 'apertiumFree' && stage === 'translation') fetchMock.mockResolvedValueOnce(Response.json(['eng-spa']));
}

function streamingResponse(status: number) {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({start(controller) {body = controller;}, cancel}), {
        status, headers: {'Retry-After': '60'},
    });
    return {response, body, cancel};
}

describe('extra anonymous web providers', () => {
    it.each(responseStages)('%s %s cancels a streaming HTTP failure without waiting for EOF or cleanup', async (id, stage) => {
        installBeforeResponse(id, stage);
        const {response, cancel} = streamingResponse(429);
        fetchMock.mockResolvedValueOnce(response);
        const pending = translateExtraFreeWebText(id, 'Hello', 'en', id === 'apertiumFree' ? 'es' : 'zh-Hans')
            .catch(error => error);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        expect(cancel).toHaveBeenCalledOnce();
        await expect(pending).resolves.toMatchObject({statusCode: 429, retryAfterMs: 60000});
        expect(fetchMock).toHaveBeenCalledTimes(stage === 'translation' && (id === 'sogouFree' || id === 'apertiumFree') ? 2 : 1);
    });

    it.each(responseStages)('%s %s cancels a late response and preserves owner cancellation if cleanup rejects', async (id, stage) => {
        installBeforeResponse(id, stage);
        const controller = new AbortController();
        const reason = new Error('owner cancelled before headers');
        const {response, cancel} = streamingResponse(200);
        cancel.mockImplementationOnce(() => Promise.reject(new Error('cleanup failure')));
        let deliver!: (response: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => {deliver = resolve;}));
        const pending = translateExtraFreeWebText(id, 'Hello', 'en', id === 'apertiumFree' ? 'es' : 'zh-Hans', controller.signal)
            .catch(error => error);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        controller.abort(reason);
        deliver(response);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        expect(cancel).toHaveBeenCalledOnce();
        await expect(pending).resolves.toBe(reason);
        expect(fetchMock).toHaveBeenCalledTimes(stage === 'translation' && (id === 'sogouFree' || id === 'apertiumFree') ? 2 : 1);
    });

    it('Reverso sends the actual long mathematical paragraph with complete protection tokens per request', async () => {
        const packet = protectedDocumentLongMathParagraph(), observed: string[] = [];
        fetchMock.mockImplementation(async (_url, init) => {
            const text = JSON.parse(String(init?.body)).input;
            observed.push(text); return Response.json({translation: [text]});
        });
        const slots = serializeTranslationSlots([packet.text, 'tail'], 'protected-extra');
        expect(parseTranslationSlots(slots, await translateExtraFreeWebText('reversoFree', slots.payload, 'en', 'zh-Hans'))).toEqual([packet.text, 'tail']);
        expect(observed.every(text => [...text].length <= 1000 && !text.includes('___FLUENTREAD'))).toBe(true);
        for (const token of packet.tokens) expect(observed.filter(text => text.includes(token))).toHaveLength(1);
    });

    it('uses the current Sogou page secret and signed text protocol', async () => {
        fetchMock.mockResolvedValueOnce(home()).mockResolvedValueOnce(result('Hello'));
        await expect(translateExtraFreeWebText('sogouFree', 'Hello', 'en', 'zh-Hans')).resolves.toBe('译:Hello');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const init = fetchMock.mock.calls[1]![1]!;
        expect(init).toMatchObject({method: 'POST', credentials: 'omit'});
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({from: 'en', to: 'zh-CHS', text: 'Hello', client: 'pc', fr: 'browser_pc', needQc: 1});
        expect(body.s).toMatch(/^[a-f0-9]{32}$/u);
        expect(body.uuid).toMatch(/^[0-9a-f-]{36}$/u);
        fetchMock.mockReset().mockResolvedValueOnce(home()).mockResolvedValueOnce(result('Auto'));
        await translateExtraFreeWebText('sogouFree', 'Hello', 'auto', 'zh-Hans');
        expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body)).from).toBe('auto');
    });

    it('preserves whitespace, line breaks and serialized slots', async () => {
        fetchMock.mockImplementation(async (url) => String(url) === 'https://translate.sogou.com/' ? home() : result(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).text));
        const input = '  Hello\r\nBye  ';
        await expect(translateExtraFreeWebText('sogouFree', input, 'en', 'zh-Hans')).resolves.toBe('  译:Hello\r\n译:Bye  ');
        fetchMock.mockReset();
        fetchMock.mockImplementation(async (url, init) => String(url) === 'https://translate.sogou.com/' ? home() : result(JSON.parse(String(init?.body)).text));
        const slots = serializeTranslationSlots(['Hello', 'Bye'], 'extra-test');
        const output = await translateExtraFreeWebText('sogouFree', slots.payload, 'en', 'zh-Hans');
        expect(parseTranslationSlots(slots, output)).toEqual(['译:Hello', '译:Bye']);
    });

    it('rejects unsupported candidates explicitly and honors pre-abort', async () => {
        fetchMock.mockResolvedValueOnce(new Response('', {status: 403}));
        await expect(translateExtraFreeWebText('reversoFree', 'Hello', 'en', 'zh-Hans')).rejects.toMatchObject({statusCode: 403});
        fetchMock.mockClear();
        const controller = new AbortController(); controller.abort();
        await expect(translateExtraFreeWebText('sogouFree', 'Hello', 'en', 'zh-Hans', controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ['reversoFree', Response.json({translation: ['translated']})],
    ] as const)('%s accepts its public response shape', async (id, response) => {
        fetchMock.mockResolvedValueOnce(response);
        await expect(translateExtraFreeWebText(id, 'Hello', 'en', 'zh-Hans')).resolves.toBe('translated');
        expect(fetchMock.mock.calls[0]![1]).toMatchObject({credentials: 'omit'});
    });

    it('Apertium checks its dynamic language-pair list before translating', async () => {
        fetchMock.mockResolvedValueOnce(Response.json(['eng-spa'])).mockResolvedValueOnce(Response.json({responseStatus: 200, responseData: {translatedText: 'Hola'}}));
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'es')).resolves.toBe('Hola');
        expect(String(fetchMock.mock.calls[0]![0])).toContain('/apy/listPairs');
        expect(String(fetchMock.mock.calls[1]![0])).toContain('langpair=eng%7Cspa');
        fetchMock.mockReset().mockResolvedValueOnce(Response.json({responseData: {['eng-spa']: {}}})).mockResolvedValueOnce(Response.json({responseStatus: 200, responseData: {translatedText: 'Hola'}}));
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'es')).resolves.toBe('Hola');
        fetchMock.mockReset().mockResolvedValueOnce(Response.json([{sourceLanguage: 'eng', targetLanguage: 'spa'}])).mockResolvedValueOnce(Response.json({responseStatus: 200, responseData: {translatedText: 'Hola'}}));
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'es')).resolves.toBe('Hola');
        fetchMock.mockReset().mockResolvedValueOnce(Response.json([null, {langpair: 'eng-spa'}])).mockResolvedValueOnce(Response.json({responseStatus: 200, responseData: {translatedText: 'Hola'}}));
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'es')).resolves.toBe('Hola');
    });

    it.each(['reversoFree', 'apertiumFree'] as const)('%s rejects malformed or failed business responses', async id => {
        if (id === 'apertiumFree') {
            fetchMock.mockResolvedValueOnce(Response.json(['eng-spa'])).mockResolvedValueOnce(Response.json({responseStatus: 500}));
            await expect(translateExtraFreeWebText(id, 'Hello', 'en', 'es')).rejects.toMatchObject({statusCode: 502});
        } else {
            fetchMock.mockResolvedValueOnce(Response.json({translation: []}));
            await expect(translateExtraFreeWebText(id, 'Hello', 'en', 'zh-Hans')).rejects.toMatchObject({statusCode: 502});
        }
    });

    it.each(['reversoFree', 'apertiumFree'] as const)('%s propagates HTTP failures', async id => {
        if (id === 'apertiumFree') fetchMock.mockResolvedValueOnce(new Response('', {status: 503}));
        else fetchMock.mockResolvedValueOnce(new Response('', {status: 403}));
        await expect(translateExtraFreeWebText(id, 'Hello', 'en', id === 'apertiumFree' ? 'es' : 'zh-Hans')).rejects.toMatchObject({statusCode: id === 'apertiumFree' ? 503 : 403});
    });

    it('rejects unsupported Apertium pairs before the translation request', async () => {
        fetchMock.mockResolvedValueOnce(Response.json(['eng-spa']));
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'zh-Hans')).rejects.toMatchObject({statusCode: 400, freeFailure: 'request'});
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('maps language codes and rejects auto targets without network', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({translation: ['ok']}));
        await translateExtraFreeWebText('reversoFree', 'Hello', 'en', 'zh-CN');
        expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({from: 'eng', to: 'chi', options: {languageDetection: true, contextResults: true, origin: 'translation.web'}});
        expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({'x-reverso-origin': 'translation.web'});
        fetchMock.mockClear();
        await expect(translateExtraFreeWebText('reversoFree', 'Hello', 'en', 'auto')).rejects.toMatchObject({statusCode: 400, freeFailure: 'request'});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('classifies HTTP failures and malformed Sogou bootstrap/results', async () => {
        fetchMock.mockResolvedValueOnce(new Response('', {status: 429}));
        await expect(translateExtraFreeWebText('sogouFree', 'Hello', 'en', 'zh-Hans')).rejects.toMatchObject({statusCode: 429});
        fetchMock.mockReset().mockResolvedValueOnce(new Response('<html>no secret</html>'));
        await expect(translateExtraFreeWebText('sogouFree', 'Hello', 'en', 'zh-Hans')).rejects.toMatchObject({statusCode: 502, freeFailure: 'unavailable'});
        fetchMock.mockReset().mockResolvedValueOnce(home()).mockResolvedValueOnce(Response.json({status: 0, data: {translate: {dit: ''}}}));
        await expect(translateExtraFreeWebText('sogouFree', 'Hello', 'en', 'zh-Hans')).rejects.toMatchObject({statusCode: 502});
        fetchMock.mockReset().mockResolvedValueOnce(home()).mockResolvedValueOnce(new Response('', {status: 503}));
        await expect(translateExtraFreeWebText('sogouFree', 'Hello', 'en', 'zh-Hans')).rejects.toMatchObject({statusCode: 503});
        fetchMock.mockReset().mockResolvedValueOnce(home()).mockResolvedValueOnce(Response.json({status: 1}));
        await expect(translateExtraFreeWebText('sogouFree', 'Hello', 'en', 'zh-Hans')).rejects.toMatchObject({freeFailure: 'unavailable'});
    });

    it('reports Sogou inner business errors even when its outer status is successful', async () => {
        fetchMock.mockResolvedValueOnce(home()).mockResolvedValueOnce(Response.json({status: 0, data: {translate: {errorCode: 's10', dit: ''}}}));
        await expect(translateExtraFreeWebText('sogouFree', 'Hello', 'en', 'zh-Hans')).rejects.toThrow('错误码 s10');
        fetchMock.mockReset().mockResolvedValueOnce(home()).mockResolvedValueOnce(Response.json({status: '0', data: {translate: {errorCode: 's0', dit: '你好'}}}));
        await expect(translateExtraFreeWebText('sogouFree', 'Hello', 'en', 'zh-Hans')).resolves.toBe('你好');
        fetchMock.mockReset().mockResolvedValueOnce(home()).mockResolvedValueOnce(Response.json({status: 0, data: {translate: {errorCode: 'secret arbitrary body', dit: ''}}}));
        await expect(translateExtraFreeWebText('sogouFree', 'Hello', 'en', 'zh-Hans')).rejects.toThrow('结果为空');
    });

    it('covers provider language mappings and empty results', async () => {
        fetchMock.mockReset().mockResolvedValueOnce(home()).mockResolvedValueOnce(result('繁'));
        await translateExtraFreeWebText('sogouFree', 'Hello', 'en', 'zh-TW');
        fetchMock.mockReset().mockResolvedValueOnce(Response.json({translation: ['ok']}));
        await translateExtraFreeWebText('reversoFree', 'Hello', 'xx', 'en');
        fetchMock.mockReset().mockResolvedValueOnce(Response.json({translation: []}));
        await expect(translateExtraFreeWebText('reversoFree', 'Hello', 'en', 'zh-Hant')).rejects.toMatchObject({statusCode: 400, freeFailure: 'request'});
        fetchMock.mockReset().mockResolvedValueOnce(Response.json(['eng-spa'])).mockResolvedValueOnce(new Response('', {status: 503}));
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'es')).rejects.toMatchObject({statusCode: 503});
    });

    it('handles blank and invalid top-level input', async () => {
        await expect(translateExtraFreeWebText('sogouFree', 1 as unknown as string, 'en', 'zh-Hans')).rejects.toMatchObject({statusCode: 400});
        await expect(translateExtraFreeWebText('sogouFree', ' \r\n ', 'en', 'zh-Hans')).resolves.toBe(' \r\n ');
    });

    it('cancels during a response and chunks long text for each protocol', async () => {
        const controller = new AbortController();
        fetchMock.mockResolvedValueOnce(home()).mockImplementationOnce(async () => { controller.abort(); return result('late'); });
        await expect(translateExtraFreeWebText('sogouFree', 'Hello', 'en', 'zh-Hans', controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        fetchMock.mockReset().mockImplementation(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            return Response.json({translation: [body.input]});
        });
        const output = await translateExtraFreeWebText('reversoFree', 'x'.repeat(1001), 'en', 'zh-Hans');
        expect(output).toBe('x'.repeat(1001));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('Apertium 已确认不支持的方向', () => {
    let clock = Date.now();
    beforeEach(() => {
        // 每个用例都跨过前一个方向记忆的有效期，避免测试间共享能力观测。
        clock = Math.max(clock, Date.now()) + 5 * 60_000 + 1;
        vi.useFakeTimers();
        vi.setSystemTime(clock);
    });
    afterEach(() => vi.useRealTimers());

    it('有效列表确认不支持后不再外发，同义语言码共用方向，其他方向照常翻译', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({responseStatus: 200, responseData: [{sourceLanguage: 'eng', targetLanguage: 'spa'}]}));
        await expect(translateExtraFreeWebText('apertiumFree', 'Original prose', 'en', 'zh-Hans')).rejects.toMatchObject({statusCode: 400, freeFailure: 'request'});
        expect(isKnownUnsupportedApertiumDirection('en', 'zh_CN')).toBe(true);
        await expect(translateExtraFreeWebText('apertiumFree', 'Different prose', 'en', 'zh-CN')).rejects.toMatchObject({statusCode: 400, freeFailure: 'request'});
        expect(fetchMock).toHaveBeenCalledOnce();

        fetchMock.mockResolvedValueOnce(Response.json(['eng-spa'])).mockResolvedValueOnce(Response.json({responseStatus: 200, responseData: {translatedText: 'Hola'}}));
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'es')).resolves.toBe('Hola');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(isKnownUnsupportedApertiumDirection('en', 'es')).toBe(false);
    });

    it('到期重新读取动态列表并恢复已新增的方向，不延长请求预算', async () => {
        fetchMock.mockResolvedValueOnce(Response.json(['eng-spa']));
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'zh-Hans')).rejects.toMatchObject({freeFailure: 'request'});
        vi.setSystemTime(clock + 5 * 60_000 - 1);
        expect(isKnownUnsupportedApertiumDirection('en', 'zh-Hans')).toBe(true);
        vi.setSystemTime(clock + 5 * 60_000);
        expect(isKnownUnsupportedApertiumDirection('en', 'zh-Hans')).toBe(false);
        fetchMock.mockResolvedValueOnce(Response.json(['eng|zh'])).mockResolvedValueOnce(Response.json({responseStatus: 200, responseData: {translatedText: '你好'}}));
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'zh-Hans')).resolves.toBe('你好');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('并发负观测不能中断已验证方向的后续分块，新的请求仍按负缓存拒绝', async () => {
        let releaseFirst!: () => void;
        let firstStarted!: () => void;
        const started = new Promise<void>(resolve => { firstStarted = resolve; });
        const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
        let lists = 0;
        fetchMock.mockImplementation(async url => {
            const request = new URL(String(url));
            if (request.pathname.endsWith('/listPairs')) {
                lists += 1;
                return Response.json(lists === 1 ? ['eng-spa'] : ['fra-eng']);
            }
            const text = request.searchParams.get('q');
            if (text === 'x'.repeat(1000)) {
                firstStarted();
                await firstResponse;
            }
            return Response.json({responseStatus: 200, responseData: {translatedText: text === 'x' ? 'segundo' : 'primero'}});
        });
        const active = translateExtraFreeWebText('apertiumFree', 'x'.repeat(1001), 'en', 'es')
            .then(value => ({value, error: null}), error => ({value: null, error}));
        await started;
        try {
            await expect(translateExtraFreeWebText('apertiumFree', 'Other text', 'en', 'es'))
                .rejects.toMatchObject({statusCode: 400, freeFailure: 'request'});
            expect(isKnownUnsupportedApertiumDirection('en', 'es')).toBe(true);
        } finally {
            releaseFirst();
        }
        expect(await active).toEqual({value: 'primerosegundo', error: null});
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
            '/apy/listPairs', '/apy/translate', '/apy/listPairs', '/apy/translate',
        ]);
        await expect(translateExtraFreeWebText('apertiumFree', 'New text', 'en', 'es'))
            .rejects.toMatchObject({statusCode: 400, freeFailure: 'request'});
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it.each([
        {body: null},
        {body: {responseData: null}},
        {body: {responseData: {error: 'unknown shape'}}},
        {body: ['invalid pair']},
        {body: [null, {langpair: 'eng-spa'}]},
        {body: [{langpair: 'invalid pair'}]},
        {body: {responseStatus: 500, responseData: ['eng-spa']}},
    ])('畸形或业务失败列表不记忆为不支持 %#', async ({body}) => {
        fetchMock.mockResolvedValueOnce(Response.json(body));
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'zh-Hans')).rejects.toMatchObject({freeFailure: 'request'});
        expect(isKnownUnsupportedApertiumDirection('en', 'zh-Hans')).toBe(false);
        fetchMock.mockResolvedValueOnce(Response.json(['eng|zh'])).mockResolvedValueOnce(Response.json({responseStatus: 200, responseData: {translatedText: '你好'}}));
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'zh-Hans')).resolves.toBe('你好');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it.each(['fetch', 'json'])('语言列表在 %s 期间被取消时不污染后续请求', async phase => {
        const owner = new AbortController();
        const reason = new Error('真实取消');
        const response = Response.json(['eng-spa']);
        if (phase === 'json') vi.spyOn(response, 'json').mockImplementationOnce(async () => {
            owner.abort(reason);
            return ['eng-spa'];
        });
        fetchMock.mockImplementationOnce(async () => {
            if (phase === 'fetch') owner.abort(reason);
            return response;
        });
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'zh-Hans', owner.signal)).rejects.toBe(reason);
        expect(isKnownUnsupportedApertiumDirection('en', 'zh-Hans')).toBe(false);
        fetchMock.mockResolvedValueOnce(Response.json(['eng|zh'])).mockResolvedValueOnce(Response.json({responseStatus: 200, responseData: {translatedText: '你好'}}));
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'zh-Hans')).resolves.toBe('你好');
    });

    it('方向记忆最多 32 项，淘汰最早结果后允许重新探测', async () => {
        fetchMock.mockImplementation(async () => Response.json(['eng-spa']));
        for (let index = 0; index < 33; index += 1) {
            await expect(translateExtraFreeWebText('apertiumFree', 'Hello', `zz${index}`, 'es')).rejects.toMatchObject({freeFailure: 'request'});
        }
        expect(isKnownUnsupportedApertiumDirection('zz0', 'es')).toBe(false);
        expect(isKnownUnsupportedApertiumDirection('zz32', 'es')).toBe(true);
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'zz0', 'es')).rejects.toMatchObject({freeFailure: 'request'});
        expect(fetchMock).toHaveBeenCalledTimes(34);
    });

    it('已知不支持时仍优先传递调用方真实取消，不向外发送请求', async () => {
        fetchMock.mockResolvedValueOnce(Response.json(['eng-spa']));
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'zh-Hans')).rejects.toMatchObject({freeFailure: 'request'});
        const owner = new AbortController();
        const reason = new Error('真实取消');
        owner.abort(reason);
        await expect(translateExtraFreeWebText('apertiumFree', 'Hello', 'en', 'zh-Hans', owner.signal)).rejects.toBe(reason);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(isKnownUnsupportedApertiumDirection('en', 'auto')).toBe(false);
    });

    it('其他受支持方向保留槽序、换行、边缘空白和原始序列化正文', async () => {
        const packet = serializeTranslationSlots(['  Hello\nBye  ', 'World'], 'apertium-originals');
        const original = packet.payload;
        fetchMock.mockResolvedValueOnce(Response.json(['eng-spa']));
        for (const translatedText of ['Hola', 'Adios', 'Mundo']) {
            fetchMock.mockResolvedValueOnce(Response.json({responseStatus: 200, responseData: {translatedText}}));
        }
        const translated = await translateExtraFreeWebText('apertiumFree', packet.payload, 'en', 'es');
        expect(parseTranslationSlots(packet, translated)).toEqual(['  Hola\nAdios  ', 'Mundo']);
        expect(packet.payload).toBe(original);
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/listPairs'))).toHaveLength(1);
    });
});

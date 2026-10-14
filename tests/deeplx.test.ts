import {withProviderSnapshot} from './helpers/providerSnapshot';
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const {mockConfig} = vi.hoisted(() => ({
    mockConfig: {
        from: "auto",
        to: "zh-Hans",
        service: "deeplx",
        deeplx: "",
        proxy: {} as Record<string, string>,
        token: {} as Record<string, string>,
    },
}));

vi.mock("@/src/services/config/store", () => ({config: mockConfig}));

import deeplx, {
    getDeepLXRequestLanguages,
    translateDeepLXText,
} from "@/src/providers/translation/deeplx";
import {setRuntimeFetch} from '@/src/platform/http/runtime';
import {ONESHOT_FREE_ENDPOINT} from '@deeplx/core';
import {DEFAULT_DEEPLX_ENDPOINT, getDeepLXEndpoints, requiresDeepLXToken} from '@/src/core/config/deeplx';

const FANYIMAO_ENDPOINT = 'https://freeapi.fanyimao.cn/translate?token={{apiKey}}';
const DEEPLX_COMMUNITY_ENDPOINT = 'https://api.deeplx.org/{{apiKey}}/translate';

const fetchMock = vi.fn<typeof fetch>();

function mockResponse(body: unknown, overrides: Partial<Response> = {}): Response {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: vi.fn().mockResolvedValue(JSON.stringify(body)),
        ...overrides,
    } as unknown as Response;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => {resolve = complete;});
    return {promise, resolve};
}

beforeEach(() => {
    fetchMock.mockReset();
    mockConfig.from = "auto";
    mockConfig.to = "zh-Hans";
    mockConfig.deeplx = DEFAULT_DEEPLX_ENDPOINT;
    mockConfig.proxy = {};
    mockConfig.token = {};
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    setRuntimeFetch();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("DeepLX endpoint configuration", () => {
    it("uses the verified public endpoint when no URL is configured", () => {
        expect(getDeepLXEndpoints("", "")).toEqual([DEFAULT_DEEPLX_ENDPOINT]);
        expect(requiresDeepLXToken('', '')).toBe(false);
        expect(requiresDeepLXToken('https://self-hosted.example/translate', '')).toBe(false);
    });

    it("parses comma- and newline-separated URLs and gives proxy URLs priority", () => {
        expect(getDeepLXEndpoints("https://one.example/translate,\nhttps://two.example/translate", ""))
            .toEqual(["https://one.example/translate", "https://two.example/translate"]);
        expect(getDeepLXEndpoints("https://configured.example/translate", "https://proxy.example/translate"))
            .toEqual(["https://proxy.example/translate"]);
    });

    it("resolves token placeholders without returning a secret in the configured URL", () => {
        expect(getDeepLXEndpoints(FANYIMAO_ENDPOINT, "", "site-token"))
            .toEqual(["https://freeapi.fanyimao.cn/translate?token=site-token"]);
        expect(() => getDeepLXEndpoints(DEEPLX_COMMUNITY_ENDPOINT, "", ""))
            .toThrow('DeepLX 地址包含 {{apiKey}} 或 {{token}} 占位符');
        expect(requiresDeepLXToken(DEEPLX_COMMUNITY_ENDPOINT, '')).toBe(true);
        expect(requiresDeepLXToken('https://self-hosted.example/translate', DEEPLX_COMMUNITY_ENDPOINT)).toBe(true);
    });

    it('空 Key 跳过混合列表中的占位符地址，但不绕过 proxy 或回落默认公共地址', () => {
        expect(getDeepLXEndpoints(`${DEEPLX_COMMUNITY_ENDPOINT},https://public.example/translate`, '', ''))
            .toEqual(['https://public.example/translate']);
        expect(getDeepLXEndpoints('https://configured.example/translate', `${DEEPLX_COMMUNITY_ENDPOINT},https://proxy.example/translate`, ''))
            .toEqual(['https://proxy.example/translate']);
        expect(requiresDeepLXToken('https://configured.example/translate', `${DEEPLX_COMMUNITY_ENDPOINT},https://proxy.example/translate`)).toBe(false);
        expect(() => getDeepLXEndpoints('https://configured.example/translate', DEEPLX_COMMUNITY_ENDPOINT, ''))
            .toThrow('DeepLX 地址包含 {{apiKey}} 或 {{token}} 占位符');
    });
});

describe("DeepLX adapter", () => {
    it.each(['', DEFAULT_DEEPLX_ENDPOINT])('默认配置 %s 通过 core 直连，使用 runtime transport 并跳过 cookie 预热', async endpoint => {
        mockConfig.deeplx = endpoint;
        const transport = vi.fn(async () => new Response(JSON.stringify({translations: [{text: '你好'}]})));
        setRuntimeFetch(transport);

        await expect(deeplx(withProviderSnapshot({origin: 'Hello'}, mockConfig))).resolves.toBe('你好');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(transport).toHaveBeenCalledOnce();
        const [url, init] = transport.mock.calls[0] as unknown as Parameters<typeof fetch>;
        expect(url).toBe(ONESHOT_FREE_ENDPOINT);
        expect(JSON.parse(String(init?.body))).toMatchObject({text: ['Hello'], target_lang: 'zh-Hans'});
        expect(JSON.parse(String(init?.body))).not.toHaveProperty('source_lang');
        expect(new Headers(init?.headers).get('Cookie')).toBeNull();
        expect(new Headers(init?.headers).get('Authorization')).toBe('None');
        expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('直连失败后才请求公共备用端点，且不泄露错误正文', async () => {
        fetchMock.mockResolvedValueOnce(new Response('private original or credentials', {status: 429}))
            .mockResolvedValueOnce(mockResponse({code: 200, data: '备用译文'}));
        await expect(deeplx(withProviderSnapshot({origin: 'Hello'}, mockConfig))).resolves.toBe('备用译文');
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([ONESHOT_FREE_ENDPOINT, DEFAULT_DEEPLX_ENDPOINT]);
        expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({text: 'Hello'});
    });

    it('直连严格检查响应条数/译文，并安全聚合错误状态', async () => {
        for (const body of [{translations: []}, {translations: [{text: ' '}]}, {translations: [{text: 'one'}, {text: 'two'}]}]) {
            fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)))
                .mockResolvedValueOnce(mockResponse({code: 200, data: '备用译文'}));
            await expect(deeplx(withProviderSnapshot({origin: 'Hello'}, mockConfig))).resolves.toBe('备用译文');
        }
        fetchMock.mockResolvedValueOnce(new Response('secret response', {status: 429}))
            .mockResolvedValueOnce(mockResponse({}, {ok: false, status: 429}));
        const request = deeplx(withProviderSnapshot({origin: 'secret original'}, mockConfig));
        await expect(request).rejects.toMatchObject({statusCode: 429});
        await expect(request).rejects.not.toThrow('secret');
    });

    it('长文本按 1500 UTF-16 顺序直连，完整保留换行/空白/术语与代理对', async () => {
        const source = '  ' + '😀'.repeat(740) + '__FRTERM_abc_0__' + 'a'.repeat(40) + '\r\n\tend  ';
        const texts: string[] = [];
        fetchMock.mockImplementation(async (_url, init) => {
            const text = JSON.parse(String(init?.body)).text[0];
            texts.push(text);
            return new Response(JSON.stringify({translations: [{text}]}));
        });
        await expect(deeplx(withProviderSnapshot({origin: source}, mockConfig))).resolves.toBe(source);
        expect(texts.length).toBeGreaterThan(1);
        expect(texts.every(text => text.length <= 1500 && !/[\uD800-\uDBFF]$/u.test(text) && !/^[\uDC00-\uDFFF]/u.test(text))).toBe(true);
        expect(texts.filter(text => text.includes('__FRTERM_abc_0__'))).toHaveLength(1);
        expect(fetchMock.mock.calls.every(([url]) => url === ONESHOT_FREE_ENDPOINT)).toBe(true);
    });

    it('某块直连失败后将整条原文交给备用端点，不提交部分译文', async () => {
        const source = 'a'.repeat(1600);
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({translations: [{text: 'partial'}]})))
            .mockRejectedValueOnce(new Error('network secret'))
            .mockResolvedValueOnce(mockResponse({code: 200, data: '整条备用译文'}));
        await expect(deeplx(withProviderSnapshot({origin: source}, mockConfig))).resolves.toBe('整条备用译文');
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([ONESHOT_FREE_ENDPOINT, ONESHOT_FREE_ENDPOINT, DEFAULT_DEEPLX_ENDPOINT]);
        expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).text).toBe(source);
    });

    it('直连不覆盖显式代理或令牌配置', async () => {
        mockConfig.proxy = {deeplx: 'https://proxy.example/translate'};
        fetchMock.mockResolvedValue(mockResponse({code: 200, data: '代理译文'}));
        await expect(deeplx(withProviderSnapshot({origin: 'Hello'}, mockConfig))).resolves.toBe('代理译文');
        expect(fetchMock.mock.calls[0]?.[0]).toBe('https://proxy.example/translate');
    });

    it('显式多端点中的缺 Key 地址被跳过时，仍保留用户指定的线路', async () => {
        mockConfig.deeplx = DEFAULT_DEEPLX_ENDPOINT + ',https://private.example/{{apiKey}}/translate';
        fetchMock.mockResolvedValue(mockResponse({code: 200, data: '指定端点译文'}));
        await expect(deeplx(withProviderSnapshot({origin: 'Hello'}, mockConfig))).resolves.toBe('指定端点译文');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0]?.[0]).toBe(DEFAULT_DEEPLX_ENDPOINT);
    });

    it('直连超时会中止响应读取，再使用备用端点', async () => {
        vi.useFakeTimers();
        let signal: AbortSignal | undefined;
        fetchMock.mockImplementationOnce(async (_url, init) => {
            signal = init?.signal ?? undefined;
            return {ok: true, clone: () => ({text: () => new Promise((_resolve, reject) => {
                if (signal?.aborted) reject(signal.reason);
                else signal?.addEventListener('abort', () => reject(signal?.reason), {once: true});
            })})} as Response;
        }).mockResolvedValueOnce(mockResponse({code: 200, data: '备用译文'}));
        const request = deeplx(withProviderSnapshot({origin: 'Hello'}, mockConfig));
        await vi.advanceTimersByTimeAsync(7999);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(request).resolves.toBe('备用译文');
        expect(signal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('直连在请求前、请求中或迟到响应后的取消都不会继续切块或回退', async () => {
        const early = new AbortController(); early.abort();
        await expect(deeplx(withProviderSnapshot({origin: 'Hello', abortSignal: early.signal}, mockConfig))).rejects.toMatchObject({name: 'AbortError'});
        expect(fetchMock).not.toHaveBeenCalled();
        const pending = new AbortController();
        fetchMock.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {once: true});
        }));
        const request = deeplx(withProviderSnapshot({origin: 'Hello', abortSignal: pending.signal}, mockConfig));
        pending.abort(new Error('caller stopped'));
        await expect(request).rejects.toThrow('caller stopped');
        expect(fetchMock).toHaveBeenCalledOnce();
        const late = new AbortController();
        fetchMock.mockImplementationOnce(async () => {
            late.abort();
            return new Response(JSON.stringify({translations: [{text: 'late'}]}));
        });
        await expect(deeplx(withProviderSnapshot({origin: 'a'.repeat(1600), abortSignal: late.signal}, mockConfig))).rejects.toMatchObject({name: 'AbortError'});
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('空白文本无需网络且再次翻译不沿用旧请求状态', async () => {
        await expect(deeplx(withProviderSnapshot({origin: ' \r\n\t '}, mockConfig))).resolves.toBe(' \r\n\t ');
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockResolvedValue(new Response(JSON.stringify({translations: [{text: '你好'}]})));
        await expect(deeplx(withProviderSnapshot({origin: 'Hello'}, mockConfig))).resolves.toBe('你好');
    });

    it('1500 字符以内的多行文本仍只请求一次，保留跨行语义', async () => {
        const source = 'First line.\nSecond line.\nThird line.';
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({translations: [{text: '第一行。\n第二行。\n第三行。'}]})));
        await expect(deeplx(withProviderSnapshot({origin: source}, mockConfig))).resolves.toBe('第一行。\n第二行。\n第三行。');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).text).toEqual([source]);
    });

    it("sends the expected custom request and parses a successful response", async () => {
        mockConfig.deeplx = "https://custom.example/translate";
        fetchMock.mockResolvedValue(mockResponse({code: 200, data: "你好"}));

        await expect(deeplx(withProviderSnapshot({origin: "Hello"}, mockConfig))).resolves.toBe("你好");

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe("https://custom.example/translate");
        expect(init).toMatchObject({method: "POST"});
        expect(init?.headers).toEqual({"Content-Type": "application/json"});
        expect(JSON.parse(String(init?.body))).toEqual({
            text: "Hello",
            source_lang: "AUTO",
            target_lang: "ZH",
        });
    });

    it("falls back to the next configured URL after an HTTP failure", async () => {
        mockConfig.deeplx = "https://primary.example/translate,\nhttps://backup.example/translate";
        fetchMock
            .mockResolvedValueOnce(mockResponse({message: "busy"}, {
                ok: false,
                status: 503,
                statusText: "Service Unavailable",
                text: vi.fn().mockResolvedValue("busy"),
            }))
            .mockResolvedValueOnce(mockResponse({code: 200, data: "备用译文"}));

        await expect(deeplx(withProviderSnapshot({origin: "Hello"}, mockConfig))).resolves.toBe("备用译文");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1]?.[0]).toBe("https://backup.example/translate");
    });

    it("falls back after an invalid DeepLX response", async () => {
        mockConfig.deeplx = "https://invalid.example/translate,https://valid.example/translate";
        fetchMock
            .mockResolvedValueOnce(mockResponse({code: 200, data: ""}))
            .mockResolvedValueOnce(mockResponse({code: 200, data: "有效译文"}));

        await expect(deeplx(withProviderSnapshot({origin: "Hello"}, mockConfig))).resolves.toBe("有效译文");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([[400], [429], [503], [400, 400], [400, 422]])('preserves safe HTTP classification across failed endpoints %j', async (...statuses) => {
        mockConfig.deeplx = statuses.map((_, index) => `https://endpoint-${index}.example/translate`).join(',');
        for (const status of statuses) {
            fetchMock.mockResolvedValueOnce(mockResponse({}, {ok: false, status}));
        }
        await expect(deeplx(withProviderSnapshot({origin: 'private original'}, mockConfig))).rejects.toMatchObject({statusCode: statuses[0]});
    });

    it.each([429, 503, undefined])('does not mask a mixed availability failure with a parameter error %s', async status => {
        mockConfig.deeplx = 'https://primary.example/translate,https://backup.example/translate';
        fetchMock.mockResolvedValueOnce(mockResponse({}, {ok: false, status: 400}));
        if (status === undefined) fetchMock.mockRejectedValueOnce(new Error('network secret'));
        else fetchMock.mockResolvedValueOnce(mockResponse({}, {ok: false, status}));
        const request = deeplx(withProviderSnapshot({origin: 'private original'}, mockConfig));
        await expect(request).rejects.not.toHaveProperty('statusCode');
        await expect(request).rejects.toThrow('备用站点 1: 请求失败: 400；备用站点 2:');
        await expect(request).rejects.not.toThrow('secret');
    });

    it("adds an optional bearer token without exposing it in the URL", async () => {
        mockConfig.token = {deeplx: "test-token"};
        fetchMock.mockResolvedValue(mockResponse({code: 200, data: "你好"}));

        await deeplx(withProviderSnapshot({origin: "Hello"}, mockConfig));

        expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
            "Content-Type": "application/json",
            Authorization: "Bearer test-token",
        });
    });

    it("supports a token placeholder in a preset endpoint", async () => {
        mockConfig.deeplx = FANYIMAO_ENDPOINT;
        mockConfig.token = {deeplx: "site-token"};
        fetchMock.mockResolvedValue(mockResponse({code: 200, data: "你好"}));

        await expect(deeplx(withProviderSnapshot({origin: "Hello"}, mockConfig))).resolves.toBe("你好");

        expect(fetchMock.mock.calls[0]?.[0]).toBe("https://freeapi.fanyimao.cn/translate?token=site-token");
    });

    it("单次 timeout 覆盖响应体读取，并真正中止 transport signal", async () => {
        mockConfig.deeplx = "https://custom.example/translate";
        vi.useFakeTimers();
        let transportSignal: AbortSignal | undefined;
        fetchMock.mockImplementation((_input, init) => {
            transportSignal = init?.signal ?? undefined;
            return Promise.resolve(mockResponse({}, {
                text: vi.fn(() => new Promise<string>((_resolve, reject) => {
                    transportSignal?.addEventListener('abort', () => reject(transportSignal?.reason), {once: true});
                })),
            }));
        });

        const request = deeplx(withProviderSnapshot({origin: "Hello"}, mockConfig));
        const rejection = expect(request).rejects.toThrow("请求超时（8 秒）");
        await vi.advanceTimersByTimeAsync(7_999);
        expect(transportSignal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await rejection;
        expect(transportSignal?.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("调用方取消响应体读取后不再尝试备用站点", async () => {
        mockConfig.deeplx = "https://primary.example/translate,https://backup.example/translate";
        const controller = new AbortController();
        let transportSignal: AbortSignal | undefined;
        const responseText = vi.fn(() => new Promise<string>((_resolve, reject) => {
            transportSignal?.addEventListener('abort', () => reject(transportSignal?.reason), {once: true});
        }));
        fetchMock.mockImplementation((_input, init) => {
            transportSignal = init?.signal ?? undefined;
            return Promise.resolve(mockResponse({}, {
                text: responseText,
            }));
        });

        const request = deeplx(withProviderSnapshot({origin: "Hello", abortSignal: controller.signal}, mockConfig));
        await vi.waitFor(() => expect(responseText).toHaveBeenCalledOnce());
        controller.abort(new Error('broker deadline'));
        await expect(request).rejects.toThrow('broker deadline');
        expect(transportSignal?.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("normalizes Chinese language variants", () => {
        expect(getDeepLXRequestLanguages("zh-Hans", "zh-TW")).toEqual({sourceLang: "ZH", targetLang: "ZH-HANT"});
        expect(getDeepLXRequestLanguages("auto", "zh-Hans")).toEqual({
            sourceLang: "AUTO",
            targetLang: "ZH",
        });
    });

    it.each([
        {label: 'invalid JSON', response: () => mockResponse({}, {text: vi.fn().mockResolvedValue('not JSON')}), message: '返回的不是 JSON'},
        {label: 'null response', response: () => mockResponse(null), message: '返回格式异常'},
        {label: 'primitive response', response: () => mockResponse(42), message: '返回格式异常'},
        {label: 'provider error code', response: () => mockResponse({code: 429, data: 'ignored'}), message: 'DeepLX 返回错误（错误码 429）'},
    ])('rejects $label from a custom endpoint before accepting any result', async ({response, message}) => {
        mockConfig.deeplx = 'https://custom.example/translate';
        fetchMock.mockResolvedValue(response());
        await expect(deeplx(withProviderSnapshot({origin: 'Hello'}, mockConfig))).rejects.toThrow(message);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it.each(['provider', 'text API'] as const)('rejects array-shaped input at the public %s boundary before transport', async boundary => {
        const malformed = ['Hello'] as unknown as string;
        const request = boundary === 'provider'
            ? deeplx(withProviderSnapshot({origin: malformed}, mockConfig))
            : translateDeepLXText(malformed, 'deeplx', withProviderSnapshot({}, mockConfig));
        await expect(request).rejects.toThrow('DeepLX 翻译仅支持单条文本');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not disclose a custom endpoint body-read rejection', async () => {
        mockConfig.deeplx = 'https://custom.example/translate';
        fetchMock.mockResolvedValue(mockResponse({}, {text: vi.fn().mockRejectedValue(new Error('private original'))}));
        const request = deeplx(withProviderSnapshot({origin: 'Hello'}, mockConfig));
        await expect(request).rejects.toThrow('响应读取失败');
        await expect(request).rejects.not.toThrow('private original');
    });

    it('aggregates a non-Error response-port failure without proceeding to a result', async () => {
        mockConfig.deeplx = 'https://custom.example/translate';
        const response = mockResponse({});
        Object.defineProperty(response, 'ok', {get() {throw 'response port unavailable';}});
        fetchMock.mockResolvedValue(response);
        await expect(deeplx(withProviderSnapshot({origin: 'Hello'}, mockConfig)))
            .rejects.toThrow('备用站点 1: response port unavailable');
    });

    it('preserves caller cancellation after a direct core transport has actually started', async () => {
        const controller = new AbortController();
        const stopped = new Error('direct caller stopped');
        let signal: AbortSignal | undefined;
        fetchMock.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
            signal = init!.signal!;
            signal.addEventListener('abort', () => reject(signal!.reason), {once: true});
        }));
        const request = deeplx(withProviderSnapshot({origin: 'Hello', abortSignal: controller.signal}, mockConfig));
        const outcome = request.catch(error => error);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        controller.abort(stopped);
        await expect(outcome).resolves.toBe(stopped);
        expect(signal!.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it.each(['rejected transport', 'late response'] as const)('cancels a custom endpoint with a %s without requesting a backup', async mode => {
        mockConfig.deeplx = 'https://custom.example/translate,https://backup.example/translate';
        const controller = new AbortController();
        const stopped = new Error('caller stopped');
        fetchMock.mockImplementationOnce(async () => {
            controller.abort(stopped);
            if (mode === 'rejected transport') throw stopped;
            return mockResponse({code: 200, data: 'late'});
        });
        await expect(deeplx(withProviderSnapshot({origin: 'Hello', abortSignal: controller.signal}, mockConfig)))
            .rejects.toBe(stopped);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('does not start a custom endpoint transport after the caller has already cancelled', async () => {
        mockConfig.deeplx = 'https://custom.example/translate';
        const controller = new AbortController();
        controller.abort();
        await expect(deeplx(withProviderSnapshot({origin: 'Hello', abortSignal: controller.signal}, mockConfig)))
            .rejects.toMatchObject({name: 'AbortError'});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['transport', 'response body'] as const)('rejects a %s that ignores timeout and completes late', async stage => {
        vi.useFakeTimers();
        mockConfig.deeplx = 'https://custom.example/translate';
        const response = deferred<Response>(), body = deferred<string>();
        const text = vi.fn(() => body.promise);
        fetchMock.mockImplementationOnce(() => stage === 'transport' ? response.promise : Promise.resolve(mockResponse({}, {text})));
        const request = deeplx(withProviderSnapshot({origin: 'Hello'}, mockConfig));
        if (stage === 'response body') await vi.waitFor(() => expect(text).toHaveBeenCalledOnce());
        await vi.advanceTimersByTimeAsync(8_000);
        response.resolve(mockResponse({code: 200, data: 'late'}));
        body.resolve(JSON.stringify({code: 200, data: 'late'}));
        await expect(request).rejects.toThrow('请求超时（8 秒）');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('caps all custom endpoint attempts at the shared 20-second deadline', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        mockConfig.deeplx = Array.from({length: 4}, (_, index) => `https://backup${index}.example/translate`).join(',');
        const signals: AbortSignal[] = [];
        fetchMock.mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
            const signal = init!.signal!;
            signals.push(signal);
            signal.addEventListener('abort', () => reject(signal.reason), {once: true});
        }));
        const outcome = deeplx(withProviderSnapshot({origin: 'Hello'}, mockConfig)).catch(error => error);
        await vi.advanceTimersByTimeAsync(20_000);
        await expect(outcome).resolves.toMatchObject({message: expect.stringContaining('备用站点 3: 请求超时（4 秒）')});
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(signals.every(signal => signal.aborted)).toBe(true);
        expect(Date.now()).toBe(20_000);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not begin transport after its total budget elapses during synchronous setup', async () => {
        mockConfig.deeplx = 'https://custom.example/translate';
        const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(20_000);
        try {
            await expect(deeplx(withProviderSnapshot({origin: 'Hello'}, mockConfig))).rejects.toThrow('总请求时间已耗尽');
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {clock.mockRestore();}
    });
});

it('DeepLX 脚本及地区别名归一后保持繁体目标', () => {
    expect(getDeepLXRequestLanguages('zh-Hans-CN', 'zh-Hant-HK')).toEqual({sourceLang: 'ZH', targetLang: 'ZH-HANT'});
    expect(getDeepLXRequestLanguages('zh-Hant', 'zh-SG')).toEqual({sourceLang: 'ZH-HANT', targetLang: 'ZH'});
});

describe('DeepLX 菲律宾语兼容', () => {
    it('统一目录 fil 转换为 DeepL 的 TL', () => {
        expect(getDeepLXRequestLanguages('fil', 'fil').targetLang).toBe('TL');
    });
});

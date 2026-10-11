/**
 * @file tests/doubaoWebTranslation.test.ts
 * 文件职责：验证豆包网页匿名翻译的受限访客协议、完整 SSE 响应和免费池错误契约。
 * 主要内容：覆盖官网与注册初始化、调用内复用和一次刷新、槽/空白/分块、流取消与结束、协议损坏、语言限制、HTTP 限流和正文安全。
 * 模块边界：仅向 runtimeFetch 注入合成匿名数据，不接触真实账号或个人 Cookie；线上可用性另由匿名低频实测报告记录。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {translateDoubaoWeb, DOUBAO_WEB_HOME, DOUBAO_WEB_REGISTER_URL, DOUBAO_WEB_TRANSLATION_URL} from '@/src/providers/translation/doubao-web';
import {DOUBAO_GUEST_HEADER} from '@/src/platform/http/doubaoGuest';
import {setRuntimeFetch} from '@/src/platform/http/runtime';
import {parseTranslationSlots, serializeTranslationSlots} from '@/src/core/translation/slotProtocol';

const request = (origin = 'Hello', extra = {}) => ({origin, sourceLanguage: 'en', targetLanguage: 'zh-Hans', ...extra});
const token = '1%7Csynthetic-guest%7C1%7Csignature';
const home = () => new Response(`<script>{"ttwid":"${token}"}</script>`);
const jsonEvent = (body: unknown) => `event: json\ndata: ${JSON.stringify(body)}\n\n`;
const resultEvent = (res: unknown = '你好', index: unknown = 0) => jsonEvent({code: 0, data: {items: [{index, res, detect_lang: 'en'}]}});
const done = 'event: done\ndata:\n\n';
const stream = (text = resultEvent() + done) => new Response(text, {headers: {'Content-Type': 'text/event-stream'}});
const fetchMock = vi.fn<typeof fetch>();
function install(translate: () => Response = () => stream()): void {
    fetchMock.mockImplementation(async input => String(input) === DOUBAO_WEB_HOME ? home() : translate());
}
function translationCalls() {return fetchMock.mock.calls.filter(([input]) => String(input).startsWith(DOUBAO_WEB_TRANSLATION_URL));}

beforeEach(() => {fetchMock.mockReset(); setRuntimeFetch(fetchMock);});
afterEach(() => {setRuntimeFetch(); vi.restoreAllMocks();});

describe('豆包网页匿名免费翻译', () => {
    it('使用固定官方节点和受限匿名访客头，忽略历史凭据和个人 Cookie', async () => {
        install();
        await expect(translateDoubaoWeb(request(' Hello ', {token: 'private-key', customHeaders: {Cookie: 'personal-cookie'}, serviceOverride: 'other'}))).resolves.toBe(' 你好 ');
        expect(fetchMock.mock.calls[0]).toEqual([DOUBAO_WEB_HOME, {method: 'GET', credentials: 'omit', signal: undefined}]);
        const [url, init] = translationCalls()[0]!;
        const endpoint = new URL(String(url));
        expect(endpoint.origin + endpoint.pathname).toBe(DOUBAO_WEB_TRANSLATION_URL);
        expect(Object.fromEntries(endpoint.searchParams)).toEqual({aid: '586864', device_platform: 'web', tea_uuid: expect.stringMatching(/^[1-9]\d{17}$/u), version: '1.38.0'});
        expect(init).toMatchObject({method: 'POST', credentials: 'omit', headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', [DOUBAO_GUEST_HEADER]: token}});
        expect(JSON.parse(String(init!.body))).toEqual({raw_text: ['Hello'], target_lang: 'zh', translate_service: '1', frontend_source: 1, scene: 2});
        expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('private-key');
        expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('personal-cookie');
        expect(init!.headers).not.toHaveProperty('Cookie');
    });

    it('优先读取官网响应中的匿名 ttwid Cookie，只转发该单个值', async () => {
        fetchMock.mockImplementation(async input => String(input) === DOUBAO_WEB_HOME
            ? new Response('not a token page', {headers: {'Set-Cookie': `other=unrelated; Path=/, ttwid=${token}; Path=/; HttpOnly`}}) : stream());
        await translateDoubaoWeb(request());
        expect(translationCalls()[0]![1]!.headers).toHaveProperty(DOUBAO_GUEST_HEADER, token);
        expect(JSON.stringify(translationCalls())).not.toContain('unrelated');
    });

    it('官网缺失访客时注册匿名访客并兼容受限响应 Cookie 与 JSON 字段', async () => {
        for (const register of [
            () => new Response('ok', {headers: {'Set-Cookie': `ttwid=${token}; Domain=.bytedance.com`}}),
            () => Response.json({data: {ttwid: token}}),
        ]) {
            fetchMock.mockReset();
            fetchMock.mockImplementation(async input => String(input) === DOUBAO_WEB_HOME ? new Response('no token')
                : String(input) === DOUBAO_WEB_REGISTER_URL ? register() : stream());
            await translateDoubaoWeb(request());
            expect(fetchMock).toHaveBeenCalledTimes(3);
            expect(fetchMock.mock.calls[1]![1]).toMatchObject({method: 'POST', credentials: 'omit', headers: {'Content-Type': 'application/json'}});
            expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual({region: 'cn', aid: 1768, needFid: false, service: 'www.doubao.com', union: true, cbUrlProtocol: 'https', migrate_info: {ticket: '', source: 'node'}});
            expect(translationCalls()[0]![1]!.headers).toHaveProperty(DOUBAO_GUEST_HEADER, token);
        }
    });

    it.each([null, {}, {data: {}}, {data: {ttwid: 42}}, {data: {ttwid: 'guest; Cookie=personal'}}, {data: {ttwid: 'guest\nunsafe'}}, {data: {ttwid: 'x'.repeat(4097)}}])('拒绝不合法访客字段 %#', async body => {
        fetchMock.mockImplementation(async input => String(input) === DOUBAO_WEB_HOME
            ? new Response('<script>{"ttwid":"unsafe;cookie"}</script>') : Response.json(body));
        await expect(translateDoubaoWeb(request())).rejects.toMatchObject({statusCode: 502, freeFailure: 'unavailable', message: '豆包网页翻译访客初始化失败'});
        expect(translationCalls()).toHaveLength(0);
    });

    it('每次调用重新初始化，调用内按槽和换行复用匿名访客并保留原命名空间', async () => {
        let ordinal = 0;
        install(() => stream(resultEvent(`译文${++ordinal}`) + done));
        const packet = serializeTranslationSlots([' One \r\n\tTwo ', ' ', '', 'Three'], 'doubao-test');
        const result = await translateDoubaoWeb(request(packet.payload));
        expect(parseTranslationSlots(packet, result)).toEqual([' 译文1 \r\n\t译文2 ', ' ', '', '译文3']);
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('___FLUENTREAD_');
        const uuids = translationCalls().map(([url]) => new URL(String(url)).searchParams.get('tea_uuid'));
        expect(new Set(uuids).size).toBe(1);
        await translateDoubaoWeb(request());
        expect(fetchMock.mock.calls.filter(([input]) => String(input) === DOUBAO_WEB_HOME)).toHaveLength(2);
    });

    it('纯空白、相同简体语种不联网，Unicode 分块保护 emoji 与换行', async () => {
        install();
        await expect(translateDoubaoWeb(request(' \r\n\t'))).resolves.toBe(' \r\n\t');
        await expect(translateDoubaoWeb(request('原文', {sourceLanguage: 'zh-CN'}))).resolves.toBe('原文');
        expect(fetchMock).not.toHaveBeenCalled();
        await expect(translateDoubaoWeb(request(` ${'😀'.repeat(2001)} \r\n\tHello\n`))).resolves.toBe(' 你好你好 \r\n\t你好\n');
        const texts = translationCalls().map(([, init]) => JSON.parse(String(init!.body)).raw_text[0]);
        expect(texts).toEqual(['😀'.repeat(1999), '😀'.repeat(2), 'Hello']);
    });

    it('默认和已确认简体别名映射为 zh，自动源语言不发送强制 source', async () => {
        install();
        for (const targetLanguage of [undefined, 'zh', 'zh-CN', 'zh_Hans', 'zh-chs']) {
            await translateDoubaoWeb({origin: 'Hello', targetLanguage});
        }
        expect(translationCalls()).toHaveLength(5);
        for (const [, init] of translationCalls()) expect(JSON.parse(String(init!.body))).toMatchObject({target_lang: 'zh'});
    });

    it.each(['zh-Hant', 'zh-TW', 'zh-HK', 'zh-MO', 'auto', 'invalid@language'])('未确认目标 %s 不降级且允许免费池换线', async targetLanguage => {
        await expect(translateDoubaoWeb(request('Hello', {targetLanguage}))).rejects.toMatchObject({statusCode: 400, freeFailure: 'request', message: '豆包网页翻译不支持当前目标语言'});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('普通目标码原样透传，源语言只用于跳过相同语种', async () => {
        install();
        for (const targetLanguage of ['en', 'ja', 'fr', 'fil']) await translateDoubaoWeb(request('文本', {sourceLanguage: 'auto', targetLanguage}));
        expect(translationCalls().map(([, init]) => JSON.parse(String(init!.body)).target_lang)).toEqual(['en', 'ja', 'fr', 'fil']);
        await expect(translateDoubaoWeb(request('same source', {sourceLanguage: 'EN', targetLanguage: 'en'}))).resolves.toBe('same source');
        expect(translationCalls()).toHaveLength(4);
    });

    it('非法文本不会发请求', async () => {
        await expect(translateDoubaoWeb(request(42 as any))).rejects.toMatchObject({statusCode: 400, freeFailure: 'request'});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('累计译文快照覆盖前值，CRLF 与 UTF8 跨网络块仍准确且 done 即关闭流', async () => {
        let canceled = 0;
        const bytes = new TextEncoder().encode((resultEvent('你') + resultEvent('你好') + done).replaceAll('\n', '\r\n'));
        let offset = 0;
        fetchMock.mockImplementation(async input => String(input) === DOUBAO_WEB_HOME ? home()
            : new Response(new ReadableStream({pull(controller) {
                if (offset < bytes.length) {controller.enqueue(bytes.slice(offset, offset + 1)); offset += 1;}
            }, cancel() {canceled += 1;}}), {headers: {'Content-Type': 'text/event-stream'}}));
        await expect(translateDoubaoWeb(request())).resolves.toBe('你好');
        expect(canceled).toBe(1);
    });

    it('event done 可省略 data 行，注释心跳不会进入译文', async () => {
        install(() => stream(': heartbeat\n\n' + resultEvent() + 'event: done\n\n'));
        await expect(translateDoubaoWeb(request())).resolves.toBe('你好');
    });

    it.each([
        resultEvent(), resultEvent() + 'event: done\ndata:', done,
        jsonEvent({code: 0, data: {items: []}}) + done,
        jsonEvent({code: 0, data: {items: [{index: 0, res: 'a'}, {index: 0, res: 'b'}]}}) + done,
        jsonEvent({code: 0, data: {items: null}}) + done,
        jsonEvent({code: 0, data: {items: [null]}}) + done,
        jsonEvent({code: 0}) + done,
        jsonEvent(null) + done,
        resultEvent('', 0) + done, resultEvent(' ', 0) + done,
        resultEvent(42, 0) + done, resultEvent('private result', 1) + done,
        resultEvent('private result', '0') + done,
        'event: json\ndata: private malformed JSON\n\n' + done,
        'data: [DONE]\n\n', 'event: done\ndata: private error\n\n',
    ])('拒绝未结束、缺译文、空值、乱索引或损坏流 %#', async text => {
        install(() => stream(text));
        const error = await translateDoubaoWeb(request()).catch(error => error);
        expect(error.statusCode).toBe(502);
        expect(error.message).toMatch(/^豆包网页翻译/u);
        expect(error.message).not.toMatch(/private/u);
    });

    it('译文夹带本包槽标记时拒绝整体结果，不能创建另一命名空间', async () => {
        const packet = serializeTranslationSlots(['One', 'Two'], 'doubao-conflict');
        install(() => stream(resultEvent(packet.starts[0]) + done));
        await expect(translateDoubaoWeb(request(packet.payload))).rejects.toThrow('豆包网页翻译返回的译文不完整');
    });

    it.each([710012000, 710012001, '710012001'])('访客错误 %s 只刷新一次并重试当前块', async code => {
        let attempts = 0;
        fetchMock.mockImplementation(async input => String(input) === DOUBAO_WEB_HOME ? home()
            : ++attempts === 1 ? Response.json({code, msg: 'private details'}) : stream());
        await expect(translateDoubaoWeb(request())).resolves.toBe('你好');
        expect(fetchMock.mock.calls.filter(([input]) => String(input) === DOUBAO_WEB_HOME)).toHaveLength(2);
        expect(translationCalls()).toHaveLength(2);
    });

    it('SSE 访客错误触发一次刷新；整次调用后续块不再次刷新', async () => {
        let attempts = 0;
        fetchMock.mockImplementation(async input => String(input) === DOUBAO_WEB_HOME ? home()
            : ++attempts === 2 ? stream() : stream(jsonEvent({code: 710012001, msg: 'private details'})));
        const error = await translateDoubaoWeb(request('One\nTwo')).catch(error => error);
        expect(error).toMatchObject({statusCode: 403, freeFailure: 'blocked', message: '豆包网页翻译请求失败（错误码 710012001）'});
        expect(error.message).not.toContain('private');
        expect(fetchMock.mock.calls.filter(([input]) => String(input) === DOUBAO_WEB_HOME)).toHaveLength(2);
        expect(translationCalls()).toHaveLength(3);
    });

    it.each([777, 'private business details', undefined])('其他业务错误不刷新且不暴露正文 %#', async code => {
        install(() => Response.json({code, msg: 'private text'}));
        const error = await translateDoubaoWeb(request()).catch(error => error);
        expect(error).toMatchObject({statusCode: 502, freeFailure: 'unavailable'});
        expect(error.message).not.toContain('private');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([null, {code: 0}])('JSON 空成功无法当作完整 SSE %#', async body => {
        install(() => Response.json(body));
        await expect(translateDoubaoWeb(request())).rejects.toMatchObject({statusCode: 502});
    });

    it('HTTP 状态和 Retry-After 可换线，损坏 JSON 没有 parser 正文预览', async () => {
        install(() => new Response('private text', {status: 429, headers: {'Retry-After': '12'}}));
        await expect(translateDoubaoWeb(request())).rejects.toMatchObject({statusCode: 429, retryAfterMs: 12000, message: '豆包网页翻译请求失败: 429'});
        install(() => new Response('private malformed JSON', {headers: {'Content-Type': 'application/json'}}));
        await expect(translateDoubaoWeb(request())).rejects.toThrow('豆包网页翻译返回的流数据无效');
    });

    it('官网或注册 HTTP 失败保留状态和限流时间', async () => {
        fetchMock.mockResolvedValue(new Response('private text', {status: 429, headers: {'Retry-After': '6'}}));
        await expect(translateDoubaoWeb(request())).rejects.toMatchObject({statusCode: 429, retryAfterMs: 6000, message: '豆包网页翻译访客初始化失败: 429'});
        fetchMock.mockImplementation(async input => String(input) === DOUBAO_WEB_HOME ? new Response('no token') : new Response('private text', {status: 503}));
        await expect(translateDoubaoWeb(request())).rejects.toMatchObject({statusCode: 503});
    });

    it('损坏的首页读取不回显正文，读取过程中取消优先保留原因', async () => {
        fetchMock.mockResolvedValue({ok: true, headers: new Headers(), text: async () => {throw new Error('private preview');}} as unknown as Response);
        await expect(translateDoubaoWeb(request())).rejects.toThrow('豆包网页翻译返回的流数据无效');
        const controller = new AbortController(); const reason = new Error('reading cancelled');
        fetchMock.mockResolvedValue({ok: true, headers: new Headers(), text: async () => {controller.abort(reason); return 'private page';}} as unknown as Response);
        await expect(translateDoubaoWeb(request('Hello', {abortSignal: controller.signal}))).rejects.toBe(reason);
    });

    it('无 body 的迟到响应取消同样保留原因，非法响应 Cookie 不进入受限头', async () => {
        const controller = new AbortController(); const reason = new Error('late response');
        fetchMock.mockImplementation(async () => {controller.abort(reason); return new Response(null);});
        await expect(translateDoubaoWeb(request('Hello', {abortSignal: controller.signal}))).rejects.toBe(reason);
        fetchMock.mockImplementation(async input => String(input) === DOUBAO_WEB_HOME
            ? new Response('{"ttwid":"fixture-good-token"}', {headers: {'Set-Cookie': 'ttwid=invalid^token; Path=/'}}) : stream());
        await translateDoubaoWeb(request());
        expect(translationCalls()[0]![1]!.headers).toHaveProperty(DOUBAO_GUEST_HEADER, 'fixture-good-token');
    });

    it('开始前、初始化后和流读取时取消都保留原因且停止请求', async () => {
        const reason = new Error('cancelled by caller');
        const before = new AbortController(); before.abort(reason);
        await expect(translateDoubaoWeb(request('Hello', {abortSignal: before.signal}))).rejects.toBe(reason);
        expect(fetchMock).not.toHaveBeenCalled();
        const after = new AbortController();
        fetchMock.mockImplementation(async (_, init) => {expect(init!.signal).toBe(after.signal); after.abort(reason); return home();});
        await expect(translateDoubaoWeb(request('Hello', {abortSignal: after.signal}))).rejects.toBe(reason);
        expect(fetchMock).toHaveBeenCalledOnce();

        let canceled = false;
        const reading = new AbortController();
        fetchMock.mockImplementation(async input => String(input) === DOUBAO_WEB_HOME ? home()
            : new Response(new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode(resultEvent()));
                queueMicrotask(() => reading.abort(reason));}, cancel() {canceled = true;}}), {headers: {'Content-Type': 'text/event-stream'}}));
        await expect(translateDoubaoWeb(request('Hello', {abortSignal: reading.signal}))).rejects.toBe(reason);
        expect(canceled).toBe(true);
    });

    it('等待服务器下一块时取消主动释放 reader，不等 HTTP 自行关闭', async () => {
        const controller = new AbortController();
        let canceled = false;
        fetchMock.mockImplementation(async input => String(input) === DOUBAO_WEB_HOME ? home()
            : new Response(new ReadableStream({pull() {setTimeout(() => controller.abort(), 1);}, cancel() {canceled = true;}}), {headers: {'Content-Type': 'text/event-stream'}}));
        await expect(translateDoubaoWeb(request('Hello', {abortSignal: controller.signal}))).rejects.toMatchObject({name: 'AbortError'});
        expect(canceled).toBe(true);
    });

    it('网络流读取错误、无 body 与过大事件都安全拒绝', async () => {
        install(() => new Response(new ReadableStream({start(controller) {controller.error(new Error('private transport preview'));}})));
        await expect(translateDoubaoWeb(request())).rejects.toThrow('豆包网页翻译返回的流数据无效');
        install(() => new Response(null));
        await expect(translateDoubaoWeb(request())).rejects.toThrow('豆包网页翻译返回的流数据无效');
        install(() => stream(resultEvent('x'.repeat(256_001)) + done));
        await expect(translateDoubaoWeb(request())).rejects.toThrow('豆包网页翻译返回的流数据无效');
        install(() => stream('data: ' + 'x'.repeat(256_001)));
        await expect(translateDoubaoWeb(request())).rejects.toThrow('豆包网页翻译返回的流数据无效');
        install(() => stream((': ' + 'x'.repeat(200_000) + '\n\n').repeat(11)));
        await expect(translateDoubaoWeb(request())).rejects.toThrow('豆包网页翻译返回的流数据无效');
    });
});

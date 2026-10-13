import {afterEach, describe, expect, it} from 'vitest';
import {userscriptFetch} from '@/userscript/http';
import {DOUBAO_GUEST_HEADER} from '@/src/platform/http/doubaoGuest';

describe('userscript HTTP transport', () => {
    afterEach(() => {
        globalThis.GM_xmlhttpRequest = undefined;
        globalThis.GM = undefined;
        globalThis.GM_info = undefined;
    });

    it('uses Safari Userscripts promise-only GM.xmlHttpRequest without falling back to page fetch', async () => {
        let calls = 0;
        globalThis.GM = {
            xmlHttpRequest(details) {
                calls += 1;
                expect(details.url).toBe('https://api.example.test/safari');
                return Promise.resolve({
                    status: 200,
                    statusText: 'OK',
                    responseText: '{"translation":"你好"}',
                    responseHeaders: 'content-type: application/json',
                });
            },
        };

        const response = await userscriptFetch('https://api.example.test/safari');
        expect(calls).toBe(1);
        expect(await response.json()).toEqual({translation: '你好'});
    });

    it('propagates cancellation to a modern GM promise handle', async () => {
        let aborted = false;
        globalThis.GM = {
            xmlHttpRequest() {
                const pending = new Promise<UserscriptXmlHttpResponse>(() => undefined) as
                    Promise<UserscriptXmlHttpResponse> & {abort?: () => void};
                pending.abort = () => { aborted = true; };
                return pending;
            },
        };
        const controller = new AbortController();
        const request = userscriptFetch('https://api.example.test/slow', {signal: controller.signal});
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        controller.abort();
        await expect(request).rejects.toMatchObject({name: 'AbortError'});
        expect(aborted).toBe(true);
    });

    it('wraps Via-compatible responseText as a fetch Response', async () => {
        let captured: UserscriptXmlHttpRequestDetails | undefined;
        globalThis.GM_xmlhttpRequest = (details) => {
            captured = details;
            queueMicrotask(() => details.onload?.({
                status: 200,
                statusText: 'OK',
                responseText: '{"translation":"你好"}',
                responseHeaders: 'content-type: application/json\r\nx-test: userscript',
            }));
            return {abort() {}};
        };

        const response = await userscriptFetch('https://api.example.test/translate', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: '{"text":"hello"}',
        });

        expect(captured?.method).toBe('POST');
        expect(captured?.data).toBe('{"text":"hello"}');
        expect(captured).not.toHaveProperty('responseType');
        expect(captured).not.toHaveProperty('anonymous');
        expect(response.headers.get('x-test')).toBe('userscript');
        expect(await response.json()).toEqual({translation: '你好'});
    });

    it('settles null-body statuses and non-ByteString manager metadata instead of stalling', async () => {
        const responses: UserscriptXmlHttpResponse[] = [
            {status: 204, statusText: 'No Content', responseText: ''},
            {
                status: 200,
                statusText: '成功',
                responseText: '{"ok":true}',
                responseHeaders: 'x y: invalid-name\r\nx-provider: 有道\r\ncontent-type: application/json',
            },
        ];
        globalThis.GM_xmlhttpRequest = (details) => {
            const response = responses.shift()!;
            queueMicrotask(() => details.onload?.(response));
            return {abort() {}};
        };
        // 回调内构造 Response 抛错时，旧实现已经关闭完成门，调用方和后续 abort 都无法结算。
        const withinDeadline = (pending: Promise<Response>) => Promise.race([
            pending,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('request stalled')), 200)),
        ]);

        const noContent = await withinDeadline(userscriptFetch('https://api.example.test/usage', {method: 'POST'}));
        expect(noContent.status).toBe(204);
        expect(await noContent.text()).toBe('');

        const translated = await withinDeadline(userscriptFetch('https://api.example.test/translate'));
        expect(translated.statusText).toBe('');
        expect(translated.headers.get('content-type')).toBe('application/json');
        expect(translated.headers.has('x-provider')).toBe(false);
        expect(await translated.json()).toEqual({ok: true});

        // 无法转换的回调载荷也必须结算为失败，而不是让 provider 永久等待。
        globalThis.GM_xmlhttpRequest = (details) => {
            queueMicrotask(() => details.onload?.(undefined as unknown as UserscriptXmlHttpResponse));
            return {abort() {}};
        };
        await expect(withinDeadline(userscriptFetch('https://api.example.test/broken')))
            .rejects.toBeInstanceOf(TypeError);
    });

    it('does not turn missing or zero GM HTTP statuses into successful translations', async () => {
        globalThis.GM_xmlhttpRequest = (details) => {
            queueMicrotask(() => details.onload?.({status: 0, statusText: '', responseText: ''}));
            return {abort() {}};
        };
        await expect(userscriptFetch('https://api.example.test/network-failure'))
            .rejects.toThrow('invalid HTTP status: 0');

        globalThis.GM_xmlhttpRequest = undefined;
        globalThis.GM = {
            xmlHttpRequest: () => Promise.resolve({
                statusText: 'OK',
                responseText: '{"translation":"false success"}',
            } as UserscriptXmlHttpResponse),
        };
        await expect(userscriptFetch('https://api.example.test/missing-status'))
            .rejects.toThrow('invalid HTTP status: missing');
    });

    it('propagates AbortSignal to the GM request handle', async () => {
        let aborted = false;
        globalThis.GM_xmlhttpRequest = () => ({abort() { aborted = true; }});
        const controller = new AbortController();
        const pending = userscriptFetch('https://api.example.test/slow', {signal: controller.signal});
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        controller.abort();

        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        expect(aborted).toBe(true);
    });

    it('isolates Doubao anonymous requests and consumes the internal guest header', async () => {
        globalThis.GM_info = {scriptHandler: 'Tampermonkey', version: '5.6.6239', platform: {browserName: 'chrome', os: 'mac'}};
        const captured: UserscriptXmlHttpRequestDetails[] = [];
        globalThis.GM_xmlhttpRequest = details => {
            captured.push(details);
            queueMicrotask(() => details.onload?.({status: 200, responseText: 'ok'}));
            return {abort() {}};
        };
        await userscriptFetch('https://www.doubao.com/');
        await userscriptFetch('https://ttwid.bytedance.com/ttwid/union/register/', {method: 'POST'});
        await userscriptFetch('https://www.doubao.com/samantha/plugin/stream_article_translate?tea_uuid=123456789012345678', {
            method: 'POST', headers: {[DOUBAO_GUEST_HEADER]: 'anonymous-test-token', Cookie: 'personal=secret'},
        });
        expect(captured.every(request => request.anonymous === true)).toBe(true);
        expect(captured[2].headers).toMatchObject({cookie: 'ttwid=anonymous-test-token', origin: 'https://www.doubao.com', referer: 'https://www.doubao.com/'});
        expect(captured[2].redirect).toBe('error');
        expect(captured[2].headers).not.toHaveProperty(DOUBAO_GUEST_HEADER.toLowerCase());
    });

    it('rejects guest requests without a privileged manager or to another endpoint', async () => {
        await expect(userscriptFetch('https://www.doubao.com/samantha/plugin/stream_article_translate', {
            method: 'POST', headers: {[DOUBAO_GUEST_HEADER]: 'anonymous-test-token'},
        })).rejects.toThrow('需要脚本管理器');
        await expect(userscriptFetch('https://other.test/', {
            method: 'POST', headers: {[DOUBAO_GUEST_HEADER]: 'anonymous-test-token'},
        })).rejects.toThrow('无法发送豆包匿名');
    });

    it('refuses Doubao bootstrap before managers with unknown or unsupported anonymity can send cookies', async () => {
        let calls = 0;
        globalThis.GM_xmlhttpRequest = () => {calls++; return {abort() {}};};
        for (const info of [undefined,
            {scriptHandler: 'Userscripts', version: '6.0', platform: {browserName: 'safari', os: 'mac'}},
            {scriptHandler: 'Tampermonkey', version: '5.4.0', platform: {browserName: 'chrome', os: 'mac'}},
            {scriptHandler: 'Tampermonkey', version: '5.6.6239', platform: {browserName: 'chrome', os: 'android'}},
        ]) {
            globalThis.GM_info = info;
            await expect(userscriptFetch('https://www.doubao.com/', {credentials: 'omit'})).rejects.toThrow('无法发送豆包匿名');
        }
        expect(calls).toBe(0);
    });
});

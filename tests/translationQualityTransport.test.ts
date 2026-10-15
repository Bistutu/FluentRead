import {afterEach, describe, expect, it, vi} from 'vitest';
import {createMeasuredFetch} from '../scripts/quality/transport.mjs';
import type {MeasuredTransportEvent} from '../scripts/quality/transport.mjs';

const encode = (text: string) => new TextEncoder().encode(text);
afterEach(() => vi.useRealTimers());

describe('translation quality measured transport', () => {
    it('透明传递请求并按实际拉取字节计量，保留原响应状态、头与URL元数据', async () => {
        const original = new Response(new ReadableStream<Uint8Array>({
            start(controller) {controller.enqueue(encode('你')); controller.enqueue(encode('好')); controller.close();},
        }), {status: 201, statusText: 'Created', headers: {'content-type': 'text/plain', 'x-evidence': 'yes'}});
        Object.defineProperties(original, {url: {value: 'https://public.example/result'}, redirected: {value: true}, type: {value: 'cors'}});
        const clone = vi.spyOn(original, 'clone');
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(original);
        const events: MeasuredTransportEvent[] = [];
        const measured = createMeasuredFetch(fetchImpl, events);
        const init = {method: 'POST', body: '公开', headers: {'x-test': 'sent'}, credentials: 'omit' as const};
        const response = await measured('https://public.example/translate?q=%E4%BD%A0&token=private', init);
        expect(fetchImpl).toHaveBeenCalledWith('https://public.example/translate?q=%E4%BD%A0&token=private', init);
        expect(events[0]).toMatchObject({endpoint: 'https://public.example/translate', requestBytes: encode('?q=%E4%BD%A0&token=private').byteLength + 6, responseBytes: 0, status: 201, bodyComplete: false});
        expect(JSON.stringify(events)).not.toContain('private');
        expect([response.status, response.statusText, response.url, response.redirected, response.type]).toEqual([201, 'Created', 'https://public.example/result', true, 'cors']);
        expect(response.headers.get('x-evidence')).toBe('yes');
        const reader = response.body!.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toBe('你');
        expect(events[0].responseBytes).toBe(3);
        expect(events[0].bodyComplete).toBe(false);
        expect(new TextDecoder().decode((await reader.read()).value)).toBe('好');
        expect(events[0].responseBytes).toBe(6);
        expect((await reader.read()).done).toBe(true);
        expect(events[0]).toMatchObject({bodyComplete: true, networkError: false, aborted: false, abortSource: null, consumerCancelled: false});
        expect(clone).not.toHaveBeenCalled();
    });

    it('无正文响应直接返回，预响应断连记录网络失败并保留原错误', async () => {
        const events: MeasuredTransportEvent[] = [];
        const response = new Response(null, {status: 204});
        const failure = new TypeError('Network failed');
        const measured = createMeasuredFetch(vi.fn<typeof fetch>().mockResolvedValueOnce(response).mockRejectedValueOnce(failure), events);
        expect(await measured(new URL('https://public.example/empty'))).toBe(response);
        expect(events[0]).toMatchObject({status: 204, bodyComplete: true, responseBytes: 0, requestBytes: 0});
        await expect(measured('https://public.example/fail')).rejects.toBe(failure);
        expect(events[1]).toMatchObject({status: null, networkError: true, bodyComplete: false, aborted: false, abortSource: null, consumerCancelled: false});
    });

    it('Headers到达后读取中断会留下已消费字节和网络失败，而非完整响应', async () => {
        const failure = new TypeError('Socket closed');
        let pulls = 0;
        const response = new Response(new ReadableStream<Uint8Array>({
            pull(controller) {if (pulls++ === 0) controller.enqueue(encode('partial')); else controller.error(failure);},
        }, {highWaterMark: 0}));
        const events: MeasuredTransportEvent[] = [];
        const measured = await createMeasuredFetch(vi.fn<typeof fetch>().mockResolvedValue(response), events)('https://public.example/stream');
        await expect(measured.text()).rejects.toBe(failure);
        expect(events[0]).toMatchObject({status: 200, responseBytes: 7, bodyComplete: false, networkError: true});
    });

    it('评测deadline与调用者取消不会冒充网络失败，并使等待中的正文读取拒绝', async () => {
        for (const deadline of [true, false]) {
            const aborter = new AbortController();
            const reason = new DOMException('Cancelled', deadline ? 'TimeoutError' : 'AbortError');
            const response = new Response(new ReadableStream<Uint8Array>({
                start(controller) {aborter.signal.addEventListener('abort', () => controller.error(aborter.signal.reason), {once: true});},
            }));
            const events: MeasuredTransportEvent[] = [];
            const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
            const evaluation = deadline ? aborter : new AbortController();
            const measured = await createMeasuredFetch(fetchImpl, events, evaluation.signal)('https://public.example/wait', {signal: aborter.signal});
            const reading = measured.text();
            aborter.abort(reason);
            await expect(reading).rejects.toBe(reason);
            expect(evaluation.signal.aborted).toBe(deadline);
            expect(events[0]).toMatchObject({networkError: false, bodyComplete: false, responseBytes: 0, aborted: true, abortSource: deadline ? 'evaluation' : 'request', consumerCancelled: false});
        }
        const aborted = new AbortController(); aborted.abort();
        const events: MeasuredTransportEvent[] = [];
        await expect(createMeasuredFetch(vi.fn<typeof fetch>().mockRejectedValue(aborted.signal.reason), events, aborted.signal)('https://public.example/start')).rejects.toBe(aborted.signal.reason);
        expect(events[0]).toMatchObject({networkError: false, aborted: true, abortSource: 'evaluation', consumerCancelled: false});
    });

    it('供应商局部AbortController在响应头前超时，显式记录request来源且外层评测保持运行', async () => {
        const evaluation = new AbortController();
        const provider = new AbortController();
        const reason = new DOMException('Provider timeout', 'TimeoutError');
        const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {once: true});
        }));
        const events: MeasuredTransportEvent[] = [];
        const waiting = createMeasuredFetch(fetchImpl, events, evaluation.signal)('https://public.example/google-local-timeout', {signal: provider.signal});
        provider.abort(reason);
        await expect(waiting).rejects.toBe(reason);
        expect(evaluation.signal.aborted).toBe(false);
        expect(events[0]).toMatchObject({status: null, aborted: true, abortSource: 'request', consumerCancelled: false, networkError: false, bodyComplete: false});
    });

    it('Request自带局部取消信号也保留request来源', async () => {
        const evaluation = new AbortController();
        const provider = new AbortController();
        const request = new Request('https://public.example/request-timeout', {signal: provider.signal});
        const reason = new DOMException('Provider timeout', 'TimeoutError');
        const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async input => new Promise<Response>((_resolve, reject) => {
            (input as Request).signal.addEventListener('abort', () => reject((input as Request).signal.reason), {once: true});
        }));
        const events: MeasuredTransportEvent[] = [];
        const waiting = createMeasuredFetch(fetchImpl, events, evaluation.signal)(request);
        provider.abort(reason);
        await expect(waiting).rejects.toBe(reason);
        expect(events[0]).toMatchObject({status: null, aborted: true, abortSource: 'request', networkError: false});
        // fetch 的 signal:null 显式解除继承，原 Request 已取消不能改变这次网络失败的归因。
        expect(new Request(request, {signal: null}).signal.aborted).toBe(false);
        const failure = new TypeError('Network failure');
        await expect(createMeasuredFetch(vi.fn<typeof fetch>().mockRejectedValue(failure), events, evaluation.signal)(request, {signal: null})).rejects.toBe(failure);
        expect(events[1]).toMatchObject({aborted: false, abortSource: null, networkError: true});
    });

    it('SSE消费者取消直接传至原reader，不预读后续流且取消可完成', async () => {
        const cancel = vi.fn();
        let pulls = 0;
        const original = new Response(new ReadableStream<Uint8Array>({
            pull(controller) {pulls++; controller.enqueue(encode('data: first\n\n'));},
            cancel,
        }, {highWaterMark: 0}), {headers: {'content-type': 'text/event-stream'}});
        const events: MeasuredTransportEvent[] = [];
        const response = await createMeasuredFetch(vi.fn<typeof fetch>().mockResolvedValue(original), events)('https://public.example/sse');
        expect(pulls).toBe(0);
        const reader = response.body!.getReader();
        await reader.read();
        expect(pulls).toBe(1);
        await reader.cancel('Translation complete');
        expect(cancel).toHaveBeenCalledWith('Translation complete');
        expect(events[0]).toMatchObject({responseBytes: 13, networkError: false, bodyComplete: false, consumerCancelled: true, aborted: false, abortSource: null});
        expect(pulls).toBe(1);
    });

    it('取消进行中的pull不会将取消产生的EOF误记为正文完整', async () => {
        const cancel = vi.fn();
        const original = new Response(new ReadableStream<Uint8Array>({pull() {}, cancel}, {highWaterMark: 0}));
        const events: MeasuredTransportEvent[] = [];
        const response = await createMeasuredFetch(vi.fn<typeof fetch>().mockResolvedValue(original), events)('https://public.example/sse');
        const reader = response.body!.getReader();
        const pending = reader.read();
        await reader.cancel('stop');
        expect((await pending).done).toBe(true);
        expect(cancel).toHaveBeenCalledWith('stop');
        expect(events[0]).toMatchObject({bodyComplete: false, networkError: false, consumerCancelled: true, aborted: false, abortSource: null});
    });

    it('Retry-After兼容秒、日期、零与过去日期并拒绝非数字延迟', async () => {
        vi.useFakeTimers();
        const now = Date.parse('2026-10-15T06:00:00Z');
        vi.setSystemTime(now);
        const values = ['12', '1.5', 'Thu, 15 Oct 2026 06:01:00 GMT', '0', 'Wed, 14 Oct 2026 06:00:00 GMT', '-5', 'garbage', '999999999999999999999'];
        const events: MeasuredTransportEvent[] = [];
        for (const value of values) await createMeasuredFetch(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {status: 429, headers: {'retry-after': value}})), events)('https://public.example/rate-limit');
        expect(events.map(event => event.retryAt)).toEqual([now + 12000, now + 1500, now + 60000, now, now, undefined, undefined, undefined]);
    });

    it('已知序列化请求按字节计量，FormData、Request正文和请求流显式未知', async () => {
        const bodyView = new Uint8Array([1, 2, 3, 4]).subarray(1, 3);
        const bodies: BodyInit[] = [new URLSearchParams({x: '你'}), new Blob(['你好']), new Uint8Array([1, 2, 3]).buffer, bodyView, new FormData(), new ReadableStream()];
        const events: MeasuredTransportEvent[] = [];
        const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, {status: 204}));
        const measured = createMeasuredFetch(fetchImpl, events);
        for (const body of bodies) await measured('https://public.example/count?q=1', {method: 'POST', body});
        const request = new Request('https://public.example/count?q=1', {method: 'POST', body: 'not inspected'});
        await measured(request);
        expect(request.bodyUsed).toBe(false);
        await measured(request, {body: null});
        await measured(request, {body: 'override'});
        expect(events.map(event => event.requestBytes)).toEqual([15, 10, 7, 6, null, null, null, null, 12]);
    });
});

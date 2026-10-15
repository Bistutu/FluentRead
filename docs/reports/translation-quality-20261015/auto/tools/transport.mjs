/**
 * @file scripts/quality/transport.mjs
 * 评测专用 HTTP 用量观察器。直接读取并转发原响应流，不 clone/tee，
 * 不保存正文、查询参数或凭据；网络中断、消费者取消与评测截止分别归因。
 */

const encoder = new TextEncoder();

function requestByteLength(input, init, url) {
    const queryBytes = encoder.encode(url.search).byteLength;
    const explicitBody = init?.body;
    // Request 的流可能包含任意序列化正文；读取它会消费或 tee 请求流。
    if (explicitBody == null && input instanceof Request && input.body !== null) return null;
    if (explicitBody == null) return queryBytes;
    if (typeof explicitBody === 'string') return queryBytes + encoder.encode(explicitBody).byteLength;
    if (explicitBody instanceof URLSearchParams) return queryBytes + encoder.encode(explicitBody.toString()).byteLength;
    if (explicitBody instanceof Blob) return queryBytes + explicitBody.size;
    if (explicitBody instanceof ArrayBuffer) return queryBytes + explicitBody.byteLength;
    if (ArrayBuffer.isView(explicitBody)) return queryBytes + explicitBody.byteLength;
    // FormData 的 multipart boundary 由 fetch 产生；ReadableStream 的长度也未知。
    return null;
}

function retryAt(value) {
    if (!value?.trim()) return undefined;
    const trimmed = value.trim();
    const now = Date.now();
    if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
        const timestamp = now + Number(trimmed) * 1000;
        return Number.isFinite(new Date(timestamp).getTime()) ? timestamp : undefined;
    }
    // Date.parse 会把负数、纯数字等解析成历史日期，先排除非法 delay-seconds。
    if (/^[+-]?[\d.]+$/u.test(trimmed)) return undefined;
    const timestamp = Date.parse(trimmed);
    return Number.isFinite(timestamp) ? Math.max(now, timestamp) : undefined;
}

/**
 * 包装 fetch，但保留 input/init 以及 response 的协议语义。
 * signal 用于评测截止的归因；调用方仍负责给 fetch 传入实际取消信号。
 */
export function createMeasuredFetch(fetchImpl, events, signal) {
    return async function measuredFetch(input, init) {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const event = {
            endpoint: url.origin + url.pathname,
            requestBytes: requestByteLength(input, init, url),
            responseBytes: 0,
            status: null,
            networkError: false,
            bodyComplete: false,
        };
        events.push(event);
        const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const isAborted = () => Boolean(signal?.aborted || requestSignal?.aborted);
        let response;
        try {
            response = await fetchImpl(input, init);
        } catch (error) {
            event.networkError = !isAborted();
            throw error;
        }
        event.status = response.status;
        const timestamp = retryAt(response.headers.get('retry-after'));
        if (timestamp !== undefined) event.retryAt = timestamp;
        if (!response.body) {
            event.bodyComplete = true;
            return response;
        }
        const reader = response.body.getReader();
        let cancelled = false;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            reader.releaseLock();
        };
        const body = new ReadableStream({
            async pull(controller) {
                try {
                    const result = await reader.read();
                    if (cancelled) return;
                    if (result.done) {
                        event.bodyComplete = !isAborted();
                        release();
                        controller.close();
                    } else {
                        event.responseBytes += result.value.byteLength;
                        controller.enqueue(result.value);
                    }
                } catch (error) {
                    if (!cancelled) {
                        event.networkError = !isAborted();
                        controller.error(error);
                    }
                    release();
                }
            },
            async cancel(reason) {
                cancelled = true;
                try { await reader.cancel(reason); }
                finally { release(); }
            },
        }, {highWaterMark: 0});
        const measured = new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
        for (const key of ['url', 'redirected', 'type']) {
            Object.defineProperty(measured, key, {value: response[key], configurable: true});
        }
        return measured;
    };
}

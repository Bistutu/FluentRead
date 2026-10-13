import type {RuntimeFetch} from '@/src/platform/http/runtime';
import {readDoubaoGuestRequest} from '@/src/platform/http/doubaoGuest';
import {getUserscriptFunction} from './api';

export function parseResponseHeaders(rawHeaders = ''): Headers {
    const headers = new Headers();
    for (const line of rawHeaders.split(/\r?\n/u)) {
        const separator = line.indexOf(':');
        if (separator <= 0) continue;
        const name = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (!name) continue;
        try {
            headers.append(name, value);
        } catch {
            // 脚本管理器可能按 UTF-8 解码出非 ByteString 值；单个无法表示的头不应作废响应。
        }
    }
    return headers;
}

// Fetch 规范禁止这些状态携带响应体，即使脚本管理器给出空 responseText。
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function responseFromUserscript(response: UserscriptXmlHttpResponse): Response {
    // GM 请求只承接 HTTP(S)。status 0 或缺失表示管理器没有取得有效 HTTP 响应，
    // 不能伪装成 200，否则翻译调度会把网络失败计为成功并吞掉后备/重试。
    const status = response.status;
    if (!Number.isInteger(status) || status < 200 || status > 599) {
        throw new TypeError(`GM_xmlhttpRequest returned invalid HTTP status: ${Number.isFinite(status) ? status : 'missing'}`);
    }
    // Via 只明确支持 responseText，未声明桌面脚本管理器提供的可选
    // responseType/anonymous 扩展，因此以文本作为可移植基线。
    const body = NULL_BODY_STATUSES.has(status) ? null : response.responseText ?? String(response.response || '');
    const statusText = /^[\t\x20-\x7e\x80-\xff]*$/u.test(response.statusText || '') ? response.statusText || '' : '';
    return new Response(body as BodyInit | null, {
        status,
        statusText,
        headers: parseResponseHeaders(response.responseHeaders),
    });
}

function abortError(): DOMException {
    return new DOMException('The request was aborted.', 'AbortError');
}

function errorFromResponse(prefix: string, response?: UserscriptXmlHttpResponse): Error {
    const details = response?.statusText || (response?.status ? `HTTP ${response.status}` : 'unknown error');
    return new Error(`${prefix}: ${details}`);
}

function headersToRecord(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
        result[key] = value;
    });
    return result;
}

/** 合并 Request 与 RequestInit；必要时先克隆并读取一次性请求体，供 GM API 复用。 */
async function resolveRequest(input: RequestInfo | URL, init?: RequestInit): Promise<{
    url: string;
    method: string;
    headers: Headers;
    body?: BodyInit | null;
    credentials?: RequestCredentials;
    signal?: AbortSignal | null;
}> {
    if (input instanceof Request) {
        const request = input.clone();
        const headers = new Headers(request.headers);
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
        let body = init?.body;
        if (body === undefined && request.method !== 'GET' && request.method !== 'HEAD') {
            body = await request.arrayBuffer();
        }
        return {
            url: request.url,
            method: init?.method || request.method,
            headers,
            body,
            credentials: init?.credentials || request.credentials,
            signal: init?.signal || request.signal,
        };
    }

    return {
        url: input instanceof URL ? input.href : String(input),
        method: init?.method || 'GET',
        headers: new Headers(init?.headers),
        body: init?.body,
        credentials: init?.credentials,
        signal: init?.signal,
    };
}

function shouldUseNativeFetch(url: string): boolean {
    try {
        const baseUrl = typeof location === 'undefined' ? 'https://localhost/' : location.href;
        const protocol = new URL(url, baseUrl).protocol;
        return protocol !== 'http:' && protocol !== 'https:';
    } catch {
        return true;
    }
}

/** 访客 Cookie 依赖管理器的匿名、特殊头和禁止重定向能力；未知实现不能静默附带账户 Cookie。 */
function supportsAnonymousDoubao(): boolean {
    const info = typeof GM_info !== 'undefined' ? GM_info : typeof GM !== 'undefined' ? GM?.info : undefined;
    const version = info?.version?.match(/^(\d+)\.(\d+)(?:[.\-]|$)/u);
    return info?.scriptHandler === 'Tampermonkey' && Boolean(version)
        && (Number(version![1]) > 5 || Number(version![1]) === 5 && Number(version![2]) >= 5)
        && /^(?:chrome|chromium|firefox|edge|msedge|opera|brave)$/iu.test(info?.platform?.browserName || '')
        && /^(?:mac|macos|win|windows|linux)$/iu.test(info?.platform?.os || '');
}

/** 以旧式或现代 GM 请求 API 实现兼容 fetch 的传输层。 */
export const userscriptFetch: RuntimeFetch = async (input, init) => {
    const request = await resolveRequest(input, init);
    const guest = readDoubaoGuestRequest(request.url, request.method, request.headers);
    const gmRequest = getUserscriptFunction('GM_xmlhttpRequest', 'xmlHttpRequest');
    // GM_xmlhttpRequest 只接管 HTTP(S) 跨域请求；blob/data 等协议仍交给网页原生 fetch。
    if (!gmRequest || shouldUseNativeFetch(request.url)) {
        if (guest) throw new Error('豆包匿名访客请求需要脚本管理器的跨域请求能力。');
        return globalThis.fetch(input, init);
    }

    const anonymousDoubao = ['https://www.doubao.com/', 'https://ttwid.bytedance.com/ttwid/union/register/'].includes(request.url) || Boolean(guest);
    if (anonymousDoubao && !supportsAnonymousDoubao()) throw new Error('当前运行环境无法发送豆包匿名访客请求。');

    if (guest) {
        request.headers = guest.headers;
        request.headers.set('Cookie', `ttwid=${guest.token}`);
        request.headers.set('Origin', 'https://www.doubao.com');
        request.headers.set('Referer', 'https://www.doubao.com/');
    }
    // 豆包首页、访客注册和翻译请求均排除管理器自动附带的个人 Cookie。

    if (request.signal?.aborted) throw abortError();

    return new Promise<Response>((resolve, reject) => {
        let settled = false;
        let handle: UserscriptXmlHttpRequestHandle | void;
        let cancellationRequested = false;
        // 所有 GM 回调与 AbortSignal 共用一次性完成门，避免取消后迟到回调重复结算。
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            request.signal?.removeEventListener('abort', onAbort);
            callback();
        };
        const onAbort = () => {
            cancellationRequested = true;
            // 管理器 abort 可能同步调用 onload/onerror，先关闭完成门才能保留取消语义。
            finish(() => reject(abortError()));
            try {
                handle?.abort?.();
            } catch {
                // 传输句柄已失效也不能改变已确认的 AbortError。
            }
        };

        request.signal?.addEventListener('abort', onAbort, {once: true});
        try {
            const result = gmRequest({
                method: request.method,
                url: request.url,
                headers: headersToRecord(request.headers),
                data: request.body ?? undefined,
                ...(anonymousDoubao ? {anonymous: true} : {}),
                ...(guest ? {redirect: 'error' as const} : {}),
                onload(response: UserscriptXmlHttpResponse) {
                    // 完成门先关闭再构造 Response；构造失败必须 reject，否则调用方与后续 abort 都无法结算。
                    finish(() => {
                        try {
                            resolve(responseFromUserscript(response));
                        } catch (error) {
                            reject(error);
                        }
                    });
                },
                onerror(response: UserscriptXmlHttpResponse) {
                    finish(() => reject(errorFromResponse('GM_xmlhttpRequest failed', response)));
                },
                ontimeout(response: UserscriptXmlHttpResponse) {
                    finish(() => reject(errorFromResponse('GM_xmlhttpRequest timed out', response)));
                },
                onabort() {
                    finish(() => reject(abortError()));
                },
            });
            handle = result as UserscriptXmlHttpRequestHandle | void;
            // GM 端口在返回句柄前同步取消时，拿到句柄后仍须终止实际请求。
            if (cancellationRequested) onAbort();
            // Safari Userscripts 的 GM.xmlHttpRequest 返回 Promise；旧式管理器
            // 则只调用 onload。两种完成方式共用 finish，避免重复应答。
            if (result && typeof result.then === 'function') {
                result.then(
                    (response: UserscriptXmlHttpResponse) => finish(() => {
                        try {
                            resolve(responseFromUserscript(response));
                        } catch (error) {
                            reject(error);
                        }
                    }),
                    (error: unknown) => finish(() => reject(error)),
                );
            }
        } catch (error) {
            finish(() => reject(error));
        }
    });
};

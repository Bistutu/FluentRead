/**
 * @file src/platform/chatgpt-plan/events.ts
 * 文件职责：严格读取本机 ChatGPT 套餐助手转发的 Responses SSE，确保只有完整完成的上游响应被提交。
 * 主要内容：按 SSE 帧增量解析 UTF-8、校验 JSON 与完成状态、传播取消、识别额度和授权错误；提供实时事件迭代器与完整响应读取函数，拒绝 failed、incomplete、畸形事件和提前断流。
 * 模块边界：本文件只解释已取得的 Response，不读写 OAuth 或配对凭据，不构造翻译/阅读提示词，也不发起供应商网络请求。
 */

import {cancelUnreadResponseBody} from '@/src/platform/http/runtime';

type EventRecord = Record<string, unknown>;
type ResponseErrorKind = 'response' | 'provider' | 'rate-limit' | 'authentication' | 'bad-request';

export class ChatGPTPlanResponseError extends Error {
    readonly kind: ResponseErrorKind;
    readonly retryable: boolean;
    readonly statusCode?: number;
    readonly code?: string;

    constructor(message: string, kind: ResponseErrorKind = 'response', retryable = false, statusCode?: number, code?: string) {
        super(message);
        this.name = 'ChatGPTPlanResponseError';
        this.kind = kind;
        this.retryable = retryable;
        this.statusCode = statusCode;
        this.code = code;
    }
}

function record(value: unknown): EventRecord | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as EventRecord : undefined;
}

function abortIfNeeded(signal?: AbortSignal): void {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('翻译请求已取消', 'AbortError');
}

/** 只读取有界错误码，用户提示不含上游正文、账号、令牌或请求内容。 */
function responseError(event: EventRecord, statusCode?: number): ChatGPTPlanResponseError {
    const response = record(event.response);
    const error = record(response?.error) || record(event.error) || event;
    const rawCode = error.code;
    const code = typeof rawCode === 'string' && /^[a-zA-Z0-9_.:-]{1,120}$/u.test(rawCode) ? rawCode : undefined;
    if (statusCode === 429 || /quota|usage_limit|limit_reached|rate_limit|subscription_sharing_usage_unavailable/iu.test(code || '')) {
        return new ChatGPTPlanResponseError('ChatGPT 套餐额度或请求频率已达上限，请等待额度恢复后重试。', 'rate-limit', false, statusCode ?? 429, code);
    }
    if (statusCode === 401 || statusCode === 403 || /unauthorized|authentication|token_expired|invalid_token/iu.test(code || '')) {
        return new ChatGPTPlanResponseError('ChatGPT 授权已失效或当前账户无权使用所选模型，请重新登录并刷新模型列表。', 'authentication', false, statusCode, code);
    }
    if (event.type === 'response.incomplete' || response?.status === 'incomplete') {
        return new ChatGPTPlanResponseError('ChatGPT 未完成本次生成，部分响应不会作为译文提交；请检查模型或稍后重试。', 'response', false, statusCode, code);
    }
    return new ChatGPTPlanResponseError('ChatGPT 未能完成本次请求，请检查所选模型与本机助手状态后重试。',
        statusCode && statusCode >= 400 && statusCode < 500 ? 'bad-request' : 'provider',
        Boolean(statusCode && statusCode >= 500), statusCode, code);
}

function parseFrame(frame: string): EventRecord | undefined {
    let eventName = '';
    const data: string[] = [];
    for (const line of frame.split(/\r\n|\n|\r/u)) {
        if (!line || line.startsWith(':')) continue;
        const separator = line.indexOf(':');
        const field = separator < 0 ? line : line.slice(0, separator);
        const rawValue = separator < 0 ? '' : line.slice(separator + 1);
        const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
        if (field === 'event') eventName = value;
        if (field === 'data') data.push(value);
    }
    if (!data.length) return undefined;
    const payload = data.join('\n');
    if (payload === '[DONE]') throw new ChatGPTPlanResponseError('ChatGPT 响应在确认完成前结束，部分响应不会作为译文提交。');
    let decoded: unknown;
    try { decoded = JSON.parse(payload); }
    catch { throw new ChatGPTPlanResponseError('ChatGPT 返回了无法解析的流事件，请稍后重试。'); }
    const event = record(decoded);
    if (!event || typeof event.type !== 'string' || !event.type || (eventName && eventName !== event.type)) {
        throw new ChatGPTPlanResponseError('ChatGPT 返回了不符合 Responses 协议的流事件。');
    }
    return event;
}

/**
 * 按帧发布实时事件；即使已有 text delta，也必须收到 response.completed 才算成功。
 * 迭代器停止、取消或终止异常都会取消 reader，释放本机助手的上游流。
 */
export async function* streamChatGPTPlanEvents(response: Response, signal?: AbortSignal): AsyncGenerator<EventRecord> {
    try {
        abortIfNeeded(signal);
        if (!response.ok) {
            let body: EventRecord = {};
            try { body = record(await response.json()) || {}; } catch { /* HTTP 状态足以生成无敏感信息的错误。 */ }
            abortIfNeeded(signal);
            throw responseError(body, response.status);
        }
        if (!response.body || !/^text\/event-stream(?:;|$)/iu.test(response.headers.get('content-type') || '')) {
            throw new ChatGPTPlanResponseError('ChatGPT 没有返回 Responses 事件流，请检查本机助手状态。');
        }
    } catch (error) {
        cancelUnreadResponseBody(response);
        throw error;
    }
    const reader = response.body!.getReader();
    const decoder = new TextDecoder('utf-8', {fatal: true});
    const onAbort = () => { void reader.cancel().catch(() => undefined); };
    signal?.addEventListener('abort', onAbort, {once: true});
    let buffer = '';
    try {
        while (true) {
            abortIfNeeded(signal);
            const chunk = await reader.read();
            abortIfNeeded(signal);
            let text: string;
            try { text = chunk.done ? decoder.decode() : decoder.decode(chunk.value, {stream: true}); }
            catch { throw new ChatGPTPlanResponseError('ChatGPT 返回了无效的 UTF-8 事件流。'); }
            buffer += text;
            let boundary: RegExpExecArray | null;
            while ((boundary = /\r?\n\r?\n|\r\r/u.exec(buffer))) {
                if (boundary.index > 8_000_000) throw new ChatGPTPlanResponseError('ChatGPT 返回的单个流事件过大，已停止读取。');
                const event = parseFrame(buffer.slice(0, boundary.index));
                buffer = buffer.slice(boundary.index + boundary[0].length);
                if (!event) continue;
                const result = record(event.response);
                if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete'
                    || result?.status === 'failed' || result?.status === 'incomplete') throw responseError(event);
                if (event.type === 'response.completed') {
                    if (!result || result.status !== 'completed' || !Array.isArray(result.output)) {
                        throw new ChatGPTPlanResponseError('ChatGPT 完成事件缺少完整响应，部分响应不会作为译文提交。');
                    }
                    if (result.output.some(item => {
                        const output = record(item);
                        return output?.type === 'message' && output.status !== undefined && output.status !== 'completed';
                    })) throw new ChatGPTPlanResponseError('ChatGPT 输出仍未完成，部分响应不会作为译文提交。');
                    yield event;
                    return;
                }
                yield event;
            }
            // 单个事件有界，避免畸形无限行让扩展持续保留无用响应；完整输出仍可跨事件传输。
            if (buffer.length > 8_000_000) throw new ChatGPTPlanResponseError('ChatGPT 返回的单个流事件过大，已停止读取。');
            if (chunk.done) throw new ChatGPTPlanResponseError('ChatGPT 响应流提前中断，部分响应不会作为译文提交；请重试。', 'response', true);
        }
    } finally {
        signal?.removeEventListener('abort', onAbort);
        try { await reader.cancel(); } catch { /* 已终止的传输无需再次取消。 */ }
        reader.releaseLock();
    }
}

/** 读取到完整完成响应，忽略中间推理与 delta，供非流式翻译及用量统计使用。 */
export async function readChatGPTPlanStream(response: Response, signal?: AbortSignal): Promise<EventRecord> {
    // 迭代器仅在 completed 后正常结束；其他终止状态都会抛错。
    let completed!: EventRecord;
    for await (const event of streamChatGPTPlanEvents(response, signal)) {
        if (event.type === 'response.completed') completed = event.response as EventRecord;
    }
    abortIfNeeded(signal);
    return completed;
}

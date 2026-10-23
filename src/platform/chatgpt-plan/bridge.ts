/**
 * @file src/platform/chatgpt-plan/bridge.ts
 * 文件职责：连接用户本机的 ChatGPT 套餐助手，隔离配对凭证与 OAuth 令牌。
 * 主要内容：仅显式开发构建的请求入口可连接固定 loopback 地址；公共版本不读取配对凭证、不调用本机助手。独立凭据存储与状态/模型校验，配对存储等待共享请求取消和元信息预算，流取消立即释放读取锁，不等待底层清理握手；所有错误只输出稳定代码及安全说明。
 * 模块边界：本模块不处理翻译提示词或设置组件；OAuth 令牌仅由本机助手持有，配对凭证不进入 Config、配置历史、导出或云同步。
 */
import {cancelResponseReader, cancelUnreadResponseBody, abortErrorFromSignal, createRuntimeAbortContext, runtimeFetch, type RuntimeFetch} from '@/src/platform/http/runtime';
import {chatGPTPlanDevelopmentEnabled} from './buildMode';

export const CHATGPT_PLAN_BRIDGE_URL = 'http://127.0.0.1:18743';
export const CHATGPT_PLAN_USAGE_URL = 'https://chatgpt.com/#settings/Usage';
export const CHATGPT_PLAN_PAIRING_KEY = 'fluentread.chatgptPlan.pairing.v1';
export interface ChatGPTPlanStatus {
    paired: boolean;
    connected: boolean;
    sharing: boolean;
    account?: {name?: string; email?: string};
    authPending?: boolean;
    error?: string;
    revocationConfirmed?: boolean;
}
export interface ChatGPTPlanModel {slug: string; display_name: string}
export interface ChatGPTPlanPayload {model: string; input: unknown[]; instructions?: string; tools?: unknown[]}
type ChatGPTPlanErrorKind = 'authentication' | 'rate-limit' | 'timeout' | 'network' | 'bad-request' | 'provider' | 'response';
export class ChatGPTPlanError extends Error {
    readonly kind: ChatGPTPlanErrorKind;
    readonly retryable: boolean;
    readonly statusCode?: number;
    constructor(public readonly code: string, public readonly status?: number) {
        super(CHATGPT_PLAN_ERROR_MESSAGES[code] || 'ChatGPT 请求未完成，请重新检查本机助手和账户授权。');
        this.name = 'ChatGPTPlanError';
        const authentication = ['not_connected', 'sharing_disabled', 'oauth_failed', 'oauth_cancelled', 'pairing_failed'].includes(code);
        this.statusCode = status ?? (code === 'quota_exceeded' ? 429 : authentication ? code === 'sharing_disabled' ? 403 : 401 : undefined);
        if (code === 'public_unavailable') {this.kind = 'provider';this.retryable = false;this.statusCode = 503;}
        else if (code === 'quota_exceeded' || status === 429) {this.kind = 'rate-limit';this.retryable = false;}
        else if (authentication || status === 401 || status === 403) {this.kind = 'authentication';this.retryable = false;}
        else if (status === 408) {this.kind = 'timeout';this.retryable = true;}
        else if (status !== undefined && status >= 500) {this.kind = 'provider';this.retryable = true;}
        else if (status !== undefined && status >= 400) {this.kind = 'bad-request';this.retryable = false;}
        else if (code === 'helper_unavailable') {this.kind = 'network';this.retryable = true;}
        else {this.kind = 'response';this.retryable = false;}
    }
}
const CHATGPT_PLAN_ERROR_MESSAGES: Record<string, string> = {
    public_unavailable: '当前版本尚未开放 ChatGPT 登录，请先选择其他翻译服务；已有配置会保留。',
    helper_unavailable: '无法连接 ChatGPT 本机助手，请启动助手后重试。',
    pairing_failed: '本机配对码无效或已过期，请使用助手显示的新配对码。',
    not_connected: '请先在翻译服务设置中连接 ChatGPT 账户。',
    sharing_disabled: '请在 ChatGPT 授权时允许使用套餐。',
    quota_exceeded: 'ChatGPT 套餐额度已用尽，请在 ChatGPT 设置中管理用量。',
    oauth_cancelled: 'ChatGPT 授权已取消。',
    invalid_response: 'ChatGPT 本机助手返回的数据无效，请更新助手后重试。',
    session_changed: 'ChatGPT 账户已更改，请重新发起请求。',
    oauth_failed: 'ChatGPT 授权未完成，请重新授权。',
    revoke_unconfirmed: '本机已退出；请在 ChatGPT 设置中确认并移除应用授权。',
};
export function normalizeChatGPTPlanErrorCode(code: unknown): string {
    if (typeof code !== 'string') return 'invalid_response';
    if (['subscription_sharing_usage_limit_exceeded', 'subscription_sharing_usage_unavailable', 'usage_limit', 'insufficient_quota'].includes(code)) return 'quota_exceeded';
    if (['pairing_required', 'invalid_pairing', 'invalid_pairing_code', 'pairing_expired'].includes(code)) return 'pairing_failed';
    if (['plan_usage_disabled', 'insufficient_scope', 'chatgpt_plan_disabled', 'plan_permission_required'].includes(code)) return 'sharing_disabled';
    if (['login_required', 'invalid_grant', 'unauthorized', 'sign_in_required', 'invalid_token', 'token_expired', 'invalid_refresh_token', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused', 'authentication_error', 'invalid_api_key'].includes(code)) return 'not_connected';
    if (code === 'access_denied' || code === 'auth_cancelled') return 'oauth_cancelled';
    if (code === 'auth_failed' || code === 'auth_expired') return 'oauth_failed';
    return Object.hasOwn(CHATGPT_PLAN_ERROR_MESSAGES, code) ? code : 'invalid_response';
}
interface PairingStore {read(): Promise<string | undefined>; write(token: string): Promise<void>}
export interface ChatGPTPlanBridgeOptions {fetch: RuntimeFetch; storage: PairingStore}
function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function safeString(value: unknown, max: number): string | undefined {
    return typeof value === 'string' && value.length <= max ? value : undefined;
}
/** 只从助手响应中保留可展示字段，防止未来服务端意外把令牌带入 UI。 */
export function readChatGPTPlanStatus(value: unknown): Omit<ChatGPTPlanStatus, 'paired'> {
    const data = record(value);
    if (!data || typeof data.connected !== 'boolean' || typeof data.sharing !== 'boolean') throw new ChatGPTPlanError('invalid_response');
    const account = record(data.account);
    return {connected: data.connected, sharing: data.sharing,
        ...(account ? {account: {name: safeString(account.name, 300), email: safeString(account.email, 320)}} : {}),
        authPending: data.authPending === true,
        ...(data.error ? {error: normalizeChatGPTPlanErrorCode(data.error)} : {})};
}
export function readChatGPTPlanModels(value: unknown): ChatGPTPlanModel[] {
    const data = record(value);
    if (!data || !Array.isArray(data.models) || data.models.length > 1000) throw new ChatGPTPlanError('invalid_response');
    const seen = new Set<string>();
    return data.models.map(raw => {
        const item = record(raw);
        const slug = safeString(item?.slug, 256)?.trim();
        const name = safeString(item?.display_name, 300)?.trim();
        if (!slug || !name || seen.has(slug)) throw new ChatGPTPlanError('invalid_response');
        seen.add(slug);
        return {slug, display_name: name};
    });
}
/** 主动结束调用者等待，底层 fetch 或 reader 即使忽略取消也不能提交迟到结果。 */
async function waitForBridgeTask<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
    let cancel!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
        cancel = () => reject(abortErrorFromSignal(signal));
        signal.addEventListener('abort', cancel, {once: true});
        if (signal.aborted) cancel();
    });
    try {return await Promise.race([task, interrupted]);}
    finally {signal.removeEventListener('abort', cancel);}
}
/** 元信息正文属于本次请求；持有 reader 到结束，取消时立即释放未读正文。 */
async function readBridgeMetadata(response: Response, signal: AbortSignal): Promise<string> {
    if (!response.body) throw new ChatGPTPlanError('invalid_response');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    const cancel = () => {void reader.cancel(signal.reason).catch(() => undefined);};
    signal.addEventListener('abort', cancel, {once: true});
    let text = '';
    try {
        while (true) {
            const item = await waitForBridgeTask(reader.read(), signal);
            if (item.done) return text + decoder.decode();
            text += decoder.decode(item.value, {stream: true});
        }
    } finally {signal.removeEventListener('abort', cancel);reader.releaseLock();}
}
export function createChatGPTPlanBridge(options: ChatGPTPlanBridgeOptions) {
    let generation = 0;
    let saving: Promise<void> = Promise.resolve();
    const active = new Set<AbortController>();
    const invalidate = () => {
        generation++;
        for (const controller of active) controller.abort(new ChatGPTPlanError('session_changed'));
        active.clear();
    };
    async function readPairing(): Promise<string | undefined> {
        try {return await options.storage.read();} catch {throw new ChatGPTPlanError('helper_unavailable');}
    }
    async function request(path: string, body: unknown = {}, signal?: AbortSignal, stream = false, anonymous = false): Promise<Response> {
        if (signal?.aborted) throw abortErrorFromSignal(signal);
        const started = generation;
        const controller = new AbortController();
        const onAbort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', onAbort, {once: true});
        if (signal?.aborted) onAbort();
        active.add(controller);
        const timeout = stream ? undefined : createRuntimeAbortContext(15_000, controller.signal);
        const requestSignal = timeout?.signal ?? controller.signal;
        let streamAbort: (() => void) | undefined;
        let result: Response;
        const cleanup = () => {active.delete(controller); signal?.removeEventListener('abort', onAbort); if (streamAbort) controller.signal.removeEventListener('abort', streamAbort); timeout?.cleanup();};
        try {
            const token = anonymous ? undefined : await waitForBridgeTask(readPairing(), requestSignal);
            if (requestSignal.aborted) throw abortErrorFromSignal(requestSignal);
            if (!anonymous && !token) throw new ChatGPTPlanError('not_connected');
            if (started !== generation) throw new ChatGPTPlanError('session_changed');
            const transport = options.fetch(`${CHATGPT_PLAN_BRIDGE_URL}${path}`, {
                method: 'POST', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
                body: JSON.stringify(body), credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
                signal: requestSignal,
            });
            // 非合作 transport 可能在取消后才返回 Response，必须释放它的正文。
            void transport.then(response => {if (requestSignal.aborted) cancelUnreadResponseBody(response);}, () => undefined);
            const response = await waitForBridgeTask(transport, requestSignal);
            if (started !== generation) throw new ChatGPTPlanError('session_changed');
            if (requestSignal.aborted) throw abortErrorFromSignal(requestSignal);
            if (!response.ok) {
                const text = await readBridgeMetadata(response, requestSignal);
                let raw: unknown;try {raw = JSON.parse(text);} catch { /* 未知上游正文不透传。 */ }
                const data = record(raw);
                throw new ChatGPTPlanError(normalizeChatGPTPlanErrorCode(record(data?.error)?.code), response.status);
            }
            if (!stream) {
                const text = await readBridgeMetadata(response, requestSignal);
                if (started !== generation) throw new ChatGPTPlanError('session_changed');
                if (requestSignal.aborted) throw abortErrorFromSignal(requestSignal);
                result = new Response(text, {status: response.status, headers: response.headers});
            } else {
                if (!response.body) throw new ChatGPTPlanError('invalid_response');
                // 保留控制器直到最后一块数据。注销和重新配对会中断尚在读取的 SSE。
                const reader = response.body.getReader();
                streamAbort = () => cancelResponseReader(reader);
                controller.signal.addEventListener('abort', streamAbort, {once: true});
                const bodyStream = new ReadableStream<Uint8Array>({
                    async pull(target) {
                        try {
                            if (controller.signal.aborted || started !== generation) throw abortErrorFromSignal(controller.signal);
                            const item = await waitForBridgeTask(reader.read(), controller.signal);
                            if (controller.signal.aborted || started !== generation) throw abortErrorFromSignal(controller.signal);
                            if (item.done) {cleanup(); reader.releaseLock(); target.close();}
                            else target.enqueue(item.value);
                        } catch (error) {cleanup(); cancelResponseReader(reader); target.error(error);}
                    },
                    cancel(reason) {controller.abort(reason); cleanup(); cancelResponseReader(reader);},
                });
                result = new Response(bodyStream, {status: response.status, headers: response.headers});
            }
        } catch (error) {
            cleanup();
            if (requestSignal.aborted) throw abortErrorFromSignal(requestSignal);
            if (error instanceof ChatGPTPlanError) throw error;
            throw new ChatGPTPlanError('helper_unavailable');
        } finally {if (!stream) cleanup();}
        return result;
    }
    async function metadata(path: string, body: unknown = {}, anonymous = false, signal?: AbortSignal): Promise<unknown> {
        const started = generation;
        const response = await request(path, body, signal, false, anonymous);
        let value: unknown;
        try {value = await response.json();} catch {throw new ChatGPTPlanError('invalid_response');}
        if (started !== generation) throw new ChatGPTPlanError('session_changed');
        return value;
    }
    return {
        async status(): Promise<ChatGPTPlanStatus> {
            const started = generation, controller = new AbortController();
            const timeout = createRuntimeAbortContext(15_000, controller.signal);
            active.add(controller);
            try {
                const paired = await waitForBridgeTask(readPairing(), timeout.signal);
                if (started !== generation) throw new ChatGPTPlanError('session_changed');
                if (!paired) return {paired: false, connected: false, sharing: false, authPending: false};
                // 首次凭证检查与随后 HTTP 请求共用这一预算，存储耗时不能重置截止时间。
                return {paired: true, ...readChatGPTPlanStatus(await metadata('/status', {}, false, timeout.signal))};
            } finally {active.delete(controller); timeout.cleanup();}
        },
        async pair(code: string): Promise<ChatGPTPlanStatus> {
            if (!/^[a-zA-Z0-9-]{16,160}$/u.test(code.trim())) throw new ChatGPTPlanError('pairing_failed');
            invalidate();
            const started = generation;
            const data = record(await metadata('/pair', {code: code.trim()}, true));
            const token = safeString(data?.bridgeToken, 256);
            if (!token || token.length < 32 || started !== generation) throw new ChatGPTPlanError('pairing_failed');
            const save = saving.then(async () => {
                if (started !== generation) throw new ChatGPTPlanError('session_changed');
                try {await options.storage.write(token);} catch {throw new ChatGPTPlanError('helper_unavailable');}
            });
            saving = save.catch(() => {});
            await save;
            if (started !== generation) throw new ChatGPTPlanError('session_changed');
            return this.status();
        },
        async signIn(newAccount = false): Promise<string> {
            const data = record(await metadata('/auth/start', {newAccount}));
            const url = safeString(data?.authorizationUrl, 16_384);
            if (!url) throw new ChatGPTPlanError('invalid_response');
            let parsed: URL;try {parsed = new URL(url);} catch {throw new ChatGPTPlanError('invalid_response');}
            if (parsed.origin !== 'https://auth.openai.com' || parsed.pathname !== '/api/accounts/authorize' || parsed.username || parsed.password) throw new ChatGPTPlanError('invalid_response');
            return url;
        },
        async cancelSignIn(): Promise<ChatGPTPlanStatus> {await metadata('/auth/cancel'); return this.status();},
        async disconnect(): Promise<ChatGPTPlanStatus> {
            invalidate();
            const logout = record(await metadata('/logout'));
            const status = await this.status();
            return {...status, ...(logout?.revocationConfirmed === false ? {revocationConfirmed: false, error: 'revoke_unconfirmed'} : {})};
        },
        async models(): Promise<ChatGPTPlanModel[]> {return readChatGPTPlanModels(await metadata('/models'));},
        respond(payload: ChatGPTPlanPayload, signal?: AbortSignal): Promise<Response> {return request('/responses', payload, signal, true);},
    };
}
const bridge = createChatGPTPlanBridge({fetch: runtimeFetch, storage: {
    async read() {const stored = await browser.storage.local.get(CHATGPT_PLAN_PAIRING_KEY); return safeString(stored[CHATGPT_PLAN_PAIRING_KEY], 256);},
    async write(token) {await browser.storage.local.set({[CHATGPT_PLAN_PAIRING_KEY]: token});},
}});
export const chatGPTPlanBridge = bridge;
export const requestChatGPTPlanResponse = (payload: ChatGPTPlanPayload, signal?: AbortSignal) => chatGPTPlanDevelopmentEnabled
    ? bridge.respond(payload, signal)
    : Promise.reject(new ChatGPTPlanError('public_unavailable'));

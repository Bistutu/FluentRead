/**
 * @file src/providers/translation/doubao-web.ts
 * 文件职责：适配豆包官方网页的匿名文章翻译接口，作为免费翻译池的一条可失败换线的实验线路。
 * 主要内容：在单次调用内初始化并复用匿名访客、最多刷新一次失效访客，严格读取完整 SSE 译文；按 Unicode 码点分块并保护原文本槽、换行、边缘空白、取消和 HTTP 限流信息。
 * 模块边界：只通过 runtimeFetch 访问固定官方端点，不读取个人 Cookie、配置或持久化访客令牌；平台层把受限内部访客头转换为匿名 Cookie，调度、超时和失败换线由上层免费池负责。
 */
import {parseTranslationSlots, serializeTranslationSlots} from '@/src/core/translation/slotProtocol';
import {getTranslationGlossarySourceText, type TranslationProviderRequest} from '@/src/services/translation/requestSnapshot';
import {abortErrorFromSignal, runtimeFetch} from '@/src/platform/http/runtime';
import {createHttpStatusError, createProviderCodeError, readJsonResponse} from '@/src/platform/http/errors';
import {DOUBAO_GUEST_HEADER} from '@/src/platform/http/doubaoGuest';

export const DOUBAO_WEB_HOME = 'https://www.doubao.com/';
export const DOUBAO_WEB_TRANSLATION_URL = 'https://www.doubao.com/samantha/plugin/stream_article_translate';
export const DOUBAO_WEB_REGISTER_URL = 'https://ttwid.bytedance.com/ttwid/union/register/';
const MAX_CHUNK_CODEPOINTS = 2000;
const MAX_STREAM_CHARACTERS = 2_000_000;
const MAX_EVENT_CHARACTERS = 256_000;
const VISITOR_ERROR_CODES = new Set([710012000, 710012001]);
const SIMPLIFIED_CHINESE_CODES: Readonly<Record<string, string>> = {zh: 'zh', 'zh-cn': 'zh', 'zh-hans': 'zh', 'zh-chs': 'zh'};

interface GuestSession {ttwid?: string; refreshed: boolean; teaUuid: string;}
interface StreamState {text: string; done: boolean;}

function checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) throw abortErrorFromSignal(signal);
}

async function checkResponseAbort(response: Response, signal?: AbortSignal): Promise<void> {
    if (!signal?.aborted) return;
    await response.body?.cancel().catch(() => {});
    throw abortErrorFromSignal(signal);
}

function failure(message: string, statusCode: 400 | 502 = 502): Error {
    return Object.assign(new Error(message), {
        statusCode, freeFailure: statusCode === 400 ? 'request' : 'unavailable',
    });
}

function invalidStream(): Error { return failure('豆包网页翻译返回的流数据无效'); }
function incompleteTranslation(): Error { return failure('豆包网页翻译返回的译文不完整'); }

/** 仅接受单个 Cookie 值，禁止空白、分隔符和控制字符进入平台层的受限请求头。 */
function validVisitor(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9%._~|+/=-]{1,4096}$/u.test(value);
}

function visitorFromResponse(response: Response): string | undefined {
    const value = response.headers.get('set-cookie')?.match(/(?:^|[,;]\s*)ttwid=([^;,\s]+)/u)?.[1];
    return validVisitor(value) ? value : undefined;
}

async function responseText(response: Response, signal?: AbortSignal): Promise<string> {
    try {
        const result = await response.text();
        checkAbort(signal);
        return result;
    } catch {
        checkAbort(signal);
        throw invalidStream();
    }
}

async function bootstrapVisitor(signal?: AbortSignal): Promise<string> {
    checkAbort(signal);
    const home = await runtimeFetch(DOUBAO_WEB_HOME, {method: 'GET', credentials: 'omit', signal});
    await checkResponseAbort(home, signal);
    if (!home.ok) throw createHttpStatusError(home, '豆包网页翻译访客初始化失败');
    const cookie = visitorFromResponse(home);
    if (cookie) return cookie;
    const html = await responseText(home, signal);
    const htmlVisitor = html.match(/["']ttwid["']\s*:\s*["']([^"'\\]+)["']/u)?.[1];
    if (validVisitor(htmlVisitor)) return htmlVisitor;

    // 官网未暴露访客字段时仅注册新的匿名访客，不读取或附带浏览器的已有 Cookie。
    const registered = await runtimeFetch(DOUBAO_WEB_REGISTER_URL, {
        method: 'POST', credentials: 'omit', signal, headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({region: 'cn', aid: 1768, needFid: false, service: 'www.doubao.com',
            union: true, cbUrlProtocol: 'https', migrate_info: {ticket: '', source: 'node'}}),
    });
    await checkResponseAbort(registered, signal);
    if (!registered.ok) throw createHttpStatusError(registered, '豆包网页翻译访客初始化失败');
    const registeredCookie = visitorFromResponse(registered);
    if (registeredCookie) return registeredCookie;
    const body = await readJsonResponse<{data?: {ttwid?: unknown}} | null>(registered, '豆包网页翻译访客初始化失败');
    checkAbort(signal);
    if (!validVisitor(body?.data?.ttwid)) throw failure('豆包网页翻译访客初始化失败');
    return body.data.ttwid;
}

function providerError(code: unknown): Error {
    const numeric = typeof code === 'number' ? code : typeof code === 'string' && /^\d{1,16}$/u.test(code) ? Number(code) : undefined;
    return Object.assign(createProviderCodeError('豆包网页翻译请求失败', code), {
        statusCode: numeric !== undefined && VISITOR_ERROR_CODES.has(numeric) ? 403 : 502,
        freeFailure: numeric !== undefined && VISITOR_ERROR_CODES.has(numeric) ? 'blocked' : 'unavailable',
        ...(numeric !== undefined && VISITOR_ERROR_CODES.has(numeric) ? {doubaoVisitorExpired: true} : {}),
    });
}

function consumeEvent(block: string, state: StreamState): void {
    let event = '';
    const data: string[] = [];
    for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /u, ''));
    }
    if (event === 'done') {
        if (data.some(value => value.trim())) throw invalidStream();
        state.done = true;
        return;
    }
    if (!data.length) return;
    if (event !== 'json') throw invalidStream();
    const payload = data.join('\n');
    let body: unknown;
    try {body = JSON.parse(payload);} catch {throw invalidStream();}
    if (!body || typeof body !== 'object') throw invalidStream();
    const message = body as {code?: unknown; data?: {items?: unknown}};
    if (message.code !== 0) throw providerError(message.code);
    if (message.data?.items !== undefined) {
        if (!Array.isArray(message.data.items) || message.data.items.length !== 1) throw invalidStream();
        const item: unknown = message.data.items[0];
        if (!item || typeof item !== 'object') throw invalidStream();
        const {index, res} = item as {index?: unknown; res?: unknown};
        if (index !== 0 || typeof res !== 'string' || !res.trim()) throw invalidStream();
        // json 事件携带该索引的完整译文快照，重复事件不能重复拼接已收到的文字。
        state.text = res;
    } else throw invalidStream();
}

/** 已收到 done 即释放连接；取消会主动取消 reader，不等待服务器结束长连接。 */
async function readTranslationStream(response: Response, signal?: AbortSignal): Promise<string> {
    if (response.headers.get('content-type')?.includes('application/json')) {
        const body = await readJsonResponse<{code?: unknown} | null>(response, '豆包网页翻译返回的流数据无效');
        checkAbort(signal);
        if (body?.code !== 0) throw providerError(body?.code);
        throw incompleteTranslation();
    }
    if (!response.body) throw invalidStream();
    const reader = response.body.getReader();
    const onAbort = () => {void reader.cancel().catch(() => {});};
    signal?.addEventListener('abort', onAbort, {once: true});
    const decoder = new TextDecoder();
    const state: StreamState = {text: '', done: false};
    let buffer = '';
    let totalCharacters = 0;
    try {
        while (!state.done) {
            checkAbort(signal);
            let part: ReadableStreamReadResult<Uint8Array>;
            try {part = await reader.read();} catch {checkAbort(signal); throw invalidStream();}
            checkAbort(signal);
            // done 事件必须先于 EOF 完整到达；连接关闭本身不能证明翻译完成。
            if (part.done) throw incompleteTranslation();
            const text = decoder.decode(part.value, {stream: true});
            totalCharacters += text.length;
            if (totalCharacters > MAX_STREAM_CHARACTERS) throw invalidStream();
            buffer += text;
            // CRLF 的两个字符可来自不同网络块；仅在寻找完整事件时规范换行。
            const normalized = buffer.replace(/\r\n/gu, '\n');
            let cursor = 0;
            let boundary: number;
            while ((boundary = normalized.indexOf('\n\n', cursor)) >= 0) {
                const block = normalized.slice(cursor, boundary);
                if (block.length > MAX_EVENT_CHARACTERS) throw invalidStream();
                consumeEvent(block, state);
                cursor = boundary + 2;
                if (state.done) break;
            }
            buffer = normalized.slice(cursor);
            if (buffer.length > MAX_EVENT_CHARACTERS) throw invalidStream();
        }
        if (!state.text.trim()) throw incompleteTranslation();
        return state.text.trim();
    } finally {
        signal?.removeEventListener('abort', onAbort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

async function translateChunk(text: string, target: string, session: GuestSession, signal?: AbortSignal): Promise<string> {
    while (true) {
        checkAbort(signal);
        session.ttwid ??= await bootstrapVisitor(signal);
        checkAbort(signal);
        const url = `${DOUBAO_WEB_TRANSLATION_URL}?aid=586864&device_platform=web&tea_uuid=${session.teaUuid}&version=1.38.0`;
        const response = await runtimeFetch(url, {
            method: 'POST', credentials: 'omit', signal,
            headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', [DOUBAO_GUEST_HEADER]: session.ttwid},
            body: JSON.stringify({raw_text: [text], target_lang: target, translate_service: '1', frontend_source: 1, scene: 2}),
        });
        await checkResponseAbort(response, signal);
        if (!response.ok) throw createHttpStatusError(response, '豆包网页翻译请求失败');
        try {return await readTranslationStream(response, signal);} catch (error) {
            checkAbort(signal);
            if (!(error instanceof Error) || !(error as Error & {doubaoVisitorExpired?: boolean}).doubaoVisitorExpired || session.refreshed) throw error;
            session.refreshed = true;
            session.ttwid = undefined;
        }
    }
}

async function translatePlain(text: string, target: string, session: GuestSession, signal?: AbortSignal): Promise<string> {
    let result = '';
    for (const line of text.split(/(\r\n|\r|\n)/u)) {
        const points = Array.from(line);
        for (let offset = 0; offset < points.length; offset += MAX_CHUNK_CODEPOINTS) {
            checkAbort(signal);
            const chunk = points.slice(offset, offset + MAX_CHUNK_CODEPOINTS).join('');
            const content = chunk.trim();
            if (!content) {result += chunk; continue;}
            const prefix = chunk.slice(0, chunk.indexOf(content));
            const suffix = chunk.slice(prefix.length + content.length);
            result += prefix + await translateChunk(content, target, session, signal) + suffix;
        }
    }
    return result;
}

/** 按接口约定映射目标码，不把繁体目标映射到简体；访客仅在本次调用的局部对象中存活。 */
export async function translateDoubaoWeb(request: TranslationProviderRequest<string>): Promise<string> {
    const {origin, abortSignal} = request;
    checkAbort(abortSignal);
    if (typeof origin !== 'string') throw failure('豆包网页翻译仅支持文本输入', 400);
    if (!origin.trim()) return origin;
    const targetCode = (request.targetLanguage || 'zh-Hans').trim().replaceAll('_', '-').toLowerCase();
    const target = SIMPLIFIED_CHINESE_CODES[targetCode] ?? targetCode;
    // 普通目标码按网页接口约定透传；地区码和繁体码未验证，不能静默退回另一文字体系。
    if (!/^[a-z]{2,3}$/u.test(target) || target === 'auto') throw failure('豆包网页翻译不支持当前目标语言', 400);
    const source = (request.sourceLanguage || 'auto').trim().replaceAll('_', '-').toLowerCase();
    if ((SIMPLIFIED_CHINESE_CODES[source] ?? source) === target) return origin;
    const random = new Uint8Array(18);
    crypto.getRandomValues(random);
    const session: GuestSession = {refreshed: false, teaUuid: `${random[0]! % 9 + 1}${Array.from(random.slice(1), byte => byte % 10).join('')}`};
    const slots = getTranslationGlossarySourceText(origin);
    if (!Array.isArray(slots)) return translatePlain(slots, target, session, abortSignal);
    const translations: string[] = [];
    for (const slot of slots) translations.push(await translatePlain(slot, target, session, abortSignal));
    const nonce = origin.match(/^___FLUENTREAD_([a-z0-9_-]+)_0_BEGIN___/iu)![1]!;
    const packet = serializeTranslationSlots(slots, nonce);
    const result = serializeTranslationSlots(translations, nonce).payload;
    if (!parseTranslationSlots(packet, result)) throw incompleteTranslation();
    return result;
}

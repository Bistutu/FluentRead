/**
 * @file src/providers/translation/free-extra-web.ts
 * 文件职责：适配搜狗、Reverso、Lingva 和 Apertium 四个匿名网页翻译候选。
 * 主要内容：按码点预算且不切术语标记，读取搜狗网页参数并识别内层业务错误，构造 Reverso 请求，明确 Lingva 公共实例的访问限制，调用 Apertium 动态语言对；仅短期记忆有效语言列表确认的不支持方向，不共享在途请求或取消信号；保留文本槽/换行/边缘空白并响应取消，已发请求的未读正文结算后才结束候选。
 * 模块边界：不读取用户 Cookie、凭据或代理；免费链的超时、冷却和并发由上层编排负责。
 */
import MD5 from 'crypto-js/md5';
import {translateFreeTextChunks} from './freeTextChunks';
import {serializeTranslationSlots} from '@/src/core/translation/serialization';
import {getTranslationGlossarySourceText} from '@/src/services/translation/requestSnapshot';
import {abortErrorFromSignal, runtimeFetch} from '@/src/platform/http/runtime';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';

export type ExtraFreeWebProvider =
    | 'sogouFree'
    | 'reversoFree'
    | 'lingvaFree'
    | 'apertiumFree';

export type FreeFailure = 'rate-limit' | 'quota' | 'blocked' | 'unavailable' | 'request';

const SOGOU_HOME = 'https://translate.sogou.com/';
const SOGOU_ENDPOINT = 'https://translate.sogou.com/api/transpc/text/result';
const REVERSO_ENDPOINT = 'https://api.reverso.net/translate/v1/translation';
const LINGVA_INSTANCE = 'https://lingva.ml';
const APERTIUM_ENDPOINT = 'https://apertium.org/apy';
const MAX_CHUNK_CODEPOINTS = 1000;
const APERTIUM_UNSUPPORTED_DIRECTION_TTL_MS = 5 * 60_000;
const APERTIUM_UNSUPPORTED_DIRECTION_LIMIT = 32;
// 只保存公共语言方向与到期时间，不保存正文、配置、请求或调用方信号。
const unsupportedApertiumDirections = new Map<string, number>();

function failure(message = '免费网页翻译接口请求失败', statusCode = 502, freeFailure: FreeFailure = 'unavailable'): Error {
    return Object.assign(new Error(message), {statusCode, freeFailure});
}

function checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) throw abortErrorFromSignal(signal);
}

/** 错误或迟到取消仍等未读正文结束，清理失败不覆盖原始分类。 */
async function settleUnreadResponse(response: Response): Promise<void> {
    if (!response.bodyUsed) {
        try {await response.clone().arrayBuffer();}
        catch { /* 保留原始 HTTP、取消或协议错误。 */ }
    }
}

function language(value: string, target: boolean): string {
    const code = value.trim().replaceAll('_', '-').toLowerCase();
    if (target && code === 'auto') throw failure('搜狗翻译不接受自动目标语言', 400, 'request');
    if (code === 'zh' || code === 'zh-cn' || code === 'zh-hans' || code === 'zh-chs') return 'zh-CHS';
    if (code === 'zh-tw' || code === 'zh-hk' || code === 'zh-mo' || code === 'zh-hant' || code === 'zh-cht') return 'zh-CHT';
    return code === 'auto' ? 'auto' : code;
}

function uuid(): string {
    return crypto.randomUUID();
}

async function getSogouSecret(signal?: AbortSignal): Promise<string> {
    checkAbort(signal);
    const response = await runtimeFetch(SOGOU_HOME, {method: 'GET', credentials: 'omit', signal});
    try {
        checkAbort(signal);
        if (!response.ok) throw createHttpStatusError(response, '搜狗翻译首页请求失败');
        const html = await response.text();
        checkAbort(signal);
        const match = html.match(/"secretCode"\s*:\s*(\d+)/u);
        if (!match?.[1]) throw failure('搜狗翻译首页缺少匿名参数', 502, 'unavailable');
        return match[1];
    } finally {await settleUnreadResponse(response);}
}

type SogouResponse = {
    status?: unknown;
    data?: {translate?: {dit?: unknown; errorCode?: unknown}};
};

async function translateSogouChunk(text: string, source: string, target: string, signal: AbortSignal | undefined, secretPromise: Promise<string>): Promise<string> {
    const secret = await secretPromise;
    checkAbort(signal);
    const requestUuid = uuid();
    const signature = MD5(source + target + text + secret).toString();
    const response = await runtimeFetch(SOGOU_ENDPOINT, {
        method: 'POST',
        credentials: 'omit',
        signal,
        headers: {'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*'},
        body: JSON.stringify({client: 'pc', exchange: false, fr: 'browser_pc', from: source, needQc: 1, s: signature, text, to: target, uuid: requestUuid}),
    });
    try {
        checkAbort(signal);
        if (!response.ok) throw createHttpStatusError(response, '搜狗翻译请求失败');
        const result = await readJsonResponse<SogouResponse | null>(response, '搜狗翻译返回的不是有效 JSON');
        checkAbort(signal);
        if (result?.status !== 0 && result?.status !== '0') throw failure('搜狗翻译业务请求失败');
        const translated = result.data?.translate?.dit;
        const errorCode = result.data?.translate?.errorCode;
        // 官方外层 status=0 仍可能返回空译文；只展示短格式内层错误码，不回显第三方正文。
        if (typeof translated !== 'string' || !translated.trim()) {
            if (typeof errorCode === 'string' && /^s\d{1,6}$/u.test(errorCode)) {
                throw failure(`搜狗翻译未返回译文（错误码 ${errorCode}）；请稍后重试或停用此服务`);
            }
            throw failure('搜狗翻译结果为空');
        }
        return translated.trim();
    } finally {await settleUnreadResponse(response);}
}

function genericLanguage(value: string, _target: boolean): string {
    const code = value.trim().replaceAll('_', '-').toLowerCase();
    if (code === 'zh-hans' || code === 'zh-chs' || code === 'zh-cn') return 'zh';
    if (code === 'zh-hant' || code === 'zh-cht' || code === 'zh-tw' || code === 'zh-hk') throw failure('该匿名服务不区分繁体中文', 400, 'request');
    return code;
}

async function translateReversoChunk(text: string, source: string, target: string, signal?: AbortSignal): Promise<string> {
    const response = await runtimeFetch(REVERSO_ENDPOINT, {
        method: 'POST', credentials: 'omit', signal,
        headers: {'Content-Type': 'application/json', Accept: 'application/json', 'x-reverso-origin': 'translation.web'},
        body: JSON.stringify({format: 'text', from: reversoLanguage(source, false), to: reversoLanguage(target, true), input: text, options: {languageDetection: true, contextResults: true, origin: 'translation.web'}}),
    });
    try {
        checkAbort(signal);
        if (!response.ok) throw createHttpStatusError(response, 'Reverso 翻译请求失败');
        const result = await readJsonResponse<{translation?: unknown} | null>(response, 'Reverso 返回的不是有效 JSON');
        checkAbort(signal);
        const value = result?.translation;
        if (!Array.isArray(value) || value.some(item => typeof item !== 'string') || !value.length || !value.join('').trim()) throw failure('Reverso 翻译结果为空');
        return value.join('').trim();
    } finally {await settleUnreadResponse(response);}
}

const reversoCodes: Record<string, string> = {en: 'eng', 'zh-hans': 'chi', 'zh-chs': 'chi', zh: 'chi', fr: 'fra', de: 'deu', es: 'spa', it: 'ita', pt: 'por', ja: 'jpn', ko: 'kor', ru: 'rus', ar: 'ara', nl: 'nld', pl: 'pol', tr: 'tur'};
function reversoLanguage(value: string, target: boolean): string {
    const code = genericLanguage(value, target);
    return reversoCodes[code] || code;
}

const apertiumCodes: Record<string, string> = {
    en: 'eng', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', ca: 'cat', gl: 'glg', ro: 'ron',
    eo: 'epo', oc: 'oci', cy: 'cym', nb: 'nob', no: 'nob', sv: 'swe', da: 'dan', is: 'isl',
    uk: 'ukr', ru: 'rus', pl: 'pol', cs: 'ces', sk: 'slk', sl: 'slv', hr: 'hrv', sr: 'srp',
};
function apertiumLanguage(value: string, target: boolean): string {
    const code = genericLanguage(value, target);
    return apertiumCodes[code] || code;
}

function apertiumDirection(source: string, target: string): string {
    return `${apertiumLanguage(language(source, false), false)}|${apertiumLanguage(language(target, true), true)}`;
}

/** 只排除动态列表已经确认不支持的方向；其他方向和过期结果仍按既有接口探测。 */
export function isKnownUnsupportedApertiumDirection(source: string, target: string): boolean {
    let direction: string;
    try { direction = apertiumDirection(source, target); }
    catch { return false; /* 本地语言参数错误仍由实际 provider 处理。 */ }
    const expiresAt = unsupportedApertiumDirections.get(direction);
    if (expiresAt === undefined) return false;
    if (Date.now() >= expiresAt) {
        unsupportedApertiumDirections.delete(direction);
        return false;
    }
    return true;
}

/** 畸形/业务失败响应不能证明某个语言方向不可用，不写入方向记忆。 */
function isApertiumDirectionList(body: unknown): boolean {
    const pairPattern = /^[a-z][a-z0-9_]*[|-][a-z][a-z0-9_]*$/iu;
    const isEntry = (item: unknown) => {
        if (typeof item === 'string') return pairPattern.test(item);
        if (!item || typeof item !== 'object') return false;
        const value = item as {sourceLanguage?: unknown; targetLanguage?: unknown; langpair?: unknown};
        return typeof value.langpair === 'string' && pairPattern.test(value.langpair)
            || typeof value.sourceLanguage === 'string' && typeof value.targetLanguage === 'string'
                && pairPattern.test(`${value.sourceLanguage}|${value.targetLanguage}`);
    };
    if (Array.isArray(body)) return body.every(isEntry);
    if (!body || typeof body !== 'object') return false;
    const keys = Object.keys(body);
    return keys.length > 0 && keys.every(key => pairPattern.test(key));
}

async function translateLingvaChunk(text: string, source: string, target: string, signal?: AbortSignal): Promise<string> {
    const from = genericLanguage(source, false);
    const to = genericLanguage(target, true);
    const url = `${LINGVA_INSTANCE}/api/v1/${encodeURIComponent(from)}/${encodeURIComponent(to)}/${encodeURIComponent(text)}`;
    const response = await runtimeFetch(url, {method: 'GET', credentials: 'omit', signal, headers: {Accept: 'application/json'}});
    try {
        checkAbort(signal);
        if (!response.ok) {
            const label = response.status === 403
                ? 'Lingva 公共实例拒绝自动访问，请稍后重试或停用此服务'
                : response.status === 429
                    ? 'Lingva 公共实例限流，请稍后重试'
                    : 'Lingva 公共实例暂时不可用，请稍后重试';
            throw createHttpStatusError(response, label);
        }
        const result = await readJsonResponse<{translation?: unknown; error?: unknown} | null>(response, 'Lingva 返回的不是有效 JSON');
        checkAbort(signal);
        if (result?.error) throw failure('Lingva 翻译业务请求失败');
        if (typeof result?.translation !== 'string' || !result.translation.trim()) throw failure('Lingva 翻译结果为空');
        return result.translation.trim();
    } finally {await settleUnreadResponse(response);}
}

async function translateApertiumChunk(text: string, source: string, target: string, signal?: AbortSignal, pairValidated = false): Promise<string> {
    const pair = apertiumDirection(source, target);
    if (!pairValidated && isKnownUnsupportedApertiumDirection(source, target)) throw failure('Apertium 不支持当前语言方向', 400, 'request');
    if (!pairValidated) {
        const listResponse = await runtimeFetch(`${APERTIUM_ENDPOINT}/listPairs`, {method: 'GET', credentials: 'omit', signal, headers: {Accept: 'application/json'}});
        try {
            checkAbort(signal);
            if (!listResponse.ok) throw createHttpStatusError(listResponse, 'Apertium 语言列表请求失败');
            const pairs = await readJsonResponse<unknown>(listResponse, 'Apertium 语言列表不是有效 JSON');
            checkAbort(signal);
            const body = pairs && typeof pairs === 'object' && 'responseData' in pairs ? (pairs as {responseData?: unknown}).responseData : pairs;
            const hasPair = Array.isArray(body) && body.some(item => {
                if (typeof item === 'string') return item === pair || item.replace('-', '|') === pair;
                if (!item || typeof item !== 'object') return false;
                const value = item as {sourceLanguage?: unknown; targetLanguage?: unknown; langpair?: unknown};
                return value.langpair === pair || (typeof value.langpair === 'string' && value.langpair.replace('-', '|') === pair)
                    || `${value.sourceLanguage}|${value.targetLanguage}` === pair;
            }) || !!body && typeof body === 'object' && Object.keys(body).some(key => key === pair || key.replace('-', '|') === pair);
            if (!hasPair) {
                const status = pairs && typeof pairs === 'object' && 'responseStatus' in pairs
                    ? (pairs as {responseStatus?: unknown}).responseStatus : undefined;
                if (pair.length <= 160 && (status === undefined || status === 200) && isApertiumDirectionList(body)) {
                    unsupportedApertiumDirections.delete(pair);
                    if (unsupportedApertiumDirections.size >= APERTIUM_UNSUPPORTED_DIRECTION_LIMIT) {
                        unsupportedApertiumDirections.delete(unsupportedApertiumDirections.keys().next().value!);
                    }
                    unsupportedApertiumDirections.set(pair, Date.now() + APERTIUM_UNSUPPORTED_DIRECTION_TTL_MS);
                }
                throw failure('Apertium 不支持当前语言方向', 400, 'request');
            }
        } finally {await settleUnreadResponse(listResponse);}
    }
    checkAbort(signal);
    const query = new URLSearchParams({langpair: pair, q: text, format: 'txt'});
    const response = await runtimeFetch(`${APERTIUM_ENDPOINT}/translate?${query}`, {method: 'GET', credentials: 'omit', signal, headers: {Accept: 'application/json'}});
    try {
        checkAbort(signal);
        if (!response.ok) throw createHttpStatusError(response, 'Apertium 翻译请求失败');
        const result = await readJsonResponse<{responseStatus?: unknown; responseData?: {translatedText?: unknown}} | null>(response, 'Apertium 返回的不是有效 JSON');
        checkAbort(signal);
        const translated = result?.responseData?.translatedText;
        if (result?.responseStatus !== 200 || typeof translated !== 'string' || !translated.trim()) throw failure('Apertium 翻译结果为空');
        return translated.trim();
    } finally {await settleUnreadResponse(response);}
}

type ChunkTranslator = (text: string, source: string, target: string, signal?: AbortSignal) => Promise<string>;

async function translatePlain(text: string, source: string, target: string, signal: AbortSignal | undefined, translator: ChunkTranslator): Promise<string> {
    return translateFreeTextChunks(text, MAX_CHUNK_CODEPOINTS, chunk => translator(chunk, source, target, signal), signal);
}

export async function translateExtraFreeWebText(
    id: ExtraFreeWebProvider,
    text: string,
    source: string,
    target: string,
    signal?: AbortSignal,
): Promise<string> {
    checkAbort(signal);
    if (typeof text !== 'string') throw failure('免费网页翻译仅支持文本输入', 400, 'unavailable');
    if (!text.trim()) return text;
    const from = language(source, false);
    const to = language(target, true);
    // 初始化请求只在本次文本/槽请求中复用；不共享 Promise 或取消所有权。
    let sogouSecret: Promise<string> | undefined;
    let apertiumPairValidated = false;
    const translator: ChunkTranslator = id === 'sogouFree'
        ? (chunk, from, to, signal) => translateSogouChunk(chunk, from, to, signal, sogouSecret ??= getSogouSecret(signal))
        : id === 'reversoFree' ? translateReversoChunk
            : id === 'lingvaFree' ? translateLingvaChunk
                : async (chunk, from, to, signal) => {
                    const output = await translateApertiumChunk(chunk, from, to, signal, apertiumPairValidated);
                    apertiumPairValidated = true;
                    return output;
                };
    const slots = getTranslationGlossarySourceText(text);
    if (!Array.isArray(slots)) return translatePlain(text, from, to, signal, translator);
    const translated: string[] = [];
    for (const slot of slots) translated.push(await translatePlain(slot, from, to, signal, translator));
    const nonce = text.match(/^___FLUENTREAD_([a-z0-9_-]+)_0_BEGIN___/iu)![1]!;
    return serializeTranslationSlots(translated, nonce).payload;
}

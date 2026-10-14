/**
 * @file src/providers/translation/mymemory.ts
 *
 * 文件职责：适配 MyMemory 官方匿名查询 API，将小额免费额度用于短文翻译和免费服务回退。
 * 主要内容：读取冻结邮箱与语言配置，保守推断自动源语言，保留文本槽标记并按 500 UTF-8 字节拆分，验证协议状态、额度和有效译文，支持调用方取消，取消或错误响应也等待未读正文结算后归还容量。
 * 模块边界：本文件属于供应商协议适配层，只调用公开 get 端点，不上传贡献语料、不管理页面 DOM，也不决定跨服务回退顺序和总超时预算。
 */

import {normalizeLanguageCode} from '@/src/core/language/codes';
import {identifyTextLanguage} from '@/src/core/language/identify';
import {resolveTranslationLanguages, type TranslationLanguageOverride} from '@/src/core/translation/languages';
import {serializeTranslationSlots} from '@/src/core/translation/serialization';
import {getTranslationGlossarySourceText, requireTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';
import type {TranslationProviderRequest, TranslationProviderRequestContext} from '@/src/services/translation/types';
import {createHttpStatusError, createProviderCodeError, readJsonResponse} from '@/src/platform/http/errors';
import {abortErrorFromSignal, runtimeFetch} from '@/src/platform/http/runtime';

const MY_MEMORY_URL = 'https://api.mymemory.translated.net/get';
export const MY_MEMORY_MAX_BYTES = 500;
type MyMemoryRequest = TranslationLanguageOverride & TranslationProviderRequestContext;
/** MyMemory 以地区区分简繁中文；其他语言使用统一规范代码，无法规范化的取值原样交给服务报错。 */
function toMyMemoryLanguage(language: string): string {
    const normalized = normalizeLanguageCode(language);
    if (normalized === 'zh-Hans') return 'zh-CN';
    if (normalized === 'zh-Hant') return 'zh-TW';
    return normalized || language;
}

/** 只使用与同目标跳过相同的可信识别结论；短歧义文本、共享 Han 和混合文本交由回退链尝试其他服务。 */
function inferSourceLanguage(text: string): string {
    const identification = identifyTextLanguage(text);
    if (identification.status === 'identified') return identification.languages[0]!;
    throw Object.assign(new Error('MyMemory 无法可靠识别源语言，请指定源语言或使用其他翻译服务'), {statusCode: 400});
}

/** 按码点计字节，不截断代理对；优先在标点或空白处断开，保留所有原文字符。 */
function splitByByteLimit(text: string): string[] {
    const chunks: string[] = [];
    let rest = text;
    while (rest) {
        let bytes = 0;
        let end = 0;
        let boundary = 0;
        for (const character of rest) {
            // for...of 保持码点完整；孤立 surrogate 与 TextEncoder 一样计为替换字符的 3 字节。
            const point = character.codePointAt(0)!;
            const length = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
            if (bytes + length > MY_MEMORY_MAX_BYTES) break;
            bytes += length;
            end += character.length;
            if (/[\s.!?。！？；;，,]/u.test(character)) boundary = end;
        }
        const split = end < rest.length && boundary > 0 ? boundary : end;
        chunks.push(rest.slice(0, split));
        rest = rest.slice(split);
    }
    return chunks;
}

interface MyMemoryResponse {
    responseStatus?: unknown;
    quotaFinished?: unknown;
    responseData?: {translatedText?: unknown};
}

export async function translateMyMemoryText(text: string, request: MyMemoryRequest = {}): Promise<string> {
    if (typeof text !== 'string') throw Object.assign(new Error('MyMemory 仅支持文本输入'), {statusCode: 400});
    if (request.abortSignal?.aborted) throw abortErrorFromSignal(request.abortSignal);
    if (!text.trim()) return text;
    const current = requireTranslationProviderConfig(request);
    const languages = resolveTranslationLanguages(request, {sourceLanguage: current.from, targetLanguage: current.to});
    const pureSource = getTranslationGlossarySourceText(text);
    const sourceText = Array.isArray(pureSource) ? pureSource.join('\n') : pureSource;
    const sourceLanguage = languages.sourceLanguage === 'auto'
        ? inferSourceLanguage(sourceText) : languages.sourceLanguage;
    const from = toMyMemoryLanguage(sourceLanguage);
    const to = toMyMemoryLanguage(languages.targetLanguage);
    const email = current.myMemoryEmail?.trim();

    const translatePlainText = async (source: string): Promise<string> => {
        let translated = '';
        // 换行作为结构保留，接口只收到行内文本；拆分边缘空白也在本地重建。
        for (const chunk of splitByByteLimit(source)) {
            if (request.abortSignal?.aborted) throw abortErrorFromSignal(request.abortSignal);
            const content = chunk.trim();
            if (!content) {
                translated += chunk;
                continue;
            }
            const prefix = chunk.slice(0, chunk.indexOf(content));
            const suffix = chunk.slice(prefix.length + content.length);
            const url = new URL(MY_MEMORY_URL);
            url.searchParams.set('q', content);
            url.searchParams.set('langpair', `${from}|${to}`);
            if (email) url.searchParams.set('de', email);
            const response = await runtimeFetch(url, {method: 'GET', signal: request.abortSignal});
            try {
                if (request.abortSignal?.aborted) throw abortErrorFromSignal(request.abortSignal);
                if (!response.ok) throw createHttpStatusError(response, 'MyMemory 翻译失败');
                const result = await readJsonResponse<MyMemoryResponse | null>(response, 'MyMemory 返回的不是有效 JSON');
                if (request.abortSignal?.aborted) throw abortErrorFromSignal(request.abortSignal);
                if (result?.quotaFinished === true) {
                    throw Object.assign(createProviderCodeError('MyMemory 免费额度已用尽', 429), {statusCode: 429, freeFailure: 'quota'});
                }
                if (!result || String(result.responseStatus) !== '200') {
                    const status = Number(result?.responseStatus);
                    throw Object.assign(createProviderCodeError('MyMemory 翻译失败', result?.responseStatus), {
                        ...(Number.isInteger(status) && status >= 400 && status <= 599 ? {statusCode: status} : {}),
                    });
                }
                const value = result.responseData?.translatedText;
                if (typeof value !== 'string' || !value.trim()) throw new Error('MyMemory 未返回有效译文');
                translated += prefix + value.trim() + suffix;
            } finally {
                // 取消或错误 headers 不能让候选 Promise 先于未读正文结束；读取失败保留原错误。
                if (!response.bodyUsed) {
                    try { await response.clone().arrayBuffer(); } catch {}
                }
            }
        }
        return translated;
    };

    const translateLines = async (source: string): Promise<string> => {
        const lines = source.split(/([\r\n]+)/u);
        const translated: string[] = [];
        for (const line of lines) translated.push(await translatePlainText(line));
        return translated.join('');
    };

    if (Array.isArray(pureSource)) {
        const translations: string[] = [];
        for (const source of pureSource) translations.push(await translateLines(source));
        // pureSource 只有在完整槽协议验证成功后才会成为数组。
        const nonce = text.match(/^___FLUENTREAD_([a-z0-9_-]+)_0_BEGIN___/iu)![1]!;
        return serializeTranslationSlots(translations, nonce).payload;
    }
    return translateLines(text);
}

export default async function myMemory(message: TranslationProviderRequest): Promise<string | string[]> {
    if (typeof message.origin === 'string') return translateMyMemoryText(message.origin, message);
    if (!Array.isArray(message.origin)) throw Object.assign(new Error('MyMemory 仅支持文本输入'), {statusCode: 400});
    const result: string[] = [];
    for (const text of message.origin) result.push(await translateMyMemoryText(text, message));
    return result;
}

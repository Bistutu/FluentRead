/**
 * @file src/providers/translation/deeplx.ts
 *
 * 文件职责：适配一个或多个 DeepLX 端点，并在总预算和单次预算内执行有序故障转移翻译。
 * 主要内容：规范化 AUTO、ZH 等语言代码，从 core 配置解析候选地址，逐端点请求并校验 code/data，导出 translateDeepLXText 与默认 provider。 可核对的公开符号包括 getDeepLXRequestLanguages、translateDeepLXText、default:deeplx。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {normalizeChineseLanguageCode} from '@/src/core/language/chinese';
import {services} from "@/src/core/config/catalog";
import {getDeepLXEndpoints} from "@/src/core/config/deeplx";
import {getTranslationProviderLanguages} from '@/src/services/translation/requestSnapshot';
import type {TranslationLanguageOverride} from '@/src/core/translation/languages';
import {createHttpStatusError, createProviderCodeError} from '@/src/platform/http/errors';
import {
    abortErrorFromSignal,
    createRuntimeAbortContext,
    runtimeFetch,
} from '@/src/platform/http/runtime';
import {requireTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';
import type {TranslationProviderRequest, TranslationProviderRequestContext} from '@/src/services/translation/types';

const DEEPLX_TOTAL_TIMEOUT_MS = 20_000;
const DEEPLX_ATTEMPT_TIMEOUT_MS = 8_000;

function normalizeLanguage(language: string): string {
    const normalized = normalizeChineseLanguageCode(language).toLowerCase();
    if (normalized === "auto") {
        return "AUTO";
    }
    if (normalized === "zh-hans" || normalized === "zh-cn") {
        return "ZH";
    }
    if (normalized === "zh-tw" || normalized === "zh-hant") {
        return "ZH-HANT";
    }
    if (normalized === 'fil') return 'TL';
    return normalized.toUpperCase();
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function fetchDeepLX(
    url: string,
    requestInit: RequestInit,
    timeoutMs: number,
    callerSignal?: AbortSignal,
): Promise<{response: Response; responseBody: string}> {
    const abortContext = createRuntimeAbortContext(timeoutMs, callerSignal);

    try {
        let response: Response;
        try {
            response = await runtimeFetch(url, {...requestInit, signal: abortContext.signal});
        } catch {
            if (callerSignal?.aborted) throw abortErrorFromSignal(callerSignal);
            if (abortContext.didTimeout()) throw new Error(`请求超时（${timeoutMs / 1000} 秒）`);
            throw new Error('网络请求失败');
        }

        if (callerSignal?.aborted) throw abortErrorFromSignal(callerSignal);
        if (abortContext.didTimeout()) throw new Error(`请求超时（${timeoutMs / 1000} 秒）`);
        if (!response.ok) return {response, responseBody: ''};
        try {
            const responseBody = await response.text();
            if (callerSignal?.aborted) throw abortErrorFromSignal(callerSignal);
            if (abortContext.didTimeout()) throw new Error(`请求超时（${timeoutMs / 1000} 秒）`);
            return {response, responseBody};
        } catch {
            if (callerSignal?.aborted) throw abortErrorFromSignal(callerSignal);
            if (abortContext.didTimeout()) throw new Error(`请求超时（${timeoutMs / 1000} 秒）`);
            throw new Error('响应读取失败');
        }
    } finally {
        abortContext.cleanup();
    }
}

async function translateFromDeepLX(
    url: string,
    text: string,
    sourceLang: string,
    targetLang: string,
    token: string,
    timeoutMs: number,
    callerSignal?: AbortSignal,
): Promise<string> {
    const headers: HeadersInit = {
        "Content-Type": "application/json",
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const {response, responseBody} = await fetchDeepLX(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
            text,
            source_lang: sourceLang,
            target_lang: targetLang,
        }),
    }, timeoutMs, callerSignal);

    if (!response.ok) {
        throw createHttpStatusError(response);
    }

    let result: unknown;
    try {
        result = JSON.parse(responseBody);
    } catch {
        throw new Error('返回的不是 JSON');
    }

    if (!result || typeof result !== "object") {
        throw new Error("返回格式异常");
    }

    const responseData = result as {code?: unknown; data?: unknown; message?: unknown};
    if (responseData.code !== undefined && responseData.code !== 200) {
        throw createProviderCodeError('DeepLX 返回错误', responseData.code);
    }
    if (typeof responseData.data !== "string" || responseData.data.trim().length === 0) {
        throw new Error("返回格式异常：缺少译文");
    }

    return responseData.data;
}

export function getDeepLXRequestLanguages(from: string, to: string): {sourceLang: string; targetLang: string} {
    return {
        sourceLang: normalizeLanguage(from),
        targetLang: normalizeLanguage(to),
    };
}

export async function translateDeepLXText(
    text: string,
    serviceKey: string = services.deeplx,
    languageOverride?: TranslationLanguageOverride & TranslationProviderRequestContext,
): Promise<string> {
    if (typeof text !== "string") {
        throw new Error("DeepLX 翻译仅支持单条文本");
    }

    const current = requireTranslationProviderConfig(languageOverride);
    const token = current.token[serviceKey]?.trim() || "";
    const endpoints = getDeepLXEndpoints(
        current.deeplx,
        current.proxy[serviceKey],
        token,
    );
    const {sourceLanguage, targetLanguage} = getTranslationProviderLanguages(languageOverride);
    const {sourceLang, targetLang} = getDeepLXRequestLanguages(sourceLanguage, targetLanguage);
    const deadline = Date.now() + DEEPLX_TOTAL_TIMEOUT_MS;
    const failures: string[] = [];
    const failureStatuses: Array<number | undefined> = [];
    const abortSignal = languageOverride?.abortSignal;

    for (const [index, endpoint] of endpoints.entries()) {
        if (abortSignal?.aborted) throw abortErrorFromSignal(abortSignal);
        const remainingTime = deadline - Date.now();
        if (remainingTime <= 0) {
            break;
        }

        try {
            return await translateFromDeepLX(
                endpoint,
                text,
                sourceLang,
                targetLang,
                token,
                Math.min(DEEPLX_ATTEMPT_TIMEOUT_MS, remainingTime),
                abortSignal,
            );
        } catch (error) {
            if (abortSignal?.aborted) throw abortErrorFromSignal(abortSignal);
            failures.push(`备用站点 ${index + 1}: ${getErrorMessage(error)}`);
            failureStatuses.push((error as {statusCode?: number}).statusCode);
        }
    }

    const failureSummary = failures.length > 0 ? failures.join("；") : "总请求时间已耗尽";
    const aggregate = new Error(`DeepLX 所有备用站点均失败：${failureSummary}`);
    const firstStatus = failureStatuses[0];
    const requestErrors = new Set([400, 404, 413, 415, 422]);
    // 保留标准 HTTP 分类供外层免费链判断；语言/参数错误不应熔断其他文本。
    // 混合网络故障不能被其中一次 400 掩盖，因此只传递一致状态或全部请求错误。
    if (firstStatus !== undefined && failureStatuses.every(status => status === firstStatus
        || (requestErrors.has(firstStatus) && status !== undefined && requestErrors.has(status)))) {
        Object.assign(aggregate, {statusCode: firstStatus});
    }
    throw aggregate;
}

async function deeplx(message: TranslationProviderRequest<string>) {
    if (typeof message.origin !== "string") {
        throw new Error("DeepLX 翻译仅支持单条文本");
    }

    return translateDeepLXText(message.origin, services.deeplx, message);
}

export default deeplx;

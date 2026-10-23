/**
 * @file src/providers/translation/hunyuan-translation.ts
 *
 * 文件职责：适配腾讯混元翻译大模型的专用协议，处理支持语言映射、同目标语言短路和自定义请求体。
 * 主要内容：buildHunyuanTranslationRequestBody 生成模型 payload，provider 从快照读取腾讯凭据与实际模型，调用 endpoint、归一 Response.Usage 并校验 provider 错误码与翻译输出。 可核对的公开符号包括 buildHunyuanTranslationRequestBody、default:hunyuanTranslation。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {normalizeChineseLanguageCode} from '@/src/core/language/chinese';
import { method } from "@/src/core/config/constants";
import {shouldSkipTranslationForTarget} from '@/src/core/language/detect';
import { mergeCustomBody } from "@/src/core/config/customBody";
import {resolveConfiguredModel, services} from "@/src/core/config/catalog";
import {getTranslationProviderLanguages} from '@/src/services/translation/requestSnapshot';
import {createHttpStatusError, createProviderCodeError, readJsonResponse} from '@/src/platform/http/errors';
import {cancelUnreadResponseBody, runtimeFetch} from '@/src/platform/http/runtime';
import {requireTranslationProviderConfig, reportTranslationModelUsage, reportTranslationModelUsageFailure} from '@/src/services/translation/requestSnapshot';
import type {TranslationProviderRequest} from '@/src/services/translation/types';
import {normalizeHunyuanUsage} from './usage';

// 混元翻译大模型支持的语言代码映射
const languageMap: Record<string, string> = {
    'zh-Hans': 'zh',    // 简体中文
    'zh-Hant': 'zh-TR', // 繁体中文；yue 是粤语，不能代替繁体书写系统
    'en': 'en',         // 英语
    'ja': 'ja',         // 日语
    'ko': 'ko',         // 韩语
    'fr': 'fr',         // 法语
    'ru': 'ru',         // 俄语
    'de': 'de',         // 德语
    'es': 'es',         // 西班牙语
    'it': 'it',         // 意大利语
    'tr': 'tr',         // 土耳其语
    'ar': 'ar',         // 阿拉伯语
    'pt': 'pt',         // 葡萄牙语
    'th': 'th',         // 泰语
    'vi': 'vi',         // 越南语
    'ms': 'ms',         // 马来语
    'id': 'id',         // 印尼语
    // 注意：auto由代码逻辑特殊处理，不在此映射
};

// 生成HMAC签名 (返回二进制数据)
async function generateHmacSignature(key: string | ArrayBuffer, message: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const keyData = typeof key === 'string' ? encoder.encode(key) : key;
    
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

// 将二进制数据转换为十六进制字符串
function arrayBufferToHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// 生成腾讯云API签名
async function createHunyuanSignature(requestPayload: string, timestamp: number, secretId: string, secretKey: string): Promise<string> {
    const date = new Date(timestamp * 1000).toISOString().substring(0, 10);
    
    // 步骤1：拼接规范请求串
    const httpRequestMethod = "POST";
    const canonicalUri = "/";
    const canonicalQueryString = "";
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:hunyuan.tencentcloudapi.com\n`;
    const signedHeaders = "content-type;host";
    
    const hashedRequestPayload = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestPayload));
    const hashedPayloadHex = Array.from(new Uint8Array(hashedRequestPayload))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
    const canonicalRequest = `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayloadHex}`;
    
    // 步骤2：拼接待签名字符串
    const algorithm = "TC3-HMAC-SHA256";
    const credentialScope = `${date}/hunyuan/tc3_request`;
    
    const hashedCanonicalRequest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest));
    const hashedCanonicalRequestHex = Array.from(new Uint8Array(hashedCanonicalRequest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
    const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequestHex}`;
    
    // 步骤3：计算签名
    const kDate = await generateHmacSignature(`TC3${secretKey}`, date);
    const kService = await generateHmacSignature(kDate, "hunyuan");
    const kSigning = await generateHmacSignature(kService, "tc3_request");
    const signatureBuffer = await generateHmacSignature(kSigning, stringToSign);
    const signature = arrayBufferToHex(signatureBuffer);
    
    // 步骤4：拼接 Authorization
    const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    
    return authorization;
}

export function buildHunyuanTranslationRequestBody(
    text: string,
    target: string,
    model: string,
    customBody?: unknown,
) {
    return mergeCustomBody({
        Model: model,
        Stream: false,
        Text: text,
        Target: target,
    }, customBody);
}

async function hunyuanTranslation(message: TranslationProviderRequest<string>) {
    const current = requireTranslationProviderConfig(message);
    const service = message.serviceOverride || services.huanYuanTranslation;

    const secretId = current.tencentSecretId?.trim();
    const secretKey = current.tencentSecretKey?.trim();
    if (!secretId || !secretKey) {
        throw new Error('腾讯混元翻译密钥未配置，请在设置中配置SecretId和SecretKey');
    }
    if (secretId.length < 10 || secretKey.length < 10) {
        throw new Error('SecretId或SecretKey格式不正确，请检查是否完整复制了密钥信息');
    }

    // 显式源语言与目标相同时尊重用户设定；自动识别只在统一语言判断可信确认目标语言时短路，
    // 不能用统计最佳猜测（或去掉空白后的文本）决定跳过，否则短句误判会静默漏译。
    const {sourceLanguage, targetLanguage} = getTranslationProviderLanguages(message);
    const normalizedSource = normalizeChineseLanguageCode(sourceLanguage);
    const normalizedTarget = normalizeChineseLanguageCode(targetLanguage);
    const mappedTargetLang = (Object.hasOwn(languageMap, normalizedTarget) ? languageMap[normalizedTarget] : targetLanguage);
    if (!mappedTargetLang || mappedTargetLang === 'auto') throw new Error('混元翻译不支持该目标语言');
    const sameLanguage = sourceLanguage === 'auto'
        ? shouldSkipTranslationForTarget(message.origin, targetLanguage)
        : (Object.hasOwn(languageMap, normalizedSource) ? languageMap[normalizedSource] : sourceLanguage) === mappedTargetLang;
    if (sameLanguage) return message.origin;

    const model = message.modelOverride || current.model[service] || 'hunyuan-translation';
    const configuredModel = resolveConfiguredModel(model, current.customModel[service]) || model;
    const requestBody = buildHunyuanTranslationRequestBody(
        message.origin,
        mappedTargetLang,
        configuredModel,
        current.customBody?.[service],
    );
    const requestModel = typeof requestBody.Model === 'string' && requestBody.Model.trim()
        ? requestBody.Model : configuredModel;
    const requestBodyStr = JSON.stringify(requestBody);
    const timestamp = Math.floor(Date.now() / 1000);
    const authorization = await createHunyuanSignature(requestBodyStr, timestamp, secretId, secretKey);
    const url = current.proxy[service] || 'https://hunyuan.tencentcloudapi.com/';

    const startedAt = Date.now();
    let attemptReported = false;
    try {
        const response = await runtimeFetch(url, {
            method: method.POST,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Host': 'hunyuan.tencentcloudapi.com',
                'Authorization': authorization,
                'X-TC-Action': 'ChatTranslations',
                'X-TC-Version': '2023-09-01',
                'X-TC-Region': 'ap-beijing',
                'X-TC-Timestamp': timestamp.toString(),
            },
            body: requestBodyStr,
            signal: message.abortSignal,
        });

        if (!response.ok) {
            reportTranslationModelUsageFailure(message, undefined, startedAt, requestModel, response.status);
            attemptReported = true;
            cancelUnreadResponseBody(response);
            throw createHttpStatusError(response, '腾讯混元翻译请求失败');
        }

        const result = await readJsonResponse<any>(response, '腾讯混元翻译返回的不是有效 JSON');
        const reportedModel = result?.Response?.Model;
        const actualModel = typeof reportedModel === 'string' && reportedModel.trim()
            ? reportedModel
            : requestModel;
        const usage = normalizeHunyuanUsage(result?.Response?.Usage, actualModel);
        if (result?.Response?.Error) {
            reportTranslationModelUsage(message, {
                ...usage,
                startedAt,
                durationMs: Math.max(0, Date.now() - startedAt),
                outcome: 'error',
                statusCode: response.status,
            });
            attemptReported = true;
            throw createProviderCodeError('腾讯混元翻译错误', result.Response.Error.Code);
        }
        if (Array.isArray(result?.Response?.Choices) && result.Response.Choices.length > 0) {
            const translatedText = result.Response.Choices[0]?.Message?.Content;
            if (typeof translatedText === 'string' && translatedText) {
                reportTranslationModelUsage(message, {
                    ...usage,
                    startedAt,
                    durationMs: Math.max(0, Date.now() - startedAt),
                    outcome: 'success',
                    statusCode: response.status,
                });
                attemptReported = true;
                return translatedText;
            }
        }
        throw new Error('腾讯混元翻译返回格式异常');
    } catch (error) {
        if (!attemptReported) {
            reportTranslationModelUsageFailure(message, error, startedAt, requestModel);
        }
        throw error;
    }
}

export default hunyuanTranslation;

/**
 * @file src/providers/translation/chromeTranslatorRequest.ts
 *
 * 文件职责：构造 Chrome Offscreen 翻译消息的纯数据载荷，保证 provider 请求与 broker 缓存使用同一组语言覆盖。
 * 主要内容：定义 ChromeTranslatorMessage、ChromeOffscreenTranslationData，并由 buildChromeOffscreenTranslationData 校验 origin 与可选纯正文检测样本、解析 source/target 后生成 text/from/to。 可核对的公开符号包括 ChromeTranslatorMessage、ChromeOffscreenTranslationData、buildChromeOffscreenTranslationData。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {resolveTranslationLanguages, type TranslationLanguageDefaults} from '@/src/core/translation/languages';
import type {TranslationProviderRequestContext} from '@/src/services/translation/types';

export interface ChromeTranslatorMessage extends TranslationProviderRequestContext {
    readonly origin?: unknown;
    readonly sourceLanguage?: unknown;
    readonly targetLanguage?: unknown;
    readonly sourceLanguageDetectionText?: unknown;
    readonly requestTimeoutMs?: unknown;
}

export interface ChromeOffscreenTranslationData {
    readonly text: string;
    readonly from: string;
    readonly to: string;
    readonly sourceLanguageDetectionText?: string;
}

/**
 * Provider payload 与 broker 缓存身份必须使用同一组请求级语言覆盖。
 * 该纯函数刻意不读取全局 config，调用方只传入当次配置快照。
 */
export function buildChromeOffscreenTranslationData(
    message: ChromeTranslatorMessage,
    defaults: TranslationLanguageDefaults,
): ChromeOffscreenTranslationData {
    if (typeof message.origin !== 'string' || !message.origin.trim()) {
        throw new TypeError('翻译文本不能为空');
    }
    if (message.sourceLanguageDetectionText !== undefined
        && typeof message.sourceLanguageDetectionText !== 'string') {
        throw new TypeError('Chrome 源语言检测文本必须是字符串');
    }
    const override = {
        sourceLanguage: typeof message.sourceLanguage === 'string' ? message.sourceLanguage : undefined,
        targetLanguage: typeof message.targetLanguage === 'string' ? message.targetLanguage : undefined,
    };
    const {sourceLanguage, targetLanguage} = resolveTranslationLanguages(override, defaults);
    return {
        text: message.origin,
        from: sourceLanguage,
        to: targetLanguage,
        ...(sourceLanguage === 'auto' && message.sourceLanguageDetectionText?.trim()
            ? {sourceLanguageDetectionText: message.sourceLanguageDetectionText}
            : {}),
    };
}

/**
 * @file integrations/zotero/translation.ts
 * 文件职责：把 Zotero 独立设置连接到 FluentRead 的分段翻译、微软协议和 OpenAI 兼容 HTTP 执行器。
 * 主要内容：每次调用固定设置，术语在本地用已有占位符规则保护与恢复；AI 多段使用已有槽协议并严格校验，失败交由文档引擎逐段降级；所有请求有超时和取消，错误经过共享脱敏边界。
 * 模块边界：不读取 Zotero、浏览器扩展配置或持久化，不自建供应商协议；网络端口由独立应用组合根注入。
 */
import {services} from '../../src/core/config/catalog';
import {protectGlossaryText, type GlossaryProtectionEntry} from '../../src/core/glossary';
import {serializeTranslationSlots, parseTranslationSlots} from '../../src/core/translation/slotProtocol';
import {stripTranslationReasoning} from '../../src/core/translation/prompts';
import {createRuntimeAbortContext, type RuntimeFetch} from '../../src/platform/http/runtime';
import {translateMicrosoftTextsWithTransport} from '../../src/providers/translation/microsoftTransport';
import {standaloneOpenAIExecution} from '../../src/providers/translation/ai-sdk/openai-http';
import {parseChatCompletionsEndpoint} from '../../src/providers/translation/ai-sdk/endpoints';
import {LlmTransportError, normalizeLlmTransportError} from '../../src/providers/translation/ai-sdk/transport-errors';
import {commonMsgTemplate} from '../../src/services/translation/templates';
import {createTranslationProviderConfigSnapshot} from '../../src/services/translation/requestSnapshot';
import {createDocumentSegmentTranslator} from '../../src/features/document-translation/services/translation';
import type {DocumentTranslationRequestOptions} from '../../src/features/document-translation/services/translation';
import type {TranslationSettings} from './contracts';
import {normalizeCompatibleEndpoint, normalizeSettings} from './settings';

export interface ZoteroTranslationOptions {fetch?: RuntimeFetch; timeoutMs?: number}

export function parseZoteroGlossary(value: string): GlossaryProtectionEntry[] {
    const entries: GlossaryProtectionEntry[] = [];
    for (const line of value.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^(.+?)(?:\t|\s*=\s*)(.+)$/u);
        if (!match?.[1].trim() || !match[2].trim()) throw new Error('术语表请每行填写“原词 = 译法”');
        entries.push({source: match[1].trim(), target: match[2].trim(), caseSensitive: false});
        if (entries.length > 500) throw new Error('术语表最多支持 500 个词条');
    }
    return entries;
}

/** 即使适配网络忽略取消，也立即结束当前调用并观察晚到拒绝。 */
async function withRequestBudget<T>(work: (signal: AbortSignal) => Promise<T>, caller: AbortSignal | undefined,
    timeoutMs: number): Promise<T> {
    const budget = createRuntimeAbortContext(timeoutMs, caller);
    const signal = budget.signal;
    let abort: (() => void) | undefined;
    try {
        signal.throwIfAborted();
        return await new Promise<T>((resolve, reject) => {
            abort = () => reject(new DOMException(budget.didTimeout() ? '翻译请求超时，请重试或更换服务' : '翻译已取消',
                budget.didTimeout() ? 'TimeoutError' : 'AbortError'));
            signal.addEventListener('abort', abort, {once: true});
            Promise.resolve().then(() => {signal.throwIfAborted(); return work(signal);}).then(resolve, reject);
            if (signal.aborted) abort();
        });
    } finally {
        if (abort) signal.removeEventListener('abort', abort);
        budget.cleanup();
    }
}

export function createZoteroTranslator(rawSettings: TranslationSettings, options: ZoteroTranslationOptions = {}) {
    const settings = normalizeSettings(rawSettings);
    const glossary = parseZoteroGlossary(settings.glossary);
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0 ? options.timeoutMs!
        : settings.service === 'compatible' ? 120_000 : 30_000;
    const transport: RuntimeFetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, {
        ...init, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
    });

    async function translate(sources: string[], context: string, request: DocumentTranslationRequestOptions): Promise<string[]> {
        const signal = request.signal;
        signal?.throwIfAborted();
        const sourceLanguage = request.sourceLanguage ?? settings.sourceLanguage;
        const targetLanguage = request.targetLanguage ?? settings.targetLanguage;
        try {
            return await withRequestBudget(async activeSignal => {
                if (settings.service === 'microsoft') {
                    const packets = sources.map((source, index) => protectGlossaryText(source, glossary, String(index)));
                    const results = await translateMicrosoftTextsWithTransport(transport, packets.map(packet => packet.text),
                        sourceLanguage, targetLanguage, activeSignal, request.enableNativeBatch !== false);
                    activeSignal.throwIfAborted();
                    return results.map((result, index) => packets[index].restore(result));
                }
                const endpoint = normalizeCompatibleEndpoint(settings.endpoint);
                if (!settings.model || /[\u0000-\u001f]/u.test(settings.model)) throw new Error('请在设置中填写有效的模型名称');
                const slot = sources.length > 1 ? serializeTranslationSlots(sources) : undefined;
                const packet = protectGlossaryText(slot?.payload ?? sources[0] ?? '', glossary, 'zotero');
                const current = createTranslationProviderConfigSnapshot({
                    service: services.custom, from: sourceLanguage, to: targetLanguage, useCache: false, enableAIContext: false,
                    model: {[services.custom]: settings.model}, customModel: {}, proxy: {}, custom: endpoint,
                    deeplx: '', newApiUrl: '', minimaxBillingPlan: '', minimaxRegion: '', mimoBillingPlan: '', mimoRegion: '',
                    azureOpenaiEndpoint: '', customBody: {}, system_role: {}, user_role: {},
                    deepseekApiType: '', deepseekThinkingMode: '', token: {[services.custom]: settings.apiKey},
                    glossaryProtectedTokens: packet.tokens,
                });
                const body = JSON.parse(commonMsgTemplate({current, origin: packet.text, context,
                    serviceOverride: services.custom, targetLanguage, sourceLanguage, modelOverride: settings.model})) as Record<string, unknown>;
                const result = await standaloneOpenAIExecution.run({endpoint: parseChatCompletionsEndpoint(endpoint),
                    apiKey: settings.apiKey || undefined, requestBody: {...body, stream: false}, fetch: transport,
                    signal: activeSignal, maxRetries: 0});
                activeSignal.throwIfAborted();
                const restored = packet.restore(stripTranslationReasoning(result));
                if (!restored.trim()) throw new Error('翻译服务没有返回有效译文');
                if (!slot) return [restored];
                const values = parseTranslationSlots(slot, restored);
                if (!values) throw new LlmTransportError('模型未完整保留文档分段，正在改为逐段翻译', {
                    code: 'AI_MULTI_SEGMENT_RESPONSE_INVALID', kind: 'response', retryable: false,
                });
                return values;
            }, signal, Math.min(timeoutMs, request.timeout ?? timeoutMs));
        } catch (error) {
            if (signal?.aborted) throw new DOMException('翻译已取消', 'AbortError');
            if (error instanceof Error && error.name === 'TimeoutError') {
                throw new LlmTransportError('翻译请求超时，请重试或更换服务', {kind: 'timeout', retryable: true});
            }
            if (error instanceof LlmTransportError || (error as {code?: unknown})?.code === 'GLOSSARY_PLACEHOLDER_INVALID') throw error;
            const http = error as {statusCode?: number; retryAfterMs?: number};
            if (settings.service === 'microsoft' && Number.isInteger(http?.statusCode)) {
                const status = http.statusCode!;
                const normalized = normalizeLlmTransportError(settings.service, error, [], false, {
                    message: `HTTP ${status}`, statusCode: status,
                    isRetryable: status === 408 || status === 429 || status >= 500,
                });
                throw new LlmTransportError(normalized.message, {...normalized, retryAfterMs: http.retryAfterMs});
            }
            throw standaloneOpenAIExecution.normalizeError(settings.service, error,
                [settings.apiKey, settings.endpoint].filter(Boolean), false);
        }
    }

    const segments = createDocumentSegmentTranslator({
        waitUntilReady: () => undefined,
        getDefaultService: () => settings.service,
        getDefaultModel: () => settings.model,
        getRequestTimeout: () => timeoutMs,
        supportsBatch: service => service === 'microsoft',
        supportsAIMultiSegment: service => service === 'compatible',
        translateText: async (source, context, request) => (await translate([source], context, request))[0],
        translateTextBatch: translate,
    });
    return {segments, selection: async (text: string, signal: AbortSignal) => {
        const source = text.trim();
        if (!source || source.length > 30_000) throw new Error('请选择不超过 30000 字符的正文');
        return (await translate([source], 'Zotero academic document reading', {signal, pageContext: ''}))[0];
    }};
}

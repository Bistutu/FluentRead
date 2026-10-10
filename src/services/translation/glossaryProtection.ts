/**
 * @file src/services/translation/glossaryProtection.ts
 * 文件职责：在统一翻译调用边界保护术语，使机器翻译、AI 与批量请求共用相同的本地回填规则。
 * 主要内容：按冻结范围重新选取条目，文档入口自动保护地址和代码式名称，内部 g 标签不改成紧贴正文的术语标识并避开用户短词匹配，保持消息和内部槽协议，生成只含占位符的供应商术语约束，按消息的实际目标语言校验批量形状、行内结构和未翻译正文，显式词库标识保持允许；纯术语判断统一比较 NFC 写法，实际回填保留原文 Unicode。
 * 模块边界：不自行调用网络或修改配置；缓存、取消、超时与最终结果验证仍由 broker 管理。
 */
import {GlossaryPlaceholderError, protectGlossaryText, resolveGlossaryEntries} from '@/src/core/glossary';
import {DocumentInlineMarkerError, documentInlineMarkerRanges, findDocumentLiteralTerms, normalizeDocumentInlineMarkers, parseTranslationSlots, serializeTranslationSlots, validateDocumentInlineMarkers} from '@/src/core/translation/public';
import {attachTranslationProviderConfig, getTranslationGlossarySourceSlots, getTranslationGlossarySourceText} from './requestSnapshot';
import type {TranslationProviderConfigSnapshot, TranslationRequestMessage} from './types';

export function getGlossaryProtectionEntries(current: TranslationProviderConfigSnapshot, origin: string | string[]) {
    const context = current.glossaryMatchContext;
    if (!context) return [];
    const source = getTranslationGlossarySourceText(origin);
    const entries = current.glossaryTerms?.length ? resolveGlossaryEntries(current.glossaryLibraries ?? [], {...context,
        glossaryIds: context.glossaryIds ? [...context.glossaryIds] : null,
        text: source,
    }).terms : [];
    return context.context === 'document' ? [...entries, ...findDocumentLiteralTerms(source, entries)] : entries;
}

export function prepareGlossaryRequest(message: TranslationRequestMessage, current: TranslationProviderConfigSnapshot) {
    const targetLanguage = message.targetLanguage?.trim() || current.to;
    const entries = ('summaryPrompt' in message && message.summaryPrompt) ? [] : getGlossaryProtectionEntries(current, message.origin);
    if (!entries.length) return {message: current.glossaryMatchContext?.context === 'document'
        ? attachTranslationProviderConfig({...message}, current) : message,
        restore: (result: unknown) => validateDocumentTranslationResult(current, message.origin, result, targetLanguage)};
    const originals = Array.isArray(message.origin) ? message.origin : [message.origin];
    const packets = originals.map((text, index) => protectGlossaryText(text, entries, String(index),
        current.glossaryMatchContext?.context === 'document' ? documentInlineMarkerRanges(text) : []));
    const tokens = Object.freeze(packets.flatMap(packet => packet.tokens));
    const providerConfig = Object.freeze({...current, glossaryProtectedTokens: tokens});
    return {
        message: attachTranslationProviderConfig({...message,
            origin: Array.isArray(message.origin) ? packets.map(packet => packet.text) : packets[0].text,
            sourceLanguageDetectionText: message.sourceLanguageDetectionText ?? [getTranslationGlossarySourceText(message.origin)].flat().join("\n"),
        }, providerConfig),
        restore(result: unknown) {
            result = validateDocumentTranslationResult(current, message.origin, result, targetLanguage, tokens);
            if (!Array.isArray(message.origin)) return packets[0].restore(result);
            if (!Array.isArray(result) || result.length !== packets.length) throw new GlossaryPlaceholderError();
            return result.map((value, index) => {
                if (typeof value === 'string' && tokens.some(token => !packets[index].tokens.includes(token) && value.includes(token))) {
                    throw new GlossaryPlaceholderError();
                }
                return packets[index].restore(value);
            });
        },
    };
}

/** 免费候选与所有 provider 的最终恢复共用同一文档契约；序列化批次按原槽分别验证编号。 */
export function validateDocumentTranslationResult(current: TranslationProviderConfigSnapshot, origin: string | string[], result: unknown,
    targetLanguage = current.to, protectedTokens = current.glossaryProtectedTokens): unknown {
    if (current.glossaryMatchContext?.context !== 'document') return result;
    if (Array.isArray(origin)) {
        if (!Array.isArray(result) || result.length !== origin.length) throw new DocumentInlineMarkerError();
        return result.map((value, index) => validateDocumentTranslationResult(current, origin[index]!, value, targetLanguage, protectedTokens));
    }
    const slots = getTranslationGlossarySourceSlots(origin);
    const inlineContext = {targetLanguage, protectedTokens};
    if (!slots || !slots.texts.some(text => documentInlineMarkerRanges(text).length)) return validateDocumentInlineMarkers(origin, result, inlineContext);
    if (typeof result !== 'string') throw new DocumentInlineMarkerError();
    const values = parseTranslationSlots(slots.packet, normalizeDocumentInlineMarkers(result));
    if (!values) throw new DocumentInlineMarkerError();
    const translated = values.map((value, index) => validateDocumentInlineMarkers(slots.texts[index]!, value, inlineContext) as string);
    const nonce = slots.packet.starts[0]!.slice('___FLUENTREAD_'.length, -'_0_BEGIN___'.length);
    return serializeTranslationSlots(translated, nonce).payload;
}

/** 整段都是用户指定译法时，允许其保持原文或外语；规范化仅用于比较，不改写实际回填。 */
export function isGlossaryOnlyResult(current: TranslationProviderConfigSnapshot, origin: string, result: string): boolean {
    const entries = getGlossaryProtectionEntries(current, origin);
    if (!entries.length) return false;
    const packet = protectGlossaryText(origin, entries, '0', current.glossaryMatchContext?.context === 'document' ? documentInlineMarkerRanges(origin) : []);
    let remainder = packet.text;
    for (const token of packet.tokens) remainder = remainder.replace(token, '');
    // g 是本地恢复的格式语法；不能把标签名当成用户指定词之外尚未翻译的英文正文。
    if (current.glossaryMatchContext?.context === 'document') remainder = remainder.replace(/<\/?g[1-9]\d*\/?\s*>/gu, '');
    return !/[\p{L}\p{N}]/u.test(remainder) && packet.restore(packet.text).normalize('NFC') === result.normalize('NFC');
}

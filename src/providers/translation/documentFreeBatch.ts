/**
 * @file src/providers/translation/documentFreeBatch.ts
 * 文件职责：在同一文档请求所有权内消费免费线路返回的完整组或首槽译文，保持原始位置和共同取消边界。
 * 主要内容：严格辨认全组与单槽结果，按消费数继续剩余来源；原生线路消费全组，单文本线路每次只消费首段，本组已证实协议异常的原生候选逐段降级且不影响独立组；迟到取消不修改策略，失败停止领取和回填；内部标记仅作本地映射，不进入供应商原文数组。
 * 模块边界：仅接收免费 provider 注入的有界组和翻译端口，不读取 feature、配置、存储或路由健康，不选择线路、不创建网络请求及新超时预算。
 */
import {parseTranslationSlots, serializeTranslationSlots} from '@/src/core/translation/slotProtocol';
import {abortErrorFromSignal} from '@/src/platform/http/runtime';
import {isNativeBatchResponseError} from '@/src/core/translation/nativeBatch';

interface DocumentFreeGroup {readonly indexes: readonly number[]; readonly sources: readonly string[];}

/** 与完整组共用命名空间，但仅声明实际完成的首槽。 */
export function serializeDocumentFreeFirstSlot(sources: readonly string[], translation: unknown): string {
    if (typeof translation !== 'string' || !translation.trim()) throw Object.assign(new Error('免费翻译首段未返回有效译文'), {freeFailure: 'request'});
    const packet = serializeTranslationSlots(sources);
    const nonce = packet.starts[0]!.slice('___FLUENTREAD_'.length, -'_0_BEGIN___'.length);
    const single = serializeTranslationSlots([sources[0]!], nonce);
    const translated = serializeTranslationSlots([translation], nonce).payload;
    if (!parseTranslationSlots(single, translated)) throw Object.assign(new Error('免费翻译首段槽位异常'), {freeFailure: 'request'});
    return translated;
}

/** 统计候选实际收到的原文字符，不把尚未消费的槽算进单文本线路。 */
export function documentFreeAttemptCharacters(provider: string, sources: readonly string[], scalarProviders: ReadonlySet<string>): number {
    return (provider === 'microsoft' || provider === 'google') && !scalarProviders.has(provider)
        ? sources.reduce((total, source) => total + source.length, 0) : sources[0]!.length;
}

/** 只在本组记住有效时间内的协议失败；输掉的迟到 attempt 不能修改后续消费策略。 */
export async function runDocumentFreeNativeCandidate(
    provider: string, signal: AbortSignal, scalarProviders: Set<string>, translate: () => Promise<string>,
): Promise<string> {
    try {
        return await translate();
    } catch (error) {
        if (!signal.aborted && (isNativeBatchResponseError(error)
            || Boolean(error && typeof error === 'object' && (error as {freeFailure?: unknown}).freeFailure === 'request'))) {
            scalarProviders.add(provider);
        }
        throw error;
    }
}

export async function translateDocumentFreeGroups(
    texts: readonly string[],
    groups: readonly DocumentFreeGroup[],
    concurrency: number,
    signal: AbortSignal | undefined,
    translate: (sources: readonly string[], signal: AbortSignal, scalarProviders: Set<string>) => Promise<string>,
): Promise<string[]> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) throw abortErrorFromSignal(signal);
    signal?.addEventListener('abort', onAbort, {once: true});
    const translations = [...texts];
    let cursor = 0;
    let stopped = false;
    const throwIfAborted = () => {
        if (controller.signal.aborted) throw abortErrorFromSignal(controller.signal);
    };
    const worker = async () => {
        while (!stopped) {
            throwIfAborted();
            const group = groups[cursor++];
            if (!group) return;
            try {
                let consumed = 0;
                const scalarProviders = new Set<string>();
                while (consumed < group.sources.length && !stopped) {
                    throwIfAborted();
                    const sources = group.sources.slice(consumed);
                    const packet = serializeTranslationSlots(sources);
                    const translated = await translate(sources, controller.signal, scalarProviders);
                    throwIfAborted();
                    const values = parseTranslationSlots(packet, translated)
                        ?? parseTranslationSlots({...packet, starts: packet.starts.slice(0, 1), ends: packet.ends.slice(0, 1)}, translated);
                    if (!values || !values.length || values.some(value => !value.trim())) {
                        throw Object.assign(new Error('免费翻译返回的文档槽位不完整'), {freeFailure: 'request'});
                    }
                    values.forEach((value, ordinal) => {translations[group.indexes[consumed + ordinal]!] = value;});
                    consumed += values.length;
                }
            } catch (error) {
                stopped = true;
                controller.abort(error);
                throw error;
            }
        }
    };
    try {
        await Promise.all(Array.from({length: Math.min(concurrency, groups.length)}, worker));
        throwIfAborted();
        return translations;
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }
}

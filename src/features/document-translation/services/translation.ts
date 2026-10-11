/**
 * @file src/features/document-translation/services/translation.ts
 * 文件职责：编排文档片段的批量翻译流程，在固定语言和服务快照下按数量及字符预算拆批，并向调用方持续报告确定性进度。
 * 主要内容：定义进度与逐段提交契约，按阅读位置重排待译片段并可收紧单批大小，支持批量的服务同时保持数批请求在途、先返回的先提交，提交前移除服务凭空加入的表情符号，请求失败时可按退避间隔自动重试并向页面报告原因，被服务原样返回的专名与短词保留原文而不中断全文，复用已有译文继续未完成片段，同章节原文相同的片段只翻译一次，按原生章节和位置构建有界篇章参考并区分人工确认译文，提供文件解析所有权，固定文件级上下文，透传全局暂停状态、校验批次结果并阻止取消和失败后的迟到提交。
 * 模块边界：该层不解析文件、不持久化配置，也不直接绑定具体 provider；上层负责冻结用户设置并注入 gateway，文档结构由 core 提供，网络和缓存语义由应用翻译客户端承担。
 */
import {TranslationRequestError} from '@/src/services/translation/errors';
import {createDiscourseContext, discourseContextLimits, type DiscourseBlock} from '@/src/services/translation/context/discourse';
import type {DocumentSegment} from '@/src/features/document-translation/core/document';

export interface DocumentTranslationProgress {
    completed: number;
    total: number;
}

export interface DocumentTranslationOptions {
    glossaryIds?: readonly string[] | null;
    glossaryRevision?: string;
    fileName: string;
    /** 原文件摘要或当前会话文件标识；篇章状态仅属于这次任务，不持久化。 */
    materialId?: string;
    pageContext?: string;
    /** 沿用现有 AI 上下文开关；默认不创建篇章状态，也不改变并发。 */
    enableAIContext?: boolean;
    serviceOverride?: string;
    modelOverride?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    signal?: AbortSignal;
    maxRetries?: number;
    /** 同一文档和设置下已完成或人工校订的译文；空白位置继续翻译。 */
    initialTranslations?: readonly string[];
    /** 当前阅读会话里经用户编辑确认的片段，历史机器译文不能冒充用户确认。 */
    confirmedTranslationIds?: readonly number[];
    /** 每次领取下一批之前重排尚未翻译的片段，让阅读器把正在看的页排到前面；返回值必须恰好是传入的那些片段。 */
    prioritize?: (pending: readonly DocumentSegment[]) => readonly DocumentSegment[];
    /** 收紧单批的片段数与字符数，译文可以更细地逐批显示；只能小于默认上限。 */
    batchLimits?: {items?: number; characters?: number};
    /** 支持批量的服务同时在途的批次数，默认 3；设为 1 即逐批顺序请求。 */
    batchConcurrency?: number;
    /**
     * 请求失败时按 2、4、8…秒（单次不超过 30 秒）退避重试，累计等待不超过 maxWaitMs；
     * 不提供时保持“失败即停止”。sleep 仅供测试替换计时。
     */
    retryBackoff?: {maxWaitMs: number; sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>};
    /** 每次退避开始前通知页面：第几次重试、要等多久、上一次失败的原因。 */
    onRetry?: (retry: {attempt: number; delayMs: number; reason: string}) => void;
    onSegment?: (segment: {id: number; translation: string}) => void;
    onProgress?: (progress: DocumentTranslationProgress) => void;
}

export interface DocumentTranslationRequestOptions {
    glossaryIds?: readonly string[] | null;
    glossaryRevision?: string;
    glossaryContext?: 'document';
    signal?: AbortSignal;
    pageContext: string;
    discourseContext?: string;
    enableAIContext?: boolean;
    serviceOverride?: string;
    modelOverride?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    maxRetries?: number;
}

/**
 * 文档翻译只依赖这一组端口，不读取 WXT storage 或具体 provider。
 * 入口层负责把当前配置、批量能力和翻译客户端注入进来。
 */
export interface DocumentTranslationGateway {
    getGlossaryOptions?(): {glossaryIds?: readonly string[] | null; glossaryRevision?: string};
    waitUntilReady(): PromiseLike<unknown> | unknown;
    getDefaultService(): string;
    supportsBatch(service: string): boolean;
    translateText(
        source: string,
        context: string,
        options: DocumentTranslationRequestOptions,
    ): Promise<string>;
    translateTextBatch(
        sources: string[],
        context: string,
        options: DocumentTranslationRequestOptions,
    ): Promise<string[]>;
}

export type TranslateDocumentSegments = (
    segments: readonly DocumentSegment[],
    options: DocumentTranslationOptions,
) => Promise<string[]>;

export interface DocumentFileLoadRequest {
    /** 旧解析 Promise 完成时必须再次检查，只有当前请求可以提交页面状态。 */
    isCurrent(): boolean;
}

export interface DocumentFileLoadGuard {
    begin(): DocumentFileLoadRequest;
    invalidate(): void;
}

/**
 * 为无法真正中止的 PDF/ePub/DOCX 解析提供最新请求所有权。
 * 新文件或页面重置会推进代次，旧解析仍可自然结束，但不能覆盖较新的文档。
 */
export function createDocumentFileLoadGuard(): DocumentFileLoadGuard {
    let generation = 0;
    return {
        begin() {
            const requestGeneration = ++generation;
            return {isCurrent: () => requestGeneration === generation};
        },
        invalidate() {
            generation += 1;
        },
    };
}

const BATCH_ITEM_LIMIT = 16;
const BATCH_CHARACTER_LIMIT = 3_500;
const BATCH_CONCURRENCY = 3;

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        const error = new Error('文档翻译已取消');
        error.name = 'AbortError';
        throw error;
    }
}

/** 从队首取出一批：至少一个片段，其后在数量与字符预算内尽量多取。 */
function takeBatch(queue: DocumentSegment[], itemLimit: number, characterLimit: number): DocumentSegment[] {
    let count = 0;
    let characters = 0;
    while (count < queue.length && (count === 0 || (count < itemLimit && characters + queue[count].source.length <= characterLimit))) {
        characters += queue[count].source.length;
        count += 1;
    }
    return queue.splice(0, count);
}

/** 重排结果只有在与待译片段一一对应时才采用，调用方的失误不能丢失或重复片段。 */
function prioritized(queue: DocumentSegment[], prioritize: DocumentTranslationOptions['prioritize']): DocumentSegment[] {
    const ordered = prioritize?.(queue);
    if (!ordered || ordered.length !== queue.length) return queue;
    const known = new Set(queue);
    const unique = new Set(ordered);
    return unique.size === queue.length && ordered.every(segment => known.has(segment)) ? [...ordered] : queue;
}

/**
 * 专名、缩写、单位和表格里的短词译成目标语言后常与原文相同，翻译层会把“原样返回”报告为 UNTRANSLATED_RESPONSE。
 * 对整篇文档来说这不是故障：这类片段保留原文即可，不能让它中断其余几百段的翻译。
 */
function untranslatedEcho(error: unknown): boolean {
    return (error as {code?: unknown} | null)?.code === 'UNTRANSLATED_RESPONSE';
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        const finish = () => {clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve();};
        const timer = setTimeout(finish, milliseconds);
        signal?.addEventListener('abort', finish, {once: true});
    });
}

/**
 * 限流、网络抖动或服务原样返回原文多半是暂时的：隔一会儿再试往往就能继续，不必让读者反复手动点“继续翻译”。
 * 暂停、取消与“翻译已关闭”不重试；等待预算用完后抛出最后一次的错误，由调用方给出失败原因。
 */
async function withRetryBackoff<T>(work: () => Promise<T>, options: DocumentTranslationOptions, attempt = 1, waited = 0): Promise<T> {
    try {
        return await work();
    } catch (error) {
        throwIfAborted(options.signal);
        const delayMs = Math.min(30_000, 2_000 * 2 ** (attempt - 1), (options.retryBackoff?.maxWaitMs ?? 0) - waited);
        if (delayMs <= 0 || untranslatedEcho(error) || (error instanceof TranslationRequestError && error.code === 'TRANSLATION_DISABLED')) throw error;
        options.onRetry?.({attempt, delayMs, reason: getErrorMessage(error)});
        await (options.retryBackoff?.sleep ?? abortableSleep)(delayMs, options.signal);
        throwIfAborted(options.signal);
        return withRetryBackoff(work, options, attempt + 1, waited + delayMs);
    }
}

const PICTOGRAPH = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;

/**
 * 翻译服务偶尔会把公式残片或乱码“译”成表情符号。原文没有的图形符号不属于译文，提交前移除；
 * 原文本身带有的符号（如 ©、™ 或作者写下的表情）原样保留，清理后为空时保留服务返回的内容。
 */
export function stripInventedPictographs(source: string, translation: string): string {
    const cleaned = translation.replace(PICTOGRAPH, match => source.includes(match) ? match : '');
    return cleaned.trim() ? cleaned : translation;
}

function boundedLimit(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && value! >= 1 ? Math.min(fallback, Math.floor(value!)) : fallback;
}

function buildDocumentContext(segments: readonly DocumentSegment[], fileName: string, supplied?: string): string {
    if (supplied?.trim()) return supplied.trim().slice(0, 4_000);
    const preview = segments
        .slice(0, 24)
        .map((segment) => segment.source)
        .join('\n')
        .trim();
    return `Document: ${fileName}\n${preview}`.slice(0, 4_000);
}

/** 原生章节标签变化与显式标题形成局部作用域，以起始片段位置隔离；页码只提供位置，不猜测人物或缩写含义。 */
function documentDiscourseBlocks(segments: readonly DocumentSegment[]): DiscourseBlock[] {
    let section = 'document';
    let chapterLabel: string | undefined;
    return segments.map(segment => {
        const label = segment.contextLabel;
        // 页码只有位置语义：翻到下一页不能让同一人物突然丢掉前文；重复的章节标签也不重复切章。
        const pageLabel = label && /^(?:第\s*\d+\s*页|Page\s+\d+)$/iu.test(label.trim());
        const changedChapter = label && !pageLabel && label !== chapterLabel;
        if (changedChapter || segment.role === 'title' || segment.role === 'heading') section = `section:${segment.id}`;
        if (label && !pageLabel) chapterLabel = label;
        return {id: String(segment.id), section, source: segment.source,
            position: [segment.contextLabel, segment.pathLabel, segment.timeStart, `段落 ${segment.id + 1}`].filter(Boolean).join(' · ')};
    });
}

export function createDocumentSegmentTranslator(
    gateway: DocumentTranslationGateway,
): TranslateDocumentSegments {
    return async (segments, options) => {
        await gateway.waitUntilReady();
        throwIfAborted(options.signal);
        const glossary = gateway.getGlossaryOptions?.();
        const selectedGlossaryIds = options.glossaryIds ?? glossary?.glossaryIds;
        const glossaryOptions = {
            glossaryContext: 'document' as const,
            glossaryIds: selectedGlossaryIds ? [...selectedGlossaryIds] : selectedGlossaryIds,
            glossaryRevision: options.glossaryRevision ?? glossary?.glossaryRevision,
        };

        if (segments.length === 0) return [];
        const translations = new Array<string>(segments.length).fill('');
        segments.forEach(({id}) => { translations[id] = options.initialTranslations?.[id] || ''; });
        const pending = segments.filter(({id}) => !translations[id].trim());
        const context = options.fileName || 'FluentRead 文档';
        const pageContext = buildDocumentContext(segments, context, options.pageContext);
        // 步骤 1：一次文档任务固定语言对，不能被设置页同步更新或用户中途改选污染后续批次。
        const sourceLanguage = options.sourceLanguage;
        const targetLanguage = options.targetLanguage;
        const service = options.serviceOverride || gateway.getDefaultService();
        const model = options.modelOverride;
        const enableAIContext = options.enableAIContext === true;
        const blocks = Object.freeze(documentDiscourseBlocks(segments).map(block => Object.freeze(block)));
        const blockSections = new Map(blocks.map(block => [Number(block.id), block.section]));
        const reuseKeys = new Map(segments.map(segment => [segment.id, JSON.stringify([blockSections.get(segment.id), segment.source])]));
        const reuseKey = ({id}: DocumentSegment) => reuseKeys.get(id)!;
        const segmentById = new Map(segments.map(segment => [segment.id, segment]));
        const discourse = enableAIContext ? createDiscourseContext() : undefined;
        const materialId = options.materialId || context;
        const languageKey = JSON.stringify([sourceLanguage, targetLanguage, service, model, glossaryOptions.glossaryRevision]);
        const prepareDiscourse = (id: number, origins: string[]) => {
            // 同一冻结材料只算一次全文版本；章节焦点移动保留有界译文，读取后文不会退化为前缀参考。
            discourse?.replace(materialId, languageKey, blocks, String(id));
            return discourse?.prepare(String(id), origins, options.signal);
        };
        const confirmed = new Set(options.confirmedTranslationIds);
        if (discourse) {
            // 历史可能已经译完几千段，最多回填状态本身可保存的64对；确认来源优先占用预算。
            const confirmedSegments = segments.filter(segment => confirmed.has(segment.id) && translations[segment.id].trim()).slice(-discourseContextLimits.pairs);
            const previousSegments = segments.filter(segment => !confirmed.has(segment.id) && translations[segment.id].trim());
            const machineBudget = discourseContextLimits.pairs - confirmedSegments.length;
            const seeds = [...(machineBudget ? previousSegments.slice(-machineBudget) : []), ...confirmedSegments];
            for (const segment of seeds) {
                prepareDiscourse(segment.id, [segment.source])?.commit([translations[segment.id]], confirmed.has(segment.id));
            }
        }
        const discourseOptions = (segment: DocumentSegment, origins: string[]) => ({
            ...(options.enableAIContext === undefined ? {} : {enableAIContext}),
            ...(discourse ? {discourseContext: prepareDiscourse(segment.id, origins)!.context} : {}),
        });
        try {
            let completed = segments.length - pending.length;
            const reportProgress = () => options.onProgress?.({completed, total: segments.length});
            const sources = new Map(segments.map(segment => [segment.id, segment.source]));
            // 同章节原文相同的片段只翻译一次；换章后同样的缩写或人物名可能另有所指，不能强行合并。
            const twins = new Map<string, number[]>();
            for (const segment of pending) {
                const key = reuseKey(segment);
                twins.set(key, [...(twins.get(key) ?? []), segment.id]);
            }
            const commit = (id: number, received: string) => {
                throwIfAborted(options.signal);
                const source = sources.get(id)!;
                const translation = stripInventedPictographs(source, received);
                prepareDiscourse(id, [source])?.commit([translation]);
                for (const twin of twins.get(reuseKey(segmentById.get(id)!))!) {
                    translations[twin] = translation;
                    completed += 1;
                    options.onSegment?.({id: twin, translation});
                }
            };
            // 继续未完成的任务时，已有译文的原文直接复用给后面相同的片段，不再请求。
            const known = new Map<string, string>();
            for (const segment of segments) if (translations[segment.id].trim() && !known.has(reuseKey(segment))) known.set(reuseKey(segment), translations[segment.id]);
            for (const segment of pending) if (!translations[segment.id].trim() && known.has(reuseKey(segment))) commit(segment.id, known.get(reuseKey(segment))!);
            reportProgress();

            /** 认领一批（或一段）之后，把队列里原文相同的片段一并拿走；它们随这一批的结果提交。 */
            const claim = (taken: DocumentSegment[]): DocumentSegment[] => {
                const claimed = new Set(taken.map(reuseKey));
                queue = queue.filter(segment => !claimed.has(reuseKey(segment)));
                return taken.filter((segment, index) => taken.findIndex(other => reuseKey(other) === reuseKey(segment)) === index);
            };
            let queue = pending.filter(({id}) => !translations[id].trim());
            if (gateway.supportsBatch(service)) {
                const itemLimit = boundedLimit(options.batchLimits?.items, BATCH_ITEM_LIMIT);
                const characterLimit = boundedLimit(options.batchLimits?.characters, BATCH_CHARACTER_LIMIT);
                // 同时发出几批请求：先出结果的那一批先显示，整篇的等待时间按并发数缩短；任何一批失败后其余批次不再认领新片段。
                let failed = false;
                const batchWorker = async () => {
                while (queue.length > 0 && !failed) {
                    throwIfAborted(options.signal);
                    queue = prioritized(queue, options.prioritize);
                    const batch = claim(takeBatch(queue, itemLimit, characterLimit));
                    try {
                        const result = await withRetryBackoff(async () => {
                        const result = await gateway.translateTextBatch(
                            batch.map((segment) => segment.source),
                            context,
                            {
                                ...glossaryOptions,
                                ...discourseOptions(batch[0], batch.map(segment => segment.source)),
                                signal: options.signal,
                                pageContext,
                                serviceOverride: service,
                                modelOverride: model,
                                sourceLanguage,
                                targetLanguage,
                                maxRetries: options.maxRetries,
                            },
                        );
                        throwIfAborted(options.signal);
                        // 按请求位置校验，Array.some 会跳过返回数组中的空洞。
                        if (result.length !== batch.length || batch.some((_, index) => typeof result[index] !== 'string' || !result[index].trim())) {
                            throw new Error('翻译服务返回的片段不完整，请重试');
                        }
                        return result;
                        }, options);
                        if (failed) return;
                        result.forEach((translation, index) => commit(batch[index].id, translation));
                        reportProgress();
                    } catch (error) {
                        if (failed) return;
                        throwIfAborted(options.signal);
                        if (untranslatedEcho(error)) {
                            // 整批里只要有一段被原样返回就会整批报错；逐段重译，仍被原样返回的那几段保留原文。
                            for (const segment of batch) {
                                throwIfAborted(options.signal);
                                let translation = segment.source;
                                try {
                                    const received = await gateway.translateText(segment.source, context, {...glossaryOptions, ...discourseOptions(segment, [segment.source]), signal: options.signal, pageContext,
                                        serviceOverride: service, modelOverride: model, sourceLanguage, targetLanguage, maxRetries: options.maxRetries});
                                    if (typeof received === 'string' && received.trim()) translation = received;
                                } catch (single) {
                                    throwIfAborted(options.signal);
                                    if (!untranslatedEcho(single)) {failed = true; throw new Error(`第 ${segment.id + 1} 段文档翻译失败：${getErrorMessage(single)}`);}
                                }
                                commit(segment.id, translation);
                                reportProgress();
                            }
                            continue;
                        }
                        failed = true;
                        if (error instanceof TranslationRequestError && error.code === 'TRANSLATION_DISABLED') throw error;
                        throw new Error(`第 ${batch[0].id + 1} 段文档翻译失败：${getErrorMessage(error)}`);
                    }
                }
                };
                await Promise.all(Array.from({length: boundedLimit(options.batchConcurrency, BATCH_CONCURRENCY)}, () => batchWorker()));
                return translations;
            }

            let stopped = false;
            // 开启篇章参考的 AI 逐段请求按序提交，使后文能复用已译前文；关闭时保留原来的三个并行 worker。
            const workerCount = Math.min(enableAIContext ? 1 : 3, queue.length);
            const worker = async () => {
                while (true) {
                    throwIfAborted(options.signal);
                    queue = prioritized(queue, options.prioritize);
                    const segment = queue.shift();
                    if (!segment) return;
                    claim([segment]);

                    try {
                        const translation = await withRetryBackoff(async () => {
                            const received = await gateway.translateText(segment.source, context, {
                                ...glossaryOptions,
                                ...discourseOptions(segment, [segment.source]),
                                signal: options.signal,
                                pageContext,
                                serviceOverride: service,
                                modelOverride: model,
                                sourceLanguage,
                                targetLanguage,
                                maxRetries: options.maxRetries,
                            });
                            // 其他 worker 已经失败时不再为这一段重试。
                            if (!stopped && (typeof received !== 'string' || !received.trim())) throw new Error('翻译服务返回空译文，请重试');
                            return received;
                        }, options);
                        // Promise.all 会在首个 worker 失败时立即 reject；其余在途请求仍会稍后结束。
                        // 步骤 1：失败后不再上报过期进度，也不继续认领新的文档片段。
                        if (stopped) return;
                        throwIfAborted(options.signal);
                        commit(segment.id, translation);
                        reportProgress();
                    } catch (error) {
                        if (stopped) return;
                        if (!options.signal?.aborted && untranslatedEcho(error)) {commit(segment.id, segment.source); reportProgress(); continue;}
                        stopped = true;
                        if (options.signal?.aborted) throwIfAborted(options.signal);
                        if (error instanceof TranslationRequestError && error.code === 'TRANSLATION_DISABLED') throw error;
                        throw new Error(`第 ${segment.id + 1} 段文档翻译失败：${getErrorMessage(error)}`);
                    }
                }
            };

            await Promise.all(Array.from({length: workerCount}, () => worker()));
            return translations;
        } finally {discourse?.clear();}
    };
}

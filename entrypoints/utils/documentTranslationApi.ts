import {config, configReady} from '@/entrypoints/utils/config';
import {services} from '@/entrypoints/utils/option';
import {translateText, translateTextBatch} from '@/entrypoints/utils/translateApi';
import type {DocumentSegment} from '@/entrypoints/utils/documentTranslation';

export interface DocumentTranslationProgress {
    completed: number;
    total: number;
}

export interface DocumentTranslationOptions {
    fileName: string;
    pageContext?: string;
    serviceOverride?: string;
    modelOverride?: string;
    signal?: AbortSignal;
    maxRetries?: number;
    onProgress?: (progress: DocumentTranslationProgress) => void;
}

const BATCH_ITEM_LIMIT = 16;
const BATCH_CHARACTER_LIMIT = 3_500;

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

function isBatchFriendlyService(service = config.service): boolean {
    return service === services.microsoft || service === services.freeTranslation;
}

function splitBatches(segments: readonly DocumentSegment[]): DocumentSegment[][] {
    const batches: DocumentSegment[][] = [];
    let current: DocumentSegment[] = [];
    let currentCharacters = 0;

    segments.forEach((segment) => {
        const nextCharacters = currentCharacters + segment.source.length;
        if (current.length > 0 && (current.length >= BATCH_ITEM_LIMIT || nextCharacters > BATCH_CHARACTER_LIMIT)) {
            batches.push(current);
            current = [];
            currentCharacters = 0;
        }
        current.push(segment);
        currentCharacters += segment.source.length;
    });

    if (current.length > 0) batches.push(current);
    return batches;
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

export async function translateDocumentSegments(
    segments: readonly DocumentSegment[],
    options: DocumentTranslationOptions,
): Promise<string[]> {
    await configReady;
    throwIfAborted(options.signal);

    if (segments.length === 0) return [];
    const translations = new Array<string>(segments.length);
    const context = options.fileName || 'FluentRead 文档';
    const pageContext = buildDocumentContext(segments, context, options.pageContext);
    let completed = 0;
    const reportProgress = () => options.onProgress?.({completed, total: segments.length});
    reportProgress();

    const service = options.serviceOverride || config.service;
    if (isBatchFriendlyService(service)) {
        for (const batch of splitBatches(segments)) {
            throwIfAborted(options.signal);
            try {
                const result = await translateTextBatch(
                    batch.map((segment) => segment.source),
                    context,
                    {
                        signal: options.signal,
                        pageContext,
                        serviceOverride: options.serviceOverride,
                        modelOverride: options.modelOverride,
                        maxRetries: options.maxRetries,
                    },
                );
                result.forEach((translation, index) => {
                    translations[batch[index].id] = translation;
                });
                completed += batch.length;
                reportProgress();
            } catch (error) {
                throw new Error(`第 ${completed + 1} 段文档翻译失败：${getErrorMessage(error)}`);
            }
        }
        return translations;
    }

    let nextIndex = 0;
    const workerCount = Math.min(3, segments.length);
    const worker = async () => {
        while (true) {
            throwIfAborted(options.signal);
            const index = nextIndex;
            nextIndex += 1;
            if (index >= segments.length) return;

            try {
                translations[segments[index].id] = await translateText(segments[index].source, context, {
                    signal: options.signal,
                    pageContext,
                    serviceOverride: options.serviceOverride,
                    modelOverride: options.modelOverride,
                    maxRetries: options.maxRetries,
                });
                completed += 1;
                reportProgress();
            } catch (error) {
                throw new Error(`第 ${index + 1} 段文档翻译失败：${getErrorMessage(error)}`);
            }
        }
    };

    await Promise.all(Array.from({length: workerCount}, () => worker()));
    return translations;
}

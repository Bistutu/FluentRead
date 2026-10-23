/**
 * @file src/services/translation/requestDeadline.ts
 * 文件职责：统一共享翻译入口和 broker 的初始请求预算与可信计时起点，避免配置水合重置总截止时间。
 * 主要内容：公开预算保留一秒下限，内部剩余预算保留毫秒精度；缺省水合最多等待四十五秒，之后由 broker 按已水合服务解析最终预算；起点使用不可枚举 symbol 随内部请求快照传递。
 * 模块边界：只解析进程内请求元数据，不启动计时器、不读取配置、不调用 provider；调用方负责取消、等待和清理。
 */
import {TRANSLATION_REMAINING_BUDGET, TRANSLATION_REQUEST_STARTED_AT, type TranslationRemainingBudgetContext,
    type TranslationRequestMessage} from './types';

export const DEFAULT_PROVIDER_TIMEOUT_MS = 45_000;

export class TranslationProviderDeadlineError extends Error {
    constructor() {
        super('翻译请求超时');
        this.name = 'TranslationProviderDeadlineError';
    }
}

/** 内部预算不能再次抬高到公开请求的一秒下限。 */
export function normalizeDeadlineTimeoutMs(requestTimeoutMs: number): number {
    return Math.max(1, Math.floor(requestTimeoutMs));
}

export function getExplicitTranslationBudget(message: TranslationRequestMessage): number | undefined {
    if (typeof message.requestTimeoutMs !== 'number' || !Number.isFinite(message.requestTimeoutMs)) return undefined;
    return (message as TranslationRemainingBudgetContext)[TRANSLATION_REMAINING_BUDGET] === true
        ? normalizeDeadlineTimeoutMs(message.requestTimeoutMs)
        : Math.max(1_000, Math.floor(message.requestTimeoutMs));
}

/** 入口只对自己的请求快照附加起点；broker 沿用该起点，直接调用时自行开始计时。 */
export function startTranslationRequest(message: TranslationRequestMessage, now: () => number): number {
    const previous = (message as {[TRANSLATION_REQUEST_STARTED_AT]?: number})[TRANSLATION_REQUEST_STARTED_AT];
    if (typeof previous === 'number' && Number.isFinite(previous)) return previous;
    const startedAt = now();
    Object.defineProperty(message, TRANSLATION_REQUEST_STARTED_AT, {value: startedAt});
    return startedAt;
}

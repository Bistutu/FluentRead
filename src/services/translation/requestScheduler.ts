/**
 * @file src/services/translation/requestScheduler.ts
 *
 * 文件职责：统一执行翻译任务的并发和请求启动速率限制，支持取消、截止时间、服务/模型 bucket 与真实 HTTP attempt。
 * 主要内容：旧配置继续使用 global bucket；启用服务或模型限制后按稳定请求身份切换 bucket，每轮按当前配置重新计入仍在途的外层请求，直到真实 transport lease 结束；provider 的 attempt 只复用速率历史而不重复占用外层并发槽；单次 drain 内缓存 bucket key 与限额，并以累积等待 bucket 的一次线性前向扫描启动全部可启动任务。
 * 模块边界：本模块只管理调度时序，不选择服务、不实现重试、不读取或写入配置；配置由调用方通过 getConfig 提供。
 */

import {
    normalizeMaxConcurrentTranslations,
    normalizeTranslationRequestsPerMinute,
    normalizeTranslationRequestsPerSecond,
} from '@/src/core/config/scheduling';
import {normalizeTranslationRequestLimits} from '@/src/core/config/requestLimits';

export interface TranslationRequestLimits {
    maxConcurrentTranslations?: unknown;
    translationRequestsPerSecond?: unknown;
    translationRequestsPerMinute?: unknown;
}

export interface TranslationRequestLimitSetting {
    enabled?: unknown;
    limits?: TranslationRequestLimits;
}

export interface TranslationRequestSchedulerConfig extends TranslationRequestLimits {
    serviceRequestLimits?: Record<string, TranslationRequestLimitSetting>;
    modelRequestLimits?: Record<string, Record<string, TranslationRequestLimitSetting>>;
}

export interface TranslationRequestIdentity {
    readonly service?: string;
    readonly model?: string;
}

export interface TranslationRequestLease {
    holdUntil(settlement: PromiseLike<unknown>): void;
}

export interface TranslationRequestSchedulerTaskOptions {
    signal?: AbortSignal;
    deadlineAt?: number;
    identity?: TranslationRequestIdentity;
    /** 外层 AI SDK 调用只占并发，真实 HTTP attempt 由 scheduleAttempt 计速率。 */
    countRate?: boolean;
}

export interface TranslationRequestAttemptOptions {
    signal?: AbortSignal;
    deadlineAt?: number;
    identity?: TranslationRequestIdentity;
}

export interface TranslationRequestScheduler {
    schedule<T>(task: (lease: TranslationRequestLease) => Promise<T>, options?: TranslationRequestSchedulerTaskOptions): Promise<T>;
    /** 真实 HTTP attempt 只取得速率许可；外层 provider 已持有并发 lease。 */
    scheduleAttempt<T>(task: () => Promise<T>, options?: TranslationRequestAttemptOptions): Promise<T>;
}

export class TranslationRequestSchedulerDeadlineError extends Error {
    readonly code = 'TRANSLATION_SCHEDULER_DEADLINE_EXCEEDED';
    constructor(message = '翻译请求超时') {
        super(message);
        this.name = 'TranslationRequestSchedulerDeadlineError';
    }
}

interface BucketLimit {
    concurrency: number;
    perSecond: number;
    perMinute: number;
}
interface BucketState {
    active: number;
    starts: number[];
}
interface PendingRequest<T> {
    readonly task: (lease: TranslationRequestLease) => Promise<T>;
    readonly signal?: AbortSignal;
    readonly deadlineAt?: number;
    readonly identity?: TranslationRequestIdentity;
    readonly attemptOnly: boolean;
    readonly countRate: boolean;
    readonly resolve: (value: T | PromiseLike<T>) => void;
    readonly reject: (reason?: unknown) => void;
    settled: boolean;
    removeAbortListener?: () => void;
}

export interface TranslationRequestSchedulerDependencies {
    now?: () => number;
}

function createAbortError(): Error {
    const error = new Error('翻译已取消');
    error.name = 'AbortError';
    return error;
}
function finiteNow(now: () => number): number {
    const value = now();
    return Number.isFinite(value) ? value : Date.now();
}
function clean(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function createTranslationRequestScheduler(
    getConfig: () => TranslationRequestSchedulerConfig,
    dependencies: TranslationRequestSchedulerDependencies = {},
): TranslationRequestScheduler {
    const now = dependencies.now ?? (() => Date.now());
    const buckets = new Map<string, BucketState>();
    const activeRequests = new Set<PendingRequest<unknown>>();
    let pending: Array<PendingRequest<unknown> | undefined> = [];
    let head = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let draining = false;
    let drainRequested = false;
    let lastNow: number | undefined;

    function readNow(): number {
        const current = finiteNow(now);
        if (lastNow !== undefined && current < lastNow) {
            for (const state of buckets.values()) state.starts.length = 0;
        }
        lastNow = current;
        return current;
    }

    function currentConfig(): TranslationRequestSchedulerConfig {
        try {
            return getConfig() || {};
        } catch {
            return {};
        }
    }

    const GLOBAL_KEYS: readonly string[] = ['global'];
    /**
     * 一次 drain 内配置是固定的，而 bucket key 与限额原本要为每个待处理任务
     * （并在公平性检查里为每个更早的任务）重新做 JSON.stringify / JSON.parse。
     * 这两张表把同一次 drain 内的重复计算折叠成一次。
     */
    let keyMemo = new Map<string, readonly string[]>();
    let limitMemo = new Map<string, BucketLimit>();

    function resetDrainMemo(): void {
        keyMemo = new Map();
        limitMemo = new Map();
    }

    function keysFor(identity: TranslationRequestIdentity | undefined, config: TranslationRequestSchedulerConfig): readonly string[] {
        const service = clean(identity?.service);
        if (!service) return GLOBAL_KEYS;
        const model = clean(identity?.model);
        const memoKey = `${service}\u0000${model}`;
        const cached = keyMemo.get(memoKey);
        if (cached) return cached;
        const serviceSetting = config.serviceRequestLimits?.[service];
        const modelSetting = model ? config.modelRequestLimits?.[service]?.[model] : undefined;
        let result: readonly string[];
        if (modelSetting?.enabled === true) {
            const keys = [JSON.stringify(['model', service, model])];
            if (serviceSetting?.enabled === true) keys.push(JSON.stringify(['service', service]));
            result = keys;
        } else {
            result = serviceSetting?.enabled === true ? [JSON.stringify(['service', service])] : GLOBAL_KEYS;
        }
        keyMemo.set(memoKey, result);
        return result;
    }

    function stateFor(key: string): BucketState {
        let state = buckets.get(key);
        if (!state) {
            state = {active: 0, starts: []};
            buckets.set(key, state);
        }
        return state;
    }

    function refreshActiveBuckets(config: TranslationRequestSchedulerConfig): void {
        // 用户可在请求仍运行时切换沿用/自定义。启动时的 bucket 已不是当前约束，
        // 因此按稳定请求身份重新投影所有在途任务；starts 继续保留原速率历史。
        // settled 仅表示调用方收到结果，holdUntil 未结束的 transport 仍在集合里。
        for (const state of buckets.values()) state.active = 0;
        for (const entry of activeRequests) {
            for (const key of keysFor(entry.identity, config)) stateFor(key).active += 1;
        }
    }

    function limitFor(key: string, config: TranslationRequestSchedulerConfig): BucketLimit {
        const cached = limitMemo.get(key);
        if (cached) return cached;
        let limit: BucketLimit;
        if (key === 'global') {
            limit = {
                concurrency: normalizeMaxConcurrentTranslations(config.maxConcurrentTranslations),
                perSecond: normalizeTranslationRequestsPerSecond(config.translationRequestsPerSecond),
                perMinute: normalizeTranslationRequestsPerMinute(config.translationRequestsPerMinute),
            };
        } else {
            const [kind, service, model] = JSON.parse(key) as string[];
            const setting = kind === 'service' ? config.serviceRequestLimits?.[service!] : config.modelRequestLimits?.[service!]?.[model!];
            const limits = normalizeTranslationRequestLimits(setting?.limits);
            limit = {
                concurrency: limits.maxConcurrentTranslations,
                perSecond: limits.translationRequestsPerSecond,
                perMinute: limits.translationRequestsPerMinute,
            };
        }
        limitMemo.set(key, limit);
        return limit;
    }

    function prune(state: BucketState, current: number): void {
        const cutoff = current - 60_000;
        let index = 0;
        while (index < state.starts.length && state.starts[index]! <= cutoff) index += 1;
        if (index) state.starts.splice(0, index);
    }

    function waitFor(key: string, current: number, config: TranslationRequestSchedulerConfig, concurrency: boolean, countRate: boolean): number {
        const state = stateFor(key);
        const limits = limitFor(key, config);
        prune(state, current);
        if (concurrency && state.active >= limits.concurrency) return Number.POSITIVE_INFINITY;
        if (!countRate) return 0;
        let wait = 0;
        if (limits.perSecond > 0 && state.starts.length >= limits.perSecond) {
            // 启动时间单调递增：只需检查倒数第 N 条何时离开窗口，不必逐条数最近一秒的记录。
            // 配置动态降低上限时也使用同一位置，恰好满一秒的记录不再占用速率额度。
            wait = Math.max(wait, state.starts[state.starts.length - limits.perSecond]! + 1_000 - current);
        }
        if (limits.perMinute > 0 && state.starts.length >= limits.perMinute) {
            wait = Math.max(wait, state.starts[state.starts.length - limits.perMinute]! + 60_000 - current);
        }
        return wait;
    }

    function compact(): void {
        while (head < pending.length && !pending[head]) head += 1;
        if (head >= pending.length) {
            pending = [];
            head = 0;
        } else if (head >= 1024 && head * 2 >= pending.length) {
            pending = pending.slice(head);
            head = 0;
        }
    }

    function rejectPending(entry: PendingRequest<unknown>, error: unknown): void {
        entry.settled = true;
        entry.removeAbortListener?.();
        entry.reject(error);
    }

    function rejectInactive(current: number): void {
        for (let index = head; index < pending.length; index += 1) {
            const entry = pending[index];
            if (!entry) continue;
            if (entry.settled) pending[index] = undefined;
            else if (entry.deadlineAt !== undefined && entry.deadlineAt <= current) {
                pending[index] = undefined;
                rejectPending(entry, new TranslationRequestSchedulerDeadlineError());
            }
        }
        compact();
    }

    function arm(delay: number): void {
        timer = setTimeout(() => {
            timer = undefined;
            drain();
        }, Math.max(1, Math.ceil(delay)));
    }

    function createLease() {
        const waits: Promise<void>[] = [];
        let open = true;
        return {
            lease: {
                holdUntil: (settlement: PromiseLike<unknown>) => {
                    if (!open) throw new Error('翻译请求已结束，无法继续占用调度槽');
                    waits.push(Promise.resolve(settlement).then(() => undefined, () => undefined));
                },
            },
            waits,
            close: () => { open = false; },
        };
    }

    async function execute(entry: PendingRequest<unknown>): Promise<void> {
        const leaseState = createLease();
        try {
            const result = await entry.task(leaseState.lease);
            if (!entry.settled) {
                entry.settled = true;
                entry.removeAbortListener?.();
                entry.resolve(result);
            }
        } catch (error) {
            if (!entry.settled) {
                entry.settled = true;
                entry.removeAbortListener?.();
                entry.reject(error);
            }
        } finally {
            // 调用方可以先收到取消/超时；真实传输结束后才归还并发槽。
            leaseState.close();
            await Promise.all(leaseState.waits);
            activeRequests.delete(entry);
            drain();
        }
    }

    function drain(): void {
        if (draining) {
            drainRequested = true;
            return;
        }
        draining = true;
        try {
            // task 可以同步取消较早的等待请求；重入只标记重扫，外层迭代接续，
            // 不递归增长调用栈，也不等无关的活动请求结束后才释放公平性阻塞。
            do {
                drainRequested = false;
                if (timer !== undefined) {
                    clearTimeout(timer);
                    timer = undefined;
                }
                const config = currentConfig();
                resetDrainMemo();
                refreshActiveBuckets(config);
                const current = readNow();
                rejectInactive(current);
                let earliest = Number.POSITIVE_INFINITY;
                // 启动一个任务只会让 bucket 更满，不可能解锁更早被阻塞的任务，因此
                // 单次前向扫描即可启动本轮全部可启动任务。公平性要求同 bucket 中更早
                // 仍在等待的任务先行：扫描时累积这些 bucket key，每项判定只看自身 1~2 个 key，
                // 避免对每个等待项回扫全部更早项造成 O(待处理数²)。
                const waitingKeys = new Set<string>();
                // HTTP 重试复用已占用的并发槽，只能被更早等待的重试阻塞，不能被外层任务反向阻塞。
                const waitingAttemptKeys = new Set<string>();
                const keepWaiting = (entry: PendingRequest<unknown>, keys: readonly string[]) => {
                    for (const key of keys) {
                        waitingKeys.add(key);
                        if (entry.attemptOnly) waitingAttemptKeys.add(key);
                    }
                };
                for (let index = head; index < pending.length; index += 1) {
                    const entry = pending[index];
                    if (!entry || entry.settled) continue;
                    const keys = keysFor(entry.identity, config);
                    const blocking = entry.attemptOnly ? waitingAttemptKeys : waitingKeys;
                    if (keys.some((key) => blocking.has(key))) {
                        keepWaiting(entry, keys);
                        continue;
                    }
                    let wait = 0;
                    for (const key of keys) {
                        wait = Math.max(wait, waitFor(key, current, config, !entry.attemptOnly, entry.countRate));
                    }
                    if (wait > 0) {
                        if (wait < earliest) earliest = wait;
                        keepWaiting(entry, keys);
                        continue;
                    }
                    pending[index] = undefined;
                    if (!entry.attemptOnly) activeRequests.add(entry);
                    for (const key of keys) {
                        const state = stateFor(key);
                        if (!entry.attemptOnly) state.active += 1;
                        if (entry.countRate) state.starts.push(current);
                    }
                    void execute(entry);
                }
                compact();
                let nextDeadline = Number.POSITIVE_INFINITY;
                for (let index = head; index < pending.length; index += 1) {
                    const deadlineAt = pending[index]?.deadlineAt;
                    if (deadlineAt !== undefined && deadlineAt < nextDeadline) nextDeadline = deadlineAt;
                }
                const deadlineWait = nextDeadline === Number.POSITIVE_INFINITY
                    ? Number.POSITIVE_INFINITY
                    : Math.max(0, nextDeadline - current);
                const nextWait = Math.min(earliest, deadlineWait);
                if (nextWait < Number.POSITIVE_INFINITY) arm(nextWait);
            } while (drainRequested);
        } finally {
            draining = false;
        }
    }

    function enqueue<T>(entry: PendingRequest<T>): Promise<T> {
        if (entry.signal?.aborted) return Promise.reject(createAbortError());
        return new Promise<T>((resolve, reject) => {
            (entry as {resolve: typeof resolve; reject: typeof reject}).resolve = resolve;
            (entry as {resolve: typeof resolve; reject: typeof reject}).reject = reject;
            if (entry.signal) {
                const onAbort = () => {
                    entry.settled = true;
                    entry.reject(createAbortError());
                    drain();
                };
                entry.signal.addEventListener('abort', onAbort, {once: true});
                entry.removeAbortListener = () => entry.signal?.removeEventListener('abort', onAbort);
            }
            pending.push(entry as PendingRequest<unknown>);
            drain();
        });
    }

    return {
        schedule: <T>(task: (lease: TranslationRequestLease) => Promise<T>, options: TranslationRequestSchedulerTaskOptions = {}) => enqueue({
            task,
            signal: options.signal,
            deadlineAt: options.deadlineAt,
            identity: options.identity,
            attemptOnly: false,
            countRate: options.countRate !== false,
            resolve: undefined as never,
            reject: undefined as never,
            settled: false,
        }),
        scheduleAttempt: <T>(task: () => Promise<T>, options: TranslationRequestAttemptOptions = {}) => enqueue({
            task: async () => task(),
            signal: options.signal,
            deadlineAt: options.deadlineAt,
            identity: options.identity,
            attemptOnly: true,
            countRate: true,
            resolve: undefined as never,
            reject: undefined as never,
            settled: false,
        }),
    };
}

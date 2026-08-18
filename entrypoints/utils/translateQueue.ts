/**
 * 翻译队列管理模块
 * 控制并发翻译任务的数量，避免同时进行过多翻译请求
 */

import { config } from './config';

const DEFAULT_MAX_CONCURRENT_TRANSLATIONS = 6;
const COMPACTION_HEAD_THRESHOLD = 1024;

export interface TranslationQueueSession {
  readonly generation: number;
}

/**
 * A task may stop waiting before the transport it started has actually
 * settled (for example when the translated DOM is restored). Holding the
 * queue lease keeps that real transport inside the configured concurrency
 * limit without delaying the caller-facing cancellation result.
 */
export interface TranslationQueueLease {
  holdUntil(settlement: PromiseLike<unknown>): void;
}

interface TranslationQueueSessionState {
  cancelled: boolean;
  cancellationError?: TranslationQueueCancelledError;
}

interface PendingTranslation {
  session: TranslationQueueSession;
  status: 'pending' | 'running' | 'cancelled';
  execute: () => Promise<void>;
  cancel: (error: TranslationQueueCancelledError) => void;
}

export class TranslationQueueCancelledError extends Error {
  readonly code = 'TRANSLATION_QUEUE_CANCELLED';

  constructor(message = '翻译任务已取消') {
    super(message);
    this.name = 'TranslationQueueCancelledError';
  }
}

let activeTranslations = 0;
let pendingTranslations: Array<PendingTranslation | undefined> = [];
let pendingHead = 0;
let queueGeneration = 0;
const sessionStates = new WeakMap<TranslationQueueSession, TranslationQueueSessionState>();

function createSession(): TranslationQueueSession {
  const session = Object.freeze({generation: queueGeneration});
  sessionStates.set(session, {cancelled: false});
  return session;
}

let defaultSession = createSession();

function getMaxConcurrentTranslations(): number {
  return config.maxConcurrentTranslations || DEFAULT_MAX_CONCURRENT_TRANSLATIONS;
}

function normalizeCancellationError(reason?: unknown): TranslationQueueCancelledError {
  if (reason instanceof TranslationQueueCancelledError) return reason;
  if (reason instanceof Error) return new TranslationQueueCancelledError(reason.message);
  return new TranslationQueueCancelledError(typeof reason === 'string' ? reason : undefined);
}

function getSessionCancellationError(session: TranslationQueueSession): TranslationQueueCancelledError | null {
  const state = sessionStates.get(session);
  if (!state) throw new TypeError('无效的翻译队列会话');
  if (state.cancelled) return state.cancellationError ?? new TranslationQueueCancelledError();
  if (session.generation !== queueGeneration) return new TranslationQueueCancelledError('翻译队列会话已过期');
  return null;
}

function compactPendingQueue(force = false): void {
  if (pendingHead === 0) return;
  if (pendingHead >= pendingTranslations.length) {
    pendingTranslations = [];
    pendingHead = 0;
    return;
  }
  if (force || (pendingHead >= COMPACTION_HEAD_THRESHOLD && pendingHead * 2 >= pendingTranslations.length)) {
    pendingTranslations = pendingTranslations.slice(pendingHead);
    pendingHead = 0;
  }
}

function dequeuePendingTranslation(): PendingTranslation | undefined {
  while (pendingHead < pendingTranslations.length) {
    const entry = pendingTranslations[pendingHead];
    pendingTranslations[pendingHead] = undefined;
    pendingHead += 1;
    compactPendingQueue();
    if (entry?.status === 'pending') return entry;
  }
  compactPendingQueue(true);
  return undefined;
}

function processQueue(): void {
  const maxConcurrent = getMaxConcurrentTranslations();
  while (activeTranslations < maxConcurrent) {
    const entry = dequeuePendingTranslation();
    if (!entry) return;

    const cancellationError = getSessionCancellationError(entry.session);
    if (cancellationError) {
      entry.cancel(cancellationError);
      continue;
    }

    entry.status = 'running';
    activeTranslations += 1;
    void entry.execute().finally(() => {
      activeTranslations -= 1;
      processQueue();
    });
  }
}

/**
 * 创建一个可单独取消的队列会话。取消只会阻止尚未开始的任务；已经发送的
 * 请求仍会自然结束，真正中止网络请求需要调用方额外接入 AbortSignal。
 */
export function createTranslationQueueSession(): TranslationQueueSession {
  return createSession();
}

/** 取消指定会话中所有尚未开始的任务。 */
export function cancelTranslationQueueSession(session: TranslationQueueSession, reason?: unknown): void {
  const state = sessionStates.get(session);
  if (!state) throw new TypeError('无效的翻译队列会话');
  if (state.cancelled) return;

  const error = normalizeCancellationError(reason);
  state.cancelled = true;
  state.cancellationError = error;
  for (let index = pendingHead; index < pendingTranslations.length; index += 1) {
    const entry = pendingTranslations[index];
    if (entry?.session !== session || entry.status !== 'pending') continue;
    pendingTranslations[index] = undefined;
    entry.cancel(error);
  }
  compactPendingQueue(true);
}

/**
 * 添加翻译任务到队列。
 * @param translationTask 翻译任务函数，需要返回 Promise
 * @param session 可选的取消会话；默认使用当前全局队列 generation
 */
export function enqueueTranslation<T>(
  translationTask: (lease: TranslationQueueLease) => Promise<T>,
  session: TranslationQueueSession = defaultSession,
): Promise<T> {
  try {
    const cancellationError = getSessionCancellationError(session);
    if (cancellationError) return Promise.reject(cancellationError);
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise<T>((resolve, reject) => {
    const entry: PendingTranslation = {
      session,
      status: 'pending',
      cancel: (error) => {
        if (entry.status !== 'pending') return;
        entry.status = 'cancelled';
        reject(error);
      },
      execute: async () => {
        const heldSettlements: Promise<void>[] = [];
        let acceptsHolds = true;
        const lease: TranslationQueueLease = {
          holdUntil: (settlement) => {
            if (!acceptsHolds) {
              throw new Error('翻译队列任务已结束，无法继续占用并发槽');
            }
            heldSettlements.push(Promise.resolve(settlement).then(
              () => undefined,
              () => undefined,
            ));
          },
        };
        try {
          resolve(await translationTask(lease));
        } catch (error) {
          reject(error);
        } finally {
          acceptsHolds = false;
          // The caller may already have received an AbortError, but the queue
          // slot remains occupied until every transport started by this task
          // has either settled or reached its transport timeout.
          await Promise.all(heldSettlements);
        }
      },
    };

    pendingTranslations.push(entry);
    processQueue();
  });
}

/**
 * 清空所有等待中的任务并推进全局 generation。活跃任务保持原有语义，仍会
 * 自然完成；之后入队的任务使用新的 generation，不会被旧会话误取消。
 */
export function clearTranslationQueue(): void {
  const error = new TranslationQueueCancelledError('翻译队列已清空');
  const defaultState = sessionStates.get(defaultSession);
  if (defaultState) {
    defaultState.cancelled = true;
    defaultState.cancellationError = error;
  }

  queueGeneration += 1;
  for (let index = pendingHead; index < pendingTranslations.length; index += 1) {
    const entry = pendingTranslations[index];
    if (!entry || entry.status !== 'pending') continue;
    pendingTranslations[index] = undefined;
    entry.cancel(error);
  }
  pendingTranslations = [];
  pendingHead = 0;
  defaultSession = createSession();
}

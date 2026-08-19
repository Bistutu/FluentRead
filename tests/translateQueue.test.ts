import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mockConfig = vi.hoisted(() => ({maxConcurrentTranslations: 2}));

vi.mock('@/entrypoints/utils/config', () => ({config: mockConfig}));

import {
  TranslationQueueCancelledError,
  cancelTranslationQueueSession,
  clearTranslationQueue,
  createTranslationQueueSession,
  enqueueTranslation,
} from '@/entrypoints/utils/translateQueue';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

beforeEach(() => {
  mockConfig.maxConcurrentTranslations = 2;
});

afterEach(() => {
  clearTranslationQueue();
});

describe('translation queue', () => {
  it('保持并发上限，并按 FIFO 顺序启动下一个任务', async () => {
    const controls = Array.from({length: 5}, () => deferred<number>());
    const started: number[] = [];
    const jobs = controls.map((control, index) => enqueueTranslation(async () => {
      started.push(index);
      return control.promise;
    }));

    expect(started).toEqual([0, 1]);

    controls[0].resolve(0);
    await expect(jobs[0]).resolves.toBe(0);
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));

    controls[1].resolve(1);
    await expect(jobs[1]).resolves.toBe(1);
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));

    controls[2].resolve(2);
    controls[3].resolve(3);
    await Promise.all([jobs[2], jobs[3]]);
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3, 4]));
    controls[4].resolve(4);
    await expect(jobs[4]).resolves.toBe(4);
  });

  it('向调用方传播任务错误，并继续处理队列中的下一个任务', async () => {
    mockConfig.maxConcurrentTranslations = 1;
    const expected = new Error('translation failed');
    const started: string[] = [];

    const failed = enqueueTranslation(async () => {
      started.push('failed');
      throw expected;
    });
    const next = enqueueTranslation(async () => {
      started.push('next');
      return 'ok';
    });

    await expect(failed).rejects.toBe(expected);
    await expect(next).resolves.toBe('ok');
    expect(started).toEqual(['failed', 'next']);
  });

  it('调用方提前结束后仍持有并发槽，直到真实 transport settle', async () => {
    mockConfig.maxConcurrentTranslations = 1;
    const transport = deferred<void>();
    const started: string[] = [];

    const cancelledCaller = enqueueTranslation(async (lease) => {
      started.push('first');
      lease.holdUntil(transport.promise);
      return 'caller-stopped';
    });
    const next = enqueueTranslation(async () => {
      started.push('next');
      return 'next-result';
    });

    await expect(cancelledCaller).resolves.toBe('caller-stopped');
    expect(started).toEqual(['first']);

    transport.resolve();
    await expect(next).resolves.toBe('next-result');
    expect(started).toEqual(['first', 'next']);
  });

  it('transport rejection 会被 lease 消费并安全释放并发槽', async () => {
    mockConfig.maxConcurrentTranslations = 1;
    const transport = deferred<void>();
    const started: string[] = [];

    const stoppedCaller = enqueueTranslation(async (lease) => {
      started.push('first');
      lease.holdUntil(transport.promise);
      return 'caller-stopped';
    });
    const next = enqueueTranslation(async () => {
      started.push('next');
      return 'next-result';
    });

    await expect(stoppedCaller).resolves.toBe('caller-stopped');
    expect(started).toEqual(['first']);

    transport.reject(new Error('transport failed after caller stopped'));
    await expect(next).resolves.toBe('next-result');
    expect(started).toEqual(['first', 'next']);
  });

  it('跨过内部压缩阈值后仍保持摊销 O(1) 的 FIFO 语义', async () => {
    mockConfig.maxConcurrentTranslations = 1;
    const started: number[] = [];
    const count = 2500;

    const results = await Promise.all(Array.from({length: count}, (_, index) =>
      enqueueTranslation(async () => {
        started.push(index);
        return index;
      })));

    expect(results).toEqual(Array.from({length: count}, (_, index) => index));
    expect(started).toEqual(results);
  }, 10_000);

  it('清空队列会拒绝等待任务、保留活跃任务，并允许新 generation 继续执行', async () => {
    mockConfig.maxConcurrentTranslations = 1;
    const activeControl = deferred<string>();
    const active = enqueueTranslation(() => activeControl.promise);
    const queued = enqueueTranslation(async () => 'queued');
    const queuedOutcome = queued.catch((error) => error);

    clearTranslationQueue();

    await expect(queuedOutcome).resolves.toBeInstanceOf(TranslationQueueCancelledError);
    const nextGeneration = enqueueTranslation(async () => 'next-generation');
    activeControl.resolve('active');
    await expect(active).resolves.toBe('active');
    await expect(nextGeneration).resolves.toBe('next-generation');
  });

  it('可单独取消会话中的等待任务，并拒绝该会话后续入队', async () => {
    mockConfig.maxConcurrentTranslations = 1;
    const activeControl = deferred<string>();
    const active = enqueueTranslation(() => activeControl.promise);
    const session = createTranslationQueueSession();
    const queued = enqueueTranslation(async () => 'session-task', session);
    const queuedOutcome = queued.catch((error) => error);

    cancelTranslationQueueSession(session, 'session stopped');

    const cancellation = await queuedOutcome;
    expect(cancellation).toBeInstanceOf(TranslationQueueCancelledError);
    expect(cancellation.message).toBe('session stopped');
    await expect(enqueueTranslation(async () => 'late', session)).rejects.toMatchObject({
      code: 'TRANSLATION_QUEUE_CANCELLED',
      message: 'session stopped',
    });

    activeControl.resolve('active');
    await expect(active).resolves.toBe('active');
  });

  it('全局清空会使之前创建的会话 generation 过期', async () => {
    const staleSession = createTranslationQueueSession();
    clearTranslationQueue();

    await expect(enqueueTranslation(async () => 'late', staleSession)).rejects.toMatchObject({
      code: 'TRANSLATION_QUEUE_CANCELLED',
      message: '翻译队列会话已过期',
    });
  });
});

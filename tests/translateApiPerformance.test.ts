import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getPageTranslationContext: vi.fn(),
  saveConfig: vi.fn(async () => undefined),
  config: {
    count: 0,
    maxConcurrentTranslations: 6,
    model: {mock: 'mock-model', 'mock-ai': 'mock-ai-model'} as Record<string, string>,
    customModel: {mock: '', 'mock-ai': ''} as Record<string, string>,
    service: 'mock',
    to: 'zh-CN',
    useCache: true,
    enableAIContext: false,
    videoService: 'mock',
  },
}));

vi.mock('webextension-polyfill', () => ({
  default: {runtime: {sendMessage: mocks.sendMessage}},
}));
vi.mock('@/entrypoints/utils/config', () => ({
  config: mocks.config,
  saveConfig: mocks.saveConfig,
}));
vi.mock('@/entrypoints/utils/common', () => ({detectlang: () => 'eng'}));
vi.mock('@/entrypoints/utils/option', () => ({
  resolveConfiguredModel: (model: string) => model,
  servicesType: {isUseAIContext: (service: string) => service === 'mock-ai'},
}));
vi.mock('@/entrypoints/utils/pageContext', () => ({getPageTranslationContext: mocks.getPageTranslationContext}));
vi.mock('@/entrypoints/utils/configValidation', () => ({getMissingCredentialMessage: () => null}));

import {cancelAllTranslations, translateText, translateVideoText} from '@/entrypoints/utils/translateApi';
import {clearTranslationQueue} from '@/entrypoints/utils/translateQueue';

const originalDocument = globalThis.document;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

describe('translation API request lifecycle performance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.sendMessage.mockReset();
    mocks.getPageTranslationContext.mockReset();
    mocks.saveConfig.mockClear();
    mocks.config.count = 0;
    mocks.config.maxConcurrentTranslations = 6;
    mocks.config.enableAIContext = false;
    mocks.config.service = 'mock';
    mocks.config.videoService = 'mock';
    Object.defineProperty(globalThis, 'document', {
      value: {title: 'Fixture video title'},
      configurable: true,
    });
  });

  afterEach(async () => {
    clearTranslationQueue();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'document', {value: originalDocument, configurable: true});
  });

  it('clears successful request timeouts and coalesces count persistence', async () => {
    mocks.sendMessage.mockResolvedValue('译文');

    const requests = Array.from({length: 24}, (_, index) =>
      translateText(`Readable source ${index}`, 'Context'));
    await expect(Promise.all(requests)).resolves.toHaveLength(24);

    // Every 45-second request timer has been cleared; only the shared 500ms
    // count persistence timer remains.
    expect(vi.getTimerCount()).toBe(1);
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
    expect(mocks.config.count).toBe(24);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a retry delay without sending another runtime request', async () => {
    mocks.sendMessage.mockRejectedValue(new Error('temporary failure'));
    const controller = new AbortController();
    const request = translateText('Readable source', 'Context', {
      maxRetries: 3,
      retryDelay: 10_000,
      signal: controller.signal,
    });
    const outcome = request.catch((error) => error);

    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(outcome).resolves.toMatchObject({name: 'AbortError'});
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    // The retry timer is removed synchronously; only count persistence remains.
    expect(vi.getTimerCount()).toBe(1);
    cancelAllTranslations();
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts the DOM caller immediately but does not release the real transport concurrency slot', async () => {
    mocks.config.maxConcurrentTranslations = 1;
    const firstTransport = deferred<string>();
    mocks.sendMessage
      .mockImplementationOnce(() => firstTransport.promise)
      .mockResolvedValueOnce('第二段译文');
    const controller = new AbortController();
    const first = translateText('First readable source', 'Context', {
      signal: controller.signal,
      maxRetries: 0,
    });
    const firstOutcome = first.catch((error) => error);

    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(firstOutcome).resolves.toMatchObject({name: 'AbortError'});

    const second = translateText('Second readable source', 'Context', {maxRetries: 0});
    await Promise.resolve();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    firstTransport.resolve('迟到的第一段译文');
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(2));
    await expect(second).resolves.toBe('第二段译文');
  });

  it('releases an aborted caller lease only at transport timeout and removes its abort listener', async () => {
    mocks.config.maxConcurrentTranslations = 1;
    const firstTransport = deferred<string>();
    mocks.sendMessage
      .mockImplementationOnce(() => firstTransport.promise)
      .mockResolvedValueOnce('第二段译文');
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const first = translateText('First timeout source', 'Context', {
      signal: controller.signal,
      maxRetries: 0,
      timeout: 10_000,
    });
    const firstOutcome = first.catch((error) => error);

    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(firstOutcome).resolves.toMatchObject({name: 'AbortError'});
    expect(addListener).toHaveBeenCalledWith('abort', expect.any(Function), {once: true});
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));

    const second = translateText('Second timeout source', 'Context', {maxRetries: 0});
    await vi.advanceTimersByTimeAsync(9_999);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toBe('第二段译文');

    // The late raw transport rejection is still observed by waitForRequest.
    firstTransport.reject(new Error('late transport rejection'));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the video AI service when resolving and sending page context', async () => {
    mocks.config.enableAIContext = true;
    mocks.config.videoService = 'mock-ai';
    const pageContext = 'Page title: Fixture video title\nReadable page context for subtitle terminology.';
    mocks.getPageTranslationContext.mockResolvedValue(pageContext);
    mocks.sendMessage.mockResolvedValue('字幕译文');

    await expect(translateVideoText('A subtitle source')).resolves.toBe('字幕译文');

    expect(mocks.getPageTranslationContext).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      context: 'YouTube 视频字幕：Fixture video title',
      pageContext,
      origin: 'A subtitle source',
      useCache: true,
      serviceOverride: 'mock-ai',
    });
  });
});

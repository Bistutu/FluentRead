import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createOffscreenMessageListener} from '@/src/app/offscreen/messageRouter';
import {createLocalTranslationOffscreenAdapter} from '@/src/platform/offscreen/localTranslation';
import {
  LOCAL_TRANSLATION_MODEL_IDS,
  LOCAL_TRANSLATION_MODEL_STATE_KEY,
  LOCAL_TRANSLATION_DOWNLOAD_STATE_KEY,
} from '@/src/core/config/localTranslation';
import {createLocalTranslationBackgroundHandlers} from '@/src/features/local-translation/background/handlers';
import {OFFSCREEN_CANCEL_LOCAL_TRANSLATION_MESSAGE_TYPE} from '@/src/platform/offscreen/client';

const send = vi.fn();
const client = {
  send,
  sendIfPresent: vi.fn(),
  ensureDocument: vi.fn(),
  hasDocument: vi.fn(),
} as any;

const baseOffscreenDependencies = {
  ttsPlayer: {play: vi.fn(async () => undefined), stop: vi.fn(() => true), seek: vi.fn(() => true)},
  fetchImage: vi.fn(async () => 'data:image/png;base64,image'),
  translateImage: vi.fn(async () => ({image: 'image', lines: []})),
  translateArea: vi.fn(async () => ({image: 'image', lines: []})),
  downloadOcrLanguages: vi.fn(async () => undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('local translation Offscreen adapter', () => {
  it('forwards detection context without changing the source text', async () => {
    send.mockResolvedValue({success: true, result: '译文'});
    await createLocalTranslationOffscreenAdapter(client).translate({text: 'Reduce Waste during Filament Change',
      sourceLanguage: 'auto', targetLanguage: 'zh', sourceLanguageDetectionText: 'English paragraph context'});
    expect(send.mock.calls[0][0]).toMatchObject({text: 'Reduce Waste during Filament Change', sourceLanguageDetectionText: 'English paragraph context'});
  });
  it('forwards model, language pair, cancellation and timeout metadata', async () => {
    send.mockResolvedValueOnce({success: true, result: '译文'});
    const adapter = createLocalTranslationOffscreenAdapter(client);
    const controller = new AbortController();
    await expect(adapter.translate({
      model: LOCAL_TRANSLATION_MODEL_IDS.m2m100,
      text: 'Hello',
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
    }, {signal: controller.signal, timeoutMs: 20_000})).resolves.toBe('译文');
    expect(send).toHaveBeenCalledWith({
      type: 'LOCAL_TRANSLATION_TRANSLATE',
      requestId: expect.any(String),
      model: LOCAL_TRANSLATION_MODEL_IDS.m2m100,
      text: 'Hello',
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
    }, {
      signal: controller.signal,
      timeoutMs: 20_000,
      cancelMessage: {
        type: OFFSCREEN_CANCEL_LOCAL_TRANSLATION_MESSAGE_TYPE,
        requestId: expect.any(String),
      },
    });
    const sent = send.mock.calls[0]?.[0];
    const options = send.mock.calls[0]?.[1];
    expect(options.cancelMessage.requestId).toBe(sent.requestId);
  });

  it('validates prepare, status and remove responses', async () => {
    send
      .mockResolvedValueOnce({success: true, model: LOCAL_TRANSLATION_MODEL_IDS.m2m100})
      .mockResolvedValueOnce({success: true, models: []})
      .mockResolvedValueOnce({success: true});
    const adapter = createLocalTranslationOffscreenAdapter(client);
    await expect(adapter.prepare(LOCAL_TRANSLATION_MODEL_IDS.m2m100)).resolves.toMatchObject({success: true});
    await expect(adapter.status()).resolves.toMatchObject({success: true});
    await expect(adapter.remove(LOCAL_TRANSLATION_MODEL_IDS.m2m100)).resolves.toBeUndefined();
    expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({type: 'LOCAL_TRANSLATION_PREPARE'}), {timeoutMs: 30_000});
    expect(send).toHaveBeenNthCalledWith(2, {type: 'LOCAL_TRANSLATION_STATUS'}, {timeoutMs: 30_000});
    expect(send).toHaveBeenNthCalledWith(3, expect.objectContaining({type: 'LOCAL_TRANSLATION_REMOVE_MODEL'}), {timeoutMs: 30_000});
  });
});

describe('local translation paragraph language detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@/src/features/local-translation/offscreen/downloads');
    vi.resetModules();
  });

  it('ignores an old Worker error after cancellation and preserves the replacement request', async () => {
    vi.resetModules();
    vi.doMock('@/src/features/local-translation/offscreen/downloads', () => ({
      createLocalTranslationDownloadManager: () => ({status: async () => ({tasks: [{model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, phase: 'ready'}]})}),
    }));
    const workers: FakeWorker[] = [];
    class FakeWorker {
      onmessage?: (event: any) => void;
      onerror?: (event: any) => void;
      message: any;
      terminate = vi.fn();
      constructor() { workers.push(this); }
      postMessage(message: any) { this.message = message; }
      complete(result: string) { this.onmessage?.({data: {requestId: this.message.requestId, success: true, result}}); }
    }
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('window', {setTimeout, clearTimeout, location: {href: 'https://extension.test/offscreen.html'}});
    const {translateLocalText, disposeLocalTranslationWorker} = await import('@/src/features/local-translation/offscreen/translation');
    const request = {model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, text: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh'};
    const controller = new AbortController();
    try {
      const first = translateLocalText(request, controller.signal);
      const cancelled = expect(first).rejects.toMatchObject({name: 'AbortError'});
      await vi.waitFor(() => expect(workers).toHaveLength(1));
      controller.abort();
      await cancelled;
      const second = translateLocalText(request);
      const completed = expect(second).resolves.toBe('新译文');
      await vi.waitFor(() => expect(workers).toHaveLength(2));
      workers[0].onerror?.({message: 'late failure from cancelled worker'});
      workers[1].complete('新译文');
      await completed;
      expect(workers[1].terminate).not.toHaveBeenCalled();
      const third = translateLocalText(request);
      const rejected = expect(third).rejects.toThrow('current worker failed');
      await vi.waitFor(() => expect(workers[1].message.requestId).toBe(3));
      workers[1].onerror?.({message: 'current worker failed'});
      await rejected;
      expect(workers[1].terminate).toHaveBeenCalledOnce();
    } finally { disposeLocalTranslationWorker(); }
  });

  it('rebuilds a failed pthread runtime once with singleThread and returns the fresh result', async () => {
    vi.resetModules();
    vi.doMock('@/src/features/local-translation/offscreen/downloads', () => ({
      createLocalTranslationDownloadManager: () => ({status: async () => ({tasks: [{model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, phase: 'ready'}]})}),
    }));
    const workers: FakeWorker[] = [];
    class FakeWorker {
      onmessage?: (event: any) => void;
      terminate = vi.fn();
      messages: any[] = [];
      constructor() {workers.push(this);}
      postMessage(message: any) {
        this.messages.push(message);
        queueMicrotask(() => this.onmessage?.({data: {
          requestId: message.requestId, success: message.singleThread === true,
          ...(message.singleThread ? {result: 'Fresh result'} : {retrySingleThread: true, error: 'pthread unavailable'}),
        }}));
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('window', {setTimeout, clearTimeout, location: {href: 'https://extension.test/offscreen.html'}});
    const owner = await import('@/src/features/local-translation/offscreen/translation');
    try {
      await expect(owner.translateLocalText({model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn,text:'Hello world',sourceLanguage:'en',targetLanguage:'zh'})).resolves.toBe('Fresh result');
      expect(workers).toHaveLength(2);
      expect(workers[0].terminate).toHaveBeenCalledOnce();
      expect(workers[1].messages).toHaveLength(1);
      expect(workers[1].messages[0].singleThread).toBe(true);
    } finally {owner.disposeLocalTranslationWorker();}
  });

  it('uses real detection with paragraph context, preserves explicit choices and handles blank context', async () => {
    vi.resetModules();
    vi.doMock('@/src/features/local-translation/offscreen/downloads', () => ({
      createLocalTranslationDownloadManager: () => ({status: async () => ({tasks: [{model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, phase: 'ready'}]})}),
    }));
    const posted: any[] = [];
    class FakeWorker {
      onmessage?: (event: any) => void;
      postMessage(message: any) {
        posted.push(message);
        queueMicrotask(() => this.onmessage?.({data: {requestId: message.requestId, success: true, result: '译文'}}));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('window', {setTimeout, clearTimeout, location: {href: 'https://extension.test/offscreen.html'}});
    const {translateLocalText, disposeLocalTranslationWorker} = await import('@/src/features/local-translation/offscreen/translation');
    const text = 'Reduce Waste during Filament Change';
    const paragraph = 'When switching between different filaments for printing, the printer flushes the remaining material to avoid color mixing. ' + text;
    const request = {model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, text, sourceLanguage: 'auto', targetLanguage: 'zh'};
    try {
      await expect(translateLocalText(request)).rejects.toThrow('LANGUAGE_UNSUPPORTED');
      await expect(translateLocalText({...request, sourceLanguageDetectionText: paragraph})).resolves.toBe('译文');
      expect(posted.at(-1)).toMatchObject({text, sourceLanguage: 'en', targetLanguage: 'zh'});
      expect(posted.at(-1)).not.toHaveProperty('sourceLanguageDetectionText');
      await expect(translateLocalText({...request, sourceLanguage: 'fr', sourceLanguageDetectionText: paragraph})).rejects.toThrow('LANGUAGE_UNSUPPORTED');
      for (const context of [undefined, '', '  ', [], {}]) {
        await expect(translateLocalText({...request, text: paragraph, sourceLanguageDetectionText: context})).resolves.toBe('译文');
      }
    } finally {
      disposeLocalTranslationWorker();
    }
  });
});

describe('local translation idle disposal while waiting for shared capacity', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock('@/src/features/local-translation/offscreen/downloads');
    vi.doUnmock('@/src/shared/onnx/resources');
    vi.resetModules();
  });

  async function warmOwner(memory?: number, statusHook?: () => Promise<unknown>) {
    vi.useFakeTimers(); vi.resetModules();
    vi.stubGlobal('navigator', memory === undefined ? {} : {deviceMemory: memory});
    vi.doMock('@/src/features/local-translation/offscreen/downloads', () => ({
      createLocalTranslationDownloadManager: () => ({status: statusHook || (async () => ({tasks: [{model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, phase: 'ready'}]}))}),
    }));
    const workers: WarmWorker[] = [];
    class WarmWorker {
      onmessage?: (event: any) => void;
      terminate = vi.fn();
      constructor() {workers.push(this);}
      postMessage(message: any) {queueMicrotask(() => this.onmessage?.({data: {requestId: message.requestId, success: true, result: 'warm'}}));}
    }
    vi.stubGlobal('Worker', WarmWorker);
    vi.stubGlobal('window', {setTimeout, clearTimeout, location: {href: 'https://extension.test/offscreen.html'}});
    return {workers, owner: await import('@/src/features/local-translation/offscreen/translation'), request: {
      model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, text: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh',
    }};
  }

  it('rejects a pre-cancelled translation before taking a queue or worker lease, and leaves later translation available', async () => {
    const {owner, workers, request} = await warmOwner(8);
    const controller = new AbortController(); controller.abort();
    try {
      await expect(owner.translateLocalText(request, controller.signal)).rejects.toMatchObject({name: 'AbortError'});
      expect(workers).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      await expect(owner.translateLocalText(request)).resolves.toBe('warm');
      expect(workers).toHaveLength(1);
    } finally {owner.disposeLocalTranslationWorker();}
  });

  it('cancels a request while checking the model cache without destroying its warm worker or poisoning a later request', async () => {
    const ready = {tasks: [{model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, phase: 'ready'}]};
    let checking = false;
    let finishStatus!: (value: typeof ready) => void;
    const status = vi.fn(async () => checking ? new Promise<typeof ready>(resolve => {finishStatus = resolve;}) : ready);
    const {owner, workers, request} = await warmOwner(8, status);
    const controller = new AbortController();
    try {
      await owner.translateLocalText(request);
      checking = true;
      const pending = owner.translateLocalText(request, controller.signal);
      const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'});
      for (let index = 0; index < 10; index++) await Promise.resolve();
      expect(status).toHaveBeenCalledTimes(2);
      controller.abort(); finishStatus(ready); await rejected;
      expect(workers).toHaveLength(1);
      expect(workers[0].terminate).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      checking = false;
      await expect(owner.translateLocalText(request)).resolves.toBe('warm');
      expect(workers).toHaveLength(1);
    } finally {owner.disposeLocalTranslationWorker();}
  });

  it.each(['cancel', 'dispose'] as const)('discards a completed native result when %s arrives before the translation caller accepts it', async mode => {
    const {owner, workers, request} = await warmOwner(8);
    const controller = new AbortController();
    let cancelFirstReply = true;
    (globalThis.Worker as any).prototype.postMessage = function(message: any) {
      queueMicrotask(() => {
        this.onmessage?.({data: {requestId: message.requestId, success: true, result: 'ready'}});
        if (cancelFirstReply) {
          cancelFirstReply = false;
          // Worker 回复先解除原生等待；取消在其续体之后、返回到公开调用方之前到达。
          queueMicrotask(() => mode === 'cancel' ? controller.abort() : owner.disposeLocalTranslationWorker());
        }
      });
    };
    try {
      await expect(owner.translateLocalText(request, controller.signal)).rejects.toMatchObject({name: 'AbortError'});
      expect(workers).toHaveLength(1);
      if (mode === 'cancel') expect(workers[0].terminate).not.toHaveBeenCalled();
      else expect(workers[0].terminate).toHaveBeenCalledOnce();
      await expect(owner.translateLocalText(request)).resolves.toBe('ready');
      expect(workers).toHaveLength(mode === 'cancel' ? 1 : 2);
    } finally {owner.disposeLocalTranslationWorker();}
  });

  it('does not revive an old translation that was waiting for shared inference capacity when the owner is disposed', async () => {
    const resources = await vi.importActual<typeof import('@/src/shared/onnx/resources')>('@/src/shared/onnx/resources');
    const budget = vi.fn(resources.createLocalInferenceBudget(1));
    vi.doMock('@/src/shared/onnx/resources', () => ({...resources, withLocalInferenceBudget: budget}));
    const {owner, workers, request} = await warmOwner(8);
    let releaseBudget!: () => void;
    const busy = new Promise<void>(resolve => {releaseBudget = resolve;});
    let occupying: Promise<unknown> | undefined;
    let rejected: Promise<unknown> | undefined;
    try {
      await owner.translateLocalText(request);
      occupying = budget(() => busy);
      const queued = owner.translateLocalText(request);
      rejected = expect(queued).rejects.toMatchObject({name: 'AbortError'});
      for (let index = 0; index < 10; index++) await Promise.resolve();
      expect(budget).toHaveBeenCalledTimes(3);
      expect(workers).toHaveLength(1);
      owner.disposeLocalTranslationWorker();
      releaseBudget(); await occupying; await rejected;
      expect(workers).toHaveLength(1);
      expect(workers[0].terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      await expect(owner.translateLocalText(request)).resolves.toBe('warm');
      expect(workers).toHaveLength(2);
    } finally {
      releaseBudget(); await occupying;
      owner.disposeLocalTranslationWorker();
      await rejected;
    }
  });

  it.each([[4, 60_000], [8, 180_000], [undefined, 120_000]])('reuses translation across reading pauses with memory %s and releases after %s idle milliseconds', async (memory, idleMs) => {
    const {owner, workers, request} = await warmOwner(memory);
    try {
      for (let index = 0; index < 3; index++) {
        await expect(owner.translateLocalText(request)).resolves.toBe('warm');
        await vi.advanceTimersByTimeAsync(45_000);
      }
      expect(workers).toHaveLength(1);
      expect(workers[0].terminate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(idleMs! - 45_001);
      expect(workers[0].terminate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(workers[0].terminate).toHaveBeenCalledOnce();
      await expect(owner.translateLocalText(request)).resolves.toBe('warm');
      expect(workers).toHaveLength(2);
    } finally {owner.disposeLocalTranslationWorker();}
  });

  it('protects a warm translation while checking the model cache and invalidates the entire old queue on disposal', async () => {
    const ready = {tasks: [{model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, phase: 'ready'}]};
    let finishStatus!: (value: typeof ready) => void;
    let checking = false;
    const status = vi.fn(async () => checking ? new Promise<typeof ready>(resolve => {finishStatus = resolve;}) : ready);
    const {owner, workers, request} = await warmOwner(8, status);
    try {
      await owner.translateLocalText(request);
      await vi.advanceTimersByTimeAsync(179_000);
      checking = true;
      const current = owner.translateLocalText(request);
      const currentRejected = expect(current).rejects.toMatchObject({name: 'AbortError'});
      const queued = owner.translateLocalText(request);
      const queueRejected = expect(queued).rejects.toMatchObject({name: 'AbortError'});
      await vi.advanceTimersByTimeAsync(185_000);
      expect(workers[0].terminate).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledTimes(2);
      owner.disposeLocalTranslationWorker();
      finishStatus(ready);
      await currentRejected; await queueRejected;
      expect(workers).toHaveLength(1);
      expect(workers[0].terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      checking = false;
      await expect(owner.translateLocalText(request)).resolves.toBe('warm');
      expect(workers).toHaveLength(2);
    } finally {owner.disposeLocalTranslationWorker();}
  });

  it.each(['retry', 'success'])('does not revive or accept the old translation after disposal races with a %s response', async kind => {
    const {owner, workers, request} = await warmOwner(8);
    let disposeOnReply = true;
    const originalPost = (globalThis.Worker as any).prototype.postMessage;
    (globalThis.Worker as any).prototype.postMessage = function(message: any) {
      if (!disposeOnReply) {originalPost.call(this, message); return;}
      queueMicrotask(() => {
        this.onmessage?.({data: {requestId: message.requestId, ...(kind === 'retry'
          ? {success: false, retrySingleThread: true} : {success: true, result: 'old'})}});
        disposeOnReply = false;
        owner.disposeLocalTranslationWorker();
      });
    };
    try {
      await expect(owner.translateLocalText(request)).rejects.toMatchObject({name: 'AbortError'});
      expect(workers).toHaveLength(1);
      expect(workers[0].terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      await expect(owner.translateLocalText(request)).resolves.toBe('warm');
      expect(workers).toHaveLength(2);
    } finally {owner.disposeLocalTranslationWorker();}
  });

  it.each(['reuse', 'switch-model'] as const)('keeps the warm worker alive past its old idle deadline while a %s request waits for capacity', async mode => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', {deviceMemory: 8});
    vi.resetModules();
    const readyModels = [LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, LOCAL_TRANSLATION_MODEL_IDS.m2m100];
    vi.doMock('@/src/features/local-translation/offscreen/downloads', () => ({
      createLocalTranslationDownloadManager: () => ({
        status: async () => ({tasks: readyModels.map(model => ({model, phase: 'ready'}))}),
      }),
    }));
    const resources = await vi.importActual<typeof import('@/src/shared/onnx/resources')>('@/src/shared/onnx/resources');
    const budget = vi.fn(resources.createLocalInferenceBudget(1));
    vi.doMock('@/src/shared/onnx/resources', () => ({...resources, withLocalInferenceBudget: budget}));

    const workers: IdleWorker[] = [];
    class IdleWorker {
      onmessage?: (event: any) => void;
      onerror?: (event: any) => void;
      messages: any[] = [];
      terminate = vi.fn();
      constructor() {workers.push(this);}
      postMessage(message: any) {this.messages.push(message);}
      complete(result: string) {
        this.onmessage?.({data: {requestId: this.messages.at(-1).requestId, success: true, result}});
      }
    }
    const flush = async () => {for (let index = 0; index < 10; index++) await Promise.resolve();};
    vi.stubGlobal('Worker', IdleWorker);
    vi.stubGlobal('window', {setTimeout, clearTimeout, location: {href: 'https://extension.test/offscreen.html'}});
    const owner = await import('@/src/features/local-translation/offscreen/translation');
    const request = {model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, text: 'Warm request', sourceLanguage: 'en', targetLanguage: 'zh'};
    const controller = new AbortController();
    let releaseBudget!: () => void;
    const busy = new Promise<void>(resolve => {releaseBudget = resolve;});
    let occupying: Promise<unknown> | undefined;
    let outcome: Promise<{result: string} | {error: unknown}> | undefined;
    try {
      const warm = owner.translateLocalText(request);
      await flush();
      expect(workers).toHaveLength(1);
      const original = workers[0];
      original.complete('Warm result');
      await expect(warm).resolves.toBe('Warm result');
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(179_000);

      // 另一类本地推理占满预算；新翻译尚未 postMessage，也没有 Worker 超时。
      occupying = budget(() => busy);
      const model = mode === 'reuse' ? LOCAL_TRANSLATION_MODEL_IDS.opusZhEn : LOCAL_TRANSLATION_MODEL_IDS.m2m100;
      const queued = owner.translateLocalText({...request, model, text: 'Queued request'}, controller.signal);
      let settled = false;
      outcome = queued.then(
        result => {settled = true;return {result};},
        error => {settled = true;return {error};},
      );
      await flush();
      expect(budget).toHaveBeenCalledTimes(3);
      expect(budget).toHaveBeenLastCalledWith(expect.any(Function), controller.signal);
      expect(original.messages).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(185_000);
      expect(settled).toBe(false);
      expect(workers).toHaveLength(1);
      expect(original.terminate).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);

      releaseBudget();await occupying;await flush();
      expect(workers).toHaveLength(mode === 'reuse' ? 1 : 2);
      const current = workers.at(-1)!;
      expect(current.messages.at(-1)).toMatchObject({type: 'translate', model, text: 'Queued request'});
      expect(current.terminate).not.toHaveBeenCalled();
      if (mode === 'reuse') {
        expect(current).toBe(original);expect(current.messages).toHaveLength(2);
      } else {
        expect(original.terminate).toHaveBeenCalledOnce();expect(original.messages).toHaveLength(1);
      }
      current.complete('Queued result');
      expect(await outcome).toEqual({result: 'Queued result'});

      // 只有新请求真正完成后才重新开始空闲计时，保留随后三分钟的热会话。
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(179_999);
      expect(current.terminate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(current.terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      controller.abort();releaseBudget();await occupying;
      owner.disposeLocalTranslationWorker();
      await outcome;
    }
  });
});

describe('local translation background handlers', () => {
  it('acknowledges background jobs without marking them downloaded and only persists trusted completed progress', async () => {
    let stored: Record<string, unknown> = {[LOCAL_TRANSLATION_MODEL_STATE_KEY]: []};
    const offscreen = {
      prepare: vi.fn(async () => ({success: true, model: LOCAL_TRANSLATION_MODEL_IDS.m2m100})),
      status: vi.fn(async () => ({models: [{model: LOCAL_TRANSLATION_MODEL_IDS.m2m100, downloaded: true}]})),
      remove: vi.fn(async () => undefined),
      pause: vi.fn(async () => ({success: true})),
      translate: vi.fn(async () => 'result'),
    };
    const handlers = createLocalTranslationBackgroundHandlers({
      offscreen,
      isTrustedProgress: (context) => context === 'offscreen',
      storage: {
        get: async () => stored,
        set: async (value) => { stored = {...stored, ...value}; },
      },
    });
    const prepare = handlers.find((item) => item.type === 'fluentReadPrepareLocalTranslationModel')!;
    const state = handlers.find((item) => item.type === 'fluentReadGetLocalTranslationModelState')!;
    const remove = handlers.find((item) => item.type === 'fluentReadRemoveLocalTranslationModel')!;

    await expect(prepare.handle({type: 'fluentReadPrepareLocalTranslationModel', model: LOCAL_TRANSLATION_MODEL_IDS.m2m100} as any, {})).resolves.toMatchObject({
      success: true,
      model: LOCAL_TRANSLATION_MODEL_IDS.m2m100,
    });
    expect(stored[LOCAL_TRANSLATION_MODEL_STATE_KEY]).toEqual([]);
    await expect(state.handle({type: 'fluentReadGetLocalTranslationModelState'}, {})).resolves.toEqual({success: true, models: [{model: LOCAL_TRANSLATION_MODEL_IDS.m2m100, downloaded: true}]});
    const progress = handlers.find((item) => item.type === 'fluentReadLocalTranslationDownloadProgress')!;
    const snapshot = {version: 2, tasks: [{model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, phase: 'ready', downloadedBytes: 20, totalBytes: 20, bytesPerSecond: 0, updatedAt: 2}]};
    await expect(progress.handle({type: progress.type, snapshot} as any, {})).resolves.toEqual({success: false});
    expect(stored[LOCAL_TRANSLATION_MODEL_STATE_KEY]).toEqual([]);
    await expect(progress.handle({type: progress.type, snapshot} as any, 'offscreen')).resolves.toEqual({success: true});
    expect(stored[LOCAL_TRANSLATION_MODEL_STATE_KEY]).toEqual([LOCAL_TRANSLATION_MODEL_IDS.opusZhEn]);
    await progress.handle({type: progress.type, snapshot: {...snapshot, tasks: [{...snapshot.tasks[0], phase: 'downloading', updatedAt: 1}]}} as any, 'offscreen');
    expect(stored[LOCAL_TRANSLATION_DOWNLOAD_STATE_KEY]).toEqual(snapshot);
    await expect(remove.handle({type: 'fluentReadRemoveLocalTranslationModel', model: LOCAL_TRANSLATION_MODEL_IDS.m2m100} as any, {})).resolves.toMatchObject({success: true});
    expect(offscreen.prepare).toHaveBeenCalledOnce();
    expect(offscreen.remove).toHaveBeenCalledOnce();
  });
});

describe('local translation Offscreen message route', () => {
  const request = {
    target: 'offscreen', type: 'LOCAL_TRANSLATION_TRANSLATE', requestId: 'route-1',
    model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, text: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh',
  };
  const localDependencies = () => ({
    translate: vi.fn(async (): Promise<unknown> => 'translated'),
    prepare: vi.fn(async () => ({phase: 'queued'})),
    pause: vi.fn(async () => ({phase: 'paused'})),
    status: vi.fn(async () => ({models: []})),
    removeModel: vi.fn(async () => undefined),
  });
  const route = (localTranslation?: ReturnType<typeof localDependencies>) => {
    const listener = createOffscreenMessageListener({
      ...baseOffscreenDependencies, translate: vi.fn(async () => 'chrome'), localTranslation,
    });
    return (message: Record<string, unknown>) => new Promise<any>((resolve) => {
      expect(listener({...request, ...message}, {}, resolve)).toBe(true);
    });
  };

  it.each(['PREPARE', 'PAUSE', 'STATUS', 'REMOVE_MODEL', 'TRANSLATE'])('rejects %s when local execution is unavailable', async (operation) => {
    await expect(route()({type: `LOCAL_TRANSLATION_${operation}`})).resolves.toMatchObject({success: false});
  });

  it.each([
    ['PREPARE', 'prepare', {success: true, phase: 'queued'}],
    ['PAUSE', 'pause', {success: true, phase: 'paused'}],
    ['STATUS', 'status', {success: true, models: []}],
    ['REMOVE_MODEL', 'removeModel', {success: true}],
  ] as const)('forwards %s and returns its snapshot', async (operation, method, response) => {
    const local = localDependencies();
    await expect(route(local)({type: `LOCAL_TRANSLATION_${operation}`})).resolves.toEqual(response);
    expect(local[method]).toHaveBeenCalledOnce();
  });

  it.each([
    {model: 'unknown'}, {sourceLanguageDetectionText: 42}, {requestId: 'invalid request'},
  ])('rejects invalid translation fields %j before execution', async (fields) => {
    const local = localDependencies();
    await expect(route(local)(fields)).resolves.toMatchObject({success: false});
    expect(local.translate).not.toHaveBeenCalled();
  });

  it('preserves a valid detection context and rejects duplicate active identifiers', async () => {
    const local = localDependencies();
    let finish!: (value: string) => void;
    local.translate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const dispatch = route(local);
    const result = dispatch({sourceLanguageDetectionText: 'English context'});
    await vi.waitFor(() => expect(local.translate).toHaveBeenCalledOnce());
    await expect(dispatch({})).resolves.toMatchObject({success: false, error: expect.stringContaining('正在执行')});
    finish('translated');
    await expect(result).resolves.toEqual({success: true, result: 'translated', requestId: 'route-1'});
  });

  it.each(['reject', 'invalid-result'] as const)('reports executor failure: %s', async (mode) => {
    const local = localDependencies();
    if (mode === 'reject') local.translate.mockRejectedValue(new Error('executor failed'));
    else local.translate.mockResolvedValue(null);
    await expect(route(local)({})).resolves.toMatchObject({success: false, requestId: 'route-1'});
  });

  it('validates cancellation and safely acknowledges an already settled request', async () => {
    const dispatch = route(localDependencies());
    await expect(dispatch({type: OFFSCREEN_CANCEL_LOCAL_TRANSLATION_MESSAGE_TYPE, requestId: 'invalid request'}))
      .resolves.toMatchObject({success: false});
    await expect(dispatch({type: OFFSCREEN_CANCEL_LOCAL_TRANSLATION_MESSAGE_TYPE}))
      .resolves.toEqual({success: true, cancelled: false, requestId: 'route-1'});
  });

  it('passes a signal to the local executor and supports cancellation', async () => {
    let resolveTranslation!: (value: string) => void;
    const translate = vi.fn((_message: Record<string, unknown>, _signal: AbortSignal) => new Promise<string>((resolve) => { resolveTranslation = resolve; }));
    const listener = createOffscreenMessageListener({
      ...baseOffscreenDependencies,
      translate: vi.fn(async () => 'chrome'),
      localTranslation: {
        translate,
        prepare: vi.fn(async () => ({model: LOCAL_TRANSLATION_MODEL_IDS.m2m100})),
        status: vi.fn(async () => ({models: []})),
        removeModel: vi.fn(async () => undefined),
      },
    });
    let response!: (value: unknown) => void;
    const responsePromise = new Promise<unknown>((resolve) => { response = resolve; });
    expect(listener({
      target: 'offscreen',
      type: 'LOCAL_TRANSLATION_TRANSLATE',
      requestId: 'local-1',
      model: LOCAL_TRANSLATION_MODEL_IDS.m2m100,
      text: 'Hello',
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
    }, {}, response)).toBe(true);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledOnce());
    const signal = translate.mock.calls[0]?.[1] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    let cancelResponse!: (value: unknown) => void;
    const cancelPromise = new Promise<unknown>((resolve) => { cancelResponse = resolve; });
    expect(listener({
      target: 'offscreen',
      type: OFFSCREEN_CANCEL_LOCAL_TRANSLATION_MESSAGE_TYPE,
      requestId: 'local-1',
    }, {}, cancelResponse)).toBe(true);
    await expect(cancelPromise).resolves.toEqual({success: true, cancelled: true, requestId: 'local-1'});
    await expect(responsePromise).resolves.toMatchObject({success: false, cancelled: true, requestId: 'local-1'});
    expect(signal.aborted).toBe(true);
    resolveTranslation('迟到译文');
  });
});

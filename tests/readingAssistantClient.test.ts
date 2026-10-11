import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {createApiKeyRequirementKey} from '@/src/core/config/validation';
import type {ReadingRequest, ReadingResponse} from '@/src/features/reading-assistant/types';
import {clearHarnessSessions, deleteHarnessSession, getHarnessSession, listHarnessSessions, streamReading, clearLearningMemories, deleteLearningMemory, listLearningMemories, saveLearningMemory} from '@/src/features/reading-assistant/client';

const state = vi.hoisted(() => ({
  message: vi.fn(), connect: vi.fn(), sdkStream: vi.fn(), port: null as any,
}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: state.message, connect: state.connect}}}));
// 唯一模型替身在 AI SDK 流生成 seam；modelGateway/provider、handler、端口和 Harness loop 保持真实。
vi.mock('ai', async (importOriginal) => ({...(await importOriginal<typeof import('ai')>()), streamText: state.sdkStream}));

beforeEach(() => {
  state.message.mockReset();
  state.port = {postMessage: vi.fn(), disconnect: vi.fn(), onMessage: {addListener: vi.fn()}, onDisconnect: {addListener: vi.fn()}};
  state.connect.mockReset().mockReturnValue(state.port);
});

describe('reading assistant client', () => {
  it('streams progress/result, ignores late messages, and disconnects after result', () => {
    const progress = vi.fn(); const result = vi.fn();
    const handle = streamReading({type: 'fluentReadHarness', action: 'run', requestId: 'r1', selection: {text: 'x', context: '', sentence: ''}, intent: 'meaning', question: ''}, {progress, result});
    const onMessage = state.port.onMessage.addListener.mock.calls[0][0];
    onMessage({type: 'progress', requestId: 'other', progress: {kind: 'text', text: 'ignored'}});
    onMessage({type: 'progress', requestId: 'r1', progress: {kind: 'text', text: 'partial'}});
    onMessage({type: 'result', requestId: 'r1', response: {success: true, text: 'done', service: 'openai', model: 'm'}});
    onMessage({type: 'progress', requestId: 'r1', progress: {kind: 'text', text: 'late'}});
    expect(progress).toHaveBeenCalledOnce(); expect(result).toHaveBeenCalledOnce(); expect(state.port.disconnect).toHaveBeenCalled();
    const onDisconnect = state.port.onDisconnect.addListener.mock.calls[0][0]; onDisconnect();
    state.port.disconnect.mockImplementation(() => { throw new Error('disconnect race'); });
    const second = streamReading({type: 'fluentReadHarness', action: 'run', requestId: 'r1b', selection: {text: 'x', context: '', sentence: ''}, intent: 'meaning', question: ''}, {result});
    state.port.onMessage.addListener.mock.calls.at(-1)[0]({type: 'result', requestId: 'r1b', response: {success: true, text: 'done', service: 'openai', model: 'm'}});
    second.cancel();
    handle.cancel(); expect(state.message).not.toHaveBeenCalled();
  });
  it('cancels by disconnecting and sends compatibility cancel, while disconnect reports errors', () => {
    const error = vi.fn(); const handle = streamReading({type: 'fluentReadHarness', action: 'run', requestId: 'r2', selection: {text: 'x', context: '', sentence: ''}, intent: 'meaning', question: ''}, {error});
    const onDisconnect = state.port.onDisconnect.addListener.mock.calls[0][0]; onDisconnect(); expect(error).toHaveBeenCalledOnce();
    handle.cancel(); expect(state.message).not.toHaveBeenCalled();
    state.port = {postMessage: vi.fn(() => {throw new Error('send') }), disconnect: vi.fn(), onMessage: {addListener: vi.fn()}, onDisconnect: {addListener: vi.fn()}}; state.connect.mockReturnValue(state.port);
    streamReading({type: 'fluentReadHarness', action: 'run', requestId: 'r3', selection: {text: 'x', context: '', sentence: ''}, intent: 'meaning', question: ''}, {error}); expect(error).toHaveBeenCalledTimes(2);
  });
  it('covers active cancellation, rejected cancel messages and connect failures', async () => {
    state.message.mockRejectedValue(new Error('background unavailable'));
    state.port.disconnect.mockImplementation(() => { throw new Error('already disconnected'); });
    const handle = streamReading({type: 'fluentReadHarness', action: 'run', requestId: 'r4', selection: {text: 'x', context: '', sentence: ''}, intent: 'meaning', question: ''}, {});
    handle.cancel();
    expect(state.message).toHaveBeenCalledWith({type: 'fluentReadHarness', action: 'cancel', requestId: 'r4'});
    state.connect.mockImplementation(() => { throw new Error('connect failed'); });
    expect(() => streamReading({type: 'fluentReadHarness', action: 'run', requestId: 'r5', selection: {text: 'x', context: '', sentence: ''}, intent: 'meaning', question: ''}, {})).toThrow('connect failed');
    await Promise.resolve();
  });
  it('wraps paged session operations and rejects backend failures', async () => {
    state.message.mockResolvedValueOnce({success: true, sessions: [], hasMore: true}).mockResolvedValueOnce({success: true, session: null}).mockResolvedValueOnce({success: true}).mockResolvedValueOnce({success: true});
    await expect(listHarnessSessions(20)).resolves.toEqual({success: true, sessions: [], hasMore: true});
    await expect(getHarnessSession('s')).resolves.toBeNull(); await expect(deleteHarnessSession('s')).resolves.toBeUndefined(); await expect(clearHarnessSessions()).resolves.toBeUndefined();
    expect(state.message).toHaveBeenNthCalledWith(1, {type: 'fluentReadHarness', action: 'sessions-list', offset: 20});
    state.message.mockResolvedValueOnce({success: false, error: 'denied'}); await expect(listHarnessSessions()).rejects.toThrow('denied');
    state.message.mockResolvedValueOnce({success: false}); await expect(listHarnessSessions()).rejects.toThrow('会话操作失败');
  });
  it('wraps learning memory CRUD and snapshots only whitelisted fields from reactive input', async () => {
    const memory = {id: 'a0000000-0000-4000-8000-000000000001', content: '先解释主干', kind: 'preference' as const, createdAt: 1, updatedAt: 1};
    state.message.mockResolvedValueOnce({success: true, memories: [memory]}).mockResolvedValueOnce({success: true, memory}).mockResolvedValueOnce({success: true, memory}).mockResolvedValueOnce({success: true}).mockResolvedValueOnce({success: true});
    expect(await listLearningMemories()).toEqual([memory]);
    expect(await saveLearningMemory({content: memory.content, kind: memory.kind})).toEqual(memory);
    expect(await saveLearningMemory({...memory, token: 'never send'} as any)).toEqual(memory);
    await deleteLearningMemory(memory.id); await clearLearningMemories();
    expect(state.message.mock.calls.map(call => call[0])).toEqual([
      {type: 'fluentReadHarness', action: 'memory-list'},
      {type: 'fluentReadHarness', action: 'memory-save', input: {content: memory.content, kind: memory.kind}},
      {type: 'fluentReadHarness', action: 'memory-save', input: {content: memory.content, kind: memory.kind, id: memory.id}},
      {type: 'fluentReadHarness', action: 'memory-delete', id: memory.id},
      {type: 'fluentReadHarness', action: 'memory-clear'},
    ]);
    state.message.mockResolvedValueOnce({success: false, error: '学习记忆不能超过 2000 个字符'});
    await expect(saveLearningMemory({content: 'x'.repeat(2001), kind: 'note'})).rejects.toThrow('2000');
  });
});


describe('reading client through the actual userscript transport and Harness runtime', () => {
  let adapter: typeof import('@/userscript/browser');
  let createReading: typeof import('@/userscript/readingRuntime')['createUserscriptReadingRuntime'];
  let transport: typeof import('@/src/platform/http/runtime');
  let current: Config;
  let listeners: Set<(config: Config) => void>;
  let stopWatching: ReturnType<typeof vi.fn>;
  let forbiddenFetch: ReturnType<typeof vi.fn>;
  let storageRead: ReturnType<typeof vi.fn>;
  let storageWrite: ReturnType<typeof vi.fn>;
  let databaseOpen: ReturnType<typeof vi.fn>;

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {resolve = done;});
    return {promise, resolve};
  }
  const flush = async () => {for (let i = 0; i < 20; i++) await Promise.resolve();};
  const request = (requestId: string, extra: Partial<ReadingRequest> = {}): ReadingRequest => ({
    type: 'fluentReadHarness', action: 'run', requestId, intent: 'meaning', question: '',
    selection: {text: 'The door was left open.', context: 'Approved paragraph.', sentence: ''}, ...extra,
  });
  const sdkAnswer = (text: string, wait?: Promise<void>) => ({
    fullStream: (async function* () {
      yield {type: 'text-delta', id: 'text', text: 'partial '};
      if (wait) await wait;
      yield {type: 'text-delta', id: 'text', text};
    })(),
    response: Promise.resolve({modelId: 'reader', messages: [{role: 'assistant', content: [{type: 'text', text}]}]}),
    usage: Promise.resolve({}),
  });
  function install(ready: Promise<unknown> = Promise.resolve()) {
    const reading = createReading({ready, getConfig: () => current,
      privateContext: adapter.getUserscriptPrivacyContext,
      subscribeConfig(listener) {
        listeners.add(listener);
        listener(current);
        return () => {listeners.delete(listener); stopWatching();};
      },
    });
    adapter.setPlatformMessageHandler(Object.assign(async (message: any) => {
      if (message?.type === 'fluentReadHarness') return reading.handle(message);
      if (message?.type === 'count-flush-probe') return {success: true};
      return adapter.UNHANDLED_RUNTIME_MESSAGE;
    }, {connect: reading.connect, closeConnections: reading.closeConnections, dispose: reading.dispose}));
    return reading;
  }
  function start(input: ReadingRequest) {
    const done = deferred<ReadingResponse>();
    const progress = vi.fn();
    const result = vi.fn((response: ReadingResponse) => done.resolve(response));
    const error = vi.fn();
    const handle = streamReading(input, {progress, result, error});
    return {handle, progress, result, error, done: done.promise};
  }
  const publish = () => {for (const listener of [...listeners]) listener(current);};

  beforeEach(async () => {
    state.sdkStream.mockReset().mockImplementation(() => sdkAnswer('completed'));
    forbiddenFetch = vi.fn(async () => {throw new Error('Unexpected network in synthetic reading test');});
    storageRead = vi.fn(); storageWrite = vi.fn(); databaseOpen = vi.fn();
    vi.stubGlobal('fetch', forbiddenFetch);
    vi.stubGlobal('location', {href: 'https://reading.example/article'});
    vi.stubGlobal('GM', undefined); vi.stubGlobal('GM_info', undefined);
    vi.stubGlobal('GM_getValue', storageRead); vi.stubGlobal('GM_setValue', storageWrite);
    vi.stubGlobal('GM_deleteValue', storageWrite);
    vi.stubGlobal('localStorage', {getItem: storageRead, setItem: storageWrite, removeItem: storageWrite});
    vi.stubGlobal('indexedDB', {open: databaseOpen, deleteDatabase: databaseOpen});
    adapter = await import('@/userscript/browser');
    ({createUserscriptReadingRuntime: createReading} = await import('@/userscript/readingRuntime'));
    transport = await import('@/src/platform/http/runtime');
    transport.setRuntimeFetch(forbiddenFetch);
    state.connect.mockImplementation(options => adapter.default.runtime.connect(options));
    state.message.mockImplementation(message => adapter.default.runtime.sendMessage(message));
    current = new Config();
    current.on = true;
    current.customOpenAIProviders = [{id: 'custom:local', name: 'Synthetic', endpoint: 'https://reading.invalid/v1/chat/completions', models: ['reader']}];
    current.harness = {...current.harness, enabled: true, service: 'custom:local', model: 'reader', contextMode: 'paragraph'};
    current.model['custom:local'] = 'reader';
    current.requireApiKey[createApiKeyRequirementKey('custom:local', 'reader')] = false;
    listeners = new Set(); stopWatching = vi.fn();
  });
  afterEach(async () => {
    adapter?.resetPlatformMessageHandler();
    await flush();
    expect(listeners.size).toBe(0);
    expect(forbiddenFetch).not.toHaveBeenCalled();
    expect(storageRead).not.toHaveBeenCalled(); expect(storageWrite).not.toHaveBeenCalled();
    expect(databaseOpen).not.toHaveBeenCalled();
    transport?.setRuntimeFetch();
    vi.unstubAllGlobals();
  });

  it.each([false, true, undefined])('streams a real ephemeral answer with %s manager privacy metadata and delivers terminal before disconnect', async privacy => {
    vi.stubGlobal('GM_info', privacy === undefined ? undefined : {isIncognito: privacy});
    current.harness.memoryEnabled = true;
    install();
    const active = start(request('ephemeral'));
    await expect(active.done).resolves.toMatchObject({success: true, text: 'partial completed', service: 'custom:local', model: 'reader'});
    await flush();
    expect(adapter.default.extension.inIncognitoContext).toBe(privacy);
    expect(state.connect.mock.results.at(-1)?.value.sender).toBeUndefined();
    expect(active.progress).toHaveBeenCalledWith(expect.objectContaining({kind: 'session', persistent: false}));
    expect(active.progress).toHaveBeenCalledWith(expect.objectContaining({kind: 'memory', count: 0, warning: expect.any(String)}));
    expect(active.progress).toHaveBeenCalledWith({kind: 'text', text: 'partial completed'});
    expect(active.result).toHaveBeenCalledOnce(); expect(active.error).not.toHaveBeenCalled();
    expect(active.result.mock.calls[0][0]).not.toHaveProperty('sessionId');
    expect(active.result.mock.calls[0][0]).not.toHaveProperty('turnId');
    const sdkInput = state.sdkStream.mock.calls[0][0];
    expect(sdkInput.model).toMatchObject({modelId: 'reader'});
    expect(sdkInput.messages.at(-1).content).toContain('The door was left open.');
    expect(sdkInput.messages.at(-1).content).toContain('Approved paragraph.');
    expect(sdkInput.tools).toHaveProperty('read_context');
  });

  it('clones authorized input, keeps four actual follow-up turns, and treats a fresh action independently', async () => {
    install();
    const input = request('clone');
    const first = start(input);
    input.selection.text = 'mutated after postMessage';
    await first.done;
    expect(state.sdkStream.mock.calls[0][0].messages.at(-1).content).toContain('The door was left open.');
    expect(state.sdkStream.mock.calls[0][0].messages.at(-1).content).not.toContain('mutated after postMessage');
    const history = Array.from({length: 5}, (_, i) => ({question: `question-${i}`, answer: `answer-${i}`}));
    await start(request('follow-up', {question: 'Why?', history})).done;
    const followUp = state.sdkStream.mock.calls[1][0];
    expect(followUp.messages.map((message: {role: string}) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user']);
    expect(JSON.stringify(followUp.messages)).not.toContain('question-0');
    expect(JSON.stringify(followUp.messages)).toContain('answer-4');
    await start(request('fresh', {intent: 'grammar', history})).done;
    expect(state.sdkStream.mock.calls[2][0].messages).toHaveLength(1);
    expect(JSON.stringify(state.sdkStream.mock.calls[2][0].messages)).not.toContain('answer-4');
  });

  it('cancels before config readiness and never starts generation after the cancelled port was queued', async () => {
    const ready = deferred<void>();
    install(ready.promise);
    const active = start(request('ready-cancel'));
    active.handle.cancel();
    await flush();
    expect(state.sdkStream).not.toHaveBeenCalled();
    ready.resolve(undefined); await flush();
    expect(state.sdkStream).not.toHaveBeenCalled();
    expect(active.progress).not.toHaveBeenCalled(); expect(active.result).not.toHaveBeenCalled(); expect(active.error).not.toHaveBeenCalled();
    expect(state.message).toHaveBeenCalledWith({type: 'fluentReadHarness', action: 'cancel', requestId: 'ready-cancel'});
  });

  it('preserves an active answer through a count refresh, then cancels a changed model and discards late generation', async () => {
    const gate = deferred<void>();
    state.sdkStream.mockImplementation(() => sdkAnswer('late old answer', gate.promise));
    install();
    const active = start(request('config-change'));
    await vi.waitFor(() => expect(state.sdkStream).toHaveBeenCalledOnce());
    const signal = state.sdkStream.mock.calls[0][0].abortSignal as AbortSignal;
    current.count++; publish(); expect(signal.aborted).toBe(false);
    current.harness.model = 'reader-2'; publish(); expect(signal.aborted).toBe(true);
    await expect(active.done).resolves.toMatchObject({success: false, cancelled: true});
    const progressCount = active.progress.mock.calls.length;
    gate.resolve(undefined); await flush();
    expect(active.progress).toHaveBeenCalledTimes(progressCount);
    expect(active.result).toHaveBeenCalledOnce(); expect(active.error).not.toHaveBeenCalled();
  });

  it('disconnects the old owner on replacement and closes reading independently from final count flush', async () => {
    const gate = deferred<void>();
    state.sdkStream.mockImplementationOnce(() => sdkAnswer('old late result', gate.promise));
    install();
    const old = start(request('same-request-id'));
    await vi.waitFor(() => expect(state.sdkStream).toHaveBeenCalledOnce());
    const oldSignal = state.sdkStream.mock.calls[0][0].abortSignal as AbortSignal;
    install(); await flush();
    expect(oldSignal.aborted).toBe(true); expect(old.error).toHaveBeenCalledOnce(); expect(old.result).not.toHaveBeenCalled();
    await expect(start(request('same-request-id')).done).resolves.toMatchObject({success: true, text: 'partial completed'});
    gate.resolve(undefined); await flush();
    expect(old.result).not.toHaveBeenCalled(); expect(old.error).toHaveBeenCalledOnce();
    expect(stopWatching).toHaveBeenCalledOnce();
    adapter.closePlatformConnections();
    expect(stopWatching).toHaveBeenCalledTimes(2);
    expect(() => adapter.default.runtime.connect({name: 'fluentReadHarnessStream'})).toThrow('阅读连接已关闭');
    await expect(adapter.default.runtime.sendMessage({type: 'count-flush-probe'})).resolves.toEqual({success: true});
  });

  it('uses its actual page eligibility despite forged sender payload and rejects unsupported persisted protocols explicitly', async () => {
    install();
    current.disabledExtensionDomains = ['reading.example'];
    const forged = {...request('forged-sender'), sender: {id: 'forged', url: 'https://allowed.example', tab: {id: 99, incognito: false}}, privateContext: false} as ReadingRequest;
    await expect(start(forged).done).resolves.toMatchObject({success: false, error: '当前网站已禁用扩展'});
    expect(state.sdkStream).not.toHaveBeenCalled();
    current.disabledExtensionDomains = [];
    await expect(start(request('persisted-anchor', {sessionId: 'native-session', anchorTurnId: 'native-turn'})).done).resolves.toMatchObject({success: false, error: expect.stringContaining('不保存阅读记录')});
    await expect(listHarnessSessions()).rejects.toThrow('不保存阅读记录');
    await expect(saveLearningMemory({kind: 'note', content: 'explicit note'})).rejects.toThrow('暂不支持学习记忆');
    expect(state.sdkStream).not.toHaveBeenCalled();
    expect(() => adapter.default.runtime.connect({name: 'another-channel'})).toThrow('不支持此连接');
    adapter.resetPlatformMessageHandler();
    expect(() => adapter.default.runtime.connect({name: 'fluentReadHarnessStream'})).toThrow('尚未就绪');
  });
});

import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type Plugin, type ViteDevServer} from 'vite';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {getHarnessModelCacheKey, DEFAULT_HARNESS_PREFERENCES} from '@/src/core/config/harness';
import type {HarnessSession} from '@/src/services/harness/sessionTypes';
import type {ReadingRequest, ReadingProgress, ReadingResponse} from '@/src/features/reading-assistant/types';

const TEST_KEY = '__frReadingLifecycle';
interface StreamCall {
  request: ReadingRequest;
  callbacks: {progress: (value: ReadingProgress) => void; result: (value: ReadingResponse) => void; error: (error: Error) => void};
  cancel: ReturnType<typeof vi.fn>;
}
let server: ViteDevServer | undefined;
let unmount: (() => void) | undefined;
const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');

afterEach(async () => {
  unmount?.(); unmount = undefined;
  await server?.close(); server = undefined;
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>)[TEST_KEY];
});

async function mountPanel(overrides: Record<string, unknown> = {}, sessions: HarnessSession[] = [], runtimeBrowser?: Record<string, any>) {
  const calls: StreamCall[] = [];
  const sendMessage = vi.fn(async () => ({success: true}));
  const state = {
    browser: runtimeBrowser ?? {runtime: {sendMessage}},
    streamReading: (request: ReadingRequest, callbacks: StreamCall['callbacks']) => {
      const call = {request, callbacks, cancel: vi.fn()}; calls.push(call); return {cancel: call.cancel};
    },
    getHarnessSession: vi.fn(async (id: string) => sessions.find(session => session.id === id) || null),
    listHarnessSessions: vi.fn(async () => ({sessions: [], hasMore: false})),
    saveLearningMemory: vi.fn(async () => ({})),
  };
  (globalThis as Record<string, unknown>)[TEST_KEY] = state;
  const mocks: Plugin = {
    name: 'reading-lifecycle-mocks', enforce: 'pre',
    resolveId(id, importer) {
      if (id === 'webextension-polyfill') return '\0reading-browser';
      if (!runtimeBrowser && id === '../client' && importer?.includes('/reading-assistant/ui/')) return '\0reading-client';
      return null;
    },
    load(id) {
      if (id === '\0reading-browser') return `export default globalThis.${TEST_KEY}.browser;`;
      if (id === '\0reading-client') return `export const {streamReading,getHarnessSession,listHarnessSessions,saveLearningMemory} = globalThis.${TEST_KEY};`;
      return null;
    },
  };
  server = await createServer({configFile: false, appType: 'custom', logLevel: 'silent', root: process.cwd(), define: runtimeBrowser ? {'import.meta.env.BROWSER': JSON.stringify('userscript')} : undefined, plugins: [mocks, vue()], resolve: {alias: {'@': resolve(process.cwd())}}, server: {hmr: false, middlewareMode: true}, ssr: {noExternal: ['webextension-polyfill']}});
  const loaded = await server.ssrLoadModule('/src/features/reading-assistant/ui/ReadingPanel.vue');
  const component = loaded.default;
  component.ssrRender = undefined; component.render = () => null;
  const renderer = runtime.createRenderer<Record<string, never>, Record<string, unknown>>({
    patchProp: () => undefined, insert: () => undefined, remove: () => undefined,
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText: () => undefined, setElementText: () => undefined, parentNode: () => null,
    nextSibling: () => null, querySelector: () => null, setScopeId: () => undefined,
    cloneNode: () => ({}), insertStaticContent: () => [{}, {}],
  });
  const sourceChange = vi.fn();
  const props = runtime.reactive({selection: {text: 'Practice helps.', sentence: 'Practice helps.', context: 'Practice helps every day.'}, preferences: {...DEFAULT_HARNESS_PREFERENCES, enabled: true}, active: true, targetLanguage: 'zh-CN', sourceLanguage: 'en', vocabularyEnabled: true, privateContext: false, animations: false, sourceTranslation: undefined as {source: string; text: string; pending?: boolean; error?: string} | undefined, onSourceChange: sourceChange, ...overrides});
  let panel: any;
  const app = renderer.createApp({setup: () => () => runtime.h(component, {...props, ref: (instance: any) => { if (instance) panel = instance.$.setupState; }})});
  app.provide(runtime.ssrContextKey, {modules: new Set<string>()});
  app.config.warnHandler = () => undefined;
  app.mount({}); unmount = () => app.unmount();
  await runtime.nextTick();
  const finish = (text: string, call = calls.at(-1)!) => call.callbacks.result({success: true, text, service: 'deepseek', model: 'test-model', sessionId: 'session-a'});
  return {panel, calls, props, sendMessage, sourceChange, finish, state, tick: runtime.nextTick, unmount: () => {app.unmount(); unmount = undefined;}};
}

describe('reading action ownership and reuse', () => {
  it('has no active answer or model request before entering learning, and starts the default action after an empty history view', async () => {
    const {panel, calls, props, tick} = await mountPanel({active: false});
    expect(panel.canPersistReading).toBe(true); // 缺省保留扩展记录能力；userscript 显式 false 单独覆盖。
    expect(panel.currentTurnKey).toBe(''); expect(calls).toHaveLength(0);
    Object.assign(props, {historyOnly: true, active: true}); await tick();
    expect(panel.showRecords).toBe(true); expect(calls).toHaveLength(0);
    panel.closeRecords(); panel.chooseAction('meaning'); await tick();
    expect(panel.currentTurnKey).not.toBe(''); expect(calls).toHaveLength(1);
    expect(calls[0].request.intent).toBe('meaning');
  });

  it('expands one historical turn without changing the current answer or context, and folds history when the current turn changes', async () => {
    const {panel, calls, finish, tick} = await mountPanel();
    finish('First answer'); panel.question = 'Why is it useful?'; panel.ask(); finish('Second answer');
    panel.question = 'Can you give an example?'; panel.ask(); finish('Current answer'); await tick();
    const ids = panel.priorAnswers.map((turn: any) => turn.id);
    const before = calls.length;
    panel.historyDetails = {open: true};
    panel.toggleHistoryTurn(ids[0]); expect(panel.expandedTurnId).toBe(ids[0]);
    panel.toggleHistoryTurn(ids[1]); expect(panel.expandedTurnId).toBe(ids[1]);
    panel.toggleHistoryTurn(ids[1]); expect(panel.expandedTurnId).toBe('');
    expect(panel.answer).toBe('Current answer'); expect(panel.currentQuestion).toBe('Can you give an example?'); expect(calls).toHaveLength(before);
    panel.toggleHistoryTurn(ids[0]); panel.question = 'One more detail'; panel.ask(); await tick();
    expect(panel.expandedTurnId).toBe(''); expect(panel.historyDetails.open).toBe(false);
    expect(calls.at(-1)!.request.history).toEqual([
      {question: '读懂', answer: 'First answer'}, {question: 'Why is it useful?', answer: 'Second answer'}, {question: 'Can you give an example?', answer: 'Current answer'},
    ]);
  });

  it('keeps the current tab position and unsent follow-up, and offers a focused source shortcut without a request', async () => {
    const {panel, finish, calls, tick} = await mountPanel();
    finish('Current answer'); await tick();
    const viewport = {scrollTop: 0, focus: vi.fn()};
    panel.answerScroll = viewport;
    panel.question = 'An unsent follow-up';
    panel.chooseAction('meaning'); await tick();
    expect(viewport.scrollTop).toBe(0); expect(panel.question).toBe('An unsent follow-up'); expect(calls).toHaveLength(1);
    viewport.scrollTop = 300; await panel.showSource();
    expect(viewport.scrollTop).toBe(0); expect(viewport.focus).toHaveBeenCalledWith({preventScroll: true}); expect(calls).toHaveLength(1);
  });

  it('positions after the popup layout settles and cancels delayed positioning on user interaction or unmount', async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
    const flushFrame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };
    const {panel, tick} = await mountPanel();
    const viewport = {scrollTop: 0};
    const body = {offsetTop: 40};
    panel.answerScroll = viewport; panel.answerBody = body;
    flushFrame();
    expect(viewport.scrollTop).toBe(0);
    body.offsetTop = 120; flushFrame();
    expect(viewport.scrollTop).toBe(120);
    panel.startAction('grammar'); await tick(); flushFrame();
    viewport.scrollTop = 0; panel.cancelReadingPosition(); flushFrame();
    expect(viewport.scrollTop).toBe(0);
    panel.startAction('usage'); await tick();
    expect(frames.size).toBe(1);
    unmount?.(); unmount = undefined; flushFrame();
    expect(frames.size).toBe(0); expect(viewport.scrollTop).toBe(0);
  });

  it('starts each action after the source and preserves an upward scroll during streaming and completion', async () => {
    const {panel, finish, calls, tick} = await mountPanel();
    const viewport = {scrollTop: 0};
    panel.answerScroll = viewport;
    panel.answerBody = {offsetTop: 80};
    finish('Initial explanation');
    for (const action of ['meaning', 'grammar', 'usage', 'practice']) {
      panel.startAction(action); await tick();
      expect(viewport.scrollTop).toBe(80);
      viewport.scrollTop = 0;
      calls.at(-1)!.callbacks.progress({kind: 'text', text: 'Partial explanation'}); await tick();
      expect(viewport.scrollTop).toBe(0);
      finish('Completed explanation'); await tick();
      expect(viewport.scrollTop).toBe(0);
    }
    const count = calls.length;
    panel.startAction('meaning'); await tick();
    expect(viewport.scrollTop).toBe(80); expect(calls).toHaveLength(count);
    panel.question = 'A follow-up'; panel.ask(); await tick();
    expect(viewport.scrollTop).toBe(80);
    viewport.scrollTop = 0;
    finish('Follow-up answer'); await tick();
    expect(viewport.scrollTop).toBe(0);
  });

  it('reuses meaning after grammar and unrelated config refreshes, including deactivate/reactivate', async () => {
    const {panel, props, calls, finish, tick} = await mountPanel();
    const config = new Config();
    let key = getHarnessModelCacheKey(config);
    const refresh = () => {
      const next = getHarnessModelCacheKey(config);
      if (next !== key) Object.assign(props, {modelRevision: 1});
      key = next;
    };
    finish('Meaning'); panel.startAction('grammar'); finish('Grammar');
    config.animations = !config.animations; refresh(); await tick();
    panel.startAction('meaning');
    expect(panel.answer).toBe('Meaning'); expect(calls).toHaveLength(2);
    props.active = false; await tick(); props.active = true; await tick();
    expect(panel.answer).toBe('Meaning'); expect(calls).toHaveLength(2);
    config.harness.model = 'another-reader'; refresh(); await tick();
    panel.startAction('meaning'); expect(calls).toHaveLength(3);
  });

  it('restores each completed action and its follow-up context without requesting again; explicit regeneration requests once', async () => {
    const {panel, calls, finish} = await mountPanel();
    finish('Meaning answer');
    panel.startAction('practice'); finish('Practice answer');
    panel.question = 'My practice attempt'; panel.ask(); finish('Practice feedback');
    expect(calls.at(-1)!.request.history).toEqual([{question: '练习', answer: 'Practice answer'}]);
    panel.startAction('grammar'); finish('Grammar answer');
    panel.startAction('practice');
    expect(calls).toHaveLength(4);
    expect(panel.answer).toBe('Practice feedback');
    expect(panel.currentQuestion).toBe('My practice attempt');
    panel.startAction('practice'); expect(calls).toHaveLength(4);
    panel.question = 'One more question'; panel.ask();
    expect(calls.at(-1)!.request.history).toEqual([{question: '练习', answer: 'Practice answer'}, {question: 'My practice attempt', answer: 'Practice feedback'}]);
    finish('Second feedback'); panel.regenerate();
    expect(calls).toHaveLength(6);
    expect(calls.at(-1)!.request).toMatchObject({intent: 'practice', question: '', history: []});
    finish('New practice');
    panel.startAction('meaning'); panel.startAction('practice');
    expect(calls).toHaveLength(6); expect(panel.answer).toBe('New practice');
    expect(panel.priorAnswers.every((turn: any) => turn.id !== panel.currentTurnKey)).toBe(true);
  });

  it('cancels switched requests, ignores late deltas, and keeps the last successful answer after a failed regeneration', async () => {
    const {panel, calls, finish} = await mountPanel();
    finish('Stable meaning'); panel.startAction('practice');
    const unfinished = calls.at(-1)!;
    unfinished.callbacks.progress({kind: 'text', text: 'Partial practice'});
    panel.startAction('meaning');
    expect(unfinished.cancel).toHaveBeenCalledOnce();
    unfinished.callbacks.progress({kind: 'text', text: 'Late practice'}); finish('Late finish', unfinished);
    expect(panel.answer).toBe('Stable meaning');
    panel.regenerate(); calls.at(-1)!.callbacks.result({success: false, error: 'Offline'});
    panel.startAction('practice'); finish('Good practice'); panel.startAction('meaning');
    expect(panel.answer).toBe('Stable meaning'); expect(panel.error).toBe('');
    expect(calls).toHaveLength(4);
  });

  it('invalidates answers for changed source context, language, and model settings', async () => {
    const {panel, props, calls, finish, tick} = await mountPanel();
    finish('Original'); panel.startAction('practice'); finish('Practice');
    props.selection = {...props.selection, context: 'Same words in a different paragraph.'}; await tick();
    panel.startAction('meaning'); expect(calls).toHaveLength(3); finish('New context');
    props.targetLanguage = 'ja'; await tick(); panel.startAction('meaning'); expect(calls).toHaveLength(4); finish('Japanese');
    Object.assign(props, {modelRevision: 1}); await tick(); panel.startAction('meaning'); expect(calls).toHaveLength(5);
  });

  it('restores completed actions from a saved session and does not include the failed answer in retry history', async () => {
    const session: HarnessSession = {id: 'old', text: 'Historical source.', context: 'Historical paragraph.', createdAt: 1, updatedAt: 4, intent: 'grammar', turns: [
      {id: 'a', question: '练习', answer: 'Saved practice', intent: 'practice', status: 'completed', model: 'old-model', service: 'deepseek', createdAt: 1},
      {id: 'b', question: '拆句', answer: 'Partial grammar', intent: 'grammar', status: 'error', model: 'old-model', service: 'deepseek', createdAt: 2},
    ]};
    const {panel, calls, sourceChange, tick} = await mountPanel({historyOnly: true}, [session]);
    await panel.restoreSession('old'); await tick();
    expect(calls).toHaveLength(0); expect(panel.answer).toBe('Partial grammar');
    expect(sourceChange).toHaveBeenCalledWith('Historical source.');
    panel.retry();
    expect(calls[0].request.history).toEqual([{question: '练习', answer: 'Saved practice'}]);
    panel.startAction('practice');
    expect(calls).toHaveLength(1); expect(panel.answer).toBe('Saved practice');
    expect(panel.activeText).toBe('Historical source.');
  });

  it('handles negative settings responses and allows saving original text before the model answers', async () => {
    const {panel, sendMessage, calls} = await mountPanel();
    sendMessage.mockResolvedValueOnce({success: false});
    await panel.openSettings('settings-services');
    expect(panel.feedback).toContain('翻译服务');
    sendMessage.mockRejectedValueOnce(new Error('background stopped'));
    await panel.openSettings(); expect(panel.feedback).toContain('专项翻译'); expect(panel.feedback).toContain('划词翻译');
    await panel.openSettings(); expect(sendMessage).toHaveBeenLastCalledWith({type: 'openOptionsPage', section: 'settings-selection'});
    await panel.saveWord();
    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({action: 'upsert', input: expect.objectContaining({term: 'Practice helps.', sourceLanguage: 'en', translation: ''})}));
    expect(panel.saved).toBe(true); expect(calls).toHaveLength(1);
    expect(panel.feedback).toContain('单词与句子');
    await panel.openLearningCollection();
    expect(sendMessage).toHaveBeenLastCalledWith({type: 'openOptionsPage', section: 'settings-vocabulary', learningTab: 'saved'});
  });
  it('saves completed notes explicitly while AI reference is off, and refuses incomplete or private answers', async () => {
    const {panel, props, state, finish, tick, sendMessage} = await mountPanel();
    expect(props.preferences.memoryEnabled).toBe(false);
    await panel.rememberLearning();
    expect(state.saveLearningMemory).not.toHaveBeenCalled();
    finish('New useful explanation');
    expect(state.saveLearningMemory).not.toHaveBeenCalled();
    await panel.rememberLearning();
    expect(state.saveLearningMemory).toHaveBeenCalledWith({kind: 'lesson', content: '原文：Practice helps.\n学习要点：New useful explanation'});
    expect(panel.remembered).toBe(true);
    expect(panel.feedback).toContain('学习笔记');
    await panel.rememberLearning();
    expect(state.saveLearningMemory).toHaveBeenCalledOnce();
    await panel.openLearningMemory();
    expect(sendMessage).toHaveBeenLastCalledWith({type: 'openOptionsPage', section: 'settings-vocabulary', learningTab: 'memory'});
    props.privateContext = true; await tick(); panel.regenerate(); finish('A private explanation'); await panel.rememberLearning();
    expect(state.saveLearningMemory).toHaveBeenCalledOnce();
  });
  it('saves the matching translation with the original and keeps the AI explanation in study notes', async () => {
    const {panel, sendMessage, state, finish} = await mountPanel({sourceTranslation: {source: 'Practice helps.', text: '练习有帮助。'}});
    finish('This explains the grammar and usage.');
    await panel.saveWord();
    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({action: 'upsert', input: expect.objectContaining({term: 'Practice helps.', translation: '练习有帮助。'})}));
    await panel.rememberLearning();
    expect(state.saveLearningMemory).toHaveBeenCalledWith({kind: 'lesson', content: '原文：Practice helps.\n学习要点：This explains the grammar and usage.'});
  });
  it('keeps both saved-content destinations explicit when opening the learning center fails', async () => {
    const {panel, sendMessage} = await mountPanel();
    sendMessage.mockResolvedValueOnce({success: false}); await panel.openLearningCollection();
    expect(panel.feedback).toContain('单词与句子');
    sendMessage.mockResolvedValueOnce({success: false}); await panel.openLearningMemory();
    expect(panel.feedback).toContain('学习笔记');
  });
});

it('keeps only the translation matching the displayed source and preserves the active answer', async () => {
  const {panel, props, finish, calls, tick} = await mountPanel({sourceTranslation: {source: 'Practice  helps.', text: '练习有帮助。'}});
  finish('Explanation'); await tick();
  expect(panel.activeTranslation.text).toBe('练习有帮助。');
  props.sourceTranslation = {source: 'Practice helps.', text: '练习有所帮助。'}; await tick();
  expect(panel.answer).toBe('Explanation'); expect(calls).toHaveLength(1);
  panel.historicalText = 'An older source'; await tick();
  expect(panel.activeTranslation).toBeUndefined();
  panel.historicalText = ''; props.selection.sentence = 'Practice helps every day.'; await tick();
  panel.wholeSentence = true; await tick();
  expect(panel.activeTranslation).toBeUndefined();
});
it('preserves the answer offset for late translations and respects manual upward scrolling', async () => {
  const {panel, props, finish, calls, tick} = await mountPanel({sourceTranslation: {source: 'Practice helps.', text: '', pending: true}});
  finish('Explanation'); await tick();
  const viewport = {scrollTop: 120}; const body = {offsetTop: 100};
  panel.answerScroll = viewport; panel.answerBody = body;
  props.sourceTranslation = {source: 'Practice helps.', text: '练习有帮助。'};
  await tick(); body.offsetTop = 160; await tick();
  expect(viewport.scrollTop).toBe(180); expect(calls).toHaveLength(1);
  viewport.scrollTop = 0;
  props.sourceTranslation = {source: 'Practice helps.', text: '更新后的译文。'};
  await tick(); body.offsetTop = 200; await tick();
  expect(viewport.scrollTop).toBe(0);
  viewport.scrollTop = 220;
  props.sourceTranslation = {source: 'Practice helps.', text: '再更新的译文。'};
  await tick(); panel.cancelReadingPosition(); body.offsetTop = 240; await tick();
  expect(viewport.scrollTop).toBe(220);
});




describe('actual userscript ReadingPanel capability error through the real client', () => {
  it('calls the real shim connect and reports its honest not-ready capability when the default platform has no stream transport', async () => {
    const {default: shim, resetPlatformMessageHandler} = await import('@/userscript/browser');
    resetPlatformMessageHandler();
    expect(typeof Reflect.get(shim.runtime, 'connect')).toBe('function');
    const connectReads = vi.fn(), connectCalls = vi.fn();
    const runtimePort = new Proxy(shim.runtime, {get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (key !== 'connect') return value;
      connectReads();
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {connectCalls(...args); return Reflect.apply(value, target, args);};
    }});
    const fixture = await mountPanel({active: false, privateContext: true}, [], {...shim, runtime: runtimePort});
    expect(fixture.calls).toHaveLength(0);
    expect(connectReads).not.toHaveBeenCalled(); expect(connectCalls).not.toHaveBeenCalled();
    fixture.props.active = true; await fixture.tick();
    expect(connectReads).toHaveBeenCalled();
    expect(connectCalls).toHaveBeenCalledWith({name: 'fluentReadHarnessStream'});
    expect(fixture.panel.currentTurnKey).toMatch(/^reading-/u);
    expect(fixture.panel.busy).toBe(false); expect(fixture.panel.answer).toBe('');
    expect(fixture.panel.error).toMatch(/未就绪/u);
    expect(fixture.panel.error).toMatch(/(?:阅读|userscript|脚本|stream|transport)/iu);
    expect(fixture.panel.error).not.toMatch(/(?:TypeError|is not a function|undefined)/iu);
    fixture.unmount();
  });
});

describe('real ReadingPanel/client at a controlled semantic stream-port boundary', () => {
  it('roundtrips the real request, progress, result and cancellation without replacing the reading client', async () => {
    const {default: shim, setPlatformMessageHandler, resetPlatformMessageHandler} = await import('@/userscript/browser');
    const cancelMessages: unknown[] = [];
    setPlatformMessageHandler(async message => {
      if (message?.type !== 'fluentReadHarness' || message.action !== 'cancel') throw new Error('Unexpected local synthetic message');
      cancelMessages.push(message); return {success: true};
    });
    const ports: Array<ReturnType<typeof makePort>> = [];
    function makePort() {
      const messages = new Set<(message: unknown) => void>();
      const disconnects = new Set<() => void>();
      const port = {
        postMessage: vi.fn(),
        onMessage: {addListener: (listener: (message: unknown) => void) => messages.add(listener), removeListener: (listener: (message: unknown) => void) => messages.delete(listener)},
        onDisconnect: {addListener: (listener: () => void) => disconnects.add(listener), removeListener: (listener: () => void) => disconnects.delete(listener)},
        disconnect: vi.fn(() => {for (const listener of [...disconnects]) listener();}),
        deliver: (message: unknown) => {for (const listener of [...messages]) listener(message);},
        listenerCount: () => messages.size + disconnects.size,
      };
      return port;
    }
    const connect = vi.fn((_options: {name: string}) => {const port = makePort(); ports.push(port); return port;});
    // Explicit test-only external port, with full protocol behavior; it is not a shim implementation.
    const fixture = await mountPanel({active: false, privateContext: true}, [], {...shim, runtime: {...shim.runtime, connect}});
    try {
      expect(connect).not.toHaveBeenCalled();
      fixture.props.active = true; await fixture.tick();
      expect(fixture.calls).toHaveLength(0);
      expect(connect).toHaveBeenCalledWith({name: 'fluentReadHarnessStream'});
      expect(ports).toHaveLength(1);
      const request = ports[0].postMessage.mock.calls[0][0] as ReadingRequest;
      expect(request).toMatchObject({type: 'fluentReadHarness', action: 'run', intent: 'meaning', question: '', history: [], selection: {text: 'Practice helps.'}});
      expect(request.requestId).toMatch(/^reading-/u);
      expect(fixture.panel.busy).toBe(true); expect(fixture.panel.error).toBe('');
      ports[0].deliver({type: 'progress', requestId: 'other', progress: {kind: 'text', text: 'Wrong request'}});
      expect(fixture.panel.answer).toBe('');
      ports[0].deliver({type: 'progress', requestId: request.requestId, progress: {kind: 'text', text: 'Controlled partial'}});
      expect(fixture.panel.answer).toBe('Controlled partial');
      ports[0].deliver({type: 'result', requestId: request.requestId, response: {success: true, text: 'Controlled complete', service: 'synthetic', model: 'local-fixture'}});
      expect(fixture.panel.answer).toBe('Controlled complete'); expect(fixture.panel.busy).toBe(false);
      expect(ports[0].disconnect).toHaveBeenCalledOnce(); expect(ports[0].listenerCount()).toBe(0);
      fixture.panel.startAction('grammar'); await fixture.tick();
      expect(ports).toHaveLength(2);
      const secondRequest = ports[1].postMessage.mock.calls[0][0] as ReadingRequest;
      fixture.panel.stop(); await fixture.tick();
      expect(ports[1].disconnect).toHaveBeenCalledOnce(); expect(ports[1].listenerCount()).toBe(0);
      expect(cancelMessages).toContainEqual({type: 'fluentReadHarness', action: 'cancel', requestId: secondRequest.requestId});
      ports[1].deliver({type: 'progress', requestId: secondRequest.requestId, progress: {kind: 'text', text: 'Late partial'}});
      expect(fixture.panel.answer).not.toBe('Late partial');
      fixture.unmount();
    } finally {resetPlatformMessageHandler();}
  });
});


it('keeps normal-context temporary reading usable while blocking unsupported record and note persistence', async () => {
  const {panel, calls, state, finish, tick} = await mountPanel({privateContext: false, persistenceSupported: false});
  expect(panel.canPersistReading).toBe(false);
  expect(panel.canSaveWord).toBe(true); // Vocabulary permission is independent of reading persistence.
  finish('Temporary answer'); await tick();
  panel.openRecords(); await tick();
  expect(panel.showRecords).toBe(false);
  expect(state.listHarnessSessions).not.toHaveBeenCalled();
  await panel.restoreSession('saved-session');
  expect(state.getHarnessSession).not.toHaveBeenCalled();
  await panel.rememberLearning();
  expect(state.saveLearningMemory).not.toHaveBeenCalled();
  expect(panel.answer).toBe('Temporary answer');
  panel.question = 'Why?'; panel.ask();
  expect(calls).toHaveLength(2);
  expect(calls[1].request.sessionId).toBeUndefined();
  expect(calls[1].request.history?.at(-1)?.answer).toBe('Temporary answer');
});


it('starts reading on HTTP-like contexts without randomUUID while retaining the real request contract', async () => {
  vi.stubGlobal('crypto', {});
  const {panel, calls, finish} = await mountPanel({privateContext: true, persistenceSupported: false});
  expect(calls).toHaveLength(1);
  expect(calls[0].request.requestId).toMatch(/^reading-[\w.:-]+$/u);
  expect(panel.busy).toBe(true);
  finish('HTTP context answer');
  expect(panel.error).toBe('');
  expect(panel.answer).toBe('HTTP context answer');
});

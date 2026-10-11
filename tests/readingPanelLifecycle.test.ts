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

async function mountPanel(overrides: Record<string, unknown> = {}, sessions: HarnessSession[] = []) {
  const calls: StreamCall[] = [];
  const sendMessage = vi.fn(async () => ({success: true}));
  const state = {
    browser: {runtime: {sendMessage}},
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
      if (id === '../client' && importer?.includes('/reading-assistant/ui/')) return '\0reading-client';
      return null;
    },
    load(id) {
      if (id === '\0reading-browser') return `export default globalThis.${TEST_KEY}.browser;`;
      if (id === '\0reading-client') return `export const {streamReading,getHarnessSession,listHarnessSessions,saveLearningMemory} = globalThis.${TEST_KEY};`;
      return null;
    },
  };
  server = await createServer({configFile: false, appType: 'custom', logLevel: 'silent', root: process.cwd(), plugins: [mocks, vue()], resolve: {alias: {'@': resolve(process.cwd())}}, server: {hmr: false, middlewareMode: true}, ssr: {noExternal: ['webextension-polyfill']}});
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
  return {panel, calls, props, sendMessage, sourceChange, finish, state, tick: runtime.nextTick};
}

describe('reading evidence ownership', () => {
  it('uses only the bounded authorized context and clears highlights when stopped or the source changes', async () => {
    const clearEvidence = vi.fn();
    const locateEvidence = vi.fn(() => 'located');
    const {panel, props, calls, tick} = await mountPanel({clearEvidence, locateEvidence, sourceRevision: 0, preferences: {...DEFAULT_HARNESS_PREFERENCES, enabled: true, contextMode: 'paragraph', maxContextChars: 500}});
    expect(panel.evidenceSources.some((source: any) => source.kind === 'context')).toBe(true);
    expect(panel.evidenceLocator).toBe(locateEvidence);
    const call = calls.at(-1)!;
    call.callbacks.progress({kind: 'text', text: 'Received explanation'});
    Object.assign(props, {sourceRevision: 1}); await tick();
    expect(call.cancel).toHaveBeenCalled(); expect(clearEvidence).toHaveBeenCalled();
    expect(panel.answer).toBe('Received explanation');
    call.callbacks.result({success: true, text: 'Late explanation', service: 'deepseek', model: 'test'});
    expect(panel.answer).toBe('Received explanation');
    props.preferences.contextMode = 'selection'; await tick();
    expect(panel.requestEvidenceSources.every((source: any) => source.kind === 'selection')).toBe(true);
    expect(panel.evidenceSources.some((source: any) => source.kind === 'context')).toBe(true);
    props.active = false; await tick(); expect(panel.evidenceLocator).toBeUndefined();
  });

  it('rejects a response immediately after navigation even before the observer/poll notification', async () => {
    let state = 'located';
    const {panel, calls} = await mountPanel({checkEvidence: () => state});
    const call = calls.at(-1)!;
    call.callbacks.progress({kind: 'text', text: 'Current text'});
    state = 'navigated';
    call.callbacks.result({success: true, text: 'Late after navigation', service: 'deepseek', model: 'test'});
    expect(panel.answer).toBe('Current text'); expect(panel.stopped).toBe(true);
    expect(call.cancel).toHaveBeenCalled();
  });

  it('retains restored quotes without granting the current page anchor to historical text', async () => {
    const {panel, tick} = await mountPanel({locateEvidence: vi.fn(() => 'located')});
    panel.historicalText = 'A saved sentence.'; panel.historicalContext = 'A saved sentence. It was from another page.'; await tick();
    expect(panel.evidenceLocator).toBeUndefined();
    expect(panel.requestEvidenceSources[0].text).toBe('A saved sentence.');
  });
});

describe('reading action ownership and reuse', () => {
  it('has no active answer or model request before entering learning, and starts the default action after an empty history view', async () => {
    const {panel, calls, props, tick} = await mountPanel({active: false});
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

import * as runtime from 'vue';
import ReadingPanel from '@/src/features/reading-assistant/ui/ReadingPanel.vue';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {getHarnessModelCacheKey, DEFAULT_HARNESS_PREFERENCES} from '@/src/core/config/harness';
import type {HarnessSession} from '@/src/services/harness/sessionTypes';
import type {ReadingRequest, ReadingProgress, ReadingResponse} from '@/src/features/reading-assistant/types';


// Rendered-template tests retain a plain host port for v-show/model directives;
// setup, event handlers and the client render function are the real instrumented SFC.
vi.mock('vue', async importOriginal => ({...await importOriginal<typeof import('vue')>(), vModelText: {}, vShow: {}}));
vi.mock('@/src/services/config/store', () => ({config: {uiLanguage: 'zh-CN'}, configReady: Promise.resolve(), subscribeConfig: () => () => {}}));
vi.mock('webextension-polyfill', () => ({default: {get runtime() {return (globalThis as any).__frReadingLifecycle.browser.runtime;}}}));
vi.mock('@/src/features/vocabulary/material/public', () => ({
  beginMaterialCapture: (...args: unknown[]) => (globalThis as any).__frReadingLifecycle.beginMaterialCapture(...args),
  completeMaterialCapture: (...args: unknown[]) => (globalThis as any).__frReadingLifecycle.completeMaterialCapture(...args),
}));
vi.mock('@/src/features/reading-assistant/client', () => Object.fromEntries([
  'streamReading','getHarnessSession','listHarnessSessions','saveLearningMemory',
].map(name => [name, (...args: unknown[]) => (globalThis as any).__frReadingLifecycle[name](...args)])));

const TEST_KEY = '__frReadingLifecycle';
interface StreamCall {
  request: ReadingRequest;
  callbacks: {progress: (value: ReadingProgress) => void; result: (value: ReadingResponse) => void; error: (error: Error) => void};
  cancel: ReturnType<typeof vi.fn>;
}
let unmount: (() => void) | undefined;

afterEach(async () => {
  unmount?.(); unmount = undefined;
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>)[TEST_KEY];
});

async function mountPanel(overrides: Record<string, unknown> = {}, sessions: HarnessSession[] = [], renderTemplate = true, syncView = false) {
  const calls: StreamCall[] = [];
  const sendMessage = vi.fn(async (_message: unknown) => ({success: true}));
  const state = {
    browser: {runtime: {sendMessage}},
    streamReading: (request: ReadingRequest, callbacks: StreamCall['callbacks']) => {
      const call = {request, callbacks, cancel: vi.fn()}; calls.push(call); return {cancel: call.cancel};
    },
    getHarnessSession: vi.fn(async (id: string) => sessions.find(session => session.id === id) || null),
    listHarnessSessions: vi.fn(async () => ({sessions: [], hasMore: false})),
    saveLearningMemory: vi.fn(async () => ({})),
    beginMaterialCapture: vi.fn(async (): Promise<unknown> => undefined),
    completeMaterialCapture: vi.fn(async () => false),
  };
  (globalThis as Record<string, unknown>)[TEST_KEY] = state;
  const component = renderTemplate ? ReadingPanel : {...ReadingPanel, render: () => null};
  type HostNode = {parent?: HostNode; children: HostNode[]};
  const removeNode = (node: HostNode) => {
    if (!node.parent) return;
    const siblings = node.parent.children; const index = siblings.indexOf(node);
    if (index >= 0) siblings.splice(index, 1);
    node.parent = undefined;
  };
  const insertNode = (node: HostNode, parent: HostNode, anchor?: HostNode | null) => {
    removeNode(node); const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node); node.parent = parent;
  };
  const renderer = runtime.createRenderer<HostNode, HostNode>({
    patchProp: () => undefined, insert: insertNode, remove: removeNode,
    createElement: () => ({children: []}), createText: () => ({children: []}), createComment: () => ({children: []}),
    setText: () => undefined, setElementText: () => undefined, parentNode: node => node.parent || null,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    querySelector: () => null, setScopeId: () => undefined,
    cloneNode: () => ({children: []}), insertStaticContent: (_text, parent, anchor) => {const node = {children: []}; insertNode(node, parent, anchor); return [node, node];},
  });
  const sourceChange = vi.fn();
  const props = runtime.reactive({service: '', initialAction: undefined as HarnessSession['intent'] | undefined, historyOnly: false, selection: {text: 'Practice helps.', sentence: 'Practice helps.', context: 'Practice helps every day.'}, preferences: {...DEFAULT_HARNESS_PREFERENCES, enabled: true}, active: true, targetLanguage: 'zh-CN', sourceLanguage: 'en', vocabularyEnabled: true, privateContext: false, animations: false, sourceTranslation: undefined as {source: string; text: string; pending?: boolean; error?: string} | undefined, onSourceChange: sourceChange, ...overrides});
  const viewChange = vi.fn((view: {action: HarnessSession['intent']; history: boolean}) => {
    if (syncView) Object.assign(props, {initialAction: view.action, historyOnly: view.history});
  });
  let panel: any, panelInstance: any;
  const app = renderer.createApp({setup: () => () => runtime.h(component as runtime.Component, {...props, onViewChange: viewChange, ref: (instance: any) => { if (instance) {panel = instance.$.setupState; panelInstance = instance.$;} }})});
  app.config.warnHandler = () => undefined;
  app.mount({children: []}); unmount = () => app.unmount();
  await runtime.nextTick();
  const finish = (text: string, call = calls.at(-1)!) => call.callbacks.result({success: true, text, service: 'deepseek', model: 'test-model', sessionId: 'session-a'});
  return {panel, calls, props, sendMessage, sourceChange, finish, state, viewChange, tick: runtime.nextTick, rendered: () => panelInstance.subTree};
}

function renderedNodes(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  return [node, ...(node.component ? renderedNodes(node.component.subTree) : []), ...(Array.isArray(node.children) ? node.children.flatMap(renderedNodes) : [])];
}

describe('Bilibili basic reading capabilities', () => {
  const storedSession = (id: string, intent: HarnessSession['intent'], question: string, status: HarnessSession['turns'][number]['status'], answer = 'Stored answer'): HarnessSession => ({
    id, text: 'Historical source.', context: 'Historical paragraph.', createdAt: 1, updatedAt: 2, intent,
    turns: [{id: `${id}-turn`, intent, question, status, answer, service: 'deepseek', model: 'stored-model', createdAt: 1}],
  });
  const buttonNamed = (tree: any, label: string) => renderedNodes(tree).find(node => node.type === 'button' && node.children === label);

  it.each([
    ['grammar', '词性与句法', 'error', 'Partial grammar'],
    ['practice', '练习', 'stopped', ''],
    ['meaning', 'Why is that?', 'error', 'Partial follow-up'],
    ['usage', 'Why this usage?', 'stopped', ''],
  ] as const)('preserves historical %s identity through parent navigation echoes and offers only supported generation', async (intent, question, status, answer) => {
    const session = storedSession('old', intent, question, status, answer);
    const preferences = {...DEFAULT_HARNESS_PREFERENCES, enabled: true, service: 'bilibili'};
    const {panel, calls, props, tick, rendered} = await mountPanel({preferences, historyOnly: true}, [session], true, true);
    await panel.restoreSession('old'); await tick();
    const prompt = intent === 'grammar' || intent === 'practice' ? '' : question;
    expect(calls).toHaveLength(0); expect(panel.intent).toBe(intent); expect(panel.currentTurnKey).toBe('old-turn');
    expect(panel.answer).toBe(answer); expect(panel.currentQuestion).toBe(prompt); expect(panel.lastQuestion).toBe(prompt);
    expect(props.initialAction).toBe(intent); expect(props.historyOnly).toBe(false);
    expect(panel.retrySupported).toBe(false);
    const retry = buttonNamed(rendered(), status === 'error' ? '重试' : '继续生成');
    expect(retry?.props.disabled).toBe(true); expect(retry?.props.title).toContain('B站仅提供基础讲解');
    expect(buttonNamed(rendered(), '重新生成')?.props.disabled).toBe(intent === 'grammar' || intent === 'practice');
    expect(buttonNamed(rendered(), '切换服务')).toBeDefined();
    panel.retry();
    if (intent === 'grammar' || intent === 'practice') panel.regenerate();
    await tick(); expect(calls).toHaveLength(0); expect(panel.feedback).toContain('B站仅提供基础讲解');
    expect(panel.intent).toBe(intent); expect(panel.answer).toBe(answer); expect(panel.lastQuestion).toBe(prompt);
    panel.openRecords(); await tick(); panel.closeRecords(); await tick();
    expect(panel.currentTurnKey).toBe('old-turn'); expect(panel.answer).toBe(answer); expect(calls).toHaveLength(0);
    props.preferences.service = 'deepseek'; await tick();
    expect(panel.retrySupported).toBe(true); expect(panel.intent).toBe(intent); expect(panel.currentQuestion).toBe(prompt);
    expect(buttonNamed(rendered(), '重新生成')?.props.disabled).toBe(false);
    panel.retry(); expect(calls).toHaveLength(1);
    expect(calls[0].request).toMatchObject({intent, question: prompt, selection: {text: 'Historical source.'}});
  });

  it('keeps basic Bilibili retries available when a restored meaning turn has no follow-up question', async () => {
    const session = storedSession('base', 'meaning', '读懂', 'error');
    const {panel, calls, tick, rendered} = await mountPanel({historyOnly: true, preferences: {...DEFAULT_HARNESS_PREFERENCES, enabled: true, service: 'bilibili'}}, [session], true, true);
    await panel.restoreSession('base'); await tick();
    expect(panel.currentQuestion).toBe(''); expect(panel.retrySupported).toBe(true);
    expect(buttonNamed(rendered(), '重试')?.props.disabled).toBe(false);
    panel.retry(); expect(calls).toHaveLength(1); expect(calls[0].request).toMatchObject({intent: 'meaning', question: '', history: []});
  });

  it('reacts to same-intent history questions and permits an explicit new basic explanation rather than retrying a Bilibili follow-up', async () => {
    const sessions = [storedSession('base', 'meaning', '读懂', 'error'), storedSession('followup', 'meaning', 'What does this imply?', 'error')];
    const {panel, calls, tick, rendered} = await mountPanel({historyOnly: true, preferences: {...DEFAULT_HARNESS_PREFERENCES, enabled: true, service: 'bilibili'}}, sessions, true, true);
    await panel.restoreSession('base'); await tick(); expect(panel.retrySupported).toBe(true);
    panel.openRecords(); await tick(); await panel.restoreSession('followup'); await tick();
    expect(calls).toHaveLength(0); expect(panel.intent).toBe('meaning'); expect(panel.retrySupported).toBe(false);
    expect(panel.currentQuestion).toBe('What does this imply?'); expect(panel.currentTurnKey).toBe('followup-turn');
    expect(buttonNamed(rendered(), '重试')?.props.disabled).toBe(true);
    panel.retry(); expect(calls).toHaveLength(0);
    panel.regenerate(); expect(calls).toHaveLength(1); expect(calls[0].request).toMatchObject({intent: 'meaning', question: '', history: []});
  });

  it('preserves a disabled generic AI historical action and explains how to enable it instead of relabeling or requesting', async () => {
    const session = storedSession('grammar', 'grammar', '词性与句法', 'error');
    const {panel, calls, props, tick, rendered} = await mountPanel({historyOnly: true, preferences: {...DEFAULT_HARNESS_PREFERENCES, enabled: true, service: 'deepseek', actions: ['meaning', 'usage']}}, [session], true, true);
    await panel.restoreSession('grammar'); await tick();
    expect(panel.feedback).toBe('已打开上次的问答。');
    expect(panel.intent).toBe('grammar'); expect(panel.answer).toBe('Stored answer'); expect(panel.retrySupported).toBe(false);
    expect(buttonNamed(rendered(), '重试')?.props.disabled).toBe(true); expect(buttonNamed(rendered(), '重新生成')?.props.disabled).toBe(true);
    expect(renderedNodes(rendered()).some(node => typeof node.children === 'string' && node.children.includes('当前动作未启用'))).toBe(true);
    expect(renderedNodes(rendered()).find(node => node.type === 'input' && node.props?.['aria-label'] === '继续追问')?.props.disabled).toBe(true);
    panel.question = 'Keep this draft'; panel.ask();
    expect(panel.question).toBe('Keep this draft'); expect(buttonNamed(rendered(), '↑')?.props.disabled).toBe(true);
    panel.retry(); panel.regenerate(); expect(calls).toHaveLength(0); expect(panel.feedback).toContain('当前动作未启用');
    props.preferences.actions.push('grammar'); await tick();
    expect(panel.intent).toBe('grammar'); expect(panel.retrySupported).toBe(true);
    expect(renderedNodes(rendered()).find(node => node.type === 'input' && node.props?.['aria-label'] === '继续追问')?.props.disabled).toBe(false);
    panel.retry(); expect(calls).toHaveLength(1); expect(calls[0].request).toMatchObject({intent: 'grammar', question: ''});
  });

  it('delegates cancellation once to the stream owner without a second raw runtime message', async () => {
    const {panel, calls, sendMessage} = await mountPanel();
    expect(calls).toHaveLength(1);
    panel.stop(); panel.stop();
    expect(calls[0].cancel).toHaveBeenCalledOnce();
    expect((sendMessage.mock.calls as unknown[][]).some(([message]) => (message as {action?: string})?.action === 'cancel')).toBe(false);
    expect(panel.busy).toBe(false);
    calls[0].callbacks.progress({kind: 'text', text: 'late'});
    expect(panel.answer).not.toBe('late');
  });

  it.each(['bilibili', 'deepseek'])('returns from empty records once, preserves existing reading, and still handles explicit action/activation changes (%s)', async service => {
    const {panel, calls, props, finish, tick} = await mountPanel({historyOnly: true, preferences: {...DEFAULT_HARNESS_PREFERENCES, enabled: true, service}}, [], true, true);
    expect(calls).toHaveLength(0); panel.closeRecords(); await tick();
    expect(calls).toHaveLength(1); expect(calls[0].request.intent).toBe('meaning');
    finish('Current reading'); await tick();
    panel.openRecords(); await tick(); panel.closeRecords(); await tick();
    expect(calls).toHaveLength(1); expect(panel.answer).toBe('Current reading');
    panel.openRecords(); await tick(); Object.assign(props, {initialAction: 'usage', historyOnly: false}); await tick();
    expect(calls).toHaveLength(2); expect(calls[1].request.intent).toBe('usage');
    finish('Usage answer'); await tick(); props.active = false; await tick(); props.active = true; await tick();
    expect(panel.intent).toBe('usage'); expect(panel.answer).toBe('Usage answer'); expect(calls).toHaveLength(2);
  });

  it.each([false, true])('filters actions, hides follow-up, and restores paid controls without rewriting preferences (external=%s)', async externalNavigation => {
    const preferences = {...DEFAULT_HARNESS_PREFERENCES, enabled: true, service: 'bilibili', defaultAction: 'grammar'};
    const {panel, calls, props, finish, tick, rendered, sendMessage} = await mountPanel({preferences, externalNavigation}, [], true);
    expect(panel.actions.map((action: any) => action.id)).toEqual(['meaning', 'usage']);
    expect(panel.intent).toBe('meaning'); expect(calls).toHaveLength(1);
    expect(calls[0].request.intent).toBe('meaning'); expect(props.preferences.defaultAction).toBe('grammar');
    const storedActions = [...props.preferences.actions];
    finish('Basic explanation'); await tick();
    expect(renderedNodes(rendered()).some(node => node.type === 'form' && node.props?.class === 'fr-reading-followup')).toBe(false);
    expect(renderedNodes(rendered()).some(node => typeof node.children === 'string' && node.children.includes('B站仅提供基础讲解'))).toBe(true);
    panel.question = 'An unsupported follow-up'; panel.ask(); await panel.run('An unsupported retry', [], true); panel.startAction('grammar'); panel.startAction('practice');
    expect(calls).toHaveLength(1); expect(panel.question).toBe('An unsupported follow-up');
    await panel.openSettings(); expect(sendMessage).toHaveBeenCalledWith({type: 'openOptionsPage', section: 'settings-selection'});
    props.preferences.service = 'deepseek'; await tick();
    expect(panel.actions.map((action: any) => action.id)).toEqual(['meaning', 'grammar', 'usage', 'practice']);
    expect(panel.followUpSupported).toBe(true);
    expect(renderedNodes(rendered()).filter(node => node.type === 'form' && node.props?.class === 'fr-reading-followup')).toHaveLength(1);
    expect(props.preferences.actions).toEqual(storedActions); expect(props.preferences.defaultAction).toBe('grammar');
    panel.startAction('grammar'); finish('Full grammar'); panel.question = 'A supported follow-up'; panel.ask();
    expect(calls.at(-1)!.request.intent).toBe('grammar'); expect(calls.at(-1)!.request.question).toBe('A supported follow-up');
  });

  it('uses an inherited effective service and rejects a delayed paid answer when it changes to Bilibili', async () => {
    const {panel, calls, props, tick} = await mountPanel({service: 'deepseek', preferences: {...DEFAULT_HARNESS_PREFERENCES, enabled: true, defaultAction: 'grammar'}});
    const oldCall = calls[0]; oldCall.callbacks.progress({kind: 'text', text: 'Current grammar'});
    props.service = 'bilibili'; await tick();
    expect(oldCall.cancel).toHaveBeenCalled(); expect(panel.followUpSupported).toBe(false);
    expect(panel.actions.map((action: any) => action.id)).toEqual(['meaning', 'usage']);
    oldCall.callbacks.result({success: true, text: 'Late grammar', service: 'deepseek', model: 'old'});
    expect(panel.answer).toBe('Current grammar');
    panel.startAction('meaning'); expect(calls.at(-1)!.request.intent).toBe('meaning');
    expect(props.preferences.defaultAction).toBe('grammar');
    props.service = 'deepseek'; await tick(); expect(panel.effectiveDefaultAction).toBe('grammar');
  });
});

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
    panel.historyDetails.open = true;
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
    const viewport = Object.assign(panel.answerScroll, {scrollTop: 0, focus: vi.fn()});
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
    const viewport = Object.assign(panel.answerScroll, {scrollTop: 0});
    const body = Object.assign(panel.answerBody, {offsetTop: 40});
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
    const viewport = Object.assign(panel.answerScroll, {scrollTop: 0});
    Object.assign(panel.answerBody, {offsetTop: 80});
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
  const viewport = Object.assign(panel.answerScroll, {scrollTop: 120}); const body = Object.assign(panel.answerBody, {offsetTop: 100});
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


it.each(['word', 'note'] as const)('does not begin a %s write after its material capture outlives the panel', async kind => {
  const {panel, state, sendMessage, finish} = await mountPanel();
  finish('Completed explanation');
  await runtime.nextTick(); state.completeMaterialCapture.mockClear();
  let release!: () => void;
  state.beginMaterialCapture.mockReturnValueOnce(new Promise<void>(resolve => {release = resolve;}));
  const saving = kind === 'word' ? panel.saveWord() : panel.rememberLearning();
  unmount?.(); unmount = undefined;
  release(); await saving;
  expect(sendMessage.mock.calls.filter(([message]) => (message as any)?.action === 'upsert')).toEqual([]);
  expect(state.saveLearningMemory).not.toHaveBeenCalled();
  expect(state.completeMaterialCapture).not.toHaveBeenCalled();
});

it.each(['word', 'note'] as const)('does not begin a %s write if privacy changes while capturing its material', async kind => {
  const {panel, props, state, sendMessage, finish, tick} = await mountPanel();
  finish('Completed explanation');
  await runtime.nextTick(); state.completeMaterialCapture.mockClear();
  let release!: () => void;
  state.beginMaterialCapture.mockReturnValueOnce(new Promise<void>(resolve => {release = resolve;}));
  const saving = kind === 'word' ? panel.saveWord() : panel.rememberLearning();
  props.privateContext = true; await tick();
  release(); await saving;
  expect(sendMessage.mock.calls.filter(([message]) => (message as any)?.action === 'upsert')).toEqual([]);
  expect(state.saveLearningMemory).not.toHaveBeenCalled();
});

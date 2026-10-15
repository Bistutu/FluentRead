import {createRequire} from 'node:module'
import {dirname, resolve} from 'node:path'
import {compileVueInlineFixture} from './helpers/compiledVueFixture'
import {parseHTML} from 'linkedom'
import {createServer, type Plugin} from 'vite'
import {afterEach, describe, expect, it, vi} from 'vitest'
import type {Component, App} from 'vue'

type Tab = 'history' | 'memory'
type Namespace = {__esModule: true; default?: Component; HarnessReadingHistory?: Component}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {resolve = yes;reject = no})
  return {promise, resolve, reject}
}
const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  for (const stop of disposers.splice(0).reverse()) await stop()
  vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()
  delete (globalThis as Record<string, unknown>).__frLearningClient
})

// Local client compilation keeps the parent and child templates real without changing Vitest's
// global SFC transform. Only module loading and browser/config/presentation boundaries are ports.
async function mountLearning(initialTab?: string, options: {listGate?: Tab; browser?: string} = {}) {
  const {window, document} = parseHTML('<html><body></body></html>')
  for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event'])
    vi.stubGlobal(key, key === 'window' ? window : window[key as keyof typeof window])
  let focused: Element = document.body
  Object.defineProperty(document, 'activeElement', {configurable: true, get: () => focused})
  window.HTMLElement.prototype.focus = function () {focused = this}
  window.HTMLElement.prototype.blur = function () {focused = document.body}
  const frames = new Map<number, FrameRequestCallback>();let frame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {frames.set(++frame, callback);return frame})
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const runtime = createRequire(import.meta.url)('vue') as typeof import('vue')
  const language = runtime.ref('zh-CN'), shown = runtime.ref(true), props = runtime.reactive({initialTab})
  const configListeners = new Set<(value: any) => void>(), clientErrors: unknown[] = [], navigations: string[] = [], reloads: string[] = []
  const listGate = deferred<Record<string, unknown>>(), writeGate = deferred<Record<string, unknown>>()
  let pendingWrite = false, stopped = false, evaluating = true, heldList = options.listGate
  const memory = {id: '12345678-1234-4234-8234-123456789abc', kind: 'note', content: 'Synthetic retained note', createdAt: 1, updatedAt: 1}
  const session = {id: 'synthetic-session', text: 'Synthetic retained reading', intent: 'meaning', updatedAt: 1, turnCount: 1}
  const memories = [memory], sessions = [session]
  const send = vi.fn(async (message: Record<string, unknown>) => {
    if (message.action === 'memory-list') {
      if (heldList === 'memory') {heldList = undefined;return listGate.promise}
      return {success: true, memories: [...memories]}
    }
    if (message.action === 'sessions-list') {
      if (heldList === 'history') {heldList = undefined;return listGate.promise}
      return {success: true, sessions: [...sessions], hasMore: false}
    }
    if (message.action === 'memory-save') {
      const input = message.input as {content: string; kind: string}
      const saved = {...memory, ...input};memories.splice(0, memories.length, saved)
      return pendingWrite ? writeGate.promise : {success: true, memory: saved}
    }
    if (message.action === 'sessions-delete') {sessions.length = 0;return pendingWrite ? writeGate.promise : {success: true}}
    throw new Error(`Unexpected learning action ${String(message.action)}`)
  })
  ;(globalThis as Record<string, unknown>).__frLearningClient = {send}
  const mocks: Plugin = {name: 'learning-client-browser-port', enforce: 'pre', resolveId(id) {
    return id === 'webextension-polyfill' ? '\0learning-client-browser' : null
  }, load(id) {
    return id === '\0learning-client-browser' ? 'export default {runtime:{sendMessage:(...args)=>globalThis.__frLearningClient.send(...args)}};' : null
  }}
  const server = await createServer({root: process.cwd(), configFile: false, appType: 'custom', logLevel: 'silent',
    // 测试只加载模块并驱动 Vue 延迟，server 在 fake clock 期间无需观察文件。
    plugins: [mocks], resolve: {alias: {'@': resolve(process.cwd())}}, server: {middlewareMode: true, hmr: false, watch: null},
    ssr: {noExternal: ['webextension-polyfill']}})
  disposers.push(async () => {await server.close()})
  const {normalizeConfig} = await server.ssrLoadModule('/src/core/config/model.ts')
  const config = normalizeConfig({harness: {memoryEnabled: true}})
  const store = {config, configReady: Promise.resolve(), subscribeConfig: (listener: (value: typeof config) => void) => {
    configListeners.add(listener);return () => configListeners.delete(listener)
  }}
  const client = await server.ssrLoadModule('/src/features/reading-assistant/client.ts')
  const date = await server.ssrLoadModule('/src/ui/dateFormat.ts')
  const i18n = {useUiI18n: () => ({language, t: (key: string) => `${language.value}:${key}`, translateLegacy: (text: string) => text})}
  const display = runtime.defineComponent({setup: (_, {slots}) => () => runtime.h('span', slots.default?.())})
  const saved = runtime.defineComponent({setup: (_, {emit}) => () => runtime.h('section', {class: 'saved-display-port'},
    runtime.h('button', {onClick: () => emit('navigate', 'settings-data')}, 'Saved navigate'))})
  const materialMount = vi.fn()
  const material = runtime.defineComponent({setup: () => {materialMount();return () => runtime.h('section', {class: 'material-display-port'})}})
  const cache = new Map<string, Component>()
  const loads = {history: vi.fn(), memory: vi.fn()}
  const gates: Record<Tab, Array<ReturnType<typeof deferred<Namespace>>>> = {history: [], memory: []}
  const namespaces = {} as Record<Tab, Namespace>
  function load(tab: Tab): Namespace | Promise<Namespace> {
    loads[tab]()
    // Static old imports resolve immediately, so RED never hangs module evaluation.
    if (evaluating) return namespaces[tab]
    const gate = deferred<Namespace>();gates[tab].push(gate);return gate.promise
  }
  function compileClient(relative: string): Component {
    const filename = resolve(relative);if (cache.has(filename)) return cache.get(filename)!
    const compiled = compileVueInlineFixture(filename, {id: `learning-client-${cache.size}`});expect(compiled.parseErrors).toEqual([])
    const module = {exports: {} as {default: Component}}
    new Function('require', 'exports', 'module', compiled.code)((id: string) => {
      if (id === 'vue') return runtime
      if (id === '@/src/ui/i18n') return i18n
      if (id === '@/src/ui/dateFormat') return date
      if (id === '@/src/services/config/store') return store
      if (id === '@/src/platform/browser/capabilities') return {browserCapabilities: {browser: options.browser ?? 'chrome'}}
      if (id === '@/src/features/vocabulary/ui/public') return {VocabularyBook: saved, MaterialWorkspace: material}
      if (id === '@/src/features/reading-assistant/ui/public') return load('history')
      if (id === './LearningMemoryManager.vue') return load('memory')
      if (id === '@/src/features/reading-assistant/public' || id === '../client') return client
      if (id === './components/SegmentedControl.vue') return {default: compileClient(resolve(dirname(filename), id))}
      if (id === 'element-plus') return {ElMessageBox: {confirm: async () => undefined}, ElOption: display}
      if (id.includes('/style/')) return {}
      if (id.endsWith('.vue')) return {default: display}
      throw new Error(`Unexpected learning client dependency ${id}`)
    }, module.exports, module)
    cache.set(filename, module.exports.default);return module.exports.default
  }
  namespaces.memory = {__esModule: true, default: compileClient('src/features/settings/ui/LearningMemoryManager.vue')}
  namespaces.history = {__esModule: true, HarnessReadingHistory: compileClient('src/features/reading-assistant/ui/HarnessReadingHistory.vue')}
  const parent = compileClient('src/features/settings/ui/LearningCenter.vue');evaluating = false
  // Vite initializes/cleans up with real timers; only Vue's mounted async delay is controlled.
  vi.useFakeTimers()
  const renderer = runtime.createRenderer<Node, Element>({
    createElement: tag => document.createElement(tag), createText: text => document.createTextNode(text), createComment: text => document.createComment(text),
    insert: (node, parent, anchor) => parent.insertBefore(node, anchor ?? null), remove: node => node.parentNode?.removeChild(node),
    setText: (node, value) => {node.nodeValue = value}, setElementText: (element, value) => {element.textContent = value},
    parentNode: node => node.parentNode as Element | null, nextSibling: node => node.nextSibling,
    patchProp: (element, key, _before, value) => {
      if (key.startsWith('onUpdate:')) return
      if (/^on[A-Z]/u.test(key)) {
        const events = element as Element & {__learningEvents?: Map<string, EventListener>}
        const name = key.slice(2).toLowerCase();events.__learningEvents ??= new Map()
        const prior = events.__learningEvents.get(name);if (prior) element.removeEventListener(name, prior)
        if (value) {const handler: EventListener = event => {for (const fn of Array.isArray(value) ? value : [value]) fn(event)}
          events.__learningEvents.set(name, handler);element.addEventListener(name, handler)}
      } else if (key === 'value') (element as HTMLInputElement).value = value ?? ''
      else if (key.startsWith('aria-') && value != null) element.setAttribute(key, String(value))
      else if (value === null || value === undefined || value === false) element.removeAttribute(key)
      else element.setAttribute(key, value === true ? '' : String(value))
    }, setScopeId: (element, id) => element.setAttribute(id, ''), insertStaticContent: (content, parent, anchor) => {
      const container = document.createElement('div');container.innerHTML = content
      const first = container.firstChild!, last = container.lastChild!
      for (const child of [...container.childNodes]) parent.insertBefore(child, anchor)
      return [first, last]
    },
  })
  const otherPage = {render: () => null}, host = document.createElement('main');document.body.append(host)
  const app: App = renderer.createApp({setup: () => () => runtime.h(runtime.KeepAlive, null, {default: () => shown.value
    ? runtime.h(parent, {...props, onNavigate: (section: string) => navigations.push(section), onReload: (tab: string) => reloads.push(tab)}) : runtime.h(otherPage)})})
  app.config.errorHandler = error => clientErrors.push(error);app.config.warnHandler = () => undefined
  const settle = async () => {for (let i = 0; i < 12; i++) {await Promise.resolve();await runtime.nextTick()}}
  function stop() {if (!stopped) {stopped = true;app.unmount()}}
  disposers.push(async () => {stop();for (const tab of ['history', 'memory'] as const) for (const gate of gates[tab]) gate.resolve(namespaces[tab])
    listGate.resolve({success: true, memories: [], sessions: [], hasMore: false});writeGate.resolve({success: true, memory})
    await settle();frames.clear();host.remove()})
  app.mount(host);await settle()
  const choose = async (tab: 'saved' | Tab) => {host.querySelector<HTMLButtonElement>(`[data-option-index="${(options.browser === 'userscript' ? ['saved', 'history', 'memory'] : ['saved', 'materials', 'history', 'memory']).indexOf(tab)}"]`)!.click();await settle()}
  const resolvePanel = async (tab: Tab) => {gates[tab].at(-1)?.resolve(namespaces[tab]);await settle()}
  const actions = (action: string) => send.mock.calls.filter(([message]) => message.action === action)
  return {host, props, shown, language, loads, gates, namespaces, clientErrors, navigations, reloads, send, configListeners, config, materialMount,
    memories, sessions, memory, session, listGate, writeGate, settle, choose, resolvePanel, stop, actions,
    pendingWrite: () => {pendingWrite = true}, listReply: () => ({success: true, memories: [...memories], sessions: [...sessions], hasMore: false}),
    notifyMemory: (enabled: boolean) => {config.harness.memoryEnabled = enabled;for (const listener of configListeners) listener(normalizeConfig(config))},
    flushFrames: () => {for (const [id, callback] of [...frames]) {frames.delete(id);callback(0)}},
    key: (element: HTMLElement, key: string) => {element.focus();const event = new window.Event('keydown', {bubbles: true, cancelable: true});Object.assign(event, {key});element.dispatchEvent(event)},
  }
}

describe('LearningCenter actual client pane loading and lifetime', () => {
  it.each([undefined, 'materials'])('keeps userscript saved reachable for initial %s and omits the unsupported materials control', async initial => {
    const h = await mountLearning(initial, {browser: 'userscript'})
    expect(h.host.querySelectorAll('[role="radio"]')).toHaveLength(3)
    expect(h.host.querySelector('.saved-display-port')).not.toBeNull()
    expect(h.host.querySelector('.material-display-port')).toBeNull()
    expect(h.materialMount).not.toHaveBeenCalled()
    expect(h.host.querySelector('.fr-learning-center-header')!.textContent).not.toContain('阅读材料')
    h.host.querySelector<HTMLButtonElement>('.saved-display-port button')!.click()
    expect(h.navigations).toEqual(['settings-data'])
  })
  it('skips materials with userscript keyboard navigation and falls back to saved on a later materials route', async () => {
    const h = await mountLearning(undefined, {browser: 'userscript'})
    h.key(h.host.querySelector<HTMLElement>('[data-option-index="0"]')!, 'ArrowRight')
    await h.settle();await h.resolvePanel('history');h.flushFrames()
    expect(h.host.querySelector('.harness-history')).not.toBeNull()
    expect(h.host.querySelector('[data-option-index="1"][aria-checked="true"]')).not.toBeNull()
    expect(h.host.querySelectorAll('[role="radio"][tabindex="0"]')).toHaveLength(1)
    h.props.initialTab = 'materials';await h.settle()
    expect(h.host.querySelector('.saved-display-port')).not.toBeNull()
    expect(h.host.querySelector('[data-option-index="0"][aria-checked="true"]')).not.toBeNull()
    await h.choose('memory');await h.resolvePanel('memory')
    expect(h.host.querySelector('.fr-learning-memory')).not.toBeNull()
    h.props.initialTab = 'saved';await h.settle()
    h.props.initialTab = 'materials';await h.settle()
    expect(h.host.querySelector('.saved-display-port')).not.toBeNull()
    expect(h.materialMount).not.toHaveBeenCalled()
    expect(h.clientErrors).toEqual([])
  })
  it.each(['chrome', 'firefox'])('retains the extension materials direct entry and later route on %s', async browser => {
    const h = await mountLearning('materials', {browser})
    expect(h.host.querySelectorAll('[role="radio"]')).toHaveLength(4)
    expect(h.host.querySelector('.material-display-port')).not.toBeNull()
    expect(h.materialMount).toHaveBeenCalledOnce()
    h.props.initialTab = 'saved';await h.settle()
    expect(h.host.querySelector('.saved-display-port')).not.toBeNull()
    h.props.initialTab = 'materials';await h.settle()
    expect(h.host.querySelector('.material-display-port')).not.toBeNull()
    expect(h.materialMount).toHaveBeenCalledTimes(2)
  })
  it.each([undefined, 'invalid', 'saved'])('shows default saved for initial %s without loading other panes', async initial => {
    const h = await mountLearning(initial)
    expect(h.host.querySelector('.saved-display-port')).not.toBeNull()
    expect({history: h.loads.history.mock.calls.length, memory: h.loads.memory.mock.calls.length}).toEqual({history: 0, memory: 0})
  })
  it.each(['history', 'memory'] as const)('honors initial %s and loads only that module', async tab => {
    const h = await mountLearning(tab);expect(h.loads[tab]).toHaveBeenCalledOnce()
    expect(h.loads[tab === 'history' ? 'memory' : 'history']).not.toHaveBeenCalled()
    await h.resolvePanel(tab);expect(h.host.querySelector(tab === 'history' ? '.harness-history' : '.fr-learning-memory')).not.toBeNull()
  })
  it('uses real segmented keys and valid latest initialTab, retaining one tab stop and resolved modules', async () => {
    const h = await mountLearning();const saved = h.host.querySelector<HTMLElement>('[data-option-index="0"]')!
    h.key(saved, 'ArrowRight');await h.settle();h.flushFrames()
    expect(h.host.querySelector('[data-option-index="1"][aria-checked="true"]')).not.toBeNull()
    h.key(h.host.querySelector<HTMLElement>('[data-option-index="1"]')!, 'ArrowRight');await h.settle();await h.resolvePanel('history');h.flushFrames()
    expect(h.host.querySelector('[data-option-index="2"][aria-checked="true"]')).not.toBeNull()
    expect(h.host.querySelectorAll('[role="radio"][tabindex="0"]')).toHaveLength(1)
    h.props.initialTab = 'memory';await h.settle();await h.resolvePanel('memory')
    h.props.initialTab = 'invalid';await h.settle();expect(h.host.querySelector('.fr-learning-memory')).not.toBeNull()
    await h.choose('saved');await h.choose('history');expect(h.loads.history).toHaveBeenCalledOnce()
    expect(h.host.querySelector('.harness-history')).not.toBeNull()
  })
  it.each([['history', 'tab'], ['memory', 'tab'], ['history', 'unmount'], ['memory', 'unmount']] as const)
  ('does not mount pending %s after %s departure, including same-job resolution', async (tab, departure) => {
    const h = await mountLearning();await h.choose(tab)
    expect(h.actions(tab === 'memory' ? 'memory-list' : 'sessions-list')).toHaveLength(0)
    // Real queued resolve and parent v-if update, not a copied loader lifecycle algorithm.
    h.gates[tab].at(-1)!.resolve(h.namespaces[tab])
    if (departure === 'unmount') h.stop();else h.props.initialTab = 'saved'
    await h.settle();expect(h.actions(tab === 'memory' ? 'memory-list' : 'sessions-list')).toHaveLength(0)
    expect(h.host.querySelector(tab === 'memory' ? '.fr-learning-memory' : '.harness-history')).toBeNull()
  })
  it('passes latest false memory reference preference while pending and preserves actual note CRUD', async () => {
    const h = await mountLearning();await h.choose('memory');h.notifyMemory(false);await h.settle();await h.resolvePanel('memory')
    expect(h.host.querySelector('.fr-memory-options')!.textContent).toContain('learning.memoryDisabled')
    h.host.querySelector<HTMLButtonElement>('.fr-memory-heading button')!.click();await h.settle()
    const textarea = h.host.querySelector<HTMLTextAreaElement>('textarea')!;textarea.value = 'Explicit local note'
    textarea.dispatchEvent(new Event('input', {bubbles: true}));await h.settle()
    h.host.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));await h.settle()
    expect(h.actions('memory-save')).toHaveLength(1);expect(h.actions('memory-save')[0][0]).toEqual({type: 'fluentReadHarness', action: 'memory-save', input: {kind: 'note', content: 'Explicit local note'}})
    expect(h.host.querySelector('.fr-memory-list')!.textContent).toContain('Explicit local note')
  })
  it.each(['history', 'memory'] as const)('keeps late %s list and accepted writes with their real child owner', async tab => {
    const h = await mountLearning(tab, {listGate: tab});await h.resolvePanel(tab)
    expect(h.actions(tab === 'memory' ? 'memory-list' : 'sessions-list')).toHaveLength(1)
    await h.choose('saved');h.listGate.resolve(h.listReply());await h.settle()
    expect(h.host.querySelector('.saved-display-port')).not.toBeNull();expect(h.host.textContent).not.toContain('Synthetic retained')
    await h.choose(tab);await h.resolvePanel(tab);h.pendingWrite()
    if (tab === 'memory') {
      h.host.querySelector<HTMLButtonElement>('.fr-memory-heading button')!.click();await h.settle()
      const input = h.host.querySelector<HTMLTextAreaElement>('textarea')!;input.value = 'Accepted local note';input.dispatchEvent(new Event('input', {bubbles: true}));await h.settle()
      h.host.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))
    } else h.host.querySelector<HTMLButtonElement>('.harness-history-row [aria-label="删除这条阅读记录"]')!.click()
    await h.settle();expect(h.actions(tab === 'memory' ? 'memory-save' : 'sessions-delete')).toHaveLength(1)
    await h.choose('saved');h.writeGate.resolve({success: true, memory: h.memories[0]});await h.settle()
    expect(h.host.querySelector('.saved-display-port')).not.toBeNull();expect(h.host.querySelector('[role="alert"]')).toBeNull()
    await h.choose(tab);await h.resolvePanel(tab)
    if (tab === 'memory') expect(h.host.textContent).toContain('Accepted local note')
    else {expect(h.sessions).toEqual([]);expect(h.host.querySelector('.harness-history-row')).toBeNull()}
    expect(h.clientErrors).toEqual([])
  })
  it.each(['history', 'memory'] as const)('preserves Vue cached late %s mount and current props instead of inventing hidden zero IO', async tab => {
    const h = await mountLearning();await h.choose(tab);h.shown.value = false;h.notifyMemory(false);await h.settle()
    await h.resolvePanel(tab)
    expect(h.actions(tab === 'memory' ? 'memory-list' : 'sessions-list')).toHaveLength(1)
    expect(h.host.querySelector(tab === 'memory' ? '.fr-learning-memory' : '.harness-history')).toBeNull()
    h.shown.value = true;await h.settle()
    expect(h.host.querySelector(tab === 'memory' ? '.fr-learning-memory' : '.harness-history')).not.toBeNull()
    if (tab === 'memory') expect(h.host.querySelector('.fr-memory-options')!.textContent).toContain('learning.memoryDisabled')
    expect(h.clientErrors).toEqual([])
  })
  it.each(['history', 'memory'] as const)('shows %s delayed loading/error in current language and emits the current pane reload request', async tab => {
    const h = await mountLearning();await h.choose(tab)
    expect(h.host.querySelector('.fr-learning-load[role="status"]')).toBeNull()
    await vi.advanceTimersByTimeAsync(200);await h.settle()
    expect(h.host.querySelector('.fr-learning-load[role="status"]')!.textContent).toContain('zh-CN:common.loading')
    h.language.value = 'en';await h.settle();expect(h.host.querySelector('.fr-learning-load[role="status"]')!.textContent).toContain('en:common.loading')
    const failure = new Error('Owned synthetic module rejection');h.gates[tab].at(-1)!.reject(failure);await h.settle()
    expect(h.host.querySelector('.fr-learning-load[role="alert"]')!.textContent).toContain('en:learning.panelLoadError')
    expect(h.host.querySelector('.fr-learning-center-header')).not.toBeNull();expect(h.host.querySelector('.fr-learning-local')).not.toBeNull()
    h.host.querySelector<HTMLButtonElement>('.fr-learning-load[role="alert"] button')!.click()
    expect(h.reloads).toEqual([tab])
    // Document routing/reload and the browser's ESM failure cache are parent/native boundaries.
    expect(h.clientErrors).toEqual([failure]);await h.choose('saved');expect(h.host.querySelector('.fr-learning-load')).toBeNull()
  })
  it('keeps public header/footer navigation available and releases its config subscription on unmount', async () => {
    const h = await mountLearning();expect(h.configListeners.size).toBe(1)
    h.host.querySelector<HTMLButtonElement>('.fr-learning-local > button')!.click();expect(h.navigations).toEqual(['settings-data'])
    h.stop();expect(h.configListeners.size).toBe(0)
  })
})

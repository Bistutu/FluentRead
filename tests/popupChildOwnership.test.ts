/**
 * @file tests/popupChildOwnership.test.ts
 * 文件职责：执行 Popup 语言选择和首启根组件的实际客户端模板，验证旧事件与迟到加载的归属。
 * 主要内容：真实 Vue/KeepAlive 覆盖开关、源目标切换、外部值同步、关闭、失活、卸载、预加载和外观监听清理；首启根验证配对往返缓存恢复、已保存交接续接及普通退出不可复活；触屏语言列表执行真实视口订阅器，验证平移及键盘高度变化不替换选择器、关闭与失活取消队列，旧浮层回调不能写入新会话。
 * 模块边界：Element Plus、引导展示、浏览器 locale、模块加载和外观应用为受控端口；不声称真实浏览器焦点或语言持久化证据。
 */
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {parseHTML} from 'linkedom'
import {createServer, type ViteDevServer} from 'vite'
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc'
import ts from 'typescript'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {getMultilingualTargetLanguageLabel, options} from '@/src/core/config/catalog'

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue')
const selectPath = 'src/app/popup/PopupLanguageSelect.vue', onboardingPath = 'src/app/popup/PopupOnboarding.vue'
let server: ViteDevServer, app: import('vue').App | undefined, document: Document, win: any
let shown: import('vue').Ref<boolean>, source: Record<string, any>, state: Record<string, any>, componentProps: Record<string, any>, fixture: Record<string, any>
let mediaListeners: Set<() => void>, subscribers: Set<() => void>, events: Map<Element, Record<string, any>>, focused: Element | null
const updates = vi.fn(), appearance = vi.fn(), focus = vi.fn(), reload = vi.fn(), locale = vi.fn()
function deferred<T>() {let resolve!: (value: T) => void, reject!: (error: unknown) => void;const promise = new Promise<T>((yes, no) => {resolve = yes;reject = no});return {promise, resolve, reject}}
async function settle() {await runtime.nextTick();await Promise.resolve();await runtime.nextTick()}
async function drain() {for (let index = 0; index < 10; index += 1) await settle()}
function select() {return fixture.selects.at(-1)}
function onboarding() {return fixture.onboardings.at(-1)}
function handles(port: any) {return {...port.instance.vnode.props}}
async function open() {select().show(true);await settle()}
function eventOf(element: Element, name = 'onClick') {const callback = events.get(element)?.[name];expect(callback).toBeTypeOf('function');return callback}
function expectOneUpdate(value: string) {expect(updates).toHaveBeenCalledOnce();expect(updates).toHaveBeenCalledWith(value)}
function invalidate(reason: string) {
  if (reason === 'disabled') source.disabled = true
  if (reason === 'source') source.source = true
  if (reason === 'value') source.modelValue = 'fr'
  if (reason === 'cached') shown.value = false
  if (reason === 'pagehide') win.dispatchEvent(new win.Event('pagehide'))
  if (reason === 'unmount') app?.unmount()
}
function pageTransition(type: 'pagehide' | 'pageshow', persisted: boolean) {
  const event = new win.Event(type);Object.defineProperty(event, 'persisted', {value: persisted});win.dispatchEvent(event)
}
beforeEach(async () => {
  vi.clearAllMocks();app = undefined;events = new Map();mediaListeners = new Set();subscribers = new Set()
  const parsed = parseHTML('<html><body><div id="app"></div></body></html>');win = parsed.window;document = win.document;focused = document.body
  Object.defineProperty(document, 'activeElement', {configurable: true, get: () => focused})
  const media = {matches: false, addEventListener: (_name: string, callback: () => void) => mediaListeners.add(callback), removeEventListener: (_name: string, callback: () => void) => mediaListeners.delete(callback)}
  locale.mockReturnValue('en-GB')
  fixture = {runtime, selects: [], onboardings: [], locale, appearance, options, language: runtime.ref('zh-CN'),
    label: vi.fn(getMultilingualTargetLanguageLabel), config: runtime.reactive({interfaceSkin: 'default', interfaceFont: 'system', theme: 'auto'}),
    subscribe: (callback: () => void) => {subscribers.add(callback);callback();return () => subscribers.delete(callback)},
    selectBlur: vi.fn(), loadMain: vi.fn(async () => ({render: () => runtime.h('div', {'data-main-app': 'true'}, 'main')}))}
  fixture.importMain = () => fixture.loadMain().then((component: any) => ({default: component}))
  ;(globalThis as any).__popupChildFixture = fixture
  for (const [key, value] of Object.entries({document, window: win, HTMLElement: win.HTMLElement, Event: win.Event, Node: win.Node,
    navigator: {languages: ['ja-JP'], language: 'fr-FR'}, matchMedia: () => media, location: {reload}})) vi.stubGlobal(key, value)
  server = await createServer({root: process.cwd(), configFile: false, appType: 'custom', logLevel: 'silent',
    resolve: {alias: {'@': process.cwd()}}, optimizeDeps: {noDiscovery: true}, server: {hmr: false, middlewareMode: true}, ssr: {noExternal: ['element-plus', 'webextension-polyfill']}, plugins: [{name: 'popup-child-client', enforce: 'pre', resolveId(id) {
      if (/(?:\/|^)Popup(?:LanguageSelect|Onboarding)\.vue$/u.test(id)) return resolve('src/app/popup', id.split('/').at(-1)!) + '.child.ts'
      if (id.endsWith('/UiSelect.vue')) return '\0child-select'
      if (id.endsWith('/UiLanguageOnboarding.vue')) return '\0child-onboarding'
      if (id === 'element-plus') return '\0child-options'
      if (id === 'webextension-polyfill') return '\0child-browser'
      if (/\/src\/ui\/i18n(?:\.ts)?$/u.test(id)) return '\0child-i18n'
      if (/\/src\/core\/config\/catalog(?:\.ts)?$/u.test(id)) return '\0child-catalog'
      if (/\/src\/services\/config\/store(?:\.ts)?$/u.test(id)) return '\0child-config'
      if (/\/src\/ui\/interfaceAppearance(?:\.ts)?$/u.test(id)) return '\0child-appearance'
      return null
    }, load(id) {
      if (id.endsWith('.vue.child.ts')) {
        const filename = id.slice(0, -9), {descriptor} = parse(readFileSync(filename, 'utf8'), {filename})
        const script = compileScript(descriptor, {id: 'popup-child', inlineTemplate: false})
        const template = compileTemplate({source: descriptor.template!.content, filename, id: 'popup-child', compilerOptions: {bindingMetadata: script.bindings, cacheHandlers: true}})
        expect(template.errors).toEqual([])
        const controlledScript = script.content.replace(/import\(['"]\.\/PopupApp\.vue['"]\)/u, 'globalThis.__popupChildFixture.importMain()')
        return ts.transpileModule(controlledScript.replace('export default', 'const childComponent =') + '\n' + template.code + '\nchildComponent.render = render;export default childComponent;',
          {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText
      }
      if (id === '\0child-browser') return 'export default {i18n: {getUILanguage: globalThis.__popupChildFixture.locale}}'
      if (id === '\0child-i18n') return "const f = globalThis.__popupChildFixture;export const useUiI18n = () => ({language: f.language, t: key => key, translateLegacy: text => f.language.value === 'en-US' && text === '自动检测' ? 'Detect language' : text})"
      if (id === '\0child-catalog') return 'const f = globalThis.__popupChildFixture;export const options = f.options, getMultilingualTargetLanguageLabel = f.label'
      if (id === '\0child-config') return 'const f = globalThis.__popupChildFixture;export const config = f.config, subscribeConfig = f.subscribe'
      if (id === '\0child-appearance') return "const f = globalThis.__popupChildFixture;export const applyInterfaceSkin = value => f.appearance('skin', value), applyInterfaceFont = value => f.appearance('font', value), applyInterfaceTheme = value => f.appearance('theme', value)"
      if (id === '\0child-options') return "import {h} from 'vue';export const ElOption = {props: ['value', 'label'], setup: props => () => h('div', {'data-option': props.value}, props.label)}"
      if (id === '\0child-select') return "import {getCurrentInstance, h, ref} from 'vue';export default {inheritAttrs: false, setup(_, {attrs, slots, expose}) {const instance = getCurrentInstance(), opened = ref(false), show = value => {opened.value = value;instance.vnode.props.onVisibleChange(value)};expose({blur: () => {globalThis.__popupChildFixture.selectBlur();show(false)}});globalThis.__popupChildFixture.selects.push({instance, show});return () => h('section', {...attrs, 'data-select-port': 'true', tabindex: '0'}, [slots.label?.(), opened.value ? slots.default?.() : null, opened.value ? slots.footer?.() : null])}}"
      if (id === '\0child-onboarding') return "import {getCurrentInstance, h} from 'vue';export default {inheritAttrs: false, setup(_, {attrs}) {globalThis.__popupChildFixture.onboardings.push({instance: getCurrentInstance()});return () => h('section', {...attrs, 'data-onboarding-port': 'true'})}}"
      return null
    }}]})
})
afterEach(async () => {app?.unmount();await settle();await server?.close();delete (globalThis as any).__popupChildFixture;vi.unstubAllGlobals()})
async function mount(path: string, values: Record<string, any> = {}) {
  const component = (await server.ssrLoadModule('/' + path)).default;source = runtime.shallowReactive(values);shown = runtime.ref(true)
  const renderer = runtime.createRenderer({patchProp(element: any, key: string, _previous: any, next: any) {
    if (/^on[A-Z]/u.test(key)) {const listeners = events.get(element) || {};listeners[key] = next;events.set(element, listeners);return}
    if (key === 'class') {element.className = next ?? '';return}
    if (next === undefined || next === null || (next === false && !/^(?:aria-|data-)/u.test(key))) element.removeAttribute(key)
    else element.setAttribute(key, String(next))
  }, insert: (child: any, parent: any, anchor: any = null) => parent.insertBefore(child, anchor), remove: (child: any) => child.parentNode?.removeChild(child),
    createElement: tag => {const element = document.createElement(tag) as any;element.focus = () => {focused = element;focus()};return element},
    createText: value => document.createTextNode(value), createComment: value => document.createComment(value), setText: (node: any, value) => {node.nodeValue = value},
    setElementText: (element: any, value) => {element.textContent = value}, parentNode: (node: any) => node.parentNode, nextSibling: (node: any) => node.nextSibling,
    querySelector: value => document.querySelector(value), setScopeId: () => {}, cloneNode: (node: any) => node.cloneNode(true),
    insertStaticContent: (html, parent: any, anchor: any) => {const template = document.createElement('template');template.innerHTML = html;const first = template.content.firstChild!, last = template.content.lastChild!;parent.insertBefore(template.content, anchor);return [first, last]}})
  app = renderer.createApp({setup: () => () => runtime.h(runtime.KeepAlive, null, {default: () => shown.value
    ? runtime.h(component, {...source, 'onUpdate:modelValue': updates, ref: (vm: any) => {if (vm) {state = vm.$.setupState;componentProps = vm.$.props}}})
    : runtime.h({render: () => null}, {key: 'other'})})})
  app.config.warnHandler = () => {};app.mount(document.getElementById('app')!);await settle()
}

describe('PopupLanguageSelect 实际事件归属', () => {
  function touchViewport(coarse: boolean) {
    const viewport = Object.assign(document.createElement('div'), {width: 320, height: 600, offsetLeft: 0, offsetTop: 0});
    const frames = new Map<number, FrameRequestCallback>();let nextFrame = 0;
    Object.defineProperties(win, {visualViewport: {configurable: true, value: viewport},
      matchMedia: {configurable: true, value: () => ({matches: coarse})},
      requestAnimationFrame: {configurable: true, value: (callback: FrameRequestCallback) => {frames.set(++nextFrame, callback);return nextFrame}},
      cancelAnimationFrame: {configurable: true, value: (id: number) => frames.delete(id)}});
    const add = vi.spyOn(viewport, 'addEventListener'), remove = vi.spyOn(viewport, 'removeEventListener');
    return {viewport, frames, add, remove, flush: () => {const pending = [...frames.values()];frames.clear();for (const callback of pending) callback(0)}};
  }
  function viewportEffect() {
    const options = handles(select())['popper-options'];
    expect(options).toBeTruthy();
    return {options, effect: options.modifiers.find((modifier: {name: string}) => modifier.name === 'fluentreadPopupLanguageViewport').effect};
  }
  it.each(['coarse', 'android'])('%s 语言列表随可见高度及平移重算，关闭取消已排队更新并拒绝旧浮层写入', async mode => {
    const v = touchViewport(mode === 'coarse');if (mode === 'android') document.documentElement.setAttribute('data-fluentread-android-popup', '');
    await mount(selectPath, {modelValue: 'en'});await open();const first = select(), before = viewportEffect();
    const popper = document.createElement('div');popper.className = 'fluentread-popup-language-popper';
    const cleanup = before.effect({state: {elements: {popper}}});expect(popper.style.getPropertyValue('--fluentread-popup-language-height')).toBe('600px');
    v.viewport.height = 58;v.viewport.offsetTop = 240;v.viewport.dispatchEvent(new win.Event('resize'));v.viewport.dispatchEvent(new win.Event('scroll'));
    expect(v.frames.size).toBe(1);v.flush();await settle();const after = viewportEffect();cleanup();after.effect({state: {elements: {popper}}});
    expect(after.options).not.toBe(before.options);expect(popper.style.getPropertyValue('--fluentread-popup-language-height')).toBe('58px');
    expect(select() === first).toBe(true);expect(source.modelValue).toBe('en');expect(updates).not.toHaveBeenCalled();
    v.viewport.offsetTop = 250;v.viewport.dispatchEvent(new win.Event('scroll'));v.flush();await settle();expect(viewportEffect().options).not.toBe(after.options);
    const staleClose = eventOf(document.querySelector('.popup-language-close')!);
    v.viewport.dispatchEvent(new win.Event('resize'));expect(v.frames.size).toBe(1);staleClose();await settle();
    expect(fixture.selectBlur).toHaveBeenCalledOnce();expect(state.menuOpen).toBe(false);expect(v.frames.size).toBe(0);expect(document.querySelector('.popup-language-close')).toBeNull();
    for (const [name, listener] of v.add.mock.calls) expect(v.remove).toHaveBeenCalledWith(name, listener);
    popper.style.removeProperty('--fluentread-popup-language-height');before.effect({state: {elements: {popper}}});expect(popper.style.getPropertyValue('--fluentread-popup-language-height') ?? '').toBe('');
    await open();staleClose();await settle();expect(state.menuOpen).toBe(true);expect(fixture.selectBlur).toHaveBeenCalledOnce();
    handles(select())['onUpdate:modelValue']('de');expectOneUpdate('de');
  });
  it.each(['disabled', 'cached', 'pagehide', 'unmount'])('%s 释放触屏语言列表订阅，排队及迟到的浮层回调不再写入', async reason => {
    const v = touchViewport(true);await mount(selectPath, {modelValue: 'en'});await open();const old = viewportEffect();
    v.viewport.dispatchEvent(new win.Event('resize'));expect(v.frames.size).toBe(1);invalidate(reason);await settle();expect(v.frames.size).toBe(0);
    for (const [name, listener] of v.add.mock.calls) expect(v.remove).toHaveBeenCalledWith(name, listener);
    const popper = document.createElement('div');popper.className = 'fluentread-popup-language-popper';old.effect({state: {elements: {popper}}});
    expect(popper.style.getPropertyValue('--fluentread-popup-language-height') ?? '').toBe('');v.viewport.dispatchEvent(new win.Event('scroll'));expect(v.frames.size).toBe(0);expect(updates).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'source', 'value', 'cached', 'pagehide', 'unmount'])('%s 后拒绝捕获的选择及可见性事件', async reason => {
    await mount(selectPath, {modelValue: 'en'});await open();const old = handles(select());invalidate(reason);await settle()
    const before = state.menuOpen;old['onUpdate:modelValue']('de');old.onVisibleChange(!before);await settle();expect(updates).not.toHaveBeenCalled();expect(state.menuOpen).toBe(before)
  })
  it('禁用后立即重开不复活旧事件，新控件仍可选择', async () => {
    await mount(selectPath, {modelValue: 'en'});await open();const old = handles(select()), first = select();componentProps.disabled = true;componentProps.disabled = false;await settle()
    expect(select() === first).toBe(false);old['onUpdate:modelValue']('de');old.onVisibleChange(true);expect(updates).not.toHaveBeenCalled();expect(state.menuOpen).toBe(false)
    await open();handles(select())['onUpdate:modelValue']('de');expectOneUpdate('de')
  })
  it('关闭再打开不接受上一轮选项和关闭事件', async () => {
    await mount(selectPath, {modelValue: 'en'});await open();const old = handles(select());select().show(false);await settle();old['onUpdate:modelValue']('de');expect(updates).not.toHaveBeenCalled()
    await open();old['onUpdate:modelValue']('de');old.onVisibleChange(false);expect(updates).not.toHaveBeenCalled();expect(state.menuOpen).toBe(true)
    handles(select())['onUpdate:modelValue']('de');expectOneUpdate('de')
  })
  it('失活再激活只接受新会话', async () => {
    await mount(selectPath, {modelValue: 'en'});await open();const old = handles(select());shown.value = false;await settle();shown.value = true;await settle()
    old['onUpdate:modelValue']('de');expect(updates).not.toHaveBeenCalled();await open();handles(select())['onUpdate:modelValue']('de');expectOneUpdate('de')
  })
  it('目标不接受 auto、未知或重复值；源语言仍支持 auto', async () => {
    await mount(selectPath, {modelValue: 'en'});await open();const choose = handles(select())['onUpdate:modelValue'];choose('auto');choose('unknown');choose('en');expect(updates).not.toHaveBeenCalled()
    source.source = true;await settle();await open();handles(select())['onUpdate:modelValue']('auto');expectOneUpdate('auto')
  })
  it('外部值同步保留控件和焦点，源目标与界面语言更新标签；关闭列表不创建选项', async () => {
    await mount(selectPath, {modelValue: 'de'});expect(document.querySelectorAll('[data-option]')).toHaveLength(0);expect(document.querySelector('[data-select-port]')?.textContent).toContain('Deutsch')
    const control = document.querySelector('[data-select-port]') as HTMLElement;control.focus();const first = select();source.modelValue = 'fr';await settle()
    expect(select() === first).toBe(true);expect(focused === control).toBe(true);expect(focus).toHaveBeenCalledOnce();expect(control.getAttribute('title')).toContain('Français')
    fixture.language.value = 'en-US';await settle();expect(control.textContent).toContain('French');source.source = true;source.modelValue = 'auto';await settle();expect(document.querySelector('[data-select-port]')?.textContent).toContain('Detect language')
    await open();expect(document.querySelectorAll('[data-option]')).toHaveLength(options.from.length);expect(document.querySelectorAll('[data-option="auto"]')).toHaveLength(1)
  })
  it('开关菜单和选择值不重复翻译完整列表，界面语言变更才重算', async () => {
    await mount(selectPath, {modelValue: 'en'});fixture.label.mockClear();await open();expect(fixture.label).toHaveBeenCalledTimes(options.to.length)
    expect(handles(select())['popper-options']).toBeUndefined();expect(document.querySelector('.popup-language-close')).toBeNull();
    select().show(false);await settle();await open();expect(fixture.label).toHaveBeenCalledTimes(options.to.length)
    source.modelValue = 'fr';await settle();expect(fixture.label).toHaveBeenCalledTimes(options.to.length + 1)
    fixture.label.mockClear();fixture.language.value = 'en-US';await settle();expect(fixture.label).toHaveBeenCalledTimes(options.to.length + 1)
  })
})

describe('PopupOnboarding 实际预加载和生命周期', () => {
  it('locale 走浏览器值及异常回退；保存只预加载，确认共享一次加载再切主菜单', async () => {
    const loaded = deferred<any>();fixture.loadMain.mockReturnValue(loaded.promise);await mount(onboardingPath);expect(handles(onboarding())['initial-language']).toBe('en-US')
    const current = handles(onboarding());current.onSaved('en-US');await drain();expect(fixture.loadMain).toHaveBeenCalledOnce();expect(state.mainApp).toBeNull()
    const pending = current.onConfirmed('en-US');loaded.resolve({render: () => runtime.h('div', {'data-main-app': 'true'})});await pending;await drain()
    expect(fixture.loadMain).toHaveBeenCalledOnce();expect(document.querySelector('[data-main-app]')).not.toBeNull();expect(subscribers.size).toBe(0);expect(mediaListeners.size).toBe(0)
  })
  it('浏览器 locale 抛错时使用 navigator 的第一语言', async () => {
    locale.mockImplementation(() => {throw new Error('unavailable')});await mount(onboardingPath);expect(handles(onboarding())['initial-language']).toBe('ja-JP')
  })
  it.each(['cached', 'pagehide', 'unmount'])('%s 后迟到成功不挂主菜单，旧事件不启动加载或应用外观', async reason => {
    const loaded = deferred<any>();fixture.loadMain.mockReturnValue(loaded.promise);await mount(onboardingPath);const old = handles(onboarding()), appearanceBefore = [...subscribers, ...mediaListeners]
    const pending = old.onConfirmed('en-US');await drain();invalidate(reason);await settle();appearance.mockClear();for (const callback of appearanceBefore) callback()
    loaded.resolve({render: () => runtime.h('div', {'data-main-app': 'true'})});await pending;await drain()
    expect(state.mainApp).toBeNull();expect(appearance).not.toHaveBeenCalled();expect(subscribers.size).toBe(0);expect(mediaListeners.size).toBe(0)
    old.onSaved('en-US');await old.onConfirmed('en-US');expect(state.mainApp).toBeNull()
  })
  it.each(['cached', 'pagehide', 'unmount'])('%s 后迟到失败不显示错误或允许重载', async reason => {
    const loaded = deferred<any>();fixture.loadMain.mockReturnValue(loaded.promise);await mount(onboardingPath);const old = handles(onboarding()), pending = old.onConfirmed('en-US');await drain()
    invalidate(reason);await settle();loaded.reject(new Error('import failed'));await pending;await drain();expect(state.loadFailed).toBe(false);expect(reload).not.toHaveBeenCalled()
  })
  it.each(['cached', 'pagehide', 'unmount'])('%s 后还未启动加载的旧 saved/confirmed 无效', async reason => {
    await mount(onboardingPath);const old = handles(onboarding());invalidate(reason);await settle();old.onSaved('en-US');await old.onConfirmed('en-US');await drain();expect(fixture.loadMain).not.toHaveBeenCalled()
  })
  it('已确认交接在失活后仍拒绝旧事件，重新激活只采用当前上下文', async () => {
    const loaded = deferred<any>();fixture.loadMain.mockReturnValue(loaded.promise);await mount(onboardingPath)
    fixture.config.uiLanguageSetupCompleted = true
    const old = handles(onboarding()), pending = old.onConfirmed('en-US');await drain()
    shown.value = false;await settle();loaded.resolve({render: () => runtime.h('div', {'data-main-app': 'true'})});await pending;await drain()
    await old.onConfirmed('en-US');expect(state.mainApp).toBeNull();expect(fixture.loadMain).toHaveBeenCalledOnce()
    shown.value = true;await drain();expect(document.querySelector('[data-main-app]')).not.toBeNull()
    await old.onConfirmed('en-US');expect(fixture.loadMain).toHaveBeenCalledOnce();expect(subscribers.size).toBe(0);expect(mediaListeners.size).toBe(0)
  })
  it.each(['pending', 'loaded'])('已保存的语言交接在缓存期间 %s，恢复后复用模块且不要求再次保存', async phase => {
    const loaded = deferred<any>();fixture.loadMain.mockReturnValue(loaded.promise);await mount(onboardingPath)
    fixture.config.uiLanguage = 'ja-JP';fixture.config.uiLanguageSetupCompleted = true
    const current = handles(onboarding());current.onSaved('ja-JP');const pending = current.onConfirmed('ja-JP');await drain()
    expect(document.querySelector('[data-onboarding-port]')).toBeNull()
    shown.value = false;await settle()
    if (phase === 'loaded') {loaded.resolve({render: () => runtime.h('div', {'data-main-app': 'true'})});await pending;await drain();expect(state.mainApp).toBeNull()}
    shown.value = true;await drain()
    if (phase === 'pending') {loaded.resolve({render: () => runtime.h('div', {'data-main-app': 'true'})});await pending;await drain()}
    expect(document.querySelector('[data-main-app]')).not.toBeNull();expect(fixture.loadMain).toHaveBeenCalledOnce()
    expect(fixture.config.uiLanguage).toBe('ja-JP');expect(fixture.config.uiLanguageSetupCompleted).toBe(true)
    expect(document.querySelector('[data-onboarding-port]')).toBeNull()
  })
  it('persisted hide/show 配对恢复同一根的当前引导，重复恢复不复活旧回调或重复订阅', async () => {
    await mount(onboardingPath);const root=state,first=onboarding(),old=handles(first)
    pageTransition('pageshow',true);await drain();expect(onboarding()).toBe(first)
    for(let cycle=0;cycle<2;cycle++){
      const inactive=handles(onboarding())
      pageTransition('pagehide',true);await drain();expect(state.pageExited).toBe(true)
      expect(subscribers.size).toBe(0);expect(mediaListeners.size).toBe(0)
      inactive.onSaved('en-US');await inactive.onConfirmed('en-US');expect(fixture.loadMain).not.toHaveBeenCalled()
      pageTransition('pageshow',false);await drain();expect(state.pageExited).toBe(true);expect(subscribers.size).toBe(0)
      pageTransition('pageshow',true);await drain();expect(state).toBe(root);expect(state.pageExited).toBe(false)
      expect(onboarding()).not.toBe(first);expect(subscribers.size).toBe(1);expect(mediaListeners.size).toBe(1)
      const current=onboarding();pageTransition('pageshow',true);await drain();expect(onboarding()).toBe(current)
      old.onSaved('en-US');await old.onConfirmed('en-US');expect(fixture.loadMain).not.toHaveBeenCalled()
    }
    handles(onboarding()).onSaved('en-US');await drain();expect(fixture.loadMain).toHaveBeenCalledOnce();expect(state.mainApp).toBeNull()
  })
  it.each(['pending','loaded'])('已保存已确认的主菜单在 persisted 隐藏期间 %s，恢复新上下文才交接且只加载一次', async phase => {
    const loaded=deferred<any>();fixture.loadMain.mockReturnValue(loaded.promise);await mount(onboardingPath)
    fixture.config.uiLanguage='ja-JP';fixture.config.uiLanguageSetupCompleted=true
    const old=handles(onboarding());old.onSaved('ja-JP');const pending=old.onConfirmed('ja-JP');await drain()
    pageTransition('pagehide',true);await drain();expect(state.mainApp).toBeNull();expect(subscribers.size).toBe(0)
    if(phase==='loaded'){loaded.resolve({render:()=>runtime.h('div',{'data-main-app':'true'})});await pending;await drain();expect(state.mainApp).toBeNull()}
    old.onSaved('ja-JP');await old.onConfirmed('ja-JP');expect(fixture.loadMain).toHaveBeenCalledOnce()
    pageTransition('pageshow',true);await drain()
    if(phase==='pending'){loaded.resolve({render:()=>runtime.h('div',{'data-main-app':'true'})});await pending;await drain()}
    expect(document.querySelector('[data-main-app]')).not.toBeNull();expect(fixture.loadMain).toHaveBeenCalledOnce()
    expect(fixture.config.uiLanguage).toBe('ja-JP');expect(fixture.config.uiLanguageSetupCompleted).toBe(true)
    expect(subscribers.size).toBe(0);expect(mediaListeners.size).toBe(0)
  })
  it('普通 pagehide 后的 persisted hide/show 不复活引导或已确认的迟到加载', async () => {
    const loaded=deferred<any>();fixture.loadMain.mockReturnValue(loaded.promise);await mount(onboardingPath)
    fixture.config.uiLanguageSetupCompleted=true;const old=handles(onboarding()),pending=old.onConfirmed('en-US');await drain()
    pageTransition('pagehide',false);await drain();pageTransition('pagehide',true);pageTransition('pageshow',true)
    loaded.resolve({render:()=>runtime.h('div',{'data-main-app':'true'})});await pending;await drain()
    old.onSaved('en-US');await old.onConfirmed('en-US');expect(state.pageExited).toBe(true);expect(state.mainApp).toBeNull()
    expect(fixture.loadMain).toHaveBeenCalledOnce();expect(subscribers.size).toBe(0);expect(mediaListeners.size).toBe(0)
  })
  it('persisted 隐藏后卸载清理 paired 监听，随后恢复不挂载已完成的交接', async () => {
    // Linkedom 的 window 代理没有方法描述符，包装真实事件端口以保留派发和清理断言。
    const add=vi.fn(win.addEventListener.bind(win)),remove=vi.fn(win.removeEventListener.bind(win)),loaded=deferred<any>()
    win.addEventListener=add;win.removeEventListener=remove
    fixture.loadMain.mockReturnValue(loaded.promise);await mount(onboardingPath);fixture.config.uiLanguageSetupCompleted=true
    const old=handles(onboarding()),pending=old.onConfirmed('en-US');await drain();pageTransition('pagehide',true);await drain()
    app?.unmount();app=undefined;pageTransition('pageshow',true)
    loaded.resolve({render:()=>runtime.h('div',{'data-main-app':'true'})});await pending;await drain()
    expect(state.mainApp).toBeNull();expect(subscribers.size).toBe(0);expect(mediaListeners.size).toBe(0)
    for(const type of ['pagehide','pageshow']){
      const listener=add.mock.calls.find(call=>call[0]===type)?.[1];expect(listener).toBeTypeOf('function');expect(remove).toHaveBeenCalledWith(type,listener)
    }
  })
  it('加载失败的明确重载保持终止，不接受随后 persisted 恢复或旧重试', async () => {
    fixture.loadMain.mockRejectedValue(new Error('import failed'));await mount(onboardingPath);await handles(onboarding()).onConfirmed('en-US');await drain()
    const retry=eventOf(document.querySelector('.onboarding-load-error button')!);retry();expect(reload).toHaveBeenCalledOnce()
    pageTransition('pagehide',true);pageTransition('pageshow',true);await drain();retry()
    expect(reload).toHaveBeenCalledOnce();expect(state.pageExited).toBe(true);expect(subscribers.size).toBe(0);expect(mediaListeners.size).toBe(0)
  })
  it('当前导入失败显示双语错误，重试只重载一次；失活后的旧重试无效', async () => {
    fixture.loadMain.mockRejectedValue(new Error('import failed'));await mount(onboardingPath);await handles(onboarding()).onConfirmed('en-US');await drain()
    expect(state.loadFailed).toBe(true);expect(document.querySelector('[role="alert"]')?.textContent).toContain('The menu could not be loaded')
    const retry = eventOf(document.querySelector('.onboarding-load-error button')!);shown.value = false;await settle();retry();expect(reload).not.toHaveBeenCalled()
    shown.value = true;await settle();const current = eventOf(document.querySelector('.onboarding-load-error button')!);current();current();expect(reload).toHaveBeenCalledOnce()
  })
  it('首启外观跟随配置及深色媒体，卸载清理全部订阅', async () => {
    await mount(onboardingPath);expect(appearance.mock.calls).toEqual([['skin', 'default'], ['font', 'system'], ['theme', false], ['skin', 'default'], ['font', 'system'], ['theme', false]])
    appearance.mockClear();fixture.config.theme = 'dark';for (const callback of subscribers) callback();expect(appearance).toHaveBeenCalledWith('theme', true)
    appearance.mockClear();for (const callback of mediaListeners) callback();expect(appearance).toHaveBeenCalledWith('theme', true)
    app?.unmount();expect(subscribers.size).toBe(0);expect(mediaListeners.size).toBe(0)
  })
})

/**
 * @file tests/uiLanguageSelectorLifecycle.test.ts
 * 文件职责：执行实际语言选择器的客户端模板，验证存储等待、菜单事件和 Vue 生命周期归属。
 * 主要内容：保留真实 Vue/KeepAlive、模板事件和语言规则，存储提交/回滚与 Element Plus 控件事件为可控端口。
 * 模块边界：不调用浏览器或真实存储，不证明 CSS 动画、Element Plus Teleport 或操作系统焦点；每项清理计时器与组件。
 */
import {parseHTML} from 'linkedom'
import * as Vue from 'vue'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as languageRules from '@/src/core/i18n/language'

let app: Vue.App | undefined, document: Document, win: any, shown: Vue.Ref<boolean>, source: Record<string, any>, state: Record<string, any>
let focused: Element | null, events: Map<Element, Record<string, any>>, controls: any[], port: Record<string, any>
const focus = vi.fn(), saved = vi.fn(), confirmed = vi.fn(), setLanguage = vi.fn()
let language: Vue.Ref<languageRules.UiLanguage>, stored: languageRules.UiLanguage, requests: Array<{value: languageRules.UiLanguage; gate: ReturnType<typeof deferred<void>>}>
function deferred<T>() {let resolve!: (value: T) => void, reject!: (error: unknown) => void;const promise = new Promise<T>((yes, no) => {resolve = yes;reject = no});return {promise, resolve, reject}}
async function settle() {await Vue.nextTick();await Promise.resolve();await Vue.nextTick()}
function button(selector: string) {const element = document.querySelector(selector);expect(Boolean(element), selector).toBe(true);return element!}
function invalidate(reason: string) {if (reason === 'cached') shown.value = false;if (reason === 'pagehide') win.dispatchEvent(new win.Event('pagehide'));if (reason === 'unmount') {app?.unmount();app = undefined}}
vi.mock('vue', async importOriginal => {
  const actual = await importOriginal<typeof import('vue')>()
  return {...actual, Transition: actual.defineComponent({inheritAttrs:false,setup:(_:unknown,{attrs,slots}:any)=>()=>actual.h('div',{...attrs,'data-transition':'true'},slots.default?.())})}
})
beforeEach(() => {
  vi.doMock('element-plus',()=>({ElOption:{props:['value','label'],setup:(props:any,{slots}:any)=>()=>Vue.h('div',{'data-option':props.value,'data-label':props.label},slots.default?.())}}))
  vi.doMock('@/src/ui/components/UiSelect.vue',()=>({__esModule:true,default:{inheritAttrs:false,setup:(_:unknown,{attrs,slots}:any)=>{controls.push({instance:Vue.getCurrentInstance()!});return()=>Vue.h('section',{...attrs,'data-control':'true',tabindex:'0'},slots.default?.())}}}))
  vi.resetModules();vi.doMock('@/src/core/i18n',()=>port.rules)
  vi.doMock('@/src/ui/i18n',()=>({useUiI18n:()=>({language,setLanguage,t:(key:string)=>key})}))
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});vi.clearAllMocks();app = undefined;events = new Map();controls = [];requests = []
  const parsed = parseHTML('<html><body><div id="app"></div></body></html>');win = parsed.window;document = win.document;focused = document.body
  Object.defineProperty(document, 'activeElement', {configurable: true, get: () => focused})
  for (const [key, value] of Object.entries({document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event})) vi.stubGlobal(key, value)
  stored = 'zh-CN';language = Vue.ref(stored);port = {rules: {...languageRules, getUiLanguageDisplayLabel: vi.fn(languageRules.getUiLanguageDisplayLabel)},
    addListener: vi.fn(win.addEventListener.bind(win)), removeListener: vi.fn(win.removeEventListener.bind(win))}
  // 保留 linkedom 的事件派发，只用可观测端口记录监听器身份。
  vi.stubGlobal('window', {addEventListener: port.addListener, removeEventListener: port.removeListener})
  setLanguage.mockImplementation(async (value: languageRules.UiLanguage) => {
    const previous = language.value, gate = deferred<void>();requests.push({value, gate});language.value = value
    try {await gate.promise;stored = value} catch (error) {language.value = previous;throw error}
  })
})
afterEach(async () => {app?.unmount();await settle();vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals()})
async function mount(values: Record<string, any> = {}) {
  const component = (await import('@/src/ui/components/UiLanguageSelector.vue')).default;source = Vue.shallowReactive(values);shown = Vue.ref(true)
  const renderer = Vue.createRenderer({patchProp(element: any, key: string, _previous: any, next: any) {
    if (/^on[A-Z]/u.test(key)) {const handlers = events.get(element) || {};handlers[key] = next;events.set(element, handlers);return}
    if (key === 'class') {element.className = next ?? '';return}
    if (next === undefined || next === null || (next === false && !/^(?:aria-|data-)/u.test(key))) element.removeAttribute(key);else element.setAttribute(key, String(next))
  }, insert: (child: any, parent: any, anchor: any = null) => parent.insertBefore(child, anchor), remove: (child: any) => {if (child === focused || child.contains?.(focused)) focused = document.body;child.parentNode?.removeChild(child)},
    createElement: tag => {const element = Vue.markRaw(document.createElement(tag)) as any;element.focus = (options: unknown) => {focused = element;focus(element, options)};return element},
    createText: value => document.createTextNode(value), createComment: value => document.createComment(value), setText: (node: any, value) => {node.nodeValue = value},
    setElementText: (element: any, value) => {element.textContent = value}, parentNode: (node: any) => node.parentNode, nextSibling: (node: any) => node.nextSibling,
    querySelector: value => document.querySelector(value), setScopeId: () => {}, cloneNode: (node: any) => node.cloneNode(true),
    insertStaticContent: (html, parent: any, anchor: any) => {const template = document.createElement('template');template.innerHTML = html;const first = template.content.firstChild!, last = template.content.lastChild!;parent.insertBefore(template.content, anchor);return [first, last]}})
  app = renderer.createApp({setup: () => () => Vue.h(Vue.KeepAlive, null, {default: () => shown.value
    ? Vue.h(component as Vue.Component, {...source, onSaved: saved, onConfirmed: confirmed, ref: (vm: any) => {if (vm) {state = vm.$.setupState}}})
    : Vue.h({render: () => null}, {key: 'other'})})})
  app.config.warnHandler = () => {};app.mount(document.getElementById('app')!);await settle()
}

function control() {return controls.at(-1)}
function handles() {return {...control().instance.vnode.props}}
async function open() {const current = handles();current.onVisibleChange?.(true);await settle()}
async function change(value: unknown) {return handles().onChange(value)}

describe('UiLanguageSelector 实际选择与保存归属', () => {
  it('所有注册语言均能持久化，外部语言同步刷新全部选项名称', async () => {
    await mount()
    for (const option of languageRules.UI_LANGUAGE_OPTIONS) {
      language.value = option.value === 'zh-CN' ? 'en-US' : 'zh-CN';await settle();await open();const pending = change(option.value);requests.at(-1)!.gate.resolve();await pending;await settle();expect(stored).toBe(option.value)
      for (const displayed of languageRules.UI_LANGUAGE_OPTIONS) expect(button(`[data-option="${displayed.value}"]`).getAttribute('data-label')).toBe(languageRules.getUiLanguageDisplayLabel(displayed.value, option.value))
    }
    expect(setLanguage).toHaveBeenCalledTimes(languageRules.UI_LANGUAGE_OPTIONS.length)
  })
  it('卸载清理同一个 pagehide 监听器', async () => {
    const add = port.addListener, remove = port.removeListener;await mount()
    const listener = add.mock.calls.find((call: unknown[]) => call[0] === 'pagehide')?.[1];expect(listener).toBeTypeOf('function');invalidate('unmount');expect(remove).toHaveBeenCalledWith('pagehide', listener)
  })

  it('支持所有注册语言，默认和 compact 文案、标题、标签同步', async () => {
    await mount();expect(document.querySelectorAll('[data-option]')).toHaveLength(languageRules.UI_LANGUAGE_OPTIONS.length);expect(button('.ui-language-label').textContent).toBe('language.selectorLabel')
    for (const option of languageRules.UI_LANGUAGE_OPTIONS) expect(button(`[data-option="${option.value}"]`).getAttribute('data-label')).toBe(languageRules.getUiLanguageDisplayLabel(option.value, 'zh-CN'))
    source.compact = true;await settle();expect(document.querySelector('.ui-language-label')).toBeNull();expect(button('[data-control]').getAttribute('aria-label')).toBe('language.selectorLabel')
    language.value = 'fr-FR';await settle();expect(button('[data-option="en-US"]').getAttribute('data-label')).toBe(languageRules.getUiLanguageDisplayLabel('en-US', 'fr-FR'))
  })
  it('等待提交时控件禁用，同 tick 的旧变更只保存一次', async () => {
    await mount();await open();const choose = handles().onChange, pending = choose('en-US');const second = choose('ja-JP');await settle();const locked = button('[data-control]').hasAttribute('disabled')
    for (const request of requests) request.gate.resolve();await pending;await second;await settle();expect(locked).toBe(true);expect(setLanguage).toHaveBeenCalledOnce();expect(stored).toBe('en-US');expect(button('[data-control]').hasAttribute('disabled')).toBe(false)
  })
  it('未知、非字符串和重复值不提交', async () => {
    await mount();await open();for (const value of ['xx-XX', null, 7, ['en-US'], 'zh-CN']) {const pending = change(value);requests.at(-1)?.gate.resolve();await pending;await settle();await open()}
    expect(setLanguage).not.toHaveBeenCalled();expect(stored).toBe('zh-CN')
  })
  it.each(['cached', 'pagehide', 'unmount', 'inactive', 'disabled'])('%s 后旧 change 和可见性事件都无效', async reason => {
    await mount();await open();const old = handles();if (reason === 'inactive') source.active = false;else if (reason === 'disabled') source.disabled = true;else invalidate(reason);await settle();old.onVisibleChange?.(true);const pending = old.onChange('en-US');for (const request of requests) request.gate.resolve();await pending;await settle();expect(setLanguage).not.toHaveBeenCalled()
  })
  it.each(['cached', 'pagehide', 'unmount', 'inactive'])('%s 后保存失败，不留下过期错误；进行中的存储允许完成', async reason => {
    await mount();await open();const pending = change('en-US');if (reason === 'inactive') source.active = false;else invalidate(reason);await settle();requests[0].gate.reject(new Error('storage failed'));await pending;await settle();expect(state.errorMessage).toBe('');expect(stored).toBe('zh-CN')
  })
  it('失败显示可访问错误并允许新会话重试，成功消除错误', async () => {
    await mount();await open();const pending = change('en-US');requests[0].gate.reject(new Error('storage failed'));await pending;await settle();expect(button('[role="status"]').textContent).toBe('language.saveFailed');expect(language.value).toBe('zh-CN');expect(stored).toBe('zh-CN')
    await open();const retry = change('en-US');await settle();expect(document.querySelector('[role="status"]')).toBeNull();requests[1].gate.resolve();await retry;await settle();expect(stored).toBe('en-US');expect(document.querySelector('[role="status"]')).toBeNull()
  })
  it('失活再开仍锁定未完成保存，不复活旧回调；完成后新选择有效', async () => {
    await mount();await open();const old = handles(), pending = old.onChange('en-US');shown.value = false;await settle();shown.value = true;await settle();expect(button('[data-control]').hasAttribute('disabled')).toBe(true);const stale = old.onChange('ja-JP');for (const request of requests) request.gate.resolve();await pending;await stale;await settle();expect(setLanguage).toHaveBeenCalledOnce();expect(stored).toBe('en-US')
    await open();const current = change('ja-JP');requests.at(-1)!.gate.resolve();await current;await settle();expect(stored).toBe('ja-JP')
  })
  it('菜单关闭重开和外部语言变化都不复活旧选择', async () => {
    await mount();await open();const old = handles();handles().onVisibleChange?.(false);await settle();await open();language.value = 'fr-FR';await settle();const pending = old.onChange('en-US');for (const request of requests) request.gate.resolve();await pending;expect(setLanguage).not.toHaveBeenCalled();expect(language.value).toBe('fr-FR')
  })
  it('正常语言同步和 compact 切换保留控件与焦点，标签仅随语言重算一次', async () => {
    await mount();const first = control(), element = button('[data-control]') as HTMLElement;element.focus();port.rules.getUiLanguageDisplayLabel.mockClear();source.compact = true;await settle();await open()
    expect(port.rules.getUiLanguageDisplayLabel).not.toHaveBeenCalled();language.value = 'en-US';await settle();expect(port.rules.getUiLanguageDisplayLabel).toHaveBeenCalledTimes(languageRules.UI_LANGUAGE_OPTIONS.length)
    expect(control() === first).toBe(true);expect(focused === element).toBe(true);expect(focus).toHaveBeenCalledOnce()
  })
})

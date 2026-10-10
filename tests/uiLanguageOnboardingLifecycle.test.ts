/**
 * @file tests/uiLanguageOnboardingLifecycle.test.ts
 * 文件职责：执行实际语言组件的缓存客户端模板，验证存储等待、旧回调和 Vue 生命周期归属。
 * 主要内容：保留真实 Vue/KeepAlive、模板事件和语言规则，验证七语单一 Tab 入口、循环键盘预览及确认后保存；存储提交/回滚、焦点与过渡完成为可控端口。
 * 模块边界：不调用浏览器或真实存储，不证明 CSS 动画、Element Plus Teleport 或操作系统焦点；每项清理计时器与组件。
 */
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {parseHTML} from 'linkedom'
import * as Vue from 'vue'
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc'
import ts from 'typescript'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as languageRules from '@/src/core/i18n/language'
import * as onboardingMessages from '@/src/core/i18n/messages/onboarding'
import {useSettingsActionContext} from '@/src/features/settings/model/useSettingsActionContext'

const componentPath = 'src/ui/components/UiLanguageOnboarding.vue'
let app: Vue.App | undefined, document: Document, win: any, shown: Vue.Ref<boolean>, source: Record<string, any>, componentProps: Record<string, any>, state: Record<string, any>
let focused: Element | null, events: Map<Element, Record<string, any>>, controls: any[], port: Record<string, any>
const focus = vi.fn(), saved = vi.fn(), confirmed = vi.fn(), setLanguage = vi.fn()
let language: Vue.Ref<languageRules.UiLanguage>, stored: languageRules.UiLanguage, requests: Array<{value: languageRules.UiLanguage; gate: ReturnType<typeof deferred<void>>}>
function deferred<T>() {let resolve!: (value: T) => void, reject!: (error: unknown) => void;const promise = new Promise<T>((yes, no) => {resolve = yes;reject = no});return {promise, resolve, reject}}
async function settle() {await Vue.nextTick();await Promise.resolve();await Vue.nextTick()}
function callback(element: Element, name = 'onClick') {const action = events.get(element)?.[name];expect(action, name).toBeTypeOf('function');return action}
function button(selector: string) {const element = document.querySelector(selector);expect(Boolean(element), selector).toBe(true);return element!}
function invalidate(reason: string) {if (reason === 'cached') shown.value = false;if (reason === 'pagehide') win.dispatchEvent(new win.Event('pagehide'));if (reason === 'unmount') {app?.unmount();app = undefined}}
function compile() {
  const filename = resolve(componentPath), sourceFile = process.env.FLUENTREAD_UI_LANGUAGE_TEST_SOURCE_DIR
    ? resolve(process.env.FLUENTREAD_UI_LANGUAGE_TEST_SOURCE_DIR, componentPath.split('/').at(-1)!) : filename
  const {descriptor} = parse(readFileSync(sourceFile, 'utf8'), {filename})
  const script = compileScript(descriptor, {id: 'language-lifecycle', inlineTemplate: false}), imports = ts.createSourceFile(filename + '.ts', script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const bindings: Record<string, unknown> = {}, modules: Record<string, any> = {'vue': Vue, '@/src/core/i18n': port.rules,
    '@/src/ui/i18n': {useUiI18n: () => ({language, setLanguage, t: (key: string) => key})},
    '@/src/features/settings/model/useSettingsActionContext': {useSettingsActionContext}, '@/src/core/i18n/messages/onboarding': onboardingMessages,
    '@/src/core/i18n/messages/brand-taglines.json': {default: JSON.parse(readFileSync(resolve('src/core/i18n/messages/brand-taglines.json'), 'utf8'))},
    'element-plus': {ElOption: {props: ['value', 'label'], setup: (props: any, {slots}: any) => () => Vue.h('div', {'data-option': props.value, 'data-label': props.label}, slots.default?.())}},
    './UiSelect.vue': {default: {inheritAttrs: false, setup(_props: unknown, {attrs, slots}: any) {const instance = Vue.getCurrentInstance()!;controls.push({instance});return () => Vue.h('section', {...attrs, 'data-control': 'true', tabindex: '0'}, slots.default?.())}}}}
  for (const node of imports.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause || node.importClause.isTypeOnly) continue
    const module = modules[(node.moduleSpecifier as ts.StringLiteral).text];expect(Boolean(module), node.getText()).toBe(true)
    if (node.importClause.name) bindings[node.importClause.name.text] = module.default
    const named = node.importClause.namedBindings
    if (named && ts.isNamedImports(named)) for (const item of named.elements) if (!item.isTypeOnly) bindings[item.name.text] = module[item.propertyName?.text || item.name.text]
  }
  const code = ts.transpileModule(script.content, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}, transformers: {before: [context => file => {
    const visit: ts.Visitor = node => {
      if (ts.isImportDeclaration(node)) return undefined
      if (ts.isExportAssignment(node)) return ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList([ts.factory.createVariableDeclaration('component', undefined, undefined, node.expression)], ts.NodeFlags.Const))
      return ts.visitEachChild(node, visit, context)
    }
    return ts.visitEachChild(file, visit, context)
  }]}}).outputText.replace(/export\s*\{\s*\};?/gu, '')
  const component = new Function(...Object.keys(bindings), code + '\nreturn component;')(...Object.values(bindings))
  const template = compileTemplate({source: descriptor.template!.content.replace(/(<\/?)(Transition)\b/gu, '$1OwnedTransition'), filename, id: 'language-lifecycle', compilerOptions: {mode: 'function', cacheHandlers: true, bindingMetadata: script.bindings, expressionPlugins: ['typescript']}})
  expect(template.errors).toEqual([])
  component.render = new Function('Vue', ts.transpileModule(template.code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText)(Vue)
  return component
}
beforeEach(() => {
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
  const component = compile();source = Vue.shallowReactive(values);shown = Vue.ref(true)
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
    ? Vue.h(component, {...source, onSaved: saved, onConfirmed: confirmed, ref: (vm: any) => {if (vm) {state = vm.$.setupState;componentProps = vm.$.props}}})
    : Vue.h({render: () => null}, {key: 'other'})})})
  app.component('OwnedTransition', {inheritAttrs: false, setup: (_: unknown, {attrs, slots}: any) => () => Vue.h('div', {...attrs, 'data-transition': 'true'}, slots.default?.())})
  app.config.warnHandler = () => {};app.mount(document.getElementById('app')!);await settle()
  // Vue 开发模式的应用计时器不属于保存流程；从挂载完成后统计新增和清理。
  port.backgroundTimers = vi.getTimerCount()
}

async function languageStep() {callback(button('[data-testid="onboarding-language-next"]'))();await settle()}
function choose(value: string) {return callback(button(`[data-language="${value}"]`))}
function keyboardAction(value: string) {return callback(button(`[data-language="${value}"]`), 'onKeydown')}
function press(action: (event: {key: string; preventDefault: () => void}) => void, key: string) {const event = {key, preventDefault: vi.fn()};action(event);return event}
function confirmAction() {return callback(button('.onboarding-form > .onboarding-confirm'))}
function componentTimers() {return vi.getTimerCount() - port.backgroundTimers}

describe('UiLanguageOnboarding 实际保存与生命周期', () => {
  it('七种语言任一被选中时，单选组均只保留该卡片一个 Tab 入口', async () => {
    await mount({initialLanguage: 'ja-JP'});await languageStep()
    for (const {value} of languageRules.UI_LANGUAGE_OPTIONS) {
      choose(value)();await settle()
      const radios = [...document.querySelectorAll('[role="radio"]')]
      expect(radios).toHaveLength(7)
      expect(radios.filter(element => element.getAttribute('tabindex') === '0')).toEqual([button(`[data-language="${value}"]`)])
      expect(radios.filter(element => element.getAttribute('tabindex') === '-1')).toHaveLength(6)
      expect(button(`[data-language="${value}"]`).getAttribute('aria-checked')).toBe('true')
    }
    expect(setLanguage).not.toHaveBeenCalled()
  })
  it('四方向键与 Home/End 循环切换预览及焦点，Tab/Enter/空格保留原生行为', async () => {
    await mount({initialLanguage: 'ja-JP'});await languageStep()
    const sequence = [['ArrowRight', 'ko-KR'], ['ArrowDown', 'fr-FR'], ['ArrowLeft', 'ko-KR'], ['ArrowUp', 'ja-JP'],
      ['Home', 'zh-CN'], ['ArrowLeft', 'es-ES'], ['ArrowRight', 'zh-CN'], ['End', 'es-ES'], ['ArrowDown', 'zh-CN'], ['ArrowUp', 'es-ES']] as const
    for (const [key, value] of sequence) {
      focus.mockClear();const event = press(keyboardAction(state.selectedLanguage), key);await settle()
      expect(event.preventDefault).toHaveBeenCalledOnce();expect(state.selectedLanguage).toBe(value)
      expect(document.documentElement.lang).toBe(value);expect(focused).toBe(button(`[data-language="${value}"]`))
      expect(focus).toHaveBeenCalledOnce();expect(focus.mock.calls[0][1]).toEqual({preventScroll: true})
      expect(document.querySelectorAll('[role="radio"][tabindex="0"]')).toHaveLength(1)
    }
    focus.mockClear()
    for (const key of ['Tab', 'Enter', ' ', 'Escape']) expect(press(keyboardAction('es-ES'), key).preventDefault).not.toHaveBeenCalled()
    await settle();expect(focus).not.toHaveBeenCalled();expect(setLanguage).not.toHaveBeenCalled();expect(state.selectedLanguage).toBe('es-ES')
  })
  it('键盘仅预览，确认一次保存最后选择，等待及成功阶段旧键盘回调均不再操作', async () => {
    await mount({initialLanguage: 'en-US'});await languageStep()
    press(keyboardAction('en-US'), 'End');await settle();press(keyboardAction('es-ES'), 'ArrowLeft');await settle()
    expect(state.selectedLanguage).toBe('ru-RU');expect(setLanguage).not.toHaveBeenCalled()
    const oldKey = keyboardAction('ru-RU'), pending = confirmAction()();await settle();focus.mockClear()
    expect(press(oldKey, 'Home').preventDefault).not.toHaveBeenCalled()
    expect(press(keyboardAction('ru-RU'), 'ArrowRight').preventDefault).not.toHaveBeenCalled()
    expect(state.selectedLanguage).toBe('ru-RU');expect(setLanguage).toHaveBeenCalledOnce();expect(requests.map(request => request.value)).toEqual(['ru-RU'])
    requests[0].gate.resolve();await pending;await settle()
    expect(press(oldKey, 'End').preventDefault).not.toHaveBeenCalled();expect(focus).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1200)
    expect(stored).toBe('ru-RU');expect(saved).toHaveBeenCalledOnce();expect(saved).toHaveBeenCalledWith('ru-RU')
    expect(confirmed).toHaveBeenCalledOnce();expect(confirmed).toHaveBeenCalledWith('ru-RU')
  })
  it('保存失败后新键盘回调恢复，选择清除错误并可确认最终语言一次', async () => {
    await mount({initialLanguage: 'en-US'});await languageStep();press(keyboardAction('en-US'), 'End');await settle()
    const oldKey = keyboardAction('es-ES'), pending = confirmAction()();requests[0].gate.reject(new Error('storage failed'));await pending;await settle()
    expect(state.errorMessage).not.toBe('');expect(press(oldKey, 'Home').preventDefault).not.toHaveBeenCalled()
    press(keyboardAction('es-ES'), 'Home');await settle();expect(state.selectedLanguage).toBe('zh-CN');expect(state.errorMessage).toBe('')
    const retry = confirmAction()();requests[1].gate.resolve();await retry;await settle();await vi.advanceTimersByTimeAsync(1200)
    expect(requests.map(request => request.value)).toEqual(['es-ES', 'zh-CN']);expect(stored).toBe('zh-CN')
    expect(saved).toHaveBeenCalledOnce();expect(confirmed).toHaveBeenCalledOnce();expect(confirmed).toHaveBeenCalledWith('zh-CN')
  })
  it.each(['selection', 'props', 'step', 'cached', 'pagehide', 'unmount'])('%s 改变后旧键盘回调不复活、不改预览或抢焦点', async reason => {
    await mount({initialLanguage: 'ja-JP'});await languageStep();const oldKey = keyboardAction('ja-JP')
    if (reason === 'selection') choose('en-US')()
    else if (reason === 'props') source.initialLanguage = 'en-US'
    else if (reason === 'step') callback(button('.onboarding-back'))()
    else invalidate(reason)
    await settle()
    if (reason === 'cached') {shown.value = true;await settle()}
    const selected = state.selectedLanguage, preview = document.documentElement.lang;focus.mockClear()
    expect(press(oldKey, 'End').preventDefault).not.toHaveBeenCalled();await settle()
    expect(state.selectedLanguage).toBe(selected);expect(document.documentElement.lang).toBe(preview);expect(focus).not.toHaveBeenCalled();expect(setLanguage).not.toHaveBeenCalled()
    if (reason === 'cached') {
      press(keyboardAction('ja-JP'), 'End');await settle();expect(state.selectedLanguage).toBe('es-ES');expect(focused).toBe(button('[data-language="es-ES"]'))
    }
    if (reason === 'step') {
      await languageStep();press(keyboardAction('ja-JP'), 'Home');await settle();expect(state.selectedLanguage).toBe('zh-CN');expect(focused).toBe(button('[data-language="zh-CN"]'))
    }
  })
  it.each(['cached', 'pagehide', 'unmount', 'props', 'selection', 'step', 'outside', 'busy'])('键盘选择后渲染前 %s，取消排队的旧卡片焦点', async reason => {
    await mount({initialLanguage: 'ja-JP'});await languageStep();press(keyboardAction('ja-JP'), 'ArrowRight');focus.mockClear()
    let pending: Promise<void> | undefined
    if (reason === 'props') componentProps.initialLanguage = 'en-US'
    else if (reason === 'selection') state.selectedLanguage = 'fr-FR'
    else if (reason === 'step') state.step = 'welcome'
    else if (reason === 'outside') {const outside = document.createElement('button');document.body.append(outside);focused = outside}
    else if (reason === 'busy') pending = state.confirm()
    else invalidate(reason)
    await settle();expect(focus).not.toHaveBeenCalled()
    if (pending) {requests[0].gate.resolve();await pending;await settle();expect(focus).not.toHaveBeenCalled()}
  })
  it('共享 i18n 返回已被取代时，不宣布保存或创建成功 timer', async () => {
    await mount({initialLanguage:'en-US'});await languageStep();setLanguage.mockImplementationOnce(async()=>false);await confirmAction()();await settle()
    expect(saved).not.toHaveBeenCalled();expect(confirmed).not.toHaveBeenCalled();expect(componentTimers()).toBe(0);expect(button('.onboarding-form > .onboarding-confirm').hasAttribute('disabled')).toBe(false)
  })

  it('闲时 initialLanguage 同步后旧选项失效，当前选择与预览语言一致', async () => {
    await mount({initialLanguage: 'en-US'});await languageStep();const oldChoose = choose('fr-FR');source.initialLanguage = 'ja-JP';await settle();oldChoose();await settle()
    expect(button('[data-language="ja-JP"]').getAttribute('aria-checked')).toBe('true');expect(document.documentElement.lang).toBe('ja-JP');choose('ko-KR')();await settle();expect(document.documentElement.lang).toBe('ko-KR')
  })
  it('卸载清理同一个 pagehide 监听器', async () => {
    const add = port.addListener, remove = port.removeListener;await mount({initialLanguage: 'en-US'})
    const listener = add.mock.calls.find((call: unknown[]) => call[0] === 'pagehide')?.[1];expect(listener).toBeTypeOf('function');invalidate('unmount');expect(remove).toHaveBeenCalledWith('pagehide', listener)
  })

  it('首屏与步骤切换各焦点一次，语言步骤聚焦已选语言', async () => {
    await mount({initialLanguage: 'ja-JP'});expect(focus).toHaveBeenCalledOnce();expect(focused === button('[data-testid="onboarding-language-next"]')).toBe(true)
    focus.mockClear();await languageStep();expect(focus).toHaveBeenCalledOnce();expect(focused === button('[data-language="ja-JP"]')).toBe(true);expect(focus.mock.calls[0][1]).toEqual({preventScroll: true})
    expect(document.querySelectorAll('[role="radio"]')).toHaveLength(languageRules.UI_LANGUAGE_OPTIONS.length)
  })
  it('保存期间冻结选项与返回，提交值、存储及 saved/confirmed 一致', async () => {
    await mount({initialLanguage: 'en-US'});await languageStep();const lateChoose = choose('ja-JP'), back = callback(button('.onboarding-back')), pending = confirmAction()();await settle()
    const locked = [...document.querySelectorAll('.onboarding-language-option, .onboarding-back, .onboarding-form > .onboarding-confirm')].every(element => element.hasAttribute('disabled'))
    lateChoose();back();requests[0].gate.resolve();await pending;await settle();await vi.advanceTimersByTimeAsync(1200)
    expect(requests.map(request => request.value)).toEqual(['en-US']);expect(stored).toBe('en-US');expect(saved).toHaveBeenCalledOnce();expect(saved).toHaveBeenCalledWith(stored);expect(confirmed).toHaveBeenCalledOnce();expect(confirmed).toHaveBeenCalledWith(stored);expect(locked).toBe(true)
  })
  it('确认中重复触发和成功画面旧确认均不重复提交或创建计时器', async () => {
    await mount({initialLanguage: 'en-US'});await languageStep();const confirm = confirmAction(), pending = confirm();await confirm();requests[0].gate.resolve();await pending;await settle();const late = confirm();requests[1]?.gate.resolve();await late
    expect(setLanguage).toHaveBeenCalledOnce();expect(componentTimers()).toBe(1);await vi.advanceTimersByTimeAsync(1200);expect(confirmed).toHaveBeenCalledOnce();expect(componentTimers()).toBe(0)
  })
  it.each(['cached', 'pagehide', 'unmount'])('%s 后等待保存成功，不通知、不创建成功 timer 或抢焦点', async reason => {
    await mount({initialLanguage: 'en-US'});await languageStep();const pending = confirmAction()();invalidate(reason);await settle();focus.mockClear();requests[0].gate.resolve();await pending;await settle()
    expect(stored).toBe('en-US');expect(saved).not.toHaveBeenCalled();expect(confirmed).not.toHaveBeenCalled();expect(componentTimers()).toBe(0);expect(focus).not.toHaveBeenCalled()
  })
  it.each(['cached', 'pagehide', 'unmount'])('%s 后等待保存失败，不回写错误或 document.lang', async reason => {
    await mount({initialLanguage: 'en-US'});await languageStep();const pending = confirmAction()();invalidate(reason);await settle();document.documentElement.lang = 'fr-FR';requests[0].gate.reject(new Error('storage failed'));await pending;await settle()
    expect(state.errorMessage).toBe('');expect(document.documentElement.lang).toBe('fr-FR');expect(componentTimers()).toBe(0)
  })
  it.each(['cached', 'pagehide', 'unmount'])('%s 后已创建的成功计时器取消', async reason => {
    await mount({initialLanguage: 'en-US'});await languageStep();const pending = confirmAction()();requests[0].gate.resolve();await pending;await settle();expect(componentTimers()).toBe(1);invalidate(reason);await settle();await vi.advanceTimersByTimeAsync(1200)
    expect(confirmed).not.toHaveBeenCalled();expect(componentTimers()).toBe(0)
  })
  it('saved 的父回调同步卸载后也不会再创建计时器', async () => {
    await mount({initialLanguage: 'en-US'});await languageStep();saved.mockImplementationOnce(() => {app?.unmount();app = undefined});const pending = confirmAction()();requests[0].gate.resolve();await pending;await settle();expect(saved).toHaveBeenCalledOnce();expect(componentTimers()).toBe(0)
  })
  it('保存失败回滚语言且保留选择，可重新提交并成功一次', async () => {
    await mount({initialLanguage: 'en-US'});await languageStep();const pending = confirmAction()();requests[0].gate.reject(new Error('storage failed'));await pending;await settle()
    expect(stored).toBe('zh-CN');expect(language.value).toBe('zh-CN');expect(document.documentElement.lang).toBe('zh-CN');expect(button('[role="alert"]').textContent).toContain('界面语言保存失败')
    expect(button('[data-language="en-US"]').getAttribute('aria-checked')).toBe('true');expect(button('.onboarding-form > .onboarding-confirm').hasAttribute('disabled')).toBe(false)
    const retry = confirmAction()();requests[1].gate.resolve();await retry;await settle();await vi.advanceTimersByTimeAsync(1200);expect(stored).toBe('en-US');expect(saved).toHaveBeenCalledOnce();expect(confirmed).toHaveBeenCalledOnce()
  })
  it('忙时的新 initialLanguage 生效且旧保存不宣布新 props 完成', async () => {
    await mount({initialLanguage: 'en-US'});await languageStep();const pending = confirmAction()();source.initialLanguage = 'ja-JP';await settle();requests[0].gate.resolve();await pending;await settle()
    expect(saved).not.toHaveBeenCalled();expect(confirmed).not.toHaveBeenCalled();expect(componentTimers()).toBe(0);expect(button('[data-language="ja-JP"]').getAttribute('aria-checked')).toBe('true')
    const current = confirmAction()();requests[1].gate.resolve();await current;await settle();await vi.advanceTimersByTimeAsync(1200);expect(stored).toBe('ja-JP');expect(confirmed).toHaveBeenCalledWith('ja-JP')
  })
  it('失活后重开不复活旧按钮，未结束的保存仍锁定；完成后可重新确认', async () => {
    await mount({initialLanguage: 'en-US'});await languageStep();const oldChoose = choose('ja-JP'), oldConfirm = confirmAction(), pending = oldConfirm();shown.value = false;await settle();shown.value = true;await settle();oldChoose();await oldConfirm()
    expect(setLanguage).toHaveBeenCalledOnce();expect(button('.onboarding-form > .onboarding-confirm').hasAttribute('disabled')).toBe(true);requests[0].gate.resolve();await pending;await settle();expect(saved).not.toHaveBeenCalled()
    expect(button('.onboarding-form > .onboarding-confirm').hasAttribute('disabled')).toBe(false);const current = confirmAction()();requests[1].gate.resolve();await current;await settle();expect(saved).toHaveBeenCalledWith('en-US')
  })
  it('欢迎/语言往返不能复活旧步骤按钮，当前按钮仍可操作', async () => {
    await mount({initialLanguage: 'en-US'});const oldNext = callback(button('[data-testid="onboarding-language-next"]'));await languageStep();const oldChoose = choose('ja-JP'), oldBack = callback(button('.onboarding-back'));oldBack();await settle();oldNext();oldChoose();oldBack();await settle()
    expect(Boolean(document.querySelector('[data-testid="onboarding-welcome"]'))).toBe(true);callback(button('[data-testid="onboarding-language-next"]'))();await settle();expect(button('[data-language="en-US"]').getAttribute('aria-checked')).toBe('true')
  })
  it.each(['cached', 'pagehide', 'unmount', 'props', 'outside'])('渲染前 %s，使排队的步骤焦点失效', async reason => {
    await mount({initialLanguage: 'en-US'});const next = callback(button('[data-testid="onboarding-language-next"]'));next();focus.mockClear()
    if (reason === 'props') componentProps.initialLanguage = 'ja-JP';else if (reason === 'outside') {const outside = document.createElement('button');document.body.append(outside);focused = outside}else invalidate(reason)
    await settle();expect(focus).not.toHaveBeenCalled()
  })
  it('真实过渡结束端口可补上晚挂载控件焦点，但旧事件或外部焦点不会被抢占', async () => {
    await mount({initialLanguage: 'ja-JP'});await languageStep();focus.mockClear();const transition = button('[data-transition]'), after = events.get(transition)?.onAfterEnter
    expect(after).toBeTypeOf('function');after();await settle();expect(focus).not.toHaveBeenCalled();focused = document.body;after();await settle();expect(focused === button('[data-language="ja-JP"]')).toBe(true)
    const outside = document.createElement('button');document.body.append(outside);focused = outside;focus.mockClear();after();await settle();expect(focus).not.toHaveBeenCalled()
    callback(button('.onboarding-back'))();await settle();focus.mockClear();after();await settle();expect(focus).not.toHaveBeenCalled()
  })
})

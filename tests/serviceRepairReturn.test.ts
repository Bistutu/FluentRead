/**
 * @file tests/serviceRepairReturn.test.ts
 * 文件职责：通过实际返回网页组件模板验证明确点击、来源校验与迟到结果的操作归属。
 * 主要内容：覆盖扩展 URL 参数边界、普通网页协议、来源关闭、手动重试、重复点击、服务切换、隐藏、缓存停用和卸载。
 * 模块边界：只替换浏览器 tabs 端口与 i18n，不模拟组件实现、不访问真实用户标签页。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as vue from 'vue'
import {translateLegacyText, type UiLanguage} from '@/src/core/i18n'
import {registerAllUiLanguageBundles} from '@/src/core/i18n/bundles'
import * as actionContext from '@/src/features/settings/model/useSettingsActionContext'
import {compileVueInlineFixture} from './helpers/compiledVueFixture'
registerAllUiLanguageBundles()
const get = vi.fn(), update = vi.fn()
const disposals: (() => void)[] = []
type TestNode = {props: Record<string, any>; children: TestNode[]; parent?: TestNode; value?: string}
async function settle() {for (let i = 0; i < 8; i++) await Promise.resolve();await vue.nextTick()}
async function mount(href = 'chrome-extension://fixture/options.html?returnTabId=7', locale: UiLanguage = 'zh-CN') {
  vi.stubGlobal('location', {href})
  const compiled = compileVueInlineFixture('src/features/settings/ui/services/ServiceRepairReturn.vue', {id: 'service-return'})
  const language = vue.ref<UiLanguage>(locale)
  const dependencies: Record<string, unknown> = {'vue': vue, 'webextension-polyfill': {default: {tabs: {get, update}}},
    '@/src/ui/i18n': {useUiI18n: () => ({language, translateLegacy: (text: string) => translateLegacyText(text, language.value)})}, '../../model/useSettingsActionContext': actionContext}
  const module = {exports: {} as {default: vue.Component}}
  new Function('require', 'exports', 'module', compiled.code)((id: string) => {if (!(id in dependencies)) throw new Error(id);return dependencies[id]}, module.exports, module)
  const make = (): TestNode => ({props: {}, children: []})
  function remove(n: TestNode) {if (n.parent) {const index = n.parent.children.indexOf(n);if (index >= 0) n.parent.children.splice(index, 1)};n.parent = undefined}
  const renderer = vue.createRenderer<TestNode, TestNode>({patchProp: (n, key, _old, value) => {n.props[key] = value},
    insert(n, parent, anchor) {remove(n);const index = anchor ? parent.children.indexOf(anchor) : -1;parent.children.splice(index < 0 ? parent.children.length : index, 0, n);n.parent = parent},
    remove, createElement: make, createText: make, createComment: make, setText: (n, value) => {n.value = value}, setElementText: (n, value) => {n.value = value},
    parentNode: n => n.parent || null, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] || null,
    insertStaticContent: () => {throw new Error('Unexpected static content')}})
  const props = vue.reactive({active: true, context: {}, contextKey: 'deepseek'}), shown = vue.ref(true), host = make()
  const app = renderer.createApp({setup: () => () => vue.h(vue.KeepAlive, null, {default: () => shown.value ? vue.h(module.exports.default, props) : vue.h({render: () => null}, {key: 'hidden'})})})
  app.config.warnHandler = () => {};app.mount(host)
  let stopped = false
  const stop = () => {if (!stopped) {stopped = true;app.unmount()}}
  disposals.push(stop);await settle()
  function nodes(n = host): TestNode[] {return [n, ...n.children.flatMap(child => nodes(child))]}
  const button = () => nodes().find(n => Object.hasOwn(n.props, 'data-return-source-tab'))
  const text = () => nodes().map(n => n.value || '').join(' ')
  const click = async () => {const element = button();if (element) await element.props.onClick();await settle()}
  return {props, shown, stop, button, text, click, language}
}
beforeEach(() => {vi.clearAllMocks();get.mockResolvedValue({id: 7, url: 'https://example.test/private?secret=fixture'});update.mockResolvedValue({id: 7})})
afterEach(() => {for (const stop of disposals.splice(0)) stop();vi.unstubAllGlobals()})
describe('服务修复后返回来源网页', () => {
  it.each(['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const)('%s 实际模板的空闲、等待、失败和返回成功反馈使用同一语言词库', async locale => {
    const h = await mount('chrome-extension://fixture/options.html?returnTabId=7', locale)
    expect(h.text()).toContain(translateLegacyText('检查服务后，返回原网页，通过扩展重试翻译。', locale))
    expect(h.text()).toContain(translateLegacyText('返回原网页', locale))
    let release!: (value: unknown) => void
    get.mockReturnValueOnce(new Promise(resolve => {release = resolve}))
    const job = h.click();await settle()
    expect(h.text()).toContain(translateLegacyText('正在查找原网页…', locale))
    release({id: 7, url: 'chrome://settings'});await job
    expect(h.text()).toContain(translateLegacyText('原网页已关闭或当前无法访问。请打开需要翻译的网页，再通过扩展重试。', locale))
    await h.click()
    expect(h.text()).toContain(translateLegacyText('已返回原网页，可通过扩展重试翻译。', locale))
    if (locale !== 'zh-CN' && locale !== 'ja-JP') expect(h.text()).not.toMatch(/[\u3400-\u9fff]/u)
    expect(get).toHaveBeenCalledTimes(2);expect(update).toHaveBeenCalledWith(7, {active: true})
    h.language.value = locale === 'zh-CN' ? 'en-US' : 'zh-CN';await settle()
    expect(h.text()).toContain(translateLegacyText('已返回原网页，可通过扩展重试翻译。', h.language.value))
    expect(get).toHaveBeenCalledTimes(2)
  })
  it.each([
    'https://example.test/options.html?returnTabId=7', 'file:///options.html?returnTabId=7',
    'chrome-extension://fixture/options.html', 'chrome-extension://fixture/options.html?returnTabId=-1',
    'chrome-extension://fixture/options.html?returnTabId=1.5', 'chrome-extension://fixture/options.html?returnTabId=Infinity',
    'chrome-extension://fixture/options.html?returnTabId=9007199254740992', 'chrome-extension://fixture/options.html?returnTabId=7&returnTabId=8',
  ])('非法来源参数或非扩展页面不展示动作：%s', async href => {
    const h = await mount(href);expect(h.button()).toBeUndefined();await h.click();expect(get).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled()
  })
  it.each(['chrome-extension:', 'moz-extension:', 'safari-web-extension:'])('只在明确点击 %s 页面后验证源 ID 并激活原标签页', async protocol => {
    const h = await mount(`${protocol}//fixture/options.html?returnTabId=7`)
    expect(get).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled()
    await h.click();expect(get).toHaveBeenCalledWith(7);expect(update).toHaveBeenCalledWith(7, {active: true})
    expect(h.text()).not.toContain('private');expect(h.text()).toContain('通过扩展重试翻译')
  })
  it.each(['http://example.test', 'https://example.test', 'file:///document.html'])('来源 %s 协议允许返回', async url => {
    get.mockResolvedValueOnce({id: 7, url});const h = await mount();await h.click();expect(update).toHaveBeenCalledOnce()
  })
  it.each(['chrome://settings', 'about:blank', 'moz-extension://other/page.html', 'data:text/html,private', 'javascript:alert(1)', '', undefined])('来源限制页 %s 不激活并给出本地解释', async url => {
    get.mockResolvedValueOnce({id: 7, url});const h = await mount();await h.click();expect(update).not.toHaveBeenCalled();expect(h.text()).toContain('原网页已关闭或当前无法访问')
  })
  it('接受安全整数 0，来源 ID 不匹配或组件失活时不激活标签页', async () => {
    get.mockResolvedValueOnce({id: 0, url: 'https://example.test'})
    const h = await mount('chrome-extension://fixture/options.html?returnTabId=0')
    h.props.active = false;await settle();await h.click();expect(get).not.toHaveBeenCalled()
    h.props.active = true;await settle();await h.click();expect(update).toHaveBeenCalledWith(0, {active: true})
    get.mockResolvedValueOnce({id: 99, url: 'https://example.test'});update.mockClear();await h.click();expect(update).not.toHaveBeenCalled()
    expect(h.text()).toContain('原网页已关闭或当前无法访问')
  })
  it('关闭的源网页与激活失败不泄露原始错误，并允许明确重试', async () => {
    const h = await mount();get.mockRejectedValueOnce(new Error('private-tab-url token=fixture'))
    await h.click();expect(update).not.toHaveBeenCalled();expect(h.text()).not.toContain('fixture');expect(h.button()?.props.disabled).toBe(false)
    update.mockRejectedValueOnce(new Error('private-update-error'));await h.click();expect(h.text()).toContain('原网页已关闭或当前无法访问')
    await h.click();expect(update).toHaveBeenCalledTimes(2)
  })
  it.each(['hidden', 'cached', 'service', 'context', 'unmount'])('%s 使迟到 tabs.get 失效，不能切换到原网页', async reason => {
    let release!: (value: unknown) => void
    get.mockReturnValueOnce(new Promise(resolve => {release = resolve}))
    const h = await mount(), job = h.click();await settle();expect(h.button()?.props.disabled).toBe(true)
    const duplicate = h.click();await duplicate;expect(get).toHaveBeenCalledOnce()
    if (reason === 'hidden') h.props.active = false
    if (reason === 'cached') h.shown.value = false
    if (reason === 'service') h.props.contextKey = 'google'
    if (reason === 'context') h.props.context = {}
    if (reason === 'unmount') h.stop()
    await settle();release({id: 7, url: 'https://example.test'});await job
    expect(update).not.toHaveBeenCalled()
    if (reason === 'service' || reason === 'context') {expect(h.button()?.props.disabled).toBe(false);await h.click();expect(update).toHaveBeenCalledOnce()}
  })
})

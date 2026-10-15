/**
 * @file tests/serviceRepairFocus.test.ts
 * 文件职责：验证服务修复来源解析和一次性聚焦的用户意图、渲染及生命周期边界。
 * 主要内容：覆盖明确链接、初始导航焦点、用户打断、页面隐藏、迟到归属、连接按钮及禁用时可读标题稳定的负 tabindex 语义。
 * 模块边界：使用独立文档和渲染端口，不访问浏览器窗口、标签页、配置或供应商。
 */
import {parseHTML} from 'linkedom'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {createServiceRepairFocus, readServiceRepairSource} from '@/src/features/settings/ui/services/serviceRepairFocus'
function gate() {let resolve!: () => void, reject!: (reason: unknown) => void;const promise = new Promise<void>((yes, no) => {resolve = yes;reject = no});return {promise, resolve, reject}}
function fixture(initial = 'body') {
  const {document, window} = parseHTML('<html><body><button data-section="settings-services" aria-current="page">Service navigation</button><input><button id="check">Check connection</button><h4 tabindex="-1">OpenAI</h4></body></html>')
  let focused: Element | null = initial === 'null' ? null : initial === 'html' ? document.documentElement : initial === 'navigation' ? document.querySelector('[data-section]') : initial === 'input' ? document.querySelector('input') : document.body
  Object.defineProperty(document, 'activeElement', {get: () => focused, configurable: true})
  Object.defineProperty(document, 'visibilityState', {value: 'visible', writable: true, configurable: true})
  const button = document.querySelector<HTMLButtonElement>('#check')!, fallback = document.querySelector<HTMLElement>('h4')!
  for (const el of [button, fallback]) {
    Object.defineProperty(el, 'getClientRects', {value: () => [1], configurable: true})
    el.focus = vi.fn(() => {focused = el;document.dispatchEvent(new window.Event('focusin'))})
  }
  const deferred = gate(), afterRender = vi.fn(() => deferred.promise), focus = createServiceRepairFocus(afterRender), current = vi.fn(() => true)
  const targets = vi.fn(() => ({button, fallback}))
  vi.stubGlobal('document', document)
  return {document, window, button, fallback, deferred, afterRender, focus, current, targets, setFocus: (value: Element | null) => {focused = value}}
}
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals()})
describe('安全服务修复来源', () => {
  it.each(['chrome-extension:', 'moz-extension:', 'safari-web-extension:'])('%s 接受同一个安全来源并解析明确服务', protocol => {
    expect(readServiceRepairSource(`${protocol}//fixture/options.html?returnTabId=7&service=openai`)).toEqual({tabId: 7, service: 'openai'})
  })
  it('保留合法零和最大安全整数，不要求返回组件必须包含服务参数', () => {
    expect(readServiceRepairSource('chrome-extension://fixture/?returnTabId=0')).toEqual({tabId: 0, service: undefined})
    expect(readServiceRepairSource('chrome-extension://fixture/?returnTabId=9007199254740991&service=custom%3Aexample')).toEqual({tabId: Number.MAX_SAFE_INTEGER, service: 'custom:example'})
  })
  it.each(['not a URL', 'https://fixture/?returnTabId=7', 'chrome-extension://fixture/', 'chrome-extension://fixture/?returnTabId=-1', 'chrome-extension://fixture/?returnTabId=1.5', 'chrome-extension://fixture/?returnTabId=7&returnTabId=7', 'chrome-extension://fixture/?returnTabId=9007199254740992', 'chrome-extension://fixture/?returnTabId=00000000000000000'])('拒绝无效来源 %s', href => {expect(readServiceRepairSource(href)).toBeUndefined()})
  it.each(['', '&service=', '&service=%20openai', '&service=openai%20', '&service=openai&service=openai'])('不推断缺少或歧义服务 %s', query => {expect(readServiceRepairSource('chrome-extension://fixture/?returnTabId=7' + query)).toEqual({tabId: 7, service: undefined})})
})
describe('一次性修复聚焦', () => {
  it.each(['body', 'null', 'html', 'navigation'])('初始%s焦点可在渲染完成后直达按钮，后续请求不再聚焦', async initial => {
    const f = fixture(initial), add = vi.spyOn(f.document, 'addEventListener'), remove = vi.spyOn(f.document, 'removeEventListener')
    const job = f.focus(f.current, f.targets);expect(f.button.focus).not.toHaveBeenCalled();f.deferred.resolve();await job
    expect(f.button.focus).toHaveBeenCalledOnce();expect(f.button.focus).toHaveBeenCalledWith({preventScroll: true});expect(f.fallback.focus).not.toHaveBeenCalled()
    expect(add.mock.calls.map(call => call[0])).toEqual(['pointerdown', 'keydown', 'focusin', 'visibilitychange'])
    expect(remove.mock.calls.map(call => call[0])).toEqual(add.mock.calls.map(call => call[0]))
    await f.focus(f.current, f.targets);expect(f.button.focus).toHaveBeenCalledOnce();expect(f.afterRender).toHaveBeenCalledOnce()
  })
  it('没有文档时不调度，也不在后来文档存在时补抢焦点', async () => {
    vi.stubGlobal('document', undefined);const afterRender = vi.fn(async () => {}), focus = createServiceRepairFocus(afterRender)
    await focus(() => true, () => ({}));const f = fixture();await focus(f.current, f.targets);expect(afterRender).not.toHaveBeenCalled()
  })
  it.each(['inactive', 'hidden', 'input'])('初始%s时不抢已有意图', async reason => {
    const f = fixture(reason === 'input' ? 'input' : 'body')
    if (reason === 'inactive') f.current.mockReturnValue(false)
    if (reason === 'hidden') Object.assign(f.document, {visibilityState: 'hidden'})
    await f.focus(f.current, f.targets);expect(f.afterRender).not.toHaveBeenCalled();expect(f.button.focus).not.toHaveBeenCalled()
  })
  it.each(['pointerdown', 'keydown', 'focusin', 'visibilitychange'])('等待期间%s永久放弃本次焦点并移除监听', async event => {
    const f = fixture(), remove = vi.spyOn(f.document, 'removeEventListener'), job = f.focus(f.current, f.targets)
    f.document.dispatchEvent(new f.window.Event(event));f.deferred.resolve();await job
    expect(f.targets).not.toHaveBeenCalled();expect(remove).toHaveBeenCalledTimes(4)
    await f.focus(f.current, f.targets);expect(f.afterRender).toHaveBeenCalledOnce()
  })
  it.each(['context', 'hidden', 'focus'])('渲染后复验%s，不使用迟到焦点', async reason => {
    const f = fixture(), job = f.focus(f.current, f.targets)
    if (reason === 'context') f.current.mockReturnValue(false)
    if (reason === 'hidden') Object.assign(f.document, {visibilityState: 'hidden'})
    if (reason === 'focus') f.setFocus(f.fallback)
    f.deferred.resolve();await job;expect(f.targets).not.toHaveBeenCalled()
  })
  it('按钮禁用则聚焦模板预备的当前标题，不增删稳定 tabindex 或引入Tab停靠', async () => {
    const f = fixture();f.button.disabled = true
    const set = vi.spyOn(f.fallback, 'setAttribute'), remove = vi.spyOn(f.fallback, 'removeAttribute')
    const job = f.focus(f.current, f.targets);f.deferred.resolve();await job
    expect(f.fallback.focus).toHaveBeenCalledOnce();expect(f.button.focus).not.toHaveBeenCalled()
    expect(f.document.activeElement).toBe(f.fallback);expect(f.fallback.getAttribute('tabindex')).toBe('-1')
    expect(set).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled()
  })
  it('没有按钮也可聚焦预备的配置区域，focus异常仍清理监听且不修改稳定属性', async () => {
    const f = fixture();f.fallback.focus = vi.fn(() => {throw Error('focus unavailable')})
    const removeAttribute = vi.spyOn(f.fallback, 'removeAttribute'), remove = vi.spyOn(f.document, 'removeEventListener')
    const job = f.focus(f.current, () => ({fallback: f.fallback}));f.deferred.resolve();await expect(job).rejects.toThrow('focus unavailable')
    expect(f.fallback.getAttribute('tabindex')).toBe('-1');expect(removeAttribute).not.toHaveBeenCalled();expect(remove).toHaveBeenCalledTimes(4)
  })
  it.each(['missing', 'disconnected', 'invisible'])('目标%s时不聚焦', async reason => {
    const f = fixture();if (reason === 'disconnected') f.button.remove();if (reason === 'invisible') Object.defineProperty(f.button, 'getClientRects', {value: () => []})
    const job = f.focus(f.current, () => reason === 'missing' ? {} : f.targets());f.deferred.resolve();await job;expect(f.button.focus).not.toHaveBeenCalled();expect(f.fallback.focus).not.toHaveBeenCalled()
  })
  it('渲染端口失败仍清除监听', async () => {
    const f = fixture(), remove = vi.spyOn(f.document, 'removeEventListener'), job = f.focus(f.current, f.targets)
    f.deferred.reject(Error('render failed'));await expect(job).rejects.toThrow('render failed');expect(remove).toHaveBeenCalledTimes(4)
  })
})

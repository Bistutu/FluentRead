/**
 * @file src/app/popup/pageFontActions.ts
 * 文件职责：将快捷面板的当前页字体选择绑定到实际来源标签页与内容文档。
 * 主要内容：读取内容脚本确认的字体状态，写入前后复验标签页和地址，以文档令牌约束当前页操作，并在关闭、导航、失败及超时后撤销旧操作。
 * 模块边界：只使用注入的标签页与消息端口，不修改配置、不持久化偏好，也不执行网页样式或翻译请求。
 */
import {isBrowserTabId} from '@/src/platform/browser/ids'
import {waitForSettingsTask} from '@/src/features/settings/model/taskWait'
import type {PopupActiveTab} from './pageContracts'

export interface PopupPageFontState {
  browserDefault: boolean | null
  loading: boolean
  busy: boolean
  unavailable: boolean
  error: '' | 'popup.pageFont.readError' | 'popup.pageFont.changeError'
}
interface PageFontSnapshot {browserDefault: boolean; documentToken: string; pageUrl: string}
interface PageFontPorts {
  state: PopupPageFontState
  active: () => boolean
  getTab: () => Promise<PopupActiveTab | undefined>
  send: (tabId: number, message: {type: string; browserDefault?: boolean; documentToken?: string; pageUrl?: string}) => Promise<unknown>
}

function readSnapshot(value: unknown): PageFontSnapshot | undefined {
  const response = value as {status?: unknown; browserDefault?: unknown; documentToken?: unknown; pageUrl?: unknown} | undefined
  if (response?.status !== 'success' || typeof response.browserDefault !== 'boolean'
    || typeof response.documentToken !== 'string' || !response.documentToken || response.documentToken.length > 128
    || typeof response.pageUrl !== 'string' || !response.pageUrl) return
  return {browserDefault: response.browserDefault, documentToken: response.documentToken, pageUrl: response.pageUrl}
}

export function createPopupPageFontActions(ports: PageFontPorts) {
  const {state} = ports
  let revision = 0, controller: AbortController | undefined
  let confirmed: (PageFontSnapshot & {tabId: number}) | undefined
  const urlOf = (tab: PopupActiveTab | undefined) => tab?.pendingUrl || tab?.url || ''
  function invalidate() {
    revision += 1;controller?.abort();controller = undefined;confirmed = undefined
    Object.assign(state, {browserDefault: null, loading: false, busy: false, unavailable: false, error: ''})
  }
  function begin() {
    const ownedController = new AbortController(), ownedRevision = ++revision
    controller = ownedController
    return {current: () => ports.active() && revision === ownedRevision && !ownedController.signal.aborted,
      wait: <T>(operation: Promise<T>) => waitForSettingsTask(operation, ownedController.signal, 10_000, 'Page font operation timed out'),
      finish: () => {if (controller === ownedController) {controller = undefined;state.loading = false;state.busy = false}}}
  }
  async function load() {
    if (!ports.active()) return
    invalidate();const task = begin();state.loading = true
    try {
      const tab = await task.wait(ports.getTab());if (!task.current()) return
      const pageUrl = urlOf(tab)
      if (!isBrowserTabId(tab?.id) || !/^(?:https?|file):/u.test(pageUrl)) {state.unavailable = true;return}
      const response = readSnapshot(await task.wait(ports.send(tab.id, {type: 'getPageTranslationFontState'})))
      if (!task.current()) return
      const latest = await task.wait(ports.getTab());if (!task.current()) return
      if (latest?.id !== tab.id || urlOf(latest) !== pageUrl) {await load();return}
      if (!response || response.pageUrl !== pageUrl) throw new Error('Page font state was not confirmed')
      confirmed = {...response, tabId: tab.id};state.browserDefault = response.browserDefault
    } catch {if (task.current()) state.error = 'popup.pageFont.readError'}
    finally {task.finish()}
  }
  async function set(browserDefault: boolean) {
    if (!ports.active() || !confirmed || state.loading || state.busy || typeof browserDefault !== 'boolean'
      || browserDefault === state.browserDefault) return
    const owner = confirmed, task = begin();state.busy = true;state.error = ''
    try {
      const tab = await task.wait(ports.getTab());if (!task.current()) return
      // 点击属于已读到的文档；导航或切换后只读取新页，不能转交旧选择。
      if (tab?.id !== owner.tabId || urlOf(tab) !== owner.pageUrl) {await load();return}
      const response = readSnapshot(await task.wait(ports.send(owner.tabId, {type: 'setPageTranslationFont', browserDefault,
        documentToken: owner.documentToken, pageUrl: owner.pageUrl})))
      if (!task.current()) return
      const latest = await task.wait(ports.getTab());if (!task.current()) return
      if (latest?.id !== owner.tabId || urlOf(latest) !== owner.pageUrl) {await load();return}
      if (!response || response.documentToken !== owner.documentToken || response.pageUrl !== owner.pageUrl
        || response.browserDefault !== browserDefault) throw new Error('Page font change was not confirmed')
      confirmed = {...response, tabId: owner.tabId};state.browserDefault = response.browserDefault
    } catch {if (task.current()) {confirmed = undefined;state.browserDefault = null;state.error = 'popup.pageFont.changeError'}}
    finally {task.finish()}
  }
  return {load, set, invalidate}
}

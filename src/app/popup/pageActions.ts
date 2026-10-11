/**
 * @file src/app/popup/pageActions.ts
 * 文件职责：管理 Popup 的标签页状态读取、全文/局部操作、渐进阅读入口和站点规则即时翻译归属。
 * 主要内容：区分状态读取、页面操作与规则保存的归属；写规则前复验实际标签页，确认后台保存后反馈，禁用规则可中断翻译；渐进阅读不预检翻译凭据，原生在线 PDF 交给扩展阅读器，导航和失活使旧回复失效。
 * 模块边界：只通过注入端口读取标签页、发送已有消息、提交站点字段补丁和修改界面状态，不直接访问存储、创建观察器或实现网页翻译。
 */
import type {Config} from '@/src/core/config/model'
import {getSiteBaseDomain} from '@/src/core/site-rules/domain'
import {isBrowserTabId} from '@/src/platform/browser/ids'
import {getPdfSourceUrl} from '@/src/features/document-translation/core/pdfSource'
import type {PopupActiveTab} from './pageContracts'
export type {PopupActiveTab} from './pageContracts'

export interface PopupPageState {tabId: number | null; windowId?: number; url: string; domain: string; translated: boolean; busy: boolean; savingRule: boolean}
export type PopupSiteRulePatch = Partial<Pick<Config, 'alwaysTranslateDomains' | 'disabledExtensionDomains'>>
export interface PopupPagePorts {
  state: PopupPageState
  config: () => Config
  active: () => boolean
  warning: () => string
  getTab: () => Promise<PopupActiveTab | undefined>
  send: (tabId: number, message: {type: string; action?: string}) => Promise<unknown>
  persistRule: (patch: PopupSiteRulePatch) => Promise<void>
  openPdf?: (sourceUrl: string) => Promise<unknown>
  notice: (message: string, type?: 'success' | 'error') => void
  close: () => void
  translate: (key: string) => string
  thunderbird: boolean
}

export function createPopupPageActions(ports: PopupPagePorts) {
  const {state} = ports
  let revision = 0, readSequence = 0, stateSequence = 0, operation: symbol | null = null
  let ruleOperation: symbol | null = null
  const disabled = () => Boolean(state.domain && ports.config().disabledExtensionDomains.includes(state.domain))
  function invalidate() {
    revision += 1;readSequence += 1;stateSequence += 1;operation = null;state.busy = false
    if (!ports.active()) {ruleOperation = null;state.savingRule = false}
  }
  function capture() {const captured = revision;return () => ports.active() && captured === revision}
  function bindTab(tab: PopupActiveTab & {id: number}) {
    state.tabId = tab.id;state.windowId = tab.windowId;state.url = tab.pendingUrl || tab.url || '';state.domain = getSiteBaseDomain(state.url) || ''
  }
  async function hydrate() {
    if (!ports.active()) return
    ruleOperation = null;state.savingRule = false
    invalidate();const current = capture(), sequence = ++readSequence
    state.tabId = null;state.url = '';state.domain = '';state.translated = false
    try {
      const tab = await ports.getTab()
      if (!current() || sequence !== readSequence || !isBrowserTabId(tab?.id)) return
      bindTab(tab as PopupActiveTab & {id: number});const statusVersion = stateSequence
      if (ports.openPdf && getPdfSourceUrl(state.url)) return
      try {
        const response = await ports.send(tab.id, {type: 'getFullPageTranslationState'}) as {isTranslated?: unknown} | undefined
        if (current() && sequence === readSequence && statusVersion === stateSequence) state.translated = response?.isTranslated === true
      } catch {if (current() && sequence === readSequence && statusVersion === stateSequence) state.translated = false}
    } catch (error) {if (current()) console.warn('[FluentRead] 无法读取当前网站', error)}
  }
  function begin() {
    if (!ports.active() || state.busy || state.savingRule || !ports.config().on || disabled()) return
    const token = Symbol();operation = token;stateSequence += 1;state.busy = true
    const active = capture()
    return {current: () => active() && operation === token, finish: () => {if (operation === token) {operation = null;state.busy = false}}}
  }
  async function target(current: () => boolean) {
    const tab = await ports.getTab()
    if (!current()) return
    if (!isBrowserTabId(tab?.id)) throw new Error('No active tab')
    if (state.tabId !== null && (state.tabId !== tab.id || state.url !== (tab.pendingUrl || tab.url || ''))) {
      // 新页面先读取自己的真值，旧页面的 restore/fullPage 意图不能移交给它。
      await hydrate();return
    }
    bindTab(tab as PopupActiveTab & {id: number});return tab.id
  }
  async function translate(action: 'fullPage' | 'restore' | 'section', success: (response: {isTranslated?: unknown}) => void, failure: string, allowPdf = false) {
    const task = begin();if (!task) return
    try {
      const tabId = await target(task.current);if (tabId === undefined || !task.current()) return
      const pdfSource = allowPdf ? getPdfSourceUrl(state.url) : null
      if (pdfSource && ports.openPdf) {
        await ports.openPdf(pdfSource)
        if (task.current()) ports.close()
        return
      }
      if (allowPdf && action !== 'restore') {
        const warning = ports.warning();if (warning) {ports.notice(warning, 'error');return}
      }
      const response = await ports.send(tabId, {type: 'contextMenuTranslate', action}) as {status?: unknown; isTranslated?: unknown} | undefined
      if (!task.current()) return
      if (response?.status !== 'success') throw new Error('Translation failed')
      success(response)
    } catch {if (task.current()) ports.notice(failure, 'error')}
    finally {task.finish()}
  }
  function toggle() {
    if (!ports.active() || state.busy || !ports.config().on || disabled()) return
    const action = state.translated ? 'restore' : 'fullPage'
    return translate(action, response => {state.translated = typeof response.isTranslated === 'boolean' ? response.isTranslated : action === 'fullPage'},
      ports.thunderbird ? '请先打开一封邮件，然后重试翻译' : '当前页面暂不支持翻译，请刷新后重试', true)
  }
  function section() {
    if (!ports.active() || state.busy || !ports.config().on || disabled()) return
    return translate('section', () => ports.close(), ports.translate('popup.sectionTranslationUnavailable'), true)
  }
  async function reading() {
    if (ports.thunderbird || getPdfSourceUrl(state.url)) return
    const task = begin();if (!task) return
    try {
      const tabId = await target(task.current);if (tabId === undefined || !task.current()) return
      if (ports.thunderbird || getPdfSourceUrl(state.url)) return
      const response = await ports.send(tabId, {type: 'openProgressiveReading'}) as {status?: unknown} | undefined
      if (!task.current()) return
      if (response?.status !== 'success') throw new Error('Reading assistance unavailable')
      ports.close()
    } catch {if (task.current()) ports.notice('当前页面暂不支持渐进阅读，请刷新后重试', 'error')}
    finally {task.finish()}
  }
  function beginRule(enabled: boolean, interrupt = false) {
    if (!ports.active() || state.savingRule || (!interrupt && state.busy) || !state.domain || state.tabId === null || typeof enabled !== 'boolean') return
    const token = Symbol(), before = revision, tabId = state.tabId, url = state.url, domain = state.domain
    ruleOperation = token;state.savingRule = true
    // 配置提交会同步使页面翻译失效；已验证的保存意图仍归属于原网站。
    const current = () => ports.active() && ruleOperation === token && state.tabId === tabId && state.url === url && state.domain === domain
    return {domain, current, validating: () => current() && before === revision,
      finish: () => {if (ruleOperation === token) {ruleOperation = null;state.savingRule = false}}}
  }
  async function saveRule(field: keyof PopupSiteRulePatch, enabled: boolean, task: NonNullable<ReturnType<typeof beginRule>>) {
    const domains = ports.config()[field], domain = task.domain
    const next = enabled ? domains.includes(domain) ? domains : [...domains, domain] : domains.filter(item => item !== domain)
    ports.config()[field] = next
    if (field === 'disabledExtensionDomains') {invalidate();if (enabled) state.translated = false}
    try {await ports.persistRule({[field]: next})}
    catch {if (task.current()) ports.notice(`未能保存 ${domain} 的网站设置，请重试`, 'error');return false}
    return task.current() && ports.config()[field].includes(domain) === enabled
  }
  async function setDisabled(enabled: boolean) {
    const task = beginRule(enabled, true);if (!task) return
    try {
      const tabId = await target(task.validating);if (tabId === undefined || !task.validating()) return
      if (!await saveRule('disabledExtensionDomains', enabled, task)) return
      ports.notice(enabled ? `已在 ${task.domain} 禁用扩展` : `已恢复 ${task.domain} 的扩展`)
    } catch {if (task.current()) ports.notice('无法读取当前网站，请重试', 'error')}
    finally {task.finish()}
  }
  async function setAlways(enabled: boolean) {
    const task = beginRule(enabled);if (!task) return
    try {
      const tabId = await target(task.validating);if (tabId === undefined || !task.validating()) return
      const cfg = ports.config(), domain = task.domain
      if (cfg.autoTranslate) {ports.notice('所有网站自动翻译已开启，请在完整设置中关闭全局开关');return}
      if (disabled()) {ports.notice(`当前已在 ${domain} 禁用扩展，请先恢复扩展`);return}
      if (!await saveRule('alwaysTranslateDomains', enabled, task)) return
      if (!enabled) {ports.notice(`已关闭 ${domain} 的始终翻译，当前网页保持不变`);return}
      if (!cfg.on) {ports.notice(`已保存 ${domain}，启动插件后生效`);return}
      if (disabled()) {ports.notice(`已保存 ${domain}，恢复扩展后生效`);return}
      const warning = ports.warning();if (warning) {ports.notice(`已保存 ${domain}；${warning}`, 'error');return}
      if (state.translated) {ports.notice(`已开启 ${domain} 的始终翻译`);return}
      task.finish()
      await translate('fullPage', response => {
        if (!ports.config().alwaysTranslateDomains.includes(domain)) return
        state.translated = response.isTranslated !== false;ports.notice(`已开启 ${domain} 的始终翻译`)
      }, `已保存 ${domain}，当前网页请刷新后重试`)
    } catch {if (task.current()) ports.notice('无法读取当前网站，请重试', 'error')}
    finally {task.finish()}
  }
  return {hydrate, toggle, section, reading, setAlways, setDisabled, invalidate}
}

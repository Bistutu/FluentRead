/**
 * @file src/features/settings/ui/services/serviceRepairFocus.ts
 * 文件职责：复用服务修复链接的安全来源解析，并限定初次进入配置时的一次性 DOM 聚焦。
 * 主要内容：只接受扩展页面上的单个安全标签页 ID 和明确服务参数；等待渲染后优先聚焦连接按钮，禁用时聚焦模板预备的可读标题或配置区域并保持焦点；用户操作、页面隐藏、所属变化均放弃旧聚焦并清理监听。
 * 模块边界：不读取浏览器标签页、不修改配置、不触发连接或翻译、不激活窗口；生命周期有效性由调用方现有设置上下文提供。
 */
export function readServiceRepairSource(href: string): {tabId: number; service?: string} | undefined {
  try {
    const source = new URL(href)
    if (!['chrome-extension:', 'moz-extension:', 'safari-web-extension:'].includes(source.protocol)) return undefined
    const values = source.searchParams.getAll('returnTabId')
    if (values.length !== 1 || !/^\d{1,16}$/u.test(values[0])) return undefined
    const tabId = Number(values[0])
    if (!Number.isSafeInteger(tabId) || tabId < 0) return undefined
    const services = source.searchParams.getAll('service')
    const service = services.length === 1 && services[0] !== '' && services[0].trim() === services[0] ? services[0] : undefined
    return {tabId, service}
  } catch {return undefined}
}

export function createServiceRepairFocus(afterRender: () => Promise<unknown>) {
  let attempted = false
  return async (current: () => boolean, targets: () => {button?: HTMLButtonElement | null; fallback?: HTMLElement | null}): Promise<void> => {
    if (attempted) return
    attempted = true
    if (typeof document === 'undefined' || !current() || document.visibilityState === 'hidden') return
    const ownerDocument = document, initialFocus = ownerDocument.activeElement
    if (initialFocus && initialFocus !== ownerDocument.body && initialFocus !== ownerDocument.documentElement
      && !initialFocus.matches('button[data-section="settings-services"][aria-current="page"]')) return
    let interrupted = false
    const interrupt = () => {interrupted = true}
    const events = ['pointerdown', 'keydown', 'focusin', 'visibilitychange'] as const
    for (const event of events) ownerDocument.addEventListener(event, interrupt, true)
    try {
      await afterRender()
      if (interrupted || !current() || ownerDocument.visibilityState === 'hidden' || ownerDocument.activeElement !== initialFocus) return
      const {button, fallback} = targets()
      const target = button && !button.disabled ? button : fallback
      if (!target?.isConnected || !target.getClientRects().length) return
      target.focus({preventScroll: true})
    } finally {
      for (const event of events) ownerDocument.removeEventListener(event, interrupt, true)
    }
  }
}

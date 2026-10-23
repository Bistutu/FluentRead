/**
 * @file src/ui/translationLoadingIndicator.ts
 * 文件职责：创建不受宿主网页 CSS 与同名关键帧影响的段落翻译加载指示器。
 * 主要内容：以固定尺寸的 light-DOM 宿主保留翻译状态标记，在独立 Shadow Root 内渲染 15 种反馈；同一 Document 共享解析后的样式表，不支持时安全回退，并统一处理缓存色与减少动态效果。
 * 模块边界：本文件只负责指示器 DOM 与视觉隔离，不读取配置仓库、不插入目标段落，也不管理翻译请求生命周期。
 */

import LOADING_INDICATOR_STYLES from './styles/translation-loading-indicator.css?inline'

import {
  normalizeTranslationLoadingStyle,
  type TranslationLoadingStyle,
} from '@/src/core/config/translationLoadingStyle'

export interface TranslationLoadingIndicatorOptions {
  style: TranslationLoadingStyle
  animated: boolean
  cacheHit?: boolean
}

const HOST_IMPORTANT_STYLES: ReadonlyArray<readonly [string, string]> = [
  ['all', 'initial'],
  ['box-sizing', 'border-box'],
  ['position', 'static'],
  ['inset', 'auto'],
  ['display', 'inline-flex'],
  ['float', 'none'],
  ['clear', 'none'],
  ['flex', '0 0 16px'],
  ['width', '16px'],
  ['min-width', '16px'],
  ['max-width', '16px'],
  ['height', '16px'],
  ['min-height', '16px'],
  ['max-height', '16px'],
  ['margin', '0 0 0 2px'],
  ['padding', '0'],
  ['border', '0'],
  ['border-radius', '0'],
  ['align-items', 'center'],
  ['justify-content', 'center'],
  ['overflow', 'hidden'],
  ['visibility', 'visible'],
  ['opacity', '1'],
  ['color', 'initial'],
  ['background', 'transparent'],
  ['box-shadow', 'none'],
  ['font', 'normal 16px/1 sans-serif'],
  ['line-height', '1'],
  ['vertical-align', '-2px'],
  ['transform', 'none'],
  ['filter', 'none'],
  ['animation', 'none'],
  ['transition', 'none'],
  ['pointer-events', 'none'],
  ['user-select', 'none'],
  ['isolation', 'isolate'],
  ['contain', 'layout style paint'],
]



type SharedLoadingStylesheet = CSSStyleSheet & {
  replaceSync?: (text: string) => void
}

const sharedLoadingStylesheets = new WeakMap<Document, SharedLoadingStylesheet>()

/** 在当前 Document 的 CSS realm 中只构造一次样式表；任一能力缺失都交给 style 回退。 */
function getSharedLoadingStylesheet(document: Document): SharedLoadingStylesheet | null {
  const existing = sharedLoadingStylesheets.get(document)
  if (existing) return existing

  const CSSStyleSheetConstructor = document.defaultView?.CSSStyleSheet as
    | (new () => SharedLoadingStylesheet)
    | undefined
  if (typeof CSSStyleSheetConstructor !== 'function') return null

  try {
    const stylesheet = new CSSStyleSheetConstructor()
    if (typeof stylesheet.replaceSync !== 'function') return null
    stylesheet.replaceSync(LOADING_INDICATOR_STYLES)
    sharedLoadingStylesheets.set(document, stylesheet)
    return stylesheet
  } catch {
    return null
  }
}

/** 将共享表应用到 closed ShadowRoot；Shadow DOM 不支持或被宿主拒绝时保持原有 style 注入。 */
function adoptSharedLoadingStylesheet(shadow: ShadowRoot, document: Document): boolean {
  const stylesheet = getSharedLoadingStylesheet(document)
  if (!stylesheet) return false

  try {
    const adopted = shadow.adoptedStyleSheets
    if (!Array.isArray(adopted)) return false
    shadow.adoptedStyleSheets = [...adopted, stylesheet]
    return true
  } catch {
    return false
  }
}

/** 创建固定外部布局、完全隔离内部视觉的加载指示器。 */
export function createTranslationLoadingIndicator(
  document: Document,
  options: TranslationLoadingIndicatorOptions,
): HTMLElement {
  const host = document.createElement('span')
  const style = normalizeTranslationLoadingStyle(options.style)
  host.className = 'fluent-read-loading'
  host.setAttribute('aria-hidden', 'true')
  host.setAttribute('translate', 'no')
  host.setAttribute('data-fr-loading-style', style)
  host.setAttribute('data-fr-motion', options.animated ? 'animated' : 'static')
  if (options.cacheHit) host.setAttribute('data-fr-cache', 'true')
  for (const [property, value] of HOST_IMPORTANT_STYLES) {
    host.style.setProperty(property, value, 'important')
  }

  // closed root 也不会被全文扫描当作待翻译页面内容，并阻止宿主页脚本
  // 直接改写内部样式；外层 host 仍保留状态机需要的可观察标记。
  const shadow = host.attachShadow({mode: 'closed'})
  const visual = document.createElement('span')
  visual.className = 'fr-loading-visual'
  visual.setAttribute('aria-hidden', 'true')
  visual.append(
    document.createElement('i'),
    document.createElement('i'),
    document.createElement('i'),
  )
  if (!adoptSharedLoadingStylesheet(shadow, document)) {
    const stylesheet = document.createElement('style')
    stylesheet.textContent = LOADING_INDICATOR_STYLES
    shadow.append(stylesheet)
  }
  shadow.append(visual)
  return host
}

/** 总开关关闭或系统要求减少动态效果时，只渲染静态状态。 */
export function shouldAnimateTranslationLoading(
  animationsEnabled: boolean,
  view: Pick<Window, 'matchMedia'> | null = null,
): boolean {
  if (!animationsEnabled) return false
  if (!view) return true
  try {
    return view.matchMedia('(prefers-reduced-motion: reduce)').matches !== true
  } catch {
    return true
  }
}

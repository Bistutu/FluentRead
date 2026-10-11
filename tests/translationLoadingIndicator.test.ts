import {describe, expect, it} from 'vitest'
import {parseHTML} from 'linkedom'
import {
  createTranslationLoadingIndicator,
  shouldAnimateTranslationLoading,
} from '@/src/ui/translationLoadingIndicator'
import {applyTranslationLoadingStyleChoice, getTranslationLoadingStyleChoice, normalizeTranslationLoadingStyle, translationLoadingStyleChoices, translationLoadingStyleOptions} from '@/src/core/config/translationLoadingStyle'

type FakeShadowRoot = {
  adoptedStyleSheets: unknown
  appended: Node[]
  append: (...nodes: Node[]) => void
}

type FakeStylesheet = {
  replaceSync?: (text: string) => void
}

interface StylesheetRuntimeOptions {
  sheetConstructor?: new () => FakeStylesheet
  adoptedStyleSheets?: unknown
  adoptThrows?: boolean
}

function installStylesheetRuntime(document: Document, options: StylesheetRuntimeOptions = {}) {
  const view = document.defaultView as unknown as {
    CSSStyleSheet?: new () => FakeStylesheet
    Element: {prototype: {attachShadow: (init: ShadowRootInit) => ShadowRoot}}
  }
  const originalConstructor = view.CSSStyleSheet
  const originalAttachShadow = view.Element.prototype.attachShadow
  const roots: FakeShadowRoot[] = []
  const Constructor = options.sheetConstructor
  if (Constructor) {
    Object.defineProperty(view, 'CSSStyleSheet', {configurable: true, value: Constructor})
  }
  view.Element.prototype.attachShadow = function attachShadow() {
    const root = {
      adoptedStyleSheets: options.adoptedStyleSheets === undefined ? [] : options.adoptedStyleSheets,
      appended: [] as Node[],
      append(...nodes: Node[]) {
        this.appended.push(...nodes)
      },
    } as FakeShadowRoot
    if (options.adoptThrows) {
      Object.defineProperty(root, 'adoptedStyleSheets', {
        configurable: true,
        get() { throw new Error('adopt failed') },
      })
    }
    roots.push(root)
    return root as unknown as ShadowRoot
  }
  return {
    roots,
    restore() {
      view.Element.prototype.attachShadow = originalAttachShadow
      if (originalConstructor) Object.defineProperty(view, 'CSSStyleSheet', {configurable: true, value: originalConstructor})
      else delete view.CSSStyleSheet
    },
  }
}

describe('段落翻译加载指示器', () => {
  it('末尾的“无”兼容旧关闭状态，保留静态样式且任意预设都能重新启用动画', () => {
    expect(translationLoadingStyleChoices.at(-1)?.value).toBe('none')
    expect(normalizeTranslationLoadingStyle('unknown')).toBe('ring')
    const config = {animations: false, translationLoadingStyle: 'orbit' as const}
    expect(getTranslationLoadingStyleChoice(config)).toBe('none')
    applyTranslationLoadingStyleChoice(config, 'none')
    expect(config.translationLoadingStyle).toBe('orbit')
    for (const option of translationLoadingStyleOptions) {
      applyTranslationLoadingStyleChoice(config, option.value)
      expect(config.animations).toBe(true)
      expect(getTranslationLoadingStyleChoice(config)).toBe(option.value)
      applyTranslationLoadingStyleChoice(config, 'none')
      expect(config.animations).toBe(false)
      expect(config.translationLoadingStyle).toBe(option.value)
      expect(getTranslationLoadingStyleChoice(config)).toBe('none')
    }
  })

  it('每种注册样式都在独立 Shadow Root 内生成固定结构', () => {
    const {document} = parseHTML('<html><body></body></html>')

    for (const option of translationLoadingStyleOptions) {
      const indicator = createTranslationLoadingIndicator(document, {
        style: option.value,
        animated: true,
      })

      expect(indicator.classList.contains('fluent-read-loading')).toBe(true)
      expect(indicator.getAttribute('data-fr-loading-style')).toBe(option.value)
      expect(indicator.getAttribute('data-fr-motion')).toBe('animated')
      expect(indicator.getAttribute('aria-hidden')).toBe('true')
      expect(indicator.getAttribute('translate')).toBe('no')
      expect(indicator.style.getPropertyValue('width')).toBe('16px')
      expect(indicator.style.getPropertyValue('animation')).toBe('none')
      expect(indicator.shadowRoot).toBeNull()
    }
  })

  it('系统减少动态效果的偏好优先于总动画开关', () => {
    const reducedMotion = {matchMedia: () => ({matches: true}) as MediaQueryList}
    const regularMotion = {matchMedia: () => ({matches: false}) as MediaQueryList}

    expect(shouldAnimateTranslationLoading(false, regularMotion)).toBe(false)
    expect(shouldAnimateTranslationLoading(true, reducedMotion)).toBe(false)
    expect(shouldAnimateTranslationLoading(true, regularMotion)).toBe(true)
    expect(shouldAnimateTranslationLoading(true, null)).toBe(true)
    expect(shouldAnimateTranslationLoading(true)).toBe(true)
    expect(shouldAnimateTranslationLoading(true, {matchMedia: () => { throw new Error('blocked') }})).toBe(true)
  })

  it('关闭总动画时为所选样式生成静态兼容状态', () => {
    const {document} = parseHTML('<html><body></body></html>')
    const indicator = createTranslationLoadingIndicator(document, {
      style: 'dots',
      animated: false,
    })

    expect(indicator.getAttribute('data-fr-motion')).toBe('static')
    expect(indicator.classList.contains('static')).toBe(false)
    expect(indicator.hasAttribute('data-fr-cache')).toBe(false)
  })

  it('缓存状态只通过隔离宿主属性改变内部色彩', () => {
    const {document} = parseHTML('<html><body></body></html>')
    const indicator = createTranslationLoadingIndicator(document, {
      style: 'ring',
      animated: true,
      cacheHit: true,
    })

    expect(indicator.getAttribute('data-fr-cache')).toBe('true')
    expect(indicator.style.getPropertyValue('border')).toBe('0')
  })

  it('在同一 Document 的多个 closed ShadowRoot 之间共享一次 CSSStyleSheet', () => {
    const {document} = parseHTML('<html><body></body></html>')
    let constructed = 0
    let replaced = 0
    class FakeCSSStyleSheet {
      replaceSync() {
        replaced += 1
      }
      constructor() {
        constructed += 1
      }
    }
    const runtime = installStylesheetRuntime(document, {sheetConstructor: FakeCSSStyleSheet})

    try {
      const first = createTranslationLoadingIndicator(document, {style: 'ring', animated: true})
      const second = createTranslationLoadingIndicator(document, {style: 'dots', animated: false})

      expect(first.shadowRoot).toBeNull()
      expect(second.shadowRoot).toBeNull()
      expect(constructed).toBe(1)
      expect(replaced).toBe(1)
      expect(runtime.roots).toHaveLength(2)
      expect(runtime.roots[0].appended).toHaveLength(1)
      expect(runtime.roots[1].appended).toHaveLength(1)
      expect((runtime.roots[0].appended[0] as HTMLElement).tagName).toBe('SPAN')
      const firstSheets = runtime.roots[0].adoptedStyleSheets as unknown[]
      const secondSheets = runtime.roots[1].adoptedStyleSheets as unknown[]
      expect(firstSheets).toHaveLength(1)
      expect(secondSheets[0]).toBe(firstSheets[0])
    } finally {
      runtime.restore()
    }
  })

  it('为不同 Document 构造彼此隔离的样式表', () => {
    const firstDocument = parseHTML('<html><body></body></html>').document
    const secondDocument = parseHTML('<html><body></body></html>').document
    let constructed = 0
    class FakeCSSStyleSheet {
      replaceSync() {}
      constructor() {
        constructed += 1
      }
    }
    const firstRuntime = installStylesheetRuntime(firstDocument, {sheetConstructor: FakeCSSStyleSheet})
    createTranslationLoadingIndicator(firstDocument, {style: 'minimal', animated: true})
    const firstSheet = (firstRuntime.roots[0].adoptedStyleSheets as unknown[])[0]
    firstRuntime.restore()
    const secondRuntime = installStylesheetRuntime(secondDocument, {sheetConstructor: FakeCSSStyleSheet})

    try {
      createTranslationLoadingIndicator(secondDocument, {style: 'minimal', animated: true})

      expect(constructed).toBe(2)
      expect(firstSheet).not.toBe((secondRuntime.roots[0].adoptedStyleSheets as unknown[])[0])
    } finally {
      secondRuntime.restore()
    }
  })

  it('CSSStyleSheet 不可用时保留 style 回退', () => {
    const {document} = parseHTML('<html><body></body></html>')
    const runtime = installStylesheetRuntime(document)

    try {
      createTranslationLoadingIndicator(document, {style: 'minimal', animated: true})

      expect(runtime.roots[0].adoptedStyleSheets).toEqual([])
      expect(runtime.roots[0].appended).toHaveLength(2)
      expect((runtime.roots[0].appended[0] as HTMLStyleElement).tagName).toBe('STYLE')
    } finally {
      runtime.restore()
    }
  })

  it('CSSStyleSheet 缺少 replaceSync 时保留 style 回退', () => {
    const {document} = parseHTML('<html><body></body></html>')
    class MissingReplaceSync {}
    const runtime = installStylesheetRuntime(document, {sheetConstructor: MissingReplaceSync})

    try {
      createTranslationLoadingIndicator(document, {style: 'minimal', animated: true})
      expect(runtime.roots[0].appended).toHaveLength(2)
      expect((runtime.roots[0].appended[0] as HTMLStyleElement).tagName).toBe('STYLE')
    } finally {
      runtime.restore()
    }
  })

  it('构造、replaceSync 或 adoption 失败时都安全回退到 style', () => {
    const failingConstructorDocument = parseHTML('<html><body></body></html>').document
    class ThrowingConstructor {
      constructor() {
        throw new Error('construct failed')
      }
    }
    const constructorRuntime = installStylesheetRuntime(failingConstructorDocument, {sheetConstructor: ThrowingConstructor})

    const failingReplaceDocument = parseHTML('<html><body></body></html>').document
    class ThrowingReplace {
      replaceSync() {
        throw new Error('replace failed')
      }
    }
    const replaceRuntime = installStylesheetRuntime(failingReplaceDocument, {sheetConstructor: ThrowingReplace})
    createTranslationLoadingIndicator(failingConstructorDocument, {style: 'minimal', animated: true})
    constructorRuntime.restore()
    createTranslationLoadingIndicator(failingReplaceDocument, {style: 'minimal', animated: true})
    replaceRuntime.restore()

    const failingAdoptDocument = parseHTML('<html><body></body></html>').document
    class WorkingSheet {
      replaceSync() {}
    }
    const adoptRuntime = installStylesheetRuntime(failingAdoptDocument, {
      sheetConstructor: WorkingSheet,
      adoptThrows: true,
    })

    try {
      createTranslationLoadingIndicator(failingAdoptDocument, {style: 'minimal', animated: true})

      expect(adoptRuntime.roots[0].appended).toHaveLength(2)
    } finally {
      adoptRuntime.restore()
    }
  })

  it('adoptedStyleSheets 不是数组时安全回退到 style', () => {
    const {document} = parseHTML('<html><body></body></html>')
    class WorkingSheet {
      replaceSync() {}
    }
    const runtime = installStylesheetRuntime(document, {
      sheetConstructor: WorkingSheet,
      adoptedStyleSheets: null,
    })

    try {
      createTranslationLoadingIndicator(document, {style: 'minimal', animated: true})
      expect(runtime.roots[0].appended).toHaveLength(2)
    } finally {
      runtime.restore()
    }
  })
})

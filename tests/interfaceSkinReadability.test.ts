import {existsSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {interfaceSkinOptions} from '@/src/core/config/interfaceAppearance'

const root = resolve(__dirname, '..')
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')
const paletteSkins = interfaceSkinOptions.filter(skin => skin.kind === 'palette').map(skin => skin.value)
const skinCss = (skin: string) => source(`src/ui/styles/interface-skins/${skin}.css`)
const sharedCss = () => source('src/ui/styles/interface-skins/palette.css')

type Rgb = [number, number, number]
type Tokens = Record<string, string>
interface Paint { rgb: Rgb; alpha: number }

const COLOR = /#[0-9a-f]{6}\b|rgba\(\d+, \d+, \d+, [\d.]+\)|\btransparent\b/gi

function parseHex(value: string | undefined): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(value?.trim() ?? '')
  if (!match) throw new Error(`期望 6 位十六进制颜色，实际为 ${String(value)}`)
  const number = Number.parseInt(match[1], 16)
  return [number >> 16 & 255, number >> 8 & 255, number & 255]
}

/** 把一个颜色记号解析成带不透明度的颜色；只接受十六进制、rgba() 与 transparent。 */
function parsePaint(value: string): Paint {
  const text = value.trim()
  if (text === 'transparent') return {rgb: [0, 0, 0], alpha: 0}
  const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(text)
  if (rgba) return {rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4])}
  return {rgb: parseHex(text), alpha: 1}
}

function over(top: Paint, under: Rgb): Rgb {
  return under.map((channel, index) => top.rgb[index] * top.alpha + channel * (1 - top.alpha)) as Rgb
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(channel => {
    const value = channel / 255
    return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  })
  return .2126 * r + .7152 * g + .0722 * b
}

/** WCAG 2 对比度；传入顺序不影响结果。 */
function contrast(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + .05) / (darker + .05)
}

function declarations(css: string, selector: string): Tokens {
  const start = css.indexOf(selector)
  if (start < 0) return {}
  const open = css.indexOf('{', start)
  const close = css.indexOf('\n}', open)
  return Object.fromEntries([...css.slice(open, close).matchAll(/(--[\w-]+):\s*([^;]+);/g)]
    .map(match => [match[1], match[2].trim().replace(/\s+/g, ' ')]))
}

/** 每套风格在亮、暗主题下实际生效的变量；始终为深色的风格只有一组。 */
function skinModes(skin: string): Record<string, Tokens> {
  const css = skinCss(skin)
  const base = declarations(css, `:root[data-interface-skin="${skin}"]`)
  // 始终为深色的风格把亮、暗两个选择器写在同一个声明块上。
  if (css.includes(`:root[data-interface-skin="${skin}"],\n:root.dark[data-interface-skin="${skin}"] {`)) return {dark: base}
  const dark = declarations(css, `:root.dark[data-interface-skin="${skin}"] {`)
  expect(Object.keys(dark).length, `${skin} 缺少暗色变量`).toBeGreaterThan(0)
  return {light: base, dark: {...base, ...dark}}
}

/** 读取变量并展开其中的 var(--x) 引用。 */
function token(tokens: Tokens, name: string, fallback = ''): string {
  return (tokens[name] ?? fallback).replace(/var\((--[\w-]+)\)/g, (_, inner: string) => token(tokens, inner))
}

/** 一个表面在给定底色上的实际颜色；半透明色与底色合成，纯色就是它自己。 */
function surfaceOn(value: string, under: Rgb): Rgb {
  const first = value.match(COLOR)?.[0]
  if (!first) throw new Error(`无法解析的表面：${value}`)
  return over(parsePaint(first), under)
}

function expectContrast(text: string, surface: Rgb, minimum: number, label: string) {
  expect(contrast(parseHex(text), surface), `${label}（${text} 对 rgb(${surface.map(Math.round).join(', ')})）`).toBeGreaterThanOrEqual(minimum)
}

function eachMode(run: (skin: string, mode: string, tokens: Tokens, label: string) => void) {
  for (const skin of paletteSkins) {
    for (const [mode, tokens] of Object.entries(skinModes(skin))) run(skin, mode, tokens, `${skin} ${mode}`)
  }
}

describe('传统色风格的可读性', () => {
  it('警告和错误在各皮肤表面及语义反馈底色上保持可读，始终深色皮肤不依赖主题开关', () => {
    const sharedTokens = source('src/ui/styles/tokens.css')
    const light = declarations(sharedTokens, ':root {\n  --fr-success:')
    const dark = declarations(sharedTokens, ':root.dark,')
    eachMode((skin, mode, tokens, label) => {
      const feedback = mode === 'dark' ? dark : light
      for (const kind of ['warning', 'danger']) {
        const foreground = feedback[`--fr-${kind}`]
        for (const surface of ['--surface', '--surface-soft', '--skin-workspace', '--skin-sidebar']) {
          expectContrast(foreground, parseHex(tokens[surface]), 4.5, `${label} ${kind} on ${surface}`)
        }
        expectContrast(foreground, parseHex(feedback[`--fr-${kind}-soft`]), 4.5, `${label} ${kind} feedback`)
      }
      if (Object.keys(skinModes(skin)).length === 1) {
        // 亮色主题也必须命中同一份深色反馈变量，不能只测试带 .dark 的选择器。
        const alwaysDark = declarations(sharedTokens, `:root[data-interface-skin="${skin}"]`)
        for (const name of ['--fr-warning', '--fr-warning-soft', '--fr-danger', '--fr-danger-soft']) {
          expect(alwaysDark[name], `${skin} light theme ${name}`).toBe(dark[name])
        }
      }
    })
  })

  it('设置页的文字、强调色与表面达到比正文标准更高的对比度', () => {
    eachMode((_skin, _mode, tokens, label) => {
      const solid = (name: string) => parseHex(tokens[name])
      for (const surface of ['--surface', '--skin-workspace', '--skin-sidebar']) {
        expectContrast(tokens['--ink'], solid(surface), 10, `${label} ink on ${surface}`)
        expectContrast(tokens['--muted'], solid(surface), 5, `${label} muted on ${surface}`)
      }
      expectContrast(tokens['--ink'], solid('--surface-soft'), 10, `${label} ink on --surface-soft`)
      expectContrast(tokens['--muted'], solid('--surface-soft'), 4.5, `${label} muted on --surface-soft`)
      expectContrast(tokens['--brand'], solid('--surface'), 4.5, `${label} brand on --surface`)
      for (const surface of ['--surface', '--surface-soft', '--brand-soft']) {
        expectContrast(tokens['--brand-strong'], solid(surface), 4.5, `${label} brand-strong on ${surface}`)
      }
      // 侧栏选中项是正文色文字配一块浅底。
      const active = surfaceOn(token(tokens, '--skin-nav-active', tokens['--brand-soft']), solid('--skin-sidebar'))
      expectContrast(tokens['--ink'], active, 10, `${label} ink on nav active`)
    })
  })

  it('设置页只使用纯色表面，亮色下的工作区与侧栏不带明显色相', () => {
    const spread = (value: string) => { const rgb = parseHex(value); return Math.max(...rgb) - Math.min(...rgb) }
    eachMode((_skin, mode, tokens, label) => {
      for (const name of ['--surface', '--surface-soft', '--skin-page', '--skin-workspace', '--skin-sidebar', '--ink', '--muted', '--line', '--brand', '--brand-strong', '--brand-soft']) {
        expect(tokens[name], `${label} ${name}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
      if (mode !== 'light') return
      // 整页染上暖色或粉色会让侧栏文字显得发雾，即使对比度数字达标；亮色工作区只允许接近中性的浅灰。
      for (const name of ['--surface', '--skin-workspace', '--skin-sidebar']) {
        expect(spread(tokens[name]), `${label} ${name} 色相`).toBeLessThanOrEqual(6)
        expect(luminance(parseHex(tokens[name])), `${label} ${name} 明度`).toBeGreaterThanOrEqual(.85)
      }
    })
    const shared = sharedCss()
    expect(shared).toMatch(/\.workspace \{\s+color: var\(--ink\);\s+background: var\(--skin-workspace, var\(--skin-page\)\);/)
    expect(shared).toMatch(/\.sidebar \{\s+border-color: var\(--line\);\s+background: var\(--skin-sidebar, var\(--surface\)\);/)
  })

  it('菜单栏里每一处文字都落在平涂的表面上，并达到对比度要求', () => {
    eachMode((_skin, _mode, tokens, label) => {
      const page = parseHex(tokens['--skin-page'])
      const strong = tokens['--brand-strong']
      // 直接出现在版面底色上的文字：品牌名、版本号与底部信息栏。
      expectContrast(tokens['--ink'], page, 10, `${label} brand name on page`)
      expectContrast(tokens['--muted'], page, 4.5, `${label} version and footer on page`)

      const chip = surfaceOn(token(tokens, '--skin-chip-background', tokens['--surface']), page)
      expectContrast(token(tokens, '--skin-chip-color', tokens['--muted']), chip, 4.5, `${label} header button text`)
      expectContrast(tokens['--muted'], chip, 4.5, `${label} open-source link text`)

      const panel = surfaceOn(token(tokens, '--skin-panel-background', tokens['--surface']), page)
      const control = surfaceOn(token(tokens, '--skin-control-background', tokens['--surface-soft']), panel)
      const tag = surfaceOn(token(tokens, '--skin-tag-background', tokens['--surface']), control)
      const feature = surfaceOn(token(tokens, '--skin-feature-background', tokens['--surface']), page)
      const featureHover = surfaceOn(token(tokens, '--skin-feature-hover', tokens['--surface-soft']), page)

      expectContrast(token(tokens, '--skin-label-color', tokens['--muted']), panel, 4.5, `${label} field label on panel`)
      for (const [name, surface] of Object.entries({control, feature, featureHover})) {
        expectContrast(tokens['--ink'], surface, 10, `${label} ink on ${name}`)
        expectContrast(tokens['--muted'], surface, 4.5, `${label} muted on ${name}`)
      }
      expectContrast(token(tokens, '--skin-section-color', strong), control, 4.5, `${label} section action on control`)
      expectContrast(strong, tag, 4.5, `${label} site switch on tag`)
      expectContrast(tokens['--muted'], tag, 4.5, `${label} disable switch on tag`)

      // 图标是图形而非文字，按 3:1 要求；透明图标底取所在卡片的颜色。按色调分别上色时逐个检查。
      const iconInk = token(tokens, '--skin-icon-color', strong)
      const tones = [...new Set(Object.keys(tokens).map(name => /^--skin-tone-([a-z]+)$/.exec(name)?.[1]).filter(Boolean))] as string[]
      if (!tones.length) {
        expectContrast(iconInk, surfaceOn(token(tokens, '--skin-icon-background', tokens['--brand-soft']), feature), 3, `${label} icon`)
      }
      for (const tone of tones) {
        expectContrast(token(tokens, `--skin-tone-${tone}-ink`, iconInk), parseHex(tokens[`--skin-tone-${tone}`]), 3, `${label} ${tone} icon`)
      }
    })
  })

  it('主按钮是一块平涂色，上面的文字清晰可读', () => {
    eachMode((_skin, _mode, tokens, label) => {
      expect(tokens['--skin-action-background'], `${label} action fill`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(tokens['--skin-action-color'], `${label} action color`).toBe(tokens['--skin-action-background'])
      expectContrast(tokens['--skin-action-text'], parseHex(tokens['--skin-action-background']), 4.5, `${label} action text`)
    })
    // 水墨主按钮上的朱印是白字。
    expectContrast('#ffffff', parseHex(skinModes('shuimo').light['--skin-seal']), 4.5, 'shuimo seal glyph')
  })

  it('全部是平涂色：没有渐变、图片、模糊、光晕或伪元素装饰，也不改动品牌图标', () => {
    const shared = sharedCss()
    expect(shared).toContain('.popup-shell {\n  color: var(--ink);\n  background: var(--skin-page);\n}')
    for (const banned of ['gradient(', 'url(', 'backdrop-filter: var', 'blur(', 'text-shadow', 'background-clip']) {
      expect(shared, banned).not.toContain(banned)
    }
    for (const skin of paletteSkins) {
      for (const banned of ['gradient(', 'url(', 'backdrop-filter', 'blur(', '::before', '::after', 'filter:', 'text-shadow', 'background-clip']) {
        expect(skinCss(skin), `${skin} ${banned}`).not.toContain(banned)
      }
    }
    // 品牌图标：共享层只去掉默认的粉色投影，任何风格文件都不匹配它。
    expect(shared.match(/\.brand img \{[^}]*\}/g)).toEqual(['.brand img {\n  box-shadow: none;\n}'])
    for (const skin of paletteSkins) {
      expect(skinCss(skin), skin).not.toMatch(/\.brand img|preview-logo|--skin-logo/)
    }
    expect(source('src/features/settings/ui/components/PopupPreview.vue')).not.toMatch(/\[data-preview-kind="palette"\] \.preview-logo/)

    // 投影只允许是不带模糊的内描线或贴边色条；外投影与扩散都不出现。
    eachMode((_skin, _mode, tokens, label) => {
      for (const name of Object.keys(tokens)) {
        // --skin-shadow 是浮层投影的颜色，不是一条投影声明。
        if (!/^--skin-.+-shadow$/.test(name)) continue
        for (const layer of token(tokens, name).split(/,(?![^(]*\))/).map(part => part.trim())) {
          if (layer === 'none') continue
          expect(layer, `${label} ${name}`).toMatch(/^inset -?\d+(?:px)? -?\d+(?:px)? 0 (?:\d+px )?(?:#[0-9a-f]{6}|rgba\([^)]*\))$/i)
        }
      }
    })
  })

  it('十套风格的造型各不相同，而不是只换颜色', () => {
    const shape = (value: string) => value.replace(COLOR, 'color')
    const signature = (skin: string) => {
      const tokens = Object.values(skinModes(skin))[0]
      const css = skinCss(skin)
      const rules = css.slice(css.lastIndexOf('\n}\n') + 3)
      return [
        `panel ${shape(token(tokens, '--skin-panel-border', '1px solid color'))} / ${token(tokens, '--skin-panel-radius', '14px')} / ${shape(token(tokens, '--skin-panel-shadow', 'none'))}`,
        `control ${shape(token(tokens, '--skin-control-border', '1px solid color'))} / ${token(tokens, '--skin-control-radius', '10px')}`,
        `chip ${shape(token(tokens, '--skin-chip-background', 'color'))} / ${shape(token(tokens, '--skin-chip-border', '1px solid color'))} / ${token(tokens, '--skin-chip-radius', token(tokens, '--skin-control-radius', '10px'))}`,
        `feature ${shape(token(tokens, '--skin-feature-border', '1px solid color'))} / ${token(tokens, '--skin-feature-radius', '10px')} / ${shape(token(tokens, '--skin-feature-shadow', 'none'))}`,
        `icon ${shape(token(tokens, '--skin-icon-background', 'color'))} / ${token(tokens, '--skin-icon-radius', '8px')} / ${shape(token(tokens, '--skin-icon-border', '0'))}`,
        `action ${token(tokens, '--skin-action-radius', '10px')}`,
        luminance(parseHex(tokens['--skin-page'])) > .98 ? 'white page' : 'toned page',
        Object.keys(skinModes(skin)).length === 1 ? 'dark only' : 'adaptive',
        css.includes('--skin-tone-') ? 'toned icons' : 'single accent',
        rules.includes('.translate-glyph') ? 'seal glyph' : rules.includes('letter-spacing') ? 'spaced label' : 'plain label',
      ].join(' | ')
    }
    const signatures = paletteSkins.map(signature)
    expect(paletteSkins).toHaveLength(10)
    expect(new Set(signatures).size, signatures.join('\n')).toBe(10)
    // 任意两套风格之间至少有四项造型不同。
    for (let a = 0; a < signatures.length; a++) {
      for (let b = a + 1; b < signatures.length; b++) {
        const left = signatures[a].split(' | ')
        const right = signatures[b].split(' | ')
        const differing = left.filter((part, index) => part !== right[index]).length
        expect(differing, `${paletteSkins[a]} 与 ${paletteSkins[b]}`).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it('每套风格的专属规则同时作用于真实菜单栏和设置页里的预览', () => {
    const preview = source('src/features/settings/ui/components/PopupPreview.vue')
    const shared = sharedCss()
    const pairs: Array<[RegExp, string]> = [
      [/\.feature-icon/, '.preview-feature-icon'],
      [/\.translate-glyph/, '.preview-action > b'],
      [/\.translate-label/, '.preview-action > strong'],
    ]
    for (const skin of paletteSkins) {
      const css = skinCss(skin)
      // 变量块之后的规则都是专属选择器；出现真实菜单栏的类名时，必须同时带上预览里对应的类名。
      for (const rule of css.slice(css.lastIndexOf('\n}\n') + 3).match(/^:root[^{]+\{/gm) ?? []) {
        expect(pairs.some(([real]) => real.test(rule)), `${skin}: 未登记的专属选择器 ${rule.trim()}`).toBe(true)
        for (const [real, replica] of pairs) {
          if (real.test(rule)) expect(rule, `${skin}: ${rule.trim()}`).toContain(replica)
        }
      }
    }
    for (const hook of ['--skin-chip-color', '--skin-chip-radius', '--skin-avatar-ring', '--skin-tag-background', '--skin-icon-shadow', '--skin-section-color', '--skin-label-color', '--skin-footer-line']) {
      expect(preview, hook).toContain(hook)
      expect(shared, hook).toContain(hook)
    }
  })

  it('菜单栏与设置页不再挂载角落插画', () => {
    expect(existsSync(resolve(root, 'src/ui/components/InterfaceBackdrop.vue'))).toBe(false)
    for (const path of ['src/app/popup/PopupApp.vue', 'src/app/options/OptionsApp.vue', 'src/features/settings/ui/InterfaceSettings.vue']) {
      expect(source(path)).not.toContain('InterfaceBackdrop')
    }
  })

  it('紧凑风格压缩间距而不把文字缩到难以辨认，简约风格的主操作不带品牌色底', () => {
    const compact = source('src/ui/styles/interface-skins/compact.css')
    const sizes = [...compact.matchAll(/font-size:\s*([\d.]+)px/g)].map(match => Number(match[1]))
    expect(sizes.length).toBeGreaterThan(0)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(9)

    const minimal = source('src/ui/styles/interface-skins/minimal.css')
    const button = /:root\[data-interface-skin="minimal"\] \.translate-button \{([^}]*)\}/.exec(minimal)?.[1] ?? ''
    expect(button).toContain('background: var(--surface-soft);')
    expect(button).toContain('border: 1px solid transparent;')
    expect(button).not.toContain('--brand')
  })
})

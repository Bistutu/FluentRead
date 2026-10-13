import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {parseHTML} from 'linkedom'
import vue from '@vitejs/plugin-vue'
import {createServer, type Plugin, type ViteDevServer} from 'vite'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// 实际 SFC setup/watch/KeepAlive；原生弹窗和缓存由隔离生产扩展另验。
const runtime = createRequire(import.meta.url)('vue') as typeof import('vue')
const {renderToString} = createRequire(import.meta.url)('vue/server-renderer') as typeof import('vue/server-renderer')
const key = '__frInterfaceSettingsLifecycle'
let server: ViteDevServer, app: import('vue').App, state: Record<string, any>
let mocks: Plugin
let props: {config: Record<string, any>; active: boolean; activePanel?: string}, visible: import('vue').Ref<boolean>
let cache: import('vue').Ref<string[]>, status: import('vue').Ref<{font: string; status: string}>
let capabilities: {browser: string}
let acceptLegacy!: () => void, cancelLegacy!: () => void, legacyOpen = false, begun: Promise<void> | undefined
const feedback = vi.fn(), clear = vi.fn(), refresh = vi.fn(), retry = vi.fn(), confirm = vi.fn()
function deferred() {let resolve!: () => void;let reject!: (error: unknown) => void
  const promise = new Promise<void>((yes, no) => {resolve = yes;reject = no});return {promise, resolve, reject}}
async function settle() {await runtime.nextTick();await runtime.nextTick()}
function createTestRenderer() {
  return runtime.createRenderer<Record<string, never>, Record<string, unknown>>({patchProp: () => {}, insert: () => {},
    remove: () => {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText: () => {},
    setElementText: () => {}, parentNode: () => null, nextSibling: () => null, querySelector: () => null,
    setScopeId: () => {}, cloneNode: () => ({}), insertStaticContent: () => [{}, {}]})
}
function createFixtureServer(buildBrowser = 'chrome') {
  return createServer({root: process.cwd(), configFile: false, appType: 'custom', logLevel: 'silent',
    define: {'import.meta.env.BROWSER': JSON.stringify(buildBrowser)},
    plugins: [mocks, vue()], resolve: {alias: {'@': resolve(process.cwd())}}, ssr: {noExternal: ['element-plus']},
    server: {hmr: false, middlewareMode: true}})
}
function begin(font = 'inter') {const result = state.confirmClearFont(font);if (result?.then) begun = result}
async function accept() {
  if (state.performClearFont) await state.performClearFont()
  else {acceptLegacy();await begun}
  await settle()
}
async function cancel() {
  if (state.closeFontClearDialog) state.closeFontClearDialog()
  else {cancelLegacy();await begun}
  await settle()
}
function open() {return state.fontClearDialogOpen === undefined ? legacyOpen : state.fontClearDialogOpen}
function mutate(reason: string) {
  if (reason === 'hidden') props.active = false
  if (reason === 'config') props.config = {...props.config}
  if (reason === 'font') props.config.interfaceFont = 'roboto'
  if (reason === 'panel') props.activePanel = 'layout'
  if (reason === 'cached') visible.value = false
  if (reason === 'unmount') app.unmount()
}
beforeEach(async () => {
  vi.clearAllMocks();legacyOpen = false;begun = undefined
  cache = runtime.ref(['system', 'inter', 'noto-sans-sc', 'noto-serif-sc']);status = runtime.ref({font: 'system', status: 'system'})
  clear.mockResolvedValue(undefined);refresh.mockResolvedValue(undefined);retry.mockReturnValue(undefined)
  confirm.mockImplementation(() => {
    legacyOpen = true;const pending = deferred();acceptLegacy = () => {legacyOpen = false;pending.resolve()}
    cancelLegacy = () => {legacyOpen = false;pending.reject('cancel')};return pending.promise
  })
  capabilities = runtime.reactive({browser: 'chrome'})
  Object.assign(globalThis, {[key]: {cache, status, feedback, clear, refresh, retry, confirm, capabilities}})
  mocks = {name: 'interface-settings-ports', enforce: 'pre', resolveId(id) {
    if (id === 'element-plus') return '\0interface-element'
    if (id.endsWith('.vue') && !id.endsWith('InterfaceSettings.vue') && !id.endsWith('PopupPreview.vue')) return '\0interface-child'
    if (/\/src\/ui\/i18n(?:\.ts)?$/u.test(id)) return '\0interface-i18n'
    if (id.includes('platform/browser/capabilities')) return '\0interface-capabilities'
    if (/\/src\/ui\/interfaceAppearance(?:\.ts)?$/u.test(id)) return '\0interface-appearance'
    return null
  }, load(id) {
    if (id === '\0interface-element') return `export const ElMessage = globalThis.${key}.feedback;export const ElMessageBox = {confirm: globalThis.${key}.confirm};`
    if (id === '\0interface-child') return 'export default {}'
    if (id === '\0interface-i18n') return 'export const useUiI18n = () => ({t: key => key, translateLegacy: text => text});'
    if (id === '\0interface-capabilities') return `export const browserCapabilities = globalThis.${key}.capabilities;`
    if (id === '\0interface-appearance') return `export const {cache: availableInterfaceFonts, cache: cachedInterfaceFonts,
      status: interfaceFontLoadState, clear: clearInterfaceFont, refresh: refreshInterfaceFontAvailability, retry: retryInterfaceFont} = globalThis.${key};`
    return null
  }}
  server = await createFixtureServer()
  const component = (await server.ssrLoadModule('/src/features/settings/ui/InterfaceSettings.vue')).default
  component.ssrRender = undefined;component.render = () => null
  const renderer = createTestRenderer()
  props = runtime.reactive({active: true, config: {interfaceFont: 'inter', interfaceSkin: 'default',
    interfaceVisibility: {popupQuickFeatures: true, popupSiteRule: true, popupFooter: true},
    popupModuleOrder: ['translation', 'siteRule', 'quickFeatures', 'footer'],
    popupQuickFeatureOrder: ['hover', 'selection', 'appearance', 'image', 'document', 'highlight'],
    popupQuickFeatureVisibility: {hover: true, selection: true, appearance: false, image: true, document: true, highlight: true},
    informationHighlight: {mode: 'surprisal-local', density: 'high', color: 'mint', style: 'underline'}}})
  visible = runtime.ref(true);app = renderer.createApp({setup: () => () => runtime.h(runtime.KeepAlive, null, {default: () => visible.value
    ? runtime.h(component, {...props, ref: (vm: any) => {if (vm) state = vm.$.setupState}}) : runtime.h({render: () => null}, {key: 'other'})})})
  app.provide(runtime.ssrContextKey, {modules: new Set<string>()});app.config.warnHandler = () => {};app.mount({});await settle()
})
afterEach(async () => {app?.unmount();cancelLegacy?.();await begun;await server?.close();delete (globalThis as any)[key]})

describe('实际界面字体设置与所属确认', () => {
  it('取消和重复打开不清除缓存、不改字体，重复请求只保留一次确认', async () => {
    begin();begin();expect(open()).toBe(true);expect(confirm.mock.calls.length).toBeLessThanOrEqual(1)
    await cancel();expect(clear).not.toHaveBeenCalled();expect(props.config.interfaceFont).toBe('inter')
  })
  it('确认清除当前字体只执行一次，成功回到系统字体并反馈', async () => {
    begin();await accept();await accept();expect(clear).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledWith('inter');expect(props.config.interfaceFont).toBe('system')
    expect(feedback).toHaveBeenCalledTimes(1);expect(state.clearingFont).toBe(null);expect(open()).toBe(false)
  })
  it('清除另一个已下载字体保留当前方案，失败反馈后可以重试', async () => {
    clear.mockRejectedValueOnce(new Error('cache denied'));begin('noto-serif-sc');await accept()
    expect(props.config.interfaceFont).toBe('inter');expect(feedback.mock.calls[0][0].type).toBe('error')
    begin('noto-serif-sc');await accept();expect(feedback.mock.calls.at(-1)?.[0].type).toBe('success')
    expect(props.config.interfaceFont).toBe('inter')
  })
  it('确认期间缓存或下载状态改变时重验清除资格', async () => {
    begin();status.value = {font: 'inter', status: 'loading'};await accept()
    expect(clear).not.toHaveBeenCalled();expect(props.config.interfaceFont).toBe('inter')
  })
  it('新确认框的旧按钮句柄不能确认或取消后来打开的另一个字体', async () => {
    // 这是新增所属确认框的回归约束，旧源码的服务 Promise 没有这些按钮句柄。
    if (!state.fontClearActions) return
    begin();const old = state.fontClearActions;await cancel();begin('noto-serif-sc')
    old.cancel();await old.confirm();expect(open()).toBe(true);expect(clear).not.toHaveBeenCalled()
    await state.fontClearActions.confirm();expect(clear).toHaveBeenCalledWith('noto-serif-sc')
    expect(props.config.interfaceFont).toBe('inter')
  })
  it.each(['hidden', 'config', 'font', 'panel', 'cached', 'unmount'])('%s 后关闭确认，迟到确认无效；可见的新配置允许新确认', async reason => {
    begin();mutate(reason);await settle()
    // 旧版本的服务确认仍由自身 promise 收到迟到同意；新版本的所属确认已关闭。
    await accept();expect(clear).not.toHaveBeenCalled();expect(open()).toBe(false)
    expect(props.config.interfaceFont).toBe(reason === 'font' ? 'roboto' : 'inter')
    begin();expect(open()).toBe(reason === 'config' || reason === 'font')
    if (open()) await cancel()
  })
  it.each(['hidden', 'config', 'font', 'cached', 'unmount'])('已确认清除的成功在 %s 后不再写配置或显示反馈', async reason => {
    const pending = deferred();clear.mockReturnValueOnce(pending.promise);begin();const job = accept()
    await settle();expect(clear).toHaveBeenCalledOnce();mutate(reason);await settle();pending.resolve();await job
    expect(feedback).not.toHaveBeenCalled();expect(props.config.interfaceFont).toBe(reason === 'font' ? 'roboto' : 'inter')
    expect(state.clearingFont).toBe(null)
  })
  it.each(['hidden', 'config', 'font', 'cached', 'unmount'])('已确认清除的失败在 %s 后不再显示旧反馈', async reason => {
    const pending = deferred();clear.mockReturnValueOnce(pending.promise);begin();const job = accept()
    await settle();mutate(reason);await settle();pending.reject(new Error('late failure'));await job
    expect(feedback).not.toHaveBeenCalled();expect(state.clearingFont).toBe(null)
  })
  it('隐藏期间不选择、重试或排队清除，激活后允许新的操作', async () => {
    props.active = false;await settle();state.selectInterfaceFont('roboto');status.value = {font: 'inter', status: 'error'}
    state.selectInterfaceFont('inter');begin();expect(retry).not.toHaveBeenCalled();expect(open()).toBe(false)
    expect(props.config.interfaceFont).toBe('inter');props.active = true;await settle();state.selectInterfaceFont('inter')
    expect(retry).toHaveBeenCalledOnce();state.selectInterfaceFont('roboto');expect(props.config.interfaceFont).toBe('roboto')
    expect(refresh).toHaveBeenCalledTimes(2)
  })
  it('字体清除容量保留共享中文，系统与无独占资源的方案不提供清除', () => {
    expect(state.canClearFont('system')).toBe(false);expect(state.canClearFont('noto-sans-sc')).toBe(false)
    expect(state.canClearFont('inter')).toBe(true);expect(state.clearFontSize('system')).toBe('0 B')
    expect(state.clearFontSize('inter')).toMatch(/(KB|MB)$/)
  })
  it('布局修改只在所属界面生效；合法顺序和显隐仍按注册表归一化', async () => {
    props.active = false;await settle();const previous = JSON.stringify(props.config)
    state.setPopupModuleOrder(['footer']);state.setPopupModuleVisibility('quickFeatures', false)
    state.setPopupQuickFeatureOrder(['image']);state.setPopupQuickFeatureVisibility('image', false)
    expect(JSON.stringify(props.config)).toBe(previous)
    props.active = true;props.activePanel = 'layout';await settle();state.setPopupModuleOrder(['footer', 'footer', 'unknown'])
    state.setPopupModuleVisibility('quickFeatures', false);state.setPopupQuickFeatureOrder(['image', 'image', 'unknown'])
    state.setPopupQuickFeatureVisibility('image', false)
    expect(props.config.popupModuleOrder[0]).toBe('footer');expect(props.config.popupModuleOrder).toHaveLength(4)
    expect(props.config.interfaceVisibility.popupQuickFeatures).toBe(false);expect(props.config.popupQuickFeatureOrder).toHaveLength(5)
    expect(props.config.popupQuickFeatureVisibility.image).toBe(false)
  })
  it('布局键盘导航在隐藏时不抢焦点，激活后支持方向键和 Home/End', async () => {
    const focus = [vi.fn(), vi.fn()], preventDefault = vi.fn()
    const key = (value: string) => ({key: value, preventDefault,
      currentTarget: {querySelectorAll: () => focus.map(fn => ({focus: fn}))}} as unknown as KeyboardEvent)
    props.active = false;await settle();state.handleLayoutTabKeydown(key('End'))
    expect(preventDefault).not.toHaveBeenCalled();expect(focus[1]).not.toHaveBeenCalled()
    props.active = true;props.activePanel = 'layout';await settle()
    for (const value of ['End', 'Home', 'ArrowRight', 'ArrowLeft']) state.handleLayoutTabKeydown(key(value))
    expect(preventDefault).toHaveBeenCalledTimes(4);expect(focus[0]).toHaveBeenCalledTimes(2);expect(focus[1]).toHaveBeenCalledTimes(2)
    state.handleLayoutTabKeydown(key('Escape'));expect(preventDefault).toHaveBeenCalledTimes(4)
    expect(state.activeLayoutPanel).toBe('popupModule')
  })
  it('皮肤单选组支持四方向循环和 Home/End，并聚焦到新选中项', async () => {
    const options: {value: string}[] = state.groupedSkinOptions.flatMap((group: {options: {value: string}[]}) => group.options)
    const focus = options.map(() => vi.fn()), preventDefault = vi.fn()
    const key = (value: string) => ({key: value, preventDefault,
      currentTarget: {querySelectorAll: () => focus.map((fn, index) => ({dataset: {skin: options[index].value}, focus: fn}))}} as unknown as KeyboardEvent)
    expect(state.handleSkinKeydown).toBeTypeOf('function')
    state.handleSkinKeydown(key('ArrowRight'))
    expect(props.config.interfaceSkin).toBe(options[1].value);expect(focus[1]).toHaveBeenCalledOnce()
    state.handleSkinKeydown(key('ArrowDown'));expect(props.config.interfaceSkin).toBe(options[2].value)
    state.handleSkinKeydown(key('ArrowUp'));expect(props.config.interfaceSkin).toBe(options[1].value)
    state.handleSkinKeydown(key('Home'));expect(props.config.interfaceSkin).toBe(options[0].value)
    state.handleSkinKeydown(key('ArrowLeft'));expect(props.config.interfaceSkin).toBe(options.at(-1)!.value)
    state.handleSkinKeydown(key('ArrowRight'));expect(props.config.interfaceSkin).toBe(options[0].value)
    state.handleSkinKeydown(key('End'));expect(props.config.interfaceSkin).toBe(options.at(-1)!.value)
    state.handleSkinKeydown(key('Escape'));expect(preventDefault).toHaveBeenCalledTimes(7)
  })
  it('皮肤控件失活或离开所属分类时不改配置、不抢焦点，恢复后仍可选择', async () => {
    const focus = vi.fn(), preventDefault = vi.fn()
    const key = {key: 'End', preventDefault, currentTarget: {querySelectorAll: () => [{dataset: {skin: 'compact'}, focus}]}} as unknown as KeyboardEvent
    expect(state.selectInterfaceSkin).toBeTypeOf('function')
    props.active = false;await settle();state.selectInterfaceSkin('compact');state.handleSkinKeydown(key)
    expect(props.config.interfaceSkin).toBe('default');expect(focus).not.toHaveBeenCalled();expect(preventDefault).not.toHaveBeenCalled()
    props.active = true;props.activePanel = 'layout';await settle();state.selectInterfaceSkin('compact');state.handleSkinKeydown(key)
    expect(props.config.interfaceSkin).toBe('default')
    props.activePanel = 'skin';await settle();state.selectInterfaceSkin('compact');expect(props.config.interfaceSkin).toBe('compact')
    state.selectInterfaceSkin('unknown');expect(props.config.interfaceSkin).toBe('compact')
    visible.value = false;await settle();state.handleSkinKeydown(key);expect(focus).not.toHaveBeenCalled()
  })
  it('扩展和 userscript 的 Popup 布局均隐藏历史高亮入口，不写回非法 id 或改动阅读偏好', async () => {
    expect(state.popupQuickFeatureEditorItems.some((item: {id: string}) => item.id === 'highlight')).toBe(false)
    const saved = JSON.stringify(props.config)
    state.setPopupQuickFeatureVisibility('highlight', false); expect(JSON.stringify(props.config)).toBe(saved)
    capabilities.browser = 'userscript'; await settle()
    expect(state.popupQuickFeatureEditorItems.some((item: {id: string}) => item.id === 'highlight')).toBe(false)
    state.setPopupQuickFeatureVisibility('highlight', false)
    expect(JSON.stringify(props.config)).toBe(saved)
    capabilities.browser = 'chrome'; await settle()
    expect(state.popupQuickFeatureEditorItems.some((item: {id: string}) => item.id === 'highlight')).toBe(false)
  })
  it('所有皮肤样例与传入布局都不预览已移除的高亮或未知入口，保留传入对象', async () => {
    const component = (await server.ssrLoadModule('/src/features/settings/ui/components/PopupPreview.vue')).default
    component.ssrRender = undefined; component.render = () => null
    let preview: Record<string, any> = {}
    const inputs = runtime.reactive({skin: {value: 'default'}, quickFeatures: undefined as undefined | {id: string; label: string}[]})
    const previewApp = createTestRenderer().createApp({setup: () => () => runtime.h(component, {...inputs, ref: (vm: any) => {if (vm) preview = vm.$.setupState}})})
    previewApp.provide(runtime.ssrContextKey, {modules: new Set<string>()}); previewApp.config.warnHandler = () => {}
    try {
      previewApp.mount({}); await settle()
      expect(preview.orderedQuickFeatures.some((item: {id: string}) => item.id === 'highlight')).toBe(false)
      capabilities.browser = 'userscript'; await settle()
      expect(preview.orderedQuickFeatures.some((item: {id: string}) => item.id === 'highlight')).toBe(false)
      inputs.quickFeatures = [{id: 'highlight', label: 'Saved extension preference'}, {id: 'selection', label: 'Selection'}, {id: 'future', label: 'Unknown'}]; await settle()
      expect(preview.orderedQuickFeatures.map((item: {id: string}) => item.id)).toEqual(['selection'])
      capabilities.browser = 'chrome'; await settle()
      expect(preview.orderedQuickFeatures.map((item: {id: string}) => item.id)).toEqual(['selection'])
      expect(inputs.quickFeatures.map(item => item.id)).toEqual(['highlight', 'selection', 'future'])
    } finally {previewApp.unmount()}
  })
  it('userscript 构建条件独立阻止高亮配置与预览，并移除专属图标数据', async () => {
    app.unmount(); await server.close(); server = await createFixtureServer('userscript')
    const saved = JSON.stringify(props.config)
    const component = (await server.ssrLoadModule('/src/features/settings/ui/InterfaceSettings.vue')).default
    component.ssrRender = undefined; component.render = () => null
    app = createTestRenderer().createApp({setup: () => () => runtime.h(component, {...props, ref: (vm: any) => {if (vm) state = vm.$.setupState}})})
    app.provide(runtime.ssrContextKey, {modules: new Set<string>()}); app.config.warnHandler = () => {}; app.mount({}); await settle()
    expect(capabilities.browser).toBe('chrome')
    expect(state.popupQuickFeatureEditorItems.some((item: {id: string}) => item.id === 'highlight')).toBe(false)
    state.setPopupQuickFeatureVisibility('highlight', false); expect(JSON.stringify(props.config)).toBe(saved)
    const previewComponent = (await server.ssrLoadModule('/src/features/settings/ui/components/PopupPreview.vue')).default
    previewComponent.ssrRender = undefined; previewComponent.render = () => null
    let preview: Record<string, any> = {}
    const previewApp = createTestRenderer().createApp({setup: () => () => runtime.h(previewComponent,
      {skin: {value: 'default'}, ref: (vm: any) => {if (vm) preview = vm.$.setupState}})})
    previewApp.provide(runtime.ssrContextKey, {modules: new Set<string>()}); previewApp.config.warnHandler = () => {}
    try {
      previewApp.mount({}); await settle()
      expect(preview.orderedQuickFeatures.some((item: {id: string}) => item.id === 'highlight')).toBe(false)
      expect((await server.ssrLoadModule('/src/ui/popupQuickFeatureIcons.ts')).popupQuickFeatureIconPaths).not.toHaveProperty('highlight')
    } finally {previewApp.unmount()}
  })
  it.each(['missing', 'empty', 'embedded'] as const)('实际 Popup 预览图标 %s 时复用官方脚本资源或扩展回退', async kind => {
    const original = Object.getOwnPropertyDescriptor(globalThis, '__FLUENTREAD_ICON_DATA__')
    const officialIcon = `data:image/png;base64,${readFileSync(resolve(process.cwd(), 'public/icon/64.png')).toString('base64')}`
    try {
      if (kind === 'missing') delete globalThis.__FLUENTREAD_ICON_DATA__
      else Object.defineProperty(globalThis, '__FLUENTREAD_ICON_DATA__', {configurable: true, writable: true, value: kind === 'empty' ? '' : officialIcon})
      const component = (await server.ssrLoadModule('/src/features/settings/ui/components/PopupPreview.vue')).default
      const previewApp = runtime.createSSRApp({render: () => runtime.h(component, {skin: {value: 'default'}})})
      previewApp.config.warnHandler = () => {}
      const html = await renderToString(previewApp)
      const {document} = parseHTML(`<html><body>${html}</body></html>`)
      const logos = document.querySelectorAll('img.preview-logo')
      expect(logos).toHaveLength(1)
      expect(logos[0].getAttribute('src')).toBe(kind === 'embedded' ? officialIcon : '/icon/128.png')
      expect(logos[0].getAttribute('width')).toBe('32')
      expect(logos[0].getAttribute('height')).toBe('32')
    } finally {
      if (original) Object.defineProperty(globalThis, '__FLUENTREAD_ICON_DATA__', original)
      else delete globalThis.__FLUENTREAD_ICON_DATA__
    }
  })
})

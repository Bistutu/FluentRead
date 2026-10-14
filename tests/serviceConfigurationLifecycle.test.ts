import {createRequire} from 'node:module'
import {dirname, resolve} from 'node:path'
import vue from '@vitejs/plugin-vue'
import {compileVueInlineFixture} from './helpers/compiledVueFixture'
import {createServer, type Plugin, type ViteDevServer} from 'vite'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {Config} from '@/src/core/config/model'
import {FREE_TRANSLATION_PROVIDERS} from '@/src/core/config/freeTranslation'
import {defaultOption, options} from '@/src/core/config/catalog'

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue')
const key = '__frServiceConfigurationLifecycle'
let server: ViteDevServer, app: import('vue').App, state: Record<string, any>
let props: {config: Config; service: string; active: boolean; selectedModelThinking: boolean; compute: Record<string, any>;
  options: typeof options; isValidAzureEndpoint: (value: string) => boolean; customProvider?: {id: string; name: string; endpoint: string; models: string[]}}
let visible: import('vue').Ref<boolean>
const send = vi.fn(), save = vi.fn(), queue = vi.fn(), read = vi.fn(), clear = vi.fn(), prepare = vi.fn(), confirm = vi.fn(), feedback = vi.fn(), emitDelete = vi.fn(), emitProvider = vi.fn()
const subscriptions: {callback: (value: any) => void; stopped: boolean}[] = []
const releases: (() => void)[] = [], jobs: Promise<unknown>[] = [], confirmations: {resolve: (value?: unknown) => void; reject: (error: unknown) => void}[] = []
function pending() {let resolve!: (value?: any) => void, reject!: (error: unknown) => void
  const promise = new Promise<any>((yes, no) => {resolve = yes;reject = no});releases.push(() => resolve());return {promise, resolve, reject}}
async function settle() {for (let i = 0; i < 16; i++) await Promise.resolve();await runtime.nextTick();await runtime.nextTick()}
function check(single = false) {const job = (single ? state.testSingleApiKey(0) : state.testConnection()) as Promise<void>;jobs.push(job);return job}
function messages() {return send.mock.calls.filter(([message]) => message.type === 'testTranslationService')}
function mutate(reason: string) {
  if (reason === 'hidden') props.active = false
  if (reason === 'cached') visible.value = false
  if (reason === 'unmount') app.unmount()
  if (reason === 'config') props.config = runtime.reactive(Object.assign(new Config(), {apiKeys: {...props.config.apiKeys}, token: {...props.config.token}}))
  if (reason === 'service') props.service = 'openai'
  if (reason === 'key') props.config.token.deepseek = 'changed-fixture'
}
function openAction(kind: 'reset' | 'delete') {if (kind === 'reset') state.resetCustomTemplate();else state.confirmDeleteProvider()}
async function acceptAction(index = 0) {
  if (state.serviceActionButtons) state.serviceActionButtons.confirm()
  else confirmations[index]?.resolve()
  await settle()
}
beforeEach(async () => {
  vi.clearAllMocks();subscriptions.length = 0;releases.length = 0;jobs.length = 0;confirmations.length = 0
  queue.mockResolvedValue(undefined);save.mockResolvedValue(undefined);read.mockResolvedValue(null);clear.mockResolvedValue(undefined)
  send.mockResolvedValue({success: true, durationMs: 25});prepare.mockResolvedValue({sourceLanguage: 'en', targetLanguage: 'zh'})
  confirm.mockImplementation(() => {const item = pending();confirmations.push(item);return item.promise})
  Object.assign(globalThis, {[key]: {send, save, queue, read, clear, prepare, confirm, feedback, subscriptions}})
  const mocks: Plugin = {name: 'service-configuration-ports', enforce: 'pre', resolveId(id) {
    if (id.endsWith('.vue') && !id.endsWith('ServiceConfiguration.vue')) return '\0service-child'
    if (id === 'webextension-polyfill') return '\0service-browser'
    if (id === 'element-plus') return '\0service-element'
    if (/\/src\/ui\/i18n(?:\.ts)?$/u.test(id)) return '\0service-i18n'
    if (/\/src\/platform\/chatgpt-plan\/buildMode(?:\.ts)?$/u.test(id)) return '\0service-build-mode'
    if (/\/src\/services\/config\/store(?:\.ts)?$/u.test(id)) return '\0service-config'
    if (/\/src\/platform\/browser\/chromeTranslationPreparationRequest(?:\.ts)?$/u.test(id)) return '\0service-chrome-store'
    if (/\/src\/features\/settings\/model\/chromeTranslationPreparation(?:\.ts)?$/u.test(id)) return '\0service-chrome-preparation'
    return null
  }, load(id) {
    if (id === '\0service-child') return 'export default {render: () => null}'
    if (id === '\0service-build-mode') return 'export const chatGPTPlanDevelopmentEnabled = false'
    if (id === '\0service-browser') return `export default {runtime: {sendMessage: globalThis.${key}.send}}`
    if (id === '\0service-config') return `export const {queue: waitForConfigPersistenceQueue, save: requestConfigSave} = globalThis.${key}`
    if (id === '\0service-element') return `export const ElMessage = {success: globalThis.${key}.feedback};export const ElMessageBox = {confirm: globalThis.${key}.confirm};export const ElTabs = {}, ElTabPane = {}`
    if (id === '\0service-i18n') return "import {ref} from 'vue';export const useUiI18n = () => ({language: ref('zh-CN'), t: key => key, translateLegacy: text => text})"
    if (id === '\0service-chrome-store') return `export const chromeTranslationPreparationStore = {get: globalThis.${key}.read, clear: globalThis.${key}.clear, subscribe: callback => {
      const item = {callback, stopped: false};globalThis.${key}.subscriptions.push(item);return () => {item.stopped = true}}}`
    if (id === '\0service-chrome-preparation') return `export class ChromeTranslationPreparationError extends Error {constructor(code, message, params) {super(message);this.code = code;this.params = params}}
      export const prepareChromeTranslationInPage = globalThis.${key}.prepare;
      export const resolveChromeTranslationPreparationPair = (from, to) => ({sourceLanguage: from === 'auto' ? 'en' : from, targetLanguage: to});
      export const getChromeTranslationPreparationLanguageLabel = language => language;`
    return null
  }}
  server = await createServer({root: process.cwd(), configFile: false, appType: 'custom', logLevel: 'silent',
    plugins: [mocks, vue()], resolve: {alias: {'@': resolve(process.cwd())}}, ssr: {noExternal: ['webextension-polyfill', 'element-plus']},
    // 本夹具只加载实际 SFC，不测试文件变化；hmr:false 仍会启动 Chokidar。
    // 禁用观察，避免 Node fs.watch 的异步节流进入组件的 fake clock 清理断言。
    server: {hmr: false, middlewareMode: true, watch: null}})
  const component = (await server.ssrLoadModule('/src/features/settings/ui/services/ServiceConfiguration.vue')).default
  component.ssrRender = undefined;component.render = () => null
  const renderer = runtime.createRenderer<Record<string, never>, Record<string, unknown>>({patchProp: () => {}, insert: () => {},
    remove: () => {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText: () => {},
    setElementText: () => {}, parentNode: () => null, nextSibling: () => null, querySelector: () => null,
    setScopeId: () => {}, cloneNode: () => ({}), insertStaticContent: () => [{}, {}]})
  const config = runtime.reactive(new Config());config.model.deepseek = 'future-vision';config.apiKeys.deepseek = ['fixture-first', 'fixture-second'];config.token.deepseek = 'fixture-first'
  props = runtime.reactive({config, service: 'deepseek', active: true, selectedModelThinking: false, options, isValidAzureEndpoint: () => true,
    compute: {showAI: true, showModel: true, showToken: true, requireApiKey: true, showServiceSecret: false}, customProvider: undefined})
  visible = runtime.ref(true);app = renderer.createApp({setup: () => () => runtime.h(runtime.KeepAlive, null, {default: () => visible.value
    ? runtime.h(component, {...props, 'onDelete:custom-provider': emitDelete, 'onUpdate:custom-provider': emitProvider,
      ref: (vm: any) => {if (vm) state = vm.$.setupState}}) : runtime.h({render: () => null}, {key: 'other'})})})
  app.provide(runtime.ssrContextKey, {modules: new Set<string>()});app.config.warnHandler = () => {};app.mount({});await settle()
  vi.stubGlobal('window', {setTimeout, clearTimeout})
})
afterEach(async () => {
  app?.unmount();for (const release of releases) release();await settle();await Promise.allSettled(jobs)
  await server?.close();delete (globalThis as any)[key];vi.unstubAllGlobals();vi.useRealTimers()
})

describe('实际服务连接配置的活跃生命周期与确认归属', () => {
  it('公开套餐旧配置没有设置页签，直接测试或提示词操作也不发消息或修改配置', async () => {
    props.config.model.chatgptPlan = 'saved-account-model';props.config.system_role.chatgptPlan = 'saved-system';props.config.user_role.chatgptPlan = 'saved-user'
    props.service = 'chatgptPlan';props.compute.showToken = false;await settle()
    const saved = JSON.stringify(props.config)
    expect(state.settingsTabs).toEqual({translation: false, prompts: false, requests: false, 'custom-request': false})
    expect(state.connectionTestDisabled).toBe(true)
    await state.testConnection();state.activeSettingsTab = 'prompts';await settle();state.resetCustomTemplate();state.syncPromptTemplates();await settle()
    expect(state.serviceActionOpen).toBe(false);expect(send).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();expect(queue).not.toHaveBeenCalled()
    expect(JSON.stringify(props.config)).toBe(saved)
  })
  it('当前模型限额随请求体实际模型变化，选择器模型继续用于其他设置', async () => {
    props.service = 'ollama';props.config.model.ollama = 'gemma3:4b';props.config.customBody.ollama = '{"model":" qwen3:8b "}';await settle()
    expect(state.effectiveModelLabel).toBe('gemma3:4b');expect(state.requestLimitModel).toBe('qwen3:8b')
    props.config.customBody.ollama = '{"model":"{{model}}"}';await settle();expect(state.requestLimitModel).toBe('{{model}}')
    props.config.customBody.ollama = '{invalid';await settle();expect(state.requestLimitModel).toBe('gemma3:4b')
    props.service = 'gemini';props.config.model.gemini = 'gemini-2.5-pro';props.config.customBody.gemini = '{"model":"ignored"}';await settle()
    expect(state.requestLimitModel).toBe('gemini-2.5-pro')
  })

  it.each(['queue', 'save', 'response'])('单Key检查在%s的隐藏、缓存停用或卸载后立即收束且不写迟到结果', async phase => {
    for (const reason of ['hidden', 'cached', 'unmount']) {
      if (reason === 'cached') {props.active = true;await settle()}
      if (reason === 'unmount') {visible.value = true;await settle()}
      const stalled = pending();if (phase === 'queue') queue.mockReturnValueOnce(stalled.promise)
      if (phase === 'save') save.mockReturnValueOnce(stalled.promise)
      if (phase === 'response') send.mockReturnValueOnce(stalled.promise)
      let ended = false;const job = check(true).then(() => {ended = true});await settle();mutate(reason);await settle()
      expect(ended).toBe(true);expect(state.connectionTestBusy).toBe(false);expect(state.connectionTestState).toBe('idle')
      const result = JSON.stringify(state.apiKeyChecks);stalled.resolve({success: true});await job;expect(JSON.stringify(state.apiKeyChecks)).toBe(result)
    }
  })
  it('配置对象替换即使指纹相同也取消旧检查，旧队列不得保存新对象', async () => {
    const waiting = pending();queue.mockReturnValueOnce(waiting.promise);const job = check();await settle();mutate('config');await settle()
    waiting.resolve();await job;expect(save).not.toHaveBeenCalled();expect(messages()).toHaveLength(0);expect(state.connectionTestBusy).toBe(false)
  })
  it('正常多Key检查按先保存后请求执行，停止后保留已完成结果并拒绝旧请求', async () => {
    const second = pending();send.mockResolvedValueOnce({success: true, durationMs: 7}).mockReturnValueOnce(second.promise)
    const job = check();await settle();expect(save).toHaveBeenCalledOnce();expect(messages()).toHaveLength(2)
    expect(state.apiKeyChecks[0]).toMatchObject({status: 'success', durationMs: 7});state.stopApiKeyChecks();await settle()
    expect(state.connectionTestBusy).toBe(false);expect(state.apiKeyChecks[1].status).toBe('idle');second.resolve({success: true});await job
    expect(state.apiKeyChecks[1].status).toBe('idle');expect(state.apiKeyChecks[0].status).toBe('success')
  })
  it('隐藏时不开始检查或编辑密钥、策略、邮箱及自定义服务', async () => {
    props.active = false;await settle();const before = JSON.stringify(props.config);state.myMemoryEmailDraft = 'new@example.com'
    state.commitMyMemoryEmail();state.updateApiKey(0, 'late');state.removeApiKey(0);state.addApiKey();state.setApiKeyRotationEnabled(false)
    state.setApiKeyRequirement({target: {value: 'optional'}});state.updateCustomProvider('name', 'late');await check();await check(true)
    expect(JSON.stringify(props.config)).toBe(before);expect(props.compute.requireApiKey).toBe(true);expect(emitProvider).not.toHaveBeenCalled();expect(queue).not.toHaveBeenCalled()
  })
  it('免费检查覆盖全目录，隐藏时结束三项在途等待，迟到结果不再排队其余服务', async () => {
    props.service = 'freeTranslation';props.compute.showToken = false;await settle();const delayed = pending();send.mockReturnValue(delayed.promise)
    let ended = false;const job = check().then(() => {ended = true});await settle();expect(messages()).toHaveLength(3)
    props.active = false;await settle();expect(ended).toBe(true);delayed.resolve({success: true});await job;expect(messages()).toHaveLength(3)
    props.active = true;send.mockResolvedValue({success: true});await settle();send.mockClear();await check()
    expect(messages().map(([message]) => message.freeProviderId)).toEqual(FREE_TRANSLATION_PROVIDERS.map(provider => provider.id))
  })
  it('Chrome待准备提示只在活跃Chrome服务订阅，旧读和通知不能覆盖新代际', async () => {
    expect(read).not.toHaveBeenCalled();expect(subscriptions).toHaveLength(0)
    const first = pending();read.mockReturnValueOnce(first.promise);props.service = 'chromeTranslator';await settle();expect(subscriptions).toHaveLength(1)
    subscriptions[0].callback({sourceLanguage: 'fr', targetLanguage: 'zh'});await settle();first.resolve({sourceLanguage: 'de', targetLanguage: 'zh'});await settle()
    expect(state.pendingChromePreparation.sourceLanguage).toBe('fr');props.active = false;await settle();expect(subscriptions[0].stopped).toBe(true)
    props.active = true;read.mockResolvedValueOnce({sourceLanguage: 'es', targetLanguage: 'zh'});await settle();subscriptions[0].callback({sourceLanguage: 'de', targetLanguage: 'zh'});await settle()
    expect(state.pendingChromePreparation.sourceLanguage).toBe('es');props.service = 'deepseek';await settle();expect(subscriptions[1].stopped).toBe(true)
  })
  it('Chrome点击立即启动准备，隐藏可中断忽略取消的准备，迟到状态不写界面', async () => {
    props.service = 'chromeTranslator';props.compute.showToken = false;await settle();const delayed = pending();prepare.mockReturnValueOnce(delayed.promise)
    let ended = false;const job = check().then(() => {ended = true});expect(prepare).toHaveBeenCalledOnce();expect(queue).toHaveBeenCalledOnce()
    const input = prepare.mock.calls[0][0];await settle();props.active = false;await settle();expect(input.signal.aborted).toBe(true);expect(ended).toBe(true)
    const before = state.connectionTestMessage;input.onStatus({phase: 'verifying', sourceLanguage: 'en', targetLanguage: 'zh'});delayed.resolve({sourceLanguage: 'en', targetLanguage: 'zh'});await job
    expect(state.connectionTestMessage).toBe(before);expect(clear).not.toHaveBeenCalled()
  })
  it('Chrome准备成功不被挂起的提示清理阻塞，清理只接收已完成语言对', async () => {
    props.service = 'chromeTranslator';props.compute.showToken = false;await settle();const delayed = pending();clear.mockReturnValueOnce(delayed.promise)
    let ended = false;const job = check().then(() => {ended = true});await settle();expect(ended).toBe(true)
    expect(state.connectionTestState).toBe('success');expect(clear).toHaveBeenCalledWith({sourceLanguage: 'en', targetLanguage: 'zh'});delayed.resolve();await job
  })
  it('Chrome总等待预算从点击起计，配置保存耗时也在五分钟内', async () => {
    props.service = 'chromeTranslator';props.compute.showToken = false;await settle();vi.useFakeTimers()
    const waiting = pending(), delayed = pending();queue.mockReturnValueOnce(waiting.promise);prepare.mockReturnValueOnce(delayed.promise)
    let ended = false;const job = check().then(() => {ended = true});await settle();await vi.advanceTimersByTimeAsync(5000)
    waiting.resolve();await settle();await vi.advanceTimersByTimeAsync(294999);expect(ended).toBe(false)
    await vi.advanceTimersByTimeAsync(1);await settle();expect(ended).toBe(true);expect(prepare.mock.calls[0][0].signal.aborted).toBe(true)
    expect(state.connectionTestMessage).toBe('settings.services.chromePreparation.error.timeout');expect(vi.getTimerCount()).toBe(0)
    delayed.resolve({sourceLanguage: 'en', targetLanguage: 'zh'});await job;expect(state.connectionTestState).toBe('error')
  })
  it.each(['queue', 'save', 'response'])('服务%s超时退出，后续重试成功且没有残留计时器', async phase => {
    vi.useFakeTimers();const delayed = pending();if (phase === 'queue') queue.mockReturnValueOnce(delayed.promise)
    if (phase === 'save') save.mockReturnValueOnce(delayed.promise);if (phase === 'response') send.mockReturnValueOnce(delayed.promise)
    let ended = false;const job = check(true).then(() => {ended = true});await settle()
    const timeoutMs = phase === 'response' ? 45000 : 10000
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(timeoutMs - 1);await settle()
    expect(ended).toBe(false);expect(state.connectionTestBusy).toBe(true);expect(state.connectionTestState).toBe('testing')
    expect(messages()).toHaveLength(phase === 'response' ? 1 : 0)
    await vi.advanceTimersByTimeAsync(1);await settle();expect(ended).toBe(true)
    expect(state.connectionTestBusy).toBe(false);expect(state.connectionTestState).toBe('error');expect(vi.getTimerCount()).toBe(0)
    expect(state.apiKeyChecks[0]).toMatchObject({status: 'error', error: phase === 'response'
      ? 'settings.services.keys.responseTimeout' : 'settings.services.keys.configTimeout'})
    delayed.resolve({success: true});await job;await settle()
    expect(state.connectionTestState).toBe('error');expect(state.apiKeyChecks[0].status).toBe('error');expect(vi.getTimerCount()).toBe(0)
    await check(true);await settle()
    expect(state.connectionTestState).toBe('success');expect(state.connectionTestBusy).toBe(false)
    expect(state.apiKeyChecks[0]).toMatchObject({status: 'success', durationMs: 25})
    expect(messages()).toHaveLength(phase === 'response' ? 2 : 1);expect(vi.getTimerCount()).toBe(0)
  })
  it('非法或已经不存在的密钥行不写配置、重置检查或发出请求', async () => {
    const before = JSON.stringify(props.config)
    for (const index of [-1, 2.5, 99]) {state.updateApiKey(index, 'late');state.removeApiKey(index);await state.testSingleApiKey(index)}
    expect(JSON.stringify(props.config)).toBe(before);expect(queue).not.toHaveBeenCalled()
  })
  it('恢复确认中的模板编辑、离开页签及删除确认中的服务重命名会关闭旧确认', async () => {
    props.compute.showCustomOpenAI = true;props.customProvider = {id: 'deepseek', name: 'Fixture', endpoint: 'https://fixture.invalid/', models: []}
    state.activeSettingsTab = 'prompts';await settle();openAction('reset');props.config.system_role.deepseek = 'newer-edit';await settle();await acceptAction()
    expect(props.config.system_role.deepseek).toBe('newer-edit');expect(feedback).not.toHaveBeenCalled()
    openAction('reset');state.activeSettingsTab = 'translation';await settle();await acceptAction(1);expect(props.config.system_role.deepseek).toBe('newer-edit')
    openAction('delete');props.customProvider.name = 'New label';await settle();await acceptAction(2);expect(emitDelete).not.toHaveBeenCalled()
  })
  it.each(['reset', 'delete'] as const)('%s所属确认在隐藏、缓存停用、卸载、配置或服务改变后不操作新对象', async kind => {
    for (const reason of ['hidden', 'cached', 'config', 'service', 'unmount']) {
      props.active = true;visible.value = true;props.service = 'deepseek';props.compute.showCustomOpenAI = true
      props.customProvider = {id: 'deepseek', name: 'Fixture', endpoint: 'https://fixture.invalid/', models: []}
      props.config.system_role.deepseek = 'keep-system';props.config.user_role.deepseek = 'keep-user';props.config.system_role.openai = 'other-system';await settle()
      if (kind === 'reset') state.activeSettingsTab = 'prompts';await settle();const start = confirmations.length;openAction(kind);mutate(reason);await settle()
      const before = JSON.stringify(props.config);await acceptAction(start);expect(JSON.stringify(props.config)).toBe(before);expect(emitDelete).not.toHaveBeenCalled()
    }
  })
  it('可见确认只执行一次，恢复所属模板、取消删除，并拒绝旧按钮句柄操作新确认', async () => {
    props.compute.showCustomOpenAI = true;props.customProvider = {id: 'deepseek', name: 'Fixture', endpoint: 'https://fixture.invalid/', models: []}
    state.activeSettingsTab = 'prompts';await settle();props.config.system_role.deepseek = 'changed';openAction('reset');await acceptAction()
    expect(props.config.system_role.deepseek).toBe(defaultOption.system_role);expect(props.config.user_role.deepseek).toBe(defaultOption.user_role);expect(feedback).toHaveBeenCalledOnce()
    // 旧版本无所属按钮句柄，以上恢复行为仍与它比较。
    if (!state.serviceActionButtons) return
    openAction('delete');const old = state.serviceActionButtons;old.cancel();openAction('reset');old.confirm();old.cancel()
    expect(state.serviceActionOpen).toBe(true);expect(emitDelete).not.toHaveBeenCalled();state.serviceActionButtons.cancel()
    openAction('delete');state.serviceActionButtons.confirm();state.serviceActionButtons.confirm();expect(emitDelete).toHaveBeenCalledOnce()
  })
})

it('直接传入普通配置与 provider 对象时仍保留确认身份，不要求调用方额外代理', async () => {
  visible.value = false;await settle()
  const config = runtime.toRaw(props.config)
  const provider = {id: 'custom:raw', name: 'Raw provider', endpoint: 'https://raw.example', models: ['raw-model']}
  config.customOpenAIProviders = [provider];config.system_role[provider.id] = 'raw-system';config.user_role[provider.id] = 'raw-user'
  props = runtime.shallowReactive({...props, config, service: provider.id, customProvider: provider,
    compute: runtime.reactive({...props.compute, showCustomOpenAI: true})})
  visible.value = true;await settle();state.activeSettingsTab = 'prompts';await settle()
  state.resetCustomTemplate();await settle();expect(state.serviceActionOpen).toBe(true)
  state.serviceActionButtons.confirm();await settle();expect(config.system_role[provider.id]).toBe(defaultOption.system_role)
  expect(config.user_role[provider.id]).toBe(defaultOption.user_role)
  state.confirmDeleteProvider();await settle();expect(state.serviceActionOpen).toBe(true)
  state.serviceActionButtons.confirm();await settle();expect(emitDelete).toHaveBeenCalledTimes(1)
})


// 独立客户端夹具执行同一个父 SFC 的完整模板；仅子模块的加载与生命周期为受控端口。
// require 在模块求值阶段返回同步 child，在实际动态 import 时返回 deferred；因此旧静态
// import 会立即计入加载，不用挂起整个 beforeEach 来伪造懒加载 RED。
type ServiceClientNode = {tag: string; props: Record<string, unknown>; parent?: ServiceClientNode; children: ServiceClientNode[];
  style: Record<string, unknown>; value?: unknown; addEventListener: () => void; removeEventListener: () => void}
type LocalModule = {__esModule: true; default: import('vue').Component}
type LocalPropsSnapshot = {config: Config; context: unknown; service: string; active: boolean}
async function mountServiceClient(initialService = 'freeTranslation', development = false) {
  vi.useFakeTimers()
  const filename = resolve('src/features/settings/ui/services/ServiceConfiguration.vue')
  const compiled = compileVueInlineFixture(filename, {id: 'service-configuration-client'})
  expect(compiled.parseErrors).toEqual([])
  const snapshots: LocalPropsSnapshot[] = [], childProps: LocalPropsSnapshot[] = []
  const mounted = vi.fn(), unmounted = vi.fn(), clientErrors: unknown[] = []
  const localPort = runtime.defineComponent({
    name: 'LocalModelLifecyclePort', props: {config: Object, context: null, service: String, active: Boolean},
    setup(child) {
      runtime.onMounted(() => {
        mounted()
        snapshots.push({config: child.config as Config, context: child.context, service: child.service!, active: child.active})
        childProps.push(child as LocalPropsSnapshot)
      })
      runtime.onUnmounted(unmounted)
      return () => runtime.h('section', {'data-local-model-port': '', 'data-active': String(child.active)})
    },
  })
  // 动态 import 返回模块命名空间；Vue 据此取 default，不能用无标记普通对象代替。
  const localModule: LocalModule = {__esModule: true, default: localPort}
  const gates: {promise: Promise<LocalModule>; resolve: (value: LocalModule) => void; reject: (error: unknown) => void}[] = []
  let evaluating = true
  const requestLocal = vi.fn(() => {
    if (evaluating) return localModule
    let resolve!: (value: LocalModule) => void, reject!: (error: unknown) => void
    const promise = new Promise<LocalModule>((yes, no) => {resolve = yes;reject = no})
    const gate = {promise, resolve, reject};gates.push(gate)
    return promise
  })
  const display = runtime.defineComponent({setup: (_, {slots}) => () => runtime.h('div', slots.default?.())})
  const chatGPTPort = runtime.defineComponent({setup: () => () => runtime.h('section', {'data-chatgpt-plan-port': ''})})
  const requestChatGPT = vi.fn(() => ({__esModule: true, default: chatGPTPort}))
  const dependencies = new Map<string, unknown>([['vue', runtime], ['element-plus/es/components/tabs/style/css', {}]])
  for (const id of compiled.runtimeImports) {
    if (dependencies.has(id) || id === '../LocalTranslationModelSettings.vue' || id === './ChatGPTPlanSettings.vue') continue
    if (id === '@/src/platform/chatgpt-plan/buildMode') {dependencies.set(id, {chatGPTPlanDevelopmentEnabled: development});continue}
    if (id.endsWith('.vue')) {dependencies.set(id, {default: display});continue}
    if (id === 'element-plus') {
      dependencies.set(id, {ElMessage: {success: feedback}, ElTabs: display, ElTabPane: display});continue
    }
    const resolved = id.startsWith('.') ? resolve(dirname(filename), id) : id
    dependencies.set(id, await server.ssrLoadModule(resolved))
  }
  const module = {exports: {} as {default: import('vue').Component}}
  new Function('require', 'exports', 'module', compiled.code)((id: string) => {
    if (id === '../LocalTranslationModelSettings.vue') return requestLocal()
    if (id === './ChatGPTPlanSettings.vue') return requestChatGPT()
    if (!dependencies.has(id)) throw new Error(`Unexpected service client dependency: ${id}`)
    return dependencies.get(id)
  }, module.exports, module)
  evaluating = false
  function node(tag: string): ServiceClientNode {return {tag, props: {}, children: [], style: {}, addEventListener: () => {}, removeEventListener: () => {}}}
  function remove(n: ServiceClientNode) {
    if (n.parent) {const list = n.parent.children, index = list.indexOf(n);if (index >= 0) list.splice(index, 1)}
    n.parent = undefined
  }
  function insert(n: ServiceClientNode, parent: ServiceClientNode, anchor?: ServiceClientNode | null) {
    remove(n);const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, n);n.parent = parent
  }
  const renderer = runtime.createRenderer<ServiceClientNode, ServiceClientNode>({
    patchProp: (n, key, _before, value) => {n.props[key] = value}, insert, remove,
    createElement: node, createText: () => node('#text'), createComment: () => node('#comment'),
    setText: (n, value) => {n.value = value}, setElementText: (n, value) => {n.value = value},
    parentNode: n => n.parent || null,
    nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] || null,
    querySelector: () => null, setScopeId: () => {}, cloneNode: n => ({...n, children: []}),
    insertStaticContent: (_html, parent, anchor) => {
      const start = node('#static-start'), end = node('#static-end');insert(start, parent, anchor);insert(end, parent, anchor);return [start, end]
    },
  })
  const connectionTarget = node('section')
  const source = runtime.shallowReactive({...props, config: runtime.reactive(new Config()), service: initialService, connectionActionTarget: connectionTarget,
    active: true, compute: {showAI: false, showModel: false, showToken: false, requireApiKey: false, showServiceSecret: false}})
  const shown = runtime.ref(true), host = node('#host')
  const clientApp = renderer.createApp({setup: () => () => runtime.h(runtime.KeepAlive, null, {default: () => shown.value
    ? runtime.h(module.exports.default, source) : runtime.h({render: () => null}, {key: 'other-client'})})})
  clientApp.config.errorHandler = error => {clientErrors.push(error)}
  clientApp.config.warnHandler = () => {}
  let stopped = false
  const stop = () => {if (!stopped) {stopped = true;clientApp.unmount()}}
  const finish = async () => {stop();for (const gate of gates) gate.resolve(localModule);await settle();vi.advanceTimersByTime(200);await settle()}
  try {clientApp.mount(host);await settle()}
  catch (error) {await finish();throw error}
  const resolveLocal = (index = 0) => {expect(gates[index]).toBeDefined();gates[index].resolve(localModule)}
  function localNodes(n = host): ServiceClientNode[] {return n.children.flatMap(child => [
    ...(Object.hasOwn(child.props, 'data-local-model-port') ? [child] : []), ...localNodes(child),
  ])}
  function descendants(n: ServiceClientNode): ServiceClientNode[] {return [n, ...n.children.flatMap(descendants)]}
  const allNodes = () => [...descendants(host), ...descendants(connectionTarget)]
  return {source, shown, host, requestLocal, requestChatGPT, gates, snapshots, childProps, mounted, unmounted, clientErrors, resolveLocal, localNodes, allNodes, stop, finish}
}

describe('实际服务父模板的本地子模块按需加载', () => {
  it('公开套餐父模板没有根DOM或占位且不加载套餐子模块，保存的模型保持原值', async () => {
    const h = await mountServiceClient('chatgptPlan')
    try {
      h.source.config.model.chatgptPlan = 'saved-account-model';h.source.compute = {...h.source.compute, showAI: true, showModel: true};await settle()
      const saved = JSON.stringify(h.source.config)
      expect(h.allNodes().some(n => Object.hasOwn(n.props, 'data-connection-test-button') || Object.hasOwn(n.props, 'data-service-settings-tabs') || Object.hasOwn(n.props, 'data-configuration-group'))).toBe(false)
      expect(h.allNodes().some(n => Object.hasOwn(n.props, 'data-service-configuration-service') || Object.hasOwn(n.props, 'data-chatgpt-plan-port'))).toBe(false)
      expect(h.host.children.filter(n => !n.tag.startsWith('#'))).toEqual([]);expect(h.requestChatGPT).not.toHaveBeenCalled()
      h.source.service = 'google';await settle()
      expect(h.allNodes().some(n => n.props['data-service-configuration-service'] === 'google')).toBe(true)
      expect(h.requestChatGPT).not.toHaveBeenCalled()
      h.source.service = 'chatgptPlan';await settle()
      expect(h.allNodes().some(n => Object.hasOwn(n.props, 'data-service-configuration-service') || Object.hasOwn(n.props, 'data-chatgpt-plan-port'))).toBe(false)
      expect(h.host.children.filter(n => !n.tag.startsWith('#'))).toEqual([]);expect(h.requestChatGPT).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();expect(JSON.stringify(h.source.config)).toBe(saved);expect(h.clientErrors).toEqual([])
    } finally {await h.finish()}
  })
  it('显式开发模式的套餐仍显示原设置并通过既有连接测试消息', async () => {
    const h = await mountServiceClient('chatgptPlan', true)
    try {
      h.source.config.model.chatgptPlan = 'fixture-account-model';h.source.compute = {...h.source.compute, showAI: true};await settle()
      expect(h.requestChatGPT).toHaveBeenCalledOnce()
      expect(h.allNodes().some(n => Object.hasOwn(n.props, 'data-chatgpt-plan-port'))).toBe(true)
      const button = h.allNodes().find(n => Object.hasOwn(n.props, 'data-connection-test-button'))
      expect(button).toBeDefined()
      expect(h.allNodes().some(n => n.props['data-configuration-group'] === 'prompts')).toBe(true)
      expect(h.allNodes().some(n => n.props['data-configuration-group'] === 'requests')).toBe(true)
      await (button!.props.onClick as () => Promise<void>)();await settle();expect(messages()).toHaveLength(1);expect(messages()[0][0]).toMatchObject({type: 'testTranslationService', service: 'chatgptPlan'})
      expect(h.source.config.model.chatgptPlan).toBe('fixture-account-model');expect(h.clientErrors).toEqual([])
    } finally {await h.finish()}
  })
  it.each(['freeTranslation', 'google'])('普通服务%s不加载本地子模块或挂载模型 UI', async service => {
    const h = await mountServiceClient(service)
    try {expect(h.requestLocal).not.toHaveBeenCalled();expect(h.mounted).not.toHaveBeenCalled();expect(h.localNodes()).toHaveLength(0)}
    finally {await h.finish()}
  })
  it('显式本地服务加载一次，正常返回复用已解析模块且创建新的所属实例', async () => {
    const h = await mountServiceClient()
    try {
      expect(h.requestLocal).not.toHaveBeenCalled();h.source.service = 'localTranslation';await settle()
      expect(h.requestLocal).toHaveBeenCalledOnce();expect(h.mounted).not.toHaveBeenCalled();expect(h.localNodes()).toHaveLength(0)
      h.resolveLocal();await settle();expect(h.mounted).toHaveBeenCalledOnce();expect(h.localNodes()).toHaveLength(1)
      expect(h.snapshots[0]).toMatchObject({config: h.source.config, context: h.source.config, service: 'localTranslation', active: true})
      h.source.service = 'google';await settle();expect(h.unmounted).toHaveBeenCalledOnce();expect(h.localNodes()).toHaveLength(0)
      h.source.service = 'localTranslation';await settle();expect(h.requestLocal).toHaveBeenCalledOnce();expect(h.mounted).toHaveBeenCalledTimes(2)
      expect(h.localNodes()).toHaveLength(1);expect(h.clientErrors).toEqual([])
    } finally {await h.finish()}
  })
  it.each(['service', 'unmount'])('等待时%s移除父或条件节点，迟到模块不能挂载旧实例', async reason => {
    const h = await mountServiceClient('localTranslation')
    try {
      expect(h.requestLocal).toHaveBeenCalledOnce();expect(h.mounted).not.toHaveBeenCalled()
      if (reason === 'service') h.source.service = 'google';else h.stop()
      await settle();h.resolveLocal();await settle()
      expect(h.mounted).not.toHaveBeenCalled();expect(h.localNodes()).toHaveLength(0);expect(h.clientErrors).toEqual([])
      if (reason === 'service') {
        h.source.service = 'localTranslation';await settle();expect(h.requestLocal).toHaveBeenCalledOnce()
        expect(h.mounted).toHaveBeenCalledOnce();expect(h.snapshots[0].service).toBe('localTranslation')
      }
    } finally {await h.finish()}
  })
  it.each(['hidden', 'cached'])('等待时%s并替换配置，解析与返回都使用父模板当前归属', async reason => {
    const h = await mountServiceClient('localTranslation')
    try {
      expect(h.mounted).not.toHaveBeenCalled()
      const latest = runtime.reactive(new Config());latest.theme = 'dark';h.source.config = latest
      // 外部 props 先提交到等待中的父实例；同 job 直接移入 KeepAlive 不会提交新 VNode。
      await settle()
      if (reason === 'hidden') h.source.active = false;else h.shown.value = false
      await settle()
      const returning = reason === 'cached' ? runtime.reactive(new Config()) : latest
      if (reason === 'cached') h.source.config = returning
      h.resolveLocal();await settle()
      // KeepAlive 可在缓存容器内完成子挂载；每个实际挂载都必须是 inactive 且没有捕获旧配置。
      expect(h.snapshots.every(item => item.active === false && item.config === latest && item.context === latest)).toBe(true)
      if (reason === 'hidden') h.source.active = true;else h.shown.value = true
      await settle();expect(h.mounted).toHaveBeenCalledOnce();expect(h.localNodes()).toHaveLength(1)
      expect(h.childProps[0].active).toBe(true);expect(h.childProps[0].config).toBe(returning);expect(h.childProps[0].context).toBe(returning)
      expect(h.clientErrors).toEqual([])
    } finally {await h.finish()}
  })
  it('模块 resolve 与隐藏在同一 job 时首次子挂载不会获得旧 active', async () => {
    const h = await mountServiceClient('localTranslation')
    try {
      expect(h.mounted).not.toHaveBeenCalled();h.resolveLocal();h.source.active = false;await settle()
      expect(h.mounted).toHaveBeenCalledOnce();expect(h.snapshots[0].active).toBe(false);expect(h.childProps[0].active).toBe(false)
      h.source.active = true;await settle();expect(h.childProps[0].active).toBe(true);expect(h.requestLocal).toHaveBeenCalledOnce()
    } finally {await h.finish()}
  })
  it('加载拒绝由 Vue 观察且没有未处理拒绝，切离后重进允许一次新加载', async () => {
    const h = await mountServiceClient('localTranslation'), unhandled: unknown[] = []
    const onUnhandled = (error: unknown) => {unhandled.push(error)}
    process.on('unhandledRejection', onUnhandled)
    try {
      expect(h.mounted).not.toHaveBeenCalled();const failure = new Error('controlled local UI chunk rejection')
      h.gates[0].reject(failure);await settle();expect(h.clientErrors).toEqual([failure]);expect(h.mounted).not.toHaveBeenCalled()
      h.source.service = 'google';await settle();h.source.service = 'localTranslation';await settle()
      expect(h.requestLocal).toHaveBeenCalledTimes(2);expect(h.gates).toHaveLength(2)
      h.resolveLocal(1);await settle();expect(h.mounted).toHaveBeenCalledOnce();expect(h.localNodes()).toHaveLength(1)
      expect(unhandled).toEqual([])
    } finally {process.off('unhandledRejection', onUnhandled);await h.finish()}
  })
})

import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import vue from '@vitejs/plugin-vue'
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
    if (/\/src\/services\/config\/store(?:\.ts)?$/u.test(id)) return '\0service-config'
    if (/\/src\/platform\/browser\/chromeTranslationPreparationRequest(?:\.ts)?$/u.test(id)) return '\0service-chrome-store'
    if (/\/src\/features\/settings\/model\/chromeTranslationPreparation(?:\.ts)?$/u.test(id)) return '\0service-chrome-preparation'
    return null
  }, load(id) {
    if (id === '\0service-child') return 'export default {render: () => null}'
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
    server: {hmr: false, middlewareMode: true}})
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
    await vi.advanceTimersByTimeAsync(phase === 'response' ? 45000 : 10000);await settle();expect(ended).toBe(true)
    expect(state.connectionTestBusy).toBe(false);expect(state.connectionTestState).toBe('error');expect(vi.getTimerCount()).toBe(0)
    delayed.resolve({success: true});await job;await check(true);expect(state.connectionTestState).toBe('success')
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

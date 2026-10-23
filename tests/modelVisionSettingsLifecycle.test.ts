/**
 * @file tests/modelVisionSettingsLifecycle.test.ts
 * 文件职责：运行实际模型识图设置组件与状态 composable，验证消息契约、请求归属和等待预算。
 * 主要内容：直接导入客户端 SFC，并用依赖边界哨兵及独立 Vite 模块图确保纯消息契约不初始化探测实现、正文候选或语言检测器；核对实际 probe/cancel 发送与同一请求编号，覆盖配置等待、取消、迟到响应及缓存订阅生命周期。
 * 模块边界：只控制浏览器、配置持久化和本地存储端口，不替换消息契约或探测策略，不证明真实供应商网络与浏览器样式。
 */
import * as runtime from 'vue'
import {resolve} from 'node:path'
import {createServer} from 'vite'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {Config} from '@/src/core/config/model'
import {createVisionProbeIdentity} from '@/src/core/config/visionProbe'

// 运行实际 SFC 与识图状态 composable；只控制浏览器、持久化和存储边界。
let app: import('vue').App, state: Record<string, any>
let props: {config: Config; service: string; model: string; active: boolean}, visible: import('vue').Ref<boolean>
const send = vi.fn(), save = vi.fn(), queue = vi.fn(), read = vi.fn()
const subscriptions: {callback: (value: unknown) => void; stop: ReturnType<typeof vi.fn>}[] = []
const releases: (() => void)[] = [], jobs: Promise<unknown>[] = []
const forbiddenImports: string[] = []
function pending() {let resolve!: (value?: any) => void, reject!: (error: unknown) => void
  const promise = new Promise<any>((yes, no) => {resolve = yes;reject = no});releases.push(() => resolve(undefined));return {promise, resolve, reject}}
async function settle() {for (let i = 0; i < 12; i++) await Promise.resolve();await runtime.nextTick();await runtime.nextTick()}
function probe() {const job = state.probe() as Promise<void>;jobs.push(job);return job}
function probeMessages() {return send.mock.calls.filter(([message]) => message.type === 'fluentReadModelVisionProbe')}
function cancelMessages() {return send.mock.calls.filter(([message]) => message.type === 'fluentReadModelVisionProbeCancel')}
function mutate(reason: string) {
  if (reason === 'hidden') props.active = false
  if (reason === 'cached') visible.value = false
  if (reason === 'unmount') app.unmount()
  if (reason === 'config') props.config = runtime.reactive(Object.assign(new Config(), {model: {...props.config.model}}))
  if (reason === 'model') props.model = 'another-future-vision'
  if (reason === 'key') props.config.token.deepseek = 'changed-fixture'
  if (reason === 'service') props.service = 'openai'
}
beforeEach(async () => {
  vi.clearAllMocks();subscriptions.length = 0;releases.length = 0;jobs.length = 0;forbiddenImports.length = 0
  queue.mockResolvedValue(undefined);save.mockResolvedValue(undefined);read.mockResolvedValue([])
  send.mockImplementation(async message => message.type === 'fluentReadModelVisionProbe'
    ? {success: true, capability: 'supported', source: 'probe'} : {cancelled: true})
  vi.resetModules()
  vi.doMock('webextension-polyfill', () => ({default: {runtime: {sendMessage: send}}}))
  vi.doMock('@/src/services/config/store', () => ({waitForConfigPersistenceQueue: queue, requestConfigSave: save}))
  vi.doMock('@/src/ui/i18n', () => ({useUiI18n: () => ({t: (key: string) => key})}))
  vi.doMock('@/src/features/settings/ui/components/SegmentedControl.vue', () => ({default: {render: () => null}}))
  vi.doMock('@wxt-dev/storage', () => ({storage: {getItem: read, watch: (_key: string, callback: (value: unknown) => void) => {
    const item = {callback, stopped: false, stop: vi.fn(() => {item.stopped = true})};subscriptions.push(item);return item.stop
  }}}))
  vi.doMock('@/src/services/translation/visionProbe', () => {forbiddenImports.push('src/services/translation/visionProbe');throw new Error('UI imported translation implementation: src/services/translation/visionProbe')})
  vi.doMock('@/src/services/translation/requestSnapshot', () => {forbiddenImports.push('src/services/translation/requestSnapshot');throw new Error('UI imported translation implementation: src/services/translation/requestSnapshot')})
  vi.doMock('@/src/core/translation/public', () => {forbiddenImports.push('src/core/translation/public');throw new Error('UI imported translation implementation: src/core/translation/public')})
  vi.doMock('@/src/core/translation/registry', () => {forbiddenImports.push('src/core/translation/registry');throw new Error('UI imported translation implementation: src/core/translation/registry')})
  vi.doMock('@/src/core/site-adaptation/compiler', () => {forbiddenImports.push('src/core/site-adaptation/compiler');throw new Error('UI imported translation implementation: src/core/site-adaptation/compiler')})
  vi.doMock('@/src/providers/translation/registry', () => {forbiddenImports.push('src/providers/translation/registry');throw new Error('UI imported translation implementation: src/providers/translation/registry')})
  vi.doMock('@/src/core/language/detect', () => {forbiddenImports.push('src/core/language/detect');throw new Error('UI imported translation implementation: src/core/language/detect')})
  const component = (await import('@/src/features/settings/ui/services/ModelVisionSettings.vue')).default
  const renderer = runtime.createRenderer<Record<string, never>, Record<string, unknown>>({patchProp: () => {}, insert: () => {},
    remove: () => {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText: () => {},
    setElementText: () => {}, parentNode: () => null, nextSibling: () => null, querySelector: () => null,
    setScopeId: () => {}, cloneNode: () => ({}), insertStaticContent: () => [{}, {}]})
  const config = runtime.reactive(new Config());config.model.deepseek = 'future-vision'
  props = runtime.reactive({config, service: 'deepseek', model: 'future-vision', active: true});visible = runtime.ref(true)
  app = renderer.createApp({setup: () => () => runtime.h(runtime.KeepAlive, null, {default: () => visible.value
    ? runtime.h(component as runtime.Component, {...props, ref: (vm: any) => {if (vm) state = vm.$.setupState}}) : runtime.h({render: () => null}, {key: 'other'})})})
  app.config.warnHandler = () => {};app.mount({});await settle()
})
afterEach(async () => {
  app?.unmount();for (const release of releases) release();await settle();await Promise.allSettled(jobs)
  vi.useRealTimers()
})

describe('实际模型识图设置的请求归属与等待预算', () => {
  it('纯消息契约不初始化翻译实现，实际组件按同一契约发送探测和取消', async () => {
    const contract = await import('@/src/services/translation/types')
    expect([contract.VISION_PROBE_MESSAGE, contract.VISION_PROBE_CANCEL_MESSAGE])
      .toEqual(['fluentReadModelVisionProbe', 'fluentReadModelVisionProbeCancel'])
    // Only the independent dependency-graph assertion needs Vite's SSR loader.
    // The component and every behavior assertion above run through normal client imports.
    const contractServer = await createServer({root: process.cwd(), configFile: false, appType: 'custom', logLevel: 'silent',
      resolve: {alias: {'@': resolve(process.cwd())}}, server: {hmr: false, middlewareMode: true, watch: null}})
    try {
      await contractServer.ssrLoadModule('/src/services/translation/types.ts')
      const contractModule = await contractServer.moduleGraph.getModuleByUrl('/src/services/translation/types.ts')
      expect(contractModule?.ssrTransformResult?.deps).toEqual([])
    } finally {await contractServer.close()}
    expect(forbiddenImports).toEqual([])

    const response = pending()
    send.mockImplementation(message => message.type === contract.VISION_PROBE_MESSAGE ? response.promise : Promise.resolve({cancelled: true}))
    const identity = createVisionProbeIdentity(props.config, props.service, props.model), job = probe();await settle()
    expect(send).toHaveBeenCalledOnce()
    const request = send.mock.calls[0][0]
    expect(request).toEqual({type: contract.VISION_PROBE_MESSAGE, service: 'deepseek', model: 'future-vision', identity, requestId: expect.any(String)})
    expect(request.requestId).not.toBe('')
    state.cancel();await job
    expect(send.mock.calls.map(([message]) => message)).toEqual([request, {type: contract.VISION_PROBE_CANCEL_MESSAGE, requestId: request.requestId}])
    expect(state.busy).toBe(false);expect(state.feedback).toBe('settings.services.visionProbeCancelled')
    response.resolve({success: true, capability: 'supported', source: 'probe'});await settle()
    expect(read).toHaveBeenCalledOnce();expect(state.feedback).toBe('settings.services.visionProbeCancelled')
  })
  it('保存前等待队列，保存完成后才发送捕获的配置身份，并刷新能力状态', async () => {
    const waiting = pending(), saving = pending();queue.mockReturnValueOnce(waiting.promise);save.mockReturnValueOnce(saving.promise)
    const identity = createVisionProbeIdentity(props.config, props.service, props.model);const job = probe();await settle()
    expect(state.busy).toBe(true);expect(save).not.toHaveBeenCalled();expect(probeMessages()).toHaveLength(0)
    waiting.resolve();await settle();expect(save.mock.calls[0][0]).toBe(props.config);expect(probeMessages()).toHaveLength(0)
    saving.resolve();await job;expect(probeMessages()[0][0]).toMatchObject({service: 'deepseek', model: 'future-vision', identity})
    expect(state.feedback).toBe('settings.services.visionProbeSupported');expect(state.busy).toBe(false);expect(read).toHaveBeenCalledTimes(2)
  })
  it.each(['hidden', 'cached', 'unmount', 'config', 'model', 'key', 'service'])('%s 在配置等待期间立即结束本地等待，晚到队列不保存或发送', async reason => {
    const waiting = pending();queue.mockReturnValueOnce(waiting.promise);let done = false
    const job = probe().then(() => {done = true});await settle();mutate(reason);await settle()
    expect(done).toBe(true);expect(state.busy).toBe(false);expect(cancelMessages()).toHaveLength(1)
    waiting.resolve();await job;expect(save).not.toHaveBeenCalled();expect(probeMessages()).toHaveLength(0)
  })
  it.each(['hidden', 'cached', 'unmount', 'config', 'model', 'key', 'service'])('%s 在已发请求后取消，迟到结果不反馈或刷新缓存', async reason => {
    const response = pending();send.mockImplementation(message => message.type === 'fluentReadModelVisionProbe' ? response.promise : Promise.resolve({cancelled: true}))
    let done = false;const job = probe().then(() => {done = true});await settle();expect(probeMessages()).toHaveLength(1)
    mutate(reason);await settle();expect(done).toBe(true);expect(state.busy).toBe(false)
    const feedback = state.feedback;response.resolve({success: true, capability: 'supported', source: 'probe'});await job
    expect(state.feedback).toBe(feedback);expect(read).toHaveBeenCalledOnce()
    expect(cancelMessages()[0][0].requestId).toBe(probeMessages()[0][0].requestId)
  })
  it('保存等待期间主动取消后可以重试，旧保存不能覆盖新请求状态', async () => {
    vi.useFakeTimers()
    const saving = pending();save.mockReturnValueOnce(saving.promise);let done = false
    const old = probe().then(() => {done = true});await settle();expect(vi.getTimerCount()).toBe(1)
    state.cancel();await settle();expect(done).toBe(true);expect(state.busy).toBe(false)
    expect(state.feedback).toBe('settings.services.visionProbeCancelled');expect(cancelMessages()).toHaveLength(1);expect(vi.getTimerCount()).toBe(0)
    await probe();await settle();expect(probeMessages()).toHaveLength(1);expect(state.feedback).toBe('settings.services.visionProbeSupported')
    expect(probeMessages()[0][0].requestId).not.toBe(cancelMessages()[0][0].requestId);expect(vi.getTimerCount()).toBe(0)
    saving.resolve();await old;await settle();expect(probeMessages()).toHaveLength(1);expect(state.feedback).toBe('settings.services.visionProbeSupported')
    expect(cancelMessages()).toHaveLength(1);expect(vi.getTimerCount()).toBe(0)
  })
  it('正在检测时重复调用不创建第二次保存或请求', async () => {
    const waiting = pending();queue.mockReturnValueOnce(waiting.promise);const one = probe();await probe();await settle()
    expect(queue).toHaveBeenCalledOnce();waiting.resolve();await one;expect(save).toHaveBeenCalledOnce();expect(probeMessages()).toHaveLength(1)
  })
  it.each(['queue', 'save', 'response'])('%s 挂起时按配置10秒或响应45秒预算退出并允许重试', async phase => {
    vi.useFakeTimers();const stalled = pending()
    if (phase === 'queue') queue.mockReturnValueOnce(stalled.promise)
    if (phase === 'save') save.mockReturnValueOnce(stalled.promise)
    if (phase === 'response') send.mockImplementationOnce(() => stalled.promise)
    let done = false;const job = probe().then(() => {done = true});await settle()
    const timeoutMs = phase === 'response' ? 45000 : 10000
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(timeoutMs - 1);await settle()
    expect(done).toBe(false);expect(state.busy).toBe(true);expect(state.feedback).toBe('settings.services.visionProbeRunning')
    expect(probeMessages()).toHaveLength(phase === 'response' ? 1 : 0)
    await vi.advanceTimersByTimeAsync(1);await settle()
    expect(done).toBe(true);expect(state.busy).toBe(false)
    const failure = 'settings.services.visionProbeFailed ' + (phase === 'response'
      ? 'settings.services.keys.responseTimeout' : 'settings.services.keys.configTimeout')
    expect(state.feedback).toBe(failure);expect(vi.getTimerCount()).toBe(0)
    expect(cancelMessages()).toHaveLength(1);expect(cancelMessages()[0][0].requestId).toEqual(expect.any(String))
    expect(cancelMessages()[0][0].requestId).not.toBe('')
    if (phase === 'response') expect(cancelMessages()[0][0].requestId).toBe(probeMessages()[0][0].requestId)
    stalled.resolve({success: true, capability: 'supported', source: 'probe'});await job;await settle()
    expect(state.feedback).toBe(failure);expect(read).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0)
    await probe();await settle();expect(state.feedback).toBe('settings.services.visionProbeSupported');expect(state.busy).toBe(false)
    const requests = probeMessages();expect(requests).toHaveLength(phase === 'response' ? 2 : 1)
    expect(requests.at(-1)![0].requestId).not.toBe(cancelMessages()[0][0].requestId)
    expect(cancelMessages()).toHaveLength(1);expect(vi.getTimerCount()).toBe(0)
  })
  it('隐藏后释放缓存订阅，迟到通知无效，恢复重读且允许手动覆盖', async () => {
    const old = subscriptions[0] as typeof subscriptions[number] & {stopped?: boolean};props.active = false;await settle()
    expect(old.stopped).toBe(true);const before = JSON.stringify(props.config.modelVision)
    state.override = 'supported';await probe();expect(JSON.stringify(props.config.modelVision)).toBe(before);expect(queue).not.toHaveBeenCalled()
    old.callback([]);props.active = true;await settle();expect(subscriptions).toHaveLength(2);expect(read).toHaveBeenCalledTimes(2)
    state.override = 'supported';expect(props.config.modelVision.deepseek['future-vision']).toBe(true)
    state.override = 'unsupported';expect(props.config.modelVision.deepseek['future-vision']).toBe(false)
    state.override = 'auto';expect(props.config.modelVision.deepseek).toBeUndefined()
  })
  it('不支持的服务和空模型不能开始检测或修改手动覆盖', async () => {
    props.service = 'microsoft';await settle();state.override = 'supported';await probe()
    expect(queue).not.toHaveBeenCalled();expect(props.config.modelVision.microsoft).toBeUndefined()
    props.service = 'deepseek';props.model = '';await settle();await probe();expect(queue).not.toHaveBeenCalled()
  })
  it.each(['unknown', 'unsupported'])('检测结果%s保持真实结论，不伪装为支持', async capability => {
    send.mockResolvedValueOnce({success: true, capability, source: 'probe'});await probe()
    expect(state.feedback).toBe(capability === 'unknown' ? 'settings.services.visionProbeUnknown' : 'settings.services.visionProbeUnsupported')
  })
  it('检测成功后缓存读取失败或悬挂不改为检测失败或持续忙碌', async () => {
    read.mockRejectedValueOnce(new Error('storage unavailable'));await probe();await settle()
    expect(state.feedback).toBe('settings.services.visionProbeSupported');expect(state.busy).toBe(false)
    const refresh = pending();read.mockReturnValueOnce(refresh.promise);let done = false
    const job = probe().then(() => {done = true});await settle();expect(done).toBe(true);expect(state.busy).toBe(false);refresh.resolve([]);await job
  })
  it('发送失败反馈后重试成功，取消消息的拒绝不会产生未处理错误', async () => {
    send.mockRejectedValueOnce(new Error('fixture send failed'));await probe();expect(state.feedback).toContain('fixture send failed')
    await probe();expect(state.feedback).toBe('settings.services.visionProbeSupported')
    const waiting = pending();queue.mockReturnValueOnce(waiting.promise);const job = probe();await settle();send.mockRejectedValueOnce(new Error('cancel transport failed'))
    state.cancel();await settle();waiting.resolve();await job;expect(state.busy).toBe(false)
  })
  it('隐藏时1000次凭据变化不计算身份，重新激活才读取当前身份', async () => {
    const endpoint = runtime.ref('first');let reads = 0
    props.config.proxy = {get deepseek() {reads++;return endpoint.value}};await settle();props.active = false;await settle();reads = 0
    for (let i = 0; i < 1000; i++) {endpoint.value = `fixture-${i}`;void state.identity}
    await settle();expect(reads).toBe(0);props.active = true;await settle();expect(reads).toBeGreaterThan(0)
  })
  it('消息失败形状和非Error持久化错误保持可重试状态', async () => {
    queue.mockRejectedValueOnce('port rejected');await probe();expect(state.feedback).toBe('settings.services.visionProbeFailed');expect(state.busy).toBe(false)
    send.mockResolvedValueOnce({success: false});await probe();expect(state.feedback).toContain('settings.services.visionProbeFailed')
    await probe();expect(state.feedback).toBe('settings.services.visionProbeSupported')
  })
  it('上下文释放时同步抛错的取消端口不阻止本地清理', async () => {
    const waiting = pending();queue.mockReturnValueOnce(waiting.promise);const job = probe();await settle()
    send.mockImplementationOnce(() => {throw new Error('released port')});expect(() => state.cancel()).not.toThrow();await settle()
    waiting.resolve();await job;expect(state.busy).toBe(false);expect(probeMessages()).toHaveLength(0)
  })
})

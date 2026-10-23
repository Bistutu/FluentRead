/**
 * @file tests/uiI18nOwnership.test.ts
 * 文件职责：执行实际共享 i18n 保存函数及 Selector，复现语言选择的异步身份问题。
 * 主要内容：覆盖资源先后、外部 revision、连续调用、销毁和组件失败提示；另以实际 store 和加密 IndexedDB 端口核对同步乐观回声、权威回滚与迟到失败，验证嵌套正文所有权、显式 UI 扫描根与 document 元信息的独立权限及插件清理。
 * 模块边界：组件细测使用可控存储端口；集成组直接 import 实际 i18n/store/repository/storage，只控制后台消息和语言资源加载，不调用浏览器或翻译供应商。
 */
import 'fake-indexeddb/auto'
import * as runtime from 'vue'
import {resolve} from 'node:path'
import {Server as TcpServer} from 'node:net'
import {promises as dnsPromises} from 'node:dns'
import {parseHTML} from 'linkedom'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createLanguageHarness, deferred, settle, languageHarnessPhases} from './uiI18nAuditHarness'
import {EncryptedConfigRepository, FluentReadConfigDatabase} from '@/src/platform/storage/configRepository'
import {createBackgroundConfigStorage, type ConfigStoragePort} from '@/src/platform/storage/configStorage'
import {normalizeConfig} from '@/src/core/config/model'
import {sanitizeConfigCredentials} from '@/src/core/config/credentials'
import type {UiLanguage} from '@/src/core/i18n/language'

const actualPorts = vi.hoisted(() => {
  const state = {storage: undefined as ConfigStoragePort | undefined, stops: [] as Array<() => void>}
  const proxy: ConfigStoragePort = {
    writeOwner: false,
    getItem: key => state.storage!.getItem(key),
    setItem: (key, value) => state.storage!.setItem(key, value),
    setItems: (entries, removed) => state.storage!.setItems!(entries, removed),
    removeItem: key => state.storage!.removeItem(key),
    watch: (key, callback) => {
      const stop = state.storage!.watch(key, callback);state.stops.push(stop);return stop
    },
  }
  return {state, proxy, send: vi.fn<(message: unknown) => Promise<unknown>>()}
})
vi.mock('@/src/platform/storage/configStorageRuntime', () => ({configStorage: actualPorts.proxy}))
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: actualPorts.send}}}))
vi.mock('@/src/platform/i18n/uiLanguageBundles', () => ({ensureUiLanguageBundle: async () => true}))

let harness: Awaited<ReturnType<typeof createLanguageHarness>> | undefined
let actualHarness: Awaited<ReturnType<typeof createActualStoreHarness>> | undefined
async function create(mount = false) {return harness = await createLanguageHarness({mount})}
beforeEach(() => {languageHarnessPhases.length = 0})
afterEach(async ctx => {
  try {
    if (ctx.task.result?.state === 'fail' && process.env.FLUENTREAD_UI_LANGUAGE_TEST_DIAGNOSTICS === '1') console.error('UI_LANGUAGE_HARNESS_PHASES', JSON.stringify(languageHarnessPhases))
    vi.restoreAllMocks();await harness?.close();harness = undefined;await actualHarness?.close();actualHarness = undefined
  } finally {languageHarnessPhases.length = 0}
})

async function createActualStoreHarness() {
  vi.resetModules();vi.doUnmock('@/src/services/config/store')
  vi.doMock('webextension-polyfill',()=>({default:{runtime:{sendMessage:actualPorts.send}}}))
  vi.doMock('@/src/platform/i18n/uiLanguageBundles',()=>({ensureUiLanguageBundle:async()=>true}))
  vi.stubGlobal('location', {protocol:'chrome-extension:'})
  const database = new FluentReadConfigDatabase(`FluentRead-ui-i18n-ownership-${crypto.randomUUID()}`)
  const repository = new EncryptedConfigRepository({database, getSessionKeyMaterial: async () => 'ui-i18n-test-session'})
  await repository.set('local:config', {...sanitizeConfigCredentials(normalizeConfig({uiLanguage:'zh-CN',uiLanguageSetupCompleted:false})), __fluentConfigRevision:10})
  const storage = createBackgroundConfigStorage({repository, legacy:{getItem:async () => null,setItem:async () => undefined,removeItem:async () => undefined}})
  actualPorts.state.storage = storage
  type Message = {type:string;mode?:string;config:Record<string,unknown>;expected?:Record<string,unknown>;baseRevision?:number}
  const requests: Array<{message:Message;gate:ReturnType<typeof deferred<unknown>>}> = []
  let closing = false
  actualPorts.send.mockReset().mockImplementation(message => {
    if(closing)return Promise.resolve({success:false,error:'test cleanup'})
    const payload=message as Message
    if(payload.type !== 'persistConfig')return Promise.reject(new Error('Unexpected background message'))
    const gate=deferred<unknown>();requests.push({message:payload,gate});return gate.promise
  })
  try {
    // 不 mock store 或复制其订阅、revision、字段 CAS、队列与回滚实现。
    const store = await import('@/src/services/config/store')
    await store.configReady
    const directory=process.env.FLUENTREAD_UI_LANGUAGE_TEST_SOURCE_DIR
    const module: typeof import('@/src/ui/i18n') = directory
      ? await import(/* @vite-ignore */ resolve(directory,'i18n.ts'))
      : await import('@/src/ui/i18n')
    const context=module.createUiI18nContext()
    const echoes: Array<{language:UiLanguage;revision:number}> = []
    const unsubscribe=store.subscribeConfig(next => echoes.push({language:next.uiLanguage,revision:store.getConfigRevision()}))
    const read=() => repository.get<Record<string,unknown>>('local:config')
    const start=(value:UiLanguage) => {const pending=context.setLanguage(value);void pending.catch(() => undefined);return pending}
    const commit=async (language:UiLanguage, revision:number) => {
      const previous=await read()
      await storage.setItem('local:config',{...previous,uiLanguage:language,uiLanguageSetupCompleted:true,__fluentConfigRevision:revision})
    }
    return {context,i18n:module,store,requests,echoes,read,start,commit,
      success:async (index:number,revision:number) => {await commit(requests[index].message.config.uiLanguage as UiLanguage,revision);requests[index].gate.resolve({success:true,revision})},
      close:async () => {
        closing=true;context.dispose();unsubscribe()
        for(const request of requests)request.gate.resolve({success:false,error:'test cleanup'})
        await store.waitForConfigPersistenceQueue()
        for(const stop of actualPorts.state.stops.splice(0))stop()
        actualPorts.state.storage=undefined;database.close();await database.delete();vi.unstubAllGlobals();vi.resetModules()
      },
    }
  } catch (error) {
    for(const stop of actualPorts.state.stops.splice(0))stop()
    actualPorts.state.storage=undefined;database.close();await database.delete();vi.unstubAllGlobals();vi.resetModules();throw error
  }
}

describe('实际 UiI18n 保存与来源身份', () => {
  it('配置水合未完成时不提交，水合和资源均完成后才预览及提交', async () => {
    const ready = deferred<void>();harness = await createLanguageHarness({mount:false,ready:ready.promise});const h=harness
    const pending=h.context.setLanguage('en-US');await settle();expect(h.requests).toHaveLength(0);expect(h.context.language.value).toBe('zh-CN')
    ready.resolve();await settle();h.requests.at(-1)!.gate.resolve();await pending;expect(h.stored()).toBe('en-US')
  })

  it('正常失败采用 store 权威回滚并保留原错误，重试仍可成功，补丁协议不变', async () => {
    const h = await create(), error = new Error('offline'), pending = h.context.setLanguage('en-US');await settle()
    expect(h.context.language.value).toBe('en-US');expect(h.data.requestConfigPatch).toHaveBeenCalledWith({uiLanguage:'en-US',uiLanguageSetupCompleted:true}, expect.any(Function))
    h.requests[0].gate.reject(error);await expect(pending).rejects.toBe(error);expect(h.context.language.value).toBe('zh-CN');expect(h.stored()).toBe('zh-CN')
    const retry = h.context.setLanguage('ja-JP');await settle();h.requests.at(-1)!.gate.resolve();await retry;expect(h.context.language.value).toBe('ja-JP');expect(h.stored()).toBe('ja-JP')
  })
  it.each(['fr-FR','zh-CN','en-US'] as const)('外部语言经过新 revision 切换至 %s，旧失败不回滚新身份', async value => {
    const h = await create(), pending = h.context.setLanguage('en-US');await settle();h.foreign('ja-JP');h.foreign(value);h.requests[0].gate.reject(new Error('old failure'));await pending.catch(()=>undefined)
    expect(h.context.language.value).toBe(value);expect(h.stored()).toBe(value)
  })
  it('直接外部回到请求前语言也不能把旧失败当作自己的正常回滚', async () => {
    const h = await create(), pending = h.context.setLanguage('en-US');await settle();h.foreign('zh-CN');h.requests[0].gate.reject(new Error('old failure'))
    await expect(pending).resolves.toBe(false);expect(h.context.language.value).toBe('zh-CN')
  })
  it('旧资源更晚到达不覆盖或提交更新的调用', async () => {
    const h = await create(), slow = deferred<boolean>();h.bundles.set('en-US',slow)
    const old = h.context.setLanguage('en-US'), current = h.context.setLanguage('ja-JP');await settle();expect(h.requests).toHaveLength(1);h.requests[0].gate.resolve();await current
    slow.resolve(true);await settle();for(const r of h.requests.slice(1))r.gate.resolve();await old;expect(h.requests.map(r=>r.value)).toEqual(['ja-JP']);expect(h.context.language.value).toBe('ja-JP');expect(h.stored()).toBe('ja-JP')
  })
  it('存储中的旧调用失败不回滚新预览，最新调用在前驱结算后提交', async () => {
    const h = await create(), old = h.context.setLanguage('en-US');await settle();const current = h.context.setLanguage('ja-JP');await settle()
    expect(h.context.language.value).toBe('ja-JP');h.requests[0].gate.reject(new Error('old failure'));await old.catch(()=>undefined);await settle();expect(h.context.language.value).toBe('ja-JP');expect(h.requests.map(r=>r.value)).toEqual(['en-US','ja-JP'])
    h.requests[1].gate.resolve();await current;expect(h.stored()).toBe('ja-JP');expect(h.context.language.value).toBe('ja-JP')
  })
  it('相同值的新调用等待前驱失败，避免把乐观同值误认成已保存', async () => {
    const h = await create(), old = h.context.setLanguage('en-US');await settle();const current = h.context.setLanguage('en-US');await settle();h.requests[0].gate.reject(new Error('first failure'));await old.catch(()=>undefined);await settle()
    expect(h.requests.map(r=>r.value)).toEqual(['en-US','en-US']);h.requests[1].gate.resolve();await current;expect(h.context.language.value).toBe('en-US');expect(h.stored()).toBe('en-US')
  })
  it('连续三次只发送已发前驱和最新选择，旧成功不覆盖最新预览', async () => {
    const h = await create(), first = h.context.setLanguage('en-US');await settle();const second = h.context.setLanguage('ja-JP'), last = h.context.setLanguage('fr-FR');await settle()
    h.requests[0].gate.resolve();await first;await settle();for(const r of h.requests.slice(1))r.gate.resolve();await second;await last
    expect(h.requests.map(r=>r.value)).toEqual(['en-US','fr-FR']);expect(h.context.language.value).toBe('fr-FR');expect(h.stored()).toBe('fr-FR')
  })
  it('外部配置到达资源等待期间，旧资源完成不再发字段补丁', async () => {
    const h = await create(), slow = deferred<boolean>();h.bundles.set('en-US',slow);const pending = h.context.setLanguage('en-US');h.foreign('fr-FR');slow.resolve(true);await settle();for(const r of h.requests)r.gate.resolve();await pending
    expect(h.requests).toHaveLength(0);expect(h.context.language.value).toBe('fr-FR')
  })
  it('销毁后资源到达或再次调用均不提交或更新语言', async () => {
    const h = await create(), slow = deferred<boolean>();h.bundles.set('en-US',slow);const pending = h.context.setLanguage('en-US');h.context.dispose();slow.resolve(true);await settle();for(const r of h.requests)r.gate.resolve();await pending;const late = h.context.setLanguage('ja-JP');await settle();for(const r of h.requests)r.gate.resolve();await late
    expect(h.requests).toHaveLength(0);expect(h.context.language.value).toBe('zh-CN')
  })
  it.each(['success','failure'])('销毁后已经发出的存储 %s 可以结算，局部语言和 bundleRevision 不再改变', async result => {
    const h = await create(), pending = h.context.setLanguage('en-US');await settle();const before = h.context.language.value, version = h.context.bundleRevision.value;h.context.dispose()
    if(result==='success')h.requests[0].gate.resolve();else h.requests[0].gate.reject(new Error('late failure'));await pending.catch(()=>undefined)
    expect(h.context.language.value).toBe(before);expect(h.context.bundleRevision.value).toBe(version);expect(h.stored()).toBe(result==='success'?'en-US':'zh-CN')
  })
})

describe('实际 Selector + 共享 setLanguage 的旧失败', () => {
  it.each(['fr-FR','zh-CN','en-US'] as const)('待保存→外部语言切走再到 %s→旧 reject，不显示旧失败', async value => {
    const h = await create(true);await h.open();const pending = h.change('en-US');await settle();h.foreign('ja-JP');h.foreign(value);h.requests[0].gate.reject(new Error('old failure'));await pending;await settle()
    expect(h.context.language.value).toBe(value);expect(h.document.querySelector('[role="status"]')).toBeNull()
  })
  it('正常失败仍显示可访问错误，当前会话重试可成功', async () => {
    const h = await create(true);await h.open();const pending = h.change('en-US');await settle();h.requests[0].gate.reject(new Error('offline'));await pending;await settle()
    expect(h.context.language.value).toBe('zh-CN');expect(h.document.querySelector('[role="status"]')?.textContent).toBe(h.context.t('language.saveFailed'))
    await h.open();const retry = h.change('ja-JP');await settle();h.requests.at(-1)!.gate.resolve();await retry;await settle();expect(h.stored()).toBe('ja-JP');expect(h.document.querySelector('[role="status"]')).toBeNull()
  })
})


describe('实际 i18n DOM observer 生命周期', () => {
  it.each(['document','directive'])('%s 的零号 timer 正确清理，已排队的旧回调不再重接 observer', async target => {
    const h=await create();const observers: Array<{observe: ReturnType<typeof vi.fn>;disconnect: ReturnType<typeof vi.fn>}> = []
    vi.stubGlobal('MutationObserver', class {observe=vi.fn();disconnect=vi.fn();constructor(){observers.push(this)}})
    let queued!: () => void
    vi.spyOn(globalThis,'setTimeout').mockImplementation(((fn: () => void) => {queued=fn;return 0}) as unknown as typeof setTimeout)
    const clear=vi.spyOn(globalThis,'clearTimeout').mockImplementation(()=>undefined)
    const app=runtime.createApp({render:()=>null})
    app.use(h.uiModule.createUiI18nPlugin(target==='document'?{documentRoot:h.document.body}:{}))
    const directive=app.directive('ui-i18n') as import('vue').ObjectDirective
    const rootUnmount=app._context.mixins.at(-1)!.beforeUnmount!
    if(target==='directive')Reflect.apply(directive.mounted!,undefined,[h.document.body])
    const calls=observers.reduce((sum,observer)=>sum+observer.observe.mock.calls.length,0)
    if(target==='directive')Reflect.apply(directive.beforeUnmount!,undefined,[h.document.body])
    const root:{$root?:unknown}={};root.$root=root;Reflect.apply(rootUnmount,root,[])
    expect(clear).toHaveBeenCalledWith(0);queued();expect(observers.reduce((sum,observer)=>sum+observer.observe.mock.calls.length,0)).toBe(calls)
  })
})

describe('实际 i18n 指令的嵌套正文所有权', () => {
  async function mountDirective() {
    const h=actualHarness=await createActualStoreHarness()
    const core=await import('@/src/core/i18n'), bundles=await import('@/src/core/i18n/bundles')
    core.registerUiLanguageBundle('en-US',bundles.UI_LANGUAGE_BUNDLES['en-US'])
    // 用真实资源确认这个正文单字确实会命中旧 UI 词典，不能靠无翻译夹具掩盖扫描错误。
    expect(core.translateLegacyText('文','en-US')).not.toBe('文')
    const {document,window}=parseHTML('<html><body><div id="owned-ui"></div></body></html>')
    for(const [name,value] of Object.entries({document,Node:window.Node,MutationObserver:window.MutationObserver,NodeFilter:{SHOW_TEXT:4}}))vi.stubGlobal(name,value)
    const root=document.querySelector('#owned-ui') as unknown as HTMLElement
    let directive:any, context!:import('@/src/ui/i18n').UiI18nContext, rootUnmount!:()=>void
    const app={config:{globalProperties:{}},provide:(_key:unknown,value:import('@/src/ui/i18n').UiI18nContext)=>{context=value},
      directive:(_name:string,value:unknown)=>{directive=value},mixin:(hooks:{beforeUnmount:()=>void})=>{rootUnmount=hooks.beforeUnmount}}
    const plugin=h.i18n.createUiI18nPlugin()
    if(typeof plugin.install !== 'function')throw new Error('Actual UI i18n plugin must provide an install function')
    plugin.install(app as any)
    const start=()=>directive.mounted(root)
    const language=async(value:UiLanguage,revision:number)=>{
      await h.commit(value,revision)
      await vi.waitFor(()=>expect(context.language.value).toBe(value))
    }
    const close=()=>{directive.beforeUnmount(root);const vm:{$root?:unknown}={};vm.$root=vm;rootUnmount.call(vm)}
    return {h,document,root,context,start,language,close}
  }
  const speechText=(text:string)=>`<span>${[...text].map(token=>`<span class="fr-speech-word">${token}</span>`).join('')}</span>`

  it.each(['pre','code'])('真实英文扫描保留 %s 祖先里的 SpeechFollowText 嵌套单字与普通子元素',async tag=>{
    const fixture=await mountDirective(),{root,context}=fixture
    root.innerHTML=`<button title="关闭">翻译</button><${tag} id="content">${speechText('完整原文。')}<span><em>文</em></span></${tag}><div data-i18n-ignore><span title="关闭">翻译</span></div>`
    const body=root.querySelector('#content')!,before=body.outerHTML,ignored=root.querySelector('[data-i18n-ignore]')!.outerHTML
    try {
      fixture.start();await fixture.language('en-US',11)
      await vi.waitFor(()=>expect(root.querySelector('button')!.textContent).toBe(context.translateLegacy('翻译')))
      expect(root.querySelector('button')!.textContent).not.toBe('翻译')
      expect(root.querySelector('button')!.title).toBe(context.translateLegacy('关闭'))
      expect(body.outerHTML).toBe(before)
      expect(root.querySelector('[data-i18n-ignore]')!.outerHTML).toBe(ignored)
    } finally {fixture.close()}
  })

  it('语言往返与 observer 收到迟到插入或 text 更新时，只本地化普通 UI',async()=>{
    const fixture=await mountDirective(),{root,document,context}=fixture
    root.innerHTML=`<button>翻译</button><pre id="content">${speechText('完整原文。')}</pre>`
    const body=root.querySelector('#content')!,original=body.innerHTML
    try {
      fixture.start();await fixture.language('en-US',11)
      await vi.waitFor(()=>expect(root.querySelector('button')!.textContent).toBe(context.translateLegacy('翻译')))
      expect(body.innerHTML).toBe(original)
      const late=document.createElement('span');late.innerHTML=speechText('原文')
      body.appendChild(late)
      const text=body.querySelector('.fr-speech-word')!.firstChild as Text;text.data='文'
      const expected=body.innerHTML
      const lateUi=document.createElement('button');lateUi.textContent='关闭';root.appendChild(lateUi)
      await vi.waitFor(()=>expect(lateUi.textContent).toBe(context.translateLegacy('关闭')))
      expect(body.innerHTML).toBe(expected)
      await fixture.language('zh-CN',12)
      await vi.waitFor(()=>expect(lateUi.textContent).toBe('关闭'))
      expect(root.querySelector('button')!.textContent).toBe('翻译');expect(body.innerHTML).toBe(expected)
      await fixture.language('en-US',13)
      await vi.waitFor(()=>expect(lateUi.textContent).toBe(context.translateLegacy('关闭')))
      expect(root.querySelector('button')!.textContent).toBe(context.translateLegacy('翻译'));expect(body.innerHTML).toBe(expected)
    } finally {fixture.close()}
  })
})

describe('Vitest source import：实际 i18n + store + 加密 IndexedDB 的保存归属', () => {
  async function actual() {return actualHarness=await createActualStoreHarness()}
  async function sent(h: Awaited<ReturnType<typeof actual>>, count:number) {
    await vi.waitFor(() => expect(h.requests).toHaveLength(count))
  }
  it('当前普通 transport 失败仍 reject，同 revision 权威回滚先通知，当前会话可重试', async () => {
    const h=await actual(), error=new Error('current transport offline'), pending=h.start('en-US');await sent(h,1)
    expect(h.echoes).toEqual([{language:'zh-CN',revision:10},{language:'en-US',revision:10}])
    expect(h.requests[0].message).toMatchObject({type:'persistConfig',mode:'patch',config:{uiLanguage:'en-US',uiLanguageSetupCompleted:true},expected:{uiLanguage:'zh-CN',uiLanguageSetupCompleted:false},baseRevision:10})
    const rejected=expect(pending).rejects.toBe(error);h.requests[0].gate.reject(error);await rejected
    expect(h.echoes.at(-1)).toEqual({language:'zh-CN',revision:10});expect(h.context.language.value).toBe('zh-CN');expect(h.store.config.uiLanguage).toBe('zh-CN')
    const retry=h.start('ja-JP');await sent(h,2);await h.success(1,11);await retry
    expect(h.store.getConfigRevision()).toBe(11);expect(h.context.language.value).toBe('ja-JP');expect(await h.read()).toMatchObject({uiLanguage:'ja-JP',__fluentConfigRevision:11})
  })
  it('外部直接回到 previous 的新 revision 先 deferred，失败回读后不能误认自回滚或抛旧错误', async () => {
    const h=await actual(), pending=h.start('en-US');await sent(h,1);await h.commit('zh-CN',11)
    // 真实 store 在 active transport 期间暂存高 revision；i18n 此时不能预见回读结果。
    expect(h.store.getConfigRevision()).toBe(10);expect(h.context.language.value).toBe('en-US')
    h.requests[0].gate.reject(new Error('old request failed'));await expect(pending).resolves.toBe(false)
    expect(h.echoes.at(-1)).toEqual({language:'zh-CN',revision:11});expect(h.store.getConfigRevision()).toBe(11);expect(h.context.language.value).toBe('zh-CN')
  })
  it('较早 transport 晚失败的真实 store 回滚不会覆盖最新选择，后续补丁基于回滚后的字段值', async () => {
    const h=await actual(), old=h.start('en-US'), oldResult=old.then(value => value,error => error);await sent(h,1);const current=h.start('ja-JP')
    await vi.waitFor(() => expect(h.context.language.value).toBe('ja-JP'));expect(h.requests).toHaveLength(1)
    h.requests[0].gate.reject(new Error('predecessor offline'));const result=await oldResult;await sent(h,2)
    expect(h.context.language.value).toBe('ja-JP');expect(result).toBe(false);expect(h.requests[1].message.expected).toMatchObject({uiLanguage:'zh-CN',uiLanguageSetupCompleted:false})
    await h.success(1,11);await expect(current).resolves.toBe(true)
    expect(h.context.language.value).toBe('ja-JP');expect(h.store.config.uiLanguage).toBe('ja-JP');expect(await h.read()).toMatchObject({uiLanguage:'ja-JP',__fluentConfigRevision:11})
  })
  it('后台 failure 响应走实际权威回读，较早失败同样不回写最新选择', async () => {
    const h=await actual(), old=h.start('en-US'), oldResult=old.then(value => value,error => error);await sent(h,1);const current=h.start('fr-FR')
    await vi.waitFor(() => expect(h.context.language.value).toBe('fr-FR'));h.requests[0].gate.resolve({success:false,error:'background refused'})
    const result=await oldResult;await sent(h,2);expect(h.context.language.value).toBe('fr-FR');expect(result).toBe(false)
    await h.success(1,11);await expect(current).resolves.toBe(true);expect(h.store.getConfigRevision()).toBe(11);expect(await h.read()).toMatchObject({uiLanguage:'fr-FR'})
  })
  it('外部提交同目标值的新 revision 在真实失败回读后保留新语言并抑制旧错误', async () => {
    const h=await actual(), pending=h.start('en-US');await sent(h,1);await h.commit('en-US',11)
    h.requests[0].gate.reject(new Error('stale transport failed'));await expect(pending).resolves.toBe(false)
    expect(h.store.getConfigRevision()).toBe(11);expect(h.context.language.value).toBe('en-US');expect(h.store.config.uiLanguage).toBe('en-US');expect(await h.read()).toMatchObject({uiLanguage:'en-US',__fluentConfigRevision:11})
  })
})

describe('实际 localizeServiceOptions 的翻译与 profile 搜索成本', () => {
  async function actual() {return actualHarness=await createActualStoreHarness()}
  it('自定义及组合用户名称保留原样，组合不携带缺失端点或未本地化的重复描述', async () => {
    const h=await actual(), translate=vi.fn((value: string) => `localized:${value}`)
    const result=h.i18n.localizeServiceOptions([{value:'custom:work',label:'翻译',description:'接口'}, {value:'composite:work',label:'随机',description:'随机 · 2 个翻译服务'}],
      [{id:'custom:work',name:'翻译',endpoint:'',models:[]}, {id:'composite:work',name:'随机',services:['google','microsoft']}],translate)
    expect(result.map((item: any) => item.label)).toEqual(['翻译','随机'])
    expect(result[0].description).toBe('localized:接口');expect(result[1].description).toBeUndefined()
    expect(result[1].searchTerms).toEqual(['随机','随机']);expect(translate).toHaveBeenCalledOnce()
  })
  it('同一次同步本地化仅翻译每个 label 一次，保持实际译文、描述、搜索词顺序与输入不变', async () => {
    const h=await actual(), core=await import('@/src/core/i18n')
    core.registerUiLanguageBundle('en-US',{messages:{},legacyText:{'原名':'Friendly','说明':'Details','其它':'Other'},legacyPatterns:{early:[],late:[]}})
    await h.commit('en-US',11)
    const firstOption=Object.freeze({value:'a',label:'原名',description:'说明',searchTerms:['keep'],extra:true})
    const options=Object.freeze([firstOption,Object.freeze({value:'b',label:'其它',description:''})])
    const translate=vi.fn(h.context.translateLegacy), result=h.i18n.localizeServiceOptions(options,[{id:'a',endpoint:'endpoint-a',models:['model-a']}],translate)
    expect(result).toEqual([{value:'a',label:'Friendly',description:'Details',searchTerms:['keep','原名','Friendly','endpoint-a','model-a'],extra:true},{value:'b',label:'Other',description:'',searchTerms:['其它','Other']}])
    expect(translate.mock.calls.map(([value]) => value)).toEqual(['原名','说明','其它']);expect(firstOption.searchTerms).toEqual(['keep']);expect(firstOption.label).toBe('原名')
  })
  it('多次不存在的 profile 查询只读取每个 id 一次，不再 options×profiles 重扫', async () => {
    const h=await actual();let reads=0
    const profiles=Array.from({length:100},(_,index) => ({get id(){reads+=1;return `profile-${index}`},endpoint:`endpoint-${index}`,models:[]}))
    const options=Array.from({length:20},(_,index) => ({value:`missing-${index}`,label:`label-${index}`}))
    const result=h.i18n.localizeServiceOptions(options,profiles,h.context.translateLegacy)
    expect(reads).toBe(100);expect(result).toHaveLength(20);expect(result[0].searchTerms).toEqual(['label-0','label-0'])
  })
  it('单个查询与两个前部命中均提前停止，不为小查询全扫描 profile 列表', async () => {
    const h=await actual();let reads=0
    const profiles=Array.from({length:100},(_,index) => ({get id(){reads+=1;return `profile-${index}`},endpoint:`endpoint-${index}`,models:[]}))
    expect(h.i18n.localizeServiceOptions([{value:'profile-0',label:'first'}],profiles,h.context.translateLegacy)[0].searchTerms.at(-1)).toBe('endpoint-0');expect(reads).toBe(1)
    reads=0;h.i18n.localizeServiceOptions([{value:'profile-0',label:'first'},{value:'profile-0',label:'again'}],profiles,h.context.translateLegacy);expect(reads).toBe(1)
    reads=0;h.i18n.localizeServiceOptions([{value:'profile-0',label:'first'},{value:'absent',label:'none'}],profiles.slice(0,1),h.context.translateLegacy);expect(reads).toBe(2)
  })
  it('重复 id 保留首项，迟后查询与再次调用不借用旧索引', async () => {
    const h=await actual(), options=[{value:'last',label:'last'},{value:'dup',label:'duplicate',searchTerms:['keep']},{value:'missing',label:'missing'},{value:'dup',label:'duplicate'}]
    const profiles=[{id:'dup',endpoint:'first-endpoint',models:['first-model']},{id:'dup',endpoint:'second-endpoint',models:['second-model']},{id:'last',endpoint:'last-endpoint',models:[]}]
    const result=h.i18n.localizeServiceOptions(options,profiles,h.context.translateLegacy)
    expect(result[1].searchTerms).toEqual(['keep','duplicate','duplicate','first-endpoint','first-model']);expect(result[3].searchTerms).toEqual(['duplicate','duplicate','first-endpoint','first-model']);expect(result[2].searchTerms).toEqual(['missing','missing'])
    expect(h.i18n.localizeServiceOptions(options,[{id:'dup',endpoint:'fresh-endpoint',models:[]}],h.context.translateLegacy)[1].searchTerms.at(-1)).toBe('fresh-endpoint')
  })
  it('空 options 不读 profile 或翻译；空 profile 保留无描述与扩展字段', async () => {
    const h=await actual(), translate=vi.fn(h.context.translateLegacy), read=vi.fn(() => 'unused')
    expect(h.i18n.localizeServiceOptions([],[{get id(){return read()},endpoint:'unused',models:[]}],translate)).toEqual([]);expect(read).not.toHaveBeenCalled();expect(translate).not.toHaveBeenCalled()
    expect(h.i18n.localizeServiceOptions([{value:'x',label:'x',extra:42}],[],translate)).toEqual([{value:'x',label:'x',description:undefined,searchTerms:['x','x'],extra:42}])
  })
})


describe('SSR 语言夹具资源边界', () => {
  it('无需 localhost DNS 解析，真实语言模块仍可读取', async () => {
    const lookup = vi.spyOn(dnsPromises, 'lookup')
    const h = await create()
    expect(h.context.language.value).toBe('zh-CN')
    expect(lookup).not.toHaveBeenCalled()
  })
  it('不建立 TCP 或 WebSocket 监听，真实语言模块仍可读取', async () => {
    const listen = vi.spyOn(TcpServer.prototype, 'listen')
    const h = await create()
    expect(h.context.language.value).toBe('zh-CN')
    expect(listen).not.toHaveBeenCalled()
  })
})


describe('公共 i18n 插件的扫描与 document 权限', () => {
  function appPort() {
    let context!: import('@/src/ui/i18n').UiI18nContext
    let rootUnmount!: () => void
    const nativeUnmount=vi.fn(), provide=vi.fn((_key:unknown,value:import('@/src/ui/i18n').UiI18nContext)=>{context=value})
    const app={config:{globalProperties:{}},provide,directive:vi.fn(),mixin:(hooks:{beforeUnmount:()=>void})=>{rootUnmount=hooks.beforeUnmount},unmount:nativeUnmount}
    return {app:app as unknown as import('vue').App,nativeUnmount,provide,context:()=>context,
      rootUnmount:()=>{const vm:{$root?:unknown}={};vm.$root=vm;rootUnmount.call(vm)}}
  }
  function install(createPlugin:typeof import('@/src/ui/i18n').createUiI18nPlugin,port:ReturnType<typeof appPort>,options:import('@/src/ui/i18n').UiI18nPluginOptions) {
    const plugin=createPlugin(options)
    if(typeof plugin.install !== 'function')throw new Error('Actual UI i18n plugin must provide an install function')
    plugin.install(port.app)
  }

  it.each([
    {name:'未授权默认值',document:'undefined',ui:'undefined',scan:'none',metadata:false},
    {name:'undefined 扫描根沿用 document',document:'body',ui:'undefined',scan:'body',metadata:true},
    {name:'null document 的原禁用合同',document:'null',ui:'undefined',scan:'none',metadata:false},
    {name:'自有容器扫描不授予宿主元信息',document:'null',ui:'owned',scan:'owned',metadata:false},
    {name:'null 扫描根独立保留 document 元信息',document:'body',ui:'null',scan:'none',metadata:true},
    {name:'独立自有容器与 document 元信息',document:'body',ui:'owned',scan:'owned',metadata:true},
    {name:'显式自有容器与未指定 document',document:'undefined',ui:'owned',scan:'owned',metadata:false},
  ] as const)('$name：中文→英文→中文不扩大扫描权限',async row=>{
    const h=actualHarness=await createActualStoreHarness()
    const core=await import('@/src/core/i18n'),bundles=await import('@/src/core/i18n/bundles')
    core.registerUiLanguageBundle('en-US',bundles.UI_LANGUAGE_BUNDLES['en-US'])
    expect(core.translateLegacyText('翻译','en-US')).not.toBe('翻译')
    const {document,window}=parseHTML('<html lang="host-language"><head><title>Host title</title></head><body><button id="host" title="关闭">翻译</button><div id="owned"><button title="关闭">翻译</button></div></body></html>')
    const observers:Array<{observe:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>}> = []
    vi.stubGlobal('MutationObserver',class {observe=vi.fn();disconnect=vi.fn();constructor(){observers.push(this)}})
    for(const [name,value] of Object.entries({document,Node:window.Node,NodeFilter:{SHOW_TEXT:4}}))vi.stubGlobal(name,value)
    const owned=document.querySelector('#owned') as unknown as HTMLElement,host=document.querySelector('#host')!
    document.documentElement.lang='host-language'
    const root=(value:typeof row.document|typeof row.ui)=>value==='body'?document.body as unknown as HTMLElement:value==='owned'?owned:value==='null'?null:undefined
    const port=appPort()
    try {
      install(h.i18n.createUiI18nPlugin,port,{documentRoot:root(row.document),uiRoot:root(row.ui),documentTitleKey:'metadata.optionsTitle'})
      const context=port.context()
      expect(observers).toHaveLength(row.scan==='none'?0:1)
      if(row.scan!=='none')expect(observers[0].observe).toHaveBeenCalledWith(row.scan==='body'?document.body:owned,expect.objectContaining({subtree:true,childList:true,characterData:true,attributes:true}))
      await h.commit('en-US',11)
      await vi.waitFor(()=>expect(context.language.value).toBe('en-US'))
      if(row.scan!=='none')await vi.waitFor(()=>expect(owned.querySelector('button')!.textContent).toBe(context.translateLegacy('翻译')))
      expect(owned.querySelector('button')!.textContent).toBe(row.scan==='none'?'翻译':context.translateLegacy('翻译'))
      expect(owned.querySelector('button')!.title).toBe(row.scan==='none'?'关闭':context.translateLegacy('关闭'))
      expect(host.textContent).toBe(row.scan==='body'?context.translateLegacy('翻译'):'翻译')
      expect(host.getAttribute('title')).toBe(row.scan==='body'?context.translateLegacy('关闭'):'关闭')
      expect(document.documentElement.lang).toBe(row.metadata?'en-US':'host-language')
      expect(document.title).toBe(row.metadata?context.t('metadata.optionsTitle'):'Host title')
      await h.commit('zh-CN',12)
      await vi.waitFor(()=>expect(context.language.value).toBe('zh-CN'))
      if(row.scan!=='none')await vi.waitFor(()=>expect(owned.querySelector('button')!.textContent).toBe('翻译'))
      expect(owned.querySelector('button')!.title).toBe('关闭');expect(host.textContent).toBe('翻译');expect(host.getAttribute('title')).toBe('关闭')
      expect(document.documentElement.lang).toBe(row.metadata?'zh-CN':'host-language')
      expect(document.title).toBe(row.metadata?context.t('metadata.optionsTitle'):'Host title')
    } finally {port.app.unmount()}
  })

  it.each(['app.unmount','root mixin'] as const)('%s 先释放自有扫描资源，零号 timer 与迟到回调不能复活',async path=>{
    const h=await create(),root=h.document.body
    root.innerHTML='<button>翻译</button>'
    const observers:Array<{observe:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>;callback:MutationCallback}>=[]
    vi.stubGlobal('MutationObserver',class {observe=vi.fn();disconnect=vi.fn();constructor(readonly callback:MutationCallback){observers.push(this)}})
    let queued!:()=>void
    const timer=vi.spyOn(globalThis,'setTimeout').mockImplementation(((callback:()=>void)=>{queued=callback;return 0}) as unknown as typeof setTimeout)
    const clear=vi.spyOn(globalThis,'clearTimeout').mockImplementation(()=>undefined),port=appPort()
    install(h.uiModule.createUiI18nPlugin,port,{documentRoot:null,uiRoot:root})
    const context=port.context(),dispose=vi.spyOn(context,'dispose'),observer=observers[0]
    expect(observers).toHaveLength(1);expect(observer.observe).toHaveBeenCalledTimes(1);expect(timer).toHaveBeenCalledOnce()
    if(path==='app.unmount')port.app.unmount();else port.rootUnmount()
    expect(dispose).toHaveBeenCalledOnce();expect(clear).toHaveBeenCalledWith(0);expect(observer.disconnect).toHaveBeenCalledOnce()
    const reads=observer.observe.mock.calls.length
    queued();observer.callback([{type:'childList',target:root,addedNodes:[]} as unknown as MutationRecord],observer as unknown as MutationObserver)
    h.foreign('en-US');await settle()
    expect(context.language.value).toBe('zh-CN');expect(root.querySelector('button')!.textContent).toBe('翻译')
    expect(observer.observe).toHaveBeenCalledTimes(reads);expect(timer).toHaveBeenCalledOnce()
    port.app.unmount();port.rootUnmount()
    expect(dispose).toHaveBeenCalledOnce();expect(observer.disconnect).toHaveBeenCalledOnce()
    await expect(context.setLanguage('ja-JP')).resolves.toBe(false);expect(h.requests).toHaveLength(0)
    expect(dispose.mock.invocationCallOrder[0]).toBeLessThan(port.nativeUnmount.mock.invocationCallOrder[0])
  })

  it('自有根 observe 抛错时保留原异常并释放资源，安装后的 unmount 和语言变化不能重连',async()=>{
    const h=await create(),error=new Error('owned observe failed'),port=appPort()
    const observe=vi.fn(()=>{throw error}),disconnect=vi.fn()
    vi.stubGlobal('MutationObserver',class {observe=observe;disconnect=disconnect})
    expect(()=>install(h.uiModule.createUiI18nPlugin,port,{documentRoot:null,uiRoot:h.document.body})).toThrow(error)
    expect(observe).toHaveBeenCalledOnce();expect(disconnect).toHaveBeenCalledOnce();expect(port.provide).not.toHaveBeenCalled()
    port.app.unmount();h.foreign('en-US');await settle()
    expect(observe).toHaveBeenCalledOnce();expect(disconnect).toHaveBeenCalledOnce();expect(port.nativeUnmount).toHaveBeenCalledOnce()
  })
})

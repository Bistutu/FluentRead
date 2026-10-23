import {parseHTML} from 'linkedom';
import {readFileSync} from 'node:fs';
import * as runtime from 'vue';
import {resolve} from 'node:path';
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {FREE_TRANSLATION_PROVIDERS} from '@/src/core/config/freeTranslation';
import {calculateFreeTranslationWeightSnapshot} from '@/src/services/translation/freeWeights';
import {checkAllFreeTranslationProviders, type FreeTranslationChecks} from '@/src/features/settings/ui/services/freeTranslationChecks';

const permissionEvents = new Set<(change: 'added' | 'removed') => void>();
const permissionPorts = {browser: 'chrome', read: vi.fn(), request: vi.fn(), send: vi.fn(), events: permissionEvents,
  translate: (key: string) => {void permissionBundleRevision.value;return permissionCatalogs.get(permissionLanguage.value)?.[key] || key;}};
const permissionLanguage = runtime.ref('zh-CN'), permissionBundleRevision = runtime.ref(0);
const permissionCatalogs = new Map<string, Record<string, string>>();
let settingsProps: {config: Config; advanced: boolean; checks: FreeTranslationChecks; active: boolean};
function permissionEvent(change: 'added' | 'removed'): void {for (const callback of permissionEvents) callback(change);}
async function drainPermission(): Promise<void> {for (let i=0;i<16;i++) {await Promise.resolve();await runtime.nextTick();}}
const componentPath = 'src/features/settings/ui/services/FreeTranslationSettings.vue';
type Node = {tag: string; props: Record<string, any>; text?: string};
let app: import('vue').App;
let config: Config;
let elements: Node[];
let state: Record<string, any>;
let renderer: import('vue').Renderer<Node>;
let component: any;
let checks: FreeTranslationChecks;

beforeAll(() => {
  vi.doMock('@/src/platform/browser/freeProviderPermissions', () => ({
    readFreePoolAccess: permissionPorts.read, requestFreeProviderAccess: permissionPorts.request,
    subscribeFreeProviderAccessChanges: (callback: (change: 'added' | 'removed') => void) => {permissionEvents.add(callback);return () => permissionEvents.delete(callback);},
  }));
  vi.doMock('@/src/platform/browser/capabilities', () => ({browserCapabilities: permissionPorts}));
  vi.doMock('webextension-polyfill', () => ({default: {runtime: {sendMessage: permissionPorts.send}}}));
  vi.doMock('@/src/ui/i18n', () => ({useUiI18n: () => ({t: permissionPorts.translate, translateLegacy: (text: string) => text})}));
  vi.doMock('@/src/features/settings/ui/components/FieldHelp.vue', () => ({default: {
    props: ['content'], setup: (props: {content: string}) => () => runtime.h('span', {'data-help-content': props.content}),
  }}));
});

async function mountComponent(advanced: boolean): Promise<void> {
  component = (await import('@/src/features/settings/ui/services/FreeTranslationSettings.vue')).default;
  elements = [];
  renderer = runtime.createRenderer<Node, Node>({patchProp: (node, key, _previous, value) => {node.props[key] = value;}, insert: () => undefined, remove: () => undefined, createElement: tag => {const node = {tag, props: {}}; elements.push(node); return node;}, createText: () => ({tag: '#text', props: {}}), createComment: () => ({tag: '#comment', props: {}}), setText: () => undefined, setElementText: (node, value) => {node.text = value;}, parentNode: () => null, nextSibling: () => null, querySelector: () => null, setScopeId: () => undefined, cloneNode: node => ({...node}), insertStaticContent: () => [{tag: '#static', props: {}}, {tag: '#static', props: {}}]});
  settingsProps = runtime.reactive({config, advanced, checks, active: true});
  app = renderer.createApp({setup: () => () => runtime.h(component, {...settingsProps, ref: (vm: any) => {if (vm) state = vm.$.setupState;}})});
  app.config.warnHandler = () => undefined;
  app.mount({tag: '#root', props: {}});
  await runtime.nextTick();
  if (!advanced) {
    const disclosure = elements.find(node => node.tag === 'details' && node.props['data-free-provider-disclosure'] !== undefined)!;
    expect(disclosure.props.open).toBe(true);
  }
}

beforeEach(async () => {
  permissionEvents.clear();permissionCatalogs.clear();permissionLanguage.value='zh-CN';permissionBundleRevision.value=0;
  // 权限恢复监听需要真实事件树；完整 DOM 端口也保留第三方展示组件的浏览器检测契约。
  const dom = parseHTML('<html><body></body></html>');
  Object.defineProperty(dom.document, 'visibilityState', {configurable:true, value:'visible'});
  for (const [key,value] of Object.entries({window:dom.window, document:dom.document, Event:dom.window.Event,
    ShadowRoot:dom.window.ShadowRoot, HTMLElement:dom.window.HTMLElement, navigator:{userAgent:'FluentRead fixture'}})) vi.stubGlobal(key,value);
  permissionPorts.browser = 'chrome';permissionPorts.read.mockReset();permissionPorts.request.mockReset();permissionPorts.send.mockReset();permissionPorts.send.mockResolvedValue({success:false});
  config = runtime.reactive(new Config());
  checks = runtime.reactive({});
  await mountComponent(false);
});
afterEach(() => {app?.unmount(); vi.unstubAllGlobals();});
function control(ariaLabel: string): Node { const element = [...elements].reverse().find(node => node.props['aria-label'] === ariaLabel); expect(element, ariaLabel).toBeDefined(); return element!; }

describe('free translation settings actual client component', () => {
  it('Safari首次权重等待授权读取，并接受仅一条授权线路的后台冷却快照',async()=>{
    app.unmount();permissionPorts.browser='safari';config.freeTranslationOrder=['microsoft','google'];let release!: (value:unknown)=>void;
    permissionPorts.read.mockReturnValue(new Promise(resolve=>{release=resolve}));permissionPorts.send.mockClear();
    const snapshot=calculateFreeTranslationWeightSnapshot(['microsoft'],[{providerId:'microsoft',retryAt:2000,failures:1,category:'unavailable'}],1000);
    permissionPorts.send.mockResolvedValue({success:true,snapshot});await mountComponent(false);
    for(let i=0;i<6;i++){await Promise.resolve();await runtime.nextTick();}
    expect(state.canReadWeights).toBe(false);expect(permissionPorts.send).not.toHaveBeenCalled();
    release({supported:true,grantedIds:['microsoft'],preferredGrant:{id:'google',origins:[]}});
    for(let i=0;i<12;i++){await Promise.resolve();await runtime.nextTick();}
    expect(permissionPorts.send).toHaveBeenCalledTimes(1);expect(state.weightSnapshot).toEqual(snapshot);
    expect(state.localWeightSnapshot.total).toBe(100);expect(state.displayedWeightSnapshot.total).toBe(0);expect(state.weightStatus('microsoft')).toBe('cooling');expect(state.providerStateLabel('google')).toBe('safari.freePool.permissionState');
    expect(elements.find(node=>node.props['data-provider-weight']==='microsoft')?.text).toBe('0.0%');
  })
  it('Safari授权完成会取消在flight的旧权重代，立即读取新权限快照且迟到旧结果不回写',async()=>{
    app.unmount();permissionPorts.browser='safari';config.freeTranslationOrder=['microsoft','google'];
    permissionPorts.read.mockResolvedValueOnce({supported:true,grantedIds:['microsoft'],preferredGrant:{id:'google',origins:[]}})
      .mockResolvedValue({supported:true,grantedIds:['microsoft','google'],preferredGrant:null});
    const pending: Array<(value:unknown)=>void>=[];permissionPorts.send.mockReset();
    permissionPorts.send.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
    const drain=async()=>{for(let i=0;i<12;i++){await Promise.resolve();await runtime.nextTick();}};
    await mountComponent(false);await drain();expect(pending).toHaveLength(1);
    const oldSnapshot=calculateFreeTranslationWeightSnapshot(['microsoft'],[],1000);
    const freshSnapshot=calculateFreeTranslationWeightSnapshot(['microsoft','google'],[{providerId:'microsoft',retryAt:4000,failures:1,category:'unavailable'}],2000);
    permissionPorts.request.mockResolvedValue(true);
    const grant=control('safari.freePool.allowProvider').props.onClick();expect(permissionPorts.request).toHaveBeenCalledWith('google');
    await grant;await drain();expect(pending).toHaveLength(2);
    pending[1]({success:true,snapshot:freshSnapshot});await drain();
    expect(state.weightSnapshot).toEqual(freshSnapshot);expect(state.providerWeight('microsoft')).toBe(0);expect(state.providerWeight('google')).toBe(100);
    pending[0]({success:true,snapshot:oldSnapshot});await drain();
    expect(state.weightSnapshot).toEqual(freshSnapshot);expect(state.displayedWeightSnapshot.observedAt).toBe(2000);expect(permissionPorts.send).toHaveBeenCalledTimes(2);
    expect(state.grantingProvider).toBeNull();expect(state.permissionError).toBe('');
  })
  it('Safari首次权限API错误不轮询权重、不自动重试授权读取',async()=>{
    app.unmount();permissionPorts.browser='safari';permissionPorts.read.mockRejectedValue(Error('API unavailable'));permissionPorts.send.mockClear();await mountComponent(false);
    for(let i=0;i<12;i++){await Promise.resolve();await runtime.nextTick();}
    expect(state.permissionError).toBe('safari.freePool.error');expect(permissionPorts.read).toHaveBeenCalledTimes(1);expect(permissionPorts.send).not.toHaveBeenCalled();expect(state.canReadWeights).toBe(false);expect(permissionPorts.request).not.toHaveBeenCalled();
  })
  async function mountSafari() {
    app.unmount();permissionPorts.browser='safari';config.freeTranslationOrder=['microsoft','google'];
    permissionPorts.read.mockResolvedValue({supported:true,grantedIds:[],preferredGrant:{id:'microsoft',origins:['https://edge.microsoft.com/*']}});
    await mountComponent(false);await Promise.resolve();await runtime.nextTick();
  }
  it('Safari真实服务行显示待授权，实际允许按钮同步请求单线路，成功复核不修改freeOrder',async()=>{
    await mountSafari();expect(state.providerStateLabel('microsoft')).toBe('safari.freePool.permissionState');expect(state.providerWeight('microsoft')).toBe(0);
    const order=[...config.freeTranslationOrder],pending: {resolve?: (value:boolean)=>void}={};
    permissionPorts.request.mockImplementation(()=>new Promise<boolean>(resolve=>{pending.resolve=resolve}));
    const job=control('safari.freePool.allowProvider').props.onClick();expect(permissionPorts.request).toHaveBeenCalledTimes(1);
    const provider=permissionPorts.request.mock.calls[0][0];expect(['microsoft','google']).toContain(provider);
    permissionPorts.read.mockResolvedValue({supported:true,grantedIds:[provider],preferredGrant:null});pending.resolve!(true);await job;await runtime.nextTick();
    expect(state.providerStateLabel(provider)).not.toBe('safari.freePool.permissionState');expect(config.freeTranslationOrder).toEqual(order);
  })
  it.each(['denied','partial','error','throw'] as const)('Safari %s授权无故障耗时、无自动下一家，仍可手动重试',async kind=>{
    await mountSafari();permissionPorts.request.mockImplementation(()=>{if(kind==='throw')throw Error('extension context expired');return kind==='error'?Promise.reject(Error('fixture')):Promise.resolve(kind!=='denied')});
    await control('safari.freePool.allowProvider').props.onClick();await runtime.nextTick();
    expect(permissionPorts.request).toHaveBeenCalledTimes(1);expect(state.permissionError).toMatch(/safari\.freePool\.(?:requestDenied|error)/);expect(state.providerDuration('google')).toBeUndefined();expect(state.grantingProvider).toBeNull();
    expect(control('safari.freePool.allowProvider').props.disabled).toBe(false);
  })
  it('Safari卸载丢弃迟到授权和复核，读取失败显示独立错误',async()=>{
    await mountSafari();let resolve!: (value:boolean)=>void;permissionPorts.request.mockReturnValue(new Promise<boolean>(yes=>{resolve=yes}));
    const before=permissionPorts.read.mock.calls.length,job=control('safari.freePool.allowProvider').props.onClick();app.unmount();resolve(true);await job;
    expect(permissionPorts.read).toHaveBeenCalledTimes(before);
    permissionPorts.read.mockRejectedValue(Error('unavailable'));await mountComponent(false);await Promise.resolve();await runtime.nextTick();expect(state.permissionError).toBe('safari.freePool.error');
  })
  it('撤销权限刷新实际授权行和权重，保留显式重新授权入口',async()=>{
    app.unmount();permissionPorts.browser='safari';config.freeTranslationOrder=['microsoft'];
    permissionPorts.read.mockResolvedValue({supported:true,grantedIds:['microsoft'],preferredGrant:null});await mountComponent(false);await drainPermission();
    permissionPorts.read.mockResolvedValue({supported:true,grantedIds:[],preferredGrant:{id:'microsoft',origins:[]}});
    permissionPorts.send.mockResolvedValue({success:true,snapshot:calculateFreeTranslationWeightSnapshot([])});permissionEvent('removed');await drainPermission();
    expect(state.providerGranted('microsoft')).toBe(false);expect(state.providerWeight('microsoft')).toBe(0);expect(state.permissionSummary).toBe('safari.freePool.availableCount');
    permissionPorts.request.mockResolvedValue(false);await control('safari.freePool.allowProvider').props.onClick();expect(permissionPorts.request).toHaveBeenCalledWith('microsoft');
  })
  it('外部授权刷新但不发request，自身added与focus不淘汰同次授权并取得新权重',async()=>{
    await mountSafari();await drainPermission();permissionPorts.read.mockResolvedValue({supported:true,grantedIds:['microsoft'],preferredGrant:{id:'google',origins:[]}});
    permissionEvent('added');await drainPermission();expect(state.providerGranted('microsoft')).toBe(true);expect(permissionPorts.request).not.toHaveBeenCalled();
    let release!:(granted:boolean)=>void;permissionPorts.request.mockImplementation(()=>{permissionEvent('added');window.dispatchEvent(new Event('focus'));return new Promise<boolean>(resolve=>{release=resolve;});});
    const reads=permissionPorts.read.mock.calls.length,grant=state.allowProvider('google');expect(permissionPorts.read).toHaveBeenCalledTimes(reads);expect(permissionPorts.request).toHaveBeenCalledOnce();
    permissionPorts.read.mockResolvedValue({supported:true,grantedIds:['microsoft','google'],preferredGrant:null});release(true);await grant;await drainPermission();expect(state.providerGranted('google')).toBe(true);expect(state.grantingProvider).toBeNull();
  })
  it.each(['removed','order','closed'] as const)('%s取消待授权后续，迟到许可不再复查或覆盖',async reason=>{
    await mountSafari();await drainPermission();let release!:(granted:boolean)=>void;permissionPorts.request.mockReturnValue(new Promise<boolean>(resolve=>{release=resolve;}));const grant=state.allowProvider('microsoft');
    if(reason==='removed')permissionEvent('removed');if(reason==='order')config.freeTranslationOrder=['google'];if(reason==='closed')app.unmount();await drainPermission();
    const reads=permissionPorts.read.mock.calls.length;permissionPorts.read.mockResolvedValue({supported:true,grantedIds:['microsoft'],preferredGrant:null});release(true);await grant;await drainPermission();expect(permissionPorts.read).toHaveBeenCalledTimes(reads);expect(state.providerGranted('microsoft')).toBe(false);
  })
  it('权限事件失效旧查询，停用不查询，重新激活及focus/visible回归会复查并关闭清理',async()=>{
    app.unmount();permissionPorts.browser='safari';let late!:(access:unknown)=>void;permissionPorts.read.mockReturnValueOnce(new Promise(resolve=>{late=resolve;}));await mountComponent(false);
    permissionPorts.read.mockResolvedValue({supported:true,grantedIds:[],preferredGrant:{id:'microsoft',origins:[]}});permissionEvent('removed');await drainPermission();late({supported:true,grantedIds:['microsoft'],preferredGrant:null});await drainPermission();expect(state.providerGranted('microsoft')).toBe(false);
    settingsProps.active=false;await drainPermission();const reads=permissionPorts.read.mock.calls.length;permissionEvent('added');await drainPermission();expect(permissionPorts.read).toHaveBeenCalledTimes(reads);
    permissionPorts.read.mockResolvedValue({supported:true,grantedIds:['microsoft'],preferredGrant:null});settingsProps.active=true;await drainPermission();expect(state.providerGranted('microsoft')).toBe(true);
    permissionPorts.read.mockResolvedValue({supported:true,grantedIds:[],preferredGrant:{id:'microsoft',origins:[]}});window.dispatchEvent(new Event('focus'));await drainPermission();expect(state.providerGranted('microsoft')).toBe(false);
    permissionPorts.read.mockResolvedValue({supported:true,grantedIds:['microsoft'],preferredGrant:null});document.dispatchEvent(new Event('visibilitychange'));await drainPermission();expect(state.providerGranted('microsoft')).toBe(true);
    app.unmount();await drainPermission();expect(permissionEvents.size).toBe(0);const closed=permissionPorts.read.mock.calls.length;permissionEvent('removed');window.dispatchEvent(new Event('focus'));expect(permissionPorts.read).toHaveBeenCalledTimes(closed);
  })
  it('权限错误保存key并随语言及迟到资源刷新，不新增浏览器请求',async()=>{
    await mountSafari();await drainPermission();permissionCatalogs.set('zh-CN',{'safari.freePool.requestDenied':'尚未授权'});permissionPorts.request.mockResolvedValue(false);
    await state.allowProvider('microsoft');await drainPermission();expect(state.permissionSummary).toBe('尚未授权');const reads=permissionPorts.read.mock.calls.length;
    permissionLanguage.value='en-US';await drainPermission();permissionCatalogs.set('en-US',{'safari.freePool.requestDenied':'Permission was not granted'});permissionBundleRevision.value++;await drainPermission();
    expect(state.permissionSummary).toBe('Permission was not granted');expect(permissionPorts.read).toHaveBeenCalledTimes(reads);expect(permissionPorts.request).toHaveBeenCalledOnce();
  })
  it('微软第一、B站第二仅展示免费标记，手动顺序仍可调整', async () => {
    expect(state.providers.slice(0, 2).map((provider: {id: string}) => provider.id)).toEqual(['microsoft', 'bilibiliFree']);
    expect(elements.filter(node => node.props['data-service-nature-badge'] === 'bilibiliFree').map(node => node.text)).toEqual(['免费']);
    expect(elements.some(node => node.text?.includes('推荐'))).toBe(false);
    state.setMode('sequential');
    config.freeTranslationOrder = ['google', 'bilibiliFree'];
    await runtime.nextTick();
    expect(state.providers.map((provider: {id: string}) => provider.id).slice(0, 2)).toEqual(['google', 'bilibiliFree']);
  });
  it('B站独立入口与免费聚合项复用免费徽标，DeepLX仍保持免费非官方标记', async () => {
    app.unmount();
    const badge = (await import('@/src/features/settings/ui/services/ServiceNatureBadge.vue')).default;
    const badgeProps = runtime.reactive({service: 'bilibili'});
    elements = [];
    app = renderer.createApp({setup: () => () => runtime.h(badge as runtime.Component, badgeProps)});
    app.provide(runtime.ssrContextKey, {modules: new Set<string>()});app.config.warnHandler = () => undefined;
    app.mount({tag: '#root', props: {}});await runtime.nextTick();
    expect(elements.filter(node => node.props['data-service-nature-badge'] === 'bilibili').map(node => node.text)).toEqual(['免费']);
    badgeProps.service = 'deeplx';await runtime.nextTick();
    expect(elements.filter(node => node.props['data-service-nature-badge'] === 'deeplx').map(node => node.text)).toEqual(['settings.services.library.freeUnofficial']);
  });
  it('已失效的检查不发布排队状态或发起请求', async () => {
    let updates = 0, requests = 0;
    await checkAllFreeTranslationProviders({isCurrent: () => false, failureMessage: 'failed',
      update: () => {updates++;}, check: async () => {requests++;return {success: true};}});
    expect(updates).toBe(0);expect(requests).toBe(0);
  });
  it('排队回调取消后停止后续状态发布，不启动任何服务', async () => {
    let current = true, requests = 0;const updates: string[] = [];
    await checkAllFreeTranslationProviders({isCurrent: () => current, failureMessage: 'failed',
      update: id => {updates.push(id);current = false;}, check: async () => {requests++;return {success: true};}});
    expect(updates).toEqual([FREE_TRANSLATION_PROVIDERS[0].id]);expect(requests).toBe(0);
  });
  it('checking状态回调取消后不发起对应HTTP消息', async () => {
    let current = true, requests = 0;
    await checkAllFreeTranslationProviders({isCurrent: () => current, failureMessage: 'failed',
      update: (_id, value) => {if (value.status === 'checking') current = false;}, check: async () => {requests++;return {success: true};}});
    expect(requests).toBe(0);
  });
  it('所有服务直接展示逐项结果与测试耗时，停用服务也保留本轮检查', async () => {
    const badges = elements.filter(element => element.props['data-provider-state']);
    expect(badges.map(node => node.props['data-provider-state'])).toEqual(FREE_TRANSLATION_PROVIDERS.map(provider => provider.id));
    expect(badges.every(node => node.text === 'settings.services.keys.unchecked')).toBe(true);
    checks.microsoft = {status: 'success', durationMs: 35};
    checks.transmart = {status: 'error', error: '服务限流', durationMs: 1200};
    checks.google = {status: 'checking'};
    await runtime.nextTick();
    expect(state.providerStateLabel('microsoft')).toBe('连接正常');
    expect(elements.find(element => element.props['data-provider-duration'] === 'microsoft')?.text).toBe('35 ms');
    expect(elements.find(element => element.props['data-provider-duration'] === 'transmart')?.text).toBe('1200 ms');
    expect(state.providerStateTitle('microsoft')).toBe('连接正常 · en → zh-Hans · 35 ms');
    expect(state.providerStateLabel('transmart')).toBe('连接失败');
    expect(state.failedProviders.map((provider: {id: string}) => provider.id)).toEqual(['transmart']);
    expect(state.providerStateTitle('transmart')).toBe('服务限流 · en → zh-Hans · 1200 ms');
    expect(state.providerStateLabel('google')).toBe('settings.services.keys.checking');
    state.setMode('sequential');
    await runtime.nextTick();
    expect(state.providerState('microsoft')).toBe('success');
    checks.apertiumFree = {status: 'success', durationMs: 40};
    state.toggle('apertiumFree', true);
    await runtime.nextTick();
    expect(state.providerStateTitle('apertiumFree')).toBe('连接正常 · en → es · 40 ms');
  });

  it('完整目录检查包含停用服务，独立失败仍继续检查其余服务', async () => {
    state.toggle('apertiumFree', false);
    const called: string[] = [];
    let active = 0, peak = 0;
    await checkAllFreeTranslationProviders({
      check: async id => {
        called.push(id); active += 1; peak = Math.max(peak, active);
        await Promise.resolve(); active -= 1;
        if (id === 'microsoft') throw new Error('网络不可用');
        if (id === 'transmart') return {success: false, error: '服务限流'};
        if (id === 'google') return undefined;
        if (id === 'youdaoFree') throw '连接中断';
        return {success: true, durationMs: 10};
      },
      update: (id, state) => { checks[id] = state; }, isCurrent: () => true, failureMessage: '检查失败', now: () => 0,
    });
    expect(called).toEqual(FREE_TRANSLATION_PROVIDERS.map(provider => provider.id));
    expect(peak).toBe(3);
    expect(checks.microsoft).toEqual({status: 'error', error: '网络不可用', durationMs: 0});
    expect(checks.transmart).toEqual({status: 'error', error: '服务限流', durationMs: 0});
    expect(checks.google).toEqual({status: 'error', error: '检查失败', durationMs: 0});
    expect(checks.youdaoFree).toEqual({status: 'error', error: '连接中断', durationMs: 0});
    expect(checks.apertiumFree).toEqual({status: 'success', durationMs: 10});
    expect(config.freeTranslationOrder).not.toContain('apertiumFree');
  });

  it('measures each dispatched test without including queue time and clears timing while retesting', async () => {
    let clock = 100;
    const pending: Array<{resolve: (value: {success: boolean; durationMs?: number; error?: string}) => void; reject: (error: Error) => void}> = [];
    const run = checkAllFreeTranslationProviders({
      check: id => ['bilibiliFree', 'microsoft', 'transmart'].includes(id)
        ? new Promise((resolve, reject) => pending.push({resolve, reject}))
        : Promise.resolve({success: true, durationMs: Number.NaN}),
      update: (id, value) => {checks[id] = value;},
      isCurrent: () => true, failureMessage: '检查失败', now: () => clock,
    });
    clock = 125;
    pending[0].resolve({success: true, durationMs: 7.4});
    pending[1].resolve({success: false, error: '超时'});
    pending[2].reject(new Error('断开'));
    await run;
    expect(checks.microsoft?.durationMs).toBe(7);
    expect(checks.bilibiliFree?.durationMs).toBe(25);
    expect(checks.transmart?.durationMs).toBe(25);
    expect(checks.apertiumFree?.durationMs).toBe(0);
    checks.microsoft = {status: 'checking', durationMs: 7};
    await runtime.nextTick();
    expect(state.providerDuration('microsoft')).toBeUndefined();
    checks.microsoft = {status: 'success', durationMs: -1};
    expect(state.providerDuration('microsoft')).toBeUndefined();
    checks.microsoft = {status: 'success'};
    expect(state.providerDuration('microsoft')).toBeUndefined();
  });

  it('切换服务后不发起后续检查，迟到响应不能覆盖新状态', async () => {
    let current = true;
    const pending: Array<{resolve: (value: {success: boolean}) => void; reject: (error: Error) => void}> = [];
    const run = checkAllFreeTranslationProviders({
      check: () => new Promise((resolve, reject) => { pending.push({resolve, reject}); }),
      update: (id, state) => { checks[id] = state; }, isCurrent: () => current, failureMessage: '检查失败',
    });
    expect(pending).toHaveLength(3);
    current = false;
    checks.microsoft = {status: 'idle'};
    pending[0].reject(new Error('迟到的网络错误'));
    pending.slice(1).forEach(({resolve}) => resolve({success: true}));
    await run;
    expect(pending).toHaveLength(3);
    expect(checks.microsoft).toEqual({status: 'idle'});
    expect(checks.google).toEqual({status: 'queued'});
  });
  async function mountAdvanced(): Promise<void> {
    app.unmount();
    await mountComponent(true);
  }

  it('shows free service controls immediately while leaving timeout in advanced mode', () => {
    expect(elements.some(element => element.props['aria-label'] === 'settings.services.freeWeights.mode')).toBe(true);
    expect(elements.filter(element => element.props['data-fallback-provider'])).toHaveLength(FREE_TRANSLATION_PROVIDERS.length);
    expect(elements.some(element => element.props['aria-label'] === '每个服务最多等待（秒）')).toBe(false);
    expect(control('settings.services.library.memoryEmail')).toBeDefined();
    expect(elements.some(element => element.tag === 'section' && element.props.class === 'provider-settings')).toBe(true);
    expect(readFileSync(resolve(process.cwd(), componentPath), 'utf8')).not.toContain('my-memory-advanced');
  });

  it('renders every provider and mode control in basic mode', async () => {
    expect(state.mode).toBe('balanced');
    expect(state.providers.map((provider: {id: string}) => provider.id)).toEqual(FREE_TRANSLATION_PROVIDERS.map(provider => provider.id));
    expect(control('启用 微软翻译')).toBeDefined();
    expect(elements.some(element => element.props['aria-label'] === '启用 微软翻译')).toBe(true);
    expect(elements.some(element => element.props['data-testid'] === 'free-translation-weight-summary')).toBe(true);
    expect(elements.filter(element => element.props['data-provider-weight'])).toHaveLength(config.freeTranslationOrder.length);
    const details = elements.find(element => element.props['data-testid'] === 'free-routing-details');
    expect(details).toBeUndefined();
    expect(elements.filter(element => element.tag === 'details')).toHaveLength(1);
    expect(elements.find(element => element.tag === 'details')?.props['data-free-provider-disclosure']).toBeDefined();
    expect(elements.find(element => element.props['data-provider-weight'] === 'microsoft')?.text).toBe('13.6%');
    expect(control('启用 阿里翻译').props['model-value']).toBe(true);
    state.toggle('alibabaFree', false);
    await runtime.nextTick();
    expect(control('启用 阿里翻译').props['model-value']).toBe(false);
    state.toggle('alibabaFree', true);
    await runtime.nextTick();
    expect(control('启用 阿里翻译').props['model-value']).toBe(true);
    expect(config.freeTranslationOrder).toContain('alibabaFree');
    expect(readFileSync(resolve(process.cwd(), componentPath), 'utf8')).not.toContain('setWeight');
  });

  it('豆包网页免费节点默认开启，但不重新启用旧列表未选择的节点', async () => {
    expect(control('启用 豆包网页翻译').props['model-value']).toBe(true);
    config.freeTranslationOrder = ['google'];
    await runtime.nextTick();
    expect(state.providers.find((provider: {id: string}) => provider.id === 'doubaoWeb')?.label).toBe('豆包网页翻译');
    expect(control('启用 豆包网页翻译').props['model-value']).toBe(false);
    state.toggle('doubaoWeb', true);
    await runtime.nextTick();
    expect(config.freeTranslationOrder).toEqual(['google', 'doubaoWeb']);
    expect(control('启用 豆包网页翻译').props['model-value']).toBe(true);
  });

  it('switches mode and exposes order controls in priority mode', async () => {
    control('优先顺序').props.onChange();
    await runtime.nextTick();
    expect(config.freeTranslationMode).toBe('sequential');
    expect(control('下移 微软翻译').props.disabled).toBe(false);
    control('settings.services.freeWeights.mode').props.onChange();
    await runtime.nextTick();
    expect(config.freeTranslationMode).toBe('balanced');
  });

  it('shows cooling only for an enabled service and exposes allocation beside services', async () => {
    state.weightSnapshot = {total: 100, observedAt: Date.now(), entries: [{providerId: 'microsoft', weight: 0, status: 'cooling'}]};
    await runtime.nextTick();
    expect(state.weightStatus('microsoft')).toBe('cooling');
    state.toggle('microsoft', false);
    await runtime.nextTick();
    expect(state.weightStatus('microsoft')).toBe('disabled');
    state.weightSnapshot = {total: 100, observedAt: Date.now(), entries: [{providerId: 'microsoft', weight: 0, status: 'disabled'}]};
    state.toggle('microsoft', true);
    await runtime.nextTick();
    expect(state.weightStatus('microsoft')).toBe('ready');
  });

  it('keeps at least one service enabled', async () => {
    for (const provider of FREE_TRANSLATION_PROVIDERS.slice(1)) state.toggle(provider.id, false);
    await runtime.nextTick();
    expect(config.freeTranslationOrder).toHaveLength(1);
    const only = config.freeTranslationOrder[0];
    state.toggle(only, false);
    expect(config.freeTranslationOrder).toEqual([only]);
  });

  it('keeps partial email local and commits only valid email', async () => {
    const email = control('settings.services.library.memoryEmail');
    email.props['onUpdate:modelValue']('contact@'); email.props.onChange();
    expect(config.myMemoryEmail).toBe('');
    email.props['onUpdate:modelValue']('contact@example.test'); email.props.onChange();
    expect(config.myMemoryEmail).toBe('contact@example.test');
  });

  it('updates the timeout through the advanced control', async () => {
    await mountAdvanced();
    expect(elements.some(element => element.props['data-fallback-provider'])).toBe(false);
    const timeout = control('settings.services.waitTimeout');
    expect(elements.some(element => element.props['data-help-content'] === 'settings.services.freeWeights.timeoutHelp')).toBe(true);
    timeout.props['onUpdate:modelValue'](9);
    expect(config.freeTranslationTimeoutMs).toBe(9000);
  });
});

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';

const ports = vi.hoisted(() => ({
    config: {uiLanguageSetupCompleted: false, uiLanguage: 'en-US', interfaceFont: 'system'},
    ready: Promise.resolve() as Promise<void>, hydration: 'ready' as 'loading' | 'ready' | 'blocked',
    mainGate: undefined as Promise<void> | undefined, onboardingGate: undefined as Promise<void> | undefined,
    mainLoaded: vi.fn(), onboardingLoaded: vi.fn(), ensureBundle: vi.fn(async (_language: unknown) => {}), font: vi.fn(async (_font: unknown) => {}),
    browser: 'chrome', platform: vi.fn(), currentTab: vi.fn(), tabApi: 'present' as 'present' | 'missing-tabs' | 'missing-method', unmountCallbacks: [] as Array<()=>void>,
    createApp: vi.fn(), plugin: vi.fn(() => ({kind: 'i18n'})), use: vi.fn(), component: vi.fn(), mount: vi.fn(),
}));
vi.mock('webextension-polyfill', () => ({default: {
    runtime: {getPlatformInfo: ports.platform},
    get tabs() {return ports.tabApi==='missing-tabs' ? undefined : {getCurrent: ports.tabApi==='missing-method' ? undefined : ports.currentTab};},
}}));
vi.mock('../src/platform/browser/capabilities', () => ({browserCapabilities: {get browser() {return ports.browser;}}}));
vi.mock('vue', () => ({createApp: ports.createApp}));
vi.mock('element-plus/es/components/base/style/css', () => ({}));
vi.mock('element-plus/es/components/tooltip/style/css', () => ({}));
vi.mock('@element-plus/icons-vue', () => ({Coffee: {kind: 'coffee'}}));
vi.mock('../src/services/config/store', () => ({config: ports.config, get configReady() {return ports.ready;}, getConfigHydrationStatus: () => ports.hydration}));
vi.mock('../src/ui/i18n', () => ({createUiI18nPlugin: ports.plugin}));
vi.mock('../src/platform/i18n/uiLanguageBundles', () => ({ensureUiLanguageBundle: ports.ensureBundle}));
vi.mock('../src/ui/interfaceAppearance', () => ({prepareInterfaceFont: ports.font}));
function deferred() {let resolve!: () => void; const promise = new Promise<void>(yes => {resolve = yes;}); return {promise, resolve};}
function pageTransition(type: 'pagehide' | 'pageshow', persisted: boolean) {
    const event = new Event(type); Object.defineProperty(event, 'persisted', {value: persisted}); window.dispatchEvent(event);
}
type Bootstrap = typeof import('../src/app/popup/mount');
let bootstrap: Bootstrap;
beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks(); ports.ready = Promise.resolve(); ports.hydration = 'ready'; ports.mainGate = undefined; ports.onboardingGate = undefined;
    Object.assign(ports.config, {uiLanguageSetupCompleted: false, uiLanguage: 'en-US', interfaceFont: 'system'});
    ports.font.mockReset().mockResolvedValue(undefined); ports.ensureBundle.mockReset().mockResolvedValue(undefined);
    ports.browser='chrome';ports.platform.mockReset().mockResolvedValue({os:'mac'});ports.unmountCallbacks=[];
    ports.tabApi='present';ports.currentTab.mockReset().mockResolvedValue(undefined);
    ports.mount.mockReset();ports.createApp.mockReturnValue({use: ports.use, component: ports.component, mount: ports.mount,onUnmount: (fn:()=>void)=>ports.unmountCallbacks.push(fn)});
    vi.stubGlobal('document', parseHTML('<html><body></body></html>').document);
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('navigator', {language: 'zh-CN'});
    vi.doMock('../src/app/popup/PopupApp.vue', async () => {ports.mainLoaded(); await ports.mainGate; return {default: {kind: 'main'}};});
    vi.doMock('../src/app/popup/PopupOnboarding.vue', async () => {ports.onboardingLoaded(); await ports.onboardingGate; return {default: {kind: 'onboarding'}};});
    bootstrap = await import('../src/app/popup/mount');
});
afterEach(() => {ports.unmountCallbacks.forEach(fn=>fn());vi.unstubAllGlobals();});

describe('Popup fresh configuration bootstrap', () => {
    it.each([false,true])('Safari coarse 对首次完成=%s 的根启用自有填宽且卸载释放',async completed=>{
        ports.browser='safari';ports.config.uiLanguageSetupCompleted=completed;
        const matchMedia=vi.fn(()=>({matches:true}));vi.stubGlobal('window',Object.assign(new EventTarget(),{matchMedia}));
        await bootstrap.mountPreparedPopupApp('#owned');
        expect(matchMedia).toHaveBeenCalledOnce();expect(matchMedia).toHaveBeenCalledWith('(any-pointer: coarse)');expect(ports.platform).not.toHaveBeenCalled();
        expect(document.documentElement.getAttribute('data-fluentread-safari-touch-popup')).toBe('');
        expect(ports.createApp).toHaveBeenCalledWith({kind:completed?'main':'onboarding'});
        ports.unmountCallbacks.forEach(fn=>fn());expect(document.documentElement.hasAttribute('data-fluentread-safari-touch-popup')).toBe(false);
    });
    it.each(['chrome','firefox','thunderbird'])('%s coarse 不探测或取得 Safari 填宽标记',async browser=>{
        ports.browser=browser;const matchMedia=vi.fn(()=>({matches:true}));vi.stubGlobal('window',Object.assign(new EventTarget(),{matchMedia}));
        await bootstrap.mountPreparedPopupApp('#owned');
        expect(matchMedia).not.toHaveBeenCalled();expect(document.documentElement.hasAttribute('data-fluentread-safari-touch-popup')).toBe(false);
    });
    it.each(['fine','missing','throws','no-window'])('Safari %s 输入能力保留固有宽度且不阻塞配置挂载',async mode=>{
        ports.browser='safari';const matchMedia=vi.fn(()=>{if(mode==='throws')throw Error('media unavailable');return {matches:false};});
        vi.stubGlobal('window',mode==='no-window'?undefined:mode==='missing'?new EventTarget():Object.assign(new EventTarget(),{matchMedia}));
        await bootstrap.mountPreparedPopupApp('#owned');
        expect(ports.mount).toHaveBeenCalledOnce();expect(ports.platform).not.toHaveBeenCalled();
        expect(document.documentElement.hasAttribute('data-fluentread-safari-touch-popup')).toBe(false);
    });
    it('Safari 标记不等待配置；pending 配置退出后不重新写回或挂载',async()=>{
        ports.browser='safari';const gate=deferred();ports.ready=gate.promise;
        const matchMedia=vi.fn(()=>({matches:true}));const target=Object.assign(new EventTarget(),{matchMedia});vi.stubGlobal('window',target);
        vi.resetModules();bootstrap=await import('../src/app/popup/mount');
        const pending=bootstrap.mountPreparedPopupApp('#owned');
        expect(document.documentElement.hasAttribute('data-fluentread-safari-touch-popup')).toBe(true);expect(ports.createApp).not.toHaveBeenCalled();
        target.dispatchEvent(new Event('pagehide'));gate.resolve();await pending;
        expect(document.documentElement.hasAttribute('data-fluentread-safari-touch-popup')).toBe(false);expect(ports.createApp).not.toHaveBeenCalled();expect(matchMedia).toHaveBeenCalledOnce();
    });
    it('Safari 输入能力返回前已退出时不取得过期标记',async()=>{
        ports.browser='safari';const target=new EventTarget();
        vi.stubGlobal('window',Object.assign(target,{matchMedia:vi.fn(()=>{target.dispatchEvent(new Event('pagehide'));return {matches:true};})}));
        await bootstrap.mountPreparedPopupApp('#owned');
        expect(document.documentElement.hasAttribute('data-fluentread-safari-touch-popup')).toBe(false);expect(ports.createApp).not.toHaveBeenCalled();
    });
    it.each(['mount-failure','config-failure','hydration-blocked'] as const)('Safari %s 清理已取得的填宽标记',async reason=>{
        ports.browser='safari';vi.stubGlobal('window',Object.assign(new EventTarget(),{matchMedia:vi.fn(()=>({matches:true}))}));
        if(reason==='mount-failure')ports.mount.mockImplementation(()=>{throw Error('mount failed');});
        if(reason==='config-failure'){ports.ready=Promise.reject(Error('config failed'));ports.ready.catch(()=>{});vi.resetModules();bootstrap=await import('../src/app/popup/mount');}
        if(reason==='hydration-blocked')ports.hydration='blocked';
        await expect(bootstrap.mountPreparedPopupApp('#owned')).rejects.toThrow();
        expect(document.documentElement.hasAttribute('data-fluentread-safari-touch-popup')).toBe(false);
    });
    it('Safari pagehide 清理自有标记与监听，随后卸载重复释放安全',async()=>{
        ports.browser='safari';const target=Object.assign(new EventTarget(),{matchMedia:vi.fn(()=>({matches:true}))});vi.stubGlobal('window',target);
        const remove=vi.spyOn(target,'removeEventListener');await bootstrap.mountPreparedPopupApp('#owned');target.dispatchEvent(new Event('pagehide'));
        expect(document.documentElement.hasAttribute('data-fluentread-safari-touch-popup')).toBe(false);expect(remove).toHaveBeenCalledWith('pagehide',expect.any(Function));
        ports.unmountCallbacks.forEach(fn=>fn());expect(document.documentElement.hasAttribute('data-fluentread-safari-touch-popup')).toBe(false);
    });
    it.each(['pagehide','unmount','mount-failure'])('Safari %s 不改写或移除预存宿主标记',async reason=>{
        ports.browser='safari';const target=Object.assign(new EventTarget(),{matchMedia:vi.fn(()=>({matches:true}))});vi.stubGlobal('window',target);
        document.documentElement.setAttribute('data-fluentread-safari-touch-popup','external-owner');
        if(reason==='mount-failure')ports.mount.mockImplementation(()=>{throw Error('mount failed');});
        const pending=bootstrap.mountPreparedPopupApp('#owned');
        if(reason==='mount-failure')await expect(pending).rejects.toThrow('mount failed');else await pending;
        if(reason==='pagehide')target.dispatchEvent(new Event('pagehide'));if(reason==='unmount')ports.unmountCallbacks.forEach(fn=>fn());
        expect(document.documentElement.getAttribute('data-fluentread-safari-touch-popup')).toBe('external-owner');
    });

    it.each([false,true])('Android 固定容器对首次完成=%s 的独立根共享一次公开平台判别',async completed=>{
        ports.browser='firefox';ports.platform.mockResolvedValue({os:'android'});ports.config.uiLanguageSetupCompleted=completed;
        await bootstrap.mountPreparedPopupApp('#owned');
        expect(ports.platform).toHaveBeenCalledOnce();expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(true);
        expect(ports.createApp).toHaveBeenCalledWith({kind:completed?'main':'onboarding'});
        ports.unmountCallbacks.forEach(fn=>fn());expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(false);
    });
    it.each(['mac','win','linux','unknown'])('Firefox %s 平台保持工具栏固有宽度',async os=>{
        ports.browser='firefox';ports.platform.mockResolvedValue({os});await bootstrap.mountPreparedPopupApp('#owned');
        expect(ports.platform).toHaveBeenCalledOnce();expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(false);
    });
    it.each(['chrome','safari','thunderbird'])('%s 不调用额外平台 API 或改变 popup 宽度模式',async browser=>{
        ports.browser=browser;ports.platform.mockResolvedValue({os:'android'});await bootstrap.mountPreparedPopupApp('#owned');
        expect(ports.platform).not.toHaveBeenCalled();expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(false);
    });
    it('平台查询不结算不阻塞首启挂载，迟到 Android 回复可在菜单/旋转后启用当前 CSS 视口约束',async()=>{
        ports.browser='firefox';let resolve!: (value:{os:string})=>void;ports.platform.mockReturnValue(new Promise(yes=>{resolve=yes;}));
        await bootstrap.mountPreparedPopupApp('#owned');expect(ports.mount).toHaveBeenCalledOnce();expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(false);
        window.dispatchEvent(new Event('orientationchange'));resolve({os:'android'});await Promise.resolve();
        expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(true);expect(ports.platform).toHaveBeenCalledOnce();
    });
    it('平台查询失败保留首启挂载且不重试',async()=>{
        ports.browser='firefox';ports.platform.mockRejectedValue(Error('platform unavailable'));await bootstrap.mountPreparedPopupApp('#owned');
        expect(ports.mount).toHaveBeenCalledOnce();expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(false);expect(ports.platform).toHaveBeenCalledOnce();
    });
    it.each(['pagehide','unmount','mount-failure','config-failure','hydration-blocked'] as const)('%s 后迟到平台回复不能写回根标记',async reason=>{
        ports.browser='firefox';let resolve!: (value:{os:string})=>void;ports.platform.mockReturnValue(new Promise(yes=>{resolve=yes;}));
        if(reason==='mount-failure')ports.mount.mockImplementation(()=>{throw Error('mount failed');});
        if(reason==='config-failure'){ports.ready=Promise.reject(Error('config failed'));ports.ready.catch(()=>{});vi.resetModules();bootstrap=await import('../src/app/popup/mount');}
        if(reason==='hydration-blocked')ports.hydration='blocked';
        const pending=bootstrap.mountPreparedPopupApp('#owned');if(reason.endsWith('failure')||reason==='hydration-blocked')await expect(pending).rejects.toThrow();else await pending;
        if(reason==='pagehide')window.dispatchEvent(new Event('pagehide'));if(reason==='unmount')ports.unmountCallbacks.forEach(fn=>fn());
        resolve({os:'android'});await Promise.resolve();expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(false);
    });
    it('pagehide 移除本入口持有的标记与监听，卸载重复释放安全',async()=>{
        ports.browser='firefox';ports.platform.mockResolvedValue({os:'android'});const remove=vi.spyOn(window,'removeEventListener');await bootstrap.mountPreparedPopupApp('#owned');
        window.dispatchEvent(new Event('pagehide'));expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(false);expect(remove).toHaveBeenCalledWith('pagehide',expect.any(Function));
        ports.unmountCallbacks.forEach(fn=>fn());expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(false);
    });
    it('挂载失败释放已建立的 Android 标记',async()=>{
        ports.browser='firefox';ports.platform.mockResolvedValue({os:'android'});ports.mount.mockImplementation(()=>{throw Error('mount failed');});
        await expect(bootstrap.mountPreparedPopupApp('#owned')).rejects.toThrow('mount failed');expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(false);
    });
    it('卸载不移除其它宿主已经持有的容器标记',async()=>{
        ports.browser='firefox';ports.platform.mockResolvedValue({os:'android'});document.documentElement.setAttribute('data-fluentread-android-popup','');
        await bootstrap.mountPreparedPopupApp('#owned');ports.unmountCallbacks.forEach(fn=>fn());expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(true);
    });

    it.each(['safari','firefox'])('%s 已挂载页面反复进入往返缓存只恢复布局，不重建应用或重读配置资源',async browser=>{
        ports.browser=browser;ports.config.uiLanguageSetupCompleted=true;ports.platform.mockResolvedValue({os:'android'});
        const matchMedia=vi.fn(()=>({matches:true})),target=Object.assign(new EventTarget(),{matchMedia});vi.stubGlobal('window',target);
        const add=vi.spyOn(target,'addEventListener'),remove=vi.spyOn(target,'removeEventListener');
        const attribute=browser==='safari'?'data-fluentread-safari-touch-popup':'data-fluentread-android-popup';
        await bootstrap.mountPreparedPopupApp('#owned');
        pageTransition('pageshow',true);pageTransition('pageshow',false);
        for(let cycle=0;cycle<2;cycle++){
            expect(document.documentElement.getAttribute(attribute)).toBe('');
            pageTransition('pagehide',true);expect(document.documentElement.hasAttribute(attribute)).toBe(false);
            expect(remove).not.toHaveBeenCalled();
            pageTransition('pageshow',true);expect(document.documentElement.getAttribute(attribute)).toBe('');
        }
        expect(ports.createApp).toHaveBeenCalledOnce();expect(ports.mount).toHaveBeenCalledOnce();expect(ports.mainLoaded).toHaveBeenCalledOnce();
        expect(ports.font).toHaveBeenCalledOnce();expect(ports.ensureBundle).toHaveBeenCalledOnce();
        expect(ports.platform).toHaveBeenCalledTimes(browser==='firefox'?1:0);expect(matchMedia).toHaveBeenCalledTimes(browser==='safari'?3:0);
        expect(add.mock.calls.map(([type])=>type)).toEqual(['pagehide','pageshow']);
        ports.unmountCallbacks.forEach(fn=>fn());expect(document.documentElement.hasAttribute(attribute)).toBe(false);
        expect(remove.mock.calls.map(([type])=>type)).toEqual(['pagehide','pageshow']);
    });
    it('Safari 每次 persisted 恢复按当前 coarse 能力取得标记，fine 恢复不沿用旧布局',async()=>{
        ports.browser='safari';let coarse=true;const matchMedia=vi.fn(()=>({matches:coarse}));
        vi.stubGlobal('window',Object.assign(new EventTarget(),{matchMedia}));await bootstrap.mountPreparedPopupApp('#owned');
        pageTransition('pagehide',true);coarse=false;pageTransition('pageshow',true);
        expect(document.documentElement.hasAttribute('data-fluentread-safari-touch-popup')).toBe(false);
        pageTransition('pagehide',true);coarse=true;pageTransition('pageshow',true);
        expect(document.documentElement.getAttribute('data-fluentread-safari-touch-popup')).toBe('');
        expect(matchMedia).toHaveBeenCalledTimes(3);expect(ports.mount).toHaveBeenCalledOnce();
    });
    it('Android 已挂载 persisted 隐藏期间的平台回复只缓存，匹配恢复事件才写标记且不重查平台',async()=>{
        ports.browser='firefox';let resolve!:(value:{os:string})=>void;ports.platform.mockReturnValue(new Promise(yes=>{resolve=yes;}));
        await bootstrap.mountPreparedPopupApp('#owned');pageTransition('pagehide',true);
        resolve({os:'android'});await Promise.resolve();expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(false);
        pageTransition('pageshow',false);expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(false);
        pageTransition('pageshow',true);expect(document.documentElement.getAttribute('data-fluentread-android-popup')).toBe('');
        expect(ports.platform).toHaveBeenCalledOnce();expect(ports.mount).toHaveBeenCalledOnce();
    });
    it.each(['safari','firefox'])('%s persisted 隐藏中卸载后，旧 pageshow 和迟到平台回复不能恢复标记',async browser=>{
        ports.browser=browser;let resolve!:(value:{os:string})=>void;ports.platform.mockReturnValue(new Promise(yes=>{resolve=yes;}));
        const target=Object.assign(new EventTarget(),{matchMedia:vi.fn(()=>({matches:true}))});vi.stubGlobal('window',target);
        const remove=vi.spyOn(target,'removeEventListener');await bootstrap.mountPreparedPopupApp('#owned');pageTransition('pagehide',true);
        ports.unmountCallbacks.forEach(fn=>fn());resolve?.({os:'android'});await Promise.resolve();pageTransition('pageshow',true);
        expect(document.documentElement.hasAttribute('data-fluentread-safari-touch-popup')).toBe(false);
        expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(false);expect(ports.mount).toHaveBeenCalledOnce();
        expect(remove.mock.calls.map(([type])=>type)).toEqual(['pagehide','pageshow']);
    });
    it.each(['safari','firefox'])('%s persisted 隐藏后再普通退出保持终止，不能被 pageshow 重新激活',async browser=>{
        ports.browser=browser;ports.platform.mockResolvedValue({os:'android'});
        const target=Object.assign(new EventTarget(),{matchMedia:vi.fn(()=>({matches:true}))});vi.stubGlobal('window',target);
        const remove=vi.spyOn(target,'removeEventListener');await bootstrap.mountPreparedPopupApp('#owned');
        pageTransition('pagehide',true);pageTransition('pagehide',false);pageTransition('pageshow',true);
        expect(document.documentElement.hasAttribute('data-fluentread-safari-touch-popup')).toBe(false);
        expect(document.documentElement.hasAttribute('data-fluentread-android-popup')).toBe(false);expect(ports.mount).toHaveBeenCalledOnce();
        expect(remove.mock.calls.map(([type])=>type)).toEqual(['pagehide','pageshow']);
    });
    it.each(['configuration','font'] as const)('挂载前 pending %s 的 persisted hide 仍终止，恢复和异步结果不能补挂载',async pendingResource=>{
        ports.browser='safari';const gate=deferred();
        vi.stubGlobal('window',Object.assign(new EventTarget(),{matchMedia:vi.fn(()=>({matches:true}))}));
        if(pendingResource==='configuration'){ports.ready=gate.promise;vi.resetModules();bootstrap=await import('../src/app/popup/mount');}
        else ports.font.mockReturnValueOnce(gate.promise);
        const pending=bootstrap.mountPreparedPopupApp('#owned');
        if(pendingResource==='font')await vi.waitFor(()=>expect(ports.font).toHaveBeenCalledOnce());
        pageTransition('pagehide',true);pageTransition('pageshow',true);gate.resolve();await pending;pageTransition('pageshow',true);
        expect(ports.createApp).not.toHaveBeenCalled();expect(document.documentElement.hasAttribute('data-fluentread-safari-touch-popup')).toBe(false);
    });
    it.each(['safari','firefox'])('%s 自有标记在可见或隐藏期间被其它宿主接管后，恢复与卸载不覆盖或删除它',async browser=>{
        ports.browser=browser;ports.platform.mockResolvedValue({os:'android'});
        vi.stubGlobal('window',Object.assign(new EventTarget(),{matchMedia:vi.fn(()=>({matches:true}))}));
        const attribute=browser==='safari'?'data-fluentread-safari-touch-popup':'data-fluentread-android-popup';
        await bootstrap.mountPreparedPopupApp('#owned');document.documentElement.setAttribute(attribute,'external-visible-owner');
        pageTransition('pagehide',true);expect(document.documentElement.getAttribute(attribute)).toBe('external-visible-owner');
        pageTransition('pageshow',true);expect(document.documentElement.getAttribute(attribute)).toBe('external-visible-owner');
        document.documentElement.removeAttribute(attribute);pageTransition('pagehide',true);pageTransition('pageshow',true);
        expect(document.documentElement.getAttribute(attribute)).toBe('');
        pageTransition('pagehide',true);document.documentElement.setAttribute(attribute,'external-hidden-owner');pageTransition('pageshow',true);
        expect(document.documentElement.getAttribute(attribute)).toBe('external-hidden-owner');
        ports.unmountCallbacks.forEach(fn=>fn());expect(document.documentElement.getAttribute(attribute)).toBe('external-hidden-owner');
    });

    it('无 Window 宿主时仍可按配置组装并由 app 卸载释放',async()=>{
        vi.stubGlobal('window',undefined);await bootstrap.mountPreparedPopupApp('#owned');expect(ports.mount).toHaveBeenCalledWith('#owned');
        ports.unmountCallbacks.forEach(fn=>fn());
    });
    it('waits for fresh configuration before importing or creating a root', async () => {
        const gate = deferred(); ports.ready = gate.promise;
        // Re-import the actual module after configuring its hydration port.
        vi.resetModules(); bootstrap = await import('../src/app/popup/mount');
        const pending = bootstrap.mountPreparedPopupApp('#owned'); await Promise.resolve();
        expect(ports.onboardingLoaded).not.toHaveBeenCalled(); expect(ports.createApp).not.toHaveBeenCalled();
        ports.config.uiLanguageSetupCompleted = true; gate.resolve(); await pending;
        expect(ports.createApp).toHaveBeenCalledWith({kind: 'main'});
    });
    it('loads only the onboarding root, prepares its font and registers normal UI ports', async () => {
        await bootstrap.mountPreparedPopupApp('#owned');
        expect(ports.mainLoaded).not.toHaveBeenCalled(); expect(ports.ensureBundle).not.toHaveBeenCalled();
        expect(ports.font).toHaveBeenCalledWith('system'); expect(ports.createApp).toHaveBeenCalledWith({kind: 'onboarding'});
        expect(ports.plugin).toHaveBeenCalledWith({documentRoot: document.body, documentTitleKey: 'metadata.popupTitle'});
        expect(ports.use).toHaveBeenCalledWith({kind: 'i18n'}); expect(ports.component).toHaveBeenCalledWith('Coffee', {kind: 'coffee'});
        expect(ports.mount).toHaveBeenCalledWith('#owned');
    });
    it.each(['loading', 'blocked'] as const)('rejects resolved configuration with %s hydration before importing a root or preparing assets', async hydration => {
        ports.hydration = hydration;
        const remove = vi.spyOn(window, 'removeEventListener');
        await expect(bootstrap.mountPreparedPopupApp('#owned')).rejects.toThrow('Popup configuration is not ready');
        expect(ports.mainLoaded).not.toHaveBeenCalled(); expect(ports.onboardingLoaded).not.toHaveBeenCalled();
        expect(ports.font).not.toHaveBeenCalled(); expect(ports.ensureBundle).not.toHaveBeenCalled(); expect(ports.createApp).not.toHaveBeenCalled();
        expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function));
    });
    it.each(['main', 'onboarding', 'font', 'language'] as const)('rechecks blocked hydration after pending %s resources and cleans its exit listener', async resource => {
        ports.config.uiLanguageSetupCompleted = resource !== 'onboarding';
        const gate = deferred(), remove = vi.spyOn(window, 'removeEventListener');
        if (resource === 'main') ports.mainGate = gate.promise;
        if (resource === 'onboarding') ports.onboardingGate = gate.promise;
        if (resource === 'font') ports.font.mockReturnValueOnce(gate.promise);
        if (resource === 'language') ports.ensureBundle.mockReturnValueOnce(gate.promise);
        const pending = bootstrap.mountPreparedPopupApp('#owned');
        const outcome = expect(pending).rejects.toThrow('Popup configuration is not ready');
        const called = resource === 'main' ? ports.mainLoaded : resource === 'onboarding' ? ports.onboardingLoaded : resource === 'font' ? ports.font : ports.ensureBundle;
        await vi.waitFor(() => expect(called).toHaveBeenCalledOnce());
        ports.hydration = 'blocked'; gate.resolve(); await outcome;
        expect(ports.createApp).not.toHaveBeenCalled(); expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function));
    });
    it('routes blocked hydration through the actual startup error UI and its explicit reopen button', async () => {
        const dom = parseHTML('<html><body><div id="owned">Original startup</div></body></html>');
        vi.stubGlobal('document', dom.document);
        const reload = vi.fn(); vi.stubGlobal('location', {reload}); ports.hydration = 'blocked';
        const {mountPopupApp} = await import('../src/app/popup/index');
        await mountPopupApp('#owned');
        const root = dom.document.querySelector('#owned')!;
        expect(root.textContent).toContain('暂时无法打开流畅阅读'); expect(root.textContent).toContain('偏好会保留');
        expect(root.textContent).not.toMatch(/Popup configuration|Error|stack/);
        expect(root.querySelectorAll('button')).toHaveLength(1); expect(ports.createApp).not.toHaveBeenCalled();
        root.querySelector('button')!.dispatchEvent(new dom.window.Event('click')); expect(reload).toHaveBeenCalledOnce();
        window.dispatchEvent(new Event('pagehide'));
    });
    it('preserves the no-window lifecycle boundary while mounting a genuinely ready configuration', async () => {
        vi.stubGlobal('window', undefined);
        await bootstrap.mountPreparedPopupApp('#owned'); expect(ports.createApp).toHaveBeenCalledWith({kind: 'onboarding'});
    });
    it('prepares the selected language and font before mounting the main root', async () => {
        ports.config.uiLanguageSetupCompleted = true; const gate = deferred(); ports.ensureBundle.mockReturnValueOnce(gate.promise);
        const pending = bootstrap.mountPreparedPopupApp('#owned'); await vi.waitFor(() => expect(ports.mainLoaded).toHaveBeenCalledOnce());
        expect(ports.createApp).not.toHaveBeenCalled(); gate.resolve(); await pending;
        expect(ports.ensureBundle).toHaveBeenCalledWith('en-US'); expect(ports.createApp).toHaveBeenCalledWith({kind: 'main'});
    });
    it('uses the latest completed setup when hydration changes during module loading', async () => {
        const gate = deferred(); ports.onboardingGate = gate.promise;
        const pending = bootstrap.mountPreparedPopupApp('#owned'); await vi.waitFor(() => expect(ports.onboardingLoaded).toHaveBeenCalledOnce());
        ports.config.uiLanguageSetupCompleted = true; gate.resolve(); await pending;
        expect(ports.createApp).toHaveBeenCalledOnce(); expect(ports.createApp).toHaveBeenCalledWith({kind: 'main'});
        expect(ports.ensureBundle).toHaveBeenCalledWith('en-US');
    });
    it('uses onboarding if settings are reset while the main root is loading', async () => {
        ports.config.uiLanguageSetupCompleted = true; const gate = deferred(); ports.mainGate = gate.promise;
        const pending = bootstrap.mountPreparedPopupApp('#owned'); await vi.waitFor(() => expect(ports.mainLoaded).toHaveBeenCalledOnce());
        ports.config.uiLanguageSetupCompleted = false; gate.resolve(); await pending;
        expect(ports.createApp).toHaveBeenCalledOnce(); expect(ports.createApp).toHaveBeenCalledWith({kind: 'onboarding'});
    });
    it('checks a second setup change during the newly required import before mounting once', async () => {
        const onboarding = deferred(); const main = deferred(); ports.onboardingGate = onboarding.promise; ports.mainGate = main.promise;
        const pending = bootstrap.mountPreparedPopupApp('#owned'); await vi.waitFor(() => expect(ports.onboardingLoaded).toHaveBeenCalledOnce());
        ports.config.uiLanguageSetupCompleted = true; onboarding.resolve();
        await vi.waitFor(() => expect(ports.mainLoaded).toHaveBeenCalledOnce()); ports.config.uiLanguageSetupCompleted = false; main.resolve();
        await pending; expect(ports.createApp).toHaveBeenCalledOnce(); expect(ports.createApp).toHaveBeenCalledWith({kind: 'onboarding'});
        expect(ports.onboardingLoaded).toHaveBeenCalledOnce(); expect(ports.mainLoaded).toHaveBeenCalledOnce();
    });
    it('prepares the latest language if it changes while the root is loading', async () => {
        ports.config.uiLanguageSetupCompleted = true; const gate = deferred(); ports.mainGate = gate.promise;
        const pending = bootstrap.mountPreparedPopupApp('#owned'); await vi.waitFor(() => expect(ports.mainLoaded).toHaveBeenCalledOnce());
        ports.config.uiLanguage = 'ja-JP'; gate.resolve(); await pending;
        expect(ports.ensureBundle.mock.calls.map(([language]) => language)).toEqual(['en-US', 'ja-JP']);
        expect(ports.font).toHaveBeenCalledOnce(); expect(ports.createApp).toHaveBeenCalledOnce();
    });
    it('waits for a newly selected font without preparing the unchanged language again', async () => {
        ports.config.uiLanguageSetupCompleted = true; const root = deferred(); const font = deferred(); ports.mainGate = root.promise;
        const pending = bootstrap.mountPreparedPopupApp('#owned'); await vi.waitFor(() => expect(ports.mainLoaded).toHaveBeenCalledOnce());
        ports.config.interfaceFont = 'inter'; ports.font.mockReturnValueOnce(font.promise); root.resolve();
        await vi.waitFor(() => expect(ports.font).toHaveBeenCalledTimes(2)); expect(ports.createApp).not.toHaveBeenCalled();
        font.resolve(); await pending; expect(ports.font).toHaveBeenLastCalledWith('inter');
        expect(ports.ensureBundle).toHaveBeenCalledOnce(); expect(ports.createApp).toHaveBeenCalledOnce();
    });
    it('does not mount after its page leaves during configuration hydration', async () => {
        const target = new EventTarget(); vi.stubGlobal('window', target); const remove = vi.spyOn(target, 'removeEventListener');
        const gate = deferred(); ports.ready = gate.promise; vi.resetModules(); bootstrap = await import('../src/app/popup/mount');
        const pending = bootstrap.mountPreparedPopupApp('#owned'); target.dispatchEvent(new Event('pagehide')); gate.resolve(); await pending;
        expect(ports.createApp).not.toHaveBeenCalled(); expect(ports.font).not.toHaveBeenCalled();
        expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function));
    });
    it('does not mount after its page leaves during asset preparation', async () => {
        const target = new EventTarget(); vi.stubGlobal('window', target); const remove = vi.spyOn(target, 'removeEventListener');
        const gate = deferred(); ports.font.mockReturnValueOnce(gate.promise);
        const pending = bootstrap.mountPreparedPopupApp('#owned'); await vi.waitFor(() => expect(ports.font).toHaveBeenCalledOnce());
        target.dispatchEvent(new Event('pagehide')); ports.hydration = 'blocked'; gate.resolve(); await pending;
        expect(ports.createApp).not.toHaveBeenCalled(); expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function));
    });
    it('does not create an app when configuration hydration fails', async () => {
        ports.ready = Promise.reject(new Error('config failed')); ports.ready.catch(() => {});
        vi.resetModules(); bootstrap = await import('../src/app/popup/mount');
        await expect(bootstrap.mountPreparedPopupApp('#owned')).rejects.toThrow('config failed'); expect(ports.createApp).not.toHaveBeenCalled();
    });
    it.each(['font', 'language'])('does not mount before required %s preparation succeeds', async type => {
        ports.config.uiLanguageSetupCompleted = true;
        (type === 'font' ? ports.font : ports.ensureBundle).mockRejectedValueOnce(new Error('asset failed'));
        await expect(bootstrap.mountPreparedPopupApp('#owned')).rejects.toThrow('asset failed'); expect(ports.createApp).not.toHaveBeenCalled();
    });
    it('does not mount when its chosen root cannot be loaded', async () => {
        ports.config.uiLanguageSetupCompleted = true; ports.mainGate = Promise.reject(new Error('root import failed')); ports.mainGate.catch(() => {});
        await expect(bootstrap.mountPreparedPopupApp('#owned')).rejects.toMatchObject({cause: {message: 'root import failed'}}); expect(ports.createApp).not.toHaveBeenCalled();
    });
    it('ignores unsuccessful startup hints and still mounts from actual configuration', async () => {
        vi.stubGlobal('__fluentReadPopupWarmup', Promise.resolve({success: false, uiLanguageSetupCompleted: true}));
        const {mountPopupApp} = await import('../src/app/popup/index'); await mountPopupApp('#owned');
        expect(ports.createApp).toHaveBeenCalledWith({kind: 'onboarding'}); expect(ports.mainLoaded).not.toHaveBeenCalled();
    });
    it('consumes a failed startup Promise without preventing the actual root mount', async () => {
        vi.stubGlobal('browser', {runtime: {sendMessage: () => Promise.reject(new Error('startup failed'))}});
        const {mountPopupApp} = await import('../src/app/popup/index'); await mountPopupApp('#owned');
        expect(ports.createApp).toHaveBeenCalledWith({kind: 'onboarding'});
    });
    it('accepts the successful Chrome callback hint without using it as the mounting configuration', async () => {
        vi.stubGlobal('browser', undefined);
        const sendMessage = vi.fn((_message: unknown, callback: (value: unknown) => void) => callback({success: true, uiLanguageSetupCompleted: true}));
        vi.stubGlobal('chrome', {runtime: {sendMessage}});
        const {mountPopupApp} = await import('../src/app/popup/index'); await mountPopupApp('#owned'); await vi.dynamicImportSettled();
        expect(sendMessage).toHaveBeenCalledOnce(); expect(ports.mainLoaded).toHaveBeenCalledOnce();
        expect(ports.createApp).toHaveBeenCalledWith({kind: 'onboarding'});
    });
});


describe('Popup fixed tab host lifecycle', () => {
    const attribute='data-fluentread-tab-popup';
    function tabReply() {
        let resolve!:(value:{id:number})=>void;
        const promise=new Promise<{id:number}>(yes=>{resolve=yes;});
        return {promise,resolve};
    }
    it.each([
        ['chrome',0,false],['edge',42,true],['firefox',Number.MAX_SAFE_INTEGER,false],['safari',17,true],['thunderbird',1,false],
    ] as const)('%s 真实标签页 id=%s 对完成状态=%s 启用自有固定视口且卸载释放',async(browser,id,completed)=>{
        ports.browser=browser;ports.config.uiLanguageSetupCompleted=completed;ports.currentTab.mockResolvedValue({id});
        await bootstrap.mountPreparedPopupApp('#owned');
        expect(ports.currentTab).toHaveBeenCalledOnce();expect(ports.currentTab).toHaveBeenCalledWith();
        expect(document.documentElement.getAttribute(attribute)).toBe('');
        expect(ports.createApp).toHaveBeenCalledWith({kind:completed?'main':'onboarding'});
        ports.unmountCallbacks.forEach(fn=>fn());expect(document.documentElement.hasAttribute(attribute)).toBe(false);
    });
    it.each([
        ['toolbar',undefined],['null-tab',null],['missing-id',{}],['string-id',{id:'7'}],['negative-id',{id:-1}],
        ['fraction-id',{id:.5}],['NaN-id',{id:NaN}],['infinite-id',{id:Infinity}],['unsafe-integer-id',{id:Number.MAX_SAFE_INTEGER+1}],
    ])('%s 的公开查询结果不把工具栏或非法身份转成标签页布局',async(_reason,tab)=>{
        ports.currentTab.mockResolvedValue(tab);await bootstrap.mountPreparedPopupApp('#owned');
        expect(ports.mount).toHaveBeenCalledOnce();expect(ports.currentTab).toHaveBeenCalledOnce();
        expect(document.documentElement.hasAttribute(attribute)).toBe(false);
        pageTransition('pagehide',true);pageTransition('pageshow',true);
        expect(document.documentElement.hasAttribute(attribute)).toBe(false);expect(ports.currentTab).toHaveBeenCalledOnce();
    });
    it.each(['missing-tabs','missing-method','throws','rejects'] as const)('%s 的标签页 API 保留固有布局且不阻塞挂载或重试',async reason=>{
        if(reason==='missing-tabs'||reason==='missing-method')ports.tabApi=reason;
        if(reason==='throws')ports.currentTab.mockImplementation(()=>{throw Error('tab query unavailable');});
        if(reason==='rejects')ports.currentTab.mockRejectedValue(Error('tab query unavailable'));
        await bootstrap.mountPreparedPopupApp('#owned');
        expect(ports.mount).toHaveBeenCalledOnce();expect(document.documentElement.hasAttribute(attribute)).toBe(false);
        pageTransition('pagehide',true);pageTransition('pageshow',true);
        expect(document.documentElement.hasAttribute(attribute)).toBe(false);
        expect(ports.currentTab).toHaveBeenCalledTimes(reason.startsWith('missing')?0:1);
    });
    it('pending 标签页查询不阻挂载；隐藏时晚回仅缓存，两次恢复不重查或重建应用',async()=>{
        ports.config.uiLanguageSetupCompleted=true;const reply=tabReply();ports.currentTab.mockReturnValue(reply.promise);
        const add=vi.spyOn(window,'addEventListener'),remove=vi.spyOn(window,'removeEventListener');
        await bootstrap.mountPreparedPopupApp('#owned');
        expect(ports.mount).toHaveBeenCalledOnce();expect(document.documentElement.hasAttribute(attribute)).toBe(false);
        pageTransition('pagehide',true);reply.resolve({id:0});await reply.promise;
        expect(document.documentElement.hasAttribute(attribute)).toBe(false);expect(remove).not.toHaveBeenCalled();
        pageTransition('pageshow',false);expect(document.documentElement.hasAttribute(attribute)).toBe(false);
        pageTransition('pageshow',true);expect(document.documentElement.getAttribute(attribute)).toBe('');
        pageTransition('pagehide',true);expect(document.documentElement.hasAttribute(attribute)).toBe(false);
        pageTransition('pageshow',true);expect(document.documentElement.getAttribute(attribute)).toBe('');
        expect(ports.currentTab).toHaveBeenCalledOnce();expect(ports.createApp).toHaveBeenCalledOnce();expect(ports.mount).toHaveBeenCalledOnce();
        expect(ports.mainLoaded).toHaveBeenCalledOnce();expect(ports.ensureBundle).toHaveBeenCalledOnce();expect(ports.font).toHaveBeenCalledOnce();
        expect(add.mock.calls.map(([type])=>type)).toEqual(['pagehide','pageshow']);
        ports.unmountCallbacks.forEach(fn=>fn());expect(document.documentElement.hasAttribute(attribute)).toBe(false);
        expect(remove.mock.calls.map(([type])=>type)).toEqual(['pagehide','pageshow']);
    });
    it.each(['pagehide','unmount','hidden-unmount','mount-failure','config-failure','hydration-blocked'] as const)('%s 后迟到标签页回复和旧 pageshow 不能写回标记',async reason=>{
        const reply=tabReply();ports.currentTab.mockReturnValue(reply.promise);
        if(reason==='mount-failure')ports.mount.mockImplementation(()=>{throw Error('mount failed');});
        if(reason==='config-failure'){ports.ready=Promise.reject(Error('config failed'));ports.ready.catch(()=>{});vi.resetModules();bootstrap=await import('../src/app/popup/mount');}
        if(reason==='hydration-blocked')ports.hydration='blocked';
        const pending=bootstrap.mountPreparedPopupApp('#owned');
        if(reason.endsWith('failure')||reason==='hydration-blocked')await expect(pending).rejects.toThrow();else await pending;
        if(reason==='pagehide')pageTransition('pagehide',false);
        if(reason==='hidden-unmount')pageTransition('pagehide',true);
        if(reason==='unmount'||reason==='hidden-unmount')ports.unmountCallbacks.forEach(fn=>fn());
        reply.resolve({id:9});await reply.promise;pageTransition('pageshow',true);
        expect(ports.currentTab).toHaveBeenCalledOnce();expect(document.documentElement.hasAttribute(attribute)).toBe(false);
    });
    it('挂载前 persisted hide 终止入口，随后配置与标签页回复不能补挂载或恢复标记',async()=>{
        const configGate=deferred(),reply=tabReply();ports.ready=configGate.promise;ports.currentTab.mockReturnValue(reply.promise);
        vi.resetModules();bootstrap=await import('../src/app/popup/mount');
        const pending=bootstrap.mountPreparedPopupApp('#owned');pageTransition('pagehide',true);
        reply.resolve({id:0});await reply.promise;pageTransition('pageshow',true);configGate.resolve();await pending;
        expect(ports.createApp).not.toHaveBeenCalled();expect(document.documentElement.hasAttribute(attribute)).toBe(false);
        expect(ports.currentTab).toHaveBeenCalledOnce();
    });
    it.each(['','external-owner'])('预存标签页标记 %s 的所有权在恢复与卸载后仍属于原宿主',async value=>{
        document.documentElement.setAttribute(attribute,value);ports.currentTab.mockResolvedValue({id:7});
        await bootstrap.mountPreparedPopupApp('#owned');pageTransition('pagehide',true);pageTransition('pageshow',true);
        ports.unmountCallbacks.forEach(fn=>fn());expect(document.documentElement.getAttribute(attribute)).toBe(value);
        expect(ports.currentTab).toHaveBeenCalledOnce();
    });
    it('其它宿主可接管自有标签页标记；移除后下一恢复重新取得且不碰其它布局标记',async()=>{
        const root=document.documentElement;ports.currentTab.mockResolvedValue({id:12});
        root.setAttribute('data-fluentread-android-popup','android-owner');root.setAttribute('data-fluentread-safari-touch-popup','safari-owner');
        await bootstrap.mountPreparedPopupApp('#owned');expect(root.getAttribute(attribute)).toBe('');
        root.setAttribute(attribute,'external-visible-owner');pageTransition('pagehide',true);pageTransition('pageshow',true);
        expect(root.getAttribute(attribute)).toBe('external-visible-owner');
        root.removeAttribute(attribute);pageTransition('pagehide',true);pageTransition('pageshow',true);
        expect(root.getAttribute(attribute)).toBe('');
        pageTransition('pagehide',true);root.setAttribute(attribute,'external-hidden-owner');pageTransition('pageshow',true);
        ports.unmountCallbacks.forEach(fn=>fn());expect(root.getAttribute(attribute)).toBe('external-hidden-owner');
        expect(root.getAttribute('data-fluentread-android-popup')).toBe('android-owner');expect(root.getAttribute('data-fluentread-safari-touch-popup')).toBe('safari-owner');
        expect(ports.currentTab).toHaveBeenCalledOnce();expect(ports.mount).toHaveBeenCalledOnce();
    });
    it('无 Window 的未知工具栏宿主仍可挂载并通过 app 生命周期端口释放',async()=>{
        vi.stubGlobal('window',undefined);await bootstrap.mountPreparedPopupApp('#owned');
        expect(ports.currentTab).toHaveBeenCalledOnce();expect(ports.mount).toHaveBeenCalledWith('#owned');
        expect(document.documentElement.hasAttribute(attribute)).toBe(false);
        ports.unmountCallbacks.forEach(fn=>fn());expect(document.documentElement.hasAttribute(attribute)).toBe(false);
    });
});

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const ports = vi.hoisted(() => ({
    config: {uiLanguageSetupCompleted: false, uiLanguage: 'en-US', interfaceFont: 'system'},
    ready: Promise.resolve() as Promise<void>,
    mainGate: undefined as Promise<void> | undefined, onboardingGate: undefined as Promise<void> | undefined,
    mainLoaded: vi.fn(), onboardingLoaded: vi.fn(), ensureBundle: vi.fn(async (_language: unknown) => {}), font: vi.fn(async (_font: unknown) => {}),
    createApp: vi.fn(), plugin: vi.fn(() => ({kind: 'i18n'})), use: vi.fn(), component: vi.fn(), mount: vi.fn(),
}));
vi.mock('vue', () => ({createApp: ports.createApp}));
vi.mock('element-plus/es/components/base/style/css', () => ({}));
vi.mock('@element-plus/icons-vue', () => ({Coffee: {kind: 'coffee'}}));
vi.mock('../src/services/config/store', () => ({config: ports.config, get configReady() {return ports.ready;}}));
vi.mock('../src/ui/i18n', () => ({createUiI18nPlugin: ports.plugin}));
vi.mock('../src/platform/i18n/uiLanguageBundles', () => ({ensureUiLanguageBundle: ports.ensureBundle}));
vi.mock('../src/ui/interfaceAppearance', () => ({prepareInterfaceFont: ports.font}));
function deferred() {let resolve!: () => void; const promise = new Promise<void>(yes => {resolve = yes;}); return {promise, resolve};}
type Bootstrap = typeof import('../src/app/popup/mount');
let bootstrap: Bootstrap;
beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks(); ports.ready = Promise.resolve(); ports.mainGate = undefined; ports.onboardingGate = undefined;
    Object.assign(ports.config, {uiLanguageSetupCompleted: false, uiLanguage: 'en-US', interfaceFont: 'system'});
    ports.font.mockReset().mockResolvedValue(undefined); ports.ensureBundle.mockReset().mockResolvedValue(undefined);
    ports.createApp.mockReturnValue({use: ports.use, component: ports.component, mount: ports.mount});
    vi.stubGlobal('navigator', {language: 'zh-CN'});
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', {body: {kind: 'owned-popup'}});
    vi.doMock('../src/app/popup/PopupApp.vue', async () => {ports.mainLoaded(); await ports.mainGate; return {default: {kind: 'main'}};});
    vi.doMock('../src/app/popup/PopupOnboarding.vue', async () => {ports.onboardingLoaded(); await ports.onboardingGate; return {default: {kind: 'onboarding'}};});
    bootstrap = await import('../src/app/popup/mount');
});
afterEach(() => vi.unstubAllGlobals());

describe('Popup fresh configuration bootstrap', () => {
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
        target.dispatchEvent(new Event('pagehide')); gate.resolve(); await pending;
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

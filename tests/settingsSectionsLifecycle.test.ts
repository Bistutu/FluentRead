import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type Plugin, type ViteDevServer} from 'vite';
import {afterEach, describe, expect, it, vi} from 'vitest';

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
const key = '__frSettingsSectionsLifecycle';
let server: ViteDevServer | undefined, app: import('vue').App | undefined;
afterEach(async () => {app?.unmount(); app = undefined; await server?.close();server = undefined;
    delete (globalThis as Record<string, unknown>)[key];vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

function deferred<T>() {let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes;reject = no;});return {promise, resolve, reject};}
async function settle() {await runtime.nextTick();for (let i = 0; i < 8; i++) await Promise.resolve();await runtime.nextTick();}
function compileClientTemplate(component: any, relative: string) {
    const filename = resolve(process.cwd(), relative);
    const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
    const bindings = compileScript(descriptor, {id: 'sections-lifecycle-template'}).bindings;
    const compiled = compileTemplate({source: descriptor.template!.content, filename, id: 'sections-lifecycle-template',
        compilerOptions: {mode: 'function', cacheHandlers: true, bindingMetadata: bindings, expressionPlugins: ['typescript']}});
    expect(compiled.errors).toEqual([]);
    component.ssrRender = undefined;
    component.render = new Function('Vue', ts.transpileModule(compiled.code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText)(runtime);
}

// 实际父/子 SFC 模板使用 LinkeDOM 节点和事件；Element Plus 弹窗动画、浏览器焦点由根任务真实浏览器复验。
function createDomRenderer(document: Document, focus: ReturnType<typeof vi.fn>) {
    return runtime.createRenderer({patchProp(element: any, name: string, previous: any, next: any) {
        if (name === 'class') {element.className = String(next ?? '');return;}
        if (name === 'value') {element.value = next ?? '';return;}
        if (name === 'style') {Object.assign(element.style, next ?? {});return;}
        if (/^on[A-Z]/u.test(name)) {
            const event = name.slice(2).toLowerCase();
            if (previous) element.removeEventListener(event, previous);
            if (next) element.addEventListener(event, next);
        } else if (next === undefined || next === null || next === false) element.removeAttribute(name);
        else element.setAttribute(name, String(next));
    }, insert: (child: any, parent: any, anchor: any = null) => parent.insertBefore(child, anchor),
    remove: (node: any) => node.parentNode?.removeChild(node), createElement: (name: string) => {
        const node = document.createElement(name);if (name === 'input') node.focus = focus;return node;
    }, createText: (value: string) => document.createTextNode(value), createComment: (value: string) => document.createComment(value),
    setText: (node: any, value: string) => {node.nodeValue = value;}, setElementText: (node: any, value: string) => {node.textContent = value;},
    parentNode: (node: any) => node.parentNode, nextSibling: (node: any) => node.nextSibling,
    querySelector: (value: string) => document.querySelector(value), setScopeId: () => {}, cloneNode: (node: any) => node.cloneNode(true),
    insertStaticContent: (content: string, parent: any, anchor: any) => {
        const template = document.createElement('template');template.innerHTML = content;
        const first = template.content.firstChild, last = template.content.lastChild;
        parent.insertBefore(template.content, anchor);return [first, last];
    }});
}

async function mountSections({ready = Promise.resolve(), configSnapshot, template = false, providerGate = Promise.resolve(), activeSection = 'settings-translation'}:
    {ready?: Promise<void>; configSnapshot?: Record<string, unknown>; template?: boolean; providerGate?: Promise<void>; activeSection?: string} = {}) {
    const frames = new Map<number, FrameRequestCallback>();let nextFrame = 0;
    const query = vi.fn((_options: Record<string, unknown>) => Promise.resolve([] as {id?: number}[]));
    const send = vi.fn((_id: number, _message: {type: string; isEnabled?: boolean; mode?: string}) => Promise.resolve());
    const patch = vi.fn(() => Promise.resolve());const theme = vi.fn();const unsubscribe = vi.fn();
    const media = {matches: false, onchange: null as (() => void) | null};
    const location = {hash: '', search: '', protocol: 'chrome-extension:'};
    vi.stubGlobal('window', Object.assign(new EventTarget(), {location, navigator: {userAgent: ''}, matchMedia: () => media,
        requestAnimationFrame: (fn: FrameRequestCallback) => {frames.set(++nextFrame, fn);return nextFrame;},
        cancelAnimationFrame: (id: number) => frames.delete(id)}));
    const findTarget = vi.fn(() => null as HTMLElement | null);
    const dom = template ? parseHTML('<html><body><main id="fixture"></main></body></html>') : undefined;
    vi.stubGlobal('document', dom?.document ?? {querySelector: findTarget});
    if (dom) vi.stubGlobal('HTMLInputElement', dom.window.HTMLInputElement);
    const focus = vi.fn(), providerMounted = vi.fn(), providerUnmounted = vi.fn();
    let providerState: Record<string, any> | undefined;
    const providerReady = deferred<void>();
    const loadProvider = vi.fn(async () => {
        await providerGate;
        const component = (await server!.ssrLoadModule('/src/features/settings/ui/services/CustomOpenAIProviderDialog.vue')).default;
        compileClientTemplate(component, 'src/features/settings/ui/services/CustomOpenAIProviderDialog.vue');
        providerReady.resolve();return component;
    });
    let notifyConfig: (value: unknown) => void = () => {};
    const data = {loadProvider, config: configSnapshot ?? {}, configReady: ready,
        subscribeConfig: (listener: (value: unknown) => void) => {
            notifyConfig = listener;
            if (configSnapshot) listener(configSnapshot);
            return unsubscribe;
        },
        requestConfigPatch: patch,
        handoffPendingConfigPatches: vi.fn(() => Promise.resolve()), theme,
        browser: {runtime: {sendMessage: vi.fn(() => Promise.resolve())}, tabs: {query, sendMessage: send}}};
    (globalThis as Record<string, unknown>)[key] = data;
    const mocks: Plugin = {name: 'settings-sections-lifecycle-mocks', enforce: 'pre', resolveId(id, importer) {
        if (template && id.endsWith('/CustomOpenAIProviderDialog.vue')) {
            // 只替换父模板的动态模块加载端口；真正的子组件在首次请求后由 Vite 编译，测试不重写其 watch/草稿行为。
            if (importer?.includes('SettingsSections.vue')) return '\0sections-provider-loader';
            return null;
        }
        if (template && id.endsWith('/SettingsPanel.vue')) return '\0sections-panel';
        if (template && id.endsWith('/ServiceCatalog.vue')) return '\0sections-service-catalog';
        if (id.endsWith('.vue') && !id.endsWith('/SettingsSections.vue')) return '\0sections-child';
        if (id.endsWith('/src/ui/i18n')) return '\0sections-i18n';
        if (id.endsWith('/src/services/config/store')) return '\0sections-config';
        if (id.endsWith('/src/ui/interfaceAppearance')) return '\0sections-appearance';
        if (id === 'webextension-polyfill') return '\0sections-browser';
        if (id === 'element-plus') return '\0sections-element';
        if (id === '@element-plus/icons-vue') return '\0sections-icons';
        if (id.endsWith('/src/platform/browser/capabilities')) return '\0sections-capabilities';return null;
    }, load(id) {
        if (id === '\0sections-panel') return `import {h} from 'vue';export default {setup(_, {slots}) {return () => h('div', null, slots.default?.());}};`;
        if (id === '\0sections-provider-loader') return `export default await globalThis.${key}.loadProvider();`;
        if (id === '\0sections-service-catalog') return `import {h} from 'vue';export default {props: ['active'], emits: ['add:service'], setup(props, {emit}) {return () => props.active ? h('button', {'data-testid': 'fixture-add-service', onClick: () => emit('add:service')}, '添加服务') : null}};`;
        if (id === '\0sections-child') return 'export default {render: () => null};';
        if (id === '\0sections-i18n') return `import {ref} from 'vue';export const useUiI18n = () => ({language: ref('zh-CN'), t: k => k, translateLegacy: t => t}); export const localizeServiceOptions = options => options;`;
        if (id === '\0sections-config') return `export const {config, configReady, subscribeConfig, requestConfigPatch, handoffPendingConfigPatches} = globalThis.${key};`;
        if (id === '\0sections-appearance') return `export const applyInterfaceTheme = globalThis.${key}.theme;`;
        if (id === '\0sections-browser') return `export default globalThis.${key}.browser;`;
        if (id === '\0sections-element') return 'export const ElMessage = Object.assign(() => {}, {warning: () => {}});';
        if (id === '\0sections-icons') return 'export const ArrowRight = {};export const InfoFilled = {};export const Edit = {};';
        if (id === '\0sections-capabilities') return "export const browserCapabilities = {browser: 'chrome'};";return null;
    }};
    server = await createServer({configFile: false, appType: 'custom', logLevel: 'silent', root: process.cwd(),
        plugins: [mocks, vue()], resolve: {alias: {'@': resolve(process.cwd())}},
        ssr: {noExternal: ['element-plus', '@element-plus/icons-vue', 'webextension-polyfill']},server: {hmr: false, middlewareMode: true}});
    const component = (await server.ssrLoadModule('/src/features/settings/ui/SettingsSections.vue')).default;
    component.ssrRender = undefined;component.render = () => null;
    if (template) compileClientTemplate(component, 'src/features/settings/ui/SettingsSections.vue');
    const renderer = dom ? createDomRenderer(dom.document as unknown as Document, focus) : runtime.createRenderer<Record<string, never>, Record<string, unknown>>({patchProp: () => {}, insert: () => {},
        remove: () => {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText: () => {},
        setElementText: () => {}, parentNode: () => null, nextSibling: () => null, querySelector: () => null,
        setScopeId: () => {}, cloneNode: () => ({}), insertStaticContent: () => [{}, {}]});
    const visible = runtime.ref(true);const props = runtime.reactive({activeSection, onNavigateSection: undefined as undefined | ((section: string, target?: string) => void)});
    let state!: Record<string, any>;
    app = renderer.createApp({setup: () => () => runtime.h(runtime.KeepAlive, null, {default: () => visible.value
        ? runtime.h(component, {...props, ref: (vm: any) => {if (vm) state = vm.$.setupState;}})
        : runtime.h({render: () => null}, {key: 'other'})})});
    let dialogPort: Record<string, any> | undefined;
    if (template) {
        app.mixin({mounted() {
            if (this.$options.__name === 'CustomOpenAIProviderDialog') {providerState = (this as any).$.setupState;providerMounted();}
        }, unmounted() {if (this.$options.__name === 'CustomOpenAIProviderDialog') providerUnmounted();}});
        app.component('el-dialog', runtime.defineComponent({props: ['modelValue'], setup(props, {attrs, slots}) {
            return () => {dialogPort = {open: props.modelValue, opened: attrs.onOpened};
                return runtime.h('div', {...attrs, 'data-fixture-open': String(props.modelValue)}, slots.default?.());};
        }}));
    }
    app.provide(runtime.ssrContextKey, {modules: new Set<string>()});app.config.warnHandler = () => {};
    app.mount(dom ? dom.document.querySelector('#fixture')! : {});await settle();
    if (template) {await new Promise(resolve => setTimeout(resolve, 60));await settle();}
    return {state, props, visible, document: dom?.document, domWindow: dom?.window, loadProvider, focus, providerMounted, providerUnmounted,
        get providerState() {return providerState;}, get dialogPort() {return dialogPort;},
        async finishProviderLoad() {await providerReady.promise;await new Promise(resolve => setTimeout(resolve, 0));await settle();}, query, send, patch, theme, unsubscribe, frames, findTarget, location, data,
        notifyConfig: (value: unknown) => notifyConfig(value)};
}

describe('设置主表单实际组件异步归属', () => {
    it('离开服务设置关闭新服务对话框，隐藏时既不打开也不提交新服务', async () => {
        const {state, props} = await mountSections();state.openCustomProviderDialog();expect(state.customProviderDialogOpen).toBe(false);
        props.activeSection = 'settings-services';await settle();state.openCustomProviderDialog();expect(state.customProviderDialogOpen).toBe(true);
        props.activeSection = 'settings-translation';await settle();expect(state.customProviderDialogOpen).toBe(false);
        const before = JSON.stringify(state.config);state.createCustomProvider({name: 'stale', endpoint: 'https://fixture.example/v1', apiKey: '', model: 'fixture'});
        expect(JSON.stringify(state.config)).toBe(before);
    });
    it('缓存离开时关闭全文与悬浮录制，恢复暂选模式，返回后仍可录制', async () => {
        const {state, visible} = await mountSections();vi.useFakeTimers();
        state.config.floatingBallHotkey = 'Shift+Q';state.handleHotkeyChange('custom');
        vi.advanceTimersByTime(100);expect(state.showCustomHotkeyDialog).toBe(true);
        visible.value = false;await settle();
        expect(state.showCustomHotkeyDialog).toBe(false);expect(state.config.floatingBallHotkey).toBe('Shift+Q');
        state.handleCustomHotkeyConfirm('Alt+K');state.openCustomMouseHotkeyDialog();
        expect(state.config.customFloatingBallHotkey).toBe('');expect(state.showCustomMouseHotkeyDialog).toBe(false);
        visible.value = true;await settle();state.openCustomMouseHotkeyDialog();expect(state.showCustomMouseHotkeyDialog).toBe(true);
    });
    it('根组件导航时只委托定位，不再创建另一条逐帧查找链', async () => {
        const {state, props, frames} = await mountSections();const navigate = vi.fn();props.onNavigateSection = navigate;await settle();
        state.openSettingsSection('settings-interface', 'translation-sentence-highlight-style');
        expect(navigate).toHaveBeenCalledWith('settings-interface', 'translation-sentence-highlight-style');expect(frames.size).toBe(0);
    });
    it('独立定位最新操作取代旧操作，离开或卸载后旧帧不能滚动', async () => {
        const {state, frames, findTarget, visible} = await mountSections();const scroll = vi.fn();
        state.openSettingsSection('settings-sites', 'first');const stale = [...frames.values()][0];
        state.openSettingsSection('settings-services', 'second');expect(frames.size).toBe(1);
        findTarget.mockReturnValue({scrollIntoView: scroll} as unknown as HTMLElement);stale(0);expect(scroll).not.toHaveBeenCalled();
        visible.value = false;await settle();expect(frames.size).toBe(0);stale(0);expect(scroll).not.toHaveBeenCalled();
        visible.value = true;await settle();state.openSettingsSection('settings-sites', 'third');
        const late = [...frames.values()][0];app?.unmount();app = undefined;late(0);expect(scroll).not.toHaveBeenCalled();
    });
    it('卸载后到达的配置水合不改主题或提交旧配置', async () => {
        const ready = deferred<void>();const {theme, patch, unsubscribe} = await mountSections({ready: ready.promise});
        app?.unmount();app = undefined;ready.resolve();await settle();
        expect(theme).not.toHaveBeenCalled();expect(patch).not.toHaveBeenCalled();expect(unsubscribe).toHaveBeenCalledOnce();
    });
    it('同步订阅与后续批量水合只扫描完整草稿两次，随后编辑仍同步保存', async () => {
        const {state, patch, notifyConfig} = await mountSections({configSnapshot: {to: 'en', theme: 'dark'}});
        expect(state.config.to).toBe('en');expect(state.config.theme).toBe('dark');expect(patch).not.toHaveBeenCalled();
        const stringify = JSON.stringify;
        let draftScans = 0;
        vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
            if (value === state.config) draftScans++;
            return stringify(value, replacer, space);
        });
        notifyConfig({...state.config, to: 'ja', theme: 'light', hotkey: 'Shift', customHotkey: 'Alt+J'});
        expect(draftScans).toBe(2);
        expect(patch).not.toHaveBeenCalled();expect(state.config.to).toBe('ja');
        state.config.to = 'fr';
        expect(patch).toHaveBeenCalledOnce();expect(patch).toHaveBeenCalledWith(expect.objectContaining({to: 'fr'}), expect.any(Function));
        state.config.harness.enabled = true;
        expect(patch).toHaveBeenCalledTimes(2);
        expect(patch).toHaveBeenLastCalledWith(expect.objectContaining({harness: expect.objectContaining({enabled: true})}), expect.any(Function));
    });
    it('水合结束后立即关闭捕获最新编辑，后续编辑仍允许另一轮关闭交接', async () => {
        const {state, patch, data, notifyConfig} = await mountSections({configSnapshot: {to: 'en'}});
        notifyConfig({...state.config, to: 'ja'});expect(patch).not.toHaveBeenCalled();
        state.config.to = 'fr';expect(patch).toHaveBeenCalledOnce();
        window.dispatchEvent(new Event('beforeunload'));
        expect(patch).toHaveBeenLastCalledWith(expect.objectContaining({to: 'fr'}), expect.any(Function));
        expect(data.handoffPendingConfigPatches).toHaveBeenCalledOnce();
        window.dispatchEvent(new Event('pagehide'));expect(data.handoffPendingConfigPatches).toHaveBeenCalledOnce();
        state.config.to = 'de';window.dispatchEvent(new Event('beforeunload'));
        expect(data.handoffPendingConfigPatches).toHaveBeenCalledTimes(2);
        expect(patch).toHaveBeenLastCalledWith(expect.objectContaining({to: 'de'}), expect.any(Function));
    });
    it('配置就绪失败仍禁止自动保存和关闭交接，卸载后的订阅通知不能改旧草稿', async () => {
        const ready = deferred<void>();const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const {state, patch, data, notifyConfig} = await mountSections({ready: ready.promise, configSnapshot: {to: 'en'}});
        state.config.to = 'ja';window.dispatchEvent(new Event('beforeunload'));
        expect(patch).not.toHaveBeenCalled();expect(data.handoffPendingConfigPatches).not.toHaveBeenCalled();
        ready.reject(new Error('fixture hydration failed'));await settle();
        expect(warning).toHaveBeenCalledWith('[FluentRead] 无法读取本地配置', expect.any(Error));
        app?.unmount();app = undefined;notifyConfig({to: 'de'});
        expect(state.config.to).toBe('ja');expect(patch).not.toHaveBeenCalled();expect(data.handoffPendingConfigPatches).not.toHaveBeenCalled();
    });
    it.each(['normalize', 'serialize'])('批量水合的 %s 失败后释放暂停与水合 guard，下一次编辑仍同步保存', async failure => {
        const {state, patch, notifyConfig} = await mountSections({configSnapshot: {to: 'en'}});
        const error = new Error('fixture draft hydration failure');
        if (failure === 'normalize') {
            const invalid = Object.defineProperty({}, 'to', {enumerable: true, get: () => {throw error;}});
            expect(() => state.hydrateConfigDraft(invalid)).toThrow(error);
            expect(state.config.to).toBe('en');
        } else {
            const stringify = JSON.stringify;let rejectDraft = true;
            vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
                if (value === state.config && rejectDraft) {rejectDraft = false;throw error;}
                return stringify(value, replacer, space);
            });
            expect(() => notifyConfig({...state.config, to: 'ja'})).toThrow(error);
            expect(state.config.to).toBe('ja');
        }
        expect(patch).not.toHaveBeenCalled();
        state.config.to = 'fr';expect(patch).toHaveBeenCalledOnce();
        expect(patch).toHaveBeenLastCalledWith(expect.objectContaining({to: 'fr'}), expect.any(Function));
        state.config.harness.enabled = true;expect(patch).toHaveBeenCalledTimes(2);
    });
    it('快速设置更新共用一次标签页查询，发送最新状态，过滤非法 ID', async () => {
        const {state, query, send} = await mountSections();const tabs = deferred<{id?: number}[]>();query.mockReturnValueOnce(tabs.promise);
        for (let i = 0; i < 100; i++) state.floatingBallEnabled = i % 2 === 0;
        state.imageTranslationEnabled = true;state.config.on = false;state.handlePluginStateChange(false);await settle();
        expect(query).toHaveBeenCalledOnce();tabs.resolve([{id: 0}, {id: -1}, {}, {id: 3}]);await settle();
        expect(send.mock.calls.filter(([id]) => id === 0)).toHaveLength(4);
        expect(send.mock.calls.filter(([id]) => id === 3)).toHaveLength(4);
        expect(send.mock.calls.filter(([id]) => id !== 0 && id !== 3)).toHaveLength(0);
        expect(send.mock.calls.filter(([,message]) => message.type === 'toggleFloatingBall').every(([,message]) => message.isEnabled === false)).toBe(true);
        expect(send.mock.calls.filter(([,message]) => message.type === 'updateSelectionTranslatorMode').every(([,message]) => message.mode === 'disabled')).toBe(true);
    });
    it('拒绝查询后释放任务，随后仍能广播；卸载后的结果不继续发消息', async () => {
        const {state, query, send} = await mountSections();query.mockRejectedValueOnce(new Error('tabs unavailable'));
        state.floatingBallEnabled = true;await settle();expect(send).not.toHaveBeenCalled();
        query.mockResolvedValueOnce([{id: 1}]);state.floatingBallEnabled = false;await settle();expect(send).toHaveBeenCalledOnce();
        const tabs = deferred<{id?: number}[]>();query.mockReturnValueOnce(tabs.promise);state.imageTranslationEnabled = true;await settle();
        app?.unmount();app = undefined;tabs.resolve([{id: 1}]);await settle();expect(send).toHaveBeenCalledOnce();
    });
    it('服务列表直接复用已筛选能力结果，切换显示模式不会再分配同样的列表', async () => {
        const {state} = await mountSections();const first = state.configurationCompute.filteredServices;
        expect(first).toBe(state.availableServiceOptions);state.config.display = 2;await settle();
        expect(state.configurationCompute.filteredServices).toBe(first);
    });
    it('查询完成时采用外部最新模式和进度偏好，单个标签页同步异常不阻止其余消息', async () => {
        const {state, query, send} = await mountSections();const tabs = deferred<{id?: number}[]>();query.mockReturnValueOnce(tabs.promise);
        state.selectionAreaTranslationEnabled = true;state.config.translationProgressPanelEnabled = false;state.handleTranslationProgressPanelChange(false);
        state.config.selectionTranslatorMode = 'bilingual';await settle();
        state.config.selectionTranslatorMode = 'translation-only';state.config.translationProgressPanelEnabled = true;await settle();
        send.mockImplementationOnce(() => {throw new Error('closed tab');});send.mockRejectedValueOnce(new Error('missing content script'));
        tabs.resolve([{id: 1}, {id: 2}]);await settle();expect(query).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledTimes(6);
        expect(send).toHaveBeenCalledWith(2, {type: 'toggleTranslationProgressPanel', isEnabled: true});
        expect(send).toHaveBeenCalledWith(2, {type: 'updateSelectionTranslatorMode', mode: 'translation-only'});
    });
    it('已缓存或卸载时到达的规则检查不会继续导航或打开自定义服务', async () => {
        const {state, visible, props} = await mountSections();const navigate = vi.fn();props.onNavigateSection = navigate;await settle();
        const inspect = state.inspectSiteRule('stale');visible.value = false;await settle();await inspect;
        expect(navigate).not.toHaveBeenCalled();state.openCustomProviderDialog();expect(state.customProviderDialogOpen).toBe(false);
        visible.value = true;await settle();const late = state.inspectSiteRule('closed');app?.unmount();app = undefined;await late;
        expect(navigate).not.toHaveBeenCalled();
    });
});

function addProviderFromTemplate(fixture: Awaited<ReturnType<typeof mountSections>>) {
    const button = fixture.document!.querySelector('[data-testid="fixture-add-service"]')!;
    expect(button).not.toBeNull();button.dispatchEvent(new fixture.domWindow!.Event('click', {bubbles: true}));
}
function inputProvider(fixture: Awaited<ReturnType<typeof mountSections>>, field: string, value: string) {
    const input = fixture.document!.querySelector(`[data-testid="custom-service-${field}"]`)! as unknown as HTMLInputElement;
    input.value = value;input.dispatchEvent(new fixture.domWindow!.Event('input', {bubbles: true}));
}
function submitProviderFromTemplate(fixture: Awaited<ReturnType<typeof mountSections>>) {
    fixture.document!.querySelector('form.custom-provider-form')!.dispatchEvent(new fixture.domWindow!.Event('submit', {bubbles: true, cancelable: true}));
}

describe('新服务对话框实际模板首次挂载与后续实例归属', () => {
    it('通用设置和仅访问服务目录均不调用加载器，首次添加才加载一次', async () => {
        const fixture = await mountSections({template: true, activeSection: 'settings-general'});
        expect(fixture.loadProvider).not.toHaveBeenCalled();expect(fixture.providerMounted).not.toHaveBeenCalled();
        expect(fixture.document!.querySelector('[data-testid="custom-service-dialog"]')).toBeNull();
        fixture.state.openCustomProviderDialog();await settle();expect(fixture.loadProvider).not.toHaveBeenCalled();
        fixture.props.activeSection = 'settings-services';await vi.waitFor(() => expect(fixture.document!.querySelector('[data-testid="fixture-add-service"]')).not.toBeNull());
        expect(fixture.loadProvider).not.toHaveBeenCalled();
        addProviderFromTemplate(fixture);await fixture.finishProviderLoad();
        expect(fixture.loadProvider).toHaveBeenCalledOnce();expect(fixture.providerMounted).toHaveBeenCalledOnce();
        expect(fixture.dialogPort!.open).toBe(true);
    });

    it('取消后保留同一实例并清空草稿，重开不重新加载或继承旧事件', async () => {
        const fixture = await mountSections({template: true, activeSection: 'settings-services'});
        await settle();addProviderFromTemplate(fixture);await fixture.finishProviderLoad();
        const instance = fixture.providerState!;
        inputProvider(fixture, 'name', '旧服务');inputProvider(fixture, 'api-key', 'synthetic-only');await settle();
        const staleSubmit = fixture.document!.querySelector('form.custom-provider-form')!;
        const staleAction = fixture.providerState!.actions.submit;
        fixture.document!.querySelector('button.secondary-button')!.dispatchEvent(new fixture.domWindow!.Event('click'));
        await settle();
        expect(fixture.state.customProviderDialogOpen).toBe(false);expect(fixture.dialogPort!.open).toBe(false);
        expect(fixture.providerUnmounted).not.toHaveBeenCalled();expect(fixture.providerState).toBe(instance);
        expect(instance.draft).toEqual({name: '', endpoint: '', apiKey: '', model: ''});
        addProviderFromTemplate(fixture);await settle();
        expect(fixture.loadProvider).toHaveBeenCalledOnce();expect(fixture.providerMounted).toHaveBeenCalledOnce();
        expect(fixture.providerState).toBe(instance);expect(fixture.dialogPort!.open).toBe(true);
        staleAction();expect(fixture.state.config.customOpenAIProviders).toHaveLength(0);
        expect(staleSubmit.isConnected).toBe(true);
    });

    it.each(['section', 'keepalive'])('首次加载迟到于 %s 失活时保持关闭，返回可再开且不重复加载', async reason => {
        const gate = deferred<void>();const fixture = await mountSections({template: true, activeSection: 'settings-services', providerGate: gate.promise});
        await settle();addProviderFromTemplate(fixture);await vi.waitFor(() => expect(fixture.loadProvider).toHaveBeenCalledOnce());
        if (reason === 'section') fixture.props.activeSection = 'settings-general';else fixture.visible.value = false;
        await settle();expect(fixture.state.customProviderDialogOpen).toBe(false);
        gate.resolve();await fixture.finishProviderLoad();
        expect(fixture.focus).not.toHaveBeenCalled();expect(fixture.state.config.customOpenAIProviders).toHaveLength(0);
        if (reason === 'section') fixture.props.activeSection = 'settings-services';else fixture.visible.value = true;
        await settle();expect(fixture.dialogPort!.open).toBe(false);
        fixture.dialogPort!.opened();expect(fixture.focus).not.toHaveBeenCalled();
        addProviderFromTemplate(fixture);await settle();expect(fixture.dialogPort!.open).toBe(true);
        expect(fixture.loadProvider).toHaveBeenCalledOnce();expect(fixture.providerMounted).toHaveBeenCalledOnce();
        fixture.dialogPort!.opened();expect(fixture.focus).toHaveBeenCalledOnce();
    });

    it('卸载后完成的加载不挂载子实例、聚焦或保存配置', async () => {
        const gate = deferred<void>();const fixture = await mountSections({template: true, activeSection: 'settings-services', providerGate: gate.promise});
        await settle();addProviderFromTemplate(fixture);await vi.waitFor(() => expect(fixture.loadProvider).toHaveBeenCalledOnce());
        app!.unmount();app = undefined;
        const exitSaves = fixture.patch.mock.calls.length;
        gate.resolve();await fixture.finishProviderLoad();
        expect(fixture.providerMounted).not.toHaveBeenCalled();expect(fixture.focus).not.toHaveBeenCalled();
        expect(fixture.patch).toHaveBeenCalledTimes(exitSaves);
    });

    it.each(['section', 'keepalive', 'context'])('已加载对话框在 %s 失活后清空草稿，旧焦点/提交不能影响重开', async reason => {
        const fixture = await mountSections({template: true, activeSection: 'settings-services'});
        await settle();addProviderFromTemplate(fixture);await fixture.finishProviderLoad();
        const instance = fixture.providerState!;const staleOpened = fixture.dialogPort!.opened, staleSubmit = instance.actions.submit;
        inputProvider(fixture, 'name', '旧草稿');inputProvider(fixture, 'api-key', 'fixture-secret');
        if (reason === 'section') fixture.props.activeSection = 'settings-general';
        else if (reason === 'keepalive') fixture.visible.value = false;
        else fixture.state.updateConfigAtomically((config: {to: string}) => {config.to = 'ja';});
        await settle();expect(fixture.state.customProviderDialogOpen).toBe(false);
        expect(instance.draft).toEqual({name: '', endpoint: '', apiKey: '', model: ''});
        staleOpened();staleSubmit();expect(fixture.focus).not.toHaveBeenCalled();
        expect(fixture.state.config.customOpenAIProviders).toHaveLength(0);
        fixture.props.activeSection = 'settings-services';fixture.visible.value = true;await settle();
        addProviderFromTemplate(fixture);await settle();
        expect(fixture.dialogPort!.open).toBe(true);expect(fixture.providerState).toBe(instance);
        expect(fixture.providerMounted).toHaveBeenCalledOnce();expect(fixture.loadProvider).toHaveBeenCalledOnce();
        staleOpened();staleSubmit();expect(fixture.focus).not.toHaveBeenCalled();
        expect(fixture.state.config.customOpenAIProviders).toHaveLength(0);
    });

    it('真实子模板保持必填校验和关闭后提交流程，服务配置仅写入一次', async () => {
        const fixture = await mountSections({template: true, activeSection: 'settings-services'});
        await settle();addProviderFromTemplate(fixture);await fixture.finishProviderLoad();
        submitProviderFromTemplate(fixture);await settle();
        expect(fixture.document!.querySelectorAll('[role="alert"]')).toHaveLength(3);
        expect(fixture.dialogPort!.open).toBe(true);expect(fixture.patch).not.toHaveBeenCalled();
        inputProvider(fixture, 'name', '  Local Fixture  ');inputProvider(fixture, 'endpoint', ' http://localhost:11434/v1 ');
        inputProvider(fixture, 'api-key', ' synthetic-only ');inputProvider(fixture, 'model', ' fixture-model ');await settle();
        submitProviderFromTemplate(fixture);await settle();
        expect(fixture.state.customProviderDialogOpen).toBe(false);expect(fixture.dialogPort!.open).toBe(false);
        expect(fixture.state.config.customOpenAIProviders).toEqual([expect.objectContaining({name: 'Local Fixture', endpoint: 'http://localhost:11434/v1', models: ['fixture-model']})]);
        expect(fixture.patch).toHaveBeenCalledOnce();expect(fixture.providerUnmounted).not.toHaveBeenCalled();
    });
});

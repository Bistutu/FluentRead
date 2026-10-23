/**
 * @file tests/i18nRuntimeContracts.test.ts
 * 文件职责：验证界面语言运行时在资源失败、用户编辑与 document 所有权边界上的真实行为。
 * 主要内容：执行实际翻译函数、Vue i18n context 与插件，控制配置和资源传输端口，确认失败不保存、迟到失败不覆盖新选择、参数只读取自有值、编辑文本不被改写，元信息与实际回退语言一致。
 * 模块边界：不启动浏览器、不连接翻译供应商；DOM 来自隔离 linkedom，所有插件与全局替换在用例后释放。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {nextTick, ref, type App, type ObjectDirective} from 'vue';

const store = vi.hoisted(() => {
    const listeners = new Set<(value: {uiLanguage: string}) => void>();
    return {
        config: {uiLanguage: 'zh-CN'},
        listeners,
        patch: vi.fn(async () => undefined),
        emit(language: string) {
            this.config.uiLanguage = language;
            for (const listener of listeners) listener(this.config);
        },
    };
});
const bundles = vi.hoisted(() => ({ensure: vi.fn<(value: unknown) => Promise<boolean>>()}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: vi.fn()}}}));
vi.mock('@/src/services/config/store', () => ({
    config: store.config,
    configReady: Promise.resolve(),
    requestConfigPatch: store.patch,
    getConfigRevision: () => 0,
    subscribeConfig: (listener: (value: {uiLanguage: string}) => void) => {
        store.listeners.add(listener);
        return () => store.listeners.delete(listener);
    },
}));
vi.mock('@/src/platform/i18n/uiLanguageBundles', () => ({ensureUiLanguageBundle: bundles.ensure}));

import {registerUiLanguageBundle, translate, type UiLanguage} from '@/src/core/i18n';
import {createUiI18nContext, createUiI18nPlugin, type UiI18nContext} from '@/src/ui/i18n';
import {createUiI18nDirective, observeUiDocument} from '@/src/ui/i18n/legacyDom';

const cleanup: Array<() => void> = [];
beforeEach(() => {
    store.config.uiLanguage = 'zh-CN';
    store.listeners.clear();
    store.patch.mockReset().mockResolvedValue(undefined);
    bundles.ensure.mockReset().mockResolvedValue(true);
});
afterEach(() => {
    for (const close of cleanup.splice(0)) close();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function legacyDomFixture() {
    const {document, window} = parseHTML('<html><body><main><button title="设置">设置</button><p data-i18n-ignore>设置</p></main></body></html>');
    const observers: Array<{observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; callback: MutationCallback}> = [];
    class Observer {
        observe = vi.fn();
        disconnect = vi.fn();
        constructor(readonly callback: MutationCallback) {observers.push(this);}
    }
    for (const [key, value] of Object.entries({document, Node: window.Node, NodeFilter: {SHOW_TEXT: 4}, MutationObserver: Observer})) vi.stubGlobal(key, value);
    const language = ref<UiLanguage>('en-US');
    const value: UiI18nContext = {language, bundleRevision: ref(0),
        t: key => key, translateLegacy: vi.fn(text => text === '设置' ? 'Settings' : text === '保存' ? 'Save' : text),
        setLanguage: async () => true, dispose: () => undefined};
    const directive = createUiI18nDirective(value) as ObjectDirective<HTMLElement> & {dispose(): void};
    cleanup.push(() => directive.dispose());
    const root = document.querySelector('main') as unknown as HTMLElement;
    const hook = (name: 'mounted' | 'updated' | 'beforeUnmount', element = root) => Reflect.apply(directive[name]!, undefined, [element]);
    const notify = (record: {type: MutationRecordType; target: Node; addedNodes?: Node[]}, observer = observers[0]) => observer.callback([record as unknown as MutationRecord], observer as unknown as MutationObserver);
    return {document, root, language, value, directive, observers, hook, notify};
}

function context() {
    const value = createUiI18nContext();
    cleanup.push(value.dispose);
    return value;
}

function install(documentRoot: HTMLElement, uiRoot: HTMLElement | null = documentRoot) {
    let context!: UiI18nContext;
    const app = {
        config: {globalProperties: {}},
        provide: (_key: unknown, value: UiI18nContext) => {context = value;},
        directive: vi.fn(),
        mixin: vi.fn(),
        unmount: vi.fn(),
    };
    const plugin = createUiI18nPlugin({documentRoot, uiRoot, documentTitleKey: 'metadata.optionsTitle'});
    if (typeof plugin.install !== 'function') throw new Error('Expected an installable i18n plugin');
    plugin.install(app as unknown as App);
    cleanup.push(() => app.unmount());
    return context;
}

describe('界面语言加载失败契约', () => {
    it('资源不可用时保留原语言和首启状态，当前请求反馈失败，随后可重试', async () => {
        bundles.ensure.mockResolvedValueOnce(false);
        const value = context();
        await expect(value.setLanguage('fr-FR')).rejects.toThrow();
        expect(value.language.value).toBe('zh-CN');
        expect(store.patch).not.toHaveBeenCalled();
        await expect(value.setLanguage('fr-FR')).resolves.toBe(true);
        expect(store.patch).toHaveBeenCalledWith({uiLanguage: 'fr-FR', uiLanguageSetupCompleted: true}, expect.any(Function));
        expect(value.language.value).toBe('fr-FR');
    });

    it('旧选择迟到的资源失败不覆盖已经完成的新选择', async () => {
        let finish!: (value: boolean) => void;
        bundles.ensure.mockReturnValueOnce(new Promise<boolean>(resolve => {finish = resolve;}));
        const value = context();
        const stale = value.setLanguage('ru-RU');
        await expect(value.setLanguage('es-ES')).resolves.toBe(true);
        finish(false);
        await expect(stale).resolves.toBe(false);
        expect(value.language.value).toBe('es-ES');
        expect(store.patch).toHaveBeenCalledOnce();
    });

    it.each(['foreign', 'dispose'] as const)('%s 取代待加载选择后，迟到 false 只结算旧请求', async reason => {
        let finish!: (value: boolean) => void;
        bundles.ensure.mockReturnValueOnce(new Promise<boolean>(resolve => {finish = resolve;}));
        const value = context();
        const stale = value.setLanguage('fr-FR');
        if (reason === 'foreign') store.emit('ja-JP');
        else value.dispose();
        finish(false);
        await expect(stale).resolves.toBe(false);
        expect(value.language.value).toBe(reason === 'foreign' ? 'ja-JP' : 'zh-CN');
        expect(store.patch).not.toHaveBeenCalled();
    });
});

describe('稳定资源的插值边界', () => {
    it('不读取继承字段，保留缺失占位符，支持显式原型同名参数与零值', () => {
        registerUiLanguageBundle('en-US', {
            messages: {'test.params': '{constructor}|{toString}|{value}|{count}|{enabled}'},
            legacyText: {}, legacyPatterns: {early: [], late: []},
        });
        const inherited = Object.create({value: 'inherited'});
        Object.assign(inherited, {count: 0, enabled: false});
        expect(translate('test.params', 'en-US', inherited)).toBe('{constructor}|{toString}|{value}|0|false');
        expect(translate('test.params', 'en-US', {constructor: 'own', toString: 'text', value: '', count: null}))
            .toBe('own|text||{count}|{enabled}');
    });
});

describe('旧文案扫描与页面元信息', () => {
    it('切换语言与动态更新均保护富文本编辑内容，同时翻译控件说明', async () => {
        const {document, window} = parseHTML('<html><body><button>设置</button><div id="editor" contenteditable="true" aria-label="设置"><span id="draft">设置</span><span id="inherited" contenteditable="invalid">设置</span><span id="readonly" contenteditable="false">设置</span></div><div contenteditable="plaintext-only">设置</div><div contenteditable="">设置</div><div id="readonly-ui" contenteditable="false">设置</div></body></html>');
        for (const [key, value] of Object.entries({document, Node: window.Node, MutationObserver: window.MutationObserver, NodeFilter: {SHOW_TEXT: 4}})) vi.stubGlobal(key, value);
        registerUiLanguageBundle('en-US', {messages: {}, legacyText: {'设置': 'Settings'}, legacyPatterns: {early: [], late: []}});
        const value = install(document.body as unknown as HTMLElement);
        store.emit('en-US');
        await vi.waitFor(() => expect(document.querySelector('button')?.textContent).toBe('Settings'));
        const editor = document.querySelector('#editor')!;
        expect(document.querySelector('#draft')?.textContent).toBe('设置');
        expect(document.querySelector('#inherited')?.textContent).toBe('设置');
        expect(document.querySelector('#readonly')?.textContent).toBe('设置');
        expect(editor.getAttribute('aria-label')).toBe('Settings');
        expect(document.querySelector('[contenteditable="plaintext-only"]')?.textContent).toBe('设置');
        expect(document.querySelector('[contenteditable=""]')?.textContent).toBe('设置');
        expect(document.querySelector('#readonly-ui')?.textContent).toBe('Settings');
        editor.innerHTML = '<em>设置</em>';
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(editor.textContent).toBe('设置');
        store.emit('zh-CN');
        await vi.waitFor(() => expect(document.querySelector('button')?.textContent).toBe('设置'));
        expect(value.language.value).toBe('zh-CN');
        expect(editor.textContent).toBe('设置');
    });

    it('只更新 documentRoot 所属 document，并在资源加载前标记实际中文回退语言', async () => {
        const host = parseHTML('<html lang="host-language"><head><title>Host title</title></head><body></body></html>');
        const owned = parseHTML('<html><head><title>Owned</title></head><body></body></html>');
        vi.stubGlobal('document', host.document);
        vi.stubGlobal('MutationObserver', owned.window.MutationObserver);
        store.config.uiLanguage = 'ko-KR';
        let finish!: (value: boolean) => void;
        const pending = new Promise<boolean>(resolve => {finish = resolve;});
        bundles.ensure.mockReturnValue(pending);
        const value = install(owned.document.body as unknown as HTMLElement, null);
        await nextTick();
        expect(host.document.documentElement.lang).toBe('host-language');
        expect(host.document.title).toBe('Host title');
        expect(owned.document.documentElement.lang).toBe('zh-CN');
        expect(owned.document.title).toBe(value.t('metadata.optionsTitle'));
        registerUiLanguageBundle('ko-KR', {messages: {'metadata.optionsTitle': '설정'}, legacyText: {}, legacyPatterns: {early: [], late: []}});
        finish(true);
        await pending;
        await nextTick();
        expect(owned.document.documentElement.lang).toBe('ko-KR');
        expect(owned.document.title).toBe('설정');
        expect(host.document.title).toBe('Host title');
    });
});

describe('旧文案扫描资源与更新边界', () => {
    it('属性和文本变更重扫自有 UI，忽略正文变更，移除节点的迟到文本记录不触发扫描', async () => {
        vi.useFakeTimers();
        const fixture = legacyDomFixture();
        fixture.hook('mounted');
        await vi.runAllTimersAsync();
        expect(fixture.root.querySelector('button')?.textContent).toBe('Settings');
        const button = fixture.root.querySelector('button')!;
        const ignored = fixture.root.querySelector('p')!;
        fixture.notify({type: 'attributes', target: ignored});
        fixture.notify({type: 'characterData', target: ignored.firstChild!});
        fixture.notify({type: 'childList', target: ignored, addedNodes: []});
        const removed = fixture.document.createTextNode('设置');
        fixture.notify({type: 'characterData', target: removed});
        expect(vi.getTimerCount()).toBe(0);
        button.setAttribute('title', '保存');
        fixture.notify({type: 'attributes', target: button});
        await vi.runAllTimersAsync();
        expect(button.getAttribute('title')).toBe('Save');
        (button.firstChild as Text).data = '保存';
        fixture.notify({type: 'characterData', target: button.firstChild!});
        await vi.runAllTimersAsync();
        expect(button.textContent).toBe('Save');
        fixture.hook('updated');
        await vi.runAllTimersAsync();
        fixture.hook('beforeUnmount');
        fixture.hook('updated');
        fixture.hook('beforeUnmount');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('扫描期间的重入更新合并为下一次刷新，节点移除后不重连', async () => {
        vi.useFakeTimers();
        const fixture = legacyDomFixture();
        let reentered = false;
        fixture.value.translateLegacy = text => {
            if (!reentered) {reentered = true;fixture.hook('updated');}
            return text === '设置' ? 'Settings' : text;
        };
        fixture.hook('mounted');
        await vi.runAllTimersAsync();
        expect(fixture.root.querySelector('button')?.textContent).toBe('Settings');
        expect(fixture.observers[0].observe).toHaveBeenCalledTimes(3);
        fixture.value.translateLegacy = text => {fixture.root.remove();return text;};
        fixture.hook('updated');
        await vi.runAllTimersAsync();
        expect(fixture.observers[0].observe).toHaveBeenCalledTimes(3);
        fixture.hook('updated');
        await vi.runAllTimersAsync();
        expect(fixture.observers[0].observe).toHaveBeenCalledTimes(3);
    });

    it('扫描中释放和重复释放均幂等，已忽略的根不进入翻译', async () => {
        vi.useFakeTimers();
        const fixture = legacyDomFixture();
        const stop = observeUiDocument(fixture.root, fixture.value);
        cleanup.push(stop);
        fixture.value.translateLegacy = text => {stop();return text;};
        await vi.runAllTimersAsync();
        expect(fixture.observers[0].observe).toHaveBeenCalledOnce();
        stop();
        fixture.root.setAttribute('data-i18n-ignore', '');
        fixture.value.translateLegacy = vi.fn(text => text);
        fixture.hook('mounted');
        await vi.runAllTimersAsync();
        expect(fixture.value.translateLegacy).not.toHaveBeenCalled();
    });

    it.each(['directive', 'document'] as const)('%s 初始化失败优先保留初始化异常，释放异常不能留住订阅或计时器', async target => {
        vi.useFakeTimers();
        const fixture = legacyDomFixture();
        const initial = new Error('observe failed'), release = new Error('disconnect failed');
        vi.stubGlobal('MutationObserver', class {
            observe() {throw initial;}
            disconnect() {throw release;}
        });
        expect(() => target === 'directive' ? fixture.hook('mounted') : observeUiDocument(fixture.root, fixture.value)).toThrow(initial);
        fixture.language.value = 'ja-JP';
        await nextTick();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('一个根释放失败仍清理其他根，保留首个异常，销毁后的挂载与重复销毁无副作用', () => {
        vi.useFakeTimers();
        const fixture = legacyDomFixture();
        const other = fixture.document.createElement('section') as unknown as HTMLElement;
        fixture.document.body.appendChild(other);
        fixture.hook('mounted');
        fixture.hook('mounted', other);
        const first = new Error('first release failed'), second = new Error('second release failed');
        fixture.observers[0].disconnect.mockImplementation(() => {throw first;});
        fixture.observers[1].disconnect.mockImplementation(() => {throw second;});
        expect(() => fixture.directive.dispose()).toThrow(first);
        expect(fixture.observers[0].disconnect).toHaveBeenCalledOnce();
        expect(fixture.observers[1].disconnect).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        expect(() => fixture.directive.dispose()).not.toThrow();
        fixture.hook('mounted', other);
        expect(fixture.observers).toHaveLength(2);
    });
});

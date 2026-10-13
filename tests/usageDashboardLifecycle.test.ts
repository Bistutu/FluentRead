import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type Plugin, type ViteDevServer} from 'vite';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// 编译两个实际统计 SFC，验证迟到消息与卸载，并直接执行 Model setup 的数字规则、语言切换和失败重试。
// 本文件不复制业务格式算法；完整模板文本与构造次数另由受控实际 SFC 探针覆盖，焦点/布局由生产浏览器专项验证。
const key = '__fluentReadUsageDashboardLifecycle';
const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
const NativeNumberFormat = Intl.NumberFormat;
let server: ViteDevServer;
let app: import('vue').App | undefined;
let state: Record<string, any>;
let messages: Array<{message: Record<string, any>; resolve: (value: unknown) => void}>;
let attributes: Map<string, string>;
let listeners: Set<unknown>;
let subscriptions: Set<unknown>;

function mocks(): Plugin {
    return {name: 'usage-dashboard-lifecycle-mocks', enforce: 'pre', resolveId(id) {
        if (id === 'webextension-polyfill') return '\0usage-browser';
        if (id === 'element-plus') return '\0usage-element';
        if (/\/(?:UiIcon|UiSelect|ServiceIcon)\.vue$/u.test(id)) return '\0usage-component';
        if (/\/src\/services\/config\/store(?:\.ts)?$/u.test(id)) return '\0usage-config';
        if (/\/src\/ui\/i18n(?:\.ts)?$/u.test(id)) return '\0usage-i18n';
        return null;
    }, load(id) {
        if (id === '\0usage-browser') return `export default {runtime: {sendMessage: globalThis.${key}.sendMessage}}`;
        if (id === '\0usage-element') return 'export const ElOption = {}; export const ElPopover = {}; export const ElTooltip = {};';
        if (id === '\0usage-component') return 'export default {}';
        if (id === '\0usage-config') return `const s = globalThis.${key}; export const config = {customOpenAIProviders: []}; export const subscribeConfig = s.subscribeConfig;`;
        if (id === '\0usage-i18n') return `import {ref} from 'vue'; export const useUiI18n = () => ({language: ref('zh-CN'), t: key => key, translateLegacy: text => text});`;
        return null;
    }};
}

async function settle(): Promise<void> {
    for (let index = 0; index < 8; index += 1) {await Promise.resolve(); await runtime.nextTick();}
}

async function mount(kind: 'model' | 'stats', active = true): Promise<void> {
    const path = kind === 'model' ? 'model-usage/ui/ModelUsageDashboard' : 'translation-stats/ui/TranslationStatsDashboard';
    const component = (await server.ssrLoadModule(`/src/features/${path}.vue`)).default;
    component.ssrRender = undefined;
    component.render = () => null;
    const renderer = runtime.createRenderer<Record<string, never>, Record<string, unknown>>({
        patchProp: () => undefined, insert: () => undefined, remove: () => undefined, createElement: () => ({}),
        createText: () => ({}), createComment: () => ({}), setText: () => undefined, setElementText: () => undefined,
        parentNode: () => null, nextSibling: () => null, querySelector: () => null, setScopeId: () => undefined,
        cloneNode: () => ({}), insertStaticContent: () => [{}, {}],
    });
    app = renderer.createApp(component, {active});
    app.provide(runtime.ssrContextKey, {modules: new Set<string>()});
    app.config.warnHandler = () => undefined;
    const vm = app.mount({});
    state = (vm.$ as unknown as {setupState: Record<string, any>}).setupState;
    await settle();
}

beforeEach(async () => {
    app = undefined;
    messages = []; attributes = new Map(); listeners = new Set(); subscriptions = new Set();
    const settings = {
        hasAttribute: (name: string) => attributes.has(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
    };
    vi.stubGlobal('document', {visibilityState: 'visible', querySelector: () => settings,
        addEventListener: (_name: string, listener: unknown) => listeners.add(listener),
        removeEventListener: (_name: string, listener: unknown) => listeners.delete(listener)});
    Object.assign(globalThis, {[key]: {
        sendMessage: (message: Record<string, any>) => new Promise(resolve => messages.push({message, resolve})),
        subscribeConfig: (listener: unknown) => {subscriptions.add(listener); return () => subscriptions.delete(listener);},
    }});
    server = await createServer({appType: 'custom', configFile: false, logLevel: 'silent', plugins: [mocks(), vue()],
        root: process.cwd(), resolve: {alias: {'@': resolve(process.cwd(), '.')}},
        server: {hmr: false, middlewareMode: true}, ssr: {noExternal: ['webextension-polyfill', 'element-plus']}});
});

afterEach(async () => {
    app?.unmount();
    await server?.close();
    delete (globalThis as any)[key];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Model 用量真实 setup 的固定数字规则', () => {
    it('100 次速度与秒/分钟展示只构造三套规则，格式值仍逐次更新', async () => {
        await mount('model', false);
        const constructors = vi.spyOn(Intl, 'NumberFormat');
        const speed = new NativeNumberFormat('zh-CN', {maximumFractionDigits: 2});
        const second = new NativeNumberFormat('zh-CN', {style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 2});
        const minute = new NativeNumberFormat('zh-CN', {style: 'unit', unit: 'minute', unitDisplay: 'short', maximumFractionDigits: 2});
        for (let index = 0; index < 100; index += 1) {
            expect(state.formatSpeed(index + .125)).toBe(speed.format(index + .125));
            expect(state.formatDuration(1_000 + index)).toBe(second.format(1 + index / 1_000));
            expect(state.formatDuration(60_000)).toBe(`${minute.format(1)} ${second.format(0)}`);
        }
        expect(constructors).toHaveBeenCalledTimes(3);
        expect(messages).toEqual([]);
    });

    it('七种界面语言切换与返回保留异常值、负零和单位阈值，规则按语言复用', async () => {
        await mount('model', false);
        const constructors = vi.spyOn(Intl, 'NumberFormat');
        const locales = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'];
        for (const locale of locales) {
            state.language = locale;
            const speed = new NativeNumberFormat(locale, {maximumFractionDigits: 2});
            const second = new NativeNumberFormat(locale, {style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 2});
            const minute = new NativeNumberFormat(locale, {style: 'unit', unit: 'minute', unitDisplay: 'short', maximumFractionDigits: 2});
            for (const value of [null, undefined, NaN, Infinity, -Infinity]) expect(state.formatSpeed(value)).toBe('—');
            for (const value of [-123.45, -0, 0, 1.005, 1e12]) expect(state.formatSpeed(value)).toBe(speed.format(value));
            for (const value of [null, undefined, NaN, Infinity, -Infinity, -1]) expect(state.formatDuration(value)).toBe('—');
            expect(state.formatDuration(-0)).toBe('0 ms');
            expect(state.formatDuration(0)).toBe('0 ms');
            expect(state.formatDuration(999)).toBe('999 ms');
            expect(state.formatDuration(1_000)).toBe(second.format(1));
            // 原规则按毫秒阈值选单位：59,999.5 ms 显示舍入后的 60 秒，尚不进入分钟。
            expect(state.formatDuration(59_999.5)).toBe(second.format(59.9995));
            expect(state.formatDuration(60_000)).toBe(`${minute.format(1)} ${second.format(0)}`);
            expect(state.formatDuration(123_456_789)).toBe(`${minute.format(2057)} ${second.format(37)}`);
        }
        expect(constructors).toHaveBeenCalledTimes(21);
        constructors.mockClear();state.language = 'zh-CN';
        state.formatSpeed(12.34);state.formatDuration(1_000);state.formatDuration(60_000);
        expect(constructors).not.toHaveBeenCalled();
    });

    it('新组件实例保持懒构造且不会复用前一个实例的格式器', async () => {
        await mount('model', false);
        const constructors = vi.spyOn(Intl, 'NumberFormat');
        state.formatSpeed(12.34);state.formatDuration(1_000);state.formatDuration(60_000);
        expect(constructors).toHaveBeenCalledTimes(3);
        app!.unmount();app = undefined;constructors.mockClear();
        await mount('model', false);
        expect(constructors).not.toHaveBeenCalled();
        state.formatSpeed(12.34);state.formatDuration(1_000);state.formatDuration(60_000);
        expect(constructors).toHaveBeenCalledTimes(3);
    });

    it.each(['speed', 'second', 'minute'] as const)('%s 原生构造失败不污染缓存，下一调用重试后可复用', async (rule) => {
        await mount('model', false);state.language = 'en-US';
        const constructors = vi.spyOn(Intl, 'NumberFormat').mockImplementationOnce(() => {throw new RangeError('controlled native constructor failure');});
        const format = rule === 'speed' ? state.formatSpeed : state.formatDuration;
        const value = rule === 'speed' ? 12.34 : rule === 'second' ? 1_000 : 60_000;
        expect(() => format(value)).toThrow('controlled native constructor failure');
        constructors.mockClear();
        const first = format(value), next = format(value * 2);
        const expected = new NativeNumberFormat('en-US', rule === 'speed' ? {maximumFractionDigits: 2}
            : {style: 'unit', unit: rule, unitDisplay: 'short', maximumFractionDigits: 2});
        if (rule === 'speed') {expect(first).toBe(expected.format(12.34));expect(next).toBe(expected.format(24.68));}
        else if (rule === 'second') {expect(first).toBe(expected.format(1));expect(next).toBe(expected.format(2));}
        else {
            const second = new NativeNumberFormat('en-US', {style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 2});
            expect(first).toBe(`${expected.format(1)} ${second.format(0)}`);expect(next).toBe(`${expected.format(2)} ${second.format(0)}`);
        }
        const targetCalls = constructors.mock.calls.filter(([, options]) => rule === 'speed' ? !options?.unit : options?.unit === rule);
        expect(targetCalls).toHaveLength(1);
    });
});

describe.each(['model', 'stats'] as const)('%s 统计面板真实组件生命周期', (kind) => {
    it('卸载后迟到的清除成功不得查询、写状态或解除新弹窗的背景禁用', async () => {
        await mount(kind);
        await state.openResetDialog();
        const pending = kind === 'model' ? state.resetUsage() : state.resetStats();
        const reset = messages.find(item => item.message.action === 'reset')!;
        expect(reset).toBeDefined();
        app!.unmount(); app = undefined;
        attributes.set('inert', 'new-dialog');
        reset.resolve({success: true, data: {cleared: true}});
        await settle();
        // 若错误实现继续查询，先放行才能收集完整失败而不留下悬挂任务。
        for (const item of messages) if (item !== reset) item.resolve({success: true, data: {selected: {totals: {requestCount: 0}}}});
        await pending;
        expect(messages.filter(item => item.message.action === 'query')).toHaveLength(1);
        expect(attributes.get('inert')).toBe('new-dialog');
        expect(state.resetMessage).toBe('');
        expect(listeners.size).toBe(0);
        expect(subscriptions.size).toBe(0);
    });

    it('卸载后迟到的清除失败不得修改组件错误状态', async () => {
        await mount(kind);
        await state.openResetDialog();
        const pending = kind === 'model' ? state.resetUsage() : state.resetStats();
        app!.unmount(); app = undefined;
        messages.find(item => item.message.action === 'reset')!.resolve({success: false, error: 'late-reset-error'});
        await pending;
        expect(state.resetError).toBe('');
    });

    it('未打开弹窗的隐藏面板卸载时不得解除已有背景禁用', async () => {
        attributes.set('inert', 'other-dialog');
        await mount(kind, false);
        app!.unmount(); app = undefined;
        expect(messages).toEqual([]);
        expect(attributes.get('inert')).toBe('other-dialog');
    });

    it('关闭弹窗保留原有 inert，自己设置的 inert 在卸载时释放', async () => {
        await mount(kind, false);
        attributes.set('inert', 'preexisting');
        await state.openResetDialog();
        state.closeResetDialog();
        expect(attributes.get('inert')).toBe('preexisting');
        attributes.delete('inert');
        await state.openResetDialog();
        expect(attributes.has('inert')).toBe(true);
        app!.unmount(); app = undefined;
        expect(attributes.has('inert')).toBe(false);
    });

    it('卸载后不再发送快照或请求列表查询', async () => {
        await mount(kind);
        messages[0].resolve({success: true, data: {selected: {totals: {requestCount: 0}}}});
        await settle();
        app!.unmount(); app = undefined;
        const snapshot = state.loadSnapshot();
        await settle();
        for (const item of messages.slice(1)) item.resolve({success: true, data: {selected: {totals: {requestCount: 0}}}});
        await snapshot;
        const page = state.loadRequestPage(0);
        await settle();
        for (const item of messages.slice(1)) item.resolve({success: true, data: {items: [], totalCount: 0, offset: 0}});
        await page;
        expect(messages).toHaveLength(1);
    });
});

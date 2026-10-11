import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type Plugin, type ViteDevServer} from 'vite';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';

// 实际 SFC setup 与 useHotkeyDraft 生命周期；真实录制模板和保存链路另由生产浏览器验证。
const key = '__frProgressiveReadingSettingsTest';
const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
let server: ViteDevServer | undefined, app: import('vue').App | undefined;
const feedback = Object.assign(vi.fn(), {warning: vi.fn()});
async function settle() {await runtime.nextTick();await runtime.nextTick();}
async function mount(name = 'ProgressiveReadingSettings') {
    vi.clearAllMocks();Object.assign(globalThis, {[key]: {feedback}});
    const mocks: Plugin = {name: 'reading-settings-mocks', enforce: 'pre', resolveId(id) {
        if (id === 'element-plus') return '\0reading-element';
        if (id === '@element-plus/icons-vue') return '\0reading-icons';
        if (id === 'webextension-polyfill') return '\0reading-browser';
        if (/\/src\/features\/image-translation\/public(?:\.ts)?$/u.test(id)) return '\0reading-image';
        if (id.endsWith('/services/useVisionProbeStatus') || id === './services/useVisionProbeStatus') return '\0reading-probe';
        if (id.endsWith('.vue') && !id.endsWith(`/${name}.vue`)) return '\0reading-child';
        if (/\/src\/ui\/i18n(?:\.ts)?$/u.test(id)) return '\0reading-i18n';
        return null;
    }, load(id) {
        if (id === '\0reading-element') return `export const ElMessage = globalThis.${key}.feedback;`;
        if (id === '\0reading-icons') return 'export const Edit = {};';
        if (id === '\0reading-browser') return 'export default {runtime: {getManifest: () => ({})}};';
        if (id === '\0reading-image') return 'export const ImageOcrSettings = {};';
        if (id === '\0reading-probe') return 'export const useVisionProbeStatus = () => ({});';
        if (id === '\0reading-child') return 'export default {}';
        if (id === '\0reading-i18n') return 'export const useUiI18n = () => ({t: key => key, translateLegacy: text => text});';
        return null;
    }};
    server = await createServer({appType: 'custom', configFile: false, logLevel: 'silent', plugins: [mocks, vue()],
        root: process.cwd(), resolve: {alias: {'@': resolve(process.cwd(), '.')}}, ssr: {noExternal: ['element-plus', '@element-plus/icons-vue', 'webextension-polyfill']}, server: {hmr: false, middlewareMode: true}});
    const component = (await server.ssrLoadModule(`/src/features/settings/ui/${name}.vue`)).default;
    component.ssrRender = undefined;component.render = () => null;
    const renderer = runtime.createRenderer<Record<string, never>, Record<string, unknown>>({patchProp: () => {}, insert: () => {}, remove: () => {},
        createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText: () => {}, setElementText: () => {}, parentNode: () => null,
        nextSibling: () => null, querySelector: () => null, setScopeId: () => {}, cloneNode: () => ({}), insertStaticContent: () => [{}, {}]});
    const props = runtime.reactive({config: Object.assign(new Config(), {hotkey: 'none', floatingBallHotkey: 'none', selectionAreaEnabled: false}), active: true});
    const visible = runtime.ref(true);let state!: Record<string, any>;
    app = renderer.createApp({setup: () => () => runtime.h(runtime.KeepAlive, null, {default: () => visible.value
        ? runtime.h(component, {...props, ref: (vm: any) => {if (vm) state = vm.$.setupState;}})
        : runtime.h({render: () => null}, {key: 'other'})})});
    app.provide(runtime.ssrContextKey, {modules: new Set<string>()});app.config.warnHandler = () => {};app.mount({});await settle();
    return {props, state, visible};
}
afterEach(async () => {app?.unmount();app = undefined;await server?.close();server = undefined;delete (globalThis as any)[key];});

describe('学习设置实际组件草稿与配置归属', () => {
    it('默认仅点击，选择和重复选择自定义只开录制，取消不预绑定', async () => {
        const {state, props} = await mount();expect(state.hotkeyDisplayName).toBe('');
        state.handleHotkeyChange('custom');state.handleHotkeyChange('custom');
        expect(state.showCustomHotkeyDialog).toBe(true);expect(props.config.progressiveReadingHotkey).toBe('none');
        state.closeCustomHotkeyDialog();expect(props.config.customProgressiveReadingHotkey).toBe('');
        expect(props.config.progressiveReadingHotkey).toBe('none');expect(feedback).not.toHaveBeenCalled();
    });
    it('录制确认规范化后生效，清除回仅点击且没有默认快捷键', async () => {
        const {state, props} = await mount();state.handleHotkeyChange('custom');state.handleCustomHotkeyConfirm('option+l');
        expect(props.config).toMatchObject({progressiveReadingHotkey: 'custom', customProgressiveReadingHotkey: 'Alt+L'});
        expect(state.showCustomHotkeyDialog).toBe(false);expect(state.hotkeyDisplayName).toMatch(/^(Alt|Option)\+L$/u);
        state.openCustomHotkeyDialog();state.handleCustomHotkeyConfirm('none');
        expect(props.config).toMatchObject({progressiveReadingHotkey: 'none', customProgressiveReadingHotkey: ''});
        expect(state.hotkeyDisplayName).toBe('');expect(feedback).toHaveBeenLastCalledWith(expect.objectContaining({message: 'progressiveReading.entry.clickOnly'}));
    });
    it('关闭模式保留旧录制，重新选择时校验当下其它动作占用', async () => {
        const {state, props} = await mount();props.config.customProgressiveReadingHotkey = 'Alt+L';
        state.handleHotkeyChange('custom');expect(props.config.progressiveReadingHotkey).toBe('custom');
        state.handleHotkeyChange('none');expect(props.config.customProgressiveReadingHotkey).toBe('Alt+L');
        props.config.floatingBallHotkey = 'Alt+L';state.handleHotkeyChange('custom');
        expect(props.config.progressiveReadingHotkey).toBe('none');expect(feedback.warning).toHaveBeenCalledWith('progressiveReading.settings.conflict');
    });
    it('非法事件值或未完成组合不能写配置，确认前再次检查新占用', async () => {
        const {state, props} = await mount();state.handleHotkeyChange('unexpected');expect(state.showCustomHotkeyDialog).toBe(false);
        state.handleHotkeyChange('custom');state.handleCustomHotkeyConfirm('l');
        expect(props.config.progressiveReadingHotkey).toBe('none');expect(state.showCustomHotkeyDialog).toBe(true);
        props.config.sectionTranslationHotkeyEnabled = true;props.config.sectionTranslationHotkey = 'custom';props.config.customSectionTranslationHotkey = 'Alt+L';
        state.handleCustomHotkeyConfirm('Alt+L');expect(props.config.progressiveReadingHotkey).toBe('none');
        expect(state.showCustomHotkeyDialog).toBe(true);expect(state.findHotkeyConflict('Alt+L')).toBe('progressiveReading.settings.conflict');
    });
    it.each(['object', 'mode', 'custom'] as const)('录制后外部 %s 变化使同步迟到确认失效', async change => {
        const {state, props} = await mount();state.handleHotkeyChange('custom');
        if (change === 'object') props.config = Object.assign(new Config(), {progressiveReadingHotkey: 'none'});
        if (change === 'mode') props.config.progressiveReadingHotkey = 'custom';
        if (change === 'custom') props.config.customProgressiveReadingHotkey = 'Alt+J';
        const snapshot = JSON.stringify(props.config);state.handleCustomHotkeyConfirm('Alt+L');await settle();
        expect(JSON.stringify(props.config)).toBe(snapshot);expect(state.showCustomHotkeyDialog).toBe(false);
    });
    it('选择仅点击后旧确认不能重新开启，未打开录制也不能提交', async () => {
        const {state, props} = await mount();state.handleCustomHotkeyConfirm('Alt+L');
        state.handleHotkeyChange('custom');state.handleHotkeyChange('none');state.handleCustomHotkeyConfirm('Alt+L');
        expect(props.config.progressiveReadingHotkey).toBe('none');expect(props.config.customProgressiveReadingHotkey).toBe('');
    });
    it('换分类、KeepAlive停用和卸载均清理，返回才允许新录制', async () => {
        const {state, props, visible} = await mount();state.handleHotkeyChange('custom');props.active = false;await settle();
        expect(state.showCustomHotkeyDialog).toBe(false);state.handleCustomHotkeyConfirm('Alt+L');state.handleHotkeyChange('custom');
        expect(props.config.progressiveReadingHotkey).toBe('none');props.active = true;state.handleHotkeyChange('custom');
        visible.value = false;await settle();expect(state.showCustomHotkeyDialog).toBe(false);state.openCustomHotkeyDialog();
        expect(state.showCustomHotkeyDialog).toBe(false);visible.value = true;await settle();state.handleHotkeyChange('custom');
        expect(state.showCustomHotkeyDialog).toBe(true);app!.unmount();app = undefined;state.handleCustomHotkeyConfirm('Alt+L');
        expect(props.config.progressiveReadingHotkey).toBe('none');expect(state.showCustomHotkeyDialog).toBe(false);
    });
    it.each(['SectionTranslationSettings', 'ParagraphCopySettings', 'AreaTranslationSettings'])('%s 录制也让行已保存的学习组合', async name => {
        const {state, props} = await mount(name);props.config.progressiveReadingHotkey = 'custom';props.config.customProgressiveReadingHotkey = 'Alt+L';
        expect(state.findHotkeyConflict('option+l')).toMatch(/\.hotkeyConflict$/u);
        props.config.progressiveReadingHotkey = 'none';expect(state.findHotkeyConflict('Alt+L')).toBe('');
    });
});

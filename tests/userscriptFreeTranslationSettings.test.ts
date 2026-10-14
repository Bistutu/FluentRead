import {afterEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import vue from '@vitejs/plugin-vue';
import {createServer, type Plugin, type ViteDevServer} from 'vite';
import {Config, normalizeConfig} from '@/src/core/config/model';

const source = readFileSync(resolve(process.cwd(), 'userscript/SettingsPanel.vue'), 'utf8');

describe('userscript free translation settings', () => {
    it('exposes mode controls, with ordering controls limited to sequential mode', () => {
        expect(source).toContain('v-model="draft.freeTranslationMode"');
        expect(source).toContain('value="balanced">智能加速');
        expect(source).toContain('value="sequential">优先顺序');
        expect(source).not.toContain('freeTranslationWeights');
        expect(source).toContain('优先使用快且稳定的服务');
        expect(source).toContain('v-if="draft.freeTranslationMode === \'sequential\'"');
        expect(source).not.toContain('draft.freeTranslationCooldownMs');
    });

    it('keeps narrow-screen fallback rows bounded and wrapped', () => {
        expect(source).toContain('.fallback-order-row { flex-wrap: wrap; }');
        expect(source).toContain('.fallback-order-row input[type=\'number\'] { flex: 1 1 96px; width: auto; }');
    });

    it('normalizes saved mode and selected fallback order without accepting user weights', () => {
        const normalized = normalizeConfig({
            service: 'freeTranslation',
            freeTranslationMode: 'unexpected',
            freeTranslationOrder: ['sogouFree', 'sogouFree', 'unknown'],
            freeTranslationWeights: {sogouFree: 99},
            // 首次升级插入 B站；下面再验证已升级配置保留用户关闭选择。
            freeTranslationBilibiliDefaultApplied: false,
        });
        expect(normalized.freeTranslationMode).toBe('balanced');
        expect(normalized.freeTranslationOrder).toEqual(['bilibiliFree', 'sogouFree']);
        expect(normalized.freeTranslationBilibiliDefaultApplied).toBe(true);
        expect(normalized).not.toHaveProperty('freeTranslationWeights');
        expect(new Config().freeTranslationMode).toBe('balanced');

        const saved = normalizeConfig({
            ...normalized,
            freeTranslationOrder: ['unknown', 'sogouFree', null, 'sogouFree', 42],
        });
        expect(saved.freeTranslationOrder).toEqual(['sogouFree']);
    });
});

const vueRuntime = createRequire(import.meta.url)('vue') as typeof import('vue');
const fixtureKey = '__frUserscriptTimeoutSettings';
let timeoutServer: ViteDevServer | undefined;
let timeoutApp: import('vue').App | undefined;
afterEach(async () => {
    timeoutApp?.unmount();timeoutApp = undefined;
    await timeoutServer?.close();timeoutServer = undefined;
    delete (globalThis as Record<string, unknown>)[fixtureKey];
    vi.unstubAllGlobals();
});

async function mountTimeoutSettings() {
    const dom = parseHTML('<html><body><main id="settings"></main></body></html>');
    vi.stubGlobal('document', dom.document);
    vi.stubGlobal('window', Object.assign(dom.window, {matchMedia: () => ({matches: false})}));
    vi.stubGlobal('HTMLInputElement', dom.window.HTMLInputElement);
    const saved = vi.fn(async () => undefined);
    (globalThis as Record<string, unknown>)[fixtureKey] = {config: new Config(), saved};
    const mocks: Plugin = {name: 'userscript-timeout-settings-ports', enforce: 'pre', resolveId(id) {
        if (id.endsWith('.vue') && !id.endsWith('/SettingsPanel.vue')) return '\0timeout-child';
        if (id.endsWith('/src/services/config/store')) return '\0timeout-config';
        if (id.endsWith('/src/ui/i18n')) return '\0timeout-i18n';
        if (id === 'webextension-polyfill') return '\0timeout-browser';
        if (id === 'element-plus') return '\0timeout-element';
        return null;
    }, load(id) {
        if (id === '\0timeout-child') return 'export default {render: () => null};';
        if (id === '\0timeout-config') return `export const config = globalThis.${fixtureKey}.config;export const configReady = Promise.resolve();export const saveConfig = globalThis.${fixtureKey}.saved;`;
        if (id === '\0timeout-i18n') return 'export const useUiI18n = () => ({t: key => key});';
        if (id === '\0timeout-browser') return 'export default {tabs: {sendMessage: () => Promise.resolve()}};';
        if (id === '\0timeout-element') return 'export const ElOption = {render: () => null};';
        return null;
    }};
    timeoutServer = await createServer({configFile: false, appType: 'custom', logLevel: 'silent', root: process.cwd(),
        plugins: [mocks, vue()], resolve: {alias: {'@': resolve(process.cwd())}},
        ssr: {noExternal: ['webextension-polyfill']}, server: {hmr: false, middlewareMode: true}});
    const component = (await timeoutServer.ssrLoadModule('/userscript/SettingsPanel.vue')).default;
    const filename = resolve(process.cwd(), 'userscript/SettingsPanel.vue');
    const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
    const bindings = compileScript(descriptor, {id: 'timeout-settings'}).bindings;
    const template = compileTemplate({source: descriptor.template!.content, filename, id: 'timeout-settings',
        compilerOptions: {mode: 'function', cacheHandlers: true, bindingMetadata: bindings, expressionPlugins: ['typescript']}});
    expect(template.errors).toEqual([]);
    component.ssrRender = undefined;
    component.render = new Function('Vue', ts.transpileModule(template.code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText)(vueRuntime);
    const renderer = vueRuntime.createRenderer({patchProp(element: any, name, previous: any, next: any) {
        if (name === 'value') {element.value = next ?? '';return;}
        if (/^on[A-Z]/u.test(name)) {
            const event = name.slice(2).toLowerCase();
            if (previous) element.removeEventListener(event, previous);
            if (next) element.addEventListener(event, next);
        } else if (next === undefined || next === null || next === false) element.removeAttribute(name);
        else element.setAttribute(name, String(next));
    }, insert: (child: any, parent: any, anchor: any = null) => parent.insertBefore(child, anchor),
    remove: (node: any) => node.parentNode?.removeChild(node), createElement: name => dom.document.createElement(name),
    createText: value => dom.document.createTextNode(value), createComment: value => dom.document.createComment(value),
    setText: (node: any, value) => {node.nodeValue = value;}, setElementText: (node: any, value) => {node.textContent = value;},
    parentNode: (node: any) => node.parentNode, nextSibling: (node: any) => node.nextSibling,
    querySelector: value => dom.document.querySelector(value), setScopeId: () => {}, cloneNode: (node: any) => node.cloneNode(true),
    insertStaticContent: (content, parent: any, anchor) => {
        const fragment = dom.document.createElement('template');fragment.innerHTML = content;
        const first = fragment.content.firstChild, last = fragment.content.lastChild;
        parent.insertBefore(fragment.content, anchor);return [first, last];
    }});
    let state!: Record<string, any>;
    timeoutApp = renderer.createApp({setup: () => () => vueRuntime.h(component, {ref: (vm: any) => {if (vm) state = vm.$.setupState;}})});
    timeoutApp.provide(vueRuntime.ssrContextKey, {modules: new Set<string>()});timeoutApp.config.warnHandler = () => {};
    timeoutApp.mount(dom.document.querySelector('#settings')!);
    await vueRuntime.nextTick();await vueRuntime.nextTick();await vueRuntime.nextTick();
    const input = () => dom.document.querySelector('[data-testid="ai-request-timeout-settings"] input') as unknown as HTMLInputElement;
    const type = async (value: string) => {input().value = value;input().dispatchEvent(new dom.window.Event('input', {bubbles: true}));await vueRuntime.nextTick();};
    const confirm = async (event = 'change') => {input().dispatchEvent(new dom.window.Event(event, {bubbles: true}));await vueRuntime.nextTick();};
    return {state, saved, input, type, confirm};
}

describe('userscript AI timeout actual input', () => {
    it('keeps each typed digit until confirmation, permits clear and retype, and saves milliseconds', async () => {
        const fixture = await mountTimeoutSettings();
        expect(fixture.input().value).toBe('120');
        for (const value of ['3', '30', '300']) {
            await fixture.type(value);
            expect(fixture.input().value).toBe(value);
            expect(fixture.state.draft.aiRequestTimeoutMs).toBe(120_000);
        }
        await fixture.confirm();
        expect(fixture.state.draft.aiRequestTimeoutMs).toBe(300_000);
        for (const value of ['', '6', '60', '600']) {
            await fixture.type(value);expect(fixture.input().value).toBe(value);
        }
        await fixture.state.save();
        expect(fixture.saved).toHaveBeenCalledWith(expect.objectContaining({aiRequestTimeoutMs: 600_000}), {recordHistory: true, immediateHistory: true});
        expect(fixture.state.draft.aiRequestTimeoutMs).toBe(600_000);
    });

    it('bounds only on blur, retains the saved value for empty input, and rejects stale draft callbacks', async () => {
        const fixture = await mountTimeoutSettings();
        await fixture.type('3');expect(fixture.input().value).toBe('3');await fixture.confirm('blur');
        expect(fixture.input().value).toBe('10');expect(fixture.state.draft.aiRequestTimeoutMs).toBe(10_000);
        await fixture.type('900');await fixture.confirm('blur');
        expect(fixture.input().value).toBe('600');expect(fixture.state.draft.aiRequestTimeoutMs).toBe(600_000);
        await fixture.type('');await fixture.confirm();
        expect(fixture.input().value).toBe('600');expect(fixture.state.draft.aiRequestTimeoutMs).toBe(600_000);
        const staleCommit = fixture.state.aiRequestTimeoutActions.commit;
        fixture.state.restoreDefaults();await vueRuntime.nextTick();
        await fixture.type('300');staleCommit();
        expect(fixture.state.draft.aiRequestTimeoutMs).toBe(120_000);
        fixture.state.restoreDefaults();await vueRuntime.nextTick();
        expect(fixture.input().value).toBe('120');
        await fixture.type('400');
        const currentCommit = fixture.state.aiRequestTimeoutActions.commit;
        timeoutApp!.unmount();timeoutApp = undefined;
        currentCommit();expect(fixture.state.draft.aiRequestTimeoutMs).toBe(120_000);
    });
});

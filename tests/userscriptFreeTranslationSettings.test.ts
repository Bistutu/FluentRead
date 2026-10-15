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
import {customModelString} from '@/src/core/config/catalog';

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
const saveReleases: Array<() => void> = [];
function pendingSave() {
    let resolve!: () => void, reject!: (error: unknown) => void;
    const promise = new Promise<void>((yes, no) => {resolve = yes;reject = no;});
    saveReleases.push(resolve);
    return {promise, resolve, reject};
}
async function settleSettings() {
    for (let index = 0; index < 16; index++) await Promise.resolve();
    await vueRuntime.nextTick();await vueRuntime.nextTick();
}
afterEach(async () => {
    timeoutApp?.unmount();timeoutApp = undefined;
    for (const release of saveReleases.splice(0)) release();
    await settleSettings();
    await timeoutServer?.close();timeoutServer = undefined;
    delete (globalThis as Record<string, unknown>)[fixtureKey];
    vi.unstubAllGlobals();
});

async function mountCompactSettings(initial: Partial<Config> = {}, readiness: Promise<void> = Promise.resolve()) {
    const dom = parseHTML('<html><body><main id="settings"></main></body></html>');
    vi.stubGlobal('document', dom.document);
    vi.stubGlobal('window', Object.assign(dom.window, {matchMedia: () => ({matches: false})}));
    vi.stubGlobal('HTMLInputElement', dom.window.HTMLInputElement);
    const authority = normalizeConfig(initial);
    const listeners = new Set<(snapshot: Config) => void>();
    const broadcast = (value: Config) => {
        Object.assign(authority, normalizeConfig(value));
        for (const listener of listeners) listener(normalizeConfig(authority));
    };
    const saved = vi.fn(async (snapshot: Config) => {broadcast(snapshot);});
    const sent = vi.fn(async (_tab: number, _message: {type: string; isEnabled?: boolean; mode?: string}) => undefined);
    const subscribe = (listener: (snapshot: Config) => void) => {listeners.add(listener);return () => {listeners.delete(listener);};};
    (globalThis as Record<string, unknown>)[fixtureKey] = {config: authority, saved, sent, subscribe, readiness};
    const mocks: Plugin = {name: 'userscript-timeout-settings-ports', enforce: 'pre', resolveId(id) {
        if (id.endsWith('/src/ui/components/UiSelect.vue')) return '\0timeout-select';
        if (id.endsWith('.vue') && !id.endsWith('/SettingsPanel.vue')) return '\0timeout-child';
        if (id.endsWith('/src/services/config/store')) return '\0timeout-config';
        if (id.endsWith('/src/ui/i18n')) return '\0timeout-i18n';
        if (id === 'webextension-polyfill') return '\0timeout-browser';
        if (id === 'element-plus') return '\0timeout-element';
        return null;
    }, load(id) {
        if (id === '\0timeout-child') return 'export default {render: () => null};';
        // 子选择控件是可输入端口；父 SFC 的真实 v-model、computed setter 与 DOM 输入仍执行。
        if (id === '\0timeout-select') return `import {h} from 'vue';export default {inheritAttrs: false, props: ['modelValue', 'disabled'], emits: ['update:modelValue'], setup(props, {attrs, emit}) {return () => h('input', {...attrs, value: props.modelValue, disabled: props.disabled, 'data-select-port': '', onInput: event => emit('update:modelValue', event.target.value)})}};`;
        if (id === '\0timeout-config') return `export const config = globalThis.${fixtureKey}.config;export const configReady = globalThis.${fixtureKey}.readiness;export const requestConfigPatch = globalThis.${fixtureKey}.saved;export const subscribeConfig = globalThis.${fixtureKey}.subscribe;`;
        if (id === '\0timeout-i18n') return 'export const useUiI18n = () => ({t: key => key});';
        if (id === '\0timeout-browser') return `export default {tabs: {sendMessage: globalThis.${fixtureKey}.sent}};`;
        if (id === '\0timeout-element') return 'export const ElOption = {render: () => null};';
        return null;
    }};
    timeoutServer = await createServer({configFile: false, appType: 'custom', logLevel: 'silent', root: process.cwd(),
        plugins: [mocks, vue()], resolve: {alias: {'@': resolve(process.cwd())}},
        ssr: {noExternal: ['webextension-polyfill']}, server: {hmr: false, middlewareMode: true, watch: null}});
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
    await settleSettings();
    const input = () => dom.document.querySelector('[data-testid="ai-request-timeout-settings"] input') as unknown as HTMLInputElement;
    const type = async (value: string) => {input().value = value;input().dispatchEvent(new dom.window.Event('input', {bubbles: true}));await vueRuntime.nextTick();};
    const confirm = async (event = 'change') => {input().dispatchEvent(new dom.window.Event(event, {bubbles: true}));await vueRuntime.nextTick();};
    const control = (label: string) => dom.document.querySelector(`[aria-label="${label}"]`) as unknown as HTMLInputElement;
    const change = async (label: string, value: string) => {
        control(label).value = value;
        control(label).dispatchEvent(new dom.window.Event('input', {bubbles: true}));
        await settleSettings();
    };
    const restore = async () => {
        const button = [...dom.document.querySelectorAll('button')].find(item => item.textContent === '恢复默认')!;
        button.dispatchEvent(new dom.window.Event('click', {bubbles: true}));await settleSettings();
    };
    const unmount = () => {timeoutApp?.unmount();timeoutApp = undefined;};
    return {state, saved, sent, authority, broadcast, listeners, input, type, confirm, control, change, restore, unmount};
}

describe('userscript AI timeout actual input', () => {
    it('keeps each typed digit until confirmation, permits clear and retype, and saves milliseconds', async () => {
        const fixture = await mountCompactSettings();
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
        expect(fixture.saved).toHaveBeenCalledWith(expect.objectContaining({aiRequestTimeoutMs: 600_000}));
        expect(fixture.state.draft.aiRequestTimeoutMs).toBe(600_000);
    });

    it('bounds only on blur, retains the saved value for empty input, and rejects stale draft callbacks', async () => {
        const fixture = await mountCompactSettings();
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


describe('compact userscript shared model editing', () => {
    it('removes the current custom model through the visible button and clears its request preferences before saving', async () => {
        const fixture = await mountCompactSettings();
        const draft = fixture.state.draft;
        draft.service = 'deepseek'; draft.customModels.deepseek = ['obsolete-model', 'retained-model'];
        draft.model.deepseek = '自定义模型'; draft.customModel.deepseek = 'obsolete-model';
        draft.documentModel.deepseek = '自定义模型'; draft.documentCustomModel.deepseek = 'obsolete-model';
        draft.modelRequestLimits.deepseek = {'obsolete-model': {enabled: true, limits: {maxConcurrentTranslations: 1, translationRequestsPerSecond: 0, translationRequestsPerMinute: 0}}};
        await vueRuntime.nextTick();
        const remove = document.querySelector('button.inline-action.is-danger');
        expect(remove).not.toBeNull();
        remove!.dispatchEvent(new window.Event('click', {bubbles: true})); await vueRuntime.nextTick();
        expect(draft.customModels.deepseek).toEqual(['retained-model']);
        expect(draft.customModel.deepseek).toBe('retained-model'); expect(draft.documentCustomModel.deepseek).toBe('retained-model');
        expect(draft.modelRequestLimits.deepseek).toBeUndefined();
        await fixture.state.save(); expect(fixture.saved).toHaveBeenCalledOnce();
        expect(fixture.saved.mock.calls[0][0].modelRequestLimits.deepseek).toBeUndefined();
    });
});

function initialCompactConfig(): Config {
    return normalizeConfig({to: 'es', service: 'deepseek', theme: 'light',
        model: {deepseek: customModelString}, customModel: {deepseek: 'base-model'},
        customModels: {deepseek: ['base-model', 'first-model', 'later-model']}});
}

describe('compact userscript manual save ownership in the actual SFC', () => {
    it.each((['success', 'failure'] as const).flatMap(outcome =>
        (['language', 'model', 'defaults'] as const).map(edit => ({outcome, edit})),
    ))('retains the later $edit draft after an older save $outcome and establishes the next baseline', async ({outcome, edit}) => {
        const fixture = await mountCompactSettings(initialCompactConfig());
        const baseline = normalizeConfig(fixture.authority);
        await fixture.change('目标语言', 'de');await fixture.change('模型', 'first-model');
        const gate = pendingSave();fixture.saved.mockReturnValueOnce(gate.promise);
        const saving = fixture.state.save();await settleSettings();
        expect(fixture.saved).toHaveBeenCalledOnce();expect(fixture.state.saving).toBe(true);
        // 模拟真实 patch 端口在 ACK 前发出的乐观快照；editor 仍持有在途字段。
        fixture.broadcast(fixture.saved.mock.calls[0][0]);await settleSettings();
        expect(fixture.control('目标语言').hasAttribute('disabled')).toBe(false);
        expect(fixture.control('模型').hasAttribute('disabled')).toBe(false);
        if (edit === 'language') await fixture.change('目标语言', 'ja');
        if (edit === 'model') await fixture.change('模型', 'later-model');
        if (edit === 'defaults') await fixture.restore();
        const laterDraft = normalizeConfig(fixture.state.draft);
        const restoreFeedback = fixture.state.status;
        await fixture.state.save();expect(fixture.saved).toHaveBeenCalledOnce();
        if (outcome === 'success') gate.resolve();
        else {
            // requestConfigPatch 在拒绝前已回读权威；此处只控制这个已有端口契约。
            fixture.broadcast(baseline);gate.reject(new Error('fixture persistence failed'));
        }
        await saving;await settleSettings();
        expect(normalizeConfig(fixture.state.draft)).toEqual(laterDraft);
        expect(fixture.control('目标语言').value).toBe(laterDraft.to);
        if (edit === 'model') expect(fixture.control('模型').value).toBe('later-model');
        expect(fixture.state.saving).toBe(false);
        if (edit === 'defaults') {
            expect(fixture.state.status).toBe(restoreFeedback);expect(fixture.state.statusIsError).toBe(false);
        } else if (outcome === 'failure') expect(fixture.state.status).toContain('fixture persistence failed');
        await fixture.state.save();await settleSettings();
        expect(fixture.saved).toHaveBeenCalledTimes(2);
        expect(fixture.saved.mock.calls[1][0]).toEqual(laterDraft);
        expect(fixture.state.statusIsError).toBe(false);
        expect(fixture.state.status).toContain('本次提交已保存');
        // 成功后无变化保存只重新应用页面，不把已确认字段当成脏草稿再次持久化。
        await fixture.state.save();expect(fixture.saved).toHaveBeenCalledTimes(2);
    });

    it('does not auto-save edits, applies only the accepted runtime snapshot, and re-applies unchanged settings', async () => {
        const fixture = await mountCompactSettings(initialCompactConfig());
        fixture.state.draft.on = false;await settleSettings();expect(fixture.saved).not.toHaveBeenCalled();
        const gate = pendingSave();fixture.saved.mockReturnValueOnce(gate.promise);
        const saving = fixture.state.save();await settleSettings();
        fixture.broadcast(fixture.saved.mock.calls[0][0]);fixture.state.draft.on = true;await settleSettings();
        gate.resolve();await saving;
        expect(fixture.state.draft.on).toBe(true);
        expect(fixture.sent.mock.calls.map(([, message]) => message)).toEqual([
            {type: 'toggleFloatingBall', isEnabled: false},
            {type: 'updateSelectionTranslatorMode', mode: 'disabled'},
            {type: 'toggleTranslationProgressPanel', isEnabled: false},
        ]);
        await fixture.state.save();expect(fixture.authority.on).toBe(true);
        fixture.sent.mockClear();await fixture.state.save();
        expect(fixture.saved).toHaveBeenCalledTimes(2);
        expect(fixture.sent.mock.calls.map(([, message]) => message.type))
            .toEqual(['toggleFloatingBall', 'updateSelectionTranslatorMode', 'toggleTranslationProgressPanel']);
    });

    it('adopts external untouched fields while preserving pending and later edits without making a request', async () => {
        const fixture = await mountCompactSettings(initialCompactConfig());
        await fixture.change('目标语言', 'fr');
        const gate = pendingSave();fixture.saved.mockReturnValueOnce(gate.promise);
        const saving = fixture.state.save();await settleSettings();
        fixture.broadcast(fixture.saved.mock.calls[0][0]);
        fixture.broadcast(normalizeConfig({...fixture.authority, to: 'ja', theme: 'dark'}));
        await fixture.change('目标语言', 'de');
        expect(fixture.state.draft.theme).toBe('dark');expect(fixture.saved).toHaveBeenCalledOnce();
        gate.resolve();await saving;expect(fixture.state.draft.to).toBe('de');
        await fixture.state.save();expect(fixture.saved.mock.calls[1][0]).toMatchObject({to: 'de', theme: 'dark'});
    });

    it('retries a failed page application with the saved authority and keeps a newer draft', async () => {
        const fixture = await mountCompactSettings(initialCompactConfig());
        await fixture.change('目标语言', 'fr');fixture.sent.mockRejectedValueOnce(new Error('page channel unavailable'));
        await fixture.state.save();
        expect(fixture.state.status).toContain('page channel unavailable');expect(fixture.state.draft.to).toBe('fr');
        await fixture.state.save();expect(fixture.saved).toHaveBeenCalledOnce();
        expect(fixture.state.statusIsError).toBe(false);expect(fixture.state.status).toContain('本次提交已保存');
    });

    it.each(['success', 'failure'] as const)('disposes its subscription and ignores late %s feedback or page commands after unmount', async outcome => {
        const fixture = await mountCompactSettings(initialCompactConfig());
        await fixture.change('目标语言', 'fr');const gate = pendingSave();fixture.saved.mockReturnValueOnce(gate.promise);
        const saving = fixture.state.save();await settleSettings();expect(fixture.listeners.size).toBe(1);
        fixture.unmount();const draft = normalizeConfig(fixture.state.draft), status = fixture.state.status;
        expect(fixture.listeners.size).toBe(0);fixture.broadcast(normalizeConfig({...fixture.authority, to: 'ja'}));
        if (outcome === 'success') gate.resolve();else gate.reject(new Error('late persistence failure'));
        await saving;await settleSettings();
        expect(normalizeConfig(fixture.state.draft)).toEqual(draft);expect(fixture.state.status).toBe(status);
        expect(fixture.sent).not.toHaveBeenCalled();expect(fixture.state.saving).toBe(false);
        await fixture.state.save();expect(fixture.saved).toHaveBeenCalledOnce();
    });

    it('does not hydrate a closed instance and reports readiness failures without enabling edits', async () => {
        const first = pendingSave(), fixture = await mountCompactSettings(initialCompactConfig(), first.promise);
        expect(fixture.state.hydrated).toBe(false);await fixture.state.save();fixture.state.restoreDefaults();
        expect(fixture.saved).not.toHaveBeenCalled();fixture.unmount();first.resolve();await settleSettings();
        expect(fixture.state.hydrated).toBe(false);await timeoutServer?.close();timeoutServer = undefined;
        const failed = pendingSave(), second = await mountCompactSettings(initialCompactConfig(), failed.promise);
        failed.reject(new Error('read unavailable'));await settleSettings();
        expect(second.state.hydrated).toBe(false);expect(second.state.statusIsError).toBe(true);
        expect(second.state.status).toContain('read unavailable');expect(second.saved).not.toHaveBeenCalled();
    });
});

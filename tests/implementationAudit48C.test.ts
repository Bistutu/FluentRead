import {resolveLocalTranslationLanguageCode} from '@/src/core/language/localTranslation';
import {afterEach, describe, expect, it, vi} from 'vitest';

// 实际客户端 runtime-dom 与 SFC template；仅 DOM、Element Plus 控件、翻译文案和外部消息端口受控。
const dom = await vi.hoisted(async () => {
    const {parseHTML} = await import('linkedom');
    const {window, document} = parseHTML('<html><body></body></html>');
    Object.defineProperty(window.Node.prototype, Symbol.toStringTag, {configurable: true, get() {return this.constructor.name;}});
    // linkedom 的 select.value 只有 getter；补齐外部控件所需的可写 DOM port。
    const selectValues = new WeakMap<object, string>();
    Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {configurable: true,
        get() {return selectValues.get(this) ?? '';}, set(value: string) {selectValues.set(this, String(value));}});
    for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'ShadowRoot', 'Event', 'CustomEvent']) {
        Object.defineProperty(globalThis, key, {configurable: true, writable: true, value: (window as any)[key]});
    }
    const frames = new Map<number, FrameRequestCallback>(); let next = 0;
    Object.defineProperty(globalThis, 'requestAnimationFrame', {configurable: true, value: (fn: FrameRequestCallback) => {frames.set(++next, fn); return next;}});
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {configurable: true, value: (id: number) => frames.delete(id)});
    return {document, frames};
});
const ports = vi.hoisted(() => ({calls: [] as any[], controls: [] as any[]}));
vi.mock('@/src/ui/i18n', () => ({useUiI18n: () => ({t: (key: string) => key, translateLegacy: (value: string) => value})}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: async () => ({success: true})}}}));
vi.mock('@/src/features/reading-assistant/client', () => ({
    streamReading: (request: any, callbacks: any) => {const cancel = vi.fn(); ports.calls.push({request, callbacks, cancel}); return {cancel};},
    getHarnessSession: async () => null, listHarnessSessions: async () => ({sessions: [], hasMore: false}), saveLearningMemory: async () => ({}),
}));
vi.mock('element-plus', async () => {
    const {defineComponent, h} = await import('vue');
    return {ElTooltip: defineComponent({setup: (_, {slots}) => () => h('span', slots.default?.())})};
});
vi.mock('@/src/features/settings/ui/components/SegmentedControl.vue', async importOriginal => {
    const {default: SegmentedControl} = await importOriginal<typeof import('@/src/features/settings/ui/components/SegmentedControl.vue')>();
    const {defineComponent, h} = await import('vue');
    return {default: defineComponent({name: 'ObservedSegmentedControl', inheritAttrs: false,
        props: ['modelValue', 'options', 'label', 'disabled', 'compact', 'onUpdate:modelValue'],
        setup(props, {attrs}) {
            // Observe the complete event callback supplied through the public
            // component prop contract. Keep the real control and client DOM;
            // retain this render's callback to model a queued control event.
            ports.controls.push({label: props.label, update: props['onUpdate:modelValue']});
            return () => h(SegmentedControl, {...attrs, ...props});
        },
    })};
});
import {createApp, defineComponent, h, nextTick, reactive, watch, type App, type Component} from 'vue';
import RequestLimitSettings from '@/src/features/settings/ui/services/RequestLimitSettings.vue';
import ReadingPanel from '@/src/features/reading-assistant/ui/ReadingPanel.vue';
import {normalizeConfig} from '@/src/core/config/model';
import {isSensitiveConfigKey} from '@/src/core/config/sensitiveKeys';
import {sanitizeConfigCredentials, sanitizeConfigHistoryCredentials} from '@/src/core/config/credentials';
import {getHarnessModelCacheKey} from '@/src/core/config/harness';
import * as limits from '@/src/core/config/requestLimits';
import {driveSyncPayload, parseDriveSyncSnapshot, projectDriveSyncConfig, restoreDriveSyncSettings, buildDriveSyncDiff, resolveDriveSyncDiff} from '@/src/core/config/driveSync';
import {buildConfigDiff} from '@/src/core/config/diff';
import {LOCAL_TRANSLATION_MODEL_IDS, getLocalTranslationModel, normalizeLocalTranslationDownloadSnapshot, resolveOpusTranslationRepository, localTranslationErrorKey} from '@/src/core/config/localTranslation';
import {normalizeShareCardPreferences} from '@/src/core/config/shareCard';
import {strongCloudEtag} from '@/src/core/config/cloudSync';
import {normalizeRequestHeaderDomain, normalizeRequestHeaderRules} from '@/src/core/config/requestHeaders';
import {createRequestHeaderRulesSynchronizer} from '@/src/platform/browser/requestHeaderRules';
import {parseTranslationCustomCss, buildTranslationAppearanceCss} from '@/src/core/config/translationAppearance';
import {buildSentenceHighlightAppearanceCss} from '@/src/core/config/sentenceHighlight';

const mounted = new Set<App>();
afterEach(async () => {
    mounted.forEach(app => app.unmount()); mounted.clear();
    await nextTick(); expect(dom.frames.size).toBe(0);
    dom.document.body.replaceChildren(); ports.calls.length = 0; ports.controls.length = 0;
});
const ElOption = defineComponent({props: ['label', 'value'], setup: props => () => h('option', {value: props.value}, props.label)});
const ElSelect = defineComponent({props: ['modelValue'], emits: ['update:modelValue'], setup(props, {attrs, slots, emit}) {
    return () => h('select', {...attrs, value: props.modelValue, onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value)}, slots.default?.());
}});
const ElInputNumber = defineComponent({props: ['modelValue', 'disabled', 'min', 'max'], emits: ['change'], setup(props, {attrs, emit}) {
    return () => h('input', {...attrs, type: 'number', value: props.modelValue, disabled: props.disabled, min: props.min, max: props.max,
        onChange: (event: Event) => emit('change', Number((event.target as HTMLInputElement).value))});
}});
async function settle() {await nextTick(); await nextTick();}
async function mount(component: Component, props: Record<string, any>) {
    const host = dom.document.createElement('div'); dom.document.body.append(host);
    const state = reactive(props);
    const app = createApp({setup: () => () => h(component, state)});
    app.component('el-select', ElSelect); app.component('el-option', ElOption); app.component('el-input-number', ElInputNumber);
    mounted.add(app); app.mount(host); await settle();
    return {host, state, stop: () => {app.unmount(); mounted.delete(app);}};
}
function press(host: HTMLElement, label: string) {
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
}
const customProvider = {id: 'custom:audit', name: 'Audit fixture', endpoint: 'https://controlled.test/v1/chat/completions', models: ['reader']};
function readingConfig() {
    const config = normalizeConfig({customOpenAIProviders: [customProvider], harness: {enabled: true, service: customProvider.id, model: 'reader'},
        token: {[customProvider.id]: 'fixture-first'}, apiKeys: {[customProvider.id]: ['fixture-first', 'fixture-second']}, customHeaders: {[customProvider.id]: '{"x-route":"fixture-a"}'}});
    return config;
}

describe('audit48C credential field spelling through real public boundaries', () => {
    it.each(['APIKey', 'APIKeys', 'APISecret', 'APIToken', 'providerAPIKey', 'OAuthAccessToken', 'HTTPAuthorization', 'AWSAccessKey'])('recognizes acronym boundary %s', key => {
        expect(isSensitiveConfigKey(key)).toBe(true);
        const source = {nested: {[key]: 'synthetic-secret', title: 'visible'}};
        expect(sanitizeConfigCredentials(source)).toEqual({nested: {title: 'visible'}});
    });
    it('removes acronym credentials from public config, migration normalization and old history without changing input', () => {
        const source = {APIKey: 'synthetic-root', nested: [{APIKey: 'synthetic-child', note: 'kept'}], requireAPIKey: false, APIKeyRecoveryMs: 60000, APIKeyRotationEnabled: true};
        const original = JSON.stringify(source);
        expect(sanitizeConfigCredentials(source)).toEqual({nested: [{note: 'kept'}], requireAPIKey: false, APIKeyRecoveryMs: 60000, APIKeyRotationEnabled: true});
        expect(normalizeConfig(source)).not.toHaveProperty('APIKey');
        expect(sanitizeConfigHistoryCredentials({entries: [{config: source}]})).toEqual({entries: [{config: {nested: [{note: 'kept'}], requireAPIKey: false, APIKeyRecoveryMs: 60000, APIKeyRotationEnabled: true}}]});
        expect(JSON.stringify(source)).toBe(original);
    });
    it('does not put acronym credentials into the real config-difference preview', () => {
        const preview = buildConfigDiff({theme: 'light', metadata: {APIKey: 'synthetic-old', label: 'old'}}, {theme: 'dark', metadata: {APIKey: 'synthetic-new', label: 'new'}});
        expect(JSON.stringify(preview)).not.toContain('synthetic-');
        expect(JSON.stringify(preview)).toContain('new');
    });
});

describe('audit48C scoped limit ownership and bounded selected-entry work', () => {
    it.each(['update', 'delete'] as const)('keeps nested model mapping prototype-free on %s', operation => {
        const original = limits.withModelRequestLimit({}, 'openai', 'a', {enabled: true, limits: {maxConcurrentTranslations: 4}});
        const next = operation === 'update' ? limits.withModelRequestLimit(original, 'openai', 'b', {enabled: true})
            : limits.withoutModelRequestLimit(limits.withModelRequestLimit(original, 'openai', 'b', {enabled: false}), 'openai', 'b');
        expect(Object.getPrototypeOf(next)).toBeNull(); expect(Object.getPrototypeOf(next.openai)).toBeNull();
        expect(next.openai.constructor).toBeUndefined(); expect(original.openai).not.toHaveProperty('b');
    });
    it('ignores inherited, nonenumerable and reserved service/model keys while preserving malformed own preferences', () => {
        const inherited = Object.create({openai: {enabled: true}});
        Object.defineProperty(inherited, 'hidden', {value: {enabled: true}, enumerable: false});
        inherited.visible = null;
        expect(limits.getServiceRequestLimitPreference(inherited, 'openai')).toBeUndefined();
        expect(limits.getServiceRequestLimitPreference(inherited, 'hidden')).toBeUndefined();
        expect(limits.getServiceRequestLimitPreference(inherited, 'visible')).toEqual(limits.normalizeRequestLimitPreference(null));
        for (const key of ['__proto__', 'constructor', 'prototype', '']) {
            expect(limits.getServiceRequestLimitPreference(JSON.parse('{"constructor":{"enabled":true}}'), key)).toBeUndefined();
            expect(limits.getModelRequestLimitPreference({openai: inherited}, 'openai', key)).toBeUndefined();
        }
    });
    it('reads only the selected preference in large bounded service/model maps', () => {
        let reads = 0;
        const mapping = Object.fromEntries(Array.from({length: 300}, (_, index) => [`service-${index}`, {enabled: true, limits: {maxConcurrentTranslations: 2}}]));
        const models: Record<string, unknown> = Object.fromEntries(Array.from({length: 300}, (_, index) => [`model-${index}`, {enabled: true}]));
        for (const [key, value] of Object.entries(mapping)) Object.defineProperty(mapping, key, {enumerable: true, get: () => {reads++; return value;}});
        for (const [key, value] of Object.entries(models)) Object.defineProperty(models, key, {enumerable: true, get: () => {reads++; return value;}});
        expect(limits.getServiceRequestLimitPreference(mapping, 'service-299')!.limits.maxConcurrentTranslations).toBe(2);
        expect(limits.getModelRequestLimitPreference({'service-299': models}, 'service-299', 'model-299')!.enabled).toBe(true);
        expect(reads).toBe(2);
    });
    it('keeps getter copies detached and tracks selected entry insertion/replacement reactively', async () => {
        const config = reactive({serviceRequestLimits: {} as Record<string, unknown>});
        const states: any[] = []; const stop = watch(() => limits.getServiceRequestLimitPreference(config.serviceRequestLimits, 'openai'), value => states.push(value), {immediate: true});
        config.serviceRequestLimits.openai = {enabled: true, limits: {maxConcurrentTranslations: 8}}; await settle();
        states.at(-1).limits.maxConcurrentTranslations = 3;
        expect(limits.getServiceRequestLimitPreference(config.serviceRequestLimits, 'openai')!.limits.maxConcurrentTranslations).toBe(8);
        config.serviceRequestLimits = {}; await settle(); expect(states.at(-1)).toBeUndefined(); stop();
    });
    it('executes the real settings template for inheritance, editing, service switch and late control callback', async () => {
        const config = normalizeConfig({serviceRequestLimits: {openai: {enabled: true, limits: {maxConcurrentTranslations: 4}}}});
        const {host, state, stop} = await mount(RequestLimitSettings, {config, service: 'openai', model: 'reader', active: true});
        expect(host.querySelector('input')!.value).toBe('4'); expect(host.querySelector('input')!.disabled).toBe(true);
        const stale = ports.controls.find(control => control.label === 'settings.requestLimits.mode').update;
        expect(stale).toBeTypeOf('function');
        host.querySelector<HTMLButtonElement>('[data-request-limit-mode] button[data-option-index="1"]')!.click(); await settle();
        const input = host.querySelector<HTMLInputElement>('input')!; expect(input.disabled).toBe(false);
        input.value = '7'; input.dispatchEvent(new Event('change', {bubbles: true})); await settle();
        expect(state.config.modelRequestLimits.openai.reader.limits.maxConcurrentTranslations).toBe(7);
        state.service = 'deepseek'; await settle(); stale('custom'); await settle();
        expect(state.config.modelRequestLimits.deepseek).toBeUndefined();
        state.config = normalizeConfig({modelRequestLimits: {deepseek: {reader: {enabled: true, limits: {maxConcurrentTranslations: 9}}}}}); await settle();
        expect(host.querySelector('input')!.value).toBe('9');
        stop(); stale('custom'); expect(state.config.modelRequestLimits.openai).toBeUndefined();
    });
});

describe('audit48C reading cache inputs and actual client answer reuse', () => {
    it.each(['headers', 'keys'] as const)('invalidates completed action cache after selected %s change', async kind => {
        const config = reactive(readingConfig()); let revision = 0;
        const props = reactive({selection: {text: 'Practice helps.', sentence: 'Practice helps.', context: 'Practice helps every day.'}, preferences: config.harness,
            active: true, targetLanguage: 'zh-Hans', sourceLanguage: 'en', vocabularyEnabled: false, privateContext: false, animations: false, modelRevision: 0});
        const stopWatch = watch(() => getHarnessModelCacheKey(config), () => {props.modelRevision = ++revision;});
        const {host, state} = await mount(ReadingPanel, props);
        const transfer = watch(() => props.modelRevision, value => {state.modelRevision = value;});
        try {
            expect(ports.calls).toHaveLength(1); ports.calls[0].callbacks.result({success: true, text: 'Meaning fixture', service: customProvider.id, model: 'reader'}); await settle();
            press(host, '词性与句法'); await settle(); ports.calls[1].callbacks.result({success: true, text: 'Grammar fixture', service: customProvider.id, model: 'reader'}); await settle();
            press(host, '读懂'); await settle(); expect(ports.calls).toHaveLength(2); expect(host.textContent).toContain('Meaning fixture');
            press(host, '词性与句法'); await settle(); expect(ports.calls).toHaveLength(2);
            // mount 接收的是展开属性对象；显式同步公共 prop，与 SelectionTranslator 的 modelRevision 传递契约一致。
            if (kind === 'headers') config.customHeaders[customProvider.id] = '{"x-route":"fixture-b"}';
            else config.apiKeys[customProvider.id] = ['fixture-first', 'fixture-replacement'];
            await settle(); press(host, '读懂'); await settle(); expect(ports.calls).toHaveLength(3);
            ports.calls[2].callbacks.result({success: true, text: 'Updated fixture', service: customProvider.id, model: 'reader'}); await settle();
            expect(host.textContent).toContain('Updated fixture');
        } finally {stopWatch(); transfer();}
    });
    it('tracks selected transport fields with explicit service/model override, preserves unrelated configuration', () => {
        const config = readingConfig(); const original = getHarnessModelCacheKey(config);
        config.customHeaders.deepseek = '{"x-route":"unrelated"}'; config.apiKeys.deepseek = ['unrelated']; config.theme = 'dark'; config.service = 'gemini';
        expect(getHarnessModelCacheKey(config)).toBe(original);
        config.customHeaders[customProvider.id] = '{"x-route":"changed"}'; expect(getHarnessModelCacheKey(config)).not.toBe(original);
        const headers = getHarnessModelCacheKey(config); config.apiKeyRotationEnabled[customProvider.id] = false;
        expect(getHarnessModelCacheKey(config)).not.toBe(headers);
    });
});

describe('audit48C reviewed unchanged public contracts', () => {
    it('rejects duplicate/corrupt download task state and releases caller ownership via copied records', () => {
        const task = {model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, phase: 'paused', downloadedBytes: 1, totalBytes: 4, bytesPerSecond: 0, updatedAt: 9, error: 'network'};
        const result = normalizeLocalTranslationDownloadSnapshot({version: 2, tasks: [task]})!;
        result.tasks[0].downloadedBytes = 2; expect(task.downloadedBytes).toBe(1);
        for (const tasks of [[task, task], [{...task, phase: 'late'}], [{...task, totalBytes: 0}], [{...task, updatedAt: Infinity}]]) expect(normalizeLocalTranslationDownloadSnapshot({version: 2, tasks})).toBeUndefined();
    });
    it('preserves language/model fallback errors through public local translation entry points', () => {
        expect(resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, 'zh-TW')).toBe('zh');
        expect(resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.hunyuan, 'zh-TW')).toBe('zh-Hant');
        expect(() => resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.opusJaEn, 'fr')).toThrow('LOCAL_TRANSLATION_LANGUAGE_UNSUPPORTED');
        expect(localTranslationErrorKey(new Error('LOCAL_TRANSLATION_MODEL_REMOVED'))).toBe('settings.localTranslation.error.removed');
    });
    it('routes supported OPUS pairs, handles malformed persisted snapshots and preserves classified errors', () => {
        expect(getLocalTranslationModel('old-retired-model').value).toBe(LOCAL_TRANSLATION_MODEL_IDS.opusZhEn);
        expect(resolveOpusTranslationRepository(LOCAL_TRANSLATION_MODEL_IDS.opusJaEn, 'en', 'ja')).toBe('Xenova/opus-mt-en-jap');
        expect(resolveOpusTranslationRepository(LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, 'zh', 'en')).toBe('Xenova/opus-mt-zh-en');
        for (const model of [LOCAL_TRANSLATION_MODEL_IDS.nllb, LOCAL_TRANSLATION_MODEL_IDS.opusZhEn]) expect(() => resolveOpusTranslationRepository(model, 'fr', 'de')).toThrow('LOCAL_TRANSLATION_LANGUAGE_UNSUPPORTED');
        for (const input of [null, 2, {version: 1, tasks: []}, {version: 2, tasks: null}]) expect(normalizeLocalTranslationDownloadSnapshot(input)).toBeUndefined();
        const task = {model: LOCAL_TRANSLATION_MODEL_IDS.opusJaEn, phase: 'ready', downloadedBytes: 4, totalBytes: 4, bytesPerSecond: 0, updatedAt: 10};
        for (const error of [undefined, 'unclassified']) expect(normalizeLocalTranslationDownloadSnapshot({version: 2, tasks: [{...task, error}]})!.tasks[0].error).toBeUndefined();
        expect(resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.hunyuan, 'en')).toBe('en');
        expect(() => resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.hunyuan, 'xx')).toThrow('LOCAL_TRANSLATION_LANGUAGE_UNSUPPORTED');
        expect(() => resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.nllb, 'xx_Zzzz')).toThrow('暂不支持');
        expect(() => resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.nllb, 'x?')).toThrow('暂不支持');
        expect(() => resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.nllb, '', '😀')).toThrow('und');
        expect(() => resolveLocalTranslationLanguageCode(LOCAL_TRANSLATION_MODEL_IDS.nllb, null, 'This is a clear English sentence for detecting the language.')).not.toThrow();
        expect(localTranslationErrorKey(null)).toBe('settings.localTranslation.trialError');
        for (const [message, suffix] of [['LOCAL_TRANSLATION_NOT_DOWNLOADED', 'notDownloaded'], ['LOCAL_TRANSLATION_LANGUAGE_UNSUPPORTED', 'language'], ['LOCAL_TRANSLATION_EMPTY', 'repetition'], ['LOCAL_TRANSLATION_TIMEOUT', 'timeout'], ['LOCAL_TRANSLATION_BROWSER_UNSUPPORTED', 'browser']]) {
            expect(localTranslationErrorKey(message)).toBe('settings.localTranslation.error.' + suffix);
        }
    });
    it('preserves explicit large share-card type size through serialized preferences', () => {
        const saved = normalizeShareCardPreferences({fontSize: 'large', theme: 'linen', showSource: false});
        expect(normalizeShareCardPreferences(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
        expect(saved).toMatchObject({fontSize: 'large', theme: 'linen', showSource: false});
    });
    it('preserves ordinary cloud settings deletion, atomic connections and immutable resolution', () => {
        const local = {on: true, display: 0, from: 'en', to: 'zh-Hans', theme: 'dark', token: {openai: 'synthetic-key'}, custom: 'https://controlled.test/v1'};
        const basic = projectDriveSyncConfig(local); expect(basic).not.toHaveProperty('token');
        const snapshot = parseDriveSyncSnapshot(driveSyncPayload(local)); expect(snapshot.includesSensitive).toBe(false);
        const restored = restoreDriveSyncSettings(local, {on: true, display: 0, from: 'en', to: 'fr'});
        expect(restored.token).toEqual(local.token); expect(restored).not.toHaveProperty('theme');
        const diff = buildDriveSyncDiff(local, local, {...local, token: {}, custom: 'https://second-controlled.test/v1'});
        const resolved = resolveDriveSyncDiff(diff, {}); expect(resolved.token).toEqual({}); expect(local.token).toEqual({openai: 'synthetic-key'});
        expect(JSON.stringify(diff.changes)).not.toContain('synthetic-key');
    });
    it('retains strong ETag boundaries including obs-text and rejects weak/malformed values', () => {
        expect(strongCloudEtag('"\u0080\u00ff"')).toBe('"\u0080\u00ff"'); expect(strongCloudEtag('""')).toBe('""');
        for (const tag of [undefined, null, '', 'W/"weak"', '"\n"', '"a"b"', '"' + 'x'.repeat(511) + '"']) expect(strongCloudEtag(tag)).toBeUndefined();
    });
    it('rejects IDN expansion beyond the supported hostname length before installing browser rules', async () => {
        const domain = Array(5).fill('é'.repeat(44)).join('.');
        expect(domain.length).toBe(224); expect(new URL(`https://${domain}`).hostname.length).toBe(254);
        expect(normalizeRequestHeaderDomain(domain)).toBeNull();
        expect(normalizeRequestHeaderRules([{domain, removeOrigin: true}])).toEqual([]);
        const updateDynamicRules = vi.fn(async () => {});
        const synchronizer = createRequestHeaderRulesSynchronizer({getDynamicRules: async () => [], updateDynamicRules}, 'fixture-extension');
        await synchronizer.sync([{domain, removeOrigin: true}]); expect(updateDynamicRules).not.toHaveBeenCalled();
        expect(normalizeRequestHeaderDomain('例子.测试')).toBe(new URL('https://例子.测试').hostname);
    });
    it('bounds CSS work, rejects external ports and confines declarations to owned translation/highlight selectors', () => {
        const parsed = parseTranslationCustomCss('color:red; background:url(https://controlled.test/image);position:fixed;color:blue');
        expect(parsed).toEqual({declarations: [{property: 'color', value: 'red'}, {property: 'color', value: 'blue'}], invalidCount: 2});
        expect(parseTranslationCustomCss('color:red;'.repeat(1000)).declarations).toHaveLength(24);
        expect(buildTranslationAppearanceCss({customCss: 'color: blue'})).toContain('[data-fr-translation-owned="true"]');
        expect(buildSentenceHighlightAppearanceCss('rose', {lineStyle: 'none', customCss: 'background: #123456'})).toContain('background-color: #123456 !important');
    });
});

/**
 * Actual mounted VocabularyBook + CollectionEntry client templates, actual
 * message router/selection TTS handlers and strategy synthesizer. Only DOM,
 * storage/config, decorative controls and provider/audio boundaries are ports.
 * The options sender has a real extension-page URL and deliberately no tab.
 * Default imports consume repository production; apply the separate candidate
 * handler patch for the after run. No business method or private state is copied.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseHTML} from 'linkedom';
import {compileScript, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import * as Vue from 'vue';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {normalizeConfig} from '@/src/core/config/model';
import * as learning from '@/src/features/vocabulary/learningModel';
import * as vocabularySource from '@/src/features/vocabulary/source';
import * as i18n from '@/src/core/i18n';
import * as result from '@/src/core/translation/result';
import * as speech from '@/src/features/selection-translation/speech/public';
import {createSelectionTtsSynthesizer} from '@/src/features/selection-translation/background/selectionTtsSynthesis';
import {createSelectionTtsBackgroundHandlers, type SelectionTtsContext} from '@/src/features/selection-translation/background/ttsHandler';
import {createBackgroundMessageRouter, createBackgroundRuntimeMessageListener} from '@/src/app/background/messageRouter';
import type {LocalTtsAudio} from '@/src/features/local-tts/protocol';

function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}
const audio = (): LocalTtsAudio => ({audio: new Uint8Array([1, 2]).buffer, contentType: 'audio/wav', voice: 'af_heart', backend: 'wasm'});
type Sender = {url: string; tab?: {id: number}};
const optionsSender = (): Sender => ({url: 'chrome-extension://controlled-extension/options.html#settings-vocabulary'});
const apps: Vue.App[] = [];
const pending: Array<ReturnType<typeof deferred<LocalTtsAudio>>> = [];
async function settle() {for (let i = 0; i < 20; i++) {await Promise.resolve(); await Vue.nextTick();}}
afterEach(async () => {
    for (const app of apps.splice(0)) app.unmount();
    for (const task of pending.splice(0)) task.resolve(audio());
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

function runtime(honorAbort = true) {
    vi.useFakeTimers();
    const jobs: Array<{text: string; signal?: AbortSignal; task: ReturnType<typeof deferred<LocalTtsAudio>>}> = [];
    const online = vi.fn(async () => {throw new Error('Local-only case must not call an online provider');});
    const local = vi.fn((text: string, _language: string, _voice: string, signal?: AbortSignal) => {
        const task = deferred<LocalTtsAudio>(); pending.push(task); jobs.push({text, signal, task});
        const onAbort = () => {if (honorAbort) task.reject(new DOMException('cancelled', 'AbortError'));};
        signal?.addEventListener('abort', onAbort, {once: true});
        if (signal?.aborted) onAbort();
        return task.promise.finally(() => signal?.removeEventListener('abort', onAbort));
    });
    const synthesize = createSelectionTtsSynthesizer({getMode: () => 'local-only', getLocalVoice: () => 'af_heart',
        getOnlineVoices: () => [], synthesizeOnline: online, synthesizeLocal: local});
    const play = vi.fn(async () => {}), stop = vi.fn(async () => {}), notify = vi.fn(async () => {});
    const handlers = createSelectionTtsBackgroundHandlers({getPreferredVoices: () => [], synthesize,
        playWithOffscreen: play, stopWithOffscreen: stop, seekWithOffscreen: async () => {throw Error('Unexpected seek in vocabulary cancellation fixture');}, sendTabMessage: notify});
    const router = createBackgroundMessageRouter(handlers);
    // Same public context construction as installBackgroundMessageRuntime.
    const dispatch = createBackgroundRuntimeMessageListener(router, sender => ({sender: sender as SelectionTtsContext['sender']}));
    return {jobs, online, local, play, stop, notify, dispatch};
}

async function mountBook(honorAbort = true) {
    const rt = runtime(honorAbort), sender = optionsSender();
    expect(Object.hasOwn(sender, 'tab')).toBe(false);
    const {window, document} = parseHTML('<html><head></head><body><div id="mount"></div></body></html>');
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'});
    const browserSpeech = vi.fn(), audioPlay = vi.fn(async () => {});
    Object.assign(window, {matchMedia: () => ({matches: false, addEventListener() {}, removeEventListener() {}}),
        speechSynthesis: {getVoices: () => [], speak: browserSpeech, cancel: vi.fn()}});
    vi.stubGlobal('__VUE_DEVTOOLS_GLOBAL_HOOK__', {enabled: true, emit() {}});
    vi.stubGlobal('window', window); vi.stubGlobal('document', document);
    for (const key of ['Node', 'Element', 'HTMLElement', 'SVGElement'] as const) vi.stubGlobal(key, window[key]);
    vi.stubGlobal('crypto', {randomUUID});
    vi.stubGlobal('Audio', class {onended: unknown; onerror: unknown; play = audioPlay; pause() {} removeAttribute() {}});
    vi.stubGlobal('SpeechSynthesisUtterance', class {lang = ''; voice: unknown; onend: unknown; onerror: unknown; constructor(readonly text: string) {}});
    const listeners = new Set<unknown>();
    const traffic: Array<{message: any; sender: Sender; response?: any}> = [];
    const entry: learning.VocabularyEntry = {id: 'saved-a', term: 'art', normalizedTerm: 'art', identityKey: 'en:art', sourceLanguage: 'en', kind: 'expression',
        translations: {'zh-cn': {text: '艺术', updatedAt: 1}}, contexts: [], note: '', phonetic: '', partOfSpeech: '',
        createdAt: 1, updatedAt: 1, lastSeenAt: 1, encounterCount: 1, masteryLevel: 0, status: 'new', nextReviewAt: 1,
        lastReviewedAt: null, reviewCount: 0, lapseCount: 0, schemaVersion: 1};
    const browser = {runtime: {
        sendMessage: async (message: any) => {
            if (message.type === learning.VOCABULARY_BOOK_MESSAGE && message.action === 'list') return {success: true, data: [structuredClone(entry)]};
            const row = {message, sender: {...sender}} as typeof traffic[number]; traffic.push(row);
            row.response = await rt.dispatch(message, row.sender);
            return row.response;
        },
        onMessage: {addListener: (fn: unknown) => listeners.add(fn), removeListener: (fn: unknown) => listeners.delete(fn)},
    }};
    const config = normalizeConfig({theme: 'light', uiLanguage: 'zh-CN', vocabularyBookEnabled: true, selectionTtsMode: 'local-only'});
    const Slot = Vue.defineComponent({inheritAttrs: false, setup: (_, {attrs, slots}) => () => Vue.h('div', attrs, slots.default?.())});
    const Inactive = Vue.defineComponent({setup() {throw new Error('Unrequested review/study/editor path mounted');}});
    const modules: Record<string, any> = {
        vue: Vue, 'webextension-polyfill': {default: browser}, 'element-plus': {ElOption: Slot, ElMessageBox: {confirm: vi.fn()}},
        '@/src/ui/components/UiIcon.vue': {default: Slot}, '@/src/ui/components/FeatureEnableCard.vue': {default: Slot},
        '@/src/ui/components/UiSelect.vue': {default: Slot}, '@/src/ui/interfaceAppearance': {applyInterfaceTheme: vi.fn()},
        './VocabularyStudy.vue': {default: Inactive}, './SavedExplanation.vue': {default: Inactive},
        '@/src/features/reading-assistant/ui/answer/public': {ReadingAnswer: Inactive}, '@/src/core/i18n': i18n,
        '@/src/platform/browser/capabilities': {browserCapabilities: {browser: 'chrome'}},
        '@/src/features/selection-translation/speech/public': speech,
        '@/src/services/config/store': {config, configReady: Promise.resolve(), requestConfigPatch: vi.fn(), subscribeConfig: () => () => {}},
        '@/src/features/vocabulary/learningModel': learning, '../learningModel': learning, '../source': vocabularySource, '@/src/core/translation/result': result,
        '@/src/ui/i18n': {useUiI18n: () => ({t: (key: string) => key, translateLegacy: (text: string) => text})},
    };
    function loadClient(relative: string): Vue.Component {
        const filename = resolve(process.cwd(), relative), {descriptor, errors} = parse(readFileSync(filename, 'utf8'), {filename});
        expect(errors).toEqual([]);
        const script = compileScript(descriptor, {id: relative, inlineTemplate: true});
        const code = ts.transpileModule(script.content, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
        const module = {exports: {} as {default: Vue.Component}};
        new Function('require', 'exports', 'module', code)((id: string) => {
            if (!Object.hasOwn(modules, id)) throw new Error(`Unconfigured client dependency: ${id}`);
            return modules[id];
        }, module.exports, module);
        return module.exports.default;
    }
    modules['./VocabularySource.vue'] = {default: loadClient('src/features/vocabulary/ui/VocabularySource.vue')};
    modules['./CollectionEntry.vue'] = {default: loadClient('src/features/vocabulary/ui/CollectionEntry.vue')};
    const component = loadClient('src/features/vocabulary/ui/VocabularyBook.vue');
    const events = new WeakMap<Element, Record<string, any>>();
    const renderer = Vue.createRenderer<any, any>({createElement: tag => Vue.markRaw(document.createElement(tag)), createText: text => document.createTextNode(text),
        createComment: text => document.createComment(text), insert: (node, parent, anchor) => parent.insertBefore(node, anchor || null), remove: node => node.remove(),
        setText: (node, text) => {node.nodeValue = text;}, setElementText: (node, text) => {node.textContent = text;},
        parentNode: node => node.parentNode, nextSibling: node => node.nextSibling, setScopeId: (node, id) => node.setAttribute(id, ''),
        patchProp(node, key, _old, value) {
            if (key.startsWith('on')) {const saved = events.get(node) || {}; saved[key] = value; events.set(node, saved);}
            else if (key === 'style') Object.assign(node.style, value || {});
            else if (key.startsWith('aria-') && value != null) node.setAttribute(key, String(value));
            else if (value === false || value == null) node.removeAttribute(key);
            else node.setAttribute(key, value === true ? '' : String(value));
        },
        insertStaticContent(html, parent, anchor) {const box = document.createElement('div'); box.innerHTML = html; const first = box.firstChild!, last = box.lastChild!;
            while (box.firstChild) parent.insertBefore(box.firstChild, anchor || null); return [first, last];},
    });
    const app = renderer.createApp(component); apps.push(app); app.mount(document.querySelector('#mount')!); await settle();
    function clickSpeech() {
        const button = document.querySelector('.entry-actions button.entry-icon'); expect(button).toBeTruthy();
        const callback = events.get(button!)?.onClick; expect(callback).toBeTypeOf('function');
        callback({target: button, currentTarget: button, stopPropagation() {}, preventDefault() {}});
    }
    function unmount() {app.unmount(); apps.splice(apps.indexOf(app), 1);}
    return {...rt, sender, document, listeners, traffic, clickSpeech, unmount, browserSpeech, audioPlay};
}

describe('vocabulary extension-page TTS cancellation through public runtime', () => {
    it('passes the no-tab options owner signal into real synthesis and aborts on the rendered second click', async () => {
        const ctx = await mountBook(); ctx.clickSpeech(); await settle();
        expect(ctx.jobs).toHaveLength(1); expect(ctx.jobs[0].signal).toBeInstanceOf(AbortSignal);
        expect(ctx.document.querySelector('.entry-actions button.entry-icon')?.getAttribute('aria-label')).toBe('停止朗读');
        ctx.clickSpeech(); await settle();
        expect(ctx.jobs[0].signal?.aborted).toBe(true);
        expect(ctx.traffic.find(row => row.message.type === 'selectionTts')?.sender).toEqual(optionsSender());
        expect(ctx.traffic.find(row => row.message.type === 'selectionTtsStop')?.sender).toEqual(optionsSender());
        expect(ctx.document.querySelector('.entry-actions button.entry-icon')?.getAttribute('aria-label')).toBe('朗读原文');
        expect(ctx.online).not.toHaveBeenCalled(); expect(ctx.play).not.toHaveBeenCalled(); expect(ctx.stop).not.toHaveBeenCalled();
        expect(ctx.audioPlay).not.toHaveBeenCalled(); expect(ctx.browserSpeech).not.toHaveBeenCalled();
    });
    it('aborts on public unmount after hash navigation and rejects delayed adapter success without playback', async () => {
        const ctx = await mountBook(false); ctx.clickSpeech(); await settle();
        expect(ctx.jobs).toHaveLength(1); expect(ctx.jobs[0].signal).toBeInstanceOf(AbortSignal);
        ctx.sender.url = 'chrome-extension://controlled-extension/options.html#settings-services';
        ctx.unmount(); await settle();
        expect(ctx.jobs[0].signal?.aborted).toBe(true); expect(ctx.listeners.size).toBe(0);
        ctx.jobs[0].task.resolve(audio()); await settle();
        expect(ctx.traffic.find(row => row.message.type === 'selectionTts')?.response).toMatchObject({success: false});
        expect(ctx.audioPlay).not.toHaveBeenCalled(); expect(ctx.browserSpeech).not.toHaveBeenCalled();
        expect(ctx.online).not.toHaveBeenCalled(); expect(ctx.play).not.toHaveBeenCalled();
    });
    it('isolates URL and UUID owners from content, wrong-page STOP and no-tab Google fallback', async () => {
        const rt = runtime(false), first = optionsSender(), other = {url: 'chrome-extension://controlled-extension/options.html?view=another'};
        const id = randomUUID(), nextId = randomUUID(), content = {url: 'https://controlled.example/', tab: {id: 8}};
        const start = (sender: Sender, text: string, clientRequestId = id) => rt.dispatch({type: 'selectionTts', text, language: 'en-US', clientRequestId}, sender);
        const contentResult = start(content, 'content'); await settle();
        const pageResult = start(first, 'page'); await settle();
        const nextResult = start(first, 'next page', nextId); await settle();
        expect(rt.jobs).toHaveLength(3); rt.jobs.forEach(job => expect(job.signal).toBeInstanceOf(AbortSignal));
        expect(rt.jobs[0].signal?.aborted).toBe(false);
        await rt.dispatch({type: 'selectionTtsStop', clientRequestId: id}, other);
        await rt.dispatch({type: 'selectionTtsStop', clientRequestId: randomUUID()}, first);
        expect(rt.jobs[1].signal?.aborted).toBe(false); expect(rt.jobs[2].signal?.aborted).toBe(false);
        await rt.dispatch({type: 'selectionTtsGoogle', text: 'unused', clientRequestId: id}, first);
        expect(rt.jobs[0].signal?.aborted).toBe(false); expect(rt.stop).not.toHaveBeenCalled();
        await rt.dispatch({type: 'selectionTtsStop', clientRequestId: id}, first);
        expect(rt.jobs[1].signal?.aborted).toBe(true); expect(rt.jobs[0].signal?.aborted).toBe(false); expect(rt.jobs[2].signal?.aborted).toBe(false);
        rt.jobs.forEach(job => job.task.resolve(audio()));
        expect(await pageResult).toMatchObject({success: false});
        expect(await nextResult).toMatchObject({success: true, transport: 'page'});
        expect(await contentResult).toMatchObject({success: true, transport: 'offscreen'});
        expect(rt.play).toHaveBeenCalledOnce(); expect(rt.stop).not.toHaveBeenCalled(); expect(rt.online).not.toHaveBeenCalled();
    });
    it('honors STOP between public dispatch and provider entry without starting local synthesis', async () => {
        const rt = runtime(), sender = optionsSender(), id = randomUUID();
        const request = rt.dispatch({type: 'selectionTts', text: 'art', language: 'en-US', clientRequestId: id}, sender);
        await rt.dispatch({type: 'selectionTtsStop', clientRequestId: id}, sender);
        await settle(); expect(rt.local).not.toHaveBeenCalled();
        expect(await request).toMatchObject({success: false}); expect(rt.online).not.toHaveBeenCalled();
    });
});

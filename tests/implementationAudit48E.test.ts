/**
 * @file tests/implementationAudit48E.test.ts
 * 文件职责：通过真实划词公共入口与客户端模板验证第 48 组 E 的异步所有权、回退和分段边界。
 * 主要内容：受控合成与浏览器端口、真实 Vue 客户端渲染、按钮交互及 UTF-8/操作数探针。
 * 模块边界：不复制业务逻辑、不访问组件私有 setup，不连接真实账号或外部网络。
 */
import {parseHTML} from 'linkedom';
import {createRenderer, h, markRaw, nextTick, type App} from 'vue';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {splitEdgeTtsText, edgeTtsLimits, edgeTtsVoiceCandidatesForLanguage, edgeTtsTokenExpiry} from '@/src/features/selection-translation/services/edgeTtsPolicy';
import {normalizeSpeechLanguage} from '@/src/features/selection-translation/core';
import {createSelectionTtsSynthesizer} from '@/src/features/selection-translation/background/selectionTtsSynthesis';
import {createSelectionTtsBackgroundHandlers, type SelectionTtsBackgroundDependencies} from '@/src/features/selection-translation/background/ttsHandler';
import {translateSelectionFromContextMenu} from '@/src/features/selection-translation/content/contextMenuBridge';
import component from '@/src/features/selection-translation/ui/SelectionTranslator.vue';
import {mountSelectionTranslator, unmountSelectionTranslator} from '@/src/features/selection-translation/content/runtime';

const ports = vi.hoisted(() => ({
    config: {} as Record<string, any>,
    listeners: new Set<(message: unknown) => unknown>(),
    subscriptions: new Set<() => void>(),
    send: vi.fn(), translate: vi.fn(), speech: vi.fn(), cancel: vi.fn(), shadow: vi.fn(), fetch: vi.fn(),
}));
vi.mock('webextension-polyfill', () => ({default: {
    runtime: {getURL: (path: string) => path, sendMessage: ports.send, onMessage: {
        addListener: (fn: (message: unknown) => unknown) => ports.listeners.add(fn),
        removeListener: (fn: (message: unknown) => unknown) => ports.listeners.delete(fn),
    }}, extension: {inIncognitoContext: false},
}}));
vi.mock('@/src/services/config/store', () => ({config: ports.config,
    subscribeConfig: (fn: () => void) => {ports.subscriptions.add(fn); return () => ports.subscriptions.delete(fn);},
}));
vi.mock('@/src/services/translation/client', () => ({translateText: ports.translate, translateTextBatch: ports.translate}));
vi.mock('@/src/platform/shadow-ui', () => ({createVueShadowUi: ports.shadow}));
vi.mock('@/src/platform/http/runtime', async original => ({...await original<typeof import('@/src/platform/http/runtime')>(), runtimeFetch: ports.fetch}));
vi.mock('@/src/features/share-card/public', () => ({isShareCardMounted: () => false, openShareCard: vi.fn()}));
vi.mock('@/src/features/reading-assistant/public', async original => ({
    ...await original<typeof import('@/src/features/reading-assistant/public')>(),
    captureReadingSelection: (_range: Range, text: string) => ({text, context: '', fingerprint: text}),
}));
vi.mock('@/src/features/reading-assistant/ui/panel/public', () => ({
    ReadingPanel: {props: ['sourceLanguage', 'targetLanguage'], render(this: any) {
        return h('div', {'data-reading-source': this.sourceLanguage, 'data-reading-target': this.targetLanguage});
    }},
}));
vi.mock('@/src/ui/i18n', () => ({useUiI18n: () => ({t: (key: string) => key, translateLegacy: (value: string) => value})}));

function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}
const audioResult = () => ({audio: new Uint8Array([1, 2, 3]).buffer, contentType: 'audio/wav' as const, voice: 'test'});
async function settle() {for (let i = 0; i < 8; i++) {await Promise.resolve(); await nextTick();}}
let app: App | undefined;
afterEach(async () => {
    app?.unmount(); app = undefined; await settle();
    unmountSelectionTranslator();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('mount runtime ownership public entry', () => {
    it('allows immediate remount and keeps the new pending promise after the old one settles', async () => {
        Object.assign(ports.config, {disableSelectionTranslator: false, selectionTranslatorMode: 'bilingual'});
        const first = deferred<any>(), second = deferred<any>();
        const oldUi = {remove: vi.fn(), mounted: {instance: {id: 'old'}}};
        const newUi = {remove: vi.fn(), mounted: {instance: {id: 'new'}}};
        ports.shadow.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const oldRequest = mountSelectionTranslator({} as never);
        unmountSelectionTranslator();
        const newRequest = mountSelectionTranslator({} as never);
        expect(ports.shadow).toHaveBeenCalledTimes(2);
        first.resolve(oldUi); expect(await oldRequest).toBeNull();
        expect(oldUi.remove).toHaveBeenCalledOnce();
        expect(mountSelectionTranslator()).toBe(newRequest);
        second.resolve(newUi); expect(await newRequest).toEqual({id: 'new'});
        unmountSelectionTranslator(); expect(newUi.remove).toHaveBeenCalledOnce();
    });
});

describe('Edge endpoint controlled HTTP boundary', () => {
    it.each([{t: 'token', r: 'untrusted.invalid/path'}, {t: 123, r: 'eastus'}, {t: 'token', r: 123}, null])(
        'rejects malformed endpoint data %j before sending speech or caching it', async payload => {
            vi.resetModules();
            ports.fetch.mockReset().mockImplementation(async () => new Response(JSON.stringify(payload), {headers: {'Content-Type': 'application/json'}}));
            const {synthesizeEdgeTts} = await import('@/src/features/selection-translation/services/edgeTts');
            await expect(synthesizeEdgeTts('hello', 'en-US')).rejects.toThrow('Edge TTS endpoint returned an invalid token');
            expect(ports.fetch).toHaveBeenCalledOnce();
        },
    );
    it('rejects empty and unsupported requests before touching the network and handles absent DOMException', async () => {
        vi.resetModules(); ports.fetch.mockReset();
        const {synthesizeEdgeTts} = await import('@/src/features/selection-translation/services/edgeTts');
        await expect(synthesizeEdgeTts(' ', 'en-US')).rejects.toThrow('文本为空');
        await expect(synthesizeEdgeTts('Hello', 'xx-XX')).rejects.toThrow('unavailable for this language');
        const controller = new AbortController(); controller.abort(); vi.stubGlobal('DOMException', undefined);
        await expect(synthesizeEdgeTts('Hello', 'en-US', [], controller.signal)).rejects.toMatchObject({name:'AbortError'});
        expect(ports.fetch).not.toHaveBeenCalled();
    });
    it('releases a failed endpoint response and supports signing without randomUUID', async () => {
        vi.resetModules();
        vi.stubGlobal('crypto', {subtle:globalThis.crypto.subtle});
        const cancel = vi.fn(async () => {});
        ports.fetch.mockReset().mockResolvedValue({ok:false, status:503, body:{cancel}});
        const {synthesizeEdgeTts} = await import('@/src/features/selection-translation/services/edgeTts');
        await expect(synthesizeEdgeTts('Hello', 'en-US')).rejects.toThrow('endpoint failed: 503');
        expect(cancel).toHaveBeenCalledOnce();
    });
    it('reports all unavailable voices while allowing non-Error provider failures', async () => {
        vi.resetModules();
        ports.fetch.mockReset().mockResolvedValueOnce(new Response(JSON.stringify({t:'token',r:'eastus'})))
            .mockRejectedValueOnce('connection dropped').mockRejectedValue(new Error('service unavailable'));
        const {synthesizeEdgeTts} = await import('@/src/features/selection-translation/services/edgeTts');
        await expect(synthesizeEdgeTts('Hello', 'en-US')).rejects.toThrow('音色均不可用');
        expect(ports.fetch).toHaveBeenCalledTimes(5);
    });
    it('keeps a valid token and the controlled audio byte order', async () => {
        vi.resetModules();
        ports.fetch.mockReset().mockImplementation(async (url: string) => url.includes('/apps/endpoint')
            ? new Response(JSON.stringify({t: 'token', r: 'eastus'}), {headers: {'Content-Type': 'application/json'}})
            : new Response(new Uint8Array([4, 5, 6])));
        const {synthesizeEdgeTts} = await import('@/src/features/selection-translation/services/edgeTts');
        expect(new Uint8Array((await synthesizeEdgeTts('hello', 'en-US')).audio)).toEqual(new Uint8Array([4, 5, 6]));
        expect(ports.fetch.mock.calls[1][0]).toBe('https://eastus.tts.speech.microsoft.com/cognitiveservices/v1');
    });
});

describe('UTF-8 split public policy', () => {
    it.each(['1e999', '1e308'])('uses a bounded lifetime for an overflowing JWT expiry %s', exp => {
        const token = `header.${btoa(`{"exp":${exp}}`)}.signature`;
        expect(edgeTtsTokenExpiry(token, 1000)).toBe(1000 + edgeTtsLimits.fallbackTokenLifetimeMs);
    });
    it.each(['constructor', '__proto__'])('treats inherited property %s as an unsupported language', value => {
        expect(normalizeSpeechLanguage(value)).toBe('en-US');
    });
    it.each(['constructor', '__proto__'])('never spreads inherited property %s as voice candidates', value => {
        expect(edgeTtsVoiceCandidatesForLanguage(value)).toEqual([]);
    });
    it.each(['.', '。'])('does not include a %s immediately beyond the byte budget', punctuation => {
        const input = 'a'.repeat(1800) + punctuation + 'tail';
        const chunks = splitEdgeTtsText(input);
        expect(chunks.join('')).toBe(input);
        expect(chunks.every(chunk => new TextEncoder().encode(chunk).byteLength <= edgeTtsLimits.chunkBytes)).toBe(true);
    });
    it('keeps astral code points intact at the byte boundary', () => {
        const input = 'a'.repeat(1797) + '😀' + 'b'.repeat(10);
        const chunks = splitEdgeTtsText(input);
        expect(chunks.join('')).toBe(input);
        for (const chunk of chunks) {
            expect(new TextDecoder().decode(new TextEncoder().encode(chunk))).toBe(chunk);
            expect(new TextEncoder().encode(chunk).byteLength).toBeLessThanOrEqual(1800);
        }
    });
    it('rejects a ninth final chunk', () => {
        expect(() => splitEdgeTtsText('x'.repeat(1800 * 8 + 1))).toThrow('Edge TTS text is too long');
    });
    it('preserves the exact eight-chunk limit and empty input', () => {
        expect(splitEdgeTtsText('x'.repeat(1800 * 8))).toEqual(Array(8).fill('x'.repeat(1800)));
        expect(splitEdgeTtsText(' \n ')).toEqual([]);
    });
    it('bounds encoding work while keeping the established CJK output', () => {
        const encode = vi.spyOn(TextEncoder.prototype, 'encode');
        const chunks = splitEdgeTtsText('中'.repeat(2400));
        expect(chunks).toEqual(Array(4).fill('中'.repeat(600)));
        expect(encode.mock.calls.length).toBeLessThanOrEqual(4);
    });
});

describe('synthesis cancellation public factory', () => {
    it.each(['online-first', 'local-first', 'online-only', 'local-only'])('never starts providers with an aborted %s request', async mode => {
        const controller = new AbortController(); controller.abort();
        const online = vi.fn(async () => audioResult()), local = vi.fn(async () => audioResult());
        const synthesize = createSelectionTtsSynthesizer({getMode: () => mode, getLocalVoice: () => 'auto',
            getOnlineVoices: () => [], synthesizeOnline: online, synthesizeLocal: local});
        await expect(synthesize('hello', 'en-US', [], controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(online).not.toHaveBeenCalled(); expect(local).not.toHaveBeenCalled();
    });
    it.each(['online-first', 'local-first'])('never starts fallback after an in-flight %s abort', async mode => {
        const controller = new AbortController(), pending = deferred<ReturnType<typeof audioResult>>();
        const first = vi.fn(() => pending.promise), fallback = vi.fn(async () => audioResult());
        const synthesize = createSelectionTtsSynthesizer({getMode: () => mode, getLocalVoice: () => 'auto', getOnlineVoices: () => [],
            synthesizeOnline: mode === 'online-first' ? first : fallback, synthesizeLocal: mode === 'local-first' ? first : fallback});
        const request = synthesize('hello', 'en-US', [], controller.signal);
        controller.abort(); pending.reject(new DOMException('cancel', 'AbortError'));
        await expect(request).rejects.toMatchObject({name: 'AbortError'});
        expect(first).toHaveBeenCalledOnce(); expect(fallback).not.toHaveBeenCalled();
    });
    it.each(['online-first', 'local-first'])('keeps the useful %s fallback for ordinary source failure', async mode => {
        const first = vi.fn(async () => {throw new Error('unavailable');}), fallback = vi.fn(async () => audioResult());
        const synthesize = createSelectionTtsSynthesizer({getMode: () => mode, getLocalVoice: () => 'auto', getOnlineVoices: () => [],
            synthesizeOnline: mode === 'online-first' ? first : fallback, synthesizeLocal: mode === 'local-first' ? first : fallback});
        expect(await synthesize('hello', 'en-US', [])).toEqual(audioResult());
        expect(fallback).toHaveBeenCalledOnce();
    });
});

describe('background request ownership through public handlers', () => {
    function subject(overrides: Partial<SelectionTtsBackgroundDependencies> = {}) {
        const dependencies = {getPreferredVoices: () => [], synthesize: vi.fn(async () => audioResult()),
            playWithOffscreen: vi.fn(async () => {}), stopWithOffscreen: vi.fn(async () => {}), seekWithOffscreen: vi.fn(async () => {throw Error('Unexpected seek in background ownership fixture');}), sendTabMessage: vi.fn(async () => {}), ...overrides};
        const handlers = createSelectionTtsBackgroundHandlers(dependencies);
        const dispatch = (type: string, id: string) => handlers.find(handler => handler.type === type)!.handle(
            {type, text: id, language: 'en-US', clientRequestId: id} as any, {sender: {tab: {id: 1}}});
        return {dependencies, dispatch};
    }
    it.each(['selectionTts', 'selectionTtsGoogle'])('a waiting %s cannot replace a newer playback', async type => {
        const stopped = deferred<void>();
        const {dependencies, dispatch} = subject({stopWithOffscreen: vi.fn(() => stopped.promise)});
        await dispatch('selectionTts', 'original');
        const stale = dispatch(type, 'stale');
        const latest = dispatch('selectionTts', 'latest');
        await settle();
        expect(dependencies.playWithOffscreen).toHaveBeenCalledTimes(2);
        stopped.resolve();
        await latest;
        expect(await stale).toMatchObject({success: false});
        expect(dependencies.playWithOffscreen).toHaveBeenCalledTimes(2);
        expect(vi.mocked(dependencies.playWithOffscreen).mock.calls[1][0]).toMatchObject({clientRequestId: 'latest'});
    });
    it.each(['selectionTts', 'selectionTtsGoogle'])('STOP invalidates a %s still waiting for the prior STOP', async type => {
        const stopped = deferred<void>();
        const {dependencies, dispatch} = subject({stopWithOffscreen: vi.fn(() => stopped.promise)});
        await dispatch('selectionTts', 'original');
        const pending = dispatch(type, 'pending');
        const stop = dispatch('selectionTtsStop', 'pending');
        stopped.resolve(); await stop;
        expect(await pending).toMatchObject({success: false});
        expect(dependencies.playWithOffscreen).toHaveBeenCalledOnce();
    });
});

describe('SelectionTranslator actual client template', () => {
    const handlers = new WeakMap<Element, Record<string, any>>();
    let doc: Document;
    let speechUtterances: any[];
    async function mount(text = 'hello', presentation = 'card', openContextMenu = true) {
        const parsed = parseHTML('<html><body><p id="source"></p><div id="mount"></div></body></html>');
        doc = parsed.document as unknown as Document;
        const window = parsed.window;
        vi.stubGlobal('__VUE_DEVTOOLS_GLOBAL_HOOK__', {enabled: true, emit() {}});
        vi.stubGlobal('document', doc); vi.stubGlobal('window', window);
        for (const key of ['Node', 'Element', 'HTMLElement'] as const) vi.stubGlobal(key, window[key]);
        Object.assign(window, {innerWidth: 1000, innerHeight: 800,
            matchMedia: () => ({matches: false, addEventListener() {}, removeEventListener() {}}),
            requestAnimationFrame: (fn: () => void) => setTimeout(fn, 16), cancelAnimationFrame: clearTimeout,
            speechSynthesis: {getVoices: () => [], speak: ports.speech, cancel: ports.cancel}});
        speechUtterances = [];
        vi.stubGlobal('SpeechSynthesisUtterance', class {lang = ''; voice = null; onend: any; onerror: any;
            constructor(readonly text: string) {speechUtterances.push(this);}});
        doc.querySelector('#source')!.textContent = text;
        const node = doc.querySelector('#source')!.firstChild!;
        const rect = {top: 100, bottom: 120, left: 100, right: 160, width: 60, height: 20};
        // 原生 Range 不会被 Vue 代理；受控端口也保持相同节点身份。
        const range = markRaw({startContainer: node, endContainer: node, commonAncestorContainer: node, startOffset: 0, endOffset: text.length,
            cloneRange() {return this;}, getClientRects: () => [rect], getBoundingClientRect: () => rect});
        window.getSelection = () => ({rangeCount: 1, isCollapsed: false, getRangeAt: () => range,
            anchorNode: node, anchorOffset: 0, containsNode: () => false, toString: () => text}) as unknown as Selection;
        window.HTMLElement.prototype.getBoundingClientRect = () => ({...rect, width: 388, height: 200}) as DOMRect;
        const renderer = createRenderer<any, any>({
            createElement: tag => markRaw(doc.createElement(tag)), createText: text => doc.createTextNode(text), createComment: text => doc.createComment(text),
            insert: (node, parent, anchor) => parent.insertBefore(node, anchor || null), remove: node => node.remove(),
            setText: (node, text) => {node.nodeValue = text;}, setElementText: (node, text) => {node.textContent = text;},
            parentNode: node => node.parentNode, nextSibling: node => node.nextSibling, setScopeId: (node, id) => node.setAttribute(id, ''),
            patchProp: (node, key, _old, value) => {
                if (key.startsWith('on')) {const saved = handlers.get(node) || {}; saved[key] = value; handlers.set(node, saved);}
                else if (key === 'style') Object.assign(node.style, value || {});
                // ARIA boolean values are string attributes in the real client
                // DOM, unlike disabled/other boolean HTML attributes.
                else if (key.startsWith('aria-') && value != null) node.setAttribute(key, String(value));
                else if (value === false || value == null) node.removeAttribute(key);
                else node.setAttribute(key, value === true ? '' : String(value));
            },
            insertStaticContent: (html, parent, anchor) => {const box = doc.createElement('div'); box.innerHTML = html;
                const first = box.firstChild!, last = box.lastChild!; while (box.firstChild) parent.insertBefore(box.firstChild, anchor || null); return [first, last];},
        });
        ports.config.selectionTranslatorPresentation = presentation;
        app = renderer.createApp(component); app.directive('ui-i18n', {});
        app.mount(doc.querySelector('#mount')); await settle();
        expect((component as any).render).toBeTypeOf('function');
        if (openContextMenu) {
            expect(translateSelectionFromContextMenu()).toBe(true); await settle();
            expect(doc.querySelector('.fr-translation-tooltip')).not.toBeNull();
        }
    }
    function click(selector: string, label?: string) {
        const target = (label === undefined ? doc.querySelector(selector)
            : Array.from(doc.querySelectorAll(selector)).find(node => node.textContent?.trim() === label) ?? null)!;
        expect(target).not.toBeNull();
        const event = {target, currentTarget: target, stopPropagation() {}, preventDefault() {}};
        const fn = handlers.get(target)?.onClick;
        expect(fn).toBeTypeOf('function'); fn(event);
    }
    function expectPlayingStatus(state: 'playing' | 'idle') {
        const status = doc.querySelector('.fr-playing-status');
        expect(status).not.toBeNull();
        expect(status!.classList.contains('is-idle')).toBe(state === 'idle');
        expect(status!.getAttribute('role')).toBe('status');
        expect(status!.getAttribute('aria-hidden')).toBe(String(state === 'idle'));
        expect(status!.getAttribute('aria-busy')).toBe('false');
        if (state === 'idle') {
            expect(status!.textContent?.trim()).toBe('');
            expect(status!.querySelector('button')).toBeNull();
        } else {
            expect(status!.textContent).toContain('正在播放');
            expect(status!.querySelector('button[aria-label="停止播放"]')?.getAttribute('aria-label')).toBe('停止播放');
        }
    }
    beforeEach(() => {
        vi.useFakeTimers(); ports.listeners.clear(); ports.subscriptions.clear();
        Object.assign(ports.config, new Config(), {disableSelectionTranslator: false, selectionTranslatorMode: 'bilingual',
            selectionTranslatorTrigger: 'contextMenu', selectionTranslatorDelay: 0, from: 'en', to: 'zh-Hans', theme: 'light',
            selectionTtsMode: 'online-first', vocabularyBookEnabled: false});
        ports.translate.mockReset().mockResolvedValue('你好'); ports.speech.mockReset(); ports.cancel.mockReset();
        ports.send.mockReset().mockImplementation(async message => {
            if (message.type === 'fluentReadSelectionPageZoom') return {success: true, zoom: 1};
            if (message.type === 'selectionWordLookup') return {success: true, data: {word: 'hello', normalizedWord: 'hello', phonetics: [],
                meanings: [{partOfSpeech: '名词', definitions: [{definition: 'a greeting'}]}], sources: []}};
            if (message.type === 'selectionTts') return {success: false, errorCode: 'local-tts-model-not-downloaded'};
            return {success: true};
        });
    });
    it('keeps Harness behind the disabled selection switch and opens learning only on explicit interaction after reenable', async () => {
        ports.config.harness.enabled = true;
        ports.config.disableSelectionTranslator = true;
        ports.config.selectionTranslatorMode = 'disabled';
        ports.config.selectionTranslatorTrigger = 'direct';
        async function selectFromPage() {
            const selected = window.getSelection;
            const target = doc.querySelector('#source')!;
            function dispatch(type: string) {
                const event = new window.Event(type, {bubbles: true});
                Object.defineProperty(event, 'isTrusted', {value: true});
                Object.assign(event, {button: 0, pointerType: 'mouse', isPrimary: true});
                target.dispatchEvent(event);
            }
            window.getSelection = () => null;
            dispatch('pointerdown');
            window.getSelection = selected;
            dispatch('selectionchange'); dispatch('pointerup');
            await vi.advanceTimersByTimeAsync(500); await settle();
        }
        await mount('hello', 'card', false);
        await selectFromPage();
        expect(doc.querySelector('.fr-selection-indicator')).toBeNull();
        expect(doc.querySelector('.fr-translation-tooltip')).toBeNull();
        expect(doc.querySelector('[data-reading-target]')).toBeNull();
        expect(ports.translate).not.toHaveBeenCalled();
        expect(ports.send.mock.calls.filter(([message]) => message.type === 'selectionWordLookup')).toHaveLength(0);
        expect(translateSelectionFromContextMenu()).toBe(false);
        app!.unmount(); app = undefined; await settle();
        expect(ports.listeners.size).toBe(0); expect(ports.subscriptions.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
        ports.config.disableSelectionTranslator = false;
        ports.config.selectionTranslatorMode = 'bilingual';
        await mount('hello', 'card', false);
        await selectFromPage();
        expect(doc.querySelector('.fr-word-learning-card')).not.toBeNull();
        expect(doc.querySelector('[data-reading-target]')).toBeNull();
        click('.fr-study-toolbar button', '读懂'); await settle();
        expect(doc.querySelector('[data-reading-target]')?.getAttribute('data-reading-target')).toBe('zh-Hans');
    });
    it('falls back to browser speech after word TTS failure through the rendered button', async () => {
        await mount(); click('.fr-word-heading-audio'); await settle();
        expect(ports.speech).toHaveBeenCalledOnce(); expect(speechUtterances[0].text).toBe('hello');
        expect(doc.querySelector('.fr-playing-status')?.textContent).toContain('单词');
        expectPlayingStatus('playing');
    });
    it('keeps successful offscreen word playback without a duplicate fallback', async () => {
        const send = ports.send.getMockImplementation()!;
        ports.send.mockImplementation(message => message.type === 'selectionTts' ? Promise.resolve({success: true, transport: 'offscreen'}) : send(message));
        await mount(); click('.fr-word-heading-audio'); await settle();
        expect(ports.speech).not.toHaveBeenCalled();
        expect(doc.querySelector('.fr-playing-status')).not.toBeNull();
        expectPlayingStatus('playing');
        click('.fr-word-heading-audio'); await settle();
        expectPlayingStatus('idle');
        expect(ports.send.mock.calls.filter(([m]) => m.type === 'selectionTts')).toHaveLength(1);
    });
    it('keeps local-only playback errors from starting another speech source', async () => {
        ports.config.selectionTtsMode = 'local-only';
        const send = ports.send.getMockImplementation()!;
        ports.send.mockImplementation(message => message.type === 'selectionTts' ? Promise.resolve({success: true, transport: 'offscreen'}) : send(message));
        await mount(); click('.fr-word-heading-audio'); await settle();
        const request = ports.send.mock.calls.find(([message]) => message.type === 'selectionTts')![0];
        for (const listener of ports.listeners) listener({type: 'selectionTtsState', clientRequestId: request.clientRequestId, state: 'error'});
        await settle();
        expectPlayingStatus('idle');
        expect(ports.speech).not.toHaveBeenCalled();
        expect(ports.send.mock.calls.filter(([message]) => message.type === 'selectionTtsGoogle')).toHaveLength(0);
    });
    it.each(['card', 'simple'])('clears the pending play indicator after a local-only %s failure', async presentation => {
        ports.config.selectionTtsMode = 'local-only';
        await mount('hello', presentation);
        // Both persisted presentation values use main's unified word card.
        expect(doc.querySelector('.fr-translation-tooltip')?.getAttribute('data-presentation')).toBe('card');
        click('.fr-word-heading-audio'); await settle();
        expect(ports.speech).not.toHaveBeenCalled();
        expectPlayingStatus('idle');
        expect(doc.querySelector('.fr-action-toast')?.textContent).toContain('selectionTts.localModelNotDownloaded');
    });
    it('keeps the pronunciation key when browser speech takes over a word variant', async () => {
        const send = ports.send.getMockImplementation()!;
        ports.send.mockImplementation(message => message.type === 'selectionWordLookup'
            ? Promise.resolve({success: true, data: {word: 'hello', normalizedWord: 'hello', phonetics: [{text: '/hello/'}],
                meanings: [{partOfSpeech: '名词', definitions: [{definition: 'a greeting'}]}], sources: []}}) : send(message));
        await mount(); click('.fr-word-pronunciation .fr-text-audio-btn'); await settle();
        expect(ports.speech).toHaveBeenCalledOnce();
        expect(doc.querySelector('.fr-word-pronunciation .fr-text-audio-btn')?.getAttribute('aria-label')).toBe('停止播放单词发音');
        expectPlayingStatus('playing');
        click('.fr-word-pronunciation .fr-text-audio-btn'); await settle();
        expectPlayingStatus('idle');
        expect(ports.send.mock.calls.filter(([m]) => m.type === 'selectionTts')).toHaveLength(1);
    });
    it('opens learning for a manually reversed Chinese selection with the effective languages', async () => {
        ports.config.from = 'auto'; ports.config.selectionTranslatorBidirectional = true;
        ports.config.harness.enabled = true;
        await mount('这是一段中文'); click('.fr-study-toolbar button', '读懂'); await settle();
        expect(doc.querySelector('[data-reading-target]')?.getAttribute('data-reading-target')).toBe('en');
        expect(doc.querySelector('[data-reading-source]')?.getAttribute('data-reading-source')).toBe('zh-Hans');
    });
    it('keeps the pronunciation key for successful page audio and releases it on a second click', async () => {
        const play = vi.fn(async () => {}), pause = vi.fn();
        vi.stubGlobal('Audio', class {
            preload = ''; onended: any; onerror: any; play = play; pause = pause;
            constructor(public src: string) {}
            removeAttribute() {this.src = '';}
        });
        const revoke = vi.spyOn(URL, 'revokeObjectURL');
        const send = ports.send.getMockImplementation()!;
        ports.send.mockImplementation(message => message.type === 'selectionWordLookup'
            ? Promise.resolve({success: true, data: {word: 'hello', normalizedWord: 'hello', phonetics: [{text: '/hello/'}],
                meanings: [{partOfSpeech: '名词', definitions: [{definition: 'a greeting'}]}], sources: []}})
            : message.type === 'selectionTts' ? Promise.resolve({success: true, transport: 'page', audioBase64: 'AQID'}) : send(message));
        await mount(); click('.fr-word-pronunciation .fr-text-audio-btn'); await settle();
        expect(play).toHaveBeenCalledOnce();
        expect(doc.querySelector('.fr-word-pronunciation .fr-text-audio-btn')?.getAttribute('aria-label')).toBe('停止播放单词发音');
        expectPlayingStatus('playing');
        click('.fr-word-pronunciation .fr-text-audio-btn'); await settle();
        expectPlayingStatus('idle');
        expect(ports.send.mock.calls.filter(([m]) => m.type === 'selectionTts')).toHaveLength(1);
        expect(pause).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledOnce();
    });
    it('isolates a stopped remote success and cleans up listeners on unmount', async () => {
        const remote = deferred<any>(), send = ports.send.getMockImplementation()!;
        ports.send.mockImplementation(message => message.type === 'selectionTts' ? remote.promise : send(message));
        await mount(); click('.fr-word-heading-audio'); await settle();
        click('.fr-close-btn'); await settle();
        remote.resolve({success: true, transport: 'offscreen'}); await settle();
        expect(doc.querySelector('.fr-translation-tooltip')).toBeNull();
        expect(ports.speech).not.toHaveBeenCalled();
        expect(ports.send.mock.calls.filter(([m]) => m.type === 'selectionTtsStop')).toHaveLength(2);
        app!.unmount(); app = undefined; await settle();
        expect(ports.listeners.size).toBe(0); expect(ports.subscriptions.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
        expect(translateSelectionFromContextMenu()).toBe(false);
    });
});

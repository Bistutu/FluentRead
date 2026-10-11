/**
 * @file tests/progressiveReadingSpeechUi.test.ts
 * 文件职责：挂载真实渐进阅读客户端模板，验证朗读动作、语言配置与页面资源的生命周期。
 * 主要内容：验证正文优先、空态、原文辅助标记与列表的可访问关联、掌握提示隐藏和重叠线索；以真实 speech 控制器执行对象选择、暂停续播、跳转变速循环、配置换文取消、错误重试和关闭卸载，检查标记切换与控件折叠不打断音频及 Blob 逐一释放。
 * 模块边界：仅注入 runtime 合成响应、配置订阅与 Audio/URL 媒体端口，不复制组件方法，不访问私有 setup 状态，也不把 linkedom 验证声称为真实浏览器播放。
 */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseHTML} from 'linkedom';
import {createServer, type ViteDevServer} from 'vite';
import {compileScript, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import type {App, Component} from 'vue';
import {Config} from '@/src/core/config/model';
import {translate, translateLegacyText, type UiLanguage} from '@/src/core/i18n';
import {registerAllUiLanguageBundles} from '@/src/core/i18n/bundles';
import {createReadingState, type ReadingState} from '@/src/features/progressive-reading/session';
import {readingLogicClues, readingPhraseHints, type PhraseHint} from '@/src/features/progressive-reading/hints';
import type {ReadingSpeechResponse} from '@/src/features/progressive-reading/speech';

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
const fixtureKey = '__frReadingSpeechUiFixture';
let server: ViteDevServer, component: Component;
let app: App | undefined;
let latest: Awaited<ReturnType<typeof mount>> | undefined;
const source = 'Good ideas deserve attention. Reading slowly helps us understand every word.';
const translated = '好的想法值得关注。慢慢阅读有助于我们理解每个词。';
const assistedSource = 'If we take into account the cost, it may fail only if demand changes. By and large, most plans succeed.';
const response = (): ReadingSpeechResponse => ({success: true, audioBase64: 'AQID', contentType: 'audio/wav',
  timings: [{startChar: 0, endChar: 10, startTime: 0, endTime: 4}]});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
async function settle() {for (let i = 0; i < 12; i++) {await Promise.resolve(); await runtime.nextTick();}}

beforeAll(async () => {
  registerAllUiLanguageBundles();
  server = await createServer({root: process.cwd(), configFile: false, appType: 'custom', logLevel: 'silent',
    resolve: {alias: {'@': process.cwd()}}, ssr: {noExternal: ['webextension-polyfill']},
    plugins: [{name: 'reading-speech-client-test', enforce: 'pre', resolveId(id) {
      if (/(?:\/|^)(?:ProgressiveReading|SpeechFollowText)\.vue$/u.test(id)) {
        return resolve(id.endsWith('ProgressiveReading.vue') ? 'src/features/progressive-reading/ui/ProgressiveReading.vue'
          : 'src/features/selection-translation/ui/SpeechFollowText.vue') + '.reading-test.ts';
      }
      if (id === 'webextension-polyfill') return '\0reading-speech-browser';
      if (/\/src\/services\/config\/store(?:\.ts)?$/u.test(id)) return '\0reading-speech-config';
      if (/\/src\/ui\/i18n(?:\.ts)?$/u.test(id)) return '\0reading-speech-i18n';
      return null;
    }, load(id) {
      if (id.endsWith('.vue.reading-test.ts')) {
        const path = id.slice(0, -16), filename = path.startsWith('/src/') ? resolve(path.slice(1)) : path;
        const {descriptor, errors} = parse(readFileSync(filename, 'utf8'), {filename});
        expect(errors).toEqual([]);
        const script = compileScript(descriptor, {id: filename, inlineTemplate: true});
        return ts.transpileModule(script.content, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
      }
      if (id === '\0reading-speech-browser') return `export default {runtime: {sendMessage: message => globalThis.${fixtureKey}.send(message)}};`;
      if (id === '\0reading-speech-config') return `const fixture = globalThis.${fixtureKey}; export const config = fixture.config;
        export const subscribeConfig = listener => {fixture.listeners.add(listener);return () => {fixture.listeners.delete(listener);fixture.unsubscribed();}};`;
      if (id === '\0reading-speech-i18n') return `export const useUiI18n = () => ({
        t: (key, params) => globalThis.${fixtureKey}.t(key, params), translateLegacy: text => globalThis.${fixtureKey}.legacy(text)});`;
      return null;
    }}], server: {hmr: false, middlewareMode: true}});
});
afterEach(async () => {
  app?.unmount(); app = undefined; await settle();
  if (latest) {
    expect(latest.revokeUrl.mock.calls.map(([url]) => url).sort()).toEqual(latest.createUrl.mock.results.map(row => row.value).sort());
    expect(latest.listeners.size).toBe(0);
    expect(latest.errors).not.toHaveBeenCalled();
  }
  latest = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
afterAll(async () => {await server?.close();});

async function mount(initial: Partial<ReadingState> = {}, language: UiLanguage = 'zh-CN') {
  const {document, window} = parseHTML('<html><body><div id="app"></div></body></html>');
  const config = Object.assign(new Config(), {theme: 'light', from: 'auto', to: 'zh-Hans'});
  const listeners = new Set<() => void>(), mediaListeners = new Set<() => void>();
  const unsubscribed = vi.fn(), errors = vi.fn();
  const jobs: Array<{message: Record<string, unknown>; task: ReturnType<typeof deferred<ReadingSpeechResponse>>}> = [];
  const stops: string[] = [];
  const send = vi.fn((message: Record<string, unknown>) => {
    if (message.type === 'selectionTtsStop') {stops.push(String(message.clientRequestId)); return Promise.resolve({success: true});}
    if (message.type !== 'selectionTts') throw new Error(`Unexpected message ${String(message.type)}`);
    const task = deferred<ReadingSpeechResponse>(); jobs.push({message, task}); return task.promise;
  });
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((): string => `blob:reading-${createUrl.mock.calls.length}`);
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  let nextPlay: ReturnType<typeof deferred<void>> | undefined, audioFailure = false;
  class PageAudio {
    currentTime = 0; duration = 14; playbackRate = 1; loop = false; preload = '';
    onended: ((event: Event) => void) | null = null;
    onerror: ((event: Event | string) => void) | null = null;
    ontimeupdate: ((event: Event) => void) | null = null;
    onseeked: ((event: Event) => void) | null = null;
    onloadedmetadata: ((event: Event) => void) | null = null;
    ondurationchange: ((event: Event) => void) | null = null;
    play = vi.fn(() => {const pending = nextPlay; nextPlay = undefined; return pending?.promise ?? Promise.resolve();});
    pause = vi.fn(); removeAttribute = vi.fn(); load = vi.fn();
    constructor(readonly src: string) {if (audioFailure) throw Error('Cannot create page audio'); audios.push(this);}
    fire(kind: 'timeupdate' | 'seeked' | 'loadedmetadata' | 'durationchange' | 'ended' | 'error') {
      this[`on${kind}`]?.(new window.Event(kind));
    }
  }
  const audios: PageAudio[] = [];
  const media = {matches: false, addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener)};
  Object.assign(window, {matchMedia: () => media});
  let id = 0;
  for (const [key, value] of Object.entries({window, document, HTMLElement: window.HTMLElement, Event: window.Event,
    Node: window.Node, Audio: PageAudio, crypto: {randomUUID: () => `reading-ui-${++id}`}})) vi.stubGlobal(key, value);
  const fixture = {config, listeners, unsubscribed, send,
    t: (key: string, params?: Parameters<typeof translate>[2]) => translate(key, language, params),
    legacy: (text: string) => translateLegacyText(text, language)};
  vi.stubGlobal(fixtureKey, fixture);
  // 每次挂载有独立配置对象；重新加载配置端口和组件使 SSR 模块不持有上一用例的配置。
  server.moduleGraph.invalidateAll();
  component = (await server.ssrLoadModule('/src/features/progressive-reading/ui/ProgressiveReading.vue')).default;
  const renderer = runtime.createRenderer<Node, HTMLElement>({
    patchProp(node, key, previous, value) {
      if (/^on[A-Z]/u.test(key)) {
        const event = key.slice(2).toLowerCase();
        if (previous) node.removeEventListener(event, previous);
        if (value) node.addEventListener(event, value);
      } else if (key === 'checked') {if (value) node.setAttribute(key, ''); else node.removeAttribute(key); (node as HTMLInputElement).checked = Boolean(value);}
      else if (key === 'value') {node.setAttribute(key, String(value)); if (node.tagName !== 'SELECT') (node as HTMLInputElement).value = String(value);}
      else if (value == null || (value === false && !/^(?:aria-|data-)/u.test(key))) node.removeAttribute(key);
      else node.setAttribute(key, String(value));
    },
    insert: (node, parent, anchor) => parent.insertBefore(node, anchor || null), remove: node => node.parentNode?.removeChild(node),
    createElement: tag => runtime.markRaw(document.createElement(tag)), createText: text => document.createTextNode(text),
    createComment: text => document.createComment(text), setText: (node, text) => {node.nodeValue = text;},
    setElementText: (node, text) => {node.textContent = text;}, parentNode: node => node.parentNode as HTMLElement | null,
    nextSibling: node => node.nextSibling, setScopeId: (node, scope) => node.setAttribute(scope, ''),
    insertStaticContent: (html, parent, anchor) => {const box = document.createElement('template'); box.innerHTML = html;
      const first = box.content.firstChild!, last = box.content.lastChild!; parent.insertBefore(box.content, anchor || null); return [first, last];},
  });
  const state = runtime.reactive(Object.assign(createReadingState(), {open: true, source, translation: translated}, initial));
  const close = vi.fn(() => {state.open = false;}), useSelection = vi.fn();
  const assistance = vi.fn((mode: ReadingState['mode']) => {state.mode = mode;});
  app = renderer.createApp(component, {state, close, useSelection, assistance});
  app.directive('ui-i18n', {}); app.config.errorHandler = errors;
  app.mount(document.getElementById('app')!); await settle();
  const get = <T extends HTMLElement = HTMLButtonElement>(selector: string): T => {
    const element = document.querySelector<T>(selector); expect(element, selector).not.toBeNull(); return element!;
  };
  const click = async (selector: string) => {
    const button = get(selector);
    if (!button.hasAttribute('disabled')) button.dispatchEvent(new window.Event('click', {bubbles: true}));
    await settle();
  };
  const complete = async (index = jobs.length - 1, value = response()) => {jobs[index].task.resolve(value); await settle();};
  const play = async () => {await click('[data-reading-play]'); await complete(); return audios.at(-1)!;};
  const publish = async (change: (draft: Config) => void) => {change(config); for (const listener of listeners) listener(); await settle();};
  const unmount = async () => {app?.unmount(); app = undefined; await settle();};
  const result = {document, window, config, listeners, mediaListeners, unsubscribed, errors, jobs, stops, audios, createUrl, revokeUrl,
    state, close, useSelection, assistance, get, click, complete, play, publish, unmount,
    deferPlay: () => (nextPlay = deferred<void>()), failAudioCreation: () => {audioFailure = true;}};
  latest = result;
  return result;
}

describe('学习面板真实朗读控件与生命周期', () => {
  it('没有选文时隐藏朗读工具栏，打开和读取选择不会自动合成', async () => {
    const f = await mount({source: '', translation: ''});
    expect(f.document.querySelector('[data-reading-speech]')).toBeNull();
    expect(f.document.querySelector('[data-reading-mode]')).toBeNull();
    expect(f.get('[data-reading-use-selection]').textContent).toBe('读取选中正文');
    expect(f.get('[data-reading-use-selection]').closest('header')).toBeNull();
    const pointer = new f.window.Event('pointerdown', {bubbles: true, cancelable: true});
    f.get('[data-reading-use-selection]').dispatchEvent(pointer); expect(pointer.defaultPrevented).toBe(true);
    await f.click('[data-reading-use-selection]'); expect(f.useSelection).toHaveBeenCalledOnce();
    f.state.source = source; await settle();
    expect(f.document.querySelectorAll('[data-reading-use-selection]')).toHaveLength(1);
    expect(f.get('[data-reading-use-selection]').closest('header')).not.toBeNull();
    expect(f.get('[data-reading-use-selection]').textContent).toBe('读取选文');
    expect(f.get('[data-reading-use-selection]').getAttribute('aria-label')).toBe('读取选中正文');
    const loadedPointer = new f.window.Event('pointerdown', {bubbles: true, cancelable: true});
    f.get('[data-reading-use-selection]').dispatchEvent(loadedPointer); expect(loadedPointer.defaultPrevented).toBe(true);
    await f.click('[data-reading-use-selection]'); expect(f.useSelection).toHaveBeenCalledTimes(2);
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('idle');
    expect(f.jobs).toHaveLength(0); expect(f.audios).toHaveLength(0); expect(f.createUrl).not.toHaveBeenCalled();
  });
  it('原文先于朗读呈现，四档只保留一个完整双语动作且没有常驻说明或重复页脚', async () => {
    const f = await mount();
    const contentOrder = Array.from(f.document.querySelectorAll('[data-reading-source], [data-reading-speech]'));
    expect(contentOrder).toEqual([f.get('[data-reading-source]'), f.get('[data-reading-speech]')]);
    expect(f.get('.fr-reading-body').getAttribute('tabindex')).toBe('0');
    expect(f.document.querySelector('.fr-reading-intro')).toBeNull(); expect(f.document.querySelector('footer')).toBeNull();
    expect(f.document.querySelector('.fr-reading-label')).toBeNull();
    expect(f.get('.fr-reading').getAttribute('aria-description')).toContain('选择正文后');
    const group = f.get('.fr-reading-modes'); expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('帮助强度');
    expect(f.document.querySelectorAll('[data-reading-mode]')).toHaveLength(4);
    expect(f.document.querySelectorAll('[data-reading-full]')).toHaveLength(1);
    expect(f.get('[data-reading-full]').getAttribute('data-reading-mode')).toBe('bilingual');
    await f.click('[data-reading-full]'); expect(f.assistance).toHaveBeenLastCalledWith('bilingual');
    expect(f.get('[data-reading-full]').getAttribute('aria-pressed')).toBe('true');
    expect(f.document.querySelectorAll('.fr-reading-label')).toHaveLength(2);
    expect(f.get('[data-reading-translation]').textContent).toBe(translated);
    expect(f.get('[data-reading-translation]').hasAttribute('data-i18n-ignore')).toBe(true);
    expect(f.jobs).toHaveLength(0);
  });
  it('唯一双语标签在等待时禁用，失败时仍能重试且不触发朗读', async () => {
    const f = await mount({translation: ''});
    await f.click('[data-reading-full]'); expect(f.assistance).toHaveBeenCalledOnce();
    f.state.loading = true; await settle();
    expect(f.get('[data-reading-full]').hasAttribute('disabled')).toBe(true);
    expect(f.get('[role="status"]').textContent).toBe('正在读取完整译文…');
    await f.click('[data-reading-full]'); expect(f.assistance).toHaveBeenCalledOnce();
    f.state.loading = false; f.state.error = '翻译暂时失败，请重试。'; await settle();
    expect(f.get('[role="alert"]').textContent).toBe('翻译暂时失败，请重试。');
    expect(f.get('.fr-reading-body').contains(f.get('[role="alert"]'))).toBe(true);
    expect(f.get('[data-reading-full]').textContent).toBe('重试完整双语');
    expect(f.get('[data-reading-full]').hasAttribute('disabled')).toBe(false);
    await f.click('[data-reading-full]'); expect(f.assistance).toHaveBeenCalledTimes(2);
    expect(f.assistance).toHaveBeenLastCalledWith('bilingual');
    expect(f.jobs).toHaveLength(0); expect(f.audios).toHaveLength(0);
  });
  it('更多朗读选项默认折叠，展开入口有完整可访问关系且不生成音频', async () => {
    const f = await mount(), more = f.get('[data-reading-audio-more]');
    expect(more.getAttribute('type')).toBe('button'); expect(more.getAttribute('aria-label')).toBe('更多朗读选项');
    expect(more.getAttribute('aria-controls')).toBe('fr-reading-audio-options');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(f.document.querySelector('#fr-reading-audio-options')).toBeNull();
    for (const action of ['restart', 'stop', 'loop']) expect(f.document.querySelector(`[data-reading-${action}]`)).toBeNull();
    for (const selector of ['[data-reading-audio-kind]', '[data-reading-play]', '[data-reading-seek="-5"]', '[data-reading-seek="5"]', '[data-reading-rate]', '[data-reading-audio-time]']) expect(f.document.querySelector(selector)).not.toBeNull();
    await f.click('[data-reading-audio-more]'); expect(more.getAttribute('aria-expanded')).toBe('true');
    const options = f.get('#fr-reading-audio-options');
    expect(options.contains(f.get('[data-reading-restart]'))).toBe(true);
    expect(f.get('[data-reading-restart]').getAttribute('aria-label')).toBe('从头重听');
    expect(f.get('[data-reading-restart]').hasAttribute('disabled')).toBe(true);
    expect(f.get('[data-reading-stop]').getAttribute('aria-label')).toBe('停止朗读');
    expect(f.get('[data-reading-stop]').hasAttribute('disabled')).toBe(true);
    expect(f.get('[data-reading-loop]').closest('label')?.textContent).toBe('循环');
    await f.click('[data-reading-audio-more]'); expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(f.document.querySelector('#fr-reading-audio-options')).toBeNull();
    expect(f.jobs).toHaveLength(0); expect(f.audios).toHaveLength(0);
  });
  it('原文/译文只选择对象，按钮的可访问名称随选择变化且从不自动播放', async () => {
    const f = await mount();
    expect(f.get('[data-reading-play]').getAttribute('aria-label')).toBe('播放原文');
    await f.click('[data-reading-listen="translation"]');
    expect(f.get('[data-reading-listen="translation"]').getAttribute('aria-pressed')).toBe('true');
    expect(f.get('[data-reading-play]').getAttribute('aria-label')).toBe('播放译文');
    await f.click('[data-reading-listen="source"]'); expect(f.jobs).toHaveLength(0); expect(f.audios).toHaveLength(0);
  });
  it('没有可用译文时禁用译文选择并解释获取方式，原文仍可明确播放', async () => {
    const f = await mount({translation: ''});
    expect(f.get('[data-reading-listen="translation"]').hasAttribute('disabled')).toBe(true);
    expect(f.get('[data-reading-listen="translation"]').title).toBe('先查看完整双语，再播放译文');
    await f.click('[data-reading-listen="translation"]'); await f.play();
    expect(f.jobs[0].message).toMatchObject({type: 'selectionTts', text: source, language: 'en-US', playback: 'page'});
  });
  it('明确播放使用 page 协议与公开 UUID，媒体事件更新实际时间与估算高亮', async () => {
    const f = await mount(), audio = await f.play();
    expect(f.jobs[0].message).toEqual({type: 'selectionTts', text: source, language: 'en-US', clientRequestId: 'reading-ui-1', playback: 'page'});
    expect(audio.preload).toBe('auto'); expect(audio.play).toHaveBeenCalledOnce();
    expect(f.get('[data-reading-play]').getAttribute('aria-label')).toBe('暂停朗读');
    audio.currentTime = 2; audio.fire('timeupdate'); await settle();
    expect(f.get('[data-reading-audio-time]').textContent).toBe('0:02 / 0:14');
    expect(f.get('[data-reading-source] .fr-speech-current').textContent).toBe('ideas');
    expect(f.get('[data-reading-source] .fr-speech-current').title).toBe('跟读进度按句段时长估算');
    expect(f.get('[data-reading-source]').textContent).toBe(source);
    expect(f.get('[data-reading-source]').hasAttribute('data-i18n-ignore')).toBe(true);
    expect(f.document.querySelector('[data-reading-translation] .fr-speech-current')).toBeNull();
  });
  it('暂停与继续保留当前位置和同一音频，停止归零后重播仍不重合成', async () => {
    const f = await mount(), audio = await f.play(); audio.currentTime = 6; audio.fire('timeupdate'); await settle();
    await f.click('[data-reading-play]'); expect(audio.pause).toHaveBeenCalledOnce();
    expect(f.get('[data-reading-play]').getAttribute('aria-label')).toBe('继续朗读');
    await f.click('[data-reading-play]'); expect(audio.currentTime).toBe(6); expect(audio.play).toHaveBeenCalledTimes(2);
    await f.click('[data-reading-audio-more]');
    await f.click('[data-reading-stop]'); expect(audio.currentTime).toBe(0);
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('idle');
    expect(f.document.querySelector('.fr-speech-current')).toBeNull();
    await f.click('[data-reading-play]'); expect(audio.play).toHaveBeenCalledTimes(3);
    expect(f.jobs).toHaveLength(1); expect(f.audios).toHaveLength(1); expect(f.revokeUrl).not.toHaveBeenCalled();
  });
  it('跳转按实际媒体时间限定首尾，重播/变速/循环只作用于已缓存音频', async () => {
    const f = await mount(), audio = await f.play();
    expect(f.get('[data-reading-seek="-5"]').hasAttribute('disabled')).toBe(true);
    await f.click('[data-reading-seek="5"]'); expect(audio.currentTime).toBe(5);
    audio.currentTime = 12; audio.fire('timeupdate'); await settle();
    await f.click('[data-reading-seek="5"]'); expect(audio.currentTime).toBe(14);
    expect(f.get('[data-reading-seek="5"]').hasAttribute('disabled')).toBe(true);
    await f.click('[data-reading-seek="-5"]'); expect(audio.currentTime).toBe(9);
    const rate = f.get<HTMLSelectElement>('[data-reading-rate]');
    for (const option of [.75, 1.25, 1.5, 1]) {
      // linkedom 的 select.value 只有 getter，选中真实 option 后派发 change。
      Array.from(rate.options).find(child => Number(child.value) === option)!.selected = true;
      rate.dispatchEvent(new f.window.Event('change')); await settle(); expect(audio.playbackRate).toBe(option);
    }
    await f.click('[data-reading-audio-more]');
    const loop = f.get<HTMLInputElement>('[data-reading-loop]'); loop.checked = true;
    loop.dispatchEvent(new f.window.Event('change')); await settle(); expect(audio.loop).toBe(true);
    await f.click('[data-reading-restart]'); expect(audio.currentTime).toBe(0); expect(audio.play).toHaveBeenCalledTimes(2);
    expect(f.jobs).toHaveLength(1); expect(f.audios).toHaveLength(1);
  });
  it('折叠和再展开保留正在播放的循环音频，常用暂停与跳转仍可操作', async () => {
    const f = await mount(), audio = await f.play(); audio.currentTime = 4; audio.fire('timeupdate'); await settle();
    await f.click('[data-reading-audio-more]');
    const loop = f.get<HTMLInputElement>('[data-reading-loop]'); loop.checked = true;
    loop.dispatchEvent(new f.window.Event('change')); await settle(); expect(audio.loop).toBe(true);
    const more = f.get('[data-reading-audio-more]');
    expect(more.getAttribute('aria-label')).toBe('更多朗读选项 · 循环已开启');
    await f.click('[data-reading-audio-more]');
    expect(f.document.querySelector('[data-reading-loop]')).toBeNull(); expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('playing');
    expect(audio.currentTime).toBe(4); expect(audio.loop).toBe(true);
    await f.click('[data-reading-seek="5"]'); expect(audio.currentTime).toBe(9);
    await f.click('[data-reading-audio-more]'); expect(f.get<HTMLInputElement>('[data-reading-loop]').checked).toBe(true);
    expect(audio.play).toHaveBeenCalledOnce(); expect(audio.pause).not.toHaveBeenCalled();
    expect(f.stops).toHaveLength(0); expect(f.jobs).toHaveLength(1); expect(f.audios).toHaveLength(1);
    expect(f.revokeUrl).not.toHaveBeenCalled();
    await f.click('[data-reading-audio-more]'); await f.click('[data-reading-play]');
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('paused'); expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.loop).toBe(true);
  });
  it('未知时长保持朗读而不报错，元数据到达后恢复实际跳转和重听', async () => {
    const f = await mount(), audio = await f.play(); audio.duration = NaN; audio.fire('loadedmetadata'); await settle();
    expect(f.get('[data-reading-audio-time]').textContent).toBe('朗读');
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('playing');
    for (const offset of [-5, 5]) expect(f.get(`[data-reading-seek="${offset}"]`).hasAttribute('disabled')).toBe(true);
    await f.click('[data-reading-audio-more]'); expect(f.get('[data-reading-restart]').hasAttribute('disabled')).toBe(true);
    expect(f.document.querySelector('[data-reading-audio-error]')).toBeNull();
    audio.duration = 14; audio.currentTime = 3; audio.fire('durationchange'); await settle();
    expect(f.get('[data-reading-audio-time]').textContent).toBe('0:03 / 0:14');
    for (const offset of [-5, 5]) expect(f.get(`[data-reading-seek="${offset}"]`).hasAttribute('disabled')).toBe(false);
    expect(f.get('[data-reading-restart]').hasAttribute('disabled')).toBe(false);
    await f.click('[data-reading-seek="5"]'); expect(audio.currentTime).toBe(8);
    expect(f.jobs).toHaveLength(1); expect(f.audios).toHaveLength(1); expect(audio.pause).not.toHaveBeenCalled();
  });
  it('生成中的再次点击取消请求，迟到响应不创建 Audio，重试有独立请求归属', async () => {
    const f = await mount(); await f.click('[data-reading-play]');
    expect(f.get('[data-reading-speech]').getAttribute('aria-busy')).toBe('true');
    expect(f.get('[data-reading-play]').getAttribute('aria-label')).toBe('取消生成');
    await f.click('[data-reading-audio-more]'); await f.click('[data-reading-audio-more]');
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('preparing');
    expect(f.stops).toHaveLength(0); expect(f.jobs).toHaveLength(1);
    await f.click('[data-reading-play]'); expect(f.stops).toEqual(['reading-ui-1']);
    await f.click('[data-reading-play]'); expect(f.jobs).toHaveLength(2);
    await f.complete(0); expect(f.audios).toHaveLength(0);
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('preparing');
    await f.complete(1); expect(f.audios).toHaveLength(1); expect(f.audios[0].play).toHaveBeenCalledOnce();
  });
  it('Audio.play 尚未完成时取消，及时释放 URL 并隔离迟到 play 完成', async () => {
    const f = await mount(), pending = f.deferPlay(); await f.click('[data-reading-play]'); await f.complete();
    const audio = f.audios[0]; expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('preparing');
    await f.click('[data-reading-play]'); expect(audio.pause).toHaveBeenCalledOnce(); expect(audio.load).toHaveBeenCalledOnce();
    expect(f.revokeUrl).toHaveBeenCalledWith(audio.src); pending.resolve(); await settle();
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('idle');
    expect(audio.ontimeupdate).toBeNull(); expect(f.document.querySelector('.fr-speech-current')).toBeNull();
  });
  it('自动源语言采用真实检测，译文采用目标语音别名，切换对象会清缓存但不自动播放', async () => {
    const french = 'Les élèves lisent un livre français et comprennent chaque phrase avec attention.';
    const f = await mount({source: french}), first = await f.play();
    expect(f.jobs[0].message.language).toBe('fr-FR');
    await f.click('[data-reading-listen="translation"]');
    expect(first.removeAttribute).toHaveBeenCalledWith('src'); expect(first.load).toHaveBeenCalledOnce();
    expect(f.jobs).toHaveLength(1); await f.play();
    expect(f.jobs[1].message).toMatchObject({text: translated, language: 'zh-CN'});
    await f.publish(config => {config.from = 'de';});
    await f.click('[data-reading-listen="source"]'); await f.play(); expect(f.jobs[2].message.language).toBe('de-DE');
  });
  it.each(['mode', 'localVoice', 'onlineVoices', 'from', 'to'] as const)('已选语音配置 %s 变化释放旧音频，下次显式播放才重新合成', async kind => {
    const f = await mount(), audio = await f.play();
    await f.publish(config => {
      if (kind === 'mode') config.selectionTtsMode = 'local-only';
      if (kind === 'localVoice') config.selectionTtsLocalVoice = 'af_heart';
      if (kind === 'onlineVoices') config.selectionTtsVoices.push('en-US-AriaNeural');
      if (kind === 'from') config.from = 'en';
      if (kind === 'to') config.to = 'ja';
    });
    expect(audio.pause).toHaveBeenCalledOnce(); expect(f.revokeUrl).toHaveBeenCalledWith(audio.src);
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('idle'); expect(f.jobs).toHaveLength(1);
    await f.play(); expect(f.jobs).toHaveLength(2); expect(f.audios).toHaveLength(2);
  });
  it('主题或无关配置更新不清朗读，切换四档帮助及新译文不打断正在播放的原文', async () => {
    const f = await mount(), audio = await f.play();
    await f.publish(config => {config.theme = 'dark'; config.on = false;});
    expect(f.get('.fr-reading').classList.contains('fr-dark-theme')).toBe(true);
    for (const mode of ['phrases', 'logic', 'bilingual', 'original']) await f.click(`[data-reading-mode="${mode}"]`);
    f.state.translation = '更新的译文'; await settle();
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('playing');
    expect(audio.pause).not.toHaveBeenCalled(); expect(f.stops).toHaveLength(0); expect(f.jobs).toHaveLength(1);
  });
  it('新原文释放旧音频且恢复原文对象；旧媒体回调不能污染新的选文', async () => {
    const f = await mount(); await f.click('[data-reading-listen="translation"]'); const audio = await f.play();
    await f.click('[data-reading-audio-more]'); expect(f.get('[data-reading-audio-more]').getAttribute('aria-expanded')).toBe('true');
    const stale = audio.ontimeupdate!; f.state.source = 'A new paragraph replaces the previous captured selection.'; await settle();
    expect(f.get('[data-reading-audio-more]').getAttribute('aria-expanded')).toBe('false');
    expect(f.document.querySelector('#fr-reading-audio-options')).toBeNull();
    expect(f.get('[data-reading-listen="source"]').getAttribute('aria-pressed')).toBe('true');
    expect(f.revokeUrl).toHaveBeenCalledWith(audio.src); audio.currentTime = 10; stale(new f.window.Event('timeupdate')); await settle();
    expect(f.get('[data-reading-audio-time]').textContent).toBe('朗读'); expect(f.document.querySelector('.fr-speech-current')).toBeNull();
    expect(f.jobs).toHaveLength(1);
  });
  it('选中译文时译文失效停止并复位原文对象，恢复新译文后仍需重新选择和点击播放', async () => {
    const f = await mount({mode: 'bilingual'}); await f.click('[data-reading-listen="translation"]'); const audio = await f.play();
    audio.currentTime = 2; audio.fire('timeupdate'); await settle();
    expect(f.document.querySelector('[data-reading-translation] .fr-speech-current')).not.toBeNull();
    expect(f.document.querySelector('[data-reading-source] .fr-speech-current')).toBeNull();
    f.state.translation = ''; await settle(); expect(f.revokeUrl).toHaveBeenCalledWith(audio.src);
    expect(f.get('[data-reading-listen="translation"]').hasAttribute('disabled')).toBe(true);
    expect(f.get('[data-reading-listen="translation"]').getAttribute('aria-pressed')).toBe('false');
    expect(f.get('[data-reading-listen="source"]').getAttribute('aria-pressed')).toBe('true');
    expect(f.get('[data-reading-play]').getAttribute('aria-label')).toBe('播放原文');
    f.state.translation = '新译文'; await settle(); expect(f.jobs).toHaveLength(1);
    expect(f.audios).toHaveLength(1); expect(audio.play).toHaveBeenCalledOnce();
    await f.click('[data-reading-listen="translation"]'); expect(f.jobs).toHaveLength(1);
    await f.play(); expect(f.jobs[1].message.text).toBe('新译文');
  });
  it.each(['close', 'unmount'] as const)('%s 播放中的面板移除音源、释放 Blob，迟到回调不恢复播放', async action => {
    const f = await mount(), audio = await f.play(), stale = audio.onended!;
    await f.click('[data-reading-audio-more]');
    if (action === 'close') await f.click('[data-reading-close]'); else await f.unmount();
    expect(audio.pause).toHaveBeenCalledOnce(); expect(audio.removeAttribute).toHaveBeenCalledWith('src');
    expect(audio.load).toHaveBeenCalledOnce(); expect(f.revokeUrl).toHaveBeenCalledWith(audio.src);
    expect(f.stops).toEqual(['reading-ui-1']); stale(new f.window.Event('ended')); await settle();
    expect(f.document.querySelector('[data-reading-speech]')).toBeNull(); expect(audio.play).toHaveBeenCalledOnce();
    expect(f.document.querySelector('#fr-reading-audio-options')).toBeNull();
    if (action === 'unmount') {expect(f.mediaListeners.size).toBe(0); expect(f.unsubscribed).toHaveBeenCalledOnce();}
  });
  it('原文失效回到清晰读取入口，清理展开的音频控制后新选文保持折叠静默', async () => {
    const f = await mount(), audio = await f.play(); await f.click('[data-reading-audio-more]');
    f.state.source = ''; f.state.translation = ''; f.state.error = '网页原文已变化，请重新选择正文。'; await settle();
    expect(f.document.querySelector('[data-reading-speech]')).toBeNull();
    expect(f.document.querySelector('[data-reading-mode]')).toBeNull();
    expect(f.get('[role="alert"]').textContent).toBe('网页原文已变化，请重新选择正文。');
    expect(f.get('[data-reading-use-selection]').textContent).toBe('读取选中正文');
    await f.click('[data-reading-use-selection]'); expect(f.useSelection).toHaveBeenCalledOnce();
    expect(audio.pause).toHaveBeenCalledOnce(); expect(f.revokeUrl).toHaveBeenCalledWith(audio.src);
    f.state.source = 'A fresh selection.'; f.state.error = ''; await settle();
    expect(f.get('[data-reading-audio-more]').getAttribute('aria-expanded')).toBe('false');
    expect(f.document.querySelector('#fr-reading-audio-options')).toBeNull();
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('idle');
    expect(f.jobs).toHaveLength(1); expect(f.audios).toHaveLength(1); expect(audio.play).toHaveBeenCalledOnce();
  });
  it.each(['close', 'unmount', 'newSource', 'translationGone'] as const)('%s 撤销待合成请求，迟到供应商响应不创建 URL 或播放', async action => {
    const f = await mount();
    if (action === 'translationGone') await f.click('[data-reading-listen="translation"]');
    await f.click('[data-reading-play]');
    if (action === 'close') await f.click('[data-reading-close]');
    if (action === 'unmount') await f.unmount();
    if (action === 'newSource') {f.state.source = 'Replacement source.'; await settle();}
    if (action === 'translationGone') {f.state.translation = ''; await settle();}
    expect(f.stops).toEqual(['reading-ui-1']); await f.complete();
    expect(f.createUrl).not.toHaveBeenCalled(); expect(f.audios).toHaveLength(0);
  });
  it('合成长错误保留完整文本且可聚焦重试，成功后清理错误并使用新的 UUID', async () => {
    const detailedError = '语音服务暂时不可用：' + '上游返回 503，请稍后重试。'.repeat(35);
    const f = await mount(); await f.click('[data-reading-play]'); await f.complete(0, {success: false, error: detailedError});
    expect(f.get('[data-reading-audio-error]').textContent).toBe(detailedError);
    expect(f.get('[data-reading-audio-error]').getAttribute('role')).toBe('alert');
    expect(f.get('[data-reading-audio-error]').getAttribute('tabindex')).toBe('0');
    expect(f.get('[data-reading-play]').getAttribute('aria-label')).toBe('播放原文');
    await f.play(); expect(f.jobs[1].message.clientRequestId).toBe('reading-ui-2');
    expect(f.document.querySelector('[data-reading-audio-error]')).toBeNull(); expect(f.audios[0].play).toHaveBeenCalledOnce();
  });
  it('媒体解码错误重试重新获取音频，Audio 创建异常也释放已经分配的 Blob', async () => {
    const f = await mount(), audio = await f.play(); audio.fire('error'); await settle();
    expect(f.get('[data-reading-audio-error]').textContent).toBe('语音播放失败，请重试');
    expect(f.revokeUrl).toHaveBeenCalledWith(audio.src); expect(audio.ontimeupdate).toBeNull();
    await f.play(); expect(f.jobs).toHaveLength(2); expect(f.audios).toHaveLength(2);
    expect(f.audios[1].play).toHaveBeenCalledOnce(); expect(audio.play).toHaveBeenCalledOnce();
    await f.publish(config => {config.from = 'ja';}); f.failAudioCreation();
    await f.click('[data-reading-play]'); await f.complete();
    expect(f.get('[data-reading-audio-error]').textContent).toBe('Cannot create page audio');
    expect(f.revokeUrl.mock.calls).toHaveLength(3); expect(f.audios).toHaveLength(2);
  });
  it('媒体 ended 回到可播放状态，下一次播放重用原音频从头开始', async () => {
    const f = await mount(), audio = await f.play(); audio.currentTime = 14; audio.fire('ended'); await settle();
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('idle');
    expect(f.document.querySelector('.fr-speech-current')).toBeNull();
    await f.click('[data-reading-play]'); expect(audio.currentTime).toBe(0); expect(audio.play).toHaveBeenCalledTimes(2); expect(f.jobs).toHaveLength(1);
  });
  it('Esc 从工具栏冒泡关闭面板，其他键不误关闭，全部操作保留可访问按钮/名称', async () => {
    const f = await mount({}, 'en-US'); await f.play();
    const button = f.get('[data-reading-play]'); expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Pause reading');
    const key = (name: string) => {const event = new f.window.Event('keydown', {bubbles: true}); Object.defineProperty(event, 'key', {value: name}); button.dispatchEvent(event);};
    key('ArrowRight'); await settle(); expect(f.close).not.toHaveBeenCalled(); key('Escape'); await settle(); expect(f.close).toHaveBeenCalledOnce();
    expect(f.document.querySelector('[data-reading-speech]')).toBeNull();
  });
});

describe('学习面板原文辅助标记与朗读共存', () => {
  it('短语模式在真实原文上标出表达，关联对应释义且标记不触发查询或修改宿主', async () => {
    const phrases = readingPhraseHints(assistedSource, []);
    const f = await mount({source: assistedSource, phrases, mode: 'phrases'});
    const host = f.document.createElement('p'); host.innerHTML = 'Host <em>selection</em> stays intact.';
    f.document.body.insertBefore(host, f.document.getElementById('app'));
    const originalHost = host.outerHTML;
    const marks = Array.from(f.document.querySelectorAll<HTMLElement>('[data-reading-source] [data-reading-inline-kind="phrase"]'));
    expect(marks.map(mark => mark.textContent)).toEqual(['take into account', 'By and large']);
    expect(f.get('[data-reading-source]').textContent).toBe(assistedSource);
    expect(f.document.querySelector('[data-reading-source] [data-reading-inline-kind="logic"]')).toBeNull();
    for (const [index, mark] of marks.entries()) {
      const hint = phrases[index];
      expect(mark.getAttribute('data-reading-inline-start')).toBe(String(hint.start));
      expect(mark.getAttribute('data-reading-inline-end')).toBe(String(hint.end));
      expect(mark.title).toContain(hint.reference);
      const description = f.document.getElementById(mark.getAttribute('aria-describedby')!);
      expect(description?.matches('[data-reading-phrase]')).toBe(true);
      expect(description?.textContent).toContain(hint.term); expect(description?.textContent).toContain(hint.reference);
      expect(mark.getAttribute('tabindex')).toBeNull(); expect(mark.getAttribute('role')).toBeNull();
    }
    await f.click('[data-reading-source] [data-reading-inline-kind="phrase"]');
    expect(f.assistance).not.toHaveBeenCalled(); expect(f.jobs).toHaveLength(0); expect(f.audios).toHaveLength(0);
    expect(f.state.phrases).toEqual(phrases); expect(host.outerHTML).toBe(originalHost);
  });
  it('已掌握表达默认连同原文标记一起收起，主动显示与再次隐藏只改变呈现', async () => {
    const phrases = readingPhraseHints(assistedSource, []); phrases[0].hidden = true; phrases[0].saved = true;
    const f = await mount({source: assistedSource, phrases, mode: 'phrases'});
    const terms = () => Array.from(f.document.querySelectorAll('[data-reading-source] [data-reading-inline-kind="phrase"]')).map(mark => mark.textContent);
    expect(terms()).toEqual(['By and large']);
    expect(f.document.querySelectorAll('[data-reading-phrase]')).toHaveLength(1);
    expect(f.get('[data-reading-show-known]').getAttribute('aria-pressed')).toBe('false');
    await f.click('[data-reading-show-known]');
    expect(terms()).toEqual(['take into account', 'By and large']);
    expect(f.document.querySelectorAll('[data-reading-phrase]')).toHaveLength(2);
    expect(f.get('[data-reading-show-known]').getAttribute('aria-pressed')).toBe('true');
    await f.click('[data-reading-show-known]'); expect(terms()).toEqual(['By and large']);
    expect(f.get('[data-reading-source]').textContent).toBe(assistedSource);
    expect(f.state.phrases[0]).toMatchObject({hidden: true, saved: true});
    expect(f.assistance).not.toHaveBeenCalled(); expect(f.jobs).toHaveLength(0); expect(f.audios).toHaveLength(0);
  });
  it('重叠 only if 线索保留原文字序，同一标记关联条件和范围的完整说明', async () => {
    const clues = readingLogicClues(assistedSource);
    const f = await mount({source: assistedSource, clues, mode: 'logic'});
    const marks = Array.from(f.document.querySelectorAll<HTMLElement>('[data-reading-source] [data-reading-inline-kind="logic"]'));
    expect(marks.length).toBeGreaterThan(0); expect(f.get('[data-reading-source]').textContent).toBe(assistedSource);
    expect(f.document.querySelector('[data-reading-source] [data-reading-inline-kind="phrase"]')).toBeNull();
    const condition = clues.findIndex(clue => clue.term === 'only if');
    const scope = clues.findIndex(clue => clue.term === 'only');
    expect(condition).toBeGreaterThanOrEqual(0); expect(scope).toBeGreaterThanOrEqual(0);
    const conditionId = f.document.querySelectorAll('[data-reading-logic]')[condition].id;
    const scopeId = f.document.querySelectorAll('[data-reading-logic]')[scope].id;
    const overlap = marks.find(mark => {
      const descriptions = mark.getAttribute('aria-describedby')?.split(' ') ?? [];
      return descriptions.includes(conditionId) && descriptions.includes(scopeId);
    });
    expect(overlap?.textContent).toBe('only');
    for (const clue of [clues[condition], clues[scope]]) {
      expect(overlap?.title).toContain(clue.label); expect(overlap?.title).toContain(clue.detail);
    }
    for (const mark of marks) {
      expect(assistedSource.slice(Number(mark.getAttribute('data-reading-inline-start')), Number(mark.getAttribute('data-reading-inline-end')))).toBe(mark.textContent);
      for (const id of mark.getAttribute('aria-describedby')!.split(' ')) expect(f.document.getElementById(id)?.matches('[data-reading-logic]')).toBe(true);
    }
    expect(f.jobs).toHaveLength(0); expect(f.audios).toHaveLength(0);
  });
  it('只读原文和完整双语保持干净正文，往返四种帮助不会积累标记或请求朗读', async () => {
    const f = await mount({source: assistedSource, phrases: readingPhraseHints(assistedSource, []), clues: readingLogicClues(assistedSource)});
    for (const mode of ['original', 'phrases', 'logic', 'bilingual', 'original', 'phrases', 'original']) {
      await f.click(`[data-reading-mode="${mode}"]`);
      const kinds = Array.from(f.document.querySelectorAll('[data-reading-source] [data-reading-inline-kind]')).map(mark => mark.getAttribute('data-reading-inline-kind'));
      if (mode === 'phrases' || mode === 'logic') {expect(kinds.length).toBeGreaterThan(0); expect(new Set(kinds)).toEqual(new Set([mode === 'phrases' ? 'phrase' : 'logic']));}
      else expect(kinds).toEqual([]);
      expect(f.get('[data-reading-source]').textContent).toBe(assistedSource);
      if (mode === 'bilingual') {expect(f.get('[data-reading-translation]').textContent).toBe(translated); expect(f.document.querySelector('[data-reading-translation] [data-reading-inline-kind]')).toBeNull();}
    }
    expect(f.jobs).toHaveLength(0); expect(f.audios).toHaveLength(0); expect(f.createUrl).not.toHaveBeenCalled();
  });
  it('段内标记保持真实字符偏移，当前词跟读与辅助标记共存且切模式不重建音频', async () => {
    const start = source.indexOf('Reading slowly'), end = start + 'Reading slowly'.length;
    const phrase: PhraseHint = {term: 'Reading slowly', reference: '慢慢阅读', start, end, hidden: false, saved: true};
    const f = await mount({phrases: [phrase], mode: 'phrases'});
    await f.click('[data-reading-play]');
    await f.complete(0, {...response(), timings: [{startChar: start, endChar: end, startTime: 0, endTime: 4}]});
    const audio = f.audios[0]; audio.currentTime = 1; audio.fire('timeupdate'); await settle();
    expect(f.get('[data-reading-source] [data-reading-inline-kind="phrase"] .fr-speech-current').textContent).toBe('Reading');
    expect(f.document.querySelectorAll('[data-reading-source] .fr-speech-current')).toHaveLength(1);
    for (const mode of ['original', 'logic', 'bilingual', 'phrases']) {
      await f.click(`[data-reading-mode="${mode}"]`);
      expect(f.get('[data-reading-source] .fr-speech-current').textContent).toBe('Reading');
      expect(f.get('[data-reading-source]').textContent).toBe(source);
    }
    audio.currentTime = 2; audio.fire('timeupdate'); await settle();
    expect(f.get('[data-reading-source] [data-reading-inline-kind="phrase"] .fr-speech-current').textContent).toBe('slowly');
    f.state.phrases[0].hidden = true; await settle();
    expect(f.document.querySelector('[data-reading-source] [data-reading-inline-kind]')).toBeNull();
    expect(f.get('[data-reading-source] .fr-speech-current').textContent).toBe('slowly');
    await f.click('[data-reading-show-known]');
    expect(f.get('[data-reading-source] [data-reading-inline-kind="phrase"] .fr-speech-current').textContent).toBe('slowly');
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('playing'); expect(audio.currentTime).toBe(2);
    expect(audio.play).toHaveBeenCalledOnce(); expect(audio.pause).not.toHaveBeenCalled();
    expect(f.jobs).toHaveLength(1); expect(f.audios).toHaveLength(1); expect(f.stops).toHaveLength(0); expect(f.revokeUrl).not.toHaveBeenCalled();
  });
  it('新选文即使暂留旧提示数据也不留下原文旧标记，下一次提示只标新选文', async () => {
    const f = await mount({source: assistedSource, phrases: readingPhraseHints(assistedSource, []), mode: 'phrases'});
    expect(f.document.querySelectorAll('[data-reading-source] [data-reading-inline-kind="phrase"]')).toHaveLength(2);
    f.state.source = 'We carry out a new plan.'; await settle();
    expect(f.get('[data-reading-source]').textContent).toBe('We carry out a new plan.');
    expect(f.document.querySelector('[data-reading-source] [data-reading-inline-kind]')).toBeNull();
    f.state.phrases = readingPhraseHints(f.state.source, []); await settle();
    expect(f.get('[data-reading-source] [data-reading-inline-kind="phrase"]').textContent).toBe('carry out');
    expect(f.get('[data-reading-source]').textContent).not.toContain('take into account');
    expect(f.jobs).toHaveLength(0); expect(f.audios).toHaveLength(0);
  });
  it('伪造短语坐标、错误 term 和 HTML 文本不造成错误标记、注入或原文丢失', async () => {
    const text = 'Good ideas <img src=x onerror=alert(1)> deserve attention.';
    const valid: PhraseHint = {term: 'ideas', reference: '<script>unsafe</script>', start: 5, end: 10, hidden: false, saved: false};
    const phrases: PhraseHint[] = [valid,
      {...valid, start: -1}, {...valid, end: text.length + 1}, {...valid, start: 5.5}, {...valid, end: 5},
      {...valid, start: NaN}, {...valid, start: 0, end: 4, term: 'ideas'}, {...valid, term: 'wrong text'}];
    const f = await mount({source: text, phrases, mode: 'phrases'});
    expect(f.get('[data-reading-source]').textContent).toBe(text);
    expect(Array.from(f.document.querySelectorAll('[data-reading-source] [data-reading-inline-kind="phrase"]')).map(mark => mark.textContent)).toEqual(['ideas']);
    expect(f.get('[data-reading-source] [data-reading-inline-kind="phrase"]').title).toContain('<script>unsafe</script>');
    expect(f.document.querySelector('img, script')).toBeNull();
    expect(f.jobs).toHaveLength(0); expect(f.audios).toHaveLength(0);
  });
  it('重复相同范围的短语描述使用唯一列表 ID，原文只呈现一次且所有关系都可解析', async () => {
    const phrase: PhraseHint = {term: 'ideas', reference: '想法', start: 5, end: 10, hidden: false, saved: false};
    const f = await mount({phrases: [phrase, {...phrase, reference: '收藏释义', saved: true}], mode: 'phrases'});
    expect(f.get('[data-reading-source]').textContent).toBe(source);
    const marks = Array.from(f.document.querySelectorAll('[data-reading-source] [data-reading-inline-kind="phrase"]'));
    expect(marks).toHaveLength(1); expect(marks[0].textContent).toBe('ideas');
    const descriptions = marks[0].getAttribute('aria-describedby')!.split(' ');
    expect(descriptions).toHaveLength(2); expect(new Set(descriptions).size).toBe(2);
    for (const id of descriptions) expect(f.document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    expect(marks[0].getAttribute('title')).toContain('想法'); expect(marks[0].getAttribute('title')).toContain('收藏释义');
    expect(f.jobs).toHaveLength(0); expect(f.audios).toHaveLength(0);
  });
});

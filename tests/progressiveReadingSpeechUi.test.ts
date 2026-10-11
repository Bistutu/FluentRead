/**
 * @file tests/progressiveReadingSpeechUi.test.ts
 * 文件职责：挂载真实渐进阅读客户端模板，验证朗读动作、语言配置与页面资源的生命周期。
 * 主要内容：以真实 speech 控制器、公开语言与跟读展示执行原文/译文选择、暂停续播、跳转变速循环、配置换文取消、错误重试和关闭卸载；检查迟到响应不播放及 Blob 逐一释放。
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
import type {ReadingSpeechResponse} from '@/src/features/progressive-reading/speech';

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
const fixtureKey = '__frReadingSpeechUiFixture';
let server: ViteDevServer, component: Component;
let app: App | undefined;
let latest: Awaited<ReturnType<typeof mount>> | undefined;
const source = 'Good ideas deserve attention. Reading slowly helps us understand every word.';
const translated = '好的想法值得关注。慢慢阅读有助于我们理解每个词。';
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
    await f.click('[data-reading-use-selection]'); expect(f.useSelection).toHaveBeenCalledOnce();
    f.state.source = source; await settle();
    expect(f.get('[data-reading-speech]').getAttribute('data-status')).toBe('idle');
    expect(f.jobs).toHaveLength(0); expect(f.audios).toHaveLength(0); expect(f.createUrl).not.toHaveBeenCalled();
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
    const loop = f.get<HTMLInputElement>('[data-reading-loop]'); loop.checked = true;
    loop.dispatchEvent(new f.window.Event('change')); await settle(); expect(audio.loop).toBe(true);
    await f.click('[data-reading-restart]'); expect(audio.currentTime).toBe(0); expect(audio.play).toHaveBeenCalledTimes(2);
    expect(f.jobs).toHaveLength(1); expect(f.audios).toHaveLength(1);
  });
  it('生成中的再次点击取消请求，迟到响应不创建 Audio，重试有独立请求归属', async () => {
    const f = await mount(); await f.click('[data-reading-play]');
    expect(f.get('[data-reading-speech]').getAttribute('aria-busy')).toBe('true');
    expect(f.get('[data-reading-play]').getAttribute('aria-label')).toBe('取消生成');
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
    const stale = audio.ontimeupdate!; f.state.source = 'A new paragraph replaces the previous captured selection.'; await settle();
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
    if (action === 'close') await f.click('[data-reading-close]'); else await f.unmount();
    expect(audio.pause).toHaveBeenCalledOnce(); expect(audio.removeAttribute).toHaveBeenCalledWith('src');
    expect(audio.load).toHaveBeenCalledOnce(); expect(f.revokeUrl).toHaveBeenCalledWith(audio.src);
    expect(f.stops).toEqual(['reading-ui-1']); stale(new f.window.Event('ended')); await settle();
    expect(f.document.querySelector('[data-reading-speech]')).toBeNull(); expect(audio.play).toHaveBeenCalledOnce();
    if (action === 'unmount') {expect(f.mediaListeners.size).toBe(0); expect(f.unsubscribed).toHaveBeenCalledOnce();}
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
  it('合成错误可见且可明确重试，成功后清理错误并使用新的 UUID', async () => {
    const f = await mount(); await f.click('[data-reading-play]'); await f.complete(0, {success: false, error: '本地语音模型尚未下载'});
    expect(f.get('[data-reading-audio-error]').textContent).toBe('本地语音模型尚未下载');
    expect(f.get('[data-reading-audio-error]').getAttribute('role')).toBe('alert');
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

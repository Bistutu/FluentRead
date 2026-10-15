/**
 * @file tests/translationProgressMobileLifecycle.test.ts
 * 文件职责：执行全文进度面板真实 SFC 的模板、响应式状态、进度订阅及移动视口生命周期。
 * 主要内容：用真实 progress/visibility/visualViewport 模块验证键盘和平移后的 inline 几何、横竖屏、后台与 bfcache 返回、会话限定重试/定位、隐藏/恢复以及卸载取消队列。
 * 模块边界：仅配置和语言为受控业务端口，使用 Vue 官方编译器与 Linkedom renderer；不把模拟视口数据或 DOM 事件当作移动设备、CSS 实际排版或真实软键盘验收。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as Vue from 'vue';
import {parseHTML} from 'linkedom';
import * as progressApi from '@/src/features/full-page-translation/progress';
import * as domain from '@/src/core/site-rules/domain';
import * as visualViewport from '@/src/platform/dom/visualViewport';
import {createProgressPanelVisibility} from '@/src/features/full-page-translation/ui/progressPanelVisibility';
import {compileVueInlineFixture} from './helpers/compiledVueFixture';

const filename = 'src/features/full-page-translation/ui/TranslationProgressPanel.vue';
const compiled = compileVueInlineFixture(filename, {id: 'translation-progress-mobile'});
let app: Vue.App | undefined;
afterEach(() => {
  app?.unmount(); app = undefined;
  const current = progressApi.getFullPageTranslationProgress();
  if (current.active) progressApi.finishFullPageTranslationProgress(current.sessionId);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

function mountPanel() {
  vi.useFakeTimers();
  const dom = parseHTML('<html><body></body></html>');
  const document = dom.document;
  Object.defineProperty(document, 'visibilityState', {value: 'visible', writable: true, configurable: true});
  const viewport = Object.assign(new EventTarget(), {width: 1000, height: 800, offsetLeft: 0, offsetTop: 0});
  const media = Object.assign(new EventTarget(), {matches: false});
  const window = Object.assign(new EventTarget(), {innerWidth: 1000, innerHeight: 800, visualViewport: viewport, document,
    location: {href: 'https://example.com/article'}, matchMedia: () => media,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id)});
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  const addWindow = vi.spyOn(window, 'addEventListener'), removeWindow = vi.spyOn(window, 'removeEventListener');
  const addViewport = vi.spyOn(viewport, 'addEventListener'), removeViewport = vi.spyOn(viewport, 'removeEventListener');
  const addDocument = vi.spyOn(document, 'addEventListener'), removeDocument = vi.spyOn(document, 'removeEventListener');
  const config = {animations: true, theme: 'light', disableFloatingBall: false, floatingBallDisabledDomains: []};
  let publishConfig: (value: typeof config) => void = () => {};
  const stopConfig = vi.fn(), stopProgress = vi.fn();
  const TransitionPort = Vue.defineComponent({inheritAttrs: false, props: {name: String}, setup: (_props, {slots}) => () => slots.default?.()});
  const exports: {default?: Vue.Component} = {};
  new Function('require', 'exports', compiled.code)((id: string) => {
    if (id === 'vue') return {...Vue, Transition: TransitionPort};
    if (id === '@/src/features/full-page-translation/progress') return {...progressApi,
      subscribeFullPageTranslationProgress: (listener: Parameters<typeof progressApi.subscribeFullPageTranslationProgress>[0]) => {
        const release = progressApi.subscribeFullPageTranslationProgress(listener);
        return () => {stopProgress(); release();};
      }};
    if (id === './progressPanelVisibility') return {createProgressPanelVisibility};
    if (id === '@/src/platform/dom/visualViewport') return visualViewport;
    if (id === '@/src/core/site-rules/domain') return domain;
    if (id === '@/src/services/config/store') return {config, subscribeConfig: (listener: typeof publishConfig) => {publishConfig = listener; return stopConfig;}};
    if (id === '@/src/ui/i18n') return {useUiI18n: () => ({t: (key: string) => key})};
    throw new Error(`Unexpected progress component import: ${id}`);
  }, exports);
  const handlers = new WeakMap<Element, Map<string, EventListener>>();
  const renderer = Vue.createRenderer<Node, Element>({
    createElement: (tag, namespace) => Vue.markRaw(namespace === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag)),
    createText: value => document.createTextNode(value), createComment: value => document.createComment(value),
    insert: (node, parent, anchor) => {parent.insertBefore(node, anchor ?? null);}, remove: node => {node.parentNode?.removeChild(node);},
    setText: (node, text) => {node.nodeValue = text;}, setElementText: (node, text) => {node.textContent = text;},
    parentNode: node => node.parentNode as Element | null, nextSibling: node => node.nextSibling,
    patchProp(element, key, previous, value) {
      if (/^on[A-Z]/.test(key)) {
        const name = key.slice(2).toLowerCase(), registered = handlers.get(element) || new Map<string, EventListener>();
        handlers.set(element, registered); const old = registered.get(name); if (old) element.removeEventListener(name, old);
        registered.delete(name);
        if (value) {const callback: EventListener = event => value(event); registered.set(name, callback); element.addEventListener(name, callback);}
      } else if (key === 'style') {
        const style = (element as HTMLElement).style;
        for (const name of Object.keys(previous || {})) if (!(name in (value || {}))) style.removeProperty(name.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`));
        for (const [name, raw] of Object.entries(value || {})) style.setProperty(name.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`), String(raw ?? ''));
      } else if (value == null || value === false && key === 'disabled') element.removeAttribute(key);
      else element.setAttribute(key, String(value));
    },
  });
  const current = renderer.createApp(exports.default!); const errors = vi.fn(); current.config.errorHandler = errors;
  app = current; current.mount(document.body);
  const panel = () => document.querySelector<HTMLElement>('.fr-translation-progress');
  const click = (selector: string) => {
    const button = document.querySelector(selector); expect(button).not.toBeNull(); button!.dispatchEvent(new dom.window.Event('click', {bubbles: true}));
  };
  const advance = async (ms = 20) => {await vi.advanceTimersByTimeAsync(ms); await Vue.nextTick(); expect(errors).not.toHaveBeenCalled();};
  return {window, viewport, document, panel, click, advance, errors, stopConfig, stopProgress,
    addWindow, removeWindow, addViewport, removeViewport, addDocument, removeDocument,
    config: (patch: Partial<typeof config>) => {Object.assign(config, patch); publishConfig({...config});},
    visibility: (value: 'hidden' | 'visible') => {Object.assign(document, {visibilityState: value}); document.dispatchEvent(new dom.window.Event('visibilitychange'));},
    unmount: () => {current.unmount(); app = undefined;}};
}
function working() {
  const session = progressApi.startFullPageTranslationProgress();
  progressApi.updateFullPageTranslationProgress(session, {running: 1, queued: 3, offscreen: 2});
  return session;
}

describe('full page progress mobile viewport lifecycle', () => {
  it('executes the real template and relocates its work panel after keyboard/pan and rotation events', async () => {
    const fixture = mountPanel(); working(); await fixture.advance(180);
    expect(fixture.panel()?.style.right).toBe('16px'); expect(fixture.panel()?.style.bottom).toBe('16px');
    Object.assign(fixture.viewport, {width: 390, height: 300, offsetLeft: 80, offsetTop: 160});
    fixture.viewport.dispatchEvent(new Event('resize')); fixture.viewport.dispatchEvent(new Event('scroll'));
    await fixture.advance();
    expect(fixture.panel()?.style.right).toBe('540px'); expect(fixture.panel()?.style.bottom).toBe('350px');
    expect(fixture.panel()?.style.maxWidth).toBe('370px'); expect(fixture.panel()?.style.maxHeight).toBe('280px');
    Object.assign(fixture.window, {innerWidth: 780, innerHeight: 390});
    Object.assign(fixture.viewport, {width: 780, height: 390, offsetLeft: 0, offsetTop: 0});
    fixture.window.dispatchEvent(new Event('orientationchange')); await fixture.advance();
    expect(fixture.panel()?.style.right).toBe('16px'); expect(fixture.panel()?.style.bottom).toBe('16px');
    expect(fixture.panel()?.style.maxHeight).toBe('358px');
    expect(progressApi.getFullPageTranslationProgress()).toMatchObject({running: 1, queued: 3, offscreen: 2});
  });

  it('recomputes visible bounds on background and bfcache return without mutating the active session', async () => {
    const fixture = mountPanel(), session = working(); await fixture.advance(180);
    fixture.visibility('hidden');
    Object.assign(fixture.viewport, {width: 390, height: 320, offsetTop: 100, offsetLeft: 0});
    fixture.visibility('visible'); await fixture.advance();
    expect(fixture.panel()?.style.bottom).toBe('390px');
    Object.assign(fixture.viewport, {height: 600, offsetTop: 0});
    fixture.window.dispatchEvent(new Event('pageshow')); await fixture.advance();
    expect(fixture.panel()?.style.bottom).toBe('210px');
    expect(progressApi.getFullPageTranslationProgress()).toMatchObject({sessionId: session, running: 1});
  });

  it('keeps retry/locate session callbacks and dismiss semantics when viewport updates arrive', async () => {
    const fixture = mountPanel(), session = working(), action = vi.fn(() => 1);
    progressApi.setFullPageFailureActions(session, action);
    progressApi.updateFullPageTranslationProgress(session, {running: 0, queued: 0, offscreen: 0, failed: 2, retryable: 2});
    await fixture.advance(180);
    fixture.click('.fr-progress-action'); fixture.click('.fr-progress-action + .fr-progress-action');
    expect(action.mock.calls).toEqual([['retry'], ['locate']]);
    fixture.click('.fr-progress-dismiss'); await fixture.advance(); expect(fixture.panel()).toBeNull();
    fixture.viewport.dispatchEvent(new Event('resize')); await fixture.advance(); expect(fixture.panel()).toBeNull();
    progressApi.updateFullPageTranslationProgress(session, {running: 1, queued: 0, offscreen: 0}); await fixture.advance(200);
    expect(fixture.panel()).toBeNull();
    working(); await fixture.advance(180); expect(fixture.panel()).not.toBeNull();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('hides immediately when the owning translation is restored and never revives it on viewport return', async () => {
    const fixture = mountPanel(), session = working(); await fixture.advance(180);
    progressApi.finishFullPageTranslationProgress(session); await Vue.nextTick(); expect(fixture.panel()).toBeNull();
    fixture.window.dispatchEvent(new Event('pageshow')); fixture.visibility('visible'); await fixture.advance(800);
    expect(fixture.panel()).toBeNull();
  });

  it('releases actual viewport listeners, queued frames, progress/config subscriptions and visibility timers on unmount', async () => {
    const fixture = mountPanel(); working(); fixture.viewport.dispatchEvent(new Event('resize'));
    fixture.unmount();
    expect(fixture.stopConfig).toHaveBeenCalledOnce(); expect(fixture.stopProgress).toHaveBeenCalledOnce();
    for (const [type, handler] of fixture.addWindow.mock.calls) expect(fixture.removeWindow).toHaveBeenCalledWith(type, handler);
    for (const [type, handler] of fixture.addViewport.mock.calls) expect(fixture.removeViewport).toHaveBeenCalledWith(type, handler);
    expect(fixture.removeDocument).toHaveBeenCalledWith('visibilitychange', fixture.addDocument.mock.calls.find(([type]) => type === 'visibilitychange')![1]);
    fixture.viewport.dispatchEvent(new Event('resize')); fixture.window.dispatchEvent(new Event('pageshow')); fixture.visibility('visible');
    await fixture.advance(1000);
    expect(fixture.panel()).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
});

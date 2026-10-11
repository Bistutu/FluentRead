/**
 * @file src/features/progressive-reading/content.ts
 * 文件职责：将渐进阅读会话接入已有 WXT/Vue Shadow UI、翻译客户端与学习库消息生命周期。
 * 主要内容：只在主动打开时创建封闭面板；保存瞬时选区、观察当前原文所有权、订阅明确学习变更，关闭/禁用/卸载取消请求并释放监听与节点。
 * 模块边界：不修改网页正文、不记录停留或遇见次数、不改学习算法、broker 调度或配置；纯提示和异步结果归 session，正文捕获归 source。
 */
import browser from 'webextension-polyfill';
import {reactive} from 'vue';
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import {createVueShadowUi} from '@/src/platform/shadow-ui';
import {translateText} from '@/src/app/translation/client';
import {config} from '@/src/services/config/store';
import {VOCABULARY_BOOK_CHANGED_MESSAGE, VOCABULARY_BOOK_MESSAGE, type VocabularyBookResponse, type VocabularyReadingHint} from '@/src/features/vocabulary/protocol';
import {captureProgressiveSource, type ReadingDomSource} from './source';
import {createReadingSession, createReadingState} from './session';
import ProgressiveReading from './ui/ProgressiveReading.vue';

let owner: {open(): Promise<boolean>; dispose(): void} | undefined;
export function openProgressiveReading(): Promise<boolean> {return owner?.open() ?? Promise.resolve(false);}
export function unmountProgressiveReading(): void {owner?.dispose(); owner = undefined;}

export function mountProgressiveReading(ctx: ContentScriptContext, signal: AbortSignal): void {
  if (owner || signal.aborted || ctx.isInvalid) return;
  const state = reactive(createReadingState());
  const session = createReadingSession(state, {
    async hints(text) {
      if (browser.extension.inIncognitoContext) return [];
      const response = await browser.runtime.sendMessage({type: VOCABULARY_BOOK_MESSAGE, action: 'readingHints', input: {text, targetLanguage: config.to}}) as VocabularyBookResponse<VocabularyReadingHint[]>;
      if (!response?.success) throw new Error('收藏提示无法读取');
      return response.data;
    },
    translate: (text, context, abort) => translateText(text, document.title, {signal: abort, pageContext: context, useCache: true}),
  });
  let active = true, version = 0;
  let ui: Awaited<ReturnType<typeof createVueShadowUi>> | undefined;
  let pending: Promise<boolean> | undefined;
  let selected: ReadingDomSource | null = null;
  let source: ReadingDomSource | null = null;
  let observer: MutationObserver | undefined;
  let previousFocus: HTMLElement | null = null;
  let openedHref = '';
  const current = () => active && !signal.aborted && !ctx.isInvalid;
  function stopObserver() {observer?.disconnect(); observer = undefined; source = null;}
  function close() {
    version += 1; session.close(); stopObserver(); selected = null; openedHref = ''; ui?.remove(); ui = undefined;
    if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true}); previousFocus = null;
  }
  function useSelection() {
    if (!current()) return;
    const next = captureProgressiveSource(document) ?? selected;
    stopObserver();
    if (!next || !next.valid()) {session.invalidate(); return;}
    source = next; session.useSource(next);
    observer = new MutationObserver(records => {
      if (!current()) return;
      if (ui && !ui.shadowHost.isConnected) {close(); return;}
      if (source?.root.isConnected && !records.some(record => source!.root.contains(record.target) || record.target.contains(source!.root))) return;
      if (source && !source.valid()) {session.invalidate(); stopObserver(); selected = null;}
    });
    observer.observe(document.documentElement, {childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['hidden', 'inert', 'aria-hidden', 'contenteditable', 'translate', 'role', 'data-notranslate', 'data-fluent-read-ui', 'class', 'style']});
  }
  const capture = () => {if (state.open) {const next = captureProgressiveSource(document); if (next) selected = next;}};
  const routeChanged = () => {if (current() && state.open && openedHref !== document.location.href) close();};
  async function open(): Promise<boolean> {
    if (!current()) return false;
    if (ui?.shadowHost.isConnected) return true;
    if (pending) return pending;
    if (ui) close();
    const next = captureProgressiveSource(document);
    previousFocus = document.activeElement as HTMLElement | null;
    openedHref = document.location.href;
    const read = ++version;
    session.open(); selected = next;
    pending = createVueShadowUi(ctx, {name: 'fluent-read-progressive-reading', hostId: 'fluent-read-progressive-reading', component: ProgressiveReading, mode: 'closed',
      props: {state, close, useSelection, assistance: session.assistance},
    }).then(mounted => {
      if (!current() || read !== version) {mounted.remove(); return false;}
      ui = mounted; if (next) useSelection(); return true;
    }).catch(() => {if (read === version) close(); return false;}).finally(() => {pending = undefined;});
    return pending;
  }
  const changed = (message: unknown): undefined => {
    if ((message as {type?: string})?.type === VOCABULARY_BOOK_CHANGED_MESSAGE && current() && state.open) void session.refreshHints();
    return undefined;
  };
  const instance = {open, dispose() {
    if (!active) return;
    active = false; close(); document.removeEventListener('selectionchange', capture); document.removeEventListener('fluentread-route-change', routeChanged);
    try {browser.runtime.onMessage.removeListener(changed);} catch { /* 失效扩展仍释放 DOM。 */ }
    signal.removeEventListener('abort', instance.dispose);
    if (owner === instance) owner = undefined;
  }};
  owner = instance;
  document.addEventListener('selectionchange', capture);
  document.addEventListener('fluentread-route-change', routeChanged);
  browser.runtime.onMessage.addListener(changed);
  signal.addEventListener('abort', instance.dispose, {once: true});
}

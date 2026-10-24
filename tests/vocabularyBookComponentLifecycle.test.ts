import * as runtime from 'vue';
import VocabularyBook from '@/src/features/vocabulary/ui/VocabularyBook.vue';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {VocabularyEntry, VocabularyBookExport} from '@/src/features/vocabulary/learningModel';
import {hasUiLanguageBundle, translate, translateLegacyText, type UiLanguage} from '@/src/core/i18n';
import {createUiI18nPlugin, UI_I18N_KEY, useUiI18n, type UiI18nContext} from '@/src/ui/i18n';
import {createUiLanguageBundleLoader} from '@/src/platform/i18n/uiLanguageBundles';

const languageLoader = vi.hoisted(() => ({ensure: vi.fn<(language: unknown) => Promise<boolean>>()}));
vi.mock('@/src/platform/i18n/uiLanguageBundles', async importOriginal => ({
  ...await importOriginal<typeof import('@/src/platform/i18n/uiLanguageBundles')>(),
  ensureUiLanguageBundle: (language: unknown) => languageLoader.ensure(language),
}));

interface ComponentTestState {
  browser: {
    runtime: {
      sendMessage: (message: Record<string, unknown>) => Promise<unknown>;
      onMessage: {
        addListener: (listener: (message: unknown) => unknown) => void;
        removeListener: (listener: (message: unknown) => unknown) => void;
      };
    };
  };
  config: Record<string, unknown>;
  configReady: Promise<void>;
  requestConfigPatch: (patch: unknown) => Promise<void>;
  subscribeConfig: (callback: (config:any)=>void) => () => void;
  confirm?: (...args: unknown[]) => Promise<unknown>;
}

const TEST_STATE_KEY = '__fluentReadVocabularyLifecycleTest';

function setComponentTestState(state: ComponentTestState | undefined): void {
  const target = globalThis as typeof globalThis & Record<string, unknown>;
  if (state) target[TEST_STATE_KEY] = state;
  else delete target[TEST_STATE_KEY];
}

// SFC imports are instrumented by the shared Vitest/Vite pipeline. Only external ports vary by fixture.
vi.mock('element-plus', () => ({ElMessageBox: {confirm: (...args: unknown[]) => (globalThis as any).__fluentReadVocabularyLifecycleTest.confirm?.(...args) ?? Promise.resolve()}, ElOption: {props:['value','label'],setup:(props:any)=>()=>runtime.h('option',{value:props.value},props.label)}}));
vi.mock('@/src/ui/components/UiSelect.vue', () => ({default: {props:['modelValue'],emits:['update:modelValue'],setup:(props:any,{attrs,slots,emit}:any)=>()=>runtime.h('select',{...attrs,'data-model-value':props.modelValue,onChange:(event:Event)=>emit('update:modelValue',(event.target as HTMLSelectElement).value)},slots.default?.())}}));
vi.mock('@/src/features/vocabulary/ui/VocabularyStudy.vue', () => ({default: {props:['entry','playing'],emits:['close','speak','navigate','updated'],setup:(props:any,{emit}:any)=>()=>runtime.h('section',{'data-study-port':props.entry.id},[runtime.h('button',{'data-study-close':'',onClick:()=>emit('close')},'Back'),runtime.h('button',{'data-study-speak':'',onClick:()=>emit('speak')},props.playing?'Stop':'Speak'),runtime.h('button',{'data-study-settings':'',onClick:()=>emit('navigate','settings-selection')},'Settings'),runtime.h('button',{'data-study-save':'',onClick:()=>emit('updated',{...props.entry,note:'Updated study note'})},'Save')])}}));
vi.mock('webextension-polyfill', () => ({default: {get runtime() {return (globalThis as any).__fluentReadVocabularyLifecycleTest.browser.runtime;}}}));
vi.mock('@/src/services/config/store', () => ({
  get config() {return (globalThis as any).__fluentReadVocabularyLifecycleTest?.config ?? {uiLanguage: 'zh-CN'};},
  get configReady() {return (globalThis as any).__fluentReadVocabularyLifecycleTest.configReady;},
  requestConfigPatch: (...args: unknown[]) => (globalThis as any).__fluentReadVocabularyLifecycleTest.requestConfigPatch(...args),
  getConfigRevision: () => 0,
  subscribeConfig: (...args: unknown[]) => (globalThis as any).__fluentReadVocabularyLifecycleTest.subscribeConfig(...args),
}));

const mountedBooks: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of mountedBooks.splice(0).reverse()) await dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  languageLoader.ensure.mockReset();
  setComponentTestState(undefined);
});

/** 每个普通生命周期用例注入自己的响应式端口，避免 fallbackContext 保留旧 fixture 的 store。 */
function testI18n(language = runtime.ref<UiLanguage>('zh-CN')): UiI18nContext {
  const bundleRevision = runtime.ref(0);
  return {language, bundleRevision, t: (key, params) => {void bundleRevision.value;return translate(key, language.value, params);},
    translateLegacy: value => {void bundleRevision.value;return translateLegacyText(value, language.value);},
    setLanguage: async () => false, dispose: () => undefined};
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}

async function mountBook(confirm: (...args: unknown[]) => Promise<unknown> = async () => undefined,
  response?: (message: Record<string, unknown>) => Promise<unknown>,
  configPatch: (patch: unknown) => Promise<void> = async () => undefined,
  options: {keepAlive?: boolean; ready?: Promise<void>; entries?: (entry: VocabularyEntry) => VocabularyEntry[]; list?: () => Promise<unknown>; language?: UiLanguage; realI18nPlugin?: boolean} = {}) {
  const entry = {id:'saved-a', term:'art', normalizedTerm:'art', identityKey:'en:art', sourceLanguage:'en', kind:'expression',
    translations:{'zh-cn':{text:'艺术',updatedAt:1}}, contexts:[{text:'We study art.',sourceUrl:'https://example.test/private-reading',capturedAt:1}], note:'A saved explanation.', phonetic:'',partOfSpeech:'',
    createdAt:1,updatedAt:1,lastSeenAt:1,encounterCount:1,masteryLevel:0,status:'new',nextReviewAt:1,lastReviewedAt:null,
    reviewCount:0,lapseCount:0,schemaVersion:1} as VocabularyEntry;
  let stored = options.entries?.(entry) ?? [structuredClone(entry)]; const messages: Record<string, unknown>[] = [];
  const listeners = new Set<(message:unknown)=>unknown>();const configListeners = new Set<(config:any)=>void>();const navigate=vi.fn();let listReply=options.list;
  const exported = (): VocabularyBookExport => ({format:'fluentread-vocabulary-book',version:1,exportedAt:1,
    includesPrivateContext:false,entries:structuredClone(stored),reviewLogs:[]});
  const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
    messages.push(message);
    if (message.action === 'list') return listReply ? listReply() : {success:true,data:structuredClone(stored)};
    if (response) return response(message);
    if (message.action === 'clear') {stored = []; return {success:true,data:true};}
    if (message.action === 'exportData') return {success:true,data:exported()};
    if (message.action === 'removeWithSnapshot') return {success:true,data:{entry,reviewLogs:[]}};
    return {success:true,data:{entry:{...entry,status:'mastered'},log:{}}};
  });
  setComponentTestState({browser:{runtime:{sendMessage,onMessage:{addListener:listener=>{listeners.add(listener)},removeListener:listener=>{listeners.delete(listener)}}}},
    config:{on:true,theme:'light',uiLanguage:options.language ?? 'zh-CN',vocabularyBookEnabled:true,selectionTranslatorMode:'disabled',to:'zh-CN'},
    configReady:options.ready ?? Promise.resolve(),requestConfigPatch:configPatch,subscribeConfig:(callback:any)=>{configListeners.add(callback);return()=>configListeners.delete(callback)},confirm});
  const {window} = parseHTML('<html><head></head><body></body></html>');
  Object.defineProperty(window.document,'visibilityState',{configurable:true,value:'visible'});
  window.matchMedia = (() => ({matches:false,addEventListener:()=>undefined,removeEventListener:()=>undefined})) as never;
  for (const key of ['window','document','Node','Element','HTMLElement','SVGElement','Event','navigator'])
    vi.stubGlobal(key,key === 'window' ? window : window[key as keyof typeof window]);
  const download = vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:synthetic-download');
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>undefined);
  const clicks = vi.spyOn(window.HTMLElement.prototype,'click');
  // LinkeDOM exposes these through Proxy getters/setters rather than ordinary own properties.
  const windowAdd = options.keepAlive ? vi.fn(window.addEventListener) : undefined;
  const windowRemove = options.keepAlive ? vi.fn(window.removeEventListener) : undefined;
  if (windowAdd) window.addEventListener = windowAdd;
  if (windowRemove) window.removeEventListener = windowRemove;
  const component = VocabularyBook, doc = window.document;
  const renderer = runtime.createRenderer<any, any>({
    createElement:(tag,ns)=>runtime.markRaw(ns==='svg'?doc.createElementNS('http://www.w3.org/2000/svg',tag):doc.createElement(tag)),
    createText:text=>doc.createTextNode(text),createComment:text=>doc.createComment(text),
    insert:(node,parent,anchor)=>parent.insertBefore(node,anchor||null),remove:node=>node.remove(),
    setText:(node,text)=>{node.nodeValue=text;},setElementText:(node,text)=>{node.textContent=text;},
    parentNode:node=>node.parentNode,nextSibling:node=>node.nextSibling,setScopeId:(node,id)=>node.setAttribute(id,''),
    patchProp(node,key,old,value){
      if(/^on[A-Z]/u.test(key)){const event=key.slice(2).toLowerCase();if(old)node.removeEventListener(event,old);if(value)node.addEventListener(event,value);}
      else if(key==='value'){node._value=value;if(node.tagName!=='SELECT')node.value=value??'';}
      else if(key==='style')Object.assign(node.style,value||{});
      else if(value==null||key==='disabled'&&value===false)node.removeAttribute(key);
      else node.setAttribute(key,String(value));
    },
    insertStaticContent(html,parent,anchor){const box=doc.createElement('div');box.innerHTML=html;const first=box.firstChild!,last=box.lastChild!;while(box.firstChild)parent.insertBefore(box.firstChild,anchor||null);return[first,last];},
  });
  const shown = runtime.ref(true);
  const otherPage = {render: () => null};
  let panel: any;
  let i18n!: UiI18nContext;
  const testLanguage = runtime.ref<UiLanguage>(options.language ?? 'zh-CN');
  const bookNode = () => runtime.h(component,{onNavigate:navigate,ref:(instance:any)=>{if(instance)panel=instance.$.setupState;}});
  const app = renderer.createApp({setup:()=>{i18n = useUiI18n();return ()=>options.keepAlive
    ? runtime.h(runtime.KeepAlive, null, {default: () => shown.value ? bookNode() : runtime.h(otherPage, {key: 'other-page'})})
    : bookNode();}});
  app.config.warnHandler=()=>undefined;
  const host=doc.createElement('main');doc.body.append(host);
  if (options.realI18nPlugin) app.use(createUiI18nPlugin({documentRoot: host as unknown as HTMLElement, uiRoot: null}));
  else app.provide(UI_I18N_KEY, testI18n(testLanguage));
  app.mount(host); let mounted = true; const unmount = () => {if(mounted){mounted=false;app.unmount();}};
  mountedBooks.push(unmount);
  const flush = async () => {for(let i=0;i<12;i++){await Promise.resolve();await runtime.nextTick();}};
  await flush(); if (!options.ready && !options.list) expect(panel.entries).toHaveLength(stored.length);
  return {panel,entry,messages,exported,download,clicks,unmount,flush,shown,window,host,windowAdd,windowRemove,i18n,stored:()=>stored,navigate,listeners,setStored:(entries:VocabularyEntry[])=>{stored=entries},setListReply:(reply?:()=>Promise<unknown>)=>{listReply=reply},emitMessage:(message:unknown)=>{for(const listener of listeners)listener(message)},updateConfig:(patch:Record<string,unknown>)=>{const config=(globalThis as any)[TEST_STATE_KEY].config;Object.assign(config,patch);testLanguage.value = config.uiLanguage;for(const listener of configListeners)listener(config)}};
}

describe('VocabularyBook shared language resources', () => {
  it('updates a cached Chinese fallback when the first Japanese bundle arrives without another config or collection change', async () => {
    expect(hasUiLanguageBundle('ja-JP')).toBe(false);
    const {UI_LANGUAGE_BUNDLES} = await import('@/src/core/i18n/bundles');
    const reply = deferred<{ok: boolean; status: number; json(): Promise<unknown>}>();
    const fetchBundle = vi.fn(() => reply.promise);
    const warn = vi.fn();
    const ensure = createUiLanguageBundleLoader({resolveUrl: path => `fixture:${path}`, fetch: fetchBundle, warn});
    languageLoader.ensure.mockImplementation(ensure);
    const book = await mountBook(undefined, undefined, undefined, {keepAlive: true, entries: () => [], realI18nPlugin: true});
    const heading = book.host.querySelector('.collection-overview h2')!;
    expect(heading.textContent).toBe('0 条收藏');

    book.shown.value = false;
    await book.flush();
    book.updateConfig({uiLanguage: 'ja-JP'});
    await book.flush();
    expect(book.i18n.language.value).toBe('ja-JP');
    expect(book.i18n.bundleRevision.value).toBe(0);
    expect(heading.textContent).toBe('0 条收藏');
    expect(fetchBundle).toHaveBeenCalledOnce();
    expect(fetchBundle).toHaveBeenCalledWith('fixture:i18n/ja-JP.json');
    const messagesBeforeBundle = [...book.messages];

    // 真正的资源加载器完成注册；关闭 DOM 扫描，确保刷新来自共享 bundleRevision。
    reply.resolve({ok: true, status: 200, json: async () => UI_LANGUAGE_BUNDLES['ja-JP']});
    await book.flush();
    expect(book.i18n.bundleRevision.value).toBe(1);
    expect(heading.textContent).toBe('保存済み：0 件');
    expect(book.messages).toEqual(messagesBeforeBundle);
    expect(warn).not.toHaveBeenCalled();
    expect(book.host.querySelector('.collection-overview h2')).toBeNull();

    book.shown.value = true;
    await book.flush();
    expect(book.host.querySelector('.collection-overview h2')).toBe(heading);
    expect(heading.textContent).toBe('保存済み：0 件');
    for (const language of ['zh-CN', 'ja-JP', 'zh-CN', 'ja-JP'] as const) {
      book.updateConfig({uiLanguage: language});
      await book.flush();
      expect(heading.textContent).toBe(language === 'ja-JP' ? '保存済み：0 件' : '0 条收藏');
    }
    expect(fetchBundle).toHaveBeenCalledOnce();
    expect(book.panel.entries).toEqual([]);
  });
});

describe('VocabularyBook asynchronous action ownership', () => {
  it('opens the explicitly chosen entry from a full book and closes it without replacing the collection', async () => {
    const book = await mountBook();
    const originalEntries = Array.from({length:5000},(_,i)=>Object.freeze({...book.entry,id:`saved-${i}`,term:`word ${i}`,identityKey:`en:word ${i}`,normalizedTerm:`word ${i}`,lastSeenAt:i+1}));
    let idReads = 0;
    // 只计数对原冻结记录 ID 的读取，不替换生产 computed 或 Array.find。
    const entries = originalEntries.map(backing => Object.freeze(Object.defineProperty({...backing}, 'id', {
      enumerable: true,
      get() {idReads += 1;return Reflect.get(backing, 'id');},
    }))) as VocabularyEntry[];
    const collection = Object.freeze(entries);
    book.panel.entries = collection;
    idReads = 0;
    expect(book.panel.studyEntry).toBeUndefined();
    const initialIdReads = idReads;
    book.panel.startReview();
    expect(book.panel.reviewStarted).toBe(true);
    book.panel.openStudy(entries[17]);
    expect(book.panel.reviewStarted).toBe(false);
    const readsBefore17 = idReads;
    expect(book.panel.studyEntry).toBe(entries[17]);
    const selected17IdReads = idReads - readsBefore17;
    expect(book.panel.studyEntry.id).not.toBe(entries[4999].id);
    book.panel.openStudy(entries[4321]);
    const readsBefore4321 = idReads;
    expect(book.panel.studyEntry).toBe(entries[4321]);
    const selected4321IdReads = idReads - readsBefore4321;
    book.panel.selectedEntryId = '';
    idReads = 0;
    expect(book.panel.studyEntry).toBeUndefined();
    const closeIdReads = idReads;
    expect(book.panel.entries).toBe(collection);
    expect(book.panel.entries.map((item:VocabularyEntry)=>item.id)).toEqual(entries.map(item=>item.id));
    // 所有原业务、实例身份与集合断言先完成，再核对受控读取数。
    expect(initialIdReads).toBe(0);expect(selected17IdReads).toBe(18);
    expect(selected4321IdReads).toBe(4322);expect(closeIdReads).toBe(0);
  });
  it('keeps an empty-ID raw row in the collection without selecting it automatically', async () => {
    const book = await mountBook();
    // 空选择是 UI 的未选中状态；异常原始行保留原样，不在这里迁移、清洗或删除记录。
    const emptyIdRow = Object.freeze({...book.entry, id:'', term:'Raw empty row', normalizedTerm:'raw empty row', identityKey:'en\u0000raw empty row'});
    const validRow = Object.freeze({...book.entry, id:'00000000-0000-4000-8000-000000000001', term:'Selected valid row', normalizedTerm:'selected valid row', identityKey:'en\u0000selected valid row'});
    const collection = Object.freeze([emptyIdRow, validRow]);
    book.panel.entries = collection;
    expect(book.panel.selectedEntryId).toBe('');
    expect(book.panel.studyEntry).toBeUndefined();
    expect(book.panel.entries).toBe(collection);
    expect(book.panel.entries[0]).toBe(emptyIdRow);
    expect(book.panel.entries.map((item: VocabularyEntry) => item.id)).toEqual(['', validRow.id]);
    book.panel.openStudy(validRow);
    expect(book.panel.studyEntry).toBe(validRow);
    expect(book.panel.selectedEntryId).toBe(validRow.id);
    book.panel.selectedEntryId = '';
    expect(book.panel.studyEntry).toBeUndefined();
    expect(book.panel.entries).toBe(collection);
    expect(book.panel.entries[0]).toBe(emptyIdRow);
    expect(book.messages.filter(message => message.action && message.action !== 'list')).toEqual([]);
  });
  it.each(['clearVocabulary','exportAnki','removeEntry'])('does not start %s after its confirmation outlives the book', async action => {
    const confirmation = deferred<unknown>(); const book = await mountBook(()=>confirmation.promise);
    const pending = book.panel[action](book.entry); book.unmount(); confirmation.resolve(undefined); await pending;
    expect(book.messages.filter(message=>message.action && message.action!=='list')).toEqual([]);
    expect(book.stored()).toHaveLength(1); expect(book.download).not.toHaveBeenCalled();
  });
  it.each(['clearVocabulary','exportAnki'])('holds the action slot while %s awaits confirmation and releases it on cancel', async action => {
    const confirmation = deferred<unknown>(); const book = await mountBook(()=>confirmation.promise);
    const pending = book.panel[action]();
    expect(book.panel.actionBusy).toBe(true);
    await book.panel.setMastered(book.entry); const duplicate = book.panel[action]();
    expect(book.messages.filter(message=>message.action && message.action!=='list')).toEqual([]);
    // close 和 cancel 对 Anki 含义不同，用 close 代表用户取消导出。
    confirmation.resolve(Promise.reject('close')); await pending; await duplicate;
    expect(book.panel.actionBusy).toBe(false); expect(book.stored()).toHaveLength(1);
  });
  it.each(['clearVocabulary','exportAnki'])('does not focus a detached menu or send %s after unmounting at menu close', async action => {
    const book = await mountBook(); const focus = vi.fn();
    vi.spyOn(book.panel.moreMenu, 'querySelector').mockReturnValue({focus} as any);
    Object.defineProperty(book.panel.moreMenu, 'open', {configurable:true,get(){return true;},set(_value:boolean){book.unmount();}});
    await book.panel[action]();
    expect(focus).not.toHaveBeenCalled(); expect(book.messages.filter(message=>message.action && message.action!=='list')).toEqual([]);
  });
  it.each(['setBetaEnabled','setReencounterEnabled'])('ignores %s failure rollback after the book unmounts', async action => {
    const response = deferred<unknown>(); const patch = vi.fn(async () => {await response.promise;});
    const book = await mountBook(undefined,undefined,patch);
    const pending = book.panel[action](action === 'setReencounterEnabled');
    const before = {beta:book.panel.betaEnabled,reencounter:book.panel.reencounterEnabled};
    book.unmount(); response.resolve(Promise.reject(new Error('synthetic config failure'))); await pending;
    expect({beta:book.panel.betaEnabled,reencounter:book.panel.reencounterEnabled}).toEqual(before);
    await book.panel[action](action !== 'setReencounterEnabled'); expect(patch).toHaveBeenCalledTimes(1);
  });
  it('does not copy or request a collection export through an unmounted action reference', async () => {
    const book = await mountBook(); const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator',{clipboard:{writeText}}); book.unmount();
    await book.panel.copyEntry(book.entry,true); await book.panel.exportCollection();
    expect(writeText).not.toHaveBeenCalled(); expect(book.messages.filter(message=>message.action!=='list')).toEqual([]);
    expect(book.download).not.toHaveBeenCalled();
  });
  it('removes and restores an entry with its snapshot while releasing the action slot', async () => {
    const book = await mountBook();
    await book.panel.removeEntry(book.entry);
    expect(book.panel.entries).toEqual([]); expect(book.panel.actionBusy).toBe(false);
    expect(book.panel.undoExport.entries).toEqual([book.entry]);
    await book.panel.undoRemove();
    expect(book.panel.undoExport).toBeNull(); expect(book.panel.entries).toEqual([book.entry]);
    expect(book.messages.find(message => message.action === 'importData')?.data).toMatchObject({entries:[book.entry]});
    expect(book.panel.actionBusy).toBe(false);
  });
  it('releases a failed clear for retry and still resets the active review after success', async () => {
    let attempts = 0;
    const book = await mountBook(undefined, async () => ++attempts === 1
      ? {success:false,error:{code:'storage-error',message:'synthetic transient failure'}} : {success:true,data:true});
    book.panel.startReview();
    await book.panel.clearVocabulary();
    expect(book.panel.entries).toHaveLength(1); expect(book.panel.actionBusy).toBe(false);
    await book.panel.clearVocabulary();
    expect(book.panel.entries).toEqual([]); expect(book.panel.reviewStarted).toBe(false);
    expect(book.panel.actionBusy).toBe(false); expect(attempts).toBe(2);
  });
  it.each([false,true])('exports Anki with explanation and the chosen context privacy (%s)', async includeContext => {
    const book = await mountBook(async () => {if (includeContext) throw 'cancel';});
    await book.panel.exportAnki();
    expect(book.panel.actionBusy).toBe(false); expect(book.download).toHaveBeenCalledTimes(1);
    const body = await (book.download.mock.calls[0][0] as Blob).text();
    expect(body).toContain('Term\tMeaning\tExplanation\tContext\tSource\tTags');
    expect(body).toContain('A saved explanation.');
    expect(body.includes('We study art.')).toBe(includeContext);
    expect(body.includes('https://example.test/private-reading')).toBe(includeContext);
    expect(book.messages.find(message => message.action === 'exportData')?.options).toEqual({includePrivateContext:includeContext});
  });
  it('reserves a large import during confirmation and does not read it on cancellation', async () => {
    const confirmation = deferred<unknown>(); const book = await mountBook(() => confirmation.promise);
    const text = vi.fn(); const input = {value:'selected.json',files:[{size:21*1024*1024,text}]};
    const pending = book.panel.importCollection({target:input});
    expect(input.value).toBe(''); expect(book.panel.actionBusy).toBe(true);
    await book.panel.setMastered(book.entry);
    confirmation.resolve(Promise.reject('cancel')); await pending;
    expect(text).not.toHaveBeenCalled(); expect(book.messages.filter(message=>message.action!=='list')).toEqual([]);
    expect(book.panel.actionBusy).toBe(false);
  });
  it('releases a malformed import for retry and imports a valid collection afterwards', async () => {
    const book = await mountBook(undefined, async () => ({success:true,data:{inserted:1,updated:0,skipped:0}}));
    await book.panel.importCollection({target:{value:'bad.json',files:[{size:10,text:async()=>'{'}]}});
    expect(book.panel.actionBusy).toBe(false); expect(book.messages.filter(message=>message.action==='importData')).toEqual([]);
    await book.panel.importCollection({target:{value:'good.json',files:[{size:10,text:async()=>JSON.stringify(book.exported())}]}});
    expect(book.messages.filter(message=>message.action==='importData')).toHaveLength(1);
    expect(book.panel.entries).toHaveLength(1); expect(book.panel.actionBusy).toBe(false);
  });
  it('keeps the undo snapshot unchanged when a restore response outlives the book', async () => {
    const response = deferred<unknown>();
    const book = await mountBook(undefined, async message => message.action==='removeWithSnapshot'
      ? {success:true,data:{entry:book.entry,reviewLogs:[]}} : response.promise);
    await book.panel.removeEntry(book.entry); const snapshot = book.panel.undoExport;
    const pending = book.panel.undoRemove(); await book.flush(); book.unmount();
    response.resolve({success:true,data:{inserted:1,updated:0,skipped:0}}); await pending;
    expect(book.panel.undoExport).toBe(snapshot); expect(book.panel.entries).toEqual([]);
  });
  it('never creates a late Anki download after an exported response outlives the book', async () => {
    const exportResponse = deferred<unknown>(); const book = await mountBook(undefined,()=>exportResponse.promise);
    const pending = book.panel.exportAnki(); await book.flush();
    expect(book.messages.filter(message=>message.action==='exportData')).toHaveLength(1);
    book.unmount(); exportResponse.resolve({success:true,data:book.exported()}); await pending;
    expect(book.download).not.toHaveBeenCalled(); expect(book.clicks).not.toHaveBeenCalled();
  });
  it.each(['rateReview','setMastered','relearn','removeEntry','clearVocabulary'])('ignores %s completion after unmounting while leaving committed backend work alone', async action => {
    const response = deferred<unknown>(); const book = await mountBook(undefined,()=>response.promise);
    book.panel.startReview(); book.panel.reviewAnswerVisible = true;
    const pending = action==='rateReview' ? book.panel.rateReview('good') : book.panel[action](book.entry);
    await book.flush(); const before = JSON.stringify({entries:book.panel.entries,stats:book.panel.reviewStats,queue:book.panel.reviewQueue,undo:book.panel.undoExport});
    book.unmount(); response.resolve({success:true,data:action==='clearVocabulary' ? true : action==='removeEntry' ? {entry:book.entry,reviewLogs:[]} : {entry:{...book.entry,status:'mastered',updatedAt:2},log:{}}}); await pending;
    expect(JSON.stringify({entries:book.panel.entries,stats:book.panel.reviewStats,queue:book.panel.reviewQueue,undo:book.panel.undoExport})).toBe(before);
  });
});

describe('VocabularyBook mounted lifecycle', () => {
  it('refreshes failed optimistic updates from authoritative config without rewriting it', () => {
    const component = readFileSync(resolve(
      process.cwd(),
      'src/features/vocabulary/ui/VocabularyBook.vue',
    ), 'utf8');

    expect(component).toContain('betaEnabled.value = runtimeConfig.vocabularyBookEnabled === true;');
    expect(component).not.toContain('runtimeConfig.vocabularyBookEnabled = previous;');
  });

  it('does not subscribe, register listeners, or list after unmounting before configReady', async () => {
    const calls = {
      runtimeAdd: 0,
      runtimeSend: 0,
      subscribe: 0,
    };
    let resolveConfigReady!: () => void;
    const configReady = new Promise<void>((resolveReady) => { resolveConfigReady = resolveReady; });
    setComponentTestState({
      browser: {
        runtime: {
          sendMessage: async () => {
            calls.runtimeSend += 1;
            return { success: true, data: [] };
          },
          onMessage: {
            addListener: () => { calls.runtimeAdd += 1; },
            removeListener: () => undefined,
          },
        },
      },
      config: {
        theme: 'auto',
        vocabularyBookEnabled: false,
        selectionTranslatorMode: 'disabled',
        to: 'zh-CN',
      },
      configReady,
      requestConfigPatch: async () => undefined,
      subscribeConfig: () => {
        calls.subscribe += 1;
        return () => undefined;
      },
    });

    const { window } = parseHTML('<html><body><div id="app"></div></body></html>');
    const { document } = window;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const windowAdd = vi.fn();
    const windowRemove = vi.fn();
    Object.defineProperties(window, {
      addEventListener: { configurable: true, value: windowAdd },
      removeEventListener: { configurable: true, value: windowRemove },
    });
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const mediaAdd = vi.fn();
    const mediaRemove = vi.fn();
    const matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: mediaAdd,
      removeEventListener: mediaRemove,
    }));
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    vi.stubGlobal('window', window);
    vi.stubGlobal('document', document);
    vi.stubGlobal('Node', window.Node);
    vi.stubGlobal('Element', window.Element);
    vi.stubGlobal('HTMLElement', window.HTMLElement);
    vi.stubGlobal('SVGElement', window.SVGElement);
    vi.stubGlobal('Event', window.Event);
    vi.stubGlobal('navigator', window.navigator);

    const vueRuntime = runtime;
    const component = {...VocabularyBook, render: () => null};
      const renderer = vueRuntime.createRenderer<Record<string, never>, Record<string, unknown>>({
        patchProp: () => undefined,
        insert: () => undefined,
        remove: () => undefined,
        createElement: () => ({}),
        createText: () => ({}),
        createComment: () => ({}),
        setText: () => undefined,
        setElementText: () => undefined,
        parentNode: () => null,
        nextSibling: () => null,
        querySelector: () => null,
        setScopeId: () => undefined,
        cloneNode: () => ({}),
        insertStaticContent: () => [{}, {}],
      });
      const app = renderer.createApp(component as import('vue').Component);
      app.provide(UI_I18N_KEY, testI18n());
      app.config.warnHandler = () => undefined;
      app.mount({});
      await vueRuntime.nextTick();
      expect(matchMedia).toHaveBeenCalledTimes(1);

      app.unmount();
      resolveConfigReady();
      await configReady;
      await Promise.resolve();
      await Promise.resolve();

      expect(calls).toEqual({ runtimeAdd: 0, runtimeSend: 0, subscribe: 0 });
      expect(windowAdd.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
      expect(documentAdd.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(0);
      expect(mediaAdd).toHaveBeenCalledTimes(1);
      expect(mediaRemove).toHaveBeenCalledTimes(1);
  });
});

describe('VocabularyBook cached review keyboard ownership', () => {
  type Book = Awaited<ReturnType<typeof mountBook>>;
  function dispatchKey(book: Book, key: string): Event {
    const event = new book.window.Event('keydown', {bubbles: true, cancelable: true});
    Object.assign(event, {key: key === 'Space' ? ' ' : key, code: key === 'Space' ? 'Space' : key});
    // The window listener receives a body-bubbled keyboard target; LinkeDOM's direct window dispatch otherwise uses document as target.
    Object.defineProperty(event, 'target', {configurable: true, get: () => book.window.document.body, set: () => undefined});
    book.window.dispatchEvent(event);
    return event;
  }
  function reviewSnapshot(book: Book) {
    return {started: book.panel.reviewStarted, answer: book.panel.reviewAnswerVisible, index: book.panel.reviewIndex,
      draft: book.panel.recallDraft, queue: book.panel.reviewQueue.map((entry: VocabularyEntry) => entry.id),
      stats: {...book.panel.reviewStats}};
  }
  const reviewMessages = (book: Book) => book.messages.filter(message => message.action === 'review');
  const listenerCalls = (spy: NonNullable<Book['windowAdd']>) => spy.mock.calls.filter(([type]) => type === 'keydown');

  it.each(['Space', '1', '2', 'Escape'])('ignores hidden %s and resumes the same review on return without duplicate listeners', async key => {
    const book = await mountBook(undefined, undefined, undefined, {keepAlive: true});
    book.panel.startReview();await book.flush();
    book.panel.reviewAnswerVisible = key !== 'Space';book.panel.recallDraft = 'Retained recall draft';await book.flush();
    const before = reviewSnapshot(book);
    for (let cycle = 0; cycle < 2; cycle += 1) {
      book.shown.value = false;await book.flush();
      const hidden = dispatchKey(book, key);await book.flush();
      expect(reviewSnapshot(book)).toEqual(before);expect(reviewMessages(book)).toEqual([]);
      expect(hidden.defaultPrevented).toBe(false);
      book.shown.value = true;await book.flush();
      expect(reviewSnapshot(book)).toEqual(before);expect(listenerCalls(book.windowAdd!)).toHaveLength(1);
    }
    const visible = dispatchKey(book, key);await book.flush();expect(visible.defaultPrevented).toBe(true);
    if (key === 'Space') {expect(book.panel.reviewAnswerVisible).toBe(true);expect(reviewMessages(book)).toEqual([]);}
    else if (key === 'Escape') {expect(book.panel.reviewStarted).toBe(false);expect(reviewMessages(book)).toEqual([]);}
    else {expect(reviewMessages(book)).toHaveLength(1);expect(reviewMessages(book)[0]).toMatchObject({entryId: book.entry.id, rating: key === '1' ? 'again' : 'good'});}
    book.unmount();expect(listenerCalls(book.windowRemove!)).toHaveLength(1);
    expect(listenerCalls(book.windowRemove!)[0][1]).toBe(listenerCalls(book.windowAdd!)[0][1]);
  });

  it('keeps keyboard inactive when configReady completes after caching and restores it only on return', async () => {
    const ready = deferred<void>();
    const book = await mountBook(undefined, undefined, undefined, {keepAlive: true, ready: ready.promise});
    try {
      expect(listenerCalls(book.windowAdd!)).toHaveLength(0);expect(book.messages).toEqual([]);
      book.shown.value = false;await book.flush();ready.resolve();await book.flush();
      expect(book.panel.entries).toHaveLength(1);book.panel.startReview();await book.flush();
      book.panel.recallDraft = 'Ready while cached';const before = reviewSnapshot(book);
      const hidden = dispatchKey(book, 'Space');await book.flush();
      expect(reviewSnapshot(book)).toEqual(before);expect(reviewMessages(book)).toEqual([]);expect(hidden.defaultPrevented).toBe(false);
      book.shown.value = true;await book.flush();expect(reviewSnapshot(book)).toEqual(before);
      const visible = dispatchKey(book, 'Space');await book.flush();expect(visible.defaultPrevented).toBe(true);
      expect(book.panel.reviewAnswerVisible).toBe(true);expect(listenerCalls(book.windowAdd!)).toHaveLength(1);
    } finally {ready.resolve();book.unmount();await book.flush();}
  });

  it('removes its one keyboard listener on unmount and leaves the retained review unchanged for late keys', async () => {
    const book = await mountBook(undefined, undefined, undefined, {keepAlive: true});
    book.panel.startReview();await book.flush();book.panel.recallDraft = 'Unmounted draft';const before = reviewSnapshot(book);
    book.unmount();expect(listenerCalls(book.windowAdd!)).toHaveLength(1);expect(listenerCalls(book.windowRemove!)).toHaveLength(1);
    expect(listenerCalls(book.windowRemove!)[0][1]).toBe(listenerCalls(book.windowAdd!)[0][1]);
    for (const key of ['Space', '1', '2', 'Escape']) expect(dispatchKey(book, key).defaultPrevented).toBe(false);
    await book.flush();expect(reviewSnapshot(book)).toEqual(before);expect(reviewMessages(book)).toEqual([]);
  });

  it('continues a visibly accepted review write while cached and settles the existing session once', async () => {
    const result = deferred<unknown>();
    const book = await mountBook(undefined, () => result.promise, undefined, {keepAlive: true});
    const saved = {...book.entry, status: 'learning' as const, reviewCount: 1, lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 86400000};
    try {
      book.panel.startReview();await book.flush();book.panel.reviewAnswerVisible = true;
      expect(dispatchKey(book, '2').defaultPrevented).toBe(true);await book.flush();
      expect(reviewMessages(book)).toHaveLength(1);expect(book.panel.actionBusy).toBe(true);
      book.shown.value = false;await book.flush();book.stored().splice(0, 1, saved);
      result.resolve({success: true, data: {entry: saved, log: {}}});await book.flush();
      expect(book.stored()[0]).toEqual(saved);expect(book.panel.entries[0]).toEqual(saved);
      expect(book.panel.reviewStats).toEqual({reviewed: 1, good: 1, again: 0});expect(book.panel.reviewIndex).toBe(1);
      expect(book.panel.actionBusy).toBe(false);expect(reviewMessages(book)).toHaveLength(1);
      book.shown.value = true;await book.flush();expect(book.panel.reviewStats.reviewed).toBe(1);
      expect(listenerCalls(book.windowAdd!)).toHaveLength(1);
    } finally {result.resolve({success: true, data: {entry: saved, log: {}}});await book.flush();book.unmount();}
  });
});

async function clickBook(book: Awaited<ReturnType<typeof mountBook>>, target: Element) {
  expect(target.hasAttribute('disabled')).toBe(false);
  target.dispatchEvent(new book.window.Event('click',{bubbles:true,cancelable:true}));await book.flush();
}
function bookButton(book: Awaited<ReturnType<typeof mountBook>>, text: string) {
  const target=[...book.host.querySelectorAll('button')].find(button=>button.textContent?.trim()===text);expect(target,`button ${text}`).toBeTruthy();return target!;
}
it('copies through the rendered collection row, filters and resets it, then removes and restores the same saved entry',async()=>{
  const confirm=vi.fn(async()=>undefined);const book=await mountBook(confirm);const copy=vi.fn(async()=>{});vi.stubGlobal('navigator',{clipboard:{writeText:copy}});
  await clickBook(book,bookButton(book,'复制双语'));await clickBook(book,bookButton(book,'复制原文'));expect(copy.mock.calls).toEqual([['art\n艺术'],['art']]);
  copy.mockRejectedValueOnce(new Error('blocked'));await clickBook(book,bookButton(book,'复制原文'));expect(book.host.textContent).toContain('复制失败');
  const search=book.host.querySelector<HTMLInputElement>('input[type="search"]')!;search.value='unmatched';search.dispatchEvent(new book.window.Event('input',{bubbles:true}));await book.flush();expect(book.host.querySelector('.word-row')).toBeNull();
  await clickBook(book,book.host.querySelector('.collection-results button')!);expect(book.host.querySelector('.entry-open')?.textContent).toBe('art');
  await clickBook(book,bookButton(book,'删除收藏'));expect(confirm).toHaveBeenCalledOnce();expect(book.host.querySelector('.word-row')).toBeNull();expect(book.messages).toContainEqual({type:'fluentReadVocabularyBook',action:'removeWithSnapshot',entryId:'saved-a'});
  await clickBook(book,bookButton(book,'撤销'));expect(book.host.querySelector('.entry-open')?.textContent).toBe('art');expect(book.messages).toContainEqual(expect.objectContaining({action:'importData',data:expect.objectContaining({includesPrivateContext:true,entries:[book.entry]})}));
});
it('completes a review through the rendered recall form and rating control without changing the collection identity',async()=>{
  const book=await mountBook();await clickBook(book,book.host.querySelector('.start-review')!);
  const recall=book.host.querySelector<HTMLTextAreaElement>('.recall-draft')!;recall.value='An expression for creativity.';recall.dispatchEvent(new book.window.Event('input',{bubbles:true}));await book.flush();
  await clickBook(book,book.host.querySelector('.reveal-button')!);expect(book.host.textContent).toContain('An expression for creativity.');expect(book.host.textContent).toContain('艺术');
  await clickBook(book,book.host.querySelector('.review-actions .good')!);expect(book.messages).toContainEqual({type:'fluentReadVocabularyBook',action:'review',entryId:'saved-a',rating:'good'});expect(book.host.textContent).toContain('本轮复习完成');
  await clickBook(book,book.host.querySelector('.review-complete button')!);expect(book.host.querySelector('.entry-open')?.textContent).toBe('art');
});
it('opens the collection picker and imports its selected file through the real change handler',async()=>{
  const book=await mountBook(undefined,async message=>message.action==='importData'?{success:true,data:{inserted:1,updated:0,skipped:0}}:{success:false});
  const input=book.host.querySelector<HTMLInputElement>('input[type="file"]')!;const picker=vi.spyOn(input,'click').mockImplementation(()=>{});
  await clickBook(book,bookButton(book,'导入收藏'));expect(picker).toHaveBeenCalledOnce();
  const payload=book.exported();Object.defineProperty(input,'files',{configurable:true,value:[{size:200,text:async()=>JSON.stringify(payload)}]});input.dispatchEvent(new book.window.Event('change',{bubbles:true}));await book.flush();
  expect(book.messages).toContainEqual({type:'fluentReadVocabularyBook',action:'importData',data:payload});expect(book.host.textContent).toContain('新增 1 条，更新 0 条，跳过 0 条');expect(book.host.querySelector('.entry-open')?.textContent).toBe('art');
});

it('keeps an offscreen reading active across matching progress messages and only clears it on terminal playback state',async()=>{
  const book=await mountBook(undefined,async message=>message.type==='selectionTts'?{success:true,transport:'offscreen'}:{success:true});
  await clickBook(book,book.host.querySelector('.entry-icon')!);
  const request=book.messages.find(message=>message.type==='selectionTts')!;
  expect(book.host.querySelector('.entry-icon')?.getAttribute('aria-label')).toBe('停止朗读');
  book.emitMessage({type:'selectionTtsState',clientRequestId:request.clientRequestId,state:'progress',progress:{charIndex:1}});await book.flush();
  expect(book.host.querySelector('.entry-icon')?.getAttribute('aria-label')).toBe('停止朗读');
  book.emitMessage({type:'selectionTtsState',clientRequestId:'unrelated',state:'ended'});await book.flush();
  expect(book.host.querySelector('.entry-icon')?.getAttribute('aria-label')).toBe('停止朗读');
  book.emitMessage({type:'selectionTtsState',clientRequestId:request.clientRequestId,state:'ended'});await book.flush();
  expect(book.host.querySelector('.entry-icon')?.getAttribute('aria-label')).toBe('朗读原文');
  expect(book.messages.filter(message=>message.type==='selectionTtsStop')).toEqual([]);
});

function speechBookPorts(book: Awaited<ReturnType<typeof mountBook>>) {
  const spoken:any[]=[],audios:any[]=[],cancel=vi.fn();
  vi.stubGlobal('SpeechSynthesisUtterance',class {lang='';voice:unknown=null;onend:Function|null=null;onerror:Function|null=null;constructor(public text:string){}});
  Object.defineProperty(book.window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{lang:'en-US',name:'English'}],speak:(value:unknown)=>spoken.push(value),cancel}});
  vi.stubGlobal('Audio',class {onended:Function|null=null;onerror:Function|null=null;pause=vi.fn();removeAttribute=vi.fn();play=vi.fn(async()=>{});constructor(public src:string){audios.push(this)}});
  return {spoken,audios,cancel};
}
it('releases page audio on completion and falls back once on error, ignoring callbacks from old audio and utterances',async()=>{
  const book=await mountBook(undefined,async message=>message.type==='selectionTts'
    ? {success:true,transport:'page',audioBase64:'AA=='}
    : message.type==='selectionTtsGoogle' ? {success:false,error:'Google unavailable'} : {success:true});
  const media=speechBookPorts(book),browserError={error:'synthesis-failed'};
  const click=()=>clickBook(book,book.host.querySelector('.entry-icon')!);
  await click();const first=media.audios[0],oldEnded=first.onended;first.onended();await book.flush();expect(first.pause).toHaveBeenCalledOnce();expect(first.removeAttribute).toHaveBeenCalledWith('src');expect(book.panel.playingEntryId).toBe('');
  await click();const second=media.audios[1];oldEnded();await book.flush();expect(book.host.querySelector('.entry-icon')?.getAttribute('aria-label')).toBe('停止朗读');
  second.onerror();await book.flush();expect(media.spoken).toHaveLength(1);expect(second.pause).toHaveBeenCalledOnce();expect(media.spoken[0].text).toBe('art');
  expect(book.messages.filter(message=>message.type==='selectionTtsGoogle')).toHaveLength(1);
  second.onerror();await book.flush();expect(media.spoken).toHaveLength(1);
  expect(book.messages.filter(message=>message.type==='selectionTtsGoogle')).toHaveLength(1);
  media.spoken[0].onend();await book.flush();expect(book.panel.playingEntryId).toBe('');
  await click();media.audios[2].onerror();await book.flush();expect(media.spoken).toHaveLength(2);
  expect(book.messages.filter(message=>message.type==='selectionTtsGoogle')).toHaveLength(2);
  media.spoken[0].onerror(browserError);await book.flush();expect(book.panel.playingEntryId).toBe('saved-a');
  media.spoken[1].onerror(browserError);await book.flush();
  expect(book.host.textContent).toContain('浏览器语音启动失败：synthesis-failed');
  expect(book.host.textContent).toContain('Google 回退：Google unavailable');
  expect(book.panel.playingEntryId).toBe('');expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
});
it('handles remote playback failure and visibility changes through mounted listeners, and refreshes only for the correct book message',async()=>{
  const book=await mountBook(undefined,async message=>message.type==='selectionTts'?{success:true,transport:'offscreen'}:{success:true});const media=speechBookPorts(book);
  await clickBook(book,book.host.querySelector('.entry-icon')!);const request=book.messages.find(message=>message.type==='selectionTts')!;
  book.emitMessage({type:'selectionTtsState',clientRequestId:request.clientRequestId,state:'error'});await book.flush();expect(media.spoken).toHaveLength(1);
  Object.defineProperty(book.window.document,'visibilityState',{configurable:true,value:'hidden'});book.window.document.dispatchEvent(new book.window.Event('visibilitychange'));await book.flush();expect(book.panel.playingEntryId).toBe('');expect(media.cancel).toHaveBeenCalled();
  const before=book.messages.filter(message=>message.action==='list').length;book.emitMessage({type:'unrelated'});await book.flush();expect(book.messages.filter(message=>message.action==='list')).toHaveLength(before);
  book.setStored([{...book.entry,term:'updated source',updatedAt:3}]);book.emitMessage({type:'fluentReadVocabularyBookChanged'});await book.flush();expect(book.host.querySelector('.entry-open')?.textContent).toBe('updated source');
  Object.defineProperty(book.window.document,'visibilityState',{configurable:true,value:'visible'});book.window.document.dispatchEvent(new book.window.Event('visibilitychange'));await book.flush();expect(book.messages.filter(message=>message.action==='list')).toHaveLength(before+2);
  const old=[...book.listeners];book.unmount();expect(book.listeners.size).toBe(0);for(const listener of old)listener({type:'fluentReadVocabularyBookChanged'});expect(book.messages.filter(message=>message.action==='list')).toHaveLength(before+2);
});
it('retries a failed list from its rendered error control and coalesces notifications without committing an obsolete list',async()=>{
  const book=await mountBook(undefined,undefined,undefined,{list:async()=>({success:false,error:{message:'Temporary listing failure'}})});
  expect(book.host.querySelector('.error-state')?.textContent).toContain('Temporary listing failure');book.setListReply();await clickBook(book,book.host.querySelector('.error-state button')!);expect(book.host.querySelector('.entry-open')?.textContent).toBe('art');
  const old=deferred<unknown>();book.setListReply(()=>old.promise);book.emitMessage({type:'fluentReadVocabularyBookChanged'});await book.flush();book.emitMessage({type:'fluentReadVocabularyBookChanged'});book.setListReply();book.setStored([{...book.entry,term:'current source'}]);old.resolve({success:true,data:[{...book.entry,term:'obsolete source'}]});await book.flush();
  expect(book.host.querySelector('.entry-open')?.textContent).toBe('current source');expect(book.host.textContent).not.toContain('obsolete source');
});

async function chooseBook(book:Awaited<ReturnType<typeof mountBook>>,label:string,value:string){
  const select=book.host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;expect(select).toBeTruthy();
  Object.defineProperty(select,'value',{configurable:true,value});select.dispatchEvent(new book.window.Event('change',{bubbles:true}));await book.flush();
}
async function searchBook(book:Awaited<ReturnType<typeof mountBook>>,value:string):Promise<void>{
  const search=book.host.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.value=value;search.dispatchEvent(new book.window.Event('input',{bubbles:true}));await book.flush();
}
it('does not reread unchanged collection bodies or sort again for each immediate search input',async()=>{
  const reads={body:0,sort:0};let entries:VocabularyEntry[]=[];
  const book=await mountBook(undefined,undefined,undefined,{
    entries:entry=>entries=Array.from({length:5000},(_,index)=>({...entry,id:`search-${index}`,term:`reading-${index}`,normalizedTerm:`reading-${index}`,
      translations:{'zh-cn':{text:'阅读',updatedAt:2},en:{get text(){reads.body++;return 'reading reference';},updatedAt:1}},
      contexts:Array.from({length:8},()=>({text:'We practice reading.',pageTitle:'Reading practice',capturedAt:1})),
      get lastSeenAt(){reads.sort++;return index;}})),list:async()=>({success:true,data:entries}),
  });
  expect(reads.body).toBe(0);expect(book.host.querySelectorAll('.word-row')).toHaveLength(50);
  await searchBook(book,'rea');expect(book.panel.filteredEntries).toHaveLength(5000);
  const warm={...reads};
  for(const value of ['read','readi','readin','reading'])await searchBook(book,value);
  expect({body:reads.body-warm.body,sort:reads.sort-warm.sort}).toEqual({body:0,sort:0});
  expect(book.host.querySelector('.entry-open')?.textContent).toBe('reading-4999');
  expect(book.host.querySelectorAll('.word-row')).toHaveLength(50);
});
it('matches every saved search field and cross-field phrases, and refreshes nested additions, changes and deletions',async()=>{
  const book=await mountBook(undefined,undefined,undefined,{entries:(entry):VocabularyEntry[]=>[
    {...entry,id:'fields',term:'Displayed',normalizedTerm:'normalizedToken',note:'noteNeedle',
      translations:{'zh-cn':{text:'Primary translation',updatedAt:2},en:{text:'Second translation',updatedAt:1}},
      contexts:[{text:'First context',pageTitle:'First title',capturedAt:1},{text:'Deep context',pageTitle:'Deep title',capturedAt:2}]},
    {...entry,id:'other',term:'other',normalizedTerm:'other',note:'',translations:{},contexts:[]},
  ]});
  const matches=()=>book.panel.filteredEntries.map((entry:VocabularyEntry)=>entry.id);
  for(const value of ['DISPLAYED','normalizedToken','noteNeedle','primary translation','second translation','first context','deep context','Deep Title','displayed normalizedToken']){
    await searchBook(book,value);expect(matches(),value).toEqual(['fields']);
  }
  await searchBook(book,'new-needle');expect(matches()).toEqual([]);
  const entry=book.panel.entries[0] as VocabularyEntry;
  entry.note='new-needle';await book.flush();expect(matches()).toEqual(['fields']);
  delete entry.note;await book.flush();expect(matches()).toEqual([]);
  entry.translations.fr={text:'new-needle',updatedAt:3};await book.flush();expect(matches()).toEqual(['fields']);
  entry.translations.fr.text='changed';await book.flush();expect(matches()).toEqual([]);
  entry.translations.fr.text='new-needle';await book.flush();expect(matches()).toEqual(['fields']);
  delete entry.translations.fr;await book.flush();expect(matches()).toEqual([]);
  entry.contexts.push({text:'new-needle',capturedAt:3});await book.flush();expect(matches()).toEqual(['fields']);
  entry.contexts.at(-1)!.text='changed';await book.flush();expect(matches()).toEqual([]);
  entry.contexts.at(-1)!.pageTitle='new-needle';await book.flush();expect(matches()).toEqual(['fields']);
  delete entry.contexts.at(-1)!.pageTitle;await book.flush();expect(matches()).toEqual([]);
  entry.contexts[0].text='new-needle';await book.flush();expect(matches()).toEqual(['fields']);
  entry.contexts.splice(0,1);await book.flush();expect(matches()).toEqual([]);
  book.panel.entries=[{...entry,term:'new-needle',normalizedTerm:'replacement'}];await book.flush();expect(matches()).toEqual(['fields']);
  book.panel.entries=[];await book.flush();expect(matches()).toEqual([]);
});
it('keeps stable ordering, due and kind filters, and page reset while query matching uses cached text',async()=>{
  const book=await mountBook(undefined,undefined,undefined,{entries:entry=>Array.from({length:60},(_,index)=>({...entry,id:`stable-${index}`,term:`reading-${index}`,normalizedTerm:'same',
    kind:index%2?'sentence':'expression',status:index%3?'learning':'mastered',lastSeenAt:1,createdAt:index,nextReviewAt:index<30?1:null}))});
  const matches=()=>book.panel.filteredEntries.map((entry:VocabularyEntry)=>entry.id);
  await clickBook(book,bookButton(book,'下一页'));expect(book.panel.page).toBe(2);
  await searchBook(book,'reading');expect(book.panel.page).toBe(1);expect(matches()).toEqual(Array.from({length:60},(_,index)=>`stable-${index}`));
  await chooseBook(book,'排序方式','term');expect(matches().slice(0,3)).toEqual(['stable-0','stable-1','stable-2']);
  await chooseBook(book,'排序方式','due');expect(matches().slice(0,3)).toEqual(['stable-0','stable-1','stable-2']);
  await chooseBook(book,'掌握状态','due');expect(matches()).toHaveLength(30);
  const type=book.host.querySelector('select.collection-type')!;await chooseBook(book,type.getAttribute('aria-label')!,'sentence');
  expect(matches()).toEqual(Array.from({length:15},(_,index)=>`stable-${index*2+1}`));
  book.panel.entries[1].nextReviewAt=Date.now()+60_000;await book.flush();expect(matches()).not.toContain('stable-1');
  await chooseBook(book,'掌握状态','mastered');expect(matches()).toEqual(Array.from({length:10},(_,index)=>`stable-${index*6+3}`));
  await chooseBook(book,type.getAttribute('aria-label')!,'all');await chooseBook(book,'掌握状态','all');await chooseBook(book,'排序方式','recent');
  book.panel.entries[59].lastSeenAt=2;await book.flush();expect(matches()[0]).toBe('stable-59');
  await chooseBook(book,'排序方式','term');book.panel.entries[59].normalizedTerm='aaa';await book.flush();expect(matches()[0]).toBe('stable-59');
});
it('bounds retained search text and completely matches reactive overflow entries without truncating their last context',async()=>{
  const book=await mountBook(undefined,undefined,undefined,{entries:entry=>Array.from({length:1200},(_,index)=>({...entry,id:`overflow-${index}`,term:`reading-${index}`,normalizedTerm:`reading-${index}`,lastSeenAt:index,
    translations:{'zh-cn':{text:'阅读',updatedAt:1}},contexts:Array.from({length:8},()=>({text:'r'.repeat(500),pageTitle:'Reading page',capturedAt:1}))}))});
  // Recent ordering caches the newest prefix. The oldest entry remains searchable through the full fallback.
  await searchBook(book,'needle-tail');expect(book.panel.filteredEntries).toHaveLength(0);
  const indexed=book.panel.searchIndex as Map<VocabularyEntry,string>;
  expect(indexed.size).toBeGreaterThan(0);expect(indexed.size).toBeLessThan(1200);
  expect([...indexed.values()].reduce((total,text)=>total+text.length,0)).toBeLessThanOrEqual(4*1024*1024);
  const oldest=book.panel.entries[0] as VocabularyEntry;expect(indexed.has(oldest)).toBe(false);
  oldest.contexts[7].pageTitle='needle-tail';await book.flush();expect(book.panel.filteredEntries.map((entry:VocabularyEntry)=>entry.id)).toEqual(['overflow-0']);
  delete oldest.contexts[7].pageTitle;await book.flush();expect(book.panel.filteredEntries).toHaveLength(0);
  oldest.translations.en={text:'needle-tail',updatedAt:2};await book.flush();expect(book.panel.filteredEntries).toHaveLength(1);
  delete oldest.translations.en;await book.flush();expect(book.panel.filteredEntries).toHaveLength(0);
  oldest.contexts[7].text='needle-tail';await book.flush();expect(book.panel.filteredEntries).toHaveLength(1);
  oldest.contexts.pop();await book.flush();expect(book.panel.filteredEntries).toHaveLength(0);
  await searchBook(book,'reading');expect(book.panel.filteredEntries).toHaveLength(1200);expect(book.host.querySelectorAll('.word-row')).toHaveLength(50);
  book.panel.entries=[oldest];await book.flush();expect(book.panel.filteredEntries).toHaveLength(1);expect(book.panel.searchIndex.size).toBe(1);
  await searchBook(book,'');expect(book.panel.searchIndex.size).toBe(0);
  book.panel.entries=[{...book.entry,id:'replacement',term:'replacement',normalizedTerm:'replacement'}];await book.flush();expect(book.panel.searchIndex.size).toBe(0);
  await searchBook(book,'replacement');expect(book.panel.filteredEntries.map((entry:VocabularyEntry)=>entry.id)).toEqual(['replacement']);expect(book.panel.searchIndex.size).toBe(1);
  await searchBook(book,'');book.panel.entries=[];await book.flush();expect(book.panel.searchIndex.size).toBe(0);expect(book.panel.filteredEntries).toHaveLength(0);
});
it('paginates a full collection, combines type/status/order filters, and clamps the page after authoritative removal',async()=>{
  const book=await mountBook(undefined,undefined,undefined,{entries:entry=>Array.from({length:60},(_,i)=>({...entry,id:`entry-${i}`,term:`word${String(i).padStart(3,'0')}`,normalizedTerm:`word${String(i).padStart(3,'0')}`,kind:i%3===0?'sentence':'expression',status:i%4===0?'mastered':'learning',nextReviewAt:i%4===0?null:1,lastSeenAt:i,createdAt:i}))});
  expect(book.host.querySelectorAll('.word-row')).toHaveLength(50);expect(book.host.querySelector('.entry-open')?.textContent).toBe('word059');
  await clickBook(book,bookButton(book,'下一页'));expect(book.host.querySelectorAll('.word-row')).toHaveLength(10);await clickBook(book,bookButton(book,'上一页'));
  await chooseBook(book,'排序方式','term');expect(book.host.querySelector('.entry-open')?.textContent).toBe('word000');
  const type=book.host.querySelector('select.collection-type')!;await chooseBook(book,type.getAttribute('aria-label')!,'sentence');expect(book.host.querySelectorAll('.word-row')).toHaveLength(20);
  await chooseBook(book,'掌握状态','mastered');expect(book.host.querySelectorAll('.word-row')).toHaveLength(5);await chooseBook(book,'排序方式','due');expect(book.host.querySelector('.entry-open')?.textContent).toBe('word000');
  const filter=book.host.querySelector<HTMLDetailsElement>('.book-filter')!;filter.open=true;const escape=new book.window.Event('keydown',{bubbles:true,cancelable:true});Object.assign(escape,{key:'Escape'});filter.dispatchEvent(escape);await book.flush();expect(filter.open).toBe(false);
  await clickBook(book,book.host.querySelector('.collection-results button')!);expect(book.host.querySelectorAll('.word-row')).toHaveLength(50);
  await clickBook(book,bookButton(book,'下一页'));book.setStored(book.stored().slice(0,3));book.emitMessage({type:'fluentReadVocabularyBookChanged'});await book.flush();expect(book.host.querySelectorAll('.word-row')).toHaveLength(3);expect(book.host.querySelector('.pagination')).toBeNull();
});
it('exports precisely the visible filtered collection and releases download ownership after failures',async()=>{
  let failing=true;const book=await mountBook(undefined,async message=>{
    if(message.action==='exportData'&&failing)return {success:false,error:{message:'Export unavailable'}};
    return {success:true,data:{...book.exported(),reviewLogs:[{entryId:'saved-a'},{entryId:'other'}]}};
  },undefined,{entries:entry=>[entry,{...entry,id:'other',term:'different',normalizedTerm:'different',contexts:[],note:'',translations:{}}]});
  const search=book.host.querySelector<HTMLInputElement>('input[type="search"]')!;search.value='art';search.dispatchEvent(new book.window.Event('input',{bubbles:true}));await book.flush();
  await clickBook(book,bookButton(book,'导出当前列表'));expect(book.host.textContent).toContain('Export unavailable');expect(book.download).not.toHaveBeenCalled();
  failing=false;await clickBook(book,bookButton(book,'导出当前列表'));expect(book.download).toHaveBeenCalledOnce();
  const data=JSON.parse(await (book.download.mock.calls[0][0] as Blob).text());expect(data.entries.map((entry:any)=>entry.id)).toEqual(['saved-a']);expect(data.reviewLogs).toEqual([{entryId:'saved-a'}]);
  expect(book.messages.at(-1)).toMatchObject({action:'exportData',options:{includePrivateContext:false}});
});
it('opens a saved entry from its visible row, receives study edits, speaks and navigates, then marks mastery and relearns after failure retry',async()=>{
  let fail=false;const book=await mountBook(undefined,async message=>{
    if(message.type==='selectionTts')return {success:true,transport:'offscreen'};
    if(fail)return {success:false,error:{message:'Temporary update failure'}};
    return {success:true,data:{entry:{...book.entry,status:message.action==='relearn'?'learning':'mastered'},log:{}}};
  });
  await clickBook(book,book.host.querySelector('.entry-open')!);expect(book.host.querySelector('[data-study-port]')?.getAttribute('data-study-port')).toBe('saved-a');
  await clickBook(book,book.host.querySelector('[data-study-save]')!);await clickBook(book,book.host.querySelector('[data-study-speak]')!);expect(book.messages.at(-1)).toMatchObject({type:'selectionTts'});
  await clickBook(book,book.host.querySelector('[data-study-settings]')!);expect(book.navigate).toHaveBeenCalledWith('settings-selection');
  await clickBook(book,book.host.querySelector('[data-study-close]')!);expect(book.host.querySelector('.entry-note')?.textContent).toBe('Updated study note');
  fail=true;await clickBook(book,bookButton(book,'标记掌握'));expect(book.host.textContent).toContain('Temporary update failure');expect(bookButton(book,'标记掌握').disabled).toBe(false);
  fail=false;await clickBook(book,bookButton(book,'标记掌握'));expect(book.messages.at(-1)).toMatchObject({action:'setMastery'});expect(bookButton(book,'重新学习')).toBeTruthy();
  fail=true;await clickBook(book,bookButton(book,'重新学习'));expect(book.host.textContent).toContain('Temporary update failure');fail=false;await clickBook(book,bookButton(book,'重新学习'));expect(book.messages.at(-1)).toMatchObject({action:'relearn'});expect(bookButton(book,'标记掌握')).toBeTruthy();
});
it('rates a forgotten entry through the answer form, keeps failure retryable, and enters study from the answer without losing the saved row',async()=>{
  let failure=true;const book=await mountBook(undefined,async message=>{
    if(message.type==='selectionTts')return {success:true,transport:'offscreen'};
    return failure?{success:false,error:{message:'Review unavailable'}}:{success:true,data:{entry:{...book.entry,status:'learning'},log:{}}};
  });
  await clickBook(book,book.host.querySelector('.start-review')!);await clickBook(book,book.host.querySelector('.reveal-button')!);
  await clickBook(book,book.host.querySelector('.review-answer .vocabulary-speak')!);expect(book.messages.at(-1)).toMatchObject({type:'selectionTts',text:'art'});
  await clickBook(book,book.host.querySelector('.review-actions .again')!);expect(book.host.textContent).toContain('Review unavailable');expect(book.host.querySelector('.review-actions .again')?.hasAttribute('disabled')).toBe(false);
  await clickBook(book,book.host.querySelector('.review-answer .study-entry-button')!);expect(book.host.querySelector('[data-study-port]')).not.toBeNull();await clickBook(book,book.host.querySelector('[data-study-close]')!);
  failure=false;await clickBook(book,book.host.querySelector('.start-review')!);await clickBook(book,book.host.querySelector('.reveal-button')!);await clickBook(book,book.host.querySelector('.review-actions .again')!);
  expect(book.messages).toContainEqual({type:'fluentReadVocabularyBook',action:'review',entryId:'saved-a',rating:'again'});expect(book.host.textContent).toContain('忘了 1 个');
  await clickBook(book,book.host.querySelector('.review-complete button')!);await clickBook(book,book.host.querySelector('.start-review')!);await clickBook(book,bookButton(book,'退出本轮'));expect(book.host.querySelector('.word-row')).not.toBeNull();
});

it('uses real feature switches and empty-state navigation while rolling failed preferences back to authoritative config',async()=>{
  const patch=vi.fn(async(_value:unknown)=>{});const book=await mountBook(undefined,undefined,patch,{entries:()=>[]});
  await clickBook(book,book.host.querySelector('.selection-reminder button')!);expect(book.navigate).toHaveBeenLastCalledWith('settings-selection');
  await clickBook(book,book.host.querySelector('.empty-secondary')!);expect(book.navigate).toHaveBeenLastCalledWith('settings-data');
  const saving=()=>book.host.querySelector<HTMLButtonElement>('.vocabulary-saving-control:not(.vocabulary-reencounter-control) button')!;
  await clickBook(book,saving());expect(patch.mock.calls.at(-1)?.[0]).toEqual({vocabularyBookEnabled:false});expect(book.host.textContent).toContain('收藏入口已关闭');
  const enable=[...book.host.querySelectorAll<HTMLButtonElement>('.empty-state button')].find(button=>!button.classList.contains('empty-secondary'))!;await clickBook(book,enable);expect(patch.mock.calls.at(-1)?.[0]).toEqual({vocabularyBookEnabled:true});
  patch.mockRejectedValueOnce(new Error('Setting unavailable'));await clickBook(book,saving());expect(saving().getAttribute('aria-checked')).toBe('true');expect(book.host.textContent).toContain('Setting unavailable');
  const reencounter=()=>book.host.querySelector<HTMLButtonElement>('.vocabulary-reencounter-control button')!;await clickBook(book,reencounter());expect(patch.mock.calls.at(-1)?.[0]).toEqual({vocabularyReencounterEnabled:true});
  book.updateConfig({vocabularyReencounterEnabled:true,selectionTranslatorMode:'bilingual',to:'en',theme:'dark'});await book.flush();expect(book.host.querySelector('.selection-reminder')).toBeNull();
  patch.mockRejectedValueOnce(new Error('Reencounter unavailable'));await clickBook(book,reencounter());expect(reencounter().getAttribute('aria-checked')).toBe('true');expect(book.host.textContent).toContain('Reencounter unavailable');
});
it('refreshes and clears through the management menu and keeps protected removal and export failures retryable',async()=>{
  let removeMissing=true,exportFails=true;const book=await mountBook(undefined,async message=>{
    if(message.action==='removeWithSnapshot')return {success:true,data:removeMissing?null:{entry:book.entry,reviewLogs:[]}};
    if(message.action==='exportData')return exportFails?{success:false,error:{message:'Anki unavailable'}}:{success:true,data:book.exported()};
    return {success:true,data:true};
  });
  const reads=book.messages.filter(message=>message.action==='list').length;await clickBook(book,bookButton(book,'刷新列表'));expect(book.messages.filter(message=>message.action==='list')).toHaveLength(reads+1);
  await clickBook(book,bookButton(book,'删除收藏'));expect(book.host.textContent).toContain('词条已不存在');expect(book.host.querySelector('.word-row')).not.toBeNull();
  await clickBook(book,bookButton(book,'导出到 Anki'));expect(book.host.textContent).toContain('Anki unavailable');expect(book.download).not.toHaveBeenCalled();
  exportFails=false;await clickBook(book,bookButton(book,'导出到 Anki'));expect(book.download).toHaveBeenCalledOnce();
  const clear=book.host.querySelector('.book-more-menu button.danger')!;await clickBook(book,clear);expect(book.messages.at(-1)).toMatchObject({action:'clear'});expect(book.host.querySelector('.word-row')).toBeNull();
});

it('renders future review intervals without adding future or unscheduled entries to the current review queue',async()=>{
  const now=Date.now();const book=await mountBook(undefined,undefined,undefined,{entries:entry=>[null,now+5*60_000,now+3*3600_000,now+2*86400_000].map((nextReviewAt,index)=>({...entry,id:`future-${index}`,term:`scheduled ${index}`,status:'learning',nextReviewAt}))});
  const text=book.host.querySelector('.word-list')?.textContent;expect(text).toContain('未安排复习');expect(text).toContain('5 分钟后');expect(text).toContain('3 小时后');expect(text).toContain('2 天后');expect(book.host.querySelector('.start-review')?.hasAttribute('disabled')).toBe(true);
});

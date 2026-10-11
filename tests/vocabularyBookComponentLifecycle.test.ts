import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { parseHTML } from 'linkedom';
import { createServer, type Plugin } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {VocabularyEntry, VocabularyBookExport} from '@/src/features/vocabulary/learningModel';

interface ComponentTestState {
  browser: {
    runtime: {
      sendMessage: (message: Record<string, unknown>) => Promise<unknown>;
      onMessage: {
        addListener: () => void;
        removeListener: () => void;
      };
    };
  };
  config: Record<string, unknown>;
  configReady: Promise<void>;
  requestConfigPatch: () => Promise<void>;
  subscribeConfig: () => () => void;
  confirm?: (...args: unknown[]) => Promise<unknown>;
}

const TEST_STATE_KEY = '__fluentReadVocabularyLifecycleTest';

function setComponentTestState(state: ComponentTestState | undefined): void {
  const target = globalThis as typeof globalThis & Record<string, unknown>;
  if (state) target[TEST_STATE_KEY] = state;
  else delete target[TEST_STATE_KEY];
}

function componentMocks(): Plugin {
  return {
    name: 'vocabulary-lifecycle-test-mocks',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'element-plus') return '\0vocabulary-element-mock';
      if (id.includes('element-plus/') && id.includes('/style')) return '\0vocabulary-style-mock';
      if (id.endsWith('/UiSelect.vue')) return '\0vocabulary-select-mock';
      if (id === 'webextension-polyfill') return '\0vocabulary-browser-mock';
      if (
        id === '@/src/services/config/store'
        || id.endsWith('/src/services/config/store')
        || id.endsWith('/src/services/config/store.ts')
      ) {
        return '\0vocabulary-config-mock';
      }
      return null;
    },
    load(id) {
      if (id === '\0vocabulary-element-mock') return `export const ElMessageBox = {confirm:(...args)=>globalThis.${TEST_STATE_KEY}.confirm?.(...args) ?? Promise.resolve()}; export const ElOption = {render(){return null}};`;
      if (id === '\0vocabulary-style-mock') return 'export {};';
      if (id === '\0vocabulary-select-mock') return 'export default {render() {return null}};';
      if (id === '\0vocabulary-browser-mock') {
        return `export default globalThis.${TEST_STATE_KEY}.browser;`;
      }
      if (id === '\0vocabulary-config-mock') {
        return [
          `const state = globalThis.${TEST_STATE_KEY};`,
          'export const config = state.config;',
          'export const configReady = state.configReady;',
          'export const requestConfigPatch = state.requestConfigPatch;',
          'export const subscribeConfig = state.subscribeConfig;',
        ].join('\n');
      }
      return null;
    },
  };
}

const mountedBooks: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of mountedBooks.splice(0).reverse()) await dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setComponentTestState(undefined);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}

async function mountBook(confirm: (...args: unknown[]) => Promise<unknown> = async () => undefined,
  response?: (message: Record<string, unknown>) => Promise<unknown>,
  configPatch: () => Promise<void> = async () => undefined,
  options: {keepAlive?: boolean; ready?: Promise<void>} = {}) {
  const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
  const entry = {id:'saved-a', term:'art', normalizedTerm:'art', identityKey:'en:art', sourceLanguage:'en', kind:'expression',
    translations:{'zh-cn':{text:'艺术',updatedAt:1}}, contexts:[{text:'We study art.',sourceUrl:'https://example.test/private-reading',capturedAt:1}], note:'A saved explanation.', phonetic:'',partOfSpeech:'',
    createdAt:1,updatedAt:1,lastSeenAt:1,encounterCount:1,masteryLevel:0,status:'new',nextReviewAt:1,lastReviewedAt:null,
    reviewCount:0,lapseCount:0,schemaVersion:1} as VocabularyEntry;
  let stored = [structuredClone(entry)]; const messages: Record<string, unknown>[] = [];
  const exported = (): VocabularyBookExport => ({format:'fluentread-vocabulary-book',version:1,exportedAt:1,
    includesPrivateContext:false,entries:structuredClone(stored),reviewLogs:[]});
  const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
    messages.push(message);
    if (message.action === 'list') return {success:true,data:structuredClone(stored)};
    if (response) return response(message);
    if (message.action === 'clear') {stored = []; return {success:true,data:true};}
    if (message.action === 'exportData') return {success:true,data:exported()};
    if (message.action === 'removeWithSnapshot') return {success:true,data:{entry,reviewLogs:[]}};
    return {success:true,data:{entry:{...entry,status:'mastered'},log:{}}};
  });
  setComponentTestState({browser:{runtime:{sendMessage,onMessage:{addListener:()=>undefined,removeListener:()=>undefined}}},
    config:{on:true,theme:'light',uiLanguage:'zh-CN',vocabularyBookEnabled:true,selectionTranslatorMode:'disabled',to:'zh-CN'},
    configReady:options.ready ?? Promise.resolve(),requestConfigPatch:configPatch,subscribeConfig:()=>()=>undefined,confirm});
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
  const server = await createServer({appType:'custom',configFile:false,logLevel:'silent',plugins:[componentMocks(),vue()],
    resolve:{alias:{'@':resolve(process.cwd())}},root:process.cwd(),server:{hmr:false,middlewareMode:true},ssr:{noExternal:['webextension-polyfill','element-plus']}});
  mountedBooks.push(()=>server.close());
  const loaded = await server.ssrLoadModule('/src/features/vocabulary/ui/VocabularyBook.vue');
  const component = loaded.default; component.ssrRender = undefined; component.render = () => null;
  const renderer = runtime.createRenderer<Record<string, never>, Record<string, unknown>>({
    patchProp:()=>undefined,insert:()=>undefined,remove:()=>undefined,createElement:()=>({}),createText:()=>({}),createComment:()=>({}),
    setText:()=>undefined,setElementText:()=>undefined,parentNode:()=>null,nextSibling:()=>null,querySelector:()=>null,setScopeId:()=>undefined,cloneNode:()=>({}),insertStaticContent:()=>[{},{}],
  });
  const shown = runtime.ref(true);
  const otherPage = {render: () => null};
  let panel: any;
  const bookNode = () => runtime.h(component,{ref:(instance:any)=>{if(instance)panel=instance.$.setupState;}});
  const app = renderer.createApp({setup:()=>()=>options.keepAlive
    ? runtime.h(runtime.KeepAlive, null, {default: () => shown.value ? bookNode() : runtime.h(otherPage, {key: 'other-page'})})
    : bookNode()});
  app.provide(runtime.ssrContextKey,{modules:new Set<string>()});app.config.warnHandler=()=>undefined;
  app.mount({}); let mounted = true; const unmount = () => {if(mounted){mounted=false;app.unmount();}};
  mountedBooks.push(unmount);
  const flush = async () => {for(let i=0;i<12;i++){await Promise.resolve();await runtime.nextTick();}};
  await flush(); if (!options.ready) expect(panel.entries).toHaveLength(1);
  return {panel,entry,messages,exported,download,clicks,unmount,flush,shown,window,windowAdd,windowRemove,stored:()=>stored};
}

describe('VocabularyBook asynchronous action ownership', () => {
  it('opens the explicitly chosen entry from a full book and closes it without replacing the collection', async () => {
    const book = await mountBook();
    const entries = Array.from({length:5000},(_,i)=>Object.freeze({...book.entry,id:`saved-${i}`,term:`word ${i}`,identityKey:`en:word ${i}`,normalizedTerm:`word ${i}`,lastSeenAt:i+1}));
    const collection = Object.freeze(entries);
    book.panel.entries = collection;
    expect(book.panel.studyEntry).toBeUndefined();
    book.panel.startReview();
    expect(book.panel.reviewStarted).toBe(true);
    book.panel.openStudy(entries[17]);
    expect(book.panel.reviewStarted).toBe(false);
    expect(book.panel.studyEntry).toBe(entries[17]);
    expect(book.panel.studyEntry.id).not.toBe(entries[4999].id);
    book.panel.openStudy(entries[4321]);
    expect(book.panel.studyEntry).toBe(entries[4321]);
    book.panel.selectedEntryId = '';
    expect(book.panel.studyEntry).toBeUndefined();
    expect(book.panel.entries).toBe(collection);
    expect(book.panel.entries.map((item:VocabularyEntry)=>item.id)).toEqual(entries.map(item=>item.id));
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
    book.panel.moreMenu = {get open(){return true;},set open(_value:boolean){book.unmount();},querySelector:()=>({focus})};
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

    const require = createRequire(import.meta.url);
    const vueRuntime = require('vue') as typeof import('vue');
    const server = await createServer({
      appType: 'custom',
      configFile: false,
      logLevel: 'silent',
      plugins: [componentMocks(), vue()],
      resolve: { alias: { '@': resolve(process.cwd(), '.') } },
      root: process.cwd(),
      server: { hmr: false, middlewareMode: true },
      ssr: { noExternal: ['webextension-polyfill', 'element-plus'] },
    });

    try {
      const loaded = await server.ssrLoadModule('/src/features/vocabulary/ui/VocabularyBook.vue');
      const component = loaded.default as { render?: () => null; ssrRender?: unknown };
      component.ssrRender = undefined;
      component.render = () => null;
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
      app.provide(vueRuntime.ssrContextKey, { modules: new Set<string>() });
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
    } finally {
      await server.close();
    }
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

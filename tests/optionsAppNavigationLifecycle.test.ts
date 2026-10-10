import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type Plugin, type ViteDevServer} from 'vite';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {TranslationParams, UiLanguage} from '../src/core/i18n';

const TEST_KEY = '__frOptionsNavigationLifecycle';
const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
type ActualUiI18n = {language: import('vue').Ref<UiLanguage>; t: (key: string, params?: TranslationParams) => string; translateLegacy: (text: string) => string};
type FixtureScope = {active: boolean; server?: ViteDevServer; closing?: Promise<void>; unmount?: () => void};
let current: FixtureScope | undefined;
let unmount: (() => void) | undefined;
const owns = (scope: FixtureScope) => scope.active && current === scope;
const inactive = () => new Error('Options fixture scope is closed');
function closeOwnedServer(scope: FixtureScope) {
  return scope.server ? (scope.closing ??= scope.server.close()) : Promise.resolve();
}
async function closeFixture(scope: FixtureScope) {
  scope.active = false;
  try {
    scope.unmount?.();
  } finally {
    if (current === scope) {
      current = undefined;
      unmount = undefined;
      vi.unstubAllGlobals();
      delete (globalThis as Record<string, unknown>)[TEST_KEY];
    }
    await closeOwnedServer(scope);
  }
}
async function prepareFixture(scope: FixtureScope, factory = createFixtureServer) {
  try {
    const ownedServer = await factory();
    scope.server = ownedServer;
    if (!owns(scope)) throw inactive();
    // Transform only: configReady and appearance mocks must be evaluated inside each mount.
    await ownedServer.transformRequest('/src/app/options/OptionsApp.vue', {ssr: true});
    if (!owns(scope)) throw inactive();
  } catch (error) {
    try { await closeOwnedServer(scope); } catch { /* Preserve the original bootstrap error. */ }
    throw error;
  }
}
beforeEach(async () => {
  const scope: FixtureScope = {active: true};
  current = scope;
  await prepareFixture(scope);
}, 5000);
afterEach(async () => {
  const scope = current;
  if (scope) await closeFixture(scope);
}, 5000);

function createFixtureServer(browser = 'chrome') {
  const mocks: Plugin = {
    name: 'options-navigation-lifecycle-mocks',
    enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('.vue') && !id.endsWith('/OptionsApp.vue')) return '\0options-child-component';
      if (id.endsWith('/src/ui/i18n')) return '\0options-i18n';
      if (id.endsWith('/src/services/config/store')) return '\0options-config';
      if (id.endsWith('/src/ui/interfaceAppearance')) return '\0options-appearance';
      if (id.endsWith('/src/platform/browser/capabilities')) return '\0options-capabilities';
      return null;
    },
    load(id) {
      if (id === '\0options-child-component') return 'export default {render: () => null};';
      if (id === '\0options-i18n') return `export const useUiI18n = () => globalThis.${TEST_KEY}.i18n ?? ({t: key => key === "informationHighlight.title" ? "Smart Highlighting" : key, translateLegacy: text => text});`;
      if (id === '\0options-config') return `export const {config, configReady, subscribeConfig} = globalThis.${TEST_KEY};`;
      if (id === '\0options-appearance') return `export const {theme: applyInterfaceTheme, skin: applyInterfaceSkin, font: applyInterfaceFont, registerAppearance: registerInterfaceAppearanceRoot} = globalThis.${TEST_KEY};`;
      if (id === '\0options-capabilities') return `export const {browserCapabilities} = globalThis.${TEST_KEY};`;
      return null;
    },
  };
  return createServer({
    configFile: false, appType: 'custom', logLevel: 'silent', root: process.cwd(),
    plugins: [mocks, vue()], resolve: {alias: {'@': resolve(process.cwd())}},
    define: {'import.meta.env.BROWSER': JSON.stringify(browser)},
    server: {hmr: false, middlewareMode: true},
  });
}

async function mountOptions(hash = '#settings-selection', ready = Promise.resolve(), appearanceRoot?: HTMLElement, load?: (server: ViteDevServer) => Promise<Record<string, any>>, browser = 'chrome', uiLanguage?: UiLanguage) {
  const scope = current;
  if (!scope || !owns(scope) || !scope.server) throw inactive();
  const ownedServer = scope.server;
  const location = {hash};
  const windowEvents = new EventTarget();
  const mediaAdd = vi.fn();
  const mediaRemove = vi.fn();
  const scrollTo = vi.fn();
  const windowScrollTo = vi.fn();
  const unsubscribeConfig = vi.fn();
  const theme = vi.fn(), skin = vi.fn(), font = vi.fn();
  const releaseAppearance = vi.fn(), registerAppearance = vi.fn(() => releaseAppearance);
  const replaceState = vi.fn((_state: unknown, _unused: string, nextHash: string) => {
    location.hash = nextHash;
  });
  const addEventListener = vi.spyOn(windowEvents, 'addEventListener');
  const removeEventListener = vi.spyOn(windowEvents, 'removeEventListener');
  vi.stubGlobal('window', Object.assign(windowEvents, {
    location,
    scrollTo: windowScrollTo,
    matchMedia: () => ({matches: false, addEventListener: mediaAdd, removeEventListener: mediaRemove}),
  }));
  vi.stubGlobal('history', {replaceState});
  (globalThis as Record<string, unknown>)[TEST_KEY] = {
    config: {interfaceSkin: 'default'},
    configReady: ready,
    subscribeConfig: () => unsubscribeConfig,
    theme, skin, font, registerAppearance,
    browserCapabilities: {browser},
  };
  let i18n: ActualUiI18n | undefined;
  let loaded: Record<string, any>;
  try {
    if (uiLanguage) {
      const [core, english, patterns] = await Promise.all([
        ownedServer.ssrLoadModule('/src/core/i18n/index.ts'),
        ownedServer.ssrLoadModule('/src/core/i18n/messages/en-US.ts'),
        ownedServer.ssrLoadModule('/src/core/i18n/messages/legacy-patterns.ts'),
      ]);
      if (!owns(scope)) throw inactive();
      core.registerUiLanguageBundle('en-US', {messages: english.enUSMessages, legacyText: english.enUSLegacyText, legacyPatterns: patterns.createLegacyPatternSet('en-US')});
      const language = runtime.ref<UiLanguage>(uiLanguage);
      i18n = {language, t: (key, params) => core.translate(key, language.value, params), translateLegacy: text => core.translateLegacyText(text, language.value)};
      ((globalThis as Record<string, unknown>)[TEST_KEY] as {i18n?: ActualUiI18n}).i18n = i18n;
    }
    loaded = await (load ? load(ownedServer) : ownedServer.ssrLoadModule('/src/app/options/OptionsApp.vue'));
    if (!owns(scope)) throw inactive();
  } catch (error) {
    try { await closeOwnedServer(scope); } catch { /* Preserve the original loader error. */ }
    throw error;
  }
  const {default: component} = loaded;
  component.ssrRender = undefined;
  component.render = () => null;
  const renderer = runtime.createRenderer<Record<string, never>, Record<string, unknown>>({
    patchProp: () => undefined, insert: () => undefined, remove: () => undefined,
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText: () => undefined, setElementText: () => undefined, parentNode: () => null,
    nextSibling: () => null, querySelector: () => null, setScopeId: () => undefined,
    cloneNode: () => ({}), insertStaticContent: () => [{}, {}],
  });
  type SearchResult = {id: string; sectionId: string; targetId?: string; panelId?: string; label: string; searchDescription: string};
  let state!: {activeSection: string; query: string; activeItem: {id: string}; selectSection: (id: string, target?: string) => void; activePanel: string; activePanels: {id: string}[]; sectionPanels: {id: string}[]; contentComponentProps: {activePanel?: string}; selectPanel: (id: string) => void; isGroupOpen: (index: number) => boolean; toggleGroup: (index: number) => void; settingsContentElement: {scrollTo: typeof scrollTo} | null; filteredResults: SearchResult[]; selectResult: (result: SearchResult) => Promise<void>};
  const app = renderer.createApp({
    setup: () => () => runtime.h(component, {
      appearanceRoot,
      ref: (instance: any) => { if (instance) state = instance.$.setupState; },
    }),
  });
  app.provide(runtime.ssrContextKey, {modules: new Set<string>()});
  app.config.warnHandler = () => undefined;
  app.mount({});
  state.settingsContentElement = {scrollTo};
  let mounted = true;
  scope.unmount = () => { if (mounted) { mounted = false; app.unmount(); } };
  unmount = scope.unmount;
  await runtime.nextTick();
  if (!owns(scope)) throw inactive();
  const navigateHash = async (nextHash: string) => {
    location.hash = nextHash;
    windowEvents.dispatchEvent(new Event('hashchange'));
    await runtime.nextTick();
  };
  return {state, location, navigateHash, replaceState, scrollTo, windowScrollTo, addEventListener, removeEventListener, mediaAdd, mediaRemove, unsubscribeConfig, theme, skin, font, registerAppearance, releaseAppearance, i18n};
}

describe('OptionsApp language recovery search with actual UI messages', () => {
  const englishLanguageSuffix = ['settings-translation/excluded-languages', 'settings-translation', 'settings-image-translation', 'settings-writing', 'settings-glossary'];
  it.each(['zh-CN', 'en-US'] as const)('prioritizes language aliases and focuses the existing selector in %s', async language => {
    const {state, location} = await mountOptions('#settings-selection', Promise.resolve(), undefined, undefined, 'chrome', language);
    const control = {scrollIntoView: vi.fn(), focus: vi.fn()};
    const querySelector = vi.fn(() => control);
    vi.stubGlobal('document', {querySelector});
    for (const query of ['language', 'Language', 'lang']) {
      state.query = query;
      expect(state.filteredResults.map(result => result.id)).toEqual(['settings-general', ...(language === 'en-US' ? englishLanguageSuffix : [])]);
      expect(state.filteredResults[0]).toEqual({
        id: 'settings-general', sectionId: 'settings-general',
        label: language === 'en-US' ? 'App language / Language' : '软件语言 / Language',
        searchDescription: language === 'en-US' ? 'Choose the language used across FluentRead.' : '选择 FluentRead 所有界面使用的语言',
      });
      await state.selectResult(state.filteredResults[0]);
      expect(state.activeSection).toBe('settings-general');
      expect(state.query).toBe('');
      expect(location.hash).toBe('#settings-general');
      expect(querySelector).toHaveBeenLastCalledWith('[data-testid="ui-language-select"] input');
      expect(control.scrollIntoView).toHaveBeenLastCalledWith({block: 'center'});
    }
    expect(control.focus).toHaveBeenCalledTimes(3);
  });

  it('preserves non-language result content and panel/target/section ordering', async () => {
    const {state, i18n} = await mountOptions('#settings-selection', Promise.resolve(), undefined, undefined, 'chrome', 'zh-CN');
    state.query = '翻译';
    expect(state.filteredResults.map(result => result.id)).toEqual([
      'settings-translation-stats/overview', 'settings-translation/page', 'settings-translation/section-translation',
      'settings-translation/excluded-languages', 'settings-sites/rules', 'settings-video/general', 'settings-advanced/cache',
      'feature-services', 'floating-ball-toggle', 'floating-ball-settings', 'translation-sentence-highlight',
      'settings-general', 'settings-services', 'settings-translation', 'settings-interface', 'settings-selection',
      'settings-image-translation', 'settings-video', 'settings-translation-center', 'settings-sites', 'settings-translation-stats',
    ]);
    state.query = 'OpenAI';
    expect(state.filteredResults).toMatchInlineSnapshot(`
      [
        {
          "id": "settings-services",
          "label": "翻译服务",
          "searchDescription": "服务与模型",
          "sectionId": "settings-services",
        },
        {
          "id": "settings-translation-stats",
          "label": "翻译统计",
          "searchDescription": "请求规模、耗时与服务表现",
          "sectionId": "settings-translation-stats",
        },
      ]
    `);
    i18n!.language.value = 'en-US';
    expect(state.filteredResults.map(result => result.id)).toEqual(['settings-services', 'settings-translation-stats']);
    state.query = '';
    expect(state.filteredResults).toEqual([]);
  });

  it('recomputes language recovery and localized results when the UI language changes', async () => {
    const {state, i18n} = await mountOptions('#settings-selection', Promise.resolve(), undefined, undefined, 'chrome', 'zh-CN');
    state.query = 'language';
    expect(state.filteredResults.map(result => result.id)).toEqual(['settings-general']);
    expect(state.filteredResults[0].label).toBe('软件语言 / Language');
    i18n!.language.value = 'en-US';
    expect(state.filteredResults.map(result => result.id)).toEqual(['settings-general', ...englishLanguageSuffix]);
    expect(state.filteredResults[0].label).toBe('App language / Language');
    i18n!.language.value = 'zh-CN';
    expect(state.filteredResults.map(result => result.id)).toEqual(['settings-general']);
    expect(state.filteredResults[0].label).toBe('软件语言 / Language');
  });

  it('keeps language recovery available while filtering unsupported userscript controls', async () => {
    const {state, i18n} = await mountOptions('#settings-selection', Promise.resolve(), undefined, undefined, 'userscript', 'en-US');
    state.query = 'lang';
    expect(state.filteredResults.map(result => result.id)).toEqual(['settings-general', ...englishLanguageSuffix]);
    for (const language of ['en-US', 'zh-CN'] as const) {
      i18n!.language.value = language;
      for (const query of ['智能高亮', 'Smart Highlighting', '意外度', 'surprisal', '关键词']) {
        state.query = query;
        expect(state.filteredResults).toEqual([]);
      }
      expect(state.sectionPanels.map(panel => panel.id)).not.toContain('information-highlight');
    }
  });
});

describe('OptionsApp mounted hash navigation', () => {
  it('registers the explicit appearance root and releases only its returned handle once', async () => {
    const root = {} as HTMLElement;
    const {registerAppearance, releaseAppearance} = await mountOptions('#settings-interface', Promise.resolve(), root);
    expect(registerAppearance).toHaveBeenCalledWith(root);expect(releaseAppearance).not.toHaveBeenCalled();
    unmount?.();unmount = undefined;expect(releaseAppearance).toHaveBeenCalledTimes(1);
  });
  it.each(['resolve', 'reject'] as const)('ignores configReady %s after unmount instead of changing a subsequent appearance owner', async outcome => {
    let resolveReady!: () => void, rejectReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {resolveReady = resolve;rejectReady = reject;});
    const {theme, skin, font} = await mountOptions('#settings-selection', ready);
    unmount?.();unmount = undefined;
    if (outcome === 'resolve') resolveReady();else rejectReady(new Error('closed config'));
    await runtime.nextTick();await runtime.nextTick();
    expect(theme).not.toHaveBeenCalled();expect(skin).not.toHaveBeenCalled();expect(font).not.toHaveBeenCalled();
  });
  it('cancels deferred scrolling and rejects stale navigation after unmount', async () => {
    const {state, scrollTo, location} = await mountOptions();scrollTo.mockClear();
    state.selectSection('settings-general');unmount?.();unmount = undefined;
    await runtime.nextTick();expect(scrollTo).not.toHaveBeenCalled();
    state.selectSection('settings-about');expect(location.hash).toBe('#settings-general');
  });
  it('keeps website rules continuous and uses panel metadata only to locate destinations', async () => {
    const {state} = await mountOptions('#settings-sites');
    expect(state.activePanels).toEqual([]);
    expect(state.contentComponentProps.activePanel).toBeUndefined();
    state.selectSection('settings-image-translation');
    expect(state.activePanels).toEqual([]);
    expect(state.contentComponentProps.activePanel).toBeUndefined();
  });

  it('scrolls smart-highlighting searches within the continuous form without hiding any translation groups', async () => {
    const {state} = await mountOptions('#settings-translation');
    expect(state.activePanel).toBe('reading');
    expect(state.contentComponentProps.activePanel).toBeUndefined();
    expect(state.activePanels).toEqual([]);
    expect(state.sectionPanels.map(panel => panel.id)).toEqual(expect.arrayContaining(['reading', 'information-highlight', 'hover', 'input']));
    vi.stubGlobal('MutationObserver', class {observe() {} disconnect() {}});
    vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
    Object.assign(window, {setTimeout: vi.fn(() => 1), clearTimeout: vi.fn()});
    const groups = ['reading', 'information-highlight', 'hover', 'input'].map(name => ({
      name, style: {display: ''}, getClientRects() {return this.style.display === 'none' ? [] : [{}];},
    }));
    const container = Object.assign(new EventTarget(), {
      scrollTop: 0, clientHeight: 600, firstElementChild: {},
      scrollTo: vi.fn(({top}: {top: number}) => {container.scrollTop = top;}),
      getBoundingClientRect: () => ({top: 30}),
      querySelectorAll: vi.fn((selector: string) => [{
        getClientRects: () => [{}], getBoundingClientRect: () => ({top: 530 - container.scrollTop, height: 240}),
        matches: () => selector.startsWith('[data-settings-panel'), querySelector: () => null,
      }]),
    });
    state.settingsContentElement = container;
    for (const keyword of ['智能高亮', 'Smart Highlighting', '意外度', 'surprisal', '关键词']) {
      state.query = keyword;
      expect(state.filteredResults.length).toBeGreaterThan(0);
      expect(state.filteredResults.every(result => result.panelId === 'information-highlight' || result.targetId === 'information-highlight-settings')).toBe(true);
      await state.selectResult(state.filteredResults[0]);
      expect(state.activePanel).toBe('information-highlight');
      expect(state.contentComponentProps.activePanel).toBeUndefined();
      expect(container.querySelectorAll).toHaveBeenLastCalledWith('[data-settings-panel="information-highlight"]');
      expect(container.scrollTo).toHaveBeenLastCalledWith({top: 500, behavior: 'instant'});
      expect(groups.every(group => group.getClientRects().length === 1)).toBe(true);
    }
    state.query = 'Smart Highlighting';
    await state.selectResult(state.filteredResults.find(result => result.targetId === 'information-highlight-settings')!);
    expect(container.querySelectorAll).toHaveBeenLastCalledWith('#information-highlight-settings');
    expect(container.scrollTo).toHaveBeenLastCalledWith({top: 320, behavior: 'instant'});
    state.selectSection('settings-translation', 'translation-sentence-highlight');
    expect(state.activePanel).toBe('reading');
    state.selectSection('settings-translation', 'information-highlight-settings');
    expect(state.activePanel).toBe('information-highlight');
    state.selectSection('settings-translation', 'floating-ball-settings');
    expect(state.activePanel).toBe('floating-ball');
    expect(state.contentComponentProps.activePanel).toBeUndefined();
  });

  it('excludes unsupported smart-highlighting anchors and all their search results in userscript', async () => {
    const {state} = await mountOptions('#settings-translation', Promise.resolve(), undefined, undefined, 'userscript');
    expect(state.activePanels).toEqual([]);
    expect(state.sectionPanels.map(panel => panel.id)).toContain('reading');
    expect(state.sectionPanels.map(panel => panel.id)).not.toContain('information-highlight');
    for (const keyword of ['智能高亮', 'Smart Highlighting', '意外度', 'surprisal', '关键词']) {
      state.query = keyword;
      expect(state.filteredResults).toEqual([]);
    }
    state.settingsContentElement = null;
    state.selectSection('settings-translation', 'information-highlight-settings');
    expect(state.contentComponentProps.activePanel).toBeUndefined();
    state.query = '双语逐句高亮';
    expect(state.filteredResults.some(result => result.targetId === 'translation-sentence-highlight')).toBe(true);
  });

  it('keeps userscript builds excluded even when the runtime capability port reports chrome', async () => {
    await closeFixture(current!);
    const scope: FixtureScope = {active: true};current = scope;
    await prepareFixture(scope, () => createFixtureServer('userscript'));
    const {state} = await mountOptions('#settings-translation');
    expect(state.sectionPanels.map(panel => panel.id)).not.toContain('information-highlight');
    state.query = 'Smart Highlighting';expect(state.filteredResults).toEqual([]);
    state.settingsContentElement = null;
    state.selectSection('settings-translation', 'information-highlight');
    expect(state.contentComponentProps.activePanel).toBeUndefined();
  });

  it('follows same-document deep links and history hash changes after the initial mount', async () => {
    const {state, navigateHash, replaceState, scrollTo, windowScrollTo} = await mountOptions();
    expect(state.activeSection).toBe('settings-selection');
    state.query = 'pending search';
    await navigateHash('#settings-vocabulary');
    expect(state.activeSection).toBe('settings-vocabulary');
    expect(state.activeItem.id).toBe('settings-vocabulary');
    expect(state.query).toBe('');
    await navigateHash('#settings-selection');
    expect(state.activeSection).toBe('settings-selection');
    await navigateHash('#settings-vocabulary');
    expect(state.activeSection).toBe('settings-vocabulary');
    expect(replaceState).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenLastCalledWith({top: 0, left: 0, behavior: 'instant'});
    expect(windowScrollTo).not.toHaveBeenCalled();
  });

  it('canonicalizes aliases and unknown fragments through the shared navigation resolver', async () => {
    const {state, location, navigateHash, replaceState} = await mountOptions('#settings-learning-center');
    expect(state.activeSection).toBe('settings-vocabulary');
    expect(location.hash).toBe('#settings-vocabulary');
    await navigateHash('#missing-section');
    expect(state.activeSection).toBe('settings-general');
    expect(location.hash).toBe('#settings-general');
    await navigateHash('#settings-learning-center');
    expect(state.activeSection).toBe('settings-vocabulary');
    expect(location.hash).toBe('#settings-vocabulary');
    expect(replaceState).toHaveBeenCalledTimes(3);
    state.selectSection('settings-selection');
    expect(location.hash).toBe('#settings-selection');
    expect(state.activeSection).toBe('settings-selection');
    state.selectSection('settings-selection');
    expect(replaceState).toHaveBeenCalledTimes(4);
  });

  it('removes the hash listener on unmount and no longer changes the former page state', async () => {
    const {state, navigateHash, addEventListener, removeEventListener, mediaAdd, mediaRemove, unsubscribeConfig} = await mountOptions();
    const hashListener = addEventListener.mock.calls.find(([event]) => event === 'hashchange')?.[1];
    expect(hashListener).toBeTypeOf('function');
    unmount?.();
    unmount = undefined;
    expect(removeEventListener).toHaveBeenCalledWith('hashchange', hashListener);
    expect(mediaAdd).toHaveBeenCalledTimes(2);
    expect(mediaRemove).toHaveBeenCalledTimes(2);
    expect(unsubscribeConfig).toHaveBeenCalledOnce();
    await navigateHash('#settings-vocabulary');
    expect(state.activeSection).toBe('settings-selection');
  });
});


it('reveals collapsed groups and the correct page category for a cross-page control', async () => {
  const {state, location} = await mountOptions('#settings-general');
  expect(state.isGroupOpen(0)).toBe(true);
  expect(state.isGroupOpen(3)).toBe(true);
  state.toggleGroup(3);
  expect(state.isGroupOpen(3)).toBe(false);
  state.selectSection('settings-advanced', 'cache');
  expect(state.activePanel).toBe('cache');
  expect(state.isGroupOpen(3)).toBe(true);
  expect(location.hash).toBe('#settings-advanced');
  state.selectPanel('requests');
  expect(state.activePanel).toBe('requests');
  state.selectSection('settings-translation', 'floating-ball-settings');
  expect(state.activePanel).toBe('floating-ball');
  state.selectSection('settings-translation');
  expect(state.activePanel).toBe('reading');
  state.toggleGroup(3);
  expect(state.isGroupOpen(3)).toBe(false);
  state.toggleGroup(3);
  expect(state.isGroupOpen(3)).toBe(true);
});

it('keeps model-usage deep links inside the statistics page and preserves the tab on reload', async () => {
  const {state, location, navigateHash} = await mountOptions('#settings-model-usage');
  expect(state.activeSection).toBe('settings-translation-stats');
  expect(state.activePanel).toBe('usage');
  expect(location.hash).toBe('#settings-model-usage');
  state.selectPanel('overview');
  expect(location.hash).toBe('#settings-translation-stats');
  state.selectPanel('usage');
  expect(location.hash).toBe('#settings-model-usage');
  await navigateHash('#settings-general');
  await navigateHash('#settings-model-usage');
  expect(state.activePanel).toBe('usage');
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
async function nextFixture() {
  const scope: FixtureScope = {active: true};
  current = scope;
  await prepareFixture(scope);
  return scope;
}

it('closes a late created server without taking the subsequent fixture ownership', async () => {
  await closeFixture(current!);
  const old: FixtureScope = {active: true};
  current = old;
  const gate = deferred<ViteDevServer>();
  const lateServer = await createFixtureServer();
  const closed = vi.spyOn(lateServer, 'close');
  const pending = prepareFixture(old, () => gate.promise).catch(error => error);
  await closeFixture(old);
  const next = await nextFixture();
  const mounted = await mountOptions();
  const ownedUnmount = unmount, ownedGlobal = (globalThis as any)[TEST_KEY];
  gate.resolve(lateServer);
  expect(await pending).toEqual(inactive());
  expect(closed).toHaveBeenCalledTimes(1);
  expect(current).toBe(next);expect(unmount).toBe(ownedUnmount);
  expect((globalThis as any)[TEST_KEY]).toBe(ownedGlobal);
  expect(mounted.addEventListener.mock.calls.filter(([event]) => event === 'hashchange')).toHaveLength(1);
  expect(mounted.releaseAppearance).not.toHaveBeenCalled();
  const listener = mounted.addEventListener.mock.calls.find(([event]) => event === 'hashchange')?.[1];
  unmount?.();unmount = undefined;
  expect(mounted.removeEventListener).toHaveBeenCalledWith('hashchange', listener);
  expect(mounted.unsubscribeConfig).toHaveBeenCalledOnce();
});

it.each(['resolve', 'reject'] as const)('rejects a late SSR loader %s without mounting or replacing the next fixture cleanup', async outcome => {
  const old = current!;
  const gate = deferred<Record<string, any>>(), loaded = deferred<Record<string, any>>();
  const failure = new Error('original delayed loader failure');
  const pending = mountOptions('#settings-learning-center', Promise.resolve(), undefined, async ownedServer => {
    loaded.resolve(await ownedServer.ssrLoadModule('/src/app/options/OptionsApp.vue'));
    return gate.promise;
  }).catch(error => error);
  const actualModule = await loaded.promise;
  const oldGlobals = (globalThis as any)[TEST_KEY];
  const closed = vi.spyOn(old.server!, 'close');
  await closeFixture(old);
  const next = await nextFixture();
  const mounted = await mountOptions();
  const ownedUnmount = unmount, ownedGlobal = (globalThis as any)[TEST_KEY];
  if (outcome === 'resolve') gate.resolve(actualModule);else gate.reject(failure);
  const error = await pending;
  if (outcome === 'resolve') expect(error).toEqual(inactive());else expect(error).toBe(failure);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(oldGlobals.theme).not.toHaveBeenCalled();expect(oldGlobals.registerAppearance).not.toHaveBeenCalled();
  expect(current).toBe(next);expect(unmount).toBe(ownedUnmount);
  expect((globalThis as any)[TEST_KEY]).toBe(ownedGlobal);
  expect(mounted.addEventListener.mock.calls.filter(([event]) => event === 'hashchange')).toHaveLength(1);
  const listener = mounted.addEventListener.mock.calls.find(([event]) => event === 'hashchange')?.[1];
  unmount?.();unmount = undefined;
  expect(mounted.removeEventListener).toHaveBeenCalledWith('hashchange', listener);
  expect(mounted.unsubscribeConfig).toHaveBeenCalledOnce();
});

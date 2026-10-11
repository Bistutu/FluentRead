import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {compileScript, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import {parseHTML} from 'linkedom';
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
      if (id === './assets/wechat-contact.jpg') return '\0options-contact-image';
      return null;
    },
    load(id) {
      if (id === '\0options-child-component') return 'export default {render: () => null};';
      if (id === '\0options-i18n') return `export const useUiI18n = () => globalThis.${TEST_KEY}.i18n ?? ({t: key => key === "informationHighlight.title" ? "Smart Highlighting" : key, translateLegacy: text => text});`;
      if (id === '\0options-config') return `export const {config, configReady, subscribeConfig} = globalThis.${TEST_KEY};`;
      if (id === '\0options-appearance') return `export const {theme: applyInterfaceTheme, skin: applyInterfaceSkin, font: applyInterfaceFont, registerAppearance: registerInterfaceAppearanceRoot} = globalThis.${TEST_KEY};`;
      if (id === '\0options-capabilities') return `export const {browserCapabilities} = globalThis.${TEST_KEY};`;
      if (id === '\0options-contact-image') return 'export default "synthetic-contact-image";';
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

type RecoveryFixture = {href: string; historyState: unknown; props?: {locationRouting?: 'internal'; initialSection?: string}};
async function mountOptions(hash = '#settings-selection', ready = Promise.resolve(), appearanceRoot?: HTMLElement, load?: (server: ViteDevServer) => Promise<Record<string, any>>, browser = 'chrome', uiLanguage?: UiLanguage, recovery?: RecoveryFixture) {
  const scope = current;
  if (!scope || !owns(scope) || !scope.server) throw inactive();
  const ownedServer = scope.server;
  const initialUrl = recovery ? new URL(recovery.href) : undefined;
  const location = {hash: initialUrl?.hash ?? hash, search: initialUrl?.search ?? '', href: initialUrl?.href ?? `chrome-extension://fixture/options.html${hash}`, reload: vi.fn()};
  const windowEvents = new EventTarget();
  const mediaAdd = vi.fn();
  const mediaRemove = vi.fn();
  const scrollTo = vi.fn();
  const windowScrollTo = vi.fn();
  const unsubscribeConfig = vi.fn();
  const theme = vi.fn(), skin = vi.fn(), font = vi.fn();
  const releaseAppearance = vi.fn(), registerAppearance = vi.fn(() => releaseAppearance);
  const navigationState: {value: unknown} = {value: recovery?.historyState ?? null};
  const replaceState = vi.fn((nextState: unknown, _unused: string, target: string | URL) => {
    navigationState.value = nextState;
    if (!recovery) location.hash = String(target);
    else {
      const next = new URL(String(target), location.href);
      Object.assign(location, {hash: next.hash, search: next.search, href: next.href});
    }
  });
  const historyPort = {get state() {return navigationState.value;}, replaceState};
  const addEventListener = vi.spyOn(windowEvents, 'addEventListener');
  const removeEventListener = vi.spyOn(windowEvents, 'removeEventListener');
  vi.stubGlobal('window', Object.assign(windowEvents, {
    location,
    history: historyPort,
    scrollTo: windowScrollTo,
    matchMedia: () => ({matches: false, addEventListener: mediaAdd, removeEventListener: mediaRemove}),
  }));
  vi.stubGlobal('history', historyPort);
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
  let state!: {activeSection: string; query: string; activeItem: {id: string}; selectSection: (id: string, target?: string) => void; activePanel: string; activePanels: {id: string}[]; sectionPanels: {id: string}[]; contentComponentProps: {activePanel?: string; initialTab?: string; onReload?: (tab: string) => void}; selectPanel: (id: string) => void; isGroupOpen: (index: number) => boolean; toggleGroup: (index: number) => void; settingsContentElement: {scrollTo: typeof scrollTo} | null; filteredResults: SearchResult[]; selectResult: (result: SearchResult) => Promise<void>};
  const app = renderer.createApp({
    setup: () => () => runtime.h(component, {
      ...recovery?.props,
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
  return {state, location, navigateHash, replaceState, historyPort, scrollTo, windowScrollTo, addEventListener, removeEventListener, mediaAdd, mediaRemove, unsubscribeConfig, theme, skin, font, registerAppearance, releaseAppearance, i18n};
}

describe('OptionsApp language recovery search with actual UI messages', () => {
  const englishLanguageSuffix = ['settings-translation/excluded-languages', 'settings-translation', 'settings-image-translation', 'settings-writing', 'settings-glossary'];

  it.each(['chrome', 'userscript'])('shares query work within each actual search evaluation in %s', async browser => {
    const {state} = await mountOptions('#settings-selection', Promise.resolve(), undefined, undefined, browser, 'en-US');
    // Initialize the page's existing localized computed values before counting query work.
    expect(state.filteredResults).toEqual([]);
    const readSearch = (query: string) => {
      state.query = query;
      const queryForms = new Set([query, query.trim(), query.trim().normalize('NFKC')]);
      let lowercaseCalls = 0, normalizationCalls = 0;
      const lowercase = String.prototype.toLocaleLowerCase;
      const normalize = String.prototype.normalize;
      const lowercaseSpy = vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function(this: string, ...args) {
        if (queryForms.has(String(this))) lowercaseCalls += 1;
        return lowercase.apply(this, args);
      });
      const normalizeSpy = vi.spyOn(String.prototype, 'normalize').mockImplementation(function(this: string, ...args) {
        if (queryForms.has(String(this))) normalizationCalls += 1;
        return normalize.apply(this, args);
      });
      try {
        const results = state.filteredResults;
        const repeatedResults = state.filteredResults;
        return {results, repeatedResults, lowercaseCalls, normalizationCalls};
      } finally {
        lowercaseSpy.mockRestore();
        normalizeSpy.mockRestore();
      }
    };
    for (const [query, expectedIds] of [
      ['Language', ['settings-general', ...englishLanguageSuffix]],
      ['OpenAI', ['settings-services', 'settings-translation-stats']],
      ['Ｌａｎｇｕａｇｅ', ['settings-general']],
      [' language ', ['settings-general', 'settings-translation', 'settings-image-translation', 'settings-writing', 'settings-glossary']],
      ['UnmatchedAbC'.repeat(10_000), []],
      ['Language', ['settings-general', ...englishLanguageSuffix]],
    ] as const) {
      const {results, repeatedResults, lowercaseCalls, normalizationCalls} = readSearch(query);
      expect(results.map(result => result.id)).toEqual(expectedIds);
      expect(repeatedResults).toBe(results);
      expect(lowercaseCalls).toBe(5);
      expect(normalizationCalls).toBe(2);
    }
    const empty = readSearch('');
    expect(empty.results).toEqual([]);
    expect(empty.lowercaseCalls).toBe(3);
    expect(empty.normalizationCalls).toBe(1);
    // Panels deliberately match the raw query, unlike trimmed navigation/control helpers.
    const space = readSearch(' ');
    expect(space.results[0].id).toBe('settings-translation-stats/overview');
    expect(space.results.at(-1)?.id).toBe('settings-data/history');
    expect(space.results.every(result => result.panelId)).toBe(true);
    expect(space.results.some(result => result.panelId === 'information-highlight')).toBe(browser === 'chrome');
    expect(space.lowercaseCalls).toBe(4);
    expect(space.normalizationCalls).toBe(1);
  });

  it('refreshes the same query when its actual language bundle arrives and reads the latest query on click', async () => {
    const scope = current!;
    const language = runtime.ref<UiLanguage>('en-US');
    const bundleRevision = runtime.ref(0);
    let core!: typeof import('../src/core/i18n');
    const {state} = await mountOptions('#settings-selection', Promise.resolve(), undefined, async ownedServer => {
      core = await ownedServer.ssrLoadModule('/src/core/i18n/index.ts') as typeof import('../src/core/i18n');
      if (!owns(scope)) throw inactive();
      ((globalThis as Record<string, unknown>)[TEST_KEY] as {i18n: ActualUiI18n}).i18n = {
        language,
        // Match the production i18n context's reactive resource-arrival dependency.
        t: (key, params) => {void bundleRevision.value; return core.translate(key, language.value, params);},
        translateLegacy: text => {void bundleRevision.value; return core.translateLegacyText(text, language.value);},
      };
      return ownedServer.ssrLoadModule('/src/app/options/OptionsApp.vue');
    });
    state.query = 'Language';
    const fallback = state.filteredResults;
    expect(fallback.map(result => result.id)).toEqual(['settings-general']);
    expect(fallback[0].label).toBe('软件语言 / Language');
    const [english, patterns] = await Promise.all([
      scope.server!.ssrLoadModule('/src/core/i18n/messages/en-US.ts'),
      scope.server!.ssrLoadModule('/src/core/i18n/messages/legacy-patterns.ts'),
    ]);
    if (!owns(scope)) throw inactive();
    core.registerUiLanguageBundle('en-US', {messages: english.enUSMessages, legacyText: english.enUSLegacyText, legacyPatterns: patterns.createLegacyPatternSet('en-US')});
    bundleRevision.value += 1;
    expect(state.query).toBe('Language');
    expect(state.filteredResults.map(result => result.id)).toEqual(['settings-general', ...englishLanguageSuffix]);
    expect(state.filteredResults[0]).toEqual({id: 'settings-general', sectionId: 'settings-general', label: 'App language / Language', searchDescription: 'Choose the language used across FluentRead.'});
    language.value = 'zh-CN';
    expect(state.filteredResults).toEqual(fallback);
    language.value = 'en-US';
    const oldLanguageResult = state.filteredResults[0];
    state.query = 'OpenAI';
    expect(state.filteredResults.map(result => result.id)).toEqual(['settings-services', 'settings-translation-stats']);
    const querySelector = vi.fn();
    vi.stubGlobal('document', {querySelector});
    await state.selectResult(oldLanguageResult);
    expect(state.activeSection).toBe('settings-general');
    expect(state.query).toBe('');
    expect(querySelector).not.toHaveBeenCalled();
  });

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
        searchDescription: language === 'en-US' ? 'Choose the language used across FluentRead.' : '选择流畅阅读所有界面使用的语言',
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

describe('OptionsApp actual learning-panel reload callback', () => {
  it('reloads the requested panel with the current URL and history state preserved', async () => {
    const historyState = {navigation: {owner: 'host'}, position: 4};
    const href = 'chrome-extension://fixture/embedded/options.html?existing=a%2Fb&learningTab=history&keep=two#settings-vocabulary';
    const {state, location, replaceState, historyPort} = await mountOptions('#settings-vocabulary', Promise.resolve(), undefined, undefined, 'chrome', undefined, {href, historyState});
    expect(state.activeSection).toBe('settings-vocabulary');
    expect(state.contentComponentProps.initialTab).toBe('history');
    expect(state.contentComponentProps.onReload).toBeTypeOf('function');
    expect(replaceState).not.toHaveBeenCalled();
    state.contentComponentProps.onReload!('memory');
    expect(replaceState).toHaveBeenCalledOnce();
    const [savedState, title, destination] = replaceState.mock.calls[0];
    expect(savedState).toBe(historyState);
    expect(title).toBe('');
    const next = new URL(String(destination));
    expect(next.protocol).toBe('chrome-extension:');
    expect(next.host).toBe('fixture');
    expect(next.pathname).toBe('/embedded/options.html');
    expect(next.hash).toBe('#settings-vocabulary');
    expect(next.searchParams.get('existing')).toBe('a/b');
    expect(next.searchParams.get('keep')).toBe('two');
    expect(next.searchParams.getAll('learningTab')).toEqual(['memory']);
    expect(historyPort.state).toBe(historyState);
    expect(location.href).toBe(next.href);
    expect(location.reload).toHaveBeenCalledOnce();
    expect(replaceState.mock.invocationCallOrder[0]).toBeLessThan(location.reload.mock.invocationCallOrder[0]);
  });

  it('reloads an internal settings mount without rewriting its host URL or history', async () => {
    const historyState = {hostRoute: 'article', position: 8};
    const href = 'https://example.test/article?siteFilter=recent&learningTab=history#host-anchor';
    const {state, location, replaceState, historyPort} = await mountOptions('#host-anchor', Promise.resolve(), undefined, undefined, 'userscript', undefined, {
      href, historyState, props: {locationRouting: 'internal', initialSection: 'settings-vocabulary'},
    });
    expect(state.activeSection).toBe('settings-vocabulary');
    expect(state.contentComponentProps.initialTab).toBe('history');
    expect(state.contentComponentProps.onReload).toBeTypeOf('function');
    state.contentComponentProps.onReload!('memory');
    expect(location.reload).toHaveBeenCalledOnce();
    expect(replaceState).not.toHaveBeenCalled();
    expect(location.href).toBe(href);
    expect(location.search).toBe('?siteFilter=recent&learningTab=history');
    expect(location.hash).toBe('#host-anchor');
    expect(historyPort.state).toBe(historyState);
  });
});

// Optional real-client parent mode: navigation, search, hash resolution and capability gates
// remain the actual Options template/setup; async feature modules are counted display ports.
type AboutClientFixture = {supportGlobal?: string};
async function mountClientOptions(requestedSection: string, browser: 'userscript' | 'chrome' | 'firefox', about?: AboutClientFixture) {
  const scope = current!;
  if (!owns(scope) || !scope.server) throw inactive();
  const server = scope.server;
  const [navigation, capabilities, core, english, patterns, ordinaryImages] = await Promise.all([
    server.ssrLoadModule('/src/features/settings/model/navigation.ts'),
    server.ssrLoadModule('/src/platform/browser/capabilities.ts'),
    server.ssrLoadModule('/src/core/i18n/index.ts'),
    server.ssrLoadModule('/src/core/i18n/messages/en-US.ts'),
    server.ssrLoadModule('/src/core/i18n/messages/legacy-patterns.ts'),
    // Real ordinary helper with only its JPEG asset URL replaced by the fixture port.
    server.ssrLoadModule('/src/app/options/aboutImages.ts'),
  ]);
  if (!owns(scope)) throw inactive();
  core.registerUiLanguageBundle('en-US', {messages: english.enUSMessages, legacyText: english.enUSLegacyText, legacyPatterns: patterns.createLegacyPatternSet('en-US')});
  const {window, document} = parseHTML(about
    ? '<html lang="fr" class="host-class" style="--host-sentinel: 7" data-theme="host-theme" data-interface-skin="host-skin" data-interface-font="host-font"><head><title>Host title sentinel</title></head><body></body></html>'
    : '<html><body></body></html>');
  const hostDocumentState = () => ({title: document.title, lang: document.documentElement.getAttribute('lang'),
    attributes: Object.fromEntries(['class', 'style', 'data-theme', 'data-interface-skin', 'data-interface-font']
      .map(name => [name, document.documentElement.getAttribute(name)]))});
  const initialHostDocumentState = hostDocumentState();
  if (about) vi.stubGlobal('__FLUENTREAD_APPROVE_DATA__', about.supportGlobal);
  const images = {support: vi.fn((normalUrl: string) => ordinaryImages.getSupportImageUrl(normalUrl) as string),
    contact: vi.fn(() => ordinaryImages.getContactImageUrl() as string)};
  let dialogSlotRuns = 0;
  const dialogNotifications: {closed?: () => void} = {};
  for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event'])
    vi.stubGlobal(key, key === 'window' ? window : window[key as keyof typeof window]);
  const prefix = '#fluentread-userscript-settings';
  const location = {hash: `${prefix}/${requestedSection}`, search: '', href: `https://fixture.test/article${prefix}/${requestedSection}`};
  const historyPort = {replaceState: vi.fn((_state: unknown, _title: string, target: string | URL) => {location.hash = String(target);location.href = `https://fixture.test/article${location.hash}`;})};
  Object.assign(window, {location, history: historyPort, matchMedia: () => ({matches: false, addEventListener() {}, removeEventListener() {}}),
    setTimeout, clearTimeout, scrollTo: vi.fn()});
  vi.stubGlobal('history', historyPort);
  window.HTMLElement.prototype.scrollTo = vi.fn();window.HTMLElement.prototype.scrollIntoView = vi.fn();
  const frames = new Map<number, FrameRequestCallback>();let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {frames.set(++sequence, callback);return sequence;});
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('MutationObserver', class {observe() {} disconnect() {}});
  vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
  const language = runtime.ref<UiLanguage>('zh-CN');
  const i18n = {language, t: (key: string, params?: TranslationParams) => core.translate(key, language.value, params), translateLegacy: (text: string) => core.translateLegacyText(text, language.value)};
  const config = {interfaceSkin: 'default'}, unsubscribe = vi.fn(), loads = {settings: vi.fn(), learning: vi.fn()};
  const errors: unknown[] = [];
  const display = runtime.defineComponent({setup: () => () => runtime.h('span')});
  const anchorPort = runtime.defineComponent({setup(_props, {expose}) {expose({cancelPendingAnchor() {}});return () => runtime.h('span');}});
  const settingsPort = runtime.defineComponent({name: 'SettingsDisplayPort', props: ['activeSection'], setup: props => () => runtime.h('section', {'data-settings-child': 'settings', 'data-active-section': props.activeSection}, props.activeSection)});
  const learningPort = runtime.defineComponent({name: 'LearningDisplayPort', setup: () => () => runtime.h('section', {'data-settings-child': 'learning'}, 'Saved display port')});
  const filename = resolve('src/app/options/OptionsApp.vue');
  const {descriptor, errors: parseErrors} = parse(readFileSync(filename, 'utf8'), {filename});expect(parseErrors).toEqual([]);
  const script = compileScript(descriptor, {id: 'options-capability-client', inlineTemplate: true});
  const module = {exports: {} as {default: import('vue').Component}};
  const code = ts.transpileModule(script.content.replaceAll('import.meta.env.BROWSER', JSON.stringify(browser)), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  new Function('require', 'exports', 'module', code)((id: string) => {
    if (id === 'vue') return runtime;
    if (id === '@/src/features/settings/model/navigation') return navigation;
    if (id === '@/src/ui/i18n') return {useUiI18n: () => i18n};
    if (id === '@/src/services/config/store') return {config, configReady: Promise.resolve(), subscribeConfig: () => unsubscribe};
    if (id === '@/src/platform/browser/capabilities') return {browserCapabilities: capabilities.resolveBrowserCapabilities({browser, manifestVersion: browser === 'chrome' ? 3 : 2})};
    if (id === '@/src/ui/interfaceAppearance') return {applyInterfaceTheme() {}, applyInterfaceSkin() {}, applyInterfaceFont() {}, registerInterfaceAppearanceRoot: () => () => undefined};
    if (id === '@/src/features/settings/ui/SettingsSections.vue') {loads.settings();return {__esModule: true, default: settingsPort};}
    if (id === '@/src/features/settings/ui/LearningCenter.vue') {loads.learning();return {__esModule: true, default: learningPort};}
    if (id.endsWith('/SettingsSectionNavigation.vue')) return {default: anchorPort};
    if (id.endsWith('.vue')) return {default: display};
    if (id === './aboutImages') return {getSupportImageUrl: images.support, getContactImageUrl: images.contact};
    if (id.endsWith('.jpg')) return {default: 'synthetic-contact-image'};
    throw new Error(`Unexpected Options client dependency ${id}`);
  }, module.exports, module);
  const renderer = runtime.createRenderer<Node, Element>({
    // Native DOM nodes are non-reactive; preserve that identity for LinkeDOM refs too.
    createElement: tag => runtime.markRaw(document.createElement(tag)), createText: text => runtime.markRaw(document.createTextNode(text)), createComment: text => runtime.markRaw(document.createComment(text)),
    insert: (node, parent, anchor) => parent.insertBefore(node, anchor ?? null), remove: node => node.parentNode?.removeChild(node),
    setText: (node, value) => {node.nodeValue = value;}, setElementText: (element, value) => {element.textContent = value;},
    parentNode: node => node.parentNode as Element | null, nextSibling: node => node.nextSibling,
    patchProp: (element, key, _before, value) => {
      if (key.startsWith('onUpdate:')) return;
      if (/^on[A-Z]/u.test(key)) {
        const events = element as Element & {__optionsEvents?: Map<string, EventListener>};
        const name = key.slice(2).toLowerCase();events.__optionsEvents ??= new Map();
        const prior = events.__optionsEvents.get(name);if (prior) element.removeEventListener(name, prior);
        if (value) {const handler: EventListener = event => {for (const fn of Array.isArray(value) ? value : [value]) {
          if (!about) fn(event);
          else {try {fn(event);} catch (error) {errors.push(error);}}
        }};events.__optionsEvents.set(name, handler);element.addEventListener(name, handler);}
      } else if (key === 'value' && ['INPUT', 'TEXTAREA'].includes(element.tagName)) (element as HTMLInputElement).value = value ?? '';
      else if (key.startsWith('aria-') && value != null) element.setAttribute(key, String(value));
      else if (value == null || value === false) element.removeAttribute(key);
      else element.setAttribute(key, value === true ? '' : String(value));
    }, setScopeId: (element, id) => element.setAttribute(id, ''), insertStaticContent: (content, parent, anchor) => {
      const container = document.createElement('div');container.innerHTML = content;const first = container.firstChild!, last = container.lastChild!;
      for (const node of [...container.childNodes]) parent.insertBefore(node, anchor);return [first, last];
    },
  });
  const host = document.createElement('div');document.body.appendChild(host);
  const app = renderer.createApp(module.exports.default, {settingsHashPrefix: browser === 'userscript' ? prefix : undefined});
  if (browser !== 'userscript') location.hash = `#${requestedSection}`;
  app.component('ElDialog', about ? runtime.defineComponent({
    props: {modelValue: Boolean}, emits: ['update:modelValue', 'closed'],
    setup(props, {slots, emit}) {
      dialogNotifications.closed = () => emit('closed');
      return () => {
        // Deliberately evaluate the slot while false: hidden must not cause eager acquisition.
        dialogSlotRuns++;
        return runtime.h('section', {'data-about-dialog-port': '', 'data-model-visible': String(props.modelValue),
          'aria-hidden': String(!props.modelValue)}, [
          ...(slots.default?.() ?? []),
          runtime.h('button', {type: 'button', 'data-about-dialog-close': '',
            onClick: () => emit('update:modelValue', false)}, 'Controlled dialog close'),
        ]);
      };
    },
  }) : runtime.defineComponent({render: () => null}));
  app.config.warnHandler = () => undefined;app.config.errorHandler = error => errors.push(error);
  let mounted = false;
  scope.unmount = () => {if (mounted) {mounted = false;app.unmount();}frames.clear();host.remove();};unmount = scope.unmount;
  app.mount(host);mounted = true;
  const settle = async () => {for (let i = 0; i < 10; i++) {await Promise.resolve();await runtime.nextTick();}};
  await settle();
  const rail = (section: string) => host.querySelector<HTMLButtonElement>(`button[data-section="${section}"]`)!;
  const choose = async (section: string) => {rail(section).click();await settle();};
  const navigateHash = async (section: string) => {location.hash = browser === 'userscript' ? `${prefix}/${section}` : `#${section}`;window.dispatchEvent(new window.Event('hashchange'));await settle();};
  const previewState = () => {
    const dialog = host.querySelector<HTMLElement>('[data-about-dialog-port]')!;
    const image = dialog.querySelector<HTMLImageElement>('.about-approve-preview')!;
    return {visible: dialog.getAttribute('data-model-visible'),
      kind: dialog.classList.contains('about-wechat-contact-dialog') ? 'contact' : 'support',
      title: dialog.getAttribute('title'), src: image.getAttribute('src'), alt: image.getAttribute('alt'),
      width: image.getAttribute('width'), height: image.getAttribute('height')};
  };
  const notifyDialogClosed = () => {if (!dialogNotifications.closed) throw new Error('Dialog display port is not mounted');dialogNotifications.closed();};
  return {host, loads, errors, language, t: i18n.t, location, prefix, unsubscribe, settle, rail, choose, navigateHash,
    images, previewState, notifyDialogClosed, dialogSlotEvaluations: () => dialogSlotRuns,
    hostDocumentState, initialHostDocumentState, dispose: () => scope.unmount?.(),
    search: host.querySelector<HTMLInputElement>('input[type="search"]')!};
}

describe('OptionsApp actual client standalone capability navigation', () => {
  it.each([
    ['settings-image-translation', 'settings-image-translation'],
    ['settings-area-translation', 'settings-image-translation'],
    ['settings-video', 'settings-video'],
    ['settings-writing', 'settings-writing'],
    ['settings-translation-stats', 'settings-translation-stats'],
    ['settings-model-usage', 'settings-translation-stats'],
  ])('keeps unavailable %s public links without loading extension forms', async (requested, canonical) => {
    const h = await mountClientOptions(requested, 'userscript');
    for (const language of ['zh-CN', 'en-US'] as const) {
      h.language.value = language;await h.settle();
      const notice = h.host.querySelector('.userscript-unavailable[role="status"]')!;
      expect(notice).not.toBeNull();expect(notice.id).toBe(canonical);
      expect(notice.querySelector('h2')!.textContent).toBe(h.t('options.userscriptUnavailableTitle'));
      expect(notice.querySelector('p')!.textContent).toBe(h.t('options.userscriptUnavailableDescription'));
      expect(h.rail(canonical).getAttribute('aria-current')).toBe('page');
      expect(h.loads.settings).not.toHaveBeenCalled();expect(h.loads.learning).not.toHaveBeenCalled();
    }
    expect(h.location.hash).toBe(`${h.prefix}/${requested === 'settings-area-translation' ? canonical : requested}`);
    const label = h.rail(canonical).querySelector('strong')!.textContent!;
    h.search.value = label;h.search.dispatchEvent(new Event('input', {bubbles: true}));await h.settle();
    const result = [...h.host.querySelectorAll<HTMLButtonElement>('.search-results button')].find(button => button.querySelector('strong')?.textContent === label)!;
    expect(result).toBeDefined();result.click();await h.settle();
    expect(h.search.value).toBe('');expect(h.host.querySelector('.userscript-unavailable')).not.toBeNull();
    expect(h.loads.settings).not.toHaveBeenCalled();expect(h.loads.learning).not.toHaveBeenCalled();
    await h.choose('settings-general');
    expect(h.host.querySelector('[data-settings-child="settings"]')?.getAttribute('data-active-section')).toBe('settings-general');
    expect(h.host.querySelector('.userscript-unavailable')).toBeNull();
    for (const section of ['settings-services', 'settings-selection']) {
      await h.choose(section);expect(h.host.querySelector('[data-settings-child="settings"]')?.getAttribute('data-active-section')).toBe(section);
    }
    await h.choose('settings-vocabulary');expect(h.host.querySelector('[data-settings-child="learning"]')).not.toBeNull();
    expect(h.loads.settings).toHaveBeenCalledOnce();expect(h.loads.learning).toHaveBeenCalledOnce();
    await h.navigateHash(requested);expect(h.host.querySelector('.userscript-unavailable[role="status"]')?.id).toBe(canonical);
    expect(h.loads.settings).toHaveBeenCalledOnce();expect(h.loads.learning).toHaveBeenCalledOnce();expect(h.errors).toEqual([]);
  });

  it.each(['chrome', 'firefox'] as const)('keeps the existing extension child path callable in %s', async browser => {
    const h = await mountClientOptions('settings-image-translation', browser);
    expect(h.host.querySelector('.userscript-unavailable')).toBeNull();
    expect(h.host.querySelector('[data-settings-child="settings"]')?.getAttribute('data-active-section')).toBe('settings-image-translation');
    for (const section of ['settings-video', 'settings-writing', 'settings-translation-stats']) {
      await h.choose(section);expect(h.host.querySelector('.userscript-unavailable')).toBeNull();
      expect(h.host.querySelector('[data-settings-child="settings"]')?.getAttribute('data-active-section')).toBe(section);
    }
    expect(h.loads.settings).toHaveBeenCalledOnce();expect(h.loads.learning).not.toHaveBeenCalled();expect(h.errors).toEqual([]);
  });
});

describe('OptionsApp actual client localized sidebar brand', () => {
  it.each(['userscript', 'chrome', 'firefox'] as const)('reactively restores the brand through all UI languages in %s without a legacy DOM scanner', async browser => {
    const h = await mountClientOptions('settings-general', browser);
    const bundles = await current!.server!.ssrLoadModule('/src/core/i18n/bundles.ts');
    bundles.registerAllUiLanguageBundles();
    const brand = () => h.host.querySelector<HTMLElement>('.brand-copy strong')!;
    expect(brand().textContent).toBe('流畅阅读');
    expect(brand().hasAttribute('data-i18n-ignore')).toBe(true);
    for (const language of ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const) {
      h.language.value = language;
      await h.settle();
      expect(brand().textContent).toBe('FluentRead');
      expect(brand().textContent).toBe(h.t('common.brand'));
    }
    h.language.value = 'zh-CN';
    await h.settle();
    expect(brand().textContent).toBe('流畅阅读');
    expect(h.errors).toEqual([]);
  });
});

// Linkedom/client display-port evidence only: this is not an Element Plus animation,
// browser image decode, native focus, or JPEG-cache performance test.
describe('OptionsApp actual client lazy About image ownership', () => {
  const supportSnapshot = 'data:image/jpeg;base64,c3ludGhldGljLXNldHVwLXN1cHBvcnQ=';
  const contactPort = 'synthetic-contact-image';
  const mountAbout = (section = 'settings-general', supportGlobal?: string) =>
    mountClientOptions(section, 'userscript', {supportGlobal});
  const assertSupportSnapshot = (h: Awaited<ReturnType<typeof mountAbout>>, expected: string) => {
    expect(h.images.support).toHaveBeenCalled();
    expect(h.images.support.mock.calls.every(([url]) => url === expected)).toBe(true);
  };

  it('does not acquire either image or assign a preview src in General even when the hidden dialog slot renders', async () => {
    const h = await mountAbout();
    expect(h.dialogSlotEvaluations()).toBeGreaterThan(0);
    expect(h.previewState()).toMatchObject({visible: 'false', src: null, kind: 'support'});
    expect(h.images.support).not.toHaveBeenCalled();
    expect(h.images.contact).not.toHaveBeenCalled();
    expect(h.host.querySelector('#settings-about')).toBeNull();
    await h.choose('settings-about');
    expect(h.host.querySelector('.about-support-qr')?.getAttribute('src')).toBe('/misc/approve.jpg');
    assertSupportSnapshot(h, '/misc/approve.jpg');
    expect(h.images.contact).not.toHaveBeenCalled();
    expect(h.previewState()).toMatchObject({visible: 'false', src: null});
    expect(h.hostDocumentState()).toEqual(h.initialHostDocumentState);
    expect(h.errors).toEqual([]);
  });

  it('acquires contact only through its public button and retains the setup support snapshot across host global changes', async () => {
    const h = await mountAbout('settings-general', supportSnapshot);
    vi.stubGlobal('__FLUENTREAD_APPROVE_DATA__', 'synthetic-later-host-support');
    await h.choose('settings-about');
    expect(h.host.querySelector('.about-support-qr')?.getAttribute('src')).toBe(supportSnapshot);
    expect(h.images.contact).not.toHaveBeenCalled();
    assertSupportSnapshot(h, supportSnapshot);
    await h.choose('settings-general');
    await h.choose('settings-about');
    expect(h.images.contact).not.toHaveBeenCalled();
    const contact = h.host.querySelector<HTMLButtonElement>('button.about-wechat-contact')!;
    expect(contact.getAttribute('type')).toBe('button');
    expect(contact.getAttribute('aria-haspopup')).toBe('dialog');
    contact.click();await h.settle();
    expect(h.images.contact).toHaveBeenCalledTimes(1);
    expect(h.previewState()).toMatchObject({visible: 'true', kind: 'contact', src: contactPort,
      alt: h.t('options.aboutWechatContactCodeAlt'), width: '888', height: '1131'});
    assertSupportSnapshot(h, supportSnapshot);
    const support = h.host.querySelector<HTMLButtonElement>('button.about-support-wechat')!;
    support.click();await h.settle();
    expect(h.images.contact).toHaveBeenCalledTimes(1);
    expect(h.previewState()).toMatchObject({visible: 'true', kind: 'support', src: supportSnapshot,
      alt: h.t('popup.donationCodeAlt'), width: '1152', height: '1152'});
    support.click();await h.settle();
    expect(h.images.contact).toHaveBeenCalledTimes(1);
    expect(h.previewState().src).toBe(supportSnapshot);
    contact.click();await h.settle();
    expect(h.images.contact).toHaveBeenCalledTimes(2);
    expect(h.previewState().src).toBe(contactPort);
    assertSupportSnapshot(h, supportSnapshot);
    expect(h.hostDocumentState()).toEqual(h.initialHostDocumentState);
    expect(h.errors).toEqual([]);
  });

  it.each(['contact', 'support'] as const)('commits no preview state when the selected %s accessor throws', async selected => {
    const h = await mountAbout('settings-about', supportSnapshot);
    const previous = selected === 'contact' ? 'support' : 'contact';
    h.host.querySelector<HTMLButtonElement>(previous === 'contact' ? 'button.about-wechat-contact' : 'button.about-support-wechat')!.click();
    await h.settle();
    const before = h.previewState();
    expect(before.visible).toBe('true');expect(before.kind).toBe(previous);
    const failure = new Error(`synthetic ${selected} image restoration failed`);
    if (selected === 'contact') h.images.contact.mockImplementationOnce(() => {throw failure;});
    else h.images.support.mockImplementationOnce(() => {throw failure;});
    h.host.querySelector<HTMLButtonElement>(selected === 'contact' ? 'button.about-wechat-contact' : 'button.about-support-wechat')!.click();
    await h.settle();
    expect(h.errors).toEqual([failure]);
    expect(h.previewState()).toEqual(before);
    expect(h.hostDocumentState()).toEqual(h.initialHostDocumentState);
  });

  it.each(['contact', 'support'] as const)('retains %s preview src through close update and returns focus only at the closed notification', async selected => {
    const h = await mountAbout('settings-about', supportSnapshot);
    const trigger = h.host.querySelector<HTMLButtonElement>(selected === 'contact' ? 'button.about-wechat-contact' : 'button.about-support-wechat')!;
    const focus = vi.spyOn(trigger, 'focus').mockImplementation(() => undefined);
    trigger.click();await h.settle();
    const before = h.previewState();expect(before.visible).toBe('true');
    const contactCalls = h.images.contact.mock.calls.length;
    h.host.querySelector<HTMLButtonElement>('[data-about-dialog-close]')!.click();
    await h.settle();
    expect(h.previewState()).toEqual({...before, visible: 'false'});
    expect(focus).not.toHaveBeenCalled();
    expect(h.images.contact).toHaveBeenCalledTimes(contactCalls);
    h.notifyDialogClosed();await h.settle();
    expect(focus).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith({preventScroll: true});
    expect(h.images.contact).toHaveBeenCalledTimes(contactCalls);
    assertSupportSnapshot(h, supportSnapshot);
    expect(h.hostDocumentState()).toEqual(h.initialHostDocumentState);
    expect(h.errors).toEqual([]);
  });

  it.each(['leave-about', 'unmount'] as const)('does not restore the old trigger after %s before the delayed closed notification', async outcome => {
    const h = await mountAbout('settings-about', supportSnapshot);
    const trigger = h.host.querySelector<HTMLButtonElement>('button.about-wechat-contact')!;
    const focus = vi.spyOn(trigger, 'focus').mockImplementation(() => undefined);
    trigger.click();await h.settle();
    h.host.querySelector<HTMLButtonElement>('[data-about-dialog-close]')!.click();
    await h.settle();expect(focus).not.toHaveBeenCalled();
    if (outcome === 'leave-about') await h.choose('settings-general');
    else h.dispose();
    const supportCalls = h.images.support.mock.calls.length, contactCalls = h.images.contact.mock.calls.length;
    h.notifyDialogClosed();await h.settle();
    expect(focus).not.toHaveBeenCalled();
    expect(h.images.support).toHaveBeenCalledTimes(supportCalls);
    expect(h.images.contact).toHaveBeenCalledTimes(contactCalls);
    expect(h.hostDocumentState()).toEqual(h.initialHostDocumentState);
    expect(h.errors).toEqual([]);
  });
});

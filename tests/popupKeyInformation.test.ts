/**
 * @file tests/popupKeyInformation.test.ts
 * 文件职责：执行真实 Popup 客户端模板，验证首页默认服务、配置模型与原有抽屉入口。
 * 主要内容：覆盖模型能力、请求体覆盖、自定义接口、外部同步、中英文无障碍名称，以及模块排序、PDF 主入口与迟到标签页查询的模板边界。
 * 模块边界：浏览器、配置存储和展示组件为受控端口；不读取源码私有状态，不将 DOM 测试视为真实几何或在线服务证明。
 */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseHTML} from 'linkedom';
import {createServer, type ViteDevServer} from 'vite';
import {compileScript, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import type {App, Component, Plugin} from 'vue';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {customModelString} from '@/src/core/config/catalog';
import {LOCAL_TRANSLATION_MODEL_IDS} from '@/src/core/config/localTranslation';
import {translate, translateLegacyText, type UiLanguage} from '@/src/core/i18n';
import {registerAllUiLanguageBundles} from '@/src/core/i18n/bundles';
import type {PopupActiveTab} from '@/src/app/popup/pageActions';

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
const language = runtime.ref<UiLanguage>('zh-CN');
const config = new Config();
const listeners = new Set<(value: Config) => void>();
const patches = vi.fn(), openOptions = vi.fn(), createTab = vi.fn();
const queryTabs = vi.fn<() => Promise<PopupActiveTab[]>>();
const send = vi.fn<(id: number, message: {type: string; action?: string}) => Promise<unknown>>();
const tabUpdated = new Set<(id: number, change: {url?: string; status?: string}, tab: PopupActiveTab & {active?: boolean}) => void>();
let server: ViteDevServer, component: Component, app: App | undefined, document: Document;
let window: ReturnType<typeof parseHTML>['window'];

async function settle() {for (let index = 0; index < 12; index++) {await Promise.resolve();await runtime.nextTick();}}
function publish(update: (draft: Config) => void) {
  const next = normalizeConfig(config);
  update(next);
  Object.assign(config, next);
  for (const listener of listeners) listener(next);
}
function summary() {
  const button = document.querySelector<HTMLButtonElement>('[data-testid="popup-feature-services"]');
  expect(button).not.toBeNull();
  return button!;
}
function model() {return summary().querySelector('.provider-summary-model');}

beforeAll(async () => {
  registerAllUiLanguageBundles();
  vi.stubGlobal('__popupSummaryFixture', {config, language, listeners, patches, openOptions, createTab, queryTabs, send, tabUpdated,
    t: (key: string, params?: Parameters<typeof translate>[2]) => translate(key, language.value, params),
    translateLegacy: (text: string) => translateLegacyText(text, language.value)});
  server = await createServer({root: process.cwd(), configFile: false, appType: 'custom', logLevel: 'silent',
    resolve: {alias: {'@': process.cwd()}}, ssr: {noExternal: ['webextension-polyfill']}, plugins: [{name: 'popup-summary-client', enforce: 'pre', resolveId(id) {
      if (/(?:\/|^)Popup(?:App|SiteRule)\.vue$/u.test(id)) return resolve('src/app/popup', id.split('/').at(-1)!) + '.summary.ts';
      if (id === 'webextension-polyfill') return '\0summary-browser';
      if (/\/src\/services\/config\/store(?:\.ts)?$/u.test(id)) return '\0summary-config';
      if (/\/src\/ui\/i18n(?:\.ts)?$/u.test(id)) return '\0summary-i18n';
      if (/\/src\/ui\/interfaceAppearance(?:\.ts)?$/u.test(id)) return '\0summary-appearance';
      if (/\/src\/platform\/browser\/capabilities(?:\.ts)?$/u.test(id)) return '\0summary-capabilities';
      if (id.endsWith('/PopupDrawer') || id.endsWith('/PopupDrawer.ts')) return '\0summary-drawer';
      if (id.endsWith('/PopupServices.vue')) return '\0summary-services';
      if (id === '@element-plus/icons-vue') return '\0summary-icons';
      if (id.endsWith('.vue')) return '\0summary-display';
      return null;
    }, load(id) {
      if (id.endsWith('.vue.summary.ts')) {
        const componentPath = id.slice(0, -11), file = componentPath.startsWith('/src/') ? resolve(componentPath.slice(1)) : componentPath;
        const {descriptor, errors} = parse(readFileSync(file, 'utf8'), {filename: file});
        expect(errors).toEqual([]);
        descriptor.template!.content = descriptor.template!.content.replace(/<\/?Transition\b/gu, tag => tag.replace('Transition', 'OwnedTransition'));
        const script = compileScript(descriptor, {id: 'popup-summary-client', inlineTemplate: true});
        return ts.transpileModule(script.content, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
      }
      if (id === '\0summary-browser') return `const f=globalThis.__popupSummaryFixture;const event={addListener:()=>{},removeListener:()=>{}};
        export default {tabs:{query:f.queryTabs,sendMessage:f.send,create:f.createTab,
          onUpdated:{addListener:fn=>f.tabUpdated.add(fn),removeListener:fn=>f.tabUpdated.delete(fn)},onActivated:event,onRemoved:event},
        runtime:{getManifest:()=>({version:'0.0.35'}),getURL:p=>'extension://'+p,sendMessage:async()=>({success:true}),openOptionsPage:f.openOptions}};`;
      if (id === '\0summary-config') return `const f=globalThis.__popupSummaryFixture;export const config=f.config;
        export const subscribeConfig=fn=>{f.listeners.add(fn);return()=>f.listeners.delete(fn)};
        export const requestConfigPatch=async value=>f.patches(value);export const handoffPendingConfigPatches=async()=>{};`;
      if (id === '\0summary-i18n') return 'export const useUiI18n=()=>globalThis.__popupSummaryFixture;';
      if (id === '\0summary-appearance') return 'export const applyInterfaceFont=()=>{},applyInterfaceSkin=()=>{};';
      if (id === '\0summary-capabilities') return "export const browserCapabilities={browser:'chrome',areaTranslation:true,imageTranslation:true};";
      if (id === '\0summary-icons') return 'export const Setting={render:()=>null};';
      if (id === '\0summary-drawer') return "import {h} from 'vue';export default {setup(_, {attrs,slots}){return()=>attrs.modelValue||attrs['model-value']?h('div',{class:'drawer-port'},slots.default?.()):null}};";
      if (id === '\0summary-services') return "import {h} from 'vue';export default {emits:['close'],setup(_, {emit}){return()=>h('button',{class:'service-panel-close',onClick:()=>emit('close')},'Close')}};";
      if (id === '\0summary-display') return "import {h} from 'vue';export default {setup(_, {attrs,slots}){return()=>h('div',attrs,slots.default?.())}};";
      return null;
    }}]});
  component = (await server.ssrLoadModule('/src/app/popup/PopupApp.vue')).default;
});

beforeEach(() => {
  vi.clearAllMocks();listeners.clear();tabUpdated.clear();language.value = 'zh-CN';
  queryTabs.mockReset().mockResolvedValue([{id: 7, windowId: 3, url: 'https://example.test/a'}]);
  send.mockReset().mockImplementation(async (_id, message) => message.type === 'getFullPageTranslationState'
    ? {isTranslated: false} : {status: 'success', isTranslated: message.action === 'fullPage'});
  Object.assign(config, normalizeConfig({...new Config(), uiLanguageSetupCompleted: true, on: true,
    service: 'openai', model: {...new Config().model, openai: 'saved-model'}, token: {openai: 'test-only-key'}}));
  const dom = parseHTML('<html><body><div id="app"></div></body></html>');
  document = dom.document;window = dom.window;
  vi.stubGlobal('matchMedia', () => ({matches: false, onchange: null}));
  vi.stubGlobal('close', vi.fn());
  for (const [name, value] of Object.entries({document, window, HTMLElement: window.HTMLElement, Event: window.Event,
    Node: window.Node, MutationObserver: window.MutationObserver, NodeFilter: {SHOW_TEXT: 4}, navigator: {languages: ['zh-CN']}})) vi.stubGlobal(name, value);
});

afterEach(async () => {app?.unmount();app = undefined;await settle();});
afterAll(async () => {await server?.close();vi.unstubAllGlobals();});

async function mount(plugin?: Plugin) {
  const renderer = runtime.createRenderer<Node, HTMLElement>({
    patchProp(node, key, previous, value) {
      if (/^on[A-Z]/u.test(key)) {
        const event = key.slice(2).toLowerCase();
        if (previous) node.removeEventListener(event, previous);
        if (value) node.addEventListener(event, value);
      } else if (value == null || (value === false && !/^(?:aria-|data-)/u.test(key))) node.removeAttribute(key);
      else node.setAttribute(key, String(value));
    },
    insert: (node, parent, anchor) => parent.insertBefore(node, anchor || null), remove: node => node.parentNode?.removeChild(node),
    createElement: tag => runtime.markRaw(document.createElement(tag)), createText: text => document.createTextNode(text),
    createComment: text => document.createComment(text), setText: (node, text) => {node.nodeValue = text;},
    setElementText: (node, text) => {node.textContent = text;}, parentNode: node => node.parentNode as HTMLElement | null,
    nextSibling: node => node.nextSibling, setScopeId: (node, id) => node.setAttribute(id, ''),
    insertStaticContent: (content, parent, anchor) => {
      const template = document.createElement('template');template.innerHTML = content;
      const first = template.content.firstChild!, last = template.content.lastChild!;
      parent.insertBefore(template.content, anchor || null);return [first, last];
    },
  });
  app = renderer.createApp(component);
  if (plugin) app.use(plugin);
  app.component('OwnedTransition', runtime.defineComponent({setup: (_, {slots}) => () => slots.default?.()}));
  app.config.warnHandler = () => undefined;
  app.mount(document.getElementById('app')!);
  await settle();
}

describe('Popup 首页关键信息', () => {
  it.each([['zh-CN', '打开 PDF 阅读器'], ['en-US', 'Open PDF reader']] as const)('%s PDF 主入口保留服务摘要并只打开携带原文地址的阅读器', async (locale, label) => {
    language.value = locale;
    queryTabs.mockResolvedValue([{id: 7, windowId: 3, url: 'https://example.test/docs/research.pdf?edition=2#page=5'}]);
    const before = JSON.stringify(config);
    await mount();
    const button = document.querySelector<HTMLButtonElement>('[data-testid="page-translation"]')!;
    expect(summary().querySelector('strong')?.textContent).toBe('OpenAI');
    expect(model()?.textContent).toBe('saved-model');
    expect(summary().getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.querySelector('.translate-label')?.textContent).toBe(label);
    expect(button.getAttribute('title')).toBe(label);
    expect(button.querySelector('.translate-hotkey')).toBeNull();
    expect(document.querySelector('[data-testid="section-translation"]')).toBeNull();
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(send).not.toHaveBeenCalled();

    button.dispatchEvent(new window.Event('click'));await settle();
    expect(createTab.mock.calls).toEqual([[{url: 'extension://document.html#pdf=https%3A%2F%2Fexample.test%2Fdocs%2Fresearch.pdf%3Fedition%3D2'}]]);
    expect(send).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-busy')).toBe('false');
    expect(JSON.stringify(config)).toBe(before);expect(patches).not.toHaveBeenCalled();
  });

  it('PDF 导航回普通页恢复实际主按钮与快捷键，旧 PDF 查询晚到不改写模板或创建阅读器', async () => {
    language.value = 'en-US';
    queryTabs.mockResolvedValue([{id: 7, windowId: 3, url: 'https://example.test/first.pdf'}]);
    await mount();
    expect(document.querySelector('.translate-label')?.textContent).toBe('Open PDF reader');
    expect(tabUpdated.size).toBe(1);

    let resolveOld!: (tabs: PopupActiveTab[]) => void;
    queryTabs.mockReturnValueOnce(new Promise(resolve => {resolveOld = resolve;}));
    const latePdf = {id: 7, windowId: 3, active: true, url: 'https://example.test/late.pdf'};
    for (const listener of tabUpdated) listener(7, {url: latePdf.url}, latePdf);
    const article = {id: 7, windowId: 3, active: true, url: 'https://example.test/article'};
    queryTabs.mockResolvedValue([article]);
    for (const listener of tabUpdated) listener(7, {url: article.url}, article);
    await settle();

    const button = document.querySelector<HTMLButtonElement>('[data-testid="page-translation"]')!;
    expect(button.querySelector('.translate-label')?.textContent).toBe('Translate this page');
    expect(button.querySelector('.translate-hotkey')?.textContent).toBeTruthy();
    expect(document.querySelector('[data-testid="section-translation"]')).not.toBeNull();
    expect(summary().querySelector('strong')?.textContent).toBe('OpenAI');
    expect(model()?.textContent).toBe('saved-model');
    resolveOld([latePdf]);await settle();
    expect(button.getAttribute('title')).toBe('Translate this page');
    expect(button.querySelector('.translate-hotkey')?.textContent).toBeTruthy();
    expect(document.querySelector('[data-testid="section-translation"]')).not.toBeNull();
    expect(createTab).not.toHaveBeenCalled();
    expect(send.mock.calls).toEqual([[7, {type: 'getFullPageTranslationState'}]]);

    button.dispatchEvent(new window.Event('click'));await settle();
    expect(createTab).not.toHaveBeenCalled();
    expect(send.mock.calls).toEqual([[7, {type: 'getFullPageTranslationState'}], [7, {type: 'contextMenuTranslate', action: 'fullPage'}]]);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(model()?.textContent).toBe('saved-model');expect(patches).not.toHaveBeenCalled();
  });

  it('首页直接显示网页默认服务和配置模型，完整信息进入无障碍名称', async () => {
    await mount();
    expect(summary().querySelector('strong')?.textContent).toBe('OpenAI');
    expect(model()?.textContent).toBe('saved-model');
    expect(model()?.getAttribute('title')).toBe('配置模型：saved-model');
    expect(summary().getAttribute('aria-label')).toBe('按功能选择服务 · 网页默认服务 · OpenAI · 配置模型：saved-model');
    expect(summary().getAttribute('aria-haspopup')).toBe('dialog');
    expect(patches).not.toHaveBeenCalled();
  });

  it('自定义模型仍标为配置模型，请求体覆盖不被误报为最终模型', async () => {
    config.model.openai = customModelString;config.customModel.openai = 'custom/active';
    config.customBody.openai = '{"model":"body-override"}';
    const before = JSON.stringify(config);
    await mount();
    expect(model()?.textContent).toBe('custom/active');
    expect(summary().getAttribute('title')).toContain('custom/active');
    expect(summary().textContent).not.toContain('body-override');
    expect(summary().textContent).not.toContain('当前模型');
    expect(JSON.stringify(config)).toBe(before);expect(patches).not.toHaveBeenCalled();
  });

  it('自定义接口显示保存名称及模型，缺省模型沿用已有首个模型回退', async () => {
    config.service = 'custom:private';
    config.customOpenAIProviders = [{id: 'custom:private', name: 'Private endpoint', endpoint: 'https://example.test/v1', models: ['private-first', 'private-second']}];
    await mount();
    expect(summary().querySelector('strong')?.textContent).toBe('Private endpoint');
    expect(model()?.textContent).toBe('private-first');
    publish(next => {next.model['custom:private'] = 'private-second';});await settle();
    expect(model()?.textContent).toBe('private-second');
  });

  it.each(['google', 'microsoft', 'deepL', 'freeTranslation'])('%s 不显示遗留的 AI 模型，外部切回模型服务恢复摘要', async service => {
    await mount();
    publish(next => {next.service = service;next.model[service] = 'stale-ai-model';});await settle();
    expect(model()).toBeNull();expect(summary().textContent).not.toContain('stale-ai-model');
    expect(summary().getAttribute('aria-label')).not.toContain('配置模型');
    publish(next => {next.service = 'openai';next.model.openai = 'next-model';});await settle();
    expect(model()?.textContent).toBe('next-model');
  });

  it('本地模型服务支持配置模型，显示本地选择而非上一项 AI 模型', async () => {
    config.service = 'localTranslation';config.model.localTranslation = LOCAL_TRANSLATION_MODEL_IDS.hunyuan;
    await mount();
    expect(model()?.textContent).toBe(LOCAL_TRANSLATION_MODEL_IDS.hunyuan);
    expect(summary().textContent).not.toContain('saved-model');
    publish(next => {next.model.localTranslation = LOCAL_TRANSLATION_MODEL_IDS.opusJaEn;});await settle();
    expect(model()?.textContent).toBe(LOCAL_TRANSLATION_MODEL_IDS.opusJaEn);
  });

  it('翻译专用模型不支持 AI 上下文时，仍展示其适用配置模型', async () => {
    config.service = 'tongyi';config.model.tongyi = 'qwen-mt-turbo';config.token.tongyi = 'test-only-key';
    await mount();expect(model()?.textContent).toBe('qwen-mt-turbo');
  });

  it('英文摘要和外部语言同步使用现有配置模型文案', async () => {
    language.value = 'en-US';await mount();
    expect(model()?.textContent).toBe('saved-model');
    expect(model()?.getAttribute('title')).toBe('Configured model: saved-model');
    expect(summary().getAttribute('aria-label')).toBe('Services by feature · Default page service · OpenAI · Configured model: saved-model');
    language.value = 'zh-CN';await settle();expect(model()?.getAttribute('title')).toBe('配置模型：saved-model');
  });

  it('多个功能服务只占默认图标及唯一额外服务计数，不混淆网页默认服务', async () => {
    config.hoverTranslationService = 'deepseek';config.selectionTranslationService = 'google';config.documentService = 'google';
    config.quickTranslationProfiles = [];
    await mount();
    expect(summary().querySelectorAll('.provider-avatar')).toHaveLength(2);
    expect(summary().querySelector('.provider-overflow')?.textContent).toBe('+2');
    expect(summary().querySelector('strong')?.textContent).toBe('OpenAI');
    expect(summary().getAttribute('title')).toContain('DeepSeek');
    expect(model()?.textContent).toBe('saved-model');
  });

  it('长自定义名称和模型保留完整文本和完整无障碍信息', async () => {
    const name = 'Private endpoint with a deliberately long descriptive name';
    const saved = 'organization/very-long-configured-model-name-with-variant-and-version';
    config.service = 'custom:private';config.customOpenAIProviders = [{id: 'custom:private', name, endpoint: 'https://example.test/v1', models: [saved]}];
    config.model['custom:private'] = saved;
    await mount();
    expect(summary().querySelector('strong')?.textContent).toBe(name);expect(model()?.textContent).toBe(saved);
    expect(model()?.getAttribute('title')).toBe(`配置模型：${saved}`);
    expect(summary().getAttribute('aria-label')).toContain(`${name} · 配置模型：${saved}`);
  });

  it('自定义服务名称属于保存内容，不被内置服务的旧 UI 词典转换', async () => {
    language.value = 'en-US';config.service = 'custom:private';
    config.customOpenAIProviders = [{id: 'custom:private', name: '文', endpoint: 'https://example.test/v1', models: ['saved-model']}];
    await mount();
    // 真资源中“文”用于另一个 UI 缩写；名称不能借用它的英文 D。
    expect(translateLegacyText('文', 'en-US')).not.toBe('文');
    expect(summary().querySelector('strong')?.textContent).toBe('文');
    expect(summary().getAttribute('aria-label')).toContain(' · 文 · ');
  });

  it('真实英文 document observer 本地化 UI，同时保留摘要中用户的名称和模型', async () => {
    language.value = 'en-US';config.uiLanguage = 'en-US';config.service = 'custom:private';
    config.customOpenAIProviders = [{id: 'custom:private', name: '文', endpoint: 'https://example.test/v1', models: ['文']}];
    config.model['custom:private'] = '文';
    const before = JSON.stringify(config);
    // 使用实际 i18n 插件和资源，只替换它的配置/浏览器/语言资源加载端口。
    vi.doMock('@/src/services/config/store', () => ({config, configReady: Promise.resolve(), getConfigRevision: () => 0,
      subscribeConfig: (listener: (value: Config) => void) => {listeners.add(listener);return () => listeners.delete(listener);},
      requestConfigPatch: patches}));
    vi.doMock('webextension-polyfill', () => ({default: {runtime: {sendMessage: vi.fn()}}}));
    vi.doMock('@/src/platform/i18n/uiLanguageBundles', () => ({ensureUiLanguageBundle: async () => true}));
    try {
      const {createUiI18nPlugin} = await import('@/src/ui/i18n');
      await mount(createUiI18nPlugin({documentRoot: document.body}));
      // 固定旧中文按钮确实被 observer 转换，不能靠 scanner 没执行掩盖正文污染。
      await vi.waitFor(() => expect(document.querySelector('.settings-button > span')?.textContent).toBe('Settings'));
      expect(model()?.textContent).toBe('文');
      expect(summary().querySelector('strong')?.textContent).toBe('文');
      expect(model()?.getAttribute('title')).toBe('Configured model: 文');
      expect(summary().getAttribute('aria-label')).toContain(' · 文 · Configured model: 文');
      expect(JSON.stringify(config)).toBe(before);expect(patches).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('@/src/services/config/store');vi.doUnmock('webextension-polyfill');vi.doUnmock('@/src/platform/i18n/uiLanguageBundles');
    }
  });

  it('凭据提醒仍保留提醒内容和当前服务设置入口', async () => {
    config.token.openai = '';config.apiKeys.openai = [];
    await mount();
    const warning = document.querySelector('.credential-warning[role="alert"]');expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain('配置提醒');
    warning!.querySelector('button')!.dispatchEvent(new window.Event('click'));await settle();
    expect(createTab).toHaveBeenCalledWith({url: 'extension://options.html#settings-services'});
  });

  it('摘要沿用同一个服务抽屉入口，浏览不会改配置', async () => {
    await mount();const before = JSON.stringify(config);
    summary().dispatchEvent(new window.Event('click'));await settle();
    expect(summary().getAttribute('aria-expanded')).toBe('true');
    for (let attempt = 0; attempt < 50 && !document.querySelector('.service-panel-close'); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2));await settle();
    }
    const close = document.querySelector('.service-panel-close');expect(close).not.toBeNull();
    close!.dispatchEvent(new window.Event('click'));await settle();
    expect(summary().getAttribute('aria-expanded')).toBe('false');
    expect(JSON.stringify(config)).toBe(before);expect(patches).not.toHaveBeenCalled();
  });

  it('模块排序与隐藏保留原有站点规则相邻嵌套边界', async () => {
    config.popupModuleOrder = ['quickFeatures', 'footer', 'translation', 'siteRule'];
    config.interfaceVisibility.popupQuickFeatures = false;config.interfaceVisibility.popupFooter = false;
    await mount();
    const order = () => [...document.querySelectorAll('[data-popup-module]')].map(node => node.getAttribute('data-popup-module'));
    expect(order()).toEqual(['translation', 'siteRule']);
    expect(document.querySelector('[data-popup-module="siteRule"]')?.closest('.hero-card')).not.toBeNull();
    publish(next => {next.popupModuleOrder = ['siteRule', 'translation', 'quickFeatures', 'footer'];next.interfaceVisibility.popupQuickFeatures = true;next.interfaceVisibility.popupFooter = true;});
    await settle();expect(order()).toEqual(['siteRule', 'translation', 'quickFeatures', 'footer']);
    expect(document.querySelector('[data-popup-module="siteRule"]')?.closest('.hero-card')).toBeNull();
    expect(document.querySelectorAll('[data-testid="page-translation"]')).toHaveLength(1);
  });
});

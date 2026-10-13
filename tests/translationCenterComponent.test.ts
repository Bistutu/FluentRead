import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {compileScript, compileStyle, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import * as vue from 'vue';
import {Config, normalizeConfig} from '@/src/core/config/model';
import * as catalog from '@/src/core/config/catalog';
import * as profiles from '@/src/core/config/customOpenAI';
import * as composites from '@/src/core/config/compositeTranslation';
import * as validation from '@/src/core/config/validation';
import * as comparison from '@/src/features/translation-center/model/comparison';
import {translate} from '@/src/core/i18n';
import {TranslationRequestError, serializeTranslationError} from '@/src/services/translation/errors';

const filename = 'src/features/translation-center/ui/TranslationCenter.vue';
const source = readFileSync(filename, 'utf8');
const {descriptor} = parse(source, {filename});
const compiled = ts.transpileModule(compileScript(descriptor, {id: 'translation-center-test'}).content, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
}).outputText;
const require = createRequire(import.meta.url);
let state: Record<string, any>, scope: vue.EffectScope, config: Config;
let requestPatch: ReturnType<typeof vi.fn>, translateText: ReturnType<typeof vi.fn>, copy: ReturnType<typeof vi.fn>;
let mounted: (() => Promise<void>)[], unmounted: (() => void)[], subscription: (next: Config) => void;
let emit: ReturnType<typeof vi.fn>;
const deferred = () => {let resolve!: (text: string) => void; const promise = new Promise<string>(done => {resolve = done;}); return {promise, resolve};};
beforeEach(async () => {
  config = new Config(); mounted = []; unmounted = []; emit = vi.fn();
  requestPatch = vi.fn().mockResolvedValue(undefined); translateText = vi.fn().mockResolvedValue('translated'); copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', {platform: 'MacIntel', clipboard: {writeText: copy}});
  vi.stubGlobal('document', {body: {style: {userSelect: 'text'}}, addEventListener: vi.fn(), removeEventListener: vi.fn(), elementFromPoint: vi.fn()});
  const api = {...catalog, ...profiles, ...composites, ...validation, ...comparison, config, configReady: Promise.resolve(),
    subscribeConfig: (fn: typeof subscription) => {subscription = fn; return vi.fn();}, requestConfigPatch: requestPatch, translateText, TranslationRequestError,
    filterAvailableTranslationServices: (items: any[]) => items.filter(item => item.value !== 'chromeTranslator'),
    isTranslationServiceAvailable: (service: string) => service !== 'chromeTranslator',
    useUiI18n: () => ({language: vue.ref('zh-CN'), translateLegacy: (value: string) => value, t: (key: string, params: any) => translate(key, 'zh-CN', params)}),
  };
  const exports: Record<string, any> = {};
  new Function('require', 'exports', compiled)((id: string) => {
    if (id === 'vue') return {...vue, onMounted: (fn: () => Promise<void>) => mounted.push(fn), onUnmounted: (fn: () => void) => unmounted.push(fn)};
    if (id === 'webextension-polyfill') return {runtime: {sendMessage: vi.fn()}};
    if (id === 'element-plus' || id.endsWith('.vue')) return {};
    if (id.startsWith('@/src/') || id === '../model/comparison') return api;
    return require(id);
  }, exports);
  scope = vue.effectScope(); state = scope.run(() => vue.proxyRefs(exports.default.setup({}, {expose: () => {}, emit})))!;
  await Promise.all(mounted.map(fn => fn())); await vue.nextTick();
});
afterEach(() => {unmounted.forEach(fn => fn()); scope.stop(); vi.unstubAllGlobals(); vi.useRealTimers();});

describe('translation center product workflow', () => {
  it('keeps a combination label and marks completed results stale after member configuration changes', async () => {
    const service = 'composite:center';
    config.compositeTranslationProviders = [{id: service, name: 'Everyday', strategy: 'sequential', services: ['google', 'microsoft'], timeoutMs: 12000}];
    config.translationCenterServices = [service]; subscription(config);
    expect(state.serviceCategory(service)).toBe('组合');
    expect(state.serviceLabel(service)).toBe('Everyday');
    state.sourceText = 'Original'; state.runTranslation(); await vue.nextTick();
    await vi.waitFor(() => expect(state.successfulCards).toHaveLength(1));
    expect(translateText.mock.calls[0][2].modelOverride).toBeUndefined();
    config.compositeTranslationProviders[0].strategy = 'smart'; subscription(config);
    expect(state.isStale(state.cards[0])).toBe(true);
    expect(state.successfulCards).toEqual([]);
    state.retryService(service); await vue.nextTick();
    await vi.waitFor(() => expect(state.successfulCards).toHaveLength(1));
    config.proxy.google = 'https://changed.example'; subscription(config);
    expect(state.isStale(state.cards[0])).toBe(true);
    state.copyAllResults(); expect(copy).not.toHaveBeenCalled();
  });
  it('starts with a small no-key selection and never changes the page default', () => {
    expect(state.cards.map((card: any) => card.service)).toEqual(['freeTranslation', 'google']);
    expect(requestPatch).not.toHaveBeenCalled(); expect(translateText).not.toHaveBeenCalled();
    expect(config.service).toBe('freeTranslation');
  });
  it('keeps stored service order and marks unconfigured items without running them', async () => {
    config.translationCenterServices = ['openai', 'google']; subscription(config);
    expect(state.cards.map((card: any) => card.service)).toEqual(['openai', 'google']);
    expect(state.cardStatus(state.cards[0])).toBe('needsConfig');
    state.sourceText = 'Original'; state.runTranslation(); await vue.nextTick();
    expect(translateText).toHaveBeenCalledOnce(); expect(translateText.mock.calls[0][2].serviceOverride).toBe('google');
  });
  it('does not treat missing custom endpoints or models as ready even without an API key requirement', () => {
    const service = 'custom:incomplete';
    config.customOpenAIProviders = [{id: service, name: 'Incomplete', endpoint: '', models: []}];
    config.translationCenterServices = [service]; subscription(config);
    expect(state.credentialWarning(service)).toContain('接口地址');
    config.customOpenAIProviders[0].endpoint = 'http://127.0.0.1/v1'; subscription(config);
    expect(state.credentialWarning(service)).toContain('模型'); expect(state.readyCards).toEqual([]);
  });
  it('preserves results and input when cards reorder or unrelated configuration syncs', async () => {
    state.sourceText = 'Original'; state.runTranslation(); await vue.nextTick();
    await vi.waitFor(() => expect(state.cards[0].result).toBe('translated'));
    state.moveCard('freeTranslation', 1);
    await vi.waitFor(() => expect(state.cards[1].result).toBe('translated'));
    expect(requestPatch.mock.calls[0][0]).toEqual({translationCenterServices: ['google', 'freeTranslation']});
    Object.assign(config, requestPatch.mock.calls[0][0]); subscription(config);
    config.animations = false; subscription(config);
    expect(state.sourceText).toBe('Original'); await vi.waitFor(() => expect(state.successfulCards).toHaveLength(2));
  });
  it('excludes stale results from aggregate copy and snapshots language across edits', async () => {
    const pending = deferred(); translateText.mockReturnValueOnce(pending.promise);
    state.sourceText = 'Original'; state.runTranslation(); state.sourceText = 'Changed'; state.targetLanguage = 'ja';
    pending.resolve('old translation'); await vue.nextTick(); await vue.nextTick();
    expect(state.staleCount).toBe(2); expect(state.successfulCards).toEqual([]);
    state.copyAllResults(); expect(copy).not.toHaveBeenCalled();
    expect(translateText.mock.calls[0][2].targetLanguage).toBe('zh-Hans');
    expect(state.cardStatus(state.cards[0])).toBe('stale');
  });
  it('only retries unfinished items and leaves completed results intact', async () => {
    translateText.mockRejectedValueOnce(new Error('failure'));
    state.sourceText = 'Original'; state.runTranslation(); await vue.nextTick(); await vue.nextTick();
    expect(state.incompleteCards).toHaveLength(1); const kept = state.cards[1].result;
    state.retryIncomplete(); await vue.nextTick(); await vue.nextTick();
    expect(translateText).toHaveBeenCalledTimes(3); expect(state.cards[1].result).toBe(kept);
  });
  it('blocks every launch path while globally paused and resumes only on user action', async () => {
    state.sourceText = 'Original'; config.on = false; subscription(config);
    state.runTranslation(); state.retryService('google'); state.retryIncomplete();
    state.handleEditorKeydown({key: 'Enter', ctrlKey: true, isComposing: false, preventDefault: vi.fn()});
    expect(state.canTranslate).toBe(false); expect(translateText).not.toHaveBeenCalled();
    config.on = true; subscription(config);
    expect(state.canTranslate).toBe(true); expect(translateText).not.toHaveBeenCalled();
    state.runTranslation(); await vue.nextTick();
    await vi.waitFor(() => expect(state.successfulCards).toHaveLength(2));
  });
  it('global pause aborts pending cards while retaining source and completed results', async () => {
    const pending = deferred(); translateText.mockReturnValueOnce(pending.promise);
    state.sourceText = 'Original'; state.runTranslation(); await vue.nextTick();
    await vi.waitFor(() => expect(state.cards[1].result).toBe('translated'));
    config.on = false; subscription(config);
    expect(translateText.mock.calls[0][2].signal.aborted).toBe(true);
    expect(state.cards[0].status).toBe('cancelled'); expect(state.cards[1].status).toBe('success');
    pending.resolve('late'); await vue.nextTick(); await vue.nextTick();
    expect(state.cards[0].result).toBe(''); await vi.waitFor(() => expect(state.cards[1].result).toBe('translated'));
    expect(state.sourceText).toBe('Original');
    config.on = true; subscription(config); expect(translateText).toHaveBeenCalledTimes(2);
  });
  it('treats a backend pause arriving before storage sync as cancellation for all pending cards', async () => {
    const pending = deferred();
    translateText.mockRejectedValueOnce(new TranslationRequestError(serializeTranslationError({message: 'paused', code: 'TRANSLATION_DISABLED', retryable: false}))).mockReturnValueOnce(pending.promise);
    state.sourceText = 'Original'; state.runTranslation(); await vue.nextTick(); await vue.nextTick();
    expect(state.translationEnabled).toBe(false); expect(state.isRunning).toBe(false);
    expect(state.cards.every((card: any) => card.status === 'cancelled' && !card.error)).toBe(true);
    expect(translateText.mock.calls[1][2].signal.aborted).toBe(true);
    pending.resolve('late'); await vue.nextTick(); expect(state.cards[1].result).toBe('');
  });
  it('stops work on clear and never accepts a late completion', async () => {
    const pending = deferred(); translateText.mockReturnValueOnce(pending.promise);
    state.sourceText = 'Original'; state.runTranslation(); state.clearSource();
    pending.resolve('late'); await vue.nextTick();
    expect(state.sourceText).toBe(''); expect(state.cards[0].status).toBe('cancelled'); expect(state.cards[0].result).toBe('');
  });
  it('guards empty text, oversized text, identical languages and IME composition', () => {
    state.runTranslation(); state.sourceText = 'x'.repeat(5001); state.runTranslation();
    state.sourceText = 'Original'; state.sourceLanguage = 'en'; state.targetLanguage = 'en'; state.runTranslation();
    state.targetLanguage = 'ja'; const preventDefault = vi.fn();
    state.handleEditorKeydown({key: 'Enter', ctrlKey: true, metaKey: false, isComposing: true, preventDefault});
    expect(translateText).not.toHaveBeenCalled(); expect(preventDefault).not.toHaveBeenCalled();
    state.handleEditorKeydown({key: 'Enter', ctrlKey: true, metaKey: false, isComposing: false, preventDefault});
    expect(translateText).toHaveBeenCalledTimes(2); expect(preventDefault).toHaveBeenCalledOnce();
  });
  it('saves layout independently, keeps unavailable providers and normalizes old configs', () => {
    config.translationCenterServices = ['chromeTranslator', 'google']; subscription(config);
    state.addService('freeTranslation');
    expect(requestPatch.mock.calls[0][0]).toEqual({translationCenterServices: ['chromeTranslator', 'google', 'freeTranslation']});
    state.setLayout('grid'); expect(requestPatch.mock.calls[1][0]).toEqual({translationCenterLayout: 'grid'});
    expect(normalizeConfig({translationCenterLayout: 'invalid'}).translationCenterLayout).toBe('list');
    expect(normalizeConfig({translationCenterLayout: 'grid'}).translationCenterLayout).toBe('grid');
    expect(new Config().translationCenterLayout).toBe('list');
  });
  it('does not translate on service selection, enforces a final service, and delegates configuration', () => {
    state.toggleService('openai'); expect(state.cards).toHaveLength(3); expect(translateText).not.toHaveBeenCalled();
    state.toggleService('openai'); state.removeService('google'); state.removeService('freeTranslation'); expect(state.cards).toHaveLength(1);
    state.configureService('openai'); expect(emit).toHaveBeenCalledWith('configure-service', 'openai');
    expect(requestPatch.mock.calls.every((call: any[]) => !Object.hasOwn(call[0], 'service'))).toBe(true);
  });
  it('retries failed saves with the latest field values and exposes clipboard failures', async () => {
    requestPatch.mockRejectedValueOnce(new Error('storage unavailable'));
    state.setLayout('grid'); await vue.nextTick(); await vue.nextTick(); expect(state.saveState).toBe('error');
    state.retrySave(); await vue.nextTick(); expect(requestPatch.mock.calls[1][0]).toEqual({translationCenterLayout: 'grid'}); expect(state.saveState).toBe('saved');
    copy.mockRejectedValueOnce(new Error('clipboard denied')); await state.copyText('text', 'a'); expect(state.feedback).toContain('复制失败');
  });
  it('restores preexisting text selection styles and treats pointer cancel as no reorder', () => {
    state.startPointerDrag('freeTranslation', {button: 0, pointerId: 2}); state.dragOverService = 'google';
    expect(document.body.style.userSelect).toBe('none'); state.finishPointerDrag({pointerId: 2, type: 'pointercancel'});
    expect(document.body.style.userSelect).toBe('text'); expect(state.cards[0].service).toBe('freeTranslation');
  });
  it('receives model updates during dragging and reconciles deferred order after cancellation', () => {
    state.startPointerDrag('freeTranslation', {button: 0, pointerId: 2});
    config.translationCenterServices = ['google', 'openai']; config.model.openai = 'custom-model'; config.token.openai = 'fixture-only'; subscription(config);
    expect(state.cards[0].service).toBe('freeTranslation'); expect(state.serviceModel('openai')).toBe('custom-model');
    state.finishPointerDrag({pointerId: 2, type: 'pointercancel'});
    expect(state.cards.map((card: any) => card.service)).toEqual(['google', 'openai']);
  });
  it('preserves user intent across storage rollback and unrelated later save success', async () => {
    let rejectLayout!: (reason: Error) => void;
    requestPatch.mockImplementationOnce(() => new Promise((_resolve, reject) => {rejectLayout = reject;}));
    state.setLayout('grid');
    subscription(config); // 后台失败前回读旧快照，不得抹掉待保存的用户选择。
    expect(state.resultLayout).toBe('grid');
    state.targetLanguage = 'ja'; state.persistTranslationCenterConfig('target'); await vue.nextTick();
    rejectLayout(new Error('storage failed')); await vue.nextTick(); await vue.nextTick();
    expect(state.saveState).toBe('error'); expect(state.resultLayout).toBe('grid');
    state.retrySave(); await vue.nextTick();
    expect(requestPatch.mock.calls[2][0]).toEqual({translationCenterLayout: 'grid'});
  });
  it('a newer edit to the same field wins over a delayed failed save', async () => {
    let rejectOld!: (reason: Error) => void;
    requestPatch.mockImplementationOnce(() => new Promise((_resolve, reject) => {rejectOld = reject;}));
    state.targetLanguage = 'ja'; state.persistTranslationCenterConfig('target');
    state.targetLanguage = 'fr'; state.persistTranslationCenterConfig('target'); await vue.nextTick();
    rejectOld(new Error('old failed')); await vue.nextTick(); await vue.nextTick();
    expect(state.saveState).not.toBe('error'); expect(state.targetLanguage).toBe('fr');
  });
  it('protects user content from legacy localization and provides persistent layout controls', () => {
    expect(source).toContain('<p data-i18n-ignore>{{ card.result }}</p>');
    expect(source).toContain('v-model="sourceText" data-i18n-ignore');
    expect(source).toContain('!event.isComposing'); expect(source).toContain('prefers-reduced-motion');
    expect(source).toContain('aria-pressed="resultLayout');
    const css = compileStyle({source: descriptor.styles[0].content, filename, id: 'data-v-center-test', scoped: true}).code;
    expect(css).toContain(':root.dark .translation-center .translate-primary-button');
    expect(css).not.toMatch(/:root\.dark\s*\{/);
  });

  it('保留与原文相同的服务结果，单项及全部复制均可用', async () => {
    state.sourceText = 'Original'; translateText.mockResolvedValue('  Original  ');
    state.runTranslation(); await vi.waitFor(() => expect(state.cards.every((card: any) => card.status === 'success')).toBe(true));
    expect(state.successfulCards).toHaveLength(state.cards.length);
    expect(state.cards.every((card: any) => card.result === 'Original')).toBe(true);
    state.copyResult(state.cards[0]); expect(copy).toHaveBeenLastCalledWith('Original');
    state.copyAllResults(); expect(copy.mock.lastCall?.[0].match(/Original/g)).toHaveLength(state.cards.length);
    state.sourceText = 'A newer source';
    expect(state.successfulCards).toEqual([]);
  });
});

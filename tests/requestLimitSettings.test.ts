import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type ViteDevServer} from 'vite';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {ShadowRoot} from 'linkedom';
import {compileVueFixture} from './helpers/compiledVueFixture';
import {Config} from '@/src/core/config/model';
import {normalizeTranslationRequestLimits, withModelRequestLimit, withServiceRequestLimit} from '@/src/core/config/requestLimits';
import {resolveTranslationRequestModel} from '@/src/core/config/requestModel';
import {createTranslationRequestScheduler} from '@/src/services/translation/requestScheduler';

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
type Node = {tag: string; props: Record<string, any>; text?: string};
let server: ViteDevServer;
let app: import('vue').App;

beforeAll(async () => {
  vi.stubGlobal('ShadowRoot', ShadowRoot);
  server = await createServer({appType: 'custom', configFile: false, logLevel: 'silent', root: process.cwd(),
    resolve: {alias: {'@': resolve(process.cwd(), '.')}}, server: {hmr: false, middlewareMode: true},
    plugins: [{name: 'limits-test-i18n', enforce: 'pre', resolveId(id) {
      return /\/src\/ui\/i18n(?:\.ts)?$/u.test(id) ? '\0limits-test-i18n' : null;
    }, load(id) {return id === '\0limits-test-i18n' ? 'export const useUiI18n = () => ({translateLegacy: text => text, t: key => key});' : null;}}, vue()],
  });
});
afterEach(() => app?.unmount());
afterAll(async () => {await server?.close(); vi.unstubAllGlobals();});

async function mount(name: string, props: Record<string, unknown>) {
  const filename = resolve(`src/features/settings/ui/services/${name}.vue`);
  const {renderCode} = compileVueFixture(filename, {id: 'request-limit-ui-test'});
  const component = (await server.ssrLoadModule(`/src/features/settings/ui/services/${name}.vue`)).default;
  component.render = new Function('Vue', renderCode)(runtime);
  const nodes: Node[] = [];
  const renderer = runtime.createRenderer<Node, Node>({
    patchProp: (node, key, _previous, value) => {node.props[key] = value;},
    insert: () => undefined, remove: () => undefined,
    createElement: tag => {const node = {tag, props: {}}; nodes.push(node); return node;},
    createText: () => ({tag: '#text', props: {}}), createComment: () => ({tag: '#comment', props: {}}),
    setText: () => undefined, setElementText: (node, text) => {node.text = text;}, parentNode: () => null, nextSibling: () => null,
    querySelector: () => null, setScopeId: () => undefined, cloneNode: node => ({...node}),
    insertStaticContent: () => [{tag: '#static', props: {}}, {tag: '#static', props: {}}],
  });
  app = renderer.createApp(component, props);
  app.provide(runtime.ssrContextKey, {modules: new Set<string>()});
  app.config.warnHandler = () => undefined;
  const vm = app.mount({tag: '#root', props: {}});
  return {state: (vm.$ as unknown as {setupState: Record<string, any>}).setupState, nodes,
    props: (vm.$ as unknown as {props: Record<string, any>}).props};
}

describe('request limit settings interaction', () => {
  it('labels and saves limits for the request-body model, preserves selector drafts, and serializes that model', async () => {
    const serviceSource = readFileSync(resolve('src/features/settings/ui/services/ServiceConfiguration.vue'), 'utf8');
    expect(serviceSource).toContain('const requestLimitModel = computed(() => resolveTranslationRequestModel(config.value, service.value))');
    expect(serviceSource).toContain(':model="compute.showModel ? requestLimitModel : undefined"');
    const config = runtime.reactive(new Config());
    config.model.ollama = 'gemma3:4b';
    config.customBody.ollama = '{"model":" qwen3:8b "}';
    config.translationRequestsPerSecond = 0; config.translationRequestsPerMinute = 0;
    const limits = normalizeTranslationRequestLimits(config);
    config.modelRequestLimits = withModelRequestLimit({}, 'ollama', 'gemma3:4b', {enabled: true, limits: {...limits, maxConcurrentTranslations: 4}});
    config.modelRequestLimits = withModelRequestLimit(config.modelRequestLimits, 'ollama', 'qwen3:8b', {enabled: false, limits: {...limits, maxConcurrentTranslations: 2}});
    const {state, nodes, props} = await mount('RequestLimitSettings', {config, service: 'ollama', model: resolveTranslationRequestModel(config, 'ollama')});
    expect(nodes.find(node => node.props['data-testid'] === 'request-limit-settings')?.props['data-model']).toBe('qwen3:8b');
    state.setFollowing(false);
    expect(state.preference.limits.maxConcurrentTranslations).toBe(2);
    state.setLimits({...state.preference.limits, maxConcurrentTranslations: 1});
    expect(config.modelRequestLimits.ollama['gemma3:4b'].limits.maxConcurrentTranslations).toBe(4);
    expect(config.modelRequestLimits.ollama['qwen3:8b'].limits.maxConcurrentTranslations).toBe(1);

    const scheduler = createTranslationRequestScheduler(() => config);
    const started: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>(done => {release = done;});
    const jobs = [0, 1].map(index => scheduler.schedule(async () => {started.push(index); await gate;}, {
      identity: {service: 'ollama', model: resolveTranslationRequestModel(config, 'ollama')},
    }));
    try {expect(started).toEqual([0]);} finally {release(); await Promise.all(jobs);}
    expect(started).toEqual([0, 1]);

    config.customBody.ollama = '';
    props.model = resolveTranslationRequestModel(config, 'ollama');
    await runtime.nextTick();
    expect(state.preference.limits.maxConcurrentTranslations).toBe(4);
    config.customBody.ollama = '{"model":"qwen3:8b"}';
    props.model = resolveTranslationRequestModel(config, 'ollama');
    await runtime.nextTick();
    expect(state.preference.limits.maxConcurrentTranslations).toBe(1);
  });

  it('inherits existing global values and retains disabled model settings across toggles', async () => {
    const config = runtime.reactive(new Config());
    config.translationRequestsPerMinute = 87;
    const {state} = await mount('RequestLimitSettings', {config, service: 'deepseek', model: 'model-a'});
    expect(state.preference).toBeUndefined();
    state.setFollowing(false);
    expect(config.modelRequestLimits.deepseek['model-a'].limits.translationRequestsPerMinute).toBe(87);
    state.setLimits({...state.preference.limits, translationRequestsPerMinute: 12});
    state.setFollowing(true);
    config.translationRequestsPerMinute = 99;
    expect(state.inherited.translationRequestsPerMinute).toBe(99);
    state.setFollowing(false);
    expect(state.preference.limits.translationRequestsPerMinute).toBe(12);
    expect(config.translationRequestsPerMinute).toBe(99);
  });

  it('isolates model edits, resets scope on model change, and inherits an enabled service limit', async () => {
    const config = runtime.reactive(new Config());
    config.serviceRequestLimits = withServiceRequestLimit({}, 'deepseek', {enabled: true,
      limits: {...normalizeTranslationRequestLimits(config), translationRequestsPerSecond: 2}});
    const {state, props} = await mount('RequestLimitSettings', {config, service: 'deepseek', model: 'model-a'});
    expect(state.followLabel).toBe('settings.requestLimits.followService');
    state.setFollowing(false);
    expect(state.preference.limits.translationRequestsPerSecond).toBe(2);
    state.setLimits({...state.preference.limits, translationRequestsPerSecond: 1});
    state.scope = 'service';
    props.model = 'model-b';
    await runtime.nextTick();
    expect(state.scope).toBe('model');
    expect(state.preference).toBeUndefined();
    expect(state.inherited.translationRequestsPerSecond).toBe(2);
    expect(config.modelRequestLimits.deepseek['model-a'].limits.translationRequestsPerSecond).toBe(1);
    expect(config.serviceRequestLimits.deepseek.limits.translationRequestsPerSecond).toBe(2);
  });

  it('edits machine-service limits without creating an empty model entry', async () => {
    const config = runtime.reactive(new Config());
    const {state} = await mount('RequestLimitSettings', {config, service: 'microsoft'});
    expect(state.scope).toBe('service');
    state.setFollowing(false);
    state.setLimits({...state.preference.limits, maxConcurrentTranslations: 2});
    state.setFollowing(true);
    expect(config.serviceRequestLimits.microsoft.enabled).toBe(false);
    expect(config.serviceRequestLimits.microsoft.limits.maxConcurrentTranslations).toBe(2);
    expect(Object.keys(config.modelRequestLimits)).toEqual([]);
  });

  it('ignores transient empty, noninteger and out-of-range inputs while accepting explicit unlimited rates', async () => {
    const values = normalizeTranslationRequestLimits(new Config());
    const changes: typeof values[] = [];
    const {state} = await mount('RequestLimitFields', {modelValue: values, 'onUpdate:modelValue': (value: typeof values) => changes.push(value)});
    state.update('maxConcurrentTranslations', undefined);
    state.update('maxConcurrentTranslations', 0);
    state.update('maxConcurrentTranslations', 1.5);
    state.update('translationRequestsPerMinute', 10001);
    state.update('translationRequestsPerSecond', NaN);
    expect(changes).toHaveLength(0);
    state.update('translationRequestsPerMinute', 0);
    expect(changes).toEqual([{...values, translationRequestsPerMinute: 0}]);
    expect(values.translationRequestsPerMinute).toBe(250);
  });
  it('ignores late change events from disabled or hidden fields and unknown field names', async () => {
    const values = normalizeTranslationRequestLimits(new Config()), changes: typeof values[] = [];
    const {state, props} = await mount('RequestLimitFields', {modelValue: values, disabled: true, 'onUpdate:modelValue': (value: typeof values) => changes.push(value)});
    state.update('translationRequestsPerMinute', 12);expect(changes).toEqual([]);
    props.disabled = false;props.active = false;state.update('translationRequestsPerMinute', 12);expect(changes).toEqual([]);
    props.active = true;state.update('missing', 12);expect(changes).toEqual([]);
    state.update('translationRequestsPerMinute', 12);expect(changes).toEqual([{...values, translationRequestsPerMinute: 12}]);
  });
});

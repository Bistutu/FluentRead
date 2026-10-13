import {afterEach, describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const {runtimeConfig} = vi.hoisted(() => ({runtimeConfig: {} as Record<string, any>}));
vi.mock('@/src/services/config/store', () => ({config: runtimeConfig}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {id: 'configmodelAudit', getURL: (path: string) => path}}}));

import * as model from '@/src/core/config/model';
import * as catalog from '@/src/core/config/catalog';
import * as constants from '@/src/core/config/constants';
import * as azure from '@/src/core/config/azure';
import * as deepl from '@/src/core/config/deepl';
import * as deeplx from '@/src/core/config/deeplx';
import * as free from '@/src/core/config/freeTranslation';
import * as thinking from '@/src/core/config/modelThinking';
import * as seed from '@/src/core/config/doubaoSeedTranslation';
import {currentConfiguredModel} from '@/src/services/translation/templates';
import doubaoSeedTranslation from '@/src/providers/translation/doubao-seed-translation';
import {getServiceApiKeyRows} from '@/src/core/config/apiKeys';
import {parseStoredConfig, serializeConfig} from '@/src/services/config/schema';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// 子进程仅提供实际 TS 模块加载器与输入/结果检查，不复制归一化或克隆逻辑。
const configmodelAuditChild = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = process.env.CONFIGMODEL_AUDIT_ROOT;
const nativeRequire = Module.createRequire(path.join(root, 'package.json'));
const esbuild = Module.createRequire(nativeRequire.resolve('vite/package.json'))('esbuild');
const baseline = '/private/tmp/fluentread-audit-20261005/baseline-forty-seventh';
const scoped = new Set(['model','catalog','constants','azure','deepl','deeplx','freeTranslation','modelThinking','doubaoSeedTranslation'].map(name => 'src/core/config/' + name + '.ts'));
const loaded = new Set();
(async () => {
async function loadActualModules() {
    const result = await esbuild.build({absWorkingDir: root, stdin: {contents: "export * as model from '@/src/core/config/model'; export {parseCustomBody} from '@/src/core/config/customBody'; export {parseStoredConfig, serializeConfig} from '@/src/services/config/schema';", resolveDir: root, sourcefile: 'configmodelAudit-child-entry.ts', loader: 'ts'},
        bundle: true, platform: 'node', format: 'cjs', write: false, target: 'esnext',
        tsconfigRaw: {compilerOptions: {useDefineForClassFields: true, target: 'ESNext'}},
        plugins: [{name: 'configmodelAudit-actual-source', setup(build) {
            build.onResolve({filter: /^(?:@\/|\.)/}, args => {
                if (!args.path.startsWith('@/') && !args.importer.startsWith(root + '/src/') && !args.importer.startsWith(baseline + '/')) return;
                const relative = args.path.startsWith('@/') ? args.path.slice(2)
                    : path.relative(args.importer.startsWith(baseline) ? baseline : root, path.resolve(path.dirname(args.importer), args.path));
                let current = path.join(root, relative);
                if (!path.extname(current)) current += fs.existsSync(current + '.ts') ? '.ts' : '/index.ts';
                return {path: process.env.CONFIGMODEL_AUDIT_OLD === '1' && scoped.has(path.relative(root, current))
                    ? path.join(baseline, path.relative(root, current)) : current};
            });
            build.onLoad({filter: /\.ts$/}, args => {loaded.add(args.path); return {contents: fs.readFileSync(args.path, 'utf8'), loader: 'ts'};});
        }}],
    });
    const item = new Module(path.join(root, 'configmodelAudit-child.cjs'));
    item.filename = path.join(root, 'configmodelAudit-child.cjs');
    item.require = nativeRequire;
    item._compile(result.outputFiles[0].text, item.filename);
    return item.exports;
}
let stage = 'setup';
try {
    const {model, parseCustomBody, parseStoredConfig, serializeConfig} = await loadActualModules();
    stage = 'normalization';
    const scenario = process.env.CONFIGMODEL_AUDIT_SCENARIO;
    const depth = 20000;
    const raw = '{"next":'.repeat(depth) + '{"leaf":"preserved"}' + '}'.repeat(depth);
    let input;
    if (scenario === 'deep-array') input = {futureGraph: JSON.parse('['.repeat(depth) + '"preserved"' + ']'.repeat(depth))};
    else if (scenario === 'deep-import') input = parseStoredConfig('{"on":true,"service":"openai","from":"auto","to":"en","customBody":{"openai":' + JSON.stringify(raw) + '},"extraImport":' + raw + '}');
    else input = {futureGraph: JSON.parse(raw)};
    const output = model.normalizeConfig(input);
    let original = scenario === 'deep-import' ? input.extraImport : input.futureGraph;
    let cloned = scenario === 'deep-import' ? output.extraImport : output.futureGraph;
    let distinct = true;
    for (let index = 0; index < depth; index++) {
        distinct = distinct && original !== cloned;
        original = scenario === 'deep-array' ? original[0] : original.next;
        cloned = scenario === 'deep-array' ? cloned[0] : cloned.next;
    }
    const leaf = scenario === 'deep-array' ? cloned : cloned.leaf;
    let consumerLeaf = leaf;
    if (scenario === 'deep-import') {
        const body = parseCustomBody(output.customBody.openai);
        let node = body;
        for (let index = 0; index < depth; index++) node = node.next;
        consumerLeaf = node.leaf;
    }
    let serialization;
    try { serializeConfig(output); serialization = {status: 'success'}; }
    catch (error) { serialization = {status: 'error', name: error.name, message: error.message}; }
    console.log(JSON.stringify({scenario, depth, leaf, consumerLeaf, distinct, serialization,
        sourceLeaf: scenario === 'deep-array' ? original : original.leaf,
        configPrototype: Object.getPrototypeOf(output) === model.Config.prototype,
        rawBodyPreserved: scenario !== 'deep-import' || output.customBody.openai === raw,
        loaded: [...loaded]}));
} catch (error) {
    console.log(JSON.stringify({stage, errorName: error.name, message: error.message, loaded: [...loaded]}));
    process.exitCode = stage === 'setup' ? 2 : 1;
} finally {
    esbuild.stop();
}
})();
`;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('configmodelAudit 配置、目录和真实消费者边界', () => {
    it.each(['deep-object', 'deep-array', 'deep-import'])('限时独立子进程保留合法深层 JSON：%s', scenario => {
        const result = spawnSync(process.execPath, ['-e', configmodelAuditChild], {
            env: {...process.env, CONFIGMODEL_AUDIT_ROOT: fileURLToPath(new URL('../', import.meta.url)), CONFIGMODEL_AUDIT_SCENARIO: scenario},
            timeout: 10_000, maxBuffer: 512_000, encoding: 'utf8',
        });
        const evidence = {scenario, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr};
        console.info('configmodelAudit-child', JSON.stringify(evidence));
        if (process.env.CONFIGMODEL_AUDIT_OUTPUT_DIR) writeFileSync(`${process.env.CONFIGMODEL_AUDIT_OUTPUT_DIR}/${process.env.CONFIGMODEL_AUDIT_OLD === '1' ? 'old' : 'new'}-child-${scenario}.json`, JSON.stringify(evidence, null, 2));
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({depth: 20000, leaf: 'preserved', consumerLeaf: 'preserved', sourceLeaf: 'preserved', distinct: true, configPrototype: true, rawBodyPreserved: true});
    });

    it.each(['__proto__', 'constructor', 'unknown-service'])('旧 token 的合法未知自有键 %s 保留凭据且不改变提供商政策', service => {
        for (const token of ['synthetic-key', '']) {
            const source = {token: Object.fromEntries([[service, token]])};
            const before = JSON.stringify(source);
            const normalized = model.normalizeConfig(source);
            expect(Object.hasOwn(normalized.apiKeys, service)).toBe(true);
            expect(normalized.apiKeys[service]).toEqual(token ? [token] : []);
            expect(getServiceApiKeyRows(normalized, service)).toEqual(normalized.apiKeys[service]);
            expect(Object.hasOwn(normalized.token, service)).toBe(Boolean(token));
            expect(Object.getPrototypeOf(normalized.apiKeys)).toBe(Object.prototype);
            expect(normalized.customOpenAIProviders).toEqual([]);
            expect(model.normalizeConfig(normalized).apiKeys).toEqual(normalized.apiKeys);
            expect(JSON.stringify(source)).toBe(before);
        }
        const normalized = model.normalizeConfig({apiKeys: Object.fromEntries([[service, ['saved-key']]]), token: Object.fromEntries([[service, 'legacy-key']])});
        expect(normalized.apiKeys[service]).toEqual(['saved-key']);
        expect(normalized.token[service]).toBe('saved-key');
        const multiple = model.normalizeConfig({apiKeys: Object.fromEntries([[service, ['first-key', 'second-key']]]), token: {}});
        expect(getServiceApiKeyRows(multiple, service)).toEqual(['first-key', 'second-key']);
        expect(Object.hasOwn(multiple.apiKeyRotationEnabled, service)).toBe(true);
        expect(multiple.apiKeyRotationEnabled[service]).toBe(true);
        expect(model.normalizeConfig(multiple).apiKeys).toEqual(multiple.apiKeys);
        const explicitOff = model.normalizeConfig({...multiple, apiKeyRotationEnabled: Object.fromEntries([[service, false]])});
        expect(explicitOff.apiKeyRotationEnabled[service]).toBe(false);
        const imported = parseStoredConfig(serializeConfig(multiple));
        expect(getServiceApiKeyRows(model.normalizeConfig(imported), service)).toEqual(['first-key', 'second-key']);
    });

    it('迭代克隆保留未知字段的共享引用、稀疏数组、自有键和普通数据原型', () => {
        const shared = JSON.parse('{"__proto__":{"flag":true},"leaf":"original"}');
        const sparse = new Array(6);
        Object.setPrototypeOf(sparse, Object.assign(Object.create(Array.prototype), {1: shared}));
        sparse[2] = shared;
        Object.defineProperty(sparse, '4', {value: shared, enumerable: false});
        const inherited = Object.assign(Object.create({excluded: true}), {own: shared});
        const source = {futureGraph: {first: shared, second: shared, sparse, inherited, nil: null, bool: false, zero: 0, fn: Math.max, symbol: Symbol.for('configmodelAudit'), date: new Date(0)}};
        const normalized = model.normalizeConfig(source) as model.Config & typeof source;
        const cloned = normalized.futureGraph;
        expect(cloned.first).toBe(cloned.second);
        expect(cloned.first).not.toBe(shared);
        expect(cloned.sparse).toHaveLength(6);
        expect(0 in cloned.sparse).toBe(false);
        expect(5 in cloned.sparse).toBe(false);
        expect(cloned.sparse[2]).toBe(cloned.first);
        expect(Object.hasOwn(cloned.sparse, '1')).toBe(true);
        expect(cloned.sparse[1]).toBe(cloned.first);
        expect(cloned.sparse[4]).toBe(cloned.first);
        expect(cloned.inherited.own).toBe(cloned.first);
        expect(Object.hasOwn(cloned.inherited, 'excluded')).toBe(false);
        expect(Object.getPrototypeOf(cloned.inherited)).toBe(Object.prototype);
        expect(Object.getPrototypeOf(cloned.sparse)).toBe(Array.prototype);
        expect(Object.hasOwn(cloned.first, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(cloned.first)).toBe(Object.prototype);
        expect(cloned).toMatchObject({nil: null, bool: false, zero: 0, fn: Math.max, symbol: Symbol.for('configmodelAudit'), date: {}});
        cloned.first.leaf = 'changed';
        expect(shared.leaf).toBe('original');
        expect(Object.getOwnPropertyDescriptor(sparse, '4')?.enumerable).toBe(false);
        expect(Object.hasOwn(sparse, '1')).toBe(false);
    });

    it('循环对象和数组克隆在有限节点上终止，序列化失败后仍可恢复合法配置', () => {
        const graph: Record<string, unknown> = {};
        const array: unknown[] = [graph];
        graph.self = graph;
        graph.array = array;
        array.push(array);
        const normalized = model.normalizeConfig({futureGraph: graph}) as model.Config & {futureGraph: typeof graph};
        expect(normalized.futureGraph).not.toBe(graph);
        expect(normalized.futureGraph.self).toBe(normalized.futureGraph);
        const clonedArray = normalized.futureGraph.array as unknown[];
        expect(clonedArray[0]).toBe(normalized.futureGraph);
        expect(clonedArray[1]).toBe(clonedArray);
        expect(() => serializeConfig(normalized)).toThrow(TypeError);
        expect(model.normalizeConfig({on: false}).on).toBe(false);
        expect(graph.self).toBe(graph);
        expect(array[1]).toBe(array);
    });

    it('共享数据节点只读取一次；非 JSON getter 抛错后可继续处理配置', () => {
        let valueReads = 0;
        const valueNode = Object.defineProperty({}, 'leaf', {enumerable: true, get: () => {valueReads++; return 'preserved';}});
        const repeatedInput = {futureGraph: {first: valueNode, second: valueNode, many: Array(64).fill(valueNode)}};
        const inputJSON = JSON.stringify(repeatedInput);
        valueReads = 0;
        const repeatedOutput = model.normalizeConfig(repeatedInput);
        const operations = {references: 66, valueReads, inputDigest: createHash('sha256').update(inputJSON).digest('hex'), outputDigest: digest(repeatedOutput)};
        console.info('configmodelAudit-clone-operations', JSON.stringify(operations));
        if (process.env.CONFIGMODEL_AUDIT_OUTPUT_DIR) writeFileSync(`${process.env.CONFIGMODEL_AUDIT_OUTPUT_DIR}/${process.env.CONFIGMODEL_AUDIT_OLD === '1' ? 'old' : 'new'}-clone-output.json`, JSON.stringify(repeatedOutput, null, 2));
        expect(valueReads).toBe(1);
        let reads = 0;
        const shared = Object.defineProperty(Object.create(null), '__proto__', {enumerable: true, get: () => {reads++; return 'own-data';}});
        const source = {futureGraph: {first: shared, second: shared, many: Array(64).fill(shared)}};
        const normalized = model.normalizeConfig(source) as model.Config & typeof source;
        expect(reads).toBe(1);
        expect(normalized.futureGraph.first).toBe(normalized.futureGraph.second);
        expect(normalized.futureGraph.many.every(node => node === normalized.futureGraph.first)).toBe(true);
        expect(Object.getPrototypeOf(normalized.futureGraph.first)).toBe(Object.prototype);
        expect(Object.getOwnPropertyDescriptor(normalized.futureGraph.first, '__proto__')?.value).toBe('own-data');
        const broken = Object.defineProperty({}, 'value', {enumerable: true, get: () => {throw new TypeError('synthetic getter failure');}});
        expect(() => model.normalizeConfig({futureGraph: broken})).toThrow('synthetic getter failure');
        expect(model.normalizeConfig({on: false}).on).toBe(false);
    });

    it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])('支持服务的私有部署名 %s 保持字符串和模型身份', name => {
        expect(model.migrateModelIdentifier('openai', name)).toBe(name);
        const normalized = model.normalizeConfig({service: 'openai', model: {openai: name}});
        expect(catalog.resolveConfiguredModel(normalized.model.openai, normalized.customModel.openai)).toBe(name);
        expect(currentConfiguredModel(normalized, 'openai')).toBe(name);
        expect(currentConfiguredModel(normalized, 'openai', name)).toBe(name);
        expect(normalized.customModels.openai).toContain(name);
    });

    it('只有登记的迁移生效；未知服务与正常部署名不改变', () => {
        expect(model.migrateModelIdentifier('openai', 'gpt5')).toBe(catalog.currentModelIds.openai);
        expect(model.migrateModelIdentifier('constructor', 'private-model')).toBe('private-model');
        expect(model.migrateModelIdentifier('unknown', 'private-model')).toBe('private-model');
        expect(model.migrateModelIdentifier('openai', 'private-model')).toBe('private-model');
    });

    it('配置读取与请求覆盖模型的真实调用链都保留 constructor 部署名', () => {
        const normalized = model.normalizeConfig({service: 'openai', model: {openai: 'constructor'}});
        expect(currentConfiguredModel(normalized, 'openai')).toBe('constructor');
        expect(currentConfiguredModel(normalized, 'openai', 'constructor')).toBe('constructor');
    });

    it('受支持 openai 服务的 __proto__ 私有模型保留显式 Thinking true 和 false', () => {
        for (const enabled of [true, false]) {
            const source = JSON.parse(`{"service":"openai","model":{"openai":"__proto__"},"modelThinking":{"openai":{"__proto__":${enabled}}}}`);
            const normalized = model.normalizeConfig(source);
            expect(thinking.hasModelThinkingPreference(normalized.modelThinking, 'openai', '__proto__')).toBe(true);
            expect(thinking.isModelThinkingEnabled(normalized.modelThinking, 'openai', '__proto__')).toBe(enabled);
            expect(Object.getPrototypeOf(normalized)).toBe(model.Config.prototype);
            expect(model.normalizeConfig(normalized)).toEqual(normalized);
        }
    });

    it('未知服务 Thinking 数据被清理而不触碰继承属性', () => {
        const key = 'configmodelAudit_marker';
        const before = Object.getOwnPropertyDescriptor(Object, key);
        try {
            const normalized = model.normalizeConfig({modelThinking: {constructor: {[key]: true}}});
            expect(normalized.modelThinking).toEqual({});
            expect(Object.getOwnPropertyDescriptor(Object, key)).toEqual(before);
        } finally {
            if (before) Object.defineProperty(Object, key, before);
            else delete (Object as unknown as Record<string, unknown>)[key];
        }
    });

    it('普通 JSON 导入的 __proto__ 数据键保留为自身数据，不改写 Config 原型', () => {
        const normalized = model.normalizeConfig(JSON.parse('{"__proto__":{"unknownFlag":true},"on":false}'));
        expect(Object.getPrototypeOf(normalized)).toBe(model.Config.prototype);
        expect(Object.hasOwn(normalized, '__proto__')).toBe(true);
        expect(Object.hasOwn(normalized, 'unknownFlag')).toBe(false);
        expect(normalized.on).toBe(false);
        expect(Object.hasOwn(model.normalizeConfig([]), 'length')).toBe(false);
    });

    it('配置样式快照只保留指向有效快照的当前选择', () => {
        const source = {bilingualSentenceHighlightProfiles: [{id: 'highlight', name: 'Highlight', style: 'rose'}],
            translationStyleProfiles: [{id: 'translation', name: 'Translation', style: 1}]};
        expect(model.normalizeConfig({...source, activeSentenceHighlightProfileId: 'highlight', activeTranslationStyleProfileId: 'translation'}))
            .toMatchObject({activeSentenceHighlightProfileId: 'highlight', activeTranslationStyleProfileId: 'translation'});
        expect(model.normalizeConfig({...source, activeSentenceHighlightProfileId: 'missing', activeTranslationStyleProfileId: 'missing'}))
            .toMatchObject({activeSentenceHighlightProfileId: '', activeTranslationStyleProfileId: ''});
    });

    it.each(['constructor', 'toString', '__proto__'])('地域目录拒绝继承服务名 %s', name => {
        expect(catalog.getDefaultCloudRegion(name)).toBe('');
        expect(catalog.resolveCloudRegion(name, 'eastus')).toBe('');
    });

    it.each(['constructor', 'toString', '__proto__'])('语言标签对继承语言名与 UI 语言名 %s 使用回退', name => {
        expect(catalog.getMultilingualTargetLanguageLabel(name, 'fallback', 'en-US')).toBe('fallback');
        expect(catalog.getMultilingualTargetLanguageLabel('en', 'fallback', name)).toBe(catalog.multilingualTargetLanguageLabels.en);
    });

    it('服务分类的公开 predicates 与所有预设、未知值和动态 ID 一致', () => {
        for (const service of [...Object.values(catalog.services), 'unknown', 'custom:audit']) {
            const custom = service === 'custom' || service === 'custom:audit';
            expect(catalog.servicesType.isMachine(service)).toBe(catalog.servicesType.machine.has(service));
            expect(catalog.servicesType.isCloudVendor(service)).toBe(catalog.servicesType.cloudVendor.has(service));
            expect(catalog.servicesType.isUseSecret(service)).toBe(catalog.servicesType.useSecret.has(service));
            expect(catalog.servicesType.isUseRegion(service)).toBe(catalog.servicesType.useRegion.has(service));
            expect(catalog.servicesType.isAI(service)).toBe(catalog.servicesType.AI.has(service) || custom);
            expect(catalog.servicesType.isAiSdk(service)).toBe(catalog.servicesType.aiSdk.has(service) || custom);
            expect(catalog.servicesType.isUseToken(service)).toBe(catalog.servicesType.useToken.has(service) || custom);
            expect(catalog.servicesType.isUseProxy(service)).toBe(catalog.servicesType.useProxy.has(service) || custom);
            expect(catalog.servicesType.isUseModel(service)).toBe(catalog.servicesType.useModel.has(service) || custom);
            expect(catalog.servicesType.isUseCustomUrl(service)).toBe(catalog.servicesType.useCustomUrl.has(service) || custom);
            expect(catalog.servicesType.isUseCustomBody(service)).toBe(catalog.servicesType.isAI(service));
            expect(catalog.servicesType.isCustom(service)).toBe(custom);
            expect(catalog.servicesType.isNewApi(service)).toBe(service === 'newapi');
            expect(catalog.servicesType.isUseAkSk(service)).toBe(false);
            expect(catalog.servicesType.isYoudao(service)).toBe(service === 'youdao');
            expect(catalog.servicesType.isTencent(service)).toBe(service === 'tencent' || service === 'huanYuanTranslation');
            expect(catalog.servicesType.isAzureOpenai(service)).toBe(service === 'azureOpenai');
        }
        expect(catalog.servicesType.isUseAIContext('openai')).toBe(true);
        expect(catalog.servicesType.isUseAIContext('microsoft')).toBe(false);
        expect(catalog.servicesType.isUseAIContext('huanYuanTranslation')).toBe(false);
        expect(catalog.servicesType.isUseAIContext('tongyi', 'qwen-mt-plus')).toBe(false);
        expect(catalog.servicesType.isUseAIContext('doubao', seed.DOUBAO_SEED_TRANSLATION_MODEL_ID)).toBe(false);
        expect(catalog.getCloudCredentialLabels('aliyunTranslation')).toEqual({token: 'AccessKey ID', secret: 'AccessKey Secret'});
        for (const [service, regions] of Object.entries(catalog.cloudRegionOptions)) {
            expect(regions.length).toBeGreaterThan(0);
            expect(catalog.getDefaultCloudRegion(service)).toBe(regions[0].value);
        }
    });

    it.each(['constructor', 'toString', '__proto__'])('目录的未知键 %s 使用公开回退契约', name => {
        expect(seed.resolveDoubaoSeedTranslationLanguage(name)).toBeUndefined();
        expect(catalog.resolveCloudRegion(name, 'eastus')).toBe('');
        expect(catalog.getDefaultCloudRegion(name)).toBe('');
        expect(catalog.getMultilingualTargetLanguageLabel(name, 'fallback', 'en-US')).toBe('fallback');
        expect(catalog.getMultilingualTargetLanguageLabel('en', 'fallback', name)).toBe(catalog.multilingualTargetLanguageLabels.en);
        expect(catalog.getCloudCredentialLabels(name)).toEqual({token: 'API Key'});
    });

    it('Doubao provider 在不支持的目标语言处拒绝，受控 HTTP port 不被调用', async () => {
        Object.assign(runtimeConfig, new model.Config(), {service: 'doubao', to: 'constructor', model: {doubao: seed.DOUBAO_SEED_TRANSLATION_MODEL_ID}});
        const fetchPort = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({output_text: 'wrong'})));
        vi.stubGlobal('fetch', fetchPort);
        await expect(doubaoSeedTranslation({origin: 'hello'} as any)).rejects.toThrow('不支持该目标语言');
        expect(fetchPort).not.toHaveBeenCalled();
    });

    it('Doubao provider 使用真实语言规则与请求构造，同输入保留原文并只发送合法语言码', async () => {
        const origin = 'Original paragraph';
        Object.assign(runtimeConfig, new model.Config(), {service: 'doubao', from: 'en', to: 'zh-TW', model: {doubao: seed.DOUBAO_SEED_TRANSLATION_MODEL_ID}});
        const fetchPort = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({output_text: '翻譯段落'}), {status: 200}));
        vi.stubGlobal('fetch', fetchPort);
        const message = {origin} as any;
        expect(await doubaoSeedTranslation(message)).toBe('翻譯段落');
        const body = JSON.parse(String(fetchPort.mock.calls[0][1]?.body));
        expect(body.input[0].content[0]).toMatchObject({text: origin, translation_options: {source_language: 'en', target_language: 'zh-Hant'}});
        expect(message.origin).toBe(origin);
        runtimeConfig.to = 'en';
        expect(await doubaoSeedTranslation(message)).toBe(origin);
        expect(fetchPort).toHaveBeenCalledTimes(1);
    });

    it('Thinking helpers 对继承的服务属性不生成偏好，正常服务修改保持不可变', () => {
        expect(thinking.hasModelThinkingPreference({}, 'constructor', 'name')).toBe(false);
        expect(thinking.withoutModelThinkingPreference({}, 'constructor', 'name')).toEqual({});
        const input = {openai: {'private/model:v1': false}};
        expect(thinking.isModelThinkingEnabled(undefined, 'openai', 'missing')).toBe(false);
        expect(thinking.normalizeModelThinkingMapping({empty: {' ': true}, bad: [], openai: {'m': true, bad: 2}})).toEqual({openai: {m: true}});
        const saved = thinking.withModelThinkingPreference(input, 'openai', 'new/model:v2', true);
        expect(saved.openai).toEqual({'private/model:v1': false, 'new/model:v2': true});
        expect(input).toEqual({openai: {'private/model:v1': false}});
        expect(thinking.withModelThinkingPreference(input, '', 'm', true)).toEqual(input);
        expect(thinking.withModelThinkingPreference(input, 'openai', ' ', true)).toEqual(input);
        expect(thinking.withoutModelThinkingPreference(saved, 'openai', 'new/model:v2')).toEqual(input);
        expect(thinking.withoutModelThinkingPreference(input, 'openai', 'private/model:v1')).toEqual({});
        expect(thinking.withoutModelThinkingPreference(input, 'openai')).toEqual({});
        expect(thinking.hasModelThinkingPreference({openai: undefined} as any, 'openai', 'm')).toBe(false);
    });

    it('导入非法功能枚举时回退默认，合法独立服务与关闭状态保持幂等', () => {
        const normalized = model.normalizeConfig({
            futureApiKey: 'synthetic', hoverTranslationService: 'google', selectionTranslationService: 'deepL', imageTranslationService: 'microsoft',
            areaTranslationMode: 'ai', areaTranslationService: 'openai', areaRecognitionMode: 'ocr', selectionAreaEnabled: false,
            videoLocalModel: 'unsupported', videoSourceLanguage: 'unsupported', videoSubtitleVisible: null, videoSubtitleDisplayMode: 'unsupported',
            videoService: 'deeplx', videoServiceDefaultMigrated: true, vocabularyReencounterEnabled: null,
            imageTranslationMangaEnabled: null, imageTranslationMangaPromptEnabled: null, imageTranslationOcrEngine: 'tesseract',
            hotkey: 'none', hoverShortcutBeforeDisable: 'Alt',
        });
        expect(normalized).not.toHaveProperty('futureApiKey');
        expect(normalized).toMatchObject({hoverTranslationService: 'google', selectionTranslationService: 'deepL', imageTranslationService: 'microsoft',
            areaTranslationMode: 'ai', areaTranslationService: 'openai', areaRecognitionMode: 'ocr', selectionAreaEnabled: false,
            videoLocalModel: 'small', videoSourceLanguage: 'auto', videoSubtitleVisible: true, videoSubtitleDisplayMode: 'bilingual', videoService: 'deeplx',
            vocabularyReencounterEnabled: false, imageTranslationMangaEnabled: true, imageTranslationMangaPromptEnabled: true,
            imageTranslationOcrEngine: 'tesseract', hoverShortcutBeforeDisable: 'Alt'});
        expect(model.normalizeConfig(normalized)).toEqual(normalized);
        expect(model.normalizeConfig({videoService: 'deeplx'}).videoService).toBe('');
    });

    it('旧 Key 列表创建旧自定义服务，轮询仅在缺失显式选择时迁移', () => {
        const legacy = model.normalizeConfig({apiKeys: {custom: [null, ' ', 'synthetic-key']}});
        expect(legacy.customOpenAIProviders.map(provider => provider.id)).toContain('custom');
        expect(legacy.apiKeys.custom).toEqual(['', 'synthetic-key']);
        expect(model.normalizeConfig({apiKeys: {custom: 'invalid'}}).customOpenAIProviders).toEqual([]);
        expect(model.normalizeConfig({apiKeys: []}).customOpenAIProviders).toEqual([]);
        expect(model.normalizeConfig({apiKeys: {custom: [null, ' ']}}).customOpenAIProviders).toEqual([]);
        const normalized = model.normalizeConfig({apiKeys: {openai: ['synthetic-a', 'synthetic-b'], gemini: ['synthetic-c', 'synthetic-d']},
            apiKeyRotationEnabled: {gemini: false}, token: {deepL: ''}});
        expect(normalized.apiKeyRotationEnabled).toMatchObject({openai: true, gemini: false});
        expect(normalized.apiKeys.deepL).toEqual([]);
    });

    it('数值型字幕、拖动位置与延迟边界不产生 NaN 或无效布局', () => {
        expect(model.normalizeVideoSubtitleFontSize('120')).toBe(120);
        expect(model.normalizeVideoSubtitleFontSize('invalid')).toBe(100);
        expect(model.normalizeVideoSubtitleOffsetMs('1250')).toBe(1500);
        expect(model.normalizeVideoSubtitleOffsetMs('invalid')).toBe(0);
        expect(model.normalizeVideoSubtitleOffsetMs(0)).toBe(0);
        expect(model.normalizeFloatingBallVerticalPosition(0.3)).toBe(0.3);
        expect(model.normalizeFloatingBallVerticalPosition(-2)).toBe(0);
        expect(model.normalizeFloatingBallVerticalPosition(2)).toBe(1);
        expect(model.normalizeFloatingBallVerticalPosition(NaN)).toBeNull();
        expect(model.normalizeConfig({hotkey: 'none'}).hoverShortcutBeforeDisable).toBe(catalog.defaultOption.hotkey);
        expect(model.normalizeConfig({hotkey: 'none', hoverShortcutBeforeDisable: 'invalid'}).hoverShortcutBeforeDisable).toBe(catalog.defaultOption.hotkey);
    });

    it('Azure 资源、v1、部署和网关路径保留查询并移除 fragment；非法地址一致拒绝', () => {
        for (const prefix of ['', '/openai/v1/', '/v1/']) {
            const endpoint = azure.normalizeAzureEndpoint(` https://resource.example${prefix}?api-version=2026-01-01#fragment `);
            expect(endpoint).toContain('/chat/completions?api-version=2026-01-01');
            expect(endpoint).not.toContain('#');
            expect(azure.isValidAzureEndpoint(endpoint)).toBe(true);
        }
        for (const prefix of ['/openai/deployments/my-deploy', '/gateway/v9']) {
            expect(azure.normalizeAzureEndpoint(`http://localhost${prefix}/chat/completions/`)).toBe(`http://localhost${prefix}/chat/completions`);
        }
        for (const endpoint of ['', 'invalid', 'ftp://resource.example', 'https://user:password@resource.example', 'https://resource.example/unsupported']) {
            expect(() => azure.normalizeAzureEndpoint(endpoint)).toThrow();
            expect(azure.isValidAzureEndpoint(endpoint)).toBe(false);
        }
    });

    it('DeepL 套餐、DeepLX 代理与 token 占位符保持地址优先级及错误边界', () => {
        expect(deepl.normalizeDeepLApiPlan('pro')).toBe('pro');
        expect(deepl.getDeepLEndpoint('pro')).toBe(deepl.DEEPL_API_ENDPOINTS.pro);
        expect(deepl.getDeepLEndpoint('invalid', {})).toBe(deepl.DEEPL_API_ENDPOINTS.free);
        expect(deepl.getDeepLEndpoint('free', ' https://proxy.test/translate ')).toBe('https://proxy.test/translate');
        expect(deeplx.parseDeepLXEndpoints(null)).toEqual([]);
        expect(deeplx.parseDeepLXEndpoints(' a,a, \nb ')).toEqual(['a', 'b']);
        expect(deeplx.requiresDeepLXToken('https://key.test/{{token}}', '')).toBe(true);
        expect(deeplx.requiresDeepLXToken('', 'https://plain.test')).toBe(false);
        expect(deeplx.requiresDeepLXToken('', '')).toBe(false);
        expect(deeplx.requiresDeepLXToken('https://key.test/{{token}},https://plain.test', '')).toBe(false);
        expect(deeplx.getDeepLXEndpoints('', '')).toEqual([deeplx.DEFAULT_DEEPLX_ENDPOINT]);
        expect(deeplx.getDeepLXEndpoints('https://configured.test', 'https://proxy.test/{{apiKey}}', 'a/b c')).toEqual(['https://proxy.test/a%2Fb%20c']);
        expect(deeplx.getDeepLXEndpoints('https://key.test/{{token}},https://plain.test', '')).toEqual(['https://plain.test']);
        expect(() => deeplx.getDeepLXEndpoints('https://configured.test', 'https://proxy.test/{{token}}')).toThrow('请填写 API Key');
        expect(deeplx.getDeepLXEndpoints('https://key.test/{{token}}', '', 'next')).toEqual(['https://key.test/next']);
    });

    it('免费服务和云服务端点保持默认产品策略、显式列表、数值边界及地域回退', () => {
        expect(new model.Config().freeTranslationOrder).not.toContain('deeplx');
        expect(free.normalizeFreeTranslationOrder(['alibabaFree', 'google', 'alibabaFree', 'deeplx', 'bad', 3])).toEqual(['alibabaFree', 'google']);
        expect(free.normalizeFreeTranslationOrder([])).toEqual(free.DEFAULT_FREE_TRANSLATION_ORDER);
        expect(free.normalizeFreeTranslationOrder(undefined)).toEqual(free.DEFAULT_FREE_TRANSLATION_ORDER);
        expect(free.isFreeTranslationProviderId('alibabaFree')).toBe(true);
        expect(free.isFreeTranslationProviderId('deeplx')).toBe(false);
        expect(free.isFreeTranslationProviderId('bad')).toBe(false);
        expect(free.isFreeTranslationProviderId(5)).toBe(false);
        expect(free.normalizeFreeTranslationMode('sequential')).toBe('sequential');
        expect(free.normalizeFreeTranslationMode('bad')).toBe('balanced');
        expect(free.normalizeFreeTranslationTimeoutMs(NaN)).toBe(5_000);
        expect(free.normalizeFreeTranslationTimeoutMs(0)).toBe(1_000);
        expect(free.normalizeFreeTranslationTimeoutMs(30_000)).toBe(15_000);
        expect(free.normalizeFreeTranslationCooldownMs(undefined)).toBe(60_000);
        expect(free.normalizeFreeTranslationCooldownMs(400_000)).toBe(300_000);
        expect(free.normalizeMyMemoryEmail(' a@example.test ')).toBe('a@example.test');
        for (const email of [undefined, 'invalid', `${'a'.repeat(250)}@example.test`]) expect(free.normalizeMyMemoryEmail(email)).toBe('');
        for (const plan of ['payg', 'token-plan', 'invalid']) for (const region of ['cn', 'ams', 'sgp', 'invalid']) {
            expect(constants.getMimoEndpoint(plan, region)).toBe(constants.MIMO_ENDPOINTS[plan === 'token-plan' ? plan : 'payg'][region === 'sgp' || region === 'ams' ? region : 'cn']);
        }
        expect(constants.getAliyunTranslationEndpoint('ap-southeast-1')).toBe('https://mt.ap-southeast-1.aliyuncs.com/');
        expect(constants.getAliyunTranslationEndpoint('bad')).toBe('https://mt.cn-hangzhou.aliyuncs.com/');
        expect(catalog.firstConfiguredModel([])).toBe('');
        expect(catalog.resolveConfiguredModel(catalog.customModelString)).toBe('');
        expect(catalog.resolveConfiguredModel()).toBe('');
        expect(seed.isDoubaoSeedTranslationModel()).toBe(false);
        expect(seed.resolveDoubaoSeedTranslationLanguage()).toBeUndefined();
        expect(seed.resolveDoubaoSeedTranslationLanguage('auto')).toBeUndefined();
    });

    it.each([1, 8, 64])('归一化 %i 个服务在模型上限保护选择，访问操作随服务数线性增长', providerCount => {
        const input = {
            customOpenAIProviders: Array.from({length: providerCount}, (_, index) => ({
                id: `custom:op-${index}`, name: `Profile ${index}`, endpoint: 'https://provider.example/v1/chat/completions',
                models: Array.from({length: 50}, (_, modelIndex) => `model-${modelIndex}`),
            })),
            model: Object.fromEntries(Array.from({length: providerCount}, (_, index) => [`custom:op-${index}`, 'selected-page'])),
            documentModel: Object.fromEntries(Array.from({length: providerCount}, (_, index) => [`custom:op-${index}`, 'selected-document'])),
            modelThinking: Object.fromEntries(Array.from({length: providerCount}, (_, index) => [`custom:op-${index}`, {'selected-page': true, 'selected-document': false}])),
        };
        const before = JSON.stringify(input);
        let mapVisits = 0;
        let findVisits = 0;
        const originalMap = Array.prototype.map;
        const originalFind = Array.prototype.find;
        const isProvider = (item: any) => typeof item?.id === 'string' && item.id.startsWith('custom:op-');
        vi.spyOn(Array.prototype, 'map').mockImplementation(function (this: any[], callback: any, thisArg?: any) {
            return originalMap.call(this, (item, index, array) => { if (isProvider(item)) mapVisits++; return callback.call(thisArg, item, index, array); });
        });
        vi.spyOn(Array.prototype, 'find').mockImplementation(function (this: any[], callback: any, thisArg?: any) {
            return originalFind.call(this, (item, index, array) => { if (isProvider(item)) findVisits++; return callback.call(thisArg, item, index, array); });
        });
        const normalized = model.normalizeConfig(input);
        vi.restoreAllMocks();
        if (process.env.CONFIGMODEL_AUDIT_OUTPUT_DIR) writeFileSync(`${process.env.CONFIGMODEL_AUDIT_OUTPUT_DIR}/${process.env.CONFIGMODEL_AUDIT_OLD === '1' ? 'old' : 'new'}-normalized-${providerCount}.json`, JSON.stringify(normalized, null, 2));
        console.info('configmodelAudit-operations', JSON.stringify({providerCount, modelsPerProvider: 50, mapVisits, findVisits, inputDigest: digest(input), outputDigest: digest(normalized)}));
        expect(JSON.stringify(input)).toBe(before);
        for (const profile of normalized.customOpenAIProviders) {
            expect(profile.models).toHaveLength(50);
            expect(profile.models.slice(-2)).toEqual(['selected-page', 'selected-document']);
            expect(profile.models.slice(0, 48)).toEqual(input.customOpenAIProviders[0].models.slice(0, 48));
            expect(normalized.modelThinking[profile.id]).toEqual({'selected-page': true, 'selected-document': false});
            expect(currentConfiguredModel(normalized, profile.id)).toBe('selected-page');
            expect(currentConfiguredModel(normalized, profile.id, normalized.documentModel[profile.id])).toBe('selected-document');
        }
        expect(model.normalizeConfig(normalized)).toEqual(normalized);
        expect(mapVisits).toBeLessThanOrEqual(6 * providerCount);
        expect(findVisits).toBeLessThanOrEqual(2 * providerCount);
    });
});

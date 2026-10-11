import {describe, expect, it} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {customModelString} from '@/src/core/config/catalog';
import {featureServiceDefinitions, getFeatureService, getFeatureModel, setFeatureService, isFeatureServiceSupported} from '@/src/core/config/featureServices';
import {BILIBILI_FREE_TRANSLATION_MODEL} from '@/src/core/config/freeTranslation';

const feature = (id: string) => featureServiceDefinitions.find(item => item.id === id)!;
describe('按功能分配翻译服务', () => {
    it('免费B站仅扩展阅读能力，写作仍拒绝机器服务并保留已配置自定义AI', () => {
        expect(isFeatureServiceSupported(feature('reading'), 'bilibili')).toBe(true);
        expect(isFeatureServiceSupported(feature('writing'), 'bilibili')).toBe(false);
        expect(isFeatureServiceSupported(feature('selection'), 'bilibili')).toBe(true);
        expect(isFeatureServiceSupported(feature('reading'), 'microsoft')).toBe(false);
        expect(isFeatureServiceSupported(feature('writing'), 'microsoft')).toBe(false);
        for (const id of ['reading', 'writing']) {
            expect(isFeatureServiceSupported(feature(id), 'openai')).toBe(true);
            expect(isFeatureServiceSupported(feature(id), 'custom:study')).toBe(false);
            expect(isFeatureServiceSupported(feature(id), 'custom:study', [{id: 'custom:study', name: 'Study', endpoint: 'https://custom.test/v1', models: ['reader']}])).toBe(true);
        }
    });
    it('阅读继承或独立选择B站都展示实际固定模型，不采用残留专项或默认模型', () => {
        const config = new Config(); config.service = 'bilibili';
        config.model.bilibili = 'unused-default'; config.customModel.bilibili = 'unused-custom'; config.harness.model = 'unused-reading';
        expect(getFeatureModel(config, feature('reading'))).toBe(BILIBILI_FREE_TRANSLATION_MODEL);
        config.harness.service = 'bilibili'; config.service = 'openai';
        expect(getFeatureModel(config, feature('reading'))).toBe(BILIBILI_FREE_TRANSLATION_MODEL);
        setFeatureService(config, feature('reading'), 'openai');
        expect(getFeatureModel(config, feature('reading'))).toBe(config.model.openai);
    });
    it('归一化允许显式免费阅读选择，同时拒绝旧配置中的未支持B站写作', () => {
        const config = normalizeConfig({harness: {service: 'bilibili', enabled: true} as Config['harness'], writing: {service: 'bilibili', enabled: true} as Config['writing']});
        expect(config.harness.service).toBe('bilibili');
        expect(config.writing.service).toBe('');
    });
    it('新配置及缺失字段统一继承，持久化后切换默认服务和模型仍联动', () => {
        for (const config of [new Config(), normalizeConfig({}), normalizeConfig(JSON.parse(JSON.stringify(new Config())))]) {
            for (const item of featureServiceDefinitions) {
                expect(item.inherit).toBe(true);
                expect(getFeatureService(config, item)).toBe('');
            }
            config.service = 'openai';
            config.model.openai = customModelString;
            config.customModel.openai = 'shared-model';
            for (const item of featureServiceDefinitions) expect(getFeatureModel(config, item)).toBe('shared-model');
            config.service = 'deepseek';
            for (const item of featureServiceDefinitions) expect(getFeatureModel(config, item)).toBe(config.model.deepseek);
        }
    });

    it('旧配置继承网页默认，保留已有字幕、输入框、文档和 AI 的独立选择', () => {
        const config = normalizeConfig({service: 'google', inputBoxTranslationService: 'microsoft', videoService: 'deeplx', videoServiceDefaultMigrated: true, documentService: 'openai', writing: {service: 'openai', model: 'saved-writing'} as Config['writing']});
        for (const id of ['hover', 'selection', 'image']) expect(getFeatureService(config, feature(id))).toBe('');
        expect(getFeatureService(config, feature('input'))).toBe('microsoft');
        expect(getFeatureService(config, feature('video'))).toBe('deeplx');
        expect(getFeatureService(config, feature('document'))).toBe('openai');
        expect(getFeatureService(config, feature('writing'))).toBe('openai');
        expect(config.writing.model).toBe('saved-writing');
    });
    it('各功能独立选择、跟随默认与归一化往返不改写其他服务', () => {
        const config = new Config(); config.service = 'google';
        for (const item of featureServiceDefinitions) {
            const next = item.aiOnly ? 'openai' : 'microsoft';
            setFeatureService(config, item, next);
            expect(getFeatureService(config, item)).toBe(next);
            expect(config.service).toBe('google');
        }
        const restored = normalizeConfig(JSON.parse(JSON.stringify(config)));
        for (const item of featureServiceDefinitions) expect(getFeatureService(restored, item)).toBe(getFeatureService(config, item));
        setFeatureService(restored, feature('selection'), ''); restored.service = 'openai';
        expect(getFeatureService(restored, feature('selection'))).toBe('');
        expect(getFeatureService(restored, feature('hover'))).toBe('microsoft');
    });
    it('只在切换输入框或 AI 服务时清空该功能的旧模型，重复选择保留模型', () => {
        const config = new Config();
        for (const [id, value] of [['input', 'input-model'], ['reading', 'reading-model'], ['writing', 'writing-model']]) {
            setFeatureService(config, feature(id), 'openai');
            if (id === 'input') config.inputBoxTranslationModel = value;
            else config[id === 'reading' ? 'harness' : 'writing'].model = value;
            setFeatureService(config, feature(id), 'openai');
            expect(getFeatureModel(config, feature(id))).toBe(value);
            setFeatureService(config, feature(id), 'deepseek');
            expect(getFeatureModel(config, feature(id))).toBe(config.model.deepseek);
        }
        expect(config.model.openai).toBe(new Config().model.openai);
    });
    it('独立文档模型与其他功能默认模型各自解析，保留自定义模型名称', () => {
        const config = new Config(); config.service = 'openai';
        config.model.openai = customModelString; config.customModel.openai = 'my-model';
        config.documentService = 'openai'; config.documentModel.openai = customModelString; config.documentCustomModel.openai = 'my-document-model';
        expect(getFeatureModel(config, feature('document'))).toBe('my-document-model');
        expect(getFeatureModel(config, feature('hover'))).toBe('my-model');
        expect(getFeatureModel(config, feature('reading'))).toBe('my-model');
        setFeatureService(config, feature('input'), 'openai');
        expect(getFeatureModel(config, feature('input'))).toBe('my-model');
    });
    it('无效、已删除服务安全回退，保留仍存在的自定义服务与旧 custom 迁移', () => {
        const invalid = normalizeConfig({hoverTranslationService: 'gone', selectionTranslationService: 42, imageTranslationService: 'custom:removed'} as unknown as Partial<Config>);
        expect([invalid.hoverTranslationService, invalid.selectionTranslationService, invalid.imageTranslationService]).toEqual(['', '', '']);
        const valid = normalizeConfig({customOpenAIProviders: [{id: 'custom:mine', name: 'Mine', endpoint: 'http://localhost:8000/v1', models: ['local-model']}], hoverTranslationService: 'custom:mine', selectionTranslationService: 'microsoft', imageTranslationService: 'google'});
        expect([valid.hoverTranslationService, valid.selectionTranslationService, valid.imageTranslationService]).toEqual(['custom:mine', 'microsoft', 'google']);
        const legacy = normalizeConfig({selectionTranslationService: 'custom'});
        expect(legacy.customOpenAIProviders.some(provider => provider.id === 'custom')).toBe(true);
        expect(legacy.selectionTranslationService).toBe('custom');
    });
});

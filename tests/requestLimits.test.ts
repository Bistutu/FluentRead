import {describe, expect, it} from 'vitest';

import {
    getModelRequestLimitPreference,
    getServiceRequestLimitPreference,
    normalizeModelRequestLimits,
    normalizeRequestLimitPreference,
    normalizeServiceRequestLimits,
    normalizeTranslationRequestLimits,
    withoutModelRequestLimit,
    withModelRequestLimit,
    withServiceRequestLimit,
} from '@/src/core/config/requestLimits';
import {normalizeConfig} from '@/src/core/config/model';
import {currentModelIds, customModelString, services} from '@/src/core/config/catalog';
import {resolveTranslationRequestModel} from '@/src/core/config/requestModel';
import {
    DEFAULT_MAX_CONCURRENT_TRANSLATIONS,
    DEFAULT_TRANSLATION_REQUESTS_PER_MINUTE,
    DEFAULT_TRANSLATION_REQUESTS_PER_SECOND,
} from '@/src/core/config/scheduling';

const DEFAULT_TRANSLATION_REQUEST_LIMITS = {
    maxConcurrentTranslations: DEFAULT_MAX_CONCURRENT_TRANSLATIONS,
    translationRequestsPerSecond: DEFAULT_TRANSLATION_REQUESTS_PER_SECOND,
    translationRequestsPerMinute: DEFAULT_TRANSLATION_REQUESTS_PER_MINUTE,
};

describe('请求限流配置领域模型', () => {
    it('保留合法已有值，并将 0 作为不限速', () => {
        expect(normalizeTranslationRequestLimits({
            maxConcurrentTranslations: 8,
            translationRequestsPerSecond: 0,
            translationRequestsPerMinute: 0,
        })).toEqual({
            maxConcurrentTranslations: 8,
            translationRequestsPerSecond: 0,
            translationRequestsPerMinute: 0,
        });
        expect(normalizeConfig({
            serviceRequestLimits: {
                [services.openai]: {enabled: true, limits: {maxConcurrentTranslations: 3, translationRequestsPerSecond: 0, translationRequestsPerMinute: 20}},
            },
            modelRequestLimits: {
                [services.openai]: {
                    'user-model': {enabled: false, limits: {maxConcurrentTranslations: 2, translationRequestsPerSecond: 1, translationRequestsPerMinute: 0}},
                },
            },
        })).toMatchObject({
            serviceRequestLimits: {
                [services.openai]: {enabled: true, limits: {maxConcurrentTranslations: 3, translationRequestsPerSecond: 0, translationRequestsPerMinute: 20}},
            },
            modelRequestLimits: {
                [services.openai]: {
                    'user-model': {enabled: false, limits: {maxConcurrentTranslations: 2, translationRequestsPerSecond: 1, translationRequestsPerMinute: 0}},
                },
            },
        });
    });

    it('非法输入回退默认值，且不接受原型污染键', () => {
        expect(normalizeServiceRequestLimits(null)).toEqual({});
        expect(normalizeModelRequestLimits(null)).toEqual({});
        expect(normalizeRequestLimitPreference(null)).toEqual({enabled: false, limits: DEFAULT_TRANSLATION_REQUEST_LIMITS});
        expect(normalizeTranslationRequestLimits({maxConcurrentTranslations: 0, translationRequestsPerSecond: '10', translationRequestsPerMinute: -1}))
            .toEqual({...DEFAULT_TRANSLATION_REQUEST_LIMITS, translationRequestsPerSecond: 10, translationRequestsPerMinute: 0});
        const servicesInput = JSON.parse('{"__proto__":{"enabled":true},"constructor":{"enabled":true},"openai":{"enabled":true,"limits":{"maxConcurrentTranslations":4}}}');
        const modelsInput = JSON.parse('{"__proto__":[],"openai":[],"constructor":{"custom-model":{}},"prototype":{"__proto__":{}},"valid":{"__proto__":{"enabled":true},"custom-model":{"enabled":true,"limits":{"translationRequestsPerMinute":0}}}}');
        const serviceLimits = normalizeServiceRequestLimits(servicesInput);
        const modelLimits = normalizeModelRequestLimits(modelsInput);
        expect(serviceLimits).toHaveProperty('openai');
        expect(serviceLimits).not.toHaveProperty('__proto__');
        expect(modelLimits).not.toHaveProperty('openai');
        expect(modelLimits.valid).toHaveProperty('custom-model');
        expect(modelLimits.valid).not.toHaveProperty('__proto__');
        expect(Object.getPrototypeOf(serviceLimits)).toBeNull();
    });

    it('继承开关保留草稿，查询隔离服务与模型', () => {
        const serviceRequestLimits = withServiceRequestLimit({}, services.openai, {
            enabled: true,
            limits: {maxConcurrentTranslations: 4, translationRequestsPerSecond: 4, translationRequestsPerMinute: 40},
        });
        const modelRequestLimits = withModelRequestLimit({}, services.openai, 'model-a', {
            enabled: false,
            limits: {maxConcurrentTranslations: 2, translationRequestsPerSecond: 1, translationRequestsPerMinute: 2},
        });
        expect(getServiceRequestLimitPreference(serviceRequestLimits, services.openai)).toEqual({enabled: true, limits: serviceRequestLimits[services.openai].limits});
        expect(getServiceRequestLimitPreference(serviceRequestLimits, '')).toBeUndefined();
        expect(getServiceRequestLimitPreference(serviceRequestLimits, 'missing-service')).toBeUndefined();
        expect(getModelRequestLimitPreference(modelRequestLimits, services.openai, 'model-a')).toEqual(modelRequestLimits[services.openai]['model-a']);
        expect(getModelRequestLimitPreference(modelRequestLimits, '', 'model-a')).toBeUndefined();
        expect(getModelRequestLimitPreference(modelRequestLimits, services.openai, 'missing-model')).toBeUndefined();
    });

    it('with/without helper 不修改输入，并支持删除模型草稿', () => {
        const source = {openai: {enabled: true, limits: {maxConcurrentTranslations: 4, translationRequestsPerSecond: 0, translationRequestsPerMinute: 0}}};
        const withService = withServiceRequestLimit(source, 'custom:service', {enabled: false, limits: {maxConcurrentTranslations: 7}});
        expect(source).not.toHaveProperty('custom:service');
        expect(withService['custom:service'].limits.maxConcurrentTranslations).toBe(7);
        expect(withServiceRequestLimit({}, '__proto__', {enabled: true})).toEqual({});

        const withModel = withModelRequestLimit({}, 'custom:service', 'any-valid-model', {enabled: true, limits: {maxConcurrentTranslations: 5}});
        const withSecondModel = withModelRequestLimit(withModel, 'custom:service', 'second-model', {enabled: true, limits: {maxConcurrentTranslations: 6}});
        const withoutModel = withoutModelRequestLimit(withSecondModel, 'custom:service', 'any-valid-model');
        expect(withModel['custom:service']?.['any-valid-model']).toBeDefined();
        expect(withoutModel['custom:service']?.['second-model']).toBeDefined();
        expect(withoutModelRequestLimit(withoutModel, 'custom:service')).toEqual({});
        expect(withoutModelRequestLimit(withModel, 'missing-service')).toEqual(withModel);
        expect(withoutModelRequestLimit(withModel, 'custom:service', 'any-valid-model')).toEqual({});
        expect(withModelRequestLimit({}, 'custom:service', '__proto__', {enabled: true})).toEqual({});
    });

    it('删除自定义服务时清理其限流字段但保留其他服务和任意合法模型名', () => {
        const config = normalizeConfig({
            customOpenAIProviders: [{id: 'custom:keep', name: 'Keep', endpoint: 'https://keep.test', models: ['keep-model']}],
            serviceRequestLimits: {
                'custom:removed': {enabled: true, limits: {maxConcurrentTranslations: 2}},
                'custom:keep': {enabled: true, limits: {maxConcurrentTranslations: 3}},
            },
            modelRequestLimits: {
                'custom:removed': {'user-authored-model': {enabled: true, limits: {maxConcurrentTranslations: 2}}},
                'custom:keep': {'another-user-model': {enabled: true, limits: {maxConcurrentTranslations: 3}}},
            },
        });
        expect(config.serviceRequestLimits).not.toHaveProperty('custom:removed');
        expect(config.modelRequestLimits).not.toHaveProperty('custom:removed');
        expect(config.serviceRequestLimits).toHaveProperty('custom:keep');
        expect(config.modelRequestLimits['custom:keep']).toHaveProperty('another-user-model');
    });
});

describe('请求限额与最终模型的共享身份', () => {
    it('静态请求体覆盖模型，非法字段沿用选择器，模板字符串保持请求体字面值', () => {
        const base = {model: {[services.ollama]: 'gemma3:4b'}, customModel: {}};
        expect(resolveTranslationRequestModel(base, services.ollama)).toBe('gemma3:4b');
        for (const body of ['{"model":" qwen3:8b "}', '{"model":"{{model}}"}']) {
            expect(resolveTranslationRequestModel({...base, customBody: {[services.ollama]: body}}, services.ollama))
                .toBe(JSON.parse(body).model.trim());
        }
        for (const body of ['', ' ', '{invalid', '{}', 'null', '[]', '{"model":0}', '{"model":" "}']) {
            expect(resolveTranslationRequestModel({...base, customBody: {[services.ollama]: body}}, services.ollama))
                .toBe('gemma3:4b');
        }
    });

    it('兼容自定义模型与模型覆盖，统一去掉 transport 忽略的空白和展示后缀', () => {
        const base = {model: {[services.ollama]: customModelString}, customModel: {[services.ollama]: ' private-alias '}};
        expect(resolveTranslationRequestModel(base, services.ollama)).toBe('private-alias');
        expect(resolveTranslationRequestModel(base, services.ollama, ' override（推荐） ')).toBe('override');
        expect(resolveTranslationRequestModel(base, services.ollama, ' ')).toBe('private-alias');
        expect(resolveTranslationRequestModel({model: {[services.ollama]: customModelString}, customModel: {}}, services.ollama)).toBe('');
        expect(resolveTranslationRequestModel({model: {}, customModel: {}}, services.ollama)).toBe('');
    });

    it('保留各协议的模型字段、Gemini URL 模型和 DeepSeek 旧编号迁移', () => {
        const empty = {model: {}, customModel: {}};
        const gemini = {...empty, model: {[services.gemini]: customModelString}, customModel: {[services.gemini]: 'private-gemini'},
            customBody: {[services.gemini]: '{"model":"ignored"}'}};
        expect(resolveTranslationRequestModel(gemini, services.gemini)).toBe('private-gemini');
        expect(resolveTranslationRequestModel(gemini, services.gemini, 'url-model')).toBe('url-model');
        expect(resolveTranslationRequestModel(empty, services.gemini)).toBe('');
        for (const model of ['deepseek-chat', 'deepseek-reasoner']) {
            expect(resolveTranslationRequestModel({model: {[services.deepseek]: model}, customModel: {}}, services.deepseek))
                .toBe(currentModelIds.deepseek);
        }
        const customDeepseek = {model: {[services.deepseek]: customModelString}, customModel: {[services.deepseek]: 'private-deepseek'}};
        expect(resolveTranslationRequestModel(customDeepseek, services.deepseek)).toBe('private-deepseek');
        expect(resolveTranslationRequestModel({...empty, model: {[services.huanYuanTranslation]: 'selected'},
            customBody: {[services.huanYuanTranslation]: '{"Model":" tencent-model ","model":"ignored"}'}}, services.huanYuanTranslation)).toBe('tencent-model');
        expect(resolveTranslationRequestModel({...empty, model: {[services.huanYuanTranslation]: 'selected'}}, services.huanYuanTranslation)).toBe('selected');
        expect(resolveTranslationRequestModel({...empty, model: {[services.microsoft]: 'selected'},
            customBody: {[services.microsoft]: '{"model":"ignored"}'}}, services.microsoft)).toBe('selected');
        expect(resolveTranslationRequestModel({...empty, model: {[services.claude]: 'claude-fable-5'}}, services.claude)).toBe('claude-fable-5');
    });
});

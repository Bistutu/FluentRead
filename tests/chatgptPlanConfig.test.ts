import {describe, expect, it} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {customModelString, services, options} from '@/src/core/config/catalog';
import {prepareConfigForExport, prepareConfigForImport} from '@/src/core/config/transfer';
import {createTranslationProviderConfigSnapshot} from '@/src/services/translation/requestSnapshot';
import {translateServiceLabel} from '@/src/core/i18n/serviceLabels';
import {isUserscriptServiceSupported, normalizeUserscriptConfig} from '@/userscript/initialize';
import {isChatGPTPlanDevelopmentEnabled, chatGPTPlanDevelopmentEnabled} from '@/src/platform/chatgpt-plan/buildMode';

describe('ChatGPT 套餐动态模型配置', () => {
    it('本机实验必须同时为开发构建和明确开关，公开构建不能被环境开关开放', () => {
        expect(chatGPTPlanDevelopmentEnabled).toBe(false);
        for (const env of [undefined, {}, {DEV: false, WXT_CHATGPT_PLAN_LOCAL_DEVELOPMENT: 'true'}, {DEV: true}, {DEV: true, WXT_CHATGPT_PLAN_LOCAL_DEVELOPMENT: true}, {DEV: true, WXT_CHATGPT_PLAN_LOCAL_DEVELOPMENT: 'false'}]) {
            expect(isChatGPTPlanDevelopmentEnabled(env)).toBe(false);
        }
        expect(isChatGPTPlanDevelopmentEnabled({DEV: true, WXT_CHATGPT_PLAN_LOCAL_DEVELOPMENT: 'true'})).toBe(true);
    });
    it('初始配置不猜套餐默认模型，未知账户slug在保存与再次规范化后仍是直接编号', () => {
        expect(new Config().model[services.chatgptPlan]).toBeUndefined();
        expect(new Config().documentModel[services.chatgptPlan]).toBeUndefined();
        const current = normalizeConfig({...new Config(), service: services.chatgptPlan,
            model: {[services.chatgptPlan]: ' account-model '}, documentModel: {[services.chatgptPlan]: 'account-document-model'},
            customModel: {[services.chatgptPlan]: 'unused-old'}, documentCustomModel: {[services.chatgptPlan]: 'unused-old-document'},
            customModels: {[services.chatgptPlan]: ['saved-stale']}});
        expect(current.model[services.chatgptPlan]).toBe('account-model');
        expect(current.documentModel[services.chatgptPlan]).toBe('account-document-model');
        expect(current.customModel[services.chatgptPlan]).toBeUndefined();
        expect(current.documentCustomModel[services.chatgptPlan]).toBeUndefined();
        expect(current.customModels[services.chatgptPlan]).toBeUndefined();
        expect(normalizeConfig(current)).toEqual(current);
        const snapshot = createTranslationProviderConfigSnapshot(current);
        expect(snapshot.model[services.chatgptPlan]).toBe('account-model');
        expect(snapshot.customModel[services.chatgptPlan]).toBeUndefined();
    });

    it('旧自定义哨兵保存过的实际编号精确迁移，缺失编号不伪造可用模型', () => {
        const migrated = normalizeConfig({model: {[services.chatgptPlan]: customModelString}, customModel: {[services.chatgptPlan]: ' old-page-slug '},
            documentModel: {[services.chatgptPlan]: customModelString}, documentCustomModel: {[services.chatgptPlan]: 'old-document-slug'}});
        expect(migrated.model[services.chatgptPlan]).toBe('old-page-slug');
        expect(migrated.documentModel[services.chatgptPlan]).toBe('old-document-slug');
        expect(migrated.customModel[services.chatgptPlan]).toBeUndefined();
        expect(migrated.documentCustomModel[services.chatgptPlan]).toBeUndefined();
        const missing = normalizeConfig({model: {[services.chatgptPlan]: customModelString}, customModel: {}, documentModel: {[services.chatgptPlan]: ' '}});
        expect(missing.model[services.chatgptPlan]).toBeUndefined();
        expect(missing.documentModel[services.chatgptPlan]).toBeUndefined();
    });

    it('选择账户模型后设为默认服务、导出与导入均保持直接slug和模型偏好', () => {
        const current = normalizeConfig({...new Config(), model: {[services.chatgptPlan]: 'fixture-account-model'},
            modelThinking: {[services.chatgptPlan]: {'fixture-account-model': false}}, modelVision: {[services.chatgptPlan]: {'fixture-account-model': true}}});
        const selected = normalizeConfig({...current, service: services.chatgptPlan});
        const exported = prepareConfigForExport(selected);
        const imported = prepareConfigForImport(exported, new Config());
        expect(imported.service).toBe(services.chatgptPlan);
        expect(imported.model[services.chatgptPlan]).toBe('fixture-account-model');
        expect(imported.customModel[services.chatgptPlan]).toBeUndefined();
        expect(imported.modelThinking[services.chatgptPlan]['fixture-account-model']).toBe(false);
        expect(imported.modelVision[services.chatgptPlan]['fixture-account-model']).toBe(true);
        expect(prepareConfigForExport(imported)).toEqual(exported);
    });

    it('套餐语义不改变API自定义模型规则，脚本版不能选择扩展专属套餐服务', () => {
        const normalized = normalizeConfig({model: {[services.openai]: 'private-api-model'}});
        expect(normalized.model[services.openai]).toBe(customModelString);
        expect(normalized.customModel[services.openai]).toBe('private-api-model');
        expect(isUserscriptServiceSupported(services.chatgptPlan)).toBe(false);
        const userscript = normalizeUserscriptConfig({service: services.chatgptPlan, videoService: services.chatgptPlan, inputBoxTranslationService: services.chatgptPlan});
        expect([userscript.service, userscript.videoService, userscript.inputBoxTranslationService]).toEqual([services.microsoft, services.microsoft, services.microsoft]);
    });

    it('服务名称和目录说明随六种非中文界面语言翻译，不改变品牌ChatGPT', () => {
        const service = options.services.find(item => item.value === services.chatgptPlan)!;
        for (const language of ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const) {
            const label = translateServiceLabel(service.label, language);
            expect(label).toContain('ChatGPT');
            expect(label).not.toBe(service.label);
            expect(translateServiceLabel(service.description!, language)).not.toBe(service.description);
        }
        expect(translateServiceLabel(service.label, 'en-US')).toBe('ChatGPT Plan');
        expect(translateServiceLabel(service.label, 'zh-CN')).toBe(service.label);
        expect(translateServiceLabel('  ChatGPT 套餐\n', 'en-US')).toBe('  ChatGPT Plan\n');
        expect(translateServiceLabel('用户自定义 ChatGPT 套餐', 'en-US')).toBeUndefined();
        expect(translateServiceLabel('', 'en-US')).toBeUndefined();
    });
});

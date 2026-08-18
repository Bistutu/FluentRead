import { describe, expect, it } from 'vitest';

import { Config, normalizeConfig } from '@/entrypoints/utils/model';
import { MINIMAX_ENDPOINTS, tongyiTokenPlanUrl, urls } from '@/entrypoints/utils/constant';
import { customModelString, defaultModelIds, defaultModels, defaultOption, models, options, resolveConfiguredModel, services, servicesType } from '@/entrypoints/utils/option';

describe('AI 模型编号列表', () => {
    it('AI 智能上下文默认关闭，并能从旧配置平滑补齐', () => {
        expect(new Config().enableAIContext).toBe(false);
        expect(normalizeConfig({}).enableAIContext).toBe(false);
        expect(normalizeConfig({enableAIContext: true}).enableAIContext).toBe(true);
        expect(servicesType.isUseAIContext(services.openai)).toBe(true);
        expect(servicesType.isUseAIContext(services.microsoft)).toBe(false);
        expect(servicesType.isUseAIContext(services.huanYuanTranslation)).toBe(false);
        expect(servicesType.isUseAIContext(services.tongyi, 'qwen-mt-plus')).toBe(false);
        expect(servicesType.isUseAIContext(services.tongyi, resolveConfiguredModel(customModelString, 'qwen-mt-plus'))).toBe(false);
        expect(resolveConfiguredModel(customModelString, 'custom-model')).toBe('custom-model');
    });

    it('展示当前主流模型，并移除已退役或错误的预设编号', () => {
        expect(models.get(services.openai)?.at(0)).toBe('gpt-5.6-luna');
        expect(models.get(services.openai)).toContain('gpt-5.6-sol');
        expect(models.get(services.openai)).not.toContain('gpt5');
        expect(models.get(services.gemini)).toContain('gemini-3.6-flash');
        expect(models.get(services.claude)).toContain('claude-fable-5');
        expect(models.get(services.claude)).toContain('claude-sonnet-5');
        expect(models.get(services.claude)?.at(-1)).toBe(customModelString);
        expect(models.get(services.tongyi)?.at(0)).toBe('qwen3.6-flash');
        expect(models.get(services.tongyi)).toContain('qwen3.7-max');
        expect(models.get(services.tongyi)).not.toContain('qwen3.7-flash');
        expect(models.get(services.zhipu)?.at(0)).toBe('glm-4.5-flash');
        expect(models.get(services.zhipu)).toContain('glm-5.2');
        expect(models.get(services.infini)).toContain('glm-5.2');
        expect(models.get(services.infini)).not.toContain('glm-5.3');
        expect(models.get(services.moonshot)).toContain('kimi-k2.7-code');
        expect(models.get(services.yiyan)).toContain('ernie-5.1');
        expect(models.get(services.minimax)).toContain('MiniMax-M2.7');
        expect(models.get(services.jieyue)).toContain('step-3.5-flash');
        expect(models.get(services.huanYuan)).toContain('hy3');
        expect(models.get(services.grok)).toContain('grok-4.5');
        expect(models.get(services.groq)).not.toContain('whisper-large-v3');
        expect(models.get(services.openrouter)?.at(-1)).toBe(customModelString);
        expect(options.services.find(option => option.value === services.zhipu)?.label).toBe('智谱');
        expect(options.services.find(option => option.value === services.freeTranslation)?.label).toBe('免费翻译服务');
        expect(options.services[1]?.value).toBe(services.freeTranslation);
        expect(options.services.find(option => option.value === services.freeTranslation)?.description)
            .toContain('微软翻译、DeepLX、谷歌翻译依次尝试');
        expect(options.services.every(option => !/[🌟⭐★]/u.test(option.label))).toBe(true);
        expect(servicesType.isMachine(services.freeTranslation)).toBe(true);
        expect(defaultOption.service).toBe(services.freeTranslation);
    });

    it('所有需要模型的 AI 服务默认使用推荐模型档位', () => {
        for (const [service, defaultModel] of Object.entries(defaultModelIds)) {
            expect(defaultModels.get(service), `${service} 默认模型`).toBe(defaultModel);
            expect(models.get(service)?.at(0), `${service} 模型列表首项`).toBe(defaultModel);
        }
    });

    it('不会把下拉列表中仍可选择的模型当成退役编号改写', () => {
        for (const [service, selectableModels] of models) {
            for (const selectedModel of selectableModels) {
                const normalized = normalizeConfig({model: {[service]: selectedModel}});
                expect(normalized.model[service], `${service}: ${selectedModel}`).toBe(selectedModel);
            }
        }
    });
});

describe('图片翻译配置', () => {
    it('默认关闭，并保留用户主动启用或关闭的状态', () => {
        expect(normalizeConfig({}).disableImageTranslator).toBe(true);
        expect(normalizeConfig({disableImageTranslator: false}).disableImageTranslator).toBe(false);
        expect(normalizeConfig({disableImageTranslator: true}).disableImageTranslator).toBe(true);
    });
});

describe('圈选翻译配置', () => {
    it('默认关闭，并保留用户主动启用的状态', () => {
        expect(new Config().selectionAreaEnabled).toBe(false);
        expect(normalizeConfig({}).selectionAreaEnabled).toBe(false);
        expect(normalizeConfig({selectionAreaEnabled: true}).selectionAreaEnabled).toBe(true);
        expect(normalizeConfig({selectionAreaEnabled: 'true'}).selectionAreaEnabled).toBe(false);
    });
});

describe('旧模型编号兼容迁移', () => {
    it('迁移官方服务中已退役或错误的模型编号', () => {
        const normalized = normalizeConfig({
            model: {
                [services.openai]: 'gpt5',
                [services.zhipu]: 'GLM-4-Flash',
                [services.moonshot]: 'kimi-k2-0711-preview',
                [services.claude]: 'claude-sonnet-4-0',
                [services.grok]: 'grok-4-0709',
            },
        });

        expect(normalized.model).toMatchObject({
            [services.openai]: 'gpt-5.6-luna',
            [services.zhipu]: 'glm-4.5-flash',
            [services.moonshot]: 'kimi-k3',
            [services.claude]: 'claude-sonnet-5',
            [services.grok]: 'grok-4.5',
        });
    });

    it.each(['glm-4.5', 'glm-4-plus', 'glm-4', 'glm-4v'])(
        '将智谱普通旧模型 %s 直接迁移到当前默认模型',
        legacyModel => {
            const normalized = normalizeConfig({model: {[services.zhipu]: legacyModel}});
            expect(normalized.model[services.zhipu]).toBe('glm-5.3');
        },
    );

    it.each([
        'kimi-k2-0711-preview',
        'kimi-k2-turbo-preview',
        'moonshot-v1-auto',
        'moonshot-v1-8k',
        'moonshot-v1-32k',
    ])('将 Kimi 通用旧模型 %s 直接迁移到当前默认模型', legacyModel => {
        const normalized = normalizeConfig({model: {[services.moonshot]: legacyModel}});
        expect(normalized.model[services.moonshot]).toBe('kimi-k3');
    });

    it.each([
        ['claude-3-5-sonnet', 'claude-sonnet-5'],
        ['claude-3-5-sonnet-20241022', 'claude-sonnet-5'],
        ['claude-3-opus', 'claude-opus-5'],
        ['claude-3-opus-20240229', 'claude-opus-5'],
        ['claude-3-5-haiku', 'claude-haiku-4-5'],
        ['claude-3-5-haiku-20241022', 'claude-haiku-4-5'],
    ])('将 Claude 旧模型 %s 迁移到当前同系列模型', (legacyModel, currentModel) => {
        const normalized = normalizeConfig({model: {[services.claude]: legacyModel}});
        expect(normalized.model[services.claude]).toBe(currentModel);
    });

    it.each(['claude-sonnet-4-6', 'claude-opus-4-8'])(
        '保留列表中仍可主动选择的 Claude 旧模型 %s',
        supportedModel => {
            const normalized = normalizeConfig({model: {[services.claude]: supportedModel}});
            expect(normalized.model[services.claude]).toBe(supportedModel);
        },
    );

    it.each([
        ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
        ['llama-3.1-8b-instant', 'openai/gpt-oss-20b'],
        ['llama3-8b-8192', 'openai/gpt-oss-20b'],
    ])('迁移已退役的 Groq 模型 %s', (legacyModel, currentModel) => {
        const normalized = normalizeConfig({
            model: {
                [services.groq]: legacyModel,
            },
        });

        expect(normalized.model[services.groq]).toBe(currentModel);
    });

    it('迁移已切换协议或退役的国内服务模型编号', () => {
        const normalized = normalizeConfig({
            model: {
                [services.yiyan]: 'ERNIE-Bot 4.0',
                [services.minimax]: 'chatcompletion_v2',
                [services.jieyue]: 'step-1-8k',
                [services.huanYuan]: 'hunyuan-turbos-latest',
                [services.infini]: 'glm-4-9b-chat',
            },
        });

        expect(normalized.model).toMatchObject({
            [services.yiyan]: 'ernie-5.1',
            [services.minimax]: 'MiniMax-M2.7',
            [services.jieyue]: 'step-3.5-flash',
            [services.huanYuan]: 'hy3',
            [services.infini]: 'glm-5.2',
        });
    });

    it('不改写 Azure、自定义接口或 New API 的部署别名', () => {
        const normalized = normalizeConfig({
            model: {
                [services.azureOpenai]: 'gpt5',
                [services.custom]: 'gpt5',
                [services.newapi]: 'gpt5',
            },
        });

        expect(normalized.model).toMatchObject({
            [services.azureOpenai]: 'gpt5',
            [services.custom]: 'gpt5',
            [services.newapi]: 'gpt5',
        });
    });

    it('不改写未知的 OpenAI 直连模型编号', () => {
        const normalized = normalizeConfig({
            model: {[services.openai]: 'gpt-private-deployment'},
        });

        expect(normalized.model[services.openai]).toBe('gpt-private-deployment');
    });

    it('保留 DeepSeek 旧编号迁移及思考模式兼容行为', () => {
        const chat = normalizeConfig({model: {[services.deepseek]: 'deepseek-chat'}});
        const reasoner = normalizeConfig({model: {[services.deepseek]: 'deepseek-reasoner'}});

        expect(chat.model[services.deepseek]).toBe('deepseek-v4-flash');
        expect(chat.deepseekThinkingMode).toBe('disabled');
        expect(reasoner.model[services.deepseek]).toBe('deepseek-v4-flash');
        expect(reasoner.deepseekThinkingMode).toBe('enabled');
    });
});

describe('划词翻译配置兼容', () => {
    it('为旧配置补齐可发现的触发方式，并清理非法值', () => {
        expect(normalizeConfig({selectionTranslatorMode: 'bilingual'})).toMatchObject({
            selectionTranslatorMode: 'bilingual',
            selectionTranslatorTrigger: 'icon',
            disableSelectionTranslator: false,
        });

        expect(normalizeConfig({selectionTranslatorMode: 'invalid', selectionTranslatorTrigger: 'invalid'})).toMatchObject({
            selectionTranslatorMode: 'disabled',
            selectionTranslatorTrigger: 'icon',
            disableSelectionTranslator: true,
        });
    });
});

describe('OpenAI 兼容服务端点', () => {
    it('使用服务商当前公开的统一 Chat Completions 端点', () => {
        expect(urls[services.yiyan]).toBe('https://qianfan.bj.baidubce.com/v2/chat/completions');
        expect(urls[services.minimax]).toBe('https://api.minimaxi.com/v1/chat/completions');
        expect(MINIMAX_ENDPOINTS.payg.cn).toBe('https://api.minimaxi.com/v1/chat/completions');
        expect(MINIMAX_ENDPOINTS['token-plan'].global).toBe('https://api.minimax.io/v1/chat/completions');
        expect(urls[services.infini]).toBe('https://cloud.infini-ai.com/maas/v1/chat/completions');
        expect(urls[services.huanYuan]).toBe('https://api.tokenhub.tencent.com/v1/chat/completions');
        expect(tongyiTokenPlanUrl).toBe('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
    });

    it('MiniMax 区域配置只接受全球版或中国版', () => {
        expect(new Config().minimaxRegion).toBe('cn');
        expect(normalizeConfig({minimaxRegion: 'cn'}).minimaxRegion).toBe('cn');
        expect(normalizeConfig({minimaxRegion: 'unknown'}).minimaxRegion).toBe('cn');
    });

    it('MiniMax 计费方式只接受按量付费或 Token Plan', () => {
        expect(new Config().minimaxBillingPlan).toBe('payg');
        expect(normalizeConfig({minimaxBillingPlan: 'token-plan'}).minimaxBillingPlan).toBe('token-plan');
        expect(normalizeConfig({minimaxBillingPlan: 'unknown'}).minimaxBillingPlan).toBe('payg');
    });

    it('文心一言使用 Bearer Token，不再要求旧 AK/SK', () => {
        expect(servicesType.isUseToken(services.yiyan)).toBe(true);
        expect(servicesType.isUseAkSk(services.yiyan)).toBe(false);
    });
});

import { describe, expect, it } from 'vitest';

import { normalizeConfig } from '@/entrypoints/utils/model';
import { tongyiTokenPlanUrl, urls } from '@/entrypoints/utils/constant';
import { customModelString, models, services, servicesType } from '@/entrypoints/utils/option';

describe('AI 模型编号列表', () => {
    it('展示当前主流模型，并移除已退役或错误的预设编号', () => {
        expect(models.get(services.openai)?.at(0)).toBe('gpt-5.6-sol');
        expect(models.get(services.openai)).not.toContain('gpt5');
        expect(models.get(services.gemini)).toContain('gemini-3.6-flash');
        expect(models.get(services.claude)).toContain('claude-fable-5');
        expect(models.get(services.claude)).toContain('claude-sonnet-5');
        expect(models.get(services.claude)?.at(-1)).toBe(customModelString);
        expect(models.get(services.tongyi)?.at(0)).toBe('qwen3.8-max-preview');
        expect(models.get(services.tongyi)).toContain('qwen3.7-max');
        expect(models.get(services.tongyi)).not.toContain('qwen3.7-flash');
        expect(models.get(services.zhipu)).toContain('glm-5.2');
        expect(models.get(services.zhipu)).not.toContain('glm-5.3');
        expect(models.get(services.moonshot)).toContain('kimi-k2.7-code');
        expect(models.get(services.yiyan)).toContain('ernie-5.1');
        expect(models.get(services.minimax)).toContain('MiniMax-M2.7');
        expect(models.get(services.jieyue)).toContain('step-3.5-flash');
        expect(models.get(services.huanYuan)).toContain('hy3');
        expect(models.get(services.grok)).toContain('grok-4.5');
        expect(models.get(services.groq)).not.toContain('whisper-large-v3');
        expect(models.get(services.openrouter)?.at(-1)).toBe(customModelString);
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
            [services.openai]: 'gpt-5.6-sol',
            [services.zhipu]: 'glm-4.5-flash',
            [services.moonshot]: 'kimi-k2.6',
            [services.claude]: 'claude-sonnet-5',
            [services.grok]: 'grok-4.5',
        });
    });

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

describe('OpenAI 兼容服务端点', () => {
    it('使用服务商当前公开的统一 Chat Completions 端点', () => {
        expect(urls[services.yiyan]).toBe('https://qianfan.bj.baidubce.com/v2/chat/completions');
        expect(urls[services.minimax]).toBe('https://api.minimax.io/v1/chat/completions');
        expect(urls[services.infini]).toBe('https://cloud.infini-ai.com/maas/v1/chat/completions');
        expect(urls[services.huanYuan]).toBe('https://api.tokenhub.tencent.com/v1/chat/completions');
        expect(tongyiTokenPlanUrl).toBe('https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
    });

    it('文心一言使用 Bearer Token，不再要求旧 AK/SK', () => {
        expect(servicesType.isUseToken(services.yiyan)).toBe(true);
        expect(servicesType.isUseAkSk(services.yiyan)).toBe(false);
    });
});

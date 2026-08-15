import { describe, expect, it } from 'vitest';

import { normalizeConfig } from '@/entrypoints/utils/model';
import { customModelString, models, services } from '@/entrypoints/utils/option';

describe('AI 模型编号列表', () => {
    it('展示当前主流模型，并移除已退役或错误的预设编号', () => {
        expect(models.get(services.openai)).toContain('gpt-5.6-luna');
        expect(models.get(services.openai)).not.toContain('gpt5');
        expect(models.get(services.gemini)).toContain('gemini-3.6-flash');
        expect(models.get(services.claude)).toContain('claude-sonnet-4-6');
        expect(models.get(services.claude)?.at(-1)).toBe(customModelString);
        expect(models.get(services.tongyi)).toContain('qwen3.7-max');
        expect(models.get(services.zhipu)).toContain('glm-5.2');
        expect(models.get(services.moonshot)).toContain('kimi-k2.6');
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
            [services.openai]: 'gpt-5.6-luna',
            [services.zhipu]: 'glm-4.7-flashx',
            [services.moonshot]: 'kimi-k2.6',
            [services.claude]: 'claude-sonnet-4-6',
            [services.grok]: 'grok-4.3',
        });
    });

    it('迁移即将退役的 Groq Llama 模型', () => {
        const normalized = normalizeConfig({
            model: {
                [services.groq]: 'llama-3.3-70b-versatile',
            },
        });

        expect(normalized.model[services.groq]).toBe('openai/gpt-oss-120b');
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

    it('保留 DeepSeek 旧编号迁移及思考模式兼容行为', () => {
        const chat = normalizeConfig({model: {[services.deepseek]: 'deepseek-chat'}});
        const reasoner = normalizeConfig({model: {[services.deepseek]: 'deepseek-reasoner'}});

        expect(chat.model[services.deepseek]).toBe('deepseek-v4-flash');
        expect(chat.deepseekThinkingMode).toBe('disabled');
        expect(reasoner.model[services.deepseek]).toBe('deepseek-v4-flash');
        expect(reasoner.deepseekThinkingMode).toBe('enabled');
    });
});

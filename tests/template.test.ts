import { describe, it, expect, beforeEach, vi } from 'vitest';

// template.ts 顶层会 import config（其内部使用了 wxt 注入的 storage 全局），
// 在纯 Node 测试环境下并不存在，因此用一个可变的 mock 对象替换该模块。
const { mockConfig } = vi.hoisted(() => ({
    mockConfig: {
        service: 'openai',
        to: 'zh-Hans',
        model: {} as Record<string, string>,
        customModel: {} as Record<string, string>,
        system_role: {} as Record<string, string>,
        user_role: {} as Record<string, string>,
        customBody: {} as Record<string, string>,
        robot_id: {} as Record<string, string>,
    },
}));

vi.mock('@/entrypoints/utils/config', () => ({ config: mockConfig }));

import {
    claudeMsgTemplate,
    commonMsgTemplate,
    cozeTemplate,
    deepseekMsgTemplate,
    geminiMsgTemplate,
    minimaxTemplate,
    tongyiMsgTemplate,
    yiyanMsgTemplate,
} from '@/entrypoints/utils/template';
import {
    isCustomBodyMapping,
    isValidCustomBody,
    mergeCustomBody,
    normalizeCustomBodyMapping,
} from '@/entrypoints/utils/custom-body';
import { buildHunyuanTranslationRequestBody } from '@/entrypoints/service/hunyuan-translation';
import { services, servicesType } from '@/entrypoints/utils/option';

beforeEach(() => {
    // 每个用例前重置 mock 配置，避免相互污染
    mockConfig.service = 'openai';
    mockConfig.to = 'zh-Hans';
    mockConfig.model = {
        openai: 'gpt-5.6-luna',
        moonshot: 'kimi-k2.6',
        deepseek: 'deepseek-chat',
        gemini: 'gemini-3.6-flash',
        claude: 'claude-sonnet-4-6',
        tongyi: 'qwen3.7-flash',
        yiyan: 'ERNIE-Bot',
        minimax: 'chatcompletion_v2',
    };
    mockConfig.customModel = {};
    mockConfig.system_role = Object.fromEntries(
        Object.values(services).map(service => [service, 'You are a translator.'])
    );
    mockConfig.user_role = Object.fromEntries(
        Object.values(services).map(service => [service, 'Translate to {{to}}: {{origin}}'])
    );
    mockConfig.customBody = {};
    mockConfig.robot_id = {
        cozecom: 'coze-bot',
        cozecn: 'coze-bot',
    };
});

describe('mergeCustomBody（纯函数）', () => {
    it('raw 为空字符串时，payload 原样返回', () => {
        const payload = { model: 'x', temperature: 1 };
        expect(mergeCustomBody(payload, '')).toEqual({ model: 'x', temperature: 1 });
    });

    it('raw 为纯空白时，payload 原样返回', () => {
        const payload = { a: 1 };
        expect(mergeCustomBody(payload, '   \n\t ')).toEqual({ a: 1 });
    });

    it('raw 为 undefined / null 时，payload 原样返回', () => {
        expect(mergeCustomBody({ a: 1 }, undefined)).toEqual({ a: 1 });
        expect(mergeCustomBody({ a: 1 }, null)).toEqual({ a: 1 });
    });

    it('合法 JSON 对象会被合并进 payload', () => {
        const payload: any = { model: 'm', messages: [] };
        const result = mergeCustomBody(payload, '{"max_tokens": 1024}');
        expect(result.max_tokens).toBe(1024);
        expect(result.model).toBe('m');
    });

    it('用户字段优先：覆盖同名的默认字段', () => {
        const payload: any = { temperature: 1.0 };
        const result = mergeCustomBody(payload, '{"temperature": 0.6}');
        expect(result.temperature).toBe(0.6);
    });

    it('支持嵌套对象（如 thinking 这类控制字段）', () => {
        const payload: any = { model: 'm' };
        const result = mergeCustomBody(payload, '{"thinking": {"type": "disabled"}}');
        expect(result.thinking).toEqual({ type: 'disabled' });
    });

    it('非法 JSON 被安全忽略，payload 不变', () => {
        const payload = { model: 'x' };
        expect(mergeCustomBody(payload, '{not valid json')).toEqual({ model: 'x' });
    });

    it('JSON 数组被忽略（必须是对象）', () => {
        const payload = { model: 'x' };
        expect(mergeCustomBody(payload, '[1,2,3]')).toEqual({ model: 'x' });
    });

    it('JSON 基本类型被忽略（数字 / 字符串 / 布尔 / null）', () => {
        expect(mergeCustomBody({ a: 1 }, '123')).toEqual({ a: 1 });
        expect(mergeCustomBody({ a: 1 }, '"hello"')).toEqual({ a: 1 });
        expect(mergeCustomBody({ a: 1 }, 'true')).toEqual({ a: 1 });
        expect(mergeCustomBody({ a: 1 }, 'null')).toEqual({ a: 1 });
    });

    it('返回合并后的新对象，不修改原始 payload', () => {
        const payload = { a: 1 };
        const result = mergeCustomBody(payload, '{"b": 2}');
        expect(result).not.toBe(payload);
        expect(result).toEqual({ a: 1, b: 2 });
        expect(payload).toEqual({ a: 1 });
    });
});

describe('自定义请求体校验与配置兼容', () => {
    it('UI 与运行时共享同一套 JSON 对象校验', () => {
        expect(isValidCustomBody('')).toBe(true);
        expect(isValidCustomBody('{"thinking": {"type": "disabled"}}')).toBe(true);
        expect(isValidCustomBody('[]')).toBe(false);
        expect(isValidCustomBody('{oops')).toBe(false);
    });

    it('只接受字符串映射，并可清理旧配置中的异常值', () => {
        expect(isCustomBodyMapping({ openai: '{}', moonshot: '{"a": 1}' })).toBe(true);
        expect(isCustomBodyMapping({ openai: null })).toBe(false);
        expect(normalizeCustomBodyMapping({ openai: '{}', invalid: 1 })).toEqual({ openai: '{}' });
        expect(normalizeCustomBodyMapping(null)).toEqual({});
    });
});

describe('commonMsgTemplate（集成）', () => {
    it('未配置自定义请求体时，生成标准 OpenAI 请求体', () => {
        const body = JSON.parse(commonMsgTemplate('hello'));
        expect(body).toEqual({
            model: 'gpt-5.6-luna',
            temperature: 1.0,
            messages: [
                { role: 'system', content: 'You are a translator.' },
                { role: 'user', content: 'Translate to zh-Hans: hello' },
            ],
        });
    });

    it('选择“自定义模型”时使用 customModel 的值', () => {
        mockConfig.model = { openai: '自定义模型' };
        mockConfig.customModel = { openai: 'gpt-4o-mini' };
        const body = JSON.parse(commonMsgTemplate('hello'));
        expect(body.model).toBe('gpt-4o-mini');
    });

    it('非法的自定义请求体被忽略，标准请求体保持完整', () => {
        mockConfig.customBody = { openai: '{oops' };
        const body = JSON.parse(commonMsgTemplate('hello'));
        expect(body.model).toBe('gpt-5.6-luna');
        expect(body.thinking).toBeUndefined();
        expect(body.messages).toHaveLength(2);
    });

    it('仅对当前服务生效：其他服务的自定义请求体不会被应用', () => {
        // 当前服务是 openai，却给另一个服务配置了自定义请求体
        mockConfig.customBody = { gemini: '{"thinking": {"type": "disabled"}}' };
        const body = JSON.parse(commonMsgTemplate('hello'));
        expect(body.thinking).toBeUndefined();
    });
});

// 重点：确保 thinking 等额外字段能够正确注入请求体顶层（issue #213）
describe('自定义请求体注入 thinking 字段（issue #213）', () => {
    it('关闭思考：{"thinking": {"type": "disabled"}} 注入到请求体顶层', () => {
        mockConfig.service = services.moonshot;
        mockConfig.customBody = { moonshot: '{"thinking": {"type": "disabled"}}' };
        const body = JSON.parse(commonMsgTemplate('你好世界'));
        expect(body.thinking).toEqual({ type: 'disabled' });
        // 同时不破坏原有字段
        expect(body.model).toBe('kimi-k2.6');
        expect(body.messages[1].content).toBe('Translate to zh-Hans: 你好世界');
    });

    it('开启思考：{"thinking": {"type": "enabled"}} 注入到请求体顶层', () => {
        mockConfig.customBody = { openai: '{"thinking": {"type": "enabled"}}' };
        const body = JSON.parse(commonMsgTemplate('hi'));
        expect(body.thinking).toEqual({ type: 'enabled' });
    });

    it('可同时覆盖 temperature 并注入 thinking', () => {
        mockConfig.customBody = {
            openai: '{"thinking": {"type": "disabled"}, "temperature": 0.6}',
        };
        const body = JSON.parse(commonMsgTemplate('hi'));
        expect(body.thinking).toEqual({ type: 'disabled' });
        expect(body.temperature).toBe(0.6);
    });

    it('带格式（缩进/换行）的 JSON 也能正确解析', () => {
        mockConfig.customBody = {
            openai: `{
                "thinking": { "type": "disabled" }
            }`,
        };
        const body = JSON.parse(commonMsgTemplate('hi'));
        expect(body.thinking).toEqual({ type: 'disabled' });
    });
});

describe('所有 AI 请求模板的自定义请求体支持', () => {
    const templateCases = [
        [services.openai, commonMsgTemplate],
        [services.deepseek, deepseekMsgTemplate],
        [services.gemini, geminiMsgTemplate],
        [services.claude, claudeMsgTemplate],
        [services.tongyi, tongyiMsgTemplate],
        [services.yiyan, yiyanMsgTemplate],
        [services.minimax, minimaxTemplate],
        [services.cozecom, cozeTemplate],
    ] as const;

    it.each(templateCases)('%s 模板会合并顶层自定义字段', (service, template) => {
        mockConfig.service = service;
        mockConfig.customBody = {[service]: '{"request_tag": "custom"}'};

        const body = JSON.parse(template('hello'));
        expect(body.request_tag).toBe('custom');
    });

    it('自定义请求体入口覆盖所有 AI 服务，但不覆盖机器翻译', () => {
        for (const service of servicesType.AI) {
            expect(servicesType.isUseCustomBody(service)).toBe(true);
        }
        expect(servicesType.isUseCustomBody(services.google)).toBe(false);
    });
});

describe('腾讯混元翻译自定义请求体', () => {
    it('在序列化和签名前合并自定义字段，并允许覆盖默认字段', () => {
        const body = buildHunyuanTranslationRequestBody(
            'hello',
            'zh',
            'hunyuan-translation',
            '{"Stream": true, "Field": "通用"}',
        );

        expect(body).toEqual({
            Model: 'hunyuan-translation',
            Stream: true,
            Text: 'hello',
            Target: 'zh',
            Field: '通用',
        });
    });
});

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
    },
}));

vi.mock('@/entrypoints/utils/config', () => ({ config: mockConfig }));

import { mergeCustomBody, commonMsgTemplate } from '@/entrypoints/utils/template';

beforeEach(() => {
    // 每个用例前重置 mock 配置，避免相互污染
    mockConfig.service = 'openai';
    mockConfig.to = 'zh-Hans';
    mockConfig.model = { openai: 'gpt-4o' };
    mockConfig.customModel = {};
    mockConfig.system_role = { openai: 'You are a translator.' };
    mockConfig.user_role = { openai: 'Translate to {{to}}: {{origin}}' };
    mockConfig.customBody = {};
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
        mergeCustomBody(payload, '{"max_tokens": 1024}');
        expect(payload.max_tokens).toBe(1024);
        expect(payload.model).toBe('m');
    });

    it('用户字段优先：覆盖同名的默认字段', () => {
        const payload: any = { temperature: 1.0 };
        mergeCustomBody(payload, '{"temperature": 0.6}');
        expect(payload.temperature).toBe(0.6);
    });

    it('支持嵌套对象（如 thinking 这类控制字段）', () => {
        const payload: any = { model: 'm' };
        mergeCustomBody(payload, '{"thinking": {"type": "disabled"}}');
        expect(payload.thinking).toEqual({ type: 'disabled' });
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

    it('原地修改并返回同一个 payload 引用', () => {
        const payload = { a: 1 };
        const result = mergeCustomBody(payload, '{"b": 2}');
        expect(result).toBe(payload);
    });
});

describe('commonMsgTemplate（集成）', () => {
    it('未配置自定义请求体时，生成标准 OpenAI 请求体', () => {
        const body = JSON.parse(commonMsgTemplate('hello'));
        expect(body).toEqual({
            model: 'gpt-4o',
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
        expect(body.model).toBe('gpt-4o');
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
        mockConfig.customBody = { openai: '{"thinking": {"type": "disabled"}}' };
        const body = JSON.parse(commonMsgTemplate('你好世界'));
        expect(body.thinking).toEqual({ type: 'disabled' });
        // 同时不破坏原有字段
        expect(body.model).toBe('gpt-4o');
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

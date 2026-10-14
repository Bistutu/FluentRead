/**
 * @file tests/translationVisionPayload.test.ts
 *
 * 文件职责：验证受信图片载荷的私有性、边界校验和各原生模板的序列化结构。
 * 主要内容：覆盖 data image 白名单、JSON 隐藏、OpenAI/DeepSeek/Gemini/Claude/通义视觉字段、识图 Thinking 默认值以及自定义 body 隔离。
 * 模块边界：本文件只测试纯快照与模板契约，不发起真实网络请求；provider transport 的 mock 请求由集成测试覆盖。
 */

import {describe, expect, it} from 'vitest';
import {attachTranslationImageInput, getTranslationImageInput} from '@/src/services/translation/requestSnapshot';
import {TRANSLATION_IMAGE_INPUT} from '@/src/services/translation/types';
import {
    claudeMsgTemplate,
    commonMsgTemplate,
    deepseekMsgTemplate,
    deepseekResponsesMsgTemplate,
    geminiMsgTemplate,
    tongyiMsgTemplate,
} from '@/src/services/translation/templates';

const image = 'data:image/png;base64,iVBORw0KGgo=';
const base = {
    service: 'custom', from: 'en', to: 'zh-Hans', useCache: true, enableAIContext: true,
    model: {custom: 'vision-model'}, customModel: {}, proxy: {}, custom: '', deeplx: '',
    newApiUrl: '', minimaxBillingPlan: 'payg', minimaxRegion: 'global', mimoBillingPlan: 'payg', mimoRegion: 'global',
    azureOpenaiEndpoint: '', customBody: {custom: '{"model":"attacker"}'}, system_role: {}, user_role: {},
    deepseekApiType: 'chat', deepseekThinkingMode: 'disabled', token: {}, requireApiKey: {},
    youdaoAppKey: '', youdaoAppSecret: '', tencentSecretId: '', tencentSecretKey: '',
} as any;

describe('trusted translation image payload', () => {
    it('keeps the image out of JSON and rejects URLs, SVG, and oversized values', () => {
        const message: Record<string, unknown> = {origin: 'text'};
        attachTranslationImageInput(message, image);
        expect(getTranslationImageInput(message)).toBe(image);
        expect(JSON.stringify(message)).toBe('{"origin":"text"}');
        expect(() => attachTranslationImageInput({}, 'https://example.test/a.png')).toThrow();
        expect(() => attachTranslationImageInput({}, 'data:image/svg+xml;base64,PHN2Zz4=')).toThrow();
        expect(() => attachTranslationImageInput({}, 'data:image/png;base64,A')).toThrow();
        expect(() => attachTranslationImageInput({}, `data:image/png;base64,${'A'.repeat(20 * 1024 * 1024)}`)).toThrow();
        expect(getTranslationImageInput(undefined)).toBeUndefined();
        expect(getTranslationImageInput('serialized')).toBeUndefined();
        const invalid: Record<PropertyKey, unknown> = {};
        Object.defineProperty(invalid, TRANSLATION_IMAGE_INPUT, {value: 'data:image/png;base64,A'});
        expect(getTranslationImageInput(invalid)).toBeUndefined();
    });

    it('rejects unsupported image formats at the template boundary', () => {
        expect(() => commonMsgTemplate({origin: 'read this', serviceOverride: 'custom', targetLanguage: 'zh-Hans', current: base, imageInput: 'data:image/svg+xml;base64,PHN2Zz4='})).toThrow('图片输入格式无效');
        expect(() => deepseekResponsesMsgTemplate({origin: 'read this', serviceOverride: 'deepseek', targetLanguage: 'zh-Hans', modelOverride: 'deepseek-flash', current: base, imageInput: 'data:image/svg+xml;base64,PHN2Zz4='})).toThrow('图片输入格式无效');
    });

    it.each([deepseekMsgTemplate, deepseekResponsesMsgTemplate])('keeps thinking disabled for visual transcription unless explicitly enabled', template => {
        const current = {...base, service: 'deepseek', model: {deepseek: 'deepseek-flash'}};
        const payload = JSON.parse(template({origin: 'read this', targetLanguage: 'zh-Hans', current: current, imageInput: image}));
        expect(payload.model).toBe('deepseek-flash');
        if (template === deepseekMsgTemplate) expect(payload.thinking).toEqual({type: 'disabled'});
        else expect(payload.reasoning).toEqual({effort: 'none'});
    });

    it('serializes native image parts and ignores custom body replacement', () => {
        const openai = JSON.parse(commonMsgTemplate({origin: 'read this', serviceOverride: 'custom', targetLanguage: 'zh-Hans', current: base, imageInput: image}));
        expect(openai.model).toBe('vision-model');
        expect(openai.messages[1].content[1]).toEqual({type: 'image_url', image_url: {url: image}});

        const gemini = JSON.parse(geminiMsgTemplate({origin: 'read this', serviceOverride: 'gemini', targetLanguage: 'zh-Hans', current: base, imageInput: image}));
        expect(gemini.contents[0].parts[1].inline_data).toEqual({mime_type: 'image/png', data: 'iVBORw0KGgo='});

        const claude = JSON.parse(claudeMsgTemplate({origin: 'read this', serviceOverride: 'claude', targetLanguage: 'zh-Hans', current: base, imageInput: image}));
        expect(claude.messages[0].content[1].source).toEqual({type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo='});

        const tongyi = JSON.parse(tongyiMsgTemplate({origin: 'read this', serviceOverride: 'tongyi', targetLanguage: 'zh-Hans', current: base, sourceLanguage: 'en', imageInput: image}));
        expect(tongyi.messages[1].content[1].image_url.url).toBe(image);
        expect(openai.model).not.toBe('attacker');
        expect(() => tongyiMsgTemplate({origin: 'read this', serviceOverride: 'tongyi', targetLanguage: 'zh-Hans', modelOverride: 'qwen-mt-plus', current: base, sourceLanguage: 'en', imageInput: image})).toThrow('不支持图片');
    });
});

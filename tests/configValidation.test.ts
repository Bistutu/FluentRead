import { describe, expect, it } from 'vitest';

import { getApiKeyRequirementKey, getMissingCredentialMessage } from '@/entrypoints/utils/configValidation';
import { services } from '@/entrypoints/utils/option';

describe('翻译服务凭据校验', () => {
    it('提示需要 API Key 的服务填写访问令牌', () => {
        expect(getMissingCredentialMessage(services.openai, { token: {} })).toContain('API Key');
        expect(getMissingCredentialMessage(services.openai, { token: { [services.openai]: '  ' } })).toContain('API Key');
        expect(getMissingCredentialMessage(services.openai, { token: { [services.openai]: 'configured' } })).toBeNull();
    });

    it('明确指出 DeepSeek 缺少 API Key', () => {
        expect(getMissingCredentialMessage(services.deepseek, { token: {} })).toBe(
            'DeepSeek 需要 API Key（访问令牌），当前尚未配置；请先在设置中填写，再开始翻译。',
        );
        expect(getMissingCredentialMessage(services.deepseek, { token: { [services.deepseek]: 'configured' } })).toBeNull();
    });

    it('允许按当前模型关闭 API Key 校验', () => {
        const config = {
            model: { [services.deepseek]: 'deepseek-v4-flash' },
            requireApiKey: { [`${services.deepseek}:deepseek-v4-flash`]: false },
            token: {},
        };
        expect(getApiKeyRequirementKey(services.deepseek, config)).toBe('deepseek:deepseek-v4-flash');
        expect(getMissingCredentialMessage(services.deepseek, config)).toBeNull();
    });

    it('切换模型后不会复用另一个模型的免 Key设置', () => {
        const config = {
            model: { [services.deepseek]: 'deepseek-v4-pro' },
            requireApiKey: { [`${services.deepseek}:deepseek-v4-flash`]: false },
            token: {},
        };
        expect(getMissingCredentialMessage(services.deepseek, config)).toContain('API Key');
    });

    it('保留 DeepLX 可选令牌的行为', () => {
        expect(getMissingCredentialMessage(services.deeplx, { token: {} })).toBeNull();
    });

    it('覆盖有道和腾讯云的专用凭据', () => {
        expect(getMissingCredentialMessage(services.youdao, { token: {}, youdaoAppKey: 'key' })).toContain('App Secret');
        expect(getMissingCredentialMessage(services.tencent, { token: {}, tencentSecretId: 'id' })).toContain('SecretKey');
        expect(getMissingCredentialMessage(services.tencent, { token: {}, tencentSecretId: 'id', tencentSecretKey: 'secret' })).toBeNull();
    });
});

import { describe, expect, it } from 'vitest';

import { getMissingCredentialMessage } from '@/entrypoints/utils/configValidation';
import { services } from '@/entrypoints/utils/option';

describe('翻译服务凭据校验', () => {
    it('提示需要 API Key 的服务填写访问令牌', () => {
        expect(getMissingCredentialMessage(services.openai, { token: {} })).toContain('API Key');
        expect(getMissingCredentialMessage(services.openai, { token: { [services.openai]: '  ' } })).toContain('API Key');
        expect(getMissingCredentialMessage(services.openai, { token: { [services.openai]: 'configured' } })).toBeNull();
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

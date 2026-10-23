import {withProviderSnapshot} from './helpers/providerSnapshot';
import {getApiKeyRequirementKey} from '@/src/core/config/validation';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mockConfig = vi.hoisted(() => ({
    service: 'zhipu',
    to: 'zh-Hans',
    token: {zhipu: 'api-id.api-secret'},
    model: {zhipu: 'glm-4.5-flash'},
    customModel: {},
    customBody: {},
    system_role: {zhipu: 'Translate safely.'},
    user_role: {zhipu: 'Translate {{origin}} into {{to}}.'},
    requireApiKey: {},
    extra: {zhipu: {secret: 'legacy-persisted-jwt', expiration: Number.MAX_SAFE_INTEGER}},
}));

vi.mock('@/src/services/config/store', () => ({config: mockConfig}));

import zhipu from '@/src/providers/translation/zhipu';

describe('智谱派生 JWT 凭据', () => {
    beforeEach(() => {
        mockConfig.token.zhipu = 'api-id.api-secret';
        mockConfig.requireApiKey = {};
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({choices: [{message: {content: 'translated'}}]}),
        })));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it.each(['', 'not-a-jwt-pair'])('required malformed key %s fails before sending a request', async token => {
        mockConfig.token.zhipu = token;
        await expect(zhipu(withProviderSnapshot({origin: 'hello'}, mockConfig))).rejects.toThrow('无法生成令牌');
        expect(fetch).not.toHaveBeenCalled();
    });
    it('optional no-key endpoints do not reuse a prior signed credential', async () => {
        await zhipu(withProviderSnapshot({origin: 'first'}, mockConfig));
        mockConfig.token.zhipu = '';
        mockConfig.requireApiKey = {[getApiKeyRequirementKey('zhipu', mockConfig)]: false};
        await zhipu(withProviderSnapshot({origin: 'second'}, mockConfig));
        const calls = vi.mocked(fetch).mock.calls;
        expect(new Headers(calls[0][1]?.headers).get('Authorization')).toMatch(/^Bearer /);
        expect(new Headers(calls[1][1]?.headers).has('Authorization')).toBe(false);
    });
    it('只在模块内存复用 JWT，不读取或改写 config.extra', async () => {
        const legacyExtra = structuredClone(mockConfig.extra);
        await zhipu(withProviderSnapshot({origin: 'hello', targetLanguage: 'zh-Hans'}, mockConfig));
        vi.setSystemTime(new Date('2026-01-01T01:00:00Z'));
        await zhipu(withProviderSnapshot({origin: 'world', targetLanguage: 'zh-Hans'}, mockConfig));

        const fetchMock = vi.mocked(fetch);
        const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Headers;
        const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Headers;
        expect(firstHeaders.get('Authorization')).toMatch(/^Bearer /);
        expect(secondHeaders.get('Authorization')).toBe(firstHeaders.get('Authorization'));
        expect(mockConfig.extra).toEqual(legacyExtra);
    });
});

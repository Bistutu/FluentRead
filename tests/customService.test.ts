import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({
    mockConfig: {
        service: 'custom',
        custom: 'http://127.0.0.1:11434/v1/chat/completions',
        proxy: {} as Record<string, string>,
        token: {} as Record<string, string>,
        model: {} as Record<string, string>,
        customModel: {} as Record<string, string>,
        customBody: {} as Record<string, string>,
        system_role: {} as Record<string, string>,
        user_role: {} as Record<string, string>,
        to: 'zh-Hans',
    },
}));

vi.mock('@/entrypoints/utils/config', () => ({ config: mockConfig }));

import custom from '@/entrypoints/service/custom';
import { customModelString, services } from '@/entrypoints/utils/option';

describe('自定义接口适配器', () => {
    beforeEach(() => {
        mockConfig.service = services.custom;
        mockConfig.custom = 'http://127.0.0.1:11434/v1/chat/completions';
        mockConfig.proxy = {};
        mockConfig.token = {[services.custom]: 'local-token'};
        mockConfig.model = {[services.custom]: customModelString};
        mockConfig.customModel = {[services.custom]: 'local/translation-model'};
        mockConfig.customBody = {};
        mockConfig.system_role = {[services.custom]: 'You are a translator.'};
        mockConfig.user_role = {[services.custom]: 'Translate {{origin}} into {{to}}.'};
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('使用按服务保存的代理、模型和令牌配置', async () => {
        mockConfig.proxy = {[services.custom]: 'http://127.0.0.1:8080'};
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({choices: [{message: {content: '译文'}}]}),
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(custom({origin: 'hello'})).resolves.toBe('译文');

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://127.0.0.1:8080');
        expect((init.headers as Headers).get('Authorization')).toBe('Bearer local-token');
        expect(JSON.parse(String(init.body))).toMatchObject({model: 'local/translation-model'});
    });

    it('代理为空时回退到保存的自定义接口地址', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({choices: [{message: {content: '译文'}}]}),
        });
        vi.stubGlobal('fetch', fetchMock);

        await custom({origin: 'hello'});

        expect(fetchMock.mock.calls[0]?.[0]).toBe(mockConfig.custom);
    });
});

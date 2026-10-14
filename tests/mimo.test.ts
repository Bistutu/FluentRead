import {withProviderSnapshot} from './helpers/providerSnapshot';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, mockConfig } = vi.hoisted(() => ({
    fetchMock: vi.fn(),
    mockConfig: {
        service: 'mimo',
        to: 'zh-Hans',
        token: { mimo: '' } as Record<string, string>,
        model: { mimo: 'mimo-v2.6-pro' } as Record<string, string>,
        customModel: {} as Record<string, string>,
        customBody: {} as Record<string, string>,
        proxy: {} as Record<string, string>,
        system_role: { mimo: 'You are a translator.' } as Record<string, string>,
        user_role: { mimo: 'Translate to {{to}}: {{origin}}' } as Record<string, string>,
        mimoBillingPlan: 'payg',
        mimoRegion: 'cn',
    },
}));

vi.mock('@/src/services/config/store', () => ({ config: mockConfig }));

import {translateWithOpenAICompatibleAiSdk} from '@/src/providers/translation/ai-sdk/openai-compatible';
import { services } from '@/src/core/config/catalog';

function successResponse() {
    return new Response(JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1,
        model: 'mimo-v2.6-pro',
        choices: [{index: 0, message: {role: 'assistant', content: '译文'}, finish_reason: 'stop'}],
        usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
    }), {
        status: 200,
        headers: {'content-type': 'application/json'},
    });
}

describe('小米 MiMo OpenAI 兼容服务', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', fetchMock);
        fetchMock.mockResolvedValue(successResponse());
        mockConfig.service = services.mimo;
        mockConfig.token.mimo = '';
        mockConfig.mimoBillingPlan = 'payg';
        mockConfig.mimoRegion = 'cn';
    });

    it('按量付费使用统一 API 地址并发送 sk Key', async () => {
        mockConfig.token.mimo = 'sk-test';

        await expect(translateWithOpenAICompatibleAiSdk(withProviderSnapshot({ origin: 'hello', serviceOverride: services.mimo }, mockConfig))).resolves.toBe('译文');

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.xiaomimimo.com/v1/chat/completions',
            expect.objectContaining({ method: 'POST' }),
        );
        const headers = new Headers(fetchMock.mock.calls[0][1].headers);
        expect(headers.get('Authorization')).toBe('Bearer sk-test');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('mimo-v2.6-pro');
    });

    it('Token Plan 使用所选集群地址并发送 tp Key', async () => {
        mockConfig.token.mimo = 'tp-test';
        mockConfig.mimoBillingPlan = 'token-plan';
        mockConfig.mimoRegion = 'ams';

        await expect(translateWithOpenAICompatibleAiSdk(withProviderSnapshot({ origin: 'hello', serviceOverride: services.mimo }, mockConfig))).resolves.toBe('译文');

        expect(fetchMock).toHaveBeenCalledWith(
            'https://token-plan-ams.xiaomimimo.com/v1/chat/completions',
            expect.objectContaining({ method: 'POST' }),
        );
        const headers = new Headers(fetchMock.mock.calls[0][1].headers);
        expect(headers.get('Authorization')).toBe('Bearer tp-test');
    });
});

import {withProviderSnapshot} from './helpers/providerSnapshot';
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
        customHeaders: {} as Record<string, string>,
        system_role: {} as Record<string, string>,
        user_role: {} as Record<string, string>,
        to: 'zh-Hans',
    },
}));

vi.mock('@/src/services/config/store', () => ({ config: mockConfig }));

import {translateWithOpenAICompatibleAiSdk} from '@/src/providers/translation/ai-sdk/openai-compatible';
import { customModelString, services } from '@/src/core/config/catalog';

function successResponse() {
    return new Response(JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1,
        model: 'local/translation-model',
        choices: [{index: 0, message: {role: 'assistant', content: '译文'}, finish_reason: 'stop'}],
        usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
    }), {
        status: 200,
        headers: {'content-type': 'application/json'},
    });
}

describe('自定义接口适配器', () => {
    beforeEach(() => {
        mockConfig.service = services.custom;
        mockConfig.custom = 'http://127.0.0.1:11434/v1/chat/completions';
        mockConfig.proxy = {};
        mockConfig.token = {[services.custom]: 'local-token'};
        mockConfig.model = {[services.custom]: customModelString};
        mockConfig.customModel = {[services.custom]: 'local/translation-model'};
        mockConfig.customBody = {};
        mockConfig.customHeaders = {};
        mockConfig.system_role = {[services.custom]: 'You are a translator.'};
        mockConfig.user_role = {[services.custom]: 'Translate {{origin}} into {{to}}.'};
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('使用按服务保存的代理、模型和令牌配置', async () => {
        mockConfig.proxy = {[services.custom]: 'http://127.0.0.1:8080'};
        const fetchMock = vi.fn().mockResolvedValue(successResponse());
        vi.stubGlobal('fetch', fetchMock);

        await expect(translateWithOpenAICompatibleAiSdk(withProviderSnapshot({origin: 'hello'}, mockConfig))).resolves.toBe('译文');

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://127.0.0.1:8080/');
        expect(new Headers(init.headers).get('Authorization')).toBe('Bearer local-token');
        expect(JSON.parse(String(init.body))).toMatchObject({model: 'local/translation-model'});
    });

    it('代理为空时回退到保存的自定义接口地址', async () => {
        const fetchMock = vi.fn().mockResolvedValue(successResponse());
        vi.stubGlobal('fetch', fetchMock);

        await translateWithOpenAICompatibleAiSdk(withProviderSnapshot({origin: 'hello'}, mockConfig));

        expect(fetchMock.mock.calls[0]?.[0]).toBe(mockConfig.custom);
    });
    it('重复请求与批量请求保持会话头，默认认证只被大小写无关的显式配置覆盖', async () => {
        mockConfig.customHeaders = {custom: JSON.stringify({
            'x-opencode-session': 'stable-session', 'Authorization': 'Bearer alternate-auth',
            'HTTP-Referer': 'https://example.test', 'X-Title': 'My translator',
        }), 'custom:other': '{"x-opencode-session":"other-session"}'};
        const fetchMock = vi.fn().mockImplementation(async () => successResponse());
        vi.stubGlobal('fetch', fetchMock);
        await translateWithOpenAICompatibleAiSdk(withProviderSnapshot({origin: ['hello', 'world']}, mockConfig));
        await translateWithOpenAICompatibleAiSdk(withProviderSnapshot({origin: 'again'}, mockConfig));
        expect(fetchMock).toHaveBeenCalledTimes(3);
        for (const [, init] of fetchMock.mock.calls) {
            const headers = new Headers(init.headers);
            expect(headers.get('x-opencode-session')).toBe('stable-session');
            expect(headers.get('authorization')).toBe('Bearer alternate-auth');
            expect(headers.get('HTTP-Referer')).toBe('https://example.test');
            expect(headers.get('X-Title')).toBe('My translator');
            expect(headers.get('content-type')).toBe('application/json');
            expect(String(init.body)).not.toContain('stable-session');
        }
    });

    it('拒绝无效请求头且不发请求，清空后恢复默认认证', async () => {
        const fetchMock = vi.fn().mockImplementation(async () => successResponse());
        vi.stubGlobal('fetch', fetchMock);
        mockConfig.customHeaders.custom = '{"x-token":42}';
        await expect(translateWithOpenAICompatibleAiSdk(withProviderSnapshot({origin: 'hello'}, mockConfig))).rejects.toMatchObject({kind: 'bad-request', retryable: false});
        expect(fetchMock).not.toHaveBeenCalled();
        mockConfig.customHeaders = {'custom:other': '{"x-opencode-session":"other-session"}'};
        await translateWithOpenAICompatibleAiSdk(withProviderSnapshot({origin: 'hello'}, mockConfig));
        const headers = new Headers(fetchMock.mock.calls[0][1].headers);
        expect(headers.get('x-opencode-session')).toBeNull();
        expect(headers.get('authorization')).toBe('Bearer local-token');
    });

    it('服务错误回显的自定义头值不会出现在用户错误或请求 ID 中', async () => {
        mockConfig.customHeaders.custom = '{"x-gateway-auth":"gateway-private-sentinel"}';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            error: {message: 'rejected gateway-private-sentinel', code: 'gateway-private-sentinel'},
        }), {status: 400, headers: {'content-type': 'application/json', 'x-request-id': 'gateway-private-sentinel'}})));
        try {
            await translateWithOpenAICompatibleAiSdk(withProviderSnapshot({origin: 'hello'}, mockConfig));
            expect.fail('must reject');
        } catch (error) {
            expect(String(error)).not.toContain('gateway-private-sentinel');
            expect(JSON.stringify(error)).not.toContain('gateway-private-sentinel');
        }
    });

});

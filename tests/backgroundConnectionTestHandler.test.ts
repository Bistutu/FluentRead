import {describe, expect, it, vi} from 'vitest';

import {
    CONNECTION_TEST_MESSAGE_TYPE,
    createConnectionTestHandler,
} from '@/src/app/background/handlers/connectionTest';
import {createBackgroundMessageRouter} from '@/src/services/messaging/backgroundRouter';

describe('background connection test handler', () => {
    it('免费池检查显式转交单服务标识，并拒绝未知或非免费池请求', async () => {
        const runConnectionTest = vi.fn(async () => ({durationMs: 12}));
        const handler = createConnectionTestHandler({ready: Promise.resolve(), runConnectionTest,
            formatError: (_service, error) => (error as Error).message});
        await expect(handler.handle({type: CONNECTION_TEST_MESSAGE_TYPE, service: 'freeTranslation', freeProviderId: 'transmart'}, undefined))
            .resolves.toEqual({success: true, durationMs: 12});
        expect(runConnectionTest).toHaveBeenCalledWith('freeTranslation', undefined, undefined, 'transmart');
        for (const [service, freeProviderId] of [['google', 'transmart'], ['freeTranslation', 'unknown'], ['freeTranslation', null]]) {
            await expect(handler.handle({type: CONNECTION_TEST_MESSAGE_TYPE, service, freeProviderId}, undefined))
                .resolves.toEqual({success: false, error: '无效的免费翻译服务'});
        }
        expect(runConnectionTest).toHaveBeenCalledOnce();
    });
    it('逐项检测只转交合法的原始 Key 行索引', async () => {
        const runConnectionTest = vi.fn(async () => ({durationMs: 1}));
        const handler = createConnectionTestHandler({ready: Promise.resolve(), runConnectionTest,
            formatError: (_service, error) => (error as Error).message});
        await expect(handler.handle({type: CONNECTION_TEST_MESSAGE_TYPE, service: 'demo', keyIndex: 2}, undefined))
            .resolves.toEqual({success: true, durationMs: 1});
        expect(runConnectionTest).toHaveBeenCalledWith('demo', 2);
        for (const keyIndex of [-1, 0.5, '1', null, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
            await expect(handler.handle({type: CONNECTION_TEST_MESSAGE_TYPE, service: 'demo', keyIndex}, undefined))
                .resolves.toEqual({success: false, error: '连接测试 Key 序号无效'});
        }
        expect(runConnectionTest).toHaveBeenCalledOnce();
    });

    it('转交可选的配置指纹并拒绝非法格式', async () => {
        const runConnectionTest = vi.fn(async () => ({durationMs: 1}));
        const handler = createConnectionTestHandler({ready: Promise.resolve(), runConnectionTest,
            formatError: (_service, error) => (error as Error).message});
        const revision = 'a'.repeat(64);
        await expect(handler.handle({type: CONNECTION_TEST_MESSAGE_TYPE, service: 'demo', keyIndex: 1, keyRevision: revision}, undefined))
            .resolves.toEqual({success: true, durationMs: 1});
        expect(runConnectionTest).toHaveBeenCalledWith('demo', 1, revision);
        await expect(handler.handle({type: CONNECTION_TEST_MESSAGE_TYPE, service: 'demo', keyIndex: 1, keyRevision: 'bad'}, undefined))
            .resolves.toEqual({success: false, error: '连接测试配置版本无效'});
    });
    it('等待配置 ready 后执行 provider 连接测试', async () => {
        const runConnectionTest = vi.fn(async () => ({durationMs: 25}));
        const formatError = vi.fn((service: string, error: unknown) => `${service}:${String(error)}`);
        const router = createBackgroundMessageRouter([
            createConnectionTestHandler({
                ready: Promise.resolve(),
                runConnectionTest,
                formatError,
            }),
        ]);

        await expect(router.dispatch({
            type: CONNECTION_TEST_MESSAGE_TYPE,
            service: 'demo',
        }, undefined)).resolves.toEqual({
            handled: true,
            response: {success: true, durationMs: 25},
        });
        expect(runConnectionTest).toHaveBeenCalledWith('demo');
        expect(formatError).not.toHaveBeenCalled();
    });

    it('provider 失败时使用现有格式化器返回错误响应', async () => {
        const failure = new Error('provider down');
        const runConnectionTest = vi.fn(async () => { throw failure; });
        const formatError = vi.fn((service: string, error: unknown) => `${service}:${(error as Error).message}`);
        const handler = createConnectionTestHandler({
            ready: Promise.resolve(),
            runConnectionTest,
            formatError,
        });

        await expect(handler.handle({
            type: CONNECTION_TEST_MESSAGE_TYPE,
            service: 'demo',
        }, undefined)).resolves.toEqual({success: false, error: 'demo:provider down'});
        expect(formatError).toHaveBeenCalledWith('demo', failure);
    });

    it('配置初始化失败时仍按目标 service 格式化', async () => {
        const readyFailure = new Error('config unavailable');
        const formatError = vi.fn((service: string, error: unknown) => `${service}:${(error as Error).message}`);
        const handler = createConnectionTestHandler({
            ready: Promise.reject(readyFailure),
            runConnectionTest: vi.fn(),
            formatError,
        });

        await expect(handler.handle({
            type: CONNECTION_TEST_MESSAGE_TYPE,
            service: 'demo',
        }, undefined)).resolves.toEqual({success: false, error: 'demo:config unavailable'});
    });

    it.each([
        undefined,
        '',
        '   ',
        42,
    ])('拒绝非法 service payload %# 且不进入 provider', async (service) => {
        const runConnectionTest = vi.fn();
        const formatError = vi.fn((serviceName: string, error: unknown) => `${serviceName}:${(error as Error).message}`);
        const handler = createConnectionTestHandler({
            ready: Promise.resolve(),
            runConnectionTest,
            formatError,
        });

        await expect(handler.handle({
            type: CONNECTION_TEST_MESSAGE_TYPE,
            service,
        }, undefined)).resolves.toEqual({
            success: false,
            error: ':连接测试 service 必须是非空字符串',
        });
        expect(runConnectionTest).not.toHaveBeenCalled();
    });
});

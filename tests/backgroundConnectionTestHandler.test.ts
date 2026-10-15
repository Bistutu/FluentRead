import {describe, expect, it, vi} from 'vitest';

import {
    CONNECTION_TEST_MESSAGE_TYPE,
    createConnectionTestHandler,
} from '@/src/app/background/handlers/connectionTest';
import {diagnoseFailure, getDiagnosticText} from '@/src/services/diagnostics';
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
                .resolves.toEqual({success: false, error: getDiagnosticText({code: 'configuration'}).title, diagnostic: diagnoseFailure(null, {reason: 'configuration'})});
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
                .resolves.toEqual({success: false, error: getDiagnosticText({code: 'configuration'}).title, diagnostic: diagnoseFailure(null, {reason: 'configuration'})});
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
            .resolves.toEqual({success: false, error: getDiagnosticText({code: 'configuration'}).title, diagnostic: diagnoseFailure(null, {reason: 'configuration'})});
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

    it('provider 未分类失败时只用现有格式化器归因，并返回固定安全错误响应', async () => {
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
        }, undefined)).resolves.toEqual({success: false, error: getDiagnosticText({code: 'unknown'}).title, diagnostic: diagnoseFailure(failure)});
        expect(formatError).toHaveBeenCalledWith('demo', failure);
    });

    it('兼容错误格式化器自身抛错仍返回固定安全失败响应', async () => {
        const handler = createConnectionTestHandler({ready: Promise.resolve(),
            runConnectionTest: async () => {throw new Error('private-unknown-failure')},
            formatError: () => {throw new Error('private-formatting-failure')},
        });
        await expect(handler.handle({type: CONNECTION_TEST_MESSAGE_TYPE, service: 'demo'}, undefined))
            .resolves.toEqual({success: false, error: getDiagnosticText({code: 'unknown'}).title, diagnostic: diagnoseFailure(null)});
    });

    it('配置初始化失败安全归因为配置尚未保存', async () => {
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
        }, undefined)).resolves.toEqual({success: false, error: getDiagnosticText({code: 'configuration-save'}).title, diagnostic: diagnoseFailure(null, {reason: 'configuration-save'})});
        expect(formatError).not.toHaveBeenCalled();
    });

    it.each([
        {kind: 'authentication', status: 401, expected: 'authentication'},
        {kind: 'rate-limit', status: 429, retryAfterMs: 1200, expected: 'rate-limit'},
        {kind: 'timeout', status: 504, expected: 'timeout'},
        {kind: 'bad-request', status: 400, expected: 'model-configuration'},
    ])('保留结构化 $kind 原因和安全冷却元数据，不返回私有详情', async ({expected, ...metadata}) => {
        const failure = Object.assign(new Error('invalid model request Authorization Bearer fixture-private-key body: private text https://private.example/private?token=fixture'), metadata);
        const formatError = vi.fn(() => 'private formatted text');
        const handler = createConnectionTestHandler({ready: Promise.resolve(), runConnectionTest: async () => {throw failure}, formatError});
        const response = await handler.handle({type: CONNECTION_TEST_MESSAGE_TYPE, service: 'demo'}, undefined);
        expect(response).toEqual({success: false, error: getDiagnosticText({code: expected as 'authentication'}).title, diagnostic: diagnoseFailure(failure)});
        expect(JSON.stringify(response)).not.toMatch(/private|Authorization|Bearer|fixture/u);
        expect(formatError).not.toHaveBeenCalled();
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
            error: getDiagnosticText({code: 'configuration'}).title,
            diagnostic: diagnoseFailure(null, {reason: 'configuration'}),
        });
        expect(runConnectionTest).not.toHaveBeenCalled();
    });
});

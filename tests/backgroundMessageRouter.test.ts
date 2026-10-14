import {describe, expect, it, vi} from 'vitest';

import {
    createBackgroundMessageRouter,
    createBackgroundRuntimeMessageListener,
    type BackgroundFallbackHandler,
    type BackgroundMessageHandler,
} from '@/src/services/messaging/backgroundRouter';

interface TestContext {
    prefix: string;
}

describe('background message router', () => {
    it('按 type 分发同步与异步 handler，并透传上下文', async () => {
        const sync: BackgroundMessageHandler<TestContext> = {
            type: 'sync',
            handle: (message, context) => `${context.prefix}:${message.type}`,
        };
        const asyncHandler: BackgroundMessageHandler<TestContext> = {
            type: 'async',
            handle: async (_message, context) => ({value: context.prefix}),
        };
        const router = createBackgroundMessageRouter([sync, asyncHandler]);

        await expect(router.dispatch({type: 'sync'}, {prefix: 'ctx'})).resolves.toEqual({
            handled: true,
            response: 'ctx:sync',
        });
        await expect(router.dispatch({type: 'async'}, {prefix: 'ctx'})).resolves.toEqual({
            handled: true,
            response: {value: 'ctx'},
        });
    });

    it('未知或无效消息只在类型守卫通过时进入 fallback', async () => {
        const fallback: BackgroundFallbackHandler<TestContext, {origin: string}> = {
            canHandle: (message): message is {origin: string} => Boolean(
                message
                && typeof message === 'object'
                && typeof (message as {origin?: unknown}).origin === 'string',
            ),
            handle: (message, context) => `${context.prefix}:${message.origin}`,
        };
        const router = createBackgroundMessageRouter([], fallback);

        await expect(router.dispatch({origin: 'text'}, {prefix: 'translate'})).resolves.toEqual({
            handled: true,
            response: 'translate:text',
        });
        await expect(router.dispatch(null, {prefix: 'translate'})).resolves.toEqual({handled: false});
        await expect(router.dispatch({type: 42}, {prefix: 'translate'})).resolves.toEqual({handled: false});
        await expect(router.dispatch({type: 'unknown'}, {prefix: 'translate'})).resolves.toEqual({handled: false});
    });

    it('普通 handler 优先于 fallback', async () => {
        const fallback = {
            canHandle: vi.fn(() => true),
            handle: vi.fn(() => 'fallback'),
        } as unknown as BackgroundFallbackHandler<TestContext, unknown>;
        const router = createBackgroundMessageRouter([{
            type: 'known',
            handle: () => 'handler',
        }], fallback);

        await expect(router.dispatch({type: 'known'}, {prefix: 'ctx'})).resolves.toEqual({
            handled: true,
            response: 'handler',
        });
        expect(fallback.canHandle).not.toHaveBeenCalled();
        expect(fallback.handle).not.toHaveBeenCalled();
    });

    it('重复注册同一 type 时在启动阶段失败', () => {
        expect(() => createBackgroundMessageRouter<TestContext>([
            {type: 'duplicate', handle: vi.fn()},
            {type: 'duplicate', handle: vi.fn()},
        ])).toThrow('后台消息处理器重复注册: duplicate');
    });

    it('handler 与 fallback 的错误原样向 entrypoint 传播', async () => {
        const handlerError = new Error('handler failed');
        const fallbackError = new Error('fallback failed');
        const router = createBackgroundMessageRouter<TestContext>([
            {type: 'broken', handle: () => { throw handlerError; }},
        ], {
            canHandle: (message): message is unknown => message === 'fallback',
            handle: async () => { throw fallbackError; },
        });

        await expect(router.dispatch({type: 'broken'}, {prefix: 'ctx'})).rejects.toBe(handlerError);
        await expect(router.dispatch('fallback', {prefix: 'ctx'})).rejects.toBe(fallbackError);
    });

    it('runtime 监听器按 sender 构造上下文，并把未知消息与异常统一序列化为失败回复', async () => {
        const router = createBackgroundMessageRouter<{sender: unknown}>([
            {type: 'echo', handle: (_message, context) => context.sender},
            {type: 'coded', handle: () => { throw Object.assign(new Error('model missing'), {code: 'local-tts-model-not-downloaded'}); }},
            {type: 'numeric-code', handle: () => { throw Object.assign(new Error('numeric'), {code: 42}); }},
            {type: 'primitive', handle: () => { throw 'plain failure'; }},
        ]);
        const listener = createBackgroundRuntimeMessageListener(router, (sender) => ({sender}));
        const sender = {tab: {id: 3}};

        await expect(listener({type: 'echo'}, sender)).resolves.toBe(sender);
        await expect(listener({type: 'unknown'}, sender)).resolves.toEqual({success: false, error: '不支持的后台消息'});
        await expect(listener({type: 'coded'}, sender)).resolves.toEqual({
            success: false, error: 'model missing', errorCode: 'local-tts-model-not-downloaded',
        });
        await expect(listener({type: 'numeric-code'}, sender)).resolves.toEqual({success: false, error: 'numeric', errorCode: undefined});
        await expect(listener({type: 'primitive'}, sender)).resolves.toEqual({success: false, error: 'plain failure', errorCode: undefined});
    });
});

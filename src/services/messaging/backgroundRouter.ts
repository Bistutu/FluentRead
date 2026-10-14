/**
 * @file src/services/messaging/backgroundRouter.ts
 * 文件职责：提供与业务无关的类型化后台消息路由器，确保已注册消息、fallback 消息和未知消息具有确定性的分派结果。
 * 主要内容：定义 handler/fallback/context 泛型契约，从未知输入安全读取 type，维护按 type 索引的处理器 Map，并通过 dispatch 返回 handled、unhandled 或处理结果；
 * createBackgroundRuntimeMessageListener 统一未知消息与异常的通用失败回复，保留稳定 errorCode。
 * 模块边界：路由器不认识翻译、配置或词汇业务，不访问 browser.runtime，也不解释业务错误语义；应用组合根负责监听器注册和具体 handler 集合；feature 只消费这里的公共 handler 契约，不反向依赖 app。
 */
export interface BackgroundMessage {
    type: string;
}
export interface BackgroundMessageHandler<
    TContext,
    TMessage extends BackgroundMessage = BackgroundMessage,
    TResponse = unknown,
> {
    readonly type: TMessage['type'];
    handle(message: TMessage, context: TContext): TResponse | Promise<TResponse>;
}

export interface BackgroundFallbackHandler<TContext, TMessage, TResponse = unknown> {
    canHandle(message: unknown): message is TMessage;
    handle(message: TMessage, context: TContext): TResponse | Promise<TResponse>;
}

export type BackgroundDispatchResult =
    | {handled: false}
    | {handled: true; response: unknown};

function readMessageType(message: unknown): string | null {
    if (!message || typeof message !== 'object') return null;
    const type = (message as {type?: unknown}).type;
    return typeof type === 'string' ? type : null;
}

/**
 * 与 WXT/browser API 无关的后台消息注册表。
 *
 * entrypoint 负责接收和回复 runtime message；本类只负责静态 handler 查找、
 * fallback 路由和重复注册保护，因此可以独立单测并被 MV2/MV3 共用。
 */
export class BackgroundMessageRouter<TContext> {
    private readonly handlers = new Map<string, BackgroundMessageHandler<TContext>>();
    private readonly fallback?: BackgroundFallbackHandler<TContext, unknown>;

    constructor(
        handlers: readonly BackgroundMessageHandler<TContext>[],
        fallback?: BackgroundFallbackHandler<TContext, unknown>,
    ) {
        // 步骤 1：启动时建立静态索引；重复 type 属于编程错误，立即失败。
        for (const handler of handlers) {
            if (this.handlers.has(handler.type)) {
                throw new Error(`后台消息处理器重复注册: ${handler.type}`);
            }
            this.handlers.set(handler.type, handler);
        }
        this.fallback = fallback;
    }

    async dispatch(message: unknown, context: TContext): Promise<BackgroundDispatchResult> {
        // 步骤 1：有明确 type 且已注册时，交给对应 handler。
        const type = readMessageType(message);
        const handler = type === null ? undefined : this.handlers.get(type);
        if (handler) {
            const response = await handler.handle(message as BackgroundMessage, context);
            return {handled: true, response};
        }

        // 步骤 2：未命中普通 handler 时再尝试受类型守卫保护的兼容 fallback。
        if (this.fallback?.canHandle(message)) {
            const response = await this.fallback.handle(message, context);
            return {handled: true, response};
        }

        // 步骤 3：未知消息保持未处理，entrypoint 可以选择忽略或统一返回错误。
        return {handled: false};
    }
}

export function createBackgroundMessageRouter<TContext>(
    handlers: readonly BackgroundMessageHandler<TContext>[],
    fallback?: BackgroundFallbackHandler<TContext, unknown>,
): BackgroundMessageRouter<TContext> {
    return new BackgroundMessageRouter(handlers, fallback);
}

/** runtime.onMessage 的统一回复纪律：未处理消息和抛错都转成可跨上下文传输的失败结果。 */
export function createBackgroundRuntimeMessageListener<TContext>(
    router: BackgroundMessageRouter<TContext>,
    createContext: (sender: unknown) => TContext,
): (message: unknown, sender: unknown) => Promise<unknown> {
    return async (message, sender) => {
        try {
            const dispatch = await router.dispatch(message, createContext(sender));
            return dispatch.handled ? dispatch.response : {success: false, error: '不支持的后台消息'};
        } catch (error) {
            const code = error && typeof error === 'object' ? (error as {code?: unknown}).code : undefined;
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                errorCode: typeof code === 'string' ? code : undefined,
            };
        }
    };
}

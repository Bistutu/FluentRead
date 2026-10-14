/**
 * @file src/app/background/handlers/configHistory.ts
 * 文件职责：定义配置历史在后台消息总线中的类型化协议，并把撤销、重做和指定版本恢复动作适配成标准 BackgroundMessageHandler。
 * 主要内容：声明 configHistoryAction 消息、动作与成功/失败响应类型，校验 action 和 version，再委托注入的 applyConfigHistoryAction 执行并返回新配置。
 * 模块边界：本文件只负责消息解析和调用适配，不读写历史仓库、不决定版本冲突策略，也不持久化配置；历史事务由 services/config 中的协调器实现。
 */
import type {BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';

export const CONFIG_HISTORY_MESSAGE_TYPE = 'configHistoryAction' as const;

export type ConfigHistoryAction = 'undo' | 'redo' | 'restore';

export interface ConfigHistoryMessage {
    type: typeof CONFIG_HISTORY_MESSAGE_TYPE;
    action?: unknown;
    version?: unknown;
}
export type ConfigHistoryResponse<T> =
    | {success: true; history: T}
    | {success: false; error: string};

export type ApplyConfigHistoryAction<T> = (
    action: ConfigHistoryAction,
    version?: number,
) => Promise<T>;

/** 创建配置历史 handler；配置存储与历史栈由 service 依赖实现。 */
export function createConfigHistoryHandler<T>(
    applyConfigHistoryAction: ApplyConfigHistoryAction<T>,
): BackgroundMessageHandler<unknown, ConfigHistoryMessage, ConfigHistoryResponse<T>> {
    return {
        type: CONFIG_HISTORY_MESSAGE_TYPE,
        async handle(message) {
            // 步骤 1：在后台信任边界把未知 action 收窄为明确的历史操作。
            const action = message.action === 'undo'
                || message.action === 'redo'
                || message.action === 'restore'
                ? message.action
                : null;
            if (!action) return {success: false, error: '无效的配置历史操作'};

            // 步骤 2：只有有限数字版本才向 service 传递，其余值按“当前版本”处理。
            const version = typeof message.version === 'number' && Number.isFinite(message.version)
                ? message.version
                : undefined;
            const history = await applyConfigHistoryAction(action, version);
            return {success: true, history};
        },
    };
}

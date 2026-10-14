/**
 * @file src/app/background/handlers/configCount.ts
 * 文件职责：接收翻译调用产生的计数增量消息，以独立协议触发后台原子计数更新，避免提交陈旧的整份配置。
 * 主要内容：声明计数消息与响应类型，复用 services/config/count 的增量解析规则，并把合法增量交给注入的串行更新函数。
 * 模块边界：本文件不保存配置、不创建历史快照，也不决定计数上限；协议常量和纯校验位于 service，实际持久化由配置 store 执行。
 */
import {
    CONFIG_COUNT_INCREMENT_MESSAGE,
    parseConfigCountIncrement,
    parseConfigCountOperationId,
} from '@/src/services/config/count';
import type {BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';

export interface ConfigCountIncrementMessage {
    type: typeof CONFIG_COUNT_INCREMENT_MESSAGE;
    delta?: unknown;
    operationId?: unknown;
}

export type ConfigCountIncrementResponse =
    | {success: true; count: number}
    | {success: false; error: string};

export function createConfigCountIncrementHandler(
    incrementConfigCount: (delta: number, operationId: string) => Promise<number>,
): BackgroundMessageHandler<unknown, ConfigCountIncrementMessage, ConfigCountIncrementResponse> {
    return {
        type: CONFIG_COUNT_INCREMENT_MESSAGE,
        async handle(message) {
            const delta = parseConfigCountIncrement(message.delta);
            if (delta === null) return {success: false, error: '无效的翻译计数增量'};
            const operationId = parseConfigCountOperationId(message.operationId);
            if (operationId === null) return {success: false, error: '无效的翻译计数操作标识'};
            return {success: true, count: await incrementConfigCount(delta, operationId)};
        },
    };
}

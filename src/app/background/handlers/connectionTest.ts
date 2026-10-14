/**
 * @file src/app/background/handlers/connectionTest.ts
 * 文件职责：为设置页的翻译服务连通性检查提供后台消息适配器，在调用 provider 前形成明确、可序列化的输入输出契约。
 * 主要内容：定义 testTranslationService 消息与成功/失败响应，验证服务、Key 行及免费池候选标识，调用注入的测试能力，并通过 formatError 把异常转换成面向 UI 的错误文本。
 * 模块边界：本文件不发起网络请求、不读取凭据，也不识别具体供应商协议；连接测试实现和错误格式化由 providers 层注入，message runtime 负责注册。
 */
import type {BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';
import {isFreeTranslationProviderId, type FreeTranslationProviderId} from '@/src/core/config/freeTranslation';

export const CONNECTION_TEST_MESSAGE_TYPE = 'testTranslationService' as const;

export interface ConnectionTestMessage {
    type: typeof CONNECTION_TEST_MESSAGE_TYPE;
    service?: unknown;
    keyIndex?: unknown;
    keyRevision?: unknown;
    freeProviderId?: unknown;
}

export type ConnectionTestResponse =
    | {success: true; durationMs: number}
    | {success: false; error: string};

export interface ConnectionTestDependencies {
    readonly ready: Promise<void>;
    readonly runConnectionTest: (service: string, keyIndex?: number, keyRevision?: string, freeProviderId?: FreeTranslationProviderId) => Promise<{durationMs: number}>;
    readonly formatError: (service: string, error: unknown) => string;
}

function parseService(value: unknown): string {
    if (typeof value === 'string' && value.trim()) return value;
    throw new TypeError('连接测试 service 必须是非空字符串');
}

/** 创建 provider 连接测试 handler；错误在本 handler 内格式化，保持旧后台响应协议。 */
export function createConnectionTestHandler(
    dependencies: ConnectionTestDependencies,
): BackgroundMessageHandler<unknown, ConnectionTestMessage, ConnectionTestResponse> {
    return {
        type: CONNECTION_TEST_MESSAGE_TYPE,
        async handle(message) {
            let service = '';
            try {
                // 步骤 1：后台边界先收窄服务 ID，避免非法 payload 进入 provider registry。
                service = parseService(message.service);
                if (message.freeProviderId !== undefined && (service !== 'freeTranslation' || !isFreeTranslationProviderId(message.freeProviderId))) {
                    throw new TypeError('无效的免费翻译服务');
                }
                if (message.keyIndex !== undefined && (
                    typeof message.keyIndex !== 'number' || !Number.isSafeInteger(message.keyIndex) || message.keyIndex < 0
                )) throw new TypeError('连接测试 Key 序号无效');
                if (message.keyRevision !== undefined && (
                    typeof message.keyRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(message.keyRevision)
                )) throw new TypeError('连接测试配置版本无效');
                await dependencies.ready;

                // 步骤 2：provider 测试失败时使用现有格式化器返回用户可读错误。
                const result = message.freeProviderId !== undefined
                    ? await dependencies.runConnectionTest(service, undefined, undefined, message.freeProviderId as FreeTranslationProviderId)
                    : message.keyRevision === undefined
                    ? message.keyIndex === undefined
                        ? await dependencies.runConnectionTest(service)
                        : await dependencies.runConnectionTest(service, message.keyIndex as number)
                    : await dependencies.runConnectionTest(
                        service,
                        message.keyIndex as number | undefined,
                        message.keyRevision as string,
                    );
                return {success: true, ...result};
            } catch (error) {
                return {success: false, error: dependencies.formatError(service, error)};
            }
        },
    };
}

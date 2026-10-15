/**
 * @file src/services/config/protocol.ts
 * 文件职责：声明配置权威端、短生命周期客户端及历史操作共用的消息与提交契约。
 * 主要内容：保留既有消息字面量、revision、序列、字段 CAS 与显式凭据意图，不在跨上下文边界传递存储或运行时对象。
 * 模块边界：只持有协议常量和类型，不初始化配置、存储、浏览器或页面。
 */
import type {Config} from '@/src/core/config/model';
import type {ConfigCredentials} from '@/src/core/config/credentials';
import type {ConfigImportCredentialBindings} from '@/src/core/config/transfer';
import {CONFIG_COUNT_INCREMENT_MESSAGE} from './count';
import type {ConfigHistoryAction, ConfigHistoryState} from './history';

export const CONFIG_STORAGE_KEY = 'local:config' as const;
export const CONFIG_PERSIST_MESSAGE = 'persistConfig' as const;
export const CONFIG_PERSIST_BATCH_MESSAGE = 'persistConfigBatch' as const;
export const CONFIG_HISTORY_MESSAGE = 'configHistoryAction' as const;

export type ConfigPersistenceMode = 'replace' | 'patch';

export type ConfigCredentialIntent = 'changed-fields' | 'exact';

export interface StoredConfigChangeOptions {
    confirmedRequestRevision?: number;
    confirmedRequestSerialized?: string;
    confirmedRequestSequence?: number;
    confirmedRequestCredentials?: ConfigCredentials;
}

export type ConfigCountMessageResponse = {success?: boolean; error?: string; count?: number} | undefined;

export type ConfigCountMessageSender = (message: {
    type: typeof CONFIG_COUNT_INCREMENT_MESSAGE;
    delta: number;
    operationId: string;
}) => Promise<ConfigCountMessageResponse>;

export interface SaveConfigOptions {
    recordHistory?: boolean;
    immediateHistory?: boolean;
}

export type ConfigMessageResponse = { success?: boolean; error?: string; revision?: number } | undefined;

export type ConfigMessageSender = (message: {
    type: typeof CONFIG_PERSIST_MESSAGE;
    mode?: ConfigPersistenceMode;
    config: Config;
    expected?: Config;
    clientId: string;
    sequence: number;
    baseRevision: number;
}) => Promise<ConfigMessageResponse>;

export interface ConfigPatchBatchMessage {
    type: typeof CONFIG_PERSIST_BATCH_MESSAGE;
    clientId: string;
    patches: Array<{
        sequence: number;
        config: Record<string, unknown>;
        expected: Record<string, unknown>;
    }>;
}

export interface ConfigMutationRequest {
    mode: ConfigPersistenceMode;
    normalized: Config;
    messageConfig: Config | Record<string, unknown>;
    messageExpected?: Record<string, unknown>;
    credentialIntent?: ConfigCredentialIntent;
    importedCredentialBindings?: ConfigImportCredentialBindings;
}

export interface RequestConfigSaveOptions {
    credentialIntent?: ConfigCredentialIntent;
}

export type ConfigHistoryMessageResponse = {success?: boolean; error?: string; history?: ConfigHistoryState} | undefined;

export type ConfigHistoryMessageSender = (message: {
    type: typeof CONFIG_HISTORY_MESSAGE;
    action: ConfigHistoryAction;
    version?: number;
}) => Promise<ConfigHistoryMessageResponse>;

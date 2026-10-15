/**
 * @file src/services/config/store.ts
 * 文件职责：绑定平台存储与可信上下文，组装当前运行时唯一的默认配置应用并提供稳定服务出口。
 * 主要内容：明确启动配置权威水合，公开既有配置、提交、历史和计数 API 以及不携带异常或凭据的只读水合状态；权威端、客户端、历史和纯字段策略各自拥有状态及实现。
 * 模块边界：本文件只做默认 composition，保持既有导入即启动语义以兼容入口；测试和可复用编排通过 application 工厂显式创建、启动实例，不初始化浏览器或平行 store。
 */
import {configStorage} from '@/src/platform/storage/configStorageRuntime';
import {isTrustedCredentialStorageContext} from '@/src/platform/storage/credentialContext';
import {createConfigApplication} from './application';

const application = createConfigApplication({storage: configStorage, trustedContext: isTrustedCredentialStorageContext()});
export const {config, configReady, getConfigHydrationStatus, configHistoryReady, subscribeConfig, getConfigRevision, prepareHydratedConfigForExport, prepareConfigSaveRequest, prepareConfigPatchRequest, saveConfig, incrementConfigCount, waitForConfigPersistenceQueue, getConfigHistorySnapshot, subscribeConfigHistory, flushConfigHistory, applyConfigHistoryAction, requestConfigSave, requestConfigPatch, requestConfigCountIncrement, requestConfigHistoryAction, handoffPendingConfigPatches} = application;
void application.start();

export {CONFIG_STORAGE_KEY, CONFIG_PERSIST_MESSAGE, CONFIG_PERSIST_BATCH_MESSAGE, CONFIG_HISTORY_MESSAGE} from './protocol';
export type {ConfigHydrationStatus} from './application';
export type {SaveConfigOptions, RequestConfigSaveOptions, ConfigPatchBatchMessage} from './protocol';
export {CONFIG_HISTORY_STORAGE_KEY} from './historyRuntime';
export {CONFIG_HISTORY_LIMIT} from './history';
export type {ConfigHistoryAction, ConfigHistoryEntry, ConfigHistoryState} from './history';
export {parseStoredConfig, serializeConfig} from './schema';

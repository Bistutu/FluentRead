/**
 * @file src/app/background/handlers/modelUsage.ts
 * 文件职责：为设置页提供类型化的大模型聚合、请求日志、导入导出与独立重置后台消息协议。
 * 主要内容：校验 query/list/export/import/reset 动作、筛选、游标、指定页时间边界和分页上限，调用注入仓库并把成功或存储错误转换成可传输响应。
 * 模块边界：本文件不直接访问 IndexedDB、不记录 provider 请求，也不处理图表渲染；仓库和采集器由后台组合根注入。
 */

import type {BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';
import {
    MODEL_USAGE_REQUEST_MAX_PAGE_SIZE,
    MODEL_USAGE_MAX_STORED_EVENTS,
    type DashboardSnapshot,
    type Filter,
    type ModelUsageImportResult,
    type ModelUsageCacheStatus,
    type ModelUsageOutcome,
    type ModelUsagePurpose,
    type ModelUsageRequestFilter,
    type ModelUsageRequestPage,
    type ModelUsageRequestQuery,
    type ModelUsageTransferDocument,
    type Range,
} from '@/src/services/model-usage/types';
import type {ConfigPersistenceContext} from './configPersistence';

export const MODEL_USAGE_MESSAGE_TYPE = 'modelUsage' as const;

export interface ModelUsageQueryMessage {
    type: typeof MODEL_USAGE_MESSAGE_TYPE;
    action: 'query';
    filter?: unknown;
}

export interface ModelUsageResetMessage {
    type: typeof MODEL_USAGE_MESSAGE_TYPE;
    action: 'reset';
}

export interface ModelUsageListMessage {
    type: typeof MODEL_USAGE_MESSAGE_TYPE;
    action: 'list';
    query?: unknown;
}

export interface ModelUsageExportMessage {
    type: typeof MODEL_USAGE_MESSAGE_TYPE;
    action: 'export';
}

export interface ModelUsageImportMessage {
    type: typeof MODEL_USAGE_MESSAGE_TYPE;
    action: 'import';
    document?: unknown;
}

export type ModelUsageMessage = ModelUsageQueryMessage
    | ModelUsageListMessage
    | ModelUsageExportMessage
    | ModelUsageImportMessage
    | ModelUsageResetMessage
    | {
    type: typeof MODEL_USAGE_MESSAGE_TYPE;
    action?: unknown;
    filter?: unknown;
    query?: unknown;
    document?: unknown;
};

export type ModelUsageResponse =
    | {success: true; data: DashboardSnapshot}
    | {success: true; data: ModelUsageRequestPage}
    | {success: true; data: ModelUsageTransferDocument}
    | {success: true; data: ModelUsageImportResult}
    | {success: true; data: {cleared: true}}
    | {success: false; error: string};

export interface ModelUsageRepositoryContract {
    getDashboard(filter: Filter): Promise<DashboardSnapshot>;
    getRequestLog(query: ModelUsageRequestQuery): Promise<ModelUsageRequestPage>;
    exportData(): Promise<ModelUsageTransferDocument>;
    importData(document: unknown): Promise<ModelUsageImportResult>;
    clear(): Promise<void>;
}

const VALID_RANGES = new Set<Range>(['today', '7d', '30d']);
const MAX_FILTER_LENGTH = 200;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const VALID_PURPOSES = new Set<ModelUsagePurpose>(['translation', 'page-summary', 'connection-test', 'reading', 'writing']);
const VALID_OUTCOMES = new Set<ModelUsageOutcome>(['success', 'error', 'timeout', 'cancelled']);
const VALID_CACHE_STATUSES = new Set<ModelUsageCacheStatus>(['hit', 'miss', 'unreported']);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function optionalFilterText(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new TypeError(`模型用量筛选 ${field} 必须是字符串`);
    const normalized = value.trim();
    if (!normalized || normalized.length > MAX_FILTER_LENGTH) {
        throw new TypeError(`模型用量筛选 ${field} 无效`);
    }
    return normalized;
}

export function parseModelUsageFilter(value: unknown): Filter {
    if (value === undefined) return {range: '30d'};
    if (!isPlainRecord(value)) throw new TypeError('模型用量筛选必须是对象');
    if (!VALID_RANGES.has(value.range as Range)) {
        throw new TypeError('模型用量筛选 range 无效');
    }
    const serviceId = optionalFilterText(value.serviceId, 'serviceId');
    const model = optionalFilterText(value.model, 'model');
    return {
        range: value.range as Range,
        ...(serviceId ? {serviceId} : {}),
        ...(model ? {model} : {}),
    };
}

function optionalRequestEnum<T extends string>(
    value: unknown,
    field: string,
    values: ReadonlySet<T>,
): T | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !values.has(value as T)) {
        throw new TypeError(`模型用量请求筛选 ${field} 无效`);
    }
    return value as T;
}

export function parseModelUsageRequestFilter(value: unknown): ModelUsageRequestFilter {
    const base = parseModelUsageFilter(value);
    if (value === undefined) return base;
    const record = value as Record<string, unknown>;
    const purpose = optionalRequestEnum(record.purpose, 'purpose', VALID_PURPOSES);
    const outcome = optionalRequestEnum(record.outcome, 'outcome', VALID_OUTCOMES);
    const cacheStatus = optionalRequestEnum(record.cacheStatus, 'cacheStatus', VALID_CACHE_STATUSES);
    return {
        ...base,
        ...(purpose ? {purpose} : {}),
        ...(outcome ? {outcome} : {}),
        ...(cacheStatus ? {cacheStatus} : {}),
    };
}

export function parseModelUsageRequestQuery(value: unknown): ModelUsageRequestQuery {
    if (value === undefined) return {filter: {range: '30d'}};
    if (!isPlainRecord(value)) throw new TypeError('模型用量请求查询必须是对象');
    const filter = parseModelUsageRequestFilter(value.filter);
    let cursor: ModelUsageRequestQuery['cursor'];
    if (value.cursor !== undefined) {
        if (!isPlainRecord(value.cursor)) throw new TypeError('模型用量请求游标必须是对象');
        const startedAt = value.cursor.startedAt;
        const id = value.cursor.id;
        if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt < 0 || startedAt > MAX_TIMESTAMP) {
            throw new TypeError('模型用量请求游标 startedAt 无效');
        }
        if (typeof id !== 'string' || !id || id.length > MAX_FILTER_LENGTH || !/^[A-Za-z0-9._:-]+$/u.test(id)) {
            throw new TypeError('模型用量请求游标 id 无效');
        }
        cursor = {startedAt, id};
    }
    let limit: number | undefined;
    if (value.offset !== undefined && (!Number.isInteger(value.offset) || (value.offset as number) < 0 || (value.offset as number) >= MODEL_USAGE_MAX_STORED_EVENTS)) {
        throw new TypeError(`模型用量请求 offset 必须是 0-${MODEL_USAGE_MAX_STORED_EVENTS - 1} 的整数`);
    }
    if (value.offset !== undefined && cursor) throw new TypeError('模型用量请求 offset 与 cursor 不能同时使用');
    if (value.asOf !== undefined && (typeof value.asOf !== 'number' || !Number.isFinite(value.asOf) || value.asOf < 0 || value.asOf > MAX_TIMESTAMP)) {
        throw new TypeError('模型用量请求 asOf 无效');
    }
    if (value.limit !== undefined) {
        if (!Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > MODEL_USAGE_REQUEST_MAX_PAGE_SIZE) {
            throw new TypeError(`模型用量请求 limit 必须是 1-${MODEL_USAGE_REQUEST_MAX_PAGE_SIZE} 的整数`);
        }
        limit = value.limit as number;
    }
    return {
        filter,
        ...(cursor ? {cursor} : {}),
        ...(value.offset !== undefined ? {offset: value.offset as number} : {}),
        ...(value.asOf !== undefined ? {asOf: value.asOf as number} : {}),
        ...(limit ? {limit} : {}),
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error && error.message.trim()
        ? error.message
        : '模型用量统计暂时不可用';
}

export function createModelUsageHandler(
    repository: ModelUsageRepositoryContract,
    isOptionsUrl: (url: string) => boolean,
): BackgroundMessageHandler<ConfigPersistenceContext, ModelUsageMessage, ModelUsageResponse> {
    return {
        type: MODEL_USAGE_MESSAGE_TYPE,
        async handle(message, context) {
            try {
                const senderUrl = typeof context.sender?.url === 'string' ? context.sender.url : '';
                if (!isOptionsUrl(senderUrl)) {
                    throw new Error('当前上下文无权访问模型用量数据');
                }
                if (message.action === 'query') {
                    return {success: true, data: await repository.getDashboard(parseModelUsageFilter(message.filter))};
                }
                if (message.action === 'list') {
                    return {success: true, data: await repository.getRequestLog(parseModelUsageRequestQuery(message.query))};
                }
                if (message.action === 'export') {
                    return {success: true, data: await repository.exportData()};
                }
                if (message.action === 'import') {
                    return {success: true, data: await repository.importData(message.document)};
                }
                if (message.action === 'reset') {
                    await repository.clear();
                    return {success: true, data: {cleared: true}};
                }
                return {success: false, error: '不支持的模型用量操作'};
            } catch (error) {
                return {success: false, error: errorMessage(error)};
            }
        },
    };
}

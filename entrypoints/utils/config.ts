import { storage } from '@wxt-dev/storage';
import { Config, normalizeConfig } from '@/entrypoints/utils/model';

export const CONFIG_STORAGE_KEY = 'local:config' as const;
export const CONFIG_HISTORY_STORAGE_KEY = 'local:configHistory' as const;
export const CONFIG_PERSIST_MESSAGE = 'persistConfig' as const;
export const CONFIG_HISTORY_MESSAGE = 'configHistoryAction' as const;
export const CONFIG_HISTORY_LIMIT = 5 as const;
const CONFIG_REVISION_FIELD = '__fluentConfigRevision';
const CONFIG_HISTORY_SCHEMA_VERSION = 1 as const;
const CONFIG_HISTORY_DEBOUNCE_MS = 350;

type ConfigListener = (nextConfig: Config) => void;

export type ConfigHistoryAction = 'undo' | 'redo' | 'restore';

export interface ConfigHistoryEntry {
    version: number;
    savedAt: string;
    config: Config;
}

export interface ConfigHistoryState {
    schemaVersion: typeof CONFIG_HISTORY_SCHEMA_VERSION;
    entries: ConfigHistoryEntry[];
    cursor: number;
    nextVersion: number;
}

type ConfigHistoryListener = (nextHistory: ConfigHistoryState) => void;

const listeners = new Set<ConfigListener>();
const historyListeners = new Set<ConfigHistoryListener>();
let storageRevision = 0;
let initialized = false;
let lastPersistedSerialized = '';
let writeRevision = 0;
let writeQueue: Promise<void> = Promise.resolve();
let latestRequestedSerialized = '';
let persistedConfigRevision = 0;
let requestSequence = 0;
const requestClientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let historyState: ConfigHistoryState;
let historyInitialized = false;
let historyLastSerialized = '';
let historyWriteRevision = 0;
let historyWriteQueue: Promise<void> = Promise.resolve();
let pendingHistorySnapshot: Config | null = null;
let pendingHistoryTimer: ReturnType<typeof setTimeout> | undefined;
let historyFlushPromise: Promise<void> | null = null;

// 所有运行时模块共享同一个可变配置对象；存储层负责把跨上下文变更同步进来。
export const config = new Config();

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getStoredRevision(value: unknown): number {
    if (!isRecord(value)) return 0;
    const revision = value[CONFIG_REVISION_FIELD];
    return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

export function parseStoredConfig(value: unknown): Record<string, unknown> | null {
    let parsed = value;

    if (typeof parsed === 'string') {
        if (!parsed.trim()) return null;
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return null;
        }
    }

    if (!isRecord(parsed)) return null;
    if (!['on', 'service', 'from', 'to'].every((key) => key in parsed)) return null;
    return parsed;
}

export function serializeConfig(value: unknown): string {
    return JSON.stringify(value);
}

function serializeHistory(value: ConfigHistoryState): string {
    return JSON.stringify(value);
}

function cloneHistoryState(value: ConfigHistoryState): ConfigHistoryState {
    return {
        schemaVersion: CONFIG_HISTORY_SCHEMA_VERSION,
        entries: value.entries.map((entry) => ({
            version: entry.version,
            savedAt: entry.savedAt,
            config: normalizeConfig(entry.config),
        })),
        cursor: value.cursor,
        nextVersion: value.nextVersion,
    };
}

function createBaselineHistory(): ConfigHistoryState {
    const version = Math.max(1, persistedConfigRevision || 1);
    return {
        schemaVersion: CONFIG_HISTORY_SCHEMA_VERSION,
        entries: [{
            version,
            savedAt: new Date().toISOString(),
            config: normalizeConfig(config),
        }],
        cursor: 0,
        nextVersion: version + 1,
    };
}

function parseHistory(value: unknown): ConfigHistoryState | null {
    if (!isRecord(value)) return null;
    const rawEntries = value.entries;
    if (!Array.isArray(rawEntries)) return null;

    const entries = rawEntries
        .map((entry) => {
            if (!isRecord(entry) || typeof entry.version !== 'number' || !Number.isSafeInteger(entry.version)) return null;
            if (typeof entry.savedAt !== 'string') return null;
            const parsedConfig = parseStoredConfig(entry.config);
            if (!parsedConfig) return null;
            return {
                version: entry.version,
                savedAt: entry.savedAt,
                config: normalizeConfig(parsedConfig),
            } satisfies ConfigHistoryEntry;
        })
        .filter((entry): entry is ConfigHistoryEntry => entry !== null)
        .slice(-CONFIG_HISTORY_LIMIT);

    if (entries.length === 0) return null;
    const rawCursor = typeof value.cursor === 'number' && Number.isSafeInteger(value.cursor) ? value.cursor : entries.length - 1;
    const cursor = Math.min(Math.max(rawCursor, 0), entries.length - 1);
    const maxVersion = entries.reduce((max, entry) => Math.max(max, entry.version), 0);
    const rawNextVersion = typeof value.nextVersion === 'number' && Number.isSafeInteger(value.nextVersion)
        ? value.nextVersion
        : maxVersion + 1;

    return {
        schemaVersion: CONFIG_HISTORY_SCHEMA_VERSION,
        entries,
        cursor,
        nextVersion: Math.max(rawNextVersion, maxVersion + 1),
    };
}

function notifyHistoryListeners(): void {
    if (!historyState) return;
    const snapshot = cloneHistoryState(historyState);
    historyListeners.forEach((listener) => listener(snapshot));
}

function setHistoryState(nextHistory: ConfigHistoryState): void {
    historyState = cloneHistoryState(nextHistory);
    historyLastSerialized = serializeHistory(historyState);
    notifyHistoryListeners();
}

function handleStoredHistoryChange(value: unknown): void {
    const parsed = parseHistory(value);
    if (!parsed) return;
    const serialized = serializeHistory(parsed);
    if (serialized === historyLastSerialized) return;
    setHistoryState(parsed);
}

async function queueHistoryWrite(nextHistory: ConfigHistoryState): Promise<void> {
    const serialized = serializeHistory(nextHistory);
    if (serialized === historyLastSerialized) return;

    historyLastSerialized = serialized;
    const revision = ++historyWriteRevision;
    historyWriteQueue = historyWriteQueue
        .catch(() => undefined)
        .then(async () => {
            if (revision !== historyWriteRevision || historyLastSerialized !== serialized) return;
            await storage.setItem<ConfigHistoryState>(CONFIG_HISTORY_STORAGE_KEY, nextHistory);
            historyState = cloneHistoryState(nextHistory);
            notifyHistoryListeners();
        });
    try {
        await historyWriteQueue;
    } catch (error) {
        if (historyLastSerialized === serialized) historyLastSerialized = serializeHistory(historyState);
        throw error;
    }
}

async function initializeConfigHistory(): Promise<void> {
    try {
        await configReady;
        const storedHistory = await storage.getItem<unknown>(CONFIG_HISTORY_STORAGE_KEY);
        const parsed = parseHistory(storedHistory);
        historyInitialized = true;
        if (parsed) {
            setHistoryState(parsed);
        } else {
            historyState = createBaselineHistory();
            historyLastSerialized = serializeHistory(historyState);
        }
    } catch (error) {
        historyInitialized = true;
        historyState = createBaselineHistory();
        historyLastSerialized = serializeHistory(historyState);
        console.error('[FluentRead] 配置历史读取失败，使用当前配置快照', error);
    }
}

async function appendHistorySnapshotNow(value: unknown): Promise<void> {
    await configHistoryReady;
    const normalized = normalizeConfig(value);
    const currentEntries = historyState.entries.slice(0, historyState.cursor + 1);
    const current = currentEntries[currentEntries.length - 1];
    if (current && serializeConfig(current.config) === serializeConfig(normalized)) return;

    let entries = [...currentEntries, {
        version: historyState.nextVersion,
        savedAt: new Date().toISOString(),
        config: normalized,
    }];
    if (entries.length > CONFIG_HISTORY_LIMIT) entries = entries.slice(-CONFIG_HISTORY_LIMIT);

    const nextHistory: ConfigHistoryState = {
        schemaVersion: CONFIG_HISTORY_SCHEMA_VERSION,
        entries,
        cursor: entries.length - 1,
        nextVersion: historyState.nextVersion + 1,
    };
    await queueHistoryWrite(nextHistory);
}

function scheduleHistorySnapshot(value: unknown): void {
    pendingHistorySnapshot = normalizeConfig(value);
    if (pendingHistoryTimer) clearTimeout(pendingHistoryTimer);
    pendingHistoryTimer = setTimeout(() => {
        pendingHistoryTimer = undefined;
        const snapshot = pendingHistorySnapshot;
        pendingHistorySnapshot = null;
        if (!snapshot) return;
        historyFlushPromise = appendHistorySnapshotNow(snapshot).finally(() => {
            historyFlushPromise = null;
        });
        void historyFlushPromise.catch((error) => console.error('[FluentRead] 配置历史保存失败', error));
    }, CONFIG_HISTORY_DEBOUNCE_MS);
}

export async function flushConfigHistory(): Promise<void> {
    if (pendingHistoryTimer) {
        clearTimeout(pendingHistoryTimer);
        pendingHistoryTimer = undefined;
        const snapshot = pendingHistorySnapshot;
        pendingHistorySnapshot = null;
        if (snapshot) {
            historyFlushPromise = appendHistorySnapshotNow(snapshot).finally(() => {
                historyFlushPromise = null;
            });
        }
    }
    await historyFlushPromise;
}

function notifyListeners(nextConfig: Config): void {
    const snapshot = normalizeConfig(nextConfig);
    listeners.forEach((listener) => listener(snapshot));
}

function applyConfig(nextConfig: Config): void {
    Object.assign(config, nextConfig);
    notifyListeners(config);
}

function queueStorageWrite(nextConfig: Config, serialized: string, revision: number, storedRevision: number): Promise<void> {
    writeQueue = writeQueue
        .catch(() => undefined)
        .then(async () => {
            // 只写最后一次快照，避免连续输入或多个页面初始化时排队回写旧配置。
            if (revision !== writeRevision || lastPersistedSerialized !== serialized) return;
            try {
                await storage.setItem<Config>(CONFIG_STORAGE_KEY, {
                    ...nextConfig,
                    [CONFIG_REVISION_FIELD]: storedRevision,
                } as Config);
            } catch (error) {
                if (lastPersistedSerialized === serialized) lastPersistedSerialized = '';
                throw error;
            }
        });
    return writeQueue;
}

async function persistNormalizedConfig(nextConfig: Config, serialized = serializeConfig(nextConfig)): Promise<void> {
    if (serialized === lastPersistedSerialized) return;

    lastPersistedSerialized = serialized;
    const revision = ++writeRevision;
    const storedRevision = ++persistedConfigRevision;
    await queueStorageWrite(nextConfig, serialized, revision, storedRevision);
}

function handleStoredConfigChange(value: unknown): void {
    storageRevision += 1;
    const parsed = parseStoredConfig(value);
    if (!parsed) return;

    const normalized = normalizeConfig(parsed);
    const serialized = serializeConfig(normalized);
    const storedRevision = getStoredRevision(parsed);
    if (storedRevision && storedRevision < persistedConfigRevision) return;
    if (storedRevision) persistedConfigRevision = storedRevision;
    // 同一个短生命周期页面可能在极短时间内产生多个快照。storage.watch
    // 可能先回传前一个快照，不能让它覆盖页面尚未完成发送的最新快照。
    if (latestRequestedSerialized && serialized !== latestRequestedSerialized) return;
    if (serialized === lastPersistedSerialized) return;

    // 外部上下文已经产生了新快照，使尚未写入的旧快照失效。
    writeRevision += 1;
    lastPersistedSerialized = serialized;
    applyConfig(normalized);
}

// 在首次读取前注册监听，避免设置页打开期间丢失其他上下文的更新。
storage.watch(CONFIG_STORAGE_KEY, handleStoredConfigChange);
storage.watch(CONFIG_HISTORY_STORAGE_KEY, handleStoredHistoryChange);

async function initializeConfig(): Promise<void> {
    try {
        let storedValue: unknown = null;

        // 读取过程中若收到 storage.onChanged，重新读取一次，避免旧读结果覆盖新配置。
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const revisionAtRead = storageRevision;
            storedValue = await storage.getItem<unknown>(CONFIG_STORAGE_KEY);
            if (revisionAtRead === storageRevision) break;
        }

        const parsed = parseStoredConfig(storedValue);
        const normalized = parsed ? normalizeConfig(parsed) : new Config();
        const serialized = serializeConfig(normalized);
        persistedConfigRevision = getStoredRevision(storedValue);

        initialized = true;
        applyConfig(normalized);

        // 兼容旧版 JSON 字符串、缺失字段和模型迁移；迁移只在初始化时写回一次。
        const storedSerialized = isRecord(storedValue) ? serializeConfig(storedValue) : '';
        if (!parsed || typeof storedValue === 'string' || storedSerialized !== serialized) {
            lastPersistedSerialized = '';
            await persistNormalizedConfig(normalized, serialized);
        } else {
            lastPersistedSerialized = serialized;
        }
    } catch (error) {
        // 存储 API 暂时不可用时仍提供默认配置，避免 Firefox 设置页因初始化 rejection 反复重载。
        console.error('[FluentRead] 配置读取失败，使用默认配置', error);
        const fallback = new Config();
        const serialized = serializeConfig(fallback);
        initialized = true;
        lastPersistedSerialized = '';
        applyConfig(fallback);
        try {
            await persistNormalizedConfig(fallback, serialized);
        } catch (saveError) {
            console.error('[FluentRead] 默认配置保存失败', saveError);
        }
    }
}

export const configReady = initializeConfig();
export const configHistoryReady = initializeConfigHistory();

export function subscribeConfig(listener: ConfigListener): () => void {
    listeners.add(listener);
    if (initialized) listener(normalizeConfig(config));
    return () => listeners.delete(listener);
}

export function getConfigSnapshot(): Config {
    return normalizeConfig(config);
}

export function getConfigHistorySnapshot(): ConfigHistoryState {
    return cloneHistoryState(historyState || createBaselineHistory());
}

export function subscribeConfigHistory(listener: ConfigHistoryListener): () => void {
    historyListeners.add(listener);
    if (historyInitialized && historyState) listener(cloneHistoryState(historyState));
    return () => historyListeners.delete(listener);
}

/**
 * 配置唯一写入口。调用方可以传入编辑中的快照，也可以省略参数保存运行时配置。
 * 写入前会归一化、去重，并串行淘汰旧快照，避免设置页和 popup 互相回灌。
 */
export interface SaveConfigOptions {
    recordHistory?: boolean;
    immediateHistory?: boolean;
}

export async function saveConfig(value: unknown = config, options: SaveConfigOptions = {}): Promise<void> {
    await configReady;

    const normalized = normalizeConfig(value);
    const serialized = serializeConfig(normalized);
    if (serializeConfig(config) !== serialized) applyConfig(normalized);
    await persistNormalizedConfig(normalized, serialized);
    if (options.recordHistory) {
        if (options.immediateHistory) {
            await flushConfigHistory();
            await appendHistorySnapshotNow(normalized);
        } else {
            scheduleHistorySnapshot(normalized);
        }
    }
}

/**
 * 从 popup/options 等短生命周期页面请求后台保存配置。
 * Firefox 可能在 popup 关闭时销毁页面上下文，不能依赖页面内的异步 storage.set 完成。
 */
type ConfigMessageResponse = { success?: boolean; error?: string } | undefined;
type ConfigMessageSender = (message: {
    type: typeof CONFIG_PERSIST_MESSAGE;
    config: Config;
    clientId: string;
    sequence: number;
}) => Promise<ConfigMessageResponse>;

export async function requestConfigSave(value: unknown = config, sendMessage?: ConfigMessageSender): Promise<void> {
    const normalized = normalizeConfig(value);
    const serialized = serializeConfig(normalized);
    latestRequestedSerialized = serialized;
    const sequence = ++requestSequence;
    try {
        if (!sendMessage) {
            await saveConfig(normalized, {recordHistory: true, immediateHistory: true});
            return;
        }

        try {
            const response = await sendMessage({
                type: CONFIG_PERSIST_MESSAGE,
                config: normalized,
                clientId: requestClientId,
                sequence,
            });

            if (response?.success === false) {
                throw new Error(response.error || '后台保存配置失败');
            }
        } catch (error) {
            // 页面端不排队等待上一条请求，确保 Firefox 关闭短生命周期页面前每条快照都已发往后台。
            // 后台负责串行落盘；这里只保留后台不可用时的降级路径。
            await saveConfig(normalized, {recordHistory: true, immediateHistory: true});
            if (error instanceof Error && !error.message.includes('Receiving end')) {
                console.warn('[FluentRead] 后台保存配置失败，已回退到当前上下文', error);
            }
        }
    } finally {
        if (latestRequestedSerialized === serialized) latestRequestedSerialized = '';
    }
}

export async function applyConfigHistoryAction(action: ConfigHistoryAction, version?: number): Promise<ConfigHistoryState> {
    await configHistoryReady;
    await flushConfigHistory();

    let targetIndex = historyState.cursor;
    if (action === 'undo') targetIndex = Math.max(0, historyState.cursor - 1);
    if (action === 'redo') targetIndex = Math.min(historyState.entries.length - 1, historyState.cursor + 1);
    if (action === 'restore' && version !== undefined) {
        const index = historyState.entries.findIndex((entry) => entry.version === version);
        if (index >= 0) targetIndex = index;
    }

    if (targetIndex === historyState.cursor) return getConfigHistorySnapshot();
    const target = historyState.entries[targetIndex];
    const normalized = normalizeConfig(target.config);
    await persistNormalizedConfig(normalized);
    if (serializeConfig(config) !== serializeConfig(normalized)) applyConfig(normalized);

    await queueHistoryWrite({
        ...historyState,
        cursor: targetIndex,
    });
    return getConfigHistorySnapshot();
}

type ConfigHistoryMessageResponse = {success?: boolean; error?: string; history?: ConfigHistoryState} | undefined;
type ConfigHistoryMessageSender = (message: {
    type: typeof CONFIG_HISTORY_MESSAGE;
    action: ConfigHistoryAction;
    version?: number;
}) => Promise<ConfigHistoryMessageResponse>;

export async function requestConfigHistoryAction(
    action: ConfigHistoryAction,
    version?: number,
    sendMessage?: ConfigHistoryMessageSender,
): Promise<ConfigHistoryState> {
    if (!sendMessage) return applyConfigHistoryAction(action, version);

    try {
        const response = await sendMessage({type: CONFIG_HISTORY_MESSAGE, action, version});
        if (response?.success === false) throw new Error(response.error || '配置历史操作失败');
        return response?.history || getConfigHistorySnapshot();
    } catch (error) {
        const history = await applyConfigHistoryAction(action, version);
        if (error instanceof Error && !error.message.includes('Receiving end')) {
            console.warn('[FluentRead] 后台配置历史操作失败，已回退到当前上下文', error);
        }
        return history;
    }
}

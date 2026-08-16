import { storage } from '@wxt-dev/storage';
import { Config, normalizeConfig } from '@/entrypoints/utils/model';

export const CONFIG_STORAGE_KEY = 'local:config' as const;
export const CONFIG_PERSIST_MESSAGE = 'persistConfig' as const;

type ConfigListener = (nextConfig: Config) => void;

const listeners = new Set<ConfigListener>();
let storageRevision = 0;
let initialized = false;
let lastPersistedSerialized = '';
let writeRevision = 0;
let writeQueue: Promise<void> = Promise.resolve();

// 所有运行时模块共享同一个可变配置对象；存储层负责把跨上下文变更同步进来。
export const config = new Config();

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function notifyListeners(nextConfig: Config): void {
    const snapshot = normalizeConfig(nextConfig);
    listeners.forEach((listener) => listener(snapshot));
}

function applyConfig(nextConfig: Config): void {
    Object.assign(config, nextConfig);
    notifyListeners(config);
}

function queueStorageWrite(nextConfig: Config, serialized: string, revision: number): Promise<void> {
    writeQueue = writeQueue
        .catch(() => undefined)
        .then(async () => {
            // 只写最后一次快照，避免连续输入或多个页面初始化时排队回写旧配置。
            if (revision !== writeRevision || lastPersistedSerialized !== serialized) return;
            try {
                await storage.setItem<Config>(CONFIG_STORAGE_KEY, nextConfig);
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
    await queueStorageWrite(nextConfig, serialized, revision);
}

function handleStoredConfigChange(value: unknown): void {
    storageRevision += 1;
    const parsed = parseStoredConfig(value);
    if (!parsed) return;

    const normalized = normalizeConfig(parsed);
    const serialized = serializeConfig(normalized);
    if (serialized === lastPersistedSerialized) return;

    // 外部上下文已经产生了新快照，使尚未写入的旧快照失效。
    writeRevision += 1;
    lastPersistedSerialized = serialized;
    applyConfig(normalized);
}

// 在首次读取前注册监听，避免设置页打开期间丢失其他上下文的更新。
storage.watch(CONFIG_STORAGE_KEY, handleStoredConfigChange);

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

export function subscribeConfig(listener: ConfigListener): () => void {
    listeners.add(listener);
    if (initialized) listener(normalizeConfig(config));
    return () => listeners.delete(listener);
}

export function getConfigSnapshot(): Config {
    return normalizeConfig(config);
}

/**
 * 配置唯一写入口。调用方可以传入编辑中的快照，也可以省略参数保存运行时配置。
 * 写入前会归一化、去重，并串行淘汰旧快照，避免设置页和 popup 互相回灌。
 */
export async function saveConfig(value: unknown = config): Promise<void> {
    await configReady;

    const normalized = normalizeConfig(value);
    const serialized = serializeConfig(normalized);
    if (serializeConfig(config) !== serialized) applyConfig(normalized);
    await persistNormalizedConfig(normalized, serialized);
}

/**
 * 从 popup/options 等短生命周期页面请求后台保存配置。
 * Firefox 可能在 popup 关闭时销毁页面上下文，不能依赖页面内的异步 storage.set 完成。
 */
type ConfigMessageResponse = { success?: boolean; error?: string } | undefined;
type ConfigMessageSender = (message: { type: typeof CONFIG_PERSIST_MESSAGE; config: Config }) => Promise<ConfigMessageResponse>;

export async function requestConfigSave(value: unknown = config, sendMessage?: ConfigMessageSender): Promise<void> {
    const normalized = normalizeConfig(value);

    if (!sendMessage) {
        await saveConfig(normalized);
        return;
    }

    try {
        const response = await sendMessage({
            type: CONFIG_PERSIST_MESSAGE,
            config: normalized,
        });

        if (response?.success === false) {
            throw new Error(response.error || '后台保存配置失败');
        }
    } catch (error) {
        // 保留非后台上下文和开发环境下的降级路径；正常扩展运行时由后台完成持久化。
        await saveConfig(normalized);
        if (error instanceof Error && !error.message.includes('Receiving end')) {
            console.warn('[FluentRead] 后台保存配置失败，已回退到当前上下文', error);
        }
    }
}

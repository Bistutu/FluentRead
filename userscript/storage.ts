import {getUserscriptFunction} from './api';

type StorageListener = (nextValue: unknown, previousValue?: unknown) => void;

const listeners = new Map<string, Set<StorageListener>>();
const memoryFallback = new Map<string, unknown>();
const observedValues = new Map<string, unknown>();
const readOwners = new Map<string, object>();
let refreshListenersInstalled = false;
type ConfigPreparationResult = {success: true} | {success: false; error: unknown};
let settleConfigPreparation: ((result: ConfigPreparationResult) => void) | undefined;
const configPreparationReady = new Promise<ConfigPreparationResult>((resolve) => {
    settleConfigPreparation = resolve;
});

async function waitForConfigPreparation(): Promise<void> {
    const result = await configPreparationReady;
    if (!result.success) throw result.error;
}

/**
 * 单文件 userscript 会把动态 import 内联，配置 store 的模块级水合可能早于 bootstrap。
 * ensureUserscriptConfig 完成迁移、能力收紧和计数投影后再放行 store 的持久化读取，
 * 避免 store 用迁移中的旧快照覆盖刚修复的权威配置。
 */
export function completeUserscriptConfigPreparation(): void {
    settleConfigPreparation?.({success: true});
    settleConfigPreparation = undefined;
}

/** 启动迁移失败时让提前求值的配置模块明确失败，不能永久等待或读取未收紧快照。 */
export function failUserscriptConfigPreparation(error: unknown): void {
    settleConfigPreparation?.({success: false, error});
    settleConfigPreparation = undefined;
}

function decodeStoredValue(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        // 2024 版 userscript 的值以普通字符串保存，需要保持原值以便迁移。
        return value;
    }
}

/** 已提交的 GM 写入与外部变更不能被某个 UI 观察者的异常改判为失败。 */
function notifyListeners(key: string, nextValue: unknown, previousValue: unknown): void {
    listeners.get(key)?.forEach(listener => {
        try {listener(nextValue, previousValue);}
        catch {console.warn('[FluentRead userscript] 存储订阅回调执行失败');}
    });
}

/**
 * GM 存储 API 在不同脚本管理器中可能同步或异步返回；这里统一归一为 Promise。
 * 内存回退仅服务于缺少 GM API 的测试或受限环境，不跨页面持久化。
 */
export async function getStoredValue<T>(key: string, options?: {fallback: T}): Promise<T | null> {
    const missingValue = options ? options.fallback : null;
    const getValue = getUserscriptFunction('GM_getValue', 'getValue');
    if (typeof getValue === 'function') {
        const value = await Promise.resolve(getValue(key, undefined));
        // 缺失键与已存 JSON null 不同；默认值也不能按旧存储字符串再次 JSON 解码。
        return value === undefined ? missingValue : decodeStoredValue(value) as T | null;
    }
    return memoryFallback.has(key) ? memoryFallback.get(key) as T : missingValue;
}

export async function setStoredValue<T>(key: string, value: T): Promise<void> {
    // 写入前后都使在途订阅读失效，避免旧读回灌已提交值。
    readOwners.set(key, {});
    const previousValue = await getStoredValue<T>(key);
    const setValue = getUserscriptFunction('GM_setValue', 'setValue');
    if (typeof setValue === 'function') {
        await Promise.resolve(setValue(key, JSON.stringify(value)));
    } else {
        memoryFallback.set(key, value);
    }
    readOwners.set(key, {});
    observedValues.set(key, value);
    notifyListeners(key, value, previousValue);
}

export async function removeStoredValue(key: string): Promise<void> {
    readOwners.set(key, {});
    const previousValue = await getStoredValue(key);
    const deleteValue = getUserscriptFunction('GM_deleteValue', 'deleteValue');
    if (typeof deleteValue === 'function') {
        await Promise.resolve(deleteValue(key));
    } else {
        memoryFallback.delete(key);
    }
    readOwners.set(key, {});
    observedValues.set(key, null);
    notifyListeners(key, null, previousValue);
}

/** 统一枚举 GM 键；计数等跨页面派生状态只读取自己的命名空间。 */
export async function listStoredKeys(): Promise<string[]> {
    const listValues = getUserscriptFunction('GM_listValues', 'listValues');
    if (typeof listValues === 'function') {
        const keys = await Promise.resolve(listValues());
        return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
    }
    return [...new Set([...memoryFallback.keys(), ...observedValues.keys()])];
}

function comparable(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/** 旧式 GM API 没有可靠的变更监听，因此页面重新获得焦点或可见时主动对比已订阅键。 */
async function refreshWatchedValues(): Promise<void> {
    await Promise.all([...listeners.keys()].map(async (key) => {
        const bucket = listeners.get(key);
        const owner = {};
        readOwners.set(key, owner);
        const previousValue = observedValues.get(key);
        const nextValue = await getStoredValue(key);
        if (readOwners.get(key) !== owner || listeners.get(key) !== bucket) return;
        if (comparable(previousValue) === comparable(nextValue)) return;
        observedValues.set(key, nextValue);
        notifyListeners(key, nextValue, previousValue);
    }));
}

const refreshOnFocus = () => {
    void refreshWatchedValues().catch((error) => console.warn('[FluentRead userscript] 刷新存储订阅失败', error));
};
const refreshOnVisible = () => {
    if (document.visibilityState === 'visible') refreshOnFocus();
};

function installRefreshListeners(): void {
    if (refreshListenersInstalled || typeof window === 'undefined') return;
    refreshListenersInstalled = true;
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnVisible);
}

export const storage = {
    writeOwner: true,
    getItem<T>(key: string): Promise<T | null> {
        return getStoredValue<T>(key);
    },

    setItem<T>(key: string, value: T): Promise<void> {
        return setStoredValue(key, value);
    },

    removeItem(key: string): Promise<void> {
        return removeStoredValue(key);
    },

    watch<T>(key: string, callback: (nextValue: T | null, previousValue?: T | null) => void): () => void {
        const bucket = listeners.get(key) || new Set<StorageListener>();
        bucket.add(callback as StorageListener);
        listeners.set(key, bucket);
        installRefreshListeners();
        if (!observedValues.has(key)) {
            const owner = {};
            readOwners.set(key, owner);
            void getStoredValue(key).then((value) => {
                if (readOwners.get(key) === owner && listeners.get(key) === bucket && !observedValues.has(key)) {
                    observedValues.set(key, value);
                }
            }).catch((error) => {
                if (listeners.get(key) === bucket) console.warn('[FluentRead userscript] 初始化存储订阅失败', error);
            });
        }
        return () => {
            bucket.delete(callback as StorageListener);
            if (bucket.size === 0 && listeners.get(key) === bucket) {
                listeners.delete(key);
                readOwners.delete(key);
                if (listeners.size === 0 && refreshListenersInstalled) {
                    window.removeEventListener('focus', refreshOnFocus);
                    document.removeEventListener('visibilitychange', refreshOnVisible);
                    refreshListenersInstalled = false;
                }
            }
        };
    },
};

// 共享配置 store 在扩展构建中使用后台 IndexedDB 端口；userscript 保持 GM 私有
// 存储语义，并通过同名导出让 Vite alias 在模块边界完整替换扩展实现。
export const configStorage = {
    ...storage,
    async getItem<T>(key: string): Promise<T | null> {
        await waitForConfigPreparation();
        return storage.getItem<T>(key);
    },
    watch<T>(key: string, callback: (nextValue: T | null, previousValue?: T | null) => void): () => void {
        let cancelled = false;
        let stopWatching: (() => void) | undefined;
        void waitForConfigPreparation().then(() => {
            if (cancelled) return;
            stopWatching = storage.watch<T>(key, callback);
        }).catch(() => undefined);
        return () => {
            cancelled = true;
            stopWatching?.();
        };
    },
};

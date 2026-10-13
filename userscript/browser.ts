import {getStoredValue, listStoredKeys, setStoredValue, storage as userscriptStorage} from './storage';

type RuntimeListener = (
    message: any,
    sender: any,
    sendResponse: (response?: any) => void,
) => unknown;
type PlatformMessageHandler = ((message: any) => Promise<any>) & {dispose?: () => void};

export const UNHANDLED_RUNTIME_MESSAGE = Symbol('unhandled-runtime-message');

const runtimeListeners = new Set<RuntimeListener>();
const pendingResponses = new Map<RuntimeListener, Set<() => void>>();
const defaultPlatformMessageHandler: PlatformMessageHandler = async () => UNHANDLED_RUNTIME_MESSAGE;
let platformMessageHandler: PlatformMessageHandler = defaultPlatformMessageHandler;
type StorageChange = {oldValue?: unknown; newValue?: unknown};
type StorageChangedListener = (changes: Record<string, StorageChange>, areaName: string) => void;
const storageChangedListeners = new Set<StorageChangedListener>();
const storageKeyWatchers = new Set<string>();

function watchStorageKey(key: string): void {
    if (storageKeyWatchers.has(key)) return;
    storageKeyWatchers.add(key);
    userscriptStorage.watch(key, (nextValue, previousValue) => {
        const changes = {[key]: {oldValue: previousValue, newValue: nextValue}};
        storageChangedListeners.forEach((listener) => listener(changes, 'local'));
    });
}

const storageOnChanged = {
    addListener(listener: StorageChangedListener): void { storageChangedListeners.add(listener); },
    removeListener(listener: StorageChangedListener): void { storageChangedListeners.delete(listener); },
    hasListener(listener: StorageChangedListener): boolean { return storageChangedListeners.has(listener); },
};

export function setPlatformMessageHandler(handler: PlatformMessageHandler): void {
    if (platformMessageHandler === handler) return;
    const previous = platformMessageHandler;
    // 先移交 owner：旧 cleanup 抛错或同步安装更新的 handler，都不能恢复旧闭包。
    platformMessageHandler = handler;
    previous.dispose?.();
}

/** 初始化失败或页面离开时恢复空适配器，防止后续重注入继续调用旧页面闭包。 */
export function resetPlatformMessageHandler(): void {
    setPlatformMessageHandler(defaultPlatformMessageHandler);
}

/**
 * 在同一页面内模拟 webextension runtime 消息分派，兼容同步 sendResponse、Promise
 * 返回值以及返回 true 后异步应答三种监听器形式。
 */
export async function dispatchContentMessage(message: any): Promise<any> {
    for (const listener of runtimeListeners) {
        let didRespond = false;
        let responseValue: any;
        let active = true;
        let resolveResponse!: (value?: any) => void;
        const response = new Promise<any>((resolve) => {resolveResponse = resolve;});
        const sendResponse = (value?: any) => {
            if (!active || didRespond) return;
            didRespond = true;
            responseValue = value;
            resolveResponse(value);
        };
        const cancel = () => {active = false; resolveResponse();};
        const pending = pendingResponses.get(listener) || new Set<() => void>();
        pending.add(cancel); pendingResponses.set(listener, pending);
        try {
            const returned = listener(message, {tab: {id: 1, windowId: 1}, frameId: 0}, sendResponse);
            if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') {
                const value = await returned;
                if (value !== undefined) return value;
            }
            if (didRespond) return responseValue;
            // true 表示监听器拥有异步响应通道；不能按一个事件循环 turn 提前结束。
            if (returned === true) return await response;
        } finally {
            active = false;
            pending.delete(cancel);
            if (pending.size === 0) pendingResponses.delete(listener);
        }
    }
    return undefined;
}

function runtimeAssetUrl(path: string): string {
    if (/icon\/(?:32|48|64|128|256|512)\.png$/u.test(path)) {
        return globalThis.__FLUENTREAD_ICON_DATA__ || '';
    }
    return '';
}

const runtime = {
    async sendMessage(message: any): Promise<any> {
        // 先交给 userscript 的“后台”适配器；未处理消息再回送内容侧监听器。
        const result = await platformMessageHandler(message);
        if (result !== UNHANDLED_RUNTIME_MESSAGE) return result;
        return dispatchContentMessage(message);
    },
    getURL: runtimeAssetUrl,
    async openOptionsPage(): Promise<void> {
        window.dispatchEvent(new CustomEvent('fluentread-userscript-open-settings'));
    },
    onMessage: {
        addListener(listener: RuntimeListener): void {
            runtimeListeners.add(listener);
        },
        removeListener(listener: RuntimeListener): void {
            runtimeListeners.delete(listener);
            pendingResponses.get(listener)?.forEach((cancel) => cancel());
        },
        hasListener(listener: RuntimeListener): boolean {
            return runtimeListeners.has(listener);
        },
    },
};

const browser = {
    runtime,
    tabs: {
        async query(): Promise<Array<{id: number; windowId: number; active: boolean}>> {
            return [{id: 1, windowId: 1, active: true}];
        },
        async sendMessage(_tabId: number, message: any): Promise<any> {
            return dispatchContentMessage(message);
        },
        async create({url}: {url?: string}): Promise<void> {
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
        },
    },
    storage: {
        local: {
            // webextension storage.local 在 userscript 中由 GM 存储承接，并维持相同的批量键形态。
            async get(keys?: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>> {
                if (typeof keys === 'string') {
                    watchStorageKey(keys);
                    return {[keys]: await getStoredValue(keys)};
                }
                if (Array.isArray(keys)) {
                    keys.forEach(watchStorageKey);
                    return Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await getStoredValue(key)])));
                }
                if (keys && typeof keys === 'object') {
                    Object.keys(keys).forEach(watchStorageKey);
                    return Object.fromEntries(await Promise.all(Object.entries(keys).map(async ([key, fallback]) => {
                        const value = await getStoredValue(key);
                        return [key, value ?? fallback];
                    })));
                }
                const names = await listStoredKeys();
                return Object.fromEntries(await Promise.all(names.map(async (key) => [key, await getStoredValue(key)])));
            },
            async set(values: Record<string, unknown>): Promise<void> {
                Object.keys(values).forEach(watchStorageKey);
                await Promise.all(Object.entries(values).map(([key, value]) => setStoredValue(key, value)));
            },
        },
        onChanged: storageOnChanged,
    },
};

export const chrome = {
    runtime,
    storage: browser.storage,
};

export default browser;

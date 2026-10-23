/**
 * @file src/services/config/historyRuntime.ts
 * 文件职责：以独立实例协调配置历史的延迟水合、观察、串行写入、去抖追加与恢复动作。
 * 主要内容：保留实际持久化确认、旧读取隔离、失败重试和完整快照游标；隔离订阅者异常，不将 UI 故障伪装成历史落盘失败；通过明确端口读取当前配置并提交恢复，不持有全局配置或凭据。
 * 模块边界：只消费注入的存储、就绪和权威提交端口；导入与创建实例均不启动 I/O，历史消费者首次等待或订阅时才水合。
 */
import type {Config} from '@/src/core/config/model';
import type {ConfigStoragePort} from '@/src/platform/storage/configStorage';
import {appendConfigHistorySnapshot, cloneConfigHistory, createBaselineConfigHistory, parseConfigHistory, restoreRestorableConfig, resolveConfigHistoryTargetIndex, serializeConfigHistory, toRestorableConfig, type ConfigHistoryAction, type ConfigHistoryState, type RestorableConfig} from './history';
import {serializeConfig} from './schema';

export const CONFIG_HISTORY_STORAGE_KEY = 'local:configHistory' as const;
const CONFIG_HISTORY_DEBOUNCE_MS = 350;
type ConfigHistoryListener = (nextHistory: ConfigHistoryState) => void;
export interface ConfigHistoryRuntimePorts {
    storage: Pick<ConfigStoragePort, 'getItem' | 'setItem' | 'watch'>;
    ready(): Promise<void>;
    getConfig(): Config;
    getRevision(): number;
    isTrusted(): boolean;
    isWriteOwner(): boolean;
    commit(config: Config): Promise<void>;
}

export function createConfigHistoryRuntime(ports: ConfigHistoryRuntimePorts) {
    const storage = ports.storage;
    const historyListeners = new Set<ConfigHistoryListener>();
    let historyState: ConfigHistoryState;
    let historyInitialized = false;
    let historyStorageRevision = 0;
    let historyLastSerialized = '';
    let historyPendingSerialized = '';
    let historyWriteRevision = 0;
    let historyWriteQueue: Promise<void> = Promise.resolve();
    let pendingHistorySnapshot: RestorableConfig | null = null;
    let pendingHistoryTimer: ReturnType<typeof setTimeout> | undefined;
    let historyFlushPromise: Promise<void> | null = null;
    let historyReadyPromise: Promise<void> | undefined;
    const configHistoryReady: PromiseLike<void> = {then: (fulfilled, rejected) => ensureConfigHistoryReady().then(fulfilled, rejected)};
    function ensureConfigHistoryReady(): Promise<void> {return historyReadyPromise ??= initializeConfigHistory();}
    function notifyHistoryListener(listener: ConfigHistoryListener, snapshot: ConfigHistoryState): void {
        try {listener(snapshot);}
        catch {console.warn('[FluentRead] 配置历史订阅通知失败');}
    }
    function notifyHistoryListeners(): void {
        // 唯一调用方 setHistoryState 已先安装完整状态，订阅失败不改变已提交游标。
        const snapshot = cloneConfigHistory(historyState);
        historyListeners.forEach((listener) => notifyHistoryListener(listener, snapshot));
    }

    function setHistoryState(nextHistory: ConfigHistoryState, notify = true): void {
        historyState = cloneConfigHistory(nextHistory);
        historyLastSerialized = serializeConfigHistory(historyState);
        if (notify) notifyHistoryListeners();
    }

    function handleStoredHistoryChange(value: unknown): void {
        const parsed = parseConfigHistory(value);
        if (!parsed) return;
        const serialized = serializeConfigHistory(parsed);
        if (serialized === historyLastSerialized) return;
        // 步骤 1：写队列处理中只接收最新请求的回声，避免较慢的旧写入覆盖新快照。
        if (historyPendingSerialized && serialized !== historyPendingSerialized) return;

        // 步骤 2：外部上下文没有与本地写入竞争时，立即同步历史游标和订阅者。
        historyStorageRevision += 1;
        setHistoryState(parsed);
    }

    async function queueHistoryWrite(nextHistory: ConfigHistoryState): Promise<void> {
        const sanitizedHistory = cloneConfigHistory(nextHistory);
        const serialized = serializeConfigHistory(sanitizedHistory);
        if (!historyPendingSerialized && serialized === historyLastSerialized) return;
        // 重复游标请求也必须等待同一写入，不能在磁盘失败前提前报告成功。
        if (serialized === historyPendingSerialized) return historyWriteQueue;

        historyPendingSerialized = serialized;
        const revision = ++historyWriteRevision;
        historyWriteQueue = historyWriteQueue
            .catch(() => undefined)
            .then(async () => {
                // 步骤 1：队列轮到当前写入时再次执行最后写入者优先检查。
                if (revision !== historyWriteRevision || historyPendingSerialized !== serialized) return;
                await storage.setItem<ConfigHistoryState>(CONFIG_HISTORY_STORAGE_KEY, sanitizedHistory);

                // 步骤 2：storage.setItem 期间可能产生更新请求；旧写入完成后不能回滚内存状态。
                if (revision !== historyWriteRevision || historyPendingSerialized !== serialized) return;
                setHistoryState(sanitizedHistory);
                historyPendingSerialized = '';
            });
        try {
            await historyWriteQueue;
        } catch (error) {
            if (revision === historyWriteRevision && historyPendingSerialized === serialized) {
                historyPendingSerialized = '';
            }
            throw error;
        }
    }

    async function initializeConfigHistory(): Promise<void> {
        let readRevision = historyStorageRevision;
        try {
            await ports.ready();
            if (!ports.isTrusted()) {
                historyInitialized = true;
                setHistoryState(createBaselineConfigHistory(ports.getConfig(), ports.getRevision()), false);
                return;
            }
            storage.watch(CONFIG_HISTORY_STORAGE_KEY, handleStoredHistoryChange);
            readRevision = historyStorageRevision;
            const storedHistory = await storage.getItem<unknown>(CONFIG_HISTORY_STORAGE_KEY);
            historyInitialized = true;
            // GM 等直接存储端口可能先通知外部新历史，再返回较早发起的读取。
            // watch 已经安装了完整新状态时，迟到读结果不能回退游标和版本号。
            if (readRevision !== historyStorageRevision) return;
            const parsed = parseConfigHistory(storedHistory);
            if (parsed) {
                setHistoryState(parsed);
                // 旧历史可能仍含统计、安全开关或内部迁移字段；读取时立即迁移为
                // 可恢复投影，避免这些字段继续占用存储或在其他上下文中泄漏出来。
                if (ports.isWriteOwner() && serializeConfig(storedHistory) !== serializeConfig(parsed)) {
                    try {
                        await storage.setItem<ConfigHistoryState>(CONFIG_HISTORY_STORAGE_KEY, parsed);
                    } catch (error) {
                        console.warn('[FluentRead] 配置历史可恢复投影迁移暂未落盘', error);
                    }
                }
            } else {
                setHistoryState(createBaselineConfigHistory(ports.getConfig(), ports.getRevision()), false);
            }
        } catch (error) {
            historyInitialized = true;
            // 旧读失败也不能覆盖期间已收到的有效历史。
            if (readRevision !== historyStorageRevision) return;
            setHistoryState(createBaselineConfigHistory(ports.getConfig(), ports.getRevision()), false);
            console.error('[FluentRead] 配置历史读取失败，使用当前配置快照', error);
        }
    }

    async function appendHistorySnapshotNow(value: unknown): Promise<void> {
        await configHistoryReady;
        const nextHistory = appendConfigHistorySnapshot(historyState, value);
        if (!nextHistory) return;
        await queueHistoryWrite(nextHistory);
    }

    function takePendingHistorySnapshot(): RestorableConfig | null {
        if (pendingHistoryTimer) clearTimeout(pendingHistoryTimer);
        pendingHistoryTimer = undefined;
        const snapshot = pendingHistorySnapshot;
        pendingHistorySnapshot = null;
        return snapshot;
    }

    function flushHistorySnapshot(snapshot: RestorableConfig): Promise<void> {
        // 步骤 1：每次追加都等待前一个追加完成，确保它读取到已提交的游标与 nextVersion。
        const previous = historyFlushPromise;
        const current = (previous ? previous.catch(() => undefined) : Promise.resolve())
            .then(() => appendHistorySnapshotNow(snapshot));
        historyFlushPromise = current;

        // 步骤 2：只有队尾任务可以清空引用；较早任务结束不能让调用方漏等后续快照。
        const clearIfCurrent = () => {
            if (historyFlushPromise === current) historyFlushPromise = null;
        };
        void current.then(clearIfCurrent, clearIfCurrent);
        void current.catch((error) => console.error('[FluentRead] 配置历史保存失败', error));
        return current;
    }

    function scheduleHistorySnapshot(value: unknown): void {
        pendingHistorySnapshot = toRestorableConfig(value);
        if (pendingHistoryTimer) clearTimeout(pendingHistoryTimer);
        pendingHistoryTimer = setTimeout(() => {
            const snapshot = takePendingHistorySnapshot();
            if (snapshot) flushHistorySnapshot(snapshot);
        }, CONFIG_HISTORY_DEBOUNCE_MS);
    }

    async function flushConfigHistory(): Promise<void> {
        const snapshot = takePendingHistorySnapshot();
        let current = snapshot ? flushHistorySnapshot(snapshot) : historyFlushPromise;
        while (current) {
            await current;
            // current 的清理回调先于 await 消费者注册，此时引用已清空或指向新的追加。
            current = historyFlushPromise;
        }
    }

    function getConfigHistorySnapshot(): ConfigHistoryState {
        return cloneConfigHistory(
            historyState || createBaselineConfigHistory(ports.getConfig(), ports.getRevision()),
        );
    }

    function subscribeConfigHistory(listener: ConfigHistoryListener): () => void {
        void ensureConfigHistoryReady();
        historyListeners.add(listener);
        if (historyInitialized && historyState) notifyHistoryListener(listener, cloneConfigHistory(historyState));
        return () => historyListeners.delete(listener);
    }

    async function applyConfigHistoryAction(action: ConfigHistoryAction, version?: number): Promise<ConfigHistoryState> {
        await configHistoryReady;
        await flushConfigHistory();

        const targetIndex = resolveConfigHistoryTargetIndex(historyState, action, version);

        if (targetIndex === historyState.cursor) return getConfigHistorySnapshot();
        const target = historyState.entries[targetIndex];
        const normalized = restoreRestorableConfig(target.config, ports.getConfig());
        await ports.commit(normalized);

        if (action === 'restore') {
            // 恢复不是把游标永久退回旧版本，而是把目标快照作为一次新的修改追加。
            // 这样恢复前的状态和原有 redo 条目都仍可查看，之后继续编辑也不会静默丢失它们。
            const historyWithLatestCursor = {
                ...historyState,
                cursor: historyState.entries.length - 1,
            };
            const restoredHistory = appendConfigHistorySnapshot(historyWithLatestCursor, normalized);
            await queueHistoryWrite(restoredHistory || historyWithLatestCursor);
            return getConfigHistorySnapshot();
        }

        await queueHistoryWrite({
            ...historyState,
            cursor: targetIndex,
        });
        return getConfigHistorySnapshot();
    }
    return {ready: configHistoryReady, getSnapshot: getConfigHistorySnapshot, subscribe: subscribeConfigHistory, flush: flushConfigHistory, schedule: scheduleHistorySnapshot, flushSnapshot: flushHistorySnapshot, applyAction: applyConfigHistoryAction};
}
export type ConfigHistoryRuntime = ReturnType<typeof createConfigHistoryRuntime>;

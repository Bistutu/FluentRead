/**
 * @file src/services/config/application.ts
 * 文件职责：以明确端口组装每个运行上下文唯一的配置权威、客户端与历史实例。
 * 主要内容：把同一配置与 revision 视图交给客户端和历史控制器，保留原有公开服务 API，并从现有初始化及写入保护标志派生只读水合状态；实例构造不读写存储，只有 start 才启动权威水合。
 * 模块边界：无浏览器或全局配置依赖，不创建平行配置 store；默认运行时仅在 store.ts 绑定平台端口。
 */
import type {ConfigStoragePort} from '@/src/platform/storage/configStorage';
import {createConfigAuthority} from './authority';
import {createConfigMutationClient} from './mutationClient';
import {createConfigHistoryRuntime} from './historyRuntime';

export type ConfigHydrationStatus = 'loading' | 'ready' | 'blocked';

export function createConfigApplication(ports: {storage: ConfigStoragePort; trustedContext: boolean}) {
    const authority = createConfigAuthority({...ports, client: () => client, history: () => history});
    const history = createConfigHistoryRuntime({
        storage: ports.storage, ready: () => authority.configReady, getConfig: () => authority.config,
        getRevision: authority.getConfigRevision, isTrusted: () => ports.trustedContext,
        isWriteOwner: () => ports.storage.writeOwner !== false, commit: authority.restore,
    });
    const client = createConfigMutationClient({authority: authority.clientPort, applyHistoryAction: history.applyAction});
    // 调用方须先等待 configReady；该投影描述安全状态，不替代迁移 Promise 的完成信号。
    const getConfigHydrationStatus = (): ConfigHydrationStatus => authority.clientPort.writesBlocked
        ? 'blocked' : authority.clientPort.initialized ? 'ready' : 'loading';
    return {
        getConfigHydrationStatus,
        config: authority.config, configReady: authority.configReady, start: authority.start,
        subscribeConfig: authority.subscribeConfig, getConfigRevision: authority.getConfigRevision,
        prepareHydratedConfigForExport: authority.prepareHydratedConfigForExport,
        prepareConfigSaveRequest: authority.prepareConfigSaveRequest, prepareConfigPatchRequest: authority.prepareConfigPatchRequest,
        saveConfig: authority.saveConfig, incrementConfigCount: authority.incrementConfigCount,
        waitForConfigPersistenceQueue: authority.waitForConfigPersistenceQueue,
        configHistoryReady: history.ready, getConfigHistorySnapshot: history.getSnapshot,
        subscribeConfigHistory: history.subscribe, flushConfigHistory: history.flush, applyConfigHistoryAction: history.applyAction,
        requestConfigSave: client.requestConfigSave, requestConfigPatch: client.requestConfigPatch,
        requestConfigCountIncrement: client.requestConfigCountIncrement, requestConfigHistoryAction: client.requestConfigHistoryAction,
        handoffPendingConfigPatches: client.handoffPendingConfigPatches,
    };
}
export type ConfigApplication = ReturnType<typeof createConfigApplication>;

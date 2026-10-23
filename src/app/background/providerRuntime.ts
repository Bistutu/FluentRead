/**
 * @file src/app/background/providerRuntime.ts
 * 文件职责：为后台组合根集中提供翻译供应商相关运行时能力，隔离 app/messageRuntime 对 providers 内部文件结构的直接依赖。
 * 主要内容：装配设置页连接检查和可取消的识图测试消息，重导出错误格式化与免费翻译权重快照，并为连接测试统一注入共享请求 scheduler、最终模型身份、本地用量代次和响应前有限等待的 IndexedDB 记录。
 * 模块边界：这是窄化的 app 层出口，不注册消息、不实现 HTTP 协议；供应商请求和错误解释仍由 providers/translation 模块拥有。
 */
// Background entrypoint 只依赖 app composition root；这里集中组装翻译 provider 能力。
import {
    formatConnectionTestError,
    runTranslationServiceConnectionTest,
} from '@/src/providers/translation/connectionTest';
import {getFreeTranslationWeightSnapshot as readFreeTranslationWeightSnapshot} from '@/src/providers/translation/free-translation';
import {config, configReady} from '@/src/services/config/store';
import {createConnectionTestHandler} from './handlers/connectionTest';
import {createVisionProbeHandlers} from './handlers/visionProbe';
import {modelVisionProbe} from '@/src/app/translation/visionProbeRuntime';
import {resolveConfiguredModel, servicesType} from '@/src/core/config/catalog';
import {getModelUsageRepository} from '@/src/platform/storage/modelUsageRepository';
import {translationRequestScheduler} from '@/src/app/translation/runtime';
import {createTranslationProviderConfigSnapshot} from '@/src/services/translation/requestSnapshot';
import {resolveTranslationRequestModel} from '@/src/services/translation/broker';
import type {FreeTranslationProviderId} from '@/src/core/config/freeTranslation';

export {formatConnectionTestError};

/** 后台组合根冻结设置后注入权重查询，provider 不读取全局配置。 */
export function getFreeTranslationWeightSnapshot() {
    return readFreeTranslationWeightSnapshot(createTranslationProviderConfigSnapshot(config));
}

export function createProviderTestRuntimeHandlers() {
    return [createConnectionTestHandler({ready: configReady,
        runConnectionTest: runTranslationServiceConnectionTestWithUsage, formatError: formatConnectionTestError}),
        ...createVisionProbeHandlers({ready: configReady, getConfig: () => config,
            isSettingsUrl: url => url.split(/[?#]/u)[0] === browser.runtime.getURL('/options.html'),
            resolve: modelVisionProbe.resolve})];
}

export function runTranslationServiceConnectionTestWithUsage(service: string, keyIndex?: number, keyRevision?: string, freeProviderId?: FreeTranslationProviderId) {
    const usageGeneration = getModelUsageRepository().captureGeneration();
    const snapshot = createTranslationProviderConfigSnapshot(config);
    return runTranslationServiceConnectionTest(service, {
        configuredModel: resolveConfiguredModel(snapshot.model[service], snapshot.customModel[service]),
        effectiveModel: resolveTranslationRequestModel(snapshot, service, undefined, servicesType.isAiSdk, servicesType.isAI),
        keyIndex,
        keyRevision,
        freeProviderId,
        recordModelUsage: async (events) => {
            await getModelUsageRepository().recordMany(events, usageGeneration);
        },
        warn: (message, error) => console.warn(message, error),
        requestScheduler: translationRequestScheduler,
        config: snapshot,
        countRate: !servicesType.isAiSdk(service),
    });
}

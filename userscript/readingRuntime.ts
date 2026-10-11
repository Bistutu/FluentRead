/**
 * 把真实阅读 handler、流式端口和 Harness 内核组合到当前 userscript 文档。
 * 仅保留卡片内问答；不装配会话、学习记忆或模型统计仓库，不借用无痕标志伪装持久化能力。
 * sender 来自本组合根的文档 owner，配置失效、替换与离页取消均复用共享 handler 的所有权校验。
 */
import type {Config} from '@/src/core/config/model';
import {resolveConfiguredModel} from '@/src/core/config/catalog';
import {isExtensionDisabledOnSite} from '@/src/core/site-rules/domain';
import {createReadingAssistantHandler, type ReadingSender} from '@/src/features/reading-assistant/background';
import {attachReadingStreamPort} from '@/src/features/reading-assistant/streamPort';
import {createHarnessRuntime} from '@/src/services/harness/runtime';
import {getHarnessModelInputKey} from '@/src/services/harness/modelGateway';
import {createUserscriptPortPair, type UserscriptRuntimePort} from './localPort';

interface ReadingDependencies {
    ready: Promise<unknown>;
    getConfig(): Config;
    subscribeConfig(listener: (config: Config) => void): () => void;
    privateContext(): boolean | undefined;
}
const TEMPORARY_READING_MESSAGE = 'userscript 阅读仅保留当前卡片，不保存阅读记录。';
const UNSUPPORTED_MEMORY_MESSAGE = 'userscript 暂不支持学习记忆，本次只分析选中文本与卡片内问答。';

let readingOwnerSequence = 0;

export function createUserscriptReadingRuntime(deps: ReadingDependencies) {
    // 身份只在当前沙箱内部隔离 owner，不依赖 HTTP 页未必提供的 secure-context UUID。
    const documentId = `userscript-reading-${++readingOwnerSequence}`;
    const ports = new Set<UserscriptRuntimePort>();
    let closed = false;
    let handler: ReturnType<typeof createReadingAssistantHandler> | undefined;
    let stopWatching: (() => void) | undefined;
    const pageUrl = () => globalThis.location?.href || '';
    const sender = (): ReadingSender => ({id: documentId, documentId, frameId: 0,
        url: pageUrl(), tab: {id: 1, url: pageUrl(), incognito: deps.privateContext()}});
    const eligibility = (owner: ReadingSender) => {
        if (closed) return '阅读连接已关闭';
        const current = deps.getConfig();
        if (!current.on || !current.harness.enabled) return '阅读理解已停用';
        if (owner.url !== pageUrl()) return '页面已切换，请重新选择文字';
        if (isExtensionDisabledOnSite(owner.url || '', current.disabledExtensionDomains)) return '当前网站已禁用扩展';
        return undefined;
    };
    // 与原生后台一样，只比较实际模型输入和阅读偏好；计数、主题等刷新不取消回答。
    const configurationKey = (next: Config) => {
        const service = next.harness.service || next.service;
        const model = next.harness.model || resolveConfiguredModel(next.model[service], next.customModel[service]);
        return JSON.stringify([next.on, next.to, next.uiLanguage,
            {...next.harness, service: undefined, model: undefined, trigger: undefined, customHotkey: undefined, hoverDelay: undefined, defaultAction: undefined},
            getHarnessModelInputKey(next, service, model)]);
    };
    const getHandler = () => {
        if (closed) throw new Error('阅读连接已关闭');
        if (handler) return handler;
        // 不传持久化 sink/reader；普通、无痕及未知隐私元数据都使用相同的临时能力。
        const runtime = createHarnessRuntime(deps.getConfig);
        const ready = deps.ready.then(() => {
            if (closed) return;
            let preferencesKey = configurationKey(deps.getConfig());
            const stop = deps.subscribeConfig(next => {
                if (closed) return;
                const nextKey = configurationKey(next);
                if (nextKey !== preferencesKey) handler?.cancelAll();
                preferencesKey = nextKey;
                handler?.cancelDisallowed();
            });
            if (closed) stop();
            else stopWatching = stop;
        });
        handler = createReadingAssistantHandler({extensionId: documentId, ready, eligibility,
            run: (request, signal, progress, owner) => {
                if (request.sessionId !== undefined || request.anchorTurnId !== undefined) {
                    return Promise.resolve({success: false as const, error: TEMPORARY_READING_MESSAGE});
                }
                progress?.({kind: 'session', persistent: false, warning: TEMPORARY_READING_MESSAGE});
                if (deps.getConfig().harness.memoryEnabled) progress?.({kind: 'memory', count: 0, warning: UNSUPPORTED_MEMORY_MESSAGE});
                // 原始元数据保持三态；此组合根没有 reader/sink，任何状态均无持久化能力。
                return runtime.run(request, signal, progress, owner?.tab?.incognito);
            },
        });
        return handler;
    };
    const closeConnections = () => {
        if (closed) return;
        closed = true;
        const stop = stopWatching;
        stopWatching = undefined;
        const activePorts = [...ports];
        ports.clear();
        let failed = false;
        let firstError: unknown;
        for (const cleanup of [() => handler?.dispose(), () => stop?.(), ...activePorts.map(port => () => port.disconnect())]) {
            try {cleanup();} catch (error) {
                if (!failed) {failed = true; firstError = error;}
            }
        }
        if (failed) throw firstError;
    };
    return {
        async handle(message: unknown) {
            if (closed) return {success: false, error: '阅读连接已关闭'};
            if (message && typeof message === 'object' && 'action' in message && typeof message.action === 'string') {
                if (message.action.startsWith('sessions-')) return {success: false, error: TEMPORARY_READING_MESSAGE};
                if (message.action.startsWith('memory-')) return {success: false, error: UNSUPPORTED_MEMORY_MESSAGE};
            }
            return getHandler().handle(structuredClone(message), sender());
        },
        connect(options: {name?: string}): UserscriptRuntimePort {
            if (options.name !== 'fluentReadHarnessStream') throw new Error('userscript 不支持此连接');
            const reading = getHandler();
            const [client, server] = createUserscriptPortPair(options.name, sender());
            ports.add(server);
            server.onDisconnect.addListener(() => ports.delete(server));
            attachReadingStreamPort(server, reading);
            return client;
        },
        closeConnections,
        dispose: closeConnections,
    };
}

/**
 * @file userscript/readingRuntime.ts
 * 文件职责：按首次使用加载共享阅读处理器，以同页私有端口承接完整流式阅读协议。
 * 主要内容：由组合根签发页面身份，监听导航、配置变化、页面隐藏与 owner 销毁，并取消旧请求、释放连接和事件监听。
 * 模块边界：会话与长期记忆只使用 GM 存储适配，不借用任意宿主站点的 IndexedDB；模型生成、工具授权与引用校验仍复用共享 Harness。
 */
import {config, configReady, subscribeConfig} from '@/src/services/config/store';
import {isExtensionDisabledOnSite} from '@/src/core/site-rules/domain';
import type {ReadingSender} from '@/src/features/reading-assistant/background';
import type {ReadingStreamPort} from '@/src/features/reading-assistant/streamPort';
import type {UserscriptRuntimePort} from './browser';
import {isUserscriptSettingsUrl} from './settingsPage';
import {isUserscriptPrivateContext} from './api';

const ID = 'fluentread-userscript-reading';
const OPTIONS_URL = 'fluentread-userscript://settings';
const INACTIVE = {success: false, error: '阅读页面已失活，请重新打开阅读卡', cancelled: true} as const;

export function createUserscriptReadingRuntime() {
    let disposed = false;
    let suspended = false;
    let epoch = 0;
    // 组合根仅在 Window 页面内创建 runtime；Location 始终存在，所有 sender 均由下方本页工厂签发。
    let href = globalThis.location.href;
    let backend: ReturnType<typeof initialize> | undefined;
    let live: Awaited<ReturnType<typeof initialize>> | undefined;
    const ports = new Set<UserscriptRuntimePort>();
    const currentHref = () => globalThis.location.href;
    const ownerCurrent = (sender: ReadingSender) => !disposed && !suspended
        && sender.documentId === String(epoch) && sender.tab?.url === currentHref();
    const siteBlocked = () => isExtensionDisabledOnSite(currentHref(), config.disabledExtensionDomains);
    const eligibility = (sender: ReadingSender) => !ownerCurrent(sender) ? INACTIVE.error
        : !config.on || !config.harness.enabled ? '阅读理解已停用'
            : siteBlocked() ? '当前网站已禁用扩展' : undefined;
    const sender = (): ReadingSender => {
        const url = currentHref();
        return {id: ID, url: isUserscriptSettingsUrl(url) ? OPTIONS_URL : url,
            tab: {id: 1, url, incognito: isUserscriptPrivateContext()}, frameId: 0, documentId: String(epoch)};
    };
    const cancel = () => {
        epoch += 1;
        for (const port of [...ports]) port.disconnect();
        live?.handler.cancelAll();
    };
    const routeChanged = () => {
        const next = currentHref();
        if (href === next) return;
        href = next;
        cancel();
    };
    const pagehide = (event: PageTransitionEvent) => {
        if (!event.persisted) {dispose(); return;}
        suspended = true; cancel();
    };
    const pageshow = () => {if (!disposed) {suspended = false; routeChanged();}};
    globalThis.window?.addEventListener('pagehide', pagehide);
    globalThis.window?.addEventListener('pageshow', pageshow);
    globalThis.window?.addEventListener('popstate', routeChanged);
    globalThis.window?.addEventListener('hashchange', routeChanged);
    globalThis.document?.addEventListener('fluentread-route-change', routeChanged);
    const stopConfig = subscribeConfig(() => {
        // 初始化完成前尚无任务；完成后用共享有效模型身份判定是否需要取消。
        live?.configurationChanged();
    });

    async function initialize() {
        const [{createReadingAssistantHandler}, {createHarnessRuntime}, {createHarnessConversationRuntime},
            {attachReadingStreamPort}, {createReadingSessionHandler}, {createLearningMemoryHandler},
            {createLearningMemoryRecall}, {createUserscriptReadingStorage}, {resolveHarnessModel},
            {getHarnessModelInputKey}] = await Promise.all([
            import('@/src/features/reading-assistant/background'), import('@/src/services/harness/runtime'),
            import('@/src/services/harness/conversation'), import('@/src/features/reading-assistant/streamPort'),
            import('@/src/features/reading-assistant/sessionHandler'), import('@/src/features/reading-assistant/memoryHandler'),
            import('@/src/services/harness/memoryRecall'), import('./readingStorage'),
            import('@/src/core/config/harness'), import('@/src/services/harness/modelConfig'),
        ]);
        const storage = createUserscriptReadingStorage({privateContext: isUserscriptPrivateContext()});
        const runtime = createHarnessRuntime(() => config, undefined, {recall: createLearningMemoryRecall(storage.memories)});
        const conversation = createHarnessConversationRuntime({runtime, store: storage.sessions, preferences: () => config.harness});
        const ready = Promise.all([configReady, storage.ready]);
        const handler = createReadingAssistantHandler({extensionId: ID, ready, eligibility,
            run: (request, signal, progress) => conversation.run(request, signal, progress, isUserscriptPrivateContext())});
        const sessions = createReadingSessionHandler({extensionId: ID, optionsUrl: OPTIONS_URL, ready,
            eligibility, store: storage.sessions, privateContext: isUserscriptPrivateContext});
        const memories = createLearningMemoryHandler({extensionId: ID, optionsUrl: OPTIONS_URL, ready: configReady,
            store: storage.memories, privateContext: isUserscriptPrivateContext,
            eligibility: source => !ownerCurrent(source) ? INACTIVE.error : siteBlocked() ? '当前网站已禁用扩展' : undefined,
            cancelActive: cancel});
        const configurationKey = () => {
            const {service, model} = resolveHarnessModel(config);
            return JSON.stringify([config.on, config.to, config.uiLanguage, config.disabledExtensionDomains,
                {...config.harness, service: undefined, model: undefined, trigger: undefined, customHotkey: undefined,
                    hoverDelay: undefined, defaultAction: undefined}, getHarnessModelInputKey(config, service, model)]);
        };
        let key = configurationKey();
        const result = {
            handler,
            attach: (port: UserscriptRuntimePort, source: ReadingSender) => attachReadingStreamPort({...port, sender: source} as ReadingStreamPort, handler),
            async handle(message: any, source: ReadingSender) {
                await ready;
                if (!ownerCurrent(source)) return INACTIVE;
                if (typeof message.action === 'string' && message.action.startsWith('sessions-')) return sessions(message, source);
                if (typeof message.action === 'string' && message.action.startsWith('memory-')) return memories(message, source);
                return handler.handle(message, source);
            },
            configurationChanged() {
                const next = configurationKey();
                if (key !== next) cancel();
                key = next;
                handler.cancelDisallowed();
            },
            dispose() {handler.dispose();},
        };
        live = result;
        if (disposed) result.dispose();
        await ready;
        if (!disposed && !isUserscriptPrivateContext()) void storage.sessions.prune().catch(() => undefined);
        return result;
    }
    function dispose() {
        if (disposed) return;
        disposed = true;
        cancel();
        globalThis.window?.removeEventListener('pagehide', pagehide);
        globalThis.window?.removeEventListener('pageshow', pageshow);
        globalThis.window?.removeEventListener('popstate', routeChanged);
        globalThis.window?.removeEventListener('hashchange', routeChanged);
        globalThis.document?.removeEventListener('fluentread-route-change', routeChanged);
        live?.dispose();
        stopConfig();
    }
    const load = () => backend ??= initialize().catch(error => {
        live?.dispose(); live = undefined; backend = undefined; throw error;
    });
    return {
        async handle(message: unknown) {
            if (disposed || suspended) return INACTIVE;
            routeChanged();
            const source = sender();
            try {return await (await load()).handle(message, source);} catch {return {success: false, error: '阅读助手初始化失败，请重试'};}
        },
        connect(port: UserscriptRuntimePort) {
            if (disposed || suspended) {port.disconnect(); return;}
            routeChanged();
            const source = sender();
            let connected = true;
            ports.add(port);
            const disconnect = () => {connected = false; ports.delete(port); port.onDisconnect.removeListener(disconnect);};
            port.onDisconnect.addListener(disconnect);
            void load().then(value => {
                if (!connected || !ownerCurrent(source)) {port.disconnect(); return;}
                value.attach(port, source);
            }).catch(() => port.disconnect());
        },
        dispose,
    };
}

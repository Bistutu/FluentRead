/**
 * @file src/app/background/harnessRuntime.ts
 * 文件职责：把阅读卡后台处理器组装到扩展配置、Harness 服务和浏览器标签页生命周期。
 * 主要内容：绑定流式端口、本机三十天会话、长期记忆管理与清理闹钟；使用统一有效模型身份识别配置变化，包含B站匿名服务固定模型；配置停用、记忆变更、网站禁用及标签导航时取消请求，记忆管理同时使在途写作失效。
 * 模块边界：这是应用组合根，不实现选区、消息校验、会话或模型协议；对应规则和异步所有权由 reading-assistant/background 及 services/harness 验证。
 */
import browser from 'webextension-polyfill';
import {config, configReady, subscribeConfig} from '@/src/services/config/store';
import {createReadingAssistantHandler} from '@/src/features/reading-assistant/background';
import {createHarnessRuntime} from '@/src/services/harness/runtime';
import {createHarnessConversationRuntime} from '@/src/services/harness/conversation';
import {harnessSessionRepository} from '@/src/platform/storage/harnessSessionRepository';
import {attachReadingStreamPort} from '@/src/features/reading-assistant/streamPort';
import {createReadingSessionHandler} from '@/src/features/reading-assistant/sessionHandler';
import {createLearningMemoryHandler} from '@/src/features/reading-assistant/memoryHandler';
import {learningMemoryRepository} from '@/src/platform/storage/learningMemoryRepository';
import {createLearningMemoryRecall} from '@/src/services/harness/memoryRecall';
import {getModelUsageRepository} from '@/src/platform/storage/modelUsageRepository';
import {isExtensionDisabledOnSite} from '@/src/core/site-rules/domain';
import type {BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';
import type {ReadingSender} from '@/src/features/reading-assistant/background';
import type {Config} from '@/src/core/config/model';
import {resolveHarnessModel} from '@/src/core/config/harness';
import {getHarnessModelInputKey} from '@/src/services/harness/modelGateway';

export function installHarnessBackgroundRuntime(cancelWriting?: () => void): BackgroundMessageHandler<{sender?: ReadingSender}> {
    const runtime = createHarnessRuntime(() => config, () => {
        const generation = getModelUsageRepository().captureGeneration();
        return event => { void getModelUsageRepository().recordMany([event], generation).catch(() => undefined); };
    }, {recall: createLearningMemoryRecall(learningMemoryRepository)});
    const eligibility = (sender: ReadingSender) => {
            if (!config.on || !config.harness.enabled) return '阅读理解已停用';
            if (isExtensionDisabledOnSite(sender.url || '', config.disabledExtensionDomains)
                || isExtensionDisabledOnSite(sender.tab?.url || '', config.disabledExtensionDomains)) return '当前网站已禁用扩展';
            return undefined;
    };
    const conversation = createHarnessConversationRuntime({runtime, store: harnessSessionRepository, preferences: () => config.harness});
    const ready = Promise.all([configReady, browser.extension.inIncognitoContext ? undefined : harnessSessionRepository.recoverInterrupted().catch(() => undefined)]);
    const handler = createReadingAssistantHandler({
        extensionId: browser.runtime.id,
        ready,
        eligibility,
        run: (request, signal, progress, sender) => conversation.run(request, signal, progress, Boolean(sender?.tab?.incognito || browser.extension.inIncognitoContext)),
    });
    const sessions = createReadingSessionHandler({
        extensionId: browser.runtime.id, optionsUrl: browser.runtime.getURL('options.html'),
        ready, eligibility, store: harnessSessionRepository,
        privateContext: () => Boolean(browser.extension.inIncognitoContext),
    });
    const memories = createLearningMemoryHandler({
        extensionId: browser.runtime.id, optionsUrl: browser.runtime.getURL('options.html'),
        ready: configReady, store: learningMemoryRepository,
        privateContext: () => Boolean(browser.extension.inIncognitoContext),
        eligibility: sender => isExtensionDisabledOnSite(sender.url || '', config.disabledExtensionDomains)
            || isExtensionDisabledOnSite(sender.tab?.url || '', config.disabledExtensionDomains) ? '当前网站已禁用扩展' : undefined,
        cancelActive: () => { handler.cancelAll(); cancelWriting?.(); },
    });
    browser.runtime.onConnect.addListener(port => attachReadingStreamPort(port, handler));
    const prune = () => { if (!browser.extension.inIncognitoContext) void harnessSessionRepository.prune().catch(() => undefined); };
    prune();
    browser.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'fluentReadHarnessSessionCleanup') prune(); });
    void Promise.resolve(browser.alarms.create('fluentReadHarnessSessionCleanup', {periodInMinutes: 60})).catch(() => undefined);
    const configurationKey = (next: Config) => {
        const {service, model} = resolveHarnessModel(next);
        return JSON.stringify([next.on, next.to, next.uiLanguage,
            {...next.harness, service: undefined, model: undefined, trigger: undefined, customHotkey: undefined, hoverDelay: undefined, defaultAction: undefined},
            getHarnessModelInputKey(next, service, model)]);
    };
    let preferencesKey = configurationKey(config);
    subscribeConfig(next => {
        const nextKey = configurationKey(next);
        if (nextKey !== preferencesKey) handler.cancelAll();
        preferencesKey = nextKey;
        handler.cancelDisallowed();
    });
    browser.tabs.onRemoved.addListener(tabId => handler.cancelTab(tabId));
    browser.tabs.onUpdated.addListener((tabId, change) => {
        if (change.status === 'loading' || change.url) handler.cancelTab(tabId);
    });
    return {type: 'fluentReadHarness', handle: (message, context) => {
        const sender = context.sender ?? {};
        if (message && typeof message === 'object' && 'action' in message && typeof message.action === 'string' && message.action.startsWith('sessions-')) return sessions(message, sender);
        if (message && typeof message === 'object' && 'action' in message && typeof message.action === 'string' && message.action.startsWith('memory-')) return memories(message, sender);
        return handler.handle(message, sender);
    }};
}

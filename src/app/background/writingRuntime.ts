/**
 * @file src/app/background/writingRuntime.ts
 * 文件职责：将写作后台接入已有配置、模型用量与浏览器生命周期。
 * 主要内容：装配端口、服务和只读学习记忆，顶层页面使用浏览器提供的同源标签地址识别页内导航后的写作场景，子框架保留自身地址；按可信发送者隔离隐私窗口，配置变更、网站停用、标签关闭或导航时取消生成。
 * 模块边界：只负责组合，不读取网页，不实现提示词和编辑器写回。
 */
import type {Config} from '@/src/core/config/model';
import {isWritingPage} from '@/src/core/config/writing';
import browser from 'webextension-polyfill';
import {config, configReady, subscribeConfig} from '@/src/services/config/store';
import {isExtensionDisabledOnSite} from '@/src/core/site-rules/domain';
import {createWritingHandler, type WritingSender} from '@/src/features/writing-assistant/background';
import {createWritingRuntime} from '@/src/services/writing/runtime';
import {createLearningMemoryRecall} from '@/src/services/harness/memoryRecall';
import {learningMemoryRepository} from '@/src/platform/storage/learningMemoryRepository';
import {getModelUsageRepository} from '@/src/platform/storage/modelUsageRepository';
import {resolveWritingReadiness} from '@/src/core/config/writingReadiness';
import {getHarnessModelInputKey} from '@/src/services/harness/modelGateway';

function resolveWritingSenderUrl(sender: WritingSender): string {
    if (sender.frameId !== 0) return sender.url || '';
    try {
        // MessageSender.url 可能仍是内容脚本初次注入时的地址，标签地址才反映 GitHub 页内导航后的当前路由。
        const page = new URL(sender.tab?.url || '');
        return page.origin === new URL(sender.url || '').origin ? page.href : '';
    } catch { return ''; }
}

export function installWritingBackgroundRuntime(): () => void {
    const handler = createWritingHandler({
        extensionId: browser.runtime.id, optionsUrl: browser.runtime.getURL('options.html'), ready: configReady,
        eligibility: sender => {
            if (!isWritingPage(resolveWritingSenderUrl(sender))) return '写作助手仅支持 Gmail 邮件与 GitHub 新建 Issue、Issue/PR 回复页面';
            if (!config.on || !config.writing.enabled) return '写作助手已停用';
            const domains = [...config.disabledExtensionDomains, ...config.writing.disabledDomains];
            if (isExtensionDisabledOnSite(sender.url!, domains) || isExtensionDisabledOnSite(sender.tab?.url || '', domains)) return '当前网站已禁用写作助手';
            return undefined;
        },
        run: (request, signal, progress, sender) => {
            const generation = getModelUsageRepository().captureGeneration();
            return createWritingRuntime(() => config, event => {
                void getModelUsageRepository().recordMany([event], generation).catch(() => undefined);
            }, {recall: createLearningMemoryRecall(learningMemoryRepository)})(request, signal, progress, Boolean(sender.tab?.incognito || browser.extension.inIncognitoContext));
        },
    });
    browser.runtime.onConnect.addListener(port => handler.connect(port));
    const configurationKey = (next: Config) => {
        const {service, model} = resolveWritingReadiness(next, false);
        return JSON.stringify([next.on, next.to, next.harness.memoryEnabled,
            {...next.writing, service: undefined, model: undefined, referenceLanguage: undefined}, next.disabledExtensionDomains,
            getHarnessModelInputKey(next, service, model)]);
    };
    let previous = configurationKey(config);
    subscribeConfig(next => {
        const key = configurationKey(next);
        if (key !== previous) handler.cancelAll();
        previous = key;
    });
    browser.tabs.onRemoved.addListener(tabId => handler.cancelTab(tabId));
    browser.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'loading' || change.url) handler.cancelTab(tabId); });
    return () => handler.cancelAll();
}

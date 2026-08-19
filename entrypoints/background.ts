import {_service} from "@/entrypoints/service/_service";
import {translateMicrosoftTexts} from "@/entrypoints/service/microsoft";
import {
    applyConfigHistoryAction,
    config,
    configReady,
    CONFIG_HISTORY_MESSAGE,
    CONFIG_PERSIST_MESSAGE,
    saveConfig,
    subscribeConfig,
} from "@/entrypoints/utils/config";
import {CONNECTION_TEST_MESSAGE, CONTEXT_MENU_IDS, getMimoEndpoint, MINIMAX_ENDPOINTS} from "@/entrypoints/utils/constant";
import {getMissingCredentialMessage} from "@/entrypoints/utils/configValidation";
import {resolveConfiguredModel, services, servicesType} from "@/entrypoints/utils/option";
import {synthesizeEdgeTts} from "@/entrypoints/utils/edgeTts";
import {
    buildTranslationCacheKey,
    translationCache,
} from "@/entrypoints/utils/translationCache";
import {
    downloadImageOcrLanguagesWithOffscreen,
    playSelectionTtsWithOffscreen,
    recognizeImageWithOffscreen,
    stopSelectionTtsWithOffscreen,
    translateAreaWithOffscreen,
    translateImageWithOffscreen,
} from "@/entrypoints/service/chrome-translator";
import { imageBufferToDataUrl, MAX_REMOTE_IMAGE_BYTES, normalizeRemoteImageUrl } from "@/entrypoints/utils/imageFetch";
import {
    formatConnectionTestError,
    runTranslationServiceConnectionTest,
} from "@/entrypoints/service/connection-test";
import type { AreaTranslationSelection } from "@/entrypoints/utils/areaTranslationCore";
import {buildPageSummaryPrompt, buildPageSummarySystemPrompt} from "@/entrypoints/utils/template";
import {
    getRequiredImageOcrLanguages,
    IMAGE_OCR_LANGUAGE_PACKS,
    IMAGE_OCR_LANGUAGE_STATE_KEY,
    normalizeImageOcrLanguageCodes,
    type ImageOcrLanguageCode,
} from "@/entrypoints/utils/imageOcrLanguages";
import {getTranslationLanguages, type TranslationLanguageOverride} from "@/entrypoints/utils/translationLanguage";

// 翻译状态管理
let translationStateMap = new Map<number, boolean>(); // tabId -> isTranslated

/**
 * 在background脚本中调用微软翻译API（避免Firefox CORS问题）
 */
async function translateWithMicrosoftInBackground(text: string, targetLang: string): Promise<string> {
    const translations = await translateMicrosoftTexts([text], '', targetLang);
    const translatedText = translations[0];
    if (translatedText === undefined) {
        throw new Error('微软翻译未返回译文');
    }
    return translatedText;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

interface TranslationRequestMessageBase {
    context?: string;
    pageContext?: string;
    useCache?: boolean;
    /** 视频字幕使用的独立翻译服务；普通网页请求不设置。 */
    serviceOverride?: string;
    /** 翻译中心仅对当前请求使用的语言，不改变全局设置。 */
    sourceLanguage?: string;
    targetLanguage?: string;
}

type TranslationSingleRequestMessage = TranslationRequestMessageBase & { origin: string };
type TranslationBatchRequestMessage = TranslationRequestMessageBase & { origin: string[] };
type TranslationRequestMessage = TranslationSingleRequestMessage | TranslationBatchRequestMessage;

async function getDownloadedImageOcrLanguages(): Promise<ImageOcrLanguageCode[]> {
    const stored = await browser.storage.local.get(IMAGE_OCR_LANGUAGE_STATE_KEY);
    return normalizeImageOcrLanguageCodes(stored[IMAGE_OCR_LANGUAGE_STATE_KEY]);
}

async function markImageOcrLanguagesDownloaded(languages: ImageOcrLanguageCode[]): Promise<ImageOcrLanguageCode[]> {
    const downloaded = new Set(await getDownloadedImageOcrLanguages());
    languages.forEach(language => downloaded.add(language));
    const next = normalizeImageOcrLanguageCodes([...downloaded]);
    await browser.storage.local.set({ [IMAGE_OCR_LANGUAGE_STATE_KEY]: next });
    return next;
}

async function assertImageOcrLanguagesDownloaded(sourceLanguage: string): Promise<void> {
    const downloaded = new Set(await getDownloadedImageOcrLanguages());
    const missing = getRequiredImageOcrLanguages(sourceLanguage).filter(language => !downloaded.has(language));
    if (missing.length === 0) return;

    const labels = new Map(IMAGE_OCR_LANGUAGE_PACKS.map(pack => [pack.code, pack.label]));
    const missingLabels = missing.map(language => labels.get(language) || language).join('、');
    throw new Error(`图片文字识别需要先下载${missingLabels}语言包，请前往设置 > 图片翻译下载`);
}

function isAreaTranslationSelection(value: unknown): value is AreaTranslationSelection {
    if (!value || typeof value !== 'object') return false;
    const selection = value as Record<string, unknown>;
    return ['left', 'top', 'width', 'height', 'viewportWidth', 'viewportHeight'].every(key => typeof selection[key] === 'number' && Number.isFinite(selection[key]))
        && Number(selection.width) >= 12
        && Number(selection.height) >= 12
        && Number(selection.viewportWidth) > 0
        && Number(selection.viewportHeight) > 0;
}

type CacheRequestMode = 'single' | 'batch';

const TRANSLATION_CACHE_CLEANUP_ALARM = 'fluentread-translation-cache-cleanup';
let configPersistQueue: Promise<void> = Promise.resolve();
const latestConfigSequenceByClient = new Map<string, number>();

interface ActiveSelectionTts {
    tabId: number;
    requestId: number;
}

let activeSelectionTts: ActiveSelectionTts | null = null;

async function stopActiveSelectionTts(): Promise<void> {
    const active = activeSelectionTts;
    activeSelectionTts = null;
    if (!active) return;
    await stopSelectionTtsWithOffscreen(active.requestId).catch(() => undefined);
}

function googleSelectionTtsUrl(text: string, language: string): string {
    return `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(language)}&client=tw-ob&q=${encodeURIComponent(text)}`;
}

async function forwardSelectionTtsState(message: any): Promise<void> {
    const tabId = Number.isInteger(message.tabId) ? message.tabId : null;
    const requestId = Number.isInteger(message.requestId) ? message.requestId : null;
    if (tabId === null || requestId === null) return;
    const active = activeSelectionTts;
    if (active && active.tabId === tabId && active.requestId === requestId) {
        activeSelectionTts = null;
    }
    await browser.tabs.sendMessage(tabId, {
        type: 'selectionTtsState',
        requestId,
        state: message.state,
        error: typeof message.error === 'string' ? message.error : undefined,
    }).catch(() => undefined);
}

async function fetchImageForOcr(source: string): Promise<string> {
    const url = normalizeRemoteImageUrl(source);
    const response = await fetch(url, { credentials: 'omit', redirect: 'follow' });
    if (!response.ok) {
        throw new Error(`图片服务器返回 ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_REMOTE_IMAGE_BYTES) {
        throw new Error('图片文件过大');
    }

    const buffer = await response.arrayBuffer();
    return imageBufferToDataUrl(buffer, contentType);
}

function getSelectedModel(service: string): string {
    return resolveConfiguredModel(config.model[service], config.customModel[service]);
}

function isAIContextEnabled(service = config.service): boolean {
    return config.enableAIContext && servicesType.isUseAIContext(service, getSelectedModel(service));
}

function getProviderEndpoint(service: string): string {
    if (config.proxy[service]) return config.proxy[service];
    if (service === 'custom') return config.custom;
    if (service === 'deeplx') return config.deeplx;
    if (service === 'newapi') return config.newApiUrl;
    if (service === services.minimax) {
        const plan = config.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg';
        const region = config.minimaxRegion === 'cn' ? 'cn' : 'global';
        return MINIMAX_ENDPOINTS[plan][region];
    }
    if (service === services.mimo) {
        return getMimoEndpoint(config.mimoBillingPlan, config.mimoRegion);
    }
    return '';
}

function buildCacheKey(
    origin: string | string[],
    context: string,
    pageContext: string,
    mode: CacheRequestMode,
    serviceOverride?: string,
    languageOverride?: TranslationLanguageOverride,
): string {
    const service = serviceOverride || config.service;
    const {sourceLanguage, targetLanguage} = getTranslationLanguages(languageOverride);

    return buildTranslationCacheKey({
        requestMode: mode,
        sourceText: origin,
        sourceLanguage,
        targetLanguage,
        service,
        model: getSelectedModel(service),
        endpoint: getProviderEndpoint(service),
        azureOpenaiEndpoint: service === 'azureOpenai' ? config.azureOpenaiEndpoint : undefined,
        robotId: service === 'cozecom' || service === 'cozecn'
            ? config.robot_id[service] || ''
            : undefined,
        customBody: config.customBody[service] || '',
        systemRole: config.system_role[service] || '',
        userRole: config.user_role[service] || '',
        deepseekApiType: config.deepseekApiType,
        deepseekThinkingMode: config.deepseekThinkingMode,
        // DeepL sends the title context to the provider. AI adapters send the
        // bounded webpage context through their prompt templates.
        context: service === 'deepL' ? context : undefined,
        pageContext: isAIContextEnabled(service) ? pageContext : undefined,
    });
}

function isCacheEnabled(message: TranslationRequestMessage): boolean {
    return config.useCache && message.useCache !== false;
}

function isCacheableResult(origin: string, result: unknown): result is string {
    return typeof result === 'string' && result.length > 0 && result !== origin;
}

function getTranslationService(serviceName = config.service) {
    const service = _service[serviceName];
    if (!service) {
        throw new Error(`未找到翻译服务适配器: ${serviceName}`);
    }
    return service;
}

const pendingTranslations = new Map<string, Promise<string>>();
const pendingBatches = new Map<string, Promise<string[]>>();
const pageSummaryCache = new Map<string, string>();
const pendingPageSummaries = new Map<string, Promise<string>>();
const PAGE_SUMMARY_CACHE_SIZE = 8;
const PAGE_SUMMARY_LIMIT = 1200;

function buildPageSummaryCacheKey(pageContext: string, service = config.service): string {
    return buildTranslationCacheKey({
        requestMode: 'page-summary',
        sourceLanguage: config.from,
        targetLanguage: '',
        sourceText: pageContext,
        service,
        model: getSelectedModel(service),
        endpoint: getProviderEndpoint(service),
        customBody: config.customBody[service] || '',
    });
}

function cachePageSummary(key: string, value: string): void {
    if (pageSummaryCache.size >= PAGE_SUMMARY_CACHE_SIZE) {
        const oldestKey = pageSummaryCache.keys().next().value;
        if (oldestKey) pageSummaryCache.delete(oldestKey);
    }
    pageSummaryCache.set(key, value);
}

/**
 * Read Frog generates one short summary per page context and reuses it for
 * the paragraphs that follow. FluentRead keeps the same behavior in the
 * background so the extra request is shared by all content-script callers.
 * A summary failure is deliberately non-fatal: the raw readable context is
 * still useful and the ordinary translation must continue.
 */
async function addPageSummary(pageContext: string, service = config.service): Promise<string> {
    if (!isAIContextEnabled(service) || !pageContext.trim()) {
        return '';
    }

    const key = buildPageSummaryCacheKey(pageContext, service);
    const cached = pageSummaryCache.get(key);
    if (cached) return cached;

    const existing = pendingPageSummaries.get(key);
    if (existing) return existing;

    const request = (async () => {
        try {
            // Keep summaries across MV3 service-worker restarts, matching Read
            // Frog's article-summary cache. Cache failures are swallowed by
            // translationCache and simply fall through to generation.
            const persisted = await translationCache.get(key);
            if (persisted !== null) {
                cachePageSummary(key, persisted);
                return persisted;
            }

            const result = await getTranslationService(service)({
                origin: '',
                context: '',
                pageContext: '',
                summaryPrompt: buildPageSummaryPrompt(pageContext),
                summarySystemPrompt: buildPageSummarySystemPrompt(),
                serviceOverride: service,
            });
            const summary = typeof result === 'string' ? result.trim().slice(0, PAGE_SUMMARY_LIMIT) : '';
            if (!summary) {
                cachePageSummary(key, pageContext);
                return pageContext;
            }

            const summarizedContext = `Page summary (AI-generated reference):\n${summary}\n\n${pageContext}`.slice(0, 4000);
            cachePageSummary(key, summarizedContext);
            await translationCache.set(key, summarizedContext);
            return summarizedContext;
        } catch (error) {
            console.warn('[FluentRead] page context summary failed; using extracted context:', error);
            cachePageSummary(key, pageContext);
            return pageContext;
        }
    })();

    pendingPageSummaries.set(key, request);
    void request.then(
        () => {
            if (pendingPageSummaries.get(key) === request) pendingPageSummaries.delete(key);
        },
        () => {
            if (pendingPageSummaries.get(key) === request) pendingPageSummaries.delete(key);
        },
    );
    return request;
}

async function translateSingleWithCache(
    message: TranslationSingleRequestMessage,
    context: string,
    pageContext: string,
    useCache: boolean,
): Promise<string> {
    const service = message.serviceOverride || config.service;
    if (!useCache) {
        return getTranslationService(service)({...message, context, pageContext});
    }

    const key = buildCacheKey(message.origin, context, pageContext, 'single', service, message);
    const existing = pendingTranslations.get(key);
    if (existing) return existing;

    const request = (async () => {
        const cached = await translationCache.get(key);
        if (cached !== null) return cached;

        const result = await getTranslationService(service)({...message, context, pageContext});
        if (isCacheableResult(message.origin, result)) {
            await translationCache.set(key, result);
        }
        return result as string;
    })();

    pendingTranslations.set(key, request);
    void request.then(
        () => {
            if (pendingTranslations.get(key) === request) pendingTranslations.delete(key);
        },
        () => {
            if (pendingTranslations.get(key) === request) pendingTranslations.delete(key);
        },
    );
    return request;
}

async function translateBatchWithCache(
    message: TranslationBatchRequestMessage,
    context: string,
    pageContext: string,
    useCache: boolean,
): Promise<string[]> {
    const service = message.serviceOverride || config.service;
    if (!useCache) {
        const result = await getTranslationService(service)({...message, context, pageContext});
        if (!Array.isArray(result)) throw new Error('批量翻译返回格式异常');
        return result as string[];
    }

    const batchKey = buildCacheKey(message.origin, context, pageContext, 'batch', service, message);
    const existing = pendingBatches.get(batchKey);
    if (existing) return existing;

    const request = (async () => {
        const cached = await Promise.all(
            message.origin.map((origin) => translationCache.get(buildCacheKey(origin, context, pageContext, 'batch', service, message))),
        );
        const missingIndexes = cached
            .map((value, index) => value === null ? index : -1)
            .filter((index) => index >= 0);

        if (missingIndexes.length === 0) {
            return cached as string[];
        }

        const missingEntries = missingIndexes.map((index) => ({
            index,
            origin: message.origin[index],
        }));
        const uniqueMissingOrigins = Array.from(
            new Map(
                missingEntries.map(({origin}) => [
                    buildCacheKey(origin, context, pageContext, 'batch', service, message),
                    origin,
                ]),
            ).values(),
        );
        const translated = await getTranslationService(service)({
            ...message,
            context,
            pageContext,
            origin: uniqueMissingOrigins,
        });
        if (!Array.isArray(translated) || translated.length !== uniqueMissingOrigins.length) {
            throw new Error('批量翻译返回数量异常');
        }

        const result = [...cached] as Array<string | null>;
        const translatedByKey = new Map(
            uniqueMissingOrigins.map((origin, index) => [
                buildCacheKey(origin, context, pageContext, 'batch', service, message),
                translated[index],
            ]),
        );
        await Promise.all(missingEntries.map(async ({index, origin}) => {
            const value = translatedByKey.get(buildCacheKey(origin, context, pageContext, 'batch', service, message));
            result[index] = value as string;
            if (isCacheableResult(origin, value)) {
                await translationCache.set(buildCacheKey(origin, context, pageContext, 'batch', service, message), value);
            }
        }));

        return result as string[];
    })();

    pendingBatches.set(batchKey, request);
    void request.then(
        () => {
            if (pendingBatches.get(batchKey) === request) pendingBatches.delete(batchKey);
        },
        () => {
            if (pendingBatches.get(batchKey) === request) pendingBatches.delete(batchKey);
        },
    );
    return request;
}

async function translateWithCache(message: TranslationRequestMessage): Promise<string | string[]> {
    await configReady;
    const serviceOverride = message.serviceOverride;
    const selectedService = serviceOverride || config.service;
    const missingCredentialMessage = getMissingCredentialMessage(selectedService, config);
    if (missingCredentialMessage) throw new Error(missingCredentialMessage);
    if (serviceOverride && !servicesType.machine.has(serviceOverride) && !servicesType.isAI(serviceOverride)) {
        throw new Error('视频字幕翻译服务不可用，请在设置中选择已配置的机器翻译或 AI 服务');
    }
    const context = typeof message.context === 'string' ? message.context : '';
    const rawPageContext = typeof message.pageContext === 'string' ? message.pageContext : '';
    const pageContext = await addPageSummary(rawPageContext, selectedService);
    const useCache = isCacheEnabled(message);

    if (Array.isArray(message.origin)) {
        return translateBatchWithCache(message as TranslationBatchRequestMessage, context, pageContext, useCache);
    }
    return translateSingleWithCache(message as TranslationSingleRequestMessage, context, pageContext, useCache);
}

function setupTranslationCacheCleanup(): void {
    void translationCache.cleanup();
    browser.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === TRANSLATION_CACHE_CLEANUP_ALARM) {
            void translationCache.cleanup();
        }
    });

    void browser.alarms.get(TRANSLATION_CACHE_CLEANUP_ALARM).then((alarm) => {
        if (!alarm) {
            void browser.alarms.create(TRANSLATION_CACHE_CLEANUP_ALARM, {
                delayInMinutes: 1,
                periodInMinutes: 24 * 60,
            });
        }
    });
}

export default defineBackground({
    persistent: {
        safari: false,
    },
    main() {
        const isContextMenuSupported = !!browser.contextMenus;
        let contextMenusReady = false;
        let contextMenuEnabled = true;
        let contextMenuSyncQueue: Promise<void> = Promise.resolve();

        // 更新右键菜单状态。菜单只有一个入口，标题随当前标签页的全文翻译状态切换。
        const updateContextMenus = async (tabId: number) => {
            if (!isContextMenuSupported || !contextMenusReady) return;
            const isTranslated = translationStateMap.get(tabId) || false;

            try {
                await browser.contextMenus.update(CONTEXT_MENU_IDS.TRANSLATE_FULL_PAGE, {
                    enabled: true,
                    title: isTranslated ? '流畅阅读取消翻译' : '流畅阅读翻译',
                });
            } catch (error) {
                console.error('Failed to update context menu:', error);
            }
        };

        // 开发模式会多次重载后台脚本；先清理本扩展已有菜单，避免旧的二级菜单残留。
        const syncContextMenus = () => {
            const requestedEnabled = contextMenuEnabled;
            contextMenuSyncQueue = contextMenuSyncQueue
                .catch(() => undefined)
                .then(async () => {
                    if (requestedEnabled !== contextMenuEnabled) return;
                    contextMenusReady = false;
                    await browser.contextMenus.removeAll();
                    if (!requestedEnabled || requestedEnabled !== contextMenuEnabled) return;

                    await browser.contextMenus.create({
                        id: CONTEXT_MENU_IDS.TRANSLATE_FULL_PAGE,
                        title: '流畅阅读翻译',
                        contexts: ['page', 'selection'],
                    });
                    if (requestedEnabled !== contextMenuEnabled) {
                        await browser.contextMenus.removeAll();
                        return;
                    }

                    contextMenusReady = true;
                    const activeTabs = await browser.tabs.query({ active: true });
                    const activeTab = activeTabs.find((tab) => typeof tab.id === 'number');
                    if (activeTab?.id !== undefined) await updateContextMenus(activeTab.id);
                })
                .catch((error) => {
                    contextMenusReady = false;
                    console.error('Error syncing context menu:', error);
                });
            return contextMenuSyncQueue;
        };

        if (!isContextMenuSupported) {
            console.log("不支持右键菜单");
        } else {
            void configReady.then(() => {
                contextMenuEnabled = config.contextMenuEnabled !== false;
                void syncContextMenus();
                subscribeConfig((nextConfig) => {
                    const nextEnabled = nextConfig.contextMenuEnabled !== false;
                    if (nextEnabled === contextMenuEnabled) return;
                    contextMenuEnabled = nextEnabled;
                    void syncContextMenus();
                });
            });
        }
        setupTranslationCacheCleanup();

        // 监听右键菜单点击事件
        if (isContextMenuSupported) {
            browser.contextMenus.onClicked.addListener((info: any, tab: any) => {
                if (!contextMenuEnabled || info.menuItemId !== CONTEXT_MENU_IDS.TRANSLATE_FULL_PAGE || !tab?.id) return;

                const isTranslated = translationStateMap.get(tab.id) || false;
                browser.tabs.sendMessage(tab.id, {
                    type: 'contextMenuTranslate',
                    action: isTranslated ? 'restore' : 'fullPage',
                }).then((response: any) => {
                    if (response?.status === 'disabled') return;
                    translationStateMap.set(tab.id!, !isTranslated);
                    void updateContextMenus(tab.id!);
                }).catch((error: any) => {
                    console.error('Failed to send message to content script:', error);
                });
            });
        }

        // 监听标签页切换事件，更新菜单状态
        browser.tabs.onActivated.addListener((activeInfo: any) => {
            if (isContextMenuSupported) void updateContextMenus(activeInfo.tabId);
        });

        // 监听标签页更新事件（页面刷新等）
        browser.tabs.onUpdated.addListener((tabId: any, changeInfo: any) => {
            if (changeInfo.status === 'complete') {
                // 页面加载完成，重置翻译状态
                translationStateMap.set(tabId, false);
                if (isContextMenuSupported) void updateContextMenus(tabId);
            }
        });

        // 监听标签页关闭事件，清理状态
        browser.tabs.onRemoved.addListener((tabId: any) => {
            translationStateMap.delete(tabId);
        });

        // 处理翻译请求
        browser.runtime.onMessage.addListener((message: any, sender: any) => {
            return new Promise(async (resolve, reject) => {
                try {
                    // 处理输入框翻译请求
                    if (message.type === 'inputBoxTranslation') {
                        const translatedText = await translateWithMicrosoftInBackground(message.text, message.targetLang);
                        resolve({ success: true, translatedText });
                        return;
                    }

                    if (message.type === 'openOptionsPage') {
                        if (message.section === 'settings-video') {
                            await browser.tabs.create({
                                url: `${browser.runtime.getURL('/options.html')}#settings-video`,
                            });
                        } else {
                            await browser.runtime.openOptionsPage();
                        }
                        resolve({ success: true });
                        return;
                    }

                    if (message.type === 'fullPageTranslationState') {
                        const tabId = sender?.tab?.id;
                        if (typeof tabId === 'number') {
                            translationStateMap.set(tabId, message.isTranslated === true);
                            if (isContextMenuSupported) void updateContextMenus(tabId);
                        }
                        resolve({ success: true });
                        return;
                    }

                    if (message.type === CONFIG_PERSIST_MESSAGE) {
                        const clientId = typeof message.clientId === 'string'
                            ? message.clientId
                            : `${sender?.id || 'legacy'}:${sender?.tab?.id || 'extension'}:${sender?.frameId || 0}`;
                        const sequence = Number.isSafeInteger(message.sequence) ? message.sequence : 0;
                        const lastSequence = latestConfigSequenceByClient.get(clientId) || 0;
                        if (sequence && sequence <= lastSequence) {
                            resolve({ success: true });
                            return;
                        }
                        if (sequence) latestConfigSequenceByClient.set(clientId, sequence);
                        const persist = configPersistQueue
                            .catch(() => undefined)
                            .then(() => {
                                if (sequence && latestConfigSequenceByClient.get(clientId) !== sequence) return;
                                return saveConfig(message.config, {recordHistory: true});
                            });
                        configPersistQueue = persist.catch(() => undefined);
                        await persist;
                        resolve({ success: true });
                        return;
                    }

                    if (message.type === CONNECTION_TEST_MESSAGE) {
                        const service = typeof message.service === 'string' ? message.service : '';
                        await configReady;
                        const result = await runTranslationServiceConnectionTest(service);
                        resolve({ success: true, ...result });
                        return;
                    }

                    if (message.type === CONFIG_HISTORY_MESSAGE) {
                        const action = message.action === 'undo' || message.action === 'redo' || message.action === 'restore'
                            ? message.action
                            : null;
                        if (!action) {
                            resolve({success: false, error: '无效的配置历史操作'});
                            return;
                        }
                        const history = await applyConfigHistoryAction(action, typeof message.version === 'number' ? message.version : undefined);
                        resolve({success: true, history});
                        return;
                    }

                    if (message.type === 'selectionTtsPlaybackState') {
                        await forwardSelectionTtsState(message);
                        resolve({ success: true });
                        return;
                    }

                    if (message.type === 'selectionTtsStop') {
                        const requestId = Number.isSafeInteger(message.requestId) ? message.requestId : undefined;
                        if (activeSelectionTts && (requestId === undefined || activeSelectionTts.requestId === requestId)) {
                            await stopActiveSelectionTts();
                        }
                        resolve({ success: true });
                        return;
                    }

                    if (message.type === 'selectionTts') {
                        const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
                        const requestId = Number.isSafeInteger(message.requestId) ? message.requestId : Date.now();
                        await stopActiveSelectionTts();
                        const result = await synthesizeEdgeTts(message.text, message.language, config.selectionTtsVoices);

                        if (tabId !== null) {
                            activeSelectionTts = { tabId, requestId };
                            try {
                                await playSelectionTtsWithOffscreen({
                                    audioBase64: arrayBufferToBase64(result.audio),
                                    contentType: result.contentType,
                                    tabId,
                                    requestId,
                                });
                                resolve({ success: true, transport: 'offscreen', voice: result.voice });
                                return;
                            } catch (offscreenError) {
                                if (activeSelectionTts?.tabId === tabId && activeSelectionTts.requestId === requestId) {
                                    activeSelectionTts = null;
                                }
                                console.warn('Offscreen TTS playback unavailable, returning page audio:', offscreenError);
                            }
                        }
                        resolve({
                            success: true,
                            audioBase64: arrayBufferToBase64(result.audio),
                            contentType: result.contentType,
                            voice: result.voice,
                            transport: 'page',
                        });
                        return;
                    }

                    if (message.type === 'selectionTtsGoogle') {
                        const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : null;
                        const requestId = Number.isSafeInteger(message.requestId) ? message.requestId : Date.now();
                        const text = typeof message.text === 'string' ? message.text.trim() : '';
                        const language = typeof message.language === 'string' ? message.language : 'en-US';
                        if (!text) throw new Error('TTS 文本为空');

                        await stopActiveSelectionTts();
                        if (tabId === null) {
                            resolve({ success: false, error: '无法确定当前标签页' });
                            return;
                        }

                        activeSelectionTts = { tabId, requestId };
                        try {
                            await playSelectionTtsWithOffscreen({
                                sourceUrl: googleSelectionTtsUrl(text, language),
                                tabId,
                                requestId,
                            });
                            resolve({ success: true, transport: 'offscreen' });
                        } catch (offscreenError) {
                            if (activeSelectionTts?.tabId === tabId && activeSelectionTts.requestId === requestId) {
                                activeSelectionTts = null;
                            }
                            resolve({ success: false, error: offscreenError instanceof Error ? offscreenError.message : String(offscreenError) });
                        }
                        return;
                    }

                    if (message.type === 'clearTranslationCache') {
                        await translationCache.clear();
                        pageSummaryCache.clear();
                        resolve({ success: true });
                        return;
                    }

                    if (message.type === 'fluentReadAreaCapture') {
                        const windowId = sender?.tab?.windowId;
                        if (typeof windowId !== 'number') throw new Error('无法确定当前页面窗口');
                        const image = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
                        if (!image) throw new Error('当前页面截图为空');
                        resolve({ success: true, image });
                        return;
                    }

                    if (message.type === 'fluentReadAreaTranslateCapture') {
                        if (typeof message.image !== 'string' || !message.image.startsWith('data:image/')) {
                            throw new Error('圈选截图数据无效');
                        }
                        if (!isAreaTranslationSelection(message.selection)) throw new Error('圈选区域无效');
                        const sourceLanguage = typeof message.sourceLanguage === 'string' ? message.sourceLanguage : config.from;
                        await assertImageOcrLanguagesDownloaded(sourceLanguage);
                        const result = await translateAreaWithOffscreen(
                            message.image,
                            sourceLanguage,
                            typeof message.title === 'string' ? message.title : '',
                            message.selection,
                        );
                        resolve({ success: true, ...result });
                        return;
                    }

                    if (message.type === 'fluentReadImageOcr') {
                        await assertImageOcrLanguagesDownloaded(message.sourceLanguage);
                        const lines = await recognizeImageWithOffscreen(message.image, message.sourceLanguage);
                        resolve({ success: true, lines });
                        return;
                    }

                    if (message.type === 'fluentReadImageTranslate') {
                        await assertImageOcrLanguagesDownloaded(message.sourceLanguage);
                        const result = await translateImageWithOffscreen(
                            message.image,
                            message.sourceLanguage,
                            typeof message.title === 'string' ? message.title : '',
                        );
                        resolve({ success: true, ...result });
                        return;
                    }

                    if (message.type === 'fluentReadImageTranslateTexts') {
                        const texts = Array.isArray(message.texts)
                            ? message.texts.filter((text: unknown): text is string => typeof text === 'string' && text.trim().length > 0)
                            : [];
                        if (texts.length === 0) throw new Error('图片中没有可翻译文字');
                        const translations = await translateWithCache({
                            origin: texts,
                            context: typeof message.title === 'string' ? message.title : '',
                            pageContext: '',
                            useCache: true,
                        });
                        resolve({ success: true, translations });
                        return;
                    }

                    if (message.type === 'fluentReadImageOcrDownload') {
                        const languages = normalizeImageOcrLanguageCodes(message.languages);
                        await downloadImageOcrLanguagesWithOffscreen(languages);
                        const downloaded = await markImageOcrLanguagesDownloaded(languages);
                        resolve({ success: true, languages: downloaded });
                        return;
                    }

                    if (message.type === 'fluentReadImageFetch') {
                        const image = await fetchImageForOcr(message.url);
                        resolve({ success: true, image });
                        return;
                    }

                    // 处理普通翻译请求；缓存统一在后台处理，避免网页按 Origin
                    // 隔离，也让不同标签页共享同一份结果和 pending 请求。
                    translateWithCache(message)
                        .then(resp => resolve(resp))    // 成功
                        .catch(error => reject(error)); // 失败
                } catch (error) {
                    const errorMessage = message?.type === CONNECTION_TEST_MESSAGE
                        ? formatConnectionTestError(
                            typeof message.service === 'string' ? message.service : '',
                            error,
                        )
                        : error instanceof Error ? error.message : String(error);
                    resolve({ success: false, error: errorMessage });
                }
            });
        });
    }
});

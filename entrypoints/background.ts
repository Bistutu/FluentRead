import {_service} from "@/entrypoints/service/_service";
import {translateMicrosoftTexts} from "@/entrypoints/service/microsoft";
import {config, configReady} from "@/entrypoints/utils/config";
import {CONTEXT_MENU_IDS} from "@/entrypoints/utils/constant";
import {resolveConfiguredModel, servicesType} from "@/entrypoints/utils/option";
import {synthesizeEdgeTts} from "@/entrypoints/utils/edgeTts";
import {
    buildTranslationCacheKey,
    translationCache,
} from "@/entrypoints/utils/translationCache";
import { downloadImageOcrLanguagesWithOffscreen, recognizeImageWithOffscreen } from "@/entrypoints/service/chrome-translator";
import { imageBufferToDataUrl, MAX_REMOTE_IMAGE_BYTES, normalizeRemoteImageUrl } from "@/entrypoints/utils/imageFetch";
import {buildPageSummaryPrompt, buildPageSummarySystemPrompt} from "@/entrypoints/utils/template";
import {
    getRequiredImageOcrLanguages,
    IMAGE_OCR_LANGUAGE_PACKS,
    IMAGE_OCR_LANGUAGE_STATE_KEY,
    normalizeImageOcrLanguageCodes,
    type ImageOcrLanguageCode,
} from "@/entrypoints/utils/imageOcrLanguages";

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

type CacheRequestMode = 'single' | 'batch';

const TRANSLATION_CACHE_CLEANUP_ALARM = 'fluentread-translation-cache-cleanup';

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

function isAIContextEnabled(): boolean {
    return config.enableAIContext && servicesType.isUseAIContext(config.service, getSelectedModel(config.service));
}

function getProviderEndpoint(service: string): string {
    if (config.proxy[service]) return config.proxy[service];
    if (service === 'custom') return config.custom;
    if (service === 'deeplx') return config.deeplx;
    if (service === 'newapi') return config.newApiUrl;
    return '';
}

function buildCacheKey(
    origin: string | string[],
    context: string,
    pageContext: string,
    mode: CacheRequestMode,
): string {
    const service = config.service;

    return buildTranslationCacheKey({
        requestMode: mode,
        sourceText: origin,
        sourceLanguage: config.from,
        targetLanguage: config.to,
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
        pageContext: isAIContextEnabled() && service === config.service ? pageContext : undefined,
    });
}

function isCacheEnabled(message: TranslationRequestMessage): boolean {
    return config.useCache && message.useCache !== false;
}

function isCacheableResult(origin: string, result: unknown): result is string {
    return typeof result === 'string' && result.length > 0 && result !== origin;
}

function getTranslationService() {
    const service = _service[config.service];
    if (!service) {
        throw new Error(`未找到翻译服务适配器: ${config.service}`);
    }
    return service;
}

const pendingTranslations = new Map<string, Promise<string>>();
const pendingBatches = new Map<string, Promise<string[]>>();
const pageSummaryCache = new Map<string, string>();
const pendingPageSummaries = new Map<string, Promise<string>>();
const PAGE_SUMMARY_CACHE_SIZE = 8;
const PAGE_SUMMARY_LIMIT = 1200;

function buildPageSummaryCacheKey(pageContext: string): string {
    return buildTranslationCacheKey({
        requestMode: 'page-summary',
        sourceLanguage: config.from,
        targetLanguage: '',
        sourceText: pageContext,
        service: config.service,
        model: getSelectedModel(config.service),
        endpoint: getProviderEndpoint(config.service),
        customBody: config.customBody[config.service] || '',
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
async function addPageSummary(pageContext: string): Promise<string> {
    if (!isAIContextEnabled() || !pageContext.trim()) {
        return '';
    }

    const key = buildPageSummaryCacheKey(pageContext);
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

            const result = await getTranslationService()({
                origin: '',
                context: '',
                pageContext: '',
                summaryPrompt: buildPageSummaryPrompt(pageContext),
                summarySystemPrompt: buildPageSummarySystemPrompt(),
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
    if (!useCache) {
        return getTranslationService()({...message, context, pageContext});
    }

    const key = buildCacheKey(message.origin, context, pageContext, 'single');
    const existing = pendingTranslations.get(key);
    if (existing) return existing;

    const request = (async () => {
        const cached = await translationCache.get(key);
        if (cached !== null) return cached;

        const result = await getTranslationService()({...message, context, pageContext});
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
    if (!useCache) {
        const result = await getTranslationService()({...message, context, pageContext});
        if (!Array.isArray(result)) throw new Error('批量翻译返回格式异常');
        return result as string[];
    }

    const batchKey = buildCacheKey(message.origin, context, pageContext, 'batch');
    const existing = pendingBatches.get(batchKey);
    if (existing) return existing;

    const request = (async () => {
        const cached = await Promise.all(
            message.origin.map((origin) => translationCache.get(buildCacheKey(origin, context, pageContext, 'batch'))),
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
                    buildCacheKey(origin, context, pageContext, 'batch'),
                    origin,
                ]),
            ).values(),
        );
        const translated = await getTranslationService()({
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
                buildCacheKey(origin, context, pageContext, 'batch'),
                translated[index],
            ]),
        );
        await Promise.all(missingEntries.map(async ({index, origin}) => {
            const value = translatedByKey.get(buildCacheKey(origin, context, pageContext, 'batch'));
            result[index] = value as string;
            if (isCacheableResult(origin, value)) {
                await translationCache.set(buildCacheKey(origin, context, pageContext, 'batch'), value);
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
    const context = typeof message.context === 'string' ? message.context : '';
    const rawPageContext = typeof message.pageContext === 'string' ? message.pageContext : '';
    const pageContext = await addPageSummary(rawPageContext);
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
        const isContextMenuSupported = !!browser.contextMenus
        let contextMenusReady = false

        // 开发模式会多次重载后台脚本。先清理本扩展已有菜单，避免重复 ID。
        const setupContextMenus = async () => {
            if (!isContextMenuSupported) {
                console.log("不支持右键菜单")
                return
            }

            try {
                await browser.contextMenus.removeAll()

                // 创建父菜单
                browser.contextMenus.create({
                    id: 'fluentread-parent',
                    title: 'FluentRead',
                    contexts: ['page', 'selection'],
                });

                // 创建全文翻译子菜单
                browser.contextMenus.create({
                    id: CONTEXT_MENU_IDS.TRANSLATE_FULL_PAGE,
                    title: '全文翻译',
                    parentId: 'fluentread-parent',
                    contexts: ['page', 'selection'],
                });

                // 创建撤销翻译子菜单
                browser.contextMenus.create({
                    id: CONTEXT_MENU_IDS.RESTORE_ORIGINAL,
                    title: '撤销翻译',
                    parentId: 'fluentread-parent',
                    contexts: ['page', 'selection'],
                    enabled: false, // 初始状态为禁用
                });
                contextMenusReady = true
            } catch (error) {
                contextMenusReady = false
                console.error('Error setting up context menu:', error);
            }
        }

        void setupContextMenus()
        setupTranslationCacheCleanup()

        // 更新右键菜单状态
        const updateContextMenus = async (tabId: number) => {
            if (!contextMenusReady) return
            const isTranslated = translationStateMap.get(tabId) || false;

            try {
                // 更新全文翻译菜单项
                await Promise.all([
                    browser.contextMenus.update(CONTEXT_MENU_IDS.TRANSLATE_FULL_PAGE, {
                        enabled: !isTranslated,
                        title: isTranslated ? '全文翻译 (已翻译)' : '全文翻译'
                    }),
                    // 更新撤销翻译菜单项
                    browser.contextMenus.update(CONTEXT_MENU_IDS.RESTORE_ORIGINAL, {
                        enabled: isTranslated,
                        title: isTranslated ? '撤销翻译' : '撤销翻译 (无翻译)'
                    })
                ]);
            } catch (error) {
                console.error('Failed to update context menus:', error);
            }
        };

        // 监听右键菜单点击事件
        if (isContextMenuSupported) {
            browser.contextMenus.onClicked.addListener((info: any, tab: any) => {
                if (!tab?.id) return;

                if (info.menuItemId === CONTEXT_MENU_IDS.TRANSLATE_FULL_PAGE) {
                    browser.tabs.sendMessage(tab.id, {
                        type: 'contextMenuTranslate',
                        action: 'fullPage'
                    }).then(() => {
                        translationStateMap.set(tab.id!, true);
                        void updateContextMenus(tab.id!);
                    }).catch((error: any) => {
                        console.error('Failed to send message to content script:', error);
                    });
                } else if (info.menuItemId === CONTEXT_MENU_IDS.RESTORE_ORIGINAL) {
                    browser.tabs.sendMessage(tab.id, {
                        type: 'contextMenuTranslate',
                        action: 'restore'
                    }).then(() => {
                        translationStateMap.set(tab.id!, false);
                        void updateContextMenus(tab.id!);
                    }).catch((error: any) => {
                        console.error('Failed to send message to content script:', error);
                    });
                }
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
        browser.runtime.onMessage.addListener((message: any) => {
            return new Promise(async (resolve, reject) => {
                try {
                    // 处理输入框翻译请求
                    if (message.type === 'inputBoxTranslation') {
                        const translatedText = await translateWithMicrosoftInBackground(message.text, message.targetLang);
                        resolve({ success: true, translatedText });
                        return;
                    }

                    if (message.type === 'openOptionsPage') {
                        await browser.runtime.openOptionsPage();
                        resolve({ success: true });
                        return;
                    }

                    if (message.type === 'selectionTts') {
                        const result = await synthesizeEdgeTts(message.text, message.language);
                        resolve({
                            success: true,
                            audioBase64: arrayBufferToBase64(result.audio),
                            contentType: result.contentType,
                            voice: result.voice,
                        });
                        return;
                    }

                    if (message.type === 'clearTranslationCache') {
                        await translationCache.clear();
                        pageSummaryCache.clear();
                        resolve({ success: true });
                        return;
                    }

                    if (message.type === 'fluentReadImageOcr') {
                        await assertImageOcrLanguagesDownloaded(message.sourceLanguage);
                        const lines = await recognizeImageWithOffscreen(message.image, message.sourceLanguage);
                        resolve({ success: true, lines });
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
                    resolve({ success: false, error: error instanceof Error ? error.message : String(error) });
                }
            });
        });
    }
});

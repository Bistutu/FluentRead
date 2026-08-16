import {_service} from "@/entrypoints/service/_service";
import {translateMicrosoftTexts} from "@/entrypoints/service/microsoft";
import {config, configReady} from "@/entrypoints/utils/config";
import {CONTEXT_MENU_IDS} from "@/entrypoints/utils/constant";
import {customModelString} from "@/entrypoints/utils/option";
import {
    buildTranslationCacheKey,
    translationCache,
} from "@/entrypoints/utils/translationCache";

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

interface TranslationRequestMessageBase {
    context?: string;
    useCache?: boolean;
}

type TranslationSingleRequestMessage = TranslationRequestMessageBase & { origin: string };
type TranslationBatchRequestMessage = TranslationRequestMessageBase & { origin: string[] };
type TranslationRequestMessage = TranslationSingleRequestMessage | TranslationBatchRequestMessage;

type CacheRequestMode = 'single' | 'batch';

const TRANSLATION_CACHE_CLEANUP_ALARM = 'fluentread-translation-cache-cleanup';

function getSelectedModel(service: string): string {
    return config.model[service] === customModelString
        ? config.customModel[service] || ''
        : config.model[service] || '';
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
        // DeepL sends context to the provider. Other current adapters do not;
        // omitting it there preserves cross-page cache hits.
        context: service === 'deepL' ? context : undefined,
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

async function translateSingleWithCache(
    message: TranslationSingleRequestMessage,
    context: string,
    useCache: boolean,
): Promise<string> {
    if (!useCache) {
        return getTranslationService()(message);
    }

    const key = buildCacheKey(message.origin, context, 'single');
    const existing = pendingTranslations.get(key);
    if (existing) return existing;

    const request = (async () => {
        const cached = await translationCache.get(key);
        if (cached !== null) return cached;

        const result = await getTranslationService()({...message, context});
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
    useCache: boolean,
): Promise<string[]> {
    if (!useCache) {
        const result = await getTranslationService()({...message, context});
        if (!Array.isArray(result)) throw new Error('批量翻译返回格式异常');
        return result as string[];
    }

    const batchKey = buildCacheKey(message.origin, context, 'batch');
    const existing = pendingBatches.get(batchKey);
    if (existing) return existing;

    const request = (async () => {
        const cached = await Promise.all(
            message.origin.map((origin) => translationCache.get(buildCacheKey(origin, context, 'batch'))),
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
                    buildCacheKey(origin, context, 'batch'),
                    origin,
                ]),
            ).values(),
        );
        const translated = await getTranslationService()({
            ...message,
            context,
            origin: uniqueMissingOrigins,
        });
        if (!Array.isArray(translated) || translated.length !== uniqueMissingOrigins.length) {
            throw new Error('批量翻译返回数量异常');
        }

        const result = [...cached] as Array<string | null>;
        const translatedByKey = new Map(
            uniqueMissingOrigins.map((origin, index) => [
                buildCacheKey(origin, context, 'batch'),
                translated[index],
            ]),
        );
        await Promise.all(missingEntries.map(async ({index, origin}) => {
            const value = translatedByKey.get(buildCacheKey(origin, context, 'batch'));
            result[index] = value as string;
            if (isCacheableResult(origin, value)) {
                await translationCache.set(buildCacheKey(origin, context, 'batch'), value);
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
    const useCache = isCacheEnabled(message);

    if (Array.isArray(message.origin)) {
        return translateBatchWithCache(message as TranslationBatchRequestMessage, context, useCache);
    }
    return translateSingleWithCache(message as TranslationSingleRequestMessage, context, useCache);
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

                    if (message.type === 'clearTranslationCache') {
                        await translationCache.clear();
                        resolve({ success: true });
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

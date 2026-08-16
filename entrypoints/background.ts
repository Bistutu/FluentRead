import {_service} from "@/entrypoints/service/_service";
import {translateMicrosoftTexts} from "@/entrypoints/service/microsoft";
import {config} from "@/entrypoints/utils/config";
import {CONTEXT_MENU_IDS} from "@/entrypoints/utils/constant";

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

                    // 处理普通翻译请求
                    _service[config.service](message)
                        .then(resp => resolve(resp))    // 成功
                        .catch(error => reject(error)); // 失败
                } catch (error) {
                    resolve({ success: false, error: error instanceof Error ? error.message : String(error) });
                }
            });
        });
    }
});

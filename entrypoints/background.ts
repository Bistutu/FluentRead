import {_service} from "@/entrypoints/service/_service";
import {config} from "@/entrypoints/utils/config";
import {reportTranslationCount} from "@/entrypoints/utils/influx-reporter";
import {CONTEXT_MENU_IDS} from "@/entrypoints/utils/constant";

// 翻译状态管理
let translationStateMap = new Map<number, boolean>(); // tabId -> isTranslated

/**
 * 在background脚本中调用微软翻译API（避免Firefox CORS问题）
 */
async function translateWithMicrosoftInBackground(text: string, targetLang: string): Promise<string> {
    try {
        // 获取微软翻译的JWT令牌
        const jwtToken = await refreshMicrosoftTokenInBackground();
        
        // 调用微软翻译API
        const response = await fetch(`https://api-edge.cognitive.microsofttranslator.com/translate?from=&to=${targetLang}&api-version=3.0&includeSentenceLength=true&textType=html`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + jwtToken
            },
            body: JSON.stringify([{Text: text}])
        });

        if (response.ok) {
            const result = await response.json();
            return result[0].translations[0].text;
        } else {
            throw new Error(`微软翻译失败: ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        console.error('微软翻译请求失败:', error);
        throw error;
    }
}

/**
 * 在background脚本中刷新微软翻译令牌
 */
async function refreshMicrosoftTokenInBackground(): Promise<string> {
    try {
        const response = await fetch("https://edge.microsoft.com/translate/auth");
        if (response.ok) {
            return await response.text();
        } else {
            throw new Error(`获取微软翻译令牌失败: ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        console.error('获取微软翻译令牌失败:', error);
        throw error;
    }
}

export default defineBackground({
    persistent: {
        safari: false,
    },
    main() {
        // 创建右键菜单项
        try {
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
        } catch (error) {
            console.error('Error setting up context menu:', error);
        }

        // 监听右键菜单点击事件
        browser.contextMenus.onClicked.addListener((info: any, tab: any) => {
            if (!tab?.id) return;
            
            if (info.menuItemId === CONTEXT_MENU_IDS.TRANSLATE_FULL_PAGE) {
                // 发送消息到内容脚本触发全文翻译
                browser.tabs.sendMessage(tab.id, {
                    type: 'contextMenuTranslate',
                    action: 'fullPage'
                }).then(() => {
                    // 更新翻译状态
                    translationStateMap.set(tab.id!, true);
                    updateContextMenus(tab.id!);
                }).catch((error: any) => {
                    console.error('Failed to send message to content script:', error);
                });
            } else if (info.menuItemId === CONTEXT_MENU_IDS.RESTORE_ORIGINAL) {
                // 发送消息到内容脚本撤销翻译
                browser.tabs.sendMessage(tab.id, {
                    type: 'contextMenuTranslate',
                    action: 'restore'
                }).then(() => {
                    // 更新翻译状态
                    translationStateMap.set(tab.id!, false);
                    updateContextMenus(tab.id!);
                }).catch((error: any) => {
                    console.error('Failed to send message to content script:', error);
                });
            }
        });

        // 更新右键菜单状态
        const updateContextMenus = (tabId: number) => {
            const isTranslated = translationStateMap.get(tabId) || false;
            
            try {
                // 更新全文翻译菜单项
                browser.contextMenus.update(CONTEXT_MENU_IDS.TRANSLATE_FULL_PAGE, {
                    enabled: !isTranslated,
                    title: isTranslated ? '全文翻译 (已翻译)' : '全文翻译'
                });
                
                // 更新撤销翻译菜单项
                browser.contextMenus.update(CONTEXT_MENU_IDS.RESTORE_ORIGINAL, {
                    enabled: isTranslated,
                    title: isTranslated ? '撤销翻译' : '撤销翻译 (无翻译)'
                });
            } catch (error) {
                console.error('Failed to update context menus:', error);
            }
        };

        // 监听标签页切换事件，更新菜单状态
        browser.tabs.onActivated.addListener((activeInfo: any) => {
            updateContextMenus(activeInfo.tabId);
        });

        // 监听标签页更新事件（页面刷新等）
        browser.tabs.onUpdated.addListener((tabId: any, changeInfo: any) => {
            if (changeInfo.status === 'complete') {
                // 页面加载完成，重置翻译状态
                translationStateMap.set(tabId, false);
                updateContextMenus(tabId);
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
                    
                    // 处理普通翻译请求
                    _service[config.service](message)
                        .then(resp => resolve(resp))    // 成功
                        .catch(error => reject(error)); // 失败
                } catch (error) {
                    resolve({ success: false, error: error instanceof Error ? error.message : String(error) });
                }
            });
        });

        reportTranslationCount().catch(error => {
            console.error('init report failed:', error);
        });
        setInterval(() => {
            reportTranslationCount().catch(error => {
                console.error('report failed:', error);
            });
        }, 300000);
    }
});

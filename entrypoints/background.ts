import {_service} from "@/entrypoints/service/_service";
import {config} from "@/entrypoints/utils/config";
import {reportTranslationCount} from "@/entrypoints/utils/influx-reporter";

export default defineBackground({
    persistent: {
        safari: false,
    },
    main() {
        // 创建右键菜单项
        browser.contextMenus.create({
            id: 'fluent-read-translate-full-page',
            title: 'FluentRead - 全文翻译',
            contexts: ['page', 'selection'],
        });

        // 监听右键菜单点击事件
        browser.contextMenus.onClicked.addListener((info, tab) => {
            if (info.menuItemId === 'fluent-read-translate-full-page' && tab?.id) {
                // 发送消息到内容脚本触发全文翻译
                browser.tabs.sendMessage(tab.id, {
                    type: 'contextMenuTranslate',
                    action: 'fullPage'
                });
            }
        });

        // 处理翻译请求
        browser.runtime.onMessage.addListener((message: any) => {
            return new Promise((resolve, reject) => {
                // 翻译
                _service[config.service](message)
                    .then(resp => resolve(resp))    // 成功
                    .catch(error => reject(error)); // 失败
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

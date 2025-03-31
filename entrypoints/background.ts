import {_service} from "@/entrypoints/service/_service";
import {config} from "@/entrypoints/utils/config";
import {reportTranslationCount} from "@/entrypoints/utils/influx-reporter";

export default defineBackground({
    persistent: {
        safari: false,
    },
    main() {
        // 注册右键菜单
        browser.contextMenus.create({
            id: "retranslate",
            title: "重新翻译",
            contexts: ["all"]
        });

        // 处理右键菜单点击
        browser.contextMenus.onClicked.addListener((info:any, tab:any) => {
            if (info.menuItemId === "retranslate" && tab?.id) {
                browser.tabs.sendMessage(tab.id, {
                    type: "retranslate",
                    x: info.x,
                    y: info.y
                });
            }
        });

        // 处理翻译请求
        browser.runtime.onMessage.addListener((message: any) => {
            return new Promise((resolve, reject) => {
                // 使用指定的服务或默认服务
                const serviceToUse = message.service || config.service;
                // 翻译
                _service[serviceToUse](message)
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

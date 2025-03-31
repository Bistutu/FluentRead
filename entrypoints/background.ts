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
        browser.contextMenus.onClicked.addListener((info, tab) => {
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

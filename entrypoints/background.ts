import { _service } from "@/entrypoints/service/_service";
import { config } from "@/entrypoints/utils/config";
import { reportTranslationCount } from "@/entrypoints/utils/influx-reporter";

export default defineBackground({
    persistent: {
        safari: false,
    },
    main() {
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
            console.error('初始化上报失败:', error);
        });

        setInterval(() => {
            reportTranslationCount().catch(error => {
                console.error('定时上报失败:', error);
            });
        }, 60000); // 10 min
    }
});

import {_service} from "@/entrypoints/service/_service";
import {Config} from "./utils/model";

export default defineBackground(async () => {

    // 1、获得配置并监控变化
    let config: Config = new Config();
    await storage.getItem('local:config').then((value) => {
        if (typeof value === 'string' && value) config = JSON.parse(value);
    });
    storage.watch('local:config', (newValue, oldValue) => {
        if (typeof newValue === 'string' && newValue) config = JSON.parse(newValue);
    });

    // 2、监听来自 main 的消息
    browser.runtime.onMessage.addListener(message => {
        return new Promise((resolve, reject) => {
            // 翻译
            _service[config.service](config, message)
                .then(resp => resolve(resp))    // 成功
                .catch(error => reject(error)); // 失败
        });
    });
});
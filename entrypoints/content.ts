import {Config} from "./utils/model";
import {cssInject} from "./main/css";
import {handler} from "./main/dom";
import {cache} from "./utils/cache";
import {DoubleClick} from "@/entrypoints/utils/constant";

export default defineContentScript({
    matches: ['<all_urls>'],  // 匹配所有页面
    runAt: 'document_end',  // 在页面加载完成后运行
    async main() {

        cssInject();        // css 样式注入
        cache.cleaner();    // 检测是否清理缓存

        // 获得配置并监控变化
        let config: Config = new Config();
        await storage.getItem('local:config').then((value) => {
            if (typeof value === 'string' && value) Object.assign(config, JSON.parse(value));
        });
        storage.watch('local:config', (newValue, oldValue) => {
            if (typeof newValue === 'string' && newValue) Object.assign(config, JSON.parse(newValue));
        });

        // 鼠标移动事件监听
        const screen = {mouseX: 0, mouseY: 0, hotkeyPressed: false}
        // 1、失去焦点时 hotkeyPressed = false
        window.addEventListener('blur', () => screen.hotkeyPressed = false)
        // 2、抬起快捷按键时 hotkeyPressed = false
        window.addEventListener('keyup', event => {
            if (config.hotkey === event.key) screen.hotkeyPressed = false;
        })
        // 3、按下快捷按键时 hotkeyPressed = true 并翻译节点
        window.addEventListener('keydown', event => {
            if (config.hotkey === event.key) {
                screen.hotkeyPressed = true;
                handler(config, screen.mouseX, screen.mouseY)
            }
        })

        // 4、鼠标移动时更新位置，并根据 hotkeyPressed 决定是否触发翻译
        document.body.addEventListener('mousemove', event => {
            screen.mouseX = event.clientX;
            screen.mouseY = event.clientY;
            if (screen.hotkeyPressed) {
                handler(config, screen.mouseX, screen.mouseY, 25)
            }
        });
        // 5、（手机端）触摸事件，三指触摸时触发翻译（取触摸点中心位置）
        document.body.addEventListener('touchstart', event => {
            if (event.touches.length === 3 && screen.hotkeyPressed) {
                let centerX = (event.touches[0].clientX + event.touches[1].clientX + event.touches[2].clientX) / 3;
                let centerY = (event.touches[0].clientY + event.touches[1].clientY + event.touches[2].clientY) / 3;
                handler(config, centerX, centerY)
            }
        });

        // 6、双击鼠标翻译事件
        document.body.addEventListener('dblclick', event => {
            if (config.hotkey == DoubleClick) {
                // 通过双击事件获取鼠标位置
                let mouseX = event.clientX;
                let mouseY = event.clientY;
                // 调用 handler 函数进行翻译
                handler(config, mouseX, mouseY);
            }
        });


        // background.ts
        browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.message === 'clearCache') {
                cache.clearCurrentHostCache()
            }
            sendResponse();
            return true;
        });
    }
})

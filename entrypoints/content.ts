import { handleTranslation, autoTranslateEnglishPage } from "./main/trans";
import { cache } from "./utils/cache";
import { constants } from "@/entrypoints/utils/constant";
import { getCenterPoint } from "@/entrypoints/utils/common";
import './style.css';
import { config, configReady } from "@/entrypoints/utils/config";

export default defineContentScript({
    matches: ['<all_urls>'],  // 匹配所有页面
    runAt: 'document_end',  // 在页面加载完成后运行
    async main() {
        await configReady // 等待配置加载完成
        if (config.on === false) return; // 如果配置关闭，则不执行任何操作
        // 添加手动翻译事件监听器
        setupManualTranslationTriggers();
        // 添加自动翻译事件监听器
        if (config.autoTranslate) autoTranslationEvent();

        cache.cleaner();    // 检测是否清理缓存

        // background.ts
        browser.runtime.onMessage.addListener((message: { message: string; }, sender: any, sendResponse: () => void) => {
            if (message.message === 'clearCache') cache.clean()
            sendResponse();
            return true;
        });

        // 监听来自 popup 的消息
        browser.runtime.onMessage.addListener((message: { type: string; x?: number; y?: number; }) => {
            if (message.type === 'clearCache') {
                // 清除所有翻译缓存
                clearAllTranslations();
                return Promise.resolve(true); // 返回成功响应
            } else if (message.type === 'exportCache') {
                // 导出缓存
                exportCacheToFile();
                return Promise.resolve(true);
            } else if (message.type === 'retranslate') {
                let x = message.x;
                let y = message.y;
                
                // 如果没有收到坐标，尝试从选区获取
                if (x === undefined || y === undefined) {
                    const selection = window.getSelection();
                    if (selection && selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);
                        const rect = range.getBoundingClientRect();
                        x = rect.left;
                        y = rect.top;
                    }
                }
            
                // 只有在有有效坐标时才进行处理
                if (x !== undefined && y !== undefined) {
                    const element = document.elementFromPoint(x, y) as HTMLElement;
                    if (element) {
                        // 移除所有相关的翻译类和属性
                        element.classList.remove('fluent-read-processed', 'fluent-read-bilingual');
                        element.removeAttribute('data-fr-translated');
                        // 移除翻译结果元素
                        element.querySelectorAll('.fluent-read-bilingual-content').forEach(el => el.remove());
                        // 触发翻译
                        handleTranslation(x, y);
                    }
                }
                return Promise.resolve(true);
            }
        });
    }
})

// 注册所有手动翻译触发事件监听器
function setupManualTranslationTriggers() {
    const screen = { mouseX: 0, mouseY: 0, hotkeyPressed: false, otherKeyPressed: false, hasSlideTranslation: false };
    // 1. 失去焦点时
    window.addEventListener('blur', () => {
        screen.hotkeyPressed = false;
        screen.otherKeyPressed = false;
        screen.hasSlideTranslation = false;
    });

    // 2. 按下按键时
    window.addEventListener('keydown', event => {
        if (config.hotkey === event.key) {
            screen.hotkeyPressed = true;
            screen.otherKeyPressed = false;
        } else if (screen.hotkeyPressed) {
            screen.otherKeyPressed = true;
        }
    });

    // 3. 抬起按键时
    window.addEventListener('keyup', event => {
        if (config.hotkey === event.key) {
            if (!screen.otherKeyPressed && !screen.hasSlideTranslation) {
                handleTranslation(screen.mouseX, screen.mouseY);
            }
            screen.hotkeyPressed = false;
            screen.otherKeyPressed = false;
            screen.hasSlideTranslation = false;
        }
    });

    // 4. 鼠标移动时更新位置，并根据 hotkeyPressed 决定是否触发翻译
    document.body.addEventListener('mousemove', event => {
        screen.mouseX = event.clientX;
        screen.mouseY = event.clientY;
        if (screen.hotkeyPressed) {
            screen.hasSlideTranslation = true;
            handleTranslation(screen.mouseX, screen.mouseY, 50)
        }
    });

    // 5、手机端触摸事件，取中心点翻译
    document.body.addEventListener('touchstart', event => {
        let coordinate;
        switch (config.hotkey) {
            case constants.TwoFinger:
                coordinate = getCenterPoint(event.touches, 2);
                break;
            case constants.ThreeFinger:
                coordinate = getCenterPoint(event.touches, 3);
                break;
            case constants.FourFinger:
                coordinate = getCenterPoint(event.touches, 4);
                break;
            default:
                return
        }

        handleTranslation(coordinate!.x, coordinate!.y);
    });

    // 6、双击鼠标翻译事件
    document.body.addEventListener('dblclick', event => {
        if (config.hotkey == constants.DoubleClick) {
            // 通过双击事件获取鼠标位置
            let mouseX = event.clientX;
            let mouseY = event.clientY;
            // 调用 handleTranslation 函数进行翻译
            handleTranslation(mouseX, mouseY);
        }
    });

    // 7、长按鼠标翻译事件（长按事件时鼠标不能移动）
    let timer: number;
    let startPos = { x: 0, y: 0 }; // startPos 记录鼠标按下时的位置
    document.body.addEventListener('mouseup', () => clearTimeout(timer));
    document.body.addEventListener('mousedown', event => {
        if (config.hotkey === constants.LongPress) {
            clearTimeout(timer); // 清除之前的计时器
            startPos.x = event.clientX; // 记录鼠标按下时的初始位置
            startPos.y = event.clientY;
            timer = setTimeout(() => {
                let mouseX = event.clientX;
                let mouseY = event.clientY;
                handleTranslation(mouseX, mouseY);
            }, 500) as unknown as number;
        }
    });
    document.body.addEventListener('mousemove', event => {
        // 如果鼠标移动超过10像素，取消长按事件
        if (Math.abs(event.clientX - startPos.x) > 10 || Math.abs(event.clientY - startPos.y) > 10) {
            clearTimeout(timer);
        }
    });
    document.body.addEventListener('mousemove', event => {
        // 检测鼠标是否移动，如果鼠标移动超过10像素，取消长按事件
        if (config.hotkey === constants.LongPress
            && Math.abs(event.clientX - startPos.x) > 10 || Math.abs(event.clientY - startPos.y) > 10) {
            clearTimeout(timer);
        }
    });


    // 8、鼠标中键翻译事件
    document.body.addEventListener('mousedown', event => {
        if (config.hotkey === constants.MiddleClick) {
            if (event.button === 1) {
                let mouseX = event.clientX;
                let mouseY = event.clientY;
                handleTranslation(mouseX, mouseY);
            }
        }
    });


    // 9、触屏设备双击/三击翻译事件
    let touchCount = 0;
    let touchTimer: any;
    document.body.addEventListener('touchstart', event => {
        // 检查是否为有效的热键配置，并且只处理单指触摸事件
        if (![constants.DoubleClickScreen, constants.TripleClickScreen].includes(config.hotkey)
            || event.touches.length !== 1) return;

        // 确定需要的点击次数
        const requiredTouches = config.hotkey === constants.DoubleClickScreen ? 2 : 3;

        touchCount++; // 记录触摸次数

        if (touchCount === 1) {
            // 如果是第一次触摸，设置定时器，500ms内没有达到所需的触摸次数则重置
            touchTimer = setTimeout(() => touchCount = 0, 500);
        } else if (touchCount === requiredTouches) {
            // 如果达到了所需的触摸次数，清除定时器并调用翻译处理函数
            clearTimeout(touchTimer);
            touchCount = 0;
            handleTranslation(event.touches[0].clientX, event.touches[0].clientY);
        }
    });
}
// 注册自动翻译事件
function autoTranslationEvent() {
    // 自动翻译英文页面
    autoTranslateEnglishPage();
}

// 清除所有翻译的函数
function clearAllTranslations() {
    // 1. 移除所有翻译结果元素
    document.querySelectorAll('.fluent-read-translation').forEach(el => el.remove());

    // 2. 移除所有加载状态
    document.querySelectorAll('.fluent-read-loading').forEach(el => el.remove());

    // 3. 移除所有错误状态
    document.querySelectorAll('.fluent-read-failure').forEach(el => el.remove());

    // 4. 移除所有翻译相关的类名
    document.querySelectorAll('.fluent-read-processed').forEach(el => {
        el.classList.remove('fluent-read-processed');
    });

    // 5. 清除内存中的缓存
    cache.clean();

    console.log('已清除所有翻译缓存');
}

// 添加导出缓存到文件的函数
async function exportCacheToFile() {
    try {
        const cacheData = await cache.exportCache();
        const blob = new Blob([cacheData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fluent-read-cache-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('导出缓存失败:', error);
    }
}

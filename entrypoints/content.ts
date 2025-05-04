import { handleTranslation, autoTranslateEnglishPage, restoreOriginalContent } from "./main/trans";
import { cache } from "./utils/cache";
import { constants } from "@/entrypoints/utils/constant";
import { getCenterPoint } from "@/entrypoints/utils/common";
import './style.css';
import { config, configReady } from "@/entrypoints/utils/config";
import { mountFloatingBall, unmountFloatingBall, toggleFloatingBallPosition } from "@/entrypoints/utils/floatingBall";
import { cancelAllTranslations } from "@/entrypoints/utils/translateApi";
import { createApp } from 'vue';
import TranslationStatus from '@/components/TranslationStatus.vue';

export default defineContentScript({
    matches: ['<all_urls>'],  // 匹配所有页面
    runAt: 'document_end',  // 在页面加载完成后运行
    async main() {
        await configReady // 等待配置加载完成
        if (config.on === false) return; // 如果配置关闭，则不执行任何操作
        // 添加手动翻译事件监听器
        setupManualTranslationTriggers();
        // 添加悬浮球快捷键事件监听器
        setupFloatingBallHotkey();
        // 添加自动翻译事件监听器
        if (config.autoTranslate) autoTranslationEvent();

        // 挂载悬浮球（如果配置未禁用）
        if (config.disableFloatingBall !== true) {
            // 使用配置中的位置
            mountFloatingBall();
        }
        
        // 挂载翻译状态组件
        mountTranslationStatusComponent();

        cache.cleaner();    // 检测是否清理缓存

        // background.ts
        browser.runtime.onMessage.addListener((message: { message: string; }, sender: any, sendResponse: () => void) => {
            if (message.message === 'clearCache') cache.clean()
            sendResponse();
            return true;
        });
        
        // 处理悬浮球控制消息
        browser.runtime.onMessage.addListener((message: any, sender: any, sendResponse: () => void) => {
            if (message.type === 'toggleFloatingBall') {
                if (message.isEnabled) {
                    mountFloatingBall();
                } else {
                    unmountFloatingBall();
                }
                sendResponse();
                return true;
            }
            return false;
        });
        
        // 在页面卸载时清理资源
        window.addEventListener('beforeunload', () => {
            // 取消所有待处理的翻译任务
            cancelAllTranslations();
            // 移除悬浮球
            unmountFloatingBall();
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

// 设置悬浮球快捷键
function setupFloatingBallHotkey() {
    // 如果快捷键设置为 "none"，则禁用快捷键
    if (config.floatingBallHotkey === 'none') return;

    // 添加全局键盘事件监听
    let hotkeysPressed = new Set<string>();
    let lastKeyDownTime = 0; // 用于防止按键事件重复触发
    
    // 开发环境标志
    const isDev = process.env.NODE_ENV === 'development';
    
    // 检测操作系统类型
    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    
    // 获取当前配置的快捷键
    const getConfiguredHotkeyParts = () => {
        return config.floatingBallHotkey.split('+').map(key => {
            const k = key.toLowerCase();
            // 标准化修饰键名称
            if (k === 'ctrl') return 'control';
            if (k === 'option') return 'alt';
            return k;
        });
    };
    
    if (isDev) {
        console.log(`[FluentRead] 设置悬浮球快捷键: ${config.floatingBallHotkey}, 系统: ${isMac ? 'macOS' : '其他'}`);
    }
    
    // 监听按键按下事件
    document.addEventListener('keydown', (event) => {
        // 防止事件重复触发（某些浏览器可能会重复触发keydown事件）
        const now = Date.now();
        if (now - lastKeyDownTime < 50) return;
        lastKeyDownTime = now;
        
        // 记录修饰键状态
        if (event.altKey) hotkeysPressed.add('alt');
        if (event.ctrlKey || event.metaKey) hotkeysPressed.add('control'); // 在Mac上，metaKey是Command键
        if (event.shiftKey) hotkeysPressed.add('shift');
        
        // 处理字母键
        if (event.code && event.code.startsWith('Key')) {
            const letter = event.code.slice(3).toLowerCase();
            hotkeysPressed.add(letter);
        } else if (event.key && event.key.length === 1) {
            // 对于不是使用code属性的浏览器，使用key属性
            hotkeysPressed.add(event.key.toLowerCase());
        }
        
        // 获取当前配置的快捷键
        const hotkeyParts = getConfiguredHotkeyParts();
        
        // 检查当前按下的键是否匹配配置的快捷键
        const allKeysPressed = hotkeyParts.every(key => hotkeysPressed.has(key));
        const noExtraModifiers = (hotkeyParts.includes('control') || !hotkeysPressed.has('control')) && 
                                (hotkeyParts.includes('alt') || !hotkeysPressed.has('alt')) &&
                                (hotkeyParts.includes('shift') || !hotkeysPressed.has('shift'));
        
        // 如果按键组合匹配配置的快捷键，且没有额外的修饰键
        if (allKeysPressed && noExtraModifiers && !config.disableFloatingBall) {
            // 防止事件继续传播和默认行为
            event.preventDefault();
            event.stopPropagation();
            
            // 通过自定义事件来触发翻译
            document.dispatchEvent(new CustomEvent('fluentread-toggle-translation'));
            
            if (isDev) {
                console.log('[FluentRead] 触发悬浮球翻译');
            }
        }
    });
    
    // 监听按键释放事件
    document.addEventListener('keyup', (event) => {
        // 清除修饰键状态
        if (!event.altKey) hotkeysPressed.delete('alt');
        if (!event.ctrlKey && !event.metaKey) hotkeysPressed.delete('control');
        if (!event.shiftKey) hotkeysPressed.delete('shift');
        
        // 清除字母键状态
        if (event.code && event.code.startsWith('Key')) {
            const letter = event.code.slice(3).toLowerCase();
            hotkeysPressed.delete(letter);
        } else if (event.key && event.key.length === 1) {
            hotkeysPressed.delete(event.key.toLowerCase());
        }
    });
    
    // 页面失焦或切换标签页时，清除所有按键状态
    window.addEventListener('blur', () => {
        hotkeysPressed.clear();
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

/**
 * 挂载翻译状态组件
 */
function mountTranslationStatusComponent() {
    // 创建容器元素
    const container = document.createElement('div');
    container.id = 'fluent-read-translation-status-container';
    document.body.appendChild(container);
    
    // 创建并挂载组件
    const app = createApp(TranslationStatus);
    app.mount(container);
}

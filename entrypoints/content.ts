import { handleTranslation, autoTranslateEnglishPage, restoreOriginalContent } from "./main/trans";
import { constants } from "@/entrypoints/utils/constant";
import { getCenterPoint } from "@/entrypoints/utils/common";
import pageStyles from './style.css?inline';
import { config, configReady } from "@/entrypoints/utils/config";
import { mountFloatingBall, unmountFloatingBall } from "@/entrypoints/utils/floatingBall";
import { mountSelectionTranslator, unmountSelectionTranslator } from "@/entrypoints/utils/selectionTranslator";
import { mountAreaTranslator, unmountAreaTranslator } from "@/entrypoints/utils/areaTranslator";
import { cancelAllTranslations } from "@/entrypoints/utils/translateApi";
import { mountNewApiComponent, unmountNewApiComponent } from "@/entrypoints/utils/newApi";
import { mountImageTranslator, unmountImageTranslator } from "@/entrypoints/utils/imageTranslation";
import {
    getDeepActiveElement,
    getInputBoxText,
    isInputElement,
    matchesInputBoxTrigger,
    removeTriggerSymbols,
    type InputBoxTrigger,
} from "@/entrypoints/utils/inputBox";
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi, type ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import { mountVideoSubtitleTranslation } from './main/videoSubtitle';

let contentScriptContext: ContentScriptContext | null = null;
let inputTooltipUi: ShadowRootContentScriptUi<HTMLElement> | null = null;
let unmountVideoSubtitleTranslation: (() => void) | null = null;

function installPageStyles(ctx: ContentScriptContext) {
    const existing = document.getElementById('fluent-read-page-styles');
    if (existing) return;

    const style = document.createElement('style');
    style.id = 'fluent-read-page-styles';
    style.textContent = pageStyles;
    (document.head ?? document.documentElement).appendChild(style);
    ctx.onInvalidated(() => style.remove());
}

function handleRuntimeMessage(
    message: unknown,
    ctx: ContentScriptContext,
    sendResponse: (response?: unknown) => void,
): boolean {
    if (!message || typeof message !== 'object') return false;
    const payload = message as Record<string, unknown>;

    if (payload.message === 'clearCache') {
        browser.runtime.sendMessage({ type: 'clearTranslationCache' })
            .then(() => sendResponse())
            .catch(() => sendResponse());
        return true;
    }

    if (payload.type === 'toggleFloatingBall') {
        const isEnabled = payload.isEnabled === true;
        config.disableFloatingBall = !isEnabled;
        if (isEnabled) {
            void mountFloatingBall(ctx);
        } else {
            unmountFloatingBall();
        }
        sendResponse();
        return true;
    }

    if (payload.type === 'updateSelectionTranslatorMode') {
        const mode = payload.mode;
        if (mode !== 'disabled' && mode !== 'bilingual' && mode !== 'translation-only') return false;

        config.selectionTranslatorMode = mode;
        config.disableSelectionTranslator = mode === 'disabled';
        if (mode === 'disabled') {
            unmountSelectionTranslator();
        } else if (!document.getElementById('fluent-read-selection-translator-container')) {
            void mountSelectionTranslator(ctx);
        }
        sendResponse();
        return true;
    }

    if (payload.type === 'toggleSelectionAreaTranslator') {
        const isEnabled = payload.isEnabled === true;
        config.selectionAreaEnabled = isEnabled;
        if (isEnabled) {
            void mountAreaTranslator(ctx);
        } else {
            unmountAreaTranslator();
        }
        sendResponse();
        return true;
    }

    if (payload.type === 'toggleImageTranslator') {
        const isEnabled = payload.isEnabled === true;
        config.disableImageTranslator = !isEnabled;
        if (isEnabled) {
            mountImageTranslator();
        } else {
            unmountImageTranslator();
        }
        sendResponse();
        return true;
    }

    if (payload.type === 'contextMenuTranslate') {
        if (config.on === false) {
            sendResponse({ status: 'disabled' });
            return true;
        }
        if (payload.action === 'fullPage') {
            autoTranslateEnglishPage();
            sendResponse({ status: 'success', action: 'translated' });
            return true;
        }
        if (payload.action === 'restore') {
            restoreOriginalContent();
            sendResponse({ status: 'success', action: 'restored' });
            return true;
        }
    }

    return false;
}

export default defineContentScript({
    matches: ['<all_urls>'],  // 匹配所有页面
    runAt: 'document_end',  // 在页面加载完成后运行
    cssInjectionMode: 'ui',
    async main(ctx) {
        contentScriptContext = ctx;
        installPageStyles(ctx);
        await configReady; // 等待配置加载完成

        const pageEventController = new AbortController();
        let runtimeMessageListener: ((message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => boolean) | null = null;
        let cleanedUp = false;
        const cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            pageEventController.abort();
            if (runtimeMessageListener) {
                browser.runtime.onMessage.removeListener(runtimeMessageListener);
            }
            cancelAllTranslations();
            unmountFloatingBall();
            unmountSelectionTranslator();
            unmountAreaTranslator();
            unmountImageTranslator();
            unmountVideoSubtitleTranslation?.();
            unmountVideoSubtitleTranslation = null;
            unmountNewApiComponent();
            removeExistingTooltip();
            contentScriptContext = null;
        };
        ctx.onInvalidated(cleanup);
        window.addEventListener('beforeunload', cleanup, { once: true });

        setupInputBoxTranslation(pageEventController.signal);
        // 视频字幕 Beta 只在 YouTube 播放页监听原生字幕，不采集音频或视频内容。
        unmountVideoSubtitleTranslation = mountVideoSubtitleTranslation();
        runtimeMessageListener = (
            message: unknown,
            _sender: unknown,
            sendResponse: (response?: unknown) => void,
        ) => handleRuntimeMessage(message, ctx, sendResponse);
        browser.runtime.onMessage.addListener(runtimeMessageListener);
        // 保留播放器内的 Beta 状态入口，即使网页翻译总开关被关闭，用户仍能看到并管理视频字幕状态。
        if (config.on === false) return; // 其他网页翻译能力遵循总开关
        // 添加手动翻译事件监听器
        setupManualTranslationTriggers(pageEventController.signal);
        // 添加悬浮球快捷键事件监听器
        setupFloatingBallHotkey(pageEventController.signal);
        // 当悬浮球关闭时，仍然允许使用快捷键进行全文翻译的独立开关
        let isFullPageTranslating = false;
        document.addEventListener('fluentread-toggle-translation', () => {
            // 仅在悬浮球被禁用（未挂载）时由内容脚本接管快捷键
            if (config.disableFloatingBall === true) {
                isFullPageTranslating = !isFullPageTranslating;
                if (isFullPageTranslating) {
                    autoTranslateEnglishPage();
                } else {
                    restoreOriginalContent();
                }
            }
        }, { signal: pageEventController.signal });
        // 添加自动翻译事件监听器
        if (config.autoTranslate) autoTranslateEnglishPage();

        // 挂载悬浮球（如果配置未禁用）
        if (config.disableFloatingBall !== true) {
            // 使用配置中的位置
            await mountFloatingBall(ctx);
            if (cleanedUp) return;
        }
        
        // 挂载划词翻译组件（如果配置未禁用）
        if (config.disableSelectionTranslator !== true) {
            await mountSelectionTranslator(ctx);
            if (cleanedUp) return;
        }
        if (config.selectionAreaEnabled === true) {
            await mountAreaTranslator(ctx);
            if (cleanedUp) return;
        }
        
        mountNewApiComponent();
        // 图片翻译使用独立覆盖层，不改写宿主页面的 img 元素；点击入口由事件委托处理动态图片。
        if (config.disableImageTranslator !== true) mountImageTranslator();

    }
})

// 注册所有手动翻译触发事件监听器
function setupManualTranslationTriggers(signal: AbortSignal) {
    const screen = { mouseX: 0, mouseY: 0, hotkeyPressed: false, otherKeyPressed: false, hasSlideTranslation: false };
    let mouseHotkeysPressed = new Set<string>();
    
    // 获取当前配置的鼠标悬浮快捷键
    const getConfiguredMouseHotkeyParts = () => {
        // 如果选择了自定义快捷键，使用自定义的
        const hotkeyString = config.hotkey === 'custom' 
            ? config.customHotkey 
            : config.hotkey;
        
        if (!hotkeyString || hotkeyString === 'none') {
            return [];
        }
        
        // 如果是旧的单个按键格式，直接返回
        if (!hotkeyString.includes('+')) {
            const k = hotkeyString.toLowerCase();
            // 标准化修饰键名称
            if (k === 'ctrl') return ['control'];
            if (k === 'option') return ['alt'];
            return [k];
        }
        
        // 组合键格式
        return hotkeyString.split('+').map(key => {
            const k = key.toLowerCase();
            // 标准化修饰键名称
            if (k === 'ctrl') return 'control';
            if (k === 'option') return 'alt';
            return k;
        });
    };
    
    // 检查是否匹配鼠标悬浮快捷键
    const checkMouseHotkey = () => {
        const hotkeyParts = getConfiguredMouseHotkeyParts();
        if (hotkeyParts.length === 0) return false;
        
        const allKeysPressed = hotkeyParts.every(key => mouseHotkeysPressed.has(key));
        const exactMatch = allKeysPressed && hotkeyParts.length === mouseHotkeysPressed.size;
        
        return exactMatch;
    };

    // 1. 失去焦点时
    window.addEventListener('blur', () => {
        screen.hotkeyPressed = false;
        screen.otherKeyPressed = false;
        screen.hasSlideTranslation = false;
        mouseHotkeysPressed.clear();
    }, { signal });

    // 2. 按下按键时
    window.addEventListener('keydown', event => {
        // 防止重复事件
        if (event.repeat) return;
        
        // 在 Mac 上禁止 cmd 键参与快捷键
        const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
        if (isMac && event.metaKey) {
            return;
        }
        
        // 记录修饰键
        if (event.altKey) mouseHotkeysPressed.add('alt');
        if (event.ctrlKey) mouseHotkeysPressed.add('control');
        if (event.metaKey && !isMac) mouseHotkeysPressed.add('control'); // 非Mac系统上metaKey映射到control
        if (event.shiftKey) mouseHotkeysPressed.add('shift');
        
        // 处理普通按键
        const key = event.key.toLowerCase();
        const code = event.code?.toLowerCase();
        
        // 处理字母键
        if (code && code.startsWith('key')) {
            const letter = code.slice(3).toLowerCase();
            mouseHotkeysPressed.add(letter);
        } else if (key.length === 1) {
            // 单个字符的按键
            mouseHotkeysPressed.add(key);
        } else if (/^f\d+$/.test(key)) {
            // 功能键 F1-F12
            mouseHotkeysPressed.add(key);
        } else {
            // 特殊键映射
            const specialKeys: Record<string, string> = {
                'escape': 'escape',
                'enter': 'enter',
                'space': 'space',
                'tab': 'tab',
                'backspace': 'backspace',
                'delete': 'delete',
                'insert': 'insert',
                'home': 'home',
                'end': 'end',
                'pageup': 'pageup',
                'pagedown': 'pagedown',
                'arrowup': 'arrowup',
                'arrowdown': 'arrowdown',
                'arrowleft': 'arrowleft',
                'arrowright': 'arrowright'
            };
            if (specialKeys[key]) {
                mouseHotkeysPressed.add(specialKeys[key]);
            }
        }
        
        // 检查是否匹配鼠标悬浮快捷键
        if (checkMouseHotkey()) {
            screen.hotkeyPressed = true;
            screen.otherKeyPressed = false;
        } else if (screen.hotkeyPressed) {
            screen.otherKeyPressed = true;
        }
    }, { signal });

    // 3. 抬起按键时
    window.addEventListener('keyup', event => {
        // 清除字母键状态（在检查前先清除）
        const releasedKey = event.key.toLowerCase();
        const releasedCode = event.code?.toLowerCase();
        if (releasedCode && releasedCode.startsWith('key')) {
            const letter = releasedCode.slice(3).toLowerCase();
            mouseHotkeysPressed.delete(letter);
        } else if (releasedKey.length === 1) {
            mouseHotkeysPressed.delete(releasedKey);
        } else if (/^f\d+$/.test(releasedKey)) {
            mouseHotkeysPressed.delete(releasedKey);
        } else {
            // 特殊键
            const specialKeys: Record<string, string> = {
                'escape': 'escape',
                'enter': 'enter',
                'space': 'space',
                'tab': 'tab',
                'backspace': 'backspace',
                'delete': 'delete',
                'insert': 'insert',
                'home': 'home',
                'end': 'end',
                'pageup': 'pageup',
                'pagedown': 'pagedown',
                'arrowup': 'arrowup',
                'arrowdown': 'arrowdown',
                'arrowleft': 'arrowleft',
                'arrowright': 'arrowright'
            };
            if (specialKeys[releasedKey]) {
                mouseHotkeysPressed.delete(specialKeys[releasedKey]);
            }
        }
        
        // 清除修饰键状态
        if (!event.altKey) mouseHotkeysPressed.delete('alt');
        if (!event.ctrlKey) mouseHotkeysPressed.delete('control');
        if (!event.metaKey) mouseHotkeysPressed.delete('control');
        if (!event.shiftKey) mouseHotkeysPressed.delete('shift');
        
        // 如果当前按键集合为空，且之前激活了快捷键，且配置的快捷键不包含当前释放的键，则触发翻译
        if (screen.hotkeyPressed && mouseHotkeysPressed.size === 0 && !screen.otherKeyPressed && !screen.hasSlideTranslation) {
            // 检查插件是否开启
            if (config.on) {
                handleTranslation(screen.mouseX, screen.mouseY);
            }
        }
        
        // 如果所有按键都释放了，重置状态
        if (mouseHotkeysPressed.size === 0) {
            screen.hotkeyPressed = false;
            screen.otherKeyPressed = false;
            screen.hasSlideTranslation = false;
        }
    }, { signal });

    // 4. 鼠标移动时更新位置，并根据 hotkeyPressed 决定是否触发翻译
    document.body.addEventListener('mousemove', event => {
        screen.mouseX = event.clientX;
        screen.mouseY = event.clientY;
        if (screen.hotkeyPressed && config.on) {
            screen.hasSlideTranslation = true;
            handleTranslation(screen.mouseX, screen.mouseY, 50)
        }
    }, { signal });

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

        // 检查插件是否开启
        if (config.on) {
            handleTranslation(coordinate!.x, coordinate!.y);
        }
    }, { signal });

    // 6、双击鼠标翻译事件
    document.body.addEventListener('dblclick', event => {
        if (config.hotkey == constants.DoubleClick && config.on) {
            // 通过双击事件获取鼠标位置
            let mouseX = event.clientX;
            let mouseY = event.clientY;
            // 调用 handleTranslation 函数进行翻译
            handleTranslation(mouseX, mouseY);
        }
    }, { signal });

    // 7、长按鼠标翻译事件（长按事件时鼠标不能移动）
    let timer: number;
    let startPos = { x: 0, y: 0 }; // startPos 记录鼠标按下时的位置
    document.body.addEventListener('mouseup', () => clearTimeout(timer), { signal });
    document.body.addEventListener('mousedown', event => {
        if (config.hotkey === constants.LongPress) {
            clearTimeout(timer); // 清除之前的计时器
            startPos.x = event.clientX; // 记录鼠标按下时的初始位置
            startPos.y = event.clientY;
            timer = setTimeout(() => {
                if (config.on) {
                    let mouseX = event.clientX;
                    let mouseY = event.clientY;
                    handleTranslation(mouseX, mouseY);
                }
            }, 500) as unknown as number;
        }
    }, { signal });
    document.body.addEventListener('mousemove', event => {
        // 如果鼠标移动超过10像素，取消长按事件
        if (Math.abs(event.clientX - startPos.x) > 10 || Math.abs(event.clientY - startPos.y) > 10) {
            clearTimeout(timer);
        }
    }, { signal });
    // 8、鼠标中键翻译事件
    document.body.addEventListener('mousedown', event => {
        if (config.hotkey === constants.MiddleClick && config.on) {
            if (event.button === 1) {
                let mouseX = event.clientX;
                let mouseY = event.clientY;
                handleTranslation(mouseX, mouseY);
            }
        }
    }, { signal });


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
            if (config.on) {
                handleTranslation(event.touches[0].clientX, event.touches[0].clientY);
            }
        }
    }, { signal });

    signal.addEventListener('abort', () => {
        clearTimeout(timer);
        clearTimeout(touchTimer);
    }, { once: true });
}

// 设置全文翻译快捷键（与悬浮球解耦）
function setupFloatingBallHotkey(signal: AbortSignal) {
    // 如果快捷键设置为 "none"，则禁用快捷键
    if (config.floatingBallHotkey === 'none') return;

    // 添加全局键盘事件监听
    let hotkeysPressed = new Set<string>();
    
    // 开发环境标志
    const isDev = process.env.NODE_ENV === 'development';
    
    // 检测操作系统类型
    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    
    // 获取当前配置的快捷键
    const getConfiguredHotkeyParts = () => {
        // 如果选择了自定义快捷键，使用自定义的
        const hotkeyString = config.floatingBallHotkey === 'custom' 
            ? config.customFloatingBallHotkey 
            : config.floatingBallHotkey;
        
        if (!hotkeyString || hotkeyString === 'none') {
            return [];
        }
        
        return hotkeyString.split('+').map(key => {
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
        // 忽略长按产生的重复事件，但不能用全局时间窗口去重：
        // Alt 和 T 本来就可能在 50ms 内连续到达，时间去重会吞掉合法组合键。
        if (event.repeat) return;
        
        // 在 Mac 上禁止 cmd 键参与快捷键
        if (isMac && event.metaKey) {
            return;
        }
        
        // 记录修饰键状态
        if (event.altKey) hotkeysPressed.add('alt');
        if (event.ctrlKey) hotkeysPressed.add('control');
        if (event.metaKey && !isMac) hotkeysPressed.add('control'); // 非Mac系统上metaKey映射到control
        if (event.shiftKey) hotkeysPressed.add('shift');
        
        // 处理普通按键
        const key = event.key.toLowerCase();
        const code = event.code?.toLowerCase();
        
        // 处理字母键
        if (code && code.startsWith('key')) {
            const letter = code.slice(3).toLowerCase();
            hotkeysPressed.add(letter);
        } else if (key.length === 1) {
            // 单个字符的按键
            hotkeysPressed.add(key);
        } else if (/^f\d+$/.test(key)) {
            // 功能键 F1-F12
            hotkeysPressed.add(key);
        } else {
            // 特殊按键
            const specialKeys: Record<string, string> = {
                'escape': 'escape',
                'enter': 'enter',
                'space': 'space',
                'tab': 'tab',
                'backspace': 'backspace',
                'delete': 'delete',
                'arrowup': 'arrowup',
                'arrowdown': 'arrowdown', 
                'arrowleft': 'arrowleft',
                'arrowright': 'arrowright',
                'home': 'home',
                'end': 'end',
                'pageup': 'pageup',
                'pagedown': 'pagedown',
                'insert': 'insert'
            };
            
            if (specialKeys[key]) {
                hotkeysPressed.add(specialKeys[key]);
            }
        }
        
        // 获取当前配置的快捷键
        const hotkeyParts = getConfiguredHotkeyParts();
        
        // 如果没有配置快捷键，不处理
        if (hotkeyParts.length === 0) {
            return;
        }
        
        // 检查当前按下的键是否完全匹配配置的快捷键
        const allKeysPressed = hotkeyParts.every(key => hotkeysPressed.has(key));
        const exactMatch = allKeysPressed && hotkeyParts.length === hotkeysPressed.size;
        
        // 如果按键组合完全匹配配置的快捷键
        // 无论悬浮球是否启用，都派发统一事件，由对应处理方接管
        if (exactMatch) {
            // 检查插件是否开启
            if (!config.on) return;
            
            // 防止事件继续传播和默认行为
            event.preventDefault();
            event.stopPropagation();
            
            // 通过自定义事件来触发翻译
            document.dispatchEvent(new CustomEvent('fluentread-toggle-translation'));
            
            if (isDev) {
                const activeHotkey = config.floatingBallHotkey === 'custom' 
                    ? config.customFloatingBallHotkey 
                    : config.floatingBallHotkey;
                console.log(`[FluentRead] 触发悬浮球翻译，快捷键: ${activeHotkey}`);
            }
        }
    }, { signal });
    
    // 监听按键释放事件
    document.addEventListener('keyup', (event) => {
        // 清除字母键状态
        const releasedKey = event.key.toLowerCase();
        const releasedCode = event.code?.toLowerCase();
        if (releasedCode && releasedCode.startsWith('key')) {
            const letter = releasedCode.slice(3).toLowerCase();
            hotkeysPressed.delete(letter);
        } else if (releasedKey.length === 1) {
            hotkeysPressed.delete(releasedKey);
        } else if (/^f\d+$/.test(releasedKey)) {
            hotkeysPressed.delete(releasedKey);
        } else {
            // 特殊键
            const specialKeys: Record<string, string> = {
                'escape': 'escape',
                'enter': 'enter',
                'space': 'space',
                'tab': 'tab',
                'backspace': 'backspace',
                'delete': 'delete',
                'arrowup': 'arrowup',
                'arrowdown': 'arrowdown',
                'arrowleft': 'arrowleft',
                'arrowright': 'arrowright',
                'home': 'home',
                'end': 'end',
                'pageup': 'pageup',
                'pagedown': 'pagedown',
                'insert': 'insert'
            };
            if (specialKeys[releasedKey]) {
                hotkeysPressed.delete(specialKeys[releasedKey]);
            }
        }
        
        // 清除修饰键状态
        if (!event.altKey) hotkeysPressed.delete('alt');
        if (!event.ctrlKey) hotkeysPressed.delete('control');
        if (!event.metaKey) hotkeysPressed.delete('control');
        if (!event.shiftKey) hotkeysPressed.delete('shift');
    }, { signal });
    
    // 页面失焦或切换标签页时，清除所有按键状态
    window.addEventListener('blur', () => {
        hotkeysPressed.clear();
    }, { signal });
}

/**
 * 输入框翻译功能
 */
function setupInputBoxTranslation(signal: AbortSignal) {
    let keyPressCount = 0;
    let keyPressTimer: ReturnType<typeof setTimeout> | null = null;
    let lastInputElement: HTMLElement | null = null;
    const TRIPLE_KEY_TIMEOUT = 1000; // 1秒内连续按三下才生效

    const resetKeyPresses = () => {
        keyPressCount = 0;
        lastInputElement = null;
        if (keyPressTimer) {
            clearTimeout(keyPressTimer);
            keyPressTimer = null;
        }
    };

    const handleKeyDown = async (event: KeyboardEvent) => {
        // 检查功能是否启用
        if (config.on === false || config.inputBoxTranslationTrigger === 'disabled') {
            resetKeyPresses();
            return;
        }

        // 从 Shadow DOM 中找到真正的焦点元素，而不是只看宿主节点。
        const activeElement = getDeepActiveElement();
        if (!isInputElement(activeElement)) {
            resetKeyPresses();
            return;
        }

        // 处理不同的触发方式
        const triggerType = config.inputBoxTranslationTrigger;

        if (triggerType === 'ctrl_enter') {
            // Ctrl+Enter 触发
            if (event.ctrlKey && event.key === 'Enter') {
                event.preventDefault();
                await handleInputBoxTranslation(activeElement);
                return;
            }
        } else if (triggerType === 'triple_space' || triggerType === 'triple_equal' || triggerType === 'triple_dash') {
            // 连按三次触发
            if (event.repeat || !matchesInputBoxTrigger(event, triggerType as InputBoxTrigger)) {
                // 如果按的不是目标键，重置计数器
                resetKeyPresses();
                return;
            }

            // 切换输入框后必须重新开始计数，避免把两个输入框的按键拼成一次触发。
            if (lastInputElement !== activeElement) {
                keyPressCount = 1;
                lastInputElement = activeElement;
            } else {
                keyPressCount++;
            }

            // 如果是第三次按下目标键
            if (keyPressCount === 3) {
                event.preventDefault(); // 阻止默认输入
                resetKeyPresses();
                await handleInputBoxTranslation(activeElement);
                return;
            }

            // 设置超时，如果在指定时间内没有连续按满三次，就重置计数器
            if (keyPressTimer) {
                clearTimeout(keyPressTimer);
            }
            keyPressTimer = setTimeout(() => {
                resetKeyPresses();
            }, TRIPLE_KEY_TIMEOUT);
        }
    };

    // 使用捕获阶段，兼容会在冒泡阶段停止传播键盘事件的富文本编辑器。
    document.addEventListener('keydown', handleKeyDown, { capture: true, signal });
    signal.addEventListener('abort', resetKeyPresses, { once: true });
}

/**
 * 设置输入框中的文本
 */
function setInputBoxText(element: HTMLElement, text: string): void {
    const tagName = element.tagName.toLowerCase();
    
    if (tagName === 'input' || tagName === 'textarea') {
        const inputElement = element as HTMLInputElement | HTMLTextAreaElement;
        inputElement.value = text;
        
        // 触发input事件，以便网页能感知到值的变化
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (isInputElement(element)) {
        element.innerText = text;
        
        // 触发input事件
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/**
 * 创建并显示翻译提示弹窗
 */
async function createTranslationTooltip(element: HTMLElement, message: string, type: 'translating' | 'success' | 'error'): Promise<HTMLElement> {
    // 移除已存在的提示
    removeExistingTooltip();

    if (!contentScriptContext) {
        throw new Error('Content script context is not ready');
    }

    const rect = element.getBoundingClientRect();

    inputTooltipUi = await createShadowRootUi<HTMLElement>(contentScriptContext, {
        name: 'fluent-read-input-tooltip-ui',
        position: 'overlay',
        alignment: 'top-left',
        zIndex: 2_147_483_647,
        mode: 'open',
        inheritStyles: false,
        css: `
            :host {
                all: initial !important;
                display: block !important;
                position: relative !important;
                width: 0 !important;
                height: 0 !important;
                overflow: visible !important;
            }
            html, body {
                width: 0 !important;
                height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: visible !important;
            }
            .fluent-input-tooltip {
                position: fixed;
                box-sizing: border-box;
                background: rgba(17, 24, 39, 0.88);
                color: #fff;
                padding: 8px 12px;
                border: 0;
                border-radius: 8px;
                font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                white-space: nowrap;
                z-index: 2147483647;
                pointer-events: none;
                transition: opacity 0.2s ease, transform 0.2s ease;
                backdrop-filter: blur(8px);
                box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
            }
            .fluent-input-tooltip.show { opacity: 1; transform: translateX(-50%) translateY(0); }
            .fluent-input-tooltip.hide { opacity: 0; transform: translateX(-50%) translateY(-5px); }
            .fluent-input-tooltip.translating { background: rgba(59, 130, 246, 0.9); }
            .fluent-input-tooltip.success { background: rgba(34, 197, 94, 0.9); }
            .fluent-input-tooltip.error { background: rgba(239, 68, 68, 0.9); }
        `,
        onMount(container) {
            const tooltip = document.createElement('div');
            tooltip.className = `fluent-input-tooltip ${type}`;
            tooltip.id = 'fluent-input-translation-tooltip';
            tooltip.textContent = `${getTooltipIcon(type)} ${message}`;
            tooltip.style.top = `${rect.bottom + 12}px`;
            tooltip.style.left = `${rect.left + (rect.width / 2)}px`;
            tooltip.style.transform = 'translateX(-50%) translateY(3px)';
            tooltip.style.opacity = config.animations ? '0' : '1';
            container.appendChild(tooltip);
            return tooltip;
        },
    });

    inputTooltipUi.shadowHost.id = 'fluent-input-translation-tooltip-host';
    inputTooltipUi.shadowHost.setAttribute('data-fluent-read-ui', 'input-tooltip');
    inputTooltipUi.mount();

    const tooltip = inputTooltipUi.mounted!;
    
    // 如果禁用动画，直接显示，否则使用淡入效果
    if (!config.animations) {
        tooltip.style.opacity = '1';
        tooltip.style.transform = 'translateX(-50%) translateY(0)';
    } else {
        tooltip.style.opacity = '0';
        setTimeout(() => {
            tooltip.classList.add('show');
        }, 10);
    }
    
    return tooltip;
}

/**
 * 获取提示图标
 */
function getTooltipIcon(type: 'translating' | 'success' | 'error'): string {
    const icons = {
        translating: '•',
        success: '✓',
        error: '!'
    };
    return icons[type];
}

/**
 * 移除现有的提示弹窗
 */
function removeExistingTooltip(): void {
    const ui = inputTooltipUi;
    const existing = ui?.mounted;
    inputTooltipUi = null;
    if (ui && existing) {
        if (!config.animations) {
            // 如果禁用动画，直接移除
            ui.remove();
        } else {
            // 使用淡出动画
            existing.classList.add('hide');
            setTimeout(() => ui.remove(), 300);
        }
    }
}

/**
 * 添加输入框动画效果
 */
function addInputBoxAnimation(element: HTMLElement, animationType: 'translating' | 'success' | 'error'): void {
    // 如果禁用了动画，则不添加动画效果
    if (!config.animations) {
        return;
    }
    
    // 移除已存在的动画类
    element.classList.remove('fluent-input-translating', 'fluent-input-success', 'fluent-input-error');
    
    // 添加新的动画类
    element.classList.add(`fluent-input-${animationType}`);
    
    // 如果不是翻译中的动画，在动画完成后移除类
    if (animationType !== 'translating') {
        setTimeout(() => {
            element.classList.remove(`fluent-input-${animationType}`);
        }, animationType === 'success' ? 1000 : 600);
    }
}

/**
 * 专门用于输入框翻译的微软翻译函数（不使用缓存）
 * 通过background脚本调用，避免Firefox的CORS问题
 */
async function translateWithMicrosoft(text: string, targetLang: string): Promise<string> {
    try {
        // 发送消息给background脚本进行翻译
        const result = await browser.runtime.sendMessage({
            type: 'inputBoxTranslation',
            text: text,
            targetLang: targetLang
        });
        
        if (result && result.success) {
            return result.translatedText;
        } else {
            throw new Error(result?.error || '微软翻译失败');
        }
    } catch (error) {
        console.error('微软翻译请求失败:', error);
        throw error;
    }
}

/**
 * 处理输入框翻译
 */
async function handleInputBoxTranslation(element: HTMLElement): Promise<void> {
    try {
        const originalText = getInputBoxText(element);
        
        if (!originalText) {
            return;
        }
        
        // 根据触发方式去除末尾的触发符号
        const cleanedText = removeTriggerSymbols(originalText, config.inputBoxTranslationTrigger);
        
        if (!cleanedText) {
            return;
        }
        
        // 显示翻译中的动画和提示
        addInputBoxAnimation(element, 'translating');
        await createTranslationTooltip(element, '微软翻译中', 'translating');
        
        try {
            // 直接调用微软翻译API，不使用缓存
            const translatedText = await translateWithMicrosoft(cleanedText, config.inputBoxTranslationTarget);
            
            if (translatedText && translatedText !== cleanedText) {
                // 移除翻译中的动画
                element.classList.remove('fluent-input-translating');
                
                // 设置翻译结果
                setInputBoxText(element, translatedText);
                
                // 显示成功动画和提示
                addInputBoxAnimation(element, 'success');
                removeExistingTooltip();
                await createTranslationTooltip(element, '翻译成功', 'success');
            } else {
                // 翻译结果与原文相同或为空
                element.classList.remove('fluent-input-translating');
                addInputBoxAnimation(element, 'error');
                removeExistingTooltip();
                await createTranslationTooltip(element, '内容无需翻译', 'error');
            }
        } catch (translationError) {
            // 翻译失败
            element.classList.remove('fluent-input-translating');
            addInputBoxAnimation(element, 'error');
            removeExistingTooltip();
            await createTranslationTooltip(element, '微软翻译失败', 'error');
            console.error('微软翻译失败:', translationError);
        }
        
        // 自动隐藏提示
        setTimeout(() => removeExistingTooltip(), 2500);
        
    } catch (error) {
        console.error('输入框翻译失败:', error);
        
        // 移除翻译中的动画
        element.classList.remove('fluent-input-translating');
        
        // 显示错误动画和提示
        addInputBoxAnimation(element, 'error');
        removeExistingTooltip();
        await createTranslationTooltip(element, '翻译服务暂时不可用', 'error');
        
        // 自动隐藏错误提示
        setTimeout(() => removeExistingTooltip(), 3000);
    }
}

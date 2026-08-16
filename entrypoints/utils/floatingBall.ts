import FloatingBall from '@/components/FloatingBall.vue';
import { config, saveConfig } from '@/entrypoints/utils/config';
import browser from 'webextension-polyfill';
import { autoTranslateEnglishPage, restoreOriginalContent } from '@/entrypoints/main/trans';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import { createVueShadowUi, type VueShadowMount } from '@/entrypoints/utils/shadowUi';

let floatingBallInstance: any = null;
let app: any = null;
let floatingBallUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let mountingPromise: Promise<any> | null = null;
let mountRequestId = 0;
let contentScriptContext: ContentScriptContext | null = null;
let isTranslated = false; // 添加状态变量跟踪翻译状态

/**
 * 创建并挂载悬浮球
 * @param position 悬浮球位置 'left' | 'right'，如果不传入则使用配置中的值
 * @returns 
 */
export function mountFloatingBall(ctx?: ContentScriptContext, position?: 'left' | 'right') {
  if (ctx) contentScriptContext = ctx;

  // 如果配置禁用了悬浮球或已存在实例，则不创建
  if (config.disableFloatingBall || floatingBallInstance || mountingPromise) {
    return mountingPromise;
  }

  if (!contentScriptContext) return;

  // 使用传入的位置参数或配置中的位置
  const ballPosition = position || config.floatingBallPosition || 'right';
  const requestId = ++mountRequestId;
  // 更新配置
  config.floatingBallPosition = ballPosition;

  mountingPromise = createVueShadowUi(contentScriptContext, {
    name: 'fluent-read-floating-ball-ui',
    hostId: 'fluent-read-floating-ball-container',
    component: FloatingBall,
    props: {
      position: ballPosition,
      showMenu: true,
      onSettingsClick: () => {
        browser.runtime.sendMessage({ type: 'openOptionsPage' });
      },
      // 添加位置变化事件监听
      onPositionChanged: (newPosition: 'left' | 'right') => {
        // 保存位置到配置
        config.floatingBallPosition = newPosition;

        // 保存配置到存储
        void saveConfig().catch((error) => console.error('Failed to save config:', error));
      },
      // 添加翻译状态变化事件监听
      onTranslationToggle: (isTranslating: boolean) => {
        if (isTranslating === isTranslated) return;

        document.dispatchEvent(new CustomEvent(
          isTranslating ? 'fluentread-translation-started' : 'fluentread-translation-ended',
        ));
        if (isTranslating) {
          void autoTranslateEnglishPage();
        } else {
          restoreOriginalContent();
        }
        isTranslated = isTranslating;
      },
    },
  }).then((ui) => {
    if (requestId !== mountRequestId || config.disableFloatingBall) {
      ui.remove();
      return null;
    }

    floatingBallUi = ui;
    app = ui.mounted?.app ?? null;
    floatingBallInstance = ui.mounted?.instance ?? null;

    return floatingBallInstance;
  }).finally(() => {
    mountingPromise = null;
  });

  return mountingPromise;
}

/**
 * 切换悬浮球翻译状态
 * 通过键盘快捷键触发时使用
 */
export function toggleFloatingBallTranslation() {
  if (!floatingBallInstance) return;
  // 快捷键与鼠标点击必须复用组件的同一条状态切换路径。
  // 组件会负责更新 aria-pressed、展开提示和回调翻译生命周期。
  document.dispatchEvent(new CustomEvent('fluentread-toggle-translation'));
}

/**
 * 卸载悬浮球
 */
export function unmountFloatingBall() {
  mountRequestId++;
  if (floatingBallUi || (floatingBallInstance && app)) {
    if (isTranslated) {
      document.dispatchEvent(new CustomEvent('fluentread-translation-ended'));
      restoreOriginalContent();
      isTranslated = false;
    }
    floatingBallUi?.remove();
    floatingBallUi = null;
    floatingBallInstance = null;
    app = null;
  }
}

/**
 * 切换悬浮球可见性
 */
export function toggleFloatingBall() {
  if (floatingBallInstance) {
    unmountFloatingBall();
    config.disableFloatingBall = true;
  } else {
    config.disableFloatingBall = false;
    mountFloatingBall();
  }
  
  // 保存配置到存储
  void saveConfig().catch((error) => console.error('Failed to save config:', error));
}

/**
 * 切换悬浮球位置
 */
export function toggleFloatingBallPosition() {
  const newPosition = config.floatingBallPosition === 'left' ? 'right' : 'left';
  if (floatingBallInstance) {
    unmountFloatingBall();
    config.floatingBallPosition = newPosition;
    mountFloatingBall(undefined, newPosition);
  } else {
    config.floatingBallPosition = newPosition;
  }
  
  // 保存配置到存储
  void saveConfig().catch((error) => console.error('Failed to save config:', error));
}

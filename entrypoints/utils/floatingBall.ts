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

/** 创建并挂载悬浮球 */
export function mountFloatingBall(ctx?: ContentScriptContext) {
  if (ctx) contentScriptContext = ctx;

  // 如果配置禁用了悬浮球或已存在实例，则不创建
  if (config.disableFloatingBall || floatingBallInstance || mountingPromise) {
    return mountingPromise;
  }

  if (!contentScriptContext) return;

  const ballPosition = config.floatingBallPosition || 'right';
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
      logoUrl: browser.runtime.getURL('/icon/128.png'),
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

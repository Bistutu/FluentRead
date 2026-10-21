/**
 * @file src/app/popup/mount.ts
 * 文件职责：在轻量启动入口唤醒后台后，读取配置并创建 Popup Vue 应用。
 * 主要内容：配置 Promise 结束后确认水合未被阻止，再选择首启轻量根组件或完整主菜单；异步资源完成后复验安全水合状态和最新引导、语言及字体，只准备变化的资源，页面退出后停止挂载；Firefox Android 通过一次公开平台判别限制容器宽度，Safari 触摸宿主由当前输入能力启用填宽，独立扩展标签页通过当前标签 API 确认固定视口，工具栏继续保留固有尺寸；已挂载页面进入往返缓存时暂时释放自有布局标记，恢复时复用宿主判别结果并重验触摸能力，不重读配置或重建应用；挂载前退出、普通退出、失败和卸载保持终止，只清理未被其它宿主接管的自有标记。
 * 模块边界：这里只读取宿主标签页的 id 以确认布局，不读取 URL 或网页内容、不保存配置，也不处理 Popup 业务事件；所有响应式交互在 PopupApp 中，feature 与 runtime 行为通过公开模块完成。
 */
import {createApp, type Component} from 'vue';
import {Coffee} from '@element-plus/icons-vue';
import browser from 'webextension-polyfill';
import {browserCapabilities} from '@/src/platform/browser/capabilities';
import {createUiI18nPlugin} from '@/src/ui/i18n'
import {config, configReady, getConfigHydrationStatus} from '@/src/services/config/store'
import {ensureUiLanguageBundle} from '@/src/platform/i18n/uiLanguageBundles'
import {prepareInterfaceFont} from '@/src/ui/interfaceAppearance'

/** Popup 的唯一组装入口：配置就绪后才创建界面，避免默认布局先绘制。 */
export async function mountPreparedPopupApp(selector: string): Promise<void> {
  const target = typeof window === 'undefined' ? undefined : window;
  const root = document.documentElement;
  let exited = false;
  let mounted = false;
  let disposed = false;
  let persistedHidden = false;
  let androidPlatform = false;
  let tabHosted = false;
  let ownsAndroidWidth = false;
  let ownsSafariTouchWidth = false;
  let ownsTabWidth = false;
  const releaseLayoutMarkers = () => {
    if (ownsAndroidWidth && root.getAttribute('data-fluentread-android-popup') === '') root.removeAttribute('data-fluentread-android-popup');
    ownsAndroidWidth = false;
    if (ownsSafariTouchWidth && root.getAttribute('data-fluentread-safari-touch-popup') === '') root.removeAttribute('data-fluentread-safari-touch-popup');
    ownsSafariTouchWidth = false;
    if (ownsTabWidth && root.getAttribute('data-fluentread-tab-popup') === '') root.removeAttribute('data-fluentread-tab-popup');
    ownsTabWidth = false;
  };
  const releaseContainer = () => {
    exited = true;
    disposed = true;
    target?.removeEventListener('pagehide', onPageHide);
    target?.removeEventListener('pageshow', onPageShow);
    releaseLayoutMarkers();
  };
  const onPageHide = (event: PageTransitionEvent) => {
    if (event.persisted && mounted && !disposed) {
      persistedHidden = true;
      releaseLayoutMarkers();
    } else releaseContainer();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || !persistedHidden || disposed || !mounted) return;
    persistedHidden = false;
    applyLayoutMarkers();
  };
  target?.addEventListener('pagehide', onPageHide);
  target?.addEventListener('pageshow', onPageShow);
  function applyLayoutMarkers() {
    if (disposed || persistedHidden) return;
    // Safari 恢复时重验当前输入能力；仍由其它宿主持有的标记不覆盖。
    if (browserCapabilities.browser === 'safari') {
      try {
        if (target?.matchMedia('(any-pointer: coarse)').matches && !disposed && !persistedHidden
          && !root.hasAttribute('data-fluentread-safari-touch-popup')) {
          root.setAttribute('data-fluentread-safari-touch-popup', '');
          ownsSafariTouchWidth = true;
        }
      } catch {
        // 输入能力不可用时保留固有宽度，不阻断配置或界面组装。
      }
    }
    if (androidPlatform && !disposed && !persistedHidden && !root.hasAttribute('data-fluentread-android-popup')) {
      root.setAttribute('data-fluentread-android-popup', '');
      ownsAndroidWidth = true;
    }
    if (tabHosted && !root.hasAttribute('data-fluentread-tab-popup')) {
      root.setAttribute('data-fluentread-tab-popup', '');
      ownsTabWidth = true;
    }
  }
  applyLayoutMarkers();
  // 只有真实标签页已有固定视口；工具栏 getCurrent 返回 undefined，不依赖启动时的 viewport 协商尺寸。
  void (async () => {
    try {
      const tab = await browser.tabs.getCurrent();
      if (disposed) return;
      const id = tab?.id;
      tabHosted = typeof id === 'number' && Number.isSafeInteger(id) && id >= 0;
      if (tabHosted) applyLayoutMarkers();
    } catch {
      // API 不可用时沿用工具栏固有尺寸；不阻断配置、语言引导或菜单挂载。
    }
  })();
  // Android 容器已有固定视口；桌面固有尺寸不能依赖 viewport 的首次协商结果。
  if (browserCapabilities.browser === 'firefox') {
    void (async () => {
      try {
        const platform = await browser.runtime.getPlatformInfo();
        if (disposed) return;
        androidPlatform = platform.os === 'android';
        applyLayoutMarkers();
      } catch {
        // 平台 API 不可用时保留固有尺寸，不阻断配置、语言引导或翻译菜单。
      }
    })();
  }
  try {
    await configReady;
    if (exited) return;
    if (getConfigHydrationStatus() !== 'ready') throw new Error('Popup configuration is not ready');
    let preparedLanguage: typeof config.uiLanguage | undefined;
    let preparedFont: typeof config.interfaceFont | undefined;
    let onboarding: boolean;
    let App: Component;
    do {
      onboarding = !config.uiLanguageSetupCompleted;
      const language = config.uiLanguage, font = config.interfaceFont;
      const [root] = await Promise.all([
        onboarding ? import('./PopupOnboarding.vue') : import('./PopupApp.vue'),
        onboarding || language === preparedLanguage ? undefined : ensureUiLanguageBundle(language),
        font === preparedFont ? undefined : prepareInterfaceFont(font),
      ]);
      if (exited) return;
      if (getConfigHydrationStatus() !== 'ready') throw new Error('Popup configuration is not ready');
      App = root.default;
      if (!onboarding) preparedLanguage = language;
      preparedFont = font;
      // 模块由浏览器缓存；只补齐加载期间变化的配置，避免首帧先使用旧资源。
    } while (onboarding !== !config.uiLanguageSetupCompleted
      || (!onboarding && preparedLanguage !== config.uiLanguage)
      || preparedFont !== config.interfaceFont);
    const app = createApp(App)
    app.use(createUiI18nPlugin({documentRoot: document.body, documentTitleKey: 'metadata.popupTitle'}))
    app.component('Coffee', Coffee);
    app.onUnmount(releaseContainer);
    // 由唯一的 WXT 启动入口提供挂载目标，避免 app 层假定页面结构。
    app.mount(selector)
    mounted = true;
  } finally {
    if (!mounted) releaseContainer();
  }
}

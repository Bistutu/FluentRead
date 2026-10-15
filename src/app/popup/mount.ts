/**
 * @file src/app/popup/mount.ts
 * 文件职责：在轻量启动入口唤醒后台后，读取配置并创建 Popup Vue 应用。
 * 主要内容：配置 Promise 结束后确认水合未被阻止，再选择首启轻量根组件或完整主菜单；异步资源完成后复验安全水合状态和最新引导、语言及字体，只准备变化的资源，页面退出后停止挂载。
 * 模块边界：这里不读取当前标签页、不保存配置，也不处理 Popup 业务事件；所有响应式交互在 PopupApp 中，feature 与 runtime 行为通过公开模块完成。
 */
import {createApp, type Component} from 'vue';
import {Coffee} from '@element-plus/icons-vue';
import {createUiI18nPlugin} from '@/src/ui/i18n'
import {config, configReady, getConfigHydrationStatus} from '@/src/services/config/store'
import {ensureUiLanguageBundle} from '@/src/platform/i18n/uiLanguageBundles'
import {prepareInterfaceFont} from '@/src/ui/interfaceAppearance'

/** Popup 的唯一组装入口：配置就绪后才创建界面，避免默认布局先绘制。 */
export async function mountPreparedPopupApp(selector: string): Promise<void> {
  const target = typeof window === 'undefined' ? undefined : window;
  let exited = false;
  const onPageHide = () => {exited = true;};
  target?.addEventListener('pagehide', onPageHide);
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
    // 由唯一的 WXT 启动入口提供挂载目标，避免 app 层假定页面结构。
    app.mount(selector)
  } finally {
    target?.removeEventListener('pagehide', onPageHide);
  }
}

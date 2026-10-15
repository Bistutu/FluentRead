/**
 * @file src/app/popup/startupFeedback.ts
 * 文件职责：在配置或界面模块加载缓慢及失败时提供可恢复的轻量启动反馈。
 * 主要内容：以内置七语短文案按浏览器语言展示等待、失败与手动重新打开入口，说明已保存设置仍保留；不展示异常内容，挂载完成或页面关闭后清理计时器和事件。
 * 模块边界：仅操作尚未挂载的 Popup 占位，不读取或重置配置，不自动刷新或重试，不导入业务组件。
 */
type StartupLanguage = 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'ru' | 'es';
const startupCopy: Record<StartupLanguage, {waiting: string; failed: string; preferences: string; reopen: string}> = {
  zh: {waiting: '正在读取设置…', failed: '暂时无法打开流畅阅读', preferences: '已保存的偏好会保留，可以重新打开后再试。', reopen: '重新打开'},
  en: {waiting: 'Still loading your settings…', failed: 'Could not open FluentRead', preferences: 'Saved preferences are preserved. Reopen to try again.', reopen: 'Reopen'},
  ja: {waiting: '設定を読み込んでいます…', failed: 'FluentReadを開けませんでした', preferences: '保存した設定は保持されています。開き直して再試行してください。', reopen: '開き直す'},
  ko: {waiting: '설정을 불러오는 중…', failed: 'FluentRead를 열 수 없습니다', preferences: '저장한 설정은 유지됩니다. 다시 열어 시도하세요.', reopen: '다시 열기'},
  fr: {waiting: 'Chargement de vos paramètres…', failed: 'Impossible d’ouvrir FluentRead', preferences: 'Vos préférences sont conservées. Rouvrez pour réessayer.', reopen: 'Rouvrir'},
  ru: {waiting: 'Загружаем настройки…', failed: 'Не удалось открыть FluentRead', preferences: 'Сохранённые настройки не изменились. Откройте снова, чтобы повторить попытку.', reopen: 'Открыть снова'},
  es: {waiting: 'Cargando tu configuración…', failed: 'No se pudo abrir FluentRead', preferences: 'Tus preferencias se conservan. Vuelve a abrir para reintentarlo.', reopen: 'Volver a abrir'},
};
export function createPopupStartupFeedback(selector: string) {
  let disposed = false;
  const language = navigator.language.toLowerCase().split(/[-_]/u)[0];
  const copy = startupCopy[Object.hasOwn(startupCopy, language) ? language as StartupLanguage : 'en'];
  function render(failed: boolean) {
    if (disposed) return;
    const root = document.querySelector(selector);
    if (!root) return;
    const section = document.createElement('section');section.className = 'popup-startup-recovery';section.setAttribute('role', 'status');
    const title = document.createElement('strong');title.textContent = failed ? copy.failed : copy.waiting;
    const detail = document.createElement('p');detail.textContent = copy.preferences;
    const retry = document.createElement('button');retry.type = 'button';retry.textContent = copy.reopen;
    retry.addEventListener('click', () => {if (!disposed) location.reload();});
    section.append(title, detail, retry);root.replaceChildren(section);
  }
  const timer = setTimeout(() => render(false), 5000);
  function dispose() {disposed = true;clearTimeout(timer);window.removeEventListener('pagehide', dispose);}
  window.addEventListener('pagehide', dispose);
  return {fail: () => {clearTimeout(timer);render(true);}, dispose};
}

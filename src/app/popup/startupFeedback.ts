/**
 * @file src/app/popup/startupFeedback.ts
 * 文件职责：在配置或界面模块加载缓慢及失败时提供可恢复的轻量启动反馈。
 * 主要内容：等待期间提供手动重新打开入口，失败时说明已保存设置仍保留；不展示异常内容，挂载完成或页面关闭后清理计时器和事件。
 * 模块边界：仅操作尚未挂载的 Popup 占位，不读取或重置配置，不自动刷新或重试，不导入业务组件。
 */
export function createPopupStartupFeedback(selector: string) {
  let disposed = false;
  const english = !navigator.language.toLowerCase().startsWith('zh');
  function render(failed: boolean) {
    if (disposed) return;
    const root = document.querySelector(selector);
    if (!root) return;
    const section = document.createElement('section');section.className = 'popup-startup-recovery';section.setAttribute('role', 'status');
    const title = document.createElement('strong');title.textContent = english ? (failed ? 'Could not open FluentRead' : 'Still loading your settings…') : (failed ? '暂时无法打开流畅阅读' : '正在读取设置…');
    const detail = document.createElement('p');detail.textContent = english ? 'Saved preferences are preserved. Reopen to try again.' : '已保存的偏好会保留，可以重新打开后再试。';
    const retry = document.createElement('button');retry.type = 'button';retry.textContent = english ? 'Reopen' : '重新打开';
    retry.addEventListener('click', () => {if (!disposed) location.reload();});
    section.append(title, detail, retry);root.replaceChildren(section);
  }
  const timer = setTimeout(() => render(false), 5000);
  function dispose() {disposed = true;clearTimeout(timer);window.removeEventListener('pagehide', dispose);}
  window.addEventListener('pagehide', dispose);
  return {fail: () => {clearTimeout(timer);render(true);}, dispose};
}

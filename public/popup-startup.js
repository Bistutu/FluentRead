/**
 * @file public/popup-startup.js
 * 文件职责：在 Popup HTML 解析阶段唤醒后台，使后台初始化与界面模块加载并行。
 * 主要内容：工具栏只请求引导提示，兼容 Firefox Promise 与 Chromium callback API；任意 iframe 均跳过，等待模块入口授权。
 * 模块边界：无框架依赖、不读写配置、不挂载界面；提示仅供模块预取，未经授权的嵌入页不唤醒配置入口。
 */
(() => {
    const globals = globalThis;
    if (globals.parent && globals.parent !== globals) return;
    const message = {type: 'popupStartup'};
    try {
        if (globals.browser?.runtime) {
            globals.__fluentReadPopupWarmup = Promise.resolve(globals.browser.runtime.sendMessage(message))
                .catch(() => undefined);
        } else if (globals.chrome?.runtime) {
            const runtime = globals.chrome.runtime;
            globals.__fluentReadPopupWarmup = new Promise(resolve => {
                runtime.sendMessage(message, response => resolve(runtime.lastError ? undefined : response));
            }).catch(() => undefined);
        }
    } catch {
        // 正常配置读取负责失败回退，预唤醒不能阻断 HTML 或模块加载。
    }
})();

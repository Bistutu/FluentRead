// Safari 容器只负责系统扩展启用指引，不读取扩展配置或重复全局首次引导。
let currentLanguage = 'en';
const messages = {
    en: {
        name: 'FluentRead', subtitle: 'Translate in Safari', heading: 'Enable the Safari extension',
        enable: 'Turn on FluentRead in Safari Extensions.',
        access: 'Allow access to the websites you want to translate. You control this in Safari.',
        use: 'Return to a webpage in Safari and choose FluentRead from the page menu to translate.',
        iosPath: 'Manual path: Settings → Apps → Safari → Extensions → FluentRead.',
        macPath: 'Manual path: Safari → Settings → Extensions → FluentRead.',
        button: 'Open Safari extension settings',
        enabled: 'FluentRead is enabled. You can adjust website access in Safari.',
        failed: 'Settings could not be opened. Follow the manual path above.',
    },
    zh: {
        name: '流畅阅读', subtitle: '在 Safari 中阅读与翻译', heading: '启用 Safari 扩展',
        enable: '在 Safari 扩展中启用「流畅阅读」。',
        access: '允许访问需要翻译的网站。你可以随时在 Safari 中调整权限。',
        use: '返回 Safari 网页，从页面菜单选择「流畅阅读」，即可开始翻译。',
        iosPath: '手动打开：设置 → App → Safari浏览器 → 扩展 → 流畅阅读。',
        macPath: '手动打开：Safari → 设置 → 扩展 → 流畅阅读。',
        button: '打开 Safari 扩展设置',
        enabled: '流畅阅读已启用，可在 Safari 中调整网站访问权限。',
        failed: '暂时无法打开设置，请按上方路径手动启用。',
    },
};
function show(platform, language, canOpenSettings, enabled) {
    currentLanguage = language.startsWith('zh') ? 'zh' : 'en';
    document.documentElement.lang = currentLanguage === 'zh' ? 'zh-Hans' : 'en';
    const copy = messages[currentLanguage];
    document.querySelector('h1').textContent = copy.name;
    document.title = copy.name;
    for (const [id, key] of Object.entries({subtitle: 'subtitle', heading: 'heading', 'step-enable': 'enable', 'step-access': 'access', 'step-use': 'use'})) {
        document.getElementById(id).textContent = copy[key];
    }
    document.getElementById('manual-path').textContent = copy[platform === 'ios' ? 'iosPath' : 'macPath'];
    const button = document.getElementById('open-settings');
    button.textContent = copy.button;
    button.hidden = !canOpenSettings;
    document.getElementById('status').textContent = enabled === true ? copy.enabled : '';
}
function settingsFailed() {
    document.getElementById('status').textContent = messages[currentLanguage].failed;
}
document.getElementById('open-settings').addEventListener('click', () => {
    window.webkit.messageHandlers.controller.postMessage('open-settings');
});

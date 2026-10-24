/**
 * @file integrations/zotero/bootstrap.js
 * 文件职责：连接 Zotero 的插件生命周期与构建后的独立原生模块。
 * 主要内容：运行时注册专属 chrome 路径，加载打包脚本，并在停用时撤销注册。
 * 模块边界：不包含产品逻辑、不加载远程代码；仅管理本 XPI 内的原生入口。
 */
var fluentreadChrome;
var fluentreadModule;

async function startup(data, reason) {
    const startupService = Components.classes['@mozilla.org/addons/addon-manager-startup;1']
        .getService(Components.interfaces.amIAddonManagerStartup);
    fluentreadChrome = startupService.registerChrome(Services.io.newURI(data.rootURI + 'manifest.json'), [
        ['content', 'fluentread', 'content/'],
    ]);
    Services.scriptloader.loadSubScript(data.rootURI + 'content/native.js', globalThis);
    fluentreadModule = globalThis.FluentReadZotero;
    await fluentreadModule.startup(data, reason);
}
async function shutdown(data, reason) {
    try {await fluentreadModule?.shutdown(data, reason);} finally {
        fluentreadModule = null;
        fluentreadChrome?.destruct();
        fluentreadChrome = null;
    }
}
function onMainWindowLoad(data) {fluentreadModule?.onMainWindowLoad(data);}
function onMainWindowUnload(data) {fluentreadModule?.onMainWindowUnload(data);}
function install() {}
function uninstall() {}

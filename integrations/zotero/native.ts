/**
 * @file integrations/zotero/native.ts
 * 文件职责：管理 Zotero 插件的生命周期和原生菜单、阅读器入口。
 * 主要内容：每个主窗口独立挂载菜单，通过官方选文事件打开唯一工作台，停用时清理窗口和监听器。
 * 模块边界：不请求翻译、不改写原 PDF；原生数据访问统一委托 ZoteroHost，Vue 工作台通过窗口参数取得端口。
 */
import {createZoteroHost, escapeHTML, type NativeEnvironment} from './platform';
import type {AttachmentSource, ZoteroHost} from './contracts';

export interface WorkspaceOptions {
    host?: ZoteroHost;
    initialSelection?: boolean;
    attachments?: Array<Pick<AttachmentSource, 'id' | 'libraryID' | 'key' | 'title'>>;
    selection?: {attachmentID: number; text: string; page?: number};
}
export interface BootstrapData {id: string; version: string; rootURI: string}
export interface BootstrapEnvironment {
    Zotero: any;
    Services: any;
    Components: any;
    IOUtils: NativeEnvironment['IOUtils'];
    PathUtils: NativeEnvironment['PathUtils'];
    DOMParser: typeof DOMParser;
}

export function createNativeIntegration(environment: BootstrapEnvironment) {
    const {Zotero: zotero} = environment;
    const mounted = new Map<any, () => void>();
    const readerButtons = new Set<Element>();
    const notifications = new Map<any, ReturnType<typeof setTimeout>>();
    let host: ZoteroHost | undefined;
    let workspace: any;
    let pluginID = '';
    let disposed = true;
    const label = (zh: string, en: string) => String(zotero.locale || '').startsWith('zh') ? zh : en;
    const notify = (message: string) => {
        // 保存成功等状态使用短暂的被动提示；服务文本按纯文本展示，不阻塞工作台。
        const win = zotero.getMainWindow();
        if (!win || !zotero.ProgressWindow) return;
        try {
            const popup = new zotero.ProgressWindow({window: win, closeOnClick: true});
            popup.changeHeadline(label('流畅阅读', 'FluentRead'));
            popup.addDescription(escapeHTML(message)); popup.show(); popup.startCloseTimer(4000);
            notifications.set(popup, setTimeout(() => notifications.delete(popup), 4500));
        } catch { /* 工作台保留可见状态；宿主通知不可用时不弹出阻塞对话框。 */ }
    };
    const showWorkspace = (options: WorkspaceOptions = {}) => {
        if (disposed || !host) return;
        if (workspace && !workspace.closed) {
            if (workspace.FluentReadWorkspace) workspace.FluentReadWorkspace.receive(options);
            else (workspace.FluentReadWorkspacePending ||= []).push(options);
            workspace.focus();
            return;
        }
        const win = zotero.getMainWindow();
        if (!win) return;
        workspace = win.openDialog('chrome://fluentread/content/workspace.html', 'fluentread-zotero',
            'chrome,dialog=no,centerscreen,resizable,width=1120,height=800', {host, ...options});
        const opened = workspace;
        opened.addEventListener('unload', () => {if (workspace === opened) workspace = undefined;}, {once: true});
    };
    const selectionListener = (event: any) => {
        if (disposed) return;
        const {reader, doc, params, append} = event;
        const item = zotero.Items.get(reader.itemID);
        if (!item?.isPDFAttachment() || !params.annotation?.text?.trim()) return;
        const button = doc.createElement('button');
        button.className = 'fluentread-zotero-selection';
        button.type = 'button';
        button.textContent = label('流畅阅读翻译', 'Translate with FluentRead');
        button.style.cssText = 'font:inherit;cursor:pointer;border:1px solid currentColor;border-radius:6px;padding:4px 8px;background:transparent;color:inherit;margin:3px;';
        button.addEventListener('click', () => {
            const pageIndex = params.annotation.position?.pageIndex;
            showWorkspace({selection: {attachmentID: reader.itemID, text: params.annotation.text,
                page: Number.isSafeInteger(pageIndex) && pageIndex >= 0 ? pageIndex + 1 : undefined}});
        });
        // 弹出层节点由 Zotero 销毁；保留弱生命周期之外的集合只用于停用时移除仍连接的按钮。
        for (const node of readerButtons) if (!node.isConnected) readerButtons.delete(node);
        append(button);
        readerButtons.add(button);
    };
    const clearNotifications = () => {
        for (const [popup, timer] of notifications) {clearTimeout(timer); try {popup.close();} catch { /* 宿主窗口可能已关闭。 */ }}
        notifications.clear();
    };
    const unloadWindow = ({window: win}: {window: any}) => {
        clearNotifications();
        const cleanup = mounted.get(win);
        mounted.delete(win);
        cleanup?.();
        for (const button of readerButtons) {
            const owner = button.ownerDocument?.defaultView;
            if (!button.isConnected || owner?.closed || owner?.top === win) {button.remove(); readerButtons.delete(button);}
        }
    };
    const loadWindow = ({window: win}: {window: any}) => {
        if (disposed || mounted.has(win)) return;
        const doc = win.document;
        const cleanups: Array<() => void> = [];
        const addMenu = (parentID: string, id: string, text: string, initialSelection: boolean) => {
            const popup = doc.getElementById(parentID);
            if (!popup || doc.getElementById(id)) return;
            const item = doc.createXULElement('menuitem');
            item.id = id;
            item.setAttribute('label', text);
            const run = () => {
                if (initialSelection && host) void host.selectedAttachments().then(attachments => {
                    showWorkspace({initialSelection: true, attachments});
                }).catch(() => notify(label('无法读取所选 PDF，请重新选择文献。', 'Unable to read the selected PDFs. Please select them again.')));
                else showWorkspace();
            };
            item.addEventListener('command', run);
            popup.append(item);
            const update = () => {
                if (!initialSelection) return;
                const selected = win.ZoteroPane.getSelectedItems();
                item.disabled = !selected.some((entry: any) => entry.isPDFAttachment?.() || entry.isRegularItem?.() && entry.getAttachments().length > 0);
            };
            popup.addEventListener('popupshowing', update);
            cleanups.push(() => {item.removeEventListener('command', run); popup.removeEventListener('popupshowing', update); item.remove();});
        };
        addMenu('zotero-itemmenu', 'fluentread-zotero-translate', label('使用流畅阅读翻译', 'Translate with FluentRead'), true);
        addMenu('menu_ToolsPopup', 'fluentread-zotero-workspace', label('流畅阅读工作台', 'FluentRead workspace'), false);
        mounted.set(win, () => cleanups.splice(0).forEach(cleanup => cleanup()));
    };
    return {
        async startup(data: BootstrapData) {
            if (!disposed) return;
            pluginID = data.id;
            const profileDirectory = environment.Services.dirsvc.get('ProfD', environment.Components.interfaces.nsIFile).path;
            // Sandbox 的 Web 构造器是非枚举属性，不能通过对象展开复制。
            host = createZoteroHost({Zotero: zotero, IOUtils: environment.IOUtils, PathUtils: environment.PathUtils,
                DOMParser: environment.DOMParser, profileDirectory, notify});
            disposed = false;
            zotero.Reader.registerEventListener('renderTextSelectionPopup', selectionListener, pluginID);
            for (const win of zotero.getMainWindows()) loadWindow({window: win});
        },
        async shutdown() {
            if (disposed) return;
            disposed = true;
            zotero.Reader.unregisterEventListener('renderTextSelectionPopup', selectionListener);
            for (const win of mounted.keys()) unloadWindow({window: win});
            for (const button of readerButtons) button.remove();
            readerButtons.clear();
            clearNotifications();
            const closing = workspace;
            workspace = undefined;
            try {if (closing && !closing.closed) await closing.FluentReadWorkspace?.dispose();}
            finally {if (closing && !closing.closed) closing.close(); host = undefined;}
        },
        onMainWindowLoad: loadWindow,
        onMainWindowUnload: unloadWindow,
        openWorkspace: showWorkspace,
        getHost: () => host,
    };
}

let integration: ReturnType<typeof createNativeIntegration> | undefined;
export async function startup(data: BootstrapData): Promise<void> {
    integration = createNativeIntegration(globalThis as unknown as BootstrapEnvironment);
    await integration.startup(data);
}
export async function shutdown(): Promise<void> {const closing = integration; integration = undefined; await closing?.shutdown();}
export function onMainWindowLoad(data: {window: any}): void {integration?.onMainWindowLoad(data);}
export function onMainWindowUnload(data: {window: any}): void {integration?.onMainWindowUnload(data);}

/**
 * @file src/app/popup/embedded.ts
 * 文件职责：在默认 Popup 被网页嵌入时，先兑换后台一次性授权，再建立只传递尺寸和关闭事件的独立通道。
 * 主要内容：验证父窗口连接、固定已授权来源标签页、取消退出后的异步挂载，测量菜单自然尺寸并统一工具栏与页内面板关闭。
 * 模块边界：授权前不导入配置、Vue 或 Popup 业务；凭据不进入 URL 或 DOM，父网页不会收到用户配置或扩展动作接口。
 */
type PopupRuntime = {
    sendMessage(message: unknown, callback?: (response: unknown) => void): Promise<unknown> | void;
    lastError?: {message?: string};
};

let sourceTabId: number | null = null;
let preparation: Promise<boolean> | undefined;
let disposeEmbedded: ((notifyParent: boolean) => void) | undefined;
let embeddedPort: MessagePort | undefined;
let disposed = false;
let stopSizeObservation: (() => void) | undefined;

export function isEmbeddedPopup(): boolean {
    return typeof window !== 'undefined' && window.parent !== undefined && window.parent !== window;
}

/** 只返回后台兑换的身份；URL 查询参数不能建立页内面板的网页授权。 */
export function getEmbeddedPopupTabId(): number | null {
    return sourceTabId;
}

export function isPopupSurfaceActive(): boolean {
    return !disposed;
}

function authorize(token: string): Promise<unknown> {
    const globals = globalThis as typeof globalThis & {
        browser?: {runtime?: PopupRuntime}; chrome?: {runtime?: PopupRuntime};
    };
    const message = {type: 'authorizeFloatingPopup', token};
    if (globals.browser?.runtime) return Promise.resolve(globals.browser.runtime.sendMessage(message));
    return new Promise((resolve, reject) => {
        const runtime = globals.chrome?.runtime;
        if (!runtime) { reject(new Error('扩展消息端口不可用')); return; }
        runtime.sendMessage(message, response => {
            if (runtime.lastError) reject(new Error(runtime.lastError.message));
            else resolve(response);
        });
    });
}

/** 任意 iframe 都必须等待父端持有的凭据，不接受仅靠地址参数进入 privileged Popup。 */
export function preparePopupSurface(): Promise<boolean> {
    if (!isEmbeddedPopup()) return Promise.resolve(true);
    if (preparation) return preparation;
    preparation = new Promise(resolve => {
        let pendingPort: MessagePort | undefined;
        const finish = (notifyParent: boolean) => {
            if (disposed) return;
            disposed = true;
            sourceTabId = null;
            clearTimeout(timeout);
            window.removeEventListener('message', connect);
            window.removeEventListener('pagehide', pagehide);
            window.removeEventListener('keydown', keydown, true);
            stopSizeObservation?.();
            if (notifyParent) embeddedPort?.postMessage({type: 'close'});
            embeddedPort?.close();
            pendingPort?.close();
            embeddedPort = undefined;
            // 关闭的是实际扩展页面；先让已有的配置和挂载生命周期收到退出信号。
            window.dispatchEvent(new Event('pagehide'));
            resolve(false);
        };
        const pagehide = () => finish(false);
        const keydown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closePopupSurface();
        };
        const connect = async (event: MessageEvent) => {
            const data = event.data as {type?: unknown; token?: unknown} | null;
            if (disposed || pendingPort || event.source !== window.parent
                || data?.type !== 'fluentread-floating-popup-connect'
                || typeof data.token !== 'string' || !data.token || data.token.length > 256
                || event.ports.length !== 1) return;
            const port = event.ports[0];
            pendingPort = port;
            try {
                const response = await authorize(data.token) as {success?: boolean; sourceTabId?: unknown} | null;
                if (disposed) return;
                if (response?.success !== true || typeof response.sourceTabId !== 'number'
                    || !Number.isSafeInteger(response.sourceTabId) || response.sourceTabId < 0) return;
                sourceTabId = response.sourceTabId;
                embeddedPort = port;
                pendingPort = undefined;
                document.documentElement.dataset.fluentreadEmbeddedPopup = 'true';
                clearTimeout(timeout);
                window.removeEventListener('message', connect);
                window.addEventListener('keydown', keydown, true);
                port.onmessage = message => { if (message.data?.type === 'close') finish(false); };
                port.start();
                port.postMessage({type: 'ready'});
                resolve(true);
            } catch {
                // 验证失败保持未挂载，可由真正的父端在剩余授权时间内重试。
            } finally {
                if (embeddedPort !== port) port.close();
                pendingPort = undefined;
            }
        };
        const timeout = setTimeout(() => finish(false), 15_000);
        disposeEmbedded = finish;
        window.addEventListener('message', connect);
        window.addEventListener('pagehide', pagehide);
    });
    return preparation;
}

/** 页面动作与 Escape 共用此出口，普通工具栏继续使用浏览器自带的 window.close。 */
export function closePopupSurface(): void {
    if (isEmbeddedPopup()) disposeEmbedded?.(true);
    else window.close();
}

/** 观察内容盒子的高度；隐藏宽度探针解析 CSS 宽度变量，避免受父端视口裁剪后无法再变宽。 */
export function observeEmbeddedPopupSize(): void {
    if (!embeddedPort || disposed || stopSizeObservation) return;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;height:0;contain:strict;width:var(--fluentread-localized-popup-width,var(--interface-popup-width,320px));';
    document.body.append(probe);
    let lastWidth = 0, lastHeight = 0;
    const measure = () => {
        if (!embeddedPort || disposed) return;
        const content = document.querySelector<HTMLElement>('.popup-shell') ?? document.querySelector<HTMLElement>('#app')?.firstElementChild as HTMLElement | null;
        if (!content) return;
        const width = Math.ceil(parseFloat(getComputedStyle(probe).width));
        const height = Math.ceil(Math.min(560, Math.max(content.offsetHeight, content.scrollHeight, content.getBoundingClientRect().height)));
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
            || (width === lastWidth && height === lastHeight)) return;
        lastWidth = width; lastHeight = height;
        embeddedPort.postMessage({type: 'resize', width, height});
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(document.documentElement);
    observer?.observe(document.body);
    observer?.observe(probe);
    const content = document.querySelector('.popup-shell');
    if (content) observer?.observe(content);
    window.addEventListener('resize', measure);
    stopSizeObservation = () => {
        observer?.disconnect();
        window.removeEventListener('resize', measure);
        probe.remove();
    };
    measure();
}

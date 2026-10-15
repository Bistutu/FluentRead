/**
 * @file src/features/floating-ball/content/anchoredPopup.ts
 * 文件职责：在悬浮球的封闭 Shadow 容器内展示与按钮相邻的扩展 Popup，管理定位、授权连接和关闭。
 * 主要内容：通过注入的消息端口领取一次性凭据，仅向指定 iframe 传递 MessagePort；完成内容尺寸协商后显示，按视口和按钮位置避让，清理关闭后的资源。
 * 模块边界：不读取用户配置、不复制 Popup 内容、不执行翻译；Popup 自身负责界面，后台负责页面来源授权，调用方负责可信用户事件与宿主生命周期。
 */
import {getSafeVisualViewportRect, observeVisualViewport} from '@/src/platform/dom/visualViewport';

export interface AnchoredPopupPorts {
    getUrl(): string;
    request(): Promise<{success?: boolean; token?: string; error?: string}>;
    onOpenChange(open: boolean): void;
}

/** 面板向屏幕内侧展开并比按钮上移 24px；横向放不下时改用按钮上方或下方，保留按钮关闭入口。 */
export function positionAnchoredPopup(anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
    size: {width: number; height: number}, viewport: {width: number; height: number; left?: number; top?: number}) {
    const offsetLeft = viewport.left ?? 0, offsetTop = viewport.top ?? 0;
    anchor = {left: anchor.left - offsetLeft, right: anchor.right - offsetLeft,
        top: anchor.top - offsetTop, bottom: anchor.bottom - offsetTop};
    const margin = 8, gap = 12;
    const width = Math.min(size.width, Math.max(1, viewport.width - margin * 2));
    let height = Math.min(size.height, Math.max(1, viewport.height - margin * 2));
    const preferLeft = (anchor.left + anchor.right) / 2 > viewport.width / 2;
    const left = Math.max(margin, Math.min(preferLeft ? anchor.left - gap - width : anchor.right + gap,
        viewport.width - margin - width));
    let desiredTop = anchor.top - 24;
    if (anchor.left - gap - margin < width && viewport.width - margin - anchor.right - gap < width) {
        const above = anchor.top - gap - margin;
        const below = viewport.height - margin - anchor.bottom - gap;
        const preferAbove = above >= below;
        height = Math.min(height, Math.max(1, preferAbove ? above : below));
        desiredTop = preferAbove ? anchor.top - gap - height : anchor.bottom + gap;
    }
    const top = Math.max(margin, Math.min(desiredTop, viewport.height - margin - height));
    return {left: left + offsetLeft, top: top + offsetTop, width, height};
}

export function createAnchoredPopup(container: HTMLElement, host: HTMLElement, ports: AnchoredPopupPorts) {
    let epoch = 0, open = false, shown = false;
    let frame: HTMLIFrameElement | null = null, channel: MessageChannel | null = null;
    let anchor: HTMLElement | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let size = {width: 320, height: 560};
    let requestedWidth = 320;
    let stopObservingViewport: (() => void) | undefined;

    const place = () => {
        if (!frame || !anchor) return;
        const bounds = positionAnchoredPopup(anchor.getBoundingClientRect(), size,
            getSafeVisualViewportRect());
        Object.assign(frame.style, {left: `${bounds.left}px`, top: `${bounds.top}px`,
            width: `${bounds.width}px`, height: `${bounds.height}px`});
        return bounds;
    };
    const confirmPlacement = (width: number) => channel?.port1.postMessage({
        type: 'placed', width, requestedWidth, shown,
    });
    const reposition = () => {
        const bounds = place();
        if (bounds) confirmPlacement(bounds.width);
    };
    const close = (restoreFocus = false) => {
        epoch++;
        open = false;
        shown = false;
        if (timeout !== null) clearTimeout(timeout);
        timeout = null;
        channel?.port1.postMessage({type: 'close'});
        channel?.port1.close();
        channel?.port2.close();
        channel = null;
        frame?.remove();
        frame = null;
        window.removeEventListener('pointerdown', outside, true);
        window.removeEventListener('keydown', keydown, true);
        stopObservingViewport?.();
        stopObservingViewport = undefined;
        window.removeEventListener('pagehide', pagehide);
        ports.onOpenChange(false);
        if (restoreFocus) anchor?.focus({preventScroll: true});
        anchor = null;
    };
    const outside = (event: Event) => {
        if (!event.composedPath().includes(host)) close();
    };
    const keydown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        close(true);
    };
    const pagehide = () => close();

    return {
        close,
        async toggle(button: HTMLElement): Promise<void> {
            if (open) { close(); return; }
            open = true;
            anchor = button;
            const request = ++epoch;
            ports.onOpenChange(true);
            window.addEventListener('pointerdown', outside, true);
            window.addEventListener('keydown', keydown, true);
            stopObservingViewport = observeVisualViewport(reposition);
            window.addEventListener('pagehide', pagehide);
            timeout = setTimeout(() => close(), 15_000);
            try {
                const response = await ports.request();
                if (request !== epoch) return;
                if (!response?.success || !response.token) throw new Error(response?.error || '无法打开快捷面板');
                const url = ports.getUrl();
                const popup = document.createElement('iframe');
                frame = popup;
                size = {width: 320, height: 560};
                requestedWidth = 320;
                popup.title = 'FluentRead';
                popup.src = url;
                popup.setAttribute('allowtransparency', 'true');
                popup.setAttribute('aria-hidden', 'true');
                popup.setAttribute('inert', '');
                popup.tabIndex = -1;
                // visibility:hidden 会冻结部分浏览器的 iframe 视口；透明阶段保留布局但屏蔽交互和焦点。
                popup.style.cssText = 'position:fixed;z-index:2147483647;display:block;border:0;border-radius:18px;box-shadow:0 12px 48px rgba(0,0,0,.22);background:transparent;opacity:0;pointer-events:none;color-scheme:normal;';
                popup.addEventListener('load', () => {
                    if (request !== epoch || !popup.contentWindow) return;
                    const connection = new MessageChannel();
                    channel = connection;
                    connection.port1.onmessage = (event: MessageEvent) => {
                        if (request !== epoch) return;
                        const data = event.data;
                        if (data?.type === 'close') { close(true); return; }
                        if ((data?.type === 'ready' || data?.type === 'resize')
                            && Number.isFinite(data.width) && Number.isFinite(data.height)
                            && data.width > 0 && data.height > 0) {
                            requestedWidth = data.width;
                            size = {width: Math.min(data.width, 800), height: Math.min(data.height, 560)};
                            if (data.type === 'ready') {
                                const bounds = place()!;
                                // 子页面测量后宿主仍可能缩窄；只有实际布局宽度一致时才显示首帧。
                                if (data.actualWidth === bounds.width) {
                                    if (timeout !== null) clearTimeout(timeout);
                                    timeout = null;
                                    shown = true;
                                    popup.style.opacity = '1';
                                    popup.style.pointerEvents = 'auto';
                                    popup.removeAttribute('aria-hidden');
                                    popup.removeAttribute('inert');
                                    popup.tabIndex = 0;
                                }
                                confirmPlacement(bounds.width);
                            } else reposition();
                        }
                    };
                    // 授权凭据只送给扩展 frame；不放进 URL、DOM 属性或宿主页消息。
                    const targetOrigin = url.slice(0, url.indexOf('/', url.indexOf('://') + 3));
                    popup.contentWindow.postMessage({type: 'fluentread-floating-popup-connect', token: response.token},
                        targetOrigin, [connection.port2]);
                }, {once: true});
                container.append(popup);
                place();
            } catch (error) {
                if (request !== epoch) return;
                close();
                throw error;
            }
        },
    };
}

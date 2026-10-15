/**
 * @file src/platform/dom/visualViewport.ts
 * 文件职责：为页内浮层提供统一的实际可见视口坐标与可撤销的视口变化订阅。
 * 主要内容：读取 VisualViewport 的 CSS 像素边界，缺失或异常时回退布局视口；可选用即时移除的探针读取刘海与系统手势安全区；夹边时保留操作间距；把软键盘、缩放平移、横竖屏和后台恢复事件按帧合并。
 * 模块边界：只封装 DOM 平台几何与事件，不读取配置、不管理业务显示状态、不尝试判断真实设备或浏览器品牌；安全区测量仅应在挂载或视口变化时调用，由调用方缓存快照，手势帧不重复测量。
 */
export interface VisualViewportRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

function positive(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : Math.max(1, fallback || 1);
}

/** 返回布局视口坐标中的可见区域；不把 pinch scale 再乘一次。 */
export function getVisualViewportRect(view: Window = window): VisualViewportRect {
    const viewport = view.visualViewport;
    const width = positive(viewport?.width, view.innerWidth);
    const height = positive(viewport?.height, view.innerHeight);
    const left = Number.isFinite(viewport?.offsetLeft) ? Math.max(0, viewport!.offsetLeft) : 0;
    const top = Number.isFinite(viewport?.offsetTop) ? Math.max(0, viewport!.offsetTop) : 0;
    return {left, top, width, height, right: left + width, bottom: top + height};
}

/** 在挂载/视口变化时读取一次并缓存返回值；探针始终立即释放，不持有页面节点或全局缓存。 */
export function getSafeVisualViewportRect(view: Window = window): VisualViewportRect {
    const viewport = getVisualViewportRect(view);
    if (!view.document?.body || typeof view.getComputedStyle !== 'function') return viewport;
    const probe = view.document.createElement('span');
    let safeViewport = viewport;
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'all:initial!important;position:fixed!important;visibility:hidden!important;pointer-events:none!important;width:0!important;height:0!important;padding-top:env(safe-area-inset-top,0px)!important;padding-right:env(safe-area-inset-right,0px)!important;padding-bottom:env(safe-area-inset-bottom,0px)!important;padding-left:env(safe-area-inset-left,0px)!important;';
    try {
        view.document.body.appendChild(probe);
        const style = view.getComputedStyle(probe);
        const inset = (value: string) => {
            const number = Number.parseFloat(value);
            return Number.isFinite(number) ? Math.max(0, number) : 0;
        };
        const left = viewport.left + inset(style.paddingLeft);
        const top = viewport.top + inset(style.paddingTop);
        const right = Math.max(left + 1, viewport.right - inset(style.paddingRight));
        const bottom = Math.max(top + 1, viewport.bottom - inset(style.paddingBottom));
        safeViewport = {left, top, right, bottom, width: right - left, height: bottom - top};
    } catch {
        // 宿主页在本帧替换 body 或浏览器不允许测量时，保留原始视口的可用能力。
    } finally {
        probe.remove();
    }
    return safeViewport;
}

/** 允许比视口大的内容固定在起始边；调用方应同时约束内容的 maxWidth/maxHeight。 */
export function clampToVisualViewport(
    point: {left: number; top: number},
    size: {width: number; height: number},
    viewport: VisualViewportRect,
    gap = 12,
): {left: number; top: number} {
    const inset = Math.max(0, Number.isFinite(gap) ? gap : 12);
    return {
        left: Math.max(viewport.left + inset, Math.min(point.left, viewport.right - size.width - inset)),
        top: Math.max(viewport.top + inset, Math.min(point.top, viewport.bottom - size.height - inset)),
    };
}

/** 只在恢复可见时通知；卸载后取消队列且不再调用 callback。 */
export function observeVisualViewport(callback: () => void, view: Window = window): () => void {
    const viewport = view.visualViewport;
    const document = view.document;
    let frame: number | undefined;
    let disposed = false;
    const schedule = () => {
        if (disposed || frame !== undefined) return;
        frame = view.requestAnimationFrame(() => {
            frame = undefined;
            if (!disposed) callback();
        });
    };
    const visible = () => { if (document?.visibilityState !== 'hidden') schedule(); };
    view.addEventListener('resize', schedule);
    view.addEventListener('orientationchange', schedule);
    view.addEventListener('pageshow', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule, {passive: true});
    document?.addEventListener('visibilitychange', visible);
    return () => {
        disposed = true;
        if (frame !== undefined) view.cancelAnimationFrame(frame);
        frame = undefined;
        view.removeEventListener('resize', schedule);
        view.removeEventListener('orientationchange', schedule);
        view.removeEventListener('pageshow', schedule);
        viewport?.removeEventListener('resize', schedule);
        viewport?.removeEventListener('scroll', schedule);
        document?.removeEventListener('visibilitychange', visible);
    };
}

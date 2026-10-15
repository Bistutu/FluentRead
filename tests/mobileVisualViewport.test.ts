import {afterEach, describe, expect, it, vi} from 'vitest';
import {clampToVisualViewport, getSafeVisualViewportRect, getVisualViewportRect, observeVisualViewport} from '@/src/platform/dom/visualViewport';

afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

describe('mobile visual viewport platform port', () => {
    it('uses visible keyboard and pinch-pan bounds in layout CSS pixels without multiplying scale', () => {
        const view = {innerWidth: 980, innerHeight: 800,
            visualViewport: {width: 390, height: 320, offsetLeft: 90, offsetTop: 140, scale: 2.5}} as Window;
        expect(getVisualViewportRect(view)).toEqual({left: 90, top: 140, width: 390, height: 320, right: 480, bottom: 460});
        expect(clampToVisualViewport({left: 10, top: 700}, {width: 366, height: 140}, getVisualViewportRect(view)))
            .toEqual({left: 102, top: 308});
    });

    it('falls back on desktop and rejects invalid or temporarily zero visual viewport readings', () => {
        expect(getVisualViewportRect({innerWidth: 1200, innerHeight: 800} as Window))
            .toEqual({left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800});
        const view = {innerWidth: 390, innerHeight: 780,
            visualViewport: {width: NaN, height: 0, offsetLeft: Infinity, offsetTop: -10}} as Window;
        expect(getVisualViewportRect(view)).toEqual({left: 0, top: 0, width: 390, height: 780, right: 390, bottom: 780});
        expect(getVisualViewportRect({innerWidth: 0, innerHeight: 0} as Window).width).toBe(1);
        expect(clampToVisualViewport({left: 90, top: 90}, {width: 1000, height: 1000}, getVisualViewportRect(view), NaN))
            .toEqual({left: 12, top: 12});
    });

    it('measures safe-area CSS only when explicitly called and immediately removes the owned probe', () => {
        const probe = {style: {cssText: ''}, setAttribute: vi.fn(), remove: vi.fn()};
        const appendChild = vi.fn();
        const getComputedStyle = vi.fn(() => ({paddingLeft: '44px', paddingRight: '44px', paddingTop: '0px', paddingBottom: '21px'}));
        const view = {innerWidth: 780, innerHeight: 390, document: {body: {appendChild}, createElement: () => probe}, getComputedStyle} as unknown as Window;
        vi.stubGlobal('window', view);
        expect(getVisualViewportRect()).toEqual({left: 0, top: 0, right: 780, bottom: 390, width: 780, height: 390});
        expect(getSafeVisualViewportRect()).toEqual({left: 44, top: 0, right: 736, bottom: 369, width: 692, height: 369});
        expect(appendChild).toHaveBeenCalledWith(probe);
        expect(probe.style.cssText).toContain('safe-area-inset-left');
        expect(probe.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
        expect(probe.remove).toHaveBeenCalledOnce();
        expect(getComputedStyle).toHaveBeenCalledOnce();
        getComputedStyle.mockReturnValue({paddingLeft: '-8px', paddingRight: 'Infinity', paddingTop: 'initial', paddingBottom: '0px'});
        expect(getSafeVisualViewportRect(view)).toEqual(getVisualViewportRect(view));
        getComputedStyle.mockReturnValue({paddingLeft: '900px', paddingRight: '900px', paddingTop: '500px', paddingBottom: '500px'});
        expect(getSafeVisualViewportRect(view)).toMatchObject({left: 900, top: 500, width: 1, height: 1});
        getComputedStyle.mockImplementation(() => {throw new Error('body replaced');});
        expect(getSafeVisualViewportRect(view)).toEqual(getVisualViewportRect(view));
        expect(probe.remove).toHaveBeenCalledTimes(4);
    });

    it('keeps the DOM-free fallback and supports subscription without optional viewport or document ports', () => {
        vi.useFakeTimers();
        const addEventListener = vi.fn(), removeEventListener = vi.fn(), cancelAnimationFrame = vi.fn();
        const callbacks: FrameRequestCallback[] = [];
        const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {callbacks.push(callback); return 17;});
        const view = {innerWidth: 1000, innerHeight: 800, addEventListener, removeEventListener, requestAnimationFrame, cancelAnimationFrame} as unknown as Window;
        vi.stubGlobal('window', view);
        expect(getSafeVisualViewportRect(view)).toEqual(getVisualViewportRect(view));
        expect(getSafeVisualViewportRect({...view, document: {body: {}}} as Window)).toEqual(getVisualViewportRect(view));
        const callback = vi.fn();
        const cleanup = observeVisualViewport(callback);
        const schedule = addEventListener.mock.calls[0][1] as () => void;
        schedule(); schedule();
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        cleanup();
        expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
        callbacks[0](0); schedule();
        expect(callback).not.toHaveBeenCalled();
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        cleanup();
        expect(clampToVisualViewport({left: 0, top: 0}, {width: 200, height: 100}, getVisualViewportRect(view), -5)).toEqual({left: 0, top: 0});
    });

    it('coalesces keyboard, rotation, pan and bfcache events and disposes all owned listeners and queued work', () => {
        vi.useFakeTimers();
        const view = Object.assign(new EventTarget(), {document: Object.assign(new EventTarget(), {visibilityState: 'visible'}),
            visualViewport: new EventTarget(), requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16),
            cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id)}) as unknown as Window;
        const callback = vi.fn();
        const cleanup = observeVisualViewport(callback, view);
        for (const event of ['resize', 'orientationchange', 'pageshow']) view.dispatchEvent(new Event(event));
        for (const event of ['resize', 'scroll']) view.visualViewport!.dispatchEvent(new Event(event));
        vi.advanceTimersByTime(16);
        expect(callback).toHaveBeenCalledOnce();
        Object.assign(view.document, {visibilityState: 'hidden'});
        view.document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(16);
        expect(callback).toHaveBeenCalledOnce();
        Object.assign(view.document, {visibilityState: 'visible'});
        view.document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(16);
        expect(callback).toHaveBeenCalledTimes(2);
        view.visualViewport!.dispatchEvent(new Event('resize'));
        cleanup(); cleanup();
        vi.runAllTimers();
        for (const event of ['resize', 'orientationchange', 'pageshow']) view.dispatchEvent(new Event(event));
        view.document.dispatchEvent(new Event('visibilitychange'));
        view.visualViewport!.dispatchEvent(new Event('scroll'));
        view.visualViewport!.dispatchEvent(new Event('resize'));
        expect(vi.getTimerCount()).toBe(0);
        expect(callback).toHaveBeenCalledTimes(2);
    });
});

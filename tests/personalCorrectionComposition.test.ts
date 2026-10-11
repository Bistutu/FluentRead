import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const ports = vi.hoisted(() => ({config: {on: true, personalCorrectionsEnabled: true}, mount: vi.fn(), unmount: vi.fn(),
    subscribe: vi.fn(), read: vi.fn(), list: vi.fn(), refresh: vi.fn(), watch: vi.fn(), disable: vi.fn()}));
vi.mock('@/src/features/personal-corrections/public', () => ({mountPersonalCorrections: ports.mount, unmountPersonalCorrections: ports.unmount}));
vi.mock('@/src/services/config/store', () => ({config: ports.config}));
vi.mock('@/src/services/personal-corrections/public', () => ({personalCorrections: {subscribe: ports.subscribe}}));
vi.mock('@/src/features/full-page-translation/public', () => ({readPersonalCorrectionPair: ports.read,
    listVisiblePersonalCorrectionPairs: ports.list, refreshVisiblePersonalCorrections: ports.refresh,
    watchPersonalCorrectionContext: ports.watch, disableVisiblePersonalCorrections: ports.disable}));
import {mountPersonalCorrectionContent, unmountPersonalCorrectionContent} from '@/src/app/content/personalCorrections';
beforeEach(() => {vi.clearAllMocks(); Object.assign(ports.config, {on: true, personalCorrectionsEnabled: true});});
afterEach(() => {vi.unstubAllEnvs(); unmountPersonalCorrectionContent();});
describe('校订在页面激活中的静态装配', () => {
    it('userscript 编译边界不挂编辑器、记忆订阅或观察者', () => {
        vi.stubEnv('BROWSER', 'userscript');
        mountPersonalCorrectionContent({} as any, new AbortController().signal); unmountPersonalCorrectionContent();
        expect(ports.mount).not.toHaveBeenCalled(); expect(ports.subscribe).not.toHaveBeenCalled(); expect(ports.watch).not.toHaveBeenCalled();
    });
    it('默认关闭、总开关关闭或已取消页面都不启动功能', () => {
        ports.config.personalCorrectionsEnabled = false; mountPersonalCorrectionContent({} as any, new AbortController().signal);
        ports.config.personalCorrectionsEnabled = true; ports.config.on = false; mountPersonalCorrectionContent({} as any, new AbortController().signal);
        ports.config.on = true; const aborted = new AbortController(); aborted.abort(); mountPersonalCorrectionContent({} as any, aborted.signal);
        expect(ports.mount).not.toHaveBeenCalled(); expect(ports.subscribe).not.toHaveBeenCalled();
    });
    it('使用独立取消域；关闭立即释放订阅、观察和编辑器，迟到广播不刷新', () => {
        const ctx = {isInvalid: false}; const page = new AbortController(); mountPersonalCorrectionContent(ctx as any, page.signal);
        const local = ports.mount.mock.calls[0][1] as AbortSignal;
        expect(local).not.toBe(page.signal);
        expect(ports.mount).toHaveBeenCalledWith(ctx, local, {readPair: ports.read, listVisiblePairs: ports.list, refreshVisible: ports.refresh});
        const [changed, subscribedSignal] = ports.subscribe.mock.calls[0];
        expect(subscribedSignal).toBe(local); changed(); expect(ports.refresh).toHaveBeenCalledOnce();
        expect(ports.watch).toHaveBeenCalledWith(local);
        unmountPersonalCorrectionContent(); expect(local.aborted).toBe(true); expect(page.signal.aborted).toBe(false);
        expect(ports.unmount).toHaveBeenCalledOnce(); expect(ports.disable).toHaveBeenCalledOnce();
        changed(); expect(ports.refresh).toHaveBeenCalledOnce();
        page.abort(); unmountPersonalCorrectionContent(); expect(ports.unmount).toHaveBeenCalledOnce();
    });
    it('页面取消传播，重新挂载替换旧功能；旧取消回调不能卸载新实例', () => {
        const first = new AbortController(); const listen = vi.spyOn(first.signal, 'addEventListener');
        mountPersonalCorrectionContent({} as any, first.signal);
        const oldAbort = listen.mock.calls[0][1] as () => void;
        const firstLocal = ports.mount.mock.calls[0][1] as AbortSignal;
        const second = new AbortController(); mountPersonalCorrectionContent({} as any, second.signal);
        const secondLocal = ports.mount.mock.calls[1][1] as AbortSignal;
        expect(firstLocal.aborted).toBe(true); oldAbort(); expect(secondLocal.aborted).toBe(false);
        second.abort(); expect(secondLocal.aborted).toBe(true); expect(ports.disable).toHaveBeenCalledTimes(2);
    });
});

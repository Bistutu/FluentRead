import {describe, expect, it, vi} from 'vitest';
const ports = vi.hoisted(() => ({mount: vi.fn(), subscribe: vi.fn(), read: vi.fn(), list: vi.fn(), refresh: vi.fn(), watch: vi.fn()}));
vi.mock('@/src/features/personal-corrections/public', () => ({mountPersonalCorrections: ports.mount}));
vi.mock('@/src/services/personal-corrections/public', () => ({personalCorrections: {subscribe: ports.subscribe}}));
vi.mock('@/src/features/full-page-translation/public', () => ({readPersonalCorrectionPair: ports.read,
    listVisiblePersonalCorrectionPairs: ports.list, refreshVisiblePersonalCorrections: ports.refresh, watchPersonalCorrectionContext: ports.watch}));
import {mountPersonalCorrectionContent} from '@/src/app/content/personalCorrections';
describe('校订在页面激活中的静态装配', () => {
    it('userscript 编译边界不挂编辑器、记忆订阅或观察者', () => {
        vi.stubEnv('BROWSER', 'userscript');
        mountPersonalCorrectionContent({} as any, new AbortController().signal);
        expect(ports.mount).not.toHaveBeenCalled(); expect(ports.subscribe).not.toHaveBeenCalled(); expect(ports.watch).not.toHaveBeenCalled();
        vi.unstubAllEnvs();
    });
    it('共享原译文公共端口和同一取消生命周期，变更广播刷新可见个人结果', () => {
        const ctx = {isInvalid: false}; const signal = new AbortController().signal;
        mountPersonalCorrectionContent(ctx as any, signal);
        expect(ports.mount).toHaveBeenCalledWith(ctx, signal, {readPair: ports.read, listVisiblePairs: ports.list, refreshVisible: ports.refresh});
        const [changed, subscribedSignal] = ports.subscribe.mock.calls[0];
        expect(subscribedSignal).toBe(signal); changed(); expect(ports.refresh).toHaveBeenCalledOnce();
        expect(ports.watch).toHaveBeenCalledWith(signal);
    });
});

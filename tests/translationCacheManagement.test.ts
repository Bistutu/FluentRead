import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    clearManagedTranslationCache,
    estimateTranslationCacheCapacity,
    getTranslationCacheStats,
} from '@/src/services/translation/cacheManagement';
import {sendTranslationCacheRequest, TranslationCacheRequestTimeoutError} from '@/src/services/translation/cacheRequest';

const {sendMessage} = vi.hoisted(() => ({sendMessage: vi.fn()}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage}}}));

beforeEach(() => {
    sendMessage.mockReset();
    vi.useFakeTimers();
});

afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('翻译缓存管理客户端', () => {
    const stats = {bytes: 1234, entries: 4, maxBytes: 5 * 1024 * 1024, maxEntries: 2000};

    it('仅通过后台消息读取统计，并返回独立的统计快照', async () => {
        sendMessage.mockResolvedValue({success: true, stats: {...stats, secret: 'ignored'}});
        await expect(getTranslationCacheStats()).resolves.toEqual(stats);
        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith({type: 'getTranslationCacheStats'});
    });

    it('接受明确的空缓存和正数上限，不把暂时超额伪装为空缓存', async () => {
        sendMessage.mockResolvedValue({success: true, stats: {...stats, bytes: 0, entries: 0}});
        await expect(getTranslationCacheStats()).resolves.toMatchObject({bytes: 0, entries: 0});
        sendMessage.mockResolvedValue({success: true, stats: {...stats, bytes: stats.maxBytes + 1}});
        await expect(getTranslationCacheStats()).resolves.toMatchObject({bytes: stats.maxBytes + 1});
    });

    it.each([
        undefined, null, false, 0, 'success', {},
        {success: false, error: 'storage unavailable'},
        {success: 'true'},
    ])('拒绝未明确成功的响应，不返回虚假的零用量 %#', async response => {
        sendMessage.mockResolvedValue(response);
        await expect(getTranslationCacheStats()).rejects.toThrow('缓存管理请求失败');
        await expect(clearManagedTranslationCache()).rejects.toThrow('缓存管理请求失败');
    });

    it.each([
        undefined, null, 1, 'stats', [], {},
        {...stats, bytes: -1}, {...stats, entries: -1},
        {...stats, bytes: NaN}, {...stats, bytes: Infinity},
        {...stats, bytes: Number.MAX_SAFE_INTEGER + 1},
        {...stats, entries: 0.5}, {...stats, entries: '4'},
        {...stats, maxBytes: 0}, {...stats, maxEntries: 0},
        {...stats, maxBytes: -1}, {...stats, maxEntries: 0.5},
    ])('拒绝缺失、负数、字符串和不安全的统计响应 %#', async invalidStats => {
        sendMessage.mockResolvedValue({success: true, stats: invalidStats});
        await expect(getTranslationCacheStats()).rejects.toThrow('缓存统计响应无效');
    });

    it('复用清空协议，只有后台确认成功才报告完成', async () => {
        let complete!: (value: unknown) => void;
        sendMessage.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
        let settled = false;
        const pending = clearManagedTranslationCache().then(() => { settled = true; });
        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith({type: 'clearTranslationCache'});
        await Promise.resolve();
        expect(settled).toBe(false);
        complete({success: true});
        await pending;
        expect(settled).toBe(true);
    });

    it('离页信号已取消时不发请求，等待中取消释放计时器并拒绝迟到确认', async () => {
        const before = new AbortController(); before.abort();
        await expect(getTranslationCacheStats({signal: before.signal})).rejects.toMatchObject({name: 'AbortError'});
        expect(sendMessage).not.toHaveBeenCalled();
        let complete!: (value: unknown) => void;
        sendMessage.mockImplementationOnce(() => new Promise(resolve => {complete = resolve;}));
        const controller = new AbortController();
        const pending = clearManagedTranslationCache({signal: controller.signal});
        const canceled = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        expect(vi.getTimerCount()).toBe(1);
        controller.abort(); await canceled;
        expect(vi.getTimerCount()).toBe(0);
        complete({success: true}); await Promise.resolve();
    });

    it('清除和随后统计共享剩余预算，到期后不继续发送消息', async () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
        const deadline = 16_000;
        sendMessage.mockResolvedValueOnce({success: true, invalidationPending: true});
        await expect(clearManagedTranslationCache({deadline})).resolves.toEqual({invalidationPending: true});
        now.mockReturnValue(15_000);
        sendMessage.mockImplementationOnce(() => new Promise(() => {}));
        const pending = getTranslationCacheStats({deadline});
        const timeout = expect(pending).rejects.toThrow('缓存管理请求超时');
        await vi.advanceTimersByTimeAsync(999);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1); await timeout;
        now.mockReturnValue(deadline);
        await expect(getTranslationCacheStats({deadline})).rejects.toThrow('缓存管理请求超时');
        expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    it('区分已清库而页面仍在同步，并拒绝畸形的同步状态', async () => {
        sendMessage.mockResolvedValueOnce({success: true});
        await expect(clearManagedTranslationCache()).resolves.toEqual({invalidationPending: false});
        sendMessage.mockResolvedValueOnce({success: true, invalidationPending: false});
        await expect(clearManagedTranslationCache()).resolves.toEqual({invalidationPending: false});
        sendMessage.mockResolvedValueOnce({success: true, invalidationPending: 'yes'});
        await expect(clearManagedTranslationCache()).rejects.toThrow('缓存管理请求失败');
    });

    it('后台拒绝后释放超时器，下一次可以重试', async () => {
        sendMessage.mockRejectedValueOnce(new Error('background unavailable'));
        await expect(getTranslationCacheStats()).rejects.toThrow('background unavailable');
        sendMessage.mockResolvedValueOnce({success: true, stats});
        await expect(getTranslationCacheStats()).resolves.toEqual(stats);
    });

    it('同步发送失败仍释放超时器', async () => {
        sendMessage.mockImplementationOnce(() => { throw new Error('sync failure'); });
        await expect(clearManagedTranslationCache()).rejects.toThrow('sync failure');
    });

    it('消息不返回时超时可重试，迟到响应不会覆盖下一次快照', async () => {
        let complete!: (value: unknown) => void;
        sendMessage.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        const pending = getTranslationCacheStats();
        const timeout = expect(pending).rejects.toThrow('缓存管理请求超时');
        await vi.advanceTimersByTimeAsync(15_000);
        await timeout;
        sendMessage.mockResolvedValueOnce({success: true, stats: {...stats, entries: 5}});
        await expect(getTranslationCacheStats()).resolves.toMatchObject({entries: 5});
        complete({success: true, stats});
        await Promise.resolve();
    });
});

describe('共享缓存消息等待', () => {
    it('不传选项时沿用十五秒上限，正常回复和拒绝均移除取消监听', async () => {
        await expect(sendTranslationCacheRequest(sendMessage.mockResolvedValueOnce('ok'), 'clearTranslationCache')).resolves.toBe('ok');
        for (const outcome of ['success', 'reject', 'throw'] as const) {
            const controller = new AbortController();
            const add = vi.spyOn(controller.signal, 'addEventListener');
            const remove = vi.spyOn(controller.signal, 'removeEventListener');
            if (outcome === 'success') sendMessage.mockResolvedValueOnce('ok');
            else if (outcome === 'reject') sendMessage.mockRejectedValueOnce(new Error('transport rejected'));
            else sendMessage.mockImplementationOnce(() => {throw new Error('transport threw');});
            const request = sendTranslationCacheRequest(sendMessage, 'clearTranslationCache', {signal: controller.signal});
            if (outcome === 'success') await expect(request).resolves.toBe('ok');
            else await expect(request).rejects.toThrow(outcome === 'reject' ? 'transport rejected' : 'transport threw');
            expect(add).toHaveBeenCalledWith('abort', expect.any(Function), {once: true});
            expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
            expect(vi.getTimerCount()).toBe(0);
            controller.abort();
        }
    });

    it('超时和取消都移除监听，迟到拒绝保持被观察而不阻碍新请求', async () => {
        for (const outcome of ['timeout', 'abort'] as const) {
            let rejectLate!: (error: Error) => void;
            sendMessage.mockImplementationOnce(() => new Promise((_resolve, reject) => {rejectLate = reject;}));
            const controller = new AbortController();
            const add = vi.spyOn(controller.signal, 'addEventListener');
            const remove = vi.spyOn(controller.signal, 'removeEventListener');
            const request = sendTranslationCacheRequest(sendMessage, 'getTranslationCacheStats', {signal: controller.signal});
            const rejected = outcome === 'timeout'
                ? expect(request).rejects.toBeInstanceOf(TranslationCacheRequestTimeoutError)
                : expect(request).rejects.toMatchObject({name: 'AbortError'});
            if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(15_000);
            else controller.abort();
            await rejected;
            expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
            expect(vi.getTimerCount()).toBe(0);
            rejectLate(new Error('late transport rejection'));
            await Promise.resolve();
            await expect(sendTranslationCacheRequest(sendMessage.mockResolvedValueOnce('retry'), 'getTranslationCacheStats')).resolves.toBe('retry');
        }
    });

    it('远期截止仍最多等待十五秒，无效截止和已取消信号不发送消息', async () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
        sendMessage.mockImplementationOnce(() => new Promise(() => {}));
        const request = sendTranslationCacheRequest(sendMessage, 'clearTranslationCache', {deadline: Infinity});
        const rejected = expect(request).rejects.toBeInstanceOf(TranslationCacheRequestTimeoutError);
        await vi.advanceTimersByTimeAsync(14_999);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1); await rejected;
        for (const deadline of [NaN, 1000, 999]) {
            await expect(sendTranslationCacheRequest(sendMessage, 'clearTranslationCache', {deadline})).rejects.toBeInstanceOf(TranslationCacheRequestTimeoutError);
        }
        const controller = new AbortController(); controller.abort();
        await expect(sendTranslationCacheRequest(sendMessage, 'clearTranslationCache', {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
        expect(sendMessage).toHaveBeenCalledOnce();
        expect(now).toHaveBeenCalled();
    });

    it('发送端同步取消后抛错也观察取消拒绝并清理所有等待资源', async () => {
        const controller = new AbortController();
        sendMessage.mockImplementationOnce(() => {controller.abort(); throw new Error('synchronous transport failure');});
        await expect(sendTranslationCacheRequest(sendMessage, 'clearTranslationCache', {signal: controller.signal}))
            .rejects.toThrow('synchronous transport failure');
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('缓存容量与页面数量估算', () => {
    const limits = {maxBytes: 5 * 1024 * 1024, maxEntries: 2000};

    it('空缓存按每条 1 KiB 与每页 50 条估算，默认受条数上限约束', () => {
        expect(estimateTranslationCacheCapacity(null, limits)).toEqual({entries: 2000, pages: 40, basedOnUsage: false});
        expect(estimateTranslationCacheCapacity({...limits, bytes: 0, entries: 0}, limits)).toEqual({entries: 2000, pages: 40, basedOnUsage: false});
    });

    it('已有结果按平均大小估算，容量较紧时由字节数限制', () => {
        expect(estimateTranslationCacheCapacity({...limits, bytes: 10 * 1024, entries: 2}, limits))
            .toEqual({entries: 1024, pages: 20.48, basedOnUsage: true});
    });

    it('调小后的有效上限优先于旧快照上限，并对不足一条的容量下取整', () => {
        expect(estimateTranslationCacheCapacity({...limits, bytes: 2048, entries: 2}, {maxBytes: 3000, maxEntries: 50}))
            .toEqual({entries: 2, pages: 0.04, basedOnUsage: true});
        expect(estimateTranslationCacheCapacity({...limits, bytes: 2048, entries: 1}, {maxBytes: 1024, maxEntries: 50}))
            .toEqual({entries: 0, pages: 0, basedOnUsage: true});
    });

    it('无可用平均大小时明确回到假设，避免除零或无限估算', () => {
        expect(estimateTranslationCacheCapacity({...limits, bytes: 0, entries: 1}, limits).basedOnUsage).toBe(false);
        expect(estimateTranslationCacheCapacity({...limits, bytes: 1024, entries: 0}, limits).basedOnUsage).toBe(false);
    });
});

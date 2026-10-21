/**
 * @file tests/nativePdfSelection.test.ts
 * 文件职责：验证原生 PDF 菜单原文的一次性窗口交付及后台装配。
 * 主要内容：用受控窗口创建和时钟覆盖首次兑换竞态、来源与目标校验、并发重放、过期、容量回收、失败和不落盘契约。
 * 模块边界：执行实际 feature 与 app 组合，只替换浏览器窗口端口；不访问 PDF 文件或翻译供应商。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createNativePdfSelectionBridge, NATIVE_PDF_SELECTION_TTL_MS, type NativePdfSelectionDependencies, type NativePdfSelectionInput, type NativePdfSelectionSender} from '@/src/features/selection-translation/background/nativePdfSelection';

const PAGE = 'chrome-extension://test/selection.html';
const INPUT = {text: 'cache\n  coherence', sourceUrl: 'https://www.usenix.org/paper.pdf?download=1#page=2', title: 'FAST paper'};
const TOKEN = '00000000000000000000000000000001';
const SENDER: NativePdfSelectionSender = {id: 'test', url: PAGE, frameId: 0, tab: {id: 21, windowId: 12}};
function deferred<T>() {let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
async function settle() {for (let at = 0; at < 12; at++) await Promise.resolve();}
function expiryScheduler() {
    return vi.fn<NativePdfSelectionDependencies['scheduleExpiry']>((callback, delayMs) => {
        const timer = setTimeout(callback, delayMs);
        return () => clearTimeout(timer);
    });
}
function fixture(overrides: Partial<NativePdfSelectionDependencies> = {}) {
    let time = 1_000, sequence = 0;
    const dependencies = {extensionId: 'test', resultUrl: PAGE, now: () => time,
        randomToken: vi.fn(() => (++sequence).toString(16).padStart(32, '0')),
        openWindow: vi.fn<NativePdfSelectionDependencies['openWindow']>().mockResolvedValue({id: 12, tabs: [{id: 21, windowId: 12}]}),
        closeWindow: vi.fn<NativePdfSelectionDependencies['closeWindow']>().mockResolvedValue(undefined),
        scheduleExpiry: (callback: () => void, delayMs: number) => {
            const timer = setTimeout(callback, delayMs);
            return () => clearTimeout(timer);
        }, ...overrides};
    return {...dependencies, bridge: createNativePdfSelectionBridge(dependencies), advance: (ms: number) => {time += ms;}};
}
beforeEach(() => {vi.useFakeTimers(); vi.clearAllMocks();});
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();});

describe('原生 PDF 菜单选区的一次性窗口交付', () => {
    it('仅在独立小窗口地址放随机票据，原文内部空白准确保留，来源剔除 fragment', async () => {
        const run = fixture({resultUrl: `${PAGE}?old=1#stale`});
        expect(await run.bridge.open({...INPUT, text: ` \n${INPUT.text}\t `, title: ' FAST paper '})).toBe(true);
        expect(run.openWindow).toHaveBeenCalledTimes(1);
        expect(run.openWindow).toHaveBeenCalledWith({url: `${PAGE}#token=${TOKEN}`, type: 'popup', width: 520, height: 680});
        expect(await run.bridge.claim(TOKEN, SENDER)).toEqual({...INPUT, sourceUrl: 'https://www.usenix.org/paper.pdf?download=1'});
        expect(await run.bridge.claim(TOKEN, SENDER)).toBeNull(); expect(run.closeWindow).not.toHaveBeenCalled();
    });
    it.each([
        {text: ''}, {text: ' \n\t'}, {text: 'x'.repeat(4097)}, {text: undefined}, {sourceUrl: 'file:///tmp/paper.pdf'},
        {sourceUrl: 'https://user:secret@example.com/paper.pdf'}, {sourceUrl: 'invalid'}, {sourceUrl: undefined}, {title: undefined},
    ])('非法输入 %j 不创建窗口也不签票', async change => {
        const run = fixture(); expect(await run.bridge.open({...INPUT, ...change} as NativePdfSelectionInput)).toBe(false);
        expect(run.openWindow).not.toHaveBeenCalled(); expect(run.randomToken).not.toHaveBeenCalled();
    });
    it('支持正好 4096 字和无后缀 HTTP 来源；长标题仅保留 512 字', async () => {
        const run = fixture(); expect(await run.bridge.open({text: 'x'.repeat(4096), sourceUrl: 'http://example.com/download?id=9', title: 't'.repeat(600)})).toBe(true);
        expect(await run.bridge.claim(TOKEN, SENDER)).toEqual({text: 'x'.repeat(4096), sourceUrl: 'http://example.com/download?id=9', title: 't'.repeat(512)});
    });
    it.each([undefined, null, 1, 'unknown'])('未知票据 %s 不泄漏正文', async token => {const run = fixture(); await run.bridge.open(INPUT); expect(await run.bridge.claim(token, SENDER)).toBeNull();});
    it.each([
        undefined, {...SENDER, id: 'foreign'}, {...SENDER, url: undefined}, {...SENDER, url: 'https://test/selection.html'},
        {...SENDER, url: 'chrome-extension://other/selection.html'}, {...SENDER, url: `${PAGE}/nested`}, {...SENDER, url: `${PAGE}.evil`},
        {...SENDER, frameId: undefined}, {...SENDER, frameId: 1}, {...SENDER, tab: undefined}, {...SENDER, tab: {id: 22, windowId: 12}}, {...SENDER, tab: {id: 21, windowId: 13}},
    ])('拒绝来源或目标不符的发送方 %j，同时保留合法窗口兑换权', async sender => {
        const run = fixture(); await run.bridge.open(INPUT); expect(await run.bridge.claim(TOKEN, sender)).toBeNull(); expect(await run.bridge.claim(TOKEN, SENDER)).not.toBeNull();
    });
    it('结果页已清除 hash 或保留参数时按精确页面和目标身份校验', async () => {
        const run = fixture(); await run.bridge.open(INPUT); expect(await run.bridge.claim(TOKEN, {...SENDER, url: `${PAGE}?layout=compact#different`})).not.toBeNull();
    });
    it.each([{id: 12}, {id: 12, tabs: []}, {id: 12, tabs: [{}]}])('浏览器没有返回标签 ID 时绑定目标 windowId %j', async window => {
        const run = fixture({openWindow: vi.fn().mockResolvedValue(window)}); await run.bridge.open(INPUT);
        expect(await run.bridge.claim(TOKEN, {...SENDER, tab: {windowId: 99}})).toBeNull();
        expect(await run.bridge.claim(TOKEN, {...SENDER, tab: {windowId: 12}})).not.toBeNull();
    });
    it('页面先请求兑换时等待窗口创建身份落地，并发领取只有一个成功', async () => {
        const window = deferred<{id: number; tabs: {id: number}[]}>(), run = fixture({openWindow: vi.fn().mockReturnValue(window.promise)});
        const opened = run.bridge.open(INPUT), first = run.bridge.claim(TOKEN, SENDER), second = run.bridge.claim(TOKEN, SENDER);
        let settled = false; void first.then(() => {settled = true;}); await settle(); expect(settled).toBe(false);
        window.resolve({id: 12, tabs: [{id: 21}]}); expect(await opened).toBe(true);
        expect(await first).not.toBeNull(); expect(await second).toBeNull();
    });
    it('创建期间错误窗口提前领取，创建后仍按最终窗口身份拒绝', async () => {
        const window = deferred<{id: number}>(), run = fixture({openWindow: vi.fn().mockReturnValue(window.promise)});
        const opened = run.bridge.open(INPUT), wrong = run.bridge.claim(TOKEN, {...SENDER, tab: {windowId: 99}});
        window.resolve({id: 12}); await opened; expect(await wrong).toBeNull(); expect(await run.bridge.claim(TOKEN, SENDER)).not.toBeNull();
    });
    it('到期票据无法领取并回收其未使用窗口；回收失败不传播错误', async () => {
        const closeWindow = vi.fn().mockRejectedValue(new Error('already closed')), run = fixture({closeWindow}); await run.bridge.open(INPUT);
        run.advance(NATIVE_PDF_SELECTION_TTL_MS); expect(await run.bridge.claim(TOKEN, SENDER)).toBeNull(); await settle();
        expect(closeWindow).toHaveBeenCalledTimes(1); expect(closeWindow).toHaveBeenCalledWith(12);
    });
    it('到期定时器无需再次请求就回收窗口，重复迟到回调也只关闭一次', async () => {
        const scheduleExpiry = expiryScheduler(), run = fixture({scheduleExpiry});
        expect(await run.bridge.open(INPUT)).toBe(true);
        expect(scheduleExpiry).toHaveBeenCalledWith(expect.any(Function), NATIVE_PDF_SELECTION_TTL_MS);
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(NATIVE_PDF_SELECTION_TTL_MS - 1); expect(run.closeWindow).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(run.closeWindow).toHaveBeenCalledTimes(1); expect(run.closeWindow).toHaveBeenCalledWith(12);
        expect(vi.getTimerCount()).toBe(0);
        const expire = scheduleExpiry.mock.calls[0][0]; expire(); expire();
        vi.advanceTimersByTime(NATIVE_PDF_SELECTION_TTL_MS);
        expect(await run.bridge.claim(TOKEN, SENDER)).toBeNull(); expect(run.closeWindow).toHaveBeenCalledTimes(1);
    });
    it('领取成功取消到期定时器，已经排队的迟到回调不得关闭已交付窗口', async () => {
        const scheduleExpiry = expiryScheduler(), run = fixture({scheduleExpiry}); await run.bridge.open(INPUT);
        expect(vi.getTimerCount()).toBe(1);
        expect(await run.bridge.claim(TOKEN, SENDER)).toEqual({...INPUT, sourceUrl: 'https://www.usenix.org/paper.pdf?download=1'});
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(NATIVE_PDF_SELECTION_TTL_MS);
        const expire = scheduleExpiry.mock.calls[0][0]; expire(); expire();
        expect(run.closeWindow).not.toHaveBeenCalled(); expect(await run.bridge.claim(TOKEN, SENDER)).toBeNull();
    });
    it('窗口关闭只丢弃对应票据并取消定时器，另一窗口仍能领取且迟到回调不重复关闭', async () => {
        const scheduleExpiry = expiryScheduler(), run = fixture({scheduleExpiry, openWindow: vi.fn().mockResolvedValueOnce({id: 12, tabs: [{id: 21}]}).mockResolvedValueOnce({id: 13, tabs: [{id: 22}]})});
        expect(await run.bridge.open(INPUT)).toBe(true);
        expect(await run.bridge.open({...INPUT, text: 'another selection'})).toBe(true);
        expect(vi.getTimerCount()).toBe(2);
        run.bridge.windowClosed(99); expect(vi.getTimerCount()).toBe(2);
        run.bridge.windowClosed(12); run.bridge.windowClosed(12);
        expect(vi.getTimerCount()).toBe(1); expect(run.closeWindow).not.toHaveBeenCalled();
        expect(await run.bridge.claim(TOKEN, SENDER)).toBeNull();
        const expireClosed = scheduleExpiry.mock.calls[0][0]; expireClosed(); expireClosed();
        expect(vi.getTimerCount()).toBe(1); expect(run.closeWindow).not.toHaveBeenCalled();
        expect(await run.bridge.claim('00000000000000000000000000000002', {...SENDER, tab: {id: 22, windowId: 13}})).toEqual({...INPUT, text: 'another selection', sourceUrl: 'https://www.usenix.org/paper.pdf?download=1'});
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(NATIVE_PDF_SELECTION_TTL_MS);
        scheduleExpiry.mock.calls[1][0](); expireClosed(); expect(run.closeWindow).not.toHaveBeenCalled();
    });
    it('读取发送方身份时同步关闭窗口，已释放正文返回 null 且不影响另一票据', async () => {
        const scheduleExpiry = expiryScheduler(), run = fixture({scheduleExpiry, openWindow: vi.fn().mockResolvedValueOnce({id: 12, tabs: [{id: 21}]}).mockResolvedValueOnce({id: 13, tabs: [{id: 22}]})});
        expect(await run.bridge.open(INPUT)).toBe(true);
        expect(await run.bridge.open({...INPUT, text: 'unaffected selection'})).toBe(true);
        // 浏览器 sender 通常是普通数据；只读 accessor 在此注入公开 bridge 的同步重入，不代表浏览器事件并发。
        const readWindowId = vi.fn(() => {run.bridge.windowClosed(12); return 12;});
        const sender: NativePdfSelectionSender = {...SENDER, tab: {id: 21, get windowId() {return readWindowId();}}};
        expect(await run.bridge.claim(TOKEN, sender)).toBeNull();
        expect(readWindowId).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1);
        run.bridge.windowClosed(12); scheduleExpiry.mock.calls[0][0]();
        expect(run.closeWindow).not.toHaveBeenCalled(); expect(await run.bridge.claim(TOKEN, SENDER)).toBeNull();
        expect(await run.bridge.claim('00000000000000000000000000000002', {...SENDER, tab: {id: 22, windowId: 13}})).toEqual({...INPUT, text: 'unaffected selection', sourceUrl: 'https://www.usenix.org/paper.pdf?download=1'});
        expect(vi.getTimerCount()).toBe(0); expect(run.closeWindow).not.toHaveBeenCalled();
    });
    it('创建等待跨过到期时间，即使窗口迟到成功也回收且只关闭一次', async () => {
        const window = deferred<{id: number}>(), closeWindow = vi.fn().mockResolvedValue(undefined), run = fixture({closeWindow, openWindow: vi.fn().mockReturnValue(window.promise)});
        const opened = run.bridge.open(INPUT), claim = run.bridge.claim(TOKEN, SENDER); run.advance(NATIVE_PDF_SELECTION_TTL_MS);
        window.resolve({id: 12}); expect(await opened).toBe(false); expect(await claim).toBeNull(); await settle(); expect(closeWindow).toHaveBeenCalledTimes(1);
    });
    it('兑换开始后票据才到期，异步等待不能延长交付有效期', async () => {
        const closeWindow = vi.fn().mockResolvedValue(undefined), run = fixture({closeWindow}); await run.bridge.open(INPUT);
        const claim = run.bridge.claim(TOKEN, SENDER); run.advance(NATIVE_PDF_SELECTION_TTL_MS);
        expect(await claim).toBeNull(); expect(closeWindow).toHaveBeenCalledTimes(1);
    });
    it('等待创建的票据被过期清理后，新窗口迟到仍回收且不污染新票据', async () => {
        const window = deferred<{id: number}>(), closeWindow = vi.fn().mockResolvedValue(undefined), run = fixture({closeWindow, openWindow: vi.fn().mockReturnValueOnce(window.promise).mockResolvedValue({id: 13})});
        const old = run.bridge.open(INPUT); await settle(); run.advance(NATIVE_PDF_SELECTION_TTL_MS); expect(await run.bridge.claim(TOKEN, SENDER)).toBeNull();
        expect(await run.bridge.open(INPUT)).toBe(true); window.resolve({id: 12}); expect(await old).toBe(false);
        expect(closeWindow).toHaveBeenCalledWith(12); expect(await run.bridge.claim('00000000000000000000000000000002', {...SENDER, tab: {windowId: 13}})).not.toBeNull();
    });
    it.each([undefined, -1, 1.5, NaN])('窗口身份 %s 不完整时不发出可兑换票据', async id => {
        const run = fixture({openWindow: vi.fn().mockResolvedValue({id})}); expect(await run.bridge.open(INPUT)).toBe(false); expect(await run.bridge.claim(TOKEN, SENDER)).toBeNull();
    });
    it('创建失败向菜单返回 false，等待中的领取也返回 null', async () => {
        const window = deferred<never>(), run = fixture({openWindow: vi.fn().mockReturnValue(window.promise)});
        const opened = run.bridge.open(INPUT), claim = run.bridge.claim(TOKEN, SENDER); window.reject(new Error('popup unavailable'));
        expect(await opened).toBe(false); expect(await claim).toBeNull();
    });
    it('签票时清理过期已打开窗口，新票据仍可交付', async () => {
        const closeWindow = vi.fn().mockResolvedValue(undefined), run = fixture({closeWindow}); await run.bridge.open(INPUT); run.advance(NATIVE_PDF_SELECTION_TTL_MS);
        expect(await run.bridge.open(INPUT)).toBe(true); expect(closeWindow).toHaveBeenCalledTimes(1); expect(await run.bridge.claim(TOKEN, SENDER)).toBeNull();
    });
    it('容量超过十六条时只淘汰最旧票据并关闭它的孤儿窗口', async () => {
        const closeWindow = vi.fn().mockResolvedValue(undefined), run = fixture({closeWindow});
        for (let at = 0; at < 17; at++) expect(await run.bridge.open({...INPUT, text: `selection ${at}`})).toBe(true);
        expect(closeWindow).toHaveBeenCalledTimes(1); expect(await run.bridge.claim(TOKEN, SENDER)).toBeNull();
        expect((await run.bridge.claim('00000000000000000000000000000011', SENDER))?.text).toBe('selection 16');
    });
    it('容量淘汰尚在创建的票据，迟到的窗口也会回收', async () => {
        const firstWindow = deferred<{id: number}>(), closeWindow = vi.fn().mockResolvedValue(undefined), run = fixture({closeWindow, openWindow: vi.fn().mockReturnValueOnce(firstWindow.promise).mockResolvedValue({id: 13})});
        const first = run.bridge.open(INPUT); await settle(); for (let at = 0; at < 16; at++) await run.bridge.open(INPUT);
        firstWindow.resolve({id: 12}); expect(await first).toBe(false); expect(closeWindow).toHaveBeenCalledTimes(1); expect(closeWindow).toHaveBeenCalledWith(12);
    });
    it.each(['', 'predictable', 'x'.repeat(32)])('随机数端口返回非法 token %s 不创建结果页', async token => {
        const run = fixture({randomToken: () => token}); expect(await run.bridge.open(INPUT)).toBe(false); expect(run.openWindow).not.toHaveBeenCalled();
    });
    it('随机票据碰撞不覆盖已等待领取的原文', async () => {
        const run = fixture({randomToken: () => TOKEN}); await run.bridge.open(INPUT); expect(await run.bridge.open({...INPUT, text: 'replacement'})).toBe(false);
        expect((await run.bridge.claim(TOKEN, SENDER))?.text).toBe(INPUT.text);
    });
});

describe('后台原生 PDF bridge 的懒加载装配', () => {
    it.each([true, false])('超长原文仅打开无正文无来源的错误窗口，创建成功 %s 如实返回', async opened => {
        vi.resetModules(); const create = vi.fn();
        if (opened) create.mockResolvedValue({id: 12}); else create.mockRejectedValue(new Error('window blocked'));
        const api = {runtime: {getURL: vi.fn(() => PAGE)}, windows: {create}}; vi.stubGlobal('browser', api);
        const module = await import('@/src/app/background/nativePdfSelection');
        expect(await module.openNativePdfSelection({...INPUT, text: 'private text '.repeat(400)})).toBe(opened);
        expect(create).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledWith({url: `${PAGE}#error=too-long`, type: 'popup', width: 520, height: 680});
        expect(api.runtime.getURL).toHaveBeenCalledTimes(1);
    });
    it('非字符串选区继续由原有输入边界拒绝，不新开错误窗口', async () => {
        vi.resetModules(); const api = {runtime: {id: 'test', getURL: () => PAGE}, windows: {create: vi.fn(), onRemoved: {addListener: vi.fn()}}}; vi.stubGlobal('browser', api);
        const module = await import('@/src/app/background/nativePdfSelection');
        expect(await module.openNativePdfSelection({...INPUT, text: undefined} as unknown as NativePdfSelectionInput)).toBe(false);
        expect(api.windows.create).not.toHaveBeenCalled();
    });
    it('导入和创建 handler 均不访问 browser；首次菜单打开才装配，同实例兑换', async () => {
        vi.resetModules(); vi.stubGlobal('browser', undefined);
        const module = await import('@/src/app/background/nativePdfSelection'); const handler = module.createNativePdfSelectionHandler<{sender: NativePdfSelectionSender}>();
        expect(handler.type).toBe('claimNativePdfSelection');
        const api = {runtime: {id: 'test', getURL: vi.fn(() => PAGE)}, windows: {create: vi.fn().mockResolvedValue({id: 12, tabs: [{id: 21}]}), remove: vi.fn().mockResolvedValue(undefined), onRemoved: {addListener: vi.fn()}}};
        vi.stubGlobal('browser', api); vi.stubGlobal('crypto', {getRandomValues: (bytes: Uint8Array) => {bytes.fill(0); bytes[15] = 1; return bytes;}});
        expect(await module.openNativePdfSelection(INPUT)).toBe(true); expect(api.runtime.getURL).toHaveBeenCalledTimes(1);
        expect(await handler.handle({type: 'claimNativePdfSelection', token: TOKEN} as any, {sender: SENDER})).toEqual({...INPUT, sourceUrl: 'https://www.usenix.org/paper.pdf?download=1'});
        expect(await handler.handle({type: 'claimNativePdfSelection', token: TOKEN} as any, {sender: SENDER})).toBeNull();
    });
    it('后台重启或调用上下文缺失时返回 null，过期票据通过浏览器 remove 回收', async () => {
        vi.resetModules(); const api = {runtime: {id: 'test', getURL: () => PAGE}, windows: {create: vi.fn().mockResolvedValue({id: 12}), remove: vi.fn().mockResolvedValue(undefined), onRemoved: {addListener: vi.fn()}}};
        vi.stubGlobal('browser', api); vi.stubGlobal('crypto', {getRandomValues: (bytes: Uint8Array) => {bytes.fill(0); bytes[15] = 1; return bytes;}});
        const time = vi.spyOn(Date, 'now').mockReturnValue(0), module = await import('@/src/app/background/nativePdfSelection'), handler = module.createNativePdfSelectionHandler();
        expect(await handler.handle({type: 'claimNativePdfSelection'}, undefined)).toBeNull(); await module.openNativePdfSelection(INPUT);
        time.mockReturnValue(NATIVE_PDF_SELECTION_TTL_MS); expect(await handler.handle({type: 'claimNativePdfSelection', token: TOKEN} as any, {sender: SENDER})).toBeNull();
        expect(api.windows.remove).toHaveBeenCalledWith(12); time.mockRestore();
    });
});

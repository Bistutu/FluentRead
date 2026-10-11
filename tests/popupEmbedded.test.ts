import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const mountPorts = vi.hoisted(() => ({loaded: vi.fn(), mount: vi.fn(async (_selector: string) => {}), gate: undefined as Promise<void> | undefined}));
vi.mock('element-plus/es/components/base/style/css', () => ({}));

type Embedded = typeof import('../src/app/popup/embedded');
function createPort() {
    return {onmessage: null as ((event: {data: unknown}) => void) | null, postMessage: vi.fn(), start: vi.fn(), close: vi.fn()};
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => {resolve = yes;}); return {resolve, promise}; }
async function flush() { for (let index = 0; index < 8; index++) await Promise.resolve(); }

function fixture(embedded = true) {
    const target = Object.assign(new EventTarget(), {parent: {} as unknown, close: vi.fn()});
    if (!embedded) target.parent = target;
    const shell = {offsetHeight: 400, scrollHeight: 400, getBoundingClientRect: () => ({height: 400})};
    const probe = {style: {cssText: ''}, remove: vi.fn()};
    const documentRoot = {dataset: {}};
    const doc = {documentElement: documentRoot, body: {append: vi.fn()}, createElement: vi.fn(() => probe),
        querySelector: vi.fn((selector: string): unknown => selector === '.popup-shell' ? shell : null)};
    const runtime = {sendMessage: vi.fn(async (message: {type: string}) => message.type === 'authorizeFloatingPopup' ? {success: true, sourceTabId: 7} : {success: false})};
    const observers: Array<{callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>}> = [];
    class Observer {observe = vi.fn(); disconnect = vi.fn(); constructor(public callback: () => void) {observers.push(this);} }
    const computed = vi.fn(() => ({width: '380px'}));
    vi.stubGlobal('window', target); vi.stubGlobal('document', doc); vi.stubGlobal('browser', {runtime});
    vi.stubGlobal('chrome', undefined); vi.stubGlobal('ResizeObserver', Observer); vi.stubGlobal('getComputedStyle', computed);
    const connect = (port = createPort(), data: unknown = {type: 'fluentread-floating-popup-connect', token: 'fixture-token'}, source = target.parent, ports = [port]) => {
        target.dispatchEvent(Object.assign(new Event('message'), {data, source, ports}));
        return port;
    };
    return {target, shell, probe, doc, runtime, observers, computed, connect};
}

let popup: Embedded;
beforeEach(async () => {
    vi.useFakeTimers(); vi.resetModules(); vi.clearAllMocks(); mountPorts.gate = undefined;
    vi.doMock('../src/app/popup/mount', async () => {mountPorts.loaded(); await mountPorts.gate; return {mountPreparedPopupApp: mountPorts.mount};});
    popup = await import('../src/app/popup/embedded');
});
afterEach(() => {vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();});

async function authorizeFrame(f: ReturnType<typeof fixture>, port = createPort()) {
    const pending = popup.preparePopupSurface(); f.connect(port); expect(await pending).toBe(true); return port;
}

describe('页内 popup 授权与界面生命周期', () => {
    it('普通工具栏没有授权消息和观察器，仍通过 window.close 关闭', async () => {
        const f = fixture(false);
        expect(popup.isEmbeddedPopup()).toBe(false); expect(await popup.preparePopupSurface()).toBe(true);
        expect(popup.getEmbeddedPopupTabId()).toBeNull(); popup.observeEmbeddedPopupSize(); popup.closePopupSurface();
        expect(f.target.close).toHaveBeenCalledOnce(); expect(f.runtime.sendMessage).not.toHaveBeenCalled(); expect(f.doc.createElement).not.toHaveBeenCalled();
        vi.stubGlobal('window', undefined); expect(popup.isEmbeddedPopup()).toBe(false);
        vi.stubGlobal('window', {}); expect(popup.isEmbeddedPopup()).toBe(false);
    });

    it('未授权 iframe 不导入挂载模块、不发送启动提示，超时后停止入口', async () => {
        const f = fixture(); const {mountPopupApp} = await import('../src/app/popup/index');
        const pending = mountPopupApp('#app'); await flush();
        expect(mountPorts.loaded).not.toHaveBeenCalled(); expect(f.runtime.sendMessage).not.toHaveBeenCalled();
        expect(popup.getEmbeddedPopupTabId()).toBeNull();
        await vi.advanceTimersByTimeAsync(15_000); await pending;
        expect(popup.isPopupSurfaceActive()).toBe(false); expect(mountPorts.mount).not.toHaveBeenCalled();
    });

    it('父窗口凭据兑换后才加载完整界面，传回来源标识并发送 ready 和内容尺寸', async () => {
        const f = fixture(); const {mountPopupApp} = await import('../src/app/popup/index'); const pending = mountPopupApp('#app');
        const port = f.connect(); await pending;
        expect(f.runtime.sendMessage.mock.calls.map(([message]) => message.type)).toEqual(['authorizeFloatingPopup', 'popupStartup']);
        expect(popup.getEmbeddedPopupTabId()).toBe(7); expect(f.doc.documentElement.dataset).toEqual({fluentreadEmbeddedPopup: 'true'});
        expect(port.start).toHaveBeenCalledOnce(); expect(port.postMessage.mock.calls.map(([message]) => message)).toEqual([{type: 'ready'}, {type: 'resize', width: 380, height: 400}]);
        expect(mountPorts.loaded).toHaveBeenCalledOnce(); expect(mountPorts.mount).toHaveBeenCalledWith('#app');
    });

    it.each([
        {data: null}, {data: {type: 'other', token: 'fixture-token'}}, {data: {type: 'fluentread-floating-popup-connect', token: 7}},
        {data: {type: 'fluentread-floating-popup-connect', token: ''}}, {data: {type: 'fluentread-floating-popup-connect', token: 'x'.repeat(257)}},
        {foreign: true}, {portCount: 0}, {portCount: 2},
    ])('忽略未经验证的连接 $data $foreign $portCount', async scenario => {
        const f = fixture(); const pending = popup.preparePopupSurface(); const port = createPort();
        f.connect(port, 'data' in scenario ? scenario.data : undefined, scenario.foreign ? {} : f.target.parent,
            'portCount' in scenario ? Array.from({length: scenario.portCount ?? 0}, () => createPort()) : [port]);
        await flush(); expect(f.runtime.sendMessage).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(15_000); expect(await pending).toBe(false);
    });

    it.each([null, {success: false}, {success: true}, ...[-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '7'].map(sourceTabId => ({success: true, sourceTabId}))])
        ('拒绝不完整或无效授权回复 %j 后允许真正凭据重试', async response => {
            const f = fixture(); f.runtime.sendMessage.mockResolvedValueOnce(response as never);
            const pending = popup.preparePopupSurface(); const rejected = f.connect(); await flush();
            expect(popup.getEmbeddedPopupTabId()).toBeNull(); expect(rejected.close).toHaveBeenCalledOnce(); expect(rejected.postMessage).not.toHaveBeenCalled();
            const accepted = f.connect(); expect(await pending).toBe(true); expect(accepted.postMessage).toHaveBeenCalledWith({type: 'ready'});
        });

    it('同一兑换进行时忽略并发连接，并复用等待中的授权 Promise', async () => {
        const f = fixture(); const gate = deferred<unknown>(); f.runtime.sendMessage.mockReturnValueOnce(gate.promise as never);
        const pending = popup.preparePopupSurface(); expect(popup.preparePopupSurface()).toBe(pending);
        const accepted = f.connect(); const competing = f.connect(); await flush(); expect(f.runtime.sendMessage).toHaveBeenCalledOnce();
        gate.resolve({success: true, sourceTabId: 0}); expect(await pending).toBe(true); expect(popup.getEmbeddedPopupTabId()).toBe(0);
        expect(accepted.postMessage).toHaveBeenCalledWith({type: 'ready'}); expect(competing.postMessage).not.toHaveBeenCalled();
    });

    it.each(['rejected', 'thrown', 'absent', 'chromeError'])('消息端口 %s 失败不会建立来源授权', async kind => {
        const f = fixture();
        if (kind === 'rejected') f.runtime.sendMessage.mockRejectedValueOnce(new Error('unavailable'));
        if (kind === 'thrown') f.runtime.sendMessage.mockImplementationOnce(() => {throw new Error('unavailable');});
        if (kind === 'absent' || kind === 'chromeError') vi.stubGlobal('browser', undefined);
        if (kind === 'chromeError') vi.stubGlobal('chrome', {runtime: {lastError: {message: 'unavailable'}, sendMessage: (_message: unknown, callback: (reply: unknown) => void) => callback(undefined)}});
        const pending = popup.preparePopupSurface(); const port = f.connect(); await flush();
        expect(popup.getEmbeddedPopupTabId()).toBeNull(); expect(port.close).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(15_000); expect(await pending).toBe(false);
    });

    it('兼容 Chrome callback 授权接口', async () => {
        const f = fixture(); vi.stubGlobal('browser', undefined);
        const sendMessage = vi.fn((_message: unknown, callback: (reply: unknown) => void) => callback({success: true, sourceTabId: 12}));
        vi.stubGlobal('chrome', {runtime: {sendMessage}}); const port = await authorizeFrame(f);
        expect(sendMessage).toHaveBeenCalledWith({type: 'authorizeFloatingPopup', token: 'fixture-token'}, expect.any(Function));
        expect(popup.getEmbeddedPopupTabId()).toBe(12); expect(port.postMessage).toHaveBeenCalledWith({type: 'ready'});
    });

    it('页面退出取消等待兑换，迟到的成功不能导入配置和挂载模块', async () => {
        const f = fixture(); const gate = deferred<unknown>(); f.runtime.sendMessage.mockReturnValueOnce(gate.promise as never);
        const {mountPopupApp} = await import('../src/app/popup/index'); const pending = mountPopupApp('#app'); const port = f.connect();
        f.target.dispatchEvent(new Event('pagehide')); gate.resolve({success: true, sourceTabId: 7}); await pending; await flush();
        expect(popup.getEmbeddedPopupTabId()).toBeNull(); expect(port.close).toHaveBeenCalled(); expect(port.postMessage).not.toHaveBeenCalled(); expect(mountPorts.loaded).not.toHaveBeenCalled();
    });

    it('界面模块加载期间关闭，模块完成后也不挂载页面', async () => {
        const f = fixture(); const gate = deferred<void>(); mountPorts.gate = gate.promise;
        const {mountPopupApp} = await import('../src/app/popup/index'); const pending = mountPopupApp('#app'); f.connect();
        await vi.waitFor(() => expect(mountPorts.loaded).toHaveBeenCalledOnce()); popup.closePopupSurface(); gate.resolve(); await pending;
        expect(mountPorts.mount).not.toHaveBeenCalled();
    });

    it('Escape 和页面动作通知父端一次并清理尺寸监听，其他按键和消息不关闭面板', async () => {
        const f = fixture(); popup.closePopupSurface(); const port = await authorizeFrame(f); popup.observeEmbeddedPopupSize();
        port.onmessage?.({data: {type: 'resize'}}); f.target.dispatchEvent(Object.assign(new Event('keydown'), {key: 'Enter'})); expect(popup.isPopupSurfaceActive()).toBe(true);
        const event = Object.assign(new Event('keydown', {cancelable: true}), {key: 'Escape'}); f.target.dispatchEvent(event); popup.closePopupSurface();
        expect(event.defaultPrevented).toBe(true); expect(port.postMessage.mock.calls.filter(([message]) => message.type === 'close')).toHaveLength(1);
        expect(port.close).toHaveBeenCalledOnce(); expect(f.observers[0].disconnect).toHaveBeenCalledOnce(); expect(f.probe.remove).toHaveBeenCalledOnce();
        expect(popup.getEmbeddedPopupTabId()).toBeNull(); expect(popup.isPopupSurfaceActive()).toBe(false); f.observers[0].callback(); popup.observeEmbeddedPopupSize();
    });

    it('父端关闭不回传关闭消息，并让扩展页面的退出监听收到信号', async () => {
        const f = fixture(); const port = await authorizeFrame(f); const pagehide = vi.fn(); f.target.addEventListener('pagehide', pagehide);
        port.onmessage?.({data: {type: 'close'}}); expect(pagehide).toHaveBeenCalledOnce(); expect(port.close).toHaveBeenCalledOnce();
        expect(port.postMessage).toHaveBeenCalledTimes(1); expect(popup.getEmbeddedPopupTabId()).toBeNull();
    });
});

describe('页内 popup 内容尺寸', () => {
    it('CSS 期望宽度不受窄iframe限制，自然内容可以再次长高，也可以缩短', async () => {
        const f = fixture(); const port = await authorizeFrame(f); f.shell.offsetHeight = 180; f.shell.scrollHeight = 800;
        popup.observeEmbeddedPopupSize(); popup.observeEmbeddedPopupSize();
        expect(f.doc.createElement).toHaveBeenCalledOnce(); expect(f.probe.style.cssText).toContain('width:var(--fluentread-localized-popup-width,var(--interface-popup-width,320px))');
        expect(f.observers[0].observe.mock.calls.map(([element]) => element)).toEqual([f.doc.documentElement, f.doc.body, f.probe, f.shell]);
        expect(port.postMessage).toHaveBeenLastCalledWith({type: 'resize', width: 380, height: 560});
        f.observers[0].callback(); expect(port.postMessage).toHaveBeenCalledTimes(2);
        f.shell.offsetHeight = 120; f.shell.scrollHeight = 120; f.shell.getBoundingClientRect = () => ({height: 120}); f.computed.mockReturnValue({width: '400px'}); f.observers[0].callback();
        expect(port.postMessage).toHaveBeenLastCalledWith({type: 'resize', width: 400, height: 120});
    });

    it.each(['NaN', '0px', '-1px'])('无效期望宽度 %s 不发送尺寸', async width => {
        const f = fixture(); const port = await authorizeFrame(f); f.computed.mockReturnValue({width}); popup.observeEmbeddedPopupSize(); expect(port.postMessage).toHaveBeenCalledTimes(1);
    });

    it.each([0, NaN])('无效自然高度 %j 不发送尺寸', async height => {
        const f = fixture(); const port = await authorizeFrame(f); f.shell.offsetHeight = height; f.shell.scrollHeight = height; f.shell.getBoundingClientRect = () => ({height});
        popup.observeEmbeddedPopupSize(); expect(port.postMessage).toHaveBeenCalledTimes(1);
    });

    it('没有观察器时仍测量 #app 的实际内容，并响应窗口改变，空内容不发送尺寸', async () => {
        const f = fixture(); const port = await authorizeFrame(f); vi.stubGlobal('ResizeObserver', undefined);
        f.doc.querySelector.mockImplementation(selector => selector === '#app' ? {firstElementChild: f.shell} : null);
        popup.observeEmbeddedPopupSize(); expect(port.postMessage).toHaveBeenLastCalledWith({type: 'resize', width: 380, height: 400});
        f.doc.querySelector.mockReturnValue(null); f.target.dispatchEvent(new Event('resize')); expect(port.postMessage).toHaveBeenCalledTimes(2); popup.closePopupSurface();
    });

    it('空根节点没有伪造的viewport高度', async () => {
        const f = fixture(); const port = await authorizeFrame(f); f.doc.querySelector.mockReturnValue({firstElementChild: null});
        f.doc.querySelector.mockImplementation(selector => selector === '#app' ? {firstElementChild: null} : null);
        popup.observeEmbeddedPopupSize(); expect(port.postMessage).toHaveBeenCalledTimes(1); expect(f.observers[0].observe).toHaveBeenCalledTimes(3);
    });
});

describe('HTML 早期启动隐私边界', () => {
    it('任意 iframe 都跳过 popupStartup，不依赖可伪造的 URL 模式', () => {
        const sendMessage = vi.fn(); const context = {parent: {}, browser: {runtime: {sendMessage}}, location: {search: ''}};
        runInNewContext(readFileSync(new URL('../public/popup-startup.js', import.meta.url), 'utf8'), context);
        expect(sendMessage).not.toHaveBeenCalled(); expect(context).not.toHaveProperty('__fluentReadPopupWarmup');
    });
});

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {createAnchoredPopup, positionAnchoredPopup} from '@/src/features/floating-ball/content/anchoredPopup';

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: Deferred<T>['resolve'], reject!: Deferred<T>['reject'];
    return {promise: new Promise<T>((done, fail) => {resolve = done; reject = fail;}),
        resolve: value => resolve(value), reject: error => reject(error)};
}

class TestPort {
    onmessage: ((event: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    close = vi.fn();
    emit(data: unknown) {this.onmessage?.({data} as MessageEvent);}
}

class TestChannel {
    static instances: TestChannel[] = [];
    port1 = new TestPort();
    port2 = new TestPort();
    constructor() {TestChannel.instances.push(this);}
}

const popupUrl = 'chrome-extension://test-extension/popup.html?embedded=1';
let viewport: {width: number; height: number};
let iframeWindow: {postMessage: ReturnType<typeof vi.fn>} | null;
let controllers: Array<ReturnType<typeof createAnchoredPopup>>;

beforeEach(() => {
    vi.useFakeTimers();
    const dom = parseHTML('<!doctype html><html><body></body></html>');
    vi.stubGlobal('window', {
        addEventListener: vi.fn(dom.window.addEventListener.bind(dom.window)),
        removeEventListener: vi.fn(dom.window.removeEventListener.bind(dom.window)),
        dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    });
    vi.stubGlobal('document', dom.document);
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('MessageChannel', TestChannel);
    viewport = {width: 1200, height: 900};
    Object.defineProperties(window, {
        innerWidth: {configurable: true, get: () => viewport.width},
        innerHeight: {configurable: true, get: () => viewport.height},
    });
    iframeWindow = {postMessage: vi.fn()};
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((name: string, options?: ElementCreationOptions) => {
        const element = createElement(name, options);
        if (name === 'iframe') Object.defineProperty(element, 'contentWindow', {get: () => iframeWindow});
        return element;
    });
    TestChannel.instances = [];
    controllers = [];
});

afterEach(() => {
    for (const controller of controllers) controller.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function fixture(response: unknown = {success: true, token: 'private-one-use-token'}) {
    const host = document.createElement('div');
    const container = document.createElement('div');
    const button = document.createElement('button');
    host.append(container, button);
    document.body.append(host);
    let anchor = {left: 1120, right: 1160, top: 220, bottom: 260};
    button.getBoundingClientRect = vi.fn(() => anchor as DOMRect);
    button.focus = vi.fn();
    const request = vi.fn().mockResolvedValue(response);
    const getUrl = vi.fn(() => popupUrl);
    const onOpenChange = vi.fn();
    const controller = createAnchoredPopup(container, host, {request, getUrl, onOpenChange});
    controllers.push(controller);
    return {controller, host, container, button, request, getUrl, onOpenChange,
        setAnchor(value: typeof anchor) {anchor = value;},
        frame: () => container.querySelector('iframe') as HTMLIFrameElement | null};
}

function fireWindow(type: string, values: Record<string, unknown> = {}) {
    const event = new Event(type, {cancelable: true});
    for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, {value});
    window.dispatchEvent(event);
    return event;
}

function loadFrame(frame: HTMLIFrameElement) {
    frame.dispatchEvent(new Event('load'));
    return TestChannel.instances.at(-1)!;
}

describe('悬浮 Popup 的视口定位', () => {
    it('右侧按钮向左展开，左侧按钮向右展开，并保持按钮顶边对齐', () => {
        expect(positionAnchoredPopup({left: 1120, right: 1160, top: 220, bottom: 260},
            {width: 320, height: 560}, {width: 1200, height: 900}))
            .toEqual({left: 788, top: 220, width: 320, height: 560});
        expect(positionAnchoredPopup({left: 40, right: 80, top: 220, bottom: 260},
            {width: 320, height: 560}, {width: 1200, height: 900}))
            .toEqual({left: 92, top: 220, width: 320, height: 560});
    });

    it('底部和窄视口压缩面板，始终保留边距；越界按钮也不会推出面板', () => {
        expect(positionAnchoredPopup({left: 270, right: 310, top: 460, bottom: 500},
            {width: 400, height: 560}, {width: 320, height: 500}))
            .toEqual({left: 8, top: 8, width: 304, height: 440});
        expect(positionAnchoredPopup({left: -50, right: -10, top: -20, bottom: 20},
            {width: 320, height: 200}, {width: 1200, height: 900}))
            .toEqual({left: 8, top: 8, width: 320, height: 200});
        expect(positionAnchoredPopup({left: 1000, right: 1040, top: 800, bottom: 840},
            {width: 320, height: 560}, {width: 600, height: 700}))
            .toEqual({left: 272, top: 132, width: 320, height: 560});
    });

    it.each([
        [{left: 300, right: 340, top: 250, bottom: 290}, {width: 360, height: 500},
            {left: 8, top: 8, width: 344, height: 230}],
        [{left: 300, right: 340, top: 8, bottom: 48}, {width: 360, height: 500},
            {left: 8, top: 60, width: 344, height: 432}],
        [{left: 300, right: 340, top: 452, bottom: 492}, {width: 360, height: 500},
            {left: 8, top: 8, width: 344, height: 432}],
        [{left: 8, right: 48, top: 200, bottom: 240}, {width: 100, height: 300},
            {left: 8, top: 8, width: 84, height: 180}],
        [{left: 8, right: 48, top: 8, bottom: 48}, {width: 100, height: 300},
            {left: 8, top: 60, width: 84, height: 232}],
    ])('窄视口 %j 在较大垂直空间展开，保持间距和按钮可点击', (anchor, viewport, expected) => {
        const result = positionAnchoredPopup(anchor, {width: 380, height: 560}, viewport);
        expect(result).toEqual(expected);
        expect(result.left).toBeGreaterThanOrEqual(8);
        expect(result.top).toBeGreaterThanOrEqual(8);
        expect(result.left + result.width).toBeLessThanOrEqual(viewport.width - 8);
        expect(result.top + result.height).toBeLessThanOrEqual(viewport.height - 8);
        expect(result.top + result.height <= anchor.top - 12 || result.top >= anchor.bottom + 12).toBe(true);
    });
});

describe('悬浮 Popup 的授权和消息边界', () => {
    it('iframe 使用不含凭据的 URL，只向准确扩展 origin 转移专用 MessagePort', async () => {
        const f = fixture();
        await f.controller.toggle(f.button);
        const frame = f.frame()!;
        expect(f.onOpenChange).toHaveBeenCalledWith(true);
        expect(frame.src).toBe(popupUrl);
        expect(frame.outerHTML).not.toContain('private-one-use-token');
        expect(frame.title).toBe('FluentRead');
        expect(frame.style.visibility).toBe('hidden');
        expect(frame.style.left).toBe('788px');
        expect(iframeWindow!.postMessage).not.toHaveBeenCalled();
        const connection = loadFrame(frame);
        expect(iframeWindow!.postMessage).toHaveBeenCalledOnce();
        expect(iframeWindow!.postMessage).toHaveBeenCalledWith(
            {type: 'fluentread-floating-popup-connect', token: 'private-one-use-token'},
            'chrome-extension://test-extension', [connection.port2]);
        frame.dispatchEvent(new Event('load'));
        expect(TestChannel.instances).toHaveLength(1);
        connection.port1.emit({type: 'ready'});
        expect(frame.style.visibility).toBe('visible');
        vi.advanceTimersByTime(15_000);
        expect(f.frame()).toBe(frame);
    });

    it('再次点击会取消尚未授权的请求，迟到成功不能重建 iframe', async () => {
        const f = fixture();
        const pending = deferred<{success: boolean; token: string}>();
        f.request.mockReturnValue(pending.promise);
        const opening = f.controller.toggle(f.button);
        fireWindow('resize');
        expect(f.frame()).toBeNull();
        await f.controller.toggle(f.button);
        pending.resolve({success: true, token: 'too-late'});
        await opening;
        expect(f.onOpenChange.mock.calls).toEqual([[true], [false]]);
        expect(f.frame()).toBeNull();
        expect(f.getUrl).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(f.button.focus).not.toHaveBeenCalled();
    });

    it('取消请求后迟到失败被吸收，不干扰新一次打开', async () => {
        const f = fixture();
        const pending = deferred<never>();
        f.request.mockReturnValueOnce(pending.promise);
        const opening = f.controller.toggle(f.button);
        f.controller.close();
        await f.controller.toggle(f.button);
        const nextFrame = f.frame();
        pending.reject(new Error('expired request'));
        await expect(opening).resolves.toBeUndefined();
        expect(f.frame()).toBe(nextFrame);
        expect(f.onOpenChange.mock.calls).toEqual([[true], [false], [true]]);
    });

    it.each([
        [null, '无法打开快捷面板'],
        [{success: false}, '无法打开快捷面板'],
        [{success: false, error: '缺少页面授权'}, '缺少页面授权'],
        [{success: true, token: ''}, '无法打开快捷面板'],
    ])('授权失败 %j 时清理监听和计时器，并允许重试', async (response, error) => {
        const f = fixture(response);
        await expect(f.controller.toggle(f.button)).rejects.toThrow(error as string);
        expect(f.frame()).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        expect(f.onOpenChange.mock.calls).toEqual([[true], [false]]);
        f.request.mockResolvedValue({success: true, token: 'retry-token'});
        await f.controller.toggle(f.button);
        expect(f.frame()).not.toBeNull();
        expect(f.request).toHaveBeenCalledTimes(2);
    });

    it('iframe 没有窗口时不转移授权，并在等待期限后关闭', async () => {
        const f = fixture();
        await f.controller.toggle(f.button);
        iframeWindow = null;
        loadFrame(f.frame()!);
        expect(TestChannel.instances).toHaveLength(0);
        vi.advanceTimersByTime(15_000);
        expect(f.frame()).toBeNull();
    });

    it('关闭后迟到 load、ready、resize 和 close 都不能改变新面板', async () => {
        const f = fixture();
        await f.controller.toggle(f.button);
        const oldFrame = f.frame()!;
        const oldConnection = loadFrame(oldFrame);
        const oldMessage = oldConnection.port1.onmessage!;
        f.controller.close();
        oldFrame.dispatchEvent(new Event('load'));
        await f.controller.toggle(f.button);
        const nextFrame = f.frame()!;
        for (const data of [{type: 'ready'}, {type: 'resize', width: 400, height: 200}, {type: 'close'}]) {
            oldMessage({data} as MessageEvent);
        }
        expect(f.frame()).toBe(nextFrame);
        expect(nextFrame.style.visibility).toBe('hidden');
        expect(nextFrame.style.width).toBe('320px');
        expect(f.button.focus).not.toHaveBeenCalled();
        expect(oldConnection.port1.postMessage).toHaveBeenCalledWith({type: 'close'});
        expect(oldConnection.port1.close).toHaveBeenCalledOnce();
        expect(oldConnection.port2.close).toHaveBeenCalledOnce();
    });

    it('未连接就关闭的 iframe 忽略迟到 load', async () => {
        const f = fixture();
        await f.controller.toggle(f.button);
        const frame = f.frame()!;
        f.controller.close();
        loadFrame(frame);
        expect(TestChannel.instances).toHaveLength(0);
    });

    it('只接受有限正数尺寸，约束最大尺寸；未知消息不改变可见性或布局', async () => {
        const f = fixture();
        await f.controller.toggle(f.button);
        const frame = f.frame()!;
        const connection = loadFrame(frame);
        for (const data of [null, {}, {type: 'unknown'},
            {type: 'resize', width: NaN, height: 100}, {type: 'resize', width: 200, height: Infinity},
            {type: 'resize', width: 0, height: 100}, {type: 'resize', width: 200, height: -1},
            {type: 'resize', width: '400', height: 100}]) connection.port1.emit(data);
        expect(frame.style.visibility).toBe('hidden');
        expect(frame.style.width).toBe('320px');
        expect(frame.style.height).toBe('560px');
        connection.port1.emit({type: 'resize', width: 2000, height: 2000});
        expect(frame.style.width).toBe('800px');
        expect(frame.style.height).toBe('560px');
        expect(frame.style.left).toBe('308px');
        connection.port1.emit({type: 'resize', width: 400, height: 260});
        expect(frame.style.width).toBe('400px');
        expect(frame.style.height).toBe('260px');
        expect(frame.style.left).toBe('708px');
    });
});

describe('悬浮 Popup 的关闭和页面生命周期', () => {
    it('host 内部点击保留面板，外部点击关闭且不抢回焦点，并释放所有监听', async () => {
        const f = fixture();
        const removeListener = vi.mocked(window.removeEventListener);
        await f.controller.toggle(f.button);
        const frame = f.frame()!;
        const channel = loadFrame(frame);
        fireWindow('pointerdown', {composedPath: () => [f.button, f.host, document, window]});
        expect(f.frame()).toBe(frame);
        fireWindow('pointerdown', {composedPath: () => [document.body, document, window]});
        expect(f.frame()).toBeNull();
        expect(f.button.focus).not.toHaveBeenCalled();
        expect(channel.port1.close).toHaveBeenCalledOnce();
        expect(channel.port2.close).toHaveBeenCalledOnce();
        expect(removeListener.mock.calls.map(call => call[0])).toEqual(['pointerdown', 'keydown', 'resize', 'pagehide']);
        const calls = f.onOpenChange.mock.calls.length;
        fireWindow('pagehide');
        fireWindow('pointerdown');
        fireWindow('keydown', {key: 'Escape'});
        expect(f.onOpenChange).toHaveBeenCalledTimes(calls);
    });

    it('Esc 和面板 close 返回按钮焦点；其他按键不关闭', async () => {
        const f = fixture();
        await f.controller.toggle(f.button);
        expect(fireWindow('keydown', {key: 'Enter'}).defaultPrevented).toBe(false);
        expect(f.frame()).not.toBeNull();
        const floatingBallEscape = vi.fn();
        window.addEventListener('keydown', floatingBallEscape);
        const escape = fireWindow('keydown', {key: 'Escape'});
        expect(escape.defaultPrevented).toBe(true);
        expect(floatingBallEscape).not.toHaveBeenCalled();
        expect(f.frame()).toBeNull();
        expect(f.button.focus).toHaveBeenCalledOnce();
        expect(f.button.focus).toHaveBeenCalledWith({preventScroll: true});
        await f.controller.toggle(f.button);
        const channel = loadFrame(f.frame()!);
        channel.port1.emit({type: 'close'});
        expect(f.frame()).toBeNull();
        expect(f.button.focus).toHaveBeenCalledTimes(2);
    });

    it('窗口 resize 使用按钮的当前位置重新避让，页面离开释放面板', async () => {
        const f = fixture();
        await f.controller.toggle(f.button);
        const frame = f.frame()!;
        f.setAnchor({left: 30, right: 70, top: 860, bottom: 900});
        fireWindow('resize');
        expect(frame.style.left).toBe('82px');
        expect(frame.style.top).toBe('332px');
        viewport = {width: 280, height: 400};
        fireWindow('resize');
        expect(frame.style.left).toBe('8px');
        expect(frame.style.top).toBe('8px');
        expect(frame.style.width).toBe('264px');
        expect(frame.style.height).toBe('384px');
        fireWindow('pagehide');
        expect(f.frame()).toBeNull();
        expect(f.button.focus).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ready 可重复到达且仍可显式关闭；无面板时 close 也安全', async () => {
        const f = fixture();
        f.controller.close(true);
        await f.controller.toggle(f.button);
        const channel = loadFrame(f.frame()!);
        channel.port1.emit({type: 'ready'});
        channel.port1.emit({type: 'ready'});
        f.controller.close(true);
        expect(f.frame()).toBeNull();
        expect(f.button.focus).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });
});

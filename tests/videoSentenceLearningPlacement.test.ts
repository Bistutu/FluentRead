import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';
import {DEFAULT_VIDEO_SENTENCE_LEARNING_APPEARANCE, normalizeVideoSentenceLearningAppearance} from '@/src/core/config/videoSentenceLearningAppearance';
import {createVideoLearningPlacementOwner, createVideoSentenceLearningPlacement, getVideoLearningPlacement} from '@/src/features/video-subtitle/content/sentenceLearningPlacement';

// 执行真实定位、事件监听和清理；尺寸、RAF 与 ResizeObserver 是可控的浏览器端口。
function fixture(options: {width?: number; height?: number; scaleX?: number; scaleY?: number; panelHeight?: number; observer?: boolean; clientSize?: boolean} = {}) {
    const {document, window} = parseHTML('<html><body><div id="player"></div></body></html>');
    const player = document.getElementById('player')! as HTMLElement;
    const size = {width: options.width ?? 800, height: options.height ?? 600, scaleX: options.scaleX ?? 1, scaleY: options.scaleY ?? 1,
        panelHeight: options.panelHeight ?? 200, clientSize: options.clientSize ?? true};
    const rect = (width: number, height: number) => ({x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({})});
    Object.defineProperties(player, {clientWidth: {get: () => size.clientSize ? size.width : 0}, clientHeight: {get: () => size.clientSize ? size.height : 0}});
    const readPlayer = vi.fn(() => rect(size.width * size.scaleX, size.height * size.scaleY));
    player.getBoundingClientRect = readPlayer;
    const frames = new Map<number, FrameRequestCallback>(), archivedFrames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    const request = vi.fn((callback: FrameRequestCallback) => {const id = ++sequence; frames.set(id, callback); archivedFrames.set(id, callback); return id;});
    const cancel = vi.fn((id: number) => frames.delete(id));
    const windowEvents = new Map<string, Set<() => void>>();
    const addWindow = vi.fn((type: string, callback: () => void) => {const callbacks = windowEvents.get(type) ?? new Set(); callbacks.add(callback); windowEvents.set(type, callbacks);});
    const removeWindow = vi.fn((type: string, callback: () => void) => windowEvents.get(type)?.delete(callback));
    const observers: Array<{callback: () => void; observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>}> = [];
    class Observer {
        observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
        constructor(readonly callback: () => void) {observers.push(this);}
    }
    const windowPort = {requestAnimationFrame: request, cancelAnimationFrame: cancel, addEventListener: addWindow, removeEventListener: removeWindow,
        ResizeObserver: options.observer === false ? undefined : Observer};
    Object.defineProperty(document, 'defaultView', {value: windowPort});
    const addHost = () => {
        const host = document.createElement('div');
        host.innerHTML = '<header data-learning-drag-handle><span class="title">Learning</span><button>Replay</button><input><textarea></textarea><select></select><a>Settings</a><summary>Context</summary></header><p class="body">Original sentence.</p>';
        host.getBoundingClientRect = () => rect(360 * size.scaleX, size.panelHeight * size.scaleY);
        player.appendChild(host); return host;
    };
    const host = addHost();
    const flush = () => {const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(0));};
    const resize = () => windowEvents.get('resize')?.forEach(callback => callback());
    const emit = (target: EventTarget, type: string, fields: Record<string, unknown> = {}) => {
        const event = new window.Event(type, {bubbles: true, cancelable: true});
        Object.assign(event, {button: 0, pointerId: 7, clientX: 100, clientY: 100}, fields); target.dispatchEvent(event); return event;
    };
    const drag = (node = host, dx = 212, dy = 168) => {
        emit(node.querySelector('.title')!, 'pointerdown');
        emit(document, 'pointermove', {clientX: 100 + dx, clientY: 100 + dy});
        emit(document, 'pointerup', {clientX: 100 + dx, clientY: 100 + dy});
    };
    return {document, player, host, size, addHost, frames, archivedFrames, request, cancel, addWindow, removeWindow, observers, readPlayer, flush, resize, emit, drag};
}
const appearance = (value: Parameters<typeof normalizeVideoSentenceLearningAppearance>[0] = {}) => normalizeVideoSentenceLearningAppearance(value);
const left = (host: HTMLElement) => Number.parseFloat(host.style.left);
const top = (host: HTMLElement) => Number.parseFloat(host.style.top);

describe('学习面板有界位置规则', () => {
    it('四角给整个面板预留播放器控制区；拖动比例按剩余空间钳制', () => {
        const base = {playerWidth: 800, playerHeight: 600, panelWidth: 360, panelHeight: 200};
        expect(getVideoLearningPlacement({...base, position: 'top-left'})).toEqual({left: 8, top: 8, maxHeight: 536, compact: false});
        expect(getVideoLearningPlacement({...base, position: 'top-right'})).toMatchObject({left: 432, top: 8});
        expect(getVideoLearningPlacement({...base, position: 'bottom-left'})).toMatchObject({left: 8, top: 344});
        expect(getVideoLearningPlacement({...base, position: 'bottom-right'})).toMatchObject({left: 432, top: 344});
        expect(getVideoLearningPlacement({...base, position: 'top-left', dragged: {x: 0.25, y: 0.5}})).toMatchObject({left: 114, top: 176});
        expect(getVideoLearningPlacement({...base, position: 'top-left', dragged: {x: -1, y: 2}})).toMatchObject({left: 8, top: 344});
    });

    it('窄小画面不会产生负移动距离，340px边界自动切紧凑', () => {
        expect(getVideoLearningPlacement({playerWidth: 100, playerHeight: 40, panelWidth: 360, panelHeight: 200, position: 'bottom-right', dragged: {x: 1, y: 1}})).toEqual({left: 8, top: 8, maxHeight: 0, compact: true});
        const input = {playerWidth: 520, panelWidth: 300, panelHeight: 200, position: 'top-right' as const};
        expect(getVideoLearningPlacement({...input, playerHeight: 404}).compact).toBe(true);
        expect(getVideoLearningPlacement({...input, playerHeight: 405}).compact).toBe(false);
    });
});

describe('学习面板拖动与 DOM 生命周期', () => {
    it('仅标题栏主按钮启动拖动，不截获正文、表单或其他指针', () => {
        const f = fixture(); const changed = vi.fn();
        const placement = createVideoSentenceLearningPlacement({host: f.host, player: f.player, appearance: appearance(), onDragPosition: changed});
        f.emit(f.document, 'pointermove'); f.emit(f.document, 'pointerup');
        f.emit(f.host.querySelector('.title')!, 'pointerdown', {button: 2});
        for (const selector of ['button', 'input', 'textarea', 'select', 'a', 'summary', '.body']) f.emit(f.host.querySelector(selector)!, 'pointerdown');
        f.emit(f.host.querySelector('.title')!.firstChild!, 'pointerdown');
        expect(f.host.dataset.dragging).toBeUndefined(); expect(f.request).not.toHaveBeenCalled();
        const down = f.emit(f.host.querySelector('.title')!, 'pointerdown');
        expect(down.defaultPrevented).toBe(true); expect(f.host.dataset.dragging).toBe('true');
        f.emit(f.document, 'pointermove', {pointerId: 9, clientX: 30}); f.emit(f.document, 'pointerup', {pointerId: 9});
        expect(f.host.dataset.dragging).toBe('true'); expect(changed).not.toHaveBeenCalled();
        f.resize(); f.flush(); // 拖动已开始但尚无合法移动时只同步边界。
        expect(changed).not.toHaveBeenCalled();
        f.emit(f.document, 'pointercancel'); expect(f.host.dataset.dragging).toBeUndefined();
        placement.destroy();
    });

    it('每帧合并拖动，在缩放播放器内使用 CSS 尺寸并在抬手前提交最后移动', () => {
        const f = fixture({scaleX: 0.5, scaleY: 0.5}); const changed = vi.fn();
        const placement = createVideoSentenceLearningPlacement({host: f.host, player: f.player, appearance: appearance({position: 'bottom-right'}), onDragPosition: changed});
        expect(left(f.host)).toBe(432); expect(top(f.host)).toBe(344); // rect高100，实际 CSS 高200。
        f.emit(f.host.querySelector('.title')!, 'pointerdown');
        f.emit(f.document, 'pointermove', {clientX: 47, clientY: 58});
        f.emit(f.document, 'pointermove', {clientX: -6, clientY: 16});
        expect(f.request).toHaveBeenCalledOnce(); expect(changed).not.toHaveBeenCalled();
        f.emit(f.document, 'pointerup', {clientX: -6, clientY: 16});
        expect(f.cancel).toHaveBeenCalledOnce(); expect(f.frames.size).toBe(0);
        expect(changed).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledWith({x: 0.5, y: 0.5});
        expect(left(f.host)).toBe(220); expect(top(f.host)).toBe(176);
        expect(f.host.dataset.dragging).toBeUndefined();
        f.emit(f.document, 'pointermove', {clientX: 500}); expect(f.request).toHaveBeenCalledOnce();
        placement.destroy();
    });

    it('强烈拖动被钳制且不可移动的小播放器不产生 NaN 或越界偏移', () => {
        const f = fixture({width: 360, height: 264, panelHeight: 400}); const changed = vi.fn();
        const placement = createVideoSentenceLearningPlacement({host: f.host, player: f.player, appearance: appearance({layout: 'comfortable'}), onDragPosition: changed});
        f.drag(f.host, 10000, -10000);
        expect(changed).toHaveBeenLastCalledWith({x: 0, y: 0});
        expect(left(f.host)).toBe(8); expect(top(f.host)).toBe(8);
        expect(f.host.style.width).toBe('344px'); expect(f.host.style.maxHeight).toBe('200px');
        expect(f.host.dataset.compact).toBe('true');
        placement.destroy();
    });

    it('拖动位置跨尺寸与容器迁移按比例保留，改宽度保持位置，改默认角落解除拖动', () => {
        const f = fixture(); const changed = vi.fn();
        const placement = createVideoSentenceLearningPlacement({host: f.host, player: f.player, appearance: appearance({position: 'top-left'}), onDragPosition: changed});
        f.drag(); expect(left(f.host)).toBe(220); expect(top(f.host)).toBe(176);
        f.size.width = 1000; f.size.height = 800;
        f.resize(); f.observers[0].callback(); expect(f.frames.size).toBe(1); f.flush();
        expect(left(f.host)).toBe(320); expect(top(f.host)).toBe(276);
        placement.setAppearance(appearance({position: 'top-left', width: 520, backgroundOpacity: 70})); f.flush();
        expect(left(f.host)).toBe(240); expect(top(f.host)).toBe(276);
        const next = f.document.createElement('div');
        Object.defineProperties(next, {clientWidth: {value: 600}, clientHeight: {value: 400}});
        next.getBoundingClientRect = () => ({width: 600, height: 400}) as DOMRect;
        f.document.body.append(next); next.append(f.host);
        f.emit(f.host.querySelector('.title')!, 'pointerdown');
        placement.syncPlayer(next); f.flush();
        expect(f.host.dataset.dragging).toBeUndefined();
        expect(f.observers[0].unobserve).toHaveBeenCalledWith(f.player); expect(f.observers[0].observe).toHaveBeenCalledWith(next);
        expect(left(f.host)).toBe(40); expect(top(f.host)).toBe(76); // travelX64 / travelY136。
        placement.syncPlayer(next); f.flush();
        expect(f.observers[0].unobserve).toHaveBeenCalledOnce();
        placement.setAppearance(appearance({position: 'bottom-left', width: 520})); f.flush();
        expect(changed).toHaveBeenLastCalledWith(undefined); expect(left(f.host)).toBe(8); expect(top(f.host)).toBe(144);
        placement.destroy();
    });

    it('缺少 ResizeObserver/client尺寸时可退回 rect，零尺寸保持可恢复的边界', () => {
        const f = fixture({observer: false, clientSize: false, width: 620, height: 480, panelHeight: 120});
        const placement = createVideoSentenceLearningPlacement({host: f.host, player: f.player, appearance: appearance({layout: 'comfortable', position: 'bottom-right'}), onDragPosition: vi.fn()});
        expect(left(f.host)).toBe(252); expect(top(f.host)).toBe(304); expect(f.host.dataset.compact).toBe('false');
        f.size.width = 0; f.size.height = 0; f.resize(); f.flush();
        expect(f.host.style.width).toBe('0px'); expect(f.host.style.maxHeight).toBe('0px');
        expect(left(f.host)).toBe(8); expect(top(f.host)).toBe(8);
        const next = f.document.createElement('div');
        Object.defineProperties(next, {clientWidth: {value: 420}, clientHeight: {value: 360}});
        next.getBoundingClientRect = () => ({width: 420, height: 360}) as DOMRect;
        next.append(f.host); placement.syncPlayer(next); f.flush();
        expect(left(f.host)).toBe(52); expect(top(f.host)).toBe(184); expect(f.host.style.width).toBe('360px');
        placement.destroy();
    });

    it('destroy清理所有监听与观察，不允许排队回调或旧public方法重新观察节点', () => {
        const f = fixture(); const changed = vi.fn();
        const hostRemove = vi.spyOn(f.host, 'removeEventListener'), docRemove = vi.spyOn(f.document, 'removeEventListener');
        const placement = createVideoSentenceLearningPlacement({host: f.host, player: f.player, appearance: appearance(), onDragPosition: changed});
        f.emit(f.host.querySelector('.title')!, 'pointerdown'); f.emit(f.document, 'pointermove', {clientX: 40});
        const pending = [...f.archivedFrames.values()].at(-1)!;
        placement.destroy(); placement.destroy();
        const snapshot = f.host.getAttribute('style'), reads = f.readPlayer.mock.calls.length;
        pending(0); f.observers[0].callback(); f.resize();
        placement.syncPlayer(f.document.createElement('div')); placement.setAppearance(appearance({position: 'bottom-left'}));
        f.emit(f.host.querySelector('.title')!, 'pointerdown'); f.emit(f.document, 'pointermove'); f.emit(f.document, 'pointerup');
        expect(f.readPlayer).toHaveBeenCalledTimes(reads); expect(f.host.getAttribute('style')).toBe(snapshot);
        expect(changed).not.toHaveBeenCalled(); expect(f.observers[0].disconnect).toHaveBeenCalledOnce();
        expect(f.observers[0].observe).toHaveBeenCalledTimes(2); expect(f.frames.size).toBe(0);
        expect(hostRemove.mock.calls.map(call => call[0])).toEqual(['pointerdown']);
        expect(docRemove.mock.calls.map(call => call[0])).toEqual(['pointermove', 'pointerup', 'pointercancel']);
        expect(f.removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
    });
});

describe('学习面板位置的会话所有权', () => {
    it('普通配置通知不布局，关闭重开保持拖动，关闭后改默认角落清除旧拖动', () => {
        const f = fixture(); let value: unknown = {...DEFAULT_VIDEO_SENTENCE_LEARNING_APPEARANCE, position: 'top-left'};
        let notify!: () => void; const unsubscribe = vi.fn();
        const owner = createVideoLearningPlacementOwner(() => value, listener => {notify = listener; listener(); return unsubscribe;});
        const first = owner.place(f.host, f.player); expect(f.frames.size).toBe(0);
        notify(); value = {...value as object, unrelatedCounter: 123}; notify(); expect(f.frames.size).toBe(0);
        f.drag(); first.destroy();
        const secondHost = f.addHost(), second = owner.place(secondHost, f.player);
        expect(left(secondHost)).toBe(220); expect(top(secondHost)).toBe(176);
        value = {...value as object, width: 440, backgroundOpacity: 72}; notify(); f.flush();
        expect(left(secondHost)).toBe(180); expect(top(secondHost)).toBe(176);
        second.destroy();
        value = {...value as object, position: 'bottom-left'}; notify();
        const thirdHost = f.addHost(), third = owner.place(thirdHost, f.player);
        expect(left(thirdHost)).toBe(8); expect(top(thirdHost)).toBe(344);
        third.destroy(); owner.dispose(); expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('替换面板回收旧观察器，旧destroy不清当前实例，dispose拒绝迟到通知与复活', () => {
        const f = fixture(); let notify!: () => void; const unsubscribe = vi.fn();
        const read = vi.fn(() => ({position: 'top-left'}));
        const owner = createVideoLearningPlacementOwner(read, listener => {notify = listener; return unsubscribe;});
        const first = owner.place(f.host, f.player), secondHost = f.addHost(), second = owner.place(secondHost, f.player);
        expect(f.observers[0].disconnect).toHaveBeenCalledOnce(); first.destroy();
        expect(f.observers[1].disconnect).not.toHaveBeenCalled();
        second.syncPlayer(f.player); f.flush(); f.drag(secondHost);
        expect(left(secondHost)).toBe(220); expect(top(secondHost)).toBe(176);
        owner.dispose(); owner.dispose(); expect(unsubscribe).toHaveBeenCalledOnce();
        expect(f.observers[1].disconnect).toHaveBeenCalledOnce();
        const reads = read.mock.calls.length; notify(); expect(read).toHaveBeenCalledTimes(reads);
        const untouched = f.addHost(), late = owner.place(untouched, f.player);
        late.syncPlayer(f.player); late.destroy();
        expect(untouched.hasAttribute('style')).toBe(false); expect(f.observers).toHaveLength(2);
        expect(f.frames.size).toBe(0); second.destroy();
    });

    it('open时改默认角落即时清拖动；无面板时dispose仍只取消一次订阅', () => {
        const f = fixture(); let value: unknown = {position: 'top-left'}, notify!: () => void;
        const owner = createVideoLearningPlacementOwner(() => value, listener => {notify = listener; return vi.fn();});
        const placement = owner.place(f.host, f.player); f.drag();
        value = {position: 'bottom-right'}; notify(); f.flush();
        expect(left(f.host)).toBe(432); expect(top(f.host)).toBe(344);
        placement.destroy(); owner.dispose();
        const unsubscribe = vi.fn(); const empty = createVideoLearningPlacementOwner(() => undefined, () => unsubscribe);
        empty.dispose(); empty.dispose(); expect(unsubscribe).toHaveBeenCalledOnce();
    });
});

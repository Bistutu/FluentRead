/**
 * @file tests/shadowSelectOutside.test.ts
 * 文件职责：通过锁版本公开 ClickOutside 指令验证 UiSelect 的实例局部鼠标目标适配。
 * 主要内容：观察真实 document 监听与同 Event 委托，覆盖当前 contains、拖拽、排除项、绑定更新和生命周期清理。
 * 模块边界：真实源码按文件 collection；Linkedom 的 Shadow Root retarget 顺序是受控 DOM 端口，不证明原生浏览器行为。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {DirectiveBinding, ObjectDirective, VNode} from 'vue';

const dom = await vi.hoisted(async () => {
    const {parseHTML} = await import('linkedom');
    const parsed = parseHTML('<html><body></body></html>');
    for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'ShadowRoot', 'Event']) {
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: (parsed.window as any)[name]});
    }
    const registered: Array<{type: string; handler: EventListener; events: Event[]}> = [];
    const add = parsed.document.addEventListener.bind(parsed.document);
    let collecting = true;
    parsed.document.addEventListener = ((type: string, handler: EventListener, options?: boolean | AddEventListenerOptions) => {
        if (!collecting || (type !== 'mousedown' && type !== 'mouseup')) return add(type, handler, options);
        const row = {type, handler, events: [] as Event[]};registered.push(row);
        add(type, (event: Event) => {row.events.push(event);handler.call(parsed.document, event);}, options);
    }) as typeof parsed.document.addEventListener;
    return {document: parsed.document, window: parsed.window, registered, collected: () => {collecting = false;}};
});
// 精确 inline 锁版本公开叶子，在每文件的真实客户端 document 上 collection；不复制或模拟指令逻辑。
const {default: ClickOutside} = await vi.importActual<{default: ObjectDirective}>('element-plus/es/directives/click-outside/index.mjs?inline');
dom.collected();
import {createShadowSelectOutside} from '@/src/ui/shadowSelectOutside';

type Handler = (mouseup: MouseEvent, mousedown: MouseEvent) => void;
const vnode = {} as VNode<any, HTMLElement>;
const cleanups = new Set<() => void>();
function fixture(shadow: false | 'open' | 'closed' = 'closed', arg?: unknown) {
    const host = dom.document.createElement('div');dom.document.body.append(host);
    const scope = shadow ? host.attachShadow({mode: shadow}) : host;
    const element = dom.document.createElement('div'), option = dom.document.createElement('button');element.append(option);scope.append(element);
    const handler = vi.fn();
    const original: ObjectDirective = {...ClickOutside,
        beforeMount: vi.fn((...args: Parameters<NonNullable<typeof ClickOutside.beforeMount>>) => ClickOutside.beforeMount?.(...args)),
        updated: vi.fn((...args: Parameters<NonNullable<typeof ClickOutside.updated>>) => ClickOutside.updated?.(...args)),
        unmounted: vi.fn((...args: Parameters<NonNullable<typeof ClickOutside.unmounted>>) => ClickOutside.unmounted?.(...args)),
    };
    const adapter = createShadowSelectOutside(original);
    let binding: DirectiveBinding<Handler> = {value: handler, oldValue: null, arg: arg as any, instance: {popperRef: undefined}, modifiers: {}, dir: adapter.directive};
    adapter.directive.beforeMount!(element, binding, vnode, null);adapter.start();
    const update = (patch: Partial<DirectiveBinding<Handler>>) => {
        binding = {...binding, oldValue: binding.value, ...patch};adapter.directive.updated!(element, binding, vnode, vnode);
    };
    const dispose = () => {adapter.directive.unmounted!(element, binding, vnode, null);cleanups.delete(dispose);};cleanups.add(dispose);
    return {host, scope, element, option, handler, original, adapter, update, dispose};
}
// Linkedom 0.18.12 的 invokeListeners 会 delete event.target；原生 Event 在派发后仍保留 target。
// 仅每个测试鼠标 Event 的私有原型提供此 DOM port，保留身份和 instanceof，不改全局原型或指令。
function retainedMouse(target: Element, type: 'mousedown' | 'mouseup', bubbles: boolean) {
    const value = new dom.window.Event(type, {bubbles, cancelable: true});let visibleTarget = target;
    Reflect.deleteProperty(value, 'target');
    Object.setPrototypeOf(value, Object.create(Object.getPrototypeOf(value), {target: {get: () => visibleTarget, set: () => {}}}));
    return {value, retarget: (next: Element) => {visibleTarget = next;}};
}
function mouse(target: Element, type: 'mousedown' | 'mouseup') {
    const {value} = retainedMouse(target, type, true);target.dispatchEvent(value);expect(value.target).toBe(target);return value;
}
// 真实 Event 身份与真实 directive/document callback；Linkedom 的 retarget/capture 顺序是显式外部端口，非原生证明。
function captured(captureRoot: Element, target: Element, type: 'mousedown' | 'mouseup', host: Element, beforeDocument?: () => void) {
    const {value, retarget} = retainedMouse(target, type, false);
    const stop = vi.spyOn(value, 'stopPropagation'), prevent = vi.spyOn(value, 'preventDefault');captureRoot.dispatchEvent(value);
    beforeDocument?.();retarget(host);dom.document.dispatchEvent(value);
    expect(value.target).toBe(host);expect(stop).not.toHaveBeenCalled();expect(prevent).not.toHaveBeenCalled();expect(value.defaultPrevented).toBe(false);return value;
}
function outside() {const element = dom.document.createElement('button');dom.document.body.append(element);return element;}
afterEach(() => {for (const dispose of cleanups) dispose();cleanups.clear();dom.document.body.replaceChildren();vi.restoreAllMocks();});

describe('shadow select instance outside adapter using the real public directive', () => {
    it('registers and invokes the original document down/up listeners with the exact Event pair', () => {
        expect(dom.registered.map(row => row.type)).toEqual(['mousedown', 'mouseup']);
        const f = fixture(false), other = outside(), down = mouse(other, 'mousedown'), up = mouse(other, 'mouseup');
        expect(dom.registered[0].events).toContain(down);expect(dom.registered[1].events).toContain(up);
        expect(f.original.beforeMount).toHaveBeenCalledOnce();expect(f.handler).toHaveBeenCalledOnce();expect(f.handler).toHaveBeenCalledWith(up, down);
        expect(down).toBeInstanceOf(dom.window.Event);expect(up).toBeInstanceOf(dom.window.Event);
    });
    it.each(['open', 'closed'] as const)('preserves inside mouse selection and real document propagation in %s shadow', shadow => {
        const f = fixture(shadow), listener = vi.fn();dom.document.addEventListener('mouseup', listener);
        try {
            captured(f.element, f.option, 'mousedown', f.host);const up = captured(f.element, f.option, 'mouseup', f.host);
            expect(f.handler).not.toHaveBeenCalled();expect(listener).toHaveBeenCalledOnce();expect(listener).toHaveBeenCalledWith(up);
        } finally {dom.document.removeEventListener('mouseup', listener);}
    });
    it('keeps normal document inside/outside behavior and adds no capture listeners', () => {
        const add = vi.spyOn(dom.window.HTMLElement.prototype, 'addEventListener');const f = fixture(false);
        mouse(f.option, 'mousedown');mouse(f.option, 'mouseup');expect(f.handler).not.toHaveBeenCalled();
        const other = outside(), down = mouse(other, 'mousedown'), up = mouse(other, 'mouseup');expect(f.handler).toHaveBeenCalledOnce();expect(f.handler).toHaveBeenCalledWith(up, down);
        expect(add.mock.calls.filter(([name]) => name === 'mousedown' || name === 'mouseup')).toHaveLength(0);
    });
    it.each(['down-inside', 'up-inside'] as const)('preserves either current owned endpoint for %s mixed drag', endpoint => {
        const f = fixture(), other = outside();
        if (endpoint === 'down-inside') {captured(f.element, f.option, 'mousedown', f.host);mouse(other, 'mouseup');}
        else {mouse(other, 'mousedown');captured(f.element, f.option, 'mouseup', f.host);}
        expect(f.handler).not.toHaveBeenCalled();
    });
    it('closes after a down target has moved out and does not reuse a historical inside marker', () => {
        const f = fixture();captured(f.element, f.option, 'mousedown', f.host);dom.document.body.append(f.option);
        mouse(f.option, 'mouseup');expect(f.handler).toHaveBeenCalledOnce();
    });
    it('updates only one delegated binding and calls the latest handler without mutating the original directive', () => {
        const f = fixture(), latest = vi.fn(), other = outside();const originalBeforeMount = f.original.beforeMount;
        f.update({value: latest});f.update({value: latest});mouse(other, 'mousedown');mouse(other, 'mouseup');
        expect(f.handler).not.toHaveBeenCalled();expect(latest).toHaveBeenCalledOnce();expect(f.original.beforeMount).toBe(originalBeforeMount);
        const registered = vi.mocked(f.original.beforeMount!).mock.calls[0][1].value;
        for (const [, binding] of vi.mocked(f.original.updated!).mock.calls) {expect(binding.value).toBe(registered);expect(binding.oldValue).toBe(registered);}
        f.dispose();mouse(other, 'mousedown');mouse(other, 'mouseup');expect(latest).toHaveBeenCalledOnce();expect(f.original.unmounted).toHaveBeenCalledOnce();
    });
    it('clears old endpoints and removes exact capture listeners on stop, restart and unmount', () => {
        const add = vi.spyOn(dom.window.HTMLElement.prototype, 'addEventListener'), remove = vi.spyOn(dom.window.HTMLElement.prototype, 'removeEventListener');
        const f = fixture(), other = outside();captured(f.element, f.option, 'mousedown', f.host);f.adapter.start();f.adapter.stop();f.adapter.stop();f.adapter.start();mouse(other, 'mouseup');
        expect(f.handler).toHaveBeenCalledOnce();f.dispose();f.adapter.stop();
        const calls = (spy: typeof add) => spy.mock.calls.filter(([name, , capture]) => (name === 'mousedown' || name === 'mouseup') && capture === true);
        expect(calls(add)).toHaveLength(4);expect(calls(remove)).toHaveLength(4);
        for (const [name, listener, capture] of calls(add)) expect(calls(remove).some(call => call[0] === name && call[1] === listener && call[2] === capture)).toBe(true);
    });
    it('captures an external owned shadow popper but drops its old identity on replacement', () => {
        const f = fixture(), popper = dom.document.createElement('div'), option = dom.document.createElement('button');popper.append(option);f.scope.append(popper);
        f.update({instance: {popperRef: popper}, arg: popper as any});
        captured(popper, option, 'mousedown', f.host);captured(popper, option, 'mouseup', f.host);expect(f.handler).not.toHaveBeenCalled();
        f.update({instance: {popperRef: undefined}, arg: undefined});
        captured(popper, option, 'mousedown', f.host);captured(popper, option, 'mouseup', f.host);expect(f.handler).toHaveBeenCalledOnce();
    });
    it('leaves document-teleported poppers to the original directive', () => {
        const f = fixture(), popper = outside();f.update({instance: {popperRef: popper}, arg: popper as any});
        mouse(popper, 'mousedown');mouse(popper, 'mouseup');expect(f.handler).not.toHaveBeenCalled();
        const other = outside();mouse(other, 'mousedown');mouse(other, 'mouseup');expect(f.handler).toHaveBeenCalledOnce();
    });
    it('does not add duplicate listeners for a popper already contained by the select', () => {
        const add = vi.spyOn(dom.window.HTMLElement.prototype, 'addEventListener');const f = fixture();f.update({instance: {popperRef: f.option}, arg: f.option as any});
        captured(f.element, f.option, 'mousedown', f.host);captured(f.element, f.option, 'mouseup', f.host);expect(f.handler).not.toHaveBeenCalled();
        expect(add.mock.calls.filter(([name]) => name === 'mousedown' || name === 'mouseup')).toHaveLength(2);
    });
    it.each(['up-descendant', 'down-exact', 'down-descendant'] as const)('keeps the original array-exclusion asymmetry for %s', endpoint => {
        const f = fixture(), excluded = dom.document.createElement('div'), child = dom.document.createElement('button');excluded.append(child);f.scope.append(excluded);
        f.update({arg: [null, excluded] as any});const other = outside();
        if (endpoint === 'up-descendant') {mouse(other, 'mousedown');captured(excluded, child, 'mouseup', f.host);}
        else {captured(excluded, endpoint === 'down-exact' ? excluded : child, 'mousedown', f.host);mouse(other, 'mouseup');}
        expect(f.handler).toHaveBeenCalledTimes(endpoint === 'down-descendant' ? 1 : 0);
    });
    it.each([null, undefined])('does not treat a missing down record as a %s exclusion after the up target moves out', excluded => {
        const f = fixture(), other = outside();f.update({arg: [excluded] as any});
        const down = mouse(other, 'mousedown');
        const up = captured(f.element, f.option, 'mouseup', f.host, () => dom.document.body.append(f.option));
        expect(f.handler).toHaveBeenCalledOnce();expect(f.handler).toHaveBeenCalledWith(up, down);
    });
    it('rechecks live popper containment even when its identity changes before mouseup', () => {
        const f = fixture(), popper = dom.document.createElement('div'), child = dom.document.createElement('button');popper.append(child);f.scope.append(popper);
        const instance = {popperRef: popper as HTMLElement | undefined};f.update({instance, arg: undefined});captured(popper, child, 'mousedown', f.host);
        instance.popperRef = undefined;mouse(outside(), 'mouseup');expect(f.handler).toHaveBeenCalledOnce();
    });
    it('suspends listeners if an owning select is reactivated in the ordinary document', () => {
        const add = vi.spyOn(dom.window.HTMLElement.prototype, 'addEventListener'), remove = vi.spyOn(dom.window.HTMLElement.prototype, 'removeEventListener');const f = fixture();
        f.adapter.stop();dom.document.body.append(f.element);f.adapter.start();mouse(f.option, 'mousedown');mouse(f.option, 'mouseup');expect(f.handler).not.toHaveBeenCalled();
        const mouseCalls = (spy: typeof add) => spy.mock.calls.filter(([name]) => name === 'mousedown' || name === 'mouseup');expect(mouseCalls(add)).toHaveLength(2);expect(mouseCalls(remove)).toHaveLength(2);
    });
    it('forwards any additional original directive hooks unchanged', () => {
        const original: ObjectDirective = {created: vi.fn(), mounted: vi.fn(), beforeUpdate: vi.fn(), beforeUnmount: vi.fn(), getSSRProps: vi.fn(() => ({role: 'listbox'}))};
        const adapter = createShadowSelectOutside(original);
        for (const key of ['created', 'mounted', 'beforeUpdate', 'beforeUnmount', 'getSSRProps'] as const) expect(adapter.directive[key]).toBe(original[key]);
        adapter.start();adapter.stop();
    });
});

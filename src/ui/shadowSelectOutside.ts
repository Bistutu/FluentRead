/**
 * @file src/ui/shadowSelectOutside.ts
 * 文件职责：为下拉选择和取色器的实例局部 ClickOutside 指令保留 Shadow Root 内的真实鼠标目标。
 * 主要内容：委托原指令，按同一 Event 的内部目标和当前根、弹层、排除节点归属过滤误判；仅监听本实例节点，并在停用和卸载时清理。
 * 模块边界：不阻止或重发事件，不修改 Element Plus 全局定义，不解释选择值或配置；复用锁版本指令的排除节点和可选 popperRef 接口。
 */
import type {DirectiveBinding, ObjectDirective} from 'vue';

type OutsideHandler = (mouseup: MouseEvent, mousedown: MouseEvent) => void;

export function createShadowSelectOutside(original: ObjectDirective<HTMLElement, OutsideHandler>) {
    let currentElement: HTMLElement | undefined;
    let currentBinding: DirectiveBinding<OutsideHandler> | undefined;
    let insideTargets = new WeakMap<Event, EventTarget | null>();
    const captureTargets = new Set<Element>();
    let active = false;
    const rememberInside = (event: Event) => insideTargets.set(event, event.target);
    const popper = () => (currentBinding?.instance as {popperRef?: HTMLElement} | null | undefined)?.popperRef;
    let currentExclusions: Array<Element | null | undefined> = [];
    function updateBinding(binding: DirectiveBinding<OutsideHandler>) {
        currentBinding = binding;
        const arg: unknown = binding.arg;
        currentExclusions = Array.isArray(arg) ? arg : arg instanceof Element ? [arg] : [];
    }
    function syncListeners() {
        const targets = new Set<Element>();
        if (active && currentElement?.getRootNode() instanceof ShadowRoot) {
            targets.add(currentElement);
            // 显式 teleported/appendTo 可把同实例弹层移至根外，仍只捕获其真实拥有节点。
            for (const target of [popper(), ...currentExclusions]) {
                if (target instanceof Element && target.getRootNode() instanceof ShadowRoot && !currentElement.contains(target)) targets.add(target);
            }
        }
        for (const target of captureTargets) {
            if (targets.has(target)) continue;
            target.removeEventListener('mousedown', rememberInside, true);
            target.removeEventListener('mouseup', rememberInside, true);
            captureTargets.delete(target);
        }
        for (const target of targets) {
            if (captureTargets.has(target)) continue;
            target.addEventListener('mousedown', rememberInside, true);
            target.addEventListener('mouseup', rememberInside, true);
            captureTargets.add(target);
        }
    }
    function start() {active = true;syncListeners();}
    function stop() {active = false;syncListeners();insideTargets = new WeakMap();}
    const outside: OutsideHandler = (mouseup, mousedown) => {
        const up = insideTargets.get(mouseup), down = insideTargets.get(mousedown);
        if (up instanceof Node || down instanceof Node) {
            const currentPopper = popper(), excluded = currentExclusions;
            const contained = (target: EventTarget | null | undefined) => target instanceof Node &&
                (currentElement?.contains(target) || currentPopper?.contains(target));
            // 与原指令一致：松开时检查当前 contains；排除项对 mouseup 含后代，对 mousedown 只比身份。
            if (contained(up) || contained(down) || (up instanceof Node && excluded.some(item => item?.contains(up))) || (down instanceof Node && excluded.includes(down as Element))) return;
        }
        currentBinding?.value(mouseup, mousedown);
    };
    const directive: ObjectDirective<HTMLElement, OutsideHandler> = {
        ...original,
        beforeMount(element, binding, vnode, previous) {
            currentElement = element;
            updateBinding(binding);
            original.beforeMount?.(element, {...binding, value: outside}, vnode, previous);
        },
        updated(element, binding, vnode, previous) {
            currentElement = element;
            updateBinding(binding);
            original.updated?.(element, {...binding, value: outside, oldValue: outside}, vnode, previous);
            syncListeners();
        },
        unmounted(element, binding, vnode, previous) {
            stop();
            currentBinding = undefined;
            currentExclusions = [];
            currentElement = undefined;
            original.unmounted?.(element, {...binding, value: outside}, vnode, previous);
        },
    };
    return {directive, start, stop};
}

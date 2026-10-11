/**
 * @file src/ui/shadowColorPicker.ts
 * 文件职责：为取色器的实例局部 ClickOutside 指令保留 Shadow Root 内的真实鼠标目标。
 * 主要内容：复用锁版本 ColorPicker 的 setup、render 和 expose；仅替换每次新建面板的指令绑定，保持编译块中的面板身份，并在停用与卸载时清理捕获监听。
 * 模块边界：依赖 Element Plus 2.9.3 的唯一未挂载面板结构；不复制厂商渲染、不修改原组件或绑定，不改 Vue 编译标记、颜色值、事件传播或全局配置，也不追加 hide 行为。
 */
import {cloneVNode, isVNode, onActivated, onBeforeUnmount, onDeactivated, onMounted, type Slots} from 'vue';
import {ClickOutside, ElColorPicker, ElTooltip} from 'element-plus';
import {createShadowSelectOutside} from '@/src/ui/shadowSelectOutside';

type PickerSetup = NonNullable<typeof ElColorPicker.setup>;

export const ShadowColorPicker = Object.assign({}, ElColorPicker, {
    setup(props: Parameters<PickerSetup>[0], context: Parameters<PickerSetup>[1]) {
        const outside = createShadowSelectOutside(ClickOutside);
        onMounted(outside.start);
        onActivated(outside.start);
        onDeactivated(outside.stop);
        onBeforeUnmount(outside.stop);
        const render = ElColorPicker.setup!(props, context);
        if (typeof render !== 'function') return render;
        return function (this: unknown, ...renderArgs: unknown[]) {
            const root = Reflect.apply(render, this, renderArgs);
            if (!isVNode(root) || root.type !== ElTooltip) return root;
            const slots = root.children as Slots | null;
            const content = slots?.content;
            if (typeof content !== 'function') return root;
            const copiedRoot = cloneVNode(root);
            copiedRoot.children = {...slots, content: new Proxy(content, {
                apply(slot, receiver, slotArgs) {
                    const result: unknown = Reflect.apply(slot, receiver, slotArgs);
                    const panel: unknown = Array.isArray(result) && result.length === 1 ? result[0] : null;
                    if (!isVNode(panel) || panel.type !== 'div' || panel.el !== null) return result;
                    const bindings = panel.dirs;
                    if (!bindings || bindings.filter(binding => binding.dir === ClickOutside).length !== 1) return result;
                    // 保留 panel 在 compiled slot block 中的身份；克隆 panel 会留下未挂载的旧引用。
                    panel.dirs = bindings.map(binding => binding.dir === ClickOutside ? {...binding, dir: outside.directive} : binding);
                    return result;
                },
            })};
            return copiedRoot;
        };
    },
});

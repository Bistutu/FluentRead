import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
// 实际 runtime-dom 客户端装配。Element Plus 与界面翻译是受控 UI ports；
// SFC、Vue 生命周期、DOM、核心颜色/高亮/预览与排序模块保持真实。
const dom = await vi.hoisted(async () => {
  const {parseHTML} = await import('linkedom');
  const parsed = parseHTML('<html><body></body></html>');
  // 原生 DOM 节点的 WebIDL brand 让 Vue 将节点视为不可代理对象。
  // linkedom 缺少该标识；补齐外部 DOM port，避免 ref 把节点代理后破坏事件/焦点身份。
  Object.defineProperty(parsed.window.Node.prototype, Symbol.toStringTag, {configurable: true, get() {return this.constructor.name;}});
  for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'ShadowRoot', 'Event', 'CustomEvent']) {
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value: (parsed.window as any)[key]});
  }
  let active: any = null, nextFrame = 1;
  const frames = new Map<number, FrameRequestCallback>();
  Object.defineProperty(parsed.document, 'activeElement', {configurable: true, get: () => active});
  Object.defineProperty(parsed.window.ShadowRoot.prototype, 'activeElement', {configurable: true, get() {return active?.getRootNode() === this ? active : null;}});
  parsed.window.HTMLElement.prototype.focus = function () {active = this;};
  parsed.window.HTMLElement.prototype.blur = function () {if (active === this) active = null;};
  Object.defineProperty(parsed.window, 'getSelection', {configurable: true, writable: true, value: () => ({toString: () => ''})});
  // linkedom 的 window 是动态代理；固定这些外部 DOM ports，使监听计数可观测。
  for (const key of ['addEventListener', 'removeEventListener', 'dispatchEvent'] as const) {
    Object.defineProperty(parsed.window, key, {configurable: true, writable: true, value: parsed.document[key].bind(parsed.document)});
  }
  Object.defineProperty(parsed.window, 'getComputedStyle', {configurable: true, writable: true, value: () => ({transitionDelay: '0s', transitionDuration: '0s', animationDelay: '0s', animationDuration: '0s', transitionProperty: 'none'})});
  Object.defineProperty(parsed.window, 'innerWidth', {configurable: true, writable: true, value: 1000});
  const request = (callback: FrameRequestCallback) => {const id = nextFrame++; frames.set(id, callback); return id;};
  const cancel = (id: number) => frames.delete(id);
  Object.defineProperty(globalThis, 'requestAnimationFrame', {configurable: true, writable: true, value: request});
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {configurable: true, writable: true, value: cancel});
  // window 使用普通对象承载受控 ports；linkedom 代理的属性读取会绕过 spy。
  const windowPort = {document: parsed.document, Event: parsed.window.Event, HTMLElement: parsed.window.HTMLElement,
    addEventListener: parsed.document.addEventListener.bind(parsed.document), removeEventListener: parsed.document.removeEventListener.bind(parsed.document),
    dispatchEvent: parsed.document.dispatchEvent.bind(parsed.document), innerWidth: 1000,
    getSelection: () => ({toString: () => ''}), getComputedStyle: () => ({transitionDelay: '0s', transitionDuration: '0s', animationDelay: '0s', animationDuration: '0s', transitionProperty: 'none'})};
  parsed.window.HTMLElement.prototype.getBoundingClientRect = function () {return {x: 0, y: 0, top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10, toJSON: () => ({})};};
  Object.defineProperty(globalThis, 'window', {configurable: true, writable: true, value: windowPort});
  return {document: parsed.document as unknown as Document, window: windowPort, frames,
    flush: () => {const queued = [...frames]; frames.clear(); queued.forEach(([, callback]) => callback(0));}};
});
const ports = vi.hoisted(() => ({selects: [] as any[], pickers: [] as any[], tooltips: [] as any[], locale: null as any}));
// 外部 UI port 的 CSS 入口在 Node 中不能由原生 ESM 加载；组件样式仍由 Vue plugin 编译。
vi.mock('element-plus/es/components/select/style/css', () => ({}));
vi.mock('@/src/ui/i18n', async () => {
  const {ref} = await import('vue'); ports.locale = ref('');
  return {useUiI18n: () => ({t: (key: string, values?: object) => ports.locale.value + key + (values ? JSON.stringify(values) : ''),
    translateLegacy: (text: string) => ports.locale.value + text})};
});
vi.mock('element-plus', async () => {
  const {defineComponent, h, getCurrentInstance, Teleport} = await import('vue');
  const ElSelect = defineComponent({inheritAttrs: false,
    props: ['modelValue', 'disabled', 'teleported', 'placement', 'fallbackPlacements', 'popperClass', 'multiple', 'filterable', 'noMatchText', 'noDataText'],
    emits: ['change', 'update:modelValue', 'visible-change'],
    setup(props, {slots, attrs, emit, expose}) {
      const focus = vi.fn(), blur = vi.fn(() => emit('visible-change', false));
      ports.selects.push({props, slots, emit, focus, blur, instance: getCurrentInstance()}); expose({focus, blur});
      return () => h('div', {...attrs, 'data-select-port': ''}, [slots.prefix?.(), slots.label?.({label: 'Chosen'}), slots.default?.(), slots.footer?.({label: 'Footer'})]);
    }});
  const ElOption = defineComponent({props: ['value', 'label', 'disabled'], setup: (props) => () => h('span', {'data-option': props.value, 'aria-disabled': props.disabled}, props.label)});
  const ElColorPicker = defineComponent({inheritAttrs: false, props: {modelValue: String, size: String, teleported: {type: Boolean, default: true}}, emits: ['update:modelValue'], setup(props, {attrs, emit}) {
    ports.pickers.push({props, emit});return () => h('span', [h('button', {...attrs, type: 'button', 'data-color-picker-port': ''}, props.modelValue),
      h(Teleport, {to: document.body, disabled: !props.teleported}, h('span', {'data-color-menu-port': ''}, 'Color menu'))]);}});
  const ElTooltip = defineComponent({props: {content: String, trigger: [Array, String], showAfter: Number, hideAfter: Number, placement: String, popperClass: String, teleported: {type: Boolean, default: true}},
    setup: (props, {slots}) => {ports.tooltips.push({props});return () => h('div', {'data-tooltip-port': ''}, [slots.default?.(),
      h(Teleport, {to: document.body, disabled: !props.teleported}, h('span', {'data-tooltip-content-port': ''}, slots.content?.() ?? props.content))]);}});
  return {ElSelect, ElOption, ElColorPicker, ElTooltip};
});
import {createApp, defineComponent, h, KeepAlive, markRaw, nextTick, reactive, ref, Suspense, type App, type Component} from 'vue';
import {ElOption} from 'element-plus';
import UiSelect from '@/src/ui/components/UiSelect.vue';
import GlossaryLibrarySelect from '@/src/ui/components/GlossaryLibrarySelect.vue';
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue';
import TranslationLoadingPreview from '@/src/ui/components/TranslationLoadingPreview.vue';
import UiIcon from '@/src/ui/components/UiIcon.vue';
import FeatureEnableCard from '@/src/ui/components/FeatureEnableCard.vue';
import FieldHelp from '@/src/features/settings/ui/components/FieldHelp.vue';
import InterfaceSkinPreview from '@/src/features/settings/ui/components/InterfaceSkinPreview.vue';
import PopupLayoutPreview from '@/src/features/settings/ui/components/PopupLayoutPreview.vue';
import PopupLayoutPreviewItem from '@/src/features/settings/ui/components/PopupLayoutPreviewItem.vue';
import SettingsGroup from '@/src/features/settings/ui/components/SettingsGroup.vue';
import SettingsItem from '@/src/features/settings/ui/components/SettingsItem.vue';
import TranslationColorField from '@/src/features/settings/ui/components/TranslationColorField.vue';
import TranslationStylePreview from '@/src/features/settings/ui/components/TranslationStylePreview.vue';
import SentenceHighlightStyleSettings from '@/src/features/settings/ui/SentenceHighlightStyleSettings.vue';
import WritingStylePreview from '@/src/features/settings/ui/components/WritingStylePreview.vue';
import SegmentedControl from '@/src/features/settings/ui/components/SegmentedControl.vue';
import {usePopupLayoutReorder} from '@/src/features/settings/ui/usePopupLayoutReorder';
import {interfaceSkinOptions} from '@/src/core/config/interfaceAppearance';
import {translationLoadingStyleOptions, type TranslationLoadingStyle} from '@/src/core/config/translationLoadingStyle';
import brandPaths from '@/src/ui/assets/serviceBrandPaths.json';
import {writingPreviewParagraphs} from '@/src/core/config/writingPreview';
import {DEFAULT_SENTENCE_HIGHLIGHT_APPEARANCE} from '@/src/core/config/sentenceHighlight';

const apps = new Set<App>();
async function settle() {await nextTick(); await nextTick();}
async function mount(component: Component, initial: Record<string, any>, options: {slots?: Record<string, any>; listeners?: Record<string, any>; shadow?: boolean | 'closed'; keepAlive?: boolean} = {}) {
  const host = dom.document.createElement('div'); dom.document.body.append(host);
  const root = dom.document.createElement('div'); (options.shadow ? host.attachShadow({mode: options.shadow === 'closed' ? 'closed' : 'open'}) : host).append(root);
  const props = reactive(initial), visible = ref(true), instance = ref<any>();
  const app = createApp({setup: () => () => options.keepAlive
    ? h(KeepAlive, {}, () => visible.value ? h(component, {...props, ...options.listeners, ref: instance}, options.slots) : null)
    : h(component, {...props, ...options.listeners, ref: instance}, options.slots)});
  apps.add(app); app.component('ElOption', ElOption); app.mount(root); await settle();
  return {app, props, root, visible, instance, unmount: () => {app.unmount(); apps.delete(app);}};
}
function event(target: Element, type: string, fields: Record<string, unknown> = {}) {
  const value = new dom.window.Event(type, {bubbles: true, cancelable: true});
  // Vue 用 _vts 防止一个事件触发传播期间新安装的监听。linkedom 的同步事件
  // 与监听创建可能在同一毫秒，受控时钟让测试事件明确发生在已有监听之后。
  Object.assign(value, {_vts: Date.now() + 1}, fields); target.dispatchEvent(value); return value;
}
function key(target: Element, value: string) {return event(target, 'keydown', {key: value});}
const libraries = [{id: 'a', name: 'Alpha', entries: []}, {id: 'b', name: 'Beta', entries: []}];
const swatches = [{id: 'red', value: '#ff0000', labelKey: 'red'}, {id: 'blue', value: '#0000ff', labelKey: 'blue'}];
function skin(value = 'default') {return interfaceSkinOptions.find(item => item.value === value)!;}
function layoutProps() {return {skin: skin(), skinLabel: 'Default', editScope: 'popupModule', moduleItems: [
  {id: 'translation', label: 'Translate', visible: true}, {id: 'siteRule', label: 'Site', visible: true},
  {id: 'quickFeatures', label: 'Features', visible: true}, {id: 'footer', label: 'Footer', visible: true}],
  moduleOrder: ['translation', 'siteRule', 'quickFeatures', 'footer'], quickFeatureItems: [
    {id: 'hover', label: 'Hover', visible: true}, {id: 'image', label: 'Image', visible: true}], quickFeatureOrder: ['hover', 'image']};}
function colorProps() {return {modelValue: '', fieldId: 'color-a', label: 'Color', swatches: swatches.map(swatch => ({...swatch}))};}
function shareduiAuditSegmentProps() {return {modelValue: 'a' as string | number, label: 'Display', options: [
  {value: 'a' as string | number, label: 'Alpha', disabled: false}, {value: 'b' as string | number, label: 'Blocked', disabled: true}, {value: 3 as string | number, label: 'Three', disabled: false}]};}
beforeEach(() => {dom.document.body.replaceChildren(); dom.frames.clear(); ports.selects.length = 0; ports.pickers.length = 0; ports.tooltips.length = 0; ports.locale.value = ''; dom.window.innerWidth = 1000;});
afterEach(async () => {for (const app of apps) app.unmount(); apps.clear(); await settle(); dom.frames.clear(); vi.restoreAllMocks();});

describe('shared UI actual client SFC lifecycle', () => {
  it('loads all sixteen actual SFC client render functions without any server render replacement', () => {
    for (const component of [UiSelect, GlossaryLibrarySelect, ServiceIcon, TranslationLoadingPreview, UiIcon, FeatureEnableCard, FieldHelp,
      InterfaceSkinPreview, PopupLayoutPreview, PopupLayoutPreviewItem, SettingsGroup, SettingsItem, TranslationColorField, TranslationStylePreview, WritingStylePreview, SegmentedControl]) {
      expect((component as any).render).toBeTypeOf('function');expect((component as any).ssrRender).toBeUndefined();
    }
  });
  it('preserves segmented arrow, Home and End semantics, disabled-option skipping and string or number values', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    const update = vi.fn((value: string | number) => {mounted.props.modelValue = value;});
    mounted = await mount(SegmentedControl, shareduiAuditSegmentProps(), {listeners: {'onUpdate:modelValue': update}});
    const buttons = () => [...mounted.root.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(mounted.root.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Display');expect(buttons()[1].disabled).toBe(true);
    for (const [from, name, value] of [[0, 'ArrowRight', 3], [2, 'ArrowDown', 'a'], [0, 'ArrowLeft', 3], [2, 'ArrowUp', 'a'], [0, 'End', 3], [2, 'Home', 'a']] as const) {
      buttons()[from].focus();const pressed = key(buttons()[from], name);await settle();dom.flush();
      expect(pressed.defaultPrevented).toBe(true);expect(update).toHaveBeenLastCalledWith(value);expect(mounted.props.modelValue).toBe(value);
      expect(dom.document.activeElement!.textContent).toBe(value === 3 ? 'Three' : 'Alpha');
      expect(buttons().filter(button => button.getAttribute('tabindex') === '0')).toHaveLength(1);
    }
    update.mockClear();expect(key(buttons()[0], 'Tab').defaultPrevented).toBe(false);expect(update).not.toHaveBeenCalled();expect(dom.frames.size).toBe(0);
    mounted.props.disabled = true;await settle();expect(key(buttons()[0], 'ArrowRight').defaultPrevented).toBe(false);expect(update).not.toHaveBeenCalled();
    mounted.props.disabled = false;mounted.props.options.forEach((option: any) => {option.disabled = true;});await settle();
    expect(key(buttons()[0], 'End').defaultPrevented).toBe(false);expect(update).not.toHaveBeenCalled();expect(dom.frames.size).toBe(0);
    mounted.props.options = [];await settle();expect(buttons()).toHaveLength(0);
  });
  it('coalesces 100 segmented key events into one focus frame with identical emitted selection', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    const update = vi.fn((value: string | number) => {mounted.props.modelValue = value;});
    mounted = await mount(SegmentedControl, shareduiAuditSegmentProps(), {listeners: {'onUpdate:modelValue': update}});
    const origin = mounted.root.querySelector<HTMLButtonElement>('[role="radio"]')!;origin.focus();
    const focus = vi.spyOn(dom.window.HTMLElement.prototype, 'focus');
    const request = vi.spyOn(globalThis, 'requestAnimationFrame'), cancel = vi.spyOn(globalThis, 'cancelAnimationFrame');
    for (let index = 0; index < 100; index++) key(origin, 'ArrowRight');
    await settle();const pendingFrames = dom.frames.size;dom.flush();
    console.info(JSON.stringify({sharedUiOperationEvidence: 'segmented-keyboard', keydowns: 100, pendingFrames, focusCalls: focus.mock.calls.length,
      rafRequests: request.mock.calls.length, rafCancels: cancel.mock.calls.length, emittedSelections: update.mock.calls.length, output: mounted.props.modelValue}));
    expect(update).toHaveBeenCalledTimes(100);expect(update.mock.calls.every(([value]) => value === 3)).toBe(true);
    expect(pendingFrames).toBe(1);expect(focus).toHaveBeenCalledOnce();expect(dom.document.activeElement!.textContent).toBe('Three');expect(dom.frames.size).toBe(0);
  });
  it('releases segmented keyboard focus when a real parent disables then reenables the control', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    mounted = await mount(SegmentedControl, shareduiAuditSegmentProps(), {listeners: {'onUpdate:modelValue': (value: string | number) => {mounted.props.modelValue = value;}}});
    const origin = mounted.root.querySelector<HTMLButtonElement>('[role="radio"]')!;origin.focus();key(origin, 'ArrowRight');await settle();
    const focus = vi.spyOn(dom.window.HTMLElement.prototype, 'focus');mounted.props.disabled = true;await settle();expect(dom.frames.size).toBe(0);dom.flush();expect(focus).not.toHaveBeenCalled();
    mounted.props.disabled = false;await settle();key(origin, 'End');await settle();dom.flush();expect(focus).toHaveBeenCalledOnce();expect(mounted.props.modelValue).toBe(3);
  });
  it('releases segmented focus on unmount before the requested frame runs', async () => {
    const mounted = await mount(SegmentedControl, shareduiAuditSegmentProps());const origin = mounted.root.querySelector<HTMLButtonElement>('button')!;origin.focus();key(origin, 'End');
    expect(dom.frames.size).toBe(1);mounted.unmount();expect(dom.frames.size).toBe(0);
  });
  it('releases a segmented frame when the synchronous parent update unmounts the child', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    const update = vi.fn(() => {mounted.unmount();});
    mounted = await mount(SegmentedControl, shareduiAuditSegmentProps(), {listeners: {'onUpdate:modelValue': update}});
    const origin = mounted.root.querySelector<HTMLButtonElement>('button')!;origin.focus();key(origin, 'End');
    expect(update).toHaveBeenCalledOnce();expect(dom.frames.size).toBe(0);await settle();expect(mounted.root.childElementCount).toBe(0);
  });
  it('releases segmented focus on KeepAlive deactivation and supports fresh keyboard selection after reactivation', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    mounted = await mount(SegmentedControl, shareduiAuditSegmentProps(), {keepAlive: true, listeners: {'onUpdate:modelValue': (value: string | number) => {mounted.props.modelValue = value;}}});
    let origin = mounted.root.querySelector<HTMLButtonElement>('button')!;origin.focus();key(origin, 'End');await settle();
    mounted.visible.value = false;await settle();expect(dom.frames.size).toBe(0);
    mounted.visible.value = true;await settle();origin = mounted.root.querySelector<HTMLButtonElement>('button')!;origin.focus();key(origin, 'Home');await settle();dom.flush();
    expect(dom.document.activeElement).toBe(origin);expect(mounted.props.modelValue).toBe('a');
  });
  it('rejects segmented focus when a parent replaces the requested option at its captured index', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    mounted = await mount(SegmentedControl, shareduiAuditSegmentProps(), {listeners: {'onUpdate:modelValue': (value: string | number) => {mounted.props.modelValue = value;}}});
    const origin = mounted.root.querySelector<HTMLButtonElement>('button')!;origin.focus();key(origin, 'End');await settle();
    mounted.props.options = [{value: 'a', label: 'Alpha'}, {value: 'b', label: 'Blocked', disabled: true}, {value: 'new', label: 'Replacement'}];await settle();
    const focus = vi.spyOn(dom.window.HTMLElement.prototype, 'focus');dom.flush();expect(focus).not.toHaveBeenCalled();expect(dom.document.activeElement).toBe(origin);
  });
  it('finds the requested segmented value at its live index after an in-place option reorder', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    mounted = await mount(SegmentedControl, shareduiAuditSegmentProps(), {listeners: {'onUpdate:modelValue': (value: string | number) => {mounted.props.modelValue = value;}}});
    const origin = mounted.root.querySelector<HTMLButtonElement>('button')!;origin.focus();key(origin, 'End');await settle();
    mounted.props.options.reverse();await settle();dom.flush();expect(dom.document.activeElement!.textContent).toBe('Three');expect(mounted.props.modelValue).toBe(3);
  });
  it('rejects segmented focus after the requested option becomes disabled in place', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    mounted = await mount(SegmentedControl, shareduiAuditSegmentProps(), {listeners: {'onUpdate:modelValue': (value: string | number) => {mounted.props.modelValue = value;}}});
    const origin = mounted.root.querySelector<HTMLButtonElement>('button')!;origin.focus();key(origin, 'End');await settle();
    mounted.props.options[2].disabled = true;await settle();const focus = vi.spyOn(dom.window.HTMLElement.prototype, 'focus');dom.flush();expect(focus).not.toHaveBeenCalled();expect(dom.document.activeElement).toBe(origin);
  });
  it('rejects segmented focus when an external model update supersedes keyboard selection', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    mounted = await mount(SegmentedControl, shareduiAuditSegmentProps(), {listeners: {'onUpdate:modelValue': (value: string | number) => {mounted.props.modelValue = value;}}});
    const origin = mounted.root.querySelector<HTMLButtonElement>('button')!;origin.focus();key(origin, 'End');await settle();
    mounted.props.modelValue = 'a';await settle();const focus = vi.spyOn(dom.window.HTMLElement.prototype, 'focus');dom.flush();expect(focus).not.toHaveBeenCalled();expect(dom.document.activeElement).toBe(origin);
  });
  it.each([false, 'closed'] as const)('does not steal segmented focus after it leaves the owning group, shadow=%s', async shadow => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    mounted = await mount(SegmentedControl, shareduiAuditSegmentProps(), {shadow, listeners: {'onUpdate:modelValue': (value: string | number) => {mounted.props.modelValue = value;}}});
    const origin = mounted.root.querySelector<HTMLButtonElement>('button')!;origin.focus();key(origin, 'End');await settle();
    const outside = dom.document.createElement('button');outside.textContent = 'Outside';dom.document.body.append(outside);outside.focus();
    const focus = vi.spyOn(dom.window.HTMLElement.prototype, 'focus');dom.flush();expect(focus).not.toHaveBeenCalled();expect(dom.document.activeElement).toBe(outside);
    origin.focus();key(origin, 'End');await settle();dom.flush();expect(dom.document.activeElement!.textContent).toBe('Three');
  });
  it('cancels segmented keyboard intent on a subsequent click even when selection has the same value', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    const update = vi.fn((value: string | number) => {mounted.props.modelValue = value;});
    mounted = await mount(SegmentedControl, shareduiAuditSegmentProps(), {listeners: {'onUpdate:modelValue': update}});
    const buttons = mounted.root.querySelectorAll<HTMLButtonElement>('button');buttons[0].focus();key(buttons[0], 'End');await settle();event(buttons[2], 'click');
    expect(update).toHaveBeenCalledTimes(2);expect(update).toHaveBeenLastCalledWith(3);expect(dom.frames.size).toBe(0);
  });
  it('does not focus a removed segmented target node or a disconnected control', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    mounted = await mount(SegmentedControl, shareduiAuditSegmentProps(), {listeners: {'onUpdate:modelValue': (value: string | number) => {mounted.props.modelValue = value;}}});
    const origin = mounted.root.querySelector<HTMLButtonElement>('button')!;origin.focus();key(origin, 'End');await settle();mounted.root.querySelector('button[data-option-index="2"]')!.remove();
    const focus = vi.spyOn(dom.window.HTMLElement.prototype, 'focus');dom.flush();expect(focus).not.toHaveBeenCalled();
    key(origin, 'Home');await settle();mounted.root.remove();dom.flush();expect(focus).not.toHaveBeenCalled();expect(dom.frames.size).toBe(0);
  });
  it('forwards select attributes, events and scoped slots and exposes the real UI port focus methods', async () => {
    const changed = vi.fn(), visible = vi.fn();
    const mounted = await mount(UiSelect, {modelValue: 'a', filterable: true, popperClass: 'custom', 'aria-label': 'Choose', disabled: false},
      {listeners: {onChange: changed, onVisibleChange: visible}, slots: {default: () => h('b', 'Option'), footer: ({label}: any) => h('span', label)}});
    const port = ports.selects[0]; expect(port.props.popperClass).toContain('custom');expect(port.props.noMatchText).toBe('select.noMatch');
    expect(mounted.root.querySelector('[aria-label="Choose"]')).not.toBeNull();expect(mounted.root.textContent).toContain('Footer');
    expect(mounted.root.textContent).toContain('Chosen');port.emit('change', 'b');port.emit('visible-change', true);await settle();
    expect(changed).toHaveBeenCalledWith('b');expect(visible).toHaveBeenCalledWith(true);expect(mounted.root.textContent).toContain('select.search');
    mounted.instance.value.focus(); mounted.instance.value.blur(); expect(port.focus).toHaveBeenCalledOnce();expect(port.blur).toHaveBeenCalledOnce();
    mounted.props.disabled = true;mounted.props.multiple = true;mounted.props.filterable = false;await settle();
    expect(port.props.disabled).toBe(true);expect(port.props.multiple).toBe(true);expect(port.props.popperClass).not.toContain('--searchable');
    expect(mounted.root.querySelector('.fluentread-select-search-icon')).toBeNull();
  });
  it('keeps caller prefix and label slots while closed, switches the search prefix only while open', async () => {
    const mounted = await mount(UiSelect, {filterable: true, showSearchIcon: false, wrapLabel: false},
      {slots: {prefix: () => h('b', {'data-prefix': ''}, 'Prefix'), label: () => h('i', 'Custom label')}});
    expect(mounted.root.querySelector('[data-prefix]')).not.toBeNull();ports.selects[0].emit('visible-change', true);await settle();
    expect(mounted.root.querySelector('.fluentread-select-search-icon')).toBeNull();expect(mounted.root.textContent).toContain('Custom label');
    mounted.props.showSearchIcon = true;await settle();expect(mounted.root.querySelector('.fluentread-select-search-icon')).not.toBeNull();
    expect(mounted.root.querySelector('[data-prefix]')).toBeNull();ports.selects[0].emit('visible-change', false);await settle();expect(mounted.root.querySelector('[data-prefix]')).not.toBeNull();
  });
  it('adds zero viewport listeners for 100 ordinary selects and releases every mounted app', async () => {
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener');
    let output = '';
    for (let index = 0; index < 100; index++) {const mounted = await mount(UiSelect, {});if (index === 0) output = mounted.root.innerHTML;else expect(mounted.root.innerHTML).toBe(output);mounted.unmount();}
    console.info(JSON.stringify({sharedUiOperationEvidence: 'ordinary-selects', mounts: 100, unmounts: 100, output,
      resizeAdds: add.mock.calls.filter(([name]) => name === 'resize').length, resizeRemoves: remove.mock.calls.filter(([name]) => name === 'resize').length}));
    expect(add.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(0);
    expect(remove.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(0);
  });
  it('keeps shadow menus local, changes narrow placement, suspends cache listeners and closes on deactivation', async () => {
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener');
    const mounted = await mount(UiSelect, {filterable: true}, {shadow: true, keepAlive: true});
    const port = ports.selects[0];expect(port.props.teleported).toBe(false);expect(port.props.placement).toBe('bottom-start');
    dom.window.innerWidth = 600;window.dispatchEvent(new dom.window.Event('resize'));await settle();expect(port.props.placement).toBe('top-start');
    expect(port.props.fallbackPlacements).toEqual(['bottom-start', 'top-start', 'right', 'left']);
    port.emit('visible-change', true);await settle();mounted.visible.value = false;await settle();
    expect(port.blur).toHaveBeenCalledOnce();expect(add.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(1);
    expect(remove.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(1);
    mounted.visible.value = true;await settle();expect(add.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(2);
    mounted.unmount();expect(remove.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(2);
  });
  it('rejects late disabled mode and checkbox events and preserves the controlled selection', async () => {
    const update = vi.fn();const mounted = await mount(GlossaryLibrarySelect, {modelValue: ['a'], libraries, enabled: true}, {listeners: {'onUpdate:modelValue': update}});
    const checkbox = mounted.root.querySelector('input')!;mounted.props.disabled = true;await settle();
    (checkbox as HTMLInputElement).checked = false;ports.selects[0].emit('change', 'none');event(checkbox, 'change');await settle();expect(update).not.toHaveBeenCalled();
    expect(mounted.root.querySelector('fieldset')!.hasAttribute('disabled')).toBe(true);
  });
  it('rejects stale library toggles after mode or library props change', async () => {
    const update = vi.fn();const mounted = await mount(GlossaryLibrarySelect, {modelValue: ['a'], libraries, enabled: true}, {listeners: {'onUpdate:modelValue': update}});
    const checkbox = mounted.root.querySelector('input')!;(checkbox as HTMLInputElement).checked = true;
    mounted.props.libraries = [libraries[1]];await settle();event(checkbox, 'change');expect(update).not.toHaveBeenCalled();
    mounted.props.modelValue = null;await settle();event(checkbox, 'change');expect(update).not.toHaveBeenCalled();
    ports.selects[0].emit('change', 'unexpected');expect(update).not.toHaveBeenCalled();
    mounted.props.libraries = [];await settle();ports.selects[0].emit('change', 'selected');expect(update).not.toHaveBeenCalled();
  });
  it('does not reset libraries on repeated selected mode or repeat identical checkbox writes', async () => {
    const update = vi.fn();const mounted = await mount(GlossaryLibrarySelect, {modelValue: ['a', 'b'], libraries, enabled: true}, {listeners: {'onUpdate:modelValue': update}});
    ports.selects[0].emit('change', 'selected');const checkbox = mounted.root.querySelector('input')!;(checkbox as HTMLInputElement).checked = true;event(checkbox, 'change');
    expect(update).not.toHaveBeenCalled();(checkbox as HTMLInputElement).checked = false;event(checkbox, 'change');expect(update).toHaveBeenLastCalledWith(['b']);
  });
  it('implements inherit, none and explicit-library transitions and prioritized state hints', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    const update = vi.fn(value => {mounted.props.modelValue = value;});
    mounted = await mount(GlossaryLibrarySelect, {modelValue: undefined, libraries, enabled: false, unsupported: true}, {listeners: {'onUpdate:modelValue': update}});
    expect(mounted.root.textContent).toContain('glossary.disabledHint');ports.selects[0].emit('change', 'selected');await settle();expect(update).toHaveBeenLastCalledWith(['a']);
    const second = mounted.root.querySelectorAll('input')[1] as HTMLInputElement;second.checked = true;event(second, 'change');await settle();expect(update).toHaveBeenLastCalledWith(['a', 'b']);
    mounted.props.enabled = true;await settle();expect(mounted.root.textContent).toContain('glossary.unsupportedHint');mounted.props.unsupported = false;await settle();expect(mounted.root.textContent).toContain('glossary.scopeHint');
    ports.selects[0].emit('change', 'none');await settle();expect(update).toHaveBeenLastCalledWith([]);ports.selects[0].emit('change', 'inherit');await settle();expect(update).toHaveBeenLastCalledWith(null);
    mounted.props.showCopy = false;await settle();expect(mounted.root.querySelector('small')).toBeNull();expect(mounted.root.querySelector('.glossary-select-label')).toBeNull();
  });
  it('uses the same guarded behavior for a consumer supplied glossary mode-control slot', async () => {
    const update = vi.fn();const mounted = await mount(GlossaryLibrarySelect, {modelValue: [], libraries, enabled: true}, {listeners: {'onUpdate:modelValue': update},
      slots: {'mode-control': ({changeMode}: any) => h('button', {onClick: () => changeMode('selected')}, 'Select')}});
    event(mounted.root.querySelector('button')!, 'click');expect(update).toHaveBeenLastCalledWith(['a']);mounted.props.disabled = true;await settle();update.mockClear();event(mounted.root.querySelector('button')!, 'click');expect(update).not.toHaveBeenCalled();
  });
  it('normalizes named, RGB, hex and picker colors, leaves invalid drafts visible and resets errors on props', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;const update = vi.fn(value => {mounted.props.modelValue = value;});
    mounted = await mount(TranslationColorField, colorProps(), {listeners: {'onUpdate:modelValue': update}});
    const input = mounted.root.querySelector('input')!;
    for (const [draft, expected] of [['red', '#ff0000'], ['rgb(0, 0, 255)', '#0000ff'], ['#123', '#112233']]) {
      (input as HTMLInputElement).value = draft;event(input, 'input');key(input, 'Enter');await settle();expect(update).toHaveBeenLastCalledWith(expected);
    }
    (input as HTMLInputElement).value = 'not-a-color';event(input, 'input');event(input, 'blur');await settle();expect(input.getAttribute('aria-invalid')).toBe('true');expect(mounted.root.querySelector('[role="alert"]')).not.toBeNull();
    mounted.props.modelValue = '#333333';await settle();expect(input.getAttribute('aria-invalid')).toBe('false');expect((input as HTMLInputElement).value).toBe('#333333');
    ports.pickers[0].emit('update:modelValue', '#abcdef');await settle();expect(update).toHaveBeenLastCalledWith('#abcdef');
    ports.pickers[0].emit('update:modelValue', null);await settle();expect(update).toHaveBeenLastCalledWith('');
    ports.pickers[0].emit('update:modelValue', undefined);await settle();expect(update).toHaveBeenLastCalledWith('');
  });
  it('supports radio arrows, Home, End and wraparound with one live focus frame', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;const update = vi.fn((value: string) => {mounted.props.modelValue = value;});
    mounted = await mount(TranslationColorField, colorProps(), {listeners: {'onUpdate:modelValue': update}});
    const radios = () => [...mounted.root.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    event(radios()[1], 'click');await settle();expect(mounted.props.modelValue).toBe('#ff0000');event(radios()[0], 'click');await settle();expect(mounted.props.modelValue).toBe('');
    update.mockClear();
    for (const [from, keyName, expected] of [[0, 'ArrowRight', '#ff0000'], [1, 'ArrowDown', '#0000ff'], [2, 'ArrowUp', '#ff0000'], [1, 'ArrowLeft', ''], [0, 'End', '#0000ff'], [2, 'Home', ''], [0, 'ArrowLeft', '#0000ff'] ] as const) {
      radios()[from].focus();const pressed = key(radios()[from], keyName);await settle();dom.flush();
      expect(pressed.defaultPrevented).toBe(true);expect(mounted.props.modelValue).toBe(expected);expect(update).toHaveBeenLastCalledWith(expected);
      expect(dom.document.activeElement?.getAttribute('data-color')).toBe(expected || null);expect(radios().filter(radio => radio.getAttribute('tabindex') === '0')).toHaveLength(1);
    }
    expect(update).toHaveBeenCalledTimes(7);update.mockClear();
    const ignored = key(radios()[0], 'Tab');expect(ignored.defaultPrevented).toBe(false);
    expect(update).not.toHaveBeenCalled();radios()[0].focus();
    for (let index = 0; index < 100; index++) key(radios()[0], 'ArrowRight');
    await settle();console.info(JSON.stringify({sharedUiOperationEvidence: 'color-keyboard', keydowns: 100, pendingFrames: dom.frames.size, output: mounted.props.modelValue, emittedSelections: update.mock.calls.length}));
    expect(update).toHaveBeenCalledTimes(100);expect(update.mock.calls.every(([value]) => value === '#ff0000')).toBe(true);
    expect(dom.frames.size).toBe(1);mounted.unmount();expect(dom.frames.size).toBe(0);
  });
  it.each([[false, 'input'], [false, 'picker'], [false, 'outside'], ['closed', 'input'], ['closed', 'picker'], ['closed', 'outside']] as const)(
    'does not steal color focus after it leaves the owning group, shadow=%s destination=%s', async (shadow, departure) => {
      let mounted: Awaited<ReturnType<typeof mount>>;const update = vi.fn((value: string) => {mounted.props.modelValue = value;});
      mounted = await mount(TranslationColorField, colorProps(), {shadow, listeners: {'onUpdate:modelValue': update}});
      const origin = mounted.root.querySelector<HTMLButtonElement>('[role="radio"]')!;origin.focus();key(origin, 'ArrowRight');await settle();
      expect(update).toHaveBeenCalledOnce();expect(mounted.props.modelValue).toBe('#ff0000');expect(dom.frames.size).toBe(1);
      let destination: HTMLElement;
      if (departure === 'input') destination = mounted.root.querySelector<HTMLInputElement>('input')!;
      else if (departure === 'picker') destination = mounted.root.querySelector<HTMLButtonElement>('[data-color-picker-port]')!;
      else {destination = dom.document.createElement('button');destination.textContent = 'Outside';dom.document.body.append(destination);}
      destination.focus();const focus = vi.spyOn(dom.window.HTMLElement.prototype, 'focus');dom.flush();
      expect(focus).not.toHaveBeenCalled();expect(dom.document.activeElement).toBe(destination);expect(dom.frames.size).toBe(0);expect(update).toHaveBeenCalledOnce();
      origin.focus();key(origin, 'End');await settle();dom.flush();
      expect(update).toHaveBeenCalledTimes(2);expect(update).toHaveBeenLastCalledWith('#0000ff');
      const focusRoot = origin.getRootNode() as Document | ShadowRoot;expect(focusRoot.activeElement?.getAttribute('data-color')).toBe('#0000ff');
    });
  it('releases a color frame when the synchronous parent update unmounts the child', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;let registeredBeforeUpdate = 0;
    const update = vi.fn(() => {registeredBeforeUpdate = dom.frames.size;mounted.unmount();});
    mounted = await mount(TranslationColorField, colorProps(), {listeners: {'onUpdate:modelValue': update}});
    const origin = mounted.root.querySelector<HTMLButtonElement>('[role="radio"]')!;origin.focus();key(origin, 'End');
    console.info(JSON.stringify({sharedUiOperationEvidence: 'color-synchronous-parent-unmount', registeredBeforeUpdate, pendingFramesAfterUnmount: dom.frames.size, emittedSelections: update.mock.calls.length}));
    expect(update).toHaveBeenCalledOnce();expect(registeredBeforeUpdate).toBe(1);expect(dom.frames.size).toBe(0);
    const focus = vi.spyOn(dom.window.HTMLElement.prototype, 'focus');await settle();dom.flush();expect(focus).not.toHaveBeenCalled();expect(mounted.root.childElementCount).toBe(0);
  });
  it('cancels pending color focus on swatch replacement and cache deactivation and rejects obsolete external color focus', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;mounted = await mount(TranslationColorField, colorProps(), {keepAlive: true, listeners: {'onUpdate:modelValue': (value: string) => {mounted.props.modelValue = value;}}});
    const radio = () => mounted.root.querySelector<HTMLButtonElement>('[role="radio"]')!;
    radio().focus();key(radio(), 'End');await settle();mounted.props.swatches = [swatches[0]];await settle();expect(dom.frames.size).toBe(0);
    radio().focus();key(radio(), 'End');await settle();mounted.visible.value = false;await settle();expect(dom.frames.size).toBe(0);mounted.visible.value = true;await settle();
    radio().focus();const focus = vi.spyOn(dom.window.HTMLElement.prototype, 'focus');key(radio(), 'End');await settle();mounted.props.modelValue = '#abcdef';await settle();dom.flush();expect(focus).not.toHaveBeenCalled();
    radio().focus();focus.mockClear();key(radio(), 'End');await settle();dom.flush();expect(focus).toHaveBeenCalledOnce();expect(mounted.props.modelValue).toBe('#ff0000');expect(dom.document.activeElement?.getAttribute('data-color')).toBe('#ff0000');
  });
  it('does not restore obsolete keyboard focus after an external model update', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;mounted = await mount(TranslationColorField, colorProps(), {listeners: {'onUpdate:modelValue': (value: string) => {mounted.props.modelValue = value;}}});
    const origin = mounted.root.querySelector<HTMLButtonElement>('[role="radio"]')!;origin.focus();
    const focus = vi.spyOn(dom.window.HTMLElement.prototype, 'focus');key(origin, 'End');await settle();mounted.props.modelValue = '#abcdef';await settle();dom.flush();expect(focus).not.toHaveBeenCalled();
  });
  it('releases a color keyboard frame on unmount before the browser executes it', async () => {
    const mounted = await mount(TranslationColorField, colorProps());const origin = mounted.root.querySelector<HTMLButtonElement>('[role="radio"]')!;origin.focus();key(origin, 'End');expect(dom.frames.size).toBe(1);mounted.unmount();expect(dom.frames.size).toBe(0);
  });
  it('releases a color keyboard frame while a component stays cached and inactive', async () => {
    const mounted = await mount(TranslationColorField, colorProps(), {keepAlive: true});const origin = mounted.root.querySelector<HTMLButtonElement>('[role="radio"]')!;origin.focus();key(origin, 'End');expect(dom.frames.size).toBe(1);mounted.visible.value = false;await settle();expect(dom.frames.size).toBe(0);
  });
  it('keeps custom color and empty palette accessible with one radio tab stop', async () => {
    const mounted = await mount(TranslationColorField, {...colorProps(), modelValue: '#abcdef', hint: 'Hint'});
    expect(mounted.root.querySelector('.translation-color-custom.selected')).not.toBeNull();expect(mounted.root.querySelector('[tabindex="0"]')!.getAttribute('data-choice-index')).toBe('0');
    mounted.props.swatches = [];await settle();const origin = mounted.root.querySelector<HTMLButtonElement>('[role="radio"]')!;origin.focus();key(origin, 'End');await settle();dom.flush();expect(mounted.root.querySelectorAll('[role="radio"]')).toHaveLength(1);
  });
  it('cancels prior keyboard focus after a same-color click, picker update or in-place palette reorder', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;mounted = await mount(TranslationColorField, colorProps(), {listeners: {'onUpdate:modelValue': (value: string) => {mounted.props.modelValue = value;}}});
    const radios = () => [...mounted.root.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    radios()[0].focus();key(radios()[0], 'ArrowRight');await settle();event(radios()[1], 'click');expect(dom.frames.size).toBe(0);
    radios()[0].focus();key(radios()[0], 'ArrowRight');await settle();ports.pickers[0].emit('update:modelValue', '#ff0000');expect(dom.frames.size).toBe(0);
    radios()[0].focus();key(radios()[0], 'ArrowRight');await settle();mounted.props.swatches.reverse();await settle();expect(dom.frames.size).toBe(0);
  });
  it('keeps help Teleports inside a closed shadow root and preserves body teleport on extension pages', async () => {
    const help = await mount(FieldHelp, {content: 'Help'}, {shadow: 'closed'});
    expect(ports.tooltips[0].props.teleported).toBe(false);expect(help.root.querySelector('[data-tooltip-content-port]')).not.toBeNull();expect(dom.document.body.querySelector('[data-tooltip-content-port]')).toBeNull();help.unmount();
    const pageHelp = await mount(FieldHelp, {content: 'Page help'});expect(ports.tooltips[1].props.teleported).toBe(true);expect(pageHelp.root.querySelector('[data-tooltip-content-port]')).toBeNull();expect(dom.document.body.querySelector('[data-tooltip-content-port]')).not.toBeNull();
    pageHelp.unmount();expect(dom.document.body.querySelector('[data-tooltip-content-port]')).toBeNull();
  });
  it('keeps color menu Teleports inside a closed shadow root and preserves body teleport on extension pages', async () => {
    const color = await mount(TranslationColorField, colorProps(), {shadow: 'closed'});
    expect(ports.pickers[0].props.teleported).toBe(false);expect(color.root.querySelector('[data-color-menu-port]')).not.toBeNull();expect(dom.document.body.querySelector('[data-color-menu-port]')).toBeNull();color.unmount();
    const pageColor = await mount(TranslationColorField, colorProps());expect(ports.pickers[1].props.teleported).toBe(true);expect(pageColor.root.querySelector('[data-color-menu-port]')).toBeNull();expect(dom.document.body.querySelector('[data-color-menu-port]')).not.toBeNull();
    pageColor.unmount();expect(dom.document.body.querySelector('[data-color-menu-port]')).toBeNull();
  });
  it('forwards settings copy clicks only to enabled controls and respects selection and child interactive elements', async () => {
    const toggle = vi.fn();const mounted = await mount(SettingsItem, {label: 'Toggle', description: 'Details'}, {slots: {default: () => h('button', {class: 'el-switch', onClick: toggle}, 'Switch'), copy: () => h('div', [h('strong', 'Copy'), h('a', {href: '#'}, 'Link')])}});
    event(mounted.root.querySelector('strong')!, 'click');expect(toggle).toHaveBeenCalledOnce();mounted.props.disabled = true;await settle();event(mounted.root.querySelector('strong')!, 'click');expect(toggle).toHaveBeenCalledOnce();
    mounted.props.disabled = false;await settle();event(mounted.root.querySelector('a')!, 'click');expect(toggle).toHaveBeenCalledOnce();
    vi.spyOn(window, 'getSelection').mockReturnValue({toString: () => 'selected'} as Selection);event(mounted.root.querySelector('strong')!, 'click');expect(toggle).toHaveBeenCalledOnce();
  });
  it('handles settings rows without a switch, disabled switches, stacked controls and custom copy', async () => {
    const mounted = await mount(SettingsItem, {label: 'Label', stacked: true}, {slots: {default: () => h('button', {class: 'el-switch is-disabled'}, 'Disabled')}});
    event(mounted.root.querySelector('strong')!, 'click');expect(mounted.root.querySelector('.settings-item.stacked')).not.toBeNull();
    mounted.unmount();const plain = await mount(SettingsItem, {label: 'Plain', description: 'Description'});event(plain.root.querySelector('strong')!, 'click');expect(plain.root.textContent).toContain('Description');
  });
  it('does not let a late leave from an old preview item clear a different insertion target', async () => {
    const controller = usePopupLayoutReorder({order: () => ['a', 'b'], visibleIds: () => ['a', 'b'], onUpdate: vi.fn()});
    const mounted = await mount(PopupLayoutPreviewItem, {item: {id: 'a', label: 'Alpha'}, editable: true, controller: markRaw(controller)});
    controller.dropTarget.value = 'b';event(mounted.root.firstElementChild!, 'dragleave');expect(controller.dropTarget.value).toBe('b');
    controller.dropTarget.value = 'a';event(mounted.root.firstElementChild!, 'dragleave');expect(controller.dropTarget.value).toBeNull();
  });
  it('guards disabled preview drag ports and excludes action buttons from dragstart', async () => {
    const controller = {draggedItem: ref(null), dropTarget: ref(null), dropPosition: ref('before'), start: vi.fn(), over: vi.fn(), drop: vi.fn(), finish: vi.fn(), move: vi.fn()};
    const mounted = await mount(PopupLayoutPreviewItem, {item: {id: 'a', label: 'Alpha'}, editable: false, controller: markRaw(controller)}, {slots: {default: () => h('button', {'data-preview-action': ''}, 'Action')}});
    const node = mounted.root.firstElementChild!;for (const name of ['dragstart', 'dragover', 'drop', 'dragend']) event(node, name);
    expect(controller.start).not.toHaveBeenCalled();expect(controller.over).not.toHaveBeenCalled();expect(controller.drop).not.toHaveBeenCalled();expect(controller.finish).not.toHaveBeenCalled();
    mounted.props.editable = true;await settle();const blocked = event(node.querySelector('[data-preview-action]')!, 'dragstart');expect(blocked.defaultPrevented).toBe(true);expect(controller.start).not.toHaveBeenCalled();
    event(node, 'dragstart');event(node, 'dragover');event(node, 'drop');event(node, 'dragend');expect(controller.start).toHaveBeenCalled();expect(controller.over).toHaveBeenCalled();expect(controller.drop).toHaveBeenCalled();expect(controller.finish).toHaveBeenCalled();
    const handle = node.querySelector('button.layout-preview-drag-handle')!;key(handle, 'ArrowUp');key(handle, 'ArrowDown');key(handle, 'ArrowLeft');key(handle, 'ArrowRight');expect(controller.move).toHaveBeenCalledTimes(2);
    mounted.props.axis = 'x';await settle();key(handle, 'ArrowLeft');key(handle, 'ArrowRight');expect(controller.move).toHaveBeenCalledTimes(4);key(handle, 'Escape');expect(controller.finish).toHaveBeenCalledTimes(2);
  });
  it('reorders real popup modules and features by keyboard and announces the resulting visible position', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;const moduleUpdate = vi.fn(order => {mounted.props.moduleOrder = order;});const featureUpdate = vi.fn(order => {mounted.props.quickFeatureOrder = order;});const edit = vi.fn();
    mounted = await mount(PopupLayoutPreview, layoutProps(), {listeners: {'onUpdate:moduleOrder': moduleUpdate, 'onUpdate:quickFeatureOrder': featureUpdate, 'onEdit:scope': edit}});
    key(mounted.root.querySelector('[data-preview-popup-module="translation"] > button')!, 'ArrowDown');await settle();expect(moduleUpdate).toHaveBeenLastCalledWith(['siteRule', 'translation', 'quickFeatures', 'footer']);
    expect(mounted.root.querySelector('[aria-live="polite"]')!.textContent).toContain('"position":2');
    event(mounted.root.querySelector('[data-preview-action]')!, 'click');expect(edit).toHaveBeenCalledWith('quickFeature');mounted.props.editScope = 'quickFeature';await settle();
    key(mounted.root.querySelector('[data-preview-quick-feature="hover"] > button')!, 'ArrowRight');await settle();expect(featureUpdate).toHaveBeenLastCalledWith(['image', 'hover']);
    mounted.props.quickFeatureItems = mounted.props.quickFeatureItems.map((item: any) => ({...item, visible: false}));await settle();expect(mounted.root.querySelector('[data-preview-popup-module="quickFeatures"]')).toBeNull();
  });
  it('announces the module ID when the real parent synchronously removes the moved module in place', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    const update = vi.fn((order: string[]) => {
      mounted.props.moduleOrder = order;
      mounted.props.moduleItems.splice(mounted.props.moduleItems.findIndex((item: any) => item.id === 'translation'), 1);
    });
    mounted = await mount(PopupLayoutPreview, layoutProps(), {listeners: {'onUpdate:moduleOrder': update}});
    const items = mounted.props.moduleItems;
    key(mounted.root.querySelector('[data-preview-popup-module="translation"] > button')!, 'ArrowDown');await settle();
    expect(update).toHaveBeenCalledOnce();expect(update).toHaveBeenLastCalledWith(['siteRule', 'translation', 'quickFeatures', 'footer']);
    expect(mounted.props.moduleItems).toBe(items);expect(items.some((item: any) => item.id === 'translation')).toBe(false);
    expect(mounted.root.querySelector('[data-preview-popup-module="translation"]')).toBeNull();
    expect(mounted.root.querySelector('[aria-live="polite"]')!.textContent).toBe('settings.interface.popupLayout.moved{"label":"translation","position":0}');
  });
  it('announces the feature ID when the real parent synchronously removes the moved feature in place', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;
    const update = vi.fn((order: string[]) => {
      mounted.props.quickFeatureOrder = order;
      mounted.props.quickFeatureItems.splice(mounted.props.quickFeatureItems.findIndex((item: any) => item.id === 'hover'), 1);
    });
    mounted = await mount(PopupLayoutPreview, {...layoutProps(), editScope: 'quickFeature'}, {listeners: {'onUpdate:quickFeatureOrder': update}});
    const items = mounted.props.quickFeatureItems;
    key(mounted.root.querySelector('[data-preview-quick-feature="hover"] > button')!, 'ArrowRight');await settle();
    expect(update).toHaveBeenCalledOnce();expect(update).toHaveBeenLastCalledWith(['image', 'hover']);expect(mounted.props.quickFeatureItems).toBe(items);
    expect(mounted.root.querySelector('[data-preview-quick-feature="hover"]')).toBeNull();
    expect(mounted.root.querySelector('[data-preview-quick-feature="image"]')).not.toBeNull();
    expect(mounted.root.querySelector('[aria-live="polite"]')!.textContent).toBe('settings.interface.popupLayout.moved{"label":"hover","position":0}');
  });
  it('projects hidden, missing-order and nested modules without mutating input arrays across skins', async () => {
    const initial = layoutProps();initial.moduleOrder = ['unknown', 'translation'];initial.quickFeatureItems.push({id: 'unknown', label: 'Unknown', visible: true});
    const mounted = await mount(PopupLayoutPreview, initial);expect(mounted.root.querySelector('[data-preview-popup-module="translation"] [data-preview-popup-module="siteRule"]')).not.toBeNull();expect(mounted.props.moduleOrder).toEqual(['unknown', 'translation']);
    for (const value of ['default', 'emoji', 'ocean', 'minimal', 'compact', 'contrast']) {
      const chosen = skin(value);if (!chosen) continue;mounted.props.skin = chosen;await settle();expect(mounted.root.querySelector('section')!.getAttribute('data-preview-skin')).toBe(value);
    }
    mounted.props.moduleItems = initial.moduleItems.map(item => ({...item, visible: item.id !== 'translation'}));await settle();expect(mounted.root.querySelector('[data-preview-popup-module="translation"] [data-preview-popup-module="siteRule"]')).toBeNull();
  });
  it('uses the actual drag controller with nested stop propagation, drop coordinates and scoped cleanup', async () => {
    let mounted: Awaited<ReturnType<typeof mount>>;const update = vi.fn(order => {mounted.props.moduleOrder = order;});
    mounted = await mount(PopupLayoutPreview, layoutProps(), {listeners: {'onUpdate:moduleOrder': update}});
    const footer = mounted.root.querySelector('[data-preview-popup-module="footer"]')!;
    const nested = mounted.root.querySelector('[data-preview-popup-module="siteRule"]')!;
    const dataTransfer = {setData: vi.fn(), effectAllowed: '', dropEffect: ''};
    event(footer, 'dragstart', {dataTransfer});expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'footer');
    event(nested, 'dragover', {dataTransfer, clientY: 0});await settle();expect(nested.classList.contains('insert-before')).toBe(true);
    event(nested, 'drop', {dataTransfer, clientY: 0});await settle();expect(update).toHaveBeenCalledOnce();expect(update).toHaveBeenLastCalledWith(['translation', 'footer', 'siteRule', 'quickFeatures']);
    expect(mounted.root.querySelector('.is-dragging')).toBeNull();event(footer, 'dragstart', {dataTransfer});await settle();mounted.props.editScope = 'quickFeature';await settle();expect(mounted.root.querySelector('.is-dragging')).toBeNull();
  });
  it('recreates the actual isolated loading indicator for styles and motion props and removes it on unmount', async () => {
    const mounted = await mount(TranslationLoadingPreview, {loadingStyle: 'minimal', animated: true});let prior = mounted.root.querySelector('.fluent-read-loading')!;
    expect(prior.shadowRoot).toBeNull();expect(prior.getAttribute('translate')).toBe('no');
    for (const option of translationLoadingStyleOptions) {
      mounted.props.loadingStyle = option.value;mounted.props.animated = false;await settle();const current = mounted.root.querySelector('.fluent-read-loading')!;
      expect(current.getAttribute('data-fr-loading-style')).toBe(option.value);expect(current.getAttribute('data-fr-motion')).toBe('static');
      if (current !== prior) expect(prior.isConnected).toBe(false);expect(mounted.root.querySelector('.translation-loading-preview-runtime')!.childElementCount).toBe(1);prior = current;
    }
    mounted.unmount();expect(prior.isConnected).toBe(false);
  });
  it('renders the latest early loading props after a real pending Suspense boundary resolves', async () => {
    let resolveGate!: () => void;
    const gate = new Promise<void>(resolve => {resolveGate = resolve;});
    const props = reactive<{loadingStyle: TranslationLoadingStyle; animated: boolean}>({loadingStyle: 'minimal', animated: true});
    const AsyncGate = defineComponent({async setup() {await gate;return () => h('span', {'data-async-gate': ''});}});
    const Parent = defineComponent({setup: () => () => h(Suspense, {}, {
      default: () => h('div', [h(TranslationLoadingPreview, props), h(AsyncGate)]),
      fallback: () => h('p', {'data-loading-fallback': ''}, 'Pending'),
    })});
    const mounted = await mount(Parent, {});
    const fallback = mounted.root.querySelector('[data-loading-fallback]')!;
    expect(fallback).not.toBeNull();
    expect(mounted.root.querySelector('.fluent-read-loading')).toBeNull();
    // 待决 Suspense 暂存模板 ref/mounted 回调；真实 props watcher 仍先于它们执行。
    props.loadingStyle = 'dots';props.animated = false;await settle();
    expect(mounted.root.querySelector('.fluent-read-loading')).toBeNull();
    resolveGate();await gate;await settle();
    const indicator = mounted.root.querySelector('.fluent-read-loading')!;
    expect(indicator.getAttribute('data-fr-loading-style')).toBe('dots');expect(indicator.getAttribute('data-fr-motion')).toBe('static');
    expect(fallback.isConnected).toBe(false);
    expect(indicator.parentElement!.className).toBe('translation-loading-preview-runtime');expect(indicator.parentElement!.childElementCount).toBe(1);
    mounted.unmount();expect(indicator.isConnected).toBe(false);
  });
  it('cancels pending loading mount effects when unmounted before Suspense resolution', async () => {
    let resolveGate!: () => void;
    const gate = new Promise<void>(resolve => {resolveGate = resolve;});
    const props = reactive<{loadingStyle: TranslationLoadingStyle; animated: boolean}>({loadingStyle: 'minimal', animated: true});
    const AsyncGate = defineComponent({async setup() {await gate;return () => h('span', {'data-async-gate': ''});}});
    const Parent = defineComponent({setup: () => () => h(Suspense, {}, {
      default: () => h('div', [h(TranslationLoadingPreview, props), h(AsyncGate)]),
      fallback: () => h('p', 'Pending'),
    })});
    const mounted = await mount(Parent, {});
    props.loadingStyle = 'dots';props.animated = false;await settle();
    mounted.unmount();props.loadingStyle = 'ring';resolveGate();await gate;await settle();
    expect(mounted.root.childElementCount).toBe(0);expect(dom.document.querySelector('.fluent-read-loading')).toBeNull();
    expect(dom.document.querySelector('[data-async-gate]')).toBeNull();
  });
  it('does not recreate a loading indicator after an immediate unmount with a queued parent props update', async () => {
    const mounted = await mount(TranslationLoadingPreview, {loadingStyle: 'minimal', animated: true});
    const container = mounted.root.querySelector('.translation-loading-preview-runtime')!;
    const indicator = container.firstElementChild!;
    mounted.props.loadingStyle = 'dots';mounted.props.animated = false;mounted.unmount();await settle();
    expect(container.childElementCount).toBe(0);expect(indicator.isConnected).toBe(false);expect(mounted.root.childElementCount).toBe(0);
  });
  it('keeps preview sentence focus, pointer pairing, block order and dynamic appearance within the preview', async () => {
    const outside = dom.document.createElement('p');outside.textContent = 'Original host text';dom.document.body.append(outside);const update = vi.fn();
    const mounted = await mount(TranslationStylePreview, {styleClass: 'sample-style', appearanceStyle: {color: '#ff0000'}, highlightEnabled: true, initialSentence: 1,
      translationBeforeOriginal: false, pageTheme: 'light', caption: 'Caption', customized: false}, {listeners: {'onUpdate:pageTheme': update}});
    expect(mounted.root.querySelectorAll('.is-sentence-highlighted')).toHaveLength(2);
    const source = mounted.root.querySelector('[data-testid="bilingual-highlight-preview-source"] > span')!;event(source, 'pointerenter');await settle();expect(mounted.root.querySelectorAll('.is-sentence-highlighted')).toHaveLength(2);
    event(source, 'focus');await settle();event(source, 'blur');await settle();expect(mounted.root.querySelectorAll('.is-sentence-highlighted')).toHaveLength(0);
    const translated = mounted.root.querySelector('.fluent-read-translation-text > span')!;event(translated, 'pointerenter');event(translated, 'focus');await settle();expect(mounted.root.querySelectorAll('.is-sentence-highlighted')).toHaveLength(2);event(translated, 'blur');await settle();
    mounted.props.translationBeforeOriginal = true;mounted.props.customized = true;mounted.props.hint = 'Hint';mounted.props.highlightStyle = 'underline';await settle();
    expect(mounted.root.querySelector('p')!.firstElementChild!.classList.contains('fluent-read-bilingual-content')).toBe(true);expect(mounted.root.querySelector('.translation-style-preview-badge')).not.toBeNull();
    event(mounted.root.querySelector('.translation-style-preview-page')!, 'pointerleave');mounted.props.highlightEnabled = false;await settle();expect(mounted.root.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    const themes = mounted.root.querySelectorAll('[role="radio"]');event(themes[1], 'click');expect(update).toHaveBeenLastCalledWith('dark');event(themes[0], 'click');expect(update).toHaveBeenLastCalledWith('light');
    expect(outside.textContent).toBe('Original host text');expect(outside.attributes.length).toBe(0);
  });
  it.each(['preset', 'profile'] as const)('restores unsaved sentence-highlight appearance after None and the remembered %s', async source => {
    const media = {matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()};
    Object.defineProperty(dom.window, 'matchMedia', {configurable: true, value: () => media});
    const editedAppearance = {...DEFAULT_SENTENCE_HIGHLIGHT_APPEARANCE, backgroundColor: '#ff0000', lineThickness: 3, customCss: 'text-shadow: 0 0 1px red;'};
    const savedAppearance = {...DEFAULT_SENTENCE_HIGHLIGHT_APPEARANCE, backgroundColor: '#0000ff'};
    const mounted = await mount(SentenceHighlightStyleSettings, {config: {
      theme: 'light', translationBeforeOriginal: false, bilingualSentenceHighlightEnabled: true,
      bilingualSentenceHighlightStyle: 'rose', bilingualSentenceHighlightAppearance: editedAppearance,
      activeSentenceHighlightProfileId: source === 'profile' ? 'saved' : '',
      bilingualSentenceHighlightProfiles: [{id: 'saved', name: 'Saved style', style: 'rose', appearance: savedAppearance}],
    }});
    const config = mounted.props.config;
    const rememberedAppearance = config.bilingualSentenceHighlightAppearance;
    const rememberedProfile = config.activeSentenceHighlightProfileId;
    const none = mounted.root.querySelector('[data-highlight-style="none"]')!;
    event(none, 'click');await settle();
    expect(config.bilingualSentenceHighlightEnabled).toBe(false);
    expect(config.bilingualSentenceHighlightAppearance).toBe(rememberedAppearance);
    expect(config.activeSentenceHighlightProfileId).toBe(rememberedProfile);
    expect(mounted.root.querySelectorAll('.sentence-highlight-option[aria-checked="true"]')).toHaveLength(1);
    expect(none.getAttribute('aria-checked')).toBe('true');
    expect(mounted.root.querySelector('[data-bilingual-highlight-enabled]')!.getAttribute('data-bilingual-highlight-enabled')).toBe('false');
    event(mounted.root.querySelector(source === 'profile' ? '[data-profile-id="saved"]' : '[data-highlight-style="rose"]')!, 'click');await settle();
    expect(config.bilingualSentenceHighlightEnabled).toBe(true);
    expect(config.bilingualSentenceHighlightAppearance).toBe(rememberedAppearance);
    expect(config.bilingualSentenceHighlightAppearance).toEqual(editedAppearance);
    expect(config.activeSentenceHighlightProfileId).toBe(rememberedProfile);
    expect(none.getAttribute('aria-checked')).toBe('false');
    expect(mounted.root.querySelector('[data-bilingual-highlight-enabled]')!.getAttribute('data-bilingual-highlight-enabled')).toBe('true');
    // 关闭后改选另一个预设仍采用该预设的原貌，不携带前一套自定义颜色。
    event(none, 'click');await settle();event(mounted.root.querySelector('[data-highlight-style="mint"]')!, 'click');await settle();
    expect(config.bilingualSentenceHighlightEnabled).toBe(true);
    expect(config.bilingualSentenceHighlightStyle).toBe('mint');
    expect(config.bilingualSentenceHighlightAppearance).toEqual(DEFAULT_SENTENCE_HIGHLIGHT_APPEARANCE);
    expect(config.activeSentenceHighlightProfileId).toBe('');
    mounted.unmount();expect(media.removeEventListener).toHaveBeenCalledOnce();
    Reflect.deleteProperty(dom.window, 'matchMedia');
  });
  it('renders service brands, builtin fallbacks, custom IDs and reactive tones as decoration', async () => {
    const mounted = await mount(ServiceIcon, {service: 'openai'});
    const cases = [...Object.keys(brandPaths), 'azureOpenai', 'newapi', 'deepL', 'microsoft', 'freeTranslation', 'yandexFree', 'volcengineFree', 'youdaoFree', 'myMemory', 'google', 'deeplx', 'xiaoniu', 'youdao', 'transmart', 'chromeTranslator', 'localTranslation', 'azureTranslator', 'mistral', 'constructor', 'unknown', 'custom:test'];
    for (const service of cases) {mounted.props.service = service;await settle();expect(mounted.root.querySelector('svg')).not.toBeNull();expect(mounted.root.querySelector('span')!.getAttribute('aria-hidden')).toBe('true');}
    mounted.props.label = 'Display label';mounted.props.size = 'small';await settle();expect(mounted.root.querySelector('span')!.getAttribute('title')).toBe('Display label');expect(mounted.root.querySelector('.service-brand-icon--small')).not.toBeNull();
  });
  it('shares the local Bilibili SVG with its free provider and updates fallback decoration reactively', async () => {
    const mounted = await mount(ServiceIcon, {service: 'bilibili', label: 'Bilibili', size: 'small'});
    const svg = mounted.root.querySelector('svg')!.outerHTML;
    expect(mounted.root.querySelectorAll('svg path')).toHaveLength(2);
    expect(mounted.root.querySelector('[data-service-icon-fallback]')).toBeNull();
    mounted.props.service = 'bilibiliFree'; mounted.props.label = 'Free Bilibili'; await settle();
    const icon = mounted.root.querySelector('.service-brand-icon')!;
    expect(mounted.root.querySelector('svg')!.outerHTML).toBe(svg);
    expect(icon.getAttribute('data-service')).toBe('bilibiliFree');
    expect(icon.getAttribute('title')).toBe('Free Bilibili');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.classList.contains('service-brand-icon--small')).toBe(true);
    mounted.props.service = 'unknown'; mounted.props.label = ''; await settle();
    expect(mounted.root.querySelector('[data-service-icon-fallback]')).not.toBeNull();
    expect(icon.getAttribute('title')).toBe('unknown');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
  it('falls back to info for all unknown icon names including inherited object keys', async () => {
    const mounted = await mount(UiIcon, {name: 'info'});const path = mounted.root.querySelector('path')!.getAttribute('d');
    for (const name of ['unknown', 'constructor', '__proto__', 'toString']) {mounted.props.name = name;await settle();expect(mounted.root.querySelector('path')!.getAttribute('d')).toBe(path);}
    mounted.props.name = 'book';mounted.props.size = 24;await settle();expect(mounted.root.querySelector('path')!.getAttribute('d')).not.toBe(path);expect(mounted.root.querySelector('svg')!.getAttribute('focusable')).toBe('false');
  });
  it('renders feature switches, settings group slot shells and keyboard help names without form submission', async () => {
    const update = vi.fn();const mounted = await mount(FeatureEnableCard, {modelValue: false, title: 'Enable', description: 'Help'}, {listeners: {'onUpdate:modelValue': update}});
    const button = mounted.root.querySelector('button')!;expect(button.getAttribute('role')).toBe('switch');expect(button.getAttribute('aria-checked')).toBe('false');expect(button.getAttribute('type')).toBe('button');event(button, 'click');expect(update).toHaveBeenCalledWith(true);
    mounted.props.modelValue = true;mounted.props.disabled = true;mounted.props.description = '';await settle();expect(button.hasAttribute('disabled')).toBe(true);expect(mounted.root.querySelector('.feature-enable-description')).toBeNull();
    const group = await mount(SettingsGroup, {title: 'Group', description: 'Description'}, {slots: {default: () => h('p', 'Content')}});expect(group.root.querySelector('h2')!.textContent).toBe('Group');group.props.title = '';group.props.description = '';await settle();expect(group.root.querySelector('header')).toBeNull();expect(group.root.textContent).toBe('Content');
    const help = await mount(FieldHelp, {content: 'Helpful text', label: 'More', buttonClass: 'extra'}, {slots: {content: () => h('a', {href: '#'}, 'Details')}});expect(help.root.querySelector('button')!.getAttribute('aria-label')).toBe('More');help.props.label = '';await settle();expect(help.root.querySelector('button')!.getAttribute('aria-label')).toBe('Helpful text');expect(dom.document.querySelector('[data-tooltip-content-port] a')!.textContent).toBe('Details');
    const simpleHelp = await mount(FieldHelp, {content: 'Plain help'});expect(simpleHelp.root.querySelector('button')!.getAttribute('aria-label')).toBe('Plain help');
    const titleOnly = await mount(SettingsGroup, {title: 'Title'});expect(titleOnly.root.querySelector('p')).toBeNull();const descriptionOnly = await mount(SettingsGroup, {description: 'Description'});expect(descriptionOnly.root.querySelector('h2')).toBeNull();
  });
  it('projects skin previews and updates their accessible labels and tokens across every registry entry', async () => {
    const mounted = await mount(InterfaceSkinPreview, {skin: skin(), skinLabel: 'Default', previewLabel: 'Preview'});
    for (const chosen of interfaceSkinOptions) {mounted.props.skin = chosen;mounted.props.previewLabel = chosen.label;await settle();const section = mounted.root.querySelector('section')!;expect(section.getAttribute('data-preview-skin')).toBe(chosen.value);expect(section.getAttribute('aria-label')).toBe(chosen.label);expect(section.style.getPropertyValue('--interface-popup-width')).toBe(`${chosen.popupWidth}px`);expect(section.querySelector('.preview-popup')!.getAttribute('data-preview-skin')).toBe(chosen.value);expect(mounted.root.querySelectorAll('button,input')).toHaveLength(0);}
  });
  it('updates writing examples and all custom fallback notes using the actual pure preview module', async () => {
    const mounted = await mount(WritingStylePreview, {length: 'short', style: 'auto', tone: 'natural', role: 'auto', animated: false});
    for (const length of ['short', 'standard', 'detailed']) {mounted.props.length = length;await settle();expect([...mounted.root.querySelectorAll('.preview-body p')].map(item => item.textContent)).toEqual(writingPreviewParagraphs({length: length as any, style: 'auto', tone: 'natural', role: 'auto'}).map(item => item.text));expect(dom.frames.size).toBe(0);}
    for (const [tone, role, note] of [['custom', 'auto', '自定义语气会'], ['natural', 'custom', '自定义角色会'], ['custom', 'custom', '自定义语气和角色会']]) {mounted.props.tone = tone;mounted.props.role = role;await settle();expect(mounted.root.textContent).toContain(note);}
    mounted.props.referenceLabel = 'English';mounted.props.animated = true;await settle();expect(mounted.root.textContent).toContain('English');ports.locale.value = 'localized:';await settle();expect(mounted.root.querySelector('.preview-scenario')!.textContent).toContain('localized:');
  });
});

/**
 * @file tests/selectionSettingsConsumer.test.ts
 * 文件职责：作为 SelectionSettings 的真实组件消费者，验证预览操作与父级配置草稿的联动。
 * 主要内容：执行目标 SFC/setup/template 及真实开关/布局子组件，通过 DOM click 验证单词/句子内容、ARIA、启停与显示模式恢复；预览不改配置。
 * 模块边界：linkedom 提供 DOM；仅隔离无关的 HarnessSettings 和 ReadingAnswer 公共子组件端口，不 mock 目标、复制产品事件或读取私有 setup；不证明浏览器可信输入、像素、存储或供应商行为。
 */
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest';
import {dirname, resolve} from 'node:path';
import {compileVueInlineFixture} from './helpers/compiledVueFixture';

const dom = await vi.hoisted(async () => {
    const {parseHTML} = await import('linkedom');
    const {window, document} = parseHTML('<html><body></body></html>');
    const keys = ['window', 'document', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'ShadowRoot', 'Event'];
    const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const nodeTag = Object.getOwnPropertyDescriptor(window.Node.prototype, Symbol.toStringTag);
    Object.defineProperty(window.Node.prototype, Symbol.toStringTag, {configurable: true, get() {return this.constructor.name;}});
    for (const key of keys) Object.defineProperty(globalThis, key, {configurable: true, writable: true, value: (window as any)[key]});
    return {document: document as unknown as Document, Event: window.Event, restore() {
        for (const [key, original] of originals) {
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        }
        if (nodeTag) Object.defineProperty(window.Node.prototype, Symbol.toStringTag, nodeTag);
        else Reflect.deleteProperty(window.Node.prototype, Symbol.toStringTag);
    }};
});

import * as Vue from 'vue';
import {Config} from '@/src/core/config/model';
import * as preview from '@/src/core/config/selectionPreview';

// 只观察目标传给公共展示边界的 props，不把子组件替身算作回答渲染或学习服务的验收。
const ReadingAnswerPort = Vue.defineComponent({props: {text: String, sourceText: String},
    setup: props => () => Vue.h('div', {'data-reading-answer-port': '', 'data-source': props.sourceText}, props.text)});
const HarnessSettingsPort = Vue.defineComponent({props: ['config'],
    setup: props => () => Vue.h('div', {'data-harness-settings-port': '', 'data-mode': props.config.selectionTranslatorMode})});
const actualComponents = new Set([
    'src/features/settings/ui/SelectionSettings.vue',
    'src/ui/components/FeatureEnableCard.vue',
    'src/features/settings/ui/components/SettingsGroup.vue',
    'src/features/settings/ui/components/SettingsPreviewLayout.vue',
].map(relative => resolve(process.cwd(), relative)));
function loadClient(relative: string, components = new Map<string, Vue.Component>()): Vue.Component {
    const filename = resolve(process.cwd(), relative);
    if (components.has(filename)) return components.get(filename)!;
    if (!actualComponents.has(filename)) throw new Error(`Unexpected Selection settings component: ${relative}`);
    const compiled = compileVueInlineFixture(filename, {id: filename});
    expect(compiled.parseErrors).toEqual([]);
    const dependencies: Record<string, unknown> = {
        vue: Vue,
        '@/src/ui/i18n': {useUiI18n: () => ({t: (key: string) => key})},
        '@/src/core/config/selectionPreview': preview,
        '@/src/features/reading-assistant/ui/answer/public': {ReadingAnswer: ReadingAnswerPort},
        './HarnessSettings.vue': {default: HarnessSettingsPort},
        './settings-card-heading.css': {},
    };
    const module = {exports: {} as {default: Vue.Component}};
    new Function('require', 'exports', 'module', compiled.code)((id: string) => {
        if (Object.hasOwn(dependencies, id)) return dependencies[id];
        if (id.endsWith('.vue')) return {default: loadClient(id.startsWith('@/') ? id.slice(2) : resolve(dirname(filename), id), components)};
        throw new Error(`Unexpected Selection settings dependency: ${id}`);
    }, module.exports, module);
    components.set(filename, module.exports.default);
    return module.exports.default;
}

let app: Vue.App | undefined, root: HTMLElement, state: {config: Config};
async function settle(): Promise<void> {await Vue.nextTick(); await Vue.nextTick();}
async function mount(config = new Config()): Promise<void> {
    root = dom.document.createElement('div');dom.document.body.append(root);
    state = Vue.reactive({config});
    const component = loadClient('src/features/settings/ui/SelectionSettings.vue');
    app = Vue.createApp({setup: () => () => Vue.h(component, {config: state.config})});
    app.mount(root);await settle();
}
afterEach(async () => {app?.unmount();app = undefined;await settle();dom.document.body.replaceChildren();});
afterAll(() => dom.restore());
function control<T extends Element = HTMLButtonElement>(selector: string): T {
    const node = root.querySelector<T>(selector);
    expect(node, `Rendered Selection settings control ${selector}`).not.toBeNull();
    return node!;
}
function previewButton(name: string): HTMLButtonElement {
    const node = [...root.querySelectorAll<HTMLButtonElement>('.selection-preview-tabs button')].find(button => button.textContent === name);
    expect(node, `Rendered preview tab ${name}`).toBeDefined();return node!;
}
async function click(node: Element): Promise<void> {
    // 普通 DOM 事件进入实际编译模板；不直接调用 handler，也不伪造 isTrusted。
    const event = new dom.Event('click', {bubbles: true});
    Object.assign(event, {_vts: Date.now() + 1});node.dispatchEvent(event);await settle();
}
function snapshot(config: Config): Record<string, unknown> {return JSON.parse(JSON.stringify(config));}
function withoutSelectionSwitch(config: Config): Record<string, unknown> {
    const value = snapshot(config);delete value.selectionTranslatorMode;delete value.disableSelectionTranslator;return value;
}
const switchSelector = '.feature-enable-card button[role="switch"][aria-label="启用划词翻译"]';

describe('SelectionSettings 真实模板消费者', () => {
    it('单词/句子 DOM 点击同步预览内容和 aria-pressed，往返不修改配置', async () => {
        await mount();const before = snapshot(state.config);
        expect(previewButton('单词').getAttribute('aria-pressed')).toBe('true');
        expect(previewButton('句子').getAttribute('aria-pressed')).toBe('false');
        expect(control('.selection-preview-source').textContent).toBe('curious');
        expect(control('.selection-preview-translation').textContent).toBe('好奇的；求知欲强的');
        expect(control('.selection-preview-word').textContent).toContain('Eager to know or learn something.');
        expect(root.querySelector('[data-reading-answer-port]')).toBeNull();
        await click(previewButton('句子'));
        expect(previewButton('单词').getAttribute('aria-pressed')).toBe('false');
        expect(previewButton('句子').getAttribute('aria-pressed')).toBe('true');
        expect(control('.selection-preview-source').textContent).toBe(preview.sentenceSource);
        expect(control('.selection-preview-translation').textContent).toBe(preview.sentenceTranslation);
        expect(root.querySelector('.selection-preview-word')).toBeNull();
        expect(control('[data-reading-answer-port]').getAttribute('data-source')).toBe(preview.sentenceSource);
        expect(control('[data-reading-answer-port]').textContent).toBe(preview.sentenceAnalysis);
        await click(previewButton('单词'));
        expect(previewButton('单词').getAttribute('aria-pressed')).toBe('true');
        expect(previewButton('句子').getAttribute('aria-pressed')).toBe('false');
        expect(control('.selection-preview-source').textContent).toBe('curious');
        expect(root.querySelector('[data-reading-answer-port]')).toBeNull();
        expect(snapshot(state.config)).toEqual(before);
    });

    it.each(['bilingual', 'translation-only'])('%s 通过真实 FeatureEnableCard 关闭再开启，恢复显示模式并同步兼容字段', async mode => {
        const config = new Config();config.selectionTranslatorMode = mode;config.disableSelectionTranslator = false;
        await mount(config);const untouched = withoutSelectionSwitch(state.config);
        expect(control(switchSelector).getAttribute('aria-checked')).toBe('true');
        await click(control(switchSelector));
        expect(state.config.selectionTranslatorMode).toBe('disabled');
        expect(state.config.disableSelectionTranslator).toBe(true);
        expect(control(switchSelector).getAttribute('aria-checked')).toBe('false');
        expect(control('[data-harness-settings-port]').getAttribute('data-mode')).toBe('disabled');
        expect(withoutSelectionSwitch(state.config)).toEqual(untouched);
        await click(control(switchSelector));
        expect(state.config.selectionTranslatorMode).toBe(mode);
        expect(state.config.disableSelectionTranslator).toBe(false);
        expect(control(switchSelector).getAttribute('aria-checked')).toBe('true');
        expect(control('[data-harness-settings-port]').getAttribute('data-mode')).toBe(mode);
        expect(withoutSelectionSwitch(state.config)).toEqual(untouched);
    });

    it('默认关闭可正常开启；父级当前草稿变化更新开关且不重置本地预览', async () => {
        await mount();expect(control(switchSelector).getAttribute('aria-checked')).toBe('false');
        await click(control(switchSelector));
        expect(state.config.selectionTranslatorMode).toBe('bilingual');expect(state.config.disableSelectionTranslator).toBe(false);
        await click(previewButton('句子'));
        state.config.selectionTranslatorMode = 'translation-only';state.config.disableSelectionTranslator = false;await settle();
        expect(control(switchSelector).getAttribute('aria-checked')).toBe('true');
        expect(previewButton('句子').getAttribute('aria-pressed')).toBe('true');
        expect(control('[data-reading-answer-port]').textContent).toBe(preview.sentenceAnalysis);
        await click(control(switchSelector));await click(control(switchSelector));
        expect(state.config.selectionTranslatorMode).toBe('translation-only');expect(state.config.disableSelectionTranslator).toBe(false);
    });
});

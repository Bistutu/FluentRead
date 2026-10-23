/**
 * @file src/ui/i18n/legacyDom.ts
 *
 * 文件职责：隔离尚未 key 化的扩展 UI 文案迁移与 DOM 所有权规则。
 * 主要内容：提供自有 UI 根节点扫描、v-ui-i18n 指令及 document 扫描的统一生命周期；保留旧文案来源以支持语言往返，
 * 保护用户内容、代码与富文本编辑文本，并在卸载或初始化失败时释放 watcher、observer 和延迟任务。
 * 模块边界：只适配调用方明确授权的 UI 子树，不写入语言配置、不加载资源、不修改 document 标题或语言；
 * 语言响应式上下文由 src/ui/i18n.ts 提供，本模块通过独立 types.ts 引用契约，避免反向依赖运行入口。
 */

import {watch, type Directive} from 'vue';
import {DEFAULT_UI_LANGUAGE, type UiLanguage} from '@/src/core/i18n/language';
import type {UiI18nContext} from './types';

interface TrackedText {
    source: string;
    lastRendered: string;
}

interface TrackedAttribute {
    source: string;
    lastRendered: string;
}

interface UiI18nDirectiveState {
    lastScanLanguage?: UiLanguage;
    observer: MutationObserver;
    context: UiI18nContext;
    refreshQueued: boolean;
    refreshTimer?: ReturnType<typeof setTimeout>;
    refreshing: boolean;
    disposed: boolean;
    refreshAgain: boolean;
    text: WeakMap<Text, TrackedText>;
    attributes: WeakMap<HTMLElement, Map<string, TrackedAttribute>>;
    stopLanguageWatch: () => void;
    refresh: () => void;
}

const TRANSLATABLE_ATTRIBUTES = ['aria-label', 'aria-description', 'placeholder', 'title', 'alt'] as const;
const NON_UI_TEXT_SELECTOR = '[data-i18n-ignore], code, pre, script, style, textarea';
const NON_UI_ELEMENT_TAGS = new Set(['SCRIPT', 'STYLE']);

function isIgnoredElement(element: Element): boolean {
    return Boolean(element.closest('[data-i18n-ignore]')) || NON_UI_ELEMENT_TAGS.has(element.tagName);
}

function isIgnoredTextElement(element: Element | null): boolean {
    // 跟读等正文组件会嵌套 span；内容祖先的排除规则必须继续保护这些后代文本。
    if (!element || element.closest(NON_UI_TEXT_SELECTOR)) return true;
    // 编辑区域内不可编辑的 mention 等片段也属于用户内容；独立 false 根仍可承载自有 UI。
    let editingHost = element.closest('[contenteditable]');
    while (editingHost) {
        const editable = editingHost.getAttribute('contenteditable')?.toLowerCase();
        if (editable === '' || editable === 'true' || editable === 'plaintext-only') return true;
        // false 和无效枚举值均不能解除祖先编辑区域的内容所有权。
        editingHost = editingHost.parentElement?.closest('[contenteditable]') ?? null;
    }
    return false;
}

const UI_MUTATION_OBSERVER_OPTIONS: MutationObserverInit = {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
};

function isRelevantUiMutation(record: MutationRecord): boolean {
    if (record.type === 'attributes') return !isIgnoredElement(record.target as Element);
    if (record.type === 'characterData') {
        return !isIgnoredTextElement((record.target as Text).parentElement);
    }
    // 观察范围固定为 HTMLElement 子树，childList 的目标只会是其中的元素。
    if (isIgnoredElement(record.target as Element)) return false;
    return record.addedNodes.length === 0
        || Array.from(record.addedNodes).some((node) => (
            node.nodeType !== Node.ELEMENT_NODE || !isIgnoredElement(node as Element)
        ));
}

function observeUiRoot(root: HTMLElement, observer: MutationObserver): void {
    observer.observe(root, UI_MUTATION_OBSERVER_OPTIONS);
}

function scheduleUiRefresh(root: HTMLElement, state: UiI18nDirectiveState): void {
    if (state.disposed) return;
    if (state.refreshing) {
        state.refreshAgain = true;
        return;
    }
    if (state.refreshQueued) return;
    state.refreshQueued = true;
    state.refreshTimer = setTimeout(() => {
        state.refreshTimer = undefined;
        state.refreshQueued = false;
        if (state.disposed || !root.isConnected) return;
        state.refreshing = true;
        state.observer.disconnect();
        try {
            scanUiRoot(root, state.context, state);
        } finally {
            state.refreshing = false;
            if (!state.disposed && root.isConnected) observeUiRoot(root, state.observer);
            if (!state.disposed && state.refreshAgain) {
                state.refreshAgain = false;
                scheduleUiRefresh(root, state);
            }
        }
    }, 0);
}

function scanUiRoot(root: HTMLElement, context: UiI18nContext, state: UiI18nDirectiveState): void {
    if (isIgnoredElement(root)) return;
    // 模板的旧文案本身就是简体中文；冷启动与普通中文交互无需遍历整个 DOM。
    // 非中文切回中文必须扫描一次，恢复之前由此 observer 翻译的文本和属性。
    if (context.language.value === DEFAULT_UI_LANGUAGE
        && (!state.lastScanLanguage || state.lastScanLanguage === DEFAULT_UI_LANGUAGE)) return;
    state.lastScanLanguage = context.language.value;

    const document = root.ownerDocument;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
        const textNode = node as Text;
        const parent = textNode.parentElement;
        if (parent && !isIgnoredTextElement(parent)) {
            const current = textNode.data;
            if (current.trim()) {
                const tracked = state.text.get(textNode);
                const source = tracked && current === tracked.lastRendered ? tracked.source : current;
                const translated = context.translateLegacy(source);
                if (translated !== current) textNode.data = translated;
                state.text.set(textNode, {source, lastRendered: translated});
            }
        }
        node = walker.nextNode();
    }

    const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    for (const element of elements) {
        if (isIgnoredElement(element)) continue;
        for (const attribute of TRANSLATABLE_ATTRIBUTES) {
            const current = element.getAttribute(attribute);
            if (!current?.trim()) continue;
            let trackedAttributes = state.attributes.get(element);
            if (!trackedAttributes) {
                trackedAttributes = new Map();
                state.attributes.set(element, trackedAttributes);
            }
            const tracked = trackedAttributes.get(attribute);
            const source = tracked && current === tracked.lastRendered ? tracked.source : current;
            const translated = context.translateLegacy(source);
            if (translated !== current) element.setAttribute(attribute, translated);
            trackedAttributes.set(attribute, {source, lastRendered: translated});
        }
    }
}

function disposeUiState(state: UiI18nDirectiveState): void {
    if (state.disposed) return;
    state.disposed = true;
    try {
        state.stopLanguageWatch();
    } finally {
        try {
            if (state.refreshTimer !== undefined) clearTimeout(state.refreshTimer);
            state.refreshTimer = undefined;
        } finally {
            state.observer.disconnect();
        }
    }
}

/** 两种扫描入口复用同一状态构造，避免清理与新增排除规则只覆盖其中一种入口。 */
function createUiState(root: HTMLElement, context: UiI18nContext): UiI18nDirectiveState {
    const state = {} as UiI18nDirectiveState;
    state.context = context;
    state.observer = new MutationObserver((records) => {
        if (records.some(isRelevantUiMutation)) scheduleUiRefresh(root, state);
    });
    state.refresh = () => scheduleUiRefresh(root, state);
    state.refreshQueued = false;
    state.refreshing = false;
    state.disposed = false;
    state.refreshAgain = false;
    state.text = new WeakMap();
    state.attributes = new WeakMap();
    state.stopLanguageWatch = watch([context.language, context.bundleRevision], state.refresh, {flush: 'post'});
    return state;
}

export function createUiI18nDirective(context: UiI18nContext): Directive<HTMLElement> & {dispose(): void} {
    // 部分 render 失败时 Vue 尚未拥有可卸载的根节点；插件仍须释放已经创建的指令资源。
    const states = new Map<HTMLElement, UiI18nDirectiveState>();
    let disposed = false;

    return {
        mounted(root) {
            if (disposed) return;
            const state = createUiState(root, context);
            states.set(root, state);
            try {
                observeUiRoot(root, state.observer);
                state.refresh();
            } catch (error) {
                states.delete(root);
                try { disposeUiState(state); } catch { /* 保留初始化错误。 */ }
                throw error;
            }
        },
        updated(root) {
            const state = states.get(root);
            if (state) scheduleUiRefresh(root, state);
        },
        beforeUnmount(root) {
            const state = states.get(root);
            if (!state) return;
            states.delete(root);
            disposeUiState(state);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            const owned = Array.from(states.values());
            states.clear();
            let firstError: unknown;
            let failed = false;
            for (const state of owned) {
                try { disposeUiState(state); } catch (error) {
                    if (!failed) { failed = true; firstError = error; }
                }
            }
            if (failed) throw firstError;
        },
    };
}

/** 只观察明确传入的 UI 根；扩展 body 可覆盖页面 Teleport，自有 Shadow 子树不扩大到宿主。 */
export function observeUiDocument(root: HTMLElement, context: UiI18nContext): () => void {
    const state = createUiState(root, context);
    try {
        observeUiRoot(root, state.observer);
        state.refresh();
    } catch (error) {
        try { disposeUiState(state); } catch { /* 保留初始化错误。 */ }
        throw error;
    }
    return () => disposeUiState(state);
}

/**
 * 指定节点翻译的生命周期状态。
 *
 * 这里使用真实 DOM 节点作为 WeakMap 的 key，而不是 outerHTML。
 * outerHTML 会因为属性、站点重渲染或相同段落而产生身份冲突；
 * 节点状态则可以准确绑定到本次用户操作的目标。
 */
export type TranslationDisplayMode = "bilingual" | "single";
export type TranslationPhase = "loading" | "translated" | "error";
export type TranslationTargetKind = "content" | "control";

export interface TranslationState {
    mode: TranslationDisplayMode;
    /** 内容块使用上下双语；按钮等交互控件只替换内部可见文字。 */
    kind: TranslationTargetKind;
    phase: TranslationPhase;
    generation: number;
    sourceText: string;
    sourceHTML: string;
    /** Runtime-only wrapper around a direct inline run; removed on every exit path. */
    syntheticSegment: boolean;
    /** 翻译开始前的内联 style 属性，用于可条件恢复。 */
    originalStyleAttribute: string | null;
    /** 翻译开始前的 class 属性；恢复时避免留下空 class。 */
    originalClassAttribute: string | null;
    /** 插件完成渲染后记录的 style 属性；undefined 表示尚未改动样式。 */
    renderedStyleAttribute?: string | null;
    /** 插件完成渲染后记录的 class 属性，用于过滤自身添加 bilingual class 的 mutation。 */
    renderedClassAttribute?: string | null;
    /** Translation changed only the original Text nodes; DOM structure stayed live. */
    textSlotsApplied?: boolean;
    /** 控件翻译直接修改原 Text 节点；恢复时需要把节点内容写回原值。 */
    originalTextValues: Array<{node: Text; value: string}>;
    /** Exact values written by the live text-slot renderer. */
    translatedTextValues?: WeakMap<Text, string>;
    controller: AbortController;
    spinner?: HTMLElement;
    bilingualContent?: HTMLElement;
    /** 双语 wrapper 最后一次由插件写入的 HTML，用于区分宿主重绘和插件自身 mutation。 */
    bilingualHTML?: string;
}

export interface TranslationAttempt {
    state: TranslationState;
    generation: number;
}

const states = new WeakMap<HTMLElement, TranslationState>();
const activeNodeRefs = new Set<WeakRef<HTMLElement>>();
const activeRefsByNode = new WeakMap<HTMLElement, WeakRef<HTMLElement>>();

function forEachActiveNode(callback: (node: HTMLElement, state: TranslationState) => void): void {
    for (const ref of activeNodeRefs) {
        const node = ref.deref();
        if (!node) {
            activeNodeRefs.delete(ref);
            continue;
        }
        const state = states.get(node);
        if (!state) {
            activeNodeRefs.delete(ref);
            continue;
        }
        callback(node, state);
    }
}

function trackActiveNode(node: HTMLElement): void {
    if (activeRefsByNode.has(node)) return;
    const ref = new WeakRef(node);
    activeRefsByNode.set(node, ref);
    activeNodeRefs.add(ref);
}

export function getTranslationState(node: HTMLElement): TranslationState | undefined {
    return states.get(node);
}

/**
 * 开始一次新的节点翻译请求。
 * loading 状态不能重复发起请求；error 状态可以被调用方先恢复后重试。
 */
export function beginTranslation(
    node: HTMLElement,
    mode: TranslationDisplayMode,
    kind: TranslationTargetKind = "content",
    syntheticSegment = false,
): TranslationAttempt | null {
    const previous = states.get(node);
    if (previous?.phase === "loading") return null;

    previous?.controller.abort();

    const originalTextValues: Array<{node: Text; value: string}> = [];
    if ((mode === "single" || kind === "control") && node.ownerDocument?.createTreeWalker) {
        const textWalker = node.ownerDocument.createTreeWalker(node, 4);
        let textNode = textWalker.nextNode();
        while (textNode) {
            originalTextValues.push({node: textNode as Text, value: textNode.nodeValue ?? ""});
            textNode = textWalker.nextNode();
        }
    }

    const state: TranslationState = {
        mode,
        kind,
        phase: "loading",
        generation: (previous?.generation ?? 0) + 1,
        sourceText: node.textContent ?? "",
        sourceHTML: node.innerHTML,
        syntheticSegment,
        originalStyleAttribute: node.getAttribute("style"),
        originalClassAttribute: node.getAttribute("class"),
        originalTextValues,
        controller: new AbortController(),
    };

    states.set(node, state);
    trackActiveNode(node);
    return { state, generation: state.generation };
}

/**
 * 异步请求返回后，确认它仍然属于当前节点的当前一代请求。
 * sourceHTML 的检查应在移除扩展自己的 spinner 后调用。
 */
export function isCurrentTranslation(
    node: HTMLElement,
    state: TranslationState,
    generation: number,
): boolean {
    return (
        states.get(node) === state &&
        state.generation === generation &&
        !state.controller.signal.aborted &&
        node.isConnected &&
        node.innerHTML === state.sourceHTML
    );
}

export function markTranslationComplete(
    node: HTMLElement,
    state: TranslationState,
    generation: number,
): boolean {
    if (!isCurrentTranslation(node, state, generation)) return false;
    state.phase = "translated";
    state.spinner = undefined;
    return true;
}

export function markTranslationError(
    node: HTMLElement,
    state: TranslationState,
    generation: number,
): boolean {
    // 失败结果也不能覆盖站点在请求期间写入的新内容。
    // 调用方会先移除插件自己的 spinner，再进行这次快照校验。
    if (!isCurrentTranslation(node, state, generation)) return false;
    state.phase = "error";
    state.spinner = undefined;
    return true;
}

export function setSpinner(node: HTMLElement, spinner: HTMLElement): void {
    const state = states.get(node);
    if (state) state.spinner = spinner;
}

export function setBilingualContent(node: HTMLElement, content: HTMLElement): void {
    const state = states.get(node);
    if (state) {
        state.bilingualContent = content;
        state.bilingualHTML = content.innerHTML;
    }
}

/**
 * 记录插件完成渲染后的内联样式。
 *
 * 恢复时只有当节点仍保持这个值，才会写回原始样式；如果网站已经
 * 修改过 style，则保留网站的新值，避免翻译恢复覆盖宿主页面更新。
 */
export function setRenderedStyleAttribute(node: HTMLElement): void {
    const state = states.get(node);
    if (state) {
        state.renderedStyleAttribute = node.getAttribute("style");
        state.renderedClassAttribute = node.getAttribute("class");
    }
}

function removeExtensionNode(node: Node | undefined): void {
    if (node?.parentNode) node.parentNode.removeChild(node);
}

function removeRetryArtifacts(node: HTMLElement): void {
    node.querySelectorAll('[data-fr-translation-owned="true"]')
        .forEach((child) => child.remove());
}

function clearState(node: HTMLElement): void {
    states.delete(node);
    const ref = activeRefsByNode.get(node);
    if (ref) activeNodeRefs.delete(ref);
    activeRefsByNode.delete(node);
}

function unwrapSyntheticSegment(node: HTMLElement, state: TranslationState): void {
    if (!state.syntheticSegment || !node.parentNode) return;
    const parent = node.parentNode;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
}

function restoreOriginalStyle(node: HTMLElement, state: TranslationState): void {
    if (state.renderedStyleAttribute === undefined) return;
    if (node.getAttribute("style") !== state.renderedStyleAttribute) return;

    if (state.originalStyleAttribute === null) {
        node.removeAttribute("style");
    } else {
        node.setAttribute("style", state.originalStyleAttribute);
    }
}

function restoreOriginalClass(node: HTMLElement, state: TranslationState): void {
    if (state.renderedClassAttribute === undefined) return;
    if (node.getAttribute("class") === state.renderedClassAttribute) {
        if (state.originalClassAttribute === null) node.removeAttribute("class");
        else node.setAttribute("class", state.originalClassAttribute);
        return;
    }

    node.classList.remove("fluent-read-bilingual", "fluent-read-failure");
    if (state.originalClassAttribute === null && node.getAttribute("class") === "") {
        node.removeAttribute("class");
    }
}

/**
 * 恢复单个节点并清理状态。
 * 双语模式只移除译文节点；single/control 只恢复仍保持插件译值的 Text。
 * 宿主在翻译期间写入的新 DOM 或新文本永远不会被旧快照覆盖。
 */
export function restoreTranslation(node: HTMLElement): boolean {
    const state = states.get(node);
    if (!state) return false;

    state.generation += 1;
    state.controller.abort();
    removeExtensionNode(state.spinner);
    removeExtensionNode(state.bilingualContent);
    removeRetryArtifacts(node);

    if (state.textSlotsApplied) {
        state.originalTextValues.forEach(({node: textNode, value}) => {
            if (!node.contains(textNode)) return;
            const translatedValue = state.translatedTextValues?.get(textNode);
            if (translatedValue === undefined || textNode.nodeValue === translatedValue) {
                textNode.nodeValue = value;
            }
        });
    }

    restoreOriginalStyle(node, state);
    restoreOriginalClass(node, state);
    clearState(node);
    unwrapSyntheticSegment(node, state);
    return true;
}

/**
 * 丢弃一个已经失效的请求，但保留站点在请求期间写入的内容。
 * 这与 restoreTranslation 不同：它只适用于翻译结果尚未写回页面的情况。
 */
export function discardTranslation(
    node: HTMLElement,
    state: TranslationState,
): boolean {
    if (states.get(node) !== state) return false;

    state.generation += 1;
    state.controller.abort();
    removeExtensionNode(state.spinner);
    removeExtensionNode(state.bilingualContent);
    removeRetryArtifacts(node);
    restoreOriginalStyle(node, state);
    restoreOriginalClass(node, state);
    clearState(node);
    unwrapSyntheticSegment(node, state);
    return true;
}

export function setTextSlotsApplied(node: HTMLElement): void {
    const state = states.get(node);
    if (state) {
        state.textSlotsApplied = true;
        state.translatedTextValues = new WeakMap(
            state.originalTextValues.map(({node: textNode}) => [textNode, textNode.nodeValue ?? ""]),
        );
    }
}

function containsNode(ancestor: Node, descendant: Node): boolean {
    if (ancestor === descendant) return true;
    try {
        return typeof ancestor.contains === "function" && ancestor.contains(descendant);
    } catch {
        return false;
    }
}

/**
 * Find states owned by a node that the host removed. This includes a removed
 * translated target and a removed spinner/bilingual wrapper whose owner stays
 * connected. The runtime uses this before its generic artifact filter.
 */
export function getTranslationOwnersForRemovedNode(removed: Node): HTMLElement[] {
    const owners: HTMLElement[] = [];
    forEachActiveNode((owner, state) => {
        if (containsNode(removed, owner) ||
            (state.spinner && containsNode(removed, state.spinner)) ||
            (state.bilingualContent && containsNode(removed, state.bilingualContent))) {
            owners.push(owner);
        }
    });
    return owners;
}

/**
 * 恢复所有由指定节点翻译状态机管理的节点。
 * Set 只用于可枚举生命周期；真正的状态仍然存储在 WeakMap 中。
 */
export function restoreAllTranslations(): void {
    const nodes: HTMLElement[] = [];
    forEachActiveNode((node) => nodes.push(node));
    nodes.forEach((node) => restoreTranslation(node));
}

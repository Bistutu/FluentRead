/**
 * 指定节点翻译的生命周期状态。
 *
 * 这里使用真实 DOM 节点作为 WeakMap 的 key，而不是 outerHTML。
 * outerHTML 会因为属性、站点重渲染或相同段落而产生身份冲突；
 * 节点状态则可以准确绑定到本次用户操作的目标。
 */
type TranslationDisplayMode = "bilingual" | "single";
type TranslationPhase = "loading" | "translated" | "error";
type TranslationTargetKind = "content" | "control";

export interface TranslationState {
    mode: TranslationDisplayMode;
    /** 内容块使用上下双语；按钮等交互控件只替换内部可见文字。 */
    kind: TranslationTargetKind;
    phase: TranslationPhase;
    generation: number;
    sourceText: string;
    /** Text-slot identities visible at request creation, before any live replacement. */
    sourceTextNodes?: readonly Text[];
    sourceHTML: string;
    /** Runtime-only wrapper around a direct inline run; removed on every exit path. */
    syntheticSegment: boolean;
    /** Exact direct children captured before the loading spinner is appended. */
    syntheticSourceNodes?: readonly ChildNode[];
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
    /** Text nodes that were visible/translatable when single/control rendering ran. */
    translatedTextNodes?: readonly Text[];
    controller: AbortController;
    spinner?: HTMLElement;
    bilingualContent?: HTMLElement;
    /** 失败态的重试控件；用于区分扩展写入与宿主移除。 */
    retryWrapper?: HTMLElement;
    /** 双语 wrapper 最后一次由插件写入的 HTML，用于区分宿主重绘和插件自身 mutation。 */
    bilingualHTML?: string;
}

interface TranslationAttempt {
    state: TranslationState;
    generation: number;
}

const states = new WeakMap<HTMLElement, TranslationState>();
const activeNodeRefs = new Set<WeakRef<HTMLElement>>();
const activeRefsByNode = new WeakMap<HTMLElement, WeakRef<HTMLElement>>();
const ownersByIndexedNode = new WeakMap<Node, Set<HTMLElement>>();
const indexedNodesByOwner = new WeakMap<HTMLElement, Set<Node>>();

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

function clearOwnershipIndex(owner: HTMLElement): void {
    const indexedNodes = indexedNodesByOwner.get(owner);
    if (!indexedNodes) return;

    indexedNodes.forEach((indexedNode) => {
        const owners = ownersByIndexedNode.get(indexedNode);
        owners?.delete(owner);
        if (owners?.size === 0) ownersByIndexedNode.delete(indexedNode);
    });
    indexedNodesByOwner.delete(owner);
}

function refreshOwnershipIndex(owner: HTMLElement, state: TranslationState): void {
    clearOwnershipIndex(owner);
    const indexedNodes = new Set<Node>([
        owner,
        ...(state.spinner ? [state.spinner] : []),
        ...(state.bilingualContent ? [state.bilingualContent] : []),
        ...(state.retryWrapper ? [state.retryWrapper] : []),
    ]);
    indexedNodesByOwner.set(owner, indexedNodes);

    indexedNodes.forEach((indexedNode) => {
        let owners = ownersByIndexedNode.get(indexedNode);
        if (!owners) {
            owners = new Set<HTMLElement>();
            ownersByIndexedNode.set(indexedNode, owners);
        }
        owners.add(owner);
    });
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
    sourceText = node.textContent ?? "",
    sourceTextNodes?: readonly Text[],
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
        sourceText,
        sourceTextNodes: sourceTextNodes ? [...sourceTextNodes] : undefined,
        sourceHTML: node.innerHTML,
        syntheticSegment,
        syntheticSourceNodes: syntheticSegment ? Array.from(node.childNodes) : undefined,
        originalStyleAttribute: node.getAttribute("style"),
        originalClassAttribute: node.getAttribute("class"),
        originalTextValues,
        controller: new AbortController(),
    };

    states.set(node, state);
    trackActiveNode(node);
    refreshOwnershipIndex(node, state);
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
    validateSourceHTML = true,
): boolean {
    return (
        states.get(node) === state &&
        state.generation === generation &&
        !state.controller.signal.aborted &&
        node.isConnected &&
        (!validateSourceHTML || node.innerHTML === state.sourceHTML)
    );
}

export function markTranslationComplete(
    node: HTMLElement,
    state: TranslationState,
    generation: number,
    validateSourceHTML = true,
): boolean {
    return transitionPhase(node, state, generation, "translated", validateSourceHTML);
}

export function markTranslationError(
    node: HTMLElement,
    state: TranslationState,
    generation: number,
    validateSourceHTML = true,
): boolean {
    // 失败结果也不能覆盖站点在请求期间写入的新内容。
    // 调用方会先移除插件自己的 spinner，再进行这次快照校验。
    return transitionPhase(node, state, generation, "error", validateSourceHTML);
}

function transitionPhase(
    node: HTMLElement,
    state: TranslationState,
    generation: number,
    phase: Extract<TranslationPhase, "translated" | "error">,
    validateSourceHTML: boolean,
): boolean {
    if (!isCurrentTranslation(node, state, generation, validateSourceHTML)) return false;
    state.phase = phase;
    state.spinner = undefined;
    refreshOwnershipIndex(node, state);
    return true;
}

type TranslationArtifactKey = "spinner" | "bilingualContent" | "retryWrapper";

function setArtifact(
    node: HTMLElement,
    key: TranslationArtifactKey,
    artifact: HTMLElement,
): void {
    const state = states.get(node);
    if (!state) return;
    state[key] = artifact;
    refreshOwnershipIndex(node, state);
}

export function setSpinner(node: HTMLElement, spinner: HTMLElement): void {
    setArtifact(node, "spinner", spinner);
}

export function setBilingualContent(node: HTMLElement, content: HTMLElement): void {
    setArtifact(node, "bilingualContent", content);
    const state = states.get(node);
    if (state) state.bilingualHTML = content.innerHTML;
}

export function setRetryWrapper(node: HTMLElement, wrapper: HTMLElement): void {
    setArtifact(node, "retryWrapper", wrapper);
}

/**
 * The host removed only our failure UI. Keep an error tombstone so generic
 * discovery cannot turn a permanent provider failure into automatic retries;
 * a real source mutation or an explicit user action can still clear it.
 */
export function detachFailedTranslationUi(
    node: HTMLElement,
    state: TranslationState,
): boolean {
    if (states.get(node) !== state || state.phase !== "error") return false;
    removeExtensionNode(state.retryWrapper);
    state.retryWrapper = undefined;
    restoreOriginalStyle(node, state);
    restoreOriginalClass(node, state);
    state.renderedStyleAttribute = node.getAttribute("style");
    state.renderedClassAttribute = node.getAttribute("class");
    refreshOwnershipIndex(node, state);
    return true;
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
    clearOwnershipIndex(node);
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
    teardownAttempt(node, state, true);
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
    teardownAttempt(node, state, false);
    return true;
}

function teardownAttempt(
    node: HTMLElement,
    state: TranslationState,
    restoreTextSlots: boolean,
): void {
    state.generation += 1;
    state.controller.abort();
    removeExtensionNode(state.spinner);
    removeExtensionNode(state.bilingualContent);
    removeRetryArtifacts(node);

    if (restoreTextSlots && state.textSlotsApplied) {
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
}

export function setTextSlotsApplied(
    node: HTMLElement,
    translatedTextNodes?: readonly Text[],
): void {
    const state = states.get(node);
    if (state) {
        state.textSlotsApplied = true;
        state.translatedTextNodes = translatedTextNodes
            ? [...translatedTextNodes]
            : state.originalTextValues.map(({node: textNode}) => textNode);
        state.translatedTextValues = new WeakMap(
            state.originalTextValues.map(({node: textNode}) => [textNode, textNode.nodeValue ?? ""]),
        );
    }
}

/**
 * Find states owned by a node that the host removed. This includes a removed
 * translated target and a removed spinner/bilingual wrapper whose owner stays
 * connected. Walk only the removed subtree and consult the incrementally
 * maintained ownership index; unrelated active translations are never scanned.
 * The runtime uses this before its generic artifact filter.
 */
export function getTranslationOwnersForRemovedNode(removed: Node): HTMLElement[] {
    const owners = new Set<HTMLElement>();
    const stack: Node[] = [removed];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;

        ownersByIndexedNode.get(current)?.forEach((owner) => {
            if (states.has(owner)) owners.add(owner);
        });

        if (current.nodeType === 1) {
            const shadowRoot = (current as Element).shadowRoot;
            if (shadowRoot) stack.push(shadowRoot);
        }

        for (let index = current.childNodes.length - 1; index >= 0; index -= 1) {
            const child = current.childNodes.item(index);
            if (child) stack.push(child);
        }
    }

    return [...owners];
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

/**
 * 指定节点翻译的生命周期状态。
 *
 * 这里使用真实 DOM 节点作为 WeakMap 的 key，而不是 outerHTML。
 * outerHTML 会因为属性、站点重渲染或相同段落而产生身份冲突；
 * 节点状态则可以准确绑定到本次用户操作的目标。
 */
export type TranslationDisplayMode = "bilingual" | "single";
export type TranslationPhase = "loading" | "translated" | "error";

export interface TranslationState {
    mode: TranslationDisplayMode;
    phase: TranslationPhase;
    generation: number;
    sourceText: string;
    sourceHTML: string;
    sourceOuterHTML: string;
    translatedHTML?: string;
    /**
     * 仅译文模式会暂时移除这些原始子节点。
     * 恢复时重新插入同一批节点，避免重建页面原有节点对象。
     */
    originalChildren: ChildNode[];
    controller: AbortController;
    spinner?: HTMLElement;
    bilingualContent?: HTMLElement;
}

export interface TranslationAttempt {
    state: TranslationState;
    generation: number;
}

const states = new WeakMap<HTMLElement, TranslationState>();
const activeNodes = new Set<HTMLElement>();

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
): TranslationAttempt | null {
    const previous = states.get(node);
    if (previous?.phase === "loading") return null;

    previous?.controller.abort();

    const state: TranslationState = {
        mode,
        phase: "loading",
        generation: (previous?.generation ?? 0) + 1,
        sourceText: node.textContent ?? "",
        sourceHTML: node.innerHTML,
        sourceOuterHTML: node.outerHTML,
        originalChildren: Array.from(node.childNodes),
        controller: new AbortController(),
    };

    states.set(node, state);
    activeNodes.add(node);
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
    if (state) state.bilingualContent = content;
}

function removeExtensionNode(node: Node | undefined): void {
    if (node?.parentNode) node.parentNode.removeChild(node);
}

function removeRetryArtifacts(node: HTMLElement): void {
    node.querySelectorAll('.fluent-read-retry-wrapper, .fluent-read-loading')
        .forEach((child) => child.remove());
}

function clearState(node: HTMLElement): void {
    states.delete(node);
    activeNodes.delete(node);
}

function removeCurrentChildren(node: HTMLElement): void {
    while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * 恢复单个节点并清理状态。
 * 双语模式只移除译文节点；仅译文模式重新插入原始 ChildNode 对象。
 */
export function restoreTranslation(node: HTMLElement): boolean {
    const state = states.get(node);
    if (!state) return false;

    state.generation += 1;
    state.controller.abort();
    removeExtensionNode(state.spinner);
    removeExtensionNode(state.bilingualContent);
    removeRetryArtifacts(node);

    if (state.mode === "single") {
        // 站点在翻译完成后可能已经重渲染了目标；此时不能用旧快照覆盖站点内容。
        if (!state.translatedHTML || node.innerHTML === state.translatedHTML) {
            removeCurrentChildren(node);
            state.originalChildren.forEach((child) => node.appendChild(child));
        }
    }

    node.classList.remove("fluent-read-bilingual", "fluent-read-failure");
    clearState(node);
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
    node.classList.remove("fluent-read-bilingual", "fluent-read-failure");
    clearState(node);
    return true;
}

export function setTranslatedHTML(node: HTMLElement, translatedHTML: string): void {
    const state = states.get(node);
    if (state) state.translatedHTML = translatedHTML;
}

/**
 * 恢复所有由指定节点翻译状态机管理的节点。
 * Set 只用于可枚举生命周期；真正的状态仍然存储在 WeakMap 中。
 */
export function restoreAllTranslations(): void {
    Array.from(activeNodes).forEach((node) => restoreTranslation(node));
}

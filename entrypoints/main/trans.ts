import { checkConfig } from "../utils/check";
import { services } from "../utils/option";
import { insertFailedTip, insertLoadingSpinner } from "../utils/icon";
import { styles } from "@/entrypoints/utils/constant";
import {
    extractTranslationText,
    extractTranslationTextFromNodes,
    applyTranslationsToSnapshot,
    collectLiveTranslationTextSlots,
    createTranslationSourceSnapshot,
    getCurrentTranslationCore,
    getOpenShadowRoots,
    getTranslationCandidateKey,
    isClearlyTargetLanguage,
    parseTranslationSlots,
    resolveTranslationCandidate,
    resolveTranslationCandidateAtPoint,
    selectPreferredTranslationCandidate,
    serializeTranslationSlots,
} from "@/entrypoints/translation-core/public";
import type {TranslationCandidate, TranslationDiscoveryStep} from "@/entrypoints/translation-core/public";
import { detectlang } from "@/entrypoints/utils/common";
import { config } from "@/entrypoints/utils/config";
import { translateText, translateTextBatch } from "@/entrypoints/utils/translateApi";
import {
    appendBilingualTranslation,
    createSafeTranslationFragment,
} from "@/entrypoints/main/translationRenderer";
import {
    beginTranslation,
    discardTranslation,
    getTranslationState,
    getTranslationOwnersForRemovedNode,
    markTranslationComplete,
    markTranslationError,
    restoreAllTranslations,
    restoreTranslation,
    setBilingualContent,
    setRenderedStyleAttribute,
    setSpinner,
    setTextSlotsApplied,
} from "@/entrypoints/main/translationState";

const TRANSLATION_ARTIFACT_SELECTOR = [
    '[data-fr-translation-segment="true"]',
    '[data-fr-translation-owned="true"]',
].join(",");

type TranslationResult = string | LiveTextTranslationResult;

interface LiveTextTranslationResult {
    kind: "live-text";
    changed: boolean;
    apply: () => void;
}

interface FullPageSession {
    active: boolean;
    observer: IntersectionObserver;
    mutationObserver: MutationObserver;
    shadowEventController: AbortController;
    roots: Set<Node>;
    pending: Map<Node, TranslationCandidate>;
    scheduled: Map<Node, TranslationCandidate>;
    observedCandidates: Map<HTMLElement, Map<Node, TranslationCandidate>>;
    inFlight: number;
    draining: boolean;
    flushTimer: number | null;
    dirtyRoots: Set<Node>;
    mutationFlushTimer: number | null;
    activeDiscovery: {root: Node; steps: Generator<TranslationDiscoveryStep>} | null;
}

let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let fullPageSession: FullPageSession | null = null;

function isElementNode(node: Node | null | undefined): node is Element {
    return Boolean(node && node.nodeType === 1 && typeof (node as Element).matches === "function");
}

function asHTMLElement(node: unknown): HTMLElement | null {
    if (!node || typeof node !== "object" || (node as Node).nodeType !== 1) return null;
    const element = node as HTMLElement;
    return typeof element.tagName === "string" && typeof element.style === "object" ? element : null;
}

function normalizeComparableText(text: string): string {
    return text.replace(/[\s\u3000]+/g, " ").trim();
}

function isTranslationArtifact(node: Node): boolean {
    const element = isElementNode(node) ? node : node.parentElement;
    return Boolean(element &&
        (element.matches(TRANSLATION_ARTIFACT_SELECTOR) || element.closest(TRANSLATION_ARTIFACT_SELECTOR)));
}

function isBatchFriendlyService(): boolean {
    return config.service === services.microsoft || config.service === services.freeTranslation;
}

async function translateTextSlots(origins: readonly string[]): Promise<string[]> {
    if (origins.length === 0) return [];
    if (isBatchFriendlyService()) {
        return translateTextBatch([...origins], document.title, { useCache: false });
    }
    if (origins.length === 1) return [await translateText(origins[0] ?? '', document.title)];

    const packet = serializeTranslationSlots(origins);
    const combined = await translateText(packet.payload, document.title, {skipLanguageDetection: true});
    const parsed = parseTranslationSlots(packet, combined);
    if (parsed?.length === origins.length) return parsed;

    // Some classic MT engines rewrite sentinel tokens. Fall back only after a
    // strict parse failure; AI providers normally keep the paragraph in one call.
    return Promise.all(origins.map((origin) => translateText(origin, document.title)));
}

/**
 * 对机器翻译的 HTML 克隆逐个替换文本节点。标签、链接、图标和原文 DOM
 * 都不直接交给服务端，避免响应把网页结构打碎；微软/免费翻译的数组接口
 * 还可以把同一段中的多个文本节点合并成一次请求。
 */
async function translateElementHTML(node: HTMLElement): Promise<string> {
    const core = getCurrentTranslationCore();
    const snapshot = createTranslationSourceSnapshot(node, core.shouldStayOriginal);
    if (snapshot.slots.length === 0) return snapshot.clone.innerHTML;

    const origins = snapshot.slots.map((part) => part.source);
    const translations = await translateTextSlots(origins);
    return applyTranslationsToSnapshot(snapshot, translations);
}

/**
 * 按钮、role=button 等交互控件必须保持原有 DOM 结构和行为，因此即使当前
 * 页面选择了双语模式，也只替换控件内的可见文本，不追加第二段译文。
 */
async function translateLiveText(node: HTMLElement): Promise<LiveTextTranslationResult> {
    const parts = collectLiveTranslationTextSlots(node, getCurrentTranslationCore().shouldStayOriginal);
    if (parts.length === 0) return { kind: "live-text", changed: false, apply: () => undefined };

    const origins = parts.map((part) => part.source);
    const translations = await translateTextSlots(origins);
    const changed = translations.some((translation, index) =>
        normalizeComparableText(translation) !== normalizeComparableText(origins[index] || ""),
    );

    return {
        kind: "live-text",
        changed,
        apply: () => {
            translations.forEach((translation, index) => {
                const part = parts[index];
                if (part?.node.isConnected) {
                    part.node.nodeValue = `${part.prefix}${translation}${part.suffix}`;
                }
            });
        },
    };
}

async function createTranslationRequest(
    node: HTMLElement,
    kind: "content" | "control",
    mode: "bilingual" | "single",
): Promise<TranslationResult> {
    if (kind === "control" || mode === "single") return translateLiveText(node);
    return translateElementHTML(node);
}

function getSafeTranslationText(text: string): string {
    const fragment = createSafeTranslationFragment(text);
    return fragment.textContent || "";
}

function markFailedTranslation(
    node: HTMLElement,
    attempt: NonNullable<ReturnType<typeof beginTranslation>>,
    spinner: HTMLElement | undefined,
    error: unknown,
): void {
    spinner?.remove();
    if (!node.isConnected || !markTranslationError(node, attempt.state, attempt.generation)) {
        discardTranslation(node, attempt.state);
        return;
    }
    insertFailedTip(node, error instanceof Error ? error.message : String(error || "翻译失败"), spinner);
    setRenderedStyleAttribute(node);
}

async function renderTranslation(
    node: HTMLElement,
    attempt: NonNullable<ReturnType<typeof beginTranslation>>,
    request: Promise<TranslationResult>,
): Promise<void> {
    const { state, generation } = attempt;
    const spinner = state.spinner;

    try {
        const result = await request;
        spinner?.remove();

        if (!node.isConnected || !markTranslationComplete(node, state, generation)) {
            discardTranslation(node, state);
            return;
        }

        if (typeof result !== "string") {
            const liveResult = result as LiveTextTranslationResult;
            if (!liveResult.changed) {
                discardTranslation(node, state);
                return;
            }
            liveResult.apply();
            setTextSlotsApplied(node);
            return;
        }

        const translatedText = typeof result === "string" ? result : "";
        const translatedPlainText = getSafeTranslationText(translatedText);
        if (!translatedPlainText || normalizeComparableText(translatedPlainText) === normalizeComparableText(state.sourceText)) {
            discardTranslation(node, state);
            return;
        }

        const content = appendBilingualTranslation(node, translatedText);
        setBilingualContent(node, content);
        setRenderedStyleAttribute(node);
    } catch (error) {
        markFailedTranslation(node, attempt, spinner, error);
    }
}

function candidateIsCurrent(candidate: TranslationCandidate): boolean {
    const core = getCurrentTranslationCore();
    if (!candidate.element.isConnected) return false;
    if (candidate.nodes?.length) {
        if (candidate.nodes.some((node) => node.parentNode !== candidate.element)) return false;
        const fresh = core.resolve(getTranslationCandidateKey(candidate));
        return Boolean(fresh && fresh.element === candidate.element &&
            fresh.kind === candidate.kind &&
            getTranslationCandidateKey(fresh) === getTranslationCandidateKey(candidate));
    }
    const fresh = core.inspect(candidate.element).candidate;
    return fresh?.element === candidate.element && fresh.kind === candidate.kind;
}

function materializeCandidate(candidate: TranslationCandidate): {node: HTMLElement; synthetic: boolean} | null {
    if (!candidate.nodes?.length) return {node: candidate.element, synthetic: false};
    if (candidate.nodes.some((node) => node.parentNode !== candidate.element)) return null;
    const first = candidate.nodes[0];
    if (!first) return null;
    const wrapper = candidate.element.ownerDocument.createElement('span');
    candidate.element.insertBefore(wrapper, first);
    candidate.nodes.forEach((node) => wrapper.appendChild(node));
    return {node: wrapper, synthetic: true};
}

function forgetCandidate(session: FullPageSession | undefined, candidate: TranslationCandidate): void {
    if (!session) return;
    const key = getTranslationCandidateKey(candidate);
    session.pending.delete(key);
    session.scheduled.delete(key);
    const observed = session.observedCandidates.get(candidate.element);
    observed?.delete(key);
    if (observed?.size === 0) {
        session.observedCandidates.delete(candidate.element);
        session.observer.unobserve(candidate.element);
    }
}

async function translateTarget(
    candidate: TranslationCandidate,
    displayMode: "bilingual" | "single",
    slide: boolean,
    owner?: FullPageSession,
): Promise<void> {
    if (!candidate.element.isConnected) {
        forgetCandidate(owner, candidate);
        return;
    }

    const existingNode = candidate.nodes?.length ? null : candidate.element;
    const current = existingNode ? getTranslationState(existingNode) : undefined;
    if (current?.phase === "loading") return;
    if (current?.phase === "translated") {
        // 滑动触发只对当前鼠标下的新目标翻译，不在移动过程中反复恢复原文。
        if (!slide && existingNode) restoreTranslation(existingNode);
        return;
    }
    if (current?.phase === "error" && existingNode) restoreTranslation(existingNode);

    if (!candidateIsCurrent(candidate)) {
        forgetCandidate(owner, candidate);
        return;
    }

    const core = getCurrentTranslationCore();
    const sourceText = candidate.nodes?.length
        ? extractTranslationTextFromNodes(candidate.nodes, core.shouldStayOriginal)
        : extractTranslationText(candidate.element, core.shouldStayOriginal);
    if (!normalizeComparableText(sourceText)) return;

    // 短 UI 文案只做确定性的 script 判断；统计检测至少需要一段可读文本，
    // 否则 GitHub 的短标题/按钮很容易被 franc 误判后静默漏译。
    if (isClearlyTargetLanguage(sourceText, config.to)) return;
    try {
        const detected = sourceText.length >= 20 ? detectlang(normalizeComparableText(sourceText)) : '';
        if (detected && detected === config.to) return;
    } catch {
        // 语言检测只是优化，不影响正常翻译流程。
    }

    const materialized = materializeCandidate(candidate);
    if (!materialized) {
        forgetCandidate(owner, candidate);
        return;
    }
    const {node, synthetic} = materialized;

    const kind = candidate.kind;
    const attempt = beginTranslation(node, displayMode, kind, synthetic);
    if (!attempt) {
        if (synthetic) node.replaceWith(...Array.from(node.childNodes));
        return;
    }

    // 请求必须在 spinner 插入前创建；微软 HTML 克隆和文本节点快照不能把
    // 插件自己的 loading 元素送到服务端。
    const request = createTranslationRequest(node, kind, displayMode);
    if (synthetic) node.setAttribute('data-fr-translation-segment', 'true');
    const spinner = insertLoadingSpinner(node);
    setSpinner(node, spinner);
    await renderTranslation(node, attempt, request);
}

function scheduleFullPageDrain(session: FullPageSession): void {
    if (!session.active || session.flushTimer !== null) return;
    session.flushTimer = window.setTimeout(() => {
        session.flushTimer = null;
        drainFullPage(session);
    }, 0);
}

function drainFullPage(session: FullPageSession): void {
    if (!session.active || session.draining) return;
    session.draining = true;
    const maxConcurrent = 3;

    while (session.active && session.inFlight < maxConcurrent && session.pending.size > 0) {
        const iterator = session.pending.entries().next();
        const entry = iterator.value as [Node, TranslationCandidate] | undefined;
        if (!entry) break;
        const [key, candidate] = entry;
        session.pending.delete(key);
        session.inFlight += 1;
        void translateTarget(candidate, config.display === styles.bilingualTranslation ? "bilingual" : "single", true, session)
            .finally(() => {
                forgetCandidate(session, candidate);
                session.inFlight -= 1;
                if (session.active) scheduleFullPageDrain(session);
            });
    }
    session.draining = false;
}

function scheduleDiscoveredCandidate(session: FullPageSession, candidate: TranslationCandidate): void {
    const target = asHTMLElement(candidate.element);
    if (!session.active || !target || !target.isConnected) return;
    if (getTranslationState(target)?.phase === "translated") return;
    const key = getTranslationCandidateKey(candidate);

    // The exact descendant may already have finished while a very large
    // ancestor is still being discovered in later frame slices. Its scheduled
    // entry is intentionally forgotten after completion, so also consult the
    // state attached to the shared key before accepting a late generic run.
    const keyedTarget = asHTMLElement(key);
    if (keyedTarget && getTranslationState(keyedTarget)) return;

    // Post-order discovery can produce a generic inline run on an ancestor
    // whose first node is also the key of an exact adapter target. Keep the
    // explicit site decision: otherwise GitHub's `.markdown-title` candidate
    // is replaced by a synthetic parent run and the title itself never owns
    // its translation wrapper.
    const existing = session.scheduled.get(key);
    if (existing) {
        if (selectPreferredTranslationCandidate(existing, candidate) === existing) return;
        const previousObserved = session.observedCandidates.get(existing.element);
        previousObserved?.delete(key);
        if (previousObserved?.size === 0) {
            session.observedCandidates.delete(existing.element);
            session.observer.unobserve(existing.element);
        }
        if (session.pending.has(key)) session.pending.set(key, candidate);
    }
    session.scheduled.set(key, candidate);
    let observed = session.observedCandidates.get(target);
    if (!observed) {
        observed = new Map();
        session.observedCandidates.set(target, observed);
    }
    observed.set(key, candidate);
    session.observer.observe(target);
}

function nodeContains(ancestor: Node, descendant: Node): boolean {
    if (ancestor === descendant) return true;
    try {
        return typeof ancestor.contains === "function" && ancestor.contains(descendant);
    } catch {
        return false;
    }
}

/**
 * React/Vue pages can emit hundreds of style/class mutations per scroll frame.
 * Keep the observer callback O(records), merge overlapping dirty subtrees, then
 * discover them in short tasks so host input/scroll callbacks keep running.
 */
function enqueueFullPageRescan(session: FullPageSession, changedNode: Node): void {
    if (!session.active) return;
    const root = changedNode.nodeType === 3 ? changedNode.parentElement : changedNode;
    if (!root) return;
    if (isElementNode(root) && !root.isConnected) return;

    const dirtyRoot: Node = root;

    // Keep per-record work bounded during React/Reddit mutation storms. Once
    // enough disjoint roots accumulate, one incremental root scan is cheaper
    // than quadratic pairwise merging and still preserves correctness.
    if (session.dirtyRoots.size >= 32) {
        const rootNode = dirtyRoot.getRootNode();
        const collapsed = rootNode.nodeType === 9
            ? (rootNode as Document).documentElement
            : rootNode;
        session.dirtyRoots.clear();
        session.dirtyRoots.add(collapsed);
    } else {
        for (const existing of session.dirtyRoots) {
            if (nodeContains(existing, dirtyRoot)) return;
            if (nodeContains(dirtyRoot, existing)) session.dirtyRoots.delete(existing);
        }
        session.dirtyRoots.add(dirtyRoot);
    }
    if (session.mutationFlushTimer !== null) return;
    session.mutationFlushTimer = window.setTimeout(() => flushMutationRescans(session), 50);
}

function flushMutationRescans(session: FullPageSession): void {
    session.mutationFlushTimer = null;
    if (!session.active) return;
    const startedAt = performance.now();

    while (session.activeDiscovery || session.dirtyRoots.size > 0) {
        if (!session.activeDiscovery) {
            const iterator = session.dirtyRoots.values().next();
            const root = iterator.value as Node | undefined;
            if (!root) break;
            session.dirtyRoots.delete(root);
            if (isElementNode(root) && !root.isConnected) continue;
            session.activeDiscovery = {
                root,
                steps: getCurrentTranslationCore().discoverSteps(root),
            };
        }

        const active = session.activeDiscovery;
        const step = active.steps.next();
        if (step.done) {
            session.activeDiscovery = null;
            continue;
        }
        if (step.value.element.shadowRoot) observeFullPageRoot(session, step.value.element.shadowRoot);
        if (step.value.candidate) scheduleDiscoveredCandidate(session, step.value.candidate);

        // Each step represents at most one visited element. Yield after a small
        // frame budget even when one dirty root is an entire Reddit/Wikipedia DOM.
        if (performance.now() - startedAt >= 8) break;
    }

    if (session.activeDiscovery || session.dirtyRoots.size > 0) {
        session.mutationFlushTimer = window.setTimeout(() => flushMutationRescans(session), 16);
    }
    scheduleFullPageDrain(session);
}

function observeFullPageRoot(session: FullPageSession, root: Node): void {
    if (session.roots.has(root)) return;
    session.roots.add(root);
    session.mutationObserver.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: true,
        attributes: true,
        attributeFilter: [
            "style", "class", "role", "hidden", "inert", "contenteditable",
            "aria-hidden", "translate", "data-notranslate",
        ],
    });
}

function resolveStatefulMutationTarget(element: Element): HTMLElement | false {
    let current: Element | null = element;
    while (current) {
        const htmlCurrent = asHTMLElement(current);
        if (htmlCurrent && getTranslationState(htmlCurrent)) return htmlCurrent;
        current = current.parentElement;
    }
    return false;
}

function isOwnMutation(mutation: MutationRecord): boolean {
    // 不能用“位于任意插件节点内”作为判断：站点可能直接改写双语 wrapper
    // 的文本，必须让这类 mutation 进入 stale/retranslate 分支。加载/错误节点
    // 没有宿主正文，才可以直接视为插件自身变化。
    if (isElementNode(mutation.target) &&
        mutation.target.matches('[data-fr-translation-owned="true"]')) return true;
    const mutationElement = isElementNode(mutation.target) ? mutation.target : mutation.target.parentElement;
    const target = mutationElement ? resolveStatefulMutationTarget(mutationElement) : false;
    const state = target ? getTranslationState(target as HTMLElement) : undefined;
    if (!target || !state || state.phase !== "translated") return false;
    if ((state.kind === "control" || state.mode === "single") && mutation.type === "characterData") {
        const textNode = mutation.target as Text;
        return state.textSlotsApplied === true &&
            state.translatedTextValues?.get(textNode) === (textNode.nodeValue ?? "");
    }
    if (state.bilingualContent?.isConnected) {
        const wrapper = state.bilingualContent;
        const mutationParent = isElementNode(mutation.target)
            ? mutation.target
            : mutation.target.parentElement;

        // wrapper 内部的变化只有在内容仍等于插件最后写入的快照时才算插件自身；
        // 如果站点脚本改写了译文，必须让后续分支恢复并重新排队。
        if (mutationParent && (mutationParent === wrapper || wrapper.contains(mutationParent))) {
            return wrapper.innerHTML === state.bilingualHTML;
        }

        // 插件会先插入 loading，完成后再移除 loading 并插入译文 wrapper。
        // 这两类 childList mutation 都可能落在宿主节点上；只要所有增删节点
        // 都是扩展 artifact，且插件自己的最终快照仍然存在，就不能触发重译。
        // 若 wrapper 已被宿主移除，则保留 false，让后续逻辑恢复并重新排队。
        if (mutation.type === "childList") {
            const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
            if (changedNodes.length > 0 && changedNodes.every(isTranslationArtifact)) {
                return state.bilingualContent?.isConnected === true &&
                    state.bilingualContent.innerHTML === state.bilingualHTML;
            }
        }

        // 双语渲染会临时修改宿主节点的 style；只有值仍是插件记录的值时才忽略。
        if (mutation.type === "attributes" && mutation.attributeName === "style") {
            return target.getAttribute("style") === state.renderedStyleAttribute;
        }
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
            return target.getAttribute("class") === state.renderedClassAttribute;
        }
    }
    return mutation.addedNodes.length > 0 && Array.from(mutation.addedNodes).every(isTranslationArtifact);
}

function removeScheduledForStateTarget(session: FullPageSession, target: HTMLElement): void {
    const state = getTranslationState(target);
    const host = state?.syntheticSegment ? target.parentElement : target;
    for (const [key, candidate] of session.scheduled) {
        const matches = candidate.element === target || candidate.element === host ||
            Boolean(candidate.nodes?.some((node) => target.contains(node)));
        if (!matches) continue;
        session.scheduled.delete(key);
        session.pending.delete(key);
        const observed = session.observedCandidates.get(candidate.element);
        observed?.delete(key);
        if (observed?.size === 0) {
            session.observedCandidates.delete(candidate.element);
            session.observer.unobserve(candidate.element);
        }
    }
}

function pruneDisconnectedCandidates(session: FullPageSession): void {
    for (const candidate of Array.from(session.scheduled.values())) {
        if (candidate.element.isConnected &&
            !candidate.nodes?.some((node) => !node.isConnected)) continue;
        forgetCandidate(session, candidate);
    }
}

function discardOwnersRemovedByHost(
    session: FullPageSession,
    removedNodes: readonly Node[],
): boolean {
    const owners = new Set<HTMLElement>();
    removedNodes.forEach((removed) => {
        getTranslationOwnersForRemovedNode(removed).forEach((owner) => owners.add(owner));
    });
    owners.forEach((owner) => {
        const state = getTranslationState(owner);
        if (!state) return;
        removeScheduledForStateTarget(session, owner);
        // A host removal is authoritative. Clear our state/artifacts without
        // reattaching stale source nodes that the framework intentionally removed.
        discardTranslation(owner, state);
    });
    return owners.size > 0;
}

function restartStatefulTarget(session: FullPageSession, target: HTMLElement): boolean {
    const state = getTranslationState(target);
    if (!state) return false;
    const rescanRoot = state.syntheticSegment ? target.parentElement : target;
    removeScheduledForStateTarget(session, target);

    if (state.phase === "loading") {
        discardTranslation(target, state);
    } else {
        restoreTranslation(target);
    }
    if (rescanRoot?.isConnected) enqueueFullPageRescan(session, rescanRoot);
    return true;
}

function attachFullPageMutationHandling(session: FullPageSession): void {
    session.mutationObserver = new MutationObserver((mutations) => {
        if (!session.active) return;
        pruneDisconnectedCandidates(session);
        const core = getCurrentTranslationCore();
        for (const mutation of mutations) {
            if (isOwnMutation(mutation)) continue;
            const mutationElement = isElementNode(mutation.target)
                ? mutation.target
                : mutation.target.parentElement;
            const removedOwner = mutation.type === "childList" &&
                discardOwnersRemovedByHost(session, Array.from(mutation.removedNodes));
            if (removedOwner && mutationElement) enqueueFullPageRescan(session, mutationElement);
            if (mutationElement && core.shouldIgnoreMutation(mutationElement)) continue;

            if (mutation.type === "childList") {
                const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
                if (changedNodes.length > 0 && changedNodes.every((node) => {
                    if (isTranslationArtifact(node)) return true;
                    const element = isElementNode(node) ? node : node.parentElement;
                    return Boolean(element && core.shouldIgnoreMutation(element));
                })) continue;
            }

            if (mutation.type === "childList") {
                const changedTarget = mutationElement ? resolveStatefulMutationTarget(mutationElement) : false;
                const changedState = changedTarget ? getTranslationState(changedTarget) : undefined;

                // React/Vue 等页面可能在翻译完成后重建控件或内容块。若 DOM
                // 已不再等于插件写入的译文，先放弃旧节点快照，再把新节点
                // 重新排入全文队列，避免按钮短暂翻译后又恢复成英文。
                if (changedTarget && changedState) restartStatefulTarget(session, changedTarget);

                // A pure removal can turn a former structural container into a
                // valid paragraph. Reclassify the mutation target in all cases.
                if (mutationElement) enqueueFullPageRescan(session, mutationElement);

                for (const added of Array.from(mutation.addedNodes)) {
                    if (isTranslationArtifact(added)) continue;
                    if (added.nodeType === 1) {
                        enqueueFullPageRescan(session, added);
                    } else if (added.nodeType === 3) {
                        enqueueFullPageRescan(session, added);
                    }
                }
            } else if (mutation.type === "characterData") {
                const target = mutation.target.parentElement
                    ? resolveStatefulMutationTarget(mutation.target.parentElement)
                    : false;
                if (target) {
                    restartStatefulTarget(session, target);
                } else {
                    // Hydration frameworks often append/replace a Text node without
                    // adding a new Element. Reclassify its nearest semantic block.
                    enqueueFullPageRescan(session, mutation.target);
                }
            } else if (mutation.type === "attributes") {
                if (!mutationElement) continue;

                const target = resolveStatefulMutationTarget(mutationElement);
                if (target) {
                    restartStatefulTarget(session, target);
                } else {
                    // hidden/aria-hidden/style/class 变化可能让原先被屏蔽的子树重新可见。
                    enqueueFullPageRescan(session, mutationElement);
                }
            }
        }
    });
}

function stopFullPageSession(): void {
    if (!fullPageSession) return;
    fullPageSession.active = false;
    if (fullPageSession.flushTimer !== null) window.clearTimeout(fullPageSession.flushTimer);
    if (fullPageSession.mutationFlushTimer !== null) window.clearTimeout(fullPageSession.mutationFlushTimer);
    fullPageSession.observer.disconnect();
    fullPageSession.mutationObserver.disconnect();
    fullPageSession.shadowEventController.abort();
    fullPageSession.pending.clear();
    fullPageSession.scheduled.clear();
    fullPageSession.observedCandidates.clear();
    fullPageSession.dirtyRoots.clear();
    fullPageSession.activeDiscovery = null;
    fullPageSession = null;
}

/**
 * 恢复全文翻译。全文和悬浮翻译共享同一份节点状态，因此这里无需再用
 * data-fr-node-id + innerHTML 覆盖页面，也能处理 Shadow DOM 和动态节点。
 */
export function restoreOriginalContent(): void {
    if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = undefined;
    }
    stopFullPageSession();
    restoreAllTranslations();

    // 兼容升级前遗留的 wrapper/属性；新状态机不会依赖这些标记，但旧页面
    // 不应在扩展热更新后留下半截译文。
    const roots: Node[] = [document.documentElement, ...getOpenShadowRoots(document.documentElement)];
    for (const root of roots) {
        const queryRoot = root as Node & ParentNode;
        if (typeof queryRoot.querySelectorAll !== 'function') continue;
        const orphanOwners = new Set<Element>();
        queryRoot.querySelectorAll('[data-fr-translation-owned="true"]').forEach((element) => {
            const owner = element.parentElement;
            const htmlOwner = asHTMLElement(owner);
            if (htmlOwner && getTranslationState(htmlOwner)) return;
            if (owner) orphanOwners.add(owner);
            element.remove();
        });
        orphanOwners.forEach((owner) => {
            owner.classList.remove("fluent-read-bilingual", "fluent-read-failure");
        });
        queryRoot.querySelectorAll('[data-fr-translation-segment="true"]').forEach((segment) => {
            if (!segment.parentNode || getTranslationState(asHTMLElement(segment) as HTMLElement)) return;
            segment.replaceWith(...Array.from(segment.childNodes));
        });
    }
}

/**
 * 启动全文翻译会话：根固定为 documentElement，使用较大的预取窗口和并发
 * 限制，并持续观察新增 DOM/open ShadowRoot。这样 body 被 SPA 替换后仍能
 * 继续工作，也不会一次性给整页发出数百个请求。
 */
export function autoTranslateEnglishPage(): void {
    if (!checkConfig() || fullPageSession?.active) return;
    const root = document.documentElement;
    if (!root) return;

    const observer = new IntersectionObserver((entries) => {
        const session = fullPageSession;
        if (!session?.active) return;
        for (const entry of entries) {
            const node = entry.target as HTMLElement;
            if (!entry.isIntersecting) continue;
            const candidates = session.observedCandidates.get(node);
            candidates?.forEach((candidate, key) => session.pending.set(key, candidate));
        }
        scheduleFullPageDrain(session);
    }, {
        root: null,
        rootMargin: "600px 0px",
        threshold: 0.01,
    });

    const session: FullPageSession = {
        active: true,
        observer,
        mutationObserver: new MutationObserver(() => undefined),
        shadowEventController: new AbortController(),
        roots: new Set(),
        pending: new Map(),
        scheduled: new Map(),
        observedCandidates: new Map(),
        inFlight: 0,
        draining: false,
        flushTimer: null,
        dirtyRoots: new Set(),
        mutationFlushTimer: null,
        activeDiscovery: null,
    };
    fullPageSession = session;
    document.addEventListener('fluentread-open-shadow-root', (event) => {
        if (!session.active) return;
        const host = isElementNode(event.target as Node) ? event.target as Element : null;
        const shadowRoot = host?.shadowRoot;
        if (!shadowRoot) return;
        observeFullPageRoot(session, shadowRoot);
        enqueueFullPageRescan(session, shadowRoot);
    }, {capture: true, signal: session.shadowEventController.signal});
    attachFullPageMutationHandling(session);
    observeFullPageRoot(session, root);
    enqueueFullPageRescan(session, root);
}

export function isFullPageTranslationActive(): boolean {
    return fullPageSession?.active === true;
}

/**
 * 处理鼠标悬浮/快捷键翻译。坐标只负责找到内容块，真正的翻译调用与全文
 * 会话共用 translateTarget，因此按钮、富文本和恢复行为不会出现两套规则。
 */
export function handleTranslation(mouseX: number, mouseY: number, delayTime = 0): void {
    if (!checkConfig()) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
        const candidate = resolveTranslationCandidateAtPoint(mouseX, mouseY);
        if (!candidate) return;
        void translateTarget(candidate, config.display === styles.bilingualTranslation ? "bilingual" : "single", delayTime > 0);
    }, delayTime);
}

export function handleBilingualTranslation(node: unknown, slide: boolean): void {
    const target = asHTMLElement(node);
    if (!target) return;
    const candidate = resolveTranslationCandidate(target);
    if (candidate) void translateTarget(candidate, "bilingual", slide);
}

export function handleSingleTranslation(node: unknown, slide: boolean): void {
    const target = asHTMLElement(node);
    if (!target) return;
    const candidate = resolveTranslationCandidate(target);
    if (candidate) void translateTarget(candidate, "single", slide);
}

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
    cancelTranslationQueueSession,
    createTranslationQueueSession,
    type TranslationQueueSession,
} from "@/entrypoints/utils/translateQueue";
import {
    appendBilingualTranslation,
} from "@/entrypoints/main/translationRenderer";
import {
    beginTranslation,
    detachFailedTranslationUi,
    discardTranslation,
    getTranslationState,
    getTranslationOwnersForRemovedNode,
    markTranslationComplete,
    markTranslationError,
    restoreAllTranslations,
    restoreTranslation,
    setBilingualContent,
    setRenderedStyleAttribute,
    setRetryWrapper,
    setSpinner,
    setTextSlotsApplied,
    type TranslationState,
} from "@/entrypoints/main/translationState";

const TRANSLATION_ARTIFACT_SELECTOR = [
    '[data-fr-translation-segment="true"]',
    '[data-fr-translation-owned="true"]',
].join(",");

type TranslationResult = SnapshotTranslationResult | LiveTextTranslationResult;

interface SnapshotTranslationResult {
    kind: "snapshot";
    sources: readonly string[];
    translations: readonly string[];
}

interface LiveTextTranslationResult {
    kind: "live-text";
    changed: boolean;
    nodes: readonly Text[];
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
    broadRescanRoots: WeakSet<Node>;
    broadRescanCooldowns: WeakMap<Node, number>;
    dirtyRootsBroadMode: boolean;
    pruneTimer: number | null;
    pruneIterator: Iterator<TranslationCandidate> | null;
    pruneRequested: boolean;
    statefulAttributeTimers: Map<HTMLElement, number>;
    statefulAttributeRescanTargets: WeakSet<HTMLElement>;
}

const BROAD_RESCAN_COOLDOWN_MS = 1_000;
const CANDIDATE_PRUNE_BUDGET_MS = 4;
const STATEFUL_ATTRIBUTE_DEBOUNCE_MS = 500;

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

function mutationTargetElement(node: Node): Element | null {
    if (isElementNode(node)) return node;
    if (node.nodeType === 11) {
        const host = (node as ShadowRoot).host;
        if (isElementNode(host)) return host;
    }
    return node.parentElement;
}

function normalizeComparableText(text: string): string {
    return text.replace(/[\s\u3000]+/g, " ").trim();
}

function stateProtectionBoundary(
    node: HTMLElement,
    state: TranslationState,
): HTMLElement | undefined {
    return state.syntheticSegment ? node : undefined;
}

function currentStateSourceText(node: HTMLElement, state: TranslationState): string {
    return extractTranslationText(
        node,
        getCurrentTranslationCore().shouldStayOriginal,
        stateProtectionBoundary(node, state),
    );
}

function currentStateTextNodes(node: HTMLElement, state: TranslationState): Text[] {
    return collectLiveTranslationTextSlots(
        node,
        getCurrentTranslationCore().shouldStayOriginal,
        stateProtectionBoundary(node, state),
    ).map((slot) => slot.node);
}

function isTranslationArtifact(node: Node): boolean {
    const element = isElementNode(node) ? node : node.parentElement;
    return Boolean(element &&
        (element.matches(TRANSLATION_ARTIFACT_SELECTOR) || element.closest(TRANSLATION_ARTIFACT_SELECTOR)));
}

function isBatchFriendlyService(): boolean {
    return config.service === services.microsoft || config.service === services.freeTranslation;
}

function createAbortError(): Error {
    try {
        return new DOMException('翻译已取消', 'AbortError');
    } catch {
        const error = new Error('翻译已取消');
        error.name = 'AbortError';
        return error;
    }
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw createAbortError();
}

async function translateSlotsIndividually(
    origins: readonly string[],
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
): Promise<string[]> {
    throwIfAborted(signal);
    const translations = new Array<string>(origins.length);
    let nextIndex = 0;
    const workerCount = Math.min(3, origins.length);
    let failed = false;
    let firstError: unknown;
    let hasFirstError = false;
    const siblingController = new AbortController();
    const abortSiblings = () => {
        siblingController.abort();
        if (queueSession) cancelTranslationQueueSession(queueSession, createAbortError());
    };
    signal?.addEventListener('abort', abortSiblings, {once: true});
    const workers = Array.from({length: workerCount}, async () => {
        while (!failed && nextIndex < origins.length) {
            throwIfAborted(siblingController.signal);
            const index = nextIndex;
            nextIndex += 1;
            try {
                translations[index] = await translateText(origins[index] ?? '', document.title, {
                    signal: siblingController.signal,
                    queueSession,
                });
            } catch (error) {
                if (!hasFirstError) {
                    hasFirstError = true;
                    firstError = error;
                }
                failed = true;
                siblingController.abort();
                if (queueSession) cancelTranslationQueueSession(queueSession, firstError);
                throw error;
            }
        }
    });
    try {
        const outcomes = await Promise.allSettled(workers);
        if (hasFirstError) throw firstError;
        const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
        if (rejected) throw rejected.reason;
        return translations;
    } finally {
        signal?.removeEventListener('abort', abortSiblings);
    }
}

async function translateTextSlots(
    origins: readonly string[],
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
): Promise<string[]> {
    if (origins.length === 0) return [];
    throwIfAborted(signal);
    if (isBatchFriendlyService()) {
        return translateTextBatch([...origins], document.title, {useCache: false, signal, queueSession});
    }
    if (origins.length === 1) {
        return [await translateText(origins[0] ?? '', document.title, {signal, queueSession})];
    }

    const packet = serializeTranslationSlots(origins);
    const combined = await translateText(packet.payload, document.title, {
        skipLanguageDetection: true,
        signal,
        queueSession,
    });
    const parsed = parseTranslationSlots(packet, combined);
    if (parsed?.length === origins.length) return parsed;

    // Some classic MT engines rewrite sentinel tokens. Fall back only after a
    // strict parse failure; AI providers normally keep the paragraph in one call.
    return translateSlotsIndividually(origins, signal, queueSession);
}

/**
 * 对机器翻译的 HTML 克隆逐个替换文本节点。标签、链接、图标和原文 DOM
 * 都不直接交给服务端，避免响应把网页结构打碎；微软/免费翻译的数组接口
 * 还可以把同一段中的多个文本节点合并成一次请求。
 */
async function translateElementHTML(
    node: HTMLElement,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
): Promise<SnapshotTranslationResult> {
    const core = getCurrentTranslationCore();
    const slots = collectLiveTranslationTextSlots(node, core.shouldStayOriginal);
    if (slots.length === 0) return {kind: "snapshot", sources: [], translations: []};

    const origins = slots.map((part) => part.source);
    const translations = await translateTextSlots(origins, signal, queueSession);
    return {kind: "snapshot", sources: origins, translations};
}

/**
 * 按钮、role=button 等交互控件必须保持原有 DOM 结构和行为，因此即使当前
 * 页面选择了双语模式，也只替换控件内的可见文本，不追加第二段译文。
 */
async function translateLiveText(
    node: HTMLElement,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
): Promise<LiveTextTranslationResult> {
    const parts = collectLiveTranslationTextSlots(node, getCurrentTranslationCore().shouldStayOriginal);
    if (parts.length === 0) return {
        kind: "live-text",
        changed: false,
        nodes: [],
        apply: () => undefined,
    };

    const origins = parts.map((part) => part.source);
    const translations = await translateTextSlots(origins, signal, queueSession);
    const changed = translations.some((translation, index) =>
        normalizeComparableText(translation) !== normalizeComparableText(origins[index] || ""),
    );

    return {
        kind: "live-text",
        changed,
        nodes: parts.map((part) => part.node),
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
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
): Promise<TranslationResult> {
    if (kind === "control" || mode === "single") return translateLiveText(node, signal, queueSession);
    return translateElementHTML(node, signal, queueSession);
}

function attemptSourceIsCurrent(node: HTMLElement, state: TranslationState): boolean {
    return normalizeComparableText(currentStateSourceText(node, state)) ===
        normalizeComparableText(state.sourceText);
}

function discardStaleAttempt(
    node: HTMLElement,
    state: TranslationState,
    owner?: FullPageSession,
): void {
    if (getTranslationState(node) !== state) return;
    const rescanRoot = state.syntheticSegment ? node.parentElement : node;
    const waitsForAttributeDebounce = owner?.statefulAttributeTimers.has(node) === true;
    discardTranslation(node, state);
    if (!owner?.active || !rescanRoot?.isConnected) return;
    if (waitsForAttributeDebounce) {
        owner.statefulAttributeRescanTargets.add(node);
    } else {
        enqueueFullPageRescan(owner, rescanRoot);
    }
}

function markFailedTranslation(
    node: HTMLElement,
    attempt: NonNullable<ReturnType<typeof beginTranslation>>,
    spinner: HTMLElement | undefined,
    error: unknown,
    owner?: FullPageSession,
): void {
    spinner?.remove();
    if (!node.isConnected ||
        !attemptSourceIsCurrent(node, attempt.state) ||
        !markTranslationError(node, attempt.state, attempt.generation, false)) {
        discardStaleAttempt(node, attempt.state, owner);
        return;
    }
    const retryWrapper = insertFailedTip(
        node,
        error instanceof Error ? error.message : String(error || "翻译失败"),
        spinner,
    );
    setRetryWrapper(node, retryWrapper);
    setRenderedStyleAttribute(node);
}

async function renderTranslation(
    node: HTMLElement,
    attempt: NonNullable<ReturnType<typeof beginTranslation>>,
    request: Promise<TranslationResult>,
    owner?: FullPageSession,
): Promise<void> {
    const { state, generation } = attempt;
    const spinner = state.spinner;

    try {
        const result = await request;
        spinner?.remove();

        if (!node.isConnected || !attemptSourceIsCurrent(node, state)) {
            discardStaleAttempt(node, state, owner);
            return;
        }

        if (result.kind === "live-text") {
            const liveResult = result;
            if (!liveResult.changed) {
                discardTranslation(node, state);
                return;
            }
            const currentNodes = currentStateTextNodes(node, state);
            if (currentNodes.length !== liveResult.nodes.length ||
                currentNodes.some((textNode, index) => textNode !== liveResult.nodes[index])) {
                discardStaleAttempt(node, state, owner);
                return;
            }
            if (!markTranslationComplete(node, state, generation, false)) {
                discardStaleAttempt(node, state, owner);
                return;
            }
            liveResult.apply();
            setTextSlotsApplied(node, liveResult.nodes);
            return;
        }

        if (result.sources.length === 0 || result.translations.length !== result.sources.length ||
            !result.translations.some((translation, index) =>
                normalizeComparableText(translation) !== normalizeComparableText(result.sources[index] ?? ""))) {
            discardTranslation(node, state);
            return;
        }

        // Build the output skeleton at commit time. Host attributes and safe
        // structure (for example a link changing href from /a to /b) therefore
        // come from the current DOM, while provider text remains bound to the
        // exact ordered sources captured at request creation.
        const core = getCurrentTranslationCore();
        const freshSnapshot = createTranslationSourceSnapshot(
            node,
            core.shouldStayOriginal,
            stateProtectionBoundary(node, state),
        );
        const freshSources = freshSnapshot.slots.map((slot) => slot.source);
        if (freshSources.length !== result.sources.length ||
            freshSources.some((source, index) => source !== result.sources[index])) {
            discardStaleAttempt(node, state, owner);
            return;
        }
        const translatedText = applyTranslationsToSnapshot(freshSnapshot, result.translations);
        if (!markTranslationComplete(node, state, generation, false)) {
            discardStaleAttempt(node, state, owner);
            return;
        }

        const content = appendBilingualTranslation(node, translatedText);
        setBilingualContent(node, content);
        setRenderedStyleAttribute(node);
    } catch (error) {
        markFailedTranslation(node, attempt, spinner, error, owner);
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
    if (current?.phase === "error" && existingNode) {
        if (current.syntheticSegment) {
            const sourceNodes = Array.from(existingNode.childNodes).filter((node) =>
                !isElementNode(node) || !node.matches('[data-fr-translation-owned="true"]'),
            );
            const sourceAnchor = sourceNodes.find((node) =>
                normalizeComparableText(node.textContent ?? node.nodeValue ?? "").length > 0,
            ) ?? sourceNodes[0];
            restoreTranslation(existingNode);
            if (!sourceAnchor?.isConnected) return;
            const refreshedCandidate = getCurrentTranslationCore().resolve(sourceAnchor);
            if (!refreshedCandidate) return;
            await translateTarget(refreshedCandidate, displayMode, slide, owner);
            return;
        }
        restoreTranslation(existingNode);
    }

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
    const sourceTextNodes = kind === "control" || displayMode === "single"
        ? collectLiveTranslationTextSlots(node, core.shouldStayOriginal).map((slot) => slot.node)
        : undefined;
    const attempt = beginTranslation(
        node,
        displayMode,
        kind,
        synthetic,
        sourceText,
        sourceTextNodes,
    );
    if (!attempt) {
        if (synthetic) node.replaceWith(...Array.from(node.childNodes));
        return;
    }

    // 请求必须在 spinner 插入前创建；微软 HTML 克隆和文本节点快照不能把
    // 插件自己的 loading 元素送到服务端。
    const queueSession = createTranslationQueueSession();
    const signal = attempt.state.controller.signal;
    const cancelQueuedRequest = () => cancelTranslationQueueSession(queueSession, createAbortError());
    signal.addEventListener('abort', cancelQueuedRequest, {once: true});
    const request = createTranslationRequest(node, kind, displayMode, signal, queueSession)
        .finally(() => signal.removeEventListener('abort', cancelQueuedRequest));
    if (synthetic) node.setAttribute('data-fr-translation-segment', 'true');
    const spinner = insertLoadingSpinner(node);
    setSpinner(node, spinner);
    await renderTranslation(node, attempt, request, owner);
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
    const targetState = getTranslationState(target);
    if (targetState) {
        // An ancestor class/style mutation can change which label inside a
        // translated target is visible. Discovery still reaches the same
        // candidate; schedule a debounced source/slot check instead of silently
        // skipping it or issuing an unconditional retry.
        scheduleStatefulAttributeReevaluation(session, target);
        // loading/error/translated are all terminal for generic discovery.
        // Explicit source/structure mutations restart them through the observer.
        return;
    }
    const key = getTranslationCandidateKey(candidate);

    // The exact descendant may already have finished while a very large
    // ancestor is still being discovered in later frame slices. Its scheduled
    // entry is intentionally forgotten after completion, so also consult the
    // state attached to the shared key before accepting a late generic run.
    const keyedTarget = asHTMLElement(key);
    if (keyedTarget && getTranslationState(keyedTarget)) {
        scheduleStatefulAttributeReevaluation(session, keyedTarget);
        return;
    }

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

function broadRescanRoot(node: Node): Node {
    const rootNode = node.getRootNode();
    return rootNode.nodeType === 9
        ? (rootNode as Document).documentElement
        : rootNode;
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
    if (session.dirtyRootsBroadMode) {
        const collapsed = broadRescanRoot(dirtyRoot);
        session.dirtyRoots.add(collapsed);
        session.broadRescanRoots.add(collapsed);
    } else if (session.dirtyRoots.size >= 32) {
        const collapsedRoots = new Set<Node>(
            [...session.dirtyRoots, dirtyRoot].map(broadRescanRoot),
        );
        session.dirtyRoots.clear();
        collapsedRoots.forEach((collapsed) => {
            session.dirtyRoots.add(collapsed);
            session.broadRescanRoots.add(collapsed);
        });
        // Once a burst crosses the merge threshold, keep new mutations O(1)
        // by adding only their broad Document/ShadowRoot until this batch has
        // fully drained. Never drop roots from another composed tree.
        session.dirtyRootsBroadMode = true;
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
    let nextDelay = 16;

    while (session.activeDiscovery || session.dirtyRoots.size > 0) {
        if (!session.activeDiscovery) {
            const iterator = session.dirtyRoots.values().next();
            const root = iterator.value as Node | undefined;
            if (!root) break;
            session.dirtyRoots.delete(root);
            if (isElementNode(root) && !root.isConnected) continue;
            const rescanNotBefore = session.broadRescanCooldowns.get(root) ?? 0;
            if (session.broadRescanRoots.has(root) && performance.now() < rescanNotBefore) {
                session.dirtyRoots.add(root);
                nextDelay = Math.max(16, rescanNotBefore - performance.now());
                break;
            }
            session.activeDiscovery = {
                root,
                steps: getCurrentTranslationCore().discoverSteps(root),
            };
        }

        const active = session.activeDiscovery;
        const step = active.steps.next();
        if (step.done) {
            if (session.broadRescanRoots.has(active.root)) {
                session.broadRescanCooldowns.set(active.root, performance.now() + BROAD_RESCAN_COOLDOWN_MS);
            }
            session.activeDiscovery = null;
            continue;
        }
        if (step.value.element.shadowRoot) observeFullPageRoot(session, step.value.element.shadowRoot);
        if (step.value.phase === "enter") {
            const statefulStepTarget = asHTMLElement(step.value.element);
            if (statefulStepTarget && getTranslationState(statefulStepTarget)) {
                // Synthetic owners are intentionally hard-pruned from normal
                // candidate discovery. Still re-evaluate their live source on
                // an ancestor class/style rescan so label visibility changes
                // cannot remain untranslated.
                scheduleStatefulAttributeReevaluation(session, statefulStepTarget);
            }
        }
        if (step.value.candidate) scheduleDiscoveredCandidate(session, step.value.candidate);

        // Each step represents at most one visited element. Yield after a small
        // frame budget even when one dirty root is an entire Reddit/Wikipedia DOM.
        if (performance.now() - startedAt >= 8) break;
    }

    if (session.activeDiscovery || session.dirtyRoots.size > 0) {
        session.mutationFlushTimer = window.setTimeout(() => flushMutationRescans(session), nextDelay);
    } else {
        session.dirtyRootsBroadMode = false;
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
        mutation.target.matches('[data-fr-translation-owned="true"]') &&
        !mutation.target.matches('.fluent-read-bilingual-content')) return true;
    const mutationElement = mutationTargetElement(mutation.target);
    const target = mutationElement ? resolveStatefulMutationTarget(mutationElement) : false;
    const state = target ? getTranslationState(target as HTMLElement) : undefined;
    if (!target || !state) return false;
    if (state.phase === "error") {
        // Failure UI is extension-owned state, not a host edit. Without this
        // branch its class mutation restores/rescans the target and a permanent
        // provider error becomes an automatic infinite retry loop.
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
            return target.getAttribute("class") === state.renderedClassAttribute;
        }
        if (mutation.type === "attributes" && mutation.attributeName === "style") {
            return target.getAttribute("style") === state.renderedStyleAttribute;
        }
        if (mutation.type === "childList") {
            const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
            return changedNodes.length > 0 &&
                changedNodes.every(isTranslationArtifact) &&
                state.retryWrapper?.parentNode === target;
        }
        return false;
    }
    if (state.phase === "loading") {
        // A manual retry removes the previous failure class immediately before
        // beginTranslation creates the next generation. Mutation delivery is
        // asynchronous, so recognize that cleanup against the new snapshot.
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
            return target.getAttribute("class") === state.originalClassAttribute;
        }
        if (mutation.type === "attributes" && mutation.attributeName === "style") {
            return target.getAttribute("style") === state.originalStyleAttribute;
        }
        return false;
    }
    if (state.phase !== "translated") return false;
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
                return state.bilingualContent?.parentNode === target &&
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
    const candidateElements = new Set<HTMLElement>([target]);
    if (host) candidateElements.add(host);
    for (const element of candidateElements) {
        const candidates = session.observedCandidates.get(element);
        if (!candidates) continue;
        for (const candidate of Array.from(candidates.values())) {
            const matches = candidate.element === target || candidate.element === host ||
                Boolean(candidate.nodes?.some((node) => target.contains(node)));
            if (matches) forgetCandidate(session, candidate);
        }
    }
}

function runDisconnectedCandidatePrune(session: FullPageSession): void {
    session.pruneTimer = null;
    if (!session.active) return;
    if (!session.pruneIterator) {
        session.pruneIterator = session.scheduled.values();
        session.pruneRequested = false;
    }
    const startedAt = performance.now();

    while (session.pruneIterator) {
        const next = session.pruneIterator.next();
        if (next.done) {
            session.pruneIterator = null;
            if (session.pruneRequested && session.pruneTimer === null) {
                session.pruneTimer = window.setTimeout(() => runDisconnectedCandidatePrune(session), 0);
            }
            return;
        }
        const candidate = next.value;
        if (!candidate.element.isConnected || candidate.nodes?.some((node) => !node.isConnected)) {
            forgetCandidate(session, candidate);
        }
        if (performance.now() - startedAt >= CANDIDATE_PRUNE_BUDGET_MS) break;
    }

    if (session.pruneIterator && session.pruneTimer === null) {
        session.pruneTimer = window.setTimeout(() => runDisconnectedCandidatePrune(session), 16);
    }
}

function scheduleDisconnectedCandidatePrune(session: FullPageSession): void {
    if (!session.active) return;
    session.pruneRequested = true;
    if (session.pruneTimer !== null || session.pruneIterator) return;
    session.pruneTimer = window.setTimeout(() => runDisconnectedCandidatePrune(session), 0);
}

function discardOwnersRemovedByHost(
    session: FullPageSession,
    removedNodes: readonly Node[],
): {removedAny: boolean; shouldRescan: boolean} {
    const owners = new Set<HTMLElement>();
    let shouldRescan = false;
    removedNodes.forEach((removed) => {
        const syntheticParent = removed.parentElement;
        const syntheticState = syntheticParent?.matches('[data-fr-translation-segment="true"]')
            ? getTranslationState(syntheticParent as HTMLElement)
            : undefined;
        // materializeCandidate moves a direct inline run into an owned segment
        // before MutationObserver delivery. Descendant translation owners remain
        // live in that exact segment and must not be treated as host deletions.
        if (removed.isConnected && syntheticState?.syntheticSegment === true) return;
        getTranslationOwnersForRemovedNode(removed).forEach((owner) => owners.add(owner));
    });
    owners.forEach((owner) => {
        const state = getTranslationState(owner);
        if (!state) return;
        const removedOnlyFailureUi = state.phase === "error" &&
            owner.isConnected &&
            Boolean(state.retryWrapper) &&
            removedNodes.length === 1 &&
            removedNodes[0] === state.retryWrapper;
        const attributeTimer = session.statefulAttributeTimers.get(owner);
        if (attributeTimer !== undefined) {
            window.clearTimeout(attributeTimer);
            session.statefulAttributeTimers.delete(owner);
        }
        session.statefulAttributeRescanTargets.delete(owner);
        if (removedOnlyFailureUi) {
            // Keep an error tombstone. Otherwise a framework that strips our
            // retry child would make the next unrelated mutation auto-request
            // the same permanently failing provider forever.
            removeScheduledForStateTarget(session, owner);
            detachFailedTranslationUi(owner, state);
            return;
        }
        shouldRescan = true;
        removeScheduledForStateTarget(session, owner);
        // A host removal is authoritative. Clear our state/artifacts without
        // reattaching stale source nodes that the framework intentionally removed.
        discardTranslation(owner, state);
    });
    return {removedAny: owners.size > 0, shouldRescan};
}

function restartStatefulTarget(session: FullPageSession, target: HTMLElement): boolean {
    const attributeTimer = session.statefulAttributeTimers.get(target);
    if (attributeTimer !== undefined) {
        window.clearTimeout(attributeTimer);
        session.statefulAttributeTimers.delete(target);
    }
    session.statefulAttributeRescanTargets.delete(target);
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

function scheduleStatefulAttributeReevaluation(
    session: FullPageSession,
    target: HTMLElement,
): void {
    const currentTimer = session.statefulAttributeTimers.get(target);
    if (currentTimer !== undefined) window.clearTimeout(currentTimer);
    const scheduledState = getTranslationState(target);
    const rescanRoot = scheduledState?.syntheticSegment ? target.parentElement : target;

    const timer = window.setTimeout(() => {
        session.statefulAttributeTimers.delete(target);
        if (!session.active) return;
        const state = getTranslationState(target);
        if (!state) {
            if (session.statefulAttributeRescanTargets.has(target) && rescanRoot?.isConnected) {
                session.statefulAttributeRescanTargets.delete(target);
                enqueueFullPageRescan(session, rescanRoot);
            }
            return;
        }
        session.statefulAttributeRescanTargets.delete(target);
        if (!target.isConnected) return;

        // single/control 已经把部分宿主 Text 节点替换成译文，不能按当前
        // 文本值和原文比较；但必须识别 Play/Pause 这类仅靠 class/style
        // 切换两个 label 的控件。比较当前可译 Text 节点身份集合，只有集合
        // 真正变化才恢复/重扫，纯动画 class churn 不会重复请求。
        if (state.kind === "control" || state.mode === "single") {
            const currentNodes = currentStateTextNodes(target, state);
            const previousNodes = state.translatedTextNodes ?? state.sourceTextNodes ?? [];
            if (currentNodes.length === previousNodes.length &&
                currentNodes.every((node, index) => node === previousNodes[index])) return;
            restartStatefulTarget(session, target);
            return;
        }

        const currentSourceText = currentStateSourceText(target, state);
        if (normalizeComparableText(currentSourceText) === normalizeComparableText(state.sourceText)) return;
        restartStatefulTarget(session, target);
    }, STATEFUL_ATTRIBUTE_DEBOUNCE_MS);
    session.statefulAttributeTimers.set(target, timer);
}

function attachFullPageMutationHandling(session: FullPageSession): void {
    session.mutationObserver = new MutationObserver((mutations) => {
        if (!session.active) return;
        scheduleDisconnectedCandidatePrune(session);
        const core = getCurrentTranslationCore();
        for (const mutation of mutations) {
            if (isOwnMutation(mutation)) continue;
            const mutationElement = mutationTargetElement(mutation.target);
            const removedOwners = mutation.type === "childList"
                ? discardOwnersRemovedByHost(session, Array.from(mutation.removedNodes))
                : {removedAny: false, shouldRescan: false};
            if (removedOwners.shouldRescan && mutationElement) enqueueFullPageRescan(session, mutationElement);
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
                enqueueFullPageRescan(session, mutation.target);

                // Scanning the mutation target already includes every added
                // descendant. Enqueuing each child separately turns one React
                // commit into dozens of redundant dirty roots.
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
                    if (mutation.attributeName === "class" || mutation.attributeName === "style") {
                        scheduleStatefulAttributeReevaluation(session, target);
                    } else {
                        restartStatefulTarget(session, target);
                    }
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
    if (fullPageSession.pruneTimer !== null) window.clearTimeout(fullPageSession.pruneTimer);
    fullPageSession.statefulAttributeTimers.forEach((timer) => window.clearTimeout(timer));
    fullPageSession.observer.disconnect();
    fullPageSession.mutationObserver.disconnect();
    fullPageSession.shadowEventController.abort();
    fullPageSession.pending.clear();
    fullPageSession.scheduled.clear();
    fullPageSession.observedCandidates.clear();
    fullPageSession.dirtyRoots.clear();
    fullPageSession.dirtyRootsBroadMode = false;
    fullPageSession.activeDiscovery = null;
    fullPageSession.pruneIterator = null;
    fullPageSession.pruneRequested = false;
    fullPageSession.statefulAttributeTimers.clear();
    fullPageSession.statefulAttributeRescanTargets = new WeakSet();
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
        broadRescanRoots: new WeakSet([root]),
        broadRescanCooldowns: new WeakMap(),
        dirtyRootsBroadMode: false,
        pruneTimer: null,
        pruneIterator: null,
        pruneRequested: false,
        statefulAttributeTimers: new Map(),
        statefulAttributeRescanTargets: new WeakSet(),
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

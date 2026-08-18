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
    evaluateHardGuard,
    getComposedParent,
    getCurrentTranslationCore,
    getOpenShadowRoots,
    getTranslationCandidateKey,
    isClearlyTargetLanguage,
    isProtectedDescendantElement,
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

type TranslationTargetOutcome =
    | {status: "committed" | "failed" | "owned"}
    | {status: "unchanged"; source: string; attemptNode?: HTMLElement}
    | {
        status: "stale" | "not-current" | "empty";
        retryRoot?: Node;
        /** Attempt owner used to reject retries after a newer generation took over. */
        attemptNode?: HTMLElement;
    };

interface FullPageLifecycleRetry {
    owner: HTMLElement;
    source: string;
    kind: TranslationCandidate["kind"];
    reason: string;
    attempts: number;
}

interface SnapshotTranslationResult {
    kind: "snapshot";
    sources: readonly string[];
    translations: readonly string[];
}

interface LiveTextTranslationResult {
    kind: "live-text";
    complete: boolean;
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
    /** Visibility anchor -> candidates waiting for that anchor to enter the viewport. */
    observedCandidates: Map<HTMLElement, Map<Node, TranslationCandidate>>;
    /** Candidate key -> its actual IntersectionObserver target (which can be a descendant). */
    candidateAnchors: Map<Node, HTMLElement>;
    /** Candidate element -> candidate keys, kept separate from visibility anchors for cleanup. */
    candidateOwnerKeys: Map<HTMLElement, Set<Node>>;
    /** Host owner/ancestor -> active translation targets below it, avoiding a global state scan on mutations. */
    statefulTargetsByAncestor: Map<Element, Set<HTMLElement>>;
    /** Active target -> the exact ancestor keys registered above. */
    statefulAncestorsByTarget: WeakMap<HTMLElement, readonly Element[]>;
    /** Bounded immediate retries for candidates invalidated while a provider request is in flight. */
    lifecycleRetries: WeakMap<Node, FullPageLifecycleRetry>;
    /** Explicit provider/language no-change decisions, scoped to this full-page session. */
    unchangedCandidates: WeakMap<Node, FullPageLifecycleRetry>;
    /** Candidate keys currently consuming one of the full-page concurrency slots. */
    inFlightCandidates: Map<Node, TranslationCandidate>;
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
const FULL_PAGE_LIFECYCLE_RETRY_LIMIT = 2;

let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let fullPageSession: FullPageSession | null = null;
/** Exact direct children owned by one materialized inline-run request, before its spinner is appended. */
const loadingSyntheticSourceNodes = new WeakMap<TranslationState, readonly ChildNode[]>();

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

function statefulSourceAndTextSlotsAreCurrent(
    node: HTMLElement,
    state: TranslationState,
): boolean {
    const currentNodes = currentStateTextNodes(node, state);
    const previousNodes = state.translatedTextNodes ?? state.sourceTextNodes ?? [];
    if (currentNodes.length !== previousNodes.length ||
        currentNodes.some((textNode, index) => textNode !== previousNodes[index])) return false;

    // single/control replace the live Text values themselves. Their logical
    // source is still current only while every captured slot keeps both its
    // identity and the exact value written by this generation.
    if ((state.kind === "control" || state.mode === "single") && state.textSlotsApplied) {
        return currentNodes.every((textNode) =>
            state.translatedTextValues?.get(textNode) === (textNode.nodeValue ?? ""));
    }

    return normalizeComparableText(currentStateSourceText(node, state)) ===
        normalizeComparableText(state.sourceText);
}

function mutationTouchesCurrentTranslationArtifact(
    mutation: MutationRecord,
    state: TranslationState,
): boolean {
    const artifacts = [state.spinner, state.bilingualContent, state.retryWrapper]
        .filter((node): node is HTMLElement => Boolean(node));
    if (artifacts.length === 0) return false;

    // The stateful host necessarily contains its current artifact, so containment
    // in this direction must only apply to added/removed subtrees. For the
    // mutation target itself, only the artifact or one of its descendants is a
    // tamper; an ordinary direct-host childList is not.
    if (artifacts.some((artifact) =>
        mutation.target === artifact || artifact.contains(mutation.target))) return true;
    return [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)]
        .some((node) => artifacts.some((artifact) =>
            node === artifact || artifact.contains(node) ||
            (isElementNode(node) && node.contains(artifact))));
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
        complete: false,
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
        complete: translations.length === origins.length,
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
): Node | undefined {
    const rescanRoot = state.syntheticSegment ? node.parentElement : node;
    if (getTranslationState(node) === state) discardTranslation(node, state);
    return rescanRoot?.isConnected ? rescanRoot : undefined;
}

function markFailedTranslation(
    node: HTMLElement,
    attempt: NonNullable<ReturnType<typeof beginTranslation>>,
    spinner: HTMLElement | undefined,
    error: unknown,
): TranslationTargetOutcome {
    spinner?.remove();
    if (!node.isConnected ||
        !attemptSourceIsCurrent(node, attempt.state) ||
        !markTranslationError(node, attempt.state, attempt.generation, false)) {
        return {
            status: "stale",
            retryRoot: discardStaleAttempt(node, attempt.state),
            attemptNode: node,
        };
    }
    const retryWrapper = insertFailedTip(
        node,
        error instanceof Error ? error.message : String(error || "翻译失败"),
        spinner,
    );
    setRetryWrapper(node, retryWrapper);
    setRenderedStyleAttribute(node);
    return {status: "failed"};
}

async function renderTranslation(
    node: HTMLElement,
    candidate: TranslationCandidate,
    attempt: NonNullable<ReturnType<typeof beginTranslation>>,
    request: Promise<TranslationResult>,
): Promise<TranslationTargetOutcome> {
    const { state, generation } = attempt;
    const spinner = state.spinner;

    const staleOutcome = (): TranslationTargetOutcome => ({
        status: "stale",
        retryRoot: discardStaleAttempt(node, state),
        attemptNode: node,
    });

    try {
        const result = await request;
        spinner?.remove();

        // A target can keep identical text while class/role/visibility changes
        // move ownership to a different semantic block. Revalidate the original
        // owner before committing; synthetic inline runs are validated by their
        // exact Text-node identities below because materialization moved them.
        if (!node.isConnected || !attemptSourceIsCurrent(node, state) ||
            (!candidate.nodes?.length && !candidateIsCurrent(candidate))) return staleOutcome();

        if (result.kind === "live-text") {
            const liveResult = result;
            if (!liveResult.complete) {
                discardTranslation(node, state);
                return {status: "empty", retryRoot: node.isConnected ? node : undefined, attemptNode: node};
            }
            if (!liveResult.changed) {
                discardTranslation(node, state);
                return liveResult.nodes.length === 0
                    ? {status: "empty", retryRoot: node.isConnected ? node : undefined, attemptNode: node}
                    : {status: "unchanged", source: state.sourceText, attemptNode: node};
            }
            const currentNodes = currentStateTextNodes(node, state);
            if (currentNodes.length !== liveResult.nodes.length ||
                currentNodes.some((textNode, index) => textNode !== liveResult.nodes[index])) {
                return staleOutcome();
            }
            if (!markTranslationComplete(node, state, generation, false)) {
                return staleOutcome();
            }
            liveResult.apply();
            setTextSlotsApplied(node, liveResult.nodes);
            return {status: "committed"};
        }

        if (result.sources.length === 0 || result.translations.length !== result.sources.length) {
            discardTranslation(node, state);
            return {status: "empty", retryRoot: node.isConnected ? node : undefined, attemptNode: node};
        }
        if (!result.translations.some((translation, index) =>
            normalizeComparableText(translation) !== normalizeComparableText(result.sources[index] ?? ""))) {
            discardTranslation(node, state);
            return {status: "unchanged", source: state.sourceText, attemptNode: node};
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
            return staleOutcome();
        }
        const translatedText = applyTranslationsToSnapshot(freshSnapshot, result.translations);
        if (!markTranslationComplete(node, state, generation, false)) {
            return staleOutcome();
        }

        const content = appendBilingualTranslation(node, translatedText);
        setBilingualContent(node, content);
        setRenderedStyleAttribute(node);
        return {status: "committed"};
    } catch (error) {
        return markFailedTranslation(node, attempt, spinner, error);
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

function hasIntersectionLayoutBox(element: HTMLElement): boolean {
    if (typeof element.getClientRects !== "function") return false;
    try {
        const rects = element.getClientRects();
        for (let index = 0; index < rects.length; index += 1) {
            const rect = rects[index];
            if (rect && rect.width > 0 && rect.height > 0) return true;
        }
    } catch {
        // Detached/custom elements can throw while their layout is being rebuilt.
    }
    return false;
}

/**
 * IntersectionObserver cannot reliably wake targets which generate no layout
 * box (notably `display: contents`). Prefer the candidate itself when it has a
 * box, then walk non-extension descendants in document order. If no element can
 * act as an anchor the caller queues the candidate directly; concurrency is
 * still enforced by the normal full-page drain.
 */
export function resolveFullPageVisibilityAnchor(candidate: HTMLElement): HTMLElement | null {
    if (hasIntersectionLayoutBox(candidate)) return candidate;

    const pending: Element[] = [];
    const pushChildrenInReverse = (container: ParentNode) => {
        for (let index = container.children.length - 1; index >= 0; index -= 1) {
            const child = container.children.item(index);
            if (child) pending.push(child);
        }
    };
    pushChildrenInReverse(candidate);

    while (pending.length > 0) {
        const element = pending.pop();
        if (!element || element.matches(TRANSLATION_ARTIFACT_SELECTOR)) continue;
        const htmlElement = asHTMLElement(element);
        if (htmlElement && hasIntersectionLayoutBox(htmlElement)) return htmlElement;

        // Open shadow content participates in full-page translation as its own
        // observed root, but it can also be the only rendered box of a host.
        // Push light children first so shadow children are visited first by LIFO.
        pushChildrenInReverse(element);
        if (element.shadowRoot) pushChildrenInReverse(element.shadowRoot);
    }
    return null;
}

function removeCandidateObservation(session: FullPageSession, key: Node): void {
    const anchor = session.candidateAnchors.get(key);
    if (!anchor) return;
    session.candidateAnchors.delete(key);
    const observed = session.observedCandidates.get(anchor);
    observed?.delete(key);
    if (observed?.size === 0) {
        session.observedCandidates.delete(anchor);
        session.observer.unobserve(anchor);
    }
}

function addCandidateOwnerKey(session: FullPageSession, owner: HTMLElement, key: Node): void {
    let keys = session.candidateOwnerKeys.get(owner);
    if (!keys) {
        keys = new Set();
        session.candidateOwnerKeys.set(owner, keys);
    }
    keys.add(key);
}

function removeCandidateOwnerKey(session: FullPageSession, owner: HTMLElement, key: Node): void {
    const keys = session.candidateOwnerKeys.get(owner);
    keys?.delete(key);
    if (keys?.size === 0) session.candidateOwnerKeys.delete(owner);
}

function unregisterSessionStatefulTarget(session: FullPageSession | undefined, target: HTMLElement): void {
    if (!session) return;
    const ancestors = session.statefulAncestorsByTarget.get(target);
    if (!ancestors) return;
    session.statefulAncestorsByTarget.delete(target);
    for (const ancestor of ancestors) {
        const targets = session.statefulTargetsByAncestor.get(ancestor);
        targets?.delete(target);
        if (targets?.size === 0) session.statefulTargetsByAncestor.delete(ancestor);
    }
}

function registerSessionStatefulTarget(
    session: FullPageSession | undefined,
    candidateOwner: HTMLElement,
    target: HTMLElement,
): void {
    if (!session?.active) return;
    unregisterSessionStatefulTarget(session, target);
    const ancestors: Element[] = [];
    let current: Element | null = candidateOwner;
    let depth = 0;
    while (current && depth < 512) {
        depth += 1;
        ancestors.push(current);
        let targets = session.statefulTargetsByAncestor.get(current);
        if (!targets) {
            targets = new Set();
            session.statefulTargetsByAncestor.set(current, targets);
        }
        targets.add(target);
        current = getComposedParent(current);
    }
    session.statefulAncestorsByTarget.set(target, ancestors);
}

function refreshCandidateVisibilityBinding(
    session: FullPageSession,
    key: Node,
    candidate: TranslationCandidate,
): void {
    const target = asHTMLElement(candidate.element);
    const nextAnchor = target?.isConnected ? resolveFullPageVisibilityAnchor(target) : null;
    const currentAnchor = session.candidateAnchors.get(key) ?? null;

    if (currentAnchor === nextAnchor && (nextAnchor !== null || session.pending.has(key))) return;
    removeCandidateObservation(session, key);

    if (!nextAnchor) {
        // Keep an already-visible candidate pending while its display:contents
        // subtree is being rebuilt. If it was still waiting on the old anchor,
        // direct scheduling is the only visibility-safe fallback.
        if (!session.pending.has(key)) session.pending.set(key, candidate);
        scheduleFullPageDrain(session);
        return;
    }

    let observed = session.observedCandidates.get(nextAnchor);
    if (!observed) {
        observed = new Map();
        session.observedCandidates.set(nextAnchor, observed);
    }
    observed.set(key, candidate);
    session.candidateAnchors.set(key, nextAnchor);
    session.observer.observe(nextAnchor);
}

function forgetCandidate(session: FullPageSession | undefined, candidate: TranslationCandidate): void {
    if (!session) return;
    const key = getTranslationCandidateKey(candidate);
    if (session.pending.get(key) === candidate) session.pending.delete(key);
    if (session.scheduled.get(key) !== candidate) return;
    session.scheduled.delete(key);
    removeCandidateObservation(session, key);
    removeCandidateOwnerKey(session, candidate.element, key);
}

async function translateTarget(
    candidate: TranslationCandidate,
    displayMode: "bilingual" | "single",
    slide: boolean,
    owner?: FullPageSession,
): Promise<TranslationTargetOutcome> {
    if (!candidate.element.isConnected) {
        return {status: "not-current"};
    }

    const statefulSession = owner?.active
        ? owner
        : fullPageSession?.active ? fullPageSession : undefined;
    const existingNode = candidate.nodes?.length ? null : candidate.element;
    const current = existingNode ? getTranslationState(existingNode) : undefined;
    if (current?.phase === "loading") return {status: "owned"};
    if (current?.phase === "translated") {
        // 滑动触发只对当前鼠标下的新目标翻译，不在移动过程中反复恢复原文。
        if (!slide && existingNode) {
            unregisterSessionStatefulTarget(statefulSession, existingNode);
            restoreTranslation(existingNode);
        }
        return {status: "committed"};
    }
    if (current?.phase === "error" && existingNode) {
        if (current.syntheticSegment) {
            const sourceNodes = Array.from(existingNode.childNodes).filter((node) =>
                !isElementNode(node) || !node.matches('[data-fr-translation-owned="true"]'),
            );
            const sourceAnchor = sourceNodes.find((node) =>
                normalizeComparableText(node.textContent ?? node.nodeValue ?? "").length > 0,
            ) ?? sourceNodes[0];
            const retryRoot = existingNode.parentElement ?? undefined;
            unregisterSessionStatefulTarget(statefulSession, existingNode);
            restoreTranslation(existingNode);
            if (!sourceAnchor?.isConnected) return {status: "not-current", retryRoot};
            const refreshedCandidate = getCurrentTranslationCore().resolve(sourceAnchor);
            if (!refreshedCandidate) return {status: "not-current", retryRoot};
            return translateTarget(refreshedCandidate, displayMode, slide, owner);
        }
        unregisterSessionStatefulTarget(statefulSession, existingNode);
        restoreTranslation(existingNode);
    }

    if (!candidateIsCurrent(candidate)) {
        return {
            status: "not-current",
            retryRoot: candidate.element.isConnected ? candidate.element : undefined,
        };
    }

    const core = getCurrentTranslationCore();
    const sourceText = candidate.nodes?.length
        ? extractTranslationTextFromNodes(candidate.nodes, core.shouldStayOriginal)
        : extractTranslationText(candidate.element, core.shouldStayOriginal);
    if (!normalizeComparableText(sourceText)) {
        return {
            status: "empty",
            retryRoot: candidate.element.isConnected ? candidate.element : undefined,
        };
    }

    // 短 UI 文案只做确定性的 script 判断；统计检测至少需要一段可读文本，
    // 否则 GitHub 的短标题/按钮很容易被 franc 误判后静默漏译。
    if (isClearlyTargetLanguage(sourceText, config.to)) return {status: "unchanged", source: sourceText};
    try {
        const detected = sourceText.length >= 20 ? detectlang(normalizeComparableText(sourceText)) : '';
        if (detected && detected === config.to) return {status: "unchanged", source: sourceText};
    } catch {
        // 语言检测只是优化，不影响正常翻译流程。
    }

    const materialized = materializeCandidate(candidate);
    if (!materialized) {
        return {
            status: "not-current",
            retryRoot: candidate.element.isConnected ? candidate.element : undefined,
        };
    }
    const {node, synthetic} = materialized;

    const kind = candidate.kind;
    // Capture every candidate's exact translatable Text-node identities. A
    // renderer can replace only a protected MathJax/KaTeX child after commit;
    // source equality alone cannot distinguish that harmless transaction from
    // a same-text host/link replacement which makes the rendered snapshot old.
    const sourceTextNodes = collectLiveTranslationTextSlots(
        node,
        core.shouldStayOriginal,
        synthetic ? node : undefined,
    ).map((slot) => slot.node);
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
        return {status: "owned"};
    }
    if (synthetic) loadingSyntheticSourceNodes.set(attempt.state, Array.from(node.childNodes));

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
    registerSessionStatefulTarget(statefulSession, candidate.element, node);
    const outcome = await renderTranslation(node, candidate, attempt, request);
    if (outcome.status === "stale" || outcome.status === "not-current" ||
        outcome.status === "empty" || outcome.status === "unchanged") {
        unregisterSessionStatefulTarget(statefulSession, node);
    }
    return outcome;
}

function candidateLifecycleSource(candidate: TranslationCandidate): string {
    try {
        const core = getCurrentTranslationCore();
        return normalizeComparableText(candidate.nodes?.length
            ? extractTranslationTextFromNodes(candidate.nodes, core.shouldStayOriginal)
            : extractTranslationText(candidate.element, core.shouldStayOriginal));
    } catch {
        return normalizeComparableText(candidate.element.textContent ?? "");
    }
}

function createLifecycleRetry(
    candidate: TranslationCandidate,
    source: string,
    attempts: number,
): FullPageLifecycleRetry {
    return {
        owner: candidate.element,
        source: normalizeComparableText(source),
        kind: candidate.kind,
        reason: candidate.reason,
        attempts,
    };
}

function sameLifecycleRetry(
    previous: FullPageLifecycleRetry | undefined,
    candidate: TranslationCandidate,
    source: string,
): boolean {
    return Boolean(previous &&
        previous.owner === candidate.element &&
        previous.source === source &&
        previous.kind === candidate.kind &&
        previous.reason === candidate.reason);
}

function resolveFullPageRetryCandidate(
    candidate: TranslationCandidate,
    retryRoot?: Node,
): TranslationCandidate | null {
    const core = getCurrentTranslationCore();
    const key = getTranslationCandidateKey(candidate);
    const starts = [retryRoot, key, candidate.element];
    const visited = new Set<Node>();

    for (const start of starts) {
        if (!start || visited.has(start) || !start.isConnected) continue;
        visited.add(start);
        const fresh = core.resolve(start);
        if (fresh?.element.isConnected) return fresh;
    }

    if (!candidate.element.isConnected) return null;
    return core.inspect(candidate.element).candidate ?? null;
}

function finalizeFullPageCandidate(
    session: FullPageSession,
    candidate: TranslationCandidate,
    outcome: TranslationTargetOutcome,
): void {
    const originalKey = getTranslationCandidateKey(candidate);

    // A mutation restart or a newer discovery generation may already have
    // replaced this scheduled entry. The old provider completion cannot delete
    // or enqueue work for that newer owner.
    if (!session.active || fullPageSession !== session || session.scheduled.get(originalKey) !== candidate) return;

    if (outcome.status !== "stale" && outcome.status !== "not-current" && outcome.status !== "empty") {
        session.lifecycleRetries.delete(originalKey);
        if (outcome.status === "unchanged") {
            if (outcome.attemptNode && session.statefulAttributeTimers.has(outcome.attemptNode)) {
                session.statefulAttributeRescanTargets.add(outcome.attemptNode);
            }
            session.unchangedCandidates.set(
                originalKey,
                createLifecycleRetry(candidate, outcome.source, 0),
            );
        } else {
            session.unchangedCandidates.delete(originalKey);
        }
        forgetCandidate(session, candidate);
        return;
    }

    session.unchangedCandidates.delete(originalKey);

    // A new hover/full generation owns the same node already. Its own completion
    // is authoritative, so the stale generation must not issue a duplicate.
    if (outcome.attemptNode && getTranslationState(outcome.attemptNode)) {
        session.lifecycleRetries.delete(originalKey);
        forgetCandidate(session, candidate);
        return;
    }

    // Class/style changes are deliberately debounced by the mutation pipeline.
    // Preserve that single rescan instead of racing it with an immediate retry.
    if (outcome.attemptNode && session.statefulAttributeTimers.has(outcome.attemptNode)) {
        session.statefulAttributeRescanTargets.add(outcome.attemptNode);
        forgetCandidate(session, candidate);
        return;
    }

    const fresh = resolveFullPageRetryCandidate(candidate, outcome.retryRoot);
    const retryCandidate = fresh ?? candidate;
    const retryKey = fresh ? getTranslationCandidateKey(fresh) : originalKey;
    const source = candidateLifecycleSource(retryCandidate);
    const previous = session.lifecycleRetries.get(retryKey) ?? session.lifecycleRetries.get(originalKey);
    const attempts = sameLifecycleRetry(previous, retryCandidate, source)
        ? previous!.attempts + 1
        : 1;
    const retryState = createLifecycleRetry(retryCandidate, source, attempts);

    if (retryKey !== originalKey) session.lifecycleRetries.delete(originalKey);
    session.unchangedCandidates.delete(retryKey);
    session.lifecycleRetries.set(retryKey, retryState);
    forgetCandidate(session, candidate);

    if (attempts > FULL_PAGE_LIFECYCLE_RETRY_LIMIT) return;

    if (fresh) {
        scheduleDiscoveredCandidate(session, fresh);
        if (session.scheduled.get(retryKey) === fresh) {
            // The original candidate has already crossed the visibility gate.
            // Retry the freshly resolved owner directly; observing it again can
            // otherwise wait forever when IntersectionObserver does not re-emit.
            session.pending.set(retryKey, fresh);
            scheduleFullPageDrain(session);
        }
        return;
    }

    if (outcome.retryRoot?.isConnected) enqueueFullPageRescan(session, outcome.retryRoot);
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
        let entry: [Node, TranslationCandidate] | undefined;
        for (const pendingEntry of session.pending.entries()) {
            if (!session.inFlightCandidates.has(pendingEntry[0])) {
                entry = pendingEntry;
                break;
            }
        }
        if (!entry) break;
        const [key, candidate] = entry;
        session.pending.delete(key);
        session.inFlightCandidates.set(key, candidate);
        session.inFlight += 1;
        void translateTarget(candidate, config.display === styles.bilingualTranslation ? "bilingual" : "single", true, session)
            .then(
                (outcome) => {
                    session.inFlight -= 1;
                    if (session.inFlightCandidates.get(key) === candidate) {
                        session.inFlightCandidates.delete(key);
                    }
                    finalizeFullPageCandidate(session, candidate, outcome);
                },
                () => {
                    session.inFlight -= 1;
                    if (session.inFlightCandidates.get(key) === candidate) {
                        session.inFlightCandidates.delete(key);
                    }
                    // Unexpected runtime failures retain the historical terminal
                    // behavior; provider failures are represented explicitly by
                    // translateTarget and render their retry UI before this point.
                    forgetCandidate(session, candidate);
                },
            )
            .finally(() => {
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
        // Hover can commit this state before the full-page session exists. Add
        // it to this session's observer-only ancestor index without replacing
        // the state's generation/controller ownership, so ancestor hard guards
        // still restore it and normal session teardown can drop the index.
        registerSessionStatefulTarget(session, candidate.element, target);
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

    const unchanged = session.unchangedCandidates.get(key);
    const cappedRetry = session.lifecycleRetries.get(key);
    if (unchanged || (cappedRetry && cappedRetry.attempts > FULL_PAGE_LIFECYCLE_RETRY_LIMIT)) {
        const source = candidateLifecycleSource(candidate);
        if (sameLifecycleRetry(unchanged ?? cappedRetry, candidate, source)) return;
        session.unchangedCandidates.delete(key);
        session.lifecycleRetries.delete(key);
    }

    // The exact descendant may already have finished while a very large
    // ancestor is still being discovered in later frame slices. Its scheduled
    // entry is intentionally forgotten after completion, so also consult the
    // state attached to the shared key before accepting a late generic run.
    const keyedTarget = asHTMLElement(key);
    if (keyedTarget && getTranslationState(keyedTarget)) {
        registerSessionStatefulTarget(session, candidate.element, keyedTarget);
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
        if (selectPreferredTranslationCandidate(existing, candidate) === existing) {
            // A stable candidate can outlive the rendered descendant used as
            // its IO target. Hydration and display changes must refresh that
            // anchor without replacing scheduled/pending ownership.
            refreshCandidateVisibilityBinding(session, key, existing);
            return;
        }
        removeCandidateObservation(session, key);
        removeCandidateOwnerKey(session, existing.element, key);
        if (session.pending.has(key)) session.pending.set(key, candidate);
    }
    session.scheduled.set(key, candidate);
    addCandidateOwnerKey(session, target, key);
    refreshCandidateVisibilityBinding(session, key, candidate);
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
            const statefulStepState = statefulStepTarget
                ? getTranslationState(statefulStepTarget)
                : undefined;
            if (statefulStepTarget && statefulStepState) {
                const candidateOwner = statefulStepState.syntheticSegment
                    ? asHTMLElement(statefulStepTarget.parentElement) ?? statefulStepTarget
                    : statefulStepTarget;
                registerSessionStatefulTarget(session, candidateOwner, statefulStepTarget);
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

/**
 * Renderer/code/no-translate descendants are atomic host-owned regions. Their
 * internal churn must not invalidate the translated prose ancestor. Attribute
 * changes intentionally exclude the mutation target itself: adding/removing a
 * protection marker must restore/reclassify the old translation, while style
 * churn on an already-protected root reaches the debounced source-slot check.
 * Extension artifacts are deliberately excluded: isOwnMutation runs first,
 * and host tampering inside a wrapper must continue through the stale path.
 */
function isCoreProtectedDescendantMutation(
    node: Node,
    core: ReturnType<typeof getCurrentTranslationCore>,
    includeSelf = true,
): boolean {
    const element = mutationTargetElement(node);
    if (!element || isTranslationArtifact(element)) return false;
    const statefulTarget = resolveStatefulMutationTarget(element);
    if (statefulTarget === element) return false;
    if (evaluateHardGuard(element).reason === 'ancestor-depth-limit') return true;

    let current: Element | null = includeSelf ? element : getComposedParent(element);
    while (current && current !== statefulTarget) {
        if (isProtectedDescendantElement(current) || core.shouldStayOriginal(current)) return true;
        current = getComposedParent(current);
    }
    return false;
}

/**
 * Materializing an inline run moves its source nodes into a synthetic span and
 * then appends one loading spinner. Those real childList records are delivered
 * after beginTranslation, while an asynchronous provider is still pending.
 * Accept them only while the exact source ownership, HTML and Text-slot
 * identities captured for this generation remain intact. A host insertion --
 * including a lookalike FluentRead artifact -- necessarily fails one of these
 * checks and continues through the stale/restart path.
 */
function isIntactLoadingSyntheticChildList(
    target: HTMLElement,
    state: TranslationState,
): boolean {
    if (!state.syntheticSegment || !target.matches('[data-fr-translation-segment="true"]')) return false;
    const spinner = state.spinner;
    if (!spinner || spinner.parentNode !== target || !spinner.matches('[data-fr-translation-owned="true"]')) {
        return false;
    }

    const expectedSourceNodes = loadingSyntheticSourceNodes.get(state);
    if (!expectedSourceNodes) return false;
    const currentSourceNodes = Array.from(target.childNodes).filter((node) => node !== spinner);
    if (currentSourceNodes.length !== expectedSourceNodes.length ||
        currentSourceNodes.some((node, index) => node !== expectedSourceNodes[index])) return false;

    const artifacts = Array.from(target.querySelectorAll(TRANSLATION_ARTIFACT_SELECTOR));
    if (artifacts.length !== 1 || artifacts[0] !== spinner) return false;

    const sourceClone = target.cloneNode(false) as HTMLElement;
    currentSourceNodes.forEach((node) => sourceClone.appendChild(node.cloneNode(true)));
    if (sourceClone.innerHTML !== state.sourceHTML) return false;

    const expectedTextNodes = state.sourceTextNodes ?? [];
    const currentTextNodes = currentStateTextNodes(target, state);
    return currentTextNodes.length === expectedTextNodes.length &&
        currentTextNodes.every((node, index) => node === expectedTextNodes[index]);
}

function isOwnMutation(
    mutation: MutationRecord,
    loadingSyntheticChecks: WeakMap<TranslationState, boolean>,
): boolean {
    // 不能用“位于任意插件节点内”作为判断：站点可能直接改写双语 wrapper
    // 的文本，必须让这类 mutation 进入 stale/retranslate 分支。加载/错误节点
    // 没有宿主正文，才可以直接视为插件自身变化。
    if (mutation.type !== "childList" &&
        isElementNode(mutation.target) &&
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
                mutationElement === target &&
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
        if (mutation.type === "childList" && mutationElement === target) {
            const cached = loadingSyntheticChecks.get(state);
            if (cached !== undefined) return cached;
            const intact = isIntactLoadingSyntheticChildList(target, state);
            loadingSyntheticChecks.set(state, intact);
            return intact;
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
        const keys = session.candidateOwnerKeys.get(element);
        if (!keys) continue;
        for (const key of Array.from(keys)) {
            const candidate = session.scheduled.get(key);
            if (!candidate) continue;
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
        } else {
            const key = getTranslationCandidateKey(candidate);
            const anchor = session.candidateAnchors.get(key);
            if (anchor && !anchor.isConnected) {
                refreshCandidateVisibilityBinding(session, key, candidate);
            }
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
        if (!state) {
            unregisterSessionStatefulTarget(session, owner);
            return;
        }
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
        unregisterSessionStatefulTarget(session, owner);
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
    unregisterSessionStatefulTarget(session, target);
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

        // Compare both the logical source and exact slot identities. This keeps
        // pure class/style churn cheap while still detecting same-text label or
        // inline-link replacement. Live single/control slots are compared with
        // the values written by this generation rather than their old source.
        if (statefulSourceAndTextSlotsAreCurrent(target, state)) return;
        restartStatefulTarget(session, target);
    }, STATEFUL_ATTRIBUTE_DEBOUNCE_MS);
    session.statefulAttributeTimers.set(target, timer);
}

function resolveStatefulMutationTargets(
    session: FullPageSession,
    element: Element,
): HTMLElement[] {
    const targets = new Set<HTMLElement>();
    const direct = resolveStatefulMutationTarget(element);
    if (direct) targets.add(direct);
    const descendants = session.statefulTargetsByAncestor.get(element);
    if (descendants) {
        for (const target of Array.from(descendants)) {
            if (getTranslationState(target)) targets.add(target);
            else unregisterSessionStatefulTarget(session, target);
        }
    }
    return [...targets];
}

function attachFullPageMutationHandling(session: FullPageSession): void {
    session.mutationObserver = new MutationObserver((mutations) => {
        if (!session.active) return;
        scheduleDisconnectedCandidatePrune(session);
        const core = getCurrentTranslationCore();
        // Materializing a wide inline run can enqueue one childList record per
        // moved source node. Its exact snapshot is stable for this callback, so
        // validate each loading generation once instead of cloning O(records).
        const loadingSyntheticChecks = new WeakMap<TranslationState, boolean>();
        // MathJax v2 can emit hundreds of direct-parent records in one callback.
        // The live DOM is already at the callback's final state, so compare each
        // stateful source/slot snapshot once instead of walking a long P for
        // every Preview <-> staging-span record.
        const statefulChildListChecks = new WeakMap<TranslationState, boolean>();
        for (const mutation of mutations) {
            if (isOwnMutation(mutation, loadingSyntheticChecks)) continue;
            const mutationElement = mutationTargetElement(mutation.target);
            if (isCoreProtectedDescendantMutation(mutation.target, core, mutation.type !== "attributes")) continue;
            const removedOwners = mutation.type === "childList"
                ? discardOwnersRemovedByHost(session, Array.from(mutation.removedNodes))
                : {removedAny: false, shouldRescan: false};
            if (removedOwners.shouldRescan && mutationElement) enqueueFullPageRescan(session, mutationElement);
            if (mutationElement && core.shouldIgnoreMutation(mutationElement)) continue;

            if (mutation.type === "childList") {
                const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
                // Normal extension insertion/removal targets the host owner. If
                // the mutation target is inside an artifact, isOwnMutation has
                // already compared every available state snapshot; treating its
                // newly appended children as artifacts again would hide host
                // tampering inside bilingual/loading/retry wrappers.
                if (!isTranslationArtifact(mutation.target) &&
                    changedNodes.length > 0 && changedNodes.every((node) => {
                        if (isTranslationArtifact(node)) return true;
                        const element = isElementNode(node) ? node : node.parentElement;
                        return isCoreProtectedDescendantMutation(node, core) ||
                            Boolean(element && core.shouldIgnoreMutation(element));
                    })) continue;
            }

            if (mutation.type === "childList") {
                const changedTarget = mutationElement ? resolveStatefulMutationTarget(mutationElement) : false;
                const changedState = changedTarget ? getTranslationState(changedTarget) : undefined;

                // A direct host childList may be only a protected renderer
                // transaction. Preserve loading/error/translated ownership when
                // the translatable source and exact Text slots are unchanged;
                // the old behavior removed a committed wrapper after MathJax v2
                // swapped a detached, classless staging span at the parent P.
                // Mutations inside or removing our current artifact remain
                // authoritative host tampering and restart immediately.
                if (changedTarget && changedState) {
                    const touchesArtifact = isTranslationArtifact(mutation.target) ||
                        mutationTouchesCurrentTranslationArtifact(mutation, changedState);
                    let sourceAndSlotsCurrent = statefulChildListChecks.get(changedState);
                    if (sourceAndSlotsCurrent === undefined) {
                        sourceAndSlotsCurrent = statefulSourceAndTextSlotsAreCurrent(changedTarget, changedState);
                        statefulChildListChecks.set(changedState, sourceAndSlotsCurrent);
                    }
                    if (touchesArtifact || !sourceAndSlotsCurrent) {
                        restartStatefulTarget(session, changedTarget);
                    }
                }

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

                const targets = resolveStatefulMutationTargets(session, mutationElement);
                if (targets.length > 0) {
                    for (const target of targets) {
                        if (mutation.attributeName === "class" || mutation.attributeName === "style") {
                            scheduleStatefulAttributeReevaluation(session, target);
                        } else {
                            restartStatefulTarget(session, target);
                        }
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
    fullPageSession.candidateAnchors.clear();
    fullPageSession.candidateOwnerKeys.clear();
    fullPageSession.statefulTargetsByAncestor.clear();
    fullPageSession.statefulAncestorsByTarget = new WeakMap();
    fullPageSession.inFlightCandidates.clear();
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
        candidateAnchors: new Map(),
        candidateOwnerKeys: new Map(),
        statefulTargetsByAncestor: new Map(),
        statefulAncestorsByTarget: new WeakMap(),
        lifecycleRetries: new WeakMap(),
        unchangedCandidates: new WeakMap(),
        inFlightCandidates: new Map(),
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

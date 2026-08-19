import {
    composedAncestors,
    evaluateElementHardGuard,
    evaluateHardGuard,
    findElementsAtPoint,
    findNodeAtPoint,
    getComposedParent,
    isDocumentSurface,
    isExtensionElementSelf,
    maxComposedAncestorDepth,
} from './dom';
import type {HardGuardResult} from './dom';
import {
    classifyGenericCandidate,
    getDirectInlineRuns,
    hasStructuralAncestor,
    isBlockBoundary,
    isSemanticHeadingElement,
    isStructuralContainer,
    isTranslationControlElement,
} from './layout';
import {
    createTranslationTextProtectionCache,
    hasMeaningfulTranslationTextInNodes,
    isTranslationTextElementProtected,
} from './text';
import type {TranslationTextProtectionCache} from './text';
import type {
    AdapterContext,
    AdapterDecision,
    TranslationCandidate,
    TranslationCoreOptions,
    TranslationSiteAdapter,
} from './types';

const maxHoverBarrierDiscoverySteps = 256;

interface AdapterDecisionResult {
    decision: AdapterDecision;
    adapterId?: string;
}

interface AdapterPrunedAncestor {
    reason: string;
    adapterId?: string;
}

/** Caches that are valid only for one synchronous hover/inspection call. */
interface ResolutionEvaluationContext {
    textProtectionCache: TranslationTextProtectionCache;
    hardGuards: WeakMap<Element, HardGuardResult>;
    adapterDecisions: WeakMap<Element, AdapterDecisionResult>;
    adapterPrunedAncestors: WeakMap<Element, AdapterPrunedAncestor | null>;
    extensionElements: WeakMap<Element, boolean>;
    structuralContainers: WeakMap<Element, boolean>;
    structuralAncestors: WeakMap<Element, boolean>;
}

function createResolutionEvaluationContext(): ResolutionEvaluationContext {
    return {
        textProtectionCache: createTranslationTextProtectionCache(),
        hardGuards: new WeakMap(),
        adapterDecisions: new WeakMap(),
        adapterPrunedAncestors: new WeakMap(),
        extensionElements: new WeakMap(),
        structuralContainers: new WeakMap(),
        structuralAncestors: new WeakMap(),
    };
}

function isElementNode(node: Node | null | undefined): node is Element {
    return Boolean(node && node.nodeType === 1 && typeof (node as Element).matches === 'function');
}

function asHTMLElement(element: Element | null | undefined): HTMLElement | null {
    if (!element || element.nodeType !== 1) return null;
    return element as HTMLElement;
}

function currentURL(fallbackDocument?: Document): URL {
    const href = fallbackDocument?.location?.href ?? globalThis.location?.href ?? 'https://invalid.local/';
    try {
        return new URL(href);
    } catch {
        return new URL('https://invalid.local/');
    }
}

export interface TranslationCoreInspection {
    candidate: TranslationCandidate | null;
}

export interface TranslationDiscoveryStep {
    element: Element;
    phase: 'enter' | 'exit';
    candidate?: TranslationCandidate;
}

interface DiscoveryFrame {
    element: Element;
    phase: 'enter' | 'children' | 'exit';
    lightIndex: number;
    shadowIndex: number;
    shadowRoot: ShadowRoot | null;
    descendantHasCandidate: boolean;
    candidateChildBarriers: Set<Element>;
    ownAdapter?: ReturnType<TranslationCandidateCore['adapterDecision']>;
    forcedCandidate?: TranslationCandidate;
    forcedAtomic?: boolean;
    exitCandidates?: TranslationCandidate[];
    exitIndex: number;
    checkAncestors: boolean;
    insideStructural: boolean;
    pruned: boolean;
}

export function getTranslationCandidateKey(candidate: TranslationCandidate): Node {
    return candidate.nodes?.find((node) => node.nodeType === 1 || node.nodeType === 3) ?? candidate.element;
}

/** Exact adapter decisions outrank generic candidates that share a DOM key. */
export function selectPreferredTranslationCandidate(
    existing: TranslationCandidate | undefined,
    incoming: TranslationCandidate,
): TranslationCandidate {
    if (!existing) return incoming;
    if (existing.adapterId && !incoming.adapterId) return existing;
    if (incoming.adapterId && !existing.adapterId) return incoming;
    return existing;
}

/** Candidate discovery facade. Translation scheduling/rendering stay in runtime ports. */
export class TranslationCandidateCore {
    readonly url: URL;
    readonly adapters: readonly TranslationSiteAdapter[];
    private readonly context: AdapterContext;
    private readonly discoveredCandidateChildBarriers = new WeakMap<Element, ReadonlySet<Element>>();

    constructor(options: TranslationCoreOptions = {}) {
        this.url = options.url ?? currentURL();
        this.adapters = (options.adapters ?? [])
            .map((adapter, index) => ({adapter, index}))
            .filter(({adapter}) => {
                try {
                    return adapter.matches(this.url);
                } catch {
                    return false;
                }
            })
            .sort((left, right) =>
                (right.adapter.priority ?? 0) - (left.adapter.priority ?? 0) || left.index - right.index)
            .map(({adapter}) => adapter);
        this.context = {url: this.url};
    }

    private adapterDecision(
        element: Element,
        evaluationContext?: ResolutionEvaluationContext,
    ): AdapterDecisionResult {
        const cached = evaluationContext?.adapterDecisions.get(element);
        if (cached) return cached;

        for (const adapter of this.adapters) {
            try {
                const decision = adapter.decide(element, this.context);
                if (decision.kind !== 'pass') {
                    const result = {decision, adapterId: adapter.id};
                    evaluationContext?.adapterDecisions.set(element, result);
                    return result;
                }
            } catch {
                // A stale third-party adapter must not abort generic discovery.
            }
        }
        const result: AdapterDecisionResult = {decision: {kind: 'pass'}};
        evaluationContext?.adapterDecisions.set(element, result);
        return result;
    }

    shouldStayOriginal = (element: Element): boolean => this.adapters.some((adapter) => {
        try {
            return adapter.shouldStayOriginal?.(element, this.context) === true;
        } catch {
            return false;
        }
    });

    shouldIgnoreMutation = (element: Element): boolean => this.adapters.some((adapter) => {
        try {
            return adapter.shouldIgnoreMutation?.(element, this.context) === true;
        } catch {
            return false;
        }
    });

    private hasAdapterPrunedAncestor(
        element: Element,
        evaluationContext?: ResolutionEvaluationContext,
    ): AdapterPrunedAncestor | null {
        if (evaluationContext?.adapterPrunedAncestors.has(element)) {
            return evaluationContext.adapterPrunedAncestors.get(element) ?? null;
        }

        const inspected: Element[] = [];
        let depth = 0;
        for (const ancestor of composedAncestors(element)) {
            depth += 1;
            if (depth > maxComposedAncestorDepth) {
                const result = {reason: 'ancestor-depth-limit'};
                evaluationContext?.adapterPrunedAncestors.set(element, result);
                return result;
            }
            inspected.push(ancestor);
            const {decision, adapterId} = this.adapterDecision(ancestor, evaluationContext);
            if (decision.kind === 'prune-subtree') {
                const result = {reason: decision.reason, adapterId};
                evaluationContext?.adapterPrunedAncestors.set(element, result);
                return result;
            }
        }
        inspected.forEach((ancestor) => evaluationContext?.adapterPrunedAncestors.set(ancestor, null));
        return null;
    }

    private primeResolutionAncestry(
        element: Element,
        evaluationContext: ResolutionEvaluationContext,
    ): void {
        if (evaluationContext.hardGuards.has(element) &&
            evaluationContext.structuralAncestors.has(element)) return;

        const chain: Element[] = [];
        let current: Element | null = element;
        while (current && chain.length < maxComposedAncestorDepth) {
            chain.push(current);
            current = getComposedParent(current);
        }
        // Keep the existing bounded fallback for over-deep ancestry rather
        // than evaluating or persisting a partial prefix.
        if (current) return;

        const ownGuards = chain.map((item) => evaluateElementHardGuard(item));
        let inheritedGuard: HardGuardResult = {prune: false};
        for (let index = chain.length - 1; index >= 0; index -= 1) {
            const item = chain[index]!;
            const ownGuard = ownGuards[index]!;
            inheritedGuard = ownGuard.prune ? ownGuard : inheritedGuard;
            evaluationContext.hardGuards.set(item, inheritedGuard);

            const parent = getComposedParent(item);
            const hasStructuralAncestor = Boolean(parent && !isDocumentSurface(parent) && (
                this.isStructuralContainerForResolution(parent, evaluationContext) ||
                evaluationContext.structuralAncestors.get(parent) === true
            ));
            evaluationContext.structuralAncestors.set(item, hasStructuralAncestor);
        }
    }

    private hardGuard(
        element: Element,
        evaluationContext?: ResolutionEvaluationContext,
    ): HardGuardResult {
        if (!evaluationContext) return evaluateHardGuard(element);
        this.primeResolutionAncestry(element, evaluationContext);
        return evaluationContext.hardGuards.get(element) ?? evaluateHardGuard(element);
    }

    private isExtensionElementForResolution(
        element: Element,
        evaluationContext: ResolutionEvaluationContext,
    ): boolean {
        if (evaluationContext.extensionElements.has(element)) {
            return evaluationContext.extensionElements.get(element) === true;
        }
        const chain: Element[] = [];
        let current: Element | null = element;
        while (current && !evaluationContext.extensionElements.has(current)) {
            chain.push(current);
            // Element.closest(), used by the previous implementation, does not
            // cross a ShadowRoot. Keep that exact ownership boundary here.
            current = current.parentElement;
        }
        let inherited = current ? evaluationContext.extensionElements.get(current) === true : false;
        for (let index = chain.length - 1; index >= 0; index -= 1) {
            inherited = inherited || isExtensionElementSelf(chain[index]!);
            evaluationContext.extensionElements.set(chain[index]!, inherited);
        }
        return evaluationContext.extensionElements.get(element) === true;
    }

    private isStructuralContainerForResolution(
        element: Element,
        evaluationContext: ResolutionEvaluationContext,
    ): boolean {
        const cached = evaluationContext.structuralContainers.get(element);
        if (cached !== undefined) return cached;
        const result = isStructuralContainer(element);
        evaluationContext.structuralContainers.set(element, result);
        return result;
    }

    private hasStructuralAncestorForResolution(
        element: Element,
        evaluationContext: ResolutionEvaluationContext,
    ): boolean {
        this.primeResolutionAncestry(element, evaluationContext);
        return evaluationContext.structuralAncestors.get(element) ?? hasStructuralAncestor(element);
    }

    inspect(element: Element): TranslationCoreInspection {
        const evaluationContext = createResolutionEvaluationContext();
        return this.inspectWithTextProtectionCache(
            element,
            evaluationContext.textProtectionCache,
            evaluationContext,
        );
    }

    private inspectWithTextProtectionCache(
        element: Element,
        textProtectionCache: TranslationTextProtectionCache,
        evaluationContext?: ResolutionEvaluationContext,
    ): TranslationCoreInspection {
        const hardGuard = this.hardGuard(element, evaluationContext);
        if (hardGuard.prune) {
            return {candidate: null};
        }

        const pruned = this.hasAdapterPrunedAncestor(element, evaluationContext);
        if (pruned) {
            return {candidate: null};
        }

        const {decision, adapterId} = this.adapterDecision(element, evaluationContext);
        if (decision.kind === 'skip-self') {
            return {candidate: null};
        }
        if (decision.kind === 'force-target') {
            const target = asHTMLElement(decision.target ?? element);
            if (!target || !hasMeaningfulTranslationTextInNodes(
                [target],
                this.shouldStayOriginal,
                textProtectionCache,
            ) ||
                this.hardGuard(target, evaluationContext).prune) {
                return {candidate: null};
            }
            const candidate: TranslationCandidate = {
                element: target,
                kind: decision.candidateKind ?? (isTranslationControlElement(target) ? 'control' : 'content'),
                reason: decision.reason,
                adapterId,
            };
            return {candidate};
        }

        if (evaluationContext &&
            this.hasStructuralAncestorForResolution(element, evaluationContext) &&
            !isSemanticHeadingElement(element)) {
            return {candidate: null};
        }
        const classification = classifyGenericCandidate(
            element,
            this.shouldStayOriginal,
            evaluationContext !== undefined,
            textProtectionCache,
        );
        if (!classification) {
            return {candidate: null};
        }
        const candidate: TranslationCandidate = {
            element: element as HTMLElement,
            kind: classification.kind,
            reason: classification.reason,
        };
        return {candidate};
    }

    private inlineRunCandidates(
        element: Element,
        skipStructuralAncestorCheck = false,
        textProtectionCache = createTranslationTextProtectionCache(),
        candidateChildBarriers?: ReadonlySet<Element>,
        evaluationContext?: ResolutionEvaluationContext,
    ): TranslationCandidate[] {
        const candidates: TranslationCandidate[] = [];
        const atomicTargetCache = new WeakMap<Element, boolean>();
        const isAtomicAdapterTarget = (candidate: Element): boolean => {
            const cached = atomicTargetCache.get(candidate);
            if (cached !== undefined) return cached;
            const decision = this.adapterDecision(candidate, evaluationContext).decision;
            const target = decision.kind === 'force-target' ? decision.target ?? candidate : null;
            const result = decision.kind === 'force-target' && decision.atomic !== false && target === candidate;
            atomicTargetCache.set(candidate, result);
            return result;
        };
        const isDirectRunBarrier = (candidate: Element): boolean =>
            candidateChildBarriers?.has(candidate) === true ||
            isAtomicAdapterTarget(candidate) || isTranslationControlElement(candidate);
        for (const run of getDirectInlineRuns(
            element,
            this.shouldStayOriginal,
            skipStructuralAncestorCheck,
            isDirectRunBarrier,
            textProtectionCache,
        )) {
            let current: ChildNode[] = [];
            const flush = () => {
                if (current.length > 0 && hasMeaningfulTranslationTextInNodes(
                    current,
                    this.shouldStayOriginal,
                    textProtectionCache,
                )) {
                    candidates.push({
                        element: element as HTMLElement,
                        nodes: current,
                        kind: 'content',
                        reason: 'generic-inline-run',
                    });
                }
                current = [];
            };

            for (const node of run) {
                if (isElementNode(node) && isDirectRunBarrier(node)) {
                    // Descendant-owned subtrees, exact adapter targets, and
                    // interactive controls are scheduled separately. Keep them
                    // out of the surrounding run so no selected DOM is moved
                    // into a second synthetic candidate.
                    flush();
                    continue;
                }
                current.push(node);
            }
            flush();
        }
        return candidates;
    }

    private genericCandidateForDiscovery(
        element: Element,
        insideStructural: boolean,
        textProtectionCache: TranslationTextProtectionCache,
    ): TranslationCandidate | null {
        if (insideStructural && !isSemanticHeadingElement(element)) return null;
        const classification = classifyGenericCandidate(
            element,
            this.shouldStayOriginal,
            true,
            textProtectionCache,
        );
        if (!classification) return null;
        return {
            element: element as HTMLElement,
            kind: classification.kind,
            reason: classification.reason,
        };
    }

    private resolveInlineRun(
        element: Element,
        start: Node,
        evaluationContext: ResolutionEvaluationContext,
    ): TranslationCandidate | null {
        if (isDocumentSurface(element) ||
            this.isStructuralContainerForResolution(element, evaluationContext) ||
            this.hasStructuralAncestorForResolution(element, evaluationContext) ||
            !isBlockBoundary(element) ||
            element.children.length === 0) {
            return null;
        }
        // Use post-order ownership barriers from full discovery as probe
        // priority, then revalidate every inline child within one strict
        // budget. This preserves parity after live mutations without an
        // unbounded subtree walk in pointer handling.
        const candidates = this.inlineRunCandidates(
            element,
            true,
            evaluationContext.textProtectionCache,
            this.probeHoverCandidateChildBarriers(
                element,
                this.discoveredCandidateChildBarriers.get(element),
            ),
            evaluationContext,
        );
        if (candidates.length === 0) return null;
        let direct: Node | null = start;
        while (direct && direct !== element && direct.parentNode !== element) direct = direct.parentNode;
        if (!direct || direct === element) return candidates[0] ?? null;
        return candidates.find((candidate) => candidate.nodes?.includes(direct as ChildNode)) ?? null;
    }

    private probeHoverCandidateChildBarriers(
        element: Element,
        discoveredBarriers?: ReadonlySet<Element>,
    ): ReadonlySet<Element> {
        const barriers = new Set<Element>();
        let remainingSteps = maxHoverBarrierDiscoverySteps;
        const children = Array.from(element.children);
        // Revalidate previous barriers first. They are the only children whose
        // stale ownership can otherwise make hover diverge from a fresh dirty
        // subtree discovery; unknown children still share the same total cap.
        const orderedChildren = discoveredBarriers
            ? [
                ...children.filter((child) => discoveredBarriers.has(child)),
                ...children.filter((child) => !discoveredBarriers.has(child)),
            ]
            : children;

        for (const child of orderedChildren) {
            // Native block boundaries already split direct runs in layout.ts.
            if (isBlockBoundary(child)) continue;
            if (remainingSteps <= 0) {
                // Never reparent an uninspected subtree merely because the
                // bounded hover probe ran out of budget. Previously discovered
                // barriers must remain conservative too, but they are not
                // trusted once the live subtree can be revalidated below.
                barriers.add(child);
                continue;
            }

            let ownsCandidate = false;
            let exhausted = false;
            for (const step of this.discoverSteps(child)) {
                remainingSteps -= 1;
                if (step.candidate) {
                    ownsCandidate = true;
                    break;
                }
                if (remainingSteps <= 0) {
                    exhausted = true;
                    break;
                }
            }
            if (ownsCandidate || exhausted) barriers.add(child);
        }
        return barriers;
    }

    resolve(start: Node | null | undefined): TranslationCandidate | null {
        if (!start) return null;
        const hit = start;
        const evaluationContext = createResolutionEvaluationContext();
        const textProtectionCache = evaluationContext.textProtectionCache;
        let current: Element | null = start.nodeType === 3
            ? (start as Text).parentElement
            : isElementNode(start) ? start : null;

        while (current && !isDocumentSurface(current)) {
            if (current.matches('[data-fr-translation-segment="true"]')) {
                return {element: current as HTMLElement, kind: 'content', reason: 'owned-inline-run'};
            }
            // A hit inside our bilingual wrapper maps back to the host source.
            if (current.matches('.fluent-read-bilingual-content')) {
                current = current.parentElement;
                continue;
            }
            if (this.isExtensionElementForResolution(current, evaluationContext)) {
                current = getComposedParent(current);
                continue;
            }
            // Inherited hard guards apply to every possible ancestor candidate.
            // Stop immediately instead of repeatedly climbing an extreme tree.
            if (this.hardGuard(current, evaluationContext).reason === 'ancestor-depth-limit') return null;
            // Full-page discovery prunes adapter-owned controlled subtrees before
            // walking their children. Hover resolution must apply the same
            // inherited prune decision before trying a generic inline run;
            // otherwise a hit inside (for example) GitHub Quick Search can
            // resolve its dialog ancestor even though discover() excludes it.
            if (this.hasAdapterPrunedAncestor(current, evaluationContext)) return null;
            const ownDecision = this.adapterDecision(current, evaluationContext).decision;
            if (ownDecision.kind === 'force-target' && ownDecision.atomic !== false) {
                const exact = this.inspectWithTextProtectionCache(
                    current,
                    textProtectionCache,
                    evaluationContext,
                ).candidate;
                if (exact) return exact;
            }
            // Mixed direct content must resolve to the same run emitted by the
            // full-page walk. This also keeps ordinary text next to an atomic
            // adapter target from falling back to the whole parent container.
            const inlineRun = this.resolveInlineRun(current, hit, evaluationContext);
            if (inlineRun) return inlineRun;
            const inspection = this.inspectWithTextProtectionCache(
                current,
                textProtectionCache,
                evaluationContext,
            );
            if (inspection.candidate) return inspection.candidate;
            if (this.isStructuralContainerForResolution(current, evaluationContext)) return null;
            current = getComposedParent(current);
        }
        return null;
    }

    /**
     * Incremental post-order discovery. A step is yielded for every visited
     * element (including rejected/pruned elements), allowing full-page callers
     * to enforce a frame budget without changing candidate semantics.
     */
    *discoverSteps(root: Node): Generator<TranslationDiscoveryStep> {
        const visited = new Set<Element>();
        const textProtectionCache = createTranslationTextProtectionCache();
        const roots: Element[] = [];
        if (isElementNode(root)) roots.push(root);
        else if ('children' in root) {
            const children = (root as Document | ShadowRoot).children;
            for (let index = 0; index < children.length; index += 1) {
                const child = children.item(index);
                if (child) roots.push(child);
            }
        }
        for (const rootElement of roots) {
            const stack: DiscoveryFrame[] = [{
                element: rootElement,
                phase: 'enter',
                lightIndex: 0,
                shadowIndex: 0,
                shadowRoot: null,
                descendantHasCandidate: false,
                candidateChildBarriers: new Set(),
                exitIndex: 0,
                checkAncestors: true,
                insideStructural: hasStructuralAncestor(rootElement),
                pruned: false,
            }];

            while (stack.length > 0) {
                const frame = stack[stack.length - 1];
                if (!frame) break;

                if (frame.phase === 'enter') {
                    if (visited.has(frame.element)) {
                        stack.pop();
                        continue;
                    }
                    visited.add(frame.element);
                    isTranslationTextElementProtected(
                        frame.element,
                        this.shouldStayOriginal,
                        textProtectionCache,
                    );
                    const hardGuard = frame.checkAncestors
                        ? evaluateHardGuard(frame.element)
                        : evaluateElementHardGuard(frame.element);
                    const ownAdapter = this.adapterDecision(frame.element);
                    frame.ownAdapter = ownAdapter;
                    frame.shadowRoot = frame.element.shadowRoot;
                    frame.pruned = hardGuard.prune || ownAdapter.decision.kind === 'prune-subtree';
                    frame.phase = frame.pruned
                        ? 'exit'
                        : 'children';

                    if (ownAdapter.decision.kind === 'force-target' && !hardGuard.prune) {
                        frame.forcedCandidate = this.inspectWithTextProtectionCache(
                            frame.element,
                            textProtectionCache,
                        ).candidate ?? undefined;
                        frame.forcedAtomic = ownAdapter.decision.atomic !== false;
                        if (frame.forcedCandidate && ownAdapter.decision.atomic !== false) frame.phase = 'exit';
                    }
                    yield {element: frame.element, phase: 'enter'};
                    continue;
                }

                if (frame.phase === 'children') {
                    const child = frame.element.children.item(frame.lightIndex);
                    if (child) {
                        frame.lightIndex += 1;
                        stack.push({
                            element: child,
                            phase: 'enter',
                            lightIndex: 0,
                            shadowIndex: 0,
                            shadowRoot: null,
                            descendantHasCandidate: false,
                            candidateChildBarriers: new Set(),
                            exitIndex: 0,
                            checkAncestors: false,
                            insideStructural: frame.insideStructural || isStructuralContainer(frame.element),
                            pruned: false,
                        });
                        continue;
                    }

                    const shadowRoot = frame.shadowRoot;
                    const shadowChild = shadowRoot?.children.item(frame.shadowIndex) ?? null;
                    if (shadowChild) {
                        frame.shadowIndex += 1;
                        stack.push({
                            element: shadowChild,
                            phase: 'enter',
                            lightIndex: 0,
                            shadowIndex: 0,
                            shadowRoot: null,
                            descendantHasCandidate: false,
                            candidateChildBarriers: new Set(),
                            exitIndex: 0,
                            checkAncestors: false,
                            insideStructural: frame.insideStructural || isStructuralContainer(frame.element),
                            pruned: false,
                        });
                        continue;
                    }
                    frame.phase = 'exit';
                }

                if (!frame.exitCandidates) {
                    if (frame.forcedCandidate) {
                        frame.exitCandidates = frame.forcedAtomic === false && frame.descendantHasCandidate
                            ? this.inlineRunCandidates(
                                frame.element,
                                true,
                                textProtectionCache,
                                frame.candidateChildBarriers,
                            )
                            : [frame.forcedCandidate];
                    } else if (frame.ownAdapter?.decision.kind === 'skip-self' ||
                        frame.ownAdapter?.decision.kind === 'prune-subtree' ||
                        frame.pruned) {
                        frame.exitCandidates = [];
                    } else if (frame.descendantHasCandidate) {
                        frame.exitCandidates = frame.insideStructural
                            ? []
                            : this.inlineRunCandidates(
                                frame.element,
                                true,
                                textProtectionCache,
                                frame.candidateChildBarriers,
                            );
                    } else {
                        const candidate = this.genericCandidateForDiscovery(
                            frame.element,
                            frame.insideStructural,
                            textProtectionCache,
                        );
                        frame.exitCandidates = candidate ? [candidate] : [];
                    }
                    this.discoveredCandidateChildBarriers.set(
                        frame.element,
                        frame.candidateChildBarriers,
                    );
                }

                const candidate = frame.exitCandidates[frame.exitIndex];
                frame.exitIndex += 1;
                const hasMore = frame.exitIndex < frame.exitCandidates.length;
                if (!hasMore) {
                    const hasCandidate = frame.descendantHasCandidate || frame.exitCandidates.length > 0;
                    stack.pop();
                    const parent = stack[stack.length - 1];
                    if (parent && hasCandidate) {
                        parent.descendantHasCandidate = true;
                        // Discovery is post-order: once a direct child subtree
                        // owns any candidate, an ancestor synthetic inline run
                        // must not move that subtree into a second candidate.
                        if (frame.element.parentElement === parent.element) {
                            parent.candidateChildBarriers.add(frame.element);
                        }
                    }
                }
                yield candidate
                    ? {element: frame.element, phase: 'exit', candidate}
                    : {element: frame.element, phase: 'exit'};
            }
        }
    }

    discover(root: Node): TranslationCandidate[] {
        const unique = new Map<Node, TranslationCandidate>();
        for (const {candidate} of this.discoverSteps(root)) {
            if (!candidate) continue;
            const key = getTranslationCandidateKey(candidate);
            const existing = unique.get(key);
            unique.set(key, selectPreferredTranslationCandidate(existing, candidate));
        }
        return [...unique.values()];
    }

    resolveAtPoint(root: Document | ShadowRoot, x: number, y: number): TranslationCandidate | null {
        const pointedNode = findNodeAtPoint(root, x, y);
        if (pointedNode) {
            const pointedCandidate = this.resolve(pointedNode);
            if (pointedCandidate) return pointedCandidate;
        }
        for (const element of findElementsAtPoint(root, x, y)) {
            if (element.shadowRoot) {
                const shadowCandidate = this.resolveAtPoint(element.shadowRoot, x, y);
                if (shadowCandidate) return shadowCandidate;
            }
            const candidate = this.resolve(element);
            if (candidate) return candidate;
        }
        return null;
    }
}

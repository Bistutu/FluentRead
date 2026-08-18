import {
    composedAncestors,
    evaluateElementHardGuard,
    evaluateHardGuard,
    findElementsAtPoint,
    findNodeAtPoint,
    getComposedParent,
    isDocumentSurface,
    isExtensionElement,
    maxComposedAncestorDepth,
} from './dom';
import {
    classifyGenericCandidate,
    getDirectInlineRuns,
    hasStructuralAncestor,
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
    DecisionTraceEntry,
    TranslationCandidate,
    TranslationCoreOptions,
    TranslationSiteAdapter,
} from './types';

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
    trace: DecisionTraceEntry[];
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

    private adapterDecision(element: Element): {decision: AdapterDecision; adapterId?: string} {
        for (const adapter of this.adapters) {
            try {
                const decision = adapter.decide(element, this.context);
                if (decision.kind !== 'pass') return {decision, adapterId: adapter.id};
            } catch {
                // A stale third-party adapter must not abort generic discovery.
            }
        }
        return {decision: {kind: 'pass'}};
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

    private hasAdapterPrunedAncestor(element: Element): {reason: string; adapterId?: string} | null {
        let depth = 0;
        for (const ancestor of composedAncestors(element)) {
            depth += 1;
            if (depth > maxComposedAncestorDepth) return {reason: 'ancestor-depth-limit'};
            const {decision, adapterId} = this.adapterDecision(ancestor);
            if (decision.kind === 'prune-subtree') return {reason: decision.reason, adapterId};
        }
        return null;
    }

    inspect(element: Element): TranslationCoreInspection {
        return this.inspectWithTextProtectionCache(element, createTranslationTextProtectionCache());
    }

    private inspectWithTextProtectionCache(
        element: Element,
        textProtectionCache: TranslationTextProtectionCache,
    ): TranslationCoreInspection {
        const trace: DecisionTraceEntry[] = [];
        const hardGuard = evaluateHardGuard(element);
        if (hardGuard.prune) {
            trace.push({element, action: 'hard-prune', reason: hardGuard.reason ?? 'hard-guard'});
            return {candidate: null, trace};
        }

        const pruned = this.hasAdapterPrunedAncestor(element);
        if (pruned) {
            trace.push({element, action: 'prune-subtree', reason: pruned.reason, adapterId: pruned.adapterId});
            return {candidate: null, trace};
        }

        const {decision, adapterId} = this.adapterDecision(element);
        if (decision.kind === 'skip-self') {
            trace.push({element, action: decision.kind, reason: decision.reason, adapterId});
            return {candidate: null, trace};
        }
        if (decision.kind === 'force-target') {
            const target = asHTMLElement(decision.target ?? element);
            if (!target || !hasMeaningfulTranslationTextInNodes(
                [target],
                this.shouldStayOriginal,
                textProtectionCache,
            ) ||
                evaluateHardGuard(target).prune) {
                trace.push({element, action: 'continue', reason: 'forced-target-empty-or-protected', adapterId});
                return {candidate: null, trace};
            }
            const candidate: TranslationCandidate = {
                element: target,
                kind: decision.candidateKind ?? (isTranslationControlElement(target) ? 'control' : 'content'),
                reason: decision.reason,
                adapterId,
            };
            trace.push({element: target, action: decision.kind, reason: decision.reason, adapterId});
            return {candidate, trace};
        }

        const classification = classifyGenericCandidate(
            element,
            this.shouldStayOriginal,
            false,
            textProtectionCache,
        );
        if (!classification) {
            trace.push({element, action: 'continue', reason: 'generic-not-a-boundary'});
            return {candidate: null, trace};
        }
        const candidate: TranslationCandidate = {
            element: element as HTMLElement,
            kind: classification.kind,
            reason: classification.reason,
        };
        trace.push({element, action: 'generic-target', reason: classification.reason});
        return {candidate, trace};
    }

    private inlineRunCandidates(
        element: Element,
        skipStructuralAncestorCheck = false,
        textProtectionCache = createTranslationTextProtectionCache(),
    ): TranslationCandidate[] {
        const candidates: TranslationCandidate[] = [];
        const atomicTargetCache = new WeakMap<Element, boolean>();
        const isAtomicAdapterTarget = (candidate: Element): boolean => {
            const cached = atomicTargetCache.get(candidate);
            if (cached !== undefined) return cached;
            const decision = this.adapterDecision(candidate).decision;
            const target = decision.kind === 'force-target' ? decision.target ?? candidate : null;
            const result = decision.kind === 'force-target' && decision.atomic !== false && target === candidate;
            atomicTargetCache.set(candidate, result);
            return result;
        };
        for (const run of getDirectInlineRuns(
            element,
            this.shouldStayOriginal,
            skipStructuralAncestorCheck,
            isAtomicAdapterTarget,
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
                if (isElementNode(node) && isAtomicAdapterTarget(node)) {
                    // The exact adapter candidate is scheduled separately.
                    // Treat it as a run barrier so the generic parent never
                    // reparents the target into a synthetic span.
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
        if (insideStructural) return null;
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
        textProtectionCache: TranslationTextProtectionCache,
    ): TranslationCandidate | null {
        const candidates = this.inlineRunCandidates(element, false, textProtectionCache);
        if (candidates.length === 0) return null;
        let direct: Node | null = start;
        while (direct && direct !== element && direct.parentNode !== element) direct = direct.parentNode;
        if (!direct || direct === element) return candidates[0] ?? null;
        return candidates.find((candidate) => candidate.nodes?.includes(direct as ChildNode)) ?? null;
    }

    resolve(start: Node | null | undefined): TranslationCandidate | null {
        if (!start) return null;
        const hit = start;
        const textProtectionCache = createTranslationTextProtectionCache();
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
            if (isExtensionElement(current)) {
                current = getComposedParent(current);
                continue;
            }
            // Inherited hard guards apply to every possible ancestor candidate.
            // Stop immediately instead of repeatedly climbing an extreme tree.
            if (evaluateHardGuard(current).reason === 'ancestor-depth-limit') return null;
            const ownDecision = this.adapterDecision(current).decision;
            if (ownDecision.kind === 'force-target' && ownDecision.atomic !== false) {
                const exact = this.inspectWithTextProtectionCache(current, textProtectionCache).candidate;
                if (exact) return exact;
            }
            // Mixed direct content must resolve to the same run emitted by the
            // full-page walk. This also keeps ordinary text next to an atomic
            // adapter target from falling back to the whole parent container.
            const inlineRun = this.resolveInlineRun(current, hit, textProtectionCache);
            if (inlineRun) return inlineRun;
            const inspection = this.inspectWithTextProtectionCache(current, textProtectionCache);
            if (inspection.candidate) return inspection.candidate;
            if (isStructuralContainer(current)) return null;
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
        const visitedRoots = new Set<Node>();
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
        visitedRoots.add(root);

        for (const rootElement of roots) {
            const stack: DiscoveryFrame[] = [{
                element: rootElement,
                phase: 'enter',
                lightIndex: 0,
                shadowIndex: 0,
                shadowRoot: null,
                descendantHasCandidate: false,
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
                            exitIndex: 0,
                            checkAncestors: false,
                            insideStructural: frame.insideStructural || isStructuralContainer(frame.element),
                            pruned: false,
                        });
                        continue;
                    }

                    const shadowRoot = frame.shadowRoot;
                    if (shadowRoot && !visitedRoots.has(shadowRoot)) visitedRoots.add(shadowRoot);
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
                            ? this.inlineRunCandidates(frame.element, true, textProtectionCache)
                            : [frame.forcedCandidate];
                    } else if (frame.ownAdapter?.decision.kind === 'skip-self' ||
                        frame.ownAdapter?.decision.kind === 'prune-subtree' ||
                        frame.pruned) {
                        frame.exitCandidates = [];
                    } else if (frame.descendantHasCandidate) {
                        frame.exitCandidates = frame.insideStructural
                            ? []
                            : this.inlineRunCandidates(frame.element, true, textProtectionCache);
                    } else {
                        const candidate = this.genericCandidateForDiscovery(
                            frame.element,
                            frame.insideStructural,
                            textProtectionCache,
                        );
                        frame.exitCandidates = candidate ? [candidate] : [];
                    }
                }

                const candidate = frame.exitCandidates[frame.exitIndex];
                frame.exitIndex += 1;
                const hasMore = frame.exitIndex < frame.exitCandidates.length;
                if (!hasMore) {
                    const hasCandidate = frame.descendantHasCandidate || frame.exitCandidates.length > 0;
                    stack.pop();
                    const parent = stack[stack.length - 1];
                    if (parent && hasCandidate) parent.descendantHasCandidate = true;
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

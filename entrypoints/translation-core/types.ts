export type TranslationCandidateKind = 'content' | 'control';

export type AdapterDecision =
    | {kind: 'pass'}
    | {kind: 'skip-self'; reason: string}
    | {kind: 'prune-subtree'; reason: string}
    | {
        kind: 'force-target';
        reason: string;
        target?: Element;
        candidateKind?: TranslationCandidateKind;
        atomic?: boolean;
    };

export interface AdapterContext {
    url: URL;
}

export interface TranslationSiteAdapter {
    id: string;
    priority?: number;
    matches(url: URL): boolean;
    decide(element: Element, context: AdapterContext): AdapterDecision;
    shouldStayOriginal?(element: Element, context: AdapterContext): boolean;
    shouldIgnoreMutation?(element: Element, context: AdapterContext): boolean;
}

export interface TranslationCandidate {
    /** Observation/render host. Inline-run candidates materialize only `nodes`. */
    element: HTMLElement;
    /** Contiguous direct children used when a block mixes inline text and block children. */
    nodes?: readonly ChildNode[];
    kind: TranslationCandidateKind;
    reason: string;
    adapterId?: string;
}

export interface DecisionTraceEntry {
    element: Element;
    action: AdapterDecision['kind'] | 'hard-prune' | 'generic-target' | 'continue';
    reason: string;
    adapterId?: string;
}

export interface TranslationCoreOptions {
    url?: URL;
    adapters?: readonly TranslationSiteAdapter[];
}

import {safeClosest, safeMatches} from '../dom';
import type {
    AdapterContext,
    AdapterDecision,
    TranslationCandidateKind,
    TranslationSiteAdapter,
} from '../types';

export type SelectorList = string | readonly string[];

export interface DeclarativeSelectorRule {
    selector: SelectorList;
    reason: string;
}

export interface DeclarativeTargetRule extends DeclarativeSelectorRule {
    /** Resolve descendants to the declared semantic container. */
    match?: 'self' | 'closest';
    candidateKind?: TranslationCandidateKind;
    atomic?: boolean;
}

export interface DeclarativeHostRule {
    hostname: string;
    includeSubdomains?: boolean;
}

export interface DeclarativeSiteAdapterDefinition {
    id: string;
    priority?: number;
    hosts: readonly (string | DeclarativeHostRule)[];
    pathnames?: readonly RegExp[];
    targets?: readonly DeclarativeTargetRule[];
    prune?: readonly DeclarativeSelectorRule[];
    keepOriginal?: readonly DeclarativeSelectorRule[];
    mutationExclude?: readonly DeclarativeSelectorRule[];
}

function selectors(value: SelectorList): readonly string[] {
    return typeof value === 'string' ? [value] : value;
}

const combinedSelectorsByDocument = new WeakMap<Document, Map<string, string | null>>();

function combinedSelector(element: Element, value: SelectorList): string | null {
    const document = element.ownerDocument;
    if (!document) return null;
    const items = selectors(value);
    const cacheKey = items.join('\u0000');
    let documentCache = combinedSelectorsByDocument.get(document);
    if (!documentCache) {
        documentCache = new Map();
        combinedSelectorsByDocument.set(document, documentCache);
    }
    if (documentCache.has(cacheKey)) return documentCache.get(cacheKey) ?? null;

    const probe = document.createElement('div');
    const valid = items.filter((item) => {
        try {
            probe.matches(item);
            return true;
        } catch {
            return false;
        }
    });
    const combined = valid.length > 0 ? valid.join(',') : null;
    documentCache.set(cacheKey, combined);
    return combined;
}

function matchesSelector(element: Element, selector: SelectorList): boolean {
    const combined = combinedSelector(element, selector);
    return combined ? safeMatches(element, combined) : false;
}

function closestSelector(element: Element, selector: SelectorList): Element | null {
    const combined = combinedSelector(element, selector);
    return combined ? safeClosest(element, combined) : null;
}

function normalizeHostname(hostname: string): string {
    return hostname.toLowerCase().replace(/\.$/u, '');
}

function matchesHost(url: URL, rule: string | DeclarativeHostRule): boolean {
    const hostname = normalizeHostname(url.hostname);
    const expected = normalizeHostname(typeof rule === 'string' ? rule : rule.hostname);
    if (!expected || hostname === expected) return hostname === expected;
    return typeof rule !== 'string' && rule.includeSubdomains === true && hostname.endsWith(`.${expected}`);
}

function matchesPathname(pathname: string, patterns: readonly RegExp[] | undefined): boolean {
    if (!patterns?.length) return true;
    return patterns.some((pattern) => {
        try {
            // Avoid observable lastIndex changes on global/sticky expressions.
            return new RegExp(pattern.source, pattern.flags).test(pathname);
        } catch {
            return false;
        }
    });
}

/**
 * Build a site adapter from inert selector data. Every selector operation is
 * fail-closed, so a stale or unsupported site selector cannot abort discovery.
 */
export function createDeclarativeAdapter(
    definition: DeclarativeSiteAdapterDefinition,
): TranslationSiteAdapter {
    const pruneRules = definition.prune ?? [];
    const targetRules = definition.targets ?? [];
    const originalRules = definition.keepOriginal ?? [];
    const mutationRules = definition.mutationExclude ?? [];

    return {
        id: definition.id,
        priority: definition.priority,
        matches(url: URL): boolean {
            return definition.hosts.some((host) => matchesHost(url, host)) &&
                matchesPathname(url.pathname, definition.pathnames);
        },
        decide(element: Element, _context: AdapterContext): AdapterDecision {
            for (const rule of pruneRules) {
                if (closestSelector(element, rule.selector)) {
                    return {kind: 'prune-subtree', reason: rule.reason};
                }
            }

            for (const rule of targetRules) {
                const target = rule.match === 'closest'
                    ? closestSelector(element, rule.selector)
                    : matchesSelector(element, rule.selector) ? element : null;
                if (!target) continue;
                return {
                    kind: 'force-target',
                    reason: rule.reason,
                    target,
                    candidateKind: rule.candidateKind ?? 'content',
                    atomic: rule.atomic,
                };
            }

            return {kind: 'pass'};
        },
        shouldStayOriginal(element: Element, _context: AdapterContext): boolean {
            return originalRules.some((rule) => Boolean(closestSelector(element, rule.selector)));
        },
        shouldIgnoreMutation(element: Element, _context: AdapterContext): boolean {
            return mutationRules.some((rule) => Boolean(closestSelector(element, rule.selector)));
        },
    };
}

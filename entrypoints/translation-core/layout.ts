import {
    getComposedParent,
    isDocumentSurface,
    isProtectedTextElement,
    maxComposedAncestorDepth,
} from './dom';
import {
    hasMeaningfulTranslationTextInNodes,
} from './text';
import type {TranslationTextProtectionCache} from './text';

const maxDirectRunNodes = 2048;
const maxBlockChildrenToProbe = 128;

const semanticBlockTags = new Set([
    'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt',
    'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'header', 'li', 'main', 'nav', 'ol', 'p', 'section', 'table', 'tbody',
    'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

// These elements are semantic content units even when a site's stylesheet
// lays them out inline or with display:contents. Moving one into a synthetic
// inline-run wrapper can break direct-child selectors and can reparent an
// entire document region (MDN renders <main> with display:contents). Keep
// generic <div> layout-driven because transparent div wrappers are common;
// every other semantic block remains a safe reparent boundary.
const semanticReparentBoundaryTags = new Set(
    [...semanticBlockTags].filter((tag) => tag !== 'div'),
);

const inlineTags = new Set([
    'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'em', 'font', 'i', 'img',
    'mark', 'q', 'ruby', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u',
    'wbr',
]);

const inlineDisplays = new Set([
    'inline', 'inline-block', 'inline-flex', 'inline-grid', 'ruby', 'ruby-base',
    'ruby-base-container', 'ruby-text', 'ruby-text-container',
]);

const structuralTags = new Set(['aside', 'footer', 'header', 'nav']);

export function getElementDisplay(element: Element): string {
    try {
        const view = element.ownerDocument?.defaultView;
        return view?.getComputedStyle(element).display.trim().toLowerCase() ?? '';
    } catch {
        return '';
    }
}

export function isBlockBoundary(element: Element): boolean {
    const tag = element.tagName.toLowerCase();
    if (semanticReparentBoundaryTags.has(tag)) return true;
    const display = getElementDisplay(element);
    if (display) {
        if (display === 'none') return false;
        // A transparent layout div is still a DOM ownership boundary. Moving
        // it under a synthetic span changes grid/flex direct children and CSS
        // selectors even though the div itself does not generate a box.
        if (display === 'contents') return tag === 'div';
        if (inlineDisplays.has(display) || display.startsWith('inline')) return false;
        return true;
    }
    if (inlineTags.has(tag)) return false;
    return semanticBlockTags.has(tag);
}

export function isStructuralContainer(element: Element): boolean {
    return structuralTags.has(element.tagName.toLowerCase());
}

export function hasStructuralAncestor(element: Element): boolean {
    let current: Element | null = getComposedParent(element);
    let depth = 0;
    while (current && !isDocumentSurface(current)) {
        depth += 1;
        // Conservatively treat an adversarially deep subtree as structural.
        // Full-page discovery will prune it through the same hard depth guard.
        if (depth > maxComposedAncestorDepth) return true;
        if (isStructuralContainer(current)) return true;
        current = getComposedParent(current);
    }
    return false;
}

export function isTranslationControlElement(element: Element): boolean {
    const tag = element.tagName.toLowerCase();
    if (tag === 'button') return true;
    const role = element.getAttribute('role')?.toLowerCase();
    return role === 'button' || role === 'menuitem';
}

export function hasDirectReadableText(
    element: Element,
    shouldStayOriginal?: (element: Element) => boolean,
    protectionCache?: TranslationTextProtectionCache,
): boolean {
    if (element.childNodes.length > maxDirectRunNodes) return false;
    const inlineNodes = Array.from(element.childNodes).filter((child) =>
        child.nodeType === 3 || (child.nodeType === 1 && !isBlockBoundary(child as Element)));
    return hasMeaningfulTranslationTextInNodes(inlineNodes, shouldStayOriginal, protectionCache);
}

export function hasReadableBlockChild(
    element: Element,
    shouldStayOriginal?: (element: Element) => boolean,
    protectionCache?: TranslationTextProtectionCache,
): boolean {
    if (element.children.length > maxBlockChildrenToProbe) return true;
    return Array.from(element.children).some((child) => {
        if (!isBlockBoundary(child)) return false;
        return hasMeaningfulTranslationTextInNodes([child], shouldStayOriginal, protectionCache);
    });
}

/**
 * Split only the direct inline content of a mixed block. Block children are
 * barriers and keep their own candidates; protected inline nodes remain in the
 * run as atomic source structure while their text is excluded from requests.
 */
export function getDirectInlineRuns(
    element: Element,
    shouldStayOriginal?: (element: Element) => boolean,
    skipStructuralAncestorCheck = false,
    isAdditionalBarrier?: (element: Element) => boolean,
    protectionCache?: TranslationTextProtectionCache,
): ChildNode[][] {
    if (isDocumentSurface(element) || isStructuralContainer(element) ||
        (!skipStructuralAncestorCheck && hasStructuralAncestor(element))) return [];
    if (shouldStayOriginal?.(element) || isProtectedTextElement(element) || !isBlockBoundary(element)) return [];
    if (element.childNodes.length > maxDirectRunNodes) return [];
    if (!hasDirectReadableText(element, shouldStayOriginal, protectionCache)) return [];
    const hasBlockBarrier = hasReadableBlockChild(element, shouldStayOriginal, protectionCache);
    const hasAdditionalBarrier = !hasBlockBarrier && isAdditionalBarrier &&
        Array.from(element.children).some((child) => isAdditionalBarrier(child));
    if (!hasBlockBarrier && !hasAdditionalBarrier) return [];

    const runs: ChildNode[][] = [];
    let current: ChildNode[] = [];
    const flush = () => {
        if (current.length > 0 &&
            hasMeaningfulTranslationTextInNodes(current, shouldStayOriginal, protectionCache)) {
            runs.push(current);
        }
        current = [];
    };

    for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === 1 &&
            (isBlockBoundary(child as Element) || isAdditionalBarrier?.(child as Element))) {
            flush();
            continue;
        }
        current.push(child);
    }
    flush();
    return runs;
}

export interface GenericClassification {
    kind: 'content' | 'control';
    reason: string;
}

/**
 * Pure, local candidate classification shared by page discovery and hover.
 * It deliberately keeps boundary classification separate from render layout.
 */
export function classifyGenericCandidate(
    element: Element,
    shouldStayOriginal?: (element: Element) => boolean,
    skipStructuralAncestorCheck = false,
    protectionCache?: TranslationTextProtectionCache,
): GenericClassification | null {
    if (isDocumentSurface(element) || isStructuralContainer(element) ||
        (!skipStructuralAncestorCheck && hasStructuralAncestor(element))) {
        return null;
    }
    if (shouldStayOriginal?.(element) || isProtectedTextElement(element)) return null;

    if (isTranslationControlElement(element)) {
        if (!hasMeaningfulTranslationTextInNodes([element], shouldStayOriginal, protectionCache)) return null;
        return {kind: 'control', reason: 'generic-control'};
    }

    if (!isBlockBoundary(element)) return null;
    if (!hasMeaningfulTranslationTextInNodes([element], shouldStayOriginal, protectionCache)) return null;
    // A container with readable block children is a structural boundary, not
    // a fallback target. Choosing it from hover can translate an entire app
    // shell when the actual hit lives in a header/aside child.
    if (hasReadableBlockChild(element, shouldStayOriginal, protectionCache)) return null;
    return {kind: 'content', reason: 'generic-readable-block'};
}

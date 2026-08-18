import {getComposedParent, isDocumentSurface, isProtectedTextElement} from './dom';
import {
    hasMeaningfulTranslationTextInNodes,
} from './text';

const maxDirectRunNodes = 2048;
const maxBlockChildrenToProbe = 128;

const semanticBlockTags = new Set([
    'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt',
    'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'header', 'li', 'main', 'nav', 'ol', 'p', 'section', 'table', 'tbody',
    'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

// These elements are semantic content units even when a site's stylesheet
// lays them out inline. Moving one into a synthetic inline-run wrapper can
// break direct-child selectors (ar5iv does this for paragraphs inside list
// items), so they always remain segmentation barriers.
const semanticLeafBoundaryTags = new Set([
    'blockquote', 'dd', 'dt', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'li', 'p', 'td', 'th',
]);

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
    if (semanticLeafBoundaryTags.has(tag)) return true;
    const display = getElementDisplay(element);
    if (display) {
        if (display === 'none' || display === 'contents') return false;
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
    while (current && !isDocumentSurface(current)) {
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
): boolean {
    if (element.childNodes.length > maxDirectRunNodes) return false;
    const inlineNodes = Array.from(element.childNodes).filter((child) =>
        child.nodeType === 3 || (child.nodeType === 1 && !isBlockBoundary(child as Element)));
    return hasMeaningfulTranslationTextInNodes(inlineNodes, shouldStayOriginal);
}

export function hasReadableBlockChild(
    element: Element,
    shouldStayOriginal?: (element: Element) => boolean,
): boolean {
    if (element.children.length > maxBlockChildrenToProbe) return true;
    return Array.from(element.children).some((child) => {
        if (!isBlockBoundary(child)) return false;
        return hasMeaningfulTranslationTextInNodes([child], shouldStayOriginal);
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
): ChildNode[][] {
    if (isDocumentSurface(element) || isStructuralContainer(element) ||
        (!skipStructuralAncestorCheck && hasStructuralAncestor(element))) return [];
    if (shouldStayOriginal?.(element) || isProtectedTextElement(element) || !isBlockBoundary(element)) return [];
    if (element.childNodes.length > maxDirectRunNodes) return [];
    if (!hasDirectReadableText(element, shouldStayOriginal)) return [];
    const hasBlockBarrier = hasReadableBlockChild(element, shouldStayOriginal);
    const hasAdditionalBarrier = !hasBlockBarrier && isAdditionalBarrier &&
        Array.from(element.children).some((child) => isAdditionalBarrier(child));
    if (!hasBlockBarrier && !hasAdditionalBarrier) return [];

    const runs: ChildNode[][] = [];
    let current: ChildNode[] = [];
    const flush = () => {
        if (current.length > 0 && hasMeaningfulTranslationTextInNodes(current, shouldStayOriginal)) {
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
): GenericClassification | null {
    if (isDocumentSurface(element) || isStructuralContainer(element) ||
        (!skipStructuralAncestorCheck && hasStructuralAncestor(element))) {
        return null;
    }
    if (shouldStayOriginal?.(element) || isProtectedTextElement(element)) return null;

    if (isTranslationControlElement(element)) {
        if (!hasMeaningfulTranslationTextInNodes([element], shouldStayOriginal)) return null;
        return {kind: 'control', reason: 'generic-control'};
    }

    if (!isBlockBoundary(element)) return null;
    if (!hasMeaningfulTranslationTextInNodes([element], shouldStayOriginal)) return null;
    // A container with readable block children is a structural boundary, not
    // a fallback target. Choosing it from hover can translate an entire app
    // shell when the actual hit lives in a header/aside child.
    if (hasReadableBlockChild(element, shouldStayOriginal)) return null;
    return {kind: 'content', reason: 'generic-readable-block'};
}

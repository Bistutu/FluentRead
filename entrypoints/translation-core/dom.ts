const extensionSelector = [
    '#fluent-read-floating-ball-container',
    '#fluent-read-selection-translator-container',
    '#fluent-read-translation-status-container',
    '[data-fluent-read-ui]',
    '.fluent-read-video-ui',
    '.fluent-read-loading',
    '.fluent-read-retry-wrapper',
    '.fluent-read-bilingual-content',
    '[data-fr-translation-segment="true"]',
    '[data-fr-translation-owned="true"]',
].join(',');

const hardPruneTags = new Set([
    'head', 'script', 'style', 'noscript', 'iframe', 'input', 'textarea',
    'select', 'option', 'math', 'svg', 'canvas', 'audio', 'video', 'object',
    'template', 'xmp',
]);

const protectedTextTags = new Set([
    ...hardPruneTags,
    'pre', 'code', 'kbd', 'samp', 'var',
]);

export function getComposedParent(element: Element): Element | null {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode?.() as {host?: Element};
    return root?.host?.nodeType === 1 ? root.host : null;
}

export function* composedAncestors(element: Element): Generator<Element> {
    let current: Element | null = element;
    while (current) {
        yield current;
        current = getComposedParent(current);
    }
}

export function isDocumentSurface(element: Element): boolean {
    const owner = element.ownerDocument;
    return element === owner?.documentElement || element === owner?.body;
}

export function isExtensionElement(element: Element): boolean {
    return Boolean(element.matches(extensionSelector) || element.closest(extensionSelector));
}

export function isExtensionElementSelf(element: Element): boolean {
    return element.matches(extensionSelector);
}

export function isHardPruneTag(element: Element): boolean {
    return hardPruneTags.has(element.tagName.toLowerCase());
}

export function isProtectedTextElement(element: Element): boolean {
    return protectedTextTags.has(element.tagName.toLowerCase());
}

export function hasNoTranslateMarker(element: Element): boolean {
    return element.classList.contains('notranslate') ||
        element.getAttribute('translate')?.toLowerCase() === 'no' ||
        element.getAttribute('data-notranslate') === 'true';
}

export function hasHiddenMarker(element: Element): boolean {
    const htmlElement = element as HTMLElement;
    if (htmlElement.hidden || htmlElement.inert || element.hasAttribute('inert')) return true;
    if (element.getAttribute('aria-hidden') === 'true') return true;
    if (element.classList.contains('sr-only') || element.classList.contains('visually-hidden')) return true;

    try {
        const style = element.ownerDocument?.defaultView?.getComputedStyle(element);
        if (!style) return false;
        return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
    } catch {
        return false;
    }
}

function hasContentEditableMarker(element: Element): boolean {
    const attribute = element.getAttribute('contenteditable');
    return (attribute !== null && attribute.toLowerCase() !== 'false') ||
        (element as HTMLElement).isContentEditable;
}

/**
 * Descendant text guards are intentionally local. A protected inline child
 * must stay out of provider payloads without rejecting the readable paragraph
 * that contains it.
 */
export function isProtectedDescendantElement(element: Element): boolean {
    return isExtensionElementSelf(element) ||
        isProtectedTextElement(element) ||
        hasNoTranslateMarker(element) ||
        hasContentEditableMarker(element) ||
        hasHiddenMarker(element);
}

export interface HardGuardResult {
    prune: boolean;
    reason?: string;
}

export function evaluateElementHardGuard(element: Element): HardGuardResult {
    if (isExtensionElementSelf(element)) return {prune: true, reason: 'fluentread-owned'};
    if (isHardPruneTag(element)) return {prune: true, reason: `protected-tag:${element.tagName.toLowerCase()}`};
    if (hasNoTranslateMarker(element)) return {prune: true, reason: 'inherited-no-translate'};
    if (hasContentEditableMarker(element)) return {prune: true, reason: 'contenteditable'};
    if (hasHiddenMarker(element)) return {prune: true, reason: 'hidden'};
    return {prune: false};
}

/**
 * Hard guards are shared by initial discovery, hover resolution, mutations and
 * open Shadow DOM. Site adapters cannot override these safety boundaries.
 */
export function evaluateHardGuard(element: Element): HardGuardResult {
    for (const current of composedAncestors(element)) {
        const guard = evaluateElementHardGuard(current);
        if (guard.prune) return guard;
    }
    return {prune: false};
}

function collectImmediateOpenShadowRoots(root: Node): ShadowRoot[] {
    const result: ShadowRoot[] = [];
    const collect = (element: Element) => {
        if (element.shadowRoot) result.push(element.shadowRoot);
    };

    if (root.nodeType === 1) collect(root as Element);
    const document = root.ownerDocument ?? (root.nodeType === 9 ? root as Document : globalThis.document);
    if (!document?.createTreeWalker) return result;
    const walker = document.createTreeWalker(root, 1);
    let current = walker.nextNode();
    while (current) {
        if (current.nodeType === 1) collect(current as Element);
        current = walker.nextNode();
    }
    return result;
}

export function getOpenShadowRoots(root: Node): ShadowRoot[] {
    const result: ShadowRoot[] = [];
    const seen = new Set<ShadowRoot>();
    const pending: Node[] = [root];
    for (let index = 0; index < pending.length; index += 1) {
        const pendingRoot = pending[index];
        if (!pendingRoot) continue;
        for (const shadowRoot of collectImmediateOpenShadowRoots(pendingRoot)) {
            if (seen.has(shadowRoot)) continue;
            seen.add(shadowRoot);
            result.push(shadowRoot);
            pending.push(shadowRoot);
        }
    }
    return result;
}

export function safeMatches(element: Element, selector: string): boolean {
    try {
        return element.matches(selector);
    } catch {
        return false;
    }
}

export function safeClosest(element: Element, selector: string): Element | null {
    try {
        return element.closest(selector);
    } catch {
        return null;
    }
}

export function findElementsAtPoint(root: Document | ShadowRoot, x: number, y: number): Element[] {
    const pointRoot = root as Document & {elementsFromPoint?: (x: number, y: number) => Element[]};
    if (typeof pointRoot.elementsFromPoint === 'function') return pointRoot.elementsFromPoint(x, y);
    const element = root.elementFromPoint(x, y);
    return element ? [element] : [];
}

export function findNodeAtPoint(root: Document | ShadowRoot, x: number, y: number): Node | null {
    const document = root.nodeType === 9 ? root as Document : root.ownerDocument;
    try {
        const caretPosition = document?.caretPositionFromPoint?.(x, y);
        if (caretPosition?.offsetNode && root.contains(caretPosition.offsetNode)) return caretPosition.offsetNode;
    } catch {
        // Firefox-style caret lookup is optional and may reject shadow roots.
    }
    try {
        const range = document?.caretRangeFromPoint?.(x, y);
        if (range?.startContainer && root.contains(range.startContainer)) return range.startContainer;
    } catch {
        // Chromium-style caret lookup is optional.
    }
    return null;
}

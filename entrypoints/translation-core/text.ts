import {
    composedAncestors,
    getComposedParent,
    isProtectedDescendantElement,
    maxComposedAncestorDepth,
} from './dom';

const identifierPatterns = [
    /^https?:\/\/\S+$/iu,
    /^\S+@\S+\.\S+$/u,
    /^@[\p{L}\p{N}_-]+$/u,
    /^u\/[\p{L}\p{N}_-]+$/u,
    /^#[0-9]+$/u,
    /^[a-f0-9]{7,40}$/iu,
    /^\d+(?:[.,:/-]\d+)*(?:%|[a-z]+)?$/iu,
    /^[\p{L}\p{N}_.-]+\.(?:js|ts|tsx|jsx|vue|json|css|html|md|py|rs|go|java|c|cpp|h)$/iu,
];

export function normalizeTranslationText(value: string): string {
    return value.replace(/[\s\u3000]+/gu, ' ').trim();
}

export function isIdentifierLikeText(value: string): boolean {
    const text = normalizeTranslationText(value);
    return Boolean(text && identifierPatterns.some((pattern) => pattern.test(text)));
}

export function isMeaningfulTranslationText(value: string): boolean {
    const text = normalizeTranslationText(value);
    if (!text || isIdentifierLikeText(text)) return false;
    const letters = text.match(/\p{L}/gu)?.length ?? 0;
    return letters >= 2;
}

export function isTranslationTextNodeProtected(
    node: Text,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
): boolean {
    const parent = node.parentElement;
    if (!parent) return true;
    let depth = 0;
    for (const ancestor of composedAncestors(parent)) {
        depth += 1;
        if (depth > maxComposedAncestorDepth) return true;
        if (isProtectedDescendantElement(ancestor, ancestor === ignoredExtensionElement)) return true;
        if (shouldStayOriginal?.(ancestor)) return true;
    }
    return false;
}

function collectReadableText(
    roots: readonly Node[],
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
): string {
    const parts: string[] = [];
    for (const root of roots) {
        if (root.nodeType === 3) {
            const textNode = root as Text;
            if (!isTranslationTextNodeProtected(textNode, shouldStayOriginal, ignoredExtensionElement)) {
                const value = normalizeTranslationText(textNode.nodeValue ?? '');
                if (value) parts.push(value);
            }
            continue;
        }
        if (root.nodeType !== 1) continue;
        const element = root as Element;
        const document = element.ownerDocument;
        if (!document?.createTreeWalker) continue;
        const walker = document.createTreeWalker(element, 4);
        let current = walker.nextNode();
        while (current) {
            const textNode = current as Text;
            if (!isTranslationTextNodeProtected(textNode, shouldStayOriginal, ignoredExtensionElement)) {
                const value = normalizeTranslationText(textNode.nodeValue ?? '');
                if (value) parts.push(value);
            }
            current = walker.nextNode();
        }
    }
    return normalizeTranslationText(parts.join(' '));
}

const discoveryTextNodeBudget = 256;
const discoveryCharacterBudget = 8192;
const discoveryVisitedNodeBudget = 2048;

interface TranslationTextProtectionState {
    depth: number;
    protected: boolean;
}

export type TranslationTextProtectionCache = WeakMap<Element, TranslationTextProtectionState>;

export function createTranslationTextProtectionCache(): TranslationTextProtectionCache {
    return new WeakMap<Element, TranslationTextProtectionState>();
}

/**
 * Cache inherited text protection for one hover/discovery operation. When the
 * caller walks from an ancestor to its children, every lookup after the root is
 * O(1). A dirty subtree whose external ancestry is already adversarially deep
 * is conservatively marked protected after one bounded lookup.
 */
export function isTranslationTextElementProtected(
    element: Element,
    shouldStayOriginal: ((element: Element) => boolean) | undefined,
    protectionCache: TranslationTextProtectionCache,
): boolean {
    const cached = protectionCache.get(element);
    if (cached) return cached.protected;

    const chain: Element[] = [];
    let current: Element | null = element;
    while (current && !protectionCache.has(current)) {
        if (chain.length >= maxComposedAncestorDepth) {
            protectionCache.set(element, {
                depth: maxComposedAncestorDepth + 1,
                protected: true,
            });
            return true;
        }
        chain.push(current);
        current = getComposedParent(current);
    }

    const inherited = current ? protectionCache.get(current) : undefined;
    let depth = inherited?.depth ?? 0;
    let protectedByAncestor = inherited?.protected ?? false;
    for (let index = chain.length - 1; index >= 0; index -= 1) {
        const item = chain[index]!;
        depth += 1;
        protectedByAncestor = protectedByAncestor ||
            depth > maxComposedAncestorDepth ||
            isProtectedDescendantElement(item) ||
            shouldStayOriginal?.(item) === true;
        protectionCache.set(item, {depth, protected: protectedByAncestor});
    }
    return protectionCache.get(element)?.protected === true;
}

/**
 * A bounded readability probe for discovery. Rendering still takes an exact
 * snapshot later, but one generator step must never walk an unbounded inline
 * subtree before the runtime can yield back to the host page.
 */
export function hasMeaningfulTranslationTextInNodes(
    roots: readonly Node[],
    shouldStayOriginal?: (element: Element) => boolean,
    protectionCache = createTranslationTextProtectionCache(),
): boolean {
    const stack: Array<{node: Node; nextChildIndex: number; entered: boolean}> = [];
    const parts: string[] = [];
    let textNodes = 0;
    let characters = 0;
    let visitedNodes = 0;
    let rootIndex = 0;

    const elementIsProtected = (element: Element): boolean =>
        isTranslationTextElementProtected(element, shouldStayOriginal, protectionCache);

    while (textNodes < discoveryTextNodeBudget && characters < discoveryCharacterBudget) {
        if (stack.length === 0) {
            if (rootIndex >= roots.length) break;
            const root = roots[rootIndex];
            rootIndex += 1;
            if (root) stack.push({node: root, nextChildIndex: 0, entered: false});
            continue;
        }

        const frame = stack[stack.length - 1];
        if (!frame) break;
        if (!frame.entered) {
            frame.entered = true;
            visitedNodes += 1;
            // Preserve whatever evidence has already been collected, but do
            // not turn a huge text-free subtree into a translation target. A
            // false positive would merely move the unbounded walk to exact
            // source extraction immediately before the provider request.
            if (visitedNodes > discoveryVisitedNodeBudget) {
                return isMeaningfulTranslationText(parts.join(' '));
            }
        }

        const current = frame.node;
        if (current.nodeType === 3) {
            stack.pop();
            const textNode = current as Text;
            if (!textNode.parentElement || elementIsProtected(textNode.parentElement)) continue;
            textNodes += 1;
            const remaining = discoveryCharacterBudget - characters;
            const value = normalizeTranslationText((textNode.nodeValue ?? '').slice(0, remaining));
            if (!value) continue;
            parts.push(value);
            characters += value.length;
            continue;
        }
        if (current.nodeType !== 1) {
            stack.pop();
            continue;
        }
        const element = current as Element;
        if (elementIsProtected(element)) {
            stack.pop();
            continue;
        }
        const child = current.childNodes[frame.nextChildIndex];
        frame.nextChildIndex += 1;
        if (child) {
            stack.push({node: child, nextChildIndex: 0, entered: false});
        } else {
            stack.pop();
        }
    }

    return isMeaningfulTranslationText(parts.join(' '));
}

export function extractTranslationTextFromNodes(
    nodes: readonly Node[],
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
): string {
    return collectReadableText(nodes, shouldStayOriginal, ignoredExtensionElement);
}

/** Extract readable host-page text without cloning the candidate subtree. */
export function extractTranslationText(
    element: Element,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
): string {
    return collectReadableText([element], shouldStayOriginal, ignoredExtensionElement);
}

const hanPattern = /\p{Script=Han}/gu;
const japanesePattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const hangulPattern = /\p{Script=Hangul}/gu;
const latinPattern = /\p{Script=Latin}/gu;

/**
 * Short UI strings are where statistical language detection is least reliable.
 * Only skip them when the target script is clearly dominant; otherwise let the
 * provider translate them. Long-text detection remains a secondary check in
 * the runtime.
 */
export function isClearlyTargetLanguage(value: string, targetLanguage: string): boolean {
    const text = normalizeTranslationText(value);
    if (!text) return true;
    const target = targetLanguage.toLowerCase();
    const letters = text.match(/\p{L}/gu)?.length ?? 0;
    if (letters === 0) return true;

    if (target.startsWith('zh') || target.startsWith('ja') || target.startsWith('ko')) {
        const targetPattern = target.startsWith('zh')
            ? hanPattern
            : target.startsWith('ja') ? japanesePattern : hangulPattern;
        const targetScript = text.match(targetPattern)?.length ?? 0;
        const latin = text.match(latinPattern)?.length ?? 0;
        return targetScript > 0 && targetScript >= latin * 2;
    }
    if (target.startsWith('en')) {
        const latin = text.match(latinPattern)?.length ?? 0;
        return latin >= 3 && latin / letters >= 0.85;
    }
    return false;
}

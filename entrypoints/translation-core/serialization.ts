import {isTranslationTextNodeProtected} from './text';

const translationArtifactSelector = [
    '.fluent-read-bilingual-content',
    '.fluent-read-loading',
    '.fluent-read-retry-wrapper',
    '[data-fr-translation-owned="true"]',
].join(',');

export interface TranslationTextSlot {
    node: Text;
    prefix: string;
    suffix: string;
    source: string;
}

export interface TranslationSourceSnapshot {
    clone: HTMLElement;
    slots: TranslationTextSlot[];
}

export interface SerializedTranslationSlots {
    payload: string;
    starts: readonly string[];
    ends: readonly string[];
}

function hashSlotSources(sources: readonly string[]): string {
    let hash = 2166136261;
    for (const source of sources) {
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        hash ^= 0xff;
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

/**
 * Encode several pure-text slots into one provider request. The deterministic
 * nonce keeps whole-paragraph cache keys stable; a collision suffix is added
 * if source text already contains one of our exact sentinels.
 */
export function serializeTranslationSlots(
    sources: readonly string[],
    requestedNonce = hashSlotSources(sources),
): SerializedTranslationSlots {
    let nonce = requestedNonce.replace(/[^a-z0-9_-]/giu, '') || 'slots';
    let collision = 0;
    const hasCollision = (candidate: string) => sources.some((source, index) =>
        source.includes(`___FLUENTREAD_${candidate}_${index}_BEGIN___`) ||
        source.includes(`___FLUENTREAD_${candidate}_${index}_END___`));
    while (hasCollision(nonce)) {
        collision += 1;
        nonce = `${requestedNonce}_${collision}`.replace(/[^a-z0-9_-]/giu, '');
    }

    const starts = sources.map((_, index) => `___FLUENTREAD_${nonce}_${index}_BEGIN___`);
    const ends = sources.map((_, index) => `___FLUENTREAD_${nonce}_${index}_END___`);
    const payload = sources.map((source, index) => `${starts[index]}${source}${ends[index]}`).join('\n');
    return {payload, starts, ends};
}

/** Strictly accept one ordered result per slot; prose/fences outside markers reject the packet. */
export function parseTranslationSlots(
    packet: SerializedTranslationSlots,
    translated: string,
): string[] | null {
    if (packet.starts.length !== packet.ends.length) return null;
    const results: string[] = [];
    let cursor = 0;
    for (let index = 0; index < packet.starts.length; index += 1) {
        const start = packet.starts[index];
        const end = packet.ends[index];
        if (!start || !end) return null;
        const startIndex = translated.indexOf(start, cursor);
        if (startIndex < 0 || translated.slice(cursor, startIndex).trim()) return null;
        const valueStart = startIndex + start.length;
        const endIndex = translated.indexOf(end, valueStart);
        if (endIndex < 0) return null;
        if (translated.indexOf(start, valueStart) >= 0 && translated.indexOf(start, valueStart) < endIndex) return null;
        results.push(translated.slice(valueStart, endIndex));
        cursor = endIndex + end.length;
    }
    return translated.slice(cursor).trim() ? null : results;
}

type TranslationTextSlotParts = Omit<TranslationTextSlot, 'node'>;

function translationTextSlotParts(
    node: Text,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
): TranslationTextSlotParts | null {
    const value = node.nodeValue ?? '';
    const match = value.match(/^(\s*)([\s\S]*?\S)(\s*)$/u);
    if (!match || isTranslationTextNodeProtected(node, shouldStayOriginal, ignoredExtensionElement)) return null;
    return {prefix: match[1], source: match[2], suffix: match[3]};
}

function collectSlots(
    root: HTMLElement,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
): TranslationTextSlot[] {
    const slots: TranslationTextSlot[] = [];
    const document = root.ownerDocument;
    if (!document?.createTreeWalker) return slots;
    const walker = document.createTreeWalker(root, 4);
    let current = walker.nextNode();
    while (current) {
        const node = current as Text;
        const parts = translationTextSlotParts(node, shouldStayOriginal, ignoredExtensionElement);
        if (parts) slots.push({node, ...parts});
        current = walker.nextNode();
    }
    return slots;
}

function collectSnapshotSlots(
    liveRoot: HTMLElement,
    cloneRoot: HTMLElement,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
): TranslationTextSlot[] {
    const document = liveRoot.ownerDocument;
    if (!document?.createTreeWalker) return [];

    // cloneNode(true) preserves text-node document order. Walking both trees in
    // lockstep maps each live slot to its clone in O(number of text nodes),
    // without rebuilding a sibling-index path for every slot.
    const liveWalker = document.createTreeWalker(liveRoot, 4);
    const cloneWalker = document.createTreeWalker(cloneRoot, 4);
    const slots: TranslationTextSlot[] = [];
    let liveNode = liveWalker.nextNode();
    let cloneNode = cloneWalker.nextNode();
    while (liveNode && cloneNode) {
        const parts = translationTextSlotParts(
            liveNode as Text,
            shouldStayOriginal,
            ignoredExtensionElement,
        );
        if (parts) slots.push({node: cloneNode as Text, ...parts});
        liveNode = liveWalker.nextNode();
        cloneNode = cloneWalker.nextNode();
    }
    return slots;
}

/**
 * Build a local DOM skeleton and expose only its translatable text slots.
 * Provider responses can therefore never rewrite hrefs, inline code, opt-out
 * content, attributes, or host event-bearing nodes.
 */
export function createTranslationSourceSnapshot(
    node: HTMLElement,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
): TranslationSourceSnapshot {
    const clone = node.cloneNode(true) as HTMLElement;
    // Decide every slot against the live composed tree. The detached clone no
    // longer has external ancestors needed by site selectors, inherited
    // contenteditable, or CSS visibility rules; it is used only as the mapped
    // output skeleton.
    const slots = collectSnapshotSlots(node, clone, shouldStayOriginal, ignoredExtensionElement);
    clone.querySelectorAll(translationArtifactSelector).forEach((child) => child.remove());
    return {clone, slots};
}

export function collectLiveTranslationTextSlots(
    node: HTMLElement,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
): TranslationTextSlot[] {
    return collectSlots(node, shouldStayOriginal, ignoredExtensionElement);
}

export function applyTranslationsToSnapshot(
    snapshot: TranslationSourceSnapshot,
    translations: readonly string[],
): string {
    snapshot.slots.forEach((slot, index) => {
        const translation = translations[index];
        if (translation !== undefined) slot.node.nodeValue = `${slot.prefix}${translation}${slot.suffix}`;
    });
    return snapshot.clone.innerHTML;
}

function clearStyleProperty(node: HTMLElement, property: string): void {
    const style = node.style as unknown as Record<string, string | undefined>;
    if (style[property] !== undefined) style[property] = '';
}

export function removeTranslationTruncation(node: HTMLElement): void {
    clearStyleProperty(node, 'webkitLineClamp');
    node.style.webkitLineClamp = 'unset';
    node.style.maxHeight = 'unset';
}

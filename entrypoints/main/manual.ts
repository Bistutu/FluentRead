import { findTextChunk, findTextParagraph } from '@/entrypoints/main/chunk';

interface TextNodePosition {
    node: Text;
    start: number;
    end: number;
}

interface TextLayout {
    text: string;
    positions: TextNodePosition[];
}

type CaretDocument = Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

const containerChunkThreshold = 640;
export const manualChunkClass = 'fluent-read-translation-chunk';
export const manualChunkSourceClass = 'fluent-read-translation-chunk-source';
export const manualChunkTranslationClass = 'fluent-read-translation-chunk-content';
let chunkId = 0;

export function existingManualChunk(hit: Element): Element | null {
    return hit.closest(`.${manualChunkClass}`);
}

export function refineManualNode(hit: Element, resolved: Element, semanticSelector: string, x: number, y: number): Element {
    const semantic = hit.closest(semanticSelector);
    const host = semantic && (semantic.contains(resolved) || resolved.contains(semantic)) ? semantic : resolved;
    const selection = window.getSelection();

    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (host.contains(range.startContainer) && host.contains(range.endContainer) && range.toString().trim()) {
            return wrapRange(range);
        }
    }

    if (host === semantic) return host;

    const { text, positions } = collectTextLayout(host);

    const caret = caretAtPoint(x, y);
    const offset = caret && textOffset(positions, caret.node, caret.offset);
    if (offset === false || offset === null) return host;

    const paragraph = findTextParagraph(text, offset);
    if (paragraph) return wrapRange(rangeFromOffsets(positions, paragraph.start, paragraph.end));
    if (text.trim().length <= containerChunkThreshold) return host;

    const chunk = findTextChunk(text, offset);
    return wrapRange(rangeFromOffsets(positions, chunk.start, chunk.end));
}

export function unwrapManualChunk(node: Element) {
    const parent = node.parentNode;
    if (!parent) return;
    const source = node.querySelector(`:scope > .${manualChunkSourceClass}`)!;
    source.removeAttribute('hidden');
    node.replaceWith(...Array.from(source.childNodes));
    parent.normalize();
}

function collectTextLayout(root: Element): TextLayout {
    const positions: TextNodePosition[] = [];
    const styles = new WeakMap<Element, CSSStyleDeclaration>();
    let text = '';

    const styleOf = (node: Element) => {
        let style = styles.get(node);
        if (!style) {
            style = getComputedStyle(node);
            styles.set(node, style);
        }
        return style;
    };

    const appendParagraphBreak = () => {
        const trailingBreaks = text.match(/\n*$/)?.[0].length ?? 0;
        if (trailingBreaks < 2) text += '\n'.repeat(2 - trailingBreaks);
    };

    const visit = (parent: Element) => {
        for (const child of parent.childNodes) {
            if (child instanceof Text) {
                const whiteSpace = styleOf(parent).whiteSpace;
                const value = /^(pre|pre-line|pre-wrap|break-spaces)$/.test(whiteSpace)
                    ? child.data
                    : child.data.replace(/[\r\n]/g, ' ');
                positions.push({ node: child, start: text.length, end: text.length + value.length });
                text += value;
                continue;
            }

            if (!(child instanceof Element) || shouldIgnore(child, styleOf(child).display)) continue;
            if (child.tagName === 'BR') {
                text += '\n';
                continue;
            }

            const block = isLayoutBlock(styleOf(child).display);
            if (block && text) appendParagraphBreak();
            visit(child);
            if (block) appendParagraphBreak();
        }
    };

    visit(root);
    return { text, positions };
}

function shouldIgnore(node: Element, display: string): boolean {
    return node.matches(`button, input, select, textarea, [aria-hidden="true"], .sr-only, .fluent-read-bilingual-content, .${manualChunkTranslationClass}, .fluent-read-loading, .fluent-read-retry-wrapper`)
        || display === 'none';
}

function isLayoutBlock(display: string): boolean {
    return display === 'block'
        || display === 'flex'
        || display === 'grid'
        || display === 'list-item'
        || display.startsWith('table');
}

function caretAtPoint(x: number, y: number): { node: Node; offset: number } | null {
    const caretDocument = document as CaretDocument;
    const position = caretDocument.caretPositionFromPoint?.(x, y);
    if (position) return { node: position.offsetNode, offset: position.offset };

    const range = caretDocument.caretRangeFromPoint?.(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

function textOffset(positions: TextNodePosition[], node: Node, offset: number): number | false {
    const position = positions.find(item => item.node === node);
    return position ? position.start + offset : false;
}

function rangeFromOffsets(positions: TextNodePosition[], start: number, end: number): Range {
    const startPosition = positions.find(position => start < position.end) ?? positions.at(-1)!;
    const endPosition = positions.find(position => end <= position.end) ?? positions.at(-1)!;
    const range = document.createRange();
    range.setStart(startPosition.node, Math.max(0, start - startPosition.start));
    range.setEnd(endPosition.node, Math.min(endPosition.node.length, end - endPosition.start));
    return range;
}

function wrapRange(range: Range): Element {
    const wrapper = document.createElement('span');
    const source = document.createElement('span');
    wrapper.className = manualChunkClass;
    wrapper.dataset.frChunkId = `fr-chunk-${chunkId++}`;
    source.className = manualChunkSourceClass;
    source.append(range.extractContents());
    wrapper.append(source);
    range.insertNode(wrapper);
    window.getSelection()?.removeAllRanges();
    return wrapper;
}

import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {registerManpagePreparation, unregisterManpagePreparation} from '@/src/core/translation/manpage';
import {alignManpageTranslation, prepareManpageTranslation} from '@/src/features/full-page-translation/content/manpageLayout';

const registered: {pre: Element; paragraph: Element}[] = [];
afterEach(() => {
    registered.forEach(({pre, paragraph}) => unregisterManpagePreparation(pre, [paragraph]));
    registered.length = 0;
    vi.restoreAllMocks();
});

function fixture(source = '       First source line.\n       Second source line.\n', trusted = true) {
    const {document} = parseHTML(`<html><body><pre><span id="source">${source}</span></pre></body></html>`);
    const paragraph = document.querySelector<HTMLElement>('#source')!;
    const pre = document.querySelector('pre')!;
    if (trusted) {
        registerManpagePreparation(pre, [paragraph]);
        registered.push({pre, paragraph});
    }
    const content = document.createElement('span');
    content.setAttribute('data-fr-translation-owned', 'true');
    content.innerHTML = '第一行<br>第二行';
    const sourceText = paragraph.textContent!;
    const offsets = new Map<Text, number>();
    const walker = document.createTreeWalker(paragraph, 4);
    let cursor = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        offsets.set(node as Text, cursor);
        cursor += node.nodeValue!.length;
    }
    const measure = vi.fn((text: Text, offset: number) => {
        const before = sourceText.slice(0, offsets.get(text)! + offset);
        const column = before.length - before.lastIndexOf('\n') - 1;
        return {left: 12 + column * 10, width: 10, height: 16} as DOMRect;
    });
    const createRange = vi.fn(() => {
        let text: Text, offset: number;
        return {setStart: (node: Text, start: number) => {text = node; offset = start;},
            setEnd: vi.fn(), getBoundingClientRect: () => measure(text!, offset!)} as unknown as Range;
    });
    Object.defineProperty(document, 'createRange', {value: createRange, configurable: true});
    const computedStyle = vi.fn(() => ({borderLeftWidth: '2px'} as CSSStyleDeclaration));
    Object.defineProperty(document.defaultView!, 'getComputedStyle', {value: computedStyle, configurable: true});
    const box = vi.fn(() => ({left: 10, width: 800, height: 60} as DOMRect));
    content.getBoundingClientRect = box;
    return {document, pre, paragraph, content, sourceText, measure, createRange, computedStyle, box};
}

function expectAlignment(content: HTMLElement, padding: number, firstIndent: number) {
    expect(content.style.getPropertyValue('padding-left')).toBe(`${padding}px`);
    expect(content.style.getPropertyValue('text-indent')).toBe(`${firstIndent}px`);
}

function expectUnaligned(content: HTMLElement) {
    expect(content.style.getPropertyValue('padding-left')).toBeFalsy();
    expect(content.style.getPropertyValue('text-indent')).toBeFalsy();
}

describe('man7 translation source alignment', () => {
    it('requires the runtime paragraph identity and ignores forged attributes', () => {
        const {paragraph, content, createRange} = fixture(undefined, false);
        paragraph.setAttribute('data-fr-manpage-paragraph', 'true');
        const html = content.innerHTML;
        prepareManpageTranslation(paragraph, content);
        alignManpageTranslation(paragraph, content);
        expect(content.innerHTML).toBe(html);
        expect(content.style.getPropertyValue('white-space')).toBeFalsy();
        expect(createRange).not.toHaveBeenCalled();
        expectUnaligned(content);
    });

    it('reflows copied manual line breaks without changing original text, nodes or links', () => {
        const {paragraph, content} = fixture('       Read <a href="https://example.test/">this link</a>.\n       More source.\n');
        const html = paragraph.innerHTML, children = [...paragraph.childNodes], link = paragraph.querySelector('a');
        content.innerHTML = '第一行\n<a href="https://example.test/">链接<br>后续文字</a><br>末行';
        prepareManpageTranslation(paragraph, content);
        expect(content.textContent).toBe('第一行\n链接 后续文字 末行');
        expect(content.querySelector('br')).toBeNull();
        expect(content.querySelector('a')?.getAttribute('href')).toBe('https://example.test/');
        expect(content.style.getPropertyValue('white-space')).toBe('normal');
        expect(paragraph.innerHTML).toBe(html);
        expect([...paragraph.childNodes]).toEqual(children);
        expect(paragraph.querySelector('a')).toBe(link);
    });

    it('aligns ordinary paragraphs using source glyph geometry across inline elements and empty lines', () => {
        const {paragraph, content, measure} = fixture('\n  \n       <i>First source</i> line.\n       <a>Second</a> source line.\n');
        const html = paragraph.innerHTML;
        paragraph.appendChild(content);
        alignManpageTranslation(paragraph, content);
        expectAlignment(content, 70, 0);
        expect(measure.mock.calls.map(([text, offset]) => text.data[offset])).toEqual(['F', 'S']);
        expect(paragraph.innerHTML.replace(content.outerHTML, '')).toBe(html);
    });

    it.each([
        ['       •  First list item.\n          Continued item.\n', 100, -30],
        ['           %c  Core file size limit\n               (since Linux 2.6.24).\n', 150, -40],
        ['   Small heading\n', 30, 0],
        ['\tA single source line', 10, 0],
    ])('preserves hanging or single-line offsets for %j', (source, padding, indent) => {
        const {paragraph, content} = fixture(source);
        paragraph.appendChild(content);
        alignManpageTranslation(paragraph, content);
        expectAlignment(content, padding, indent);
    });

    it('ignores preceding translations and loading/retry artifacts when measuring a refreshed paragraph', () => {
        const {paragraph, content, document, measure} = fixture();
        for (const [attribute, value] of [['data-fr-translation-owned', 'true'], ['class', 'fluent-read-loading'], ['class', 'fluent-read-retry-wrapper']]) {
            const artifact = document.createElement('span');
            artifact.setAttribute(attribute!, value!);
            artifact.innerHTML = '<b>  伪造首行\n        伪造续行</b>';
            paragraph.insertBefore(artifact, paragraph.firstChild);
        }
        paragraph.insertBefore(content, paragraph.firstChild);
        alignManpageTranslation(paragraph, content);
        expectAlignment(content, 70, 0);
        expect(measure.mock.calls.map(([text, offset]) => text.data[offset])).toEqual(['F', 'S']);
        alignManpageTranslation(paragraph, content);
        expectAlignment(content, 70, 0);
    });

    it.each([
        ['       First source line.\n       Second source line.\n', 8, 62, 0],
        ['       •  First list item.\n          Continued item.\n', 8, 92, -30],
        ['           %c  Core limit\n               Continued definition.\n', 8, 142, -40],
        ['       First source line.\n       Second source line.\n', 0, 70, 0],
    ])('compensates per-line marker padding while preserving its decoration for %j', (source, padding, outerPadding, indent) => {
        const {paragraph, content, document, computedStyle} = fixture(source);
        const markedText = document.createElement('span');
        markedText.className = 'fluent-read-translation-text';
        markedText.style.padding = '0.12em 0.5em';
        markedText.style.setProperty('box-decoration-break', 'clone');
        markedText.textContent = '带有逐行底色的译文';
        content.replaceChildren(markedText);
        content.className = 'fluent-read-bilingual-content fluent-display-line-pill';
        const decoration = markedText.getAttribute('style');
        computedStyle.mockImplementation((target?: Element) => target === markedText
            ? {paddingLeft: `${padding}px`} as CSSStyleDeclaration : {borderLeftWidth: '2px'} as CSSStyleDeclaration);
        paragraph.appendChild(content);
        alignManpageTranslation(paragraph, content);
        expectAlignment(content, outerPadding, indent);
        expect(markedText.getAttribute('style')).toBe(decoration);
    });

    it('uses zero marker padding when that style is unavailable', () => {
        const {paragraph, content, document, computedStyle} = fixture();
        const markedText = document.createElement('span');
        markedText.className = 'fluent-read-translation-text';
        content.appendChild(markedText);
        computedStyle.mockImplementation((target?: Element) => target === markedText
            ? {} as CSSStyleDeclaration : {borderLeftWidth: '2px'} as CSSStyleDeclaration);
        alignManpageTranslation(paragraph, content);
        expectAlignment(content, 70, 0);
        Object.defineProperty(document, 'defaultView', {value: null, configurable: true});
        alignManpageTranslation(paragraph, content);
        expectAlignment(content, 72, 0);
    });

    it.each(['', ' \n\t\n  '])('leaves empty source geometry alone: %j', source => {
        const {paragraph, content, createRange} = fixture(source);
        paragraph.appendChild(content);
        alignManpageTranslation(paragraph, content);
        expect(createRange).not.toHaveBeenCalled();
        expectUnaligned(content);
    });

    it('bounds scans of long whitespace and excessive source nodes', () => {
        const long = fixture(' '.repeat(16_384) + 'A source beyond the safe scan limit.');
        alignManpageTranslation(long.paragraph, long.content);
        expectUnaligned(long.content);
        const many = fixture('<i> </i>'.repeat(2048) + 'A source beyond the safe node limit.');
        alignManpageTranslation(many.paragraph, many.content);
        expectUnaligned(many.content);
    });

    it.each([
        {left: 10, width: 0, height: 20},
        {left: 10, width: 100, height: 0},
        {left: Number.NaN, width: 100, height: 20},
    ])('preserves the fallback if translation geometry is unavailable: %j', rect => {
        const {paragraph, content, box} = fixture();
        box.mockReturnValue(rect as DOMRect);
        alignManpageTranslation(paragraph, content);
        expectUnaligned(content);
    });

    it('preserves the fallback for hidden source glyphs or source/translation layout exceptions', () => {
        const hidden = fixture();
        hidden.measure.mockReturnValue({left: 82, width: 0, height: 16} as DOMRect);
        alignManpageTranslation(hidden.paragraph, hidden.content);
        expectUnaligned(hidden.content);
        const missingRange = fixture();
        missingRange.createRange.mockImplementation(() => {throw new Error('No layout');});
        alignManpageTranslation(missingRange.paragraph, missingRange.content);
        expectUnaligned(missingRange.content);
        const missingStyle = fixture();
        missingStyle.computedStyle.mockImplementation(() => {throw new Error('Detached view');});
        alignManpageTranslation(missingStyle.paragraph, missingStyle.content);
        expectUnaligned(missingStyle.content);
    });

    it.each([
        [8, 82],
        [82, 8],
    ])('declines negative source offsets instead of shifting text outside the translation box', (first, second) => {
        const {paragraph, content, measure} = fixture();
        measure.mockReturnValueOnce({left: first, width: 10, height: 16} as DOMRect)
            .mockReturnValueOnce({left: second, width: 10, height: 16} as DOMRect);
        alignManpageTranslation(paragraph, content);
        expectUnaligned(content);
    });

    it('treats unavailable border widths as zero and declines nonfinite computed geometry', () => {
        const unset = fixture();
        unset.computedStyle.mockReturnValue({borderLeftWidth: 'medium'} as CSSStyleDeclaration);
        alignManpageTranslation(unset.paragraph, unset.content);
        expectAlignment(unset.content, 72, 0);
        const noView = fixture();
        Object.defineProperty(noView.document, 'defaultView', {value: null, configurable: true});
        alignManpageTranslation(noView.paragraph, noView.content);
        expectAlignment(noView.content, 72, 0);
        const infinite = fixture();
        infinite.computedStyle.mockReturnValue({borderLeftWidth: '-Infinity'} as CSSStyleDeclaration);
        alignManpageTranslation(infinite.paragraph, infinite.content);
        expectUnaligned(infinite.content);
    });
});

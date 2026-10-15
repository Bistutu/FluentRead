import {describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {
    MATERIAL_ORIGINAL_TEXT_LIMITS,
    locateMaterialOriginalQuote,
    projectMaterialOriginalText,
} from '@/src/features/vocabulary/materialOriginalText';

function fixture(content: string) {
    const {document, window} = parseHTML(`<html><body>${content}</body></html>`);
    return {document, window, paragraph: document.querySelector('p')!};
}

// LinkeDOM supplies real connected nodes but has no DOM Range.setStart/setEnd.
// Keep only its read-only boundary contract here; the browser evidence separately exercises native Range.
const rangeAt = (startContainer: Node, startOffset = 0, endContainer = startContainer, endOffset = startContainer.nodeType === 3 ? (startContainer as Text).length : startContainer.childNodes.length) =>
    ({startContainer, startOffset, endContainer, endOffset}) as Range;

describe('bounded original text for material locators', () => {
    it('removes the bilingual translation that previously poisoned saved paragraph quotes', () => {
        const {paragraph} = fixture('<p>Original sentence long enough to be saved.<span class="fluent-read-bilingual-content">译文内容。</span></p>');
        expect(projectMaterialOriginalText(paragraph)?.text).toBe('Original sentence long enough to be saved.');
        paragraph.lastChild!.remove();
        expect(projectMaterialOriginalText(paragraph)?.text).toBe('Original sentence long enough to be saved.');
    });

    it('preserves ordinary links and inline formatting without changing nodes or HTML', () => {
        const {paragraph} = fixture('<p>Keep <a href="/source">linked <strong>original</strong></a> and <em>meaning</em>.<span data-fluent-read-ui>TOOLS</span></p>');
        const before = paragraph.outerHTML, child = paragraph.firstChild;
        const selection = rangeAt(paragraph.querySelector('strong')!.firstChild!);
        const projected = projectMaterialOriginalText(paragraph, selection)!;
        expect(projected.text).toBe('Keep linked original and meaning.');
        expect(projected.selection).toEqual({start: 12, end: 20});
        expect(locateMaterialOriginalQuote(projected, projected.text)?.quote).toBe('Keep linked original and meaning.');
        expect(paragraph.outerHTML).toBe(before);
        expect(paragraph.firstChild).toBe(child);
        expect(selection.startOffset).toBe(0);
    });

    it.each([
        {markup: '<code>getUserID</code>', text: 'getUserID'},
        {markup: '<kbd>Ctrl</kbd>', text: 'Ctrl'},
        {markup: '<span class="notranslate">getUserID</span>', text: 'getUserID'},
        {markup: '<span data-notranslate="true">getUserID</span>', text: 'getUserID'},
    ])('retains visible original text from $markup in the expanded quote', ({markup, text}) => {
        const {paragraph} = fixture(`<p>Use ${markup} to load.</p>`);
        const tail = paragraph.lastChild!;
        const offset = tail.textContent!.indexOf('load');
        const projected = projectMaterialOriginalText(paragraph, rangeAt(tail, offset, tail, offset + 4))!;
        const quote = `Use ${text} to load.`;
        expect(projected.text).toBe(quote);
        expect(projected.selection).toEqual({start: quote.indexOf('load'), end: quote.indexOf('load') + 4});
        expect(locateMaterialOriginalQuote(projected, quote)?.quote).toBe(quote);
        const inside = projectMaterialOriginalText(paragraph, rangeAt(paragraph.children[0].firstChild!))!;
        expect(locateMaterialOriginalQuote(inside, quote)?.index).toBe(0);
    });

    it.each(['class="notranslate"', 'data-notranslate="true"'])('retains original prose under a translation opt-out ancestor: %s', attributes => {
        const {document, paragraph} = fixture(`<div ${attributes}><p>Visible original source.</p></div>`);
        document.body.classList.add('notranslate');
        const projection = projectMaterialOriginalText(paragraph, rangeAt(paragraph.firstChild!))!;
        expect(locateMaterialOriginalQuote(projection, 'Visible original source.')?.quote).toBe('Visible original source.');
    });

    it('still excludes inline code in hidden, editable or FluentRead-owned branches and code blocks', () => {
        const {document, paragraph} = fixture('<p>Visible <code hidden>SECRET</code><span contenteditable><kbd>PRIVATE</kbd></span><span data-fluent-read-ui><code>TOOLS</code></span>original.</p>');
        const block = document.createElement('pre'); block.innerHTML = '<code>BLOCK SECRET</code>'; paragraph.append(block);
        expect(projectMaterialOriginalText(paragraph)?.text).toBe('Visible original.');
        for (const code of paragraph.querySelectorAll('code,kbd')) expect(projectMaterialOriginalText(paragraph, rangeAt(code.firstChild!))).toBeUndefined();
    });

    it.each([
        '<script>secret</script>', '<style>secret</style>', '<noscript>secret</noscript>', '<template>secret</template>',
        '<textarea>secret</textarea>', '<button>secret</button>', '<select><option>secret</option></select>',
        '<svg><text>secret</text></svg>', '<math>secret</math>',
        '<span hidden>secret</span>', '<span inert>secret</span>', '<span aria-hidden="true">secret</span>',
        '<span contenteditable="true">secret</span>', '<span contenteditable>secret</span>', '<span role="textbox">secret</span>',
        '<span role="button">secret</span>', '<span data-fr-translation-owned="true">secret</span>',
        '<span data-fluent-read-ui>secret</span>', '<span id="fluent-read-toolbar">secret</span>',
        '<span class="fluent-read-translation-text">secret</span>',
    ])('does not collect the excluded descendant %s', child => {
        const {paragraph} = fixture(`<p>Original ${child}continues.</p>`);
        expect(projectMaterialOriginalText(paragraph)?.text).toBe('Original continues.');
    });

    it.each(['form', 'nav', 'aside', 'pre'])('does not collect an excluded %s subtree', tag => {
        const {document, paragraph} = fixture('<p>Original continues.</p>');
        const excluded = document.createElement(tag); excluded.textContent = 'SECRET'; paragraph.append(excluded);
        expect(projectMaterialOriginalText(paragraph)?.text).toBe('Original continues.');
    });

    it('honors inline and computed CSS visibility before descending into hidden branches', () => {
        const {window, paragraph} = fixture('<p>Original <i class="css-hidden"><b>SECRET</b></i><span style="display:none">SECRET</span><span style="visibility:collapse">SECRET</span><em style="content-visibility:hidden">SECRET</em>continues.</p>');
        const computed = vi.fn((element: Element) => element.classList.contains('css-hidden') ? {display: 'none'} : (element as HTMLElement).style);
        Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: computed});
        expect(projectMaterialOriginalText(paragraph)?.text).toBe('Original continues.');
        expect(computed.mock.calls.some(([element]) => element.tagName === 'B')).toBe(false);
        delete (window as unknown as {getComputedStyle?: unknown}).getComputedStyle;
    });

    it.each(['hidden', 'inert', 'aria-hidden="true"', 'contenteditable="true"', 'style="display:none"', 'style="visibility:hidden"'])('refuses a paragraph under an excluded ancestor: %s', attributes => {
        const {paragraph} = fixture(`<div ${attributes}><p>Private content</p></div>`);
        expect(projectMaterialOriginalText(paragraph)).toBeUndefined();
    });

    it('keeps explicit noneditable original text but refuses an editable ancestor override', () => {
        const {paragraph} = fixture('<p>Read <span contenteditable="false">original</span>.</p>');
        expect(projectMaterialOriginalText(paragraph)?.text).toBe('Read original.');
        paragraph.parentElement!.setAttribute('contenteditable', 'true');
        expect(projectMaterialOriginalText(paragraph)).toBeUndefined();
    });

    it('checks the connected shadow host when the explicit source paragraph is inside a shadow tree', () => {
        const {document} = fixture('<div id="host"></div>');
        const host = document.querySelector('#host')!;
        const shadow = host.attachShadow({mode: 'open'});
        shadow.innerHTML = '<p>Original inside shadow.</p>';
        const paragraph = shadow.querySelector('p')!;
        expect(projectMaterialOriginalText(paragraph)?.text).toBe('Original inside shadow.');
        host.setAttribute('hidden', '');
        expect(projectMaterialOriginalText(paragraph)).toBeUndefined();
    });

    it('reads no adjacent paragraph, no excluded descendants and no whole-page style sweep', () => {
        const {window, document, paragraph} = fixture('<p>Original.<span data-fluent-read-ui><b>private UI</b></span></p><p id="other">private article</p>');
        const other = document.querySelector('#other')!.firstChild!;
        const excluded = paragraph.querySelector('b')!.firstChild!;
        for (const node of [other, excluded]) Object.defineProperty(node, 'data', {get() {throw new Error('must not read outside original subtree');}});
        const computed = vi.fn((element: HTMLElement) => element.style);
        Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: computed});
        expect(projectMaterialOriginalText(paragraph)?.text).toBe('Original.');
        expect(computed.mock.calls.map(([element]) => element.tagName)).toEqual(['HTML', 'BODY', 'P']);
        delete (window as unknown as {getComputedStyle?: unknown}).getComputedStyle;
    });

    it('distinguishes later repeated words and keeps the whole expanded sentence', () => {
        const {paragraph} = fixture('<p>Practice helps. The practice means rehearsal. The <em>practice</em> means a profession.<span class="fluent-read-bilingual-content">Practice 译文。</span></p>');
        const projected = projectMaterialOriginalText(paragraph, rangeAt(paragraph.querySelector('em')!.firstChild!))!;
        expect(locateMaterialOriginalQuote(projected, 'The practice means a profession.')).toEqual({
            quote: 'The practice means a profession.', index: 46,
            prefix: 'Practice helps. The practice means rehearsal. ', suffix: '',
        });
        expect(locateMaterialOriginalQuote(projected, 'The practice means rehearsal.')).toBeUndefined();
        expect(locateMaterialOriginalQuote(projected, 'practice')?.index).toBe(50);
    });

    it('uses the actual later occurrence when entire sentences are repeated', () => {
        const {paragraph} = fixture('<p>We practice daily. First context. We <strong>practice</strong> daily. Last context.</p>');
        const projected = projectMaterialOriginalText(paragraph, rangeAt(paragraph.querySelector('strong')!.firstChild!))!;
        expect(locateMaterialOriginalQuote(projected, 'We practice daily.')).toEqual({quote: 'We practice daily.', index: 34,
            prefix: 'We practice daily. First context. ', suffix: ' Last context.'});
    });

    it('maps Range element boundaries as well as partial Text boundaries', () => {
        const {paragraph} = fixture('<p>Before <em>selected</em><span class="fluent-read-bilingual-content">译文</span> after.</p>');
        const elementRange = rangeAt(paragraph, 1, paragraph, 2);
        expect(projectMaterialOriginalText(paragraph, elementRange)?.selection).toEqual({start: 7, end: 15});
        const textRange = rangeAt(paragraph.firstChild!, 2, paragraph.querySelector('em')!.firstChild!, 3);
        expect(projectMaterialOriginalText(paragraph, textRange)?.selection).toEqual({start: 2, end: 10});
        const whole = projectMaterialOriginalText(paragraph, rangeAt(paragraph))!;
        expect(locateMaterialOriginalQuote(whole, 'Before selected after.')?.quote).toBe('Before selected after.');
    });

    it('normalizes Unicode whitespace and whitespace-trimmed selection boundaries consistently', () => {
        const {paragraph} = fixture('<p>\n  Before\t <em>  selected\u00a0</em> after. \n</p>');
        const projected = projectMaterialOriginalText(paragraph, rangeAt(paragraph.querySelector('em')!.firstChild!))!;
        expect(projected.text).toBe('Before selected after.');
        expect(locateMaterialOriginalQuote(projected, ' selected ')?.index).toBe(7);
        const sameNode = fixture('<p>Before selected after.</p>').paragraph;
        const withLeadingSpace = projectMaterialOriginalText(sameNode, rangeAt(sameNode.firstChild!, 6, sameNode.firstChild!, 16))!;
        expect(locateMaterialOriginalQuote(withLeadingSpace, 'selected')?.index).toBe(7);
    });

    it('keeps breaks between prose fragments while ignoring comments', () => {
        const {document} = fixture('<blockquote>First<br>second<!--PRIVATE--><p>third</p><p>fourth</p></blockquote>');
        const root = document.querySelector('blockquote')!;
        const projected = projectMaterialOriginalText(root, rangeAt(root.querySelector('p')!.firstChild!))!;
        expect(projected.text).toBe('First second third fourth');
        expect(locateMaterialOriginalQuote(projected, 'third')?.index).toBe(13);
    });

    it.each(['[data-fluent-read-ui]', '.fluent-read-bilingual-content', '[hidden]', '[contenteditable]'])('refuses Range boundaries inside excluded descendants %s', selector => {
        const {paragraph} = fixture('<p>Visible.<span data-fluent-read-ui>tools</span><span class="fluent-read-bilingual-content">译文</span><span hidden>hidden</span><span contenteditable>private</span></p>');
        const secret = paragraph.querySelector(selector)!.firstChild!;
        expect(projectMaterialOriginalText(paragraph, rangeAt(secret))).toBeUndefined();
        expect(projectMaterialOriginalText(paragraph, rangeAt(paragraph.firstChild!, 0, secret, 1))).toBeUndefined();
    });

    it('refuses disconnected or cross-paragraph range endpoints and excludes page shells', () => {
        const {document, paragraph} = fixture('<p>Original.</p><p id="other">Elsewhere.</p>');
        const other = document.querySelector('#other')!;
        expect(projectMaterialOriginalText(paragraph, rangeAt(paragraph.firstChild!, 0, other.firstChild!, 2))).toBeUndefined();
        expect(projectMaterialOriginalText(paragraph, rangeAt(other.firstChild!, 0, paragraph.firstChild!, 2))).toBeUndefined();
        const detached = document.createTextNode('Detached');
        expect(projectMaterialOriginalText(paragraph, rangeAt(paragraph.firstChild!, 0, detached, 2))).toBeUndefined();
        expect(projectMaterialOriginalText(paragraph, rangeAt(detached, 0, paragraph.firstChild!, 2))).toBeUndefined();
        for (const selector of ['body', 'html']) expect(projectMaterialOriginalText(document.querySelector(selector)!)).toBeUndefined();
        for (const tag of ['main', 'article', 'section']) {
            const shell = document.createElement(tag); shell.textContent = 'Entire page'; document.body.append(shell);
            expect(projectMaterialOriginalText(shell)).toBeUndefined();
        }
        paragraph.remove();
        expect(projectMaterialOriginalText(paragraph, rangeAt(paragraph.firstChild!))).toBeUndefined();
    });

    it('refuses documents without a browsing view', () => {
        const {document, paragraph} = fixture('<p>Original.</p>');
        Object.defineProperty(document, 'defaultView', {value: null});
        expect(projectMaterialOriginalText(paragraph)).toBeUndefined();
    });

    it('refuses stale, unsupported, invalid and collapsed range locations without guessing the first match', () => {
        const {document, paragraph} = fixture('<p>Original.</p>');
        const text = paragraph.firstChild!;
        expect(projectMaterialOriginalText(paragraph, rangeAt(text, 100))).toBeUndefined();
        expect(projectMaterialOriginalText(paragraph, rangeAt(text, -1))).toBeUndefined();
        expect(projectMaterialOriginalText(paragraph, rangeAt(text, 0.5))).toBeUndefined();
        expect(projectMaterialOriginalText(paragraph, rangeAt(text, 0, text, -1))).toBeUndefined();
        expect(projectMaterialOriginalText(paragraph, rangeAt(text, 0, text, 100))).toBeUndefined();
        expect(projectMaterialOriginalText(paragraph, rangeAt(text, 0, text, 1.5))).toBeUndefined();
        expect(projectMaterialOriginalText(paragraph, rangeAt(text, 3, text, 2))).toBeUndefined();
        expect(projectMaterialOriginalText(paragraph, rangeAt(paragraph, 10))).toBeUndefined();
        const comment = document.createComment('private'); paragraph.append(comment);
        expect(projectMaterialOriginalText(paragraph, rangeAt(comment))).toBeUndefined();
        expect(locateMaterialOriginalQuote(projectMaterialOriginalText(paragraph, rangeAt(text, 2, text, 2))!, 'Original.')).toBeUndefined();
        expect(locateMaterialOriginalQuote(projectMaterialOriginalText(paragraph)!, 'Original.')).toBeUndefined();
    });

    it('returns no partial projection after a character or node budget is exceeded', () => {
        const {paragraph} = fixture('<p>word<span>rest</span></p>');
        expect(projectMaterialOriginalText(paragraph, undefined, {characters: 8, nodes: 4})?.text).toBe('wordrest');
        expect(projectMaterialOriginalText(paragraph, undefined, {characters: 7})).toBeUndefined();
        expect(projectMaterialOriginalText(paragraph, undefined, {nodes: 3})).toBeUndefined();
        for (const value of [0, -1, NaN, Infinity, 1.5]) {
            expect(projectMaterialOriginalText(paragraph, undefined, {characters: value})).toBeUndefined();
            expect(projectMaterialOriginalText(paragraph, undefined, {nodes: value})).toBeUndefined();
        }
        paragraph.textContent = 'x'.repeat(MATERIAL_ORIGINAL_TEXT_LIMITS.characters + 1);
        expect(projectMaterialOriginalText(paragraph, undefined, {characters: Number.MAX_SAFE_INTEGER})).toBeUndefined();
    });

    it('enforces default traversal and ancestor limits without recursion or copying child lists', () => {
        const crowded = fixture(`<p>${'<i>x</i>'.repeat(1000)}</p>`).paragraph;
        expect(projectMaterialOriginalText(crowded, undefined, {nodes: Number.MAX_SAFE_INTEGER})).toBeUndefined();
        const {document, paragraph} = fixture('<p>Original.</p>');
        for (let i = 0; i < MATERIAL_ORIGINAL_TEXT_LIMITS.ancestors; i++) {
            const wrapper = document.createElement('div'); paragraph.replaceWith(wrapper); wrapper.append(paragraph);
        }
        expect(projectMaterialOriginalText(paragraph)).toBeUndefined();
    });

    it('counts explicit line boundaries against the character budget and refuses empty prose', () => {
        const {paragraph} = fixture('<p>a<br>b</p>');
        expect(projectMaterialOriginalText(paragraph, undefined, {characters: 1})).toBeUndefined();
        expect(projectMaterialOriginalText(paragraph, undefined, {characters: 2})).toBeUndefined();
        paragraph.textContent = ' \n\t ';
        expect(projectMaterialOriginalText(paragraph)).toBeUndefined();
    });

    it('refuses a root that disconnects during visibility validation and unexpected style failures', () => {
        const {window, paragraph} = fixture('<p>Original.</p>');
        Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: (element: HTMLElement) => {if (element === paragraph) paragraph.remove(); return element.style;}});
        expect(projectMaterialOriginalText(paragraph)).toBeUndefined();
        delete (window as unknown as {getComputedStyle?: unknown}).getComputedStyle;
        const next = fixture('<p>Original.</p>');
        Object.defineProperty(next.window, 'getComputedStyle', {configurable: true, value: () => {throw new Error('unavailable');}});
        expect(projectMaterialOriginalText(next.paragraph)).toBeUndefined();
        delete (next.window as unknown as {getComputedStyle?: unknown}).getComputedStyle;
    });

    it('rejects oversized, missing and ambiguously overlapping quotes and bounds saved context', () => {
        expect(locateMaterialOriginalQuote({text: 'aaaaa', selection: {start: 2, end: 3}}, 'aaa')).toBeUndefined();
        const projection = {text: `${'x'.repeat(200)} word ${'y'.repeat(200)}`, selection: {start: 201, end: 205}};
        expect(locateMaterialOriginalQuote(projection, 'word')).toMatchObject({prefix: `${'x'.repeat(159)} `, suffix: ` ${'y'.repeat(159)}`});
        for (const quote of ['', '  ', 'missing', 'x'.repeat(6001), 'x'.repeat(12001)]) expect(locateMaterialOriginalQuote(projection, quote)).toBeUndefined();
    });
});

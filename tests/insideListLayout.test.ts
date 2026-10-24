import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';
import {alignInsideListTranslation, prepareInsideListTranslation} from '@/src/features/full-page-translation/content/insideListLayout';

const active = 'data-fr-inside-list-layout';
const inset = 'data-fr-inside-list-inset';
const sourceSize = 'data-fr-inside-list-source-size';

function rect(left = 0, right = 360, width = right - left, height = 20) {
    return {left, right, top: 0, bottom: height, width, height, x: left, y: 0, toJSON() {}} as DOMRect;
}

function fixture(html = '<li id="owner">Original <b>source</b> text.</li>') {
    const {document} = parseHTML(`<html><body><ol>${html}</ol></body></html>`);
    const node = document.querySelector<HTMLElement>('#owner')!;
    const content = document.createElement('span');
    content.className = 'fluent-read-bilingual-content';
    content.setAttribute('data-fr-translation-owned', 'true');
    content.textContent = '前置译文应占据原生列表序号之后的可用栏宽。';
    const style = {
        display: 'list-item', listStylePosition: 'inside', direction: 'ltr', fontSize: '16px',
        borderLeftWidth: '0px', borderRightWidth: '0px', paddingLeft: '0px', paddingRight: '0px',
    };
    const getComputedStyle = vi.fn(() => style as CSSStyleDeclaration);
    Object.defineProperty(document.defaultView!, 'getComputedStyle', {value: getComputedStyle, configurable: true});
    const getBoundingClientRect = vi.fn(() => rect());
    Object.defineProperty(node, 'getBoundingClientRect', {value: getBoundingClientRect, configurable: true});
    const range = {setStart: vi.fn(), setEnd: vi.fn(), getBoundingClientRect: vi.fn(() => rect(18, 26, 8, 16))};
    const createRange = vi.fn(() => range as unknown as Range);
    Object.defineProperty(document, 'createRange', {value: createRange, configurable: true});
    return {document, node, content, style, getComputedStyle, getBoundingClientRect, range, createRange};
}

function stamp(content: HTMLElement, gap = '18', font = '16') {
    content.setAttribute(active, 'true');
    content.setAttribute(inset, gap);
    content.setAttribute(sourceSize, font);
}

function expectLayout(content: HTMLElement, gap = 18) {
    expect(content.style.display).toBe('inline-block');
    expect(content.style.getPropertyValue('inline-size')).toBe(`calc(100% - ${gap}px)`);
    expect(content.style.getPropertyValue('box-sizing')).toBe('border-box');
    expect(content.style.getPropertyValue('vertical-align')).toBe('top');
    expect(content.style.getPropertyValue('text-indent')).toBe('0px');
    expect(content.getAttribute(active)).toBe('true');
    expect(content.getAttribute(inset)).toBe(String(gap));
}

function expectUntouched(content: HTMLElement) {
    expect(content.getAttribute('style')).toBeNull();
    expect(content.getAttribute(active)).toBeNull();
}

describe('native inside-list translation layout', () => {
    it('uses the actual marker gap and leaves original nodes, marker, and host style unchanged', () => {
        const {node, content, range} = fixture();
        const source = node.innerHTML, children = [...node.childNodes], hostStyle = node.getAttribute('style');
        prepareInsideListTranslation(node, content, true);
        expectLayout(content);
        expect(range.setStart).toHaveBeenCalledWith(children[0], 0);
        expect(range.setEnd).toHaveBeenCalledWith(children[0], 1);
        node.insertBefore(content, node.firstChild);
        expect(node.firstChild).toBe(content);
        expect(node.querySelectorAll('[data-fr-translation-owned="true"]')).toHaveLength(1);
        content.remove();
        expect(node.innerHTML).toBe(source);
        expect([...node.childNodes]).toEqual(children);
        expect(node.getAttribute('style')).toBe(hostStyle);
    });

    it('accounts for source border, padding, and first-line indentation without inheriting that indentation twice', () => {
        const {node, content, style, range, getBoundingClientRect} = fixture();
        Object.assign(style, {borderLeftWidth: '2px', paddingLeft: '10px', borderRightWidth: '3px', paddingRight: '7px', textIndent: '24px'});
        getBoundingClientRect.mockReturnValue(rect(100, 500));
        range.getBoundingClientRect.mockReturnValue(rect(154, 162, 8, 16));
        content.style.setProperty('text-indent', '24px');
        prepareInsideListTranslation(node, content, true);
        expectLayout(content, 42);
    });

    it('uses the right content edge for a simple RTL source glyph', () => {
        const {node, content, style, range} = fixture();
        Object.assign(style, {direction: 'rtl', borderRightWidth: '2px', paddingRight: '10px'});
        range.getBoundingClientRect.mockReturnValue(rect(320, 330, 10, 16));
        prepareInsideListTranslation(node, content, true);
        expectLayout(content, 18);
    });

    it.each([
        ['after', '<li id="owner">Original.</li>', false, 'list-item', 'inside', true],
        ['outside', '<li id="owner">Original.</li>', true, 'list-item', 'outside', true],
        ['block li', '<li id="owner">Original.</li>', true, 'block', 'inside', true],
        ['non-li', '<p id="owner">Original.</p>', true, 'list-item', 'inside', true],
        ['unowned', '<li id="owner">Original.</li>', true, 'list-item', 'inside', false],
    ])('does not alter %s translations', (_label, html, before, display, position, isOwned) => {
        const {node, content, style, createRange} = fixture(html as string);
        style.display = display as string;
        style.listStylePosition = position as string;
        if (!isOwned) content.removeAttribute('data-fr-translation-owned');
        prepareInsideListTranslation(node, content, before as boolean);
        expectUntouched(content);
        expect(createRange).not.toHaveBeenCalled();
    });

    it('ignores unmarked and unowned artifacts during controlled alignment', () => {
        const {node, content, createRange} = fixture();
        alignInsideListTranslation(node, content);
        expectUntouched(content);
        stamp(content);
        content.removeAttribute('data-fr-translation-owned');
        alignInsideListTranslation(node, content);
        expect(content.style.display).toBeFalsy();
        expect(createRange).not.toHaveBeenCalled();
    });

    it('skips owned translations, loading/retry artifacts, and blank source nodes', () => {
        const {node, content, range} = fixture('<li id="owner"><span data-fr-translation-owned="true">Old</span><span class="fluent-read-loading">Loading</span><span class="fluent-read-retry-wrapper">Retry</span>  \n<b>  Original.</b></li>');
        const source = node.querySelector('b')!.firstChild!;
        prepareInsideListTranslation(node, content, true);
        expectLayout(content);
        expect(range.setStart).toHaveBeenCalledWith(source, 2);
        expect(range.setEnd).toHaveBeenCalledWith(source, 3);
    });

    it.each(['img', 'svg', 'a', 'span'])('takes the native marker gap from a leading %s box instead of including its width or inner padding', tag => {
        const {node, content, createRange} = fixture(`<li id="owner"><${tag} id="prefix">Original prefix.</${tag}>More source.</li>`);
        const prefix = node.querySelector<Element>('#prefix')!;
        const firstFragment = rect(18, tag === 'img' || tag === 'svg' ? 42 : 300, 24, 20);
        const getClientRects = vi.fn(() => [firstFragment, rect(0, 360)]);
        Object.defineProperty(prefix, 'getClientRects', {value: getClientRects, configurable: true});
        prepareInsideListTranslation(node, content, true);
        expectLayout(content, 18);
        expect(getClientRects).toHaveBeenCalledTimes(1);
        expect(createRange).not.toHaveBeenCalled();
    });

    it.each([[], [rect(0, 0, 0, 20)], [rect(0, 0, 20, 0)], [rect(0, 0, Number.NaN, 20)], [rect(0, 0, 20, Number.NaN)]].map(boxes => [boxes]))('descends through a zero-box shell such as display:contents: %j', boxes => {
        const {node, content, createRange} = fixture('<li id="owner"><span id="shell"><a id="prefix" style="padding-left:12px">Original.</a></span></li>');
        Object.defineProperty(node.querySelector('#shell'), 'getClientRects', {value: () => boxes, configurable: true});
        Object.defineProperty(node.querySelector('#prefix'), 'getClientRects', {value: () => [rect(18, 240)], configurable: true});
        prepareInsideListTranslation(node, content, true);
        expectLayout(content, 18);
        expect(createRange).not.toHaveBeenCalled();
    });

    it('uses the right first-fragment edge for a simple RTL inline element prefix', () => {
        const {node, content, style, createRange} = fixture('<li id="owner"><span id="prefix">Original.</span></li>');
        style.direction = 'rtl';
        Object.defineProperty(node.querySelector('#prefix'), 'getClientRects', {value: () => [rect(220, 342)], configurable: true});
        prepareInsideListTranslation(node, content, true);
        expectLayout(content, 18);
        expect(createRange).not.toHaveBeenCalled();
    });

    it('allows replacing an ordinary previous wrapper while measuring the still-unshifted source', () => {
        const {node, content} = fixture('<li id="owner">Original.<span class="fluent-read-bilingual-content" data-fr-translation-owned="true">Old.</span></li>');
        prepareInsideListTranslation(node, content, true);
        expectLayout(content);
    });

    it('refreshes with cached source geometry and scales only from the original font size', () => {
        const {node, content, style, document, createRange, range} = fixture();
        prepareInsideListTranslation(node, content, true);
        node.insertBefore(content, node.firstChild);
        range.getBoundingClientRect.mockReturnValue(rect(0, 8, 8, 16)); // 原文现在是续行，不可重测为 marker 间隔。
        const replacement = content.cloneNode(true) as HTMLElement;
        replacement.removeAttribute('style');
        replacement.style.fontSize = '40px';
        style.fontSize = '20px';
        prepareInsideListTranslation(node, replacement, true);
        expectLayout(replacement, 22.5);
        expect(replacement.getAttribute(sourceSize)).toBe('20');
        expect(createRange).toHaveBeenCalledTimes(1);
        content.replaceWith(replacement);
        replacement.appendChild(document.createTextNode('更多译文。'));
        replacement.style.fontSize = '80px';
        alignInsideListTranslation(node, replacement);
        expectLayout(replacement, 22.5);
        expect(createRange).toHaveBeenCalledTimes(1);
    });

    it('remeasures the native marker after restore even when the owner still has cached metadata', () => {
        const {node, content, range, createRange} = fixture();
        prepareInsideListTranslation(node, content, true);
        node.prepend(content);
        content.remove();
        range.getBoundingClientRect.mockReturnValue(rect(31, 39, 8, 16));
        prepareInsideListTranslation(node, content, true);
        expectLayout(content, 31);
        expect(createRange).toHaveBeenCalledTimes(2);
    });

    it.each(['prepare', 'align'])('recovers finite metadata from a cloned owner during %s', operation => {
        const {node, content, style, createRange} = fixture();
        stamp(content, '17.7890625', '16');
        node.prepend(content);
        style.fontSize = '20px';
        const replacement = content.cloneNode(true) as HTMLElement;
        if (operation === 'prepare') prepareInsideListTranslation(node, replacement, true);
        else alignInsideListTranslation(node, replacement);
        expectLayout(replacement, 22.236328);
        expect(replacement.getAttribute(sourceSize)).toBe('20');
        expect(createRange).not.toHaveBeenCalled();
    });

    it.each([
        [null, '16'], ['18', null], ['', '16'], ['18px', '16'], ['-1', '16'], ['18', '0'],
        ['360', '16'], ['999', '16'], ['9'.repeat(400), '16'], ['18', '9'.repeat(400)],
    ])('rejects malformed or unusable clone metadata %j/%j without measuring shifted original text', (gap, font) => {
        const {node, content, createRange} = fixture();
        stamp(content);
        if (gap === null) content.removeAttribute(inset); else content.setAttribute(inset, gap);
        if (font === null) content.removeAttribute(sourceSize); else content.setAttribute(sourceSize, font);
        node.prepend(content);
        const replacement = content.cloneNode(true) as HTMLElement;
        prepareInsideListTranslation(node, replacement, true);
        alignInsideListTranslation(node, replacement);
        expect(replacement.style.display).toBeFalsy();
        expect(createRange).not.toHaveBeenCalled();
    });

    it('supports a valid zero gap without inventing an extra marker width', () => {
        const {node, content, range} = fixture();
        range.getBoundingClientRect.mockReturnValue(rect(0, 8, 8, 16));
        prepareInsideListTranslation(node, content, true);
        expectLayout(content, 0);
    });

    it.each([
        rect(-1, 7, 8, 16), rect(360, 368, 8, 16), rect(18, 26, 0, 16), rect(18, 26, 8, 0),
        rect(18, 26, Number.NaN, 16), rect(18, 26, 8, Number.NaN), rect(Number.NaN, 26, 8, 16),
    ])('leaves a nonobservable or out-of-column glyph unchanged: %j', glyph => {
        const {node, content, range} = fixture();
        range.getBoundingClientRect.mockReturnValue(glyph);
        prepareInsideListTranslation(node, content, true);
        expectUntouched(content);
    });

    it.each(['fontSize', 'zeroSize', 'width', 'coordinate', 'style', 'view'])('keeps unavailable %s context unchanged in both entry points', unavailable => {
        const {node, content, style, getBoundingClientRect, getComputedStyle, document} = fixture();
        if (unavailable === 'fontSize') style.fontSize = 'invalid';
        if (unavailable === 'zeroSize') style.fontSize = '0px';
        if (unavailable === 'width') getBoundingClientRect.mockReturnValue(rect(20, 20));
        if (unavailable === 'coordinate') getBoundingClientRect.mockReturnValue(rect(Number.NaN, 360));
        if (unavailable === 'style') getComputedStyle.mockReturnValue(undefined!);
        if (unavailable === 'view') Object.defineProperty(document, 'defaultView', {value: null, configurable: true});
        prepareInsideListTranslation(node, content, true);
        expectUntouched(content);
        stamp(content);
        alignInsideListTranslation(node, content);
        expect(content.style.display).toBeFalsy();
    });

    it('retains existing layout when a shrunken content box no longer admits its inset', () => {
        const {node, content, getBoundingClientRect} = fixture();
        prepareInsideListTranslation(node, content, true);
        node.prepend(content);
        const previous = content.getAttribute('style');
        getBoundingClientRect.mockReturnValue(rect(0, 12));
        alignInsideListTranslation(node, content);
        const replacement = content.cloneNode(true) as HTMLElement;
        replacement.removeAttribute('style');
        prepareInsideListTranslation(node, replacement, true);
        expect(replacement.style.display).toBeFalsy();
        expect(content.getAttribute('style')).toBe(previous);
    });

    it('does not mutate observers again when values and priorities already match', () => {
        const {node, content} = fixture();
        prepareInsideListTranslation(node, content, true);
        node.prepend(content);
        const setProperty = vi.spyOn(content.style, 'setProperty');
        const setAttribute = vi.spyOn(content, 'setAttribute');
        alignInsideListTranslation(node, content); // linkedom 没有 getPropertyPriority，仍须幂等。
        expect(setProperty).not.toHaveBeenCalled();
        expect(setAttribute).not.toHaveBeenCalled();
        const realStyle = content.style;
        let priority = 'important';
        const nativeSetProperty = vi.fn((key: string, text: string, value: string) => realStyle.setProperty(key, text, value));
        Object.defineProperty(content, 'style', {value: {
            getPropertyValue: (key: string) => realStyle.getPropertyValue(key),
            getPropertyPriority: () => priority, setProperty: nativeSetProperty,
        }, configurable: true});
        alignInsideListTranslation(node, content);
        expect(nativeSetProperty).not.toHaveBeenCalled();
        priority = '';
        alignInsideListTranslation(node, content);
        expect(nativeSetProperty).toHaveBeenCalledTimes(5);
        expect(nativeSetProperty).toHaveBeenCalledWith('text-indent', '0px', 'important');
    });

    it.each(['blank', 'character bound', 'node bound', 'orphan text'])('bounds source inspection for %s', mode => {
        const {node, content, document, createRange} = fixture();
        node.textContent = '';
        if (mode === 'blank') node.appendChild(document.createTextNode('   '));
        if (mode === 'character bound') node.append(' '.repeat(16_384), 'Source beyond bound.');
        if (mode === 'node bound') for (let i = 0; i < 1024; i++) node.appendChild(document.createElement('i')).textContent = ' ';
        if (mode === 'orphan text') {
            const orphan = document.createTextNode(' ');
            const nextNode = vi.fn().mockReturnValueOnce(orphan).mockReturnValue(null);
            Object.defineProperty(document, 'createTreeWalker', {value: () => ({nextNode}), configurable: true});
        }
        prepareInsideListTranslation(node, content, true);
        expectUntouched(content);
        expect(createRange).not.toHaveBeenCalled();
    });

    it('limits refresh sibling inspection when an owner has unusually many direct children', () => {
        const {node, content, document} = fixture();
        for (let i = 0; i < 256; i++) node.appendChild(document.createElement('i'));
        const beyond = content.cloneNode(true) as HTMLElement;
        stamp(beyond, 'invalid', '16');
        node.appendChild(beyond);
        prepareInsideListTranslation(node, content, true);
        expectLayout(content);
    });

    it('falls back harmlessly when layout APIs throw during preparation or controlled alignment', () => {
        const preparing = fixture();
        preparing.range.getBoundingClientRect.mockImplementation(() => {throw new Error('No geometry');});
        prepareInsideListTranslation(preparing.node, preparing.content, true);
        expectUntouched(preparing.content);
        const aligning = fixture();
        prepareInsideListTranslation(aligning.node, aligning.content, true);
        const previous = aligning.content.getAttribute('style');
        aligning.getComputedStyle.mockImplementation(() => {throw new Error('Detached view');});
        alignInsideListTranslation(aligning.node, aligning.content);
        expect(aligning.content.getAttribute('style')).toBe(previous);
    });
});

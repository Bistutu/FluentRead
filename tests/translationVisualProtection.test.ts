import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';
import {extractTranslationText, createTranslationSourceSnapshot} from '@/src/core/translation/public';
import {createTranslationCore} from './helpers/translationCore';
import {isHiddenTranslationElement} from '@/src/core/translation/dom';

const clippedStyle = {
    display: 'block', visibility: 'visible', position: 'absolute', width: '1px', height: '1px',
    overflow: 'hidden', clip: 'rect(0px, 0px, 0px, 0px)', clipPath: 'none',
};
function fixture(overrides: Record<string, string>) {
    const {document} = parseHTML('<html><body><main><p id="prose">Read the visible explanation.<span id="hint">To pick up a draggable item, press the space bar.</span></p></main></body></html>');
    const hint = document.querySelector('#hint')!;
    const style = {...clippedStyle, ...overrides};
    Object.defineProperty(document.defaultView!, 'getComputedStyle', {configurable: true, value: (element: Element) =>
        element === hint ? style : {display: 'block', visibility: 'visible'}});
    return {document, hint, style, prose: document.querySelector<HTMLElement>('#prose')!};
}

describe('visual-only accessibility text protection', () => {
    it.each<Record<string, string>>([
        {overflow: 'visible'},
        {clip: 'auto'},
        {position: 'static'},
    ])('普通定位容器不读取会强制布局的尺寸 %j', overrides => {
        const {hint, style, prose} = fixture(overrides);
        let geometryReads = 0;
        for (const property of ['width', 'height']) Object.defineProperty(style, property, {
            get: () => { geometryReads++; return '240px'; },
        });
        expect(isHiddenTranslationElement(hint)).toBe(false);
        expect(extractTranslationText(prose)).toContain('draggable');
        expect(geometryReads).toBe(0);
    });
    it.each([
        ['legacy rect', {}],
        ['modern inset', {clip: 'auto', clipPath: 'inset(50%)'}],
        ['fixed live region', {position: 'fixed'}],
        ['one pixel rect', {clip: 'rect(1px, 1px, 1px, 1px)'}],
        ['axis overflow', {overflow: '', overflowX: 'hidden', overflowY: 'hidden'}],
        ['clip overflow', {overflow: 'clip'}],
    ])('omits %s from discovery, requests and bilingual snapshots', (_name, overrides) => {
        const {document, hint, prose} = fixture(overrides);
        const core = createTranslationCore();
        expect(isHiddenTranslationElement(hint)).toBe(true);
        expect(core.discover(document).map(candidate => candidate.element)).toEqual([prose]);
        expect(extractTranslationText(prose)).toBe('Read the visible explanation.');
        const snapshot = createTranslationSourceSnapshot(prose);
        expect(snapshot.slots.map(slot => slot.source)).toEqual(['Read the visible explanation.']);
        expect(snapshot.clone.textContent).not.toContain('draggable');
        expect(hint.textContent).toContain('draggable');
        expect(hint.parentNode).toBe(prose);
    });

    it.each([
        ['normal cropped card', {width: '240px', height: '80px'}],
        ['unclipped small content', {clip: 'auto'}],
        ['in-flow text', {position: 'static'}],
        ['visible overflow', {overflow: 'visible'}],
        ['vertical text', {height: '80px'}],
        ['nonempty clip', {clip: 'rect(0px, 200px, 30px, 0px)'}],
        ['partial inset', {clip: 'auto', clipPath: 'inset(10%)'}],
    ])('keeps %s readable', (_name, overrides) => {
        const {hint, prose} = fixture(overrides);
        expect(isHiddenTranslationElement(hint)).toBe(false);
        expect(extractTranslationText(prose)).toContain('draggable');
    });

    it('rechecks a helper when the host makes it visible', () => {
        const {document, hint, style} = fixture({});
        const core = createTranslationCore();
        expect(core.discover(hint)).toEqual([]);
        style.position = 'static';
        expect(isHiddenTranslationElement(hint)).toBe(false);
        expect(core.discover(hint)).toHaveLength(1);
        expect(core.discover(document).some(candidate => candidate.element === hint)).toBe(true);
    });

    it('uses modern clipping when the view does not expose the legacy clip property', () => {
        const {hint, style, prose} = fixture({clipPath: 'inset(50%)'});
        Reflect.deleteProperty(style, 'clip');
        expect(isHiddenTranslationElement(hint)).toBe(true);
        expect(extractTranslationText(prose)).not.toContain('draggable');
    });
});

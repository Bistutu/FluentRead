import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';

import {createDeclarativeAdapter} from '@/src/core/translation/public';
import {createTranslationCore} from './helpers/translationCore';
import type {TranslationScope, TranslationSiteAdapter} from '@/src/core/translation/types';

function fixture(html: string, adapters: readonly TranslationSiteAdapter[] = [], scope: TranslationScope = 'content') {
    const {document} = parseHTML(`<html><body>${html}</body></html>`);
    const core = createTranslationCore({url: new URL('https://ownership.example/article'), adapters, scope});
    return {document, core};
}

const list = '<ul><li id="first">First readable task item.</li><li id="second">Second readable task item.</li></ul>';

describe('translation ownership through layout wrappers', () => {
    it.each([
        ['task-lists', 'content'], ['span', 'content'], ['task-lists', 'all'], ['span', 'all'],
    ] as const)('does not select the whole outer shell around a %s list wrapper in %s scope', (tag, scope) => {
        const {document, core} = fixture(`<div id="outer"><${tag} id="bridge">${list}</${tag}></div>`, [], scope);
        const assertOwnership = () => {
            expect(core.resolve(document.getElementById('outer'))).toBeNull();
            expect(core.resolve(document.getElementById('bridge'))).toBeNull();
            expect(core.resolve(document.getElementById('first')!.firstChild)?.element.id).toBe('first');
        };
        assertOwnership();
        expect(core.discover(document).map(candidate => candidate.element.id)).toEqual(['first', 'second']);
        assertOwnership();
    });

    it('keeps the direct introduction as a run without swallowing the list when its wrapper is hit', () => {
        const {document, core} = fixture(`<div id="outer">Readable introduction.<task-lists id="bridge">${list}</task-lists></div>`);
        const outer = document.getElementById('outer')!;
        const intro = outer.firstChild!;
        for (const discoverFirst of [false, true]) {
            if (discoverFirst) core.discover(document);
            expect(core.resolve(intro)).toMatchObject({element: outer, nodes: [intro]});
            expect(core.resolve(document.getElementById('bridge'))).toBeNull();
        }
    });

    it('rechecks the live descendants when an inline wrapper gains and loses its own paragraphs', () => {
        const {document, core} = fixture('<div id="outer"><span id="bridge">A readable inline sentence.</span></div>');
        const outer = document.getElementById('outer')!;
        const bridge = document.getElementById('bridge')!;
        expect(core.resolve(bridge)?.element).toBe(outer);
        core.discover(document);
        bridge.innerHTML = list;
        expect(core.resolve(bridge)).toBeNull();
        core.discover(document);
        bridge.textContent = 'A new readable inline sentence.';
        expect(core.resolve(bridge)?.element).toBe(outer);
    });

    it('keeps normal inline links and emphasis in the same paragraph', () => {
        const {document, core} = fixture('<p id="paragraph">Read the <a id="link" href="/guide">complete guide</a> and <strong>follow these steps</strong>.</p>');
        const paragraph = document.getElementById('paragraph')!;
        expect(core.resolve(document.getElementById('link'))?.element).toBe(paragraph);
        expect(core.discover(document).map(candidate => candidate.element)).toEqual([paragraph]);
    });

    it('respects an explicitly atomic custom rule even when the target contains a list', () => {
        const adapter = createDeclarativeAdapter({
            id: 'intentional-atomic-owner', hosts: ['ownership.example'],
            targets: [{selector: '#outer', reason: 'intentional-atomic-owner', match: 'closest', atomic: true}],
        });
        const {document, core} = fixture(`<div id="outer"><task-lists id="bridge">${list}</task-lists></div>`, [adapter]);
        const outer = document.getElementById('outer')!;
        expect(core.resolve(document.getElementById('bridge'))?.element).toBe(outer);
        expect(core.discover(document).map(candidate => candidate.element)).toEqual([outer]);
    });

    it('does not fall back to an explicitly non-atomic container with direct block child owners', () => {
        const adapter = createDeclarativeAdapter({
            id: 'non-atomic-container', hosts: ['ownership.example'],
            targets: [{selector: '#outer', reason: 'non-atomic-container', atomic: false}],
        });
        const {document, core} = fixture(`<div id="outer"><div id="bridge">${list}</div></div>`, [adapter]);
        expect(core.resolve(document.getElementById('outer'))).toBeNull();
        expect(core.resolve(document.getElementById('bridge'))).toBeNull();
        expect(core.discover(document).map(candidate => candidate.element.id)).toEqual(['first', 'second']);
    });

    it('still allows a non-atomic rule to translate a leaf containing only inline prose', () => {
        const adapter = createDeclarativeAdapter({
            id: 'non-atomic-leaf', hosts: ['ownership.example'],
            targets: [{selector: '#outer', reason: 'non-atomic-leaf', atomic: false}],
        });
        const {document, core} = fixture('<div id="outer">Read the <strong>complete guide</strong>.</div>', [adapter]);
        const outer = document.getElementById('outer')!;
        expect(core.resolve(outer)?.element).toBe(outer);
        expect(core.discover(document).map(candidate => candidate.element)).toEqual([outer]);
    });

    it('does not grant a whole-shell candidate when the bounded descendant check cannot finish', () => {
        const deepInline = '<span>'.repeat(300) + list + '</span>'.repeat(300);
        const {document, core} = fixture(`<div id="outer"><task-lists id="bridge">${deepInline}</task-lists></div>`);
        expect(core.resolve(document.getElementById('outer'))).toBeNull();
        expect(core.resolve(document.getElementById('bridge'))).toBeNull();
    });

    it('resolves an existing all-node inline segment back to its owner across mounting changes', () => {
        const {document, core} = fixture('<div><span data-fr-translation-segment="true">A translated source line.</span></div>', [], 'all');
        const segment = document.querySelector<HTMLElement>('span')!;
        expect(core.resolve(segment.firstChild)).toMatchObject({element: segment, reason: 'owned-inline-run', scope: 'all'});
        segment.remove();
        // Resolving identifies an owned segment; the runtime freshness gate separately rejects a detached owner.
        expect(core.resolve(segment.firstChild)).toMatchObject({element: segment, reason: 'owned-inline-run', scope: 'all'});
    });
});

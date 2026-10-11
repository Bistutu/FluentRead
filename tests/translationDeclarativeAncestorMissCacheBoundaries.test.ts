import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {TranslationCandidateCore} from '@/src/core/translation/engine';
import {createDeclarativeAdapter} from '@/src/core/translation/adapters/declarative';
import type {AdapterContext, TranslationSiteAdapter} from '@/src/core/translation/types';

const url = new URL('https://example.test');
const context = (): AdapterContext => ({url, closestSelectorMisses: new WeakMap()});
const source = 'Readable source must stay in its original DOM.';

// Build before querying: cache assertions below never span a DOM write.
function detachedChain(document: Document, count: number): Element[] {
    const nodes: Element[] = [];
    for (let index = 0; index < count; index += 1) {
        const node = document.createElement(index === count - 1 ? 'p' : 'div');
        if (nodes.length) nodes[nodes.length - 1]!.appendChild(node);
        nodes.push(node);
    }
    nodes[nodes.length - 1]!.id = 'leaf';
    nodes[nodes.length - 1]!.textContent = source;
    return nodes;
}

afterEach(() => vi.restoreAllMocks());

describe('declarative ancestor cache additional public boundaries', () => {
    it('invalid and empty prune lists cannot hide a valid nearest target in a mixed selector list', () => {
        const {document} = parseHTML('<html><body><section class="readable"><p id="leaf" class="readable">Readable source.</p></section></body></html>');
        const leaf = document.querySelector('#leaf')!;
        const adapter = createDeclarativeAdapter({id: 'mixed', hosts: ['example.test'],
            prune: [{selector: [], reason: 'empty'}, {selector: ['['], reason: 'invalid'}],
            targets: [{selector: ['[', '.readable'], match: 'closest', reason: 'nearest'}]});
        const cache = context();
        expect(adapter.decide(leaf, cache)).toMatchObject({kind: 'force-target', target: leaf, reason: 'nearest'});
        expect(adapter.decide(leaf.parentElement!, cache)).toMatchObject({kind: 'force-target', target: leaf.parentElement});
        expect(new TranslationCandidateCore({url, adapters: [adapter]}).inspect(leaf).candidate?.element).toBe(leaf);
    });

    it('a failed child matches check after a parent miss remains retryable without a DOM mutation', () => {
        const {document} = parseHTML('<html><body><section><p id="leaf" class="protected">Protected literal source.</p></section></body></html>');
        const leaf = document.querySelector('#leaf')!;
        const adapter = createDeclarativeAdapter({id: 'retry', hosts: ['example.test'],
            keepOriginal: [{selector: '.protected', reason: 'literal'}]});
        const cache = context();
        expect(adapter.shouldStayOriginal!(leaf.parentElement!, cache)).toBe(false);
        const matcher = vi.spyOn(leaf, 'matches').mockImplementationOnce(() => {throw new Error('transient selector failure');});
        expect(adapter.shouldStayOriginal!(leaf, cache)).toBe(false);
        expect(adapter.shouldStayOriginal!(leaf, cache)).toBe(true);
        expect(matcher).toHaveBeenCalledTimes(2);
        expect(leaf.textContent).toBe('Protected literal source.');
    });

    it('a successful deep miss gives no cached proof beyond the 512-node fill budget', () => {
        const {document} = parseHTML('<html><body></body></html>');
        const chain = detachedChain(document, 514);
        const adapter = createDeclarativeAdapter({id: 'bounded', hosts: ['example.test'],
            keepOriginal: [{selector: '.protected', reason: 'literal'}]});
        const cache = context();
        const coveredQuery = vi.spyOn(chain[2]!, 'closest');
        const outsideQuery = vi.spyOn(chain[1]!, 'closest');
        expect(adapter.shouldStayOriginal!(chain[513]!, cache)).toBe(false);
        // Query a covered ancestor and then the first uncovered one. The latter must
        // still ask the DOM instead of treating an unrecorded prefix as a witness.
        expect(adapter.shouldStayOriginal!(chain[2]!, cache)).toBe(false);
        expect(coveredQuery).not.toHaveBeenCalled();
        expect(adapter.shouldStayOriginal!(chain[1]!, cache)).toBe(false);
        expect(outsideQuery).toHaveBeenCalledOnce();
        expect(chain[513]!.textContent).toBe(source);
    });

    it.each([512, 513])('inspect keeps the composed hard-guard depth boundary for %i nodes', depth => {
        const {document} = parseHTML('<html><body></body></html>');
        const chain = detachedChain(document, depth);
        const leaf = chain[depth - 1]!;
        const adapter = createDeclarativeAdapter({id: 'depth', hosts: ['example.test'],
            prune: [{selector: '.excluded', reason: 'scope'}], targets: [{selector: '#leaf', reason: 'source'}]});
        const decisions = vi.spyOn(adapter, 'decide');
        const result = new TranslationCandidateCore({url, adapters: [adapter]}).inspect(leaf).candidate;
        if (depth === 512) {
            expect(result?.element).toBe(leaf);
            expect(decisions).toHaveBeenCalled();
        } else {
            expect(result).toBeNull();
            expect(decisions).not.toHaveBeenCalled();
        }
        expect(leaf.textContent).toBe(source);
    });

    it('same-core read-only reentry owns a separate cache and preserves one frozen context per inspect', () => {
        const {document} = parseHTML('<html><body><section><p id="outer">Outer readable source.</p><p id="inner">Inner readable source.</p></section></body></html>');
        const outer = document.querySelector('#outer')!;
        const inner = document.querySelector('#inner')!;
        const before = document.body.innerHTML;
        const observed: Array<{nested: boolean; hook: string; context: AdapterContext}> = [];
        let nested = false;
        let core: TranslationCandidateCore;
        let nestedCandidate: ReturnType<TranslationCandidateCore['inspect']>['candidate'] | undefined;
        const readonlyProbe: TranslationSiteAdapter = {id: 'readonly-probe', priority: 100, matches: () => true,
            decide(element, ctx) {
                observed.push({nested, hook: 'decide', context: ctx});
                Object.freeze(ctx);
                if (!nested && element === outer) {
                    nested = true;
                    try {nestedCandidate = core.inspect(inner).candidate;} finally {nested = false;}
                }
                return {kind: 'pass'};
            },
            shouldStayOriginal(_element, ctx) {
                observed.push({nested, hook: 'protect', context: ctx});
                return false;
            }};
        const adapter = createDeclarativeAdapter({id: 'source', hosts: ['example.test'],
            prune: [{selector: '.excluded', reason: 'scope'}],
            targets: [{selector: ['#outer', '#inner'], match: 'closest', reason: 'source'}],
            keepOriginal: [{selector: '.protected', reason: 'literal'}]});
        core = new TranslationCandidateCore({url, adapters: [readonlyProbe, adapter]});
        expect(core.inspect(outer).candidate?.element).toBe(outer);
        const outerCalls = observed.filter(x => !x.nested);
        const innerCalls = observed.filter(x => x.nested);
        expect(nestedCandidate?.element).toBe(inner);
        expect(observed.every(x => Object.isFrozen(x.context))).toBe(true);
        const outerContext = outerCalls[0]!.context;
        const innerContext = innerCalls[0]!.context;
        expect(outerCalls.every(x => x.context === outerContext)).toBe(true);
        expect(innerCalls.every(x => x.context === innerContext)).toBe(true);
        expect(outerCalls.some(x => x.hook === 'protect')).toBe(true);
        expect(innerCalls.some(x => x.hook === 'protect')).toBe(true);
        expect(outerContext.closestSelectorMisses).toBeInstanceOf(WeakMap);
        expect(innerContext.closestSelectorMisses).toBeInstanceOf(WeakMap);
        expect(innerContext.closestSelectorMisses).not.toBe(outerContext.closestSelectorMisses);
        observed.length = 0;
        expect(core.inspect(outer).candidate?.element).toBe(outer);
        expect(observed.find(x => !x.nested)!.context.closestSelectorMisses).not.toBe(outerContext.closestSelectorMisses);
        expect(document.body.innerHTML).toBe(before);
    });

    it('composed host original protection still filters shadow text while an unrelated shadow owner remains readable', () => {
        const {document} = parseHTML('<html><body><section id="protected-host" class="site-protected"></section><section id="readable-host"></section></body></html>');
        const protectedHost = document.querySelector('#protected-host')!;
        const readableHost = document.querySelector('#readable-host')!;
        const protectedShadow = protectedHost.attachShadow({mode: 'open'});
        const readableShadow = readableHost.attachShadow({mode: 'open'});
        protectedShadow.innerHTML = '<p class="readable">Protected original shadow source.</p>';
        readableShadow.innerHTML = '<p class="readable">Readable original shadow source.</p>';
        const protectedLeaf = protectedShadow.querySelector('p')!;
        const readableLeaf = readableShadow.querySelector('p')!;
        const before = [document.body.innerHTML, protectedShadow.innerHTML, readableShadow.innerHTML];
        const adapter = createDeclarativeAdapter({id: 'shadow-original', hosts: ['example.test'],
            targets: [{selector: '.readable', match: 'closest', reason: 'source'}],
            keepOriginal: [{selector: '.site-protected', reason: 'literal'}]});
        const core = new TranslationCandidateCore({url, adapters: [adapter]});
        expect(core.inspect(protectedLeaf).candidate).toBeNull();
        expect(core.inspect(readableLeaf).candidate?.element).toBe(readableLeaf);
        expect([document.body.innerHTML, protectedShadow.innerHTML, readableShadow.innerHTML]).toEqual(before);
    });

    it('an exact source-text-slot exception cannot bypass adjacent or site-selector original protection', () => {
        const {document} = parseHTML('<html><body><p id="leaf"><span id="slot" data-fr-translation-owned="true" translate="no">Readable original slot.</span><span id="protected" translate="no">Protected original sibling.</span></p></body></html>');
        const leaf = document.querySelector('#leaf')!;
        const slot = document.querySelector('#slot')!;
        const before = document.body.innerHTML;
        const adapter = createDeclarativeAdapter({id: 'slot', hosts: ['example.test'],
            targets: [{selector: '#leaf', reason: 'source'}],
            keepOriginal: [{selector: '.site-protected', reason: 'literal'}]});
        const core = new TranslationCandidateCore({url, adapters: [adapter]});
        const options = {sourceTextSlotHosts: new Set([slot])};
        expect(core.inspect(leaf).candidate).toBeNull();
        expect(core.inspect(leaf, options).candidate?.element).toBe(leaf);
        slot.classList.add('site-protected');
        expect(core.inspect(leaf, options).candidate).toBeNull();
        slot.classList.remove('site-protected');
        leaf.setAttribute('translate', 'no');
        expect(core.inspect(leaf, options).candidate).toBeNull();
        leaf.removeAttribute('translate');
        expect(core.inspect(leaf, options).candidate?.element).toBe(leaf);
        expect(document.body.innerHTML).toBe(before);
    });

    it('public original/omit/mutation guards remain uncached and fresh after inspect has warmed misses', () => {
        const {document} = parseHTML('<html><body><section id="parent"><p id="leaf">Readable source.</p></section></body></html>');
        const parent = document.querySelector('#parent')!;
        const leaf = document.querySelector('#leaf')!;
        const before = document.body.innerHTML;
        const adapter = createDeclarativeAdapter({id: 'fresh', hosts: ['example.test'],
            prune: [{selector: '[role="dialog"]', reason: 'modal'}],
            targets: [{selector: '#leaf', reason: 'source'}],
            keepOriginal: [{selector: '.protected', reason: 'literal'}],
            omitFromTranslation: [{selector: '.metadata', reason: 'metadata'}],
            mutationExclude: [{selector: '[role="dialog"]', reason: 'modal'}]});
        // This declarative factory supplies all three hooks; they are optional only in the custom adapter interface.
        const guards = adapter as TranslationSiteAdapter & Required<Pick<TranslationSiteAdapter,
            'shouldStayOriginal' | 'shouldOmitFromTranslation' | 'shouldIgnoreMutation'>>;
        const original = vi.spyOn(guards, 'shouldStayOriginal');
        const omit = vi.spyOn(guards, 'shouldOmitFromTranslation');
        const mutation = vi.spyOn(guards, 'shouldIgnoreMutation');
        const core = new TranslationCandidateCore({url, adapters: [adapter]});
        expect(core.inspect(leaf).candidate?.element).toBe(leaf);
        original.mockClear();
        expect(core.shouldStayOriginal(leaf)).toBe(false);
        parent.classList.add('protected');
        expect(core.shouldStayOriginal(leaf)).toBe(true);
        expect(original.mock.calls.every(([, ctx]) => ctx.closestSelectorMisses === undefined)).toBe(true);
        expect(core.inspect(leaf).candidate).toBeNull();
        parent.removeAttribute('class');
        expect(core.shouldStayOriginal(leaf)).toBe(false);
        expect(core.shouldOmitFromTranslation(leaf)).toBe(false);
        parent.classList.add('metadata');
        expect(core.shouldOmitFromTranslation(leaf)).toBe(true);
        parent.removeAttribute('class');
        expect(core.shouldOmitFromTranslation(leaf)).toBe(false);
        expect(core.shouldIgnoreMutation(leaf)).toBe(false);
        parent.setAttribute('role', 'dialog');
        expect(core.shouldIgnoreMutation(leaf)).toBe(true);
        expect(core.inspect(leaf).candidate).toBeNull();
        parent.removeAttribute('role');
        expect(core.shouldIgnoreMutation(leaf)).toBe(false);
        parent.setAttribute('translate', 'no');
        expect(core.inspect(leaf).candidate).toBeNull();
        parent.removeAttribute('translate');
        expect(core.inspect(leaf).candidate?.element).toBe(leaf);
        expect(omit.mock.calls.every(([, ctx]) => ctx.closestSelectorMisses === undefined)).toBe(true);
        expect(mutation.mock.calls.every(([, ctx]) => ctx.closestSelectorMisses === undefined)).toBe(true);
        expect(document.body.innerHTML).toBe(before);
    });

    it('keeps forced discovery misses local while resolve and public guards remain uncached', () => {
        const {document} = parseHTML('<html><body><main><p id="leaf">Readable source.</p></main></body></html>');
        const leaf = document.querySelector('#leaf')!;
        const before = document.body.innerHTML;
        const contexts: AdapterContext[] = [];
        const probe: TranslationSiteAdapter = {id: 'entry-probe', priority: 100, matches: () => true,
            decide(_element, ctx) {contexts.push(ctx); return {kind: 'pass'};},
            shouldStayOriginal(_element, ctx) {contexts.push(ctx); return false;}};
        const adapter = createDeclarativeAdapter({id: 'target', hosts: ['example.test'],
            prune: [{selector: '.excluded', reason: 'scope'}], targets: [{selector: '#leaf', reason: 'source'}]});
        const core = new TranslationCandidateCore({url, adapters: [probe, adapter]});
        expect(core.inspect(leaf).candidate?.element).toBe(leaf);
        expect(contexts.some(ctx => ctx.closestSelectorMisses !== undefined)).toBe(true);
        const inspectMisses = contexts.find(ctx => ctx.closestSelectorMisses !== undefined)!.closestSelectorMisses;
        contexts.length = 0;
        expect(core.resolve(leaf)?.element).toBe(leaf);
        expect(contexts.length).toBeGreaterThan(0);
        expect(contexts.every(ctx => ctx.closestSelectorMisses === undefined)).toBe(true);
        contexts.length = 0;
        expect(core.discover(document.body).some(candidate => candidate.element === leaf)).toBe(true);
        expect(contexts.length).toBeGreaterThan(0);
        const discoveryMisses = contexts.filter(ctx => ctx.closestSelectorMisses !== undefined)
            .map(ctx => ctx.closestSelectorMisses);
        expect(discoveryMisses.length).toBeGreaterThan(0);
        expect(new Set(discoveryMisses).size).toBe(1);
        expect(discoveryMisses[0]).not.toBe(inspectMisses);
        contexts.length = 0;
        expect(core.shouldStayOriginal(leaf)).toBe(false);
        expect(contexts.length).toBeGreaterThan(0);
        expect(contexts.every(ctx => ctx.closestSelectorMisses === undefined)).toBe(true);
        expect(document.body.innerHTML).toBe(before);
    });

    it('throwing custom decisions and original guards cannot suppress later protection during inspect', () => {
        const {document} = parseHTML('<html><body><p id="blocked" class="protected">Literal protected source.</p><p id="readable">Readable source.</p></body></html>');
        const blocked = document.querySelector('#blocked')!;
        const readable = document.querySelector('#readable')!;
        const before = document.body.innerHTML;
        const broken: TranslationSiteAdapter = {id: 'broken', priority: 100, matches: () => true,
            decide() {throw new Error('custom decision failure');}, shouldStayOriginal() {throw new Error('custom guard failure');}};
        const adapter = createDeclarativeAdapter({id: 'protected', hosts: ['example.test'],
            targets: [{selector: ['#blocked', '#readable'], match: 'closest', reason: 'source'}],
            keepOriginal: [{selector: '.protected', reason: 'literal'}]});
        const core = new TranslationCandidateCore({url, adapters: [broken, adapter]});
        expect(core.inspect(blocked).candidate).toBeNull();
        expect(core.inspect(readable).candidate?.element).toBe(readable);
        expect(core.discover(document).map(candidate => candidate.element.id)).toEqual(['readable']);
        expect(document.body.innerHTML).toBe(before);
    });
});

import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';

import {
    applyTranslationsToSnapshot,
    collectLiveTranslationTextSlots,
    createDeclarativeAdapter,
    createTranslationCore,
    createTranslationSourceSnapshot,
    extractTranslationText,
    isClearlyTargetLanguage,
    parseTranslationSlots,
    selectPreferredTranslationCandidate,
    serializeTranslationSlots,
} from '@/entrypoints/translation-core/public';
import {evaluateHardGuard, maxComposedAncestorDepth} from '@/entrypoints/translation-core/dom';
import {hasMeaningfulTranslationTextInNodes} from '@/entrypoints/translation-core/text';

function page(html: string, url = 'https://example.test/article') {
    const {document} = parseHTML(`<html><head></head><body>${html}</body></html>`);
    const core = createTranslationCore({url: new URL(url)});
    return {document, core};
}

function candidateIds(document: Document, url?: string): string[] {
    const core = createTranslationCore({url: new URL(url ?? 'https://example.test/article')});
    return core.discover(document).map((candidate) => candidate.element.id).filter(Boolean);
}

describe('translation candidate core', () => {
    it('keeps inline links and emphasis inside one paragraph candidate', () => {
        const {document, core} = page(`
            <main><p id="prose">Read <a id="link">the guide</a> with <strong>care</strong>.</p></main>
        `);
        const prose = document.querySelector('#prose')!;
        const link = document.querySelector('#link')!;

        expect(core.discover(document).map((item) => item.element)).toEqual([prose]);
        expect(core.resolve(link)?.element).toBe(prose);
    });

    it('uses the same candidate for full discovery and hover resolution', () => {
        const {document, core} = page('<main><section><p id="target"><span id="hit">A complete sentence to translate.</span></p></section></main>');
        const full = core.discover(document).find((item) => item.element.id === 'target');
        const hover = core.resolve(document.querySelector('#hit'));

        expect(full).toBeDefined();
        expect(hover?.element).toBe(full?.element);
        expect(hover?.kind).toBe(full?.kind);
    });

    it('reclassifies a candidate when its interactive role changes', () => {
        const {document, core} = page('<main><p id="target">A complete sentence to translate.</p></main>');
        const target = document.querySelector('#target')!;

        expect(core.inspect(target).candidate?.kind).toBe('content');
        target.setAttribute('role', 'button');
        expect(core.inspect(target).candidate?.kind).toBe('control');
    });

    it('does not duplicate parent containers around paragraph children', () => {
        const ids = candidateIds(parseHTML(`
            <html><body><article id="article"><div id="wrapper">
                <p id="first">First readable paragraph.</p>
                <p id="second">Second readable paragraph.</p>
            </div></article></body></html>
        `).document);

        expect(ids).toEqual(['first', 'second']);
    });

    it('segments direct inline runs around block children for full and hover', () => {
        const {document, core} = page(`
            <main><div id="mixed">Intro <strong>text</strong>
                <p id="child">Child paragraph.</p>
                Tail <em>text</em>
            </div></main>
        `);
        const mixed = document.querySelector('#mixed')!;
        const child = document.querySelector('#child')!;
        const intro = Array.from(mixed.childNodes).find((node) => node.textContent?.includes('Intro'))!;
        const tail = Array.from(mixed.childNodes).find((node) => node.textContent?.includes('Tail'))!;
        const candidates = core.discover(document);
        const runs = candidates.filter((candidate) => candidate.element === mixed && candidate.nodes);

        expect(candidates.map((candidate) => candidate.element)).toContain(child);
        expect(runs).toHaveLength(2);
        expect(runs.map((candidate) => candidate.nodes?.map((node) => node.textContent).join('').trim()))
            .toEqual(['Intro text', 'Tail text']);
        expect(core.resolve(intro)?.nodes).toEqual(runs[0]?.nodes);
        expect(core.resolve(tail)?.nodes).toEqual(runs[1]?.nodes);
    });

    it('keeps an inline-styled semantic paragraph out of a parent run', () => {
        const {document, core} = page(`
            <main><div id="mixed">
                <p id="semantic-leaf" style="display:inline">A semantic paragraph kept in place.</p>
                <ul><li>A separate block child.</li></ul>
            </div></main>
        `);
        const paragraph = document.querySelector('#semantic-leaf')!;
        const candidates = core.discover(document);

        expect(candidates.find((candidate) => candidate.element === paragraph)).toBeDefined();
        expect(candidates.some((candidate) => candidate.nodes?.includes(paragraph as ChildNode))).toBe(false);
    });

    it.each(['main', 'article', 'section', 'div'])('never reparents display:contents <%s> regions', (tag) => {
        const {document, core} = page(`
            <div id="layout">Parent before
                <${tag} id="semantic" style="display:contents">
                    Semantic before <strong id="direct">direct text</strong>
                    <p id="child">Nested paragraph.</p>
                    Semantic after
                </${tag}>
                Parent after <p id="sibling">Sibling paragraph.</p>
            </div>
        `);
        const view = document.defaultView!;
        Object.defineProperty(view, 'getComputedStyle', {
            configurable: true,
            value: (element: Element) => ({
                display: element.getAttribute('style')?.includes('display:contents') ? 'contents' :
                    ['P', 'DIV'].includes(element.tagName) ? 'block' : 'inline',
            }),
        });
        const semantic = document.querySelector('#semantic')!;
        const child = document.querySelector('#child')!;
        const direct = document.querySelector('#direct')!;
        const layout = document.querySelector('#layout')!;
        const candidates = core.discover(document);
        const semanticRuns = candidates.filter((candidate) => candidate.element === semantic && candidate.nodes);
        const layoutRuns = candidates.filter((candidate) => candidate.element === layout && candidate.nodes);

        expect(candidates.some((candidate) => candidate.nodes?.includes(semantic as ChildNode))).toBe(false);
        expect(candidates.find((candidate) => candidate.element === child)).toBeDefined();
        expect(layoutRuns.map((candidate) => candidate.nodes?.map((node) => node.textContent).join('').trim()))
            .toEqual(['Parent before', 'Parent after']);
        expect(semanticRuns).toHaveLength(2);
        expect(semanticRuns.map((candidate) => candidate.nodes?.map((node) => node.textContent).join('').trim()))
            .toEqual(['Semantic before direct text', 'Semantic after']);
        expect(core.resolve(direct)?.nodes).toEqual(semanticRuns[0]?.nodes);
        expect(core.resolve(child)?.element).toBe(child);
    });

    it('offers lazy discovery steps with the same candidates as synchronous discovery', () => {
        const {document} = parseHTML(`<html><body><main>${Array.from({length: 200}, (_, index) =>
            `<p id="p-${index}">Readable paragraph number ${index} for incremental discovery.</p>`).join('')}</main></body></html>`);
        let decisions = 0;
        const countingAdapter = {
            id: 'counting',
            matches: () => true,
            decide: () => {
                decisions += 1;
                return {kind: 'pass'} as const;
            },
        };
        const core = createTranslationCore({
            url: new URL('https://example.test'),
            adapters: [countingAdapter],
        });
        const steps = core.discoverSteps(document);
        const first = steps.next();

        expect(first.done).toBe(false);
        expect(decisions).toBeLessThan(100);

        const incremental = [first.value, ...steps]
            .flatMap((step) => step?.candidate ? [step.candidate.element.id] : []);
        expect(incremental).toEqual(core.discover(document).map((candidate) => candidate.element.id));
        expect(incremental).toHaveLength(200);
    });

    it('bounds one readability probe on an extremely wide subtree', () => {
        const {document} = parseHTML(`<html><body><div id="wide">${
            Array.from({length: 5_000}, () => '<span></span>').join('')
        }</div></body></html>`);
        const wide = document.querySelector('#wide')!;
        let inspectedElements = 0;

        expect(hasMeaningfulTranslationTextInNodes([wide], () => {
            inspectedElements += 1;
            return false;
        })).toBe(false);
        expect(inspectedElements).toBeLessThanOrEqual(2_100);
    });

    it('conservatively prunes adversarial ancestor depth without climbing the entire tree', () => {
        const {document} = parseHTML('<html><body><main id="root"></main></body></html>');
        const root = document.querySelector('#root')!;
        let parent = root;
        for (let index = 0; index < maxComposedAncestorDepth + 100; index += 1) {
            const child = document.createElement('div');
            parent.appendChild(child);
            parent = child;
        }
        parent.textContent = 'Readable text at an adversarial depth.';
        const core = createTranslationCore({url: new URL('https://example.test')});

        expect(evaluateHardGuard(parent)).toMatchObject({
            prune: true,
            reason: 'ancestor-depth-limit',
        });
        expect(core.resolve(parent.firstChild)).toBeNull();
    });

    it('shares text ancestor protection across one adversarially deep discovery', () => {
        const {document} = parseHTML('<html><body><main id="root"></main></body></html>');
        const depth = maxComposedAncestorDepth + 100;
        let parent = document.querySelector('#root')!;
        for (let index = 0; index < depth; index += 1) {
            const child = document.createElement('div');
            parent.appendChild(child);
            parent = child;
        }
        parent.textContent = 'Readable text beyond the conservative depth limit.';
        let protectionChecks = 0;
        const core = createTranslationCore({
            url: new URL('https://example.test'),
            adapters: [{
                id: 'protection-counter',
                matches: () => true,
                decide: () => ({kind: 'pass'}),
                shouldStayOriginal: () => {
                    protectionChecks += 1;
                    return false;
                },
            }],
        });

        expect(core.discover(document)).toEqual([]);
        expect(protectionChecks).toBeLessThan(depth * 4);
    });

    it('does not climb from structural chrome into an app-shell container', () => {
        const {document, core} = page(`
            <main id="app-shell"><header><p id="page-description">A header description.</p></header>
            <section><p id="article-copy">Actual article prose.</p></section></main>
        `);

        expect(core.resolve(document.querySelector('#page-description'))).toBeNull();
        expect(core.resolve(document.querySelector('#article-copy'))?.element.id).toBe('article-copy');
        expect(core.discover(document).map((item) => item.element.id)).toEqual(['article-copy']);
    });

    it('inherits translate=no and contenteditable hard guards', () => {
        const ids = candidateIds(parseHTML(`
            <html><body><main>
                <section translate="no"><p id="no-translate">Do not translate this sentence.</p></section>
                <div contenteditable="true"><p id="editor">Editable sentence.</p></div>
                <p id="allowed">Translate this ordinary sentence.</p>
            </main></body></html>
        `).document);

        expect(ids).toEqual(['allowed']);
    });

    it('preserves inline code/no-translate text without rejecting the outer prose', () => {
        const {document, core} = page(`
            <main><p id="issue-127">Set <code class="notranslate">xxx</code> to enable the feature safely.</p></main>
        `);
        const paragraph = document.querySelector('#issue-127')!;

        expect(core.discover(document).map((item) => item.element)).toContain(paragraph);
        expect(extractTranslationText(paragraph, core.shouldStayOriginal)).toBe('Set to enable the feature safely.');
        expect(core.resolve(document.querySelector('code'))?.element).toBe(paragraph);
    });

    it('keeps every nested opt-out subtree out of provider text slots', () => {
        const {document, core} = page(`
            <main><p id="target">Translate this
                <span translate="no">API_SECRET</span>
                <span data-notranslate="true">TOKEN</span>
                <span hidden>HIDDEN_TEXT</span>
                <span contenteditable="true">DRAFT_TEXT</span>
                <code>npm publish --token SECRET</code>
                <a href="/original">linked prose</a>
            </p></main>
        `);
        const target = document.querySelector('#target') as HTMLElement;
        const text = extractTranslationText(target, core.shouldStayOriginal);
        const snapshot = createTranslationSourceSnapshot(target, core.shouldStayOriginal);
        const providerPayload = snapshot.slots.map((slot) => slot.source).join('|');

        expect(text).toContain('Translate this');
        expect(text).toContain('linked prose');
        expect(text).not.toMatch(/API_SECRET|TOKEN|HIDDEN_TEXT|DRAFT_TEXT|npm publish|SECRET/u);
        expect(providerPayload).not.toMatch(/API_SECRET|TOKEN|HIDDEN_TEXT|DRAFT_TEXT|npm publish|SECRET|original/u);

        const rendered = applyTranslationsToSnapshot(
            snapshot,
            snapshot.slots.map((slot) => `译:${slot.source}`),
        );
        const {document: renderedDocument} = parseHTML(`<html><body><p>${rendered}</p></body></html>`);
        expect(renderedDocument.querySelector('code')?.textContent).toBe('npm publish --token SECRET');
        expect(renderedDocument.querySelector('a')?.getAttribute('href')).toBe('/original');
    });

    it('can re-evaluate a synthetic owner without disabling descendant safety guards', () => {
        const {document, core} = page(`
            <span id="synthetic" data-fr-translation-segment="true">
                Visible source
                <span hidden>HIDDEN_TEXT</span>
                <span translate="no">PROTECTED_TEXT</span>
            </span>
        `);
        const synthetic = document.querySelector('#synthetic') as HTMLElement;

        expect(collectLiveTranslationTextSlots(synthetic, core.shouldStayOriginal)).toEqual([]);
        const slots = collectLiveTranslationTextSlots(
            synthetic,
            core.shouldStayOriginal,
            synthetic,
        );

        expect(slots.map((slot) => slot.source)).toEqual(['Visible source']);
        expect(extractTranslationText(synthetic, core.shouldStayOriginal, synthetic)).toBe('Visible source');
    });

    it('applies provider slots to a fresh safe snapshot so current link attributes win', () => {
        const {document, core} = page(`
            <p id="target">Read <a href="/a">the current guide</a>.</p>
        `);
        const target = document.querySelector('#target') as HTMLElement;
        const initial = createTranslationSourceSnapshot(target, core.shouldStayOriginal);
        const sources = initial.slots.map((slot) => slot.source);

        target.querySelector('a')!.setAttribute('href', '/b');
        const fresh = createTranslationSourceSnapshot(target, core.shouldStayOriginal);
        const rendered = applyTranslationsToSnapshot(
            fresh,
            sources.map((source) => `译:${source}`),
        );
        const {document: renderedDocument} = parseHTML(`<html><body>${rendered}</body></html>`);

        expect(fresh.slots.map((slot) => slot.source)).toEqual(sources);
        expect(renderedDocument.querySelector('a')?.getAttribute('href')).toBe('/b');
    });

    it('evaluates provider slots against live external ancestors before cloning', () => {
        const {document} = parseHTML(`
            <html><body><div class="private"><p id="target">Translate this
                <span class="secret">EXTERNAL_SECRET</span> safely.</p></div></body></html>
        `);
        const adapter = createDeclarativeAdapter({
            id: 'external-private-boundary',
            hosts: ['example.test'],
            keepOriginal: [{selector: '.private .secret', reason: 'private'}],
        });
        const core = createTranslationCore({url: new URL('https://example.test'), adapters: [adapter]});
        const snapshot = createTranslationSourceSnapshot(
            document.querySelector('#target') as HTMLElement,
            core.shouldStayOriginal,
        );

        expect(snapshot.slots.map((slot) => slot.source).join('|')).not.toContain('EXTERNAL_SECRET');
        expect(snapshot.clone.querySelector('.secret')?.textContent).toBe('EXTERNAL_SECRET');
    });

    it('round-trips several text slots through one strict provider packet', () => {
        const packet = serializeTranslationSlots(['Click ', 'here', ' to continue.'], 'test_nonce');
        const translated = packet.starts.map((start, index) =>
            `${start}${['点击', '这里', '以继续。'][index]}${packet.ends[index]}`).join('\n');

        expect(parseTranslationSlots(packet, translated)).toEqual(['点击', '这里', '以继续。']);
        expect(parseTranslationSlots(packet, `Provider note\n${translated}`)).toBeNull();
        expect(serializeTranslationSlots([
            '___FLUENTREAD_test_nonce_0_BEGIN___ collision',
        ], 'test_nonce').starts[0]).not.toBe('___FLUENTREAD_test_nonce_0_BEGIN___');
    });

    it('discovers readable content in an open shadow root', () => {
        const {document, core} = page('<main><article-card id="host"></article-card></main>');
        const host = document.querySelector('#host')!;
        const shadowRoot = host.attachShadow({mode: 'open'});
        shadowRoot.innerHTML = '<section><p id="shadow-prose">A sentence rendered by a web component.</p></section>';

        expect(core.discover(document).map((item) => item.element.id)).toContain('shadow-prose');
        expect(core.resolve(shadowRoot.querySelector('#shadow-prose'))?.element.id).toBe('shadow-prose');
    });

    it('translates GitHub PR titles instead of pruning repository-content', () => {
        const {document, core} = page(`
            <main id="repo-content-pjax-container" class="repository-content">
                <div role="group" aria-label="Issues">
                    <a id="pr-title" class="markdown-title" data-hovercard-type="pull_request">
                        Fix quick search during full page translation
                    </a>
                </div>
            </main>
        `, 'https://github.com/immersive-translate/immersive-translate/pulls');
        const title = document.querySelector('#pr-title')!;
        const candidate = core.discover(document).find((item) => item.element === title);

        expect(candidate).toMatchObject({adapterId: 'github', reason: 'github-markdown-title'});
        expect(core.resolve(title)?.element).toBe(title);
    });

    it('keeps an exact adapter target out of an ancestor inline run', () => {
        const {document, core} = page(`
            <main><div id="row">
                <a id="pr-title" class="markdown-title">Fix partial pull-request translation</a>
                <p>Block child that makes the row produce an inline run.</p>
            </div></main>
        `, 'https://github.com/immersive-translate/immersive-translate/pulls');
        const candidates = [...core.discoverSteps(document)]
            .flatMap((step) => step.candidate ? [step.candidate] : []);
        const explicit = candidates.find((candidate) => candidate.adapterId === 'github')!;
        const generic = candidates.find((candidate) =>
            candidate.nodes?.includes(document.querySelector('#pr-title') as ChildNode));
        const genericEquivalent = {...explicit, adapterId: undefined, reason: 'generic-inline-run'};

        expect(explicit).toBeDefined();
        expect(generic).toBeUndefined();
        expect(selectPreferredTranslationCandidate(explicit, genericEquivalent)).toBe(explicit);
        expect(selectPreferredTranslationCandidate(genericEquivalent, explicit)).toBe(explicit);
        expect(core.discover(document).find((candidate) => candidate.element.id === 'pr-title'))
            .toMatchObject({adapterId: 'github', reason: 'github-markdown-title'});
    });

    it('keeps ordinary inline siblings when an atomic target is the only barrier', () => {
        const {document, core} = page(`
            <main><div id="row">Readable prose before the title.
                <a id="pr-title" class="markdown-title">Fix partial pull-request translation</a>
                Readable prose after the title.</div></main>
        `, 'https://github.com/immersive-translate/immersive-translate/pulls');
        const row = document.querySelector('#row')!;
        const title = document.querySelector('#pr-title')!;
        const before = row.childNodes[0]!;
        const after = row.childNodes[2]!;
        const candidates = core.discover(document);
        const inlineRuns = candidates.filter((candidate) => candidate.reason === 'generic-inline-run');

        expect(candidates.find((candidate) => candidate.element === title))
            .toMatchObject({adapterId: 'github', reason: 'github-markdown-title'});
        expect(inlineRuns.map((candidate) => candidate.nodes)).toEqual([[before], [after]]);
        expect(core.resolve(before)?.nodes).toEqual([before]);
        expect(core.resolve(title)?.element).toBe(title);
        expect(core.resolve(after)?.nodes).toEqual([after]);
    });

    it('prefers an atomic self target over inline runs inside that target', () => {
        const {document} = parseHTML(`
            <html><body><main><div id="forced">Readable direct introduction.
                <p>Readable nested block.</p></div></main></body></html>
        `);
        const adapter = createDeclarativeAdapter({
            id: 'atomic-mixed-target',
            hosts: ['example.test'],
            targets: [{selector: '#forced', reason: 'atomic-mixed-target', atomic: true}],
        });
        const core = createTranslationCore({url: new URL('https://example.test'), adapters: [adapter]});
        const forced = document.querySelector('#forced')!;
        const directText = forced.firstChild!;

        expect(core.discover(document)).toEqual([
            expect.objectContaining({element: forced, adapterId: 'atomic-mixed-target'}),
        ]);
        expect(core.resolve(directText)).toMatchObject({
            element: forced,
            adapterId: 'atomic-mixed-target',
        });
        expect(core.resolve(directText)?.nodes).toBeUndefined();
    });

    it('prunes GitHub quick-search controlled UI', () => {
        const {document, core} = page(`
            <main><dialog open aria-label="Quick search"><p id="search-result">Search suggestion text.</p></dialog>
            <p id="body-copy">Repository body sentence.</p></main>
        `, 'https://github.com/FluentRead/FluentRead/pulls');

        const ids = core.discover(document).map((item) => item.element.id);
        expect(ids).not.toContain('search-result');
        expect(ids).toContain('body-copy');
    });

    it('keeps mutation exclusion separate from translation exclusion', () => {
        const {document} = parseHTML(`
            <html><body><main>
                <div id="ticker"><p id="dynamic-copy">A controlled live result.</p></div>
                <p id="static-copy">A stable article sentence.</p>
            </main></body></html>
        `);
        const adapter = createDeclarativeAdapter({
            id: 'controlled-ui',
            hosts: ['example.test'],
            mutationExclude: [{selector: '#ticker', reason: 'controlled-live-region'}],
        });
        const core = createTranslationCore({
            url: new URL('https://example.test'),
            adapters: [adapter],
        });
        const ticker = document.querySelector('#ticker')!;
        const copy = document.querySelector('#dynamic-copy')!;

        expect(core.shouldIgnoreMutation(ticker)).toBe(true);
        expect(core.shouldIgnoreMutation(copy)).toBe(true);
        expect(core.shouldStayOriginal(copy)).toBe(false);
        expect(core.discover(document).map((item) => item.element.id)).toContain('dynamic-copy');
    });

    it('keeps GNU Texinfo navigation panels original while targeting prose', () => {
        const {document, core} = page(`
            <div class="section-level-extent">
                <div class="nav-panel"><p id="navigation">Next: Definitions, Up: Introduction</p></div>
                <p id="manual-copy">Bash is a command language interpreter for the GNU operating system.</p>
            </div>
        `, 'https://www.gnu.org/software/bash/manual/html_node/What-is-Bash_003f.html');

        expect(core.discover(document).map((item) => item.element.id)).toEqual(['manual-copy']);
        expect(core.resolve(document.querySelector('#navigation'))).toBeNull();
    });

    it('handles stale or invalid site selectors without aborting discovery', () => {
        const {document} = parseHTML('<html><body><main><p id="safe">Readable fallback prose.</p></main></body></html>');
        const adapter = createDeclarativeAdapter({
            id: 'broken-selector',
            hosts: ['example.test'],
            prune: [{selector: '[invalid=', reason: 'invalid'}],
            targets: [{selector: ':not(', reason: 'invalid-target'}],
        });
        const core = createTranslationCore({url: new URL('https://example.test'), adapters: [adapter]});

        expect(core.discover(document).map((item) => item.element.id)).toEqual(['safe']);
    });

    it('drops one invalid selector without disabling valid selectors in the same rule', () => {
        const {document} = parseHTML('<html><body><main><p id="safe">Readable fallback prose.</p></main></body></html>');
        const adapter = createDeclarativeAdapter({
            id: 'partially-broken-selector',
            hosts: ['example.test'],
            targets: [{
                selector: [':not(', '#safe'],
                reason: 'valid-selector-survives',
            }],
        });
        const core = createTranslationCore({url: new URL('https://example.test'), adapters: [adapter]});

        expect(core.discover(document)[0]).toMatchObject({
            element: document.querySelector('#safe'),
            adapterId: 'partially-broken-selector',
            reason: 'valid-selector-survives',
        });
    });

    it('combines selector lists so a generic adapter miss does not repeat ancestor walks', () => {
        const {document} = parseHTML('<html><body><main><p id="safe">Readable fallback prose.</p></main></body></html>');
        const adapter = createDeclarativeAdapter({
            id: 'selector-cost',
            hosts: ['example.test'],
            prune: [{
                selector: Array.from({length: 20}, (_, index) => `.never-prune-${index}`),
                reason: 'never-prune',
            }],
            targets: [{
                selector: Array.from({length: 20}, (_, index) => `.never-target-${index}`),
                reason: 'never-target',
                match: 'closest',
            }],
        });
        const target = document.querySelector('#safe')!;
        const closest = vi.spyOn(target, 'closest');

        expect(adapter.decide(target, {url: new URL('https://example.test')})).toEqual({kind: 'pass'});
        expect(closest).toHaveBeenCalledTimes(2);
    });

    it('isolates faulty adapters and preserves registration order for equal priorities', () => {
        const {document} = parseHTML('<html><body><main><p id="safe">Readable fallback prose.</p></main></body></html>');
        const faulty = {
            id: 'faulty',
            priority: 100,
            matches: () => true,
            decide: () => { throw new Error('adapter failure'); },
            shouldStayOriginal: () => { throw new Error('adapter failure'); },
        };
        const first = createDeclarativeAdapter({
            id: 'z-first-registered',
            priority: 50,
            hosts: ['example.test'],
            targets: [{selector: '#safe', reason: 'first-wins'}],
        });
        const second = createDeclarativeAdapter({
            id: 'a-second-registered',
            priority: 50,
            hosts: ['example.test'],
            targets: [{selector: '#safe', reason: 'second-loses'}],
        });
        const core = createTranslationCore({
            url: new URL('https://example.test'),
            adapters: [faulty, first, second],
        });

        expect(core.discover(document)[0]).toMatchObject({
            adapterId: 'z-first-registered',
            reason: 'first-wins',
        });
    });

    it('continues into children when a forced target is stale or explicitly non-atomic', () => {
        const {document} = parseHTML(`
            <html><body><main><div id="wrapper">Readable direct intro.
                <p id="child">Readable child paragraph.</p></div>
            <div id="empty"></div></main></body></html>
        `);
        const stale = {
            id: 'stale-target',
            matches: () => true,
            decide: (element: Element) => element.id === 'wrapper'
                ? {kind: 'force-target' as const, target: document.querySelector('#empty')!, reason: 'stale'}
                : {kind: 'pass' as const},
        };
        const nonAtomic = {
            id: 'non-atomic-target',
            matches: () => true,
            decide: (element: Element) => element.id === 'wrapper'
                ? {kind: 'force-target' as const, reason: 'container', atomic: false}
                : {kind: 'pass' as const},
        };

        const staleCore = createTranslationCore({url: new URL('https://example.test'), adapters: [stale]});
        expect(staleCore.discover(document).map((candidate) => candidate.element.id)).toContain('child');

        const nonAtomicCore = createTranslationCore({url: new URL('https://example.test'), adapters: [nonAtomic]});
        const candidates = nonAtomicCore.discover(document);
        expect(candidates.map((candidate) => candidate.element.id)).toEqual(['child', 'wrapper']);
        expect(candidates.find((candidate) => candidate.element.id === 'wrapper')?.nodes).toHaveLength(1);
        expect(nonAtomicCore.resolve(document.querySelector('#child'))?.element.id).toBe('child');
        expect(nonAtomicCore.resolve(document.querySelector('#wrapper')?.firstChild)?.nodes)
            .toEqual(candidates.find((candidate) => candidate.element.id === 'wrapper')?.nodes);
    });

    it('allows an adapter to force the same structural target for full and hover', () => {
        const {document} = parseHTML(`
            <html><body><header id="forced"><span id="hit">Readable structural prose.</span></header></body></html>
        `);
        const adapter = createDeclarativeAdapter({
            id: 'forced-header',
            hosts: ['example.test'],
            targets: [{selector: '#forced', reason: 'explicit-header', atomic: true}],
        });
        const core = createTranslationCore({url: new URL('https://example.test'), adapters: [adapter]});

        expect(core.discover(document).map((candidate) => candidate.element.id)).toEqual(['forced']);
        expect(core.resolve(document.querySelector('#hit'))?.element.id).toBe('forced');
    });

    it('bounds discovery work for a single huge inline subtree', () => {
        const {document} = parseHTML('<html><body><main><p id="huge"></p></main></body></html>');
        const huge = document.querySelector('#huge')!;
        for (let index = 0; index < 5000; index += 1) {
            huge.appendChild(document.createTextNode(index === 0 ? 'Readable prose.' : ' ·'));
        }
        const core = createTranslationCore({url: new URL('https://example.test')});
        const steps = core.discoverSteps(document);
        let candidate: ReturnType<typeof core.discover>[number] | undefined;
        for (const step of steps) candidate ??= step.candidate;

        expect(candidate?.element.id).toBe('huge');
    });

    it('walks deeply nested DOM iteratively without overflowing the call stack', () => {
        const {document} = parseHTML('<html><body><main id="root"></main></body></html>');
        let parent = document.querySelector('#root')!;
        for (let index = 0; index < 400; index += 1) {
            const child = document.createElement('div');
            parent.appendChild(child);
            parent = child;
        }
        const paragraph = document.createElement('p');
        paragraph.id = 'deep-prose';
        paragraph.textContent = 'A readable sentence at the deepest level.';
        parent.appendChild(paragraph);

        expect(candidateIds(document)).toEqual(['deep-prose']);
    });

    it('filters identifiers and pure numeric metadata', () => {
        const ids = candidateIds(parseHTML(`
            <html><body><main>
                <p id="hash">a1b2c3d4</p>
                <p id="number">2026-08-18</p>
                <p id="words">A meaningful release description.</p>
            </main></body></html>
        `).document);

        expect(ids).toEqual(['words']);
    });

    it('only skips short text when the target script is clear', () => {
        expect(isClearlyTargetLanguage('翻译设置', 'zh-CN')).toBe(true);
        expect(isClearlyTargetLanguage('Pull requests', 'zh-CN')).toBe(false);
        expect(isClearlyTargetLanguage('API', 'zh-CN')).toBe(false);
        expect(isClearlyTargetLanguage('Settings', 'en')).toBe(true);
    });
});

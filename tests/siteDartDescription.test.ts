import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';
import {builtinSiteRulePack} from '@/src/core/site-adaptation/catalog';
import {compileSiteRulePack} from '@/src/core/site-adaptation/compiler';
import {TranslationCandidateCore} from '@/src/core/translation/engine';
import {createTranslationSourceSnapshot} from '@/src/core/translation/serialization';

const adapters = compileSiteRulePack(builtinSiteRulePack);

// 最小结构保留 dart.dev/language 2026-10-15 实际导语的完整语义祖先；不是全局 header 放行。
function fixture(url = 'https://dart.dev/language') {
    const {document} = parseHTML(`<html><body>
        <header id="site-header"><nav><p id="global-navigation">Browse the documentation navigation.</p></nav></header>
        <main id="page-content"><div class="after-leading-content"><article><div class="content">
            <header id="site-content-title" class="wrap">
                <nav class="breadcrumbs"><p id="breadcrumb">Language documentation breadcrumb.</p></nav>
                <h1 id="document-title">Introduction to Dart</h1>
                <p class="page-description">A brief introduction to Dart programs and important concepts.</p>
                <div id="page-header-options"><button>View page options</button></div>
            </header>
            <section class="content"><p id="body">This page introduces the main language features.</p>
                <pre><code id="protected-code">void main() { print('hello'); }</code></pre></section>
        </div></article></div></main>
        <header id="unrelated-header"><p class="page-description">A different header must stay protected.</p></header>
    </body></html>`);
    return {document, core:new TranslationCandidateCore({url:new URL(url), adapters}),
        description:document.querySelector<HTMLElement>('#site-content-title > .page-description')!};
}

describe('Dart article description', () => {
    it('discovers the actual header description with the same owner for hover and full-page translation', () => {
        const {document, core, description} = fixture();
        const candidates = core.discover(document);
        const found = candidates.find(candidate => candidate.element === description);
        expect(found).toBeDefined();
        expect(found?.adapterId).toBe('dart');
        expect(core.resolve(description.firstChild)?.element).toBe(description);
        expect(candidates.some(candidate => candidate.element.id === 'body')).toBe(true);
        expect(candidates.some(candidate => candidate.element.id === 'document-title')).toBe(true);
        expect(createTranslationSourceSnapshot(description,core.shouldStayOriginal).slots.map(slot => slot.source))
            .toEqual(['A brief introduction to Dart programs and important concepts.']);
    });

    it('does not broaden other headers or navigation and keeps code outside provider slots', () => {
        const {document, core, description} = fixture();
        const candidates = core.discover(document);
        for (const selector of ['#global-navigation','#breadcrumb','#unrelated-header > p','#page-header-options button','#protected-code']) {
            const node = document.querySelector(selector)!;
            expect(candidates.some(candidate => candidate.element === node),selector).toBe(false);
            expect(core.resolve(node.firstChild)?.element,selector).not.toBe(node);
        }
        description.innerHTML = 'Learn the <code>main()</code> entry point before reading the examples.';
        expect(core.discover(document).find(candidate => candidate.element === description)?.adapterId).toBe('dart');
        const source = createTranslationSourceSnapshot(description,core.shouldStayOriginal).slots.map(slot => slot.source).join('');
        expect(source).toContain('entry point');
        expect(source).not.toContain('main()');
        expect(core.shouldStayOriginal(description.querySelector('code')!)).toBe(true);
    });

    it.each(['translate','hidden','contenteditable'] as const)('retains the %s hard boundary even on the exact description', attribute => {
        const {document, core, description} = fixture();
        description.setAttribute(attribute,attribute==='translate' ? 'no' : attribute==='hidden' ? '' : 'true');
        expect(core.discover(document).some(candidate => candidate.element===description)).toBe(false);
        expect(core.resolve(description.firstChild)).toBeNull();
    });

    it.each(['https://example.com/language','https://api.dart.dev/language'])('does not apply the Dart docs exception to %s', url => {
        const {document,core,description} = fixture(url);
        expect(core.adapters.some(adapter => adapter.id==='dart')).toBe(false);
        expect(core.discover(document).some(candidate => candidate.element===description)).toBe(false);
    });

    it('reclassifies a replacement header description using the same narrow rule', () => {
        const {document,core,description} = fixture();
        const replacement = description.cloneNode(true) as HTMLElement;
        description.replaceWith(replacement);
        expect(core.discover(document).find(candidate => candidate.element===replacement)?.adapterId).toBe('dart');
        expect(core.resolve(replacement.firstChild)?.element).toBe(replacement);
    });
});

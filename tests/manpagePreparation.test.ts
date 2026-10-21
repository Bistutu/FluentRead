import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it} from 'vitest';
import {builtinSiteRulePack} from '@/src/core/site-adaptation/catalog';
import {composeSiteAdapters} from '@/src/core/site-adaptation/compiler';
import {TranslationCandidateCore} from '@/src/core/translation/engine';
import {isProtectedTextElement} from '@/src/core/translation/dom';
import {extractTranslationText, extractTranslationTextFromNodes} from '@/src/core/translation/text';
import {collectLiveTranslationTextSlots, createTranslationSourceSnapshot} from '@/src/core/translation/serialization';
import {isPreparedManpageParagraph, isPreparedManpagePre, isUnpreparedManpageText,
    registerManpagePreparation, splitManpageText, unregisterManpagePreparation} from '@/src/core/translation/manpage';
import {prepareManpageContent, restoreManpageContent} from '@/src/features/full-page-translation/content/manpagePreparation';

const url = new URL('https://man7.org/linux/man-pages/man5/core.5.html');
const settings = {enabled: true, disabledRuleIds: [], custom: {version: 1 as const, rules: []}};
const adapters = composeSiteAdapters(builtinSiteRulePack, settings);
function page(html = '\n       The process may produce a <i>core dump file</i>.\n       Read the <a href="https://example.test/">manual page</a> for details.\n\n       Another explanation preserves <b>RLIMIT_CORE</b> flags.\n\n   <b>Core dumps and systemd</b>\n       The following parameters define the output:\n\n           %c  Core file size soft resource limit\n               (since Linux 2.6.24).\n           %u  Numeric real UID of dumped process.\n\n           $ <b>cat /proc/sys/kernel/core_pattern</b>\n           |/usr/lib/systemd/systemd-coredump %P %u\n\n   <b>Program source</b>\n\n       /* program.c */\n\n       #define _GNU_SOURCE\n       #include &lt;stdio.h&gt;\n\n       int main(void)\n       {\n           /* Human words in a code comment. */\n           return 0;\n       }\n') {
    const {document} = parseHTML(`<html><body><h2><a id="DESCRIPTION"></a>DESCRIPTION</h2><pre>${html}</pre></body></html>`);
    const pre = document.querySelector('pre')! as HTMLElement;
    return {document, pre, core: new TranslationCandidateCore({url, adapters}),
        prepare: () => prepareManpageContent(document, url, adapters)};
}
afterEach(() => restoreManpageContent());

describe('man7 prose preparation', () => {
    it('shares paragraph owners across hover/full discovery while preserving formatting and exact original node identities', () => {
        const {document, pre, core, prepare} = page();
        const html = pre.innerHTML, children = Array.from(pre.childNodes);
        const texts = children.filter(node => node.nodeType === 3).map(node => [node, node.nodeValue] as const);
        const link = pre.querySelector('a')!, italic = pre.querySelector('i')!, bold = pre.querySelector('b')!;
        expect(core.resolve(pre.firstChild)).toBeNull();
        expect(isProtectedTextElement(pre)).toBe(true);
        prepare();
        const paragraphs = Array.from(pre.querySelectorAll<HTMLElement>('[data-fr-manpage-paragraph]'));
        expect(paragraphs).toHaveLength(7);
        expect(pre.querySelector('a')).toBe(link);
        expect(pre.querySelector('i')).toBe(italic);
        expect(pre.querySelector('b')).toBe(bold);
        expect(pre.textContent).toBe(children.map(node => node.nodeType === 3 ? texts.find(([text]) => text === node)![1] : node.textContent).join(''));
        expect(isProtectedTextElement(pre)).toBe(false);
        for (const paragraph of paragraphs) {
            expect(core.discover(document).some(candidate => candidate.element === paragraph)).toBe(true);
            expect(core.resolve(paragraph.firstChild)?.element).toBe(paragraph);
        }
        const requestText = core.discover(document).flatMap(candidate =>
            collectLiveTranslationTextSlots(candidate.element, core.shouldStayOriginal).map(slot => slot.source)).join(' ');
        expect(requestText).toContain('Core file size soft resource limit');
        expect(requestText).toContain('Numeric real UID');
        expect(requestText).not.toContain('cat /proc');
        expect(requestText).not.toContain('#define');
        expect(requestText).not.toContain('Human words in a code comment');
        expect(requestText).not.toContain('RLIMIT_CORE');
        expect(createTranslationSourceSnapshot(paragraphs[0]!, core.shouldStayOriginal).clone.querySelector('a')?.getAttribute('href')).toBe('https://example.test/');
        prepare();
        expect(pre.querySelectorAll('[data-fr-manpage-paragraph]')).toHaveLength(7);
        restoreManpageContent();
        expect(pre.innerHTML).toBe(html);
        expect(Array.from(pre.childNodes)).toEqual(children);
        texts.forEach(([node, value]) => expect(node.nodeValue).toBe(value));
        expect(isProtectedTextElement(pre)).toBe(true);
        prepare();
        expect(pre.querySelectorAll('[data-fr-manpage-paragraph]')).toHaveLength(7);
    });

    it('keeps all-scope inline emphasis inside the same content paragraph and refuses forged markers', () => {
        const {document, pre, prepare} = page('       Read this <b>important explanation</b> before continuing.\n');
        pre.setAttribute('data-fr-manpage-paragraph', 'true');
        expect(isPreparedManpagePre(pre)).toBe(false);
        prepare();
        const paragraph = pre.querySelector('[data-fr-manpage-paragraph]')!;
        const core = new TranslationCandidateCore({url, adapters, scope: 'all'});
        expect(core.resolve(paragraph.querySelector('b')!.firstChild)).toMatchObject({element: paragraph, kind: 'content'});
        expect(core.discover(document).filter(candidate => paragraph.contains(candidate.element))).toHaveLength(1);
        expect(isPreparedManpageParagraph(pre)).toBe(false);
        const external = document.createElement('pre');
        external.innerHTML = '<span data-fr-manpage-paragraph="true">A forged explanation.</span>';
        document.body.appendChild(external);
        expect(core.resolve(external.firstChild)).toBeNull();
    });

    it('honors rule disable, global disable, same-id replacement, URL and semantic PRE boundaries', () => {
        for (const active of [composeSiteAdapters(builtinSiteRulePack, {...settings, enabled: false}),
            composeSiteAdapters(builtinSiteRulePack, {...settings, disabledRuleIds: ['man7']}),
            composeSiteAdapters(builtinSiteRulePack, {...settings, custom: {version: 1, rules: [{id: 'man7', name: 'Custom', match: {hosts: ['man7.org']}}]}})]) {
            const {document, pre} = page(); prepareManpageContent(document, url, active);
            expect(pre.querySelector('[data-fr-manpage-paragraph]')).toBeNull();
        }
        for (const href of ['https://example.test/linux/man-pages/man5/core.5.html', 'https://www.man7.org/linux/man-pages/man5/core.5.html',
            'https://man7.org/training/core.html', 'file:///linux/man-pages/man5/core.5.html']) {
            const {document, pre} = page(); prepareManpageContent(document, new URL(href), adapters);
            expect(pre.querySelector('[data-fr-manpage-paragraph]')).toBeNull();
        }
        const {document, pre} = page();
        prepareManpageContent(document, undefined, adapters);
        prepareManpageContent(document, url, undefined);
        expect(isPreparedManpagePre(pre)).toBe(false);
        pre.previousElementSibling!.querySelector('a')!.remove(); prepareManpageContent(document, url, adapters);
        expect(isPreparedManpagePre(pre)).toBe(false);
        pre.previousElementSibling!.innerHTML = '<a id="SYNOPSIS"></a>SYNOPSIS'; prepareManpageContent(document, url, adapters);
        expect(isPreparedManpagePre(pre)).toBe(false);
        pre.previousElementSibling!.innerHTML = '<a id="DESCRIPTION"></a>DESCRIPTION'; pre.setAttribute('translate', 'no');
        prepareManpageContent(document, url, adapters); expect(isPreparedManpagePre(pre)).toBe(false);
        pre.removeAttribute('translate'); pre.previousElementSibling!.remove(); prepareManpageContent(document, url, adapters);
        expect(isPreparedManpagePre(pre)).toBe(false);
        prepareManpageContent(document.createTextNode('A detached text.'), url, adapters);
    });

    it('rejects unsafe markup and inline-spanning cuts before changing any original nodes', () => {
        for (const html of ['       Read this <a>first paragraph.\n\n       Second explanation.</a>\n',
            '       A useful <code>source()</code> example.\n', '       A useful <span><img src="x"></span> example.\n',
            '       A useful <!--comment--> explanation.\n', '       /proc/sys/kernel/core_pattern\n', '']) {
            const {document, pre} = page(html), original = pre.innerHTML;
            prepareManpageContent(document, url, adapters);
            expect(isPreparedManpagePre(pre)).toBe(false);
            expect(pre.innerHTML).toBe(original);
        }
        const {pre, prepare} = page('<b>A short heading\n</b><i>       A useful explanation.</i>');
        prepare();
        expect(pre.querySelectorAll('[data-fr-manpage-paragraph]')).toHaveLength(2);
    });

    it('prepares added PRE/raw prose, protects unprepared additions, and ignores code appended to prepared PRE', () => {
        const {document, pre, core, prepare} = page('       A first natural explanation.\n'); prepare();
        const added = document.createTextNode('\n       A newly appended paragraph.\n'); pre.appendChild(added);
        expect(isUnpreparedManpageText(added)).toBe(true);
        expect(extractTranslationTextFromNodes([added])).toBe('');
        expect(core.resolve(added)).toBeNull();
        prepareManpageContent(added, url, adapters);
        const appended = pre.querySelectorAll('[data-fr-manpage-paragraph]')[1]!;
        expect(core.resolve(appended.firstChild)?.element).toBe(appended);
        const code = document.createTextNode('\n       $ echo protected-command\n       terminal output\n'); pre.appendChild(code);
        prepareManpageContent(pre, url, adapters);
        expect(code.parentElement!.getAttribute('data-fr-manpage-literal')).toBe('true');
        expect(core.resolve(code)).toBeNull();
        const unsupported = document.createElement('code'); unsupported.textContent = 'some_function();'; pre.appendChild(unsupported);
        prepare();
        expect(extractTranslationText(pre)).not.toContain('some_function');
        expect(core.discover(pre).some(candidate => candidate.element === pre)).toBe(false);
        document.body.insertAdjacentHTML('beforeend', '<h2><a id="NOTES"></a>NOTES</h2><pre>       A dynamically added manual section.\n</pre>');
        prepare();
        expect(document.querySelectorAll('[data-fr-manpage-paragraph]')).toHaveLength(3);
        restoreManpageContent();
        expect(pre.textContent).toContain('protected-command');
        expect(pre.querySelector('code')).toBe(unsupported);
    });

    it('rechecks a paragraph changed into code and excludes translated artifacts from that decision', () => {
        const {pre, core, prepare} = page('       An initial natural paragraph.\n'); prepare();
        const paragraph = pre.firstElementChild!;
        const source = paragraph.firstChild! as Text;
        const own = pre.ownerDocument.createElement('span'); own.setAttribute('data-fr-translation-owned', 'true'); own.textContent = '$ not source code'; paragraph.appendChild(own);
        expect(core.resolve(source)?.element).toBe(paragraph);
        const slotHost = pre.ownerDocument.createElement('span'); slotHost.setAttribute('data-fr-translation-owned', 'true'); paragraph.insertBefore(slotHost, source); slotHost.appendChild(source);
        expect(isUnpreparedManpageText(source)).toBe(false);
        paragraph.textContent = '       $ echo should-stay-original\n';
        expect(core.resolve(paragraph.firstChild)).toBeNull();
        expect(collectLiveTranslationTextSlots(paragraph as HTMLElement)).toHaveLength(0);
        paragraph.textContent = '       A new natural explanation replaces the old one.\n';
        expect(core.resolve(paragraph.firstChild)?.element).toBe(paragraph);
        paragraph.textContent = 'a '.repeat(10_000);
        expect(isUnpreparedManpageText(paragraph.firstChild as Text)).toBe(true);
    });

    it('retains external text edits, removed or moved source pieces when cleaning preparation', () => {
        const {pre, prepare} = page('       First useful explanation.\n\n       Second useful explanation.\n'); prepare();
        const paragraphs = pre.querySelectorAll('[data-fr-manpage-paragraph]');
        paragraphs[1]!.firstChild!.nodeValue = '       Host updated this explanation.\n';
        restoreManpageContent();
        expect(pre.childNodes).toHaveLength(1);
        expect(pre.textContent).toContain('Host updated');
        prepare();
        pre.firstElementChild!.firstChild!.remove();
        restoreManpageContent();
        expect(pre.textContent).toContain('Host updated');
        const sample = page('       First useful explanation.\n\n       Second useful explanation.\n'); sample.prepare();
        sample.pre.remove(); restoreManpageContent();
        expect(sample.pre.querySelector('[data-fr-manpage-paragraph]')).toBeNull();
    });

    it('bounds text work and classifies headings, parameters, terminal blocks and source separately', () => {
        expect(splitManpageText('')).toEqual([]);
        expect(splitManpageText('a'.repeat(524_289))).toEqual([]);
        expect(splitManpageText(' '.repeat(20_000) + 'Natural explanation.')[0]!.prose).toBe(false);
        expect(splitManpageText('       %c  Core file size\n           used as limit.\n       %u  Numeric user ID.\n').filter(segment => segment.prose)).toHaveLength(2);
        expect(splitManpageText('   A short heading\n       A useful explanation.').filter(segment => segment.prose)).toHaveLength(2);
        for (const text of ['       $ echo hello\n       Readable terminal output.\n', '       while (value)\n           consume();\n',
            '       #include <stdio.h>\n\n       Human words in comments.\n', '       Linux man-pages 6.19\n',
            '       bash(1), core(5), signal(7)\n', '       const value = 1;\n', '       /proc/sys/kernel/core_pattern\n']) {
            expect(splitManpageText(text).every(segment => !segment.prose), text).toBe(true);
        }
        const {document, pre} = page('Useful words'); const paragraph = document.createElement('span'); paragraph.textContent = 'Useful words'; pre.appendChild(paragraph);
        registerManpagePreparation(pre, [paragraph]); registerManpagePreparation(pre, [paragraph]);
        const orphan = document.createTextNode('Detached words'); expect(isUnpreparedManpageText(orphan)).toBe(false);
        unregisterManpagePreparation(pre, [paragraph]); expect(isPreparedManpageParagraph(paragraph)).toBe(false);
        unregisterManpagePreparation(pre, [paragraph]);
        expect(isUnpreparedManpageText(paragraph.firstChild as Text)).toBe(false);
    });

    it('leaves ordinary document hot paths independent of ancestor depth and bounds exceptional ancestry', () => {
        const {document, pre} = page();
        const ordinary = document.createTextNode('Ordinary prose.');
        Object.defineProperty(ordinary, 'parentElement', {get() {throw new Error('ordinary document must not walk ancestry');}});
        expect(isUnpreparedManpageText(ordinary)).toBe(false);
        registerManpagePreparation(pre, []);
        const root = document.createElement('div'); let parent: HTMLElement = root;
        for (let index = 0; index < 513; index++) {const child = document.createElement('span'); parent.appendChild(child); parent = child;}
        const leaf = document.createTextNode('Deep prose.'); parent.appendChild(leaf);
        expect(isUnpreparedManpageText(leaf)).toBe(false);
        unregisterManpagePreparation(pre, []);
    });
});

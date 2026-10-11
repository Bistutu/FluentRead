import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';

import rawProfiles from '@/src/core/site-adaptation/catalog/profiles.json';
import rawRules from '@/src/core/site-adaptation/catalog/websites.json';
import coverage from '@/src/core/site-adaptation/catalog/coverage.json';
import fixtures from '@/scripts/site-translation/site-adaptation-fixtures.json';
import liveCases from '@/scripts/site-translation/site-adaptation-live-cases.json';
import {compileSiteRulePack, resolveSiteRule} from '@/src/core/site-adaptation/compiler';
import {parseSiteRulePack, validateSelectors} from '@/src/core/site-adaptation/schema';
import {TranslationCandidateCore} from '@/src/core/translation/engine';
import {extractTranslationText, extractTranslationTextFromNodes} from '@/src/core/translation/text';
import {applyTranslationsToSnapshot, buildWholeBlockTranslationSource, createTranslationSourceSnapshot} from '@/src/core/translation/serialization';

const result = parseSiteRulePack({version: 1, profiles: rawProfiles, rules: rawRules});
if (!result.ok) throw new Error(JSON.stringify(result.issues));
const pack = result.pack;
const adapters = compileSiteRulePack(pack);
const adapterById = new Map(adapters.map(adapter => [adapter.id, adapter]));
const rulesById = new Map(pack.rules.map(rule => [rule.id, rule]));

function documentFor(html: string): Document {
    return parseHTML(`<html><head></head><body>${html}</body></html>`).document as unknown as Document;
}

describe('网站正文规则目录', () => {
    it('Product Hunt 首页逐卡翻译介绍，保留产品名称、分类和订阅控件，重挂后仍命中介绍', () => {
        const adapter = adapterById.get('product-hunt')!;
        const url = new URL('https://www.producthunt.com/');
        expect(adapter.matches(url)).toBe(true);
        const html = `<div id="root-container"><header><input data-test="header-search-input" placeholder="Search"></header>
            <main><div data-test="homepage-section-today"><h1>Top Products Launching Today</h1>
            <section data-container="true"><div><span id="name-one"><a href="/products/first"><span id="link-overlay" data-target="true"></span>1. First Product</a></span>
            <span id="tagline-one">Build useful tools with your team. <code id="code">KEEP_CODE_LOCAL</code></span>
            <div><a id="topic" href="/topics/developer-tools">Developer Tools</a></div></div>
            <button data-test="vote-button">Upvote this product</button></section>
            <section data-container="true"><div><span id="name-two"><a href="/products/second">2. Second Product</a></span>
            <span id="tagline-two">Find clear answers from the documents you already own.</span></div></section>
            <section data-test="newsletter-banner"><p id="newsletter">Get the best launches in your inbox</p></section>
            </div><article><p id="fallback">An ordinary product discussion still has readable prose.</p></article></main>
            <footer><h3 id="footer-category">Engineering and Development</h3></footer>
            <div data-test="dismiss-CookiePopup"><div><span id="cookie-message">We use cookies to improve your experience.<a href="/legal#privacy">Learn more in our privacy settings.</a></span>
            <div><button>No thanks</button><button>Accept all cookies</button></div></div></div></div>`;
        const document = documentFor(html);
        const core = new TranslationCandidateCore({url, adapters: [adapter]});
        const verify = () => {
            const candidates = core.discover(document);
            for (const id of ['tagline-one', 'tagline-two', 'fallback']) {
                const owner = document.getElementById(id)!;
                expect(candidates.find(candidate => candidate.element === owner)?.adapterId, id).toBe('product-hunt');
                expect(core.resolve(owner.firstChild)?.element, id).toBe(owner);
            }
            for (const selector of ['#name-one', '#name-two', '#topic', '#newsletter', '#footer-category', '#cookie-message', 'button', 'input']) {
                const protectedNode = document.querySelector(selector)!;
                expect(core.resolve(protectedNode.firstChild ?? protectedNode), selector).toBeNull();
                expect(core.shouldStayOriginal(protectedNode), selector).toBe(true);
            }
            const source = candidates.map(candidate => extractTranslationText(candidate.element, core.shouldStayOriginal)).join('\n');
            expect(source).not.toContain('First Product');
            expect(source).not.toContain('Developer Tools');
            expect(source).not.toContain('Get the best launches');
            expect(source).not.toContain('KEEP_CODE_LOCAL');
            expect(source).not.toContain('We use cookies');
            expect(source).not.toContain('Learn more in our privacy settings');
            expect(adapter.shouldIgnoreMutation?.(document.getElementById('cookie-message')!, {url})).toBe(true);
            expect(core.shouldStayOriginal(document.getElementById('code')!)).toBe(true);
            // 卡片的透明整卡链接仍在最上层；坐标解析应找到下层介绍，不能把名称当正文。
            const tagline = document.getElementById('tagline-two')!;
            Object.defineProperty(document, 'elementsFromPoint', {configurable: true, value: () => [
                document.getElementById('link-overlay')!, document.getElementById('name-one')!, tagline,
            ]});
            expect(core.resolveAtPoint(document, 20, 30)?.element).toBe(tagline);
        };
        verify();
        document.body.innerHTML = html;
        verify();
        for (const path of ['/posts/first', '/products/first']) expect(adapter.matches(new URL(path, url))).toBe(true);
        expect(adapter.matches(new URL('https://help.producthunt.com/en/articles/481909'))).toBe(false);
    });

    it('ar5iv 定理中的可读叙述可形成候选，内联 MathML 保持受保护', () => {
        const url = new URL('https://ar5iv.labs.arxiv.org/html/2106.03753');
        const adapter = adapterById.get('ar5iv')!;
        const document = documentFor(`
            <article><div class="ltx_para"><p id="theorem" class="ltx_p">
            <span class="ltx_text ltx_font_italic">In single-hop beeping networks of size
            <math class="ltx_Math"><mi>n</mi></math>, there exists a deterministic algorithm
            that names distinct nodes in time slots.</span></p></div></article>
        `);
        const core = new TranslationCandidateCore({url, adapters: [adapter]});
        const candidate = core.discover(document).find(item => item.element.id === 'theorem');
        expect(candidate?.adapterId).toBe('ar5iv');
        expect(extractTranslationText(document.getElementById('theorem')!, core.shouldStayOriginal))
            .toContain('there exists a deterministic algorithm');
    });

    it('Wikipedia 多层章节内的段落也属于正文候选', () => {
        const url = new URL('https://en.wikipedia.org/wiki/United_States');
        const adapter = adapterById.get('wikipedia')!;
        const document = documentFor(`
            <main id="mw-content-text"><div class="mw-parser-output">
            <section><section><p id="nested">The later history section describes how
            <a href="/wiki/Example">national legislation</a> and <a href="/wiki/Another">court decisions</a>
            changed the country over several decades.<sup class="reference">[42]</sup></p>
            </section></section></div></main>
        `);
        const core = new TranslationCandidateCore({url, adapters: [adapter]});
        const candidates = core.discover(document);
        expect(candidates.find(candidate => candidate.element.id === 'nested')?.adapterId).toBe('wikipedia');
        expect(adapter.decide(document.getElementById('nested')!, {url})).toMatchObject({
            kind: 'force-target', atomic: true,
        });
    });

    it.each([
        ['Division', '/', '除法'],
        ['Logical NOT', '!a', '逻辑非'],
    ] as const)('Swift %s 的 p 持有可译标签，非原子 li 不吞并子段落，inline code 留在本地', (label, codeText, translated) => {
        const document = documentFor(`<main><ul><li id="item"><p id="operator">${label} (<code>${codeText}</code>)</p></li></ul></main>`);
        const url = new URL('https://docs.swift.org/latest/documentation/the-swift-programming-language/basicoperators/');
        const adapter = adapterById.get('swift-docs')!;
        const core = new TranslationCandidateCore({url, adapters: [adapter]});
        const paragraph = document.getElementById('operator') as HTMLElement;
        const item = document.getElementById('item')!;
        const code = paragraph.querySelector('code')!;
        const original = paragraph.innerHTML;
        expect(adapter.decide(paragraph, {url})).toMatchObject({kind: 'force-target', atomic: false});
        expect(adapter.decide(item, {url})).toMatchObject({kind: 'force-target', atomic: false});
        const candidates = core.discover(document);
        expect(candidates.filter(candidate => candidate.element === paragraph)).toHaveLength(1);
        expect(candidates.some(candidate => candidate.element === item)).toBe(false);
        expect(core.resolve(paragraph.firstChild)?.element).toBe(paragraph);
        expect(core.shouldStayOriginal(code)).toBe(true);
        expect(core.resolve(code.firstChild)?.element).toBe(paragraph);
        const snapshot = createTranslationSourceSnapshot(paragraph, core.shouldStayOriginal);
        expect(snapshot.slots.map(slot => slot.source)).toEqual([`${label} (`, ')']);
        expect(buildWholeBlockTranslationSource(snapshot)).toBeNull();
        const rendered = applyTranslationsToSnapshot(snapshot, [`${translated}（`, ')']);
        expect(rendered).toBe(`${translated}（<code>${codeText}</code>)`);
        expect(paragraph.innerHTML).toBe(original);
        expect(paragraph.querySelector('code')).toBe(code);
        expect(code.textContent).toBe(codeText);
    });

    it('整个目录满足统一 JSON 契约，使用有效选择器和可追踪的独立设计记录', () => {
        expect(pack.rules.length).toBeGreaterThanOrEqual(100);
        expect(validateSelectors(pack, documentFor('<main></main>'))).toEqual([]);
        expect(new Set(coverage.rules.map(rule => rule.id))).toEqual(new Set(pack.rules.map(rule => rule.id)));
        expect(new Set(coverage.rules.map(rule => rule.category))).toEqual(new Set([
            'documentation', 'news', 'encyclopedia', 'research', 'community', 'ai', 'commerce', 'mail',
        ]));
        expect(Object.keys(coverage.profiles).sort()).toEqual(Object.keys(pack.profiles ?? {}).sort());
        expect(coverage.rules.every(rule => typeof rule.liveVerification === 'string' && rule.liveVerification.length > 0)).toBe(true);
        expect(coverage.remainingCapabilities.map(item => item.capability)).toEqual(expect.arrayContaining([
            'captions', 'image-text', 'cross-origin-frames', 'virtualized-layout', 'closed-shadow-dom',
        ]));
        for (const rule of pack.rules) {
            const standalone = resolveSiteRule(pack, rule);
            expect(parseSiteRulePack({version: 1, rules: [standalone]}), rule.id).toMatchObject({ok: true});
            expect(standalone.content?.length, rule.id).toBeGreaterThan(0);
            expect(standalone.protect, rule.id).toEqual(expect.arrayContaining(['code', 'pre', 'input', 'textarea']));
            expect(standalone.exclude, rule.id).toContain('nav');
        }
    });

    it('每一个 focus 规则和每一种正文模板都有真实引擎消费的可重复夹具', () => {
        expect(new Set(fixtures.map(fixture => rulesById.get(fixture.id)?.profile).filter(Boolean)))
            .toEqual(new Set(Object.keys(pack.profiles ?? {})));
        const fixtureIds = new Set(fixtures.map(fixture => fixture.id));
        expect(fixtureIds.size).toBe(fixtures.length);
        expect(new Set(fixtures.map(fixture => new URL(fixture.url).hostname)).size).toBeGreaterThanOrEqual(20);
        for (const rule of pack.rules) {
            if (resolveSiteRule(pack, rule).mode === 'focus') expect(fixtureIds.has(rule.id), rule.id).toBe(true);
        }
    });

    it('公开页面验证清单的地址触发对应规则，正文定位使用标准 CSS', () => {
        expect(liveCases.length).toBeGreaterThanOrEqual(20);
        expect(new Set(liveCases.map(item => new URL(item.url).hostname)).size).toBe(liveCases.length);
        const document = documentFor('<main><p>Readable example</p></main>');
        for (const item of liveCases) {
            expect(adapterById.get(item.id)?.matches(new URL(item.url)), item.id).toBe(true);
            expect(() => document.querySelectorAll(item.selector), item.id).not.toThrow();
        }
    });

    it('pnpm 文档保留版本标记和移动目录控件，并继续逐段翻译正文', () => {
        const document = documentFor(`
            <main><article>
                <span id="version-badge" class="theme-doc-version-badge badge badge--secondary">Version: 12.x</span>
                <div class="theme-doc-toc-mobile">
                    <button id="mobile-toc-button" type="button">On this page</button>
                    <ul><li id="mobile-toc-entry"><a href="#installation">Installation instructions</a></li></ul>
                </div>
                <div class="theme-doc-markdown markdown">
                    <h1 id="installation">Installation</h1>
                    <p id="body-one">Install the package manager before opening a terminal to configure your project.</p>
                    <p id="body-two">This second paragraph explains how the installed command can be checked safely.</p>
                </div>
            </article></main>
        `);
        const adapter = adapterById.get('pnpm-docs')!;
        const url = new URL('https://pnpm.io/installation');
        expect(adapter.matches(url)).toBe(true);
        const core = new TranslationCandidateCore({url, adapters: [adapter]});
        const candidates = core.discover(document);
        for (const id of ['installation', 'body-one', 'body-two']) {
            const element = document.getElementById(id)!;
            expect(candidates.find(candidate => candidate.element === element)).toMatchObject({adapterId: 'pnpm-docs'});
            expect(core.resolve(element.firstChild)?.element).toBe(element);
        }
        for (const id of ['version-badge', 'mobile-toc-button', 'mobile-toc-entry']) {
            const element = document.getElementById(id)!;
            expect(core.resolve(element.firstChild), id).toBeNull();
            expect(candidates.some(candidate => candidate.element === element || element.contains(candidate.element)), id).toBe(false);
        }
        const source = extractTranslationText(document.querySelector('article')!, core.shouldStayOriginal);
        expect(source).not.toContain('Version:');
        expect(source).not.toContain('On this page');
        expect(source).not.toContain('Installation instructions');
    });

    it.each(pack.rules)('$id 的全部主机和路径按域名边界匹配，不接收相似或伪装主机', (rule) => {
        const adapter = adapterById.get(rule.id)!;
        for (const pattern of rule.match.hosts) {
            const baseHost = pattern.replace(/^\*\./u, '');
            const host = pattern.startsWith('*.') ? `reader.${baseHost}` : baseHost;
            for (const pathPattern of rule.match.paths ?? ['/article/fixture']) {
                const path = pathPattern.replaceAll('*', 'fixture');
                expect(adapter.matches(new URL(`https://${host}${path}`)), `${rule.id}: ${host}${path}`).toBe(true);
                expect(adapter.matches(new URL(`http://${host}${path}`))).toBe(true);
                expect(adapter.matches(new URL(`https://${host}${path}?next=/login#settings`))).toBe(true);
                expect(adapter.matches(new URL(`https://${baseHost}${path}`))).toBe(true);
                expect(adapter.matches(new URL(`https://${baseHost}.attacker.invalid${path}`))).toBe(false);
                expect(adapter.matches(new URL(`https://spoof-${baseHost}${path}`))).toBe(false);
                expect(adapter.matches(new URL(`https://${baseHost}@attacker.invalid${path}`))).toBe(false);
                expect(adapter.matches(new URL(`https://attacker.invalid${path}?host=${baseHost}`))).toBe(false);
                expect(adapter.matches(new URL(`ftp://${host}${path}`))).toBe(false);
                if (!pattern.startsWith('*.')) expect(adapter.matches(new URL(`https://reader.${host}${path}`))).toBe(false);
            }
            for (const excluded of rule.match.excludePaths ?? []) {
                expect(adapter.matches(new URL(`https://${host}${excluded.replaceAll('*', 'fixture')}`))).toBe(false);
            }
            // 不带末尾 / 的单段路径不匹配 Gist 的双段页面；空 wildcard 可合法匹配尾部 /。
            if (rule.match.paths) expect(adapter.matches(new URL(`https://${host}/__unrelated_route__`))).toBe(false);
        }
    });

    it.each(fixtures)('$id 通过专属适配器选择两段正文，保护控制与元数据，重挂载后边界一致', fixture => {
        const adapter = adapterById.get(fixture.id)!;
        const url = new URL(fixture.url);
        expect(adapter.matches(url), fixture.id).toBe(true);
        const document = documentFor(fixture.html);
        const core = new TranslationCandidateCore({url, adapters: [adapter]});

        const verify = (): string[] => {
            const candidates = core.discover(document);
            const messageContainer = document.querySelector('#message-container, [data-message-container]');
            if (messageContainer) {
                expect(candidates.some(candidate => candidate.element === messageContainer),
                    `${fixture.id}: paragraphs must not also produce one whole-message request`).toBe(false);
            }
            for (const selector of fixture.required) {
                const element = document.querySelector(selector)!;
                expect(element, `${fixture.id}: ${selector}`).not.toBeNull();
                const candidate = candidates.find(candidate => candidate.element === element);
                expect(candidate, `${fixture.id}: ${selector}`).toBeDefined();
                if (candidate?.reason === 'generic-inline-run') {
                    // 非原子容器直接首段沿用现有 inline-run 类型，由实时专站决策授权。
                    expect(adapter.decide(element, {url}), `${fixture.id}: ${selector}`)
                        .toMatchObject({kind: 'force-target', target: element, atomic: false});
                    expect(candidate.nodes?.length, `${fixture.id}: ${selector}`).toBeGreaterThan(0);
                } else expect(candidate?.adapterId, `${fixture.id}: ${selector}`).toBe(fixture.id);
                const walker = document.createTreeWalker(element, 4);
                let readable = walker.nextNode();
                while (readable && (!readable.textContent?.trim() ||
                    (readable.parentElement && core.shouldStayOriginal(readable.parentElement)))) readable = walker.nextNode();
                expect(readable, `${fixture.id}: readable ${selector}`).not.toBeNull();
                expect(core.resolve(readable)?.element, `${fixture.id}: hover ${selector}`).toBe(element);
            }
            for (const selector of fixture.forbidden) {
                const element = document.querySelector(selector)!;
                expect(element, `${fixture.id}: ${selector}`).not.toBeNull();
                expect(candidates.some(candidate => element === candidate.element || element.contains(candidate.element)),
                    `${fixture.id}: protected ${selector}`).toBe(false);
            }
            const source = candidates.map(candidate => extractTranslationTextFromNodes(
                candidate.nodes ?? [candidate.element], core.shouldStayOriginal)).join('\n');
            expect(source).not.toContain('KEEP_ORIGINAL_TOKEN');
            expect(source).not.toContain('FORMULA_TOKEN');
            expect(source).not.toContain('Navigation remains unchanged');
            expect(source).not.toContain('User metadata remains unchanged');
            expect(document.querySelector('#protected')?.textContent).toBe('KEEP_ORIGINAL_TOKEN');
            return candidates.map(candidate => candidate.element.id);
        };

        const originalIds = verify();
        document.body.innerHTML = fixture.html;
        expect(verify()).toEqual(originalIds);
    });

    it.each(['mdn', 'python-docs', 'huggingface', 'reuters', 'wikipedia', 'arxiv', 'discourse-meta', 'perplexity', 'etsy-shopping'])(
        '%s 区分页面框架和文章拥有的导语、结语及语义提示框', id => {
            const adapter = adapterById.get(id)!;
            const rule = rulesById.get(id)!;
            const host = rule.match.hosts[0]!.replace(/^\*\./u, '');
            const path = rule.match.paths?.[0]?.replaceAll('*', 'fixture') ?? '/article/fixture';
            const core = new TranslationCandidateCore({url: new URL(`https://${host}${path}`), adapters: [adapter]});
            const document = documentFor(`
                <main>
                    <header><h1 id="page-title">A readable document title</h1><p id="page-metadata">Page tools and update metadata</p></header>
                    <article class="document markdown-body cooked">
                        <header><h2 id="article-title">A readable article title</h2><p id="article-lead">This introductory paragraph belongs to the article and describes its subject clearly.</p></header>
                        <p id="body">The article body remains available for translation with ordinary prose and context.</p>
                        <aside><p id="article-aside">This article owns its explanatory sidebar, which is useful readable content.</p></aside>
                        <aside role="note"><p id="article-note">A semantic note inside the article remains part of the readable explanation.</p></aside>
                        <footer><p id="article-conclusion">This closing paragraph belongs to the article and supplies a readable conclusion.</p></footer>
                        <div role="toolbar"><p id="toolbar">Copy link and edit this page</p></div>
                    </article>
                    <aside><p id="page-aside">Related pages and navigation tools</p></aside>
                    <aside class="note"><p id="note-label">Note</p><p id="note-copy">A DocC style note belongs to the main document and keeps its descriptive text.</p></aside>
                    <footer><p id="page-footer">Page legal notices and global tools</p></footer>
                </main>
                <aside class="note"><p id="global-aside">A global sidebar is still outside the main document despite its note class.</p></aside>
            `);
            const candidates = core.discover(document);
            const selected = candidates.map(candidate => candidate.element.id);
            expect(selected).toEqual(expect.arrayContaining(['article-lead', 'body', 'article-aside', 'article-note', 'article-conclusion', 'note-label', 'note-copy']));
            for (const protectedId of ['page-metadata', 'page-aside', 'toolbar', 'page-footer', 'global-aside']) {
                expect(selected, `${id}: ${protectedId}`).not.toContain(protectedId);
                const element = document.getElementById(protectedId)!;
                expect(core.resolve(element.firstChild), `${id}: hover ${protectedId}`).toBeNull();
            }
        },
    );
});

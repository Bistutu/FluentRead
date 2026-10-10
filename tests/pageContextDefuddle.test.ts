import { afterEach, describe, expect, it, vi } from 'vitest';
import {parseHTML} from 'linkedom';
import {readFileSync} from 'node:fs';

const { parse, constructor } = vi.hoisted(() => ({
    parse: vi.fn(),
    constructor: vi.fn(),
}));

vi.mock('defuddle', () => ({
    default: class MockDefuddle {
        private readonly snapshot: unknown;
        private readonly options: unknown;

        constructor(...args: unknown[]) {
            this.snapshot = args[0];
            this.options = args[1];
            constructor(...args);
        }

        parse() {
            return parse(this.snapshot, this.options);
        }
    },
}));

import {getPageTranslationContext, resetPageTranslationContextCache} from '@/src/services/translation/context';

const originalDocument = globalThis.document;
const originalLocation = globalThis.location;
const originalWindow = globalThis.window;
const {document: markdownDocument} = parseHTML('<html><head></head><body></body></html>');
const createElement = markdownDocument.createElement.bind(markdownDocument);

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

function installFixturePage(name: string) {
    const html = readFileSync(new URL(`./fixtures/page-context/${name}.html`, import.meta.url), 'utf8');
    const {document: liveDocument} = parseHTML(html);
    const {document: snapshot} = parseHTML('<!doctype html><html><head></head><body></body></html>');
    Object.defineProperty(liveDocument, 'implementation', {
        configurable: true,
        value: {createHTMLDocument: () => snapshot},
    });
    Object.defineProperty(globalThis, 'document', {value: liveDocument, configurable: true});
    Object.defineProperty(globalThis, 'location', {
        value: {href: `https://example.com/page-context/${name}`},
        configurable: true,
    });
    return {liveDocument, snapshot, html};
}

function readMarkdownTable(markdown: string) {
    const table = markdown.match(/<table\b[\s\S]*?<\/table>/iu)?.[0];
    expect(table).toBeDefined();
    return parseHTML(`<html><body>${table}</body></html>`).document.querySelector('table')!;
}

const fixtureContracts: Array<{name: string; assert: (markdown: string) => void}> = [
    {name: 'headings', assert: (markdown) => {
        expect(markdown).toMatch(/^## Primary study heading$/mu);
        expect(markdown).toMatch(/^## Second level topic$/mu);
        expect(markdown).toMatch(/^### Third level detail$/mu);
    }},
    {name: 'lists', assert: (markdown) => {
        expect(markdown).toMatch(/^- The first unordered item/mu);
        expect(markdown).toMatch(/^- The second unordered item/mu);
        expect(markdown).toMatch(/^3\. +The third numbered item/mu);
        expect(markdown).toMatch(/^4\. +The fourth numbered item/mu);
    }},
    {name: 'nested-lists', assert: (markdown) => {
        expect(markdown).toMatch(/^3\. +The parent observation/mu);
        expect(markdown).toMatch(/^[ \t]{2,}- Its first supporting observation/mu);
        expect(markdown).toMatch(/^[ \t]{2,}- Its second supporting observation/mu);
        expect(markdown).toMatch(/^[ \t]{4,}7\. +The seventh detailed observation/mu);
        expect(markdown).toMatch(/^4\. +The next independent observation/mu);
    }},
    {name: 'quotes', assert: (markdown) => {
        expect(markdown).toMatch(/^> The fictional researcher/mu);
        expect(markdown).toMatch(/^> A second quoted paragraph/mu);
        expect(markdown).toMatch(/^> > A nested quotation/mu);
    }},
    {name: 'tables', assert: (markdown) => {
        expect(markdown).toContain('| Observation category | Explanation |');
        expect(markdown).toContain('| --- | --- |');
        expect(markdown).toContain('Lists \\| related notes');
        expect(markdown).toContain('A second cell paragraph supplies additional context.');
    }},
    {name: 'ragged-table', assert: (markdown) => {
        expect(markdown).toMatch(/^\| Category \| Observation \| +\|$/mu);
        expect(markdown).toContain('| --- | --- | --- |');
        expect(markdown).toContain('| First category | Second observation | Third column must remain readable |');
        expect(markdown).toMatch(/^\| A single available category \| +\| +\|$/mu);
    }},
    {name: 'merged-table', assert: (markdown) => {
        const table = readMarkdownTable(markdown);
        expect(table.querySelector('th')?.getAttribute('colspan')).toBe('2');
        expect(table.querySelector('td')?.getAttribute('rowspan')).toBe('2');
        expect(table.querySelectorAll('tr')).toHaveLength(4);
        expect(table.textContent).toContain('The second explanation refines the same category');
    }},
    {name: 'nested-layout-table', assert: (markdown) => {
        // Layout cells become separate paragraphs around the nested data table, in their reading order.
        expect(markdown).toContain('A layout introduction explains the relationship');
        expect(markdown).toContain('| Category | Explanation |');
        expect(markdown).toContain('A complete nested explanation remains related to its original category.');
        expect(markdown).toContain('A second layout cell supplies additional explanatory context');
        expect(markdown.indexOf('A layout introduction')).toBeLessThan(markdown.indexOf('| Category |'));
        expect(markdown.indexOf('| Category |')).toBeLessThan(markdown.indexOf('A second layout cell'));
    }},
    {name: 'single-column-table', assert: (markdown) => {
        expect(markdown).toMatch(/The first layout row[^\n]+\n\nThe second layout row/u);
    }},
    {name: 'inline-emphasis', assert: (markdown) => {
        expect(markdown).toContain('**strong observation with several words**');
        expect(markdown).toContain('*emphasized supporting phrase*');
        expect(markdown).toContain('~~withdrawn suggestion~~');
        expect(markdown).toContain('<sub>2</sub>');
        expect(markdown).toContain('<sup>2</sup>');
        expect(markdown).toContain('First meaningful line  \nSecond meaningful line');
        expect(markdown).toContain('\\*asterisks\\*');
        expect(markdown).toContain('\\_underscores\\_');
        expect(markdown).toContain('\\[square brackets\\]');
    }},
    {name: 'math-standard', assert: (markdown) => {
        expect(markdown).toContain('The equation is accompanied by this readable explanation.');
        expect(markdown).toContain('x^2 + 1');
        expect(markdown).not.toContain('<math');
    }},
    {name: 'math-katex-residual', assert: (markdown) => {
        expect(markdown).toContain('A typical KaTeX presentation contains');
        expect(markdown).toContain('x squared plus one');
        expect(markdown).not.toContain('data-latex');
    }},
    {name: 'math-mathjax-custom', assert: (markdown) => {
        expect(markdown).toContain('$x + 1$');
        expect(markdown).toContain('while the surrounding explanatory sentence remains readable.');
    }},
    {name: 'math-mathjax-structured', assert: (markdown) => {
        expect(markdown).toContain('$$\n\\frac{x}{2} + y^{3}\n$$');
        expect(markdown).toContain('x divided by two, plus y raised to the third power');
    }},
    {name: 'merged-table-math', assert: (markdown) => {
        const table = readMarkdownTable(markdown);
        expect(table.querySelector('td[rowspan="2"]')?.textContent).toContain('$\\frac{x}{2}$');
        expect(table.textContent).toContain('The same ratio is shared by the second explanation.');
    }},
    {name: 'merged-table-matrix', assert: (markdown) => {
        const table = readMarkdownTable(markdown);
        const formulaCell = table.querySelector('td[rowspan="2"]');
        expect(formulaCell).not.toBeNull();
        expect(formulaCell?.textContent).toContain('$\\begin{matrix}a & b \\\\ c & d\\end{matrix}$');
        expect(markdown).toContain('a &amp; b');
        expect(markdown).toContain('c &amp; d');
        expect(table.querySelectorAll('tr')).toHaveLength(3);
    }},
    {name: 'generated-callout', assert: (markdown) => {
        expect(markdown).toContain('> [!note] Note');
        expect(markdown).toMatch(/^> A supporting note explains/mu);
        expect(markdown).toMatch(/^> - A supporting note item/mu);
    }},
    {name: 'generated-footnote', assert: (markdown) => {
        expect(markdown).toContain('supporting note [^1]');
        expect(markdown).toMatch(/^\[\^1\]: The first supporting footnote/mu);
        expect(markdown).not.toContain('footnote-backref');
    }},
    {name: 'semantic-elements', assert: (markdown) => {
        expect(markdown).toContain('highlighted supporting observation');
        expect(markdown).toMatch(/<dl>.*<dt>A study term<\/dt>[\s\S]*?<dd>A meaningful definition/u);
        expect(markdown).toContain('<details><summary>Supplementary details</summary>');
        expect(markdown).toContain('A supplementary passage describes a complete observation');
    }},
    {name: 'mixed-language-and-sanitizer', assert: (markdown) => {
        expect(markdown).toMatch(/^## 混合语言的关系 Mixed relationships$/mu);
        expect(markdown).toContain('English phrases 与 **重点说明**');
        expect(markdown).toMatch(/^- 第一项说明观察过程/mu);
        expect(markdown).toContain('A visible educational link contributes only its visible words.');
        expect(markdown).not.toContain('SYNTHETIC-SECRET');
    }},
];

afterEach(() => {
    resetPageTranslationContextCache();
    parse.mockReset();
    constructor.mockReset();
    Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true });
    Object.defineProperty(globalThis, 'location', { value: originalLocation, configurable: true });
    Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
});

describe('Defuddle page snapshot adapter', () => {
    it.each(fixtureContracts)('真实 core 提取并保留 $name 的正文语义', async ({name, assert}) => {
        const {default: RealDefuddle} = await vi.importActual<typeof import('defuddle')>('defuddle');
        const {liveDocument, snapshot, html} = installFixturePage(name);
        parse.mockImplementation((documentSnapshot: Document, options: ConstructorParameters<typeof RealDefuddle>[1]) =>
            new RealDefuddle(documentSnapshot, options).parse());

        const context = await getPageTranslationContext();

        expect(parse).toHaveBeenCalledTimes(1);
        expect(constructor).toHaveBeenCalledWith(snapshot, {
            url: `https://example.com/page-context/${name}`,
            useAsync: false,
        });
        const markdown = context.split('Readable page content (Markdown):\n')[1];
        expect(markdown).toBeDefined();
        assert(markdown);
        // The real parser consumes the detached, sanitized snapshot without mutating the source page.
        expect(liveDocument.documentElement.outerHTML).toBe(parseHTML(html).document.documentElement.outerHTML);
        expect(context).not.toContain('SYNTHETIC-SECRET');
        if (name === 'mixed-language-and-sanitizer') {
            expect(snapshot.querySelector('form, [contenteditable], [hidden], script, pre')).toBeNull();
            expect(snapshot.querySelector('[href], [data-account], [data-private]')).toBeNull();
        }
    });

    it('在正常 Defuddle 路径移除表单、草稿、隐藏文本与敏感属性', async () => {
        const {document: liveDocument} = parseHTML(`<html><body>
          <article data-account="secret-data"><h1>Visible article</h1><a href="https://example.com/?token=secret-url" title="secret-title">Readable link</a></article>
          <form><input value="secret-input"><textarea>secret-textarea</textarea></form>
          <div contenteditable="true">secret-draft</div>
          <div hidden>secret-hidden</div><div aria-hidden="true">secret-aria</div>
        </body></html>`);
        const {document: detachedDocument} = parseHTML('<html><head></head><body></body></html>');
        Object.defineProperty(liveDocument, 'implementation', {
            configurable: true,
            value: {createHTMLDocument: () => detachedDocument},
        });
        Object.defineProperty(globalThis, 'location', {
            value: {href: 'https://example.com/private-form'},
            configurable: true,
        });
        Object.defineProperty(globalThis, 'document', {value: liveDocument, configurable: true});
        parse.mockImplementation((snapshot: Document) => ({
            content: snapshot.documentElement.innerHTML,
        }));

        const context = await getPageTranslationContext();

        expect(context).toContain('Visible article');
        expect(context).toContain('Readable link');
        for (const secret of ['secret-data', 'secret-url', 'secret-title', 'secret-input', 'secret-textarea', 'secret-draft', 'secret-hidden', 'secret-aria']) {
            expect(context).not.toContain(secret);
        }
        expect(detachedDocument.querySelector('form, input, textarea, [contenteditable], [hidden], [aria-hidden="true"]')).toBeNull();
        expect(detachedDocument.querySelector('article')?.hasAttribute('data-account')).toBe(false);
        expect(detachedDocument.querySelector('a')?.hasAttribute('href')).toBe(false);
        expect(detachedDocument.querySelector('a')?.hasAttribute('title')).toBe(false);
    });

    it('在 body clone fallback 路径执行同一敏感节点清洗', async () => {
        const {document: liveDocument} = parseHTML(`<html><body><main>
          <p>Fallback visible article</p>
          <form><input value="fallback-secret-input"><textarea>fallback-secret-text</textarea></form>
          <section style="display: none">fallback-secret-hidden</section>
        </main></body></html>`);
        Object.defineProperty(liveDocument, 'implementation', {configurable: true, value: undefined});
        Object.defineProperty(globalThis, 'location', {
            value: {href: 'https://example.com/fallback-private'},
            configurable: true,
        });
        Object.defineProperty(globalThis, 'document', {value: liveDocument, configurable: true});

        const context = await getPageTranslationContext();

        expect(context).toContain('Fallback visible article');
        expect(context).not.toContain('fallback-secret-input');
        expect(context).not.toContain('fallback-secret-text');
        expect(context).not.toContain('fallback-secret-hidden');
        expect(parse).not.toHaveBeenCalled();
    });

    it('uses an isolated full-document snapshot and caches metadata by URL', async () => {
        const snapshot = {
            documentElement: { innerHTML: '' },
            querySelectorAll: () => [],
            createElement,
        };
        parse.mockReturnValue({ content: '<h1>Readable article</h1><p>A useful paragraph.</p>' });

        Object.defineProperty(globalThis, 'location', {
            value: { href: 'https://example.com/article' },
            configurable: true,
        });
        Object.defineProperty(globalThis, 'document', {
            value: {
                title: 'Original article title',
                documentElement: { outerHTML: '<html><body><article>Article</article></body></html>' },
                implementation: { createHTMLDocument: vi.fn(() => snapshot) },
                body: { cloneNode: vi.fn() },
                querySelector: () => null,
            },
            configurable: true,
        });

        const first = await getPageTranslationContext();
        Object.defineProperty(globalThis.document, 'title', { value: 'Translated title', configurable: true });
        const second = await getPageTranslationContext();

        expect(first).toContain('Page title: Original article title');
        expect(first).toContain('Readable page content (Markdown):\n# Readable article');
        expect(second).toContain('Page title: Original article title');
        expect(constructor).toHaveBeenCalledTimes(1);
        expect(constructor).toHaveBeenCalledWith(snapshot, {
            url: 'https://example.com/article',
            useAsync: false,
        });
        expect(snapshot.documentElement.innerHTML).toContain('<html>');
    });

    it('coalesces concurrent full-page snapshot extraction for the same URL', async () => {
        const snapshot = {
            documentElement: { innerHTML: '' },
            querySelectorAll: () => [],
            createElement,
        };
        parse.mockReturnValue({ content: '<p>Shared readable article context.</p>' });
        Object.defineProperty(globalThis, 'location', {
            value: { href: 'https://example.com/concurrent' },
            configurable: true,
        });
        Object.defineProperty(globalThis, 'document', {
            value: {
                title: 'Concurrent article',
                documentElement: { outerHTML: '<html><body><article>Article</article></body></html>' },
                implementation: { createHTMLDocument: vi.fn(() => snapshot) },
                body: { cloneNode: vi.fn() },
                querySelector: () => null,
            },
            configurable: true,
        });

        const contexts = await Promise.all([
            getPageTranslationContext(),
            getPageTranslationContext(),
            getPageTranslationContext(),
        ]);

        expect(new Set(contexts).size).toBe(1);
        expect(constructor).toHaveBeenCalledTimes(1);
        expect(parse).toHaveBeenCalledTimes(1);
    });

    it('uses bounded text capture instead of synchronous Defuddle on a large page', async () => {
        const paragraphs = Array.from({length: 1_600}, (_, index) =>
            `<p>Readable paragraph ${index} with useful article context.</p>`).join('');
        const {document} = parseHTML(`<html><body><main>${paragraphs}</main></body></html>`);
        Object.defineProperty(globalThis, 'location', {
            value: {href: 'https://example.com/large'},
            configurable: true,
        });
        Object.defineProperty(globalThis, 'document', {value: document, configurable: true});

        const context = await getPageTranslationContext();

        expect(context).toContain('Readable paragraph 0 with useful article context.');
        expect(context.length).toBeLessThanOrEqual(4000);
        expect(constructor).not.toHaveBeenCalled();
        expect(parse).not.toHaveBeenCalled();
    });

    it.each([
        ['main root', '<main contenteditable="true"><p>private draft</p></main>'],
        ['excluded ancestor', '<form><main><p>private draft</p></main></form>'],
        ['hidden ancestor', '<div hidden><article><p>private draft</p></article></div>'],
        ['extension-owned root', '<main data-fr-translation-owned="true"><p>private draft</p></main>'],
    ])('does not capture a bounded article inside an excluded %s', async (_, markup) => {
        const {document} = parseHTML(`<html><body data-payload="${'x'.repeat(300_000)}">${markup}</body></html>`);
        Object.defineProperty(globalThis, 'location', {value: {href: 'https://example.com/excluded-root'}, configurable: true});
        Object.defineProperty(globalThis, 'document', {value: document, configurable: true});

        const context = await getPageTranslationContext();

        expect(context).not.toContain('private draft');
        expect(constructor).not.toHaveBeenCalled();
        expect(parse).not.toHaveBeenCalled();
    });

    it('does not serialize a small tree with an oversized attribute payload', async () => {
        const {document} = parseHTML(
            `<html><body><main data-payload="${'x'.repeat(300_000)}"><p>Bounded attribute page.</p></main></body></html>`,
        );
        Object.defineProperty(globalThis, 'location', {
            value: {href: 'https://example.com/large-attribute'},
            configurable: true,
        });
        Object.defineProperty(globalThis, 'document', {value: document, configurable: true});

        const context = await getPageTranslationContext();

        expect(context).toContain('Bounded attribute page.');
        expect(constructor).not.toHaveBeenCalled();
        expect(parse).not.toHaveBeenCalled();
    });

    it('keeps each SPA route on its detached snapshot and rejects stale ABA cache commits', async () => {
        const firstAResult = deferred<{content: string}>();
        const bResult = deferred<{content: string}>();
        const secondAResult = deferred<{content: string}>();
        const makeSnapshot = (result: Promise<{content: string}>) => ({
            documentElement: { innerHTML: '' },
            querySelectorAll: () => [],
            createElement,
            result,
        });
        const firstASnapshot = makeSnapshot(firstAResult.promise);
        const bSnapshot = makeSnapshot(bResult.promise);
        const secondASnapshot = makeSnapshot(secondAResult.promise);
        parse.mockImplementation((snapshot: {result: Promise<{content: string}>}) => snapshot.result);

        const installPage = (url: string, title: string, body: string, snapshot: ReturnType<typeof makeSnapshot>) => {
            Object.defineProperty(globalThis, 'location', {value: {href: url}, configurable: true});
            Object.defineProperty(globalThis, 'document', {
                value: {
                    title,
                    documentElement: {outerHTML: `<html><body>${body}</body></html>`},
                    implementation: {createHTMLDocument: vi.fn(() => snapshot)},
                    body: {cloneNode: vi.fn()},
                    querySelector: () => null,
                },
                configurable: true,
            });
        };

        installPage('https://example.com/a', 'A version 1', 'A1 body', firstASnapshot);
        const firstAContext = getPageTranslationContext();
        installPage('https://example.com/b', 'B route', 'B body', bSnapshot);
        const bContext = getPageTranslationContext();
        installPage('https://example.com/a', 'A version 2', 'A2 body', secondASnapshot);
        const secondAContext = getPageTranslationContext();

        await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(3));
        secondAResult.resolve({content: '<p>Second A readable context.</p>'});
        await expect(secondAContext).resolves.toContain('Page title: A version 2');
        firstAResult.resolve({content: '<p>Stale first A readable context.</p>'});
        bResult.resolve({content: '<p>B readable context.</p>'});

        await expect(firstAContext).resolves.toContain('Page title: A version 1');
        await expect(firstAContext).resolves.toContain('Stale first A readable context.');
        await expect(bContext).resolves.toContain('Page title: B route');
        await expect(bContext).resolves.toContain('B readable context.');

        const cachedCurrentA = await getPageTranslationContext();
        expect(cachedCurrentA).toContain('Page title: A version 2');
        expect(cachedCurrentA).toContain('Second A readable context.');
        expect(cachedCurrentA).not.toContain('Stale first A readable context.');
        expect(constructor).toHaveBeenCalledTimes(3);
    });

    it('route invalidation prevents an old A request from being reused after A-B-A without a B extraction', async () => {
        const oldAResult = deferred<{content: string}>();
        const newAResult = deferred<{content: string}>();
        const makeSnapshot = (result: Promise<{content: string}>) => ({
            documentElement: {innerHTML: ''},
            querySelectorAll: () => [],
            createElement,
            result,
        });
        const oldASnapshot = makeSnapshot(oldAResult.promise);
        const newASnapshot = makeSnapshot(newAResult.promise);
        parse.mockImplementation((snapshot: {result: Promise<{content: string}>}) => snapshot.result);
        const installPage = (url: string, title: string, snapshot: ReturnType<typeof makeSnapshot>) => {
            Object.defineProperty(globalThis, 'location', {value: {href: url}, configurable: true});
            Object.defineProperty(globalThis, 'document', {
                value: {
                    title,
                    documentElement: {outerHTML: `<html><body>${title}</body></html>`},
                    implementation: {createHTMLDocument: vi.fn(() => snapshot)},
                    body: {cloneNode: vi.fn()},
                    querySelector: () => null,
                },
                configurable: true,
            });
        };

        installPage('https://example.com/a', 'Old A', oldASnapshot);
        const oldAContext = getPageTranslationContext();
        installPage('https://example.com/b', 'B route without context', oldASnapshot);
        resetPageTranslationContextCache();
        installPage('https://example.com/a', 'New A', newASnapshot);
        const newAContext = getPageTranslationContext();

        await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(2));
        newAResult.resolve({content: '<p>New A context.</p>'});
        await expect(newAContext).resolves.toContain('New A context.');
        oldAResult.resolve({content: '<p>Old stale A context.</p>'});
        await expect(oldAContext).resolves.toContain('Old stale A context.');

        const cachedNewA = await getPageTranslationContext();
        expect(cachedNewA).toContain('Page title: New A');
        expect(cachedNewA).toContain('New A context.');
        expect(cachedNewA).not.toContain('Old stale A context.');
        expect(constructor).toHaveBeenCalledTimes(2);
    });
});

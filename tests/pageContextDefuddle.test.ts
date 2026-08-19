import { afterEach, describe, expect, it, vi } from 'vitest';
import {parseHTML} from 'linkedom';

const { parse, constructor } = vi.hoisted(() => ({
    parse: vi.fn(),
    constructor: vi.fn(),
}));

vi.mock('defuddle/full', () => ({
    default: class MockDefuddle {
        private readonly snapshot: unknown;

        constructor(...args: unknown[]) {
            this.snapshot = args[0];
            constructor(...args);
        }

        parse() {
            return parse(this.snapshot);
        }
    },
    createMarkdownContent: vi.fn(),
}));

import { getPageTranslationContext, resetPageTranslationContextCache } from '@/entrypoints/utils/pageContext';

const originalDocument = globalThis.document;
const originalLocation = globalThis.location;

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

afterEach(() => {
    resetPageTranslationContextCache();
    parse.mockReset();
    constructor.mockReset();
    Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true });
    Object.defineProperty(globalThis, 'location', { value: originalLocation, configurable: true });
});

describe('Defuddle page snapshot adapter', () => {
    it('uses an isolated full-document snapshot and caches metadata by URL', async () => {
        const snapshot = {
            documentElement: { innerHTML: '' },
            querySelectorAll: () => [],
        };
        parse.mockReturnValue({ contentMarkdown: '# Readable article\n\nA useful paragraph.' });

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
            separateMarkdown: true,
            url: 'https://example.com/article',
            useAsync: false,
        });
        expect(snapshot.documentElement.innerHTML).toContain('<html>');
    });

    it('coalesces concurrent full-page snapshot extraction for the same URL', async () => {
        const snapshot = {
            documentElement: { innerHTML: '' },
            querySelectorAll: () => [],
        };
        parse.mockReturnValue({ contentMarkdown: 'Shared readable article context.' });
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
        const firstAResult = deferred<{contentMarkdown: string}>();
        const bResult = deferred<{contentMarkdown: string}>();
        const secondAResult = deferred<{contentMarkdown: string}>();
        const makeSnapshot = (result: Promise<{contentMarkdown: string}>) => ({
            documentElement: { innerHTML: '' },
            querySelectorAll: () => [],
            result,
        });
        const firstASnapshot = makeSnapshot(firstAResult.promise);
        const bSnapshot = makeSnapshot(bResult.promise);
        const secondASnapshot = makeSnapshot(secondAResult.promise);
        parse.mockImplementation((snapshot: {result: Promise<{contentMarkdown: string}>}) => snapshot.result);

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
        secondAResult.resolve({contentMarkdown: 'Second A readable context.'});
        await expect(secondAContext).resolves.toContain('Page title: A version 2');
        firstAResult.resolve({contentMarkdown: 'Stale first A readable context.'});
        bResult.resolve({contentMarkdown: 'B readable context.'});

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
        const oldAResult = deferred<{contentMarkdown: string}>();
        const newAResult = deferred<{contentMarkdown: string}>();
        const makeSnapshot = (result: Promise<{contentMarkdown: string}>) => ({
            documentElement: {innerHTML: ''},
            querySelectorAll: () => [],
            result,
        });
        const oldASnapshot = makeSnapshot(oldAResult.promise);
        const newASnapshot = makeSnapshot(newAResult.promise);
        parse.mockImplementation((snapshot: {result: Promise<{contentMarkdown: string}>}) => snapshot.result);
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
        newAResult.resolve({contentMarkdown: 'New A context.'});
        await expect(newAContext).resolves.toContain('New A context.');
        oldAResult.resolve({contentMarkdown: 'Old stale A context.'});
        await expect(oldAContext).resolves.toContain('Old stale A context.');

        const cachedNewA = await getPageTranslationContext();
        expect(cachedNewA).toContain('Page title: New A');
        expect(cachedNewA).toContain('New A context.');
        expect(cachedNewA).not.toContain('Old stale A context.');
        expect(constructor).toHaveBeenCalledTimes(2);
    });
});

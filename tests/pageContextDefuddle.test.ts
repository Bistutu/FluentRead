import { afterEach, describe, expect, it, vi } from 'vitest';

const { parse, constructor } = vi.hoisted(() => ({
    parse: vi.fn(),
    constructor: vi.fn(),
}));

vi.mock('defuddle/full', () => ({
    default: class MockDefuddle {
        constructor(...args: unknown[]) {
            constructor(...args);
        }

        parse() {
            return parse();
        }
    },
    createMarkdownContent: vi.fn(),
}));

import { getPageTranslationContext, resetPageTranslationContextCache } from '@/entrypoints/utils/pageContext';

const originalDocument = globalThis.document;
const originalLocation = globalThis.location;

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
});

import {describe, expect, it} from 'vitest';
import {
    buildPageTranslationContext,
    getPageTranslationMaterialIdentity,
    normalizePageMarkdown,
    normalizePageText,
    pageContextLimits,
    shouldUseBoundedPageCapture,
} from '@/src/services/translation/context/policy';

describe('page translation context policy', () => {
    it.each([
        ['https://example.com/article', 'https://example.com/article'],
        ['https://example.com/article#contents', 'https://example.com/article'],
        ['https://example.com/article#', 'https://example.com/article'],
        ['https://example.com/article#%2Fcontents', 'https://example.com/article'],
        ['https://example.com/article#/chapter/2', 'https://example.com/article#/chapter/2'],
        ['https://example.com/article#!/chapter/2', 'https://example.com/article#!/chapter/2'],
        ['https://example.com/article?language=en#contents', 'https://example.com/article?language=en'],
        ['https://example.com/next?language=en', 'https://example.com/next?language=en'],
        ['not a URL#contents', 'not a URL'],
        ['/relative/path#contents', '/relative/path'],
        ['', ''],
        ['#contents', ''],
    ])('uses the expected material identity for %j', (href, identity) => {
        expect(getPageTranslationMaterialIdentity(href)).toBe(identity);
    });

    it('keeps route, query and path changes distinct from ordinary reading anchors', () => {
        const article = getPageTranslationMaterialIdentity('https://example.com/article');
        expect(getPageTranslationMaterialIdentity('https://example.com/article#contents')).toBe(article);
        for (const next of [
            'https://example.com/article#/next',
            'https://example.com/article#!/next',
            'https://example.com/article?next=true',
            'https://example.com/next',
        ]) expect(getPageTranslationMaterialIdentity(next)).not.toBe(article);
    });

    it('normalizes plain text and Markdown without erasing paragraph boundaries', () => {
        expect(normalizePageText('  A\n\tB\u3000 C  ')).toBe('A B C');
        expect(normalizePageMarkdown('  A\r\n\tB\r\n\r\n\r\n C  ')).toBe('A\n B\n\n C');
    });

    it('switches to bounded capture when any detached-DOM budget is exceeded', () => {
        const withinBudget = {
            elements: pageContextLimits.defuddleElements,
            textCharacters: pageContextLimits.defuddleText,
            markupCharacters: pageContextLimits.defuddleMarkup,
            visitedNodes: pageContextLimits.captureNodes,
        };
        expect(shouldUseBoundedPageCapture(withinBudget)).toBe(false);

        for (const key of Object.keys(withinBudget) as Array<keyof typeof withinBudget>) {
            expect(shouldUseBoundedPageCapture({
                ...withinBudget,
                [key]: withinBudget[key] + 1,
            })).toBe(true);
        }
    });

    it('builds a bounded reference block and normalizes untrusted metadata', () => {
        const context = buildPageTranslationContext({
            title: '  Article\n title ',
            description: ' Short\u3000description ',
            readableText: 'x'.repeat(pageContextLimits.content + 100),
        });

        expect(context).toContain('Page title: Article title');
        expect(context).toContain('Page description: Short description');
        expect(context).toContain(`Readable page content (Markdown):\n${'x'.repeat(pageContextLimits.content)}`);
        expect(context).not.toContain('x'.repeat(pageContextLimits.content + 1));
        expect(context.length).toBeLessThanOrEqual(pageContextLimits.total);
    });

    it('omits absent sections and enforces the final request budget', () => {
        expect(buildPageTranslationContext({})).toBe('');
        expect(buildPageTranslationContext({title: '', description: '', readableText: ''})).toBe('');

        const oversizedMetadata = buildPageTranslationContext({
            title: 't'.repeat(pageContextLimits.total),
            description: 'description',
            readableText: 'content',
        });
        expect(oversizedMetadata).toHaveLength(pageContextLimits.total);
        expect(oversizedMetadata.startsWith('Page title: ')).toBe(true);
    });
});

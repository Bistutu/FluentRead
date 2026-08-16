const PAGE_CONTEXT_LIMIT = 4000;
const PAGE_CONTEXT_WINDOW = 1400;

let cachedSnapshot: { url: string; text: string } | null = null;

function normalizeText(value: string): string {
    return value.replace(/[\s\u3000]+/g, ' ').trim();
}

function getReadablePageText(): string {
    if (typeof document === 'undefined') return '';

    const url = typeof location === 'undefined' ? '' : location.href;
    if (cachedSnapshot?.url === url) return cachedSnapshot.text;

    const clone = document.body?.cloneNode(true) as HTMLElement | undefined;
    if (!clone) return '';

    clone.querySelectorAll(
        'script, style, noscript, template, .fluent-read-bilingual-content, .fluent-read-loading, .fluent-read-retry-wrapper, [data-fr-temp-style]',
    ).forEach((node) => node.remove());

    const text = normalizeText(clone.innerText || clone.textContent || '');
    const snapshot = text.slice(0, PAGE_CONTEXT_LIMIT);
    cachedSnapshot = {url, text: snapshot};
    return snapshot;
}

/**
 * Build a bounded, clearly delimited reference context for LLM translation.
 * Page text is treated as untrusted reference material by the prompt template.
 */
export function getPageTranslationContext(origin = ''): string {
    if (typeof document === 'undefined') return '';

    const title = normalizeText(document.title || '');
    const description = normalizeText(
        document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
    );
    const pageText = getReadablePageText();
    const normalizedOrigin = normalizeText(origin);

    let excerpt = pageText;
    if (normalizedOrigin && pageText) {
        const originIndex = pageText.indexOf(normalizedOrigin);
        if (originIndex >= 0) {
            const start = Math.max(0, originIndex - PAGE_CONTEXT_WINDOW);
            const end = Math.min(pageText.length, originIndex + normalizedOrigin.length + PAGE_CONTEXT_WINDOW);
            excerpt = pageText.slice(start, end);
        }
    }

    const sections = [
        title && `Page title: ${title}`,
        description && `Page description: ${description}`,
        excerpt && `Relevant page content: ${excerpt}`,
    ].filter(Boolean);

    return sections.join('\n').slice(0, PAGE_CONTEXT_LIMIT);
}

export function resetPageTranslationContextCache(): void {
    cachedSnapshot = null;
}

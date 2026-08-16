const PAGE_CONTENT_LIMIT = 2000;
const PAGE_CONTEXT_LIMIT = 4000;

let cachedSnapshot: {url: string; text: string; title: string; description: string} | null = null;

function normalizeText(value: string): string {
    return value.replace(/[\s\u3000]+/g, ' ').trim();
}

function normalizeMarkdown(value: string): string {
    return value
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function currentUrl(): string {
    if (typeof window !== 'undefined' && window.location) return window.location.href;
    if (typeof location !== 'undefined') return location.href;
    return '';
}

function removeFluentReadNodes(root: ParentNode): void {
    root.querySelectorAll(
        'script, style, noscript, template, .fluent-read-bilingual-content, .fluent-read-loading, .fluent-read-retry-wrapper, [data-fr-temp-style]',
    ).forEach((node) => node.remove());
}

function createDefuddleSnapshotDocument(): Document | null {
    if (typeof document === 'undefined') return null;

    // A detached document prevents the parser from reading or mutating the
    // live page. This is the same isolation boundary used by Read Frog.
    if (document.implementation?.createHTMLDocument && document.documentElement?.outerHTML) {
        const snapshot = document.implementation.createHTMLDocument(document.title);
        snapshot.documentElement.innerHTML = document.documentElement.outerHTML;
        removeFluentReadNodes(snapshot);
        return snapshot;
    }

    return null;
}

async function extractReadablePageText(): Promise<string> {
    if (typeof document === 'undefined') return '';

    try {
        const {default: Defuddle, createMarkdownContent} = await import('defuddle/full');
        const snapshot = createDefuddleSnapshotDocument();

        if (snapshot) {
            const result = new Defuddle(snapshot, {
                separateMarkdown: true,
                url: currentUrl(),
                useAsync: false,
            }).parse();

            if (result.contentMarkdown) return normalizeMarkdown(result.contentMarkdown);
            if (result.content && createMarkdownContent) {
                return normalizeMarkdown(createMarkdownContent(result.content, currentUrl()));
            }
        }
    } catch (error) {
        // Content extraction is an enhancement. A parser/runtime failure must
        // never prevent the normal translation request from being sent.
        console.warn('[FluentRead] readable page extraction failed; using body text:', error);
    }

    const clone = document.body?.cloneNode(true) as HTMLElement | undefined;
    if (!clone) return '';
    removeFluentReadNodes(clone);
    return normalizeText(clone.innerText || clone.textContent || '');
}

async function getReadablePageText(): Promise<string> {
    if (typeof document === 'undefined') return '';

    const url = currentUrl();
    if (cachedSnapshot?.url === url) return cachedSnapshot.text;

    const text = (await extractReadablePageText()).slice(0, PAGE_CONTENT_LIMIT);
    cachedSnapshot = {
        url,
        text,
        // Cache metadata together with body content. The extension may
        // translate document.title later in the same run; Read Frog keeps the
        // original page metadata stable for all subsequent paragraphs.
        title: normalizeText(document.title || ''),
        description: getDocumentDescription(),
    };
    return text;
}

function getDocumentDescription(): string {
    if (typeof document === 'undefined') return '';

    for (const selector of [
        'meta[name="description"]',
        'meta[property="og:description"]',
        'meta[name="twitter:description"]',
    ]) {
        const value = normalizeText(document.querySelector(selector)?.getAttribute('content') || '');
        if (value) return value;
    }
    return '';
}

/**
 * Extract a bounded page-level reference context for an LLM translation.
 * The returned material is reference data only; template.ts adds the prompt
 * boundary and the instruction not to follow text found inside the page.
 */
export async function getPageTranslationContext(): Promise<string> {
    if (typeof document === 'undefined') return '';

    await getReadablePageText();
    const title = cachedSnapshot?.title || '';
    const description = cachedSnapshot?.description || '';
    const pageContent = cachedSnapshot?.text || '';

    const sections = [
        title && `Page title: ${title}`,
        description && `Page description: ${description}`,
        pageContent && `Readable page content (Markdown):\n${pageContent}`,
    ].filter(Boolean);

    return sections.join('\n').slice(0, PAGE_CONTEXT_LIMIT);
}

export function resetPageTranslationContextCache(): void {
    cachedSnapshot = null;
}

export const pageContextLimits = {
    content: PAGE_CONTENT_LIMIT,
    total: PAGE_CONTEXT_LIMIT,
};

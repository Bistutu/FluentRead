const PAGE_CONTENT_LIMIT = 2000;
const PAGE_CONTEXT_LIMIT = 4000;
const DEFUDDLE_ELEMENT_BUDGET = 1500;
const DEFUDDLE_TEXT_BUDGET = 100_000;
const DEFUDDLE_MARKUP_BUDGET = 250_000;
const BOUNDED_CAPTURE_NODE_BUDGET = 8192;
const BOUNDED_CAPTURE_CHARACTER_BUDGET = PAGE_CONTENT_LIMIT * 3;

interface PageTranslationSnapshot {
    url: string;
    text: string;
    title: string;
    description: string;
}

interface CapturedReadablePage {
    url: string;
    documentSnapshot: Document | null;
    bodySnapshot: HTMLElement | null;
    boundedText: string | null;
}

interface PendingPageTranslationSnapshot {
    url: string;
    token: object;
    promise: Promise<PageTranslationSnapshot>;
}

let cachedSnapshot: PageTranslationSnapshot | null = null;
let pendingSnapshot: PendingPageTranslationSnapshot | null = null;
let snapshotGeneration = 0;
let defuddleModulePromise: Promise<typeof import('defuddle/full')> | null = null;

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

function nodeFilterConstants(doc: Document) {
    const constants = doc.defaultView?.NodeFilter;
    return {
        showElement: constants?.SHOW_ELEMENT ?? 1,
        showText: constants?.SHOW_TEXT ?? 4,
        accept: constants?.FILTER_ACCEPT ?? 1,
        reject: constants?.FILTER_REJECT ?? 2,
    };
}

function exceedsDefuddleBudget(doc: Document): boolean {
    if (!doc.documentElement || typeof doc.createTreeWalker !== 'function') return false;
    const {showElement, showText} = nodeFilterConstants(doc);
    const walker = doc.createTreeWalker(doc.documentElement, showElement | showText);
    let elements = 0;
    let characters = 0;
    let markupCharacters = 0;
    let visited = 0;
    let current: Node | null = doc.documentElement;
    while (current) {
        visited += 1;
        if (current.nodeType === 1) {
            elements += 1;
            const attributes = (current as Element).attributes;
            for (let index = 0; index < attributes.length; index += 1) {
                const attribute = attributes.item(index);
                if (attribute) markupCharacters += attribute.name.length + attribute.value.length;
            }
        }
        else if (current.nodeType === 3) characters += current.nodeValue?.length ?? 0;
        if (elements > DEFUDDLE_ELEMENT_BUDGET ||
            characters > DEFUDDLE_TEXT_BUDGET ||
            markupCharacters > DEFUDDLE_MARKUP_BUDGET ||
            visited > BOUNDED_CAPTURE_NODE_BUDGET) return true;
        current = walker.nextNode();
    }
    return false;
}

function collectBoundedReadableText(doc: Document): string {
    const root = doc.querySelector?.('main, article, [role="main"]') || doc.body || doc.documentElement;
    if (!root) return '';
    if (typeof doc.createTreeWalker !== 'function') {
        return normalizeText(root.textContent || '').slice(0, BOUNDED_CAPTURE_CHARACTER_BUDGET);
    }

    const {showElement, showText, accept, reject} = nodeFilterConstants(doc);
    const excluded = [
        'script', 'style', 'noscript', 'template', 'svg', 'math', 'pre', 'code',
        'nav', 'aside', 'footer', 'form', 'button', 'input', 'textarea', 'select',
        '[hidden]', '[inert]', '[aria-hidden="true"]', '[contenteditable="true"]',
        '[translate="no"]', '[data-notranslate]',
        '.fluent-read-bilingual-content', '.fluent-read-loading', '.fluent-read-retry-wrapper',
        '[data-fr-translation-owned="true"]',
    ].join(',');
    const walker = doc.createTreeWalker(root, showElement | showText, {
        acceptNode: (node) => {
            if (node.nodeType !== 1) return accept;
            try {
                return (node as Element).matches(excluded) ? reject : accept;
            } catch {
                return accept;
            }
        },
    });
    const parts: string[] = [];
    let visited = 0;
    let characters = 0;
    let current = walker.nextNode();
    while (current && visited < BOUNDED_CAPTURE_NODE_BUDGET && characters < BOUNDED_CAPTURE_CHARACTER_BUDGET) {
        visited += 1;
        if (current.nodeType === 3) {
            const value = current.nodeValue || '';
            if (value.trim()) {
                const remaining = BOUNDED_CAPTURE_CHARACTER_BUDGET - characters;
                parts.push(value.slice(0, remaining));
                characters += Math.min(value.length, remaining);
            }
        }
        current = walker.nextNode();
    }
    return normalizeText(parts.join(' '));
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

function captureReadablePage(): CapturedReadablePage {
    const url = currentUrl();
    if (exceedsDefuddleBudget(document)) {
        return {
            url,
            documentSnapshot: null,
            bodySnapshot: null,
            boundedText: collectBoundedReadableText(document),
        };
    }
    let documentSnapshot: Document | null = null;
    try {
        documentSnapshot = createDefuddleSnapshotDocument();
    } catch (error) {
        console.warn('[FluentRead] failed to capture detached document snapshot:', error);
    }

    let bodySnapshot: HTMLElement | null = null;
    if (!documentSnapshot) {
        try {
            bodySnapshot = document.body?.cloneNode(true) as HTMLElement | null;
            if (bodySnapshot) removeFluentReadNodes(bodySnapshot);
        } catch (error) {
            console.warn('[FluentRead] failed to capture detached body snapshot:', error);
        }
    }
    return {url, documentSnapshot, bodySnapshot, boundedText: null};
}

function loadDefuddleModule(): Promise<typeof import('defuddle/full')> {
    if (defuddleModulePromise) return defuddleModulePromise;
    const pending = import('defuddle/full');
    const wrapped = pending.catch((error) => {
        if (defuddleModulePromise === wrapped) defuddleModulePromise = null;
        throw error;
    });
    defuddleModulePromise = wrapped;
    return defuddleModulePromise;
}

async function extractReadablePageText(source: CapturedReadablePage): Promise<string> {
    if (source.boundedText !== null) return source.boundedText;
    try {
        const {default: Defuddle, createMarkdownContent} = await loadDefuddleModule();
        const snapshot = source.documentSnapshot;

        if (snapshot) {
            const result = await Promise.resolve(new Defuddle(snapshot, {
                separateMarkdown: true,
                url: source.url,
                useAsync: false,
            }).parse());

            if (result.contentMarkdown) return normalizeMarkdown(result.contentMarkdown);
            if (result.content && createMarkdownContent) {
                return normalizeMarkdown(createMarkdownContent(result.content, source.url));
            }
        }
    } catch (error) {
        // Content extraction is an enhancement. A parser/runtime failure must
        // never prevent the normal translation request from being sent.
        console.warn('[FluentRead] readable page extraction failed; using body text:', error);
    }

    const fallback = source.documentSnapshot?.body || source.bodySnapshot;
    return normalizeText(fallback?.innerText || fallback?.textContent || '');
}

async function getReadablePageSnapshot(): Promise<PageTranslationSnapshot | null> {
    if (typeof document === 'undefined') return null;

    const url = currentUrl();
    if (cachedSnapshot?.url === url) return cachedSnapshot;
    if (pendingSnapshot?.url === url) return pendingSnapshot.promise;

    const generation = snapshotGeneration;
    const token = {};
    const title = normalizeText(document.title || '');
    const description = getDocumentDescription();
    // Capture the detached source before the first await. A SPA navigation
    // during the dynamic Defuddle import can no longer mix an old title with a
    // new route's body.
    const source = captureReadablePage();
    const promise = extractReadablePageText(source).then((readableText): PageTranslationSnapshot => {
        const text = readableText.slice(0, PAGE_CONTENT_LIMIT);
        const snapshot = {url, text, title, description};
        if (snapshotGeneration === generation &&
            currentUrl() === url &&
            pendingSnapshot?.token === token) {
            cachedSnapshot = snapshot;
        }
        return snapshot;
    });
    const pending = {url, token, promise};
    pendingSnapshot = pending;
    try {
        return await promise;
    } finally {
        if (pendingSnapshot === pending) pendingSnapshot = null;
    }
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

    const snapshot = await getReadablePageSnapshot();
    const title = snapshot?.title || '';
    const description = snapshot?.description || '';
    const pageContent = snapshot?.text || '';

    const sections = [
        title && `Page title: ${title}`,
        description && `Page description: ${description}`,
        pageContent && `Readable page content (Markdown):\n${pageContent}`,
    ].filter(Boolean);

    return sections.join('\n').slice(0, PAGE_CONTEXT_LIMIT);
}

export function resetPageTranslationContextCache(): void {
    snapshotGeneration += 1;
    cachedSnapshot = null;
    pendingSnapshot = null;
}

export const pageContextLimits = {
    content: PAGE_CONTENT_LIMIT,
    total: PAGE_CONTEXT_LIMIT,
    defuddleElements: DEFUDDLE_ELEMENT_BUDGET,
};

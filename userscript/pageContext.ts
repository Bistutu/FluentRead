/**
 * @file userscript/pageContext.ts
 * 文件职责：为 AI 翻译提供有长度上限的页面参考文本，不读取输入框和编辑器内容。
 * 主要内容：采集标题、描述与正文普通文本，跳过隐藏、导航、代码和 FluentRead 自有节点；按 URL 缓存。
 * 模块边界：只返回模型上下文，不改变宿主 DOM；扩展仍使用完整的 Defuddle 页面提取器。
 */
import {buildPageTranslationContext, normalizePageText, pageContextLimits} from '@/src/services/translation/context/policy';
import {resetPageDiscourseContext} from '@/src/services/translation/context/pageDiscourse';

interface PageSnapshot {
    url: string;
    title: string;
    description: string;
    text: string;
}

const excludedSelector = [
    'script', 'style', 'noscript', 'template', 'svg', 'math', 'pre', 'code',
    'nav', 'aside', 'footer', 'form', 'button', 'input', 'textarea', 'select', 'option',
    '[hidden]', '[inert]', '[aria-hidden="true"]',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]', '[role="searchbox"]', '[role="combobox"]',
    '[style*="display: none" i]', '[style*="visibility: hidden" i]',
    '[translate="no"]', '[data-notranslate]',
    '.fluent-read-bilingual-content', '.fluent-read-loading', '.fluent-read-retry-wrapper',
    '[data-fr-translation-owned="true"]', '[data-fr-temp-style]',
    '[data-fluent-read-userscript-host]',
].join(',');

let cached: PageSnapshot | null = null;

function description(): string {
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
        const value = normalizePageText(document.querySelector(selector)?.getAttribute('content') || '');
        if (value) return value;
    }
    return '';
}

function readableText(): string {
    const root = [...document.querySelectorAll('main, article, [role="main"]')]
        .find((element) => !element.closest(excludedSelector))
        || document.body || document.documentElement;
    // TreeWalker 不对 root 调用 acceptNode；回退到 body/html 时也须保留排除策略。
    if (!root || root.closest(excludedSelector)) return '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
            return (node as Element).matches(excludedSelector)
                ? NodeFilter.FILTER_REJECT
                : NodeFilter.FILTER_ACCEPT;
        },
    });
    const parts: string[] = [];
    let visited = 0;
    let length = 0;
    let node: Node | null;
    while ((node = walker.nextNode()) && visited < pageContextLimits.captureNodes && length < pageContextLimits.captureCharacters) {
        visited += 1;
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const value = node.nodeValue || '';
        if (!value.trim()) continue;
        const clipped = value.slice(0, pageContextLimits.captureCharacters - length);
        parts.push(clipped);
        length += clipped.length;
    }
    return normalizePageText(parts.join(' '));
}

export async function getPageTranslationContext(): Promise<string> {
    if (typeof document === 'undefined') return '';
    const url = location.href;
    if (!cached || cached.url !== url) {
        cached = {
            url,
            title: normalizePageText(document.title || ''),
            description: description(),
            text: readableText().slice(0, pageContextLimits.content),
        };
    }
    return buildPageTranslationContext({
        title: cached.title,
        description: cached.description,
        readableText: cached.text,
    });
}

export function resetPageTranslationContextCache(): void {
    resetPageDiscourseContext();
    invalidatePageTranslationSnapshotCache();
}

export function invalidatePageTranslationSnapshotCache(): void {
    cached = null;
}

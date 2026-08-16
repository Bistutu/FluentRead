import { getMainDomain, selectCompatFn } from "@/entrypoints/main/compat";

// 语义块标签只用于识别候选内容块；真正的块级判断还会结合 computed style。
const directSet = new Set([
    'address', 'article', 'blockquote', 'dd', 'div', 'dt', 'figcaption',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'main', 'p', 'section',
    'td', 'th',
]);

// 这些元素及其子树不能成为网页正文翻译目标。
const skipSet = new Set([
    'html', 'head', 'body', 'script', 'style', 'noscript', 'iframe',
    'input', 'textarea', 'select', 'option', 'code', 'pre', 'kbd', 'samp',
    'var', 'math', 'svg', 'canvas', 'audio', 'video', 'object', 'template',
]);

const structuralIgnoreSet = new Set(['header', 'footer', 'nav', 'aside']);
const controlSet = new Set(['button']);

// 内联元素集合（可以包含在其他元素内的元素）
const inlineSet = new Set([
    'a', 'b', 'strong', 'span', 'em', 'i', 'u', 'small', 'sub', 'sup',
    'font', 'mark', 'cite', 'q', 'abbr', 'time', 'ruby', 'bdi', 'bdo',
    'code', 'kbd', 'samp', 'var', 'img', 'br', 'wbr', 'svg'
]);

const inlineDisplays = new Set([
    'inline',
    'inline-block',
    'inline-flex',
    'inline-grid',
    'contents',
    'ruby',
    'ruby-base',
    'ruby-text',
    'ruby-base-container',
    'ruby-text-container',
]);

const semanticBlockTags = new Set([
    'address', 'article', 'blockquote', 'dd', 'div', 'dt', 'figcaption',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'main', 'p', 'section',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'ol',
]);

const extensionSelector = [
    '#fluent-read-floating-ball-container',
    '#fluent-read-selection-translator-container',
    '[class*="fluent-read-loading"]',
    '[class*="fluent-read-retry"]',
    '.fluent-read-bilingual-content',
    '[data-fr-translation-owned="true"]',
].join(',');

/**
 * 判断节点是否是插件自己的浮层或过程节点。
 * 这些节点不应成为网页正文翻译目标，也不应被递归扫描。
 */
function isExtensionElement(node: Element): boolean {
    return Boolean(node.matches(extensionSelector) || node.closest(extensionSelector));
}

/**
 * 收集 root 下所有开放的 ShadowRoot。
 * 浏览器无法从 content script 读取 closed shadow root，因此这里只处理可公开访问的根。
 */
function getImmediateOpenShadowRoots(rootNode: Node): ShadowRoot[] {
    const roots: ShadowRoot[] = [];
    const collect = (element: Element) => {
        if (element.shadowRoot) {
            roots.push(element.shadowRoot);
        }
    };

    if (rootNode instanceof Element) collect(rootNode);

    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT);
    let currentNode = walker.nextNode();
    while (currentNode) {
        if (currentNode instanceof Element) collect(currentNode);
        currentNode = walker.nextNode();
    }

    return roots;
}

export function getOpenShadowRoots(rootNode: Node): ShadowRoot[] {
    const roots: ShadowRoot[] = [];
    const seen = new Set<ShadowRoot>();
    const pending: Node[] = [rootNode];
    let pendingIndex = 0;

    while (pendingIndex < pending.length) {
        const currentRoot = pending[pendingIndex++];
        if (!currentRoot) continue;

        for (const shadowRoot of getImmediateOpenShadowRoots(currentRoot)) {
            if (seen.has(shadowRoot)) continue;
            seen.add(shadowRoot);
            roots.push(shadowRoot);
            pending.push(shadowRoot);
        }
    }

    return roots;
}

function safeTextContent(node: Element): string {
    // 翻译结果 wrapper 是插件自己的内容，不能重新参与识别。
    const clone = node.cloneNode(true) as Element;
    clone.querySelectorAll(extensionSelector).forEach((child) => child.remove());
    return clone.textContent?.replace(/[\s\u3000]+/g, ' ').trim() || '';
}

function hasReadableText(node: Element): boolean {
    const text = safeTextContent(node);
    if (!text || isMainlyNumericContent(node)) return false;
    return text.length > 1;
}

function hasReadableBlockChild(node: Element): boolean {
    return Array.from(node.children).some((child) => {
        if (isExtensionElement(child)) return false;
        if (isControlElement(child)) return true;
        return isBlockLayout(child) && hasReadableText(child);
    });
}

function isHiddenElement(node: Element): boolean {
    const element = node as HTMLElement;
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;
    if (element.classList.contains('sr-only') || element.classList.contains('visually-hidden')) {
        return true;
    }
    try {
        const style = getComputedStyle(element);
        return style.display === 'none' || style.visibility === 'hidden';
    } catch {
        return false;
    }
}

function isNoTranslateElement(node: Element): boolean {
    return Boolean(
        node.classList.contains('notranslate') ||
        node.getAttribute('translate') === 'no' ||
        node.getAttribute('data-notranslate') === 'true',
    );
}

function isControlElement(node: Element): boolean {
    const tag = node.tagName.toLowerCase();
    return controlSet.has(tag) || node.getAttribute('role') === 'button';
}

function isBlockLayout(node: Element): boolean {
    const tag = node.tagName.toLowerCase();
    if (inlineSet.has(tag)) return false;
    if (semanticBlockTags.has(tag) || directSet.has(tag)) return true;

    try {
        const display = getComputedStyle(node).display.trim().toLowerCase();
        if (!display || display === 'contents') return false;
        return !inlineDisplays.has(display) && !display.startsWith('inline');
    } catch {
        return false;
    }
}

function isStructuralIgnoreElement(node: Element): boolean {
    return structuralIgnoreSet.has(node.tagName.toLowerCase());
}

function hasStructuralIgnoreAncestor(node: Element): boolean {
    let ancestor = node.parentElement;
    while (ancestor && !isDocumentSurface(ancestor)) {
        if (isStructuralIgnoreElement(ancestor)) return true;
        ancestor = ancestor.parentElement;
    }
    return false;
}

/**
 * 判断一个元素是否可以作为一个完整内容块。
 * 关键约束是：有可翻译块子节点时，父节点不再成为候选，避免全文翻译把
 * 一个 article/div 和其中所有 p 重复翻译；没有块子节点时则保留内部的
 * a、strong、code 外的行内结构，保证一句话不会被拆成多个请求。
 */
export function isTranslationContentBlock(node: Element): boolean {
    if (!node || isDocumentSurface(node) || isExtensionElement(node)) return false;
    if (isStructuralIgnoreElement(node) || skipSet.has(node.tagName.toLowerCase())) return false;
    // 结构容器中的普通文案仍然不属于正文候选；控件会在扫描器的独立分支中处理。
    if (hasStructuralIgnoreAncestor(node)) return false;
    if (isHiddenElement(node) || isNoTranslateElement(node) || isControlElement(node)) return false;
    if (!isBlockLayout(node) || !hasReadableText(node)) return false;
    if (hasReadableBlockChild(node)) return false;
    return true;
}

export function isTranslationControl(node: Element): boolean {
    if (!node || isExtensionElement(node) || isHiddenElement(node) || isNoTranslateElement(node)) {
        return false;
    }
    if (!isControlElement(node)) return false;
    const text = safeTextContent(node);
    return text.length > 1 && !isMainlyNumericContent(node);
}

function walkTranslationBlocks(
    rootNode: Node,
    result: Element[],
    visitedRoots: Set<ShadowRoot>,
): void {
    const visit = (node: Element) => {
        if (isExtensionElement(node) || isHiddenElement(node) || isNoTranslateElement(node)) return;
        const tag = node.tagName.toLowerCase();
        // html/body 是全文扫描的容器，不能因为它们属于 skipSet 就提前截断正文子树。
        // 其他 skip 元素仍然连同后代一起跳过，避免把脚本、代码块等内部文字送去翻译。
        if (skipSet.has(tag) && !isDocumentSurface(node)) return;

        // 控件必须先进入统一 control 分支。站点兼容规则不能把 button/role=button
        // 提前截断，否则双语模式会错误地保留英文按钮，也无法复用按钮恢复逻辑。
        if (isTranslationControl(node)) {
            result.push(node);
            return;
        }

        // header/footer/nav/aside 仍然是正文扫描的结构边界，但不能阻止继续遍历，
        // 因为按钮和 role=button 控件可能嵌套在这些容器中。普通文案由
        // isTranslationContentBlock 的结构祖先判断继续过滤，避免把导航标题送去翻译。
        const insideStructuralContainer = isStructuralIgnoreElement(node) || hasStructuralIgnoreAncestor(node);

        // 站点兼容规则负责正文容器和站点特有的噪声过滤；例如 X 的推文正文
        // 位于 article 内的 div[dir="auto"]，而用户名/操作图标可以整棵跳过。
        if (!insideStructuralContainer) {
            const compatNode = getCompatNode(node);
            if (compatNode === 'skip') return;
            if (compatNode instanceof Element && compatNode === node && hasReadableText(node)) {
                result.push(node);
                return;
            }
            if (isTranslationContentBlock(node)) {
                result.push(node);
                return;
            }
        }

        for (const child of Array.from(node.children)) visit(child);
        if (node.shadowRoot && !visitedRoots.has(node.shadowRoot)) {
            visitedRoots.add(node.shadowRoot);
            walkTranslationBlocks(node.shadowRoot, result, visitedRoots);
        }
    };

    if (rootNode instanceof Element) {
        visit(rootNode);
    } else {
        const children = "children" in rootNode
            ? Array.from((rootNode as Document | ShadowRoot).children)
            : [];
        for (const child of children) visit(child);
    }
}

/**
 * 统一的全文/悬浮翻译候选扫描。返回的是最小可读内容块，而不是每个叶子
 * 文本节点；因此全文翻译和鼠标悬浮会使用同一套边界。
 */
export function grabAllNode(rootNode: Node): Element[] {
    if (!rootNode) return [];
    const result: Element[] = [];
    const visitedRoots = new Set<ShadowRoot>();
    walkTranslationBlocks(rootNode, result, visitedRoots);
    for (const shadowRoot of getOpenShadowRoots(rootNode)) {
        if (visitedRoots.has(shadowRoot)) continue;
        visitedRoots.add(shadowRoot);
        walkTranslationBlocks(shadowRoot, result, visitedRoots);
    }
    return Array.from(new Set(result));
}

function isDocumentSurface(node: Element): boolean {
    return node === document.documentElement || node === document.body;
}

function getCompatNode(node: Element): Element | 'skip' | false {
    if (typeof location === 'undefined') return false;

    const domainHandler = selectCompatFn[getMainDomain(location.href.split('?')[0])];
    if (!domainHandler) return false;

    const result = domainHandler(node);
    if (result && typeof result === 'object' && 'skip' in result && result.skip === true) {
        return 'skip';
    }

    return result instanceof Element ? result : false;
}

/**
 * 从鼠标命中的元素向上归一为统一内容块。
 * 这里不发送请求、不插入 spinner，也不依赖“全文翻译已经先扫描过”这一前提，
 * 所以悬浮翻译和全文翻译在新页面、SPA 路由和动态节点上使用完全相同的边界。
 */
function resolveTranslatableElement(start: Element): Element | false {
    let current: Element | null = start;

    while (current && !isDocumentSurface(current)) {
        const translatedContent = current.closest('.fluent-read-bilingual-content');
        if (translatedContent instanceof Element) {
            const source = translatedContent.parentElement;
            return source && !isDocumentSurface(source) ? source : false;
        }

        if (isExtensionElement(current)) {
            current = current.parentElement;
            continue;
        }

        const tag = current.tagName.toLowerCase();
        if (skipSet.has(tag) || isStructuralIgnoreElement(current) || isHiddenElement(current)) {
            return false;
        }
        if (isNoTranslateElement(current) || (current as HTMLElement).isContentEditable) return false;

        // 先识别控件，再判断结构祖先。这样悬浮到结构容器内按钮的文字子节点时，
        // 仍可向上找到按钮并复用按钮的替换/恢复逻辑。
        if (isTranslationControl(current)) return current;

        const insideStructuralContainer = hasStructuralIgnoreAncestor(current);
        if (!insideStructuralContainer) {
            const compatNode = getCompatNode(current);
            if (compatNode === 'skip') return false;
            if (compatNode && hasReadableText(compatNode)) return compatNode;

            if (isTranslationContentBlock(current)) return current;
        }
        current = current.parentElement;
    }

    return false;
}

// 返回最终应该翻译的父节点或 false。
// 该函数保持纯选择语义，调用者负责翻译和 DOM 渲染。
export function grabNode(node: Node | null | undefined): Element | false {
    if (!node) return false;

    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
    if (!(element instanceof Element)) return false;

    return resolveTranslatableElement(element);
}

function findElementsAtPoint(
    root: Document | ShadowRoot,
    mouseX: number,
    mouseY: number,
): Element[] {
    const pointRoot = root as Document & {
        elementsFromPoint?: (x: number, y: number) => Element[];
    };

    if (typeof pointRoot.elementsFromPoint === 'function') {
        return pointRoot.elementsFromPoint(mouseX, mouseY);
    }

    const element = root.elementFromPoint(mouseX, mouseY);
    return element ? [element] : [];
}

function resolveShadowTarget(
    root: Document | ShadowRoot,
    mouseX: number,
    mouseY: number,
): Element | false {
    for (const element of findElementsAtPoint(root, mouseX, mouseY)) {
        if (element.shadowRoot) {
            const shadowTarget = resolveShadowTarget(element.shadowRoot, mouseX, mouseY);
            if (shadowTarget) return shadowTarget;
        }

        const target = grabNode(element);
        if (target) return target;
    }

    return false;
}

/**
 * 解析鼠标坐标下的翻译目标。
 * 优先使用坐标下的元素栈，支持开放 ShadowRoot；解析完成前不产生任何翻译副作用。
 */
export function resolveNodeAtPoint(mouseX: number, mouseY: number): Element | false {
    if (typeof document === 'undefined') return false;
    return resolveShadowTarget(document, mouseX, mouseY);
}

// 检查节点内容是否主要为数字
function isMainlyNumericContent(node: any): boolean {
    if (!node || !node.textContent) return false;
    
    const text = node.textContent.trim();
    if (!text) return false;
    
    // 如果内容很短，且是纯数字格式，则跳过
    // 对于短文本，直接判断整体是否为数字格式
    if (text.length < 30 && isNumericContent(text)) return true;
    
    // 检查是否为用户名或用户ID格式
    if (isUserIdentifier(text)) return true;
    
    // 对于较长的内容，检查是否主要为数字格式
    // 处理节点可能含有多个文本子节点的情况
    // 这有助于更精确地识别混合内容中的数字部分
    const textNodes = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    let textNode;
    while (textNode = walker.nextNode()) {
        const nodeText = textNode.textContent?.trim() || '';
        if (nodeText) {
            textNodes.push(nodeText);
        }
    }
    
    // 如果只有一个文本节点且为数字，则跳过翻译
    if (textNodes.length === 1 && isNumericContent(textNodes[0])) return true;
    
    // 如果所有文本节点都是数字，则跳过翻译
    // 这可能是表格中的数字列或者纯数字列表等
    if (textNodes.length > 0 && textNodes.every(t => isNumericContent(t))) return true;
    
    // 否则不跳过，允许翻译
    return false;
}

/**
 * 检查文本是否为用户标识符（用户名、ID等）
 */
function isUserIdentifier(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    
    const trimmedText = text.trim();
    
    // 检查是否为社交媒体用户名格式
    if (/^@\w+/.test(trimmedText)) return true;  // Twitter格式：@username
    if (/^u\/\w+/.test(trimmedText)) return true; // Reddit格式：u/username
    
    // 检查是否为x.com或twitter.com的ID格式
    if (/^id@https?:\/\/(x\.com|twitter\.com)\/[\w-]+\/status\/\d+/.test(trimmedText)) return true;
    
    // 检查是否包含"关注"相关内容
    if (/关注.*\w+/.test(trimmedText) || /Follow.*\w+/.test(trimmedText)) return true;
    
    // 纯字母短词也可能是正文或按钮文案，只有带数字/下划线时才按无须翻译的用户名处理。
    if (/^(?=.*(?:\d|_))[A-Za-z0-9_]{1,15}$/.test(trimmedText)) return true;
    
    // 特殊格式：带点击动作的用户名
    if (/点击.*\w+/.test(trimmedText) && trimmedText.length < 50) return true;
    
    return false;
}

/**
 * 检查文本是否为纯数字或标准数字格式
 * 
 * 识别以下数字格式：
 * 1. 整数 (例如: 12345, -123)
 * 2. 带千位分隔符的数字 (例如: 1,234,567)
 * 3. 数字范围 (例如: 1-100, 5~10)
 * 4. 小数 (例如: 3.14159)
 * 5. 百分比 (例如: 85%, -2.5%)
 * 6. 科学计数法 (例如: 1.23e+4)
 * 7. 货币金额 (例如: $123.45, €100)
 * 8. 常见日期格式 (例如: 2023-01-01, 01/01/2023)
 * 9. 时间格式 (例如: 13:45:30, 9:30)
 * 10. 版本号 (例如: 1.0.0, 2.3.5-beta)
 * 11. ID格式 (例如: id@x.com/user/status/123456789)
 * 12. 用户名格式 (例如: @username, gunsnrosesgirl3)
 * 13. #数字 格式的
 * 
 * 这些格式的数字和用户标识符通常不需要翻译，保持原样更有利于页面理解。
 */
function isNumericContent(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    
    // 去除空白字符
    const trimmedText = text.trim();
    if (!trimmedText) return false;

    // 首先检查是否为用户标识符
    if (isUserIdentifier(trimmedText)) return true;
    
    // 如果包含多个单词，则不视为纯数字内容
    if (/\s+/.test(trimmedText.replace(/[\d,.\-%+]/g, ''))) return false;
    
    // 检查是否为纯数字
    if (/^-?\d+$/.test(trimmedText)) return true;
    
    // 检查是否为标准数字格式：带逗号的数字 (例如: 1,234,567)
    if (/^-?(\d{1,3}(,\d{3})+)$/.test(trimmedText)) return true;
    
    // 检查是否为范围数字 (例如: 1-123)
    if (/^\d+\s*[-~]\s*\d+$/.test(trimmedText)) return true;
    
    // 检查是否为小数
    if (/^-?\d+\.\d+$/.test(trimmedText)) return true;
    
    // 检查是否为百分比
    if (/^-?\d+(\.\d+)?%$/.test(trimmedText)) return true;
    
    // 检查是否为科学计数法 (例如: 1.23e+4)
    if (/^-?\d+(\.\d+)?(e[-+]\d+)?$/i.test(trimmedText)) return true;
    
    // 检查是否为带货币符号的金额 (例如: $123.45, €123, ¥123)
    if (/^[$€¥£₹₽₩]?\s*-?\d+(,\d{3})*(\.\d+)?$/.test(trimmedText)) return true;
    
    // 检查是否为日期时间格式 (仅考虑常见的数字日期格式)
    // 匹配 YYYY-MM-DD, YYYY/MM/DD, DD-MM-YYYY, DD/MM/YYYY, MM-DD-YYYY, MM/DD/YYYY
    if (/^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{1,2}[-/]\d{1,2}[-/]\d{1,2})$/.test(trimmedText)) return true;
    
    // 匹配时间格式 HH:MM:SS, HH:MM
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmedText)) return true;
    
    // 匹配版本号 (例如: 1.0.0, 2.3.5-beta)
    if (/^\d+(\.\d+){1,3}(-[a-zA-Z0-9]+)?$/.test(trimmedText)) return true;
    
    // 匹配社交媒体的ID格式
    if (/^id@https?:\/\/(x\.com|twitter\.com)\/[\w-]+\/status\/\d+/.test(trimmedText)) return true;
    
    // 匹配常见的数字ID格式
    if (/^ID[:：]?\s*\d+$/.test(trimmedText)) return true;
    if (/^No[\.:]?\s*\d+$/i.test(trimmedText)) return true;

    // #数字 格式的
    if (/^#[\d]+$/.test(trimmedText)) return true;

    return false;
}

// 仅译文模式下获取 LLM 应当翻译的标准 HTML
export function LLMStandardHTML(node: any) {
    // 1. 初始化空字符串 text
    // 2. 遍历子节点
    // 3. 若为文本节点，拼接其文本内容
    // 4. 若为元素节点且在 inlineSet 中，拼接其 outerHTML
    // 5. 否则继续递归处理子节点
    let text = "";
    node.childNodes.forEach((child: any) => {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (inlineSet.has(child.tagName.toLowerCase())) {
                text += child.outerHTML;
            } else {
                text += LLMStandardHTML(child);
            }
        }
    });
    return text;
}

// 移除特定样式
function checkAndRemoveStyle(node: HTMLElement, styleProperty: string) {
    // 1. 若节点存在样式且对应属性不为 undefined，则清空该属性
    const style = node.style as unknown as Record<string, string | undefined>;
    if (style[styleProperty] !== undefined) {
        style[styleProperty] = '';
    }
}

// 移除截断样式
export function smashTruncationStyle(node: HTMLElement) {
    // 1. 先调用 checkAndRemoveStyle 移除 webkitLineClamp 属性
    // 2. 将节点的相关样式设为 'unset'
    checkAndRemoveStyle(node, 'webkitLineClamp');
    node.style.webkitLineClamp = 'unset';
    node.style.maxHeight = 'unset';
}

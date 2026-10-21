/**
 * @file src/features/section-translation/locator.ts
 * 文件职责：为显式选择的网页区域生成有限且可重复定位的 CSS 路径，并在下次访问时保守解析。
 * 主要内容：优先稳定 ID、测试/角色属性和语义类锚点，以有限父子路径补齐；每个开放 Shadow Root 单独保存选择器，唯一命中才接受，忽略动态编号、翻译工件和 FluentRead 自有界面。
 * 模块边界：只读取传入 DOM，不建立观察器或缓存，不扩大到相似区域，不读取文本或凭据、不持久化，也不发起翻译；运行时负责匹配规则和安排执行时机。
 */
import {getComposedParent, getElementTagName} from '@/src/core/translation/public';
import {MAX_SECTION_LOCATOR_DEPTH, MAX_SECTION_SELECTOR_LENGTH, isValidSectionLocatorPath, isValidSectionSelector} from '@/src/core/config/sectionTranslationRules';
import {isSectionPickerUi} from './core';

const PROTECTED = 'head,script,style,template,iframe,object,embed,svg,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[translate="no"],[hidden],[aria-hidden="true"],.notranslate,.fluent-read-bilingual-content,.fluent-read-loading,.fluent-read-retry-wrapper,[data-fr-translation-owned="true"]';
const ATTRIBUTES = ['data-testid', 'data-test', 'data-qa', 'data-role', 'role'] as const;
type QueryRoot = Document | ShadowRoot;

function stableToken(value: string): boolean {
    return value.length > 0 && value.length <= 100 && /^[\p{L}\d_-]+$/u.test(value)
        && !/\d{4,}|[a-f\d]{12,}|^(?:react|ember|radix|headlessui)[-_\d]/iu.test(value);
}

function safeElement(element: Element): boolean {
    if (!element.isConnected || isSectionPickerUi(element)) return false;
    let current: Element | null = element;
    for (let depth = 0; current && depth < 512; current = getComposedParent(current), depth += 1) {
        if (current.matches(PROTECTED)) return false;
        if (current === element && /^(?:html|body|head)$/u.test(getElementTagName(current))) return false;
    }
    return current === null;
}

function uniqueMatch(root: QueryRoot, selector: string, expected?: Element): Element | null {
    if (!isValidSectionSelector(selector)) return null;
    try {
        // querySelectorAll is bounded to one tree and selector length; ambiguity is a failure, never pick the first result.
        const matches = root.querySelectorAll(selector);
        return matches.length === 1 && (!expected || matches[0] === expected) ? matches[0] : null;
    } catch {
        return null;
    }
}

function anchors(element: Element): string[] {
    const tag = getElementTagName(element);
    const values: string[] = [];
    const id = element.getAttribute('id');
    if (id && stableToken(id)) values.push(`[id="${id}"]`);
    for (const attr of ATTRIBUTES) {
        const value = element.getAttribute(attr);
        if (value && stableToken(value)) values.push(`${tag}[${attr}="${value}"]`);
    }
    const classes = [...element.classList].filter(name => stableToken(name)
        && !/^(?:fluent-read-|css-|jsx-|svelte-|sc-)|^(?:active|selected|open|closed|hidden|visible|focus|hover|loading|disabled)$/iu.test(name)).slice(0, 3);
    if (classes.length) values.push(`${tag}${classes.map(name => `[class~="${name}"]`).join('')}`);
    if (/^(?:main|article|section|nav|aside|header|footer)$/u.test(tag)) values.push(tag);
    return values;
}

function position(element: Element): string {
    const tag = getElementTagName(element);
    // 同级只读，避免深层 DOM 的全树序号；只在缺少稳定语义时采用后备位置。
    let index = 1;
    let steps = 0;
    for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (getElementTagName(sibling) === tag) index += 1;
        if (++steps > 10000) return '';
    }
    return `${tag}:nth-of-type(${index})`;
}

function selectorInRoot(element: Element, root: QueryRoot): string | null {
    let suffix = '';
    let current: Element | null = element;
    for (let depth = 0; current && depth < 12; depth += 1) {
        if (/^(?:html|body|head)$/u.test(getElementTagName(current))) break;
        for (const anchor of anchors(current)) {
            const selector = suffix ? `${anchor} > ${suffix}` : anchor;
            if (uniqueMatch(root, selector, element)) return selector;
        }
        const segment = position(current);
        if (!segment) return null;
        suffix = suffix ? `${segment} > ${suffix}` : segment;
        if (suffix.length > MAX_SECTION_SELECTOR_LENGTH) return null;
        const parent: Element | null = current.parentElement;
        // 无语义的绝对位置只可在明确父容器之内保存，不能从 body 序号猜测其他页面的区域。
        // 无父元素时已到当前 ShadowRoot；逐级 nth-of-type 子链在该树中天然唯一。
        if (!parent) return suffix;
        current = parent;
    }
    return null;
}

/** 返回从 document 到目标的开放 Shadow DOM 选择器链，无法可靠重定位则不提供保存。 */
export function createSectionLocator(element: Element): string[] | null {
    if (!safeElement(element)) return null;
    const path: string[] = [];
    let current = element;
    for (let depth = 0; depth < MAX_SECTION_LOCATOR_DEPTH; depth += 1) {
        const root = current.getRootNode() as QueryRoot;
        if (root.nodeType !== 9 && root.nodeType !== 11) return null;
        const selector = selectorInRoot(current, root);
        if (!selector) return null;
        path.unshift(selector);
        if (root.nodeType === 9) return path;
        const shadow = root as ShadowRoot;
        if (!shadow.host || shadow.host.shadowRoot !== shadow || !safeElement(shadow.host)) return null;
        current = shadow.host;
    }
    return null;
}

/** 每条路径每层都必须唯一；缺失、歧义、关闭 Shadow DOM 或保护区域均保留原文。 */
export function resolveSectionLocators(paths: readonly (readonly string[])[], document: Document): Element[] {
    const result = new Set<Element>();
    for (const path of paths.slice(0, 16)) {
        if (!isValidSectionLocatorPath(path)) continue;
        let root: QueryRoot = document;
        let element: Element | null = null;
        for (let index = 0; index < path.length; index += 1) {
            element = uniqueMatch(root, path[index]);
            if (!element || !safeElement(element)) {element = null; break;}
            if (index < path.length - 1) {
                if (!element.shadowRoot) {element = null; break;}
                root = element.shadowRoot;
            }
        }
        if (element) result.add(element);
    }
    return [...result];
}

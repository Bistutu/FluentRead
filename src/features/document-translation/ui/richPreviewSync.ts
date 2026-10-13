/**
 * @file src/features/document-translation/ui/richPreviewSync.ts
 * 文件职责：让 HTML、Markdown、纯文本与 ePub 章节的隔离预览在译文逐段到达时原位更新，而不是重新载入整页并丢失滚动位置。
 * 主要内容：把新生成的预览 HTML 解析成文档后，与预览框里现有的正文逐节点比对，只改写发生变化的文字、属性和子树；提供按文档规模放慢的节流间隔，避免长文档每到一段译文就整篇比对；从预览框的标题收集目录（原文与译文配对），并按目录项滚动到对应标题；标记预览是否处于翻译进行中，供预览样式显示等待占位；读出预览滚动到全文的比例，供翻译从正在阅读的位置开始。
 * 模块边界：只做 DOM 同步与读取，不生成预览 HTML、不发起翻译、不决定何时刷新；预览框不允许执行脚本，无法访问其文档时返回 false，由页面退回整页载入。
 */

interface PreviewFrame {contentDocument?: Document | null}
type PreviewParser = (html: string) => Document | null;

function sameKind(current: Node, next: Node): boolean {
    return current.nodeType === next.nodeType && current.nodeName === next.nodeName;
}

function syncAttributes(current: Element, next: Element): void {
    for (const name of current.getAttributeNames()) if (!next.hasAttribute(name)) current.removeAttribute(name);
    for (const name of next.getAttributeNames()) {
        const value = next.getAttribute(name)!;
        if (current.getAttribute(name) !== value) current.setAttribute(name, value);
    }
}

/** 按位置逐个比对子节点：同类节点就地更新，不同类的整棵替换，多出来的删除。 */
export function syncPreviewChildren(current: Node, next: Node): void {
    const owner = current.ownerDocument!;
    const nextChildren = Array.from(next.childNodes);
    nextChildren.forEach((nextChild, index) => {
        const currentChild = current.childNodes[index];
        if (!currentChild) {current.appendChild(owner.importNode(nextChild, true)); return;}
        if (!sameKind(currentChild, nextChild)) {current.replaceChild(owner.importNode(nextChild, true), currentChild); return;}
        if (currentChild.nodeType === 1) {
            syncAttributes(currentChild as Element, nextChild as Element);
            syncPreviewChildren(currentChild, nextChild);
        } else if (currentChild.nodeValue !== nextChild.nodeValue) currentChild.nodeValue = nextChild.nodeValue;
    });
    while (current.childNodes.length > nextChildren.length) current.removeChild(current.lastChild!);
}

const browserParser: PreviewParser = html => typeof DOMParser === 'undefined' ? null : new DOMParser().parseFromString(html, 'text/html');

/**
 * 把预览框的正文同步为给定 HTML 的正文。预览框尚未载入、不可访问或无法解析时返回 false。
 */
export function syncRichPreview(frame: PreviewFrame | null | undefined, html: string, parse: PreviewParser = browserParser): boolean {
    const body = frame?.contentDocument?.body;
    const next = body ? parse(html)?.body : null;
    if (!body || !next) return false;
    syncAttributes(body, next);
    syncPreviewChildren(body, next);
    return true;
}

/** 翻译进行中的刷新间隔：短文档四分之一秒一次，片段越多越慢，最长两秒。 */
export function richPreviewInterval(segmentCount: number): number {
    return Math.min(2000, Math.max(250, Math.round(segmentCount / 8)));
}

export interface RichOutlineItem {
    /** 标题在预览正文全部标题元素中的序号，用于跳转。 */
    index: number;
    level: number;
    source: string;
    /** 该标题的译文；尚未翻译或与原文相同时为空。 */
    translation: string;
}

const HEADINGS = 'h1,h2,h3,h4,h5,h6';
const TRANSLATION = '[data-fluent-read-document-translation="true"],.fluentread-translation';
const headingText = (node: Element) => node.textContent!.replace(/\s+/gu, ' ').trim();

/**
 * 从预览框读出目录。Markdown 预览把译文放在紧随原文标题之后的同级标题里，HTML 与 ePub 把译文放在标题内部；
 * 两种结构都配成“原文 + 译文”一项，只有译文的阅读方式则直接以译文作为标题。
 */
export function collectRichOutline(frame: PreviewFrame | null | undefined): RichOutlineItem[] {
    const body = frame?.contentDocument?.body;
    if (!body) return [];
    const items: RichOutlineItem[] = [];
    let previous: Element | undefined;
    Array.from(body.querySelectorAll(HEADINGS)).forEach((heading, index) => {
        const last = items.at(-1);
        if (last && !last.translation && heading.matches(TRANSLATION) && heading.previousElementSibling === previous) last.translation = headingText(heading);
        else {
            const copy = heading.cloneNode(true) as Element;
            const inner = copy.querySelector(TRANSLATION);
            inner?.remove();
            const source = headingText(copy);
            if (source) items.push({index, level: Number(heading.tagName.slice(1)), source, translation: inner ? headingText(inner) : ''});
        }
        previous = heading;
    });
    return items;
}

/** 滚动到目录项对应的标题；预览已经变化、找不到该标题时返回 false。 */
export function scrollRichOutline(frame: PreviewFrame | null | undefined, index: number): boolean {
    const heading = frame?.contentDocument?.body?.querySelectorAll(HEADINGS)[index];
    if (!heading) return false;
    heading.scrollIntoView({block: 'start', behavior: 'smooth'});
    return true;
}

/** 在预览正文上标记翻译是否进行中；同步正文属性之后需要重新标记。 */
export function markRichPreviewBusy(frame: PreviewFrame | null | undefined, busy: boolean): void {
    frame?.contentDocument?.body?.toggleAttribute('data-translating', busy);
}

/** 预览框当前滚动到全文的什么位置（0 到 1）；无法读取时按开头处理。 */
export function richPreviewPosition(frame: PreviewFrame | null | undefined): number {
    const scroller = frame?.contentDocument?.scrollingElement;
    return scroller && scroller.scrollHeight > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / scroller.scrollHeight)) : 0;
}

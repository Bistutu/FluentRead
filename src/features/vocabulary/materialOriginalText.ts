/**
 * @file src/features/vocabulary/materialOriginalText.ts
 * 文件职责：只读投影单个材料正文块，防止双语译文、隐藏内容和扩展界面进入原句定位。
 * 主要内容：有界遍历本块并映射原生 Range 到归一化原文偏移；用选区包含关系为整句 quote 消歧，不把原句缩成选中词。
 * 模块边界：不寻找整页候选、不修改 DOM 或 Selection、不读取网址和存储；预算超限、断连和无法核对的位置全部拒绝。
 */

export const MATERIAL_ORIGINAL_TEXT_LIMITS = Object.freeze({characters: 12000, nodes: 2000, ancestors: 64});

export interface MaterialOriginalTextBudget {
    /** 原始 UTF-16 字符预算，包含空白；只能缩小默认上限。 */
    characters?: number;
    /** 本块访问的节点预算，排除子树只计根节点；只能缩小默认上限。 */
    nodes?: number;
}

export interface MaterialOriginalText {
    text: string;
    /** 归一化 text 的 UTF-16 边界；仅提供 Range 时存在，不包含被排除的文字。 */
    selection?: {start: number; end: number};
}

export interface MaterialOriginalQuote {
    quote: string;
    index: number;
    prefix: string;
    suffix: string;
}

const EXCLUDED = 'script,style,noscript,template,form,input,textarea,select,option,button,pre,code,kbd,svg,math,mjx-container,.katex,nav,aside,[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="button"],.notranslate,[data-notranslate="true"],[data-fluent-read-ui],[data-fr-translation-owned="true"],.fluent-read-bilingual-content,.fluent-read-translation-text,[id^="fluent-read-"]';
const PAGE_SHELL = 'html,body,main,article,section';
const BREAK = /^(?:BR|P|DIV|LI|DD|DT|BLOCKQUOTE|FIGCAPTION|H[1-6])$/u;
const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();

function budget(value: number | undefined, maximum: number): number {
    return value === undefined ? maximum : Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : 0;
}

/** 检查仅限本块和最多 64 层祖先；先排除已知子树，再按需读取每个保留元素的计算样式一次。 */
export function projectMaterialOriginalText(root: Element, range?: Range, limits: MaterialOriginalTextBudget = {}): MaterialOriginalText | undefined {
    const characters = budget(limits.characters, MATERIAL_ORIGINAL_TEXT_LIMITS.characters);
    const nodes = budget(limits.nodes, MATERIAL_ORIGINAL_TEXT_LIMITS.nodes);
    const view = root.ownerDocument.defaultView;
    if (!characters || !nodes || !view || !root.isConnected || root.matches(PAGE_SHELL)) return;
    const connectedRange = () => !range || (range.startContainer.isConnected && range.endContainer.isConnected
        && root.contains(range.startContainer) && root.contains(range.endContainer));
    if (!connectedRange()) return;
    const ancestors: Element[] = [];
    for (let element: Element | null = root; element; element = element.parentElement ?? (element.getRootNode() as ShadowRoot).host ?? null) {
        if (ancestors.length === MATERIAL_ORIGINAL_TEXT_LIMITS.ancestors || element.matches(EXCLUDED)) return;
        ancestors.push(element);
    }
    const visible = (element: Element): boolean => {
        try {
            const style = typeof view.getComputedStyle === 'function' ? view.getComputedStyle(element) : (element as HTMLElement).style;
            return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.contentVisibility !== 'hidden';
        } catch { return false; }
    };
    // 祖先先检查，避免在整个块已隐藏时继续读取后代样式。
    for (const element of ancestors.reverse()) if (!visible(element)) return;
    const chunks: string[] = [];
    let length = 0, visited = 1, start = -1, end = -1;
    const append = (value: string): boolean => {
        if (length + value.length > characters) return false;
        chunks.push(value); length += value.length; return true;
    };
    const boundary = (node: Node, offset: number) => {
        if (range?.startContainer === node && range.startOffset === offset) start = length;
        if (range?.endContainer === node && range.endOffset === offset) end = length;
    };
    const stack: Array<{element: Element; next: ChildNode | null; offset: number; separate: boolean}> = [
        {element: root, next: root.firstChild, offset: 0, separate: false},
    ];
    while (stack.length) {
        const frame = stack[stack.length - 1];
        boundary(frame.element, frame.offset);
        const node = frame.next;
        if (!node) {
            stack.pop();
            if (frame.separate && !append('\n')) return;
            continue;
        }
        frame.next = node.nextSibling; frame.offset++;
        if (++visited > nodes) return;
        if (node.nodeType === 3) {
            const text = node as Text;
            // 先检查长度；不为一个超大 Text 节点复制完整正文。
            if (text.length > characters - length) return;
            if (range?.startContainer === text && Number.isSafeInteger(range.startOffset) && range.startOffset >= 0 && range.startOffset <= text.length) start = length + range.startOffset;
            if (range?.endContainer === text && Number.isSafeInteger(range.endOffset) && range.endOffset >= 0 && range.endOffset <= text.length) end = length + range.endOffset;
            append(text.data);
        } else if (node.nodeType === 1) {
            const element = node as Element;
            if (element.matches(EXCLUDED) || !visible(element)) continue;
            const separate = BREAK.test(element.tagName);
            if (separate && !append('\n')) return;
            stack.push({element, next: element.firstChild, offset: 0, separate});
        }
    }
    if (!root.isConnected || !connectedRange() || (range && (start < 0 || end < start))) return;
    const raw = chunks.join('');
    const text = normalize(raw);
    if (!text) return;
    const normalizedOffset = (offset: number) => Math.min(text.length, raw.slice(0, offset).replace(/\s+/gu, ' ').trimStart().length);
    return {text, ...(range ? {selection: {start: normalizedOffset(start), end: normalizedOffset(end)}} : {})};
}

/** quote 可为阅读讲解展开的整句；仅接纳包含原生选区的唯一出现，绝不回退到首个相同表达。 */
export function locateMaterialOriginalQuote(projection: MaterialOriginalText, quote: string): MaterialOriginalQuote | undefined {
    if (!projection.selection || quote.length > MATERIAL_ORIGINAL_TEXT_LIMITS.characters) return;
    const selected = normalize(quote);
    if (!selected || selected.length > 6000) return;
    const {text} = projection;
    let {start, end} = projection.selection;
    while (start < end && text[start] === ' ') start++;
    while (end > start && text[end - 1] === ' ') end--;
    if (start === end) return;
    let match = -1;
    for (let index = text.indexOf(selected); index >= 0; index = text.indexOf(selected, index + 1)) {
        if (index <= start && index + selected.length >= end) {
            if (match >= 0) return;
            match = index;
        }
    }
    if (match < 0) return;
    return {quote: selected, index: match, prefix: text.slice(Math.max(0, match - 160), match), suffix: text.slice(match + selected.length, match + selected.length + 160)};
}

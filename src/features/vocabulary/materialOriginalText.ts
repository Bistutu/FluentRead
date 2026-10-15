/**
 * @file src/features/vocabulary/materialOriginalText.ts
 * 文件职责：只读投影单个材料正文块，防止双语译文、隐藏内容和扩展界面进入原句定位。
 * 主要内容：有界遍历本块并映射原生 Range 到归一化原文偏移；用选区包含关系为整句 quote 消歧，不把原句缩成选中词；显式同步 slice 会话复用样式和祖先校验，区分超预算与不可读结果。
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

export type MaterialOriginalTextReadStatus = 'complete' | 'skipped' | 'budget-exceeded' | 'unavailable' | 'stale';
export interface MaterialOriginalTextReadMetrics {projections: number; styleReads: number; ancestorVisits: number; nodeVisits: number; characters: number}
export interface MaterialOriginalTextReadSession {
    readonly status: MaterialOriginalTextReadStatus;
    readonly metrics: Readonly<MaterialOriginalTextReadMetrics>;
    project(root: Element, range?: Range, limits?: MaterialOriginalTextBudget): MaterialOriginalText | undefined;
    close(): void;
}
interface MaterialOriginalTextReadContext {
    document: Document;
    isCurrent(): boolean;
    active: boolean;
    status: MaterialOriginalTextReadStatus;
    metrics: MaterialOriginalTextReadMetrics;
    visibility: WeakMap<Element, boolean>;
    ancestors: WeakMap<Element, {visible: boolean; depth: number}>;
}

/** 仅供同一次同步 slice 使用；调用方必须在 yield 前 close，下一帧重新创建，不能把 CSS 判定跨帧缓存。 */
export function createMaterialOriginalTextReadSession(document: Document, options: {isCurrent?: () => boolean} = {}): MaterialOriginalTextReadSession {
    const context: MaterialOriginalTextReadContext = {document, isCurrent: options.isCurrent ?? (() => true), active: true,
        status: 'skipped', metrics: {projections: 0, styleReads: 0, ancestorVisits: 0, nodeVisits: 0, characters: 0},
        visibility: new WeakMap(), ancestors: new WeakMap()};
    return {
        get status() {return context.status;},
        get metrics() {return {...context.metrics};},
        project(root, range, limits = {}) {
            context.status = 'skipped'; context.metrics.projections++;
            if (!context.active || !context.isCurrent() || root.ownerDocument !== document) {context.status = 'stale'; return;}
            const projection = projectOriginalText(root, range, limits, context);
            if (!context.active || !context.isCurrent()) {context.status = 'stale'; return;}
            if (projection) context.status = 'complete';
            return projection;
        },
        close() {context.active = false; context.visibility = new WeakMap(); context.ancestors = new WeakMap();},
    };
}

// Inline code, keyboard labels and translation opt-outs remain readable original text.
// Visibility, editable controls, code blocks and FluentRead-owned UI are excluded separately.
const EXCLUDED = 'script,style,noscript,template,form,input,textarea,select,option,button,pre,svg,math,mjx-container,.katex,nav,aside,[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="button"],[data-fluent-read-ui],[data-fr-translation-owned="true"],.fluent-read-bilingual-content,.fluent-read-translation-text,[id^="fluent-read-"]';
const PAGE_SHELL = 'html,body,main,article,section';
const BREAK = /^(?:BR|P|DIV|LI|DD|DT|BLOCKQUOTE|FIGCAPTION|H[1-6])$/u;
const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();

function budget(value: number | undefined, maximum: number): number {
    return value === undefined ? maximum : Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : 0;
}

/** 保持单块公开契约；整页调用者应显式创建每个同步 slice 的共享 read session。 */
export function projectMaterialOriginalText(root: Element, range?: Range, limits: MaterialOriginalTextBudget = {}): MaterialOriginalText | undefined {
    const session = createMaterialOriginalTextReadSession(root.ownerDocument);
    try {return session.project(root, range, limits);} finally {session.close();}
}

function readVisibility(element: Element, context: MaterialOriginalTextReadContext): boolean {
    const cached = context.visibility.get(element);
    if (cached !== undefined) return cached;
    let visible = false;
    try {
        const view = context.document.defaultView!;
        context.metrics.styleReads++;
        const style = typeof view.getComputedStyle === 'function' ? view.getComputedStyle(element) : (element as HTMLElement).style;
        visible = style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.contentVisibility !== 'hidden';
    } catch {context.status = 'unavailable';}
    context.visibility.set(element, visible);
    return visible;
}

function readableAncestors(root: Element, context: MaterialOriginalTextReadContext): boolean {
    const chain: Element[] = [];
    let depth = 0, visible = true;
    for (let element: Element | null = root; element; element = element.parentElement ?? (element.getRootNode() as ShadowRoot).host ?? null) {
        const cached = context.ancestors.get(element);
        if (cached) {depth = cached.depth; visible = cached.visible; break;}
        context.metrics.ancestorVisits++;
        if (chain.length === MATERIAL_ORIGINAL_TEXT_LIMITS.ancestors) {context.status = 'budget-exceeded'; return false;}
        chain.push(element);
        if (element.matches(EXCLUDED)) {visible = false; break;}
    }
    if (depth + chain.length > MATERIAL_ORIGINAL_TEXT_LIMITS.ancestors) {context.status = 'budget-exceeded'; return false;}
    for (const element of chain.reverse()) {
        visible = visible && readVisibility(element, context);
        context.ancestors.set(element, {visible, depth: ++depth});
    }
    return visible;
}

function projectOriginalText(root: Element, range: Range | undefined, limits: MaterialOriginalTextBudget, context: MaterialOriginalTextReadContext): MaterialOriginalText | undefined {
    const characters = budget(limits.characters, MATERIAL_ORIGINAL_TEXT_LIMITS.characters);
    const nodes = budget(limits.nodes, MATERIAL_ORIGINAL_TEXT_LIMITS.nodes);
    if (!characters || !nodes) {context.status = 'budget-exceeded'; return;}
    if (!context.document.defaultView || !root.isConnected) {context.status = 'stale'; return;}
    if (root.matches(PAGE_SHELL)) return;
    const connectedRange = () => !range || (range.startContainer.isConnected && range.endContainer.isConnected
        && root.contains(range.startContainer) && root.contains(range.endContainer));
    if (!connectedRange()) return;
    if (!readableAncestors(root, context)) return;
    context.metrics.nodeVisits++;
    const chunks: string[] = [];
    let length = 0, visited = 1, start = -1, end = -1;
    const append = (value: string): boolean => {
        if (length + value.length > characters) {context.status = 'budget-exceeded'; return false;}
        chunks.push(value); length += value.length; context.metrics.characters += value.length; return true;
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
        context.metrics.nodeVisits++;
        if (++visited > nodes) {context.status = 'budget-exceeded'; return;}
        if (node.nodeType === 3) {
            const text = node as Text;
            // 先检查长度；不为一个超大 Text 节点复制完整正文。
            if (text.length > characters - length) {context.status = 'budget-exceeded'; return;}
            if (range?.startContainer === text && Number.isSafeInteger(range.startOffset) && range.startOffset >= 0 && range.startOffset <= text.length) start = length + range.startOffset;
            if (range?.endContainer === text && Number.isSafeInteger(range.endOffset) && range.endOffset >= 0 && range.endOffset <= text.length) end = length + range.endOffset;
            append(text.data);
        } else if (node.nodeType === 1) {
            const element = node as Element;
            if (element.matches(EXCLUDED) || !readVisibility(element, context)) continue;
            const separate = BREAK.test(element.tagName);
            if (separate && !append('\n')) return;
            stack.push({element, next: element.firstChild, offset: 0, separate});
        }
    }
    if (!root.isConnected) {context.status = 'stale'; return;}
    if (!connectedRange() || (range && (start < 0 || end < start))) return;
    if (context.status === 'unavailable') return;
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

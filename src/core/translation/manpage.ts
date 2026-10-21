/**
 * @file src/core/translation/manpage.ts
 * 文件职责：把 man 手册的预格式文本分为说明段与需要原样保留的代码、终端输出和排版间隔。
 * 主要内容：有界解析空行、缩进标题、项目符号和参数说明；整块保护 shell 会话与 C 源码，并用对象身份登记已核验的 PRE 和说明段边界。
 * 模块边界：只计算文本范围与维护调用方显式登记的弱引用，不改写 DOM、不匹配配置、不请求翻译；页面校验、包装与恢复属于 content 准备层。
 */

export interface ManpageTextSegment {start: number; end: number; prose: boolean}

const preparedPres = new WeakSet<Element>();
const preparedParagraphs = new WeakMap<Element, WeakSet<Text>>();
const preparedDocumentCounts = new WeakMap<Document, number>();

/** 属性只供样式与诊断；候选权限必须来自运行时持有的真实对象。 */
export function registerManpagePreparation(pre: Element, paragraphs: readonly Element[]): void {
    if (!preparedPres.has(pre)) preparedDocumentCounts.set(pre.ownerDocument, (preparedDocumentCounts.get(pre.ownerDocument) ?? 0) + 1);
    preparedPres.add(pre);
    paragraphs.forEach(paragraph => {
        if (preparedParagraphs.has(paragraph)) return;
        const sources = new WeakSet<Text>();
        const walker = paragraph.ownerDocument.createTreeWalker(paragraph, 4);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) sources.add(node as Text);
        preparedParagraphs.set(paragraph, sources);
    });
}
export function unregisterManpagePreparation(pre: Element, paragraphs: readonly Element[]): void {
    if (preparedPres.delete(pre)) preparedDocumentCounts.set(pre.ownerDocument, preparedDocumentCounts.get(pre.ownerDocument)! - 1);
    paragraphs.forEach(paragraph => preparedParagraphs.delete(paragraph));
}
export function isPreparedManpagePre(element: Element): boolean {return preparedPres.has(element);}
export function isPreparedManpageParagraph(element: Element): boolean {return preparedParagraphs.has(element);}

function currentParagraphSource(paragraph: Element): string {
    const sources = preparedParagraphs.get(paragraph)!;
    const walker = paragraph.ownerDocument.createTreeWalker(paragraph, 4);
    let value = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        // 仅译文模式把原 Text 搬入 owned host；它仍是来源，双语副本和 loading 则不是。
        if (sources.has(node as Text) || !node.parentElement!.closest('[data-fr-translation-owned="true"],.fluent-read-loading,.fluent-read-retry-wrapper')) value += node.nodeValue;
        if (value.length > 16_384) break;
    }
    return value;
}

/** 放开 PRE 的遍历不授予后来插入的裸文本权限；只有登记过的说明段可提供来源。 */
export function isUnpreparedManpageText(node: Text): boolean {
    if (!preparedDocumentCounts.get(node.ownerDocument)) return false;
    let paragraph: Element | null = null;
    let current = node.parentElement;
    for (let depth = 0; current && depth < 512; depth++, current = current.parentElement) {
        if (preparedParagraphs.has(current)) paragraph = current;
        if (preparedPres.has(current)) return !paragraph || !isProse(currentParagraphSource(paragraph));
    }
    return false;
}

/** 终端提示符使整块输出成为字面量，代码注释也不能作为普通说明单独翻译。 */
function isCodeBlock(value: string): boolean {
    return /^\s*(?:[$#]\s|\|\/|\/\*|\*\/|#\s*(?:include|define|if|endif)\b|[{}]\s*$)/mu.test(value)
        || /(?:;\s*$|\b(?:if|for|while)\s*\([^\n]*\)|\w+\([^\n]*\)\s*;)/mu.test(value);
}

function isProse(value: string): boolean {
    if (value.length > 16_384 || isCodeBlock(value) || /^\s*Linux man-pages\s+\d/mu.test(value)) return false;
    // 手册引用列表、路径与单独的标识符不是自然语言；保留很短的两词小标题。
    const words = value.replace(/\b[\w.-]+\([1-9][a-z]*\)/giu, '').replace(/(?:https?:\/\/|\/)[^\s]+/gu, '')
        .match(/\b[a-zA-Z][a-zA-Z'-]+\b/gu);
    return Boolean(words && words.length >= 2 && words.some(word => /[a-z]{2}/u.test(word)));
}

/** 所有字符只属于一个片段；超大 PRE 保守保留，避免同步准备占用无限主线程。 */
export function splitManpageText(text: string): ManpageTextSegment[] {
    if (!text || text.length > 524_288) return [];
    const lines = Array.from(text.matchAll(/[^\n]*(?:\n|$)/gu))
        .filter(match => match[0].length > 0)
        .map(match => ({start: match.index!, end: match.index! + match[0].length, value: match[0]}));
    const segments: ManpageTextSegment[] = [];
    let start = 0;
    let source = false;
    const flush = (end: number) => {
        if (end === start) return;
        const value = text.slice(start, end);
        // C 文件的声明和注释常被空行分隔；一旦出现源码起点，余下内容均保持原样。
        source ||= /^\s*#\s*(?:include|define)\b/mu.test(value) || /^\s*\/\*[^\n]*\.[ch]\s*\*\//mu.test(value);
        segments.push({start, end, prose: !source && isProse(value)});
        start = end;
    };
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        if (!line.value.trim()) {flush(line.start); flush(line.end); continue;}
        const previous = lines[index - 1];
        const entry = /^\s*(?:%[a-zA-Z%]\s|bit\s+\d\b|[•●]\s)/u.test(line.value);
        const heading = /^ {0,3}\S/u.test(line.value);
        const afterHeading = previous && /^ {0,3}\S/u.test(previous.value) && /^ {7,}\S/u.test(line.value);
        if (entry || heading || afterHeading) flush(line.start);
    }
    flush(text.length);
    return segments;
}

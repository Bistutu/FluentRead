/**
 * @file src/services/translation/context/policy.ts
 *
 * 文件职责：定义页面上下文的纯身份、预算与拼装策略，在不访问 DOM 的情况下区分页面路由与阅读锚点，并约束文本、Markdown 和元数据长度。
 * 主要内容：声明 pageContextLimits 与输入结构，以 getPageTranslationMaterialIdentity 保留路径、查询和哈希路由身份，规范化普通文本和 Markdown 行内空白，同时保留列表缩进与硬换行，判断是否启用 bounded capture，并由 buildPageTranslationContext 按预算组合标题、正文和可读 Markdown。
 * 模块边界：本文件位于翻译 application service 层，负责用例编排和端口契约；不挂载页面 UI，且不应把某家供应商的网络细节扩散到 feature，具体 HTTP 协议由 providers/platform 实现。
 */

/** 页面上下文的固定预算；所有入口共用同一组上限，避免请求体随页面无限增长。 */
export const pageContextLimits = Object.freeze({
    content: 2_000,
    total: 4_000,
    defuddleElements: 1_500,
    defuddleText: 100_000,
    defuddleMarkup: 250_000,
    captureNodes: 8_192,
    captureCharacters: 6_000,
});

export interface PageSnapshotBudget {
    elements: number;
    textCharacters: number;
    markupCharacters: number;
    visitedNodes: number;
}

export interface PageTranslationContextInput {
    title?: string;
    description?: string;
    readableText?: string;
}

/** 普通页内锚点只是阅读位置；路径、查询与 #/、#!/ 风格的 SPA 路由代表新材料。 */
export function getPageTranslationMaterialIdentity(href: string): string {
    try {
        const url = new URL(href);
        if (!/^#!?\//.test(url.hash)) url.hash = '';
        return url.href;
    } catch {
        return href.split('#', 1)[0]!;
    }
}

/** 归一化普通网页文本，同时折叠全角空格，避免页面排版噪声进入提示词。 */
export function normalizePageText(value: string): string {
    return value.replace(/[\s\u3000]+/gu, ' ').trim();
}

/** 保留 Markdown 段落、行首缩进与行尾硬换行，只折叠非结构性的行内空白。 */
export function normalizePageMarkdown(value: string): string {
    return value
        .replace(/\r\n?/gu, '\n')
        .replace(/(^|\n)([ \t]*)([^\n]*)/gu, (_line, boundary: string, indentation: string, content: string) =>
            boundary + indentation + content.replace(/[ \t]+/gu, (spacing: string, offset: number) =>
                offset + spacing.length === content.length && spacing.endsWith('  ') ? '  ' : ' '))
        .replace(/\n{3,}/gu, '\n\n')
        .trim();
}

/** 判断是否应跳过完整 DOM 序列化，改用有界文本采集。 */
export function shouldUseBoundedPageCapture(budget: PageSnapshotBudget): boolean {
    return budget.elements > pageContextLimits.defuddleElements
        || budget.textCharacters > pageContextLimits.defuddleText
        || budget.markupCharacters > pageContextLimits.defuddleMarkup
        || budget.visitedNodes > pageContextLimits.captureNodes;
}

/**
 * 将已经脱离 live DOM 的元数据和可读正文组装为模型参考材料。
 * 页面内容只作为数据；真正的“不执行页面指令”边界由翻译模板再次包裹。
 */
export function buildPageTranslationContext(input: PageTranslationContextInput): string {
    const title = normalizePageText(input.title ?? '');
    const description = normalizePageText(input.description ?? '');
    const readableText = (input.readableText ?? '').slice(0, pageContextLimits.content);
    const sections = [
        title ? `Page title: ${title}` : '',
        description ? `Page description: ${description}` : '',
        readableText ? `Readable page content (Markdown):\n${readableText}` : '',
    ].filter(Boolean);

    return sections.join('\n').slice(0, pageContextLimits.total);
}

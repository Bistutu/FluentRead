/**
 * @file src/features/full-page-translation/content/renderingContainment.ts
 * 文件职责：为长页面上可独立排版的自有双语译文保留精确初始高度，并授权浏览器跳过屏外内容的布局与绘制。
 * 主要内容：先检查工件所有权、页面长度、浏览器支持及普通水平块排版，再从计算样式取得内容高度；写入前后复核几何，复杂富排版、溢出、格式化上下文变化和不可读布局保留原渲染。
 * 模块边界：只同步设置或撤销译文 wrapper 自身的两个 containment 属性和专属标记，不修改原文、宿主样式或 DOM，不创建监听器、观察器和延迟任务；调用方须在保存可信工件快照前完成写入。
 */

const BILINGUAL_WRAPPER_SELECTOR = '.fluent-read-bilingual-content[data-fr-translation-owned="true"]';
const CONTAINED_ATTRIBUTE = 'data-fr-rendering-contained';
const COMPLEX_CONTENT_SELECTOR = [
    'math', 'mjx-container', '[class*="MathJax"]', '[class*="katex"]', '.mwe-math-element', '.ltx_Math',
    'img', 'svg', 'ruby', 'sub', 'sup', 'div', 'table', 'iframe', 'canvas', 'video',
].join(',');
const PAINT_DECORATIONS = ['filter', 'backdrop-filter', 'transform', 'perspective', 'text-shadow', 'box-shadow'];

function pixels(value: string): number {
    return /^(?:\d+(?:\.\d+)?|\.\d+)px$/u.test(value) ? Number.parseFloat(value) : Number.NaN;
}

function geometry(content: HTMLElement): number[] {
    const rect = content.getBoundingClientRect();
    return [rect.x, rect.y, rect.width, rect.height];
}

/** 新 wrapper 只启用一次；已启用的元素不能再以其旧屏外占位尺寸充当真实高度。 */
export function enableBilingualRenderingContainment(content: HTMLElement): boolean {
    try {
        if (!content.matches(BILINGUAL_WRAPPER_SELECTOR) || !content.isConnected ||
            content.getAttribute(CONTAINED_ATTRIBUTE) === 'true') return false;

        const document = content.ownerDocument;
        const view = document.defaultView;
        if (!view || !view.CSS?.supports('content-visibility', 'auto') ||
            !view.CSS.supports('contain-intrinsic-block-size', 'auto 1px')) return false;

        // 短页面不为每个译文读取计算样式；阈值只读取所在文档的默认滚动面。
        const scrollingElement = document.scrollingElement ?? document.documentElement;
        const viewportHeight = view.innerHeight;
        const documentHeight = scrollingElement?.scrollHeight;
        if (!Number.isFinite(viewportHeight) || viewportHeight <= 0 ||
            !Number.isFinite(documentHeight) || documentHeight! < viewportHeight * 4) return false;
        if (content.querySelector(COMPLEX_CONTENT_SELECTOR)) return false;

        const style = view.getComputedStyle(content);
        if (style.display !== 'block' || style.writingMode !== 'horizontal-tb' || style.position !== 'static') return false;
        if (PAINT_DECORATIONS.some((property) => {
            const value = style.getPropertyValue(property);
            return value !== '' && value !== 'none';
        })) return false;
        const visibility = style.getPropertyValue('content-visibility');
        const containment = style.getPropertyValue('contain');
        if ((visibility !== '' && visibility !== 'visible') || (containment !== '' && containment !== 'none')) return false;

        const {clientWidth, clientHeight, scrollWidth, scrollHeight} = content;
        if (![clientWidth, clientHeight, scrollWidth, scrollHeight].every(Number.isFinite) ||
            clientWidth <= 0 || clientHeight <= 0 || scrollWidth > clientWidth || scrollHeight > clientHeight) return false;

        // block-size 是布局像素，避免 getBoundingClientRect 把宿主缩放误算成内容高度。
        let contentHeight = pixels(style.blockSize);
        if (style.boxSizing === 'border-box') {
            contentHeight -= pixels(style.paddingTop) + pixels(style.paddingBottom) +
                pixels(style.borderTopWidth) + pixels(style.borderBottomWidth);
        } else if (style.boxSizing !== 'content-box') return false;
        if (!Number.isFinite(contentHeight) || contentHeight <= 0) return false;

        // auto 会建立独立格式化上下文。宿主浮动等关系只要改变当前盒子，就保守撤销。
        const before = geometry(content);
        if (!before.every(Number.isFinite)) return false;

        content.style.setProperty('contain-intrinsic-block-size', `auto ${contentHeight}px`);
        content.style.setProperty('content-visibility', 'auto');
        content.setAttribute(CONTAINED_ATTRIBUTE, 'true');
        const after = geometry(content);
        if (after.some((value, index) => !Number.isFinite(value) || Math.abs(value - before[index]!) > 0.5)) {
            disableBilingualRenderingContainment(content);
            return false;
        }
        return true;
    } catch {
        // 分离视图、受限样式或正在重建的宿主布局不能阻断译文提交。
        disableBilingualRenderingContainment(content);
        return false;
    }
}

/** 只撤销有本模块标记的自有 wrapper，保留字体与所有其它内联样式及原有节点。 */
export function disableBilingualRenderingContainment(content: HTMLElement): boolean {
    if (!content.matches(BILINGUAL_WRAPPER_SELECTOR) || content.getAttribute(CONTAINED_ATTRIBUTE) !== 'true') return false;
    content.style.removeProperty('content-visibility');
    content.style.removeProperty('contain-intrinsic-block-size');
    content.removeAttribute(CONTAINED_ATTRIBUTE);
    if (!content.getAttribute('style')?.trim()) content.removeAttribute('style');
    return true;
}

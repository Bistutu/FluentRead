/**
 * @file src/features/full-page-translation/content/insideListLayout.ts
 * 文件职责：让原生 inside 列表的前置译文占据序号后的首行，保留卡片盒与原文后续行。
 * 主要内容：插入前有界量取原始首个可见元素片段或文字与列表内容边缘的实际间隔，以源字号维护像素占位；刷新沿用自有 metadata，克隆工件仅接受有限且位于内容栏内的数值，受控复核幂等写入自有样式。
 * 模块边界：不复制序号、不重挂原文、不改宿主样式，不创建观察器；渲染工厂与状态层显式调用，移除译文即撤下全部布局影响。
 */

interface Inset {insetPx: number; sourceFontSize: number}
interface ListContext {style: CSSStyleDeclaration; left: number; right: number; width: number; fontSize: number}
const insets = new WeakMap<HTMLElement, Inset>();
const owned = '.fluent-read-bilingual-content[data-fr-translation-owned="true"]';
const activeAttribute = 'data-fr-inside-list-layout';
const insetAttribute = 'data-fr-inside-list-inset';
const fontAttribute = 'data-fr-inside-list-source-size';

function context(node: HTMLElement): ListContext | null {
    if (node.localName !== 'li') return null;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (!style || style.display !== 'list-item' || style.listStylePosition !== 'inside') return null;
    const box = node.getBoundingClientRect();
    const left = box.left + (Number.parseFloat(style.borderLeftWidth) || 0) + (Number.parseFloat(style.paddingLeft) || 0);
    const right = box.right - (Number.parseFloat(style.borderRightWidth) || 0) - (Number.parseFloat(style.paddingRight) || 0);
    const fontSize = Number.parseFloat(style.fontSize);
    if (![left, right, fontSize].every(Number.isFinite) || right <= left || fontSize <= 0) return null;
    return {style, left, right, width: right - left, fontSize};
}

function validInset(value: Inset, width: number): boolean {
    return Number.isFinite(value.insetPx) && value.insetPx >= 0 && value.insetPx < width
        && Number.isFinite(value.sourceFontSize) && value.sourceFontSize > 0;
}

function clonedInset(content: HTMLElement, width: number): Inset | null {
    const gap = content.getAttribute(insetAttribute), font = content.getAttribute(fontAttribute);
    if (!gap || !font || !/^\d+(?:\.\d+)?$/u.test(gap) || !/^\d+(?:\.\d+)?$/u.test(font)) return null;
    const value = {insetPx: Number(gap), sourceFontSize: Number(font)};
    return validInset(value, width) ? value : null;
}

function firstSourceInset(node: HTMLElement, current: ListContext): Inset | null {
    const walker = node.ownerDocument.createTreeWalker(node, 5);
    let visited = 0, length = 0;
    for (let source = walker.nextNode(); source && visited < 1024 && length < 16_384; source = walker.nextNode()) {
        visited++;
        const element = source.nodeType === 1 ? source as Element : source.parentElement;
        if (element?.closest('[data-fr-translation-owned="true"],.fluent-read-loading,.fluent-read-retry-wrapper')) continue;
        let glyph: DOMRect;
        if (source.nodeType === 1) {
            const first = (source as Element).getClientRects?.()[0];
            if (!first || ![first.width, first.height].every(Number.isFinite) || first.width <= 0 || first.height <= 0) continue;
            glyph = first;
        } else {
            const value = source.nodeValue!.slice(0, 16_384 - length);
            length += value.length;
            const offset = value.search(/\S/u);
            if (offset < 0) continue;
            const range = node.ownerDocument.createRange();
            range.setStart(source, offset);
            range.setEnd(source, offset + 1);
            glyph = range.getBoundingClientRect();
            if (![glyph.width, glyph.height].every(Number.isFinite) || glyph.width <= 0 || glyph.height <= 0) return null;
        }
        const insetPx = current.style.direction === 'rtl' ? current.right - glyph.right : glyph.left - current.left;
        const inset = {insetPx, sourceFontSize: current.fontSize};
        return validInset(inset, current.width) ? inset : null;
    }
    return null;
}

function write(content: HTMLElement, value: Inset): void {
    const styles = {'display': 'inline-block', 'inline-size': `calc(100% - ${value.insetPx}px)`, 'box-sizing': 'border-box', 'vertical-align': 'top', 'text-indent': '0px'};
    for (const [property, text] of Object.entries(styles)) {
        const priority = typeof content.style.getPropertyPriority === 'function' ? content.style.getPropertyPriority(property) : 'important';
        if (content.style.getPropertyValue(property) !== text || priority !== 'important') content.style.setProperty(property, text, 'important');
    }
    for (const [name, text] of [[activeAttribute, 'true'], [insetAttribute, String(value.insetPx)], [fontAttribute, String(value.sourceFontSize)]]) {
        if (content.getAttribute(name!) !== text) content.setAttribute(name!, text!);
    }
}

function scaled(value: Inset, current: ListContext): Inset | null {
    const next = {insetPx: Math.round(value.insetPx * current.fontSize / value.sourceFontSize * 1_000_000) / 1_000_000, sourceFontSize: current.fontSize};
    return validInset(next, current.width) ? next : null;
}

/** 工厂在插入前调用：没有旧译文时重新量原生序号，不能复用上一次已恢复的占位。 */
export function prepareInsideListTranslation(node: HTMLElement, content: HTMLElement, beforeOriginal: boolean): void {
    if (!beforeOriginal || !content.matches(owned)) return;
    try {
        const current = context(node);
        if (!current) return;
        const previous = Array.from(node.children).slice(0, 256).find(child => child.matches(owned));
        const active = previous?.getAttribute(activeAttribute) === 'true';
        const old = active ? insets.get(node) ?? clonedInset(previous as HTMLElement, current.width) : null;
        if (active && !old) return;
        const value = old ? scaled(old, current) : firstSourceInset(node, current);
        if (!value) return;
        insets.set(node, value);
        write(content, value);
    } catch {
        // 无布局能力或原文同步离开时沿用普通译文，不猜测序号文字或额外复制 marker。
    }
}

/** 状态层在字号或窗口复核时调用；只更新已经启用该布局的当前工件。 */
export function alignInsideListTranslation(node: HTMLElement, content: HTMLElement): void {
    if (!content.matches(owned) || content.getAttribute(activeAttribute) !== 'true') return;
    try {
        const current = context(node);
        if (!current) return;
        const old = insets.get(node) ?? clonedInset(content, current.width);
        const value = old && scaled(old, current);
        if (!value) return;
        insets.set(node, value);
        write(content, value);
    } catch {
        // 不可观测的几何不影响已经可见的译文。
    }
}

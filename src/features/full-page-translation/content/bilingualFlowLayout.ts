/**
 * @file src/features/full-page-translation/content/bilingualFlowLayout.ts
 * 文件职责：阻止双语译文参与宿主的固有行宽计算，保留表格、行内块和浮动正文的原有栏宽。
 * 主要内容：跨开放 ShadowRoot 有界检查正文及祖先的 shrink-to-fit 上下文，仅隔离自有译文的 inline-size；气泡预设改用可用行宽，避免 fit-content 在尺寸隔离下收缩为零。
 * 模块边界：只写入可随译文移除的自有样式，不改动宿主或原文，不保存像素宽度，不创建监听器；append 与 refresh 的渲染工厂共用本入口。
 */

import {getComposedParent} from '@/src/core/translation/dom';

const intrinsicDisplays = new Set(['inline-block', 'inline-flex', 'inline-grid', 'inline-table']);
const floats = new Set(['left', 'right', 'inline-start', 'inline-end']);
const ownedSelector = '.fluent-read-bilingual-content[data-fr-translation-owned="true"]';

/** 只隔离行内固有尺寸，块方向仍按真实译文自然增高；窗口变窄时由浏览器重新排版。 */
export function prepareBilingualFlowLayout(node: HTMLElement, content: HTMLElement): void {
    if (!content.matches(ownedSelector)) return;
    const view = node.ownerDocument.defaultView;
    if (!view) return;
    try {
        let intrinsic = false;
        const visited = new Set<Element>();
        for (let current: Element | null = node, depth = 0; current && depth < 32 && !visited.has(current); current = getComposedParent(current), depth++) {
            visited.add(current);
            const style = view.getComputedStyle(current);
            const table = style.display === 'table-cell' ? current.closest('table') : null;
            if (intrinsicDisplays.has(style.display) || floats.has(style.cssFloat) ||
                (style.display === 'table-cell' && (!table || view.getComputedStyle(table).tableLayout !== 'fixed'))) {
                intrinsic = true;
                break;
            }
        }
        if (!intrinsic) return;
        content.style.setProperty('contain', 'inline-size', 'important');
        // fit-content 的固有宽度在 inline-size containment 下为零；气泡仍占宿主正文可用行宽。
        if (content.classList.contains('fluent-display-chat-bubble')) content.style.setProperty('inline-size', 'auto', 'important');
    } catch {
        // 脱离文档或受限样式环境不影响译文提交，也不通过猜测宽度改写宿主。
    }
}

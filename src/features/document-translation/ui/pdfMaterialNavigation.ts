/**
 * @file src/features/document-translation/ui/pdfMaterialNavigation.ts
 * 文件职责：为 PDF 材料续读提供可取消的精确段落恢复和由阅读器拥有的选区到模型映射。
 * 主要内容：采集实际可见段落、等待目标页与两次稳定段落布局，拒绝过期文档、切换、卸载和歧义几何；源文字层按原页字形位置映射，译文按当前模型片段标记映射。
 * 模块边界：不保存材料、不读取文件或配置、不从译文重建原文；DOM/渲染时序由阅读器通过端口提供，调用方将模型索引转成稳定文件引用。
 */
import type {ParsedDocument, PdfDocumentBlock, PdfDocumentPage} from '../core/document';
import {pdfReaderDisplayRect} from './pdfReader';

export const PDF_MATERIAL_MAX_LAYOUT_ATTEMPTS = 12;
export const PDF_MATERIAL_FRAME_WAIT_MS = 750;

export interface PdfMaterialLocation {segmentIndex: number; page: PdfDocumentPage; block: PdfDocumentBlock}
export function pdfMaterialLocation(document: ParsedDocument, segmentIndex: number): PdfMaterialLocation | undefined {
    if (!Number.isSafeInteger(segmentIndex) || segmentIndex < 0 || !document.segments[segmentIndex] || document.binary?.kind !== 'pdf') return;
    const matches = document.binary.pages.flatMap(page => page.blocks.filter(block => block.segmentIndex === segmentIndex).map(block => ({segmentIndex, page, block})));
    return matches.length === 1 ? matches[0] : undefined;
}

export interface PdfMaterialNavigationPorts {
    document(): ParsedDocument;
    active(): boolean;
    mode(): string;
    resumePage(page: number): Promise<void>;
    nextTick(): Promise<unknown>;
    nextFrame(signal: AbortSignal): Promise<boolean>;
    prepare(): void;
    align(location: PdfMaterialLocation): {position: number; visible: boolean} | undefined;
    landed(location: PdfMaterialLocation): void;
}

/** 恢复最多 12 次布局尝试，每次帧等待最多 750 ms；计时器获执行机会时总等待不超过 9 s。新请求、用户导航、文档替换及卸载都撤销旧请求。 */
export function createPdfMaterialNavigation(ports: PdfMaterialNavigationPorts) {
    let controller: AbortController | undefined, disposed = false;
    const cancel = () => {controller?.abort(); controller = undefined;};
    return {
        cancel,
        dispose() {disposed = true; cancel();},
        async resumeLocation(segmentIndex: number): Promise<boolean> {
            cancel();
            if (disposed || !ports.active()) return false;
            const document = ports.document(), mode = ports.mode(), location = pdfMaterialLocation(document, segmentIndex);
            if (!location) return false;
            const operation = new AbortController(); controller = operation;
            const current = () => !disposed && !operation.signal.aborted && ports.active() && ports.document() === document && ports.mode() === mode;
            try {
                await ports.resumePage(location.page.pageNumber);
                if (!current()) return false;
                let previous: number | undefined;
                for (let attempt = 0; attempt < PDF_MATERIAL_MAX_LAYOUT_ATTEMPTS; attempt++) {
                    await ports.nextTick(); if (!current()) return false;
                    ports.prepare();
                    await ports.nextTick(); if (!current()) return false;
                    const placement = ports.align(location);
                    if (placement?.visible && Number.isFinite(placement.position)) {
                        if (previous !== undefined && Math.abs(previous - placement.position) < 0.5) {ports.landed(location); return true;}
                        previous = placement.position;
                    } else previous = undefined;
                    if (!await ports.nextFrame(operation.signal) || !current()) return false;
                }
                return false;
            } catch {
                // 卸载、渲染端失败均保留材料定位，由组合根显示可重试状态。
            } finally {if (controller === operation) controller = undefined;}
            return false;
        },
    };
}

/** 暂停的动画帧最多等待 750 ms 定时器机会；冻结标签恢复执行后也会结束等待，取消/卸载立即清理所有句柄。 */
export function waitPdfMaterialFrame(view: Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
        let frame = 0, settled = false;
        let timer: ReturnType<typeof setTimeout>;
        const done = (value: boolean) => {
            if (settled) return;
            settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); view.cancelAnimationFrame(frame); resolve(value);
        };
        const abort = () => done(false);
        signal.addEventListener('abort', abort, {once: true});
        timer = setTimeout(() => done(false), PDF_MATERIAL_FRAME_WAIT_MS);
        frame = view.requestAnimationFrame(() => done(true));
    });
}

export interface PdfMaterialSelectionPorts {
    document: ParsedDocument;
    renderedDocument: ParsedDocument;
    identity: string;
    viewport: HTMLElement;
    sourceHosts: ReadonlyMap<number, HTMLElement>;
}
const PROTECTED = 'button,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[data-fluentread-pdf-decoration],[hidden],[inert],[aria-hidden="true"]';
const elementFor = (node: Node) => node.nodeType === 1 ? node as Element : node.parentElement;

/** 只返回当前模型索引；相同文字绝不参与身份推断，源字形几何重叠时拒绝。 */
export function resolvePdfMaterialSelection(range: Range, ports: PdfMaterialSelectionPorts): number | undefined {
    const {document, renderedDocument, identity, viewport} = ports;
    if (document !== renderedDocument || !viewport.isConnected || !range.startContainer.isConnected || !range.endContainer.isConnected
        || !viewport.contains(range.startContainer) || !viewport.contains(range.endContainer) || range.collapsed) return;
    if (viewport.closest('[data-fluentread-pdf-document-id]')?.getAttribute('data-fluentread-pdf-document-id') !== identity) return;
    const start = elementFor(range.startContainer), end = elementFor(range.endContainer);
    if (!start || !end || start.closest(PROTECTED) || end.closest(PROTECTED)) return;
    const selectable = (element: Element) => Boolean(element.closest('[data-fluentread-pdf-text],.pdf-reading-paragraph[data-pdf-segment-index],.pdf-translation-block[data-pdf-segment-index]'));
    if (!selectable(start) || !selectable(end)) return;
    const tagged = start.closest<HTMLElement>('[data-pdf-segment-index]');
    if (tagged) {
        const value = tagged.getAttribute('data-pdf-segment-index');
        if (!value || !/^\d+$/u.test(value)) return;
        const index = Number(value), location = pdfMaterialLocation(document, index);
        const pageNumber = Number(tagged.closest('[data-page-number]')?.getAttribute('data-page-number'));
        if (!location || pageNumber !== location.page.pageNumber || tagged.getAttribute('data-pdf-source-text') !== document.segments[index].source) return;
        return index;
    }
    const layer = start.closest<HTMLElement>('[data-fluentread-pdf-text]');
    const pageNumber = Number(layer?.getAttribute('data-pdf-page-number'));
    const page = document.binary?.kind === 'pdf' ? document.binary.pages.find(page => page.pageNumber === pageNumber) : undefined;
    const host = ports.sourceHosts.get(pageNumber);
    if (!page || !host || !layer || !host.contains(layer) || !host.isConnected) return;
    const bounds = host.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    let rect: DOMRect | undefined;
    for (const entry of Array.from(range.getClientRects()).slice(0, 128)) {
        if (entry.width > 0 && entry.height > 0 && entry.left < bounds.right && entry.right > bounds.left && entry.top < bounds.bottom && entry.bottom > bounds.top) {rect = entry; break;}
    }
    if (!rect) return;
    const x = ((rect.left + rect.right) / 2 - bounds.left) * page.width / bounds.width;
    const y = ((rect.top + rect.bottom) / 2 - bounds.top) * page.height / bounds.height;
    const matches = page.blocks.filter(block => block.segmentIndex >= 0 && document.segments[block.segmentIndex]
        && (block.lines?.length ? block.lines : [block]).some(line => {
            const box = pdfReaderDisplayRect(line, page);
            return Number.isFinite(box.x) && Number.isFinite(box.y) && box.width > 0 && box.height > 0
                && x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
        }));
    const indexes = [...new Set(matches.map(block => block.segmentIndex))];
    return indexes.length === 1 && pdfMaterialLocation(document, indexes[0]) ? indexes[0] : undefined;
}

export interface PdfVisibleMaterialPorts extends PdfMaterialSelectionPorts {
    mode: 'source' | 'bilingual' | 'translated';
    readable: boolean;
    /** 复用阅读器已有的最多五个常驻页面，不建立另一套页码/段落状态。 */
    residentPages: readonly PdfDocumentPage[];
    translatedHosts: ReadonlyMap<number, HTMLElement>;
    readingHosts: ReadonlyMap<number, HTMLElement>;
    readyPages: ReadonlySet<number>;
}

/** 读取当前真实视口阅读线所在段落；未布局、隐藏、尚未渲染或模型不一致时没有可保存的位置。 */
export function captureVisiblePdfMaterialLocation(ports: PdfVisibleMaterialPorts): number | undefined {
    const {document, renderedDocument, viewport} = ports;
    if (document !== renderedDocument || document.binary?.kind !== 'pdf' || ports.residentPages.length > 5
        || viewport.closest('[data-fluentread-pdf-document-id]')?.getAttribute('data-fluentread-pdf-document-id') !== ports.identity) return;
    const visible = (element: HTMLElement) => {
        if (!element.isConnected || element !== viewport && !viewport.contains(element) || element.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
        if (typeof element.checkVisibility === 'function' && !element.checkVisibility({checkVisibilityCSS: true})) return false;
        const style = element.ownerDocument.defaultView?.getComputedStyle?.(element);
        return style?.display !== 'none' && style?.visibility !== 'hidden' && style?.visibility !== 'collapse';
    };
    if (!visible(viewport)) return;
    const bounds = viewport.getBoundingClientRect();
    if (![bounds.top, bounds.left, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || viewport.clientHeight <= 0) return;
    const bottom = Math.min(bounds.bottom, bounds.top + viewport.clientHeight);
    const line = bounds.top + Math.min(80, viewport.clientHeight / 4);
    const intersects = (box: {left: number; top: number; right: number; bottom: number; width: number; height: number}) =>
        [box.left, box.top, box.right, box.bottom, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0
        && box.right > bounds.left && box.left < bounds.right && box.bottom > bounds.top && box.top < bottom;
    type Candidate = {index: number; distance: number; left: number};
    const candidates: Candidate[] = [];
    const add = (index: number, box: {left: number; top: number; right: number; bottom: number; width: number; height: number}) => {
        if (!intersects(box)) return;
        candidates.push({index, distance: line < box.top ? box.top - line : line > box.bottom ? line - box.bottom : 0, left: Math.max(bounds.left, box.left)});
    };
    let visited = 0;
    const budget = 8000;
    if (ports.readable && ports.mode !== 'source') {
        for (const page of ports.residentPages) {
            const host = ports.readingHosts.get(page.pageNumber);
            if (!host || !visible(host) || !intersects(host.getBoundingClientRect())) continue;
            for (const element of host.querySelectorAll<HTMLElement>('.pdf-reading-paragraph[data-pdf-segment-index]')) {
                if (++visited > budget) return;
                const value = element.getAttribute('data-pdf-segment-index');
                if (!value || !/^\d+$/u.test(value)) continue;
                const index = Number(value);
                if (!document.segments[index] || !page.blocks.some(block => block.segmentIndex === index)
                    || element.getAttribute('data-pdf-source-text') !== document.segments[index].source) continue;
                const box = element.getBoundingClientRect();
                if (intersects(box) && visible(element)) add(index, box);
            }
        }
    }
    // 重排译文有可见段落时使用它；窄屏双语仍停在原页栏时使用实际可见原页。
    if (!candidates.length) {
        const maps = ports.mode === 'source' || ports.readable && ports.mode === 'bilingual' ? [ports.sourceHosts]
            : ports.mode === 'translated' ? ports.readable ? [] : [ports.translatedHosts] : [ports.sourceHosts, ports.translatedHosts];
        for (const page of ports.residentPages) {
            if (!ports.readyPages.has(page.pageNumber)) continue;
            for (const hosts of maps) {
                const host = hosts.get(page.pageNumber);
                if (!host || !host.firstElementChild || !visible(host)) continue;
                const box = host.getBoundingClientRect();
                if (!intersects(box) || page.width <= 0 || page.height <= 0) continue;
                const horizontal = box.width / page.width, vertical = box.height / page.height;
                for (const block of page.blocks) {
                    if (++visited > budget) return;
                    if (block.segmentIndex < 0 || !document.segments[block.segmentIndex]) continue;
                    const displayed = pdfReaderDisplayRect(block, page);
                    const left = box.left + displayed.x * horizontal, top = box.top + displayed.y * vertical;
                    const width = displayed.width * horizontal, height = displayed.height * vertical;
                    add(block.segmentIndex, {left, top, width, height, right: left + width, bottom: top + height});
                }
            }
        }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.left - b.left);
    const first = candidates[0];
    if (!first || candidates.some(other => other.index !== first.index && Math.abs(other.distance - first.distance) < 0.5 && Math.abs(other.left - first.left) < 0.5)) return;
    return pdfMaterialLocation(document, first.index) ? first.index : undefined;
}

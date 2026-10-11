/**
 * @file src/features/document-translation/core/pdfReadingRegions.ts
 * 文件职责：在可读 PDF 计划中把同一数学式、编号和图表的原像素保留为完整区域。
 * 主要内容：定义共用的文字与原图条目；复用已保留区域与逐行几何，按局部间距合并数学组件，每次扩张检查正文和栏间距；条件需逐行基线对应，细路径只扩展既有数学组；仅移动图片的插入点，文字对象、字符及相互顺序不变。
 * 模块边界：纯数据转换，不解析 PDF、不重建公式、不调用字体、DOM、Canvas、翻译或文件 I/O。
 */
import type {PdfDocumentBlock, PdfDocumentPage} from './document';

export interface PdfReadingRect {x: number; y: number; width: number; height: number}
export interface PdfReadingTextEntry {
    kind: 'text';
    id: string;
    pageNumber: number;
    segmentIndex: number;
    role: string;
    source: string;
    text: string;
    translated: boolean;
    sourceRect: PdfReadingRect;
}
export interface PdfReadingRegionEntry {
    kind: 'region';
    id: string;
    pageNumber: number;
    role: string;
    sourceRect: PdfReadingRect;
    segmentIndexes: number[];
}
export type PdfReadingEntry = PdfReadingTextEntry | PdfReadingRegionEntry;

interface Component {
    entry: PdfReadingRegionEntry;
    rect: PdfReadingRect;
    blocks: PdfDocumentBlock[];
    mathBlocks: PdfDocumentBlock[];
    font: number;
    math: boolean;
    mathOnly: boolean;
    marker: boolean;
    position: number;
}
const right = (rect: PdfReadingRect) => rect.x + rect.width;
const bottom = (rect: PdfReadingRect) => rect.y + rect.height;
const valid = (rect: PdfReadingRect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
const contains = (a: PdfReadingRect, b: PdfReadingRect) => b.x >= a.x - 1 && b.y >= a.y - 1 && right(b) <= right(a) + 1 && bottom(b) <= bottom(a) + 1;
const overlaps = (a: PdfReadingRect, b: PdfReadingRect) => Math.min(right(a), right(b)) > Math.max(a.x, b.x) && Math.min(bottom(a), bottom(b)) > Math.max(a.y, b.y);
const union = (a: PdfReadingRect, b: PdfReadingRect): PdfReadingRect => ({x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(right(a), right(b)) - Math.min(a.x, b.x), height: Math.max(bottom(a), bottom(b)) - Math.min(a.y, b.y)});
const gap = (a: PdfReadingRect, b: PdfReadingRect) => ({x: Math.max(a.x - right(b), b.x - right(a), 0), y: Math.max(a.y - bottom(b), b.y - bottom(a), 0)});
const containerRole = (role: string) => role === 'figure-label' ? 'figure' : role;
const fontSize = (blocks: readonly PdfDocumentBlock[]) => {
    const sizes = blocks.map(block => block.fontSize).filter(size => Number.isFinite(size) && size > 0).sort((a, b) => a - b);
    return sizes[Math.floor(sizes.length / 2)] ?? 11;
};
// 行几何不完整时保守采用已验证的块框，不能把无效行当作不存在的正文。
const sourceLines = (block: PdfDocumentBlock) => block.lines?.length && block.lines.every(valid) ? block.lines : [block];
function terminalBlock(block: PdfDocumentBlock): boolean {
    const font = fontSize([block]);
    return block.kind === 'formula' && block.lineCount === 1 && block.height <= font * 2 && block.width <= font * 4
        && /^(?:\([\p{L}\p{N}]+(?:[.\-][\p{L}\p{N}]+)*\)|□)$/u.test((block.lines ?? []).map(line => line.text).join(' ').trim());
}

/** 源条件必须逐行与数学内容对应，单凭小尺寸或内含不能把普通正文算成公式。 */
function internalCondition(block: PdfDocumentBlock, rect: PdfReadingRect, math: readonly PdfDocumentBlock[]): boolean {
    if (block.kind !== 'text' || !block.lines?.length || !contains(rect, block) || !math.length) return false;
    const bounds = math.slice(1).reduce<PdfReadingRect>((a, b) => union(a, b), math[0]);
    const font = fontSize(math);
    if (block.x < bounds.x + font || block.y < bounds.y - 1 || bottom(block) > bottom(bounds) + 1) return false;
    const baselines = math.flatMap(item => item.lines ?? []).filter(valid).map(line => line.baseline).filter(Number.isFinite) as number[];
    return block.lines.every(line => valid(line) && Number.isFinite(line.baseline) && baselines.some(baseline => Math.abs(baseline - line.baseline!) <= font * .35));
}

function combined(a: Component, b: Component): Component {
    return {...a, rect: union(a.rect, b.rect), blocks: [...new Set([...a.blocks, ...b.blocks])], mathBlocks: [...new Set([...a.mathBlocks, ...b.mathBlocks])],
        font: Math.max(a.font, b.font), math: a.math || b.math, mathOnly: a.mathOnly && b.mathOnly, marker: false, position: Math.min(a.position, b.position),
        entry: {...a.entry, segmentIndexes: [...new Set([...a.entry.segmentIndexes, ...b.entry.segmentIndexes])]}};
}

/** 输入文字先由原计划确定；新增图片 hull 不参与文字删除或译文改写。 */
export function groupPdfReadingRegions(page: PdfDocumentPage, entries: readonly PdfReadingEntry[], sourceControlIndexes: ReadonlySet<number>): PdfReadingEntry[] {
    const texts = entries.filter((entry): entry is PdfReadingTextEntry => entry.kind === 'text');
    const textIndexes = new Set(texts.map(entry => entry.segmentIndex));
    const blocks = page.blocks.filter(valid);
    const terminalBlocks = new Set(blocks.filter(terminalBlock));
    const textBlocks = blocks.filter(block => textIndexes.has(block.segmentIndex));
    const isMath = (block: PdfDocumentBlock) => block.kind === 'formula' || sourceControlIndexes.has(block.segmentIndex);
    const prose = textBlocks.filter(block => block.kind === 'text' && block.width >= block.fontSize * 8 && (block.lineCount >= 2 || (block.lines ?? []).reduce((sum, line) => sum + line.text.length, 0) >= 60));
    let components: Component[] = entries.flatMap((entry, position) => {
        if (entry.kind !== 'region') return [];
        const linked = valid(entry.sourceRect) ? blocks.filter(block => contains(entry.sourceRect, block)) : [];
        const mathBlocks = linked.filter(block => isMath(block) && !terminalBlocks.has(block)), font = fontSize(linked);
        // 原裁剪框可能比字形宽；只含终末字块的区域仍不具备连接两个主体的数学证据。
        const marker = linked.length > 0 && linked.every(block => terminalBlocks.has(block));
        // 附加的式号基线不构成式内条件的证据；条件必须对应已存在的数学主体。
        return [{entry, rect: {...entry.sourceRect}, blocks: linked, mathBlocks: marker ? [] : mathBlocks, font, math: entry.role === 'formula',
            mathOnly: entry.role === 'formula' || linked.some(block => sourceControlIndexes.has(block.segmentIndex)), marker, position}];
    });
    // 只有两栏正文在同一纵带实际并存时，空白带才限制数学组；数学碎块自己的 column 不是正文栏。
    const gutters: PdfReadingRect[] = [];
    for (let index = 0; index < prose.length; index += 1) for (const other of prose.slice(index + 1)) {
        const first = prose[index], left = first.x < other.x ? first : other, next = first.x < other.x ? other : first;
        const width = next.x - right(left), y = Math.max(first.y, other.y), height = Math.min(bottom(first), bottom(other)) - y;
        if (width >= Math.max(first.fontSize, other.fontSize) * 1.5 && height > Math.max(first.fontSize, other.fontSize) * 2) gutters.push({x: right(left), y, width, height});
    }
    // 前后均有同一栏间空白带的正文支持时，段落间的公式带仍属于这两栏；只延续两证据之间，不向页边猜测。
    const supportedGutters = [...gutters];
    for (let index = 0; index < supportedGutters.length; index += 1) for (const other of supportedGutters.slice(index + 1)) {
        const first = supportedGutters[index], x = Math.max(first.x, other.x), end = Math.min(right(first), right(other));
        if (end - x >= Math.min(first.width, other.width) * .8) gutters.push({x, y: Math.min(first.y, other.y), width: end - x, height: Math.max(bottom(first), bottom(other)) - Math.min(first.y, other.y)});
    }
    const blocked = (rect: PdfReadingRect, owned: readonly PdfReadingRect[], math: readonly PdfDocumentBlock[]) => {
        if (gutters.some(gutter => rect.x < gutter.x && right(rect) > right(gutter) && overlaps(rect, gutter))) return true;
        return textBlocks.some(block => !owned.some(part => contains(part, block)) && !internalCondition(block, rect, math)
            && sourceLines(block).some(line => overlaps(rect, line)));
    };
    let changed = true;
    while (changed) {
        changed = false;
        outer: for (let index = 0; index < components.length; index += 1) for (let next = index + 1; next < components.length; next += 1) {
            const a = components[index], b = components[next];
            if (!valid(a.rect) || !valid(b.rect) || a.marker || b.marker) continue;
            if (!a.math && !b.math && ![containerRole(a.entry.role), containerRole(b.entry.role)].some(role => role === 'figure' || role === 'table')) continue;
            const distance = gap(a.rect, b.rect), font = Math.max(a.font, b.font);
            const contained = contains(a.rect, b.rect) || contains(b.rect, a.rect);
            const sameContainer = containerRole(a.entry.role) === containerRole(b.entry.role) && overlaps(a.rect, b.rect);
            const adjacentMath = a.mathOnly && b.mathOnly && (a.math || b.math) && distance.x <= font * 3 && distance.y <= font * 2.2;
            if (!contained && !sameContainer && !adjacentMath) continue;
            const candidate = combined(a, b);
            if (blocked(candidate.rect, [a.rect, b.rect], candidate.mathBlocks)) continue;
            components[index] = candidate; components.splice(next, 1); changed = true; break outer;
        }
    }
    // 式号与证明终止符仅附到最近的一个主体，永远不充当两个主体之间的连接种子。
    for (const marker of components.filter(component => component.marker)) {
        const candidates = components.filter(component => component !== marker && component.math && !component.marker && valid(component.rect)
            && component.rect.x < marker.rect.x && Math.min(bottom(component.rect), bottom(marker.rect)) > Math.max(component.rect.y, marker.rect.y))
            .sort((a, b) => gap(a.rect, marker.rect).x - gap(b.rect, marker.rect).x);
        for (const component of candidates) {
            const candidate = combined(component, marker);
            if (blocked(candidate.rect, [component.rect, marker.rect], candidate.mathBlocks)) continue;
            components[components.indexOf(component)] = candidate; components = components.filter(item => item !== marker); break;
        }
    }
    const rotated = page.rotation === 90 || page.rotation === 270;
    const width = rotated ? page.height : page.width, height = rotated ? page.width : page.height;
    const slots = new Map<number, Component[]>();
    for (const component of components) {
        if (valid(component.rect)) {
            const original = {...component.rect}, padding = Math.min(4, component.font * .35);
            if (component.math && component.mathBlocks.length >= 2) for (const shape of page.layoutBoundaries ?? []) {
                if (![shape.x, shape.y, shape.width, shape.height].every(Number.isFinite) || shape.width < 0 || shape.height < 0 || !(shape.width > 0 || shape.height > 0)) continue;
                const distance = gap(original, shape);
                if (distance.x > padding || distance.y > padding || shape.x < original.x - padding || right(shape) > right(original) + padding
                    || shape.y < original.y - padding || bottom(shape) > bottom(original) + padding) continue;
                const candidate = union(component.rect, shape);
                if (!blocked(candidate, [component.rect], component.mathBlocks)) component.rect = candidate;
            }
            if (component.math || component.entry.role === 'figure-label') {
                let x = Math.max(0, component.rect.x - padding), y = Math.max(0, component.rect.y - padding);
                let endX = Math.min(width, right(component.rect) + padding), endY = Math.min(height, bottom(component.rect) + padding);
                for (const block of textBlocks) {
                    if (contains(component.rect, block) || internalCondition(block, component.rect, component.mathBlocks)) continue;
                    for (const line of sourceLines(block)) {
                        if (line.x < endX && right(line) > x) {
                            if (bottom(line) <= component.rect.y) y = Math.max(y, (bottom(line) + component.rect.y) / 2);
                            if (line.y >= bottom(component.rect)) endY = Math.min(endY, (line.y + bottom(component.rect)) / 2);
                        }
                        if (line.y < endY && bottom(line) > y) {
                            if (right(line) <= component.rect.x) x = Math.max(x, (right(line) + component.rect.x) / 2);
                            if (line.x >= right(component.rect)) endX = Math.min(endX, (line.x + right(component.rect)) / 2);
                        }
                    }
                }
                const candidate = {x, y, width: endX - x, height: endY - y};
                if (valid(candidate) && !blocked(candidate, [component.rect], component.mathBlocks)) component.rect = candidate;
            }
        }
        const inside = new Set(textBlocks.filter(block => internalCondition(block, component.rect, component.mathBlocks)).map(block => block.segmentIndex));
        component.entry = {...component.entry, segmentIndexes: [...new Set([...component.entry.segmentIndexes, ...inside])]};
        const corridor = prose.filter(block => !inside.has(block.segmentIndex) && Math.min(right(block), right(component.rect)) > Math.max(block.x, component.rect.x))
            .sort((a, b) => gap(a, component.rect).y - gap(b, component.rect).y)[0];
        const anchor = texts.findIndex(entry => inside.has(entry.segmentIndex) || (corridor && entry.sourceRect.y >= bottom(component.rect) - 1
            && entry.sourceRect.x + entry.sourceRect.width / 2 >= corridor.x - 1 && entry.sourceRect.x + entry.sourceRect.width / 2 <= right(corridor) + 1));
        const slot = valid(component.rect) && anchor >= 0 ? anchor : entries.slice(0, component.position).filter(entry => entry.kind === 'text').length;
        const bucket = slots.get(slot) ?? []; bucket.push(component); slots.set(slot, bucket);
    }
    const result: PdfReadingEntry[] = [];
    for (let slot = 0; slot <= texts.length; slot += 1) {
        for (const component of (slots.get(slot) ?? []).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.position - b.position)) result.push({...component.entry, sourceRect: component.rect});
        if (slot < texts.length) result.push(texts[slot]);
    }
    return result;
}

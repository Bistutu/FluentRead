export interface AreaPoint {
    x: number;
    y: number;
}

export interface AreaRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface AreaTranslationSelection extends AreaRect {
    viewportWidth: number;
    viewportHeight: number;
}

export interface ImageCropRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

interface AreaKeyboardEvent {
    code: string;
    key: string;
    shiftKey: boolean;
}

function finiteOrZero(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function isAreaZKey(event: Pick<AreaKeyboardEvent, 'code' | 'key'>): boolean {
    return event.code === 'KeyZ' || (event.key.length === 1 && event.key.toLowerCase() === 'z');
}

/** 圈选翻译使用 Shift+Z，避免单独输入 z 时意外开始截图。 */
export function isAreaHotkey(event: AreaKeyboardEvent): boolean {
    return event.shiftKey === true && isAreaZKey(event);
}

/** 将拖拽起点和终点规范化为不超出视口的矩形。 */
export function normalizeAreaRect(start: AreaPoint, end: AreaPoint, viewport: { width: number; height: number }): AreaRect {
    const viewportWidth = Math.max(1, finiteOrZero(viewport.width));
    const viewportHeight = Math.max(1, finiteOrZero(viewport.height));
    const startX = finiteOrZero(start.x);
    const startY = finiteOrZero(start.y);
    const endX = finiteOrZero(end.x);
    const endY = finiteOrZero(end.y);
    const left = clamp(Math.min(startX, endX), 0, viewportWidth);
    const top = clamp(Math.min(startY, endY), 0, viewportHeight);
    const right = clamp(Math.max(startX, endX), 0, viewportWidth);
    const bottom = clamp(Math.max(startY, endY), 0, viewportHeight);

    return {
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
    };
}

export function isUsableAreaRect(rect: AreaRect, minimumSize = 12): boolean {
    return Number.isFinite(rect.left)
        && Number.isFinite(rect.top)
        && Number.isFinite(rect.width)
        && Number.isFinite(rect.height)
        && rect.width >= minimumSize
        && rect.height >= minimumSize;
}

/** 将 CSS 视口坐标映射到 captureVisibleTab 返回的像素坐标。 */
export function areaRectToImageCrop(
    selection: AreaTranslationSelection,
    imageWidth: number,
    imageHeight: number,
): ImageCropRect {
    const sourceWidth = Math.max(1, Math.floor(imageWidth));
    const sourceHeight = Math.max(1, Math.floor(imageHeight));
    const viewportWidth = Math.max(1, finiteOrZero(selection.viewportWidth));
    const viewportHeight = Math.max(1, finiteOrZero(selection.viewportHeight));
    const scaleX = sourceWidth / viewportWidth;
    const scaleY = sourceHeight / viewportHeight;
    const left = clamp(Math.floor(selection.left * scaleX), 0, sourceWidth - 1);
    const top = clamp(Math.floor(selection.top * scaleY), 0, sourceHeight - 1);
    const right = clamp(Math.ceil((selection.left + selection.width) * scaleX), left + 1, sourceWidth);
    const bottom = clamp(Math.ceil((selection.top + selection.height) * scaleY), top + 1, sourceHeight);

    return {
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
    };
}

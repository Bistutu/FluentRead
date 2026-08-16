import type { OcrLine } from '@/entrypoints/utils/imageTranslationCore';

interface PixelPoint {
    x: number;
    y: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function pixelOffset(x: number, y: number, width: number): number {
    return (y * width + x) * 4;
}

function addMaskRectangle(
    mask: Uint8Array,
    width: number,
    height: number,
    line: OcrLine,
): void {
    const lineWidth = Math.max(1, line.bbox.x1 - line.bbox.x0);
    const lineHeight = Math.max(1, line.bbox.y1 - line.bbox.y0);
    // OCR 的框通常只包住字形，额外留出少量边缘可以避免原文字的抗锯齿残影。
    const paddingX = Math.max(2, Math.round(lineHeight * 0.18));
    const paddingY = Math.max(2, Math.round(lineHeight * 0.24));
    const left = clamp(Math.floor(line.bbox.x0 - paddingX), 0, width - 1);
    const top = clamp(Math.floor(line.bbox.y0 - paddingY), 0, height - 1);
    const right = clamp(Math.ceil(line.bbox.x1 + paddingX), left + 1, width);
    const bottom = clamp(Math.ceil(line.bbox.y1 + paddingY), top + 1, height);

    // 极窄的 OCR 框容易只覆盖到字符中间，按最小尺寸扩大一点，但不越过图片边界。
    const minimumWidth = Math.min(width, Math.max(right - left, Math.ceil(lineWidth * 1.08)));
    const minimumHeight = Math.min(height, Math.max(bottom - top, Math.ceil(lineHeight * 1.12)));
    const expandedLeft = clamp(Math.floor((left + right - minimumWidth) / 2), 0, width - minimumWidth);
    const expandedTop = clamp(Math.floor((top + bottom - minimumHeight) / 2), 0, height - minimumHeight);
    for (let y = expandedTop; y < expandedTop + minimumHeight; y += 1) {
        const row = y * width;
        for (let x = expandedLeft; x < expandedLeft + minimumWidth; x += 1) {
            mask[row + x] = 1;
        }
    }
}

function getNeighbours(x: number, y: number, width: number, height: number): PixelPoint[] {
    const points: PixelPoint[] = [];
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const neighbourX = x + dx;
            const neighbourY = y + dy;
            if (neighbourX >= 0 && neighbourX < width && neighbourY >= 0 && neighbourY < height) {
                points.push({ x: neighbourX, y: neighbourY });
            }
        }
    }
    return points;
}

/**
 * 使用局部边界扩散修复 OCR 区域。
 *
 * 这不是 AI inpainting，而是一个无依赖、可在 MV3 CSP 下运行的轻量兜底：
 * 每一层未知像素从周围已知像素插值，能保留纯色和渐变背景，避免整块纯色
 * 矩形直接盖在原图上。复杂纹理仍应交给可选的 ONNX/服务端修复器。
 */
export function inpaintTextRegions(
    source: Uint8ClampedArray,
    width: number,
    height: number,
    lines: OcrLine[],
): Uint8ClampedArray {
    if (width <= 0 || height <= 0 || source.length < width * height * 4 || lines.length === 0) {
        return new Uint8ClampedArray(source);
    }

    const result = new Uint8ClampedArray(source);
    const mask = new Uint8Array(width * height);
    lines.forEach(line => addMaskRectangle(mask, width, height, line));

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (mask[y * width + x] === 1) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
    }
    if (maxX < minX || maxY < minY) return result;

    const filled = new Uint8Array(width * height);
    const maxPasses = Math.min(96, Math.max(maxX - minX + 1, maxY - minY + 1));
    for (let pass = 0; pass < maxPasses; pass += 1) {
        const next = new Uint8Array(width * height);
        let filledThisPass = 0;
        for (let y = minY; y <= maxY; y += 1) {
            for (let x = minX; x <= maxX; x += 1) {
                const index = y * width + x;
                if (mask[index] === 0 || filled[index] === 1) continue;

                let red = 0;
                let green = 0;
                let blue = 0;
                let weightTotal = 0;
                getNeighbours(x, y, width, height).forEach(neighbour => {
                    const neighbourIndex = neighbour.y * width + neighbour.x;
                    if (mask[neighbourIndex] === 1 && filled[neighbourIndex] === 0) return;
                    const distance = Math.abs(neighbour.x - x) + Math.abs(neighbour.y - y);
                    const weight = distance === 1 ? 2 : 1;
                    const offset = pixelOffset(neighbour.x, neighbour.y, width);
                    red += result[offset] * weight;
                    green += result[offset + 1] * weight;
                    blue += result[offset + 2] * weight;
                    weightTotal += weight;
                });
                if (weightTotal === 0) continue;

                const offset = pixelOffset(x, y, width);
                result[offset] = Math.round(red / weightTotal);
                result[offset + 1] = Math.round(green / weightTotal);
                result[offset + 2] = Math.round(blue / weightTotal);
                result[offset + 3] = source[offset + 3];
                next[index] = 1;
                filledThisPass += 1;
            }
        }
        for (let index = 0; index < filled.length; index += 1) {
            if (next[index] === 1) filled[index] = 1;
        }
        if (filledThisPass === 0) break;
        let remaining = false;
        for (let y = minY; y <= maxY && !remaining; y += 1) {
            for (let x = minX; x <= maxX; x += 1) {
                const index = y * width + x;
                if (mask[index] === 1 && filled[index] === 0) {
                    remaining = true;
                    break;
                }
            }
        }
        if (!remaining) break;
    }

    // 对极端情况下仍未填满的像素使用原图，避免输出透明/黑色洞。
    for (let index = 0; index < mask.length; index += 1) {
        if (mask[index] === 1 && filled[index] === 0) {
            const offset = index * 4;
            result[offset] = source[offset];
            result[offset + 1] = source[offset + 1];
            result[offset + 2] = source[offset + 2];
            result[offset + 3] = source[offset + 3];
        }
    }
    return result;
}

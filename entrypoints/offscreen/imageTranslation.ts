import type { OcrLine } from '@/entrypoints/utils/imageTranslationCore';
import { inpaintTextRegions } from '@/entrypoints/utils/imageInpainting';
import { recognizeImage } from './imageOcr';

export type OffscreenImageTranslationLine = OcrLine & { backgroundColor: string };

export interface OffscreenImageTranslationResult {
    image: string;
    lines: OffscreenImageTranslationLine[];
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const source = new Image();
        source.onload = () => resolve(source);
        source.onerror = () => reject(new Error('图片数据无法解码'));
        source.src = dataUrl;
    });
}

function getBackgroundColor(
    pixels: Uint8ClampedArray,
    imageWidth: number,
    imageHeight: number,
    bbox: OcrLine['bbox'],
): string {
    const x0 = Math.max(0, Math.floor(bbox.x0));
    const y0 = Math.max(0, Math.floor(bbox.y0));
    const x1 = Math.min(imageWidth, Math.ceil(bbox.x1));
    const y1 = Math.min(imageHeight, Math.ceil(bbox.y1));
    const colors = new Map<string, number>();
    const sample = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= imageWidth || y >= imageHeight) return;
        const offset = (y * imageWidth + x) * 4;
        const red = Math.min(255, Math.round(pixels[offset] / 16) * 16);
        const green = Math.min(255, Math.round(pixels[offset + 1] / 16) * 16);
        const blue = Math.min(255, Math.round(pixels[offset + 2] / 16) * 16);
        const key = `${red},${green},${blue}`;
        colors.set(key, (colors.get(key) || 0) + 1);
    };
    for (let y = y0 - 4; y <= y1 + 3; y += 1) {
        for (let x = x0 - 4; x <= x1 + 3; x += 1) {
            if (x < x0 || x >= x1 || y < y0 || y >= y1) sample(x, y);
        }
    }
    let best = '255,255,255';
    let bestCount = 0;
    colors.forEach((count, color) => {
        if (count > bestCount) {
            best = color;
            bestCount = count;
        }
    });
    return `rgb(${best})`;
}

function getTextColor(backgroundColor: string): string {
    const channels = backgroundColor.match(/\d+/g)?.map(Number) || [255, 255, 255];
    const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
    return luminance > 150 ? '#111827' : '#ffffff';
}

function drawTranslatedText(
    context: CanvasRenderingContext2D,
    text: string,
    left: number,
    top: number,
    width: number,
    height: number,
    backgroundColor: string,
): void {
    const horizontalPadding = Math.max(3, Math.round(height * 0.14));
    let fontSize = Math.max(10, Math.min(30, height * 0.76));
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = getTextColor(backgroundColor);
    const maxWidth = Math.max(1, width - horizontalPadding * 2);
    const getTokens = () => /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(text)
        ? Array.from(text.replace(/\s+/g, ''))
        : text.trim().split(/\s+/).filter(Boolean);
    const getLines = () => {
        const lines: string[] = [];
        let current = '';
        getTokens().forEach(token => {
            const candidate = current
                ? `${current}${/[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(token) ? '' : ' '}${token}`
                : token;
            if (current && context.measureText(candidate).width > maxWidth) {
                lines.push(current);
                current = token;
            } else {
                current = candidate;
            }
        });
        if (current) lines.push(current);
        return lines.length ? lines : [''];
    };
    let lines: string[] = [];
    while (fontSize >= 10) {
        context.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        lines = getLines();
        const lineHeight = fontSize * 1.14;
        if (lines.length <= 3 && lines.length * lineHeight <= height - 2) break;
        fontSize -= 1;
    }
    const lineHeight = fontSize * 1.14;
    const firstLineTop = top + (height - lineHeight * lines.length) / 2 + lineHeight / 2;
    lines.slice(0, 3).forEach((line, index) => {
        context.fillText(line, left + width / 2, firstLineTop + index * lineHeight, maxWidth);
    });
}

async function translateTexts(texts: string[], title: string): Promise<string[]> {
    const response = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'fluentReadImageTranslateTexts',
            texts,
            title,
        }, result => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });
    if (!response?.success || !Array.isArray(response.translations)) {
        throw new Error(response?.error || '图片文字翻译失败');
    }
    return response.translations;
}

async function prepareTranslatedImage(
    dataUrl: string,
    lines: OcrLine[],
    translations: string[],
): Promise<OffscreenImageTranslationResult> {
    const source = await loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) {
        throw new Error('浏览器不支持图片处理');
    }

    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const sourcePixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const translatedLines = lines.flatMap((line, index) => {
        const text = translations[index] || line.text;
        const normalizedOriginal = line.text.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
        const normalizedTranslation = text.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
        return normalizedOriginal === normalizedTranslation ? [] : [{ ...line, text }];
    });
    if (translatedLines.length === 0) {
        throw new Error('图片中没有需要翻译的文字');
    }
    const pixels = inpaintTextRegions(sourcePixels.data, canvas.width, canvas.height, translatedLines);
    sourcePixels.data.set(pixels);
    context.putImageData(sourcePixels, 0, 0);

    translatedLines.forEach(line => {
        const paddingX = Math.max(3, Math.round((line.bbox.y1 - line.bbox.y0) * 0.14));
        const paddingY = Math.max(2, Math.round((line.bbox.y1 - line.bbox.y0) * 0.18));
        const left = Math.max(0, line.bbox.x0 - paddingX);
        const top = Math.max(0, line.bbox.y0 - paddingY);
        const width = Math.min(canvas.width - left, line.bbox.x1 - line.bbox.x0 + paddingX * 2);
        const height = Math.min(canvas.height - top, line.bbox.y1 - line.bbox.y0 + paddingY * 2);
        drawTranslatedText(
            context,
            line.text,
            left,
            top,
            Math.max(1, width),
            Math.max(1, height),
            getBackgroundColor(pixels, canvas.width, canvas.height, line.bbox),
        );
    });

    return {
        image: canvas.toDataURL('image/png'),
        lines: translatedLines.map(line => ({
            ...line,
            backgroundColor: getBackgroundColor(pixels, canvas.width, canvas.height, line.bbox),
        })),
    };
}

export async function translateImageInOffscreen(
    image: string,
    sourceLanguage: string,
    title: string,
): Promise<OffscreenImageTranslationResult> {
    const lines = await recognizeImage(image, sourceLanguage);
    if (lines.length === 0) throw new Error('没有识别到图片文字');
    const translations = await translateTexts(lines.map(line => line.text), title);
    return prepareTranslatedImage(image, lines, translations);
}

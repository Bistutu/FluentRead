import { config } from '@/entrypoints/utils/config';
import { translateText } from '@/entrypoints/utils/translateApi';
import { fetchImageInExtension, recognizeImageInExtension } from '@/entrypoints/utils/imageOcrClient';
import { scaleOcrBox, type OcrLine } from '@/entrypoints/utils/imageTranslationCore';

const IMAGE_TRANSLATION_OVERLAY = 'fluent-read-image-translation-overlay';
const IMAGE_TRANSLATION_BUTTON = 'fluent-read-image-translation-button';
const MIN_IMAGE_WIDTH = 80;
const MIN_IMAGE_HEIGHT = 40;
const IMAGE_READ_TIMEOUT_MS = 15_000;
const IMAGE_OCR_TIMEOUT_MS = 90_000;
const IMAGE_TRANSLATION_TIMEOUT_MS = 90_000;

type ImageTranslationPhase = 'idle' | 'loading' | 'translated' | 'error';

interface ImageTranslationState {
    image: HTMLImageElement;
    overlay: HTMLDivElement;
    canvas: HTMLCanvasElement;
    button: HTMLButtonElement;
    phase: ImageTranslationPhase;
    abortController: AbortController | null;
    hoverTimer: number | null;
    lines: Array<OcrLine & { backgroundColor: string }>;
    sourceImage: HTMLImageElement | null;
}

let mounted = false;
let removeListeners: (() => void) | null = null;
const states = new WeakMap<HTMLImageElement, ImageTranslationState>();
const activeStates = new Set<ImageTranslationState>();

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: number | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer !== undefined) window.clearTimeout(timer);
    }
}

function clearHoverTimer(state: ImageTranslationState): void {
    if (state.hoverTimer !== null) {
        window.clearTimeout(state.hoverTimer);
        state.hoverTimer = null;
    }
}

function removeState(state: ImageTranslationState): void {
    clearHoverTimer(state);
    state.abortController?.abort();
    state.overlay.remove();
    activeStates.delete(state);
    if (states.get(state.image) === state) states.delete(state.image);
}

function updateOverlayPosition(state: ImageTranslationState): void {
    if (!state.image.isConnected) {
        removeState(state);
        return;
    }

    const rect = state.image.getBoundingClientRect();
    const visible = rect.width >= MIN_IMAGE_WIDTH && rect.height >= MIN_IMAGE_HEIGHT;
    state.overlay.style.display = visible ? 'block' : 'none';
    if (!visible) return;

    state.overlay.style.left = `${rect.left}px`;
    state.overlay.style.top = `${rect.top}px`;
    state.overlay.style.width = `${rect.width}px`;
    state.overlay.style.height = `${rect.height}px`;
    if (state.phase === 'translated') renderTranslatedBitmap(state, rect.width, rect.height);
}

function createState(image: HTMLImageElement): ImageTranslationState {
    const overlay = document.createElement('div');
    overlay.className = IMAGE_TRANSLATION_OVERLAY;
    overlay.dataset.fluentReadImageTranslation = 'true';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = IMAGE_TRANSLATION_BUTTON;
    button.textContent = '文';
    button.title = '翻译图片';
    button.setAttribute('aria-label', '翻译图片');
    button.addEventListener('pointerenter', event => event.stopPropagation());
    button.addEventListener('pointerdown', event => {
        event.preventDefault();
        event.stopPropagation();
    });
    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const state = states.get(image);
        if (!state) return;
        if (state.phase === 'translated') {
            restoreImageTranslation(state);
        } else if (state.phase !== 'loading') {
            void translateImage(state);
        }
    });

    const canvas = document.createElement('canvas');
    canvas.className = 'fluent-read-image-translation-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    overlay.append(canvas, button);
    document.documentElement.appendChild(overlay);

    const state: ImageTranslationState = {
        image,
        overlay,
        canvas,
        button,
        phase: 'idle',
        abortController: null,
        hoverTimer: null,
        lines: [],
        sourceImage: null,
    };
    states.set(image, state);
    activeStates.add(state);
    overlay.addEventListener('pointerenter', () => {
        const current = states.get(image);
        if (current) clearHoverTimer(current);
    });
    updateOverlayPosition(state);
    return state;
}

function getState(image: HTMLImageElement): ImageTranslationState {
    return states.get(image) || createState(image);
}

function showImageButton(image: HTMLImageElement): void {
    if (!mounted || !config.on || image.closest(`[${IMAGE_TRANSLATION_OVERLAY}]`) || image.closest('video')) return;
    const state = getState(image);
    clearHoverTimer(state);
    updateOverlayPosition(state);
}

function hideImageButton(image: HTMLImageElement): void {
    const state = states.get(image);
    if (!state || state.phase !== 'idle') return;
    clearHoverTimer(state);
    state.hoverTimer = window.setTimeout(() => {
        if (state.phase === 'idle') removeState(state);
    }, 180);
}

async function getImageData(image: HTMLImageElement): Promise<string> {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) throw new Error('图片尚未加载完成');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持图片读取');

    try {
        context.drawImage(image, 0, 0, width, height);
        // drawImage 本身不会暴露跨域污染，读取像素才能确定 canvas 是否可交给 OCR。
        context.getImageData(0, 0, 1, 1);
        return canvas.toDataURL('image/png');
    } catch {
        const source = image.currentSrc || image.src;
        if (!source) throw new Error('图片地址不可用');
        // 网页 canvas 受 CORS 限制时，改由扩展后台按网页地址抓取图片。
        return fetchImageInExtension(source);
    }
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

async function addBackgroundColors(dataUrl: string, lines: OcrLine[]): Promise<{
    source: HTMLImageElement;
    lines: Array<OcrLine & { backgroundColor: string }>;
}> {
    const source = await loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) {
        return { source, lines: lines.map(line => ({ ...line, backgroundColor: 'rgb(255, 255, 255)' })) };
    }
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return {
        source,
        lines: lines.map(line => ({
            ...line,
            backgroundColor: getBackgroundColor(pixels, canvas.width, canvas.height, line.bbox),
        })),
    };
}

function getTextColor(backgroundColor: string): string {
    const channels = backgroundColor.match(/\d+/g)?.map(Number) || [255, 255, 255];
    const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
    return luminance > 150 ? '#111827' : '#ffffff';
}

interface RenderedImageRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

function getRenderedImageRect(image: HTMLImageElement, renderedWidth: number, renderedHeight: number): RenderedImageRect {
    const imageWidth = image.naturalWidth;
    const imageHeight = image.naturalHeight;
    const style = getComputedStyle(image);
    const objectFit = style.objectFit || 'fill';
    let width = renderedWidth;
    let height = renderedHeight;

    if (objectFit === 'contain' || objectFit === 'scale-down') {
        const scale = Math.min(renderedWidth / imageWidth, renderedHeight / imageHeight);
        const downScale = objectFit === 'scale-down' ? Math.min(1, scale) : scale;
        width = imageWidth * downScale;
        height = imageHeight * downScale;
    } else if (objectFit === 'cover') {
        const scale = Math.max(renderedWidth / imageWidth, renderedHeight / imageHeight);
        width = imageWidth * scale;
        height = imageHeight * scale;
    }

    const [positionX = '50%', positionY = '50%'] = style.objectPosition.split(/\s+/);
    const resolvePosition = (value: string, available: number): number => {
        if (value.endsWith('%')) return available * Number.parseFloat(value) / 100;
        if (value.endsWith('px')) return Number.parseFloat(value);
        if (value === 'left' || value === 'top') return 0;
        if (value === 'right' || value === 'bottom') return available;
        return available / 2;
    };
    return {
        left: resolvePosition(positionX, renderedWidth - width),
        top: resolvePosition(positionY, renderedHeight - height),
        width,
        height,
    };
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
    context.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    while (fontSize > 10 && context.measureText(text).width > width - horizontalPadding * 2) {
        fontSize -= 1;
        context.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    }
    context.fillText(text, left + width / 2, top + height / 2, Math.max(1, width - horizontalPadding * 2));
}

function renderTranslatedBitmap(state: ImageTranslationState, renderedWidth: number, renderedHeight: number): void {
    const imageWidth = state.image.naturalWidth;
    const imageHeight = state.image.naturalHeight;
    if (!imageWidth || !imageHeight || !state.sourceImage) return;

    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    state.canvas.style.display = 'block';
    state.canvas.width = Math.max(1, Math.round(renderedWidth * pixelRatio));
    state.canvas.height = Math.max(1, Math.round(renderedHeight * pixelRatio));
    state.canvas.style.width = `${renderedWidth}px`;
    state.canvas.style.height = `${renderedHeight}px`;
    const context = state.canvas.getContext('2d');
    if (!context) return;
    const imageRect = getRenderedImageRect(state.image, renderedWidth, renderedHeight);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, renderedWidth, renderedHeight);
    context.drawImage(state.sourceImage, imageRect.left, imageRect.top, imageRect.width, imageRect.height);

    state.lines.forEach(line => {
        const scaledBox = scaleOcrBox(line.bbox, imageWidth, imageHeight, imageRect.width, imageRect.height);
        const box = {
            left: scaledBox.left + imageRect.left,
            top: scaledBox.top + imageRect.top,
            width: scaledBox.width,
            height: scaledBox.height,
        };
        const paddingX = Math.max(3, Math.round(box.height * 0.14));
        const paddingY = Math.max(2, Math.round(box.height * 0.18));
        const left = Math.max(0, box.left - paddingX);
        const top = Math.max(0, box.top - paddingY);
        const width = Math.min(renderedWidth - left, box.width + paddingX * 2);
        const height = Math.min(renderedHeight - top, box.height + paddingY * 2);
        context.fillStyle = line.backgroundColor;
        context.fillRect(left, top, Math.max(1, width), Math.max(1, height));
        drawTranslatedText(context, line.text, left, top, Math.max(1, width), Math.max(1, height), line.backgroundColor);
    });
}

function setButtonState(state: ImageTranslationState, phase: ImageTranslationPhase, message: string): void {
    const userMessage = phase === 'error' ? '图片无法读取，请尝试保存图片后翻译' : message;
    state.phase = phase;
    state.button.textContent = phase === 'translated' ? '↶' : phase === 'error' ? '!' : '文';
    state.button.title = userMessage;
    state.button.setAttribute('aria-label', userMessage);
    state.button.dataset.phase = phase;
}

function restoreImageTranslation(state: ImageTranslationState): void {
    state.abortController?.abort();
    state.abortController = null;
    state.lines = [];
    state.sourceImage = null;
    state.canvas.width = 0;
    state.canvas.height = 0;
    state.canvas.style.display = 'none';
    setButtonState(state, 'idle', '翻译图片');
    updateOverlayPosition(state);
}

async function translateImage(state: ImageTranslationState): Promise<void> {
    if (state.phase === 'loading') return;
    if (!state.image.isConnected || !state.image.naturalWidth || !state.image.naturalHeight) return;

    const controller = new AbortController();
    state.abortController = controller;
    setButtonState(state, 'loading', '正在识别图片文字');
    try {
        const imageData = await withTimeout(getImageData(state.image), IMAGE_READ_TIMEOUT_MS, '图片读取超时');
        const lines = await withTimeout(recognizeImageInExtension(imageData, config.from), IMAGE_OCR_TIMEOUT_MS, '图片文字识别超时');
        if (controller.signal.aborted) return;
        if (lines.length === 0) throw new Error('没有识别到图片文字');
        const translations = await withTimeout(
            Promise.all(lines.map(line => translateText(line.text, document.title))),
            IMAGE_TRANSLATION_TIMEOUT_MS,
            '图片翻译超时',
        );
        if (controller.signal.aborted) return;

        const translatedLines = lines.map((line, index) => ({
            ...line,
            text: translations[index] || line.text,
        }));
        const prepared = await withTimeout(addBackgroundColors(imageData, translatedLines), IMAGE_READ_TIMEOUT_MS, '图片背景读取超时');
        state.sourceImage = prepared.source;
        state.lines = prepared.lines;
        setButtonState(state, 'translated', '恢复原图');
        updateOverlayPosition(state);
    } catch (error) {
        if (controller.signal.aborted) return;
        controller.abort();
        const message = error instanceof Error ? error.message : String(error);
        setButtonState(state, 'error', `图片翻译失败：${message}`);
        window.setTimeout(() => {
            if (state.phase === 'error') setButtonState(state, 'idle', '翻译图片');
        }, 3000);
        console.warn('[FluentRead] 图片翻译失败:', error);
    } finally {
        if (state.abortController === controller) state.abortController = null;
    }
}

function handlePointerOver(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    const image = event.target instanceof HTMLImageElement ? event.target : null;
    if (image) showImageButton(image);
}

function handlePointerOut(event: PointerEvent): void {
    const image = event.target instanceof HTMLImageElement ? event.target : null;
    if (image && event.relatedTarget instanceof Node && image.contains(event.relatedTarget)) return;
    if (image) hideImageButton(image);
}

function handleViewportChange(): void {
    activeStates.forEach(updateOverlayPosition);
}

export function mountImageTranslator(): void {
    if (mounted) return;
    mounted = true;
    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    removeListeners = () => {
        document.removeEventListener('pointerover', handlePointerOver, true);
        document.removeEventListener('pointerout', handlePointerOut, true);
        window.removeEventListener('scroll', handleViewportChange, true);
        window.removeEventListener('resize', handleViewportChange);
    };
}

export function unmountImageTranslator(): void {
    if (!mounted) return;
    mounted = false;
    removeListeners?.();
    removeListeners = null;
    Array.from(activeStates).forEach(removeState);
}

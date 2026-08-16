import { config } from '@/entrypoints/utils/config';
import { fetchImageInExtension, translateImageInExtension } from '@/entrypoints/utils/imageOcrClient';
import type { OcrLine } from '@/entrypoints/utils/imageTranslationCore';

const IMAGE_TRANSLATION_OVERLAY = 'fluent-read-image-translation-overlay';
const IMAGE_TRANSLATION_ROOT = 'fluent-read-image-translation-root';
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
    resizeObserver: ResizeObserver | null;
    imageLoadHandler: (() => void) | null;
    lines: Array<OcrLine & { backgroundColor: string }>;
    translatedImage: HTMLImageElement | null;
}

let mounted = false;
let removeListeners: (() => void) | null = null;
let imageOverlayHost: HTMLDivElement | null = null;
let imageOverlayContainer: HTMLDivElement | null = null;
let layoutObserver: MutationObserver | null = null;
let positionFrame: number | null = null;
const states = new WeakMap<HTMLImageElement, ImageTranslationState>();
const activeStates = new Set<ImageTranslationState>();

function ensureImageOverlayRoot(): HTMLDivElement {
    if (imageOverlayContainer) return imageOverlayContainer;

    const host = document.createElement('div');
    host.id = IMAGE_TRANSLATION_ROOT;
    host.setAttribute('data-fluent-read-ui', 'image-translation');
    host.style.cssText = [
        'all: initial !important',
        'position: fixed !important',
        'inset: 0 !important',
        'width: 100vw !important',
        'height: 100vh !important',
        'pointer-events: none !important',
        'z-index: 2147483646 !important',
    ].join(';');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483646; }
      .${IMAGE_TRANSLATION_OVERLAY} { position: fixed !important; overflow: hidden !important; pointer-events: none !important; box-sizing: border-box !important; }
      .${IMAGE_TRANSLATION_OVERLAY} canvas { position: absolute !important; inset: 0 !important; display: none; width: 100%; height: 100%; pointer-events: none; }
      .${IMAGE_TRANSLATION_BUTTON} {
        position: absolute !important; right: 8px !important; top: 8px !important; z-index: 1 !important;
        width: 26px !important; height: 26px !important; padding: 0 !important;
        border: 1px solid rgba(255,255,255,.7) !important; border-radius: 999px !important;
        background: rgba(20,20,20,.68) !important; color: rgba(255,255,255,.95) !important;
        box-shadow: 0 1px 5px rgba(0,0,0,.28) !important; cursor: pointer !important;
        font: 14px/24px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;
        opacity: .78 !important; pointer-events: auto !important;
        transition: opacity .15s ease, transform .15s ease, background .15s ease !important;
      }
      .${IMAGE_TRANSLATION_BUTTON}:hover, .${IMAGE_TRANSLATION_BUTTON}:focus-visible { background: rgba(20,20,20,.9) !important; opacity: 1 !important; outline: none !important; transform: scale(1.06); }
      .${IMAGE_TRANSLATION_BUTTON}[data-phase="loading"] { animation: fluent-read-image-translation-pulse 1.1s ease-in-out infinite; }
      .${IMAGE_TRANSLATION_BUTTON}[data-phase="error"] { background: rgba(185,28,28,.88) !important; }
      @keyframes fluent-read-image-translation-pulse { 0%,100% { opacity:.52; } 50% { opacity:1; } }
    `;
    const container = document.createElement('div');
    shadow.append(style, container);
    document.documentElement.appendChild(host);
    imageOverlayHost = host;
    imageOverlayContainer = container;
    return container;
}

function removeImageOverlayRoot(): void {
    imageOverlayHost?.remove();
    imageOverlayHost = null;
    imageOverlayContainer = null;
}

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
    state.resizeObserver?.disconnect();
    if (state.imageLoadHandler) state.image.removeEventListener('load', state.imageLoadHandler);
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
    const overlayContainer = ensureImageOverlayRoot();
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
    overlayContainer.appendChild(overlay);

    const state: ImageTranslationState = {
        image,
        overlay,
        canvas,
        button,
        phase: 'idle',
        abortController: null,
        hoverTimer: null,
        resizeObserver: null,
        imageLoadHandler: null,
        lines: [],
        translatedImage: null,
    };
    state.imageLoadHandler = () => updateOverlayPosition(state);
    state.resizeObserver = typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => updateOverlayPosition(state));
    state.resizeObserver?.observe(image);
    image.addEventListener('load', state.imageLoadHandler);
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

async function waitForImageReady(image: HTMLImageElement): Promise<void> {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) return;
    if (image.complete) throw new Error('图片尚未加载完成');

    await new Promise<void>((resolve, reject) => {
        const onLoad = () => {
            cleanup();
            if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve();
            else reject(new Error('图片尚未加载完成'));
        };
        const onError = () => {
            cleanup();
            reject(new Error('图片加载失败'));
        };
        const cleanup = () => {
            image.removeEventListener('load', onLoad);
            image.removeEventListener('error', onError);
        };
        image.addEventListener('load', onLoad, { once: true });
        image.addEventListener('error', onError, { once: true });
    });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const source = new Image();
        source.onload = () => resolve(source);
        source.onerror = () => reject(new Error('图片数据无法解码'));
        source.src = dataUrl;
    });
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

function renderTranslatedBitmap(state: ImageTranslationState, renderedWidth: number, renderedHeight: number): void {
    if (!state.image.naturalWidth || !state.image.naturalHeight || !state.translatedImage) return;

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
    context.drawImage(state.translatedImage, imageRect.left, imageRect.top, imageRect.width, imageRect.height);
}

function setButtonState(state: ImageTranslationState, phase: ImageTranslationPhase, message: string): void {
    const userMessage = message;
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
    state.translatedImage = null;
    state.canvas.width = 0;
    state.canvas.height = 0;
    state.canvas.style.display = 'none';
    setButtonState(state, 'idle', '翻译图片');
    updateOverlayPosition(state);
}

async function translateImage(state: ImageTranslationState): Promise<void> {
    if (state.phase === 'loading') return;
    if (!state.image.isConnected) return;

    const controller = new AbortController();
    state.abortController = controller;
    setButtonState(state, 'loading', '正在识别图片文字');
    try {
        await withTimeout(waitForImageReady(state.image), IMAGE_READ_TIMEOUT_MS, '图片加载超时');
        const imageData = await withTimeout(getImageData(state.image), IMAGE_READ_TIMEOUT_MS, '图片读取超时');
        const result = await withTimeout(
            translateImageInExtension(imageData, config.from, document.title),
            IMAGE_OCR_TIMEOUT_MS + IMAGE_TRANSLATION_TIMEOUT_MS,
            '图片翻译超时',
        );
        if (controller.signal.aborted) return;
        state.translatedImage = await loadImage(result.image);
        state.lines = result.lines;
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

function scheduleViewportChange(): void {
    if (positionFrame !== null) return;
    positionFrame = window.requestAnimationFrame(() => {
        positionFrame = null;
        activeStates.forEach(updateOverlayPosition);
    });
}

export function mountImageTranslator(): void {
    if (mounted) return;
    mounted = true;
    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    window.addEventListener('scroll', scheduleViewportChange, true);
    window.addEventListener('resize', scheduleViewportChange);
    layoutObserver = new MutationObserver(scheduleViewportChange);
    layoutObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        childList: true,
        subtree: true,
    });
    removeListeners = () => {
        document.removeEventListener('pointerover', handlePointerOver, true);
        document.removeEventListener('pointerout', handlePointerOut, true);
        window.removeEventListener('scroll', scheduleViewportChange, true);
        window.removeEventListener('resize', scheduleViewportChange);
        layoutObserver?.disconnect();
        layoutObserver = null;
        if (positionFrame !== null) {
            window.cancelAnimationFrame(positionFrame);
            positionFrame = null;
        }
    };
}

export function unmountImageTranslator(): void {
    if (!mounted) return;
    mounted = false;
    removeListeners?.();
    removeListeners = null;
    Array.from(activeStates).forEach(removeState);
    removeImageOverlayRoot();
}

import { config } from '@/entrypoints/utils/config';
import { translateText } from '@/entrypoints/utils/translateApi';
import { recognizeImageInExtension } from '@/entrypoints/utils/imageOcrClient';
import { scaleOcrBox, type OcrLine } from '@/entrypoints/utils/imageTranslationCore';

const IMAGE_TRANSLATION_OVERLAY = 'fluent-read-image-translation-overlay';
const IMAGE_TRANSLATION_BUTTON = 'fluent-read-image-translation-button';
const MIN_IMAGE_WIDTH = 80;
const MIN_IMAGE_HEIGHT = 40;

type ImageTranslationPhase = 'idle' | 'loading' | 'translated' | 'error';

interface ImageTranslationState {
    image: HTMLImageElement;
    overlay: HTMLDivElement;
    button: HTMLButtonElement;
    phase: ImageTranslationPhase;
    abortController: AbortController | null;
    hoverTimer: number | null;
    lines: OcrLine[];
}

let mounted = false;
let removeListeners: (() => void) | null = null;
const states = new WeakMap<HTMLImageElement, ImageTranslationState>();
const activeStates = new Set<ImageTranslationState>();

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
    // 长图的真实右下角可能在视口外；悬停时把入口约束到当前可见区域的底部。
    state.button.style.bottom = `${Math.max(8, rect.bottom - window.innerHeight + 8)}px`;

    if (state.phase === 'translated') {
        renderTranslatedLines(state, rect.width, rect.height);
    }
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

    overlay.appendChild(button);
    document.documentElement.appendChild(overlay);

    const state: ImageTranslationState = {
        image,
        overlay,
        button,
        phase: 'idle',
        abortController: null,
        hoverTimer: null,
        lines: [],
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
    if (!mounted || !config.on || image.closest(`[${IMAGE_TRANSLATION_OVERLAY}]`)) return;
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

function getImageData(image: HTMLImageElement): string {
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
        throw new Error('跨域图片无法在本地 OCR，请尝试保存图片后翻译');
    }
}

function renderTranslatedLines(state: ImageTranslationState, renderedWidth: number, renderedHeight: number): void {
    state.overlay.querySelectorAll('.fluent-read-image-translation-line').forEach(line => line.remove());
    const imageWidth = state.image.naturalWidth;
    const imageHeight = state.image.naturalHeight;
    if (!imageWidth || !imageHeight) return;

    state.lines.forEach(line => {
        const box = scaleOcrBox(line.bbox, imageWidth, imageHeight, renderedWidth, renderedHeight);
        const element = document.createElement('span');
        element.className = 'fluent-read-image-translation-line';
        element.textContent = line.text;
        element.style.left = `${box.left}px`;
        element.style.top = `${box.top}px`;
        element.style.width = `${box.width}px`;
        element.style.minHeight = `${box.height}px`;
        element.style.fontSize = `${Math.max(12, Math.min(30, box.height * 0.78))}px`;
        element.style.lineHeight = `${Math.max(1.1, Math.min(1.35, box.height / Math.max(12, box.height * 0.78)))}em`;
        state.overlay.insertBefore(element, state.button);
    });
}

function setButtonState(state: ImageTranslationState, phase: ImageTranslationPhase, message: string): void {
    state.phase = phase;
    state.button.textContent = phase === 'translated' ? '↶' : phase === 'error' ? '!' : '文';
    state.button.title = message;
    state.button.setAttribute('aria-label', message);
    state.button.dataset.phase = phase;
}

function restoreImageTranslation(state: ImageTranslationState): void {
    state.abortController?.abort();
    state.abortController = null;
    state.lines = [];
    state.overlay.querySelectorAll('.fluent-read-image-translation-line').forEach(line => line.remove());
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
        const imageData = getImageData(state.image);
        const lines = await recognizeImageInExtension(imageData, config.from);
        if (controller.signal.aborted) return;
        if (lines.length === 0) throw new Error('没有识别到图片文字');
        const translations = await Promise.all(lines.map(line => translateText(line.text, document.title)));
        if (controller.signal.aborted) return;

        state.lines = lines.map((line, index) => ({
            ...line,
            text: translations[index] || line.text,
        }));
        setButtonState(state, 'translated', '恢复原图');
        updateOverlayPosition(state);
    } catch (error) {
        if (controller.signal.aborted) return;
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

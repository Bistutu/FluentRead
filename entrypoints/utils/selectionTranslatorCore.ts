export interface SelectionRect {
    top: number;
    right: number;
    bottom: number;
    left: number;
    width: number;
    height: number;
}

export interface PopupSize {
    width: number;
    height: number;
}

export interface ViewportSize {
    width: number;
    height: number;
}

export interface PopupPosition {
    left: number;
    top: number;
    placement: 'top' | 'bottom';
}

const DEFAULT_PADDING = 12;
const DEFAULT_GAP = 10;

/** Normalize browser selection text without destroying meaningful line breaks. */
export function normalizeSelectionText(value: string): string {
    return value
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .trim();
}

/**
 * Select the visual edge closest to the selection focus. Using client rects
 * avoids placing the affordance in the middle of a multi-line selection.
 */
export function chooseSelectionRect(rects: SelectionRect[], isForward = true): SelectionRect | null {
    if (rects.length === 0) return null;
    return isForward ? rects[rects.length - 1] ?? null : rects[0] ?? null;
}

/**
 * Position the popover against the selected line and keep it inside the
 * viewport. The calculation is pure so scroll/resize behavior can be tested
 * without mounting Vue or depending on a page's CSS.
 */
export function calculateSelectionPopupPosition(
    anchor: SelectionRect,
    popup: PopupSize,
    viewport: ViewportSize,
    padding = DEFAULT_PADDING,
    gap = DEFAULT_GAP,
): PopupPosition {
    const maxLeft = Math.max(padding, viewport.width - popup.width - padding);
    const left = clamp(anchor.left, padding, maxLeft);
    const fitsAbove = anchor.top - popup.height - gap >= padding;
    const placement = fitsAbove ? 'top' : 'bottom';
    const rawTop = fitsAbove ? anchor.top - popup.height - gap : anchor.bottom + gap;
    const maxTop = Math.max(padding, viewport.height - popup.height - padding);

    return {
        left,
        top: clamp(rawTop, padding, maxTop),
        placement,
    };
}

export function normalizeSpeechLanguage(language: string | undefined, fallback = 'en-US'): string {
    const normalized = String(language ?? '').trim().replace(/_/g, '-');
    const lower = normalized.toLowerCase();
    if (!normalized || ['auto', 'detect', 'unknown', 'und'].includes(lower)) return fallback;

    const aliases: Record<string, string> = {
        'zh': 'zh-CN',
        'zh-hans': 'zh-CN',
        'zh-cn': 'zh-CN',
        'zh-hant': 'zh-TW',
        'zh-tw': 'zh-TW',
        'en': 'en-US',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'es': 'es-ES',
        'it': 'it-IT',
        'pt': 'pt-BR',
        'ru': 'ru-RU',
    };

    if (aliases[lower]) return aliases[lower];
    return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(normalized) ? normalized : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

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

const languageAliases: Record<string, string> = {
    cmn: 'zh',
    zho: 'zh',
    chi: 'zh',
    eng: 'en',
    jpn: 'ja',
    kor: 'ko',
    fra: 'fr',
    fre: 'fr',
    deu: 'de',
    ger: 'de',
    spa: 'es',
    rus: 'ru',
    ita: 'it',
    por: 'pt',
    ara: 'ar',
    hin: 'hi',
    tha: 'th',
    vie: 'vi',
    nld: 'nl',
    dut: 'nl',
    pol: 'pl',
    tur: 'tr',
};

/** Compare detected and configured languages without depending on region/script details. */
export function isSameLanguage(detectedLanguage: string | undefined, targetLanguage: string | undefined): boolean {
    const detected = String(detectedLanguage ?? '').trim().replace(/_/g, '-').toLowerCase();
    const target = String(targetLanguage ?? '').trim().replace(/_/g, '-').toLowerCase();
    if (!detected || !target || ['auto', 'detect', 'unknown', 'und'].includes(detected) || ['auto', 'detect', 'unknown', 'und'].includes(target)) return false;

    const detectedBase = languageAliases[detected] || detected.split('-')[0];
    const targetBase = languageAliases[target] || target.split('-')[0];
    return Boolean(detectedBase && targetBase && detectedBase === targetBase);
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

const selectionExcludedTagNames = new Set([
    'audio', 'button', 'canvas', 'code', 'embed', 'iframe', 'img', 'input',
    'kbd', 'math', 'object', 'option', 'picture', 'pre', 'samp', 'select',
    'svg', 'template', 'textarea', 'var', 'video',
]);

const selectionExcludedRoles = new Set([
    'button', 'checkbox', 'combobox', 'listbox', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'radio', 'scrollbar', 'slider', 'spinbutton',
    'switch', 'tab', 'textbox',
]);

const selectionExcludedSelector = [
    '.fluent-read-bilingual-content',
    '.fluent-read-loading',
    '.fluent-read-retry-wrapper',
    '.notranslate',
    '[aria-hidden="true"]',
    '[data-fluent-read-ui]',
    '[data-notranslate="true"]',
    '[role="button"]',
    '[role="checkbox"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="scrollbar"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="textbox"]',
    '[translate="no"]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    ...Array.from(selectionExcludedTagNames, (tagName) => tagName),
].join(',');

export function isSelectionExcludedTagName(tagName: string): boolean {
    return selectionExcludedTagNames.has(tagName.trim().toLowerCase());
}

function isEditableSelectionElement(element: Element): boolean {
    if ((element as HTMLElement).isContentEditable) return true;

    let current: Element | null = element;
    while (current) {
        if (current.hasAttribute('contenteditable')) {
            return current.getAttribute('contenteditable')?.trim().toLowerCase() !== 'false';
        }
        current = current.parentElement;
    }
    return false;
}

function isSelectionExcludedElement(element: Element | null): boolean {
    if (!element) return false;
    if (isSelectionExcludedTagName(element.tagName)) return true;

    const role = element.getAttribute('role')?.trim().toLowerCase();
    if (role && selectionExcludedRoles.has(role)) return true;
    if (isEditableSelectionElement(element)) return true;
    return Boolean(element.closest(selectionExcludedSelector));
}

function elementFromSelectionNode(node: Node | null): Element | null {
    if (!node) return null;
    return node.nodeType === 1 ? node as Element : node.parentElement;
}

/**
 * Selection translation is intended for page prose, not atomic or interactive
 * widgets. Check both boundaries and the cloned range so image-only selections
 * and selections that cross a special component do not leave a stale trigger.
 */
export function shouldIgnoreSelection(range: Range): boolean {
    const boundaries = [
        elementFromSelectionNode(range.startContainer),
        elementFromSelectionNode(range.endContainer),
    ];
    if (boundaries.some(isSelectionExcludedElement)) return true;

    try {
        return Boolean(range.cloneContents().querySelector(selectionExcludedSelector));
    } catch {
        return false;
    }
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

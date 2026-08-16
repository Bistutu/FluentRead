import browser from 'webextension-polyfill';
import { config, saveConfig, subscribeConfig } from '@/entrypoints/utils/config';
import { options } from '@/entrypoints/utils/option';
import type { Config, VideoSubtitleDisplayMode } from '@/entrypoints/utils/model';
import { translateVideoText } from '@/entrypoints/utils/translateApi';
import {
  buildYoutubeTimedTextUrl,
  chooseYoutubeCaptionTrack,
  cuesToSrt,
  extractYoutubeCaptionTracks,
  finalizeVideoSubtitleCues,
  parseYoutubeTimedTextResponse,
  sanitizeSubtitleFilename,
  type VideoSubtitleCue,
} from './youtubeSubtitleData';

export const VIDEO_CAPTION_CONTAINER_SELECTOR = '#ytp-caption-window-container, .ytp-caption-window-container';
export const VIDEO_CAPTION_SEGMENT_SELECTOR = '.ytp-caption-segment';
export const VIDEO_TRANSLATION_OVERLAY_ID = 'fluent-read-video-subtitle';
export const VIDEO_TRANSLATION_LAYER_ID = 'fluent-read-video-subtitle-layer';
export const VIDEO_TRANSLATION_BUTTON_ID = 'fluent-read-video-subtitle-button';
export const VIDEO_TRANSLATION_MENU_ID = 'fluent-read-video-subtitle-menu';

const VIDEO_PLAYER_SELECTOR = '#movie_player, .html5-video-player';
const VIDEO_RIGHT_CONTROLS_SELECTOR = '.ytp-right-controls';
const VIDEO_TRANSLATION_ACTIVE_CLASS = 'fluent-read-video-subtitle-active';
const VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS = 'fluent-read-video-display-translation-only';
const VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS = 'fluent-read-video-display-original-only';
const VIDEO_DISPLAY_HIDDEN_CLASS = 'fluent-read-video-display-hidden';

const YOUTUBE_HOST_PATTERN = /(^|\.)youtube\.com$/i;
const YOUTUBE_MOBILE_HOST_PATTERN = /(^|\.)youtube-nocookie\.com$/i;
const YOUTUBE_TIMED_TEXT_MESSAGE = 'fluent-read-youtube-timedtext';

const VIDEO_DISPLAY_MODE_LABELS: Record<VideoSubtitleDisplayMode, string> = {
  bilingual: '双语',
  'translation-only': '仅译文',
  'original-only': '仅原文',
};

const VIDEO_CAPTION_EMPTY_GRACE_MS = 420;
const VIDEO_CAPTION_STABILITY_MS = 360;
const VIDEO_CAPTION_FALLBACK_SEGMENT_SELECTOR = '.captions-text';

export function normalizeVideoSubtitleDisplayMode(value: unknown): VideoSubtitleDisplayMode {
  if (value === 'translation-only' || value === 'original-only') return value;
  return 'bilingual';
}

export function getVideoServiceLabel(service: string): string {
  const item = options.services.find((candidate: any) => candidate.value === service);
  return item?.label || service;
}

function getTimedTextCacheKey(url: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    return [
      parsed.searchParams.get('v') || '',
      parsed.searchParams.get('lang') || '',
      parsed.searchParams.get('tlang') || '',
      parsed.searchParams.get('kind') || '',
    ].join(':');
  } catch {
    return url;
  }
}

function isOriginalTimedTextUrl(url: string): boolean {
  try {
    return !new URL(url, window.location.href).searchParams.get('tlang');
  } catch {
    return false;
  }
}

function downloadSubtitleSrt(cues: VideoSubtitleCue[], languageCode: string): void {
  const srt = cuesToSrt(cues);
  if (!srt.trim()) throw new Error('字幕轨道没有可下载的内容');

  const title = sanitizeSubtitleFilename(document.title.replace(/\s*-\s*YouTube\s*$/i, ''));
  const language = sanitizeSubtitleFilename(languageCode || 'original');
  const blobUrl = URL.createObjectURL(new Blob([srt], { type: 'application/x-subrip;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = `${title}-${language}.srt`;
  anchor.style.display = 'none';
  (document.body || document.documentElement).appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

export function isYouTubeVideoPage(locationLike: Pick<Location, 'hostname' | 'pathname'> = window.location): boolean {
  const isYouTubeHost = YOUTUBE_HOST_PATTERN.test(locationLike.hostname) || YOUTUBE_MOBILE_HOST_PATTERN.test(locationLike.hostname);
  return isYouTubeHost && (locationLike.pathname === '/watch' || locationLike.pathname === '/shorts');
}

/** 读取当前播放器可见的原生字幕，不读取插件自己的译文节点。 */
function getVisibleCaptionSegments(container: Element): HTMLElement[] {
  const nativeSegments = Array.from(container.querySelectorAll<HTMLElement>(VIDEO_CAPTION_SEGMENT_SELECTOR));
  const candidates = nativeSegments.length > 0
    ? nativeSegments
    : Array.from(container.querySelectorAll<HTMLElement>(VIDEO_CAPTION_FALLBACK_SEGMENT_SELECTOR));

  return candidates.filter((segment) => !candidates.some((candidate) => candidate !== segment && candidate.contains(segment)));
}

export function readVisibleCaptionText(container: Element | null): string {
  if (!container) return '';

  const segments = getVisibleCaptionSegments(container)
    .map((segment) => segment.textContent?.replace(/[\s\u3000]+/g, ' ').trim() || '')
    .filter(Boolean);

  return segments.join(' ').replace(/[\s\u3000]+/g, ' ').trim();
}

function findCaptionContainer(): HTMLElement | null {
  return document.querySelector(VIDEO_CAPTION_CONTAINER_SELECTOR);
}

function findVideoPlayer(): HTMLElement | null {
  return document.querySelector(VIDEO_PLAYER_SELECTOR);
}

function getYouTubeVideoPageKey(): string {
  try {
    const url = new URL(window.location.href);
    return `${url.pathname}:${url.searchParams.get('v') || ''}`;
  } catch {
    return window.location.href;
  }
}

function markVideoUi(element: HTMLElement): void {
  element.classList.add('notranslate', 'fluent-read-video-ui');
  element.setAttribute('data-fluent-read-ui', 'video-subtitle');
  element.setAttribute('translate', 'no');
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function getOrCreateTranslationOverlay(player: HTMLElement): HTMLElement {
  let layer = player.querySelector<HTMLElement>(`#${VIDEO_TRANSLATION_LAYER_ID}`);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = VIDEO_TRANSLATION_LAYER_ID;
    layer.className = 'fluent-read-video-subtitle-layer fluent-read-video-ui notranslate';
    layer.setAttribute('data-fluent-read-ui', 'video-subtitle');
    layer.setAttribute('translate', 'no');
    player.appendChild(layer);
  }

  const existing = layer.querySelector<HTMLElement>(`#${VIDEO_TRANSLATION_OVERLAY_ID}`);
  if (existing) return existing;

  const overlay = document.createElement('div');
  overlay.id = VIDEO_TRANSLATION_OVERLAY_ID;
  overlay.className = 'fluent-read-video-subtitle notranslate';
  overlay.setAttribute('data-fluent-read-ui', 'video-subtitle');
  overlay.setAttribute('translate', 'no');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-label', 'FluentRead 视频字幕译文');
  layer.appendChild(overlay);
  return overlay;
}

function removeTranslationOverlay(): void {
  document.querySelectorAll(`#${VIDEO_TRANSLATION_LAYER_ID}`).forEach((node) => node.remove());
  document.querySelectorAll(`#${VIDEO_TRANSLATION_OVERLAY_ID}`).forEach((node) => node.remove());
}

function syncTranslationOverlayPosition(container: HTMLElement | null): void {
  if (!container) return;
  const overlay = document.getElementById(VIDEO_TRANSLATION_OVERLAY_ID);
  const player = findVideoPlayer();
  if (!overlay || !player) return;

  const playerRect = player.getBoundingClientRect();
  const anchors = getVisibleCaptionSegments(container)
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  // YouTube 在字幕切换期间会短暂保留一个空的、甚至回到播放器顶部的容器。
  // 没有真实字幕片段时保留上一次位置，避免译文被重新定位到顶部后闪过。
  if (anchors.length === 0) return;
  const anchor = {
    left: Math.min(...anchors.map((rect) => rect.left)),
    right: Math.max(...anchors.map((rect) => rect.right)),
    top: Math.min(...anchors.map((rect) => rect.top)),
    bottom: Math.max(...anchors.map((rect) => rect.bottom)),
  };
  const playerWidth = playerRect.width || 960;
  const playerHeight = playerRect.height || 540;
  const width = Math.min(Math.max(anchor.right - anchor.left, 240), Math.max(playerWidth - 24, 240));
  const center = (anchor.left + anchor.right) / 2;
  const left = Math.min(
    Math.max(center - width / 2 - playerRect.left, 12),
    Math.max(playerWidth - width - 12, 12),
  );
  let top = anchor.bottom - playerRect.top + 6;

  overlay.style.left = `${left}px`;
  overlay.style.width = `${width}px`;
  overlay.style.top = `${Math.max(top, 8)}px`;

  const overlayHeight = overlay.getBoundingClientRect().height;
  if (overlayHeight > 0 && top + overlayHeight > playerHeight - 8) {
    top = anchor.top - playerRect.top - overlayHeight - 6;
    overlay.style.top = `${Math.max(top, 8)}px`;
  }
}

function applyVideoDisplayState(container: HTMLElement): void {
  const mode = normalizeVideoSubtitleDisplayMode(config.videoSubtitleDisplayMode);
  container.classList.toggle(VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS, mode === 'translation-only');
  container.classList.toggle(VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS, mode === 'original-only');
  container.classList.toggle(VIDEO_DISPLAY_HIDDEN_CLASS, config.videoSubtitleVisible === false);
  container.setAttribute('data-fluent-read-video-display-mode', mode);
  const layer = document.getElementById(VIDEO_TRANSLATION_LAYER_ID);
  layer?.classList.toggle(VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS, mode === 'original-only');
  layer?.classList.toggle(VIDEO_DISPLAY_HIDDEN_CLASS, config.videoSubtitleVisible === false);
  layer?.setAttribute('data-fluent-read-video-display-mode', mode);
}

function installVideoSubtitleStyle(): HTMLStyleElement {
  const existing = document.getElementById('fluent-read-video-subtitle-style');
  if (existing instanceof HTMLStyleElement) return existing;

  const style = document.createElement('style');
  style.id = 'fluent-read-video-subtitle-style';
  style.textContent = `
    #${VIDEO_TRANSLATION_LAYER_ID} {
      position: absolute !important;
      inset: 0 !important;
      z-index: 2147483645 !important;
      overflow: visible !important;
      pointer-events: none !important;
      visibility: visible !important;
    }
    #${VIDEO_TRANSLATION_OVERLAY_ID} {
      display: block !important;
      position: absolute !important;
      z-index: 2 !important;
      box-sizing: border-box !important;
      max-width: calc(100% - 24px) !important;
      margin: 0 !important;
      padding: 0.08em 0.24em !important;
      color: #ffe45c !important;
      font: 600 clamp(16px, 2.2vw, 30px)/1.35 Arial, sans-serif !important;
      text-align: center !important;
      text-shadow: 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 2px 4px rgba(0, 0, 0, .75) !important;
      white-space: pre-wrap !important;
      pointer-events: none !important;
      user-select: none !important;
      visibility: visible !important;
    }
    #${VIDEO_TRANSLATION_OVERLAY_ID}:empty { display: none !important; }
    #${VIDEO_TRANSLATION_LAYER_ID}.${VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS},
    #${VIDEO_TRANSLATION_LAYER_ID}.${VIDEO_DISPLAY_HIDDEN_CLASS} {
      visibility: hidden !important;
    }
    #${VIDEO_TRANSLATION_BUTTON_ID} {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      align-self: center !important;
      width: 48px !important;
      height: 48px !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      color: #fff !important;
      cursor: pointer !important;
      font: inherit !important;
      line-height: 1 !important;
      vertical-align: middle !important;
      opacity: .9 !important;
    }
    #${VIDEO_TRANSLATION_BUTTON_ID}:hover,
    #${VIDEO_TRANSLATION_BUTTON_ID}:focus-visible { opacity: 1 !important; }
    #${VIDEO_TRANSLATION_BUTTON_ID} .fluent-read-video-subtitle-button-icon {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 28px !important;
      height: 28px !important;
      border-radius: 7px !important;
      background: rgba(255, 255, 255, .18) !important;
      color: #fff !important;
      font: 700 15px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      line-height: 1 !important;
      transform: translateY(0) !important;
    }
    #${VIDEO_TRANSLATION_BUTTON_ID}.${VIDEO_TRANSLATION_ACTIVE_CLASS} .fluent-read-video-subtitle-button-icon {
      background: #ec4899 !important;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, .16), 0 2px 8px rgba(236, 72, 153, .42) !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} {
      position: absolute !important;
      right: 12px !important;
      bottom: 52px !important;
      z-index: 2147483646 !important;
      width: 286px !important;
      box-sizing: border-box !important;
      padding: 10px !important;
      border: 1px solid rgba(255, 255, 255, .12) !important;
      border-radius: 12px !important;
      background: rgba(30, 30, 30, .97) !important;
      box-shadow: 0 8px 28px rgba(0, 0, 0, .42) !important;
      color: #fff !important;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID}[hidden] { display: none !important; }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-title {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 4px 8px 8px !important;
      color: rgba(255, 255, 255, .92) !important;
      font-weight: 700 !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-heading {
      display: inline-flex !important;
      align-items: baseline !important;
      gap: 6px !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-brand {
      color: #ff8fbd !important;
      font-size: 10px !important;
      letter-spacing: .02em !important;
      font-weight: 800 !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-title-text {
      color: rgba(255, 255, 255, .92) !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-beta {
      color: #ff8fbd !important;
      font-size: 10px !important;
      font-weight: 700 !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-item,
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-mode {
      display: flex !important;
      align-items: center !important;
      width: 100% !important;
      min-height: 34px !important;
      box-sizing: border-box !important;
      margin: 1px 0 !important;
      padding: 6px 8px !important;
      border: 0 !important;
      border-radius: 7px !important;
      background: transparent !important;
      color: rgba(255, 255, 255, .9) !important;
      cursor: pointer !important;
      font: inherit !important;
      text-align: left !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-item:hover,
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-mode:hover,
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-item:focus-visible,
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-mode:focus-visible {
      background: rgba(255, 255, 255, .12) !important;
      outline: none !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-item:disabled {
      cursor: not-allowed !important;
      opacity: .55 !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-check {
      display: inline-block !important;
      width: 20px !important;
      color: #ff8fbd !important;
      font-weight: 800 !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-label { flex: 1 !important; }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-value {
      color: rgba(255, 255, 255, .58) !important;
      font-size: 11px !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-divider {
      height: 1px !important;
      margin: 7px 8px !important;
      background: rgba(255, 255, 255, .12) !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-caption {
      display: block !important;
      padding: 4px 8px 2px !important;
      color: rgba(255, 255, 255, .52) !important;
      font-size: 11px !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-mode {
      width: auto !important;
      flex: 1 !important;
      justify-content: center !important;
      padding: 5px 7px !important;
      color: rgba(255, 255, 255, .65) !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-mode[aria-checked="true"] {
      background: rgba(236, 72, 153, .24) !important;
      color: #fff !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-mode-group {
      display: flex !important;
      gap: 3px !important;
      padding: 2px 4px 4px !important;
    }
    #ytp-caption-window-container.${VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS} .ytp-caption-segment,
    #ytp-caption-window-container.${VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS} .captions-text,
    .ytp-caption-window-container.${VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS} .ytp-caption-segment,
    .ytp-caption-window-container.${VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS} .captions-text {
      visibility: hidden !important;
    }
    #ytp-caption-window-container.${VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS} #${VIDEO_TRANSLATION_OVERLAY_ID},
    .ytp-caption-window-container.${VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS} #${VIDEO_TRANSLATION_OVERLAY_ID},
    #ytp-caption-window-container.${VIDEO_DISPLAY_HIDDEN_CLASS},
    .ytp-caption-window-container.${VIDEO_DISPLAY_HIDDEN_CLASS} {
      visibility: hidden !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
  return style;
}

type VideoConfigPatch = Partial<Pick<Config, 'videoTranslationEnabled' | 'videoSubtitleVisible' | 'videoSubtitleDisplayMode'>>;

/**
 * 挂载 YouTube 播放器内的字幕翻译入口和原生字幕监听器。
 * 字幕来源仍然是 YouTube 已经渲染到页面的原生字幕，不采集音频或视频内容。
 */
export function mountVideoSubtitleTranslation(): () => void {
  if (!isYouTubeVideoPage()) return () => undefined;

  const style = installVideoSubtitleStyle();
  let destroyed = false;
  let generation = 0;
  let lastSource = '';
  let lastTranslatedSource = '';
  let lastTranslatedText = '';
  let videoPageKey = getYouTubeVideoPageKey();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let emptyCaptionTimer: ReturnType<typeof setTimeout> | undefined;
  let uiSyncTimer: number | undefined;
  let captionObserver: MutationObserver | undefined;
  let observedContainer: HTMLElement | null = null;
  let menuElement: HTMLElement | null = null;
  let buttonElement: HTMLButtonElement | null = null;
  let pendingTranslationSource = '';
  let pendingTranslationOverlay: HTMLElement | null = null;
  let translationLoopRunning = false;
  let stableCaptionTimer: ReturnType<typeof setTimeout> | undefined;
  let stableCaptionSource = '';
  let stableCaptionOverlay: HTMLElement | null = null;
  const capturedSubtitleTracks = new Map<string, { url: string; cues: VideoSubtitleCue[] }>();

  const clearRenderedTranslation = () => {
    document.querySelectorAll(`#${VIDEO_TRANSLATION_OVERLAY_ID}`).forEach((node) => {
      node.textContent = '';
    });
  };

  const cancelCaptionEmptyClear = () => {
    if (!emptyCaptionTimer) return;
    clearTimeout(emptyCaptionTimer);
    emptyCaptionTimer = undefined;
  };

  const cancelStableCaption = () => {
    if (stableCaptionTimer) clearTimeout(stableCaptionTimer);
    stableCaptionTimer = undefined;
    stableCaptionSource = '';
    stableCaptionOverlay = null;
  };

  const resetTranslationState = () => {
    cancelCaptionEmptyClear();
    cancelStableCaption();
    generation += 1;
    lastSource = '';
    lastTranslatedSource = '';
    lastTranslatedText = '';
    pendingTranslationSource = '';
    pendingTranslationOverlay = null;
    clearRenderedTranslation();
  };

  const scheduleCaptionEmptyClear = () => {
    if (emptyCaptionTimer) return;
    emptyCaptionTimer = setTimeout(() => {
      emptyCaptionTimer = undefined;
      if (destroyed || readVisibleCaptionText(findCaptionContainer())) return;
      resetTranslationState();
    }, VIDEO_CAPTION_EMPTY_GRACE_MS);
  };

  const closeMenu = () => {
    const menu = menuElement?.isConnected ? menuElement : document.getElementById(VIDEO_TRANSLATION_MENU_ID);
    const button = buttonElement?.isConnected ? buttonElement : document.getElementById(VIDEO_TRANSLATION_BUTTON_ID);
    if (menu) menu.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
  };

  const updatePlayerUiState = () => {
    const button = buttonElement?.isConnected ? buttonElement : document.getElementById(VIDEO_TRANSLATION_BUTTON_ID);
    const menu = menuElement?.isConnected ? menuElement : document.getElementById(VIDEO_TRANSLATION_MENU_ID);
    if (!button || !menu) return;
    if (button instanceof HTMLButtonElement) buttonElement = button;
    if (menu instanceof HTMLElement) menuElement = menu;

    const enabled = config.on && config.videoTranslationEnabled;
    const mode = normalizeVideoSubtitleDisplayMode(config.videoSubtitleDisplayMode);
    const visible = config.videoSubtitleVisible !== false;
    const status = config.on
      ? (config.videoTranslationEnabled ? '已开启' : '已关闭')
      : 'FluentRead 总开关已关闭';

    button.classList.toggle(VIDEO_TRANSLATION_ACTIVE_CLASS, enabled);
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-expanded', String(!menu.hidden));
    button.setAttribute('aria-label', `FluentRead 字幕翻译：${status}`);
    button.title = `FluentRead 字幕翻译：${status}`;

    const toggle = menu.querySelector<HTMLButtonElement>('[data-action="toggle-translation"]');
    if (toggle) {
      toggle.disabled = !config.on;
      toggle.setAttribute('aria-checked', String(enabled));
      toggle.querySelector<HTMLElement>('[data-check]')!.textContent = enabled ? '✓' : '';
      toggle.querySelector<HTMLElement>('[data-state]')!.textContent = status;
    }
    const service = menu.querySelector<HTMLElement>('[data-service-label]');
    if (service) service.textContent = getVideoServiceLabel(config.videoService);
    const visibility = menu.querySelector<HTMLButtonElement>('[data-action="toggle-visible"]');
    if (visibility) {
      visibility.setAttribute('aria-checked', String(visible));
      visibility.querySelector<HTMLElement>('[data-check]')!.textContent = visible ? '✓' : '';
      visibility.querySelector<HTMLElement>('[data-state]')!.textContent = visible ? '显示中' : '已隐藏';
    }
    menu.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((item) => {
      const selected = item.dataset.mode === mode;
      item.setAttribute('aria-checked', String(selected));
    });
  };

  const persistVideoConfig = (patch: VideoConfigPatch) => {
    const nextConfig = { ...config, ...patch };
    void saveConfig(nextConfig).catch((error) => {
      console.warn('[FluentRead] 视频字幕设置保存失败', error);
    });
  };

  const ensureNativeCaptions = () => {
    const nativeButton = document.querySelector<HTMLButtonElement>('.ytp-subtitles-button');
    if (nativeButton && nativeButton.getAttribute('aria-pressed') !== 'true') {
      nativeButton.click();
    }
  };

  const handleTimedTextMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data as { source?: unknown; type?: unknown; url?: unknown; responseText?: unknown } | null;
    if (data?.source !== 'fluent-read' || data.type !== YOUTUBE_TIMED_TEXT_MESSAGE) return;
    if (typeof data.url !== 'string' || typeof data.responseText !== 'string') return;

    const cues = finalizeVideoSubtitleCues(parseYoutubeTimedTextResponse(data.responseText));
    if (cues.length === 0) return;
    capturedSubtitleTracks.set(getTimedTextCacheKey(data.url), { url: data.url, cues });
  };

  const resolveDownloadTrack = async (): Promise<{ languageCode: string; cues: VideoSubtitleCue[] }> => {
    const captured = Array.from(capturedSubtitleTracks.values());
    const originalCaptured = captured.find((entry) => isOriginalTimedTextUrl(entry.url));
    if (originalCaptured) {
      const url = new URL(originalCaptured.url, window.location.href);
      return { languageCode: url.searchParams.get('lang') || 'original', cues: originalCaptured.cues };
    }
    if (captured[0]) {
      const url = new URL(captured[0].url, window.location.href);
      return { languageCode: url.searchParams.get('lang') || 'original', cues: captured[0].cues };
    }

    const track = chooseYoutubeCaptionTrack(extractYoutubeCaptionTracks(document), config.from);
    if (!track) throw new Error('当前视频没有可用的 YouTube 字幕轨道');
    const response = await fetch(buildYoutubeTimedTextUrl(track), { credentials: 'include' });
    if (!response.ok) throw new Error(`字幕轨道请求失败（${response.status}）`);
    const cues = finalizeVideoSubtitleCues(parseYoutubeTimedTextResponse(await response.text()));
    if (cues.length === 0) {
      throw new Error('YouTube 未返回完整字幕数据，请先打开原生字幕后重试');
    }
    return { languageCode: track.languageCode, cues };
  };

  const handleMenuClick = async (event: MouseEvent) => {
    const menu = menuElement;
    if (!menu || !(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('[data-action], [data-mode]');
    if (!target || !menu.contains(target) || (target instanceof HTMLButtonElement && target.disabled)) return;

    event.preventDefault();
    event.stopPropagation();

    if (target.dataset.action === 'toggle-translation') {
      const nextEnabled = !config.videoTranslationEnabled;
      persistVideoConfig({ videoTranslationEnabled: nextEnabled });
      if (nextEnabled) ensureNativeCaptions();
      return;
    }
    if (target.dataset.action === 'toggle-visible') {
      persistVideoConfig({ videoSubtitleVisible: config.videoSubtitleVisible === false });
      return;
    }
    if (target.dataset.action === 'download-subtitles') {
      const downloadButton = target as HTMLButtonElement;
      const state = downloadButton.querySelector<HTMLElement>('[data-state]');
      downloadButton.disabled = true;
      if (state) state.textContent = '准备中';
      try {
        const result = await resolveDownloadTrack();
        downloadSubtitleSrt(result.cues, result.languageCode);
        if (state) state.textContent = `已下载 ${result.cues.length} 条`;
      } catch (error) {
        if (state) state.textContent = '暂不可用';
        console.warn('[FluentRead] 字幕下载失败', error);
      } finally {
        window.setTimeout(() => {
          downloadButton.disabled = false;
          if (state) state.textContent = '';
        }, 2200);
      }
      return;
    }
    if (target.dataset.action === 'open-settings') {
      closeMenu();
      void browser.runtime.sendMessage({ type: 'openOptionsPage', section: 'settings-video' }).catch(() => undefined);
      return;
    }
    if (target.dataset.mode) {
      persistVideoConfig({ videoSubtitleDisplayMode: normalizeVideoSubtitleDisplayMode(target.dataset.mode) });
    }
  };

  const createMenuItem = (action: string, label: string): HTMLButtonElement => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'fluent-read-video-menu-item';
    item.dataset.action = action;
    item.setAttribute('role', action === 'toggle-translation' || action === 'toggle-visible' ? 'menuitemcheckbox' : 'menuitem');
    const check = createTextElement('span', 'fluent-read-video-menu-check', '');
    check.dataset.check = 'true';
    const labelElement = createTextElement('span', 'fluent-read-video-menu-label', label);
    const state = createTextElement('span', 'fluent-read-video-menu-value', '');
    state.dataset.state = 'true';
    item.append(check, labelElement, state);
    return item;
  };

  const createPlayerMenu = (player: HTMLElement): HTMLElement => {
    const menu = document.createElement('div');
    menu.id = VIDEO_TRANSLATION_MENU_ID;
    menu.className = 'fluent-read-video-subtitle-menu fluent-read-video-ui notranslate';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'FluentRead 视频字幕翻译菜单');
    markVideoUi(menu);

    const title = document.createElement('div');
    title.className = 'fluent-read-video-menu-title';
    const heading = document.createElement('span');
    heading.className = 'fluent-read-video-menu-heading';
    heading.append(
      createTextElement('span', 'fluent-read-video-menu-brand', 'FluentRead'),
      createTextElement('span', 'fluent-read-video-menu-title-text', '视频字幕翻译'),
    );
    title.append(
      heading,
      createTextElement('span', 'fluent-read-video-menu-beta', 'Beta'),
    );
    menu.appendChild(title);

    menu.appendChild(createMenuItem('toggle-translation', '开启字幕翻译'));
    const serviceCaption = createTextElement('span', 'fluent-read-video-menu-caption', '翻译服务');
    const serviceValue = createTextElement('span', 'fluent-read-video-menu-value', '');
    serviceValue.dataset.serviceLabel = 'true';
    serviceCaption.append('：', serviceValue);
    menu.appendChild(serviceCaption);

    const divider = createTextElement('div', 'fluent-read-video-menu-divider', '');
    divider.setAttribute('aria-hidden', 'true');
    menu.appendChild(divider);

    const modeCaption = createTextElement('span', 'fluent-read-video-menu-caption', '字幕显示模式');
    menu.appendChild(modeCaption);
    const modeGroup = document.createElement('div');
    modeGroup.className = 'fluent-read-video-menu-mode-group';
    modeGroup.setAttribute('role', 'radiogroup');
    modeGroup.setAttribute('aria-label', '字幕显示模式');
    (Object.keys(VIDEO_DISPLAY_MODE_LABELS) as VideoSubtitleDisplayMode[]).forEach((mode) => {
      const item = createTextElement('button', 'fluent-read-video-menu-mode', VIDEO_DISPLAY_MODE_LABELS[mode]);
      item.type = 'button';
      item.dataset.mode = mode;
      item.setAttribute('role', 'menuitemradio');
      modeGroup.appendChild(item);
    });
    menu.appendChild(modeGroup);

    menu.appendChild(createMenuItem('toggle-visible', '显示字幕'));
    const download = createMenuItem('download-subtitles', '下载字幕');
    download.querySelector('[data-check]')?.remove();
    menu.appendChild(download);
    const settings = createMenuItem('open-settings', '打开视频翻译设置');
    settings.querySelector('[data-check]')?.remove();
    settings.querySelector('[data-state]')?.remove();
    menu.appendChild(settings);
    player.appendChild(menu);
    bindMenuClick(menu);
    return menu;
  };

  const handleButtonClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const menu = menuElement?.isConnected ? menuElement : document.getElementById(VIDEO_TRANSLATION_MENU_ID);
    if (!(menu instanceof HTMLElement)) return;
    menuElement = menu;
    menu.hidden = !menu.hidden;
    updatePlayerUiState();
    if (!menu.hidden) {
      menu.querySelector<HTMLButtonElement>('[data-action="toggle-translation"]')?.focus();
    }
  };

  const bindButtonClick = (button: HTMLButtonElement) => {
    if (button.dataset.fluentReadClickBound === 'true') return;
    button.dataset.fluentReadClickBound = 'true';
    button.addEventListener('click', handleButtonClick);
  };

  const bindMenuClick = (menu: HTMLElement) => {
    if (menu.dataset.fluentReadClickBound === 'true') return;
    menu.dataset.fluentReadClickBound = 'true';
    menu.addEventListener('click', handleMenuClick);
  };

  const createPlayerButton = (): HTMLButtonElement => {
    const button = document.createElement('button');
    button.id = VIDEO_TRANSLATION_BUTTON_ID;
    button.className = 'ytp-button fluent-read-video-subtitle-button fluent-read-video-ui notranslate';
    button.type = 'button';
    button.setAttribute('role', 'button');
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'FluentRead 字幕翻译：已关闭');
    button.title = 'FluentRead 字幕翻译：已关闭';
    const icon = createTextElement('span', 'fluent-read-video-subtitle-button-icon', '译');
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
    markVideoUi(button);
    bindButtonClick(button);
    return button;
  };

  const ensurePlayerUi = () => {
    const player = findVideoPlayer();
    const controls = player?.querySelector<HTMLElement>(VIDEO_RIGHT_CONTROLS_SELECTOR);
    if (!player || !controls) return;

    let button = document.getElementById(VIDEO_TRANSLATION_BUTTON_ID);
    if (!(button instanceof HTMLButtonElement)) {
      button = createPlayerButton();
    }
    const playerButton = button as HTMLButtonElement;
    bindButtonClick(playerButton);
    if (playerButton.parentElement !== controls) {
      const rightControlsGroup = Array.from(controls.children)
        .find((child) => child.matches('.ytp-right-controls-right, .ytp-settings-button')) || null;
      if (rightControlsGroup) {
        controls.insertBefore(playerButton, rightControlsGroup);
      } else {
        controls.appendChild(playerButton);
      }
    }
    buttonElement = playerButton;

    let menu = document.getElementById(VIDEO_TRANSLATION_MENU_ID);
    if (!(menu instanceof HTMLElement)) {
      menu = createPlayerMenu(player);
    } else if (menu.parentElement !== player) {
      player.appendChild(menu);
    }
    menuElement = menu;
    bindMenuClick(menu);
    markVideoUi(playerButton);
    markVideoUi(menu);
    updatePlayerUiState();
  };

  const handleDocumentClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (buttonElement?.contains(target) || menuElement?.contains(target)) return;
    closeMenu();
  };

  const handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeMenu();
  };

  const startTranslationLoop = () => {
    if (translationLoopRunning) return;

    translationLoopRunning = true;
    void (async () => {
      try {
        while (!destroyed && pendingTranslationSource) {
          const nextSource = pendingTranslationSource;
          const nextOverlay = pendingTranslationOverlay;
          pendingTranslationSource = '';
          pendingTranslationOverlay = null;
          const requestGeneration = generation;
          try {
            const translated = await translateVideoText(nextSource);
            if (!nextOverlay || destroyed || requestGeneration !== generation || nextSource !== lastSource) continue;
            const result = typeof translated === 'string' ? translated.trim() : '';
            lastTranslatedSource = nextSource;
            lastTranslatedText = result && result !== nextSource ? result : '';
            const currentContainer = findCaptionContainer();
            if (!lastTranslatedText || !currentContainer || readVisibleCaptionText(currentContainer) !== nextSource) continue;
            nextOverlay.textContent = lastTranslatedText;
            syncTranslationOverlayPosition(currentContainer);
          } catch (error) {
            if (!destroyed && requestGeneration === generation) {
              console.warn('[FluentRead] 视频字幕翻译失败', error);
            }
          }
        }
      } finally {
        translationLoopRunning = false;
      }
    })();
  };

  const commitStableCaption = (source: string, overlay: HTMLElement, container: HTMLElement) => {
    if (destroyed || readVisibleCaptionText(container) !== source || source === lastSource) return;

    lastSource = source;
    ++generation;
    lastTranslatedSource = '';
    lastTranslatedText = '';
    overlay.textContent = '';
    syncTranslationOverlayPosition(container);

    pendingTranslationSource = source;
    pendingTranslationOverlay = overlay;
    startTranslationLoop();
  };

  const scheduleStableCaption = (source: string, overlay: HTMLElement) => {
    if (stableCaptionTimer && stableCaptionSource === source) return;

    cancelStableCaption();
    stableCaptionSource = source;
    stableCaptionOverlay = overlay;
    stableCaptionTimer = setTimeout(() => {
      stableCaptionTimer = undefined;
      const nextSource = stableCaptionSource;
      const nextOverlay = stableCaptionOverlay;
      stableCaptionSource = '';
      stableCaptionOverlay = null;
      if (destroyed || !nextSource) return;

      const container = findCaptionContainer();
      const player = findVideoPlayer();
      if (!container || !player || readVisibleCaptionText(container) !== nextSource) return;
      const currentOverlay = nextOverlay?.isConnected ? nextOverlay : getOrCreateTranslationOverlay(player);
      commitStableCaption(nextSource, currentOverlay, container);
    }, VIDEO_CAPTION_STABILITY_MS);
  };

  const updateCaption = () => {
    if (destroyed) return;

    const container = findCaptionContainer();
    if (!container) {
      captionObserver?.disconnect();
      captionObserver = undefined;
      observedContainer = null;
      scheduleCaptionEmptyClear();
      return;
    }

    container.classList.add('notranslate');
    applyVideoDisplayState(container);
    const displayMode = normalizeVideoSubtitleDisplayMode(config.videoSubtitleDisplayMode);
    const canTranslate = config.on && config.videoTranslationEnabled && config.videoSubtitleVisible !== false && displayMode !== 'original-only';
    if (!canTranslate) {
      resetTranslationState();
      return;
    }

    const player = findVideoPlayer();
    if (!player) return;
    const source = readVisibleCaptionText(container);
    const overlay = getOrCreateTranslationOverlay(player);

    if (!source) {
      scheduleCaptionEmptyClear();
      return;
    }

    cancelCaptionEmptyClear();
    if (source === lastSource) {
      syncTranslationOverlayPosition(container);
      if (lastTranslatedSource === source && lastTranslatedText && overlay.textContent !== lastTranslatedText) {
        overlay.textContent = lastTranslatedText;
        syncTranslationOverlayPosition(container);
      }
      return;
    }

    // 自动字幕会先逐词写入 DOM；只有连续稳定一小段时间后才提交翻译请求。
    // 在等待期间保留原生字幕，避免每个半句都触发译文闪烁。
    scheduleStableCaption(source, overlay);
  };

  const scheduleUpdate = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateCaption, 120);
  };

  const observeCaptionContainer = () => {
    const container = findCaptionContainer();
    if (!container) {
      captionObserver?.disconnect();
      captionObserver = undefined;
      observedContainer = null;
      scheduleCaptionEmptyClear();
      return;
    }
    if (container === observedContainer && container.isConnected) {
      applyVideoDisplayState(container);
      return;
    }

    captionObserver?.disconnect();
    observedContainer = container;
    container.classList.add('notranslate');
    applyVideoDisplayState(container);
    captionObserver = new MutationObserver(scheduleUpdate);
    captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
    scheduleUpdate();
  };

  const syncPlayerUi = () => {
    if (destroyed) return;
    const nextVideoPageKey = getYouTubeVideoPageKey();
    if (nextVideoPageKey !== videoPageKey) {
      videoPageKey = nextVideoPageKey;
      captionObserver?.disconnect();
      captionObserver = undefined;
      observedContainer = null;
      resetTranslationState();
    }
    ensurePlayerUi();
    observeCaptionContainer();
    syncTranslationOverlayPosition(observedContainer);
  };

  document.addEventListener('click', handleDocumentClick, true);
  document.addEventListener('keydown', handleDocumentKeydown, true);
  window.addEventListener('message', handleTimedTextMessage);
  syncPlayerUi();
  uiSyncTimer = window.setInterval(syncPlayerUi, 1000);

  const unsubscribeConfig = subscribeConfig((nextConfig) => {
    updatePlayerUiState();
    if (observedContainer) {
      applyVideoDisplayState(observedContainer);
      syncTranslationOverlayPosition(observedContainer);
    }
    if (!nextConfig.on || !nextConfig.videoTranslationEnabled || nextConfig.videoSubtitleVisible === false || normalizeVideoSubtitleDisplayMode(nextConfig.videoSubtitleDisplayMode) === 'original-only') {
      resetTranslationState();
      return;
    }
    observeCaptionContainer();
    scheduleUpdate();
  });

  return () => {
    destroyed = true;
    generation += 1;
    pendingTranslationSource = '';
    pendingTranslationOverlay = null;
    if (debounceTimer) clearTimeout(debounceTimer);
    cancelCaptionEmptyClear();
    cancelStableCaption();
    if (uiSyncTimer !== undefined) window.clearInterval(uiSyncTimer);
    captionObserver?.disconnect();
    unsubscribeConfig();
    document.removeEventListener('click', handleDocumentClick, true);
    document.removeEventListener('keydown', handleDocumentKeydown, true);
    window.removeEventListener('message', handleTimedTextMessage);
    closeMenu();
    document.querySelectorAll(`#${VIDEO_TRANSLATION_BUTTON_ID}, #${VIDEO_TRANSLATION_MENU_ID}`).forEach((node) => node.remove());
    removeTranslationOverlay();
    document.querySelectorAll(VIDEO_CAPTION_CONTAINER_SELECTOR).forEach((node) => {
      node.classList.remove('notranslate', VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS, VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS, VIDEO_DISPLAY_HIDDEN_CLASS);
      node.removeAttribute('data-fluent-read-video-display-mode');
    });
    style.remove();
  };
}

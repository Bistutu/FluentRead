import { config, subscribeConfig } from '@/entrypoints/utils/config';
import { translateVideoText } from '@/entrypoints/utils/translateApi';

export const VIDEO_CAPTION_CONTAINER_SELECTOR = '#ytp-caption-window-container, .ytp-caption-window-container';
export const VIDEO_CAPTION_SEGMENT_SELECTOR = '.ytp-caption-segment, .captions-text';
export const VIDEO_TRANSLATION_OVERLAY_ID = 'fluent-read-video-subtitle';

const YOUTUBE_HOST_PATTERN = /(^|\.)youtube\.com$/i;
const YOUTUBE_MOBILE_HOST_PATTERN = /(^|\.)youtube-nocookie\.com$/i;

export function isYouTubeVideoPage(locationLike: Pick<Location, 'hostname' | 'pathname'> = window.location): boolean {
  const isYouTubeHost = YOUTUBE_HOST_PATTERN.test(locationLike.hostname) || YOUTUBE_MOBILE_HOST_PATTERN.test(locationLike.hostname);
  return isYouTubeHost && (locationLike.pathname === '/watch' || locationLike.pathname === '/shorts');
}

/** 读取当前播放器可见的原生字幕，不读取插件自己的译文节点。 */
export function readVisibleCaptionText(container: Element | null): string {
  if (!container) return '';

  const segments = Array.from(container.querySelectorAll(VIDEO_CAPTION_SEGMENT_SELECTOR))
    .map((segment) => segment.textContent?.replace(/[\s\u3000]+/g, ' ').trim() || '')
    .filter(Boolean);

  return segments.join(' ').replace(/[\s\u3000]+/g, ' ').trim();
}

function findCaptionContainer(): HTMLElement | null {
  return document.querySelector(VIDEO_CAPTION_CONTAINER_SELECTOR);
}

function getOrCreateTranslationOverlay(container: HTMLElement): HTMLElement {
  const existing = container.querySelector<HTMLElement>(`#${VIDEO_TRANSLATION_OVERLAY_ID}`);
  if (existing) return existing;

  const overlay = document.createElement('div');
  overlay.id = VIDEO_TRANSLATION_OVERLAY_ID;
  overlay.className = 'fluent-read-video-subtitle notranslate';
  overlay.setAttribute('data-fluent-read-ui', 'video-subtitle');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-label', 'FluentRead 视频字幕译文');
  container.appendChild(overlay);
  return overlay;
}

function removeTranslationOverlay(): void {
  document.querySelectorAll(`#${VIDEO_TRANSLATION_OVERLAY_ID}`).forEach((node) => node.remove());
}

function installVideoSubtitleStyle(): HTMLStyleElement {
  const existing = document.getElementById('fluent-read-video-subtitle-style');
  if (existing instanceof HTMLStyleElement) return existing;

  const style = document.createElement('style');
  style.id = 'fluent-read-video-subtitle-style';
  style.textContent = `
    #${VIDEO_TRANSLATION_OVERLAY_ID} {
      display: block !important;
      position: relative !important;
      z-index: 2 !important;
      box-sizing: border-box !important;
      max-width: min(92vw, 960px) !important;
      margin: 0.24em auto 0 !important;
      padding: 0.08em 0.24em !important;
      color: #ffe45c !important;
      font: 600 0.82em/1.35 Arial, sans-serif !important;
      text-align: center !important;
      text-shadow: 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 2px 4px rgba(0, 0, 0, .75) !important;
      white-space: pre-wrap !important;
      pointer-events: none !important;
      user-select: none !important;
    }
    #${VIDEO_TRANSLATION_OVERLAY_ID}:empty { display: none !important; }
  `;
  (document.head || document.documentElement).appendChild(style);
  return style;
}

/**
 * 挂载 YouTube 原生字幕监听器。返回清理函数，供页面卸载和 Beta 开关使用。
 * 字幕变化使用 generation 防止慢请求覆盖后续字幕，且只保留一个译文节点。
 */
export function mountVideoSubtitleTranslation(): () => void {
  if (!isYouTubeVideoPage()) return () => undefined;

  const style = installVideoSubtitleStyle();
  let destroyed = false;
  let generation = 0;
  let lastSource = '';
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let captionObserver: MutationObserver | undefined;
  let pageObserver: MutationObserver | undefined;
  let observedContainer: HTMLElement | null = null;

  const clearRenderedTranslation = () => {
    const overlay = document.getElementById(VIDEO_TRANSLATION_OVERLAY_ID);
    if (overlay) overlay.textContent = '';
  };

  const updateCaption = () => {
    if (destroyed || !config.on || !config.videoTranslationEnabled) return;

    const container = findCaptionContainer();
    if (!container) {
      observedContainer = null;
      clearRenderedTranslation();
      return;
    }

    container.classList.add('notranslate');
    const source = readVisibleCaptionText(container);
    const overlay = getOrCreateTranslationOverlay(container);

    if (source === lastSource) return;
    lastSource = source;
    const currentGeneration = ++generation;
    overlay.textContent = '';
    if (!source) return;

    void translateVideoText(source).then((translated) => {
      if (destroyed || currentGeneration !== generation || source !== lastSource) return;
      const result = typeof translated === 'string' ? translated.trim() : '';
      if (result && result !== source) overlay.textContent = result;
    }).catch((error) => {
      if (!destroyed && currentGeneration === generation) {
        console.warn('[FluentRead] 视频字幕翻译失败', error);
      }
    });
  };

  const scheduleUpdate = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateCaption, 80);
  };

  const observeCaptionContainer = () => {
    const container = findCaptionContainer();
    if (!container || container === observedContainer) return;

    captionObserver?.disconnect();
    observedContainer = container;
    container.classList.add('notranslate');
    captionObserver = new MutationObserver(scheduleUpdate);
    captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
    scheduleUpdate();
  };

  pageObserver = new MutationObserver(() => {
    observeCaptionContainer();
    scheduleUpdate();
  });
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });
  observeCaptionContainer();

  const unsubscribeConfig = subscribeConfig((nextConfig) => {
    if (!nextConfig.on || !nextConfig.videoTranslationEnabled) {
      generation += 1;
      lastSource = '';
      clearRenderedTranslation();
      return;
    }
    observeCaptionContainer();
    scheduleUpdate();
  });

  return () => {
    destroyed = true;
    generation += 1;
    if (debounceTimer) clearTimeout(debounceTimer);
    captionObserver?.disconnect();
    pageObserver?.disconnect();
    unsubscribeConfig();
    removeTranslationOverlay();
    document.querySelectorAll(VIDEO_CAPTION_CONTAINER_SELECTOR).forEach((node) => node.classList.remove('notranslate'));
    style.remove();
  };
}

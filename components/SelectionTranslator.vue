<template>
  <div v-show="showIndicator || showTooltip || copySuccess" class="fr-selection-translator-root" @pointerdown.stop>
    <button v-if="showIndicator && !showTooltip" class="fr-selection-indicator" :class="`fr-selection-indicator--${triggerMode}`" :style="indicatorStyle" type="button" aria-label="打开划词翻译" title="打开划词翻译" @pointerdown.prevent.stop @click="openTooltip">
      <span class="fr-selection-indicator-glyph" aria-hidden="true">↗</span>
    </button>

    <section v-if="showTooltip" ref="tooltip-ref" class="fr-translation-tooltip" :class="{ 'fr-dark-theme': isDarkTheme }" :data-placement="popupPlacement" :style="tooltipStyle" role="dialog" aria-label="划词翻译结果" @pointerdown.prevent.stop>
      <header class="fr-tooltip-header">
        <span>翻译结果 <small>via FluentRead</small></span>
        <div class="fr-tooltip-actions">
          <button class="fr-action-btn" type="button" title="复制译文" aria-label="复制译文" @click="copyTranslation"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
          <button class="fr-close-btn" type="button" title="关闭" aria-label="关闭翻译结果" @click="closeTooltip">×</button>
        </div>
      </header>

      <div class="fr-tooltip-content" aria-live="polite">
        <div v-if="isLoading" class="fr-loading-state"><span :class="['fr-loading-spinner', { 'fr-static': !config.animations }]" aria-hidden="true" /><span>正在翻译…</span></div>
        <div v-else-if="error" class="fr-error-state"><span>{{ error }}</span><button type="button" @click="retryTranslation">重试</button></div>
        <div v-else class="fr-translation-container">
          <div v-if="config.selectionTranslatorMode === 'bilingual'" class="fr-text-block fr-original-text">
            <div class="fr-text-label">原文</div><pre>{{ selectedText }}</pre>
            <button class="fr-text-audio-btn" type="button" :aria-label="audioLabel('source')" :title="audioLabel('source')" @click="toggleAudio(selectedText, 'source')"><span v-if="isCurrentAudio('source')" aria-hidden="true">Ⅱ</span><span v-else aria-hidden="true">🔊</span></button>
          </div>
          <div v-if="config.selectionTranslatorMode === 'bilingual' || config.selectionTranslatorMode === 'translation-only'" class="fr-text-block fr-translation-result">
            <div class="fr-text-label">译文</div><pre>{{ translationResult }}</pre>
            <button class="fr-text-audio-btn" type="button" :aria-label="audioLabel('translation')" :title="audioLabel('translation')" @click="toggleAudio(translationResult, 'translation')"><span v-if="isCurrentAudio('translation')" aria-hidden="true">Ⅱ</span><span v-else aria-hidden="true">🔊</span></button>
          </div>
          <div v-if="isPlaying" class="fr-playing-status"><span>正在播放{{ currentAudioKind === 'source' ? '原文' : '译文' }}</span><button type="button" aria-label="停止播放" title="停止播放" @click="stopAudio">停止</button></div>
        </div>
      </div>
    </section>

    <div v-if="copySuccess" class="fr-copy-success-toast" :class="{ 'fr-dark-theme': isDarkTheme }" role="status">已复制译文</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { config } from '@/entrypoints/utils/config';
import { translateText } from '@/entrypoints/utils/translateApi';
import { detectlang } from '@/entrypoints/utils/common';
import { calculateSelectionPopupPosition, chooseSelectionRect, normalizeSelectionText, normalizeSpeechLanguage, type SelectionRect } from '@/entrypoints/utils/selectionTranslatorCore';

type SelectionTrigger = 'direct' | 'icon' | 'dot';
type AudioKind = 'source' | 'translation';
interface SelectionSnapshot { text: string; range: Range; anchor: SelectionRect; isForward: boolean; }

const tooltipRef = useTemplateRef<HTMLElement>('tooltip-ref');
const selectedText = ref('');
const translationResult = ref('');
const isLoading = ref(false);
const error = ref('');
const showIndicator = ref(false);
const showTooltip = ref(false);
const copySuccess = ref(false);
const isDarkTheme = ref(false);
const indicatorStyle = ref<Record<string, string>>({});
const tooltipStyle = ref<Record<string, string>>({});
const popupPlacement = ref<'top' | 'bottom'>('top');
const snapshot = ref<SelectionSnapshot | null>(null);
const isPlaying = ref(false);
const currentAudioKind = ref<AudioKind | null>(null);
const currentAudioText = ref('');

let selectionFrame: number | null = null;
let positionFrame: number | null = null;
let translationRequestId = 0;
let copyTimer: number | null = null;
let audio: HTMLAudioElement | null = null;
let utterance: SpeechSynthesisUtterance | null = null;
let isSelecting = false;
let systemThemeMedia: MediaQueryList | null = null;

const triggerMode = computed<SelectionTrigger>(() => config.selectionTranslatorTrigger === 'direct' || config.selectionTranslatorTrigger === 'dot' ? config.selectionTranslatorTrigger : 'icon');

function updateTheme(): void {
  isDarkTheme.value = config.theme === 'dark' || (config.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function toSelectionRect(rect: DOMRect | DOMRectReadOnly): SelectionRect {
  return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
}

function isExtensionSelection(selection: Selection): boolean {
  const host = document.getElementById('fluent-read-selection-translator-container');
  return Boolean(host && selection.containsNode(host, true));
}

function readSelectionSnapshot(): SelectionSnapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || isExtensionSelection(selection)) return null;
  const text = normalizeSelectionText(selection.toString());
  if (!text || text.length > 4096) return null;

  const range = selection.getRangeAt(0).cloneRange();
  const rects = Array.from(range.getClientRects()).map(toSelectionRect).filter(rect => rect.width > 0 || rect.height > 0);
  const fallbackRect = toSelectionRect(range.getBoundingClientRect());
  const visualRects = rects.length > 0 ? rects : [fallbackRect];
  const isForward = selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset;
  const anchor = chooseSelectionRect(visualRects, isForward);
  if (!anchor || (anchor.width === 0 && anchor.height === 0)) return null;
  return { text, range, anchor, isForward };
}

function scheduleSelectionRead(): void {
  if (selectionFrame !== null) return;
  selectionFrame = window.requestAnimationFrame(() => { selectionFrame = null; if (!isSelecting) applySelection(readSelectionSnapshot()); });
}

function applySelection(next: SelectionSnapshot | null): void {
  if (!next) { if (!isSelecting) hideAll(); return; }
  const changedText = selectedText.value !== next.text;
  snapshot.value = next;
  selectedText.value = next.text;
  showIndicator.value = triggerMode.value !== 'direct';
  showTooltip.value = triggerMode.value === 'direct';
  if (changedText) { translationResult.value = ''; error.value = ''; }
  updatePosition();
  if (showTooltip.value) void requestTranslation(next.text);
}

function updatePosition(): void {
  const current = snapshot.value;
  if (!current) return;
  const rects = Array.from(current.range.getClientRects()).map(toSelectionRect).filter(rect => rect.width > 0 || rect.height > 0);
  const anchor = chooseSelectionRect(rects.length > 0 ? rects : [current.anchor], current.isForward);
  if (!anchor) return;
  current.anchor = anchor;
  indicatorStyle.value = { left: `${anchor.right}px`, top: `${anchor.bottom}px` };
  if (showTooltip.value) void nextTick(() => {
    const tooltip = tooltipRef.value;
    if (!tooltip || !snapshot.value) return;
    const rect = tooltip.getBoundingClientRect();
    const position = calculateSelectionPopupPosition(snapshot.value.anchor, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
    tooltipStyle.value = { left: `${position.left}px`, top: `${position.top}px` };
    popupPlacement.value = position.placement;
  });
}

function schedulePositionUpdate(): void {
  if (!showIndicator.value && !showTooltip.value) return;
  if (positionFrame !== null) return;
  positionFrame = window.requestAnimationFrame(() => { positionFrame = null; updatePosition(); });
}

function openTooltip(): void {
  if (!snapshot.value) return;
  showIndicator.value = true;
  showTooltip.value = true;
  void requestTranslation(snapshot.value.text);
  schedulePositionUpdate();
}

async function requestTranslation(text: string): Promise<void> {
  const requestId = ++translationRequestId;
  isLoading.value = true;
  error.value = '';
  try {
    const result = await translateText(text);
    if (requestId !== translationRequestId || snapshot.value?.text !== text) return;
    translationResult.value = result;
  } catch (cause) {
    if (requestId !== translationRequestId || snapshot.value?.text !== text) return;
    console.error('Selection translation error:', cause);
    error.value = '翻译失败，请重试';
  } finally {
    if (requestId === translationRequestId) isLoading.value = false;
  }
}

function retryTranslation(): void { if (snapshot.value) void requestTranslation(snapshot.value.text); }

async function copyTranslation(): Promise<void> {
  if (!translationResult.value) return;
  try {
    await navigator.clipboard.writeText(translationResult.value);
    copySuccess.value = true;
    if (copyTimer !== null) window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => { copySuccess.value = false; }, 1500);
  } catch (cause) { console.error('Copy translation failed:', cause); }
}

function sourceLanguage(text: string): string { return normalizeSpeechLanguage(config.from === 'auto' ? detectlang(text) : config.from, 'en-US'); }
function translationLanguage(): string { return normalizeSpeechLanguage(config.to, 'zh-CN'); }
function speechLanguage(text: string, kind: AudioKind): string { return kind === 'source' ? sourceLanguage(text) : translationLanguage(); }

function selectVoice(language: string): SpeechSynthesisVoice | undefined {
  if (!('speechSynthesis' in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  const exact = voices.find(voice => voice.lang.toLowerCase() === language.toLowerCase());
  if (exact) return exact;
  const base = language.split('-')[0]?.toLowerCase();
  return voices.find(voice => voice.lang.toLowerCase().startsWith(`${base}-`) || voice.lang.toLowerCase() === base);
}

function isCurrentAudio(kind: AudioKind): boolean { return isPlaying.value && currentAudioKind.value === kind; }
function audioLabel(kind: AudioKind): string { return isCurrentAudio(kind) ? `停止播放${kind === 'source' ? '原文' : '译文'}` : `播放${kind === 'source' ? '原文' : '译文'}`; }

function stopAudio(): void {
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio = null; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  utterance = null;
  isPlaying.value = false;
  currentAudioKind.value = null;
  currentAudioText.value = '';
}

function playBrowserSpeech(text: string, language: string, kind: AudioKind): boolean {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return false;
  try {
    const nextUtterance = new SpeechSynthesisUtterance(text);
    nextUtterance.lang = language;
    nextUtterance.voice = selectVoice(language) ?? null;
    nextUtterance.onend = () => { if (utterance === nextUtterance) stopAudio(); };
    nextUtterance.onerror = event => { if (utterance === nextUtterance && event.error !== 'canceled' && event.error !== 'interrupted') stopAudio(); };
    utterance = nextUtterance;
    currentAudioKind.value = kind;
    currentAudioText.value = text;
    isPlaying.value = true;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(nextUtterance);
    return true;
  } catch (cause) { console.warn('Browser speech synthesis unavailable:', cause); return false; }
}

function playGoogleFallback(text: string, language: string, kind: AudioKind): void {
  const speechUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(language)}&client=tw-ob&q=${encodeURIComponent(text)}`;
  const nextAudio = new Audio(speechUrl);
  nextAudio.onended = stopAudio;
  nextAudio.onerror = () => { console.warn('Fallback speech audio failed'); stopAudio(); };
  audio = nextAudio;
  currentAudioKind.value = kind;
  currentAudioText.value = text;
  isPlaying.value = true;
  void nextAudio.play().catch(() => stopAudio());
}

function toggleAudio(text: string, kind: AudioKind): void {
  const cleanText = text.trim();
  if (!cleanText) return;
  if (isCurrentAudio(kind) && currentAudioText.value === cleanText) { stopAudio(); return; }
  stopAudio();
  const language = speechLanguage(cleanText, kind);
  if (!playBrowserSpeech(cleanText, language, kind)) playGoogleFallback(cleanText, language, kind);
}

function closeTooltip(): void { hideAll(); }
function hideAll(): void { translationRequestId++; showIndicator.value = false; showTooltip.value = false; snapshot.value = null; stopAudio(); }
function isInsideUi(target: EventTarget | null): boolean {
  const node = target instanceof Node ? target : null;
  if (!node) return false;
  const host = document.getElementById('fluent-read-selection-translator-container');
  return Boolean(node === host || host?.contains(node) || node.getRootNode() instanceof ShadowRoot);
}
function handlePointerDown(event: PointerEvent): void { if (isInsideUi(event.target)) return; isSelecting = true; if (showTooltip.value) hideAll(); }
function handlePointerUp(event: PointerEvent): void { if (isInsideUi(event.target)) return; isSelecting = false; scheduleSelectionRead(); }
function handleSelectionChange(): void { scheduleSelectionRead(); }
function handleKeydown(event: KeyboardEvent): void { if (event.key === 'Escape' && (showIndicator.value || showTooltip.value)) hideAll(); }

onMounted(() => {
  updateTheme();
  systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  systemThemeMedia.addEventListener('change', updateTheme);
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('pointerup', handlePointerUp, true);
  document.addEventListener('selectionchange', handleSelectionChange);
  document.addEventListener('keydown', handleKeydown, true);
  window.addEventListener('scroll', schedulePositionUpdate, true);
  window.addEventListener('resize', schedulePositionUpdate);
  watch(() => [config.theme, config.selectionTranslatorTrigger] as const, () => {
    updateTheme();
    if (snapshot.value) {
      showIndicator.value = triggerMode.value !== 'direct';
      showTooltip.value = triggerMode.value === 'direct';
      if (showTooltip.value) void requestTranslation(snapshot.value.text);
      schedulePositionUpdate();
    }
  });
});

onBeforeUnmount(() => {
  if (selectionFrame !== null) window.cancelAnimationFrame(selectionFrame);
  if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
  if (copyTimer !== null) window.clearTimeout(copyTimer);
  systemThemeMedia?.removeEventListener('change', updateTheme);
  document.removeEventListener('pointerdown', handlePointerDown, true);
  document.removeEventListener('pointerup', handlePointerUp, true);
  document.removeEventListener('selectionchange', handleSelectionChange);
  document.removeEventListener('keydown', handleKeydown, true);
  window.removeEventListener('scroll', schedulePositionUpdate, true);
  window.removeEventListener('resize', schedulePositionUpdate);
  stopAudio();
});
</script>

<style scoped>
.fr-selection-translator-root { position: fixed; inset: 0; z-index: 2147483647; width: 100vw; height: 100vh; pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #25252a; }
.fr-selection-indicator, .fr-translation-tooltip, .fr-copy-success-toast { pointer-events: auto; }
.fr-selection-indicator { position: fixed; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; transform: translate(-50%, -50%); background: #ef4b86; color: #fff; box-shadow: 0 4px 14px rgba(204, 40, 104, .35), 0 0 0 3px rgba(255, 255, 255, .92); cursor: pointer; transition: transform .14s ease, box-shadow .14s ease; }
.fr-selection-indicator--dot { width: 14px; height: 14px; }
.fr-selection-indicator--dot .fr-selection-indicator-glyph { display: none; }
.fr-selection-indicator:hover, .fr-selection-indicator:focus-visible { transform: translate(-50%, -50%) scale(1.12); box-shadow: 0 5px 18px rgba(204, 40, 104, .45), 0 0 0 4px rgba(255, 255, 255, .95); outline: none; }
.fr-selection-indicator-glyph { font-size: 15px; font-weight: 700; line-height: 1; }
.fr-translation-tooltip { position: fixed; width: min(380px, calc(100vw - 24px)); max-height: min(520px, calc(100vh - 24px)); overflow: hidden; border: 1px solid rgba(28, 28, 36, .08); border-radius: 14px; background: rgba(255, 255, 255, .98); box-shadow: 0 16px 45px rgba(30, 28, 40, .18), 0 2px 8px rgba(30, 28, 40, .08); backdrop-filter: blur(16px); }
.fr-tooltip-header { display: flex; align-items: center; justify-content: space-between; padding: 13px 15px; border-bottom: 1px solid #f0f0f3; font-size: 15px; font-weight: 700; }
.fr-tooltip-header small { color: #90909a; font-size: 11px; font-weight: 500; }
.fr-tooltip-actions { display: flex; align-items: center; gap: 4px; }
.fr-action-btn, .fr-close-btn, .fr-text-audio-btn, .fr-playing-status button { border: 0; background: transparent; color: #777780; cursor: pointer; }
.fr-action-btn { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 7px; }
.fr-action-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.fr-action-btn:hover, .fr-action-btn:focus-visible { background: #f4f4f7; color: #ef4b86; outline: none; }
.fr-close-btn { width: 28px; height: 28px; font-size: 23px; line-height: 1; border-radius: 7px; }
.fr-close-btn:hover, .fr-close-btn:focus-visible { background: #f4f4f7; color: #303038; outline: none; }
.fr-tooltip-content { max-height: min(460px, calc(100vh - 82px)); overflow: auto; padding: 14px; }
.fr-loading-state, .fr-error-state { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 80px; color: #777780; font-size: 13px; }
.fr-error-state { flex-direction: column; color: #c43b63; }
.fr-error-state button { border: 1px solid currentColor; border-radius: 7px; padding: 4px 10px; background: transparent; color: inherit; cursor: pointer; }
.fr-loading-spinner { width: 18px; height: 18px; border: 2px solid #f5bfd3; border-top-color: #ef4b86; border-radius: 50%; animation: fr-spin .7s linear infinite; }
.fr-loading-spinner.fr-static { animation: none; }
@keyframes fr-spin { to { transform: rotate(360deg); } }
.fr-text-block { position: relative; padding: 10px 36px 10px 12px; border-radius: 10px; }
.fr-text-block + .fr-text-block { margin-top: 10px; }
.fr-original-text { background: #f7f7f9; color: #666670; }
.fr-translation-result { background: #fff3f7; color: #33333a; }
.fr-text-label { margin-bottom: 4px; color: #9a9aa4; font-size: 11px; font-weight: 700; }
.fr-text-block pre { max-height: 190px; margin: 0; overflow: auto; white-space: pre-wrap; word-break: break-word; font: inherit; line-height: 1.55; }
.fr-text-audio-btn { position: absolute; top: 10px; right: 8px; width: 28px; height: 28px; border-radius: 8px; font-size: 15px; }
.fr-text-audio-btn:hover, .fr-text-audio-btn:focus-visible { background: rgba(239, 75, 134, .13); color: #ef4b86; outline: none; }
.fr-playing-status { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; color: #777780; font-size: 12px; }
.fr-playing-status button { border: 1px solid #e8a4bc; border-radius: 7px; padding: 3px 8px; color: #d83e70; }
.fr-copy-success-toast { position: fixed; right: 18px; bottom: 18px; padding: 9px 13px; border-radius: 9px; background: #2c2c35; color: #fff; font-size: 12px; box-shadow: 0 6px 18px rgba(0, 0, 0, .18); }
.fr-dark-theme { border-color: #44444e; background: rgba(40, 40, 48, .98); color: #f1f1f4; }
.fr-dark-theme .fr-tooltip-header { border-color: #4b4b56; }
.fr-dark-theme .fr-action-btn:hover, .fr-dark-theme .fr-close-btn:hover { background: #50505b; color: #fff; }
.fr-dark-theme .fr-original-text { background: #34343d; color: #d0d0d7; }
.fr-dark-theme .fr-translation-result { background: #4b2e3a; color: #fff0f5; }
@media (prefers-reduced-motion: reduce) { .fr-selection-indicator, .fr-loading-spinner { transition: none; animation: none; } }
</style>

<template>
  <div v-show="showIndicator || showTooltip || copySuccess" class="fr-selection-translator-root" @pointerdown.stop>
    <button v-if="showIndicator && !showTooltip" class="fr-selection-indicator" :class="`fr-selection-indicator--${triggerMode}`" :style="indicatorStyle" type="button" aria-label="打开划词翻译" title="打开划词翻译" @pointerdown.prevent.stop @click="openTooltip">
      <span class="fr-selection-indicator-glyph" aria-hidden="true">↗</span>
    </button>

    <section v-if="showTooltip" ref="tooltip-ref" class="fr-translation-tooltip" :class="{ 'fr-dark-theme': isDarkTheme }" :data-placement="popupPlacement" :style="tooltipStyle" role="dialog" aria-label="划词翻译结果" @pointerdown.stop>
      <header class="fr-tooltip-header">
        <div class="fr-tooltip-title"><span>{{ isWordSelection ? '单词学习卡' : '翻译结果' }}</span><small>FluentRead</small></div>
        <div class="fr-tooltip-actions">
          <button class="fr-action-btn" type="button" title="复制译文" aria-label="复制译文" @click="copyTranslation"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
          <button class="fr-close-btn" type="button" title="关闭" aria-label="关闭翻译结果" @click="closeTooltip">×</button>
        </div>
      </header>

      <div class="fr-tooltip-content" aria-live="polite">
        <div v-if="isLoading && !translationResult && !wordCard && !wordCardError" class="fr-loading-state"><span :class="['fr-loading-spinner', { 'fr-static': !config.animations }]" aria-hidden="true" /><span>正在查询…</span></div>
        <div v-else-if="error && !translationResult && !wordCard" class="fr-error-state"><span>{{ error }}</span><button type="button" @click="retryTranslation">重试</button></div>
        <div v-else class="fr-translation-container">
          <section v-if="isWordSelection && (wordCard || isWordCardLoading)" class="fr-word-learning-card" aria-label="单词学习卡">
            <div v-if="isWordCardLoading && !wordCard" class="fr-word-card-loading"><span :class="['fr-loading-spinner', { 'fr-static': !config.animations }]" aria-hidden="true" /><span>正在查词…</span></div>
            <template v-else-if="wordCard">
              <div class="fr-word-heading">
                <div>
                  <h3>{{ selectedText }}</h3>
                  <span class="fr-word-normalized" v-if="selectedText.toLowerCase() !== wordCard.normalizedWord">词典词形：{{ wordCard.word }}</span>
                </div>
                <button v-if="wordCard.phonetics.length === 0" class="fr-text-audio-btn fr-word-heading-audio" type="button" :aria-label="wordAudioLabel({ text: wordCard.word })" :title="wordAudioLabel({ text: wordCard.word })" @click="toggleWordAudio({ text: wordCard.word })">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16 9.5a4.5 4.5 0 0 1 0 5M18.5 7a8 8 0 0 1 0 10" /></svg>
                </button>
              </div>
              <div v-if="wordCard.phonetics.length > 0" class="fr-word-pronunciations" aria-label="发音">
                <div v-for="(pronunciation, index) in wordCard.phonetics.slice(0, 4)" :key="`${pronunciation.text || ''}-${pronunciation.audio || ''}-${index}`" class="fr-word-pronunciation">
                  <span class="fr-word-pronunciation-label">{{ pronunciation.label || (index === 0 ? '发音' : '变体') }}</span>
                  <span class="fr-word-ipa">{{ pronunciation.text || '点击播放' }}</span>
                  <button class="fr-text-audio-btn" type="button" :aria-label="wordAudioLabel(pronunciation)" :title="wordAudioLabel(pronunciation)" @click="toggleWordAudio(pronunciation)">
                    <svg v-if="isCurrentWordAudio(pronunciation)" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>
                    <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16 9.5a4.5 4.5 0 0 1 0 5M18.5 7a8 8 0 0 1 0 10" /></svg>
                  </button>
                </div>
              </div>
              <div v-if="translationResult" class="fr-word-translation"><span class="fr-text-label">译文</span><pre>{{ translationResult }}</pre></div>
              <div v-else-if="isLoading" class="fr-word-translation-loading">正在翻译释义…</div>
              <div v-if="wordCard.meanings.length > 0" class="fr-word-meaning-toolbar">
                <span>英文释义 · 中文辅助</span>
                <button type="button" @click="showChineseSupport = !showChineseSupport">{{ showChineseSupport ? '隐藏中文辅助' : '显示中文辅助' }}</button>
              </div>
              <div v-if="wordCard.meanings.length > 0" class="fr-word-meanings">
                <div v-for="meaning in wordCard.meanings.slice(0, 4)" :key="meaning.partOfSpeech" class="fr-word-meaning">
                  <strong>{{ meaning.partOfSpeech }}</strong>
                  <ol>
                    <li v-for="definition in meaning.definitions.slice(0, 4)" :key="`${meaning.partOfSpeech}-${definition.definition}`">
                      <span class="fr-word-definition-en">{{ definition.definition }}</span>
                      <span v-if="showChineseSupport && definition.translatedDefinition && definition.translatedDefinition !== definition.definition" class="fr-word-definition-zh">{{ definition.translatedDefinition }}</span>
                      <em v-if="definition.example">
                        <span class="fr-word-example-en">例句：{{ definition.example }}</span>
                        <span v-if="showChineseSupport && definition.translatedExample && definition.translatedExample !== definition.example" class="fr-word-example-zh">译：{{ definition.translatedExample }}</span>
                      </em>
                    </li>
                  </ol>
                </div>
              </div>
              <div v-else class="fr-word-empty">暂未找到详细释义，可查看译文。</div>
              <footer class="fr-word-card-footer">
                <span>数据来自开放词典</span>
                <a v-for="source in wordCard.sources" :key="source.id" :href="source.url" target="_blank" rel="noreferrer">{{ source.label }}</a>
              </footer>
            </template>
          </section>
          <div v-if="isWordSelection && wordCardError" class="fr-word-fallback-note">{{ wordCardError }}，已保留普通翻译。</div>
          <div v-if="config.selectionTranslatorMode === 'bilingual' && !isWordCardVisible" class="fr-text-block fr-original-text">
            <div class="fr-text-label">原文</div><pre>{{ selectedText }}</pre>
            <button class="fr-text-audio-btn" type="button" :aria-label="audioLabel('source')" :title="audioLabel('source')" @click="toggleAudio(selectedText, 'source')">
              <svg v-if="isCurrentAudio('source')" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16 9.5a4.5 4.5 0 0 1 0 5M18.5 7a8 8 0 0 1 0 10" /></svg>
            </button>
          </div>
          <div v-if="(config.selectionTranslatorMode === 'bilingual' || config.selectionTranslatorMode === 'translation-only') && !isWordCardVisible" class="fr-text-block fr-translation-result">
            <div class="fr-text-label">译文</div><pre>{{ translationResult }}</pre>
            <button class="fr-text-audio-btn" type="button" :aria-label="audioLabel('translation')" :title="audioLabel('translation')" @click="toggleAudio(translationResult, 'translation')">
              <svg v-if="isCurrentAudio('translation')" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16 9.5a4.5 4.5 0 0 1 0 5M18.5 7a8 8 0 0 1 0 10" /></svg>
            </button>
          </div>
          <div v-if="error && (translationResult || wordCard)" class="fr-inline-error"><span>{{ error }}</span><button type="button" @click="retryTranslation">重试</button></div>
          <div v-if="isPlaying" class="fr-playing-status"><span>正在播放{{ currentAudioKind === 'source' ? '原文' : currentAudioKind === 'word' ? '单词' : '译文' }}</span><button type="button" aria-label="停止播放" title="停止播放" @click="stopAudioFromUi">停止</button></div>
        </div>
      </div>
    </section>

    <div v-if="copySuccess" class="fr-copy-success-toast" :class="{ 'fr-dark-theme': isDarkTheme }" role="status">已复制译文</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import browser from 'webextension-polyfill';
import { config } from '@/entrypoints/utils/config';
import { translateText } from '@/entrypoints/utils/translateApi';
import { detectlang } from '@/entrypoints/utils/common';
import { isSingleEnglishWord, normalizeEnglishWord, type WordCardData, type WordPronunciation } from '@/entrypoints/utils/wordDictionary';
import { calculateSelectionPopupPosition, chooseSelectionRect, isSameLanguage, normalizeSelectionText, normalizeSpeechLanguage, shouldIgnoreSelection, type SelectionRect } from '@/entrypoints/utils/selectionTranslatorCore';

type SelectionTrigger = 'direct' | 'icon' | 'dot';
type AudioKind = 'source' | 'translation' | 'word';
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
const currentAudioKey = ref('');
const wordCard = ref<WordCardData | null>(null);
const isWordCardLoading = ref(false);
const wordCardError = ref('');
const showChineseSupport = ref(true);

let selectionFrame: number | null = null;
let positionFrame: number | null = null;
let translationRequestId = 0;
let wordLookupRequestId = 0;
let copyTimer: number | null = null;
let audio: HTMLAudioElement | null = null;
let audioUrl = '';
let utterance: SpeechSynthesisUtterance | null = null;
let audioRequestId = 0;
let remoteAudioActive = false;
let remoteAudioRequestId: number | null = null;
let pendingRemoteAudioRequestId: number | null = null;
let isSelecting = false;
let uiPointerInteraction = false;
let suppressSelectionUntil = 0;
let systemThemeMedia: MediaQueryList | null = null;

const UI_SELECTION_SUPPRESSION_MS = 350;

const triggerMode = computed<SelectionTrigger>(() => config.selectionTranslatorTrigger === 'direct' || config.selectionTranslatorTrigger === 'dot' ? config.selectionTranslatorTrigger : 'icon');
const selectedWord = computed(() => normalizeEnglishWord(selectedText.value));
const isWordSelection = computed(() => Boolean(selectedWord.value) && (config.from === 'auto' || /^en(?:-|$)/i.test(config.from)));
const isWordCardVisible = computed(() => isWordSelection.value && wordCard.value !== null);

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
  if (shouldIgnoreSelection(range)) return null;
  const rects = Array.from(range.getClientRects()).map(toSelectionRect).filter(rect => rect.width > 0 || rect.height > 0);
  const visualRects = rects.length > 0 ? rects : [toSelectionRect(range.getBoundingClientRect())];
  const isForward = selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset;
  const anchor = chooseSelectionRect(visualRects, isForward);
  if (!anchor || (anchor.width === 0 && anchor.height === 0)) return null;
  return { text, range, anchor, isForward };
}

function scheduleSelectionRead(): void {
  if (isSelecting || isSelectionReadSuppressed()) return;
  if (selectionFrame !== null) return;
  selectionFrame = window.requestAnimationFrame(() => {
    selectionFrame = null;
    if (!isSelecting && !isSelectionReadSuppressed()) applySelection(readSelectionSnapshot());
  });
}

function suppressSelectionRead(duration = UI_SELECTION_SUPPRESSION_MS): void {
  suppressSelectionUntil = Math.max(suppressSelectionUntil, performance.now() + duration);
  if (selectionFrame !== null) {
    window.cancelAnimationFrame(selectionFrame);
    selectionFrame = null;
  }
}

function isSelectionReadSuppressed(): boolean {
  return uiPointerInteraction || performance.now() < suppressSelectionUntil;
}

function isSelectionInTargetLanguage(text: string): boolean {
  return isSameLanguage(detectlang(text), config.to);
}

function isSameSelection(left: SelectionSnapshot | null, right: SelectionSnapshot): boolean {
  if (!left || left.text !== right.text) return false;
  return left.range.startContainer === right.range.startContainer
    && left.range.startOffset === right.range.startOffset
    && left.range.endContainer === right.range.endContainer
    && left.range.endOffset === right.range.endOffset;
}

function applySelection(next: SelectionSnapshot | null): void {
  if (!next) { if (!isSelecting) hideAll(); return; }
  if (isSameSelection(snapshot.value, next)) return;
  if (isSelectionInTargetLanguage(next.text)) { hideAll(); return; }
  const hadActiveSelection = snapshot.value !== null;
  const changedText = selectedText.value !== next.text;
  snapshot.value = next;
  selectedText.value = next.text;
  showIndicator.value = triggerMode.value !== 'direct';
  showTooltip.value = triggerMode.value === 'direct';
  if (changedText) {
    translationResult.value = '';
    error.value = '';
    wordCard.value = null;
    isWordCardLoading.value = false;
    wordCardError.value = '';
    showChineseSupport.value = true;
  }
  updatePosition(false);
  if (showTooltip.value && (!hadActiveSelection || changedText)) void requestSelectionContent(next.text);
}

function updatePosition(refreshSelection = true): void {
  const current = snapshot.value;
  if (!current) return;
  const rects = refreshSelection
    ? Array.from(current.range.getClientRects()).map(toSelectionRect).filter(rect => rect.width > 0 || rect.height > 0)
    : [];
  const anchor = refreshSelection
    ? chooseSelectionRect(rects.length > 0 ? rects : [current.anchor], current.isForward)
    : current.anchor;
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
  if (!snapshot.value || isSelectionInTargetLanguage(snapshot.value.text)) { hideAll(); return; }
  showIndicator.value = true;
  showTooltip.value = true;
  void requestSelectionContent(snapshot.value.text);
  schedulePositionUpdate();
}

function shouldUseWordCard(text: string): boolean {
  return isSingleEnglishWord(text) && (config.from === 'auto' || /^en(?:-|$)/i.test(config.from));
}

function requestSelectionContent(text: string): void {
  void requestTranslation(text);
  if (shouldUseWordCard(text)) void requestWordCard(text);
  else {
    wordLookupRequestId += 1;
    wordCard.value = null;
    isWordCardLoading.value = false;
    wordCardError.value = '';
  }
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

function retryTranslation(): void {
  if (!snapshot.value) return;
  void requestTranslation(snapshot.value.text);
  if (shouldUseWordCard(snapshot.value.text)) void requestWordCard(snapshot.value.text);
}

async function requestWordCard(text: string): Promise<void> {
  const word = normalizeEnglishWord(text);
  if (!word) return;
  const requestId = ++wordLookupRequestId;
  isWordCardLoading.value = true;
  wordCardError.value = '';
  try {
    const response = await browser.runtime.sendMessage({ type: 'selectionWordLookup', word }) as {
      success?: boolean;
      data?: WordCardData | null;
    };
    if (requestId !== wordLookupRequestId || snapshot.value?.text !== text) return;
    if (!response?.success || !response.data) {
      wordCard.value = null;
      wordCardError.value = '暂未找到这个单词的词典条目';
    } else {
      wordCard.value = response.data;
    }
  } catch (cause) {
    if (requestId !== wordLookupRequestId || snapshot.value?.text !== text) return;
    console.warn('Selection word lookup unavailable:', cause);
    wordCard.value = null;
    wordCardError.value = '词典服务暂时不可用';
  } finally {
    if (requestId === wordLookupRequestId) isWordCardLoading.value = false;
  }
}

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
function speechLanguage(text: string, kind: AudioKind): string { return kind === 'translation' ? translationLanguage() : sourceLanguage(text); }

function selectVoice(language: string): SpeechSynthesisVoice | undefined {
  if (!('speechSynthesis' in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  const normalized = language.toLowerCase();
  const exact = voices.filter(voice => voice.lang.toLowerCase() === normalized);
  const preferredNames = normalized.startsWith('en-')
    ? ['ava', 'aria', 'jenny', 'samantha', 'google us english', 'zira']
    : normalized.startsWith('zh-')
      ? ['xiaoxiao', 'ting-ting', 'tingting', 'huihui']
      : [];
  const preferred = exact.find(voice => preferredNames.some(name => voice.name.toLowerCase().includes(name)));
  if (preferred) return preferred;
  if (exact.length > 0) return exact[0];
  const base = language.split('-')[0]?.toLowerCase();
  return voices.find(voice => voice.lang.toLowerCase().startsWith(`${base}-`) || voice.lang.toLowerCase() === base);
}

function isCurrentAudio(kind: AudioKind, key = currentAudioText.value): boolean {
  return isPlaying.value && currentAudioKind.value === kind && currentAudioKey.value === key;
}
function audioLabel(kind: AudioKind): string {
  const label = kind === 'source' ? '原文' : kind === 'translation' ? '译文' : '单词';
  return isCurrentAudio(kind) ? `停止播放${label}` : `播放${label}`;
}
function wordAudioKey(pronunciation: WordPronunciation): string {
  return pronunciation.audio || pronunciation.text || wordCard.value?.word || selectedText.value;
}
function wordAudioLabel(pronunciation: WordPronunciation): string {
  const label = pronunciation.label || '单词发音';
  return isCurrentWordAudio(pronunciation) ? `停止播放${label}` : `播放${label}`;
}
function isCurrentWordAudio(pronunciation: WordPronunciation): boolean {
  return isCurrentAudio('word', wordAudioKey(pronunciation));
}

function releasePageAudio(): void {
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio = null; }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = '';
}

function stopAudio(notifyRemote = true): void {
  const stoppedRemoteRequestId = remoteAudioRequestId;
  const shouldNotifyRemote = notifyRemote && remoteAudioActive && stoppedRemoteRequestId !== null;
  remoteAudioActive = false;
  remoteAudioRequestId = null;
  pendingRemoteAudioRequestId = null;
  audioRequestId += 1;
  releasePageAudio();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  utterance = null;
  isPlaying.value = false;
  currentAudioKind.value = null;
  currentAudioText.value = '';
  currentAudioKey.value = '';
  if (shouldNotifyRemote) {
    void browser.runtime.sendMessage({ type: 'selectionTtsStop', requestId: stoppedRemoteRequestId }).catch(() => undefined);
  }
}

function stopAudioFromUi(): void { stopAudio(); }

function base64ToBlobUrl(audioBase64: string, contentType: string): string {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: contentType }));
}

async function playEdgeSpeech(text: string, language: string, kind: AudioKind, requestId: number): Promise<boolean> {
  pendingRemoteAudioRequestId = requestId;
  try {
    const response = await browser.runtime.sendMessage({ type: 'selectionTts', text, language, requestId }) as {
      success?: boolean;
      audioBase64?: string;
      contentType?: string;
      transport?: 'offscreen' | 'page';
    };
    if (requestId !== audioRequestId || !response?.success) return requestId === audioRequestId ? false : true;
    pendingRemoteAudioRequestId = null;
    if (response.transport === 'offscreen') {
      remoteAudioActive = true;
      remoteAudioRequestId = requestId;
      currentAudioKind.value = kind;
      currentAudioText.value = text;
      isPlaying.value = true;
      return true;
    }
    if (!response.audioBase64) return false;
    const nextAudioUrl = base64ToBlobUrl(response.audioBase64, response.contentType || 'audio/mpeg');
    const nextAudio = new Audio(nextAudioUrl);
    nextAudio.preload = 'auto';
    nextAudio.onended = () => { if (audio === nextAudio) { releasePageAudio(); stopAudio(); } };
    nextAudio.onerror = () => {
      if (audio !== nextAudio) return;
      releasePageAudio();
      isPlaying.value = false;
      currentAudioKind.value = null;
      currentAudioText.value = '';
    };
    audio = nextAudio;
    audioUrl = nextAudioUrl;
    currentAudioKind.value = kind;
    currentAudioText.value = text;
    currentAudioKey.value = text;
    isPlaying.value = true;
    try {
      await nextAudio.play();
      return true;
    } catch (cause) {
      if (audio === nextAudio) releasePageAudio();
      if (requestId === audioRequestId) {
        isPlaying.value = false;
        currentAudioKind.value = null;
        currentAudioText.value = '';
      }
      if (requestId === audioRequestId) console.warn('Page audio unavailable, trying browser speech:', cause);
      return false;
    }
  } catch (cause) {
    if (pendingRemoteAudioRequestId === requestId) pendingRemoteAudioRequestId = null;
    if (requestId === audioRequestId) console.warn('Edge TTS unavailable, trying browser speech:', cause);
    return requestId !== audioRequestId;
  }
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
    currentAudioKey.value = text;
    isPlaying.value = true;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(nextUtterance);
    return true;
  } catch (cause) { console.warn('Browser speech synthesis unavailable:', cause); return false; }
}

async function playGoogleFallback(text: string, language: string, kind: AudioKind): Promise<void> {
  const requestId = audioRequestId;
  pendingRemoteAudioRequestId = requestId;
  try {
    const response = await browser.runtime.sendMessage({ type: 'selectionTtsGoogle', text, language, requestId }) as {
      success?: boolean;
      transport?: 'offscreen' | 'page';
    };
    if (requestId !== audioRequestId) return;
    pendingRemoteAudioRequestId = null;
    if (response?.success && response.transport === 'offscreen') {
      remoteAudioActive = true;
      remoteAudioRequestId = requestId;
      currentAudioKind.value = kind;
      currentAudioText.value = text;
      isPlaying.value = true;
      return;
    }
  } catch (cause) {
    if (pendingRemoteAudioRequestId === requestId) pendingRemoteAudioRequestId = null;
    if (requestId === audioRequestId) console.warn('Offscreen Google TTS unavailable, trying page audio:', cause);
  }

  if (requestId !== audioRequestId) return;
  const speechUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(language)}&client=tw-ob&q=${encodeURIComponent(text)}`;
  const nextAudio = new Audio(speechUrl);
  nextAudio.preload = 'auto';
  nextAudio.onended = () => { if (audio === nextAudio) { releasePageAudio(); stopAudio(); } };
  nextAudio.onerror = () => {
    if (audio !== nextAudio) return;
    console.warn('Fallback speech audio failed');
    releasePageAudio();
    stopAudio(false);
  };
  audio = nextAudio;
  currentAudioKind.value = kind;
  currentAudioText.value = text;
  currentAudioKey.value = text;
  isPlaying.value = true;
  try {
    await nextAudio.play();
  } catch {
    if (audio === nextAudio) releasePageAudio();
    if (requestId === audioRequestId) stopAudio(false);
  }
}

async function playExternalAudio(url: string, text: string, kind: AudioKind, key: string, requestId: number): Promise<boolean> {
  if (requestId !== audioRequestId) return true;
  const nextAudio = new Audio(url);
  audio = nextAudio;
  currentAudioKind.value = kind;
  currentAudioText.value = text;
  currentAudioKey.value = key;
  isPlaying.value = true;
  nextAudio.onended = () => { if (audio === nextAudio) stopAudio(); };
  nextAudio.onerror = () => {
    if (audio !== nextAudio) return;
    audio = null;
    nextAudio.removeAttribute('src');
    isPlaying.value = false;
  };
  try {
    await nextAudio.play();
    return true;
  } catch (cause) {
    if (audio === nextAudio) {
      audio = null;
      nextAudio.removeAttribute('src');
      isPlaying.value = false;
    }
    if (requestId === audioRequestId) console.warn('Dictionary pronunciation audio unavailable:', cause);
    return false;
  }
}

async function toggleAudio(text: string, kind: AudioKind): Promise<void> {
  const cleanText = text.trim();
  if (!cleanText) return;
  if (isCurrentAudio(kind) && currentAudioText.value === cleanText) { stopAudio(); return; }
  stopAudio();
  const language = speechLanguage(cleanText, kind);
  const requestId = audioRequestId;
  isPlaying.value = true;
  currentAudioKind.value = kind;
  currentAudioText.value = cleanText;
  currentAudioKey.value = cleanText;
  const edgeStarted = await playEdgeSpeech(cleanText, language, kind, requestId);
  if (edgeStarted || requestId !== audioRequestId) return;
  if (!playBrowserSpeech(cleanText, language, kind)) await playGoogleFallback(cleanText, language, kind);
}

function handleSelectionTtsState(message: unknown): true | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const payload = message as { type?: string; requestId?: number; state?: string };
  if (payload.type !== 'selectionTtsState' || (payload.requestId !== remoteAudioRequestId && payload.requestId !== pendingRemoteAudioRequestId)) return undefined;

  const text = currentAudioText.value;
  const kind = currentAudioKind.value;
  const language = kind && text ? speechLanguage(text, kind) : '';
  if (payload.state === 'ended' || payload.state === 'stopped') {
    stopAudio(false);
    return true;
  }
  if (payload.state === 'error') {
    stopAudio(false);
    if (text && kind && !playBrowserSpeech(text, language, kind)) void playGoogleFallback(text, language, kind);
    return true;
  }
  return undefined;
}

async function toggleWordAudio(pronunciation: WordPronunciation): Promise<void> {
  const word = wordCard.value?.word || selectedWord.value || selectedText.value;
  const cleanText = word.trim();
  if (!cleanText) return;
  const key = wordAudioKey(pronunciation);
  if (isCurrentAudio('word', key)) { stopAudio(); return; }
  stopAudio();
  const requestId = audioRequestId;
  isPlaying.value = true;
  currentAudioKind.value = 'word';
  currentAudioText.value = cleanText;
  currentAudioKey.value = key;
  const externalAudio = pronunciation.audio;
  if (externalAudio) {
    const externalStarted = await playExternalAudio(externalAudio, cleanText, 'word', key, requestId);
    if (externalStarted || requestId !== audioRequestId) return;
  }
  const edgeStarted = await playEdgeSpeech(cleanText, 'en-US', 'word', requestId);
  if (edgeStarted || requestId !== audioRequestId) return;
  if (!playBrowserSpeech(cleanText, 'en-US', 'word')) playGoogleFallback(cleanText, 'en-US', 'word');
}

function closeTooltip(): void { hideAll(); }
function hideAll(): void {
  translationRequestId++;
  wordLookupRequestId++;
  showIndicator.value = false;
  showTooltip.value = false;
  snapshot.value = null;
  wordCard.value = null;
  isWordCardLoading.value = false;
  wordCardError.value = '';
  showChineseSupport.value = true;
  stopAudio();
}
function isInsideUi(target: EventTarget | null): boolean {
  const node = target instanceof Node ? target : null;
  if (!node) return false;
  const host = document.getElementById('fluent-read-selection-translator-container');
  return Boolean(node === host || host?.contains(node) || node.getRootNode() instanceof ShadowRoot);
}
function handlePointerDown(event: PointerEvent): void {
  if (isInsideUi(event.target)) {
    uiPointerInteraction = true;
    isSelecting = false;
    suppressSelectionRead();
    return;
  }
  uiPointerInteraction = false;
  suppressSelectionUntil = 0;
  isSelecting = true;
  if (showTooltip.value) hideAll();
}
function handlePointerUp(event: PointerEvent): void {
  if (uiPointerInteraction || isInsideUi(event.target)) {
    uiPointerInteraction = false;
    isSelecting = false;
    suppressSelectionRead();
    return;
  }
  uiPointerInteraction = false;
  isSelecting = false;
  scheduleSelectionRead();
}
function handlePointerCancel(event: PointerEvent): void {
  if (uiPointerInteraction || isInsideUi(event.target)) {
    uiPointerInteraction = false;
    isSelecting = false;
    suppressSelectionRead();
    return;
  }
  isSelecting = false;
}
function handleSelectionChange(): void { if (!isSelectionReadSuppressed()) scheduleSelectionRead(); }
function handleWheel(event: WheelEvent): void { if (isInsideUi(event.target)) suppressSelectionRead(); }
function handleScroll(event: Event): void {
  if (isInsideUi(event.target)) {
    suppressSelectionRead();
    return;
  }
  schedulePositionUpdate();
}
function handleKeydown(event: KeyboardEvent): void {
  if (isInsideUi(event.target)) suppressSelectionRead();
  if (event.key === 'Escape' && (showIndicator.value || showTooltip.value)) hideAll();
}

onMounted(() => {
  updateTheme();
  systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  systemThemeMedia.addEventListener('change', updateTheme);
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('pointerup', handlePointerUp, true);
  document.addEventListener('pointercancel', handlePointerCancel, true);
  document.addEventListener('selectionchange', handleSelectionChange);
  document.addEventListener('keydown', handleKeydown, true);
  browser.runtime.onMessage.addListener(handleSelectionTtsState);
  window.addEventListener('scroll', schedulePositionUpdate, true);
  document.addEventListener('wheel', handleWheel, true);
  window.addEventListener('scroll', handleScroll, true);
  window.addEventListener('resize', schedulePositionUpdate);
  watch(() => [config.theme, config.selectionTranslatorTrigger, config.to, config.from] as const, () => {
    updateTheme();
    if (snapshot.value) {
      if (isSelectionInTargetLanguage(snapshot.value.text)) { hideAll(); return; }
      showIndicator.value = triggerMode.value !== 'direct';
      showTooltip.value = triggerMode.value === 'direct';
      if (showTooltip.value) void requestSelectionContent(snapshot.value.text);
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
  document.removeEventListener('pointercancel', handlePointerCancel, true);
  document.removeEventListener('selectionchange', handleSelectionChange);
  document.removeEventListener('keydown', handleKeydown, true);
  browser.runtime.onMessage.removeListener(handleSelectionTtsState);
  window.removeEventListener('scroll', schedulePositionUpdate, true);
  document.removeEventListener('wheel', handleWheel, true);
  window.removeEventListener('scroll', handleScroll, true);
  window.removeEventListener('resize', schedulePositionUpdate);
  stopAudio();
});
</script>

<style scoped>
.fr-selection-translator-root { position: fixed; inset: 0; z-index: 2147483647; width: 100vw; height: 100vh; pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #25252a; }
.fr-selection-indicator, .fr-translation-tooltip, .fr-copy-success-toast { pointer-events: auto; }
.fr-selection-indicator { position: fixed; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%; transform: translate(-50%, -50%); background: #ef4b86; color: #fff; box-shadow: 0 2px 7px rgba(204, 40, 104, .28), 0 0 0 2px rgba(255, 255, 255, .94); cursor: pointer; transition: transform .14s ease, box-shadow .14s ease; }
.fr-selection-indicator--dot { width: 8px; height: 8px; }
.fr-selection-indicator--dot .fr-selection-indicator-glyph { display: none; }
.fr-selection-indicator:hover, .fr-selection-indicator:focus-visible { transform: translate(-50%, -50%) scale(1.1); box-shadow: 0 4px 14px rgba(204, 40, 104, .4), 0 0 0 3px rgba(255, 255, 255, .95); outline: none; }
.fr-selection-indicator-glyph { font-size: 10px; font-weight: 700; line-height: 1; }
.fr-translation-tooltip, .fr-translation-tooltip * { box-sizing: border-box; }
.fr-translation-tooltip { position: fixed; width: min(360px, calc(100vw - 20px)); max-height: min(500px, calc(100vh - 20px)); overflow: hidden; border: 1px solid rgba(35, 35, 43, .11); border-radius: 17px; background: rgba(255, 254, 252, .98); box-shadow: 0 18px 46px rgba(35, 33, 43, .15), 0 3px 10px rgba(35, 33, 43, .06); backdrop-filter: blur(18px); -webkit-user-select: none; user-select: none; }
.fr-tooltip-header { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border-bottom: 1px solid #eeecee; font-size: 14px; font-weight: 700; }
.fr-tooltip-title { display: flex; align-items: baseline; gap: 6px; }
.fr-tooltip-header small { color: #aaa7ae; font-size: 10px; font-weight: 550; letter-spacing: .01em; }
.fr-tooltip-actions { display: flex; align-items: center; gap: 2px; }
.fr-action-btn, .fr-close-btn, .fr-text-audio-btn, .fr-playing-status button { border: 0; background: transparent; color: #777780; cursor: pointer; }
.fr-action-btn { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 7px; }
.fr-action-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.fr-action-btn:hover, .fr-action-btn:focus-visible { background: #f4f4f7; color: #ef4b86; outline: none; }
.fr-close-btn { width: 26px; height: 26px; font-size: 21px; line-height: 1; border-radius: 7px; }
.fr-close-btn:hover, .fr-close-btn:focus-visible { background: #f4f4f7; color: #303038; outline: none; }
.fr-tooltip-content { max-height: min(440px, calc(100vh - 72px)); overflow: auto; padding: 13px 14px 15px; scrollbar-color: rgba(108, 105, 112, .4) transparent; scrollbar-width: thin; }
.fr-loading-state, .fr-error-state { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 80px; color: #777780; font-size: 13px; }
.fr-error-state { flex-direction: column; color: #c43b63; }
.fr-error-state button { border: 1px solid currentColor; border-radius: 7px; padding: 4px 10px; background: transparent; color: inherit; cursor: pointer; }
.fr-loading-spinner { width: 18px; height: 18px; border: 2px solid #f5bfd3; border-top-color: #ef4b86; border-radius: 50%; animation: fr-spin .7s linear infinite; }
.fr-loading-spinner.fr-static { animation: none; }
@keyframes fr-spin { to { transform: rotate(360deg); } }
.fr-word-learning-card { padding: 1px 1px 0; color: #39363d; }
.fr-word-card-loading { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 74px; color: #77747c; font-size: 13px; }
.fr-word-heading { position: relative; display: flex; align-items: flex-start; justify-content: space-between; min-height: 58px; padding: 4px 34px 14px 1px; border-bottom: 1px solid #eeecee; }
.fr-word-heading h3 { margin: 0; color: #292832; font-size: 27px; font-weight: 700; letter-spacing: -.035em; line-height: 1.08; }
.fr-word-normalized { display: block; margin-top: 5px; color: #aaa1a6; font-size: 10px; }
.fr-word-heading-audio { top: 1px; right: 0; background: #f5eff1; color: #936173; }
.fr-word-pronunciations { display: grid; gap: 0; margin-top: 10px; padding-bottom: 10px; border-bottom: 1px solid #eeecee; }
.fr-word-pronunciation { position: relative; display: flex; align-items: center; gap: 8px; min-height: 29px; padding: 3px 31px 3px 1px; border-bottom: 1px solid #f2f0f1; }
.fr-word-pronunciation:last-child { border-bottom: 0; }
.fr-word-pronunciation-label { min-width: 34px; color: #a36b7b; font-size: 10px; font-weight: 700; }
.fr-word-ipa { color: #4a454c; font-family: Georgia, "Times New Roman", serif; font-size: 14px; }
.fr-word-translation { margin-top: 12px; padding: 1px 1px 12px; border-bottom: 1px solid #eeecee; color: #3a363d; }
.fr-word-translation pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; font-size: 18px; font-weight: 700; line-height: 1.3; }
.fr-word-translation-loading, .fr-word-empty { margin-top: 12px; color: #9a9298; font-size: 12px; }
.fr-word-meaning-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; color: #9a9298; font-size: 11px; font-weight: 700; }
.fr-word-meaning-toolbar button { border: 0; padding: 3px 0; background: transparent; color: #9e5d71; cursor: pointer; font: inherit; font-weight: 600; }
.fr-word-meaning-toolbar button:hover, .fr-word-meaning-toolbar button:focus-visible { color: #7f4156; text-decoration: underline; outline: none; }
.fr-word-meanings { display: grid; gap: 16px; margin-top: 14px; }
.fr-word-meaning-toolbar + .fr-word-meanings { margin-top: 8px; }
.fr-word-meaning { color: #454149; font-size: 12.5px; line-height: 1.52; }
.fr-word-meaning > strong { display: inline-flex; padding: 3px 7px; border: 1px solid #ead8de; border-radius: 6px; background: #fbf5f6; color: #9e5d71; font-size: 10px; font-weight: 700; }
.fr-word-meaning ol { margin: 7px 0 0; padding: 0; list-style: none; counter-reset: definition; }
.fr-word-meaning li { position: relative; padding-left: 21px; }
.fr-word-meaning li::before { position: absolute; top: 0; left: 0; width: 14px; color: #b5adb2; content: counter(definition); counter-increment: definition; font-size: 11px; text-align: right; }
.fr-word-meaning li + li { margin-top: 9px; }
.fr-word-definition-en, .fr-word-example-en { display: block; }
.fr-word-definition-zh, .fr-word-example-zh { display: block; margin-top: 3px; color: #9a7f89; font-size: 11.5px; }
.fr-word-meaning em { display: block; margin-top: 4px; padding-left: 8px; border-left: 2px solid #ead8de; color: #74676d; font-size: 11px; font-style: normal; line-height: 1.45; }
.fr-word-card-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 8px; margin-top: 16px; padding-top: 10px; border-top: 1px solid #eeecee; color: #aaa1a6; font-size: 10px; }
.fr-word-card-footer a { color: #9e5d71; text-decoration: none; }
.fr-word-card-footer a:hover, .fr-word-card-footer a:focus-visible { text-decoration: underline; }
.fr-word-fallback-note, .fr-inline-error { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; color: #a56578; font-size: 11px; }
.fr-word-fallback-note { padding: 6px 8px; border-radius: 7px; background: #fff8fa; }
.fr-inline-error button, .fr-word-fallback-note button { border: 1px solid currentColor; border-radius: 6px; padding: 2px 7px; background: transparent; color: inherit; cursor: pointer; font-size: 11px; }
.fr-text-block { position: relative; padding: 9px 36px 10px 11px; border-radius: 11px; }
.fr-text-block + .fr-text-block { margin-top: 8px; }
.fr-original-text { background: #f7f7f9; color: #666670; }
.fr-translation-result { background: #fff3f7; color: #33333a; box-shadow: inset 2px 0 0 rgba(239, 75, 134, .28); }
.fr-text-label { margin-bottom: 3px; color: #9a9aa4; font-size: 10px; font-weight: 700; letter-spacing: .02em; }
.fr-text-block pre { max-height: 170px; margin: 0; overflow: auto; white-space: pre-wrap; word-break: break-word; font: inherit; font-size: 15px; line-height: 1.48; }
.fr-text-audio-btn { position: absolute; top: 8px; right: 7px; display: grid; width: 26px; height: 26px; place-items: center; border-radius: 8px; }
.fr-text-audio-btn svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.fr-text-audio-btn:hover, .fr-text-audio-btn:focus-visible { background: rgba(239, 75, 134, .13); color: #ef4b86; outline: none; }
.fr-playing-status { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; color: #777780; font-size: 12px; }
.fr-playing-status button { border: 1px solid #e8a4bc; border-radius: 7px; padding: 3px 8px; color: #d83e70; }
.fr-copy-success-toast { position: fixed; right: 18px; bottom: 18px; padding: 9px 13px; border-radius: 9px; background: #2c2c35; color: #fff; font-size: 12px; box-shadow: 0 6px 18px rgba(0, 0, 0, .18); }
.fr-dark-theme { border-color: #44444e; background: rgba(40, 40, 48, .98); color: #f1f1f4; }
.fr-dark-theme .fr-tooltip-header { border-color: #4b4b56; }
.fr-dark-theme .fr-action-btn:hover, .fr-dark-theme .fr-close-btn:hover { background: #50505b; color: #fff; }
.fr-dark-theme .fr-original-text { background: #34343d; color: #d0d0d7; }
.fr-dark-theme .fr-translation-result { background: #4b2e3a; color: #fff0f5; }
.fr-dark-theme .fr-word-learning-card { background: transparent; }
.fr-dark-theme .fr-word-heading, .fr-dark-theme .fr-word-pronunciations, .fr-dark-theme .fr-word-translation, .fr-dark-theme .fr-word-card-footer { border-color: #4b4148; }
.fr-dark-theme .fr-word-heading h3, .fr-dark-theme .fr-word-meaning, .fr-dark-theme .fr-word-translation { color: #f2e8ed; }
.fr-dark-theme .fr-word-meaning-toolbar { color: #c8aab5; }
.fr-dark-theme .fr-word-meaning-toolbar button { color: #f0b9cb; }
.fr-dark-theme .fr-word-heading-audio { background: #493842; color: #f0c3d2; }
.fr-dark-theme .fr-word-pronunciation { border-color: #443a42; }
.fr-dark-theme .fr-word-pronunciation-label { color: #e0a7b9; }
.fr-dark-theme .fr-word-ipa { color: #f0dce4; }
.fr-dark-theme .fr-word-meaning > strong { border-color: #684b58; background: #493842; color: #ffd9e7; }
.fr-dark-theme .fr-word-meaning em { border-color: #684b58; }
.fr-dark-theme .fr-word-meaning em, .fr-dark-theme .fr-word-definition-zh, .fr-dark-theme .fr-word-example-zh, .fr-dark-theme .fr-word-translation-loading, .fr-dark-theme .fr-word-empty { color: #c8aab5; }
.fr-dark-theme .fr-word-fallback-note { background: #4a303b; }
@media (prefers-reduced-motion: reduce) { .fr-selection-indicator, .fr-loading-spinner { transition: none; animation: none; } }
</style>

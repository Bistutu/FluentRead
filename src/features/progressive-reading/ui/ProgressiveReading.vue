<!--
 * @file src/features/progressive-reading/ui/ProgressiveReading.vue
 * 文件职责：呈现主动选文后的渐进阅读面板，让读者随时切换原文、短语、逻辑线索和完整双语。
 * 主要内容：沿用品牌与主题，紧凑展示四档帮助、原文和按需译文；朗读工具栏提供真实暂停续播、5 秒跳转、语速和本段循环，复用当前音频并跟随真实媒体事件显示估算词面进度。
 * 模块边界：消费阅读会话 props 和现有朗读后台协议；音频状态与竞态归 speech，组件仅绑定 UI、配置语言和本页 Blob 资源，换文/关闭/卸载释放；不改宿主文字或学习状态，不直接调用语音供应商。
 -->
<template>
  <section v-if="state.open" ref="panel" v-ui-i18n class="fr-reading" :class="{'fr-dark-theme': isDarkTheme}" role="region" :aria-label="t('progressiveReading.panel.title')" tabindex="-1" @keydown.esc.stop="close">
    <header>
      <span class="fr-reading-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5Z"/><path d="M6 8h3m-3 3h3m6-3h3m-3 3h3"/></svg><strong>{{ t('progressiveReading.panel.title') }}</strong></span>
      <button data-reading-close type="button" :aria-label="t('progressiveReading.panel.close')" :title="t('progressiveReading.panel.closeHelp')" @click="close">×</button>
    </header>
    <p class="fr-reading-intro" :title="t('progressiveReading.panel.introHelp')">{{ t('progressiveReading.panel.intro') }}</p>
    <button data-reading-use-selection class="fr-reading-use" type="button" :title="t('progressiveReading.panel.useSelectionHelp')" @pointerdown.prevent @click="useSelection">{{ t('progressiveReading.panel.useSelection') }}</button>
    <div class="fr-reading-modes" role="group" :aria-label="t('progressiveReading.panel.helpLevel')">
      <button v-for="mode in modes" :key="mode.id" :data-reading-mode="mode.id" type="button" :aria-pressed="state.mode === mode.id" :disabled="!state.source" @click="assistance(mode.id)">{{ t(mode.key) }}</button>
    </div>
    <p v-if="!state.source && !state.error" class="fr-reading-empty">{{ t('progressiveReading.panel.empty') }}</p>
    <div v-if="state.source" class="fr-reading-body">
      <div data-reading-speech :data-status="speech.status" class="fr-reading-speech" :aria-label="t('progressiveReading.audio.title')" :aria-busy="speech.status === 'preparing'">
        <div class="fr-reading-speech-heading">
          <div data-reading-audio-kind class="fr-reading-audio-kind" role="group" :aria-label="t('progressiveReading.audio.title')">
            <button v-for="kind in audioKinds" :key="kind" :data-reading-listen="kind" type="button" :aria-pressed="listenKind === kind" :disabled="kind === 'translation' && !state.translation" :title="kind === 'translation' && !state.translation ? t('progressiveReading.audio.translationHelp') : t('progressiveReading.audio.voiceHelp')" @click="selectAudioKind(kind)">{{ t(`progressiveReading.audio.${kind}`) }}</button>
          </div>
          <span data-reading-audio-time class="fr-reading-audio-time">{{ speech.status === 'preparing' ? t('progressiveReading.audio.preparing') : speech.position ? `${playbackTime(speech.position.currentTime)} / ${playbackTime(speech.position.duration)}` : t('progressiveReading.audio.title') }}</span>
        </div>
        <div class="fr-reading-audio-controls">
          <button data-reading-play class="fr-reading-audio-play" type="button" :aria-label="playLabel" :title="playLabel" @click="toggleSpeech"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="speech.status === 'playing'" d="M8 5v14M16 5v14"/><path v-else-if="speech.status === 'preparing'" d="m6 6 12 12M18 6 6 18"/><path v-else d="m8 5 11 7-11 7Z"/></svg></button>
          <button v-for="offset in [-5, 5] as const" :key="offset" :data-reading-seek="offset" type="button" :aria-label="t(offset < 0 ? 'progressiveReading.audio.back' : 'progressiveReading.audio.forward')" :title="t(offset < 0 ? 'progressiveReading.audio.back' : 'progressiveReading.audio.forward')" :disabled="(speech.status !== 'playing' && speech.status !== 'paused') || !speech.position || (offset < 0 ? speech.position.currentTime <= 0 : speech.position.currentTime >= speech.position.duration)" @click="speechController.seek(offset)"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="offset < 0 ? 'M4 9a8 8 0 1 1 0 7M4 4v5h5' : 'M20 9a8 8 0 1 0 0 7M20 4v5h-5'"/><text x="12" y="16">5</text></svg></button>
          <button data-reading-restart type="button" :aria-label="t('progressiveReading.audio.restart')" :title="t('progressiveReading.audio.restart')" :disabled="!speech.position" @click="speechController.restart()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a8 8 0 1 1 0 7M4 4v5h5"/></svg></button>
          <button data-reading-stop type="button" :aria-label="t('progressiveReading.audio.stop')" :title="t('progressiveReading.audio.stop')" :disabled="speech.status === 'idle' && !speech.position" @click="speechController.stop()"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg></button>
          <select data-reading-rate :value="speech.rate" :aria-label="t('progressiveReading.audio.rate')" :title="t('progressiveReading.audio.rate')" @change="setSpeechRate"><option v-for="rate in [.75, 1, 1.25, 1.5]" :key="rate" :value="rate">{{ rate }}×</option></select>
          <label class="fr-reading-audio-loop"><input data-reading-loop type="checkbox" :checked="speech.loop" @change="setSpeechLoop">{{ t('progressiveReading.audio.loop') }}</label>
        </div>
        <p v-if="speech.error" data-reading-audio-error class="fr-reading-error" role="alert">{{ translateLegacy(speech.error) }}</p>
      </div>
      <div class="fr-reading-label">{{ t('progressiveReading.panel.source') }}</div><p data-reading-source class="fr-reading-source" data-i18n-ignore><SpeechFollowText :text="state.source" :offset="0" :progress="listenKind === 'source' ? speech.progress : null" /></p>
      <template v-if="state.mode === 'phrases'">
        <details class="fr-reading-help"><summary :aria-label="t('progressiveReading.panel.phraseHelpLabel')">{{ t('progressiveReading.panel.phraseHelpTitle') }}</summary><p>{{ t('progressiveReading.panel.phraseHelp') }}</p></details>
        <p v-if="hiddenCount" data-reading-hidden-hints class="fr-reading-note fr-reading-known" :title="t('progressiveReading.panel.knownHelp')"><span>{{ t(state.showKnown ? 'progressiveReading.panel.knownShown' : 'progressiveReading.panel.knownHidden', {count: hiddenCount}) }}</span><button data-reading-show-known type="button" :aria-pressed="state.showKnown" @click="state.showKnown = !state.showKnown">{{ t(state.showKnown ? 'progressiveReading.panel.hideKnown' : 'progressiveReading.panel.showKnown') }}</button></p>
        <ul class="fr-reading-hints"><li v-for="hint in visibleHints" :key="`${hint.start}:${hint.end}`" data-reading-phrase :data-reading-term="hint.term">
          <strong data-i18n-ignore>{{ hint.term }}</strong><span v-if="hint.reference"><span data-i18n-ignore>{{ hint.reference }}</span> <small>{{ t(hint.saved ? 'progressiveReading.panel.savedReference' : 'progressiveReading.panel.localReference') }}</small></span>
          <button type="button" :title="t('progressiveReading.panel.queryExpressionHelp')" @click="assistance('phrases', hint)">{{ t('progressiveReading.panel.queryExpression') }}</button>
        </li></ul>
        <p v-if="!visibleHints.length" class="fr-reading-note">{{ t('progressiveReading.panel.noHints') }}</p>
        <p v-if="state.hintError" role="status">{{ translateLegacy(state.hintError) }}</p>
        <p v-if="state.phraseLoading" role="status" data-i18n-ignore>{{ t('progressiveReading.panel.querying', {term: state.phraseTerm}) }}</p>
        <p v-if="state.phraseAnswer" data-reading-phrase-answer class="fr-reading-answer" data-i18n-ignore><strong>{{ state.phraseTerm }}</strong> · {{ state.phraseAnswer }}</p>
      </template>
      <template v-if="state.mode === 'logic'">
        <details class="fr-reading-help"><summary :aria-label="t('progressiveReading.panel.logicHelpLabel')">{{ t('progressiveReading.panel.logicHelpTitle') }}</summary><p>{{ t('progressiveReading.panel.logicHelp') }}</p></details>
        <ul class="fr-reading-hints fr-reading-clues"><li v-for="clue in state.clues" :key="`${clue.label}:${clue.start}`" data-reading-logic><details><summary :aria-label="t('progressiveReading.panel.clueDetails', {term: clue.term, label: translateLegacy(clue.label)})"><strong data-i18n-ignore>{{ clue.term }}</strong><span>{{ translateLegacy(clue.label) }}</span></summary><p>{{ translateLegacy(clue.detail) }}</p></details></li></ul>
        <p v-if="!state.clues.length" class="fr-reading-note" :title="t('progressiveReading.panel.noCluesHelp')">{{ t('progressiveReading.panel.noClues') }}</p>
      </template>
      <template v-if="state.mode === 'bilingual'">
        <div class="fr-reading-label">{{ t('progressiveReading.panel.translation') }} <small>{{ translateLegacy(state.translationOrigin) }}</small></div>
        <p v-if="state.loading" role="status">{{ t('progressiveReading.panel.translationLoading') }}</p>
        <p v-if="state.translation" data-reading-translation class="fr-reading-answer" data-i18n-ignore><SpeechFollowText :text="state.translation" :offset="0" :progress="listenKind === 'translation' ? speech.progress : null" /></p>
      </template>
    </div>
    <p v-if="state.error" class="fr-reading-error" role="alert">{{ translateLegacy(state.error) }}</p>
    <footer v-if="state.source"><button data-reading-full type="button" :disabled="state.loading" :title="t('progressiveReading.panel.openFullHelp')" @click="assistance('bilingual')">{{ t(state.error && state.mode === 'bilingual' ? 'progressiveReading.panel.retryFull' : 'progressiveReading.panel.modeBilingual') }}</button><span>{{ t('progressiveReading.panel.anytime') }}</span></footer>
  </section>
</template>
<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch} from 'vue';
import browser from 'webextension-polyfill';
import {config, subscribeConfig} from '@/src/services/config/store';
import {detectlang} from '@/src/core/language/detect';
import {createSelectionTtsClientRequestId, normalizeSpeechLanguage} from '@/src/features/selection-translation/speech/public';
import {SpeechFollowText} from '@/src/features/selection-translation/ui/public';
import {useUiI18n} from '@/src/ui/i18n';
import {createReadingSpeechController, createReadingSpeechState, type ReadingSpeechRate} from '../speech';
import type {ReadingState} from '../session';
import type {PhraseHint, ReadingMode} from '../hints';
const props = defineProps<{state: ReadingState; close(): void; useSelection(): void; assistance(mode: ReadingMode, phrase?: PhraseHint): void}>();
const panel = ref<HTMLElement>();
const {t, translateLegacy} = useUiI18n();
const audioKinds = ['source', 'translation'] as const;
const listenKind = ref<typeof audioKinds[number]>('source');
const speech = reactive(createReadingSpeechState());
const audioUrls = new Map<HTMLAudioElement, string>();
const speechController = createReadingSpeechController(speech, {
  createId: createSelectionTtsClientRequestId,
  synthesize: (text, language, clientRequestId) => browser.runtime.sendMessage({type: 'selectionTts', text, language, clientRequestId, playback: 'page'}),
  cancel: clientRequestId => browser.runtime.sendMessage({type: 'selectionTtsStop', clientRequestId}),
  createAudio(encoded, contentType) {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], {type: contentType}));
    try {const audio = new Audio(url); audio.preload = 'auto'; audioUrls.set(audio, url); return audio;}
    catch (error) {URL.revokeObjectURL(url); throw error;}
  },
  releaseAudio(audio) {
    const pageAudio = audio as HTMLAudioElement;
    pageAudio.pause(); pageAudio.removeAttribute('src'); pageAudio.load();
    const url = audioUrls.get(pageAudio);
    if (url) {URL.revokeObjectURL(url); audioUrls.delete(pageAudio);}
  },
});
const speechPreferences = () => JSON.stringify([config.from, config.to, config.selectionTtsMode, config.selectionTtsLocalVoice, config.selectionTtsVoices]);
let currentSpeechPreferences = speechPreferences();
const playLabel = computed(() => t(`progressiveReading.audio.${speech.status === 'playing' ? 'pause' : speech.status === 'paused' ? 'resume' : speech.status === 'preparing' ? 'cancel' : 'play'}`, {kind: t(`progressiveReading.audio.${listenKind.value}`)}));
function selectAudioKind(kind: typeof audioKinds[number]): void {if (listenKind.value !== kind) {speechController.clear(); listenKind.value = kind;}}
function toggleSpeech(): void {
  if (speech.status === 'playing') {speechController.pause(); return;}
  if (speech.status === 'preparing') {speechController.clear(); return;}
  const text = listenKind.value === 'source' ? props.state.source : props.state.translation;
  const language = listenKind.value === 'source' ? config.from === 'auto' ? detectlang(text) : config.from : config.to;
  void speechController.play(text, normalizeSpeechLanguage(language));
}
function playbackTime(seconds: number): string {const whole = Math.floor(seconds); return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;}
function setSpeechRate(event: Event): void {speechController.setRate(Number((event.target as HTMLSelectElement).value) as ReadingSpeechRate);}
function setSpeechLoop(event: Event): void {speechController.setLoop((event.target as HTMLInputElement).checked);}
watch(() => [props.state.open, props.state.source], () => {speechController.clear(); listenKind.value = 'source';}, {flush: 'sync'});
watch(() => props.state.translation, value => {if (listenKind.value === 'translation') {speechController.clear(); if (!value) listenKind.value = 'source';}}, {flush: 'sync'});
const systemTheme = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const theme = ref(config.theme);
const systemDark = ref(systemTheme?.matches ?? false);
const isDarkTheme = computed(() => theme.value === 'dark' || theme.value === 'auto' && systemDark.value);
let unsubscribeConfig: (() => void) | undefined;
function updateTheme(): void {
  theme.value = config.theme; systemDark.value = systemTheme?.matches ?? false;
  const preferences = speechPreferences();
  if (preferences !== currentSpeechPreferences) {speechController.clear(); currentSpeechPreferences = preferences;}
}
const modes: Array<{id: ReadingMode; key: string}> = [{id: 'original', key: 'progressiveReading.panel.modeOriginal'}, {id: 'phrases', key: 'progressiveReading.panel.modePhrases'}, {id: 'logic', key: 'progressiveReading.panel.modeLogic'}, {id: 'bilingual', key: 'progressiveReading.panel.modeBilingual'}];
const hiddenCount = computed(() => props.state.phrases.filter(hint => hint.hidden).length);
const visibleHints = computed(() => props.state.phrases.filter(hint => !hint.hidden || props.state.showKnown));
onMounted(() => {
  updateTheme();
  systemTheme?.addEventListener('change', updateTheme);
  unsubscribeConfig = subscribeConfig(updateTheme);
  void nextTick(() => panel.value?.focus({preventScroll: true}));
});
onBeforeUnmount(() => {speechController.dispose(); systemTheme?.removeEventListener('change', updateTheme); unsubscribeConfig?.();});
</script>
<style scoped>
.fr-reading {
  /* 内容脚本未装配扩展页面的 token/皮肤表；在面板内沿用共享语义值，避免继承宿主配色。 */
  --fr-color-brand: #ef4776; --fr-color-brand-strong: #dc315f; --fr-color-brand-soft: #fff0f4;
  --fr-color-ink: #172033; --fr-color-muted: #737c8f; --fr-color-line: #e5e8ef;
  --fr-color-surface: #fff; --fr-color-surface-soft: #f7f8fb;
  --fr-danger: #b1435e; --fr-danger-soft: #fff0f3;
  --fr-menu-shadow: 0 8px 28px rgba(27, 36, 57, .12), 0 2px 6px rgba(27, 36, 57, .04);
  position: fixed; right: 16px; bottom: 16px; width: 420px; max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 32px); overflow: auto; overscroll-behavior: contain;
  padding: 16px; border: 1px solid var(--fr-color-line); border-radius: 14px;
  background: var(--fr-color-surface); color: var(--fr-color-ink); box-shadow: var(--fr-menu-shadow);
  font: 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  overflow-wrap: anywhere; color-scheme: light; scrollbar-width: thin;
  scrollbar-color: var(--fr-color-muted) transparent;
}
.fr-reading.fr-dark-theme {
  --fr-color-brand-strong: #ffadc6; --fr-color-brand-soft: rgba(239, 71, 118, .16);
  --fr-color-ink: #f1f1f4; --fr-color-muted: #b4b4c0; --fr-color-line: #44444e;
  --fr-color-surface: #282830; --fr-color-surface-soft: #33333e;
  --fr-danger: #f1a7bc; --fr-danger-soft: #3c222b;
  --fr-menu-shadow: 0 10px 32px rgba(0, 0, 0, .28);
  color-scheme: dark;
}
header {display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 15px; line-height: 1.4;}
.fr-reading-heading {display: flex; align-items: center; gap: 8px; min-width: 0;}
.fr-reading-heading svg {flex: none; width: 27px; height: 27px; padding: 5px; border-radius: 8px; background: var(--fr-color-brand-soft); color: var(--fr-color-brand-strong);}
button {font: inherit; font-size: 12px; line-height: 1.4; font-weight: 600; cursor: pointer; color: var(--fr-color-ink); border: 1px solid var(--fr-color-line); border-radius: 8px; background: var(--fr-color-surface); padding: 7px 10px; transition: background .15s ease, border-color .15s ease;}
button:hover:not(:disabled) {border-color: var(--fr-color-brand-strong); background: var(--fr-color-brand-soft);}
button:focus-visible, summary:focus-visible {outline: 2px solid var(--fr-color-brand-strong); outline-offset: 2px;}
button:disabled {opacity: .48; cursor: default;}
header button {flex: none; width: 28px; height: 28px; padding: 0; border-color: transparent; background: transparent; color: var(--fr-color-muted); font-size: 20px; font-weight: 400; line-height: 1;}
.fr-reading-intro, .fr-reading-note, .fr-reading-empty {font-size: 12px; color: var(--fr-color-muted); margin: 10px 0;}
.fr-reading-help {margin: 10px 0; font-size: 12px; color: var(--fr-color-muted);}
summary {cursor: pointer; border-radius: 4px;}
summary::marker {color: var(--fr-color-muted);}
.fr-reading-help p {margin: 6px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--fr-color-surface-soft);}
.fr-reading-use {width: 100%; min-height: 34px; background: var(--fr-color-surface-soft);}
.fr-reading-modes {display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; margin: 10px 0;}
.fr-reading-modes button {min-height: 32px; padding: 6px 3px; font-size: 11px; background: var(--fr-color-surface-soft);}
.fr-reading-modes button[aria-pressed=true] {border-color: var(--fr-color-brand-strong); background: var(--fr-color-brand-soft); color: var(--fr-color-brand-strong);}
.fr-reading-body {border-top: 1px solid var(--fr-color-line); padding-top: 12px;}
.fr-reading-speech {margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--fr-color-line);}
.fr-reading-speech-heading {display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px;}
.fr-reading-audio-kind {display: flex; gap: 3px;}
.fr-reading-audio-kind button {padding: 3px 8px; border-color: transparent; color: var(--fr-color-muted); font-size: 11px;}
.fr-reading-audio-kind button[aria-pressed=true] {color: var(--fr-color-brand-strong); background: var(--fr-color-brand-soft);}
.fr-reading-audio-time {font-size: 11px; color: var(--fr-color-muted); font-variant-numeric: tabular-nums;}
.fr-reading-audio-controls {display: flex; align-items: center; flex-wrap: wrap; gap: 5px;}
.fr-reading-audio-controls button {display: grid; place-items: center; flex: none; width: 29px; height: 30px; padding: 4px;}
.fr-reading-audio-controls .fr-reading-audio-play {border-color: var(--fr-color-brand-strong); color: var(--fr-color-brand-strong); background: var(--fr-color-brand-soft);}
.fr-reading-audio-controls svg {width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;}
.fr-reading-audio-controls svg text {fill: currentColor; stroke: none; font: 10px system-ui; text-anchor: middle;}
.fr-reading-audio-controls select {width: 58px; height: 30px; padding: 3px; border: 1px solid var(--fr-color-line); border-radius: 7px; color: var(--fr-color-ink); background: var(--fr-color-surface); font: inherit; font-size: 11px;}
.fr-reading-audio-loop {display: flex; align-items: center; gap: 3px; margin-inline-start: auto; color: var(--fr-color-muted); font-size: 11px; cursor: pointer;}
.fr-reading-audio-loop input {margin: 0; accent-color: var(--fr-color-brand-strong);}
.fr-reading-audio-controls select:focus-visible, .fr-reading-audio-loop input:focus-visible {outline: 2px solid var(--fr-color-brand-strong); outline-offset: 2px;}
.fr-reading-label {font-size: 11px; color: var(--fr-color-muted); font-weight: 650;}
.fr-reading-source, .fr-reading-answer {white-space: pre-wrap; user-select: text; margin: 6px 0 14px;}
.fr-reading-answer {background: var(--fr-color-surface-soft); border-radius: 9px; padding: 10px 12px;}
.fr-reading-hints {list-style: none; padding: 0; margin: 8px 0;}
.fr-reading-hints li {border-top: 1px solid var(--fr-color-line); padding: 10px 0; display: flex; align-items: flex-start; gap: 6px; flex-direction: column;}
.fr-reading-hints span {font-size: 13px;}
.fr-reading-hints small, small {font-size: 11px; color: var(--fr-color-muted);}
.fr-reading-hints button, .fr-reading-known button {padding: 4px 8px; color: var(--fr-color-brand-strong); background: var(--fr-color-brand-soft);}
.fr-reading-known {display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;}
.fr-reading-clues li {padding: 7px 0;}
.fr-reading-clues details {width: 100%;}
.fr-reading-clues summary {font-size: 13px;}
.fr-reading-clues strong {margin-inline-end: 10px;}
.fr-reading-clues span {font-size: 12px; color: var(--fr-color-muted);}
.fr-reading-clues p {margin: 6px 0 0; color: var(--fr-color-muted); font-size: 12px;}
.fr-reading-error {color: var(--fr-danger); background: var(--fr-danger-soft); border-radius: 8px; padding: 8px 10px; font-size: 12px;}
footer {border-top: 1px solid var(--fr-color-line); padding-top: 12px; display: flex; gap: 10px; align-items: center;}
footer button {flex: none; border-color: #dc315f; background: #dc315f; color: #fff;}
footer button:hover:not(:disabled) {border-color: #c32753; background: #c32753;}
footer span {font-size: 11px; color: var(--fr-color-muted);}
@media (max-width: 480px) {.fr-reading {right: 12px; bottom: 12px; padding: 14px; max-height: 60dvh;} footer {align-items: flex-start;}}
@media (prefers-reduced-motion: reduce) {button {transition: none;}}
</style>

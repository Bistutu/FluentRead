<!--
 * @file src/features/vocabulary/ui/CollectionEntry.vue
 * 文件职责：以内容优先的单列布局展示收藏的原文、译文和独立解释。
 * 主要内容：相同译文保留原文且不重复展示；每条收藏直接提供听读理解或学习用法入口；朗读紧邻原文，复制与管理集中在可键盘使用的菜单，编辑解释时才挂载编辑器。
 * 模块边界：不访问存储、不发起朗读或模型请求，数据操作交由父级处理；解释编辑沿用已有保存组件。
 -->
<template>
  <article ref="root" class="word-row" :class="{'sentence-entry': sentence}">
    <header class="entry-heading">
      <h3><button type="button" class="entry-open" :title="t(sentence ? 'learning.collection.listenLearn' : 'learning.collection.learnUsage')" @click="emit('study')" data-i18n-ignore>{{ entry.term }}</button></h3>
      <div class="entry-actions">
        <button type="button" class="entry-icon" :class="{playing}" :aria-label="playing ? '停止朗读' : '朗读原文'" :title="playing ? '停止朗读' : '朗读原文'" @click="emit('speak')"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7h4l4-3v12l-4-3H3z"/><path :d="playing ? 'M14 7v6m3-6v6' : 'M14 7a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12'"/></svg></button>
        <span v-if="playing" class="entry-speech-status" role="status">{{ speechPhase === 'requesting' ? t('learning.collection.speechRequesting') : t('learning.collection.speechPlaying') }}</span>
        <details ref="menu" class="entry-more" name="fluentread-collection-popover" @keydown.esc.stop.prevent="closeMenu">
          <summary aria-label="更多收藏操作" title="更多收藏操作"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h.01 M10 10h.01 M16 10h.01"/></svg></summary>
          <div class="entry-menu">
            <button type="button" @click="closeMenu(); emit('copy', visibleTranslation)">{{ visibleTranslation ? '复制双语' : '复制原文' }}</button>
            <button v-if="visibleTranslation" type="button" @click="closeMenu(); emit('copy', false)">复制原文</button>
            <button type="button" @click="editNote">{{ entry.note ? '编辑解释' : '添加简短解释' }}</button>
            <button type="button" :disabled="busy" @click="act('mastery')">{{ entry.status === 'mastered' ? '重新学习' : '标记掌握' }}</button>
            <details class="entry-info">
              <summary>收藏信息</summary>
              <p>{{ status }} · {{ review }}<br>{{ entry.encounterCount }} 次收藏记录<span v-if="entry.partOfSpeech"> · {{ entry.partOfSpeech }}</span><span v-if="entry.phonetic"> · {{ entry.phonetic }}</span></p>
              <p v-if="context?.text" data-i18n-ignore>{{ context.text }}</p>
              <VocabularySource :context="sourceContext" />
            </details>
            <button type="button" class="danger" :disabled="busy" @click="act('remove')">删除收藏</button>
          </div>
        </details>
      </div>
    </header>
    <p v-if="visibleTranslation" class="entry-translation" data-i18n-ignore>{{ sentence ? translation : vocabularyReferencePreview(translation) }}</p>
    <p v-if="entry.note && !editing" class="entry-note" data-i18n-ignore>{{ entry.note }}</p>
    <SavedExplanation v-if="editing" :entry="entry" initial-editing @updated="updated" @cancel="editing = false" />
    <footer class="entry-footer">
      <div class="entry-meta"><span class="entry-kind">{{ t(sentence ? 'learning.collection.sentence' : 'learning.collection.expression') }}</span><span v-if="entry.status !== 'new'">{{ status }}</span><span v-if="entry.status !== 'new' && entry.status !== 'mastered'">{{ review }}</span></div>
      <button type="button" class="entry-study" @click="emit('study')">{{ t(sentence ? 'learning.collection.listenLearn' : 'learning.collection.learnUsage') }}<UiIcon name="arrow-right" :size="13" /></button>
    </footer>
  </article>
</template>
<script setup lang="ts">
import {hasDistinctTranslation} from '@/src/core/translation/result';
import {computed, nextTick, ref} from 'vue';
import {isVocabularySentence, vocabularyReferencePreview, vocabularyStudyContext, type VocabularyEntry} from '../learningModel';
import SavedExplanation from './SavedExplanation.vue';
import VocabularySource from './VocabularySource.vue';
import {vocabularySourceContext} from '../source';
import UiIcon from '@/src/ui/components/UiIcon.vue';
import {useUiI18n} from '@/src/ui/i18n';
const {t} = useUiI18n();
const props = defineProps<{entry: VocabularyEntry; translation: string; playing: boolean; speechPhase: 'idle' | 'requesting' | 'playing'; busy: boolean; status: string; review: string}>();
const emit = defineEmits<{study: []; speak: []; copy: [bilingual: boolean]; mastery: []; remove: []; updated: [entry: VocabularyEntry]}>();
const visibleTranslation = computed(() => hasDistinctTranslation(props.entry.term, props.translation));
const sentence = computed(() => isVocabularySentence(props.entry));
const context = computed(() => vocabularyStudyContext(props.entry));
const sourceContext = computed(() => vocabularySourceContext(props.entry));
const root = ref<HTMLElement>();
const menu = ref<HTMLDetailsElement>();
const editing = ref(false);
function closeMenu(): void {if (menu.value) {menu.value.open = false; menu.value.querySelector<HTMLElement>('summary')?.focus();}}
function act(action: 'mastery' | 'remove'): void {closeMenu(); if (action === 'mastery') emit('mastery'); else emit('remove');}
async function editNote(): Promise<void> {closeMenu(); editing.value = true; await nextTick(); root.value?.querySelector('textarea')?.focus();}
function updated(entry: VocabularyEntry): void {editing.value = false; emit('updated', entry);}
</script>
<style scoped>
.word-row {min-width:0; padding:20px 22px; border-bottom:1px solid var(--line);}
.word-row:last-of-type {border-bottom:0;}
.entry-heading {display:flex; align-items:flex-start; gap:16px;}
.entry-heading h3 {flex:1; min-width:0; margin:0; font-size:20px; line-height:1.6; font-weight:650;}
.sentence-entry .entry-heading h3 {font-size:16px;}
.entry-open {display:block; width:100%; padding:0; border:0; background:transparent; color:var(--ink); font:inherit; text-align:left; overflow-wrap:anywhere; cursor:pointer;}
.entry-open:hover {color:var(--brand-strong);}
.entry-actions {display:flex; flex:none; align-items:center; gap:3px;}
.entry-speech-status {margin-left:4px; color:var(--brand-strong); font-size:11px; white-space:nowrap;}
.entry-icon,.entry-more > summary {display:grid; place-items:center; box-sizing:border-box; width:30px; height:30px; padding:6px; border:0; border-radius:7px; color:var(--muted); background:transparent; cursor:pointer; list-style:none;}
svg {width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round;}
.entry-more > summary svg {stroke-width:3;}
summary::-webkit-details-marker {display:none;}
.entry-icon:hover,.entry-icon.playing,.entry-more[open] > summary {color:var(--brand-strong); background:var(--brand-soft);}
.entry-translation {margin:7px 0 0; font-size:14px; line-height:1.8; color:var(--ink); white-space:pre-wrap; overflow-wrap:anywhere;}
.entry-note {margin:9px 0 0; font-size:13px; line-height:1.8; color:var(--muted); white-space:pre-wrap; overflow-wrap:anywhere;}
.entry-footer {display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-top:14px; font-size:11px; color:var(--muted);}
.entry-meta {display:flex; align-items:center; flex-wrap:wrap; gap:6px 10px;}
.entry-kind {padding:2px 7px; border-radius:5px; background:var(--surface-soft); color:var(--muted); font-size:10px; line-height:1.6;}
.entry-study {display:inline-flex; align-items:center; justify-content:center; gap:4px; min-height:32px; padding:0 10px; border:1px solid var(--line); border-radius:7px; color:var(--brand-strong); background:var(--surface); font:inherit; font-size:12px; font-weight:500; cursor:pointer;}
.entry-study:hover {border-color:var(--brand); background:var(--brand-soft);}
.entry-more {position:relative;}
.entry-menu {position:absolute; z-index:8; top:calc(100% + 5px); right:0; display:grid; width:210px; max-width:calc(100vw - 52px); padding:5px; border:1px solid var(--line); border-radius:10px; background:var(--surface); box-shadow:0 10px 28px #1720331a;}
.entry-menu > button,.entry-info > summary {padding:9px 10px; border:0; border-radius:6px; background:transparent; color:var(--ink); font:inherit; font-size:12px; text-align:left; cursor:pointer; list-style:none;}
.entry-menu > button:hover,.entry-info > summary:hover {background:var(--surface-soft);}
.entry-menu .danger {margin-top:4px; border-top:1px solid var(--line); border-radius:0 0 6px 6px; color:var(--fr-danger);}
.entry-info p,.entry-info a {display:block; margin:0 10px 9px; font-size:11px; line-height:1.6; color:var(--muted); overflow-wrap:anywhere;}
.entry-info p {max-height:160px; overflow:auto; white-space:pre-wrap;}
.entry-info a {color:var(--brand-strong);}
button:disabled {opacity:.5; cursor:default;}
button:focus-visible,summary:focus-visible {outline:2px solid var(--brand); outline-offset:2px;}
/* 设置页的通用折叠标题不应改变收藏操作菜单的尺寸与图标。 */
.word-row .entry-heading .entry-actions .entry-more > summary {display:grid; place-items:center; width:30px; min-height:30px; height:30px; padding:6px; margin:0; gap:0; border:0; border-radius:7px; background:transparent; color:var(--muted); font:inherit;}
.word-row .entry-heading .entry-actions .entry-more > summary::after,.word-row .entry-heading .entry-actions .entry-more .entry-info > summary::after {display:none; content:none;}
.word-row .entry-heading .entry-actions .entry-more .entry-info > summary {min-height:0; padding:9px 10px; margin:0; border:0; border-radius:6px; background:transparent; font:inherit; font-size:12px;}
@media(max-width:560px) {
  .word-row {padding:16px 14px;}
  .entry-heading {gap:8px;}
  .entry-heading h3 {font-size:18px;}
  .sentence-entry .entry-heading h3 {font-size:15px;}
  .entry-translation {font-size:13px;}
  .entry-footer {gap:8px;}
  .entry-icon,.word-row .entry-heading .entry-actions .entry-more > summary {width:28px; height:30px; padding:5px;}
}
</style>

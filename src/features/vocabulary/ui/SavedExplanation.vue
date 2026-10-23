<!--
 * @file src/features/vocabulary/ui/SavedExplanation.vue
 * 文件职责：展示和编辑收藏附带的简短解释，允许不调用 AI 的手动保存与清空。
 * 主要内容：用独立草稿保留未保存的编辑，通过 updateNote 更新已有收藏，切换收藏时重置草稿，并阻止旧收藏或卸载后的响应回写界面。
 * 模块边界：不增添收藏次数、不修改译文或掌握程度，持久化和删除竞争由后台仓库负责。
 -->
<template>
  <div class="saved-explanation">
    <p v-if="entry.note && !editing" class="saved-note" data-i18n-ignore>{{ entry.note }}</p>
    <button v-if="!editing" type="button" @click="edit">{{ entry.note ? '编辑解释' : '添加简短解释' }}</button>
    <form v-else @submit.prevent="save">
      <label>简短解释<textarea v-model="draft" rows="3" maxlength="2000" aria-label="收藏的简短解释" placeholder="记下句意、一个表达的用法，或自己理解时的提示…" :disabled="busy" @keydown.stop /></label>
      <div><button type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存解释' }}</button><button type="button" :disabled="busy" @click="editing = false; emit('cancel')">取消</button></div>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
<script setup lang="ts">
import {onBeforeUnmount, ref, watch} from 'vue';
import browser from 'webextension-polyfill';
import {VOCABULARY_BOOK_MESSAGE, type VocabularyBookResponse, type VocabularyEntry} from '../learningModel';
const props = defineProps<{entry: VocabularyEntry; initialEditing?: boolean}>();
const emit = defineEmits<{updated: [entry: VocabularyEntry]; cancel: []}>();
const editing = ref(props.initialEditing === true);
const draft = ref(props.initialEditing ? props.entry.note || '' : '');
const busy = ref(false);
const error = ref('');
let active = true;
let generation = 0;
watch(() => props.entry.id, () => {
  generation += 1;
  busy.value = false; error.value = '';
  editing.value = props.initialEditing === true;
  draft.value = props.initialEditing ? props.entry.note || '' : '';
}, {flush: 'sync'});
function edit(): void {draft.value = props.entry.note || ''; editing.value = true; error.value = '';}
async function save(): Promise<void> {
  if (busy.value) return;
  const owner = generation;
  const current = () => active && owner === generation;
  busy.value = true; error.value = '';
  try {
    const response = await browser.runtime.sendMessage({type:VOCABULARY_BOOK_MESSAGE, action:'updateNote', entryId:props.entry.id, note:draft.value}) as VocabularyBookResponse<VocabularyEntry>;
    if (!response.success) throw new Error(response.error.message);
    if (current()) {emit('updated', response.data); editing.value = false;}
  } catch (cause) {if (current()) error.value = cause instanceof Error ? cause.message : '解释保存失败，请重试';}
  finally {if (current()) busy.value = false;}
}
onBeforeUnmount(() => {active = false;});
</script>
<style scoped>
.saved-explanation {margin-top:9px; color:var(--muted); font-size:12px; line-height:1.7;}
.saved-note {margin:0 0 6px; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--ink);}
.saved-explanation button {font:inherit; color:var(--brand); background:var(--surface); border:1px solid var(--line); padding:5px 8px; border-radius:7px; cursor:pointer;}
.saved-explanation button:disabled {opacity:.5; cursor:default;}
.saved-explanation form div {display:flex; gap:8px;}
.saved-explanation textarea {display:block; box-sizing:border-box; width:100%; margin:5px 0 8px; padding:9px; border:1px solid var(--line); border-radius:8px; background:var(--surface-soft); color:var(--ink); font:inherit; resize:vertical;}
.saved-explanation button:focus-visible,.saved-explanation textarea:focus-visible {outline:2px solid var(--brand); outline-offset:2px;}
</style>

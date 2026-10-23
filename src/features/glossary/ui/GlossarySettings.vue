<!--
 * @file src/features/glossary/ui/GlossarySettings.vue
 * 文件职责：提供可直接上手的个人术语库设置，集中管理词库、适用语言、网站范围和固定译名。
 * 主要内容：直接展示导入、新建与匹配预览，词库卡片内固定保留设置入口，多词库优先级独立管理；以单一 Vue 状态控制设置展开，管理独立草稿、范围解释、重复词条校验与串行保存；卸载后到达的删除确认不会再发起保存。
 * 模块边界：配置通过现有 requestConfigPatch 保存并在失败时回读权威状态；文件只在本地解析，界面不请求翻译服务、不改写宿主网页。
 -->
<template>
  <div class="fluentread-glossary" data-testid="glossary-settings" data-i18n-ignore>
    <FeatureEnableCard :model-value="enabled" :title="t('glossary.enable')" :description="t('glossary.simpleIntro')" :disabled="busy || !ready" @update:model-value="setEnabled" />
    <p v-if="error" class="glossary-error glossary-notice" role="alert">{{ error }}</p>

    <div>
      <div class="glossary-toolbar glossary-main-toolbar">
        <h3>{{ t('glossary.libraries') }} <small v-if="libraries.length">{{ libraries.length }}</small></h3>
        <span class="glossary-save-state" role="status" aria-live="polite">{{ busy ? t('glossary.saving') : saved && !hasMetadataDraft && !entryDraft ? t('glossary.saved') : '' }}</span>
        <div class="glossary-actions glossary-management-actions">
          <button v-if="totalEntries" type="button" @click="previewOpen = true"><UiIcon name="search" :size="16" />{{ t('glossary.preview') }}</button>
          <button type="button" :disabled="busy || !ready || atLibraryLimit" @click="openImport()"><UiIcon name="glossary" :size="16" />{{ t('glossary.import') }}</button>
          <button type="button" :disabled="busy || !ready || atLibraryLimit" @click="addLibrary()"><UiIcon name="plus" :size="16" />{{ t('glossary.newLibrary') }}</button>
        </div>
      </div>
      <p v-if="atLibraryLimit" class="glossary-warning" role="status">{{ t('glossary.capacity') }}</p>
      <div v-if="!selected" class="glossary-card glossary-start">
        <h3>{{ t('glossary.emptyTitle') }}</h3><p class="glossary-help">{{ t('glossary.startHelp') }}</p>
        <button type="button" class="primary" :disabled="busy || !ready" @click="startEntry()"><UiIcon name="plus" :size="16" />{{ t('glossary.addEntry') }}</button>
      </div>
      <section v-else :key="`${selected.id}-${viewRevision}`" class="glossary-card glossary-editor" :aria-label="t('glossary.librarySettings')">
        <div class="glossary-library-heading">
          <label v-if="libraries.length > 1" class="glossary-library-picker"><span class="glossary-visually-hidden">{{ t('glossary.selection') }}</span><ElSelect class="glossary-select" :model-value="selectedId" :aria-label="t('glossary.selection')" @change="selectLibrary"><ElOption v-for="library in libraries" :key="library.id" :value="library.id" :label="library.name" /></ElSelect></label>
          <strong v-else>{{ selected.name }}</strong>
        </div>
        <div class="glossary-scope-summary" :title="selected.domains.join(', ') || t('glossary.allWebsites')">
          <span>{{ languageLabel(selected.sourceLanguage) }} → {{ languageLabel(selected.targetLanguage) }}</span>
          <span>{{ selected.domains.length ? selected.domains[0] + (selected.domains.length > 1 ? ` +${selected.domains.length - 1}` : '') : t('glossary.allWebsites') }}</span>
        </div>
        <div v-if="selected.entries.length || !entryDraft" class="glossary-entry-toolbar">
          <div v-if="selected.entries.length" class="glossary-search"><UiIcon name="search" :size="17" /><input v-model="query" type="search" :aria-label="t('glossary.search')" :placeholder="t('glossary.search')" /></div>
          <p v-else class="glossary-help glossary-empty-copy">{{ t('glossary.emptyLibraryHelp') }}</p>
          <button v-if="!entryDraft" type="button" class="primary" :disabled="!ready || busy || atEntryLimit" @click="editEntry()"><UiIcon name="plus" :size="15" />{{ t('glossary.addEntry') }}</button>
        </div>
        <p v-if="atEntryLimit" class="glossary-warning">{{ t('glossary.capacity') }}</p>
          <form v-if="entryDraft" class="glossary-entry-form" @submit.prevent="saveEntry">
            <div class="glossary-form-heading"><strong>{{ t(selected.entries.some(entry => entry.id === entryDraft?.id) ? 'glossary.edit' : 'glossary.addEntry') }}</strong></div>
            <label>{{ t('glossary.source') }}<input ref="sourceInput" v-model="entryDraft.source" required :maxlength="GLOSSARY_LIMITS.termLength" placeholder="large language model" /></label>
            <label>{{ t('glossary.target') }}<input v-model="entryDraft.target" :aria-label="t('glossary.target')" aria-describedby="glossary-target-help" :maxlength="GLOSSARY_LIMITS.termLength" :placeholder="t('glossary.keepOriginal')" /><small id="glossary-target-help">{{ t('glossary.blankTarget') }}</small></label>
            <details class="glossary-entry-options glossary-wide"><summary>{{ t('glossary.matchOptions') }}</summary><label class="glossary-check"><input v-model="entryDraft.caseSensitive" type="checkbox" />{{ t('glossary.caseSensitive') }}</label></details>
            <div v-if="duplicateEntry" class="glossary-warning glossary-wide" role="status">{{ t('glossary.duplicateHelp') }} <button type="button" @click="editEntry(duplicateEntry)">{{ t('glossary.editExisting') }}</button></div>
            <div class="glossary-actions glossary-wide"><button type="button" @click="cancelEntry">{{ t('common.cancel') }}</button><button type="submit" class="primary" :disabled="busy || Boolean(duplicateEntry) || !entryDraft.source.trim()">{{ t('common.save') }}</button></div>
          </form>
          <div v-if="selected.entries.length" class="glossary-table-scroll">
            <table class="glossary-table"><thead><tr><th>{{ t('glossary.source') }}</th><th>{{ t('glossary.target') }}</th><th>{{ t('glossary.actions') }}</th></tr></thead>
              <tbody><tr v-for="entry in visibleEntries" :key="entry.id"><td><span>{{ entry.source }}</span><small v-if="entry.caseSensitive" :title="t('glossary.caseSensitive')">Aa</small></td><td><span :class="{'glossary-original': !entry.target}">{{ entry.target || t('glossary.keepOriginal') }}</span></td><td><div class="glossary-actions"><button type="button" :disabled="busy" :aria-label="t('glossary.editNamed', {name: entry.source})" @click="editEntry(entry)"><UiIcon name="pen" :size="15" /></button><button type="button" :disabled="busy" :aria-label="t('glossary.deleteNamed', {name: entry.source})" @click="deleteEntry(entry)"><UiIcon name="close" :size="15" /></button></div></td></tr>
              <tr v-if="!filteredEntries.length"><td colspan="3" class="glossary-no-results"><UiIcon :name="query ? 'search' : 'glossary'" :size="24" /><p>{{ query ? t('glossary.noResults') : t('glossary.noEntries') }}</p><button v-if="query" type="button" @click="query = ''">{{ t('glossary.clearSearch') }}</button></td></tr></tbody>
            </table>
          </div>
          <footer v-if="selected.entries.length" class="glossary-editor-footer"><small>{{ t('glossary.entryCount', {count: filteredEntries.length}) }}</small><div v-if="filteredEntries.length > PAGE_SIZE" class="glossary-pagination"><button type="button" :aria-label="t('glossary.previousPage')" :disabled="entryPage === 0" @click="entryPage--">←</button><span>{{ entryPage + 1 }}/{{ Math.ceil(filteredEntries.length / PAGE_SIZE) }}</span><button type="button" :aria-label="t('glossary.nextPage')" :disabled="(entryPage + 1) * PAGE_SIZE >= filteredEntries.length" @click="entryPage++">→</button></div></footer>

        <p v-if="!selected.enabled" class="glossary-inline-state">{{ t('glossary.reason.disabled') }} <button type="button" class="glossary-text-button" :disabled="busy" @click="patchLibrary({enabled: true})">{{ t('glossary.libraryEnabled') }}</button></p>
          <div class="glossary-settings-details">
            <button type="button" class="glossary-settings-toggle" :aria-label="t('glossary.librarySettings')" :aria-expanded="settingsOpen" aria-controls="glossary-library-settings" @click="settingsOpen = !settingsOpen">
              <UiIcon name="sliders" :size="16" /><span class="glossary-settings-copy"><strong>{{ t('glossary.librarySettings') }}</strong><small>{{ t('glossary.settingsSummary') }}</small></span><UiIcon name="chevron-down" :size="16" class="glossary-settings-chevron" />
            </button>
            <fieldset v-show="settingsOpen" id="glossary-library-settings" :disabled="!ready">
              <label class="glossary-check"><input type="checkbox" :disabled="busy || !ready" :checked="selected.enabled" @change="patchLibrary({enabled: ($event.target as HTMLInputElement).checked})" />{{ t('glossary.libraryEnabled') }}</label>
              <div class="glossary-metadata">
                <label class="glossary-wide">{{ t('glossary.name') }}<input ref="nameInput" :value="metadataValue('name')" :maxlength="GLOSSARY_LIMITS.nameLength" @input="editMetadata('name', $event)" @change="updateName" /></label>
                <label>{{ t('glossary.sourceLanguage') }}<ElSelect class="glossary-select" :empty-values="[null, undefined]" :model-value="selected.sourceLanguage" :aria-label="t('glossary.sourceLanguage')" @change="updateLanguage('sourceLanguage', $event)" filterable>
                  <ElOption value="" :label="t('glossary.anyLanguage')" /><ElOption v-for="item in languageOptions(selected.sourceLanguage)" :key="item.value" :value="item.value" :label="item.label" />
                </ElSelect></label>
                <label>{{ t('glossary.targetLanguage') }}<ElSelect class="glossary-select" :empty-values="[null, undefined]" :model-value="selected.targetLanguage" :aria-label="t('glossary.targetLanguage')" @change="updateLanguage('targetLanguage', $event)" filterable>
                  <ElOption value="" :label="t('glossary.anyLanguage')" /><ElOption v-for="item in languageOptions(selected.targetLanguage)" :key="item.value" :value="item.value" :label="item.label" />
                </ElSelect></label>
                <label class="glossary-wide">{{ t('glossary.domains') }}<textarea rows="2" :value="metadataValue('domains')" :aria-label="t('glossary.domains')" :placeholder="t('glossary.domainsPlaceholder')" @input="editMetadata('domains', $event)" @change="updateDomains" /><small>{{ t('glossary.domainsHelp') }}</small></label>
              </div>
              <div class="glossary-toolbar">
                <button type="button" class="danger" :disabled="busy" @click="deleteLibrary">{{ t('glossary.deleteLibrary') }}</button>
                <div class="glossary-actions"><ElSelect class="glossary-select" v-model="exportFormat" :aria-label="t('glossary.exportFormat')"><ElOption label="CSV" value="CSV" /><ElOption label="TSV" value="TSV" /><ElOption label="JSON" value="JSON" /></ElSelect><button type="button" @click="downloadLibrary">{{ t('glossary.export') }}</button></div>
              </div>
            </fieldset>
          </div>

      </section>
      <details v-if="libraries.length > 1" class="glossary-order-details">
        <summary>{{ t('glossary.manageOrder') }}</summary>
        <p class="glossary-help">{{ t('glossary.priority') }}</p>
        <div v-for="(library, index) in libraries" :key="library.id" class="glossary-library-row" :class="{selected: selectedId === library.id}">
          <button type="button" class="glossary-library-name" @click="selectLibrary(library.id)"><span>{{ library.name }}</span><small>{{ t('glossary.entryCount', {count: library.entries.length}) }}</small></button>
          <div class="glossary-library-order"><button type="button" :aria-label="t('glossary.moveUp', {name: library.name})" :disabled="busy || index === 0" @click="moveLibrary(index, -1)">↑</button><button type="button" :aria-label="t('glossary.moveDown', {name: library.name})" :disabled="busy || index === libraries.length - 1" @click="moveLibrary(index, 1)">↓</button></div>
        </div>
      </details>
    </div>
    <div ref="builtinsElement" class="glossary-builtins-page">
      <BuiltinGlossaries :libraries="libraries" :enabled="enabled" :disabled="busy || !ready" @add="addBuiltin" />
    </div>
    <el-dialog v-model="previewOpen" :title="t('glossary.preview')" width="min(760px, calc(100vw - 28px))" class="glossary-check-dialog">
      <div class="fluentread-glossary glossary-preview" data-testid="glossary-preview" data-i18n-ignore>
        <div v-if="!totalEntries" class="glossary-preview-empty">
          <p>{{ t('glossary.previewNeedsEntries') }}</p>
          <button type="button" class="primary" :disabled="busy || !ready" @click="startEntry()">{{ t('glossary.addEntry') }}</button>
          <button type="button" @click="showBuiltins()">{{ t('glossary.builtin.title') }}</button>
        </div>
        <div v-else>
          <label>{{ t('glossary.previewText') }}<textarea v-model="previewText" rows="2" placeholder="FluentRead uses a large language model." /></label>
          <section v-if="preview.terms.length" class="glossary-match-result" data-testid="glossary-matches" :aria-label="t('glossary.matchCount', {count: preview.terms.length})">
            <header class="glossary-match-heading">
              <strong role="status" aria-live="polite">{{ t('glossary.matchCount', {count: preview.terms.length}) }}</strong>
            </header>
            <div class="glossary-match-table-scroll"><table class="glossary-match-table">
              <thead><tr><th scope="col">{{ t('glossary.source') }}</th><th scope="col">{{ t('glossary.preferredTranslation') }}</th></tr></thead>
              <tbody><tr v-for="term in preview.terms" :key="term.source"><td>{{ term.source }}</td><td><strong>{{ term.target }}</strong></td></tr></tbody>
            </table></div>
          </section>
          <div v-else-if="previewText.trim()" class="glossary-no-match"><p>{{ t('glossary.noMatches') }}</p><button type="button" class="glossary-text-button" :disabled="busy || atEntryLimit" @click="startEntry(previewText)">{{ t(previewText.trim().length <= GLOSSARY_LIMITS.termLength ? 'glossary.addFromPreview' : 'glossary.addEntry') }}</button></div>
          <div v-if="preview.conflicts.length" class="glossary-warning" role="status"><strong>{{ t('glossary.conflicts') }}</strong><p v-for="(conflict, index) in preview.conflicts" :key="index">{{ t('glossary.conflict', {source: conflict.source, kept: conflict.keptTarget, ignored: conflict.ignoredTarget}) }}</p></div>
          <details class="glossary-preview-options"><summary>{{ t('glossary.checkScope') }}</summary>
      <div class="glossary-preview-context">
        <label>{{ t('glossary.sourceLanguage') }}<ElSelect class="glossary-select" :empty-values="[null, undefined]" v-model="previewSource" :aria-label="t('glossary.sourceLanguage')" filterable><ElOption value="" :label="t('glossary.autoLanguage')" /><ElOption v-for="item in languageOptions(previewSource)" :key="item.value" :value="item.value" :label="item.label" /></ElSelect></label>
        <label>{{ t('glossary.targetLanguage') }}<ElSelect class="glossary-select" v-model="previewTarget" :aria-label="t('glossary.targetLanguage')" filterable><ElOption v-for="item in languageOptions(previewTarget)" :key="item.value" :value="item.value" :label="item.label" /></ElSelect></label>
        <label>{{ t('glossary.previewUrl') }}<input v-model="previewUrl" type="url" placeholder="https://example.com/article" /></label>
      </div>

          </details>
          <details v-if="previewText.trim() && (!preview.terms.length || preview.conflicts.length)" class="glossary-diagnostic-details"><summary>{{ t('glossary.checkReasons') }}</summary>
      <div class="glossary-diagnostics" v-if="libraries.length"><div v-for="item in previewLibraries" :key="item.library.id"><button type="button" class="glossary-text-button" @click="selectLibrary(item.library.id)">{{ item.library.name }}</button><span :class="{'glossary-help': item.reason === 'eligible', 'glossary-warning': item.reason !== 'eligible'}">{{ t(`glossary.reason.${item.reason}`) }}</span></div></div>

          </details>
        </div>
      </div>
    </el-dialog>
    <el-dialog v-model="importOpen" :title="t('glossary.import')" width="min(720px, calc(100vw - 28px))" :close-on-click-modal="false" class="glossary-import-dialog">
      <div class="fluentread-glossary" data-i18n-ignore>
        <p class="glossary-help">{{ t('glossary.importHelp') }}</p>
        <label>{{ t('glossary.file') }}<input type="file" accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json" @change="readImportFile" /></label>
        <label>{{ t('glossary.format') }}<ElSelect class="glossary-select"  v-model="importFormat" :aria-label="t('glossary.format')" @change="invalidateFileRead"><ElOption value="csv" label="CSV" /><ElOption value="tsv" label="TSV" /><ElOption value="json" label="JSON" /></ElSelect></label>
        <label>{{ t('glossary.importText') }}<textarea v-model="importText" rows="6" placeholder="source,target,tgt_lng&#10;large language model,大语言模型,zh-Hans" @input="invalidateFileRead" /></label>
        <p v-if="fileError" class="glossary-error" role="alert">{{ fileError }}</p>
        <template v-if="importText.trim()">
          <p role="status">{{ t('glossary.importSummary', {total: importPreview.totalEntries, accepted: importPreview.acceptedEntries, libraries: importPreview.libraries.length}) }}</p>
          <div v-for="(message, index) in importErrors" :key="`error-${index}`" class="glossary-error" role="alert">{{ message }}</div>
          <div v-for="(message, index) in importPreview.warnings" :key="`warning-${index}`" class="glossary-warning">{{ message }}</div>
          <div class="glossary-import-preview"><details v-for="library in importPreview.libraries" :key="library.id" open><summary>{{ library.name }} · {{ t('glossary.entryCount', {count: library.entries.length}) }}</summary><p v-for="entry in library.entries" :key="entry.id">{{ entry.source }} → {{ entry.target || t('glossary.keepOriginal') }}</p></details></div>
          <label v-if="importPreview.warnings.length" class="glossary-check"><input v-model="acceptWarnings" type="checkbox" />{{ t('glossary.acceptWarnings') }}</label>
        </template>
        <div class="glossary-actions glossary-dialog-actions"><button type="button" @click="importOpen = false">{{ t('common.cancel') }}</button><button type="button" class="primary" :disabled="!canImport || busy" @click="confirmImport">{{ t('glossary.confirmImport') }}</button></div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import UiIcon from '@/src/ui/components/UiIcon.vue'
import ElSelect from '@/src/ui/components/UiSelect.vue';
import {ElOption} from 'element-plus';
import 'element-plus/es/components/select/style/css';
import FeatureEnableCard from '@/src/ui/components/FeatureEnableCard.vue';
import {computed, nextTick, onBeforeUnmount, ref, watch} from 'vue';
import {ElMessageBox} from 'element-plus';
import browser from 'webextension-polyfill';
import {config, configReady, requestConfigPatch, subscribeConfig} from '@/src/services/config/store';
import {getMultilingualTargetLanguageLabel, options} from '@/src/core/config/catalog';
import {GLOSSARY_LIMITS, createGlossaryEntry, createGlossaryLibrary, normalizeGlossaryDomain,
  normalizeGlossaryLibraries, resolveGlossary, getGlossaryScopeReason, glossarySourcesOverlap, parseGlossaryImport, exportGlossary,
  decodeGlossaryText, type GlossaryEntry, type GlossaryLibrary, type GlossaryImportFormat} from '@/src/core/glossary';
import {useUiI18n} from '@/src/ui/i18n';
import {addBuiltinGlossary, BUILTIN_GLOSSARIES} from '@/src/core/glossary/builtins';
import BuiltinGlossaries from './BuiltinGlossaries.vue';
import {normalizeGlossaryLanguage, cleanGlossaryText} from '@/src/core/glossary/model';

const {t, language} = useUiI18n();
const libraries = ref<GlossaryLibrary[]>([]);
const enabled = ref(false);
const builtinsElement = ref<HTMLElement | null>(null);
async function showBuiltins(): Promise<void> {
  previewOpen.value = false;
  await nextTick();
  builtinsElement.value?.scrollIntoView({block: 'start', behavior: 'smooth'});
}
const previewOpen = ref(false);
const totalEntries = computed(() => libraries.value.reduce((count, library) => count + library.entries.length, 0));
const settingsOpen = ref(false);
const sourceInput = ref<HTMLInputElement>();
const nameInput = ref<HTMLInputElement>();
const entryDrafts = new Map<string, GlossaryEntry>();
const entryDraftOrigins = new Map<string, string>();
const atLibraryLimit = computed(() => libraries.value.length >= GLOSSARY_LIMITS.libraries);
const atEntryLimit = computed(() => (selected.value?.entries.length || 0) >= GLOSSARY_LIMITS.entriesPerLibrary
  || libraries.value.reduce((count, library) => count + library.entries.length, 0) >= GLOSSARY_LIMITS.totalEntries);
const selectedId = ref('');
const ready = ref(false);
const busy = ref(false);
const saved = ref(false);
const error = ref('');
const viewRevision = ref(0);
const query = ref('');
const entryPage = ref(0);
const PAGE_SIZE = 30;
const entryDraft = ref<GlossaryEntry | null>(null);
type MetadataTextField = 'name' | 'domains';
const metadataDrafts = ref<Partial<Record<MetadataTextField, {libraryId: string; value: string}>>>({});
const hasMetadataDraft = computed(() => Object.keys(metadataDrafts.value).length > 0);
const exportFormat = ref('CSV');
let disposed = false;
let pendingSaves = 0;
let saveQueue: Promise<unknown> = Promise.resolve();
let fileReadGeneration = 0;
const selected = computed(() => libraries.value.find(item => item.id === selectedId.value));
const filteredEntries = computed(() => (selected.value?.entries || []).filter(entry => `${entry.source}\n${entry.target}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
const visibleEntries = computed(() => filteredEntries.value.slice(entryPage.value * PAGE_SIZE, (entryPage.value + 1) * PAGE_SIZE));
const duplicateEntry = computed(() => entryDraft.value && selected.value?.entries.find(entry => entry.id !== entryDraft.value!.id && glossarySourcesOverlap(entry, entryDraft.value!)));
const entryDirty = computed(() => {
  if (!entryDraft.value) return false;
  const original = selected.value?.entries.find(entry => entry.id === entryDraft.value!.id);
  return original ? JSON.stringify(original) !== JSON.stringify(entryDraft.value)
    : Boolean(entryDraft.value.source || entryDraft.value.target || entryDraft.value.caseSensitive);
});
watch([query, selectedId, () => filteredEntries.value.length], () => {entryPage.value = 0;});

function hydrate(next = config): void {
  const previousId = selectedId.value;
  libraries.value = normalizeGlossaryLibraries(next.glossaryLibraries);
  enabled.value = next.glossaryEnabled;
  for (const id of entryDrafts.keys()) if (!libraries.value.some(item => item.id === id)) {entryDrafts.delete(id); entryDraftOrigins.delete(id);}
  if (!libraries.value.some(item => item.id === selectedId.value)) selectedId.value = libraries.value[0]?.id || '';
  if (selectedId.value !== previousId) {metadataDrafts.value = {}; entryDraft.value = entryDrafts.get(selectedId.value) || null;}
}
const unsubscribe = subscribeConfig(next => {if (!disposed) hydrate(next);});
void configReady.then(() => {if (!disposed) {hydrate(); ready.value = true;}}).catch(() => {if (!disposed) error.value = t('glossary.loadFailed');});
onBeforeUnmount(() => {disposed = true; fileReadGeneration++; unsubscribe();});

type GlossaryPatch = {glossaryLibraries?: GlossaryLibrary[]; glossaryEnabled?: boolean};
function persist(patch: GlossaryPatch | (() => GlossaryPatch)): Promise<boolean> {
  if (disposed) return Promise.resolve(false);
  if (!ready.value) {error.value = t('glossary.loadFailed'); return Promise.resolve(false);}
  pendingSaves++; busy.value = true; error.value = ''; saved.value = false;
  const operation = saveQueue.then(async () => {
    try {
      await requestConfigPatch(typeof patch === 'function' ? patch() : patch, browser.runtime.sendMessage.bind(browser.runtime));
      if (!disposed) {hydrate(); saved.value = true;}
      return true;
    } catch {
      if (!disposed) {hydrate(); saved.value = false; viewRevision.value++; error.value = t('glossary.saveFailed');}
      return false;
    } finally {pendingSaves--; if (!disposed) busy.value = pendingSaves > 0;}
  });
  saveQueue = operation;
  return operation;
}
function setEnabled(value: boolean): void {void persist({glossaryEnabled: value});}
function selectLibrary(id: string): void {
  previewOpen.value = false;
  if (id === selectedId.value) return;
  if (entryDraft.value) entryDrafts.set(selectedId.value, entryDraft.value);
  selectedId.value = id; entryDraft.value = entryDrafts.get(id) || null; metadataDrafts.value = {}; query.value = ''; settingsOpen.value = false;
}
/** 首次添加自动准备词库，用户无需先理解或命名词库；保留原有启停选择。 */
async function startEntry(source = ''): Promise<void> {
  if (!ready.value || busy.value) return;
  if (!selected.value) await addLibrary();
  if (!selected.value || error.value) return;
  settingsOpen.value = false; previewOpen.value = false;
  const previous = entryDraft.value;
  await editEntry();
  if (entryDraft.value && entryDraft.value !== previous && cleanGlossaryText(source).length <= GLOSSARY_LIMITS.termLength) entryDraft.value.source = cleanGlossaryText(source);
  await nextTick(); sourceInput.value?.scrollIntoView?.({block: 'nearest'}); sourceInput.value?.focus();
}
async function addLibrary(): Promise<void> {
  if (busy.value || !ready.value) return;
  if (atLibraryLimit.value) {error.value = t('glossary.capacity'); return;}
  const library = createGlossaryLibrary(libraries.value);
  const base = t('glossary.newName');
  let name = base; let suffix = 2;
  while (libraries.value.some(item => item.name === name)) name = `${base} ${suffix++}`;
  library.name = name;
  library.targetLanguage = normalizeGlossaryLanguage(config.to);
  if (await persist({glossaryLibraries: [...libraries.value, library]})) {
    selectLibrary(library.id); settingsOpen.value = true;
    await nextTick(); nameInput.value?.focus(); nameInput.value?.select();
  }
}
async function addBuiltin(id: string): Promise<void> {
  if (busy.value || !ready.value) return;
  const preset = BUILTIN_GLOSSARIES.find(item => item.id === id);
  if (!preset) return;
  const result = addBuiltinGlossary(id, libraries.value, t(preset.nameKey));
  if (result.status === 'capacity') {error.value = t('glossary.capacity'); return;}
  if (result.status === 'existing') {selectLibrary(result.library.id); return;}
  if (result.status === 'added' && await persist({glossaryLibraries: result.libraries})) selectLibrary(result.library.id);
}
async function patchLibrary(patch: Partial<GlossaryLibrary>): Promise<boolean> {
  if (!selected.value) return false;
  const libraryId = selectedId.value;
  return persist(() => ({glossaryLibraries: libraries.value.map(item => item.id === libraryId ? {...item, ...patch} : item)}));
}
function updateName(event: Event): void {
  editMetadata('name', event);
  const name = (event.target as HTMLInputElement).value.trim();
  if (!name) {error.value = t('glossary.nameRequired'); viewRevision.value++; return;}
  void saveMetadata('name', {name});
}
function updateLanguage(field: 'sourceLanguage' | 'targetLanguage', value: string): void {void patchLibrary({[field]: value});}
function updateDomains(event: Event): void {
  editMetadata('domains', event);
  const values = (event.target as HTMLTextAreaElement).value.split(/\r?\n/u).map(value => value.trim()).filter(Boolean);
  const domains = values.map(normalizeGlossaryDomain);
  if (domains.some(value => !value) || domains.length > GLOSSARY_LIMITS.domainsPerLibrary) {error.value = t('glossary.invalidDomains'); return;}
  void saveMetadata('domains', {domains: [...new Set(domains as string[])]});
}
function metadataValue(field: MetadataTextField): string {
  const draft = metadataDrafts.value[field];
  if (draft?.libraryId === selectedId.value) return draft.value;
  return field === 'name' ? selected.value?.name || '' : selected.value?.domains.join('\n') || '';
}
function editMetadata(field: MetadataTextField, event: Event): void {
  if (!selected.value) return;
  metadataDrafts.value[field] = {libraryId: selectedId.value, value: (event.target as HTMLInputElement | HTMLTextAreaElement).value};
}
async function saveMetadata(field: MetadataTextField, patch: Partial<GlossaryLibrary>): Promise<void> {
  const draft = metadataDrafts.value[field];
  if (!draft || draft.libraryId !== selectedId.value) return;
  // 输入即归本地草稿所有，但仍只在 change 时保存；旧回执不能覆盖继续输入的值。
  await patchLibrary(patch);
  if (metadataDrafts.value[field] === draft) delete metadataDrafts.value[field];
}
function languageOptions(current: string): {value: string; label: string}[] {
  const values = [...new Map([...options.to, {value: 'de', label: 'Deutsch'}, {value: 'pt', label: 'Português'}, {value: 'it', label: 'Italiano'}].map(item => [item.value.toLowerCase(), {value: item.value.toLowerCase(), label: getMultilingualTargetLanguageLabel(item.value, item.label, language.value)}])).values()];
  if (current && !values.some(item => item.value === current)) values.push({value: current, label: current});
  return values;
}
function languageLabel(value: string): string {
  return value ? languageOptions(value).find(item => item.value === value)?.label.split(' / ')[0] || value : t('glossary.anyLanguage');
}
function moveLibrary(index: number, direction: number): void {
  if (busy.value || index < 0 || index >= libraries.value.length || index + direction < 0 || index + direction >= libraries.value.length) return;
  const next = [...libraries.value];
  [next[index], next[index + direction]] = [next[index + direction], next[index]];
  void persist({glossaryLibraries: next});
}
async function confirmDeletion(name: string): Promise<boolean> {
  try {await ElMessageBox.confirm(t('glossary.deleteConfirm', {name}), t('glossary.delete'), {confirmButtonText: t('glossary.delete'), cancelButtonText: t('common.cancel'), type: 'warning'}); return true;} catch {return false;}
}
async function deleteLibrary(): Promise<void> {
  const library = selected.value;
  if (library && await confirmDeletion(library.name)) await persist(() => ({glossaryLibraries: libraries.value.filter(item => item.id !== library.id)}));
}
async function editEntry(entry?: GlossaryEntry): Promise<void> {
  const libraryId = selectedId.value;
  if (entry && entryDraft.value?.id === entry.id) {sourceInput.value?.focus(); return;}
  if (entryDirty.value && entryDraft.value?.id !== entry?.id) {
    try {await ElMessageBox.confirm(t('glossary.discardDraft'), t('glossary.edit'), {confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel')});} catch {return;}
  }
  if (selectedId.value !== libraryId) return;
  entryDraft.value = entry ? {...entry} : createGlossaryEntry(selected.value?.entries || []);
  if (entry) entryDraftOrigins.set(libraryId, entry.id);
  else entryDraftOrigins.delete(libraryId);
  await nextTick(); sourceInput.value?.focus();
}
function cancelEntry(): void {entryDrafts.delete(selectedId.value); entryDraftOrigins.delete(selectedId.value); entryDraft.value = null;}
async function saveEntry(): Promise<void> {
  const library = selected.value; const draft = entryDraft.value;
  if (!library || !draft || busy.value) return;
  const submittedDraft = {...draft};
  const source = cleanGlossaryText(submittedDraft.source);
  if (!source) {error.value = t('glossary.sourceRequired'); return;}
  if (duplicateEntry.value) {error.value = t('glossary.duplicateHelp'); return;}
  const entry = {...submittedDraft, source, target: cleanGlossaryText(submittedDraft.target)};
  const editing = entryDraftOrigins.get(library.id) === entry.id;
  let validationError = '';
  // 队列执行时合并最新词条列表，避免旧快照覆盖同时到达的修改或让已删除的词条复活。
  const success = await persist(() => {
    const current = libraries.value.find(item => item.id === library.id);
    if (!current || (editing && !current.entries.some(item => item.id === entry.id))) {
      validationError = t('glossary.entryChanged'); throw new Error('stale entry');
    }
    if (current.entries.some(item => (!editing || item.id !== entry.id) && glossarySourcesOverlap(item, entry))) {
      validationError = t('glossary.duplicateHelp'); throw new Error('duplicate entry');
    }
    if (!editing && current.entries.some(item => item.id === entry.id)) entry.id = createGlossaryEntry(current.entries).id;
    const entries = editing ? current.entries.map(item => item.id === entry.id ? entry : item) : [...current.entries, entry];
    if (entries.length > GLOSSARY_LIMITS.entriesPerLibrary || libraries.value.reduce((total, item) => total + (item.id === library.id ? entries.length : item.entries.length), 0) > GLOSSARY_LIMITS.totalEntries) {
      validationError = t('glossary.capacity'); throw new Error('capacity');
    }
    return {glossaryLibraries: libraries.value.map(item => item.id === library.id ? {...item, entries} : item)};
  });
  if (validationError) error.value = validationError;
  if (success) {
    draft.id = entry.id;
    // 保存成功但仍继续输入时，下一次保存必须更新同一词条。
    if (entryDraft.value === draft || entryDrafts.get(library.id) === draft) entryDraftOrigins.set(library.id, entry.id);
    if (draft.source === submittedDraft.source && draft.target === submittedDraft.target && draft.caseSensitive === submittedDraft.caseSensitive) {
      if (entryDraft.value === draft || entryDrafts.get(library.id) === draft) entryDraftOrigins.delete(library.id);
      if (entryDraft.value === draft) entryDraft.value = null;
      if (entryDrafts.get(library.id) === draft) entryDrafts.delete(library.id);
    }
  }
}

async function deleteEntry(entry: GlossaryEntry): Promise<void> {
  const libraryId = selected.value?.id;
  if (libraryId && await confirmDeletion(entry.source)) await persist(() => ({glossaryLibraries: libraries.value.map(library => library.id === libraryId ? {...library, entries: library.entries.filter(item => item.id !== entry.id)} : library)}));
}
function downloadLibrary(): void {
  if (!selected.value) return;
  const format = exportFormat.value.toLowerCase() as GlossaryImportFormat;
  const mime = format === 'json' ? 'application/json' : format === 'tsv' ? 'text/tab-separated-values' : 'text/csv';
  const url = URL.createObjectURL(new Blob([exportGlossary(selected.value, format)], {type: `${mime};charset=utf-8`}));
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = `${selected.value.name.replace(/[\\/:*?"<>|]/gu, '_')}.${format}`;
  anchor.click(); URL.revokeObjectURL(url);
}

const previewText = ref('');
const previewSource = ref('');
const previewTarget = ref(config.to.toLowerCase());
const previewUrl = ref('');
const previewContext = computed(() => ({text: previewText.value, sourceLanguage: previewSource.value, targetLanguage: previewTarget.value, pageUrl: previewUrl.value}));
const preview = computed(() => resolveGlossary(libraries.value, previewContext.value));
const previewLibraries = computed(() => libraries.value.map(library => ({library, reason: getGlossaryScopeReason(library, previewContext.value)})));

const importOpen = ref(false);
const importText = ref('');
const importFormat = ref<GlossaryImportFormat>('csv');
const acceptWarnings = ref(false);
const fileError = ref('');
const importPreview = computed(() => parseGlossaryImport(importText.value, importFormat.value));
const importErrors = computed(() => {
  const result = [...importPreview.value.errors];
  if (libraries.value.length + importPreview.value.libraries.length > GLOSSARY_LIMITS.libraries || libraries.value.reduce((total, library) => total + library.entries.length, 0) + importPreview.value.acceptedEntries > GLOSSARY_LIMITS.totalEntries) result.push(t('glossary.capacity'));
  return result;
});
const canImport = computed(() => Boolean(importText.value.trim()) && !fileError.value && !importErrors.value.length && importPreview.value.acceptedEntries > 0 && (!importPreview.value.warnings.length || acceptWarnings.value));
watch([importText, importFormat], () => {acceptWarnings.value = false;});
watch(importOpen, () => {fileReadGeneration++;});
function invalidateFileRead(): void {fileReadGeneration++; fileError.value = '';}
function openImport(): void {fileReadGeneration++; importText.value = ''; fileError.value = ''; acceptWarnings.value = false; importOpen.value = true;}
async function readImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
  const generation = ++fileReadGeneration;
  importText.value = ''; fileError.value = '';
  if (file.size > GLOSSARY_LIMITS.importBytes) {fileError.value = t('glossary.fileTooLarge'); input.value = ''; return;}
  importFormat.value = file.name.toLowerCase().endsWith('.json') ? 'json' : file.name.toLowerCase().endsWith('.tsv') ? 'tsv' : 'csv';
  try {
    // 字节读取才能识别 Excel 的 UTF-16/GB18030 文件；旧运行时没有 arrayBuffer 时保留 UTF-8 兜底。
    const text = typeof file.arrayBuffer === 'function' ? decodeGlossaryText(await file.arrayBuffer()) : await file.text();
    if (!disposed && importOpen.value && generation === fileReadGeneration) importText.value = text;
  }
  catch {if (!disposed && importOpen.value && generation === fileReadGeneration) fileError.value = t('glossary.fileFailed');}
  if (!disposed && generation === fileReadGeneration) input.value = '';
}
async function confirmImport(): Promise<void> {
  if (!canImport.value || busy.value) return;
  const next = [...libraries.value];
  let firstId = '';
  for (const imported of importPreview.value.libraries) {
    const library = {...imported, id: createGlossaryLibrary(next).id};
    firstId ||= library.id; next.push(library);
  }
  if (await persist({glossaryLibraries: next})) {selectLibrary(firstId); importOpen.value = false;}
}
</script>

<style scoped src="./glossary-settings.css"></style>

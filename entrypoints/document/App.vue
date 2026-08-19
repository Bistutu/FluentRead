<template>
  <div class="document-app" :class="{ dark: isDark }">
    <header class="document-header">
      <a class="document-brand" href="#" aria-label="流畅阅读文档翻译" @click.prevent="resetDocument">
        <img src="/icon/128.png" alt="" />
        <span>
          <strong>流畅阅读</strong>
          <small>FluentRead · 文档翻译 Beta</small>
        </span>
      </a>
      <span v-if="parsedDocument" class="document-status" :class="{ complete: hasTranslation }">
        <strong>{{ hasTranslation ? '已完成翻译' : '等待翻译' }}</strong>
        <span>{{ hasTranslation ? '✅' : 'Beta' }}</span>
      </span>
      <div class="header-actions">
        <span class="privacy-note"><i /> 文件只在当前浏览器中处理</span>
        <button class="ghost-button" type="button" @click="openSettings">翻译设置 ↗</button>
      </div>
    </header>

    <main class="document-main">
      <section v-if="!parsedDocument" class="landing-section">
        <div class="landing-copy">
          <span class="eyebrow">流畅阅读 · 文档翻译 Beta</span>
          <h1>把本地文件变成双语阅读体验</h1>
          <p>保留原有结构、时间轴和格式标记，在浏览器中完成翻译并下载结果。</p>
        </div>

        <div
          class="file-drop-zone"
          :class="{ dragging: isDragging }"
          role="button"
          tabindex="0"
          aria-label="打开文档文件"
          @click="openFilePicker"
          @keydown.enter.prevent="openFilePicker"
          @keydown.space.prevent="openFilePicker"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
        >
          <input ref="fileInput" class="visually-hidden" type="file" :accept="accept" @change="handleFileInput" />
          <div class="format-list" aria-label="支持的文件格式">
            <div v-for="item in formatCards" :key="item.code" class="format-card">
              <span class="format-icon" :class="item.tone"><b>{{ item.code }}</b><i /></span>
              <span>{{ item.label }}</span>
            </div>
          </div>

          <button class="open-file-button" type="button" @click.stop="openFilePicker">打开文件</button>
          <p>点击打开文件，或把本地文件拖到这里</p>
          <small>支持单个文件，最大 {{ maxFileSizeLabel }} · 文件不会上传到 FluentRead 服务器</small>
        </div>

        <p v-if="errorMessage" class="notice error" role="alert">{{ errorMessage }}</p>
      </section>

      <section v-else class="workspace-section">
        <div class="workspace-heading">
          <div class="file-heading">
            <span class="file-type-badge" :class="formatTone">{{ formatCode }}</span>
            <div>
              <h1>{{ parsedDocument.fileName }}</h1>
              <p>{{ parsedDocument.label }} · {{ parsedDocument.segments.length }} 个可翻译片段</p>
            </div>
          </div>
          <button class="ghost-button" type="button" :disabled="translating" @click="resetDocument">打开新文件</button>
        </div>

        <div class="control-panel">
          <label class="language-control">
            <span>源语言</span>
            <select v-model="config.from" aria-label="文档源语言">
              <option v-for="item in sourceLanguageOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <span class="language-arrow" aria-hidden="true">→</span>
          <label class="language-control">
            <span>目标语言</span>
            <select v-model="config.to" aria-label="文档目标语言">
              <option v-for="item in options.to" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <label class="service-control">
            <span>翻译服务</span>
            <select v-model="config.documentService" aria-label="文档翻译服务">
              <option v-for="item in serviceOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <label v-if="documentUsesModel" class="model-control">
            <span>模型</span>
            <select v-model="selectedDocumentModel" aria-label="文档翻译模型">
              <option v-for="model in documentModelOptions" :key="model" :value="model">{{ model }}</option>
            </select>
            <input
              v-if="selectedDocumentModel === customModelString"
              v-model="selectedDocumentCustomModel"
              type="text"
              placeholder="输入自定义模型名称"
              aria-label="文档自定义模型名称"
            />
          </label>
          <div v-else class="model-summary">
            <span>模型</span>
            <strong>当前服务无需模型</strong>
          </div>
          <div class="mode-control" role="group" aria-label="导出模式">
            <span>译文显示</span>
            <div class="mode-buttons">
              <button type="button" :class="{ selected: outputMode === 'bilingual' }" @click="outputMode = 'bilingual'">双语对照</button>
              <button type="button" :class="{ selected: outputMode === 'translated' }" @click="outputMode = 'translated'">仅译文</button>
            </div>
          </div>
          <button class="translate-document-button" type="button" :disabled="translating || !parsedDocument.segments.length" @click="startTranslation">
            <span v-if="translating" class="spinner" />
            <span>{{ translating ? `翻译中 ${progress}%` : hasTranslation ? '重新翻译' : '开始翻译' }}</span>
          </button>
          <button v-if="hasTranslation" class="download-button" type="button" @click="downloadDocument">下载{{ outputMode === 'bilingual' ? '双语' : '译文' }}文件</button>
        </div>

        <p v-if="credentialWarning" class="notice warning" role="alert">{{ credentialWarning }} <button type="button" @click="openSettings">去配置</button></p>
        <p v-if="errorMessage" class="notice error" role="alert">{{ errorMessage }}</p>

        <div v-if="translating || hasTranslation" class="progress-panel" :class="{ complete: hasTranslation && !translating }">
          <div class="progress-copy">
            <strong>{{ translating ? `正在翻译 ${parsedDocument.fileName}` : '翻译完成，可以编辑译文后下载' }}</strong>
            <span>{{ completedSegments }} / {{ parsedDocument.segments.length }} 个片段</span>
          </div>
          <div class="progress-track"><i :style="{ width: `${progress}%` }" /></div>
        </div>

        <div class="preview-heading">
          <div>
            <span class="eyebrow">逐段阅读</span>
            <h2>原文与译文</h2>
          </div>
          <span class="preview-hint">译文显示在原文下方，可直接编辑；字幕时间轴和文件结构会保留</span>
        </div>

        <div class="document-reader" :class="`reader-${parsedDocument.format}`" aria-label="文档双语阅读预览">
          <article v-for="row in previewRows" :key="row.index" class="reader-block">
            <div v-if="outputMode === 'bilingual'" class="reader-source" :class="readerSourceClass(row.source)">
              {{ readerText(row.source) }}
            </div>
            <textarea
              class="reader-translation"
              :value="row.translation"
              :placeholder="translating ? '等待翻译…' : '开始翻译后显示译文'"
              :aria-label="`第 ${row.index + 1} 段译文`"
              :disabled="!hasTranslation || translating"
              @input="updateTranslation(row.index, $event)"
            />
          </article>
        </div>
        <p v-if="!hasTranslation" class="reader-empty">点击“开始翻译”，译文会显示在每段原文下方。</p>
        <p v-if="hasMorePreviewRows" class="preview-more">当前展示前 {{ previewLimit }} 个片段，下载时会包含完整文件。</p>
      </section>
    </main>

    <footer class="document-footer">
      <span>流畅阅读文档翻译 Beta · HTML / TXT / Markdown / 字幕 / JSON</span>
      <a href="https://github.com/Bistutu/FluentRead" target="_blank" rel="noreferrer">开源项目 ↗</a>
    </footer>
  </div>
</template>

<script lang="ts" setup>
import {computed, onMounted, onUnmounted, reactive, ref, watch} from 'vue';
import browser from 'webextension-polyfill';
import {
  config as runtimeConfig,
  configReady,
  requestConfigSave,
  saveConfig,
} from '@/entrypoints/utils/config';
import {Config} from '@/entrypoints/utils/model';
import {getMissingCredentialMessage} from '@/entrypoints/utils/configValidation';
import {customModelString, models, options, resolveConfiguredModel, servicesType} from '@/entrypoints/utils/option';
import {
  DOCUMENT_MAX_BYTES,
  createDocumentDownloadName,
  getDocumentAcceptAttribute,
  getDocumentFormat,
  getDocumentMimeType,
  parseDocument,
  renderDocument,
  type DocumentRenderMode,
  type ParsedDocument,
} from '@/entrypoints/utils/documentTranslation';
import {translateDocumentSegments} from '@/entrypoints/utils/documentTranslationApi';

const PREVIEW_LIMIT = 80;
const config = reactive(new Config());
const fileInput = ref<HTMLInputElement | null>(null);
const parsedDocument = ref<ParsedDocument | null>(null);
const translatedSegments = ref<string[]>([]);
const outputMode = ref<DocumentRenderMode>('bilingual');
const isDragging = ref(false);
const translating = ref(false);
const progress = ref(0);
const errorMessage = ref('');
const hydrated = ref(false);
const isDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches);
let abortController: AbortController | null = null;
let lastSerialized = '';
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const accept = getDocumentAcceptAttribute();
const maxFileSizeLabel = `${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)} MB`;
const sourceLanguageOptions = [{value: 'auto', label: '自动检测'}, ...options.to];
const formatCards = [
  {code: 'HTML', label: 'html 文件', tone: 'coral'},
  {code: 'TXT', label: 'txt 文件', tone: 'slate'},
  {code: 'MD', label: 'markdown 文件', tone: 'sand'},
  {code: 'SRT', label: '字幕文件', tone: 'violet'},
  {code: 'ASS', label: '字幕文件', tone: 'violet'},
  {code: 'VTT', label: '字幕文件', tone: 'violet'},
  {code: 'LRC', label: '歌词文件', tone: 'violet'},
  {code: 'JSON', label: 'json 文件', tone: 'teal'},
];

const serviceOptions = computed(() => options.services.filter((item: any) => !item.disabled));
const documentUsesModel = computed(() => servicesType.isUseModel(config.documentService));
const documentModelOptions = computed(() => models.get(config.documentService) || []);
const selectedDocumentModel = computed({
  get: () => config.documentModel[config.documentService] || documentModelOptions.value[0] || '',
  set: (value: string) => { config.documentModel[config.documentService] = value; },
});
const selectedDocumentCustomModel = computed({
  get: () => config.documentCustomModel[config.documentService] || '',
  set: (value: string) => { config.documentCustomModel[config.documentService] = value; },
});
const documentModelValue = computed(() => resolveConfiguredModel(selectedDocumentModel.value, selectedDocumentCustomModel.value));
const credentialWarning = computed(() => {
  if (documentUsesModel.value && !documentModelValue.value.trim()) {
    return '文档翻译模型尚未配置，请先选择模型或填写自定义模型名称。';
  }

  const credentialConfig = {
    ...config,
    model: {...config.model, [config.documentService]: selectedDocumentModel.value},
    customModel: {...config.customModel, [config.documentService]: selectedDocumentCustomModel.value},
  };
  return getMissingCredentialMessage(config.documentService, credentialConfig);
});
const previewRows = computed(() => (parsedDocument.value?.segments || []).slice(0, PREVIEW_LIMIT).map((segment) => ({
  index: segment.id,
  source: segment.source,
  translation: translatedSegments.value[segment.id] || '',
})));
const previewLimit = PREVIEW_LIMIT;
const hasMorePreviewRows = computed(() => Boolean(parsedDocument.value && parsedDocument.value.segments.length > PREVIEW_LIMIT));
const hasTranslation = computed(() => translatedSegments.value.some((item) => item.trim().length > 0));
const completedSegments = computed(() => translatedSegments.value.filter((item) => item !== undefined && item !== '').length);
const formatCode = computed(() => parsedDocument.value?.format.toUpperCase() || 'FILE');
const formatTone = computed(() => {
  const format = parsedDocument.value?.format;
  return format === 'html' ? 'coral' : format === 'json' ? 'teal' : ['srt', 'vtt', 'ass', 'lrc'].includes(format || '') ? 'violet' : format === 'markdown' ? 'sand' : 'slate';
});

function readerText(value: string): string {
  const format = parsedDocument.value?.format;
  if (format === 'html') return value.replace(/<[^>]+>/gu, '').trim();
  if (format === 'markdown') {
    return value
      .replace(/^\s{0,3}#{1,6}\s+/u, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(/`{1,3}([^`]+)`{1,3}/gu, '$1')
      .replace(/(\*\*|__)(.*?)\1/gu, '$2')
      .trim();
  }
  if (['srt', 'vtt', 'ass'].includes(format || '')) {
    return value.replace(/<[^>]+>/gu, '').replace(/\{\\[^}]+\}/gu, '').trim();
  }
  return value.trim();
}

function readerSourceClass(value: string): string {
  return parsedDocument.value?.format === 'markdown' && /^\s{0,3}#{1,6}\s+/u.test(value)
    ? 'reader-heading'
    : '';
}

function applyTheme(): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  isDark.value = media.matches;
}

async function hydrateConfig(): Promise<void> {
  await configReady;
  Object.assign(config, runtimeConfig);
  lastSerialized = JSON.stringify(config);
  hydrated.value = true;
}
void hydrateConfig();

watch(config, (value) => {
  if (!hydrated.value) return;
  const serialized = JSON.stringify(value);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  void requestConfigSave(value, browser.runtime.sendMessage.bind(browser.runtime)).catch((error) => {
    console.warn('[FluentRead] 保存文档翻译设置失败', error);
  });
}, {deep: true, flush: 'sync'});

function openFilePicker(): void {
  fileInput.value?.click();
}

function showError(message: string): void {
  errorMessage.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { errorMessage.value = ''; }, 6000);
}

async function loadFile(file: File): Promise<void> {
  errorMessage.value = '';
  if (!getDocumentFormat(file.name)) {
    showError('暂不支持该文件格式，请选择 HTML、TXT、Markdown、字幕或 JSON 文件。');
    return;
  }
  if (file.size > DOCUMENT_MAX_BYTES) {
    showError(`文件大小超过 ${maxFileSizeLabel}，请先拆分文件后再翻译。`);
    return;
  }

  try {
    const content = await file.text();
    const parsed = parseDocument(file.name, content);
    if (parsed.segments.length === 0) throw new Error('文件中没有找到可翻译的文本片段。');
    parsedDocument.value = parsed;
    translatedSegments.value = [];
    outputMode.value = 'bilingual';
    progress.value = 0;
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function handleFileInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void loadFile(file);
  input.value = '';
}

function handleDrop(event: DragEvent): void {
  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) void loadFile(file);
}

function resetDocument(): void {
  abortController?.abort();
  abortController = null;
  translating.value = false;
  parsedDocument.value = null;
  translatedSegments.value = [];
  progress.value = 0;
  errorMessage.value = '';
}

async function startTranslation(): Promise<void> {
  const document = parsedDocument.value;
  if (!document || translating.value) return;
  if (credentialWarning.value) {
    showError(credentialWarning.value);
    return;
  }

  translating.value = true;
  progress.value = 0;
  errorMessage.value = '';
  const controller = new AbortController();
  abortController = controller;
  try {
    const result = await translateDocumentSegments(document.segments, {
      fileName: document.fileName,
      serviceOverride: config.documentService,
      modelOverride: documentUsesModel.value ? documentModelValue.value : undefined,
      signal: controller.signal,
      onProgress: ({completed, total}) => {
        progress.value = total > 0 ? Math.round((completed / total) * 100) : 100;
        translatedSegments.value = translatedSegments.value.length === total
          ? translatedSegments.value
          : new Array<string>(total).fill('');
      },
    });
    translatedSegments.value = result;
    progress.value = 100;
  } catch (error) {
    if (controller.signal.aborted) {
      showError('文档翻译已取消。');
    } else {
      showError(error instanceof Error ? error.message : String(error));
    }
  } finally {
    translating.value = false;
    abortController = null;
  }
}

function updateTranslation(index: number, event: Event): void {
  translatedSegments.value[index] = (event.target as HTMLTextAreaElement).value;
}

function downloadDocument(): void {
  const document = parsedDocument.value;
  if (!document || !hasTranslation.value) return;
  const content = renderDocument(document, translatedSegments.value, outputMode.value);
  const blob = new Blob([content], {type: getDocumentMimeType(document.format)});
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = createDocumentDownloadName(document.fileName, outputMode.value);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function openSettings(): Promise<void> {
  await browser.tabs.create({url: `${browser.runtime.getURL('options.html')}#settings-services`});
}

onMounted(() => {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener?.('change', applyTheme);
  window.addEventListener('pagehide', resetDocument);
});

onUnmounted(() => {
  abortController?.abort();
  void saveConfig(config).catch(() => undefined);
  if (noticeTimer) clearTimeout(noticeTimer);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.removeEventListener?.('change', applyTheme);
  window.removeEventListener('pagehide', resetDocument);
});
</script>

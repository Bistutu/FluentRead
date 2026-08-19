<template>
  <section class="translation-center" aria-labelledby="translation-center-title">
    <header class="translation-center-hero">
      <div>
        <span class="translation-center-kicker">翻译工具 · 多服务对比</span>
        <h2 id="translation-center-title">翻译中心</h2>
        <p>输入一句话，同时查看多个翻译服务的结果。可以反复提交同一句话，方便比较措辞和风格。</p>
      </div>
      <div class="translation-center-run-status" :class="{ active: isRunning }" aria-live="polite">
        <i />
        <span>{{ isRunning ? '正在翻译' : runCount ? `已翻译 ${runCount} 次` : '等待输入' }}</span>
      </div>
    </header>

    <div class="translation-center-toolbar">
      <div class="language-picker-group">
        <label for="translation-center-source">源语言</label>
        <select id="translation-center-source" v-model="sourceLanguage" aria-label="翻译中心源语言">
          <option v-for="item in sourceLanguageOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>

      <button
        class="language-swap-button"
        type="button"
        aria-label="交换源语言和目标语言"
        title="交换源语言和目标语言"
        :disabled="sourceLanguage === 'auto'"
        @click="swapLanguages"
      >
        ⇄
      </button>

      <div class="language-picker-group">
        <label for="translation-center-target">目标语言</label>
        <select id="translation-center-target" v-model="targetLanguage" aria-label="翻译中心目标语言">
          <option v-for="item in targetLanguageOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>

      <div ref="servicePicker" class="translation-center-service-picker">
        <button
          class="add-service-button"
          type="button"
          :aria-expanded="servicePickerOpen"
          aria-haspopup="listbox"
          @click.stop="servicePickerOpen = !servicePickerOpen"
        >
          <span>＋</span>
          添加翻译服务
          <b>{{ cards.length }}</b>
          <span class="add-service-chevron">⌄</span>
        </button>
        <div v-if="servicePickerOpen" class="service-picker-menu" role="listbox" aria-label="添加翻译服务">
          <button
            v-for="item in availableServiceOptions"
            :key="item.value"
            type="button"
            role="option"
            @click="addService(item.value)"
          >
            <ServiceIcon :service="item.value" :label="item.label" size="small" />
            <span>{{ item.label }}</span>
            <b>添加</b>
          </button>
          <p v-if="availableServiceOptions.length === 0">所有服务都已加入对比</p>
        </div>
      </div>
    </div>

    <div class="translation-center-layout">
      <section class="translation-input-panel" aria-labelledby="translation-input-title">
        <div class="translation-panel-heading">
          <div>
            <span class="translation-panel-kicker">输入</span>
            <h3 id="translation-input-title">待翻译文本</h3>
          </div>
          <span class="language-pair-label">{{ languageLabel(sourceLanguage) }} → {{ languageLabel(targetLanguage) }}</span>
        </div>

        <textarea
          v-model="sourceText"
          maxlength="5000"
          placeholder="输入要翻译的句子…"
          aria-label="待翻译文本"
          @keydown.ctrl.enter.prevent="runTranslation"
          @keydown.meta.enter.prevent="runTranslation"
        />

        <div class="translation-input-footer">
          <span>{{ sourceText.length }}/5000</span>
          <button
            class="translate-primary-button"
            type="button"
            :disabled="!sourceText.trim() || !cards.length || isRunning"
            @click="runTranslation"
          >
            <span>{{ isRunning ? '翻译中…' : runCount ? '再次翻译' : '开始翻译' }}</span>
            <small>⌘↵</small>
          </button>
        </div>
      </section>

      <section class="translation-results-panel" aria-labelledby="translation-results-title">
        <div class="translation-panel-heading results-heading">
          <div>
            <span class="translation-panel-kicker">对比结果</span>
            <h3 id="translation-results-title">{{ cards.length }} 个翻译服务</h3>
          </div>
          <button
            class="copy-all-button"
            type="button"
            :disabled="successfulCards.length === 0"
            @click="copyAllResults"
          >
            {{ copiedService === 'all' ? '已复制' : '复制全部' }}
          </button>
        </div>

        <div class="translation-result-list">
          <article
            v-for="card in cards"
            :key="card.service"
            class="translation-result-card"
            :data-service="card.service"
            :data-status="card.status"
          >
            <header class="translation-result-card-header">
              <div class="translation-result-service-name">
                <ServiceIcon :service="card.service" :label="serviceLabel(card.service)" size="medium" />
                <div>
                  <strong>{{ serviceLabel(card.service) }}</strong>
                  <small>{{ serviceDescription(card.service) }}</small>
                </div>
              </div>
              <div class="translation-result-card-actions">
                <span v-if="card.status === 'success'" class="result-state success">完成</span>
                <span v-else-if="card.status === 'loading'" class="result-state loading">翻译中</span>
                <span v-else-if="card.status === 'error'" class="result-state error">失败</span>
                <button
                  class="remove-service-button"
                  type="button"
                  :aria-label="`移除${serviceLabel(card.service)}`"
                  :disabled="cards.length <= 1"
                  @click="removeService(card.service)"
                >
                  ×
                </button>
              </div>
            </header>

            <div v-if="card.status === 'idle'" class="translation-result-placeholder">
              点击“开始翻译”，在这里查看结果
            </div>
            <div v-else-if="card.status === 'loading'" class="translation-result-placeholder loading-placeholder">
              <span class="loading-bars"><i /><i /><i /></span>
              正在请求 {{ serviceLabel(card.service) }}…
            </div>
            <div v-else-if="card.status === 'success'" class="translation-result-content">
              <p>{{ card.result }}</p>
              <footer>
                <span>{{ card.duration }} ms · 第 {{ card.run }} 次</span>
                <button type="button" @click="copyResult(card)">
                  {{ copiedService === card.service ? '已复制' : '复制译文' }}
                </button>
              </footer>
            </div>
            <div v-else class="translation-result-error">
              <p>{{ card.error }}</p>
              <button type="button" :disabled="!sourceText.trim() || isRunning" @click="retryService(card.service)">重试</button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <footer class="translation-center-note">
      <span>提示</span>
      <p>翻译中心不会改变网页翻译的默认服务。每次点击“再次翻译”都会重新请求服务，不复用上一轮结果。</p>
      <button type="button" @click="openServiceSettings">前往服务设置</button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import browser from 'webextension-polyfill'
import ServiceIcon from './ServiceIcon.vue'
import { options } from '@/entrypoints/utils/option'
import { config, configReady } from '@/entrypoints/utils/config'
import { translateText } from '@/entrypoints/utils/translateApi'

type TranslationCardStatus = 'idle' | 'loading' | 'success' | 'error'

type TranslationCard = {
  service: string
  status: TranslationCardStatus
  result: string
  error: string
  duration: number
  run: number
}

const DEFAULT_COMPARISON_SERVICES = ['freeTranslation', 'google', 'openai', 'deepseek', 'gemini', 'deeplx']
const MAX_TEXT_LENGTH = 5000

const sourceText = ref('')
const sourceLanguage = ref('auto')
const targetLanguage = ref('zh-Hans')
const runCount = ref(0)
const isRunning = ref(false)
const servicePickerOpen = ref(false)
const copiedService = ref('')
const servicePicker = ref<HTMLElement | null>(null)
const cards = ref<TranslationCard[]>([])
let activeController: AbortController | null = null
let activeRunId = 0
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const serviceOptions = computed(() => options.services.filter((item: any) => !item.disabled))
const selectedServiceValues = computed(() => new Set(cards.value.map(card => card.service)))
const availableServiceOptions = computed(() => serviceOptions.value.filter((item: any) => !selectedServiceValues.value.has(item.value)))
const successfulCards = computed(() => cards.value.filter(card => card.status === 'success' && card.result))
const sourceLanguageOptions = computed(() => [
  { value: 'auto', label: '自动检测' },
  ...options.to,
])
const targetLanguageOptions = computed(() => options.to)

function createCard(service: string): TranslationCard {
  return { service, status: 'idle', result: '', error: '', duration: 0, run: 0 }
}

function serviceLabel(service: string): string {
  return serviceOptions.value.find((item: any) => item.value === service)?.label || service
}

function serviceDescription(service: string): string {
  const option = serviceOptions.value.find((item: any) => item.value === service) as any
  if (option?.description) return option.description.split('；')[0]
  return service === 'freeTranslation' ? '无需密钥，自动尝试多个免费接口' : '使用设置中已保存的连接配置'
}

function languageLabel(value: string): string {
  if (value === 'auto') return '自动检测'
  return targetLanguageOptions.value.find(item => item.value === value)?.label || value
}

function addService(service: string): void {
  if (selectedServiceValues.value.has(service)) return
  cards.value.push(createCard(service))
  servicePickerOpen.value = false
}

function removeService(service: string): void {
  if (cards.value.length <= 1) return
  cards.value = cards.value.filter(card => card.service !== service)
}

function swapLanguages(): void {
  if (sourceLanguage.value === 'auto') return
  const nextSource = sourceLanguage.value
  sourceLanguage.value = targetLanguage.value
  targetLanguage.value = nextSource
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return '本轮请求已取消'
  const message = error instanceof Error ? error.message : String(error)
  return message || '翻译服务未返回结果，请稍后重试。'
}

function resetCopiedState(value: string): void {
  copiedService.value = value
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copiedService.value = ''
  }, 1600)
}

async function copyText(text: string, copiedKey: string): Promise<void> {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    resetCopiedState(copiedKey)
  } catch (error) {
    console.warn('[FluentRead] 翻译中心复制失败', error)
  }
}

function copyResult(card: TranslationCard): void {
  void copyText(card.result, card.service)
}

function copyAllResults(): void {
  const text = successfulCards.value
    .map(card => `${serviceLabel(card.service)}\n${card.result}`)
    .join('\n\n')
  void copyText(text, 'all')
}

async function translateCard(card: TranslationCard, text: string, runId: number, controller: AbortController, run: number): Promise<void> {
  const startedAt = performance.now()
  card.status = 'loading'
  card.error = ''
  card.result = ''
  card.run = run

  try {
    const result = await translateText(text, 'FluentRead 翻译中心', {
      maxRetries: 0,
      timeout: 30_000,
      useCache: false,
      serviceOverride: card.service,
      sourceLanguage: sourceLanguage.value,
      targetLanguage: targetLanguage.value,
      signal: controller.signal,
    })
    if (runId !== activeRunId) return
    card.status = 'success'
    card.result = result.trim() || '服务返回了空译文。'
    card.duration = Math.max(1, Math.round(performance.now() - startedAt))
  } catch (error) {
    if (runId !== activeRunId) return
    if (controller.signal.aborted) return
    card.status = 'error'
    card.error = formatError(error)
    card.duration = Math.max(1, Math.round(performance.now() - startedAt))
  }
}

async function runTranslation(): Promise<void> {
  const text = sourceText.value.trim()
  if (!text || !cards.value.length || isRunning.value) return
  if (text.length > MAX_TEXT_LENGTH) return

  activeController?.abort()
  const controller = new AbortController()
  activeController = controller
  const runId = ++activeRunId
  const run = ++runCount.value
  isRunning.value = true

  await Promise.all(cards.value.map(card => translateCard(card, text, runId, controller, run)))
  if (runId === activeRunId) {
    isRunning.value = false
    activeController = null
  }
}

async function retryService(service: string): Promise<void> {
  const text = sourceText.value.trim()
  const card = cards.value.find(item => item.service === service)
  if (!text || !card || isRunning.value) return

  activeController?.abort()
  const controller = new AbortController()
  activeController = controller
  const runId = ++activeRunId
  const run = ++runCount.value
  isRunning.value = true
  await translateCard(card, text, runId, controller, run)
  if (runId === activeRunId) {
    isRunning.value = false
    activeController = null
  }
}

function openServiceSettings(): void {
  void browser.tabs.create({ url: `${browser.runtime.getURL('options.html')}#settings-services` })
}

function closeServicePicker(event: Event): void {
  if (servicePicker.value?.contains(event.target as Node)) return
  servicePickerOpen.value = false
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') servicePickerOpen.value = false
}

onMounted(async () => {
  await configReady
  sourceLanguage.value = config.from || 'auto'
  targetLanguage.value = config.to || 'zh-Hans'
  const configuredServices = DEFAULT_COMPARISON_SERVICES.filter(service => serviceOptions.value.some(item => item.value === service))
  cards.value = (configuredServices.length ? configuredServices : [serviceOptions.value[0]?.value].filter(Boolean) as string[]).map(createCard)
  document.addEventListener('pointerdown', closeServicePicker)
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  activeController?.abort()
  document.removeEventListener('pointerdown', closeServicePicker)
  document.removeEventListener('keydown', handleKeydown)
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<style scoped>
.translation-center {
  display: grid;
  gap: 18px;
  min-height: 100%;
  padding: 30px 36px 24px;
  color: var(--ink);
  background: #f8f9fc;
}

.translation-center-hero,
.translation-center-toolbar,
.translation-input-panel,
.translation-results-panel,
.translation-center-note {
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: 0 10px 30px rgba(31, 40, 61, .045);
}

.translation-center-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 26px 28px;
  border-color: #f3ced9;
  border-radius: 22px;
  background: linear-gradient(135deg, #fff8fa 0%, #fff 55%, #f7f8ff 100%);
}

.translation-center-kicker,
.translation-panel-kicker {
  display: block;
  color: var(--brand-strong);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.translation-center-kicker { margin-bottom: 8px; }
.translation-center-hero h2 { margin: 0 0 8px; font-size: 26px; letter-spacing: -.04em; }
.translation-center-hero p { max-width: 680px; margin: 0; color: var(--muted); font-size: 13px; line-height: 1.7; }

.translation-center-run-status {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 8px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  background: var(--surface-soft);
  font-size: 11px;
  font-weight: 700;
}

.translation-center-run-status i { width: 7px; height: 7px; border-radius: 50%; background: #b8becb; }
.translation-center-run-status.active { color: var(--brand-strong); border-color: #f2bfd0; background: var(--brand-soft); }
.translation-center-run-status.active i { background: var(--brand); box-shadow: 0 0 0 4px rgba(239, 71, 118, .12); }

.translation-center-toolbar {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 16px;
}

.language-picker-group { display: grid; gap: 6px; min-width: 154px; }
.language-picker-group label { color: var(--muted); font-size: 10px; font-weight: 750; }
.language-picker-group select {
  min-width: 154px;
  height: 40px;
  padding: 0 30px 0 12px;
  border: 1px solid #e1e5ee;
  border-radius: 11px;
  color: var(--ink);
  background: var(--surface-soft);
  font-size: 13px;
  outline: none;
}
.language-picker-group select:focus { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(239, 71, 118, .1); }

.language-swap-button {
  width: 38px;
  height: 40px;
  border: 1px solid transparent;
  border-radius: 11px;
  color: var(--brand-strong);
  background: var(--brand-soft);
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
}
.language-swap-button:hover:not(:disabled) { border-color: #f1b2c5; transform: translateY(-1px); }
.language-swap-button:disabled { cursor: not-allowed; opacity: .45; }

.translation-center-service-picker { position: relative; margin-left: auto; }
.add-service-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #e1e5ee;
  border-radius: 11px;
  color: var(--ink);
  background: var(--surface);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}
.add-service-button:hover { border-color: #ef9ab1; color: var(--brand-strong); background: var(--brand-soft); }
.add-service-button > span:first-child { color: var(--brand); font-size: 18px; font-weight: 400; }
.add-service-button b { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; color: #fff; background: var(--ink); font-size: 10px; }
.add-service-chevron { color: var(--muted); font-size: 16px; }
.service-picker-menu {
  position: absolute;
  z-index: 8;
  top: calc(100% + 8px);
  right: 0;
  display: grid;
  width: 260px;
  max-height: 330px;
  padding: 7px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: 0 16px 36px rgba(31, 40, 61, .15);
}
.service-picker-menu button { display: flex; align-items: center; gap: 9px; padding: 9px; border: 0; border-radius: 9px; color: var(--ink); background: transparent; cursor: pointer; text-align: left; }
.service-picker-menu button:hover { background: var(--surface-soft); }
.service-picker-menu button span { flex: 1; font-size: 12px; font-weight: 650; }
.service-picker-menu button b { color: var(--brand-strong); font-size: 10px; }
.service-picker-menu p { margin: 12px 8px; color: var(--muted); font-size: 11px; text-align: center; }

.translation-center-layout { display: grid; grid-template-columns: minmax(300px, .88fr) minmax(420px, 1.12fr); gap: 18px; min-height: 0; }
.translation-input-panel,
.translation-results-panel { min-width: 0; border-radius: 18px; }
.translation-input-panel { display: flex; min-height: 390px; flex-direction: column; padding: 20px; }
.translation-results-panel { display: flex; min-height: 390px; flex-direction: column; padding: 20px; }
.translation-panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.translation-panel-kicker { margin-bottom: 5px; }
.translation-panel-heading h3 { margin: 0; color: var(--ink); font-size: 17px; letter-spacing: -.02em; }
.language-pair-label { padding: 5px 8px; border-radius: 999px; color: var(--muted); background: var(--surface-soft); font-size: 10px; white-space: nowrap; }

.translation-input-panel textarea {
  display: block;
  width: 100%;
  min-height: 270px;
  flex: 1 1 auto;
  padding: 4px 2px;
  resize: vertical;
  border: 0;
  color: var(--ink);
  background: transparent;
  font: inherit;
  font-size: 20px;
  line-height: 1.65;
  outline: none;
}
.translation-input-panel textarea::placeholder { color: #a2a8b5; }
.translation-input-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; }
.translate-primary-button { display: inline-flex; align-items: center; gap: 11px; min-height: 40px; padding: 0 14px; border: 0; border-radius: 11px; color: #fff; background: var(--brand); cursor: pointer; font-size: 12px; font-weight: 800; box-shadow: 0 8px 16px rgba(239, 71, 118, .2); }
.translate-primary-button:hover:not(:disabled) { background: var(--brand-strong); transform: translateY(-1px); }
.translate-primary-button:disabled { cursor: not-allowed; opacity: .48; box-shadow: none; }
.translate-primary-button small { padding-left: 10px; border-left: 1px solid rgba(255,255,255,.35); font-size: 10px; font-weight: 600; }

.results-heading { margin-bottom: 10px; }
.copy-all-button { min-height: 30px; padding: 0 10px; border: 1px solid var(--line); border-radius: 9px; color: var(--brand-strong); background: var(--surface); cursor: pointer; font-size: 10px; font-weight: 700; }
.copy-all-button:hover:not(:disabled) { border-color: #ef9ab1; background: var(--brand-soft); }
.copy-all-button:disabled { cursor: not-allowed; color: #b4bac5; }
.translation-result-list { display: grid; gap: 10px; min-height: 0; overflow-y: auto; padding: 2px 3px 3px 0; }
.translation-result-card { padding: 13px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
.translation-result-card[data-status='success'] { border-color: #ecd8df; }
.translation-result-card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.translation-result-service-name { display: flex; align-items: center; min-width: 0; gap: 10px; }
.translation-result-service-name > div { display: grid; min-width: 0; gap: 3px; }
.translation-result-service-name strong { overflow: hidden; color: var(--ink); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.translation-result-service-name small { overflow: hidden; max-width: 300px; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.translation-result-card-actions { display: flex; align-items: center; flex: none; gap: 7px; }
.result-state { padding: 4px 7px; border-radius: 999px; font-size: 9px; font-weight: 800; }
.result-state.success { color: #16825f; background: #e9f8f1; }
.result-state.loading { color: #91611c; background: #fff5df; }
.result-state.error { color: #b1435e; background: #fff0f3; }
.remove-service-button { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 7px; color: #8b93a1; background: transparent; cursor: pointer; font-size: 20px; line-height: 1; }
.remove-service-button:hover:not(:disabled) { color: #b1435e; background: #fff0f3; }
.remove-service-button:disabled { cursor: not-allowed; opacity: .35; }
.translation-result-placeholder { display: flex; align-items: center; min-height: 54px; margin-top: 11px; padding: 10px 12px; border-radius: 10px; color: #9aa2b0; background: var(--surface-soft); font-size: 11px; }
.loading-placeholder { gap: 9px; color: #9a6d2a; }
.loading-bars { display: inline-flex; align-items: center; gap: 3px; }
.loading-bars i { width: 4px; height: 14px; border-radius: 999px; background: #e8aa55; animation: translation-center-pulse .8s ease-in-out infinite alternate; }
.loading-bars i:nth-child(2) { animation-delay: .18s; }
.loading-bars i:nth-child(3) { animation-delay: .36s; }
@keyframes translation-center-pulse { from { opacity: .35; transform: scaleY(.6); } to { opacity: 1; transform: scaleY(1); } }
.translation-result-content { margin-top: 11px; padding: 12px; border-radius: 10px; color: var(--ink); background: #fff7f9; }
.translation-result-content p { min-height: 24px; margin: 0; font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.translation-result-content footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; color: var(--muted); font-size: 9px; }
.translation-result-content footer button { padding: 0; border: 0; color: var(--brand-strong); background: transparent; cursor: pointer; font-size: 10px; font-weight: 700; }
.translation-result-error { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-top: 11px; padding: 10px 12px; border-radius: 10px; color: #9f3d57; background: #fff3f5; }
.translation-result-error p { flex: 1; margin: 0; font-size: 11px; line-height: 1.6; word-break: break-word; }
.translation-result-error button { flex: none; padding: 4px 7px; border: 1px solid #efb1c1; border-radius: 7px; color: #a43755; background: transparent; cursor: pointer; font-size: 10px; font-weight: 700; }
.translation-result-error button:disabled { cursor: not-allowed; opacity: .45; }

.translation-center-note { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 13px; color: var(--muted); background: var(--surface-soft); font-size: 10px; }
.translation-center-note > span { padding: 4px 7px; border-radius: 6px; color: var(--brand-strong); background: var(--brand-soft); font-weight: 800; }
.translation-center-note p { flex: 1; margin: 0; line-height: 1.5; }
.translation-center-note button { padding: 0; border: 0; color: var(--brand-strong); background: transparent; cursor: pointer; font-size: 10px; font-weight: 750; white-space: nowrap; }

@media (max-width: 1050px) {
  .translation-center { padding: 24px 28px 20px; }
  .translation-center-layout { grid-template-columns: minmax(270px, .8fr) minmax(360px, 1.2fr); }
  .translation-result-service-name small { max-width: 200px; }
}

@media (max-width: 760px) {
  .translation-center { padding: 16px 10px 14px; }
  .translation-center-hero { padding: 20px; flex-direction: column; }
  .translation-center-hero h2 { font-size: 23px; }
  .translation-center-toolbar { align-items: stretch; flex-wrap: wrap; }
  .language-picker-group { flex: 1 1 140px; }
  .language-picker-group select { min-width: 0; width: 100%; }
  .language-swap-button { align-self: flex-end; }
  .translation-center-service-picker { width: 100%; margin-left: 0; }
  .add-service-button { width: 100%; justify-content: center; }
  .service-picker-menu { left: 0; right: 0; width: auto; }
  .translation-center-layout { grid-template-columns: 1fr; }
  .translation-input-panel { min-height: 330px; }
  .translation-results-panel { min-height: 360px; }
  .translation-result-service-name small { max-width: 160px; }
  .translation-center-note { align-items: flex-start; flex-wrap: wrap; }
  .translation-center-note p { flex-basis: calc(100% - 42px); }
  .translation-center-note button { margin-left: 42px; }
}

@media (max-width: 480px) {
  .translation-input-panel,
  .translation-results-panel { padding: 15px; }
  .translation-input-panel textarea { min-height: 220px; font-size: 17px; }
  .translation-result-service-name small { display: none; }
  .translation-result-card-actions .result-state { display: none; }
}
</style>

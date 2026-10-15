<!--
 * @file src/features/settings/ui/services/ServiceRepairReturn.vue
 * 文件职责：为从 popup 来到服务设置的用户提供明确、可取消的返回原网页操作。
 * 主要内容：只从扩展页面解析安全的来源标签页 ID；用户点击时重新验证来源标签页与网页协议，成功或不可用时给出紧凑本地提示，并阻止隐藏、服务切换、缓存停用及卸载后的迟到查询切换标签页。
 * 模块边界：不收集或保存网页正文、URL、凭据或诊断报告，不自动翻译、不创建新页面、不关闭设置页；仅由明确点击触发 tabs.get 和 tabs.update。
 -->
<template>
  <div v-if="sourceTabId !== undefined" class="service-repair-return" data-service-repair-return>
    <p role="status" aria-live="polite">{{ message }}</p>
    <button type="button" data-return-source-tab :disabled="!active || busy" @click="returnToSource">{{ getDiagnosticUiText(busy ? 'source-looking' : 'source-return', language) }}</button>
  </div>
</template>
<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import browser from 'webextension-polyfill'
import {useUiI18n} from '@/src/ui/i18n'
import {getDiagnosticUiText} from '@/src/services/diagnostics'
import {useSettingsActionContext} from '../../model/useSettingsActionContext'
const props = withDefaults(defineProps<{active?: boolean; context?: unknown; contextKey?: string}>(), {active: true})
const {language} = useUiI18n()
const sourceTabId = readSourceTabId()
const busy = ref(false)
const status = ref<'idle' | 'unavailable' | 'returned'>('idle')
const {active, capture} = useSettingsActionContext(() => props.active, () => [props.context, props.contextKey])
const message = computed(() => status.value === 'unavailable'
  ? getDiagnosticUiText('source-unavailable', language.value)
  : status.value === 'returned'
    ? getDiagnosticUiText('source-returned', language.value)
    : getDiagnosticUiText('source-return-hint', language.value))
function readSourceTabId(): number | undefined {
  try {
    const source = new URL(location.href)
    if (!['chrome-extension:', 'moz-extension:', 'safari-web-extension:'].includes(source.protocol)) return undefined
    const values = source.searchParams.getAll('returnTabId')
    if (values.length !== 1 || !/^\d{1,16}$/u.test(values[0])) return undefined
    const id = Number(values[0])
    return Number.isSafeInteger(id) && id >= 0 ? id : undefined
  } catch {return undefined}
}
async function returnToSource(): Promise<void> {
  if (!active.value || busy.value || sourceTabId === undefined) return
  const current = capture()
  busy.value = true
  status.value = 'idle'
  try {
    const tab = await browser.tabs.get(sourceTabId)
    if (!current()) return
    let accessible = false
    try {accessible = ['http:', 'https:', 'file:'].includes(new URL(tab.url || '').protocol)} catch { /* 无 URL 的标签页不能作为可翻译来源。 */ }
    if (!accessible || tab.id !== sourceTabId) {status.value = 'unavailable';return}
    await browser.tabs.update(sourceTabId, {active: true})
    if (current()) status.value = 'returned'
  } catch {
    if (current()) status.value = 'unavailable'
  } finally {
    if (current()) busy.value = false
  }
}
watch(() => [active.value, props.context, props.contextKey], () => {busy.value = false;status.value = 'idle'}, {flush: 'sync'})
</script>
<style scoped>
.service-repair-return { display: flex; align-items: center; justify-content: space-between; gap: 10px 16px; margin-top: 14px; padding: 10px 0; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; line-height: 1.6; }
.service-repair-return p { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.service-repair-return button { flex: none; min-height: 32px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 7px; color: var(--brand-strong); background: var(--surface); font: inherit; cursor: pointer; }
.service-repair-return button:hover:not(:disabled) { border-color: var(--brand); }
.service-repair-return button:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
.service-repair-return button:disabled { opacity: .6; cursor: default; }
@container (max-width: 420px) { .service-repair-return { align-items: flex-start; flex-direction: column; gap: 7px; } }
</style>

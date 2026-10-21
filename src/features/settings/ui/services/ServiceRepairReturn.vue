<!--
 * @file src/features/settings/ui/services/ServiceRepairReturn.vue
 * 文件职责：为从 popup 来到划词、服务或网站适配设置的用户提供明确、可取消的返回原网页操作，并为窄屏或支持触摸的设备保留足够的按钮触摸区域。
 * 主要内容：共享紧凑返回条，普通划词设置仅展示返回按钮，服务修复调用默认保留说明与结果提示；复用扩展页面安全来源解析，在首次挂载且服务匹配时通知父组件提供一次修复焦点；用户点击时重新验证来源标签页与网页协议，成功或不可用时给出紧凑本地提示，并通过组件自有页面可见性监听阻止隐藏、pagehide、所属配置切换、缓存停用及卸载后的迟到查询切换标签页，pageshow 恢复可用但不复活旧操作；名称保留以兼容服务页调用方。
 * 模块边界：不收集或保存网页正文、URL、凭据或诊断报告，不自动翻译、不创建新页面、不关闭设置页；仅由明确点击触发 tabs.get 和 tabs.update。
 -->
<template>
  <div v-if="sourceTabId !== undefined" class="service-repair-return" :class="{'service-repair-return-compact': !showRepairHint}" data-service-repair-return>
    <p v-if="message" role="status" aria-live="polite">{{ message }}</p>
    <button type="button" data-return-source-tab :disabled="!active || busy" @click="returnToSource">{{ text(busy ? 'source-looking' : 'source-return') }}</button>
  </div>
</template>
<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import browser from 'webextension-polyfill'
import {useUiI18n} from '@/src/ui/i18n'
import {getDiagnosticUiText, type DiagnosticUiTextKey} from '@/src/services/diagnostics'
import {useSettingsActionContext} from '../../model/useSettingsActionContext'
import {readServiceRepairSource} from './serviceRepairFocus'
const props = withDefaults(defineProps<{active?: boolean; context?: unknown; contextKey?: string; showRepairHint?: boolean}>(), {active: true, showRepairHint: true})
const {language, bundleRevision} = useUiI18n()
function text(key: DiagnosticUiTextKey): string {
  void bundleRevision.value
  return getDiagnosticUiText(key, language.value)
}
const emit = defineEmits<{'repair-ready': [service: string]}>()
const source = readServiceRepairSource(typeof location === 'undefined' ? '' : location.href)
const sourceTabId = source?.tabId
const busy = ref(false)
const status = ref<'idle' | 'unavailable' | 'returned'>('idle')
const ownerDocument = typeof document === 'undefined' ? undefined : document
const ownerWindow = typeof window === 'undefined' ? undefined : window
const pageVisible = ref(ownerDocument?.visibilityState !== 'hidden')
const {active, capture} = useSettingsActionContext(() => props.active && pageVisible.value, () => [props.context, props.contextKey])
function syncPageVisibility(): void {pageVisible.value = ownerDocument?.visibilityState !== 'hidden'}
function hidePage(): void {pageVisible.value = false}
onBeforeUnmount(() => {
  ownerDocument?.removeEventListener('visibilitychange', syncPageVisibility)
  ownerWindow?.removeEventListener('pagehide', hidePage)
  ownerWindow?.removeEventListener('pageshow', syncPageVisibility)
})
const message = computed(() => {
  if (status.value === 'unavailable') return text('source-unavailable')
  if (!props.showRepairHint) return ''
  return text(status.value === 'returned' ? 'source-returned' : 'source-return-hint')
})
onMounted(() => {
  ownerDocument?.addEventListener('visibilitychange', syncPageVisibility)
  ownerWindow?.addEventListener('pagehide', hidePage)
  ownerWindow?.addEventListener('pageshow', syncPageVisibility)
  syncPageVisibility()
  if (active.value && source?.service && source.service === props.contextKey) emit('repair-ready', source.service)
})
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
.service-repair-return-compact { justify-content: flex-start; margin: 0 0 14px; padding: 0; border-top: 0; }
.service-repair-return p { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.service-repair-return button { flex: none; min-height: 32px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 7px; color: var(--brand-strong); background: var(--surface); font: inherit; cursor: pointer; }
.service-repair-return button:hover:not(:disabled) { border-color: var(--brand); }
.service-repair-return button:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
.service-repair-return button:disabled { opacity: .6; cursor: default; }
@media (max-width: 640px), (any-pointer: coarse) { .service-repair-return button { min-height: 44px; } }
@container (max-width: 420px) { .service-repair-return { align-items: flex-start; flex-direction: column; gap: 7px; } }
</style>

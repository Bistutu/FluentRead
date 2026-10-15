<!--
 * @file src/features/self-help/ui/DiagnosticNotice.vue
 * 文件职责：在失败现场展示本地诊断、可执行动作与用户控制的脱敏报告。
 * 主要内容：以七语言固定文案展示诊断与报告操作，只接受白名单诊断，限制限流等待期内重试，预览时生成允许字段，明确点击导出才创建下载；切换诊断与卸载清理计时器和预览。
 * 模块边界：不请求翻译、不修改服务或配置、不收集正文和 URL；重试与导航交给调用 feature，报告生成使用纯诊断服务。
-->
<template>
  <section v-if="safe" class="fluentread-diagnostic" :data-diagnostic-code="safe.code" data-i18n-ignore>
    <div role="status" aria-live="polite"><strong>{{ copy.title }}</strong><p>{{ copy.detail }}</p></div>
    <div class="diagnostic-actions">
      <button v-for="action in safe.actions" :key="action" type="button" :disabled="busy || (action === 'retry' && remaining > 0)" @click="emit('action', action)">{{ getDiagnosticActionLabel(action, language) }}<span v-if="action === 'retry' && remaining > 0"> ({{ remaining }}s)</span></button>
      <button type="button" :aria-expanded="Boolean(preview)" @click="togglePreview">{{ getDiagnosticUiText('preview', language) }}</button>
    </div>
    <div v-if="preview" class="diagnostic-report">
      <p>{{ getDiagnosticUiText('privacy', language) }}</p>
      <pre tabindex="0" :aria-label="getDiagnosticUiText('report', language)">{{ preview }}</pre>
      <button type="button" @click="download">{{ getDiagnosticUiText('export', language) }}</button>
      <small v-if="exportFailed" role="alert">{{ getDiagnosticUiText('exportFailed', language) }}</small>
    </div>
  </section>
</template>
<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {buildDiagnosticReport, getDiagnosticActionLabel, getDiagnosticText, getDiagnosticUiText, normalizeDiagnostic, type DiagnosticAction} from '@/src/services/diagnostics';
const props = withDefaults(defineProps<{diagnostic: unknown; language?: string; busy?: boolean; version?: string; feature?: 'popup' | 'services'}>(), {language: 'zh-CN', busy: false, feature: 'popup'});
const emit = defineEmits<{action: [action: DiagnosticAction]}>();
const safe = computed(() => normalizeDiagnostic(props.diagnostic));
const copy = computed(() => safe.value ? getDiagnosticText(safe.value, props.language) : {title: '', detail: ''});
const preview = ref(''), exportFailed = ref(false), remaining = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;
const downloadUrls = new Map<string, ReturnType<typeof setTimeout>>();
function clearTimer() {if (timer) clearInterval(timer);timer = undefined;}
watch(() => props.diagnostic, () => {
  preview.value = '';exportFailed.value = false;clearTimer();
  const until = Date.now() + (safe.value?.retryAfterMs ?? 0);
  const tick = () => {remaining.value = Math.max(0, Math.ceil((until - Date.now()) / 1000));if (!remaining.value) clearTimer();};
  tick();if (remaining.value) timer = setInterval(tick, 1000);
}, {immediate: true});
function togglePreview() {
  exportFailed.value = false;
  if (preview.value) {preview.value = '';return;}
  if (!safe.value) return;
  preview.value = JSON.stringify(buildDiagnosticReport({diagnostic: safe.value, feature: props.feature, extensionVersion: props.version, online: navigator.onLine}), null, 2);
}
function download() {
  if (!preview.value) return;
  exportFailed.value = false;
  let url: string | undefined;
  try {
    url = URL.createObjectURL(new Blob([preview.value], {type: 'application/json'}));
    const link = document.createElement('a');link.href = url;link.download = 'fluentread-diagnostic.json';link.click();
  } catch {exportFailed.value = true;}
  finally {if (url) {const ownedUrl = url;downloadUrls.set(ownedUrl, setTimeout(() => {URL.revokeObjectURL(ownedUrl);downloadUrls.delete(ownedUrl);}, 1000));}}
}
onBeforeUnmount(() => {clearTimer();for (const [url, release] of downloadUrls) {clearTimeout(release);URL.revokeObjectURL(url);}downloadUrls.clear();});
</script>
<style scoped>
.fluentread-diagnostic { margin-top: 9px; padding: 10px; border: 1px solid var(--line, #ddd); border-radius: 10px; background: var(--surface-soft, #fafafa); color: var(--ink, #172033); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.fluentread-diagnostic strong { font-size: 12px; font-weight: 650; }
.fluentread-diagnostic p { margin: 3px 0 7px; color: var(--muted, #737c8f); }
.diagnostic-actions { display: flex; flex-wrap: wrap; gap: 5px; }
.fluentread-diagnostic button { border: 1px solid var(--line, #ddd); border-radius: 6px; background: var(--surface, #fff); padding: 4px 7px; color: var(--ink, #172033); cursor: pointer; font-size: 11px; }
.fluentread-diagnostic button:disabled { opacity: .5; cursor: default; }
.fluentread-diagnostic button:focus-visible, pre:focus-visible { outline: 2px solid var(--brand, #ef4776); outline-offset: 2px; }
.diagnostic-report { margin-top: 8px; }
.diagnostic-report pre { max-height: 130px; overflow: auto; padding: 6px; white-space: pre-wrap; color: var(--ink, #172033); background: var(--surface, #fff); font-size: 10px; }
</style>

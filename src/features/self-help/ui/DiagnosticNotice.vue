<!--
 * @file src/features/self-help/ui/DiagnosticNotice.vue
 * 文件职责：在失败现场以紧凑提示保留主要恢复动作，按需展开详细解释和本地脱敏报告。
 * 主要内容：默认只展示简短原因与主操作；用户展开后才挂载说明、次要动作与报告预览入口，Escape 收起并归还焦点；限制冷却期重试，显式预览和导出，切换诊断与卸载清理资源；沿用共享按需语言包与加载代次，包到达后刷新文案，过期加载不能覆盖当前语言。
 * 模块边界：不请求翻译、不修改服务或配置、不收集正文和 URL；重试与导航交给调用 feature，报告生成使用纯诊断服务。
-->
<template>
  <section v-if="safe" class="fluentread-diagnostic" :data-diagnostic-code="safe.code" data-i18n-ignore @keydown.esc="closeDetails">
    <div class="diagnostic-line">
      <span class="diagnostic-summary" data-diagnostic-summary role="status" aria-live="polite">{{ text(`diagnostics.${safe.code}.summary`) }}</span>
      <button v-if="primaryAction" class="diagnostic-primary" data-diagnostic-primary :data-diagnostic-action="primaryAction" type="button" :disabled="busy || (primaryAction === 'retry' && remaining > 0)" @click="emit('action', primaryAction)">{{ actionLabel(primaryAction) }}<span v-if="primaryAction === 'retry' && remaining > 0"> ({{ text('diagnostics.action.retryCountdown', {seconds: remaining}) }})</span></button>
      <button ref="detailsToggle" class="diagnostic-icon" data-diagnostic-details-toggle type="button" :aria-label="text('diagnostics.ui.details')" :title="text('diagnostics.ui.details')" :aria-expanded="expanded" :aria-controls="detailsId" @click="toggleDetails"><span aria-hidden="true">···</span></button>
      <button class="diagnostic-icon diagnostic-dismiss" data-diagnostic-dismiss type="button" :aria-label="text('diagnostics.action.dismiss')" :title="text('diagnostics.action.dismiss')" :disabled="busy" @click="emit('action', 'dismiss')"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
    </div>
    <div v-if="expanded" :id="detailsId" class="diagnostic-details" data-diagnostic-details>
      <p>{{ copy.detail }}</p>
      <div class="diagnostic-actions">
        <button v-for="action in secondaryActions" :key="action" type="button" :data-diagnostic-action="action" :disabled="busy || (action === 'retry' && remaining > 0)" @click="emit('action', action)">{{ text(`diagnostics.action.${action}`) }}<span v-if="action === 'retry' && remaining > 0"> ({{ text('diagnostics.action.retryCountdown', {seconds: remaining}) }})</span></button>
        <button type="button" data-diagnostic-preview :aria-expanded="Boolean(preview)" @click="togglePreview">{{ text(preview ? 'diagnostics.report.hidePreview' : 'diagnostics.report.preview') }}</button>
      </div>
      <div v-if="preview" class="diagnostic-report">
        <p>{{ text('diagnostics.report.localOnly') }}</p>
        <pre tabindex="0" :aria-label="text('diagnostics.report.previewLabel')">{{ preview }}</pre>
        <button type="button" @click="download">{{ text('diagnostics.report.export') }}</button>
        <small v-if="exportFailed" role="alert">{{ text('diagnostics.report.exportFailed') }}</small>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import {computed, onBeforeUnmount, ref, useId, watch} from 'vue';
import {buildDiagnosticReport, normalizeDiagnostic, type DiagnosticAction} from '@/src/services/diagnostics';
import {resolveUiLanguageFromLocale, translate, type TranslationParams} from '@/src/core/i18n';
import {ensureUiLanguageBundle} from '@/src/platform/i18n/uiLanguageBundles';
const props = withDefaults(defineProps<{diagnostic: unknown; language?: string; busy?: boolean; version?: string; feature?: 'popup' | 'services'}>(), {language: 'zh-CN', busy: false, feature: 'popup'});
const emit = defineEmits<{action: [action: DiagnosticAction]}>();
const safe = computed(() => normalizeDiagnostic(props.diagnostic));
const displayLanguage = computed(() => resolveUiLanguageFromLocale(props.language));
const messageRevision = ref(0);
// 显式 language prop 同样使用共享 loader 去重；Vue 停止 watcher 时会撤销尚未完成的加载所有权。
watch(displayLanguage, (language, _previous, onCleanup) => {
  let current = true;
  onCleanup(() => {current = false;});
  void ensureUiLanguageBundle(language).then(loaded => {
    if (current && loaded) messageRevision.value += 1;
  }).catch(() => undefined);
}, {immediate: true});
function text(key: string, params?: TranslationParams): string {
  void messageRevision.value;
  return translate(key, displayLanguage.value, params);
}
const copy = computed(() => safe.value ? {title: text(safe.value.titleKey), detail: text(safe.value.detailKey)} : {title: '', detail: ''});
const primaryAction = computed(() => safe.value?.actions.includes('site-settings') ? 'site-settings' : safe.value?.actions.find(action => action !== 'dismiss'));
const secondaryActions = computed(() => safe.value?.actions.filter(action => action !== 'dismiss' && action !== primaryAction.value) ?? []);
const expanded = ref(false), detailsToggle = ref<HTMLButtonElement>(), detailsId = `diagnostic-details-${useId()}`;
const preview = ref(''), exportFailed = ref(false), remaining = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;
const downloadUrls = new Map<string, ReturnType<typeof setTimeout>>();
function clearTimer() {if (timer) clearInterval(timer);timer = undefined;}
watch(() => props.diagnostic, () => {
  expanded.value = false;preview.value = '';exportFailed.value = false;clearTimer();
  const until = Date.now() + (safe.value?.retryAfterMs ?? 0);
  const tick = () => {remaining.value = Math.max(0, Math.ceil((until - Date.now()) / 1000));if (!remaining.value) clearTimer();};
  tick();if (remaining.value) timer = setInterval(tick, 1000);
}, {immediate: true});
function actionLabel(action: DiagnosticAction) {
  return action === 'services' ? text('diagnostics.ui.service-action')
    : action === 'site-settings' ? text('diagnostics.ui.site-action') : text(`diagnostics.action.${action}`);
}
function toggleDetails() {
  expanded.value = !expanded.value;
  if (!expanded.value) {preview.value = '';exportFailed.value = false;}
}
function closeDetails(event: KeyboardEvent) {
  if (!expanded.value) return;
  event.preventDefault();event.stopPropagation();toggleDetails();detailsToggle.value?.focus?.();
}
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
.fluentread-diagnostic { margin-top: 6px; color: var(--ink, #172033); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.diagnostic-line { display: flex; align-items: center; gap: 6px; min-height: 24px; }
.diagnostic-summary { flex: 1; min-width: 0; color: var(--muted, #737c8f); }
.fluentread-diagnostic button { min-height: 24px; border: 0; border-radius: 4px; background: transparent; padding: 3px 0; color: var(--brand, #c43260); cursor: pointer; font: inherit; }
.diagnostic-primary { flex-shrink: 0; white-space: nowrap; }
.fluentread-diagnostic .diagnostic-icon { flex: 0 0 22px; display: inline-flex; justify-content: center; align-items: center; width: 22px; height: 24px; padding: 0; color: var(--muted, #737c8f); }
.diagnostic-icon svg { width: 14px; height: 14px; }
.fluentread-diagnostic button:hover:not(:disabled) { color: var(--ink, #172033); background: var(--surface-soft, #fafafa); }
.fluentread-diagnostic button:disabled { opacity: .5; cursor: default; }
.fluentread-diagnostic button:focus-visible, pre:focus-visible { outline: 2px solid var(--brand, #ef4776); outline-offset: 2px; }
.diagnostic-details { margin-top: 5px; padding-top: 6px; border-top: 1px solid var(--line, #ddd); }
.diagnostic-details p { margin: 0 0 5px; color: var(--muted, #737c8f); }
.diagnostic-actions { display: flex; flex-wrap: wrap; gap: 5px 12px; }
.diagnostic-report { margin-top: 8px; }
.diagnostic-report pre { max-height: 130px; overflow: auto; padding: 6px; white-space: pre-wrap; color: var(--ink, #172033); background: var(--surface, #fff); font-size: 10px; }
/* 桌面保留紧凑行；触屏使用实际44px盒子，不能靠覆盖相邻动作的伪元素扩大命中。 */
@media (any-pointer: coarse) {
  .fluentread-diagnostic button { min-width: 44px; min-height: 44px; padding: 6px 4px; }
  .fluentread-diagnostic .diagnostic-icon { flex-basis: 44px; width: 44px; height: 44px; padding: 0; }
  .diagnostic-actions { gap: 4px 8px; }
}
/* Firefox Android 的固定弹窗可能报告 fine；复用宿主公开平台判定标记。 */
html[data-fluentread-android-popup] .fluentread-diagnostic button { min-width: 44px; min-height: 44px; padding: 6px 4px; }
html[data-fluentread-android-popup] .fluentread-diagnostic .diagnostic-icon { flex-basis: 44px; width: 44px; height: 44px; padding: 0; }
html[data-fluentread-android-popup] .diagnostic-actions { gap: 4px 8px; }
</style>

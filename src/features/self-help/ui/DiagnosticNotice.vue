<!--
 * @file src/features/self-help/ui/DiagnosticNotice.vue
 * 文件职责：在翻译操作下方以小状态入口展示故障，按需打开不占布局空间的恢复浮层。
 * 主要内容：默认仅挂载状态图标与无障碍摘要；浮层按可用空间定位，展开后才挂载解释、恢复和报告入口，Escape 返回焦点、外部操作自然收起；限制冷却期重试，切换与卸载清理资源；保留按需语言包加载代次，隐藏摘要/入口标签与已打开浮层都随有效包到达刷新，语言迟到后重新计算可用空间。
 * 模块边界：不请求翻译、不修改服务或配置、不收集正文和 URL；重试与导航交给调用 feature，报告生成使用纯诊断服务。
-->
<template>
  <section v-if="safe" ref="host" class="fluentread-diagnostic" :data-diagnostic-code="safe.code" data-i18n-ignore @keydown.esc="closeDetails">
    <button ref="detailsToggle" class="diagnostic-trigger" data-diagnostic-details-toggle type="button" :aria-label="`${text(`diagnostics.${safe.code}.summary`)} · ${text('diagnostics.ui.details')}`" :title="text(`diagnostics.${safe.code}.summary`)" aria-haspopup="dialog" :aria-expanded="expanded" :aria-controls="detailsId" @click="toggleDetails">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 5.5v5M10 13v1"/></svg>
    </button>
    <span class="diagnostic-sr-only" data-diagnostic-summary role="status" aria-live="polite">{{ text(`diagnostics.${safe.code}.summary`) }}</span>
    <div v-if="expanded" :id="detailsId" ref="panel" class="diagnostic-details" :class="placement" :style="{maxHeight: `${maxHeight}px`}" data-diagnostic-details role="dialog" :aria-labelledby="`${detailsId}-title`" :aria-describedby="`${detailsId}-description`">
      <div class="diagnostic-heading">
        <strong :id="`${detailsId}-title`" data-diagnostic-summary>{{ text(`diagnostics.${safe.code}.summary`) }}</strong>
        <button class="diagnostic-close" data-diagnostic-close type="button" :aria-label="text('diagnostics.ui.close-details')" @click="closeDetails"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg></button>
      </div>
      <p :id="`${detailsId}-description`">{{ detail }}</p>
      <div class="diagnostic-actions">
        <button v-if="primaryAction" class="diagnostic-primary" data-diagnostic-primary :data-diagnostic-action="primaryAction" type="button" :disabled="busy || (primaryAction === 'retry' && remaining > 0)" @click="emit('action', primaryAction)">{{ actionLabel(primaryAction) }}<span v-if="primaryAction === 'retry' && remaining > 0"> ({{ text('diagnostics.action.retryCountdown', {seconds: remaining}) }})</span></button>
        <button v-for="action in secondaryActions" :key="action" type="button" :data-diagnostic-action="action" :disabled="busy || (action === 'retry' && remaining > 0)" @click="emit('action', action)">{{ text(`diagnostics.action.${action}`) }}<span v-if="action === 'retry' && remaining > 0"> ({{ text('diagnostics.action.retryCountdown', {seconds: remaining}) }})</span></button>
      </div>
      <div class="diagnostic-tools">
        <button type="button" data-diagnostic-preview :aria-expanded="Boolean(preview)" @click="togglePreview">{{ text(preview ? 'diagnostics.report.hidePreview' : 'diagnostics.report.preview') }}</button>
        <button data-diagnostic-dismiss type="button" :disabled="busy" @click="emit('action', 'dismiss')">{{ text('diagnostics.ui.dismiss-notice') }}</button>
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
import {computed, nextTick, onBeforeUnmount, ref, useId, watch} from 'vue';
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
const detail = computed(() => safe.value ? text(safe.value.detailKey) : '');
const primaryAction = computed(() => safe.value?.actions.includes('site-settings') ? 'site-settings' : safe.value?.actions.find(action => action !== 'dismiss'));
const secondaryActions = computed(() => safe.value?.actions.filter(action => action !== 'dismiss' && action !== primaryAction.value) ?? []);
const host = ref<HTMLElement>(), panel = ref<HTMLElement>(), placement = ref('above'), maxHeight = ref(240);
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
function measurePanel() {
  const rect = host.value?.getBoundingClientRect?.();
  if (!rect || !panel.value) return;
  const clip = host.value?.closest?.('.popup-shell')?.getBoundingClientRect();
  const top = Math.max(0, clip?.top ?? 0), bottom = Math.min(window.innerHeight, clip?.bottom ?? window.innerHeight);
  if (rect.bottom <= top || rect.top >= bottom) {toggleDetails();return;}
  // Popup 可将入口放入换行流，浮层空间须按实际定位容器计算，不能把入口与容器的行差算作可用高度。
  const anchor = panel.value.offsetParent?.getBoundingClientRect() ?? rect;
  const above = Math.max(0, anchor.top - top - 18), below = Math.max(0, bottom - anchor.bottom - 18);
  placement.value = panel.value.scrollHeight <= above || above >= below ? 'above' : 'below';
  maxHeight.value = Math.max(48, placement.value === 'above' ? above : below);
}
function outside(event: Event) {
  if (expanded.value && host.value && !host.value.contains(event.target as Node)) toggleDetails();
}
function onScroll(event: Event) {
  if (expanded.value && !panel.value?.contains(event.target as Node)) measurePanel();
}
function stopWatching() {
  document.removeEventListener?.('pointerdown', outside, true);document.removeEventListener?.('focusin', outside, true);
  document.removeEventListener?.('scroll', onScroll, true);
  window.removeEventListener?.('resize', measurePanel);
}
watch(expanded, open => {
  if (!open) {stopWatching();return;}
  document.addEventListener?.('pointerdown', outside, true);document.addEventListener?.('focusin', outside, true);
  document.addEventListener?.('scroll', onScroll, true);
  window.addEventListener?.('resize', measurePanel);
  void nextTick(() => {
    if (!expanded.value) return;
    measurePanel();
    if (document.activeElement === detailsToggle.value) (panel.value?.querySelector<HTMLButtonElement>('[data-diagnostic-primary]:not(:disabled)') || panel.value?.querySelector<HTMLButtonElement>('[data-diagnostic-close]'))?.focus();
  });
}, {flush: 'post'});
watch([preview, displayLanguage, messageRevision], () => {if (expanded.value) void nextTick(measurePanel);});
function toggleDetails() {
  expanded.value = !expanded.value;
  if (!expanded.value) {preview.value = '';exportFailed.value = false;}
}
function closeDetails(event: Event) {
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
onBeforeUnmount(() => {stopWatching();clearTimer();for (const [url, release] of downloadUrls) {clearTimeout(release);URL.revokeObjectURL(url);}downloadUrls.clear();});
</script>
<style scoped>
.fluentread-diagnostic { position: relative; flex: 0 0 24px; width: 24px; height: 24px; margin-left: auto; color: var(--ink, #172033); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.fluentread-diagnostic button { min-height: 24px; border: 0; border-radius: 5px; background: transparent; padding: 3px 0; color: var(--brand-strong, #c43260); cursor: pointer; font: inherit; }
.fluentread-diagnostic .diagnostic-trigger { display: grid; place-items: center; width: 24px; height: 24px; padding: 3px; color: #b97713; background: rgba(196, 133, 33, .08); }
.diagnostic-trigger svg { width: 16px; height: 16px; }
.diagnostic-trigger[aria-expanded="true"] { box-shadow: inset 0 0 0 1px currentColor; }
.diagnostic-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
/* 叠加滚动条不扣除布局宽度；右侧保留16px，避免滚动后的命中层挡住关闭按钮右缘。 */
.diagnostic-details { box-sizing: border-box; position: absolute; right: 0; z-index: 30; width: min(276px, calc(100vw - 32px)); padding: 10px 12px; padding-right: 16px; border: 1px solid var(--line, #ddd); border-radius: 10px; background: var(--surface, #fff); box-shadow: 0 5px 20px rgba(20, 30, 50, .14); overflow-y: auto; overscroll-behavior: contain; }
.diagnostic-details.above { bottom: calc(100% + 6px); }
.diagnostic-details.below { top: calc(100% + 6px); }
.diagnostic-heading { position: sticky; top: -10px; z-index: 1; display: flex; align-items: center; gap: 8px; margin: -10px 0 5px; padding-top: 10px; background: var(--surface, #fff); }
.diagnostic-heading strong { flex: 1; min-width: 0; font-size: 12px; font-weight: 600; }
.fluentread-diagnostic .diagnostic-close { display: grid; place-items: center; flex: 0 0 22px; width: 22px; height: 22px; padding: 0; color: var(--muted, #737c8f); }
.diagnostic-close svg { width: 14px; height: 14px; }
.diagnostic-details p { margin: 0 0 7px; color: var(--muted, #737c8f); }
.diagnostic-actions, .diagnostic-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 12px; }
.diagnostic-primary { font-weight: 600 !important; }
.diagnostic-tools { margin-top: 6px; padding-top: 5px; border-top: 1px solid var(--line, #ddd); }
.diagnostic-tools button { color: var(--muted, #737c8f); font-size: 10px; }
.fluentread-diagnostic button:hover:not(:disabled) { color: var(--ink, #172033); background: var(--surface-soft, #fafafa); }
.fluentread-diagnostic button:disabled { opacity: .5; cursor: default; }
.fluentread-diagnostic button:focus-visible, pre:focus-visible { outline: 2px solid var(--brand, #ef4776); outline-offset: 2px; }
.diagnostic-report { margin-top: 8px; }
.diagnostic-report pre { max-height: 110px; overflow: auto; padding: 6px; white-space: pre-wrap; color: var(--ink, #172033); background: var(--surface-soft, #fafafa); font-size: 10px; }
/* 入口宿主与真实按钮一起占44px，不能扩大命中层却仍保留24px布局导致相邻规则被遮挡。 */
@media (any-pointer: coarse) {
  .fluentread-diagnostic { flex-basis: 44px; width: 44px; height: 44px; }
  .fluentread-diagnostic button { min-width: 44px; min-height: 44px; padding: 6px 4px; }
  .fluentread-diagnostic .diagnostic-trigger, .fluentread-diagnostic .diagnostic-close { flex-basis: 44px; width: 44px; height: 44px; padding: 0; }
}
/* Firefox Android固定容器可能报告fine；使用宿主公开平台API的既有标记。 */
html[data-fluentread-android-popup] .fluentread-diagnostic { flex-basis: 44px; width: 44px; height: 44px; }
html[data-fluentread-android-popup] .fluentread-diagnostic button { min-width: 44px; min-height: 44px; padding: 6px 4px; }
html[data-fluentread-android-popup] .fluentread-diagnostic .diagnostic-trigger, html[data-fluentread-android-popup] .fluentread-diagnostic .diagnostic-close { flex-basis: 44px; width: 44px; height: 44px; padding: 0; }
</style>

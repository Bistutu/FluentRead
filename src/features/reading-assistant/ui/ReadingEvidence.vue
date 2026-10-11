<!--
 * @file src/features/reading-assistant/ui/ReadingEvidence.vue
 * 文件职责：在解释旁显示已经校验的原文依据和定位状态，保留失效来源的文字供读者核对。
 * 主要内容：使用紧凑原生按钮支持点击及键盘操作，完整引文保留在悬停提示与无障碍名称中；通过受限回调定位原句，只显示简短失效提示，历史材料保留快照。
 * 模块边界：只接收已校验的引用，不读取网页、网络或存储；原文定位及临时绘制由页面所属锚点负责。
 -->
<template>
  <span class="fr-reading-evidence-wrap" data-i18n-ignore>
    <button type="button" class="fr-reading-evidence" data-reading-evidence :data-evidence-quote="citation.quote" :data-evidence-state="state" :aria-label="t('reading.evidence.locate', {quote: citation.quote})" :title="citation.quote" @click="locate"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 4 2 8l4 4M2 8h8a3 3 0 0 0 3-3V3" /></svg>{{ t('reading.evidence.label') }}</button>
    <span v-if="state !== 'ready'" class="fr-reading-evidence-status" :class="{'is-located': state === 'located'}" role="status">{{ t(`reading.evidence.${state}`) }}</span>
  </span>
</template>
<script setup lang="ts">
import {ref, watch} from 'vue';
import {useUiI18n} from '@/src/ui/i18n';
import type {ReadingEvidenceBlock} from '@/src/core/harness/evidence';
import type {ReadingEvidenceAnchor, ReadingEvidenceLocation} from '../evidenceAnchor';
const props = defineProps<{citation: Extract<ReadingEvidenceBlock, {kind: 'citation'}>; locateEvidence?: ReadingEvidenceAnchor['locate']; sourceState?: ReadingEvidenceLocation}>();
const {t} = useUiI18n();
const state = ref<'ready' | ReturnType<ReadingEvidenceAnchor['locate']>>('ready');
watch(() => [props.citation.id, props.citation.quote, props.locateEvidence, props.sourceState], () => {
  state.value = props.sourceState && props.sourceState !== 'located' ? props.sourceState : 'ready';
}, {immediate: true});
function locate(): void {
  state.value = props.locateEvidence?.({quote: props.citation.quote, sourceText: props.citation.sourceText, kind: props.citation.sourceKind, sourceOffset: props.citation.sourceStart}) ?? 'unavailable';
}
</script>
<style scoped>
.fr-reading-evidence-wrap { display: inline; }
.fr-reading-evidence { display: inline-flex; align-items: center; gap: 4px; margin: 1px 4px; padding: 1px 6px; max-width: 100%; border: 1px solid var(--fr-answer-border, #ddd); border-radius: 4px; background: var(--fr-answer-soft, #f8f8fa); color: var(--fr-reading-button, #a64b6e); font: inherit; font-size: 12px; line-height: 1.6; vertical-align: baseline; cursor: pointer; }
.fr-reading-evidence svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.fr-reading-evidence:hover { border-color: var(--fr-reading-button, #a64b6e); }
.fr-reading-evidence:focus-visible { outline: 2px solid var(--fr-reading-button, #a64b6e); outline-offset: 2px; }
.fr-reading-evidence-status { font-size: 12px; color: var(--fr-answer-quote, inherit); }
.fr-reading-evidence-status.is-located { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>

<!--
@file src/features/settings/ui/InformationHighlightPreview.vue
文件职责：在自然段落中即时预览智能高亮的密度、六套配色和绘制方式，并可切换到未高亮的原文对比。
主要内容：示例段落用真实的关键词规则评分，复用真实的热力层级和透明度映射，看到的深浅就是关键词方式在这段文字上的结果；长文本保留完整文字、空白与段落，色阶图例帮助直接比较浓淡效果。
模块边界：纯展示组件，不访问网页正文、不调用本地模型、不写配置；本地模型方式的结果会与预览不同，预览不代表词语重要性或阅读效果证据。
-->
<template>
  <figure class="information-highlight-preview" :class="[`style-${preferences.style}`, {'is-compact': compact}]" :style="{'--highlight-preview-rgb': palette.rgb}" :data-information-highlight-preview-color="preferences.color" :data-information-highlight-preview-style="preferences.style" :data-information-highlight-preview-density="preferences.density" data-testid="information-highlight-preview">
    <div class="highlight-preview-heading"><span>{{ t('informationHighlight.preview.label') }}</span><span class="highlight-preview-compare" role="group" :aria-label="t('informationHighlight.preview.label')"><button v-for="item in views" :key="String(item.value)" type="button" :aria-pressed="original === item.value" :class="{selected: original === item.value}" :onClick="item.choose" :data-information-highlight-preview-view="item.value ? 'original' : 'highlighted'">{{ t(item.value ? 'informationHighlight.preview.original' : 'informationHighlight.preview.highlighted') }}</button></span></div>
    <div class="highlight-preview-page">
      <p v-for="(paragraph, index) in paragraphs" :key="index" class="highlight-preview-text"><template v-for="(piece, pieceIndex) in paragraph" :key="pieceIndex"><mark v-if="piece.level !== undefined && !original" :data-information-highlight-preview-level="piece.level" :style="{'--highlight-preview-opacity': informationHighlightOpacity(preferences.style, piece.level, preferences.intensity)}">{{ piece.text }}</mark><span v-else>{{ piece.text }}</span></template></p>
    </div>
    <div v-if="preferences.style === 'heatmap'" class="highlight-preview-legend" :class="{'is-hidden': original}" :aria-label="`${t('informationHighlight.preview.legend.low')} — ${t('informationHighlight.preview.legend.high')}`"><span>{{ t('informationHighlight.preview.legend.low') }}</span><span class="highlight-preview-ramp" aria-hidden="true"><i v-for="level in rampLevels" :key="level" :style="{backgroundColor: `rgb(${palette.rgb} / ${informationHighlightOpacity('heatmap', level, preferences.intensity)})`}" /></span><span>{{ t('informationHighlight.preview.legend.high') }}</span></div>
    <figcaption>{{ t('informationHighlight.preview.caption') }}</figcaption>
  </figure>
</template>
<script setup lang="ts">
import {computed, ref} from 'vue'
import type {InformationHighlightPreferences} from '@/src/core/config/informationHighlight'
import {INFORMATION_HIGHLIGHT_PALETTES, informationHighlightOpacity, presentInformationHeatmap, scoreInformationKeywords, selectInformationSpans} from '@/src/features/information-highlight/domain/public'
import {useUiI18n} from '@/src/ui/i18n'
const props = defineProps<{preferences: InformationHighlightPreferences; compact?: boolean}>()
const {t} = useUiI18n()
const palette = computed(() => INFORMATION_HIGHLIGHT_PALETTES[props.preferences.color])
const rampLevels = [0, 2, 3, 5, 7]
// 只是本次查看的对比开关，不写入偏好。
const original = ref(false)
const views = [false, true].map(value => ({value, choose: () => {original.value = value}}))
const paragraphs = computed(() => t('informationHighlight.preview.story').split('\n\n').map(text => {
  const scored = scoreInformationKeywords(text).spans
  const spans = props.preferences.style === 'heatmap'
    ? presentInformationHeatmap(text, scored, props.preferences.density)
    : selectInformationSpans(text, scored, props.preferences.density).map(span => ({...span, level: 7}))
  const pieces: {text: string; level?: number}[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) pieces.push({text: text.slice(cursor, span.start)})
    pieces.push({text: text.slice(span.start, span.end), level: span.level}); cursor = span.end
  }
  if (cursor < text.length) pieces.push({text: text.slice(cursor)})
  return pieces
}))
</script>
<style scoped>
.information-highlight-preview { margin: 0; overflow: hidden; border: 1px solid var(--line, #dce3eb); border-radius: 16px; color: var(--ink, #25354b); background: var(--surface, #fff); box-shadow: 0 4px 18px rgb(29 43 65 / .035); }
.highlight-preview-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 14px 20px; border-bottom: 1px solid var(--line, #dce3eb); color: var(--muted, #637184); background: var(--surface-soft, #f6f8fb); font-size: 11px; }
.highlight-preview-compare { display: inline-flex; padding: 2px; border: 1px solid var(--line, #dce3eb); border-radius: 8px; background: var(--surface, #fff); }
.highlight-preview-compare button { min-width: 48px; padding: 3px 10px; border: 0; border-radius: 6px; color: var(--muted, #637184); background: transparent; font: inherit; font-size: 11px; cursor: pointer; }
.highlight-preview-compare button.selected { color: var(--brand-strong, #2464b8); background: var(--brand-soft, #edf5ff); font-weight: 600; }
.highlight-preview-compare button:focus-visible { outline: 2px solid var(--brand, #3680dd); outline-offset: 1px; }
.highlight-preview-legend.is-hidden { visibility: hidden; }
.highlight-preview-page { padding: 20px 22px 16px; }
.highlight-preview-text { margin: 0; font-size: 15px; line-height: 2.05; overflow-wrap: anywhere; }
.highlight-preview-text + .highlight-preview-text { margin-top: 18px; }
mark { padding: 0; border-radius: 3px; color: inherit; background: rgb(var(--highlight-preview-rgb) / var(--highlight-preview-opacity)); box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.style-underline mark { background: transparent; text-decoration: underline; text-decoration-color: rgb(var(--highlight-preview-rgb) / var(--highlight-preview-opacity)); text-decoration-thickness: 2px; text-underline-offset: 3px; }
.highlight-preview-legend { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 0 20px 10px; color: var(--muted, #637184); font-size: 10px; }
.highlight-preview-ramp { display: flex; width: 94px; height: 9px; border-radius: 999px; overflow: hidden; }
.highlight-preview-ramp i { flex: 1; min-width: 0; }
figcaption { margin: 0; padding: 0 20px 16px; color: var(--muted, #637184); font-size: 10px; line-height: 1.6; text-align: center; }
.is-compact .highlight-preview-heading { padding: 10px 12px; }.is-compact .highlight-preview-page { padding: 12px; }.is-compact .highlight-preview-text { font-size: 12px; }.is-compact figcaption { padding: 0 12px 10px; }
@media (max-width: 480px) { .highlight-preview-heading { padding: 12px 14px; }.highlight-preview-page { padding: 16px 14px; }.highlight-preview-text { font-size: 14px; line-height: 2; }.highlight-preview-legend { padding-inline: 14px; }figcaption { padding-inline: 14px; } }
</style>

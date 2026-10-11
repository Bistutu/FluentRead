<script setup lang="ts">
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import { useDemoPlayback } from './useDemoPlayback'
import DemoSteps from './DemoSteps.vue'
const props = withDefaults(defineProps<{ en?: boolean; autoplay?: boolean }>(), { autoplay: true })
const root = ref<HTMLElement | null>(null)
const { step, playing, running, reduced, select, replay } = useDemoPlayback(
  root,
  4,
  props.autoplay,
  [350, 350, 550, 3800]
)
const t = (zh: string, english: string) => (props.en ? english : zh)
const translated = computed(() => step.value >= 2)
</script>
<template>
  <div
    ref="root"
    class="bv-reader"
    data-demo="brand-reader"
    :data-step="step"
    :data-playing="playing"
    :data-running="running"
  >
    <div class="bv-window">
      <span class="bv-dots" aria-hidden="true"><i></i><i></i><i></i></span
      ><span>{{ t('网页双语翻译 · 示例文章', 'Bilingual webpage · example article') }}</span
      ><img :src="withBase('/brand-icon.webp')" width="28" height="28" :alt="t('流畅阅读', 'FluentRead')" />
    </div>
    <div class="bv-reader-toolbar">
      <span>{{ t('英语 → 简体中文', 'Chinese → English') }}</span
      ><span class="bv-demo-status" :class="{ complete: step === 3 }">
        {{
          step === 0
            ? t('原文', 'Original')
            : step === 3
            ? t('双语对照', 'Bilingual result')
            : t('正在添加译文…', 'Adding translation…')
        }}
      </span>
    </div>
    <DemoSteps
      :labels="[
        t('打开网页', 'Open a page'),
        t('翻译网页', 'Translate'),
        t('双语阅读', 'Read both'),
      ]"
      :active="step === 0 ? 0 : step < 3 ? 1 : 2"
      :label="t('网页翻译流程', 'Webpage translation workflow')"
      :playing="playing"
      :reduced="reduced"
      :en="en"
      @select="select($event, [0, 1, 3])"
    />
    <article class="bv-paper" :class="{ translated, scanning: step === 1 }">
      <span class="bv-paper-label">{{
        t('阅读示例 · 原文始终保留', 'Reading example · the original stays')
      }}</span>
      <h3>{{ t('The joy of reading.', '阅读的乐趣。') }}</h3>
      <div class="bv-line">
        <p>
          {{ t('Reading opens a window to the world.', '阅读为我们打开一扇了解世界的窗。') }}
        </p>
        <p class="bv-line-translation" :aria-hidden="!translated">
          {{ t('阅读为我们打开一扇了解世界的窗。', 'Reading opens a window to the world.') }}
        </p>
      </div>
      <div class="bv-line">
        <p>
          {{ t('A good book can take you somewhere new.', '一本好书能带你发现新的天地。') }}
        </p>
        <p class="bv-line-translation" :aria-hidden="!translated || step === 2">
          {{ t('一本好书能带你发现新的天地。', 'A good book can take you somewhere new.') }}
        </p>
      </div>
      <div class="bv-reading-mark" aria-hidden="true"><span></span><span></span><span></span></div>
    </article>
    <div class="bv-playback">
      <small>{{
        t('自动演示 · 译文出现在原文下方', 'Auto demo · translation appears underneath')
      }}</small>
      <div>
        <button
          v-if="!reduced"
          type="button"
          :aria-label="
            playing
              ? t('暂停自动演示', 'Pause automatic demo')
              : t('播放自动演示', 'Play automatic demo')
          "
          @click="playing = !playing"
        >
          {{ playing ? t('Ⅱ 暂停', 'Ⅱ Pause') : t('▷ 播放', '▷ Play') }}</button
        ><button type="button" @click="replay">
          {{ t('↻ 重播', '↻ Replay') }}
        </button>
      </div>
    </div>
  </div>
</template>

<!--
 * @file src/features/progressive-reading/ui/ProgressiveReading.vue
 * 文件职责：呈现主动选文后的渐进阅读面板，让读者随时切换原文、短语、逻辑线索和完整双语。
 * 主要内容：沿用 FluentRead 的品牌、表面与控件语义，跟随亮暗与自动主题；可键盘操作的四档按钮、常驻完整双语动作和可恢复的熟悉提示，次要边界说明使用可聚焦的原生展开入口；窄屏限制高度，文字采用 Vue 安全纯文本渲染。
 * 模块边界：消费阅读会话 props 和只读主题配置，监听与订阅随组件卸载释放；不应用扩展页面皮肤、不改宿主样式，不读取网页、发起网络请求或更新掌握状态。
 -->
<template>
  <section v-if="state.open" ref="panel" v-ui-i18n class="fr-reading" :class="{'fr-dark-theme': isDarkTheme}" role="region" aria-label="渐进阅读" tabindex="-1" @keydown.esc.stop="close">
    <header>
      <span class="fr-reading-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5Z"/><path d="M6 8h3m-3 3h3m6-3h3m-3 3h3"/></svg><strong>渐进阅读</strong></span>
      <button data-reading-close type="button" aria-label="关闭渐进阅读" title="关闭 · Esc" @click="close">×</button>
    </header>
    <p class="fr-reading-intro" title="原网页仍可阅读、复制和点击链接；选择正文后，可以自由切换帮助强度。">按需查看提示，随时打开完整双语。</p>
    <button data-reading-use-selection class="fr-reading-use" type="button" title="在原网页选择一个词、表达或正文段落后读取" @pointerdown.prevent @click="useSelection">读取选中正文</button>
    <div class="fr-reading-modes" role="group" aria-label="帮助强度">
      <button v-for="mode in modes" :key="mode.id" :data-reading-mode="mode.id" type="button" :aria-pressed="state.mode === mode.id" :disabled="!state.source" @click="assistance(mode.id)">{{ mode.label }}</button>
    </div>
    <p v-if="!state.source && !state.error" class="fr-reading-empty">先在网页中选择正文，再点击上方读取。</p>
    <div v-if="state.source" class="fr-reading-body">
      <div class="fr-reading-label">原文</div><p data-reading-source class="fr-reading-source">{{ state.source }}</p>
      <template v-if="state.mode === 'phrases'">
        <details class="fr-reading-help"><summary aria-label="查看短语提示说明：释义仅作参考">释义仅作参考</summary><p>本地释义与收藏参考可能不适用于当前义项；表达翻译也取决于当前服务的语境能力。有歧义时可查看完整双语。</p></details>
        <p v-if="hiddenCount" data-reading-hidden-hints class="fr-reading-note fr-reading-known" title="只收起相同保存语境中已明确手动掌握的提示；仍可主动查看。"><span>{{ state.showKnown ? '已展示' : '已收起' }} {{ hiddenCount }} 条熟悉提示</span><button data-reading-show-known type="button" :aria-pressed="state.showKnown" @click="state.showKnown = !state.showKnown">{{ state.showKnown ? '收起熟悉提示' : '仍需要帮助' }}</button></p>
        <ul class="fr-reading-hints"><li v-for="hint in visibleHints" :key="`${hint.start}:${hint.end}`" data-reading-phrase :data-reading-term="hint.term">
          <strong>{{ hint.term }}</strong><span v-if="hint.reference">{{ hint.reference }} <small>{{ hint.saved ? '收藏参考' : '本地释义' }}</small></span>
          <button type="button" title="使用当前翻译服务查询这个表达；不保证识别当前义项" @click="assistance('phrases', hint)">查询表达</button>
        </li></ul>
        <p v-if="!visibleHints.length" class="fr-reading-note">暂无匹配提示，可选择卡住的表达或查看完整双语。</p>
        <p v-if="state.hintError" role="status">{{ state.hintError }}</p>
        <p v-if="state.phraseLoading" role="status">正在查询 {{ state.phraseTerm }}…</p>
        <p v-if="state.phraseAnswer" data-reading-phrase-answer class="fr-reading-answer"><strong>{{ state.phraseTerm }}</strong> · {{ state.phraseAnswer }}</p>
      </template>
      <template v-if="state.mode === 'logic'">
        <details class="fr-reading-help"><summary aria-label="查看逻辑线索说明：仅引用原文词面标记">原文词面线索</summary><p>仅引用原文中的词面标记，不提供完整句法分析，也不判断作者意图或条件是否成立。未匹配到标记，也不代表原文没有条件或歧义。</p></details>
        <ul class="fr-reading-hints fr-reading-clues"><li v-for="clue in state.clues" :key="`${clue.label}:${clue.start}`" data-reading-logic><details><summary :aria-label="`查看 ${clue.term} 的${clue.label}说明`"><strong>{{ clue.term }}</strong><span>{{ clue.label }}</span></summary><p>{{ clue.detail }}</p></details></li></ul>
        <p v-if="!state.clues.length" class="fr-reading-note" title="未命中词面规则不代表原文没有条件或歧义。">未匹配到当前规则的线索。</p>
      </template>
      <template v-if="state.mode === 'bilingual'">
        <div class="fr-reading-label">完整译文 <small>{{ state.translationOrigin }}</small></div>
        <p v-if="state.loading" role="status">正在读取完整译文…</p>
        <p v-if="state.translation" data-reading-translation class="fr-reading-answer">{{ state.translation }}</p>
      </template>
    </div>
    <p v-if="state.error" class="fr-reading-error" role="alert">{{ state.error }}</p>
    <footer v-if="state.source"><button data-reading-full type="button" :disabled="state.loading" title="无需标记掌握或逐级查看，直接打开完整双语" @click="assistance('bilingual')">{{ state.error && state.mode === 'bilingual' ? '重试完整双语' : '完整双语' }}</button><span>随时查看</span></footer>
  </section>
</template>
<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref} from 'vue';
import {config, subscribeConfig} from '@/src/services/config/store';
import type {ReadingState} from '../session';
import type {PhraseHint, ReadingMode} from '../hints';
const props = defineProps<{state: ReadingState; close(): void; useSelection(): void; assistance(mode: ReadingMode, phrase?: PhraseHint): void}>();
const panel = ref<HTMLElement>();
const systemTheme = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const theme = ref(config.theme);
const systemDark = ref(systemTheme?.matches ?? false);
const isDarkTheme = computed(() => theme.value === 'dark' || theme.value === 'auto' && systemDark.value);
let unsubscribeConfig: (() => void) | undefined;
function updateTheme(): void {theme.value = config.theme; systemDark.value = systemTheme?.matches ?? false;}
const modes: Array<{id: ReadingMode; label: string}> = [{id: 'original', label: '只读原文'}, {id: 'phrases', label: '短语提示'}, {id: 'logic', label: '逻辑线索'}, {id: 'bilingual', label: '完整双语'}];
const hiddenCount = computed(() => props.state.phrases.filter(hint => hint.hidden).length);
const visibleHints = computed(() => props.state.phrases.filter(hint => !hint.hidden || props.state.showKnown));
onMounted(() => {
  updateTheme();
  systemTheme?.addEventListener('change', updateTheme);
  unsubscribeConfig = subscribeConfig(updateTheme);
  void nextTick(() => panel.value?.focus({preventScroll: true}));
});
onBeforeUnmount(() => {systemTheme?.removeEventListener('change', updateTheme); unsubscribeConfig?.();});
</script>
<style scoped>
.fr-reading {
  /* 内容脚本未装配扩展页面的 token/皮肤表；在面板内沿用共享语义值，避免继承宿主配色。 */
  --fr-color-brand: #ef4776; --fr-color-brand-strong: #dc315f; --fr-color-brand-soft: #fff0f4;
  --fr-color-ink: #172033; --fr-color-muted: #737c8f; --fr-color-line: #e5e8ef;
  --fr-color-surface: #fff; --fr-color-surface-soft: #f7f8fb;
  --fr-danger: #b1435e; --fr-danger-soft: #fff0f3;
  --fr-menu-shadow: 0 8px 28px rgba(27, 36, 57, .12), 0 2px 6px rgba(27, 36, 57, .04);
  position: fixed; right: 16px; bottom: 16px; width: 420px; max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 32px); overflow: auto; overscroll-behavior: contain;
  padding: 16px; border: 1px solid var(--fr-color-line); border-radius: 14px;
  background: var(--fr-color-surface); color: var(--fr-color-ink); box-shadow: var(--fr-menu-shadow);
  font: 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  overflow-wrap: anywhere; color-scheme: light; scrollbar-width: thin;
  scrollbar-color: var(--fr-color-muted) transparent;
}
.fr-reading.fr-dark-theme {
  --fr-color-brand-strong: #ffadc6; --fr-color-brand-soft: rgba(239, 71, 118, .16);
  --fr-color-ink: #f1f1f4; --fr-color-muted: #b4b4c0; --fr-color-line: #44444e;
  --fr-color-surface: #282830; --fr-color-surface-soft: #33333e;
  --fr-danger: #f1a7bc; --fr-danger-soft: #3c222b;
  --fr-menu-shadow: 0 10px 32px rgba(0, 0, 0, .28);
  color-scheme: dark;
}
header {display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 15px; line-height: 1.4;}
.fr-reading-heading {display: flex; align-items: center; gap: 8px; min-width: 0;}
.fr-reading-heading svg {flex: none; width: 27px; height: 27px; padding: 5px; border-radius: 8px; background: var(--fr-color-brand-soft); color: var(--fr-color-brand-strong);}
button {font: inherit; font-size: 12px; line-height: 1.4; font-weight: 600; cursor: pointer; color: var(--fr-color-ink); border: 1px solid var(--fr-color-line); border-radius: 8px; background: var(--fr-color-surface); padding: 7px 10px; transition: background .15s ease, border-color .15s ease;}
button:hover:not(:disabled) {border-color: var(--fr-color-brand-strong); background: var(--fr-color-brand-soft);}
button:focus-visible, summary:focus-visible {outline: 2px solid var(--fr-color-brand-strong); outline-offset: 2px;}
button:disabled {opacity: .48; cursor: default;}
header button {flex: none; width: 28px; height: 28px; padding: 0; border-color: transparent; background: transparent; color: var(--fr-color-muted); font-size: 20px; font-weight: 400; line-height: 1;}
.fr-reading-intro, .fr-reading-note, .fr-reading-empty {font-size: 12px; color: var(--fr-color-muted); margin: 10px 0;}
.fr-reading-help {margin: 10px 0; font-size: 12px; color: var(--fr-color-muted);}
summary {cursor: pointer; border-radius: 4px;}
summary::marker {color: var(--fr-color-muted);}
.fr-reading-help p {margin: 6px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--fr-color-surface-soft);}
.fr-reading-use {width: 100%; min-height: 34px; background: var(--fr-color-surface-soft);}
.fr-reading-modes {display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 12px 0;}
.fr-reading-modes button {min-height: 34px; background: var(--fr-color-surface-soft);}
.fr-reading-modes button[aria-pressed=true] {border-color: var(--fr-color-brand-strong); background: var(--fr-color-brand-soft); color: var(--fr-color-brand-strong);}
.fr-reading-body {border-top: 1px solid var(--fr-color-line); padding-top: 12px;}
.fr-reading-label {font-size: 11px; color: var(--fr-color-muted); font-weight: 650;}
.fr-reading-source, .fr-reading-answer {white-space: pre-wrap; user-select: text; margin: 6px 0 14px;}
.fr-reading-answer {background: var(--fr-color-surface-soft); border-radius: 9px; padding: 10px 12px;}
.fr-reading-hints {list-style: none; padding: 0; margin: 8px 0;}
.fr-reading-hints li {border-top: 1px solid var(--fr-color-line); padding: 10px 0; display: flex; align-items: flex-start; gap: 6px; flex-direction: column;}
.fr-reading-hints span {font-size: 13px;}
.fr-reading-hints small, small {font-size: 11px; color: var(--fr-color-muted);}
.fr-reading-hints button, .fr-reading-known button {padding: 4px 8px; color: var(--fr-color-brand-strong); background: var(--fr-color-brand-soft);}
.fr-reading-known {display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;}
.fr-reading-clues li {padding: 7px 0;}
.fr-reading-clues details {width: 100%;}
.fr-reading-clues summary {font-size: 13px;}
.fr-reading-clues strong {margin-inline-end: 10px;}
.fr-reading-clues span {font-size: 12px; color: var(--fr-color-muted);}
.fr-reading-clues p {margin: 6px 0 0; color: var(--fr-color-muted); font-size: 12px;}
.fr-reading-error {color: var(--fr-danger); background: var(--fr-danger-soft); border-radius: 8px; padding: 8px 10px; font-size: 12px;}
footer {border-top: 1px solid var(--fr-color-line); padding-top: 12px; display: flex; gap: 10px; align-items: center;}
footer button {flex: none; border-color: #dc315f; background: #dc315f; color: #fff;}
footer button:hover:not(:disabled) {border-color: #c32753; background: #c32753;}
footer span {font-size: 11px; color: var(--fr-color-muted);}
@media (max-width: 480px) {.fr-reading {right: 12px; bottom: 12px; padding: 14px; max-height: 60dvh;} footer {align-items: flex-start;}}
@media (prefers-reduced-motion: reduce) {button {transition: none;}}
</style>

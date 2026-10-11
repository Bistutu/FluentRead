<!--
 * @file src/features/progressive-reading/ui/ProgressiveReading.vue
 * 文件职责：呈现主动选文后的渐进阅读面板，让读者随时切换原文、短语、逻辑线索和完整双语。
 * 主要内容：可键盘操作的四档按钮、常驻完整双语动作、可恢复的熟悉提示与定向表达查询；窄屏面板限制高度并允许关闭，文字采用 Vue 安全纯文本渲染。
 * 模块边界：只消费阅读会话状态和操作 props，不读取网页、发起网络请求或更新掌握状态；不覆盖宿主链接、选区和原文。
 -->
<template>
  <section v-if="state.open" ref="panel" v-ui-i18n class="fr-reading" role="region" aria-label="渐进阅读" tabindex="-1" @keydown.esc.stop="close">
    <header><strong>渐进阅读</strong><button data-reading-close type="button" aria-label="关闭渐进阅读" @click="close">×</button></header>
    <p class="fr-reading-intro">选中网页正文后读取；原页面仍可阅读、复制和点击链接。</p>
    <button data-reading-use-selection class="fr-reading-use" type="button" @pointerdown.prevent @click="useSelection">读取选中的正文</button>
    <div class="fr-reading-modes" role="group" aria-label="帮助强度">
      <button v-for="mode in modes" :key="mode.id" :data-reading-mode="mode.id" type="button" :aria-pressed="state.mode === mode.id" :disabled="!state.source" @click="assistance(mode.id)">{{ mode.label }}</button>
    </div>
    <p v-if="!state.source && !state.error" class="fr-reading-empty">先在网页中选择一个词、短语或段落，再点击“读取选中的正文”。</p>
    <div v-if="state.source" class="fr-reading-body">
      <div class="fr-reading-label">原文</div><p data-reading-source class="fr-reading-source">{{ state.source }}</p>
      <template v-if="state.mode === 'phrases'">
        <p class="fr-reading-note">本地释义与收藏参考可能不适用于当前义项。表达译文受所用服务的语境能力影响；有歧义可查看完整双语。</p>
        <p v-if="hiddenCount" data-reading-hidden-hints class="fr-reading-note">已收起 {{ hiddenCount }} 条同语境的明确掌握提示。<button data-reading-show-known type="button" :aria-pressed="state.showKnown" @click="state.showKnown = !state.showKnown">{{ state.showKnown ? '收起熟悉提示' : '仍需要帮助' }}</button></p>
        <ul class="fr-reading-hints"><li v-for="hint in visibleHints" :key="`${hint.start}:${hint.end}`" data-reading-phrase :data-reading-term="hint.term">
          <strong>{{ hint.term }}</strong><span v-if="hint.reference">{{ hint.reference }} <small>{{ hint.saved ? '收藏参考' : '本地释义' }}</small></span>
          <button type="button" @click="assistance('phrases', hint)">翻译这个表达</button>
        </li></ul>
        <p v-if="!visibleHints.length" class="fr-reading-note">没有匹配到可展示的表达。可重新选择卡住的词或短语，也可直接查看完整双语。</p>
        <p v-if="state.hintError" role="status">{{ state.hintError }}</p>
        <p v-if="state.phraseLoading" role="status">正在查询 {{ state.phraseTerm }}…</p>
        <p v-if="state.phraseAnswer" data-reading-phrase-answer class="fr-reading-answer"><strong>{{ state.phraseTerm }}</strong> · {{ state.phraseAnswer }}</p>
      </template>
      <template v-if="state.mode === 'logic'">
        <p class="fr-reading-note">以下仅是原文中的词面线索，不是完整句法或理解分析。</p>
        <ul class="fr-reading-hints"><li v-for="clue in state.clues" :key="`${clue.label}:${clue.start}`" data-reading-logic><strong>{{ clue.term }} · {{ clue.label }}</strong><span>{{ clue.detail }}</span></li></ul>
        <p v-if="!state.clues.length" class="fr-reading-note">未发现当前规则能明确标出的线索；不代表原文没有条件或歧义。</p>
      </template>
      <template v-if="state.mode === 'bilingual'">
        <div class="fr-reading-label">完整译文 <small>{{ state.translationOrigin }}</small></div>
        <p v-if="state.loading" role="status">正在读取完整译文…</p>
        <p v-if="state.translation" data-reading-translation class="fr-reading-answer">{{ state.translation }}</p>
      </template>
    </div>
    <p v-if="state.error" class="fr-reading-error" role="alert">{{ state.error }}</p>
    <footer v-if="state.source"><button data-reading-full type="button" :disabled="state.loading" @click="assistance('bilingual')">{{ state.error && state.mode === 'bilingual' ? '重试完整双语' : '完整双语' }}</button><span>无需先标记掌握或逐级查看</span></footer>
  </section>
</template>
<script setup lang="ts">
import {computed, nextTick, onMounted, ref} from 'vue';
import type {ReadingState} from '../session';
import type {PhraseHint, ReadingMode} from '../hints';
const props = defineProps<{state: ReadingState; close(): void; useSelection(): void; assistance(mode: ReadingMode, phrase?: PhraseHint): void}>();
const panel = ref<HTMLElement>();
const modes: Array<{id: ReadingMode; label: string}> = [{id: 'original', label: '只读原文'}, {id: 'phrases', label: '短语提示'}, {id: 'logic', label: '逻辑线索'}, {id: 'bilingual', label: '完整双语'}];
const hiddenCount = computed(() => props.state.phrases.filter(hint => hint.hidden).length);
const visibleHints = computed(() => props.state.phrases.filter(hint => !hint.hidden || props.state.showKnown));
onMounted(() => {void nextTick(() => panel.value?.focus({preventScroll: true}));});
</script>
<style scoped>
.fr-reading{position:fixed;right:16px;bottom:16px;width:420px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 32px);overflow:auto;padding:18px;border:1px solid #e3ddd3;border-radius:18px;background:#fffdf8;color:#302e2b;box-shadow:0 8px 36px #221c1829;font:14px/1.65 system-ui,sans-serif;overflow-wrap:anywhere;color-scheme:light;}
header{display:flex;align-items:center;justify-content:space-between;font-size:17px}button{font:inherit;cursor:pointer;color:inherit;border:1px solid #d7d0c4;border-radius:8px;background:#fff;padding:6px 10px}button:focus-visible{outline:3px solid #98723c;outline-offset:2px}button:disabled{opacity:.5;cursor:default}header button{font-size:22px;line-height:1;padding:5px 9px}.fr-reading-intro,.fr-reading-note,.fr-reading-empty{font-size:12px;color:#665f55;margin:10px 0}.fr-reading-use{width:100%;background:#f7f0e3}.fr-reading-modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:14px 0}.fr-reading-modes button[aria-pressed=true]{background:#58482f;color:white;border-color:#58482f}.fr-reading-body{border-top:1px solid #e8e1d6;padding-top:10px}.fr-reading-label{font-size:12px;color:#756545;font-weight:650}.fr-reading-source,.fr-reading-answer{white-space:pre-wrap;user-select:text;margin:6px 0 16px}.fr-reading-answer{background:#f1eadb;border-radius:10px;padding:10px}.fr-reading-hints{list-style:none;padding:0;margin:8px 0}.fr-reading-hints li{border-top:1px solid #ece6db;padding:10px 0;display:flex;align-items:flex-start;gap:6px;flex-direction:column}.fr-reading-hints span{font-size:13px}.fr-reading-hints small,small{font-size:11px;color:#736652}.fr-reading-error{color:#a13232}footer{border-top:1px solid #e8e1d6;padding-top:12px;display:flex;gap:10px;align-items:center}footer button{background:#58482f;color:white}footer span{font-size:11px;color:#756b5c}@media(max-width:480px){.fr-reading{right:12px;bottom:12px;padding:14px;max-height:60dvh}footer{align-items:flex-start}}
</style>

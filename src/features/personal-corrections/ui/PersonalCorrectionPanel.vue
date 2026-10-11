<!--
 * @file src/features/personal-corrections/ui/PersonalCorrectionPanel.vue
 * 文件职责：呈现网页原译文对的主动校订、明确范围预览与个人译法管理。
 * 主要内容：在封闭 Shadow UI 内提供可编辑译文、精确命中预览、近似句差异、项目范围、保存、撤销与删除；实现键盘焦点约束与响应式浅深色布局。
 * 模块边界：不读取网页历史或存储、不请求翻译服务；动作交给校订控制器，原文和译文始终以纯文本呈现。
 -->
<template>
  <div class="correction-ui" :class="{dark}" :style="{'--accent': accent}">
    <button v-if="state.candidate && !state.open" class="correction-entry" data-testid="correction-entry" type="button" @click="controller.open(state.candidate)">
      校订译文 <span>Alt ⇧ E</span>
    </button>
    <section v-if="state.open" ref="panel" class="correction-panel" role="dialog" aria-modal="true" aria-labelledby="correction-title" data-testid="correction-dialog" @keydown="keydown">
      <header><h2 id="correction-title">{{ state.managing ? '个人校订记忆' : '校订译文' }}</h2><button data-testid="correction-close" type="button" :disabled="state.busy" aria-label="关闭校订" @click="controller.close">×</button></header>
      <nav class="tabs" aria-label="校订视图"><button type="button" :aria-pressed="!state.managing" :disabled="state.busy" @click="state.managing = false">当前校订</button><button data-testid="correction-manage" type="button" :aria-pressed="state.managing" :disabled="state.busy" @click="state.managing = true">管理已保存译法 <span>{{ state.entries.length }}</span></button></nav>
      <div class="panel-body">
        <p v-if="state.loading" role="status" class="hint">正在读取个人校订…</p>
        <template v-if="!state.managing">
          <div class="language-row" data-i18n-ignore>{{ state.sourceLanguage }} → {{ state.targetLanguage }}</div>
          <h3>原文</h3><blockquote class="source" data-testid="correction-source" data-i18n-ignore>{{ state.source }}</blockquote>
          <label class="translation-label" for="correction-translation">确认采用的译文</label>
          <textarea id="correction-translation" ref="translationInput" data-testid="correction-translation" :value="state.draft" :disabled="state.busy" maxlength="20000" rows="4" data-i18n-ignore @input="controller.setDraft(($event.target as HTMLTextAreaElement).value)" />
          <div class="scope-row"><label for="correction-scope">保存范围</label><select id="correction-scope" data-testid="correction-scope" :value="state.scopeId" :disabled="state.busy" @change="controller.setScope(($event.target as HTMLSelectElement).value)"><option value="material">本材料</option><option v-for="project in state.projects" :key="project.id" :value="project.id" data-i18n-ignore>项目：{{ project.label }}</option></select></div>
          <button v-if="state.scopeId !== 'material' && state.activeProjectId !== state.scopeId" type="button" data-testid="correction-project-join" :disabled="state.busy" @click="controller.activateProject(state.scopeId)">将本材料加入此项目，采用已有校订</button>
          <p v-if="state.activeProjectId" class="hint">本材料已加入项目：<span data-i18n-ignore>{{ state.projects.find(project => project.id === state.activeProjectId)?.label }}</span> <button type="button" data-testid="correction-project-leave" :disabled="state.busy" @click="controller.activateProject(null)">移出项目</button></p>
          <details class="new-project"><summary>新建轻量项目范围</summary><div><input v-model="state.projectName" data-testid="correction-project-name" :disabled="state.busy" maxlength="80" aria-label="项目名称" placeholder="例如：某篇论文及补充材料"><button type="button" data-testid="correction-project-create" :disabled="state.busy" @click="controller.createProject">创建</button></div></details>
          <p class="hint scope-hint">本材料仅复用在当前材料。项目译法须先主动加入项目；其他材料也须主动选择同一项目。跨范围不自动覆盖。</p>
          <details class="context"><summary>语境与语言隔离</summary><p class="hint">同一句在不同指代或章节中可能有不同含义，只在相同源语言、目标语言与语境下复用。</p><blockquote data-i18n-ignore>{{ state.context || '当前材料的默认语境' }}</blockquote></details>
          <div v-if="state.conflicts.length" class="conflict"><h3>存在不同的已确认译法</h3><p class="hint">暂不自动复用。可选择已有译法编辑，或到管理中删除不再使用的译法。</p><button v-for="record in state.conflicts" :key="record.id" type="button" @click="controller.edit(record)"><span data-i18n-ignore>{{ record.translation }}</span><small data-i18n-ignore>{{ record.scope.label }}</small></button></div>
          <details v-if="state.suggestions.length" class="suggestions"><summary>相近原句的参考译法（不会自动替换）</summary><article v-for="record in state.suggestions" :key="record.id"><div class="diff"><p><strong>记忆原句</strong><span data-i18n-ignore>{{ record.source }}</span></p><p><strong>当前原句</strong><span data-i18n-ignore>{{ state.source }}</span></p></div><p data-i18n-ignore>{{ record.translation }}</p><button type="button" :disabled="state.busy" @click="controller.suggest(record)">选作草稿，再预览确认</button></article></details>
          <div v-if="state.previewed" class="preview" data-testid="correction-preview-result"><h3>确认预览</h3><div class="comparison"><div><small>当前译文</small><p data-i18n-ignore>{{ state.currentTranslation }}</p></div><div><small>采用校订后</small><p data-i18n-ignore>{{ state.draft }}</p></div></div><p class="hint" data-testid="correction-affected-count">当前页 {{ state.affected.length }} 处相同原句；仅在没有冲突译法时采用校订。</p><details v-if="state.affected.length"><summary>受影响句子</summary><ol><li v-for="(pair, index) in state.affected" :key="index"><p data-i18n-ignore>{{ pair.source }}</p><small data-i18n-ignore>{{ pair.translation }}</small></li></ol></details><p v-if="state.scopeId !== 'material'" class="hint">项目内其他材料的同语境原句在再次翻译时复用。</p></div>
        </template>
        <template v-else>
          <p class="hint">仅记录你主动确认的原句与译法。删除或修改会立即使旧译法失效。</p>
          <p v-if="!state.entries.length && !state.loading" class="empty">尚未保存个人校订。</p>
          <article v-for="record in state.entries" :key="record.id" class="saved-entry" :data-correction-record="record.id"><div class="record-meta"><span data-i18n-ignore>{{ record.scope.kind === 'project' ? '项目：' : '材料：' }}{{ record.scope.label }}</span><small data-i18n-ignore>{{ record.sourceLanguage }} → {{ record.targetLanguage }}</small></div><p class="source" data-i18n-ignore>{{ record.source }}</p><p data-i18n-ignore>{{ record.translation }}</p><details v-if="record.context"><summary>保存语境</summary><p data-i18n-ignore>{{ record.context }}</p></details><p v-if="record.scope.kind === 'material' && record.scope.id !== state.materialId" class="hint">打开对应材料后可编辑。</p><div class="record-actions"><button type="button" :data-correction-edit="record.id" :disabled="state.busy || (record.scope.kind === 'material' && record.scope.id !== state.materialId)" @click="controller.edit(record)">编辑</button><button type="button" class="danger" :data-correction-delete="record.id" :disabled="state.busy" @click="controller.remove(record)">删除</button></div></article>
        </template>
        <p v-if="state.error" class="error" role="alert" data-testid="correction-error">{{ state.error }}</p>
        <p v-if="state.notice" class="notice" role="status" data-testid="correction-notice">{{ state.notice }}</p>
      </div>
      <footer><button v-if="state.undoToken" type="button" data-testid="correction-undo" :disabled="state.busy" @click="controller.undo">撤销上次操作</button><div v-if="!state.managing" class="save-actions"><button type="button" data-testid="correction-preview" :disabled="state.busy || state.loading || !state.draft.trim()" @click="controller.preview">预览受影响句子</button><button class="primary" type="button" data-testid="correction-save" :disabled="state.busy || state.loading || !state.previewed" @click="controller.save">{{ state.busy ? '保存中…' : '确认保存' }}</button></div></footer>
    </section>
  </div>
</template>
<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, watch} from 'vue';
import {config, subscribeConfig} from '@/src/services/config/store';
import {getInterfaceSkinOption} from '@/src/core/config/interfaceAppearance';
import type {PersonalCorrectionController} from '../controller';

const props = defineProps<{controller: PersonalCorrectionController}>();
const state = props.controller.state;
const panel = ref<HTMLElement>(); const translationInput = ref<HTMLTextAreaElement>();
const prefs = ref({theme: config.theme, interfaceSkin: config.interfaceSkin});
const media = window.matchMedia('(prefers-color-scheme: dark)'); const systemDark = ref(media.matches);
const mediaChanged = (event: MediaQueryListEvent) => {systemDark.value = event.matches;};
media.addEventListener('change', mediaChanged);
const stopConfig = subscribeConfig(value => {prefs.value = {theme: value.theme, interfaceSkin: value.interfaceSkin};});
const dark = computed(() => prefs.value.theme === 'dark' || (prefs.value.theme === 'auto' && systemDark.value));
const accent = computed(() => getInterfaceSkinOption(prefs.value.interfaceSkin).preview.accent);
let previousFocus: HTMLElement | null = null;
function restoreFocus(): void {if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true}); previousFocus = null;}
watch(() => state.open, async open => {
  if (!open) {restoreFocus(); return;}
  const focus = document.activeElement;
  previousFocus = focus instanceof HTMLElement ? focus : null;
  await nextTick();
  if (state.open) (translationInput.value ?? panel.value?.querySelector<HTMLButtonElement>('[data-testid="correction-manage"]'))?.focus({preventScroll: true});
}, {immediate: true});
watch(() => state.managing, async managing => {await nextTick(); if (state.open) (managing ? panel.value?.querySelector<HTMLButtonElement>('[data-correction-edit]:not([disabled])') ?? panel.value?.querySelector<HTMLButtonElement>('[data-testid="correction-manage"]') : translationInput.value)?.focus({preventScroll: true});});
function keydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); props.controller.close(); return;}
  if (event.key !== 'Tab') return;
  const controls = Array.from(panel.value?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled]), summary') ?? [])
    .filter(node => !node.closest('details:not([open])') || node.tagName === 'SUMMARY');
  if (!controls.length) return;
  const first = controls[0], last = controls[controls.length - 1]; const active = panel.value?.getRootNode() as ShadowRoot;
  const focus = active?.activeElement ?? document.activeElement;
  if (event.shiftKey && focus === first) {event.preventDefault(); last.focus();}
  else if (!event.shiftKey && focus === last) {event.preventDefault(); first.focus();}
}
onBeforeUnmount(() => {stopConfig(); media.removeEventListener('change', mediaChanged); restoreFocus();});
</script>
<style scoped>
.correction-ui{--accent:#438367;--text:#202b28;--muted:#607069;--surface:#fff;--soft:#f3f7f5;--line:#dae5df;--danger:#ac3434;color:var(--text);font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:normal;direction:ltr}
.dark{--text:#e9f0ec;--muted:#a9bbb2;--surface:#202925;--soft:#2a3630;--line:#415047;--danger:#ffaaaa}
button,input,textarea,select{font:inherit;color:inherit}button{cursor:pointer;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:7px 11px}button:hover{background:var(--soft)}button:disabled{cursor:default;opacity:.52}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.primary{background:var(--accent);border-color:var(--accent);color:#fff}.primary:hover{filter:brightness(.96);background:var(--accent)}
.correction-entry{position:fixed;right:18px;bottom:20px;background:var(--surface);box-shadow:0 4px 20px #0002;display:flex;gap:12px;align-items:center;border-color:var(--accent)}.correction-entry span{font-size:11px;color:var(--muted)}
.correction-panel{position:fixed;right:18px;bottom:18px;width:min(590px,calc(100vw - 36px));max-height:calc(100dvh - 36px);display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 48px #0003;overflow:hidden}header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px 8px;gap:12px}h2{margin:0;font-size:18px;line-height:1.4}header button{padding:1px 8px;font-size:22px;border:0;min-width:32px;min-height:32px}.tabs{display:flex;gap:6px;padding:0 18px 12px;border-bottom:1px solid var(--line)}.tabs button{font-size:13px}.tabs button[aria-pressed=true]{color:var(--accent);background:var(--soft);border-color:var(--accent)}.tabs span{margin-left:3px}.panel-body{overflow:auto;padding:16px 18px;overscroll-behavior:contain;min-height:0}h3{font-size:13px;margin:0 0 6px}.language-row{font-size:11px;color:var(--muted);margin-bottom:7px}p,blockquote{margin:0 0 10px;white-space:pre-wrap;overflow-wrap:anywhere}blockquote{border-left:3px solid var(--line);padding:8px 10px;background:var(--soft);border-radius:0 6px 6px 0}.source{color:var(--muted)}.translation-label{font-size:13px;font-weight:600;display:block;margin-top:14px}textarea,input,select{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:9px}textarea{width:100%;resize:vertical;min-height:100px;max-height:260px;margin-top:6px}input{min-width:0;flex:1}.scope-row{display:flex;gap:16px;align-items:center;margin:14px 0 7px}.scope-row label{font-size:13px;font-weight:600}.scope-row select{flex:1;min-width:0}.hint{font-size:12px;color:var(--muted)}.scope-hint{margin:8px 0 12px}.new-project{font-size:12px}.new-project>div{display:flex;gap:8px;margin:8px 0}summary{cursor:pointer;color:var(--muted)}details.context{margin:8px 0 14px;font-size:12px}.context blockquote{margin-top:8px}.conflict,.preview{margin-top:16px;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--soft)}.conflict button{display:flex;justify-content:space-between;text-align:left;gap:10px;width:100%;margin-top:5px}.conflict small{color:var(--muted)}.suggestions{margin:12px 0}.suggestions article{border-bottom:1px solid var(--line);padding:10px 0}.diff{display:grid;grid-template-columns:1fr 1fr;gap:8px}.diff strong{font-size:11px;color:var(--muted);display:block}.diff span{font-size:12px}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:12px}.comparison>div{min-width:0}.comparison small{color:var(--muted)}.comparison p{margin-top:5px}.preview ol{padding-left:20px;margin:8px 0}.preview li{margin-bottom:8px}.preview li p{margin-bottom:3px}.preview small{color:var(--muted)}.saved-entry{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px}.record-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--muted);margin-bottom:8px}.record-meta span{overflow-wrap:anywhere}.saved-entry details{font-size:12px}.record-actions{display:flex;justify-content:flex-end;gap:7px}.danger{color:var(--danger)}.error{color:var(--danger);margin-top:12px}.notice{color:var(--accent);font-size:12px;margin-top:12px}.empty{color:var(--muted)}footer{border-top:1px solid var(--line);padding:12px 18px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.save-actions{display:flex;gap:8px;margin-left:auto}
@media(max-width:480px){.correction-entry{right:12px;bottom:12px}.correction-panel{right:8px;bottom:8px;width:calc(100vw - 16px);max-height:calc(100dvh - 16px);border-radius:12px}header,.panel-body,footer{padding-left:14px;padding-right:14px}.tabs{padding-left:14px;padding-right:14px}.tabs button{font-size:12px}.comparison,.diff{grid-template-columns:1fr}.save-actions{width:100%;justify-content:flex-end}.record-meta{align-items:flex-start}.record-meta small{white-space:nowrap}}
</style>

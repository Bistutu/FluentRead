/**
 * @file src/features/personal-corrections/controller.ts
 * 文件职责：把主动校订、预览、范围确认和管理操作编排成可撤销的网页用户流程。
 * 主要内容：只在确认后保存，近似候选只进入草稿；保留语境和语言隔离，以版本检查阻止旧记录覆盖新修改，保存和删除后刷新可见译文。
 * 模块边界：通过 services 公共接口访问本地记忆，通过注入端口访问当前译文；不调用供应商、不操作请求队列，也不写入公共翻译缓存。
 */
import {shallowReactive} from 'vue';
import type {CorrectionQuery, PersonalCorrectionRecord, PersonalCorrectionState} from '@/src/core/personal-corrections/public';
import {personalCorrections} from '@/src/services/personal-corrections/public';
import type {PersonalCorrectionPair, PersonalCorrectionUiPorts} from './types';

export function createPersonalCorrectionController(ports: PersonalCorrectionUiPorts, isActive: () => boolean) {
  const service = ports.service ?? personalCorrections;
  const state = shallowReactive({
    candidate: null as PersonalCorrectionPair | null, pair: null as PersonalCorrectionPair | null,
    open: false, managing: false, busy: false, loading: false, error: '', notice: '',
    source: '', currentTranslation: '', draft: '', scopeId: 'material', context: '', sourceLanguage: '', targetLanguage: '',
    materialId: '', materialLabel: '', projectName: '', entries: [] as PersonalCorrectionRecord[], projects: [] as PersonalCorrectionState['projects'],
    suggestions: [] as PersonalCorrectionRecord[], conflicts: [] as PersonalCorrectionRecord[],
    affected: [] as PersonalCorrectionPair[], previewed: false, activeProjectId: '',
    editing: null as PersonalCorrectionRecord | null, undoToken: '',
  });
  let readGeneration = 0;
  const query = (): CorrectionQuery => ({source: state.source, sourceLanguage: state.sourceLanguage,
    targetLanguage: state.targetLanguage, context: state.context, materialId: state.materialId});
  function failure(error: unknown): void {state.error = error instanceof Error ? error.message : '校订暂时无法保存，请重试。';}
  function invalidate(): void {state.previewed = false; state.affected = []; state.error = ''; state.notice = '';}
  function setDraft(value: string): void {if (state.busy) return; state.draft = value; invalidate();}
  function setScope(value: string): void {if (state.busy) return; state.scopeId = value; state.editing = null; invalidate();}
  async function load(generation = readGeneration): Promise<void> {
    const [list, result] = await Promise.all([service.list(), service.lookup(query())]);
    if (!isActive() || generation !== readGeneration || !state.open) return;
    state.entries = list.entries; state.projects = list.projects; state.suggestions = result.suggestions; state.conflicts = result.conflicts;
    state.activeProjectId = list.memberships.find(item => item.materialId === state.materialId)?.projectId ?? '';
    if (!state.editing && result.exact && ((result.exact.scope.kind === 'material' && state.scopeId === 'material') || result.exact.scope.id === state.scopeId)) state.editing = result.exact;
  }
  async function open(pair: PersonalCorrectionPair): Promise<void> {
    if (!isActive() || state.busy) return;
    if (!pair.isCurrent()) {state.candidate = null; return;}
    const generation = ++readGeneration;
    state.pair = pair; state.candidate = pair; state.open = true; state.managing = false;
    state.source = pair.source; state.currentTranslation = pair.translation; state.draft = pair.translation;
    state.scopeId = 'material'; state.context = pair.context; state.sourceLanguage = pair.sourceLanguage;
    state.targetLanguage = pair.targetLanguage; state.materialId = pair.materialId; state.editing = null;
    state.materialLabel = typeof document !== 'undefined' && document.title.trim() ? document.title.trim().slice(0, 80) : '当前网页';
    state.suggestions = []; state.conflicts = []; state.projectName = ''; invalidate(); state.loading = true;
    try {await load(generation);} catch (error) {if (isActive() && generation === readGeneration) failure(error);}
    finally {if (isActive() && generation === readGeneration) state.loading = false;}
  }
  function close(): void {if (state.busy) return; readGeneration += 1; state.open = false; state.loading = false; state.pair = null;}
  function preview(): void {
    if (!isActive() || !state.open || state.busy) return;
    if (!state.draft.trim()) {state.error = '请填写确认采用的译文。'; return;}
    if (!state.materialId || (state.scopeId !== 'material' && !state.projects.some(item => item.id === state.scopeId))) {
      state.error = '请选择“仅当前网页”或一个项目。'; return;
    }
    if (state.scopeId !== 'material' && state.activeProjectId !== state.scopeId) {state.error = '请先将当前网页加入所选项目，再预览保存。'; return;}
    state.affected = ports.listVisiblePairs(query()).filter(pair => pair.isCurrent());
    state.previewed = true; state.error = ''; state.notice = '';
  }
  async function mutate(action: () => Promise<void>): Promise<void> {
    if (!isActive() || state.busy) return;
    state.busy = true; state.error = '';
    try {await action();} catch (error) {if (isActive()) failure(error);}
    finally {if (isActive()) state.busy = false;}
  }
  async function syncVisible(): Promise<void> {
    await ports.refreshVisible();
    if (!isActive()) return;
    const visible = ports.listVisiblePairs(query()).find(pair => pair.isCurrent());
    if (visible) {state.currentTranslation = visible.translation; state.candidate = visible; if (state.pair) state.pair = visible;}
  }
  async function save(): Promise<void> {
    if (!state.previewed || !state.draft.trim()) return;
    const input = {source: state.source, translation: state.draft, sourceLanguage: state.sourceLanguage,
      targetLanguage: state.targetLanguage, context: state.context,
      scope: state.scopeId === 'material' ? {kind: 'material' as const, id: state.materialId, label: state.materialLabel}
        : {kind: 'project' as const, id: state.scopeId, label: state.projects.find(item => item.id === state.scopeId)!.label},
      ...(state.editing ? {id: state.editing.id, expectedRevision: state.editing.revision} : {})};
    const page = state.pair;
    await mutate(async () => {
      if (page && !page.isCurrent()) throw new Error('原文已变化，请关闭后重新选择要校订的译文。');
      const result = await service.save(input);
      if (!isActive()) return;
      state.undoToken = result.undoToken; state.editing = result.record; state.previewed = false;
      await syncVisible();
      if (!isActive()) return;
      state.notice = '已保存';
      await load();
      if (isActive() && state.conflicts.length) state.notice = '已保存，但这个原句有不同译法，不会自动采用。请在“已保存的校订”中编辑或删除不再使用的译法。';
    });
  }
  async function undo(): Promise<void> {
    const token = state.undoToken;
    if (!token) return;
    await mutate(async () => {
      await service.undo(token);
      if (!isActive()) return;
      state.undoToken = ''; state.editing = null; state.previewed = false; await syncVisible();
      if (!isActive()) return;
      state.notice = '已撤销，上次保存或删除的译法已恢复。'; await load();
    });
  }
  async function remove(record: PersonalCorrectionRecord): Promise<void> {
    await mutate(async () => {
      const result = await service.remove(record.id, record.revision);
      if (!isActive()) return;
      state.undoToken = result.undoToken;
      if (state.editing?.id === record.id) state.editing = null;
      state.previewed = false; await syncVisible();
      if (!isActive()) return;
      state.notice = '已删除，之后的翻译不再使用这条校订。'; await load();
    });
  }
  function edit(record: PersonalCorrectionRecord): void {
    if (state.busy) return;
    if (record.scope.kind === 'material' && record.scope.id !== state.materialId) {state.error = '请打开对应网页后编辑这条校订。'; return;}
    state.source = record.source; state.currentTranslation = record.translation; state.draft = record.translation;
    state.context = record.context; state.sourceLanguage = record.sourceLanguage; state.targetLanguage = record.targetLanguage;
    state.scopeId = record.scope.kind === 'material' ? 'material' : record.scope.id;
    if (record.scope.kind === 'material') {state.materialId = record.scope.id; state.materialLabel = record.scope.label;}
    state.editing = record; state.managing = false; state.pair = null; state.suggestions = []; state.conflicts = []; invalidate();
  }
  function suggest(record: PersonalCorrectionRecord): void {
    if (state.busy) return;
    state.draft = record.translation; state.editing = null; invalidate();
  }
  async function createProject(): Promise<void> {
    if (!state.projectName.trim()) {state.error = '请输入项目名称。'; return;}
    const name = state.projectName;
    await mutate(async () => {
      const project = await service.createProject(name);
      if (!isActive()) return;
      state.scopeId = project.id; state.projectName = ''; state.editing = null; invalidate(); await load();
    });
  }
  async function activateProject(projectId: string | null): Promise<void> {
    const materialId = state.materialId;
    await mutate(async () => {
      await service.selectProject(materialId, projectId);
      if (!isActive()) return;
      invalidate(); state.editing = null; await syncVisible();
      if (!isActive()) return;
      state.notice = projectId ? '已加入项目' : '已退出项目';
      await load();
    });
  }
  return {state, open, close, setDraft, setScope, preview, save, undo, remove, edit, suggest, createProject,
    activateProject,
    dispose() {readGeneration += 1; state.open = false; state.candidate = null;},
  };
}

export type PersonalCorrectionController = ReturnType<typeof createPersonalCorrectionController>;

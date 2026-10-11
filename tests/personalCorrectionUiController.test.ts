/**
 * @file tests/personalCorrectionUiController.test.ts
 * 文件职责：验证主动网页校订的草稿、范围确认、管理和撤销编排。
 * 主要内容：保存门禁、近似候选只做草稿、精确预览、语言语境保留、项目显式加入、旧版本失败与卸载迟到响应。
 * 模块边界：仅替换个人持久化和网页端口；不把确定性测试视为真实网页布局或供应商验证。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createPersonalCorrectionController} from '@/src/features/personal-corrections/controller';
import type {PersonalCorrectionPair} from '@/src/features/personal-corrections/types';
import type {PersonalCorrectionRecord, PersonalCorrectionState} from '@/src/core/personal-corrections/public';

vi.mock('@/src/services/personal-corrections/public', () => ({personalCorrections: {}}));
const materialId = 'material-' + 'a'.repeat(64), otherMaterial = 'material-' + 'b'.repeat(64);
const id = '00000000-0000-4000-8000-000000000001', projectId = '00000000-0000-4000-8000-000000000002';
function deferred<T>() {let resolve!: (value: T) => void, reject!: (error: unknown) => void;const promise = new Promise<T>((a,b) => {resolve=a;reject=b;});return {promise,resolve,reject};}
function record(patch: Partial<PersonalCorrectionRecord> = {}): PersonalCorrectionRecord {return {id, scope: {kind: 'material', id: materialId, label: '材料 A'}, source: 'He opened the bank.', translation: '他开设了银行。', sourceLanguage: 'en', targetLanguage: 'zh-CN', context: 'Finance', revision: 1, ...patch};}
function fixture() {
  let active = true, current = true;
  const list: PersonalCorrectionState = {version:1,revision:1,entries:[],projects:[{id:projectId,label:'研究'}],memberships:[]};
  const pair: PersonalCorrectionPair = {source:'He opened the bank.',translation:'他打开了河岸。',sourceLanguage:'en',targetLanguage:'zh-CN',context:'Finance',materialId,apply:vi.fn(()=>true),isCurrent:()=>current};
  const lookup = {exact: undefined as PersonalCorrectionRecord | undefined,suggestions: [] as PersonalCorrectionRecord[],conflicts:[] as PersonalCorrectionRecord[]};
  const service = {list:vi.fn(async()=>list),lookup:vi.fn(async()=>lookup),save:vi.fn(async (input: any)=>{const saved=record({...input,revision:2});list.entries=[saved];lookup.exact=saved;return {record:saved,undoToken:'undo-save'};}),
    remove:vi.fn(async()=>{list.entries=[];lookup.exact=undefined;return {undoToken:'undo-delete'};}),undo:vi.fn(async()=>{list.entries=[];lookup.exact=undefined;}),
    createProject:vi.fn(async(label:string)=>{const project={id:projectId,label};list.projects=[project];return project;}),
    selectProject:vi.fn(async(mid:string,pid:string|null)=>{list.memberships=pid?[{materialId:mid,projectId:pid}]:[];}),subscribe:vi.fn(()=>()=>{})};
  const visible = vi.fn(()=>[pair,{...pair,isCurrent:()=>false}]);const refresh=vi.fn(async()=>{});
  const ports={readPair:vi.fn(()=>pair),listVisiblePairs:visible,refreshVisible:refresh,service:service as any};
  const controller=createPersonalCorrectionController(ports,()=>active);
  return {controller,state:controller.state,pair,list,lookup,service,visible,refresh,setActive:(value:boolean)=>{active=value;},setCurrent:(value:boolean)=>{current=value;}};
}
afterEach(()=>vi.unstubAllGlobals());
describe('webpage personal correction workflow',()=>{
  it('requires edited content preview and explicit confirmation, preserving source language and read-only context',async()=>{
    const f=fixture();vi.stubGlobal('document',{title:'  Finance article  '});await f.controller.open(f.pair);
    expect(f.state.scopeId).toBe('material');expect(f.service.save).not.toHaveBeenCalled();await f.controller.save();expect(f.service.save).not.toHaveBeenCalled();
    f.controller.setDraft('他开设了银行。');f.controller.preview();expect(f.state.affected).toHaveLength(1);expect(f.visible).toHaveBeenCalledWith({source:f.pair.source,sourceLanguage:'en',targetLanguage:'zh-CN',context:'Finance',materialId});
    await f.controller.save();expect(f.service.save).toHaveBeenCalledWith({source:f.pair.source,translation:'他开设了银行。',sourceLanguage:'en',targetLanguage:'zh-CN',context:'Finance',scope:{kind:'material',id:materialId,label:'Finance article'}});
    expect(f.refresh).toHaveBeenCalledTimes(1);expect(f.state.undoToken).toBe('undo-save');expect(f.state.notice).toBe('已保存');expect(f.state.previewed).toBe(false);
    await f.controller.undo();expect(f.service.undo).toHaveBeenCalledWith('undo-save');expect(f.state.undoToken).toBe('');expect(f.state.notice).toContain('已撤销');await f.controller.undo();expect(f.service.undo).toHaveBeenCalledTimes(1);
  });
  it('resets default scope each time, makes approximate suggestions reviewable drafts and invalidates preview after changes',async()=>{
    const f=fixture();f.lookup.suggestions=[record({source:'He closed the bank.'})];await f.controller.open(f.pair);expect(f.state.suggestions).toHaveLength(1);expect(f.state.draft).toBe(f.pair.translation);
    f.controller.preview();f.controller.suggest(f.lookup.suggestions[0]);expect(f.state.draft).toBe('他开设了银行。');expect(f.state.previewed).toBe(false);expect(f.service.save).not.toHaveBeenCalled();
    f.controller.preview();f.controller.setDraft('另一个草稿');expect(f.state.previewed).toBe(false);f.controller.setScope(projectId);expect(f.state.editing).toBeNull();
    f.controller.preview();expect(f.state.error).toContain('先将当前网页加入');await f.controller.activateProject(projectId);expect(f.service.selectProject).toHaveBeenCalledWith(materialId,projectId);expect(f.state.notice).toBe('已加入项目');
    f.controller.preview();await f.controller.save();expect(f.service.save.mock.calls[0][0].scope).toEqual({kind:'project',id:projectId,label:'研究'});expect(f.service.selectProject).toHaveBeenCalledTimes(1);
    f.controller.close();await f.controller.open(f.pair);expect(f.state.scopeId).toBe('material');await f.controller.activateProject(null);expect(f.state.activeProjectId).toBe('');expect(f.state.notice).toBe('已退出项目');
  });
  it('edits saved versions, refuses other-material editing, shows conflicts and deletes with reversible invalidation',async()=>{
    const f=fixture(),saved=record();f.list.entries=[saved];f.lookup.exact=saved;f.lookup.conflicts=[record({id:projectId,translation:'他打开了银行。'})];await f.controller.open(f.pair);
    expect(f.state.editing).toEqual(saved);expect(f.state.conflicts).toHaveLength(1);f.controller.edit(record({scope:{kind:'material',id:otherMaterial,label:'材料 B'}}));expect(f.state.error).toContain('对应网页');
    f.controller.edit(saved);expect(f.state.pair).toBeNull();expect(f.state.materialLabel).toBe('材料 A');f.controller.setDraft('新译文');f.controller.preview();await f.controller.save();
    expect(f.service.save.mock.calls[0][0]).toMatchObject({id,expectedRevision:1,translation:'新译文',scope:{label:'材料 A'}});
    expect(f.state.notice).toContain('不会自动采用');
    await f.controller.remove(f.state.editing!);expect(f.service.remove).toHaveBeenCalledWith(id,2);expect(f.state.entries).toHaveLength(0);expect(f.state.undoToken).toBe('undo-delete');expect(f.state.notice).toContain('已删除');
    const project=record({scope:{kind:'project',id:projectId,label:'研究'}});f.controller.edit(project);expect(f.state.scopeId).toBe(projectId);expect(f.state.materialId).toBe(materialId);
  });
  it('creates only explicitly named projects and keeps malformed or empty drafts away from save',async()=>{
    const f=fixture();await f.controller.open(f.pair);await f.controller.createProject();expect(f.service.createProject).not.toHaveBeenCalled();expect(f.state.error).toContain('项目名称');
    f.state.projectName='跨页论文';await f.controller.createProject();expect(f.service.createProject).toHaveBeenCalledWith('跨页论文');expect(f.state.scopeId).toBe(projectId);expect(f.service.selectProject).not.toHaveBeenCalled();
    f.controller.setScope('missing');f.controller.preview();expect(f.state.error).toContain('请选择');f.controller.setScope('material');f.controller.setDraft('   ');f.controller.preview();await f.controller.save();expect(f.service.save).not.toHaveBeenCalled();
    expect(f.state.error).toContain('填写');f.state.materialId='';f.controller.setDraft('有效译文');f.controller.preview();expect(f.state.error).toContain('请选择');
  });
  it('blocks repeat commands during persistence and refuses a changed webpage source',async()=>{
    const f=fixture();await f.controller.open(f.pair);f.controller.setDraft('新译文');f.controller.preview();f.setCurrent(false);await f.controller.save();expect(f.service.save).not.toHaveBeenCalled();expect(f.state.error).toContain('原文已变化');
    f.setCurrent(true);const pending=deferred<any>();f.service.save.mockReturnValueOnce(pending.promise);const task=f.controller.save();expect(f.state.busy).toBe(true);
    f.controller.close();f.controller.setDraft('忽略');f.controller.setScope(projectId);f.controller.edit(record());f.controller.suggest(record());f.controller.preview();await f.controller.save();await f.controller.remove(record());await f.controller.activateProject(null);await f.controller.createProject();await f.controller.open(f.pair);
    expect(f.state.open).toBe(true);expect(f.state.draft).toBe('新译文');expect(f.state.scopeId).toBe('material');expect(f.service.save).toHaveBeenCalledTimes(1);
    pending.resolve({record:record(),undoToken:'token'});await task;expect(f.state.busy).toBe(false);
    f.controller.close();f.setCurrent(false);await f.controller.open(f.pair);expect(f.state.candidate).toBeNull();
  });
  it('keeps mutation/read failures visible for retry and does not overwrite state after close or disposal',async()=>{
    const f=fixture();f.service.list.mockRejectedValueOnce(new Error('存储读取失败'));await f.controller.open(f.pair);expect(f.state.error).toBe('存储读取失败');expect(f.state.loading).toBe(false);
    await f.controller.open(f.pair);f.controller.setDraft('新译文');f.controller.preview();f.service.save.mockRejectedValueOnce('unavailable');await f.controller.save();expect(f.state.error).toContain('重试');
    f.service.save.mockRejectedValueOnce(new Error('校订版本已更新'));await f.controller.save();expect(f.state.error).toContain('版本');
    const read=deferred<PersonalCorrectionState>();f.service.list.mockReturnValueOnce(read.promise);const loading=f.controller.open(f.pair);f.controller.close();read.resolve(f.list);await loading;expect(f.state.open).toBe(false);expect(f.state.loading).toBe(false);
    const rejected=deferred<PersonalCorrectionState>();f.service.list.mockReturnValueOnce(rejected.promise);const old=f.controller.open(f.pair);await f.controller.open({...f.pair,source:'A new sentence'});rejected.reject(new Error('old'));await old;expect(f.state.error).toBe('');
    const pending=deferred<any>();f.controller.setDraft('修改');f.controller.preview();f.service.save.mockReturnValueOnce(pending.promise);const writing=f.controller.save();f.setActive(false);f.controller.dispose();pending.resolve({record:record(),undoToken:'late'});await writing;expect(f.state.undoToken).toBe('');expect(f.refresh).not.toHaveBeenCalled();
    await f.controller.open(f.pair);f.controller.preview();expect(f.state.open).toBe(false);
  });
  it('ignores late mutation work after every asynchronous boundary',async()=>{
    for (const action of ['save','undo','remove','createProject','activateProject'] as const) {
      const f=fixture();await f.controller.open(f.pair);f.controller.setDraft('校订');f.controller.preview();f.state.undoToken='token';f.state.projectName='name';
      const pending=deferred<any>();const method=action==='activateProject'?'selectProject':action;f.service[method].mockReturnValueOnce(pending.promise);
      const task=action==='remove'?f.controller.remove(record()):action==='activateProject'?f.controller.activateProject(projectId):f.controller[action]();
      f.setActive(false);pending.resolve(action==='save'?{record:record(),undoToken:'new'}:action==='remove'?{undoToken:'new'}:action==='createProject'?{id:projectId,label:'name'}:undefined);await task;
      expect(f.refresh).not.toHaveBeenCalled();expect(f.state.undoToken).toBe('token');
    }
    for(const action of ['save','undo','remove','activateProject'] as const){
      const f=fixture();await f.controller.open(f.pair);f.controller.setDraft('校订');f.controller.preview();f.state.undoToken='token';
      const pending=deferred<void>();f.refresh.mockReturnValueOnce(pending.promise);const task=action==='remove'?f.controller.remove(record()):action==='activateProject'?f.controller.activateProject(null):f.controller[action]();
      for(let i=0;i<6;i++)await Promise.resolve();f.setActive(false);pending.resolve();await task;expect(f.state.notice).toBe('');
    }
    const f=fixture();await f.controller.open(f.pair);f.controller.preview();const pending=deferred<any>();f.service.save.mockReturnValueOnce(pending.promise);const task=f.controller.save();f.setActive(false);pending.reject(new Error('late'));await task;expect(f.state.error).toBe('');
  });
  it('refreshes current candidates after page updates, tolerates zero affected sentences and loads chosen project versions',async()=>{
    const f=fixture();vi.stubGlobal('document',{title:' '.repeat(2)});await f.controller.open(f.pair);expect(f.state.materialLabel).toBe('当前网页');
    const fresh={...f.pair,translation:'来自更新的页面'};f.visible.mockReturnValue([{...f.pair,isCurrent:()=>false},fresh]);f.controller.setDraft('新的确认译文');f.controller.preview();await f.controller.save();expect(f.state.candidate).toBe(fresh);expect(f.state.pair).toBe(fresh);expect(f.state.currentTranslation).toBe(fresh.translation);
    f.visible.mockReturnValue([]);await f.controller.remove(record({id:projectId}));expect(f.state.affected).toHaveLength(1);expect(f.state.currentTranslation).toBe(fresh.translation);
    f.lookup.exact=record({scope:{kind:'project',id:projectId,label:'研究'}});await f.controller.open(f.pair);expect(f.state.editing).toBeNull();f.controller.setScope(projectId);await f.controller.activateProject(projectId);expect(f.state.editing?.scope.kind).toBe('project');
    f.controller.setScope('material');await f.controller.activateProject(null);expect(f.state.editing).toBeNull();
    const inactive=createPersonalCorrectionController({readPair:vi.fn(),listVisiblePairs:vi.fn(),refreshVisible:vi.fn()},()=>false);await inactive.open(f.pair);inactive.preview();expect(inactive.state.open).toBe(false);
  });
});

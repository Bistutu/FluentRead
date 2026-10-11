/**
 * @file tests/personalCorrectionUiPanel.test.ts
 * 文件职责：执行真实 Vue 校订模板验证用户可编辑、可预览、可撤销及可删除的界面流程。
 * 主要内容：原译文纯文本、候选差异、显式项目加入、管理与禁用状态、浅深色配置、焦点循环和 Escape 恢复。
 * 模块边界：自有 linkedom 渲染器只验证客户端模板与事件；真实几何和闭合 Shadow DOM 验收由隔离浏览器完成。
 */
import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import type {App} from 'vue';
import type {PersonalCorrectionRecord} from '@/src/core/personal-corrections/public';

const mocks=vi.hoisted(()=>({config:{theme:'auto',interfaceSkin:'default'},listeners:new Set<(value:any)=>void>(),stop:vi.fn()}));
vi.mock('@/src/services/config/store',()=>({config:mocks.config,subscribeConfig:(fn:(value:any)=>void)=>{mocks.listeners.add(fn);return()=>{mocks.listeners.delete(fn);mocks.stop();};}}));
const runtime=createRequire(import.meta.url)('vue') as typeof import('vue');
let component:any,app:App|undefined,document:Document,window:ReturnType<typeof parseHTML>['window'],focused:HTMLElement|null;
let mediaListener:((event:{matches:boolean})=>void)|undefined;const removeMedia=vi.fn();
const settle=async()=>{for(let i=0;i<4;i++){await Promise.resolve();await runtime.nextTick();}};
const mid='material-'+'a'.repeat(64),pid='00000000-0000-4000-8000-000000000002';
function entry(patch:Partial<PersonalCorrectionRecord>={}):PersonalCorrectionRecord{return {id:'00000000-0000-4000-8000-000000000001',scope:{kind:'material',id:mid,label:'文章'},source:'He opened the bank.',translation:'他开设了银行。',sourceLanguage:'en',targetLanguage:'zh-CN',context:'Finance',revision:1,...patch};}
beforeAll(async()=>{component=(await import('@/src/features/personal-corrections/ui/PersonalCorrectionPanel.vue')).default;expect(component.render).toBeTypeOf('function');});
beforeEach(()=>{vi.clearAllMocks();mocks.config.theme='auto';mocks.listeners.clear();focused=null;mediaListener=undefined;const dom=parseHTML('<html><body><button id="outside">Outside</button><div id="app"></div></body></html>');document=dom.document;window=dom.window;
  Object.defineProperty(document,'activeElement',{get:()=>focused,configurable:true});window.HTMLElement.prototype.focus=function(){focused=this;};
  window.matchMedia=()=>({matches:false,addEventListener:(_type:string,fn:any)=>{mediaListener=fn;},removeEventListener:removeMedia}) as any;
  for(const [name,value]of Object.entries({document,window,HTMLElement:window.HTMLElement,Element:window.Element,Event:window.Event}))vi.stubGlobal(name,value);
});
afterEach(async()=>{app?.unmount();app=undefined;await settle();vi.unstubAllGlobals();});
async function mount(patch:Record<string,unknown>={}){
  const state=runtime.shallowReactive({candidate:null,open:false,managing:false,busy:false,loading:false,error:'',notice:'',source:'He opened the bank.',currentTranslation:'他打开了河岸。',draft:'他开设了银行。',scopeId:'material',context:'Finance',sourceLanguage:'en',targetLanguage:'zh-CN',materialId:mid,materialLabel:'文章',projectName:'',entries:[],projects:[],suggestions:[],conflicts:[],affected:[],previewed:false,editing:null,undoToken:'',activeProjectId:'',...patch});
  const controller={state,open:vi.fn(()=>{state.open=true;}),close:vi.fn(()=>{state.open=false;}),setDraft:vi.fn((value:string)=>{state.draft=value;}),setScope:vi.fn((value:string)=>{state.scopeId=value;}),preview:vi.fn(()=>{state.previewed=true;}),save:vi.fn(),undo:vi.fn(),remove:vi.fn(),edit:vi.fn(),suggest:vi.fn(),createProject:vi.fn(),activateProject:vi.fn()};
  const renderer=runtime.createRenderer<Node,HTMLElement>({
    patchProp(node,key,old,value){if(/^on[A-Z]/u.test(key)){const event=key.slice(2).toLowerCase();if(old)node.removeEventListener(event,old);if(value)node.addEventListener(event,value);}else if(key==='value'){(node as HTMLInputElement).value=value??'';}else if(value==null||(value===false&&!/^(?:aria-|data-)/u.test(key)))node.removeAttribute(key);else node.setAttribute(key,String(value));},
    insert:(node,parent,anchor)=>parent.insertBefore(node,anchor||null),remove:node=>node.parentNode?.removeChild(node),
    createElement:tag=>{const element=runtime.markRaw(document.createElement(tag));if(tag==='select')Object.defineProperty(element,'value',{value:'',writable:true,configurable:true});return element;},
    createText:text=>document.createTextNode(text),createComment:text=>document.createComment(text),setText:(node,text)=>{node.nodeValue=text;},setElementText:(node,text)=>{node.textContent=text;},parentNode:node=>node.parentNode as HTMLElement|null,nextSibling:node=>node.nextSibling,setScopeId:(node,id)=>node.setAttribute(id,''),
    insertStaticContent:(content,parent,anchor)=>{const template=document.createElement('template');template.innerHTML=content;const first=template.content.firstChild!,last=template.content.lastChild!;parent.insertBefore(template.content,anchor||null);return[first,last];},
  });
  app=renderer.createApp(component,{controller});app.config.warnHandler=()=>undefined;app.mount(document.querySelector('#app')!);await settle();
  const get=(selector:string)=>{const node=document.querySelector<HTMLElement>(selector);expect(node).not.toBeNull();return node!;};
  const click=async(selector:string)=>{get(selector).dispatchEvent(new window.Event('click',{bubbles:true}));await settle();};
  const key=async(key:string,shiftKey=false)=>{const event=new window.Event('keydown',{bubbles:true,cancelable:true});Object.assign(event,{key,shiftKey});get('[data-testid=correction-dialog]').dispatchEvent(event);await settle();return event;};
  return {state,controller,get,click,key};
}
describe('actual personal correction panel',()=>{
  it('opens from accessible entry, edits text without parsing markup, previews then confirms, and restores prior focus',async()=>{
    const outside=document.querySelector<HTMLElement>('#outside')!;outside.focus();const f=await mount({candidate:{source:'source'}});await f.click('[data-testid=correction-entry]');expect(focused).toBe(f.get('[data-testid=correction-translation]'));
    const input=f.get('[data-testid=correction-translation]') as HTMLTextAreaElement;input.value='<img src=x onerror=alert(1)>修订';input.dispatchEvent(new window.Event('input',{bubbles:true}));await settle();expect(f.controller.setDraft).toHaveBeenCalledWith(input.value);
    expect(f.get('[data-testid=correction-save]').hasAttribute('disabled')).toBe(true);await f.click('[data-testid=correction-preview]');expect(f.controller.preview).toHaveBeenCalledTimes(1);expect(f.get('[data-testid=correction-preview-result]').querySelector('img')).toBeNull();
    await f.click('[data-testid=correction-save]');expect(f.controller.save).toHaveBeenCalledTimes(1);await f.click('[data-testid=correction-close]');expect(focused).toBe(outside);expect(document.querySelector('[role=dialog]')).toBeNull();
  });
  it('displays original/current diff, exact affected sentences, approximate references and explicit project actions',async()=>{
    const saved=entry(),project=entry({id:pid,scope:{kind:'project',id:pid,label:'论文'}});const f=await mount();f.state.open=true;f.state.projects=[{id:pid,label:'论文'}] as any;f.state.suggestions=[saved] as any;f.state.conflicts=[project] as any;f.state.previewed=true;f.state.affected=[{source:saved.source,translation:'旧译文'}] as any;await settle();
    expect(f.get('[data-testid=correction-affected-count]').textContent).toContain('1 处');expect(document.querySelector('.diff')!.textContent).toContain('已保存的原句');
    expect(f.get('[data-testid=correction-scope] option[value=material]').textContent).toBe('仅当前网页');expect(document.querySelector('.new-project')!.textContent).toContain('项目是一组相关网页');
    await f.click('.suggestions article button');expect(f.controller.suggest).toHaveBeenCalledWith(saved);await f.click('.conflict button');expect(f.controller.edit).toHaveBeenCalledWith(project);
    const scope=f.get('[data-testid=correction-scope]') as HTMLSelectElement;scope.value=pid;scope.dispatchEvent(new window.Event('change',{bubbles:true}));await settle();expect(f.controller.setScope).toHaveBeenCalledWith(pid);
    await f.click('[data-testid=correction-project-join]');expect(f.controller.activateProject).toHaveBeenCalledWith(pid);f.state.activeProjectId=pid;await settle();await f.click('[data-testid=correction-project-leave]');expect(f.controller.activateProject).toHaveBeenCalledWith(null);
    const name=f.get('[data-testid=correction-project-name]') as HTMLInputElement;name.value='新论文';name.dispatchEvent(new window.Event('input',{bubbles:true}));await settle();expect(f.state.projectName).toBe('新论文');await f.click('[data-testid=correction-project-create]');expect(f.controller.createProject).toHaveBeenCalledTimes(1);
    f.state.context='';await settle();expect(document.querySelector('.context blockquote')!.textContent).toBe('此处没有章节标题');
  });
  it('manages edit/delete/undo, keeps unrelated materials read-only and presents explicit loading, error and success states',async()=>{
    const f=await mount();f.state.open=true;f.state.loading=true;await settle();expect(document.querySelector('[role=status]')!.textContent).toContain('读取');await f.click('[data-testid=correction-manage]');expect(document.querySelector('.empty')).toBeNull();
    f.state.loading=false;await settle();expect(document.querySelector('.empty')).not.toBeNull();const saved=entry(),other=entry({id:pid,scope:{kind:'material',id:'material-'+'b'.repeat(64),label:'其他材料'},context:''});f.state.entries=[saved,other] as any;f.state.undoToken='token';f.state.error='校订版本已更新';f.state.notice='已保存';await settle();
    expect(f.get(`[data-correction-edit="${pid}"]`).hasAttribute('disabled')).toBe(true);expect(f.get('[data-testid=correction-error]').getAttribute('role')).toBe('alert');expect(f.get('[data-testid=correction-notice]').textContent).toBe('已保存');
    await f.click(`[data-correction-edit="${saved.id}"]`);await f.click(`[data-correction-delete="${saved.id}"]`);await f.click('[data-testid=correction-undo]');expect(f.controller.edit).toHaveBeenCalledWith(saved);expect(f.controller.remove).toHaveBeenCalledWith(saved);expect(f.controller.undo).toHaveBeenCalledTimes(1);
    f.state.busy=true;await settle();expect(f.get('[data-testid=correction-close]').hasAttribute('disabled')).toBe(true);expect(f.get('[data-testid=correction-undo]').hasAttribute('disabled')).toBe(true);
    f.state.busy=false;await f.click('.tabs button');expect(f.state.managing).toBe(false);f.state.busy=true;await settle();expect(f.get('[data-testid=correction-save]').textContent).toContain('保存中');f.state.busy=false;
    f.state.managing=true;f.state.entries=[entry({id:pid,scope:{kind:'project',id:pid,label:'论文'}})] as any;await settle();expect(document.querySelector('.record-meta')!.textContent).toContain('项目：论文');
    f.state.managing=true;f.state.entries=[];f.state.undoToken='';f.state.busy=true;await settle();expect((await f.key('Tab')).defaultPrevented).toBe(false);
  });
  it('traps Tab at dialog endpoints, leaves interior keys alone and closes only its own Escape',async()=>{
    const f=await mount();f.state.open=true;f.state.previewed=true;await settle();const first=f.get('[data-testid=correction-close]'),last=f.get('[data-testid=correction-save]');first.focus();expect((await f.key('Tab',true)).defaultPrevented).toBe(true);expect(focused).toBe(last);
    last.focus();expect((await f.key('Tab')).defaultPrevented).toBe(true);expect(focused).toBe(first);f.get('[data-testid=correction-translation]').focus();expect((await f.key('Tab')).defaultPrevented).toBe(false);expect((await f.key('ArrowDown')).defaultPrevented).toBe(false);
    expect((await f.key('Escape')).defaultPrevented).toBe(true);expect(f.controller.close).toHaveBeenCalledTimes(1);
  });
  it('supports already-open lazy mounts and does not steal focus when the opening is immediately canceled',async()=>{
    const f=await mount({open:true,managing:true});expect(focused).toBe(f.get('[data-testid=correction-manage]'));f.state.open=false;await settle();
    f.state.managing=false;f.state.open=true;await Promise.resolve();f.state.open=false;await settle();expect(document.querySelector('[role=dialog]')).toBeNull();
    f.state.open=true;await settle();focused=null;expect((await f.key('Tab')).defaultPrevented).toBe(false);
  });
  it('ignores late keyboard events retained on an already-unmounted dialog',async()=>{
    const f=await mount({open:true});const dialog=f.get('[data-testid=correction-dialog]');app!.unmount();app=undefined;await settle();const event=new window.Event('keydown',{bubbles:true,cancelable:true});Object.assign(event,{key:'Tab'});expect(()=>dialog.dispatchEvent(event)).not.toThrow();expect(event.defaultPrevented).toBe(false);
  });
  it('follows system/config theme changes, focuses management and releases observers without reviving a closed dialog',async()=>{
    const outside=document.querySelector<HTMLElement>('#outside')!;outside.focus();const f=await mount();f.state.open=true;await settle();mediaListener!({matches:true});await settle();expect(document.querySelector('.correction-ui')!.classList.contains('dark')).toBe(true);
    for(const fn of mocks.listeners)fn({theme:'light',interfaceSkin:'minimal'});await settle();expect(document.querySelector('.correction-ui')!.classList.contains('dark')).toBe(false);for(const fn of mocks.listeners)fn({theme:'dark',interfaceSkin:'default'});await settle();expect(document.querySelector('.correction-ui')!.classList.contains('dark')).toBe(true);
    f.state.entries=[entry()] as any;f.state.managing=true;await settle();expect(focused).toBe(document.querySelector('[data-correction-edit]'));f.state.managing=false;await settle();expect(focused).toBe(document.querySelector('textarea'));
    outside.remove();f.state.open=false;await settle();f.state.managing=true;await settle();app!.unmount();app=undefined;expect(mocks.stop).toHaveBeenCalledTimes(1);expect(removeMedia).toHaveBeenCalledWith('change',expect.any(Function));
  });
});

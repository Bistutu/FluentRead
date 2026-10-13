/**
 * @file tests/readingPanelStreamingResize.test.ts
 * 文件职责：执行阅读面板真实 Vue setup 与客户端模板，验证流式正文不重复要求父卡片测量。
 * 主要内容：逐次刷新回答与结构变化、同帧首次回答/完成/错误、用户阅读位置、晚到译文、隐藏/替换/卸载的迟到响应；统一导航顶栏的唯一传送工具、正文追问与回答优先顺序、菜单边界和监听清理，以及真实表单/按钮事件。
 * 模块边界：仅控制后台流端口、展示子组件与 DOM 几何；不复制阅读业务，不请求模型，不声称真实浏览器性能。
 */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
import {compileScript, compileStyle, compileTemplate, parse} from 'vue/compiler-sfc';
import {useRenderDateFormatter} from '@/src/ui/dateFormat';
import ts from 'typescript';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {DEFAULT_HARNESS_PREFERENCES, HARNESS_ACTIONS, isReadingActionSupported, isReadingFollowUpSupported} from '@/src/core/config/harness';
import {hasDistinctTranslation} from '@/src/core/translation/result';
import {buildReadingEvidence, readingEvidenceText} from '@/src/core/harness/evidence';
import type {ReadingProgress, ReadingRequest, ReadingResponse} from '@/src/features/reading-assistant/types';

const runtime=createRequire(import.meta.url)('vue') as typeof import('vue');
type HostNode=Node & {__readingProps?:Record<string,any>;__readingEvents?:Record<string,EventListener>};
type StreamCall={request:ReadingRequest;callbacks:{progress:(progress:ReadingProgress)=>void;result:(response:ReadingResponse)=>void;error:(error:Error)=>void};cancel:ReturnType<typeof vi.fn>};
let dispose:(()=>void)|undefined;
const frames=new Map<number,FrameRequestCallback>();let frameId=0;
const flushFrame=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(callback=>callback(16));};
const tick=async()=>{await runtime.nextTick();await runtime.nextTick();};
afterEach(async()=>{dispose?.();dispose=undefined;await tick();expect(frames.size).toBe(0);vi.unstubAllGlobals();frames.clear();});

async function mountPanel(overrides:Record<string,unknown>={}) {
  const {document,window}=parseHTML('<html><body></body></html>');
  const view={innerHeight:800,innerWidth:390,addEventListener:document.addEventListener.bind(document),removeEventListener:document.removeEventListener.bind(document),dispatchEvent:document.dispatchEvent.bind(document)};
  Object.defineProperty(document,'defaultView',{configurable:true,value:view});
  vi.stubGlobal('document',document);
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++frameId,callback);return frameId;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  const calls:StreamCall[]=[],resize=vi.fn(),errors=vi.fn();
  const sendMessage=vi.fn(async()=>({success:true})),writeClipboard=vi.fn(async(_text:string)=>undefined),playSource=vi.fn();
  const saveLearningMemory=vi.fn(async(_memory: {kind: string; content: string})=>({}));
  const translateLegacy=vi.fn((text:string)=>text);
  vi.stubGlobal('navigator',{clipboard:{writeText:writeClipboard}});
  const modules:Record<string,unknown>={
    vue:runtime,
    // 日期复用属于本组件的真实 Vue update 生命周期，不能以格式化 stub 绕过。
    '@/src/ui/dateFormat':{useRenderDateFormatter},
    '@/src/core/translation/result':{hasDistinctTranslation},
    '@/src/core/harness/evidence':{buildReadingEvidence, readingEvidenceText},
    '@/src/ui/i18n':{useUiI18n:()=>({t:(key:string)=>key,translateLegacy})},
    'webextension-polyfill':{default:{runtime:{sendMessage}}},
    '@/src/core/config/harness':{HARNESS_ACTIONS,isReadingActionSupported,isReadingFollowUpSupported},
    './ReadingAnswer.vue':{default:runtime.defineComponent({props:['text'],setup:props=>()=>runtime.h('div',{'data-reading-answer':''},props.text)})},
    '../client':{streamReading:(request:ReadingRequest,callbacks:StreamCall['callbacks'])=>{const call={request,callbacks,cancel:vi.fn()};calls.push(call);return {cancel:call.cancel};},
      getHarnessSession:async()=>null,listHarnessSessions:async()=>({sessions:[],hasMore:false}),saveLearningMemory},
    '@/src/features/vocabulary/public':{normalizeLearningSourceText:(text:string)=>text.trim()},
    '@/src/features/vocabulary/protocol':{VOCABULARY_BOOK_MESSAGE:'fixture-vocabulary'},
    '@/src/core/language/detect':{detectlang:()=> 'en'},
  };
  const filename='src/features/reading-assistant/ui/ReadingPanel.vue';
  const {descriptor}=parse(readFileSync(filename,'utf8'),{filename});
  const script=compileScript(descriptor,{id:'reading-stream-resize'});
  const compiled=ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:Record<string,any>={};
  new Function('require','exports',compiled)((id:string)=>{if(!(id in modules))throw new Error(`Unexpected ReadingPanel import: ${id}`);return modules[id];},exports);
  const template=compileTemplate({source:descriptor.template!.content,filename,id:'reading-stream-resize',
    compilerOptions:{mode:'function',cacheHandlers:true,bindingMetadata:script.bindings,expressionPlugins:['typescript']}});
  expect(template.errors).toEqual([]);
  exports.default.render=new Function('Vue',ts.transpileModule(template.code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(runtime);
  exports.default.__scopeId='data-v-reading-stream-resize';
  const styles=compileStyle({source:descriptor.styles[0].content,filename,id:'data-v-reading-stream-resize',scoped:true});
  expect(styles.errors).toEqual([]);
  const remove=(node:HostNode)=>node.parentNode?.removeChild(node);
  const insert=(node:HostNode,parent:HostNode,anchor?:HostNode|null)=>parent.insertBefore(node,anchor||null);
  const renderer=runtime.createRenderer<HostNode,HostNode>({
    patchProp:(node,key,_previous,value)=>{
      (node.__readingProps||={})[key]=value;
      if(key.startsWith('on')) {
        if(key.includes(':'))return;
        const name=key.slice(2).replace(/(?:Once|Passive|Capture)$/u,'').toLowerCase();
        const listeners=node.__readingEvents||={};if(listeners[key])node.removeEventListener(name,listeners[key]);
        if(value){listeners[key]=event=>{for(const fn of Array.isArray(value)?value:[value])fn(event);};node.addEventListener(name,listeners[key]);}
      } else if(node.nodeType===1) {
        if(key==='value')(node as HTMLInputElement).value=value??'';
        else if(value===null||value===undefined||value===false)(node as Element).removeAttribute(key);
        else (node as Element).setAttribute(key,value===true?'':String(value));
      }
    },
    insert,remove,createElement:tag=>document.createElement(tag) as unknown as HostNode,
    createText:text=>document.createTextNode(text) as unknown as HostNode,createComment:text=>document.createComment(text) as unknown as HostNode,
    setText:(node,text)=>{node.nodeValue=text;},setElementText:(node,text)=>{node.textContent=text;},
    parentNode:node=>node.parentNode as HostNode|null,nextSibling:node=>node.nextSibling as HostNode|null,
    querySelector:selector=>document.querySelector(selector) as unknown as HostNode|null,setScopeId:(node,id)=>(node as Element).setAttribute(id,''),
    insertStaticContent:(html,parent,anchor)=>{
      const holder=document.createElement('template');holder.innerHTML=html;
      const nodes=[...holder.content.childNodes] as unknown as HostNode[];nodes.forEach(node=>insert(node,parent,anchor));return [nodes[0],nodes.at(-1)!];
    },
  });
  const host=document.createElement('div'), mountRoot=document.createElement('div'), toolsTarget=document.createElement('div');
  toolsTarget.className='fr-study-reading-tools';host.append(toolsTarget,mountRoot);document.body.append(host);
  const props=runtime.reactive({toolsTarget:runtime.markRaw(toolsTarget) as unknown as HTMLElement|null,selection:{text:'Practice helps.',sentence:'Practice helps.',context:'Practice helps every day.'},
    preferences:{...DEFAULT_HARNESS_PREFERENCES,enabled:true},active:true,targetLanguage:'zh-CN',sourceLanguage:'en',
    vocabularyEnabled:true,privateContext:false,animations:false,historyOnly:false,externalNavigation:undefined as boolean|undefined,
    sourceTranslation:undefined as {source:string;text:string;pending?:boolean}|undefined,...overrides});
  let panel:any;
  const app=renderer.createApp({setup:()=>()=>runtime.h(exports.default,{...props,onResize:resize,onPlaySource:playSource,ref:(instance:any)=>{if(instance)panel=instance.$.setupState;}})});
  app.config.warnHandler=()=>undefined;app.config.errorHandler=errors;
  app.mount(mountRoot as unknown as HostNode);dispose=()=>app.unmount();await tick();
  expect(errors).not.toHaveBeenCalled();
  const viewport=host.querySelector('.fr-reading-result') as unknown as HTMLElement;
  if(viewport){Object.defineProperty(viewport,'scrollTop',{configurable:true,writable:true,value:0});Object.defineProperty(panel.answerBody,'offsetTop',{configurable:true,value:100});}
  const finish=(text:string,call=calls.at(-1)!)=>call.callbacks.result({success:true,text,service:'deepseek',model:'fixture-model'});
  return {host,toolsTarget,panel,props,calls,resize,viewport,finish,errors,window,sendMessage,writeClipboard,playSource,translateLegacy,saveLearningMemory,styles:styles.code,unmount:()=>{dispose?.();dispose=undefined;}};
}

it('copies and saves readable source quotes without leaking model citation IDs or external markers', async () => {
  const {panel,calls,finish,writeClipboard,saveLearningMemory}=await mountPanel();
  const source=buildReadingEvidence(calls[0].request.selection.text,calls[0].request.selection.context)[0];
  finish(`It helps. [[cite:${source.id}|Practice helps.]]\n\n[[external]] Background. [[cite:invented|Unverified text.]]`);
  await tick();
  await panel.copyAnswer();
  const copied=writeClipboard.mock.calls[0][0];
  expect(copied).toContain('【reading.evidence.label】 Practice helps.');
  expect(copied).toContain('【reading.evidence.unverified】 Unverified text.');
  expect(copied).toContain('【reading.evidence.external】 Background.');
  expect(copied).not.toMatch(/\[\[cite:|\[\[external\]\]|fr-[a-z0-9]+-[sc]\d/u);
  await panel.rememberLearning();
  expect(saveLearningMemory).toHaveBeenCalledOnce();
  const note=saveLearningMemory.mock.calls[0][0].content;
  expect(note).toContain('【reading.evidence.label】 Practice helps.');
  expect(note).not.toContain('[[cite:');
});

describe('reading panel streaming resize boundaries through actual setup and template',()=>{
  it.each([false,true])('preserves scoped followup nodes, IME input and stopped keyboard propagation in both layouts (external=%s)',async externalNavigation=>{
    const {host,panel,props,calls,window,finish,styles}=await mountPanel({externalNavigation});
    vi.stubGlobal('Event',window.Event);
    finish('Completed explanation');await tick();
    panel.question='Draft';panel.feedback='Saved';panel.sessionWarning='Session warning';await tick();
    const form=host.querySelector('.fr-reading-followup')!;
    const input=form.querySelector('input') as unknown as HTMLInputElement;
    const button=form.querySelector('button')!;
    expect(form.parentNode).toBe(host.querySelector(externalNavigation?'.fr-reading-body':'[data-reading-panel]'));
    expect(host.querySelectorAll('.fr-reading-followup')).toHaveLength(1);
    for(const element of [form,input,button,...host.querySelectorAll('.fr-reading-feedback')]) expect(element.hasAttribute('data-v-reading-stream-resize')).toBe(true);
    for(const fragment of ['.fr-reading-followup input','.fr-reading-followup button','.fr-reading-feedback']){
      const selector=[...styles.matchAll(/([^{}]+)\{([^{}]+)\}/gu)].find(([,rule])=>rule.trim().startsWith(fragment))![1].trim();
      expect(host.querySelector(selector)).not.toBeNull();
    }
    const propagated=vi.fn();host.addEventListener('keydown',propagated);host.addEventListener('keyup',propagated);
    for(const type of ['keydown','keyup']) input.dispatchEvent(new window.Event(type,{bubbles:true}));
    expect(propagated).not.toHaveBeenCalled();
    input.dispatchEvent(new window.Event('compositionstart'));input.value='输入中的问题';
    input.dispatchEvent(new window.Event('input',{bubbles:true}));await tick();
    expect(panel.question).toBe('Draft');expect(panel.feedback).toBe('');
    input.dispatchEvent(new window.Event('compositionend'));await tick();expect(panel.question).toBe('输入中的问题');
    const submitted=new window.Event('submit',{bubbles:true,cancelable:true});form.dispatchEvent(submitted);await tick();
    expect(submitted.defaultPrevented).toBe(true);expect(calls).toHaveLength(2);expect(calls[1].request.question).toBe('输入中的问题');
    expect(input.hasAttribute('disabled')).toBe(true);expect(button.hasAttribute('disabled')).toBe(true);
    props.preferences.service='bilibili';await tick();expect(host.querySelector('.fr-reading-followup')).toBeNull();
    props.preferences.service='deepseek';await tick();expect(host.querySelectorAll('.fr-reading-followup')).toHaveLength(1);
  });

  it('keeps standalone controls while external navigation teleports unique tools to the fixed slot and leaves followup in the answer',async()=>{
    const {host,toolsTarget,props,calls,viewport,finish,styles}=await mountPanel({externalNavigation:false});
    const root=host.querySelector('[data-reading-panel]')!;
    expect(host.querySelector('.fr-reading-toolbar')?.parentNode).toBe(root);
    expect(host.querySelector('.fr-reading-followup')?.parentNode).toBe(root);
    const summary=host.querySelector('summary[aria-label="更多操作"]')!;
    const summaryRule=[...styles.matchAll(/([^{}]+)\{([^{}]+)\}/gu)].find(([,selector,body])=>selector.includes('summary') && body.includes('width: 32px') && body.includes('height: 32px'))!;
    expect(summaryRule).toBeDefined();expect(summary.matches(summaryRule[1].trim())).toBe(true);
    props.externalNavigation=true;await tick();
    expect(host.querySelector('.fr-reading-toolbar')).toBeNull();
    expect(host.querySelectorAll('.fr-reading-tools')).toHaveLength(1);
    expect(host.querySelectorAll('.fr-reading-followup')).toHaveLength(1);
    expect(host.querySelectorAll('summary[aria-label="更多操作"]')).toHaveLength(1);
    expect(toolsTarget.contains(host.querySelector('.fr-reading-tools'))).toBe(true);
    expect(viewport.querySelector('.fr-reading-tools')).toBeNull();
    expect(host.querySelector('.fr-reading-inline-controls')).toBeNull();
    expect(viewport.contains(host.querySelector('.fr-reading-followup'))).toBe(true);
    expect(host.querySelector('.fr-reading-status')).not.toBeNull();
    calls[0].callbacks.progress({kind:'text',text:'Heading\nFirst answer paragraph'});await tick();
    expect(host.querySelector('.fr-reading-body > .fr-reading-status')).toBeNull();
    expect(host.querySelector('.fr-reading-controls button[aria-label="停止"]')).not.toBeNull();
    expect(host.querySelector('.fr-reading-controls [role="status"]')).not.toBeNull();
    const body=host.querySelector('.fr-reading-body')!;
    expect([...body.children].indexOf(host.querySelector('.fr-reading-followup')!)).toBeGreaterThan([...body.children].indexOf(host.querySelector('.fr-reading-answer')!));
    finish('Complete answer');await tick();
    expect(host.querySelector('.fr-reading-controls button[aria-label="停止"]')).toBeNull();
    expect(host.querySelectorAll('.fr-reading-footer')).toHaveLength(1);
    expect(host.querySelectorAll('.fr-reading-tool-list button')).toHaveLength(5);
    props.externalNavigation=false;await tick();
    expect(host.querySelector('.fr-reading-toolbar')?.parentNode).toBe(root);
    expect(host.querySelector('.fr-reading-followup')?.parentNode).toBe(root);
    expect(host.querySelectorAll('.fr-reading-tools')).toHaveLength(1);
    expect(host.querySelectorAll('.fr-reading-followup')).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('bounds the teleported menu above or below its trigger and releases sizing listeners on close, view switches and unmount',async()=>{
    const {host,panel,props,window,unmount}=await mountPanel({externalNavigation:true});
    const details=host.querySelector('.fr-reading-tools') as unknown as HTMLDetailsElement;
    const summary=details.querySelector('summary')!;
    const menu=details.querySelector('.fr-reading-tool-list') as HTMLElement;
    Object.defineProperty(summary,'offsetHeight',{configurable:true,value:32});
    Object.defineProperty(menu,'scrollHeight',{configurable:true,value:320});
    let rect={top:740,bottom:772,height:32};
    summary.getBoundingClientRect=()=>rect as DOMRect;
    const view=details.ownerDocument.defaultView!;
    const add=vi.spyOn(view,'addEventListener'), remove=vi.spyOn(view,'removeEventListener');
    const open=()=>{details.open=true;details.dispatchEvent(new window.Event('toggle'));};
    open();
    expect(menu.style.top).toBe('auto');expect(menu.style.bottom).toBe('36px');expect(menu.style.maxHeight).toBe('310px');
    expect(add).toHaveBeenCalledWith('resize',panel.fitToolsMenu);
    rect={top:20,bottom:52,height:32};view.dispatchEvent(new window.Event('resize'));
    expect(menu.style.top).toBe('36px');expect(menu.style.bottom).toBe('auto');expect(menu.style.maxHeight).toBe('310px');
    rect={top:620,bottom:684,height:64};view.dispatchEvent(new window.Event('resize'));
    expect(menu.style.top).toBe('auto');expect(menu.style.maxHeight).toBe('302px');expect(menu.style.width).toBe('183px');
    panel.dismissToolsOutside({target:menu.querySelector('button')});expect(details.open).toBe(true);
    const focus=vi.fn();summary.focus=focus;
    panel.dismissToolsOutside({target:host.querySelector('input')});
    expect(details.open).toBe(false);expect(focus).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('resize',panel.fitToolsMenu);
    open();props.active=false;await tick();
    expect(details.open).toBe(false);expect(host.querySelector('.fr-reading-controls')).toBeNull();
    props.active=true;await tick();
    const current=host.querySelector('.fr-reading-tools') as unknown as HTMLDetailsElement;
    current.open=true;current.dispatchEvent(new window.Event('toggle'));
    props.historyOnly=true;await tick();
    expect(current.open).toBe(false);expect(host.querySelector('.fr-reading-controls')).toBeNull();
    props.historyOnly=false;await tick();
    const final=host.querySelector('.fr-reading-tools') as unknown as HTMLDetailsElement;
    final.open=true;final.dispatchEvent(new window.Event('toggle'));
    remove.mockClear();unmount();await tick();
    expect(remove).toHaveBeenCalledWith('resize',panel.fitToolsMenu);
    expect(host.querySelector('.fr-reading-tools')).toBeNull();
  });

  it('enters records without restoring focus to the removed menu trigger and keeps source viewing focused on the answer',async()=>{
    const {host,window,viewport,panel}=await mountPanel({externalNavigation:true});
    const details=host.querySelector('.fr-reading-tools') as unknown as HTMLDetailsElement;
    const summary=details.querySelector('summary')!;const focus=vi.fn();summary.focus=focus;
    const button=(text:string)=>[...details.querySelectorAll('button')].find(element=>element.textContent===text)!;
    const sourceFocus=vi.fn();viewport.focus=sourceFocus;
    details.open=true;button('reading.viewSource').dispatchEvent(new window.Event('click',{bubbles:true}));await tick();
    expect(details.open).toBe(false);expect(sourceFocus).toHaveBeenCalledWith({preventScroll:true});expect(focus).not.toHaveBeenCalled();
    details.open=true;button('阅读记录').dispatchEvent(new window.Event('click',{bubbles:true}));await tick();
    expect(panel.showRecords).toBe(true);expect(host.querySelector('.fr-reading-controls')).toBeNull();expect(focus).not.toHaveBeenCalled();
    panel.closeRecords();await tick();
    expect(host.querySelectorAll('.fr-reading-tools')).toHaveLength(1);
  });

  it('returns from records to the generating action without cancelling or duplicating its request',async()=>{
    const {host,panel,props,calls,finish}=await mountPanel({externalNavigation:true});
    calls[0].callbacks.progress({kind:'text',text:'Partial explanation'});await tick();
    props.historyOnly=true;await tick();
    expect(panel.showRecords).toBe(true);expect(host.querySelector('.fr-reading-controls')).toBeNull();
    props.historyOnly=false;await tick();
    expect(panel.showRecords).toBe(false);expect(panel.busy).toBe(true);
    expect(host.querySelector('[data-reading-answer]')?.textContent).toBe('Partial explanation');
    expect(host.querySelectorAll('.fr-reading-tools')).toHaveLength(1);
    expect(calls).toHaveLength(1);expect(calls[0].cancel).not.toHaveBeenCalled();
    calls[0].callbacks.progress({kind:'text',text:'Continued explanation'});await tick();
    expect(host.querySelector('[data-reading-answer]')?.textContent).toBe('Continued explanation');
    finish('Completed explanation');await tick();
    expect(panel.busy).toBe(false);expect(host.querySelector('[data-reading-answer]')?.textContent).toBe('Completed explanation');
    expect(calls).toHaveLength(1);expect(calls[0].cancel).not.toHaveBeenCalled();
  });

  it('runs external tools and followup through real DOM events while preserving manual scrolling and request ownership',async()=>{
    const {host,panel,calls,resize,viewport,window,finish,sendMessage,writeClipboard,playSource,translateLegacy,props}=await mountPanel({externalNavigation:true});
    const click=(element:Element)=>element.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));
    const button=(text:string)=>[...host.querySelectorAll('button')].find(element=>element.textContent===text)!;
    flushFrame();flushFrame();
    calls[0].callbacks.progress({kind:'text',text:'Visible streamed answer'});await tick();resize.mockClear();
    const toolsRenders=()=>translateLegacy.mock.calls.filter(([text])=>text==='更多操作').length;
    const beforeChunks=toolsRenders();
    viewport.scrollTop=7;viewport.dispatchEvent(new window.Event('wheel',{bubbles:true}));
    const followUpUpdates=vi.spyOn(runtime.vModelText as {beforeUpdate:NonNullable<typeof runtime.vModelText.beforeUpdate>},'beforeUpdate');
    try {
      for(let index=0;index<8;index++){calls[0].callbacks.progress({kind:'text',text:`Stream paragraph ${index}`});await tick();expect(viewport.scrollTop).toBe(7);}
      expect(followUpUpdates).not.toHaveBeenCalled();
    } finally {followUpUpdates.mockRestore();}
    expect(resize).not.toHaveBeenCalled();
    expect(toolsRenders()).toBe(beforeChunks);
    click(host.querySelector('.fr-reading-controls button[aria-label="停止"]')!);await tick();
    expect(calls[0].cancel).toHaveBeenCalledOnce();expect(panel.stopped).toBe(true);
    calls[0].callbacks.progress({kind:'text',text:'Late stopped result'});await tick();
    expect(host.querySelector('[data-reading-answer]')?.textContent).toBe('Stream paragraph 7');
    click(button('重新生成'));await tick();expect(calls).toHaveLength(2);
    finish('Complete explanation');await tick();
    click(button('复制'));await tick();expect(writeClipboard).toHaveBeenCalledWith('Practice helps.\n\nComplete explanation');
    click(button('收藏原文'));await tick();expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({action:'upsert',input:expect.objectContaining({term:'Practice helps.'})}));
    click(button('朗读原文'));await tick();expect(playSource).toHaveBeenCalledWith('Practice helps.');
    click(button('设置'));await tick();expect(sendMessage).toHaveBeenCalledWith({type:'openOptionsPage',section:'settings-selection'});
    const focusViewport=vi.fn();viewport.focus=focusViewport;viewport.scrollTop=15;
    click(button('reading.viewSource'));await tick();expect(viewport.scrollTop).toBe(0);
    expect(focusViewport).toHaveBeenCalledWith({preventScroll:true});expect(calls).toHaveLength(2);
    const details=host.querySelector('.fr-reading-tools') as unknown as HTMLDetailsElement;
    const summary=details.querySelector('summary')!;const focus=vi.fn();summary.focus=focus;details.open=true;
    const escape=new window.Event('keydown',{bubbles:true,cancelable:true});Object.defineProperty(escape,'key',{value:'Escape'});summary.dispatchEvent(escape);
    expect(details.open).toBe(false);expect(focus).toHaveBeenCalledWith({preventScroll:true});
    const input=host.querySelector('input[aria-label="继续追问"]') as unknown as HTMLInputElement;
    input.value='Why does practice help?';input.dispatchEvent(new window.Event('input',{bubbles:true}));await tick();
    const submit=host.querySelector('button[type="submit"]')!;expect(submit.hasAttribute('disabled')).toBe(false);
    const form=host.querySelector('.fr-reading-followup')!;const submitEvent=new window.Event('submit',{bubbles:true,cancelable:true});form.dispatchEvent(submitEvent);await tick();
    expect(submitEvent.defaultPrevented).toBe(true);expect(calls).toHaveLength(3);
    expect(calls[2].request.question).toBe('Why does practice help?');
    expect(calls[2].request.history).toEqual([{question:'读懂',answer:'Complete explanation'}]);
    expect(input.value).toBe('');expect(submit.hasAttribute('disabled')).toBe(true);
    form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await tick();expect(calls).toHaveLength(3);
    const owner=calls[2];props.selection={text:'Replacement.',sentence:'Replacement.',context:'Replacement context.'};await tick();
    owner.callbacks.progress({kind:'text',text:'Late previous followup'});owner.callbacks.result({success:true,text:'Late followup complete',service:'deepseek',model:'fixture'});await tick();
    expect(owner.cancel).toHaveBeenCalledOnce();expect(host.querySelector('[data-reading-answer]')).toBeNull();
    expect(host.querySelectorAll('.fr-reading-tools')).toHaveLength(1);expect(host.querySelectorAll('.fr-reading-followup')).toHaveLength(1);
    expect(host.querySelector('.fr-reading-source p')?.textContent).toBe('Replacement.');
  });

  it('keeps external source comparison collapsed while late translations and answer chunks preserve the user reading position',async()=>{
    const {host,calls,props,panel,viewport,window,resize,finish}=await mountPanel({externalNavigation:true,
      sourceTranslation:{source:'Practice helps.',text:'',pending:true}});
    flushFrame();flushFrame();
    const source=host.querySelector('.fr-reading-source') as unknown as HTMLElement;
    expect(source.style.display).toBe('none');
    expect(viewport.scrollTop).toBe(0);
    calls[0].callbacks.progress({kind:'text',text:'First answer'});await tick();resize.mockClear();
    viewport.scrollTop=37;viewport.dispatchEvent(new window.Event('wheel',{bubbles:true}));
    Object.defineProperty(panel.answerBody,'offsetTop',{configurable:true,value:250});
    props.sourceTranslation={source:'Practice helps.',text:'练习有帮助。'};await tick();
    expect(viewport.scrollTop).toBe(37);
    expect(source.style.display).toBe('none');
    expect(host.querySelector('.fr-reading-source p')?.textContent).toBe('Practice helps.');
    expect(host.querySelector('.fr-reading-translation p')?.textContent).toBe('练习有帮助。');
    for(let index=0;index<8;index++){calls[0].callbacks.progress({kind:'text',text:`Answer paragraph ${index}`});await tick();expect(viewport.scrollTop).toBe(37);}
    expect(resize).not.toHaveBeenCalled();
    finish('Completed explanation');await tick();
    expect(viewport.scrollTop).toBe(37);expect(source.style.display).toBe('none');expect(calls).toHaveLength(1);
  });

  it('expands and returns from the source through rendered controls without losing the answer or an unsent question',async()=>{
    const {host,calls,viewport,window,finish,props}=await mountPanel({externalNavigation:true,
      sourceTranslation:{source:'Practice helps.',text:'练习有帮助。'}});
    flushFrame();flushFrame();finish('Completed explanation');await tick();
    const source=host.querySelector('.fr-reading-source') as unknown as HTMLElement;
    const input=host.querySelector('input[aria-label="继续追问"]') as unknown as HTMLInputElement;
    const click=(element:Element)=>element.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));
    const focus=vi.fn();viewport.focus=focus;
    input.value='My unsent question';input.dispatchEvent(new window.Event('input',{bubbles:true}));await tick();
    viewport.scrollTop=59;
    click([...host.querySelectorAll('.fr-reading-tool-list button')].find(button=>button.textContent==='reading.viewSource')!);
    await tick();
    expect(source.style.display).not.toBe('none');
    expect(viewport.scrollTop).toBe(0);expect(focus).toHaveBeenLastCalledWith({preventScroll:true});
    expect(source.querySelector('p')?.textContent).toBe('Practice helps.');
    expect(source.querySelector('.fr-reading-translation p')?.textContent).toBe('练习有帮助。');
    expect(calls).toHaveLength(1);
    props.sourceTranslation={source:'Practice helps.',text:'更新的完整译文。'};await tick();
    expect(viewport.scrollTop).toBe(0);expect(source.querySelector('.fr-reading-translation p')?.textContent).toBe('更新的完整译文。');
    click(host.querySelector('button[aria-label="返回当前阅读"]')!);await tick();
    expect(source.style.display).toBe('none');expect(viewport.scrollTop).toBe(0);
    expect(host.querySelector('[data-reading-answer]')?.textContent).toBe('Completed explanation');
    expect(input.value).toBe('My unsent question');expect(calls).toHaveLength(1);
    expect(host.querySelector('button[aria-label="返回当前阅读"]')).toBeNull();
  });

  it.each(['hidden','replacement','unmount'] as const)('rejects a queued source expansion after %s without focusing or scrolling the stale viewport',async reason=>{
    const {host,props,viewport,window,unmount,calls}=await mountPanel({externalNavigation:true});
    flushFrame();flushFrame();
    const focus=vi.fn();viewport.focus=focus;viewport.scrollTop=61;
    const sourceButton=[...host.querySelectorAll('.fr-reading-tool-list button')].find(button=>button.textContent==='reading.viewSource')!;
    sourceButton.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));
    if(reason==='hidden')props.active=false;
    else if(reason==='replacement')props.selection={text:'Practice helps.',sentence:'Practice helps.',context:'A new captured context.'};
    else unmount();
    await tick();
    expect(focus).not.toHaveBeenCalled();expect(viewport.scrollTop).toBe(61);
    expect(calls[0].cancel).toHaveBeenCalledOnce();
    if(reason==='replacement')expect((host.querySelector('.fr-reading-source') as unknown as HTMLElement).style.display).toBe('none');
  });

  it('collapses an explicitly opened source on a new action and preserves standalone source comparison',async()=>{
    const {host,panel,calls,props,viewport,window,finish}=await mountPanel({externalNavigation:true,
      sourceTranslation:{source:'Practice helps.',text:'练习有帮助。'}});
    flushFrame();flushFrame();finish('Completed explanation');await tick();
    viewport.focus=vi.fn();panel.showSource();await tick();
    expect((host.querySelector('.fr-reading-source') as unknown as HTMLElement).style.display).not.toBe('none');
    panel.startAction('grammar');await tick();flushFrame();flushFrame();
    expect(calls).toHaveLength(2);expect(calls[1].request.intent).toBe('grammar');
    expect((host.querySelector('.fr-reading-source') as unknown as HTMLElement).style.display).toBe('none');
    expect(viewport.scrollTop).toBe(0);
    props.externalNavigation=false;await tick();
    const source=host.querySelector('.fr-reading-source') as unknown as HTMLElement;
    expect(source.style.display).not.toBe('none');
    expect(source.querySelector('p')?.textContent).toBe('Practice helps.');
    expect(source.querySelector('.fr-reading-translation p')?.textContent).toBe('练习有帮助。');
    expect(host.querySelector('button[aria-label="返回当前阅读"]')).toBeNull();
    viewport.scrollTop=63;viewport.dispatchEvent(new window.Event('wheel',{bubbles:true}));
    panel.showSource();expect(viewport.scrollTop).toBe(0);expect(calls).toHaveLength(2);
  });

  it('renders every flushed chunk while only answer presence and completion notify the parent',async()=>{
    const {host,calls,resize,viewport,finish,errors}=await mountPanel();
    flushFrame();flushFrame();resize.mockClear();
    for(let index=1;index<=40;index++) {
      const text=`Streaming answer ${index}`;calls[0].callbacks.progress({kind:'text',text});await tick();
      expect(host.querySelector('[data-reading-answer]')?.textContent).toBe(text);
      expect(resize).toHaveBeenCalledTimes(1);
      expect(viewport.scrollTop).toBe(100);
    }
    finish('Final answer');await tick();
    expect(host.querySelector('[data-reading-answer]')?.textContent).toBe('Final answer');
    expect(host.querySelector('.fr-reading-footer')).not.toBeNull();expect(resize).toHaveBeenCalledTimes(2);
    expect(errors).not.toHaveBeenCalled();
  });

  it('keeps same-flush first answer/error and retry transitions visible without redundant text resizes',async()=>{
    const {host,calls,resize,panel}=await mountPanel();flushFrame();flushFrame();resize.mockClear();
    calls[0].callbacks.progress({kind:'text',text:'A partial answer'});calls[0].callbacks.error(new Error('Connection stopped'));await tick();
    expect(host.querySelector('[data-reading-answer]')?.textContent).toBe('A partial answer');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Connection stopped');expect(resize).toHaveBeenCalledOnce();
    panel.retry();await tick();expect(calls).toHaveLength(2);expect(resize).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-reading-answer]')).toBeNull();expect(host.querySelector('[role="alert"]')).toBeNull();
    calls[1].callbacks.progress({kind:'text',text:'First retry answer'});calls[1].callbacks.result({success:true,text:'Finished retry',service:'deepseek',model:'fixture'});await tick();
    expect(host.querySelector('[data-reading-answer]')?.textContent).toBe('Finished retry');
    expect(host.querySelector('.fr-reading-footer')).not.toBeNull();expect(resize).toHaveBeenCalledTimes(3);
  });

  it('starts on activation and preserves ownership when the parent switches actions during the first resize',async()=>{
    const {host,calls,props,resize,panel}=await mountPanel({active:false});
    expect(calls).toHaveLength(0);expect(resize).not.toHaveBeenCalled();
    props.active=true;await tick();expect(calls).toHaveLength(1);flushFrame();flushFrame();resize.mockClear();
    const first=calls[0];resize.mockImplementationOnce(()=>panel.startAction('grammar'));
    first.callbacks.progress({kind:'text',text:'First answer triggers a parent action switch'});await tick();
    expect(calls).toHaveLength(2);expect(calls[1].request.intent).toBe('grammar');expect(first.cancel).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-reading-answer]')).toBeNull();expect(resize).toHaveBeenCalledTimes(2);
    first.callbacks.progress({kind:'text',text:'Late previous action'});first.callbacks.error(new Error('Late previous error'));await tick();
    expect(resize).toHaveBeenCalledTimes(2);expect(host.querySelector('[role="alert"]')).toBeNull();
    calls[1].callbacks.progress({kind:'text',text:'Grammar partial'});calls[1].callbacks.error(new Error('Grammar interrupted'));await tick();
    expect(host.querySelector('[data-reading-answer]')?.textContent).toBe('Grammar partial');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Grammar interrupted');expect(resize).toHaveBeenCalledTimes(3);
  });

  it('preserves manual source scrolling and late translation answer offsets during chunk updates',async()=>{
    const {host,calls,panel,props,viewport,window,resize,finish}=await mountPanel({sourceTranslation:{source:'Practice helps.',text:'',pending:true}});
    Object.defineProperty(panel.answerBody,'offsetTop',{configurable:true,get:()=>host.querySelector('.fr-reading-translation p')?.textContent==='练习有帮助。'?160:100});
    flushFrame();flushFrame();viewport.scrollTop=120;
    props.sourceTranslation={source:'Practice helps.',text:'练习有帮助。'};await tick();expect(viewport.scrollTop).toBe(180);
    calls[0].callbacks.progress({kind:'text',text:'First answer'});await tick();resize.mockClear();
    viewport.scrollTop=0;viewport.dispatchEvent(new window.Event('wheel',{bubbles:true}));
    for(let index=0;index<12;index++){calls[0].callbacks.progress({kind:'text',text:`Manual reading ${index}`});await tick();expect(viewport.scrollTop).toBe(0);}
    expect(resize).not.toHaveBeenCalled();finish('Manual reading complete');await tick();expect(viewport.scrollTop).toBe(0);
    expect(host.querySelector('.fr-reading-source p')?.textContent).toBe('Practice helps.');
    expect(host.querySelector('.fr-reading-translation p')?.textContent).toBe('练习有帮助。');
  });

  it('rejects old stream work after hide, reactivation, source replacement and unmount',async()=>{
    const {host,calls,props,resize,panel,unmount}=await mountPanel();flushFrame();flushFrame();
    const hidden=calls[0];hidden.callbacks.progress({kind:'text',text:'Visible partial'});await tick();
    props.active=false;await tick();expect(hidden.cancel).toHaveBeenCalledOnce();resize.mockClear();
    hidden.callbacks.progress({kind:'text',text:'Late hidden'});hidden.callbacks.result({success:true,text:'Late complete',service:'deepseek',model:'fixture'});await tick();
    expect(host.querySelector('[data-reading-answer]')?.textContent).toBe('Visible partial');expect(resize).not.toHaveBeenCalled();
    props.active=true;await tick();expect(calls).toHaveLength(2);const replaced=calls[1];
    props.selection={text:'Another source.',sentence:'Another source.',context:'Another source in context.'};await tick();resize.mockClear();
    replaced.callbacks.progress({kind:'text',text:'Old source delta'});replaced.callbacks.error(new Error('Old source error'));await tick();
    expect(host.querySelector('.fr-reading-source p')?.textContent).toBe('Another source.');
    expect(host.querySelector('[data-reading-answer]')).toBeNull();expect(resize).not.toHaveBeenCalled();
    panel.startAction('meaning');await tick();const removed=calls.at(-1)!;unmount();resize.mockClear();
    removed.callbacks.progress({kind:'text',text:'After unmount'});removed.callbacks.error(new Error('After unmount'));await tick();
    expect(removed.cancel).toHaveBeenCalledOnce();expect(resize).not.toHaveBeenCalled();expect(host.querySelector('[data-reading-panel]')).toBeNull();expect(host.querySelector('.fr-reading-controls')).toBeNull();
  });
});

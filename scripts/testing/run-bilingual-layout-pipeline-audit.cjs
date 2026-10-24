#!/usr/bin/env node
/**
 * @file scripts/testing/run-bilingual-layout-pipeline-audit.cjs
 * 文件职责：在临时后台 Edge 中对真实扩展执行排版回归，覆盖宿主固有栏宽、nowrap、列表、多栏及纯文本 flex/grid。
 * 主要内容：本地 HTTP 夹具、受控中文供应商、真实 Control/Alt+T、译文前后置、两轮全文和精确恢复、外观刷新、动态禁译与请求稳定性；记录 Runtime 诊断和逐字符几何。
 * 模块边界：只经公开配置消息和普通页面手势驱动扩展，不调用产品内部翻译函数，不连接日常 profile；受控响应不证明在线服务质量。
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const root = path.resolve(arg('project-root', path.join(__dirname, '../..')));
const extensionDir = path.resolve(arg('extension-dir', path.join(root, '.output/chrome-mv3')));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-layout-pipeline-audit'));
const timeout = Number(arg('timeout', '60000'));
const playwrightRoot = arg('playwright-root', '');
assert.ok(playwrightRoot, '--playwright-root required');
assert.ok(Number.isFinite(timeout) && timeout >= 1000 && timeout <= 180000, 'timeout must be 1000–180000');
assert.ok(!process.argv.includes('--headed') && !process.argv.includes('--headless'), 'Only focus-safe background Edge is permitted');
const {chromium} = require(path.join(playwrightRoot, 'playwright'));
const helper = require(path.join(root, 'scripts/testing/focus-safe-browser.cjs'));
const {guardBrowserClose} = require(path.join(root, 'scripts/testing/owned-browser-close.cjs'));
const {assertFreshProductionExtension} = require(path.join(root, 'scripts/run-site-translation-test.cjs'));
const {createRuntimeDiagnostics, finalizeRun} = require(arg('runtime-diagnostics-helper', path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills/fluentread-browser-translation-test/scripts/runtime-diagnostics.cjs')));
const diagnostics = createRuntimeDiagnostics();
fs.mkdirSync(artifactsDir, {recursive: true});
const report = {ok:false, scope:'Controlled local fixtures through the actual production extension', provider:'microsoft-controlled-Chinese', limitations:['This controlled run does not establish online provider quality or latency.'], stages:[], snapshots:[], gestures:[], requests:[]};
const save = () => fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
const progress = message => {report.stage=message; report.stages.push({message,time:new Date().toISOString()}); save(); process.stderr.write(`[layout-pipeline] ${message}\n`);};
async function bounded(action, ms, label) {let timer; try {return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${label} timed out after ${ms}ms`)),ms);})]);} finally {clearTimeout(timer);}}
const originalFlush=diagnostics.flush, originalStop=diagnostics.stop;
diagnostics.flush=()=>bounded(originalFlush,7000,'diagnostics-flush'); diagnostics.stop=()=>bounded(originalStop,7000,'diagnostics-stop');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-layout-pipeline-'));
report.profileDir=profileDir;
let session, page, popup, server, worker, configSequence=0, fixtureUrl;
const workers=new Set(), installedWorkers=new WeakMap();
const cases = [
  {id:'nowrap',kind:'block',html:'<p id="owner-nowrap" style="width:320px;white-space:nowrap;text-wrap:nowrap">A calm river flows beside the quiet village.</p>'},
  {id:'auto-table',kind:'table',html:'<table><tbody><tr><td><p id="owner-auto-table">A calm river flows beside the <a class="source-link" href="/reference">quiet village</a>.</p></td><td id="peer-auto-table" translate="no">Stable peer</td></tr></tbody></table>'},
  {id:'inline-block',kind:'intrinsic',html:'<p id="owner-inline-block" style="display:inline-block">A calm river flows beside the quiet village.</p><span id="peer-inline-block" translate="no"> Stable peer</span>'},
  {id:'float',kind:'intrinsic',html:'<blockquote id="owner-float" style="float:left;max-width:320px;margin:0">A calm river flows beside the quiet village.</blockquote><p id="peer-float" translate="no" style="margin:0">Stable neighboring text follows the floating quotation and remains readable.</p><div style="clear:both" translate="no"></div>'},
  {id:'pure-flex',kind:'flex',html:'<div id="owner-pure-flex" style="display:flex;gap:18px;width:420px">A calm river flows beside the quiet village.</div>'},
  {id:'pure-grid',kind:'grid',html:'<div id="owner-pure-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:18px;width:420px">A calm river flows beside the quiet village.</div>'},
  {id:'list-outside',kind:'list',html:'<ul style="width:320px;margin:0;padding-left:24px;list-style-position:outside"><li id="owner-list-outside">A calm river flows beside the <a class="source-link" href="/reference">quiet village</a>.</li></ul>'},
  {id:'list-inside',kind:'list',html:'<ul style="width:320px;margin:0;padding-left:24px;list-style-position:inside"><li id="owner-list-inside">A calm river flows beside the quiet village.</li></ul>'},
  {id:'list-inside-icon',kind:'list',html:`<ul style="width:320px;margin:0;padding-left:24px;list-style-position:inside"><li id="owner-list-inside-icon"><img alt="" width="24" height="18" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='18'%3E%3Crect width='24' height='18' fill='%23999'/%3E%3C/svg%3E">A calm river flows beside the quiet village.</li></ul>`},
  {id:'list-inside-padded-link',kind:'list',html:'<ul style="width:320px;margin:0;padding-left:24px;list-style-position:inside"><li id="owner-list-inside-padded-link"><a class="source-link" href="/reference" style="padding-left:12px">A calm river</a> flows beside the quiet village.</li></ul>'},
  {id:'columns',kind:'columns',html:'<div style="column-count:2;column-gap:24px;width:420px"><p id="owner-columns" style="margin:0">'+('A calm river flows beside the quiet village. '.repeat(4))+'</p></div>'},
  {id:'ordinary',kind:'block',html:'<p id="owner-ordinary" style="width:320px">A calm river flows beside the <a class="source-link" href="/reference">quiet village</a>.</p>'},
];
const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FluentRead layout pipeline fixture</title><style>body{font:16px/1.5 Arial,sans-serif;margin:20px}.case{margin:0 0 28px;max-width:940px}.case-title{font:600 13px/1.4 Arial;margin:0 0 8px;color:#555}p{margin:0}table{border-collapse:collapse}td{padding:0 8px 0 0;vertical-align:top}a{color:#145ca0}.case:after{content:"";display:block;clear:both}</style></head><body><main>'+cases.map(item=>`<section class="case" id="case-${item.id}"><h2 class="case-title" translate="no">${item.id}</h2>${item.html}</section>`).join('')+'</main></body></html>';
async function patchConfig(updates) {
  const result=await bounded(()=>popup.evaluate(async({updates,sequence})=>{
    const stored=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});if(!stored.success)throw Error(stored.error);
    const current=typeof stored.value==='string'?JSON.parse(stored.value):stored.value;
    return chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',config:updates,expected:Object.fromEntries(Object.keys(updates).map(key=>[key,current[key]])),clientId:'layout-pipeline-audit',sequence,baseRevision:current.__fluentConfigRevision});
  },{updates,sequence:++configSequence}),12000,'persist-config');
  assert.equal(result.success,true,JSON.stringify(result));
}
async function installWorker(target){
  if(installedWorkers.has(target))return installedWorkers.get(target);workers.add(target);
  const pending=bounded(()=>target.evaluate(()=>{
    globalThis.__layoutAuditRequests=[];globalThis.__layoutAuditReject=false;const original=globalThis.fetch.bind(globalThis);
    const decode=value=>value.replace(/&#(?:0*39);|&#x0*27;/gi,"'").replace(/&quot;/gi,'"').replace(/&gt;/gi,'>').replace(/&lt;/gi,'<').replace(/&amp;/gi,'&');
    const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const chinese=source=>{if(!source.trim())return source;const entities=source.match(/&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/gu)||[];const phrase='这是一段用于检查双语译文排版的中文说明，正文需要在原有栏宽中自然换行，保持页面链接与相邻内容的位置。';const length=Math.max(32,Math.min(2000,Math.ceil(source.length*.75)));return phrase.repeat(Math.ceil(length/phrase.length)).slice(0,length)+(entities.length?' '+entities.join(' '):'');};
    globalThis.fetch=async(input,init)=>{const address=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);if(address.hostname!=='edge.microsoft.com'||address.pathname!=='/translate/translatetext')return original(input,init);const texts=JSON.parse(init?.body??await input.text());globalThis.__layoutAuditRequests.push(...texts);if(globalThis.__layoutAuditReject)return new Response(JSON.stringify({error:{code:400,message:'Controlled layout audit retry rejection'}}),{status:400,headers:{'content-type':'application/json'}});return new Response(JSON.stringify(texts.map(text=>({translations:[{text:escape(decode(text).split(/(___FLUENTREAD_[a-z0-9_-]+_(?:0|[1-9]\d*)_(?:BEGIN|END)___)/giu).map(part=>/^___FLUENTREAD_[a-z0-9_-]+_(?:0|[1-9]\d*)_(?:BEGIN|END)___$/iu.test(part)?part:chinese(part)).join(''))}]}))),{status:200,headers:{'content-type':'application/json'}});};
  }),12000,'install-controlled-provider');installedWorkers.set(target,pending);return pending;
}
async function requests(){const all=[];for(const target of workers)all.push(...await bounded(()=>target.evaluate(()=>globalThis.__layoutAuditRequests||[]),3000,'read-provider-requests'));return all;}
async function prepareFixture(){
  return page.evaluate(cases=>{
    const records=cases.map(item=>{
      const root=document.getElementById(`case-${item.id}`),owner=document.getElementById(`owner-${item.id}`),peer=document.getElementById(`peer-${item.id}`);
      const allNodes=[root,...root.querySelectorAll('*')];const elements=allNodes.map(node=>({node,children:[...node.childNodes]}));
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),texts=[];let text;while((text=walker.nextNode()))texts.push({node:text,value:text.data});
      const links=[...root.querySelectorAll('a')].map(node=>{let clicks=0;node.addEventListener('click',event=>{event.preventDefault();clicks++;});return{node,html:node.outerHTML,href:node.href,clicks:()=>clicks};});
      const sourceTexts=texts.filter(entry=>owner.contains(entry.node));
      const first=sourceTexts.find(entry=>/\S/u.test(entry.value));const offset=first.value.search(/\S/u),range=document.createRange();range.setStart(first.node,offset);range.setEnd(first.node,offset+1);
      const source=range.getBoundingClientRect(),box=owner.getBoundingClientRect(),style=getComputedStyle(owner);
      const border=parseFloat(style.borderLeftWidth)||0,padding=parseFloat(style.paddingLeft)||0,left=box.left+border+padding;
      const columnWidth=item.kind==='grid'?parseFloat(style.gridTemplateColumns.split(' ')[0]):item.kind==='columns'?(box.width-24)/2:box.width;
      const firstOriginal=owner.firstChild;const firstOriginalLeft=firstOriginal?.nodeType===1?[...firstOriginal.getClientRects()].find(rect=>rect.width&&rect.height)?.left:source.left;const baseline={sourceWithoutMarkerLeft:source.left-(firstOriginalLeft??source.left)+left,sourceOffsetTop:source.top-box.top,sourceLineHeight:parseFloat(style.lineHeight),sourceFontSize:parseFloat(style.fontSize),sourceLeft:source.left,ownerLeft:box.left,ownerRight:box.right,ownerWidth:box.width,columnLeft:left,columnWidth,columnGap:item.kind==='columns'?24:0,peerLeft:peer?.getBoundingClientRect().left??null,documentWidth:document.documentElement.scrollWidth};
      return{...item,root,owner,peer,elements,texts,sourceTexts,links,html:root.innerHTML,baseline};
    });window.__layoutPipeline={records};
    return records.map(({id,kind,baseline,html})=>({id,kind,baseline,html}));
  },cases);
}
async function snapshot(label){
  const value=await bounded(()=>page.evaluate(()=>{
    const wrap='.fluent-read-bilingual-content';const owned='[data-fr-translation-owned="true"],.fluent-read-loading,.fluent-read-retry-wrapper';
    const firstSource=record=>{const entry=record.sourceTexts.find(entry=>/\S/u.test(entry.node.data));if(!entry)return null;const offset=entry.node.data.search(/\S/u),range=document.createRange();range.setStart(entry.node,offset);range.setEnd(entry.node,offset+1);const rect=range.getBoundingClientRect();return{left:rect.left,top:rect.top,right:rect.right};};
    const normalizedHtml=root=>{const clone=root.cloneNode(true);clone.querySelectorAll(owned).forEach(node=>node.remove());clone.querySelectorAll('[data-fr-translation-segment],.fluent-read-source-line').forEach(node=>node.replaceWith(...node.childNodes));return clone.innerHTML;};
    const rows=window.__layoutPipeline.records.map(record=>{
      const wrappers=[...record.root.querySelectorAll(wrap)],source=firstSource(record),ownerBox=record.owner.getBoundingClientRect();
      const sourceInAllowedColumn=source&&(record.kind==='columns'?[0,1].some(column=>Math.abs(source.left-(record.baseline.columnLeft+column*(record.baseline.columnWidth+record.baseline.columnGap)))<=2):record.id.startsWith('list-inside')?[record.baseline.sourceLeft,record.baseline.sourceWithoutMarkerLeft].some(left=>Math.abs(source.left-left)<=2):Math.abs(source.left-record.baseline.sourceLeft)<=2);
      const content=wrappers.map(node=>{
        const rects=[...node.getClientRects()].filter(rect=>rect.width&&rect.height).map(rect=>({left:rect.left,right:rect.right,width:rect.width}));
        const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),lines=[];let text,count=0;
        while((text=walker.nextNode()))for(const match of text.data.matchAll(/\S/gu)){
          if(++count>12000)throw Error('glyph budget exceeded');const range=document.createRange();range.setStart(text,match.index);range.setEnd(text,match.index+match[0].length);const rect=range.getBoundingClientRect();if(!rect.width||!rect.height)continue;
          const column=record.kind==='columns'?Math.max(0,Math.round((rect.left-record.baseline.columnLeft)/(record.baseline.columnWidth+record.baseline.columnGap))):0;
          const line=lines.find(line=>line.column===column&&Math.min(line.bottom,rect.bottom)-Math.max(line.top,rect.top)>Math.min(line.bottom-line.top,rect.height)/2);
          if(line){line.left=Math.min(line.left,rect.left);line.right=Math.max(line.right,rect.right);}else lines.push({column,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom});
        }
        const contentStyle=getComputedStyle(node),box=node.getBoundingClientRect();const sourceColumn=record.kind==='columns'?Math.max(0,Math.round((source.left-record.baseline.columnLeft)/(record.baseline.columnWidth+record.baseline.columnGap))):0;const comesFirst=record.kind==='columns'&&lines[0]?.column!==sourceColumn?lines[0]?.column<sourceColumn:lines[0]?.top<source?.top;const markerLine={blockTopOffset:box.top-ownerBox.top,glyphTopOffset:lines[0]?.top-ownerBox.top,expectedGlyphTop:record.baseline.sourceOffsetTop+8+(parseFloat(contentStyle.paddingTop)||0)+(parseFloat(contentStyle.borderTopWidth)||0)+Math.max(0,((parseFloat(contentStyle.lineHeight)||record.baseline.sourceLineHeight)-record.baseline.sourceLineHeight)/2)+Math.max(0,(parseFloat(contentStyle.fontSize)||record.baseline.sourceFontSize)-record.baseline.sourceFontSize)};const glyphOverflows=lines.filter(line=>line.right>record.baseline.columnLeft+line.column*(record.baseline.columnWidth+record.baseline.columnGap)+record.baseline.columnWidth+2);
        return{className:node.className,chinese:/[\u3400-\u9fff]/u.test(node.textContent),whiteSpace:getComputedStyle(node).whiteSpace,textWrap:getComputedStyle(node).textWrap,rects,lines,glyphOverflows,fragmentOverflows:rects.filter(rect=>rect.width>record.baseline.columnWidth+2),comesFirst,markerLine};
      });
      return{id:record.id,kind:record.kind,baseline:record.baseline,source,sourceInAllowedColumn,ownerWidth:ownerBox.width,ownerWidthDelta:ownerBox.width-record.baseline.ownerWidth,peerLeft:record.peer?.getBoundingClientRect().left??null,peerDelta:record.peer?record.peer.getBoundingClientRect().left-record.baseline.peerLeft:null,wrapperCount:wrappers.length,content,sourceHtmlExact:normalizedHtml(record.root)===record.html,restoredHtmlExact:record.root.innerHTML===record.html,textIdentityExact:record.texts.every(({node,value})=>node.isConnected&&record.root.contains(node)&&node.data===value),elementIdentityExact:record.elements.every(({node})=>node.isConnected&&record.root.contains(node)),restoredChildrenExact:record.elements.every(({node,children})=>node.childNodes.length===children.length&&children.every((child,index)=>node.childNodes[index]===child)),linksExact:record.links.every(({node,html,href})=>node.isConnected&&node.outerHTML===html&&node.href===href)};
    });
    return{url:location.href,rows,wrappers:document.querySelectorAll(wrap).length,nested:document.querySelectorAll(`${wrap} ${wrap}`).length,duplicateParents:[...document.querySelectorAll(wrap)].filter(node=>[...node.parentElement.children].filter(child=>child.matches(wrap)).length>1).length,retry:document.querySelectorAll('.fluent-read-retry-wrapper').length,loading:document.querySelectorAll('.fluent-read-loading').length};
  }),12000,`snapshot-${label}`); report.snapshots.push({label,...value});save();return value;
}
function assertSnapshot(value,{translatedIds=[],restored=false,before=false}={}){
  assert.equal(value.url,fixtureUrl,'Fixture navigation changed');assert.equal(value.nested,0,'Nested translations');assert.equal(value.duplicateParents,0,'Duplicate sibling translations');assert.equal(value.retry,0,'Retry UI appeared');
  for(const row of value.rows){
    assert.equal(row.textIdentityExact,true,`${row.id}: original Text changed`);assert.equal(row.elementIdentityExact,true,`${row.id}: original elements detached`);assert.equal(row.linksExact,true,`${row.id}: link identity changed`);
    if(restored){assert.equal(row.wrapperCount,0,`${row.id}: stale translation`);assert.equal(row.restoredHtmlExact,true,`${row.id}: HTML not restored`);assert.equal(row.restoredChildrenExact,true,`${row.id}: original child identities/order not restored`);continue;}
    const expected=translatedIds.includes(row.id)?1:0;assert.equal(row.wrapperCount,expected,`${row.id}: translation count differs`);
    if(!expected)continue;
    assert.equal(row.sourceHtmlExact,true,`${row.id}: normalized source HTML changed`);assert.equal(row.sourceInAllowedColumn,true,`${row.id}: source moved horizontally`);assert.ok(Math.abs(row.ownerWidthDelta)<=2,`${row.id}: original column width changed ${row.ownerWidthDelta}px`);if(row.peerDelta!==null)assert.ok(Math.abs(row.peerDelta)<=2,`${row.id}: neighbor shifted ${row.peerDelta}px`);
    for(const content of row.content){assert.equal(content.chinese,true,`${row.id}: no Chinese translation`);assert.ok(content.lines.length>1,`${row.id}: long Chinese did not naturally wrap`);assert.equal(content.glyphOverflows.length,0,`${row.id}: translated glyphs overflow original column`);assert.equal(content.fragmentOverflows.length,0,`${row.id}: translated block exceeds original column`);assert.equal(content.comesFirst,before,`${row.id}: wrong translation order`);if(before&&row.id.startsWith('list-inside')){assert.ok(content.markerLine.blockTopOffset<=10,`inside marker left an empty first line: block offset ${content.markerLine.blockTopOffset}px`);assert.ok(content.markerLine.glyphTopOffset<=content.markerLine.expectedGlyphTop+2,`inside marker left a blank source line before first glyph: ${JSON.stringify(content.markerLine)}`);}}
  }
}
const presetClasses={1:'fluent-display-bold',9:'fluent-display-paper',38:'fluent-display-line-pill',46:'fluent-display-chat-bubble'};
function assertActualStyle(value,style){for(const row of value.rows)for(const content of row.content)assert.ok(content.className.split(/\s/u).includes(presetClasses[style]),`${row.id}: expected style ${style}/${presetClasses[style]}, saw ${content.className}`);}
async function translatedPreset(style,before){
  const label=`fresh-preset-${style}-${before?'before':'after'}`;progress(label);diagnostics.setPhase(label);
  await patchConfig({style,translationBeforeOriginal:before,translationAppearance:{fontScale:100}});await page.waitForTimeout(300);
  await fullToggle();await waitCounts(cases.map(item=>item.id));const value=await snapshot(label);assertActualStyle(value,style);assertSnapshot(value,{translatedIds:cases.map(item=>item.id),before});await stableRequests(label);
  report.presets??=[];report.presets.push({label,style,expectedClass:presetClasses[style],actualClasses:[...new Set(value.rows.flatMap(row=>row.content.map(content=>content.className)))]});
  await page.screenshot({path:path.join(artifactsDir,`${label}.png`),fullPage:true});await fullToggle();await waitCounts([]);assertSnapshot(await snapshot(`${label}-restore`),{restored:true});
}
async function gesture(id){
  await bounded(()=>helper.activateExtensionTabWithoutForeground(session.context,page),12000,'activate-fixture');
  const position=await page.evaluate(id=>{
    const record=window.__layoutPipeline.records.find(record=>record.id===id);
    for(const {node} of record.sourceTexts){if(node.parentElement.closest('a,[data-fr-translation-owned="true"]'))continue;const index=node.data.search(/[A-Za-z]/u);if(index<0)continue;const range=document.createRange();range.setStart(node,index);range.setEnd(node,Math.min(node.data.length,index+12));let rect=range.getBoundingClientRect();scrollBy({top:rect.top-innerHeight/2,behavior:'instant'});rect=range.getBoundingClientRect();if(rect.width&&rect.height)return{x:rect.left+Math.min(8,rect.width/2),y:rect.top+rect.height/2};}throw Error(`${id}: source gesture position unavailable`);
  },id);
  await page.mouse.move(position.x,position.y);await page.mouse.click(position.x,position.y);await page.keyboard.down('Control');await page.keyboard.up('Control');
}
async function fullToggle(){await bounded(()=>helper.activateExtensionTabWithoutForeground(session.context,page),12000,'activate-fixture');await page.keyboard.down('Alt');await page.keyboard.press('t');await page.keyboard.up('Alt');}
async function waitCounts(ids){await page.waitForFunction(ids=>{if(document.querySelector('.fluent-read-retry-wrapper'))throw Error('Translation entered retry');return window.__layoutPipeline.records.every(record=>record.root.querySelectorAll('.fluent-read-bilingual-content').length===(ids.includes(record.id)?1:0))&&document.querySelectorAll('.fluent-read-loading').length===0;},ids,{timeout,polling:250});}
async function linkEvents(label){const entries=await page.evaluate(()=>window.__layoutPipeline.records.flatMap(record=>record.links.map(link=>{const before=link.clicks();link.node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));return{id:record.id,delivered:link.clicks()===before+1};})));entries.forEach(entry=>assert.equal(entry.delivered,true,`${label}/${entry.id}: link listener lost`));report.linkEvents??=[];report.linkEvents.push({label,entries});}
async function stableRequests(label){const first=(await requests()).length;await page.waitForTimeout(900);const second=(await requests()).length;assert.equal(second,first,`${label}: unexpected repeated provider requests`);report.requestStability??=[];report.requestStability.push({label,first,second});save();}
async function dynamicNoTranslate(before){
  diagnostics.setPhase('pure-flex-dynamic-notranslate');const initial=(await requests()).length;
  await page.locator('#owner-pure-flex').evaluate(node=>node.setAttribute('translate','no'));await waitCounts(cases.map(item=>item.id).filter(id=>id!=='pure-flex'));
  const disabled=await snapshot('pure-flex-notranslate');assertSnapshot(disabled,{translatedIds:cases.map(item=>item.id).filter(id=>id!=='pure-flex'),before});await stableRequests('pure-flex-protected');
  assert.equal((await requests()).length,initial,'Protected pure flex requested translation');
  await page.locator('#owner-pure-flex').evaluate(node=>node.removeAttribute('translate'));await waitCounts(cases.map(item=>item.id));
  assertSnapshot(await snapshot('pure-flex-reenabled'),{translatedIds:cases.map(item=>item.id),before});const after=(await requests()).length;assert.ok(after-initial<=1,`Pure flex reenable created ${after-initial} requests`);await stableRequests('pure-flex-reenabled');report.dynamicNoTranslate={initial,after};
}
async function retryPureFlex(){
  diagnostics.setPhase('pure-flex-controlled-retry');progress('pure flex controlled failure and retry');
  const checkpoint=diagnostics.checkpoint(),requestCount=(await requests()).length;
  await worker.evaluate(()=>{globalThis.__layoutAuditReject=true;});
  try{
    await gesture('pure-flex');await page.locator('#case-pure-flex .fluent-read-retry-wrapper').waitFor({state:'attached',timeout});
    report.retryFailure={requestCount:(await requests()).length-requestCount,synthetic:await page.locator('#case-pure-flex .fluent-read-source-line').count()};
    assert.ok(report.retryFailure.requestCount>=1&&report.retryFailure.requestCount<=3,'Controlled failure should have bounded provider attempts');
    await page.locator('#case-pure-flex .fluent-read-reason').click();report.retryFailure.reasons=await page.evaluate(()=>[...(document.querySelector('#fluent-read-page-notice-host')?.shadowRoot?.querySelectorAll('.notice-detail')||[])].map(node=>node.textContent));
  }finally{await worker.evaluate(()=>{globalThis.__layoutAuditReject=false;});}
  const oldRetry=await page.locator('#case-pure-flex .fluent-read-retry-wrapper').elementHandle();await page.locator('#case-pure-flex .fluent-read-retry').click();await page.waitForFunction(node=>!node.isConnected,oldRetry,{timeout:10000,polling:250});await waitCounts(['pure-flex']);assertSnapshot(await snapshot('pure-flex-retry-success'),{translatedIds:['pure-flex']});await stableRequests('pure-flex-retry-success');await page.screenshot({path:path.join(artifactsDir,'pure-flex-retry-success.png')});
  await gesture('pure-flex');await waitCounts([]);assertSnapshot(await snapshot('pure-flex-retry-restored'),{restored:true});
  await diagnostics.flush();report.retryDiagnostics=diagnostics.snapshot().entries.filter(entry=>entry.id>checkpoint);save();
}
async function main(){let primaryError;
  try{
    report.buildFreshness=assertFreshProductionExtension(extensionDir,root);report.contentSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir,'content-scripts/content.js'))).digest('hex');
    server=http.createServer((request,response)=>{if(request.url==='/favicon.ico'){response.writeHead(204);response.end();return;}response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(html);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));fixtureUrl=`http://127.0.0.1:${server.address().port}/layout-fixture`;report.url=fixtureUrl;
    progress('launch isolated background Edge');session=await helper.launchFocusSafePersistentContext({chromium,profileDir,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',background:true,headless:false,viewport:{width:1280,height:950},displayTarget:'secondary',browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check']});guardBrowserClose(session,profileDir);
    Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement,browserVersion:await session.context.browser().version()});assert.equal(report.launchMode,'macos-background-cdp');assert.equal(report.focusPolicy,'launchservices-no-foreground');assert.equal(report.windowPlacement.mode,'background-visible-no-focus');assert.equal(report.windowPlacement.browserFrontmost,false);
    await diagnostics.start(session.context);session.context.on('serviceworker',target=>{void installWorker(target).catch(error=>{report.workerSetupErrors??=[];report.workerSetupErrors.push(error.message);});});worker=session.context.serviceWorkers()[0]||await session.context.waitForEvent('serviceworker',{timeout});diagnostics.setExtensionId(new URL(worker.url()).host);await installWorker(worker);
    popup=await helper.newPageWithoutForeground(session.context);await diagnostics.attachPage(popup,'config-popup');await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    report.config={on:true,service:'microsoft',from:'en',to:'zh-Hans',display:1,style:1,translationBeforeOriginal:false,translationAppearance:{fontScale:100},longParagraphLineBreakEnabled:false,autoTranslate:false,translationScope:'content',hotkey:'Control',floatingBallHotkey:'Alt+T',fullPageTranslationMode:'all',mouseHoverTranslationDelay:0,useCache:false,enableAIContext:false,enableAIMultiSegment:false,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true};await patchConfig(report.config);
    page=await helper.newPageWithoutForeground(session.context);await diagnostics.attachPage(page,'layout-fixture');diagnostics.setPhase('fixture-load');await page.goto(fixtureUrl,{waitUntil:'domcontentloaded',timeout});await page.locator('#fluent-read-page-styles').waitFor({state:'attached',timeout});report.initial=await prepareFixture();assertSnapshot(await snapshot('initial'),{restored:true});await retryPureFlex();
    for(const before of [false,true]){
      await patchConfig({translationBeforeOriginal:before,style:1,translationAppearance:{fontScale:100}});await page.waitForTimeout(300);
      for(const item of cases){diagnostics.setPhase(`hover-${before?'before':'after'}-${item.id}`);progress(`Control ${before?'before':'after'} ${item.id}`);await gesture(item.id);await waitCounts([item.id]);assertSnapshot(await snapshot(`hover-${before}-${item.id}-translated`),{translatedIds:[item.id],before});await gesture(item.id);await waitCounts([]);assertSnapshot(await snapshot(`hover-${before}-${item.id}-restored`),{restored:true});report.gestures.push({before,id:item.id,counts:[1,0]});}
      for(let pass=1;pass<=2;pass++){
        diagnostics.setPhase(`full-${before}-${pass}`);progress(`Alt+T ${before?'before':'after'} pass ${pass}`);await fullToggle();await waitCounts(cases.map(item=>item.id));const fullValue=await snapshot(`full-${before}-${pass}`);assertActualStyle(fullValue,1);assertSnapshot(fullValue,{translatedIds:cases.map(item=>item.id),before});await linkEvents(`full-${before}-${pass}`);await stableRequests(`full-${before}-${pass}`);
        if(pass===1){const requestCount=(await requests()).length;await patchConfig({translationAppearance:{fontScale:125}});await page.waitForTimeout(1000);const refreshed=await snapshot(`appearance-font125-${before}`);assertActualStyle(refreshed,1);assertSnapshot(refreshed,{translatedIds:cases.map(item=>item.id),before});assert.equal((await requests()).length,requestCount,'Appearance refresh requested new translations');await stableRequests(`appearance-refresh-${before}`);await patchConfig({style:1,translationAppearance:{fontScale:100}});await page.waitForTimeout(700);if(!before)await dynamicNoTranslate(before);}
        await page.screenshot({path:path.join(artifactsDir,`full-${before}-${pass}.png`),fullPage:true});await fullToggle();await waitCounts([]);assertSnapshot(await snapshot(`restore-${before}-${pass}`),{restored:true});await linkEvents(`restore-${before}-${pass}`);
      }
    }
    for(const style of [9,38,46])await translatedPreset(style,true);
    diagnostics.setPhase('page-unload');await page.goto('about:blank',{timeout:10000});report.pageUnloaded=true;report.requests=await requests();await diagnostics.flush();diagnostics.assertClean();assert.deepEqual(report.workerSetupErrors||[],[]);report.ok=true;progress('pipeline assertions passed');
  }catch(error){primaryError=error;report.error=error.stack||String(error);progress('failure evidence');if(page&&!page.isClosed())for(const[label,action]of[['snapshot',async()=>{report.failureSnapshot=await snapshot('failure');}],['reason',async()=>{report.failureReasons=await page.evaluate(()=>{document.querySelector('.fluent-read-reason')?.click();return[...(document.querySelector('#fluent-read-page-notice-host')?.shadowRoot?.querySelectorAll('.notice-detail')||[])].map(node=>node.textContent);});}],['screenshot',()=>page.screenshot({path:path.join(artifactsDir,'failure.png'),timeout:4000})],['html',async()=>fs.writeFileSync(path.join(artifactsDir,'failure.html'),await page.content())]]){try{await bounded(action,6000,`failure-${label}`);}catch(failure){report.evidenceFailures??=[];report.evidenceFailures.push({label,error:failure.message});}save();}}
  finally{
    try{report.requests=await requests();}catch(error){report.requestReadError=error.message;report.ok=false;}
    await finalizeRun({diagnostics,result:report,artifactsDir,primaryError,cleanup:[{stage:'browser-close',action:async()=>{if(!session)return;try{await bounded(()=>session.close(),15000,'owned-browser-close');report.cleanupConfirmed=true;}catch(error){report.retainedProfile=profileDir;throw error;}}},{stage:'profile-cleanup',action:()=>{if(report.cleanupConfirmed){fs.rmSync(profileDir,{recursive:true,force:true});report.profileRemoved=true;}}},{stage:'server-close',action:()=>server?bounded(()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),3000,'server-close'):undefined}],emitReport:()=>{report.stage='finished';save();fs.writeFileSync(path.join(artifactsDir,'result.json'),JSON.stringify(report,null,2));}});
  }
  if(primaryError)throw primaryError;if(!report.ok)throw Error(report.error||'Layout pipeline finalization failed');process.stdout.write(JSON.stringify({ok:report.ok,artifactsDir,gestures:report.gestures.length,snapshots:report.snapshots.length,requests:report.requests.length})+'\n');
}
main().catch(error=>{process.stderr.write(`${error.stack||error}\n`);process.exitCode=1;setTimeout(()=>process.exit(1),1500).unref();});

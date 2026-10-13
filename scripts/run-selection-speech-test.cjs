#!/usr/bin/env node
// 划词朗读专项：生产扩展、真实媒体解码、稳定整词高亮及前后 5 秒跳转；只使用临时后台 Edge。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const support = require('./run-selection-trigger-test.cjs');
const arg = key => process.argv[process.argv.indexOf(`--${key}`) + 1];
const output = path.resolve(arg('artifacts-dir'));
const extensionDir = path.resolve(arg('extension-dir'));
const {chromium} = createRequire(path.join(arg('playwright-root'), 'package.json'))('playwright');
const helper = require(path.resolve(arg('focus-safe-helper')));
const sentence = "For this release, we’re publishing the results in a GitHub repository, with protocols for paper revisions and citations.";
const translation = '对于这个版本，我们将在 GitHub 存储库中发布结果，其中包含论文修订和引用协议。';
const report = {ok:false,providerEvidence:'Production extension with deterministic translation and a 20 second WAV response fixture. Actual offscreen media clock, decode and seek; no live voice alignment or speaker claim.',cases:[],screenshots:[],consoleErrors:[],positions:[]};
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
const record = name => {report.cases.push(name);console.log('PASS',name);};
let session, context, page, popup, worker;
const cls = name => node => support.hasCdpClass(node,name);
async function until(check,message) {for(let i=0;i<100;i++){if(await check())return;await wait(100);}throw new Error(message);}
async function getNode(predicate) {const {root}=await support.getSelectionUiTree(page);return support.findCdpNode(root,predicate);}
async function click(predicate) {
 const {session:cdp,root}=await support.getSelectionUiTree(page);const node=support.findCdpNode(root,predicate);assert(node,'UI control missing');
 const {model}=await cdp.send('DOM.getBoxModel',{nodeId:node.nodeId});const q=model.content;
 await page.mouse.click((q[0]+q[2]+q[4]+q[6])/4,(q[1]+q[3]+q[5]+q[7])/4);
}
async function inspect(fn) {
 const {session:cdp,root}=await support.getSelectionUiTree(page);const node=support.findCdpNode(root,cls('fr-translation-tooltip'));assert(node,'Selection card missing');
 const resolved=await cdp.send('DOM.resolveNode',{nodeId:node.nodeId});
 const result=await cdp.send('Runtime.callFunctionOn',{objectId:resolved.object.objectId,functionDeclaration:fn,returnByValue:true});
 assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;
}
async function position() {
 const data=await inspect(`function(){const value=this.querySelector('.fr-playback-time')?.textContent||'';const current=this.querySelector('.fr-original-text .fr-speech-current');return {time:value,active:current?.textContent||'',currentCount:this.querySelectorAll('.fr-original-text .fr-speech-current').length}}`);
 if(!data.time)return null;const [minutes,seconds]=data.time.split(' / ')[0].split(':').map(Number);return {...data,seconds:minutes*60+seconds};
}
async function screenshot(name) {
 const box=await inspect('function(){const r=this.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}');
 const file=path.join(output,name+'.png');await page.screenshot({path:file,clip:box});report.screenshots.push(file);
}
function wavFixture() {
 const rate=8000,count=rate*20,data=Buffer.alloc(44+count*2);
 data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(count*2,40);
 return data.toString('base64');
}
async function main() {
 fs.mkdirSync(output,{recursive:true});const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-selection-speech-'));
 try {
  session=await helper.launchFocusSafePersistentContext({chromium,profileDir,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:false,background:true,browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check','--mute-audio'],viewport:{width:1440,height:960}});
  context=session.context;Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement,extensionDir});
  const ready=await support.waitForWorker(context);worker=ready.worker;const id=ready.extensionId;
  const newPage=async()=>{const tab=await helper.newPageWithoutForeground(context);tab.on('pageerror',error=>report.consoleErrors.push(error.message));return tab;};
  popup=await newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
  const saved=await support.readStoredConfig(popup);
  await support.patchStoredConfig(popup,{on:true,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,theme:'light',service:'microsoft',from:'auto',to:'zh-Hans',selectionTranslatorMode:'bilingual',selectionTranslatorPresentation:'card',selectionTranslatorTrigger:'icon',selectionTranslatorDelay:0,selectionTranslatorAutoDismiss:false,selectionTtsMode:'online-only',disableSelectionTranslator:false,useCache:false,hotkey:'none',floatingBallHotkey:'none',harness:{...saved.harness,enabled:true}});
  await worker.evaluate(({audioBase64,translation})=>{
   const native=fetch.bind(globalThis);globalThis.__speechFixtureCalls=0;
   globalThis.fetch=async(input,init)=>{
    const url=String(input);globalThis.__speechFixtureUrls||=[];globalThis.__speechFixtureUrls.push(new URL(url).hostname);
    if(url.startsWith('https://edge.microsoft.com/translate/translatetext')){
     const texts=JSON.parse(init.body);return new Response(JSON.stringify(texts.map(()=>({translations:[{text:translation,to:'zh-Hans'}]}))),{headers:{'content-type':'application/json'}});
    }
    if(url.startsWith('https://dev.microsofttranslator.com/apps/endpoint'))return new Response(JSON.stringify({t:'speech-fixture',r:'fixture'}),{headers:{'content-type':'application/json'}});
    if(url.includes('.tts.speech.microsoft.com/cognitiveservices/v1')){
     globalThis.__speechFixtureCalls++;const bytes=Uint8Array.from(atob(audioBase64),char=>char.charCodeAt(0));return new Response(bytes,{headers:{'content-type':'audio/wav'}});
    }
    return native(input,init);
   };
  },{audioBase64:wavFixture(),translation});
  await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="en"><meta charset="utf-8"><title>Speech follow fixture</title><style>body{margin:60px;color:#253248;font:20px/1.8 system-ui}p{max-width:760px}@media(max-width:500px){body{margin:24px;font-size:16px}}</style><p id="sentence">${sentence}</p></html>`}));
  page=await newPage();await page.goto('https://example.com/speech');await page.locator('#fluent-read-selection-translator-container').waitFor({state:'attached'});await helper.activateExtensionTabWithoutForeground(context,page);
  const points=await page.evaluate(()=>{const text=document.querySelector('#sentence').firstChild,range=document.createRange();range.setStart(text,0);range.setEnd(text,1);const start=range.getBoundingClientRect();range.setStart(text,text.length-1);range.setEnd(text,text.length);const end=range.getBoundingClientRect();return {sx:start.left,sy:start.top+start.height/2,ex:end.right+2,ey:end.top+end.height/2};});
  await page.mouse.move(points.sx,points.sy);await page.mouse.down();await page.mouse.move(points.ex,points.ey,{steps:14});await page.mouse.up();
  await until(()=>getNode(cls('fr-selection-indicator')),'Selection entry missing');await click(cls('fr-selection-indicator'));
  await until(async()=>await getNode(cls('fr-translation-result')) && await inspect(`function(){return this.querySelector('.fr-translation-result pre').textContent}`)===translation,'Translation missing');
  const cardUi=await inspect(`function(){const navigation=this.querySelector('.fr-study-navigation');return {tabs:navigation?.querySelectorAll('.fr-study-toolbar button').length,close:!!navigation?.querySelector('.fr-close-btn'),share:!!navigation?.querySelector('.fr-share-card-entry'),header:!!this.querySelector('.fr-tooltip-header'),language:!!this.querySelector('[data-target-language]'),brand:!!this.querySelector('.fr-tooltip-brand-icon')}}`);
  assert(cardUi.tabs===6&&cardUi.close&&cardUi.share);
  assert(!cardUi.header&&!cardUi.language&&!cardUi.brand);
  record('translation card starts with action tabs and keeps share and close without a language header');
  const original=await inspect(`function(){this.__speechWordNodes=Array.from(this.querySelectorAll('.fr-original-text .fr-speech-word'));this.__speechWordRects=this.__speechWordNodes.map(node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height]});return this.querySelector('.fr-original-text pre').textContent}`);assert.equal(original,sentence);
  await click(node=>support.cdpAttribute(node,'aria-label')==='播放原文');
  await until(async()=>{const state=await position();return state&&state.time.endsWith('/ 0:20');},'Actual audio clock missing');
  const before=await position();await click(node=>support.cdpAttribute(node,'aria-label')==='前进 5 秒');
  await until(async()=>{const state=await position();return state&&state.seconds>=before.seconds+5;},'Forward did not seek 5 seconds');
  const forward=await position();assert(forward.seconds<=before.seconds+6);report.positions.push({before,forward});
  await screenshot('speech-follow-light');
  await click(node=>support.cdpAttribute(node,'aria-label')==='后退 5 秒');await until(async()=>{const state=await position();return state&&state.seconds<=forward.seconds-4;},'Rewind did not seek 5 seconds');
  const rewind=await position();report.positions.push({rewind});assert.equal(await worker.evaluate(()=>globalThis.__speechFixtureCalls),1);record('actual decoded media seeks forward/backward 5 seconds without synthesizing again');
  const stable=await inspect(`function(){const nodes=Array.from(this.querySelectorAll('.fr-original-text .fr-speech-word'));return {sameNodes:nodes.every((node,i)=>node===this.__speechWordNodes[i]),sameLayout:nodes.every((node,i)=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height].every((value,j)=>Math.abs(value-this.__speechWordRects[i][j])<.1)}),text:this.querySelector('.fr-original-text pre').textContent,currentCount:this.querySelectorAll('.fr-original-text .fr-speech-current').length}}`);
  assert(stable.sameNodes);assert(stable.sameLayout);assert.equal(stable.text,sentence);assert.equal(stable.currentCount,1);record('current word stays whole and word nodes, original text and line layout remain stable');
  await support.patchStoredConfig(popup,{theme:'dark'});await wait(350);await screenshot('speech-follow-dark');
  const style=await inspect(`function(){const current=this.querySelector('.fr-speech-current');const s=getComputedStyle(current);return {display:s.display,border:s.borderBottomWidth,color:s.backgroundColor,transition:s.transitionProperty}}`);assert.equal(style.display,'inline');assert.equal(style.border,'0px');assert.equal(style.transition,'background-color');assert.notEqual(style.color,'rgba(0, 0, 0, 0)');record('neutral full word background supports dark theme without width sweep or underline');
  await page.setViewportSize({width:390,height:800});await wait(250);await screenshot('speech-follow-390');
  const layout=await inspect(`function(){const card=this.getBoundingClientRect(),buttons=Array.from(this.querySelectorAll('.fr-playback-controls button')).map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}});return {card:{left:card.left,right:card.right},buttons,viewport:innerWidth}}`);assert(layout.card.left>=0&&layout.card.right<=layout.viewport+1);assert(layout.buttons.every(button=>button.left>=layout.card.left&&button.right<=layout.card.right));for(let i=1;i<layout.buttons.length;i++)assert(layout.buttons[i].left>=layout.buttons[i-1].right);report.narrowLayout=layout;record('5 second controls fit the 390px card without overlap');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await inspect(`function(){return getComputedStyle(this.querySelector('.fr-speech-word')).transitionDuration}`),'0s');record('reduced motion disables highlight animation');
  await click(node=>support.cdpAttribute(node,'aria-label')==='停止播放');await until(async()=>!(await getNode(cls('fr-speech-current'))),'Stop left highlight');
  assert.equal(await getNode(cls('fr-playback-time')),null);await wait(400);assert.equal(await getNode(cls('fr-speech-current')),null);record('stop clears highlight and clock and prevents delayed progress from returning');
  await support.patchStoredConfig(popup,{uiLanguage:'en-US'});await wait(350);
  await click(node=>support.hasCdpClass(node,'fr-text-audio-btn') && /^Play /.test(support.cdpAttribute(node,'aria-label')||''));
  await until(()=>getNode(node=>support.cdpAttribute(node,'aria-label')==='Forward 5 seconds'),'English seek label missing');
  assert(await getNode(node=>support.cdpAttribute(node,'aria-label')==='Rewind 5 seconds'));record('English seek controls use localized accessible names');
  for(let i=0;i<4;i++){if(!await getNode(node=>support.cdpAttribute(node,'aria-label')==='Forward 5 seconds'))break;await click(node=>support.cdpAttribute(node,'aria-label')==='Forward 5 seconds');await wait(200);}
  await until(async()=>!(await getNode(cls('fr-playback-time'))),'Seeking to the end did not finish playback');
  assert.equal(await getNode(cls('fr-speech-current')),null);record('repeated 5 second seeks clamp to the real end and clear playback');
  assert.deepEqual(report.consoleErrors,[]);report.ok=true;
 } catch(error) {
  report.error=error.stack||String(error);
  if(page){report.failureUi=support.cdpText((await support.getSelectionUiTree(page)).root);await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}
  if(worker)report.fixtureFetch=await worker.evaluate(()=>({hosts:globalThis.__speechFixtureUrls,calls:globalThis.__speechFixtureCalls})).catch(()=>null);
  throw error;
 }
 finally {fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));if(session)await session.close();fs.rmSync(profileDir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});

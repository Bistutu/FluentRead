// 真实生产扩展的工具栏状态回归；只使用临时 profile 与确定性供应商响应。
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const argument=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1]};
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const {execFileSync}=require('child_process');
const {chromium}=require(path.join(argument('playwright-root','/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'playwright'));
const helper=require(argument('focus-safe-helper',path.join(__dirname, 'focus-safe-browser.cjs')));
const out=path.resolve(argument('artifacts-dir','/private/tmp/fluentread-toolbar-status')),ext=path.resolve(argument('extension-dir','.output/chrome-mv3'));fs.mkdirSync(out,{recursive:true});
const windowQuery=argument('window-query',null);
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-edge-profile-toolbar-'));
const id=crypto.createHash('sha256').update(ext).digest('hex').slice(0,32).replace(/[0-9a-f]/g,x=>String.fromCharCode(97+parseInt(x,16)));

const report={profile,expectedId:id,scope:'Production extension; local page fixture and deterministic provider responses',cases:[],errors:[]};
const nativeBadges={idle:{text:''},translating:{text:'…',background:[37,99,235,255]},translated:{text:'✓',background:[21,128,61,255]},error:{text:'!',background:[180,83,9,255]}};
let session, primaryError, launchAttempted = false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 try{
 fs.mkdirSync(path.join(profile,'Default'));
 fs.writeFileSync(path.join(profile,'Default','Preferences'),JSON.stringify({translate:{enabled:false},extensions:{toolbar:[id],pinned_extensions:[id]},browser:{has_seen_welcome_page:true}}));
 launchAttempted = true;
 session=await helper.launchFocusSafePersistentContext({chromium,profileDir:profile,browserPath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',background:true,headless:false,viewport:{width:1120,height:780},displayTarget:'secondary',timeout:30000,browserArgs:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-features=msEdgeTranslate,msEdgeUpdateNotifications']});
 guardBrowserClose(session, profile);
 Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement});
 const context=session.context;
 let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 report.browser=await context.browser().version();report.actualId=new URL(worker.url()).host;
 await worker.evaluate(()=>{globalThis.reviewMode='success';globalThis.reviewRequests=0;globalThis.reviewPending=[];const originalFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,globalThis.location.href);if(url.protocol==='chrome-extension:')return originalFetch(input,init);globalThis.reviewRequests++;if(globalThis.reviewMode==='pending')await new Promise(r=>globalThis.reviewPending.push(r));if(globalThis.reviewMode==='failure')return new Response('Review simulated service failure',{status:503});const origins=JSON.parse(init?.body??await input.text());return new Response(JSON.stringify(origins.map(()=>({translations:[{text:'这是一段中文译文，用于验证工具栏翻译状态。'}]}))),{status:200,headers:{'content-type':'application/json'}});};});
 const popup=await helper.newPageWithoutForeground(context);await popup.goto(`chrome-extension://${report.actualId}/popup.html`);await sleep(800);
 let sequence=0;
 async function patch(updates){const r=await popup.evaluate(async({updates,sequence})=>{const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof r.value==='string'?JSON.parse(r.value):r.value;return chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',config:updates,expected:Object.fromEntries(Object.keys(updates).map(k=>[k,c[k]])),clientId:'pr523-review',sequence,baseRevision:c.__fluentConfigRevision});},{updates,sequence:++sequence});assert.equal(r.success,true);await sleep(400);}
 await patch({service:'microsoft',to:'zh-Hans',on:true,useCache:false,animations:false,display:1,translationScope:'content',fullPageTranslationMode:'viewport',enableAIContext:false,enableAIMultiSegment:false,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true});
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FluentRead PR 523 — Badge review</title><style>body{font:22px/1.7 system-ui;background:#f6f8fc;color:#182338;margin:0;padding:60px}article{max-width:850px;margin:auto;padding:36px;background:white;border-radius:16px}h1{font-size:32px}p{margin:28px 0}</style></head><body><article><h1>Reading across languages</h1><p>Reading in another language opens a window into new ideas and perspectives.</p><p>A translation should help readers understand the original text while keeping the page comfortable to use.</p></article></body></html>';
 await context.route('https://badge-frame.example/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><head><title>Empty frame</title></head><body></body></html>'}));
 await context.route('https://badge-review.example/**',r=>r.fulfill({status:200,contentType:'text/html',body:html}));
 const page=await helper.newPageWithoutForeground(context);await page.goto('https://badge-review.example/article');await page.waitForSelector('#fluent-read-page-styles',{state:'attached'});await helper.activateExtensionTabWithoutForeground(context,page);
 const tabId=await worker.evaluate(async()=>{const ts=await chrome.tabs.query({});return ts.find(t=>t.url==='https://badge-review.example/article').id});
 // 记录真实 action 调用，避免只在最终采样时漏掉中途清空角标的闪烁。
 await worker.evaluate(()=>{
   globalThis.reviewBadgeWrites=[];
   for(const method of ['setBadgeText','setIcon']) {
     const original=chrome.action[method].bind(chrome.action);
     chrome.action[method]=(...args)=>{globalThis.reviewBadgeWrites.push({method,details:args[0]});return original(...args)};
   }
 });
 async function snap(name){await sleep(700);const badge=await worker.evaluate(async(tabId)=>({text:await chrome.action.getBadgeText({tabId}),background:await chrome.action.getBadgeBackgroundColor({tabId}),foreground:typeof chrome.action.getBadgeTextColor==='function'?await chrome.action.getBadgeTextColor({tabId}):null,state:await chrome.tabs.sendMessage(tabId,{type:'getFullPageTranslationState'}),requests:globalThis.reviewRequests}),tabId);const dom=await page.evaluate(()=>({translated:document.querySelectorAll('.fluent-read-bilingual-content').length,loading:document.querySelectorAll('.fluent-read-loading').length,failures:document.querySelectorAll('[data-fr-translation-failed="true"]').length}));report.cases.push({name,...badge,...dom});await page.screenshot({path:path.join(out,name+'-page.png')});
 if(windowQuery)try{const windows=JSON.parse(execFileSync(windowQuery,[],{encoding:'utf8'}));if(windows.length!==1)throw Error('Expected one matching isolated window, found '+windows.length);execFileSync('/usr/sbin/screencapture',['-x','-o','-l',String(windows[0].kCGWindowNumber),path.join(out,name+'-window.png')]);}catch(e){report.errors.push('native screenshot: '+e.message)}
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.cases.at(-1)));
 const expected=nativeBadges[badge.state.isTranslated&&!badge.state.isSiteDisabled?badge.state.toolbarStatus:'idle'];
 assert.ok(expected,name+': known toolbar status');assert.equal(badge.text,expected.text,name+': native badge text');
 if(expected.background){assert.deepEqual(badge.background,expected.background,name+': native badge background');if(badge.foreground)assert.deepEqual(badge.foreground,[255,255,255,255],name+': native badge foreground');}
 return report.cases.at(-1);}
 report.messageTypes='contextMenuTranslate fullPage/restore';
 async function sameDocumentLoads(name,expected) {
   const before=await worker.evaluate(()=>globalThis.reviewRequests);
   await worker.evaluate(()=>{globalThis.reviewBadgeWrites=[]});
   // Astro 等站点通过 replaceState 保存滚动位置；地址和主文档都没有改变。
   for(let i=0;i<3;i++) {await page.evaluate(i=>history.replaceState({...history.state,toolbarFixtureScroll:i},''),i);await sleep(300);}
   let current=await snap(name+'-history');assert.equal(current.state.toolbarStatus,expected);
   const [frame]=await Promise.all([
     page.waitForEvent('framenavigated',{predicate:f=>f.url()==='https://badge-frame.example/first'}),
     page.evaluate(()=>{const f=document.createElement('iframe');f.id='toolbar-fixture-frame';f.setAttribute('translate','no');f.src='https://badge-frame.example/first';document.body.append(f)}),
   ]);await frame.waitForLoadState('load');
   await Promise.all([
     page.waitForEvent('framenavigated',{predicate:f=>f===frame&&f.url()==='https://badge-frame.example/second'}),
     page.evaluate(()=>{document.querySelector('#toolbar-fixture-frame').src='https://badge-frame.example/second'}),
   ]);await frame.waitForLoadState('load');
   current=await snap(name+'-iframe');assert.equal(current.state.toolbarStatus,expected);
   const writes=await worker.evaluate(tabId=>globalThis.reviewBadgeWrites.filter(w=>w.details.tabId===tabId),tabId);
   assert.equal(writes.filter(w=>w.method==='setBadgeText'&&w.details.text==='').length,0,'same-document loading must not clear the badge');
   assert.equal(await worker.evaluate(()=>globalThis.reviewRequests),before,'status synchronization must not request another translation');
   report.cases.at(-1).loadingWrites=writes;
   await page.evaluate(()=>document.querySelector('#toolbar-fixture-frame').remove());
   await sleep(700);
 }
 async function action(action){await helper.activateExtensionTabWithoutForeground(context,page);return worker.evaluate(({tabId,action})=>chrome.tabs.sendMessage(tabId,{type:'contextMenuTranslate',action}),{tabId,action})}
 assert.equal((await snap('01-original')).text,'');
 await worker.evaluate(()=>{globalThis.reviewBadgeWrites=[]});
 await worker.evaluate(()=>globalThis.reviewMode='pending');await action('fullPage');await sleep(700);const pending=await snap('02-pending');assert.equal(pending.translated,0);assert.equal(pending.state.toolbarStatus,'translating');
 await sameDocumentLoads('02b-pending-loads','translating');
 await worker.evaluate(()=>{globalThis.reviewMode='success';globalThis.reviewPending.splice(0).forEach(r=>r())});await page.waitForSelector('.fluent-read-bilingual-content');assert.equal((await snap('03-translated')).state.toolbarStatus,'translated');
 const completedWrites=await worker.evaluate(tabId=>globalThis.reviewBadgeWrites.filter(w=>w.details.tabId===tabId),tabId);
 report.completedTransitionWrites=completedWrites;
 assert.ok(completedWrites.some(w=>w.method==='setBadgeText'&&w.details.text==='✓'),'action instrumentation captured completion');
 assert.equal(completedWrites.filter(w=>w.method==='setBadgeText'&&w.details.text==='').length,0,'translation updates never clear the badge');
 assert.equal(completedWrites.filter(w=>w.method==='setIcon').length,0,'translation updates reuse the initialized brand icon');
 await worker.evaluate(()=>{globalThis.reviewBadgeWrites=[]});
 const stableRequests=await worker.evaluate(()=>globalThis.reviewRequests);
 // 原文骨架的同源样式变化会触发重扫；已经完成的结果应保持稳定。
 for(let i=0;i<6;i++) {await page.evaluate(i=>document.querySelector('article').style.setProperty('--fixture-tick',String(i)),i);await sleep(100);}
 await sleep(800);
 report.completedStability=await worker.evaluate(tabId=>({writes:globalThis.reviewBadgeWrites.filter(w=>w.details.tabId===tabId),text:null,requests:globalThis.reviewRequests}),tabId);
 report.completedStability.text=await worker.evaluate(tabId=>chrome.action.getBadgeText({tabId}),tabId);
 assert.equal(report.completedStability.text,'✓');assert.equal(report.completedStability.requests,stableRequests);assert.deepEqual(report.completedStability.writes,[]);
 // 实际动态新增内容完成快速补译，也不能先清空标识或重新加载底图。
 await page.evaluate(()=>{const p=document.createElement('p');p.id='dynamic-paragraph';p.textContent='New content can be translated without flashing the toolbar icon.';document.querySelector('article').append(p)});
 await page.waitForSelector('#dynamic-paragraph .fluent-read-bilingual-content');await sleep(500);
 report.dynamicSupplement=await worker.evaluate(tabId=>({writes:globalThis.reviewBadgeWrites.filter(w=>w.details.tabId===tabId),requests:globalThis.reviewRequests}),tabId);
 assert.ok(report.dynamicSupplement.requests>stableRequests,'new content receives a translation');
 assert.equal(report.dynamicSupplement.writes.filter(w=>w.method==='setBadgeText'&&w.details.text==='').length,0);
 assert.equal(report.dynamicSupplement.writes.filter(w=>w.method==='setIcon').length,0);
 await page.evaluate(()=>document.querySelector('#dynamic-paragraph').remove());
 await sameDocumentLoads('03b-completed-loads','translated');
 await action('restore');assert.equal((await snap('04-restored')).text,'');
 await worker.evaluate(()=>globalThis.reviewMode='failure');await action('fullPage');await sleep(9000);const failed=await snap('05-service-failure');assert.equal(failed.translated,0);assert.equal(failed.state.toolbarStatus,'error');
 await sameDocumentLoads('05a-error-loads','error');
 await worker.evaluate(()=>globalThis.reviewMode='pending');while(await page.getByText('重试',{exact:true}).count()){await page.getByText('重试',{exact:true}).first().click();await sleep(250);}
 const retry=await snap('05b-retrying');assert.equal(retry.state.toolbarStatus,'translating');
 await worker.evaluate(()=>{globalThis.reviewMode='success';globalThis.reviewPending.splice(0).forEach(r=>r())});await page.waitForFunction(()=>document.querySelectorAll('.fluent-read-bilingual-content').length===3);assert.equal((await snap('05c-retry-success')).state.toolbarStatus,'translated');
 await action('restore');await worker.evaluate(()=>globalThis.reviewMode='success');await action('fullPage');await page.waitForSelector('.fluent-read-bilingual-content');
 const second=await helper.newPageWithoutForeground(context);await second.goto('https://badge-review.example/second');await second.waitForSelector('#fluent-read-page-styles',{state:'attached'});await helper.activateExtensionTabWithoutForeground(context,second);await sleep(500);const other=await worker.evaluate(async()=>{const t=(await chrome.tabs.query({})).find(t=>t.url==='https://badge-review.example/second');return {id:t.id,text:await chrome.action.getBadgeText({tabId:t.id})}});assert.equal(other.text,'');report.tabIsolation=other;
 await helper.activateExtensionTabWithoutForeground(context,page);assert.equal((await snap('06-return-to-translated-tab')).state.toolbarStatus,'translated');
 report.workerRestart={verified:false,scope:'activation recovery covered; forced worker restart not exercised by this suite'};
 await page.reload();await page.waitForSelector('#fluent-read-page-styles',{state:'attached'});assert.equal((await snap('07-reloaded')).text,'');
 await worker.evaluate(()=>globalThis.reviewMode='pending');await action('fullPage');await sleep(700);
 assert.equal((await snap('08-pending-before-navigation')).state.toolbarStatus,'translating');
 await page.goto('https://badge-review.example/next');await page.waitForSelector('#fluent-read-page-styles',{state:'attached'});
 await worker.evaluate(()=>{globalThis.reviewMode='success';globalThis.reviewPending.splice(0).forEach(r=>r())});
 assert.equal((await snap('09-new-document-after-late-result')).text,'');
 await action('fullPage');await page.waitForSelector('.fluent-read-bilingual-content');
 assert.equal((await snap('10-new-document-translated')).state.toolbarStatus,'translated');
 await action('restore');assert.equal((await snap('11-new-document-restored')).text,'');
 report.completed=true;
 } catch (error) { primaryError = error; report.fatal = error.stack; throw error; } finally {
    const cleanupErrors = [];
    const cleanup = async (resource, release) => {
      try { await release(); } catch (error) {
        cleanupErrors.push(error);
        (report.cleanupErrors ||= []).push({resource, error: String(error.stack || error)});
        report.completed = false;
        process.exitCode = 1;
        console.error(`Cleanup failed (${resource}):`, error);
      }
    };
    let browserClosed = false;
    await cleanup('browser', async () => { if (session) { await session.close(); browserClosed = true; } });
    await cleanup('profile', () => {
      if (!profile) return;
      if (!launchAttempted || browserClosed) fs.rmSync(profile, {recursive: true, force: true});
    });
    await cleanup('report', () => { fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2)); });
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});

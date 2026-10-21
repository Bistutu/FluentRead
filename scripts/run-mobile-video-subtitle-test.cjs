#!/usr/bin/env node
'use strict';

// Production-extension browser fixture for #992. Native fullscreen events are
// simulated on Chromium; this does not verify iOS/AVKit rendering or background suspension.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
const {guardBrowserClose, getGuardedBrowserPid} = require('./testing/owned-browser-close.cjs');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const suiteFlags = process.argv.slice(2).filter(value=>value==='--suite'||value.startsWith('--suite='));
if(suiteFlags.length>1) throw Error('--suite may be specified only once');
const selectedSuite = suiteFlags[0]?.startsWith('--suite=')?suiteFlags[0].slice('--suite='.length):arg('suite','lifecycle');
if (!['menu','menu-details','lifecycle','control-clones'].includes(selectedSuite)) throw Error('--suite must be menu, menu-details, lifecycle or control-clones (default: lifecycle)');
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-mobile-video'));
const playwrightRoot = arg('playwright-root');
const helperPath = arg('focus-safe-helper');
if (!playwrightRoot || !helperPath) throw Error('需要 --playwright-root 和 --focus-safe-helper');
const {chromium} = createRequire(path.join(path.resolve(playwrightRoot), 'mobile-video.cjs'))('playwright');
const helper = require(path.resolve(helperPath));
const source = 'Watch bilingual captions near the bottom.';
const translated = '在视频底部观看双语字幕。';
const url = 'https://m.youtube.com/watch?v=fluentread-mobile-992';
const report = {selectedSuite,fixture:'mobile-youtube-production-extension', evidenceLimits:['local HTML and timedtext fixtures', 'mock translation', 'Chromium viewport/touch emulation', 'isolated-extension-world webkit capability/event shim only; no iOS/AVKit rendering', 'fullscreen geometry uses an explicit DOM property fixture; no system/window fullscreen', 'no live provider or mobile device'], cases:[], errors:[]};
if(selectedSuite==='menu') report.evidenceLimits.push('Responsive menu uses production content/style/binding with controlled VisualViewport numeric accessors and an explicit DOM fullscreen property fixture; it does not prove actual OS keyboard or Safari rendering. Explicit menu suite: shared caption readiness, touch/desktop menus and fullscreen geometry only; native-selection shim, video replacement, reload and persisted-pageshow lifecycle assertions are not executed; menu success is not lifecycle acceptance');
if(selectedSuite==='menu-details') Object.assign(report,{fixture:'X-production-menu-details',evidenceLimits:[
  'Local X DOM/generated-media fixture, official seeded transcript cache and mocked translation',
  'Actual production content creates and handles compact watch/tools/model/export DOM; no factory import or hand-built prompt',
  'Model-state message response is mocked; model preparation is blocked, no model confirmation, ASR or export confirmation',
  'Seven configured UI languages and Chromium coarse-pointer viewport only; not live X, Safari, OS keyboard or native mobile acceptance',
]});
if(selectedSuite==='control-clones') Object.assign(report,{fixture:'same-scope-control-clones-production-extension',evidenceLimits:[
  'Local desktop/mobile YouTube HTML, generated media and timedtext fixtures; mock translation',
  'Actual built extension content and native Chromium MutationObserver; no binding import, sync call or cleanup model',
  'Trusted CDP entry/Close clicks on the original live entry; no synthetic click acceptance',
  'Chromium viewport/touch emulation only; no live YouTube, Safari, iOS/AVKit or Safari E2/AX attribution',
  'Private factory call counts are not instrumented; observed live identity and owner uniqueness are checked',
  'No fullscreen/native-track shim, subtitle accuracy or reload/pageshow lifecycle acceptance in this suite',
]});
fs.mkdirSync(artifacts, {recursive:true});
let session, profileDir, page, control, focusMonitor, browserPid, focusTimer, focusError, closing, worker, evaluateBusinessWorld;
let launchAttempted = false, cleanupStarted = false;
const save = () => fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2)+'\n');
const closeOwned = async () => {
  if (!session) return;
  closing ||= session.close().then(() => {report.browserCloseReceipt='shared-guard-fulfilled';});
  return closing;
};
const failFocus = error => {
  if (cleanupStarted || focusError) return;
  focusError=error; report.errors.push(error.stack||String(error)); process.exitCode=1; save();
  void closeOwned().catch(error=>{report.cleanupError=String(error);save();});
};
const checkFocus = async () => {
  if(focusError) throw focusError;
  const front=await helper.queryMacFrontmostApplication();
  (report.focusSamples ||= []).push({at:Date.now(),name:front?.name,pid:front?.pid});
  assert.ok(front&&front.pid!==browserPid,'Owned test browser must remain in background');
  if(focusMonitor.error) throw focusMonitor.error;
};

const diagnoseTrackResources = () => page.evaluate(async()=>{
        const results=[];
        for(const beforeAppend of [true,false]){
          const video=document.createElement('video');video.style.display='none';document.body.appendChild(video);
          const node=document.createElement('track');node.kind='subtitles';node.label='Diagnostic';
          const events=[];for(const type of ['load','error'])node.addEventListener(type,()=>events.push({type,cues:node.track.cues?.length,readyState:node.readyState}));
          if(beforeAppend)node.srclang='en';video.appendChild(node);node.track.mode='hidden';if(!beforeAppend)node.srclang='en';
          node.track.addCue(new VTTCue(0,30,'Diagnostic cue'));
          const result={beforeAppend,immediate:node.track.cues?.length,events};
          await new Promise(resolve=>setTimeout(resolve,30));result.afterTask=node.track.cues?.length;
          node.track.addCue(new VTTCue(0,30,'Second cue'));result.afterSecond=node.track.cues?.length;
          node.srclang=node.srclang;await new Promise(resolve=>setTimeout(resolve,30));result.afterSameLanguage=node.track.cues?.length;
          results.push(result);video.remove();
        }
        return results;
});

async function runControlClonesSuite(context, configure, mediaBase64) {
  const hash = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
  const manifestBytes = fs.readFileSync(path.join(extensionDir,'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  report.extensionIdentity = {directory:extensionDir,manifestSHA256:hash(manifestBytes),contentScripts:
    [...new Set((manifest.content_scripts||[]).flatMap(entry=>entry.js||[]))].map(file=>{
      const bytes=fs.readFileSync(path.join(extensionDir,file));return {file,sha256:hash(bytes),size:bytes.length};
    })};
  assert.ok(report.extensionIdentity.contentScripts.some(entry=>entry.file==='content-scripts/content.js'),'Require the manifest-declared production content entry');
  const cdp=await context.newCDPSession(page);
  for(const layout of ['desktop','mobile']) {
    await configure({on:true,videoTranslationEnabled:true,videoSubtitleVisible:true,videoSubtitleDisplayMode:'bilingual'});
    await cdp.send('Emulation.setTouchEmulationEnabled',layout==='mobile'?{enabled:true,maxTouchPoints:1}:{enabled:false});
    await page.setViewportSize(layout==='mobile'?{width:390,height:844}:{width:1280,height:900});
    const fixtureUrl=`https://${layout==='mobile'?'m':'www'}.youtube.com/watch?v=fluentread-control-clones-${layout}`;
    const timedtext=`https://${layout==='mobile'?'m':'www'}.youtube.com/api/timedtext?v=fluentread-control-clones-${layout}&lang=en`;
    const controls='<div data-fixture-controls="original" class="'+(layout==='mobile'?'player-controls-bottom player-controls-bottom-right':'ytp-right-controls')+'"><button aria-label="Settings">Settings</button><button aria-label="Full screen">Fullscreen</button></div>';
    const video=`<video playsinline preload="auto" src="data:video/mp4;base64,${mediaBase64}"></video>`;
    const player=`<div id="movie_player" class="html5-video-player${layout==='mobile'?' ytp-mweb-player':''}">${video}<div class="ytp-caption-window-container"><span class="ytp-caption-segment">${source}</span></div>${layout==='desktop'?controls:''}</div>`;
    const topology=layout==='mobile'?`<div id="player-container-id" class="player-container sticky-player">${player}<ytm-custom-control><ytm-watch-player-controls><div id="player-control-overlay"><div class="player-controls-content">${controls}</div></div></ytm-watch-player-controls></ytm-custom-control></div>`:player;
    await page.route(fixtureUrl,route=>route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Control clone ownership fixture</title><style>html,body{margin:0;background:#e9edf3;font:16px Arial}#player-container-id,#movie_player{position:relative;width:100%;height:min(56.25vw,500px);background:#101820}video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}[data-fixture-controls]{position:absolute;right:8px;bottom:8px;display:flex;gap:8px;height:44px}[data-fixture-controls] button{min-width:44px;height:44px}[data-fixture-controls="copy"]{bottom:62px}.ytp-caption-window-container{position:absolute;top:35%;color:white}</style><script>var ytInitialPlayerResponse=${JSON.stringify({videoDetails:{videoId:`fluentread-control-clones-${layout}`},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:timedtext,languageCode:'en',name:{simpleText:'English'}}]}}})};</script></head><body>${topology}<p>Controlled production content ownership fixture; not a live mobile site.</p></body></html>`}));
    const timedtextUrl=new URL(timedtext);
    await page.route(candidate=>candidate.origin===timedtextUrl.origin&&candidate.pathname===timedtextUrl.pathname&&
      candidate.searchParams.getAll('v').length===1&&candidate.searchParams.get('v')===timedtextUrl.searchParams.get('v'),
      route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({events:[{tStartMs:0,dDurationMs:30000,segs:[{utf8:source}]}]})}));
    report.stage=`control-clones-${layout}-ready`;save();
    await page.goto(fixtureUrl,{waitUntil:'domcontentloaded'});
    await helper.activateExtensionTabWithoutForeground(context,page);
    await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2&&
      document.querySelector('[data-fixture-controls="original"] #fluent-read-video-subtitle-button')?.getAttribute('data-fluent-read-video-binding-owner')&&
      document.querySelector('#fluent-read-video-subtitle-menu')?.hidden===true);
    const baseline=await page.evaluate(layout=>{
      const live=document.querySelector('[data-fixture-controls="original"] #fluent-read-video-subtitle-button');
      const player=document.querySelector('#movie_player'),host=live.parentElement;
      const scope=layout==='mobile'?document.querySelector('#player-container-id'):player;
      const probe=window.__controlCloneProbe={live,player,host,scope,owner:live.getAttribute('data-fluent-read-video-binding-owner'),
        nativeButtons:[...host.querySelectorAll('button')].filter(node=>node!==live),cases:[],clicks:[]};
      document.addEventListener('click',event=>{
        if(live.contains(event.target))probe.clicks.push({kind:'entry',trusted:event.isTrusted});
        else if(event.target.closest?.('#fluent-read-video-subtitle-menu [data-action="close-menu"]'))probe.clicks.push({kind:'close',trusted:event.isTrusted});
      },true);
      return {layout,url:location.href,liveInOriginalHost:host.matches('[data-fixture-controls="original"]'),scopeContainsHost:scope.contains(host),
        scopeIsPlayer:scope===player,scopeVideoCount:scope.querySelectorAll('video').length,coarsePointer:matchMedia('(pointer:coarse)').matches,
        ariaPressed:live.getAttribute('aria-pressed'),ariaExpanded:live.getAttribute('aria-expanded'),ariaHaspopup:live.getAttribute('aria-haspopup'),ariaControls:live.getAttribute('aria-controls')};
    },layout);
    assert.equal(baseline.url,fixtureUrl);assert.equal(baseline.liveInOriginalHost,true);assert.equal(baseline.scopeContainsHost,true);
    assert.equal(baseline.scopeIsPlayer,layout==='desktop');assert.equal(baseline.scopeVideoCount,1);assert.equal(baseline.coarsePointer,layout==='mobile');
    assert.equal(baseline.ariaPressed,null);assert.equal(baseline.ariaExpanded,'false');assert.equal(baseline.ariaHaspopup,'menu');assert.equal(baseline.ariaControls,'fluent-read-video-subtitle-menu');
    for(const kind of ['whole-host','loose']) {
      report.stage=`control-clones-${layout}-${kind}`;save();await checkFocus();
      const repair=await page.evaluate(async kind=>{
        const p=window.__controlCloneProbe,selector=`button[data-fluent-read-video-binding-owner="${p.owner}"]`;
        const foreign=p.live.cloneNode(true);foreign.setAttribute('data-fluent-read-video-binding-owner',`fixture-foreign-${kind}`);
        const outside=p.live.cloneNode(true),unrelated=document.createElement('div');unrelated.className='html5-video-player';unrelated.hidden=true;
        unrelated.append(document.createElement('video'),outside);document.body.appendChild(unrelated);
        const sibling=kind==='whole-host'?p.host.cloneNode(true):null;
        const copy=sibling?sibling.querySelector(selector):p.live.cloneNode(true);
        if(sibling){sibling.setAttribute('data-fixture-controls','copy');sibling.appendChild(foreign);} else p.scope.appendChild(foreign);
        const records=[],observer=new MutationObserver(batch=>records.push(...batch));observer.observe(p.scope,{childList:true,subtree:true});
        const startedAt=performance.now();
        if(sibling)p.host.parentElement.appendChild(sibling);else p.scope.appendChild(copy);
        const immediateOwnCount=p.scope.querySelectorAll(selector).length;
        // No task, click, locator/sync call or synthetic event can repair the copy before this checkpoint.
        await new Promise(resolve=>queueMicrotask(resolve));
        const afterMicrotask={ownCount:p.scope.querySelectorAll(selector).length,copyConnected:copy.isConnected,elapsedMs:performance.now()-startedAt};
        await new Promise(resolve=>setTimeout(resolve,0));observer.disconnect();
        p.cases.push({kind,copy,foreign,outside,sibling});
        return {kind,immediateOwnCount,afterMicrotask,afterTaskOwnCount:p.scope.querySelectorAll(selector).length,
          removedCopyObserved:records.some(record=>[...record.removedNodes].some(node=>node===copy||node.contains?.(copy))),
          liveIdentity:p.host.querySelector('#fluent-read-video-subtitle-button')===p.live,liveConnected:p.live.isConnected,liveParentUnchanged:p.live.parentElement===p.host,
          nativeButtonsUnchanged:p.nativeButtons.every(node=>node.isConnected&&node.parentElement===p.host),
          siblingRetained:!sibling||sibling.isConnected,siblingNativeRetained:!sibling||Boolean(sibling.querySelector('[aria-label="Full screen"]')),
          foreignRetained:foreign.isConnected,unrelatedRetained:outside.isConnected&&!p.scope.contains(outside),url:location.href};
      },kind);
      const receipt={name:`${layout}-${kind}`,status:'OBSERVED_PENDING_ASSERTIONS',baseline,repair};report.cases.push(receipt);save();
      assert.equal(repair.immediateOwnCount,2,`${layout}/${kind}: fixture must insert a real same-owner copy`);
      assert.equal(repair.afterMicrotask.ownCount,1,JSON.stringify(repair));assert.equal(repair.afterMicrotask.copyConnected,false,JSON.stringify(repair));
      assert.equal(repair.afterTaskOwnCount,1);assert.equal(repair.removedCopyObserved,true);
      for(const key of ['liveIdentity','liveConnected','liveParentUnchanged','nativeButtonsUnchanged','siblingRetained','siblingNativeRetained','foreignRetained','unrelatedRetained'])assert.equal(repair[key],true,`${layout}/${kind}: ${key}`);
      assert.equal(repair.url,fixtureUrl);
      const entry=page.locator('[data-fixture-controls="original"] #fluent-read-video-subtitle-button');
      await entry.click();
      await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-menu')?.hidden===false&&window.__controlCloneProbe.live.getAttribute('aria-expanded')==='true');
      await page.screenshot({path:path.join(artifacts,`control-clones-${layout}-${kind}-menu-open.png`)});
      await page.locator('#fluent-read-video-subtitle-menu [data-action="close-menu"]').click();
      await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-menu')?.hidden===true&&window.__controlCloneProbe.live.getAttribute('aria-expanded')==='false');
      const menu=await page.evaluate(()=>{
        const p=window.__controlCloneProbe;return {focusReturned:document.activeElement===p.live,ariaPressed:p.live.getAttribute('aria-pressed'),
          selectedMode:document.querySelector('#fluent-read-video-subtitle-menu [data-mode][aria-checked="true"]')?.getAttribute('data-mode'),clicks:p.clicks.slice(-2),url:location.href};
      });
      assert.equal(menu.focusReturned,true);assert.equal(menu.ariaPressed,null);assert.equal(menu.selectedMode,'bilingual');assert.equal(menu.url,fixtureUrl);
      assert.deepEqual(menu.clicks,[{kind:'entry',trusted:true},{kind:'close',trusted:true}]);
      Object.assign(receipt,{status:'PASS',menu});save();
      await page.screenshot({path:path.join(artifacts,`control-clones-${layout}-${kind}-menu-closed.png`)});
    }
    fs.writeFileSync(path.join(artifacts,`control-clones-${layout}-dom.html`),await page.evaluate(()=>{
      const clone=document.documentElement.cloneNode(true);clone.querySelectorAll('video').forEach(node=>node.removeAttribute('src'));return clone.outerHTML;
    }));
    // Reuse real configuration persistence/subscription, exercising binding disable without global content disposal.
    await configure({videoTranslationEnabled:false});
    await page.waitForFunction(()=>!window.__controlCloneProbe.live.isConnected&&!document.querySelector('#fluent-read-video-subtitle-menu'));
    const disabled=await page.evaluate(()=>{
      const p=window.__controlCloneProbe;return {liveRemoved:!p.live.isConnected,
        ownCount:p.scope.querySelectorAll(`button[data-fluent-read-video-binding-owner="${p.owner}"]`).length,
        foreignRetained:p.cases.every(item=>item.foreign.isConnected),unrelatedRetained:p.cases.every(item=>item.outside.isConnected),
        nativeButtonsRetained:p.nativeButtons.every(node=>node.isConnected&&node.parentElement===p.host)};
    });
    const disableReceipt={name:`${layout}-configuration-disable`,status:'OBSERVED_PENDING_ASSERTIONS',...disabled};report.cases.push(disableReceipt);save();
    assert.deepEqual(disabled,{liveRemoved:true,ownCount:0,foreignRetained:true,unrelatedRetained:true,nativeButtonsRetained:true});
    disableReceipt.status='PASS';save();
    await page.goto('about:blank'); // Navigation separates fixtures; this is not a reload/unload-cleanup assertion.
  }
  await configure({on:false});
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  report.stage='control-clones-complete';save();
}

async function runMenuDetailsSuite(context, configure, mediaBase64) {
  const languages=[["zh-CN","关闭字幕菜单","双语","字幕选项"],["en-US","Close subtitle menu","Both","Subtitle options"],["ja-JP","字幕メニューを閉じる","両方","字幕オプション"],["ko-KR","자막 메뉴 닫기","둘 다","자막 옵션"],["fr-FR","Fermer le menu des sous-titres","Les deux","Options des sous-titres"],["ru-RU","Закрыть меню субтитров","Оба","Параметры субтитров"],["es-ES","Cerrar el menú de subtítulos","Ambos","Opciones de subtítulos"]];
  const cdp=await context.newCDPSession(page),worlds=new Map();
  cdp.on('Runtime.executionContextCreated',({context})=>worlds.set(context.id,context));
  cdp.on('Runtime.executionContextDestroyed',({executionContextId})=>worlds.delete(executionContextId));
  cdp.on('Runtime.executionContextsCleared',()=>worlds.clear());await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await page.setViewportSize({width:320,height:720});
  await configure({uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,videoLocalModel:'tiny',videoSourceLanguage:'auto'});
  const cached=await control.evaluate(cue=>chrome.runtime.sendMessage({type:'fluentReadSetVideoAiSubtitleCache',source:{mediaId:'424242'},model:'tiny',sourceLanguage:'auto',
    cues:[{startMs:0,durationMs:10000,text:cue}]}),source);assert.equal(cached.cached,true);
  const fixtureUrl='https://x.com/fluentread/status/424242';
  await page.route('https://video.twimg.com/**',route=>route.fulfill({contentType:'video/mp4',body:Buffer.from(mediaBase64,'base64')}));
  await page.route(fixtureUrl,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;font:16px Arial;background:#e9edf3}[data-testid="videoPlayer"]{position:relative;width:100%;aspect-ratio:16/9;background:#10283f;overflow:hidden}video{width:100%;height:100%}.fixture-controls{position:absolute;bottom:0;right:8px;height:44px;display:flex;align-items:center;gap:8px}.fixture-controls button{width:44px;height:44px}.fixture-actions{display:flex;align-items:center}p{margin:16px}</style></head><body><article><a href="/fluentread/status/424242/video/1">Controlled X video</a><div data-testid="videoPlayer"><video muted playsinline preload="auto" src="https://video.twimg.com/ext_tw_video/424242/pu/fixture.mp4"></video><div class="fixture-controls"><button aria-label="Volume">Volume</button><button aria-label="Settings">Settings</button><div class="fixture-actions"><div id="fixture-pip"><button aria-label="Picture in picture">PiP</button></div><div id="fixture-fullscreen"><button aria-label="Full screen">Full</button></div></div></div></div></article><p>Production menu CSS, local transcript cache and mocked translation; no model download or ASR.</p></body></html>`}));
  let downloads=0;page.on('download',()=>downloads++);
  await page.goto(fixtureUrl,{waitUntil:'domcontentloaded'});await helper.activateExtensionTabWithoutForeground(context,page);
  await page.mouse.move(160,80);
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2&&document.querySelector('#fluent-read-video-subtitle-original')?.textContent.includes('Watch bilingual'));
  const id=new URL(worker.url()).host,frame=(await cdp.send('Page.getFrameTree')).frameTree.frame.id;
  let world;
  for(let attempt=0;attempt<50&&!world;attempt++){
    for(const candidate of worlds.values()){
      if(candidate.auxData?.isDefault||candidate.auxData?.frameId!==frame)continue;
      const identity=await cdp.send('Runtime.evaluate',{contextId:candidate.id,expression:'globalThis.chrome?.runtime?.id',returnByValue:true});
      if(identity.result?.value===id){world=candidate.id;break;}
    }
    if(!world)await page.waitForTimeout(100);
  }
  assert.ok(world,'Actual production extension world must be identified');
  const isolated=async expression=>{
    const result=await cdp.send('Runtime.evaluate',{contextId:world,expression,returnByValue:true,awaitPromise:true});
    assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;
  };
  evaluateBusinessWorld=isolated;
  await isolated(`(()=>{const original=chrome.runtime.sendMessage;globalThis.__menuDetailsMessages={modelState:0,blockedPrepare:0};
    chrome.runtime.sendMessage=function(...args){const type=args[0]?.type;let response;
      if(type==='fluentReadGetLocalVideoModelState'){__menuDetailsMessages.modelState++;response={success:true,models:[]};}
      else if(type==='fluentReadPrepareLocalVideoModel'){__menuDetailsMessages.blockedPrepare++;response={success:false,error:'Menu-details fixture forbids model preparation'};}
      else return original.apply(this,args);
      const callback=args[args.length-1];if(typeof callback==='function'){queueMicrotask(()=>callback(response));return;}return Promise.resolve(response);
    };return true;})()`);
  report.menuDetails={languages:languages.map(([language])=>language),viewport:{width:320,height:720},cache:'official seeded AI transcript',modelState:'mock success/models=[]; preparation blocked',translation:'existing deterministic worker mock',cases:[],keyboard:[],closed:[]};save();
  const menuSelector='#fluent-read-video-subtitle-menu';
  const measure=async(name,screenshot=true)=>{
    await checkFocus();
    const value=await page.evaluate(()=>{
      const menu=document.querySelector('#fluent-read-video-subtitle-menu'),header=menu.querySelector('.fluent-read-video-menu-title'),body=menu.querySelector('.fluent-read-video-menu-body');
      const prompt=menu.querySelector('[data-model-prompt]:not([hidden]), [data-export-prompt]'),main=menu.querySelector('.fluent-read-video-menu-main');
      const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const clipped=node=>{const r=rect(node),ancestorScrollports=[];
        for(let parent=node.parentElement;parent;parent=parent.parentElement){
          const css=getComputedStyle(parent),p=rect(parent),clipX=/^(auto|scroll|hidden|clip)$/.test(css.overflowX),clipY=/^(auto|scroll|hidden|clip)$/.test(css.overflowY);
          if(!clipX&&!clipY)continue;
          const border={left:parseFloat(css.borderLeftWidth)||0,right:parseFloat(css.borderRightWidth)||0,top:parseFloat(css.borderTopWidth)||0,bottom:parseFloat(css.borderBottomWidth)||0};
          const reservedScrollbarWidth=Math.max(0,parent.offsetWidth-parent.clientWidth-border.left-border.right),reservedScrollbarHeight=Math.max(0,parent.offsetHeight-parent.clientHeight-border.top-border.bottom);
          // Preserve fractional padding-box edges; clientWidth/clientHeight are integer diagnostics, not precise clip edges.
          const scrollport={left:p.left+border.left,right:p.right-border.right-reservedScrollbarWidth,top:p.top+border.top,bottom:p.bottom-border.bottom-reservedScrollbarHeight};
          if(clipX){r.left=Math.max(r.left,scrollport.left);r.right=Math.min(r.right,scrollport.right);}
          if(clipY){r.top=Math.max(r.top,scrollport.top);r.bottom=Math.min(r.bottom,scrollport.bottom);}
          ancestorScrollports.push({tag:parent.tagName,className:parent.getAttribute('class'),clipX,clipY,frame:p,border,offsetWidth:parent.offsetWidth,offsetHeight:parent.offsetHeight,
            clientWidth:parent.clientWidth,clientHeight:parent.clientHeight,reservedScrollbarWidth,reservedScrollbarHeight,scrollport});
        }
        r.left=Math.max(0,r.left);r.top=Math.max(0,r.top);r.right=Math.min(innerWidth,r.right);r.bottom=Math.min(innerHeight,r.bottom);
        return {...r,width:Math.max(0,r.right-r.left),height:Math.max(0,r.bottom-r.top),ancestorScrollports};
      };
      const buttons=[...menu.querySelectorAll('button')].map((node,index)=>{
        const r=rect(node),v=clipped(node),css=getComputedStyle(node),displayed=r.width>0&&r.height>0&&css.visibility==='visible'&&css.display!=='none';
        const fullyVisible=displayed&&v.left<=r.left+.01&&v.top<=r.top+.01&&v.right>=r.right-.01&&v.bottom>=r.bottom-.01;
        const points=[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y])=>{const px=r.left+r.width*x,py=r.top+r.height*y,hit=document.elementFromPoint(px,py);
          return {x:px,y:py,hit:hit===node||Boolean(hit&&node.contains(hit)),hitTag:hit?.tagName||null,hitClass:hit?.getAttribute('class')||null};});
        const textFits=[node,...node.querySelectorAll('[data-i18n-key], .fluent-read-video-menu-label, .fluent-read-video-model-option-name, .fluent-read-video-model-option-hint')].every(label=>{
          if(!label.textContent.trim())return true;const range=document.createRange();range.selectNodeContents(label);return [...range.getClientRects()].every(t=>t.left>=r.left-.5&&t.right<=r.right+.5&&t.top>=r.top-.5&&t.bottom<=r.bottom+.5);});
        return {index,action:node.dataset.action||null,mode:node.dataset.mode||null,model:node.dataset.modelChoice||null,exportChoice:node.dataset.exportChoice||null,
          label:node.textContent.trim(),ariaLabel:node.getAttribute('aria-label'),disabled:node.disabled,displayed,fullyVisible,textFits,frame:r,clippedRect:v,points,focused:node===document.activeElement,inPrompt:Boolean(prompt?.contains(node))};
      });
      const back=menu.querySelector('[data-action="close-subtitle-tools"]'),close=buttons.find(node=>node.action==='close-menu');
      const old=window.__menuDetailsIdentity;return {view:menu.dataset.view,panel:menu.dataset.panel,compact:menu.dataset.compact,presentation:menu.dataset.presentation,
        sameMenu:!old||old.menu===menu,sameHost:!old||old.host===menu.parentElement,menu:rect(menu),header:rect(header),headerDirect:header.parentElement===menu,headerOutsideBody:!body.contains(header),
        overflowX:menu.scrollWidth>menu.clientWidth+1,bodyOverflowX:body.scrollWidth>body.clientWidth+1,bodyScrollTop:body.scrollTop,bodyScrollHeight:body.scrollHeight,bodyClientHeight:body.clientHeight,
        mainHidden:main.hidden,mainDisplay:getComputedStyle(main).display,promptOverflowX:Boolean(prompt&&prompt.scrollWidth>prompt.clientWidth+1),promptScrollHeight:prompt?.scrollHeight,promptClientHeight:prompt?.clientHeight,
        back:{hidden:back.hidden,display:getComputedStyle(back).display,frame:rect(back)},close,buttons,viewport:{width:innerWidth,height:innerHeight},coarse:matchMedia('(pointer:coarse)').matches};
    });
    report.menuDetails.cases.push({name,...value});save();if(screenshot)await page.screenshot({path:path.join(artifacts,`${name}.png`)});return value;
  };
  const whole=(name,node)=>{assert.ok(node&&node.displayed&&node.fullyVisible&&node.frame.width>=43.99&&node.frame.height>=43.99&&node.points.every(point=>point.hit),`${name}: complete 44px hit ${JSON.stringify(node)}`);};
  const validate=(name,state)=>{
    assert.equal(state.compact,'true');assert.equal(state.presentation,'viewport');assert.equal(state.coarse,true);assert.ok(state.sameMenu&&state.sameHost);
    assert.ok(!state.overflowX&&!state.bodyOverflowX&&!state.promptOverflowX,`${name}: horizontal content overflow`);
    assert.ok(state.menu.left>=-.01&&state.menu.right<=state.viewport.width+.01&&state.menu.top>=-.01&&state.menu.bottom<=state.viewport.height+.01,`${name}: menu outside controlled viewport`);
    assert.ok(state.headerDirect&&state.headerOutsideBody);whole(name+' Close',state.close);
    for(const button of state.buttons.filter(button=>button.displayed)){assert.ok(button.frame.width>=43.99&&button.frame.height>=43.99,`${name}: 44px control ${JSON.stringify(button)}`);assert.equal(button.textFits,true,`${name}: localized label clipped ${JSON.stringify(button)}`);}
    if(state.view!=='main'){assert.ok(state.mainHidden&&state.mainDisplay==='none',`${name}: main CSS must honor hidden`);assert.equal(state.back.display,'none');assert.equal(state.back.frame.width,0);assert.equal(state.back.frame.height,0);}
  };
  const click=async(selector)=>{
    await checkFocus();const target=await page.evaluate(selector=>{
      const nodes=document.querySelectorAll(selector);if(nodes.length!==1)return {count:nodes.length};const node=nodes[0],r=node.getBoundingClientRect();
      const points=[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y])=>{const px=r.left+r.width*x,py=r.top+r.height*y,hit=document.elementFromPoint(px,py);return {x:px,y:py,hit:hit===node||Boolean(hit&&node.contains(hit))};});
      return {count:1,disabled:node.disabled,width:r.width,height:r.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,points};
    },selector);assert.ok(target.count===1&&!target.disabled&&target.width>=43.99&&target.height>=43.99&&target.inside&&target.points.every(point=>point.hit),`Pre-click 44px hit ${selector}: ${JSON.stringify(target)}`);
    await page.mouse.click(target.points[0].x,target.points[0].y);
  };
  const waitView=(view,panel)=>page.waitForFunction(({view,panel})=>{const menu=document.querySelector('#fluent-read-video-subtitle-menu');return !menu.hidden&&menu.dataset.view===view&&(!panel||menu.dataset.panel===panel);},{view,panel});
  const open=async()=>{await click('#fluent-read-video-subtitle-button');await waitView('main');};
  const close=async(name)=>{
    await click(menuSelector+' [data-action="close-menu"]');await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-menu').hidden);
    const state=await page.evaluate(()=>{const menu=document.querySelector('#fluent-read-video-subtitle-menu'),r=menu.getBoundingClientRect(),entry=document.querySelector('#fluent-read-video-subtitle-button');return {hidden:menu.hidden,display:getComputedStyle(menu).display,width:r.width,height:r.height,focusReturned:document.activeElement===entry};});
    report.menuDetails.closed.push({name,...state});save();assert.ok(state.hidden&&state.display==='none'&&state.width===0&&state.height===0&&state.focusReturned);
  };
  const keyboard=async(name)=>{
    const outputs=[];
    for(const key of ['Home','ArrowDown','End']){
      await page.keyboard.press(key);const state=await measure(name+'-'+key,false),active=state.buttons.find(button=>button.focused);whole(name+' '+key,active);
      assert.notEqual(active.action,'close-subtitle-tools','Hidden tools Back must never receive focus in a prompt');
      if(key==='Home')assert.equal(active.action,'open-settings');if(key==='ArrowDown')assert.equal(active.action,'close-menu');if(key==='End')assert.equal(active.inPrompt,true);
      outputs.push({key,action:active.action,model:active.model,exportChoice:active.exportChoice});
    }
    report.menuDetails.keyboard.push({name,outputs});save();
  };
  await open();await page.evaluate(()=>{const menu=document.querySelector('#fluent-read-video-subtitle-menu');window.__menuDetailsIdentity={menu,host:menu.parentElement};});await close('initial');
  for(const [language,closeLabel,bilingualLabel,toolsLabel] of languages){
    await configure({uiLanguage:language});
    await page.waitForFunction(expected=>document.querySelector('#fluent-read-video-subtitle-menu [data-action="close-menu"]')?.getAttribute('aria-label')===expected,closeLabel);
    await open();let state=await measure(`details-${language}-watch`);validate(language+' watch',state);
    assert.equal(state.buttons.find(button=>button.mode==='bilingual').label,bilingualLabel);
    assert.equal(state.buttons.find(button=>button.action==='open-subtitle-tools').label,toolsLabel);
    for(const mode of ['bilingual','translation-only','original-only','off'])whole(language+' '+mode,state.buttons.find(button=>button.mode===mode));
    whole(language+' tools entry',state.buttons.find(button=>button.action==='open-subtitle-tools'));
    whole(language+' learning entry',state.buttons.find(button=>button.action==='open-sentence-learning'));
    await close(language+' watch');
  }
  // Only one language enters the real subpages; the seven-language matrix above stays a bounded watch-layout check.
  await configure({uiLanguage:'zh-CN'});
  await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-menu [data-action="close-menu"]')?.getAttribute('aria-label')==='关闭字幕菜单');
  await open();await click(menuSelector+' [data-action="open-subtitle-tools"]');await waitView('main','tools');
  let state=await measure('details-tools');validate('tools',state);whole('tools Back',state.buttons.find(button=>button.action==='close-subtitle-tools'));
  await click(menuSelector+' [data-action="close-subtitle-tools"]');await waitView('main','watch');
  await click(menuSelector+' [data-action="open-subtitle-tools"]');await waitView('main','tools');
  await click(menuSelector+' [data-action="select-ai-model"]');await waitView('model-prompt');
  state=await measure('details-model');validate('model',state);await keyboard('model');
  await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
  await click(menuSelector+' [data-model-prompt] .fluent-read-video-model-prompt-head [data-action="model-prompt-cancel"]');await waitView('main','tools');
  await click(menuSelector+' [data-action="download-translated-subtitles"]');await waitView('export-prompt');
  state=await measure('details-export');validate('export',state);await keyboard('export');
  await click(menuSelector+' [data-export-choice="cancel"]');await waitView('main','tools');
  // Global Close is checked while each real production subpage is open, without confirming either task.
  await click(menuSelector+' [data-action="select-ai-model"]');await waitView('model-prompt');await close('model-global');
  await open();await click(menuSelector+' [data-action="open-subtitle-tools"]');await waitView('main','tools');
  await click(menuSelector+' [data-action="download-translated-subtitles"]');await waitView('export-prompt');await close('export-global');
  await open();await click(menuSelector+' [data-action="open-subtitle-tools"]');await waitView('main','tools');
  await page.setViewportSize({width:320,height:300});await page.waitForTimeout(180);
  await page.evaluate(()=>{const body=document.querySelector('.fluent-read-video-menu-body');body.scrollTop=body.scrollHeight;});
  const short=await measure('details-short-body-bottom');validate('short body',short);assert.ok(short.bodyScrollHeight>short.bodyClientHeight&&short.bodyScrollTop>0);
  await close('short-body-global');
  report.menuDetails.messages=await isolated('globalThis.__menuDetailsMessages');report.menuDetails.downloadEvents=downloads;
  assert.equal(report.menuDetails.messages.modelState,2);assert.equal(report.menuDetails.messages.blockedPrepare,0);assert.equal(downloads,0);
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  report.menuDetails.success=true;save();
}

async function main() {
  assert.ok(fs.existsSync(path.join(extensionDir,'manifest.json')), '需要 production 扩展构建');
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-mobile-video-'));
  const media = path.join(artifacts,'fixture.mp4');
  const generated = spawnSync(arg('ffmpeg','/opt/homebrew/bin/ffmpeg'), ['-y','-f','lavfi','-i','color=c=0x263c52:s=640x360:r=1','-t','30','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',media], {encoding:'utf8', timeout:30000});
  assert.equal(generated.status,0,generated.stderr);
  const mediaBase64 = fs.readFileSync(media).toString('base64');
  focusMonitor=helper.startFocusEventMonitor({onEvent(event){
    report.focusEvents=[...focusMonitor.events]; save();
    if(browserPid&&event.pid===browserPid) failFocus(Error('Owned test browser activated during focus observation'));
  },onError:failFocus});
  report.focusObserver=await focusMonitor.ready;
  launchAttempted=true;
  session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
    browserPath:arg('browser-path','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    headless:false, background:true, displayTarget:'secondary', viewport:{width:1280,height:900},
    browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check']});
  guardBrowserClose(session,profileDir);
  browserPid=await getGuardedBrowserPid(session); report.browserPid=browserPid;
  assert.ok(!focusMonitor.events.some(event=>event.pid===browserPid),'Browser became foreground during launch');
  await checkFocus();
  let checking=false;
  focusTimer=setInterval(()=>{if(checking||cleanupStarted)return;checking=true;void checkFocus().catch(failFocus).finally(()=>{checking=false;});},500);
  const {context}=session;
  context.setDefaultTimeout(15000);
  context.browser().on('disconnected',()=>{if(!cleanupStarted&&!closing)failFocus(Error('Owned browser disconnected before validation completed'));});
  Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement});
  assert.equal(report.launchMode,'macos-background-cdp'); assert.equal(report.focusPolicy,'launchservices-no-foreground');
  assert.equal(report.windowPlacement?.mode,'background-visible-no-focus'); assert.equal(report.windowPlacement?.browserFrontmost,false);
  worker = context.serviceWorkers().find(w=>w.url().endsWith('/background.js')) || await context.waitForEvent('serviceworker',{predicate:w=>w.url().endsWith('/background.js'),timeout:30000});
  worker.on('console',message=>(report.workerConsole ||= []).push({type:message.type(),text:message.text()}));
  await worker.evaluate(text=>{
    globalThis.__mobileVideoRequests=[];
    const original=globalThis.fetch;
    globalThis.fetch=async(input,init)=>{
      const url=String(input?.url||input);
      if(url.startsWith('https://edge.microsoft.com/translate/translatetext')){
        globalThis.__mobileVideoRequests.push({url,source:init?.body});
        return new Response(JSON.stringify([{translations:[{text}]}]),{status:200,headers:{'content-type':'application/json'}});
      }
      return original(input,init);
    };
  },translated);
  control=await helper.newPageWithoutForeground(context);
  await control.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`,{waitUntil:'domcontentloaded'});
  const configure=async(patch)=>{
    const result=await control.evaluate(async(patch)=>{
      const read=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
      const current=typeof read?.value==='string'?JSON.parse(read.value):(read?.value||{});
      return chrome.runtime.sendMessage({type:'persistConfig',clientId:'mobile-video-992',sequence:Date.now(),config:{...current,...patch},...(Number.isSafeInteger(current.__fluentConfigRevision)?{baseRevision:current.__fluentConfigRevision}:{})});
    },patch);
    assert.equal(result?.success,true,JSON.stringify(result));
  };
  await configure({on:true,from:'en',to:'zh-Hans',videoTranslationEnabled:true,videoService:'microsoft',videoServiceDefaultMigrated:true,videoSubtitleVisible:true,videoSubtitleDisplayMode:'bilingual',videoPreferHumanSubtitles:false,useCache:false});
  page=await helper.newPageWithoutForeground(context);
  page.on('pageerror',error=>report.errors.push(error.stack||String(error)));
  await page.addInitScript(()=>{
    window.__nativeTrackResourceEvents=[];
    document.addEventListener('error',event=>{
      const node=event.target;
      if(!(node instanceof HTMLTrackElement)||!node.hasAttribute('data-fluent-read-native-subtitles'))return;
      const entry={type:event.type,trusted:event.isTrusted,before:node.track.cues?.length,at:performance.now()};
      window.__nativeTrackResourceEvents.push(entry);
      setTimeout(()=>{entry.afterTask=node.track.cues?.length;entry.elapsedMs=performance.now()-entry.at;},0);
    },true);
  });
  page.on('console',message=>(report.console ||= []).push({type:message.type(),text:message.text()}));
  page.on('requestfailed',request=>(report.requestFailures ||= []).push({url:request.url().slice(0,300),failure:request.failure()}));
  page.on('response',response=>{if(response.url().includes('/api/timedtext'))(report.timedtextResponses ||= []).push({url:response.url(),status:response.status()});});
  if(selectedSuite==='menu-details'){await runMenuDetailsSuite(context,configure,mediaBase64);return;}
  if(selectedSuite==='control-clones'){await runControlClonesSuite(context,configure,mediaBase64);return;}
  const timedtext='https://m.youtube.com/api/timedtext?v=fluentread-mobile-992&lang=en';
  await page.route('**/api/timedtext**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({events:[{tStartMs:0,dDurationMs:30000,segs:[{utf8:source}]}]})}));
  await page.route(url,route=>route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Mobile YouTube subtitle fixture</title><style>html,body{margin:0;background:#e9edf3;font:16px Arial}#movie_player{position:relative;width:100%;height:min(56.25vw,100svh);aspect-ratio:16/9;background:#101820;overflow:hidden}video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.ytp-caption-window-container{position:absolute;left:0;right:0;top:45%;text-align:center;color:white}.ytp-caption-segment{background:#000b}.ytp-right-controls{position:absolute;right:8px;bottom:8px;height:32px;display:flex;gap:8px}.ytp-right-controls button{height:32px;background:#223345;color:white}.controls-hidden .ytp-right-controls{opacity:0;pointer-events:none}#description{padding:20px;line-height:1.6}</style><script>var ytInitialPlayerResponse=${JSON.stringify({videoDetails:{videoId:'fluentread-mobile-992'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:timedtext,languageCode:'en',name:{simpleText:'English'}}]}}})};</script></head><body><div id="movie_player" class="html5-video-player controls-hidden"><video playsinline preload="auto" src="data:video/mp4;base64,${mediaBase64}"></video><div id="ytp-caption-window-container" class="ytp-caption-window-container"><span class="ytp-caption-segment">${source}</span></div><div class="ytp-right-controls"><button aria-label="Settings">Settings</button><button aria-label="Fullscreen">Fullscreen</button></div></div><div id="description">Mobile YouTube layout fixture<br>生产扩展字幕定位与系统轨道接口专项<br>不是移动真机验收</div></body></html>`}));
  const activate=()=>helper.activateExtensionTabWithoutForeground(context,page);
  await page.setViewportSize({width:402,height:874});
  const cdp=await context.newCDPSession(page);
  const worlds=new Map();
  cdp.on('Runtime.executionContextCreated',({context})=>worlds.set(context.id,context));
  cdp.on('Runtime.executionContextDestroyed',({executionContextId})=>worlds.delete(executionContextId));
  cdp.on('Runtime.executionContextsCleared',()=>worlds.clear());
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  let isolatedWorld;
  const isolated=async expression=>{
    assert.ok(isolatedWorld,'Extension isolated world must be identified first');
    const result=await cdp.send('Runtime.evaluate',{contextId:isolatedWorld,expression,returnByValue:true,awaitPromise:true});
    assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;
  };
  evaluateBusinessWorld=isolated;
  const installNativeShim=async()=>{
    isolatedWorld=undefined;
    const extensionId=new URL(worker.url()).host;
    const frame=(await cdp.send('Page.getFrameTree')).frameTree.frame.id;
    for(let attempt=0;attempt<50&&!isolatedWorld;attempt++){
      for(const world of worlds.values()){
        if(world.auxData?.isDefault||world.auxData?.frameId!==frame) continue;
        try {
          const result=await cdp.send('Runtime.evaluate',{contextId:world.id,expression:'globalThis.chrome?.runtime?.id',returnByValue:true});
          if(result.result.value===extensionId){isolatedWorld=world.id;break;}
        }catch{/* A navigation can destroy a candidate context before inspection. */}
      }
      if(!isolatedWorld)await page.waitForTimeout(100);
    }
    assert.ok(isolatedWorld,'Unable to locate the production extension isolated world');
    const verified=await isolated(`(()=>{
      Object.defineProperty(HTMLVideoElement.prototype,'webkitEnterFullscreen',{configurable:true,value(){Object.defineProperty(this,'webkitDisplayingFullscreen',{value:true,configurable:true});this.dispatchEvent(new Event('webkitbeginfullscreen'));}});
      Object.defineProperty(HTMLVideoElement.prototype,'webkitExitFullscreen',{configurable:true,value(){Object.defineProperty(this,'webkitDisplayingFullscreen',{value:false,configurable:true});this.dispatchEvent(new Event('webkitendfullscreen'));}});
      return {extensionId:chrome.runtime.id,method:typeof document.querySelector('video').webkitEnterFullscreen};
    })()`);
    assert.equal(verified.extensionId,extensionId);assert.equal(verified.method,'function');
    (report.nativeShimWorlds ||= []).push({...verified,contextId:isolatedWorld});
  };
  await page.goto(url,{waitUntil:'domcontentloaded'}); await activate(); await installNativeShim();
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  const ready=()=>page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle')?.textContent?.includes('在视频底部')&&document.querySelector('track[data-fluent-read-native-subtitles]')?.track.cues?.length>0,null,{timeout:20000});
  report.trackDiagnostics=await diagnoseTrackResources();
  report.stage='initial-ready'; save();
  await ready();
  report.nativeResourceEvents=await page.evaluate(()=>window.__nativeTrackResourceEvents||[]);
  assert.ok(report.nativeResourceEvents.some(event=>event.trusted&&event.before===0&&event.afterTask>0),'Native HTMLTrack resource error must recover before the following timer task');
  const capture=async(name)=>{
    await checkFocus();
    const value=await page.evaluate(()=>{
      const rect=el=>{const r=el?.getBoundingClientRect();return r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null;};
      const panel=document.querySelector('#fluent-read-video-subtitle-panel');const track=document.querySelector('track[data-fluent-read-native-subtitles]');
      return {video:rect(document.querySelector('video')),panel:rect(panel),original:document.querySelector('#fluent-read-video-subtitle-original')?.textContent,translation:document.querySelector('#fluent-read-video-subtitle')?.textContent,nativeMode:track?.track.mode,nativeCues:Array.from(track?.track.cues||[]).map(c=>({start:c.startTime,end:c.endTime,text:c.text})),coarsePointer:matchMedia('(pointer:coarse)').matches,viewport:{width:innerWidth,height:innerHeight}};
    });
    report.cases.push({name,...value}); await page.screenshot({path:path.join(artifacts,`${name}.png`)}); return value;
  };
  const portrait=await capture('portrait-inline');
  assert.ok(portrait.panel.bottom>=portrait.video.bottom-18&&portrait.panel.bottom<=portrait.video.bottom,JSON.stringify(portrait));
  assert.equal(portrait.nativeMode,'hidden'); assert.match(portrait.nativeCues[0].text,/在视频底部/);
  assert.match(portrait.original,/Watch bilingual/);
  await page.evaluate(()=>document.querySelector('#movie_player').classList.remove('controls-hidden'));
  await page.waitForTimeout(1200); const controls=await capture('portrait-visible-controls');
  assert.ok(controls.panel.bottom<=controls.video.bottom-42,JSON.stringify(controls));
  let controlledMenuViewport=null;
  const primaryCodes=['bilingual','translation-only','original-only','off','subtitle-earlier','subtitle-later',
    'download-subtitles','download-translated-subtitles','download-bilingual-subtitles'];
  const captureMenuScrollTargets=async(name,includeTiming=false,includeFocused=false,includePrimary=false)=>{
    await checkFocus();
    const geometry=await page.evaluate(({includeTiming,includeFocused,includePrimary,controlledViewport})=>{
      const menu=document.querySelector('#fluent-read-video-subtitle-menu');
      const body=menu.querySelector('.fluent-read-video-menu-body'),header=menu.querySelector('.fluent-read-video-menu-title'),host=menu.parentElement;
      if(!body||!header)throw Error('Actual production menu must expose its owned body and header');
      const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const vv=window.visualViewport,visibleViewport=controlledViewport||{left:vv?.offsetLeft||0,top:vv?.offsetTop||0,
        right:(vv?.offsetLeft||0)+(vv?.width||innerWidth),bottom:(vv?.offsetTop||0)+(vv?.height||innerHeight)};
      const visibleRect=node=>{
        const bounds={...rect(node)};
        for(let ancestor=node.parentElement;ancestor;ancestor=ancestor.parentElement){
          const style=getComputedStyle(ancestor),clipX=/^(auto|scroll|hidden|clip)$/.test(style.overflowX),clipY=/^(auto|scroll|hidden|clip)$/.test(style.overflowY);
          if(!clipX&&!clipY)continue;
          const r=rect(ancestor),sx=r.width/(ancestor.offsetWidth||r.width)||1,sy=r.height/(ancestor.offsetHeight||r.height)||1;
          const left=r.left+ancestor.clientLeft*sx,top=r.top+ancestor.clientTop*sy;
          if(clipX){bounds.left=Math.max(bounds.left,left);bounds.right=Math.min(bounds.right,left+ancestor.clientWidth*sx);}
          if(clipY){bounds.top=Math.max(bounds.top,top);bounds.bottom=Math.min(bounds.bottom,top+ancestor.clientHeight*sy);}
        }
        bounds.left=Math.max(bounds.left,visibleViewport.left);bounds.top=Math.max(bounds.top,visibleViewport.top);
        bounds.right=Math.min(bounds.right,visibleViewport.right);bounds.bottom=Math.min(bounds.bottom,visibleViewport.bottom);
        return {...bounds,width:Math.max(0,bounds.right-bounds.left),height:Math.max(0,bounds.bottom-bounds.top)};
      };
      const codes=['close-menu',...(includeTiming?['subtitle-earlier','subtitle-later']:[])];
      if(includePrimary)codes.push('open-settings','bilingual','translation-only','original-only','off','subtitle-earlier','subtitle-later',
        'download-subtitles','download-translated-subtitles','download-bilingual-subtitles','open-sentence-learning');
      const targets=[...new Set(codes)].map(action=>({action,matches:[...menu.querySelectorAll(`[data-action="${action}"], [data-mode="${action}"]`)]}));
      if(includeFocused){const active=document.activeElement;targets.push({action:'focused',matches:active instanceof HTMLButtonElement&&menu.contains(active)?[active]:[]});}
      const headerVisible=visibleRect(header),menuFrame=rect(menu),menuPaddingTop=parseFloat(getComputedStyle(menu).paddingTop)||0;
      const menuClipTop=menuFrame.top+menu.clientTop*(menuFrame.height/(menu.offsetHeight||menuFrame.height)||1);
      const headerTopHits=[.25,.5,.75].map(fraction=>{
        const x=headerVisible.left+headerVisible.width*fraction,y=headerVisible.top+1,hit=document.elementFromPoint(x,y);
        return {x,y,hitOwnedHeader:hit===header||Boolean(hit&&header.contains(hit))};
      });
      const displayedButtons=[...menu.querySelectorAll('button')].filter(node=>!node.closest('[hidden]')&&node.getClientRects().length&&getComputedStyle(node).visibility==='visible');
      const identity=window.__responsiveMenuIdentity;
      return {menu:menuFrame,menuPaddingTop,menuClipTop,header:rect(header),headerVisible,headerTopHits,headerBackground:getComputedStyle(header).backgroundColor,
        headerDirectChild:header.parentElement===menu,headerOutsideBody:!body.contains(header),presentation:menu.dataset.presentation,layout:menu.dataset.layout,
        host:rect(host),hostRoot:host.parentElement===document.documentElement?'documentElement':host.parentElement===document.querySelector('#movie_player')?'player':'other',
        sameMenu:!identity||identity.menu===menu,sameHost:!identity||identity.host===host,
        visualViewport:visibleViewport,viewportMethod:controlledViewport?'production-world-VisualViewport-fixture':'native-browser-VisualViewport',
        scrollTop:menu.scrollTop,scrollHeight:menu.scrollHeight,clientHeight:menu.clientHeight,scrollWidth:menu.scrollWidth,clientWidth:menu.clientWidth,
        body:rect(body),bodyScrollTop:body.scrollTop,bodyScrollHeight:body.scrollHeight,bodyClientHeight:body.clientHeight,bodyScrollWidth:body.scrollWidth,bodyClientWidth:body.clientWidth,
        timingRow:includeTiming?rect(menu.querySelector('[data-timing-row]')):null,
        modeFrames:[...menu.querySelectorAll('[data-mode]')].map(node=>({mode:node.dataset.mode,frame:rect(node)})),
        displayedButtons:displayedButtons.map(node=>({code:node.dataset.action||node.dataset.mode,frame:rect(node)})),
        targets:targets.map(({action,matches})=>{
          const node=matches[0];if(!node)return {action,count:0};
          const frame=rect(node),visible=visibleRect(node);
          const points=[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y])=>{
            const px=frame.left+frame.width*x,py=frame.top+frame.height*y,hit=document.elementFromPoint(px,py);
            return {x:px,y:py,hitOwnedControl:hit===node||Boolean(hit&&node.contains(hit)),hitTag:hit?.tagName||null,hitClass:hit?.getAttribute('class')||null,hitAction:hit?.closest('[data-action], [data-mode]')?.getAttribute('data-action')||hit?.closest('[data-mode]')?.getAttribute('data-mode')||null};
          });
          return {action,count:matches.length,actualAction:node.dataset.action||null,actualMode:node.dataset.mode||null,inHeader:header.contains(node),frame,visible,
            fullyVisible:visible.left<=frame.left+.01&&visible.top<=frame.top+.01&&visible.right>=frame.right-.01&&visible.bottom>=frame.bottom-.01,points};
        })};
    },{includeTiming,includeFocused,includePrimary,controlledViewport:controlledMenuViewport});
    (report.menuScrollTargets ||= []).push({name,...geometry});save();
    // Capture geometry/hit state before any input. No locator auto-scroll may establish first-screen visibility.
    await page.screenshot({path:path.join(artifacts,`${name}.png`)});return geometry;
  };
  const assertWholeMenuTarget=(name,target,minSize=44)=>{
    assert.equal(target?.count,1,`${name}: actual target must be unique ${JSON.stringify(target)}`);
    assert.ok(target.frame.width>=minSize-.01&&target.frame.height>=minSize-.01&&target.visible.width>=minSize-.01&&target.visible.height>=minSize-.01&&target.fullyVisible,
      `${name}: full ${minSize}px target clipped by body/menu/host/viewport ${JSON.stringify(target)}`);
    assert.ok(target.points.length===5&&target.points.every(point=>point.hitOwnedControl),`${name}: five-point hit failed ${JSON.stringify(target)}`);
  };
  const assertMenuHeaderTop=(name,geometry)=>{
    if(geometry.presentation==='viewport'){
      assert.ok(geometry.headerDirectChild&&geometry.headerOutsideBody&&geometry.header.height>=44&&geometry.headerVisible.height>=geometry.header.height-.01,
        `${name}: permanent header must remain outside the body scroller ${JSON.stringify(geometry)}`);
      assert.ok(geometry.body.top>=geometry.header.bottom-.01&&geometry.scrollTop===0,`${name}: body must not cover/scroll the permanent header`);
    }else if(geometry.scrollTop>=geometry.menuPaddingTop){
      assert.ok(geometry.headerVisible.top<=geometry.menuClipTop+.01&&geometry.headerTopHits.every(point=>point.hitOwnedHeader),`${name}: desktop header covered`);
    }
  };
  const assertResponsive=(name,geometry,codes=primaryCodes,firstScreen=true)=>{
    assert.equal(geometry.presentation,'viewport',`${name}: actual binding must select the viewport host`);
    assert.equal(geometry.sameMenu,true);assert.equal(geometry.sameHost,true);
    assert.ok(geometry.menu.left>=geometry.host.left-.01&&geometry.menu.right<=geometry.host.right+.01&&geometry.menu.top>=geometry.host.top-.01&&geometry.menu.bottom<=geometry.host.bottom+.01,
      `${name}: menu escaped actual owned viewport host`);
    const vv=geometry.visualViewport;
    assert.ok(geometry.host.left>=vv.left-.01&&geometry.host.top>=vv.top-.01&&geometry.host.right<=vv.right+.01&&geometry.host.bottom<=vv.bottom+.01,`${name}: host escaped visible viewport`);
    assert.ok(geometry.scrollWidth<=geometry.clientWidth+1&&geometry.bodyScrollWidth<=geometry.bodyClientWidth+1,`${name}: horizontal menu/body overflow`);
    assert.ok(geometry.displayedButtons.length>0&&geometry.displayedButtons.every(node=>node.frame.width>=43.99&&node.frame.height>=43.99),`${name}: touch controls must all retain 44px rectangles`);
    if(firstScreen)assert.equal(geometry.bodyScrollTop,0,`${name}: first-screen geometry must precede body scroll/focus navigation`);
    assertMenuHeaderTop(name,geometry);
    for(const code of ['close-menu',...codes])assertWholeMenuTarget(name,geometry.targets.find(target=>target.action===code));
  };
  const checkedEntryClick=async(minSize=44)=>{
    await checkFocus();
    const target=await page.evaluate(()=>{
      const nodes=document.querySelectorAll('#fluent-read-video-subtitle-button');if(nodes.length!==1)return {count:nodes.length};
      const node=nodes[0],r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
      return {count:1,x,y,width:r.width,height:r.height,hit:hit===node||Boolean(hit&&node.contains(hit))};
    });
    assert.ok(target.count===1&&target.width>=minSize-.01&&target.height>=minSize-.01&&target.hit,`Entry must be directly hittable before click ${JSON.stringify(target)}`);
    await page.mouse.click(target.x,target.y);
    await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-menu')?.hidden===false);
  };
  const assertClosedMenu=async(name,previous)=>{
    const samples=(previous?.targets||[]).flatMap(target=>target.points||[]);
    const value=await page.evaluate(samples=>{
      const menu=document.querySelector('#fluent-read-video-subtitle-menu'),r=menu.getBoundingClientRect();
      const points=samples.length?samples:[{x:innerWidth/2,y:innerHeight/2},{x:innerWidth/2,y:innerHeight-20}];
      return {hidden:menu.hidden,display:getComputedStyle(menu).display,width:r.width,height:r.height,
        anyHit:points.some(({x,y})=>{const hit=document.elementFromPoint(x,y);return hit===menu||Boolean(hit&&menu.contains(hit));})};
    },samples);
    (report.closedMenuChecks ||= []).push({name,...value});save();
    assert.equal(value.hidden,true,`${name}: menu.hidden`);assert.equal(value.display,'none',`${name}: actual CSS must honor root hidden`);
    assert.ok(value.width===0&&value.height===0&&!value.anyHit,`${name}: hidden menu must leave neither painted rectangle nor sampled hit`);
  };
  const checkedMenuClose=async(name,geometry)=>{
    const target=geometry.targets.find(target=>target.action==='close-menu');assertWholeMenuTarget(name,target);
    await page.mouse.click(target.points[0].x,target.points[0].y);
    await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-menu')?.hidden===true);
    await assertClosedMenu(name,geometry);
    const focusedEntry=await page.evaluate(viewport=>{
      const nodes=document.querySelectorAll('#fluent-read-video-subtitle-button'),node=nodes[0];if(nodes.length!==1)return {count:nodes.length};
      const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
      const vv=viewport||{left:0,top:0,right:innerWidth,bottom:innerHeight};
      return {count:1,focused:node===document.activeElement,visible:r.width>0&&r.height>0&&r.left>=vv.left&&r.top>=vv.top&&r.right<=vv.right&&r.bottom<=vv.bottom,
        hit:hit===node||Boolean(hit&&node.contains(hit)),frame:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    },controlledMenuViewport);
    (report.closeFocusChecks ||= []).push({name,...focusedEntry});save();
    assert.ok(focusedEntry.count===1&&focusedEntry.focused&&focusedEntry.visible&&focusedEntry.hit,`${name}: Close must return visible focus to the same hittable entry ${JSON.stringify(focusedEntry)}`);
  };
  const settleMenu=()=>page.waitForTimeout(180);
  const resetBodyScroll=()=>page.evaluate(()=>{document.querySelector('.fluent-read-video-menu-body').scrollTop=0;});
  await page.waitForFunction(()=>Boolean(document.querySelector('#fluent-read-video-subtitle-menu')));
  await assertClosedMenu('initial');
  await checkedEntryClick();
  await page.evaluate(()=>{const menu=document.querySelector('#fluent-read-video-subtitle-menu');window.__responsiveMenuIdentity={menu,host:menu.parentElement};});
  await settleMenu();
  const normal=await captureMenuScrollTargets('portrait-402-menu-first-screen',true,false,true);
  assertResponsive('portrait402',normal,[...primaryCodes,'open-settings','open-sentence-learning']);
  assert.equal(portrait.coarsePointer,true,'Controlled touch fixture must really enable coarse CSS');
  report.touchTargets=normal.displayedButtons;
  await page.setViewportSize({width:320,height:720});await settleMenu();await resetBodyScroll();
  const narrow=await captureMenuScrollTargets('portrait-320-menu-first-screen',true,false,true);
  assertResponsive('portrait320',narrow,[...primaryCodes,'open-settings','open-sentence-learning']);
  const modes=narrow.modeFrames;
  assert.ok(modes.length===4&&Math.abs(modes[0].frame.top-modes[1].frame.top)<1&&Math.abs(modes[2].frame.top-modes[3].frame.top)<1&&modes[2].frame.top>=modes[0].frame.bottom-1,'320px modes must form two complete columns');
  await page.setViewportSize({width:844,height:390});await settleMenu();await resetBodyScroll();
  const wide=await captureMenuScrollTargets('landscape-844-menu-first-screen',true,false,true);
  assertResponsive('landscape844',wide,['bilingual','translation-only','original-only','off','subtitle-earlier','subtitle-later']);
  await page.setViewportSize({width:402,height:874});await settleMenu();await resetBodyScroll();
  // Preserve the actual VisualViewport EventTarget/listeners; override only its numeric accessors in the production isolated world.
  const setControlledMenuViewport=async(value)=>{
    const observed=await isolated(`(()=>{
      const vv=window.visualViewport;if(!vv)return {supported:false};
      let fixture=globalThis.__mobileMenuViewportFixture;
      if(!fixture){fixture={original:{},value:null};for(const key of ['width','height','offsetLeft','offsetTop'])fixture.original[key]=Object.getOwnPropertyDescriptor(vv,key);globalThis.__mobileMenuViewportFixture=fixture;}
      fixture.value=${JSON.stringify(value)};
      for(const key of ['width','height','offsetLeft','offsetTop']){
        if(fixture.value)Object.defineProperty(vv,key,{configurable:true,get:()=>fixture.value[key]});
        else if(fixture.original[key])Object.defineProperty(vv,key,fixture.original[key]);else delete vv[key];
      }
      vv.dispatchEvent(new Event('resize'));vv.dispatchEvent(new Event('scroll'));window.dispatchEvent(new Event('resize'));
      return {supported:true,width:vv.width,height:vv.height,offsetLeft:vv.offsetLeft,offsetTop:vv.offsetTop};
    })()`);
    assert.equal(observed.supported,true,'Controlled VisualViewport port unavailable');
    controlledMenuViewport=value?{left:observed.offsetLeft,top:observed.offsetTop,right:observed.offsetLeft+observed.width,bottom:observed.offsetTop+observed.height}:null;
    (report.menuViewportFixtures ||= []).push({requested:value,observed,actualOSKeyboard:false,method:'numeric VisualViewport accessors in the actual production isolated world; original EventTarget retained'});save();await settleMenu();
  };
  await setControlledMenuViewport({width:378,height:280,offsetLeft:12,offsetTop:80});await resetBodyScroll();
  const short=await captureMenuScrollTargets('short-offset-visualviewport-menu-top',false,false,true);
  assertResponsive('shortOffset',short,['bilingual','translation-only','original-only','off','subtitle-earlier','subtitle-later']);
  assert.ok(short.bodyScrollHeight>short.bodyClientHeight,'Intentionally short viewport must exercise actual body overflow');
  await page.evaluate(()=>{const body=document.querySelector('.fluent-read-video-menu-body');body.scrollTop=body.scrollHeight;});await settleMenu();
  const shortBottom=await captureMenuScrollTargets('short-offset-visualviewport-body-bottom',false,false,true);
  assertResponsive('shortOffsetBottom',shortBottom,[],false);
  assert.ok(shortBottom.bodyScrollTop>0,'Only the menu body should scroll in the constrained case');
  assert.ok(Math.abs(short.header.top-shortBottom.header.top)<.01&&Math.abs(short.header.bottom-shortBottom.header.bottom)<.01,'Body scrolling must not move permanent header');
  await checkedMenuClose('short-body-normal-close',shortBottom);await checkedEntryClick();
  // Observe the product's reset before any fixture viewport restoration or manual scroll reset can hide a regression.
  const shortReopened=await captureMenuScrollTargets('short-offset-body-bottom-close-reopen',false,true,true);
  assertResponsive('shortOffsetReopen',shortReopened,['bilingual','translation-only','original-only','off','subtitle-earlier','subtitle-later']);
  const reopenedFocus=shortReopened.targets.find(target=>target.action==='focused');
  const reopenedSelection=await page.evaluate(()=>{
    const checked=document.querySelectorAll('#fluent-read-video-subtitle-menu [data-mode][aria-checked="true"]');
    return {count:checked.length,mode:checked[0]?.dataset.mode,focusedSameNode:checked.length===1&&checked[0]===document.activeElement};
  });
  assert.ok(reopenedSelection.count===1&&reopenedSelection.focusedSameNode,'Reopening must focus the current checked mode node');
  assert.equal(reopenedFocus.actualMode,reopenedSelection.mode);
  assertWholeMenuTarget('shortOffsetReopenFocus',reopenedFocus);
  report.menuReopenFromBodyBottom={bodyScrollTop:shortReopened.bodyScrollTop,sameMenu:shortReopened.sameMenu,sameHost:shortReopened.sameHost,checkedMode:reopenedSelection.mode,focusedMode:reopenedFocus.actualMode,focusedSameCheckedNode:reopenedSelection.focusedSameNode,checkedBeforeFixtureReset:true};save();
  // This is a controlled visible-port fixture, not a native keyboard. At extremely small heights
  // only Close must fit; demanding the whole body here would turn intentional collapse into a failure.
  await page.evaluate(()=>{
    const menu=document.querySelector('#fluent-read-video-subtitle-menu'),body=menu.querySelector('.fluent-read-video-menu-body');
    window.__veryShortMenuIdentity={body,modes:[...menu.querySelectorAll('[data-mode]')],scrollTop:body.scrollTop,
      selected:menu.querySelector('[data-mode][aria-checked="true"]')?.dataset.mode};
  });
  const veryShortState=()=>page.evaluate(()=>{
    const menu=document.querySelector('#fluent-read-video-subtitle-menu'),body=menu.querySelector('.fluent-read-video-menu-body'),p=window.__veryShortMenuIdentity;
    const active=document.activeElement,close=menu.querySelector('[data-action="close-menu"]'),modes=[...menu.querySelectorAll('[data-mode]')];
    return {state:menu.dataset.viewportState||null,sameBody:body===p.body,sameModeNodes:modes.length===p.modes.length&&modes.every((node,i)=>node===p.modes[i]),
      selected:menu.querySelector('[data-mode][aria-checked="true"]')?.dataset.mode,expectedSelected:p.selected,
      bodyScrollTop:body.scrollTop,expectedScrollTop:p.scrollTop,bodyInert:Boolean(body.closest('[inert]')),bodyInLayout:body.getClientRects().length>0,
      closeFocused:active===close,externalFocused:active===document.querySelector('#description'),
      focusInInert:Boolean(active?.closest('[inert]')),focusInFoldedBranch:menu.contains(active)&&active!==close,
      viewportInertMarkers:[...menu.querySelectorAll('[data-viewport-inert]')].map(node=>node.hasAttribute('inert'))};
  });
  let normal128;
  for(const height of [44,54,58,80,83,84,127,128]){
    if(height===80){
      // An explicit fixture-only focus setup checks that resizing never steals an unrelated host focus.
      await page.evaluate(()=>{const outside=document.querySelector('#description');outside.tabIndex=-1;outside.focus({preventScroll:true});});
      report.veryShortOutsideFocusSetup='Controlled fixture-description focus with preventScroll; not a product focus action';save();
    }
    await setControlledMenuViewport({width:378,height,offsetLeft:12,offsetTop:80});
    const name=`very-short-${height}-close`,geometry=await captureMenuScrollTargets(name);
    assert.equal(geometry.presentation,'viewport');assert.ok(geometry.sameMenu&&geometry.sameHost,`${name}: same owned menu/host`);
    assert.ok(geometry.menu.left>=geometry.host.left-.01&&geometry.menu.right<=geometry.host.right+.01&&geometry.menu.top>=geometry.host.top-.01&&geometry.menu.bottom<=geometry.host.bottom+.01,`${name}: menu inside host`);
    const vv=geometry.visualViewport;
    assert.ok(geometry.host.left>=vv.left-.01&&geometry.host.top>=vv.top-.01&&geometry.host.right<=vv.right+.01&&geometry.host.bottom<=vv.bottom+.01,`${name}: host inside controlled port`);
    assertWholeMenuTarget(name,geometry.targets.find(target=>target.action==='close-menu'));
    const state=await veryShortState();(report.veryShortMenuChecks ||= []).push({height,...state});save();
    assert.ok(state.sameBody&&state.sameModeNodes&&state.selected===state.expectedSelected,`${name}: same body/modes/selection`);
    assert.equal(state.bodyScrollTop,state.expectedScrollTop,`${name}: collapse must not reset body scroll`);
    assert.equal(state.state,height<128?'close-only':null,`${name}: exact short-height boundary`);
    assert.equal(state.bodyInert,height<128,`${name}: body focus isolation`);
    assert.equal(state.bodyInLayout,height>=128,`${name}: collapsed body must leave the layout`);
    assert.ok(state.viewportInertMarkers.every(Boolean)&&!state.focusInInert,`${name}: no focus in collapsed inert content`);
    if(height===58){
      assert.equal(state.closeFocused,true,'Owned mode focus must move to the complete Close target');
      for(const key of ['Home','End','ArrowDown','Tab']){
        await page.keyboard.press(key);const observed=await veryShortState();
        (report.veryShortKeyboardChecks ||= []).push({height,key,...observed});save();
        assert.ok(!observed.focusInInert&&!observed.focusInFoldedBranch,`${name}: ${key} must not reach collapsed controls`);
        if(key!=='Tab')assert.equal(observed.closeFocused,true,`${name}: ${key} stays on the sole menu target`);
      }
    }
    if(height===80||height===83)assert.equal(state.externalFocused,true,`${name}: retain unrelated fixture focus`);
    if(height===128){normal128=geometry;assert.equal(state.closeFocused,true,'Expanding must not move Close focus back to the body');}
    if(height===83){
      const close=geometry.targets.find(target=>target.action==='close-menu');
      await page.mouse.click(close.points[0].x,close.points[0].y);
      await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-menu')?.hidden===true);
      await assertClosedMenu('very-short-normal-close',geometry);
      // Derive a new controlled83px port that actually contains the closed menu's known entry,
      // so reopening tests the explicit short-state initial focus without clicking outside that port.
      const entryFrame=await page.evaluate(()=>{const r=document.querySelector('#fluent-read-video-subtitle-button').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
      const reopenPort={width:378,height:83,offsetLeft:12,offsetTop:Math.max(0,entryFrame.top-2)};
      assert.ok(entryFrame.left>=reopenPort.offsetLeft&&entryFrame.right<=reopenPort.offsetLeft+reopenPort.width&&entryFrame.top>=reopenPort.offsetTop&&entryFrame.bottom<=reopenPort.offsetTop+reopenPort.height,'Short reopen entry must fit the derived controlled port');
      report.veryShortReopenPort={entryFrame,...reopenPort,actualOSKeyboard:false};save();
      await setControlledMenuViewport(reopenPort);await checkedEntryClick();
      const reopened=await captureMenuScrollTargets('very-short-83-reopened-close');
      assertWholeMenuTarget('veryShort83Reopened',reopened.targets.find(target=>target.action==='close-menu'));
      const reopenedState=await veryShortState();report.veryShortReopened=reopenedState;save();
      assert.ok(reopenedState.state==='close-only'&&reopenedState.closeFocused&&!reopenedState.focusInInert,'Explicit short-state open must focus the sole visible Close');
    }
  }
  const pageScrollState=()=>page.evaluate(()=>({x:scrollX,y:scrollY,rootTop:document.documentElement.scrollTop,rootLeft:document.documentElement.scrollLeft,bodyTop:document.body.scrollTop,bodyLeft:document.body.scrollLeft}));
  const before128PageScroll=await pageScrollState();
  await page.mouse.click(normal128.targets[0].points[0].x,normal128.targets[0].points[0].y);
  await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-menu')?.hidden===true);
  await assertClosedMenu('normal-128-before-focused-reopen',normal128);
  const entry128=await page.evaluate(()=>{const r=document.querySelector('#fluent-read-video-subtitle-button').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
  const port128={width:378,height:128,offsetLeft:12,offsetTop:Math.max(0,entry128.top-2)};
  assert.ok(entry128.left>=port128.offsetLeft&&entry128.right<=port128.offsetLeft+port128.width&&entry128.top>=port128.offsetTop&&entry128.bottom<=port128.offsetTop+port128.height,'128px normal-open entry must be inside the actual controlled port');
  report.normal128ReopenPort={entryFrame:entry128,...port128,actualOSKeyboard:false};save();
  await setControlledMenuViewport(port128);await checkedEntryClick();
  const assertFocused128=async(name,expected)=>{
    const geometry=await captureMenuScrollTargets(name,false,true);
    // A44px body window promises one revealed target, not all primary controls on the same screen.
    assertResponsive(name,geometry,[],false);
    const focused=geometry.targets.find(target=>target.action==='focused');assertWholeMenuTarget(name,focused);
    assert.equal(focused.actualMode||focused.actualAction,expected,`${name}: known focused control`);
    const state=await veryShortState();
    const ownsFocus=await page.evaluate(()=>document.querySelector('.fluent-read-video-menu-body').contains(document.activeElement));
    const pageScroll=await pageScrollState();
    (report.normal128FocusedControls ||= []).push({name,ownsFocus,pageScroll,...state});save();
    assert.ok(ownsFocus&&state.sameBody&&state.sameModeNodes&&state.selected===state.expectedSelected&&!state.bodyInert&&!state.focusInInert,`${name}: same reachable owned body and unchanged selection`);
    assert.deepEqual(pageScroll,before128PageScroll,`${name}: only the owned body may scroll`);
    return geometry;
  };
  const opened128=await assertFocused128('normal-128-open-selected',reopenedSelection.mode);
  await page.keyboard.press('End');
  const last128=await assertFocused128('normal-128-keyboard-last','open-sentence-learning');
  assert.ok(last128.bodyScrollTop>opened128.bodyScrollTop,'End must actually scroll the owned body to its last control');
  await setControlledMenuViewport({...port128,height:127});
  const folded127=await captureMenuScrollTargets('normal-128-scrolled-collapse-127');
  assertWholeMenuTarget('scrolledCollapse127',folded127.targets.find(target=>target.action==='close-menu'));
  const folded127State=await veryShortState();
  assert.ok(folded127State.state==='close-only'&&folded127State.bodyInert&&!folded127State.bodyInLayout&&folded127State.closeFocused&&!folded127State.focusInInert,'Collapsing a scrolled body must move its owned focus to Close');
  // A display:none body has no scroll box; only the expanded body's restored nonzero position is authoritative.
  await setControlledMenuViewport(port128);
  const expanded128=await captureMenuScrollTargets('normal-128-scrolled-restored');
  assertWholeMenuTarget('scrolledRestored128',expanded128.targets.find(target=>target.action==='close-menu'));
  const expanded128State=await veryShortState();
  report.nonzeroBodyCollapseRestore={beforeScrollTop:last128.bodyScrollTop,folded:folded127State,expanded:expanded128State};save();
  assert.ok(expanded128State.sameBody&&expanded128State.sameModeNodes&&expanded128State.selected===expanded128State.expectedSelected&&expanded128State.state===null&&!expanded128State.bodyInert&&expanded128State.bodyInLayout&&expanded128State.closeFocused,'Expanding must retain body/modes/selection and must not return focus to the body');
  assert.equal(expanded128.bodyScrollTop,last128.bodyScrollTop,'Expanded body must restore its previous actual nonzero scroll position');
  assert.deepEqual(await pageScrollState(),before128PageScroll,'Collapse/expand must not scroll the host page');
  for(const key of ['Home','ArrowDown','ArrowDown'])await page.keyboard.press(key);
  const first128=await assertFocused128('normal-128-keyboard-first','bilingual');
  assert.ok(first128.bodyScrollTop<last128.bodyScrollTop,'Returning to the first body control must scroll only that body upwards');
  await setControlledMenuViewport({width:378,height:280,offsetLeft:12,offsetTop:80});
  const restoredBeforeReopen=await captureMenuScrollTargets('very-short-restored-280-before-reopen',true,false,true);
  assertResponsive('veryShortRestored280BeforeReopen',restoredBeforeReopen,['bilingual','translation-only','original-only','off','subtitle-earlier','subtitle-later'],false);
  assert.deepEqual(await pageScrollState(),before128PageScroll,'Restoring the larger viewport must not scroll the page');
  // Preserve the pre-existing first-screen zero-scroll oracle by explicitly closing/reopening;
  // do not erase the128px keyboard scroll with a fixture assignment.
  await checkedMenuClose('restored-280-normal-close',restoredBeforeReopen);await checkedEntryClick();
  const restoredShort=await captureMenuScrollTargets('very-short-restored-280-primary',true,false,true);
  assertResponsive('veryShortRestored280',restoredShort,['bilingual','translation-only','original-only','off','subtitle-earlier','subtitle-later']);
  const restoredShortState=await veryShortState();report.veryShortRestored280=restoredShortState;save();
  assert.ok(restoredShortState.sameBody&&restoredShortState.sameModeNodes&&restoredShortState.selected===restoredShortState.expectedSelected,'Restored viewport must retain body/modes/selection');
  assert.ok(restoredShortState.state===null&&!restoredShortState.bodyInert&&restoredShortState.bodyInLayout&&restoredShortState.viewportInertMarkers.length===0,'Restored body must rejoin layout and keyboard access');
  await setControlledMenuViewport(null);
  await page.evaluate(()=>{window.__menuRootStyles={html:document.documentElement.getAttribute('style'),body:document.body.getAttribute('style')};document.documentElement.style.transform='translate(17px,11px) scale(.8)';document.documentElement.style.transformOrigin='0 0';document.body.style.transform='translateX(30px)';window.dispatchEvent(new Event('resize'));});
  await settleMenu();
  const transformed=await captureMenuScrollTargets('root-transform-viewport-menu',true,false,true);
  assertResponsive('rootTransform',transformed,primaryCodes);
  await page.evaluate(()=>{for(const [key,node] of [['html',document.documentElement],['body',document.body]]){const value=window.__menuRootStyles[key];if(value===null)node.removeAttribute('style');else node.setAttribute('style',value);}delete window.__menuRootStyles;window.dispatchEvent(new Event('resize'));});await settleMenu();
  try{await cdp.send('Emulation.setSafeAreaInsets',{insets:{top:9,left:7,bottom:17,right:11}});report.menuSafeAreaEmulation={supported:true,insets:{top:9,left:7,bottom:17,right:11}};}
  catch(error){report.menuSafeAreaEmulation={supported:false,status:'NOT_TESTED_CDP_UNAVAILABLE',reason:String(error)};}
  if(report.menuSafeAreaEmulation.supported){
    await page.evaluate(()=>{visualViewport.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('resize'));});await settleMenu();await resetBodyScroll();
    const safeMenu=await captureMenuScrollTargets('safe-area-viewport-menu',true,false,true);assertResponsive('safeArea',safeMenu,primaryCodes);
    assert.ok(safeMenu.host.left>=7-.01&&safeMenu.host.top>=9-.01&&safeMenu.host.right<=402-11+.01&&safeMenu.host.bottom<=874-17+.01,'Production host must subtract actual CSS safe insets');
    await cdp.send('Emulation.setSafeAreaInsets',{insets:{top:0,left:0,bottom:0,right:0}});await page.evaluate(()=>{visualViewport.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('resize'));});await settleMenu();
  }
  const closeGeometry=await captureMenuScrollTargets('portrait-menu-before-normal-close',false);
  await checkedMenuClose('portrait-normal-close',closeGeometry);await capture('portrait-menu-normal-close');
  const entry=page.locator('#fluent-read-video-subtitle-button');
  await checkedEntryClick();
  const keyboardSteps=[['End','open-sentence-learning'],['ArrowUp','download-bilingual-subtitles'],['ArrowUp','download-translated-subtitles'],['ArrowUp','download-subtitles'],
    ['ArrowUp','subtitle-later'],['ArrowUp','subtitle-earlier'],['ArrowUp','off'],['ArrowUp','original-only'],['ArrowUp','translation-only'],['ArrowUp','bilingual'],['ArrowUp','close-menu'],['Home','open-settings']];
  let lastKeyboardGeometry;
  for(const [index,[key,expected]] of keyboardSteps.entries()){
    await page.keyboard.press(key);const name=`portrait-menu-keyboard-${index+1}-${key}`;
    const geometry=await captureMenuScrollTargets(name,false,true),focused=geometry.targets.find(target=>target.action==='focused');lastKeyboardGeometry=geometry;
    (report.menuKeyboardSteps ||= []).push({key,expected,observed:focused.actualAction||focused.actualMode});save();
    assert.equal(focused.actualAction||focused.actualMode,expected);assertMenuHeaderTop(name,geometry);
    for(const target of geometry.targets)assertWholeMenuTarget(name,target);
  }
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-menu')?.hidden===true);
  await assertClosedMenu('Escape',lastKeyboardGeometry);assert.equal(await entry.evaluate(node=>node===document.activeElement),true);
  await checkedEntryClick();
  const outsideGeometry=await captureMenuScrollTargets('portrait-menu-before-outside-close',false);
  const outside=await page.evaluate(()=>{
    const node=document.querySelector('#description'),r=node.getBoundingClientRect(),menu=document.querySelector('#fluent-read-video-subtitle-menu').getBoundingClientRect();
    const x=r.left+20,y=r.top+20,hit=document.elementFromPoint(x,y);
    return {x,y,insideViewport:x>=0&&y>=0&&x<innerWidth&&y<innerHeight,outsideMenu:x<menu.left||x>menu.right||y<menu.top||y>menu.bottom,hitOwnedDescription:hit===node||Boolean(hit&&node.contains(hit))};
  });
  assert.ok(outside.insideViewport&&outside.outsideMenu&&outside.hitOwnedDescription,'Outside close requires a checked fixture-description hit, not an unverified page/player click');
  await page.mouse.click(outside.x,outside.y);await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-menu')?.hidden===true);
  await assertClosedMenu('outside',outsideGeometry);
  report.menuResponsiveCoverage={portrait402:true,portrait320TwoColumns:true,landscape844PrimaryFirstScreen:true,bodyOnlyScrollAndPinnedHeader:true,
    veryShort44_54Close44FiveHits:true,
    veryShort58_80_83Close44FiveHits:true,closeOnly84_127:true,normal128FocusedFirstLast44FiveHits:true,restored280PrimaryAndIdentity:true,inertBodyAndOwnedFocusOnly:true,
    visualViewportKeyboardGeometryFixture:true,actualOSKeyboard:false,rootTransform:true,safeArea:report.menuSafeAreaEmulation.supported?'PASS':'NOT_TESTED_CDP_UNAVAILABLE',
    initialCloseEscapeOutsideCSSHiddenAndNoHit:true,languageMatrix:'NOT_RUN_IN_THIS_SUITE; use existing language tests',DOMFullscreenMenu:'PENDING'};save();
  await page.setViewportSize({width:844,height:390});
  await page.waitForTimeout(1200);const landscape=await capture('landscape-inline');
  assert.ok(landscape.panel.left>=landscape.video.left&&landscape.panel.right<=landscape.video.right,JSON.stringify(landscape));
  assert.ok(landscape.video.bottom<=landscape.viewport.height&&landscape.panel.bottom<=landscape.viewport.height,JSON.stringify(landscape));
  try {
    await cdp.send('Emulation.setSafeAreaInsets', {insets:{top:0,left:44,bottom:24,right:44}});
    report.safeAreaEmulation={supported:true,insets:{left:44,right:44,bottom:24}};
  } catch(error) {
    report.safeAreaEmulation={supported:false,reason:String(error)};
  }
  // Exercise the production fullscreen geometry branch without changing the
  // browser's native window state or display placement.
  await isolated(`Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>document.querySelector('#movie_player')})`);
  await page.evaluate(()=>{const player=document.querySelector('#movie_player');player.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;aspect-ratio:auto;';document.dispatchEvent(new Event('fullscreenchange'));});
  await page.waitForTimeout(1200);
  const safe=await capture('fullscreen-geometry-safe-area');
  await checkedEntryClick();await resetBodyScroll();
  const fullscreenMenu=await captureMenuScrollTargets('dom-fullscreen-safe-area-menu',true,false,true);
  assertResponsive('DOMFullscreen',fullscreenMenu,['bilingual','translation-only','original-only','off','subtitle-earlier','subtitle-later']);
  assert.equal(fullscreenMenu.hostRoot,'player','DOM fullscreen host must move into the actual fixture fullscreen root');
  await checkedMenuClose('DOMFullscreen-close',fullscreenMenu);report.menuResponsiveCoverage.DOMFullscreenMenu='PASS_CONTROLLED_PROPERTY_FIXTURE';save();
  const side=report.safeAreaEmulation.supported?44:12;
  assert.ok(safe.panel.left>=side-1&&safe.panel.right<=safe.viewport.width-side+1,JSON.stringify(safe));
  if(report.safeAreaEmulation.supported) assert.ok(safe.panel.bottom<=safe.viewport.height-24+1,JSON.stringify(safe));
  await isolated(`delete document.fullscreenElement`);
  await page.evaluate(()=>{document.querySelector('#movie_player').removeAttribute('style');document.dispatchEvent(new Event('fullscreenchange'));});
  if(report.safeAreaEmulation.supported) await cdp.send('Emulation.setSafeAreaInsets',{insets:{top:0,left:0,bottom:0,right:0}});
  const runDesktopMenu=async()=>{
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await page.setViewportSize({width:1280,height:900});
    const desktopCapabilities=await page.evaluate(()=>({coarsePointer:matchMedia('(pointer:coarse)').matches,maxTouchPoints:navigator.maxTouchPoints}));
    report.desktopMenu={capabilities:desktopCapabilities,minimumTargetSize:22,keyboardSteps:[]};save();
    assert.equal(desktopCapabilities.coarsePointer,false,'Desktop section must actually leave coarse-pointer CSS');
    assert.equal(desktopCapabilities.maxTouchPoints,0,'Desktop section must actually disable touch emulation');
    await page.evaluate(()=>document.querySelector('#movie_player').classList.remove('controls-hidden'));
    await checkedEntryClick(22);
    const desktopOpen=await captureMenuScrollTargets('desktop-menu-open',false,true);
    assert.ok(desktopOpen.header.height<=28,`Desktop header must retain its existing compact size ${JSON.stringify(desktopOpen.header)}`);
    for(const target of desktopOpen.targets)assertWholeMenuTarget('desktop-open',target,22);
    for(const [key,expected] of [['End','open-sentence-learning'],['Home','open-settings']]){
      await page.keyboard.press(key);
      const name=`desktop-menu-keyboard-${key}`,geometry=await captureMenuScrollTargets(name,false,true);
      const focused=geometry.targets.find(target=>target.action==='focused');
      report.desktopMenu.keyboardSteps.push({key,expected,observed:focused.actualAction||focused.actualMode});save();
      assert.equal(focused.actualAction||focused.actualMode,expected,`${name}: trusted key must focus the expected actual control`);
      for(const target of geometry.targets)assertWholeMenuTarget(name,target,22);
      assertMenuHeaderTop(name,geometry);
      assert.ok(focused.inHeader||geometry.headerVisible.height===0||focused.frame.top>=geometry.headerVisible.bottom-.01,
        `${name}: focused body control is covered by the menu header ${JSON.stringify(focused)}`);
    }
    const desktopClose=await captureMenuScrollTargets('desktop-menu-before-close',false);
    const desktopCloseTarget=desktopClose.targets[0];assertWholeMenuTarget('desktop-close',desktopCloseTarget,22);
    await page.mouse.click(desktopCloseTarget.points[0].x,desktopCloseTarget.points[0].y);
    await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-menu')?.hidden===true);
    await assertClosedMenu('desktop-normal-close',desktopClose);
    assert.equal(await entry.evaluate(node=>node===document.activeElement),true,'Desktop normal Close must return focus to the same player entry');
    report.desktopMenu.normalCloseFocusReturned=true;
    await capture('desktop-menu-normal-close');
  };
  const disableAndCheckCleanup=async()=>{
    await configure({on:false});await page.waitForFunction(()=>!document.querySelector('#fluent-read-video-subtitle-layer')&&!document.querySelector('track[data-fluent-read-native-subtitles]'));
    await capture('disabled-cleanup');
    assert.equal(report.errors.length,0,report.errors.join('\n'));
  };
  if(selectedSuite==='menu'){
    report.nativeSystemSelectionShim={status:'NOT_RUN_EXPLICIT_MENU_SUITE',scope:'Native selection lifecycle is excluded; shared fullscreen geometry remains a controlled DOM fixture'};save();
    await runDesktopMenu();
    await disableAndCheckCleanup();
    return;
  }
  report.nativeSystemSelectionShim={scope:'Explicit standard TextTrack.mode writes emulate system-menu selections on Chromium; not native AVKit selection or rendering',selectionChanges:[]};
  // Subscribe before each selection write. Only an actual browser change event
  // acknowledges selection; cue counts and fixed sleeps are not selection ACKs.
  const selectNativeTracks=async(name,desired)=>{
    const receipt=await page.evaluate(({name,desired})=>new Promise((resolve,reject)=>{
      const video=document.querySelector('video'),list=video.textTracks;
      const owned=document.querySelector('track[data-fluent-read-native-subtitles]')?.track;
      const refs={site:window.__siteTrack,owned,other:window.__otherSiteTrack};
      const modes=()=>Array.from(list).map(track=>({kind:track.kind,label:track.label,mode:track.mode}));
      const matches=()=>Object.entries(desired).every(([key,mode])=>refs[key]?.mode===mode);
      const before=modes(),events=[],startedAt=performance.now(),deadline=startedAt+2000;
      let settled=false,timer,afterEvent;
      const cleanup=()=>{clearTimeout(timer);clearTimeout(afterEvent);list.removeEventListener('change',onChange);};
      const fail=message=>{if(settled)return;settled=true;cleanup();reject(Error(JSON.stringify({name,message,before,desired,events,after:modes()})));};
      const onChange=event=>{
        events.push({type:event.type,isTrusted:event.isTrusted,elapsedMs:performance.now()-startedAt,tracks:modes()});
        if(!event.isTrusted)return fail('Selection ACK must be a trusted browser change event');
        if(!matches()||afterEvent!==undefined)return;
        // Finish after dispatch, including the production bridge listeners.
        afterEvent=setTimeout(()=>{
          if(performance.now()>=deadline)return fail('change ACK exceeded absolute deadline');
          if(!matches())return fail('selection changed before post-dispatch ACK');
          settled=true;cleanup();resolve({name,before,desired,events,after:modes(),elapsedMs:performance.now()-startedAt});
        },0);
      };
      list.addEventListener('change',onChange);
      timer=setTimeout(()=>fail('No actual TextTrackList.change ACK within 2000ms'),2000);
      try{
        if(!Object.keys(desired).every(key=>refs[key]))return fail('Required track missing');
        if(matches())return fail('Selection setup made no mode transition');
        for(const [key,mode] of Object.entries(desired))refs[key].mode=mode;
      }catch(error){fail(String(error));}
    }),{name,desired});
    report.nativeSystemSelectionShim.selectionChanges.push(receipt);save();
  };
  await page.evaluate(()=>{
    const video=document.querySelector('video');const track=video.addTextTrack('captions','Site captions','en');
    track.addCue(new VTTCue(0,30,'Site caption'));window.__siteTrack=track;
    window.__nativeBridgeNode=document.querySelector('track[data-fluent-read-native-subtitles]');
  });
  await selectNativeTracks('initial-site-A',{site:'showing'});
  await isolated(`document.querySelector('video').webkitEnterFullscreen()`);
  await page.waitForFunction(()=>document.querySelector('track[data-fluent-read-native-subtitles]')?.track.mode==='hidden');
  assert.equal(await page.evaluate(()=>window.__siteTrack.mode),'showing','Entering the native interface must preserve the site selection');
  await capture('native-interface-enter');
  report.nativeSystemSelectionShim.beginPreservedSiteSelection=true;
  // A -> FluentRead -> leave restores A, without an intervening Off choice.
  await selectNativeTracks('A-to-FluentRead-direct',{site:'disabled',owned:'showing'});
  await isolated(`document.querySelector('video').webkitExitFullscreen()`);
  await page.waitForFunction(()=>document.querySelector('track[data-fluent-read-native-subtitles]')?.track.mode==='hidden');
  assert.equal(await page.evaluate(()=>window.__siteTrack.mode),'showing','Direct A to FluentRead must restore A on leave');
  report.nativeSystemSelectionShim.directSourceRestored=true;
  // A -> FluentRead -> Off -> FluentRead must not revive obsolete A.
  await isolated(`document.querySelector('video').webkitEnterFullscreen()`);
  await selectNativeTracks('A-to-FluentRead-before-Off',{site:'disabled',owned:'showing'});
  const countBeforeOff=await page.evaluate(()=>window.__nativeBridgeNode.track.cues.length);
  await selectNativeTracks('system-Off',{owned:'disabled'});
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(()=>window.__nativeBridgeNode.track.mode),'disabled');
  assert.equal(await page.evaluate(()=>document.querySelector('track[data-fluent-read-native-subtitles]')===window.__nativeBridgeNode),true,'Off must preserve the owned track identity');
  await selectNativeTracks('Off-to-FluentRead',{owned:'showing'});
  // Cue readiness remains a separate assertion after the real change ACK.
  await page.waitForFunction(count=>window.__nativeBridgeNode.track.cues?.length===count,countBeforeOff);
  await isolated(`document.querySelector('video').webkitExitFullscreen()`);
  await page.waitForFunction(()=>window.__nativeBridgeNode.track.mode==='hidden');
  assert.equal(await page.evaluate(()=>window.__siteTrack.mode),'disabled','Off followed by FluentRead must not restore obsolete A on leave');
  report.nativeSystemSelectionShim.offThenFluentReadKeptSourceDisabled=true;
  // Off -> leave/re-enter must neither restore A nor auto-select FluentRead.
  await isolated(`document.querySelector('video').webkitEnterFullscreen()`);
  await selectNativeTracks('FluentRead-before-Off-reentry',{site:'disabled',owned:'showing'});
  await selectNativeTracks('Off-before-leave',{owned:'disabled'});
  await isolated(`document.querySelector('video').webkitExitFullscreen()`);
  assert.equal(await page.evaluate(()=>window.__siteTrack.mode),'disabled','Leaving after Off must not restore an earlier site selection');
  await isolated(`document.querySelector('video').webkitEnterFullscreen()`);
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(()=>window.__nativeBridgeNode.track.mode),'hidden');
  assert.equal(await page.evaluate(()=>window.__siteTrack.mode),'disabled');
  report.nativeSystemSelectionShim.offPreservedAcrossReentry=true;
  await isolated(`document.querySelector('video').webkitExitFullscreen()`);
  await page.evaluate(()=>{
    const other=document.querySelector('video').addTextTrack('captions','Other site captions','en');
    other.addCue(new VTTCue(0,30,'Other site caption'));window.__otherSiteTrack=other;
  });
  await selectNativeTracks('source-A-before-other-choice',{site:'showing',other:'disabled'});
  await isolated(`document.querySelector('video').webkitEnterFullscreen()`);
  await selectNativeTracks('A-to-FluentRead-before-B',{site:'disabled',owned:'showing'});
  await selectNativeTracks('FluentRead-to-source-B',{owned:'disabled',other:'showing'});
  await isolated(`document.querySelector('video').webkitExitFullscreen()`);
  assert.equal(await page.evaluate(()=>window.__otherSiteTrack.mode),'showing','Leaving after another site selection must preserve that selection');
  assert.equal(await page.evaluate(()=>window.__siteTrack.mode),'disabled');
  report.nativeSystemSelectionShim.otherSiteSelectionPreserved=true;
  await selectNativeTracks('restore-site-A-before-disable',{other:'disabled',site:'showing'});
  await configure({videoSubtitleVisible:false});await page.waitForFunction(()=>!document.querySelector('track[data-fluent-read-native-subtitles]'));
  assert.equal(await page.evaluate(()=>window.__siteTrack.mode),'showing');
  await configure({videoSubtitleVisible:true});await ready();
  await page.evaluate(()=>{const old=document.querySelector('video'); const next=old.cloneNode(false);old.replaceWith(next);next.load();});await ready();await capture('video-replaced');
  await page.reload({waitUntil:'domcontentloaded'});await activate();await installNativeShim();await ready();await capture('refresh-recovered');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await ready();
  await runDesktopMenu();
  await disableAndCheckCleanup();
}
main().catch(async error=>{
  report.errors.push(error.stack||String(error));process.exitCode=1;
  if(page&&!focusError){
    try{
      await checkFocus();
      report.failureDom=await page.evaluate(()=>{
        const video=document.querySelector('video');const clone=document.documentElement.cloneNode(true);clone.querySelectorAll('video').forEach(node=>node.removeAttribute('src'));
        return {url:location.href,visibility:document.visibilityState,video:video&&{readyState:video.readyState,currentTime:video.currentTime,paused:video.paused,seeking:video.seeking,width:video.videoWidth,height:video.videoHeight,tracks:Array.from(video.textTracks).map(track=>({kind:track.kind,label:track.label,mode:track.mode,cues:track.cues?.length})),nodes:Array.from(video.querySelectorAll('track')).map(track=>({readyState:track.readyState,kind:track.kind,language:track.srclang,mode:track.track.mode,cues:track.track.cues?.length}))},html:clone.outerHTML};
      });
      fs.writeFileSync(path.join(artifacts,'failure-dom.html'),report.failureDom.html);delete report.failureDom.html;
      await page.screenshot({path:path.join(artifacts,'failure.png')});
      if(evaluateBusinessWorld)report.failureBusinessTracks=await evaluateBusinessWorld(`Array.from(document.querySelector('video')?.textTracks||[]).map(track=>({kind:track.kind,label:track.label,mode:track.mode,cues:track.cues?.length}))`);
      // Explicit diagnostic controls after the failure screenshot. These hidden
      // media nodes do not claim to satisfy the production caption assertion.
      if(control)report.failureConfig=await control.evaluate(async()=>{
        const read=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof read?.value==='string'?JSON.parse(read.value):(read?.value||{});
        return {on:c.on,from:c.from,to:c.to,videoTranslationEnabled:c.videoTranslationEnabled,videoSubtitleVisible:c.videoSubtitleVisible,videoSubtitleDisplayMode:c.videoSubtitleDisplayMode,videoService:c.videoService};
      });
    }catch(captureError){report.failureCaptureError=String(captureError);}
  }
}).finally(async()=>{
  if(worker)try{report.mockRequests=await worker.evaluate(()=>globalThis.__mobileVideoRequests||[]);}catch(error){report.workerCaptureError=String(error);}
  cleanupStarted=true;clearInterval(focusTimer);
  try{await closeOwned();}catch(error){report.errors.push(String(error));process.exitCode=1;}
  if(focusMonitor){
    try{await focusMonitor.stop();}catch(error){report.focusObserverCleanupError=String(error);process.exitCode=1;}
    const observerError=focusMonitor.error;
    if(observerError){report.focusObserverError=String(observerError);report.errors.push(report.focusObserverError);process.exitCode=1;}
    report.focusEvents=[...focusMonitor.events];
    if(browserPid&&report.focusEvents.some(event=>event.pid===browserPid)){
      report.errors.push('Owned test browser activated during complete focus observation, including cleanup');process.exitCode=1;
    }
  }
  if(profileDir&&(report.browserCloseReceipt==='shared-guard-fulfilled'||!launchAttempted)){
    fs.rmSync(profileDir,{recursive:true,force:true,maxRetries:5,retryDelay:200});report.profileRemoved=true;
  }else if(profileDir)report.retainedProfile=profileDir;
  save();
  console.log(JSON.stringify({ok:!process.exitCode,selectedSuite,artifacts,cases:report.cases.length,errors:report.errors},null,2));
});

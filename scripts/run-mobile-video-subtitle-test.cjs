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
const report = {fixture:'mobile-youtube-production-extension', evidenceLimits:['local HTML and timedtext fixtures', 'mock translation', 'Chromium viewport/touch emulation', 'isolated-extension-world webkit capability/event shim only; no iOS/AVKit rendering', 'fullscreen geometry uses an explicit DOM property fixture; no system/window fullscreen', 'no live provider or mobile device'], cases:[], errors:[]};
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
  const timedtext='https://m.youtube.com/api/timedtext?v=fluentread-mobile-992&lang=en';
  await page.route('**/api/timedtext**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({events:[{tStartMs:0,dDurationMs:30000,segs:[{utf8:source}]}]})}));
  await page.route(url,route=>route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Mobile YouTube subtitle fixture</title><style>html,body{margin:0;background:#e9edf3;font:16px Arial}#movie_player{position:relative;width:100%;height:min(56.25vw,100svh);aspect-ratio:16/9;background:#101820;overflow:hidden}video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.ytp-caption-window-container{position:absolute;left:0;right:0;top:45%;text-align:center;color:white}.ytp-caption-segment{background:#000b}.ytp-right-controls{position:absolute;right:8px;bottom:8px;height:32px;display:flex;gap:8px}.ytp-right-controls button{height:32px;background:#223345;color:white}.controls-hidden .ytp-right-controls{opacity:0;pointer-events:none}#description{padding:20px;line-height:1.6}</style><script>var ytInitialPlayerResponse=${JSON.stringify({videoDetails:{videoId:'fluentread-mobile-992'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:timedtext,languageCode:'en',name:{simpleText:'English'}}]}}})};</script></head><body><div id="movie_player" class="html5-video-player controls-hidden"><video playsinline preload="auto" src="data:video/mp4;base64,${mediaBase64}"></video><div id="ytp-caption-window-container" class="ytp-caption-window-container"><span class="ytp-caption-segment">${source}</span></div><div class="ytp-right-controls"><button aria-label="Settings">Settings</button><button aria-label="Fullscreen">Fullscreen</button></div></div><div id="description">Mobile YouTube layout fixture<br>生产扩展字幕定位与系统轨道接口专项<br>不是移动真机验收</div></body></html>`}));
  const activate=()=>helper.activateExtensionTabWithoutForeground(context,page);
  await page.setViewportSize({width:390,height:844});
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
  await page.locator('#fluent-read-video-subtitle-button').click();
  await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-menu')?.hidden===false);
  assert.ok(await page.locator('[data-native-fullscreen-hint]').isVisible());
  const targets=await page.locator('#fluent-read-video-subtitle-menu button, #fluent-read-video-subtitle-button').evaluateAll(nodes=>nodes.filter(n=>{
    const style=getComputedStyle(n);
    return !n.closest('[hidden]')&&n.getClientRects().length>0&&style.visibility==='visible'&&Number(style.opacity)>0;
  }).map(n=>({action:n.dataset.action||n.dataset.mode||n.id,label:n.getAttribute('aria-label')||n.textContent.trim(),height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width})));
  report.touchTargets=targets;
  if(portrait.coarsePointer) assert.ok(targets.length>0&&targets.every(t=>t.height>=44&&t.width>=44),JSON.stringify(targets));
  await capture('portrait-menu');
  const timingGeometry=await page.evaluate(()=>{
    const menu=document.querySelector('#fluent-read-video-subtitle-menu');
    const row=menu.querySelector('[data-timing-row]');
    menu.scrollTop+=Math.max(0,row.getBoundingClientRect().bottom-menu.getBoundingClientRect().bottom+8);
    const label=row.querySelector('.fluent-read-video-menu-row-label');
    const controls=row.querySelector('.fluent-read-video-menu-timing-controls');
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
    const style=getComputedStyle(label);
    return {menu:rect(menu),row:rect(row),label:rect(label),controls:rect(controls),modes:rect(menu.querySelector('[data-mode]').parentElement),labelText:label.textContent,labelWidth:label.clientWidth,labelScrollWidth:label.scrollWidth,labelHeight:label.clientHeight,labelScrollHeight:label.scrollHeight,overflow:style.overflow,textOverflow:style.textOverflow,contain:style.contain,offset:controls.querySelector('[data-subtitle-offset]').textContent};
  });
  report.timingGeometry=timingGeometry;
  assert.equal(timingGeometry.labelText,'字幕时间');
  assert.ok(timingGeometry.row.top>=timingGeometry.modes.bottom-1,'Touch timing group must use its own row');
  assert.ok(timingGeometry.row.top>=timingGeometry.menu.top&&timingGeometry.row.bottom<=timingGeometry.menu.bottom,JSON.stringify(timingGeometry));
  assert.ok(timingGeometry.labelScrollWidth<=timingGeometry.labelWidth+1&&timingGeometry.labelScrollHeight<=timingGeometry.labelHeight+1,JSON.stringify(timingGeometry));
  assert.notEqual(timingGeometry.textOverflow,'ellipsis');assert.equal(timingGeometry.contain,'none');
  assert.ok(timingGeometry.controls.left>=timingGeometry.row.left&&timingGeometry.controls.right<=timingGeometry.row.right,JSON.stringify(timingGeometry));
  assert.ok(timingGeometry.label.right<=timingGeometry.controls.left+1||timingGeometry.label.bottom<=timingGeometry.controls.top+1,'Timing label and controls must not overlap');
  assert.match(timingGeometry.offset,/0\.0\s*s/);
  await page.screenshot({path:path.join(artifacts,'portrait-menu-timing.png')});
  const hintGeometry=await page.evaluate(()=>{
    const menu=document.querySelector('#fluent-read-video-subtitle-menu');
    menu.scrollTop=menu.scrollHeight;
    const bounds=menu.getBoundingClientRect();
    const hint=menu.querySelector('[data-native-fullscreen-hint]').getBoundingClientRect();
    return {menuTop:bounds.top,menuBottom:bounds.bottom,hintTop:hint.top,hintBottom:hint.bottom,scrollTop:menu.scrollTop};
  });
  assert.ok(hintGeometry.hintTop>=hintGeometry.menuTop&&hintGeometry.hintBottom<=hintGeometry.menuBottom,JSON.stringify(hintGeometry));
  report.nativeHintGeometry=hintGeometry;
  await capture('portrait-menu-hint'); await page.keyboard.press('Escape');
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
  const side=report.safeAreaEmulation.supported?44:12;
  assert.ok(safe.panel.left>=side-1&&safe.panel.right<=safe.viewport.width-side+1,JSON.stringify(safe));
  if(report.safeAreaEmulation.supported) assert.ok(safe.panel.bottom<=safe.viewport.height-24+1,JSON.stringify(safe));
  await isolated(`delete document.fullscreenElement`);
  await page.evaluate(()=>{document.querySelector('#movie_player').removeAttribute('style');document.dispatchEvent(new Event('fullscreenchange'));});
  if(report.safeAreaEmulation.supported) await cdp.send('Emulation.setSafeAreaInsets',{insets:{top:0,left:0,bottom:0,right:0}});
  await page.evaluate(()=>{
    const video=document.querySelector('video'); const track=video.addTextTrack('captions','Site captions','en');track.addCue(new VTTCue(0,30,'Site caption'));track.mode='showing';window.__siteTrack=track;
  });
  await isolated(`document.querySelector('video').webkitEnterFullscreen()`);
  await page.waitForFunction(()=>document.querySelector('track[data-fluent-read-native-subtitles]')?.track.mode==='hidden');
  assert.equal(await page.evaluate(()=>window.__siteTrack.mode),'showing','Entering the native interface must preserve the site selection');
  await capture('native-interface-enter');
  report.nativeSystemSelectionShim={scope:'Explicit standard TextTrack.mode writes emulate system-menu selections on Chromium; not native AVKit selection or rendering',beginPreservedSiteSelection:true};
  // Chromium has no AVKit menu. Explicitly emulate its mutually exclusive
  // selection rather than requiring the production bridge to force showing.
  await page.evaluate(()=>{
    const node=document.querySelector('track[data-fluent-read-native-subtitles]');
    window.__nativeBridgeNode=node;
    window.__siteTrack.mode='disabled';node.track.mode='showing';
  });
  const countBeforeOff=await page.evaluate(()=>document.querySelector('track[data-fluent-read-native-subtitles]').track.cues.length);
  await page.evaluate(()=>{document.querySelector('track[data-fluent-read-native-subtitles]').track.mode='disabled';});
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(()=>document.querySelector('track[data-fluent-read-native-subtitles]').track.mode),'disabled');
  assert.equal(await page.evaluate(()=>document.querySelector('track[data-fluent-read-native-subtitles]')===window.__nativeBridgeNode),true,'Off must preserve the owned track identity');
  await page.evaluate(()=>{document.querySelector('track[data-fluent-read-native-subtitles]').track.mode='showing';});
  await page.waitForFunction(count=>document.querySelector('track[data-fluent-read-native-subtitles]')?.track.cues?.length===count,countBeforeOff);
  await isolated(`document.querySelector('video').webkitExitFullscreen()`);
  await page.waitForFunction(()=>document.querySelector('track[data-fluent-read-native-subtitles]')?.track.mode==='hidden');
  assert.equal(await page.evaluate(()=>window.__siteTrack.mode),'showing');
  // Selecting Off and then leaving/re-entering must not restore the old site
  // track or automatically select FluentRead on the following entry.
  await isolated(`document.querySelector('video').webkitEnterFullscreen()`);
  await page.evaluate(()=>{window.__siteTrack.mode='disabled';window.__nativeBridgeNode.track.mode='showing';});
  await page.waitForTimeout(50);
  await page.evaluate(()=>{window.__nativeBridgeNode.track.mode='disabled';});
  await page.waitForTimeout(50);
  await isolated(`document.querySelector('video').webkitExitFullscreen()`);
  assert.equal(await page.evaluate(()=>window.__siteTrack.mode),'disabled','Leaving after Off must not restore an earlier site selection');
  await isolated(`document.querySelector('video').webkitEnterFullscreen()`);
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(()=>window.__nativeBridgeNode.track.mode),'hidden');
  assert.equal(await page.evaluate(()=>window.__siteTrack.mode),'disabled');
  report.nativeSystemSelectionShim.offPreservedAcrossReentry=true;
  await isolated(`document.querySelector('video').webkitExitFullscreen()`);
  await page.evaluate(()=>{
    window.__siteTrack.mode='showing';
    const other=document.querySelector('video').addTextTrack('captions','Other site captions','en');
    other.addCue(new VTTCue(0,30,'Other site caption'));other.mode='disabled';window.__otherSiteTrack=other;
  });
  await isolated(`document.querySelector('video').webkitEnterFullscreen()`);
  await page.evaluate(()=>{window.__siteTrack.mode='disabled';window.__nativeBridgeNode.track.mode='showing';});
  await page.waitForTimeout(50);
  await page.evaluate(()=>{window.__nativeBridgeNode.track.mode='disabled';window.__otherSiteTrack.mode='showing';});
  await isolated(`document.querySelector('video').webkitExitFullscreen()`);
  assert.equal(await page.evaluate(()=>window.__otherSiteTrack.mode),'showing','Leaving after another site selection must preserve that selection');
  assert.equal(await page.evaluate(()=>window.__siteTrack.mode),'disabled');
  report.nativeSystemSelectionShim.otherSiteSelectionPreserved=true;
  await page.evaluate(()=>{window.__otherSiteTrack.mode='disabled';window.__siteTrack.mode='showing';});
  await configure({videoSubtitleVisible:false});await page.waitForFunction(()=>!document.querySelector('track[data-fluent-read-native-subtitles]'));
  assert.equal(await page.evaluate(()=>window.__siteTrack.mode),'showing');
  await configure({videoSubtitleVisible:true});await ready();
  await page.evaluate(()=>{const old=document.querySelector('video'); const next=old.cloneNode(false);old.replaceWith(next);next.load();});await ready();await capture('video-replaced');
  await page.reload({waitUntil:'domcontentloaded'});await activate();await installNativeShim();await ready();await capture('refresh-recovered');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await ready();
  await configure({on:false});await page.waitForFunction(()=>!document.querySelector('#fluent-read-video-subtitle-layer')&&!document.querySelector('track[data-fluent-read-native-subtitles]'));
  await capture('disabled-cleanup');
  assert.equal(report.errors.length,0,report.errors.join('\n'));
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
  if(focusMonitor){report.focusEvents=[...focusMonitor.events];try{await focusMonitor.stop();}catch(error){report.focusObserverCleanupError=String(error);process.exitCode=1;}}
  if(profileDir&&(report.browserCloseReceipt==='shared-guard-fulfilled'||!launchAttempted)){
    fs.rmSync(profileDir,{recursive:true,force:true,maxRetries:5,retryDelay:200});report.profileRemoved=true;
  }else if(profileDir)report.retainedProfile=profileDir;
  save();
  console.log(JSON.stringify({ok:!process.exitCode,artifacts,cases:report.cases.length,errors:report.errors},null,2));
});

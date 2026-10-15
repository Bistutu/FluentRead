#!/usr/bin/env node
// Deterministic spoken-audio and HLS fixture against the production extension.
const {guardBrowserClose} = require('./testing/owned-browser-close.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createRequire} = require('node:module');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-x-sync-proof'));
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const runtime = arg('playwright-root');
const helperPath = arg('focus-safe-helper', path.join(__dirname, 'testing/focus-safe-browser.cjs'));
if (!runtime || !helperPath) throw new Error('Explicit Playwright runtime and focus-safe helper are required');
const {chromium} = createRequire(path.join(runtime, 'x-proof.cjs'))('playwright');
const helper = require(path.resolve(helperPath));
const browserPath = arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
const extensionInstall = arg('extension-install', 'flags');
const model = arg('model', 'tiny');
const mediaMode = arg('media-source', 'hls');
const displayMode = arg('display-mode', 'original-only');
const lifecycle = arg('lifecycle', 'false') === 'true';
const speechLanguage = arg('speech-language', 'en');
const fixtureUrl = lifecycle || arg('profile', 'false') === 'true' ? 'https://x.com/cerebras' : 'https://x.com/cerebras/status/2089870131291943228';
const nativeTrack = arg('native-track','false') === 'true';
const startPlaying = arg('start-playing', 'false') === 'true';
const earlyHls = arg('early-hls','false') === 'true';
const hostOverlay = arg('host-overlay','false') === 'true';
const backgroundMusic = arg('background-music', 'false') === 'true';
const prepareAfterLoad = arg('prepare-after-load', 'false') === 'true';
const trustedStorageRequired = arg('trusted-storage', 'false') === 'true';
fs.mkdirSync(artifacts, {recursive: true});
const media = path.join(artifacts, 'media');
fs.mkdirSync(media, {recursive: true});
function command(program, args) { const r = spawnSync(program, args, {encoding: 'utf8'}); if(r.status !== 0) throw new Error(`${program}: ${r.stderr}`); }
const lines = [
  'At sunrise, the research team opened the lab and checked the new system.',
  'A few moments later, the first results appeared clearly on the screen.',
  'The speaker reviewed the numbers and explained why the change mattered.',
];
if(arg('long', 'false') === 'true') lines.push(
  'Outside the building, a small crowd waited for the afternoon announcement.',
  'The project manager answered questions and described the next steps.',
  'After a short break, everyone returned to the meeting room.',
  'The final experiment confirmed that the new design worked as expected.',
  'Several engineers compared the results with their earlier measurements.',
  'Before leaving, the team saved its notes and closed the laboratory.',
);
if (speechLanguage === 'ko') lines.splice(0, lines.length, '오늘은 좋은 날입니다.', '커피를 마시고 친구를 만났습니다.', '내일은 함께 공원에 가려고 합니다.');
const speech = lines.join(' [[slnc 1200]] ');
command('/usr/bin/say', ['-v',speechLanguage === 'ko' ? 'Yuna' : 'Samantha','-r','175','-o',path.join(media,'speech.aiff'),speech]);
const durationProbe=spawnSync('/opt/homebrew/bin/ffprobe',['-v','quiet','-show_entries','format=duration','-of','json',path.join(media,'speech.aiff')],{encoding:'utf8'});
assert.equal(durationProbe.status,0,durationProbe.stderr);
const speechDuration=Number(JSON.parse(durationProbe.stdout).format.duration);
const mediaAudio = backgroundMusic ? path.join(media, 'speech-background-music.wav') : path.join(media, 'speech.aiff');
let backgroundMusicMetric = null;
if (backgroundMusic) {
  // Keep two deterministic, low-level tones under the clean speech. The tones
  // stay present across spoken pauses so pause-based chunking is exercised
  // without changing the independent speech boundary groundtruth.
  command('/opt/homebrew/bin/ffmpeg', [
    '-y', '-i', path.join(media, 'speech.aiff'),
    '-f', 'lavfi', '-t', String(speechDuration), '-i', 'sine=frequency=173:sample_rate=48000',
    '-f', 'lavfi', '-t', String(speechDuration), '-i', 'sine=frequency=271:sample_rate=48000',
    '-filter_complex', '[1:a]volume=0.08[tone1];[2:a]volume=0.048[tone2];[tone1][tone2]amix=inputs=2:duration=longest:normalize=0[tone];[0:a][tone]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]',
    '-map', '[mix]', '-t', String(speechDuration), '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', mediaAudio,
  ]);
  const floorScan = spawnSync('/opt/homebrew/bin/ffmpeg', [
    '-v', 'error', '-i', mediaAudio, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-',
  ], {encoding: null});
  assert.equal(floorScan.status, 0, floorScan.stderr);
  const waveform = floorScan.stdout;
  const sampleCount = Math.floor(waveform.length / 4);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) samples[index] = waveform.readFloatLE(index * 4);
  const frameSize = 320;
  const frameRms = [];
  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const end = Math.min(samples.length, offset + frameSize);
    let sumSquares = 0;
    for (let index = offset; index < end; index += 1) sumSquares += samples[index] ** 2;
    frameRms.push(Math.sqrt(sumSquares / Math.max(1, end - offset)));
  }
  const minFrameRms = Math.min(...frameRms);
  backgroundMusicMetric = {
    thresholdAmplitude: 0.0025,
    sampleRate: 16000,
    frameMs: 20,
    frameCount: frameRms.length,
    minFrameRms,
    maxFrameRms: Math.max(...frameRms),
  };
  assert.ok(minFrameRms > backgroundMusicMetric.thresholdAmplitude, `background music fell below the 0.0025 RMS waveform floor: ${JSON.stringify(backgroundMusicMetric)}`);
}
command('/opt/homebrew/bin/ffmpeg',['-y','-i',mediaAudio,'-c:a','aac','-b:a','64k','-ar','48000','-f','hls','-hls_time','4','-hls_playlist_type','vod','-hls_segment_type','fmp4','-hls_segment_filename',path.join(media,'a%02d.m4s'),path.join(media,'audio.m3u8')]);
command('/opt/homebrew/bin/ffmpeg',['-y','-f','lavfi','-i','color=c=0x10283f:s=960x540:r=24','-i',mediaAudio,'-t',String(speechDuration),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-b:a','64k','-movflags','frag_keyframe+empty_moov+default_base_moof',path.join(media,'video.mp4')]);
// Use a seekable progressive MP4 for direct URLs; the fragmented file above is for MSE.
command('/opt/homebrew/bin/ffmpeg',['-y','-i',path.join(media,'video.mp4'),'-c','copy','-movflags','+faststart',path.join(media,'video-direct.mp4')]);
const silenceScan = spawnSync('/opt/homebrew/bin/ffmpeg',['-i',path.join(media,'speech.aiff'),'-af','silencedetect=n=-40dB:d=0.7','-f','null','-'],{encoding:'utf8'});
assert.equal(silenceScan.status,0,silenceScan.stderr);
const silenceStarts=[...silenceScan.stderr.matchAll(/silence_start: ([\d.]+)/g)].map(match=>Number(match[1]));
const silenceEnds=[...silenceScan.stderr.matchAll(/silence_end: ([\d.]+)/g)].map(match=>Number(match[1]));
const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=300000,AUDIO="audio"\nvideo.m3u8\n';
const base = 'https://video.twimg.com/ext_tw_video/424242/pu/';
const videoMarkup='<video style="width:100%;height:100%" controls></video>';
// X 的入口只挂到真实控制栏上；所有模式都提供与 X 相同结构的控制栏。
const lifecycleControls = `<div class="fixture-controls" style="position:absolute;bottom:0;left:0;right:0;display:flex;gap:12px;align-items:center;height:44px;background:#111"><button aria-label="Play" onclick="this.closest('[data-testid=videoPlayer]').querySelector('video').play()">Play</button><button aria-label="Settings">Settings</button><button id="fixture-fullscreen" onclick="this.closest('[data-testid=videoPlayer]').requestFullscreen()">Fullscreen</button></div>`;
const playerMarkup=hostOverlay?`<div style="position:relative;width:960px;height:540px"><div style="position:relative;isolation:isolate;z-index:0;width:100%;height:100%;background:#10283f">${videoMarkup}</div><a id="fixture-media-link" aria-label="View media" href="/cerebras/status/2089870131291943228/video/1" style="position:absolute;inset:0;z-index:10" onclick="event.preventDefault();window.proofHostLinkClicks=(window.proofHostLinkClicks||0)+1"></a></div>`:`<div data-testid="videoPlayer" style="position:relative;width:960px;height:540px;background:#10283f">${videoMarkup}${lifecycleControls}</div>`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-x-sync-profile-'));
let launchAttempted = false;
let browser, control, page, isolatedProbeSession;
let primaryError;
const report = {lifecycle,speechLanguage,fixtureUrl,mediaMode,model,lines,displayMode,startPlaying,earlyHls,hostOverlay,backgroundMusic,backgroundMusicMetric,prepareAfterLoad,trustedStorageRequired,errors:[],console:[],requests:[],samples:[],diagnostics:[],menuSnapshots:[]};

async function captureVideoMenuSnapshot(page, artifacts, report, phase) {
 const snapshot = await page.evaluate((phaseName) => {
   const menu = document.querySelector('#fluent-read-video-subtitle-menu');
   const rect = menu?.getBoundingClientRect();
   const buttons = [...(menu?.querySelectorAll('[data-action="download-subtitles"], [data-action="download-translated-subtitles"]') || [])]
     .map(element => { const buttonRect = element.getBoundingClientRect(); return {top: buttonRect.top, left: buttonRect.left, right: buttonRect.right, width: buttonRect.width}; });
   const aiGroup = menu?.querySelector('.fluent-read-video-menu-ai-group');
   const aiGroupStyle = aiGroup ? getComputedStyle(aiGroup) : null;
   const aiGroupRect = aiGroup?.getBoundingClientRect();
   const modeGroupRect = menu?.querySelector('.fluent-read-video-menu-mode-group')?.getBoundingClientRect();
   const contentOverflow = Boolean(menu && menu.scrollHeight > menu.clientHeight + 1);
   return {
     phase: phaseName,
     visible: Boolean(menu && !menu.hidden && rect?.width && rect.height),
     rect: rect ? {top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height} : null,
     contentOverflow,
     scrollHeight: menu?.scrollHeight || 0,
     clientHeight: menu?.clientHeight || 0,
     downloadButtons: buttons,
     downloadButtonsSameRow: buttons.length === 2 && Math.max(...buttons.map(button => button.top)) - Math.min(...buttons.map(button => button.top)) <= 2,
     aiGroup: aiGroupStyle && aiGroupRect ? {
       marginTop: aiGroupStyle.marginTop,
       paddingTop: aiGroupStyle.paddingTop,
       borderTopWidth: aiGroupStyle.borderTopWidth,
       gap: modeGroupRect ? aiGroupRect.top - modeGroupRect.bottom : null,
     } : null,
     text: menu?.textContent?.trim() || '',
   };
 }, phase);
 assert.equal(snapshot.visible, true, `${phase} video menu is not visible`);
 assert.equal(snapshot.contentOverflow, false, `${phase} video menu overflows its content box`);
 assert.equal(snapshot.downloadButtonsSameRow, true, `${phase} download buttons are not on one row`);
 // 紧凑菜单按播放器高度在单列与单行布局之间切换，各组不再靠分隔线和内边距分隔；这里只要求 AI 组存在，间距记录在报告里。
 assert.ok(snapshot.aiGroup, `${phase} AI menu group is missing`);
 report.menuSnapshots.push(snapshot);
 await page.screenshot({path: path.join(artifacts, `video-menu-${phase}.png`)});
}

// 字幕就绪后“关闭 AI 字幕”收在“字幕选项”里，观看首页不再重复这个入口。
async function disableReadyAiSubtitles(target) {
  const toggle = target.locator('[data-action="toggle-ai-subtitle"]');
  assert.equal(await toggle.getAttribute('aria-checked'), 'true', 'AI subtitles are ready before they are turned off');
  assert.equal(await toggle.isVisible(), false, 'the ready watch view keeps the AI switch inside subtitle options');
  await target.locator('[data-action="open-subtitle-tools"]').click();
  await toggle.click();
}
async function readLocalVideoModelState(control, model) {
 const state = await control.evaluate(() => chrome.runtime.sendMessage({type: 'fluentReadGetLocalVideoModelState'}));
 assert.equal(state?.success, true, `background model state query failed: ${JSON.stringify(state)}`);
 assert.equal(state?.available?.[model], true, `background model state is not ready: ${JSON.stringify(state)}`);
 return state;
}
async function main() {
 launchAttempted = true;
 browser = await helper.launchFocusSafePersistentContext({chromium,profileDir:profile,browserPath,headless:false,background:true,displayTarget:'secondary',browserArgs:[...(extensionInstall === 'cdp' ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`]),'--autoplay-policy=no-user-gesture-required','--no-first-run','--no-default-browser-check'],viewport:{width:1280,height:900}});
 guardBrowserClose(browser, profile);
 const context = browser.context;
 report.browserVersion = context.browser().version();
 report.browserPath = browserPath;
 let loadedExtensionId;
 if (extensionInstall === 'cdp') {
   const extensionSession = await context.browser().newBrowserCDPSession();
   let installError;
   try {loadedExtensionId = (await extensionSession.send('Extensions.loadUnpacked', {path: extensionDir})).id;}
   catch (error) {installError = error; throw error;}
   finally {
     try {await extensionSession.detach();} catch (error) {
       if (!installError) throw error;
       process.stderr.write(`CDP detach failed: ${error.stack || error}\n`);
     }
   }
 }
 report.extensionInstall = extensionInstall;
 context.on('page', p => {p.on('pageerror', e => report.errors.push(e.message)); p.on('console',m => { if(m.type()==='error'||m.type()==='warning'||m.text().includes('[FluentRead] X audio fast decode unavailable')) report.console.push(m.text()); });});
 await context.route('https://pbs.twimg.com/ext_tw_video_thumb/424242/pu/img/fixture.jpg', route => route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#10283f"/></svg>'}));
 await context.route('https://video.twimg.com/**', async route => {
   const name = new URL(route.request().url()).pathname.split('/').at(-1);
   report.requests.push({name,at:Date.now()});
   let body = name==='master.m3u8' ? master : fs.readFileSync(path.join(media,name));
   const headers={'access-control-allow-origin':'*','accept-ranges':'bytes'};
   let status=200;
   const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
   if(range&&Buffer.isBuffer(body)){
     const total=body.length,start=Number(range[1]),end=Math.min(total-1,range[2]?Number(range[2]):total-1);
     if(start> end){status=416;headers['content-range']=`bytes */${total}`;body=Buffer.alloc(0);}
     else{status=206;headers['content-range']=`bytes ${start}-${end}/${total}`;body=body.subarray(start,end+1);}
   }
   await route.fulfill({status,headers,contentType:name.endsWith('m3u8')?'application/vnd.apple.mpegurl':'video/mp4',body});
 });
 await context.route('https://x.com/fluentread-fixture-ready.js',async route=>{await new Promise(resolve=>setTimeout(resolve,800));await route.fulfill({status:200,contentType:'text/javascript',body:''});});
 await context.route(fixtureUrl, route => route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html><head><style>[data-testid=videoPlayer]:not(:hover):not(:focus-within) .fixture-controls {opacity:0;pointer-events:none}</style><title>X subtitle synchronization fixture</title>${earlyHls?`<script>fetch('${base}master.m3u8')</script><script src="/fluentread-fixture-ready.js"></script>`:''}</head><body style="margin:24px;background:#f3f5f9"><h1>X subtitle synchronization fixture</h1><article>${playerMarkup}</article></body></html>`}));
 const isFeatureWorker = candidate => loadedExtensionId ? new URL(candidate.url()).host === loadedExtensionId : candidate.url().endsWith('/background.js');
 const worker = context.serviceWorkers().find(isFeatureWorker) || await context.waitForEvent('serviceworker',{predicate:isFeatureWorker,timeout:30000});
 const id = new URL(worker.url()).host;
 // Chrome may also own component-extension workers; activate tabs through FluentRead only.
 const activatePage = target => helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, target);
 report.extensionId = id;
 await worker.evaluate(() => {
   const originalFetch = globalThis.fetch;
   globalThis.videoProofTranslations = [];
   globalThis.videoProofAsrCalls = 0;
   chrome.runtime.onMessage.addListener(message => { if(message?.type === 'fluentReadTranscribeLocalVideoAudio') globalThis.videoProofAsrCalls += 1; });
   globalThis.fetch = async (input, init) => {
     const url = String(input?.url || input);
     if (!url.startsWith('https://edge.microsoft.com/translate/translatetext')) return originalFetch(input, init);
     const source = JSON.parse(init.body)[0];
     const entry = {source,started:Date.now()};globalThis.videoProofTranslations.push(entry);
     await new Promise((resolve,reject) => {
       const timer=setTimeout(resolve,1200);
       init.signal?.addEventListener('abort',()=>{clearTimeout(timer);entry.cancelled=true;reject(new DOMException('aborted','AbortError'));},{once:true});
     });
     entry.finished=Date.now();
     return new Response(JSON.stringify([{translations:[{text:'译文：'+source}]}]),{status:200,headers:{'content-type':'application/json'}});
   };
 });
 control = await helper.newPageWithoutForeground(context);
 await control.goto(`chrome-extension://${id}/popup.html`);
 await control.waitForTimeout(500);
 const configResult = await control.evaluate(async ({model,displayMode}) => {
   const r = await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
   if(!r?.success) throw new Error('configStorageRead failed');
   const current = typeof r.value==='string'?JSON.parse(r.value):r.value||{};
   return chrome.runtime.sendMessage({type:'persistConfig',clientId:'x-sync-browser-proof',sequence:1,config:{...current,on:true,from:'en',videoSourceLanguage:'auto',to:'zh-Hans',videoTranslationEnabled:true,videoService:'microsoft',videoServiceDefaultMigrated:true,videoLocalModel:model,videoSubtitleVisible:true,videoSubtitleDisplayMode:displayMode,useCache:false},...(Number.isSafeInteger(current.__fluentConfigRevision)?{baseRevision:current.__fluentConfigRevision}:{})});
 },{model,displayMode});
 assert.equal(configResult?.success,true,'configuration persisted through real background');
 const controlOnboarding = control.locator('[data-testid="ui-language-onboarding"]');
 if (await controlOnboarding.count()) {
   await controlOnboarding.locator('[data-testid="onboarding-language-step"]').waitFor();
   await controlOnboarding.locator('[data-language="zh-CN"]').click();
   await controlOnboarding.locator('.onboarding-confirm').click();
   await controlOnboarding.waitFor({state:'hidden',timeout:30000});
 }
 const prepareModel = async () => {
   const prepareAt = Date.now();
   const prepared = await control.evaluate(model=>chrome.runtime.sendMessage({type:'fluentReadPrepareLocalVideoModel',model}),model);
   report.prepareMs=Date.now()-prepareAt;report.prepared=prepared;
   assert.equal(prepared?.success,true,JSON.stringify(prepared));
 };
 if(!prepareAfterLoad) await prepareModel();
 page=await helper.newPageWithoutForeground(context);
 page.on('console',m=>report.console.push(`${m.type()}: ${m.text()}`));
 await page.goto(fixtureUrl);
 await activatePage(page);
 const initializeVideo = () => page.evaluate(async ({base,mode,nativeTrack,earlyHls})=>{
   const video=document.querySelector('video');
   video.poster = 'https://pbs.twimg.com/ext_tw_video_thumb/424242/pu/img/fixture.jpg';
   if(mode==='hls'){
     const mediaSource=new MediaSource();video.src=URL.createObjectURL(mediaSource);
     await new Promise(resolve=>mediaSource.addEventListener('sourceopen',resolve,{once:true}));
     const buffer=mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42C01F, mp4a.40.2"');
     const data=await (await fetch(base+'video.mp4')).arrayBuffer();
     buffer.appendBuffer(data);await new Promise(resolve=>buffer.addEventListener('updateend',resolve,{once:true}));mediaSource.endOfStream();
     // Real MAIN-world fetch bridge discovers this audio rendition.
     if(!earlyHls) await fetch(base+'master.m3u8');
   }else video.src=base+'video-direct.mp4';
   if(nativeTrack){
     const alternative=video.addTextTrack('captions','French','fr');alternative.addCue(new VTTCue(0,120,'French native fixture'));alternative.mode='disabled';window.proofAlternativeTrack=alternative;
     const track=video.addTextTrack('captions','English','en');track.addCue(new VTTCue(0,120,'Native source fixture'));track.mode='showing';window.proofTrack=track;
   }
   window.proofSamples=[];window.proofDiagnostics=[];window.proofVideoEvents=[];
   for(const name of ['play','pause','ended','waiting','stalled','error','seeking','seeked','emptied']) video.addEventListener(name,()=>window.proofVideoEvents.push({name,time:video.currentTime,paused:video.paused,visibility:document.visibilityState,at:performance.now()}));
   document.addEventListener('visibilitychange',()=>window.proofVideoEvents.push({name:'visibility',time:video.currentTime,paused:video.paused,visibility:document.visibilityState,at:performance.now()}));
   const read=()=>{const panel=document.getElementById('fluent-read-video-subtitle-original');window.proofSamples.push({at:performance.now(),time:video.currentTime,paused:video.paused,text:panel?.textContent||'',translation:document.getElementById('fluent-read-video-subtitle')?.textContent||'',source:document.getElementById('fluent-read-video-ai-caption-container')?.dataset.fluentReadCaptionSource||''});};
   window.proofTimer=setInterval(read,50);
   window.addEventListener('fluent-read-video-ai-diagnostic',e=>window.proofDiagnostics.push(e.detail));
 },{base,mode:mediaMode,nativeTrack,earlyHls});
 await initializeVideo();
 await page.locator(hostOverlay ? '#fixture-media-link' : 'video').hover();
 await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
 await page.waitForSelector('#fluent-read-video-subtitle-button',{timeout:15000});
 await page.locator('#fluent-read-video-subtitle-button').click();
 await captureVideoMenuSnapshot(page, artifacts, report, 'before');
 if(prepareAfterLoad) await prepareModel();
 report.storageAccessLevel = await control.evaluate(async () => {
   if (typeof chrome.storage?.local?.setAccessLevel !== 'function') return {apiAvailable: false};
   await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
   return {apiAvailable: true, accessLevel: 'TRUSTED_CONTEXTS'};
 });
 isolatedProbeSession = await context.newCDPSession(page);
 const executionContexts = [];
 isolatedProbeSession.on('Runtime.executionContextCreated', event => executionContexts.push(event.context));
 await isolatedProbeSession.send('Runtime.enable');
 const isolatedCandidates = executionContexts.filter(contextInfo => contextInfo.auxData?.isDefault === false
   && (contextInfo.origin === `chrome-extension://${id}` || String(contextInfo.name || '').includes(id)));
 let untrustedStorageProbe = {apiAvailable: false, verified: false, error: 'No extension isolated execution context found'};
 for (const executionContext of isolatedCandidates) {
   try {
     const result = await isolatedProbeSession.send('Runtime.evaluate', {
       contextId: executionContext.id,
       awaitPromise: true,
       returnByValue: true,
       expression: "(async()=>{try{const value=await globalThis.chrome?.storage?.local?.get('fluentReadVideoLocalTranscriptionModels');return {ok:true,value:value?.fluentReadVideoLocalTranscriptionModels??null}}catch(error){return {ok:false,error:error instanceof Error?error.message:String(error)}}})()",
     });
     const value = result.result?.value;
     if (value?.ok === false) {
       untrustedStorageProbe = {apiAvailable: true, verified: true, contextName: executionContext.name || '', result: value};
       break;
     }
     if (value?.ok === true) {
       untrustedStorageProbe = {apiAvailable: true, verified: false, contextName: executionContext.name || '', result: value, error: 'Storage read unexpectedly succeeded in isolated context'};
       break;
     }
   } catch (error) {
     untrustedStorageProbe = {apiAvailable: true, verified: false, contextName: executionContext.name || '', error: error instanceof Error ? error.message : String(error)};
   }
 }
 report.untrustedStorageProbe = untrustedStorageProbe;
 if(trustedStorageRequired) {
   assert.equal(report.storageAccessLevel.apiAvailable, true, 'Use --browser-path with current Chrome for Testing to verify trusted storage');
   assert.equal(report.untrustedStorageProbe.verified, true, `isolated content storage rejection was not verified: ${JSON.stringify(report.untrustedStorageProbe)}`);
 }
 if(arg('model-query-failure','false') === 'true') {
   const probeContext = isolatedCandidates.find(candidate => candidate.name === untrustedStorageProbe.contextName);
   assert.ok(probeContext, 'verified isolated context is available for a single model-query fault');
   const injection = await isolatedProbeSession.send('Runtime.evaluate', {
     contextId: probeContext.id, returnByValue: true,
     expression: `(() => {
       const runtime = chrome.runtime;
       const send = runtime.sendMessage;
       runtime.sendMessage = function(...args) {
         if (args[0]?.type !== 'fluentReadGetLocalVideoModelState') return send.apply(runtime, args);
         runtime.sendMessage = send;
         const response = {success:false,error:'fixture model state temporarily unavailable'};
         const callback = args[args.length - 1];
         if (typeof callback === 'function') { queueMicrotask(() => callback(response)); return; }
         return Promise.resolve(response);
       };
       return true;
     })()`,
   });
   assert.equal(injection.result?.value, true, 'single model-state fault injected; ASR is unchanged');
   const optionsBeforeFailure = context.pages().filter(candidate => candidate.url().includes('/options.html')).length;
   await page.locator('[data-action="toggle-ai-subtitle"]').click();
   await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"]')?.title === '无法读取模型状态，请重试', null, {timeout:10000});
   assert.equal(await page.locator('[data-action="toggle-ai-subtitle"]').isEnabled(), true, 'query failure leaves a retryable button');
   const optionsAfterFailure = context.pages().filter(candidate => candidate.url().includes('/options.html')).length;
   assert.equal(optionsAfterFailure, optionsBeforeFailure, 'query failure must never redirect to model download settings');
   report.modelQueryFailure = {injected: 'one background status failure; no ASR mock', optionsBeforeFailure, optionsAfterFailure, retryEnabled:true};
   await captureVideoMenuSnapshot(page, artifacts, report, 'query-failure');
 }
 await isolatedProbeSession.detach();
 isolatedProbeSession = null;
 report.modelState = await readLocalVideoModelState(control, model);
 const before=await page.evaluate(()=>{const v=document.querySelector('video');v.currentTime=2;return {time:v.currentTime,paused:v.paused,rate:v.playbackRate,volume:v.volume,muted:v.muted};});
 await page.waitForTimeout(150);
 if(startPlaying) await page.evaluate(()=>document.querySelector('video').play());
 const began=Date.now();
 const optionsPagesBeforeReady = context.pages().filter(candidate => candidate.url().includes('/options.html')).length;
 // 已有原生字幕时，“生成 AI 字幕”同样收在“字幕选项”里。
 if(nativeTrack){
   assert.equal(await page.locator('[data-action="toggle-ai-subtitle"]').isVisible(),false,'native captions keep AI generation inside subtitle options');
   await page.locator('[data-action="open-subtitle-tools"]').click();
 }
 await page.locator('[data-action="toggle-ai-subtitle"]').click();
 await page.waitForTimeout(250);
 await captureVideoMenuSnapshot(page, artifacts, report, 'generating');
 report.inlineProgress = await page.locator('#fluent-read-video-subtitle-button').getAttribute('data-fluent-read-video-progress');
 assert.match(report.inlineProgress || '', /^\d+%$/, 'generation percentage is visible beside the icon without opening the menu');
 report.progressLayout = await page.locator('#fluent-read-video-subtitle-button').evaluate(button => {
   const bounds = button.getBoundingClientRect();
   const icon = button.querySelector('img').getBoundingClientRect();
   return {width:bounds.width,iconInside:icon.left >= bounds.left - .5 && icon.right <= bounds.right + .5};
 });
 assert.equal(report.progressLayout.iconInside,true,'the percentage must not push the icon outside the button');
 if(arg('background-generation','false')==='true'){
   await control.evaluate(async()=>{
     const controlTab=await chrome.tabs.getCurrent();
     const [videoTab]=await chrome.tabs.query({url:'https://x.com/cerebras/status/2089870131291943228'});
     if(controlTab.windowId!==videoTab.windowId) await chrome.tabs.move(controlTab.id,{windowId:videoTab.windowId,index:-1});
   });
   await activatePage(control);
   report.generatedWhileHidden=await page.evaluate(()=>document.visibilityState==='hidden');
   report.generatedInInactiveTab=await control.evaluate(async()=>!(await chrome.tabs.query({url:'https://x.com/cerebras/status/2089870131291943228'}))[0].active);
   assert.equal(report.generatedInInactiveTab,true);
 }
 await page.waitForFunction(()=>{const action=document.querySelector('[data-action="toggle-ai-subtitle"]');const text=action?.querySelector('[data-state]')?.textContent||'';if(action?.dataset.error==='true')throw new Error(action.title);return text.includes('已就绪');},{},{timeout:120000});
 report.generationMs=Date.now()-began;
 report.optionsPagesBeforeReady = optionsPagesBeforeReady;
 report.optionsPagesAfterReady = context.pages().filter(candidate => candidate.url().includes('/options.html')).length;
 assert.equal(report.optionsPagesAfterReady, optionsPagesBeforeReady, 'AI readiness unexpectedly opened a new options page');
 await captureVideoMenuSnapshot(page, artifacts, report, 'ready');
 await activatePage(page);
 if(nativeTrack) assert.equal(await page.evaluate(()=>window.proofTrack.mode),'hidden','native rendering is hidden during AI takeover');
 report.before=before;report.after=await page.evaluate(()=>{const v=document.querySelector('video');return {time:v.currentTime,paused:v.paused,rate:v.playbackRate,volume:v.volume,muted:v.muted};});
 if(startPlaying){assert.equal(report.after.paused,false);assert.ok(report.after.time>before.time);assert.equal(report.after.rate,before.rate);assert.equal(report.after.volume,before.volume);assert.equal(report.after.muted,before.muted);}
 else assert.deepEqual(report.after,before,'generation preserves user playback state');
 await page.screenshot({path:path.join(artifacts,'ready.png')});
 // 逐字高亮默认关闭；开启后 X 上已显示的字幕立即拆成单元并按当前句时间点亮，拖动后跟随，关闭即还原。
 const readKaraoke=()=>page.evaluate(()=>{
   const lines=['fluent-read-video-subtitle-original','fluent-read-video-subtitle'].map(id=>document.getElementById(id)).filter(line=>line?.textContent);
   return lines.map(line=>{const units=[...line.querySelectorAll('.fluent-read-video-karaoke-unit')];const active=units.find(unit=>unit.getAttribute('data-fluent-read-karaoke-state')==='active');
     return {text:line.textContent,units:units.length,sung:units.filter(unit=>unit.getAttribute('data-fluent-read-karaoke-state')==='sung').length,activeIndex:active?units.indexOf(active):-1,fill:active?Number.parseFloat(active.style.getPropertyValue('--fluent-read-video-karaoke-fill')):null,time:document.querySelector('video').currentTime};});
 });
 const setKaraoke=async(enabled,sequence)=>{
   const result=await control.evaluate(async({enabled,sequence})=>{
     const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
     const current=typeof r.value==='string'?JSON.parse(r.value):r.value||{};
     return chrome.runtime.sendMessage({type:'persistConfig',clientId:'x-sync-browser-proof-karaoke',sequence,config:{...current,videoSubtitleAppearance:{...current.videoSubtitleAppearance,karaoke:enabled}}});
   },{enabled,sequence});
   assert.equal(result?.success,true,'karaoke setting persisted through real background');
 };
 const karaoke={default:await readKaraoke()};
 assert.ok(karaoke.default.length>0&&karaoke.default.every(line=>line.units===0),`word-by-word highlight must be off by default: ${JSON.stringify(karaoke.default)}`);
 await setKaraoke(true,1);
 await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-layer [data-fluent-read-karaoke-state]'),null,{timeout:10000});
 karaoke.enabled=await readKaraoke();
 await page.screenshot({path:path.join(artifacts,'karaoke.png')});
 const karaokeTime=karaoke.enabled[0].time;
 await page.evaluate(time=>{document.querySelector('video').currentTime=time;},karaokeTime+.8);
 await page.waitForFunction(previous=>{
   const line=[...document.querySelectorAll('#fluent-read-video-subtitle-original, #fluent-read-video-subtitle')].find(node=>node.textContent);
   const units=[...(line?.querySelectorAll('.fluent-read-video-karaoke-unit')||[])];
   const sung=units.filter(unit=>unit.getAttribute('data-fluent-read-karaoke-state')==='sung').length;
   const active=units.find(unit=>unit.getAttribute('data-fluent-read-karaoke-state')==='active');
   return line.textContent!==previous.text||sung>previous.sung||(active&&Number.parseFloat(active.style.getPropertyValue('--fluent-read-video-karaoke-fill'))>previous.fill);
 },karaoke.enabled[0],{timeout:10000});
 karaoke.seeked=await readKaraoke();
 await page.evaluate(time=>{document.querySelector('video').currentTime=time;},karaokeTime);
 await page.waitForFunction(time=>!document.querySelector('video').seeking&&Math.abs(document.querySelector('video').currentTime-time)<.05,karaokeTime);
 await setKaraoke(false,2);
 await page.waitForFunction(()=>!document.querySelector('#fluent-read-video-subtitle-layer .fluent-read-video-karaoke-unit'),null,{timeout:10000});
 karaoke.off=await readKaraoke();
 report.karaoke=karaoke;
 for(const [index,line] of karaoke.enabled.entries()){
   assert.equal(line.text,karaoke.default[index].text,'highlight keeps the caption text');
   assert.ok(line.units>=2&&(line.activeIndex>=0||line.sung===line.units)&&line.sung===Math.max(0,line.activeIndex<0?line.units:line.activeIndex),`highlight state is inconsistent: ${JSON.stringify(karaoke)}`);
 }
 assert.ok(karaoke.off.every((line,index)=>line.units===0&&line.text===karaoke.default[index].text),`turning the highlight off must restore plain captions: ${JSON.stringify(karaoke)}`);
 // 下载入口收在“字幕选项”里。
 if(!await page.locator('[data-action="download-subtitles"]').isVisible()) await page.locator('[data-action="open-subtitle-tools"]').click();
 const downloadPromise=page.waitForEvent('download');
 await page.locator('[data-action="download-subtitles"]').click();
 const download=await downloadPromise;
 await download.saveAs(path.join(artifacts,'original.srt'));
 report.srt=fs.readFileSync(path.join(artifacts,'original.srt'),'utf8');
 const seconds=value=>value.split(/[:,]/).map(Number).reduce((total,value,index)=>total+value*[3600,60,1,.001][index],0);
 report.exportedCues=report.srt.trim().split(/\n\s*\n/).map(block=>{const rows=block.split('\n');const [start,end]=rows[1].split(' --> ');return {start:seconds(start),end:seconds(end),text:rows.slice(2).join('\n')};});
 report.audioDuration=speechDuration;
 report.referenceSpeech=lines.map((text,index)=>({start:index===0?0:silenceEnds[index-1],end:silenceStarts[index]??speechDuration,text}));
 assert.equal(report.exportedCues.length,lines.length,'every sentence has one exported cue');
 report.alignmentErrors=report.exportedCues.map((cue,index)=>({startMs:Math.round((cue.start-report.referenceSpeech[index].start)*1000),endMs:Math.round((cue.end-report.referenceSpeech[index].end)*1000)}));
 assert.ok(report.alignmentErrors.every(error=>Math.abs(error.startMs)<=250&&Math.abs(error.endMs)<=250),'sentence bounds stay within 250 ms of independent audio silence detection');
 assert.ok(report.exportedCues.every((cue,index)=>index===0||cue.start>=report.exportedCues[index-1].end),'exported sentences do not overlap');
 if(arg('owner-handoff','false')==='true'){
   const secondPage=await helper.newPageWithoutForeground(context);
   await secondPage.goto('https://x.com/cerebras/status/2089870131291943228');
   await activatePage(secondPage);
   await secondPage.evaluate(base=>{
     const video=document.querySelector('video');
     video.src=base+'video-direct.mp4';
     video.load();
   },base);
   await secondPage.waitForFunction(()=>document.querySelector('video').readyState>=2,{},{timeout:15000});
   await secondPage.waitForSelector('#fluent-read-video-subtitle-button',{timeout:15000});
   // 夹具控件只在悬停播放器时接收点击，与首个标签页一致。
   await secondPage.locator('video').hover();
   await secondPage.locator('#fluent-read-video-subtitle-button').click();
   // 同一媒体的已完成字幕会在新标签页自动恢复，不需要再点一次生成。
   await secondPage.waitForFunction(()=>{const action=document.querySelector('[data-action="toggle-ai-subtitle"]');const text=action?.querySelector('[data-state]')?.textContent||'';if(action?.dataset.error==='true')throw new Error(action.title);return text.includes('已就绪');},{},{timeout:120000});
   const secondReady=await secondPage.evaluate(()=>({
     state:document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent||'',
     text:document.getElementById('fluent-read-video-subtitle-original')?.textContent||'',
   }));
   assert.match(secondReady.state,/已就绪/,'another tab can prepare through the real extension UI after completed subtitles');
   await disableReadyAiSubtitles(secondPage);
   await secondPage.waitForTimeout(400);
   const secondStopped=await secondPage.evaluate(()=>({
     state:document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent||'',
     text:document.getElementById('fluent-read-video-subtitle-original')?.textContent||'',
   }));
   assert.equal(secondStopped.text,'','second tab releases ownership and clears its generated subtitles');
   report.ownerHandoff={
     prepared:{success:true,transport:'second-tab-extension-ui',state:secondReady.state},
     cancelled:{success:true,transport:'second-tab-extension-ui',state:secondStopped.state},
   };
   await secondPage.close();
 }
 await page.locator('#fluent-read-video-subtitle-button').click();
 report.generationSamples=await page.evaluate(()=>window.proofSamples);
 await page.evaluate(()=>{window.proofSamples=[];const v=document.querySelector('video');v.currentTime=0;return v.play();});
 await page.waitForFunction(()=>document.querySelector('video').ended,{},{timeout:90000});
 report.samples=await page.evaluate(()=>window.proofSamples);
 report.translationRequests=await worker.evaluate(()=>globalThis.videoProofTranslations);
 if(displayMode==='bilingual'){assert.ok(report.translationRequests.length>=3);assert.ok(report.samples.some(sample=>sample.translation.includes('译文：')),'bilingual translations appear');}
 report.diagnostics=await page.evaluate(()=>window.proofDiagnostics);
 report.texts=[...new Set(report.samples.filter(s=>!s.paused&&s.text).map(s=>s.text))];
 // Whisper variants may omit terminal punctuation; every spoken word and sentence boundary remains exact.
 const spokenText=text=>text.replace(/[.!?]+$/, '').toLocaleLowerCase().replace(speechLanguage === 'ko' ? /\s+/g : /$^/g, '');
 assert.deepEqual(report.texts.map(spokenText),lines.map(spokenText),'all spoken sentences are recognized once without boundary fragments');
 report.transitions=[];
 let previousText;
 for(const sample of report.samples.filter(sample=>!sample.paused)){ if(sample.text!==previousText){report.transitions.push({time:sample.time,text:sample.text});previousText=sample.text;} }
 const checks=[];
 const seekTargets = report.referenceSpeech.flatMap((cue, index) => [
   {time: (cue.start + cue.end) / 2, text: lines[index]},
   ...(index < lines.length - 1 ? [{time: (cue.end + report.referenceSpeech[index+1].start) / 2, text: ''}] : []),
 ]);
 for(const expected of seekTargets){
   await page.evaluate(time=>{const v=document.querySelector('video');v.currentTime=time;},expected.time);
   await page.waitForFunction(time=>Math.abs(document.querySelector('video').currentTime-time)<0.1,expected.time,{timeout:5000});
   await page.waitForTimeout(200);
   const actual = await page.evaluate(()=>({time:document.querySelector('video').currentTime,text:document.getElementById('fluent-read-video-subtitle-original')?.textContent||''}));
   checks.push({...actual, expected: expected.text});
   assert.equal(spokenText(actual.text), spokenText(expected.text), 'seek uses the existing complete timeline including silent pauses');
 }
 report.seekChecks=checks;
 if (speechLanguage === 'ko') assert.ok(report.texts.every(text => /[가-힣]/u.test(text) && !/[a-z]{3}/iu.test(text)), 'Korean source stays Korean with webpage source set to English');
 await page.screenshot({path:path.join(artifacts,'seek.png')});
 await page.locator('#fluent-read-video-subtitle-button').click();
 await disableReadyAiSubtitles(page);
 await page.waitForTimeout(400);
 report.afterStop=await page.evaluate(()=>({text:document.getElementById('fluent-read-video-subtitle-original')?.textContent||'',videos:document.querySelectorAll('video').length}));
 if(nativeTrack){
   assert.equal(report.afterStop.text,'Native source fixture');
   await page.locator('#fluent-read-video-subtitle-menu [data-mode="off"]').click();
   await page.waitForFunction(()=>window.proofTrack.mode==='showing');
   report.nativeTrackRestored=await page.evaluate(()=>window.proofTrack.mode);
   assert.equal(await page.evaluate(()=>window.proofAlternativeTrack.mode),'disabled','the unselected language remains disabled after restoration');
 }else assert.equal(report.afterStop.text,'');
 assert.equal(report.afterStop.videos,1);
 if(hostOverlay){
   assert.equal(await page.evaluate(()=>window.proofHostLinkClicks||0),0,'extension controls receive clicks above the host media link');
   await page.locator('#fixture-media-link').click({position:{x:100,y:100}});
   report.hostLinkClicks=await page.evaluate(()=>window.proofHostLinkClicks);
   assert.equal(report.hostLinkClicks,1,'ordinary media link clicks still reach the host');
 }
 if (lifecycle) {
   const asrBefore = await worker.evaluate(() => globalThis.videoProofAsrCalls);
   assert.ok(asrBefore > 0, 'initial run uses real Whisper');
   await page.locator('[data-action="toggle-ai-subtitle"]').click();
   await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent.includes('已就绪'));
   assert.equal(await worker.evaluate(() => globalThis.videoProofAsrCalls), asrBefore, 'reclick restores cached ASR');
   await page.locator('#fluent-read-video-subtitle-button').click();
   await page.evaluate(async () => {
     const previous = document.querySelector('video');
     const parent = previous.parentElement;
     const next = previous.cloneNode(false);
     next.removeAttribute('src');
     previous.remove();
     clearInterval(window.proofTimer);
     await new Promise(resolve => setTimeout(resolve, 200));
     parent.prepend(next);
   });
   await initializeVideo();
   await page.locator('video').hover();
   await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent.includes('已就绪'));
   assert.equal(await worker.evaluate(() => globalThis.videoProofAsrCalls), asrBefore, 'same-media DOM replacement preserves completed recognition');
   assert.equal(await page.locator('#fluent-read-video-subtitle-button').count(), 1, 'replacement leaves exactly one icon');
   await page.locator('#fixture-fullscreen').click();
   await page.waitForFunction(() => Boolean(document.fullscreenElement));
   await page.evaluate(time => {document.querySelector('video').currentTime = time;}, report.referenceSpeech[0].start + .6);
   await page.waitForFunction(() => document.fullscreenElement?.contains(document.querySelector('#fluent-read-video-subtitle-original')) && document.querySelector('#fluent-read-video-subtitle-original')?.textContent);
   await page.screenshot({path:path.join(artifacts,'fullscreen.png')});
   await page.evaluate(() => document.exitFullscreen());
   await page.reload();
   await initializeVideo();
   await page.locator('video').hover();
   await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent.includes('已就绪'), null, {timeout:30000});
   assert.equal(await worker.evaluate(() => globalThis.videoProofAsrCalls), asrBefore, 'refresh restores same media despite a new blob URL');
   // 菜单不再提供“重新识别”；清除已识别缓存后再次生成必须重新运行 Whisper。
   const clearedCache = await control.evaluate(() => chrome.runtime.sendMessage({type: 'fluentReadClearVideoAiSubtitleCache'}));
   assert.equal(clearedCache.success, true);
   await page.locator('#fluent-read-video-subtitle-button').click();
   await disableReadyAiSubtitles(page);
   await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"]')?.getAttribute('aria-checked') === 'false');
   await page.locator('[data-action="toggle-ai-subtitle"]').click();
   await page.waitForFunction(() => /%/.test(document.querySelector('#fluent-read-video-subtitle-button')?.getAttribute('data-fluent-read-video-progress') || ''));
   await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent.includes('已就绪'), null, {timeout:120000});
   const asrAfterRegeneration = await worker.evaluate(() => globalThis.videoProofAsrCalls);
   assert.ok(asrAfterRegeneration > asrBefore, 'clearing the transcript cache makes the next request run Whisper again');
   report.regeneration = {cacheAsrCalls:asrBefore,asrAfterRegeneration};
   await page.locator('#fluent-read-video-subtitle-button').click();
   await page.locator('h1').click();
   await page.mouse.move(1200,850);
   await page.waitForTimeout(1200);
   report.hiddenEntry = await page.locator('#fluent-read-video-subtitle-button').evaluate(button => ({
     fallback: button.closest('.fluent-read-video-fallback-controls') !== null,
     host: button.parentElement.className,
     controlsOpacity: getComputedStyle(button.parentElement).opacity,
   }));
   assert.equal(report.hiddenEntry.fallback, false, 'losing hover does not move the entry to a floating fallback');
   assert.equal(report.hiddenEntry.controlsOpacity, '0', 'inactive entry hides with native controls');
   // Use the established configuration protocol, preserving all other fields.
   const disable = await control.evaluate(async () => {
     const read = await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
     const current = typeof read.value === 'string' ? JSON.parse(read.value) : read.value;
     return chrome.runtime.sendMessage({type:'persistConfig',clientId:'x-lifecycle-proof',sequence:1,config:{...current,on:false},baseRevision:current.__fluentConfigRevision});
   });
   assert.equal(disable.success,true);
   await page.waitForFunction(() => !document.querySelector('#fluent-read-video-subtitle-button'));
   report.lifecycleChecks = {profileEntry:true,reclickCache:true,domReplacement:true,fullscreen:true,refreshCache:true,inactiveNativeControls:true,globalDisabled:true,asrBefore,asrAfter:await worker.evaluate(() => globalThis.videoProofAsrCalls)};
 }
 report.launchMode=browser.launchMode;report.focusPolicy=browser.focusPolicy;report.windowPlacement=browser.windowPlacement;
 assert.equal(report.windowPlacement.browserFrontmost,false);
 assert.deepEqual(report.errors, [], 'the player lifecycle must not produce unhandled page errors');
 report.success=true;
}
main().catch(async e=>{primaryError=e;report.failure=e.stack;process.exitCode=1;if(page)report.failureState=await page.evaluate(()=>({events:window.proofVideoEvents,samples:window.proofSamples?.slice(-20),video:[...document.querySelectorAll('video')].map(video=>({time:video.currentTime,duration:video.duration,paused:video.paused,ended:video.ended,ready:video.readyState,network:video.networkState,visibility:document.visibilityState,error:video.error?.message}))})).catch(()=>null);if(page)await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});}).finally(async()=>{
 const cleanupErrors = [];
 const cleanup = async action => {
   try {await action();} catch (error) {cleanupErrors.push(error);}
 };
 let browserClosed = false;
 await cleanup(async () => {await isolatedProbeSession?.detach();});
 await cleanup(async () => {
   if (browser) {await browser.close(); browserClosed = true;}
 });
 await cleanup(() => {
   if (browserClosed) fs.rmSync(profile, {recursive: true, force: true});
   else if (!launchAttempted) {
     // No browser launch was attempted; only remove an empty initial profile.
     try {fs.rmdirSync(profile);} catch (error) {
       if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
     }
   }
 });
 if (cleanupErrors.length) {
   report.success = false;
   report.cleanupErrors = cleanupErrors.map(error => error.stack || String(error));
 }
 await cleanup(() => {fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));});
 for (const error of cleanupErrors) process.stderr.write(`Cleanup failed: ${error.stack || error}\n`);
 if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
 console.log(JSON.stringify({success:report.success,generationMs:report.generationMs,prepareMs:report.prepareMs,texts:report.texts,failure:report.failure,artifacts},null,2));
}).catch(error=>{console.error(error.stack||error);process.exitCode=1;});

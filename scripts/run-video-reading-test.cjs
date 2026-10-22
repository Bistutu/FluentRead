#!/usr/bin/env node
/** 视频读音专项：生产扩展、隔离后台 Edge、真实本地引擎；网页/媒体为确定性夹具。 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {spawnSync} = require('node:child_process');
const {guardBrowserClose} = require('./testing/owned-browser-close.cjs');
function arg(name, fallback) {const i=process.argv.indexOf(`--${name}`);return i<0?fallback:process.argv[i+1];}
const extensionDir=path.resolve(arg('extension-dir','.output/chrome-mv3'));
const artifactsDir=path.resolve(arg('artifacts-dir',path.join(os.tmpdir(),'fluentread-video-reading')));
const runtimeRoot=arg('playwright-root',process.env.PLAYWRIGHT_ROOT);
const helperPath=arg('focus-safe-helper',process.env.FLUENTREAD_FOCUS_SAFE_HELPER);
let sequence=0;
async function readConfig(page) {
  return page.evaluate(async () => {
    const read=async key => {const r=await chrome.runtime.sendMessage({type:'configStorageRead',key});if(!r?.success)throw Error(r?.error||'config read');return typeof r.value==='string'?JSON.parse(r.value):r.value||{};};
    return {...await read('local:config'),...await read('local:credentials')};
  });
}
async function persist(page,patch) {
  const current=await readConfig(page);
  const response=await page.evaluate(({current,patch,sequence}) => chrome.runtime.sendMessage({type:'persistConfig',config:{...current,...patch},clientId:'video-reading-fixture',sequence,baseRevision:current.__fluentConfigRevision}),{current,patch,sequence:++sequence});
  assert.equal(response?.success,true,JSON.stringify(response));
}
async function main() {
  if (!runtimeRoot || !helperPath) throw Error('--playwright-root and --focus-safe-helper required');
  fs.mkdirSync(artifactsDir,{recursive:true});
  const {chromium}=createRequire(path.join(path.resolve(runtimeRoot),'__reading_test.cjs'))('playwright');
  const {launchFocusSafePersistentContext,newPageWithoutForeground,activateExtensionTabWithoutForeground}=require(path.resolve(helperPath));
  const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-reading-edge-'));
  const report={extensionDir,scope:'production extension with deterministic YouTube/media/translation fixtures; real offline reading engines',cases:[],consoleErrors:[],unexpectedNetwork:[],passed:false};
  let session,context,page;
  try {
    session=await launchFocusSafePersistentContext({chromium,profileDir,browserPath:arg('browser-path','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),headless:false,background:true,displayTarget:'secondary',browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check'],viewport:{width:1280,height:900}});
    guardBrowserClose(session,profileDir); context=session.context;
    Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement});
    await context.route('**/*',async route => {
      const url=new URL(route.request().url());
      if(url.protocol==='http:'||url.protocol==='https:') {report.unexpectedNetwork.push(url.href);await route.abort('blockedbyclient');} else await route.continue();
    });
    const background=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:30000});
    background.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
    await background.evaluate(()=>{
      const nativeFetch=fetch.bind(globalThis);
      globalThis.__readingNetworkAttempts=[];globalThis.__readingFixtureTranslations=0;
      globalThis.fetch=(input,init)=>{
        const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
        if(url.hostname==='edge.microsoft.com'&&url.pathname==='/translate/translatetext') {
          globalThis.__readingFixtureTranslations++;
          return Promise.resolve(new Response(JSON.stringify([{translations:[{text:'我去学校。'}]}]),{status:200,headers:{'content-type':'application/json'}}));
        }
        if(url.protocol==='http:'||url.protocol==='https:') {globalThis.__readingNetworkAttempts.push(url.href);return Promise.reject(new Error('Reading fixture blocked remote network'));}
        return nativeFetch(input,init);
      };
    });
    const extensionId=new URL(background.url()).host;
    const popup=await newPageWithoutForeground(context);
    popup.on('pageerror',error=>report.consoleErrors.push(error.message));
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await activateExtensionTabWithoutForeground(context,popup);
    await popup.locator('.popup-shell[data-config-ready="true"]').waitFor({timeout:15000});
    const initial=await readConfig(popup);
    assert.notEqual(initial.videoSubtitleAppearance?.readingAnnotation,true);
    await persist(popup,{on:true,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,from:'ja',to:'zh-Hans',videoTranslationEnabled:true,videoService:'microsoft',videoServiceDefaultMigrated:true,videoSubtitleVisible:true,videoSubtitleDisplayMode:'original-only',videoSubtitleAppearance:{...initial.videoSubtitleAppearance,readingAnnotation:false},useCache:false});
    const videoPath=path.join(artifactsDir,'fixture.mp4');
    const media=spawnSync(arg('ffmpeg','/opt/homebrew/bin/ffmpeg'),['-y','-f','lavfi','-i','color=c=black:s=320x180:r=1','-t','30','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',videoPath],{encoding:'utf8',timeout:30000});
    assert.equal(media.status,0,media.stderr);
    page=await newPageWithoutForeground(context);
    page.on('pageerror',error=>report.consoleErrors.push(error.message));
    const fixtureUrl='https://www.youtube.com/watch?v=fluentread-reading';
    await page.route(fixtureUrl,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><title>FluentRead 读音标注专项</title><script>var ytInitialPlayerResponse={};</script></head><body style="margin:0;background:#eef2f4"><div id="movie_player" class="html5-video-player" style="position:relative;width:960px;height:540px;margin:24px;background:linear-gradient(130deg,#14252f,#0e1720);color:#fff"><p style="position:absolute;left:28px;top:18px;font:16px system-ui">FluentRead · 日语跟读</p><video class="html5-main-video" muted style="position:absolute;inset:0;width:100%;height:100%;opacity:0"></video><div id="ytp-caption-window-container" style="position:absolute;bottom:90px;left:5%;width:90%;text-align:center;font:30px system-ui"><span class="ytp-caption-segment"></span></div><div class="ytp-right-controls" style="position:absolute;bottom:14px;right:20px;width:300px;height:40px"></div></div></body></html>'}));
    await page.goto(fixtureUrl);await activateExtensionTabWithoutForeground(context,page);
    await page.evaluate(data=>{const video=document.querySelector('video');video.src=data;video.load();},`data:video/mp4;base64,${fs.readFileSync(videoPath).toString('base64')}`);
    await page.locator('#fluent-read-video-subtitle-button').waitFor({timeout:15000});
    const setSource=text=>page.locator('.ytp-caption-segment').evaluate((element,value)=>{element.textContent=value;},text);
    const readLine=()=>page.locator('#fluent-read-video-subtitle-reading').textContent();
    const targets=async()=>{
      const cdp=await context.browser().newBrowserCDPSession();const workers=[];let parent;
      try {
        const infos=(await cdp.send('Target.getTargets')).targetInfos;
        const offscreen=infos.find(target=>target.type==='page'&&target.url===`chrome-extension://${extensionId}/offscreen.html`);
        if(!offscreen)return [];
        ({sessionId:parent}=await cdp.send('Target.attachToTarget',{targetId:offscreen.targetId,flatten:false}));
        cdp.on('Target.receivedMessageFromTarget',event=>{
          if(event.sessionId!==parent)return;
          const message=JSON.parse(event.message);
          if(message.method==='Target.attachedToTarget'&&message.params.targetInfo.type==='worker')workers.push(message.params.targetInfo);
        });
        // Offscreen 不进入 Playwright 的页面清单；从其所属 DevTools 会话枚举专用子 Worker。
        await cdp.send('Target.sendMessageToTarget',{sessionId:parent,message:JSON.stringify({id:1,method:'Target.setAutoAttach',params:{autoAttach:true,waitForDebuggerOnStart:false,flatten:false}})});
        await new Promise(resolve=>setTimeout(resolve,50));
        report.lastWorkers=workers.map(({type,url})=>({type,url}));
        return workers.filter(t=>t.url.includes('readingAnnotationWorker'));
      }finally{if(parent)await cdp.send('Target.detachFromTarget',{sessionId:parent});await cdp.detach();}
    };
    await setSource('私は学校へ行きます。');
    await page.waitForTimeout(400);
    assert.equal((await targets()).length,0);
    assert.equal(await page.locator('#fluent-read-video-subtitle-reading').count(),0);
    report.cases.push({name:'default-off',passed:true,workerCount:0});
    await page.locator('#fluent-read-video-subtitle-button').click();
    const toggle=page.locator('[data-action="toggle-reading-annotation"]');
    const japaneseStarted=performance.now();
    await toggle.click();
    await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-reading')?.textContent==='watashi wa gakkō e ikimasu.',null,{timeout:30000});
    report.japaneseColdDisplayMs=Math.round(performance.now()-japaneseStarted);
    assert.equal(await toggle.getAttribute('aria-checked'),'true');
    assert.equal((await targets()).length,1);
    assert.equal((await readConfig(popup)).videoSubtitleAppearance.readingAnnotation,true);
    await page.locator('#fluent-read-video-subtitle-button').click();
    await page.locator('#fluent-read-video-subtitle-reading').waitFor({state:'visible'});
    await page.screenshot({path:path.join(artifactsDir,'japanese-original-reading.png')});
    await persist(popup,{videoSubtitleDisplayMode:'bilingual'});
    await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-reading')?.textContent==='watashi wa gakkō e ikimasu.'&&document.querySelector('#fluent-read-video-subtitle')?.textContent==='我去学校。');
    await page.screenshot({path:path.join(artifactsDir,'japanese-bilingual-reading.png')});
    await persist(popup,{videoSubtitleDisplayMode:'original-only'});
    report.cases.push({name:'real-japanese-pipeline-and-menu-save',passed:true,text:await readLine()});
    for(const [language,text,expected] of [['ko','국립 한국어 같이 읽는','gungnip hangugeo gachi ingneun'],['zh-Hant','銀行的音樂','yín háng de yīn yuè'],['ru','Йога и ёлка','Joga i ëlka'],['el','Ευχαριστώ','Efcharistó'],['ar','مُحَمَّد','muḥammad'],['hi','भारत में कमल','bharat mein kamal'],['th','สวัสดีครับ','sawatdi khrap']]) {
      const started=performance.now();
      await persist(popup,{from:language});await setSource(text);
      await page.waitForFunction(expected=>document.querySelector('#fluent-read-video-subtitle-reading')?.textContent===expected,expected,{timeout:30000});
      assert.equal(await page.locator('.ytp-caption-segment').textContent(),text);
      assert.equal((await targets()).length,1);
      report.cases.push({name:`real-${language}-pipeline`,passed:true,text:await readLine(),displayMs:Math.round(performance.now()-started)});
    }
    await persist(popup,{from:'en'});await setSource('This sentence already uses Latin letters.');
    await page.waitForFunction(()=>!document.querySelector('#fluent-read-video-subtitle-reading')?.textContent);
    await page.locator('#fluent-read-video-subtitle-button').click();
    await page.waitForFunction(()=>document.querySelector('[data-reading-status]')?.textContent==='当前原文无需或不支持读音标注');
    assert.equal(await toggle.getAttribute('aria-checked'),'true');
    await page.locator('#fluent-read-video-subtitle-button').click();
    report.cases.push({name:'unsupported-source-explains-without-losing-preference',passed:true});
    await persist(popup,{from:'ja'});await setSource('私は学校へ行きます。');
    await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-reading')?.textContent==='watashi wa gakkō e ikimasu.');
    await persist(popup,{videoSubtitleDisplayMode:'translation-only'});
    await page.waitForFunction(()=>!document.querySelector('#fluent-read-video-subtitle-reading')?.textContent);
    assert.equal((await readConfig(popup)).videoSubtitleAppearance.readingAnnotation,true);
    await persist(popup,{videoSubtitleDisplayMode:'original-only'});
    await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-reading')?.textContent==='watashi wa gakkō e ikimasu.');
    report.cases.push({name:'translation-only-hides-and-return-restores',passed:true});
    await page.setViewportSize({width:390,height:844});
    await page.locator('#movie_player').evaluate(el=>{el.style.width='358px';el.style.height='240px';el.style.margin='16px';});
    await setSource('私は学校へ行きます。明日は友達と映画を見ます。これはとても長い字幕の読音表示テストです。');
    await page.waitForFunction(()=>document.querySelector('#fluent-read-video-subtitle-reading')?.textContent?.includes('ashita'),null,{timeout:15000});
    await page.screenshot({path:path.join(artifactsDir,'japanese-narrow-reading.png')});
    const layout=await page.locator('#fluent-read-video-subtitle-panel').evaluate(el=>({client:el.clientHeight,scroll:el.scrollHeight,width:el.clientWidth,scrollWidth:el.scrollWidth,font:getComputedStyle(el).fontSize,overflow:getComputedStyle(el).overflowY}));
    assert.ok(layout.scrollWidth<=layout.width+2,JSON.stringify(layout));
    assert.ok(layout.scroll<=layout.client+2||layout.overflow==='auto',JSON.stringify(layout));
    assert.ok(parseFloat(layout.font)>=16,JSON.stringify(layout));
    report.cases.push({name:'long-narrow-reading',passed:true,layout});
    await page.setViewportSize({width:1280,height:900});
    const options=await newPageWithoutForeground(context);await options.goto(`chrome-extension://${extensionId}/options.html#settings-video`);
    await activateExtensionTabWithoutForeground(context,options);
    const settingsToggle=options.getByRole('switch',{name:'读音标注',exact:true});
    const settingsControl=options.locator('[data-video-subtitle-reading-annotation]');
    await settingsControl.waitFor({state:'visible',timeout:15000});assert.equal(await settingsToggle.getAttribute('aria-checked'),'true');
    await options.screenshot({path:path.join(artifactsDir,'settings-reading.png')});
    await settingsControl.click();await options.close();
    await popup.reload();await popup.locator('.popup-shell[data-config-ready="true"]').waitFor({timeout:15000});
    assert.equal((await readConfig(popup)).videoSubtitleAppearance.readingAnnotation,false);
    await page.waitForFunction(()=>!document.querySelector('#fluent-read-video-subtitle-reading')?.textContent);
    // 在空闲回收等待前取证，避免 MV3 后台休眠后把丢失的网络计数误写为零。
    report.network=await background.evaluate(()=>({blocked:globalThis.__readingNetworkAttempts||[],fixtureTranslationRequests:globalThis.__readingFixtureTranslations||0}));
    await page.waitForTimeout(31000);assert.equal((await targets()).length,0);
    report.cases.push({name:'settings-quick-close-persistence-off-idle-release',passed:true});
    assert.deepEqual(report.network.blocked,[]);assert.deepEqual(report.unexpectedNetwork,[]);assert.deepEqual(report.consoleErrors,[]);
    report.passed=true;
  } catch(error) {
    report.error=error.stack||String(error);
    if(page) {
      await page.screenshot({path:path.join(artifactsDir,'failure.png')}).catch(()=>{});
      report.dom=await page.locator('body').innerText().catch(()=> 'page unavailable');
    }
    if(context?.serviceWorkers()[0]) report.network=await context.serviceWorkers()[0].evaluate(()=>({blocked:globalThis.__readingNetworkAttempts||[],fixtureTranslationRequests:globalThis.__readingFixtureTranslations||0})).catch(()=>({backgroundRestarted:true}));
    throw error;
  }
  finally {
    fs.writeFileSync(path.join(artifactsDir,'report.json'),JSON.stringify(report,null,2));
    if(session) await session.close();
    fs.rmSync(profileDir,{recursive:true,force:true});
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }
}
main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});

#!/usr/bin/env node
'use strict';
/**
 * @file scripts/testing/run-popup-display-mode-ui-test.cjs
 * 文件职责：在隔离生产扩展中验证紧随网站按钮的双语/仅译文图标、持久化和现有译文即时刷新。
 * 主要内容：使用 skill 的后台安全启动 helper、原生激活事件观察器与本地确定性服务，记录语言/主题/触屏下网站按钮及图标的顺序、紧凑间距、自然换行与边界，以及诊断浮层、快关重开、最新写入胜出和恢复原文。
 * 模块边界：只操作本脚本的临时 Edge profile 和 HTTP 页面；不修改产品构建、用户浏览器配置、供应商服务或全局桌面焦点。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {startFocusEventMonitor} = require('./mac-focus-event-monitor.cjs');
const arg = (name, fallback) => {const index = process.argv.indexOf(`--${name}`);return index < 0 ? fallback : process.argv[index + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-popup-display-mode-20261018'));
const browserPath=arg('browser-path','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
const loadViaCdp=process.argv.includes('--load-via-cdp') || /Google Chrome/u.test(browserPath);
const focusPreflight=process.argv.includes('--focus-preflight');
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
// 仓库 helper 延续 skill 的后台启动协议，并追加精确身份与 transport-only 清理保护。
const helperPath = arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'));
const helper = require(helperPath);
const timeout = 30000;
const SOURCE = 'Reading should feel calm and effortless. Colors and lines should follow the page you are reading.';
const TRANSLATION = '阅读应该轻松、自然。颜色和线条应当贴合你正在阅读的网页。';
const service = 'custom:display-mode-fixture';
const report = {ok: false, artifact: 'production', extensionDir, scope: 'Popup display-mode shortcut, persistence, responsive layout and existing translation refresh with a local deterministic provider',
  evidenceBoundary: 'Real production MV3 extension in one isolated visible background Edge profile. Popup is opened at its manifest URL as an extension tab with active-tab lookup bound to a real local content tab. Diagnostic state is a named response fixture. No native toolbar, real provider, Firefox, Safari or mobile-device runtime claim.',
  focusSafeHelper:helperPath,focusPreflight,cases: [], persistenceCases: [], quickClose: false, latestWriteWins: false, crossPageSync: false, consoleErrors: [], screenshots: [], screenshotDimensions:{},layout: {}, requests: [], focusEvents: [],operations:[],cleanupErrors: []};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
fs.mkdirSync(artifactsDir, {recursive: true});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-display-mode-'));
report.profileDir=profileDir;
let launched, context, control, popup, content, origin, fixtureUrl, browserPid, monitor, focusFailure, cleanupStarted = false;
let currentCase = 'launch';
let currentOperation='initial';
const emulationSessions=new WeakMap();
function save() {fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));}
function stage(name) {currentOperation=name;report.operations.push({name,at:new Date().toISOString(),monotonic:performance.now()});save();}
function focusSafe() {if (focusFailure) throw focusFailure;if (monitor?.error) throw monitor.error;assert(!monitor?.events.some(event => event.pid === browserPid), 'Owned Edge activation event');}
function failFocus(error) {focusFailure ||= error;report.focusError = error.message;report.ok = false;save();if (!cleanupStarted) void launched?.close();}
async function until(test, label, duration = 15000) {const deadline = Date.now() + duration;while (Date.now() < deadline) {focusSafe();if (await test()) return;await wait(60);}throw new Error(`${label}: timeout`);}
function observe(page) {
  page.on('pageerror', error => report.consoleErrors.push({url: page.url(), message: error.message}));
  page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({url: page.url(), message: message.text()});});
}
async function open(url, viewport) {focusSafe();const page = await helper.newPageWithoutForeground(context, timeout);observe(page);if (viewport) await page.setViewportSize(viewport);await page.goto(url, {waitUntil: 'domcontentloaded'});return page;}
async function read() {const result = await control.evaluate(() => chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}));assert(result?.success && result.value);return result.value;}
async function patch(values) {
  const current = await read();
  const initial = Object.hasOwn(values, 'token');
  const result = await control.evaluate(({current, values, initial}) => chrome.runtime.sendMessage({type: 'persistConfig', mode: initial ? 'replace' : 'patch', config: initial ? {...current, ...values} : values,
    expected: Object.fromEntries(Object.keys(values).map(key => [key, current[key]])),baseRevision: initial ? current.__fluentConfigRevision || 0 : undefined,clientId: `display-ui-${crypto.randomUUID()}`,sequence: 1}), {current, values, initial});
  assert.equal(result?.success, true, result?.error);
  for (const [key, value] of Object.entries(values)) if (key !== 'token') await saved(key, value);
}
async function saved(key, value) {await until(async () => JSON.stringify((await read())[key]) === JSON.stringify(value), `saved ${key}`);}
async function emulation(page){let cdp=emulationSessions.get(page);if(!cdp){cdp=await context.newCDPSession(page);emulationSessions.set(page,cdp);}return cdp;}
async function fit(page, {touch = false, scale = 2} = {}) {
  await wait(180);
  const size = await page.locator('.popup-shell').evaluate(node => {const rect = node.getBoundingClientRect();return {width: Math.ceil(rect.width), height: Math.ceil(rect.height)};});
  await page.setViewportSize(size);
  const cdp = await emulation(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {...size, deviceScaleFactor: scale, mobile: false});if (touch) await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 1});
}
async function openPopup({diagnostic = false, touch = false} = {}) {
  const page = await helper.newPageWithoutForeground(context, timeout);observe(page);await page.setViewportSize({width: 400, height: 560});
  if (touch) await (await emulation(page)).send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 1});
  await page.addInitScript(({fixtureUrl, diagnostic}) => {
    globalThis.__displayModeProbe = {requests: [], responses: []};
    const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (...args) => {
      const message = args.find(value => value && typeof value === 'object' && typeof value.type === 'string');
      if (['persistConfig', 'persistConfigBatch'].includes(message?.type)) {
        globalThis.__displayModeProbe.requests.push({type: message.type, display: message.config?.display, patches: message.patches?.map(patch => patch.config?.display)});
        const callbackIndex = args.findLastIndex(value => typeof value === 'function');
        if (callbackIndex >= 0) {const callback = args[callbackIndex];args[callbackIndex] = result => {globalThis.__displayModeProbe.responses.push({success: result?.success, revision: result?.revision});callback(result);};return originalSend(...args);}
        return Promise.resolve(originalSend(...args)).then(result => {globalThis.__displayModeProbe.responses.push({success: result?.success, revision: result?.revision});return result;});
      }
      return originalSend(...args);
    };
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (info, callback) => {
      if (!info.active) return query(info, callback);
      const {active: _active, ...rest} = info;
      const filter = tabs => tabs.filter(tab => tab.url === fixtureUrl);
      return typeof callback === 'function' ? query(rest, tabs => callback(filter(tabs))) : query(rest).then(filter);
    };
    if (diagnostic) {
      const send = chrome.tabs.sendMessage.bind(chrome.tabs);
      chrome.tabs.sendMessage = (...args) => {
        const message=args[1],callback=args.findLast(value=>typeof value==='function');
        if (message.type !== 'getFullPageTranslationState') return send(...args);
        const result = {status: 'success', isTranslated: false, toolbarStatus: 'error'};
        return typeof callback === 'function' ? callback(result) : Promise.resolve(result);
      };
    }
  }, {fixtureUrl, diagnostic});
  await page.goto(`${origin}/popup.html`, {waitUntil: 'domcontentloaded'});await helper.activateExtensionTabWithoutForeground(context, page);
  await page.locator('.popup-shell[data-config-ready="true"]').waitFor();await page.locator('[data-testid="popup-display-mode"]').waitFor();
  await page.locator('[data-setting="disable-extension-site"][data-site-domain="127.0.0.1"]').waitFor();
  await fit(page, {touch});return page;
}
async function closePage(page) {
  const id = await page.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  const cdp=emulationSessions.get(page);if(cdp){await cdp.detach();emulationSessions.delete(page);}
  await control.evaluate(async id => {const anchor = await chrome.tabs.getCurrent();await chrome.tabs.update(anchor.id, {active: true});await chrome.tabs.remove(id);}, id);
}
async function shot(page, name) {
  focusSafe();stage(`screenshot:${name}`);await wait(150);const file=path.join(artifactsDir,`${name}.png`);const cdp=await context.newCDPSession(page);
  try {const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:devicePixelRatio}));const {data}=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,clip:{x:0,y:0,width:viewport.width,height:viewport.height,scale:1}});
    const bytes=Buffer.from(data,'base64');fs.writeFileSync(file,bytes);const actual={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};report.screenshotDimensions[name]={viewport,...actual};
    if(name.endsWith('-2x'))assert.equal(actual.width,viewport.width*2,`${name}: expected an actual 2x capture`);
  }finally{await cdp.detach();}report.screenshots.push(file);return file;
}
async function closeNativeBrowser() {
  if(!context?.browser()?.isConnected())return;
  stage('cleanup:browser-level-cdp-normal-close');const browser=context.browser();let timer;
  const disconnected=new Promise((resolve,reject)=>{browser.once('disconnected',resolve);timer=setTimeout(()=>reject(new Error('Native close did not disconnect within 5 seconds')),5000);});const cdp=await browser.newBrowserCDPSession();
  const closeResult=cdp.send('Browser.close').then(()=>({acknowledged:true}),error=>({acknowledged:false,error:error.message}));
  try{await disconnected;report.nativeClose=await closeResult;report.nativeClose.disconnected=true;stage('cleanup:cdp-disconnected');}
  finally{clearTimeout(timer);await cdp.detach().catch(()=>{});}
}
async function singlePresentation() {
  const cdp = await context.newCDPSession(content);
  try {
    const {root} = await cdp.send('DOM.getDocument', {depth:-1,pierce:true});const slots=[];
    const text = node => node.nodeType === 3 ? node.nodeValue : (node.children || []).map(text).join('');
    const visit = node => {const attrs = Object.fromEntries(Array.from({length:(node.attributes || []).length / 2},(_,index) => [node.attributes[index*2],node.attributes[index*2+1]]));
      if ((attrs.class || '').split(/\s/u).includes('fluent-read-single-slot')) slots.push({source:text(node),translation:(node.shadowRoots || []).map(text).join(''),closed:node.shadowRoots?.[0]?.shadowRootType === 'closed'});
      for (const child of [...(node.children || []),...(node.shadowRoots || [])]) visit(child);
    };visit(root);return slots;
  } finally {await cdp.detach();}
}
async function geometry(page, name, touch = false) {
  await fit(page, {touch});
  const metrics = await page.evaluate(() => {
    const rect = selector => {const r = document.querySelector(selector)?.getBoundingClientRect();return r && {x:r.x,y:r.y,width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
    const shell = document.querySelector('.popup-shell');const button = document.querySelector('[data-testid="popup-display-mode"]'),meta=document.querySelector('.translation-meta');
    const selectors=[['always','[data-setting="always-translate-site"]'],['disabled','[data-setting="disable-extension-site"]'],
      ['mode','[data-testid="popup-display-mode"]'],['diagnostic','[data-diagnostic-details-toggle]']];
    const controls=selectors.map(([key,selector])=>({key,bounds:rect(selector)})).filter(item=>item.bounds);
    const order=[...meta.querySelectorAll('[data-setting], [data-testid="popup-display-mode"], [data-diagnostic-details-toggle]')]
      .map(node=>node.hasAttribute('data-diagnostic-details-toggle')?'diagnostic':node.hasAttribute('data-testid')?'mode':node.dataset.setting==='always-translate-site'?'always':'disabled');
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
    return {shell:rect('.popup-shell'),button:rect('[data-testid="popup-display-mode"]'),meta:rect('.translation-meta'),controls,order,footer:rect('footer'),
      viewport:{width:innerWidth,height:innerHeight,scale:devicePixelRatio},coarse:matchMedia('(any-pointer: coarse)').matches,scrollWidth:shell.scrollWidth,clientWidth:shell.clientWidth,
      scrollHeight:shell.scrollHeight,clientHeight:shell.clientHeight,horizontalOverflow:document.documentElement.scrollWidth > innerWidth + 1 || shell.scrollWidth > shell.clientWidth + 1,
      buttonLabel:button.getAttribute('aria-label'),title:button.title,buttonText:button.textContent.trim(),mode:button.dataset.displayMode,duplicateIds:ids.filter((id,index) => ids.indexOf(id) !== index)};
  });
  report.layout[name]=metrics;save();
  assert(metrics.shell.width <= 400 && metrics.shell.height <= 560 && !metrics.horizontalOverflow, `${name}: popup bounds ${JSON.stringify(metrics)}`);
  assert.equal(metrics.duplicateIds.length, 0);assert(metrics.buttonLabel && metrics.title);assert.equal(metrics.buttonText, '');
  assert.equal(metrics.button.width, touch ? 46 : 24);assert.equal(metrics.button.height, touch ? 46 : 24);
  assert.deepEqual(metrics.order,['always','disabled','mode',...(metrics.controls.some(item=>item.key==='diagnostic')?['diagnostic']:[])],`${name}: website buttons must precede mode and diagnostic`);
  for(let index=0;index<metrics.controls.length;index++) {
    const current=metrics.controls[index],bounds=current.bounds;
    assert(bounds.left>=metrics.meta.left-1 && bounds.right<=metrics.meta.right+1 && bounds.top>=metrics.meta.top-1 && bounds.bottom<=metrics.meta.bottom+1,`${name}: ${current.key} outside meta bounds`);
    if(index===0){assert(Math.abs(bounds.left-metrics.meta.left)<=1,`${name}: website controls must start at the row edge`);continue;}
    const previous=metrics.controls[index-1].bounds,overlap=Math.min(bounds.bottom,previous.bottom)-Math.max(bounds.top,previous.top);
    if(overlap>1) {
      const gap=bounds.left-previous.right;
      assert(gap>=0 && gap<=10,`${name}: ${current.key} must compactly follow previous control (gap ${gap}px)`);
      assert(Math.abs((bounds.top+bounds.bottom-previous.top-previous.bottom)/2)<=1,`${name}: same-row controls must align vertically`);
    } else {
      assert(bounds.top>=previous.bottom && Math.abs(bounds.left-metrics.meta.left)<=1,`${name}: ${current.key} must wrap to the next row's start`);
      assert(previous.right+bounds.width+10>metrics.meta.right-1,`${name}: ${current.key} wrapped despite available space`);
    }
    for(const earlier of metrics.controls.slice(0,index)) {
      const other=earlier.bounds;
      assert(Math.min(bounds.right,other.right)-Math.max(bounds.left,other.left)<=1 || Math.min(bounds.bottom,other.bottom)-Math.max(bounds.top,other.top)<=1,`${name}: ${earlier.key} and ${current.key} overlap`);
    }
  }
  assert(metrics.footer.bottom <= metrics.viewport.height + 1, `${name}: footer clipped`);
  if (touch) assert(metrics.coarse, 'Touch emulation must enable any-pointer coarse');
  report.layout[name] = metrics;return metrics;
}
const server = http.createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');response.setHeader('access-control-allow-headers', '*');
  if (request.method === 'OPTIONS') {response.writeHead(204);response.end();return;}
  if (request.method === 'POST') {
    const chunks = [];for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());const prompt = body.messages.filter(item => item.role === 'user').map(item => item.content).join('\n');
    const source = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1] || '';
    report.requests.push({source, model:body.model});response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({id:'display-fixture',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:source.replace(SOURCE,TRANSLATION)},finish_reason:'stop'}]}));return;
  }
  // 只验证正文模式；空 title 避免无关的标题翻译另计一次调用。
  response.setHeader('content-type', 'text/html; charset=utf-8');response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title></title><style>body{padding:50px;font:18px/1.8 system-ui;background:white;color:#263044}article{max-width:800px}p{padding:20px;border:1px solid #ddd}</style><article><h1 translate="no">Display mode fixture</h1><p id="primary">${SOURCE}</p></article></html>`);
});
(async () => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json')));assert(manifest.action.default_popup && (manifest.options_page || manifest.options_ui?.page));
    report.manifest = {version:manifest.version,popup:manifest.action.default_popup,options:manifest.options_page || manifest.options_ui.page};
    await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve);});fixtureUrl = `http://127.0.0.1:${server.address().port}/article`;
    stage('focus-observer:start');monitor = startFocusEventMonitor({onEvent:event => {report.focusEvents.push({...event,case:currentCase,operation:currentOperation,cleanup:cleanupStarted});if (!cleanupStarted && browserPid && event.pid === browserPid) failFocus(new Error('Owned browser became frontmost'));},onError:error => {if (!cleanupStarted) failFocus(error);}});report.focusObserver = await monitor.ready;
    stage('browser:launch');
    launched = await helper.launchFocusSafePersistentContext({chromium,profileDir,browserPath,background:true,headless:false,displayTarget:'secondary',viewport:{width:1200,height:800},timeout,
      browserArgs:[...(focusPreflight ? [] : loadViaCdp ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`]),'--no-first-run','--no-default-browser-check']});context = launched.context;report.browserVersion=context.browser().version();report.browserPath=browserPath;
    Object.assign(report,{launchMode:launched.launchMode,focusPolicy:launched.focusPolicy,windowPlacement:launched.windowPlacement});
    assert.equal(report.launchMode,'macos-background-cdp');assert.equal(report.focusPolicy,'launchservices-no-foreground');assert.equal(report.windowPlacement.mode,'background-visible-no-focus');assert.equal(report.windowPlacement.browserFrontmost,false);
    const session = await context.browser().newBrowserCDPSession();try {const {processInfo} = await session.send('SystemInfo.getProcessInfo');browserPid = processInfo.find(process => process.type === 'browser')?.id;assert(browserPid);}finally {await session.detach();}focusSafe();
    report.ownedBrowserPid=browserPid;stage('browser:identity-confirmed');if(focusPreflight){report.scope='Isolated visible background Edge launch and normal CDP shutdown focus preflight only';report.ok=true;return;}
    let extensionId;
    if(loadViaCdp) {const loader = await context.browser().newBrowserCDPSession();try {extensionId = (await loader.send('Extensions.loadUnpacked',{path:extensionDir})).id;}finally {await loader.detach();}
      report.extensionLoad={method:'Extensions.loadUnpacked',id:extensionId};origin=`chrome-extension://${extensionId}`;control=await open(`${origin}/${manifest.action.default_popup}`);}
    else report.extensionLoad={method:'isolated-unpacked-command-line'};
    let worker;
    await until(async () => {for (const candidate of context.serviceWorkers()) {if (!candidate.url().startsWith('chrome-extension://') || !candidate.url().endsWith(`/${manifest.background.service_worker}`) || (extensionId && new URL(candidate.url()).host!==extensionId)) continue;
      // 原始清单的 __MSG_* 名称会在 getManifest 中本地化，不能据此误判真实 worker。
      const actual = await candidate.evaluate(() => {const m=chrome.runtime.getManifest();return {name:m.name,version:m.version,popup:m.action?.default_popup,description:m.description};});
      if(actual.version===manifest.version && actual.popup===manifest.action.default_popup && actual.description===manifest.description) {worker=candidate;report.loadedManifest=actual;return true;}}return false;},'extension worker',timeout);
    origin = `chrome-extension://${new URL(worker.url()).host}`;worker.on('console',message => {if (message.type() === 'error') report.consoleErrors.push({url:worker.url(),message:message.text()});});
    if(!control)control=await open(`${origin}/${manifest.action.default_popup}`);
    await until(async () => Boolean((await read()).service),'initial config');const initial = await read();
    await patch({on:true,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,theme:'light',interfaceSkin:'default',service,from:'auto',to:'zh-Hans',display:1,style:1,autoTranslate:false,alwaysTranslateDomains:[],disabledExtensionDomains:[],useCache:false,
      customOpenAIProviders:[{id:service,name:'本地测试服务',endpoint:fixtureUrl.replace('/article','/v1/chat/completions'),models:['display-fixture-model']}],model:{...initial.model,[service]:'display-fixture-model'},token:{[service]:'synthetic-local-fixture-not-a-secret'},user_role:{...initial.user_role,[service]:'SOURCE_BEGIN{{origin}}SOURCE_END'},enableAIContext:false,enableAIMultiSegment:false,glossaryEnabled:false,disableFloatingBall:true,disableSelectionTranslator:true,selectionTranslatorMode:'disabled',animations:false});
    // 统计只能走独立增量协议，普通配置补丁不能回写 count。
    const countSeed = await control.evaluate(() => chrome.runtime.sendMessage({type:'incrementConfigCount',delta:2028,operationId:`display-fixture-${crypto.randomUUID()}`}));assert.equal(countSeed?.success,true);await saved('count',2028);
    content = await open(fixtureUrl,{width:1100,height:760});
    const contentTab = await control.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id,fixtureUrl);
    await until(async () => {try {return (await control.evaluate(tab => chrome.tabs.sendMessage(tab,{type:'getFullPageTranslationState'}),contentTab)).status === 'success';}catch {return false;}},'content ready');
    currentCase = 'layout';
    for (const [name,theme,uiLanguage,touch] of [['zh-light','light','zh-CN',false],['zh-dark','dark','zh-CN',false],['en-light','light','en-US',false],['zh-touch','light','zh-CN',true]]) {
      await patch({theme,uiLanguage});popup = await openPopup({touch});await geometry(popup,name,touch);await shot(popup,`popup-${name}-2x`);await closePage(popup);report.cases.push({name:`${name}: mode icon compactly follows website buttons with natural wrapping and no overflow`,passed:true});
    }
    await patch({theme:'light',uiLanguage:'zh-CN'});popup = await openPopup();
    currentCase = 'mode-toggle';const toggle = () => popup.locator('[data-testid="popup-display-mode"]');
    assert.equal(await toggle().getAttribute('data-display-mode'),'bilingual');assert.match(await toggle().getAttribute('title'),/双语.*仅译文/u);
    await toggle().focus();await popup.keyboard.press('Space');await saved('display',0);await until(async () => await toggle().getAttribute('data-display-mode') === 'translation-only','single icon');
    assert.match(await toggle().getAttribute('title'),/仅译文.*双语/u);await shot(popup,'popup-translation-only-2x');
    const firstProbe = await popup.evaluate(() => globalThis.__displayModeProbe);assert(firstProbe.requests.length && firstProbe.responses.some(response => response.success));
    report.persistenceCases.push({name:'keyboard toggle persists through real background config API',passed:true,probe:firstProbe});
    await closePage(popup);popup = await openPopup();assert.equal(await toggle().getAttribute('data-display-mode'),'translation-only');
    currentCase = 'quick-close';await toggle().click();const quickProbe = await popup.evaluate(() => globalThis.__displayModeProbe);await closePage(popup);await saved('display',1);popup = await openPopup();
    assert.equal(await toggle().getAttribute('data-display-mode'),'bilingual');report.quickClose = true;report.persistenceCases.push({name:'one click then immediate close and reopen',before:0,after:1,reopened:1,probe:quickProbe,passed:true});
    currentCase = 'latest-write-wins';await toggle().click();await toggle().click();const latestProbe = await popup.evaluate(() => globalThis.__displayModeProbe);await closePage(popup);await saved('display',1);popup = await openPopup();
    assert.equal(await toggle().getAttribute('data-display-mode'),'bilingual');report.latestWriteWins = true;report.persistenceCases.push({name:'two consecutive writes then immediate close keep final choice',before:1,writes:[0,1],reopened:1,probe:latestProbe,passed:true});await shot(popup,'popup-reopened-bilingual-2x');
    currentCase = 'options-sync';const options = await open(`${origin}/options.html#settings-general`,{width:1440,height:960});
    const modes = options.getByRole('radiogroup',{name:'翻译模式',exact:true});await modes.waitFor();await modes.getByRole('radio',{name:'仅译文模式',exact:true}).click();await closePage(options);await saved('display',0);
    await until(async () => await toggle().getAttribute('data-display-mode') === 'translation-only','options to popup sync');report.crossPageSync = true;report.persistenceCases.push({name:'options change then immediate close synchronizes existing popup',reopened:0,passed:true});
    await toggle().click();await saved('display',1);
    currentCase = 'google-guard';await patch({service:'google'});await until(async () => await toggle().isDisabled(),'Google guard');assert.match(await toggle().getAttribute('title'),/谷歌|Google/u);await shot(popup,'popup-google-disabled-2x');await patch({service});await until(async () => !await toggle().isDisabled(),'custom service enabled');
    report.cases.push({name:'Google website service exposes disabled mode shortcut with explanation',passed:true});
    currentCase = 'diagnostic';await closePage(popup);
    for (const touch of [false,true]) {popup = await openPopup({diagnostic:true,touch});await geometry(popup,touch?'diagnostic-touch':'diagnostic-desktop',touch);await popup.locator('[data-diagnostic-details-toggle]').click();await popup.locator('[data-diagnostic-details]').waitFor();
      const panel = await popup.locator('[data-diagnostic-details]').evaluate(node => {const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};});
      assert(panel.left >= -1 && panel.right <= panel.width + 1 && panel.top >= -1 && panel.bottom <= panel.height + 1,`diagnostic outside popup: ${JSON.stringify(panel)}`);report.layout[touch?'diagnostic-panel-touch':'diagnostic-panel-desktop']=panel;
      await shot(popup,touch?'popup-diagnostic-touch-2x':'popup-diagnostic-2x');await popup.keyboard.press('Escape');await popup.locator('[data-diagnostic-details]').waitFor({state:'hidden'});await closePage(popup);}
    report.cases.push({name:'diagnostic and mode icons coexist; desktop/touch popover remains within popup and closes with Escape',passed:true});
    currentCase = 'existing-translations';popup = await openPopup();await content.evaluate(() => {globalThis.__originalFixtureText = document.querySelector('#primary').firstChild;});await popup.locator('[data-testid="page-translation"]').click();await content.locator('#primary .fluent-read-bilingual-content').waitFor();
    await until(async () => (await content.locator('#primary').innerText()).includes(TRANSLATION),'local translated text');const requestCount = report.requests.length;assert(requestCount > 0);
    const before = await content.locator('#primary').innerText();assert(before.includes(SOURCE) && before.includes(TRANSLATION));await shot(content,'page-bilingual');
    await toggle().click();await saved('display',0);await until(async () => {const slots=await singlePresentation();return slots.length > 0 && slots.every(slot => slot.closed) && slots.map(slot=>slot.source).join('')===SOURCE && slots.map(slot=>slot.translation).join('')===TRANSLATION;},'existing page switches to translation only');
    assert.equal(await content.locator('#primary .fluent-read-bilingual-content').count(),0);assert(await content.evaluate(() => document.querySelector('#primary').contains(globalThis.__originalFixtureText)));
    assert.equal(report.requests.length,requestCount,'mode switch must not request translation');await shot(content,'page-translation-only');
    await toggle().click();await saved('display',1);await until(async () => {const text=await content.locator('#primary').innerText();return text.includes(SOURCE) && text.includes(TRANSLATION);},'existing page restores bilingual');assert.equal(report.requests.length,requestCount);
    await popup.locator('[data-testid="page-translation"]').click();await content.locator('#primary .fluent-read-bilingual-content').waitFor({state:'detached'});assert.equal(await content.locator('#primary').innerText(),SOURCE);assert.equal(report.requests.length,requestCount);assert(await content.evaluate(() => document.querySelector('#primary').firstChild===globalThis.__originalFixtureText));await shot(content,'page-restored');
    report.cases.push({name:'real translation -> only translation -> bilingual -> restore keeps original text and makes no extra provider calls',passed:true,providerRequests:requestCount});
    currentCase = 'final-presentation';await closePage(popup);await saved('count',2029);await patch({service:'bilibili',theme:'light',uiLanguage:'zh-CN',display:1,selectionTranslatorMode:'bilingual',disableSelectionTranslator:false,disableImageTranslator:false});popup=await openPopup();
    await geometry(popup,'final-bilingual');await shot(popup,'popup-final-bilingual-2x');await toggle().click();await saved('display',0);await shot(popup,'popup-final-translation-only-2x');await toggle().click();await saved('display',1);
    focusSafe();assert.deepEqual(report.consoleErrors,[]);report.ok=true;
  } catch (error) {report.failure={case:currentCase,message:error.message,stack:error.stack};if(popup && !popup.isClosed()) await shot(popup,'failure').catch(() => {});process.exitCode=1;}
  finally {
    cleanupStarted=true;report.cleanupStartedAt=new Date().toISOString();save();
    if(launched) {try{await closeNativeBrowser();}catch(error){report.cleanupErrors.push(`Native normal close: ${error.message}`);report.ok=false;process.exitCode=1;}
      try {stage('cleanup:guarded-pid-gone-verification');await launched.close();report.browserClosed=true;report.ownedBrowserGoneReceipt=true;stage('cleanup:guarded-pid-gone-confirmed');}catch(error){report.cleanupErrors.push(error.message);report.ok=false;process.exitCode=1;}}
    if(monitor) try {await monitor.stop();focusSafe();report.focusObserverClosed=true;}catch(error){report.cleanupErrors.push(error.message);report.ok=false;process.exitCode=1;}
    await new Promise(resolve => server.close(resolve));
    if(!report.cleanupErrors.length)fs.rmSync(profileDir,{recursive:true,force:true});
    report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({ok:report.ok,case:report.failure?.case,error:report.failure?.message,artifactsDir,cases:report.cases.length,persistenceCases:report.persistenceCases.length,consoleErrors:report.consoleErrors.length,focusActivations:report.focusEvents.filter(event=>event.pid===browserPid).length}));
  }
})();

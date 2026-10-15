#!/usr/bin/env node
'use strict';
// 移动划词生产产物专项。桌面 Edge 中使用可信 CDP 触摸 + DOM Range 夹具；键盘偏移、后台事件由隔离世界显式模拟。
// 不测试原生 iOS/Android 选区菜单或真实软键盘；仅启动临时 profile，第二屏正常窗口且不抢焦点。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {guardBrowserClose, getGuardedBrowserPid} = require('./testing/owned-browser-close.cjs');
const support = require('./run-selection-trigger-test.cjs');
const arg = key => {const index = process.argv.indexOf(`--${key}`); if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing --${key}`); return process.argv[index + 1];};
const output = path.resolve(arg('artifacts-dir'));
const extensionDir = path.resolve(arg('extension-dir'));
const helper = require(path.resolve(arg('focus-safe-helper')));
const {chromium} = createRequire(path.join(arg('playwright-root'), 'package.json'))('playwright');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sentence = 'Good ideas deserve careful attention.';
const translation = '好的想法值得认真关注。';
const report = {ok: false, cases: [], screenshots: [], consoleErrors: [], translationRequests: 0,
  evidence: 'Production extension in isolated desktop Edge. Trusted CDP touch plus fixture DOM Range; visual viewport/visibility/pagehide are explicitly mocked in the extension isolated world. No native mobile long-press, keyboard, device, Safari or live-provider acceptance claim.'};
let session, context, page, server, worldId, cdp, focusMonitor, browserPid, focusFailure, focusTimer;
let cleanupStarted = false;
const contexts = new Map();
const cls = name => node => support.hasCdpClass(node, name);
async function node(predicate) {const {root} = await support.getSelectionUiTree(page); return support.findCdpNode(root, predicate);}
async function until(predicate, label) {for (let index = 0; index < 80; index++) {if (focusFailure) throw focusFailure; if (await predicate()) return; await pause(100);} throw new Error(label);}
function record(name, evidence = {}) {report.cases.push({name, ...evidence}); process.stdout.write(`PASS ${name}\n`);}
async function screenshot(name) {const file = path.join(output, `${name}.png`); await page.screenshot({path: file, fullPage: false}); report.screenshots.push(file);}
function failFocus(error) {
  focusFailure ||= error;
  report.ok = false; report.focusError = String(focusFailure.stack || focusFailure);
  fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  // 发生实际抢焦点或失去监控时立即关闭本次拥有的浏览器，不继续输入。
  if (!cleanupStarted) void session?.close().catch(closeError => {report.asynchronousCloseError = String(closeError);});
}
async function checkFocus() {
  if (focusFailure) throw focusFailure;
  if (focusMonitor.error) throw focusMonitor.error;
  const front = await helper.queryMacFrontmostApplication();
  (report.focusSamples ||= []).push({at: Date.now(), name: front?.name, pid: front?.pid});
  assert(front && front.pid !== browserPid, 'Owned test browser must stay outside the foreground');
}
async function inspect(predicate, source) {
  const {session: dom, root} = await support.getSelectionUiTree(page);
  const target = support.findCdpNode(root, predicate); assert(target, 'UI node missing');
  const {object} = await dom.send('DOM.resolveNode', {nodeId: target.nodeId});
  const result = await dom.send('Runtime.callFunctionOn', {objectId: object.objectId, functionDeclaration: source, returnByValue: true});
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
const geometry = predicate => inspect(predicate, 'function(){const b=this.getBoundingClientRect(); return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height}}');
async function isolated(expression) {
  if (!worldId) {
    for (const [id, info] of contexts) {
      if (info.auxData?.isDefault) continue;
      const found = await cdp.send('Runtime.evaluate', {contextId: id, expression: 'typeof chrome !== "undefined" ? chrome.runtime?.id : null', returnByValue: true}).catch(() => null);
      if (found?.result?.value === report.extensionId) {worldId = id; break;}
    }
    assert(worldId, 'Extension isolated world unavailable; viewport/visibility mock cannot run');
  }
  const result = await cdp.send('Runtime.evaluate', {contextId: worldId, expression, returnByValue: true, awaitPromise: true});
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function touch(type, x, y) {await cdp.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{x, y, id: 1, radiusX: 1, radiusY: 1, force: 1}]});}
async function tap(predicate) {
  const box = await geometry(predicate), x = box.left + box.width / 2, y = box.top + box.height / 2;
  await touch('touchStart', x, y); await touch('touchEnd', x, y);
}
async function select(text = sentence) {
  await helper.activateExtensionTabWithoutForeground(context, page);
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await page.locator('#target').evaluate((element, text) => {element.textContent = text;}, text);
  const box = await page.locator('#target').boundingBox();
  await touch('touchStart', box.x + 8, box.y + 12);
  await touch('touchEnd', box.x + 8, box.y + 12);
  // 在原生 tap 默认动作之后设置明确的夹具 Range，避免把 DOM 选区称为原生长按验收。
  await page.evaluate(() => {const range = document.createRange(); range.selectNodeContents(document.querySelector('#target')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);});
  await until(() => node(cls('fr-selection-indicator')), 'Touch selection entry did not appear');
}
async function translated() {await until(async () => support.cdpText(await node(cls('fr-translation-tooltip'))).includes(translation), 'Translation card did not finish');}
async function viewport(bounds) {
  await isolated(`(() => {const viewport=window.visualViewport; for(const [key,value] of Object.entries(${JSON.stringify(bounds)})) Object.defineProperty(viewport,key,{configurable:true,get:()=>value}); viewport.dispatchEvent(new Event('resize')); return true;})()`);
  await pause(160);
}
async function main() {
  fs.mkdirSync(output, {recursive: true});
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-mobile-selection-'));
  let browserClosed = false;
  try {
    assert.equal(typeof helper.startFocusEventMonitor, 'function', 'Use the repository focus-safe helper with native focus monitoring');
    focusMonitor = helper.startFocusEventMonitor({onEvent(event) {
      report.focusEvents = [...(focusMonitor?.events || [])];
      if (!cleanupStarted && browserPid && event.pid === browserPid) failFocus(new Error('Owned test browser activated during native focus observation'));
    }, onError: error => {if (!cleanupStarted) failFocus(error);}});
    let readyTimer;
    try {
      report.focusObserver = await Promise.race([focusMonitor.ready, new Promise((resolve, reject) => {
        readyTimer = setTimeout(() => reject(new Error('Native focus observer did not become ready')), 35000);
      })]);
    } finally {clearTimeout(readyTimer);}
    server = http.createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      report.translationRequests += 1;
      const texts = JSON.parse(body);
      res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(texts.map(() => ({translations: [{text: translation, to: 'zh-Hans'}]}))));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir: profile,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true, headless: false,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check', '--mute-audio'],
      viewport: {width: 1280, height: 900}});
    guardBrowserClose(session, profile);
    context = session.context;
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement, profileMode: 'temporary-isolated', extensionDir});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    browserPid = await getGuardedBrowserPid(session); report.browserPid = browserPid;
    assert(!focusMonitor.events.some(event => event.pid === browserPid), 'Owned browser must not become foreground during launch');
    await checkFocus();
    let checkingFocus = false;
    focusTimer = setInterval(() => {
      if (checkingFocus || cleanupStarted) return;
      checkingFocus = true;
      void checkFocus().catch(failFocus).finally(() => {checkingFocus = false;});
    }, 500);
    const {worker, extensionId} = await support.waitForWorker(context); report.extensionId = extensionId;
    const popup = await helper.newPageWithoutForeground(context);
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
    const current = await support.readStoredConfig(popup);
    await support.patchStoredConfig(popup, {on: true, disableSelectionTranslator: false, selectionTranslatorMode: 'bilingual', selectionTranslatorTrigger: 'icon', selectionTranslatorDelay: 0,
      selectionTranslatorAutoDismiss: false, theme: 'light', useCache: false, service: 'microsoft', from: 'auto', to: 'zh-Hans',
      hotkey: 'none', floatingBallHotkey: 'none', vocabularyBookEnabled: false, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, harness: {...current.harness, enabled: false}});
    await worker.evaluate(url => {const native = fetch.bind(globalThis); globalThis.fetch = (input, init) => String(input).startsWith('https://edge.microsoft.com/translate/translatetext') ? native(url, init) : native(input, init);}, `http://127.0.0.1:${server.address().port}/translate`);
    await context.route('https://example.com/fluentread-mobile-selection', route => route.fulfill({contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mobile selection fixture</title><style>body{margin:24px;font:18px/1.7 system-ui;color:#293247;background:#f3f6fa}h1{font-size:23px;margin:0 0 14px}p{margin:0 0 30px;overflow-wrap:anywhere}#target{margin-top:100px}aside{font-size:12px;color:#687386}button{font:inherit}</style></head><body><h1>移动划词 · 浏览器夹具</h1><aside>可信触摸输入 + DOM 选区夹具。键盘和后台条件显式模拟；不代表移动设备验收。</aside><p id="target">${sentence}</p><p id="neighbor">The original page remains readable.</p><div style="height:900px"></div></body></html>`}));
    page = await helper.newPageWithoutForeground(context);
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    cdp = await context.newCDPSession(page);
    cdp.on('Runtime.executionContextCreated', ({context: info}) => contexts.set(info.id, info));
    cdp.on('Runtime.executionContextsCleared', () => {contexts.clear(); worldId = undefined;});
    cdp.on('Runtime.executionContextDestroyed', ({executionContextId}) => {contexts.delete(executionContextId); if (worldId === executionContextId) worldId = undefined;});
    await cdp.send('Runtime.enable');
    await page.setViewportSize({width: 390, height: 780});
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 1});
    await page.goto('https://example.com/fluentread-mobile-selection');
    await page.locator('#fluent-read-selection-translator-container').waitFor({state: 'attached'});
    await select();
    let bounds = await geometry(cls('fr-selection-indicator'));
    assert(bounds.width >= 44 && bounds.height >= 44, 'Touch entry is smaller than 44px');
    assert(bounds.left >= 0 && bounds.right <= 390 && bounds.bottom <= 780);
    await screenshot('01-touch-entry-390-light');
    const before = await page.evaluate(() => getSelection().toString());
    await tap(cls('fr-selection-indicator')); await translated();
    assert.equal(await page.evaluate(() => getSelection().toString()), before, 'Tapping entry collapsed the native selection');
    const targets = await inspect(cls('fr-translation-tooltip'), `function(){return [...this.querySelectorAll('button')].filter(button=>button.getClientRects().length).map(button=>{const b=button.getBoundingClientRect();return {label:button.ariaLabel||button.textContent.trim(),width:b.width,height:b.height}})}`);
    assert(targets.every(target => target.width >= 44 && target.height >= 44), `Undersized touch target: ${JSON.stringify(targets)}`);
    await screenshot('02-card-390-light'); record('touch entry is 44px, tapping preserves native selection, and visible card actions are at least 44px', {targets});
    await viewport({width: 390, height: 320, offsetLeft: 0, offsetTop: 140});
    bounds = await geometry(cls('fr-translation-tooltip'));
    assert(bounds.top >= 151 && bounds.bottom <= 449 && bounds.left >= 11 && bounds.right <= 379, JSON.stringify(bounds));
    await screenshot('03-mocked-keyboard-viewport-offset'); record('mocked software keyboard viewport keeps the card inside the visible offset bounds', {bounds, viewport: {left: 0, top: 140, width: 390, height: 320}, mocked: true});
    await isolated(`(() => {for(const key of ['width','height','offsetLeft','offsetTop']) delete window.visualViewport[key]; window.visualViewport.dispatchEvent(new Event('resize'));})()`);
    await page.setViewportSize({width: 780, height: 390}); await pause(180);
    bounds = await geometry(cls('fr-translation-tooltip'));
    assert(bounds.top >= 11 && bounds.bottom <= 379 && bounds.right <= 769);
    await screenshot('04-landscape-viewport'); record('landscape viewport clamps existing card and retains its content', {bounds, emulated: true});
    await page.setViewportSize({width: 320, height: 700});
    await support.patchStoredConfig(popup, {theme: 'dark'}); await pause(200);
    await until(() => node(cls('fr-dark-theme')), 'Dark theme did not reach content card');
    bounds = await geometry(cls('fr-translation-tooltip'));
    assert(bounds.left >= 11 && bounds.right <= 309);
    await screenshot('05-card-320-dark'); record('320px dark card retains fixed close action and fits horizontally', {bounds, emulated: true});
    await tap(cls('fr-close-btn')); await pause(500);
    assert.equal(await node(cls('fr-translation-tooltip')), null);
    assert.equal(await node(cls('fr-selection-indicator')), null);
    record('explicit close remains closed despite native selection remaining');
    await select('Good ideas deserve attention.'); await tap(cls('fr-selection-indicator')); await translated();
    await isolated(`Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'}); document.dispatchEvent(new Event('visibilitychange'));`);
    await isolated(`Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'}); document.dispatchEvent(new Event('visibilitychange'));`);
    await pause(180); assert(await node(cls('fr-translation-tooltip')));
    await screenshot('06-mocked-background-resume'); record('mocked background return keeps a valid explicitly opened card', {mocked: true});
    await page.locator('#target').evaluate(element => element.remove());
    await isolated(`document.dispatchEvent(new Event('visibilitychange'));`); await pause(180);
    assert.equal(await node(cls('fr-translation-tooltip')), null); record('mocked restore removes a card whose source Range was detached', {mocked: true});
    await page.reload(); await page.locator('#fluent-read-selection-translator-container').waitFor({state: 'attached'});
    await select('A fresh selection after navigation.'); await tap(cls('fr-selection-indicator')); await translated();
    await isolated(`window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));`); await pause(180);
    assert.equal(await node(cls('fr-translation-tooltip')), null);
    await isolated(`window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));`); await pause(350);
    assert.equal(await node(cls('fr-selection-indicator')), null); record('mocked bfcache pagehide clears the old card and pageshow does not reopen it', {mocked: true});
    assert.equal(report.consoleErrors.length, 0);
    // 重新调用焦点安全 helper 验证本次拥有的窗口仍位于合法显示器范围且未成为前台。
    const finalPage = await helper.newPageWithoutForeground(context); await finalPage.close();
    report.windowPlacement = session.windowPlacement;
    assert.equal(report.windowPlacement.browserFrontmost, false);
    await checkFocus();
    report.ok = true;
  } catch (error) {
    report.error = String((focusFailure || error).stack || focusFailure || error);
    if (!focusFailure && page && !page.isClosed()) await screenshot('failure').catch(() => undefined);
    process.exitCode = 1;
  } finally {
    cleanupStarted = true;
    clearInterval(focusTimer);
    try {if (session) {await session.close(); browserClosed = true;}}
    catch (error) {report.ok = false; report.cleanupError = String(error.stack || error); process.exitCode = 1;}
    if (server) await new Promise(resolve => {server.close(resolve); server.closeAllConnections();});
    if (browserClosed || !session) fs.rmSync(profile, {recursive: true, force: true});
    else report.retainedProfile = profile;
    if (focusMonitor) {
      try {await focusMonitor.stop();}
      catch (error) {report.ok = false; report.focusObserverCleanupError = String(error); process.exitCode = 1;}
      report.focusEvents = [...focusMonitor.events];
    }
    fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}
main().catch(error => {process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;});

'use strict';
/** 区域记忆生产专项：复用隔离 Edge、焦点事件监控、真实 CDP 指针键盘与确定性翻译传输；覆盖用户保存、重访自动补齐、恢复暂停、提醒、路径/SPA隔离与设置持久化。 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const projectRoot = path.resolve(arg('project-root', path.join(__dirname, '../..')));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-section-rules'));
const playwrightRoot = arg('playwright-root');
const helper = arg('focus-safe-helper');
if (!playwrightRoot || !helper) throw new Error('必须提供 --playwright-root 和 --focus-safe-helper');
const {chromium} = require(path.join(playwrightRoot, 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(helper);
const {startFocusEventMonitor} = require('./mac-focus-event-monitor.cjs');
const {getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
fs.mkdirSync(artifacts, {recursive: true});
const temporaryRoot = fs.realpathSync(os.tmpdir());
const profileDir = fs.mkdtempSync(path.join(temporaryRoot, 'fluentread-section-rules-'));
const profileIdentity = fs.lstatSync(profileDir);
const owner = crypto.randomUUID();
fs.writeFileSync(path.join(profileDir, '.owner'), owner, {flag: 'wx'});
const report = {scope: 'production extension, trusted CDP pointer/keyboard gestures, deterministic Google transport; not live provider latency or quality', sourceProjectRoot: projectRoot, cases: [], screenshots: [], errors: [], consoleErrors: [], errorCoverage: 'errors contains uncaught page exceptions; console.error messages are recorded separately, including intentionally failed fixture requests', profileMode: 'automatically-created-temporary-profile'};

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Remembered area fixture</title><style>
body{font:16px/1.6 system-ui;margin:0;background:#fff;color:#172033}.layout{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:24px;max-width:1100px;margin:auto;padding:32px}article,aside{border:1px solid #d0d7de;border-radius:10px;padding:24px}h1{font-size:24px}p{margin:16px 0}aside{align-self:start}button{font:inherit}@media(max-width:600px){.layout{grid-template-columns:minmax(0,1fr);padding:16px}article,aside{min-width:0}}
</style></head><body><div class="layout"><article id="target"><h1 id="title">Read only the content you care about</h1><p id="p1">FluentRead remembers the selected article across pages in the same directory.</p><p id="p2">Saved areas must preserve original text and retain every completed translation.</p></article><aside id="outside"><h2>Outside the chosen area</h2><p id="outside-text">This sidebar must remain original and send no translation request.</p></aside></div></body></html>`;

const server = http.createServer((request, response) => {response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html);});
let launched, page, popup, worker, cdp, tabId, focusMonitor, browserPid, focusError, failureSurface, currentCase = 'launch', currentAction = 'launch', traceCount = 0, launchAttempted = false, sequence = 0;
const focusDiagnostic = path.join(artifacts, 'focus-diagnostic.private.jsonl');
report.focusDiagnostic = focusDiagnostic;
function privateFocusRecord(record) {
  fs.appendFileSync(focusDiagnostic, `${JSON.stringify({wallTimeMs: Date.now(), case: currentCase, action: currentAction, ...record})}\n`, {mode: 0o600});
}
function noteAction(action) {
  currentAction = action;
  if (traceCount++ < 2000) privateFocusRecord({kind: 'action'});
}
function tracePageActions(target, label) {
  for (const [surface, names] of [[target.keyboard, ['press', 'down', 'up']], [target.mouse, ['move', 'click']], [target, ['evaluate']]]) {
    for (const name of names) {
      const original = surface[name].bind(surface);
      surface[name] = (...args) => {noteAction(`${label}.${name}: ${String(args[0]).slice(0, 160)}`); return original(...args);};
    }
  }
}

function assertFocusSafe() {
  if (focusError || focusMonitor?.error) throw focusError || focusMonitor.error;
  if (browserPid && focusMonitor?.events.some(event => event.pid === browserPid)) throw new Error('测试 Edge 在专项期间成为前台应用；测试已停止');
}

async function patch(values) {
  noteAction(`configuration patch: ${Object.keys(values).join(',')}`);
  await popup.evaluate(async ({values, sequence}) => {
    const {value: current} = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    const response = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: values,
      expected: Object.fromEntries(Object.keys(values).map(k => [k, current[k]])), clientId: 'section-fixture', sequence, baseRevision: current.__fluentConfigRevision || 0});
    if (!response.success) throw new Error(response.error);
  }, {values, sequence: ++sequence});
}
/** 在封闭 Shadow Root 内执行只读查询；网页脚本本身无法读取该浮层。 */
async function shadowUi(kind, code) {
  const tree = await cdp.send('DOM.getDocument', {depth: -1, pierce: true});
  let host;
  const visit = node => {
    const a = node.attributes || [];
    for (let i = 0; i < a.length; i += 2) if (a[i] === 'data-fluent-read-ui' && a[i + 1] === kind) host = node;
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) visit(child);
  };
  visit(tree.root);
  if (!host?.shadowRoots?.[0]) return null;
  const {object} = await cdp.send('DOM.resolveNode', {nodeId: host.shadowRoots[0].nodeId});
  try {
    const result = await cdp.send('Runtime.callFunctionOn', {objectId: object.objectId, functionDeclaration: `function(){${code}}`, returnByValue: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  } finally {await cdp.send('Runtime.releaseObject', {objectId: object.objectId});}
}
const picker = code => shadowUi('section-picker', code);
const reminder = code => shadowUi('section-reminder', code);
async function wait(test, timeout = 20000, label = currentCase) {
  noteAction(`wait: ${label}`);
  const until = Date.now() + timeout;
  while (Date.now() < until) {assertFocusSafe(); if (await test()) return; await page.waitForTimeout(60);}
  throw new Error(`${label}: 等待超时`);
}
const pickerState = () => picker(`const box=this.querySelector('.fr-section-box'),r=box.getBoundingClientRect();return{visible:box.classList.contains('is-visible'),rect:{x:r.x,y:r.y,width:r.width,height:r.height},action:this.querySelector('.fr-section-label-action')?.textContent,meta:this.querySelector('.fr-section-label-meta')?.textContent,bar:this.querySelector('.fr-section-bar')?.textContent,selection:this.host.getAttribute('data-selection-state'),preview:this.querySelector('.fr-section-bar-preview')?.textContent,confirmDisabled:this.querySelector('.fr-section-confirm')?.disabled}`);
const pickerActive = async () => (await page.locator('[data-fluent-read-ui="section-picker"]').count()) > 0 && Boolean(await picker('return !this.querySelector(".fr-section-bar.is-hidden")'));
async function startFromPopupMessage() {
  noteAction('extension message: start section picker');
  const response = await popup.evaluate(tab => chrome.tabs.sendMessage(tab, {type: 'contextMenuTranslate', action: 'section'}), tabId);
  assert.deepEqual(response, {status: 'success'});
  await wait(pickerActive);
}
async function center(selector) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, selector);
  return {x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 12)};
}
async function hover(selector) {
  // 选择模式中滚动是原生的；先把目标滚进视口，再用真实指针移过去。
  await page.locator(selector).scrollIntoViewIfNeeded();
  const point = await center(selector);
  await page.mouse.move(point.x, point.y, {steps: 4});
  await page.waitForTimeout(220);
  return point;
}
async function clickPickerButton(selector) {
  const point = await picker(`const b=this.querySelector(${JSON.stringify(selector)});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,disabled:b.disabled,visible:r.width>0&&r.height>0}`);
  assert(point && point.visible && !point.disabled, `visible enabled picker button: ${selector}`);
  await page.mouse.click(point.x, point.y);
}
async function waitLabel(pattern, meta) {
  await wait(async () => {const state = await pickerState(); return state?.visible && pattern.test(state.action || '') && (!meta || state.meta === meta);}, 8000, `${currentCase}: 标签 ${pattern}`);
  return pickerState();
}
const translationCount = selector => page.evaluate(s => [...document.querySelectorAll(s)].filter(n => n.querySelector('.fluent-read-bilingual-content')).length, selector);
const hasTranslation = selector => page.evaluate(s => Boolean(document.querySelector(s)?.querySelector('.fluent-read-bilingual-content')), selector);
// 页面框架内的文字按界面控件处理，译文原位替换文本节点而不是追加双语块，因此按可见文字判断。
const showsTranslation = selector => page.evaluate(s => document.querySelector(s)?.textContent.includes('【译】') === true, selector);
async function shot(name) {const target = path.join(artifacts, `${name}.png`); await page.screenshot({path: target}); report.screenshots.push(target);}
async function saveDom(name,content) {const file=path.join(artifacts,`${name}.html`);fs.writeFileSync(file,content);(report.domEvidence??=[]).push(file);}
async function clipShot(target,name,rect) {
  const viewport=await target.evaluate(()=>({width:innerWidth,height:innerHeight})),x=Math.max(0,rect.left-12),y=Math.max(0,rect.top-12);
  const clip={x,y,width:Math.min(viewport.width,rect.right+12)-x,height:Math.min(viewport.height,rect.bottom+12)-y};
  assert.ok(clip.width>0&&clip.height>0,JSON.stringify({name,rect,clip}));
  const file=path.join(artifacts,`${name}.png`);await target.screenshot({path:file,clip});
  report.screenshots.push(file);(report.nativeClips??=[]).push({file,clip});
}
async function noticeText() {return page.evaluate(() => document.querySelector('#fluent-read-page-notice-host')?.shadowRoot?.textContent || '');}
const layoutRead = `const box=node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
const visible=node=>node.getBoundingClientRect().width>0&&getComputedStyle(node).visibility!=='hidden';`;
async function pickerLayout() {
  return picker(`${layoutRead}
    const bar=this.querySelector('.fr-section-bar'),confirm=this.querySelector('.fr-section-confirm');
    const remember=this.querySelector('.fr-section-remember'),actions=this.querySelector('.fr-section-bar-actions');
    return{viewport:innerWidth,bar:box(bar),remember:this.querySelector('.fr-section-remember-checkbox').checked,
      rememberRow:box(remember),actionsRow:box(actions),rememberBeforeActions:Boolean(remember.compareDocumentPosition(actions)&Node.DOCUMENT_POSITION_FOLLOWING),
      redundantContent:this.querySelectorAll('.fr-section-bar-preview,.fr-section-bar-keys').length,
      visibleTitle:visible(this.querySelector('.fr-section-bar-title')),visibleAddress:box(this.querySelector('.fr-section-remember-address')),
      visibleFieldHeadings:this.querySelectorAll('.fr-section-remember-field>span').length,
      controls:[...bar.querySelectorAll('button,input,select')].filter(visible).map(node=>({...box(node),tag:node.tagName,text:node.tagName==='SELECT'?node.selectedOptions[0]?.textContent:node.textContent,aria:node.getAttribute('aria-label'),clipped:node.tagName==='BUTTON'&&node.scrollWidth>node.clientWidth+1})),
      confirmation:{...box(confirm),text:confirm.textContent,fontWeight:getComputedStyle(confirm).fontWeight}}`);
}
function assertCompactPicker(layout) {
  assert.ok(layout && layout.bar.left >= 0 && layout.bar.right <= layout.viewport, JSON.stringify(layout));
  assert.ok(layout.bar.height <= 220, `picker remains a compact control surface: ${JSON.stringify(layout)}`);
  assert.equal(layout.redundantContent, 0, 'picker omits body preview and permanent shortcut tutorial');
  assert.equal(layout.visibleTitle, false, 'locked selection summary replaces the repeated title');
  assert.equal(layout.visibleFieldHeadings, 0, 'selects keep accessible labels without repeated visible headings');
  assert.ok(layout.rememberBeforeActions&&layout.rememberRow.bottom<=layout.actionsRow.top+1,'remember choices precede the main confirmation in DOM and visual order');
  assert.ok(layout.controls.every(control => control.left >= layout.bar.left && control.right <= layout.bar.right && !control.clipped), JSON.stringify(layout));
  for (let a = 0; a < layout.controls.length; a++) for (let b = a + 1; b < layout.controls.length; b++) {
    const x = layout.controls[a], y = layout.controls[b];
    assert.ok(Math.min(x.right, y.right) - Math.max(x.left, y.left) <= 1 || Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) <= 1, `picker controls do not overlap: ${JSON.stringify({x,y})}`);
  }
  assert.ok(Number(layout.confirmation.fontWeight) >= 600 && layout.confirmation.height >= 32, 'confirmation retains the strongest action treatment');
}
async function rulesLayout(target) {
  return target.evaluate(() => {
    const box = node => {const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const row=document.querySelector('.rule-row'),mode=row.querySelector('.rule-mode'),modeLabel=mode.querySelector('.el-select__selected-item span'),textRange=document.createRange();
    textRange.selectNodeContents(modeLabel);
    return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,row:box(row),main:box(row.querySelector('.rule-main')),toggle:box(row.querySelector('.el-switch')),
      mode:{...box(mode),label:modeLabel.textContent,labelLines:[...textRange.getClientRects()].filter(rect=>rect.width>0).length},
      redundantContent:row.querySelectorAll('details,code,.rule-profile-missing').length,headingCount:document.querySelectorAll('.rules-heading h3 span,.rules-heading p').length,
      controls:[...row.querySelectorAll('button,.el-switch,.rule-mode')].map(node=>({...box(node),text:node.textContent,clipped:node.tagName==='BUTTON'&&[...node.querySelectorAll('span')].some(span=>span.scrollWidth>span.clientWidth+1)}))};
  });
}
function assertCompactRules(layout) {
  assert.ok(layout.scrollWidth <= layout.viewport, JSON.stringify(layout));
  assert.ok(layout.row.left >= 0 && layout.row.right <= layout.viewport, JSON.stringify(layout));
  assert.equal(layout.mode.labelLines,1,`next-visit action remains a readable single line: ${JSON.stringify(layout.mode)}`);
  assert.ok(layout.row.height <= 120, `list keeps only the site and direct actions: ${JSON.stringify(layout)}`);
  assert.equal(layout.redundantContent, 0, 'CSS paths and missing-profile details stay out of the list');
  assert.equal(layout.headingCount, 0, 'no capacity counter or permanent tutorial');
  assert.ok(layout.main.left >= layout.toggle.right + 4, `website and switch must not overlap: ${JSON.stringify(layout)}`);
  assert.ok(layout.controls.every(control=>control.left>=0&&control.right<=layout.viewport&&!control.clipped), JSON.stringify(layout));
  for(let a=0;a<layout.controls.length;a++) for(let b=a+1;b<layout.controls.length;b++) {
    const x=layout.controls[a],y=layout.controls[b];
    assert.ok(Math.min(x.right,y.right)-Math.max(x.left,y.left)<=1||Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)<=1,`settings controls do not overlap: ${JSON.stringify({x,y})}`);
  }
}

(async () => {
  report.buildFreshness = assertFreshProductionExtension(extensionDir, projectRoot);
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  focusMonitor = startFocusEventMonitor({onEvent: event => {
    if (browserPid && event.pid === browserPid) {
      privateFocusRecord({kind: 'owned-browser-activation', ownedPid: browserPid, eventTime: event.time, eventMonotonicMs: event.monotonicMs});
      focusError = new Error('测试 Edge 在专项期间成为前台应用；测试已停止');
    }
  }, onError: error => {focusError = error;}});
  await focusMonitor.ready;
  launchAttempted = true;
  launched = await launchFocusSafePersistentContext({chromium, profileDir,
    browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'), headless: false, background: true, displayTarget: arg('display', 'secondary'),
    browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'], viewport: {width: 1280, height: 900}, timeout: 30000});
  Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
  assert.equal(report.launchMode, 'macos-background-cdp'); assert.equal(report.focusPolicy, 'launchservices-no-foreground'); assert.equal(report.windowPlacement.browserFrontmost, false);
  const context = launched.context;
  const browserSession = await context.browser().newBrowserCDPSession();
  try {
    const {processInfo} = await browserSession.send('SystemInfo.getProcessInfo');
    browserPid = processInfo.find(process => process.type === 'browser')?.id;
    assert.ok(browserPid, 'focus observer has the owned browser PID');
    const guardedPid = await getGuardedBrowserPid(launched);
    assert.equal(browserPid, guardedPid, 'focus observer PID matches the ownership guard and current CDP browser');
    privateFocusRecord({kind: 'owned-browser-identity', ownedPid: browserPid, guardedPid, cdpPid: browserPid});
    for (const event of focusMonitor.events.filter(event => event.pid === browserPid)) privateFocusRecord({kind: 'owned-browser-activation-before-identity', ownedPid: browserPid, eventTime: event.time, eventMonotonicMs: event.monotonicMs});
  } finally {await browserSession.detach();}
  assertFocusSafe();
  worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  popup = await newPageWithoutForeground(context, 30000);
  await popup.setViewportSize({width: 400, height: 760});
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await patch({on: true, useCache: false, sectionTranslationRules: [], autoTranslate: false, alwaysTranslateDomains: [], service: 'google', from: 'auto', to: 'zh-Hans', display: 1, disableFloatingBall: true, disableSelectionTranslator: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true});
  await worker.evaluate(() => {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.__sectionFixture = {origins: [], requests: [], transports: [], delayMs: 60, failureMatch: '', active: 0, maxActive: 0};
    const settleFixture = async (origins) => {
      const fixture = globalThis.__sectionFixture;
      const entry = {origins, startedAt: performance.now(), delayMs: fixture.delayMs, failed: Boolean(fixture.failureMatch && origins.some(text => text.includes(fixture.failureMatch)))};
      fixture.transports.push(entry);
      fixture.active += 1;
      fixture.maxActive = Math.max(fixture.maxActive, fixture.active);
      try {
        await new Promise(resolve => setTimeout(resolve, entry.delayMs));
        return entry.failed;
      } finally {entry.finishedAt = performance.now(); fixture.active -= 1;}
    };
    globalThis.fetch = async (input, options) => {
      const url = String(typeof input === 'string' ? input : input.url || input);
      const translateFixture = (origin, source, target) => {
        globalThis.__sectionFixture.origins.push(origin);
        globalThis.__sectionFixture.requests.push({origin, source, target, requestedAt: performance.now()});
        return origin.split(/(___FLUENTREAD_[A-Za-z0-9]+_\d+_(?:BEGIN|END)___)/)
          .map(part => part.startsWith('___FLUENTREAD_') || !part.trim() ? part : `【译】${part}`).join('');
      };
      if (url.includes('/v1/translateHtml')) {
        const [texts, source, target] = JSON.parse(options.body)[0];
        const translated = texts.map(text => `<pre>${translateFixture(text.replace(/^<pre>|<\/pre>$/g, ''), source, target)}</pre>`);
        if (await settleFixture(texts)) return new Response('Section fixture request intentionally rejected', {status: 400});
        return new Response(JSON.stringify([translated]), {status: 200});
      }
      if (url.includes('/translate_a/t')) {
        const parsed = new URL(url), body = new URLSearchParams(options.body);
        const translated = body.getAll('q').map(text => translateFixture(text, parsed.searchParams.get('sl'), parsed.searchParams.get('tl')));
        if (await settleFixture(body.getAll('q'))) return new Response('Section fixture request intentionally rejected', {status: 400});
        return new Response(JSON.stringify(translated), {status: 200});
      }
      if (url.includes('/_/TranslateWebserverUi/data/batchexecute')) {
        const origins = [];
        const records = JSON.parse(new URLSearchParams(options.body).get('f.req'))[0].map(rpc => {
          const [origin, source, target] = JSON.parse(rpc[1])[0];
          origins.push(origin);
          const entry = [null, null, null, null, null, [[translateFixture(origin, source, target)]]];
          return ['wrb.fr', 'MkEWBc', JSON.stringify([null, [[entry]]]), null, null, null, rpc[3]];
        });
        if (await settleFixture(origins)) return new Response('Section fixture request intentionally rejected', {status: 400});
        return new Response(JSON.stringify(records), {status: 200});
      }
      return original(input, options);
    };
  });

  currentCase = 'trusted picker saves the article with its default reminder; settings enables automatic mode';
  await popup.reload(); await popup.waitForSelector('[data-config-ready="true"]');
  page = await newPageWithoutForeground(context, 30000);
  failureSurface = page;
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({case: currentCase, message: message.text(), location: message.location()});});
  tracePageActions(page, 'fixturePage');
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/articles/first`); cdp = await context.newCDPSession(page);
  await activateExtensionTabWithoutForeground(context, page, 30000);
  tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url)?.id, page.url());
  assert.ok(tabId, 'fixture tab id');
  await page.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout: 20000});
  const requestCount = () => worker.evaluate(() => globalThis.__sectionFixture.requests.length);
  const readRules = () => popup.evaluate(async () => (await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'})).value.sectionTranslationRules);
  const countAll = () => page.locator('#target .fluent-read-bilingual-content').count();
  const assertOutsideOriginal = async () => {
    assert.equal(await hasTranslation('#outside'), false);
    assert.ok((await worker.evaluate(() => globalThis.__sectionFixture.origins)).every(text => !text.includes('This sidebar must remain original')), 'outside content never reaches provider');
  };
  const clickShadow = async (read, selector) => {
    const point = await read(`const node=this.querySelector(${JSON.stringify(selector)});if(!node)return null;const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,disabled:node.disabled}`);
    assert.ok(point && !point.disabled, `enabled shadow control: ${selector}`);
    await page.mouse.click(point.x, point.y);
  };
  const route = async pathname => { await page.evaluate(pathname => history.pushState({}, '', pathname), pathname); };
  if (arg('native-select-probe', 'false') === 'true') {
    await page.evaluate(() => {
      const select = document.createElement('select'); select.id = 'native-select-probe';
      select.innerHTML = '<option value="remind">提醒我翻译</option><option value="auto">自动翻译</option>';
      select.style.cssText = 'position:fixed;top:400px;left:100px;width:200px;height:36px;z-index:2147483647';
      document.body.append(select);
      globalThis.__nativeProbeEvents=[];
      select.addEventListener('keydown', event => globalThis.__nativeProbeEvents.push({key:event.key,trusted:event.isTrusted,prevented:event.defaultPrevented}));
    });
    await page.locator('#native-select-probe').click(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.keyboard.press('End');
    report.nativeSelectProbe = await page.evaluate(() => ({value:document.querySelector('#native-select-probe').value, focused:document.activeElement.id, events:globalThis.__nativeProbeEvents}));
    await page.keyboard.press('Escape'); await page.locator('#native-select-probe').evaluate(element => element.remove());
  }
  await patch({sectionTranslationHotkeyEnabled: true});
  await page.waitForTimeout(250);
  await hover('#p1'); await page.keyboard.press('Alt+R'); await wait(pickerActive);
  await clickPickerButton('.fr-section-expand'); await waitLabel(/翻译此区域 · 3 段/, '文章');
  await wait(async () => (await pickerState())?.selection === 'locked');
  report.pickerHierarchy = {desktop: await pickerLayout()};
  assertCompactPicker(report.pickerHierarchy.desktop);
  await page.setViewportSize({width:390,height:780}); await page.waitForTimeout(150);
  report.pickerHierarchy.narrowUnchecked = await pickerLayout(); assertCompactPicker(report.pickerHierarchy.narrowUnchecked);
  await shot('01a-picker-unchecked-390');
  await clickPickerButton('.fr-section-remember-checkbox');
  await wait(async () => (await picker('return this.querySelector(".fr-section-remember-checkbox").checked')) === true);
  report.pickerHierarchy.narrowRemembered = await pickerLayout(); assertCompactPicker(report.pickerHierarchy.narrowRemembered);
  assert.ok(report.pickerHierarchy.narrowRemembered.visibleAddress.width <= 1, 'the full matching address remains screen-reader context');
  await shot('01b-picker-remember-390');
  await page.setViewportSize({width:1280,height:900}); await page.waitForTimeout(150);
  report.nativeSelectCoverage = {
    defaultValueVerified: true, switchingByTrustedGesture: false,
    limitation: 'macOS background Edge/CDP delivers trusted uncancelled keys to both ordinary page and picker native selects without committing a value change. Native-select-probe evidence records the comparison; automatic mode is selected through actual Element Plus settings controls below.',
  };
  assert.equal(await picker('return this.querySelector(".fr-section-remember-mode").value'), 'remind');
  report.pickerSelection = await picker('return{scope:this.querySelector(".fr-section-remember-scope").value, mode:this.querySelector(".fr-section-remember-mode").value, address:this.querySelector(".fr-section-remember-address").textContent, confirmation:this.querySelector(".fr-section-confirm").textContent}');
  assert.equal(report.pickerSelection.scope, 'path');
  await shot('01-remember-article-default-reminder');
  await clipShot(page,'01c-picker-bar-desktop-zh-clip',(await pickerLayout()).bar);
  await saveDom('picker-desktop-zh',await picker('return this.querySelector(".fr-section-bar").outerHTML'));
  await clickPickerButton('.fr-section-confirm');
  await wait(async () => (await readRules()).length === 1);
  let rules = await readRules(); const ruleId = rules[0].id;
  assert.equal(rules[0].mode, 'remind'); assert.equal(rules[0].site, `127.0.0.1:${server.address().port}/articles/`);
  assert.equal(rules[0].selectors.length, 1);
  assert.equal(await page.evaluate(selector => document.querySelector(selector)?.id, rules[0].selectors[0][0]), 'target');
  await wait(async () => (await countAll()) === 3);
  await assertOutsideOriginal();
  report.savedRule = rules[0];
  const initialSettings = await newPageWithoutForeground(context, 30000);
  failureSurface = initialSettings;
  await initialSettings.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#settings-translation`);
  await initialSettings.locator('[data-settings-category="section-translation"], [data-settings-anchor-link="section-translation"]').first().click();
  const initialRow = initialSettings.locator(`[data-rule-id="${ruleId}"]`);
  await initialRow.waitFor({state: 'visible'});
  await initialRow.locator('.rule-mode').click();
  await initialSettings.getByRole('option', {name: '自动翻译', exact: true}).click();
  await wait(async () => (await readRules())[0]?.mode === 'auto');
  report.automaticRule = (await readRules())[0];
  await initialSettings.close();
  failureSurface = page;
  await activateExtensionTabWithoutForeground(context, page, 30000);
  report.cases.push(currentCase);

  currentCase = 'reload automatically translates only remembered roots; dynamic content fills once';
  const beforeReload = await requestCount();
  await page.reload(); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
  await wait(async () => (await countAll()) === 3);
  assert.equal(await requestCount(), beforeReload + 3, 'reload requests exactly three source segments');
  await page.evaluate(() => {const p = document.createElement('p'); p.id = 'dynamic'; p.textContent = 'Newly loaded English content must fill the remembered region once.'; document.querySelector('#target').append(p);});
  await wait(async () => await hasTranslation('#dynamic'));
  assert.equal(await countAll(), 4, 'existing translations remain visible');
  const afterDynamic = await requestCount();
  assert.equal(afterDynamic, beforeReload + 4);
  await page.waitForTimeout(1200);
  assert.equal(await requestCount(), afterDynamic, 'translation-owned mutations never request again');
  const multiplicity = await page.locator('#target p').evaluateAll(nodes => nodes.map(node => node.querySelectorAll('.fluent-read-bilingual-content').length));
  assert.ok(multiplicity.every(count => count === 1));
  await assertOutsideOriginal();
  report.dynamic = {requestsBeforeReload: beforeReload, afterDynamic, stableForMs: 1200, wrappersPerParagraph: multiplicity};
  await shot('02-auto-dynamic-completed'); report.cases.push(currentCase);

  currentCase = 'manual restore pauses automatic translation until a route change';
  await popup.evaluate(tab => chrome.tabs.sendMessage(tab, {type: 'contextMenuTranslate', action: 'restore'}), tabId);
  await wait(async () => (await countAll()) === 0);
  const beforePausedMutation = await requestCount();
  await page.evaluate(() => {const p = document.createElement('p');p.id = 'paused';p.textContent = 'Manual restore must remain authoritative for the current page.';document.querySelector('#target').append(p);});
  await page.waitForTimeout(900);
  assert.equal(await countAll(), 0); assert.equal(await requestCount(), beforePausedMutation);
  await route('/articles/second');
  await wait(async () => (await countAll()) === 5);
  assert.equal(await requestCount(), beforePausedMutation + 5);
  report.cases.push(currentCase);

  currentCase = 'SPA route exits stop matching; entering a remembered path resumes its precise region';
  await route('/unmatched/first');
  await page.evaluate(() => {document.querySelector('#target').innerHTML = '<h1 id="title">A different route is now displayed</h1><p id="p1">Content outside the remembered URL directory must remain original.</p><p id="p2">Returning to the saved path should reapply only that area.</p>';});
  const beforeOutsidePath = await requestCount();
  await page.waitForTimeout(900);
  assert.equal(await countAll(), 0); assert.equal(await requestCount(), beforeOutsidePath);
  await route('/articles/third'); await wait(async () => (await countAll()) === 3);
  assert.equal(await requestCount(), beforeOutsidePath + 3); await assertOutsideOriginal();
  await route('/unmatched/open-picker');
  await page.evaluate(() => {document.querySelector('#target').innerHTML = '<h1 id="title">Navigate while selecting an area</h1><p id="p1">The destination route must apply remembered translation after closing the picker.</p><p id="p2">Navigation must cancel the old selection without suppressing the next page rule.</p>';});
  await page.waitForTimeout(400);
  const beforePickerRoute = await requestCount();
  await hover('#p1'); await page.keyboard.press('Alt+R'); await wait(pickerActive);
  await route('/articles/from-picker');
  await wait(async () => !(await pickerActive()), 3000, 'SPA route closes the previous picker');
  await wait(async () => (await countAll()) === 3, 15000, 'SPA destination rule starts after picker closes');
  assert.equal(await requestCount(), beforePickerRoute + 3);
  report.routeFromPicker = {pickerClosed: true, requestsBefore: beforePickerRoute, requestsAfter: await requestCount(), translatedSegments: 3};
  report.cases.push(currentCase);

  currentCase = 'reminder mode waits for a trusted click and dismiss stays quiet for the current page';
  rules = await readRules(); await patch({sectionTranslationRules: rules.map(rule => ({...rule, mode: 'remind'}))});
  const beforeReminder = await requestCount();
  await page.reload(); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
  await wait(async () => Boolean(await reminder('return this.querySelector(".fr-section-reminder-action")')));
  await page.waitForTimeout(600);
  assert.equal(await requestCount(), beforeReminder); assert.equal(await countAll(), 0);
  report.reminderHierarchy = await reminder(`${layoutRead}const row=this.querySelector('.fr-section-reminder');return{row:box(row),labelHidden:this.querySelector('.fr-section-reminder-text').hidden,buttons:row.querySelectorAll('button').length,action:this.querySelector('.fr-section-reminder-action').textContent}`);
  assert.equal(report.reminderHierarchy.labelHidden,true); assert.equal(report.reminderHierarchy.buttons,2);
  await shot('03-reminder-before-request');
  await page.setViewportSize({width:390,height:780});
  report.reminderHierarchy.narrow = await reminder(`${layoutRead}return{viewport:innerWidth,...box(this.querySelector('.fr-section-reminder'))}`);
  assert.ok(report.reminderHierarchy.narrow.left>=0&&report.reminderHierarchy.narrow.right<=390&&report.reminderHierarchy.narrow.height<=60,JSON.stringify(report.reminderHierarchy));
  await shot('03b-reminder-390');
  await page.setViewportSize({width:1280,height:900});
  await clickShadow(reminder, '.fr-section-reminder-close');
  await wait(async () => (await page.locator('[data-fluent-read-ui="section-reminder"]').count()) === 0);
  await page.evaluate(() => {const p = document.createElement('p');p.id = 'dismissed';p.textContent = 'Dismissed reminders must not reappear after unrelated changes.';document.querySelector('#target').append(p);});
  await page.waitForTimeout(700);
  assert.equal(await page.locator('[data-fluent-read-ui="section-reminder"]').count(), 0); assert.equal(await requestCount(), beforeReminder);
  await page.reload(); await wait(async () => Boolean(await reminder('return this.querySelector(".fr-section-reminder-action")')));
  await clickShadow(reminder, '.fr-section-reminder-action'); await wait(async () => (await countAll()) === 3);
  await wait(async () => (await page.locator('[data-fluent-read-ui="section-reminder"]').count()) === 0);
  assert.equal(await requestCount(), beforeReminder + 3); await assertOutsideOriginal();
  report.reminder = {requestsBeforeClick: beforeReminder, requestsAfterClick: await requestCount(), dismissedStayedQuiet: true};
  await shot('04-reminder-translated'); report.cases.push(currentCase);

  currentCase = 'settings mode, enablement, site editing and deletion survive storage and page reload';
  const optionsPage = await newPageWithoutForeground(context, 30000);
  failureSurface = optionsPage;
  optionsPage.on('pageerror', error => report.errors.push(error.message));
  const openRulesSettings = async () => {
    await optionsPage.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#settings-translation`);
    await optionsPage.waitForSelector('[data-settings-anchor-link="section-translation"], [data-settings-category="section-translation"]', {timeout: 30000});
    const nav = optionsPage.locator('[data-settings-category="section-translation"], [data-settings-anchor-link="section-translation"]');
    await nav.first().click();
    await optionsPage.locator('[data-testid="section-translation-rules"]').waitFor({state: 'visible'});
    await optionsPage.locator('[data-testid="section-translation-rules"]').scrollIntoViewIfNeeded();
  };
  await openRulesSettings();
  const row = optionsPage.locator(`[data-rule-id="${ruleId}"]`);
  await row.locator('.rule-mode').click();
  await optionsPage.getByRole('option', {name: '自动翻译', exact: true}).click();
  await wait(async () => (await readRules())[0]?.mode === 'auto');
  await optionsPage.reload();
  await optionsPage.locator('[data-settings-category="section-translation"], [data-settings-anchor-link="section-translation"]').first().click();
  await row.waitFor({state: 'visible'}); assert.match(await row.locator('.rule-mode').innerText(), /自动翻译/);
  await row.locator('.el-switch').click(); await wait(async () => (await readRules())[0]?.enabled === false);
  await optionsPage.close();
  await page.reload(); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
  const disabledRequests = await requestCount(); await page.waitForTimeout(850);
  assert.equal(await countAll(), 0); assert.equal(await requestCount(), disabledRequests);
  const settingsReopened = await newPageWithoutForeground(context, 30000);
  failureSurface = settingsReopened;
  // Keep the original constant binding usable after reopening by performing the remaining operations here.
  await settingsReopened.goto(`chrome-extension://${new URL(worker.url()).host}/options.html#settings-translation`);
  await settingsReopened.waitForSelector('[data-settings-anchor-link="section-translation"], [data-settings-category="section-translation"]');
  await settingsReopened.locator('[data-settings-category="section-translation"], [data-settings-anchor-link="section-translation"]').first().click();
  const reopenedRow = settingsReopened.locator(`[data-rule-id="${ruleId}"]`); await reopenedRow.waitFor({state: 'visible'});
  assert.equal(await reopenedRow.getByRole('switch').getAttribute('aria-checked'), 'false');
  await reopenedRow.getByRole('button', {name: '编辑', exact: true}).click();
  const editor = settingsReopened.locator('.rule-editor');
  const advanced = editor.locator('.rule-advanced');
  assert.equal(await advanced.getAttribute('open'),null,'editing opens with advanced CSS hidden');
  assert.equal(await settingsReopened.locator('.rules-list').count(),0,'the editor gets a focused surface');
  assert.equal(await editor.locator('[data-testid="section-rule-profile"]').count(),0,'no empty optional profile field');
  await advanced.locator('summary').click();
  assert.notEqual(await advanced.getAttribute('open'),null);
  assert.equal(await editor.getByRole('textbox',{name:'元素路径（CSS）',exact:true}).inputValue(),report.savedRule.selectors.map(path=>path.join(' >>> ')).join('\n'));
  const editorShot = path.join(artifacts,'05a-settings-advanced-editor.png');
  await settingsReopened.screenshot({path:editorShot});report.screenshots.push(editorShot);
  await advanced.locator('summary').click();
  const newSite = `127.0.0.1:${server.address().port}/changed/`;
  await settingsReopened.getByRole('textbox', {name: '网站或路径', exact: true}).fill(newSite);
  await settingsReopened.getByRole('button', {name: '保存规则', exact: true}).click();
  await wait(async () => (await readRules())[0]?.site === newSite);
  assert.deepEqual((await readRules())[0].selectors,report.savedRule.selectors,'editing a site leaves its saved element paths intact');
  report.settingsHierarchy = await rulesLayout(settingsReopened); assertCompactRules(report.settingsHierarchy);
  const settingsShot = path.join(artifacts, '05-settings-remembered-rules.png');
  await settingsReopened.screenshot({path: settingsShot}); report.screenshots.push(settingsShot);
  await settingsReopened.locator('.section-rules').scrollIntoViewIfNeeded();
  await clipShot(settingsReopened,'05b-settings-section-desktop-zh-clip',await settingsReopened.locator('.section-rules').evaluate(node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  await settingsReopened.setViewportSize({width: 390, height: 780});
  await reopenedRow.scrollIntoViewIfNeeded();
  const narrowShot = path.join(artifacts, '06-settings-rules-390.png');
  await settingsReopened.screenshot({path: narrowShot}); report.screenshots.push(narrowShot);
  await settingsReopened.locator('.section-rules').scrollIntoViewIfNeeded();
  await clipShot(settingsReopened,'06c-settings-section-390-zh-clip',await settingsReopened.locator('.section-rules').evaluate(node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  await saveDom('settings-section-390-zh',await settingsReopened.locator('.section-rules').evaluate(node=>node.outerHTML));
  const narrow = await rulesLayout(settingsReopened); assertCompactRules(narrow);
  report.narrowSettings = narrow;
  await reopenedRow.getByRole('button',{name:'编辑',exact:true}).click();
  assert.equal(await advanced.getAttribute('open'),null,'a fresh edit closes advanced again');
  await editor.scrollIntoViewIfNeeded();
  const editorNarrow = await editor.evaluate(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  assert.ok(editorNarrow.left>=0&&editorNarrow.right<=390&&editorNarrow.scrollWidth<=390,JSON.stringify(editorNarrow));
  const narrowEditorShot=path.join(artifacts,'06b-settings-editor-390.png');
  await settingsReopened.screenshot({path:narrowEditorShot});report.screenshots.push(narrowEditorShot);
  await editor.getByRole('button',{name:'取消',exact:true}).click();
  await patch({uiLanguage:'en-US'});
  await settingsReopened.reload();
  await settingsReopened.locator('[data-settings-category="section-translation"], [data-settings-anchor-link="section-translation"]').first().click();
  await reopenedRow.scrollIntoViewIfNeeded();
  report.englishSettings = await rulesLayout(settingsReopened); assertCompactRules(report.englishSettings);
  assert.match(await reopenedRow.locator('.rule-mode').innerText(),/Auto translate/);
  const englishSettingsShot = path.join(artifacts,'07-settings-rules-390-en.png');
  await settingsReopened.screenshot({path:englishSettingsShot});report.screenshots.push(englishSettingsShot);
  await page.setViewportSize({width:390,height:780});
  failureSurface = page;
  await page.reload();await page.waitForSelector('#fluent-read-page-styles',{state:'attached'});
  await activateExtensionTabWithoutForeground(context,page,30000);
  await hover('#p1');await page.keyboard.press('Alt+R');await wait(pickerActive);
  await clickPickerButton('.fr-section-expand');await wait(async()=>(await pickerState())?.selection==='locked');
  await wait(async()=>await picker('return !this.querySelector(".fr-section-remember").hidden && !this.querySelector(".fr-section-confirm").disabled'),8000,'English selection inspection completes before remembering');
  await clickPickerButton('.fr-section-remember-checkbox');
  await wait(async()=>await picker('return this.querySelector(".fr-section-remember-checkbox").checked'));
  report.englishPicker = await pickerLayout(); assertCompactPicker(report.englishPicker);
  assert.equal(report.englishPicker.confirmation.text,'Translate and remember');
  await shot('08-picker-remember-390-en');
  await page.keyboard.press('Escape');await wait(async()=>!(await pickerActive()));
  report.localizedNarrow = {};
  for (const language of ['ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES']) {
    await patch({uiLanguage:language});
    await settingsReopened.reload();
    await settingsReopened.locator('[data-settings-category="section-translation"], [data-settings-anchor-link="section-translation"]').first().click();
    await reopenedRow.scrollIntoViewIfNeeded();
    const localizedSettings = await rulesLayout(settingsReopened); assertCompactRules(localizedSettings);
    const localizedSettingsShot = path.join(artifacts, `09-settings-rules-390-${language}.png`);
    await settingsReopened.screenshot({path:localizedSettingsShot});report.screenshots.push(localizedSettingsShot);
    await page.reload();await page.waitForSelector('#fluent-read-page-styles',{state:'attached'});
    await activateExtensionTabWithoutForeground(context,page,30000);
    await hover('#p1');await page.keyboard.press('Alt+R');await wait(pickerActive);
    await clickPickerButton('.fr-section-expand');await wait(async()=>(await pickerState())?.selection==='locked');
    await wait(async()=>await picker('return !this.querySelector(".fr-section-remember").hidden && !this.querySelector(".fr-section-confirm").disabled'),8000,`${language} selection inspection completes`);
    await clickPickerButton('.fr-section-remember-checkbox');
    await wait(async()=>await picker('return this.querySelector(".fr-section-remember-checkbox").checked'));
    const localizedPicker = await pickerLayout(); assertCompactPicker(localizedPicker);
    assert.notEqual(localizedPicker.confirmation.text,'Translate and remember',`${language} uses its own translation`);
    await shot(`10-picker-remember-390-${language}`);
    report.localizedNarrow[language] = {settings:localizedSettings,picker:localizedPicker};
    await page.keyboard.press('Escape');await wait(async()=>!(await pickerActive()));
  }
  await patch({uiLanguage:'zh-CN'});
  failureSurface = settingsReopened;
  await settingsReopened.reload();
  await settingsReopened.locator('[data-settings-category="section-translation"], [data-settings-anchor-link="section-translation"]').first().click();
  await reopenedRow.getByRole('button', {name: `删除 ${newSite} 的区域规则`, exact: true}).click();
  await wait(async () => (await readRules()).length === 0);
  await settingsReopened.reload();
  await settingsReopened.locator('[data-settings-category="section-translation"], [data-settings-anchor-link="section-translation"]').first().click();
  await settingsReopened.locator('[data-testid="section-translation-rules"]').waitFor({state: 'visible'});
  assert.equal(await settingsReopened.locator('.rule-row').count(), 0);
  assert.match(await settingsReopened.locator('.rules-empty').innerText(), /选择区域/);
  assert.equal(await settingsReopened.locator('.rules-heading button').innerText(),'手动添加');
  await page.goto(`${origin}/`);await page.waitForSelector('#fluent-read-page-styles',{state:'attached'});
  failureSurface = page;
  await hover('#p1');await page.keyboard.press('Alt+R');await wait(pickerActive);
  await clickPickerButton('.fr-section-expand');await wait(async()=>(await pickerState())?.selection==='locked');
  await wait(async()=>await picker('return !this.querySelector(".fr-section-remember").hidden && !this.querySelector(".fr-section-confirm").disabled'),8000,'Root-path inspection completes before remembering');
  await clickPickerButton('.fr-section-remember-checkbox');
  report.rootScope = await picker(`const scope=this.querySelector('.fr-section-remember-scope');return{scopeHidden:scope.parentElement.hidden,modeVisible:!this.querySelector('.fr-section-remember-mode').parentElement.hidden,describedBy:scope.getAttribute('aria-describedby'),address:this.querySelector('.fr-section-remember-address').textContent}`);
  assert.equal(report.rootScope.scopeHidden,true,'identical site/path choices are hidden');assert.equal(report.rootScope.modeVisible,true);
  await page.keyboard.press('Escape');
  report.persistence = {ruleId, modeSurvivedReload: true, enabledSurvivedClose: true, editedSite: newSite, deletionSurvivedReload: true};
  await settingsReopened.close(); report.cases.push(currentCase);
  report.totalRequests = await requestCount();
  assertFocusSafe();
  assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []); report.success = true;
})().catch(async error => {report.success = false; report.failure = {case: currentCase, message: error.stack}; process.exitCode = 1; if (failureSurface && !failureSurface.isClosed()) {const file=path.join(artifacts,'failure.png');await failureSurface.screenshot({path:file}).then(()=>report.screenshots.push(file)).catch(()=>{});await saveDom('failure',await failureSurface.content()).catch(()=>{});}}).finally(async () => {
  let closed = !launchAttempted;
  try {if (launched) {await launched.close(); closed = true;}} catch (error) {report.cleanupError = error.message; process.exitCode = 1;}
  if (focusMonitor) {
    try {
      await focusMonitor.stop();
      report.focusEvents = {monitoring: 'native macOS activation events throughout the test', browserActivations: focusMonitor.events.filter(event => event.pid === browserPid).length, observerClosed: true};
      assertFocusSafe();
    } catch (error) {report.focusError = error.message; report.success = false; process.exitCode = 1;}
  }
  await new Promise(resolve => {server.close(resolve); server.closeAllConnections();});
  if (closed) {const stat = fs.lstatSync(profileDir); assert.ok(!stat.isSymbolicLink() && stat.ino === profileIdentity.ino && stat.dev === profileIdentity.dev); assert.equal(fs.readFileSync(path.join(profileDir, '.owner'), 'utf8'), owner); fs.rmSync(profileDir, {recursive: true}); report.profileRemoved = true;}
  else report.retainedProfile = profileDir;
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
});

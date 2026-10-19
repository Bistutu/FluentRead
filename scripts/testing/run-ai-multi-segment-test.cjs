/**
 * @file scripts/testing/run-ai-multi-segment-test.cjs
 * 文件职责：在隔离且不抢前台焦点的生产 Edge 扩展里验证 AI 多段翻译是否真正合并供应商请求。
 * 主要内容：使用四段相邻正文、虚构 DeepSeek 端点和可信 Control/Alt+T 输入，记录上下文开关下的实际请求分组，校验恢复、再次翻译、单段悬浮、关闭多段、动态正文与取消后的迟到响应。
 * 模块边界：只修改本脚本创建的临时 profile；不读取真实凭据、不访问线上 AI。受控响应只证明产品调度、传输与 DOM 生命周期，不证明供应商翻译质量。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const support = require('../run-selection-trigger-test.cjs');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
const {startFocusEventMonitor} = require('./mac-focus-event-monitor.cjs');
const {getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
for (const name of ['extension-dir', 'playwright-root', 'artifacts-dir']) assert(arg(name), `--${name} is required`);
const projectRoot = path.resolve(arg('project-root', path.join(__dirname, '../..')));
const extensionDir = path.resolve(arg('extension-dir'));
const artifacts = path.resolve(arg('artifacts-dir'));
const observeOnly = process.argv.includes('--observe-only');
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))));
const profileDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fluentread-ai-multisegment-'));
const profileIdentity = fs.lstatSync(profileDir);
const profileOwner = crypto.randomUUID();
fs.writeFileSync(path.join(profileDir, '.owner'), profileOwner, {flag: 'wx'});
fs.mkdirSync(artifacts, {recursive: true});
const sources = [
  'The forest provides a quiet shelter for many animals during the warm summer months.',
  'A narrow river crosses the valley and carries fresh water to the farms below the hill.',
  'Local families collect ripe fruit every autumn and share their harvest with nearby villages.',
  'Visitors can follow the marked walking path to reach a small wooden bridge beside the lake.',
  'New plants grow quickly after the spring rain and cover the ground with bright green leaves.',
  'Birds return to their nests before sunset while the last light reaches the mountain peaks.',
];
const translations = [
  '森林在温暖的夏季为许多动物提供安静的栖息地。',
  '一条狭窄的河流穿过山谷，为山下的农场带来清水。',
  '当地家庭每逢秋天采摘成熟的水果，并与附近的村庄分享收成。',
  '游客沿着有标记的步道前行，可以到达湖边的一座小木桥。',
  '春雨过后新植物迅速生长，鲜绿的叶片覆盖大地。',
  '鸟儿在日落前返回巢穴，最后的阳光照亮山峰。',
];
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Landscape reading fixture</title></head><body style="font:19px/1.65 system-ui;margin:50px auto;max-width:900px;color:#1f2328;background:white"><main>${sources.slice(0, 4).map((source, index) => `<p id="body-${index}">${index === 1 ? source.replace('A narrow river', '<em>A narrow river</em>') : index === 3 ? source.replace('Visitors', '<a href="#fixture-link">Visitors</a>') : source}</p>`).join('')}<pre id="protected-code"><code>const marker = "keep_code()";</code></pre></main></body></html>`;
const server = http.createServer((_request, response) => { response.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); response.end(html); });
const report = {scope: 'Alternating plain/rich adjacent paragraphs; AI actual cross-paragraph request groups, context off/on, full-page [4,0,4], hover [1,0,1], disabled batching, dynamic paragraphs and cancellation', evidenceBoundary: 'Production Edge extension and synthetic DeepSeek Chat Completions responses. No live provider, account or quality claim.', profileMode: 'automatically-created-temporary-profile', service: 'deepseek', model: 'deepseek-flash', observeOnly, cases: [], batchingFailures: [], screenshots: [], errors: [], consoleErrors: []};
let launched, page, popup, worker, focusMonitor, browserPid, focusError, launchAttempted = false;
function assertFocusSafe() {
  if (focusError || focusMonitor?.error) throw focusError || focusMonitor.error;
  assert.equal(focusMonitor?.events.filter(event => event.pid === browserPid).length || 0, 0, 'owned browser must never become frontmost');
}
async function wait(check, label) {
  const until = Date.now() + 20000;
  while (Date.now() < until) { assertFocusSafe(); if (await check()) return; await page.waitForTimeout(70); }
  throw new Error(`Timed out: ${label}`);
}
const requests = () => worker.evaluate(() => globalThis.__multiSegmentFixture.requests);
const count = selector => page.locator(`${selector} .fluent-read-bilingual-content`).count();
async function gesture(selector) {
  assertFocusSafe();
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = await page.locator(selector).boundingBox(); assert(box, selector);
  await page.mouse.move(box.x + 20, box.y + 12); await page.mouse.click(box.x + 20, box.y + 12);
  await page.keyboard.down('Control'); await page.keyboard.up('Control');
}
async function shot(name) { const file = path.join(artifacts, `${name}.png`); await page.screenshot({path: file}); report.screenshots.push(file); }
async function openPage(context, url) {
  page = await newPageWithoutForeground(context);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.goto(url); await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
  await activateExtensionTabWithoutForeground(context, page);
  return page.locator('main').innerHTML();
}
async function assertTranslated(total = 4) {
  for (let index = 0; index < total; index++) {
    assert.equal(await count(`#body-${index}`), 1);
    assert.equal(await page.locator(`#body-${index} .fluent-read-bilingual-content`).innerText(), translations[index]);
  }
  assert.equal(await page.locator('.fluent-read-bilingual-content .fluent-read-bilingual-content').count(), 0);
  assert.equal(await page.locator('#protected-code').innerText(), 'const marker = "keep_code()";');
}
function groupsFor(requestList) { return requestList.filter(request => !request.summary).map(request => request.sources.length); }
function expectBatched(name, requestList, expectedSources) {
  const translationRequests = requestList.filter(request => !request.summary);
  const groups = groupsFor(requestList);
  const actualSources = translationRequests.flatMap(request => request.sources);
  if (groups.length !== 1 || groups[0] !== expectedSources.length
    || JSON.stringify(actualSources) !== JSON.stringify(expectedSources)) {
    report.batchingFailures.push({name, groups, actualSources, expectedSources, reason: 'Adjacent eligible paragraphs must share one actual provider request in document order'});
  }
}
(async () => {
  report.buildFreshness = assertFreshProductionExtension(extensionDir, projectRoot);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  focusMonitor = startFocusEventMonitor({onEvent: event => { if (event.pid === browserPid) focusError = new Error('Owned Edge became frontmost'); }, onError: error => { focusError = error; }});
  await focusMonitor.ready; launchAttempted = true;
  launched = await launchFocusSafePersistentContext({chromium, profileDir, browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'), headless: false, background: true, displayTarget: arg('display', 'secondary'), viewport: {width: 1280, height: 900}, browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
  Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
  assert.equal(report.launchMode, 'macos-background-cdp'); assert.equal(report.focusPolicy, 'launchservices-no-foreground'); assert.equal(report.windowPlacement.mode, 'background-visible-no-focus'); assert.equal(report.windowPlacement.browserFrontmost, false);
  const context = launched.context;
  const browserSession = await context.browser().newBrowserCDPSession();
  try { const {processInfo} = await browserSession.send('SystemInfo.getProcessInfo'); browserPid = processInfo.find(process => process.type === 'browser')?.id; assert.equal(browserPid, await getGuardedBrowserPid(launched)); } finally { await browserSession.detach(); }
  assertFocusSafe();
  worker = context.serviceWorkers().find(candidate => candidate.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  popup = await newPageWithoutForeground(context); await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  // 此临时 profile 只使用虚构凭据；个人校订保留产品默认值，以覆盖真实默认调用路径。
  const current = await support.readStoredConfig(popup);
  report.defaultPersonalCorrections = current.personalCorrectionsEnabled;
  assert.equal(current.personalCorrectionsEnabled, false, 'fresh extension profile uses product personal-correction default');
  await support.patchStoredConfig(popup, {on: true, service: 'deepseek', from: 'en', to: 'zh-Hans', display: 1, hotkey: 'Control', disableFloatingBall: true, disableSelectionTranslator: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, useCache: false, enableAIContext: false, enableAIMultiSegment: true, glossaryEnabled: false, deepseekApiType: 'chat', deepseekThinkingMode: 'disabled', model: {...current.model, deepseek: 'deepseek-flash'}, token: {...current.token, deepseek: 'fixture-multisegment-key'}, apiKeys: {...current.apiKeys, deepseek: ['fixture-multisegment-key']}, apiKeyRotationEnabled: {...current.apiKeyRotationEnabled, deepseek: false}, proxy: {...current.proxy, deepseek: 'https://fluentread-multisegment-fixture.invalid/v1/chat/completions'}});
  await worker.evaluate(({sources, translations}) => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    const fixture = globalThis.__multiSegmentFixture = {requests: [], pending: [], hold: false};
    globalThis.fetch = async (input, options) => {
      const url = String(typeof input === 'string' ? input : input.url || input);
      if (!url.includes('fluentread-multisegment-fixture.invalid')) return originalFetch(input, options);
      const body = JSON.parse(options.body);
      const user = body.messages.find(message => message.role === 'user').content;
      const summary = user.startsWith('Summarize the webpage reference material');
      const hasContext = !summary && user.includes('<webpage_context>');
      const source = summary ? '' : user.split('NO notes:\n\n')[1]?.split('\n\nUse <webpage_context>')[0]?.split('\n\nThe source contains FluentRead')[0]?.trim();
      if (!summary && typeof source !== 'string') throw new Error('Fixture could not parse production translation source');
      const slots = summary ? [] : [...source.matchAll(/(___FLUENTREAD_([a-z0-9_-]+)_(\d+)_BEGIN___)([\s\S]*?)(___FLUENTREAD_\2_\3_END___)/giu)];
      const translate = text => { const index = sources.indexOf(text.trim()); if (index < 0) throw new Error(`Unexpected fixture source: ${text.slice(0, 100)}`); return translations[index]; };
      const output = summary ? 'The page describes forests, rivers, farms and walking paths in a rural landscape.' : slots.length ? slots.map(slot => `${slot[1]}${translate(slot[4])}${slot[5]}`).join('\n') : translate(source);
      const request = {summary, hasContext, model: body.model, sources: summary ? [] : slots.length ? slots.map(slot => slot[4].trim()) : [source], held: fixture.hold && !summary};
      fixture.requests.push(request);
      if (request.held) await new Promise(resolve => fixture.pending.push(resolve));
      request.completed = true;
      return new Response(JSON.stringify({id: 'fixture-multisegment', model: body.model, choices: [{message: {content: output}}], usage: {prompt_tokens: 12, completion_tokens: 8, total_tokens: 20}}), {status: 200, headers: {'content-type': 'application/json'}});
    };
  }, {sources, translations});
  const url = `http://127.0.0.1:${server.address().port}/`;
  for (const enableAIContext of [false, true]) {
    await support.patchStoredConfig(popup, {enableAIContext, enableAIMultiSegment: true});
    const original = await openPage(context, url); const rounds = [], counts = [];
    for (const expected of [4, 0, 4]) {
      const before = (await requests()).length; await page.keyboard.press('Alt+T');
      await wait(async () => await count('main') === expected, `full page ${enableAIContext} count ${expected}`);
      counts.push(await count('main'));
      if (expected) { await assertTranslated(); const roundRequests = (await requests()).slice(before); const groups = groupsFor(roundRequests); expectBatched(`context-${enableAIContext}-round-${rounds.length + 1}`, roundRequests, sources.slice(0, 4)); rounds.push({groups, summaryCalls: roundRequests.filter(request => request.summary).length, contextFlags: roundRequests.filter(request => !request.summary).map(request => request.hasContext)}); }
      else assert.equal(await page.locator('main').innerHTML(), original);
      assert.equal(page.url(), url);
    }
    await shot(`full-context-${enableAIContext}`);
    report.cases.push({name: `full-page-context-${enableAIContext}`, counts, rounds});
    await page.close();
  }
  await support.patchStoredConfig(popup, {enableAIContext: true, enableAIMultiSegment: true});
  let original = await openPage(context, url); const beforeHover = (await requests()).length, hoverCounts = [];
  for (const expected of [1, 0, 1]) {
    await gesture('#body-0'); await wait(async () => await count('#body-0') === expected, `hover count ${expected}`); hoverCounts.push(await count('#body-0'));
    for (let index = 1; index < 4; index++) assert.equal(await count(`#body-${index}`), 0);
    if (expected) assert.equal(await page.locator('#body-0 .fluent-read-bilingual-content').innerText(), translations[0]);
    else assert.equal(await page.locator('main').innerHTML(), original);
    assert.equal(page.url(), url);
  }
  const hoverGroups = groupsFor((await requests()).slice(beforeHover)); assert(hoverGroups.length > 0); assert(hoverGroups.every(size => size === 1));
  report.cases.push({name: 'hover-stays-single', counts: hoverCounts, groups: hoverGroups, neighbors: [0, 0, 0]}); await shot('hover-single'); await page.close();
  await support.patchStoredConfig(popup, {enableAIContext: false, enableAIMultiSegment: false});
  await openPage(context, url); let before = (await requests()).length; await page.keyboard.press('Alt+T');
  await wait(async () => await count('main') === 4, 'disabled batching translates all'); await assertTranslated();
  const disabledGroups = groupsFor((await requests()).slice(before)); assert.deepEqual(disabledGroups, [1, 1, 1, 1]);
  report.cases.push({name: 'disabled-multi-segment', groups: disabledGroups}); await page.close();
  await support.patchStoredConfig(popup, {enableAIMultiSegment: true});
  await openPage(context, url); await page.keyboard.press('Alt+T'); await wait(async () => await count('main') === 4, 'dynamic baseline translated');
  before = (await requests()).length;
  await page.evaluate(extra => { const fragment = document.createDocumentFragment(); for (let index = 0; index < extra.length; index++) { const p = document.createElement('p'); p.id = `body-${index + 4}`; p.textContent = extra[index]; fragment.append(p); } document.querySelector('main').append(fragment); }, sources.slice(4));
  await wait(async () => await count('main') === 6, 'new paragraphs translated'); await assertTranslated(6);
  const dynamicRequests = (await requests()).slice(before); const dynamicGroups = groupsFor(dynamicRequests); expectBatched('dynamic-adjacent-paragraphs', dynamicRequests, sources.slice(4));
  report.cases.push({name: 'dynamic-paragraphs', counts: [4, 6], groups: dynamicGroups}); await shot('dynamic-six');
  await page.keyboard.press('Alt+T'); await wait(async () => await count('main') === 0, 'dynamic restore');
  for (let index = 0; index < 6; index++) assert.equal(await page.locator(`#body-${index}`).innerText(), sources[index]); await page.close();
  original = await openPage(context, url); before = (await requests()).length;
  await worker.evaluate(() => { globalThis.__multiSegmentFixture.hold = true; });
  await page.keyboard.press('Alt+T'); await wait(async () => (await requests()).slice(before).some(request => request.held), 'pending request started');
  await page.keyboard.press('Alt+T'); await wait(async () => await count('main') === 0 && await page.locator('main .fluent-read-loading-indicator').count() === 0, 'cancel returns original');
  await worker.evaluate(() => { const fixture = globalThis.__multiSegmentFixture; fixture.hold = false; fixture.pending.splice(0).forEach(resolve => resolve()); });
  await page.waitForTimeout(800); assertFocusSafe(); assert.equal(await page.locator('main').innerHTML(), original);
  const cancelledRequests = (await requests()).slice(before); assert(cancelledRequests.some(request => request.held && request.completed));
  before = (await requests()).length; await page.keyboard.press('Alt+T'); await wait(async () => await count('main') === 4, 'translation after cancellation'); await assertTranslated();
  const resumedRequests = (await requests()).slice(before); const resumedGroups = groupsFor(resumedRequests); expectBatched('resumed-after-cancellation', resumedRequests, sources.slice(0, 4));
  report.cases.push({name: 'cancel-pending-and-retranslate', lateResultRendered: false, cancelledGroups: groupsFor(cancelledRequests), resumedGroups}); await shot('cancel-retranslate');
  assertFocusSafe(); assert.deepEqual(report.errors, []); report.requests = await requests();
  assert(report.requests.every(request => request.model === report.model));
  if (!observeOnly) assert.deepEqual(report.batchingFailures, [], 'AI multi-segment must group distinct paragraph sources into actual provider calls');
  report.success = true;
})().catch(async error => {
  report.success = false; report.failure = String(error.stack || error); process.exitCode = 1;
  if (worker) report.requests = await requests().catch(() => []);
  if (page) { report.failedMain = await page.locator('main').innerHTML().catch(() => null); await shot('failure').catch(() => {}); }
}).finally(async () => {
  let closed = !launchAttempted;
  try { if (launched) { await launched.close(); closed = true; } } catch (error) { report.cleanupError = error.message; process.exitCode = 1; }
  if (focusMonitor) { try { await focusMonitor.stop(); report.focusEvents = {monitoring: 'native macOS activation events throughout test', browserActivations: focusMonitor.events.filter(event => event.pid === browserPid).length, observerClosed: true}; assertFocusSafe(); } catch (error) { report.focusError = error.message; report.success = false; process.exitCode = 1; } }
  if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  if (closed) { const identity = fs.lstatSync(profileDir); assert(!identity.isSymbolicLink() && identity.ino === profileIdentity.ino && identity.dev === profileIdentity.dev); assert.equal(fs.readFileSync(path.join(profileDir, '.owner'), 'utf8'), profileOwner); fs.rmSync(profileDir, {recursive: true}); report.profileRemoved = true; } else report.retainedProfile = profileDir;
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({success: report.success, failure: report.failure, cases: report.cases, batchingFailures: report.batchingFailures, focusEvents: report.focusEvents, reportPath: path.join(artifacts, 'report.json')}, null, 2));
});

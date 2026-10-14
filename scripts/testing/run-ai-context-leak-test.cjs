/**
 * @file scripts/testing/run-ai-context-leak-test.cjs
 * 文件职责：在隔离、非前台的生产扩展浏览器里验证短标题误译参考正文后的恢复、逐槽保留与缓存边界。
 * 主要内容：提供 Prompts 英文页面和 DeepSeek Chat Completions 受控响应，使用真实 CDP Control/Alt+T 手势，核对 DOM、恢复、重新翻译与失败占位，并保存截图和焦点证据。
 * 模块边界：仅在脚本创建的临时 profile 中配置虚构凭据并拦截虚构端点，不读取个人浏览器或真实 API Key；证明产品传输/渲染路径，不代表线上 DeepSeek 的实际输出或质量。
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
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))));
const profileDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fluentread-context-leak-'));
const profileIdentity = fs.lstatSync(profileDir);
const profileOwner = crypto.randomUUID();
fs.writeFileSync(path.join(profileDir, '.owner'), profileOwner, {flag: 'wx'});
fs.mkdirSync(artifacts, {recursive: true});
const sourceParagraphs = [
  'A prompt tells a language model what task to perform. Asking somebody for directions illustrates why a clearer question usually produces more useful guidance.',
  'Providers expose complicated interfaces with different message roles and types, which can be difficult to understand despite their power.',
  'The AI SDK simplifies this through three kinds of prompts: text, message, and system.',
];
const translations = ['提示词告诉语言模型该执行什么任务。问路时，问题越清晰，通常越能得到有用的指引。', '提供商的接口包含不同的消息角色和类型，功能强大，也可能难以理解。', 'AI SDK 通过文本、消息和系统三种提示词简化了这一过程。'];
const leakedResult = '提示词提示词是你给大型语言模型（LLM）的指令，用来告诉它该做什么。这就像你向别人问路一样；你的问题越清晰，得到的方向就越好。许多LLM提供商都提供复杂的接口来指定提示词。这些接口涉及不同的角色和消息类型。虽然这些接口功能强大，但它们可能难以使用和理解。为了简化提示，AI SDK支持文本提示、消息提示和系统提示。';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Prompts</title></head><body style="font:19px/1.65 system-ui;margin:50px auto;max-width:900px;color:#1f2328;background:#fff"><main><h1 id="heading">Prompts</h1>${sourceParagraphs.map((source, index) => `<p id="body-${index}">${source}</p>`).join('')}<pre id="protected-code"><code>const prompt = "keep_code()";</code></pre></main></body></html>`;
const server = http.createServer((_request, response) => { response.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); response.end(html); });
const report = {scope: 'Prompts short-heading context replacement; hover/full-page recovery, valid slot preservation, cache reuse, persistent failure and context switch', evidenceBoundary: 'Production Edge extension and DeepSeek Chat Completions adapter with synthetic responses from a nonexistent endpoint. No live DeepSeek request, account or quality claim.', profileMode: 'automatically-created-temporary-profile', service: 'deepseek', model: 'deepseek-flash', cases: [], screenshots: [], errors: [], consoleErrors: []};
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
const count = selector => page.locator(`${selector} .fluent-read-bilingual-content`).count();
async function gesture(selector) {
  assertFocusSafe();
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = await page.locator(selector).boundingBox();
  assert(box, selector);
  await page.mouse.move(box.x + 20, box.y + 12);
  await page.mouse.click(box.x + 20, box.y + 12);
  await page.keyboard.down('Control'); await page.keyboard.up('Control');
}
async function shot(name) { const file = path.join(artifacts, `${name}.png`); await page.screenshot({path: file}); report.screenshots.push(file); }
const requests = () => worker.evaluate(() => globalThis.__contextLeakFixture.requests);
async function newFixturePage(context, url) {
  page = await newPageWithoutForeground(context);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.goto(url);
  await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
  await activateExtensionTabWithoutForeground(context, page);
  await page.evaluate(() => {
    globalThis.__seenTranslations = [];
    const capture = () => document.querySelectorAll('main .fluent-read-bilingual-content').forEach(node => globalThis.__seenTranslations.push(node.textContent));
    globalThis.__translationObserver = new MutationObserver(capture);
    globalThis.__translationObserver.observe(document.querySelector('main'), {subtree: true, childList: true, characterData: true});
  });
}
async function assertNoLeakVisible() {
  assert.equal(await page.evaluate(marker => globalThis.__seenTranslations.some(text => text.includes(marker)), '告诉它该做什么'), false, 'rejected context translation must never reach DOM');
  assert.equal(await page.locator('main').innerText().then(text => text.includes('告诉它该做什么')), false);
}
async function cacheTranslations() {
  return worker.evaluate(async () => {
    const database = await new Promise((resolve, reject) => { const request = indexedDB.open('FluentReadTranslationCache'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Fixture cache open failed')); });
    try {
      const records = await new Promise((resolve, reject) => { const request = database.transaction('entries', 'readonly').objectStore('entries').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Fixture cache read failed')); });
      return records.map(record => record.translation).filter(value => typeof value === 'string');
    } finally { database.close(); }
  });
}
(async () => {
  report.buildFreshness = assertFreshProductionExtension(extensionDir, projectRoot);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  focusMonitor = startFocusEventMonitor({onEvent: event => { if (event.pid === browserPid) focusError = new Error('Owned Edge became frontmost'); }, onError: error => { focusError = error; }});
  await focusMonitor.ready;
  launchAttempted = true;
  launched = await launchFocusSafePersistentContext({chromium, profileDir, browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'), headless: false, background: true, displayTarget: arg('display', 'secondary'), viewport: {width: 1280, height: 900}, browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
  Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
  assert.equal(report.launchMode, 'macos-background-cdp'); assert.equal(report.focusPolicy, 'launchservices-no-foreground'); assert.equal(report.windowPlacement.mode, 'background-visible-no-focus'); assert.equal(report.windowPlacement.browserFrontmost, false);
  const context = launched.context;
  const browserSession = await context.browser().newBrowserCDPSession();
  try { const {processInfo} = await browserSession.send('SystemInfo.getProcessInfo'); browserPid = processInfo.find(process => process.type === 'browser')?.id; assert.equal(browserPid, await getGuardedBrowserPid(launched)); } finally { await browserSession.detach(); }
  assertFocusSafe();
  worker = context.serviceWorkers().find(candidate => candidate.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  popup = await newPageWithoutForeground(context);
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  // 此 profile 由本脚本创建，配置中只有以下虚构 fixture 凭据；不连接用户的浏览器配置。
  const current = await support.readStoredConfig(popup);
  await support.patchStoredConfig(popup, {on: true, service: 'deepseek', from: 'en', to: 'zh-Hans', display: 1, hotkey: 'Control', disableFloatingBall: true, disableSelectionTranslator: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, useCache: true, enableAIContext: true, enableAIMultiSegment: false, glossaryEnabled: false, deepseekApiType: 'chat', deepseekThinkingMode: 'disabled', model: {...current.model, deepseek: 'deepseek-flash'}, token: {...current.token, deepseek: 'fixture-context-leak-key'}, apiKeys: {...current.apiKeys, deepseek: ['fixture-context-leak-key']}, apiKeyRotationEnabled: {...current.apiKeyRotationEnabled, deepseek: false}, proxy: {...current.proxy, deepseek: 'https://fluentread-context-fixture.invalid/v1/chat/completions'}});
  await worker.evaluate(({sourceParagraphs, translations, leakedResult}) => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    const fixture = globalThis.__contextLeakFixture = {mode: 'recover', requests: []};
    globalThis.fetch = async (input, options) => {
      const url = String(typeof input === 'string' ? input : input.url || input);
      if (!url.includes('fluentread-context-fixture.invalid')) return originalFetch(input, options);
      const body = JSON.parse(options.body);
      const user = body.messages.find(message => message.role === 'user').content;
      const summary = user.startsWith('Summarize the webpage reference material');
      const hasContext = !summary && user.includes('<webpage_context>');
      let source = summary ? '' : user.split('NO notes:\n\n')[1]?.split('\n\nUse <webpage_context>')[0]?.split('\n\nThe source contains FluentRead')[0]?.trim();
      if (!summary && typeof source !== 'string') throw new Error('Fixture could not parse production translation source');
      const slots = summary ? [] : [...source.matchAll(/(___FLUENTREAD_([a-z0-9_-]+)_(\d+)_BEGIN___)([\s\S]*?)(___FLUENTREAD_\2_\3_END___)/giu)];
      const translate = text => {
        const value = text.trim();
        if (value === 'Prompts') return fixture.mode === 'persistent' ? `<webpage_context>${leakedResult}</webpage_context>` : hasContext ? leakedResult : '提示词';
        const index = sourceParagraphs.indexOf(value);
        if (index >= 0) return translations[index];
        throw new Error(`Unexpected fixture source: ${value.slice(0, 80)}`);
      };
      const output = summary ? 'Prompts tell a language model what to do. The AI SDK supports text, message, and system prompts.' : slots.length ? slots.map(slot => `${slot[1]}${translate(slot[4])}${slot[5]}`).join('\n') : translate(source);
      fixture.requests.push({summary, hasContext, mode: fixture.mode, model: body.model, sources: slots.length ? slots.map(slot => slot[4]) : [source], output});
      return new Response(JSON.stringify({id: 'fixture-context-leak', model: body.model, choices: [{message: {content: output}}], usage: {prompt_tokens: 12, completion_tokens: 8, total_tokens: 20}}), {status: 200, headers: {'content-type': 'application/json'}});
    };
  }, {sourceParagraphs, translations, leakedResult});
  const url = `http://127.0.0.1:${server.address().port}/`;
  await newFixturePage(context, url);
  const original = await page.locator('main').innerHTML();
  const toggles = [];
  for (const expected of [1, 0, 1]) {
    await gesture('#heading'); await wait(async () => await count('#heading') === expected, `heading count ${expected}`);
    toggles.push(await count('#heading'));
    if (expected) assert.equal(await page.locator('#heading .fluent-read-bilingual-content').innerText(), '提示词');
    for (const selector of ['#body-0', '#body-1', '#body-2']) assert.equal(await count(selector), 0);
    assert.equal(page.url(), url); await assertNoLeakVisible();
  }
  const hoverRequests = await requests();
  assert(hoverRequests.every(request => request.model === report.model), 'effective configured DeepSeek model is frozen in every request');
  assert.equal(hoverRequests.filter(request => !request.summary && request.sources.includes('Prompts')).length, 2, 'single title retries only once, then reuses cache');
  assert.equal(hoverRequests.find(request => !request.summary).hasContext, true);
  assert.equal(hoverRequests.filter(request => !request.summary)[1].hasContext, false);
  await shot('01-hover-recovered');
  report.cases.push({name: 'hover-context-recovery-and-toggle', counts: toggles, neighboringCounts: [0, 0, 0], providerCalls: 2, visibleTranslation: '提示词'});
  await gesture('#heading'); await wait(async () => await count('#heading') === 0, 'hover restore'); assert.equal(await page.locator('main').innerHTML(), original);
  await page.reload(); await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'}); await activateExtensionTabWithoutForeground(context, page);
  await gesture('#heading'); await wait(async () => await count('#heading') === 1, 'fresh frontend cache reuse');
  assert.deepEqual(await requests(), hoverRequests, 'fresh frontend session must reuse only recovered cache');
  const persisted = await cacheTranslations(); assert(persisted.includes('提示词')); assert.equal(persisted.some(value => value.includes('告诉它该做什么')), false);
  await shot('02-fresh-session-cache');
  report.cases.push({name: 'recovered-persistent-cache', cacheRecords: persisted.length, rejectedResultStored: false, freshSessionProviderCalls: 0});
  await page.close();
  await support.patchStoredConfig(popup, {useCache: false, enableAIMultiSegment: true});
  await newFixturePage(context, url);
  const fullPageOriginal = await page.locator('main').innerHTML();
  const beforeFull = (await requests()).length;
  const fullCounts = [];
  for (const expected of [4, 0, 4]) {
    await page.keyboard.press('Alt+T');
    await wait(async () => await page.locator('main .fluent-read-bilingual-content').count() === expected, `full-page count ${expected}`);
    fullCounts.push(await page.locator('main .fluent-read-bilingual-content').count());
    if (expected) {
      assert.equal(await page.locator('#heading .fluent-read-bilingual-content').innerText(), '提示词');
      for (let index = 0; index < translations.length; index++) assert.equal(await page.locator(`#body-${index} .fluent-read-bilingual-content`).innerText(), translations[index]);
      assert.equal(await page.locator('.fluent-read-bilingual-content .fluent-read-bilingual-content').count(), 0);
    } else assert.equal(await page.locator('main').innerHTML(), fullPageOriginal);
    assert.equal(await page.locator('#protected-code').innerText(), 'const prompt = "keep_code()";');
    await assertNoLeakVisible(); assert.equal(page.url(), url);
  }
  await shot('03-full-page-recovered');
  const fullRequests = (await requests()).slice(beforeFull);
  assert(fullRequests.some(request => request.sources.length > 1), 'full-page fixture must exercise production multi-slot translation');
  const bodyCalls = fullRequests.filter(request => !request.summary).flatMap(request => request.sources).filter(source => sourceParagraphs.includes(source));
  for (const source of sourceParagraphs) assert.equal(bodyCalls.filter(value => value === source).length, 2, 'valid body slot is sent once per uncached page translation, never resent for heading recovery');
  report.cases.push({name: 'full-page-multi-slot-recovery-and-toggle', counts: fullCounts, validBodyCallsPerRound: 1, protectedCodeUnchanged: true, nestedWrappers: 0});
  await page.keyboard.press('Alt+T'); await wait(async () => await page.locator('main .fluent-read-bilingual-content').count() === 0, 'final full-page restore'); assert.equal(await page.locator('main').innerHTML(), fullPageOriginal);
  await page.close();
  await support.patchStoredConfig(popup, {enableAIMultiSegment: false, useCache: false});
  await worker.evaluate(() => { globalThis.__contextLeakFixture.mode = 'persistent'; });
  await newFixturePage(context, url);
  const beforeFailure = (await requests()).length;
  await gesture('#heading'); await wait(async () => await page.locator('#heading .fluent-read-retry-wrapper').count() === 1, 'persistent leakage becomes recoverable failure');
  assert.equal(await count('#heading'), 0); await assertNoLeakVisible();
  const failureRequests = (await requests()).slice(beforeFailure).filter(request => !request.summary);
  assert.equal(failureRequests.length, 2); assert.deepEqual(failureRequests.map(request => request.hasContext), [true, false]);
  await shot('04-persistent-result-rejected');
  report.cases.push({name: 'persistent-leak-rejected', providerCalls: 2, visibleWrappers: 0, retryPlaceholders: 1, rejectedResultStored: false});
  await page.close();
  await support.patchStoredConfig(popup, {enableAIContext: false});
  await worker.evaluate(() => { globalThis.__contextLeakFixture.mode = 'recover'; });
  await newFixturePage(context, url);
  const beforeDisabled = (await requests()).length;
  await gesture('#heading'); await wait(async () => await count('#heading') === 1, 'context-disabled title');
  assert.equal(await page.locator('#heading .fluent-read-bilingual-content').innerText(), '提示词');
  const disabledRequests = (await requests()).slice(beforeDisabled);
  assert.equal(disabledRequests.length, 1); assert.equal(disabledRequests[0].summary, false); assert.equal(disabledRequests[0].hasContext, false);
  await shot('05-context-disabled');
  report.cases.push({name: 'context-switch-off', providerCalls: 1, summaryCalls: 0, contextPresent: false});
  assert.equal((await cacheTranslations()).some(value => value.includes('告诉它该做什么')), false);
  assertFocusSafe(); assert.deepEqual(report.errors, []);
  report.requests = await requests(); report.success = true;
})().catch(async error => {
  report.success = false; report.failure = String(error.stack || error); process.exitCode = 1;
  if (worker) report.requests = await requests().catch(() => []);
  if (page) { report.failedMain = await page.locator('main').innerHTML().catch(() => null); await shot('failure').catch(() => {}); }
}).finally(async () => {
  let closed = !launchAttempted;
  try { if (launched) { await launched.close(); closed = true; } } catch (error) { report.cleanupError = error.message; process.exitCode = 1; }
  if (focusMonitor) {
    try { await focusMonitor.stop(); report.focusEvents = {monitoring: 'native macOS activation events throughout the test', browserActivations: focusMonitor.events.filter(event => event.pid === browserPid).length, observerClosed: true}; assertFocusSafe(); } catch (error) { report.focusError = error.message; report.success = false; process.exitCode = 1; }
  }
  if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  if (closed) { const identity = fs.lstatSync(profileDir); assert(!identity.isSymbolicLink() && identity.ino === profileIdentity.ino && identity.dev === profileIdentity.dev); assert.equal(fs.readFileSync(path.join(profileDir, '.owner'), 'utf8'), profileOwner); fs.rmSync(profileDir, {recursive: true}); report.profileRemoved = true; } else report.retainedProfile = profileDir;
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});

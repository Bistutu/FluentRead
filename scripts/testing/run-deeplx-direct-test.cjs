#!/usr/bin/env node
/**
 * @file scripts/testing/run-deeplx-direct-test.cjs
 * 文件职责：在生产扩展与临时后台 Edge 验证 issue #968 的 DeepL 直连、回退、分块和取消。
 * 主要内容：通过 options 页消息调用真实 broker，在本次 worker fetch 边界提供确定性响应，并用可信 Control 手势验证悬浮翻译/恢复/再翻译；--live 仅放行一个公开短句到 DeepL。
 * 模块边界：仅创建和清理自己的临时 profile；合成响应与真实网络证据分别报告，不读取用户凭据，不向公共备用 worker 发真实测试流量。
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {createHash, randomUUID} = require('node:crypto');
const {guardBrowserClose, getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
const {patchStoredConfig} = require('../run-selection-trigger-test.cjs');

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/run-deeplx-direct-test.cjs --extension-dir PATH --playwright-root PATH --artifacts-dir PATH [--focus-safe-helper PATH] [--live] [--background]');
  process.exit(0);
}
for (const name of ['extension-dir', 'playwright-root', 'artifacts-dir']) assert.ok(argument(name), `Missing --${name}`);
assert.equal(process.platform, 'darwin', 'This test requires macOS focus-safe background Edge');
assert.ok(!process.argv.includes('--headed'), 'Foreground testing is not supported by this runner');
const root = path.resolve(__dirname, '../..');
const extensionDir = path.resolve(argument('extension-dir'));
const artifactsDir = path.resolve(argument('artifacts-dir'));
const timeout = Number(argument('timeout', '45000'));
const live = process.argv.includes('--live');
const {chromium} = require(path.join(path.resolve(argument('playwright-root')), 'playwright'));
const helper = require(path.resolve(argument('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))));
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
assert.ok(!extensionDir.endsWith('-dev') && !manifest.name.includes('DEV'), 'Only production extension artifacts are accepted');
const PUBLIC_ENDPOINT = 'https://deeplx.1stg.me/translate';
const CUSTOM_ENDPOINT = 'https://deeplx.fixture.invalid/translate';
const SOURCE = 'The library opens at nine every morning.';
const TRANSLATED = '图书馆每天早上九点开放。';
const LIVE_SOURCE = 'The moon reflects sunlight.';
fs.mkdirSync(artifactsDir, {recursive: true});
const report = {
  ok: false, extensionDir, liveRequested: live, profileMode: 'automatically-created-temporary-profile',
  scope: 'Production options broker, deterministic DeepL/direct and DeepLX/fallback fetch fixtures, trusted Control hover toggle',
  cases: [], screenshots: [], pageErrors: [], cleanupErrors: [],
  limits: ['Synthetic responses do not prove upstream availability or translation quality.', 'Live mode sends one public short sentence only; it does not establish long-term service reliability or Firefox behavior.'],
};
let launched, profileDir, worker, optionsPage, articlePage, server, monitor, browserPid, focusFailure;
let launchAttempted = false;

const send = message => optionsPage.evaluate(message => chrome.runtime.sendMessage(message), message);
async function mode(behavior) {
  await worker.evaluate(behavior => {
    const state = globalThis.__deeplxDirectHarness;
    state.behavior = behavior; state.calls = []; state.aborted = 0;
  }, behavior);
}
const calls = () => worker.evaluate(() => globalThis.__deeplxDirectHarness.calls);
const request = (origin, targetLanguage = 'zh-Hans', clientRequestId = `deeplx-968-${randomUUID()}`) => ({
  origin, sourceLanguage: 'en', targetLanguage, serviceOverride: 'deeplx', useCache: false,
  enableAIContext: false, requestTimeoutMs: 25_000, clientRequestId,
});
async function translate(origin, targetLanguage) {
  const result = await send(request(origin, targetLanguage));
  assert.equal(typeof result, 'string', `Broker translation failed: ${JSON.stringify(result)}`);
  return result;
}
async function record(name, details = {}) {
  const requests = await calls();
  report.cases.push({name, ok: true, evidence: 'synthetic-provider-response', ...details, requests});
}
async function screenshot(page, name) {
  const file = path.join(artifactsDir, `${name}.png`);
  await page.screenshot({path: file}); report.screenshots.push(file);
}
async function safeFocus() {
  if (focusFailure) throw focusFailure;
  if (monitor.error) throw monitor.error;
  assert.ok(!monitor.events.some(event => event.pid === browserPid), 'Isolated browser was activated');
  const frontmost = await helper.queryMacFrontmostApplication();
  assert.ok(frontmost, 'Cannot inspect foreground application');
  assert.notEqual(frontmost.pid, browserPid, 'Isolated browser must stay in background');
}

(async () => {
  try {
    report.buildFreshness = assertFreshProductionExtension(extensionDir, root);
    profileDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fluentread-deeplx-direct-'));
    const stopForFocus = error => {
      focusFailure ||= error;
      if (launched) void launched.close().catch(error => report.cleanupErrors.push(error.message));
    };
    monitor = helper.startFocusEventMonitor({
      onEvent: event => { if (event.pid === browserPid) stopForFocus(new Error('Test browser became foreground')); },
      onError: stopForFocus,
    });
    await monitor.ready;
    launchAttempted = true;
    launched = await helper.launchFocusSafePersistentContext({
      chromium, profileDir, background: true, headless: false, displayTarget: 'secondary', timeout,
      viewport: {width: 1280, height: 900},
      browserPath: argument('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'],
    });
    guardBrowserClose(launched, profileDir);
    browserPid = await getGuardedBrowserPid(launched);
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement,
      browserVersion: launched.context.browser().version()});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    await safeFocus();
    const {context} = launched;
    const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex')
      .slice(0, 32).replace(/[0-9a-f]/gu, digit => String.fromCharCode(97 + parseInt(digit, 16)));
    optionsPage = await helper.newPageWithoutForeground(context, timeout);
    optionsPage.on('pageerror', error => report.pageErrors.push(error.message));
    await optionsPage.goto(`chrome-extension://${extensionId}/${manifest.options_page || manifest.options_ui.page}#settings-services`, {waitUntil: 'domcontentloaded'});
    await optionsPage.locator('.service-catalog').waitFor({timeout});
    worker = context.serviceWorkers().find(candidate => new URL(candidate.url()).host === extensionId)
      || await context.waitForEvent('serviceworker', {timeout});
    await patchStoredConfig(optionsPage, {
      on: true, from: 'en', to: 'zh-Hans', service: 'deeplx', deeplx: PUBLIC_ENDPOINT, proxy: {}, token: {}, apiKeys: {},
      apiKeyRotationEnabled: {}, useCache: false, hotkey: 'Control', display: 1, autoTranslate: false,
      enableAIContext: false, enableAIMultiSegment: false, glossaryEnabled: false, translationMaxRetries: 0,
      translationRequestsPerSecond: 0, translationRequestsPerMinute: 0, maxConcurrentTranslations: 4,
      uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, disableSelectionTranslator: true, disableFloatingBall: true,
      pageTitleTranslationEnabled: false,
    });
    await worker.evaluate(({PUBLIC_ENDPOINT, CUSTOM_ENDPOINT, SOURCE, TRANSLATED, LIVE_SOURCE}) => {
      const original = globalThis.fetch.bind(globalThis);
      const state = globalThis.__deeplxDirectHarness = {behavior: 'success', calls: [], aborted: 0};
      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
        const direct = url === 'https://oneshot-free.www.deepl.com/v1/translate';
        const fallback = url === PUBLIC_ENDPOINT;
        const custom = url === CUSTOM_ENDPOINT;
        if (!direct && !fallback && !custom) {
          if (/^https?:/u.test(url)) throw new Error('Unexpected external request in the bounded DeepLX test');
          return original(input, init);
        }
        const body = JSON.parse(init?.body || '{}');
        const texts = direct ? body.text : [body.text];
        const call = {kind: direct ? 'direct' : fallback ? 'public-fallback' : 'custom', url, texts,
          lengths: texts.map(text => text.length), source: body.source_lang, target: body.target_lang,
          credentials: init?.credentials || 'default', aborted: false};
        state.calls.push(call);
        if (direct && state.behavior === 'live') {
          if (texts.length !== 1 || texts[0] !== LIVE_SOURCE) throw new Error('Live sample exceeds the allowed public sentence');
          call.evidence = 'live-provider';
          return original(input, init);
        }
        if (direct && state.behavior === 'pending') {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve(Response.json({translations: [{text: '迟到译文'}]})), 30_000);
            const aborted = () => { clearTimeout(timer); call.aborted = true; state.aborted++; reject(new DOMException('Test request aborted', 'AbortError')); };
            if (init.signal?.aborted) aborted();
            else init.signal?.addEventListener('abort', aborted, {once: true});
          });
        }
        if (direct && state.behavior === 'fallback') return Response.json({message: 'fixture rate limit'}, {status: 429});
        if (direct) return Response.json({translations: texts.map(text => ({text: text === SOURCE
          ? body.target_lang === 'zh-Hant' ? '圖書館每天早上九點開放。' : TRANSLATED : '分块译文'}))});
        return Response.json({code: 200, data: custom ? '自定义端点译文。' : '备用端点译文。'});
      };
    }, {PUBLIC_ENDPOINT, CUSTOM_ENDPOINT, SOURCE, TRANSLATED, LIVE_SOURCE});

    assert.equal(await translate(SOURCE), TRANSLATED);
    assert.deepEqual((await calls()).map(call => call.kind), ['direct']);
    assert.equal((await calls())[0].credentials, 'omit');
    await record('default-direct-no-public-request');

    await mode('success');
    assert.equal(await translate(SOURCE, 'zh-Hant'), '圖書館每天早上九點開放。');
    assert.equal((await calls())[0].target, 'zh-Hant');
    await record('traditional-chinese-target');

    await mode('fallback');
    assert.equal(await translate('Fallback uses the public endpoint only after direct failure.'), '备用端点译文。');
    assert.deepEqual((await calls()).map(call => call.kind), ['direct', 'public-fallback']);
    await record('direct-429-public-fallback');

    await mode('success');
    const longText = 'A'.repeat(1499) + '😀' + 'B'.repeat(1600);
    await translate(longText);
    const chunks = await calls();
    assert.ok(chunks.length >= 3);
    assert.ok(chunks.every(call => call.kind === 'direct' && call.lengths.every(length => length <= 1500)));
    assert.equal(chunks.flatMap(call => call.texts).join(''), longText);
    assert.ok(chunks.flatMap(call => call.texts).every(text => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(text)));
    await record('long-text-utf16-budget-and-surrogate-safety', {sourceLength: longText.length});

    await patchStoredConfig(optionsPage, {deeplx: CUSTOM_ENDPOINT});
    await mode('success');
    assert.equal(await translate('Respect the configured destination.'), '自定义端点译文。');
    assert.deepEqual((await calls()).map(call => call.kind), ['custom']);
    await record('custom-endpoint-preserves-destination');
    await patchStoredConfig(optionsPage, {deeplx: PUBLIC_ENDPOINT});

    await mode('pending');
    const cancelId = `deeplx-968-cancel-${randomUUID()}`;
    await optionsPage.evaluate(message => { globalThis.__deeplxPending = chrome.runtime.sendMessage(message); }, request('Cancel this public test sentence.', 'zh-Hans', cancelId));
    const pendingDeadline = Date.now() + timeout;
    while (!(await calls()).length && Date.now() < pendingDeadline) await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal((await calls()).length, 1, 'Pending direct request did not start');
    const cancellation = await send({type: 'fluentReadTranslationCancel', clientRequestId: cancelId});
    assert.equal(cancellation.cancelled, true);
    const cancelled = await optionsPage.evaluate(() => globalThis.__deeplxPending);
    assert.equal(cancelled.marker, 'fluentread-translation-error-v1');
    assert.match(cancelled.message, /取消|abort/iu);
    assert.equal(await worker.evaluate(() => globalThis.__deeplxDirectHarness.aborted), 1);
    assert.deepEqual((await calls()).map(call => call.kind), ['direct']);
    await record('cancel-aborts-direct-without-public-fallback');

    await mode('success');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>DeepLX 专项验证</title></head><body style="font:20px/1.7 system-ui;padding:48px"><main><p id="target">${SOURCE}</p><p id="neighbor">This adjacent paragraph must remain untranslated.</p></main></body></html>`;
    server = http.createServer((_request, response) => {response.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); response.end(html);});
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const articleUrl = `http://127.0.0.1:${server.address().port}/deeplx-direct`;
    articlePage = await helper.newPageWithoutForeground(context, timeout);
    articlePage.on('pageerror', error => report.pageErrors.push(error.message));
    await articlePage.goto(articleUrl, {waitUntil: 'domcontentloaded'});
    await articlePage.locator('#fluent-read-page-styles').waitFor({state: 'attached', timeout});
    const original = await articlePage.locator('#target').innerHTML();
    const toggles = [];
    for (const expected of [1, 0, 1]) {
      await helper.activateExtensionTabWithoutForeground(context, articlePage, timeout);
      const box = await articlePage.locator('#target').boundingBox();
      assert.ok(box);
      await articlePage.mouse.click(box.x + 8, box.y + 10);
      await articlePage.keyboard.down('Control'); await articlePage.keyboard.up('Control');
      await articlePage.waitForFunction(expected => document.querySelectorAll('#target .fluent-read-bilingual-content').length === expected, expected, {timeout});
      assert.equal(await articlePage.locator('#neighbor .fluent-read-bilingual-content').count(), 0);
      assert.equal(await articlePage.locator('.fluent-read-bilingual-content .fluent-read-bilingual-content').count(), 0);
      if (expected) assert.equal((await articlePage.locator('#target .fluent-read-bilingual-content').innerText()).trim(), TRANSLATED);
      else assert.equal(await articlePage.locator('#target').innerHTML(), original);
      assert.equal(articlePage.url(), articleUrl);
      toggles.push(expected);
      await safeFocus();
    }
    fs.writeFileSync(path.join(artifactsDir, 'hover-final.html'), await articlePage.locator('main').innerHTML());
    await screenshot(articlePage, 'deeplx-hover-translated');
    await record('trusted-control-hover-translate-restore-retranslate', {toggles, neighborCounts: [0, 0, 0]});

    if (live) {
      await mode('live');
      const result = await translate(LIVE_SOURCE);
      const requests = await calls();
      const directOnly = requests.length === 1 && requests[0].kind === 'direct';
      const ok = directOnly && /[\u3400-\u9fff]/u.test(result);
      report.cases.push({name: 'bounded-live-public-sentence', ok, evidence: 'live-provider', source: LIVE_SOURCE, result, requests,
        limitation: directOnly ? undefined : 'Direct request did not complete; fallback remains synthetic and is not live-provider evidence.'});
    }
    await safeFocus();
    assert.deepEqual(report.pageErrors, []);
    report.ok = report.cases.every(testCase => testCase.ok);
  } catch (error) {
    report.error = {message: error.message, stack: error.stack};
    if (articlePage || optionsPage) await screenshot(articlePage || optionsPage, 'deeplx-failure').catch(() => {});
  } finally {
    let closed = false;
    if (launched) try {await launched.close(); closed = true;} catch (error) {report.cleanupErrors.push(error.message);}
    if (monitor) try {await monitor.stop();} catch (error) {report.cleanupErrors.push(error.message);}
    report.focusEvents = monitor?.events || [];
    report.focusViolation = focusFailure?.message || null;
    if (server) await new Promise(resolve => server.close(resolve));
    if (profileDir && closed) {
      try {fs.rmSync(profileDir, {recursive: true, force: true}); report.temporaryProfileRemoved = true;}
      catch (error) {report.cleanupErrors.push(error.message); report.retainedProfile = profileDir;}
    } else if (profileDir && !launchAttempted) {
      try {fs.rmdirSync(profileDir); report.temporaryProfileRemoved = true;}
      catch (error) {report.cleanupErrors.push(error.message); report.retainedProfile = profileDir;}
    } else if (profileDir) report.retainedProfile = profileDir;
    if (focusFailure || report.cleanupErrors.length || report.error) report.ok = false;
    const reportPath = path.join(artifactsDir, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ok: report.ok, cases: report.cases.map(({name, ok, evidence}) => ({name, ok, evidence})),
      reportPath, screenshots: report.screenshots, error: report.error, cleanupErrors: report.cleanupErrors}, null, 2));
    if (!report.ok) process.exitCode = 1;
  }
})();

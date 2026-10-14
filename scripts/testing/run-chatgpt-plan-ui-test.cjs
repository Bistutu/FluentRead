#!/usr/bin/env node
/**
 * @file scripts/testing/run-chatgpt-plan-ui-test.cjs
 * 文件职责：在独立后台 Edge 的真实生产扩展中验证 ChatGPT 套餐设置与翻译链路。
 * 主要内容：使用只监听 loopback 的 synthetic 助手，覆盖真实请求 Origin、界面配对和待授权状态、模拟回调、账户模型保存、后台翻译 SSE、额度失败、退出以及凭据与配置/导出隔离；记录截图和明确的验证边界。
 * 模块边界：不访问真实 OpenAI 账户、不操作用户浏览器 profile、不移动系统鼠标或抢前台；认证及推理均为标记明确的 fixture，复用已有 focus-safe 和拥有者清理机制。
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, values) => {
  if (value.startsWith('--')) all.push([value.slice(2), values[index + 1]]); return all;
}, []));
for (const field of ['extension-dir', 'playwright-root', 'artifacts-dir']) assert(args[field], `Missing --${field}`);
const {chromium} = createRequire(path.join(args['playwright-root'], 'chatgpt-plan-ui.cjs'))('playwright');
const helper = require(args['focus-safe-helper'] || './focus-safe-browser.cjs');
const extensionDir = path.resolve(args['extension-dir']);
assert(!extensionDir.endsWith('-dev'), 'This suite verifies production extension builds');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const artifacts = path.resolve(args['artifacts-dir']);
fs.mkdirSync(artifacts, {recursive: true});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-chatgpt-plan-'));
const pairCode = 'synthetic-fixture-pairing-code-1234';
const pairToken = 'synthetic-bridge-token-fixture-1234567890';
const state = {connected: false, sharing: false, authPending: false, responseMode: 'success'};
let expectedOrigin = '';
const report = {ok: false, build: 'production', extensionDir, evidence: 'real-extension-synthetic-chatgpt-helper',
  fixtures: {authentication: 'synthetic', account: 'synthetic', models: 'synthetic', inference: 'synthetic', helper: 'owned Node loopback fixture'},
  cases: [], screenshots: [], helperRequests: [], consoleErrors: [], deniedExternalRequests: [],
  unverified: ['real ChatGPT authorization and token refresh', 'real account model availability', 'real provider inference and quota', 'Firefox runtime']};
const save = () => fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
const frame = (type, fields = {}) => `event: ${type}\ndata: ${JSON.stringify({type, ...fields})}\n\n`;
const status = () => ({connected: state.connected, sharing: state.sharing, authPending: state.authPending,
  ...(state.connected ? {account: {name: 'Synthetic ChatGPT Account', email: 'fixture@example.invalid'}} : {})});
const fixture = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const entry = {path: req.url, method: req.method, origin, authorizationPresent: Boolean(req.headers.authorization)};
  report.helperRequests.push(entry);
  const json = (data, code = 200) => {res.writeHead(code, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || expectedOrigin});res.end(JSON.stringify(data));};
  try {
    if (!expectedOrigin || origin !== expectedOrigin) return json({error: {code: 'unauthorized_origin'}}, 403);
    if (req.method === 'OPTIONS') {res.writeHead(204, {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS'});return res.end();}
    if (req.method !== 'POST') return json({error: {code: 'invalid_method'}}, 405);
    const chunks = [];for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (req.url === '/pair') {
      assert.equal(body.code, pairCode); return json({bridgeToken: pairToken});
    }
    if (req.headers.authorization !== `Bearer ${pairToken}`) return json({error: {code: 'pairing_required'}}, 401);
    if (req.url === '/status') return json(status());
    if (req.url === '/auth/start') {state.authPending = true;return json({authorizationUrl: 'https://auth.openai.com/api/accounts/authorize?client_id=synthetic-fixture'});}
    if (req.url === '/auth/cancel') {state.authPending = false;return json(status());}
    if (req.url === '/logout') {state.connected = false;state.sharing = false;state.authPending = false;return json(status());}
    if (req.url === '/models') return json({models: state.connected ? [{slug: 'fixture-account-model', display_name: 'Synthetic Account Model'}, {slug: 'fixture-account-alt', display_name: 'Synthetic Alternative Model'}] : []});
    if (req.url === '/responses') {
      assert(state.connected && state.sharing, 'Responses used before connected sharing');
      assert.equal(body.model, 'fixture-account-model');
      assert(Array.isArray(body.input));
      entry.payloadKeys = Object.keys(body).sort();
      entry.model = body.model;
      res.writeHead(200, {'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': origin});
      if (state.responseMode === 'quota') return res.end(frame('error', {code: 'subscription_sharing_usage_limit_exceeded', message: 'Synthetic quota fixture'}));
      res.write(frame('response.output_text.delta', {delta: '这是测试译文。'}));
      return res.end(frame('response.completed', {response: {status: 'completed', model: body.model,
        output: [{type: 'message', role: 'assistant', status: 'completed', content: [{type: 'output_text', text: '这是测试译文。'}]}],
        usage: {input_tokens: 6, output_tokens: 4, total_tokens: 10}}}));
    }
    return json({error: {code: 'not_found'}}, 404);
  } catch (error) {report.fixtureError = String(error.stack || error);json({error: {code: 'fixture_failure'}}, 500);}
});

(async () => {
  let session, page, control, primaryError, serverListening = false, launchAttempted = false;
  try {
    // Fail if the user's real helper already occupies the port; never stop or replace it.
    await new Promise((resolve, reject) => {fixture.once('error', reject);fixture.listen(18743, '127.0.0.1', resolve);});
    serverListening = true;launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: args['browser-path'] || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      headless: false, background: true, displayTarget: 'secondary', viewport: {width: 1440, height: 1000}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = session.context;context.setDefaultTimeout(15000);
    await context.route(/^https?:\/\//, route => {
      const url = route.request().url();
      if (url.startsWith('http://127.0.0.1:18743/')) return route.continue();
      report.deniedExternalRequests.push(url);
      if (url.startsWith('https://auth.openai.com/api/accounts/authorize')) return route.fulfill({status: 200, contentType: 'text/html', body: '<title>Synthetic OAuth fixture</title><p>Synthetic authentication only.</p>'});
      return route.abort('blockedbyclient');
    });
    const worker = context.serviceWorkers().find(value => value.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', {timeout: 30000});
    expectedOrigin = `chrome-extension://${new URL(worker.url()).host}`;
    report.extensionOrigin = expectedOrigin;
    worker.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({surface: 'worker', message: message.text()});});
    // Browser-created auth tabs may navigate before CDP routing attaches. Keep the actual
    // validated runtime operation but redirect this fixture's tab creation to about:blank.
    // This explicitly synthetic API hook prevents all real identity-provider navigation.
    await worker.evaluate(() => {
      const create = chrome.tabs.create.bind(chrome.tabs);
      globalThis.__chatgptPlanSyntheticAuthTabs = [];
      chrome.tabs.create = (details, callback) => {
        if (typeof details?.url === 'string' && details.url.startsWith('https://auth.openai.com/api/accounts/authorize')) {
          globalThis.__chatgptPlanSyntheticAuthTabs.push(details.url);
          details = {...details, url: 'about:blank', active: false};
        }
        return callback ? create(details, callback) : create(details);
      };
    });
    report.fixtures.authorizationTab = 'synthetic chrome.tabs.create redirect to owned about:blank; production URL validation and background handler still execute';
    const optionsUrl = `${expectedOrigin}/${manifest.options_page || manifest.options_ui.page}`;
    const open = async url => {
      const target = await helper.newPageWithoutForeground(context, 30000);
      target.on('pageerror', error => report.consoleErrors.push({surface: url, message: error.message}));
      await target.goto(url, {waitUntil: 'domcontentloaded'});return target;
    };
    const shot = async name => {
      await helper.activateExtensionTabWithoutForeground(context, page);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const file = path.join(artifacts, `${name}.png`);await page.screenshot({path: file, fullPage: true});report.screenshots.push(file);
    };
    control = await open(`${optionsUrl}#settings-general`);
    await control.getByTestId('default-translation-service-card').waitFor({state: 'visible'});
    const send = message => control.evaluate(message => chrome.runtime.sendMessage(message), message);
    const readConfig = async () => {
      const response = await send({type: 'configStorageRead', key: 'local:config'});assert.equal(response?.success, true);
      return typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
    };
    const current = await readConfig();
    const patch = {uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, service: 'freeTranslation', theme: 'light', translationMaxRetries: 0, useCache: false, enableAIContext: false};
    const persisted = await send({type: 'persistConfig', mode: 'patch', config: patch, expected: Object.fromEntries(Object.keys(patch).map(key => [key, current[key]]))});
    assert.equal(persisted?.success, true);
    page = await open(`${optionsUrl}#settings-services`);
    await page.locator('.service-catalog:visible').waitFor();
    await page.locator('.service-rail [data-service-value="chatgptPlan"]').click();
    await page.locator('[data-chatgpt-plan-settings]:visible').waitFor();
    const guidePending = context.waitForEvent('page');
    await page.locator('.chatgpt-plan-guide').click();
    const guide = await guidePending;
    await guide.waitForURL(`${expectedOrigin}/chatgpt-plan-guide.html`);
    const guideText = await guide.locator('body').innerText();
    assert.match(guideText, /Node\.js|Node/);assert.match(guideText, /安装|Install|install/);
    const guideId = await guide.evaluate(async () => (await chrome.tabs.getCurrent()).id);
    await control.evaluate(async id => {const current = await chrome.tabs.getCurrent();await chrome.tabs.update(current.id, {active: true});await chrome.tabs.remove(id);}, guideId);
    report.cases.push({id: 'real-packaged-installation-guide-link', passed: true, url: `${expectedOrigin}/chatgpt-plan-guide.html`});
    await page.locator('input[data-chatgpt-plan-pair-code], [data-chatgpt-plan-pair-code] input').fill(pairCode);
    await page.locator('[data-chatgpt-plan-pair]').click();
    await page.locator('[data-chatgpt-plan-sign-in]').waitFor({state: 'visible'});
    assert.equal(report.helperRequests.filter(item => item.path === '/pair').length, 1);
    assert(report.helperRequests.every(item => item.origin === expectedOrigin));
    report.cases.push({id: 'real-ui-pairing-and-background-origin', passed: true, origin: expectedOrigin});
    await shot('paired-awaiting-login');
    await page.locator('[data-chatgpt-plan-sign-in]').click();
    await page.locator('[data-chatgpt-plan-waiting]').waitFor({state: 'visible'});
    await page.locator('[data-chatgpt-plan-cancel]').waitFor({state: 'visible'});
    report.cases.push({id: 'real-ui-auth-pending', passed: true, fixture: 'synthetic'});
    await shot('authorization-pending');
    // Authoritative fixture state simulates callback completion; no real OAuth code/token is used.
    state.connected = true;state.sharing = true;state.authPending = false;
    await page.locator('[data-chatgpt-plan-account]').waitFor({state: 'visible', timeout: 15000});
    await page.locator('[data-chatgpt-plan-model-select]').click();
    await page.getByRole('option', {name: 'Synthetic Account Model', exact: true}).click();
    await control.waitForFunction(async () => {
      const response = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const value = typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
      return value?.model?.chatgptPlan === 'fixture-account-model';
    });
    await page.locator('[data-set-default-service-button]:visible').click();
    await control.waitForFunction(async () => {
      const response = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const value = typeof response.value === 'string' ? JSON.parse(response.value) : response.value;return value?.service === 'chatgptPlan';
    });
    const selected = await readConfig();
    assert.equal(selected.model.chatgptPlan, 'fixture-account-model', 'Generic normalization must preserve the discovered account model slug');
    assert.equal(await page.locator('[data-chatgpt-plan-model-unavailable]').count(), 0);
    assert.match(await page.locator('[data-chatgpt-plan-model-select]').innerText(), /Synthetic Account Model/);
    report.cases.push({id: 'synthetic-callback-dynamic-model-persisted', passed: true, model: selected.model.chatgptPlan});
    await shot('connected-model-saved');
    await page.reload();
    await page.locator('[data-chatgpt-plan-model-select]').waitFor({state: 'visible'});
    await page.waitForFunction(() => document.querySelector('[data-chatgpt-plan-model-select]')?.textContent.includes('Synthetic Account Model'));
    assert.equal((await readConfig()).model.chatgptPlan, 'fixture-account-model');
    assert.equal(await page.locator('[data-chatgpt-plan-model-unavailable]').count(), 0);
    report.cases.push({id: 'real-options-reload-keeps-selected-account-model', passed: true});
    await shot('connected-model-reopened');
    const translated = await send({origin: 'This is a synthetic translation pipeline test.', serviceOverride: 'chatgptPlan', useCache: false, enableAIContext: false, clientRequestId: 'synthetic-success-1'});
    assert.equal(translated, '这是测试译文。');
    report.cases.push({id: 'real-background-provider-completed-sse', passed: true, response: translated, fixture: 'synthetic'});
    state.responseMode = 'quota';
    const quota = await send({origin: 'This second fixture must fail with quota.', serviceOverride: 'chatgptPlan', useCache: false, enableAIContext: false, clientRequestId: 'synthetic-quota-1'});
    assert.equal(quota.marker, 'fluentread-translation-error-v1');assert.equal(quota.kind, 'rate-limit');assert.equal(quota.retryable, false);
    report.cases.push({id: 'real-background-quota-not-success', passed: true, kind: quota.kind, retryable: quota.retryable, fixture: 'synthetic'});
    const saved = await readConfig();assert(!JSON.stringify(saved).includes(pairToken));assert(!JSON.stringify(saved).includes(pairCode));
    const forbidden = await send({type: 'configStorageRead', key: 'fluentread.chatgptPlan.pairing.v1'});assert.equal(forbidden.success, false);
    const isolated = await control.evaluate(async () => Boolean((await chrome.storage.local.get('fluentread.chatgptPlan.pairing.v1'))['fluentread.chatgptPlan.pairing.v1']));
    assert.equal(isolated, true);
    report.cases.push({id: 'pairing-token-independent-and-config-read-denied', passed: true});
    const backupPage = await open(`${optionsUrl}#settings-data`);
    await backupPage.getByRole('button', {name: '导出备份', exact: true}).waitFor({state: 'visible'});
    const downloadPending = backupPage.waitForEvent('download');
    await backupPage.getByRole('button', {name: '导出备份', exact: true}).click();
    await backupPage.getByRole('button', {name: '不包含并导出', exact: true}).click();
    const download = await downloadPending, backupPath = path.join(artifacts, 'synthetic-backup.json');await download.saveAs(backupPath);
    const backup = fs.readFileSync(backupPath, 'utf8');assert(!backup.includes(pairToken));assert(!backup.includes(pairCode));
    assert(!backup.includes('fluentread.chatgptPlan.pairing.v1'));
    report.cases.push({id: 'real-ui-backup-excludes-pairing-token', passed: true, exported: backupPath});
    await page.locator('[data-chatgpt-plan-disconnect]').click();
    await page.locator('[data-chatgpt-plan-sign-in]').waitFor({state: 'visible'});
    assert.equal(state.connected, false);assert.equal(state.sharing, false);
    report.cases.push({id: 'real-ui-logout', passed: true});await shot('logged-out');
    const locale = (await readConfig()).uiLanguage;
    assert.equal((await send({type: 'persistConfig', mode: 'patch', config: {uiLanguage: 'en-US'}, expected: {uiLanguage: locale}})).success, true);
    await page.waitForFunction(() => document.querySelector('.detail-title-row h4')?.textContent.trim() === 'ChatGPT Plan');
    report.englishLayout = await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const selectors = ['.service-detail', '.detail-hero', '.detail-hero .service-brand-icon', '.detail-heading', '.detail-title-row', '.detail-title-row h4', '.hero-service-actions'];
      return selectors.map(selector => {const node = document.querySelector(selector), rect = node.getBoundingClientRect(), style = getComputedStyle(node);return {selector,
        rect: {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height},
        scrollLeft: node.scrollLeft, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
        css: {display: style.display, overflow: style.overflow, minWidth: style.minWidth, flex: style.flex, flexWrap: style.flexWrap, justifyContent: style.justifyContent, transform: style.transform}};});
    });
    const englishDetail = report.englishLayout.find(item => item.selector === '.service-detail').rect;
    for (const selector of ['.detail-title-row h4', '.detail-hero .service-brand-icon']) {
      const rect = report.englishLayout.find(item => item.selector === selector).rect;
      assert(rect.left >= englishDetail.left - 1 && rect.right <= englishDetail.right + 1, `English header outside detail: ${JSON.stringify(report.englishLayout)}`);
    }
    report.cases.push({id: 'real-service-label-localizes-in-English', passed: true});await shot('logged-out-English');
    assert(report.helperRequests.filter(item => item.path === '/responses').length === 2);
    assert(report.helperRequests.every(item => item.origin === expectedOrigin));
    report.syntheticAuthTabs = await worker.evaluate(() => globalThis.__chatgptPlanSyntheticAuthTabs);
    assert.equal(report.syntheticAuthTabs.length, 1);
    assert.deepEqual(report.deniedExternalRequests, []);
    assert(!report.fixtureError);assert.deepEqual(report.consoleErrors, []);
    report.ok = true;
  } catch (error) {
    primaryError = error;report.error = error.stack;process.exitCode = 1;
    try {if (page && !page.isClosed()) await page.screenshot({path: path.join(artifacts, 'failure.png'), fullPage: true});}
    catch (diagnosticError) {report.failureScreenshotError = String(diagnosticError);}
    try {if (page && !page.isClosed()) {const file = path.join(artifacts, 'failure.html');fs.writeFileSync(file, await page.content());report.failureDOM = file;}}
    catch (diagnosticError) {report.failureDOMError = String(diagnosticError);}
  } finally {
    let closed = false;
    try {if (session) {await session.close();closed = true;}}
    catch (error) {report.ok = false;process.exitCode = 1;(report.cleanupErrors ||= []).push(String(error));}
    if (closed || !launchAttempted) fs.rmSync(profileDir, {recursive: true, force: true});else report.retainedProfile = profileDir;
    if (serverListening) await new Promise(resolve => fixture.close(resolve));
    save();console.log(JSON.stringify(report, null, 2));if (primaryError) console.error(primaryError);
  }
})().catch(error => {console.error(error);process.exitCode = 1;});

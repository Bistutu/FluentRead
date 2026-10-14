#!/usr/bin/env node
/**
 * @file scripts/testing/run-chatgpt-plan-ui-test.cjs
 * 文件职责：在独立后台 Edge 的真实生产扩展中验证 ChatGPT 套餐设置与翻译链路。
 * 主要内容：public-availability 模式验证公共版本不探测本机、不提供配对或新选择，保留旧服务与模型并返回不可用；原实验模式保留 synthetic 助手的配对与 SSE 专项。记录真实选择器、后台消息、截图、源码摘要及清理结果，其他供应商的成功推理仅用明确标记的 transport fixture。
 * 模块边界：不访问真实 OpenAI 账户、不操作用户浏览器 profile、不移动系统鼠标或抢前台；认证及推理均为标记明确的 fixture，复用已有 focus-safe 和拥有者清理机制。
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, values) => {
  if (value.startsWith('--')) all.push([value.slice(2), values[index + 1]]); return all;
}, []));
for (const field of ['extension-dir', 'playwright-root', 'artifacts-dir']) assert(args[field], `Missing --${field}`);
const {chromium} = createRequire(path.join(args['playwright-root'], 'chatgpt-plan-ui.cjs'))('playwright');
const helper = require(args['focus-safe-helper'] || './focus-safe-browser.cjs');
const extensionDir = path.resolve(args['extension-dir']);
const publicAvailability = process.argv.includes('--public-availability');
const developerFixture = process.argv.includes('--developer-fixture');
assert(publicAvailability !== developerFixture, 'Choose exactly one explicit mode: --public-availability or --developer-fixture');
if (publicAvailability) assert(!extensionDir.endsWith('-dev'), 'Public availability requires a production extension build');
else assert(extensionDir.endsWith('-dev'), 'Developer fixture requires an explicitly enabled development extension build');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const artifacts = path.resolve(args['artifacts-dir']);
fs.mkdirSync(artifacts, {recursive: true});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-chatgpt-plan-'));
const pairCode = 'synthetic-fixture-pairing-code-1234';
const pairToken = 'synthetic-bridge-token-fixture-1234567890';
const state = {connected: false, sharing: false, authPending: false, responseMode: 'success'};
let expectedOrigin = '';
const report = {ok: false, build: publicAvailability ? 'production' : 'development', extensionDir, evidence: 'real-extension-synthetic-chatgpt-helper',
  fixtures: {authentication: 'synthetic', account: 'synthetic', models: 'synthetic', inference: 'synthetic', helper: 'owned Node loopback fixture'},
  cases: [], screenshots: [], helperRequests: [], consoleErrors: [], deniedExternalRequests: [],
  unverified: ['real ChatGPT authorization and token refresh', 'real account model availability', 'real provider inference and quota', 'Firefox runtime']};
if (publicAvailability) Object.assign(report, {mode: 'public-availability', evidence: 'real-public-production-extension',
  fixtures: {savedConfig: 'synthetic previous service and model preferences', otherProviderInference: 'synthetic MyMemory response', helper: 'not started', authentication: 'not invoked'},
  publicNetworkAttempts: [], publicRouteAttempts: [], otherProviderRequests: [],
  unverified: ['approved public ChatGPT client', 'real provider inference and quota', 'Firefox runtime']});
const sourceDigest = () => {
  const root = path.resolve(__dirname, '../..');
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src', 'userscript', 'entrypoints', 'wxt.config.ts'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');for (const file of paths) {hash.update(file);hash.update(fs.readFileSync(path.join(root, file)));}
  return {sha256: hash.digest('hex'), files: paths.length};
};
if (publicAvailability) report.sourceBefore = sourceDigest();
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

async function runPublicAvailability({context, worker, optionsUrl, open, send, readConfig, shot, selectPage}) {
  const record = (id, details = {}) => report.cases.push({id, passed: true, ...details});
  const screenshot = async (surface, name) => {selectPage(surface);await shot(name);};
  const readSaved = value => ({service: value.service, model: value.model?.chatgptPlan, documentService: value.documentService,
    documentModel: value.documentModel?.chatgptPlan, readingService: value.harness?.service, readingModel: value.harness?.model,
    writingService: value.writing?.service, writingModel: value.writing?.model});
  // Observe the production worker's actual fetch boundary. An unexpected helper attempt
  // is recorded and refused, so this test cannot contact an existing personal helper.
  await worker.evaluate(() => {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.__publicPlanNetworkAttempts = [];globalThis.__publicOtherProviderRequests = [];
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname.endsWith('openai.com')) {
        globalThis.__publicPlanNetworkAttempts.push({origin: url.origin, path: url.pathname});
        return Promise.reject(new Error('Unexpected public ChatGPT network attempt blocked by test observer'));
      }
      if (url.hostname === 'api.mymemory.translated.net') {
        globalThis.__publicOtherProviderRequests.push({origin: url.origin, path: url.pathname});
        return Promise.resolve(new Response(JSON.stringify({responseStatus: 200, responseData: {translatedText: '普通服务测试译文。'}}), {headers: {'content-type': 'application/json'}}));
      }
      return original(input, init);
    };
  });
  const current = await readConfig();
  const patch = {uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, theme: 'light', on: true, service: 'chatgptPlan', useCache: false,
    translationMaxRetries: 0, enableAIContext: false, model: {...current.model, chatgptPlan: 'saved-account-model'},
    documentService: 'chatgptPlan', documentModel: {...current.documentModel, chatgptPlan: 'saved-document-model'},
    harness: {...current.harness, enabled: true, service: 'chatgptPlan', model: 'saved-reading-model'},
    writing: {...current.writing, enabled: true, service: 'chatgptPlan', model: 'saved-writing-model'}};
  assert.equal((await send({type: 'persistConfig', mode: 'patch', config: patch, expected: Object.fromEntries(Object.keys(patch).map(key => [key, current[key]]))})).success, true);
  const saved = readSaved(await readConfig());report.savedConfiguration = saved;
  assert.equal(saved.service, 'chatgptPlan');assert.equal(saved.model, 'saved-account-model');
  const assertHiddenPlanDetails = async surface => {
    selectPage(surface);
    await surface.locator('.service-catalog:visible').waitFor();
    await surface.waitForFunction(() => {
      const catalog = document.querySelector('.service-catalog'), service = catalog?.getAttribute('data-editing-service');
      return Boolean(service && service !== 'chatgptPlan' && catalog.getAttribute('data-default-service') === 'chatgptPlan');
    });
    const catalog = surface.locator('.service-catalog:visible');
    assert.equal(await catalog.getAttribute('data-default-service'), 'chatgptPlan');
    const editingService = await catalog.getAttribute('data-editing-service');
    assert.notEqual(editingService, 'chatgptPlan');
    assert(await surface.locator(`.service-rail [data-service-value="${editingService}"]`).count() > 0);
    await surface.locator(`[data-service-configuration-service="${editingService}"]:visible`).waitFor();
    const title = await surface.locator('.detail-title-row h4').innerText();assert.doesNotMatch(title, /ChatGPT/u);
    assert.equal(await surface.locator('.service-rail [data-service-value="chatgptPlan"], [data-service-configuration-service="chatgptPlan"]').count(), 0);
    assert.equal(await surface.locator('[data-chatgpt-plan-settings], [data-chatgpt-plan-unavailable], [data-chatgpt-plan-pair], [data-chatgpt-plan-pair-code], [data-chatgpt-plan-sign-in], .chatgpt-plan-command, .chatgpt-plan-guide').count(), 0);
    assert.doesNotMatch(await surface.locator('.service-detail').innerText(), /ChatGPT\s*(?:登录|套餐)|node integrations|本机助手|配对码|启动助手/u);
    assert.deepEqual(readSaved(await readConfig()), saved);
    return {editingService, title};
  };
  const services = await open(`${optionsUrl}#settings-services`);
  record('saved-plan-details-hidden-with-available-service-editor', await assertHiddenPlanDetails(services));
  await screenshot(services, 'public-saved-chatgpt-detail-hidden');
  await services.reload();await assertHiddenPlanDetails(services);
  assert.deepEqual(readSaved(await readConfig()), saved);record('saved-plan-and-all-feature-models-survive-options-reload');
  const deepLink = await open(`${optionsUrl}?service=chatgptPlan#settings-services`);
  record('chatgpt-deep-link-opens-normal-service-editor-without-login-details', await assertHiddenPlanDetails(deepLink));
  await screenshot(deepLink, 'public-chatgpt-deep-link-detail-hidden');
  const assertSelect = async (surface, name, id) => {
    selectPage(surface);
    const control = surface.getByRole('combobox', {name, exact: true});await control.click();
    await surface.getByRole('option', {name: /Google|OpenAI|B站|微软/}).first().waitFor({state: 'visible'});
    // The empty "follow default" choice may name the retained unavailable default;
    // it does not add a ChatGPT service ID and still resolves through the request gate.
    const choices = surface.getByRole('option', {name: /^ChatGPT/u});
    (report.pickerCandidates ||= []).push({id, matches: await choices.evaluateAll(nodes => nodes.map(node => ({text: node.textContent, className: node.className, ariaDisabled: node.getAttribute('aria-disabled'), html: node.outerHTML}))) });
    for (const choice of await choices.all()) assert(await choice.getAttribute('aria-disabled') === 'true' || /is-disabled/.test(await choice.getAttribute('class') || ''), `${id}: public ChatGPT option was selectable`);
    record(id, {retainedDisabledOptions: await choices.count()});await screenshot(surface, id);await control.press('Escape');
  };
  const general = await open(`${optionsUrl}#settings-general`);await general.getByTestId('default-translation-service-card').waitFor();
  await assertSelect(general, '默认网页翻译服务', 'public-general-picker-no-new-chatgpt');
  const inheritedHover = general.locator('[data-feature-service="hover"]');
  assert.equal((await readConfig()).hoverTranslationService, '');
  assert.match(await inheritedHover.innerText(), /跟随默认.*ChatGPT 套餐/u);
  assert.doesNotMatch(await inheritedHover.innerText(), /chatgptPlan/u);
  await inheritedHover.getByRole('combobox').click();
  const followDefault = general.getByRole('option', {name: '跟随默认 · ChatGPT 套餐', exact: true});
  await followDefault.waitFor({state: 'visible'});assert.equal(await followDefault.isDisabled(), false);
  await screenshot(general, 'public-general-inherits-named-chatgpt');await followDefault.click();
  assert.equal((await readConfig()).hoverTranslationService, '');assert.deepEqual(readSaved(await readConfig()), saved);
  record('public-general-inheritance-label-and-empty-value', {label: '跟随默认 · ChatGPT 套餐', inheritedValue: ''});
  const reading = await open(`${optionsUrl}#settings-selection`);
  await reading.getByRole('combobox', {name: '学习讲解服务', exact: true}).waitFor();
  await assertSelect(reading, '学习讲解服务', 'public-reading-picker-no-new-chatgpt');
  const writing = await open(`${optionsUrl}#settings-writing`);
  await writing.getByRole('combobox', {name: '写作服务', exact: true}).waitFor();
  await assertSelect(writing, '写作服务', 'public-writing-picker-no-new-chatgpt');
  assert.match(await writing.locator('.writing-setup-message').first().innerText(), /ChatGPT.*尚未开放/);
  const documentPage = await open(`${expectedOrigin}/document.html`);
  await documentPage.locator('input[type="file"]').setInputFiles({name: 'public-availability-fixture.txt', mimeType: 'text/plain', buffer: Buffer.from('This is an owned document fixture for a public service picker check.')});
  await documentPage.getByRole('combobox', {name: '翻译服务', exact: true}).waitFor();
  await assertSelect(documentPage, '翻译服务', 'public-document-picker-no-new-chatgpt');
  const documentDisabled = await documentPage.locator('.toolbar-service').innerText();
  const accurateDocumentLabel = /ChatGPT/u.test(documentDisabled) && !/Chrome/u.test(documentDisabled);
  record('document-retained-unavailable-label-names-chatgpt', {passed: accurateDocumentLabel, label: documentDisabled});
  if (!accurateDocumentLabel) (report.productFailures ||= []).push('document-retained-unavailable-label-names-chatgpt');
  const popup = await open(`${expectedOrigin}/${manifest.action.default_popup}`);
  selectPage(popup);
  await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();await popup.getByTestId('popup-feature-services').click();
  for (const feature of ['default', 'reading', 'writing']) {
    await popup.locator(`[data-feature-service="${feature}"]`).click();await popup.locator(`[data-service-picker="${feature}"]`).waitFor();
    const retained = popup.locator('[data-service-choice="chatgptPlan"]');
    for (const choice of await retained.all()) assert.equal(await choice.isDisabled(), true);
    record(`public-popup-${feature}-picker-no-new-chatgpt`, {retainedDisabledOptions: await retained.count()});
    await popup.locator('.service-picker-back').click();
  }
  await screenshot(popup, 'public-popup-keeps-unavailable-saved-plan');
  assert.deepEqual(readSaved(await readConfig()), saved);record('selector-inspection-does-not-reset-saved-service-or-slugs');
  const blocked = await send({origin: 'Public ChatGPT request must stop locally.', serviceOverride: 'chatgptPlan', useCache: false, enableAIContext: false, clientRequestId: 'public-unavailable-translation'});
  assert.equal(blocked.marker, 'fluentread-translation-error-v1');assert.equal(blocked.retryable, false);assert.match(blocked.message, /ChatGPT.*尚未开放/);
  record('production-broker-refuses-saved-plan-before-upstream', {kind: blocked.kind, retryable: blocked.retryable});
  const readingResult = await send({type: 'fluentReadHarness', action: 'run', requestId: 'public-unavailable-reading', intent: 'meaning', question: '', selection: {text: 'Owned reading fixture.', context: '', sentence: ''}});
  assert.equal(readingResult.success, false);assert.match(readingResult.error, /ChatGPT.*尚未开放/);record('production-reading-refuses-saved-plan');
  for (const action of ['status', 'pair', 'signIn', 'cancel', 'disconnect', 'models', 'usage']) {
    const result = await send({type: 'chatgptPlanConnection', action, ...(action === 'pair' ? {code: pairCode} : {})});
    assert.deepEqual(result, {success: false, code: 'public_unavailable'});
  }
  record('all-production-connection-actions-refused-before-helper');
  await popup.locator('[data-feature-service="default"]').click();await popup.locator('[data-service-choice="myMemory"]').click();
  await popup.waitForFunction(async () => {const response = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});const value = typeof response.value === 'string' ? JSON.parse(response.value) : response.value;return value?.service === 'myMemory';});
  const selected = await readConfig();assert.equal(selected.service, 'myMemory');assert.equal(selected.model.chatgptPlan, saved.model);record('normal-provider-can-be-chosen-without-removing-saved-chatgpt-model');
  const ordinary = await send({origin: 'This normal provider remains available.', serviceOverride: 'myMemory', sourceLanguage: 'en', targetLanguage: 'zh-Hans', useCache: false, enableAIContext: false, clientRequestId: 'public-normal-provider'});
  assert.equal(ordinary, '普通服务测试译文。');record('normal-provider-production-broker-still-works', {inference: 'synthetic MyMemory fixture'});
  const normalServices = await open(`${optionsUrl}#settings-services`);await normalServices.locator('.service-catalog:visible').waitFor();
  assert.equal(await normalServices.locator('.service-rail [data-service-value="chatgptPlan"]').count(), 0);
  assert.equal(await normalServices.locator('[data-chatgpt-plan-settings]').count(), 0);record('new-public-service-directory-omits-plan');await screenshot(normalServices, 'public-normal-service-directory');
  report.publicNetworkAttempts = [...await worker.evaluate(() => globalThis.__publicPlanNetworkAttempts), ...report.publicRouteAttempts];
  report.otherProviderRequests = await worker.evaluate(() => globalThis.__publicOtherProviderRequests);
  assert.deepEqual(report.publicNetworkAttempts, []);assert.equal(report.otherProviderRequests.length, 1);
  assert.deepEqual(report.helperRequests, []);assert.deepEqual(report.consoleErrors, []);assert.deepEqual(report.deniedExternalRequests, []);
  record('no-helper-or-openai-network-attempts');report.savedConfigurationAfterInspection = saved;
  assert.deepEqual(report.productFailures || [], [], 'Product regressions recorded above');
}

(async () => {
  let session, page, control, primaryError, serverListening = false, launchAttempted = false;
  try {
    // Fail if the user's real helper already occupies the port; never stop or replace it.
    if (!publicAvailability) {await new Promise((resolve, reject) => {fixture.once('error', reject);fixture.listen(18743, '127.0.0.1', resolve);});serverListening = true;}
    launchAttempted = true;
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
      const parsed = new URL(url);
      if (publicAvailability && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname.endsWith('openai.com'))) {
        report.publicRouteAttempts.push({origin: parsed.origin, path: parsed.pathname});return route.abort('blockedbyclient');
      }
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
    if (!publicAvailability) await worker.evaluate(() => {
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
    if (!publicAvailability) report.fixtures.authorizationTab = 'synthetic chrome.tabs.create redirect to owned about:blank; production URL validation and background handler still execute';
    const optionsUrl = `${expectedOrigin}/${manifest.options_page || manifest.options_ui.page}`;
    const open = async url => {
      const target = await helper.newPageWithoutForeground(context, 30000);
      target.on('pageerror', error => report.consoleErrors.push({surface: url, message: error.message}));
      if (publicAvailability) target.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({surface: url, message: message.text()});});
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
    if (publicAvailability) {
      await runPublicAvailability({context, worker, optionsUrl, open, send, readConfig, shot, selectPage: target => {page = target;}});
      report.ok = true;return;
    }
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
    report.cleanup = {browserClosed: closed, profileRemoved: !fs.existsSync(profileDir), helperStarted: serverListening, helperClosed: !fixture.listening};
    if (publicAvailability) {report.sourceAfter = sourceDigest();report.sourceUnchanged = report.sourceBefore.sha256 === report.sourceAfter.sha256;
      if (!report.sourceUnchanged) {report.ok = false;process.exitCode = 1;report.sourceChangedDuringTest = true;}}
    save();console.log(JSON.stringify(report, null, 2));if (primaryError) console.error(primaryError);
  }
})().catch(error => {console.error(error);process.exitCode = 1;});

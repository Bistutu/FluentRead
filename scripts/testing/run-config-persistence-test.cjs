/**
 * @file scripts/testing/run-config-persistence-test.cjs
 * 文件职责：用最终扩展产物在隔离后台 Edge 验证 popup/options 短生命周期配置保存。
 * 主要内容：通过真实 UI 修改布尔、语言、网页服务与划词模式，界面反馈后立即关闭并独立重开；验证 options 到 popup 同步及连续语言修改的最新值，记录保存消息、响应、当前权威配置端口与截图。
 * 模块边界：只使用本次临时 profile 的合成配置和现有配置消息，不读取用户配置、不请求翻译服务、不延迟保存，也不运行历史或完整 UI 套件。
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {waitForAsyncCondition} = require('./wait-for-async-condition.cjs');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const arg = (name, fallback) => {const index = process.argv.indexOf(`--${name}`);return index < 0 ? fallback : process.argv[index + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-config-persistence'));
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const helper = require(path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))));
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const popupPath = manifest.action?.default_popup || manifest.browser_action?.default_popup;
const optionsPath = manifest.options_ui?.page || manifest.options_page;
assert.ok(popupPath && optionsPath, 'manifest must declare both actual extension UI entries');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-config-persistence-'));
const publicFields = ['on', 'to', 'service', 'disableImageTranslator', 'selectionTranslatorMode'];
const languageLabels = {en: 'English', de: 'Deutsch', ja: '日本語'};
const serviceLabels = {freeTranslation: '免费翻译服务', microsoft: '微软翻译'};
const report = {ok: false, extensionDir, production: !extensionDir.endsWith('-dev'), manifest: {version: manifest.version, popup: popupPath, options: optionsPath},
  scope: 'Eight short-lived real UI cases in isolated temporary Edge; actual manifest pages, current encrypted-authority ports, live and reopened options→popup sync. No history/full suite, provider calls, artificial delay or user profile.',
  persistenceCases: [], quickClose: false, crossPageSync: false, latestWriteWins: false, consoleErrors: [], consoleWarnings: [],
  screenshots: [], pageMessages: [], workerMessages: [], fixtureWrites: [], cleanup: {profileRemoved: false}};
fs.mkdirSync(artifactsDir, {recursive: true});
let session, control, worker, activePage, livePopup, origin, pendingCase, fixtureSequence = 0;
const saveReport = () => fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
function attachDiagnostics(page, label) {
  page.on('pageerror', error => report.consoleErrors.push({label, type: 'pageerror', error: error.message}));
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push({label, type: 'console', error: message.text()});
    if (message.type() === 'warning') report.consoleWarnings.push({label, error: message.text()});
  });
}
async function readConfig() {
  const response = await control.evaluate(() => chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}));
  assert.equal(response?.success, true, 'current configuration authority read must succeed');
  const value = typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
  assert.ok(value && typeof value === 'object', 'authority must return an initialized configuration');
  return value;
}
const snapshot = config => Object.fromEntries([...publicFields, '__fluentConfigRevision'].map(field => [field, config[field]]));
async function fixturePatch(config) {
  const current = await readConfig();
  const response = await control.evaluate(payload => chrome.runtime.sendMessage(payload), {type: 'persistConfig', mode: 'patch', config,
    expected: Object.fromEntries(Object.keys(config).map(field => [field, current[field]])), clientId: 'config-persistence-fixture',
    sequence: ++fixtureSequence, baseRevision: current.__fluentConfigRevision || 0});
  assert.equal(response?.success, true, 'synthetic fixture write must succeed');
  report.fixtureWrites.push({fields: Object.keys(config), success: response.success, revision: response.revision});
}
async function open(surface, section = 'settings-general') {
  const page = await helper.newPageWithoutForeground(session.context, 30000);activePage = page;
  attachDiagnostics(page, `${surface}:${section}`);
  await page.setViewportSize(surface === 'popup' ? {width: 400, height: 600} : {width: 1440, height: 1000});
  await page.goto(`${origin}/${surface === 'popup' ? popupPath : optionsPath}${surface === 'options' ? `#${section}` : ''}`, {waitUntil: 'domcontentloaded'});
  await page.locator(surface === 'popup' ? '.popup-shell[data-config-ready="true"]' : '.settings-app').waitFor();
  if (surface === 'options') await page.locator(section === 'settings-selection' ? '[role="radiogroup"][aria-label="划词显示内容"]' : '[data-testid="plugin-master-setting"] [role="switch"]').waitFor();
  return page;
}
async function screenshot(page, name) {
  const file = path.join(artifactsDir, `${name}.png`);await page.screenshot({path: file, animations: 'disabled'});report.screenshots.push(file);return file;
}
async function waitAttribute(locator, name, value) {
  await waitForAsyncCondition(async () => (await locator.getAttribute(name)) === String(value), {timeoutMs: 15000, pollingMs: 25, message: `UI ${name}=${value}`});
}
async function targetMatches(page, surface, value) {
  const select = page.locator(surface === 'popup' ? '.language-pair label' : '[data-config-field="to"]');
  const target = surface === 'popup' ? select.nth(1).locator('.fluentread-select') : select;
  await waitForAsyncCondition(async () => (await target.textContent()).includes(languageLabels[value]), {timeoutMs: 15000, pollingMs: 25, message: `target language UI ${value}`});
  return (await target.textContent()).trim();
}
async function chooseTarget(page, surface, value) {
  const select = surface === 'popup' ? page.locator('.language-pair label').nth(1) : page.locator('[data-config-field="to"]');
  await select.locator('.el-select__wrapper').click();
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({hasText: languageLabels[value]}).click();
  return targetMatches(page, surface, value);
}
async function selectionDrawer(page) {
  await page.locator('[data-popup-quick-feature="selection"]').click();
  await page.locator('.drawer-content [role="group"][aria-label="划词翻译模式"]').waitFor();
}
async function selectionMatches(page, surface, value) {
  if (surface === 'popup') await selectionDrawer(page);
  const label = value === 'translation-only' ? '仅译文' : surface === 'popup' ? '双语显示' : '双语';
  const button = surface === 'popup' ? page.getByRole('group', {name: '划词翻译模式', exact: true}).getByRole('button', {name: label, exact: true})
    : page.getByRole('radiogroup', {name: '划词显示内容', exact: true}).getByRole('radio', {name: label, exact: true});
  await waitAttribute(button, surface === 'popup' ? 'aria-pressed' : 'aria-checked', true);
  return {selected: label};
}
async function chooseSelection(page, surface, value) {
  if (surface === 'popup') await selectionDrawer(page);
  const label = value === 'translation-only' ? '仅译文' : surface === 'popup' ? '双语显示' : '双语';
  const button = surface === 'popup' ? page.getByRole('group', {name: '划词翻译模式', exact: true}).getByRole('button', {name: label, exact: true})
    : page.getByRole('radiogroup', {name: '划词显示内容', exact: true}).getByRole('radio', {name: label, exact: true});
  await button.click();await waitAttribute(button, surface === 'popup' ? 'aria-pressed' : 'aria-checked', true);return {selected: label};
}
async function serviceMatches(page, surface, value) {
  if (surface === 'options') {
    const card = page.locator('[data-testid="default-translation-service-card"]');await waitAttribute(card, 'data-default-service', value);
    return {service: await card.getAttribute('data-default-service')};
  }
  const label = page.locator('.provider-summary-heading > strong');
  await waitForAsyncCondition(async () => (await label.textContent()).trim() === serviceLabels[value], {timeoutMs: 15000, pollingMs: 25, message: `popup service UI ${value}`});
  return {service: (await label.textContent()).trim()};
}
async function chooseService(page, surface, value) {
  if (surface === 'popup') {
    await page.locator('[data-testid="popup-feature-services"]').click();
    await page.locator('[data-feature-service="default"]').click();await page.locator(`[data-service-choice="${value}"]`).click();
  } else {
    await page.locator('[data-testid="default-translation-service-card"] .el-select__wrapper').click();
    await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({hasText: serviceLabels[value]}).click();
  }
  return serviceMatches(page, surface, value);
}
async function imageMatches(page, value, mutate = false) {
  await page.locator('[data-popup-quick-feature="image"]').click();
  const toggle = page.getByRole('switch', {name: '启用或关闭图片翻译', exact: true});
  if (mutate) await toggle.click();await waitAttribute(toggle, 'aria-checked', !value);
  return {ariaChecked: await toggle.getAttribute('aria-checked')};
}
async function masterMatches(page, value, mutate = false) {
  const toggle = page.locator('[data-testid="plugin-master-setting"] [role="switch"]');
  if (mutate) await toggle.click();await waitAttribute(toggle, 'aria-checked', value);return {ariaChecked: await toggle.getAttribute('aria-checked')};
}
async function closeAfterFeedback(page, feedbackAt) {
  const closeRequestedAt = Date.now();await page.close({runBeforeUnload: true});
  if (!page.isClosed()) await page.waitForEvent('close', {timeout: 15000});
  return {action: 'real document close with beforeunload/pagehide', feedbackToCloseRequestedMs: closeRequestedAt - feedbackAt, closed: page.isClosed()};
}
async function runCase({name, surface, section, field, writes, mutate, reopened, crossPopup}) {
  const before = snapshot(await readConfig());assert.notEqual(before[field], writes.at(-1), 'case must make an actual setting change');
  let page = await open(surface, section);
  pendingCase = {name, surface, section: section || 'settings-general', field, before, writes, messageStart: report.pageMessages.length};
  report.pendingCase = pendingCase;
  pendingCase.feedback = await mutate(page);const feedbackAt = Date.now();
  pendingCase.close = await closeAfterFeedback(page, feedbackAt);
  // No storage/ACK wait occurs before closing. An independent new document must hydrate the last value.
  page = await open(surface, section);pendingCase.reopenedUi = await reopened(page);
  await waitForAsyncCondition(async () => (await readConfig())[field] === writes.at(-1), {timeoutMs: 15000, pollingMs: 50, message: `authority persisted ${name}`});
  pendingCase.authority = snapshot(await readConfig());pendingCase.authorityReadSuccess = true;
  assert.ok(pendingCase.authority.__fluentConfigRevision > before.__fluentConfigRevision, 'authority revision must advance after a real UI edit');
  pendingCase.screenshot = await screenshot(page, `${name}-reopened`);
  await page.close();
  if (crossPopup) {
    pendingCase.livePopupUi = await crossPopup(livePopup);
    const popup = await open('popup');pendingCase.crossPageReopenedUi = await crossPopup(popup);
    pendingCase.crossPageScreenshot = await screenshot(popup, `${name}-popup-cross-page`);await popup.close();
  }
  report.persistenceCases.push({...pendingCase, passed: true});console.log(`PASS ${name}`);delete report.pendingCase;pendingCase = undefined;saveReport();
}
(async () => {
  try {
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir, browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      background: true, headless: false, displayTarget: 'secondary', viewport: {width: 1440, height: 1000},
      browserArgs: ['--no-first-run', '--no-default-browser-check', `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]});
    guardBrowserClose(session, profileDir);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = session.context;
    await context.exposeBinding('__recordConfigPersistence', ({page}, event) => report.pageMessages.push({surface: page.url().split('/').at(-1), ...event}));
    await context.addInitScript(fields => {
      if (!globalThis.chrome?.runtime?.sendMessage) return;
      const native = chrome.runtime.sendMessage.bind(chrome.runtime);
      const summarize = message => ({type: message.type, patches: (message.patches || [message]).map(patch => ({sequence: patch.sequence,
        values: Object.fromEntries(fields.filter(field => Object.hasOwn(patch.config || {}, field)).map(field => [field, patch.config[field]]))}))});
      const record = event => {void globalThis.__recordConfigPersistence(event).catch(() => {});};
      chrome.runtime.sendMessage = (...args) => {
        const message = args[0], relevant = ['persistConfig', 'persistConfigBatch'].includes(message?.type);
        if (relevant) record({phase: 'request', ...summarize(message)});
        const callback = args.at(-1);
        if (relevant && typeof callback === 'function') args[args.length - 1] = function (response) {
          record({phase: 'response', type: message.type, success: response?.success, revision: response?.revision, error: response?.error});
          return callback.apply(this, arguments);
        };
        const result = native(...args);
        if (relevant && result?.then) return result.then(response => {
          record({phase: 'response', type: message.type, success: response?.success, revision: response?.revision, error: response?.error});return response;
        });
        return result;
      };
    }, publicFields);
    worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', {timeout: 30000});
    worker.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({label: 'worker', error: message.text()});});
    await worker.evaluate(fields => {
      globalThis.__configPersistenceMessages = [];
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (['persistConfig', 'persistConfigBatch'].includes(message?.type)) globalThis.__configPersistenceMessages.push({type: message.type,
          surface: sender.url?.split('/').at(-1), patches: (message.patches || [message]).map(patch => ({sequence: patch.sequence,
            values: Object.fromEntries(fields.filter(field => Object.hasOwn(patch.config || {}, field)).map(field => [field, patch.config[field]]))}))});
      });
    }, publicFields);
    origin = `chrome-extension://${new URL(worker.url()).host}`;
    control = await helper.newPageWithoutForeground(context);await control.goto(`${origin}/icon/128.png`);attachDiagnostics(control, 'fixture-control');
    await fixturePatch({uiLanguageSetupCompleted: true, uiLanguage: 'zh-CN', on: true, to: 'zh-Hans', service: 'freeTranslation',
      disableImageTranslator: false, selectionTranslatorMode: 'bilingual', selectionTranslatorModeBeforeDisable: 'bilingual', theme: 'light'});
    await runCase({name: 'popup-boolean-image', surface: 'popup', field: 'disableImageTranslator', writes: [true], mutate: page => imageMatches(page, true, true), reopened: page => imageMatches(page, true)});
    await runCase({name: 'popup-target-language', surface: 'popup', field: 'to', writes: ['en'], mutate: page => chooseTarget(page, 'popup', 'en'), reopened: page => targetMatches(page, 'popup', 'en')});
    await runCase({name: 'popup-default-service', surface: 'popup', field: 'service', writes: ['microsoft'], mutate: page => chooseService(page, 'popup', 'microsoft'), reopened: page => serviceMatches(page, 'popup', 'microsoft')});
    await runCase({name: 'popup-drawer-selection', surface: 'popup', field: 'selectionTranslatorMode', writes: ['translation-only'], mutate: page => chooseSelection(page, 'popup', 'translation-only'), reopened: page => selectionMatches(page, 'popup', 'translation-only')});
    livePopup = await open('popup');
    await runCase({name: 'options-boolean-master', surface: 'options', field: 'on', writes: [false], mutate: page => masterMatches(page, false, true), reopened: page => masterMatches(page, false),
      crossPopup: async page => {const input = page.locator('.language-pair label').nth(1).locator('input');await waitAttribute(input, 'disabled', '');return {targetLanguageDisabled: await input.isDisabled()};}});
    await fixturePatch({on: true});
    // The second UI edit is made as soon as the first appears, without waiting for either storage write or ACK.
    await runCase({name: 'options-language-latest-write', surface: 'options', field: 'to', writes: ['de', 'ja'], mutate: async page => {
      const first = await chooseTarget(page, 'options', 'de');const second = await chooseTarget(page, 'options', 'ja');return {first, second};
    }, reopened: page => targetMatches(page, 'options', 'ja'), crossPopup: page => targetMatches(page, 'popup', 'ja')});
    await runCase({name: 'options-default-service', surface: 'options', field: 'service', writes: ['freeTranslation'], mutate: page => chooseService(page, 'options', 'freeTranslation'),
      reopened: page => serviceMatches(page, 'options', 'freeTranslation'), crossPopup: page => serviceMatches(page, 'popup', 'freeTranslation')});
    await runCase({name: 'options-drawer-selection', surface: 'options', section: 'settings-selection', field: 'selectionTranslatorMode', writes: ['bilingual'],
      mutate: page => chooseSelection(page, 'options', 'bilingual'), reopened: page => selectionMatches(page, 'options', 'bilingual')});
    report.workerMessages = await worker.evaluate(() => globalThis.__configPersistenceMessages);
    const uiRequests = report.workerMessages.filter(message => /^(?:popup|options)\.html/u.test(message.surface || ''));
    assert.ok(uiRequests.some(message => message.patches.some(patch => patch.values.to === 'de')), 'first consecutive language edit must reach the actual background');
    assert.ok(uiRequests.some(message => message.patches.some(patch => patch.values.to === 'ja')), 'latest consecutive language edit must reach the actual background');
    assert.ok(report.pageMessages.some(message => /^(?:popup|options)\.html/u.test(message.surface || '') && message.phase === 'response' && message.success === true), 'real UI save ACK diagnostics must observe a success');
    report.quickClose = {passed: true, cases: report.persistenceCases.length, storageOrAckWaitBeforeClose: false,
      feedbackToCloseRequestedMs: report.persistenceCases.map(value => ({name: value.name, ms: value.close.feedbackToCloseRequestedMs}))};
    report.crossPageSync = {passed: true, direction: 'options→live popup and independently reopened popup', fields: ['on', 'to', 'service']};
    report.latestWriteWins = {passed: true, field: 'to', writes: ['de', 'ja'], final: (await readConfig()).to, injectedDelay: false};
    assert.equal(report.latestWriteWins.final, 'ja');assert.equal(report.consoleErrors.length, 0);
    report.finalAuthority = snapshot(await readConfig());report.ok = true;
  } catch (error) {
    report.failure = error.stack;process.exitCode = 1;
    if (control && !control.isClosed()) report.failureAuthority = snapshot(await readConfig().catch(() => ({})));
    if (worker) report.workerMessages = await worker.evaluate(() => globalThis.__configPersistenceMessages || []).catch(() => []);
    if (activePage && !activePage.isClosed()) await screenshot(activePage, 'failure-current-ui').catch(() => {});
  } finally {
    saveReport();
    try {
      await session?.close();
      if (session) {fs.rmSync(profileDir, {recursive: true, force: true});report.cleanup.profileRemoved = true;}
    } catch (error) {report.ok = false;report.cleanup.error = error.stack;process.exitCode = 1;}
    saveReport();console.log(JSON.stringify({ok: report.ok, persistenceCases: report.persistenceCases.length, quickClose: report.quickClose,
      crossPageSync: report.crossPageSync, latestWriteWins: report.latestWriteWins, consoleErrors: report.consoleErrors, failure: report.failure, cleanup: report.cleanup}, null, 2));
  }
})();

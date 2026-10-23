#!/usr/bin/env node
'use strict';

/**
 * @file scripts/testing/run-service-learning-hierarchy-test.cjs
 * 文件职责：用生产扩展的单一自有页签验收免费服务默认展开与手动收起、默认服务标记及学习材料与笔记层级。
 * 主要内容：隔离 profile、焦点保护、真实配置保存与笔记 UI 操作；覆盖服务启停重开、单一请求配置默认展开与自定义保存、空库管理恢复、八行笔记原位阅读与取消编辑，并生成 1440/390 浅深色截图。
 * 模块边界：复用 focus-safe helper 的首个页签与所有权清理；不调用翻译或连接检查，HTTP(S) 在页面及当前扩展 worker 边界被阻断；不声明真实供应商、Firefox 或移动设备已验收。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {guardBrowserClose, getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = Number(arg('timeout', '30000'));
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-service-learning-hierarchy'));
const browserPath = arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
const helperPath = path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs')));
const playwrightRoot = arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const PROVIDERS = ['microsoft', 'bilibiliFree', 'transmart', 'volcengineFree', 'doubaoWeb', 'google', 'youdaoFree', 'icibaFree', 'yandexFree', 'myMemory', 'reversoFree', 'apertiumFree', 'alibabaFree', 'modernMtFree', 'laraFree', 'lingvanexFree'];
const NOTE = ['阅读层级验收笔记', '第二行：原文优先', '第三行：关键操作清晰', '第四行：按需显示细节', '第五行：保留阅读上下文', '第六行：取消不覆盖内容', '第七行：窄屏可完整阅读', '第八行：这是笔记末尾'].join('\n');

async function until(check, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {if (await check()) return; await pause(60);}
  throw new Error(`Timeout: ${label}`);
}
async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write('Production service/learning proof: --extension-dir PATH --artifacts-dir PATH --playwright-root PATH --focus-safe-helper PATH --browser-path PATH --display secondary --timeout 30000\n');
    return;
  }
  assert.equal(process.platform, 'darwin', 'Requires the verified macOS background helper');
  assert(!process.argv.includes('--headed') && !process.argv.includes('--headless'), 'Visible background browser only');
  assert(!path.basename(extensionDir).endsWith('-dev'), 'Use a production extension artifact');
  assert(Number.isFinite(timeout) && timeout > 0 && timeout <= 60000, '--timeout must be in 1..60000');
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  const optionsEntry = manifest.options_page || manifest.options_ui?.page;
  assert(manifest.action?.default_popup && optionsEntry && manifest.background?.service_worker, 'Expected production MV3 artifact');
  const {chromium} = require(path.join(playwrightRoot, 'playwright'));
  const helper = require(helperPath);
  for (const name of ['launchFocusSafePersistentContext', 'queryMacFrontmostApplication', 'activateExtensionTabWithoutForeground']) assert.equal(typeof helper[name], 'function', `Missing helper: ${name}`);
  fs.mkdirSync(artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-service-learning-'));
  const report = {ok: false, artifact: 'production', extensionDir, browserPath, profileDir, startedAt: new Date().toISOString(), cases: [], screenshots: [], layouts: [], consoleErrors: [], focusSamples: [], fixtureWrites: [], pageRequests: [], workerRequests: [], additionalPages: [], pageNavigations: 0, singlePageReuse: true,
    evidenceBoundary: 'One owned background Chromium tab and isolated profile. Real UI events and authoritative local configuration; eight-line note created through the editor. Same-tab document navigation proves reopening. No provider request, connection check, translation, Firefox or real-device claim.'};
  let session, context, page, worker, browserPid, origin, primaryError, currentCase = 'launch', launchAttempted = false, focusViolation = false;
  const reportPath = path.join(artifactsDir, 'report.json');
  const save = () => fs.writeFileSync(reportPath, JSON.stringify({...report, currentCase, updatedAt: new Date().toISOString()}, null, 2));
  async function focus(label) {
    const app = await helper.queryMacFrontmostApplication();
    assert(app?.pid, `${label}: cannot establish foreground app`);
    report.focusSamples.push({label, ...app, ownedPid: browserPid});
    if (app.pid === browserPid) {focusViolation = true; throw new Error(`${label}: owned browser took foreground focus`);}
  }
  function cleanConsole(label) {
    assert.deepEqual(report.consoleErrors, [], `${label}: console or page errors`);
    assert.deepEqual(report.additionalPages, [], `${label}: must reuse the helper-created page`);
  }
  async function settle() {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function shot(label, theme) {
    currentCase = label; await settle(); cleanConsole(label); await focus(`before:${label}`);
    const metrics = await page.evaluate(() => {
      const selectors = '.settings-card,.service-catalog,.service-detail,.free-provider-details,.single-request-settings,.provider-row,.fr-materials,.fr-memory-item,.fr-memory-content,.fr-memory-editor';
      const containers = [...document.querySelectorAll(selectors)].filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden').map(node => ({className: node.className, width: node.clientWidth, scrollWidth: node.scrollWidth}));
      return {width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, scrollX, dark: document.documentElement.classList.contains('dark'), containers};
    });
    assert(metrics.documentWidth <= metrics.width + 1 && metrics.bodyWidth <= metrics.width + 1 && metrics.scrollX === 0, `${label}: horizontal page overflow ${JSON.stringify(metrics)}`);
    assert(metrics.containers.every(item => item.scrollWidth <= item.width + 1), `${label}: container overflow ${JSON.stringify(metrics.containers)}`);
    if (theme) assert.equal(metrics.dark, theme === 'dark', `${label}: rendered theme`);
    report.layouts.push({label, ...metrics});
    const file = path.join(artifactsDir, `${label}.png`);
    await page.screenshot({path: file, animations: 'disabled'});
    await focus(`after:${label}`); cleanConsole(label); report.screenshots.push(file); save();
  }
  async function navigate(target, viewport) {
    await focus(`navigate:${target.replace(origin, '')}`);
    if (viewport) await page.setViewportSize(viewport);
    await page.goto(target, {waitUntil: 'domcontentloaded', timeout}); report.pageNavigations += 1;
  }
  async function readConfig() {
    const result = await page.evaluate(() => chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}));
    assert(result?.success && result.value, 'Read authoritative isolated configuration');
    return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
  }
  async function patchFixture(patch) {
    const config = await readConfig(), expected = Object.fromEntries(Object.keys(patch).map(key => [key, config[key]]));
    const result = await page.evaluate(({patch, expected}) => chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: patch, expected}), {patch, expected});
    assert(result?.success, `Fixture save failed: ${Object.keys(patch).join(',')}`);
    report.fixtureWrites.push({fields: Object.keys(patch), revision: result.revision});
    await until(async () => {const next = await readConfig(); return Object.entries(patch).every(([key, value]) => JSON.stringify(next[key]) === JSON.stringify(value));}, 'fixture persisted');
  }
  async function openOptions(section, viewport = {width: 1440, height: 960}) {
    // Navigate away first: changing only the hash would retain the live component.
    await navigate(`${origin}/icon/128.png`);
    await navigate(`${origin}/${optionsEntry}#${section}`, viewport);
    await page.locator('.settings-app').waitFor(); await page.locator(`#${section}`).waitFor({state: 'visible'}); await settle();
  }
  const disclosure = () => page.locator('details[data-free-provider-disclosure]');
  const requestDisclosure = () => page.locator('details[data-service-request-disclosure]');
  const rows = () => page.locator('[data-fallback-provider]');
  async function providerOpen(open) {
    if ((await disclosure().getAttribute('open') !== null) !== open) await disclosure().locator(':scope > summary').click();
    await until(async () => await page.locator('[data-fallback-provider]:visible').count() === (open ? 16 : 0), `provider rows ${open ? 'open' : 'closed'}`);
  }
  async function selectService(id) {
    const toggle = page.locator('.mobile-directory-toggle');
    if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    const target = page.locator(`.service-rail [data-service-value="${id}"]`);
    const group = target.locator('xpath=ancestor::section[@data-service-section]').locator('.directory-section-toggle');
    if (await group.getAttribute('aria-expanded') === 'false') await group.click();
    await target.click();
    await until(async () => await page.locator('.service-catalog').getAttribute('data-editing-service') === id, `selected ${id}`);
    await settle();
  }
  async function defaultAction(selected) {
    const action = page.locator('[data-set-default-service-button]:visible');
    assert.equal(await action.count(), 1, 'Exactly one explicit default action');
    assert.equal((await action.textContent()).trim(), selected === 'freeTranslation' ? '当前默认' : '设为默认翻译服务');
    assert.equal(await action.isDisabled(), selected === 'freeTranslation');
    assert.equal(await page.locator('.detail-hero .active-badge,.detail-hero .editing-badge').count(), 0, 'Title does not duplicate default/editing badges');
    assert.equal(await page.locator('.service-rail .library-default').count(), 1);
    assert.equal(await page.locator('[data-service-value="freeTranslation"] .library-default').count(), 1);
    assert.equal((await readConfig()).service, 'freeTranslation', 'Browsing services must not change default');
  }
  async function learningTab(name) {
    await page.locator('.fr-learning-center-header').getByRole('radio', {name, exact: true}).click(); await settle();
  }
  async function materialEmpty() {
    await learningTab('阅读材料'); await page.getByRole('heading', {name: '从一段值得留下的原文开始', exact: true}).waitFor();
    assert.equal(await page.locator('.fr-material-search').count(), 0);
    assert.equal(await page.locator('.fr-material-toolbar select').count(), 0);
    assert.equal(await page.getByRole('button', {name: '查看我的收藏', exact: true}).isEnabled(), true);
  }
  async function memoryReady() {
    await learningTab('学习笔记'); await page.locator('.fr-memory-item').waitFor();
    assert.equal(await page.locator('.fr-memory-item').count(), 1);
    assert.equal(await page.locator('.fr-memory-content > p').textContent(), NOTE);
    assert.equal(await page.locator('.fr-memory-editor').count(), 0);
  }
  try {
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir, browserPath, timeout, background: true, headless: false, displayTarget: arg('display', 'secondary'), viewport: {width: 1440, height: 960}, browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir); browserPid = await getGuardedBrowserPid(session); context = session.context;
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement, ownedPid: browserPid});
    assert.equal(session.launchMode, 'macos-background-cdp'); assert.equal(session.focusPolicy, 'launchservices-no-foreground');
    assert.equal(session.windowPlacement?.mode, 'background-visible-no-focus'); assert.equal(session.windowPlacement?.browserFrontmost, false); await focus('launch');
    const initialPages = context.pages(); report.initialPageCount = initialPages.length;
    page = initialPages.find(candidate => candidate.url().startsWith('about:blank#fluentread-background-')) || (initialPages.length === 1 ? initialPages[0] : undefined);
    assert(page, 'Reuse the helper-created page; do not create a fallback tab');
    context.on('page', other => {if (other !== page) report.additionalPages.push({url: other.url()});});
    page.setDefaultTimeout(timeout);
    page.on('pageerror', error => report.consoleErrors.push({surface: 'page', case: currentCase, message: error.message}));
    page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({surface: 'page', case: currentCase, message: message.text()});});
    await context.route(/^https?:/u, async route => {const url = new URL(route.request().url()); report.pageRequests.push({origin: url.origin, path: url.pathname}); await route.abort();});
    await until(async () => {
      for (const candidate of context.serviceWorkers()) {
        if (!candidate.url().endsWith(`/${manifest.background.service_worker}`)) continue;
        const value = await candidate.evaluate(rawName => {const m = chrome.runtime.getManifest(), message = /^__MSG_(.+)__$/u.exec(rawName); return {name: m.name, expectedName: message ? chrome.i18n.getMessage(message[1]) : rawName, version: m.version, popup: m.action?.default_popup, key: m.key};}, manifest.name).catch(() => null);
        if (value && value.name === value.expectedName && value.version === manifest.version && value.popup === manifest.action.default_popup && value.key === manifest.key) {worker = candidate; report.loadedManifest = {name: value.name, version: value.version, popup: value.popup}; return true;}
      }
      return false;
    }, 'exact production worker');
    worker.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({surface: 'worker', case: currentCase, message: message.text()});});
    await worker.evaluate(() => {
      globalThis.__frServiceLearningRemote = [];
      const original = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, globalThis.location.href);
        if (/^https?:$/u.test(url.protocol)) {globalThis.__frServiceLearningRemote.push({origin: url.origin, path: url.pathname}); return Promise.reject(new Error('External network is disabled by the service/learning UI fixture'));}
        return original(input, init);
      };
    });
    await page.addInitScript(() => {
      globalThis.__frServiceLearningActions = [];
      const runtime = globalThis.chrome?.runtime;
      if (!runtime?.sendMessage) return;
      const send = runtime.sendMessage.bind(runtime);
      runtime.sendMessage = (...args) => {const message = args.find(value => value && typeof value === 'object' && value.type); if (message?.action) globalThis.__frServiceLearningActions.push({type: message.type, action: message.action}); return send(...args);};
    });
    origin = `chrome-extension://${new URL(worker.url()).host}`;
    await navigate(`${origin}/icon/128.png`); await helper.activateExtensionTabWithoutForeground(context, page); await focus('activate-owned-page');
    await until(async () => {try {return Boolean((await readConfig()).uiLanguage);} catch {return false;}}, 'configuration initialized');
    await patchFixture({uiLanguageSetupCompleted: true, uiLanguage: 'zh-CN', theme: 'light', interfaceSkin: 'default', interfaceFont: 'system', animations: false, service: 'freeTranslation', freeTranslationMode: 'balanced', freeTranslationOrder: PROVIDERS});

    currentCase = 'provider-persistence'; await openOptions('settings-services'); await disclosure().waitFor(); await defaultAction('freeTranslation');
    assert.notEqual(await disclosure().getAttribute('open'), null); assert.equal(await rows().count(), 16); assert.equal(await page.locator('[data-fallback-provider]:visible').count(), 16);
    assert.match(await disclosure().locator(':scope > summary').textContent(), /参与翻译的服务/u);
    await providerOpen(false);
    await providerOpen(true);
    assert.deepEqual((await rows().evaluateAll(nodes => nodes.map(node => node.dataset.fallbackProvider))).sort(), [...PROVIDERS].sort());
    const targetSwitch = () => page.locator('[data-fallback-provider="microsoft"]').getByRole('switch');
    assert.equal(await targetSwitch().getAttribute('aria-checked'), 'true'); await page.locator('[data-fallback-provider="microsoft"] .el-switch').click();
    await until(async () => !(await readConfig()).freeTranslationOrder.includes('microsoft'), 'provider disable saved');
    await openOptions('settings-services'); assert.notEqual(await disclosure().getAttribute('open'), null);
    assert.equal(await targetSwitch().getAttribute('aria-checked'), 'false'); await shot('provider-disabled-reopened', 'light');
    await page.locator('[data-fallback-provider="microsoft"] .el-switch').click(); await until(async () => (await readConfig()).freeTranslationOrder.includes('microsoft'), 'provider enable saved');
    await openOptions('settings-services'); await providerOpen(true); assert.equal(await targetSwitch().getAttribute('aria-checked'), 'true');
    await selectService('microsoft'); await defaultAction('microsoft'); await selectService('freeTranslation'); await defaultAction('freeTranslation');
    report.cases.push({name: 'provider-persistence', rows: 16, defaultExpanded: true, disabledAndEnabledReopened: true, defaultUnchangedByBrowsing: true});

    currentCase = 'request-limit-disclosure';
    const limits = () => requestDisclosure().getByTestId('request-limit-settings');
    const requestSummary = () => requestDisclosure().locator(':scope > summary');
    assert.equal(await requestDisclosure().count(), 1); assert.notEqual(await requestDisclosure().getAttribute('open'), null);
    assert.match(await requestSummary().innerText(), /请求限制/u); assert.match(await requestSummary().innerText(), /跟随全局设置/u);
    assert.equal(await limits().isVisible(), true);
    await requestSummary().click();
    assert.equal(await limits().count(), 1, 'Closed disclosure keeps the form mounted'); assert.equal(await limits().isVisible(), false);
    await requestSummary().click();
    await limits().locator('[data-request-limit-mode]').getByRole('radio', {name: '自定义', exact: true}).click();
    const concurrency = limits().getByLabel('翻译并发数', {exact: true});
    await concurrency.fill('2'); await concurrency.press('Tab');
    await until(async () => {const value = (await readConfig()).serviceRequestLimits.freeTranslation; return value?.enabled === true && value.limits.maxConcurrentTranslations === 2;}, 'custom service request limit saved');
    await requestSummary().click(); assert.match(await requestSummary().innerText(), /自定义/u);
    assert.equal(await limits().count(), 1); assert.equal(await limits().isVisible(), false);
    await openOptions('settings-services'); assert.notEqual(await requestDisclosure().getAttribute('open'), null);
    assert.match(await requestSummary().innerText(), /自定义/u);
    assert.equal(await limits().getByLabel('翻译并发数', {exact: true}).inputValue(), '2');
    await requestSummary().scrollIntoViewIfNeeded(); await shot('request-limits-custom-reopened', 'light');
    await limits().locator('[data-request-limit-mode]').getByRole('radio', {name: '跟随全局设置', exact: true}).click();
    await until(async () => (await readConfig()).serviceRequestLimits.freeTranslation?.enabled === false, 'global inheritance restored');
    await openOptions('settings-services'); assert.notEqual(await requestDisclosure().getAttribute('open'), null);
    assert.match(await requestSummary().innerText(), /跟随全局设置/u);
    assert.equal((await readConfig()).serviceRequestLimits.freeTranslation.limits.maxConcurrentTranslations, 2, 'Disabled custom values remain available');
    report.cases.push({name: 'request-limit-disclosure', defaultExpanded: true, formRemainsMounted: true, customConcurrency: 2, reopenedCustom: true, inheritanceRestored: true, disabledValuesRetained: true});

    currentCase = 'empty-material-management'; await openOptions('settings-vocabulary'); await materialEmpty();
    await page.locator('.fr-material-menu > summary').click();
    const restore = page.getByRole('button', {name: '恢复材料备份', exact: true});
    assert.equal(await restore.isEnabled(), true); await shot('material-empty-management', 'light');
    const chooserPromise = page.waitForEvent('filechooser'); await restore.click(); const chooser = await chooserPromise;
    assert.equal(await chooser.element().getAttribute('aria-label'), '恢复材料备份'); await chooser.setFiles([]);
    await page.locator('.fr-material-menu > summary').click(); await page.getByRole('button', {name: '查看已移除材料', exact: true}).click();
    await page.getByRole('heading', {name: '没有已移除的材料', exact: true}).waitFor();
    await page.getByRole('button', {name: '返回材料', exact: true}).click(); await page.getByRole('heading', {name: '从一段值得留下的原文开始', exact: true}).waitFor();
    report.cases.push({name: 'empty-material-management', searchHidden: true, topicHidden: true, restoreFileChooserReached: true, archivedViewReachable: true});

    currentCase = 'memory-real-ui'; await learningTab('学习笔记');
    await page.getByText('还没有学习笔记', {exact: true}).waitFor(); await page.getByRole('button', {name: '添加笔记', exact: true}).click();
    await page.getByRole('textbox', {name: '笔记内容', exact: true}).fill(NOTE);
    await page.locator('.fr-memory-editor').getByRole('button', {name: '保存', exact: true}).click(); await page.getByText('笔记已保存', {exact: true}).waitFor();
    await page.locator('.fr-memory-item').waitFor(); await page.getByRole('searchbox', {name: '搜索笔记', exact: true}).fill('第八行');
    const content = () => page.locator('.fr-memory-content');
    const savedRequests = () => page.evaluate(() => globalThis.__frServiceLearningActions.filter(item => item.action === 'memory-save').length);
    assert.equal(await savedRequests(), 1, 'Fixture was created once through real UI');
    assert.equal(await content().getAttribute('open'), null); await content().locator(':scope > summary').click();
    assert.notEqual(await content().getAttribute('open'), null); assert.equal(await content().locator(':scope > p').textContent(), NOTE); assert.equal(await page.locator('.fr-memory-editor').count(), 0);
    await content().locator(':scope > summary').click(); assert.equal(await content().getAttribute('open'), null); assert.equal(await page.locator('.fr-memory-editor').count(), 0);
    await page.locator('.fr-memory-item').getByRole('button', {name: '编辑', exact: true}).click();
    const textarea = page.getByRole('textbox', {name: '笔记内容', exact: true}); assert.equal(await textarea.inputValue(), NOTE); await textarea.fill('这次编辑应被取消');
    await page.locator('.fr-memory-editor').getByRole('button', {name: '取消', exact: true}).click();
    assert.equal(await page.getByRole('searchbox', {name: '搜索笔记', exact: true}).inputValue(), '第八行'); assert.equal(await content().locator(':scope > p').textContent(), NOTE);
    assert.equal(await savedRequests(), 1, 'Read and edit-cancel never send memory-save');
    await shot('memory-cancelled-search-preserved', 'light');
    await openOptions('settings-vocabulary'); await memoryReady();
    report.cases.push({name: 'memory-real-ui', lines: NOTE.split('\n').length, characters: NOTE.length, searchPreservedAfterCancel: true, readOnlyExpandCollapse: true, cancelledDraftNotSaved: true, reopenedOriginal: true});

    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
      const suffix = `${theme}-${width}`, viewport = {width, height: width === 390 ? 844 : 960};
      await patchFixture({theme}); await openOptions('settings-services', viewport); await disclosure().waitFor(); await defaultAction('freeTranslation');
      assert.notEqual(await requestDisclosure().getAttribute('open'), null); assert.match(await requestSummary().innerText(), /跟随全局设置/u);
      assert.notEqual(await disclosure().getAttribute('open'), null); await providerOpen(false); await disclosure().scrollIntoViewIfNeeded(); await shot(`services-collapsed-${suffix}`, theme);
      await providerOpen(true); await disclosure().locator(':scope > summary').scrollIntoViewIfNeeded(); await shot(`services-expanded-${suffix}`, theme);
      await providerOpen(false); await requestSummary().scrollIntoViewIfNeeded();
      await requestSummary().hover();
      const corners = await requestDisclosure().evaluate(element => {
        const card = getComputedStyle(element), summary = getComputedStyle(element.querySelector(':scope > summary'));
        return {card: [card.borderTopLeftRadius, card.borderTopRightRadius], summary: [summary.borderTopLeftRadius, summary.borderTopRightRadius]};
      });
      assert.deepEqual(corners.summary, corners.card, `Expanded hovered request summary must keep card top corners: ${JSON.stringify(corners)}`);
      await shot(`request-limits-expanded-${suffix}`, theme);
      await openOptions('settings-vocabulary', viewport); await materialEmpty(); await page.locator('.fr-materials').scrollIntoViewIfNeeded(); await shot(`materials-empty-${suffix}`, theme);
      await memoryReady(); await content().scrollIntoViewIfNeeded(); await shot(`memory-collapsed-${suffix}`, theme);
      await content().locator(':scope > summary').click(); assert.equal(await content().locator(':scope > p').isVisible(), true); assert.equal(await page.locator('.fr-memory-editor').count(), 0); await shot(`memory-expanded-${suffix}`, theme);
      await content().locator(':scope > summary').press('Escape'); assert.equal(await content().getAttribute('open'), null);
      report.cases.push({name: `responsive-${suffix}`, services: true, materials: true, memory: true, escapeCollapses: true});
    }
    report.workerRequests = await worker.evaluate(() => globalThis.__frServiceLearningRemote);
    assert.deepEqual(report.pageRequests, [], 'No external page request'); assert.deepEqual(report.workerRequests, [], 'No external worker request');
    await focus('complete'); cleanConsole('complete'); report.ok = true;
  } catch (error) {
    primaryError = error; report.failure = {case: currentCase, message: error.message, stack: error.stack};
    if (!focusViolation && page && !page.isClosed() && browserPid) {
      try {await focus('before:failure'); const file = path.join(artifactsDir, 'failure.png'); await page.screenshot({path: file}); await focus('after:failure'); report.screenshots.push(file);} catch (failure) {report.failureCaptureError = failure.message;}
    }
  } finally {
    try {
      if (session) {await session.close(); report.cleanup = {ownedBrowserClosed: true}; fs.rmSync(profileDir, {recursive: true, force: true}); report.cleanup.profileRemoved = true;}
      else if (!launchAttempted) {fs.rmSync(profileDir, {recursive: true, force: true}); report.cleanup = {profileRemoved: true, browserNotStarted: true};}
      else report.cleanup = {profileRetained: true, reason: 'Launch did not return a verified owned session'};
    } catch (error) {report.ok = false; report.cleanup = {profileRetained: true, message: error.message}; primaryError ||= error;}
    report.finishedAt = new Date().toISOString(); save();
  }
  if (primaryError) throw primaryError;
  process.stdout.write(JSON.stringify({ok: report.ok, reportPath, screenshots: report.screenshots.length, cases: report.cases.length, pageNavigations: report.pageNavigations}, null, 2) + '\n');
}
main().catch(error => {process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;});

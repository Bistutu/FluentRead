#!/usr/bin/env node
/**
 * @file scripts/testing/run-service-default-ui-test.cjs
 * 文件职责：在真实生产扩展中验证详情页显式设为默认翻译服务、配置持久化及响应式布局。
 * 主要内容：独立后台 Edge fixture，覆盖浏览隔离、按钮位置、类别和自定义服务、快速关闭、连续修改与跨页同步。
 * 模块边界：复用 focus-safe helper，只清理本次拥有的浏览器/profile；不测试连接、不执行翻译、不下载模型。
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {guardBrowserClose} = require('./owned-browser-close.cjs');

const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, all) => {
  if (value.startsWith('--')) out.push([value.slice(2), all[index + 1]]);
  return out;
}, []));
args['focus-safe-helper'] ||= path.join(__dirname, 'focus-safe-browser.cjs');
for (const field of ['extension-dir', 'playwright-root', 'artifacts-dir']) assert(args[field], `Missing --${field}`);
const {chromium} = createRequire(path.join(args['playwright-root'], 'service-default-ui.cjs'))('playwright');
const helper = require(args['focus-safe-helper']);
const extensionDir = path.resolve(args['extension-dir']);
const artifacts = path.resolve(args['artifacts-dir']);
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
assert(manifest.action?.default_popup, 'Extension manifest has no popup');
assert(manifest.options_page || manifest.options_ui?.page, 'Extension manifest has no options page');
fs.mkdirSync(artifacts, {recursive: true});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-service-default-'));
const report = {
  ok: false, evidence: 'focused-real-extension-default-service-ui', extensionDir,
  build: extensionDir.endsWith('chrome-mv3-dev') ? 'development' : 'production',
  cases: [], screenshots: [], persistenceCases: [], storageEvents: [], consoleErrors: [],
  quickClose: false, latestWriteWins: false, crossPageSync: false,
  blockedHttpRequests: [], unverified: ['Firefox', 'live provider connection', 'model downloads'],
};
const save = () => fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));

(async () => {
  let session, page, control, primaryError;
  let launchAttempted = false;
  try {
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({
      chromium, profileDir,
      browserPath: args['browser-path'] || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      headless: false, background: true, displayTarget: 'secondary',
      viewport: {width: 1440, height: 1000}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
    });
    guardBrowserClose(session, profileDir);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = session.context;
    context.setDefaultTimeout(15000);
    // Guard page-originated HTTP requests; there are no network-triggering UI
    // actions in this suite. MV3 worker traffic is not inferred from routing.
    await context.route(/^https?:\/\//, route => {
      report.blockedHttpRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    const worker = context.serviceWorkers().find(candidate => candidate.url().startsWith('chrome-extension://'))
      || await context.waitForEvent('serviceworker', {timeout: 30000});
    worker.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({surface: 'worker', message: message.text()});});
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const optionsPath = manifest.options_page || manifest.options_ui.page;
    const servicesUrl = `${origin}/${optionsPath}#settings-services`;
    const generalUrl = `${origin}/${optionsPath}#settings-general`;
    const popupUrl = `${origin}/${manifest.action.default_popup}`;

    const open = async url => {
      const target = await helper.newPageWithoutForeground(context, 30000);
      target.on('pageerror', error => report.consoleErrors.push({surface: url, message: error.message}));
      target.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({surface: url, message: message.text()});});
      await target.exposeBinding('__recordServiceDefaultPersistence', (_source, entry) => report.storageEvents.push(entry));
      await target.addInitScript(() => {
        const runtime = globalThis.chrome?.runtime;
        if (!runtime?.sendMessage) return;
        const sendMessage = runtime.sendMessage.bind(runtime);
        runtime.sendMessage = (...callArgs) => {
          const message = callArgs.find(value => value && typeof value === 'object' && value.type);
          const tracked = message?.type === 'persistConfig';
          const fields = tracked ? {service: message.config?.service, mode: message.mode || 'snapshot', sequence: message.sequence, keys: Object.keys(message.config || {})} : null;
          const record = entry => {void globalThis.__recordServiceDefaultPersistence?.(entry).catch(() => {});};
          if (tracked) record({event: 'request', ...fields});
          const observedArgs = tracked ? callArgs.map(value => typeof value === 'function'
            ? (...responseArgs) => {
              record({event: 'response', ...fields, success: responseArgs[0]?.success === true});
              return value(...responseArgs);
            } : value) : callArgs;
          const result = sendMessage(...observedArgs);
          if (tracked && result?.then) result.then(
            response => record({event: 'response', ...fields, success: response?.success === true}),
            error => record({event: 'rejection', ...fields, message: String(error)}),
          );
          return result;
        };
      });
      await target.goto(url, {waitUntil: 'domcontentloaded'});
      return target;
    };
    control = await open(generalUrl);
    await control.getByTestId('default-translation-service-card').waitFor({state: 'visible'});
    const readConfig = async () => control.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!response?.success) throw new Error('Config read failed');
      return typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
    });
    const seed = async patch => {
      const current = await readConfig();
      const expected = Object.fromEntries(Object.keys(patch).map(key => [key, current[key]]));
      const response = await control.evaluate(({patch, expected}) => chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: patch, expected}), {patch, expected});
      assert.equal(response?.success, true, 'Fixture config save failed');
      report.storageEvents.push({event: 'fixture-response', success: true, keys: Object.keys(patch)});
    };
    const savedService = async expected => {
      await control.waitForFunction(async expected => {
        const response = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
        const config = typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
        return response.success && config?.service === expected;
      }, expected);
      return readConfig();
    };
    const close = async target => {
      // Keep all close/activation operations inside the owned extension window.
      const tabId = await target.evaluate(async () => (await chrome.tabs.getCurrent()).id);
      await control.evaluate(async tabId => {
        const anchor = await chrome.tabs.getCurrent();
        await chrome.tabs.update(anchor.id, {active: true});
        await chrome.tabs.remove(tabId);
      }, tabId);
    };
    const shot = async (target, name) => {
      await helper.activateExtensionTabWithoutForeground(context, target);
      await target.evaluate(async () => {await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));});
      const file = path.join(artifacts, `${name}.png`);
      await target.screenshot({path: file, fullPage: true});
      report.screenshots.push(file);
    };
    const catalog = () => page.locator('.service-catalog:visible');
    const action = () => page.locator('[data-set-default-service-button]:visible');
    const selectService = async service => {
      const target = page.locator(`.service-rail [data-service-value="${service}"]`);
      if (!await target.isVisible()) {
        const group = target.locator('xpath=ancestor::section[@data-service-section]').locator('.directory-section-toggle');
        if (await group.count() && await group.getAttribute('aria-expanded') === 'false') await group.click();
      }
      await target.click();
      await page.waitForFunction(service => document.querySelector('.service-catalog')?.dataset.editingService === service, service);
      await action().waitFor({state: 'visible'});
    };
    const assertCurrentDefault = async expected => {
      await page.waitForFunction(expected => document.querySelector('.service-catalog')?.dataset.defaultService === expected, expected);
      assert.equal(await catalog().getAttribute('data-editing-service'), expected);
      assert.equal(await page.locator('.detail-hero .active-badge, .detail-hero .editing-badge').count(), 0);
      assert.equal(await page.locator(`.service-rail [data-service-value="${expected}"] .library-default`).count(), 1);
      assert.equal(await page.locator('.service-rail .library-default').count(), 1);
      assert.equal(await action().isDisabled(), true);
    };
    const setDefault = async service => {
      const before = (await readConfig()).service;
      await selectService(service);
      assert.equal(await catalog().getAttribute('data-default-service'), before, 'Browsing changed catalog default');
      assert.equal((await readConfig()).service, before, 'Browsing wrote config.service');
      assert.equal(await action().isEnabled(), true);
      await action().click();
      await assertCurrentDefault(service);
      const saved = await savedService(service);
      report.persistenceCases.push({service, before, after: saved.service, revision: saved.__fluentConfigRevision, passed: true});
      return saved;
    };

    await seed({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, service: 'freeTranslation', theme: 'light', customOpenAIProviders: []});
    page = await open(servicesUrl);
    await catalog().waitFor({state: 'visible'});
    await assertCurrentDefault('freeTranslation');
    assert.match(await action().innerText(), /当前默认/);
    report.cases.push('current-default-action-is-disabled');
    await selectService('bilibili');
    assert.equal(await catalog().getAttribute('data-default-service'), 'freeTranslation');
    assert.equal((await readConfig()).service, 'freeTranslation');
    assert.equal(await page.locator('.detail-hero .editing-badge').count(), 0);
    const desktop = await page.locator('.detail-hero').evaluate(node => {
      const a = node.querySelector('[data-set-default-service-button]').getBoundingClientRect();
      const b = node.querySelector('[data-connection-test-button]').getBoundingClientRect();
      return {default: {left: a.left, right: a.right, top: a.top, bottom: a.bottom}, connection: {left: b.left, right: b.right, top: b.top, bottom: b.bottom}};
    });
    assert(desktop.default.right <= desktop.connection.left + 1, JSON.stringify(desktop));
    assert(Math.abs(desktop.default.top - desktop.connection.top) <= 2, JSON.stringify(desktop));
    report.cases.push({id: 'browse-preserves-default-and-action-left-of-connection', desktop});
    await shot(page, 'desktop-before-default');
    await setDefault('bilibili');
    await shot(page, 'desktop-current-default');
    await close(page); page = await open(servicesUrl); await catalog().waitFor({state: 'visible'});
    await assertCurrentDefault('bilibili');
    await shot(page, 'service-reopened-persisted');
    report.persistenceCases.push({id: 'catalog-close-reopen', expected: 'bilibili', actual: (await readConfig()).service, passed: true});

    // All three categories can become the default without checking a provider
    // connection or preparing/downloading local model resources.
    for (const service of ['deepseek', 'localTranslation', 'freeTranslation']) await setDefault(service);
    report.cases.push('ai-local-free-explicit-default-without-network-actions');
    const customId = 'custom:service-default-fixture';
    await seed({customOpenAIProviders: [{id: customId, name: '默认接口测试', endpoint: 'http://localhost:11434/v1/chat/completions', models: ['fixture-local-model']} ]});
    await page.reload(); await catalog().waitFor({state: 'visible'});
    await setDefault(customId);
    report.cases.push('custom-service-explicit-default');

    // Two complete, rapid UI actions with no storage wait between them, followed
    // by immediate tab removal. The reopened page must show the second choice.
    await selectService('bilibili'); await action().click();
    await selectService('microsoft'); await action().click();
    await close(page);
    const final = await savedService('microsoft');
    report.storageEvents.push({event: 'final-background-readback', success: true, service: final.service, revision: final.__fluentConfigRevision});
    page = await open(servicesUrl); await catalog().waitFor({state: 'visible'});
    await assertCurrentDefault('microsoft');
    report.quickClose = {passed: true, closedImmediatelyAfterFinalClick: true, actual: final.service};
    report.latestWriteWins = {first: 'bilibili', second: 'microsoft', afterReopen: final.service, passed: true};
    await shot(page, 'latest-write-reopened');
    await control.waitForFunction(expected => document.querySelector('[data-testid="default-translation-service-card"]')?.dataset.defaultService === expected, 'microsoft');
    await shot(control, 'general-cross-page-synchronized');
    const popup = await open(popupUrl);
    await popup.locator('.popup-shell[data-config-ready="true"]').waitFor({state: 'visible'});
    await popup.setViewportSize({width: 400, height: 560});
    await popup.getByTestId('popup-feature-services').click();
    await popup.locator('[data-feature-service="default"]').waitFor({state: 'visible'});
    const popupText = await popup.locator('[data-feature-service="default"]').innerText();
    assert.match(popupText, /微软|Microsoft/i);
    await shot(popup, 'popup-cross-page-synchronized');
    report.crossPageSync = {general: await control.getByTestId('default-translation-service-card').getAttribute('data-default-service'), popup: popupText, expected: 'microsoft', passed: true};
    await close(popup);

    for (const language of ['zh-CN', 'en-US']) {
      for (const theme of ['light', 'dark']) {
        await seed({uiLanguage: language, theme});
        await page.reload(); await catalog().waitFor({state: 'visible'});
        await selectService('freeTranslation');
        assert.match(await action().innerText(), language === 'zh-CN' ? /设为默认/ : /Set as default/i);
        for (const width of [1440, 1024, 820, 390]) {
          await page.setViewportSize({width, height: 1000});
          const metrics = await page.evaluate(() => {
            const nodes = [...document.querySelectorAll('.detail-hero [data-set-default-service-button], .detail-hero [data-connection-test-button]')];
            const buttons = nodes.map(node => {
              const rect = node.getBoundingClientRect();
              return {text: node.textContent.trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height};
            });
            return {width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight, buttons};
          });
          assert(metrics.scrollWidth <= width + 1, JSON.stringify(metrics));
          assert(metrics.scrollHeight <= metrics.height + 1, JSON.stringify(metrics));
          assert.equal(metrics.buttons.length, 2, JSON.stringify(metrics));
          for (const button of metrics.buttons) assert(button.left >= -1 && button.right <= width + 1 && button.width > 0 && button.height > 0, JSON.stringify(metrics));
          const [a, b] = metrics.buttons;
          const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
          assert.equal(overlap, false, JSON.stringify(metrics));
          if (width === 1440) assert(a.right <= b.left + 1, JSON.stringify(metrics));
          report.cases.push({id: `layout-${language}-${theme}-${width}`, metrics});
          if (width === 390 || width === 1440) await shot(page, `layout-${language}-${theme}-${width}`);
        }
        await page.setViewportSize({width: 1440, height: 1000});
      }
    }
    const explicitServiceRequests = report.storageEvents.filter(event => event.event === 'request' && event.service);
    const successfulServiceResponses = report.storageEvents.filter(event => event.event === 'response' && event.service && event.success);
    assert(explicitServiceRequests.length >= 7, 'UI persistence requests were not observed');
    assert(successfulServiceResponses.some(event => event.service === 'bilibili'), 'Default change lacks successful background response');
    assert.deepEqual(report.consoleErrors, []);
    report.ok = true; save();
  } catch (error) {
    primaryError = error; report.error = error.stack; process.exitCode = 1;
    try {if (page && !page.isClosed()) await page.screenshot({path: path.join(artifacts, 'failure.png'), fullPage: true});}
    catch (diagnosticError) {report.failureScreenshotError = String(diagnosticError);}
  } finally {
    let browserClosed = false;
    try {if (session) {await session.close(); browserClosed = true;}}
    catch (error) {report.ok = false; process.exitCode = 1; (report.cleanupErrors ||= []).push({resource: 'owned-browser', error: String(error.stack || error)});}
    if (browserClosed || !launchAttempted) {
      try {fs.rmSync(profileDir, {recursive: true, force: true});}
      catch (error) {report.ok = false; process.exitCode = 1; (report.cleanupErrors ||= []).push({resource: 'owned-profile', error: String(error)});}
    } else report.retainedProfile = profileDir;
    save(); console.log(JSON.stringify(report, null, 2));
    if (primaryError) console.error(primaryError);
  }
})().catch(error => {console.error(error); process.exitCode = 1;});

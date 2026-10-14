#!/usr/bin/env node
'use strict';
const {guardBrowserClose} = require('./testing/owned-browser-close.cjs');

/**
 * Verify the production AI context entry in a temporary, focus-safe Edge profile.
 * Fixtures use the real background config interface. No translation request or
 * credential is needed: configured cases explicitly allow a keyless model.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execFileAsync = promisify(execFile);

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}
const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-ai-context-ui'));
const playwrightRoot = path.resolve(argument('playwright-root', ''));
const helperPath = path.resolve(argument('focus-safe-helper', path.join(__dirname, 'testing/focus-safe-browser.cjs')));
const timeout = Number(argument('timeout', '30000'));
const {chromium} = require(path.join(playwrightRoot, 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(helperPath);
const skins = ['default', 'minimal', 'compact', 'contrast', 'qinghua', 'zhusha', 'shuimo', 'zhuqing', 'ouhe', 'xiangse', 'xuanqing'];

async function assertBackground(context, report, label) {
  const session = await context.browser().newBrowserCDPSession();
  let primaryError;
  try {
    const {processInfo} = await session.send('SystemInfo.getProcessInfo');
    const browserPid = processInfo.find(item => item.type === 'browser')?.id;
    const {stdout} = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
      "ObjC.import('AppKit'); const app = $.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify({pid:Number(app.processIdentifier), name:ObjC.unwrap(app.localizedName)});"], {timeout: 5000});
    const frontmost = JSON.parse(stdout.trim());
    assert.ok(Number.isInteger(browserPid) && Number.isInteger(frontmost.pid), 'Cannot verify browser focus');
    assert.notEqual(frontmost.pid, browserPid, `Test browser stole foreground focus: ${label}`);
    report.focusChecks.push({label, browserFrontmost: false, frontmostApplication: frontmost.name});
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {await session.detach();} catch (error) {
      if (!primaryError) throw error;
      process.stderr.write(`CDP detach failed: ${error.stack || error}\n`);
    }
  }
}

async function main() {
  assert.equal(os.platform(), 'darwin', 'This suite requires the macOS focus-safe browser helper');
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  const popupPath = manifest.action?.default_popup || manifest.browser_action?.default_popup;
  const optionsPath = manifest.options_ui?.page || manifest.options_page;
  assert.ok(popupPath && optionsPath, 'Extension manifest must declare popup and options');
  fs.mkdirSync(artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-ai-context-ui-'));
  const report = {
    extensionDir, artifactType: path.basename(extensionDir).includes('-dev') ? 'development' : 'production',
    scope: 'AI context popup UI and persistence; no translation or service connection is exercised',
    manifest: {popup: popupPath, options: optionsPath},
    launchMode: null, focusPolicy: null, windowPlacement: null,
    caseCoverage: [], persistenceCases: [], quickClose: [], crossPageSync: [], latestWriteWins: [],
    layouts: [], layoutFailures: [], screenshots: [], focusChecks: [], consoleErrors: [], passed: false,
  };
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    response.end('<!doctype html><html lang="en"><title>AI context UI fixture</title><body><h1>Context-aware reading</h1><p>A local article supplies a normal website tab for the extension popup.</p></body></html>');
  });
  let launched;
  let popup;
  let primaryError;
  let launchAttempted = false;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    launchAttempted = true;
    launched = await launchFocusSafePersistentContext({
      chromium, profileDir,
      browserPath: argument('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      headless: false, background: true, displayTarget: 'secondary',
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
      viewport: {width: 1280, height: 900}, timeout,
    });
    guardBrowserClose(launched, profileDir);
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const {context} = launched;
    report.browserVersion = context.browser().version();
    let worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://'));
    if (!worker) worker = await context.waitForEvent('serviceworker', {timeout});
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const diagnostics = (target, surface) => {
      target.on('console', message => {
        if (message.type() === 'error') report.consoleErrors.push({surface, message: message.text()});
      });
      target.on('pageerror', error => report.consoleErrors.push({surface, message: error.message}));
    };
    diagnostics(worker, 'worker');
    const control = await newPageWithoutForeground(context, timeout);
    diagnostics(control, 'options');
    await control.goto(`${origin}/${optionsPath}`, {waitUntil: 'domcontentloaded', timeout});
    await control.locator('.workspace').waitFor({state: 'visible', timeout});
    let sequence = 0;
    const patchConfig = async patch => control.evaluate(async ({patch, sequence}) => {
      const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!read?.value) throw new Error('Cannot read background config fixture');
      const current = read.value;
      const updated = {};
      const expected = {};
      for (const [key, value] of Object.entries(patch)) {
        expected[key] = current[key];
        updated[key] = value && typeof value === 'object' && !Array.isArray(value)
          ? {...current[key], ...value} : value;
      }
      const saved = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: updated, expected, clientId: 'ai-context-ui-test', sequence});
      if (!saved?.success) throw new Error(saved?.error || 'Cannot save background config fixture');
    }, {patch, sequence: ++sequence});
    const readPreference = async () => control.evaluate(async () => {
      const {value} = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      return {enableAIContext: value.enableAIContext, on: value.on, service: value.service};
    });
    const readModel = async service => control.evaluate(async service => {
      const {value} = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      return value.model[service];
    }, service);
    await patchConfig({on: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, enableAIContext: false, service: 'deepseek', interfaceSkin: 'default', theme: 'light'});
    const deepseekModel = await readModel('deepseek');
    const tongyiModel = await readModel('tongyi');
    const keyless = (service, model) => ({[`v2:${JSON.stringify([service, model])}`]: false});
    const article = await newPageWithoutForeground(context, timeout);
    await article.goto(`http://127.0.0.1:${server.address().port}/article`, {waitUntil: 'domcontentloaded', timeout});
    await activateExtensionTabWithoutForeground(context, article, timeout);
    const openPopup = async () => {
      const page = await newPageWithoutForeground(context, timeout);
      diagnostics(page, 'popup');
      await page.setViewportSize({width: 400, height: 600});
      await page.goto(`${origin}/${popupPath}`, {waitUntil: 'domcontentloaded', timeout});
      await page.locator('.popup-shell[data-config-ready="true"]').waitFor({state: 'visible', timeout});
      await page.locator('.ai-context-control').waitFor({state: 'visible', timeout});
      return page;
    };
    popup = await openPopup();
    const openHelp = async () => {
      if (await popup.locator('.ai-context-details').isVisible()) return;
      await popup.getByTestId('ai-context-help').click();
      await popup.locator('.popup-drawer .ai-context-details').waitFor({state: 'visible', timeout});
    };
    const closeHelp = async () => {
      if (!await popup.locator('.ai-context-details').isVisible()) return;
      await popup.locator('.popup-drawer .drawer-header button').click();
      await popup.locator('.popup-drawer').waitFor({state: 'hidden', timeout});
    };
    const togglePreference = async () => {
      await openHelp();
      await popup.locator('.ai-context-detail-switch').click();
      await closeHelp();
    };
    const state = async (expected, checked, disabled = false) => {
      const entry = popup.locator(`.ai-context-control[data-ai-context-state="${expected}"]`);
      await entry.waitFor({state: 'visible', timeout});
      assert.equal(await entry.evaluate(element => element.tagName), 'BUTTON');
      assert.equal(await entry.getAttribute('aria-haspopup'), 'dialog');
      const helpWasOpen = await popup.locator('.ai-context-details').isVisible();
      await openHelp();
      const toggle = popup.locator('.ai-context-detail-switch');
      assert.equal(await toggle.getAttribute('role'), 'switch');
      assert.equal(await toggle.getAttribute('aria-checked'), String(checked));
      assert.equal(await toggle.isDisabled(), disabled);
      assert.ok(await toggle.getAttribute('aria-label'), 'Switch must have an accessible name');
      assert.ok((await popup.getByTestId('ai-context-description').innerText()).trim(), 'State must include a visible explanation');
      if (disabled) assert.equal(await toggle.evaluate(element => getComputedStyle(element).cursor), 'not-allowed');
      if (!helpWasOpen) await closeHelp();
    };
    const capture = async name => {
      await assertBackground(context, report, name);
      const file = path.join(artifactsDir, `${name}.png`);
      await popup.screenshot({path: file, fullPage: true});
      report.screenshots.push(file);
    };
    const checkLayout = async label => {
      const metrics = await popup.evaluate(() => {
        const bounds = selector => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const r = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
            lineHeight: style.lineHeight, fontSize: style.fontSize, overflowY: style.overflowY,
            clientHeight: element.clientHeight, scrollHeight: element.scrollHeight};
        };
        const ids = [...document.querySelectorAll('[id]')].map(item => item.id);
        const siteRow = document.querySelector('.site-rule-row');
        const rectangle = element => {
          const r = element.getBoundingClientRect();
          return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height};
        };
        const siteLayout = siteRow && siteRow.getBoundingClientRect().width > 0 ? {
          row: rectangle(siteRow), card: rectangle(siteRow.closest('.hero-card') || siteRow),
          copy: rectangle(siteRow.querySelector('.site-rule-copy')),
          actions: rectangle(siteRow.querySelector('.site-rule-actions')),
          buttons: [...siteRow.querySelectorAll('.site-rule-button')].map(element => ({
            ...rectangle(element), label: element.innerText.trim(),
            text: [...element.querySelectorAll('span')].map(span => ({...rectangle(span), scrollWidth: span.scrollWidth, clientWidth: span.clientWidth})),
          })),
        } : null;
        return {
          shell: bounds('.popup-shell'), service: bounds('.service-picker'), serviceSelection: bounds('.service-selection'), serviceField: bounds('.service-field'), ai: bounds('.ai-context-control'),
          action: bounds('.translate-action'), button: bounds('.translate-action > button'),
          viewport: window.innerWidth, viewportHeight: window.innerHeight, documentWidth: document.documentElement.scrollWidth,
          documentHeight: document.documentElement.scrollHeight,
          root: bounds('html'), body: bounds('body'), content: bounds('.popup-content'),
          siteLayout,
          modules: Object.fromEntries(Object.entries({hero: '.hero-card', heading: '.hero-heading', language: '.language-pair',
            service: '.service-picker', ai: '.ai-context-control', warning: '.credential-warning', action: '.translate-action',
            site: '.site-rule-row', features: '.features', footer: '[data-popup-module="footer"]'}).map(([name, selector]) => [name, bounds(selector)])),
          duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
        };
      });
      report.layouts.push({label, ...metrics});
      assert.ok(metrics.shell.width <= 400.5 && metrics.documentWidth <= metrics.viewport + 1, `${label}: popup overflows horizontally`);
      if (metrics.documentHeight > 601) report.layoutFailures.push({label, documentHeight: metrics.documentHeight, message: 'Popup exceeds the 600px browser popup height'});
      if (metrics.shell.clientHeight > 600 || metrics.documentHeight > metrics.viewportHeight + 1) {
        report.layoutFailures.push({label, shellClientHeight: metrics.shell.clientHeight, documentHeight: metrics.documentHeight,
          viewportHeight: metrics.viewportHeight, message: 'Popup must scroll within the shell without outer document overflow'});
      }
      assert.ok(metrics.ai.x >= metrics.service.x - 1 && metrics.ai.right <= metrics.service.right + 1
        && metrics.ai.y >= metrics.service.y - 1 && metrics.ai.bottom <= metrics.service.bottom + 1, `${label}: compact AI context entry must remain inside the service card`);
      assert.ok(metrics.ai.height <= metrics.serviceField.height + 1 && metrics.ai.width <= 80, `${label}: compact AI context entry must fit beside the existing service field`);
      assert.ok(metrics.serviceSelection.height <= metrics.serviceField.height + 2, `${label}: compact AI entry must not add a row to the service selector`);
      assert.equal(Math.min(metrics.ai.right, metrics.serviceField.right) - Math.max(metrics.ai.x, metrics.serviceField.x) > 1
        && Math.min(metrics.ai.bottom, metrics.serviceField.bottom) - Math.max(metrics.ai.y, metrics.serviceField.y) > 1, false,
      `${label}: AI context and service picker buttons must not overlap`);
      assert.ok(Math.abs(metrics.button.width - metrics.action.width) <= 1, `${label}: translate button must occupy the full action width`);
      assert.deepEqual(metrics.duplicateIds, [], `${label}: duplicate element IDs`);
      if (metrics.siteLayout) {
        const site = metrics.siteLayout;
        const within = (inner, outer) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1
          && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
        const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        assert.ok(within(site.row, site.card), `${label}: current-site card overflows its parent card`);
        assert.ok(within(site.copy, site.row) && within(site.actions, site.row), `${label}: current-site copy or actions escape their card`);
        assert.equal(overlaps(site.copy, site.actions), false, `${label}: current-site copy and actions overlap`);
        for (const [index, button] of site.buttons.entries()) {
          assert.ok(within(button, site.row) && within(button, site.actions), `${label}: current-site button escapes its card`);
          for (const text of button.text) assert.ok(within(text, button) && text.scrollWidth <= text.clientWidth + 1, `${label}: current-site button label is clipped`);
          for (const other of site.buttons.slice(index + 1)) assert.equal(overlaps(button, other), false, `${label}: current-site buttons overlap`);
        }
      }
      if (metrics.shell.scrollHeight > metrics.shell.clientHeight + 1 && metrics.shell.clientHeight <= 600) {
        try {
          await popup.locator('.popup-shell').evaluate(element => { element.scrollTop = element.scrollHeight; });
          await popup.waitForFunction(() => {
            const shell = document.querySelector('.popup-shell').getBoundingClientRect();
            const footer = document.querySelector('[data-popup-module="footer"]').getBoundingClientRect();
            return footer.top >= shell.top - 1 && footer.bottom <= Math.min(shell.bottom, innerHeight) + 1;
          }, null, {timeout});
          await capture(`${label}-scrolled-bottom`);
          report.layouts.at(-1).footerReachableByInternalScroll = true;
        } finally {
          await popup.locator('.popup-shell').evaluate(element => { element.scrollTop = 0; });
        }
      }
    };
    const record = id => report.caseCoverage.push({id, status: 'passed'});

    await state('needs-setup', false);
    await checkLayout('default-needs-setup');
    await togglePreference();
    await state('needs-setup', true);
    assert.match(await popup.getByTestId('ai-context-help').getAttribute('aria-label'), /AI 精翻/);
    await capture('ai-context-needs-setup');
    record('missing-key-never-ready-and-preference-remains-configurable');

    await patchConfig({requireApiKey: keyless('deepseek', deepseekModel)});
    await state('ready', true);
    await capture('ai-context-ready');
    const translationCardFile = path.join(artifactsDir, 'ai-context-translation-card.png');
    await popup.locator('.hero-card').screenshot({path: translationCardFile});
    report.screenshots.push(translationCardFile);
    await popup.getByTestId('ai-context-help').click();
    await popup.getByRole('dialog', {name: 'AI 精翻', exact: true}).waitFor({state: 'visible', timeout});
    await popup.locator('.popup-drawer .ai-context-details').waitFor({state: 'visible', timeout});
    assert.equal(await popup.getByTestId('ai-context-settings').isVisible(), true);
    await capture('ai-context-help');
    await popup.keyboard.press('Escape');
    await popup.locator('.popup-drawer').waitFor({state: 'hidden', timeout});
    assert.equal(await popup.getByTestId('ai-context-help').evaluate(element => document.activeElement === element), true, 'Escape must restore focus to the help trigger');
    await popup.getByTestId('ai-context-help').click();
    await popup.getByRole('dialog', {name: 'AI 精翻', exact: true}).waitFor({state: 'visible', timeout});
    await popup.locator('.popup-drawer .drawer-header button').click();
    await popup.locator('.popup-drawer').waitFor({state: 'hidden', timeout});
    record('help-explains-feature-and-can-close');
    await popup.locator('.service-field').click();
    await popup.locator('.service-picker-panel').waitFor({state: 'visible', timeout});
    await popup.getByTestId('ai-context-help').click();
    await popup.locator('.popup-drawer .ai-context-details').waitFor({state: 'visible', timeout});
    await popup.locator('.service-picker-panel').waitFor({state: 'hidden', timeout});
    await closeHelp();
    record('opening-ai-details-closes-service-picker-panel');

    // Use the real popup service picker for supported/unsupported transitions.
    const chooseService = async (service, query) => {
      await popup.locator('.service-field').click();
      await popup.locator('.service-search input').fill(query);
      await popup.locator(`.service-option[data-service-value="${service}"]`).click();
      await popup.locator('.service-picker-panel').waitFor({state: 'hidden', timeout});
    };
    await chooseService('microsoft', '微软');
    await state('unsupported', true);
    await capture('ai-context-unsupported');
    await togglePreference();
    await state('unsupported', false);
    await togglePreference();
    await state('unsupported', true);
    await chooseService('deepseek', 'DeepSeek');
    await state('ready', true);
    record('real-service-picker-preserves-preference-across-capabilities');

    await patchConfig({service: 'tongyi', model: {tongyi: tongyiModel}, requireApiKey: keyless('tongyi', tongyiModel)});
    await state('ready', true);
    await patchConfig({model: {tongyi: 'qwen-mt-turbo'}});
    await state('unsupported', true);
    await patchConfig({model: {tongyi: tongyiModel}});
    await state('ready', true);
    report.crossPageSync.push({id: 'external-model-selection', states: ['ready', 'unsupported', 'ready'], passed: true});
    record('model-capability-updates-without-popup-reload');

    await patchConfig({
      customOpenAIProviders: [{id: 'custom:ai-context-ui', name: 'Context UI Fixture', endpoint: `http://127.0.0.1:${server.address().port}/v1`, models: ['local-context-model']}],
      model: {'custom:ai-context-ui': 'local-context-model'},
      requireApiKey: {'v2:["custom:ai-context-ui","local-context-model"]': false},
    });
    await chooseService('custom:ai-context-ui', 'Context UI Fixture');
    await state('ready', true);
    assert.equal(await popup.locator('.service-field').getAttribute('data-selected-model'), 'local-context-model');
    await capture('ai-context-custom-provider');
    await togglePreference();
    await state('off', false);
    await togglePreference();
    await state('ready', true);
    await patchConfig({service: 'tongyi'});
    await state('ready', true);
    record('dynamic-custom-provider-supports-context-and-preference-toggle');

    // No storage wait before closing: exercise the short-lived popup save path.
    for (const enabled of [false, true]) {
      const before = await readPreference();
      await openHelp();
      await popup.locator('.ai-context-detail-switch').click();
      await popup.close();
      popup = await openPopup();
      await state(enabled ? 'ready' : 'off', enabled);
      const after = await readPreference();
      assert.equal(after.enableAIContext, enabled);
      const result = {before: before.enableAIContext, expected: enabled, reopened: after.enableAIContext, closedImmediatelyAfterClick: true, passed: true};
      report.quickClose.push(result);
      report.persistenceCases.push({id: `quick-close-${enabled}`, ...result});
    }
    await openHelp();
    await popup.locator('.ai-context-detail-switch').click();
    await popup.locator('.ai-context-detail-switch').click();
    await popup.close();
    popup = await openPopup();
    await state('ready', true);
    assert.equal((await readPreference()).enableAIContext, true);
    report.latestWriteWins.push({id: 'consecutive-toggle-before-close', finalValue: true, passed: true});
    await capture('ai-context-persisted-after-reopen');
    record('quick-close-and-latest-toggle-persist');

    await popup.locator('.hero-switches [role="switch"]').click();
    await state('paused', true, true);
    await capture('ai-context-paused');
    assert.equal(await popup.getByTestId('ai-context-help').isDisabled(), false);
    await popup.locator('.hero-switches [role="switch"]').click();
    await state('ready', true);
    record('global-pause-disables-toggle-but-retains-preference-and-help');

    for (const skin of skins) {
      for (const variant of [{language: 'zh-CN', theme: 'light'}, {language: 'en-US', theme: 'dark'}]) {
        await patchConfig({interfaceSkin: skin, uiLanguage: variant.language, theme: variant.theme});
        await popup.reload({waitUntil: 'domcontentloaded', timeout});
        await state('ready', true);
        await popup.waitForFunction(({skin, dark}) => document.documentElement.dataset.interfaceSkin === skin && document.documentElement.classList.contains('dark') === dark,
          {skin, dark: variant.theme === 'dark'}, {timeout});
        const label = `ai-context-${skin}-${variant.language}-${variant.theme}`;
        await checkLayout(label);
        await capture(label);
        if (variant.language === 'en-US') {
          assert.doesNotMatch(await popup.locator('.ai-context-control').innerText(), /[\u3400-\u9fff]/, `${label}: untranslated Chinese text`);
        }
      }
    }
    record('all-11-skins-chinese-light-and-english-dark-without-horizontal-overflow');
    await patchConfig({interfaceSkin: 'default', uiLanguage: 'zh-CN', theme: 'light'});
    await popup.reload({waitUntil: 'domcontentloaded', timeout});
    await state('ready', true);
    await popup.getByTestId('ai-context-help').click();
    const settingsOpened = context.waitForEvent('page', {timeout});
    await popup.getByTestId('ai-context-settings').click();
    const settings = await settingsOpened;
    await settings.waitForURL(url => url.protocol === 'chrome-extension:' && url.hostname === new URL(origin).hostname && url.pathname.endsWith(optionsPath), {timeout});
    assert.ok(settings.url().includes('#settings-'), 'Help link must target a relevant settings section');
    report.settingsNavigation = {url: settings.url(), invokedExtensionApi: true};
    await assertBackground(context, report, 'settings-navigation');
    record('help-settings-action-opens-real-extension-settings');
    assert.deepEqual(report.consoleErrors, [], 'Unexpected extension page or worker errors');
    assert.deepEqual(report.layoutFailures, [], 'Popup height regressions were collected in layoutFailures');
    report.passed = true;
  } catch (error) {
    primaryError = error;
    report.failure = error.message;
    if (popup && !popup.isClosed()) {
      const failureFile = path.join(artifactsDir, 'failure.png');
      await popup.screenshot({path: failureFile, fullPage: true}).then(() => report.screenshots.push(failureFile)).catch(() => {});
    }
    throw error;
  } finally {
    const cleanupErrors = [];
    const cleanup = async action => {
      try {await action();} catch (error) {cleanupErrors.push(error);}
    };
    let browserClosed = false;
    await cleanup(async () => {
      if (launched) {await launched.close(); browserClosed = true;}
    });
    await cleanup(async () => {if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));});
    await cleanup(() => {
      if (browserClosed) fs.rmSync(profileDir, {recursive: true, force: true});
      else if (!launchAttempted) {
        // No browser launch was attempted; only remove an empty initial profile.
        try {fs.rmdirSync(profileDir);} catch (error) {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
      }
    });
    if (cleanupErrors.length) {
      report.passed = false;
      report.cleanupErrors = cleanupErrors.map(error => error.stack || String(error));
    }
    await cleanup(() => {fs.writeFileSync(path.join(artifactsDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);});
    for (const error of cleanupErrors) process.stderr.write(`Cleanup failed: ${error.stack || error}\n`);
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  }
  process.stdout.write(`${JSON.stringify({passed: report.passed, report: path.join(artifactsDir, 'report.json'), cases: report.caseCoverage.length, layouts: report.layouts.length, screenshots: report.screenshots.length, consoleErrors: report.consoleErrors.length})}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

/**
 * @file scripts/testing/run-color-field-focus-test.cjs
 * 文件职责：在独占临时后台 Edge 验证生产扩展中两个设置消费者的共享色板键盘、焦点归属与颜色保存。
 * 主要内容：六字段的真实六键、循环、单一 Tab、精确输入与重载保存；另外短时捕获本次页面的 RAF，用可信箭头按键及原生 DOM focus 对照基线与修复包，保存浅色桌面、深色窄屏和完整诊断。
 * 模块边界：只使用临时 profile、现有权威配置消息与项目 focus-safe/owned-browser helper；不操作用户浏览器、不打开取色菜单、不请求服务、不构建、不运行完整设置矩阵，也不把受控调度当成人类按键频率证据。
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {guardBrowserClose, getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const {waitForAsyncCondition} = require('./wait-for-async-condition.cjs');
const arg = (name, fallback) => {const index = process.argv.indexOf(`--${name}`);return index < 0 ? fallback : process.argv[index + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-color-field-focus'));
const expected = arg('expect', 'optimized');
assert(['baseline', 'optimized'].includes(expected), '--expect must be baseline or optimized');
const helper = require(path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))));
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const popupPath = manifest.action?.default_popup || manifest.browser_action?.default_popup;
const optionsPath = manifest.options_ui?.page || manifest.options_page;
assert(popupPath && optionsPath, 'actual manifest popup and options entries are required');
const fields = [
  {id: 'translation-text-color', owner: 'TranslationStyleSettings', object: 'translationAppearance', key: 'textColor'},
  {id: 'translation-background-color', owner: 'TranslationStyleSettings', object: 'translationAppearance', key: 'backgroundColor'},
  {id: 'translation-line-color', owner: 'TranslationStyleSettings', object: 'translationAppearance', key: 'lineColor'},
  {id: 'translation-fill-color', owner: 'TranslationStyleSettings', object: 'translationAppearance', key: 'fillColor'},
  {id: 'sentence-highlight-background', owner: 'SentenceHighlightStyleSettings', object: 'bilingualSentenceHighlightAppearance', key: 'backgroundColor'},
  {id: 'sentence-highlight-line', owner: 'SentenceHighlightStyleSettings', object: 'bilingualSentenceHighlightAppearance', key: 'lineColor'},
];
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-color-field-focus-'));
const report = {ok: false, expected, extensionDir, production: !extensionDir.endsWith('-dev'), manifest: {version: manifest.version, popup: popupPath, options: optionsPath},
  scope: 'Six actual options color fields; natural trusted keyboard/Tab, named/RGB/hex/invalid input, authority persistence and reload; two consumers × three destinations with production SFC/native DOM and controlled RAF scheduling. No inference about human Tab frequency, natural race speed, Firefox runtime or user devices. No provider requests, full settings matrix or user configuration.',
  normalKeys: [], nativeTab: [], inputCases: [], persistenceCases: [], controlledFocusCases: [], gateRecoveries: [], fixtureWrites: [],
  screenshots: [], layouts: [], focusChecks: [], consoleErrors: [], consoleWarnings: [], externalRequests: [], cleanup: {profileRemoved: false}};
fs.mkdirSync(artifactsDir, {recursive: true});
let session, page, browserPid, launchAttempted = false, sequence = 0;
const saveReport = () => fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
const fieldLocator = field => page.locator(`[data-color-field="${field.id}"]`);
const colorValue = (config, field) => config[field.object]?.[field.key] ?? '';
const colorSnapshot = config => Object.fromEntries(fields.map(field => [field.id, colorValue(config, field)]));
function diagnostics(surface, label) {
  surface.on('pageerror', error => report.consoleErrors.push({label, type: 'pageerror', error: error.message}));
  surface.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push({label, type: 'console', error: message.text()});
    if (message.type() === 'warning') report.consoleWarnings.push({label, error: message.text()});
  });
}
async function readConfig() {
  const response = await page.evaluate(() => chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}));
  assert.equal(response?.success, true, 'current configuration authority read must succeed');
  const config = typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
  assert(config && typeof config === 'object', 'authority must return an initialized configuration');
  return config;
}
async function fixturePatch(config) {
  const current = await readConfig();
  const response = await page.evaluate(payload => chrome.runtime.sendMessage(payload), {type: 'persistConfig', mode: 'patch', config,
    expected: Object.fromEntries(Object.keys(config).map(key => [key, current[key]])), baseRevision: current.__fluentConfigRevision || 0,
    clientId: 'color-field-focus-fixture', sequence: ++sequence});
  assert.equal(response?.success, true, 'synthetic fixture write must succeed');
  report.fixtureWrites.push({keys: Object.keys(config), sequence, success: true, revision: response.revision});
}
async function waitColor(field, expectedColor) {
  let saved;
  await waitForAsyncCondition(async () => {saved = await readConfig();return colorValue(saved, field) === expectedColor;},
    {timeoutMs: 10000, pollingMs: 50, message: `${field.id} authority color did not persist`});
  return {color: colorValue(saved, field), revision: saved.__fluentConfigRevision || 0};
}
async function focusSafety(label) {
  const frontmost = await helper.queryMacFrontmostApplication();
  assert(frontmost && frontmost.pid !== browserPid, 'owned Edge must not become the foreground application');
  report.focusChecks.push({label, browserFrontmost: false, frontmost});
}
async function shot(name) {
  const file = path.join(artifactsDir, `${name}.png`);await page.screenshot({path: file, animations: 'disabled'});report.screenshots.push(file);
}
async function noOverflow(label) {
  const layout = await page.evaluate(() => ({width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    fields: [...document.querySelectorAll('[data-color-field]')].map(node => {const rect = node.getBoundingClientRect();return {id: node.dataset.colorField, left: rect.left, right: rect.right, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth};})}));
  report.layouts.push({label, ...layout});assert(layout.scrollWidth <= layout.width, `${label}: document horizontal overflow`);
  for (const field of layout.fields) {assert(field.left >= -1 && field.right <= layout.width + 1, `${label}: ${field.id} exceeds viewport`);assert(field.scrollWidth <= field.clientWidth + 1, `${label}: ${field.id} internal horizontal overflow`);}
}
async function openColors() {
  for (const selector of ['.translation-appearance-disclosure', '.sentence-highlight-custom-disclosure']) {
    const disclosure = page.locator(selector);await disclosure.waitFor();
    if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
  }
  for (const field of fields) {await fieldLocator(field).waitFor();assert.equal(await fieldLocator(field).count(), 1);}
}
async function normalKeyboard(field) {
  const fieldNode = fieldLocator(field), radios = fieldNode.locator('[role="radio"]');
  const choices = await radios.evaluateAll(nodes => nodes.map(node => ({index: Number(node.dataset.choiceIndex), color: node.dataset.color || ''})));
  assert(choices.length > 1, `${field.id} must contain its real palette`);
  await radios.first().click();await waitColor(field, '');let index = 0;
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'End', 'Home', 'ArrowLeft', 'ArrowRight']) {
    await radios.nth(index).focus();
    index = key === 'Home' ? 0 : key === 'End' ? choices.length - 1
      : (index + (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
    await page.keyboard.press(key);
    await page.waitForFunction(({id, index}) => {const field = document.querySelector(`[data-color-field="${id}"]`), selected = field?.querySelector('[role="radio"][aria-checked="true"]');
      return Number(selected?.getAttribute('data-choice-index')) === index && document.activeElement === selected;}, {id: field.id, index});
    assert.equal(await radios.evaluateAll(nodes => nodes.filter(node => node.tabIndex === 0).length), 1);
    const saved = await waitColor(field, choices[index].color);
    report.normalKeys.push({field: field.id, key, choiceIndex: index, selected: choices[index].color, tabStops: 1, saved});
  }
  assert.equal(index, 0, 'wraparound sequence must return to default');
  await page.keyboard.press('Tab');
  const tab = await fieldNode.evaluate(node => {const active = document.activeElement;return {leftGroup: !node.querySelector('[role="radiogroup"]').contains(active), pickerFocused: node.querySelector('.el-color-picker[tabindex="0"]') === active, activeTag: active?.tagName, activeClass: typeof active?.className === 'string' ? active.className : null};});
  report.nativeTab.push({field: field.id, ...tab});assert(tab.leftGroup, 'native Tab must leave the radio group');assert(tab.pickerFocused, 'native Tab should reach the real picker trigger without opening it');
  await page.keyboard.press('Shift+Tab');assert.equal(await radios.first().evaluate(node => node === document.activeElement), true);
}
async function preciseInput(field) {
  const fieldNode = fieldLocator(field), input = fieldNode.locator('input.translation-color-value');
  const before = await readConfig();await input.fill('not-a-color');await input.press('Enter');
  await page.waitForFunction(id => document.querySelector(`[data-color-field="${id}"] input`)?.getAttribute('aria-invalid') === 'true', field.id);
  const rejected = await readConfig();assert.deepEqual(colorSnapshot(rejected), colorSnapshot(before));assert.equal(rejected.__fluentConfigRevision || 0, before.__fluentConfigRevision || 0);
  assert.equal(await input.inputValue(), 'not-a-color');assert.equal(await fieldNode.locator('[role="alert"]').count(), 1);
  report.inputCases.push({field: field.id, input: 'not-a-color', invalid: true, stored: colorValue(rejected, field), revisionUnchanged: true});
  for (const [value, normalized] of [['red', '#ff0000'], ['rgb(0, 255, 0)', '#00ff00'], ['#AbC', '#aabbcc'], ['', '']]) {
    await input.fill(value);await input.press('Enter');
    await page.waitForFunction(({id, normalized}) => {const input = document.querySelector(`[data-color-field="${id}"] input`);return input?.value === normalized && input.getAttribute('aria-invalid') === 'false';}, {id: field.id, normalized});
    const saved = await waitColor(field, normalized);report.inputCases.push({field: field.id, input: value, normalized, invalid: false, saved});
  }
}
async function installGate(field) {
  await page.evaluate(id => {
    if (window.__fluentReadColorFocusGate) throw new Error('previous color RAF gate was not restored');
    const field = document.querySelector(`[data-color-field="${id}"]`), group = field.querySelector('[role="radiogroup"]');
    const gate = {nativeRequest: window.requestAnimationFrame, nativeCancel: window.cancelAnimationFrame, frames: new Map(), nextId: -1,
      requested: 0, canceled: 0, started: performance.now(), group, origin: document.activeElement, destination: null, trustedKeys: [], finished: null};
    gate.listener = event => {if (event.key === 'ArrowRight') gate.trustedKeys.push({key: event.key, isTrusted: event.isTrusted, choiceIndex: event.target?.getAttribute('data-choice-index')});};
    group.addEventListener('keydown', gate.listener, true);
    gate.request = callback => {const frameId = gate.nextId--;gate.requested++;gate.frames.set(frameId, callback);return frameId;};
    gate.cancel = frameId => {if (frameId < 0) {if (gate.frames.delete(frameId)) gate.canceled++;} else gate.nativeCancel.call(window, frameId);};
    gate.finish = watchdogExpired => {
      if (gate.finished) return gate.finished;
      window.requestAnimationFrame = gate.nativeRequest;window.cancelAnimationFrame = gate.nativeCancel;clearTimeout(gate.watchdog);
      group.removeEventListener('keydown', gate.listener, true);
      const callbacks = [...gate.frames.values()];gate.frames.clear();const callbackErrors = [];
      for (const callback of callbacks) try {callback(performance.now());} catch (error) {callbackErrors.push(error.message);}
      const selected = group.querySelector('[role="radio"][aria-checked="true"]'), active = document.activeElement;
      gate.finished = {durationMs: performance.now() - gate.started, requestedCallbacks: gate.requested, canceledCallbacks: gate.canceled,
        flushedCallbacks: callbacks.length, callbackErrors, watchdogExpired, trustedKeys: gate.trustedKeys, destinationHadFocus: gate.destinationHadFocus,
        destinationRetained: active === gate.destination, focusInGroup: group.contains(active), focusChoiceIndex: active?.getAttribute('data-choice-index'),
        selectedChoiceIndex: selected?.getAttribute('data-choice-index'), selectedColor: selected?.getAttribute('data-color') || '',
        activeTag: active?.tagName, activeClass: typeof active?.className === 'string' ? active.className : null};
      return gate.finished;
    };
    window.__fluentReadColorFocusGate = gate;window.requestAnimationFrame = gate.request;window.cancelAnimationFrame = gate.cancel;
    // Recover unrelated page frames even if the runner stalls; an expired gate is a fixture failure, never product evidence.
    gate.watchdog = setTimeout(() => gate.finish(true), 2000);
  }, field.id);
}
async function finishGate() {
  return page.evaluate(() => {const gate = window.__fluentReadColorFocusGate;if (!gate) return null;
    try {return gate.finish(false);} finally {window.requestAnimationFrame = gate.nativeRequest;window.cancelAnimationFrame = gate.nativeCancel;delete window.__fluentReadColorFocusGate;}});
}
async function controlledCase(field, target) {
  const fieldNode = fieldLocator(field), origin = fieldNode.locator('[role="radio"][data-choice-index="0"]');
  await origin.click();await waitColor(field, '');await origin.focus();let installed = false;
  try {
    await installGate(field);installed = true;await page.keyboard.press('ArrowRight');
    await page.waitForFunction(id => document.querySelector(`[data-color-field="${id}"] [role="radio"][aria-checked="true"]`)?.getAttribute('data-choice-index') === '1', field.id, {polling: 25, timeout: 1500});
    await page.evaluate(({id, target}) => {
      const gate = window.__fluentReadColorFocusGate, field = document.querySelector(`[data-color-field="${id}"]`);
      if (!gate || gate.finished) throw new Error('color RAF gate expired before focus departure');
      const destination = target === 'input' ? field.querySelector('input.translation-color-value')
        : target === 'picker' ? field.querySelector('.el-color-picker[tabindex="0"]') : document.querySelector('.translation-appearance-disclosure');
      if (!destination || gate.group.contains(destination)) throw new Error('expected real focus destination outside color group');
      gate.destination = destination;destination.focus({preventScroll: true});gate.destinationHadFocus = document.activeElement === destination;
      if (!gate.destinationHadFocus) throw new Error('native destination focus failed');
    }, {id: field.id, target});
    const state = await finishGate();installed = false;
    assert(state && !state.watchdogExpired, 'controlled gate must finish within its short safety window');
    assert.deepEqual(state.callbackErrors, []);assert(state.flushedCallbacks >= 1, 'trusted key must register at least one captured frame');
    assert.deepEqual(state.trustedKeys, [{key: 'ArrowRight', isTrusted: true, choiceIndex: '0'}]);
    const saved = await waitColor(field, state.selectedColor), row = {field: field.id, owner: field.owner, target,
      methodology: 'Trusted CDP ArrowRight, production Vue SFC/native DOM focus, captured callbacks flushed after restoring native RAF; controlled scheduling, not natural human timing.', ...state, saved};
    report.controlledFocusCases.push(row);saveReport();
    assert.equal(state.selectedChoiceIndex, '1');assert.equal(saved.color, state.selectedColor);assert.equal(state.destinationHadFocus, true);
    assert.equal(state.destinationRetained, expected === 'optimized');assert.equal(state.focusInGroup, expected === 'baseline');
    if (expected === 'baseline') assert.equal(state.focusChoiceIndex, '1');
  } finally {
    if (installed && !page.isClosed()) {const restored = await finishGate();report.gateRecoveries.push({field: field.id, target, restored});}
  }
}
(async () => {
  try {
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'), background: true, headless: false,
      displayTarget: arg('display', 'secondary'), viewport: {width: 1440, height: 1000}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);browserPid = await getGuardedBrowserPid(session);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');assert.equal(report.windowPlacement.browserFrontmost, false);
    await session.context.route(/^https?:/u, route => {report.externalRequests.push({hostname: new URL(route.request().url()).hostname, method: route.request().method()});return route.abort();});
    const worker = session.context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await session.context.waitForEvent('serviceworker', {timeout: 30000});
    diagnostics(worker, 'worker');const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
    page = await helper.newPageWithoutForeground(session.context, 30000);diagnostics(page, 'options');page.setDefaultTimeout(10000);
    await page.goto(`${extensionOrigin}/${popupPath}`);const current = await readConfig();
    await fixturePatch({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, theme: 'light', display: 1,
      activeTranslationStyleProfileId: '', activeSentenceHighlightProfileId: '',
      translationAppearance: {...current.translationAppearance, textColor: '', backgroundColor: '', lineColor: '', fillColor: ''},
      bilingualSentenceHighlightAppearance: {...current.bilingualSentenceHighlightAppearance, backgroundColor: '', lineColor: ''}});
    await page.goto(`${extensionOrigin}/${optionsPath}#settings-interface`);await helper.activateExtensionTabWithoutForeground(session.context, page);
    await openColors();await focusSafety('options-ready');
    for (const field of fields) {await normalKeyboard(field);await preciseInput(field);saveReport();}
    assert.equal(report.normalKeys.length, 48);assert.equal(report.nativeTab.length, 6);assert.equal(report.inputCases.length, 30);
    for (const field of [fields[0], fields[4]]) for (const target of ['input', 'picker', 'outside']) await controlledCase(field, target);
    assert.equal(report.controlledFocusCases.length, 6);
    // Finish with custom colors so reloading exercises all six v-model paths, not only an already-default palette.
    for (const field of fields) {
      const input = fieldLocator(field).locator('input.translation-color-value');await input.fill('#123456');await input.press('Enter');
      report.persistenceCases.push({field: field.id, beforeReload: await waitColor(field, '#123456')});
    }
    await page.reload();await openColors();
    const reopened = await readConfig();
    for (const result of report.persistenceCases) {const field = fields.find(field => field.id === result.field);
      assert.equal(colorValue(reopened, field), '#123456');assert.equal(await fieldLocator(field).locator('input.translation-color-value').inputValue(), '#123456');
      assert.equal(await fieldLocator(field).locator('[role="radio"][tabindex="0"]').count(), 1);result.afterReload = '#123456';result.passed = true;}
    await noOverflow('desktop-light');await page.locator('.translation-appearance-colors').scrollIntoViewIfNeeded();await shot('desktop-translation-colors');
    await page.locator('.sentence-highlight-custom-grid').scrollIntoViewIfNeeded();await shot('desktop-sentence-highlight-colors');
    await page.setViewportSize({width: 390, height: 844});await fixturePatch({theme: 'dark'});
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));await noOverflow('390-dark');
    await page.locator('.translation-appearance-colors').scrollIntoViewIfNeeded();await shot('390-dark-translation-colors');
    await page.locator('.sentence-highlight-custom-grid').scrollIntoViewIfNeeded();await shot('390-dark-sentence-highlight-colors');
    await focusSafety('completed');assert.deepEqual(report.consoleErrors, []);assert.deepEqual(report.externalRequests, []);report.ok = true;
  } catch (error) {
    report.error = error.stack;process.exitCode = 1;
    if (page && !page.isClosed()) {try {const restored = await finishGate();if (restored) report.gateRecoveries.push({failureRecovery: restored});} catch (restoreError) {report.gateRestoreError = restoreError.message;}
      try {await shot('failure');} catch (screenshotError) {report.screenshotError = screenshotError.message;}}
  } finally {
    let closed = !launchAttempted;
    if (session) try {await session.close();closed = true;} catch (error) {report.cleanup.error = error.message;report.ok = false;process.exitCode = 1;}
    if (closed) {fs.rmSync(profileDir, {recursive: true, force: true});report.cleanup.profileRemoved = true;} else report.cleanup.retainedProfile = profileDir;
    saveReport();console.log(JSON.stringify({ok: report.ok, expected, normalKeys: report.normalKeys.length, nativeTab: report.nativeTab.length,
      inputCases: report.inputCases.length, persistenceCases: report.persistenceCases.length, controlledFocusCases: report.controlledFocusCases.length,
      consoleErrors: report.consoleErrors, externalRequests: report.externalRequests, launchMode: report.launchMode, cleanup: report.cleanup, error: report.error}, null, 2));
  }
})();

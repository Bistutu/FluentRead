#!/usr/bin/env node
'use strict';
// 设置历史专项：通过真实生产扩展验证相邻版本修改、恢复差异、重开、快照及桌面/窄屏/深色布局。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const support = require('../run-selection-trigger-test.cjs');
const arg = (name, fallback) => {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const output = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-config-history-ui'));
const {chromium} = createRequire(path.join(arg('playwright-root'), 'package.json'))('playwright');
const helper = require(path.resolve(arg('focus-safe-helper')));
const report = {ok: false, extensionDir, cases: [], screenshots: [], consoleErrors: []};
const record = name => { report.cases.push(name); console.log('PASS', name); };
let session, page, optionsUrl, profileDir;
let launchAttempted = false;
async function storedHistory() {
  const response = await support.sendExtensionMessage(page, {type: 'configStorageRead', key: 'local:configHistory'});
  assert.equal(response.success, true);
  return typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
}
async function waitConfig(field, value) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (JSON.stringify((await support.readStoredConfig(page))[field]) === JSON.stringify(value)) {
      const history = await storedHistory();
      if (JSON.stringify(history.entries[history.cursor].config[field]) === JSON.stringify(value)) return;
    }
    await page.waitForTimeout(50);
  }
  throw new Error('Configuration save timed out: ' + field);
}
async function openHistory() {
  await page.locator('button[data-section="settings-data"]').click();
  await page.locator('#recent-config-title').waitFor();
  await page.locator('.history-heading').scrollIntoViewIfNeeded();
}
async function shot(name) {
  const file = path.join(output, name + '.png');
  await page.screenshot({path: file, animations: 'disabled'});
  report.screenshots.push(file);
}
async function closeDialog() {
  await page.locator('.config-preview-dialog:visible').getByRole('button', {name: '关闭', exact: true}).click();
  await page.locator('.config-preview-dialog:visible').waitFor({state: 'hidden'});
}
async function selectTarget(label) {
  await page.locator('button[data-section="settings-general"]').click();
  await page.locator('[data-config-field="to"] .el-select__wrapper').click();
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({hasText: label}).click();
}
async function layout() {
  return page.locator('.settings-app').evaluate(element => ({
    horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
    outerHorizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    rowOverflow: [...element.querySelectorAll('.version-entry')].some(row => row.scrollWidth > row.clientWidth + 1),
    panels: [...element.querySelectorAll('.version-panel')].map(panel => ({width: panel.getBoundingClientRect().width, height: panel.getBoundingClientRect().height})),
  }));
}
async function newOptions() {
  const result = await helper.newPageWithoutForeground(session.context);
  result.on('pageerror', error => report.consoleErrors.push(error.message));
  result.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await result.goto(optionsUrl);
  await result.locator('.settings-app').waitFor();
  return result;
}
(async () => {
  try {
    fs.mkdirSync(output, {recursive: true});
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-history-'));
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({
      chromium, profileDir, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      headless: false, background: true, displayTarget: 'secondary',
      browserArgs: ['--disable-extensions-except=' + extensionDir, '--load-extension=' + extensionDir, '--no-first-run', '--no-default-browser-check'],
      viewport: {width: 1440, height: 1000},
    });
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    const {worker, extensionId} = await support.waitForWorker(session.context);
    worker.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    optionsUrl = 'chrome-extension://' + extensionId + '/options.html#settings-general';
    page = await newOptions();
    await support.patchStoredConfig(page, {uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, theme: 'light', to: 'zh-Hans', display: 1, service: 'freeTranslation'});
    await page.reload(); await page.locator('.settings-app').waitFor();
    await selectTarget('English / 英语');
    await waitConfig('to', 'en');
    await page.getByRole('radiogroup', {name: '翻译模式', exact: true}).getByRole('radio').first().click();
    await waitConfig('display', 0);
    await selectTarget('日本語 / Japanese / 日语');
    await waitConfig('to', 'ja');
    const history = await storedHistory();
    const latestVersion = history.entries[history.cursor].version;
    await page.close();
    page = await newOptions();
    await openHistory();
    const recent = page.locator('.version-panel').first().locator('.version-entry');
    assert((await recent.first().textContent()).includes('默认目标语言'));
    assert((await recent.first().textContent()).includes('English'));
    assert((await recent.first().textContent()).includes('日本語'));
    // 列表只显示到分钟；完整时间保留在悬停提示里。
    assert.match(await recent.first().locator('time').textContent(), /\d{2}:\d{2}$/);
    assert.match(await recent.first().locator('time').getAttribute('title'), /\d{2}:\d{2}:\d{2}/);
    assert.equal(await recent.first().locator('.change-values').count(), 1, 'a single change shows before → after inline');
    assert.equal(await page.locator('.version-panel-heading > span').count(), 0, 'no redundant n/10 counters');
    assert.equal(await recent.first().locator('.current-mark').textContent(), '当前');
    assert((await recent.nth(1).textContent()).includes('翻译模式'));
    record('real UI saves produce distinct field and before/after summaries after reopening');
    report.desktop = await layout();
    assert.equal(report.desktop.horizontalOverflow, false);
    assert.equal(report.desktop.rowOverflow, false);
    assert(report.desktop.panels[0].width > report.desktop.panels[1].width);
    assert(report.desktop.panels[1].height < report.desktop.panels[0].height);
    await shot('settings-history-desktop');
    const panelShot = path.join(output, 'settings-history-panel.png');
    await page.locator('.version-grid').screenshot({path: panelShot, animations: 'disabled'});
    report.screenshots.push(panelShot);
    await recent.first().click();
    const dialog = page.locator('.config-preview-dialog:visible');
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('button', {name: '本次修改', exact: true}).getAttribute('aria-pressed'), 'true');
    assert.equal(await dialog.locator('.diff-item').count(), 1);
    assert((await dialog.locator('.diff-item').textContent()).includes('English'));
    assert((await dialog.locator('.diff-item').textContent()).includes('日本語'));
    assert.equal(await dialog.getByRole('button', {name: '恢复此版本', exact: true}).isDisabled(), true);
    await shot('settings-history-latest-change');
    await dialog.getByRole('button', {name: '与当前比较', exact: true}).click();
    assert.equal(await dialog.locator('.diff-item').count(), 0);
    assert((await dialog.locator('.diff-empty').textContent()).includes('完全相同'));
    record('latest version shows its original edit and a separate zero-difference restore comparison');
    await closeDialog();
    await recent.nth(1).click();
    assert.equal(await dialog.locator('.diff-item').count(), 1);
    assert((await dialog.locator('.diff-item').textContent()).includes('翻译模式'));
    await dialog.getByRole('button', {name: '与当前比较', exact: true}).click();
    assert((await dialog.locator('.diff-item').textContent()).includes('默认目标语言'));
    assert(!(await dialog.locator('.diff-item').textContent()).includes('翻译模式'));
    record('older version separates its historical edit from the settings restoration would change');
    const beforeRestoreCount = (await storedHistory()).entries.length;
    await dialog.getByRole('button', {name: '恢复此版本', exact: true}).click();
    const confirm = page.getByRole('dialog', {name: '确认恢复设置', exact: true});
    await confirm.waitFor();
    assert.match(await confirm.innerText(), /将恢复 v\d+，并生成一份新的最近修改记录/);
    await shot('settings-history-restore-confirmation');
    await confirm.getByRole('button', {name: '恢复', exact: true}).click();
    await confirm.waitFor({state: 'hidden'});
    await dialog.waitFor({state: 'hidden'});
    await waitConfig('to', 'en');
    const restoredHistory = await storedHistory();
    assert(restoredHistory.entries[restoredHistory.cursor].version > latestVersion);
    assert.equal(restoredHistory.entries.length, Math.min(10, beforeRestoreCount + 1));
    assert((await recent.first().textContent()).includes('日本語'));
    assert((await recent.first().textContent()).includes('English'));
    await shot('settings-history-restored');
    record('restoring an older version persists the selected values and records the inverse change');
    await recent.last().click();
    assert((await dialog.locator('.diff-empty').textContent()).includes('前一份记录未保留'));
    await dialog.getByRole('button', {name: '与当前比较', exact: true}).click();
    record('earliest retained snapshot explicitly reports unavailable previous history');
    await closeDialog();
    const backups = page.locator('.backup-panel .version-entry');
    assert(await backups.count() > 0);
    await backups.first().click();
    assert.equal(await dialog.getByRole('button', {name: '本次修改', exact: true}).count(), 0);
    assert((await dialog.locator('.comparison-hint').textContent()).includes('恢复此版本'));
    await shot('settings-history-backup-preview');
    record('automatic snapshots use the current-settings recovery comparison');
    await closeDialog();
    // 构造多分组和长列表记录，验证摘要限制与详情完整性；仅写入本次临时 profile。
    const domains = Array.from({length: 8}, (_, i) => 'very-long-hostname-' + i + '-for-settings-history.com');
    await support.patchStoredConfig(page, {alwaysTranslateDomains: domains, style: 4, display: 1, token: {openai: 'history-fixture-secret'}});
    await waitConfig('alwaysTranslateDomains', domains);
    await recent.first().click();
    const changedFields = await dialog.locator('.diff-item').count();
    assert(changedFields >= 3);
    assert(!(await dialog.textContent()).includes('history-fixture-secret'));
    await closeDialog();
    // 多项修改只给出前两项名称和总数，不再逐项罗列改前改后。
    assert.equal(await recent.first().locator('.change-values').count(), 0);
    assert.match(await recent.first().locator('.version-copy small').textContent(), new RegExp(`${changedFields} 项修改`));
    assert(!(await recent.first().textContent()).includes('另有'));
    const snapshotRow = page.locator('.backup-panel .version-entry').first();
    assert.equal(await snapshotRow.locator('.version-copy > *').count(), 2, 'snapshot rows keep only time and difference count');
    assert(!(await snapshotRow.textContent()).includes('网站规则'));
    record('multi-setting summaries stay compact while details include every non-credential change');
    report.layouts = [];
    for (const width of [1024, 820, 390]) {
      await page.setViewportSize({width, height: 1000});
      const metrics = await layout();
      assert.equal(metrics.horizontalOverflow, false);
      assert.equal(metrics.outerHorizontalOverflow, false);
      assert.equal(metrics.rowOverflow, false);
      report.layouts.push({width, ...metrics});
      await shot('settings-history-' + width);
    }
    await support.patchStoredConfig(page, {theme: 'dark'});
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await shot('settings-history-dark-390');
    await recent.first().click();
    const dialogLayout = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {left: rect.left, right: rect.right, width: rect.width, overflow: element.scrollWidth > element.clientWidth + 1};
    });
    assert.equal(dialogLayout.overflow, false);
    assert(dialogLayout.left >= 0 && dialogLayout.right <= 391);
    report.mobileDialog = dialogLayout;
    await shot('settings-history-detail-dark-390');
    await closeDialog();
    record('desktop and 1024/820/390 layouts including dark details have no horizontal overflow');
    await page.setViewportSize({width: 1440, height: 1000});
    await support.patchStoredConfig(page, {uiLanguage: 'en-US', theme: 'light'});
    await page.reload(); await page.locator('.settings-app').waitFor();
    await page.locator('button[data-section="settings-data"]').click();
    await page.locator('.history-heading').scrollIntoViewIfNeeded();
    assert((await page.locator('.version-panel').first().textContent()).includes('changes'));
    await page.locator('.version-panel').first().locator('.version-entry').first().click();
    await page.locator('.config-preview-dialog:visible').waitFor();
    assert.equal(await page.getByRole('button', {name: 'Changes in this version', exact: true}).count(), 1);
    assert(!(await page.locator('.config-preview-dialog:visible').textContent()).includes('settings.history.'));
    await shot('settings-history-english');
    record('history and comparison controls localize after switching the interface language');
    assert.deepEqual(report.consoleErrors, []);
    report.ok = true;
  } catch (error) {
    report.error = error.stack || String(error);
    console.error(error);
    if (page && !page.isClosed()) { try { await shot('failure'); } catch {} }
    process.exitCode = 1;
  } finally {
    let closed = !launchAttempted;
    try {if (session) {await session.close(); closed = true;}}
    catch (error) {report.cleanupError = error.stack || String(error); process.exitCode = 1; console.error(error);}
    if (profileDir && closed) {
      try {fs.rmSync(profileDir, {recursive: true, force: true});}
      catch (error) {report.profileCleanupError = error.stack || String(error); process.exitCode = 1; console.error(error);}
    } else if (profileDir) report.retainedProfile = profileDir;
    if (process.exitCode) report.ok = false;
    try {fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');}
    catch (error) {report.reportWriteError = error.stack || String(error); report.ok = false; process.exitCode = 1; console.error(error);}
    console.log(JSON.stringify({ok: report.ok, cases: report.cases.length, consoleErrors: report.consoleErrors, report: path.join(output, 'report.json'), error: report.error || null}));
  }
})();

#!/usr/bin/env node
/**
 * @file scripts/testing/run-composite-translation-ui-test.cjs
 * 文件职责：用第二屏可见且不抢焦点的隔离 Edge 验证组合翻译新增流程与真实后台请求。
 * 主要内容：只运行组合创建、策略保存、排序移除、默认选择、关闭重开、Popup同步、390px布局、删除与空组合修复用例；本地 HTTP fixture 提供确定性的失败回退。
 * 模块边界：只写本次临时 profile 的配置，无真实服务密钥；通过已有后台消息读写并调用翻译，不接触日常浏览器，finally 关闭所属进程并清理 profile。
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const args = Object.fromEntries(process.argv.slice(2).reduce((items, value, index, all) => {
  if (value.startsWith('--')) items.push([value.slice(2), all[index + 1]]);return items;
}, []));
for (const key of ['extension-dir', 'playwright-root', 'focus-safe-helper', 'artifacts-dir']) assert(args[key], `Missing --${key}`);
const extensionDir = path.resolve(args['extension-dir']), artifacts = path.resolve(args['artifacts-dir']);
const {chromium} = createRequire(path.join(args['playwright-root'], 'composite-ui.cjs'))('playwright');
const helper = require(args['focus-safe-helper']);
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-composite-ui-'));
fs.mkdirSync(artifacts, {recursive: true});
const report = {ok: false, extensionDir, evidence: 'production-extension-ui-and-local-provider-fixture', cases: [], persistenceCases: [], screenshots: [], consoleErrors: [], quickClose: false, crossPageSync: false, latestWriteWins: false, fixtureRequests: []};
const save = () => fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
const fixture = http.createServer((request, response) => {
  request.resume();request.on('end', () => {
    response.setHeader('Access-Control-Allow-Origin', '*');response.setHeader('Access-Control-Allow-Headers', '*');response.setHeader('Content-Type', 'application/json');
    if (request.method === 'OPTIONS') {response.writeHead(204);response.end();return;}
    report.fixtureRequests.push({path: request.url, method: request.method});
    if (request.url.startsWith('/fail')) {response.writeHead(503);response.end(JSON.stringify({error: {message: 'Controlled unavailable member'}}));return;}
    response.end(JSON.stringify({id: 'composite-fixture', object: 'chat.completion', created: 1, model: 'fixture-model', choices: [{index: 0, message: {role: 'assistant', content: '组合翻译已成功完成。'}, finish_reason: 'stop'}], usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20}}));
  });
});
(async () => {
  let session, page, closed = false;
  try {
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${fixture.address().port}`;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir, browserPath: args['browser-path'] || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: false, background: true, displayTarget: 'secondary', viewport: {width: 1440, height: 1000}, timeout: 30000, browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(session.windowPlacement.browserFrontmost, false);
    const context = session.context, worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const open = async suffix => {
      const target = await helper.newPageWithoutForeground(context, 30000);
      target.on('pageerror', error => report.consoleErrors.push(error.message));
      target.on('console', message => {if (message.type() === 'error') report.consoleErrors.push(message.text());});
      await target.goto(origin + suffix);return target;
    };
    page = await open('/options.html#settings-services');
    const read = target => target.evaluate(async () => {const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;});
    const seed = async patch => {
      const result = await page.evaluate(async next => {const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});const config = typeof result.value === 'string' ? JSON.parse(result.value) : result.value;return chrome.runtime.sendMessage({type: 'persistConfig', config: {...config, ...next}, clientId: 'composite-ui-fixture', sequence: Date.now(), baseRevision: config.__fluentConfigRevision});}, patch);
      assert.equal(result.success, true);
    };
    const waitConfig = async predicate => {const deadline = Date.now() + 15000;let config;do {config = await read(page);if (predicate(config)) return config;await page.waitForTimeout(50);} while (Date.now() < deadline);throw new Error('Expected composite configuration did not persist');};
    const shot = async name => {const file = path.join(artifacts, name + '.png');await page.screenshot({path: file, fullPage: false});report.screenshots.push(file);};
    await seed({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, service: 'microsoft', theme: 'light', from: 'en', to: 'zh-CN', compositeTranslationProviders: [], customOpenAIProviders: [{id: 'custom:fixtureFail', name: '测试接口', endpoint: endpoint + '/fail/v1/chat/completions', models: ['fixture-model']}, {id: 'custom:fixtureSuccess', name: '本地备用', endpoint: endpoint + '/success/v1/chat/completions', models: ['fixture-model']}], model: {'custom:fixtureFail': 'fixture-model', 'custom:fixtureSuccess': 'fixture-model'}, requireApiKey: {'v2:["custom:fixtureFail","fixture-model"]': false, 'v2:["custom:fixtureSuccess","fixture-model"]': false}});
    await page.reload();await page.getByTestId('custom-service-add').waitFor({state: 'visible'});
    assert.equal(await page.getByTestId('composite-service-add').count(), 0);
    await page.getByTestId('custom-service-add').click();
    let dialog = page.locator('.el-dialog:visible').filter({has: page.getByTestId('custom-service-save')});
    await dialog.getByTestId('custom-service-type-interface').waitFor({state: 'visible'});
    await shot('custom-service-type-choice');
    await dialog.getByTestId('custom-service-name').fill('日常组合');
    await dialog.getByTestId('custom-service-type-composite').click();
    assert.equal(await dialog.getByTestId('custom-service-name').inputValue(), '日常组合');
    assert.equal(await dialog.getByTestId('custom-service-endpoint').count(), 0);
    assert.equal(await dialog.getByTestId('custom-service-api-key').count(), 0);
    assert.equal(await dialog.getByTestId('composite-service-name').count(), 0);
    await dialog.getByTestId('custom-service-save').click();assert.equal(await dialog.getByRole('alert').count(), 1);
    const add = async (container, service) => {await container.getByTestId('composite-member-select').selectOption(service);};
    for (const service of ['google', 'microsoft', 'custom:fixtureSuccess']) await add(dialog, service);
    assert.equal(await dialog.getByTestId('composite-member-add').count(), 0);
    assert.equal(await dialog.locator('.segmented-control[role="radiogroup"]').count(), 1);
    await dialog.locator('[data-composite-advanced] summary').click();
    await dialog.getByTestId('composite-member-timeout').fill('0');
    await dialog.locator('[data-composite-advanced] summary').click();
    await dialog.getByTestId('custom-service-save').click();
    await dialog.getByTestId('composite-member-timeout').waitFor({state: 'visible'});
    assert.equal(await dialog.getByRole('alert').count(), 1);
    await dialog.getByTestId('composite-member-timeout').fill('12');
    await dialog.locator('[data-composite-advanced] summary').click();
    await shot('custom-service-create-combination');
    await page.setViewportSize({width: 390, height: 1000});
    const createMetrics = await dialog.evaluate(node => {const box = node.getBoundingClientRect();return {left: box.left, right: box.right, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth};});
    assert(createMetrics.left >= 0 && createMetrics.right <= createMetrics.width + 1 && !createMetrics.overflow, JSON.stringify(createMetrics));
    await shot('custom-service-create-combination-390px');
    await page.setViewportSize({width: 1440, height: 1000});
    await dialog.getByTestId('custom-service-save').click();await dialog.waitFor({state: 'hidden'});
    let config = await waitConfig(config => config.compositeTranslationProviders.length === 1);
    const groupId = config.compositeTranslationProviders[0].id;
    assert.deepEqual(config.compositeTranslationProviders[0].services, ['google', 'microsoft', 'custom:fixtureSuccess']);
    assert.equal(await page.locator('.service-catalog').getAttribute('data-default-service'), 'microsoft');
    await page.close();
    page = await open(`/options.html?service=${encodeURIComponent(groupId)}#settings-services`);
    await page.locator(`[data-composite-service-settings]:visible`).waitFor({state: 'visible'});
    assert.equal(await page.locator('.service-catalog').getAttribute('data-editing-service'), groupId);
    assert.equal(await page.locator('.service-catalog').getAttribute('data-default-service'), 'microsoft');
    report.cases.push('configured-combination-deep-link-after-hydration');
    const settings = () => page.locator('[data-composite-service-settings]:visible');
    assert.equal(await page.locator('.model-section:visible, [data-api-key-list]:visible, [data-service-settings-tabs]:visible').count(), 0);
    await settings().locator('[data-composite-advanced] summary').click();
    assert.equal(await settings().getByTestId('composite-member-timeout').inputValue(), '12');
    assert.equal(await settings().getByTestId('composite-member-select').locator('option[value^="composite:"]').count(), 0);
    report.cases.push('create-mixed-members-without-credentials-or-nesting');
    for (const strategy of ['random', 'smart', 'sequential']) {
      await settings().getByRole('radio', {name: {random: '随机', smart: '智能', sequential: '轮流'}[strategy], exact: true}).click();
      await settings().getByTestId('composite-member-timeout').fill('7');
      await settings().getByTestId('composite-service-edit-save').click();
      await waitConfig(config => config.compositeTranslationProviders[0].strategy === strategy && config.compositeTranslationProviders[0].timeoutMs === 7000);
    }
    await settings().locator('[data-composite-member="microsoft"]').getByRole('button', {name: '上移 微软翻译'}).click();
    await settings().locator('[data-composite-member="google"]').getByRole('button', {name: /^移除 /}).click();
    await settings().getByTestId('composite-service-edit-save').click();
    await waitConfig(config => JSON.stringify(config.compositeTranslationProviders[0].services) === JSON.stringify(['microsoft', 'custom:fixtureSuccess']));
    await page.locator('[data-set-default-service-button]:visible').click();await page.close();
    page = await open('/options.html#settings-services');await page.locator(`[data-service-value="${groupId}"]`).click();
    assert.equal(await settings().getByTestId('composite-service-name').inputValue(), '日常组合');
    assert.equal((await read(page)).service, groupId);report.quickClose = true;report.latestWriteWins = true;report.persistenceCases.push('strategy-member-order-and-default-close-reopen');
    await shot('composite-options-reopened');
    const popup = await open('/popup.html');await popup.getByTestId('popup-feature-services').waitFor({state: 'visible'});
    assert.match(await popup.getByTestId('popup-feature-services').innerText(), /日常组合/);
    await popup.getByTestId('popup-feature-services').click();await popup.locator('[data-feature-service="default"]').click();
    assert.equal(await popup.locator(`[data-service-choice="${groupId}"]`).getAttribute('aria-selected'), 'true');
    const popupShot = path.join(artifacts, 'composite-popup-synchronized.png');await popup.screenshot({path: popupShot});report.screenshots.push(popupShot);await popup.close();report.crossPageSync = true;
    await page.setViewportSize({width: 390, height: 1000});
    const metrics = await page.evaluate(() => ({width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('[data-composite-service-settings] input, [data-composite-service-settings] button, [data-composite-service-settings] select')].filter(node => {const box = node.getBoundingClientRect();return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1);}).length}));
    assert(metrics.scrollWidth <= 391, JSON.stringify(metrics));assert.equal(metrics.overflow, 0, JSON.stringify(metrics));report.cases.push({id: '390px-layout', metrics});await shot('composite-390px');await page.setViewportSize({width: 1440, height: 1000});
    await settings().locator('[data-composite-member="microsoft"]').getByRole('button', {name: /^移除 /}).click();await add(settings(), 'custom:fixtureFail');
    await settings().locator('[data-composite-member="custom:fixtureFail"]').getByRole('button', {name: /^上移 /}).click();
    await settings().getByTestId('composite-service-edit-save').click();await waitConfig(config => config.compositeTranslationProviders[0].services[0] === 'custom:fixtureFail');
    const result = await page.evaluate(async service => chrome.runtime.sendMessage({origin: 'This combination returns the first working translation.', serviceOverride: service, clientRequestId: crypto.randomUUID(), requestTimeoutMs: 15000, useCache: false}), groupId);
    assert.match(typeof result === 'string' ? result : JSON.stringify(result), /组合翻译已成功完成/);
    assert(report.fixtureRequests.some(request => request.path.startsWith('/fail')));assert(report.fixtureRequests.some(request => request.path.startsWith('/success')));
    const failedCalls = report.fixtureRequests.filter(request => request.path.startsWith('/fail')).length;
    const successfulCalls = report.fixtureRequests.filter(request => request.path.startsWith('/success')).length;
    const second = await page.evaluate(async service => chrome.runtime.sendMessage({origin: 'This combination returns the first working translation.', serviceOverride: service, clientRequestId: crypto.randomUUID(), requestTimeoutMs: 15000, useCache: false}), groupId);
    assert.match(typeof second === 'string' ? second : JSON.stringify(second), /组合翻译已成功完成/);
    assert.equal(report.fixtureRequests.filter(request => request.path.startsWith('/fail')).length, failedCalls);
    assert.equal(report.fixtureRequests.filter(request => request.path.startsWith('/success')).length, successfulCalls + 1);
    const third = await page.evaluate(async service => chrome.runtime.sendMessage({origin: 'This combination returns the first working translation.', serviceOverride: service, clientRequestId: crypto.randomUUID(), requestTimeoutMs: 15000, useCache: false}), groupId);
    assert.match(typeof third === 'string' ? third : JSON.stringify(third), /组合翻译已成功完成/);
    assert(report.fixtureRequests.filter(request => request.path.startsWith('/fail')).length > failedCalls);
    assert.equal(report.fixtureRequests.filter(request => request.path.startsWith('/success')).length, successfulCalls + 2);
    report.cases.push('actual-background-broker-round-robin-and-failure-fallback');
    await page.locator('[data-connection-test-button]:visible').click();await page.locator('[data-connection-test-status]:visible').filter({hasText: /连接正常/}).waitFor({state: 'visible', timeout: 55000});report.cases.push('connection-check-uses-combination');await shot('composite-connection-check');
    await settings().getByTestId('composite-service-delete').click();await page.locator('.el-dialog:visible').getByRole('button', {name: '确认', exact: true}).click();
    config = await waitConfig(config => config.compositeTranslationProviders.length === 0);
    assert.equal(config.customOpenAIProviders.length, 2);assert.notEqual(config.service, groupId);report.cases.push('delete-keeps-member-settings-and-clears-default');
    await seed({compositeTranslationProviders: [{id: 'composite:empty', name: '空组合待修复', strategy: 'smart', services: [], timeoutMs: 12000}]});
    await page.reload();await page.locator('[data-service-value="composite:empty"]').click();
    assert.equal(await page.locator('[data-connection-test-button]:visible').isDisabled(), true);await page.locator('[data-composite-test-empty]').waitFor({state: 'visible'});report.cases.push('empty-import-kept-and-test-disabled');
    assert.deepEqual(report.consoleErrors, []);report.ok = true;
  } catch (error) {report.error = error.stack;process.exitCode = 1;if (page) await page.screenshot({path: path.join(artifacts, 'failure.png'), fullPage: false}).catch(() => {});}
  finally {
    if (session) {try {await session.close();closed = true;} catch (error) {report.cleanupError = error.stack;report.ok = false;process.exitCode = 1;}}
    if (closed) fs.rmSync(profileDir, {recursive: true, force: true});
    await new Promise(resolve => fixture.close(resolve));save();console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => {console.error(error);process.exitCode = 1;});

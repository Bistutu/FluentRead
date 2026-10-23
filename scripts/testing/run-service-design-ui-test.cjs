#!/usr/bin/env node
/**
 * @file scripts/testing/run-service-design-ui-test.cjs
 * 文件职责：在 production MV3 扩展和隔离 Edge 中验证翻译服务配置页的分组布局、DeepLX 本地连接状态与免费服务的紧凑邮箱字段。
 * 主要内容：启动带 CORS 的本地 DeepLX fixture，覆盖空 Key、成功、失败重试、停止、过期结果、占位符提示、响应式尺寸、深色主题和云服务指引。
 * 模块边界：仅使用合成配置、临时 profile 与 focus-safe helper；fixture 不记录 API Key，也不连接任何真实或付费翻译服务。
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}

for (const field of ['extension-dir', 'playwright-root', 'focus-safe-helper', 'artifacts-dir']) {
  assert(arg(field), `Missing --${field}`);
}

const extensionDir = path.resolve(arg('extension-dir'));
const artifactsDir = path.resolve(arg('artifacts-dir'));
const playwrightRoot = path.resolve(arg('playwright-root'));
const helperPath = path.resolve(arg('focus-safe-helper'));
const browserPath = arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
assert(fs.existsSync(path.join(extensionDir, 'manifest.json')), `扩展产物不存在：${extensionDir}`);
fs.mkdirSync(artifactsDir, {recursive: true});

const {chromium} = createRequire(path.join(playwrightRoot, 'service-design-ui.cjs'))('playwright');
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(helperPath);
const report = {
  ok: false,
  evidence: 'production-extension-ui-with-local-deeplx-fixture',
  extensionDir,
  browserPath,
  launchMode: null,
  focusPolicy: null,
  windowPlacement: null,
  cases: [],
  screenshots: [],
  consoleErrors: [],
  requests: [],
  layoutMetrics: [],
  mockLimitations: ['DeepLX responses and delay are local fixture evidence; no provider account or production endpoint was exercised.'],
};
const save = () => fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));

let fixtureMode = 'success';
let fixtureDelayMs = 0;
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    const mode = fixtureMode;
    const authorizationPresent = Boolean(request.headers.authorization);
    report.requests.push({path: request.url, mode, status: mode === 'failure' ? 456 : 200, authorizationPresent});
    const respond = () => {
      response.writeHead(200, {
        'access-control-allow-origin': '*',
        'content-type': 'application/json',
      });
      response.end(JSON.stringify(mode === 'failure'
        ? {code: 456, message: 'fixture failure'}
        : {code: 200, data: '你好'}));
    };
    setTimeout(respond, mode === 'delay' ? fixtureDelayMs : 600);
    void body;
  });
});

async function main() {
  let launched;
  let page;
  let profileDir;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const fixture = mode => `http://127.0.0.1:${port}/${mode}`;
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-service-design-'));
    launched = await launchFocusSafePersistentContext({
      chromium,
      profileDir,
      browserPath,
      headless: false,
      background: true,
      displayTarget: 'secondary',
      viewport: {width: 1440, height: 1000},
      timeout: 30000,
      browserArgs: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    Object.assign(report, {
      launchMode: launched.launchMode,
      focusPolicy: launched.focusPolicy,
      windowPlacement: launched.windowPlacement,
    });
    assert.equal(report.windowPlacement.browserFrontmost, false);

    const context = launched.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
    const optionsUrl = `${extensionOrigin}/options.html#settings-services`;
    const attach = target => {
      target.on('pageerror', error => report.consoleErrors.push(error.message));
      target.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    };
    const open = async () => {
      page = await newPageWithoutForeground(context, 30000);
      attach(page);
      await page.goto(optionsUrl);
      await page.locator('.service-catalog').waitFor({state: 'visible'});
    };
    const readConfig = () => page.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
    });
    const seed = patch => page.evaluate(async next => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const current = typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
      const config = {
        ...current,
        ...next,
        token: {...current.token, ...(next.token || {})},
        proxy: {...current.proxy, ...(next.proxy || {})},
        apiKeys: {...current.apiKeys, ...(next.apiKeys || {})},
      };
      return chrome.runtime.sendMessage({type: 'persistConfig', config, clientId: 'service-design-ui-fixture', sequence: Date.now(), baseRevision: current.__fluentConfigRevision});
    }, patch).then(result => assert.equal(result.success, true));
    const visibleService = service => page.locator(`[data-service-value="${service}"]:visible`).first();
    const selectService = async service => {
      const directoryToggle = page.locator('.mobile-directory-toggle');
      if (await directoryToggle.isVisible() && await directoryToggle.getAttribute('aria-expanded') !== 'true') await directoryToggle.click();
      await visibleService(service).click();
      await page.locator(`[data-service-configuration-service="${service}"]`).waitFor({state: 'visible'});
    };
    const shot = async name => {
      await page.evaluate(async () => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
      const file = path.join(artifactsDir, `${name}.png`);
      await page.screenshot({path: file, fullPage: true});
      report.screenshots.push(file);
    };
    const serviceGroup = group => page.locator(`[data-configuration-group="${group}"]`);
    const waitIdle = () => page.locator('[data-api-key-list][data-api-key-busy="false"]').waitFor({state: 'visible'});
    const measure = async () => page.evaluate(() => {
      const box = selector => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height,
          visible: rect.width > 0 && rect.height > 0 && style.visibility === 'visible' && Number(style.opacity) > 0};
      };
      return {
        row: box('[data-api-key-list] [data-api-key-index]'),
        input: box('[data-api-key-list] .api-key-entry .el-input__wrapper'),
        testButton: box('.detail-hero [data-connection-test-button]'),
        result: box('[data-api-key-list] .api-key-state.is-checking, [data-api-key-list] .api-key-state.is-success, [data-api-key-list] .api-key-state.is-error'),
        nextGroup: box('[data-service-settings-tabs]'),
      };
    });
    const assertStable = (before, after, label) => {
      for (const key of ['input', 'testButton']) {
        assert(before[key] && after[key], `${label}: missing ${key}`);
        assert(Math.abs(before[key].top - after[key].top) <= 1, `${label}: ${key} top shifted`);
        assert(Math.abs(before[key].height - after[key].height) <= 1, `${label}: ${key} height shifted`);
        assert(Math.abs(before[key].width - after[key].width) <= 1, `${label}: ${key} width shifted`);
      }
      // 空状态不预留结果高度；结果出现后可推动下一组，但控件位置保持稳定且内容不得重叠。
      assert(after.result?.visible, `${label}: check status/result must be visible`);
      assert(after.nextGroup?.visible, `${label}: next settings group must be visible`);
      assert(after.result.bottom <= after.nextGroup.top + 1, `${label}: check status/result overlaps the next settings group`);
      report.layoutMetrics.push({label, before, after});
    };

    await open();
    const initial = await readConfig();
    const defaultService = initial.service;
    await seed({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, deeplx: fixture('success'), token: {deeplx: ''}, proxy: {deeplx: ''}, theme: 'light'});
    await page.reload();
    await page.locator('.service-catalog').waitFor({state: 'visible'});
    await selectService('deeplx');
    assert.equal(await page.locator('.service-catalog').getAttribute('data-default-service'), defaultService);
    const keyList = page.locator('[data-api-key-list]');
    const checkButton = page.locator('.detail-hero [data-connection-test-button]');
    assert.equal(await checkButton.isDisabled(), false, 'DeepLX anonymous check should be available with an empty Key');
    const initialLayout = await measure();
    await checkButton.click();
    await page.locator('[data-api-key-list][data-api-key-busy="true"]').waitFor({state: 'visible'});
    assertStable(initialLayout, await measure(), 'deeplx-waiting-layout');
    await shot('service-design-deeplx-checking');
    await waitIdle();
    await keyList.locator('.api-key-state.is-success').waitFor({state: 'visible'});
    assert.equal(report.requests.at(-1).authorizationPresent, false);
    assertStable(initialLayout, await measure(), 'deeplx-success-layout');
    report.cases.push('deeplx-empty-key-anonymous-success-and-stable-layout');

    fixtureMode = 'failure';
    await page.locator('[data-deeplx-endpoint] input').fill(fixture('failure'));
    await page.locator('[data-deeplx-endpoint] input').press('Tab');
    await checkButton.click();
    await page.locator('[data-api-key-list][data-api-key-busy="true"]').waitFor({state: 'visible'});
    await waitIdle();
    await keyList.locator('.api-key-state.is-error').waitFor({state: 'visible'});
    assertStable(initialLayout, await measure(), 'deeplx-failure-layout');
    await shot('service-design-deeplx-failed');
    const failedRequests = report.requests.length;
    await checkButton.click();
    await page.locator('[data-api-key-list][data-api-key-busy="true"]').waitFor({state: 'visible'});
    await waitIdle();
    assert(report.requests.length > failedRequests, 'failed Key must expose a working retry action');
    report.cases.push('deeplx-failure-retry');

    fixtureMode = 'delay';
    fixtureDelayMs = 600;
    await page.locator('[data-deeplx-endpoint] input').fill(fixture('delay'));
    await page.locator('[data-deeplx-endpoint] input').press('Tab');
    await checkButton.click();
    await page.locator('[data-api-key-list][data-api-key-busy="true"]').waitFor({state: 'visible'});
    await checkButton.click();
    await waitIdle();
    report.cases.push('deeplx-stop');

    await checkButton.click();
    await page.locator('[data-api-key-list][data-api-key-busy="true"]').waitFor({state: 'visible'});
    await page.locator('[data-deeplx-endpoint] input').fill(fixture('success'));
    await page.locator('[data-deeplx-endpoint] input').press('Tab');
    await new Promise(resolve => setTimeout(resolve, 750));
    assert.equal(await keyList.locator('.api-key-state.is-success').count(), 0, 'stale delayed result must not be restored after endpoint edit');
    report.cases.push('deeplx-stale-result-discarded-after-endpoint-edit');

    await page.locator('[data-deeplx-endpoint] input').fill(`${fixture('placeholder')}/{{apiKey}}`);
    await page.locator('[data-deeplx-endpoint] input').press('Tab');
    await page.locator('[data-deeplx-key-required]').waitFor({state: 'visible'});
    assert.equal(await checkButton.isDisabled(), true, 'placeholder endpoints require a Key before checking');
    const placeholderText = await page.locator('.service-detail').innerText();
    assert(/占位符|apiKey|token/i.test(placeholderText), 'empty Key placeholder endpoint needs a clear message');
    report.cases.push({id: 'deeplx-placeholder-empty-key', disabled: true});

    await page.locator('[data-deeplx-endpoint] input').fill(fixture('success'));
    for (const service of ['minimax', 'openai', 'tencent', 'volcTranslation', 'deeplx', 'freeTranslation']) {
      await selectService(service);
      await shot(`service-design-${service}-1440`);
    }
    await page.locator('[data-free-provider-disclosure] > summary').click();
    const measureFreeColumns = () => page.locator('.provider-section > .fallback-list > [data-fallback-provider]').evaluateAll(nodes => {
      const boxes = nodes.map(node => node.getBoundingClientRect());
      return boxes.filter(box => Math.abs(box.top - boxes[0].top) < 1).length;
    });
    assert.equal(await page.locator('.detail-hero [data-connection-test-button]').count(), 1, 'free connection check belongs in the service header');
    assert.equal(await page.locator('[data-service-configuration-service="freeTranslation"] [data-connection-test-button]').count(), 0, 'free connection check should not be duplicated below the endpoint cards');
    const headerAction = await page.locator('.detail-hero [data-connection-test-button]').boundingBox();
    const headerBox = await page.locator('.detail-hero').boundingBox();
    assert(headerAction && headerBox && headerAction.x > headerBox.x + headerBox.width / 2 && headerAction.y >= headerBox.y && headerAction.y + headerAction.height <= headerBox.y + headerBox.height, 'free connection check must stay inside the right side of the header');
    assert(await measureFreeColumns() >= 2, 'wide layout should show multiple free endpoints on each row');
    await page.locator('input[value="sequential"]').check();
    assert(await measureFreeColumns() >= 2, 'priority order should keep the compact multi-column layout');
    await shot('service-design-freeTranslation-priority-1440');
    await page.locator('input[value="balanced"]').check();
    assert.equal(await page.locator('[data-free-translation-settings] .provider-settings input[type="email"]').isVisible(), true);
    for (const service of ['minimax', 'freeTranslation']) {
      await selectService(service);
      if (service === 'freeTranslation') await page.locator('[data-free-provider-disclosure] > summary').click();
      for (const width of [820, 390]) {
        await page.setViewportSize({width, height: 1000});
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${service} horizontal overflow at ${width}`);
        if (service === 'freeTranslation' && width === 390) assert.equal(await measureFreeColumns(), 1);
        await shot(`service-design-${service}-${width}`);
      }
      await page.setViewportSize({width: 1440, height: 1000});
    }
    report.cases.push('free-endpoints-multi-column-priority-order-and-optional-email-visible');
    await selectService('deeplx');
    for (const width of [390, 820]) {
      await page.setViewportSize({width, height: 1000});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `DeepLX horizontal overflow at ${width}`);
      await shot(`service-design-deeplx-${width}`);
    }
    await page.setViewportSize({width: 1440, height: 1000});
    await seed({theme: 'dark'});
    await page.reload();
    await page.locator('.service-catalog').waitFor({state: 'visible'});
    await selectService('deeplx');
    await shot('service-design-deeplx-dark');
    report.cases.push('service-layout-1440-responsive-dark-screenshots');

    await selectService('tencent');
    const guide = page.getByTestId('service-credential-guide');
    await guide.waitFor({state: 'visible'});
    assert.equal(await guide.getAttribute('open'), null);
    await guide.locator(':scope > summary').click();
    assert.equal(await guide.getAttribute('open'), '');
    await selectService('volcTranslation');
    assert.equal(await page.getByTestId('service-credential-guide').getAttribute('open'), null);
    assert.equal(await page.locator('.service-catalog').getAttribute('data-default-service'), defaultService);
    report.cases.push('cloud-quota-guide-collapsed-reset-and-default-service-unchanged');

    assert(report.requests.length > 0 && report.requests.every(item => !item.authorizationPresent));
    assert.equal(report.consoleErrors.length, 0);
    report.ok = true;
  } catch (error) {
    report.error = error.stack;
    if (page) {
      await page.screenshot({path: path.join(artifactsDir, 'failure.png'), fullPage: true}).catch(() => {});
    }
    process.exitCode = 1;
  } finally {
    save();
    await launched?.close();
    await new Promise(resolve => server.close(resolve));
    if (profileDir) fs.rmSync(profileDir, {recursive: true, force: true});
    save();
    console.log(JSON.stringify({ok: report.ok, cases: report.cases, screenshots: report.screenshots, error: report.error, artifactsDir}, null, 2));
  }
}

main();

#!/usr/bin/env node
/**
 * @file scripts/testing/run-service-library-ui-test.cjs
 * 在隔离后台 Edge 中验证新版翻译服务设置页的完整服务目录、搜索、配置持久化和响应式边界。
 * 仅在本次临时 profile 写入 fixture 配置，不请求真实翻译服务，不接触用户浏览器或凭据。
 */
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, all) => {
  if (value.startsWith('--')) out.push([value.slice(2), all[index + 1]]);
  return out;
}, []));
if (!Object.prototype.hasOwnProperty.call(args, 'focus-safe-helper')) args['focus-safe-helper'] = path.join(__dirname, 'focus-safe-browser.cjs');
for (const field of ['extension-dir', 'playwright-root', 'focus-safe-helper', 'artifacts-dir']) assert(args[field], `Missing --${field}`);
const {chromium} = createRequire(path.join(args['playwright-root'], 'service-library.cjs'))('playwright');
const helper = require(args['focus-safe-helper']);
const extensionDir = path.resolve(args['extension-dir']);
const artifacts = path.resolve(args['artifacts-dir']);
const browserPath = args['browser-path'] || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
fs.mkdirSync(artifacts, {recursive: true});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-service-library-'));
const report = {
  ok: false,
  evidence: 'production-extension-ui-with-fixture-config',
  browserPath,
  cases: [],
  screenshots: [],
  consoleErrors: [],
  persistenceCases: [],
  quickClose: false,
  latestWriteWins: false,
  crossPageSync: false,
  hooks: {serviceRail: false, serviceSearch: false, customServiceDialog: false, apiKeySelectors: false, responsive: false},
};
const save = () => fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));

(async () => {
  let session, primaryError;
  let page;
  let launchAttempted = false;
  try {
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({
      chromium, profileDir, browserPath, headless: false, background: true, displayTarget: 'secondary',
      viewport: {width: 1440, height: 1000}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
    });
    guardBrowserClose(session, profileDir);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = session.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    const id = new URL(worker.url()).host;
    const optionsUrl = `chrome-extension://${id}/options.html#settings-services`;
    const attach = target => {
      target.on('pageerror', error => report.consoleErrors.push(error.message));
      target.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    };
    const newOptions = async () => { const target = await helper.newPageWithoutForeground(context, 30000); attach(target); await target.goto(optionsUrl); return target; };
    page = await newOptions();
    const readConfig = async () => page.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
    });
    const seed = async patch => page.evaluate(async next => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const current = typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
      return chrome.runtime.sendMessage({type: 'persistConfig', config: {...current, ...next}, clientId: 'service-library-ui-fixture', sequence: Date.now(), baseRevision: current.__fluentConfigRevision});
    }, patch).then(result => assert.equal(result.success, true));
    const shot = async name => { await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); }); const file = path.join(artifacts, `${name}.png`); await page.screenshot({path: file, fullPage: true}); report.screenshots.push(file); };
    const visible = selector => page.locator(`${selector}:visible`);
    const rail = () => visible('.service-rail');
    const selected = service => visible(`[data-service-value="${service}"]`);
    await seed({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, service: 'freeTranslation', favoriteServices: [], theme: 'light', customOpenAIProviders: []});
    await page.reload(); await rail().waitFor({state: 'visible'});
    assert.equal(await page.locator('[data-service-view], .catalog-toolbar, .catalog-browse').count(), 0);
    assert.equal(await page.locator('.no-model-panel').count(), 0);
    const railValues = await rail().locator('[data-service-value]').evaluateAll(nodes => nodes.map(node => node.dataset.serviceValue));
    assert.equal(new Set(railValues).size, railValues.length, `rail 重复服务：${railValues}`);
    assert(railValues.length >= 40, `首用目录必须展示全部内置服务：${railValues}`);
    for (const service of ['freeTranslation', 'deepseek', 'openai', 'gemini', 'localTranslation', 'claude', 'ollama']) assert(railValues.includes(service));
    report.hooks.serviceRail = true; report.cases.push({id: 'first-use-complete-directory', values: railValues});
    const initialDefault = await page.locator('.service-catalog').getAttribute('data-default-service');
    await shot('service-library-all-services');
    const search = rail().locator('input[type="search"]');
    await search.fill('ＯｐｅｎＡＩ');
    assert(await selected('openai').count());
    assert(await rail().locator('[data-service-value]').count() < railValues.length);
    await selected('openai').click();
    assert.equal(await page.locator('.service-catalog').getAttribute('data-default-service'), initialDefault);
    await search.fill('service-does-not-exist-97531'); await rail().getByRole('status').waitFor({state: 'visible'});
    assert.equal(await page.locator('.service-catalog').getAttribute('data-editing-service'), 'openai');
    await search.fill('');
    assert.equal(await rail().locator('[data-service-value]').count(), railValues.length);
    report.hooks.serviceSearch = true; report.cases.push('search-normalization-empty-clear-preserves-editing-and-default');
    await seed({token: {openai: 'fixture-not-a-live-key'}, favoriteServices: ['openai']}); await page.reload(); await rail().waitFor({state: 'visible'});
    assert.deepEqual((await readConfig()).favoriteServices, ['openai']);
    assert.equal(await rail().locator('[data-service-value="openai"]').count(), 1); report.cases.push('existing-configuration-and-favorites-preserved');
    await selected('claude').click();
    assert.equal(await page.locator('.service-catalog').getAttribute('data-default-service'), initialDefault);
    await selected('deepseek').click(); await shot('service-library-deepseek');
    const singleKey = page.locator('[data-api-key-list] input[type="password"]').first();
    await singleKey.fill('fixture-deepseek-key');
    await page.locator('[data-api-key-add]').click();
    await page.locator('[data-api-key-index="1"] input').fill('fixture-second-key');
    assert.equal(await page.locator('[data-api-key-index]').count(), 2);
    await page.close(); page = await newOptions(); await rail().waitFor({state: 'visible'});
    await selected('deepseek').click();
    assert.equal(await page.locator('[data-api-key-index]').count(), 2);
    await page.locator('[data-api-key-rotation-setting] input[value="single"]').check();
    assert.equal(await page.locator('[data-api-key-index]').count(), 2);
    assert.equal(await page.locator('[data-api-key-standby]').count(), 1);
    await page.locator('[data-api-key-index="0"] input').fill('fixture-updated-first-key');
    await page.locator('[data-api-key-rotation-setting] input[value="rotation"]').check();
    assert.equal(await page.locator('[data-api-key-standby]').count(), 0);
    assert.equal(await page.locator('[data-api-key-index="1"] input').inputValue(), 'fixture-second-key');
    await page.locator('[data-api-key-rotation-setting] input[value="single"]').check();
    report.quickClose = true; report.latestWriteWins = true; report.persistenceCases.push('first-key-only-and-rotation-keep-every-saved-key-visible');
    await selected('claude').click();
    assert.equal(await visible('.catalog-set-default').count(), 0);
    assert.equal(await page.locator('.service-catalog').getAttribute('data-default-service'), initialDefault);
    report.crossPageSync = true; report.cases.push('selection-only-keeps-default-service');

    await page.getByTestId('custom-service-add').click();
    const customDialog = page.getByTestId('custom-service-dialog'); await customDialog.waitFor({state: 'visible'}); report.hooks.customServiceDialog = true;
    await customDialog.getByTestId('custom-service-save').click(); assert.equal(await customDialog.getByRole('alert').count(), 3);
    await customDialog.getByTestId('custom-service-name').fill('工作翻译接口'); await customDialog.getByTestId('custom-service-endpoint').fill('http://localhost:11434/v1'); await customDialog.getByTestId('custom-service-api-key').fill('fixture-key'); await customDialog.getByTestId('custom-service-model').fill('local-model'); await customDialog.getByTestId('custom-service-save').click(); await customDialog.waitFor({state: 'hidden'});
    await page.locator('[data-service-value^="custom:"]').first().waitFor({state: 'visible'}); report.cases.push('custom-service-zero-to-one');
    assert.equal(await page.locator('[data-service-settings-tabs] [role="tabpanel"]:visible').count(), 1);
    assert.equal(await page.locator('.no-model-panel').count(), 0); report.cases.push('one-active-settings-pane-and-no-empty-model-placeholder');
    report.hooks.apiKeySelectors = (await page.locator('input[type="password"], [data-api-key], [data-testid*="api-key"]').count()) > 0;
    await selected('freeTranslation').click();
    await page.locator('[data-free-provider-disclosure] > summary').click();
    const freeRequests = page.locator('[data-configuration-group="requests"]');
    assert.equal(await page.locator('[id$="tab-requests"]').getAttribute('aria-selected'), 'true');
    assert(await page.locator('[data-fallback-provider]:visible').count() > 0);
    await shot('service-library-free-configuration');
    const sequentialMode = page.locator('input[type="radio"][value="sequential"]');
    assert.equal(await sequentialMode.count(), 1); await sequentialMode.check();
    const timeoutInput = freeRequests.locator('input[aria-label*="等待"], input[aria-label*="timeout" i]').first();
    assert.equal(await timeoutInput.count(), 1, '免费翻译请求设置缺少超时控件');
    await timeoutInput.fill('7'); await timeoutInput.press('Enter');
    const freeEmail = page.locator('[data-free-translation-settings] .provider-settings input[type="email"]');
    await freeEmail.fill('settings-fixture@example.test'); await freeEmail.press('Tab');
    const disabledProvider = await page.locator('[data-fallback-provider]:not(.is-disabled)').last().getAttribute('data-fallback-provider');
    await page.locator(`[data-fallback-provider="${disabledProvider}"] .el-switch`).click();
    await page.close(); page = await newOptions(); await rail().waitFor({state: 'visible'});
    await selected('freeTranslation').click();
    await page.locator('[data-free-provider-disclosure] > summary').click();
    const reopenedFreeRequests = page.locator('[data-configuration-group="requests"]');
    assert.equal(await page.locator('[id$="tab-requests"]').getAttribute('aria-selected'), 'true');
    const reopenedMode = await page.locator('input[type="radio"][value="sequential"]').isChecked();
    assert.equal(reopenedMode, true);
    assert.equal(await page.locator('[data-free-translation-settings] .provider-settings input[type="email"]').inputValue(), 'settings-fixture@example.test');
    assert.match(await page.locator(`[data-fallback-provider="${disabledProvider}"]`).getAttribute('class'), /is-disabled/);
    assert.equal(await reopenedFreeRequests.locator('input[aria-label*="等待"], input[aria-label*="timeout" i]').first().inputValue(), '7');
    await shot('service-library-free-advanced');
    await selected('claude').click();
    assert.equal(await page.locator('[id$="tab-translation"]').getAttribute('aria-selected'), 'true');
    report.persistenceCases.push('free-request-mode-timeout-reopen-and-service-reset');
    const customValues = await page.locator('[data-service-value^="custom:"]').evaluateAll(nodes => nodes.map(node => node.dataset.serviceValue));
    await seed({customOpenAIProviders: Array.from({length: 20}, (_, index) => ({id: index === 0 ? customValues[0] : `custom:test${index}`, name: `自定义翻译服务 ${index}`, endpoint: 'http://localhost:11434/v1', models: ['local-model']}))}); await page.reload(); await rail().waitFor({state: 'visible'});
    assert(await page.locator('[data-service-value^="custom:"]').count() >= 20, '自定义服务达到 20 条后不可达'); report.cases.push('custom-service-counts-0-1-20-reachable');

    for (const width of [1440, 1024, 820, 390]) {
      await page.setViewportSize({width, height: 1000});
      const metrics = await page.evaluate(() => ({width: innerWidth, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, height: innerHeight, overflow: [...document.querySelectorAll('.service-catalog button, .service-catalog input, .service-rail, .service-detail')].filter(node => { if (getComputedStyle(node).display === 'none' || getComputedStyle(node).visibility === 'hidden') return false; const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0 && (box.left < -1 || box.right > innerWidth + 1); }).length}));
      assert(metrics.scrollWidth <= width + 1, JSON.stringify(metrics)); assert(metrics.scrollHeight <= metrics.height + 1, JSON.stringify(metrics)); assert.equal(metrics.overflow, 0, JSON.stringify(metrics)); report.cases.push({id: `layout-${width}`, metrics}); if (width === 390 || width === 1440) await shot(`service-library-${width}`);
    }
    report.hooks.responsive = true; await page.setViewportSize({width: 1440, height: 1000}); await seed({theme: 'dark'}); await page.reload(); await rail().waitFor({state: 'visible'}); await shot('service-library-dark');
    await seed({uiLanguage: 'en-US'}); await page.reload(); await rail().waitFor({state: 'visible'}); assert.match(await page.getByTestId('custom-service-add').innerText(), /custom/i); await shot('service-library-english');
    assert.deepEqual(report.consoleErrors, []); report.ok = true; save();
  } catch (error) {
    primaryError = error;
    report.ok = false;
    report.error = error.stack;
    process.exitCode = 1;
    try { if (page) await page.screenshot({path: path.join(artifacts, 'failure.png'), fullPage: true}); }
    catch (diagnosticError) { console.error('Failure screenshot failed:', diagnosticError); }
  }
  finally {
    const cleanupErrors = [];
    const cleanup = async (resource, release) => {
      try { await release(); } catch (error) {
        cleanupErrors.push(error);
        (report.cleanupErrors ||= []).push({resource, error: String(error.stack || error)});
        report.ok = false;
        process.exitCode = 1;
        console.error(`Cleanup failed (${resource}):`, error);
      }
    };
    let browserClosed = false;
    await cleanup('browser', async () => { if (session) { await session.close(); browserClosed = true; } });
    await cleanup('profile', () => {
      if (!profileDir) return;
      if (browserClosed) fs.rmSync(profileDir, {recursive: true, force: true});
      else if (!launchAttempted) {
        try { fs.rmdirSync(profileDir); } catch (error) {
          // 未尝试启动浏览器时，仅移除初始空目录。
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
      }
    });
    await cleanup('report', () => { save(); });
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});

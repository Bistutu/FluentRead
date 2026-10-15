'use strict';
/**
 * @file scripts/testing/run-settings-center-navigation-test.cjs
 * 文件职责：验证设置中心信息层级、所有导航分区与页内分类的生产浏览器行为。
 * 主要内容：使用隔离 Edge 和不抢焦点 helper 验证桌面/窄屏导航、搜索直达、跨分类状态保留、关闭重开持久化、深色模式及布局边界。
 * 模块边界：仅访问本次临时 profile，不访问用户配置、不请求真实翻译服务，不代表 Firefox 运行时或翻译功能的全量回归。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const argument = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const root = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-settings-hierarchy'));
const packages = argument('playwright-root');
const helper = argument('focus-safe-helper');
assert(packages && helper, 'Provide Playwright and focus-safe helper paths');
const {chromium} = require(path.join(packages, 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(helper);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-settings-hierarchy-'));
fs.mkdirSync(artifacts, {recursive: true});
const report = {ok: false, extensionDir: root, pages: [], panels: [], layouts: [], screenshots: [], consoleErrors: [], persistenceCases: [], quickClose: false, latestWriteWins: false, crossPageSync: false};
let session, page;
const save = () => fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
const shot = async name => { const file = path.join(artifacts, `${name}.png`); await page.screenshot({path: file}); report.screenshots.push(file); };
const checkLayout = async label => {
  const metrics = await page.evaluate(() => {
    const main = document.querySelector('.settings-card');
    return {document: document.documentElement.scrollWidth, viewport: innerWidth, content: main.scrollWidth, client: main.clientWidth, height: main.clientHeight};
  });
  assert(metrics.document <= metrics.viewport + 1, `${label}: document overflow ${JSON.stringify(metrics)}`);
  assert(metrics.content <= metrics.client + 1, `${label}: content overflow ${JSON.stringify(metrics)}`);
  assert(metrics.height >= 180, `${label}: content too short`);
  report.layouts.push({label, ...metrics});
};
(async () => {
  try {
    session = await launchFocusSafePersistentContext({chromium, profileDir: profile, background: true, headless: false,
      displayTarget: 'secondary', browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      viewport: {width: 1440, height: 960}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp'); assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = session.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    const base = worker.url().match(/^chrome-extension:\/\/[^/]+/)[0];
    const open = async suffix => {
      const result = await newPageWithoutForeground(context, 30000);
      result.on('pageerror', error => report.consoleErrors.push(error.message));
      result.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
      await result.goto(`${base}/${suffix}`, {waitUntil: 'domcontentloaded'});
      return result;
    };
    page = await open('options.html');
    await page.locator('#settings-general [data-testid="default-translation-service-card"]').waitFor();
    const ids = await page.locator('.sidebar button[data-section]').evaluateAll(items => items.map(item => item.dataset.section));
    assert.equal(ids.length, 16);
    assert.equal(await page.locator('.sidebar button[data-section]:visible').count(), 16, 'All groups initially expanded');
    const navigate = async id => {
      if (await page.locator('.mobile-settings-navigation').isVisible()) await page.locator('.mobile-settings-navigation').selectOption(id);
      else {
        const target = page.locator(`.sidebar button[data-section="${id}"]`);
        if (!await target.isVisible()) await target.locator('xpath=../..').locator('.nav-group-toggle').click();
        await target.click();
      }
      await page.waitForFunction(expected => location.hash === `#${expected}`, id);
      await page.waitForTimeout(250);
      await page.locator('.settings-card').evaluate(el => el.scrollTo(0, 0));
    };
    for (const id of ids) {
      await navigate(id);
      await page.waitForFunction(() => document.querySelector('.settings-card')?.innerText.trim().length > 10);
      report.pages.push(id);
      await checkLayout(id);
      await shot(`desktop-${id}`);
      const categories = await page.locator('[data-settings-category]').evaluateAll(items => items.map(item => item.dataset.settingsCategory));
      for (const category of categories) {
        await page.locator(`[data-settings-category="${category}"]`).click();
        await page.waitForTimeout(150);
        const visible = await page.locator('[data-settings-panel]:visible').evaluateAll(items => items.map(item => ({id: item.dataset.settingsPanel, text: item.innerText.trim().length})));
        assert(visible.length && visible.every(panel => panel.id === category && panel.text > 5), `${id}/${category}: ${JSON.stringify(visible)}`);
        await checkLayout(`${id}/${category}`);
        report.panels.push(`${id}/${category}`);
        await shot(`panel-${id}-${category}`);
      }
    }
    const duplicateIds = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
      return ids.filter((id, index) => ids.indexOf(id) !== index);
    });
    assert.deepEqual(duplicateIds, []);
    await navigate('settings-services');
    await page.locator('.service-catalog').waitFor();
    const catalog = page.locator('[data-default-service][data-editing-service]');
    const defaultService = await catalog.getAttribute('data-default-service');
    const alternative = page.locator(`[data-service-value]:not([data-service-value="${defaultService}"])`).first();
    const editingService = await alternative.getAttribute('data-service-value');
    await alternative.click();
    assert.equal(await catalog.getAttribute('data-editing-service'), editingService);
    assert.equal(await catalog.getAttribute('data-default-service'), defaultService);
    report.serviceEditingPreservesDefault = true;
    assert.equal(await page.locator('.el-overlay:visible').count(), 0);
    const beforeHash = await page.evaluate(() => location.hash);
    await page.locator('[data-feature-service="hover"] .feature-service-connection').click();
    assert.equal(await page.evaluate(() => location.hash), beforeHash);
    assert.equal(await page.locator('.service-catalog .service-rail').count(), 1);
    assert.equal(await page.locator('.el-overlay:visible').count(), 0);
    await shot('service-workspace');
    report.inPlaceConfiguration = true;
    await page.setViewportSize({width: 390, height: 900});
    await page.locator('.service-catalog').scrollIntoViewIfNeeded();
    await checkLayout('mobile-service-workspace');
    await shot('mobile-service-workspace');
    await page.setViewportSize({width: 1440, height: 960});
    await navigate('settings-interface');
    await page.locator('[data-style-value="0"]').click();
    await page.locator('[data-style-value="1"]').click();
    await page.locator('.translation-style-stage .fluent-display-bold').waitFor();
    assert.equal(await page.locator('.translation-style-stage #translation-sentence-highlight').count(), 0);
    await page.locator('#translation-sentence-highlight').waitFor();
    await shot('style-simplified');
    await navigate('settings-general');
    await navigate('settings-interface');
    await page.locator('.translation-style-stage .fluent-display-bold').waitFor();
    report.categoryStatePreserved = true;
    // Search must open the correct category, including a collapsed sidebar group.
    const search = page.locator('.search-box input');
    for (const [query, section, category] of [['界面字体', 'settings-interface', 'font'], ['翻译缓存', 'settings-advanced', 'cache'], ['输入框', 'settings-translation', 'input']]) {
      await search.fill(query);
      await page.locator('.search-results button').first().click();
      assert.equal(await page.locator('[data-settings-category]').count(), 0);
      await page.locator(`[data-settings-panel="${category}"]:visible`).waitFor();
      assert.equal(await page.evaluate(() => location.hash), `#${section}`);
      assert.equal(await search.inputValue(), '');
    }
    await search.fill('悬浮球进阶设置');
    await page.locator('.search-results button').first().click();
    assert.equal(await page.locator('[data-settings-category]').count(), 0);
    await page.locator('#floating-ball-settings').waitFor();
    await search.fill('no-such-setting-xyz'); await page.locator('.search-empty').waitFor();
    await search.press('Escape'); assert.equal(await search.inputValue(), '');
    report.search = true;
    await navigate('settings-general');
    await page.locator('[data-testid="open-floating-ball-settings"]').click();
    await page.locator('#floating-ball-settings').waitFor();
    report.crossCategoryLink = true;
    // Existing persistence pipeline must survive the new presentation layer.
    const readConfig = p => p.evaluate(async () => { const r = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}); if (!r.success) throw new Error(r.error); return typeof r.value === 'string' ? JSON.parse(r.value) : r.value; });
    const originalConfig = await readConfig(page);
    await navigate('settings-general');
    assert.equal(await page.locator('[data-feature-service]').count(), 9);
    const selectFeature = async (id, label) => {
      const combobox = page.locator(`[data-feature-service="${id}"]`).getByRole('combobox');
      await combobox.click();
      const listId = await combobox.getAttribute('aria-controls');
      await page.locator(`#${listId}`).getByRole('option', {name: label, exact: true}).click();
    };
    await selectFeature('selection', '微软翻译');
    await selectFeature('hover', '谷歌翻译');
    await selectFeature('image', '微软翻译');
    await selectFeature('input', '谷歌翻译');
    await selectFeature('video', '谷歌翻译');
    await selectFeature('document', '谷歌翻译');
    await page.waitForTimeout(350);
    const assigned = await readConfig(page);
    assert.equal(assigned.service, originalConfig.service);
    assert.equal(assigned.selectionTranslationService, 'microsoft');
    assert.equal(assigned.hoverTranslationService, 'google');
    assert.equal(assigned.imageTranslationService, 'microsoft');
    assert.equal(assigned.inputBoxTranslationService, 'google');
    assert.equal(assigned.videoService, 'google');
    assert.equal(assigned.documentService, 'google');
    const readingPicker = page.locator('[data-feature-service="reading"]').getByRole('combobox');
    await readingPicker.click();
    const readingList = await readingPicker.getAttribute('aria-controls');
    assert.equal(await page.locator(`#${readingList}`).getByRole('option', {name: '微软翻译', exact: true}).count(), 0);
    await page.keyboard.press('Escape');
    await shot('feature-services-assigned');
    await page.close();
    page = await open('options.html#settings-general');
    await page.locator('[data-testid="feature-services"]').waitFor();
    assert.equal((await readConfig(page)).selectionTranslationService, 'microsoft');
    await shot('feature-services-reopened');
    report.persistenceCases.push('Independent service assignments survive close and reopen');
    await navigate('settings-translation');
    await page.locator('[data-settings-panel="input"]:visible').waitFor();
    assert((await page.locator('.input-translation-service-control').innerText()).includes('谷歌翻译'));
    report.featureServiceAssignments = true;
    await navigate('settings-glossary');
    const master = page.locator('#settings-glossary .feature-enable-card').first();
    const toggle = master.getByRole('switch');
    const checked = await toggle.getAttribute('aria-checked');
    await master.locator('.feature-enable-description').click();
    assert.notEqual(await toggle.getAttribute('aria-checked'), checked);
    await page.waitForFunction(() => !document.querySelector('#settings-glossary .feature-enable-card button').disabled);
    await toggle.focus(); await page.keyboard.press('Space');
    assert.equal(await toggle.getAttribute('aria-checked'), checked);
    const hitArea = await toggle.boundingBox(); assert(hitArea.width > 300 && hitArea.height >= 44);
    const positions = await master.evaluate(el => ({text: el.querySelector('.feature-enable-copy').getBoundingClientRect().left, toggle: el.querySelector('.feature-enable-control').getBoundingClientRect().left, state: el.querySelector('.feature-enable-state')}));
    assert(positions.toggle > positions.text); assert.equal(positions.state, null);
    await page.locator('.glossary-builtins-page').waitFor();
    assert.equal(await page.locator('.glossary-builtins-page').evaluate(el => Boolean(el.closest('details:not([open])'))), false);
    await shot('glossary-master-switch');
    await page.locator('.glossary-builtins-page').scrollIntoViewIfNeeded();
    await shot('glossary-builtins-visible');
    await page.goto(`${base}/options.html#settings-area-translation`);
    await page.locator('#settings-image-translation #settings-area-translation').waitFor();
    assert.equal(await page.locator('.sidebar button[data-section="settings-area-translation"]').count(), 0);
    assert.equal(await page.locator('#settings-image-translation [data-testid="ocr-language-manager"]').count(), 1);
    await shot('image-area-unified');
    report.imageAreaConsolidation = true;
    await navigate('settings-sites');
    const autoRow = page.locator('#settings-sites .settings-item').first();
    const autoBefore = await autoRow.getByRole('switch').getAttribute('aria-checked');
    await autoRow.locator('.settings-item-copy').click();
    assert.notEqual(await autoRow.getByRole('switch').getAttribute('aria-checked'), autoBefore);
    await autoRow.locator('.settings-item-copy').click();
    report.switchInteraction = true;
    await page.goto(`${base}/options.html#settings-model-usage`);
    await page.locator('[data-settings-category="usage"][aria-current]').waitFor();
    assert.equal(await page.locator('.sidebar button[data-section="settings-model-usage"]').count(), 0);
    await page.locator('#settings-model-usage').waitFor();
    await shot('statistics-model-usage');
    await page.locator('[data-settings-category="overview"]').click();
    await page.locator('#settings-translation-stats').waitFor();
    report.statisticsConsolidation = true;

    await navigate('settings-general');
    const before = await readConfig(page);
    await page.locator('#floating-ball-toggle .el-switch').click();
    await page.close();
    page = await open('options.html');
    await page.locator('#floating-ball-toggle').waitFor();
    assert.equal(await page.getByRole('switch', {name: '全文翻译悬浮球', exact: true}).getAttribute('aria-checked'), String(before.disableFloatingBall));
    report.persistenceCases.push('disableFloatingBall survives immediate options close'); report.quickClose = true;
    await page.locator('#floating-ball-toggle .el-switch').click();
    await page.locator('#floating-ball-toggle .el-switch').click();
    await page.waitForTimeout(300);
    assert.equal((await readConfig(page)).disableFloatingBall, !before.disableFloatingBall); report.latestWriteWins = true;
    await shot('general-reopened');
    for (const width of [1024, 820, 390]) {
      await page.setViewportSize({width, height: 900});
      for (const id of ids) {
        await navigate(id); await checkLayout(`${width}-${id}`);
        if (width === 390 || ['settings-general','settings-services'].includes(id)) await shot(`${width}-${id}`);
        if (width === 390) {
          const categories = await page.locator('[data-settings-category]').evaluateAll(items => items.map(item => item.dataset.settingsCategory));
          for (const category of categories) {
            await page.locator(`[data-settings-category="${category}"]`).click();
            await page.waitForTimeout(120);
            await checkLayout(`${width}-${id}/${category}`);
            await shot(`${width}-${id}-${category}`);
          }
        }
      }
    }
    await page.setViewportSize({width: 1440, height: 960});
    await navigate('settings-general');
    await page.getByRole('radiogroup', {name: '界面主题', exact: true}).getByRole('radio', {name: '暗色主题', exact: true}).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    for (const id of ['settings-general','settings-services','settings-interface','settings-glossary','settings-advanced']) {
      await navigate(id); await shot(`dark-${id}`); await checkLayout(`dark-${id}`);
    }
    const popup = await open('popup.html');
    await popup.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await popup.setViewportSize({width: 400, height: 600});
    if (await popup.locator('[data-testid="onboarding-language-step"]').isVisible()) {
      await popup.locator('.onboarding-form .onboarding-confirm').click();
    }
    await popup.locator('[data-testid="popup-feature-services"]').waitFor();
    const popupMetrics = await popup.evaluate(() => ({width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight}));
    assert(popupMetrics.width <= 400, JSON.stringify(popupMetrics));
    assert(popupMetrics.height <= 600, JSON.stringify(popupMetrics));
    await popup.screenshot({path: path.join(artifacts, 'popup-services-shortcut.png')});
    report.popupMetrics = popupMetrics;
    await popup.locator('[data-testid="popup-feature-services"]').click();
    await popup.locator('.popup-provider-fields').waitFor();
    assert.equal(await popup.locator('[data-feature-service]').count(), 10);
    report.popupShortcut = true;
    report.crossPageSync = true;
    assert.deepEqual(report.consoleErrors, []);
    report.ok = true;
  } catch (error) {
    report.failure = error.stack || String(error);
    if (page && !page.isClosed()) { await shot('failure').catch(() => {}); fs.writeFileSync(path.join(artifacts, 'failure.html'), await page.content().catch(() => '')); }
  } finally {
    save(); await session?.close(); fs.rmSync(profile, {recursive: true, force: true});
  }
  console.log(JSON.stringify({ok: report.ok, pages: report.pages.length, panels: report.panels.length, layouts: report.layouts.length, failure: report.failure, artifacts}, null, 2));
  if (!report.ok) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });

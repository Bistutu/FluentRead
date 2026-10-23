'use strict';
const {waitForAsyncCondition} = require('./wait-for-async-condition.cjs');
const {guardBrowserClose} = require('./owned-browser-close.cjs');

/**
 * @file scripts/testing/run-lazy-options-ui-test.cjs
 * 文件职责：在隔离 Edge 中验证 Options 按需分区挂载、深链接、配置持久化以及 Popup 基础交互。
 * 主要内容：确认首次通用设置不创建未访问的服务、视频、界面、数据和学习组件，依次访问这些分区后返回仍保留实例；验证布尔开关快速关闭、重开和 Popup 跨页面同步，并覆盖服务选择器、抽屉、About 互斥显示与异步深链接；shortcut-lifecycle 子集单独验证首次划词录制、取消/清除、离开分区与窄屏对话框。
 * 模块边界：只操作本次临时 profile 和真实扩展页面，不请求真实翻译服务，不连接用户浏览器，不替代完整设置中心回归。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
const playwrightRoot = path.resolve(argument('playwright-root', ''));
const focusHelper = path.resolve(argument('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs')));
const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-lazy-options-ui'));
const browserPath = argument('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
const timeout = Number(argument('timeout', '30000'));
const suite = argument('suite', 'lazy-sections');
assert.ok(['lazy-sections', 'hotkeys', 'section-hotkeys', 'shortcut-lifecycle'].includes(suite), 'suite 仅支持 lazy-sections、hotkeys、section-hotkeys 或 shortcut-lifecycle');

assert.ok(fs.existsSync(path.join(extensionDir, 'manifest.json')), `扩展产物不存在：${extensionDir}`);
assert.ok(fs.existsSync(focusHelper), `防抢焦点 helper 不存在：${focusHelper}`);
assert.ok(playwrightRoot, '缺少 --playwright-root');
assert.ok(Number.isFinite(timeout) && timeout >= 1000, `timeout 无效：${timeout}`);
fs.mkdirSync(artifactsDir, {recursive: true});

const {chromium} = require(path.join(playwrightRoot, 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(focusHelper);
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const optionsPath = manifest.options_page || manifest.options_ui?.page;
const popupPath = manifest.action?.default_popup || manifest.browser_action?.default_popup;
assert.ok(optionsPath, '扩展清单缺少 Options 入口');
assert.ok(popupPath, '扩展清单缺少 Popup 入口');

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-lazy-options-'));
const report = {
  ok: false,
  extensionDir,
  suite,
  manifest: {options: optionsPath, popup: popupPath, version: manifest.version},
  cases: [],
  screenshots: [],
  consoleErrors: [],
  lazyMount: {},
  persistenceCases: [],
  quickClose: false,
  latestWriteWins: false,
  crossPageSync: false,
  deepLink: false,
  popup: {},
};
let session;
let primaryError;

function saveReport() {
  fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
}

function attachDiagnostics(page, label) {
  page.on('pageerror', error => report.consoleErrors.push({label, type: 'pageerror', error: error.message}));
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push({label, type: 'console', error: message.text()});
  });
}

async function screenshot(page, name) {
  const target = path.join(artifactsDir, `${name}.png`);
  await page.screenshot({path: target, fullPage: false});
  report.screenshots.push(target);
  return target;
}

function parseConfigResponse(response) {
  assert.ok(response?.success !== false, `配置读取失败：${response?.error || '未知错误'}`);
  const value = typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
  assert.ok(value && typeof value === 'object', '配置读取结果不是对象');
  return value;
}

async function readConfig(page) {
  const response = await page.evaluate(() => chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}));
  return parseConfigResponse(response);
}

async function persistConfig(page, patch, clientId) {
  const current = await readConfig(page);
  const response = await page.evaluate(({current, patch, clientId}) => chrome.runtime.sendMessage({
    type: 'persistConfig',
    mode: 'replace',
    config: {...current, ...patch},
    clientId,
    sequence: Date.now(),
    baseRevision: current.__fluentConfigRevision,
  }), {current, patch, clientId});
  assert.equal(response?.success, true, `配置写入失败：${response?.error || '未知错误'}`);
  return {...current, ...patch};
}

async function openExtensionPage(context, url, label) {
  const page = await newPageWithoutForeground(context, timeout);
  attachDiagnostics(page, label);
  await page.goto(url, {waitUntil: 'domcontentloaded', timeout});
  return page;
}

async function waitForOptionsReady(page) {
  await page.locator('#settings-general [data-testid="default-translation-service-card"]').waitFor({state: 'visible', timeout});
}

async function navigateOptions(page, id) {
  await page.locator(`nav button[data-section="${id}"]`).click();
  await page.waitForFunction(expected => location.hash === `#${expected}`, id, {timeout});
  await page.waitForTimeout(250);
}

async function visible(locator) {
  return locator.count().then(async count => count > 0 && locator.first().isVisible());
}

(async () => {
  let launchAttempted = false;
  try {
    launchAttempted = true;
    session = await launchFocusSafePersistentContext({
      chromium,
      profileDir,
      browserPath,
      headless: false,
      background: true,
      displayTarget: argument('display', 'secondary'),
      viewport: {width: 1440, height: 1000},
      timeout,
      browserArgs: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    guardBrowserClose(session, profileDir);
    Object.assign(report, {
      launchMode: session.launchMode,
      focusPolicy: session.focusPolicy,
      windowPlacement: session.windowPlacement,
    });
    assert.equal(report.windowPlacement.browserFrontmost, false);

    const context = session.context;
    const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://'))
      || await context.waitForEvent('serviceworker', {timeout, predicate: item => item.url().startsWith('chrome-extension://')});
    const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
    const optionsUrl = `${extensionOrigin}/${optionsPath}`;
    const popupUrl = `${extensionOrigin}/${popupPath}`;

    let page = await openExtensionPage(context, `${optionsUrl}#settings-general`, 'options');
    await waitForOptionsReady(page);
    await persistConfig(page, {
      uiLanguage: 'zh-CN',
      uiLanguageSetupCompleted: true,
      theme: 'light',
      on: true,
      service: 'freeTranslation',
      favoriteServices: [],
      customOpenAIProviders: [],
    }, `lazy-options-seed-${process.pid}`);
    await page.reload({waitUntil: 'domcontentloaded'});
    await waitForOptionsReady(page);

    if (suite === 'shortcut-lifecycle') {
      await persistConfig(page, {selectionTranslatorMode: 'bilingual', selectionTranslatorTrigger: 'icon', customSelectionTranslatorHotkey: '',
        hotkey: 'Control', customHotkey: '', floatingBallHotkey: 'Alt+T', customFloatingBallHotkey: '', quickTranslationProfiles: []}, 'shortcut-lifecycle-seed');
      await page.goto(`${optionsUrl}#settings-selection`, {waitUntil: 'domcontentloaded'});
      await page.locator('#settings-selection').waitFor({state: 'visible', timeout});
      assert.equal(await page.locator('#settings-translation').count(), 0, 'first selection visit does not mount translation settings');
      const chooseCustom = async name => {
        await page.getByRole('combobox', {name, exact: true}).locator('xpath=ancestor::*[contains(@class, "el-select__wrapper")][1]').click();
        await page.getByRole('option', {name: /自定义/}).click();
      };
      const dialog = page.getByRole('dialog', {name: '自定义快捷键', exact: true});
      await chooseCustom('划词翻译触发方式');
      await dialog.waitFor({state: 'visible', timeout});
      await screenshot(page, '01-selection-first-dialog');
      await dialog.getByRole('button', {name: 'F10', exact: true}).click();
      await dialog.getByRole('button', {name: '确认', exact: true}).click();
      await dialog.waitFor({state: 'hidden', timeout});
      await waitForAsyncCondition(() => page.evaluate(async () => {const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof r.value==='string'?JSON.parse(r.value):r.value;return c.customSelectionTranslatorHotkey==='F10' && c.selectionTranslatorTrigger==='custom';}), {timeoutMs: 30000, message: "划词 F10 自定义快捷键未持久化"});
      report.cases.push('first-selection-visit-dialog-confirms-and-persists');
      await page.getByRole('button', {name: '编辑划词翻译快捷键', exact: true}).click();
      await dialog.waitFor({state: 'visible', timeout});
      await dialog.getByRole('button', {name: '当前快捷键为 F10', exact: true}).click();
      await page.keyboard.down('Alt'); await page.keyboard.press('d'); await page.keyboard.up('Alt');
      await dialog.getByRole('button', {name: /^当前快捷键为 (?:Alt|Option)\+D$/}).waitFor({state:'visible',timeout});
      await dialog.getByRole('button', {name: '取消', exact: true}).click();
      await dialog.waitFor({state: 'hidden', timeout});
      assert.equal((await readConfig(page)).customSelectionTranslatorHotkey, 'F10');
      report.cases.push('trusted-recording-cancel-preserves-saved-shortcut');
      await page.getByRole('button', {name: '编辑划词翻译快捷键', exact: true}).click();
      await dialog.waitFor({state: 'visible', timeout});
      await dialog.getByRole('button', {name: '清除快捷键', exact: true}).click();
      await dialog.getByRole('button', {name: '确认', exact: true}).click();
      await dialog.waitFor({state: 'hidden', timeout});
      await waitForAsyncCondition(() => page.evaluate(async () => {const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof r.value==='string'?JSON.parse(r.value):r.value;return c.customSelectionTranslatorHotkey==='' && c.selectionTranslatorTrigger==='icon';}), {timeoutMs: 30000, message: "清除划词快捷键后图标触发方式未持久化"});
      report.cases.push('clear-selection-shortcut-restores-icon-trigger');
      await chooseCustom('划词翻译触发方式');
      await page.evaluate(() => document.querySelector('nav button[data-section="settings-general"]').click());
      await page.waitForTimeout(200); assert.equal(await dialog.count(), 0);
      await navigateOptions(page, 'settings-selection');
      assert.equal((await readConfig(page)).selectionTranslatorTrigger, 'icon');
      report.cases.push('leaving-before-auto-open-restores-draft');
      await chooseCustom('划词翻译触发方式'); await dialog.waitFor({state:'visible',timeout});
      await dialog.getByRole('button', {name:'关闭自定义快捷键',exact:true}).click();
      await dialog.waitFor({state:'hidden',timeout});
      await page.setViewportSize({width:390,height:844}); await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
      await chooseCustom('划词翻译触发方式'); await dialog.waitFor({state:'visible',timeout});
      const geometry=await dialog.evaluate(element=>{const r=element.getBoundingClientRect();return {inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};});
      assert.ok(geometry.inside && !geometry.overflow); await screenshot(page,'02-selection-narrow-reduced');
      await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden',timeout});
      report.cases.push('narrow-reduced-motion-dialog-and-escape');
      await page.setViewportSize({width:1440,height:1000}); await navigateOptions(page, 'settings-translation');
      await chooseCustom('全文翻译快捷键'); await dialog.waitFor({state:'visible',timeout});
      await dialog.getByRole('button',{name:'F9',exact:true}).click(); await dialog.getByRole('button',{name:'确认',exact:true}).click();
      await dialog.waitFor({state:'hidden',timeout});
      await waitForAsyncCondition(() => page.evaluate(async()=>{const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof r.value==='string'?JSON.parse(r.value):r.value;return c.customFloatingBallHotkey==='F9';}), {timeoutMs: 30000, message: "全文 F9 快捷键未持久化"});
      report.cases.push('traditional-full-page-dialog-confirms-and-persists');
      assert.deepEqual(report.consoleErrors, []); await page.close(); report.ok=true; return;
    }

    if (suite === 'section-hotkeys') {
      await navigateOptions(page, 'settings-translation');
      const section = page.locator('[data-testid="quick-translation-profiles"][data-action="section"]');
      await section.getByTestId('quick-profile-add-section').click();
      const dialog = page.getByRole('dialog', {name: '自定义快捷键', exact: true});
      await dialog.waitFor({state: 'visible', timeout});
      await dialog.locator('.hotkey-input-field').click();
      await page.keyboard.press('F8');
      await dialog.getByRole('button', {name: '确认', exact: true}).click();
      await dialog.waitFor({state: 'hidden', timeout});
      const card = section.locator('.profile-card').first();
      const id = await card.getAttribute('data-profile-id');
      await card.getByTestId(`quick-profile-service-${id}`).click();
      await page.getByRole('option', {name: '谷歌翻译', exact: true}).click();
      await card.getByTestId(`quick-profile-target-${id}`).click();
      await page.getByRole('option', {name: '日本語 / Japanese / 日语', exact: true}).click();
      assert.equal(await card.locator('[data-testid^="quick-profile-range-"]').count(), 0, 'a section has no full-page loading range');
      await waitForAsyncCondition(() => page.evaluate(async () => {
        const {value} = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
        return value.quickTranslationProfiles.some(profile => profile.action === 'section' && profile.hotkey === 'F8' && profile.service === 'google' && profile.targetLanguage === 'ja');
      }, null), {timeoutMs: timeout, message: "分区 F8 / Google / 日语快捷配置未持久化"});
      const saved = (await readConfig(page)).quickTranslationProfiles.find(profile => profile.id === id);
      assert.ok(saved.enabled, 'recording enables the independent profile');
      assert.equal((await readConfig(page)).sectionTranslationHotkeyEnabled, false, 'independent profile does not enable the primary shortcut');
      report.cases.push('section-profile-records-independent-service-and-language');
      await page.waitForTimeout(400);
      await screenshot(page, 'section-shortcut-desktop');

      await section.getByTestId('quick-profile-add-section').click();
      await dialog.waitFor({state: 'visible', timeout});
      await dialog.locator('.hotkey-input-field').click();
      await page.keyboard.press('F8');
      assert.equal(await dialog.getByRole('button', {name: '确认', exact: true}).isDisabled(), true, 'duplicate shortcut cannot be saved');
      await dialog.getByRole('button', {name: 'F9', exact: true}).click();
      await dialog.getByRole('button', {name: '确认', exact: true}).click();
      await dialog.waitFor({state: 'hidden', timeout});
      report.cases.push('section-profile-conflicts-with-other-profiles');
      const keepalive = await openExtensionPage(context, popupUrl, 'section-keepalive-popup');
      await page.close();
      page = await openExtensionPage(context, `${optionsUrl}#settings-translation`, 'section-options-reopened');
      await keepalive.close();
      await page.locator('[data-action="section"] .profile-card').first().waitFor({state: 'visible', timeout});
      assert.deepEqual((await readConfig(page)).quickTranslationProfiles.find(profile => profile.id === id), saved);
      report.cases.push('section-profile-persists-after-options-close-and-reopen');
      await page.setViewportSize({width: 390, height: 900});
      await page.locator('[data-action="section"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, 'section profiles fit the mobile settings page');
      await screenshot(page, 'section-shortcut-390');
      report.cases.push('section-profile-responsive-layout-without-overflow');
      assert.deepEqual(report.consoleErrors, []);
      report.ok = true;
      return;
    }

    if (suite === 'hotkeys') {
      await persistConfig(page, {paragraphCopyEnabled: true, paragraphCopyHotkey: 'custom', customParagraphCopyHotkey: 'F6',
        selectionAreaEnabled: true, selectionAreaHotkey: 'custom', customSelectionAreaHotkey: 'F7', quickTranslationProfiles: []}, 'shared-hotkey-seed');
      await navigateOptions(page, 'settings-translation');
      const dialog = page.getByRole('dialog', {name: '自定义快捷键', exact: true});
      await page.locator('.paragraph-copy-hotkey-custom button').click();
      await dialog.waitFor({state: 'visible', timeout});
      await dialog.getByRole('button', {name: 'F9', exact: true}).click();
      await dialog.getByRole('button', {name: '确认', exact: true}).click();
      await dialog.waitFor({state: 'hidden', timeout});
      await waitForAsyncCondition(() => page.evaluate(async () => {const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof r.value==='string'?JSON.parse(r.value):r.value;return c.customParagraphCopyHotkey==='F9';}), {timeoutMs: 30000, message: "段落复制 F9 快捷键未持久化"});
      report.cases.push('lazy-paragraph-copy-hotkey-dialog-confirms-and-persists');
      await page.getByTestId('quick-profile-add-hover').click();
      await dialog.waitFor({state: 'visible', timeout});
      await dialog.getByRole('button', {name: 'F10', exact: true}).click();
      await dialog.getByRole('button', {name: '确认', exact: true}).click();
      await dialog.waitFor({state: 'hidden', timeout});
      assert.equal((await readConfig(page)).quickTranslationProfiles.some(profile => profile.hotkey === 'F10'), true);
      report.cases.push('lazy-quick-profile-hotkey-dialog-confirms-and-persists');
      await navigateOptions(page, 'settings-image-translation');
      const areaDetails = page.locator('.area-translation-details');
      if (await areaDetails.getAttribute('open') === null) await areaDetails.locator(':scope > summary').click();
      await page.locator('.area-hotkey-custom button').click();
      await dialog.waitFor({state: 'visible', timeout});
      await dialog.locator('.hotkey-input-field').click();
      await page.keyboard.press('F8');
      await dialog.getByRole('button', {name: '当前快捷键为 F8', exact: true}).waitFor({state: 'visible', timeout});
      await dialog.getByRole('button', {name: '确认', exact: true}).click();
      await dialog.waitFor({state: 'hidden', timeout});
      await waitForAsyncCondition(() => page.evaluate(async () => {const r=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});const c=typeof r.value==='string'?JSON.parse(r.value):r.value;return c.customSelectionAreaHotkey==='F8';}), {timeoutMs: 30000, message: "区域选择 F8 快捷键未持久化"});
      report.cases.push('lazy-area-hotkey-trusted-recording-confirms-and-persists');
      await screenshot(page, 'lazy-hotkeys');
      assert.deepEqual(report.consoleErrors, []);
      report.ok = true;
      return;
    }

    const initialState = await page.evaluate(() => ({
      hiddenSelectors: {
        services: document.querySelector('#settings-services') === null && document.querySelector('.service-catalog') === null,
        video: document.querySelector('#settings-video') === null && document.querySelector('.video-model-management') === null,
        interface: document.querySelector('#settings-interface') === null && document.querySelector('.interface-font-settings') === null,
        data: document.querySelector('#settings-data') === null,
        learning: document.querySelector('#settings-vocabulary') === null,
        usage: document.querySelector('#settings-model-usage') === null,
      },
      visibleAbout: [...document.querySelectorAll('#settings-about')].filter(node => getComputedStyle(node).display !== 'none').length,
      visibleGeneral: Boolean(document.querySelector('#settings-general')?.getClientRects().length),
    }));
    assert.deepEqual(initialState.hiddenSelectors, {
      services: true,
      video: true,
      interface: true,
      data: true,
      learning: true,
      usage: true,
    });
    assert.equal(initialState.visibleAbout, 0);
    assert.equal(initialState.visibleGeneral, true);
    report.lazyMount.initial = initialState;
    report.cases.push('first-general-mount-excludes-unvisited-sections');
    await screenshot(page, '01-general-first-use');
    const languageRow = page.getByTestId('translation-language-setting');
    const languageLayout = await languageRow.evaluate(node => {
      const label = node.querySelector('.settings-item-copy');
      const control = node.querySelector('.settings-item-control');
      const labelBox = label.getBoundingClientRect();
      const controlBox = control.getBoundingClientRect();
      return {
        label: node.querySelector('.settings-item-copy strong')?.textContent,
        redundantHeadingCount: document.querySelectorAll('#translated-display-heading').length,
        sameRow: labelBox.top < controlBox.bottom && controlBox.top < labelBox.bottom,
        controlToRight: controlBox.left > labelBox.left,
      };
    });
    assert.equal(languageLayout.label, '翻译语言');
    assert.equal(languageLayout.redundantHeadingCount, 0);
    assert.equal(languageLayout.sameRow, true);
    assert.equal(languageLayout.controlToRight, true);
    report.languageLayout = languageLayout;
    const languageScreenshot = path.join(artifactsDir, 'translation-language-single-row.png');
    await languageRow.screenshot({path: languageScreenshot});
    report.screenshots.push(languageScreenshot);
    report.cases.push('translation-language-label-and-selector-share-one-row');

    const deepLinkPage = await openExtensionPage(context, `${optionsUrl}#settings-interface`, 'options-deep-link');
    await deepLinkPage.locator('#settings-interface').waitFor({state: 'visible', timeout});
    const deepLinkState = await deepLinkPage.evaluate(() => ({
      activeId: document.querySelector('nav button[aria-current="page"]')?.getAttribute('data-section'),
      interfaceVisible: Boolean(document.querySelector('#settings-interface')?.getClientRects().length),
      servicesMounted: document.querySelector('#settings-services') !== null || document.querySelector('.service-catalog') !== null,
    }));
    assert.equal(deepLinkState.activeId, 'settings-interface');
    assert.equal(deepLinkState.interfaceVisible, true);
    assert.equal(deepLinkState.servicesMounted, false);
    report.deepLink = deepLinkState;
    report.cases.push('interface-deep-link-mounts-target-section-first');
    await screenshot(deepLinkPage, '02-interface-deep-link');
    await deepLinkPage.close();

    await navigateOptions(page, 'settings-services');
    await page.locator('.service-catalog').waitFor({state: 'visible', timeout});
    report.lazyMount.services = {mounted: true, defaultService: await page.locator('.service-catalog').getAttribute('data-default-service')};
    assert.equal(report.lazyMount.services.defaultService, 'freeTranslation');
    report.cases.push('services-loads-on-first-navigation');

    await navigateOptions(page, 'settings-video');
    await page.locator('#settings-video').waitFor({state: 'visible', timeout});
    await page.locator('.video-model-management').waitFor({state: 'visible', timeout});
    report.lazyMount.video = {mounted: true};
    report.cases.push('video-loads-on-first-navigation');

    await navigateOptions(page, 'settings-interface');
    await page.locator('#settings-interface').waitFor({state: 'visible', timeout});
    await page.locator('.interface-font-settings').waitFor({state: 'visible', timeout});
    report.lazyMount.interface = {mounted: true};
    report.cases.push('interface-loads-on-first-navigation');

    await navigateOptions(page, 'settings-data');
    await page.locator('#settings-data').waitFor({state: 'visible', timeout});
    report.lazyMount.data = {mounted: true};
    report.cases.push('data-loads-on-first-navigation');

    await navigateOptions(page, 'settings-vocabulary');
    await page.locator('#settings-vocabulary').waitFor({state: 'visible', timeout});
    await page.locator('#settings-vocabulary').evaluate(node => { node.dataset.retentionProbe = 'visited-learning'; });
    report.lazyMount.learning = {mounted: true};
    report.cases.push('learning-loads-on-first-navigation');

    await navigateOptions(page, 'settings-about');
    const aboutState = await page.evaluate(() => ({
      aboutCount: document.querySelectorAll('#settings-about').length,
      aboutVisible: [...document.querySelectorAll('#settings-about')].filter(node => Boolean(node.getClientRects().length)).length,
      generalVisible: [...document.querySelectorAll('#settings-general')].filter(node => Boolean(node.getClientRects().length)).length,
      activeId: document.querySelector('nav button[aria-current="page"]')?.getAttribute('data-section'),
    }));
    assert.equal(aboutState.aboutCount, 1);
    assert.equal(aboutState.aboutVisible, 1);
    assert.equal(aboutState.generalVisible, 0);
    assert.equal(aboutState.activeId, 'settings-about');
    report.cases.push('about-is-the-only-visible-content-branch');
    report.deepLink = true;
    await screenshot(page, '02-about-only');

    await navigateOptions(page, 'settings-general');
    await page.locator('#settings-general [data-testid="default-translation-service-card"]').waitFor({state: 'visible', timeout});
    const retained = await page.evaluate(() => ({
      services: document.querySelectorAll('#settings-services').length,
      video: document.querySelectorAll('#settings-video').length,
      interface: document.querySelectorAll('#settings-interface').length,
      data: document.querySelectorAll('#settings-data').length,
      learning: document.querySelectorAll('#settings-vocabulary').length,
    }));
    // KeepAlive 将另一顶层组件移出当前 DOM，但再次激活时复用同一实例。
    assert.deepEqual(retained, {services: 1, video: 1, interface: 1, data: 1, learning: 0});
    report.lazyMount.retainedAfterReturn = retained;
    report.cases.push('visited-sections-remain-mounted-after-return');
    await navigateOptions(page, 'settings-vocabulary');
    await page.locator('#settings-vocabulary').waitFor({state: 'visible', timeout});
    assert.equal(await page.locator('#settings-vocabulary').getAttribute('data-retention-probe'), 'visited-learning');
    report.cases.push('learning-component-retains-its-instance-after-reactivation');
    await navigateOptions(page, 'settings-general');
    await waitForOptionsReady(page);

    const generalSwitch = page.locator('#settings-general [role="switch"]').first();
    const beforeSwitch = await generalSwitch.getAttribute('aria-checked');
    await generalSwitch.locator('..').click();
    const afterSwitch = await generalSwitch.getAttribute('aria-checked');
    assert.notEqual(afterSwitch, beforeSwitch);
    await page.close();
    report.quickClose = true;
    report.persistenceCases.push({field: 'on', before: beforeSwitch, after: afterSwitch, closedImmediately: true});

    page = await openExtensionPage(context, `${optionsUrl}#settings-general`, 'options-reopen');
    await waitForOptionsReady(page);
    const reopenedSwitch = page.locator('#settings-general [role="switch"]').first();
    assert.equal(await reopenedSwitch.getAttribute('aria-checked'), afterSwitch);
    report.persistenceCases.push({field: 'on', reopened: afterSwitch});
    report.cases.push('boolean-setting-survives-immediate-options-close-and-reopen');

    const firstLatestValue = await reopenedSwitch.getAttribute('aria-checked');
    await reopenedSwitch.locator('..').click();
    const latestIntermediate = await reopenedSwitch.getAttribute('aria-checked');
    await reopenedSwitch.locator('..').click();
    const latestFinal = await reopenedSwitch.getAttribute('aria-checked');
    assert.equal(latestFinal, firstLatestValue);
    assert.notEqual(latestIntermediate, firstLatestValue);
    await page.close();
    page = await openExtensionPage(context, `${optionsUrl}#settings-general`, 'options-latest-write-reopen');
    await waitForOptionsReady(page);
    assert.equal(await page.locator('#settings-general [role="switch"]').first().getAttribute('aria-checked'), latestFinal);
    report.latestWriteWins = true;
    report.persistenceCases.push({field: 'on', rapidValues: [firstLatestValue, latestIntermediate, latestFinal], reopened: latestFinal});
    report.cases.push('rapid-consecutive-setting-writes-retain-final-value');
    await screenshot(page, '03-options-reopened-persistence');

    const popup = await openExtensionPage(context, popupUrl, 'popup');
    await popup.locator('.popup-shell[data-config-ready="true"]').waitFor({state: 'visible', timeout});
    // Popup 的两个网站规则开关不代表全局启用状态；用实际受总开关控制的语言输入验证同步。
    const popupLanguages = popup.locator('.language-pair input[role="combobox"]');
    assert.equal(await popupLanguages.count(), 2);
    for (const input of await popupLanguages.all()) assert.equal(await input.isDisabled(), latestFinal !== 'true');
    report.crossPageSync = true;
    report.popup.mount = true;
    report.cases.push('options-setting-is-visible-in-reopened-popup');

    if (latestFinal !== 'true') {
      await page.locator('#settings-general [role="switch"]').first().locator('..').click();
      await popup.waitForFunction(() => {
        const inputs = [...document.querySelectorAll('.language-pair input[role="combobox"]')];
        return inputs.length === 2 && inputs.every(input => !input.disabled);
      }, undefined, {timeout});
      report.cases.push('options-change-updates-an-already-open-popup');
    }

    await popup.getByTestId('popup-feature-services').click();
    await popup.locator('[data-feature-service="default"]').click();
    await popup.locator('[data-service-picker="default"]').waitFor({state: 'visible', timeout});
    assert.ok(await popup.locator('.service-choice:visible').count() > 0, 'Popup 服务选择器没有可见选项');
    await popup.keyboard.press('Escape');
    await popup.locator('[data-service-picker="default"]').waitFor({state: 'hidden', timeout});
    await popup.locator('.popup-service-toolbar .service-panel-close').click();
    await popup.locator('.popup-service-panel').waitFor({state: 'hidden', timeout});
    report.popup.servicePicker = true;
    report.cases.push('popup-service-picker-opens-and-closes-with-escape');

    await popup.locator('[data-popup-quick-feature="selection"]').click();
    await popup.getByRole('heading', {name: '划词翻译设置', exact: true}).waitFor({state: 'visible', timeout});
    const drawer = popup.locator('.popup-drawer:visible');
    assert.equal(await drawer.count(), 1);
    await drawer.getByLabel('关闭', {exact: true}).click();
    await popup.getByRole('heading', {name: '划词翻译设置', exact: true}).waitFor({state: 'hidden', timeout});
    report.popup.drawer = true;
    report.cases.push('popup-selection-drawer-opens-and-closes');
    await screenshot(popup, '04-popup-selector-and-drawer');

    assert.deepEqual(report.consoleErrors, []);
    report.ok = true;
  } catch (error) {
    primaryError = error;
    report.failure = error instanceof Error ? {message: error.message, stack: error.stack} : {message: String(error)};
    report.ok = false;
    try {
      for (const [index, page] of (session?.context.pages() || []).entries()) {
        if (page.isClosed() || !page.url().startsWith('chrome-extension://')) continue;
        await screenshot(page, `failure-${index}`).catch(() => undefined);
        const dom = await page.content().catch(() => '');
        fs.writeFileSync(path.join(artifactsDir, `failure-${index}.html`), dom);
      }
    } catch (diagnosticError) {
      console.error('Failure diagnostics failed:', diagnosticError);
      process.exitCode = 1;
    }
  } finally {
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
    report.browserClosed = browserClosed;
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
    report.profileRemoved = !fs.existsSync(profileDir);
    await cleanup('report', () => { saveReport(); });
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

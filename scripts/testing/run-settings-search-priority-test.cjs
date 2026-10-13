/**
 * @file scripts/testing/run-settings-search-priority-test.cjs
 * 文件职责：在临时后台 Edge 的生产设置页验证界面语言搜索入口与视频模型设置的实际加载。
 * 主要内容：通过现有配置协议设置合成界面语言，验证英文语言别名的首项、真实点击后的焦点、中文搜索及本地视频模型卡片，保存截图和实际脚本请求。
 * 模块边界：只使用本次临时 profile、清单页面和公开配置字段，不访问用户配置、不下载模型、不调用翻译服务或运行全量 UI 套件。
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const arg = (name, fallback) => {const index = process.argv.indexOf(`--${name}`);return index < 0 ? fallback : process.argv[index + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-settings-search-priority'));
const expected = arg('expect', 'optimized');
assert(['baseline', 'optimized'].includes(expected));
const helper = require(path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))));
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const optionsPath = manifest.options_ui?.page || manifest.options_page;
assert(optionsPath, 'manifest must declare an options page');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-search-priority-'));
const report = {ok: false, extensionDir, expected, scope: 'Production settings search and video model UI in temporary background Edge; no live provider/model download/Firefox coverage.', cases: [], screenshots: [], consoleErrors: [], externalRequests: [], scriptRequests: [], cleanup: {profileRemoved: false}};
fs.mkdirSync(artifactsDir, {recursive: true});
let session, page, launchAttempted = false, sequence = 0;
const save = () => fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
const screenshot = async name => {const file = path.join(artifactsDir, `${name}.png`);await page.screenshot({path: file, animations: 'disabled'});report.screenshots.push(file);};
async function patch(config) {
  const response = await page.evaluate(async ({config, sequence}) => {
    const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!read?.success) throw new Error('configuration authority unavailable');
    const current = typeof read.value === 'string' ? JSON.parse(read.value) : read.value;
    return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config, expected: Object.fromEntries(Object.keys(config).map(key => [key, current[key]])), baseRevision: current.__fluentConfigRevision || 0, clientId: 'search-priority-fixture', sequence});
  }, {config, sequence: ++sequence});
  assert.equal(response?.success, true);
}
(async () => {
  try {
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true, headless: false, viewport: {width: 1440, height: 1000}, timeout: 30000, browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');assert.equal(report.focusPolicy, 'launchservices-no-foreground');assert.equal(report.windowPlacement.browserFrontmost, false);
    await session.context.route(/^https?:/u, route => {report.externalRequests.push({method: route.request().method(), hostname: new URL(route.request().url()).hostname});return route.abort();});
    const worker = session.context.serviceWorkers()[0] || await session.context.waitForEvent('serviceworker', {timeout: 30000});
    const origin = /^chrome-extension:\/\/[^/]+/u.exec(worker.url())[0];
    page = await helper.newPageWithoutForeground(session.context, 30000);
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push(message.text());});
    const client = await session.context.newCDPSession(page);
    client.on('Network.requestWillBeSent', ({request}) => {if (request.url.startsWith(origin) && /\.js(?:\?|$)/u.test(request.url)) report.scriptRequests.push(new URL(request.url).pathname);});
    await client.send('Network.enable');
    await page.goto(`${origin}/${optionsPath}#settings-general`);await page.locator('[data-testid="plugin-master-setting"]').waitFor();
    await patch({uiLanguage: 'en-US', uiLanguageSetupCompleted: true});await page.reload();
    const search = page.locator('.search-box input');
    await search.waitFor();await page.locator('[data-testid="plugin-master-setting"]').waitFor();
    await page.waitForFunction(() => document.querySelector('.search-box input')?.getAttribute('placeholder') === 'Search all settings');
    for (const query of ['language', 'Language', 'lang']) {
      await search.fill(query);
      const results = page.locator('.search-results > button');await results.first().waitFor();
      const labels = await results.locator('strong').allTextContents();
      const languageIndex = labels.findIndex(label => label.endsWith(' / Language'));
      report.cases.push({query, labels, languageIndex});
      assert.equal(languageIndex, expected === 'optimized' ? 0 : 1, `UI language priority for ${query}`);
    }
    await screenshot('english-language-results');
    const results = page.locator('.search-results > button');
    await results.nth(expected === 'optimized' ? 0 : 1).click();
    await page.waitForFunction(() => document.activeElement?.matches('[data-testid="ui-language-select"] input'));
    assert.equal(await search.inputValue(), '');
    report.languageFocus = true;await screenshot('language-control-focused');
    await patch({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true});await page.reload();
    await page.locator('[data-testid="plugin-master-setting"]').waitFor();
    await page.waitForFunction(() => document.querySelector('.search-box input')?.getAttribute('placeholder') === '搜索所有设置');
    await search.fill('语言');await page.locator('.search-results > button').first().waitFor();
    const chineseLabels = await page.locator('.search-results > button strong').allTextContents();
    assert(chineseLabels.some(label => label.includes('软件语言')));
    if (expected === 'optimized') assert(chineseLabels[0].includes('软件语言'));
    report.cases.push({query: '语言', labels: chineseLabels});await screenshot('chinese-language-results');
    await search.fill('');await page.locator('button[data-section="settings-video"]').click();
    await page.locator('.video-model-list').waitFor();
    for (const model of ['tiny', 'base', 'small']) {
      const card = page.locator('.video-model-card').filter({has: page.locator(`input[value="${model}"]`)});
      assert(await card.locator('strong').isVisible());
    }
    await page.locator('.video-model-management').scrollIntoViewIfNeeded();
    report.videoModelChoices = ['Tiny', 'Base', 'Small'];await screenshot('video-local-model-settings');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(report.consoleErrors, []);assert.deepEqual(report.externalRequests, []);
    report.ok = true;
  } catch (error) {
    report.error = error.stack;
    if (page && !page.isClosed()) try {await screenshot('failure');} catch {}
    process.exitCode = 1;
  } finally {
    let closed = !launchAttempted;
    if (session) try {await session.close();closed = true;} catch (error) {report.cleanup.error = error.message;report.ok = false;process.exitCode = 1;}
    if (closed) {fs.rmSync(profileDir, {recursive: true, force: true});report.cleanup.profileRemoved = true;}
    else report.cleanup.retainedProfile = profileDir;
    save();console.log(JSON.stringify({ok: report.ok, expected, cases: report.cases, languageFocus: report.languageFocus, videoModelChoices: report.videoModelChoices, error: report.error}));
  }
})();

/**
 * @file scripts/testing/run-onboarding-keyboard-and-provider-dialog-test.cjs
 * 文件职责：在独占临时后台 Edge 验证首启语言单选组与自定义服务弹窗的首次加载。
 * 主要内容：对冻结基线或优化包检查真实方向键、Home/End、Tab、选择确认、取消再开和服务配置持久化，保存截图与弹窗脚本请求时机；可检查服务首开资源及冻结默认提示词的中英文呈现、原样自定义正文、清空与恢复。
 * 模块边界：只操作本次临时配置，接口使用保留测试域名且不测试连接，不写密钥、不下载模型、不访问用户浏览器或运行全量设置套件。
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`);return i < 0 ? fallback : process.argv[i + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-onboarding-provider-ui'));
const expected = arg('expect', 'optimized');
assert(['baseline', 'optimized'].includes(expected));
const expectedServiceRules = arg('service-rules', undefined);
assert(expectedServiceRules === undefined || ['present', 'absent'].includes(expectedServiceRules));
const promptDefaultsPath = arg('prompt-defaults', undefined);
const promptDefaults = promptDefaultsPath === undefined ? undefined : JSON.parse(fs.readFileSync(path.resolve(promptDefaultsPath), 'utf8'));
const helper = require(path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))));
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-onboarding-provider-'));
const report = {ok: false, expected, extensionDir, scope: 'First-use language keyboard and first provider-dialog loading in owned background Edge. No live provider, API keys, model downloads or Firefox runtime.', keys: [], screenshots: [], scriptRequests: [], consoleErrors: [], externalRequests: [], cleanup: {profileRemoved: false}};
fs.mkdirSync(artifactsDir, {recursive: true});
let session, page, launchAttempted = false, sequence = 0;
const shot = async name => {const file = path.join(artifactsDir, `${name}.png`);await page.screenshot({path: file, animations: 'disabled'});report.screenshots.push(file);};
async function readConfig() {
  return page.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!r?.success) throw new Error('configuration authority unavailable');
    return typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
  });
}
async function patchConfig(config) {
  const response = await page.evaluate(async ({config, sequence}) => {
    const r = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!r?.success) throw new Error('configuration authority unavailable');
    const current = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
    return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config,
      expected: Object.fromEntries(Object.keys(config).map(key => [key, current[key]])),
      baseRevision: current.__fluentConfigRevision || 0, clientId: 'onboarding-provider-fixture', sequence});
  }, {config, sequence: ++sequence});
  assert.equal(response?.success, true);
}
async function noOverflow() {assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);}
(async () => {
  try {
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true, headless: false, viewport: {width: 1440, height: 1000}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');assert.equal(report.focusPolicy, 'launchservices-no-foreground');assert.equal(report.windowPlacement.browserFrontmost, false);
    await session.context.route(/^https?:/u, route => {report.externalRequests.push({hostname: new URL(route.request().url()).hostname, method: route.request().method()});return route.abort();});
    const worker = session.context.serviceWorkers()[0] || await session.context.waitForEvent('serviceworker', {timeout: 30000});
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    page = await helper.newPageWithoutForeground(session.context, 30000);
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push(message.text());});
    const client = await session.context.newCDPSession(page);
    client.on('Network.requestWillBeSent', ({request}) => {if (request.url.startsWith(origin) && /\.js(?:\?|$)/u.test(request.url)) report.scriptRequests.push(new URL(request.url).pathname);});
    await client.send('Network.enable');
    await page.setViewportSize({width: 320, height: 560});
    await page.goto(`${origin}/${manifest.action.default_popup}`);
    if (expected === 'baseline') await page.getByTestId('onboarding-language-next').click();
    else await page.getByTestId('onboarding-language-step').waitFor();
    const radios = page.locator('.onboarding-language-options [role="radio"]');
    await radios.first().waitFor();assert.equal(await radios.count(), 7);
    const values = await radios.evaluateAll(nodes => nodes.map(n => n.dataset.language));
    const selected = () => page.locator('.onboarding-language-options [aria-checked="true"]');
    const initial = await selected().getAttribute('data-language');
    const before = await readConfig();assert.equal(before.uiLanguageSetupCompleted, false);
    assert.equal(await radios.evaluateAll(nodes => nodes.filter(n => n.tabIndex === 0).length), expected === 'optimized' ? 1 : 7);
    await selected().focus();let index = values.indexOf(initial);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'End', 'Home', 'ArrowRight', 'ArrowRight']) {
      if (expected === 'optimized') index = key === 'Home' ? 0 : key === 'End' ? values.length - 1 : (index + (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1) + values.length) % values.length;
      await page.keyboard.press(key);
      await page.waitForFunction(value => document.querySelector('.onboarding-language-options [aria-checked="true"]')?.getAttribute('data-language') === value, values[index]);
      if (expected === 'optimized') {
        await page.waitForFunction(value => document.activeElement?.getAttribute('data-language') === value, values[index]);
        assert.equal(await radios.evaluateAll(nodes => nodes.filter(n => n.tabIndex === 0).length), 1);
      }
      report.keys.push({key, language: values[index]});
    }
    if (expected === 'optimized') {
      await page.keyboard.press('Tab');assert.equal(await page.locator('.onboarding-form .onboarding-confirm').evaluate(n => n === document.activeElement), true);
      await page.keyboard.press('Shift+Tab');assert.equal(await selected().evaluate(n => n === document.activeElement), true);
    }
    const preview = await readConfig();assert.equal(preview.uiLanguage, before.uiLanguage);assert.equal(preview.uiLanguageSetupCompleted, false);
    report.previewDidNotPersist = true;await noOverflow();await shot('language-keyboard-320');
    await page.setViewportSize({width: 390, height: 560});await patchConfig({theme: 'dark'});
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));await noOverflow();await shot('language-keyboard-dark-390');
    if (expected === 'baseline') await page.locator('[data-language="ja-JP"]').click();
    else assert.equal(await selected().getAttribute('data-language'), 'ja-JP');
    await page.locator('.onboarding-form .onboarding-confirm').click();
    await page.locator('.popup-content:visible').waitFor();const confirmed = await readConfig();
    assert.equal(confirmed.uiLanguage, 'ja-JP');assert.equal(confirmed.uiLanguageSetupCompleted, true);report.finalLanguagePersisted = 'ja-JP';
    await page.setViewportSize({width: 1440, height: 1000});
    await patchConfig({theme: 'light', uiLanguage: 'zh-CN'});
    report.optionsRequestStart = report.scriptRequests.length;
    await page.goto(`${origin}/${manifest.options_ui?.page || manifest.options_page}#settings-general`);
    await page.getByTestId('plugin-master-setting').waitFor();
    const providerRequests = () => report.scriptRequests.slice(report.optionsRequestStart).filter(file => /\/CustomOpenAIProviderDialog-/u.test(file));
    // Three browser frames allow the existing closed async component to start its loader without a fixed wall-clock sleep.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    report.providerInitialRequests = providerRequests().length;assert.equal(report.providerInitialRequests, expected === 'optimized' ? 0 : 1);
    const beforeServices = new Set(report.scriptRequests.slice(report.optionsRequestStart));
    await page.locator('button[data-section="settings-services"]').click();await page.getByTestId('custom-service-add').waitFor();
    await page.locator('[data-service-configuration-service]').waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    report.serviceNewScripts = [...new Set(report.scriptRequests.slice(report.optionsRequestStart))].filter(file => !beforeServices.has(file));
    report.serviceNewScriptBytes = report.serviceNewScripts.reduce((total, file) => total + fs.statSync(path.join(extensionDir, file)).size, 0);
    if (expectedServiceRules !== undefined) {
      report.serviceRuleScripts = report.serviceNewScripts.filter(file => /\/(?:compiler|registry)-[^/]+\.js$/u.test(file));
      report.serviceDetectorScripts = report.serviceNewScripts.filter(file => /\/detect-[^/]+\.js$/u.test(file));
      assert.equal(report.serviceRuleScripts.length, expectedServiceRules === 'present' ? 2 : 0);
      assert.equal(report.serviceDetectorScripts.length, 1);
    }
    await page.getByTestId('custom-service-add').click();const dialog = page.getByTestId('custom-service-dialog');await dialog.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'custom-service-name');
    assert.equal(providerRequests().length, 1);report.providerFirstOpenRequests = 1;
    await dialog.getByTestId('custom-service-name').fill('cancelled draft');await dialog.getByTestId('custom-service-endpoint').fill('https://fixture.invalid/v1');
    await dialog.locator('button.secondary-button').click();await dialog.waitFor({state: 'hidden'});
    await page.getByTestId('custom-service-add').click();await dialog.waitFor();
    for (const field of ['name', 'endpoint', 'api-key', 'model']) assert.equal(await dialog.getByTestId(`custom-service-${field}`).inputValue(), '');
    report.cancelReopenCleared = true;
    await dialog.getByTestId('custom-service-save').click();assert.equal(await dialog.locator('[role="alert"]').count(), 3);
    await dialog.getByTestId('custom-service-name').fill('本地验证接口');await dialog.getByTestId('custom-service-endpoint').fill('https://fixture.invalid/v1');await dialog.getByTestId('custom-service-model').fill('fixture-model');
    await noOverflow();await shot('provider-dialog-ready');
    await dialog.getByTestId('custom-service-save').click();await dialog.waitFor({state: 'hidden'});
    await page.waitForFunction(async () => {const r = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});const c = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;return c.customOpenAIProviders?.some(p => p.name === '本地验证接口');});
    const saved = await readConfig();const provider = saved.customOpenAIProviders.find(p => p.name === '本地验证接口');assert(provider);
    assert.deepEqual(provider.models, ['fixture-model']);assert.equal(provider.endpoint, 'https://fixture.invalid/v1');
    report.providerPersisted = true;await page.reload();await page.getByTestId('custom-service-add').waitFor();
    assert.equal(await page.locator(`[data-service-value="${provider.id}"]`).count(), 1);report.providerReopened = true;
    if (promptDefaults) {
      await page.locator('button[data-section="settings-selection"]').click();
      const editor = page.locator('#settings-selection .harness-prompts textarea');await editor.waitFor();
      const choices = page.locator('#settings-selection .harness-prompts [role="radio"]');
      const kinds = ['system', 'meaning', 'grammar', 'usage', 'practice'];assert.equal(await choices.count(), kinds.length);
      report.promptDefaults = [];
      for (const locale of ['zh-CN', 'en-US']) {
        await patchConfig({uiLanguage: locale});
        for (let index = 0; index < kinds.length; index++) {
          const kind = kinds[index], text = promptDefaults[locale][kind];assert.equal(typeof text, 'string');
          await choices.nth(index).click();
          await page.waitForFunction(text => document.querySelector('#settings-selection .harness-prompts textarea')?.value === text, text);
          report.promptDefaults.push({locale, kind, characters: text.length});
        }
      }
      await choices.first().click();const custom = '  Keep custom {{to}}\nlocal fixture  ';
      const waitStoredPrompt = text => page.waitForFunction(async text => {
        const r = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
        const c = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;return c.harness?.systemPrompt === text;
      }, text);
      await editor.fill(custom);await waitStoredPrompt(custom);await patchConfig({uiLanguage: 'zh-CN'});
      assert.equal(await editor.inputValue(), custom);report.promptCustomPreserved = true;
      await editor.fill('');await waitStoredPrompt('');
      assert.equal(await editor.getAttribute('placeholder'), promptDefaults['zh-CN'].system);report.promptEmptyPreserved = true;
      await page.locator('#settings-selection .harness-prompt-toolbar button').click();await waitStoredPrompt(promptDefaults['zh-CN'].system);
      assert.equal(await editor.inputValue(), promptDefaults['zh-CN'].system);report.promptRestorePersisted = true;
      await noOverflow();await shot('prompt-defaults-restored');
    }
    assert.deepEqual(report.consoleErrors, []);assert.deepEqual(report.externalRequests, []);report.ok = true;
  } catch (error) {
    report.error = error.stack;process.exitCode = 1;
    if (page && !page.isClosed()) try {await shot('failure');} catch {}
  } finally {
    let closed = !launchAttempted;
    if (session) try {await session.close();closed = true;} catch (error) {report.cleanup.error = error.message;report.ok = false;process.exitCode = 1;}
    if (closed) {fs.rmSync(profileDir, {recursive: true, force: true});report.cleanup.profileRemoved = true;}
    else report.cleanup.retainedProfile = profileDir;
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ok: report.ok, expected, keys: report.keys, providerInitialRequests: report.providerInitialRequests, error: report.error}));
  }
})();

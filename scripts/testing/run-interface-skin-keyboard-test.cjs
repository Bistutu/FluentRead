'use strict';

// 只验证界面皮肤单选组的键盘、快速关闭保存和布局；使用生产扩展与后台临时 Edge。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-interface-skin-keyboard'));
const {chromium} = require(path.join(arg('playwright-root',
  '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper',
  '/Users/thinkstu/.codex/skills/fluentread-extension-ui-test/scripts/focus-safe-browser.cjs'));
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-skin-keyboard-'));
const report = {extensionDir, scope: 'interface skin radio keyboard, quick close, cross-page update, dark and 390px layout', errors: [], checks: []};
fs.mkdirSync(artifactsDir, {recursive: true});

(async () => {
  let session;
  try {
    session = await launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      headless: false, background: true, viewport: {width: 1440, height: 1000},
      browserArgs: ['--no-first-run', '--no-default-browser-check',
        `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    const {context} = session;
    const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) ||
      await context.waitForEvent('serviceworker', {timeout: 30000});
    const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
    const setup = await newPageWithoutForeground(context);
    await setup.goto(`${extensionOrigin}/icon/128.png`);
    let sequence = 0;
    const patch = async value => setup.evaluate(async ({value, sequence}) => {
      const current = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!current?.success) throw new Error('配置读取失败');
      const response = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: value,
        expected: Object.fromEntries(Object.keys(value).map(key => [key, current.value[key]])),
        clientId: 'skin-keyboard-fixture', sequence, baseRevision: current.value.__fluentConfigRevision || 0});
      if (!response?.success) throw new Error('配置保存失败');
    }, {value, sequence: ++sequence});
    await patch({uiLanguageSetupCompleted: true, uiLanguage: 'zh-CN', interfaceSkin: 'default', theme: 'light'});
    const open = async () => {
      const page = await newPageWithoutForeground(context);
      page.on('pageerror', error => report.errors.push(error.message));
      await page.goto(`${extensionOrigin}/${manifest.options_ui?.page || manifest.options_page}#settings-interface`);
      await page.locator('.interface-skin-picker [data-skin="default"]').waitFor();
      return page;
    };
    let page = await open();
    const options = await page.locator('.interface-skin-picker [role="radio"]').evaluateAll(items => items.map(item => item.dataset.skin));
    const selected = () => page.locator('.interface-skin-picker [role="radio"][aria-checked="true"]');
    const check = async expected => {
      await page.waitForFunction(expected => {
        const current = document.querySelector('.interface-skin-picker [role="radio"][aria-checked="true"]');
        return current?.dataset.skin === expected && document.activeElement === current;
      }, expected);
      assert.equal(await page.locator('.interface-skin-picker [role="radio"][tabindex="0"]').count(), 1);
      assert.equal(await selected().getAttribute('tabindex'), '0');
    };
    report.initialTabStops = await page.locator('.interface-skin-picker [role="radio"]').evaluateAll(items => items.filter(item => item.tabIndex === 0).length);
    assert.equal(report.initialTabStops, 1, '皮肤单选组应只占一个 Tab 停靠点');
    await selected().focus();
    let index = options.indexOf('default');
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'End', 'ArrowRight', 'Home', 'ArrowLeft']) {
      index = key === 'Home' ? 0 : key === 'End' ? options.length - 1 :
        (index + (key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      await selected().press(key);
      await check(options[index]);
      report.checks.push({key, selected: options[index], focusFollowsSelection: true, singleTabStop: true});
    }
    // 真实编辑后立即销毁文档，随后独立重开核对后台最终配置。
    await selected().press('Home');
    await check(options[0]);
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
    await page.screenshot({path: path.join(artifactsDir, 'skin-keyboard-light.png')});
    await page.close();
    page = await open();
    await page.locator(`.interface-skin-picker [data-skin="${options[0]}"][aria-checked="true"]`).waitFor();
    report.quickClose = {saved: true, selected: options[0]};
    await patch({interfaceSkin: 'default', theme: 'dark'});
    await page.locator('.interface-skin-picker [data-skin="default"][aria-checked="true"]').waitFor();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    assert.equal(await page.locator('.interface-skin-picker [role="radio"][tabindex="0"]').count(), 1);
    report.crossPageUpdate = true;
    await page.setViewportSize({width: 390, height: 900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await selected().focus();
    await page.screenshot({path: path.join(artifactsDir, 'skin-keyboard-dark-390.png')});
    await selected().press('ArrowDown');
    await check(options[(options.indexOf('default') + 1) % options.length]);
    report.dark390 = {noOverflow: true, keyboardWorks: true};
    await page.close();
    await setup.close();
    assert.equal(report.errors.length, 0);
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.failure = error.stack;
    process.exitCode = 1;
  } finally {
    report.cleanup = {browserClosed: false, profileRemoved: false};
    try {
      if (session) {
        await session.close();
        report.cleanup.browserClosed = true;
        fs.rmSync(profileDir, {recursive: true, force: true});
        report.cleanup.profileRemoved = true;
      } else {
        // 初始化归属不确定时仅删除空目录，保留可能仍由浏览器使用的配置。
        try { fs.rmdirSync(profileDir); report.cleanup.profileRemoved = true; }
        catch (error) { if (error.code !== 'ENOTEMPTY') throw error; }
      }
    } catch (error) {
      report.ok = false;
      report.cleanupFailure = error.stack;
      process.exitCode = 1;
    }
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ok: report.ok, initialTabStops: report.initialTabStops, checks: report.checks,
      quickClose: report.quickClose, crossPageUpdate: report.crossPageUpdate, dark390: report.dark390, failure: report.failure, cleanup: report.cleanup, cleanupFailure: report.cleanupFailure}, null, 2));
  }
})();

#!/usr/bin/env node
'use strict';
// Popup 修复专项：生产产物、临时 Chromium 浏览器、真实配置/content 消息、本地确定性服务；不操作用户浏览器。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execFileAsync = promisify(execFile);
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const browserPath = arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
const loadViaCdp = process.argv.includes('--load-via-cdp');
const headed = process.argv.includes('--headed'); // 仅在本次用户明确允许前台测试后传入。
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-popup-actions-service-ui'));
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(arg('focus-safe-helper', '/Users/thinkstu/.codex/skills/fluentread-extension-ui-test/scripts/focus-safe-browser.cjs'));
const timeout = 30000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {ok: false, artifact: 'production', extensionDir, browserPath, cases: [], persistenceCases: [], quickClose: false, latestWriteWins: false, crossPageSync: false, consoleErrors: [], screenshots: [], layout: {},
  evidenceBoundary: 'Real production extension in an isolated Chromium browser; active-tab lookup points to an actual local tab. Translation transport is a local deterministic provider. Failure UI uses named message-response fixtures. No live-provider or Firefox runtime claim.'};
const SOURCE = 'Reading should feel calm and effortless. Colors and lines should follow the page you are reading.';
const TRANSLATION = '阅读应该轻松、自然。颜色和线条应当贴合你正在阅读的网页。';
const service = 'custom:popup-fixture';
const requests = [];
const server = http.createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*'); response.setHeader('access-control-allow-headers', '*');
  if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
  if (request.method === 'POST') {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const prompt = body.messages.filter(item => item.role === 'user').map(item => item.content).join('\n');
    const text = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1] || '';
    requests.push({source: text, model: body.model});
    await wait(120);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({id: 'popup-fixture', object: 'chat.completion', created: 1, model: body.model,
      choices: [{index: 0, message: {role: 'assistant', content: text.replace(SOURCE, TRANSLATION)}, finish_reason: 'stop'}]})); return;
  }
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Popup actions fixture</title><style>body{padding:50px;font:18px/1.8 system-ui;background:#fff;color:#263044}article{max-width:800px}section{padding:20px;border:1px solid #ddd;margin:16px 0}</style></head><body><article><h1 translate="no">Popup actions fixture</h1><section id="chosen"><p id="primary">${SOURCE}</p></section><section id="other"><p translate="no">This other section must stay unchanged.</p></section></article></body></html>`);
});
let launched, context, control, popup, content, origin, currentCase = 'launch';
let focusMonitor, focusMonitorTask, closePromise;
let focusMonitorBusy = false, focusMonitorStopping = false;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-popup-actions-'));
fs.mkdirSync(artifactsDir, {recursive: true});
async function until(test, label, duration = 15000) {const end = Date.now() + duration; while (Date.now() < end) {if (await test()) return; await wait(60);} throw new Error(`${label}: timeout`);}
function observe(page) {
  page.on('pageerror', error => report.consoleErrors.push({url: page.url(), message: error.message}));
  page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({url: page.url(), message: message.text()});});
}
async function open(url, viewport) {
  const page = await newPageWithoutForeground(context, timeout); observe(page);
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(url, {waitUntil: 'domcontentloaded'}); return page;
}
async function read() {
  const result = await control.evaluate(() => chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}));
  assert(result?.success && result.value); return result.value;
}
async function patch(values) {
  const current = await read();
  // configStorageRead 不返回密钥；只在首次显式播种合成密钥时 replace，其他操作必须 patch。
  const initial = Object.hasOwn(values, 'token');
  const result = await control.evaluate(({values, current, initial}) => chrome.runtime.sendMessage({type: 'persistConfig', mode: initial ? 'replace' : 'patch',
    config: initial ? {...current, ...values} : values,
    expected: Object.fromEntries(Object.keys(values).map(key => [key, current[key]])),
    baseRevision: initial ? current.__fluentConfigRevision || 0 : undefined, clientId: `popup-ui-${crypto.randomUUID()}`, sequence: 1}), {values, current, initial});
  assert.equal(result?.success, true, result?.error);
  await until(async () => {const config = await read(); return Object.keys(values).filter(key => key !== 'token').every(key => JSON.stringify(config[key]) === JSON.stringify(values[key]));}, 'config seed');
  report.lastSaveResponse = {success: result.success, revision: result.revision};
}
async function saved(key, value) {await until(async () => JSON.stringify((await read())[key]) === JSON.stringify(value), `saved ${key}`);}
async function openPopup(failure) {
  const page = await newPageWithoutForeground(context, timeout); observe(page);
  await page.setViewportSize({width: 360, height: 560});
  await page.addInitScript(({fixtureUrl, failure}) => {
    // 工具栏 popup 不占标签页；普通测试页会。只控制 active-tab 查询，仍返回真实 fixture tab。
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (info, callback) => {
      if (!info.active) return query(info, callback);
      const {active: _active, ...rest} = info;
      const filter = tabs => tabs.filter(tab => tab.url === fixtureUrl);
      // 新版 Chromium 原生 Promise 与旧版 callback 调用都要保持，不能让夹具改变真实 API 契约。
      return typeof callback === 'function' ? query(rest, tabs => callback(filter(tabs))) : query(rest).then(filter);
    };
    if (failure) {
      const send = chrome.tabs.sendMessage.bind(chrome.tabs);
      chrome.tabs.sendMessage = (id, message, callback) => {
        if (message.type !== 'contextMenuTranslate') return send(id, message, callback);
        if (failure === 'no-receiver') {throw new Error('Fixture: no content script');}
        const response = failure === 'undefined' ? undefined : {status: failure};
        return typeof callback === 'function' ? callback(response) : Promise.resolve(response);
      };
    }
  }, {fixtureUrl: content.url(), failure});
  await page.goto(`${origin}/popup.html`, {waitUntil: 'domcontentloaded'});
  await activateExtensionTabWithoutForeground(context, page);
  await page.locator('.popup-shell[data-config-ready="true"]').waitFor();
  await page.locator('[data-setting="disable-extension-site"][data-site-domain="127.0.0.1"]').waitFor();
  await page.setViewportSize({width: Math.ceil(await page.locator('.popup-shell').evaluate(node => node.getBoundingClientRect().width)), height: Math.ceil(await page.locator('.popup-shell').evaluate(node => node.getBoundingClientRect().height))});
  return page;
}
async function fitPopup(page) {
  await wait(100);
  const size = await page.locator('.popup-shell').evaluate(node => {const r = node.getBoundingClientRect(); return {width: Math.ceil(r.width), height: Math.ceil(r.height)};});
  await page.setViewportSize(size);
}
async function shot(surface, name) {await wait(250); const file = path.join(artifactsDir, `${name}.png`); await surface.screenshot({path: file}); report.screenshots.push(file);}
async function geometry(page, name) {
  await fitPopup(page);
  const metrics = await page.evaluate(() => {
    const shell = document.querySelector('.popup-shell'); const rect = shell.getBoundingClientRect();
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
    const footer = document.querySelector('footer').getBoundingClientRect();
    return {width: rect.width, height: rect.height, scrollHeight: shell.scrollHeight, clientHeight: shell.clientHeight,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 || shell.scrollWidth > shell.clientWidth + 1,
      background: getComputedStyle(shell).backgroundColor, footerBottom: footer.bottom, viewportHeight: innerHeight,
      duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i)};
  });
  assert(metrics.width <= 400 && metrics.height <= 560 && !metrics.horizontalOverflow, `${name}: geometry ${JSON.stringify(metrics)}`);
  assert(metrics.footerBottom <= metrics.viewportHeight + 1, `${name}: clipped footer`);
  assert.equal(metrics.duplicateIds.length, 0); report.layout[name] = metrics; return metrics;
}
async function drawer(id = 'services') {
  await popup.locator(id === 'services' ? '[data-testid="popup-feature-services"]' : `[data-popup-quick-feature="${id}"]`).click();
  await popup.locator('.drawer-surface').waitFor(); await wait(300);
}
async function closeDrawer() {await popup.locator('.drawer-surface button[aria-label="关闭"]').click(); await popup.locator('.drawer-surface').waitFor({state: 'hidden'});}
async function closeTestPage(page) {
  // CDP Page.close 关闭当前页偶尔会激活 macOS 窗口；先在隔离窗口切回控制页，再用扩展 API 移除准确页签。
  const tabId = await page.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await control.evaluate(async tabId => {
    const anchor = await chrome.tabs.getCurrent();
    await chrome.tabs.update(anchor.id, {active: true});
    await chrome.tabs.remove(tabId);
  }, tabId);
}
async function monitorBackgroundWindow() {
  const browser = context.browser();
  const session = await browser.newBrowserCDPSession();
  const {processInfo} = await session.send('SystemInfo.getProcessInfo');
  const browserPid = processInfo.find(process => process.type === 'browser').id;
  await session.detach();
  report.focusMonitor = {samples: 0, violations: []};
  const sampleFocus = async () => {
    focusMonitorBusy = true;
    try {
      const {stdout} = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
        "ObjC.import('AppKit'); const app = $.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify({pid:Number(app.processIdentifier),name:ObjC.unwrap(app.localizedName)});"], {timeout: 5000});
      const foreground = JSON.parse(stdout.trim()); report.focusMonitor.samples++;
      if (foreground.pid === browserPid) {
        report.windowPlacement.browserFrontmost = true;
        report.focusMonitor.violations.push({at: new Date().toISOString(), foreground});
        clearInterval(focusMonitor);
        if (!focusMonitorStopping) await (closePromise ||= launched.close());
      }
    } catch (error) {
      report.focusMonitor.violations.push({at: new Date().toISOString(), error: error.message});
      clearInterval(focusMonitor);
        if (!focusMonitorStopping) await (closePromise ||= launched.close());
    } finally {focusMonitorBusy = false;}
  };
  focusMonitor = setInterval(() => {
    if (focusMonitorBusy || focusMonitorStopping) return;
    focusMonitorTask = sampleFocus();
    // The finalizer awaits the original task; suppress an early unhandled rejection.
    focusMonitorTask.catch(() => {});
  }, 1000);
}
async function pick(field, value) {
  await popup.locator(`[data-feature-service="${field}"]`).click();
  await popup.locator('.service-picker-search input').fill(value);
  await popup.locator(`[data-service-choice="${value}"]`).click();
  await popup.locator(`[data-feature-service="${field}"]`).waitFor();
}
async function main() {
  try {
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const fixtureUrl = `http://127.0.0.1:${server.address().port}/article`;
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json')));
    assert(manifest.action.default_popup && (manifest.options_page || manifest.options_ui.page)); report.manifest = {version: manifest.version, popup: manifest.action.default_popup, options: manifest.options_page || manifest.options_ui.page};
    launched = await launchFocusSafePersistentContext({chromium, profileDir, background: !headed, headless: false,
      browserPath, viewport: {width: 1440, height: 960}, displayTarget: 'secondary', timeout,
      browserArgs: [...(loadViaCdp ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]), '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    if (headed) {assert.equal(report.focusPolicy, 'foreground-authorized'); assert.equal(report.windowPlacement.mode, 'headed-centered');}
    else {assert.equal(report.windowPlacement.browserFrontmost, false); assert.equal(report.launchMode, 'macos-background-cdp');}
    context = launched.context;
    if (!headed) await monitorBackgroundWindow();
    let expectedExtensionId = '';
    if (loadViaCdp) {
      const session = await context.browser().newBrowserCDPSession();
      try {expectedExtensionId = (await session.send('Extensions.loadUnpacked', {path: extensionDir})).id;}
      finally {await session.detach();}
      report.extensionLoad = {method: 'Extensions.loadUnpacked', id: expectedExtensionId};
      // 动态载入的 MV3 worker 可能尚未被发现；先用返回的准确 ID 打开页面，唤醒真实后台。
      origin = `chrome-extension://${expectedExtensionId}`;
      control = await open(`${origin}/${manifest.action.default_popup}`);
      const actual = await control.evaluate(() => {
        const m = chrome.runtime.getManifest(); return {name: m.name, version: m.version, popup: m.action?.default_popup};
      });
      assert.deepEqual(actual, {name: manifest.name, version: manifest.version, popup: manifest.action.default_popup});
      report.loadedManifest = actual;
    }
    // 浏览器可能自带其他扩展 worker；只绑定清单匹配的 FluentRead，不能使用第一个 worker 猜 ID。
    let worker;
    await until(async () => {
      for (const candidate of context.serviceWorkers()) {
        const url = candidate.url();
        if (!url.startsWith('chrome-extension://') || !url.endsWith(`/${manifest.background.service_worker}`)
          || (expectedExtensionId && new URL(url).host !== expectedExtensionId)) continue;
        const actual = await candidate.evaluate(() => {
          const m = chrome.runtime.getManifest(); return {name: m.name, version: m.version, popup: m.action?.default_popup};
        }).catch(() => null);
        if (actual?.name === manifest.name && actual?.version === manifest.version && actual?.popup === manifest.action.default_popup) {
          worker = candidate; report.loadedManifest = actual; return true;
        }
      }
      return false;
    }, 'production extension worker', timeout);
    worker.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({url: worker.url(), message: message.text()});});
    origin = `chrome-extension://${new URL(worker.url()).host}`;
    if (!control) control = await open(`${origin}/${manifest.action.default_popup}`);
    await until(async () => Boolean((await read()).service), 'initial config');
    const initial = await read();
    await patch({on: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, theme: 'light', interfaceSkin: 'default',
      service, from: 'en', to: 'zh-Hans', display: 1, style: 1, autoTranslate: false, alwaysTranslateDomains: [], disabledExtensionDomains: [], useCache: false,
      customOpenAIProviders: [{id: service, name: '本地测试服务', endpoint: fixtureUrl.replace('/article', '/v1/chat/completions'), models: ['popup-fixture-model']}],
      model: {...initial.model, [service]: 'popup-fixture-model'}, token: {[service]: 'synthetic-local-fixture-not-a-secret'}, user_role: {...initial.user_role, [service]: 'SOURCE_BEGIN{{origin}}SOURCE_END'},
      enableAIContext: false, enableAIMultiSegment: false, glossaryEnabled: false, floatingBallHotkey: 'Alt+T', disableFloatingBall: true,
      disableSelectionTranslator: true, selectionTranslatorMode: 'disabled', animations: false});
    content = await open(fixtureUrl, {width: 1200, height: 800});
    const pageTab = await control.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, fixtureUrl);
    await until(async () => {try {return (await control.evaluate(tab => chrome.tabs.sendMessage(tab, {type: 'getFullPageTranslationState'}), pageTab)).status === 'success';} catch {return false;}}, 'content ready');
    popup = await openPopup();
    if (process.argv.includes('--density-only')) {
      const baseline = process.argv.includes('--density-baseline');
      report.capturedAt = new Date().toISOString();
      report.evidenceBoundary = 'Production popup and hover/selection/image quick panels in an isolated Chromium browser; measured at intrinsic toolbar-sized viewport. Internal vertical scrolling is allowed; controls must remain reachable. No live-provider, native toolbar or Firefox runtime claim.';
      const measure = async name => {
        await wait(250);
        const dims = await popup.locator('.drawer-surface').evaluate(node => {
          const body = node.closest('.el-drawer__body'); const drawer = body.closest('.el-drawer');
          const rect = body.getBoundingClientRect();
          const controls = [...node.querySelectorAll('button')].filter(button => button.getClientRects().length).map(button => {
            const r = button.getBoundingClientRect(); return {name: button.getAttribute('aria-label') || button.textContent.trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right};
          });
          const primary = node.querySelector('.drawer-content [role="switch"]')?.getBoundingClientRect();
          const closeButton = node.querySelector('.drawer-header > button').getBoundingClientRect();
          return {clientHeight: body.clientHeight, scrollHeight: body.scrollHeight, scrollTop: body.scrollTop, overflowY: getComputedStyle(body).overflowY,
            horizontalOverflow: body.scrollWidth > body.clientWidth + 1, drawerHeight: drawer.getBoundingClientRect().height,
            bodyTop: rect.top, bodyBottom: rect.bottom, bodyRight: rect.right, closeButtonRight: closeButton.right,
            scrollbarPadding: parseFloat(getComputedStyle(body).paddingRight), viewportWidth: innerWidth, viewportHeight: innerHeight,
            primary: primary && {top: primary.top, bottom: primary.bottom}, controls};
        });
        report.layout[name] = dims;
        if (!baseline) {
          assert(!dims.horizontalOverflow && dims.overflowY === 'auto', `${name}: scroll boundary ${JSON.stringify(dims)}`);
          assert(dims.scrollbarPadding >= 8 && dims.closeButtonRight <= dims.bodyRight - 7, `${name}: close button overlaps overlay scrollbar`);
          assert(dims.primary && dims.primary.top >= dims.bodyTop - 1 && dims.primary.bottom <= Math.min(dims.bodyBottom, dims.viewportHeight) + 1, `${name}: primary switch not initially visible`);
          assert(dims.controls.every(r => r.name && r.left >= 0 && r.right <= dims.viewportWidth + 1), `${name}: missing accessible label or horizontal clipping`);
          const title = await popup.locator('.drawer-header h2').evaluate(node => ({scroll: node.scrollWidth, client: node.clientWidth}));
          assert(title.scroll <= title.client + 1, `${name}: title overflow`);
          for (const button of await popup.locator('.drawer-surface button:visible:not(:disabled)').all()) {
            await button.focus();
            const reachable = await button.evaluate(node => {
              const r = node.getBoundingClientRect(); const body = node.closest('.el-drawer__body').getBoundingClientRect();
              return r.top >= body.top - 1 && r.bottom <= Math.min(body.bottom, innerHeight) + 1;
            });
            assert(reachable, `${name}: keyboard focus cannot reveal ${await button.innerText()}`);
          }
          await popup.locator('.el-drawer__body').evaluate(node => {node.scrollTop = 0;});
          await popup.mouse.move(100, Math.max(10, dims.bodyBottom - 20)); await popup.mouse.wheel(0, 600); await wait(80);
          dims.wheelScrollTop = await popup.locator('.el-drawer__body').evaluate(node => node.scrollTop);
          if (dims.scrollHeight > dims.clientHeight + 1) assert(dims.wheelScrollTop > 0, `${name}: overflowing body cannot scroll`);
          await popup.locator('.drawer-settings-link').focus();
          assert.match(await popup.locator('.drawer-settings-link').innerText(), name.endsWith('-english') ? /^More settings\s*↗$/u : /^更多设置\s*↗$/u);
          await popup.locator('.drawer-header > button').focus();
          await popup.locator('.el-drawer__body').evaluate(node => {node.scrollTop = 0;});
        }
      };
      const variants = baseline ? [['light', 'light', 'default', 'zh-CN', 340]] : [
        ['light', 'light', 'default', 'zh-CN', 320], ['dark', 'dark', 'default', 'zh-CN', 320],
        ['minimal', 'light', 'minimal', 'zh-CN', 310], ['compact', 'light', 'compact', 'zh-CN', 300],
        ['yuebai', 'light', 'yuebai', 'zh-CN', 320], ['english', 'light', 'default', 'en-US', 380],
      ];
      for (const [name, theme, interfaceSkin, uiLanguage, width] of variants) {
        currentCase = `density-${name}`;
        await patch({theme, interfaceSkin, uiLanguage, hotkey: 'Control', quickTranslationProfiles: [],
          selectionTranslatorMode: 'bilingual', selectionTranslatorTrigger: 'dot', selectionTranslatorPresentation: 'card'});
        const main = await geometry(popup, name);
        if (!baseline) {
          assert.equal(main.width, width); assert(main.scrollHeight <= main.clientHeight + 1, `${name}: popup scroll`);
          assert.equal(await popup.locator('.language-pair .fluentread-select-search-icon').count(), 0);
          assert.equal(await popup.locator('.site-rule-row [role="switch"]').count(), 2);
          assert.equal(await popup.locator('[data-testid="page-translation"]').count(), 1);
          assert.equal(await popup.locator('[data-testid="section-translation"]').count(), 1);
          assert.equal(await popup.locator('[data-testid="popup-version"]').innerText(), `v${manifest.version}`);
        }
        await shot(popup, `density-popup-${name}`);
        for (const id of ['hover', 'selection', 'image']) {
          await drawer(id); await measure(`${id}-${name}`); await shot(popup, `density-${id}-${name}`); await closeDrawer();
        }
        report.cases.push(`${name}: intrinsic popup width, primary switches visible and all panel controls reachable`);
      }
      if (baseline || process.argv.includes('--layout-only')) {report.ok = true; return;}
      currentCase = 'density-interaction';
      await patch({theme: 'light', interfaceSkin: 'default', uiLanguage: 'zh-CN', from: 'auto'}); await fitPopup(popup);
      await shot(popup, 'density-popup-auto');
      // 图标移除不应移除搜索，也不改变 Options 的默认搜索装饰。
      const language = popup.locator('.language-pair .fluentread-select').first();
      await language.click(); await language.locator('input').fill('英语');
      assert.equal(await popup.locator('.language-pair .fluentread-select-search-icon').count(), 0);
      await popup.locator('.fluentread-select-popper:visible').getByRole('option', {name: /English.*英语/u}).click();
      await saved('from', 'en');
      await drawer('hover'); await popup.locator('[data-testid="hover-enable"]').click();
      await closeTestPage(popup); popup = await openPopup(); await saved('hotkey', 'none'); await drawer('hover');
      await measure('hover-disabled'); await shot(popup, 'density-hover-disabled');
      const optionsEvent = context.waitForEvent('page'); await popup.getByRole('button', {name: '选择快捷键', exact: true}).click();
      const options = await optionsEvent; observe(options); await options.waitForURL(`${origin}/options.html#settings-translation`);
      await options.locator('#settings-translation').waitFor();
      await options.locator('nav [data-section="settings-general"]').click();
      await options.locator('[data-testid="default-translation-service-card"]').waitFor();
      assert(await options.locator('.fluentread-select-search-icon').count() > 0); await closeTestPage(options);
      popup = await openPopup(); await drawer('hover');
      assert.equal(await popup.locator('[data-testid="hover-enable"]').getAttribute('aria-checked'), 'false');
      await popup.locator('[data-testid="hover-enable"]').click(); await closeTestPage(popup); popup = await openPopup(); await saved('hotkey', 'Control');
      await drawer('hover'); await measure('hover-reenabled'); await shot(popup, 'density-hover-reenabled');
      const hoverOptionsEvent = context.waitForEvent('page'); await popup.locator('.drawer-settings-link').click();
      const hoverOptions = await hoverOptionsEvent; await hoverOptions.waitForURL(`${origin}/options.html#settings-translation`); await closeTestPage(hoverOptions);
      popup = await openPopup();
      report.persistenceCases.push({name: 'default hover disable and reenable restore Control after immediate close', passed: true});
      const profiles = Array.from({length: 8}, (_, i) => ({id: `density-${i}`, enabled: true, action: 'hover', hotkey: `Alt+${i + 1}`, service: '', model: '', targetLanguage: '', displayMode: 'inherit', fullPageMode: 'inherit'}));
      await patch({hotkey: 'custom', customHotkey: 'Control+Alt+Shift+J', quickTranslationProfiles: profiles, interfaceSkin: 'compact'}); await fitPopup(popup);
      await drawer('hover'); await measure('hover-eight-profiles'); await shot(popup, 'density-hover-profiles');
      await popup.locator('[data-testid="hover-enable"]').click(); await closeTestPage(popup); popup = await openPopup(); await saved('hotkey', 'none');
      assert.deepEqual((await read()).quickTranslationProfiles, profiles); await drawer('hover');
      await popup.locator('[data-testid="hover-enable"]').click(); await closeTestPage(popup); popup = await openPopup(); await saved('hotkey', 'custom');
      assert.equal((await read()).customHotkey, 'Control+Alt+Shift+J'); assert.deepEqual((await read()).quickTranslationProfiles, profiles);
      report.persistenceCases.push({name: 'custom hover shortcut restored without resetting eight independent profiles', passed: true});
      await patch({hotkey: 'Control', quickTranslationProfiles: [], interfaceSkin: 'default'}); await fitPopup(popup);
      await drawer('selection');
      assert.equal(await popup.locator('.selection-trigger-setting, .wordbook-shortcut').count(), 0);
      for (const trigger of ['dot', 'icon', 'hover', 'direct', 'contextMenu', 'Control', 'Alt', 'Shift', 'custom']) {
        await patch({selectionTranslatorTrigger: trigger, customSelectionTranslatorHotkey: 'Control+Alt+Shift+K'});
        await measure(`selection-trigger-${trigger}`);
      }
      for (const mode of ['双语显示', '仅译文']) {
        await popup.getByRole('group', {name: '划词翻译模式', exact: true}).getByRole('button', {name: mode, exact: true}).click();
        await measure(`selection-mode-${mode}`);
      }
      await popup.getByRole('button', {name: '普通翻译', exact: true}).click(); await closeTestPage(popup); popup = await openPopup();
      await saved('selectionTranslatorPresentation', 'simple'); await drawer('selection');
      assert.equal(await popup.getByRole('button', {name: '普通翻译', exact: true}).getAttribute('aria-pressed'), 'true');
      await measure('selection-reopened'); await shot(popup, 'density-selection-reopened');
      await saved('selectionTranslatorMode', 'translation-only');
      await popup.locator('[data-testid="selection-enable"]').click(); await closeTestPage(popup); popup = await openPopup(); await saved('selectionTranslatorMode', 'disabled');
      await drawer('selection'); assert.equal(await popup.getByRole('button', {name: '仅译文', exact: true}).isDisabled(), true);
      await measure('selection-disabled'); await shot(popup, 'density-selection-disabled');
      await popup.locator('[data-testid="selection-enable"]').click(); await closeTestPage(popup); popup = await openPopup(); await saved('selectionTranslatorMode', 'translation-only');
      await saved('selectionTranslatorPresentation', 'simple'); await drawer('selection');
      await measure('selection-reenabled'); await shot(popup, 'density-selection-reenabled');
      const selectionOptionsEvent = context.waitForEvent('page'); await popup.locator('.drawer-settings-link').click();
      const selectionOptions = await selectionOptionsEvent; await selectionOptions.waitForURL(`${origin}/options.html#settings-selection`); await closeTestPage(selectionOptions);
      popup = await openPopup(); await drawer('image');
      report.latestWriteWins = true;
      report.persistenceCases.push({name: 'two mode writes, presentation and master off/on preserve final translation-only preference', passed: true});
      const oldImage = (await read()).disableImageTranslator; const oldArea = (await read()).selectionAreaEnabled;
      await popup.getByRole('switch', {name: '启用或关闭图片翻译', exact: true}).click();
      await popup.getByRole('switch', {name: '启用或关闭圈选翻译', exact: true}).click();
      await closeTestPage(popup); popup = await openPopup(); await saved('disableImageTranslator', !oldImage); await saved('selectionAreaEnabled', !oldArea);
      await drawer('image'); await measure('image-reopened'); await shot(popup, 'density-image-reopened');
      assert.equal(await popup.locator('[data-testid="area-translation-demo"] .area-ring').count(), 1);
      assert.deepEqual(await popup.locator('[data-testid="area-translation-demo"] kbd').allTextContents(), ['Shift', 'Z']);
      await patch({selectionAreaEnabled: true, selectionAreaHotkey: 'custom', customSelectionAreaHotkey: 'Ctrl+Alt+Shift+L'});
      await measure('image-custom-hotkey'); await shot(popup, 'density-image-custom-hotkey');
      const mac = await popup.evaluate(() => /Mac|iPod|iPhone|iPad/u.test(navigator.platform));
      assert.deepEqual(await popup.locator('[data-testid="area-translation-demo"] kbd').allTextContents(), mac ? ['Control', 'Option', 'Shift', 'L'] : ['Ctrl', 'Alt', 'Shift', 'L']);
      const imageOptionsEvent = context.waitForEvent('page'); await popup.locator('.drawer-settings-link').click();
      const imageOptions = await imageOptionsEvent; await imageOptions.waitForURL(`${origin}/options.html#settings-image-translation`); await closeTestPage(imageOptions);
      report.quickClose = true;
      report.persistenceCases.push({name: 'two independent image switches then immediate close-reopen', passed: true});
      report.cases.push('language still searchable without icon; default/custom hover restore; selection mode restore; region keycaps and ring; real More settings navigation');
      if (!headed) assert.deepEqual(report.focusMonitor.violations, []);
      assert.deepEqual(report.consoleErrors, []); report.ok = true; return;
    }
    if (process.argv.includes('--footer-only')) {
      // 仅验证开源入口的视觉改动，避免重复整个服务/翻译矩阵。
      report.evidenceBoundary = 'Production popup/footer and settings preview in isolated Edge; no translation or persistence matrix in this footer-only run.';
      for (const [name, theme, interfaceSkin] of [
        ['light', 'light', 'default'], ['dark', 'dark', 'default'],
        ['minimal', 'light', 'minimal'], ['compact', 'light', 'compact'], ['yuebai', 'light', 'yuebai'],
      ]) {
        await patch({theme, interfaceSkin}); await geometry(popup, name); await wait(250);
        const styles = await popup.locator('.opensource-link').evaluate(node => {
          const s = getComputedStyle(node); return {border: s.borderColor, color: s.color, background: s.backgroundColor};
        });
        assert.equal(styles.border, 'rgba(0, 0, 0, 0)'); report.layout[`footer-${name}`] = styles;
        await shot(popup, `footer-popup-${name}`); report.cases.push(`${name}: neutral open-source capsule without visible border`);
      }
      await patch({theme: 'light', interfaceSkin: 'default'}); await geometry(popup, 'light');
      await popup.locator('.opensource-link').hover(); await wait(250);
      assert.equal(await popup.locator('.opensource-link').evaluate(node => getComputedStyle(node).borderColor), 'rgba(0, 0, 0, 0)');
      await shot(popup, 'footer-popup-hover');
      const options = await open(`${origin}/options.html#settings-interface`, {width: 1440, height: 960});
      const preview = options.locator('.popup-layout-live-preview'); await preview.scrollIntoViewIfNeeded();
      assert.equal(await preview.locator('.preview-open-source').evaluate(node => getComputedStyle(node).borderColor), 'rgba(0, 0, 0, 0)');
      await shot(preview, 'footer-layout-preview');
      assert.deepEqual(report.consoleErrors, []); report.ok = true; return;
    }
    currentCase = 'restored-main';
    assert.equal((await popup.locator('[data-testid="popup-version"]').innerText()).trim(), `v${manifest.version}`);
    assert.match(await popup.locator('.donation-button').innerText(), /赞赏/);
    assert.match(await popup.locator('[data-testid="popup-feature-services"]').innerText(), /翻译服务/);
    assert.equal(await popup.getByText('快捷功能', {exact: true}).count(), 0);
    const light = await geometry(popup, 'default-light'); assert.equal(light.background, 'rgb(255, 255, 255)');
    const site = popup.locator('.site-rule-row');
    assert.equal(await site.locator('.site-rule-copy').count(), 0);
    assert.equal(await site.getByRole('switch').count(), 2);
    assert(!(await site.innerText()).includes('127.0.0.1'));
    const siteHeight = await site.evaluate(node => node.getBoundingClientRect().height);
    assert(siteHeight <= 40, `site controls too tall: ${siteHeight}`); report.layout.siteControlsHeight = siteHeight;
    const serviceFrame = await popup.locator('.provider-summary').evaluate(node => {const style = getComputedStyle(node); return {border: style.borderTopWidth, radius: style.borderRadius, background: style.backgroundColor};});
    assert.equal(serviceFrame.border, '1px'); assert.notEqual(serviceFrame.background, 'rgba(0, 0, 0, 0)'); report.layout.serviceFrame = serviceFrame;
    assert(light.footerBottom <= light.height + 1); assert(light.scrollHeight <= light.clientHeight + 1);
    await shot(popup, 'popup-light'); report.cases.push('restored main actions, site controls, version, donation and footer; white canvas; no heading/clipping');
    await popup.locator('.donation-button').click(); await popup.locator('.donation-card').waitFor(); await shot(popup, 'donation');
    await popup.locator('.donation-kofi').scrollIntoViewIfNeeded(); await shot(popup, 'donation-bottom'); await popup.locator('.donation-close').click();
    const link = popup.locator('.opensource-link'); assert.match(await link.innerText(), /开源项目.*↗/s);
    await context.route('https://github.com/Bistutu/FluentRead', route => route.fulfill({contentType: 'text/html', body: '<title>Project link fixture</title>'}));
    const projectPagePromise = context.waitForEvent('page'); await link.click(); const projectPage = await projectPagePromise; await projectPage.waitForURL('https://github.com/Bistutu/FluentRead'); await projectPage.close();
    report.cases.push('open-source capsule opens the declared GitHub URL in a new tab (navigation fixture)');
    // --services-only 跳过页面动作与站点规则，只验证翻译服务面板；用于面板改动的聚焦回归。
    const servicesOnly = process.argv.includes('--services-only');
    if (!servicesOnly) {
    currentCase = 'page-actions';
    const mainAction = popup.locator('[data-testid="page-translation"]');
    await mainAction.click(); await until(async () => await mainAction.getAttribute('aria-pressed') === 'true', 'translated state');
    await content.locator('#primary .fluent-read-bilingual-content').waitFor(); assert.match(await content.locator('#primary').innerText(), /阅读应该轻松/);
    await shot(content, 'page-translated'); await shot(popup, 'popup-translated');
    await popup.close(); popup = await openPopup(); assert.equal(await popup.locator('[data-testid="page-translation"]').getAttribute('aria-pressed'), 'true');
    await popup.locator('[data-testid="page-translation"]').click(); await content.locator('#primary .fluent-read-bilingual-content').waitFor({state: 'detached'});
    await popup.locator('[data-testid="page-translation"]').click(); await content.locator('#primary .fluent-read-bilingual-content').waitFor();
    await popup.locator('[data-testid="page-translation"]').click(); await content.locator('#primary .fluent-read-bilingual-content').waitFor({state: 'detached'});
    report.cases.push('actual content translate -> reopen with accurate state -> restore -> translate -> restore');
    const closed = popup.waitForEvent('close'); await popup.locator('[data-testid="section-translation"]').click(); await closed;
    await content.locator('[data-fluent-read-ui="section-picker"]').waitFor({state: 'attached'});
    await content.locator('#primary').hover(); await wait(200); await shot(content, 'section-picker'); await content.locator('#primary').click();
    await content.locator('#primary .fluent-read-bilingual-content').waitFor(); assert.equal(await content.locator('#other .fluent-read-bilingual-content').count(), 0);
    report.cases.push('local button closes popup and starts actual picker; clicking one area translates it only');
    await control.evaluate(tab => chrome.tabs.sendMessage(tab, {type: 'contextMenuTranslate', action: 'restore'}), pageTab);
    popup = await openPopup();
    for (const failure of ['failed', 'disabled', 'undefined', 'no-receiver']) {
      await popup.close(); popup = await openPopup(failure); await popup.locator('[data-testid="page-translation"]').click();
      await popup.locator('.notice.error').waitFor(); assert.equal(await popup.locator('[data-testid="page-translation"]').getAttribute('aria-pressed'), 'false');
      report.cases.push(`page action response fixture ${failure}: error notice, no false success`);
    }
    await popup.close(); popup = await openPopup();
    currentCase = 'site-rules';
    await popup.locator('[data-setting="always-translate-site"]').click(); await saved('alwaysTranslateDomains', ['127.0.0.1']);
    await content.locator('#primary .fluent-read-bilingual-content').waitFor(); await popup.close(); popup = await openPopup();
    assert.equal(await popup.locator('[data-setting="always-translate-site"]').getAttribute('aria-checked'), 'true');
    await popup.locator('[data-setting="always-translate-site"]').click(); await saved('alwaysTranslateDomains', []);
    await popup.locator('[data-setting="disable-extension-site"]').click(); await popup.close(); popup = await openPopup();
    await saved('disabledExtensionDomains', ['127.0.0.1']); assert(await popup.locator('[data-testid="page-translation"]').isDisabled()); assert(await popup.locator('[data-testid="section-translation"]').isDisabled());
    await content.locator('#primary .fluent-read-bilingual-content').waitFor({state: 'detached'});
    await shot(popup, 'site-disabled'); await popup.locator('[data-setting="disable-extension-site"]').click(); await saved('disabledExtensionDomains', []);
    report.persistenceCases.push({name: 'site-rules-reopen-and-quick-close', passed: true});
    }
    currentCase = 'service-chooser';
    await drawer(); assert.equal(await popup.locator('.service-assignment').count(), 10); await shot(popup, 'services-overview');
    assert.equal(await popup.locator('.provider-drawer-actions, [data-testid="ai-context-help"]').count(), 0);
    await popup.locator('.popup-service-overview').evaluate(node => { node.closest('.el-drawer__body').scrollTop = node.closest('.el-drawer__body').scrollHeight; }); await shot(popup, 'services-overview-bottom');
    // 逐项选择当前浏览器允许的服务，验证选项不是只展示、不响应的装饰。
    await popup.locator('[data-feature-service="default"]').click();
    if (await popup.locator('.service-picker-more').getAttribute('aria-expanded') !== 'true') await popup.locator('.service-picker-more').click();
    const serviceIds = await popup.locator('[data-service-choice]:not(:disabled)').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-service-choice')));
    await popup.locator('.service-picker-search input').press('Escape');
    report.serviceSelectionCases = [];
    for (const id of serviceIds) {
      await popup.locator('[data-feature-service="default"]').click();
      if (await popup.locator(`[data-service-choice="${id}"]`).count() === 0) await popup.locator('.service-picker-more').click();
      await popup.locator(`[data-service-choice="${id}"]`).click(); await saved('service', id);
      report.serviceSelectionCases.push({id, passed: true});
    }
    report.featureSelectionCases = [];
    const fieldMap = {hover: 'hoverTranslationService', selection: 'selectionTranslationService', input: 'inputBoxTranslationService', video: 'videoService', document: 'documentService', image: 'imageTranslationService', area: 'areaTranslationService', reading: 'harness', writing: 'writing'};
    for (const [id, key] of Object.entries(fieldMap)) {
      const selectedService = ['reading', 'writing'].includes(id) ? service : 'microsoft';
      await pick(id, selectedService);
      await until(async () => {const value = (await read())[key]; return (typeof value === 'string' ? value : value.service) === selectedService;}, `feature ${id}`);
      report.featureSelectionCases.push({id, selectedService, passed: true});
    }
    for (const id of ['selection', 'image', 'area']) {await popup.locator(`[data-feature-service="${id}"]`).click(); await popup.locator('[data-service-choice=""]').click();}
    await pick('default', 'microsoft'); await saved('service', 'microsoft');
    await popup.locator('[data-feature-service="default"]').click(); await shot(popup, 'service-picker-common');
    assert.equal(await popup.locator('.service-picker-more').getAttribute('aria-expanded'), 'false');
    await popup.locator('.service-picker-search input').press('Escape');
    await pick('hover', 'google'); await saved('hoverTranslationService', 'google');
    await pick('default', 'deepseek'); await saved('service', 'deepseek');
    assert.match(await popup.locator('[data-feature-service="hover"]').innerText(), /谷歌|Google/);
    assert.match(await popup.locator('[data-feature-service="selection"]').innerText(), /DeepSeek/);
    await popup.locator('[data-feature-service="selection"]').click(); await popup.locator('[data-service-choice=""]').click(); await saved('selectionTranslationService', '');
    await popup.locator('[data-feature-service="default"]').click();
    const input = popup.locator('.service-picker-search input'); await input.fill('popup-fixture-model');
    assert.equal(await popup.locator('[data-service-choice]').count(), 1); await shot(popup, 'service-model-search');
    await input.fill('nothing-matches-123'); await popup.locator('.service-picker-empty').waitFor(); await input.press('Escape');
    assert(await popup.locator('.popup-service-overview').isVisible());
    await popup.locator('[data-feature-service="reading"]').click(); assert.equal(await popup.locator('[data-service-choice="microsoft"]').count(), 0);
    await popup.locator('.service-picker-search input').press('Escape');
    await popup.locator('[data-feature-service="default"]').click(); await popup.locator('.service-picker-search input').fill(service); await popup.locator(`[data-service-choice="${service}"]`).click();
    await saved('service', service); await popup.locator('[data-feature-service="default"]').click();
    // 当前选中的服务始终留在常用区：更多服务默认收起，初始视口仍能直接看到选中项。
    assert.equal(await popup.locator('.service-picker-more').getAttribute('aria-expanded'), 'false');
    assert(await popup.locator(`[data-service-choice="${service}"]`).isVisible());
    assert.equal(await popup.locator(`[data-service-choice="${service}"]`).getAttribute('aria-selected'), 'true');
    assert.equal(await popup.locator('.service-choice-grid').first().locator('[data-service-choice]').first().getAttribute('data-service-choice'), 'freeTranslation');
    const selectedVisibility = await popup.locator(`[data-service-choice="${service}"]`).evaluate(node => {const rect = node.getBoundingClientRect(); const body = node.closest('.el-drawer__body').getBoundingClientRect(); return {top: rect.top, bottom: rect.bottom, bodyTop: body.top, bodyBottom: body.bottom};});
    assert(selectedVisibility.top >= selectedVisibility.bodyTop - 1 && selectedVisibility.bottom <= selectedVisibility.bodyBottom + 1, `current service is outside drawer viewport: ${JSON.stringify(selectedVisibility)}`);
    assert(selectedVisibility.bottom <= await popup.evaluate(() => innerHeight), 'current service clipped by popup viewport');
    await shot(popup, 'service-picker-selected'); const commonCount = await popup.locator('[data-service-choice]').count(); await popup.locator('.service-picker-more').click();
    assert.equal(await popup.locator('.service-picker-more').getAttribute('aria-expanded'), 'true'); assert(await popup.locator('[data-service-choice]').count() > commonCount, 'expanding more services should reveal the remaining choices');
    const expandedCount = await popup.locator('[data-service-choice]').count(); await popup.locator('.service-picker-more').click();
    assert.equal(await popup.locator('.service-picker-more').getAttribute('aria-expanded'), 'false'); assert(await popup.locator('[data-service-choice]').count() < expandedCount, 'collapsing more services should hide its choices');
    await shot(popup, 'service-picker-more-collapsed'); await popup.locator('.service-picker-more').click();
    assert.equal(await popup.locator('.service-picker-more').getAttribute('aria-expanded'), 'true'); await shot(popup, 'service-picker-more');
    // 搜索框随列表滚动，只有标题栏吸顶；滚到底部后搜索框应离开抽屉视口。
    const scrolled = await popup.locator('.service-picker-search').evaluate(node => {const body = node.closest('.el-drawer__body'); body.scrollTop = body.scrollHeight; const rect = node.getBoundingClientRect(), bodyRect = body.getBoundingClientRect(), heading = body.querySelector('.service-picker-heading').getBoundingClientRect(); const result = {scrollTop: body.scrollTop, searchBottom: rect.bottom, bodyTop: bodyRect.top, headingTop: heading.top}; body.scrollTop = 0; return result;});
    assert(scrolled.scrollTop > 0 && scrolled.searchBottom <= scrolled.bodyTop + 1 && Math.abs(scrolled.headingTop - scrolled.bodyTop) <= 1, `search should scroll away under a sticky heading: ${JSON.stringify(scrolled)}`);
    const choices = popup.locator('[data-service-choice]:not(:disabled)');
    assert.equal(await choices.locator('.service-brand-icon').count(), await choices.count());
    await input.focus(); await input.press('ArrowDown'); await popup.keyboard.press('ArrowDown'); await popup.keyboard.press('Home');
    assert.equal(await popup.evaluate(() => document.activeElement.getAttribute('data-service-choice')), await choices.first().getAttribute('data-service-choice'));
    await popup.keyboard.press('Escape'); assert(await popup.locator('.popup-service-overview').isVisible());
    await popup.keyboard.press('Escape'); await popup.locator('.drawer-surface').waitFor({state: 'hidden'});
    await drawer(); await popup.locator('.popup-drawer-modal').click({position: {x: 8, y: 8}}); await popup.locator('.drawer-surface').waitFor({state: 'hidden'});
    report.cases.push('10 assignments, inheritance, independent override, custom model search, empty results, AI-only, current-more visibility, local icons and keyboard navigation');
    await drawer(); await pick('selection', 'google'); await pick('selection', 'microsoft'); await popup.close(); popup = await openPopup();
    await saved('selectionTranslationService', 'microsoft'); await drawer(); assert.match(await popup.locator('[data-feature-service="selection"]').innerText(), /微软/); await shot(popup, 'services-reopened'); await closeDrawer();
    report.quickClose = true; report.latestWriteWins = true; report.persistenceCases.push({name: 'service-two-writes-quick-close', passed: true});
    if (servicesOnly) {assert.deepEqual(report.consoleErrors, []); report.ok = true; return;}
    currentCase = 'selection-layout';
    await drawer('selection');
    assert.equal(await popup.locator('.selection-trigger-setting, .wordbook-shortcut').count(), 0);
    assert.equal(await popup.locator('[data-testid="selection-enable"][role="switch"]').count(), 1);
    await shot(popup, 'selection-drawer');
    await popup.locator('.drawer-settings-link').scrollIntoViewIfNeeded(); await shot(popup, 'selection-drawer-bottom');
    await popup.getByRole('button', {name: '普通翻译', exact: true}).click(); await popup.close(); popup = await openPopup(); await drawer('selection');
    assert.equal(await popup.getByRole('button', {name: '普通翻译', exact: true}).getAttribute('aria-pressed'), 'true'); await shot(popup, 'selection-reopened'); await closeDrawer();
    report.persistenceCases.push({name: 'selection-presentation-quick-close', passed: true});
    const optionsEvent = context.waitForEvent('page'); await drawer('selection'); await popup.locator('.drawer-settings-link').click(); const options = await optionsEvent;
    await options.waitForURL(`${origin}/options.html#settings-selection`); observe(options); await options.locator('#settings-selection').waitFor();
    report.cases.push('selection master switch first, redundant cards removed; More settings opens dedicated options');
    currentCase = 'settings-preview';
    await options.setViewportSize({width: 1440, height: 960});
    await options.locator('nav [data-section="settings-interface"]').click();
    await options.locator('.interface-skin-live-preview').scrollIntoViewIfNeeded(); await shot(options, 'settings-interface');
    const preview = options.locator('.interface-skin-live-preview');
    const iconGeometry = await preview.locator('.preview-provider-icons').evaluate(node => {const icons = [...node.querySelectorAll('.service-brand-icon')].map(icon => {const r = icon.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width};}); return {direction: getComputedStyle(node).flexDirection, icons, cardHeight: node.closest('.preview-service').getBoundingClientRect().height};});
    assert.equal(iconGeometry.direction, 'row'); assert(Math.abs(iconGeometry.icons[0].y - iconGeometry.icons[1].y) < 1); assert(iconGeometry.cardHeight < 60); report.layout.skinPreview = iconGeometry;
    await shot(preview, 'skin-preview');
    await options.locator('.popup-layout-live-preview').scrollIntoViewIfNeeded();
    const layoutPreview = options.locator('.popup-layout-live-preview');
    assert.equal(await layoutPreview.locator('.preview-provider-icons').evaluate(node => getComputedStyle(node).flexDirection), 'row');
    await shot(layoutPreview, 'layout-preview');
    await options.setViewportSize({width: 390, height: 844}); await layoutPreview.scrollIntoViewIfNeeded(); await shot(options, 'settings-layout-390');
    assert.equal(await options.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    report.cases.push('skin and layout previews have horizontal provider icons, restored action row, desktop/narrow no overflow');
    await patch({theme: 'dark'}); popup = await openPopup(); await geometry(popup, 'dark'); await shot(popup, 'popup-dark'); await drawer('selection'); await shot(popup, 'selection-dark'); await closeDrawer(); await drawer(); await shot(popup, 'services-dark'); await closeDrawer();
    await patch({theme: 'light', interfaceSkin: 'minimal'}); await geometry(popup, 'minimal'); await shot(popup, 'popup-minimal');
    await drawer(); await popup.locator('[data-feature-service="default"]').click(); await shot(popup, 'service-picker-minimal'); await popup.locator('.service-picker-search input').press('Escape'); await closeDrawer();
    await patch({interfaceSkin: 'compact'}); await geometry(popup, 'compact'); await shot(popup, 'popup-compact');
    await patch({interfaceSkin: 'yuebai'}); await geometry(popup, 'yuebai'); await shot(popup, 'popup-yuebai');
    await patch({interfaceSkin: 'default', uiLanguage: 'en-US'}); await geometry(popup, 'english'); await shot(popup, 'popup-english'); await drawer(); await shot(popup, 'services-english'); await closeDrawer();
    await patch({uiLanguage: 'zh-CN', on: false}); assert(await popup.locator('[data-testid="page-translation"]').isDisabled()); assert(await popup.locator('[data-testid="section-translation"]').isDisabled()); await geometry(popup, 'paused'); await shot(popup, 'popup-paused');
    await patch({on: true, theme: 'light'}); await popup.close(); popup = await openPopup();
    await drawer(); await pick('default', 'microsoft'); await saved('service', 'microsoft'); await closeDrawer();
    await options.setViewportSize({width: 1440, height: 960}); await options.locator('nav [data-section="settings-general"]').click();
    assert.match(await options.locator('[data-testid="default-translation-service-card"]').innerText(), /微软/); report.crossPageSync = true;
    await shot(options, 'options-cross-page');
    report.providerRequests = requests; report.finalConfig = {service: (await read()).service, selectionTranslationService: (await read()).selectionTranslationService, revision: (await read()).__fluentConfigRevision};
    assert.deepEqual(report.consoleErrors, []); report.ok = true;
  } catch (error) {
    report.failure = {case: currentCase, error: error.stack};
    if (popup && !popup.isClosed()) {await shot(popup, 'failure').catch(() => {}); report.failure.text = await popup.locator('body').innerText().catch(() => '');}
    throw error;
  } finally {
    focusMonitorStopping = true;
    clearInterval(focusMonitor);
    try {
      await focusMonitorTask;
      fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    } finally {
      try {
        if (launched) {
          await (closePromise ||= launched.close());
          fs.rmSync(profileDir, {recursive: true, force: true});
        } else {
          try {fs.rmdirSync(profileDir);} catch { /* Retain nonempty profiles after uncertain initialization. */ }
        }
      } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    }
  }
}
main().then(() => console.log(JSON.stringify({ok: report.ok, cases: report.cases.length, screenshots: report.screenshots.length, report: path.join(artifactsDir, 'report.json')}))).catch(error => {console.error(error.stack); process.exitCode = 1;});

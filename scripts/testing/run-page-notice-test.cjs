#!/usr/bin/env node
/**
 * @file scripts/testing/run-page-notice-test.cjs
 * 文件职责：用独立可见后台 Edge 验证生产页面通知的紧凑布局、交互和宿主样式隔离。
 * 主要内容：真实快捷键及内容消息生成成功/错误提示，空凭据全文翻译生成设置按钮；限定桌面与 390/320px、深色、悬停/焦点计时、Escape、关闭边缘及减少动画；超长文案仅作为明确标记的布局夹具。
 * 模块边界：只使用临时 profile 和本地 HTTP 阅读页，不操作用户已有浏览器；只在共享 ownership guard 确认关闭成功后删除 profile。
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {guardBrowserClose, getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const {patchStoredConfig} = require('../run-selection-trigger-test.cjs');
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  assert(process.argv[i].startsWith('--') && process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), 'Expected --name value arguments');
  args[process.argv[i].slice(2)] = process.argv[i + 1];
}
for (const field of ['extension-dir', 'playwright-root', 'artifacts-dir']) assert(args[field], `Missing --${field}`);
const helper = require(args['focus-safe-helper'] ? path.resolve(args['focus-safe-helper']) : './focus-safe-browser.cjs');
const extensionDir = path.resolve(args['extension-dir']);
const artifactsDir = path.resolve(args['artifacts-dir']);
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const {chromium} = createRequire(path.join(path.resolve(args['playwright-root']), 'page-notice-runner.cjs'))('playwright');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-page-notice-'));
fs.mkdirSync(artifactsDir, {recursive: true});
const report = {ok: false, suite: 'page-notice', extensionDir, profileDir,
  build: extensionDir.endsWith('-dev') ? 'development' : 'production', cases: [], screenshots: [], consoleErrors: [], stages: [], focusSamples: [],
  unverified: ['Firefox runtime', 'screen-reader speech output', 'real user sites outside the controlled page'],
  fixturePolicy: 'Production message/key and empty-credential translation paths generate notices; only the extreme-long-text case changes the real notice detail for layout stress.'};
const save = () => fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>阅读资料 · 页面提示专项</title><style>
body{margin:0;background:#f6f7fa;color:#293244;font:16px/1.8 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{height:72px;border-bottom:1px solid #e3e6ed;background:white;display:flex;align-items:center;padding:0 28px;gap:32px}header strong{color:#455467;font-size:17px}nav{display:flex;gap:22px;color:#788296;font-size:14px}main{max-width:740px;margin:62px auto;padding:0 24px}h1{font-size:30px;line-height:1.35;margin:0 0 10px}.meta{color:#8190a2;font-size:14px;margin-bottom:28px}article{background:white;border:1px solid #e3e6ed;border-radius:14px;padding:24px 30px}article p{margin:0 0 22px}article p:last-child{margin-bottom:0}#page-action{border:1px solid #cbd2dc;background:white;border-radius:7px;color:#455467;padding:5px 12px;cursor:pointer}@media(max-width:600px){header{padding:0 16px;gap:18px}nav{gap:12px}main{margin-top:42px;padding:0 16px}h1{font-size:25px}article{padding:20px}}
</style></head><body><header><strong>阅读资料</strong><nav><span>首页</span><span>文章</span><span>收藏</span></nav></header><main><h1>Reading with a little more focus</h1><div class="meta">浏览器阅读示例 · 4 分钟</div><article>
<p id="first">Reading on the web should feel comfortable. A browser tool can highlight important words, translate a difficult passage, or explain unfamiliar expressions without covering the content you are trying to read.</p>
<p>Small pieces of feedback work best when they stay close to the action and use only the space they need. A clear result, a familiar icon, and an easy close button help readers understand what happened and continue reading.</p>
<p>When an action needs more explanation, its message can wrap naturally. The rest of the page should remain available, and the reader should be able to pause the message while looking at it.</p>
</article><p><button id="page-action" onclick="window.__pageClicks=(window.__pageClicks||0)+1">继续阅读</button></p></main></body></html>`;
const server = http.createServer((request, response) => {response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(fixture);});

(async () => {
  let session, focusMonitor, browserPid, primaryError, focusError, cleanupStarted = false, focusTimer;
  let rejectFatal;
  const fatal = new Promise((resolve, reject) => {rejectFatal = reject;});
  void fatal.catch(() => {});
  const fail = error => {
    focusError ||= error; primaryError ||= error; report.ok = false; report.error = error.stack || String(error); save(); rejectFatal(error);
    void session?.close().catch(closeError => {report.asynchronousCloseError = String(closeError); save();});
  };
  async function step(name, action, timeoutMs = 30000, ignoreFatal = false) {
    report.stage = name; report.stages.push({name, state: 'before', at: Date.now()}); save();
    let timer;
    try {
      const work = Promise.resolve().then(action);
      const timeout = new Promise((resolve, reject) => {timer = setTimeout(() => reject(new Error(`Timed out in ${name}`)), timeoutMs);});
      const result = await Promise.race(ignoreFatal ? [work, timeout] : [work, timeout, fatal]);
      report.stages.push({name, state: 'after', at: Date.now()}); save(); return result;
    } catch (error) {report.stages.push({name, state: 'failed', error: String(error), at: Date.now()}); throw error;}
    finally {clearTimeout(timer);}
  }
  try {
    await step('fixture-listen', () => new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);}));
    const fixtureUrl = `http://127.0.0.1:${server.address().port}/reading`;
    focusMonitor = helper.startFocusEventMonitor({onEvent(event) {
      report.focusEvents = [...focusMonitor.events]; save();
      if (browserPid && event.pid === browserPid) fail(new Error('Owned test browser activated during native focus observation'));
    }, onError: fail});
    report.focusObserver = await step('native-focus-observer', () => focusMonitor.ready, 35000);
    const launching = helper.launchFocusSafePersistentContext({chromium, profileDir, background: true, headless: false, displayTarget: 'secondary',
      browserPath: args['browser-path'] || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', viewport: {width: 1440, height: 1000}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    void launching.then(async late => {
      if (!session && (cleanupStarted || focusError)) {
        guardBrowserClose(late, profileDir);
        try {await late.close(); report.lateLaunchCleanup = 'guarded-close-complete';} catch (error) {report.lateLaunchCleanupError = String(error);} save();
      }
    }, () => {});
    session = await step('browser-launch', () => launching, 90000); guardBrowserClose(session, profileDir);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp'); assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus'); assert.equal(report.windowPlacement.browserFrontmost, false);
    browserPid = await step('ownership-capture', () => getGuardedBrowserPid(session)); report.browserPid = browserPid;
    assert(!focusMonitor.events.some(event => event.pid === browserPid), 'Browser must not become foreground during launch');
    const context = session.context; context.setDefaultTimeout(15000);
    context.browser().on('disconnected', () => {if (!cleanupStarted) fail(new Error('Test browser disconnected before validation completed'));});
    async function checkFocus() {
      if (focusError) throw focusError;
      const front = await helper.queryMacFrontmostApplication();
      report.focusSamples.push({at: Date.now(), name: front?.name, pid: front?.pid});
      assert(front && front.pid !== browserPid, 'Test browser must remain in background');
      if (focusMonitor.error) throw focusMonitor.error;
    }
    await step('initial-focus-check', checkFocus);
    let checking = false;
    focusTimer = setInterval(() => {if (checking) return; checking = true; void checkFocus().catch(fail).finally(() => {checking = false;});}, 500);
    function observePage(page) {
      page.on('pageerror', error => {report.consoleErrors.push({surface: page.url(), kind: 'pageerror', message: error.message}); save();});
      page.on('console', message => {if (message.type() === 'error') {report.consoleErrors.push({surface: page.url(), kind: 'console', message: message.text()}); save();}});
    }
    context.on('page', observePage); context.pages().forEach(observePage);
    const worker = await step('extension-worker', async () => context.serviceWorkers().find(value => value.url().startsWith('chrome-extension://')) || context.waitForEvent('serviceworker', {timeout: 30000}));
    worker.on('console', message => {if (message.type() === 'error') {report.consoleErrors.push({surface: 'worker', kind: 'console', message: message.text()}); save();}});
    const workerCDP = await step('worker-error-monitor', () => worker.evaluate(() => {
      globalThis.__pageNoticeUnhandledErrors = [];
      globalThis.addEventListener('unhandledrejection', event => globalThis.__pageNoticeUnhandledErrors.push(String(event.reason)));
      globalThis.addEventListener('error', event => globalThis.__pageNoticeUnhandledErrors.push(event.message));
      return true;
    })); report.workerErrorMonitor = workerCDP;
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    let bootstrap = context.pages().find(value => value.url().startsWith('about:blank#fluentread-background-'));
    async function open(url) {
      await checkFocus(); const page = bootstrap || await helper.newPageWithoutForeground(context, 30000); bootstrap = null;
      await page.goto(url, {timeout: 30000}); await checkFocus(); return page;
    }
    const control = await step('open-owned-options-control', () => open(`${origin}/${manifest.options_page || manifest.options_ui.page}`));
    const optionsControlTab = await step('options-control-tab-identity', () => control.evaluate(async () => {
      const tab = await chrome.tabs.getCurrent();
      return {id: tab?.id, windowId: tab?.windowId, url: location.href};
    }));
    assert(Number.isInteger(optionsControlTab?.id));
    report.optionsControlTab = optionsControlTab;
    const expectedOptionsUrl = new URL(`${origin}/${manifest.options_page || manifest.options_ui.page}`);
    const actualOptionsUrl = new URL(optionsControlTab.url);
    assert(actualOptionsUrl.protocol === expectedOptionsUrl.protocol && actualOptionsUrl.hostname === expectedOptionsUrl.hostname && actualOptionsUrl.pathname === expectedOptionsUrl.pathname);
    await step('configure-temporary-profile', () => patchStoredConfig(control, {on: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, theme: 'light', service: 'openai', to: 'zh-Hans',
      informationHighlight: {enabled: false, hotkey: 'Alt+H', hotkeyEnabled: true, mode: 'keywords', model: 'qwen2.5-0.5b', density: 'medium', color: 'amber', style: 'background', intensity: 'standard'}}));
    const page = await step('open-owned-reading-page', () => open(fixtureUrl));
    await step('activate-owned-reading-tab', () => helper.activateExtensionTabWithoutForeground(context, page));
    const tabId = await step('owned-tab-id', () => control.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, fixtureUrl)); assert(Number.isInteger(tabId));
    const send = (type, extra = {}) => step(`production-message:${type}`, () => control.evaluate(({tabId, type, extra}) => chrome.tabs.sendMessage(tabId, {type, ...extra}), {tabId, type, extra}));
    const ready = () => control.evaluate(async tabId => {
      for (const deadline = Date.now() + 15000; Date.now() < deadline;) {
        try {const state = await chrome.tabs.sendMessage(tabId, {type: 'GET_INFORMATION_HIGHLIGHT_STATE'}); if (state) return state;} catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Production content message handler did not become ready');
    }, tabId);
    await step('production-content-ready', ready);
    const notices = page.locator('#fluent-read-page-notice-host .page-notice');
    const noticeWith = text => notices.filter({has: page.locator('.notice-detail', {hasText: text})});
    const waitNotice = text => noticeWith(text).waitFor({state: 'visible'});
    async function clearNotices() {
      while (await notices.count()) {
        const close = notices.first().locator('.notice-close');
        if (await close.isVisible()) await close.click();
        await delay(220);
      }
      await page.mouse.move(2, 200);
    }
    async function metrics() {
      return page.evaluate(() => {
        const host = document.querySelector('#fluent-read-page-notice-host'), root = host?.shadowRoot, stack = root?.querySelector('.notice-stack');
        const rect = element => element?.getBoundingClientRect().toJSON();
        const style = element => element && getComputedStyle(element);
        return {viewport: {width: innerWidth, height: innerHeight}, host: host && {rect: rect(host), position: style(host).position, pointerEvents: style(host).pointerEvents, transform: style(host).transform}, stack: stack && {rect: rect(stack), pointerEvents: style(stack).pointerEvents},
          notices: [...(root?.querySelectorAll('.page-notice') || [])].map(node => {
            const detail = node.querySelector('.notice-detail'), close = node.querySelector('.notice-close'), action = node.querySelector('.notice-action'), heading = node.querySelector('.notice-heading'), mark = node.querySelector('.notice-mark');
            return {text: detail.textContent, classes: node.className, role: node.getAttribute('role'), rect: rect(node), detail: {rect: rect(detail), fontSize: style(detail).fontSize, lineHeight: style(detail).lineHeight, scrollHeight: detail.scrollHeight, clientHeight: detail.clientHeight, scrollWidth: detail.scrollWidth, clientWidth: detail.clientWidth},
              close: {rect: rect(close), label: close.getAttribute('aria-label')}, action: action && {rect: rect(action), text: action.textContent}, mark: rect(mark), heading: {rect: rect(heading), clipPath: style(heading).clipPath}, background: style(node).backgroundColor, color: style(node).color, transitionDuration: style(node).transitionDuration, opacity: style(node).opacity};
          })};
      });
    }
    async function shot(name, clip) {
      await step(`screenshot:${name}`, () => page.screenshot({path: path.join(artifactsDir, `${name}.png`), ...(clip ? {clip} : {})}));
      report.screenshots.push(`${name}.png`); save();
    }
    const record = (id, values) => {report.cases.push({id, status: 'passed', evidence: 'real-production-extension-entry', ...values}); save();};
    async function shortSuccess() {
      await page.keyboard.press('Alt+KeyH'); await waitNotice('智能高亮已开启');
      await page.keyboard.press('Alt+KeyH'); await waitNotice('智能高亮已关闭');
      await delay(220); return metrics();
    }
    await clearNotices(); const compact = await step('short-success-keyboard-feedback', shortSuccess);
    const short = compact.notices.find(value => value.text === '智能高亮已关闭'); assert(short);
    assert(short.rect.width <= 300 && short.rect.height <= 52, `Short notice must be compact: ${JSON.stringify(short.rect)}`);
    assert(short.close.rect.width >= 28 && short.close.rect.height >= 28); assert.equal(short.role, 'status');
    assert(short.heading.rect.width <= 1 && short.heading.clipPath === 'inset(50%)');
    record('short-success-content-sized-single-line', {metrics: compact});
    await shot('desktop-short-notice'); await shot('desktop-short-notice-top', {x: 0, y: 0, width: 1440, height: 250});
    await shot('desktop-short-notice-preview', {x: compact.viewport.width / 2 - 280, y: 0, width: 560, height: 120});
    await clearNotices(); await send('contextMenuNotice', {reason: 'failed'}); await waitNotice('翻译操作未能启动'); await delay(220);
    const errorMetrics = await metrics(); assert.equal(errorMetrics.notices[0].role, 'alert'); assert(errorMetrics.notices[0].rect.height <= 52);
    record('short-context-menu-error', {metrics: errorMetrics}); await shot('desktop-error-notice');
    const closeRect = errorMetrics.notices[0].close.rect;
    await step('click-close-control-edge', () => page.mouse.click(closeRect.x + 1, closeRect.y + closeRect.height / 2));
    await notices.waitFor({state: 'hidden'}); record('28px-close-control-edge-dismisses', {rect: closeRect});
    await shortSuccess(); await send('contextMenuNotice', {reason: 'unavailable'}); await waitNotice('此页面暂时无法接收翻译操作'); await delay(220);
    const stackMetrics = await metrics(), stackedShort = stackMetrics.notices.find(value => value.text === '智能高亮已关闭'), stackedLong = stackMetrics.notices.find(value => value.text.startsWith('此页面暂时'));
    assert(stackedLong.rect.width > stackedShort.rect.width + 100); assert(stackedShort.rect.height <= 52); assert(stackedLong.detail.rect.height > Number.parseFloat(stackedLong.detail.lineHeight));
    record('short-long-stack-keeps-each-content-width', {metrics: stackMetrics}); await shot('desktop-mixed-stack');
    const clickPoint = {x: stackedShort.rect.x - 20, y: stackedShort.rect.y + stackedShort.rect.height / 2};
    await page.evaluate(point => {
      const button = document.querySelector('#page-action');
      for (const [key, value] of Object.entries({position: 'fixed', left: `${point.x - 12}px`, top: `${point.y - 12}px`, width: '24px', height: '24px', padding: '0', fontSize: '0', zIndex: '1'})) button.style.setProperty(key, value, 'important');
    }, clickPoint);
    const hit = await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.id, clickPoint); assert.equal(hit, 'page-action');
    await page.mouse.click(clickPoint.x, clickPoint.y); assert.equal(await page.evaluate(() => window.__pageClicks), 1);
    record('blank-area-next-to-notice-remains-page-clickable', {point: clickPoint, hit}); await page.evaluate(() => document.querySelector('#page-action').removeAttribute('style'));
    await clearNotices(); await shortSuccess(); const hovering = noticeWith('智能高亮已关闭'); await hovering.hover(); await delay(3750); assert(await hovering.isVisible());
    record('hover-pauses-default-3500ms-dismissal', {waitedMs: 3750}); await page.mouse.move(2, 200); await hovering.waitFor({state: 'hidden', timeout: 6000});
    record('hover-exit-resumes-dismissal', {});
    await clearNotices(); await page.locator('#page-action').focus(); await shortSuccess();
    const focusedNotice = noticeWith('智能高亮已关闭'); await page.keyboard.press('Tab');
    assert(await focusedNotice.locator('.notice-close').evaluate(node => node.getRootNode().activeElement === node));
    await delay(3750); assert(await focusedNotice.isVisible());
    const focusVisible = await focusedNotice.locator('.notice-close').evaluate(node => ({matches: node.matches(':focus-visible'), outlineStyle: getComputedStyle(node).outlineStyle, outlineWidth: getComputedStyle(node).outlineWidth}));
    assert(focusVisible.matches && focusVisible.outlineStyle !== 'none'); await page.keyboard.press('Escape'); await focusedNotice.waitFor({state: 'hidden'});
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'page-action');
    record('focus-pauses-escape-dismisses-and-restores-page-focus', {waitedMs: 3750, focusVisible});
    await clearNotices(); await send('contextMenuNotice', {reason: 'unavailable'}); await waitNotice('此页面暂时'); await delay(220);
    const beforeHostile = await metrics(); await page.addStyleTag({content: 'button,span,section,img,fluent-read-page-notice{position:static!important;display:block!important;width:800px!important;height:500px!important;padding:80px!important;margin:50px!important;transform:rotate(5deg)!important;background:purple!important;color:lime!important;border-radius:0!important;font:60px/4 serif!important;overflow:hidden!important;pointer-events:none!important}'});
    const hostile = await metrics(); assert.equal(hostile.host.position, 'fixed'); assert.equal(hostile.host.rect.width, 0); assert.equal(hostile.host.pointerEvents, 'none'); assert.equal(hostile.host.transform, 'none');
    assert.deepEqual(hostile.notices[0].rect, beforeHostile.notices[0].rect); assert.equal(hostile.notices[0].detail.fontSize, '13px'); assert.equal(hostile.notices[0].background, beforeHostile.notices[0].background);
    record('hostile-global-css-shadow-isolation', {before: beforeHostile, after: hostile}); await shot('hostile-css-notice');
    // Reload removes the intentionally hostile host stylesheet and all existing notice lifecycle entries.
    await page.reload(); await step('production-content-ready-after-reload', ready);
    await step('start-empty-credential-full-page-translation', () => send('contextMenuTranslate', {action: 'fullPage'}));
    await step('production-missing-credential-error-indicator', () => page.locator('.fluent-read-reason').first().waitFor({timeout: 20000}));
    await step('show-real-translation-error-detail', () => page.locator('.fluent-read-reason').first().click());
    await step('production-credential-action-ready', () => page.locator('#fluent-read-page-notice-host .notice-action').waitFor());
    await delay(220); const warning = await metrics(); assert(warning.notices.some(value => value.classes.includes('page-notice-warning') && value.action?.text === '去设置'));
    record('missing-credential-full-page-error-offers-real-settings-action', {metrics: warning}); await shot('desktop-credential-warning');
    const action = page.locator('#fluent-read-page-notice-host .notice-action'); await action.focus();
    const actionMetrics = warning.notices.find(value => value.action)?.action.rect; assert(actionMetrics.height >= 28);
    for (const width of [390, 320]) {
      await step(`narrow-viewport:${width}`, () => page.setViewportSize({width, height: 850}));
      const narrow = await metrics();
      for (const item of narrow.notices) {
        assert(item.rect.x >= 4 && item.rect.right <= width - 4); assert(item.close.rect.width >= 28 && item.close.rect.height >= 28);
        assert(!item.action || item.action.rect.right <= item.rect.right && item.action.rect.bottom <= item.rect.bottom);
        assert(item.detail.scrollWidth <= item.detail.clientWidth + 1);
      }
      record(`narrow-${width}px-real-warning-wrap-and-action`, {metrics: narrow}); await shot(`narrow-${width}-credential-warning`);
    }
    const veryLongText = '较长的说明会自然换行，阅读期间可以暂停提示。'.repeat(120) + '\n' + 'LongUnbrokenToken'.repeat(80);
    await page.evaluate(text => document.querySelector('#fluent-read-page-notice-host').shadowRoot.querySelector('.notice-detail').textContent = text, veryLongText);
    const longLayout = await metrics(); const stressed = longLayout.notices.find(value => value.action);
    assert(stressed.detail.scrollHeight > stressed.detail.clientHeight); assert(stressed.detail.clientHeight <= 240); assert(stressed.detail.scrollWidth <= stressed.detail.clientWidth + 1);
    assert(stressed.rect.bottom <= longLayout.viewport.height); assert(stressed.action.rect.bottom <= stressed.rect.bottom);
    record('extreme-long-text-scroll-layout-fixture', {evidence: 'layout-fixture-only; real production warning node, textContent stress mutation', metrics: longLayout}); await shot('narrow-extreme-long-text-layout-fixture');
    const queryOwnedTabs = () => control.evaluate(async () => (await chrome.tabs.query({})).map(tab => ({id: tab.id, active: tab.active, url: tab.url ?? null, pendingUrl: tab.pendingUrl ?? null, windowId: tab.windowId})));
    report.optionsNavigationBefore = await queryOwnedTabs();
    await action.evaluate(node => node.addEventListener('click', event => {
      window.__pageNoticeSettingsClick = {isTrusted: event.isTrusted, type: event.type};
    }, {once: true}));
    await step('production-settings-action-click', () => action.click()); await checkFocus();
    report.settingsClick = await page.evaluate(() => window.__pageNoticeSettingsClick);
    assert.equal(report.settingsClick?.isTrusted, true);
    try {
      const activeOptions = await step('production-settings-navigation-settles', async () => {
        for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
          const tabs = await queryOwnedTabs();
          report.lastOptionsNavigationTabs = tabs;
          // chrome.tabs omits extension-page URLs without the broad tabs
          // permission. Use the existing options page's own getCurrent ID.
          if (tabs.some(tab => tab.id === optionsControlTab.id && tab.active)) return tabs.filter(tab => tab.active);
          await delay(100);
        }
        throw new Error('Settings action did not activate the real options page');
      });
      record('settings-action-opens-options', {activeOptions});
    } catch (error) {
      // This existing navigation behavior is outside the CSS change. Preserve the
      // observed limitation and still finish independent notice layout checks.
      if (focusError) throw focusError;
      record('settings-action-opens-options', {status: 'unconfirmed', error: String(error), tabs: report.lastOptionsNavigationTabs});
      report.unverified.push('Settings action active-tab navigation in background Edge; the real button was clicked but activation was not confirmed');
    }
    await helper.activateExtensionTabWithoutForeground(context, page);
    await clearNotices(); await page.setViewportSize({width: 1440, height: 1000}); await patchStoredConfig(control, {theme: 'dark'}); await delay(350);
    const dark = await shortSuccess(); assert(dark.notices[0].background === 'rgb(37, 42, 53)'); record('dark-theme-short-success', {metrics: dark}); await shot('dark-short-notice');
    await page.setViewportSize({width: 390, height: 850}); await send('contextMenuNotice', {reason: 'unavailable'}); await waitNotice('此页面暂时'); await delay(220);
    record('dark-narrow-390px-long-error', {metrics: await metrics()}); await shot('dark-narrow-long-notice');
    await clearNotices(); await page.emulateMedia({reducedMotion: 'reduce'}); await send('contextMenuNotice', {reason: 'failed'}); await waitNotice('翻译操作未能启动');
    const reduced = await metrics(); assert(reduced.notices.every(value => value.transitionDuration === '0s')); record('prefers-reduced-motion-disables-transition', {metrics: reduced});
    report.workerUnhandledErrors = await worker.evaluate(() => globalThis.__pageNoticeUnhandledErrors || []); assert.equal(report.workerUnhandledErrors.length, 0);
    assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors)); await checkFocus(); report.ok = true;
  } catch (error) {
    primaryError ||= focusError || error; report.ok = false; report.error = primaryError.stack || String(primaryError); save();
    if (session && !focusError) for (const [index, page] of session.context.pages().entries()) {
      try {await page.screenshot({path: path.join(artifactsDir, `failure-${index}.png`), timeout: 5000}); report.screenshots.push(`failure-${index}.png`);} catch {}
    }
  } finally {
    cleanupStarted = true; clearInterval(focusTimer);
    if (session) try {await step('close-owned-browser', () => session.close(), 15000, true); report.browserCloseReceipt = 'shared-guard-fulfilled';}
    catch (error) {primaryError ||= error; report.cleanupError = String(error); report.ok = false;}
    if (focusMonitor) {
      report.focusEvents = [...focusMonitor.events];
      try {await step('stop-focus-observer', () => focusMonitor.stop(), 10000, true);} catch (error) {primaryError ||= error; report.focusObserverCleanupError = String(error); report.ok = false;}
    }
    if (server.listening) {server.closeAllConnections?.(); await step('close-fixture-server', () => new Promise(resolve => server.close(resolve)), 5000, true);}
    if (report.browserCloseReceipt === 'shared-guard-fulfilled' || !report.stages.some(value => value.name === 'browser-launch')) {fs.rmSync(profileDir, {recursive: true, force: true}); report.profileRemoved = true;}
    save();
  }
  console.log(JSON.stringify({ok: report.ok, cases: report.cases.length, report: path.join(artifactsDir, 'report.json'), error: report.error || report.cleanupError}));
  if (primaryError || !report.ok) process.exitCode = 1;
})();

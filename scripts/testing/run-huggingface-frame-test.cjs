/**
 * @file scripts/testing/run-huggingface-frame-test.cjs
 * 文件职责：在隔离的真实 Edge 中验证 Hugging Face Space 跨域正文 frame 的翻译会话。
 * 主要内容：受控页面和微软响应下检查全文翻译、恢复、再次翻译、frame 快捷键、动态正文、晚加载 frame、来源拒绝及顶层唯一浮球；可选读取真实 Space 的页面结构。
 * 模块边界：只通过公开配置消息与真实 DevTools 输入操作生产扩展；夹具不读取用户配置或访问外部供应商，后台窗口全程保持非前台并在结束后删除本次临时 profile。
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {guardBrowserClose, getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
const {patchStoredConfig} = require('../run-selection-trigger-test.cjs');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  assert.ok(value && !value.startsWith('--'), `缺少 --${name} 的值`);
  return value;
}
function requiredPath(name) {const value = arg(name); assert.ok(value, `缺少 --${name}`); return path.resolve(value);}
const extensionDir = requiredPath('extension-dir');
const artifacts = requiredPath('artifacts-dir');
const {chromium} = require(path.join(requiredPath('playwright-root'), 'playwright'));
const helper = require(requiredPath('focus-safe-helper'));
assert.ok(!process.argv.includes('--headed'), '该专项仅支持不抢前台的隔离测试');
fs.mkdirSync(artifacts, {recursive: true});
const timeout = 30000;
const topUrl = 'https://huggingface.co/spaces/fluentread-fixture/document-reader';
const childOrigin = 'https://fluentread-fixture-document-reader.hf.space';
const childUrl = `${childOrigin}/?fixture=initial`;
const rejectedUrl = 'https://other-owner-document-reader.hf.space/?fixture=rejected';
const unrelatedTopUrl = 'https://example.com/fluentread-hf-frame-rejected';
const spaHomeUrl = 'https://huggingface.co/?fixture=spa';
const childHtml = `<!doctype html><html lang="en"><head><title>Space document fixture</title><style>body{font:20px/1.6 sans-serif;margin:24px}p{margin:16px 0}code{font-size:16px}</style></head><body><main><p id="frame-one">The embedded document explains how a small reading application works.</p><p id="frame-two">A second paragraph must keep its own translation and original text.</p><code id="protected-code">const PROTECTED_CODE = 1031;</code><input id="protected-input" value="Protected input text"></main></body></html>`;
const topHtml = `<!doctype html><html lang="en"><head><title>Hugging Face Space frame fixture</title><style>body{font:20px/1.6 sans-serif;margin:24px}iframe{display:block;width:96%;height:360px;margin:12px 0;border:1px solid #bbb}</style></head><body><main><p id="top-one">This outer Space page shares a translation session with its application.</p><iframe id="space-app" src="${childUrl}"></iframe><iframe id="unrelated-app" src="${rejectedUrl}" style="height:100px"></iframe><div id="late-frame-mount"></div></main></body></html>`;
const report = {ok: false, scope: 'Hugging Face Space frame targeted production extension regression',
  evidenceBoundary: 'Controlled HTTPS page responses and synthetic Microsoft translations exercise the real extension runtime; they do not establish live provider quality, authenticated application behavior, Firefox behavior, or every Hugging Face application.',
  service: 'microsoft', providerTransport: 'controlled-worker-fetch', profileMode: 'temporary-isolated', cases: [], screenshots: [], errors: []};
let launched, profileDir, worker, control, page, focusMonitor, browserPid, focusTimer, focusFailure;
let cleanupStarted = false, browserLaunchStarted = false;
function failFocus(error) {
  focusFailure ||= error; report.ok = false; report.focusError = String(focusFailure.stack || focusFailure);
  if (!cleanupStarted) void launched?.close().catch(closeError => {report.asynchronousCloseError = String(closeError);});
}
async function checkFocus() {
  if (focusFailure) throw focusFailure;
  if (focusMonitor.error) throw focusMonitor.error;
  const front = await helper.queryMacFrontmostApplication();
  (report.focusSamples ||= []).push({at: Date.now(), name: front?.name, pid: front?.pid});
  assert.ok(front && front.pid !== browserPid, '隔离 Edge 不应进入 macOS 前台');
}
async function waitUntil(read, predicate, label) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    if (focusFailure) throw focusFailure;
    value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
async function frameAt(selector) {
  const handle = await page.locator(selector).elementHandle();
  assert.ok(handle, `Missing frame ${selector}`);
  const frame = await handle.contentFrame(); assert.ok(frame, `Missing frame context ${selector}`); return frame;
}
async function counts(frame) {
  return frame.evaluate(() => ({translations: document.querySelectorAll('.fluent-read-bilingual-content').length,
    duplicates: [...document.querySelectorAll('p')].filter(node => node.querySelectorAll(':scope > .fluent-read-bilingual-content').length > 1).length,
    nested: document.querySelectorAll('.fluent-read-bilingual-content .fluent-read-bilingual-content').length,
    ball: document.querySelectorAll('#fluent-read-floating-ball-container').length,
    styles: document.querySelectorAll('#fluent-read-page-styles').length,
    loading: document.querySelectorAll('.fluent-read-loading').length,
    code: document.querySelector('#protected-code')?.textContent, input: document.querySelector('#protected-input')?.value}));
}
async function expectTranslations(frame, count, label) {
  const state = await waitUntil(() => counts(frame), state => state.translations === count && !state.loading, label);
  assert.equal(state.duplicates, 0, `${label}: duplicate wrappers`); assert.equal(state.nested, 0, `${label}: nested wrappers`);
  if (count) assert.ok(await frame.locator('.fluent-read-bilingual-content').evaluateAll(nodes => nodes.every(node => /[\u4e00-\u9fff]/u.test(node.textContent))), `${label}: expected Chinese text`);
  return state;
}
async function shortcut(frame, selector, mode) {
  await helper.activateExtensionTabWithoutForeground(launched.context, page);
  await frame.locator(selector).hover(); await frame.locator(selector).click();
  if (mode === 'hover') {await page.keyboard.down('Control'); await page.keyboard.up('Control');}
  else {await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');}
}
async function capture(name) {
  const file = path.join(artifacts, `${name}.png`);
  await page.screenshot({path: file, fullPage: true, caret: 'initial'}); report.screenshots.push(file);
  fs.writeFileSync(path.join(artifacts, `${name}-top.html`), await page.content());
  for (const [index, frame] of page.frames().filter(frame => frame !== page.mainFrame()).entries()) {
    fs.writeFileSync(path.join(artifacts, `${name}-frame-${index}.html`), await frame.content());
  }
}
async function stableOriginals(frame) {
  assert.equal(await frame.locator('#protected-code').textContent(), 'const PROTECTED_CODE = 1031;');
  assert.equal(await frame.locator('#protected-input').inputValue(), 'Protected input text');
}

(async () => {
  try {
    assertFreshProductionExtension(extensionDir);
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-huggingface-frame-'));
    focusMonitor = helper.startFocusEventMonitor({onEvent(event) {
      if (browserPid && event.pid === browserPid) failFocus(new Error(`隔离 Edge 在${cleanupStarted ? '关闭期间' : '测试期间'}的原生焦点事件中成为前台`));
    }, onError: failFocus});
    report.focusObserver = await focusMonitor.ready;
    browserLaunchStarted = true;
    launched = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      background: true, headless: false, displayTarget: 'secondary', viewport: {width: 1280, height: 900},
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(launched, profileDir);
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    assert.equal(launched.launchMode, 'macos-background-cdp'); assert.equal(launched.focusPolicy, 'launchservices-no-foreground');
    assert.equal(launched.windowPlacement.mode, 'background-visible-no-focus'); assert.equal(launched.windowPlacement.browserFrontmost, false);
    browserPid = await getGuardedBrowserPid(launched); report.browserPid = browserPid;
    assert.ok(!focusMonitor.events.some(event => event.pid === browserPid), '隔离浏览器在启动时进入前台');
    await checkFocus();
    let checkingFocus = false;
    focusTimer = setInterval(() => {if (checkingFocus || cleanupStarted) return;
      checkingFocus = true; void checkFocus().catch(failFocus).finally(() => {checkingFocus = false;});}, 500);
    const context = launched.context;
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout});
    await worker.evaluate(() => {
      const nativeFetch = globalThis.fetch;
      globalThis.huggingFaceFixture = {requests: [], unexpectedProviders: []};
      globalThis.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
        if (url.hostname !== 'edge.microsoft.com' || url.pathname !== '/translate/translatetext') {
          if (/translate|deepl|siliconflow|openai/u.test(url.hostname)) globalThis.huggingFaceFixture.unexpectedProviders.push(url.origin);
          return nativeFetch(input, init);
        }
        const texts = JSON.parse(init?.body || await input.text()); globalThis.huggingFaceFixture.requests.push(texts);
        return new Response(JSON.stringify(texts.map(text => ({translations: [{text: `测试译文：${text}`}]}))), {headers: {'content-type': 'application/json'}});
      };
    });
    const fixtureRoute = async route => {
      const url = route.request().url();
      if (url === topUrl) return route.fulfill({contentType: 'text/html; charset=utf-8', body: topHtml});
      if (url.startsWith(`${childOrigin}/`) || url === rejectedUrl) return route.fulfill({contentType: 'text/html; charset=utf-8', body: childHtml});
      if (url === unrelatedTopUrl) return route.fulfill({contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="en"><body><p>Unrelated outer page.</p><iframe id="space-app" src="${childUrl}"></iframe></body></html>`});
      if (url === spaHomeUrl) return route.fulfill({contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="en"><head><title>HF SPA entry fixture</title></head><body><main><p id="top-one">The Space application opens through navigation from the home page.</p><div id="spa-frame-mount"></div></main></body></html>'});
      if (/^https?:/u.test(url)) return route.abort('blockedbyclient');
      return route.continue();
    };
    await context.route('**/*', fixtureRoute);
    control = await helper.newPageWithoutForeground(context);
    await control.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    const config = await patchStoredConfig(control, {on: true, service: 'microsoft', from: 'en', to: 'zh-Hans', display: 1,
      hotkey: 'Control', customHotkey: '', floatingBallHotkey: 'Alt+T', disableFloatingBall: false, floatingBallDisabledDomains: [],
      disabledExtensionDomains: [], fullPageTranslationMode: 'all', useCache: false, animations: false,
      autoTranslate: false, enableAIMultiSegment: false, enableAIContext: false, pageTitleTranslationEnabled: false,
      disableSelectionTranslator: true, translationProgressPanelEnabled: false, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true});
    report.config = Object.fromEntries(['on', 'service', 'from', 'to', 'display', 'hotkey', 'floatingBallHotkey', 'fullPageTranslationMode', 'useCache'].map(key => [key, config[key]]));
    page = await helper.newPageWithoutForeground(context);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(topUrl, {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('#fluent-read-floating-ball-container', {state: 'attached', timeout});
    const child = await frameAt('#space-app'), rejected = await frameAt('#unrelated-app');
    await child.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout});
    await expectTranslations(child, 0, 'initial frame');
    assert.equal((await counts(child)).ball, 0); assert.equal((await counts(page)).ball, 1);
    assert.equal((await counts(rejected)).styles, 0); assert.equal((await counts(rejected)).ball, 0);
    const fullCounts = [];
    await shortcut(page, '#top-one', 'full');
    fullCounts.push((await expectTranslations(child, 2, 'initial full frame translation')).translations);
    await expectTranslations(page, 1, 'initial top translation');
    await expectTranslations(rejected, 0, 'mismatched child remains untranslated'); await stableOriginals(child);
    await capture('full-first');
    await child.evaluate(() => {const p = document.createElement('p'); p.id = 'dynamic-paragraph'; p.textContent = 'New document text arrives after the translation session has already started.'; document.querySelector('main').append(p);});
    await expectTranslations(child, 3, 'dynamic body joins active session');
    report.cases.push({name: 'dynamic-body', translations: 3});
    await shortcut(page, '#top-one', 'full');
    fullCounts.push((await expectTranslations(child, 0, 'full restore')).translations);
    await expectTranslations(page, 0, 'top restore');
    await shortcut(page, '#top-one', 'full');
    fullCounts.push((await expectTranslations(child, 3, 'full translate again')).translations);
    await expectTranslations(page, 1, 'top translate again');
    assert.deepEqual(fullCounts, [2, 0, 3]);
    report.cases.push({name: 'full-translate-restore-translate', counts: fullCounts, dynamicParagraphAdded: true});
    await capture('full-again');
    await shortcut(child, '#frame-one', 'full');
    await expectTranslations(child, 0, 'child shortcut restores frame'); await expectTranslations(page, 0, 'child shortcut restores top');
    await shortcut(child, '#frame-one', 'full');
    await expectTranslations(child, 3, 'child shortcut starts frame'); await expectTranslations(page, 1, 'child shortcut starts top');
    report.cases.push({name: 'iframe-full-hotkey-relays-to-top', counts: [0, 3], topCounts: [0, 1]});
    await shortcut(child, '#frame-one', 'full'); await expectTranslations(child, 0, 'prepare hover'); await expectTranslations(page, 0, 'prepare top hover');
    const hoverCounts = [], neighborCounts = [];
    for (const expected of [1, 0, 1]) {
      await shortcut(child, '#frame-one', 'hover');
      hoverCounts.push((await expectTranslations(child, expected, `frame Control toggle ${expected}`)).translations);
      neighborCounts.push(await child.locator('#frame-two .fluent-read-bilingual-content').count());
      assert.equal(await child.locator('#dynamic-paragraph .fluent-read-bilingual-content').count(), 0);
      await expectTranslations(page, 0, 'frame hover stays within paragraph');
      assert.equal(page.url(), topUrl); assert.equal(child.url(), childUrl);
    }
    assert.deepEqual(hoverCounts, [1, 0, 1]); assert.deepEqual(neighborCounts, [0, 0, 0]);
    report.cases.push({name: 'iframe-Control-translate-restore-translate', counts: hoverCounts, neighborCounts});
    report.translationSample = await child.locator('#frame-one .fluent-read-bilingual-content').textContent();
    await capture('hover-final');
    await shortcut(child, '#frame-one', 'hover'); await expectTranslations(child, 0, 'hover final restore');
    await shortcut(page, '#top-one', 'full'); await expectTranslations(child, 3, 'prepare late frame');
    await page.evaluate(url => {const frame = document.createElement('iframe'); frame.id = 'late-app'; frame.src = url; document.querySelector('#late-frame-mount').append(frame);}, `${childOrigin}/?fixture=late`);
    const late = await frameAt('#late-app');
    await late.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout});
    await expectTranslations(late, 2, 'late-loaded frame joins active top session');
    assert.equal((await counts(late)).ball, 0); await stableOriginals(late);
    await shortcut(page, '#top-one', 'full');
    await expectTranslations(late, 0, 'late-loaded frame restores'); await expectTranslations(child, 0, 'original frame restores with late frame');
    report.cases.push({name: 'late-loaded-frame-joins-and-restores', counts: [2, 0]});
    await capture('late-restored');
    const providerRequestsBeforeReject = await worker.evaluate(() => globalThis.huggingFaceFixture.requests.length);
    await shortcut(rejected, '#frame-one', 'hover'); await page.waitForTimeout(400); await expectTranslations(rejected, 0, 'mismatched frame shortcut denied');
    await shortcut(rejected, '#frame-one', 'full'); await page.waitForTimeout(400); await expectTranslations(page, 0, 'mismatched frame cannot toggle top');
    assert.equal((await counts(rejected)).styles, 0); assert.equal((await counts(rejected)).ball, 0);
    assert.equal(await worker.evaluate(() => globalThis.huggingFaceFixture.requests.length), providerRequestsBeforeReject);
    report.cases.push({name: 'mismatched-space-origin-denied', translations: 0, styles: 0, providerRequests: 0});
    await page.goto(unrelatedTopUrl, {waitUntil: 'domcontentloaded'});
    const detached = await frameAt('#space-app'); await detached.waitForSelector('#frame-one');
    await page.waitForTimeout(800);
    assert.equal((await counts(detached)).styles, 0); assert.equal((await counts(detached)).ball, 0);
    await shortcut(detached, '#frame-one', 'hover'); await page.waitForTimeout(400); await expectTranslations(detached, 0, 'supported hf.space inside unrelated top denied');
    report.cases.push({name: 'unrelated-top-origin-denied', translations: 0, styles: 0});
    await capture('unrelated-top-denied');
    await page.goto(spaHomeUrl, {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('#fluent-read-floating-ball-container', {state: 'attached', timeout});
    await page.evaluate(({destination, child}) => {
      history.pushState({}, '', destination);
      const frame = document.createElement('iframe'); frame.id = 'space-app'; frame.src = child;
      frame.style.cssText = 'width:100%;height:500px'; document.querySelector('#spa-frame-mount').append(frame);
    }, {destination: topUrl, child: childUrl});
    const spaChild = await frameAt('#space-app');
    await spaChild.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout});
    await shortcut(page, '#top-one', 'full');
    await expectTranslations(spaChild, 2, 'HF home SPA entry frame translation');
    await expectTranslations(page, 1, 'HF home SPA entry top translation');
    await shortcut(page, '#top-one', 'full');
    await expectTranslations(spaChild, 0, 'HF home SPA entry frame restore');
    await expectTranslations(page, 0, 'HF home SPA entry top restore');
    report.cases.push({name: 'home-SPA-navigation-to-Space', counts: [2, 0]});
    await capture('spa-entry-restored');
    report.providerRequests = await worker.evaluate(() => globalThis.huggingFaceFixture.requests.length);
    assert.deepEqual(await worker.evaluate(() => globalThis.huggingFaceFixture.unexpectedProviders), []);
    report.fixtureErrors = [...report.errors]; assert.deepEqual(report.fixtureErrors, []);
    const liveUrl = arg('live-url');
    if (liveUrl) {
      await context.unroute('**/*', fixtureRoute);
      report.live = {url: liveUrl, scope: 'Live page structure and full translation session with controlled Microsoft responses; no provider quality claim'};
      let liveFrame;
      try {
        const response = await page.goto(liveUrl, {waitUntil: 'domcontentloaded', timeout});
        report.live.httpStatus = response?.status();
        await page.waitForTimeout(6000);
        report.live.title = await page.title();
        report.live.iframeAttributes = await page.locator('iframe').evaluateAll(nodes => nodes.map(node => ({src: node.src, title: node.title, sandbox: node.getAttribute('sandbox')})));
        report.live.bodyExcerpt = (await page.locator('body').innerText()).slice(0, 600);
        liveFrame = page.frames().find(frame => /^https:\/\/[^/]+\.hf\.space\//u.test(frame.url()));
        report.live.frameBodyExcerpt = liveFrame ? (await liveFrame.locator('body').innerText()).slice(0, 1000) : '';
        report.live.available = Boolean(response?.ok() && liveFrame && report.live.frameBodyExcerpt.length > 40 &&
          !/^(?:Access denied|Too Many Requests|Bad Gateway|Checking your browser|Just a moment)/iu.test(report.live.frameBodyExcerpt.trim()));
        if (!report.live.available) report.live.limitation = 'Live site did not provide a readable application frame; inspect HTTP status and body excerpts.';
        await capture('live-structure');
      } catch (error) {report.live.available = false; report.live.limitation = error.message;}
      if (report.live.available) {
        // 网站可读之后，缺少扩展注入或功能断言失败必须使整个专项失败，不能归类为网站不可用。
        await liveFrame.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout});
        report.live.frames = await Promise.all(page.frames().map(async frame => ({url: frame.url(), ...await counts(frame)})));
        report.live.fullCounts = [];
        for (const translating of [true, false, true]) {
          await helper.activateExtensionTabWithoutForeground(context, page);
          await page.locator('body').click({position: {x: 8, y: 8}});
          await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
          const state = await waitUntil(() => counts(liveFrame), value => translating ? value.translations > 0 && !value.loading : value.translations === 0 && !value.loading,
            `live frame ${translating ? 'translate' : 'restore'}`);
          assert.equal(state.duplicates, 0); assert.equal(state.nested, 0); assert.equal(state.ball, 0);
          report.live.fullCounts.push(state.translations);
        }
        report.live.translationSample = (await liveFrame.locator('.fluent-read-bilingual-content').first().textContent())?.slice(0, 300);
        report.live.translated = true;
        report.live.limitation = 'Only loaded application text is covered; unvisited or unloaded content is not accepted.';
        await capture('live-translated-again');
      }
    }
    await checkFocus(); report.ok = true;
  } catch (error) {
    report.failure = (focusFailure || error).stack || String(focusFailure || error); process.exitCode = 1;
    if (page && !page.isClosed()) await capture('failure').catch(captureError => {report.captureError = captureError.message;});
  } finally {
    cleanupStarted = true; clearInterval(focusTimer);
    if (launched) {
      try {
        // CDP 先关闭本次隔离浏览器中的 page targets；避免原生退出时仍有窗口而短暂激活 Edge。
        let pageCloseError;
        try {
          const cleanupCdp = await launched.context.browser().newBrowserCDPSession();
          try {
            const {targetInfos} = await cleanupCdp.send('Target.getTargets');
            report.closedPageTargets = targetInfos.filter(target => target.type === 'page').map(target => target.targetId);
            for (const targetId of report.closedPageTargets) await cleanupCdp.send('Target.closeTarget', {targetId});
          } finally {await cleanupCdp.detach().catch(() => {});}
        } catch (error) {pageCloseError = error;}
        // 页面关闭错误也不能跳过已确认身份的浏览器清理；guard 的成功返回仍是删除 profile 的前提。
        await launched.close();
        if (pageCloseError) throw pageCloseError;
        await fs.promises.rm(profileDir, {recursive: true, force: true, maxRetries: 10, retryDelay: 150}); report.profileRemoved = true;
      }
      catch (error) {report.ok = false; report.cleanupError = String(error); report.retainedProfile = profileDir; process.exitCode = 1;}
    } else if (profileDir) {
      if (!browserLaunchStarted) fs.rmSync(profileDir, {recursive: true, force: true}); else report.retainedProfile = profileDir;
    }
    if (focusMonitor) {
      try {await focusMonitor.stop();} catch (error) {report.ok = false; report.focusObserverCleanupError = String(error); process.exitCode = 1;}
      report.focusEvents = [...focusMonitor.events];
      report.teardownFocusPassed = !report.focusEvents.some(event => event.pid === browserPid);
      if (!report.teardownFocusPassed || focusFailure) {report.ok = false; process.exitCode = 1;}
    }
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ok: report.ok, cases: report.cases.length, artifacts, failure: report.failure, live: report.live, cleanupError: report.cleanupError}));
  }
})();

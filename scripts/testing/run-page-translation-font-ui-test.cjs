#!/usr/bin/env node
'use strict';
/**
 * @file scripts/testing/run-page-translation-font-ui-test.cjs
 * 当前页译文字体专项：用临时、后台可见且不抢焦点的 Edge 和本地确定性服务，
 * 从真实 Aa 抽屉验证浏览器默认字体、双语/仅译文、隔离和页面生命周期。
 * 仅使用 getPageTranslationFontState 读取状态；字体写入必须通过真实按钮。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const argument = (name, fallback) => {const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1];};
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const subset = (actual, expected) => expected && typeof expected === 'object' && !Array.isArray(expected)
  ? actual && Object.entries(expected).every(([key, value]) => subset(actual[key], value))
  : JSON.stringify(actual) === JSON.stringify(expected);
const DEFAULT_APPEARANCE = {textColor: '', backgroundColor: '', lineColor: '', fillColor: '', fontScale: 100,
  fontWeight: 'default', fontFamily: 'default', opacity: 100, customCss: ''};
const TEXT = {
  primary: 'Reading an article should not require deciphering a decorative website font. This paragraph is the existing translation.',
  secondary: 'A newly translated paragraph should use the same selected reading font without another settings visit.',
  emphasis: 'Emphasized ordinary text keeps its meaning and remains readable.',
  dynamic: 'Content arriving after full page translation should immediately use the current page font choice.',
};
const TRANSLATED = {
  primary: '阅读文章不该需要辨认装饰性的网页字体。这一段用于验证已有译文。',
  secondary: '后来翻译的段落应当使用相同的阅读字体，无需再次访问设置。',
  emphasis: '强调的普通文字保留其含义，并且仍然清晰可读。',
  dynamic: '全文翻译后出现的新内容应当立即使用当前页选择的字体。',
};

async function startFixture() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
    if (request.method === 'POST') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      let body;
      try {body = JSON.parse(Buffer.concat(chunks).toString());}
      catch {response.writeHead(400, {'Content-Type': 'application/json'}); response.end(JSON.stringify({error: {message: 'Invalid local fixture JSON'}})); return;}
      if (!Array.isArray(body?.messages)) {response.writeHead(400); response.end(); return;}
      const prompt = body.messages.filter(item => item?.role === 'user').map(item => item.content).join('\n');
      const source = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1] || '';
      requests.push({source, at: Date.now()});
      const translated = Object.entries(TEXT).reduce((text, [key, value]) => text.replaceAll(value, TRANSLATED[key]), source);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({id: 'page-translation-font-fixture', object: 'chat.completion', created: 1, model: 'fixture',
        choices: [{index: 0, message: {role: 'assistant', content: translated}, finish_reason: 'stop'}]}));
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Current page translation font fixture</title>
      <style>
        body{margin:0;padding:48px 7vw;color:#243044;background:#fff;font:18px/1.8 cursive!important}
        main{max-width:1000px;margin:auto}h1{font-size:28px}p{margin:30px 0;font-family:monospace!important}
        strong,a{font-family:fantasy!important}code{font-family:monospace!important;color:#7c2d12;background:#fff7ed}
        math{font-family:serif!important}a{color:#1d4ed8}footer{font-size:14px}
      </style></head><body><main><h1 translate="no">当前页译文字体确定性夹具</h1>
      <p id="primary">${TEXT.primary} <strong id="source-emphasis">${TEXT.emphasis}</strong>
        <code id="source-code">const untouched = 42;</code>
        <math id="source-math" xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi><mo>+</mo><mn>2</mn></mrow></math>
      </p><p id="secondary">${TEXT.secondary}</p><footer translate="no">Host fonts are intentionally cursive, monospace and fantasy.</footer>
      </main></body></html>`);
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return {url: `http://127.0.0.1:${server.address().port}`, requests,
    close: () => new Promise(resolve => {server.close(resolve); server.closeAllConnections();})};
}

async function main() {
  const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
  const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-page-translation-font'));
  const packages = argument('playwright-root');
  const helperPath = argument('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'));
  assert(packages, '需要 --playwright-root');
  assert(fs.existsSync(path.join(extensionDir, 'manifest.json')), `缺少扩展产物 ${extensionDir}`);
  assert(fs.existsSync(helperPath), '缺少 focus-safe helper');
  assert(!process.argv.includes('--headed') && !process.argv.includes('--headless'), '本专项只允许真实后台可见、无前台焦点模式');
  const {chromium} = require(require.resolve('playwright', {paths: [packages]}));
  const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(helperPath);
  fs.mkdirSync(artifactsDir, {recursive: true});
  const report = {ok: false, extensionDir, artifactsDir, checks: [], consoleErrors: [], screenshots: [], metrics: {},
    evidenceBoundary: 'Real production/dev MV3 Edge runtime, real Aa drawer clicks, local deterministic HTML/provider and measured author-style-free browser baseline. This does not establish Firefox, a live provider, every website, or the reporter environment.'};
  let profileDir;
  let fixture;
  let launched;
  let launchAttempted = false;
  let failure;
  try {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-page-font-edge-'));
    report.profileDir = profileDir;
    fixture = await startFixture();
    launchAttempted = true;
    launched = await launchFocusSafePersistentContext({chromium, profileDir, background: true, headless: false,
      displayTarget: argument('display', 'secondary'),
      browserPath: argument('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      viewport: {width: 1280, height: 900}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const context = launched.context;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    const extensionOrigin = /^chrome-extension:\/\/[^/]+/u.exec(worker.url())[0];
    const createPage = async (url, viewport) => {
      const page = await newPageWithoutForeground(context, 30000);
      page.on('pageerror', error => report.consoleErrors.push(`pageerror ${page.url()}: ${error.message}`));
      page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push(`console ${page.url()}: ${message.text()}`);});
      if (viewport) await page.setViewportSize(viewport);
      await page.goto(url, {waitUntil: 'domcontentloaded'});
      return page;
    };
    const shot = async (page, name) => {
      const file = path.join(artifactsDir, `${name}.png`);
      await page.screenshot({path: file, fullPage: false});
      report.screenshots.push(file);
    };
    let popup = await createPage(`${extensionOrigin}/popup.html`, {width: 360, height: 600});
    const readConfig = () => popup.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!response?.success) throw new Error(response?.error || 'configuration read failed');
      return typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
    });
    const untilConfig = async predicate => {
      for (let attempt = 0; attempt < 200; attempt++) {const config = await readConfig(); if (config && predicate(config)) return config; await delay(50);}
      throw new Error('configuration did not converge');
    };
    await untilConfig(config => config.service && config.to);
    const patchConfig = async patch => {
      const current = await readConfig();
      const initial = Object.hasOwn(patch, 'token');
      const expected = Object.fromEntries(Object.keys(patch).map(key => [key, current[key]]));
      const response = await popup.evaluate(({patch, current, expected, initial}) => chrome.runtime.sendMessage({
        type: 'persistConfig', mode: initial ? 'replace' : 'patch', config: initial ? {...current, ...patch} : patch, expected,
        baseRevision: initial ? current.__fluentConfigRevision : undefined, clientId: `page-font-${crypto.randomUUID()}`, sequence: 1,
      }), {patch, current, expected, initial});
      assert.equal(response?.success, true, response?.error);
      await untilConfig(config => Object.keys(patch).filter(key => key !== 'token').every(key => subset(config[key], patch[key])));
    };
    const service = 'custom:page-font-fixture';
    await patchConfig({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, on: true, theme: 'light', interfaceSkin: 'default',
      display: 1, style: 1, translationAppearance: DEFAULT_APPEARANCE, service, from: 'en', to: 'zh-Hans', useCache: false,
      autoTranslate: false, bilingualSentenceHighlightEnabled: false, translationBeforeOriginal: false,
      customOpenAIProviders: [{id: service, name: '当前页字体夹具', endpoint: `${fixture.url}/v1/chat/completions`, models: ['fixture']}],
      token: {[service]: 'synthetic-local-fixture-not-a-secret'}, model: {[service]: 'fixture'},
      user_role: {[service]: 'SOURCE_BEGIN{{origin}}SOURCE_END'}, enableAIContext: false, enableAIMultiSegment: false,
      glossaryEnabled: false, hotkey: 'Control', floatingBallHotkey: 'Alt+T', mouseHoverTranslationDelay: 0,
      selectionTranslatorMode: 'disabled', disableSelectionTranslator: true, animations: false});
    const page = await createPage(`${fixture.url}/article`);
    const other = await createPage(`${fixture.url}/other`);
    await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
    await other.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, page.url());
    const otherTabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, other.url());
    assert(Number.isInteger(tabId) && Number.isInteger(otherTabId));
    const popupUrl = id => `${extensionOrigin}/popup.html?sourceTabId=${id}`;
    await popup.goto(popupUrl(tabId), {waitUntil: 'domcontentloaded'});
    const waitPopup = async () => {
      await popup.locator('.popup-shell[data-config-ready="true"]').waitFor({state: 'visible'});
      await popup.getByTestId('page-font-entry').waitFor({state: 'visible'});
    };
    const openFontDrawer = async () => {
      await waitPopup();
      const drawer = popup.locator('.drawer-surface');
      if (!await drawer.isVisible()) await popup.getByTestId('page-font-entry').click();
      await popup.getByTestId('page-font-browser-default').waitFor({state: 'visible'});
      await popup.getByTestId('page-font-host').waitFor({state: 'visible'});
    };
    await waitPopup();
    assert.notEqual((await readConfig()).popupQuickFeatureVisibility?.appearance, true, '专项不得为了找到入口而开启隐藏的外观快捷卡');
    assert.equal(await popup.locator('[data-popup-quick-feature="appearance"]').count(), 0, '新配置的外观快捷卡应保持默认隐藏');
    report.checks.push('default configuration exposes the permanent Aa entry while the optional appearance quick card remains hidden');
    const readState = id => popup.evaluate(async tab => chrome.tabs.sendMessage(tab, {type: 'getPageTranslationFontState'}, {frameId: 0}), id);
    const untilState = async (id, enabled) => {
      for (let attempt = 0; attempt < 160; attempt++) {
        const state = await readState(id);
        if (state?.status === 'success' && state.browserDefault === enabled) return state;
        await delay(50);
      }
      throw new Error(`page font state ${enabled} did not converge`);
    };
    const chooseFont = async enabled => {
      await openFontDrawer();
      const button = popup.getByTestId(enabled ? 'page-font-browser-default' : 'page-font-host');
      await button.click();
      await untilState(tabId, enabled);
      await popup.waitForFunction(id => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('aria-pressed') === 'true', enabled ? 'page-font-browser-default' : 'page-font-host');
    };
    const noNewRequests = async (count, label) => {await delay(350); assert.equal(fixture.requests.length, count, `${label} triggered translation requests`);};
    const hover = async (target, id) => {
      await activateExtensionTabWithoutForeground(context, target, 30000);
      await target.locator(`#${id}`).hover();
      await target.keyboard.down('Control'); await target.keyboard.up('Control');
    };
    const sourceMetrics = () => page.evaluate(() => {
      const font = selector => getComputedStyle(document.querySelector(selector)).fontFamily;
      return {primary: font('#primary'), emphasis: font('#source-emphasis'), code: font('#source-code'), math: font('#source-math'),
        codeHtml: document.querySelector('#source-code').outerHTML, mathHtml: document.querySelector('#source-math').outerHTML,
        primaryHtml: document.querySelector('#primary').innerHTML};
    });
    const original = await sourceMetrics();
    const browserDefault = await page.evaluate(async () => {
      const frame = document.createElement('iframe');
      frame.setAttribute('title', 'browser font measurement');
      frame.style.display = 'none';
      const ready = new Promise(resolve => frame.addEventListener('load', resolve, {once: true}));
      frame.srcdoc = '<!doctype html><html><body><p id="baseline">Aa 浏览器默认字体</p></body></html>';
      document.body.append(frame); await ready;
      const font = frame.contentWindow.getComputedStyle(frame.contentDocument.getElementById('baseline')).fontFamily;
      frame.remove(); return font;
    });
    assert.notEqual(original.primary, browserDefault, '夹具字体必须与浏览器无作者样式基准不同');
    report.metrics.browserDefaultFont = browserDefault;
    report.metrics.originalFonts = {primary: original.primary, emphasis: original.emphasis, code: original.code, math: original.math};
    const bilingual = id => page.locator(`#${id} > .fluent-read-bilingual-content`);
    const waitBilingual = async (id, target = page) => {
      await target.locator(`#${id} > .fluent-read-bilingual-content`).waitFor({state: 'attached'});
      await target.waitForFunction(({id, text}) => document.querySelector(`#${id} > .fluent-read-bilingual-content`)?.textContent.includes(text), {id, text: TRANSLATED[id]});
    };
    const fontOf = locator => locator.evaluate(element => getComputedStyle(element).fontFamily);
    const waitFont = async (locator, expected) => {
      await locator.waitFor({state: 'attached'});
      for (let attempt = 0; attempt < 160; attempt++) {if (await fontOf(locator) === expected) return; await delay(50);}
      assert.equal(await fontOf(locator), expected);
    };
    const assertOriginalUnchanged = async label => {
      const current = await sourceMetrics();
      for (const key of ['primary', 'emphasis', 'code', 'math', 'codeHtml', 'mathHtml']) assert.equal(current[key], original[key], `${label}: source ${key} changed`);
    };

    // 已有双语译文、普通后代、代码和公式，以及之后新增的双语译文。
    await hover(page, 'primary'); await waitBilingual('primary');
    await waitFont(bilingual('primary'), original.primary);
    const baselineState = await untilState(tabId, false);
    const translatedCode = bilingual('primary').locator('code');
    const translatedMath = bilingual('primary').locator('math');
    assert.equal(await translatedCode.count(), 1, '夹具必须覆盖译文内保留的代码');
    assert.equal(await translatedMath.count(), 1, '夹具必须覆盖译文内保留的公式');
    const protectedBefore = {code: await fontOf(translatedCode), math: await fontOf(translatedMath)};
    let count = fixture.requests.length;
    await chooseFont(true);
    await waitFont(bilingual('primary'), browserDefault);
    await waitFont(bilingual('primary').locator('strong'), browserDefault);
    assert.equal(await fontOf(translatedCode), protectedBefore.code, '译文内代码字体被改写');
    assert.equal(await fontOf(translatedMath), protectedBefore.math, '译文内公式字体被改写');
    await assertOriginalUnchanged('bilingual browser default');
    await noNewRequests(count, 'existing bilingual font change');
    await shot(page, '01-bilingual-browser-default');
    await shot(popup, '02-aa-drawer-browser-default');
    await hover(page, 'secondary'); await waitBilingual('secondary');
    await waitFont(bilingual('secondary'), browserDefault);
    report.checks.push('real Aa buttons update existing and later bilingual translations, including ordinary inline text; original, code and formula fonts remain unchanged');

    // 关闭恢复网页/全局外观；再开启覆盖全局自定义 CSS；任何字体操作都不能请求翻译。
    count = fixture.requests.length;
    await chooseFont(false); await waitFont(bilingual('primary'), original.primary);
    await waitFont(bilingual('primary').locator('strong'), original.emphasis);
    await noNewRequests(count, 'return to host font');
    await patchConfig({translationAppearance: {...DEFAULT_APPEARANCE, fontFamily: 'serif', customCss: 'font-family: cursive;'}});
    await waitFont(bilingual('primary'), 'cursive');
    await chooseFont(true); await waitFont(bilingual('primary'), browserDefault);
    await chooseFont(false); await waitFont(bilingual('primary'), 'cursive');
    await chooseFont(true); await waitFont(bilingual('primary'), browserDefault);
    assert.deepEqual((await readConfig()).translationAppearance, {...DEFAULT_APPEARANCE, fontFamily: 'serif', customCss: 'font-family: cursive;'});
    await noNewRequests(count, 'global custom font override and restoration');
    await patchConfig({translationAppearance: DEFAULT_APPEARANCE});
    await waitFont(bilingual('primary'), browserDefault);
    report.checks.push('switching back restores host and global custom font CSS; temporary choice does not rewrite global appearance or request translation');

    // Popup 重开保持当前文档状态，其他标签页独立。
    await popup.close();
    popup = await createPage(popupUrl(tabId), {width: 360, height: 600});
    await openFontDrawer();
    await popup.waitForFunction(() => document.querySelector('[data-testid="page-font-browser-default"]')?.getAttribute('aria-pressed') === 'true');
    await waitFont(bilingual('primary'), browserDefault);
    await hover(other, 'primary'); await waitBilingual('primary', other);
    assert.equal(await fontOf(other.locator('#primary > .fluent-read-bilingual-content')), original.primary);
    await untilState(otherTabId, false);
    await popup.goto(popupUrl(otherTabId), {waitUntil: 'domcontentloaded'});
    await openFontDrawer();
    await popup.waitForFunction(() => document.querySelector('[data-testid="page-font-host"]')?.getAttribute('aria-pressed') === 'true');
    await popup.goto(popupUrl(tabId), {waitUntil: 'domcontentloaded'});
    await openFontDrawer();
    await popup.waitForFunction(() => document.querySelector('[data-testid="page-font-browser-default"]')?.getAttribute('aria-pressed') === 'true');
    report.checks.push('reopened popup reads the active document choice; another tab retains its own host font');

    // 刷新与 SPA URL 改变都回到网页/全局字体；刷新产生新的 document token。
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
    const afterRefresh = await untilState(tabId, false);
    assert.notEqual(afterRefresh.documentToken, baselineState.documentToken, '刷新应更换文档 token');
    await popup.reload({waitUntil: 'domcontentloaded'}); await openFontDrawer();
    await hover(page, 'primary'); await waitBilingual('primary');
    await waitFont(bilingual('primary'), original.primary);
    await chooseFont(true); await waitFont(bilingual('primary'), browserDefault);
    count = fixture.requests.length;
    await page.evaluate(() => history.pushState({}, '', '/article/spa'));
    const afterSpa = await untilState(tabId, false);
    assert.equal(afterSpa.pageUrl, page.url());
    if (await bilingual('primary').count()) await waitFont(bilingual('primary'), original.primary);
    await noNewRequests(count, 'SPA font reset');
    report.metrics.lifecycle = {initial: baselineState, afterRefresh, afterSpa};
    report.checks.push('refresh resets the temporary choice with a new document token; SPA URL navigation also resets it without a translation request');

    // 仅译文采用闭合 ShadowRoot：CDP 直接读取真实渲染节点的计算样式，不注入替代 DOM。
    await patchConfig({display: 0});
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
    await untilState(tabId, false);
    await popup.reload({waitUntil: 'domcontentloaded'}); await openFontDrawer();
    const session = await context.newCDPSession(page);
    await session.send('DOM.enable'); await session.send('CSS.enable');
    const attributes = node => Object.fromEntries(Array.from({length: (node.attributes || []).length / 2}, (_, index) => [node.attributes[index * 2], node.attributes[index * 2 + 1]]));
    const descend = node => [node, ...(node.children || []).flatMap(descend), ...(node.shadowRoots || []).flatMap(descend)];
    const singleFonts = async id => {
      const {root} = await session.send('DOM.getDocument', {depth: -1, pierce: true});
      const target = descend(root).find(node => attributes(node).id === id);
      assert(target, `missing fixture #${id}`);
      const nodes = descend(target).filter(node => (attributes(node).class || '').split(/\s/u).includes('fluent-read-single-content'));
      const fonts = [];
      for (const node of nodes) {
        const {computedStyle} = await session.send('CSS.getComputedStyleForNode', {nodeId: node.nodeId});
        fonts.push(computedStyle.find(item => item.name === 'font-family').value);
      }
      return fonts;
    };
    const waitSingleFont = async (id, expected) => {
      let fonts;
      for (let attempt = 0; attempt < 160; attempt++) {
        fonts = await singleFonts(id);
        if (fonts.length && fonts.every(font => font === expected)) return fonts;
        await delay(50);
      }
      assert(fonts.length && fonts.every(font => font === expected), `single #${id} fonts ${JSON.stringify(fonts)} expected ${expected}`);
    };
    await hover(page, 'primary');
    await page.locator('#primary .fluent-read-single-slot').first().waitFor({state: 'attached'});
    const singleHostFonts = await singleFonts('primary');
    assert(singleHostFonts.length > 0 && singleHostFonts.every(font => font !== browserDefault), '单译文必须先继承故意不同的网页字体');
    count = fixture.requests.length;
    await chooseFont(true);
    await waitSingleFont('primary', browserDefault);
    await assertOriginalUnchanged('single browser default');
    await noNewRequests(count, 'existing single font change');
    await hover(page, 'secondary');
    await page.locator('#secondary .fluent-read-single-slot').first().waitFor({state: 'attached'});
    await waitSingleFont('secondary', browserDefault);
    await shot(page, '03-single-browser-default');
    count = fixture.requests.length;
    await chooseFont(false);
    const singleRestored = await singleFonts('primary');
    assert.deepEqual(singleRestored, singleHostFonts, '关闭后单译文未恢复每个原始文本槽的字体');
    await chooseFont(true); await waitSingleFont('primary', browserDefault);
    await noNewRequests(count, 'single return to host and browser default');
    await hover(page, 'primary');
    await page.locator('#primary .fluent-read-single-slot').first().waitFor({state: 'detached'});
    assert.equal((await sourceMetrics()).primaryHtml, original.primaryHtml, '恢复原文应还原原始 DOM');
    await hover(page, 'primary');
    await page.locator('#primary .fluent-read-single-slot').first().waitFor({state: 'attached'});
    await waitSingleFont('primary', browserDefault);
    assert.equal(await page.locator('#primary .fluent-read-bilingual-content').count(), 0, '仅译文不应遗留双语 wrapper');
    report.metrics.single = {hostFonts: singleHostFonts, restoredFonts: singleRestored, repeatedFonts: await singleFonts('primary')};
    report.checks.push('existing, later and repeated single translations use browser default inside real closed roots; turning it off restores each slot; restore returns original DOM');
    await session.detach();

    // 从真实全文按钮进入；字体覆盖不依赖悬浮入口，全文会话的后续 DOM 也使用当前选择。
    await patchConfig({display: 1});
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
    await untilState(tabId, false);
    await popup.reload({waitUntil: 'domcontentloaded'}); await waitPopup();
    assert.equal(await popup.locator('[data-popup-quick-feature="appearance"]').count(), 0, '全文路径仍应使用默认可见的 Aa 入口');
    const beforeFullRequests = fixture.requests.length;
    const fullButton = popup.getByTestId('page-translation');
    assert.equal(await fullButton.getAttribute('aria-pressed'), 'false', '刷新后全文按钮应处于未翻译状态');
    await fullButton.click();
    await waitBilingual('primary'); await waitBilingual('secondary');
    await popup.waitForFunction(() => {
      const button = document.querySelector('[data-testid="page-translation"]');
      return button?.getAttribute('aria-pressed') === 'true' && button.getAttribute('aria-busy') === 'false';
    });
    assert(fixture.requests.length > beforeFullRequests, '真实全文入口必须向本地 provider 发送翻译请求');
    await waitFont(bilingual('primary'), original.primary);
    await waitFont(bilingual('secondary'), original.primary);
    count = fixture.requests.length;
    const fullInitialRequests = count;
    await chooseFont(true);
    await waitFont(bilingual('primary'), browserDefault);
    await waitFont(bilingual('primary').locator('strong'), browserDefault);
    await waitFont(bilingual('secondary'), browserDefault);
    await assertOriginalUnchanged('full page browser default');
    await noNewRequests(count, 'full page existing translation font change');
    await page.evaluate(text => {
      const paragraph = document.createElement('p'); paragraph.id = 'dynamic'; paragraph.textContent = text;
      document.querySelector('main').append(paragraph);
    }, TEXT.dynamic);
    await waitBilingual('dynamic');
    await waitFont(bilingual('dynamic'), browserDefault);
    assert(fixture.requests.length > fullInitialRequests, '全文会话必须处理后来新增的真实正文');
    count = fixture.requests.length;
    const fullLaterRequests = count;
    await shot(page, '04-full-page-browser-default-with-later-content');
    await chooseFont(false);
    for (const id of ['primary', 'secondary', 'dynamic']) await waitFont(bilingual(id), original.primary);
    await waitFont(bilingual('primary').locator('strong'), original.emphasis);
    await assertOriginalUnchanged('full page font restored');
    await noNewRequests(count, 'full page existing and later translation font restoration');
    await popup.locator('.drawer-surface button[aria-label="关闭"]').first().click();
    await popup.locator('.drawer-surface').waitFor({state: 'hidden'});
    await fullButton.click();
    await page.locator('.fluent-read-bilingual-content').first().waitFor({state: 'detached'});
    await popup.waitForFunction(() => document.querySelector('[data-testid="page-translation"]')?.getAttribute('aria-pressed') === 'false');
    assert.equal((await sourceMetrics()).primaryHtml, original.primaryHtml, '真实全文恢复应完整还原原文 DOM');
    await noNewRequests(count, 'full page restore original');
    report.metrics.fullPage = {entry: 'real-popup-page-translation-click', beforeRequests: beforeFullRequests,
      afterInitialTranslation: fullInitialRequests, afterLaterContent: fullLaterRequests, afterFontChangesAndRestore: fixture.requests.length,
      laterContentFont: browserDefault, finalFont: original.primary, restoredOriginalDom: true};
    report.checks.push('real popup full-page translation supports existing and dynamically added content, Aa browser default and host restoration without extra requests, and full restore returns original DOM');

    // 真实抽屉在窄屏与深色主题下保留可达控件，并且没有横向溢出。
    const layouts = {};
    for (const theme of ['light', 'dark']) {
      await patchConfig({theme});
      await popup.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === 'dark');
      for (const width of [360, 320]) {
        await popup.setViewportSize({width, height: 600});
        await openFontDrawer();
        await delay(100);
        const metrics = await popup.evaluate(() => {
          const root = document.querySelector('.popup-shell');
          const drawer = document.querySelector('.drawer-surface');
          const button = document.querySelector('[data-testid="page-font-browser-default"]');
          const rect = button.getBoundingClientRect();
          return {innerWidth, scrollWidth: document.documentElement.scrollWidth, rootWidth: root.getBoundingClientRect().width,
            drawerScrollWidth: drawer.scrollWidth, drawerClientWidth: drawer.clientWidth,
            buttonLeft: rect.left, buttonRight: rect.right, buttonWidth: rect.width};
        });
        assert(metrics.scrollWidth <= metrics.innerWidth + 1, `${theme}/${width} 页面横向溢出`);
        assert(metrics.drawerScrollWidth <= metrics.drawerClientWidth + 1, `${theme}/${width} 抽屉横向溢出`);
        assert(metrics.buttonLeft >= -1 && metrics.buttonRight <= metrics.innerWidth + 1 && metrics.buttonWidth > 0, '字体按钮超出视口');
        layouts[`${theme}-${width}`] = metrics;
        await shot(popup, `05-aa-${theme}-${width}`);
      }
    }
    report.metrics.layouts = layouts;
    report.checks.push('320/360 CSS px light/dark Aa drawers retain visible font buttons without horizontal overflow');
    report.requests = fixture.requests.length;
    report.metrics.requestSources = fixture.requests.map(item => item.source);
    assert.deepEqual(report.consoleErrors, []);
    report.ok = true;
  } catch (error) {
    report.error = error.stack || String(error);
    failure = error;
  } finally {
    report.cleanupErrors = [];
    let closed = !launchAttempted;
    if (launched) {
      try {await launched.close(); closed = true;}
      catch (error) {report.cleanupErrors.push(`session close: ${error.message}`);}
    }
    try {await fixture?.close();} catch (error) {report.cleanupErrors.push(`fixture close: ${error.message}`);}
    if (profileDir) {
      if (closed) {
        try {fs.rmSync(profileDir, {recursive: true, force: true});}
        catch (error) {report.cleanupErrors.push(`profile removal: ${error.message}`); report.retainedProfile = profileDir;}
      } else report.retainedProfile = profileDir;
    }
    if (report.cleanupErrors.length) {report.ok = false; process.exitCode = 1;}
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
  if (failure) throw failure;
}
main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});

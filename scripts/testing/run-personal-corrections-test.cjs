/**
 * @file scripts/testing/run-personal-corrections-test.cjs
 * 文件职责：在临时 profile 的后台可见生产 Edge 中验证网页个人校订闭环。
 * 主要内容：从默认关闭开始，通过真实设置开关启用、关闭和重启；用可信 CDP 手势翻译、编辑、预览、保存、撤销和删除，检查零消息、精确复用、来源样式与近似句边界，保存 DOM 和截图证据。
 * 模块边界：只访问本次隔离网页、扩展配置端口及后台 fetch 的确定性传输夹具；原生 select 使用标明的 DOM change 夹具，其余产品编辑动作和快捷键使用可信 CDP 输入，不连接用户浏览器或真实凭据。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const arg = (key, fallback) => {const index = process.argv.indexOf('--' + key); return index < 0 ? fallback : process.argv[index + 1];};
const projectRoot = path.resolve(arg('project-root', path.join(__dirname, '../..')));
const extensionDir = path.resolve(arg('extension-dir', path.join(projectRoot, '.output/chrome-mv3')));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-personal-corrections'));
const playwrightRoot = arg('playwright-root');
const helperPath = arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'));
const realUrl = arg('real-url');
if (!playwrightRoot) throw new Error('必须提供 --playwright-root');
if (process.argv.includes('--headed') || process.argv.includes('--headless')) throw new Error('本专项仅支持不抢焦点的 --background 隔离浏览器');
const {chromium} = require(path.join(playwrightRoot, 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(helperPath);
const {startFocusEventMonitor} = require('./mac-focus-event-monitor.cjs');
const {getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
const source = 'The editor keeps the original text beside every translation.';
const similarSource = 'The editor keeps the original text beside each translation.';
const corrected = '编辑器把原文放在每一份译文旁边，便于核对。';
const secondCorrection = '编辑器保留原文与译文的并排关系。';
const editedCorrection = '编辑器保留原文与译文，方便读者逐句比对。';
const projectCorrection = '在校订项目中，编辑器将原文放在每条译文旁边。';
const conflictingCorrection = '另一种已确认译法把原文保留在译文旁边。';
const automaticPrefix = '【自动译文】';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Personal correction fixture</title><style>body{font:18px/1.7 system-ui;max-width:820px;padding:32px;margin:auto;color:#243044;background:#fff}h1{font-size:26px}p{margin:24px 0;padding:14px;border:1px solid #ddd;border-radius:8px}nav{margin-top:32px}</style></head><body><main><h1>Compare wording while reading</h1><p id="primary">${source}</p><p id="neighbor">Readers can compare the wording carefully before accepting a correction.</p><p id="similar">${similarSource}</p><nav><a id="other-material" href="/other-material">Open a different material</a></nav></main></body></html>`;
const report = {success: false, sourceProjectRoot: projectRoot, extensionDir, scope: 'targeted production extension in real Edge; deterministic Google worker transport on synthetic and optional unmodified remote webpages', providerEvidence: 'deterministic-service-worker-fetch-fixture-not-live-provider', profileMode: 'automatically-created-temporary-profile', cases: [], screenshots: [], errors: [], consoleErrors: []};
fs.mkdirSync(artifactsDir, {recursive: true});
const temporaryRoot = fs.realpathSync(os.tmpdir());
const profileDir = fs.mkdtempSync(path.join(temporaryRoot, 'fluentread-personal-corrections-'));
const profileIdentity = fs.lstatSync(profileDir);
const owner = crypto.randomUUID();
fs.writeFileSync(path.join(profileDir, '.owner'), owner, {flag: 'wx'});
const server = http.createServer((request, response) => {response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}); response.end(html);});
let session, context, worker, popup, page, cdp, optionsUrl, focusMonitor, browserPid, focusError, currentCase = 'launch', sequence = 0, launchAttempted = false;
function assertFocusSafe() {
  if (focusError || focusMonitor?.error) throw focusError || focusMonitor.error;
  if (browserPid && focusMonitor?.events.some(event => event.pid === browserPid)) throw new Error('本次测试 Edge 成为前台应用，测试停止');
}
async function wait(test, label, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {assertFocusSafe(); if (await test()) return; await page.waitForTimeout(60);}
  throw new Error(`${currentCase}: ${label} 等待超时`);
}
async function patch(values) {
  await popup.evaluate(async ({values, sequence}) => {
    const {value: current} = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    const response = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: values, expected: Object.fromEntries(Object.keys(values).map(key => [key, current[key]])), clientId: 'personal-corrections-fixture', sequence, baseRevision: current.__fluentConfigRevision || 0});
    if (!response.success) throw new Error(response.error);
  }, {values, sequence: ++sequence});
}
const correctionSetting = () => popup.evaluate(async () => (await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'})).value.personalCorrectionsEnabled);
const correctionMessageCount = () => worker.evaluate(() => globalThis.__correctionMessages.length);
function captureErrors(target, label) {
  target.on('pageerror', error => report.errors.push(`${label}: ${error.message}`));
  target.on('console', message => {if (message.type() === 'error') report.consoleErrors.push(`${label}: ${message.text()}`);});
}
async function openCorrectionSettings() {
  const settings = await newPageWithoutForeground(context); captureErrors(settings, 'options');
  await settings.goto(optionsUrl); await activateExtensionTabWithoutForeground(context, settings);
  await settings.locator('.settings-app').waitFor({state: 'visible'});
  const control = settings.locator('[data-testid="personal-corrections-enabled"]');
  await control.waitFor({state: 'visible'}); await control.scrollIntoViewIfNeeded();
  assert.equal(await settings.locator('#personal-corrections-settings').count(), 1, '设置锚点唯一');
  assert.equal(await settings.getByRole('switch', {name: '个人校订', exact: true}).count(), 1, '个人校订开关有可访问名称');
  return {settings, control};
}
const switchState = control => control.evaluate(element => {
  const semantic = element.matches('[role="switch"]') ? element : element.querySelector('[role="switch"]');
  if (semantic?.getAttribute('aria-checked') !== null && semantic?.getAttribute('aria-checked') !== undefined) return semantic.getAttribute('aria-checked') === 'true';
  const input = element.matches('input') ? element : element.querySelector('input');
  return input ? input.checked : element.classList.contains('is-checked');
});
async function setCorrectionSetting(enabled, {capture = false} = {}) {
  const {settings, control} = await openCorrectionSettings();
  assert.equal(await switchState(control), !enabled, '真实开关从相反状态开始');
  await control.click();
  await wait(async () => await switchState(control) === enabled, '设置开关响应');
  await settings.close(); // 反馈后立即关闭，检查持久化不会被短生命周期页面丢失。
  await wait(async () => await correctionSetting() === enabled, '关闭设置页后后台保存完成');
  const reopened = await openCorrectionSettings();
  assert.equal(await switchState(reopened.control), enabled, '重开设置页保持开关值');
  if (capture) await screenshot(enabled ? 'settings-enabled-reopened' : 'settings-disabled-reopened', reopened.settings);
  await reopened.settings.close();
  await popup.reload(); await popup.locator('.popup-shell[data-config-ready="true"]').waitFor({state: 'visible'});
  assert.equal(await popup.locator('.settings-button').isVisible(), true, 'popup 重开挂载并保留设置入口');
  assert.equal(await correctionSetting(), enabled, '重开 popup 读取相同的已保存开关');
  await activateExtensionTabWithoutForeground(context, page); assertFocusSafe();
  (report.settingsPersistence ||= []).push({value: enabled, trustedClick: true, closedAfterUiFeedback: true, reopenedValue: enabled, popupReloadValue: enabled});
}
async function assertNoCorrectionUi() {
  assert.equal(Boolean(await panel(`return Boolean(this.querySelector('${tid('entry')}')||this.querySelector('${tid('dialog')}'))`)), false, '关闭时没有校订入口或编辑器');
  assert.equal(await page.locator('[data-fr-personal-correction="true"]').count(), 0, '关闭时没有个人来源标记');
}
/** 读取 closed ShadowRoot；只有 chooseFirstProject 标明的原生 select 夹具改变 DOM，其余编辑与按钮动作使用可信 CDP 输入。 */
async function panel(code) {
  const tree = await cdp.send('DOM.getDocument', {depth: -1, pierce: true});
  let host;
  const visit = node => {
    const attrs = node.attributes || [];
    for (let index = 0; index < attrs.length; index += 2) if (attrs[index] === 'id' && attrs[index + 1] === 'fluent-read-personal-corrections') host = node;
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) visit(child);
  };
  visit(tree.root);
  if (!host?.shadowRoots?.[0]) return null;
  const {object} = await cdp.send('DOM.resolveNode', {nodeId: host.shadowRoots[0].nodeId});
  try {
    const result = await cdp.send('Runtime.callFunctionOn', {objectId: object.objectId, functionDeclaration: `function(){${code}}`, returnByValue: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  } finally {await cdp.send('Runtime.releaseObject', {objectId: object.objectId});}
}
const tid = name => `[data-testid="correction-${name}"]`;
async function clickPanel(selector) {
  await wait(() => panel(`const button=this.querySelector(${JSON.stringify(selector)});if(!button||button.disabled)return false;const rect=button.getBoundingClientRect();return rect.width>0&&rect.height>0;`), `可用控件 ${selector}`);
  const point = await panel(`const button=this.querySelector(${JSON.stringify(selector)});if(!button)return null;const rect=button.getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2,width:rect.width,height:rect.height,disabled:Boolean(button.disabled)};`);
  assert.ok(point && point.width && point.height && !point.disabled, `可用且可见的控件 ${selector}`);
  await page.mouse.click(point.x, point.y); assertFocusSafe();
}
async function editTranslation(text) {await clickPanel(tid('translation')); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(text);}
async function chooseFirstProject() {
  // 已验证 macOS 后台原生菜单不接受页面 CDP 选择键。只在这一个原生 select 上使用 DOM change 夹具；仍由 Vue 原生 change 监听与公开服务处理，后续显式加入、保存和移出均真实点击。
  report.scopeSelectionInput = 'native-select DOM change fixture; macOS background native menu cannot receive ordinary page CDP selection keys';
  const selected = await panel(`const select=this.querySelector('${tid('scope')}');const option=[...select.options].find(item=>item.value!=='material');if(!option)return null;select.value=option.value;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));return option.value;`);
  assert.ok(selected, '已有项目范围选项');
  await wait(() => panel(`return this.querySelector('${tid('scope')}').value!=='material'`), '显式选择项目范围');
}
async function hoverTranslation(selector = '#primary') {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = await page.locator(selector + ' .fluent-read-bilingual-content').boundingBox();
  assert.ok(box, '译文可见');
  await page.mouse.move(box.x + Math.min(20, box.width / 2), box.y + Math.min(10, box.height / 2), {steps: 4});
  await wait(() => panel(`const entry=this.querySelector('${tid('entry')}');return Boolean(entry&&entry.getBoundingClientRect().width);`), '显示校订入口');
}
async function openEditor(selector = '#primary') {await hoverTranslation(selector); await clickPanel(tid('entry')); await wait(() => panel(`return Boolean(this.querySelector('${tid('dialog')}'))`), '校订编辑器'); await wait(() => panel(`return this.querySelector('${tid('preview')}')?.disabled===false`), '读取校订记忆完成');}
async function closeEditor() {if (await panel(`return Boolean(this.querySelector('${tid('close')}'))`)) await clickPanel(tid('close'));}
async function toggle(selector = '#primary', expectedCount = 1) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + 12, box.y + 12, {steps: 4}); await page.mouse.click(box.x + 12, box.y + 12);
  await page.keyboard.down('Control'); await page.keyboard.up('Control');
  await wait(async () => await page.locator(selector + ' .fluent-read-bilingual-content').count() === expectedCount, `${selector} 译文数 ${expectedCount}`);
  assert.equal(await page.locator('#neighbor .fluent-read-bilingual-content').count(), 0, '相邻段落不翻译');
}
const translation = (selector = '#primary') => page.evaluate(target => document.querySelector(target + ' .fluent-read-bilingual-content')?.innerText || '', selector);
const personalProvenance = (selector = '#primary') => page.evaluate(target => document.querySelector(target + ' .fluent-read-bilingual-content')?.getAttribute('data-fr-personal-correction') || null, selector);
async function ensureOriginal(selector = '#primary') {if (await page.locator(selector + ' .fluent-read-bilingual-content').count()) await toggle(selector, 0);}
const providerCount = () => worker.evaluate(() => globalThis.__correctionFixture.requests.length);
async function clearPublicCache() {const response = await popup.evaluate(() => chrome.runtime.sendMessage({type: 'clearTranslationCache'})); assert.equal(response.success, true); await page.waitForTimeout(180);}
async function screenshot(name, target = page) {const file = path.join(artifactsDir, `${String(report.screenshots.length + 1).padStart(2, '0')}-${name}.png`); await target.screenshot({path: file}); report.screenshots.push(file);}
function record(name, evidence = {}) {report.cases.push({name, ...evidence}); console.log(JSON.stringify({case: name, outcome: 'passed'}));}
async function previewSave(text, expectedSource = source, targetSelector = '#primary') {
  await editTranslation(text);
  assert.equal(await panel(`return this.querySelector('${tid('save')}')?.disabled`), true, '修改后必须先预览');
  await clickPanel(tid('preview'));
  await wait(() => panel(`return this.querySelector('${tid('save')}')?.disabled===false`), '预览解锁保存');
  report.previewText = await panel('return this.textContent');
  assert.ok(report.previewText.includes(expectedSource), '预览包含受影响的原文');
  assert.ok(report.previewText.includes(text), '预览包含确认译法');
  await screenshot('02-preview'); await clickPanel(tid('save'));
  await wait(async () => (await translation(targetSelector)).includes(text), '保存后采用个人校订');
}
async function discoverRealParagraph() {
  const requested = arg('real-selector');
  if (requested) return {selector: requested, mode: 'explicit-selector'};
  const candidate = await page.evaluate(() => {
    const element = [...document.querySelectorAll('p')].find(paragraph => {
      const text = paragraph.textContent?.trim() || '';
      return text.length > 40 && /[A-Za-z]{5}/.test(text) && !/[\p{Script=Han}\p{Script=Arabic}\p{Script=Cyrillic}]/u.test(text);
    });
    if (!element) return null;
    const parts = [];
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      const sameTag = node.parentElement ? [...node.parentElement.children].filter(sibling => sibling.localName === node.localName) : [node];
      parts.unshift(`${node.localName}:nth-of-type(${sameTag.indexOf(node) + 1})`);
    }
    return {selector: parts.join(' > '), source: element.textContent.trim()};
  });
  assert.ok(candidate, '真实网页包含外语正文');
  return {...candidate, mode: 'read-only-English-paragraph-discovery'};
}
async function main() {
  report.buildFreshness = assertFreshProductionExtension(extensionDir, projectRoot);
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  const runtimeFiles = [...new Set([manifest.background?.service_worker, ...(manifest.content_scripts || []).flatMap(entry => entry.js || [])].filter(Boolean))].sort();
  report.buildArtifactHashes = Object.fromEntries(runtimeFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir, file))).digest('hex')]));
  const stylesheets = [...new Set([...(manifest.content_scripts || []).flatMap(entry => entry.css || []), ...(manifest.web_accessible_resources || []).flatMap(entry => entry.resources || []).filter(file => file.endsWith('.css'))])].filter(file => fs.existsSync(path.join(extensionDir, file))).sort();
  report.buildStylesheetHashes = Object.fromEntries(stylesheets.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir, file))).digest('hex')]));
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  focusMonitor = startFocusEventMonitor({onEvent: event => {if (browserPid && event.pid === browserPid) focusError = new Error('隔离 Edge 成为前台应用');}, onError: error => {focusError = error;}});
  await focusMonitor.ready; launchAttempted = true;
  session = await launchFocusSafePersistentContext({chromium, profileDir, browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'), background: true, headless: false, displayTarget: arg('display', 'secondary'), browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'], viewport: {width: 1280, height: 900}, timeout: 30000});
  Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
  assert.equal(report.launchMode, 'macos-background-cdp'); assert.equal(report.focusPolicy, 'launchservices-no-foreground'); assert.equal(report.windowPlacement.mode, 'background-visible-no-focus'); assert.equal(report.windowPlacement.browserFrontmost, false);
  browserPid = await getGuardedBrowserPid(session); assert.ok(browserPid); assertFocusSafe(); context = session.context;
  worker = context.serviceWorkers().find(candidate => candidate.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    globalThis.__correctionMessages = []; globalThis.__correctionSettingsWrites = [];
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === 'fluentReadPersonalCorrections') globalThis.__correctionMessages.push({action: message.action});
      const writes = message?.type === 'persistConfig' ? [message] : message?.type === 'persistConfigBatch' ? message.patches || [] : [];
      for (const write of writes) if (Object.hasOwn(write.config || {}, 'personalCorrectionsEnabled')) globalThis.__correctionSettingsWrites.push({messageType: message.type, enabled: write.config.personalCorrectionsEnabled});
      return false;
    });
  });
  const extensionBase = `chrome-extension://${new URL(worker.url()).host}/`;
  const optionsPath = manifest.options_ui?.page || manifest.options_page;
  assert.ok(optionsPath && fs.existsSync(path.join(extensionDir, optionsPath)), '清单提供实际设置页');
  optionsUrl = `${extensionBase}${optionsPath}?target=personal-corrections-settings#settings-translation`;
  report.settingsPage = {manifestPath: optionsPath, section: 'settings-translation', panel: 'reading', anchor: 'personal-corrections-settings', toggle: '[data-testid="personal-corrections-enabled"]', activation: 'trusted actual options switch clicks, never a configuration patch'};
  popup = await newPageWithoutForeground(context); captureErrors(popup, 'popup'); await popup.goto(extensionBase + manifest.action.default_popup);
  await patch({on: true, service: 'google', from: 'en', to: 'zh-Hans', display: 1, disableFloatingBall: true, disableSelectionTranslator: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true});
  assert.equal(await correctionSetting(), false, '新临时 profile 默认关闭个人校订');
  await worker.evaluate(prefix => {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.__correctionFixture = {requests: []};
    const translate = (origin, from, to) => {
      globalThis.__correctionFixture.requests.push({origin, from, to});
      return origin.split(/(___FLUENTREAD_[A-Za-z0-9]+_\d+_(?:BEGIN|END)___)/).map(part => part.startsWith('___FLUENTREAD_') || !part.trim() ? part : prefix + part).join('');
    };
    globalThis.fetch = async (input, options) => {
      const url = String(typeof input === 'string' ? input : input.url || input);
      if (url.includes('/v1/translateHtml')) {const [texts, from, to] = JSON.parse(options.body)[0]; return new Response(JSON.stringify([texts.map(text => `<pre>${translate(text.replace(/^<pre>|<\/pre>$/g, ''), from, to)}</pre>`)]), {status: 200});}
      if (url.includes('/translate_a/t')) {const parsed = new URL(url), body = new URLSearchParams(options.body); return new Response(JSON.stringify(body.getAll('q').map(text => translate(text, parsed.searchParams.get('sl'), parsed.searchParams.get('tl')))), {status: 200});}
      if (url.includes('/_/TranslateWebserverUi/data/batchexecute')) {
        const records = JSON.parse(new URLSearchParams(options.body).get('f.req'))[0].map(rpc => {const [origin, from, to] = JSON.parse(rpc[1])[0]; const entry = [null, null, null, null, null, [[translate(origin, from, to)]]]; return ['wrb.fr', 'MkEWBc', JSON.stringify([null, [[entry]]]), null, null, null, rpc[3]];});
        return new Response(JSON.stringify(records), {status: 200});
      }
      return original(input, options);
    };
  }, automaticPrefix);
  page = await newPageWithoutForeground(context); captureErrors(page, 'webpage');
  await page.goto(`http://127.0.0.1:${server.address().port}/material`); cdp = await context.newCDPSession(page); await activateExtensionTabWithoutForeground(context, page);
  await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
  currentCase = 'default off translates normally with zero correction messages or entry';
  await toggle(); assert.ok((await translation()).includes(automaticPrefix));
  const disabledBox = await page.locator('#primary .fluent-read-bilingual-content').boundingBox();
  await page.mouse.move(disabledBox.x + 12, disabledBox.y + 8); await page.keyboard.press('Alt+Shift+E');
  await page.waitForTimeout(180); await assertNoCorrectionUi();
  await ensureOriginal(); await page.locator('h1').click(); await page.keyboard.press('Alt+T');
  await wait(async () => await page.locator('#neighbor .fluent-read-bilingual-content').count() === 1, '关闭校订时全文仍正常翻译');
  await assertNoCorrectionUi(); await page.keyboard.press('Alt+T');
  await wait(async () => await page.locator('.fluent-read-bilingual-content').count() === 0, '默认关闭时全文恢复');
  assert.equal(await correctionMessageCount(), 0, '默认关闭时不查询或读取个人校订');
  report.defaultOff = {config: false, personalMessages: 0, hoverEntry: false, shortcutEditor: false, paragraphAndFullpageTranslateNormally: true};
  record(currentCase, report.defaultOff);

  currentCase = 'actual settings switch enables correction and persists after quick close';
  const beforeEnableProvider = await providerCount();
  await setCorrectionSetting(true, {capture: true});
  assert.equal(await providerCount(), beforeEnableProvider, '启用校订本身不请求供应商');
  record(currentCase, {default: false, enabledAfterReopen: true});

  currentCase = 'trusted paragraph translation and preview-gated material correction';
  await toggle(); assert.ok((await translation()).includes(automaticPrefix)); assert.ok(await providerCount() > 0); await screenshot('01-automatic');
  await openEditor(); assert.equal(await panel(`return this.querySelectorAll('${tid('dialog')}').length`), 1);
  assert.equal(await panel(`return this.querySelector('${tid('scope')}').selectedOptions[0].textContent.trim()`), '仅当前网页', '范围默认文案通俗明确');
  await previewSave(corrected); await screenshot('03-saved'); record(currentCase);

  currentCase = 'turning off closes the live editor and restores the provider baseline';
  const beforeDisableProvider = await providerCount();
  await setCorrectionSetting(false, {capture: true});
  await wait(async () => (await translation()).includes(automaticPrefix) && !(await translation()).includes(corrected), '关闭后回到服务底稿');
  await assertNoCorrectionUi(); assert.equal(await providerCount(), beforeDisableProvider, '关闭不重新请求服务');
  await setCorrectionSetting(true); await page.waitForTimeout(180);
  assert.ok((await translation()).includes(automaticPrefix) && !(await translation()).includes(corrected), '重新启用不自动采用记录');
  assert.equal(await providerCount(), beforeDisableProvider, '重新启用只补齐 metadata');
  record(currentCase, {editorRemoved: true, restored: 'provider-baseline', reenableDoesNotAutoApply: true});

  currentCase = 'material exact reuse bypasses public provider cache';
  await closeEditor(); await toggle('#primary', 0); await clearPublicCache(); const requestsBeforeReuse = await providerCount(); await toggle();
  assert.ok((await translation()).includes(corrected)); assert.equal(await providerCount(), requestsBeforeReuse, '个人校订精确复用不调用供应商');
  report.reuseAttributes = await page.locator('#primary .fluent-read-bilingual-content').evaluate(element => Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value])));
  assert.equal(report.reuseAttributes['data-fr-personal-correction'], 'true');
  const provenance = await page.locator('#primary .fluent-read-bilingual-content').evaluate(element => getComputedStyle(element, '::after').content);
  assert.ok(provenance.includes('个人校订'), '可见来源标记说明采用个人校订');
  report.provenanceAppearance = await page.locator('#primary .fluent-read-bilingual-content').evaluate(element => {
    const label = getComputedStyle(element, '::after'), parent = getComputedStyle(element);
    return {content: label.content, color: label.color, parentColor: parent.color, fontSize: label.fontSize, parentFontSize: parent.fontSize, background: label.backgroundColor, borderWidth: label.borderTopWidth};
  });
  assert.equal(report.provenanceAppearance.color, report.provenanceAppearance.parentColor);
  assert.equal(report.provenanceAppearance.background, 'rgba(0, 0, 0, 0)'); assert.equal(report.provenanceAppearance.borderWidth, '0px');
  assert.ok(parseFloat(report.provenanceAppearance.fontSize) < parseFloat(report.provenanceAppearance.parentFontSize));
  await screenshot('04-reused'); record(currentCase, {providerRequestsAdded: 0, provenance});

  currentCase = 'turning off a reused correction restores original and reenable retains the record';
  await openEditor(); await setCorrectionSetting(false);
  await wait(async () => await page.locator('#primary .fluent-read-bilingual-content').count() === 0, '无服务底稿的复用关闭后恢复原文');
  await assertNoCorrectionUi();
  const beforeDisabledMessages = await correctionMessageCount(); await clearPublicCache(); await toggle();
  assert.ok((await translation()).includes(automaticPrefix)); await assertNoCorrectionUi();
  assert.equal(await correctionMessageCount(), beforeDisabledMessages, '关闭后再次翻译不查询个人记录');
  const beforeReenableProvider = await providerCount(); await setCorrectionSetting(true); await page.waitForTimeout(180);
  assert.ok((await translation()).includes(automaticPrefix), '重新开启不替换现有服务译文');
  assert.equal(await providerCount(), beforeReenableProvider, '重新开启不发起翻译');
  await ensureOriginal(); await clearPublicCache(); const beforeRetainedReuse = await providerCount(); await toggle();
  assert.ok((await translation()).includes(corrected)); assert.equal(await providerCount(), beforeRetainedReuse, '重新开启后已存记录继续精确复用');
  await openEditor(); await clickPanel(tid('manage')); assert.equal(await panel('return this.querySelectorAll("[data-correction-record]").length'), 1, '关闭和重启保留记录且不新增');
  await closeEditor(); record(currentCase, {restored: 'original', messagesAddedWhileOff: 0, retainedEntries: 1, providerRequestsAddedDuringReenabledReuse: 0});

  currentCase = 'nearby sentence exposes a reviewable suggestion without automatic replacement';
  await toggle('#similar'); assert.ok((await translation('#similar')).includes(automaticPrefix)); assert.ok(!(await translation('#similar')).includes(corrected));
  assert.equal(await page.locator('#similar .fluent-read-bilingual-content').getAttribute('data-fr-personal-correction'), null);
  await openEditor('#similar'); await wait(() => panel('return Boolean(this.querySelector(".suggestions"))'), '近似原句建议');
  const suggestions = await panel('return this.querySelector(".suggestions").textContent');
  assert.ok(suggestions.includes(source) && suggestions.includes(similarSource) && suggestions.includes(corrected));
  assert.ok(suggestions.includes('已保存的原句'), '近似建议文案通俗明确');
  assert.equal(await panel(`return this.querySelector('${tid('save')}').disabled`), true);
  await clickPanel('.suggestions > summary'); await clickPanel('.suggestions button');
  assert.equal(await panel(`return this.querySelector('${tid('translation')}').value`), corrected);
  assert.equal(await panel(`return this.querySelector('${tid('save')}').disabled`), true, '近似建议进入草稿仍需预览确认');
  assert.ok((await translation('#similar')).includes(automaticPrefix), '未确认草稿不改变网页译文');
  await screenshot('04-nearby-suggestion'); await closeEditor(); record(currentCase);

  currentCase = 'undo invalidates reuse and restores provider output';
  // off/on 会卸载编辑会话，旧会话的撤销 token 不再可用。用真实管理删除及新建保存建立本会话的撤销点。
  await openEditor(); await clickPanel(tid('manage'));
  const priorDelete = await panel('const button=this.querySelector("[data-correction-delete]");return button?`[data-correction-delete="${button.getAttribute("data-correction-delete")}"]`:null');
  await clickPanel(priorDelete); await wait(() => panel('return this.querySelectorAll("[data-correction-delete]").length===0'), '建立独立撤销用例前清除旧记录');
  await closeEditor(); await ensureOriginal(); await clearPublicCache(); await toggle(); await openEditor(); await previewSave(corrected); await closeEditor();
  await openEditor(); await clickPanel(tid('undo')); await wait(async () => await page.locator('#primary .fluent-read-bilingual-content').count() === 0 || !(await translation()).includes(corrected), '撤销恢复原译文或原文');
  await closeEditor(); await ensureOriginal(); await clearPublicCache(); await toggle(); assert.ok((await translation()).includes(automaticPrefix)); assert.ok(!(await translation()).includes(corrected)); record(currentCase);

  currentCase = 'management edit invalidates the old personal wording';
  await openEditor(); await previewSave(secondCorrection); await clickPanel(tid('manage'));
  await wait(() => panel('return this.querySelectorAll("[data-correction-edit]").length>0'), '校订管理列表');
  const editSelector = await panel('const button=this.querySelector("[data-correction-edit]");return button?`[data-correction-edit="${button.getAttribute("data-correction-edit")}"]`:null');
  await clickPanel(editSelector); await previewSave(editedCorrection); await closeEditor(); await ensureOriginal(); await clearPublicCache(); await toggle();
  assert.ok((await translation()).includes(editedCorrection)); assert.ok(!(await translation()).includes(secondCorrection)); record(currentCase);

  currentCase = 'material scope does not leak the same sentence into a different webpage';
  const materialUrl = page.url(); await page.goto(`http://127.0.0.1:${server.address().port}/other-material`); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'}); await toggle();
  assert.ok((await translation()).includes(automaticPrefix)); assert.ok(!(await translation()).includes(editedCorrection));
  assert.equal(await page.locator('#primary .fluent-read-bilingual-content').getAttribute('data-fr-personal-correction'), null);
  await page.goto(materialUrl); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'}); await toggle(); assert.ok((await translation()).includes(editedCorrection)); record(currentCase);

  currentCase = 'delete invalidates a confirmed correction';
  await openEditor(); await clickPanel(tid('manage'));
  await wait(() => panel('return this.querySelectorAll("[data-correction-delete]").length>0'), '校订管理列表');
  const deleteSelector = await panel('const button=this.querySelector("[data-correction-delete]");return button?`[data-correction-delete="${button.getAttribute("data-correction-delete")}"]`:null');
  await clickPanel(deleteSelector); await wait(() => panel('return this.querySelectorAll("[data-correction-delete]").length===0'), '删除记忆');
  await closeEditor(); await ensureOriginal(); await clearPublicCache(); await toggle(); assert.ok((await translation()).includes(automaticPrefix)); assert.ok(!(await translation()).includes(editedCorrection)); record(currentCase); await screenshot('05-deleted');

  currentCase = 'repeated editor triggers retain one isolated dialog';
  await openEditor(); await page.keyboard.press('Escape'); await openEditor(); assert.equal(await panel(`return this.querySelectorAll('${tid('dialog')}').length`), 1); await closeEditor();
  assert.equal(await page.locator('#primary .fluent-read-bilingual-content').count(), 1); assert.equal(await page.locator('#fluent-read-personal-corrections').count(), 1); record(currentCase);

  currentCase = 'project reuse requires explicit material membership and leaving invalidates it';
  await openEditor(); await clickPanel('.new-project > summary'); await clickPanel(tid('project-name')); await page.keyboard.insertText('校订浏览器测试项目'); await clickPanel(tid('project-create'));
  await wait(() => panel(`return Boolean(this.querySelector('${tid('project-join')}'))`), '新建项目需要明确加入');
  await clickPanel(tid('project-join')); await wait(() => panel(`return Boolean(this.querySelector('${tid('project-leave')}'))`), '当前材料已加入项目');
  await previewSave(projectCorrection); await closeEditor(); await ensureOriginal(); await clearPublicCache(); const beforeProjectReuse = await providerCount(); await toggle(); assert.ok((await translation()).includes(projectCorrection)); assert.equal(await providerCount(), beforeProjectReuse);
  await page.goto(`http://127.0.0.1:${server.address().port}/project-material`); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'}); await toggle();
  assert.ok((await translation()).includes(automaticPrefix), '其他材料尚未加入项目');
  await openEditor(); await chooseFirstProject(); await clickPanel(tid('project-join'));
  await wait(async () => (await translation()).includes(projectCorrection), '主动加入后采用项目译法');
  await clickPanel(tid('manage')); const projectEntryCount = await panel('return this.querySelectorAll("[data-correction-record]").length'); assert.equal(projectEntryCount, 1, '加入项目不自动采集译法');
  await closeEditor(); await ensureOriginal(); await clearPublicCache(); const beforeMemberReuse = await providerCount(); await toggle(); assert.ok((await translation()).includes(projectCorrection)); assert.equal(await providerCount(), beforeMemberReuse);
  await openEditor(); await clickPanel(tid('project-leave')); await wait(async () => await page.locator('#primary .fluent-read-bilingual-content').count() === 0 || !(await translation()).includes(projectCorrection), '移出项目使复用失效');
  await closeEditor(); await ensureOriginal(); await clearPublicCache(); await toggle(); assert.ok((await translation()).includes(automaticPrefix)); record(currentCase, {projectEntries: projectEntryCount, providerRequestsAddedDuringReuse: 0}); await screenshot('06-project-boundary');

  currentCase = 'source and target language isolate project corrections';
  await page.goto(materialUrl); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'}); await toggle(); assert.ok((await translation()).includes(projectCorrection));
  await patch({to: 'ja'}); await page.reload(); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'}); await toggle(); assert.ok((await translation()).includes(automaticPrefix)); assert.ok(!(await translation()).includes(projectCorrection));
  await patch({to: 'zh-Hans', from: 'fr'}); await page.reload(); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'}); await toggle(); assert.ok((await translation()).includes(automaticPrefix)); assert.ok(!(await translation()).includes(projectCorrection));
  await patch({from: 'en'}); await page.reload(); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'}); await toggle(); assert.ok((await translation()).includes(projectCorrection)); record(currentCase);

  currentCase = 'heading change invalidates an already visible personal result';
  await page.locator('h1').evaluate(element => {element.textContent = 'A different editor and document context';});
  await wait(async () => await personalProvenance() !== 'true', '标题语境变化撤下个人来源');
  if (await page.locator('#primary .fluent-read-bilingual-content').count()) assert.ok(!(await translation()).includes(projectCorrection));
  await ensureOriginal(); await toggle(); assert.ok((await translation()).includes(automaticPrefix)); assert.ok(!(await translation()).includes(projectCorrection)); record(currentCase);

  currentCase = 'SPA material change invalidates the same mounted personal paragraph';
  await ensureOriginal(); await page.locator('h1').evaluate(element => {element.textContent = 'Compare wording while reading';}); await toggle(); assert.ok((await translation()).includes(projectCorrection));
  await page.evaluate(() => {window.__correctionMountedParagraph = document.querySelector('#primary'); history.pushState({}, '', '/spa-other-material');});
  await wait(async () => await personalProvenance() !== 'true', 'SPA 材料变化撤下个人来源');
  assert.equal(await page.evaluate(() => document.querySelector('#primary') === window.__correctionMountedParagraph), true, 'SPA 场景保留同一宿主段落');
  await ensureOriginal(); await toggle(); assert.ok((await translation()).includes(automaticPrefix)); assert.ok(!(await translation()).includes(projectCorrection));
  await ensureOriginal(); await page.evaluate(url => history.pushState({}, '', url), materialUrl); await toggle(); assert.ok((await translation()).includes(projectCorrection)); record(currentCase);

  currentCase = 'conflicting confirmed wordings require explicit resolution';
  await ensureOriginal(); await page.locator('h1').evaluate(element => {element.textContent = 'Compare wording while reading';}); await toggle(); assert.ok((await translation()).includes(projectCorrection));
  await openEditor(); await editTranslation(conflictingCorrection); await clickPanel(tid('preview')); await clickPanel(tid('save'));
  await wait(() => panel('return this.querySelectorAll(".conflict button").length===2'), '冲突译法要求审阅'); await closeEditor();
  await ensureOriginal(); await clearPublicCache(); await toggle(); assert.ok((await translation()).includes(automaticPrefix)); assert.equal(await page.locator('#primary .fluent-read-bilingual-content').getAttribute('data-fr-personal-correction'), null, '冲突不自动采用个人译法');
  await openEditor(); await wait(() => panel('return this.querySelectorAll(".conflict button").length===2'), '冲突译法选择'); await clickPanel('.conflict button:first-of-type'); await previewSave(conflictingCorrection); await closeEditor();
  await ensureOriginal(); await clearPublicCache(); await toggle(); assert.ok((await translation()).includes(conflictingCorrection)); record(currentCase); await screenshot('06-conflict-resolved');

  currentCase = 'narrow editor fits viewport and closes by Escape';
  await page.setViewportSize({width: 390, height: 844}); await openEditor();
  const narrowGeometry = await panel(`const box=this.querySelector('${tid('dialog')}').getBoundingClientRect();return{x:box.x,y:box.y,right:box.right,bottom:box.bottom,width:box.width,height:box.height,viewportWidth:innerWidth,viewportHeight:innerHeight}`);
  assert.ok(narrowGeometry.x >= 0 && narrowGeometry.y >= 0 && narrowGeometry.right <= narrowGeometry.viewportWidth && narrowGeometry.bottom <= narrowGeometry.viewportHeight, JSON.stringify(narrowGeometry));
  await screenshot('07-narrow-editor'); await page.keyboard.press('Escape'); await wait(() => panel(`return !this.querySelector('${tid('dialog')}')`), 'Escape 关闭窄屏编辑器');
  await page.locator('#primary').scrollIntoViewIfNeeded();
  report.narrowProvenance = await page.evaluate(() => ({viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, content: getComputedStyle(document.querySelector('#primary .fluent-read-bilingual-content'), '::after').content}));
  assert.equal(report.narrowProvenance.content.includes('个人校订'), true); assert.ok(report.narrowProvenance.documentWidth <= report.narrowProvenance.viewport, '390像素来源不造成水平溢出');
  await screenshot('07-narrow-provenance'); record(currentCase, {...narrowGeometry, provenanceFits: true}); await page.setViewportSize({width: 1280, height: 900});

  currentCase = 'fullpage heading translation preserves original context and paragraph editing';
  await ensureOriginal(); await page.locator('h1').click(); await page.keyboard.press('Alt+T');
  await wait(async () => await page.locator('h1 .fluent-read-bilingual-content').count() === 1 && await page.locator('#neighbor .fluent-read-bilingual-content').count() === 1 && await page.locator('#primary .fluent-read-bilingual-content').count() === 1, '全文翻译包含标题与正文');
  assert.ok((await translation()).includes(conflictingCorrection), '标题译文不改变原文语境匹配');
  await openEditor(); assert.equal(await panel(`return this.querySelector('${tid('source')}').textContent`), source); await closeEditor(); await screenshot('08-fullpage-context');
  await page.locator('h1').click(); await page.keyboard.press('Alt+T'); await wait(async () => await page.locator('.fluent-read-bilingual-content').count() === 0, '全文恢复原文');
  await page.keyboard.press('Alt+T'); await wait(async () => await page.locator('#primary .fluent-read-bilingual-content').count() === 1, '全文再次翻译'); assert.ok((await translation()).includes(conflictingCorrection)); record(currentCase);
  report.publicCacheIsolation = await worker.evaluate(async forbidden => {
    await new Promise(resolve => setTimeout(resolve, 160));
    const records = await new Promise((resolve, reject) => {
      const request = indexedDB.open('FluentReadTranslationCache');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('entries')) {database.close(); resolve([]); return;}
        const read = database.transaction('entries', 'readonly').objectStore('entries').getAll();
        read.onerror = () => {database.close(); reject(read.error);};
        read.onsuccess = () => {database.close(); resolve(read.result);};
      };
    });
    return {records: records.length, containsPersonalText: forbidden.some(text => records.some(record => JSON.stringify(record).includes(text)))};
  }, [corrected, secondCorrection, editedCorrection, projectCorrection, conflictingCorrection]);
  assert.equal(report.publicCacheIsolation.containsPersonalText, false, '个人校订结果没有写入公共 provider 缓存');
  report.providerRequests = await worker.evaluate(() => globalThis.__correctionFixture.requests);
  report.settingsPersistenceRequests = await worker.evaluate(() => globalThis.__correctionSettingsWrites);
  assert.ok(report.settingsPersistenceRequests.some(request => request.enabled === false) && report.settingsPersistenceRequests.some(request => request.enabled === true), '实际设置页发出开启及关闭保存请求');
  report.finalDom = await page.evaluate(() => ({url: location.href, primaryHtml: document.querySelector('#primary').outerHTML, neighborHtml: document.querySelector('#neighbor').outerHTML, correctionHosts: document.querySelectorAll('#fluent-read-personal-corrections').length}));
  if (realUrl) {
    currentCase = 'real external webpage edit-save-reuse-undo with deterministic provider transport';
    report.realWebpage = {url: realUrl, source: 'unmodified remote webpage DOM', translationTransport: 'deterministic Google service-worker fixture, not live service quality'};
    await page.goto(realUrl, {waitUntil: 'domcontentloaded', timeout: 30000}); await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
    const discovered = await discoverRealParagraph(); report.realWebpage.selectorDiscovery = discovered;
    const target = discovered.selector; const remoteSource = await page.locator(target).innerText(); const remoteCorrection = '此域名用于文档示例，无需事先许可。它不是服务，请避免将它用于测试或监控。';
    assert.ok(remoteSource.trim().length > 30, '真实网页包含可校订的原句');
    await toggle(target); await openEditor(target); await previewSave(remoteCorrection, remoteSource, target); await screenshot('08-real-webpage-saved'); await closeEditor();
    await ensureOriginal(target); await clearPublicCache(); const beforeRemoteReuse = await providerCount(); await toggle(target); assert.ok((await translation(target)).includes(remoteCorrection)); assert.equal(await providerCount(), beforeRemoteReuse);
    await openEditor(target); await clickPanel(tid('undo')); await wait(async () => await page.locator(target + ' .fluent-read-bilingual-content').count() === 0 || !(await translation(target)).includes(remoteCorrection), '真实网页撤销使个人译文失效'); await closeEditor();
    await ensureOriginal(target); await clearPublicCache(); await toggle(target); assert.ok((await translation(target)).includes(automaticPrefix));
    report.realWebpage.providerRequestsAddedDuringReuse = 0; record(currentCase); await screenshot('09-real-webpage-undone');
  }
  assert.deepEqual(report.errors, []); assertFocusSafe(); report.success = true;
}
main().catch(async error => {report.failure = {case: currentCase, message: error.stack || String(error)}; process.exitCode = 1; if (page && !page.isClosed()) {await screenshot('failure').catch(() => {}); report.failurePanel = await panel('return this.innerHTML').catch(() => null);}}).finally(async () => {
  let closed = !launchAttempted;
  try {if (session) {await session.close(); closed = true;}} catch (error) {report.cleanupError = error.message; process.exitCode = 1; report.success = false;}
  if (focusMonitor) {try {await focusMonitor.stop(); report.focusEvents = {monitoring: 'native macOS activation events throughout the test', browserActivations: focusMonitor.events.filter(event => event.pid === browserPid).length, observerClosed: true}; assertFocusSafe();} catch (error) {report.focusError = error.message; report.success = false; process.exitCode = 1;}}
  await new Promise(resolve => {server.close(resolve); server.closeAllConnections();});
  if (closed) {const stat = fs.lstatSync(profileDir); assert.ok(!stat.isSymbolicLink() && stat.ino === profileIdentity.ino && stat.dev === profileIdentity.dev); assert.equal(fs.readFileSync(path.join(profileDir, '.owner'), 'utf8'), owner); fs.rmSync(profileDir, {recursive: true}); report.profileRemoved = true;} else report.retainedProfile = profileDir;
  fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({success: report.success, cases: report.cases.length, artifactsDir, failure: report.failure, cleanupError: report.cleanupError, focusEvents: report.focusEvents}));
});

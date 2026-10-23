#!/usr/bin/env node
'use strict';

/**
 * @file scripts/testing/run-storybook-controls-test.cjs
 * 文件职责：在隔离真实浏览器中验证已构建 Storybook 的生产控件与设置组合。
 * 主要内容：核对构建 index.json 的真实 story ID，在仅本机 HTTP 的 /storybook/ 子路径运行默认、乌金和紧凑皮肤的亮暗及宽窄矩阵，验证开关尺寸、鼠标切换、Tab 焦点、数字输入、帮助提示和折叠表单保留；输出四张代表截图。
 * 模块边界：不启动构建、不修改生产源码或页面 DOM；扩展可选，仅用于安全激活 helper 首 tab。临时 profile、第二屏不抢焦点、owned close 和本机 HTTP 服务全部由当前运行负责清理。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {guardBrowserClose, getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const arg = (name, fallback) => {const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1];};
const timeout = Number(arg('timeout', '30000'));
const storybookDir = path.resolve(arg('storybook-dir', 'docs/.vitepress/dist/storybook'));
const extensionArg = arg('extension-dir', '.output/chrome-mv3');
const extensionDir = extensionArg === 'none' ? null : path.resolve(extensionArg);
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-storybook-controls'));
const helperPath = path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs')));
const playwrightRoot = arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const browserPath = arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {if (await check()) return; await pause(50);}
  throw new Error(`Timeout: ${label}`);
}
const within = (base, target) => {const relative = path.relative(base, target); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);};
async function serveArtifact(directory, errors) {
  const root = fs.realpathSync(directory);
  const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm'};
  const server = http.createServer((request, response) => {
    try {
      assert(['GET', 'HEAD'].includes(request.method), 'Only static read requests allowed');
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/favicon.ico') {response.writeHead(204); response.end(); return;}
      assert(pathname.startsWith('/storybook/'), 'Only the Storybook artifact subtree is served');
      const file = path.resolve(root, pathname.slice('/storybook/'.length) || 'index.html');
      assert(within(root, file) && within(root, fs.realpathSync(file)) && fs.statSync(file).isFile(), 'Artifact file missing or outside the static root');
      response.writeHead(200, {'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store'});
      if (request.method === 'HEAD') response.end();
      else fs.createReadStream(file).on('error', error => {errors.push({url: request.url, message: error.message}); response.destroy(error);}).pipe(response);
    } catch (error) {errors.push({url: request.url, message: error.message}); response.writeHead(404, {'content-type': 'text/plain'}); response.end('Artifact not found');}
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return {origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => {server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections?.();})};
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write('Built Storybook controls: --storybook-dir PATH --extension-dir PATH|none --artifacts-dir PATH --playwright-root PATH --focus-safe-helper PATH --browser-path PATH --display secondary --timeout 30000\n'); return;
  }
  assert.equal(process.platform, 'darwin');
  assert(!process.argv.includes('--headed') && !process.argv.includes('--headless'), 'Only visible background mode');
  assert(Number.isFinite(timeout) && timeout > 0 && timeout <= 60000);
  const index = JSON.parse(fs.readFileSync(path.join(storybookDir, 'index.json'), 'utf8'));
  const stories = {controls: 'ui-controls--interactive', settings: 'examples-settings--reading'};
  for (const [kind, id] of Object.entries(stories)) {
    const entry = index.entries?.[id]; assert.equal(entry?.type, 'story', `Built index missing ${id}`);
    assert.equal(entry.title, kind === 'controls' ? 'UI/Controls' : 'Examples/Settings');
  }
  assert(fs.statSync(path.join(storybookDir, 'iframe.html')).isFile());
  const manifest = extensionDir ? JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8')) : null;
  if (manifest) {assert(!path.basename(extensionDir).endsWith('-dev')); assert(manifest.background?.service_worker, 'Production MV3 helper extension required');}
  const helper = require(helperPath), {chromium} = require(path.join(playwrightRoot, 'playwright'));
  for (const name of ['launchFocusSafePersistentContext', 'queryMacFrontmostApplication']) assert.equal(typeof helper[name], 'function');
  if (extensionDir) assert.equal(typeof helper.activateExtensionTabWithoutForeground, 'function');
  fs.mkdirSync(artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-storybook-controls-')), reportPath = path.join(artifactsDir, 'report.json');
  const report = {ok: false, artifact: 'built-storybook', storybookDir, extensionDir, profileDir, browserPath, stories, startedAt: new Date().toISOString(),
    singlePageReuse: true, pageNavigations: 0, cases: [], switchMetrics: [], layouts: [], cardStyles: [], keyboardFocus: [], screenshots: [], focusSamples: [], additionalPages: [], consoleErrors: [], remoteRequests: [], serverErrors: [],
    evidenceBoundary: 'Built Storybook iframe at a loopback-only HTTP server in one owned background Chromium tab. Production Vue controls and CSS are real; Storybook state is preview-local and i18n uses its declared preview port. No extension settings persistence, provider, production website, Firefox or real-device claim. Optional extension is used only to activate the owned tab safely; without it the helper-created background tab is rendered directly.'};
  let fixture, session, context, page, browserPid, launchAttempted = false, focusViolation = false, primaryError, currentCase = 'launch';
  const save = () => fs.writeFileSync(reportPath, JSON.stringify({...report, currentCase}, null, 2));
  async function focus(label) {
    const app = await helper.queryMacFrontmostApplication(); report.focusSamples.push({label, application: app, ownedPid: browserPid, at: new Date().toISOString()});
    if (!app?.pid || !browserPid || app.pid === browserPid) {focusViolation = true; throw new Error(`${label}: foreground identity missing or owned browser took focus`);}
  }
  function clean(label) {
    assert.deepEqual(report.consoleErrors, [], `${label}: console/page error`); assert.deepEqual(report.additionalPages, [], `${label}: unexpected page`);
    assert.deepEqual(report.remoteRequests, [], `${label}: non-local HTTP attempted`); assert.deepEqual(report.serverErrors, [], `${label}: artifact request failed`);
  }
  async function settle() {await page.evaluate(() => document.fonts.ready); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));}
  async function layout(label) {
    const value = await page.evaluate(() => ({width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, scrollX,
      containers: [...document.querySelectorAll('.fr-story-surface,.fr-story-stack,.settings-group,.settings-disclosure,.settings-item,.el-dialog')].filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden').map(node => ({className: node.className, width: node.clientWidth, scrollWidth: node.scrollWidth}))}));
    report.layouts.push({label, ...value});
    assert(value.documentWidth <= value.width + 1 && value.bodyWidth <= value.width + 1 && value.scrollX === 0, `${label}: document overflow`);
    assert(value.containers.every(row => row.scrollWidth <= row.width + 1), `${label}: container overflow ${JSON.stringify(value.containers.filter(row => row.scrollWidth > row.width + 1))}`);
  }
  async function shot(label) {
    await settle(); clean(label); await layout(label); await focus(`before:${label}`);
    const file = path.join(artifactsDir, `${label}.png`); await page.screenshot({path: file, animations: 'disabled'});
    await focus(`after:${label}`); clean(label); report.screenshots.push(file); save();
  }
  async function tabTo(locator, label) {
    let count = 0;
    while (!await locator.evaluate(node => node === document.activeElement) && count < 100) {await page.keyboard.press('Tab'); count += 1;}
    assert(count < 100, `${label}: must be reachable through Tab`);
    assert(await locator.evaluate(node => node === document.activeElement && node.matches(':focus-visible')), `${label}: keyboard focus visible`);
    report.keyboardFocus.push({label, tabs: count});
  }
  async function switchCheck(label, name) {
    const input = page.getByRole('switch', {name, exact: true}), shell = page.locator('.el-switch').filter({has: input});
    assert.equal(await input.getAttribute('aria-checked'), 'true');
    const metrics = await shell.evaluate(node => {const core = node.querySelector('.el-switch__core'), action = node.querySelector('.el-switch__action'), box = node.getBoundingClientRect(), track = core.getBoundingClientRect(), thumb = action.getBoundingClientRect();
      return {height: box.height, width: box.width, trackWidth: track.width, trackHeight: track.height, thumbWidth: thumb.width, thumbHeight: thumb.height, thumbOffset: thumb.left - track.left, controlsScope: Boolean(node.closest('.fr-settings-controls'))};});
    report.switchMetrics.push({label, ...metrics});
    assert(metrics.controlsScope && metrics.height >= 44 && metrics.width >= 44, `${label}: production 44px switch hit area`);
    assert(Math.abs(metrics.trackWidth - 48) < .5 && Math.abs(metrics.trackHeight - 28) < .5, `${label}: 48 × 28 switch track`);
    assert(Math.abs(metrics.thumbWidth - 20) < .5 && Math.abs(metrics.thumbHeight - 20) < .5);
    await shell.click(); await until(async () => await input.getAttribute('aria-checked') === 'false', `${label}: mouse switches off`);
    await until(async () => await shell.evaluate(node => {const track = node.querySelector('.el-switch__core').getBoundingClientRect(), thumb = node.querySelector('.el-switch__action').getBoundingClientRect(); return thumb.left - track.left < 10;}), `${label}: thumb moves left`);
    // Move out and return through Tab so the visual focus check is genuinely keyboard-driven.
    await page.keyboard.press('Tab'); await tabTo(input, `${label}-switch`);
    const outline = await shell.evaluate(node => {const css = getComputedStyle(node); return {within: node.matches(':focus-within'), width: css.outlineWidth, style: css.outlineStyle, color: css.outlineColor};});
    assert(outline.within && parseFloat(outline.width) >= 2 && outline.style !== 'none' && outline.color !== 'rgba(0, 0, 0, 0)', `${label}: visible production switch focus ring`);
    await page.keyboard.press('Enter'); await until(async () => await input.getAttribute('aria-checked') === 'true', `${label}: keyboard restores switch`);
  }
  async function controlsCase(label) {
    await switchCheck(label, '双语显示');
    const prompt = page.getByRole('textbox', {name: '提示词示例', exact: true}); await prompt.fill('真实输入的预览文本'); assert.equal(await prompt.inputValue(), '真实输入的预览文本');
    await page.getByRole('button', {name: '恢复示例', exact: true}).click(); assert.equal(await prompt.inputValue(), '把选中的文字翻译成简体中文。');
    const help = page.locator('.fr-story-row:has(.el-switch)').getByRole('button', {name: '查看说明', exact: true});
    await help.hover(); const tooltip = page.getByRole('tooltip').filter({hasText: '保留原文，并在相邻位置展示译文。'}); await tooltip.waitFor({state: 'visible'});
    await page.mouse.move(0, 0); await tooltip.waitFor({state: 'hidden'});
    await page.getByRole('button', {name: '打开预览弹窗', exact: true}).click(); const dialog = page.getByRole('dialog', {name: '组件预览', exact: true}); await dialog.waitFor({state: 'visible'});
    await layout(`${label}-dialog`); await page.keyboard.press('Escape'); await dialog.waitFor({state: 'hidden'});
    return {mouseSwitch: true, keyboardSwitch: true, textInput: true, hoverHelp: true, dialogEscape: true};
  }
  async function settingsCase(label) {
    await switchCheck(label, '双语对照');
    const help = page.getByRole('button', {name: '增加延迟可以减少短暂划过段落时的误触。', exact: true});
    await tabTo(help, `${label}-help`);
    const tooltip = page.getByRole('tooltip').filter({hasText: '增加延迟可以减少短暂划过段落时的误触。'}); await tooltip.waitFor({state: 'visible'});
    await page.keyboard.press('Escape'); await tooltip.waitFor({state: 'hidden'});
    const number = page.locator('.settings-number-input input'); await number.fill('500'); await number.press('Tab'); assert.equal(await number.inputValue(), '500');
    await number.press('ArrowUp'); await number.press('Tab'); assert.equal(await number.inputValue(), '600');
    assert.equal((await page.locator('.settings-number-unit').textContent()).trim(), 'ms');
    const group = page.locator('.fr-story-settings > .settings-group'), disclosure = page.locator('#demo-translation-preferences'), summary = disclosure.locator(':scope > summary');
    const styles = await Promise.all([group, disclosure].map(locator => locator.evaluate(node => {const css = getComputedStyle(node); return {radius: [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomRightRadius, css.borderBottomLeftRadius], border: ['Top', 'Right', 'Bottom', 'Left'].map(side => [css[`border${side}Width`], css[`border${side}Style`], css[`border${side}Color`]])};})));
    report.cardStyles.push({label, group: styles[0], disclosure: styles[1]}); assert.deepEqual(styles[0], styles[1], `${label}: group and disclosure card styling`);
    assert.equal(await disclosure.getAttribute('open'), null); await tabTo(summary, `${label}-disclosure`);
    await page.keyboard.press('Space'); await until(async () => await disclosure.getAttribute('open') !== null, `${label}: Space expands`);
    const terminology = page.getByRole('textbox', {name: '自定义术语', exact: true}); await terminology.fill('FluentRead → 顺畅阅读');
    await summary.click(); assert.equal(await disclosure.getAttribute('open'), null); await summary.click(); assert.equal(await terminology.inputValue(), 'FluentRead → 顺畅阅读');
    await page.getByRole('button', {name: '预览翻译', exact: true}).click(); await page.locator('.fr-story-reading-preview').waitFor();
    assert((await page.locator('.fr-story-reading-preview').innerText()).includes('按自己的节奏阅读。'));
    await page.getByRole('button', {name: '恢复示例', exact: true}).click(); assert.equal(await number.inputValue(), '300'); assert.equal(await terminology.inputValue(), 'FluentRead → 流畅阅读');
    assert.equal(await page.locator('.fr-story-reading-preview').count(), 0);
    return {mouseSwitch: true, keyboardSwitch: true, keyboardHelp: true, numberFillAndStep: true, groupDisclosureMatch: true, retainedCollapsedInput: true, reset: true};
  }
  try {
    fixture = await serveArtifact(storybookDir, report.serverErrors); report.localOrigin = fixture.origin;
    const browserArgs = ['--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost'];
    if (extensionDir) browserArgs.push(`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`);
    else browserArgs.push('--disable-extensions');
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir, browserPath, timeout, background: true, headless: false, displayTarget: arg('display', 'secondary'), viewport: {width: 1440, height: 960}, browserArgs});
    guardBrowserClose(session, profileDir); browserPid = await getGuardedBrowserPid(session); context = session.context;
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement, ownedPid: browserPid});
    assert.equal(session.launchMode, 'macos-background-cdp'); assert.equal(session.focusPolicy, 'launchservices-no-foreground');
    assert.equal(session.windowPlacement?.mode, 'background-visible-no-focus'); assert.equal(session.windowPlacement?.browserFrontmost, false); await focus('launch');
    const pages = context.pages(); report.initialPageCount = pages.length;
    page = pages.find(candidate => candidate.url().startsWith('about:blank#fluentread-background-')) || (pages.length === 1 ? pages[0] : undefined); assert(page, 'Reuse helper first tab');
    context.on('page', other => {if (other !== page) report.additionalPages.push({url: other.url()});});
    page.setDefaultTimeout(timeout); page.on('pageerror', error => report.consoleErrors.push({case: currentCase, message: error.message}));
    page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({case: currentCase, message: message.text()});});
    await context.route(/^https?:/u, async route => {const url = new URL(route.request().url()); if (url.origin === fixture.origin) await route.continue(); else {report.remoteRequests.push({origin: url.origin, path: url.pathname}); await route.abort();}});
    if (extensionDir) {
      let activationWorker;
      await until(async () => {
        for (const worker of context.serviceWorkers()) {
          if (!worker.url().endsWith(`/${manifest.background.service_worker}`)) continue;
          const identity = await worker.evaluate(name => {const value = chrome.runtime.getManifest(), key = /^__MSG_(.+)__$/u.exec(name); return {name: value.name, expected: key ? chrome.i18n.getMessage(key[1]) : name, version: value.version, key: value.key};}, manifest.name).catch(() => null);
          if (identity && identity.name === identity.expected && identity.version === manifest.version && identity.key === manifest.key) {activationWorker = worker; report.activationManifest = {name: identity.name, version: identity.version}; return true;}
        }
        return false;
      }, 'exact helper extension worker');
      // An extension-owned resource can identify its own tab without a broad tabs
      // permission. Activate once before navigating the same tab to the local story.
      await focus('navigate:activation-resource');
      await page.goto(`chrome-extension://${new URL(activationWorker.url()).host}/icon/128.png`, {waitUntil: 'domcontentloaded', timeout}); report.pageNavigations += 1;
      await helper.activateExtensionTabWithoutForeground(context, page); await focus('activate-owned-tab');
    }
    for (const skin of ['default', 'wujin', 'compact']) for (const theme of ['light', 'dark']) for (const width of [1440, 390]) for (const [kind, id] of Object.entries(stories)) {
      const label = `${kind}-${skin}-${theme}-${width}`; currentCase = label; await focus(`navigate:${label}`);
      await page.setViewportSize({width, height: width === 390 ? 844 : 960});
      const url = new URL('/storybook/iframe.html', fixture.origin); url.searchParams.set('id', id); url.searchParams.set('viewMode', 'story'); url.searchParams.set('globals', `theme:${theme};skin:${skin};locale:zh-CN`);
      await page.goto(url.href, {waitUntil: 'domcontentloaded', timeout}); report.pageNavigations += 1;
      await page.locator('.fr-story-surface .fr-settings-controls').waitFor();
      await page.waitForFunction(({skin, dark}) => document.documentElement.dataset.interfaceSkin === skin && document.documentElement.classList.contains('dark') === dark, {skin, dark: theme === 'dark'}); await settle();
      const results = kind === 'controls' ? await controlsCase(label) : await settingsCase(label);
      await layout(label); clean(label); report.cases.push({name: label, storyId: id, skin, theme, width, ...results});
      const capture = kind === 'controls' && skin === 'default' && theme === 'light' && width === 1440
        || kind === 'settings' && ((skin === 'default' && theme === 'dark' && width === 1440) || (skin === 'wujin' && theme === 'light' && width === 390) || (skin === 'compact' && theme === 'light' && width === 1440));
      if (capture) {await page.locator('.fr-story-surface').scrollIntoViewIfNeeded(); await shot(label);}
    }
    await focus('complete'); clean('complete'); report.ok = true;
  } catch (error) {
    primaryError = error; report.failure = {case: currentCase, message: error.message, stack: error.stack};
    if (!focusViolation && page && !page.isClosed() && browserPid) {
      try {await focus('before:failure'); const file = path.join(artifactsDir, 'failure.png'); await page.screenshot({path: file, animations: 'disabled'}); await focus('after:failure'); report.screenshots.push(file);} catch (captureError) {report.failureCaptureError = captureError.message;}
    }
  } finally {
    try {
      if (session) {await session.close(); report.cleanup = {ownedBrowserClosed: true}; fs.rmSync(profileDir, {recursive: true, force: true}); report.cleanup.profileRemoved = true;}
      else if (!launchAttempted) {fs.rmSync(profileDir, {recursive: true, force: true}); report.cleanup = {profileRemoved: true, browserNotStarted: true};}
      else report.cleanup = {profileRetained: true, reason: 'Launch returned no verified owned session'};
    } catch (error) {report.ok = false; report.cleanup = {profileRetained: true, message: error.message}; primaryError ||= error;}
    try {if (fixture) {await fixture.close(); report.localServerClosed = true;}}
    catch (error) {report.ok = false; report.serverCloseError = error.message; primaryError ||= error;}
    report.finishedAt = new Date().toISOString(); save();
  }
  if (primaryError) throw primaryError;
  process.stdout.write(JSON.stringify({ok: report.ok, reportPath, cases: report.cases.length, screenshots: report.screenshots.length}, null, 2) + '\n');
}
main().catch(error => {process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;});

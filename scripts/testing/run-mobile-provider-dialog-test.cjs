/**
 * @file scripts/testing/run-mobile-provider-dialog-test.cjs
 * 文件职责：在实际生产扩展的临时后台 Edge 中，限定验证添加服务窗口的移动可见视口与滚动可达性。
 * 主要内容：320/390、触屏横屏、深色、180px 键盘和平移视口夹具及桌面600px；检查窄屏非触屏分类、公开添加入口与窗口44px目标、16px输入、组合字段换行、取消重开和可选的无密钥公共保存。
 * 模块边界：一个自有浏览器，HTTP(S)离线并全部中止；仅首启语言使用临时配置夹具，服务窗口走真实公共UI。VV/触屏模拟不是OS键盘、iOS或物理设备验收。
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const helper = require('./focus-safe-browser.cjs');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`);return i < 0 ? fallback : process.argv[i + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const playwrightRoot = arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium} = require(path.join(playwrightRoot, 'playwright'));
assert.equal(process.platform, 'darwin', 'This driver requires the existing macOS background helper');
assert(!process.env.PLAYWRIGHT_DISABLE_SERVICE_WORKER_NETWORK, 'Service-worker HTTP interception must remain enabled');
assert(!/(?:^|[/\\])[^/\\]*-dev(?:[/\\]|$)/u.test(extensionDir), 'Use a production extension directory');
const manifestPath = path.join(extensionDir, 'manifest.json');
const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.manifest_version, 3);
assert(manifest.background?.service_worker && manifest.action?.default_popup);
const optionsFile = manifest.options_ui?.page || manifest.options_page;
assert.equal(typeof optionsFile, 'string');
assert(!optionsFile.startsWith('/') && !optionsFile.split('/').includes('..') && !optionsFile.includes('://'));
assert(fs.statSync(path.join(extensionDir, optionsFile)).isFile());
const requestedArtifacts = arg('artifacts-dir', undefined);
const artifactsDir = requestedArtifacts ? path.resolve(requestedArtifacts) : fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-mobile-provider-evidence-'));
if (requestedArtifacts) fs.mkdirSync(artifactsDir); // A fresh output directory; never overwrite an earlier run.
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-mobile-provider-profile-'));
const saveProvider = process.argv.includes('--save-provider');
const cases = [
  {name: 'portrait-320', width: 320, height: 560, touch: true, composite: true},
  {name: 'portrait-390', width: 390, height: 700, touch: true},
  {name: 'landscape-844', width: 844, height: 390, touch: true, composite: true},
  {name: 'dark-390', width: 390, height: 700, touch: true, dark: true},
  {name: 'keyboard-180', width: 390, height: 560, touch: true, visibleHeight: 180},
  {name: 'keyboard-panned-180', width: 390, height: 560, touch: true, visibleHeight: 180, top: 140, composite: true},
  {name: 'desktop-600-dialog', width: 1280, height: 900, touch: false},
];
const report = {ok: false, extensionDir, manifestSHA256: crypto.createHash('sha256').update(manifestBytes).digest('hex'), scope: 'Actual production options category target and Add-service dialog only; controlled VisualViewport/touch media fixtures, not an OS keyboard or native/physical-device acceptance.', cases: [], addEntryTargets: [], navigationTargets: [], screenshots: [], consoleErrors: [], httpAttempts: [], cleanup: {profileRemoved: false}, publicSaveRequested: saveProvider};
let session, page, client, stopped = false, launchAttempted = false, timer, currentCase = 'setup';
const began = performance.now(), actionDeadline = began + 160000;
function available(maximum = 5000) {
  assert(!stopped, 'Run already stopped');
  assert.equal(report.httpAttempts.length, 0, 'Unexpected HTTP(S) attempt; no further UI actions');
  const remaining = Math.floor(actionDeadline - performance.now());
  assert(remaining > 0, 'Focused dialog action deadline exceeded');
  return Math.min(maximum, remaining);
}
async function op(label, action, maximum = 5000) {
  const ms = available(maximum);let timeout;
  try {
    const result = await Promise.race([Promise.resolve().then(() => action(ms)), new Promise((_, reject) => {timeout = setTimeout(() => {stopped = true;reject(new Error(`Timed out: ${label}`));}, ms);})]);
    available();return result;
  } finally {clearTimeout(timeout);}
}
const frames = () => op('two layout frames', () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
const click = async target => {
  report.lastClick = {selector: target.toString(), geometry: await op('public target geometry', () => target.boundingBox()), enabled: await op('public target enabled', () => target.isEnabled())};
  return op('public dialog click ' + target.toString(), timeout => target.click({timeout: Math.max(1, timeout - 1000)}));
};
const fill = (target, value) => op('nonsecret fixture input', timeout => target.fill(value, {timeout}));
const dialog = () => page.getByTestId('custom-service-dialog');
async function shot(name) {
  assert(report.screenshots.length < 24);
  const file = path.join(artifactsDir, `${name}.png`);
  await op('original viewport screenshot', timeout => page.screenshot({path: file, animations: 'disabled', timeout}));
  report.screenshots.push(file);
}
async function readConfig() {
  return op('owned temporary configuration read', () => page.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!r?.success) throw new Error('Configuration authority unavailable');
    return typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
  }));
}
async function completeLanguageFixture() {
  await op('temporary language-only fixture', () => page.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!r?.success) throw new Error('Configuration authority unavailable');
    const c = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
    const config = {uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true};
    const saved = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config,
      expected: Object.fromEntries(Object.keys(config).map(key => [key, c[key]])),
      baseRevision: c.__fluentConfigRevision || 0, clientId: 'mobile-provider-language-fixture', sequence: 1});
    if (!saved?.success) throw new Error('Temporary language fixture did not persist');
  }));
  report.setup = 'Only uiLanguage=zh-CN and uiLanguageSetupCompleted=true seeded in the fresh owned profile; not onboarding acceptance.';
}
async function measureNavigation(stage) {
  const target = await op('known settings category measurement', () => page.evaluate(() => {
    const nodes = document.querySelectorAll('select.mobile-settings-navigation[aria-label="设置分类"]');
    if (nodes.length !== 1) throw new Error('Expected one known settings category select');
    const node = nodes[0], r = node.getBoundingClientRect(), style = getComputedStyle(node);
    return {label: '设置分类', visible: node.getClientRects().length > 0 && style.visibility !== 'hidden',
      bounds: {x: r.x, y: r.y, width: r.width, height: r.height}, font: parseFloat(style.fontSize),
      narrow: matchMedia('(max-width: 700px)').matches, coarse: matchMedia('(any-pointer: coarse)').matches,
      fine: matchMedia('(pointer: fine)').matches};
  }));
  report.navigationTargets.push({case: currentCase, stage, ...target});
  if (target.visible) {assert(target.bounds.width >= 43.99 && target.bounds.height >= 43.99, 'Visible settings category must be at least44px');assert(target.font >= 16, 'Visible settings category text must be at least16px');}
  return target;
}
async function openDialog() {
  await measureNavigation('before-public-Add');
  const add = page.getByTestId('custom-service-add');
  if (!await op('public Add entry visibility', () => add.isVisible())) {
    const toggle = page.locator('.mobile-directory-toggle');
    assert.equal(await op('collapsed mobile service directory', () => toggle.getAttribute('aria-expanded')), 'false');
    await click(toggle);
    await op('expanded public Add entry', timeout => add.waitFor({state: 'visible', timeout}));
  }
  assert.equal(await op('public Add entry label', () => add.getAttribute('aria-label')), '自定义服务');
  const bounds = await op('visible public Add entry rectangle', () => add.boundingBox());
  assert(bounds && bounds.width > 0 && bounds.height > 0, 'Public Add entry must be visible');
  const media = await op('public Add entry actual media', () => page.evaluate(() => ({narrow: matchMedia('(max-width: 700px)').matches, coarse: matchMedia('(any-pointer: coarse)').matches})));
  const mobile = media.narrow || media.coarse;
  report.addEntryTargets.push({case: currentCase, label: '自定义服务', width: bounds.width, height: bounds.height, ...media, mobile});
  if (mobile) assert(bounds.width >= 43.99 && bounds.height >= 43.99, 'Public mobile Add entry must be at least44px');
  else assert(Math.abs(bounds.height - 34) <= 0.01, 'Fine-pointer desktop Add entry stays34px');
  if (currentCase === 'portrait-320' && report.addEntryTargets.filter(entry => entry.case === currentCase).length === 1) await shot('portrait-320-add-entry');
  await click(add);
  await op('actual dialog open', timeout => dialog().waitFor({state: 'visible', timeout}));
  await op('Element Plus open transition complete', timeout => page.waitForFunction(() => {
    const d = document.querySelector('[data-testid="custom-service-dialog"]');
    return d && !document.getAnimations().some(a => a.playState === 'running' && a.effect?.target instanceof Element && (a.effect.target.contains(d) || d.contains(a.effect.target)));
  }, undefined, {timeout}));
  await frames();
}
async function reach(target) {
  await op('one own-dialog scroll to target', () => target.evaluate(node => {
    const d = node.closest('.el-dialog');if (!d) throw new Error('Target has no owned dialog');
    const r = node.getBoundingClientRect(), b = d.getBoundingClientRect();
    d.scrollTop += r.top - b.top - Math.max(12, (d.clientHeight - r.height) / 2);
  }));
  await frames();
  return op('target reachability', () => target.evaluate(node => {
    const d = node.closest('.el-dialog'), r = node.getBoundingClientRect(), b = d.getBoundingClientRect(), v = visualViewport;
    const left = Math.max(b.left, v.offsetLeft), top = Math.max(b.top, v.offsetTop);
    const right = Math.min(b.right, v.offsetLeft + v.width), bottom = Math.min(b.bottom, v.offsetTop + v.height);
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!(r.width > 0 && r.height > 0 && r.left >= left - 1 && r.right <= right + 1 && r.top >= top - 1 && r.bottom <= bottom + 1 && (hit === node || node.contains(hit)))) throw new Error('Target not fully reachable within its own dialog and visible viewport');
    return {width: r.width, height: r.height, dialogScrollTop: d.scrollTop};
  }));
}
async function geometry(touch) {
  const m = await op('dialog geometry and target sizes', () => dialog().evaluate((d, touch) => {
    const rect = n => {const r = n.getBoundingClientRect();return {x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom};};
    const v = visualViewport, b = rect(d), style = getComputedStyle(d);
    const controls = [...d.querySelectorAll('input,select,button,summary')].filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
    if (controls.length > 40) throw new Error('Unexpected dialog control count');
    return {dialog: b, viewport: {left: v.offsetLeft, top: v.offsetTop, width: v.width, height: v.height}, coarse: matchMedia('(any-pointer: coarse)').matches, dark: document.documentElement.classList.contains('dark'), ownOverflowY: style.overflowY,
      ownScrollHeight: d.scrollHeight, ownClientHeight: d.clientHeight, horizontalOverflow: d.scrollWidth > d.clientWidth + 1, documentHorizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1, outerScrollX: scrollX, outerScrollY: scrollY,
      controls: controls.map(n => ({tag: n.tagName, width: rect(n).width, height: rect(n).height, font: parseFloat(getComputedStyle(n).fontSize), input: n.matches('input,select')})),
      compositeRows: [...d.querySelectorAll('.composite-setting-row')].map(n => ({rect: rect(n), columns: getComputedStyle(n).gridTemplateColumns})),
      memberActionsWrap: [...d.querySelectorAll('.composite-member-list li')].map(n => ({wrap: getComputedStyle(n).flexWrap, actions: rect(n.querySelector('.member-actions')), row: rect(n)})), touch};
  }, touch));
  report.lastGeometry = m;
  const v = m.viewport, b = m.dialog;
  assert(b.width > 0 && b.height > 0 && b.x >= v.left - 1 && b.right <= v.left + v.width + 1 && b.y >= v.top - 1 && b.bottom <= v.top + v.height + 1, 'Dialog must fit the controlled visible viewport');
  assert.equal(m.horizontalOverflow, false);assert.equal(m.documentHorizontalOverflow, false);
  assert.equal(m.outerScrollX, 0);assert.equal(m.outerScrollY, 0);
  if (touch) {
    assert.equal(m.coarse, true, 'The 844px case must exercise the coarse-pointer path');
    assert(['auto', 'scroll'].includes(m.ownOverflowY));
    for (const c of m.controls) {assert(c.width >= 43.99 && c.height >= 43.99, 'Every visible mobile input/select/button/summary must be at least44px');if (c.input) assert(c.font >= 16, 'Mobile input/select text must be at least16px');}
    for (const row of m.compositeRows) {assert(row.rect.x >= b.x - 1 && row.rect.right <= b.right + 1);assert.equal(row.columns.trim().split(/\s+/u).length, 1, 'Composite setting rows must wrap to one column');}
    for (const row of m.memberActionsWrap) {assert.equal(row.wrap, 'wrap');assert(row.actions.x >= row.row.x - 1 && row.actions.right <= row.row.right + 1);}
  } else {assert.equal(m.coarse, false);assert(Math.abs(b.width - 600) <= 1, 'Desktop dialog stays600px');}
  return m;
}
async function cancel() {const target = dialog().locator('footer .secondary-button');await reach(target);await click(target);await op('dialog closed', timeout => dialog().waitFor({state: 'hidden', timeout}));}
async function assertCleanDraft() {
  assert.equal(await op('interface active', () => dialog().getByTestId('custom-service-type-interface').getAttribute('aria-pressed')), 'true');
  for (const field of ['name', 'endpoint', 'api-key', 'model']) assert.equal(await op('cleared dialog draft', () => dialog().getByTestId(`custom-service-${field}`).inputValue()), '');
}
async function run() {
  launchAttempted = true;
  session = await helper.launchFocusSafePersistentContext({chromium, profileDir, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true, headless: false, displayTarget: 'secondary', viewport: {width: 1280, height: 900}, timeout: 30000,
    browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking']});
  guardBrowserClose(session, profileDir);
  Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
  assert.equal(session.launchMode, 'macos-background-cdp');assert.equal(session.focusPolicy, 'launchservices-no-foreground');assert.equal(session.windowPlacement.mode, 'background-visible-no-focus');assert.equal(session.windowPlacement.browserFrontmost, false);
  session.context.setDefaultTimeout(5000);session.context.setDefaultNavigationTimeout(10000);
  await session.context.route(/^https?:/u, route => route.abort('blockedbyclient'));
  session.context.on('request', request => {if (/^https?:/u.test(request.url()) && report.httpAttempts.length < 32) report.httpAttempts.push({host: new URL(request.url()).hostname, method: request.method()});});
  await session.context.setOffline(true);report.httpPolicy = 'Context offline plus HTTP(S) abort route including inspected service-worker requests; any attempted HTTP(S) fails this focused test. No network probe.';
  const worker = session.context.serviceWorkers()[0] || await session.context.waitForEvent('serviceworker', {timeout: 10000});
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  page = await helper.newPageWithoutForeground(session.context, 10000);
  page.on('pageerror', error => {if (report.consoleErrors.length < 16) report.consoleErrors.push(error.message.slice(0, 500));});
  await page.addInitScript(() => {
    const vv = window.visualViewport;if (!vv) throw new Error('VisualViewport fixture requires the existing object');
    const keys = ['width', 'height', 'offsetLeft', 'offsetTop'], descriptors = keys.map(k => Object.getOwnPropertyDescriptor(vv, k));let fixture = {};
    for (const key of keys) Object.defineProperty(vv, key, {configurable: true, get: () => key === 'width' ? fixture.width ?? innerWidth : key === 'height' ? fixture.height ?? innerHeight : key === 'offsetLeft' ? fixture.left ?? 0 : fixture.top ?? 0});
    window.__fluentreadProviderVV = {set(next) {fixture = next;vv.dispatchEvent(new Event('resize'));vv.dispatchEvent(new Event('scroll'));dispatchEvent(new Event('resize'));}, restore() {keys.forEach((key, i) => {if (descriptors[i]) Object.defineProperty(vv, key, descriptors[i]);else delete vv[key];});vv.dispatchEvent(new Event('resize'));}};
  });
  client = await session.context.newCDPSession(page);
  await op('actual options document', timeout => page.goto(`${origin}/${optionsFile}#settings-general`, {waitUntil: 'domcontentloaded', timeout}), 10000);
  await completeLanguageFixture();await op('options after language seed', timeout => page.reload({waitUntil: 'domcontentloaded', timeout}), 10000);
  await click(page.locator('button[data-section="settings-services"]'));
  await op('normal Add service entry', timeout => page.getByTestId('custom-service-add').waitFor({timeout}));
  const baseline = await readConfig();assert.equal(baseline.theme, 'auto');assert.equal((baseline.customOpenAIProviders || []).length, 0);
  currentCase = 'narrow-fine-category';
  await op('narrow non-touch viewport', () => page.setViewportSize({width: 390, height: 700}));
  await op('narrow non-touch media', () => client.send('Emulation.setTouchEmulationEnabled', {enabled: false, maxTouchPoints: 1}));
  await frames();
  const navigation = await measureNavigation('initial-services-narrow-non-touch');
  assert.equal(navigation.visible, true);assert.equal(navigation.narrow, true);assert.equal(navigation.coarse, false);assert.equal(navigation.fine, true);
  await shot('narrow-fine-category-original');
  for (const c of cases) {
    currentCase = c.name;
    await op('layout viewport', () => page.setViewportSize({width: c.width, height: c.height}));
    await op('touch media fixture', () => client.send('Emulation.setTouchEmulationEnabled', {enabled: c.touch, maxTouchPoints: 1}));
    // Touch capability controls coarse media; keep mouse CDP acknowledgements independent of touch conversion.
    await op('mouse acknowledgement policy', () => client.send('Emulation.setEmitTouchEventsForMouse', {enabled: false, configuration: 'desktop'}));
    await op('actual automatic theme', () => page.emulateMedia({colorScheme: c.dark ? 'dark' : 'light'}));
    await op('same-object visible viewport fixture', () => page.evaluate(c => window.__fluentreadProviderVV.set({width: c.width, height: c.visibleHeight || c.height, top: c.top || 0, left: 0}), c));
    await op('actual theme applied', timeout => page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, Boolean(c.dark), {timeout}));
    await openDialog();await assertCleanDraft();
    const record = {name: c.name, controlledViewportFixture: Boolean(c.visibleHeight), interface: await geometry(c.touch), reachableInputs: []};
    for (const field of ['name', 'endpoint', 'api-key', 'model']) record.reachableInputs.push({field, ...await reach(dialog().getByTestId(`custom-service-${field}`))});
    await reach(dialog().getByTestId('custom-service-name'));await shot(`${c.name}-interface-input`);
    const save = dialog().getByTestId('custom-service-save');record.footerReachable = await reach(save);await geometry(c.touch);await shot(`${c.name}-interface-footer`);
    if (c.name === 'portrait-320') {await fill(dialog().getByTestId('custom-service-name'), 'cancelled draft');await fill(dialog().getByTestId('custom-service-endpoint'), 'https://example.invalid/v1');await cancel();await openDialog();await assertCleanDraft();record.cancelReopenCleared = true;}
    if (c.composite) {
      const type = dialog().getByTestId('custom-service-type-composite');await reach(type);await click(type);
      const members = dialog().getByTestId('composite-member-select');await reach(members);
      for (const value of ['google', 'microsoft']) await op('public composite member selection', timeout => members.selectOption(value, {timeout}));
      const advanced = dialog().locator('[data-composite-advanced] > summary');await reach(advanced);await click(advanced);
      const input = dialog().getByTestId('composite-member-timeout');record.compositeInputReachable = await reach(input);await fill(input, '17');
      record.composite = await geometry(c.touch);await shot(`${c.name}-composite-advanced`);
      await cancel();await openDialog();await assertCleanDraft();
      await reach(dialog().getByTestId('custom-service-type-composite'));await click(dialog().getByTestId('custom-service-type-composite'));
      assert.equal(await op('composite draft reset', () => dialog().locator('[data-composite-member]').count()), 0);
      assert.equal(await op('advanced reset', () => dialog().locator('[data-composite-advanced]').getAttribute('open')), null);
      record.compositeCancelReopenCleared = true;
    }
    await cancel();report.cases.push(record);
  }
  if (saveProvider) {
    currentCase = 'optional-public-save';await openDialog();await assertCleanDraft();
    await fill(dialog().getByTestId('custom-service-name'), 'Mobile layout fixture');await fill(dialog().getByTestId('custom-service-endpoint'), 'https://example.invalid/v1/chat/completions');await fill(dialog().getByTestId('custom-service-model'), 'fixture-model');
    assert.equal(await op('no key entered', () => dialog().getByTestId('custom-service-api-key').inputValue()), '');
    await reach(dialog().getByTestId('custom-service-save'));await shot('optional-public-save-before-submit');await click(dialog().getByTestId('custom-service-save'));
    await op('public save closed', timeout => dialog().waitFor({state: 'hidden', timeout}));
    await op('public save persisted', timeout => page.waitForFunction(async () => {const r = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});const c = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;return c?.customOpenAIProviders?.some(p => p.name === 'Mobile layout fixture');}, undefined, {timeout}));
    const saved = await readConfig(), provider = saved.customOpenAIProviders.find(p => p.name === 'Mobile layout fixture');
    assert.equal(provider.endpoint, 'https://example.invalid/v1/chat/completions');assert.deepEqual(provider.models, ['fixture-model']);assert.equal(saved.token?.[provider.id] || '', '');assert.equal((saved.apiKeys?.[provider.id] || []).length, 0);assert.equal(saved.service, baseline.service);
    report.publicSave = {persisted: true, noKey: true, reservedEndpoint: provider.endpoint, model: provider.models[0], defaultServiceUnchanged: true};
  }
  assert.deepEqual(report.consoleErrors, []);assert.deepEqual(report.httpAttempts, []);
  assert(fs.readFileSync(manifestPath).equals(manifestBytes), 'Production manifest changed during this run');
  report.ok = true;
}
(async () => {
  try {
    await Promise.race([run(), new Promise((_, reject) => {timer = setTimeout(() => {stopped = true;reject(new Error('Focused dialog overall action deadline'));}, 160000);})]);
  } catch (error) {
    report.error = String(error.stack || error).slice(0, 4000);report.failedCase = currentCase;report.ok = false;process.exitCode = 1;
    if (page && !page.isClosed() && report.screenshots.length < 24) try {const file = path.join(artifactsDir, 'failure-original.png');await page.screenshot({path: file, animations: 'disabled', timeout: 1500});report.screenshots.push(file);} catch {}
  } finally {
    stopped = true;clearTimeout(timer);let closed = !launchAttempted;
    if (page && !page.isClosed()) try {await Promise.race([page.evaluate(() => window.__fluentreadProviderVV?.restore()), new Promise((_, reject) => setTimeout(() => reject(new Error('Fixture restore timeout')), 1000))]);} catch (error) {report.fixtureRestoreError = String(error.message);report.ok = false;process.exitCode = 1;}
    if (session) try {await session.close();closed = true;} catch (error) {report.cleanup.error = String(error.message);report.ok = false;process.exitCode = 1;}
    if (closed) {fs.rmSync(profileDir, {recursive: true, force: true});report.cleanup.profileRemoved = true;} else report.cleanup.retainedProfile = profileDir;
    report.elapsedMs = performance.now() - began;
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ok: report.ok, artifactsDir, cases: report.cases.length, screenshots: report.screenshots.length, error: report.error, cleanup: report.cleanup}));
  }
})();

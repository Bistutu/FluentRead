/**
 * @file scripts/testing/run-cache-clear-recovery-test.cjs
 * 文件职责：在临时且不抢焦点的真实浏览器中验证生产扩展的缓存清理、广播宽限和管理界面恢复。
 * 主要内容：通过真实按钮操作正常缓存链路，以精确消息响应门控注入页面通知和 UI 等待故障，记录数据库、协议、页面状态、逐命令/操作焦点时间线、观测失败锁存及完整运行时诊断。
 * 模块边界：只操作本轮临时扩展配置与本地夹具，不访问用户 profile、外部翻译服务或修改生产模块；构建由调用方完成，诊断采集器须显式从 CLI 注入。
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {guardBrowserClose, getGuardedBrowserPid} = require('./owned-browser-close.cjs');

// 仅为本 CLI 留下时序证据；额外的只读前台采样会影响时间，不能据此声称已修复焦点。
function createCacheFocusTrace({records, errors, readForeground, getBrowserPid, getFocusFailure, onOwnedActivation, onObservationFailure}) {
  const methods = new Set(['Target.createTarget', 'Target.closeTarget', 'Browser.getWindowForTarget', 'Browser.getWindowBounds', 'Browser.setWindowBounds']);
  const targets = new Map(), windows = new Map(), pages = new WeakMap(), instrumented = new WeakSet(), active = new Map();
  let currentCase = 'bootstrap', sequence = 0, operation = 0, lastCreatedTarget, foreground, ownedActivation, observationFailure;
  const stamp = () => ({time: Date.now(), monotonicMs: performance.now()});
  const bounds = value => value && Object.fromEntries(['left', 'top', 'width', 'height', 'windowState']
    .filter(key => key === 'windowState' ? ['normal', 'minimized', 'maximized', 'fullscreen'].includes(value[key]) : Number.isFinite(value[key]))
    .map(key => [key, value[key]]));
  const fields = value => ({...(typeof value?.targetId === 'string' ? {targetId: value.targetId} : {}),
    ...(Number.isInteger(value?.windowId) ? {windowId: value.windowId} : {}), ...(value?.bounds ? {bounds: bounds(value.bounds)} : {}),
    ...(typeof value?.background === 'boolean' ? {background: value.background} : {}), ...(typeof value?.success === 'boolean' ? {success: value.success} : {})});
  const identity = value => {
    const targetId = value?.targetId || (value?.windowId !== undefined
      ? [...targets].findLast(([, target]) => target.windowId === value.windowId)?.[0] : undefined);
    const windowId = value?.windowId ?? targets.get(targetId)?.windowId;
    return {targetId: targetId ?? null, windowId: windowId ?? null, bounds: windows.get(windowId) ?? null};
  };
  const record = (scope, name, phase, extra = {}) => records.push({sequence: ++sequence, ...stamp(), case: currentCase,
    scope, name, phase, browserPid: getBrowserPid() ?? null, foreground, activeOperations: [...active.keys()], ...extra});
  function observeOwned(pid) {
    if (pid === getBrowserPid() && Number.isInteger(pid) && !ownedActivation) {
      ownedActivation = new Error('Owned test browser became frontmost');onOwnedActivation(ownedActivation);
    }
  }
  async function sample() {
    const startedAt = stamp();
    try {
      const value = await readForeground();
      if (!Number.isInteger(value?.pid) || value.pid <= 0) throw new Error('Foreground observation unavailable');
      foreground = {startedAt, sampledAt: stamp(), pid: value.pid, name: typeof value.name === 'string' ? value.name : ''};
      observeOwned(value.pid);
    } catch (error) {
      foreground = {startedAt, sampledAt: stamp(), unavailable: true};
      errors.push({case: currentCase, scope: 'foreground-sample', ...stamp(), errorName: error?.name || 'Error'});
      observationFailure ||= new Error('Foreground trace observation unavailable; see focusTraceErrors');onObservationFailure(observationFailure);
    }
  }
  async function run(scope, name, invoke, details = () => ({}), cleanup = false, completed = () => {}) {
    const id = ++operation;
    const guard = () => {
      const failure = getFocusFailure() || ownedActivation || observationFailure;
      if (failure && !cleanup) {record(scope, name, 'blocked', {operation: id, ...details()});throw failure;}
    };
    guard();await sample();guard();
    active.set(id, {scope, name});record(scope, name, 'started', {operation: id, ...details()});
    try {
      const result = await invoke();completed(result);
      await sample();record(scope, name, 'completed', {operation: id, ...details()});return result;
    } catch (error) {
      // 采样与 latch 不替换原始 CDP/Playwright 拒绝，失败后的下一动作才被拦截。
      await sample();record(scope, name, 'rejected', {operation: id, ...details(), errorName: error?.name || 'Error'});throw error;
    } finally {active.delete(id);}
  }
  return {
    setCase(name) {currentCase = name;},
    observeActivation(event) {
      observeOwned(event.pid);record('native', 'application-activation', 'observed', {
        event: {pid: event.pid, name: event.name, time: event.time, monotonicMs: event.monotonicMs}});
    },
    bindPage(page) {if (lastCreatedTarget) pages.set(page, lastCreatedTarget);},
    pageIdentity(page) {return identity({targetId: page && pages.get(page)});},
    action(name, invoke, page) {
      let createdTarget;
      return run('action', name, invoke, () => identity({targetId: page ? pages.get(page) : createdTarget}), false,
        result => {if (name === 'newPage') createdTarget = pages.get(result);});
    },
    instrumentBrowser(browser) {
      if (instrumented.has(browser)) return browser;
      instrumented.add(browser);
      const nativeSession = browser.newBrowserCDPSession;
      browser.newBrowserCDPSession = async function (...args) {
        const cdp = await nativeSession.apply(this, args), nativeSend = cdp.send;
        cdp.send = function (...args) {
          const [method, params] = args;
          if (!methods.has(method)) return nativeSend.apply(this, args);
          let resultFields;
          const details = () => ({...identity({...params, ...resultFields}), request: fields(params), ...(resultFields ? {result: resultFields} : {})});
          // helper 在建页失败后关闭自己刚创建的 target 仍可执行；普通 page.close 走 action guard。
          const cleanup = method === 'Target.closeTarget' && targets.has(params?.targetId);
          return run('cdp', method, () => nativeSend.apply(this, args), details, cleanup, result => {
            resultFields = fields(result);
            if (method === 'Target.createTarget' && resultFields.targetId) {lastCreatedTarget = resultFields.targetId;targets.set(lastCreatedTarget, {});}
            if (method === 'Browser.getWindowForTarget' && targets.has(params?.targetId)) targets.get(params.targetId).windowId = resultFields.windowId;
            if (resultFields.bounds && Number.isInteger(resultFields.windowId ?? params?.windowId)) windows.set(resultFields.windowId ?? params.windowId, resultFields.bounds);
          });
        };
        return cdp;
      };
      return browser;
    },
  };
}

const arg = (name, fallback) => {const index = process.argv.indexOf(`--${name}`);return index < 0 ? fallback : process.argv[index + 1];};
const helper = require(path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))));
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-cache-clear-recovery'));
const diagnosticsPath = arg('runtime-diagnostics');
assert.ok(diagnosticsPath && path.isAbsolute(diagnosticsPath), '--runtime-diagnostics must be an absolute path');
const diagnostics = require(diagnosticsPath).createRuntimeDiagnostics();
const playwrightRoot = arg('playwright-root');
assert.ok(playwrightRoot, '--playwright-root must point to the bundled Node packages');
assert.equal(path.basename(extensionDir), 'chrome-mv3', 'Build the production chrome-mv3 extension first');
const {chromium} = require(path.join(path.resolve(playwrightRoot), 'playwright'));
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-cache-clear-recovery-'));
fs.mkdirSync(artifactsDir, {recursive: true});
const report = {extensionDir, version: manifest.version, build: 'production-chrome-mv3',
  scope: 'Cache management only; Popup is an ordinary extension tab, not the native toolbar popup.',
  cases: [], pageErrors: [], cleanupErrors: [], controlledFaults: [], screenshots: [], focusTrace: [], focusTraceErrors: [],
  focusTraceScope: 'Diagnostic only; samples add latency. Public browser CDP sessions trace five allowlisted methods; Playwright private page sessions are represented by action boundaries, not complete protocol traffic. Bootstrap activation events are recorded before the owned PID is verified, then reconciled by the existing post-launch assertFocus.',
  focusTraceClockDomains: {time: 'Unix epoch milliseconds; correlate sources using this time and foreground sample intervals.',
    monotonicMs: 'Node performance.now(); local trace clock origin.',
    nativeEventMonotonicMs: 'Nested event.monotonicMs is Swift systemUptime * 1000; it has a different clock origin and must not be subtracted from Node monotonicMs.'}};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const artifactFiles = directory => fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory()
  ? artifactFiles(path.join(directory, entry.name)) : [path.join(directory, entry.name)]).sort();
const artifactHashes = artifactFiles(extensionDir).map(file => ({path: path.relative(extensionDir, file), sha256: hash(fs.readFileSync(file))}));
report.artifactSnapshot = {files: artifactHashes.length, manifestSha256: hash(fs.readFileSync(path.join(extensionDir, 'manifest.json'))),
  treeSha256: hash(JSON.stringify(artifactHashes)), capturedAt: new Date().toISOString()};
report.sourceSnapshot = Object.fromEntries([
  'src/app/background/handlers/translationCache.ts', 'src/services/translation/cacheRequest.ts',
  'src/services/translation/cacheManagement.ts', 'src/app/popup/cache.ts', 'src/app/popup/PopupApp.vue',
  'src/features/settings/ui/TranslationCacheSettings.vue', 'src/features/settings/ui/SettingsSections.vue',
  ...['zh-CN', 'en-US', 'es-ES', 'fr-FR', 'ja-JP', 'ko-KR', 'ru-RU'].map(locale => `src/core/i18n/messages/${locale}.ts`),
].map(file => [file, hash(fs.readFileSync(path.resolve(__dirname, '../..', file)))]));
let session, context, worker, origin, activePage, monitor, browserPid, focusFailure, launchAttempted = false;
const focusTrace = createCacheFocusTrace({records: report.focusTrace, errors: report.focusTraceErrors,
  readForeground: () => helper.queryMacFrontmostApplication(), getBrowserPid: () => browserPid,
  getFocusFailure: () => focusFailure || monitor?.error, onOwnedActivation: error => {focusFailure ||= error;},
  onObservationFailure: error => {focusFailure ||= error;}});
const nativeConnect = chromium.connectOverCDP;
chromium.connectOverCDP = async function (...args) {return focusTrace.instrumentBrowser(await nativeConnect.apply(this, args));};
const server = http.createServer((_request, response) => {
  response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  response.end('<!doctype html><meta charset="utf-8"><title>Cache notification fixture</title><main><h1>Cache notification receiver</h1><p>A quiet local reading page receives FluentRead cache invalidation messages without calling a translation provider.</p></main>');
});
const save = () => fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
function assertFocus() {
  if (focusFailure || monitor?.error) throw focusFailure || monitor.error;
  assert.equal(monitor.events.filter(event => event.pid === browserPid).length, 0, 'owned browser became frontmost');
}
async function screenshot(page, name) {
  assertFocus();
  const file = path.join(artifactsDir, `${name}.png`);
  const cache = page.locator('[data-translation-cache-settings]');
  if (await cache.count() && await cache.isVisible()) {
    // 连续表单在内层容器滚动；先让真实浏览器完整展示反馈，再拍整窗上下文。
    const componentFile = path.join(artifactsDir, `${name}-cache-feedback.png`);
    await focusTrace.action('screenshot.component', () => cache.screenshot({path: componentFile}), page);assertFocus();report.screenshots.push(componentFile);
  }
  await focusTrace.action('screenshot.page', () => page.screenshot({path: file}), page);assertFocus();report.screenshots.push(file);return file;
}
async function runCase(name, kind, operation) {
  focusTrace.setCase(name);diagnostics.setPhase(name);assertFocus();
  const result = await operation();assertFocus();
  report.cases.push({name, kind, passed: true, ...result});save();console.log(`PASS ${name}`);
}

// 保留原生 callback/Promise 两种协议；只延迟指定消息的成功响应，不吞传输错误。
function installPageProbe() {
  if (!globalThis.chrome?.runtime?.sendMessage) return;
  const nativeSend = chrome.runtime.sendMessage.bind(chrome.runtime);
  const nativeSet = setTimeout.bind(globalThis), nativeClear = clearTimeout.bind(globalThis);
  const state = globalThis.__cacheRecovery = {sequence: 0, requests: [], receipts: [], holds: [],
    rules: {clearTranslationCache: [], getTranslationCacheStats: []}, longTimers: new Map()};
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (typeof callback !== 'function') return nativeSet(callback, delay, ...args);
    let id;
    id = nativeSet(() => {state.longTimers.delete(id);callback(...args);}, delay);
    if (delay >= 14_000 && delay <= 15_000) state.longTimers.set(id, delay);
    return id;
  };
  globalThis.clearTimeout = id => {state.longTimers.delete(id);return nativeClear(id);};
  state.release = id => {
    const held = state.holds.find(entry => entry.id === id && !entry.released);
    if (!held) throw new Error(`Unknown cache response gate ${id}`);
    held.released = true;held.deliver();
  };
  chrome.runtime.sendMessage = (...args) => {
    const message = args[0];
    if (!Object.hasOwn(state.rules, message?.type)) return nativeSend(...args);
    const request = {id: ++state.sequence, type: message.type, startedAt: performance.now()};
    state.requests.push(request);
    const rule = state.rules[message.type].shift();
    const record = response => {
      const receipt = {id: request.id, type: message.type, receivedAt: performance.now(), success: response?.success,
        invalidationPending: response?.invalidationPending === true};
      state.receipts.push(receipt);return receipt;
    };
    const callbackIndex = args.findLastIndex(value => typeof value === 'function');
    if (callbackIndex >= 0) {
      const callback = args[callbackIndex];
      args[callbackIndex] = response => {
        const receipt = record(response);
        if (chrome.runtime.lastError || !rule?.hold) {receipt.deliveredAt = performance.now();return callback(response);}
        state.holds.push({id: request.id, type: message.type, released: false,
          deliver() {receipt.deliveredAt = performance.now();callback(response);}});
      };
      return nativeSend(...args);
    }
    return Promise.resolve(nativeSend(...args)).then(response => {
      const receipt = record(response);
      if (!rule?.hold) {receipt.deliveredAt = performance.now();return response;}
      return new Promise(resolve => state.holds.push({id: request.id, type: message.type, released: false,
        deliver() {receipt.deliveredAt = performance.now();resolve(response);}}));
    });
  };
}
async function openPage(url, label, probe = true) {
  const page = await focusTrace.action('newPage', async () => {
    const created = await helper.newPageWithoutForeground(context);focusTrace.bindPage(created);return created;
  });
  assertFocus();
  activePage = page;await diagnostics.attachPage(page, label);
  page.on('pageerror', error => report.pageErrors.push({label, message: error.message}));
  if (probe) await page.addInitScript(installPageProbe);
  await page.goto(url, {waitUntil: 'domcontentloaded'});assertFocus();return page;
}
async function readProbe(page) {
  const result = await focusTrace.action('readProbe', () => page.evaluate(() => ({requests: globalThis.__cacheRecovery.requests, receipts: globalThis.__cacheRecovery.receipts,
    holds: globalThis.__cacheRecovery.holds.map(({id, type, released}) => ({id, type, released})),
    longTimers: [...globalThis.__cacheRecovery.longTimers.values()]})), page);
  assertFocus();return result;
}
async function closePage(page) {const result = await focusTrace.action('page.close', () => page.close(), page);assertFocus();return result;}
async function arm(page, type, hold = true) {
  await page.evaluate(({type, hold}) => globalThis.__cacheRecovery.rules[type].push({hold}), {type, hold});
}
async function heldId(page, type, after = 0) {
  await page.waitForFunction(({type, after}) => globalThis.__cacheRecovery.holds.some(entry => entry.type === type && entry.id > after && !entry.released), {type, after});
  return page.evaluate(({type, after}) => globalThis.__cacheRecovery.holds.find(entry => entry.type === type && entry.id > after && !entry.released).id, {type, after});
}
async function release(page, id) {await page.evaluate(id => globalThis.__cacheRecovery.release(id), id);}
async function openOptions() {
  const page = await openPage(`${origin}/${manifest.options_ui?.page || manifest.options_page}`, 'options-cache');
  await page.locator('nav button[data-section="settings-advanced"]').click();
  await page.waitForFunction(() => location.hash === '#settings-advanced');
  await page.locator('[data-settings-anchor-link="cache"]').click();
  await page.locator('[data-translation-cache-settings]').waitFor({state: 'visible'});
  await page.locator('[data-translation-cache-settings] button').filter({hasText: /^清空缓存$/}).waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-translation-cache-settings] button')).some(button => button.textContent.trim() === '清空缓存' && !button.disabled));
  return page;
}
const clearButton = (page, kind) => kind === 'popup' ? page.locator('footer button').filter({hasText: /清除缓存|清理中/})
  : page.locator('[data-translation-cache-settings] button').filter({hasText: /^清空缓存$/});
const status = (page, kind) => kind === 'popup' ? page.locator('.notice') : page.locator('[data-translation-cache-settings] [role="status"]');
async function openPopup() {
  const page = await openPage(`${origin}/${manifest.action.default_popup}`, 'popup-cache-tab');
  await page.locator('.popup-shell[data-config-ready="true"]').waitFor({state: 'visible'});
  await clearButton(page, 'popup').waitFor();return page;
}
async function waitEnabled(page, kind) {await clearButton(page, kind).waitFor();await page.waitForFunction(kind => {
  const buttons = document.querySelectorAll(kind === 'popup' ? 'footer button' : '[data-translation-cache-settings] button');
  return [...buttons].some(button => /清除缓存|清空缓存/.test(button.textContent) && !button.disabled);
}, kind);}
async function seedCache() {
  return worker.evaluate(async () => {
    const request = indexedDB.open('FluentReadTranslationCache');
    const database = await new Promise((resolve, reject) => {request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);});
    try {
      const record = {key: 'cache-recovery-production-fixture', translation: '受控缓存夹具', createdAt: Date.now(), lastAccessedAt: Date.now(), expiresAt: Date.now() + 86_400_000, byteSize: 128};
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(['entries', 'totals'], 'readwrite');
        transaction.objectStore('entries').put(record);transaction.objectStore('totals').put({id: 'totals', bytes: 128, entries: 1});
        transaction.oncomplete = resolve;transaction.onerror = () => reject(transaction.error);transaction.onabort = () => reject(transaction.error);
      });
      return {entries: 1, bytes: 128};
    } finally {database.close();}
  });
}
async function databaseCounts() {
  return worker.evaluate(async () => {
    const request = indexedDB.open('FluentReadTranslationCache');
    const database = await new Promise((resolve, reject) => {request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);});
    try {return await new Promise((resolve, reject) => {
      const transaction = database.transaction(['entries', 'totals']);
      const entries = transaction.objectStore('entries').count(), totals = transaction.objectStore('totals').get('totals');
      transaction.oncomplete = () => resolve({entries: entries.result, totals: totals.result || null});
      transaction.onerror = () => reject(transaction.error);transaction.onabort = () => reject(transaction.error);
    });} finally {database.close();}
  });
}

(async () => {
  try {
    monitor = helper.startFocusEventMonitor({onEvent: event => focusTrace.observeActivation(event), onError: error => {focusFailure ||= error;}});
    await monitor.ready;
    await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve);});
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      background: true, headless: false, displayTarget: 'secondary', viewport: {width: 1440, height: 1000},
      browserArgs: ['--no-first-run', '--no-default-browser-check', `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]});
    guardBrowserClose(session, profileDir);context = session.context;browserPid = await getGuardedBrowserPid(session);
    Object.assign(report, {browserPid, launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(session.launchMode, 'macos-background-cdp');assert.equal(session.focusPolicy, 'launchservices-no-foreground');
    assert.equal(session.windowPlacement.mode, 'background-visible-no-focus');assert.equal(session.windowPlacement.browserFrontmost, false);assertFocus();
    await diagnostics.start(context);
    worker = context.serviceWorkers().find(value => value.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', {timeout: 30_000});
    diagnostics.setExtensionId(new URL(worker.url()).host);origin = `chrome-extension://${new URL(worker.url()).host}`;
    const control = await openPage(`${origin}/icon/128.png`, 'cache-setup', false);
    await control.evaluate(async () => {
      const current = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!current?.success) throw new Error('Cache test configuration read failed');
      const patch = {uiLanguageSetupCompleted: true, uiLanguage: 'zh-CN', on: true, useCache: true, interfaceSkin: 'default', interfaceFont: 'system'};
      const result = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: patch,
        expected: Object.fromEntries(Object.keys(patch).map(key => [key, current.value[key]])),
        clientId: 'cache-recovery-setup', sequence: 1, baseRevision: current.value.__fluentConfigRevision || 0});
      if (!result?.success) throw new Error('Cache test configuration setup failed');
      const stats = await chrome.runtime.sendMessage({type: 'getTranslationCacheStats'});
      if (!stats?.success) throw new Error('Cache test database initialization failed');
    });
    const content = await openPage(`http://127.0.0.1:${server.address().port}/`, 'content-cache-receiver', false);
    await content.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
    await helper.activateExtensionTabWithoutForeground(context, content);assertFocus();

    for (const kind of ['options', 'popup']) {
      await runCase(`${kind}-normal-clear`, 'normal-production-flow', async () => {
        const page = kind === 'options' ? await openOptions() : await openPopup();
        const seeded = await seedCache();await clearButton(page, kind).click();
        await status(page, kind).filter({hasText: kind === 'popup' ? '全部翻译缓存已清除' : '翻译缓存已清空'}).waitFor();
        await waitEnabled(page, kind);const counts = await databaseCounts();assert.equal(counts.entries, 0);
        const probe = await readProbe(page);assert.equal(probe.receipts.find(value => value.type === 'clearTranslationCache')?.invalidationPending, false);
        const image = await screenshot(page, `${kind}-normal-clear`);await closePage(page);return {seeded, counts, probe, image};
      });
    }

    await runCase('real-clear-pending-content-notification', 'controlled-background-delivery-delay', async () => {
      const page = await openOptions();await seedCache();
      await worker.evaluate(() => {
        const native = chrome.tabs.sendMessage.bind(chrome.tabs);
        const gate = globalThis.__cacheBroadcastGate = {active: true, pending: [], attempts: 0};
        chrome.tabs.sendMessage = (...args) => {
          if (!gate.active || args[1]?.type !== 'translationCacheCleared') return native(...args);
          gate.attempts++;
          if (typeof args.at(-1) === 'function') {gate.pending.push(() => native(...args));return;}
          return new Promise((resolve, reject) => gate.pending.push(() => Promise.resolve(native(...args)).then(resolve, reject)));
        };
        gate.release = () => {gate.active = false;chrome.tabs.sendMessage = native;for (const deliver of gate.pending.splice(0)) deliver();};
      });
      const started = Date.now();await clearButton(page, 'options').click();
      await status(page, 'options').filter({hasText: '后台缓存已清除，部分页面仍在同步'}).waitFor();
      const elapsedMs = Date.now() - started, counts = await databaseCounts();assert.equal(counts.entries, 0);
      assert(elapsedMs >= 900 && elapsedMs < 10_000, 'real pending broadcast should finish the management response after its grace');
      const before = await worker.evaluate(() => ({attempts: globalThis.__cacheBroadcastGate.attempts, pending: globalThis.__cacheBroadcastGate.pending.length}));
      assert(before.pending > 0);const image = await screenshot(page, 'options-real-pending-notification');
      await worker.evaluate(() => globalThis.__cacheBroadcastGate.release());await page.waitForTimeout(250);
      const probe = await readProbe(page);assert.equal(probe.receipts.filter(value => value.type === 'clearTranslationCache').length, 1);
      assert.equal(probe.receipts.find(value => value.type === 'clearTranslationCache').invalidationPending, true);
      await closePage(page);return {elapsedMs, counts, notificationGate: before, probe, image};
    });

    for (const kind of ['options', 'popup']) {
      await runCase(`${kind}-ui-timeout-and-retry`, 'controlled-success-response-withheld', async () => {
        const page = kind === 'options' ? await openOptions() : await openPopup();
        await arm(page, 'clearTranslationCache');const started = Date.now();await clearButton(page, kind).click();
        const first = await heldId(page, 'clearTranslationCache');
        await status(page, kind).filter({hasText: '暂未确认清除结果，请稍后刷新'}).waitFor({timeout: 18_000});
        const elapsedMs = Date.now() - started;assert(elapsedMs >= 14_000 && elapsedMs < 19_000);await waitEnabled(page, kind);
        assert.equal(await status(page, kind).getAttribute('role'), 'status');
        const timeoutImage = await screenshot(page, `${kind}-unconfirmed`);
        await arm(page, 'clearTranslationCache');await clearButton(page, kind).click();const second = await heldId(page, 'clearTranslationCache', first);
        await release(page, first);await page.waitForTimeout(100);assert.equal(await clearButton(page, kind).isDisabled(), true);
        assert(!(await status(page, kind).count()) || !(await status(page, kind).innerText()).includes(kind === 'popup' ? '全部翻译缓存已清除' : '翻译缓存已清空'));
        await release(page, second);await waitEnabled(page, kind);
        await status(page, kind).filter({hasText: kind === 'popup' ? '全部翻译缓存已清除' : '翻译缓存已清空'}).waitFor();
        const image = await screenshot(page, `${kind}-retry-success`), probe = await readProbe(page);
        await closePage(page);return {elapsedMs, probe, timeoutImage, image};
      });
    }

    await runCase('options-clear-and-stats-share-deadline', 'controlled-clear-response-and-stats-response-withheld', async () => {
      const page = await openOptions();await arm(page, 'clearTranslationCache');await arm(page, 'getTranslationCacheStats');
      const started = Date.now();await clearButton(page, 'options').click();const clear = await heldId(page, 'clearTranslationCache');
      await page.waitForTimeout(Math.max(0, 13_000 - (Date.now() - started)));await release(page, clear);
      const stats = await heldId(page, 'getTranslationCacheStats', clear);
      await page.locator('[data-translation-cache-settings] [role="alert"]').filter({hasText: '暂时无法读取缓存用量'}).waitFor({timeout: 5_000});
      const elapsedMs = Date.now() - started;assert(elapsedMs >= 14_000 && elapsedMs < 18_000);await waitEnabled(page, 'options');
      await status(page, 'options').filter({hasText: '翻译缓存已清空'}).waitFor();
      await release(page, stats);await page.waitForTimeout(100);
      assert((await page.locator('[data-translation-cache-settings] [role="alert"]').innerText()).includes('暂时无法读取缓存用量'));
      const image = await screenshot(page, 'options-cleared-stats-unavailable'), probe = await readProbe(page);
      await closePage(page);return {elapsedMs, probe, image};
    });

    for (const destination of ['section-hide', 'keep-alive']) {
      await runCase(`options-${destination}-cancel`, 'controlled-success-response-withheld-during-navigation', async () => {
        const page = await openOptions();await arm(page, 'clearTranslationCache');await clearButton(page, 'options').click();
        const clear = await heldId(page, 'clearTranslationCache');assert((await readProbe(page)).longTimers.length > 0);
        const statsBefore = (await readProbe(page)).requests.filter(value => value.type === 'getTranslationCacheStats').length;
        // 高级页内顶部入口只滚动连续表单，不能把正常滚动误认为表单失活。
        await page.locator('[data-settings-anchor-link="recognition"]').click();
        assert((await readProbe(page)).longTimers.length > 0);
        assert.equal(new URL(page.url()).hash, '#settings-advanced');
        const target = destination === 'section-hide' ? 'settings-general' : 'settings-vocabulary';
        await page.locator(`nav button[data-section="${target}"]`).click();
        await page.waitForFunction(target => location.hash === `#${target}`, target);
        await page.waitForFunction(() => globalThis.__cacheRecovery.longTimers.size === 0);
        await release(page, clear);await page.waitForTimeout(150);
        assert.equal((await readProbe(page)).requests.filter(value => value.type === 'getTranslationCacheStats').length, statsBefore, 'hidden cache UI must not continue its statistics request');
        await page.locator('nav button[data-section="settings-advanced"]').click();await page.waitForFunction(() => location.hash === '#settings-advanced');
        await page.locator('[data-settings-anchor-link="cache"]').click();await waitEnabled(page, 'options');
        assert.equal(await status(page, 'options').count(), 0, 'old hidden clear response must not claim completion after re-entry');
        const image = await screenshot(page, `options-${destination}-cancel`), probe = await readProbe(page);
        await closePage(page);return {statsBefore, inPageNavigation: 'continuous-form-scroll-keeps-current-wait', probe, image};
      });
    }
    assert.equal(report.pageErrors.length, 0);report.ok = true;
  } catch (error) {
    report.ok = false;report.failure = error.stack;process.exitCode = 1;console.error(error);
    if (activePage && !activePage.isClosed()) {
      try {await screenshot(activePage, 'failure-current-ui');report.failureDom = (await activePage.locator('body').innerText()).slice(0, 12_000);}
      catch (captureError) {report.failureCaptureError = captureError.stack;}
    }
  } finally {
    const cleanup = async (label, action) => {try {await action();} catch (error) {report.ok = false;report.cleanupErrors.push({label, error: error.stack});process.exitCode = 1;}};
    await cleanup('runtime-diagnostics', async () => {
      await diagnostics.flush();report.runtimeDiagnostics = diagnostics.snapshot();
      fs.writeFileSync(path.join(artifactsDir, 'runtime-diagnostics.json'), JSON.stringify(report.runtimeDiagnostics, null, 2));
      if (report.ok) diagnostics.assertClean();
    });
    await cleanup('diagnostics-stop', () => diagnostics.stop());
    await cleanup('focus-trace', async () => {assert.equal(report.focusTraceErrors.length, 0, 'foreground trace samples incomplete; see focusTraceErrors');});
    let closed = false;
    await cleanup('owned-browser-close', async () => {if (session) {await session.close();closed = true;}});
    await cleanup('native-focus-monitor', async () => {
      if (monitor) {await monitor.stop();report.focusEvents = {events: monitor.events, browserActivations: monitor.events.filter(event => event.pid === browserPid), error: monitor.error?.message};assertFocus();}
    });
    if (closed) await cleanup('temporary-profile', async () => {fs.rmSync(profileDir, {recursive: true, force: true});report.profileRemoved = true;});
    else if (!launchAttempted) await cleanup('unused-temporary-profile', async () => {fs.rmdirSync(profileDir);report.profileRemoved = true;});
    await cleanup('fixture-server', async () => {if (server.listening) {server.closeAllConnections();await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));}});
    report.controlledFaults = report.cases.filter(value => value.kind !== 'normal-production-flow').map(({name, kind}) => ({name, kind}));
    save();console.log(JSON.stringify({ok: report.ok, cases: report.cases.map(({name, passed}) => ({name, passed})), failure: report.failure, cleanupErrors: report.cleanupErrors, artifactsDir}, null, 2));
  }
})();

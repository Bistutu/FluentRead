#!/usr/bin/env node
/**
 * @file scripts/testing/run-github-task-list-test.cjs
 * Exercise GitHub's hydrated task rows with a production extension in isolated, focus-safe Edge.
 * A local provider returns deterministic bilingual content. --live loads the real issue DOM;
 * otherwise the captured structural fixture also covers host mutations and node identity.
 * --baseline records the explicitly requested older artifact without claiming build freshness.
 */
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
const root = path.resolve(__dirname, '../..');
const args = {focusSafeHelper: path.join(__dirname, 'focus-safe-browser.cjs'), timeout: 30000, baseline: false, live: false};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--background') continue;
  if (key === '--baseline' || key === '--live') { args[key.slice(2)] = true; continue; }
  assert.ok(key.startsWith('--') && process.argv[i + 1], `Invalid argument ${key}`);
  args[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = process.argv[++i];
}
for (const key of ['extensionDir', 'playwrightRoot', 'focusSafeHelper', 'artifactsDir']) {
  assert.ok(args[key], `Missing ${key}`); args[key] = path.resolve(args[key]);
}
args.timeout = Number(args.timeout);
const helper = require(args.focusSafeHelper);
const {chromium} = createRequire(path.join(args.playwrightRoot, 'github-task-list.cjs'))('playwright');
const owned = '.fluent-read-bilingual-content';
const url = 'https://github.com/kohya-ss/musubi-tuner/issues/1029';
const taskSelector = '[class*="TaskListItem-module__task-list-html"]';
const bodySelector = '[data-testid="markdown-body"]';
const report = {
  scope: args.live ? 'live-GitHub-issue-1029-hydrated-DOM' : 'local-GitHub-hydrated-task-list-fixture',
  provider: 'microsoft-local-deterministic-response',
  profileMode: 'new-temporary-profile',
  baseline: args.baseline,
  cases: [], errors: [],
};
fs.mkdirSync(args.artifactsDir, {recursive: true});
const save = () => fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), JSON.stringify(report, null, 2));

async function main() {
  if (!args.baseline) assertFreshProductionExtension(args.extensionDir, root);
  report.extensionDir = args.extensionDir;
  report.contentSha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(args.extensionDir, 'content-scripts/content.js'))).digest('hex');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-github-task-list-'));
  let session, context, worker, popup, page, emulation;
  let primaryError;
  let sequence = 0;
  const installedWorkers = new WeakMap();
  const installWorker = current => {
    if (!installedWorkers.has(current)) installedWorkers.set(current, current.evaluate(() => {
      globalThis.taskListRequests = [];
      globalThis.failTaskListRequests = false;
      globalThis.fetch = async (input, init) => {
        const requestUrl = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
        if (requestUrl.hostname !== 'edge.microsoft.com' || requestUrl.pathname !== '/translate/translatetext') {
          throw Error('External provider fetch disabled');
        }
        const texts = JSON.parse(init?.body ?? await input.text());
        globalThis.taskListRequests.push(texts);
        if (globalThis.failTaskListRequests) return new Response('', {status: 503});
        return new Response(JSON.stringify(texts.map(text => ({translations: [{text: `测试译文：${text}`}]}))), {
          status: 200, headers: {'content-type': 'application/json'},
        });
      };
    }));
    return installedWorkers.get(current);
  };
  const patchConfig = async updates => {
    const result = await popup.evaluate(async ({updates, sequence}) => {
      const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const current = typeof read.value === 'string' ? JSON.parse(read.value) : read.value;
      return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: updates,
        expected: Object.fromEntries(Object.keys(updates).map(key => [key, current[key]])),
        clientId: 'github-task-list', sequence, baseRevision: current.__fluentConfigRevision});
    }, {updates, sequence: ++sequence});
    assert.equal(result.success, true, JSON.stringify(result));
  };
  const waitCount = (selector, expected) => page.waitForFunction(
    ({selector, expected}) => document.querySelectorAll(selector).length === expected,
    {selector, expected}, {timeout: args.timeout},
  );
  const full = async () => {
    await helper.activateExtensionTabWithoutForeground(context, page);
    await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
  };
  const hover = async index => {
    await helper.activateExtensionTabWithoutForeground(context, page);
    const target = page.locator(bodySelector).first().locator(taskSelector).nth(index);
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox(); assert.ok(box, `No box for task ${index}`);
    await page.mouse.move(box.x + 25, box.y + 8);
    await page.keyboard.down('Control'); await page.keyboard.up('Control');
  };
  const state = () => page.evaluate(({bodySelector, taskSelector, owned}) => {
    const body = document.querySelector(bodySelector);
    const rows = [...body.querySelectorAll(taskSelector)].filter(e => !e.closest(owned));
    return {
      bodyTotal: body.querySelectorAll(owned).length,
      taskWrappers: rows.map(row => row.querySelectorAll(owned).length),
      groupDirect: [...body.querySelectorAll('li')].filter(li => li.querySelector(taskSelector))
        .map(li => [...li.children].filter(child => child.matches(owned)).length),
      nested: document.querySelectorAll(`${owned} ${owned}`).length,
      hiddenWrappers: [...body.querySelectorAll('[id^="DndDescribedBy-"], [id^="DndLiveRegion-"]')]
        .reduce((total, element) => total + element.querySelectorAll(owned).length, 0),
      translatedHiddenText: [...body.querySelectorAll(owned)].some(element =>
        /To pick up a draggable item|Hidden drag movement announcement sentinel/.test(element.textContent)),
    };
  }, {bodySelector, taskSelector, owned});
  const waitTasks = expected => page.waitForFunction(({bodySelector, taskSelector, owned, expected}) => {
    const rows = [...document.querySelector(bodySelector).querySelectorAll(taskSelector)].filter(e => !e.closest(owned));
    return rows.length > 0 && rows.every(row => row.querySelectorAll(owned).length === expected);
  }, {bodySelector, taskSelector, owned, expected}, {timeout: args.timeout});
  const waitFull = () => args.live ? waitTasks(1) : page.waitForFunction(({bodySelector, taskSelector, owned}) => {
    const body = document.querySelector(bodySelector);
    if (!body) return false;
    const rows = [...body.querySelectorAll(taskSelector)].filter(row => !row.closest(owned));
    const headings = body.querySelectorAll('[data-testid="task-heading"]');
    const paragraphs = body.querySelectorAll('[data-testid="adjacent-paragraph"]');
    if (rows.length === 0 || headings.length !== 1 || paragraphs.length !== 1) return false;
    const owners = [headings[0], ...rows, paragraphs[0]];
    return owners.every(owner => owner.querySelectorAll(owned).length === 1)
      && body.querySelectorAll(owned).length === rows.length + 2;
  }, {bodySelector, taskSelector, owned}, {timeout: args.timeout});
  const captureTaskGroup = async body => {
    const clip = await body.locator('li').filter({has: page.locator(taskSelector)}).first().evaluate(group => {
      const rect = group.getBoundingClientRect();
      return {x: Math.max(0, rect.left + scrollX), y: Math.max(0, rect.top + scrollY),
        width: rect.width, height: rect.height, scale: 1};
    });
    const screenshotSession = await context.newCDPSession(page);
    let screenshotError;
    try {
      const result = await screenshotSession.send('Page.captureScreenshot', {format: 'png', clip, captureBeyondViewport: true, fromSurface: true});
      fs.writeFileSync(path.join(args.artifactsDir, 'translated-task-group.png'), Buffer.from(result.data, 'base64'));
    } catch (error) {screenshotError = error; throw error;}
    finally {
      try {await screenshotSession.detach();} catch (error) {
        if (!screenshotError) throw error;
        process.stderr.write(`CDP detach failed: ${error.stack || error}\n`);
      }
    }
  };
  const assertGranularity = actual => {
    assert.ok(actual.groupDirect.every(count => count === 0), 'outer group LI must not own a combined wrapper');
    assert.equal(actual.nested, 0, 'wrappers must not be nested');
    assert.equal(actual.hiddenWrappers, 0, 'hidden DnD helpers must not own translations');
    assert.equal(actual.translatedHiddenText, false, 'hidden DnD text must not be exposed by rendering');
  };
  const captureHost = async () => page.evaluate(({bodySelector, owned}) => {
    const body = document.querySelector(bodySelector);
    window.taskListPristineRow = body.querySelector('[data-testid="task-rows"]')?.firstElementChild?.cloneNode(true);
    window.taskListHostNodes = [...body.querySelectorAll('input, a, code, svg, [id^="Dnd"]')]
      .filter(node => !node.closest(owned)).map(node => ({node, html: node.outerHTML}));
    return window.taskListHostNodes.length;
  }, {bodySelector, owned});
  const assertHost = async () => {
    const result = await page.evaluate(() => window.taskListHostNodes.map(({node, html}) => ({
      connected: node.isConnected, unchanged: node.outerHTML === html, tag: node.tagName,
    })));
    assert.ok(result.every(item => item.connected && item.unchanged), 'source controls/links/code/SVG/hidden helpers must retain identity and markup');
    assert.equal(await page.locator(`${owned} input`).count(), 0, 'translation must not duplicate native checkbox controls');
    assert.equal(page.url(), url);
  };
  const assertRequests = async () => {
    const requests = await worker.evaluate(() => globalThis.taskListRequests.flat());
    report.requests = requests;
    assert.equal(requests.some(request => /To pick up a draggable item|Hidden drag movement announcement sentinel/.test(String(request))), false,
      'hidden DnD prose must never enter the provider request');
    const sentinels = args.live ? ['Initial MiniMax-H3 support:', 'ConvRot INT8 quantized base weights:', 'NVFP4 support']
      : ['Initial model support:', 'Quantized base weights:', 'Streaming encoder support'];
    for (const sentinel of sentinels) assert.ok(requests.some(request => String(request).includes(sentinel)), `${sentinel} was never requested`);
    assert.equal(requests.some(request => sentinels.filter(sentinel => String(request).includes(sentinel)).length > 1), false,
      'two task rows must never share one provider request');
  };

  let launchAttempted = false;
  try {
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: args.browserPath || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      background: true, headless: false, viewport: {width: 1280, height: 900}, displayTarget: 'secondary', timeout: args.timeout,
      browserArgs: [`--disable-extensions-except=${args.extensionDir}`, `--load-extension=${args.extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    context = session.context;
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    context.on('serviceworker', current => { void installWorker(current).catch(error => report.errors.push(error.message)); });
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await installWorker(worker);
    if (!args.live) {
      const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/translation-pages/github-task-list.html'), 'utf8');
      await context.route('**/*', route => {
        if (route.request().isNavigationRequest() && route.request().url() === url) return route.fulfill({status: 200, contentType: 'text/html', body: fixture});
        if (/^https?:/u.test(route.request().url())) return route.abort('blockedbyclient');
        return route.continue();
      });
    }
    popup = await helper.newPageWithoutForeground(context, args.timeout);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await popup.waitForTimeout(600);
    await patchConfig({service: 'microsoft', from: 'en', to: 'zh-Hans', display: 1, style: 1, autoTranslate: false,
      hotkey: 'Control', floatingBallHotkey: 'Alt+T', mouseHoverTranslationDelay: 0, fullPageTranslationMode: 'all',
      useCache: false, enableAIContext: false, enableAIMultiSegment: false, uiLanguageSetupCompleted: true});
    page = await helper.newPageWithoutForeground(context, args.timeout);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000});
    await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
    await page.waitForSelector(taskSelector, {state: 'visible'});
    await page.waitForTimeout(args.live ? 3000 : 600);
    const body = page.locator(bodySelector).first();
    const original = await body.innerHTML();
    fs.writeFileSync(path.join(args.artifactsDir, 'before.html'), original);
    report.hostNodeCount = await captureHost();
    const result = {name: 'hover-full-restore-retranslate', before: await state()}; report.cases.push(result);
    await page.screenshot({caret: 'initial', path: path.join(args.artifactsDir, 'before.png')});

    await hover(0);
    await page.waitForFunction(({bodySelector, taskSelector, owned}) =>
      document.querySelector(bodySelector).querySelector(taskSelector).querySelectorAll(owned).length === 1,
    {bodySelector, taskSelector, owned}, {timeout: args.timeout});
    result.hover = await state(); assertGranularity(result.hover);
    assert.equal(result.hover.taskWrappers[0], 1);
    assert.ok(result.hover.taskWrappers.slice(1).every(count => count === 0), 'hover must leave adjacent task rows untranslated');
    await assertHost();
    await hover(0); await waitCount(`${bodySelector} ${owned}`, 0);
    await assertHost();
    assert.equal(await body.innerHTML(), original, 'hover restore must recover exact original source DOM');
    await hover(0);
    await page.waitForFunction(({bodySelector, taskSelector, owned}) =>
      document.querySelector(bodySelector).querySelector(taskSelector).querySelectorAll(owned).length === 1,
    {bodySelector, taskSelector, owned}, {timeout: args.timeout});
    result.hoverRetranslated = await state(); assertGranularity(result.hoverRetranslated);
    await hover(0); await waitCount(`${bodySelector} ${owned}`, 0);

    await full(); await waitFull(); await waitCount('.fluent-read-loading', 0);
    result.full = await state(); assertGranularity(result.full); await assertHost(); await assertRequests();
    await page.screenshot({caret: 'initial', path: path.join(args.artifactsDir, 'translated.png')});
    if (args.live) await captureTaskGroup(body);
    fs.writeFileSync(path.join(args.artifactsDir, 'translated.html'), await body.innerHTML());
    await full(); await waitCount(owned, 0); await page.waitForTimeout(200);
    result.restored = await state(); assert.deepEqual(result.restored, result.before); await assertHost();
    assert.equal(await body.innerHTML(), original, 'full restore must recover exact original source DOM');
    await full(); await waitFull(); await waitCount('.fluent-read-loading', 0);
    result.retranslated = await state(); assertGranularity(result.retranslated); await assertHost();
    assert.equal(result.retranslated.bodyTotal, result.full.bodyTotal, 'retranslation must not duplicate wrappers');
    await page.screenshot({caret: 'initial', path: path.join(args.artifactsDir, 'retranslated.png')});
    result.passed = true;

    if (!args.live) {
      const narrow = {name: 'narrow-task-wrapping', viewportWidth: 390}; report.cases.push(narrow);
      emulation = await context.newCDPSession(page);
      await emulation.send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: false});
      await page.waitForTimeout(200);
      narrow.geometry = await page.evaluate(({taskSelector, owned}) => ({
        width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        rows: [...document.querySelectorAll(taskSelector)].filter(row => !row.closest(owned)).map(row => ({
          width: row.getBoundingClientRect().width, scrollWidth: row.scrollWidth,
          translations: row.querySelectorAll(owned).length,
        })),
      }), {taskSelector, owned});
      assert.equal(narrow.geometry.width, 390);
      assert.ok(narrow.geometry.documentWidth <= 391, '390px reading viewport must not overflow horizontally');
      assert.ok(narrow.geometry.rows.every(row => row.scrollWidth <= row.width + 1 && row.translations === 1));
      await page.screenshot({caret: 'initial', path: path.join(args.artifactsDir, 'narrow.png')});
      await emulation.send('Emulation.clearDeviceMetricsOverride'); await emulation.detach();
      emulation = null;
      narrow.passed = true;
      const dynamic = {name: 'dynamic-task-source-controls-and-hidden-updates'}; report.cases.push(dynamic);
      await page.evaluate(({taskSelector, owned}) => {
        const existing = [...document.querySelectorAll(taskSelector)].filter(e => !e.closest(owned));
        window.taskListStableWrappers = existing.map(row => row.querySelector(owned));
        const newRow = window.taskListPristineRow.cloneNode(true);
        newRow.querySelectorAll(owned).forEach(element => element.remove());
        newRow.querySelectorAll('[data-testid]').forEach(element => element.removeAttribute('data-testid'));
        newRow.querySelector('[class*="TaskListItem-module__task-list-item__"]').setAttribute('data-testid', 'tasklist-item-0-3');
        const content = newRow.querySelector(taskSelector);
        content.innerHTML = 'Dynamic task support: preserve the checkbox and <a href="https://github.com/kohya-ss/musubi-tuner/pull/1032">native issue link</a>.';
        content.setAttribute('data-testid', 'dynamic-task-content');
        newRow.querySelector('[id]').id = 'checkbox-item-dynamic';
        const checkbox = newRow.querySelector('input'); checkbox.disabled = false; checkbox.checked = false;
        checkbox.removeAttribute('disabled'); checkbox.removeAttribute('checked'); checkbox.setAttribute('aria-checked', 'false');
        window.taskListDynamicEvents = {checkbox: 0, link: 0};
        checkbox.addEventListener('change', () => { window.taskListDynamicEvents.checkbox += 1; });
        content.querySelector('a').addEventListener('click', event => { event.preventDefault(); window.taskListDynamicEvents.link += 1; });
        window.taskListDynamicCheckbox = checkbox; window.taskListDynamicLink = content.querySelector('a');
        document.querySelector('[data-testid="task-rows"]').append(newRow);
      }, {taskSelector, owned});
      await waitTasks(1); await waitCount('.fluent-read-loading', 0);
      dynamic.added = await state(); assertGranularity(dynamic.added); assert.equal(dynamic.added.taskWrappers.length, 4);
      assert.equal(await page.evaluate(() => window.taskListStableWrappers.every(node => node.isConnected)), true,
        'adding a task must preserve completed neighboring translations');
      await page.locator('#checkbox-item-dynamic input').click();
      await page.locator('[data-testid="dynamic-task-content"] > a').click();
      assert.deepEqual(await page.evaluate(() => ({...window.taskListDynamicEvents, checked: window.taskListDynamicCheckbox.checked,
        sameCheckbox: document.querySelector('#checkbox-item-dynamic input') === window.taskListDynamicCheckbox,
        sameLink: document.querySelector('[data-testid="dynamic-task-content"] > a') === window.taskListDynamicLink})),
      {checkbox: 1, link: 1, checked: true, sameCheckbox: true, sameLink: true});
      const requestsBeforeHiddenChange = await worker.evaluate(() => globalThis.taskListRequests.length);
      await page.evaluate(() => { document.querySelector('#DndLiveRegion-0').textContent = 'Hidden drag movement announcement sentinel changed.'; });
      await page.waitForTimeout(500);
      assert.equal(await worker.evaluate(() => globalThis.taskListRequests.length), requestsBeforeHiddenChange,
        'hidden drag announcements must not trigger translation requests');
      await page.evaluate(() => { document.querySelector('[data-testid="dynamic-task-content"]').firstChild.nodeValue = 'Updated dynamic task support: keep the checkbox and '; });
      await page.waitForFunction(({owned}) => document.querySelector('[data-testid="dynamic-task-content"]')
        .querySelector(owned)?.textContent.includes('Updated dynamic task support'), {owned}, {timeout: args.timeout});
      dynamic.updated = await state(); assertGranularity(dynamic.updated);
      assert.equal(await page.evaluate(() => window.taskListStableWrappers.every(node => node.isConnected)), true);
      await assertRequests();
      await full(); await waitCount(owned, 0);
      assert.equal(await page.evaluate(() => window.taskListDynamicCheckbox.checked && window.taskListDynamicCheckbox.isConnected && window.taskListDynamicLink.isConnected), true);
      await full(); await waitFull(); await waitCount('.fluent-read-loading', 0);
      dynamic.retranslated = await state(); assertGranularity(dynamic.retranslated);
      assert.equal(dynamic.retranslated.taskWrappers.length, 4);
      await page.screenshot({caret: 'initial', path: path.join(args.artifactsDir, 'dynamic.png')});
      dynamic.passed = true;
      const remount = {name: 'translated-task-row-remount-and-restore'}; report.cases.push(remount);
      await page.locator('[data-testid="tasklist-item-0-1"]').evaluate(task => {
        const row = task.closest('[class*="TaskListItems-module__task-list-item"]');
        row.replaceWith(row.cloneNode(true));
      });
      await page.waitForTimeout(700); await waitTasks(1);
      remount.translated = await state(); assertGranularity(remount.translated);
      await full(); await waitCount(owned, 0);
      remount.restored = await state(); assertGranularity(remount.restored);
      assert.equal(await page.locator('[data-testid="task-content-1"]').count(), 1);
      await full(); await waitFull(); await waitCount('.fluent-read-loading', 0);
      remount.retranslated = await state(); assertGranularity(remount.retranslated);
      assert.deepEqual(remount.retranslated.taskWrappers, [1, 1, 1, 1]);
      await full(); await waitCount(owned, 0); remount.passed = true;
      const retry = {name: 'task-provider-failure-and-retry'}; report.cases.push(retry);
      await worker.evaluate(() => { globalThis.failTaskListRequests = true; });
      await hover(1);
      await waitCount('[data-testid="task-content-1"] .fluent-read-retry-wrapper', 1);
      retry.failed = await state(); assertGranularity(retry.failed);
      assert.ok(retry.failed.taskWrappers.every(count => count === 0));
      await worker.evaluate(() => { globalThis.failTaskListRequests = false; });
      await page.locator('[data-testid="task-content-1"] .fluent-read-retry').click();
      await waitCount('[data-testid="task-content-1"] ' + owned, 1);
      retry.recovered = await state(); assertGranularity(retry.recovered);
      assert.deepEqual(retry.recovered.taskWrappers, [0, 1, 0, 0]);
      await hover(1); await waitCount(owned, 0);
      retry.passed = true;
    }
    // A live GitHub page may emit unrelated site errors; retain them as evidence, while the
    // controlled fixture has no external scripts and must be completely clean.
    if (!args.live) assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {
    primaryError = error;
    report.error = error.stack;
    if (page) {
      report.failureState = await state().catch(() => null);
      report.requests = await worker?.evaluate(() => globalThis.taskListRequests.flat()).catch(() => []);
      await page.screenshot({caret: 'initial', path: path.join(args.artifactsDir, 'failure.png')}).catch(() => {});
      const html = await page.locator(bodySelector).first().innerHTML().catch(() => '');
      try {fs.writeFileSync(path.join(args.artifactsDir, 'failure.html'), html);}
      catch (artifactError) {process.stderr.write(`Failure artifact write failed: ${artifactError.stack || artifactError}\n`);}
    }
    throw error;
  } finally {
    const cleanupErrors = [];
    const cleanup = async action => {
      try {await action();} catch (error) {cleanupErrors.push(error);}
    };
    let browserClosed = false;
    await cleanup(async () => {if (emulation) await emulation.send('Emulation.clearDeviceMetricsOverride');});
    await cleanup(async () => {await emulation?.detach();});
    await cleanup(async () => {
      if (session) {await session.close(); browserClosed = true;}
    });
    await cleanup(() => {
      if (browserClosed) fs.rmSync(profileDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
      else if (!launchAttempted) {
        // No browser launch was attempted; only remove an empty initial profile.
        try {fs.rmdirSync(profileDir);} catch (error) {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
      }
    });
    if (cleanupErrors.length) {
      report.passed = false;
      report.cleanupErrors = cleanupErrors.map(error => error.stack || String(error));
    }
    await cleanup(() => {save();});
    for (const error of cleanupErrors) process.stderr.write(`Cleanup failed: ${error.stack || error}\n`);
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  }
  console.log(JSON.stringify({passed: report.passed, scope: report.scope, cases: report.cases, artifacts: args.artifactsDir}));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

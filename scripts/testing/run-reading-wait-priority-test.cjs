#!/usr/bin/env node
'use strict';
/**
 * @file scripts/testing/run-reading-wait-priority-test.cjs
 * 文件职责：比较相同生产扩展材料、服务配置和确定性本地 HTTP 延迟下的首屏与滚动阅读等待。
 * 主要内容：真实可信快捷键、连续 80ms 滚动、HTTP 请求/文本槽/并发预算、逐帧译文可读性、长任务和会话终止证据。
 * 模块边界：复用既有微软协议响应、worker transport adapter 与 focus-safe 临时 Edge；数字只证明插件侧调度，不代表在线服务延迟。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const {readConfig, installTranslationFixtureOnWorker, toggleFullPage,
  buildFixtureMicrosoftResponseBody} = require('../run-full-page-translation-test.cjs');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');

const root = path.resolve(__dirname, '../..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const phase = argument('phase', 'optimized');
assert.ok(['baseline', 'optimized'].includes(phase), '--phase must be baseline or optimized');
const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(argument('artifacts-dir', `/private/tmp/fluentread-reading-wait-${phase}`));
const playwrightRoot = argument('playwright-root');
assert.ok(playwrightRoot, '--playwright-root is required');
const iterations = Number(argument('iterations', '3'));
assert.ok(Number.isInteger(iterations) && iterations > 0 && iterations <= 10, '--iterations must be 1..10');
const transportDelayMs = Number(argument('delay-ms', '180'));
assert.ok(Number.isFinite(transportDelayMs) && transportDelayMs >= 0, '--delay-ms must be non-negative');
const measurementsOnly = process.argv.includes('--measurements-only');
const lifecycleOnly = process.argv.includes('--lifecycle-only');
assert.ok(!(measurementsOnly && lifecycleOnly), 'Measurement-only and lifecycle-only scopes are exclusive');
const lifecycleCase = argument('lifecycle-case');
const lifecycleNames = ['concurrency-hold', 'restore-retranslate', 'global-off', 'language-switch', 'dynamic-dom', 'failure-retry', 'unload', 'hover-toggle'];
assert.ok(!lifecycleCase || lifecycleOnly && lifecycleNames.includes(lifecycleCase), '--lifecycle-case requires --lifecycle-only and a known case name');
const helper = require(argument('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs')));
const {chromium} = createRequire(path.join(path.resolve(playwrightRoot), 'reading-wait.cjs'))('playwright');
const marker = '.fluent-read-bilingual-content';
const timeout = 20000;
const html = fs.readFileSync(path.join(root, 'tests/fixtures/reading-wait-priority.html'), 'utf8');
const report = {
  phase, extensionDir, fixtureSha256: crypto.createHash('sha256').update(html).digest('hex'),
  transportDelayMs, iterations: lifecycleOnly ? 0 : iterations, measurementsOnly, lifecycleOnly, lifecycleCase, profileMode: 'automatically-created-temporary-profile',
  evidence: 'Production extension and real Edge; deterministic local Microsoft HTTP transport. These timings measure plugin scheduling and DOM readiness, not online provider latency or translation quality.',
  cases: [], lifecycle: [], requests: [], errors: [], consoleErrors: [], blockedNetwork: [], screenshots: [], passed: false,
};
fs.mkdirSync(artifactsDir, {recursive: true});
const save = () => fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeoutMs = timeout) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await wait(20);
  assert.ok(predicate(), `${label} timed out`);
}
function listen(server) {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
}
function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

async function main() {
  if (phase === 'optimized') assertFreshProductionExtension(extensionDir, root);
  report.contentSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir, 'content-scripts/content.js'))).digest('hex');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-reading-wait-'));
  const state = {delayMs: transportDelayMs, label: 'steady', failMarker: '', failCount: 0,
    active: 0, maxActive: 0, activeItems: 0, maxActiveItems: 0};
  let session, page, provider, server, primaryError, browserClosed = false;
  let launchAttempted = false;
  try {
    provider = http.createServer(async (request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/blocked') {
        report.blockedNetwork.push(url.searchParams.get('url'));
        response.writeHead(502); response.end('External transport disabled'); return;
      }
      if (url.pathname !== '/translate' || request.method !== 'POST') { response.writeHead(404); response.end(); return; }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const entry = {at: Date.now(), payload, items: payload.length, delayMs: state.delayMs, label: state.label, aborted: false};
      // The existing document-title request is independent of full-page paragraph
      // candidate slots. Count body markers separately rather than treating HTTP
      // batches, source slots and title work as the same concurrency unit.
      const paragraphItems = payload.filter(text => /^(?:Reading marker \d+:|Dynamic reading marker:)/.test(text)).length;
      entry.paragraphItems = paragraphItems;
      report.requests.push(entry); state.active++; state.activeItems += paragraphItems;
      state.maxActive = Math.max(state.maxActive, state.active); state.maxActiveItems = Math.max(state.maxActiveItems, state.activeItems);
      let released = false;
      const release = () => { if (!released) { released = true; state.active--; state.activeItems -= paragraphItems; } };
      response.once('close', () => { if (!response.writableEnded) entry.aborted = true; release(); });
      await wait(entry.delayMs);
      if (response.destroyed) return;
      entry.respondedAt = Date.now();
      const failed = state.failMarker && payload.some(text => String(text).includes(state.failMarker)) && state.failCount++ === 0;
      entry.failed = Boolean(failed);
      response.writeHead(failed ? 400 : 200, {'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
      response.end(failed ? JSON.stringify({error: 'Intentional first attempt failure'}) : buildFixtureMicrosoftResponseBody(payload.map(text => `${entry.label} ${text}`)));
      release();
    });
    await listen(provider);
    const translationUrl = `http://127.0.0.1:${provider.address().port}/translate`;
    server = http.createServer((request, response) => {
      if (!request.url.startsWith('/reading-wait-priority.html')) { response.writeHead(404); response.end(); return; }
      const paragraphs = new URL(request.url, 'http://127.0.0.1').searchParams.get('paragraphs') === '1000' ? 1000 : 80;
      response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
      response.end(paragraphs === 80 ? html : html.replace('index < 80', 'index < 1000'));
    });
    await listen(server);
    const fixtureUrl = `http://127.0.0.1:${server.address().port}/reading-wait-priority.html`;
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: argument('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      background: true, headless: false, displayTarget: 'secondary', viewport: {width: 1280, height: 900},
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    const {context} = session;
    report.browserVersion = context.browser().version();
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    const worker = context.serviceWorkers().find(item => item.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker');
    await installTranslationFixtureOnWorker(worker, {translationUrl, blockedUrl: translationUrl.replace('/translate', '/blocked')});
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        report.blockedNetwork.push(route.request().url()); await route.abort('blockedbyclient');
      } else await route.continue();
    });
    const createPage = () => helper.newPageWithoutForeground(context);
    const patch = {on: true, service: 'microsoft', from: 'en', to: 'zh-Hans', display: 1, style: 1,
      hotkey: 'Control', floatingBallHotkey: 'Alt+T', fullPageTranslationMode: 'viewport', translationScope: 'all',
      mouseHoverTranslationDelay: 0, useCache: false, autoTranslate: false, maxConcurrentTranslations: 3,
      translationRequestsPerSecond: 0, translationRequestsPerMinute: 0, enableAIContext: false,
      enableAIMultiSegment: false, disableFloatingBall: true, uiLanguageSetupCompleted: true, uiLanguage: 'zh-CN'};
    const {config} = await readConfig(context, timeout, patch, createPage);
    report.config = Object.fromEntries(Object.keys(patch).map(key => [key, config[key]]));
    page = await createPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error') report.consoleErrors.push(msg.text()); });
    const activate = p => helper.activateExtensionTabWithoutForeground(context, p);
    const toggle = () => toggleFullPage(page, activate);
    const ready = async (label, paragraphs = 80) => {
      state.delayMs = transportDelayMs; state.label = 'steady'; state.failMarker = ''; state.failCount = 0;
      await page.goto(`${fixtureUrl}?case=${encodeURIComponent(label)}&paragraphs=${paragraphs}`, {waitUntil: 'domcontentloaded'});
      await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
      report.pageViewport ||= await page.evaluate(() => ({innerWidth, innerHeight, devicePixelRatio}));
      await activate(page); await page.waitForTimeout(350);
      await page.evaluate(() => {
        window.__readingFrames = []; window.__readingLongTasks = []; window.__readingStop = false;
        window.__readingObserver = new PerformanceObserver(list => window.__readingLongTasks.push(...list.getEntries().map(entry => ({start: entry.startTime, duration: entry.duration}))));
        window.__readingObserver.observe({type: 'longtask', buffered: true});
      });
    };
    const measureStart = async (ids, jumpTarget) => {
      const startRequest = report.requests.length;
      await page.evaluate(({ids, jumpTarget}) => {
        window.__readingStart = performance.now(); window.__readingEpoch = Date.now(); window.__readingIds = ids;
        window.__readingScrollEnd = null;
        if (jumpTarget) {
          const top = document.getElementById(jumpTarget).getBoundingClientRect().top + scrollY;
          scrollTo(0, top - 100);
        }
        // Snapshot once, including partially visible paragraphs. Never rescan all
        // 1000 paragraph rectangles in every animation frame of the dense case.
        const paragraphs = [...document.querySelectorAll('#article p')];
        window.__readingViewportIds = paragraphs.filter(node => {
          const rect = node.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight;
        }).map(node => node.id);
        const initialIds = new Set(__readingViewportIds);
        const indexes = paragraphs.flatMap((node, index) => initialIds.has(node.id) ? [index] : []);
        window.__readingMonitoredIds = paragraphs.slice(Math.max(0, Math.min(...indexes) - 2), Math.max(...indexes) + 3).map(node => node.id);
        window.__readingFrames = []; window.__readingStop = false;
        const frame = () => {
          const targets = __readingIds.map(id => {
            const node = document.getElementById(id), rect = node?.getBoundingClientRect();
            return {id, top: rect?.top, bottom: rect?.bottom, visible: !!rect && rect.bottom > 0 && rect.top < innerHeight,
              ready: node?.querySelectorAll('.fluent-read-bilingual-content').length === 1};
          });
          const viewport = __readingMonitoredIds.map(id => {
            const node = document.getElementById(id), rect = node?.getBoundingClientRect();
            const wrappers = node?.querySelectorAll('.fluent-read-bilingual-content');
            const translationRect = wrappers?.length === 1 ? wrappers[0].getBoundingClientRect() : null;
            return {id, visible: !!rect && rect.bottom > 0 && rect.top < innerHeight,
              ready: wrappers?.length === 1,
              translationVisible: !!translationRect && translationRect.height > 0 && translationRect.bottom > 0 && translationRect.top < innerHeight};
          }).filter(target => target.visible);
          const snapshot = __readingViewportIds.map(id => ({id, ready: document.getElementById(id)?.querySelectorAll('.fluent-read-bilingual-content').length === 1}));
          __readingFrames.push({at: performance.now() - __readingStart, scrollY, targets, viewport, snapshot});
          if (!__readingStop) requestAnimationFrame(frame);
        };
        frame();
      }, {ids, jumpTarget});
      return startRequest;
    };
    const finishMeasure = async (name, startRequest, extra = {}) => {
      await page.waitForFunction(() => {
        const visible = __readingMonitoredIds.map(id => document.getElementById(id)).filter(node => {
          const rect = node?.getBoundingClientRect(); return !!rect && rect.bottom > 0 && rect.top < innerHeight;
        });
        return visible.length > 0 && visible.every(node => node.querySelectorAll('.fluent-read-bilingual-content').length === 1);
      }, undefined, {timeout});
      await page.waitForTimeout(40);
      const measurementWindowMs = name === 'first-screen' ? 800 : 2600;
      const remaining = await page.evaluate(horizon => Math.max(0, horizon - (performance.now() - __readingStart)), measurementWindowMs);
      if (remaining) await page.waitForTimeout(remaining);
      const data = await page.evaluate(() => {
        __readingStop = true;
        const finalViewportIds = [...document.querySelectorAll('#article p')].filter(node => {
          const rect = node.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight;
        }).map(node => node.id);
        return {epoch: __readingEpoch, viewportIds: __readingViewportIds, monitoredIds: __readingMonitoredIds, finalViewportIds,
          frames: __readingFrames, longTasks: __readingLongTasks.filter(task => task.start >= __readingStart),
          scrollEndMs: __readingScrollEnd == null ? null : __readingScrollEnd - __readingStart};
      });
      const requests = report.requests.slice(startRequest).filter(entry => entry.at - data.epoch >= 0 && entry.at - data.epoch <= measurementWindowMs);
      const first = data.frames.find(frame => frame.viewport.some(target => target.ready && target.translationVisible));
      const firstDomReady = data.frames.find(frame => frame.viewport.some(target => target.ready));
      const complete = data.frames.find(frame => frame.viewport.length > 0 && frame.viewport.every(target => target.ready));
      const snapshotComplete = data.frames.find(frame => frame.snapshot.every(target => target.ready));
      const targetThreeFirst = data.frames.find(frame => frame.targets.some(target => target.ready));
      const targetThreeComplete = data.frames.find(frame => frame.targets.every(target => target.ready));
      assert.ok(first && complete, `${name} must have measured first and complete DOM readiness`);
      assert.ok(data.finalViewportIds.every(id => data.monitoredIds.includes(id)), 'Bounded per-frame monitoring may not omit an actual final visible paragraph');
      const result = {name, ...extra, firstReadableMs: first.at, viewportCompleteMs: complete.at,
        firstDomReadyMs: firstDomReady?.at ?? null,
        viewportSnapshotCompleteMs: snapshotComplete?.at ?? null,
        targetThreeFirstDomReadyMs: targetThreeFirst?.at, targetThreeCompleteMs: targetThreeComplete?.at,
        measurementWindowMs,
        firstRequestMs: requests[0]?.at - data.epoch, firstResponseMs: requests.find(entry => entry.respondedAt)?.respondedAt - data.epoch,
        requestCount: requests.length, textSlots: requests.reduce((sum, entry) => sum + entry.items, 0),
        maxLongTaskMs: Math.max(0, ...data.longTasks.map(task => task.duration)), longTaskCount: data.longTasks.length,
        scrollEndMs: data.scrollEndMs, targetsVisibleThroughout: data.frames.every(frame => frame.targets.every(target => target.visible)),
        ...data};
      report.cases.push(result); save();
      console.log(JSON.stringify({...result, frames: undefined, longTasks: undefined}));
      return result;
    };
    const scrollContinuously = async (target, jump = false) => {
      await page.evaluate(async ({target, jump}) => {
        window.__readingScrollEnd = null;
        if (jump) {
          const top = document.getElementById(target).getBoundingClientRect().top + scrollY;
          scrollTo(0, top - 100);
        }
        for (let count = 0; count < 20; count++) {
          await new Promise(resolve => setTimeout(resolve, 80));
          scrollBy(0, 3);
        }
        window.__readingScrollEnd = performance.now();
      }, {target, jump});
    };
    for (let iteration = 0; iteration < (lifecycleOnly ? 0 : iterations); iteration++) {
      await ready(`measure-${iteration}`);
      let startRequest = await measureStart(['p0', 'p1', 'p2']);
      await toggle();
      await finishMeasure('first-screen', startRequest, {iteration});
      assert.equal(await page.locator(`#p40 ${marker}`).count(), 0, 'Far target must be untranslated before jump');
      await until(() => state.active === 0, 'first-screen HTTP idle');
      startRequest = await measureStart(['p40', 'p41', 'p42'], 'p40');
      await scrollContinuously('p40');
      const scrolling = await finishMeasure('continuous-scroll', startRequest, {iteration, steps: 20, stepIntervalMs: 80, pixelsPerStep: 3});
      scrolling.targetsVisibleDuringScroll = scrolling.frames.filter(frame => frame.scrollY > 1000).every(frame => frame.targets.every(target => target.visible));
      assert.ok(scrolling.targetsVisibleDuringScroll, 'Reading targets must stay visible during the continuous scroll');
      assert.ok(scrolling.scrollEndMs >= 1600, 'Scroll must remain active for at least 1600ms');
      const targetRequests = report.requests.slice(startRequest).filter(entry => entry.payload.some(text => /Reading marker 4[0-2]:/.test(text)));
      scrolling.targetRequestMs = targetRequests[0]?.at - scrolling.epoch;
      scrolling.targetResponseMs = targetRequests.find(entry => entry.respondedAt)?.respondedAt - scrolling.epoch;
      if (phase === 'baseline') assert.ok(scrolling.targetRequestMs >= scrolling.scrollEndMs + 150,
        'Baseline must reproduce requests waiting until continuous scroll settles');
      else {
        assert.ok(scrolling.firstReadableMs < scrolling.scrollEndMs, 'Visible text must become readable during continuous scroll');
        assert.ok(scrolling.viewportCompleteMs < scrolling.scrollEndMs, 'Current viewport must finish before continuous scroll ends');
        const during = report.requests.slice(startRequest).filter(entry => entry.at - scrolling.epoch < scrolling.scrollEndMs);
        assert.ok(during.every(entry => entry.payload.every(text => /Reading marker (?:39|4[0-3]):/.test(text))), 'While scrolling, only current visible paragraphs may consume requests');
      }
      await page.locator('#host-control').click();
      assert.equal(await page.evaluate(() => window.hostClicks), 1);
      await page.screenshot({path: path.join(artifactsDir, `scroll-${iteration}.png`)});
      report.screenshots.push(path.join(artifactsDir, `scroll-${iteration}.png`)); save();
    }

    // Eager mode discovers 1000 pending paragraphs; the same visible-candidate policy must
    // not turn repeated scroll pulses into long main-thread tasks or unlimited requests.
    if (!lifecycleOnly) {
      await readConfig(context, timeout, {fullPageTranslationMode: 'all'}, createPage);
      await ready('dense-eager', 1000);
      await toggle(); await page.waitForSelector(`#p0 ${marker}`);
      const denseStart = await measureStart(['p900', 'p901', 'p902'], 'p900');
      await scrollContinuously('p900');
      const dense = await finishMeasure('dense-eager-continuous-scroll', denseStart, {paragraphs: 1000, steps: 20, stepIntervalMs: 80, pixelsPerStep: 3});
      dense.targetsVisibleDuringScroll = dense.frames.filter(frame => frame.scrollY > 10000).every(frame => frame.targets.every(target => target.visible));
      assert.ok(dense.targetsVisibleDuringScroll);
      const denseTargetRequests = report.requests.slice(denseStart).filter(entry => entry.payload.some(text => /Reading marker 90[0-2]:/.test(text)));
      dense.targetRequestMs = denseTargetRequests[0]?.at - dense.epoch;
      if (phase === 'baseline') assert.ok(dense.targetRequestMs >= dense.scrollEndMs + 150);
      else {
        assert.ok(dense.firstReadableMs < dense.scrollEndMs, 'Dense eager viewport must become readable during continuous scroll');
        assert.ok(dense.maxLongTaskMs < 150, 'Dense eager scroll may not create a >=150ms main thread task');
        const during = report.requests.slice(denseStart).filter(entry => entry.at - dense.epoch < dense.scrollEndMs);
        // Already queued HTTP batches can enter just after measurement begins, before the
        // page's trusted scroll event reaches the extension. Exclude that initial event gap.
        assert.ok(during.filter(entry => entry.at - dense.epoch >= 150).every(entry => entry.payload.every(text => /Reading marker (?:899|90[0-3]):/.test(text))), 'Dense eager scroll cannot dispatch background work');
      }
      await toggle();
      await page.waitForFunction(() => !document.querySelector('.fluent-read-bilingual-content,.fluent-read-loading'), undefined, {timeout});
      await readConfig(context, timeout, {fullPageTranslationMode: 'viewport'}, createPage); save();
    }

    if (!measurementsOnly) {
      const note = name => { report.lifecycle.push({name, passed: true}); save(); console.log(`passed: ${name}`); };
      const absent = async () => {
        await page.waitForFunction(() => !document.querySelector('.fluent-read-bilingual-content,.fluent-read-loading,.fluent-read-retry-wrapper'), undefined, {timeout});
      };
      const requestStarted = async before => until(() => report.requests.slice(before).some(entry => entry.paragraphItems > 0), 'new body paragraph provider request');
      const settleNoLate = async () => { await page.waitForTimeout(900); await absent(); };
      let before;
      const selected = name => !lifecycleCase || lifecycleCase === name;
      if (selected('concurrency-hold')) {
        await ready('concurrency-hold'); state.delayMs = 1400;
        before = report.requests.length; await toggle();
        await until(() => state.activeItems === 3, 'three one-slot paragraph candidates held in transport');
        const heldCount = report.requests.length;
        await page.evaluate(() => scrollTo(0, document.getElementById('p40').getBoundingClientRect().top + scrollY - 100));
        for (let index = 0; index < 5; index++) { await page.waitForTimeout(80); await page.evaluate(() => scrollBy(0, 3)); }
        assert.equal(report.requests.length, heldCount, 'Scrolling must not dispatch past the three held paragraph candidates');
        await toggle(); await absent(); await settleNoLate(); note('scrolling respects three held candidate slots (HTTP batching can use fewer requests)');
      }
      if (selected('restore-retranslate')) {
        await ready('restore-retranslate');
        state.delayMs = 700;
        before = report.requests.length; await toggle(); await requestStarted(before);
        await toggle(); await absent(); await settleNoLate(); note('restore during request rejects late result');
        state.delayMs = transportDelayMs; await toggle();
        await page.waitForSelector(`#p0 ${marker}`); await toggle(); await absent(); note('retranslate then restore keeps unique wrappers');
      }

      if (selected('global-off')) {
        await ready('global-off'); state.delayMs = 700;
        before = report.requests.length; await toggle(); await requestStarted(before);
        await readConfig(context, timeout, {on: false}, createPage); await settleNoLate();
        assert.ok(report.requests.slice(before).some(entry => entry.paragraphItems > 0 && entry.aborted), 'Global off must abort the in-flight body HTTP transport');
        await readConfig(context, timeout, {on: true}, createPage); note('global off aborts request and rejects late DOM');
      }

      if (selected('language-switch')) {
        await ready('language-switch'); state.delayMs = 700; state.label = 'old-language';
        before = report.requests.length; await toggle(); await requestStarted(before);
        await toggle(); await absent();
        // Existing sessions intentionally retain their invocation snapshot. A language
        // change takes effect in the next invocation after restoring the prior session.
        state.label = 'new-language';
        await readConfig(context, timeout, {to: 'ja'}, createPage);
        state.delayMs = transportDelayMs; await toggle(); await page.waitForSelector(`#p0 ${marker}`);
        await page.waitForTimeout(900);
        assert.match(await page.locator(`#p0 ${marker}`).textContent(), /new-language/);
        assert.equal(await page.locator(`#p0 ${marker}`).getAttribute('lang'), 'ja');
        assert.equal(await page.locator(marker).evaluateAll(nodes => nodes.some(node => node.textContent.includes('old-language'))), false);
        await toggle(); await absent(); await readConfig(context, timeout, {to: 'zh-Hans'}, createPage); note('target language switch rejects old result then retranslation uses current settings');
      }

      if (selected('dynamic-dom')) {
        await ready('dynamic-dom'); await toggle(); await page.waitForSelector(`#p0 ${marker}`);
        await page.evaluate(() => {
          const p = document.createElement('p'); p.id = 'dynamic'; p.textContent = 'Dynamic reading marker: This newly inserted paragraph must be translated by the existing full page session.';
          document.getElementById('p0').after(p);
        });
        await page.waitForSelector(`#dynamic ${marker}`);
        assert.equal(await page.locator(`${marker} ${marker}`).count(), 0);
        await toggle(); await absent(); note('dynamic visible paragraph is translated once and restored');
      }

      if (selected('failure-retry')) {
        await ready('failure-retry'); state.failMarker = 'Reading marker 0:';
        await toggle(); await page.waitForSelector('#p0 .fluent-read-retry');
        await page.waitForTimeout(500);
        const retryRequestsBefore = report.requests.length;
        report.retryObservation = {settleMs: 500, beforeClick: await page.locator('#p0').evaluate(node => node.outerHTML)};
        await page.locator('#p0 .fluent-read-retry').click();
        await until(() => report.requests.slice(retryRequestsBefore).some(entry => entry.payload.some(text => String(text).startsWith('Reading marker 0:'))), 'retry sends a fresh body request', 3000);
        await page.waitForSelector(`#p0 ${marker}`);
        report.retryObservation.afterClick = await page.locator('#p0').evaluate(node => node.outerHTML);
        report.retryObservation.newRequests = report.requests.slice(retryRequestsBefore).map(entry => entry.payload);
        assert.equal(await page.locator(`#p0 ${marker}`).count(), 1);
        await toggle(); await absent(); note('failed visible paragraph retries successfully without duplicate translation');
      }

      if (selected('unload')) {
        await ready('unload'); state.delayMs = 700;
        before = report.requests.length; await toggle(); await requestStarted(before);
        await page.goto(`${fixtureUrl}?case=after-unload`, {waitUntil: 'domcontentloaded'});
        await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'}); await settleNoLate(); note('unload rejects old request in replacement document');
      }

      if (selected('hover-toggle')) {
        await ready('hover-toggle');
        const counts = [];
        for (const expected of [1, 0, 1]) {
          await activate(page);
          const box = await page.locator('#p0').boundingBox();
          assert.ok(box && box.y >= 0 && box.y < await page.evaluate(() => innerHeight), 'Hover target must already be visible');
          await page.mouse.move(0, 0);
          await page.mouse.move(box.x + 16, box.y + 16, {steps: 4});
          await page.waitForFunction(() => document.getElementById('p0').matches(':hover'));
          await page.waitForTimeout(50);
          await page.keyboard.down('Control'); await page.keyboard.up('Control');
          await page.waitForFunction(({expected, marker}) => document.querySelector('#p0').querySelectorAll(marker).length === expected, {expected, marker}, {timeout});
          counts.push(await page.locator(`#p0 ${marker}`).count());
          assert.equal(await page.locator(`#p1 ${marker}`).count(), 0);
        }
        report.hoverCounts = counts; note('hover Control translate restore translate is 1 0 1 with neighbor untouched');
      }
    }
    assert.ok(state.maxActiveItems <= patch.maxConcurrentTranslations, `One-slot body paragraph concurrency ${state.maxActiveItems} exceeds configured ${patch.maxConcurrentTranslations}`);
    assert.ok(state.maxActive <= patch.maxConcurrentTranslations + 1, 'HTTP work exceeds body candidate budget plus the existing independent title request');
    report.maxActiveHttp = state.maxActive;
    report.maxActiveOneSlotParagraphs = state.maxActiveItems;
    report.concurrencyUnitNote = 'Fixture body candidates each contain one text slot; body candidate concurrency is capped at 3. Microsoft can batch several candidates into one HTTP request. The pre-existing independent document-title translation can add one HTTP request.';
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.blockedNetwork, []);
    report.passed = true;
  } catch (error) {
    primaryError = error; report.error = error.stack;
    if (page) report.failureDom = await page.locator('#p0').evaluate(node => node.outerHTML).catch(() => null);
    if (page) await page.screenshot({path: path.join(artifactsDir, 'failure.png')}).catch(() => {});
    throw error;
  } finally {
    const cleanupErrors = [];
    const cleanup = async (label, action) => {
      try { await action(); } catch (error) {
        cleanupErrors.push(error); (report.cleanupErrors ||= []).push({label, error: String(error.stack || error)}); report.passed = false;
      }
    };
    await cleanup('browser', async () => { if (session) { await session.close(); browserClosed = true; } });
    await cleanup('provider', async () => { if (provider) await closeServer(provider); });
    await cleanup('fixture server', async () => { if (server) await closeServer(server); });
    await cleanup('temporary profile', async () => {
      if (browserClosed) fs.rmSync(profileDir, {recursive: true, force: true});
      else if (!launchAttempted) { try { fs.rmdirSync(profileDir); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; } }
    });
    save();
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

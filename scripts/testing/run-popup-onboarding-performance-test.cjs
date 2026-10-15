#!/usr/bin/env node
/**
 * @file scripts/testing/run-popup-onboarding-performance-test.cjs
 * Measure first-use language selection and normal menu separately in a fresh, focus-safe Edge profile.
 * Configuration timing uses the real runtime protocol; no credentials or config values are logged.
 */
'use strict';
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-onboarding-performance'));
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs')));
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
let profileDir;
const report = {scope: 'first-use-and-normal-popup', extensionDir, samples: [], errors: []};
fs.mkdirSync(artifactsDir, {recursive: true});

async function probe(page, phase) {
  await page.addInitScript(({staleHint, phase}) => {
    const state = {readyMs: null, frameMs: null, messages: [], fetches: [], longTasks: [], startupHints: []};
    globalThis.__onboardingPerf = state;
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (...args) => {
      const message = args.find(value => value && typeof value === 'object' && typeof value.type === 'string');
      const start = performance.now();
      const record = () => state.messages.push({type: message?.type, key: message?.type === 'configStorageRead' ? message.key : undefined, start, duration: performance.now() - start});
      const hintResponse = response => {
        if (message?.type !== 'popupStartup' || response?.success !== true) return response;
        const used = staleHint ? !response.uiLanguageSetupCompleted : response.uiLanguageSetupCompleted;
        state.startupHints.push({received: response.uiLanguageSetupCompleted, used});
        return {...response, uiLanguageSetupCompleted: used};
      };
      const callbackIndex = args.findLastIndex(value => typeof value === 'function');
      if (callbackIndex >= 0) {
        const callback = args[callbackIndex];
        args[callbackIndex] = response => { record(); callback(hintResponse(response)); };
        return send(...args);
      }
      return Promise.resolve(send(...args)).then(response => { record(); return hintResponse(response); });
    };
    const originalFetch = fetch.bind(globalThis);
    globalThis.fetch = async (...args) => {
      const start = performance.now();
      const response = await originalFetch(...args);
      const url = String(args[0]);
      if (url.startsWith('chrome-extension://')) state.fetches.push({path: new URL(url).pathname, start, duration: performance.now() - start});
      return response;
    };
    new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(entry => ({start: entry.startTime, duration: entry.duration})))).observe({type: 'longtask', buffered: true});
    const observer = new MutationObserver(() => {
      if (state.readyMs !== null || !document.querySelector('.popup-shell[data-config-ready="true"]')) return;
      state.readyMs = performance.now();
      requestAnimationFrame(() => { state.frameMs = performance.now(); });
      observer.disconnect();
    });
    observer.observe(document, {subtree: true, childList: true, attributes: true});
  }, {staleHint: process.argv.includes('--stale-startup-hint'), phase});
}

async function stopWorker(session, origin) {
  const versions = new Map();
  session.on('ServiceWorker.workerVersionUpdated', event => {
    for (const version of event.versions) versions.set(version.versionId, version);
  });
  await session.send('ServiceWorker.enable');
  await session.send('ServiceWorker.stopAllWorkers');
  const deadline = Date.now() + 10000;
  while (![...versions.values()].some(version => version.scriptURL.startsWith(origin) && version.runningStatus === 'stopped')) {
    if (Date.now() > deadline) throw new Error('Cannot confirm isolated worker stopped');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function main() {
  let launched, primaryError;
  const cdpSessions = new Set();
  let launchAttempted = false;
  try {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-onboarding-perf-'));
    launchAttempted = true;
    launched = await launchFocusSafePersistentContext({
      chromium, profileDir, browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      background: true, headless: false, viewport: {width: 1280, height: 900}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
    });
    guardBrowserClose(launched, profileDir);
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    const {context} = launched;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const count = Number(arg('opens', '7'));
    assert.ok(Number.isSafeInteger(count) && count >= 2, '--opens must be an integer of at least 2');
    for (const phase of ['onboarding', 'main']) {
      for (let index = 0; index < count; index++) {
        const page = await newPageWithoutForeground(context, 30000);
        page.on('pageerror', error => report.errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
        await page.setViewportSize({width: 320, height: 560});
        await probe(page, phase);
        const session = await context.newCDPSession(page);
        cdpSessions.add(session);
        await session.send('Performance.enable');
        await session.send('Network.enable');
        await session.send('Network.setCacheDisabled', {cacheDisabled: true});
        const scripts = new Set();
        session.on('Debugger.scriptParsed', event => {
          if (event.url.startsWith(origin)) scripts.add(new URL(event.url).pathname);
        });
        await session.send('Debugger.enable');
        const coldWorker = index === 0 && process.argv.includes('--cold-worker');
        if (coldWorker) await stopWorker(session, origin);
        await page.goto(`${origin}/${manifest.action.default_popup}`, {waitUntil: 'load', timeout: 30000});
        await page.waitForFunction(() => Number.isFinite(globalThis.__onboardingPerf?.frameMs));
        const sample = await page.evaluate(() => ({...globalThis.__onboardingPerf,
          domNodes: document.querySelectorAll('*').length,
          onboardingVisible: Boolean(document.querySelector('[data-testid="onboarding-language-step"]')),
          englishReady: Boolean(document.querySelector('#language-onboarding-title small')?.textContent.trim()),
          height: document.querySelector('.popup-shell').getBoundingClientRect().height,
          overflowX: document.documentElement.scrollWidth > innerWidth,
          resources: performance.getEntriesByType('resource')
            .filter(entry => entry.name.startsWith('chrome-extension://') && new URL(entry.name).pathname.endsWith('.js'))
            .map(entry => ({path: new URL(entry.name).pathname, start: entry.startTime, duration: entry.duration})),
        }));
        const {metrics} = await session.send('Performance.getMetrics');
        Object.assign(sample, {phase, index, coldWorkerStopped: coldWorker,
          scripts: [...scripts].map(file => ({file, bytes: fs.statSync(path.join(extensionDir, file)).size})),
          metrics: Object.fromEntries(metrics.filter(item => ['ScriptDuration', 'LayoutDuration', 'TaskDuration', 'JSHeapUsedSize'].includes(item.name)).map(item => [item.name, item.value])),
        });
        sample.scriptBytes = sample.scripts.reduce((sum, item) => sum + item.bytes, 0);
        report.samples.push(sample);
        assert.equal(sample.onboardingVisible, phase === 'onboarding');
        if (process.argv.includes('--stale-startup-hint')) {
          assert.equal(sample.startupHints.length, 1, 'Stale startup hint hook did not run');
          assert.equal(sample.startupHints[0].received, phase === 'main');
          assert.notEqual(sample.startupHints[0].used, sample.startupHints[0].received);
        }
        if (phase === 'onboarding' && process.argv.includes('--expect-lightweight')) {
          assert.equal(sample.englishReady, true, 'Language selection first frame lacks English');
          assert.equal(sample.scripts.some(script => /\/PopupApp-/u.test(script.file)), false, 'Language selection parsed the full main menu');
          assert.equal(sample.fetches.some(fetch => /\/i18n\/en-US\.json$/u.test(fetch.path)), false, 'Language selection requested the full English bundle');
        }
        if (process.argv.includes('--expect-lightweight')) {
          assert.equal(sample.messages.filter(message => message.type === 'configStorageRead' && message.key === 'local:config').length, 1, 'Startup reread the full configuration');
        }
        assert.equal(sample.overflowX, false);
        assert.ok(sample.height <= 560);
        if (index === 0) await page.locator('.popup-shell').screenshot({path: path.join(artifactsDir, `${phase}.png`)});
        if (phase === 'onboarding' && index === count - 1) {
          await page.locator('[data-language="zh-CN"]').click();
          const start = await page.evaluate(() => performance.now());
          await page.locator('.onboarding-form .onboarding-confirm').click();
          await page.locator('.popup-content:visible').waitFor();
          report.confirmToMainMs = await page.evaluate(start => performance.now() - start, start);
          await page.locator('.popup-shell').screenshot({path: path.join(artifactsDir, 'confirmed-main.png')});
        }
        await session.detach();
        cdpSessions.delete(session);
        await page.close();
      }
    }
    const median = values => {
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    report.summary = Object.fromEntries(['onboarding', 'main'].map(phase => {
      const samples = report.samples.filter(sample => sample.phase === phase);
      return [phase, {first: {readyMs: samples[0].readyMs, frameMs: samples[0].frameMs, scriptBytes: samples[0].scriptBytes, coldWorkerStopped: samples[0].coldWorkerStopped},
        medianReadyMs: median(samples.slice(1).map(sample => sample.readyMs)), medianFrameMs: median(samples.slice(1).map(sample => sample.frameMs)),
      }];
    }));
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {
    primaryError = error;
    report.passed = false;
    report.errors.push(error.stack || String(error));
    throw error;
  } finally {
    const cleanupErrors = [];
    const cleanup = async (resource, release) => {
      try { await release(); } catch (error) {
        cleanupErrors.push(error);
        (report.cleanupErrors ||= []).push({resource, error: String(error.stack || error)});
        report.passed = false;
        process.exitCode = 1;
        console.error(`Cleanup failed (${resource}):`, error);
      }
    };
    for (const session of cdpSessions) await cleanup('CDP session', () => session.detach());
    let browserClosed = false;
    await cleanup('browser', async () => { if (launched) { await launched.close(); browserClosed = true; } });
    await cleanup('profile', () => {
      if (!profileDir) return;
      if (browserClosed) fs.rmSync(profileDir, {recursive: true, force: true});
      else if (!launchAttempted) {
        try { fs.rmdirSync(profileDir); } catch (error) {
          // 未尝试启动浏览器时，仅移除初始空目录。
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
        }
      }
    });
    await cleanup('report', () => { fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2)); });
    if (cleanupErrors.length && !primaryError) throw cleanupErrors[0];
  }
  console.log(JSON.stringify({passed: report.passed, summary: report.summary}, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

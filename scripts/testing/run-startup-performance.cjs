'use strict';

// 在隔离、可见且不抢焦点的生产扩展中比较首次与重复打开；不访问用户 profile 或翻译服务。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-startup-performance'));
const runs = Number(arg('runs', '5'));
assert(Number.isSafeInteger(runs) && runs >= 2 && runs <= 20);
const kinds = arg('kinds', 'popup,options,content').split(',');
assert(kinds.length > 0 && new Set(kinds).size === kinds.length && kinds.every(kind => ['popup', 'options', 'content'].includes(kind)));
const diagnosticsPath = arg('runtime-diagnostics');
const diagnostics = diagnosticsPath ? require(path.resolve(diagnosticsPath)).createRuntimeDiagnostics() : undefined;
const {chromium} = require(path.join(arg('playwright-root',
  '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper',
  path.join(__dirname, 'focus-safe-browser.cjs')));
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-startup-performance-'));
const report = {extensionDir, version: manifest.version, runs, kinds,
  method: 'Fresh temporary profile; first document then repeated new documents in one browser. Local files may be OS-cached. Timings are descriptive, not a cross-device guarantee.',
  samples: [], errors: []};
if (!diagnostics) report.diagnosticLimitations = ['未传入 --runtime-diagnostics，pageerror 不覆盖内容脚本隔离世界、后台和全部告警。'];
fs.mkdirSync(artifactsDir, {recursive: true});
const server = http.createServer((_request, response) => {
  response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  response.end('<!doctype html><meta charset="utf-8"><title>Startup fixture</title><h1>Reading performance</h1>' +
    Array.from({length: 1000}, (_, i) => `<p>Paragraph ${i}. A quiet page should stay responsive while the browser extension waits for a translation gesture.</p>`).join(''));
});

async function measure(context, kind, url, selector, iteration) {
  diagnostics?.setPhase(`${kind}-${iteration}`);
  const page = await newPageWithoutForeground(context);
  await diagnostics?.attachPage(page, kind);
  page.on('pageerror', error => report.errors.push({kind, iteration, error: error.message}));
  const client = await context.newCDPSession(page);
  const loadedUrls = new Set();
  client.on('Network.requestWillBeSent', ({request}) => loadedUrls.add(request.url));
  await client.send('Network.enable');
  await client.send('Performance.enable');
  await page.addInitScript(({selector}) => {
    globalThis.__startupMeasurement = {readyMs: null, longTasks: [], fullConfigSerializations: 0};
    const stringify = JSON.stringify;
    JSON.stringify = function (value, ...args) {
      if (value && typeof value === 'object' && 'uiLanguage' in value && 'harness' in value) {
        globalThis.__startupMeasurement.fullConfigSerializations++;
      }
      return stringify.call(this, value, ...args);
    };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) globalThis.__startupMeasurement.longTasks.push({start: entry.startTime, duration: entry.duration});
    }).observe({type: 'longtask', buffered: true});
    const observer = new MutationObserver(() => {
      if (!document.querySelector(selector)) return;
      observer.disconnect();
      requestAnimationFrame(() => { globalThis.__startupMeasurement.readyMs = performance.now(); });
    });
    observer.observe(document, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-config-ready']});
  }, {selector});
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => typeof globalThis.__startupMeasurement?.readyMs === 'number');
  await page.waitForTimeout(800);
  const beforeIdle = Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(({name, value}) => [name, value]));
  const sample = await page.evaluate(() => ({
    ...globalThis.__startupMeasurement,
    domContentLoadedMs: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd,
    nodes: document.querySelectorAll('*').length,
    resources: performance.getEntriesByType('resource').map(({name, initiatorType, duration}) => ({name, initiatorType, duration})),
  }));
  await page.waitForTimeout(1200);
  const afterIdle = Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(({name, value}) => [name, value]));
  const resourcePaths = [...loadedUrls].filter(url => url.startsWith('chrome-extension://'))
    .map(url => new URL(url).pathname.replace(/^\//, ''));
  const bytes = extension => resourcePaths.filter(file => file.endsWith(extension))
    .reduce((total, file) => total + (fs.existsSync(path.join(extensionDir, file)) ? fs.statSync(path.join(extensionDir, file)).size : 0), 0);
  // 声明式注入脚本不会产生 Network.requestWillBeSent，单独按该 localhost 夹具的 manifest 匹配计入。
  const injectedScripts = kind === 'content' ? [...new Set(manifest.content_scripts
    .filter(script => script.matches?.some(pattern => pattern === '<all_urls>' || pattern === '*://*/*'))
    .flatMap(script => script.js || []))] : [];
  const injectedScriptBytes = injectedScripts.reduce((total, file) => total + fs.statSync(path.join(extensionDir, file)).size, 0);
  Object.assign(sample, {kind, iteration, firstOpen: iteration === 0,
    resourcePaths,
    injectedScripts, injectedScriptBytes,
    scriptBytes: bytes('.js') + bytes('.mjs') + injectedScriptBytes, cssBytes: bytes('.css'),
    scriptMs: beforeIdle.ScriptDuration * 1000, taskMs: beforeIdle.TaskDuration * 1000,
    heapBytes: beforeIdle.JSHeapUsedSize,
    idleTaskMs: (afterIdle.TaskDuration - beforeIdle.TaskDuration) * 1000,
    idleScriptMs: (afterIdle.ScriptDuration - beforeIdle.ScriptDuration) * 1000});
  if (iteration === 0) await page.screenshot({path: path.join(artifactsDir, `${kind}-first.png`)});
  report.samples.push(sample);
  fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
  await page.close();
}

(async () => {
  let session;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    session = await launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      headless: false, background: true, viewport: {width: 1440, height: 1000},
      browserArgs: ['--no-first-run', '--no-default-browser-check',
        `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]});
    const {context} = session;
    await diagnostics?.start(context);
    report.launchMode = session.launchMode;
    report.focusPolicy = session.focusPolicy;
    report.windowPlacement = session.windowPlacement;
    const worker = context.serviceWorkers().find(worker => worker.url().startsWith('chrome-extension://')) ||
      await context.waitForEvent('serviceworker', {timeout: 30000});
    const origin = new URL(worker.url()).origin;
    // URL.origin 对扩展 scheme 返回 null，直接从已观察到的 worker URL 提取扩展地址。
    const extensionOrigin = origin === 'null' ? worker.url().match(/^chrome-extension:\/\/[^/]+/)[0] : origin;
    diagnostics?.setExtensionId(new URL(worker.url()).host);
    // 首次安装欢迎页另有专项；启动对照使用已完成语言选择的真实后台配置。
    const setup = await newPageWithoutForeground(context);
    await diagnostics?.attachPage(setup, 'startup-setup');
    await setup.goto(`${extensionOrigin}/icon/128.png`);
    await setup.evaluate(async () => {
      const current = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!current?.success) throw new Error('无法读取启动性能测试配置');
      const patch = {uiLanguageSetupCompleted: true, uiLanguage: 'zh-CN', interfaceSkin: 'default', interfaceFont: 'system'};
      const response = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: patch,
        expected: Object.fromEntries(Object.keys(patch).map(key => [key, current.value[key]])),
        clientId: 'startup-performance-setup', sequence: 1, baseRevision: current.value.__fluentConfigRevision || 0});
      if (!response?.success) throw new Error('无法准备启动性能测试配置');
    });
    await setup.close();
    const cases = [
      ['popup', `${extensionOrigin}/${manifest.action.default_popup}`, '.popup-shell[data-config-ready="true"]'],
      ['options', `${extensionOrigin}/${manifest.options_ui?.page || manifest.options_page}`, '#settings-general [data-testid="default-translation-service-card"]'],
      ['content', `http://127.0.0.1:${server.address().port}/`, '#fluent-read-page-styles'],
    ].filter(([kind]) => kinds.includes(kind));
    for (let iteration = 0; iteration < runs; iteration++) {
      for (const [kind, url, selector] of cases) await measure(context, kind, url, selector, iteration);
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    report.summary = Object.fromEntries(cases.map(([kind]) => {
      const samples = report.samples.filter(sample => sample.kind === kind);
      return [kind, Object.fromEntries(['readyMs', 'scriptMs', 'taskMs', 'heapBytes', 'nodes', 'scriptBytes', 'cssBytes', 'idleTaskMs', 'fullConfigSerializations']
        .map(metric => [metric, {first: samples[0][metric], median: median(samples.map(sample => sample[metric]))}]))];
    }));
    assert.equal(report.errors.length, 0, '扩展页面出现未处理错误');
    report.ok = true;
    console.log(JSON.stringify({summary: report.summary, errors: report.errors, windowPlacement: report.windowPlacement}, null, 2));
  } catch (error) {
    report.ok = false;
    report.failure = error.stack;
    console.error(error);
    process.exitCode = 1;
  } finally {
    report.cleanupErrors = [];
    if (diagnostics) {
      try {
        await diagnostics.flush();
        report.runtimeDiagnostics = diagnostics.snapshot();
        fs.writeFileSync(path.join(artifactsDir, 'runtime-diagnostics.json'), JSON.stringify(report.runtimeDiagnostics, null, 2));
        if (report.ok) diagnostics.assertClean();
      } catch (error) {report.ok = false; report.diagnosticError = error.message; process.exitCode = 1;}
      try {await diagnostics.stop();} catch (error) {report.ok = false; report.cleanupErrors.push(`diagnostics: ${error.message}`); process.exitCode = 1;}
    }
    try {
      if (session) {
        await session.close();
        fs.rmSync(profileDir, {recursive: true, force: true});
      } else {
        try {fs.rmdirSync(profileDir);} catch (error) {
          if (error.code !== 'ENOTEMPTY') throw error;
        }
      }
    } catch (error) {
      report.ok = false;
      report.cleanupErrors.push(error.stack);
      console.error(error);
      process.exitCode = 1;
    } finally {
      try {
        if (server.listening) {
          server.closeAllConnections();
          await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
      } catch (error) {
        report.ok = false;
        report.cleanupErrors.push(error.stack);
        console.error(error);
        process.exitCode = 1;
      }
      fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    }
  }
})();

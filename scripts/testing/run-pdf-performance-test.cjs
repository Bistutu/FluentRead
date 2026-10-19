#!/usr/bin/env node
'use strict';

/**
 * @file scripts/testing/run-pdf-performance-test.cjs
 * 文件职责：用真实生产扩展、第二屏临时 Edge 记录小规模 PDF 阅读和导出的正确性与性能样本。
 * 主要内容：24 段两页真实 PDF、人工校订、源文切双语及翻页、原版双语下载、超过 512 个不同词后的重复词重排下载；每项首次加三次重复，保留原始数据与中位数。
 * 模块边界：仅包装 Canvas 读回与测量 API 计数，不改变返回值或导出器；不调用供应商，不使用用户 profile，不以墙钟耗时作为通过阈值。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {createRequire} = require('node:module');
const helper = require('./focus-safe-browser.cjs');
const argument = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const repository = path.resolve(__dirname, '../..');
const packages = path.resolve(argument('playwright-root', path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')));
const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-pdf-performance'));
const requireRepo = createRequire(path.join(repository, 'package.json'));
const {chromium} = require(path.join(packages, 'playwright'));
const compact = value => value.normalize('NFKC').replace(/\s/gu, '');
const median = values => {const sorted = [...values].sort((a, b) => a - b); return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;};
const report = {ok: false, label: argument('label', 'unspecified'), extensionDir, artifactKind: 'production',
  scope: {sourcePages: 2, paragraphs: 24, samplesPerOperation: 4, providerRequests: false, stressPages: false},
  limitations: ['Controlled PDF and manual editor corrections only; no supplier, complex public PDF, cross-browser or mobile acceptance.',
    'Cold means first operation in this isolated browser; warm reader samples reuse color caches. Timings include browser scheduling and instrumentation overhead and have no pass/fail threshold.'],
  reader: [], exports: [], consoleErrors: [], workerErrors: [], blockedRequests: [], screenshots: [], cleanupErrors: []};
fs.mkdirSync(artifacts, {recursive: true});
function fingerprint(directory) {
  const files = [], hash = crypto.createHash('sha256');
  const visit = relative => {for (const entry of fs.readdirSync(path.join(directory, relative), {withFileTypes: true})) {
    const file = path.join(relative, entry.name); if (entry.isDirectory()) visit(file); else if (entry.isFile()) files.push(file);
  }};
  visit(''); for (const file of files.sort()) hash.update(file).update(fs.readFileSync(path.join(directory, file)));
  return {sha256: hash.digest('hex'), fileCount: files.length, manifest: JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))};
}
async function fixture() {
  const {PDFDocument, StandardFonts} = requireRepo('pdf-lib');
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setCreationDate(new Date('2020-01-01T00:00:00Z')); pdf.setModificationDate(new Date('2020-01-01T00:00:00Z'));
  const sources = [];
  for (let sheet = 0; sheet < 2; sheet++) {
    const page = pdf.addPage([595, 842]);
    for (let row = 0; row < 12; row++) {
      const source = `Original paragraph ${sheet * 12 + row + 1}: preserve every source word.`;
      page.drawText(source, {x: 44, y: 760 - row * 58, size: 11, font}); sources.push(source);
    }
  }
  const bytes = Buffer.from(await pdf.save()), file = path.join(artifacts, 'controlled-24-paragraphs.pdf'); fs.writeFileSync(file, bytes);
  report.fixture = {file, sources, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')};
  return bytes;
}
async function main() {
  assert(fs.existsSync(path.join(extensionDir, 'manifest.json')), 'A prebuilt production extension is required');
  report.productionFingerprint = fingerprint(extensionDir);
  const bytes = await fixture(), profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-pdf-performance-'));
  let session, page, closed = false, launched = false;
  try {
    launched = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: argument('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      background: true, headless: false, displayTarget: 'secondary', viewport: {width: 1440, height: 960}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking']});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(session.windowPlacement.browserFrontmost, false);
    const context = session.context;
    await context.route('**/*', route => {const url = route.request().url(); if (/^https?:/u.test(url)) {report.blockedRequests.push(url); return route.abort();} return route.continue();});
    await context.addInitScript(() => {
      const reset = () => window.__pdfPerf = {start: performance.now(), last: performance.now(), readbacks: 0, readbackMs: 0, pixels: 0, largestReadback: 0, measureTextCalls: 0, measureTextMs: 0};
      window.__resetPdfPerf = reset; reset();
      const prototype = CanvasRenderingContext2D.prototype, read = prototype.getImageData, measure = prototype.measureText;
      prototype.getImageData = function (...args) {
        const start = performance.now();
        try {return read.apply(this, args);} finally {
          const stats = window.__pdfPerf, pixels = Math.abs(Number(args[2]) * Number(args[3]));
          stats.readbacks++; stats.readbackMs += performance.now() - start; stats.pixels += pixels; stats.largestReadback = Math.max(stats.largestReadback, pixels); stats.last = performance.now();
        }
      };
      prototype.measureText = function (...args) {
        const start = performance.now(); try {return measure.apply(this, args);} finally {const stats = window.__pdfPerf; stats.measureTextCalls++; stats.measureTextMs += performance.now() - start; stats.last = performance.now();}
      };
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    worker.on('console', message => {if (message.type() === 'error') report.workerErrors.push(message.text());});
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    page = await helper.newPageWithoutForeground(context, 30000); page.setDefaultTimeout(30000);
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push(message.text());});
    page.on('dialog', dialog => {if (dialog.type() === 'beforeunload') void dialog.accept(); else void dialog.dismiss();});
    await page.goto(`${origin}/document.html`); await page.locator('.file-drop-zone').waitFor();
    await page.evaluate(async () => {
      const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const current = typeof read.value === 'string' ? JSON.parse(read.value) : read.value;
      const result = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'replace', config: {...current, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true}, clientId: 'pdf-performance', sequence: 1, baseRevision: current.__fluentConfigRevision || 0});
      if (!result.success) throw new Error(result.error);
    });
    await page.reload(); await page.locator('.file-drop-zone').waitFor();
    const font = fs.readFileSync(path.join(repository, 'assets/pdf-fonts/FluentReadNotoSansSC-Regular.woff2'));
    const sha = crypto.createHash('sha256').update(font).digest('hex');
    assert(fs.readFileSync(path.join(repository, 'src/features/document-translation/services/pdfReadingFont.ts'), 'utf8').includes(`PDF_READING_FONT_SHA256 = '${sha}'`));
    await page.evaluate(async ({base64, sha}) => {
      const cache = await caches.open('fluentread-pdf-reading-font-v1');
      await cache.put(`https://fluentread.app/__optional_assets__/pdf-font/${sha}.woff2`, new Response(Uint8Array.from(atob(base64), char => char.charCodeAt(0)), {headers: {'Content-Type': 'font/woff2'}}));
    }, {base64: font.toString('base64'), sha});
    report.readingFont = {sha256: sha, bytes: font.length, source: 'Verified actual repository font cached in this temporary profile'};
    const showEdit = async () => {await page.locator('.reader-tabs button').nth(1).click(); await page.locator('.segment-editor').waitFor();};
    const showRead = async () => {await page.locator('.reader-tabs button').first().click(); await page.locator('[data-pdf-scroll]').waitFor();};
    const mode = value => page.getByRole('group', {name: '阅读方式', exact: true}).getByRole('button', {name: value, exact: true}).click();
    const reset = () => page.evaluate(() => window.__resetPdfPerf());
    const stats = () => page.evaluate(() => ({...window.__pdfPerf, elapsedMs: performance.now() - window.__pdfPerf.start}));
    const stable = async () => {
      await page.waitForFunction(() => {
        const rows = [...document.querySelectorAll('.pdf-page-row')];
        return rows.length === 2 && rows.every(row => row.dataset.renderState === 'ready') && performance.now() - window.__pdfPerf.last >= 200;
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const shot = async name => {const file = path.join(artifacts, `${name}.png`); await page.screenshot({path: file}); report.screenshots.push(file);};
    await page.locator('input[type=file]').setInputFiles({name: 'controlled-24-paragraphs.pdf', mimeType: 'application/pdf', buffer: bytes});
    await page.locator('.workspace-heading h1').filter({hasText: 'controlled-24-paragraphs.pdf'}).waitFor(); await stable();
    await mode('原文'); await showEdit();
    const rows = await page.locator('.segment-edit-row[data-segment-id]').evaluateAll(nodes => nodes.map(node => ({id: Number(node.dataset.segmentId), source: node.querySelector('.document-source').textContent})));
    assert.equal(rows.length, 24);
    const corrections = rows.map(row => ({...row, text: `校订第${row.id + 1}段完整保留。`}));
    for (const entry of corrections) await page.locator(`.segment-edit-row[data-segment-id="${entry.id}"] textarea`).fill(entry.text);
    await showRead(); await stable(); report.corrections = corrections;
    for (let sample = 0; sample < 4; sample++) {
      await mode('原文'); await stable(); await reset(); await mode('双语');
      await page.waitForFunction(() => document.querySelectorAll('.pdf-translation-block').length === 24); await stable();
      const navigation = page.locator('.pdf-page-navigation input');
      await navigation.fill('2'); await navigation.press('Enter');
      await page.waitForFunction(() => document.querySelector('[data-pdf-scroll]').scrollTop > 100); await stable();
      await navigation.fill('1'); await navigation.press('Enter');
      await page.waitForFunction(() => {
        const viewport = document.querySelector('[data-pdf-scroll]'), first = document.querySelector('.pdf-page-row[data-page-number="1"]');
        const offset = first.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
        return offset >= -2 && offset <= 32;
      }); await stable();
      report.reader.push({sample, temperature: sample ? 'warm' : 'cold', ...(await stats()), translatedBlocks: await page.locator('.pdf-translation-block').count(), returnedPage: await navigation.inputValue(), returnedScrollTop: await page.locator('[data-pdf-scroll]').evaluate(node => node.scrollTop)});
    }
    await shot('reader-short-layout');
    const pdfjs = await import(pathToFileURL(path.join(packages, 'pdfjs-dist/legacy/build/pdf.mjs')).href);
    const {createCanvas} = require(path.join(packages, '@napi-rs/canvas'));
    const inspect = async (file, entries, bilingual, expectedPages, render) => {
      const task = pdfjs.getDocument({data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false, useWorkerFetch: false, verbosity: 0, standardFontDataUrl: path.join(packages, 'pdfjs-dist/standard_fonts') + path.sep});
      const sheets = [];
      try {
        const pdf = await task.promise;
        for (let number = 1; number <= pdf.numPages; number++) {
          const sheet = await pdf.getPage(number), text = (await sheet.getTextContent()).items.map(item => item.str || '').join('\n');
          assert(compact(text).replace(/原文第\d+页·译文续页·?\d+\/\d+/gu, ''), `Page ${number} has body text`);
          const result = {number, text};
          if (render) {
            const viewport = sheet.getViewport({scale: .8}), canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            await sheet.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
            result.png = file.replace(/\.pdf$/u, `-page-${number}.png`); fs.writeFileSync(result.png, canvas.toBuffer('image/png'));
          }
          sheets.push(result); sheet.cleanup();
        }
      } finally {await task.destroy();}
      const whole = compact(sheets.map(sheet => sheet.text).join('\n')).replace(/原文第\d+页·译文续页·?\d+\/\d+/gu, '');
      for (const entry of entries) {assert(whole.includes(compact(entry.text)), `Complete correction ${entry.id}`); if (bilingual) assert(whole.includes(compact(entry.source)), `Complete original ${entry.id}`);}
      const positions = entries.map(entry => whole.indexOf(compact(entry.text)));
      assert(positions.every((position, index) => !index || position > positions[index - 1]), 'Correction paragraph order must follow the original pages');
      if (bilingual) {const sourcePositions = entries.map(entry => whole.indexOf(compact(entry.source))); assert(sourcePositions.every((position, index) => !index || position > sourcePositions[index - 1]), 'Original page order');}
      assert(!/工作区|工作空间|下载文件|打开新文件|服务连接设置|Document workspace/iu.test(whole));
      if (expectedPages) assert.equal(sheets.length, expectedPages);
      fs.writeFileSync(file.replace(/\.pdf$/u, '.text.json'), JSON.stringify(sheets, null, 2)); return {pages: sheets.length, renders: sheets.map(sheet => sheet.png).filter(Boolean)};
    };
    const presentation = async value => {const menu = page.locator('.pdf-presentation-control.pdf-menu'); await menu.locator('.pdf-menu-button').click(); await menu.locator(`button[role="option"][data-value="${value}"]`).click(); await page.locator(`.pdf-layout-viewer[data-pdf-presentation="${value}"]`).waitFor(); await stable();};
    const runExports = async (kind, output, entries, expectedPages) => {
      await presentation(kind);
      for (let sample = 0; sample < 4; sample++) {
        await page.locator('.taskbar-actions .download-button').click(); const dialog = page.locator('.download-dialog[open]'); await dialog.waitFor();
        await dialog.locator('.export-options button').nth(output === 'bilingual' ? 0 : 1).click();
        const partial = dialog.locator('.partial-export input'); if (await partial.isVisible()) await partial.check();
        await reset();
        const [download] = await Promise.all([page.waitForEvent('download', {timeout: 120000}), dialog.locator('.dialog-actions .translate-document-button').click()]);
        const elapsed = await stats(), file = path.join(artifacts, `${kind}-${output}-${sample}.pdf`); await download.saveAs(file); assert.equal(await download.failure(), null);
        report.exports.push({kind, output, sample, temperature: sample ? 'warm' : 'cold', ...elapsed, file, bytes: fs.statSync(file).size, ...(await inspect(file, entries, output === 'bilingual', expectedPages, sample === 0 || sample === 3))});
        if (await dialog.isVisible()) await dialog.getByRole('button', {name: '返回文档', exact: true}).click();
      }
    };
    await runExports('layout', 'bilingual', corrections, 2);
    const longText = Array.from({length: 520}, (_, index) => `unique${String(index).padStart(4, '0')}`).join(' ') + ' ' + 'common '.repeat(1600) + 'Long translation final marker.';
    await showEdit(); await page.locator(`.segment-edit-row[data-segment-id="${rows[0].id}"] textarea`).fill(longText); await showRead();
    const long = corrections.map((entry, index) => index ? entry : {...entry, text: longText});
    report.longCorrection = {characters: longText.length, distinctPrefixWords: 520, repeatedWord: 'common', repeatedWordCount: 1600};
    await runExports('readable', 'translated', long); await shot('reader-long-readable');
    report.medians = {};
    for (const [name, samples] of [['reader', report.reader], ['layout-bilingual', report.exports.filter(sample => sample.kind === 'layout')], ['readable-translated', report.exports.filter(sample => sample.kind === 'readable')]]) {
      report.medians[name] = Object.fromEntries(['elapsedMs', 'readbacks', 'readbackMs', 'pixels', 'measureTextCalls', 'measureTextMs'].map(key => [key, median(samples.map(sample => sample[key]))]));
      report.medians[name].warmElapsedMs = median(samples.slice(1).map(sample => sample.elapsedMs));
    }
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.workerErrors, []); assert.deepEqual(report.blockedRequests, []); report.ok = true;
  } catch (error) {report.failure = String(error.stack || error); process.exitCode = 1; if (page) await page.screenshot({path: path.join(artifacts, 'failure.png')}).catch(() => {});}
  finally {
    if (session) try {await session.close(); closed = true;} catch (error) {report.cleanupErrors.push(error.message);}
    if (closed || !launched) fs.rmSync(profileDir, {recursive: true, force: true}); else report.retainedProfile = profileDir;
    if (report.cleanupErrors.length) {report.ok = false; process.exitCode = 1;}
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ok: report.ok, report: path.join(artifacts, 'report.json'), fingerprint: report.productionFingerprint.sha256, reader: report.reader, medians: report.medians, failure: report.failure, cleanupErrors: report.cleanupErrors}, null, 2));
}
main().catch(error => {console.error(error); process.exitCode = 1;});

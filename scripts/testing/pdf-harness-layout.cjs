'use strict';

// 真实 arXiv harness 论文的定点布局/下载证据：通过普通页码、翻译、暂停和下载控件，
// 不回写 Vue 状态；中文由 runner 的本机确定性服务返回，仅作遮挡/几何证据。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {pathToFileURL} = require('node:url');
const {PDFDocument} = require('pdf-lib');
const UPNG = createRequire(require.resolve('pdf-lib/package.json'))('@pdf-lib/upng').default;

const protectedRegions = number => [
  ...(number === 1 ? [{name: 'university-logos', x: 64, y: 60, width: 475, height: 55}] : []),
  {name: 'page-number', x: 280, y: 790, width: 40, height: 30},
  ...(number === 16 ? [{name: 'piecewise-formula-7', x: 197.5, y: 249.5, width: 330, height: 33}] : []),
];

async function downloadedRasters(file, pages, pageSizes, sourceRasters, artifactsDir, mode) {
  const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const task = pdfjs.getDocument({data: new Uint8Array(fs.readFileSync(file)), disableFontFace: true, isEvalSupported: false, useWorkerFetch: false});
  const results = [];
  try {
    const pdf = await task.promise;
    for (const number of pages) {
      const page = await pdf.getPage(number), operations = await page.getOperatorList();
      const candidates = [];
      for (let index = 0; index < operations.fnArray.length; index++) if (operations.fnArray[index] === pdfjs.OPS.paintImageXObject) {
        const image = await new Promise(resolve => page.objs.get(operations.argsArray[index][0], resolve));
        if (image.width >= 1000 && Math.abs(image.width / image.height - pageSizes[number - 1].width / pageSizes[number - 1].height) < .002) candidates.push(image);
      }
      assert.equal(candidates.length, 1, `第 ${number} 页必须有唯一实际译页栅格`);
      const image = candidates[0], rgba = new Uint8Array(image.width * image.height * 4);
      assert.equal(image.kind, pdfjs.ImageKind.RGB_24BPP, '实际下载译页解码为 RGB 栅格');
      for (let from = 0, to = 0; from < image.data.length; from += 3, to += 4) {
        rgba[to] = image.data[from]; rgba[to + 1] = image.data[from + 1]; rgba[to + 2] = image.data[from + 2]; rgba[to + 3] = 255;
      }
      const rasterFile = path.join(artifactsDir, `harness-${mode}-p${number}-actual-raster.png`);
      fs.writeFileSync(rasterFile, Buffer.from(UPNG.encode([rgba.buffer], image.width, image.height, 0)));
      results.push({page: number, rasterFile, sourceRaster: sourceRasters.get(number), regions: protectedRegions(number),
        boundary: 'Actual downloaded JPEG decoded independently. Inspect the saved PNG and source regions visually; reader and export use different raster scales, so raw pixel identity is not asserted.'}); page.cleanup();
    }
    return results;
  } finally {await task.destroy();}
}

async function runPdfHarnessLayout({page, fixture, report, shot, record, until, wait, rowReady, checkFocus, artifactsDir, sourcePath, pageNumbers}) {
  report.runScope = 'harness-layout-selected-pages';
  report.providerEvidence = 'Local arXiv 2609.35738 PDF; production extension; deterministic Chinese layout fixture, not translation-quality evidence. Only selected pages are required to finish before partial export.';
  report.sourcePdf = sourcePath;
  const sourcePdf = await PDFDocument.load(fs.readFileSync(sourcePath));
  const pageSizes = sourcePdf.getPages().map(sourcePage => sourcePage.getSize());
  const baseline = process.argv.includes('--harness-layout-baseline') || path.basename(report.extensionDir) === 'baseline-extension';
  const statusOnly = process.argv.includes('--harness-status-only');
  if (statusOnly) report.runScope = 'harness-status-widths-only';
  report.harnessBaseline = baseline;
  const pages = [...new Set(pageNumbers)].filter(number => Number.isInteger(number) && number >= 1);
  assert(pages.includes(1), '首页必须在定点布局范围内');
  assert(pages.every(number => number <= pageSizes.length), '定点页码不能超过源文件页数');
  const sourceRasters = new Map();
  report.harnessPages = []; report.pdfExports = [];
  const saveCheckpoint = () => fs.writeFileSync(path.join(artifactsDir, 'harness-checkpoint.json'), JSON.stringify(report, null, 2) + '\n');
  const inspectStatusLine = async width => {
    await page.setViewportSize({width, height: width < 600 ? 844 : 960}); await wait(100);
    const line = await page.locator('.document-status').evaluate(element => {
      const status = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const count = element.querySelector('.document-translation-count');
      if (!status || !count) return {missing: true};
      const range = document.createRange(); range.selectNodeContents(status);
      const statusBox = range.getClientRects()[0];
      const countRange = document.createRange(); countRange.selectNodeContents(count);
      const countBox = countRange.getBoundingClientRect(), bounds = element.getBoundingClientRect();
      return {status: status.textContent.trim(), count: count.textContent, statusTop: statusBox?.top, countTop: countBox?.top,
        sameLine: Boolean(statusBox && countBox && Math.abs(statusBox.top - countBox.top) <= 2),
        clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, textRight: countBox.right, statusRight: bounds.right,
        fullWithinStatus: Boolean(statusBox && statusBox.left >= bounds.left - 1 && countBox.right <= bounds.right + 1),
        fullWithinViewport: Boolean(statusBox && statusBox.left >= 0 && countBox.right <= innerWidth)};
    });
    (report.statusLines ||= []).push({width, ...line});
    await shot(`harness-ready-status-${width}`);
  };
  const selectPage = async number => {
    const input = page.getByRole('spinbutton', {name: 'PDF 页码', exact: true});
    await input.fill(String(number)); await input.press('Enter'); await rowReady(number);
    await until(async () => Number(await input.inputValue()) === number, `未导航到第 ${number} 页`);
  };
  const selectAndCopyBody = async () => {
    const segment = await page.locator('.pdf-page-row[data-page-number="1"] .pdf-translation-block').evaluateAll(blocks =>
      blocks.find(block => (block.dataset.pdfSourceText || '').length > 180 && (block.querySelector('.pdf-translation-text span')?.textContent.length || 0) >= 10)?.dataset.pdfSegmentIndex);
    assert(segment !== undefined, '真实论文首页必须有可拖选的中文正文');
    const line = page.locator(`.pdf-page-row[data-page-number="1"] .pdf-translation-block[data-pdf-segment-index="${segment}"] .pdf-translation-text span`).first();
    await line.scrollIntoViewIfNeeded(); await line.hover(); await wait(50);
    const caret = async offset => line.evaluate((element, offset) => {
      const text = element.firstChild, range = document.createRange(); range.setStart(text, offset); range.setEnd(text, offset + 1);
      const box = range.getBoundingClientRect();
      for (const y of [box.top + box.height / 2, box.top + box.height * .35]) for (const x of [box.left + .1, box.left - .1, box.right - .1, box.right + .1]) {
        const point = document.caretPositionFromPoint?.(x, y), fallback = !point && document.caretRangeFromPoint?.(x, y);
        if ((point?.offsetNode || fallback?.startContainer) === text && (point?.offset ?? fallback?.startOffset) === offset) return {x, y};
      }
      throw new Error(`真实中文正文字符 ${offset} 没有可命中的鼠标坐标`);
    }, offset);
    const requests = fixture.state.requests.length, start = await caret(0), end = await caret(8);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, {steps: 24}); await page.mouse.up();
    const selected = await page.evaluate(() => ({text: getSelection()?.toString(), collapsed: getSelection()?.isCollapsed}));
    assert(selected.text?.trim() && !selected.collapsed, '真实鼠标拖选必须保留中文正文选区');
    assert.equal(selected.text, (await line.innerText()).slice(0, 8), '真实拖选须精确命中预期中文正文');
    await page.evaluate(() => {
      globalThis.__pdfHarnessCopy = null;
      document.addEventListener('copy', event => {globalThis.__pdfHarnessCopy = {text: getSelection()?.toString(), trusted: event.isTrusted}; event.preventDefault();}, {once: true});
    });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
    await until(async () => Boolean(await page.evaluate(() => globalThis.__pdfHarnessCopy)), '真实复制快捷键未触发copy事件');
    const copied = await page.evaluate(() => globalThis.__pdfHarnessCopy);
    assert(copied.trusted && copied.text === selected.text, '复制事件必须可信且携带完整所选译文');
    await wait(150); assert.equal(fixture.state.requests.length, requests, '选择复制译文不得触发额外翻译请求');
    report.realPaperCopy = {...copied, segment, start, end, clipboardWrite: false, requestsUnchanged: true,
      boundary: 'Actual mouse drag and trusted keyboard copy event; preventDefault preserves user clipboard. No OS clipboard readback claimed.'};
    await shot('harness-real-paper-selected-copy');
    await page.locator('.workspace-heading h1').click();
    const heading = await page.locator('.workspace-heading h1').boundingBox(); await page.mouse.move(heading.x + 2, heading.y + 2); await wait(50);
    record('real paper body supports native mouse selection and trusted copy without extra translation');
  };
  const pageGeometry = async number => page.locator(`.pdf-page-row[data-page-number="${number}"]`).evaluate((row, pageSize) => {
    const box = element => {const r = element.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height};};
    const source = row.querySelector('.pdf-page-column:not(.translated) .pdf-page-frame');
    const translated = row.querySelector('.pdf-page-column.translated .pdf-page-frame');
    const canvas = source?.querySelector('canvas'), sourceBox = source?.getBoundingClientRect(), targetBox = translated?.getBoundingClientRect();
    let inkCoverage, independentAbstractInk, independentFormulaInk;
    if (canvas && sourceBox && targetBox) {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const canvasBox = canvas.getBoundingClientRect(), masks = [...row.querySelectorAll('.pdf-translation-erase')].map(element => element.getBoundingClientRect());
      const paragraphs = [...row.querySelectorAll('.pdf-translation-block')].filter(element => (element.dataset.pdfSourceText || '').length > 180).slice(0, 3);
      if ([1, 16].includes(Number(row.dataset.pageNumber))) {
        // 真实 PDF 的独立墨迹带；不依赖可能同样受 font0/0 影响的 PDF.js span 框。
        const formula = Number(row.dataset.pageNumber) === 16;
        const band = formula ? {left: 197.5, right: 527.5, top: 249.5, bottom: 282.5} : {left: 87.496, right: 507.402, top: 293, bottom: 305};
        let dark = 0, uncovered = 0;
        const samples = [];
        for (let y = Math.floor(band.top / pageSize.height * canvas.height); y < Math.ceil(band.bottom / pageSize.height * canvas.height); y++) {
          for (let x = Math.floor(band.left / pageSize.width * canvas.width); x < Math.ceil(band.right / pageSize.width * canvas.width); x++) {
            const i = (y * canvas.width + x) * 4;
            if (pixels[i] > 100 || pixels[i + 1] > 100 || pixels[i + 2] > 100 || pixels[i + 3] < 128) continue;
            dark++;
            const px = targetBox.left + (canvasBox.left + (x + .5) * canvasBox.width / canvas.width - sourceBox.left);
            const py = targetBox.top + (canvasBox.top + (y + .5) * canvasBox.height / canvas.height - sourceBox.top);
            if (!masks.some(mask => px >= mask.left && px <= mask.right && py >= mask.top && py <= mask.bottom)) {
              uncovered++; if (samples.length < 20) samples.push({sourcePixelX: x, sourcePixelY: y, targetX: px, targetY: py});
            }
          }
        }
        const sampled = {band, pageSize, canvasPixels: {width: canvas.width, height: canvas.height},
          sampledDarkPixels: dark, uncoveredDarkPixels: uncovered, uncoveredSamples: samples};
        if (formula) independentFormulaInk = {...sampled, maskedDarkPixels: dark - uncovered};
        else independentAbstractInk = sampled;
      }
      inkCoverage = paragraphs.map(element => {
        const normalized = (element.dataset.pdfSourceText || '').replace(/\s/gu, '');
        const spans = [...source.querySelectorAll('[data-fluentread-pdf-text] span')].filter(span => {
          const text = span.textContent.replace(/\s/gu, ''); return text.length > 8 && normalized.includes(text);
        });
        let dark = 0, uncovered = 0; const uncoveredSamples = [];
        for (const span of spans) {
          const r = span.getBoundingClientRect();
          const x0 = Math.max(0, Math.floor((r.left - canvasBox.left) * canvas.width / canvasBox.width));
          const x1 = Math.min(canvas.width, Math.ceil((r.right - canvasBox.left) * canvas.width / canvasBox.width));
          const y0 = Math.max(0, Math.floor((r.top - canvasBox.top) * canvas.height / canvasBox.height));
          const y1 = Math.min(canvas.height, Math.ceil((r.bottom - canvasBox.top) * canvas.height / canvasBox.height));
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const i = (y * canvas.width + x) * 4;
            if (pixels[i] > 100 || pixels[i + 1] > 100 || pixels[i + 2] > 100 || pixels[i + 3] < 128) continue;
            dark++;
            const px = targetBox.left + (canvasBox.left + (x + .5) * canvasBox.width / canvas.width - sourceBox.left);
            const py = targetBox.top + (canvasBox.top + (y + .5) * canvasBox.height / canvas.height - sourceBox.top);
            if (!masks.some(mask => px >= mask.left && px <= mask.right && py >= mask.top && py <= mask.bottom)) {
              uncovered++; if (uncoveredSamples.length < 20) uncoveredSamples.push({x, y, translatedX: px, translatedY: py});
            }
          }
        }
        return {segment: element.dataset.pdfSegmentIndex, source: element.dataset.pdfSourceText, matchedSourceSpans: spans.length,
          sampledDarkPixels: dark, uncoveredDarkPixels: uncovered, uncoveredSamples};
      });
    }
    return {page: Number(row.dataset.pageNumber), row: box(row), sourceFrame: source && box(source), translatedFrame: translated && box(translated), inkCoverage, independentAbstractInk, independentFormulaInk,
      sourceSpans: [...(source?.querySelectorAll('[data-fluentread-pdf-text] span') || [])].map(element => ({text: element.textContent, box: box(element)})),
      translatedBlocks: [...row.querySelectorAll('.pdf-translation-block')].map(element => ({segment: element.dataset.pdfSegmentIndex,
        source: element.dataset.pdfSourceText, role: element.dataset.pdfRole, text: element.innerText, box: box(element),
        overflow: element.classList.contains('overflowing'), erases: [...element.querySelectorAll('.pdf-translation-erase')].map(mask => ({box: box(mask), style: mask.getAttribute('style')})),
        lines: [...element.querySelectorAll('.pdf-translation-text span')].map(line => ({text: line.textContent, box: box(line)}))}))};
  }, pageSizes[number - 1]);
  const zoomMenu = page.locator('.pdf-zoom-control .pdf-menu');
  await zoomMenu.locator('.pdf-menu-button').click();
  await zoomMenu.locator('[role="option"][data-value="1"]').click();
  await rowReady(1);
  for (const width of [1000, 1280, 1440, 1760, 1920, 390]) await inspectStatusLine(width);
  report.statusFailures = report.statusLines.filter(line => !line.sameLine || !line.fullWithinStatus || !line.fullWithinViewport);
  saveCheckpoint();
  if (!baseline) assert.equal(report.statusFailures.length, 0, `状态和完整数字进度必须同行且未截断：${JSON.stringify(report.statusFailures)}`);
  if (statusOnly) {record('ready status and complete passage count fit all scoped viewport widths'); return;}
  await page.setViewportSize({width: 1440, height: 960});
  await shot('harness-source-before-translation');
  // 夹具返回真实单段文本；通过产品开关关闭多段槽协议，避免协议降级成为排版测试的等待来源。
  await page.locator('aside.document-sidebar .document-settings-button').click();
  await page.locator('.document-batch-translation input').uncheck();
  await page.locator('.document-settings-dialog[open] .dialog-actions .ghost-button').click();
  saveCheckpoint();
  for (const number of pages) {
    await selectPage(number);
    const row = page.locator(`.pdf-page-row[data-page-number="${number}"]`);
    const requestedBefore = fixture.state.requests.length;
    const translatedBefore = await row.locator('.pdf-translation-block').count();
    const start = page.locator('.translation-actions .translate-document-button');
    if (await start.count()) {
      await start.click();
      let lastCheckpoint = 0;
      await until(async () => {
        const pending = await row.locator('[data-pdf-pending-segment]').count();
        const ready = await row.locator('.pdf-translation-block').count();
        if (Date.now() - lastCheckpoint > 3000) {
          report.pendingPage = {page: number, ready, pending, requests: fixture.state.requests.length,
            status: await page.locator('.document-status').innerText()};
          saveCheckpoint(); lastCheckpoint = Date.now();
          process.stdout.write(`HARNESS ${JSON.stringify(report.pendingPage)}\n`);
        }
        const error = page.getByTestId('document-translation-recovery');
        if (await error.count()) throw new Error(`翻译夹具失败：${await error.locator('.recovery-error-detail').textContent()}`);
        return ready > 0 && pending === 0;
      }, `第 ${number} 页没有完成真实翻译`, 180000);
      const pause = page.locator('.pause-button'); if (await pause.count()) await pause.click();
    }
    await wait(200); await selectPage(number); await checkFocus(`harness page ${number}`);
    const geometry = await pageGeometry(number);
    assert(geometry.translatedBlocks.length > 0, `第 ${number} 页没有译文 DOM`);
    fs.writeFileSync(path.join(artifactsDir, `harness-p${number}-geometry.json`), JSON.stringify(geometry, null, 2) + '\n');
    const sourceRaster = path.join(artifactsDir, `harness-p${number}-source-raster.png`);
    const sourceData = await row.locator('.pdf-page-column:not(.translated) .pdf-page-frame canvas').evaluate(canvas => canvas.toDataURL('image/png'));
    fs.writeFileSync(sourceRaster, Buffer.from(sourceData.split(',')[1], 'base64')); sourceRasters.set(number, sourceRaster);
    if (number === 1) {
      report.independentAbstractInk = geometry.independentAbstractInk;
      assert(geometry.independentAbstractInk.sampledDarkPixels > 100, '摘要墨迹带必须包含足够的真实源页墨迹');
      if (baseline) assert(geometry.independentAbstractInk.uncoveredDarkPixels > 0, '基线应复现摘要首行未完全遮盖');
      else assert.equal(geometry.independentAbstractInk.uncoveredDarkPixels, 0, '修复后摘要首行源墨迹必须全部在遮挡矩形内');
    }
    if (number === 16 && !baseline) {
      report.independentFormulaInk = geometry.independentFormulaInk;
      assert(geometry.independentFormulaInk.sampledDarkPixels > 100, '分段公式必须包含真实原图墨迹');
      assert.equal(geometry.independentFormulaInk.maskedDarkPixels, 0, '公式条件的原图墨迹不能被正文遮罩覆盖');
    }
    const rowShot = path.join(artifactsDir, `harness-p${number}-bilingual.png`);
    await row.screenshot({path: rowShot, animations: 'disabled'}); report.screenshots.push(rowShot);
    const sourceShot = path.join(artifactsDir, `harness-p${number}-source.png`);
    await row.locator('.pdf-page-column:not(.translated)').screenshot({path: sourceShot, animations: 'disabled'}); report.screenshots.push(sourceShot);
    const translatedShot = path.join(artifactsDir, `harness-p${number}-translated.png`);
    await row.locator('.pdf-page-column.translated').screenshot({path: translatedShot, animations: 'disabled'}); report.screenshots.push(translatedShot);
    report.harnessPages.push({page: number, translatedBefore, translatedBlocks: geometry.translatedBlocks.length,
      requests: fixture.state.requests.length - requestedBefore, progress: await page.getByTestId('document-translation-count').innerText(), geometry: path.join(artifactsDir, `harness-p${number}-geometry.json`)});
    saveCheckpoint(); record(`harness page ${number} captured with ${geometry.translatedBlocks.length} translated blocks`);
    if (number === 1 && !baseline) {await selectAndCopyBody(); saveCheckpoint();}
  }
  for (const mode of ['translated', 'bilingual']) {
    await checkFocus(`harness ${mode} export`);
    await page.locator('.download-button').click();
    const dialog = page.locator('.download-dialog[open]');
    await dialog.locator('.export-options button').nth(mode === 'bilingual' ? 0 : 1).click();
    const partial = dialog.locator('.partial-export input'); if (await partial.count()) await partial.check();
    const before = Date.now();
    const [download] = await Promise.all([page.waitForEvent('download', {timeout: 240000}),
      dialog.getByRole('button', {name: mode === 'bilingual' ? '下载双语文件' : '下载译文文件', exact: true}).click()]);
    const file = path.join(artifactsDir, `harness-${mode}.pdf`); await download.saveAs(file);
    assert(fs.statSync(file).size > 1000, '实际下载 PDF 不能为空');
    const exported = await PDFDocument.load(fs.readFileSync(file));
    assert.equal(exported.getPageCount(), sourcePdf.getPageCount(), '原版排版实际下载页数须与原稿一致');
    const protectedPixels = await downloadedRasters(file, pages, pageSizes, sourceRasters, artifactsDir, mode);
    report.pdfExports.push({mode, file, bytes: fs.statSync(file).size, pages: exported.getPageCount(), firstPageSize: exported.getPage(0).getSize(), elapsedMs: Date.now() - before,
      protectedPixels,
      boundary: 'Actual user download in original-layout presentation. Pending passages retain their source text; selected captured pages completed.'});
    const close = dialog.getByRole('button', {name: '返回文档', exact: true}); if (await dialog.count() && await close.count()) await close.click();
    saveCheckpoint(); record(`harness actual ${mode} PDF downloaded`);
  }
}

module.exports = {runPdfHarnessLayout};

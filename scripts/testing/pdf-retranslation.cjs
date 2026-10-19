'use strict';

// 已完成 PDF 的重复翻译专项；仅复用主 runner 的隔离后台 Edge、焦点保护和本机翻译夹具。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function runPdfRetranslation({page, fixture, report, shot, record, until, wait, openDocument, rowReady, checkFocus, artifactsDir}) {
  report.runScope = 'pdf-retranslation-only';
  report.selectionInput = 'No selection claim in this scoped completed-PDF retranslation test';
  report.providerEvidence = 'Production extension, PDF.js, IndexedDB history and actual download in isolated Edge; deterministic loopback translation provider with useCache:true.';
  report.retranslation = {useCacheEnabled: true, layouts: [], downloads: []};
  const filename = 'retranslation-fixture.pdf';
  const workspace = page.locator('[aria-label="文档工作区"]');
  const view = name => workspace.getByRole('button', {name, exact: true}).click();
  const action = () => page.locator('.translation-actions .translate-document-button');
  const confirmation = () => page.locator('dialog[open][aria-labelledby="confirm-document-heading"]');
  const snapshot = async () => {
    await view('校订译文');
    const rows = await page.locator('.segment-edit-row').evaluateAll(elements => elements.map(row => ({
      id: Number(row.dataset.segmentId), source: row.querySelector('.document-source').textContent,
      translation: row.querySelector('textarea')?.value || '',
    })));
    await view('阅读'); return rows;
  };
  const assertActions = async stage => {
    const download = page.locator('.document-taskbar .download-button');
    assert(await download.isVisible() && await download.isEnabled(), `${stage}: 已完成 PDF 必须保留可用下载入口`);
    assert(await action().isVisible() && await action().isEnabled(), `${stage}: 已完成 PDF 必须保留可用重译入口`);
    assert.equal((await action().innerText()).trim(), '重新翻译', `${stage}: 相同设置下应明确显示重新翻译`);
  };
  const complete = async stage => {
    await until(async () => (await page.locator('.document-status').innerText()).includes('翻译完成')
      && await page.locator('.pause-button').count() === 0, `${stage}: 翻译未完成`, 90000);
    await assertActions(stage);
    const rows = await snapshot();
    assert(rows.length > 0 && rows.length <= 40 && rows.every(row => row.translation.trim()), `${stage}: 单页夹具每个片段都应有译文`);
    return rows;
  };
  // 等待真实历史写事务可读，刷新和离开前不靠固定延时猜测保存完成。
  const historyTranslations = () => page.evaluate(name => new Promise((resolve, reject) => {
    const request = indexedDB.open('FluentReadDocumentHistory');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('documents')) {database.close(); resolve(null); return;}
      const transaction = database.transaction('documents', 'readonly');
      const read = transaction.objectStore('documents').getAll();
      read.onsuccess = () => resolve(read.result.find(record => record.name === name)?.translations || null);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = transaction.onabort = () => database.close();
    };
  }), filename);
  const waitForHistory = rows => until(async () => {
    const translations = await historyTranslations();
    return translations && rows.every(row => translations[row.id] === row.translation);
  }, '当前译文和校订没有完整写入本地历史');
  const useIndividualRequests = async () => {
    await page.locator('aside.document-sidebar .document-settings-button').click();
    await page.locator('.document-batch-translation input').uncheck();
    await page.locator('.document-settings-dialog[open] .dialog-actions .ghost-button').click();
  };

  // 明确逐段请求，使重译前后的相同 source 可以一一比较，捕获启用缓存时的假重译。
  await useIndividualRequests();
  const initialBefore = fixture.state.requests.length;
  await action().click();
  const initial = await complete('initial completion');
  const initialRequests = fixture.state.requests.slice(initialBefore).map(request => ({source: request.source, model: request.model}));
  assert(initialRequests.length > 0, '首次翻译必须实际请求本机服务');
  report.retranslation.initial = {segments: initial.length, requests: initialRequests};
  await waitForHistory(initial);
  await shot('pdf-retranslation-completed');
  record('completed PDF offers enabled download and retranslate actions together with cache enabled');

  const reopenRequests = fixture.state.requests.length;
  await page.reload(); await rowReady(1);
  await assertActions('reload restored result');
  assert.deepEqual(await snapshot(), initial, '刷新后必须完整恢复原译文');
  assert.equal(fixture.state.requests.length, reopenRequests, '刷新恢复历史不能自动重新请求翻译');
  await shot('pdf-retranslation-refreshed');
  await openDocument();
  await page.locator('.document-history .history-open').filter({hasText: filename}).click();
  await rowReady(1); await assertActions('recent history reopened');
  assert.deepEqual(await snapshot(), initial, '从最近翻译重新打开必须恢复原译文');
  assert.equal(fixture.state.requests.length, reopenRequests, '从最近翻译打开不能自动重新请求翻译');
  await shot('pdf-retranslation-history-reopened');
  // 批量模式属于内存任务选项；历史重开重新创建任务后，再设置为首次翻译使用的逐段模式。
  await useIndividualRequests();
  report.retranslation.reopen = {refresh: true, recentHistory: true, implicitRequests: 0};
  record('refresh and recent-history reopen retain both completed-PDF actions without implicit provider requests');

  const correction = '人工校订保留检查：取消重新翻译后，这一段应保持不变。';
  await view('校订译文');
  await page.locator('.segment-edit-row textarea').first().fill(correction);
  await view('阅读');
  const corrected = await snapshot();
  assert.equal(corrected[0].translation, correction);
  await waitForHistory(corrected);
  for (const width of [1440, 1000, 390]) {
    await page.setViewportSize({width, height: width === 390 ? 844 : 960}); await wait(120);
    await assertActions(`${width}px completed actions`);
    const layout = await page.locator('.document-taskbar').evaluate(toolbar => {
      const rect = selector => {
        const element = toolbar.querySelector(selector), box = element.getBoundingClientRect();
        return {left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height};
      };
      return {width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        download: rect('.download-button'), retranslate: rect('.translation-actions .translate-document-button')};
    });
    assert(layout.scrollWidth <= width, `${width}px 文档页不能横向溢出：${JSON.stringify(layout)}`);
    for (const key of ['download', 'retranslate']) assert(layout[key].left >= -1 && layout[key].right <= width + 1,
      `${width}px ${key} 必须完整位于视口：${JSON.stringify(layout)}`);
    const a = layout.download, b = layout.retranslate;
    assert(Math.min(a.right, b.right) <= Math.max(a.left, b.left) + 1 || Math.min(a.bottom, b.bottom) <= Math.max(a.top, b.top) + 1,
      `${width}px 下载和重译操作不能重叠：${JSON.stringify(layout)}`);
    report.retranslation.layouts.push(layout); await shot(`pdf-retranslation-actions-${width}`);
  }
  record('1440px, 1000px and 390px completed-PDF download/retranslation actions stay visible without overflow or overlap');

  const canceledBefore = fixture.state.requests.length;
  await action().click();
  await confirmation().waitFor();
  assert((await confirmation().innerText()).includes('人工校订'), '重译确认必须提示会替换人工校订');
  await shot('pdf-retranslation-confirm-390');
  await confirmation().getByRole('button', {name: '返回文档', exact: true}).click();
  await until(async () => await confirmation().count() === 0, '取消后重译确认未关闭');
  await wait(300);
  assert.equal(fixture.state.requests.length, canceledBefore, '取消重译不得发送翻译请求');
  assert.deepEqual(await snapshot(), corrected, '取消重译必须保留全部译文与人工校订');
  assert.deepEqual(await historyTranslations(), corrected.map(row => row.translation), '取消后本地历史中的校订也必须保留');
  await assertActions('canceled retranslation');
  report.retranslation.cancel = {requests: 0, correctionRetained: true, localHistoryRetained: true};
  record('canceling retranslation sends no request and preserves the corrected result in memory and local history');

  await page.setViewportSize({width: 1440, height: 960});
  const restartBefore = fixture.state.requests.length;
  await action().click(); await confirmation().waitFor();
  await confirmation().getByRole('button', {name: '重新翻译', exact: true}).click();
  await until(async () => fixture.state.requests.length > restartBefore, '相同设置确认重译后没有新服务请求，可能仍在复用旧缓存');
  const restarted = await complete('confirmed same-settings retranslation');
  const restartedRequests = fixture.state.requests.slice(restartBefore).map(request => ({source: request.source, model: request.model}));
  assert.deepEqual(restartedRequests.map(request => request.source).sort(), initialRequests.map(request => request.source).sort(),
    '启用缓存时，同设置重译必须重新请求全部原片段');
  assert(restarted.every(row => row.translation !== correction), '确认重译必须替换原来的人工校订');
  assert.deepEqual(restarted, initial, '确定性服务的重译结果应重新填充全部片段');
  await waitForHistory(restarted); await shot('pdf-retranslation-confirmed-complete');
  report.retranslation.confirm = {settingsChanged: false, initialRequests: initialRequests.length,
    newRequests: restartedRequests, correctionReplaced: true, downloadAvailable: true};
  record('confirming same-settings retranslation bypasses populated cache and requests every source again');

  await checkFocus('retranslated PDF actual download');
  await page.locator('.document-taskbar .download-button').click();
  const downloadDialog = page.locator('.download-dialog[open]');
  await downloadDialog.locator('.export-options button').nth(1).click();
  const started = Date.now();
  const [download] = await Promise.all([page.waitForEvent('download', {timeout: 120000}),
    downloadDialog.getByRole('button', {name: '下载译文文件', exact: true}).click()]);
  const file = path.join(artifactsDir, 'pdf-retranslated-result.pdf');
  await download.saveAs(file);
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', '重译后的真实下载应为 PDF 文件');
  assert(bytes.length > 1000, '重译后的实际 PDF 下载不能是空文件');
  report.retranslation.downloads.push({file, bytes: bytes.length, elapsedMs: Date.now() - started});
  if (await downloadDialog.count()) await downloadDialog.getByRole('button', {name: '返回文档', exact: true}).click();
  await assertActions('after translated PDF download');
  record('retranslated PDF still downloads a nonempty real PDF through the existing download workflow');
}

module.exports = {runPdfRetranslation};

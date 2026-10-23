#!/usr/bin/env node
'use strict';

/**
 * @file scripts/testing/run-document-action-hierarchy-test.cjs
 * 文件职责：用生产扩展和独立后台 Edge 验证文档翻译按钮随任务阶段切换主次。
 * 主要内容：在 390px 首次导入小 TXT，验证侧栏默认收起、展开后文件与添加入口可见且可滚动，收起恢复正文空间；调用本机确定性 HTTP 翻译、检查按钮计算样式并截图，验证校订器首次按需挂载及往返保留搜索、重译确认的返回/Esc 不请求、目标语言变化及真实双语下载；在 1440/900/390 宽测量任务提示与正文首行的位置，防止警告覆盖阅读内容。
 * 模块边界：只操作本次临时 profile；复用焦点保护与所属浏览器清理，不调用真实供应商，不改变产品运行时或扩大全量回归。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {createRequire} = require('node:module');
const {launchFocusSafePersistentContext, activateExtensionTabWithoutForeground, queryMacFrontmostApplication} = require('./focus-safe-browser.cjs');
const {guardBrowserClose, getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const argument = name => {const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1];};
const SOURCE = 'A clear reading experience keeps the original text in focus. Important actions should be easy to find.';
const TRANSLATION = '清晰的阅读体验应让原文保持突出，重要操作应当容易找到。';
const FILE_NAME = 'controlled-action-hierarchy.txt';
const FIXTURE_MODEL = 'document-action-hierarchy-fixture';

function fingerprint(directory) {
  const files = [];
  const visit = relative => {for (const entry of fs.readdirSync(path.join(directory, relative), {withFileTypes: true})) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) visit(file); else if (entry.isFile()) files.push(file);
  }};
  visit(''); const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(file).update(fs.readFileSync(path.join(directory, file)));
  return {sha256: hash.digest('hex'), fileCount: files.length};
}

async function fixtureServer() {
  const requests = [], errors = [];
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
    try {
      assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/chat/completions');
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const prompt = body.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
      const source = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1];
      assert.equal(typeof source, 'string'); assert.equal(body.model, FIXTURE_MODEL);
      assert(source.replace(/<\/?g\d+>/gu, '').includes(SOURCE), 'The fixture must receive the imported document text');
      requests.push({source, model: body.model, at: new Date().toISOString()});
      // 返回真正的中文正文，保留存在的 g 标签，不能用英文加前缀绕过生产目标语言检查。
      const translated = /<\/?g\d+>/u.test(source)
        ? source.split(/(<\/?g\d+>)/u).map(part => /^<\/?g\d+>$/u.test(part) || !part.trim() ? part : TRANSLATION).join('')
        : TRANSLATION;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({id: 'document-action-hierarchy', object: 'chat.completion', created: 1, model: FIXTURE_MODEL,
        choices: [{index: 0, message: {role: 'assistant', content: translated}, finish_reason: 'stop'}],
        usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20}}));
    } catch (error) {
      errors.push(error.message); response.writeHead(400); response.end(JSON.stringify({error: {message: error.message}}));
    }
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return {requests, errors, endpoint: `http://127.0.0.1:${server.address().port}/v1/chat/completions`,
    close: () => {server.closeAllConnections(); return new Promise(resolve => server.close(resolve));}};
}

async function main() {
  for (const name of ['extension-dir', 'playwright-root', 'artifacts-dir']) assert(argument(name), `--${name} is required`);
  const extensionDir = path.resolve(argument('extension-dir')), artifactsDir = path.resolve(argument('artifacts-dir'));
  const widths = (argument('widths') || '1440,900,390').split(',').map(Number);
  assert(widths.length && widths.every(width => Number.isInteger(width) && width >= 320 && width <= 1920), '--widths accepts comma-separated widths from 320 to 1920');
  assert(fs.existsSync(path.join(extensionDir, 'manifest.json')), 'A prebuilt extension manifest is required');
  assert(!extensionDir.endsWith('-dev'), 'This targeted delivery harness requires a production extension build');
  const {chromium} = createRequire(path.join(path.resolve(argument('playwright-root')), 'document-action-hierarchy.cjs'))('playwright');
  fs.mkdirSync(artifactsDir, {recursive: true});
  fs.writeFileSync(path.join(artifactsDir, FILE_NAME), SOURCE);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-document-actions-'));
  const report = {ok: false, extensionDir, artifactsDir, artifactKind: 'production', widths, startedAt: new Date().toISOString(),
    scope: 'One TXT document: initial 390 px import with a collapsed sidebar, accessible expanded file list and restored reading space, deferred editor mount and retained search, initial/completed/changed-language action hierarchy, toolbar notice/first-paragraph geometry down to 390 px, return/Escape confirmation cancellation, actual bilingual download.',
    limitations: ['Controlled loopback translation validates runtime and UI, not live provider quality.', 'Edge desktop viewport evidence only; no Firefox, Safari, physical mobile device or full document regression.'],
    cases: [], screenshots: [], downloads: [], consoleErrors: [], workerErrors: [], blockedRequests: [], cleanupErrors: [], focusSamples: [], singlePageReuse: true};
  let fixture, session, page, worker, browserPid, launched = false, focusViolation = false, currentCase = 'bootstrap';
  const step = name => {currentCase = name; console.log(`[document-actions] ${name}`);};
  const focusCheck = async label => {
    const frontmost = await queryMacFrontmostApplication();
    if (!frontmost?.pid || frontmost.pid === browserPid) {
      focusViolation = true;
      throw new Error(frontmost?.pid ? `${label}: isolated Edge ${browserPid} became frontmost` : `${label}: frontmost application is not observable`);
    }
    report.focusSamples.push({label, ...frontmost, ownedPid: browserPid, at: new Date().toISOString()});
    return frontmost;
  };
  try {
    fixture = await fixtureServer(); report.productionFingerprint = fingerprint(extensionDir); launched = true;
    session = await launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: argument('browser-path') || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      background: true, headless: false, displayTarget: argument('display') || 'secondary', viewport: {width: 1440, height: 960}, timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking']});
    guardBrowserClose(session, profileDir); browserPid = await getGuardedBrowserPid(session);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement, ownedPid: browserPid});
    assert.equal(report.launchMode, 'macos-background-cdp'); assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus'); assert.equal(report.windowPlacement.browserFrontmost, false);
    await focusCheck('launch');
    const context = session.context;
    await context.route('**/*', route => {
      const url = route.request().url();
      if (/^https?:/u.test(url) && url !== fixture.endpoint) {report.blockedRequests.push(url); return route.abort('blockedbyclient');}
      return route.continue();
    });
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
    worker.on('console', message => {if (message.type() === 'error') report.workerErrors.push(message.text());});
    // Playwright 页面路由不保证覆盖 Service Worker fetch；在其外部 HTTP 边界只放行本机 fixture。
    await worker.evaluate(endpoint => {
      const originalFetch = globalThis.fetch.bind(globalThis);
      globalThis.__documentHierarchyBlockedRequests = [];
      globalThis.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (/^https?:/u.test(url) && url !== endpoint) {
          globalThis.__documentHierarchyBlockedRequests.push(url);
          return Promise.reject(new Error('Document hierarchy harness blocked a non-fixture request'));
        }
        return originalFetch(input, init);
      };
    }, fixture.endpoint);
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const initialPages = context.pages(); report.initialPageCount = initialPages.length;
    page = initialPages.find(candidate => candidate.url().startsWith('about:blank#fluentread-background-')) || (initialPages.length === 1 ? initialPages[0] : undefined);
    assert(page, 'Reuse the helper-created page; do not create a fallback tab'); page.setDefaultTimeout(30000);
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push(message.text());});
    page.on('dialog', dialog => {if (dialog.type() === 'beforeunload') void dialog.accept(); else void dialog.dismiss();});
    await page.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'});
    // 初次挂载与导入都必须真正处于窄屏，不能在桌面默认状态建立后再缩小窗口冒充验收。
    await page.setViewportSize({width: 390, height: 960});
    await page.goto(`${origin}/document.html`, {waitUntil: 'domcontentloaded'}); await activateExtensionTabWithoutForeground(context, page);
    await focusCheck('document-opened');
    await page.locator('.file-drop-zone').waitFor();
    const service = 'custom:document-action-hierarchy';
    const seeded = await page.evaluate(async ({service, endpoint, model}) => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!result.success) throw new Error(result.error);
      const stored = typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
      return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'replace', baseRevision: stored.__fluentConfigRevision,
        clientId: `document-action-hierarchy-${crypto.randomUUID()}`, sequence: 1, config: {...stored,
          on: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, from: 'en', to: 'zh-Hans', documentService: service, useCache: false,
          documentModel: {...stored.documentModel, [service]: model}, customOpenAIProviders: [{id: service, name: '本机验收翻译', endpoint, models: [model]}],
          requireApiKey: {[`v2:${JSON.stringify([service, model])}`]: false}, proxy: {...stored.proxy, [service]: ''},
          user_role: {...stored.user_role, [service]: 'SOURCE_BEGIN{{origin}}SOURCE_END'}, enableAIContext: false, enableAIMultiSegment: false,
        }});
    }, {service, endpoint: fixture.endpoint, model: FIXTURE_MODEL});
    assert.equal(seeded.success, true, seeded.error);
    await page.reload({waitUntil: 'domcontentloaded'}); await page.locator('.file-drop-zone').waitFor();
    const shot = async name => {
      await focusCheck(`before:${name}`); const file = path.join(artifactsDir, `${name}.png`);
      await page.screenshot({path: file, animations: 'disabled'}); report.screenshots.push(file);
      await focusCheck(`after:${name}`); return file;
    };
    const taskbar = page.locator('.document-taskbar');
    const translationButton = taskbar.locator('.translation-actions .translate-document-button');
    const downloadButton = taskbar.locator('.download-button');
    const snapshotHierarchy = async (name, expected) => {
      for (const width of widths) {
        await page.setViewportSize({width, height: 960}); await page.mouse.move(4, 4);
        await page.locator(`.toolbar-primary-actions[data-primary-action="${expected}"]`).waitFor();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const evidence = await page.evaluate(source => {
          const root = document.querySelector('.document-app'), group = document.querySelector('.toolbar-primary-actions');
          const brand = document.createElement('span'); brand.style.color = getComputedStyle(root).getPropertyValue('--brand');
          document.body.appendChild(brand); const brandColor = getComputedStyle(brand).color; brand.remove();
          const inspect = selector => {
            const button = group.querySelector(selector), style = getComputedStyle(button), rect = button.getBoundingClientRect();
            return {text: button.textContent.trim(), disabled: button.disabled, background: style.backgroundColor, color: style.color,
              rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom}};
          };
          const rect = node => {const r = node.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom};};
          const pane = rect(document.querySelector('.document-reading-pane'));
          const notices = [...document.querySelectorAll('.taskbar-notices > *')].filter(node => node.getClientRects().length).map(node => ({text: node.textContent, ...rect(node)}));
          const frame = document.querySelector('.rich-preview-frame'), documentInFrame = frame?.contentDocument;
          let firstLine = null;
          if (documentInFrame?.body) {
            const walker = documentInFrame.createTreeWalker(documentInFrame.body, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent.includes(source)) {
              const range = documentInFrame.createRange(); range.selectNodeContents(node); const line = range.getClientRects()[0];
              if (line) firstLine = {top: frame.getBoundingClientRect().top + line.top, bottom: frame.getBoundingClientRect().top + line.bottom};
              break;
            }
          }
          return {primary: group.dataset.primaryAction, brand: brandColor, translate: inspect('.translate-document-button'), download: inspect('.download-button'), pane, notices, firstLine,
            viewport: {width: innerWidth, height: innerHeight}, overflow: document.documentElement.scrollWidth > innerWidth};
        }, SOURCE);
        const primary = evidence[expected], secondary = evidence[expected === 'download' ? 'translate' : 'download'];
        assert.equal(primary.disabled, false); assert.equal(secondary.disabled, false);
        assert.equal(primary.background, evidence.brand, 'The current main action must use the solid brand background');
        assert.notEqual(secondary.background, evidence.brand, 'The secondary action must not compete with the solid main action');
        assert.equal(evidence.overflow, false, 'Document page must not overflow horizontally');
        for (const action of [primary, secondary]) assert(action.rect.width > 0 && action.rect.height > 0 && action.rect.x >= 0 && action.rect.right <= width + 1 && action.rect.bottom <= 960, 'Both actions must remain visible');
        assert(primary.rect.right <= secondary.rect.x || secondary.rect.right <= primary.rect.x || primary.rect.bottom <= secondary.rect.y || secondary.rect.bottom <= primary.rect.y, 'Action buttons must not overlap');
        assert(evidence.firstLine && evidence.firstLine.top >= evidence.pane.y - 1 && evidence.firstLine.bottom <= 960, 'Original first line remains visible inside the reading pane');
        assert(evidence.notices.every(notice => notice.bottom <= evidence.pane.y + 1 && notice.bottom <= evidence.firstLine.top + 1 && notice.x >= 0 && notice.right <= width + 1), 'Toolbar notices must occupy their own layout row above the reading pane and original text');
        if (name === '04-language-changed') {
          assert.equal(evidence.notices.filter(notice => notice.text.includes('设置已更改')).length, 1, 'Exactly one retained-result warning');
        }
        report.cases.push({name: `${name}-${width}`, ok: true, ...evidence, screenshot: await shot(`${name}-${width}`)});
      }
      await page.setViewportSize({width: 1440, height: 960});
    };
    const assertQuiet = async (count, name) => {
      await page.waitForTimeout(350); assert.equal(fixture.requests.length, count, `${name} must not submit a translation request`);
      report.cases.push({name, ok: true, requestsBefore: count, requestsAfter: fixture.requests.length});
    };
    step('import and initial translation priority');
    await page.locator('input[type=file]').setInputFiles({name: FILE_NAME, mimeType: 'text/plain', buffer: Buffer.from(SOURCE)});
    await page.locator('.workspace-heading h1').filter({hasText: FILE_NAME}).waitFor();
    await page.waitForFunction(source => document.querySelector('.rich-preview-frame')?.contentDocument?.body?.innerText.includes(source), SOURCE);
    await translationButton.filter({hasText: '开始翻译'}).waitFor();
    step('initial narrow sidebar is collapsed and the expanded list remains accessible');
    assert.equal(await page.evaluate(() => innerWidth), 390, 'First document import must happen at 390 px');
    const sidebar = page.locator('.document-sidebar'), sidebarToggle = taskbar.locator('.sidebar-toggle');
    const readingPane = page.locator('.document-reading-pane');
    assert.equal(await sidebarToggle.getAttribute('aria-expanded'), 'false');
    await sidebar.waitFor({state: 'hidden'});
    const initialReading = await readingPane.boundingBox();
    await shot('00-sidebar-collapsed-390');
    await sidebarToggle.click(); await sidebar.waitFor();
    assert.equal(await sidebarToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await sidebar.locator('.document-settings-button').isVisible(), false, 'Narrow sidebar omits the duplicate settings entry');
    assert.equal(await taskbar.getByRole('button', {name: '翻译设置', exact: true}).isVisible(), true, 'The toolbar retains the settings entry');
    const expandedReading = await readingPane.boundingBox();
    const queue = sidebar.locator('.document-batch');
    const inspectSidebarControl = async (control, name) => {
      await control.scrollIntoViewIfNeeded();
      const evidence = await control.evaluate(element => {
        const rect = element.getBoundingClientRect(), list = element.closest('.document-batch'), pane = list.getBoundingClientRect();
        return {control: {top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height},
          list: {top: pane.top, bottom: pane.bottom, height: pane.height, clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, scrollTop: list.scrollTop, overflowY: getComputedStyle(list).overflowY}};
      });
      assert(evidence.control.width > 0 && evidence.control.height > 0 && evidence.list.height > 0, `${name} must have visible content space`);
      assert(evidence.control.top >= evidence.list.top - 1 && evidence.control.bottom <= evidence.list.bottom + 1, `${name} must be fully reachable inside the scrollable file list`);
      assert.equal(evidence.list.overflowY, 'auto');
      return evidence;
    };
    const fileEvidence = await inspectSidebarControl(queue.locator('.batch-file').filter({hasText: FILE_NAME}), 'Current file');
    await shot('00-sidebar-expanded-390');
    const addEvidence = await inspectSidebarControl(queue.getByRole('button', {name: '添加文件', exact: true}), 'Add file');
    await shot('00-sidebar-add-file-390');
    const sidebarBounds = await sidebar.boundingBox();
    assert(sidebarBounds.height <= 201, 'Expanded narrow sidebar must retain its 200 px height limit');
    if (addEvidence.list.scrollHeight > addEvidence.list.clientHeight + 1) assert(addEvidence.list.scrollTop > 0, 'Overflowing file controls must remain reachable by internal scrolling');
    await sidebarToggle.click(); await sidebar.waitFor({state: 'hidden'});
    const collapsedReading = await readingPane.boundingBox();
    assert(collapsedReading.height > expandedReading.height && collapsedReading.y < expandedReading.y, 'Collapsing the sidebar returns its space to the document');
    assert(Math.abs(collapsedReading.height - initialReading.height) <= 1, 'Closing the sidebar restores the original reading height');
    await page.setViewportSize({width: 1440, height: 960});
    assert.equal(await sidebarToggle.getAttribute('aria-expanded'), 'false', 'Resize must preserve the user choice');
    await sidebar.waitFor({state: 'hidden'});
    report.cases.push({name: 'narrow-sidebar-initial-and-user-toggle', ok: true, initialReading, expandedReading, collapsedReading, fileEvidence, addEvidence, sidebarBounds});
    await snapshotHierarchy('01-start', 'translate');
    assert.equal(await page.locator('.segment-editor').count(), 0, 'Reading alone must not mount the hidden full-document editor');
    report.cases.push({name: 'editor-not-mounted-during-reading', ok: true, editorNodes: 0});
    assert.equal(fixture.requests.length, 0);
    step('actual loopback translation and completed download priority');
    await translationButton.click(); await page.locator('.document-status').filter({hasText: '翻译完成'}).waitFor();
    assert.equal(fixture.requests.length, 1, 'One small paragraph must complete through one real loopback request');
    await page.waitForFunction(translation => document.querySelector('.rich-preview-frame')?.contentDocument?.body?.innerText.includes(translation), TRANSLATION);
    await snapshotHierarchy('02-completed', 'download');
    step('editor mounts on demand and preserves search across reading');
    const editor = page.locator('.segment-editor'), editTab = taskbar.getByRole('button', {name: '校订译文', exact: true});
    await editTab.click(); await editor.waitFor();
    const search = editor.getByRole('searchbox');
    await search.fill('no-matching-fragment');
    assert.equal(await editor.locator('.segment-edit-row').count(), 0);
    await taskbar.getByRole('button', {name: '阅读', exact: true}).click(); await editor.waitFor({state: 'hidden'});
    assert.equal(await editor.count(), 1, 'An opened editor remains mounted for the current document');
    await editTab.click(); await editor.waitFor();
    assert.equal(await search.inputValue(), 'no-matching-fragment');
    assert.equal(await editor.locator('.segment-edit-row').count(), 0);
    await search.clear(); await editor.locator('.segment-edit-row').waitFor();
    assert.equal(await editor.locator('textarea').inputValue(), TRANSLATION);
    await taskbar.getByRole('button', {name: '阅读', exact: true}).click();
    await assertQuiet(1, 'editor-search-retained-without-request');
    step('cancel retranslation using Return and Escape');
    const confirmation = page.locator('dialog[open][aria-labelledby="confirm-document-heading"]');
    for (const method of ['return', 'escape']) {
      const before = fixture.requests.length; await translationButton.click(); await confirmation.waitFor();
      assert.match(await confirmation.innerText(), /重新翻译会替换现有译文/u); await assertQuiet(before, `confirmation-open-${method}`);
      await shot(`03-confirmation-${method}`);
      if (method === 'return') await confirmation.getByRole('button', {name: '返回文档', exact: true}).click(); else await page.keyboard.press('Escape');
      await confirmation.waitFor({state: 'hidden'}); await assertQuiet(before, `confirmation-canceled-${method}`);
    }
    step('changed target language restores translation priority');
    const language = page.getByRole('combobox', {name: '目标语言', exact: true});
    await page.locator('.el-select__wrapper').filter({has: language}).click();
    await page.getByRole('option', {name: 'Français', exact: true}).click();
    await translationButton.filter({hasText: '按新设置翻译'}).waitFor(); await snapshotHierarchy('04-language-changed', 'translate');
    const count = fixture.requests.length; await translationButton.click(); await confirmation.waitFor();
    await confirmation.getByRole('button', {name: '返回文档', exact: true}).click(); await confirmation.waitFor({state: 'hidden'});
    await assertQuiet(count, 'changed-language-restart-canceled');
    step('download the retained result while new settings remain unapplied');
    await downloadButton.click(); const downloadDialog = page.locator('.download-dialog[open]'); await downloadDialog.waitFor();
    assert.match(await downloadDialog.innerText(), /设置已更改，本次下载仍是当前保留的译文/u);
    await downloadDialog.locator('.export-options button').first().click(); await shot('05-download-current-result');
    const [download] = await Promise.all([page.waitForEvent('download'), downloadDialog.getByRole('button', {name: '下载双语文件', exact: true}).click()]);
    const downloadedPath = path.join(artifactsDir, `downloaded-${path.basename(download.suggestedFilename())}`); await download.saveAs(downloadedPath);
    assert.equal(await download.failure(), null); const downloadedText = fs.readFileSync(downloadedPath, 'utf8');
    assert(downloadedText.includes(SOURCE)); assert(downloadedText.includes(TRANSLATION));
    report.downloads.push({file: downloadedPath, bytes: fs.statSync(downloadedPath).size, containsSource: true, containsTranslation: true});
    await assertQuiet(count, 'download-does-not-retranslate');
    report.finalFrontmostApplication = await focusCheck('complete');
    report.workerBlockedRequests = await worker.evaluate(() => globalThis.__documentHierarchyBlockedRequests || []);
    assert.deepEqual(fixture.errors, []); assert.deepEqual(report.blockedRequests, []); assert.deepEqual(report.workerBlockedRequests, []);
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.workerErrors, []); report.ok = true;
  } catch (error) {
    report.failedCase = currentCase; report.failure = error.stack || String(error); process.exitCode = 1;
    if (!focusViolation && worker) report.workerBlockedRequests = await worker.evaluate(() => globalThis.__documentHierarchyBlockedRequests || []).catch(() => null);
    if (!focusViolation && page && !page.isClosed() && browserPid) {
      try {
        await focusCheck('before:failure');
        report.failureUi = await page.evaluate(() => ({url: location.href, text: document.body?.innerText.slice(0, 12000)})).catch(() => null);
        const file = path.join(artifactsDir, 'failure.png'); await page.screenshot({path: file, animations: 'disabled'}); report.screenshots.push(file);
        await focusCheck('after:failure');
      } catch (captureError) {report.failureCaptureError = captureError.message;}
    }
  } finally {
    report.requests = fixture?.requests || []; report.fixtureErrors = fixture?.errors || [];
    let closed = false;
    if (session) {try {await session.close(); closed = true;} catch (error) {report.cleanupErrors.push(`browser close: ${error.message}`);}}
    if (closed || !launched) {try {fs.rmSync(profileDir, {recursive: true, force: true});} catch (error) {report.cleanupErrors.push(`profile removal: ${error.message}`);}}
    else report.retainedProfile = profileDir;
    if (fixture) {try {await fixture.close();} catch (error) {report.cleanupErrors.push(`fixture close: ${error.message}`);}}
    if (report.productionFingerprint) {
      report.finalProductionFingerprint = fingerprint(extensionDir);
      if (report.productionFingerprint.sha256 !== report.finalProductionFingerprint.sha256) report.cleanupErrors.push('Production build changed during acceptance');
    }
    if (report.cleanupErrors.length) {report.ok = false; process.exitCode = 1;}
    report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ok: report.ok, report: path.join(artifactsDir, 'report.json'), cases: report.cases.length, failedCase: report.failedCase, failure: report.failure}));
  }
}

main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});

/**
 * @file scripts/testing/run-github-document-stability-test.cjs
 * 文件职责：在隔离后台 Edge 中验证 GitHub 文档混合行内代码、链接和列表的译文稳定性。
 * 主要内容：使用真实快捷键与受控微软响应，记录源码节点身份、保护内容、译文增删与内部子节点重写，覆盖窗口尺寸变化、全文翻译、恢复、再次翻译及悬浮切换；尺寸复验超时只关闭本次隔离浏览器，支持正式发行包与截图来源实站。
 * 模块边界：仅通过公开配置消息驱动临时配置；不读取业务内部状态、不连接用户 profile、不替换实站正文，不改变用户的供应商设置。
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
const argument = (key, fallback) => {
  const index = process.argv.indexOf(`--${key}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const root = path.resolve(__dirname, '../..');
const extensionDir = path.resolve(argument('extension-dir', path.join(root, '.output/chrome-mv3')));
const output = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-github-document-stability'));
const packages = argument('playwright-root', '');
assert.ok(packages, '需要 --playwright-root');
assert.ok(!process.argv.includes('--headed'), '本专项仅允许后台隔离 Edge');
const {chromium} = require(path.join(packages, 'playwright'));
const helper = require(path.resolve(argument('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))));
const live = process.argv.includes('--live');
const expectRegression = process.argv.includes('--expect-regression');
const published = process.argv.includes('--published');
const fullMode = argument('full-mode', 'viewport');
assert.ok(['viewport', 'all'].includes(fullMode), 'full-mode 必须为 viewport 或 all');
const url = argument('url', live ? 'https://github.com/nicobailon/pi-subagents/blob/main/docs/models.md' : 'https://github.com/fixture/document/blob/main/models.md');
const durationMs = Number(argument('observe-ms', '8000'));
assert.ok(Number.isFinite(durationMs) && durationMs >= 1000 && durationMs <= 60000, 'observe-ms 必须为 1000 至 60000');
fs.mkdirSync(output, {recursive: true});
const report = {ok: false, live, expectRegression, published, fullMode, url, provider: 'microsoft-controlled-local-response',
  scope: live ? 'Live screenshot-source GitHub document, controlled provider response' : 'Authored GitHub-domain mixed-inline document fixture, controlled provider response',
  limitations: ['Local provider responses do not prove live translation service quality or latency', 'Only the selected document paragraphs, heading and fixture list are monitored'],
  cases: [], consoleErrors: []};
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-github-document-stability-'));
report.profileDir = profileDir;
const wrapper = '.fluent-read-bilingual-content';
let session, page, worker;
let sequence = 0;

async function patchConfig(popup, updates) {
  const result = await popup.evaluate(async ({updates, sequence}) => {
    const stored = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!stored.success) throw new Error(stored.error);
    const config = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value;
    return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: updates,
      expected: Object.fromEntries(Object.keys(updates).map(key => [key, config[key]])),
      clientId: 'github-document-stability', sequence, baseRevision: config.__fluentConfigRevision});
  }, {updates, sequence: ++sequence});
  assert.equal(result.success, true, JSON.stringify(result));
}

async function fullToggle() {
  await helper.activateExtensionTabWithoutForeground(session.context, page);
  await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
}

async function hoverToggle() {
  await helper.activateExtensionTabWithoutForeground(session.context, page);
  const owner = page.locator('[data-github-stability-check="0"]');
  await owner.scrollIntoViewIfNeeded();
  const position = await owner.evaluate(node => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
      if (!text.data.trim() || text.parentElement.closest('code,a,.fluent-read-bilingual-content,[data-fr-translation-owned="true"]')) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const rect of range.getClientRects()) if (rect.width > 5 && rect.height > 5 && rect.top >= 0 && rect.bottom <= innerHeight) {
        const x = rect.x + Math.min(10, rect.width / 2), y = rect.y + rect.height / 2;
        if (node.contains(document.elementFromPoint(x, y))) return {x, y};
      }
    }
    throw new Error('找不到目标段落中的普通文本');
  });
  await page.mouse.move(position.x, position.y); await page.mouse.click(position.x, position.y);
  await page.keyboard.down('Control'); await page.keyboard.up('Control');
}

async function prepareOwners() {
  return page.evaluate(({live, wrapper}) => {
    const owned = '.fluent-read-bilingual-content,.fluent-read-loading,.fluent-read-retry-wrapper,[data-fr-translation-owned="true"]';
    let owners;
    if (live) {
      const headings = [...document.querySelectorAll('.markdown-body h2')].filter(node => node.textContent.trim() === 'Fast mode');
      if (headings.length !== 1) throw new Error(`Expected one Fast mode heading, got ${headings.length}`);
      const heading = headings[0], boundary = heading.closest('.markdown-heading') || heading;
      let previous = boundary.previousElementSibling;
      while (previous && previous.localName !== 'p') previous = previous.previousElementSibling;
      const next = [];
      let sibling = boundary.nextElementSibling;
      while (sibling && next.length < 2 && !sibling.matches('h2,.markdown-heading')) {
        if (sibling.localName === 'p') next.push(sibling);
        sibling = sibling.nextElementSibling;
      }
      if (!previous || next.length !== 2) throw new Error('Screenshot paragraphs around Fast mode are unavailable');
      owners = [previous, heading, ...next];
    } else owners = ['mixed','heading','fast','limits','list'].map(id => document.getElementById(id));
    const originalTextNodes = root => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
      let node;
      while ((node = walker.nextNode())) if (!node.parentElement.closest(owned)) nodes.push(node);
      return nodes;
    };
    const records = owners.map((node, index) => {
      node.setAttribute('data-github-stability-check', String(index));
      return {node, index, originalHtml: node.innerHTML, originalText: node.textContent,
        textNodes: originalTextNodes(node), protectedNodes: [...node.querySelectorAll('code,a')].map(node => ({node, html: node.outerHTML}))};
    });
    const guards = live ? [] : ['navigation','code-block'].map(id => {
      const node = document.getElementById(id);
      return {node, id, html: node.outerHTML};
    });
    const watcher = {records, events: [], adds: new Map(), removals: new Map(), innerWrites: new Map(), mutationCount: 0, eventOverflow: 0};
    const ids = new WeakMap(); let nextId = 1;
    const idFor = node => {if (!ids.has(node)) ids.set(node, nextId++); return ids.get(node);};
    const ownerFor = node => records.find(record => record.node === node || record.node.contains(node));
    const wrappersIn = node => node.nodeType === 1 ? [ ...(node.matches(wrapper) ? [node] : []), ...node.querySelectorAll(wrapper) ] : [];
    const log = event => {if (watcher.events.length < 6000) watcher.events.push(event); else watcher.eventOverflow += 1;};
    watcher.observer = new MutationObserver(mutations => {
      const now = performance.now();
      for (const mutation of mutations) {
        const record = ownerFor(mutation.target) || (mutation.type === 'childList' && records.find(record =>
          [...mutation.removedNodes].some(node => node === record.node || node.contains(record.node))));
        if (!record) continue;
        watcher.mutationCount += 1;
        const common = {at: now, owner: record.index, type: mutation.type, target: mutation.target.nodeName,
          attribute: mutation.attributeName, oldValue: mutation.oldValue,
          targetHtml: mutation.target.nodeType === 1 ? mutation.target.outerHTML.slice(0, 500) : undefined,
          insideTranslation: Boolean((mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement)?.closest(wrapper))};
        if (mutation.type === 'childList') {
          if (common.insideTranslation) {
            watcher.innerWrites.set(record.index, (watcher.innerWrites.get(record.index) || 0) + 1);
            log({...common, action: 'inner-rewrite', addedCount: mutation.addedNodes.length, removedCount: mutation.removedNodes.length});
          }
          for (const [action, nodes, counts] of [['add', mutation.addedNodes, watcher.adds], ['remove', mutation.removedNodes, watcher.removals]]) {
            for (const node of nodes) for (const artifact of wrappersIn(node)) {
              counts.set(record.index, (counts.get(record.index) || 0) + 1);
              log({...common, action, wrapperId: idFor(artifact), text: artifact.textContent.slice(0, 300)});
            }
          }
        } else log({...common, value: mutation.type === 'characterData' ? mutation.target.data : mutation.target.getAttribute(mutation.attributeName)});
      }
    });
    watcher.observer.observe(document.body, {subtree: true, childList: true, characterData: true, characterDataOldValue: true,
      attributes: true, attributeOldValue: true});
    watcher.reset = () => {watcher.observer.takeRecords(); watcher.events.length = 0; watcher.adds.clear(); watcher.removals.clear(); watcher.innerWrites.clear(); watcher.mutationCount = 0; watcher.eventOverflow = 0;};
    watcher.snapshot = () => ({mutationCount: watcher.mutationCount, eventOverflow: watcher.eventOverflow, events: [...watcher.events],
      guards: guards.map(({node,id,html}) => ({id, intact: node.isConnected && node.outerHTML === html,
        translationCount: node.querySelectorAll(wrapper).length})),
      owners: records.map(record => ({index: record.index, source: record.originalText, html: record.node.outerHTML,
        translation: [...record.node.querySelectorAll(wrapper)].map(node => node.textContent).join('\n'),
        wrapperIds: [...record.node.querySelectorAll(wrapper)].map(idFor),
        count: [...record.node.querySelectorAll(wrapper)].filter(node => node.parentElement === record.node ||
          (node.parentElement.matches('[data-fr-translation-segment="true"]') && node.parentElement.parentElement === record.node)).length,
        adds: watcher.adds.get(record.index) || 0, removes: watcher.removals.get(record.index) || 0,
        innerWrites: watcher.innerWrites.get(record.index) || 0,
        sourceTextIdentityIntact: record.textNodes.every(node => node.isConnected && record.node.contains(node)),
        sourceValuesIntact: record.textNodes.map(node => node.data).join('') === record.originalText,
        protectedIntact: record.protectedNodes.every(({node, html}) => node.isConnected && record.node.contains(node) && node.outerHTML === html),
        restoredExact: record.node.innerHTML === record.originalHtml}))});
    window.__githubDocumentStability = watcher;
    return records.map(record => ({index: record.index, source: record.originalText, html: record.originalHtml}));
  }, {live, wrapper});
}

async function inspectTranslationPointerTargets(label) {
  const requestsBefore = await worker.evaluate(() => globalThis.__githubDocumentRequests.length);
  const copied = '[data-github-stability-check="0"] > .fluent-read-bilingual-content';
  assert.ok(await page.locator(`${copied} code`).count() > 0, 'copied code missing before pointer check');
  assert.ok(await page.locator(`${copied} a`).count() > 0, 'copied link missing before pointer check');
  const targets = page.locator(`${copied} code, ${copied} a`);
  const evidence = [];
  for (let index = 0; index < Math.min(await targets.count(), 16); index += 1) {
    const target = targets.nth(index);
    await target.scrollIntoViewIfNeeded();
    const before = await target.evaluate(node => node.outerHTML);
    const tag = await target.evaluate(node => node.localName);
    const rect = await target.boundingBox();
    if (!rect) continue;
    await page.mouse.move(rect.x + Math.min(8, rect.width / 2), rect.y + rect.height / 2);
    await page.waitForTimeout(100);
    evidence.push({index, tag, before, after: await target.evaluate(node => node.outerHTML).catch(() => 'detached')});
  }
  assert.ok(evidence.some(target => target.tag === 'code'), 'pointer did not visit visible copied code');
  assert.ok(evidence.some(target => target.tag === 'a'), 'pointer did not visit visible copied link');
  report.pointerInteractions ??= [];
  await page.mouse.move(1, 1);
  const requestsAfter = await worker.evaluate(() => globalThis.__githubDocumentRequests.length);
  report.pointerInteractions.push({label, targets: evidence, requestsBefore, requestsAfter});
  if (fullMode === 'all') assert.equal(requestsAfter, requestsBefore, 'pure copied-code/link pointer movement dispatched extra provider requests');
}

async function verifyViewportRoundTrip() {
  const geometry = () => page.evaluate(() => ({scrollY, viewportHeight: innerHeight,
    owners: window.__githubDocumentStability.records.map(record => {
      const rect = record.node.getBoundingClientRect();
      return {index: record.index, top: rect.top, bottom: rect.bottom, height: rect.height};
    })}));
  const geometryBefore = await geometry();
  const before = await page.evaluate(() => window.__githubDocumentStability.snapshot());
  const requestsBefore = await worker.evaluate(() => globalThis.__githubDocumentRequests.length);
  await page.evaluate(() => window.__githubDocumentStability.reset());
  await page.evaluate(() => scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'}));
  await page.waitForTimeout(1500);
  const geometryAway = await geometry();
  assert.ok(geometryAway.owners.every(owner => owner.bottom < -600 || owner.top > geometryAway.viewportHeight + 600),
    `selected owners did not leave viewport plus 600px prefetch band: ${JSON.stringify(geometryAway)}`);
  await page.locator('[data-github-stability-check="0"]').scrollIntoViewIfNeeded();
  await waitCounts(1);
  await observe('full-scroll-away-return');
  const after = await page.evaluate(() => window.__githubDocumentStability.snapshot());
  assert.deepEqual(after.owners.map(owner => owner.wrapperIds), before.owners.map(owner => owner.wrapperIds),
    'scroll-away/return replaced completed wrappers');
  const requestsAfter = await worker.evaluate(() => globalThis.__githubDocumentRequests.length);
  if (fullMode === 'all') assert.equal(requestsAfter, requestsBefore, 'pure all-mode scroll-away/return dispatched extra provider requests');
  report.viewportRoundTrip = {prefetchMarginPx: 600, geometryBefore, geometryAway, geometryAfter: await geometry(), requestsBefore, requestsAfter,
    requestAssertion: fullMode === 'all' ? 'unchanged across roundtrip' : 'not asserted; viewport may discover new source paragraphs', wrapperIdentityPreserved: true};
}

async function verifyResizeStability(label, hover = false) {
  const before = await page.evaluate(() => window.__githubDocumentStability.snapshot());
  await page.evaluate(() => window.__githubDocumentStability.reset());
  const deadlineMs = Math.max(30000, durationMs + 15000);
  let watchdog;
  const expired = new Promise((_, reject) => {
    watchdog = setTimeout(() => {
      report.resizeWatchdog = {label, expired: true, deadlineMs};
      report.ok = false;
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
      // 旧版观察器的微任务循环会让页面命令无法返回；看门狗在 Node 侧运行，
      // 通过既有所有权守卫关闭本次浏览器，使异常也有明确的失败与清理结果。
      void session.close().catch(error => {report.cleanupError = error.message;});
      reject(new Error(`${label}: viewport resize exceeded ${deadlineMs}ms`));
    }, deadlineMs);
  });
  try {
    await Promise.race([expired, (async () => {
      await page.setViewportSize({width: 1000, height: 816});
      await page.waitForTimeout(200);
      await page.setViewportSize({width: 1280, height: 816});
      await observe(label, hover);
      const after = await page.evaluate(() => window.__githubDocumentStability.snapshot());
      assert.deepEqual(after.owners.map(owner => owner.wrapperIds), before.owners.map(owner => owner.wrapperIds),
        `${label}: viewport resize replaced completed wrappers`);
      assert.notEqual(report.resizeWatchdog?.expired, true, `${label}: renderer did not settle before deadline`);
    })()]);
  } finally {clearTimeout(watchdog);}
}

async function waitCounts(count, hover = false) {
  await page.waitForFunction(({count, hover}) => {
    const state = window.__githubDocumentStability.snapshot();
    return state.owners.every(owner => owner.count === (hover && owner.index !== 0 ? 0 : count));
  }, {count, hover}, {timeout: 45000});
}

async function observe(label, hover = false) {
  process.stderr.write(`[github-document-stability] ${label}: observing for ${durationMs}ms\n`);
  await page.waitForTimeout(durationMs);
  const snapshot = await page.evaluate(() => window.__githubDocumentStability.snapshot());
  const requests = await worker.evaluate(() => globalThis.__githubDocumentRequests);
  const evidence = {label, durationMs, ...snapshot, requestCount: requests.length};
  report.cases.push(evidence);
  fs.writeFileSync(path.join(output, `${label}-mutations.json`), JSON.stringify(evidence, null, 2));
  fs.writeFileSync(path.join(output, `${label}.html`), await page.content());
  await page.screenshot({path: path.join(output, `${label}.png`), fullPage: false, caret: 'initial'});
  const selected = snapshot.owners.filter(owner => !hover || owner.index === 0);
  for (const guard of snapshot.guards) {
    assert.equal(guard.intact, true, `${label}/${guard.id}: protected fixture HTML changed`);
    assert.equal(guard.translationCount, 0, `${label}/${guard.id}: protected fixture translated`);
  }
  for (const owner of snapshot.owners) {
    assert.equal(owner.sourceTextIdentityIntact, true, `${label}/${owner.index}: source Text identities lost`);
    assert.equal(owner.sourceValuesIntact, true, `${label}/${owner.index}: source changed`);
    assert.equal(owner.protectedIntact, true, `${label}/${owner.index}: code/link changed`);
  }
  const removed = selected.reduce((count, owner) => count + owner.removes, 0);
  const innerWrites = selected.reduce((count, owner) => count + owner.innerWrites, 0);
  if (expectRegression && label === 'full-first') {
    assert.ok(removed > 0 || innerWrites >= 3, '旧包未复现预期的译文移除或内部重写回归'); report.regressionObserved = true;
    return;
  }
  assert.equal(removed, 0, `${label}: completed translation was removed ${removed} times`);
  assert.equal(innerWrites, 0, `${label}: completed translation contents were rewritten ${innerWrites} times`);
  selected.forEach(owner => {
    assert.equal(owner.count, 1, `${label}/${owner.index}: one translation expected`);
    assert.match(owner.translation, /[\u3400-\u9fff]/u, `${label}/${owner.index}: translated text missing`);
  });
}

(async () => {
  let primaryError;
  try {
    report.buildFreshness = expectRegression || published ? {skipped: 'Explicit external bundle verification; current checkout source freshness does not apply'}
      : assertFreshProductionExtension(extensionDir, root);
    report.extensionVersion = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8')).version;
    report.contentSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir, 'content-scripts/content.js'))).digest('hex');
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true, headless: false,
      viewport: {width: 1280, height: 900}, displayTarget: 'secondary',
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    Object.assign(report, {profileMode: 'new-temporary-profile', launchMode: session.launchMode,
      focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement, browserVersion: await session.context.browser().version()});
    const installWorker = async target => target.evaluate(() => {
      globalThis.__githubDocumentRequests = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
        if (url.hostname !== 'edge.microsoft.com' || url.pathname !== '/translate/translatetext') throw new Error(`External worker fetch disabled: ${url.origin}`);
        const texts = JSON.parse(init?.body ?? await input.text());
        globalThis.__githubDocumentRequests.push(texts);
        return new Response(JSON.stringify(texts.map(text => ({translations: [{text: `测试译文：${text}`}]}))),
          {status: 200, headers: {'content-type': 'application/json'}});
      };
    });
    session.context.on('serviceworker', target => {void installWorker(target).catch(error => report.consoleErrors.push(error.message));});
    worker = session.context.serviceWorkers()[0] || await session.context.waitForEvent('serviceworker');
    await installWorker(worker);
    if (!live) await session.context.route('**/*', async route => {
      if (route.request().url() === url && route.request().isNavigationRequest()) return route.fulfill({status: 200, contentType: 'text/html',
        body: fs.readFileSync(path.join(root, 'tests/fixtures/translation-pages/github-document-stability.html'), 'utf8')});
      const address = new URL(route.request().url());
      return ['https:','http:'].includes(address.protocol) ? route.abort('blockedbyclient') : route.continue();
    });
    const popup = await helper.newPageWithoutForeground(session.context);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await popup.waitForTimeout(1000);
    await patchConfig(popup, {service: 'microsoft', from: 'en', to: 'zh-Hans', display: 1, autoTranslate: false, hotkey: 'Control',
      mouseHoverTranslationDelay: 0, fullPageTranslationMode: fullMode, useCache: false, enableAIContext: false, enableAIMultiSegment: false,
      uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, siteAdaptation: {enabled: true, disabledRuleIds: [], custom: {version: 1, rules: []}}});
    page = await helper.newPageWithoutForeground(session.context);
    page.on('pageerror', error => report.consoleErrors.push(error.stack || error.message));
    const navigation = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000});
    report.navigationStatus = navigation?.status(); report.pageTitle = await page.title();
    if (live && report.navigationStatus >= 400) throw new Error(`GitHub returned HTTP ${report.navigationStatus}: ${report.pageTitle}`);
    await page.locator('#fluent-read-page-styles').waitFor({state: 'attached', timeout: 30000});
    await page.locator('.markdown-body p').first().waitFor({state: 'visible', timeout: 30000});
    report.initialOwners = await prepareOwners();
    await page.locator('[data-github-stability-check="0"]').scrollIntoViewIfNeeded();
    await page.screenshot({path: path.join(output, 'source.png'), fullPage: false});
    await fullToggle();
    if (expectRegression) await page.waitForFunction(() => window.__githubDocumentStability.adds.size > 0, null, {timeout: 45000});
    else await waitCounts(1);
    await observe('full-first');
    if (!expectRegression) {
      await verifyResizeStability('full-resize');
      await page.evaluate(() => window.__githubDocumentStability.reset());
      await inspectTranslationPointerTargets('full-copied-code-link-pointer');
      await observe('full-copied-code-link-pointer');
      await verifyViewportRoundTrip();
      await fullToggle(); await waitCounts(0);
      const restored = await page.evaluate(() => window.__githubDocumentStability.snapshot());
      restored.owners.forEach(owner => assert.equal(owner.restoredExact, true, `restore/${owner.index}: original DOM differs`));
      report.cases.push({label: 'full-restore', ...restored});
      await page.evaluate(() => window.__githubDocumentStability.reset());
      await fullToggle(); await waitCounts(1); await observe('full-retranslate');
      await fullToggle(); await waitCounts(0);
      await page.evaluate(() => window.__githubDocumentStability.reset());
      await hoverToggle(); await waitCounts(1, true); await observe('hover-first', true);
      await verifyResizeStability('hover-resize', true);
      await hoverToggle(); await waitCounts(0, true);
      await page.evaluate(() => window.__githubDocumentStability.reset());
      await hoverToggle(); await waitCounts(1, true); await observe('hover-retranslate', true);
      await hoverToggle(); await waitCounts(0, true);
      const final = await page.evaluate(() => window.__githubDocumentStability.snapshot());
      final.owners.forEach(owner => assert.equal(owner.restoredExact, true, `final-restore/${owner.index}: original DOM differs`));
      assert.equal(page.url(), url, 'URL changed during shortcuts');
      assert.equal(await page.locator(`${wrapper} ${wrapper}`).count(), 0, 'nested bilingual wrappers');
      final.guards.forEach(guard => assert.equal(guard.intact, true, `final-restore/${guard.id}: protected fixture differs`));
      report.finalRestoreExact = true;
    }
    report.requests = await worker.evaluate(() => globalThis.__githubDocumentRequests);
    assert.deepEqual(report.consoleErrors, [], 'page or worker error recorded during regression');
    report.ok = true;
  } catch (error) {
    primaryError = error; report.error = error.stack || String(error);
    if (page && !page.isClosed() && !report.resizeWatchdog?.expired) {
      report.failureSnapshot = await page.evaluate(() => window.__githubDocumentStability?.snapshot()).catch(() => null);
      await page.screenshot({path: path.join(output, 'failure.png'), fullPage: false}).catch(() => {});
      const html = await page.content().catch(() => null);
      if (html) fs.writeFileSync(path.join(output, 'failure.html'), html);
    }
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    if (session) {
      await session.close().then(() => {report.cleanupConfirmed = true;}).catch(error => {
        report.cleanupError = error.message; report.ok = false; report.retainedProfile = profileDir; primaryError ||= error;
      });
    } else {report.retainedProfile = profileDir; report.ok = false;}
    if (session && !report.cleanupError) {
      try {fs.rmSync(profileDir, {recursive: true, force: true}); report.profileRemoved = true;}
      catch (error) {report.cleanupError = error.message; report.ok = false; report.retainedProfile = profileDir; primaryError ||= error;}
    }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  if (primaryError) throw primaryError;
  process.stdout.write(JSON.stringify({ok: report.ok, regressionObserved: report.regressionObserved || false, output,
    cases: report.cases.map(item => ({label: item.label, mutationCount: item.mutationCount,
      wrappers: item.owners.map(owner => ({owner: owner.index, adds: owner.adds, removes: owner.removes, count: owner.count}))}))}) + '\n');
})().catch(error => {process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;});

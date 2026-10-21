#!/usr/bin/env node
/**
 * @file scripts/testing/run-man7-translation-test.cjs
 * 文件职责：在临时后台 Edge 中验证真实 man7 core(5) 的预格式化正文翻译和完整恢复。
 * 主要内容：支持旧包漏译复现、受控微软响应及显式在线供应商；通过真实 Control 和 Alt+T 覆盖逐段悬浮、全文、恢复和再次翻译，校验参数说明、shell/C 保护、原文链接身份、事件及 HTML 恢复。
 * 模块边界：只使用扩展公开配置消息与宿主 DOM，不调用翻译内部函数，不替换真实网页，不连接用户 profile；受控供应商结果不证明在线服务质量。
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');

const root = path.resolve(__dirname, '../..');
const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const args = {
  extensionDir: path.resolve(argument('extension-dir', path.join(root, '.output/chrome-mv3'))),
  artifactsDir: path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-man7-translation')),
  playwrightRoot: argument('playwright-root', ''),
  focusSafeHelper: path.resolve(argument('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))),
  expectBaseline: process.argv.includes('--expect-baseline'),
  online: process.argv.includes('--online'),
  service: argument('service', 'freeTranslation'),
  timeout: Number(argument('timeout', process.argv.includes('--online') ? '180000' : '60000')),
  baselineObserveMs: Number(argument('baseline-observe-ms', '3000')),
};
assert.ok(args.playwrightRoot, '需要 --playwright-root');
assert.ok(!process.argv.includes('--headed') && !process.argv.includes('--headless'), '本专项仅允许第二屏后台隔离 Edge');
assert.ok(Number.isFinite(args.timeout) && args.timeout >= 1000 && args.timeout <= 300000, 'timeout 必须为 1000–300000');
assert.ok(Number.isFinite(args.baselineObserveMs) && args.baselineObserveMs >= 1000 && args.baselineObserveMs <= 30000, 'baseline-observe-ms 必须为 1000–30000');
const {chromium} = require(path.join(path.resolve(args.playwrightRoot), 'playwright'));
const helper = require(args.focusSafeHelper);
const url = 'https://man7.org/linux/man-pages/man5/core.5.html';
const wrapper = '.fluent-read-bilingual-content';
const paragraph = '[data-fr-manpage-paragraph="true"]';
const report = {
  ok: false, url, expectBaseline: args.expectBaseline,
  provider: args.online ? `${args.service}-online` : 'microsoft-controlled-local-response',
  source: 'live-man7-core5-html', profileMode: 'new-temporary-profile',
  limitations: args.online ? ['Online provider results apply only to this run and selected page.']
    : ['Controlled responses prove candidate, rendering and restoration behavior; they do not prove online provider quality or latency.'],
  phases: [], pageErrors: [], workerErrors: [],
};
const targets = [
  {name: 'description-opening', section: 'DESCRIPTION', needle: 'The default action of certain signals'},
  {name: 'description-list', section: 'DESCRIPTION', needle: 'The process does not have permission'},
  {name: 'description-systemd', section: 'DESCRIPTION', needle: 'On systems that employ'},
  {name: 'description-parameter-c', section: 'DESCRIPTION', needle: 'Core file size soft resource limit'},
  {name: 'description-parameter-u', section: 'DESCRIPTION', needle: 'Numeric real UID of dumped process'},
  {name: 'description-late', section: 'DESCRIPTION', needle: 'It is also possible to temporarily'},
  {name: 'notes-opening', section: 'NOTES', needle: 'command can be used to obtain a core dump'},
  {name: 'notes-late', section: 'NOTES', needle: 'In Linux versions up to and including'},
  {name: 'examples-prose', section: 'EXAMPLES', needle: 'The program below can be used to demonstrate'},
];
fs.mkdirSync(args.artifactsDir, {recursive: true});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-man7-'));
report.profileDir = profileDir;
const save = () => fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
const progress = message => {process.stderr.write(`[man7] ${message}\n`); save();};
let session, page, popup, worker, sequence = 0;
const workers = new Set();
const workerInstalls = new WeakMap();

async function patchConfig(updates) {
  const result = await popup.evaluate(async ({updates, sequence}) => {
    const stored = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!stored.success) throw new Error(stored.error);
    const current = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value;
    return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: updates,
      expected: Object.fromEntries(Object.keys(updates).map(key => [key, current[key]])),
      clientId: 'man7-translation-regression', sequence, baseRevision: current.__fluentConfigRevision});
  }, {updates, sequence: ++sequence});
  assert.equal(result.success, true, JSON.stringify(result));
}

async function installWorker(target) {
  if (workerInstalls.has(target)) return workerInstalls.get(target);
  workers.add(target);
  const pending = target.evaluate(({online}) => {
    globalThis.__man7ProviderRequests = [];
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
      const address = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      if (online) {
        // 只记录端点，不记录凭据、查询参数、请求头或在线翻译原文。
        globalThis.__man7ProviderRequests.push({origin: address.origin, pathname: address.pathname});
        return original(input, init);
      }
      if (address.hostname !== 'edge.microsoft.com' || address.pathname !== '/translate/translatetext') {
        throw new Error(`Controlled provider rejected unexpected fetch: ${address.origin}${address.pathname}`);
      }
      const texts = JSON.parse(init?.body ?? await input.text());
      globalThis.__man7ProviderRequests.push(...texts);
      return new Response(JSON.stringify(texts.map(text => ({translations: [{text: `测试译文：${text}`}]}))),
        {status: 200, headers: {'content-type': 'application/json'}});
    };
  }, {online: args.online});
  workerInstalls.set(target, pending);
  return pending;
}

async function prepareSource() {
  return page.evaluate(({targets, wrapper, paragraph}) => {
    const normalize = value => String(value || '').replace(/\s+/gu, ' ').trim();
    const records = [...document.querySelectorAll('body > h2 + pre')].map(node => {
      const section = node.previousElementSibling.querySelector('a[id]')?.id;
      return {node, section, html: node.innerHTML, text: node.textContent,
        children: [...node.childNodes], textNodes: (() => {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), result = [];
          let text; while ((text = walker.nextNode())) result.push({node: text, value: text.data});
          return result;
        })(), links: [...node.querySelectorAll('a[href]')].map(node => ({node, html: node.outerHTML, href: node.href}))};
    });
    for (const section of ['DESCRIPTION', 'NOTES', 'EXAMPLES']) {
      if (records.filter(record => record.section === section).length !== 1) throw new Error(`Missing unique ${section} PRE`);
    }
    for (const target of targets) {
      const record = records.find(record => record.section === target.section);
      if (!normalize(record.text).includes(target.needle)) throw new Error(`Live page changed: ${target.name}`);
    }
    const description = records.find(record => record.section === 'DESCRIPTION');
    const examples = records.find(record => record.section === 'EXAMPLES');
    const guards = [
      {name: 'shell-command', section: 'DESCRIPTION', needle: 'cat /proc/sys/kernel/core_pattern'},
      {name: 'shell-output', section: 'DESCRIPTION', needle: '|/usr/lib/systemd/systemd-coredump %P %u %g %s %t %c %e'},
      {name: 'example-shell', section: 'EXAMPLES', needle: 'cc -o core_pattern_pipe_test core_pattern_pipe_test.c'},
      {name: 'C-source', section: 'EXAMPLES', needle: '#define _GNU_SOURCE'},
      {name: 'C-source-loop', section: 'EXAMPLES', needle: 'while ((nread = read(STDIN_FILENO, buf, BUF_SIZE)) > 0)'},
    ];
    guards.forEach(guard => {
      const record = records.find(record => record.section === guard.section);
      if (!normalize(record.text).includes(guard.needle)) throw new Error(`Live guard changed: ${guard.name}`);
    });
    const linked = description.links[0];
    if (!linked) throw new Error('Missing source link for identity/event checks');
    let linkEvents = 0;
    linked.node.addEventListener('click', event => {event.preventDefault(); linkEvents += 1;});
    const sourceHtml = node => {
      const clone = node.cloneNode(true);
      clone.querySelectorAll(`${wrapper},.fluent-read-loading,.fluent-read-retry-wrapper,[data-fr-translation-owned="true"]`).forEach(node => node.remove());
      clone.querySelectorAll(`${paragraph},[data-fr-manpage-literal="true"],[data-fr-translation-segment="true"]`).forEach(node => node.replaceWith(...node.childNodes));
      return clone.innerHTML;
    };
    const sourceText = node => {
      const clone = node.cloneNode(true);
      clone.querySelectorAll(`${wrapper},.fluent-read-loading,.fluent-read-retry-wrapper,[data-fr-translation-owned="true"]`).forEach(node => node.remove());
      return normalize(clone.textContent);
    };
    const state = {
      records, guards, linked, sourceHtml, sourceText,
      eventCheck() {
        const before = linkEvents;
        linked.node.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
        return {delivered: linkEvents === before + 1, count: linkEvents,
          sameOriginalLink: linked.node.isConnected && description.node.contains(linked.node)};
      },
      snapshot() {
        return {
          url: location.href,
          globalWrapperCount: document.querySelectorAll(wrapper).length,
          preWrapperCount: records.reduce((count, record) => count + record.node.querySelectorAll(wrapper).length, 0),
          loadingCount: document.querySelectorAll('.fluent-read-loading').length,
          retryCount: document.querySelectorAll('.fluent-read-retry-wrapper').length,
          paragraphs: records.flatMap(record => [...record.node.querySelectorAll(paragraph)].filter(node => !node.closest(wrapper))
            .map(node => ({section: record.section, source: sourceText(node), wrappers: [...node.children].filter(child => child.matches(wrapper)).length,
              chinese: [...node.children].filter(child => child.matches(wrapper)).every(child => /[\u3400-\u9fff]/u.test(child.textContent || '')),
              translation: [...node.children].filter(child => child.matches(wrapper)).map(child => child.textContent).join('\n')}))),
          targets: targets.map(target => {
            const record = records.find(record => record.section === target.section);
            const owners = [...record.node.querySelectorAll(paragraph)].filter(node => !node.closest(wrapper) && sourceText(node).includes(target.needle));
            const wrappers = owners.flatMap(node => [...node.children].filter(child => child.matches(wrapper)));
            return {...target, owners: owners.length, wrappers: wrappers.length,
              chinese: wrappers.length === 1 && /[\u3400-\u9fff]/u.test(wrappers[0].textContent || ''),
              translation: wrappers.map(node => node.textContent).join('\n')};
          }),
          guards: guards.map(guard => {
            const record = records.find(record => record.section === guard.section);
            const literalOwners = [...record.node.querySelectorAll('[data-fr-manpage-literal="true"]')]
              .filter(node => normalize(node.textContent).includes(guard.needle));
            const leaked = [...record.node.querySelectorAll(paragraph)].some(node => sourceText(node).includes(guard.needle));
            return {...guard, sourcePresent: normalize(record.node.textContent).includes(guard.needle),
              protected: literalOwners.length === 1 && literalOwners[0].getAttribute('translate') === 'no',
              wrappers: literalOwners.reduce((sum, node) => sum + node.querySelectorAll(wrapper).length, 0), leaked};
          }),
          source: records.map(record => ({section: record.section, sourceHtmlExact: sourceHtml(record.node) === record.html,
            restoredHtmlExact: record.node.innerHTML === record.html,
            originalChildIdentity: [...record.node.childNodes].length === record.children.length && record.children.every((node, index) => record.node.childNodes[index] === node),
            originalTextIdentity: record.textNodes.every(({node, value}) => node.isConnected && record.node.contains(node) && node.data === value),
            linksIntact: record.links.every(({node, html, href}) => node.isConnected && record.node.contains(node) && node.outerHTML === html && node.href === href)})),
          nested: document.querySelectorAll(`${wrapper} ${wrapper}`).length,
          duplicateParents: [...document.querySelectorAll(wrapper)].filter(node => [...node.parentElement.children].filter(child => child.matches(wrapper)).length > 1).length,
          normalizationMarkers: document.querySelectorAll(`${paragraph},[data-fr-manpage-literal="true"]`).length,
        };
      },
    };
    window.__man7Regression = state;
    return {sections: records.map(({section, html, text, links}) => ({section, html, text, linkCount: links.length})),
      targetCount: targets.length, event: state.eventCheck(), descriptionLength: description.text.length, examplesLength: examples.text.length};
  }, {targets, wrapper, paragraph});
}

async function snapshot(label) {
  const value = await page.evaluate(() => window.__man7Regression.snapshot());
  report.phases.push({label, ...value});
  save();
  return value;
}

function assertSafe(value, {restored = false, literal = false} = {}) {
  assert.equal(value.url, url, 'Page URL changed');
  assert.equal(value.nested, 0, 'Nested translation wrappers');
  assert.equal(value.duplicateParents, 0, 'Duplicate sibling translation wrappers');
  value.source.forEach(record => {
    assert.equal(record.sourceHtmlExact, true, `${record.section}: normalized source HTML differs`);
    assert.equal(record.linksIntact, true, `${record.section}: source link identity/markup differs`);
    if (restored) {
      assert.equal(record.restoredHtmlExact, true, `${record.section}: original HTML was not fully restored`);
      assert.equal(record.originalChildIdentity, true, `${record.section}: original children were not restored`);
      assert.equal(record.originalTextIdentity, true, `${record.section}: original Text identity/value was not restored`);
    }
  });
  value.guards.forEach(guard => {
    assert.equal(guard.sourcePresent, true, `${guard.name}: original literal missing`);
    assert.equal(guard.leaked, false, `${guard.name}: literal entered a prose owner`);
    assert.equal(guard.wrappers, 0, `${guard.name}: literal translated`);
    if (literal) assert.equal(guard.protected, true, `${guard.name}: literal lacks protected owner`);
  });
  if (restored) assert.equal(value.normalizationMarkers, 0, 'Normalization markers remained after restoration');
}

async function checkEvent(label) {
  const event = await page.evaluate(() => window.__man7Regression.eventCheck());
  assert.equal(event.delivered, true, `${label}: original link listener was lost`);
  assert.equal(event.sameOriginalLink, true, `${label}: original link detached`);
  report.linkEvents ??= [];
  report.linkEvents.push({label, ...event, method: 'DOM click on original anchor; listener prevents navigation'});
}

async function hoverToggle() {
  await helper.activateExtensionTabWithoutForeground(session.context, page);
  const position = await page.evaluate(({paragraph, wrapper}) => {
    const pre = window.__man7Regression.records.find(record => record.section === 'DESCRIPTION').node;
    const owner = [...pre.querySelectorAll(paragraph)].find(node => window.__man7Regression.sourceText(node).includes('The default action of certain signals')) || pre;
    const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
      const index = text.data.indexOf('The default action of certain signals');
      if (index < 0 || text.parentElement.closest(`a,${wrapper},[data-fr-translation-owned="true"]`)) continue;
      const range = document.createRange(); range.setStart(text, index); range.setEnd(text, index + 15);
      const initial = [...range.getClientRects()].find(rect => rect.width > 5 && rect.height > 5);
      if (initial) scrollBy({top: initial.top - innerHeight / 2, behavior: 'instant'});
      const rect = [...range.getClientRects()].find(rect => rect.width > 5 && rect.height > 5 && rect.top >= 0 && rect.bottom <= innerHeight);
      if (rect) return {x: rect.left + Math.min(10, rect.width / 2), y: rect.top + rect.height / 2};
    }
    throw new Error('Cannot find visible ordinary source text for Control gesture');
  }, {paragraph, wrapper});
  await page.mouse.move(position.x, position.y);
  await page.mouse.click(position.x, position.y);
  await page.keyboard.down('Control'); await page.keyboard.up('Control');
}

async function fullToggle() {
  await helper.activateExtensionTabWithoutForeground(session.context, page);
  await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
}

async function waitForHover(expected) {
  await page.waitForFunction(({expected}) => {
    const state = window.__man7Regression.snapshot();
    if (!expected) return state.preWrapperCount === 0;
    const target = state.targets.find(target => target.name === 'description-opening');
    return state.preWrapperCount === 1 && target?.wrappers === 1 && target.chinese;
  }, {expected}, {timeout: args.timeout});
}

async function waitForFull() {
  await page.waitForFunction(() => {
    const state = window.__man7Regression.snapshot();
    return state.targets.every(target => target.owners === 1 && target.wrappers === 1 && target.chinese)
      && state.paragraphs.length >= 20 && state.paragraphs.every(owner => owner.wrappers === 1 && owner.chinese);
  }, null, {timeout: args.timeout});
}

async function waitForRestored() {
  await page.waitForFunction(() => {
    const state = window.__man7Regression.snapshot();
    return state.preWrapperCount === 0 && state.normalizationMarkers === 0
      && state.source.every(record => record.restoredHtmlExact && record.originalChildIdentity && record.originalTextIdentity);
  }, null, {timeout: args.timeout});
}

async function main() {
  let primaryError;
  try {
    report.buildFreshness = args.expectBaseline ? {skipped: 'Explicit baseline bundle reproduction; checkout freshness does not apply'}
      : assertFreshProductionExtension(args.extensionDir, root);
    report.extensionVersion = JSON.parse(fs.readFileSync(path.join(args.extensionDir, 'manifest.json'), 'utf8')).version;
    report.contentSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(args.extensionDir, 'content-scripts/content.js'))).digest('hex');
    progress(`launch ${args.expectBaseline ? 'baseline' : 'candidate'} / ${report.provider}`);
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true, headless: false,
      viewport: {width: 1280, height: 950}, displayTarget: 'secondary',
      browserArgs: [`--disable-extensions-except=${args.extensionDir}`, `--load-extension=${args.extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy,
      windowPlacement: session.windowPlacement, browserVersion: await session.context.browser().version()});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    session.context.on('serviceworker', target => {void installWorker(target).catch(error => report.workerErrors.push(error.message));});
    worker = session.context.serviceWorkers()[0] || await session.context.waitForEvent('serviceworker', {timeout: args.timeout});
    await installWorker(worker);
    popup = await helper.newPageWithoutForeground(session.context);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await popup.waitForTimeout(600);
    report.config = {on: true, service: args.online ? args.service : 'microsoft', from: 'en', to: 'zh-Hans', display: 1,
      autoTranslate: false, translationScope: 'content', hotkey: 'Control', floatingBallHotkey: 'Alt+T',
      fullPageTranslationMode: 'all', mouseHoverTranslationDelay: 0, useCache: false,
      enableAIContext: false, enableAIMultiSegment: false, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true,
      siteAdaptation: {enabled: true, disabledRuleIds: [], custom: {version: 1, rules: []}}};
    await patchConfig(report.config);
    page = await helper.newPageWithoutForeground(session.context);
    page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
    const response = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: args.timeout});
    report.navigationStatus = response?.status(); report.pageTitle = await page.title();
    assert.equal(response?.ok(), true, `Live man7 returned HTTP ${response?.status()}`);
    await page.locator('#fluent-read-page-styles').waitFor({state: 'attached', timeout: args.timeout});
    report.initial = await prepareSource();
    assert.equal(report.initial.event.delivered, true);
    await page.screenshot({path: path.join(args.artifactsDir, 'source.png')});
    progress('live source ready; hover cycle');
    if (args.expectBaseline) {
      await hoverToggle(); await page.waitForTimeout(args.baselineObserveMs);
      const hover = await snapshot('baseline-hover-missing');
      assertSafe(hover, {restored: true});
      assert.equal(hover.preWrapperCount, 0, 'Baseline no longer reproduces PRE omission');
      await fullToggle();
      await page.waitForFunction(() => document.querySelector('h1 .fluent-read-bilingual-content'), null, {timeout: args.timeout});
      await page.waitForTimeout(args.baselineObserveMs);
      const full = await snapshot('baseline-full-missing');
      assertSafe(full, {restored: true});
      assert.equal(full.preWrapperCount, 0, 'Baseline PRE gained translations');
      assert.ok(full.globalWrapperCount > 0, 'Full shortcut produced no translation evidence');
      await page.screenshot({path: path.join(args.artifactsDir, 'baseline-full-missing.png')});
      await fullToggle(); await waitForRestored();
      const restored = await snapshot('baseline-restored');
      assertSafe(restored, {restored: true});
      await checkEvent('baseline-restored');
      report.baselineOmissionObserved = true;
      report.finalRestoreExact = true;
    } else {
      report.hoverCounts = [];
      for (const expected of [1, 0, 1]) {
        await hoverToggle(); await waitForHover(expected);
        const state = await snapshot(`hover-${report.hoverCounts.length + 1}`);
        assertSafe(state, {literal: expected === 1});
        assert.equal(state.preWrapperCount, expected, 'Hover affected adjacent paragraphs');
        report.hoverCounts.push(state.preWrapperCount);
        if (expected) await checkEvent(`hover-${report.hoverCounts.length}`);
      }
      await page.screenshot({path: path.join(args.artifactsDir, 'hover-translated.png')});
      await hoverToggle(); await waitForHover(0);
      // 全文恢复同时释放 PRE 规范化；悬浮切换可保留其它尚未翻译的已发现段落。
      progress('hover [1,0,1] passed; full translate / restore / translate');
      for (let pass = 1; pass <= 2; pass += 1) {
        await fullToggle(); await waitForFull();
        const translated = await snapshot(`full-${pass}`);
        assertSafe(translated, {literal: true});
        await checkEvent(`full-${pass}`);
        await page.locator(`body > h2:has(> a#${pass === 1 ? 'DESCRIPTION' : 'EXAMPLES'}) + pre ${paragraph}`).first().scrollIntoViewIfNeeded();
        await page.screenshot({path: path.join(args.artifactsDir, `full-${pass}.png`)});
        await fullToggle(); await waitForRestored();
        const restored = await snapshot(`restore-${pass}`);
        assertSafe(restored, {restored: true});
        await checkEvent(`restore-${pass}`);
        progress(`full pass ${pass} and exact restore passed`);
      }
      report.finalRestoreExact = true;
    }
    report.requests = [];
    for (const target of workers) report.requests.push(...await target.evaluate(() => globalThis.__man7ProviderRequests || []).catch(() => []));
    assert.ok(report.requests.length > 0, 'No provider requests were observed');
    assert.deepEqual(report.pageErrors, [], 'Page runtime errors occurred');
    assert.deepEqual(report.workerErrors, [], 'Worker setup errors occurred');
    report.ok = true;
  } catch (error) {
    primaryError = error; report.error = error.stack || String(error);
    if (page && !page.isClosed()) {
      report.failureSnapshot = await page.evaluate(() => window.__man7Regression?.snapshot()).catch(() => null);
      await page.screenshot({path: path.join(args.artifactsDir, 'failure.png')}).catch(() => {});
      const html = await page.content().catch(() => null);
      if (html) fs.writeFileSync(path.join(args.artifactsDir, 'failure.html'), html);
    }
  } finally {
    report.requests = [];
    for (const target of workers) report.requests.push(...await target.evaluate(() => globalThis.__man7ProviderRequests || []).catch(() => []));
    save();
    if (session) {
      await session.close().then(() => {report.cleanupConfirmed = true;}).catch(error => {
        report.cleanupError = error.message; report.ok = false; report.retainedProfile = profileDir; primaryError ||= error;
      });
      if (!report.cleanupError) {
        try {fs.rmSync(profileDir, {recursive: true, force: true}); report.profileRemoved = true;}
        catch (error) {report.cleanupError = error.message; report.ok = false; report.retainedProfile = profileDir; primaryError ||= error;}
      }
    } else {report.retainedProfile = profileDir; report.ok = false;}
    save();
  }
  if (primaryError) throw primaryError;
  process.stdout.write(JSON.stringify({ok: report.ok, artifactsDir: args.artifactsDir, provider: report.provider,
    baselineOmissionObserved: report.baselineOmissionObserved || false, hoverCounts: report.hoverCounts,
    finalRestoreExact: report.finalRestoreExact || false, phaseCount: report.phases.length}) + '\n');
}

main().catch(error => {process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;});

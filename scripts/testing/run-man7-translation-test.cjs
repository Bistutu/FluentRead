#!/usr/bin/env node
/**
 * @file scripts/testing/run-man7-translation-test.cjs
 * 文件职责：在临时后台 Edge 中验证真实 man7 core(5) 的预格式化正文翻译和完整恢复。
 * 主要内容：支持旧包漏译复现、受控微软响应及显式在线供应商；通过真实 Control 和 Alt+T 覆盖逐段悬浮、全文、恢复和再次翻译，校验段落、列表、参数与小标题的首行及悬挂缩进、原文正文栏左右边界和按栏宽自然换行、shell/C 保护、原文链接身份、事件及 HTML 恢复，并采集内容脚本、popup 和后台 Runtime 诊断。
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
  runtimeDiagnosticsHelper: path.resolve(argument('runtime-diagnostics-helper', path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills/fluentread-browser-translation-test/scripts/runtime-diagnostics.cjs'))),
  translationBeforeOriginal: process.argv.includes('--translation-before-original'),
  expectMisalignment: process.argv.includes('--expect-misalignment'),
  expectWideTranslation: process.argv.includes('--expect-wide-translation'),
  expectBaseline: process.argv.includes('--expect-baseline'),
  online: process.argv.includes('--online'),
  service: argument('service', 'freeTranslation'),
  style: Number(argument('style', '1')),
  viewportWidth: Number(argument('viewport-width', '1280')),
  viewportHeight: Number(argument('viewport-height', '950')),
  timeout: Number(argument('timeout', process.argv.includes('--online') ? '180000' : '60000')),
  baselineObserveMs: Number(argument('baseline-observe-ms', '3000')),
};
assert.ok(args.playwrightRoot, '需要 --playwright-root');
assert.ok(Number.isSafeInteger(args.style) && args.style >= 0, 'style 必须是非负整数');
assert.ok(Number.isSafeInteger(args.viewportWidth) && args.viewportWidth >= 320 && args.viewportWidth <= 3840, 'viewport-width 必须为 320–3840');
assert.ok(Number.isSafeInteger(args.viewportHeight) && args.viewportHeight >= 400 && args.viewportHeight <= 2160, 'viewport-height 必须为 400–2160');
assert.ok([args.expectBaseline, args.expectMisalignment, args.expectWideTranslation].filter(Boolean).length <= 1, '旧包复现模式一次只能选择一种');
assert.ok(!process.argv.includes('--headed') && !process.argv.includes('--headless'), '本专项仅允许第二屏后台隔离 Edge');
assert.ok(Number.isFinite(args.timeout) && args.timeout >= 1000 && args.timeout <= 300000, 'timeout 必须为 1000–300000');
assert.ok(Number.isFinite(args.baselineObserveMs) && args.baselineObserveMs >= 1000 && args.baselineObserveMs <= 30000, 'baseline-observe-ms 必须为 1000–30000');
const {chromium} = require(path.join(path.resolve(args.playwrightRoot), 'playwright'));
const helper = require(args.focusSafeHelper);
const {createRuntimeDiagnostics, finalizeRun} = require(args.runtimeDiagnosticsHelper);
const diagnostics = createRuntimeDiagnostics();
const rawDiagnosticsSnapshot = diagnostics.snapshot;
// 默认 favicon 是浏览器对当前站点发起的附属请求；只归属这条精确 404，原证据另存。
diagnostics.snapshot = () => {
  const raw = rawDiagnosticsSnapshot();
  const entries = raw.entries.map(entry => entry.type === 'browser-log' && entry.browserSource === 'network'
    && entry.targetType === 'page' && entry.surface === 'translation-page' && entry.targetUrl === url
    && entry.sourceUrl === 'https://man7.org/favicon.ico'
    && entry.message === 'Failed to load resource: the server responded with a status of 404 (Not Found)'
    && entry.stack.length === 0
    ? {...entry, originalOwnership: entry.ownership, ownership: 'site', attribution: 'Exact default favicon 404 from the observed man7 page browser network log; raw diagnostic retained.'}
    : entry);
  const blockers = entries.filter(entry => !entry.expectedCase && ['fluentread', 'unattributed'].includes(entry.ownership));
  return {...raw, entries, rawEvidenceFile: 'runtime-diagnostics-raw.json', blockerIds: blockers.map(entry => entry.id), counts: {
    errors: blockers.filter(entry => entry.level === 'error').length,
    warnings: blockers.filter(entry => entry.level === 'warning').length,
    expected: entries.filter(entry => entry.expectedCase).length,
    site: entries.filter(entry => entry.ownership === 'site').length,
  }, passed: blockers.length === 0 && raw.coverage.failures.length === 0 && raw.workerObserved};
};
diagnostics.assertClean = () => {
  const current = diagnostics.snapshot();
  assert.equal(current.passed, true, `Runtime diagnostics failed: ${JSON.stringify(current.counts)}; see runtime-diagnostics.json`);
};
diagnostics.write = (artifactsDir, result) => {
  result.runtimeDiagnostics = diagnostics.snapshot();
  result.errors = result.runtimeDiagnostics.entries.filter(entry => result.runtimeDiagnostics.blockerIds.includes(entry.id) && entry.level === 'error');
  result.runtimeWarnings = result.runtimeDiagnostics.entries.filter(entry => result.runtimeDiagnostics.blockerIds.includes(entry.id) && entry.level === 'warning');
  fs.writeFileSync(path.join(artifactsDir, 'runtime-diagnostics-raw.json'), JSON.stringify(rawDiagnosticsSnapshot(), null, 2));
  fs.writeFileSync(path.join(artifactsDir, 'runtime-diagnostics.json'), JSON.stringify(result.runtimeDiagnostics, null, 2));
  save();
};
const unboundedDiagnosticsFlush = diagnostics.flush;
const unboundedDiagnosticsStop = diagnostics.stop;
diagnostics.flush = () => bounded(unboundedDiagnosticsFlush, 7000, 'diagnostics-flush');
diagnostics.stop = () => bounded(unboundedDiagnosticsStop, 7000, 'diagnostics-stop');
const url = 'https://man7.org/linux/man-pages/man5/core.5.html';
const wrapper = '.fluent-read-bilingual-content';
const paragraph = '[data-fr-manpage-paragraph="true"]';
const report = {
  ok: false, url, expectBaseline: args.expectBaseline, expectMisalignment: args.expectMisalignment, expectWideTranslation: args.expectWideTranslation,
  requestedViewport: {width: args.viewportWidth, height: args.viewportHeight},
  provider: args.online ? `${args.service}-online` : 'microsoft-controlled-local-response',
  source: 'live-man7-core5-html', profileMode: 'new-temporary-profile',
  limitations: args.online ? ['Online provider results apply only to this run and selected page.']
    : ['Controlled responses prove candidate, rendering and restoration behavior; they do not prove online provider quality or latency.'],
  phases: [], pageErrors: [], workerErrors: [],
};
const targets = [
  {name: 'description-opening', section: 'DESCRIPTION', needle: 'The default action of certain signals'},
  {name: 'description-list', section: 'DESCRIPTION', needle: 'The process does not have permission'},
  {name: 'description-heading', section: 'DESCRIPTION', needle: 'Naming of core dump files'},
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
const save = () => {
  const value = JSON.stringify(report, null, 2);
  fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), value);
  fs.writeFileSync(path.join(args.artifactsDir, 'result.json'), value);
};
const progress = message => {process.stderr.write(`[man7] ${message}\n`); save();};
let session, page, popup, worker, sequence = 0;
const workers = new Set();
const workerInstalls = new WeakMap();

async function bounded(action, milliseconds, stage) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${stage} timed out after ${milliseconds}ms`)), milliseconds);
    })]);
  } finally {clearTimeout(timer);}
}

function stage(label) {report.stage = label; save();}

async function collectProviderRequests(label) {
  const requests = [];
  for (const target of workers) {
    try {requests.push(...await bounded(() => target.evaluate(() => globalThis.__man7ProviderRequests || []), 3000, `${label}-worker-requests`));}
    catch (error) {
      report.requestCollectionErrors ??= [];
      report.requestCollectionErrors.push({stage: label, message: error.message});
    }
  }
  return requests;
}

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
      // wire 输入是 provider 转义后的纯文本。回显英文只加中文前缀会触发真实的错语种守卫，
      // 因此返回足够长度的中文正文；实体字面值及槽协议标记仍按原身份与数量保留。
      const decode = value => value.replace(/&#(?:0*39);|&#x0*27;/gi, "'").replace(/&quot;/gi, '"')
        .replace(/&gt;/gi, '>').replace(/&lt;/gi, '<').replace(/&amp;/gi, '&');
      const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const chinese = source => {
        if (!source.trim()) return source;
        const entities = source.match(/&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/gu) || [];
        const phrase = '这是用于检查手册译文排版的中文说明，进程终止时会保存相关状态，正文应当保留缩进并根据可用宽度自然换行。';
        const length = Math.max(16, Math.min(2000, Math.ceil(source.length * 0.55)));
        return phrase.repeat(Math.ceil(length / phrase.length)).slice(0, length) + (entities.length ? ` 保留字面文本：${entities.join(' ')}` : '');
      };
      const translated = text => escape(decode(text).split(/(___FLUENTREAD_[a-z0-9_-]+_(?:0|[1-9]\d*)_(?:BEGIN|END)___)/giu)
        .map(part => /^___FLUENTREAD_[a-z0-9_-]+_(?:0|[1-9]\d*)_(?:BEGIN|END)___$/iu.test(part) ? part : chinese(part)).join(''));
      return new Response(JSON.stringify(texts.map(text => ({translations: [{text: translated(text)}]}))),
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

/** 每一行都按实际字符 Range 测量，不能用含前导空格的 wrapper 左边缘冒充原文起点。 */
async function checkAlignment(label, {full = false, recordOnly = false} = {}) {
  const selected = full ? ['description-opening', 'description-list', 'description-parameter-c', 'description-heading'] : ['description-opening'];
  report.alignment ??= [];
  for (const name of selected) {
    const target = targets.find(target => target.name === name);
    const owner = page.locator(`body > h2:has(> a#${target.section}) + pre ${paragraph}`)
      .filter({hasText: target.needle}).first();
    await owner.scrollIntoViewIfNeeded();
    const geometry = await owner.evaluate((owner, {wrapper, paragraph, name, beforeOriginal}) => {
      const content = [...owner.children].find(node => node.matches(wrapper));
      if (!content) throw new Error(`${name}: missing translation`);
      const sourceNodes = [];
      const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT);
      let node, offset = 0, source = '';
      while ((node = walker.nextNode())) {
        if (node.parentElement.closest(`${wrapper},[data-fr-translation-owned="true"],.fluent-read-loading,.fluent-read-retry-wrapper`)) continue;
        sourceNodes.push({node, start: offset, end: offset + node.data.length});
        source += node.data; offset += node.data.length;
      }
      const at = index => {
        const part = sourceNodes.find(part => index >= part.start && index < part.end);
        if (!part) throw new Error(`${name}: source offset missing`);
        const range = document.createRange(); range.setStart(part.node, index - part.start); range.setEnd(part.node, index - part.start + 1);
        const rect = range.getBoundingClientRect();
        return {left: rect.left, top: rect.top, bottom: rect.bottom};
      };
      const sourceLines = [];
      for (const match of source.matchAll(/[^\n]*(?:\n|$)/gu)) {
        const index = match[0].search(/\S/u);
        if (index >= 0) sourceLines.push(at(match.index + index));
      }
      if (!sourceLines.length) throw new Error(`${name}: missing visible source`);
      const textLines = element => {
        const lines = [];
        const textWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let text, count = 0;
        while ((text = textWalker.nextNode())) {
          for (const match of text.data.matchAll(/\S/gu)) {
            if (++count > 12000) throw new Error(`${name}: geometry text budget exceeded`);
            const range = document.createRange(); range.setStart(text, match.index); range.setEnd(text, match.index + match[0].length);
            const rect = range.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            // 跨字体的字形矩形顶部可能略有不同，以垂直重叠确定同一排版行。
            const line = lines.find(line => Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top) > Math.min(line.bottom - line.top, rect.height) / 2);
            if (line) {line.left = Math.min(line.left, rect.left); line.right = Math.max(line.right, rect.right);}
            else lines.push({left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom});
          }
        }
        return lines.sort((a, b) => a.top - b.top);
      };
      // 正文栏取整个同 PRE 的 prose 来源行，不能拿单个短段落或 PRE 的整页块宽替代。
      const pre = owner.closest('pre');
      const columnLineRights = [];
      let measuredSourceNodes = 0;
      for (const prose of pre.querySelectorAll(paragraph)) {
        if (prose.closest(`${wrapper},[data-fr-translation-owned="true"],[data-fr-manpage-literal="true"]`)) continue;
        const sourceWalker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
        let sourceNode;
        while ((sourceNode = sourceWalker.nextNode())) {
          if (++measuredSourceNodes > 12000) throw new Error(`${name}: source column node budget exceeded`);
          if (sourceNode.parentElement.closest(`${wrapper},[data-fr-translation-owned="true"],[data-fr-manpage-literal="true"],.fluent-read-loading,.fluent-read-retry-wrapper`)) continue;
          for (const physicalLine of sourceNode.data.matchAll(/[^\n]+/gu)) {
            const first = physicalLine[0].search(/\S/u);
            if (first < 0) continue;
            const end = physicalLine[0].trimEnd().length;
            const range = document.createRange();
            range.setStart(sourceNode, physicalLine.index + first); range.setEnd(sourceNode, physicalLine.index + end);
            for (const rect of range.getClientRects()) {
              if (rect.width > 0 && rect.height > 0 && Number.isFinite(rect.right)) columnLineRights.push(rect.right);
            }
          }
        }
      }
      if (!columnLineRights.length) throw new Error(`${name}: no measured prose column right boundary`);
      const sourceColumnRight = Math.max(...columnLineRights);
      const preStyle = getComputedStyle(pre);
      const preAvailableRight = pre.getBoundingClientRect().right - (Number.parseFloat(preStyle.borderRightWidth) || 0) - (Number.parseFloat(preStyle.paddingRight) || 0);
      const style = getComputedStyle(content);
      const originalLines = textLines(content);
      const translationGlyphRight = Math.max(...originalLines.map(line => line.right));
      const translationBlockRight = content.getBoundingClientRect().right;
      const firstExpected = sourceLines[0].left;
      const continuationExpected = (sourceLines[1] || sourceLines[0]).left;
      const result = {name, sourceLines, firstExpected, continuationExpected, lines: originalLines,
        sourceColumnRight, preAvailableRight, sourceColumnMeasuredRanges: columnLineRights.length, translationGlyphRight, translationBlockRight,
        glyphRightOverflow: translationGlyphRight - sourceColumnRight, blockRightOverflow: translationBlockRight - sourceColumnRight,
        glyphPreRightOverflow: translationGlyphRight - preAvailableRight, blockPreRightOverflow: translationBlockRight - preAvailableRight,
        translatedHanCount: (content.textContent.match(/[\u3400-\u9fff]/gu) || []).length, viewportWidth: innerWidth,
        whiteSpace: style.whiteSpace, hardBreakElements: content.querySelectorAll('br').length,
        beforeOriginal, translationComesFirst: originalLines[0]?.top < sourceLines[0].top,
        firstDelta: originalLines.length ? originalLines[0].left - firstExpected : null,
        continuationDeltas: originalLines.slice(1).map(line => line.left - continuationExpected)};
      if (name === 'description-opening') {
        const previousStyle = content.getAttribute('style');
        // 只在同一同步任务中改变并还原自有工件宽度，MutationObserver 不会看到持久变化。
        try {
          const available = content.getBoundingClientRect().width;
          const wideWidth = Math.min(560, available);
          const narrowWidth = Math.min(280, wideWidth / 2);
          content.style.setProperty('max-width', 'none', 'important');
          content.style.setProperty('width', `${wideWidth}px`, 'important');
          const wideLines = textLines(content).length;
          content.style.setProperty('width', `${narrowWidth}px`, 'important');
          const narrowLines = textLines(content).length;
          result.reflow = {wideWidth, narrowWidth, wideLines, narrowLines};
        } finally {
          if (previousStyle === null) content.removeAttribute('style'); else content.setAttribute('style', previousStyle);
        }
      }
      return result;
    }, {wrapper, paragraph, name, beforeOriginal: args.translationBeforeOriginal});
    report.alignment.push({label, ...geometry}); save();
    assert.ok(geometry.lines.length > 0, `${name}: translation has no visible text`);
    if (recordOnly) continue;
    assert.equal(geometry.whiteSpace, 'normal', `${name}: translation inherited PRE hard line breaks`);
    assert.equal(geometry.hardBreakElements, 0, `${name}: source hard line breaks leaked into translation`);
    assert.ok(Math.abs(geometry.firstDelta) <= 2, `${name}: first line shifted ${geometry.firstDelta}px`);
    geometry.continuationDeltas.forEach((delta, index) => assert.ok(Math.abs(delta) <= 2, `${name}: continuation line ${index + 2} shifted ${delta}px`));
    assert.ok(geometry.glyphRightOverflow <= 2, `${name}: translated glyphs exceed source column right by ${geometry.glyphRightOverflow}px`);
    assert.ok(geometry.blockRightOverflow <= 2, `${name}: translation block exceeds source column right by ${geometry.blockRightOverflow}px`);
    assert.ok(geometry.glyphPreRightOverflow <= 2, `${name}: translated glyphs exceed available PRE right by ${geometry.glyphPreRightOverflow}px`);
    assert.ok(geometry.blockPreRightOverflow <= 2, `${name}: translation block exceeds available PRE right by ${geometry.blockPreRightOverflow}px`);
    if (name === 'description-opening' && geometry.translatedHanCount >= 64) assert.ok(geometry.lines.length > 1, `${name}: long Chinese prose did not wrap inside its source column`);
    assert.equal(geometry.translationComesFirst, args.translationBeforeOriginal, `${name}: translation order differs from configuration`);
    if (geometry.reflow) {
      assert.ok(geometry.reflow.wideWidth > geometry.reflow.narrowWidth, `${name}: no measurable reflow width`);
      assert.ok(geometry.reflow.narrowLines > geometry.reflow.wideLines, `${name}: translation did not reflow with container width`);
    }
  }
}

async function hoverToggle() {
  stage('activate-translation-tab');
  await bounded(() => helper.activateExtensionTabWithoutForeground(session.context, page), 12000, 'activate-translation-tab');
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
  stage('activate-translation-tab');
  await bounded(() => helper.activateExtensionTabWithoutForeground(session.context, page), 12000, 'activate-translation-tab');
  stage('full-toggle-keyboard');
  await bounded(async () => {await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');}, 7000, 'full-toggle-keyboard');
  stage('wait-for-full-result');
}

async function waitForHover(expected) {
  await page.waitForFunction(({expected}) => {
    if (document.querySelector('.fluent-read-retry-wrapper')) throw new Error('Translation entered retry; see failureErrorReasons in report.json');
    const state = window.__man7Regression.snapshot();
    if (!expected) return state.preWrapperCount === 0;
    const target = state.targets.find(target => target.name === 'description-opening');
    return state.preWrapperCount === 1 && target?.wrappers === 1 && target.chinese;
  }, {expected}, {timeout: args.timeout, polling: 250});
}

async function waitForFull() {
  await page.waitForFunction(() => {
    if (document.querySelector('.fluent-read-retry-wrapper')) throw new Error('Translation entered retry; see failureErrorReasons in report.json');
    const state = window.__man7Regression.snapshot();
    return state.targets.every(target => target.owners === 1 && target.wrappers === 1 && target.chinese)
      && state.paragraphs.length >= 20 && state.paragraphs.every(owner => owner.wrappers === 1 && owner.chinese);
  }, null, {timeout: args.timeout, polling: 250});
}

async function waitForRestored() {
  await page.waitForFunction(() => {
    const state = window.__man7Regression.snapshot();
    return state.preWrapperCount === 0 && state.normalizationMarkers === 0
      && state.source.every(record => record.restoredHtmlExact && record.originalChildIdentity && record.originalTextIdentity);
  }, null, {timeout: args.timeout, polling: 250});
}

async function main() {
  let primaryError;
  try {
    report.buildFreshness = args.expectBaseline || args.expectMisalignment || args.expectWideTranslation ? {skipped: 'Explicit baseline bundle reproduction; checkout freshness does not apply'}
      : assertFreshProductionExtension(args.extensionDir, root);
    report.extensionVersion = JSON.parse(fs.readFileSync(path.join(args.extensionDir, 'manifest.json'), 'utf8')).version;
    report.contentSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(args.extensionDir, 'content-scripts/content.js'))).digest('hex');
    progress(`launch ${args.expectBaseline || args.expectMisalignment || args.expectWideTranslation ? 'baseline' : 'candidate'} / ${report.provider}`);
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true, headless: false,
      viewport: {width: args.viewportWidth, height: args.viewportHeight}, displayTarget: 'secondary',
      browserArgs: [`--disable-extensions-except=${args.extensionDir}`, `--load-extension=${args.extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    await diagnostics.start(session.context);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy,
      windowPlacement: session.windowPlacement, browserVersion: await session.context.browser().version()});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    session.context.on('serviceworker', target => {void installWorker(target).catch(error => report.workerErrors.push(error.message));});
    worker = session.context.serviceWorkers()[0] || await session.context.waitForEvent('serviceworker', {timeout: args.timeout});
    diagnostics.setExtensionId(new URL(worker.url()).host);
    await installWorker(worker);
    popup = await helper.newPageWithoutForeground(session.context);
    await diagnostics.attachPage(popup, 'config-popup');
    diagnostics.setPhase('configuration-load');
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await popup.waitForTimeout(600);
    report.config = {on: true, service: args.online ? args.service : 'microsoft', from: 'en', to: 'zh-Hans', display: 1,
      autoTranslate: false, translationScope: 'content', hotkey: 'Control', floatingBallHotkey: 'Alt+T',
      style: args.style, translationBeforeOriginal: args.translationBeforeOriginal, longParagraphLineBreakEnabled: false,
      fullPageTranslationMode: 'all', mouseHoverTranslationDelay: 0, useCache: false,
      enableAIContext: false, enableAIMultiSegment: false, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true,
      siteAdaptation: {enabled: true, disabledRuleIds: [], custom: {version: 1, rules: []}}};
    await patchConfig(report.config);
    page = await helper.newPageWithoutForeground(session.context);
    await diagnostics.attachPage(page, 'translation-page');
    diagnostics.setPhase('page-load');
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
    } else if (args.expectMisalignment || args.expectWideTranslation) {
      const label = args.expectWideTranslation ? 'baseline-full-wide-translation' : 'baseline-full-misalignment';
      diagnostics.setPhase(label);
      await fullToggle(); await waitForFull();
      const translated = await snapshot(label);
      assertSafe(translated, {literal: true});
      await checkAlignment(label, {full: true, recordOnly: true});
      if (args.expectWideTranslation) {
        const opening = report.alignment.find(item => item.label === label && item.name === 'description-opening');
        report.wideTranslationObserved = Boolean(opening && opening.glyphRightOverflow > 2);
        assert.equal(report.wideTranslationObserved, true, 'Baseline no longer reproduces opening translation glyphs beyond the source column right');
      } else {
        report.misalignmentObserved = report.alignment.some(item => Math.abs(item.firstDelta) > 2 || item.continuationDeltas.some(delta => Math.abs(delta) > 2));
        assert.equal(report.misalignmentObserved, true, 'Baseline no longer reproduces visible line misalignment');
      }
      await page.locator(`body > h2:has(> a#DESCRIPTION) + pre ${paragraph}`).first().scrollIntoViewIfNeeded();
      await page.screenshot({path: path.join(args.artifactsDir, `${label}.png`)});
      diagnostics.setPhase('baseline-restoration');
      await fullToggle(); await waitForRestored();
      assertSafe(await snapshot('baseline-restored'), {restored: true});
      report.finalRestoreExact = true;
    } else {
      report.hoverCounts = [];
      for (const expected of [1, 0, 1]) {
        diagnostics.setPhase(`hover-${report.hoverCounts.length + 1}`);
        await hoverToggle(); await waitForHover(expected);
        const state = await snapshot(`hover-${report.hoverCounts.length + 1}`);
        assertSafe(state, {literal: expected === 1});
        assert.equal(state.preWrapperCount, expected, 'Hover affected adjacent paragraphs');
        report.hoverCounts.push(state.preWrapperCount);
        if (expected) {
          await checkEvent(`hover-${report.hoverCounts.length}`);
          await checkAlignment(`hover-${report.hoverCounts.length}`);
        }
      }
      await page.screenshot({path: path.join(args.artifactsDir, 'hover-translated.png')});
      diagnostics.setPhase('hover-restoration');
      await hoverToggle(); await waitForHover(0);
      // 全文恢复同时释放 PRE 规范化；悬浮切换可保留其它尚未翻译的已发现段落。
      progress('hover [1,0,1] passed; full translate / restore / translate');
      for (let pass = 1; pass <= 2; pass += 1) {
        diagnostics.setPhase(`full-${pass}`);
        await fullToggle(); await waitForFull();
        const translated = await snapshot(`full-${pass}`);
        assertSafe(translated, {literal: true});
        await checkEvent(`full-${pass}`);
        await checkAlignment(`full-${pass}`, {full: true});
        await page.locator(`body > h2:has(> a#${pass === 1 ? 'DESCRIPTION' : 'EXAMPLES'}) + pre ${paragraph}`).first().scrollIntoViewIfNeeded();
        await page.screenshot({path: path.join(args.artifactsDir, `full-${pass}.png`)});
        diagnostics.setPhase(`restore-${pass}`);
        await fullToggle(); await waitForRestored();
        const restored = await snapshot(`restore-${pass}`);
        assertSafe(restored, {restored: true});
        await checkEvent(`restore-${pass}`);
        progress(`full pass ${pass} and exact restore passed`);
      }
      report.finalRestoreExact = true;
    }
    report.requests = await collectProviderRequests('assertion');
    assert.ok(report.requests.length > 0, 'No provider requests were observed');
    assert.deepEqual(report.pageErrors, [], 'Page runtime errors occurred');
    assert.deepEqual(report.workerErrors, [], 'Worker setup errors occurred');
    assert.deepEqual(report.requestCollectionErrors || [], [], 'Worker request evidence collection failed');
    diagnostics.setPhase('page-unload');
    stage('page-unload');
    await page.goto('about:blank', {waitUntil: 'load', timeout: 10000});
    report.pageUnloaded = page.url() === 'about:blank';
    await diagnostics.flush();
    diagnostics.assertClean();
    report.ok = true;
  } catch (error) {
    primaryError = error; report.error = error.stack || String(error);
    stage('failure-evidence');
    report.evidenceFailures ??= [];
    if (page && !page.isClosed()) {
      for (const [name, action] of [
        ['failure-reason', async () => {
          report.failureErrorReasons = await page.evaluate(() => {
            const details = [];
            for (const reason of [...document.querySelectorAll('.fluent-read-reason')].slice(0, 8)) {
              reason.click();
              const shadow = document.querySelector('#fluent-read-page-notice-host')?.shadowRoot;
              const notices = [...(shadow?.querySelectorAll('.notice-detail') || [])].map(node => node.textContent);
              details.push({control: reason.textContent, notices});
            }
            return details;
          });
        }],
        ['failure-snapshot', async () => {report.failureSnapshot = await page.evaluate(() => window.__man7Regression?.snapshot());}],
        ['failure-screenshot', () => page.screenshot({path: path.join(args.artifactsDir, 'failure.png'), timeout: 4000})],
        ['failure-html', async () => {fs.writeFileSync(path.join(args.artifactsDir, 'failure.html'), await page.content());}],
      ]) {
        try {await bounded(action, 5000, name);}
        catch (failure) {report.evidenceFailures.push({stage: name, message: failure.message});}
        save();
      }
    }
  } finally {
    stage('collect-final-provider-requests');
    const finalRequests = await collectProviderRequests('finalization');
    if (finalRequests.length) report.requests = finalRequests;
    if (report.requestCollectionErrors?.length) report.ok = false;
    stage('finalization');
    await finalizeRun({diagnostics, result: report, artifactsDir: args.artifactsDir, primaryError,
      cleanup: [
        {stage: 'browser-close', action: async () => {
          if (!session) {report.retainedProfile = profileDir; report.ok = false; return;}
          try {await bounded(() => session.close(), 15000, 'owned-browser-close'); report.cleanupConfirmed = true;}
          catch (error) {report.cleanupError = error.message; report.retainedProfile = profileDir; throw error;}
        }},
        {stage: 'profile-cleanup', action: () => {
          if (!report.cleanupConfirmed) return;
          try {fs.rmSync(profileDir, {recursive: true, force: true}); report.profileRemoved = true;}
          catch (error) {report.cleanupError = error.message; report.retainedProfile = profileDir; throw error;}
        }},
      ], emitReport: () => {report.stage = 'finished'; diagnostics.write(args.artifactsDir, report);},
    });
  }
  if (primaryError) throw primaryError;
  process.stdout.write(JSON.stringify({ok: report.ok, artifactsDir: args.artifactsDir, provider: report.provider,
    baselineOmissionObserved: report.baselineOmissionObserved || false, misalignmentObserved: report.misalignmentObserved || false, wideTranslationObserved: report.wideTranslationObserved || false, hoverCounts: report.hoverCounts,
    finalRestoreExact: report.finalRestoreExact || false, phaseCount: report.phases.length}) + '\n');
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;
  // 仅结束本次测试 Node，未取得关闭收据的浏览器与 profile 留给调用方核验回收。
  setTimeout(() => process.exit(1), 1500).unref();
});

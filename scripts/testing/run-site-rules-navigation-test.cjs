#!/usr/bin/env node
'use strict';
/**
 * @file scripts/testing/run-site-rules-navigation-test.cjs
 * 文件职责：以生产扩展和隔离 Edge 验证站点规则在连续链接、SPA 和短生命周期 Popup 中的真实行为。
 * 主要内容：本地跨站/延迟正文夹具、真实配置与内容消息、确定性翻译 HTTP 服务、DOM 与请求断言、后台焦点事件和截图证据。
 * 模块边界：不替换产品模块或翻译调度器；仅控制普通扩展测试页的 active-tab 查询，翻译传输使用合成配置和本地固定响应，不代表 live-provider、原生工具栏或 Firefox 验收。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const arg = (name, fallback) => {const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-site-navigation'));
const baselineOnly = process.argv.includes('--baseline-only');
const productHuntOnly = process.argv.includes('--producthunt-only');
const productHuntHomeControl = process.argv.includes('--producthunt-home-control');
const disableInflightOnly = process.argv.includes('--disable-inflight-only');
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground,
  startFocusEventMonitor, queryMacFrontmostApplication} = require('./focus-safe-browser.cjs');
const service = 'custom:site-navigation-fixture';
const timeout = 30000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const profileDir = fs.mkdtempSync('/private/tmp/fluentread-site-navigation-');
const requests = [];
const report = {ok: false, artifact: 'production', extensionDir, sourceSha: arg('source-sha', null), baselineOnly, productHuntOnly, productHuntHomeControl, disableInflightOnly,
  scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  resourcePolicy: {concurrency: Number(process.env.FLUENTREAD_TEST_CONCURRENCY) || null, maxWorkers: Number(process.env.FLUENTREAD_TEST_MAX_WORKERS) || null,
    lockHeld: process.env.FLUENTREAD_RESOURCE_LOCK_HELD === '1', slot: process.env.FLUENTREAD_RESOURCE_LOCK_SLOT || null, cpuExclusive: false, browserCpuTimingCompared: false},
  fixtureNetwork: {firstHost: '127.0.0.1', secondHost: 'localhost', hostResolverRules: null, proxyPolicy: 'browser default; standard localhost loopback bypass', bindAddress: '127.0.0.1'}, navigationRequests: [],
  cases: [], assertions: [], persistenceCases: [], quickClose: false, latestWriteWins: false, crossPageSync: false,
  screenshots: [], consoleErrors: [], runtimeMessages: [], focusEvents: [], cleanupErrors: [],
  failedRequests: [], httpErrors: [],
  evidenceBoundary: 'Real production MV3 extension in isolated Edge. Content lifecycle, configuration persistence and translation DOM use production code. Translation transport is a local deterministic custom OpenAI provider; active-tab lookup is controlled only because the normal extension test tab occupies a tab. No native-toolbar, live-provider, Firefox, BFCache or arbitrary-site coverage claim.'};
let port, launched, context, control, content, popup, origin, monitor, browserPid, currentCase = 'launch';
let focusViolation, closePromise, slowResponseGate;
fs.mkdirSync(artifactsDir, {recursive: true});
const source = route => `Reading page ${route} should feel calm and effortless. Colors and lines should follow the article you are reading.`;
function fixture(route) {
  const encoded = JSON.stringify(route);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Site navigation fixture</title><style>body{margin:48px;font:18px/1.8 system-ui;background:#fff;color:#263044}article{max-width:820px;padding:22px;border:1px solid #dde3eb}nav{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px}button,a{font:inherit}h1{font-size:28px}</style></head><body><h1 translate="no">Site rules navigation fixture</h1><nav translate="no"><a id="same" href="/document/next">Same site link</a><a id="cross" href="http://localhost:${port}/document/cross">Other site link</a><a id="backsite" href="http://127.0.0.1:${port}/document/returned">Return to ruled site</a><a id="push" href="/spa/pushed">SPA push link</a><a id="adapter" href="/adapted/article">Path-specific adapter link</a><button id="replace">SPA replace</button><a id="hash" href="#section">Same page anchor</a><button id="hashrouter">HashRouter article</button><button id="hashbang">Hashbang article</button><button id="delayed">Delayed article</button><button id="quick">Quick route changes</button><button id="slow">Slow translation</button><button id="slow-anchor">Slow request with anchor</button></nav><article id="article"></article><script>
    const source = route => ${source.toString().replace(/^route => /, '')};
    const article = document.getElementById('article');
    let generation = 0;
    function render(route, late = 0) {
      const own = ++generation;
      article.replaceChildren();
      const append = () => {if (own !== generation) return; const p = document.createElement('p'); p.id = 'primary'; p.dataset.route = route; p.textContent = source(route); article.append(p);};
      if (late) setTimeout(append, late); else append();
    }
    render(${encoded}, ${route.includes('initial-delayed') ? 650 : 0});
    document.getElementById('push').onclick = event => {event.preventDefault(); history.pushState({}, '', '/spa/pushed'); render('/spa/pushed');};
    document.getElementById('adapter').onclick = event => {event.preventDefault(); history.pushState({}, '', '/adapted/article'); render('/adapted/article');};
    document.getElementById('replace').onclick = () => {history.replaceState({}, '', '/spa/replaced'); render('/spa/replaced');};
    document.getElementById('delayed').onclick = () => {history.pushState({}, '', '/spa/delayed'); render('/spa/delayed', 800);};
    document.getElementById('slow-anchor').onclick = () => {history.pushState({}, '', '/spa/slow-anchor'); render('/spa/slow-anchor');};
    document.getElementById('slow').onclick = () => {history.pushState({}, '', '/spa/slow'); render('/spa/slow');};
    document.getElementById('quick').onclick = () => {
      history.pushState({}, '', '/spa/slow'); render('/spa/slow');
      setTimeout(() => {history.pushState({}, '', '/spa/intermediate'); render('/spa/intermediate');}, 20);
      setTimeout(() => {history.replaceState({}, '', '/spa/final'); render('/spa/final');}, 50);
    };
    document.getElementById('hashrouter').onclick = () => {location.hash = '/article/hash-router';};
    document.getElementById('hashbang').onclick = () => {location.hash = '!/article/hashbang';};
    const currentRoute = () => location.hash.startsWith('#/') || location.hash.startsWith('#!/') ? location.hash.replace(/^#!?/, '') : location.pathname;
    const syncHistory = () => {const route = currentRoute(); if (document.querySelector('#primary')?.dataset.route !== route) render(route);};
    addEventListener('popstate', syncHistory);
    addEventListener('hashchange', syncHistory);
  </script></body></html>`;
}
const server = http.createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', '*');
  if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
  if (request.method === 'POST') {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const prompt = body.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
    const text = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1] || '';
    const item = {source: text, model: body.model, at: Date.now(), aborted: false}; requests.push(item);
    response.on('close', () => {item.closedAt = Date.now(); if (!response.writableFinished) {item.aborted = true; item.abortedAt = item.closedAt;}});
    const gate = slowResponseGate && text === source('/spa/slow') ? slowResponseGate : null;
    if (gate) {
      gate.requests.push(item); gate.request ||= item; gate.arrivedAt ||= item.at; item.responseGate = 'disable-inflight';
      await gate.promise;
      item.gateReleasedAt = gate.releasedAt;
    } else {await delay(text.includes('/spa/slow') ? 900 : 100);}
    item.responseDecisionAt = Date.now();
    if (response.destroyed) {item.responseOutcome = 'aborted-before-send'; return;}
    response.setHeader('content-type', 'application/json');
    item.responseOutcome = 'sent'; item.responseSentAt = Date.now();
    response.end(JSON.stringify({id: 'site-navigation-fixture', object: 'chat.completion', created: 1, model: body.model,
      choices: [{index: 0, message: {role: 'assistant', content: `这篇文章阅读起来轻松自然。颜色和线条贴合当前页面。`}, finish_reason: 'stop'}]}));
    return;
  }
  response.setHeader('content-type', 'text/html; charset=utf-8');
  report.navigationRequests.push({url: request.url, host: request.headers.host, at: Date.now()});
  response.end(fixture(new URL(request.url, 'http://fixture').pathname));
});
async function until(test, label, duration = 12000) {
  const end = Date.now() + duration;
  while (Date.now() < end) {if (focusViolation) throw focusViolation; if (await test()) return; await delay(60);}
  throw new Error(`${label}: timeout`);
}
async function bounded(action, milliseconds, label) {
  let timer;
  return Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {timer = setTimeout(() => reject(new Error(`${label}: operation timeout`)), milliseconds);})]).finally(() => clearTimeout(timer));
}
function observe(page, surface) {
  page.on('pageerror', error => report.consoleErrors.push({surface, url: page.url(), message: error.message}));
  page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({surface, url: page.url(), message: message.text()});});
  page.on('requestfailed', request => report.failedRequests.push({surface, url: request.url(), resourceType: request.resourceType(), failure: request.failure()}));
  page.on('response', response => {if (response.status() >= 400) report.httpErrors.push({surface, url: response.url(), resourceType: response.request().resourceType(), status: response.status()});});
}
async function open(url, surface) {
  const page = await newPageWithoutForeground(context, timeout); observe(page, surface);
  await page.goto(url, {waitUntil: 'domcontentloaded'}); return page;
}
async function readConfig() {
  const result = await control.evaluate(() => chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}));
  assert(result?.success && result.value); return result.value;
}
async function patchConfig(values, initial = false) {
  const before = await readConfig();
  const result = await control.evaluate(({before, values, initial}) => chrome.runtime.sendMessage({type: 'persistConfig', mode: initial ? 'replace' : 'patch',
    config: initial ? {...before, ...values} : values, expected: Object.fromEntries(Object.keys(values).map(key => [key, before[key]])),
    baseRevision: initial ? before.__fluentConfigRevision || 0 : undefined, clientId: `site-navigation-${crypto.randomUUID()}`, sequence: 1}), {before, values, initial});
  assert.equal(result?.success, true, result?.error);
  report.lastSaveResponse = {success: result.success, revision: result.revision};
}
async function saved(key, expected) {await until(async () => JSON.stringify((await readConfig())[key]) === JSON.stringify(expected), `saved ${key}`);}
async function tabId() {return control.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, content.url());}
async function contentMessage(message) {return control.evaluate(({id, message}) => chrome.tabs.sendMessage(id, message), {id: await tabId(), message});}
async function ready() {await until(async () => {try {return (await contentMessage({type: 'getFullPageTranslationState'}))?.status === 'success';} catch {return false;}}, 'content ready');}
async function dom() {return content.evaluate(() => {
  const p = document.querySelector('#primary'), wrappers = [...document.querySelectorAll('.fluent-read-bilingual-content')];
  return {url: location.href, route: p?.dataset.route, original: p?.childNodes[0]?.textContent, count: p?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
    total: wrappers.length, text: p?.textContent, translations: wrappers.map(node => node.textContent), nested: document.querySelectorAll('.fluent-read-bilingual-content .fluent-read-bilingual-content').length};
});}
async function translated(label, duration) {
  await until(async () => {const state = await dom(); return state.count === 1 && state.total === 1 && state.nested === 0 && state.translations.every(text => /[\u4e00-\u9fff]/u.test(text));}, label, duration);
  const state = await dom(); assert.equal(state.original, source(state.route)); return state;
}
async function restored(label) {await until(async () => {const state = await dom(); return state.total === 0 && state.text === source(state.route);}, label);}
async function restore() {
  const response = await contentMessage({type: 'contextMenuTranslate', action: 'restore'});
  assert.equal(response?.status, 'success'); await restored('restore original DOM');
}
async function shot(page, name) {const file = path.join(artifactsDir, `${name}.png`); await page.screenshot({path: file}); report.screenshots.push(file);}
async function closePopup() {
  const id = await popup.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await control.evaluate(async id => {await chrome.tabs.update((await chrome.tabs.getCurrent()).id, {active: true}); await chrome.tabs.remove(id);}, id);
  popup = null;
}
async function openPopup() {
  await activateExtensionTabWithoutForeground(context, content);
  const fixtureTabId = await tabId(); assert(Number.isSafeInteger(fixtureTabId));
  popup = await newPageWithoutForeground(context, timeout); observe(popup, 'popup');
  await popup.setViewportSize({width: 400, height: 600});
  await popup.addInitScript(fixtureTabId => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (info, callback) => {
      if (!info.active) return typeof callback === 'function' ? query(info, callback) : query(info);
      const {active: ignored, ...rest} = info; const filter = tabs => tabs.filter(tab => tab.id === fixtureTabId);
      return typeof callback === 'function' ? query(rest, tabs => callback(filter(tabs))) : query(rest).then(filter);
    };
    window.__frMessages = [];
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (...args) => {
      const message = args[0]; if (message?.type === 'persistConfig') window.__frMessages.push({type: message.type, mode: message.mode, keys: Object.keys(message.config || {})});
      return send(...args);
    };
  }, fixtureTabId);
  await popup.goto(`${origin}/${report.manifest.popup}`, {waitUntil: 'domcontentloaded'});
  await activateExtensionTabWithoutForeground(context, popup);
  await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
  await popup.locator('[data-setting="disable-extension-site"]').waitFor();
  await until(async () => (await popup.locator('[data-setting="disable-extension-site"]').getAttribute('data-site-domain')) === new URL(content.url()).hostname, 'popup domain ready');
  return popup;
}
async function quickClick(selector) {
  const before = await readConfig(); await popup.locator(selector).click();
  report.runtimeMessages.push(...await popup.evaluate(() => window.__frMessages));
  await closePopup(); return before;
}
async function runCase(name, action) {
  currentCase = name; const start = performance.now(), before = requests.length;
  console.log(JSON.stringify({event: 'case-start', name, url: content?.url(), requests: before}));
  let timer;
  const value = await Promise.race([action(), new Promise((_, reject) => {timer = setTimeout(() => reject(new Error(`Case watchdog expired: ${name}`)), 25000);})]).finally(() => clearTimeout(timer));
  report.cases.push({name, passed: true, durationMs: Math.round(performance.now() - start), requests: requests.length - before, dom: value || await dom()});
  console.log(JSON.stringify({event: 'case-passed', name, durationMs: report.cases.at(-1).durationMs, requests: requests.length - before}));
}
async function runDisableInflightCase() {
  await runCase('disable interrupts slow translation and late reply never reinserts DOM', async () => {
    let release;
    const gate = slowResponseGate = {armedAt: Date.now(), requests: [], promise: new Promise(resolve => {release = resolve;})};
    report.inflightDisable = {provider: 'local deterministic response gate', armedAt: gate.armedAt, events: []};
    const evidence = report.inflightDisable;
    const event = name => evidence.events.push({name, at: Date.now()});
    const releaseGate = () => {if (!gate.releasedAt) {gate.releasedAt = Date.now(); event('provider-gate-released'); release();}};
    try {
      await content.locator('#slow').click();
      await until(() => Boolean(gate.request), 'current slow article reached the gated provider');
      evidence.request = gate.request; event('provider-request-arrived');
      assert.equal(gate.releasedAt, undefined); assert.equal(gate.request.responseSentAt, undefined); assert.equal(gate.request.aborted, false);
      await openPopup(); assert.equal(await popup.locator('[data-setting="disable-extension-site"]').isDisabled(), false);
      assert.equal(gate.request.responseSentAt, undefined, 'Response completed before real disable click');
      assert.equal(gate.request.aborted, false, 'Current request already aborted before real disable click');
      const disableStartedAt = Date.now();
      evidence.pendingBeforeDisable = {at: disableStartedAt, requestArrivedAt: gate.request.at, responseSent: false, aborted: false, gateReleased: false};
      event('disable-click-started');
      await quickClick('[data-setting="disable-extension-site"]'); event('popup-immediate-close-completed');
      await saved('disabledExtensionDomains', ['127.0.0.1']); event('persisted-state-acknowledged');
      const persisted = await readConfig();
      evidence.persistedState = {disabledExtensionDomains: persisted.disabledExtensionDomains, revision: persisted.__fluentConfigRevision};
      await restored('inflight disable original'); event('original-dom-restored');
      await until(() => gate.request.aborted, 'disable abort reached the provider before gate release'); event('provider-abort-observed');
      assert(gate.request.abortedAt >= disableStartedAt, 'Request aborted before disable began');
      assert.equal(gate.releasedAt, undefined); assert.equal(gate.request.responseSentAt, undefined);
      await openPopup();
      evidence.reopenedPopup = {enabled: await popup.locator('[data-setting="disable-extension-site"]').getAttribute('data-enabled'),
        busy: await popup.locator('[data-setting="disable-extension-site"]').getAttribute('aria-busy'),
        translationDisabled: await popup.locator('[data-testid="page-translation"]').isDisabled(),
        alwaysRuleDisabled: await popup.locator('[data-setting="always-translate-site"]').isDisabled()};
      assert.deepEqual(evidence.reopenedPopup, {enabled: 'true', busy: 'false', translationDisabled: true, alwaysRuleDisabled: true});
      event('reopened-popup-disabled-state-confirmed');
      await shot(popup, 'disable-inflight-gated-popup'); await closePopup();
      const disabledAt = requests.length; releaseGate();
      await until(() => Boolean(gate.request.responseOutcome), 'released provider response settled');
      assert.equal(gate.request.responseOutcome, 'aborted-before-send');
      await delay(1300); await restored('late released response remains original'); assert.equal(requests.length, disabledAt);
      assert.equal(gate.requests.length, 1, 'The gated current article must issue only one request');
      assert.equal((await contentMessage({type: 'contextMenuTranslate', action: 'fullPage'}))?.status, 'disabled');
      evidence.noReinsertionAfterRelease = true; evidence.newRequestsAfterDisable = requests.length - disabledAt;
      event('post-release-original-dom-confirmed');
      await shot(content, 'disable-inflight-late-reply'); return dom();
    } finally {releaseGate(); slowResponseGate = null;}
  });
}
async function productHunt() {
  const result = report.productHunt = {status: 'pending', requestedUrl: 'https://www.producthunt.com/products/reso', navigations: [], screenshots: [], transport: 'local deterministic custom OpenAI provider'};
  const errorStart = report.consoleErrors.length;
  const httpErrorStart = report.httpErrors.length, failedRequestStart = report.failedRequests.length;
  const clickObservedLink = async href => {
    const anchors = await content.locator('a[href]:visible').all();
    for (const anchor of anchors) {
      const value = await anchor.getAttribute('href');
      if (value && new URL(value, content.url()).href === href) {await anchor.click(); return;}
    }
    throw new Error('Observed real site link disappeared');
  };
  const evaluate = () => content.evaluate(() => ({url: location.href, title: document.title, heading: document.querySelector('h1')?.textContent,
    timeOrigin: performance.timeOrigin, text: document.body.innerText.slice(0, 600), count: document.querySelectorAll('.fluent-read-bilingual-content').length,
    nested: document.querySelectorAll('.fluent-read-bilingual-content .fluent-read-bilingual-content').length,
    pageText: document.body.innerText.slice(0, 4000),
    headings: [...document.querySelectorAll('h1,h2,h3')].map(node => {const clone = node.cloneNode(true); clone.querySelectorAll('.fluent-read-bilingual-content').forEach(part => part.remove());
      return {tag: node.tagName, source: clone.textContent.trim(), translations: [...node.querySelectorAll('.fluent-read-bilingual-content')].map(part => part.textContent)};}),
    visibleLinks: [...document.querySelectorAll('a[href]')].filter(a => a.getClientRects().length && a.href.startsWith('https://www.producthunt.com/products/reso')).map(a => ({href: a.href, text: a.textContent.slice(0, 80)})).slice(0, 30)}));
  const translatedHeading = async (tag, source) => (await evaluate()).headings.some(heading => heading.tag === tag && source.test(heading.source) && heading.translations.some(text => /[\u4e00-\u9fff]/u.test(text)));
  const translatedProductBody = () => content.evaluate(() => [...document.querySelectorAll('.fluent-read-bilingual-content')].some(wrapper =>
    wrapper.parentElement.textContent.includes('ReSO is a generative engine optimization platform') && /[\u4e00-\u9fff]/u.test(wrapper.textContent)));
  try {
    await patchConfig({alwaysTranslateDomains: ['127.0.0.1', 'producthunt.com'], disabledExtensionDomains: []});
    const homeResponse = await content.goto('https://www.producthunt.com/', {waitUntil: 'domcontentloaded', timeout}).catch(error => {result.homeEntry = {status: 'quarantine', error: error.message}; return null;});
    let clickedHomeLink = false;
    if (homeResponse) {
      await ready(); await delay(800);
      const home = await evaluate();
      result.homeEntry = {status: 'link-unavailable', httpStatus: homeResponse.status(), url: home.url};
      if (homeResponse.status() < 400 && !/verify you are human|checking your browser|just a moment|access denied|captcha/iu.test(home.text + home.title)) {
        const resoLink = home.visibleLinks.find(link => new URL(link.href).pathname === '/products/reso' && !new URL(link.href).hash);
        if (resoLink) {
          await until(async () => (await evaluate()).count > 0, 'Product Hunt home automatic translation', 18000);
          const before = await evaluate(), start = requests.length;
          await clickObservedLink(resoLink.href); await until(() => new URL(content.url()).pathname === '/products/reso', 'real homepage Reso link'); await ready();
          await until(() => translatedHeading('H1', /^ReSO AI$/iu), 'home to Reso new product heading translated', 18000);
          await until(translatedProductBody, 'home to Reso new product body translated', 18000);
          assert(requests.slice(start).some(request => request.source.startsWith('ReSO is a generative engine optimization platform')), 'No new product body provider request after homepage link');
          const after = await evaluate();
          result.navigations.push({from: before.url, to: after.url, clickedHref: resoLink.href, restoredBeforeClick: false,
            mode: before.timeOrigin === after.timeOrigin ? 'SPA' : 'document', requests: requests.length - start, count: after.count,
            headings: after.headings, newBodySources: requests.slice(start).filter(request => request.source.startsWith('ReSO is a generative engine optimization platform')).map(request => request.source)});
          result.homeEntry.status = 'passed'; clickedHomeLink = true;
        } else {result.homeEntry.reason = 'No observed homepage link points to Reso in the current live listing';}
      } else {result.homeEntry.status = 'quarantine'; result.homeEntry.reason = 'Homepage content blocked by remote access or browser verification';}
      await shot(content, 'producthunt-home-entry');
    }
    if (!clickedHomeLink) {
      const response = await content.goto(result.requestedUrl, {waitUntil: 'domcontentloaded', timeout});
      result.httpStatus = response?.status();
    } else {result.httpStatus = 200;}
    await ready(); await delay(800);
    result.initial = await evaluate();
    if ((result.httpStatus || 200) >= 400 || /verify you are human|checking your browser|just a moment|access denied|captcha/iu.test(result.initial.text + result.initial.title)) {
      result.status = 'quarantine'; result.reason = 'Remote page unavailable or browser verification blocked the product content';
      await shot(content, 'producthunt-remote-blocked'); return;
    }
    assert.match(result.initial.heading || result.initial.text, /Reso/iu, 'Reso product content missing');
    await until(() => translatedHeading('H1', /^ReSO AI$/iu), 'Reso product heading automatic translation', 18000);
    await until(translatedProductBody, 'Reso product body automatic translation', 18000);
    result.initialTranslated = await evaluate(); assert.equal(result.initialTranslated.nested, 0);
    await shot(content, 'producthunt-reso-initial');
    const links = result.initialTranslated.visibleLinks.filter(link => new URL(link.href).pathname.startsWith('/products/reso/') && !new URL(link.href).hash);
    assert(links.length > 0, 'No real Reso subpage link available for within-site navigation');
    const next = links[0].href;
    const from = await evaluate(), before = requests.length;
    await clickObservedLink(next);
    await until(() => content.url() === next || new URL(content.url()).pathname === new URL(next).pathname, 'Reso subpage real link');
    await ready(); await until(() => translatedHeading('H1', /^ReSO AI Reviews$/iu), 'Reso new Reviews heading automatic translation', 18000);
    assert(requests.slice(before).some(request => request.source === 'ReSO AI Reviews'), 'No new Reviews heading provider request after real subpage link');
    await delay(8000);
    const after = await evaluate(); assert.equal(after.nested, 0);
    result.navigations.push({from: from.url, to: after.url, clickedHref: next, restoredBeforeClick: false, mode: from.timeOrigin === after.timeOrigin ? 'SPA' : 'document', requests: requests.length - before, count: after.count, headings: after.headings,
      providerSources: requests.slice(before).map(request => request.source), pageText: after.pageText});
    // 标题已经露在视口底部时也对齐；让同一截图同时呈现独有标题和已加载的空评论正文。
    await content.locator('h1').filter({hasText: /^ReSO AI Reviews/u}).evaluate(heading => {
      const top = heading.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({top: Math.max(0, top - 100), behavior: 'instant'});
    });
    await shot(content, 'producthunt-reso-subpage');
    const overview = after.visibleLinks.find(link => new URL(link.href).pathname === '/products/reso' && !new URL(link.href).hash);
    assert(overview, 'No observed overview link returns to the user-provided Reso URL');
    assert.equal((await contentMessage({type: 'contextMenuTranslate', action: 'restore'}))?.status, 'success');
    await until(async () => (await evaluate()).count === 0, 'Reso subpage restore');
    const beforeReturn = await evaluate(), requestStart = requests.length;
    await clickObservedLink(overview.href);
    await until(() => new URL(content.url()).pathname === '/products/reso', 'Observed real site link returns to Reso');
    await ready(); await until(() => translatedHeading('H1', /^ReSO AI$/iu), 'Reso return product heading automatic translation', 18000);
    await until(translatedProductBody, 'Reso return product body automatic translation', 18000);
    assert(requests.slice(requestStart).some(request => request.source.startsWith('ReSO is a generative engine optimization platform')), 'No new product body provider request after restored return');
    await delay(600);
    const returned = await evaluate(); assert.equal(returned.nested, 0);
    result.navigations.push({from: beforeReturn.url, to: returned.url, clickedHref: overview.href, restoredBeforeClick: true, mode: beforeReturn.timeOrigin === returned.timeOrigin ? 'SPA' : 'document', requests: requests.length - requestStart, count: returned.count,
      headings: returned.headings, newBodySources: requests.slice(requestStart).filter(request => request.source.startsWith('ReSO is a generative engine optimization platform')).map(request => request.source)});
    await shot(content, 'producthunt-reso-return'); result.status = 'passed';
  } catch (error) {
    result.error = error.stack; result.final = await evaluate().catch(() => null);
    const isCurrentDocument = event => event.resourceType === 'document' && new URL(event.url).hostname === 'www.producthunt.com' &&
      (!result.final?.url || new URL(event.url).pathname === new URL(result.final.url).pathname);
    const documentHttpErrors = report.httpErrors.slice(httpErrorStart).filter(isCurrentDocument);
    const documentNetworkErrors = report.failedRequests.slice(failedRequestStart).filter(event => isCurrentDocument(event) && event.failure?.errorText !== 'net::ERR_ABORTED');
    const verificationPage = /verify you are human|checking your browser|just a moment|access denied|captcha|正在进行安全验证|请验证您是真人|请稍候|在验证您不是自动程序/iu.test([result.final?.title, result.final?.text].join(' '));
    result.classificationEvidence = {documentHttpErrors, documentNetworkErrors, verificationPage};
    if ((result.httpStatus || 200) >= 400 || documentHttpErrors.length || documentNetworkErrors.length || verificationPage || /net::ERR_|Navigation timeout/u.test(error.message)) {
      result.status = 'quarantine'; result.reason = 'Remote navigation/content availability prevents the requested live-site acceptance';
    } else {result.status = 'failed';}
    await shot(content, 'producthunt-failure').catch(() => {});
    if (result.status === 'failed') throw error;
  } finally {result.consoleErrors = report.consoleErrors.slice(errorStart); result.screenshots = report.screenshots.filter(file => path.basename(file).startsWith('producthunt-'));}
}
async function main() {
  try {
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    port = server.address().port;
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
    report.manifest = {version: manifest.version, popup: manifest.action?.default_popup, options: manifest.options_page || manifest.options_ui?.page};
    assert(report.manifest.popup && report.manifest.options);
    report.contentSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir, 'content-scripts/content.js'))).digest('hex');
    monitor = startFocusEventMonitor({onEvent: event => {
      report.focusEvents.push(event);
      if (browserPid && event.pid === browserPid) {focusViolation = new Error('Test Edge became foreground'); report.windowPlacement.browserFrontmost = true; closePromise ||= launched.close(); void closePromise.catch(() => {});}
    }, onError: error => {focusViolation = error;}});
    await monitor.ready;
    launched = await launchFocusSafePersistentContext({chromium, profileDir, background: true, headless: false,
      browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'), displayTarget: arg('display', 'secondary'),
      viewport: {width: 1280, height: 900}, timeout, browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    context = launched.context;
    const session = await context.browser().newBrowserCDPSession();
    browserPid = (await session.send('SystemInfo.getProcessInfo')).processInfo.find(process => process.type === 'browser').id;
    report.browserArguments = (await session.send('Browser.getBrowserCommandLine')).arguments.filter(argument => /^--(?:user-data-dir|host-resolver-rules|proxy|no-proxy|enable-features|disable-features|disable-extensions-except|load-extension|no-startup-window)/u.test(argument));
    await session.detach();
    assert(!report.focusEvents.some(event => event.pid === browserPid), 'Browser launch activation event');
    let worker;
    await until(async () => {
      for (const candidate of context.serviceWorkers()) {
        if (!candidate.url().endsWith(`/${manifest.background.service_worker}`)) continue;
        const m = await candidate.evaluate(() => chrome.runtime.getManifest()).catch(() => null);
        if (m?.name === manifest.name && m?.version === manifest.version) {worker = candidate; return true;}
      } return false;
    }, 'production worker', timeout);
    worker.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({surface: 'worker', message: message.text()});});
    origin = `chrome-extension://${new URL(worker.url()).host}`;
    control = await open(`${origin}/${report.manifest.popup}`, 'control');
    const initial = await readConfig();
    await patchConfig({on: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, theme: 'light', service, from: 'en', to: 'zh-Hans',
      display: 1, style: 1, autoTranslate: false, alwaysTranslateDomains: [], disabledExtensionDomains: [], useCache: false,
      customOpenAIProviders: [{id: service, name: '本地导航测试服务', endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, models: ['site-navigation-model']}],
      siteAdaptation: {enabled: true, disabledRuleIds: [], custom: {version: 1, rules: [{id: 'site-navigation-path-adapter', name: '路径变化自动翻译测试',
        match: {hosts: ['127.0.0.1'], paths: ['/adapted/*']}, mode: 'focus', content: [{css: ['#primary']}]}]}},
      model: {...initial.model, [service]: 'site-navigation-model'}, token: {[service]: 'synthetic-test-key'}, user_role: {...initial.user_role, [service]: 'SOURCE_BEGIN{{origin}}SOURCE_END'},
      enableAIContext: false, enableAIMultiSegment: false, glossaryEnabled: false, disableFloatingBall: true, disableSelectionTranslator: true,
      selectionTranslatorMode: 'disabled', disableImageTranslator: true, translationProgressPanelEnabled: false, animations: false}, true);
    if (productHuntHomeControl) {
      currentCase = 'Product Hunt homepage same-config control';
      await patchConfig({alwaysTranslateDomains: ['producthunt.com']});
      content = await open('https://www.producthunt.com/', 'content'); await ready(); await delay(8000);
      report.homeControl = await content.evaluate(() => ({url: location.href, title: document.title, text: document.body.innerText.slice(0, 600),
        count: document.querySelectorAll('.fluent-read-bilingual-content').length, nested: document.querySelectorAll('.fluent-read-bilingual-content .fluent-read-bilingual-content').length}));
      await shot(content, 'producthunt-home-control'); report.ok = true; return;
    }
    if (productHuntOnly) {
      currentCase = 'Product Hunt live SPA navigation';
      content = await open(`http://127.0.0.1:${port}/spa/initial`, 'content'); await ready();
      await productHunt(); report.ok = report.productHunt.status !== 'failed'; return;
    }
    content = await open(`http://127.0.0.1:${port}/spa/initial`, 'content'); await ready();
    if (disableInflightOnly) {
      await openPopup(); await quickClick('[data-setting="always-translate-site"]');
      await saved('alwaysTranslateDomains', ['127.0.0.1']);
      report.targetedSetup = {alwaysRulePersisted: true, initialArticle: await translated('targeted initial article')};
      await runDisableInflightCase();
      report.localConsoleErrors = [...report.consoleErrors]; assert.deepEqual(report.localConsoleErrors, []);
      report.assertions = ['The current article request is held at the local provider before the real disable click',
        'Immediate popup close is followed by persisted state acknowledgement and a reopened disabled, non-saving popup',
        'The provider observes request abort before response release', 'Releasing the held response cannot reinsert translation DOM or create new provider requests',
        'Native macOS focus events contain no activation of the isolated test Edge PID'];
      assert.equal(report.windowPlacement.browserFrontmost, false); assert.notEqual((await queryMacFrontmostApplication()).pid, browserPid);
      report.ok = true; return;
    }
    await runCase('initial rule click survives immediate popup close', async () => {
      await openPopup(); await quickClick('[data-setting="always-translate-site"]');
      await saved('alwaysTranslateDomains', ['127.0.0.1']); const value = await translated('initial rule translates');
      report.quickClose = true; report.persistenceCases.push({name: currentCase, passed: true});
      await openPopup(); assert.equal(await popup.locator('[data-setting="always-translate-site"]').getAttribute('data-enabled'), 'true');
      if (!baselineOnly) {
        assert.match(await popup.locator('[data-setting="always-translate-site"]').getAttribute('aria-description') || '', /子域名/);
        assert.match(await popup.locator('[data-setting="disable-extension-site"]').getAttribute('title') || '', /禁用优先/);
      }
      await shot(popup, 'popup-always-enabled-reopened'); await closePopup(); await shot(content, 'initial-translated'); return value;
    });
    await runCase(baselineOnly ? 'baseline restore then SPA push reproduces missing translation' : 'restore then SPA push triggers always translation again', async () => {
      await restore(); const before = requests.length; await content.locator('#push').click();
      if (baselineOnly) {
        await delay(2200); const value = await dom(); assert.equal(value.count, 0, 'Expected baseline missing auto translation did not reproduce');
        assert.equal(value.route, '/spa/pushed'); assert.equal(requests.length, before);
        report.baselineBugReproduced = true; report.expectedMissingTranslation = true;
        report.baselineReproduced = {afterRestoreNavigation: value, additionalRequests: 0}; await shot(content, 'baseline-restore-spa-missing'); return value;
      }
      return translated('restore then push auto translation');
    });
    if (baselineOnly) {report.assertions = ['Initial rule persists after immediate popup close', 'Initial article has exactly one translation wrapper', 'After restore and a real SPA link, baseline has zero translation and zero new provider request']; report.ok = true; return;}
    await runCase('path adapter activates on a continuous SPA link without manual restore', async () => {
      await content.locator('#adapter').click(); const value = await translated('new path activates adapter');
      assert.equal(value.route, '/adapted/article'); return value;
    });
    await runCase('leaving path adapter continues automatic translation without restore', async () => {
      await content.locator('#push').click(); const value = await translated('generic route after adapter removal');
      assert.equal(value.route, '/spa/pushed'); return value;
    });
    await runCase('restore then SPA replace triggers translation', async () => {await restore(); await content.locator('#replace').click(); return translated('replace after restore');});
    await runCase('restored same-page anchor preserves user intent', async () => {
      await restore(); const before = requests.length; await content.locator('#hash').click(); await delay(600); await restored('anchor remains original');
      assert.equal(requests.length, before); return dom();
    });
    await runCase('HashRouter new article translates after restore', async () => {await content.locator('#hashrouter').click(); const value = await translated('HashRouter article'); assert.equal(value.route, '/article/hash-router'); return value;});
    await runCase('Hashbang new article translates after restore', async () => {await restore(); await content.locator('#hashbang').click(); const value = await translated('Hashbang article'); assert.equal(value.route, '/article/hashbang'); return value;});
    await runCase('delayed SPA body translates after restore', async () => {await content.locator('#delayed').click(); return translated('delayed SPA article');});
    await runCase('popstate article translates after restore', async () => {await restore(); await content.goBack({waitUntil: 'domcontentloaded'}); return translated('popstate article');});
    await runCase('rapid routes leave exactly one current translation', async () => {
      await content.locator('#quick').click(); await content.waitForURL(`http://127.0.0.1:${port}/spa/final`);
      const value = await translated('final rapid route'); await delay(1100); assert.deepEqual(await dom(), value); await shot(content, 'rapid-routes-final'); return value;
    });
    await runCase('ordinary same-site link translates new document', async () => {await content.locator('#same').click(); await content.waitForURL(`http://127.0.0.1:${port}/document/next`); await ready(); return translated('same site document');});
    await runCase('unruled cross-site link stays original', async () => {
      const before = requests.length; await content.locator('#cross').click(); await content.waitForURL(`http://localhost:${port}/document/cross`); await ready(); await delay(600);
      await restored('unruled site original'); assert.equal(requests.length, before); await openPopup();
      assert.equal(await popup.locator('[data-setting="always-translate-site"]').getAttribute('data-enabled'), 'false'); await shot(popup, 'popup-other-site'); await closePopup(); return dom();
    });
    await runCase('link returns to ruled site and translates', async () => {await content.locator('#backsite').click(); await ready(); return translated('return ruled site');});
    await runCase('open popup follows real target tab navigation and new domain state', async () => {
      await openPopup(); await content.locator('#cross').click();
      await content.waitForURL(`http://localhost:${port}/document/cross`); await ready();
      await popup.locator('[data-setting="always-translate-site"][data-site-domain="localhost"]').waitFor();
      assert.equal(await popup.locator('[data-setting="always-translate-site"]').getAttribute('data-enabled'), 'false');
      assert.equal(await popup.locator('[data-setting="disable-extension-site"]').getAttribute('data-enabled'), 'false');
      await shot(popup, 'popup-domain-follows-navigation'); await closePopup();
      await content.locator('#backsite').click(); await ready(); return translated('return after live popup target change');
    });
    await runCase('disabled rule immediate close restores DOM and rejects translation', async () => {
      await openPopup(); await quickClick('[data-setting="disable-extension-site"]'); await saved('disabledExtensionDomains', ['127.0.0.1']);
      await restored('disable restores original'); const before = requests.length;
      assert.equal((await contentMessage({type: 'contextMenuTranslate', action: 'fullPage'}))?.status, 'disabled');
      await content.locator('#push').click(); await delay(650); await restored('disabled SPA');
      assert.equal(requests.length, before); await openPopup();
      assert.equal(await popup.locator('[data-setting="disable-extension-site"]').getAttribute('data-enabled'), 'true');
      assert(await popup.locator('[data-setting="always-translate-site"]').isDisabled());
      await shot(popup, 'popup-disabled-reopened'); await closePopup(); report.persistenceCases.push({name: currentCase, passed: true}); return dom();
    });
    await runCase('disabled ordinary navigation makes no requests', async () => {
      const before = requests.length; await content.locator('#same').click(); await ready(); await delay(600);
      await restored('disabled fresh document'); assert.equal(requests.length, before); return dom();
    });
    await runCase('reenable preserves always rule and translates current article', async () => {
      await openPopup(); await quickClick('[data-setting="disable-extension-site"]'); await saved('disabledExtensionDomains', []);
      assert.deepEqual((await readConfig()).alwaysTranslateDomains, ['127.0.0.1']); return translated('reenable auto translation');
    });
    await runCase('always rule off keeps current article but new route remains original', async () => {
      await openPopup(); await quickClick('[data-setting="always-translate-site"]'); await saved('alwaysTranslateDomains', []);
      await translated('current translation unchanged'); await restore(); const before = requests.length;
      await content.locator('#replace').click(); await delay(650); await restored('off after navigation'); assert.equal(requests.length, before); return dom();
    });
    await runCase('two rule writes close reopen retain latest values', async () => {
      await openPopup(); await quickClick('[data-setting="always-translate-site"]'); await saved('alwaysTranslateDomains', ['127.0.0.1']); await translated('rule enabled again');
      await openPopup(); await quickClick('[data-setting="always-translate-site"]'); await saved('alwaysTranslateDomains', []);
      await openPopup(); assert.equal(await popup.locator('[data-setting="always-translate-site"]').getAttribute('data-enabled'), 'false');
      await shot(popup, 'popup-latest-write-reopened'); await closePopup(); report.latestWriteWins = true; report.persistenceCases.push({name: currentCase, passed: true}); return dom();
    });
    await runCase('options mirrors site rules and delayed initial body translates', async () => {
      await patchConfig({alwaysTranslateDomains: ['127.0.0.1']});
      const options = await open(`${origin}/${report.manifest.options}#settings-sites`, 'options');
      await options.locator('[data-site-preference="127.0.0.1"]').waitFor();
      assert.equal(await options.getByRole('checkbox', {name: '始终翻译 127.0.0.1', exact: true}).isChecked(), true);
      assert.equal(await options.getByRole('checkbox', {name: '禁用扩展 127.0.0.1', exact: true}).isChecked(), false);
      await shot(options, 'options-rules-cross-page'); report.crossPageSync = true;
      await content.goto(`http://127.0.0.1:${port}/document/initial-delayed`, {waitUntil: 'domcontentloaded'}); await ready();
      return translated('initial late body');
    });
    await runCase('ordinary anchor preserves the in-flight request without restarting', async () => {
      const before = requests.length; await content.locator('#slow-anchor').click();
      await until(() => requests.slice(before).some(request => request.source.includes('/spa/slow-anchor')), 'slow anchor request began');
      await content.locator('#hash').click(); const value = await translated('slow request survives ordinary anchor');
      assert.equal(requests.slice(before).filter(request => request.source.includes('/spa/slow-anchor')).length, 1);
      assert.equal(value.route, '/spa/slow-anchor'); return value;
    });
    await runDisableInflightCase();
    await runCase('reenable after aborted slow translation starts one current session', async () => {
      await openPopup(); await quickClick('[data-setting="disable-extension-site"]'); await saved('disabledExtensionDomains', []);
      return translated('slow article reenabled');
    });
    report.localConsoleErrors = [...report.consoleErrors]; assert.deepEqual(report.localConsoleErrors, []);
    report.assertions = ['Every translated fixture article keeps its original text and exactly one Chinese translation wrapper, without nested wrappers',
      'Restore and disable remove translation DOM and preserve original source text', 'Unruled/disabled navigation makes zero new provider requests',
      'Ordinary hash anchors preserve restored user intent and an existing in-flight request', 'Latest persisted rule values survive immediate popup close/reopen',
      'Disable cancels active translation; delayed provider completion never reinserts DOM', 'Native macOS focus events contain no activation of the isolated test Edge PID'];
    if (process.argv.includes('--producthunt')) await productHunt();
    assert.equal(report.windowPlacement.browserFrontmost, false);
    assert.notEqual((await queryMacFrontmostApplication()).pid, browserPid); report.ok = true;
  } catch (error) {
    report.failure = {case: currentCase, error: error.stack};
    if (content && !content.isClosed()) {report.failure.dom = await bounded(dom, 2000, 'failure DOM').catch(() => null);
      report.failure.bodyText = await bounded(() => content.locator('body').innerText(), 2000, 'failure body text').catch(() => null);
      await bounded(() => shot(content, 'failure-content'), 2000, 'failure screenshot').catch(() => {});}
    if (popup && !popup.isClosed()) {report.failure.popupText = await bounded(() => popup.locator('body').innerText(), 2000, 'failure popup text').catch(() => ''); await bounded(() => shot(popup, 'failure-popup'), 2000, 'failure popup screenshot').catch(() => {});}
    throw error;
  } finally {
    report.providerRequests = requests;
    report.focusEvents = monitor?.events || report.focusEvents;
    if (control && !control.isClosed()) {
      let timer;
      const config = await Promise.race([readConfig().catch(() => null), new Promise(resolve => {timer = setTimeout(() => resolve(null), 2000);})]).finally(() => clearTimeout(timer));
      report.finalConfig = config && {alwaysTranslateDomains: config.alwaysTranslateDomains, disabledExtensionDomains: config.disabledExtensionDomains, revision: config.__fluentConfigRevision};
    }
    let closed = false;
    if (launched) {try {await (closePromise ||= launched.close()); closed = true;} catch (error) {report.cleanupErrors.push(`browser close: ${error.message}`);}}
    try {await monitor?.stop();} catch (error) {report.cleanupErrors.push(`focus observer: ${error.message}`);}
    if (closed) fs.rmSync(profileDir, {recursive: true, force: true}); else report.retainedProfile = profileDir;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (report.cleanupErrors.length || focusViolation) {report.ok = false; process.exitCode = 1;}
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
  }
}
main().then(() => console.log(JSON.stringify({ok: report.ok, cases: report.cases.length, requests: requests.length, screenshots: report.screenshots.length, report: path.join(artifactsDir, 'report.json')})))
  .catch(error => {console.error(error.stack); process.exitCode = 1;});

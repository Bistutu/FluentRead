#!/usr/bin/env node
/**
 * @file scripts/testing/run-web-native-feed-test.cjs
 * 文件职责：在隔离 Edge production 扩展中验收 Mastodon 公开时间线的原生分页和同文档帖子导航。
 * 主要内容：可信滚轮触发原站新增帖子，逐个可见正文绑定原节点和保护区；验证翻译、恢复、重译、原生链接导航和停用，保存原站请求、文档身份、DOM 与截图。
 * 模块边界：只浏览公开页面，不登录或操作账户；微软响应来自显式受控传输，不改写网站响应、不追加测试帖子，也不把桌面证据外推到移动真机。
 */
'use strict';
if (require.main === module && process.argv.includes('--help')) {
  console.log('node scripts/testing/run-web-native-feed-test.cjs --allow-network --extension-dir .output/chrome-mv3 --playwright-root PATH --artifacts-dir PATH [--timeout 45000] [--max-scrolls 20]');
  process.exit(0);
}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createRequire} = require('node:module');
const {randomUUID, createHash} = require('node:crypto');
const focus = require('./focus-safe-browser.cjs');
const {guardBrowserClose, getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const {installControlledProvider, isControlledTranslationForSource} = require('../site-translation/controlled-provider.cjs');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
const FEED_URL = 'https://mastodon.social/@Mastodon';

function parseArgs(argv) {
  const args = {timeout: 45000, maxScrolls: 20, allowNetwork: false};
  const accepted = new Set(['extension-dir', 'playwright-root', 'artifacts-dir', 'timeout', 'max-scrolls']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') continue;
    if (token === '--allow-network') {args.allowNetwork = true; continue;}
    assert.ok(token.startsWith('--') && accepted.has(token.slice(2)), `Unsupported argument: ${token}`);
    const value = argv[++i]; assert.ok(value && !value.startsWith('--'), `Missing value: ${token}`);
    args[token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  assert.ok(args.allowNetwork, 'Use --allow-network to visit the public native feed');
  for (const key of ['extensionDir', 'playwrightRoot', 'artifactsDir']) assert.ok(args[key], `Missing ${key}`);
  args.timeout = Number(args.timeout); args.maxScrolls = Number(args.maxScrolls);
  assert.ok(Number.isFinite(args.timeout) && args.timeout >= 5000 && args.timeout <= 120000, 'timeout must be 5000–120000');
  assert.ok(Number.isInteger(args.maxScrolls) && args.maxScrolls >= 1 && args.maxScrolls <= 30, 'max-scrolls must be 1–30');
  return args;
}

/** 只观察站点真实节点；首次看到已有译文的节点不能作为原文证明。 */
function installNativeFeedTracker(key) {
  if (window[key]) throw new Error('Native feed tracker already exists');
  const selector = '.status__content__text p';
  const artifact = '.fluent-read-bilingual-content,.fluent-read-loading,.fluent-read-retry-wrapper,[data-fr-translation-owned="true"]';
  const wrappers = '.fluent-read-bilingual-content';
  const protectedSelector = 'a,code,pre,button,input,textarea,select,svg,[translate="no"],.notranslate';
  const records = new Map(); const seenPosts = new Set(); const inputs = []; let next = 1; let disposed = false;
  const clean = node => {const clone = node.cloneNode(true); clone.querySelectorAll(artifact).forEach(e => e.remove());
    clone.querySelectorAll('[data-fr-translation-segment="true"]').forEach(e => e.replaceWith(...e.childNodes)); return clone.innerHTML;};
  const translatedSource = (wrapper, row) => {
    const clone = wrapper.cloneNode(true);
    // 译文骨架保留原站 hashtag/mention，传输前缀只应在真正可译文本中取证。
    clone.querySelectorAll('code,pre,[translate="no"],.notranslate,.mention,.hashtag').forEach(node => node.remove());
    // 安全序列化会清除原站 class；通过首次捕获的标签/链接/文本识别仍被原样保留的内容。
    clone.querySelectorAll('*').forEach(node => {
      if (row.protected.some(item => node.localName === item.tag && node.textContent === item.text &&
          node.getAttribute('href') === item.href)) node.remove();
    });
    return clone.textContent.trim();
  };
  const sourceParts = node => {const walker = document.createTreeWalker(node, 4); const text = []; let current;
    while ((current = walker.nextNode())) {
      const blocked = current.parentElement.closest(`${artifact},code,pre,[translate="no"],.notranslate,.mention,.hashtag`);
      // 已核对的原站顶层 app shell 使用 notranslate；显式 Mastodon 正文规则允许穿过该外壳，局部保护仍排除。
      const topLevelMastodonShell = blocked?.id === 'mastodon' && blocked.parentElement === document.body && blocked.classList.contains('app-holder');
      if (!blocked || topLevelMastodonShell) text.push(current.data);
    }
    return text;};
  const visible = node => {
    let r = node.getBoundingClientRect(); let left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
    let top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      const box = parent.getBoundingClientRect();
      if (/hidden|clip|auto|scroll/.test(style.overflowX)) {left = Math.max(left, box.left); right = Math.min(right, box.right);}
      if (/hidden|clip|auto|scroll/.test(style.overflowY)) {top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom);}
    }
    return right - left > 2 && bottom - top > 2;
  };
  const scan = () => {
    if (disposed) return;
    document.querySelectorAll('article[data-id]').forEach(node => seenPosts.add(node.getAttribute('data-id')));
    for (const node of document.querySelectorAll(selector)) {
      if (records.has(node) || node.closest(artifact)) continue;
      const parts = sourceParts(node); const text = parts.join(' ').replace(/\s+/g, ' ').trim();
      const eligible = (text.match(/[A-Za-z]{2,}/g) || []).length >= 2 && /\s/.test(text);
      records.set(node, {id: next++, node, html: clean(node), text, parts, eligible,
        firstObservedWrappers: node.querySelectorAll(wrappers).length,
        protected: [...node.querySelectorAll(protectedSelector)].filter(e => !e.closest(artifact)).map(e => ({
          node: e, html: e.outerHTML, tag: e.localName, text: e.textContent, href: e.getAttribute('href')}))});
    }
  };
  const observer = new MutationObserver(scan); observer.observe(document.documentElement, {childList: true, subtree: true}); scan();
  const onKey = event => {if (event.altKey && event.key.toLowerCase() === 't') inputs.push({type: 'full-shortcut', trusted: event.isTrusted});};
  const onWheel = event => inputs.push({type: 'wheel', trusted: event.isTrusted, deltaY: event.deltaY});
  const onClick = event => {const link = event.target.closest?.('a.status__relative-time');
    if (link) inputs.push({type: 'post-link', trusted: event.isTrusted, href: link.getAttribute('href')});};
  document.addEventListener('keydown', onKey, true); document.addEventListener('wheel', onWheel, {capture: true, passive: true});
  document.addEventListener('click', onClick, true);
  const snapshot = (ids = []) => {
    scan(); const selected = new Set(ids); const allWrappers = [...document.querySelectorAll(wrappers)];
    return {url: location.href, documentToken: key, timeOrigin: performance.timeOrigin,
      postIds: [...document.querySelectorAll('article[data-id]')].map(e => e.getAttribute('data-id')), seenPostIds: [...seenPosts],
      scrollY, scrollHeight: document.scrollingElement.scrollHeight, viewportHeight: innerHeight,
      sources: [...records.values()].filter(row => row.node.isConnected && (selected.has(row.id) || visible(row.node))).map(row => ({
        id: row.id, visible: visible(row.node), eligible: row.eligible, sourceText: row.text, sourceParts: row.parts, firstObservedWrappers: row.firstObservedWrappers,
        sourceIntact: clean(row.node) === row.html,
        protectedCount: row.protected.length, protectedIntact: row.protected.every(item => item.node.isConnected && row.node.contains(item.node) && item.node.outerHTML === item.html),
        postId: row.node.closest('article[data-id]')?.getAttribute('data-id') || null,
        translations: [...row.node.querySelectorAll(wrappers)].map(wrapper => translatedSource(wrapper, row)),
        renderedTranslations: [...row.node.querySelectorAll(wrappers)].map(e => e.textContent),
        pending: row.node.querySelectorAll('.fluent-read-loading,.fluent-read-retry-wrapper').length})),
      wrappers: allWrappers.length, nested: document.querySelectorAll(`${wrappers} ${wrappers}`).length,
      duplicateParents: allWrappers.length - new Set(allWrappers.map(e => e.parentElement)).size,
      pending: document.querySelectorAll('.fluent-read-loading,.fluent-read-retry-wrapper').length,
      inputs: [...inputs], visibleLinks: [...document.querySelectorAll('a.status__relative-time')].filter(visible).map(e => e.getAttribute('href'))};
  };
  window[key] = {snapshot, dispose() {disposed = true; observer.disconnect(); document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('wheel', onWheel, true); document.removeEventListener('click', onClick, true); records.clear(); delete window[key];}};
  return snapshot();
}

function assertNativeSnapshot(state, {translated, ids, phase}) {
  const expected = new Set(ids);
  const rows = state.sources.filter(row => row.eligible && (row.visible || expected.has(row.id)));
  assert.ok(rows.length, `${phase}: no visible source paragraphs`);
  assert.ok(ids.every(id => rows.some(row => row.id === id)), `${phase}: selected source owner disappeared`);
  for (const row of state.sources.filter(row => row.visible || expected.has(row.id))) {
    assert.equal(row.firstObservedWrappers, 0, `${phase}/${row.id}: source baseline was captured after translation`);
    assert.equal(row.sourceIntact, true, `${phase}/${row.id}: original HTML changed`);
    assert.equal(row.protectedIntact, true, `${phase}/${row.id}: protected link/code changed`);
    if (!row.eligible) {
      if (!row.sourceText) assert.equal(row.translations.length, 0, `${phase}/${row.id}: protected-only source received translation`);
      continue;
    }
    assert.equal(row.pending, 0, `${phase}/${row.id}: pending or retry artifact`);
    assert.equal(row.translations.length, translated ? 1 : 0, `${phase}/${row.id}: wrong translation count`);
    if (translated) {
      assert.ok(isControlledTranslationForSource(row.translations[0], row.sourceText, row.sourceParts),
        `${phase}/${row.id}: controlled response not proven`);
    }
  }
  assert.equal(state.nested, 0, `${phase}: nested wrappers`); assert.equal(state.duplicateParents, 0, `${phase}: duplicate wrappers`);
  if (!translated) {assert.equal(state.wrappers, 0, `${phase}: page wrappers remain`); assert.equal(state.pending, 0, `${phase}: page loading remains`);}
  return rows.length;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv), extensionDir = path.resolve(args.extensionDir), out = path.resolve(args.artifactsDir);
  const freshness = assertFreshProductionExtension(extensionDir);
  fs.mkdirSync(out, {recursive: true});
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-native-feed-'));
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const report = {ok: false, url: FEED_URL, scope: 'native-mastodon-public-infinite-feed-and-spa-post-route', freshness,
    artifacts: {manifest: hash(path.join(extensionDir, 'manifest.json')), content: hash(path.join(extensionDir, 'content-scripts/content.js')),
      background: hash(path.join(extensionDir, 'background.js'))},
    provider: 'controlled-microsoft-response', cases: [], scrollSteps: [], nativeRequests: [], focusChecks: [], pageErrors: [],
    limits: ['Only public browsing; no login, posting, following or other account actions.',
      'Real site network/DOM/native gestures with controlled translation responses; no provider quality proof.',
      'Desktop Edge, not Firefox/Safari/mobile hardware.']};
  const persist = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  let browser, page, provider, ownedPid, primaryError, launchAttempted = false, trackerInstalled = false;
  const key = `__fluentReadNativeFeed_${randomUUID().replaceAll('-', '')}`;
  const ensureFocus = async label => {const front = await focus.queryMacFrontmostApplication();
    assert.ok(front?.pid && ownedPid && front.pid !== ownedPid, `Foreground safety failed: ${label}`);
    report.focusChecks.push({label, frontmostPid: front.pid, browserPid: ownedPid, browserFrontmost: false});};
  try {
    const {chromium} = createRequire(path.join(path.resolve(args.playwrightRoot), '__native-feed-loader.cjs'))('playwright');
    launchAttempted = true;
    browser = await focus.launchFocusSafePersistentContext({chromium, profileDir: profile,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: false, background: true,
      viewport: {width: 1280, height: 900}, browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(browser, profile); ownedPid = await getGuardedBrowserPid(browser);
    report.launchMode = browser.launchMode; report.focusPolicy = browser.focusPolicy; report.windowPlacement = browser.windowPlacement;
    provider = await installControlledProvider(browser.context, focus.newPageWithoutForeground, args.timeout);
    page = await focus.newPageWithoutForeground(browser.context, args.timeout);
    const nativeRequestStarts = new WeakMap();
    page.on('request', request => nativeRequestStarts.set(request, Date.now()));
    page.on('pageerror', error => report.pageErrors.push(String(error)));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.hostname === 'mastodon.social' && /^\/api\/v1\/(accounts\/[^/]+\/statuses|statuses\/)/.test(url.pathname)) {
        report.nativeRequests.push({url: url.href, status: response.status(), requestedAt: nativeRequestStarts.get(response.request()), at: Date.now()});
      }
    });
    const navigation = await page.goto(FEED_URL, {waitUntil: 'domcontentloaded', timeout: args.timeout});
    assert.ok(navigation && navigation.status() < 400, `External feed returned HTTP ${navigation?.status()}`);
    await focus.activateExtensionTabWithoutForeground(browser.context, page, args.timeout);
    await page.locator('#fluent-read-page-styles').waitFor({state: 'attached', timeout: args.timeout});
    await page.locator('article[data-id] .status__content__text p').first().waitFor({state: 'attached', timeout: args.timeout});
    report.initial = await page.evaluate(installNativeFeedTracker, key); trackerInstalled = true;
    await page.locator('article[data-id] .status__content__text p').first().scrollIntoViewIfNeeded({timeout: args.timeout});
    await page.waitForTimeout(500);
    const snapshot = ids => page.evaluate(({key, ids}) => window[key]?.snapshot(ids), {key, ids});
    const currentIds = async () => (await snapshot()).sources.filter(row => row.visible && row.eligible).map(row => row.id);
    const waitState = (translated, ids) => page.waitForFunction(({key, translated, ids}) => {
      const state = window[key]?.snapshot(ids); if (!state) return false;
      const rows = state.sources.filter(row => row.eligible && (row.visible || ids.includes(row.id)));
      return rows.length && ids.every(id => rows.some(row => row.id === id)) && rows.every(row => row.translations.length === (translated ? 1 : 0) && row.pending === 0)
        && (translated || state.wrappers === 0 && state.pending === 0);
    }, {key, translated, ids}, {timeout: args.timeout});
    const capture = async (phase, translated, ids) => {
      await ensureFocus(phase); const state = await snapshot(ids);
      if (translated) report.providerEvidence = await provider.snapshot();
      const item = {phase, translated, ok: false, state}; report.cases.push(item); persist();
      item.coveredSources = assertNativeSnapshot(state, {translated, ids, phase}); item.ok = true;
      process.stderr.write(`[native-feed] ${phase}: ${item.coveredSources} source paragraphs verified\n`);
      await page.screenshot({path: path.join(out, `${phase}.png`)});
      fs.writeFileSync(path.join(out, `${phase}.html`), await page.content()); persist(); return state;
    };
    const toggle = async () => {await focus.activateExtensionTabWithoutForeground(browser.context, page, args.timeout);
      await ensureFocus('before-full-shortcut'); await page.keyboard.press('Alt+T');};
    let ids = await currentIds(); assert.ok(ids.length, 'No visible feed paragraph before translation');
    assert.ok((await snapshot(ids)).sources.some(row => row.protectedCount > 0), 'Initial native body has no protected link/code evidence');
    await capture('feed-original', false, ids);
    await toggle(); await waitState(true, ids); await capture('feed-translated', true, ids);
    const beforeScroll = await snapshot(); const scrollStartedAt = Date.now();
    report.beforeScroll = {postIds: beforeScroll.postIds, seenPostIds: beforeScroll.seenPostIds, scrollStartedAt};
    assert.ok(beforeScroll.postIds.length >= 10, 'Native feed did not expose an initial post batch');
    const initialPosts = new Set(beforeScroll.seenPostIds); let newPostIds = [];
    await page.mouse.move(640, 600);
    for (let index = 0; index < args.maxScrolls; index++) {
      await page.mouse.wheel(0, 3000); await page.waitForTimeout(800);
      const state = await snapshot(); newPostIds = state.seenPostIds.filter(id => !initialPosts.has(id));
      report.scrollSteps.push({index, postCount: state.postIds.length, seenPostCount: state.seenPostIds.length,
        newPostIds, scrollY: state.scrollY, scrollHeight: state.scrollHeight}); persist();
      process.stderr.write(`[native-feed] scroll ${index + 1}: ${state.postIds.length} current posts, ${newPostIds.length} new identities\n`);
      if (newPostIds.length >= 5) break;
    }
    assert.ok(newPostIds.length >= 5, 'Native infinite scroll did not append at least five actual post identities');
    assert.ok(report.nativeRequests.some(request => request.status === 200 && request.requestedAt >= scrollStartedAt && new URL(request.url).searchParams.has('max_id')),
      'No successful native pagination response; added DOM alone cannot prove infinite feed loading');
    const firstNew = page.locator(`article[data-id="${newPostIds[0]}"]`);
    await firstNew.scrollIntoViewIfNeeded({timeout: args.timeout}); await page.waitForTimeout(700);
    ids = await currentIds(); assert.ok(ids.length, 'New native post batch has no visible translatable paragraphs');
    const newVisible = (await snapshot(ids)).sources.filter(row => row.visible && row.eligible && newPostIds.includes(row.postId));
    assert.ok(newVisible.length, 'The appended post batch has not entered the visible source contract');
    await waitState(true, ids); const afterScroll = await capture('native-appended-translated', true, ids);
    report.pagination = {initialCount: beforeScroll.postIds.length, finalCount: afterScroll.postIds.length,
      initialUniqueCount: initialPosts.size, finalUniqueCount: afterScroll.seenPostIds.length, addedPostIds: newPostIds,
      newlyVisibleSources: newVisible.map(row => ({id: row.id, postId: row.postId, sourceText: row.sourceText}))};
    await toggle(); await waitState(false, ids); await capture('native-appended-restored', false, ids);
    await toggle(); await waitState(true, ids); await capture('native-appended-retranslated', true, ids);
    // 长帖翻译会把正文后半段留在视口内；真实导航前滚回该帖原生时间链接。
    const routeLink = firstNew.locator('a.status__relative-time').first();
    await routeLink.scrollIntoViewIfNeeded({timeout: args.timeout}); await page.waitForTimeout(500);
    const beforeRoute = await snapshot(ids);
    const href = await routeLink.getAttribute('href');
    assert.ok(href && /^\/@[^/]+\/\d+$/.test(href) && beforeRoute.visibleLinks.includes(href),
      'The appended native post permalink did not become visible');
    await routeLink.click({timeout: args.timeout});
    await page.waitForURL(url => url.href !== beforeRoute.url, {timeout: args.timeout});
    const afterRoute = await snapshot();
    assert.ok(afterRoute && afterRoute.documentToken === beforeRoute.documentToken && afterRoute.timeOrigin === beforeRoute.timeOrigin,
      'Post navigation created a new document; this case requires actual same-document routing');
    assert.equal(new URL(afterRoute.url).origin, new URL(FEED_URL).origin, 'Native post link left the public test origin');
    assert.ok(afterRoute.inputs.some(input => input.type === 'post-link' && input.trusted && input.href === href), 'Native route was not triggered by a trusted click');
    report.route = {before: beforeRoute.url, after: afterRoute.url, documentToken: afterRoute.documentToken,
      sameTimeOrigin: true, href, trigger: 'trusted native post permalink click'};
    // 路由先显示原站加载界面，正文须等原生请求完成；不把固定延时当页面就绪证明。
    const routeBody = page.locator('.status__content__text p').first();
    await routeBody.waitFor({state: 'attached', timeout: args.timeout});
    await routeBody.scrollIntoViewIfNeeded({timeout: args.timeout});
    await page.waitForFunction(key => window[key]?.snapshot().sources.some(row => row.visible && row.eligible), key, {timeout: args.timeout});
    ids = await currentIds(); assert.ok(ids.length, 'Post detail route has no visible translatable body');
    await waitState(true, ids); await capture('native-route-translated', true, ids);
    await toggle(); await waitState(false, ids); await capture('native-route-restored', false, ids);
    await toggle(); await waitState(true, ids); await capture('native-route-retranslated', true, ids);
    await toggle(); await waitState(false, ids); await capture('native-route-final-restored', false, ids);
    const stopped = await provider.snapshot();
    await page.mouse.wheel(0, 500); await page.waitForTimeout(1500);
    const stoppedState = await snapshot();
    assert.equal(stoppedState.wrappers, 0, 'Stopped session mounted translations after native scroll');
    report.providerEvidence = await provider.snapshot();
    assert.equal(report.providerEvidence.requests, stopped.requests, 'Stopped session sent a translation request');
    assert.ok(stoppedState.inputs.some(input => input.type === 'wheel' && input.trusted), 'Native wheel input was not observed');
    assert.ok(stoppedState.inputs.filter(input => input.type === 'full-shortcut').every(input => input.trusted), 'Synthetic shortcut entered evidence');
    await page.evaluate(key => window[key].dispose(), key); trackerInstalled = false; report.trackerDisposed = true;
    await ensureFocus('completed'); report.ok = true;
  } catch (error) {
    primaryError = error; report.error = error.stack || String(error); report.ok = false;
    if (page && !page.isClosed()) {
      report.failureState = await page.evaluate(key => window[key]?.snapshot(), key).catch(() => null);
      await page.screenshot({path: path.join(out, 'failure.png')}).catch(() => {});
      await page.content().then(html => fs.writeFileSync(path.join(out, 'failure.html'), html)).catch(() => {});
    }
  } finally {
    if (trackerInstalled && page && !page.isClosed()) await page.evaluate(key => window[key]?.dispose(), key)
      .then(() => {report.trackerDisposed = true;}, error => {report.trackerCleanupError = String(error); report.ok = false; primaryError ||= error;});
    provider?.dispose(); let closed = false;
    try {if (browser) {await browser.close(); closed = true; report.browserClosed = true;}}
    catch (error) {report.browserCleanupError = String(error); report.ok = false; primaryError ||= error;}
    if (closed || !launchAttempted) {
      try {fs.rmSync(profile, {recursive: true, force: true}); report.profileRemoved = true;}
      catch (error) {report.profileCleanupError = String(error); report.ok = false; primaryError ||= error;}
    } else {report.retainedProfile = profile; report.ok = false;}
    persist();
  }
  console.log(JSON.stringify({ok: report.ok, report: path.join(out, 'report.json'), pagination: report.pagination,
    route: report.route, phases: report.cases.map(item => ({phase: item.phase, ok: item.ok, coveredSources: item.coveredSources})),
    cleanup: {browserClosed: report.browserClosed, profileRemoved: report.profileRemoved}}, null, 2));
  if (primaryError) throw primaryError;
  assert.equal(report.ok, true, 'Native public feed verification did not complete');
}
module.exports = {parseArgs, installNativeFeedTracker, assertNativeSnapshot, main};
if (require.main === module) main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});

#!/usr/bin/env node
/**
 * @file scripts/testing/run-reddit-translation-test.cjs
 * 在全新临时 Edge 中重现页面已有译文的 font 结构，检查 FluentRead 的
 * 正文/全部节点范围、悬浮切换、全文翻译、迟到响应及外部译文增删，以及搜索和个人主页。
 * 默认只提供本地夹具和确定性微软响应；--search-only/--profile-only 限定对应专项，
 * --live-search 额外尝试公开搜索页并单独记录站点限制。不执行用户脚本，不激活 macOS 前台。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
const root = path.resolve(__dirname, '../..');
const owned = '.fluent-read-bilingual-content';
const foreign = '.immersive-translate-target-wrapper';
const args = {timeout: 30000};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--background') continue;
  if (key === '--search-only' || key === '--profile-only' || key === '--live-search') {
    args[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = true;
    continue;
  }
  assert.ok(key.startsWith('--') && process.argv[i + 1], `Invalid argument ${key}`);
  args[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = process.argv[++i];
}
for (const key of ['extensionDir', 'playwrightRoot', 'focusSafeHelper', 'artifactsDir']) {
  assert.ok(args[key], `Missing ${key}`);
  args[key] = path.resolve(args[key]);
}
args.timeout = Number(args.timeout);
assert.ok(!(args.searchOnly && args.profileOnly), '--search-only and --profile-only cannot be combined');
const helper = require(args.focusSafeHelper);
const {chromium} = createRequire(path.join(args.playwrightRoot, 'reddit-test.cjs'))('playwright');
const report = {scope: 'reddit-domain-local-fixture', provider: 'microsoft-local-deterministic-response',
  profileMode: 'new-temporary-profile', cases: [], errors: []};
const save = () => fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), JSON.stringify(report, null, 2));

async function main() {
  assertFreshProductionExtension(args.extensionDir, root);
  fs.mkdirSync(args.artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-reddit-coexistence-'));
  let session, context, worker, popup, sequence = 0;
  const installedWorkers = new WeakMap();
  const installWorker = current => {
    if (!installedWorkers.has(current)) installedWorkers.set(current, current.evaluate(() => {
      globalThis.redditRequests = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
        if (url.hostname !== 'edge.microsoft.com' || url.pathname !== '/translate/translatetext') {
          throw new Error(`External worker fetch disabled: ${url.origin}`);
        }
        const texts = JSON.parse(init?.body ?? await input.text());
        globalThis.redditRequests.push(texts);
        await new Promise(resolve => setTimeout(resolve, 600));
        return new Response(JSON.stringify(texts.map(() => ({translations: [{text: '流畅阅读测试译文'}]}))),
          {status: 200, headers: {'content-type': 'application/json'}});
      };
    }));
    return installedWorkers.get(current);
  };
  const patchConfig = async updates => {
    const response = await popup.evaluate(async ({updates, sequence}) => {
      const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!read.success) throw new Error(read.error);
      const config = typeof read.value === 'string' ? JSON.parse(read.value) : read.value;
      return chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: updates,
        expected: Object.fromEntries(Object.keys(updates).map(key => [key, config[key]])),
        clientId: 'reddit-coexistence-browser', sequence, baseRevision: config.__fluentConfigRevision});
    }, {updates, sequence: ++sequence});
    assert.equal(response.success, true, JSON.stringify(response));
  };
  const count = (page, selector) => page.locator(selector).count();
  const waitCount = (page, selector, expected) => page.waitForFunction(({selector, expected}) =>
    document.querySelectorAll(selector).length === expected, {selector, expected}, {timeout: args.timeout});
  const toggleFull = async page => {
    await helper.activateExtensionTabWithoutForeground(context, page);
    await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
  };
  const toggleHover = async (page, selector, pointerOnly = false) => {
    await helper.activateExtensionTabWithoutForeground(context, page);
    await page.locator(selector).scrollIntoViewIfNeeded();
    const box = await page.locator(selector).boundingBox();
    assert.ok(box);
    if (pointerOnly) await page.mouse.move(box.x + 20, box.y + 8);
    else await page.mouse.click(box.x + 20, box.y + 8);
    await page.keyboard.down('Control'); await page.keyboard.up('Control');
  };
  const addForeign = (page, id) => page.evaluate(id => {
    const wrapper = document.createElement('font');
    wrapper.className = 'notranslate immersive-translate-target-wrapper';
    wrapper.lang = 'zh-CN';
    wrapper.innerHTML = '<br><font data-immersive-translate-translation-element-mark="1">动态外部译文</font>';
    document.getElementById(id).append(wrapper);
    window.foreignNodes.push(wrapper);
  }, id);
  const unique = page => page.evaluate(owned => [...document.querySelectorAll('main p, main h1')]
    .every(node => node.querySelectorAll(owned).length <= 1) && !document.querySelector(`${owned} ${owned}`), owned);
  try {
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true,
      headless: false, viewport: {width: 1280, height: 1000}, displayTarget: 'secondary', timeout: args.timeout,
      browserArgs: [`--disable-extensions-except=${args.extensionDir}`, `--load-extension=${args.extensionDir}`,
        '--no-first-run', '--no-default-browser-check']});
    context = session.context;
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    context.on('serviceworker', current => { void installWorker(current).catch(error => report.errors.push(error.message)); });
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: args.timeout});
    await installWorker(worker);
    const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/translation-pages/reddit-duplicates.html'), 'utf8');
    const searchFixture = fs.readFileSync(path.join(root, 'tests/fixtures/translation-pages/reddit-search.html'), 'utf8');
    const profileFixture = fs.readFileSync(path.join(root, 'tests/fixtures/translation-pages/reddit-profile.html'), 'utf8');
    const url = 'https://www.reddit.com/r/MiniMax_AI/comments/fluentread_fixture/';
    const searchUrls = ['https://www.reddit.com/search/?q=language&type=posts',
      'https://www.reddit.com/r/languagelearning/search/?q=reading&type=comments'];
    const profileUrls = ['https://www.reddit.com/user/example/',
      'https://www.reddit.com/user/example/submitted/', 'https://www.reddit.com/user/example/comments/'];
    const fixtureRoute = route => {
      const request = route.request();
      if (request.isNavigationRequest() && request.url() === url) return route.fulfill({status: 200, contentType: 'text/html', body: fixture});
      if (request.isNavigationRequest() && searchUrls.includes(request.url())) return route.fulfill({status: 200, contentType: 'text/html', body: searchFixture});
      if (request.isNavigationRequest() && profileUrls.includes(request.url())) return route.fulfill({status: 200, contentType: 'text/html', body: profileFixture});
      if (/^https?:/.test(request.url())) return route.abort('blockedbyclient');
      return route.continue();
    };
    await context.route('**/*', fixtureRoute);
    popup = await helper.newPageWithoutForeground(context, args.timeout);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await popup.waitForTimeout(600);
    report.config = {service: 'microsoft', from: 'en', to: 'zh-Hans', display: 1, autoTranslate: false,
      hotkey: 'Control', floatingBallHotkey: 'Alt+T', fullPageTranslationMode: 'all', useCache: false,
      enableAIContext: false, enableAIMultiSegment: false, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true};
    await patchConfig(report.config);
    await patchConfig({translationScope: 'content'});
    for (const [index, searchUrl] of (args.profileOnly ? [] : searchUrls).entries()) {
      await worker.evaluate(() => { globalThis.redditRequests = []; });
      const page = await helper.newPageWithoutForeground(context, args.timeout);
      const result = {kind: 'search', scope: 'content', url: searchUrl}; report.cases.push(result);
      const prefix = `search-content-${index}`;
      page.on('pageerror', error => report.errors.push(error.message));
      try {
        await page.goto(searchUrl, {waitUntil: 'domcontentloaded'});
        await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
        await page.waitForTimeout(600);
        const original = await page.locator('main').innerHTML();
        const ids = ['search-title', 'search-comment', 'comment-first', 'comment-second', 'comment-list'];
        const protectedSelectors = ['nav', 'form', 'aside', '#search-heading', '#result-label',
          '#post-metadata', '#comment-metadata', '#protected-code', 'button'];
        const protectedHtml = await page.locator(protectedSelectors.join(',')).evaluateAll(nodes => nodes.map(node => node.outerHTML));
        await page.evaluate(() => {
          window.searchLinks = [...document.querySelectorAll('a')];
          window.searchButtons = [...document.querySelectorAll('button')];
          window.searchClicks = 0;
          window.searchButtons.forEach(button => button.addEventListener('click', () => { window.searchClicks++; }));
        });
        result.hoverCounts = {};
        for (const id of ['search-title', 'search-comment']) {
          result.hoverCounts[id] = [];
          for (const expected of [1, 0, 1]) {
            await toggleHover(page, `#${id}`, true); await waitCount(page, `#${id} ${owned}`, expected);
            result.hoverCounts[id].push(await count(page, `#${id} ${owned}`));
            assert.equal(await count(page, owned), expected);
            assert.equal(page.url(), searchUrl);
          }
          await toggleHover(page, `#${id}`, true); await waitCount(page, owned, 0);
        }
        await toggleFull(page); await waitCount(page, owned, ids.length); await waitCount(page, '.fluent-read-loading', 0);
        for (const id of ids) {
          assert.equal(await count(page, `#${id} ${owned}`), 1, id);
          assert.match(await page.locator(`#${id} ${owned}`).textContent(), /流畅阅读测试译文/);
        }
        await page.evaluate(() => {
          const card = document.createElement('article'); card.id = 'late-result';
          card.setAttribute('data-testid', 'search-sdui-comment-unit');
          card.innerHTML = '<a href="/r/example/comments/late/"><span id="late-title" data-testid="post-title-text">Another useful search result loaded after scrolling</span></a><div id="late-comment" data-testid="search-comment-content">This newly loaded comment describes a helpful reading habit.</div><button>Reply</button>';
          document.querySelector('main').append(card);
        });
        await waitCount(page, owned, ids.length + 2); await waitCount(page, '.fluent-read-loading', 0);
        result.dynamicCount = await count(page, owned);
        await page.locator('#late-result').evaluate(node => node.remove());
        await waitCount(page, owned, ids.length);
        assert.equal(await page.locator(protectedSelectors.join(',')).evaluateAll(nodes => nodes.map(node => node.outerHTML)).then(value => JSON.stringify(value)), JSON.stringify(protectedHtml));
        assert.equal(await page.evaluate(() => window.searchLinks.every(link => link.isConnected) && window.searchButtons.every(button => button.isConnected)), true);
        await page.locator('#post-share').click();
        assert.equal(await page.evaluate(() => window.searchClicks), 1);
        const requests = await worker.evaluate(() => globalThis.redditRequests.flat());
        assert.equal(requests.some(text => /KEEP_ORIGINAL_CODE|Upvote|Share|Reply|Show more|u\/example|r\/languagelearning|hours ago|Search results/.test(text)), false);
        result.requests = requests;
        await page.screenshot({path: path.join(args.artifactsDir, `${prefix}-translated.png`), caret: 'initial'});
        await toggleFull(page); await waitCount(page, owned, 0); await page.waitForTimeout(300);
        assert.equal(await page.locator('main').innerHTML(), original);
        result.restored = true;
        await toggleFull(page); await waitCount(page, owned, ids.length); await waitCount(page, '.fluent-read-loading', 0);
        assert.equal(await page.locator(`${owned} ${owned}`).count(), 0);
        for (const id of ids) assert.equal(await count(page, `#${id} ${owned}`), 1, id);
        await toggleFull(page); await waitCount(page, owned, 0); await page.waitForTimeout(300);
        assert.equal(await page.locator('main').innerHTML(), original);
        assert.equal(page.url(), searchUrl);
        result.passed = true;
        console.log(`${prefix}: hover 1/0/1, full coverage, dynamic results, restore/retranslate passed`);
      } catch (error) {
        result.error = error.stack;
        result.dom = await page.locator('body').innerHTML().catch(() => '');
        await page.screenshot({path: path.join(args.artifactsDir, `${prefix}-failure.png`), caret: 'initial'}).catch(() => {});
        throw error;
      } finally { save(); await page.close(); }
    }
    if (args.liveSearch && !args.profileOnly) {
      await patchConfig({translationScope: 'content'});
      await context.unroute('**/*', fixtureRoute);
      const page = await helper.newPageWithoutForeground(context, args.timeout);
      report.liveSearch = {url: searchUrls[0], provider: report.provider};
      try {
        const response = await page.goto(searchUrls[0], {waitUntil: 'domcontentloaded', timeout: args.timeout});
        report.liveSearch.status = response?.status();
        await page.locator('[data-testid="post-title-text"], [data-testid="search-comment-content"]').first().waitFor({timeout: 12000}).catch(() => {});
        report.liveSearch.targets = await count(page, '[data-testid="post-title-text"], [data-testid="search-comment-content"]');
        if (report.liveSearch.targets) {
          await page.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout: args.timeout});
          await page.waitForTimeout(600);
          await toggleFull(page); await page.waitForSelector(owned, {timeout: args.timeout});
          report.liveSearch.translations = await count(page, owned);
          report.liveSearch.outcome = 'translated-with-deterministic-provider';
        } else {
          report.liveSearch.outcome = 'unverified-no-search-targets';
          report.liveSearch.text = (await page.locator('body').innerText()).slice(0, 2000);
        }
        fs.writeFileSync(path.join(args.artifactsDir, 'live-search.html'), await page.content());
        await page.screenshot({path: path.join(args.artifactsDir, 'live-search.png'), caret: 'initial'});
      } catch (error) {
        report.liveSearch.outcome = report.liveSearch.targets ? 'unverified-translation-error' : 'unverified-site-or-network-error';
        report.liveSearch.error = error.message;
      } finally { save(); await page.close(); await context.route('**/*', fixtureRoute); }
    }
    for (const [index, profileUrl] of (args.searchOnly ? [] : profileUrls).entries()) {
      await patchConfig({translationScope: 'content'});
      await worker.evaluate(() => { globalThis.redditRequests = []; });
      const page = await helper.newPageWithoutForeground(context, args.timeout);
      const result = {kind: 'profile', scope: 'content', url: profileUrl}; report.cases.push(result);
      const prefix = `profile-content-${index}`;
      page.on('pageerror', error => report.errors.push(error.message));
      try {
        await page.goto(profileUrl, {waitUntil: 'domcontentloaded'});
        await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
        await page.waitForTimeout(600);
        const original = await page.locator('main').innerHTML();
        const ids = ['profile-title', 'profile-comment', 'profile-title-second', 'profile-comment-second',
          'profile-comment-third', 'profile-comment-list', 'profile-comment-quote', 'profile-comment-heading',
          'profile-title-bare', 't1_bare-post-rtjson-content', 'ordinary-title', 'ordinary-body', 'ordinary-comment'];
        const protectedSelector = 'nav, aside, .metadata, faceplate-timeago, #profile-heading, code, button';
        const hostProtectedHtml = () => page.locator(protectedSelector).evaluateAll((nodes, owned) =>
          nodes.filter(node => !node.closest(owned)).map(node => node.outerHTML), owned);
        const protectedHtml = await hostProtectedHtml();
        await page.evaluate(({protectedSelector, owned}) => {
          window.profileLinks = [...document.querySelectorAll('a')];
          window.profileButtons = [...document.querySelectorAll('button')];
          window.profileProtectedNodes = [...document.querySelectorAll(protectedSelector)].filter(node => !node.closest(owned));
          window.profileClicks = 0;
          window.profileLinks.forEach(link => link.addEventListener('click', event => { event.preventDefault(); window.profileClicks++; }));
          window.profileButtons.forEach(button => button.addEventListener('click', () => { window.profileClicks++; }));
        }, {protectedSelector, owned});
        const checkHostControls = async expectedClicks => {
          assert.equal(await page.evaluate(() => window.profileLinks.every(link => link.isConnected) && window.profileButtons.every(button => button.isConnected)), true);
          assert.equal(await page.evaluate(({protectedSelector, owned}) => {
            const nodes = [...document.querySelectorAll(protectedSelector)].filter(node => !node.closest(owned));
            return nodes.length === window.profileProtectedNodes.length && nodes.every((node, index) => node === window.profileProtectedNodes[index]);
          }, {protectedSelector, owned}), true);
          assert.deepEqual(await hostProtectedHtml(), protectedHtml);
          await page.locator('#profile-source-link').click();
          await page.locator('#profile-share').click();
          assert.equal(await page.evaluate(() => window.profileClicks), expectedClicks);
          assert.equal(page.url(), profileUrl);
        };
        result.hoverCounts = {};
        for (const id of ['profile-title', 'profile-comment']) {
          result.hoverCounts[id] = [];
          for (const expected of [1, 0, 1]) {
            await toggleHover(page, `#${id}`, true); await waitCount(page, `#${id} ${owned}`, expected);
            result.hoverCounts[id].push(await count(page, `#${id} ${owned}`));
            assert.equal(await count(page, owned), expected);
            assert.equal(page.url(), profileUrl);
          }
          await toggleHover(page, `#${id}`, true); await waitCount(page, owned, 0);
        }
        await toggleFull(page); await waitCount(page, owned, ids.length); await waitCount(page, '.fluent-read-loading', 0);
        for (const id of ids) {
          assert.equal(await count(page, `#${id} ${owned}`), 1, id);
          assert.match(await page.locator(`#${id} ${owned}`).textContent(), /流畅阅读测试译文/);
        }
        await page.evaluate(() => {
          const card = document.createElement('shreddit-profile-comment'); card.id = 'late-profile-card';
          card.innerHTML = '<h2 class="inline-block m-0"><a class="rpl" href="/r/languagelearning/comments/late/" id="late-profile-title">Another discussion loaded while browsing this profile</a></h2><div class="md" id="t1_late-post-rtjson-content"><p id="late-profile-comment">This newly loaded comment recommends keeping a short reading journal.</p></div><div class="metadata"><a href="/user/example/">u/example</a><faceplate-timeago>One hour ago</faceplate-timeago></div><button>Reply</button>';
          document.querySelector('main').append(card);
        });
        await waitCount(page, owned, ids.length + 2); await waitCount(page, '.fluent-read-loading', 0);
        for (const id of ['late-profile-title', 'late-profile-comment']) assert.equal(await count(page, `#${id} ${owned}`), 1, id);
        result.dynamicCount = await count(page, owned);
        await page.locator('#late-profile-card').evaluate(node => node.remove());
        await waitCount(page, owned, ids.length);
        await checkHostControls(2);
        const requests = await worker.evaluate(() => globalThis.redditRequests.flat());
        assert.equal(requests.some(text => /KEEP_ORIGINAL_CODE|Upvote|Share|Reply|Show more|u\/example|r\/languagelearning|hours? ago|Reddit Home|Open menu|Example reader|About this user|Browse more community/.test(text)), false);
        result.requests = requests;
        await page.screenshot({path: path.join(args.artifactsDir, `${prefix}-translated.png`), caret: 'initial'});
        await toggleFull(page); await waitCount(page, owned, 0); await page.waitForTimeout(300);
        assert.equal(await page.locator('main').innerHTML(), original);
        await checkHostControls(4);
        result.restored = true;
        await toggleFull(page); await waitCount(page, owned, ids.length); await waitCount(page, '.fluent-read-loading', 0);
        assert.equal(await count(page, `${owned} ${owned}`), 0);
        for (const id of ids) assert.equal(await count(page, `#${id} ${owned}`), 1, id);
        await checkHostControls(6);
        await toggleFull(page); await waitCount(page, owned, 0); await page.waitForTimeout(300);
        assert.equal(await page.locator('main').innerHTML(), original);
        await checkHostControls(8);
        result.passed = true;
        console.log(`${prefix}: hover 1/0/1, full coverage, dynamic cards, restore/retranslate and host controls passed`);
      } catch (error) {
        result.error = error.stack;
        result.dom = await page.locator('body').innerHTML().catch(() => '');
        await page.screenshot({path: path.join(args.artifactsDir, `${prefix}-failure.png`), caret: 'initial'}).catch(() => {});
        throw error;
      } finally { save(); await page.close(); }
    }
    for (const scope of args.searchOnly || args.profileOnly ? [] : ['content', 'all']) {
      await patchConfig({translationScope: scope});
      await worker.evaluate(() => { globalThis.redditRequests = []; });
      const page = await helper.newPageWithoutForeground(context, args.timeout);
      const result = {scope}; report.cases.push(result);
      page.on('pageerror', error => report.errors.push(error.message));
      try {
        await page.goto(url, {waitUntil: 'domcontentloaded'});
        await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
        await page.waitForTimeout(600);
        await page.evaluate(foreign => { window.foreignNodes = [...document.querySelectorAll(foreign)]; }, foreign);
        const original = await page.locator('main').innerHTML();
        const originalReply = await page.locator('#reply').innerHTML();
        result.hoverCounts = [];
        for (const expected of [1, 0, 1]) {
          await toggleHover(page, '#clean'); await waitCount(page, `#clean ${owned}`, expected);
          result.hoverCounts.push(await count(page, `#clean ${owned}`));
          assert.equal(await count(page, `#existing ${owned}`), 0);
        }
        await toggleHover(page, '#clean'); await waitCount(page, owned, 0);
        const requestsBeforeForeignHover = await worker.evaluate(() => globalThis.redditRequests.length);
        await toggleHover(page, '#existing'); await page.waitForTimeout(1000);
        assert.equal(await count(page, owned), 0);
        assert.equal(await worker.evaluate(() => globalThis.redditRequests.length), requestsBeforeForeignHover);
        assert.equal(await page.locator('main').innerHTML(), original);
        await toggleFull(page);
        await page.waitForSelector('#during .fluent-read-loading', {state: 'attached'});
        await addForeign(page, 'during');
        await waitCount(page, `#clean ${owned}`, 1); await waitCount(page, `#after ${owned}`, 1);
        await waitCount(page, '.fluent-read-loading', 0); await page.waitForTimeout(900);
        for (const id of ['post-title-fixture', 'existing', 'during']) assert.equal(await count(page, `#${id} ${owned}`), 0);
        const requestsBeforeLate = await worker.evaluate(() => globalThis.redditRequests.length);
        await addForeign(page, 'after'); await waitCount(page, `#after ${owned}`, 0);
        await page.waitForTimeout(900);
        assert.equal(await worker.evaluate(() => globalThis.redditRequests.length), requestsBeforeLate);
        assert.ok(await unique(page));
        assert.equal(await page.evaluate(() => window.foreignNodes.every(node => node.isConnected)), true);
        assert.equal(await page.locator(`${owned}`).evaluateAll(nodes => nodes.some(node => /其他翻译器|动态外部译文/.test(node.textContent))), false);
        assert.ok(await page.locator(`#terms ${owned}`).textContent().then(text => text.includes('MiniMax') && text.includes('api_key')));
        if (scope === 'content') assert.equal(await page.locator('#reply').textContent(), 'Reply');
        const requests = await worker.evaluate(() => globalThis.redditRequests.flat());
        assert.equal(requests.some(text => /A new model|The model uses sparse|其他翻译器|动态外部译文/.test(text)), false);
        result.beforeRemoval = await count(page, owned);
        await page.locator(`#existing ${foreign}`).evaluate(node => node.remove());
        await waitCount(page, `#existing ${owned}`, 1);
        result.foreignRemovalRetranslates = true;
        await page.screenshot({path: path.join(args.artifactsDir, `${scope}-translated.png`)});
        const sourceWithForeign = await page.locator('main').evaluate((main, {owned, originalReply}) => {
          const clone = main.cloneNode(true);
          clone.querySelectorAll(owned).forEach(node => node.remove());
          // 全部节点范围的按钮使用原位文本槽，恢复预期必须来自翻译前的原始按钮。
          clone.querySelector('#reply').innerHTML = originalReply;
          return clone.innerHTML;
        }, {owned, originalReply});
        await toggleFull(page); await waitCount(page, owned, 0); await page.waitForTimeout(300);
        assert.equal(await page.locator('main').innerHTML(), sourceWithForeign);
        await toggleFull(page); await waitCount(page, `#clean ${owned}`, 1); await waitCount(page, '.fluent-read-loading', 0);
        assert.ok(await unique(page));
        for (const id of ['post-title-fixture', 'during', 'after']) assert.equal(await count(page, `#${id} ${owned}`), 0);
        assert.equal(page.url(), url);
        result.passed = true;
        result.requests = await worker.evaluate(() => globalThis.redditRequests);
        await page.screenshot({path: path.join(args.artifactsDir, `${scope}-retranslated.png`)});
        console.log(`${scope}: hover 1/0/1, no overlap before/during/after requests, restore/retranslate passed`);
      } catch (error) {
        result.error = error.stack;
        result.dom = await page.locator('main').innerHTML().catch(() => '');
        await page.screenshot({path: path.join(args.artifactsDir, `${scope}-failure.png`)}).catch(() => {});
        throw error;
      } finally { save(); await page.close(); }
    }
    assert.deepEqual(report.errors, []); report.passed = true;
  } finally {
    save(); if (session) await session.close();
    fs.rmSync(profileDir, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  }
}
main().catch(error => {process.stderr.write(`${error.stack}\n`); process.exitCode = 1;});

#!/usr/bin/env node
'use strict';

/**
 * @file scripts/testing/run-target-language-reading-test.cjs
 * 阅读语言预检专项：复用仓库焦点安全启动、临时 profile 与真实 CDP 快捷键；
 * 在生产扩展中验证简体、繁体、日文的全文/悬浮、技术短句、混合正文、共享汉字、
 * 错误页面 lang、恢复重翻、动态改写与切换目标。只调用本地确定性服务，所有请求先计数。
 * 这不是留出语料调参工具，运行时例子与冻结的阅读留出 JSON 分开。
 * --cases 可筛选 same-target/hover/full/dynamic/target-switch；markdown-boundary/control-lifecycle 检查链接后的正文和动态按钮。
 * 可选 native-evidence 使用真实 i18n 检测长英文，不模拟其结果。
 * 原生结果满足生产采纳契约才断言零请求；否则验证继续翻译并明确记为降级，不能把 API 缺失当作补充能力命中。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const argument = (name, fallback) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const defaultCases = ['same-target', 'hover', 'full', 'dynamic', 'target-switch'];
const availableCases = [...defaultCases, 'native-evidence', 'markdown-boundary', 'control-lifecycle'];
const markdownSamples = [
  'This is a link to [read the manual](https://example.com)请保存设置后重启浏览器。',
  'This is a link to [read the manual](example.com/guide)请保存设置后重启浏览器。',
  'This is a link to [read the manual](https://example.com/a_(b))请保存设置后重启浏览器。',
];
const nativeEnglish = 'Bright sunlight warmed the narrow alley beside the quiet bakery while distant bells announced another ordinary morning.';
const nativeControl = '这段中文用于确认英文目标下的翻译通道仍然工作，原文中的完整说明需要翻译。';
function matchesSubset(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    return actual && typeof actual === 'object' && Object.entries(expected).every(([key, value]) => matchesSubset(actual[key], value));
  }
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => matchesSubset(actual[index], value));
  return actual === expected;
}
const foreign = 'The west entrance will remain closed until the maintenance crew has finished its work.';
const dynamicForeign = 'Please keep the paper ticket until you have collected the parcel from the counter.';
const mixed = '请一起阅读这句原文：The stairway is closed until Monday.';
const mixedHant = '請一起閱讀這句原文：The stairway is closed until Monday.';
const scenarios = {
  'zh-Hans': {pageLang: 'ja', short: '请先关闭这台设备。', technical: '这个设置已经保存到 NimbusTray 8.6 的配置文件。', mixed, ambiguous: '株式会社若葉商事'},
  'zh-Hant': {pageLang: 'en', short: '請先關閉這台設備。', technical: '這個設定已經儲存到 BirchShelf 9.3 的設定檔。', mixed: mixedHant, ambiguous: '株式会社若葉商事'},
  ja: {pageLang: 'zh-CN', short: '窓を閉めてから、明かりを消してください。', technical: 'MapleBoard 7.5 の設定は保存されています。', mixed: 'この英語も読んでください：The stairway is closed until Monday.', ambiguous: '株式会社若葉商事'},
};
const translated = {
  'zh-Hans': '这段内容已经完成翻译，可以继续阅读。',
  'zh-Hant': '這段內容已經完成翻譯，可以繼續閱讀。',
  ja: 'この文章は翻訳済みです。続けてお読みください。',
  en: 'This passage has been translated and is ready to read.',
};
const escapeHtml = text => text.replace(/[&<>"]/gu, value => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[value]);
function renderPage(target) {
  const item = scenarios[target];
  assert(item, '未知测试目标');
  const entries = {'same-short': item.short, 'same-tech': item.technical, foreign, mixed: item.mixed, ambiguous: item.ambiguous, dynamic: item.short};
  return '<!doctype html><html lang="' + item.pageLang + '"><meta charset="utf-8"><title>Reading decision fixture</title>'
    + '<style>body{font:19px/1.8 system-ui;margin:30px}main{max-width:900px}p{margin:20px 0}</style><main>'
    + Object.entries(entries).map(([id, text]) => '<p id="' + id + '">' + escapeHtml(text) + '</p>').join('') + '</main></html>';
}
function slotsOf(source) {
  const slots = [...source.matchAll(/___FLUENTREAD_([a-z0-9_-]+)_(\d+)_BEGIN___([\s\S]*?)___FLUENTREAD_\1_\2_END___/gu)].map(match => match[3]);
  return slots.length ? slots : [source];
}
function replyFor(source, target) {
  assert(translated[target], '请求目标必须属于本次测试');
  const slots = slotsOf(source);
  if (slots.length === 1 && slots[0] === source) return translated[target];
  return source.replace(/(___FLUENTREAD_([a-z0-9_-]+)_(\d+)_BEGIN___)([\s\S]*?)(___FLUENTREAD_\2_\3_END___)/gu,
    (_match, begin, _nonce, _index, _text, end) => begin + translated[target] + end);
}
function targetFromPromptName(value) {
  // templates.ts 的 fillPromptTemplate：中文为名称加规范代码，其余目标保留规范代码。
  const names = {'Simplified Chinese (zh-Hans)': 'zh-Hans', 'Traditional Chinese (zh-Hant)': 'zh-Hant', ja: 'ja', en: 'en'};
  const target = names[value.trim()];
  assert(target, '提示词目标必须符合实际 renderer 契约：' + value);
  return target;
}
async function getNativeCaseQualification() {
  const root = path.resolve(__dirname, '../..');
  const {createServer} = await import('vite');
  const server = await createServer({root, configFile: false, logLevel: 'silent', appType: 'custom',
    server: {middlewareMode: true, hmr: false, watch: null}, resolve: {alias: {'@': root}},
    optimizeDeps: {noDiscovery: true, include: []}});
  try {
    const {getSupplementalLanguageCandidate, acceptSupplementalLanguage} = await server.ssrLoadModule('/src/core/language/supplement.ts');
    const {shouldSkipTranslationForTarget} = await server.ssrLoadModule('/src/core/language/detect.ts');
    return {text: nativeEnglish, candidate: getSupplementalLanguageCandidate(nativeEnglish),
      pureSkip: shouldSkipTranslationForTarget(nativeEnglish, 'en'),
      acceptsNativeResult: result => acceptSupplementalLanguage('en', result) === 'en',
      sourceHashes: Object.fromEntries(['src/core/language/identify.ts', 'src/core/language/supplement.ts'].map(file =>
        [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]))};
  } finally {await server.close();}
}
async function readActualNative(text) {
  const available = typeof globalThis.chrome?.i18n?.detectLanguage === 'function';
  const value = {available, runtimeId: globalThis.chrome?.runtime?.id || null,
    languageDetectorApi: typeof globalThis.LanguageDetector, userAgent: navigator.userAgent};
  if (available) {
    let timer;
    try {value.raw = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error('actual i18n probe timed out after 2500ms')), 2500);
      chrome.i18n.detectLanguage(text, result => {clearTimeout(timer); resolve(result);});
    });}
    catch (error) {value.error = String(error);}
    finally {clearTimeout(timer);}
  }
  return value;
}
async function readContentNative(context, page, extensionId) {
  const session = await context.newCDPSession(page), worlds = new Map();
  session.on('Runtime.executionContextCreated', ({context: world}) => worlds.set(world.id, world));
  try {
    await session.send('Runtime.enable');
    for (let attempt = 0; attempt < 10; attempt++) {
      for (const world of worlds.values()) {
        try {
          const identity = await session.send('Runtime.evaluate', {contextId: world.id,
            expression: 'globalThis.chrome?.runtime?.id || null', returnByValue: true});
          if (identity.result.value !== extensionId) continue;
          const observed = await session.send('Runtime.evaluate', {contextId: world.id,
            expression: '(' + readActualNative.toString() + ')(' + JSON.stringify(nativeEnglish) + ')',
            awaitPromise: true, returnByValue: true});
          if (observed.exceptionDetails) return {contextFound: true, available: false, error: 'content probe exception', exception: observed.exceptionDetails};
          return {...observed.result.value, contextFound: true, contextId: world.id, contextOrigin: world.origin, contextName: world.name};
        } catch { /* 页面上下文可能在注入时换代，继续查找当前扩展的隔离世界。 */ }
      }
      await wait(100);
    }
    return {contextFound: false, available: null, probeIncomplete: true,
      worlds: [...worlds.values()].map(world => ({id: world.id, origin: world.origin, name: world.name}))};
  } finally {await session.detach();}
}
async function startFixture() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
    try {
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString('utf8');
        const entry = {raw, receivedAt: Date.now()};
        requests.push(entry); // 包括后续解析或校验失败的请求，不能把无效泄漏隐藏掉。
        const body = JSON.parse(raw);
        const prompt = body.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
        const source = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1];
        const targetName = /TARGET_BEGIN([\s\S]*?)TARGET_END/u.exec(prompt)?.[1] || '';
        const target = targetFromPromptName(targetName);
        assert.equal(typeof source, 'string', '模板必须包含原文');
        Object.assign(entry, {source, target, targetName, slots: slotsOf(source)});
        const text = replyFor(source, target);
        response.writeHead(200, {'content-type': 'application/json'});
        response.end(JSON.stringify({id: 'reading-fixture', object: 'chat.completion', created: 1,
          model: 'reading-fixture', choices: [{index: 0, message: {role: 'assistant', content: text}, finish_reason: 'stop'}],
          usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20}}));
        return;
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/favicon.ico') {response.writeHead(204); response.end(); return;}
      if (url.pathname === '/markdown' || url.pathname === '/controls') {
        response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
        const body = url.pathname === '/markdown'
          ? markdownSamples.map((text, index) => '<p id="sample-' + index + '">' + escapeHtml(text) + '</p>').join('')
          : '<p id="anchor">The original article remains available while the controls change.</p>'
            + '<form><input id="action" type="button" value="Save draft"><input id="submit" type="submit" value="Publish draft">'
            + '<input id="private" type="text" value="Private user input"></form>';
        response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Reading lifecycle fixture</title>'
          + '<style>body{font:19px/1.8 system-ui;margin:30px}main{max-width:1000px}input{font:18px system-ui;margin:12px;padding:12px}</style>'
          + '<main>' + body + '</main></html>'); return;
      }
      if (url.pathname === '/native') {
        response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
        response.end('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>Native evidence fixture</title>'
          + '<main style="font:20px/1.8 system-ui;margin:40px"><p id="native">' + escapeHtml(nativeEnglish)
          + '</p><p id="native-control">' + escapeHtml(nativeControl) + '</p></main></html>'); return;
      }
      if (url.pathname === '/article') {
        response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
        response.end(renderPage(url.searchParams.get('target'))); return;
      }
      response.writeHead(404); response.end();
    } catch (error) {
      response.writeHead(400, {'content-type': 'application/json'}); response.end(JSON.stringify({error: String(error)}));
    }
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return {url: 'http://127.0.0.1:' + server.address().port, requests, close: () => new Promise(resolve => server.close(resolve))};
}
async function cleanupOwnedSession({launched, fixture, profileDir, report}) {
  const cleanup = {profileDir, handleCreated: Boolean(launched), ownedBrowserClosed: false, deleted: false, errors: []};
  report.profileCleanup = cleanup;
  if (launched) {
    try {await launched.close(); cleanup.ownedBrowserClosed = true;}
    catch (error) {cleanup.errors.push('browser close: ' + String(error));}
  } else cleanup.retainedReason = 'launch failed without an owned handle; browser shutdown cannot be proven';
  try {await fixture.close();}
  catch (error) {cleanup.errors.push('fixture close: ' + String(error));}
  if (cleanup.ownedBrowserClosed) {
    try {fs.rmSync(profileDir, {recursive: true, force: true}); cleanup.deleted = true;}
    catch (error) {cleanup.errors.push('profile cleanup: ' + String(error));}
  } else cleanup.retainedReason ||= 'owned browser close failed; retain the profile for recovery';
  if (cleanup.errors.length) {report.ok = false; report.cleanupError = cleanup.errors.join('; ');}
}
async function main() {
  const targets = argument('targets', 'zh-Hans,zh-Hant,ja').split(',');
  assert(targets.length && targets.every(target => scenarios[target]), '--targets 只接受 zh-Hans,zh-Hant,ja');
  const selectedCases = [...new Set(argument('cases', defaultCases.join(',')).split(',').filter(Boolean))];
  assert(selectedCases.length && selectedCases.every(name => availableCases.includes(name)), '--cases 只接受 ' + availableCases.join(','));
  if (process.argv.includes('--list')) {console.log(JSON.stringify({targets, selectedCases, availableCases})); return;}
  const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
  const packages = argument('playwright-root');
  assert(packages, '必须提供 --playwright-root');
  const helperPath = path.resolve(argument('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs')));
  const {chromium} = require(path.join(packages, 'playwright'));
  const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(helperPath);
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(typeof manifest.key, 'string', '生产扩展必须有公开身份 key');
  const extensionId = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/gu, character => String.fromCharCode(97 + parseInt(character, 16)));
  const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-reading-language'));
  fs.mkdirSync(artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-reading-language-'));
  const fixture = await startFixture();
  const report = {ok: false, targets, selectedCases, extensionDir, profileDir, profileMode: 'new-temporary-profile',
    buildHashes: Object.fromEntries(['manifest.json', 'content-scripts/content.js'].map(file =>
      [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir, file))).digest('hex')])),
    evidenceBoundary: 'Production extension, local HTML and deterministic loopback responses; this verifies decision and request paths, not external provider translation quality.',
    cases: [], consoleErrors: [], screenshots: []};
  let launched, activePage, acceptsNativeResult;
  const screenshot = async (page, name) => {
    const file = path.join(artifactsDir, name + '.png');
    await page.screenshot({path: file, animations: 'disabled', caret: 'initial'}); report.screenshots.push(file);
  };
  try {
    if (selectedCases.includes('native-evidence')) {
      const {acceptsNativeResult: accepts, ...qualification} = await getNativeCaseQualification();
      acceptsNativeResult = accepts;
      report.nativeEvidence = {qualification, target: 'en', status: 'running',
        boundary: 'Node qualification uses actual pure APIs; raw browser results below come from the actual extension i18n API, with no mocked native result.'};
      assert.equal(report.nativeEvidence.qualification.candidate, 'en', '长英文必须符合补充资格');
      assert.equal(report.nativeEvidence.qualification.pureSkip, false, '纯规则已跳过时不能声称验证了原生补充路径');
    }
    launched = await launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: argument('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      background: true, headless: false, displayTarget: argument('display', 'secondary'), viewport: {width: 1400, height: 960},
      browserArgs: ['--disable-extensions-except=' + extensionDir, '--load-extension=' + extensionDir, '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');
    assert.equal(report.focusPolicy, 'launchservices-no-foreground');
    const context = launched.context;
    const createPage = async url => {
      const page = await newPageWithoutForeground(context, 30000);
      page.setDefaultTimeout(20000);
      page.on('pageerror', error => report.consoleErrors.push(String(error)));
      page.on('console', message => {
        if (message.type() === 'error') report.consoleErrors.push({message: message.text(), location: message.location()});
      });
      await page.goto(url, {waitUntil: 'domcontentloaded'}); activePage = page; return page;
    };
    const setup = await createPage('chrome-extension://' + extensionId + '/icon/128.png');
    const identity = await setup.evaluate(() => ({manifest: chrome.runtime.getManifest(), name: chrome.i18n.getMessage('extensionName')}));
    assert.equal(identity.manifest.version, manifest.version);
    assert.equal(identity.manifest.name, manifest.name === '__MSG_extensionName__' ? identity.name : manifest.name);
    const readConfig = () => setup.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      if (!result?.success) throw Error(result?.error || '无法读取配置');
      return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
    });
    const patchConfig = async patch => {
      const current = await readConfig();
      const initial = Object.hasOwn(patch, 'token');
      if (initial) assert.equal(current.customOpenAIProviders?.length, 0, '合成凭据只能写入空白临时 profile');
      const result = await setup.evaluate(async ({patch, current, initial}) => chrome.runtime.sendMessage({
        type: 'persistConfig', mode: initial ? 'replace' : 'patch', config: initial ? {...current, ...patch} : patch,
        expected: Object.fromEntries(Object.keys(patch).map(key => [key, current[key]])),
        baseRevision: initial ? current.__fluentConfigRevision : undefined, clientId: 'reading-fixture-' + crypto.randomUUID(), sequence: 1,
      }), {patch, current, initial});
      assert.equal(result?.success, true, result?.error);
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const stored = await readConfig();
        if (Object.keys(patch).filter(key => key !== 'token').every(key => matchesSubset(stored[key], patch[key]))) return;
        await wait(50);
      }
      throw Error('配置持久化未完成');
    };
    const service = 'custom:reading-language-fixture';
    await patchConfig({on: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, service, hoverTranslationService: service,
      from: 'auto', to: 'zh-Hans', display: 1, useCache: false, autoTranslate: false, excludedLanguages: [],
      customOpenAIProviders: [{id: service, name: '阅读预检测试服务', endpoint: fixture.url + '/v1/chat/completions', models: ['reading-fixture']}],
      token: {[service]: 'synthetic-local-fixture-not-a-secret'}, model: {[service]: 'reading-fixture'},
      user_role: {[service]: 'TARGET_BEGIN{{to}}TARGET_END\nSOURCE_BEGIN{{origin}}SOURCE_END'},
      enableAIContext: false, enableAIMultiSegment: false, glossaryEnabled: false, pageTitleTranslationEnabled: false,
      hotkey: 'Control', floatingBallHotkey: 'Alt+T', fullPageTranslationMode: 'all', mouseHoverTranslationDelay: 0,
      selectionTranslatorMode: 'disabled', disableSelectionTranslator: true, animations: false});
    for (const target of selectedCases.some(name => defaultCases.includes(name)) ? targets : []) {
      await patchConfig({from: 'auto', to: target, excludedLanguages: [], useCache: false});
      const page = await createPage(fixture.url + '/article?target=' + encodeURIComponent(target));
      const item = scenarios[target], start = fixture.requests.length;
      const result = {target, pageLang: item.pageLang, status: 'running', fullCounts: [], hoverCounts: []};
      report.cases.push(result);
      await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
      assert.equal(await page.locator('html').getAttribute('lang'), item.pageLang);
      const wrappers = id => page.locator('#' + id + ' .fluent-read-bilingual-content').count();
      const sourceText = async id => page.locator('#' + id).evaluate(element => {
        const copy = element.cloneNode(true);
        copy.querySelectorAll('[data-fr-translation-owned="true"],.fluent-read-bilingual-content').forEach(node => node.remove());
        return copy.textContent;
      });
      const hover = async id => {
        await activateExtensionTabWithoutForeground(context, page, 30000);
        await page.locator('#' + id).click({position: {x: 4, y: 4}});
        await page.locator('#' + id).hover({position: {x: 4, y: 4}});
        await page.keyboard.down('Control'); await page.keyboard.up('Control');
      };
      const full = async () => {
        await activateExtensionTabWithoutForeground(context, page, 30000);
        await page.locator('main').click({position: {x: 2, y: 2}});
        await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
      };
      const sameUntouched = async () => {
        for (const [id, value] of [['same-short', item.short], ['same-tech', item.technical]]) {
          assert.equal(await wrappers(id), 0, id + ' 不应插入译文');
          assert.equal(await sourceText(id), value);
        }
        const leaked = fixture.requests.slice(start).filter(request => request.source?.includes(item.short) || request.source?.includes(item.technical));
        assert.deepEqual(leaked, [], '同目标短句/技术句不能进入端点');
        assert.equal(await page.locator('.fluent-read-bilingual-content .fluent-read-bilingual-content').count(), 0);
      };
      if (selectedCases.includes('same-target')) {
        for (const id of ['same-short', 'same-tech']) {await hover(id); await wait(500);}
        assert.equal(fixture.requests.length, start, '同目标悬浮必须零 HTTP 请求');
        await sameUntouched(); result.sameTargetHoverRequests = 0;
      }
      if (selectedCases.includes('hover')) {
        for (const expected of [1, 0, 1, 0]) {
          await hover('foreign');
          await page.waitForFunction(expected => document.querySelectorAll('#foreign .fluent-read-bilingual-content').length === expected, expected);
          result.hoverCounts.push(await wrappers('foreign')); await sameUntouched();
        }
      }
      if (selectedCases.includes('full') || selectedCases.includes('dynamic')) {
        const expectedCounts = selectedCases.includes('full') ? [1, 0, 1] : [1];
        result.fullSessionStartedForDynamic = !selectedCases.includes('full');
        for (const expected of expectedCounts) {
          await full();
          await page.waitForFunction(expected => ['foreign', 'mixed', 'ambiguous'].every(id =>
            document.querySelectorAll('#' + id + ' .fluent-read-bilingual-content').length === expected), expected);
          await wait(300); result.fullCounts.push(await wrappers('foreign')); await sameUntouched();
        }
        assert(fixture.requests.slice(start).some(request => request.source?.includes(item.mixed)), '真正混合正文必须提交');
        assert(fixture.requests.slice(start).some(request => request.source?.includes(item.ambiguous)), '共享汉字歧义必须保留请求');
        if (selectedCases.includes('dynamic')) {
          const beforeDynamic = fixture.requests.length;
          await page.locator('#dynamic').evaluate((element, text) => {element.textContent = text;}, dynamicForeign);
          await page.locator('#dynamic .fluent-read-bilingual-content').waitFor({state: 'visible'});
          assert(fixture.requests.slice(beforeDynamic).some(request => request.source?.includes(dynamicForeign)));
          const afterDynamic = fixture.requests.length;
          await page.locator('#dynamic').evaluate((element, text) => {element.textContent = text;}, item.short);
          await wait(600);
          assert.equal(await wrappers('dynamic'), 0);
          assert.equal(fixture.requests.length, afterDynamic, '动态改回同目标后不应再请求');
          result.dynamicRedetection = true;
        }
        await screenshot(page, target + '-full');
        fs.writeFileSync(path.join(artifactsDir, target + '-full.html'), await page.content());
        await full(); await page.waitForFunction(() => document.querySelectorAll('.fluent-read-bilingual-content').length === 0);
        assert.equal(await sourceText('same-short'), item.short); result.restored = true;
      }
      if (selectedCases.includes('target-switch')) {
        // 单独筛选此 case 时也先建立真实跳过结论，不能只测新目标的首次翻译。
        if (!selectedCases.some(name => ['same-target', 'full', 'dynamic'].includes(name))) {
          const beforeProbe = fixture.requests.length;
          await hover('same-short'); await wait(500); await sameUntouched();
          assert.equal(fixture.requests.length, beforeProbe);
        }
        await patchConfig({to: 'en'});
        const beforeSwitch = fixture.requests.length;
        await full(); await page.locator('#same-short .fluent-read-bilingual-content').waitFor({state: 'visible'});
        await wait(500);
        assert.equal(await wrappers('foreign'), 0, '英文目标不能请求英文正文');
        assert(fixture.requests.slice(beforeSwitch).some(request => request.source?.includes(item.short)), '改目标后原跳过结论必须失效');
        assert(!fixture.requests.slice(beforeSwitch).some(request => request.source?.includes(foreign)));
        result.targetSwitch = true;
        await full(); await page.waitForFunction(() => document.querySelectorAll('.fluent-read-bilingual-content').length === 0);
        assert.equal(await page.locator('#same-short').textContent(), item.short);
      }
      result.requestCount = fixture.requests.length - start; result.status = 'passed';
      await screenshot(page, target + '-restored'); await page.close();
    }
    for (const name of ['markdown-boundary', 'control-lifecycle'].filter(name => selectedCases.includes(name))) {
      const target = name === 'markdown-boundary' ? 'en' : 'zh-Hans';
      await patchConfig({from: 'auto', to: target, excludedLanguages: [], useCache: false});
      const page = await createPage(fixture.url + (name === 'markdown-boundary' ? '/markdown' : '/controls'));
      await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
      const start = fixture.requests.length, result = {name, target, status: 'running', fullCounts: []};
      report.cases.push(result);
      const toggle = async () => {
        await activateExtensionTabWithoutForeground(context, page, 30000);
        await page.locator('main').click({position: {x: 2, y: 2}});
        await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
      };
      if (name === 'markdown-boundary') {
        for (const expected of [1, 0, 1]) {
          await toggle();
          await page.waitForFunction(expected => [0, 1, 2].every(index =>
            document.querySelectorAll('#sample-' + index + ' .fluent-read-bilingual-content').length === expected), expected);
          result.fullCounts.push(await page.locator('#sample-0 .fluent-read-bilingual-content').count());
        }
        for (const source of markdownSamples) assert(fixture.requests.slice(start).some(entry => entry.source === source),
          '识别副本不得改写发给服务的原文，紧随链接的中文必须参与翻译判断');
        assert.equal(await page.locator('.fluent-read-bilingual-content .fluent-read-bilingual-content').count(), 0);
        await screenshot(page, name + '-translated');
        await toggle();
        await page.waitForFunction(() => document.querySelectorAll('.fluent-read-bilingual-content').length === 0);
        for (let index = 0; index < markdownSamples.length; index++) assert.equal(await page.locator('#sample-' + index).textContent(), markdownSamples[index]);
      } else {
        const valueIs = (id, value) => page.waitForFunction(({id, value}) => document.getElementById(id).value === value, {id, value});
        await toggle();
        await valueIs('action', translated[target]); await valueIs('submit', translated[target]);
        result.fullCounts.push(1);
        await page.locator('#action').evaluate(element => element.setAttribute('value', 'Review changes'));
        await valueIs('action', translated[target]);
        assert(fixture.requests.slice(start).some(entry => entry.source === 'Review changes'), '动态 value 必须重新翻译');
        await page.locator('#submit').evaluate(element => element.setAttribute('name', 'commit'));
        await valueIs('submit', 'Publish draft');
        result.submittedValue = await page.locator('form').evaluate(form => new FormData(form, document.getElementById('submit')).get('commit'));
        assert.equal(result.submittedValue, 'Publish draft', '命名提交按钮必须恢复原始提交值');
        await page.locator('#submit').evaluate(element => element.removeAttribute('name'));
        await valueIs('submit', translated[target]);
        await page.locator('#action').evaluate(element => element.setAttribute('type', 'text'));
        await valueIs('action', 'Review changes');
        await page.locator('#action').evaluate(element => element.setAttribute('type', 'button'));
        await valueIs('action', translated[target]);
        assert.equal(await page.locator('#private').inputValue(), 'Private user input');
        assert(!fixture.requests.slice(start).some(entry => entry.source?.includes('Private user input')), '用户输入不能发送给翻译服务');
        await screenshot(page, name + '-translated');
        for (const expected of [0, 1, 0]) {
          await toggle();
          await valueIs('action', expected ? translated[target] : 'Review changes');
          await valueIs('submit', expected ? translated[target] : 'Publish draft');
          result.fullCounts.push(expected);
        }
      }
      result.restored = true; result.requestCount = fixture.requests.length - start; result.status = 'passed';
      await screenshot(page, name + '-restored');
      fs.writeFileSync(path.join(artifactsDir, name + '.html'), await page.content());
      await page.close();
    }
    if (selectedCases.includes('native-evidence')) {
      await patchConfig({from: 'auto', to: 'en', excludedLanguages: [], useCache: false});
      const page = await createPage(fixture.url + '/native');
      await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
      const result = report.nativeEvidence;
      result.extensionNative = await setup.evaluate(readActualNative, nativeEnglish);
      result.contentNative = await readContentNative(context, page, extensionId);
      result.capabilityDifference = result.contentNative.contextFound
        ? result.extensionNative.available !== result.contentNative.available : null;
      result.rawResultDifference = result.contentNative.contextFound
        ? JSON.stringify(result.extensionNative.raw) !== JSON.stringify(result.contentNative.raw) : null;
      const nativeAccepted = result.contentNative.contextFound && acceptsNativeResult(result.contentNative.raw);
      result.expectedDecision = result.contentNative.contextFound ? (nativeAccepted ? 'skip' : 'translate') : 'unknown-probe-incomplete';
      result.nativeHitCovered = false;
      const start = fixture.requests.length;
      await activateExtensionTabWithoutForeground(context, page, 30000);
      await page.locator('#native').click({position: {x: 4, y: 4}});
      await page.locator('#native').hover({position: {x: 4, y: 4}});
      await page.keyboard.down('Control'); await page.keyboard.up('Control');
      if (result.expectedDecision === 'translate') await page.locator('#native .fluent-read-bilingual-content').waitFor({state: 'visible'});
      else await wait(1200);
      result.hoverRequests = fixture.requests.length - start;
      result.hoverWrappers = await page.locator('#native .fluent-read-bilingual-content').count();
      // 全文从恢复后的原文重新开始，避免把已存在的悬浮译文误当作全文决策。
      if (result.hoverWrappers) {
        await page.locator('#native').hover({position: {x: 4, y: 4}});
        await page.keyboard.down('Control'); await page.keyboard.up('Control');
        await page.locator('#native .fluent-read-bilingual-content').waitFor({state: 'detached'});
      }
      const fullStart = fixture.requests.length;
      await page.locator('main').click({position: {x: 2, y: 2}});
      await page.keyboard.down('Alt'); await page.keyboard.press('t'); await page.keyboard.up('Alt');
      await page.locator('#native-control .fluent-read-bilingual-content').waitFor({state: 'visible'});
      if (result.expectedDecision === 'translate') await page.locator('#native .fluent-read-bilingual-content').waitFor({state: 'visible'});
      await wait(500);
      result.nativeSourceRequests = fixture.requests.slice(start).filter(request => request.source?.includes(nativeEnglish)).length;
      result.fullSourceRequests = fixture.requests.slice(fullStart).filter(request => request.source?.includes(nativeEnglish)).length;
      result.fullWrappers = await page.locator('#native .fluent-read-bilingual-content').count();
      result.controlRequested = fixture.requests.slice(fullStart).some(request => request.source?.includes(nativeControl));
      await screenshot(page, 'native-evidence');
      fs.writeFileSync(path.join(artifactsDir, 'native-evidence.html'), await page.content());
      assert.equal(result.controlRequested, true);
      if (result.expectedDecision === 'skip') {
        assert.equal(result.hoverRequests, 0, '实际 content 原生证据满足采纳契约时应跳过');
        assert.equal(result.hoverWrappers, 0);
        assert.equal(result.nativeSourceRequests, 0);
        assert.equal(result.fullWrappers, 0);
        result.nativeHitCovered = true;
        result.status = 'passed';
      } else if (result.expectedDecision === 'translate') {
        assert(result.hoverRequests > 0, '原生证据不满足采纳契约时继续翻译');
        assert.equal(result.hoverWrappers, 1);
        assert(result.fullSourceRequests > 0);
        assert.equal(result.fullWrappers, 1);
        result.status = 'degraded-pass';
        result.reason = 'Actual content API evidence did not satisfy the acceptance contract; fallback translation passed, native skip hit remains uncovered.';
      } else {
        result.status = 'probe-incomplete';
        result.reason = 'The extension content world could not be identified; control translation passed, native availability and decision attribution remain unverified.';
      }
      await page.close();
    }
    assert.deepEqual(report.consoleErrors, []);
    assert.equal(report.windowPlacement.mode, 'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost, false);
    report.ok = true;
  } catch (error) {
    report.error = error.stack || String(error);
    if (activePage && !activePage.isClosed()) {
      await screenshot(activePage, 'failure').catch(() => {});
      fs.writeFileSync(path.join(artifactsDir, 'failure.html'), await activePage.content().catch(() => ''));
    }
    process.exitCode = 1;
  } finally {
    report.requests = fixture.requests;
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    await cleanupOwnedSession({launched, fixture, profileDir, report});
    if (report.cleanupError) process.exitCode = 1;
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ok: report.ok, targets, selectedCases, artifactsDir, error: report.error, profileCleanup: report.profileCleanup}));
  }
}
if (require.main === module) main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
module.exports = {renderPage, slotsOf, replyFor, targetFromPromptName, startFixture, cleanupOwnedSession};

'use strict';

// 正文上下文专项：真实浏览器执行生产快照、清洗、core提取及Markdown路径，仅使用虚构本地文章。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {createHash} = require('node:crypto');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const sourceRoot = path.resolve(arg('source-root', path.join(__dirname, '../..')));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-page-context-structure'));
const {chromium} = require(path.join(arg('playwright-root',
  '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper',
  '/Users/thinkstu/.codex/skills/fluentread-extension-ui-test/scripts/focus-safe-browser.cjs'));
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-context-structure-'));
const cases = [
  {name: 'nested-lists', patterns: [/^3\. The parent/m, /^ {4}- Its first/m, /^ {4}- Its second/m, /^ {8}7\. The seventh/m]},
  {name: 'math-mathjax-structured', patterns: [/\\frac\{x\}\{2\}/, /y\^\{3\}/]},
  {name: 'tables', patterns: [/\| --- \| --- \|/, /\|/m]},
  {name: 'merged-table-math', patterns: [/<table>/, /(?:rowspan|colspan)=/, /\\frac\{x\}\{2\}/]},
  {name: 'generated-footnote', patterns: [/\[\^1\]/, /\[\^1\]:/]},
  {name: 'mixed-language-and-sanitizer', patterns: [/中文/, /English/]},
];
const report = {sourceRoot, scope: 'six synthetic article structures in real browser DOM; no live site/provider acceptance', cases: [], errors: []};
fs.mkdirSync(artifactsDir, {recursive: true});

(async () => {
  let session;
  try {
    const bundle = await esbuild.build({absWorkingDir: sourceRoot, bundle: true, format: 'iife', platform: 'browser',
      write: false, tsconfig: path.join(sourceRoot, 'tsconfig.json'),
      stdin: {resolveDir: sourceRoot, loader: 'ts', contents: `
        import {getPageTranslationContext, resetPageTranslationContextCache} from './src/services/translation/context';
        window.__contextFixture = {read: getPageTranslationContext, reset: resetPageTranslationContextCache};
      `}});
    report.bundleSha256 = createHash('sha256').update(bundle.outputFiles[0].text).digest('hex');
    session = await launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      headless: false, background: true, viewport: {width: 1280, height: 900},
      browserArgs: ['--no-first-run', '--no-default-browser-check', '--disable-extensions']});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    const {context} = session;
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      const name = url.hostname === 'fluentread-fixture.invalid' ? url.pathname.slice(1) : '';
      if (!cases.some(item => item.name === name)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(sourceRoot, 'tests/fixtures/page-context', name + '.html'), 'utf8')});
    });
    const page = await newPageWithoutForeground(context);
    page.on('pageerror', error => report.errors.push(error.message));
    for (const item of cases) {
      await page.goto('https://fluentread-fixture.invalid/' + item.name, {waitUntil: 'domcontentloaded'});
      const script = await page.addScriptTag({content: bundle.outputFiles[0].text});
      // 扩展内容脚本不在 live DOM 中携带源码；移除夹具注入节点，避免源码本身触发页面捕获预算。
      await script.evaluate(node => node.remove());
      const result = await page.evaluate(async () => {
        const before = document.documentElement.outerHTML;
        const context = await window.__contextFixture.read();
        const cached = await window.__contextFixture.read();
        window.__contextFixture.reset();
        return {context, cacheStable: context === cached, liveDomUntouched: document.documentElement.outerHTML === before};
      });
      fs.writeFileSync(path.join(artifactsDir, item.name + '.md'), result.context);
      assert(result.cacheStable && result.liveDomUntouched, item.name + ': snapshot extraction must preserve live DOM and cache the result');
      assert(result.context.length <= 4000);
      assert(!result.context.includes('SYNTHETIC-SECRET'));
      for (const pattern of item.patterns) assert(pattern.test(result.context), item.name + ': missing ' + pattern);
      report.cases.push({name: item.name, cacheStable: true, liveDomUntouched: true, semanticChecks: item.patterns.length});
    }
    assert.deepEqual(report.errors, []);
    report.ok = true;
  } catch (error) {report.ok = false; report.failure = error.stack; process.exitCode = 1;}
  finally {
    try {await session?.close();}
    catch (error) {report.ok = false; report.cleanupError = error.message; process.exitCode = 1;}
    if (session && !report.cleanupError) fs.rmSync(profileDir, {recursive: true, force: true});
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();

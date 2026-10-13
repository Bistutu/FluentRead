/**
 * @file scripts/testing/run-caption-segment-filter-test.cjs
 * 文件职责：在临时后台浏览器的真实 DOM 中核对生产字幕片段过滤的身份、顺序、裁剪和比较次数。
 * 主要内容：仅打包两个真实公开读取函数，构造平铺、wrapper、嵌套和滚动窗口，统计包含比较、集合查询与位置读取，下一次调用验证重挂和裁剪变化。
 * 模块边界：只将配置 store 换为不参与这两个函数的纯 fixture，算法原样打包；不加载扩展或调用翻译服务，不把本地夹具当作真实 YouTube/Firefox 验收。
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {createHash} = require('node:crypto');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`);return i < 0 ? fallback : process.argv[i + 1];};
const sourceRoot = path.resolve(arg('source-root', path.join(__dirname, '../..')));
const sourcePath = path.join(sourceRoot, 'src/features/video-subtitle/content/ui.ts');
const baselinePath = arg('baseline-source');
const source = fs.readFileSync(baselinePath || sourcePath, 'utf8');
const expected = arg('expect', 'optimized');assert(['baseline', 'optimized'].includes(expected));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-caption-segments'));
const helper = require(path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))));
const {chromium} = require(path.join(arg('playwright-root', '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-caption-segments-'));
const report = {ok: false, expected, sourceSha256: createHash('sha256').update(source).digest('hex'), scope: 'Bundled exact production readers in real temporary background Edge DOM. Config port is a fixture; no extension lifecycle, live video/provider or Firefox claims.', cases: [], errors: [], screenshots: [], cleanup: {profileRemoved: false}};
fs.mkdirSync(artifactsDir, {recursive: true});
let session, page, launchAttempted = false;
(async () => {
  try {
    const bundle = await esbuild.build({absWorkingDir: sourceRoot, bundle: true, write: false, format: 'iife', platform: 'browser', tsconfig: path.join(sourceRoot, 'tsconfig.json'),
      stdin: {resolveDir: sourceRoot, loader: 'ts', contents: "import {getVisibleCaptionSegments,readVisibleCaptionText} from './src/features/video-subtitle/content/ui';window.__captionReaders={getVisibleCaptionSegments,readVisibleCaptionText};"},
      plugins: [{name: 'caption-readers-fixture-port', setup(build) {
        build.onResolve({filter: /^@\/src\/services\/config\/store$/u}, () => ({path: 'caption-config', namespace: 'fixture'}));
        build.onLoad({filter: /.*/u, namespace: 'fixture'}, () => ({contents: "export const config={uiLanguage:'zh-CN'};", loader: 'ts'}));
        build.onLoad({filter: /\/video-subtitle\/content\/ui\.ts$/u}, () => ({contents: source, loader: 'ts', resolveDir: path.dirname(sourcePath)}));
      }}]});
    report.bundleSha256 = createHash('sha256').update(bundle.outputFiles[0].text).digest('hex');
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium, profileDir, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: false, background: true, viewport: {width: 1280, height: 900}, timeout: 30000, browserArgs: ['--disable-extensions', '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(session, profileDir);
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.launchMode, 'macos-background-cdp');assert.equal(report.focusPolicy, 'launchservices-no-foreground');assert.equal(report.windowPlacement.browserFrontmost, false);
    await session.context.route('**/*', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>FluentRead caption segment fixture</title><style>body{background:#172033;color:white;font:18px sans-serif;padding:30px}.ytp-caption-window-rollup{height:60px;overflow:hidden}.ytp-caption-window-rollup>.ytp-caption-segment{display:block;height:20px;line-height:20px}#segments{max-width:1000px}i{font-style:normal}</style><h1>Caption segment fixture</h1><div id="segments"></div>'}));
    page = await helper.newPageWithoutForeground(session.context, 30000);page.on('pageerror', error => report.errors.push(error.message));
    await page.goto('https://caption-fixture.invalid/');await page.addScriptTag({content: bundle.outputFiles[0].text});
    report.cases = await page.evaluate(() => {
      const container = document.getElementById('segments');const {getVisibleCaptionSegments, readVisibleCaptionText} = window.__captionReaders;
      let contains = 0, membership = 0, rects = 0;
      const oldContains = Node.prototype.contains, oldHas = Set.prototype.has, oldRect = Element.prototype.getBoundingClientRect;
      Node.prototype.contains = function(...args) {contains++;return oldContains.apply(this,args);};
      Set.prototype.has = function(...args) {membership++;return oldHas.apply(this,args);};
      Element.prototype.getBoundingClientRect = function(...args) {rects++;return oldRect.apply(this,args);};
      const cases = [];
      const read = name => {
        contains = 0;membership = 0;rects = 0;
        const nodes = getVisibleCaptionSegments(container);const counts = {contains, membership, rects};
        const text = readVisibleCaptionText(container);const item = {name, ids: nodes.map(n => n.id), text, counts};cases.push(item);return item;
      };
      try {
        const segment = i => `<span id="s${i}" class="ytp-caption-segment">Sentence ${i}.</span>`;
        container.innerHTML = Array.from({length:200}, (_,i) => segment(i)).join('');read('flat-200');
        const outer = container.firstElementChild;outer.appendChild(container.lastElementChild);read('flat-next-call-reparent');
        container.innerHTML = Array.from({length:200}, (_,i) => `<i>${segment(i)}</i>`).join('');read('wrapped-200');
        container.innerHTML = Array.from({length:100}, (_,i) => `<span id="s${i}" class="ytp-caption-segment">Before <i><span id="inner${i}" class="ytp-caption-segment">Inner ${i}.</span></i> After.</span>`).join('');read('nested-100');
        container.innerHTML = `<div class="ytp-caption-window-rollup">${Array.from({length:10}, (_,i) => segment(i)).join('')}</div>`;
        read('rollup-initial');container.querySelector('.ytp-caption-window-rollup').scrollTop = 40;read('rollup-scrolled');
        return cases;
      } finally {Node.prototype.contains=oldContains;Set.prototype.has=oldHas;Element.prototype.getBoundingClientRect=oldRect;}
    });
    const [flat, moved, wrapped, nested, rollup, scrolled] = report.cases;
    assert.deepEqual(flat.ids, Array.from({length:200}, (_,i)=>`s${i}`));
    assert.deepEqual(moved.ids, Array.from({length:199}, (_,i)=>`s${i}`));assert(moved.text.startsWith('Sentence 0.Sentence 199.'));
    assert.deepEqual(wrapped.ids, flat.ids);assert.equal(wrapped.text, flat.text);
    assert.deepEqual(nested.ids, Array.from({length:100}, (_,i)=>`s${i}`));assert(nested.text.startsWith('Before Inner 0. After.'));
    assert.deepEqual(rollup.ids,['s0','s1','s2']);assert.deepEqual(scrolled.ids,['s2','s3','s4']);
    assert.equal(rollup.counts.rects,20);assert.equal(scrolled.counts.rects,20);
    if (expected === 'optimized') {
      assert.equal(flat.counts.contains,0);assert.equal(flat.counts.membership,0);
      assert.equal(wrapped.counts.contains,0);assert.equal(wrapped.counts.membership,200);
      assert.equal(nested.counts.contains,0);assert.equal(nested.counts.membership,200);
    } else assert.equal(flat.counts.contains,39800);
    const file = path.join(artifactsDir,'rollup-scrolled.png');await page.screenshot({path:file});report.screenshots.push(file);
    assert.deepEqual(report.errors,[]);report.ok=true;
  } catch(error) {report.error=error.stack;process.exitCode=1;}
  finally {
    let closed=!launchAttempted;
    if(session)try {await session.close();closed=true;}catch(error){report.cleanup.error=error.message;report.ok=false;process.exitCode=1;}
    if(closed){fs.rmSync(profileDir,{recursive:true,force:true});report.cleanup.profileRemoved=true;}else report.cleanup.retainedProfile=profileDir;
    fs.writeFileSync(path.join(artifactsDir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,expected,cases:report.cases.map(c=>({name:c.name,visible:c.ids.length,counts:c.counts})),error:report.error}));
  }
})();

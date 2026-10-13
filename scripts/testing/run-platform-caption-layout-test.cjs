'use strict';

// 限定字幕布局回归：真实隔离浏览器运行生产模块，字幕、翻译与媒体就绪由本地夹具提供。
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
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-platform-caption-layout'));
const {chromium} = require(path.join(arg('playwright-root',
  '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper',
  '/Users/thinkstu/.codex/skills/fluentread-extension-ui-test/scripts/focus-safe-browser.cjs'));
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-caption-layout-'));
const report = {sourceRoot, scope: 'stable long subtitle, player movement/resize, appearance and failed translation layout',
  method: 'Bundled production modules and real browser DOM/layout; fixture translation and synthetic video readiness; no live platform/provider acceptance.',
  errors: [], checks: []};
fs.mkdirSync(artifactsDir, {recursive: true});

async function state(page) {
  return page.evaluate(() => {
    const host = document.getElementById('fluent-read-platform-captions');
    const panel = host?.shadowRoot.querySelector('.panel');
    return {heightReads: window.__heightReads, hidden: host?.hidden, left: host?.style.left,
      width: host?.style.width, fontSize: panel?.style.fontSize, maximumHeight: panel?.style.maxHeight,
      actualHeight: panel?.getBoundingClientRect().height,
      contentHeight: panel ? window.__untrackedScrollHeight.call(panel) : null,
      source: host?.shadowRoot.querySelector('.source')?.textContent,
      translation: host?.shadowRoot.querySelector('.translation')?.textContent,
      retryVisible: host?.shadowRoot.querySelector('button')?.hidden === false};
  });
}

(async () => {
  let session;
  try {
    const bundle = await esbuild.build({absWorkingDir: sourceRoot, bundle: true, format: 'iife', platform: 'browser',
      write: false, tsconfig: path.join(sourceRoot, 'tsconfig.json'),
      stdin: {resolveDir: sourceRoot, loader: 'ts', contents: `
        import {Config} from './src/core/config/model';
        import {mountPlatformCaptions} from './src/features/video-subtitle/content/platformRuntime';
        const config = new Config(); config.on = true; config.to = 'zh-Hans';
        config.videoSubtitleAppearance.fontScale = 320;
        config.videoSubtitleAppearance.maxWidth = 90;
        config.videoMeetingAutoEnabled = false;
        let listener = () => {}; let failNext = false;
        window.__captionFixture = {config, update: () => listener(), failNext: () => {failNext = true;}};
        window.__captionFixture.dispose = mountPlatformCaptions({document, window, config,
          subscribe: callback => {listener = callback; return () => {listener = () => {};};},
          patch: patch => {Object.assign(config, patch); listener();}, label: text => text,
          translate: () => failNext ? Promise.reject(new Error('Fixture translation failed'))
            : Promise.resolve('这是用于验证双语长字幕在有限画面内完整显示的本地译文。'.repeat(5))});
      `}});
    report.bundleSha256 = createHash('sha256').update(bundle.outputFiles[0].text).digest('hex');
    session = await launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      headless: false, background: true, viewport: {width: 1280, height: 900},
      browserArgs: ['--no-first-run', '--no-default-browser-check', '--disable-extensions']});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    const {context} = session;
    await context.route('**/*', route => route.fulfill({contentType: 'text/html', body:
      '<!doctype html><meta charset="utf-8"><title>FluentRead caption layout fixture</title>' +
      '<style>body{margin:0;background:#18202d;color:white}section{margin:40px;width:600px}video{display:block;width:100%;height:240px;background:#304056}</style>' +
      '<section><video></video><span data-purpose="captions-cue-text"></span></section>'}));
    const page = await newPageWithoutForeground(context);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto('https://www.udemy.com/fluentread-local-layout-fixture', {waitUntil: 'domcontentloaded'});
    await page.evaluate(() => {
      const video = document.querySelector('video');
      for (const [key, value] of Object.entries({readyState: 4, seeking: false, ended: false, paused: false, currentTime: 1}))
        Object.defineProperty(video, key, {value, configurable: true});
      document.querySelector('[data-purpose="captions-cue-text"]').textContent =
        'A long original subtitle should remain readable when its translation arrives and the player changes size. '.repeat(5);
      window.__heightReads = 0;
      const height = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
      window.__untrackedScrollHeight = height.get;
      Object.defineProperty(Element.prototype, 'scrollHeight', {configurable: true, get() {
        if (this.className === 'panel') window.__heightReads++;
        return height.get.call(this);
      }});
    });
    await page.addScriptTag({content: bundle.outputFiles[0].text});
    await page.waitForFunction(() => document.getElementById('fluent-read-platform-captions')?.shadowRoot.querySelector('.translation')?.textContent);
    await page.waitForTimeout(300);
    let before = await state(page);
    assert(before.contentHeight <= Number.parseFloat(before.maximumHeight) + 1, 'Long bilingual captions must fit inside the player height budget without clipping');
    await page.waitForTimeout(1100);
    const stable = await state(page);
    report.stable = {heightReads: stable.heightReads - before.heightReads, fontSize: stable.fontSize};
    if (arg('expect', 'optimized') === 'optimized') assert.equal(report.stable.heightReads, 0, 'Stable captions must not repeat font fitting');
    else assert(report.stable.heightReads > 0, 'Baseline must demonstrate repeated fitting');
    report.checks.push('long bilingual caption fits; stable layout counted');
    await page.evaluate(() => document.querySelector('section').style.marginLeft = '65px');
    await page.waitForFunction(left => document.getElementById('fluent-read-platform-captions')?.style.left !== left, before.left);
    report.checks.push('unchanged subtitle follows player movement');
    before = await state(page);
    await page.evaluate(() => {document.querySelector('section').style.width = '360px'; window.dispatchEvent(new Event('resize'));});
    await page.waitForFunction(width => document.getElementById('fluent-read-platform-captions')?.style.width !== width, before.width);
    const resized = await state(page);
    assert(resized.heightReads > before.heightReads);
    assert(resized.contentHeight <= Number.parseFloat(resized.maximumHeight) + 1);
    report.checks.push('resize refits the same bilingual text');
    await page.evaluate(() => {window.__captionFixture.config.videoSubtitleAppearance.lineSpacing = 1.7; window.__captionFixture.update();});
    const appearance = await state(page);
    assert(appearance.heightReads > resized.heightReads);
    assert(appearance.contentHeight <= Number.parseFloat(appearance.maximumHeight) + 1);
    report.checks.push('appearance change invalidates font fitting');
    await page.screenshot({path: path.join(artifactsDir, 'long-caption-resized.png')});
    await page.evaluate(() => {
      window.__captionFixture.failNext();
      document.querySelector('[data-purpose="captions-cue-text"]').textContent += ' Failure fixture.';
    });
    await page.waitForFunction(() => document.getElementById('fluent-read-platform-captions')?.shadowRoot.querySelector('button')?.hidden === false);
    const failed = await state(page);
    assert.equal(failed.translation, '这句翻译失败');
    if (arg('expect', 'optimized') === 'optimized') assert(failed.contentHeight <= Number.parseFloat(failed.maximumHeight) + 1);
    report.checks.push('failed translation and retry control remain visible');
    await page.evaluate(() => window.__captionFixture.dispose());
    assert.equal(await page.locator('#fluent-read-platform-captions').count(), 0);
    assert.equal(await page.locator('[data-purpose="captions-cue-text"]').evaluate(node => node.style.visibility), '');
    report.checks.push('dispose restores native caption visibility and removes owned UI');
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

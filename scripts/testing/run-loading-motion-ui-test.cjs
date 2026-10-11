'use strict';

/**
 * 界面设置中的 15 种翻译加载动画及末尾“无”、逐句高亮关闭选项的真实浏览器专项。
 *
 * 本脚本只在测试页的 document_start 阶段临时包装 attachShadow，保存 closed
 * ShadowRoot 的页内句柄；产品代码仍使用 mode: closed。动画断言同时读取
 * Web Animations API、多个时刻的 computed transform/opacity 和静态反馈几何，
 * 并验证同一 Document 共享 CSSStyleSheet、不同 Document 不共享样式对象。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
const playwrightRoot = path.resolve(argument(
  'playwright-root',
  '/Users/thinkstu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules',
));
const focusHelper = path.resolve(argument(
  'focus-safe-helper',
  '/Users/thinkstu/.codex/skills/fluentread-extension-ui-test/scripts/focus-safe-browser.cjs',
));
const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-loading-motion-ui'));
const browserPath = argument('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
const timeout = Number(argument('timeout', '30000'));
// 覆盖沙漏等含停顿的完整周期，不能把两次停顿区间的静止采样误判为动画失效。
const sampleCount = Math.max(3, Number(argument('samples', '16')) || 16);
const sampleIntervalMs = Math.max(50, Number(argument('sample-interval-ms', '160')) || 160);

if (!Number.isFinite(sampleCount)) throw new Error('samples 无效：必须为 finite 数值');
if (!Number.isFinite(sampleIntervalMs)) throw new Error('sample-interval-ms 无效：必须为 finite 数值');

if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
  throw new Error(`扩展产物不存在：${extensionDir}`);
}
if (!fs.existsSync(focusHelper)) throw new Error(`防抢焦点 helper 不存在：${focusHelper}`);
if (!Number.isFinite(timeout) || timeout < 1000) throw new Error(`timeout 无效：${timeout}`);
fs.mkdirSync(artifactsDir, {recursive: true});

const {chromium} = require(path.join(playwrightRoot, 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(focusHelper);

const EXPECTED_STYLE_COUNT = 15;
const STYLE_MARKER_RULE = '.fr-loading-visual { outline: 0.123px solid rgb(1, 2, 3); }';

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function serializableError(error) {
  return error instanceof Error
    ? {message: error.message, stack: error.stack}
    : {message: String(error)};
}

function filePart(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'case';
}

async function writeJson(file, value) {
  const target = path.join(artifactsDir, file);
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
  return target;
}

async function screenshot(page, file) {
  const target = path.join(artifactsDir, file);
  await page.screenshot({path: target, fullPage: false});
  return target;
}

function attachDiagnostics(page, errors) {
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
}

function installClosedRootProbe(page) {
  return page.addInitScript(() => {
    const originalAttachShadow = Element.prototype.attachShadow;
    const probe = {
      roots: [],
      attachShadowCalls: 0,
      loadingRoots: 0,
      sheetIds: new WeakMap(),
      nextSheetId: 0,
      documentId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    Object.defineProperty(globalThis, '__fluentReadLoadingMotionProbe', {
      configurable: false,
      enumerable: false,
      value: probe,
    });
    Element.prototype.attachShadow = function attachShadow(options) {
      const root = originalAttachShadow.call(this, options);
      probe.attachShadowCalls += 1;
      if (options?.mode === 'closed') {
        const entry = {host: this, root};
        probe.roots.push(entry);
        if (this.classList?.contains('fluent-read-loading')) probe.loadingRoots += 1;
      }
      return root;
    };
  });
}

async function readProbe(page) {
  return page.evaluate(() => {
    const probe = globalThis.__fluentReadLoadingMotionProbe;
    if (!probe) return null;
    const entries = probe.roots.filter(entry => (
      entry.host?.isConnected
      && entry.host.classList?.contains('fluent-read-loading')
      && entry.root
    ));
    const getAnimations = root => {
      if (typeof root.getAnimations === 'function') {
        return {source: 'shadow-root', supported: true, animations: root.getAnimations({subtree: true})};
      }
      const visual = root.querySelector('.fr-loading-visual');
      if (!visual || typeof visual.getAnimations !== 'function') {
        return {source: 'visual-fallback-unavailable', supported: false, animations: []};
      }
      return {source: 'visual-fallback', supported: false, animations: visual.getAnimations({subtree: true})};
    };
    const readEntry = entry => {
      const visual = entry.root.querySelector('.fr-loading-visual');
      const animated = getAnimations(entry.root);
      const elements = [visual, ...(visual ? [...visual.querySelectorAll('*')] : [])].filter(Boolean);
      const computed = elements.map(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          transform: style.transform,
          opacity: style.opacity,
          animationName: style.animationName,
          rect: {width: rect.width, height: rect.height},
        };
      });
      const names = [...new Set(animated.animations.map(animation => (
        animation.animationName || animation.effect?.getKeyframes?.()?.[0]?.offset || 'anonymous'
      )))];
      const adopted = entry.root.adoptedStyleSheets || [];
      let adoptedStyleSheetId = null;
      if (adopted[0]) {
        adoptedStyleSheetId = probe.sheetIds.get(adopted[0]);
        if (!adoptedStyleSheetId) {
          adoptedStyleSheetId = ++probe.nextSheetId;
          probe.sheetIds.set(adopted[0], adoptedStyleSheetId);
        }
      }
      return {
        style: entry.host.getAttribute('data-fr-loading-style') || '',
        motion: entry.host.getAttribute('data-fr-motion') || '',
        rootGetAnimationsSupported: animated.supported,
        animationSource: animated.source,
        animationCount: animated.animations.length,
        animationNames: names,
        playStates: animated.animations.map(animation => animation.playState),
        computed,
        adoptedStyleSheetCount: adopted.length,
        adoptedStyleSheetId,
        styleElementCount: entry.root.querySelectorAll('style').length,
        visualText: visual?.textContent || '',
      };
    };
    return {
      documentId: probe.documentId,
      attachShadowCalls: probe.attachShadowCalls,
      totalClosedRoots: entries.length,
      loadingRoots: entries.length,
      previews: entries.map(readEntry),
    };
  });
}

function assertPreviewCount(state, phase) {
  if (!state || state.totalClosedRoots !== EXPECTED_STYLE_COUNT || state.previews.length !== EXPECTED_STYLE_COUNT) {
    throw new Error(`${phase} 没有唯一的 15 个 closed ShadowRoot 预览：${JSON.stringify({
      totalClosedRoots: state?.totalClosedRoots,
      previewCount: state?.previews?.length,
      attachShadowCalls: state?.attachShadowCalls,
    })}`);
  }
  const styles = state.previews.map(item => item.style);
  if (new Set(styles).size !== EXPECTED_STYLE_COUNT || styles.some(value => !value)) {
    throw new Error(`${phase} 15 种预览样式标识不唯一：${JSON.stringify(styles)}`);
  }
}

function assertStaticFeedback(state, phase) {
  assertPreviewCount(state, phase);
  const invalid = state.previews.filter(item => (
    item.animationCount !== 0
    || item.computed.length === 0
    || item.computed[0]?.rect.width <= 0
    || item.computed[0]?.rect.height <= 0
    || Number(item.computed[0]?.opacity || 0) <= 0
  ));
  if (invalid.length) throw new Error(`${phase} 静态反馈不可见或仍有动画：${JSON.stringify(invalid)}`);
  return {
    animationCount: state.previews.map(item => item.animationCount),
    motion: state.previews.map(item => item.motion),
    visibleFeedback: state.previews.map(item => item.computed.some(entry => Number(entry.opacity) > 0)),
  };
}

function assertAnimatedSamples(samples, phase) {
  if (!samples.length) throw new Error(`${phase} 没有动画采样`);
  const first = samples[0];
  assertPreviewCount(first, phase);
  const invalid = first.previews.filter(item => (
    item.animationCount < 1
    || item.playStates.every(state => state !== 'running')
    || item.animationNames.length < 1
  ));
  if (invalid.length) throw new Error(`${phase} 存在没有运行动画的预览：${JSON.stringify(invalid)}`);
  const moving = first.previews.map((preview, index) => {
    const fingerprints = samples.map(sample => JSON.stringify(sample.previews[index].computed.map(item => [item.transform, item.opacity])));
    return {style: preview.style, changed: new Set(fingerprints).size > 1, fingerprints};
  });
  const stationary = moving.filter(item => !item.changed);
  if (stationary.length) throw new Error(`${phase} transform/opacity 多时刻采样没有变化：${JSON.stringify(stationary)}`);
  return {
    animationNames: first.previews.map(item => ({style: item.style, names: item.animationNames})),
    animationCounts: first.previews.map(item => item.animationCount),
    playStates: first.previews.map(item => item.playStates),
    changedComputedTransformOrOpacity: moving.map(item => ({style: item.style, changed: item.changed})),
    samples: samples.map(sample => ({documentId: sample.documentId, previews: sample.previews})),
  };
}

async function sampleAnimations(page, count = sampleCount) {
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    samples.push(await readProbe(page));
    if (index < count - 1) await page.waitForTimeout(sampleIntervalMs);
  }
  return samples;
}

async function selectInterfacePage(page, timeoutMs) {
  await page.locator('.settings-app').waitFor({state: 'visible', timeout: timeoutMs});
  const section = page.locator('#settings-interface');
  await section.waitFor({state: 'visible', timeout: timeoutMs});
  const picker = section.locator('.loading-style-picker');
  await picker.waitFor({state: 'visible', timeout: timeoutMs});
  await picker.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelectorAll('.loading-style-picker .fluent-read-loading').length === 15,
    undefined, {timeout: timeoutMs});
  return {section, picker};
}

async function sharedStylesheetEvidence(page, context, extensionOrigin, optionsPath, timeoutMs, report) {
  const first = await readProbe(page);
  assertPreviewCount(first, '共享样式表首个 Document');
  const firstSheets = first.previews.map(item => item.adoptedStyleSheetId);
  const firstSheetCount = first.previews.map(item => item.adoptedStyleSheetCount);
  const firstStyleCount = first.previews.map(item => item.styleElementCount);
  if (firstSheetCount.some(count => count !== 1) || firstStyleCount.some(count => count !== 0)) {
    throw new Error(`首个 Document 没有使用单一 adoptedStyleSheet：${JSON.stringify({firstSheetCount, firstStyleCount})}`);
  }
  const sameWithinDocument = firstSheets.every(sheet => sheet === firstSheets[0]);
  if (!sameWithinDocument) throw new Error('15 个预览没有共享同一个 Document CSSStyleSheet');

  const secondPage = await newPageWithoutForeground(context, timeoutMs);
  try {
    await installClosedRootProbe(secondPage);
    await secondPage.emulateMedia({reducedMotion: 'no-preference'});
    const secondUrl = new URL(optionsPath, `${extensionOrigin}/`);
    secondUrl.hash = 'settings-interface';
    secondUrl.searchParams.set('loadingMotionDocument', 'second');
    await secondPage.goto(secondUrl.toString(), {waitUntil: 'domcontentloaded', timeout: timeoutMs});
    await selectInterfacePage(secondPage, timeoutMs);
    const second = await readProbe(secondPage);
    assertPreviewCount(second, '共享样式表第二个 Document');
    if (second.previews.some(item => item.adoptedStyleSheetCount !== 1 || item.styleElementCount !== 0)) {
      throw new Error(`第二个 Document 复制了 style 或缺少 adoptedStyleSheet：${JSON.stringify(second.previews)}`);
    }
    const secondSheets = second.previews.map(item => item.adoptedStyleSheetId);
    if (!secondSheets.every(sheet => sheet === secondSheets[0])) {
      throw new Error('第二个 Document 内部没有共享同一个 CSSStyleSheet');
    }
    const markerEvidence = await page.evaluate(rule => {
      const probe = globalThis.__fluentReadLoadingMotionProbe;
      const entry = probe?.roots.find(item => item.host?.isConnected && item.host.classList?.contains('fluent-read-loading'));
      const sheet = entry?.root?.adoptedStyleSheets?.[0];
      if (!sheet || typeof sheet.insertRule !== 'function') return {supported: false};
      const index = sheet.cssRules.length;
      sheet.insertRule(rule, index);
      const visual = entry.root.querySelector('.fr-loading-visual');
      const color = visual ? getComputedStyle(visual).outlineColor : '';
      return {supported: true, index, color};
    }, STYLE_MARKER_RULE);
    const secondMarker = await secondPage.evaluate(() => {
      const probe = globalThis.__fluentReadLoadingMotionProbe;
      const entry = probe?.roots.find(item => item.host?.isConnected && item.host.classList?.contains('fluent-read-loading'));
      const visual = entry?.root?.querySelector('.fr-loading-visual');
      return visual ? getComputedStyle(visual).outlineColor : '';
    });
    await page.evaluate(index => {
      const probe = globalThis.__fluentReadLoadingMotionProbe;
      const entry = probe?.roots.find(item => item.host?.isConnected && item.host.classList?.contains('fluent-read-loading'));
      const sheet = entry?.root?.adoptedStyleSheets?.[0];
      if (sheet && Number.isInteger(index) && index >= 0 && index < sheet.cssRules.length) sheet.deleteRule(index);
    }, markerEvidence.index);
    if (!markerEvidence.supported || markerEvidence.color !== 'rgb(1, 2, 3)' || secondMarker === 'rgb(1, 2, 3)') {
      throw new Error(`跨 Document 样式隔离证据不足：${JSON.stringify({markerEvidence, secondMarker})}`);
    }
    report.sharedStylesheet = {
      sameWithinDocument,
      firstDocumentId: first.documentId,
      secondDocumentId: second.documentId,
      firstAdoptedStyleSheetCount: firstSheetCount,
      firstStyleElementCount: firstStyleCount,
      secondAdoptedStyleSheetCount: second.previews.map(item => item.adoptedStyleSheetCount),
      secondStyleElementCount: second.previews.map(item => item.styleElementCount),
      crossDocumentIsolation: true,
      markerEvidence: {first: markerEvidence.color, second: secondMarker},
    };
  } finally {
    await secondPage.close().catch(() => undefined);
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  const optionsPath = manifest.options_page || manifest.options_ui?.page;
  if (typeof optionsPath !== 'string' || !optionsPath) throw new Error('manifest 缺少 options 页面');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-loading-motion-'));
  const report = {
    ok: false,
    extensionDir,
    browser: browserPath.includes('Google Chrome') ? 'Google Chrome' : 'Microsoft Edge',
    launchMode: null,
    focusPolicy: null,
    windowPlacement: null,
    optionsPath,
    previewCount: EXPECTED_STYLE_COUNT,
    sampleCount,
    sampleIntervalMs,
    animationNames: [],
    animated: null,
    off: null,
    reducedMotion: null,
    reenabled: null,
    sharedStylesheet: null,
    screenshots: [],
    consoleErrors: [],
    failure: null,
  };
  let launched;
  let page;
  try {
    launched = await launchFocusSafePersistentContext({
      chromium,
      profileDir,
      browserPath,
      headless: false,
      background: true,
      browserArgs: [
        ...(browserPath.includes('Google Chrome') ? ['--enable-unsafe-extension-debugging'] : [
          `--disable-extensions-except=${extensionDir}`,
          `--load-extension=${extensionDir}`,
        ]),
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: {width: 1440, height: 1000},
      timeout,
    });
    report.launchMode = launched.launchMode;
    report.focusPolicy = launched.focusPolicy;
    report.windowPlacement = launched.windowPlacement;
    const context = launched.context;
    if (browserPath.includes('Google Chrome')) {
      const session = await context.browser().newBrowserCDPSession();
      await session.send('Extensions.loadUnpacked', {path: extensionDir});
      await session.detach();
    }
    const worker = context.serviceWorkers().find(candidate => candidate.url().startsWith('chrome-extension://'))
      || await context.waitForEvent('serviceworker', {timeout, predicate: candidate => candidate.url().startsWith('chrome-extension://')});
    const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
    page = await newPageWithoutForeground(context, timeout);
    attachDiagnostics(page, report.consoleErrors);
    await installClosedRootProbe(page);
    await page.emulateMedia({reducedMotion: 'no-preference'});
    const pageUrl = new URL(optionsPath, `${extensionOrigin}/`);
    pageUrl.hash = 'settings-interface';
    pageUrl.searchParams.set('loadingMotionDocument', 'first');
    await page.goto(pageUrl.toString(), {waitUntil: 'domcontentloaded', timeout});
    let {section, picker} = await selectInterfacePage(page, timeout);
    const choices = await picker.locator('input[type="radio"]').evaluateAll(inputs => inputs.map(input => ({value: input.value, disabled: input.disabled})));
    if (choices.length !== 16 || choices.at(-1).value !== 'none' || choices.some(item => item.disabled)) throw new Error('动画选择器必须有 16 项，最后为可操作的“无”');
    if (await section.locator('[data-settings-panel="motion"] .el-switch').count()) throw new Error('动画样式仍有冗余开关');
    report.choices = choices;
    const motionPanel = section.locator('[data-settings-panel="motion"]');
    report.groupCopy = {
      title: await motionPanel.locator('.settings-group-heading h2').innerText(),
      description: await motionPanel.locator('.settings-group-heading p').innerText(),
      nestedHeadingCount: await motionPanel.locator('.settings-item-label').count(),
    };
    await picker.locator('[data-loading-style-choice="ring"]').click();
    await page.waitForTimeout(180);

    const animatedSamples = await sampleAnimations(page);
    report.animated = assertAnimatedSamples(animatedSamples, '动画开启');
    report.animationNames = report.animated.animationNames;
    report.screenshots.push(await screenshot(page, 'settings-loading-motion-animated.png'));
    const gridScreenshot = path.join(artifactsDir, 'settings-loading-style-choices.png');
    await section.locator('[data-settings-panel="motion"]').screenshot({path: gridScreenshot});
    report.screenshots.push(gridScreenshot);

    await picker.locator('[data-loading-style-choice="none"]').click();
    // 点击后立即关闭页面，验证后台保存不依赖设置页继续存活。
    await page.close();
    page = await newPageWithoutForeground(context, timeout);
    attachDiagnostics(page, report.consoleErrors);
    await installClosedRootProbe(page);
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.goto(pageUrl.toString(), {waitUntil: 'domcontentloaded', timeout});
    ({section, picker} = await selectInterfacePage(page, timeout));
    if (!await picker.locator('input[value="none"]').isChecked()) throw new Error('快速关闭重开后，“无”没有持久化');
    if (await picker.locator('input:disabled').count()) throw new Error('选择“无”后样式不可恢复');
    report.quickClose = {animationNone: true};
    await page.waitForTimeout(180);
    const offState = await readProbe(page);
    report.off = assertStaticFeedback(offState, '选择“无”并重开');
    report.screenshots.push(await screenshot(page, 'settings-loading-motion-off.png'));

    await picker.locator('[data-loading-style-choice="orbit"]').click();
    if (!await picker.locator('input[value="orbit"]').isChecked() || await picker.locator('input[value="none"]').isChecked()) throw new Error('选择动画没有重新启用或同时选中“无”');
    await page.waitForTimeout(180);
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.waitForTimeout(220);
    const reducedState = await readProbe(page);
    report.reducedMotion = {
      media: await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      ...assertStaticFeedback(reducedState, '系统减少动态效果'),
    };
    report.screenshots.push(await screenshot(page, 'settings-loading-motion-reduced.png'));

    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.waitForTimeout(240);
    const reenabledSamples = await sampleAnimations(page);
    report.reenabled = assertAnimatedSamples(reenabledSamples, '恢复系统动态效果');
    report.screenshots.push(await screenshot(page, 'settings-loading-motion-reenabled.png'));

    await sharedStylesheetEvidence(page, context, extensionOrigin, optionsPath, timeout, report);

    const readAppearance = () => page.evaluate(() => {
      const none = document.querySelector('[data-loading-style-choice="none"]');
      const selected = document.querySelector('.loading-style-option.selected');
      return {noneBorder: getComputedStyle(none).borderStyle, noneBackground: getComputedStyle(none).backgroundColor, selectedBackground: getComputedStyle(selected).backgroundColor, selectedCount: document.querySelectorAll('.loading-style-option.selected').length};
    });
    report.noneAppearance = await readAppearance();
    if (report.noneAppearance.noneBorder !== 'dashed' || report.noneAppearance.noneBackground === report.noneAppearance.selectedBackground || report.noneAppearance.selectedCount !== 1) throw new Error('未选中“无”的视觉状态不明确');
    await page.emulateMedia({colorScheme: 'dark'});
    await page.waitForTimeout(180);
    await picker.scrollIntoViewIfNeeded();
    const darkScreenshot = path.join(artifactsDir, 'settings-loading-style-dark.png');
    await section.locator('[data-settings-panel="motion"]').screenshot({path: darkScreenshot});
    report.screenshots.push(darkScreenshot);
    await page.emulateMedia({colorScheme: 'light'});
    for (const width of [1024, 390]) {
      await page.setViewportSize({width, height: 1000});
      await page.waitForTimeout(120);
      await picker.scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) throw new Error(`${width}px 设置页出现横向溢出`);
      report.screenshots.push(await screenshot(page, `settings-loading-motion-${width}.png`));
      if (width === 390) {
        await section.locator('[data-settings-panel="motion"] .settings-group-heading').scrollIntoViewIfNeeded();
        report.screenshots.push(await screenshot(page, 'settings-loading-style-heading-390.png'));
      }
    }
    await page.setViewportSize({width: 1440, height: 1000});

    const highlight = page.locator('#translation-sentence-highlight-style');
    await highlight.scrollIntoViewIfNeeded();
    const highlightValues = await highlight.locator('[data-highlight-style]').evaluateAll(cards => cards.map(card => card.dataset.highlightStyle));
    if (highlightValues.at(-1) !== 'none') throw new Error('逐句高亮“无”没有排在最后');
    await highlight.locator('[data-highlight-style="none"]').click();
    await page.close();
    page = await newPageWithoutForeground(context, timeout);
    attachDiagnostics(page, report.consoleErrors);
    await page.goto(pageUrl.toString(), {waitUntil: 'domcontentloaded', timeout});
    await page.locator('.settings-app').waitFor({state: 'visible', timeout});
    const reopenedHighlight = page.locator('#translation-sentence-highlight-style');
    await reopenedHighlight.scrollIntoViewIfNeeded();
    if (await reopenedHighlight.locator('[data-highlight-style="none"]').getAttribute('aria-checked') !== 'true' || await reopenedHighlight.locator('.sentence-highlight-option[aria-checked="true"]').count() !== 1) throw new Error('逐句高亮关闭状态没有持久化或误标记旧样式');
    report.quickClose.sentenceNone = true;
    report.screenshots.push(await screenshot(page, 'settings-sentence-highlight-none.png'));
    await page.locator('[data-section="settings-translation"]').click();
    const summary = page.locator('[data-testid="current-sentence-highlight-style"]');
    await summary.waitFor({state: 'visible', timeout});
    if ((await summary.textContent()).trim() !== '无') throw new Error('阅读辅助页没有同步逐句高亮的关闭状态');
    if (await page.locator('.reading-assistance-controls .el-switch').count()) throw new Error('阅读辅助仍有冗余高亮开关');
    report.crossPageSync = {sentenceNone: true};
    report.screenshots.push(await screenshot(page, 'settings-reading-assistance-none.png'));
    await page.locator('[data-testid="open-sentence-highlight-styles"]').click();
    await reopenedHighlight.waitFor({state: 'visible', timeout});
    const firstStyle = highlightValues[0];
    await reopenedHighlight.locator(`[data-highlight-style="${firstStyle}"]`).click();
    if (await reopenedHighlight.locator(`[data-highlight-style="${firstStyle}"]`).getAttribute('aria-checked') !== 'true' || await reopenedHighlight.locator('[data-highlight-style="none"]').getAttribute('aria-checked') !== 'false') throw new Error('逐句样式不能重新开启高亮');
    report.sentenceHighlight = {values: highlightValues, nonePersists: true, presetReenables: true};
    report.screenshots.push(await screenshot(page, 'settings-sentence-highlight-enabled.png'));
    report.ok = true;
  } catch (error) {
    report.failure = serializableError(error);
    if (page && !page.isClosed()) report.screenshots.push(await screenshot(page, 'failure.png').catch(() => null));
    throw error;
  } finally {
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    await page?.close().catch(() => undefined);
    await launched?.close().catch(() => undefined);
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

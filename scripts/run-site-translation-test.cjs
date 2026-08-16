#!/usr/bin/env node

// 运行真实网站的悬浮翻译或全文翻译回归。
//
// 这个脚本只创建临时 Edge profile，并支持屏幕外窗口；它不会连接用户日常
// 浏览器，也不会通过 page.evaluate 派发伪造的键盘事件。Control 和 Alt+T
// 都由 Playwright keyboard API 发送真实的浏览器按键。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');

const CASES = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'tests', 'browser-translation-cases.json'),
  'utf8',
));

function parseArgs(argv) {
  const args = {
    browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    background: true,
    timeout: 60000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--background') continue;
    if (token === '--headed') {
      args.background = false;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`无法识别参数：${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${token}`);
    args[key] = value;
    index += 1;
  }

  args.timeout = Number(args.timeout);
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) throw new Error('--timeout 必须为正数');
  if (!args.case) throw new Error('必须传入 --case，例如 x-status');
  if (!CASES[args.case]) throw new Error(`未知 case：${args.case}`);
  if (!['hover', 'full'].includes(args.mode)) throw new Error('--mode 必须是 hover 或 full');
  if (!args.extensionDir) throw new Error('必须传入 --extension-dir');
  if (!args.playwrightRoot) throw new Error('必须传入 --playwright-root');
  return {...args, ...CASES[args.case]};
}

function loadPlaywright(root) {
  try {
    return require('playwright');
  } catch {
    const loader = createRequire(path.join(path.resolve(root), '__fluentread_site_loader__.cjs'));
    return loader('playwright');
  }
}

function assertDedicatedProfile(profileDir) {
  const resolved = path.resolve(profileDir);
  const home = os.homedir();
  const forbidden = [
    path.join(home, 'Library/Application Support/Google/Chrome'),
    path.join(home, 'Library/Application Support/Microsoft Edge'),
    path.join(home, '.config/google-chrome'),
    path.join(home, '.config/microsoft-edge'),
  ];
  if (forbidden.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  })) {
    throw new Error(`拒绝使用日常浏览器 profile：${resolved}`);
  }
}

function normalizeConfig(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function readConfig(context, timeout) {
  const workers = context.serviceWorkers();
  const worker = workers[0] || await context.waitForEvent('serviceworker', {timeout: Math.min(timeout, 30000)});
  const match = worker.url().match(/^chrome-extension:\/\/([^/]+)/);
  if (!match) throw new Error('没有找到扩展 service worker');
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${match[1]}/popup.html`, {waitUntil: 'domcontentloaded', timeout: 30000});
    const stored = await popup.evaluate(() => chrome.storage.local.get('config'));
    return {extensionId: match[1], config: normalizeConfig(stored.config)};
  } finally {
    await popup.close();
  }
}

async function waitFor(page, predicate, timeout, argument) {
  await page.waitForFunction(predicate, argument, {timeout});
}

async function waitForStableTarget(page, selector, timeout) {
  await waitFor(page, (targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && Boolean(target.textContent?.trim());
  }, timeout, selector);
  await page.waitForTimeout(1000);
}

async function readTargetState(page, selector) {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    return {
      exists: Boolean(target),
      text: target?.textContent?.trim() || '',
      bilingualCount: target?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
    };
  }, selector);
}

// 全文翻译使用可视区懒加载。回归时主动滚过页面，触发所有长页面内容块，
// 然后等待插件的进行中任务和 loading 节点都清空，避免只验证到首屏。
async function scrollAndWaitFullPage(page, timeout) {
  const startedAt = Date.now();
  const maxSteps = 40;
  let step = 0;
  let top = 0;

  while (step < maxSteps && Date.now() - startedAt < timeout) {
    const layout = await page.evaluate(() => ({
      viewport: Math.max(window.innerHeight || 0, 480),
      height: Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0),
    }));
    const stepSize = Math.max(Math.floor(layout.viewport * 0.8), 400);
    await page.evaluate((scrollTop) => window.scrollTo(0, scrollTop), top);
    await page.waitForTimeout(700);

    const atBottom = top + layout.viewport >= layout.height - 8;
    if (atBottom) break;
    top += stepSize;
    step += 1;
  }

  await page.waitForFunction(() => {
    const loading = document.querySelectorAll('.fluent-read-loading').length;
    const retry = document.querySelectorAll('.fluent-read-retry-wrapper').length;
    const status = document.querySelector('#fluent-read-translation-status-container')?.textContent || '';
    const active = /当前活跃任务:\s*[1-9]/u.test(status);
    const pending = /等待中的任务:\s*[1-9]/u.test(status);
    return loading === 0 && retry === 0 && !active && !pending;
  }, {timeout: Math.max(1000, timeout - (Date.now() - startedAt))});

  // 队列刚清空时再停留一小段时间，确认没有由最后一次 DOM 写入触发的重复请求。
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function readFullPageState(page, selector, controlSelector) {
  return page.evaluate(({targetSelector, buttonSelector}) => {
    const wrappers = [...document.querySelectorAll('.fluent-read-bilingual-content')];
    const parents = new Set(wrappers.map((wrapper) => wrapper.parentElement));
    const target = document.querySelector(targetSelector);
    return {
      totalBilingual: wrappers.length,
      uniqueWrapperParents: parents.size,
      targetBilingual: target?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
      controlTexts: buttonSelector
        ? [...document.querySelectorAll(buttonSelector)].map((node) => node.textContent?.trim() || '')
        : [],
    };
  }, {targetSelector: selector, buttonSelector: controlSelector || ''});
}

async function toggleHover(page, target, selector, expectedCount, timeout) {
  const box = await target.boundingBox();
  if (!box) throw new Error('悬浮翻译目标不可见');
  const x = box.x + Math.min(Math.max(box.width * 0.35, 8), Math.max(box.width - 8, 8));
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await page.keyboard.down('Control');
  await page.keyboard.up('Control');
  try {
    await page.waitForFunction(
      ({targetSelector, count}) => document.querySelector(targetSelector)?.querySelectorAll('.fluent-read-bilingual-content').length === count,
      {targetSelector: selector, count: expectedCount},
      {timeout},
    );
  } catch (error) {
    const diagnostics = await page.evaluate((targetSelector) => {
      const target = document.querySelector(targetSelector);
      return {
        url: location.href,
        text: target?.textContent?.trim() || '',
        bilingualCount: target?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
        loadingCount: target?.querySelectorAll('.fluent-read-loading').length || 0,
        retryCount: target?.querySelectorAll('.fluent-read-retry-wrapper').length || 0,
      };
    }, selector);
    throw new Error(`${error.message}\n悬浮 case 诊断：${JSON.stringify(diagnostics)}`);
  }
}

async function toggleFull(page) {
  // 全文翻译使用产品真实快捷键 Alt+T，而不是点击浮球或构造 KeyboardEvent。
  await page.keyboard.down('Alt');
  await page.keyboard.press('t');
  await page.keyboard.up('Alt');
}

async function runHoverCase(page, selector, timeout, artifactsDir) {
  const target = page.locator(selector).first();
  const targets = page.locator(selector);
  const initialUrl = page.url();
  const counts = [];
  const neighborCounts = [];
  const hasNeighbor = await targets.count() > 1;

  for (const expected of [1, 0, 1]) {
    await toggleHover(page, target, selector, expected, timeout);
    counts.push(await target.locator('.fluent-read-bilingual-content').count());
    neighborCounts.push(hasNeighbor ? await targets.nth(1).locator('.fluent-read-bilingual-content').count() : 0);
    if (neighborCounts.at(-1) !== 0) throw new Error(`悬浮 case 误翻译相邻节点：${JSON.stringify(neighborCounts)}`);
    if (page.url() !== initialUrl) throw new Error(`悬浮 case 发生意外跳转：${page.url()}`);
    if (artifactsDir && expected === 1) {
      const name = counts.length === 1 ? 'hover-first-translation.png' : 'hover-final-translation.png';
      await page.screenshot({path: path.join(artifactsDir, name), fullPage: true});
    }
  }

  const translationText = (await target.locator('.fluent-read-bilingual-content').first().textContent() || '').trim();
  if (!/[\u3400-\u9fff]/u.test(translationText)) throw new Error(`悬浮译文没有中文：${translationText}`);
  return {counts, neighborCounts, translationText};
}

async function runFullCase(page, selector, controlSelector, timeout, artifactsDir) {
  const initialUrl = page.url();
  const target = page.locator(selector).first();
  await toggleFull(page);
  try {
    await page.waitForFunction(
      (targetSelector) => document.querySelector(targetSelector)?.querySelectorAll('.fluent-read-bilingual-content').length === 1,
      selector,
      {timeout},
    );
  } catch (error) {
    const diagnostics = await page.evaluate((targetSelector) => {
      const targetNode = document.querySelector(targetSelector);
      return {
        totalBilingual: document.querySelectorAll('.fluent-read-bilingual-content').length,
        targetText: targetNode?.textContent?.trim() || '',
        targetBilingual: targetNode?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
        targetLoading: targetNode?.querySelectorAll('.fluent-read-loading').length || 0,
        targetRetry: targetNode?.querySelectorAll('.fluent-read-retry-wrapper').length || 0,
        translatedNodes: [...document.querySelectorAll('.fluent-read-bilingual-content')].map((node) => ({
          text: node.textContent?.trim() || '',
          parent: node.parentElement?.outerHTML.slice(0, 500) || '',
        })),
        bodyText: (document.body?.innerText || '').slice(0, 1000),
      };
    }, selector);
    throw new Error(`${error.message}\n全文 case 诊断：${JSON.stringify(diagnostics)}`);
  }
  const translated = await readTargetState(page, selector);
  if (translated.bilingualCount !== 1 || !/[\u3400-\u9fff]/u.test(translated.text)) {
    throw new Error(`全文首次翻译状态异常：${JSON.stringify(translated)}`);
  }
  await scrollAndWaitFullPage(page, timeout);
  const translatedPage = await readFullPageState(page, selector, controlSelector);
  if (translatedPage.targetBilingual !== 1 || translatedPage.totalBilingual < 1 ||
      translatedPage.uniqueWrapperParents !== translatedPage.totalBilingual) {
    throw new Error(`全文滚动后状态异常：${JSON.stringify(translatedPage)}`);
  }
  if (controlSelector && (translatedPage.controlTexts.length === 0 ||
      translatedPage.controlTexts.some((text) => !/[\u3400-\u9fff]/u.test(text)))) {
    throw new Error(`全文按钮没有统一替换为译文：${JSON.stringify(translatedPage.controlTexts)}`);
  }
  if (artifactsDir) await page.screenshot({path: path.join(artifactsDir, 'full-first-translation.png'), fullPage: true});

  await toggleFull(page);
  await page.waitForFunction(
    (targetSelector) => !document.querySelector(targetSelector)?.querySelector('.fluent-read-bilingual-content'),
    selector,
    {timeout},
  );
  const restored = await readTargetState(page, selector);
  if (restored.bilingualCount !== 0) throw new Error(`全文恢复仍残留译文：${JSON.stringify(restored)}`);

  await toggleFull(page);
  await page.waitForFunction(
    (targetSelector) => document.querySelector(targetSelector)?.querySelectorAll('.fluent-read-bilingual-content').length === 1,
    selector,
    {timeout},
  );
  const retranslated = await readTargetState(page, selector);
  if (retranslated.bilingualCount !== 1 || !/[\u3400-\u9fff]/u.test(retranslated.text)) {
    throw new Error(`全文再次翻译状态异常：${JSON.stringify(retranslated)}`);
  }
  await scrollAndWaitFullPage(page, timeout);
  const retranslatedPage = await readFullPageState(page, selector, controlSelector);
  if (retranslatedPage.targetBilingual !== 1 || retranslatedPage.totalBilingual < 1 ||
      retranslatedPage.uniqueWrapperParents !== retranslatedPage.totalBilingual) {
    throw new Error(`全文再次滚动后状态异常：${JSON.stringify(retranslatedPage)}`);
  }
  if (controlSelector && (retranslatedPage.controlTexts.length === 0 ||
      retranslatedPage.controlTexts.some((text) => !/[\u3400-\u9fff]/u.test(text)))) {
    throw new Error(`全文再次翻译按钮没有统一替换为译文：${JSON.stringify(retranslatedPage.controlTexts)}`);
  }
  if (artifactsDir) await page.screenshot({path: path.join(artifactsDir, 'full-final-translation.png'), fullPage: true});
  if (page.url() !== initialUrl) throw new Error(`全文 case 发生意外跳转：${page.url()}`);
  return {translated, translatedPage, restored, retranslated, retranslatedPage};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const extensionDir = path.resolve(args.extensionDir);
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error('插件 manifest.json 不存在');
  if (!fs.existsSync(args.browserPath)) throw new Error(`浏览器不存在：${args.browserPath}`);

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-site-case-'));
  assertDedicatedProfile(profileDir);
  const artifactsDir = args.artifactsDir ? path.resolve(args.artifactsDir) : null;
  if (artifactsDir) fs.mkdirSync(artifactsDir, {recursive: true});
  const {chromium} = loadPlaywright(args.playwrightRoot);
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: args.browserPath,
      headless: false,
      viewport: {width: 1280, height: 900},
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        ...(args.background ? ['--start-minimized', '--window-position=-10000,-10000'] : []),
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    const page = await context.newPage();
    await page.goto(args.url, {waitUntil: 'domcontentloaded', timeout: args.timeout});
    // 当前 main 默认关闭悬浮球，但 Control/Alt+T 快捷键仍独立工作；
    // 这里等待 content script 初始化，而不是要求 UI 浮球必须存在。
    await page.waitForTimeout(1000);
    await waitForStableTarget(page, args.selector, args.timeout);
    const configResult = await readConfig(context, args.timeout);
    const config = configResult.config || {};
    const expectedHotkey = args.mode === 'hover' ? args.hoverHotkey : args.fullPageHotkey;
    if (config.service !== args.service) throw new Error(`服务不符：预期 ${args.service}，实际 ${config.service}`);
    if (Number(config.display) !== 1) throw new Error(`预期双语模式 display=1，实际 ${config.display}`);
    if (args.mode === 'hover' && config.hotkey !== expectedHotkey) throw new Error(`悬浮快捷键不符：${config.hotkey}`);
    if (args.mode === 'full' && config.floatingBallHotkey !== expectedHotkey) throw new Error(`全文快捷键不符：${config.floatingBallHotkey}`);
    await page.bringToFront();

    const result = args.mode === 'hover'
      ? await runHoverCase(page, args.selector, args.timeout, artifactsDir)
      : await runFullCase(page, args.selector, args.controlSelector, args.timeout, artifactsDir);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      case: args.case,
      mode: args.mode,
      url: args.url,
      selector: args.selector,
      windowMode: args.background ? 'background-screen-off' : 'headed-isolated',
      service: config.service,
      display: config.display,
      screenshots: artifactsDir ? fs.readdirSync(artifactsDir).map((name) => path.join(artifactsDir, name)) : [],
      ...result,
    }, null, 2)}\n`);
  } finally {
    if (context) await context.close().catch(() => {});
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

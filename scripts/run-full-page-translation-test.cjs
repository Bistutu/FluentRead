#!/usr/bin/env node

// 这个脚本只使用临时 Edge profile 和真实 Alt+T 键盘手势，回归全文翻译的
// 识别、按钮特殊处理、富文本结构、动态节点、Shadow DOM 以及恢复流程。
// 它不会连接用户正在使用的浏览器 profile，也不会通过 JS 合成键盘事件。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

function parseArgs(argv) {
  const args = {
    url: 'http://127.0.0.1:8123/unified-translation-fixture.html',
    browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    background: true,
    timeout: 120000,
    // 当前 main 的默认服务是“免费翻译服务”，内部按微软、DeepLX、谷歌顺序回退；
    // --service 只用于断言已预置的隔离 profile 配置，不会偷偷修改服务选择。
    service: 'freeTranslation',
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
  if (!args.extensionDir) throw new Error('必须传入 --extension-dir');
  if (!args.playwrightRoot) throw new Error('必须传入 --playwright-root');
  return args;
}

function loadPlaywright(root) {
  try {
    return require('playwright');
  } catch {
    const resolvedRoot = path.resolve(root);
    const loader = createRequire(path.join(resolvedRoot, '__fluentread_full_page_loader__.cjs'));
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

async function waitFor(page, predicate, timeout, description) {
  await page.waitForFunction(predicate, undefined, { timeout });
  if (description) return description;
}

async function readConfig(context, timeout) {
  const workers = context.serviceWorkers();
  const worker = workers[0] || await context.waitForEvent('serviceworker', { timeout: Math.min(timeout, 30000) });
  const match = worker.url().match(/^chrome-extension:\/\/([^/]+)/);
  if (!match) throw new Error('没有找到扩展 service worker');
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${match[1]}/popup.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const stored = await popup.evaluate(() => chrome.storage.local.get('config'));
    const config = typeof stored.config === 'string' ? JSON.parse(stored.config) : stored.config;
    return { extensionId: match[1], config };
  } finally {
    await popup.close();
  }
}

async function toggleFullPage(page) {
  // 使用 Playwright 的真实 Alt/T 键序列，对应插件默认全文快捷键 Alt+T。
  await page.keyboard.down('Alt');
  await page.keyboard.press('t');
  await page.keyboard.up('Alt');
}

async function installShortcutDiagnostics(page) {
  await page.evaluate(() => {
    window.__fluentReadFullPageDebug = { keydowns: [], toggleEvents: 0 };
    document.addEventListener('keydown', (event) => {
      window.__fluentReadFullPageDebug.keydowns.push({
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        defaultPrevented: event.defaultPrevented,
      });
    });
    document.addEventListener('fluentread-toggle-translation', () => {
      window.__fluentReadFullPageDebug.toggleEvents += 1;
    });
  });
}

async function readShortcutDiagnostics(page) {
  return page.evaluate(() => ({
    debug: window.__fluentReadFullPageDebug || null,
    bilingualCount: document.querySelectorAll('.fluent-read-bilingual-content').length,
    loadingCount: document.querySelectorAll('.fluent-read-loading').length,
    retryCount: document.querySelectorAll('.fluent-read-retry-wrapper').length,
    buttonTexts: {
      save: document.querySelector('#save-button')?.textContent?.trim() || '',
      cancel: document.querySelector('#cancel-button')?.textContent?.trim() || '',
    },
    targetStates: ['#paragraph-one', '#paragraph-two', '#save-button', '#cancel-button']
      .map((selector) => ({
        selector,
        bilingual: document.querySelector(selector)?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
        loading: document.querySelector(selector)?.querySelectorAll('.fluent-read-loading').length || 0,
      })),
    shadowState: (() => {
      const shadow = document.querySelector('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph');
      return { bilingual: shadow?.querySelectorAll('.fluent-read-bilingual-content').length || 0, loading: shadow?.querySelectorAll('.fluent-read-loading').length || 0 };
    })(),
  }));
}

async function pageState(page) {
  return page.evaluate(() => {
    const get = (selector) => document.querySelector(selector);
    const count = (selector) => get(selector)?.querySelectorAll('.fluent-read-bilingual-content').length || 0;
    const shadowParagraph = get('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph');
    const button = get('#save-button');
    const cancelButton = get('#cancel-button');
    return {
      paragraphOne: count('#paragraph-one'),
      paragraphTwo: count('#paragraph-two'),
      heading: count('h1'),
      dynamic: count('#dynamic-paragraph'),
      shadow: shadowParagraph?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
      header: count('header'),
      nav: count('nav'),
      footer: count('footer'),
      buttonBilingualCount: button?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
      buttonText: button?.textContent?.trim() || '',
      cancelButtonText: cancelButton?.textContent?.trim() || '',
      cancelButtonBilingualCount: cancelButton?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
      buttonIconPresent: Boolean(button?.querySelector('[aria-hidden="true"]')),
      codePreserved: Boolean(get('#paragraph-one .fluent-read-bilingual-content code')?.textContent.includes('const value = 42')),
      linkPreserved: get('#paragraph-one .fluent-read-bilingual-content a')?.getAttribute('href') || null,
    };
  });
}

function assertTranslated(state, label) {
  if (state.paragraphOne !== 1 || state.paragraphTwo !== 1 || state.heading !== 1 || state.dynamic !== 1 || state.shadow !== 1) {
    throw new Error(`${label} 内容块翻译数量不正确：${JSON.stringify(state)}`);
  }
  if (state.header !== 0 || state.nav !== 0 || state.footer !== 0) throw new Error(`${label} 导航/页脚被误翻译`);
  if (state.buttonBilingualCount !== 0 || state.cancelButtonBilingualCount !== 0 ||
      !/[\u3400-\u9fff]/u.test(state.buttonText) || !/[\u3400-\u9fff]/u.test(state.cancelButtonText) ||
      !state.buttonIconPresent) {
    throw new Error(`${label} 按钮没有按控件规则保留结构并替换文字：${JSON.stringify(state)}`);
  }
  if (!state.codePreserved || !['https://example.com', 'https://example.com/'].includes(state.linkPreserved)) {
    throw new Error(`${label} 富文本结构没有保留：${JSON.stringify(state)}`);
  }
}

function assertRestored(state) {
  if (state.paragraphOne || state.paragraphTwo || state.heading || state.dynamic || state.shadow) {
    throw new Error(`全文恢复后仍残留译文：${JSON.stringify(state)}`);
  }
  if (state.buttonText !== '★Save changes' || state.cancelButtonText !== 'Cancel' ||
      !state.buttonIconPresent || state.buttonBilingualCount !== 0 || state.cancelButtonBilingualCount !== 0) {
    throw new Error(`按钮恢复不完整：${JSON.stringify(state)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const extensionDir = path.resolve(args.extensionDir);
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error('插件 manifest.json 不存在');
  if (!fs.existsSync(args.browserPath)) throw new Error(`浏览器不存在：${args.browserPath}`);

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-full-page-'));
  assertDedicatedProfile(profileDir);
  const artifactsDir = args.artifactsDir ? path.resolve(args.artifactsDir) : null;
  if (artifactsDir) fs.mkdirSync(artifactsDir, { recursive: true });
  const { chromium } = loadPlaywright(args.playwrightRoot);
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: args.browserPath,
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        ...(args.background ? ['--start-minimized', '--window-position=-10000,-10000'] : []),
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    const page = await context.newPage();
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: args.timeout });
    // 当前 main 默认关闭悬浮球，但悬浮/全文快捷键仍由 content script 独立监听；
    // 不能把“悬浮球是否挂载”当作扩展已加载的判据。
    await page.waitForTimeout(1000);
    const configResult = await readConfig(context, args.timeout);
    if (configResult.config?.floatingBallHotkey !== 'Alt+T') throw new Error(`全文快捷键不是 Alt+T：${configResult.config?.floatingBallHotkey}`);
    if (configResult.config?.service !== args.service) throw new Error(`翻译服务不符：预期 ${args.service}，实际 ${configResult.config?.service}`);
    await page.bringToFront();

    await installShortcutDiagnostics(page);
    await toggleFullPage(page);
    try {
      await waitFor(page, () => document.querySelector('#paragraph-one .fluent-read-bilingual-content') &&
        document.querySelector('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph .fluent-read-bilingual-content') &&
        /[\u3400-\u9fff]/u.test(document.querySelector('#save-button')?.textContent || '') &&
        /[\u3400-\u9fff]/u.test(document.querySelector('#cancel-button')?.textContent || ''), args.timeout);
    } catch (error) {
      const diagnostics = await readShortcutDiagnostics(page);
      throw new Error(`${error.message}\n全文快捷键诊断：${JSON.stringify(diagnostics)}`);
    }

    // 在会话已经启动后再插入节点，确认 MutationObserver 能把新内容纳入全文队列。
    await page.evaluate(() => {
      const container = document.querySelector('#dynamic-container');
      const paragraph = document.createElement('p');
      paragraph.id = 'dynamic-paragraph';
      paragraph.textContent = 'This paragraph is inserted after the full page session starts.';
      container.appendChild(paragraph);
    });
    await waitFor(page, () => document.querySelector('#dynamic-paragraph .fluent-read-bilingual-content'), args.timeout);
    const translated = await pageState(page);
    assertTranslated(translated, '第一次全文翻译');
    if (artifactsDir) await page.screenshot({ path: path.join(artifactsDir, 'full-page-translated.png'), fullPage: true });

    await toggleFullPage(page);
    await waitFor(page, () => !document.querySelector('.fluent-read-bilingual-content'), args.timeout);
    const restored = await pageState(page);
    assertRestored(restored);

    await toggleFullPage(page);
    await waitFor(page, () => document.querySelector('#paragraph-one .fluent-read-bilingual-content') &&
      document.querySelector('#dynamic-paragraph .fluent-read-bilingual-content') &&
      document.querySelector('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph .fluent-read-bilingual-content') &&
      /[\u3400-\u9fff]/u.test(document.querySelector('#save-button')?.textContent || '') &&
      /[\u3400-\u9fff]/u.test(document.querySelector('#cancel-button')?.textContent || ''), args.timeout);
    const retranslated = await pageState(page);
    assertTranslated(retranslated, '再次全文翻译');
    if (artifactsDir) await page.screenshot({ path: path.join(artifactsDir, 'full-page-retranslated.png'), fullPage: true });

    process.stdout.write(`${JSON.stringify({
      ok: true,
      windowMode: args.background ? 'background-screen-off' : 'headed-isolated',
      profileDir,
      url: args.url,
      extensionId: configResult.extensionId,
      config: { floatingBallHotkey: configResult.config.floatingBallHotkey, service: configResult.config.service, display: configResult.config.display },
      translated,
      restored,
      retranslated,
      screenshots: artifactsDir ? [path.join(artifactsDir, 'full-page-translated.png'), path.join(artifactsDir, 'full-page-retranslated.png')] : [],
    }, null, 2)}\n`);
  } finally {
    if (context) await context.close().catch(() => {});
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const DOCUMENT_EXAMPLES = [
  {name: 'sample.html', badge: 'HTML', mimeType: 'text/html', source: 'Document translation example'},
  {name: 'sample.txt', badge: 'TXT', mimeType: 'text/plain', source: 'Document translation example'},
  {name: 'sample.md', badge: 'MARKDOWN', mimeType: 'text/markdown', source: 'Document translation example'},
  {name: 'sample.srt', badge: 'SRT', mimeType: 'text/plain', source: 'Hello subtitle'},
  {name: 'sample.vtt', badge: 'VTT', mimeType: 'text/vtt', source: 'Hello VTT subtitle'},
  {name: 'sample.ass', badge: 'ASS', mimeType: 'text/plain', source: 'Hello ASS subtitle'},
  {name: 'sample.ssa', badge: 'ASS', mimeType: 'text/plain', source: 'Hello SSA subtitle'},
  {name: 'sample.lrc', badge: 'LRC', mimeType: 'text/plain', source: 'Hello LRC lyric'},
  {name: 'sample.json', badge: 'JSON', mimeType: 'application/json', source: 'Document translation example'},
];

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = {
    browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    timeout: 60000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) fail(`无法识别的参数：${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`参数缺少值：${token}`);
    args[key] = value;
    index += 1;
  }
  args.timeout = Number(args.timeout);
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) fail('--timeout 必须是正数');
  return args;
}

function loadPlaywright(playwrightRoot) {
  try {
    return require('playwright');
  } catch (error) {
    if (!playwrightRoot) fail(`无法加载 Playwright：${error.message}`);
    const root = path.resolve(playwrightRoot);
    const requireFromRuntime = createRequire(path.join(root, '__fluentread_document_test__.cjs'));
    return requireFromRuntime('playwright');
  }
}

function captureErrors(target, label, errors) {
  target.on('console', (message) => {
    if (message.type() === 'error') errors.push({label, type: 'console', message: message.text()});
  });
  target.on('pageerror', (error) => errors.push({label, type: 'pageerror', message: error.message}));
}

function isExpectedShutdownNoise(error) {
  return error.type === 'console' && /browser is shutting down/u.test(error.message);
}

async function waitForServiceWorker(context, timeout) {
  if (context.serviceWorkers().length > 0) return context.serviceWorkers()[0];
  return context.waitForEvent('serviceworker', {timeout});
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.extensionDir) fail('必须传入 --extension-dir');
  const extensionDir = path.resolve(args.extensionDir);
  const manifestPath = path.join(extensionDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`找不到扩展清单：${manifestPath}`);
  if (!fs.existsSync(path.join(extensionDir, 'document.html'))) fail('生产产物缺少 document.html');
  if (!fs.existsSync(args.browserPath)) fail(`找不到浏览器：${args.browserPath}`);
  const exampleDir = path.resolve(args.exampleDir || path.join(process.cwd(), 'examples/document-translation'));
  if (!fs.existsSync(exampleDir)) fail(`找不到文档示例目录：${exampleDir}`);
  for (const example of DOCUMENT_EXAMPLES) {
    const examplePath = path.join(exampleDir, example.name);
    if (!fs.existsSync(examplePath)) fail(`缺少文档示例：${examplePath}`);
  }

  const {chromium} = loadPlaywright(args.playwrightRoot);
  const artifactsDir = path.resolve(args.artifactsDir || path.join(os.tmpdir(), 'fluentread-document-evidence'));
  fs.mkdirSync(artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-document-edge-profile-'));
  const errors = [];
  const result = {
    ok: false,
    extensionDir,
    exampleDir,
    profileDir,
    artifactsDir,
    windowMode: 'background-screen-off',
    assertions: {},
    screenshots: [],
    errors,
  };

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: args.browserPath,
      headless: false,
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--start-minimized',
        '--window-position=-10000,-10000',
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: {width: 1440, height: 960},
    });

    const worker = await waitForServiceWorker(context, Math.min(args.timeout, 30000));
    captureErrors(worker, 'service-worker', errors);
    const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)/)?.[1];
    if (!extensionId) fail(`无法从 Service Worker URL 获取扩展 ID：${worker.url()}`);
    result.extensionId = extensionId;
    const documentUrl = `chrome-extension://${extensionId}/document.html`;
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;

    const page = await context.newPage();
    captureErrors(page, 'document', errors);
    await page.goto(documentUrl, {waitUntil: 'domcontentloaded', timeout: args.timeout});
    await page.locator('.file-drop-zone').waitFor({state: 'visible', timeout: args.timeout});
    const formatCards = await page.locator('.format-card').count();
    if (formatCards !== 8) fail(`文档页格式卡片应为 8 个，实际为 ${formatCards}`);
    result.assertions.formatCards = formatCards;
    await page.screenshot({path: path.join(artifactsDir, 'document-empty.png'), fullPage: true});
    result.screenshots.push(path.join(artifactsDir, 'document-empty.png'));

    const exampleLoads = {};
    for (const [index, example] of DOCUMENT_EXAMPLES.entries()) {
      if (index > 0) {
        await page.getByRole('button', {name: '打开新文件'}).click();
        await page.locator('.file-drop-zone').waitFor({state: 'visible', timeout: args.timeout});
      }

      await page.locator('input[type=file]').setInputFiles({
        name: example.name,
        mimeType: example.mimeType,
        buffer: fs.readFileSync(path.join(exampleDir, example.name)),
      });
      await page.locator('.workspace-section').waitFor({state: 'visible', timeout: args.timeout});
      if ((await page.locator('.workspace-heading h1').textContent())?.trim() !== example.name) {
        fail(`${example.name} 加载后文件名不正确`);
      }
      if ((await page.locator('.file-type-badge').textContent())?.trim() !== example.badge) {
        fail(`${example.name} 文件格式徽标不正确`);
      }
      const previewCount = await page.locator('.reader-block').count();
      if (previewCount < 1) fail(`${example.name} 加载后没有阅读片段`);
      if (!(await page.locator('.reader-source').first().textContent())?.includes(example.source)) {
        fail(`${example.name} 首个可翻译片段不正确`);
      }
      if (await page.getByRole('button', {name: '开始翻译'}).count() !== 1) {
        fail(`${example.name} 缺少开始翻译按钮`);
      }
      exampleLoads[example.name] = {badge: example.badge, previewCount};

      if (example.name === 'sample.html') {
        result.assertions.htmlLoad = 'passed';
        await page.screenshot({path: path.join(artifactsDir, 'document-html-loaded.png'), fullPage: true});
        result.screenshots.push(path.join(artifactsDir, 'document-html-loaded.png'));
      }
      if (example.name === 'sample.srt') {
        result.assertions.subtitleLoad = 'passed';
        await page.screenshot({path: path.join(artifactsDir, 'document-srt-loaded.png'), fullPage: true});
        result.screenshots.push(path.join(artifactsDir, 'document-srt-loaded.png'));
      }
      if (example.name === 'sample.md') {
        if (await page.locator('.preview-table').count() !== 0) fail('Markdown 文档不应使用表格作为主阅读界面');
        result.assertions.markdownReader = 'passed';
        await page.screenshot({path: path.join(artifactsDir, 'document-markdown-reader.png'), fullPage: true});
        result.screenshots.push(path.join(artifactsDir, 'document-markdown-reader.png'));
      }
    }
    result.assertions.exampleLoads = exampleLoads;

    await page.locator('[aria-label="文档翻译服务"]').selectOption('openai');
    const documentModel = page.locator('[aria-label="文档翻译模型"]');
    await documentModel.waitFor({state: 'visible', timeout: args.timeout});
    const modelOptions = await documentModel.locator('option').count();
    if (modelOptions < 2) fail(`文档翻译模型选项过少：${modelOptions}`);
    await documentModel.selectOption('gpt-5.4-mini');
    if (await documentModel.inputValue() !== 'gpt-5.4-mini') fail('文档翻译模型没有保存当前选择');
    result.assertions.documentModelSelection = 'passed';
    await page.screenshot({path: path.join(artifactsDir, 'document-model-selection.png'), fullPage: true});
    result.screenshots.push(path.join(artifactsDir, 'document-model-selection.png'));

    const popup = await context.newPage();
    captureErrors(popup, 'popup', errors);
    await popup.setViewportSize({width: 400, height: 600});
    await popup.goto(popupUrl, {waitUntil: 'domcontentloaded', timeout: args.timeout});
    await popup.locator('.popup-shell').waitFor({state: 'visible', timeout: args.timeout});
    const popupMetrics = await popup.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    if (popupMetrics.width > 400 || popupMetrics.height > 600 || popupMetrics.horizontalOverflow) {
      fail(`Popup 布局超出边界：${JSON.stringify(popupMetrics)}`);
    }
    result.assertions.popupMetrics = popupMetrics;
    await popup.screenshot({path: path.join(artifactsDir, 'popup-document-beta.png'), fullPage: true});
    result.screenshots.push(path.join(artifactsDir, 'popup-document-beta.png'));
    const featureOrder = await popup.locator('.feature-card').evaluateAll((cards) => cards.map((card) => ({
      feature: card.getAttribute('data-feature') || card.textContent?.trim() || '',
      text: card.textContent?.trim() || '',
    })));
    const videoIndex = featureOrder.findIndex((item) => item.text.includes('视频字幕'));
    const documentIndex = featureOrder.findIndex((item) => item.feature === 'document-translation');
    if (videoIndex < 0 || documentIndex !== videoIndex + 1) fail('文档翻译卡片必须紧跟在视频字幕卡片下面');
    if (!featureOrder[documentIndex].text.includes('Beta 测试')) fail('文档翻译卡片必须标注 Beta 测试');
    result.assertions.popupDocumentBeta = 'passed';
    const openedPagePromise = context.waitForEvent('page', {timeout: args.timeout});
    await popup.getByRole('button', {name: '打开文档翻译'}).click();
    const openedPage = await openedPagePromise;
    captureErrors(openedPage, 'document-from-popup', errors);
    await openedPage.waitForURL(documentUrl, {timeout: args.timeout});
    await openedPage.locator('.file-drop-zone').waitFor({state: 'visible', timeout: args.timeout});
    result.assertions.popupEntry = 'passed';
    await openedPage.close();
    await popup.close();
    await page.close();

    result.ok = true;
  } finally {
    if (context) await context.close().catch(() => undefined);
    fs.rmSync(profileDir, {recursive: true, force: true});
  }

  const runtimeErrors = errors.filter((error) => !isExpectedShutdownNoise(error));
  result.errors = runtimeErrors;
  result.assertions.consoleErrors = runtimeErrors.length;
  if (runtimeErrors.length > 0) {
    result.ok = false;
    fail(`文档页隔离浏览器出现控制台错误：${JSON.stringify(runtimeErrors)}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

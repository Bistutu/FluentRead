#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = {
    url: 'https://example.com',
    selector: 'p',
    translatedSelector: '.fluent-read-bilingual-content',
    injectedSelector: '#fluent-read-floating-ball-container',
    expectedHotkey: 'Control',
    timeout: 120000,
    browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    keepProfile: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--keep-profile') {
      args.keepProfile = true;
      continue;
    }
    if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for ${token}`);
    args[key] = value;
    index += 1;
  }

  args.timeout = Number(args.timeout);
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) fail('--timeout must be a positive number');
  return args;
}

function loadPlaywright(playwrightRoot) {
  try {
    return require('playwright');
  } catch (localError) {
    if (!playwrightRoot) {
      fail(`Cannot load Playwright. Pass --playwright-root <node_modules>. Original error: ${localError.message}`);
    }
    const root = path.resolve(playwrightRoot);
    if (!fs.existsSync(root)) fail(`Playwright root does not exist: ${root}`);
    const requireFromRuntime = createRequire(path.join(root, '__fluentread_skill_loader__.cjs'));
    return requireFromRuntime('playwright');
  }
}

function normalizeConfig(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

async function readExtensionConfig(context, timeout) {
  let workers = context.serviceWorkers();
  if (workers.length === 0) {
    try {
      workers = [await context.waitForEvent('serviceworker', { timeout: Math.min(timeout, 30000) })];
    } catch {
      return { extensionId: null, config: null };
    }
  }

  const workerUrl = workers[0].url();
  const match = workerUrl.match(/^chrome-extension:\/\/([^/]+)/);
  if (!match) return { extensionId: null, config: null };

  const extensionId = match[1];
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const stored = await popup.evaluate(async () => chrome.storage.local.get('config'));
    return { extensionId, config: normalizeConfig(stored.config) };
  } finally {
    await popup.close();
  }
}

function publicConfig(config) {
  if (!config) return null;
  return {
    on: config.on,
    from: config.from,
    to: config.to,
    display: config.display,
    style: config.style,
    hotkey: config.hotkey,
    service: config.service,
    model: config.model,
  };
}

async function countTranslations(target, translatedSelector) {
  return target.locator(translatedSelector).count();
}

async function waitForCount(page, targetSelector, translatedSelector, expected, timeout) {
  await page.waitForFunction(
    ({ targetSelector: selector, translatedSelector: childSelector, expected: count }) => {
      const target = document.querySelector(selector);
      return target ? target.querySelectorAll(childSelector).length === count : false;
    },
    { targetSelector, translatedSelector, expected },
    { timeout },
  );
}

async function gesture(page, target, targetSelector, translatedSelector, expectedCount, timeout) {
  const box = await target.boundingBox();
  if (!box) fail(`Target is not visible: ${targetSelector}`);
  const x = box.x + Math.min(Math.max(box.width * 0.35, 8), Math.max(box.width - 8, 8));
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await page.keyboard.down('Control');
  await page.keyboard.up('Control');
  await waitForCount(page, targetSelector, translatedSelector, expectedCount, timeout);
  return countTranslations(target, translatedSelector);
}

async function navigateWithRetry(page, url, timeout) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      return;
    } catch (error) {
      lastError = error;
      const isStartupAbort = String(error.message).includes('net::ERR_ABORTED');
      if (!isStartupAbort || attempt === 3) throw error;
      await page.waitForTimeout(750 * attempt);
    }
  }
  throw lastError;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.extensionDir) fail('--extension-dir is required');

  const extensionDir = path.resolve(args.extensionDir);
  const manifestPath = path.join(extensionDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`Extension manifest not found: ${manifestPath}`);
  if (!fs.existsSync(args.browserPath)) fail(`Browser executable not found: ${args.browserPath}`);

  let artifactsDir = null;
  if (args.artifactsDir) {
    artifactsDir = path.resolve(args.artifactsDir);
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const suppliedProfile = Boolean(args.profileDir);
  const profileDir = suppliedProfile
    ? path.resolve(args.profileDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-edge-profile-'));
  if (suppliedProfile) fs.mkdirSync(profileDir, { recursive: true });
  const { chromium } = loadPlaywright(args.playwrightRoot);
  let context;
  const result = {
    ok: false,
    browser: 'Microsoft Edge',
    extensionDir,
    profileDir,
    profileMode: suppliedProfile ? 'supplied-dedicated' : 'generated-temporary',
    url: args.url,
    selector: args.selector,
    counts: [],
    neighborCounts: [],
    screenshots: [],
  };

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: args.browserPath,
      headless: false,
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: { width: 1280, height: 900 },
    });

    const page = await context.newPage();
    await navigateWithRetry(page, args.url, args.timeout);
    await page.waitForSelector(args.injectedSelector, { state: 'attached', timeout: Math.min(args.timeout, 45000) });

    const { extensionId, config } = await readExtensionConfig(context, args.timeout);
    result.extensionId = extensionId;
    result.config = publicConfig(config);
    if (!config) fail('Could not read FluentRead config from chrome.storage.local');
    if (config.on !== true) fail('FluentRead is disabled in the active profile');
    if (Number(config.display) !== 1) fail(`Expected bilingual display=1, received ${config.display}`);
    if (args.expectedHotkey && config.hotkey !== args.expectedHotkey) {
      fail(`Expected hotkey ${args.expectedHotkey}, received ${config.hotkey}`);
    }
    if (args.expectedService && config.service !== args.expectedService) {
      fail(`Expected service ${args.expectedService}, received ${config.service}`);
    }

    const targets = page.locator(args.selector);
    if (await targets.count() === 0) fail(`No target matched selector: ${args.selector}`);
    const target = targets.first();
    const neighbor = targets.nth(1);
    const hasNeighbor = await targets.count() > 1;
    const initialUrl = page.url();

    for (const expected of [1, 0, 1]) {
      const count = await gesture(page, target, args.selector, args.translatedSelector, expected, args.timeout);
      result.counts.push(count);
      const neighborCount = hasNeighbor ? await countTranslations(neighbor, args.translatedSelector) : 0;
      result.neighborCounts.push(neighborCount);
      if (neighborCount !== 0) fail(`Neighbor paragraph was translated during state ${expected}`);
      if (page.url() !== initialUrl) fail(`Page navigated unexpectedly: ${page.url()}`);

      if (artifactsDir && expected === 1) {
        const occurrence = result.counts.length === 1 ? 'first-translation' : 'final-translation';
        const screenshotPath = path.join(artifactsDir, `${occurrence}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        result.screenshots.push(screenshotPath);
      }
    }

    const translationText = (await target.locator(args.translatedSelector).first().textContent() || '').trim();
    result.translationText = translationText;
    if (!/[\u3400-\u9fff]/u.test(translationText)) fail(`Final translation has no CJK text: ${translationText}`);
    if (args.expectedText && !translationText.includes(args.expectedText)) {
      fail(`Expected translation fragment not found: ${args.expectedText}`);
    }

    result.ok = true;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (context) await context.close().catch(() => {});
    if (!suppliedProfile && !args.keepProfile) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } else if (!suppliedProfile) {
      process.stderr.write(`Kept temporary profile: ${profileDir}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

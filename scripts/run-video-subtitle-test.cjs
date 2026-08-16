#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

function loadPlaywright(root) {
  try { return require('playwright'); } catch {
    const runtimeRequire = createRequire(path.join(path.resolve(root), '__fluentread_video_test__.cjs'));
    return runtimeRequire('playwright');
  }
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
  const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3-dev'));
  const playwrightRoot = arg('playwright-root', process.env.PLAYWRIGHT_ROOT);
  const url = arg('url', 'https://www.youtube.com/watch?v=drSMZgnmJjk');
  const artifactsDir = path.resolve(arg('artifacts-dir', path.join(os.tmpdir(), 'fluentread-video-subtitle-evidence')));
  const browserPath = arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-edge-video-profile-'));
  fs.mkdirSync(artifactsDir, { recursive: true });
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error(`找不到扩展构建：${extensionDir}`);

  const { chromium } = loadPlaywright(playwrightRoot);
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: browserPath,
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--start-minimized', '--window-position=-10000,-10000',
      '--no-first-run', '--no-default-browser-check',
    ],
    viewport: { width: 1280, height: 900 },
  });

  try {
    const workers = context.serviceWorkers();
    const worker = workers[0] || await context.waitForEvent('serviceworker', { timeout: 30000 });
    const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)/)?.[1];
    if (!extensionId) throw new Error('无法取得扩展 ID');

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await popup.waitForSelector('[data-feature="video-subtitle"]', { timeout: 15000 });
    await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('config');
      const config = stored.config || {};
      await chrome.storage.local.set({ config: {
        ...config,
        on: true,
        display: 1,
        from: 'auto',
        to: 'zh-Hans',
        service: 'deeplx',
        videoTranslationEnabled: true,
        videoService: 'microsoft',
        useCache: false,
      }});
    });
    const popupState = await popup.evaluate(async () => {
      const stored = await chrome.storage.local.get('config');
      return {
        featurePresent: Boolean(document.querySelector('[data-feature="video-subtitle"]')),
        featureCount: document.querySelectorAll('.feature-card').length,
        config: stored.config,
      };
    });
    await popup.locator('[data-feature="video-subtitle"]').click();
    await popup.getByText('YouTube 字幕翻译').waitFor({ state: 'visible', timeout: 10000 });
    const videoDrawerState = await popup.evaluate(() => ({
      drawerVisible: Boolean([...document.querySelectorAll('.drawer-content')].find((node) => node.textContent?.includes('视频翻译服务'))),
      providerCount: document.querySelectorAll('.drawer-content select option').length,
    }));
    await popup.screenshot({ path: path.join(artifactsDir, 'popup-video-beta-drawer.png'), fullPage: true });
    await popup.screenshot({ path: path.join(artifactsDir, 'popup-video-beta.png'), fullPage: true });
    await popup.close();

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html#settings-video`, { waitUntil: 'domcontentloaded' });
    await options.getByRole('heading', { name: '边看边译视频字幕' }).waitFor({ timeout: 15000 });
    const optionsState = await options.evaluate(() => ({
      activeNav: document.querySelector('.sidebar button.active')?.textContent?.replace(/\s+/g, ' ').trim(),
      videoSection: Boolean(document.querySelector('#settings-video')),
      providerControl: Boolean(document.querySelector('[aria-label="视频字幕翻译服务"]')),
    }));
    await options.screenshot({ path: path.join(artifactsDir, 'options-video-subtitle.png'), fullPage: true });
    await options.close();

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);

    const subtitleButton = page.locator('button.ytp-subtitles-button').first();
    if (await subtitleButton.count()) {
      if (await subtitleButton.getAttribute('aria-pressed') !== 'true') await subtitleButton.click();
      await page.waitForTimeout(2500);
    }

    const playButton = page.locator('button.ytp-play-button').first();
    if (await playButton.count() && (await playButton.getAttribute('aria-label') || '').toLowerCase().includes('play')) {
      await playButton.click().catch(() => undefined);
      await page.waitForTimeout(5000);
    }
    const nativeSubtitle = await page.locator('.ytp-caption-segment').first().count();
    const injected = await page.evaluate(() => {
      let container = document.querySelector('#ytp-caption-window-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'ytp-caption-window-container';
        document.body.appendChild(container);
      }
      container.replaceChildren();
      const segment = document.createElement('span');
      segment.className = 'ytp-caption-segment';
      segment.textContent = 'This is a FluentRead video subtitle test.';
      container.appendChild(segment);
      return Boolean(container);
    });
    await page.waitForFunction(() => {
      const overlay = document.querySelector('#fluent-read-video-subtitle');
      return Boolean(overlay?.textContent?.match(/[\u3400-\u9fff]/));
    }, { timeout: 45000 });
    const first = await page.locator('#fluent-read-video-subtitle').textContent();

    await page.evaluate(() => {
      const segment = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
      if (segment) segment.textContent = 'The second subtitle updates correctly.';
    });
    await page.waitForFunction((oldText) => {
      const overlay = document.querySelector('#fluent-read-video-subtitle');
      return Boolean(overlay?.textContent?.trim() && overlay.textContent !== oldText);
    }, first, { timeout: 45000 });
    const second = await page.locator('#fluent-read-video-subtitle').textContent();
    const overlayCount = await page.locator('#fluent-read-video-subtitle').count();

    await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('config');
      await chrome.storage.local.set({ config: { ...stored.config, videoTranslationEnabled: false }});
    });
    await page.waitForFunction(() => !document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim(), null, { timeout: 10000 });
    await page.screenshot({ path: path.join(artifactsDir, 'youtube-video-subtitle-final.png'), fullPage: false });

    console.log(JSON.stringify({
      ok: true,
      url: page.url(),
      popupState: {
        featurePresent: popupState.featurePresent,
        featureCount: popupState.featureCount,
        textService: popupState.config.service,
        videoService: popupState.config.videoService,
        videoTranslationEnabled: popupState.config.videoTranslationEnabled,
      },
      videoDrawerState,
      optionsState,
      nativeSubtitle,
      injected,
      firstTranslation: first,
      secondTranslation: second,
      overlayCount,
      disabledClearedOverlay: true,
      artifactsDir,
    }, null, 2));
  } finally {
    await context.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

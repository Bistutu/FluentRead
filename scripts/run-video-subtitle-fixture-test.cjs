#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function loadPlaywright(root) {
  try {
    return require('playwright');
  } catch {
    const runtimeRequire = createRequire(path.join(path.resolve(root), '__fluentread_video_fixture_test__.cjs'));
    return runtimeRequire('playwright');
  }
}

const OFFLINE_YOUTUBE_FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>YouTube subtitle fixture</title></head>
<body><main><div id="movie_player" class="html5-video-player"></div></main></body></html>`;


const FIXTURE_NATIVE_VIDEO_DATA_URL = [
  'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAOCbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAF3AAAQAAAQAA',
  'AAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAq10cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAF3AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAA',
  'AAAAAAAAAAAAAABAAAAAAAIAAAACAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAABdwAACAAAABAAAAAAIlbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAABgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAB0G1p',
  'bmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAZBzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAIAAgBIAAAASAAAAAAAAAABFUxhdmM2MS4xOS4xMDEgbGli',
  'eDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2V+IiMBEAAADAAQAAAMACDxIllgBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAABAkAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAYAAEAAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAABAY3R0cwAAAAAAAAAGAAAAAQAAgAAAAAABAAFAAAAAAAEAAIAAAAAAAQAAAAAAAAABAABAAAAAAAEAAIAAAAAAHHN0c2MA',
  'AAAAAAAAAQAAAAEAAAAGAAAAAQAAACxzdHN6AAAAAAAAAAAAAAAGAAACxQAAAAwAAAAMAAAADAAAAAwAAAASAAAAFHN0Y28AAAAAAAAAAQAAA7IAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0',
  'b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYxLjcuMTAwAAAACGZyZWUAAAMPbWRhdAAAAq0GBf//qdxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjQgcjMxMDggMzFlMTlmOSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5h',
  'bHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9x',
  'cF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2Fk',
  'YXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFj',
  'b21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAEGWIhAAX//731LfMsu4HI4EAAAAIQZokbEFv/vAAAAAIQZ5CeILfjIEAAAAIAZ5hdEFfkoAAAAAIAZ5jakFfkoEAAAAOQZplSahBaJlMCCv//vE=',
].join('');

async function main() {
  const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
  const playwrightRoot = arg('playwright-root', process.env.PLAYWRIGHT_ROOT);
  const url = arg('url', 'https://www.youtube.com/watch?v=drSMZgnmJjk');
  const artifactsDir = path.resolve(arg('artifacts-dir', path.join(os.tmpdir(), 'fluentread-video-subtitle-fixture')));
  const browserPath = arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-edge-video-fixture-'));
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error(`找不到扩展构建：${extensionDir}`);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const { chromium } = loadPlaywright(playwrightRoot);
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: browserPath,
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--start-minimized',
      '--window-position=-10000,-10000',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1280, height: 900 },
  });

  let translationRequests = 0;
  const translationSources = [];
  const aiTranslationSources = [];
  let navigationMode = 'live-youtube';
  await context.route('https://edge.microsoft.com/translate/translatetext**', async (route) => {
    translationRequests += 1;
    const body = route.request().postDataJSON();
    const source = Array.isArray(body) ? String(body[0] || '') : '';
    translationSources.push(source);
    const translated = source === 'and the housing market took a hit.'
      ? '房地产市场受到了冲击。'
      : source === 'understand from [music] the axioms and the basics.'
        ? '从音乐中理解公理和基础。'
        : source === 'Timeline subtitle catches up.'
          ? '时间轴已追上字幕。'
        : source === 'This subtitle was translated in advance.'
          ? '预先翻译的字幕。'
        : `【译文】${source}`;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ translations: [{ text: translated }] }]),
    });
  });
  await context.route('https://api.openai.com/v1/chat/completions**', async (route) => {
    const body = route.request().postDataJSON();
    const source = body?.messages?.findLast?.((message) => message?.role === 'user')?.content || '';
    aiTranslationSources.push(String(source));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: 'AI预先翻译的字幕。' } }] }),
    });
  });

  try {
    const worker = context.serviceWorkers()[0]
      || await context.waitForEvent('serviceworker', { timeout: 30000 });
    const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)/)?.[1];
    if (!extensionId) throw new Error(`无法取得扩展 ID：${worker.url()}`);

    const control = await context.newPage();
    await control.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await control.waitForTimeout(500);
    const initialPopupVideoState = await control.evaluate(() => {
      const card = document.querySelector('[data-feature="video-subtitle"]');
      return {
        enabled: Boolean(card?.querySelector('i.active')),
        summary: card?.querySelector('small')?.textContent?.trim() || '',
      };
    });
    if (initialPopupVideoState.enabled) {
      throw new Error(`新配置的视频字幕翻译应默认关闭：${JSON.stringify(initialPopupVideoState)}`);
    }
    await control.evaluate(async () => {
      const stored = await chrome.storage.local.get('config');
      await chrome.storage.local.set({ config: {
        ...(stored.config || {}),
        on: true,
        from: 'auto',
        to: 'zh-Hans',
        videoTranslationEnabled: true,
        videoService: 'microsoft',
        videoServiceDefaultMigrated: true,
        videoSubtitleVisible: true,
        videoSubtitleDisplayMode: 'bilingual',
        useCache: false,
      }});
    });
    const popupFeature = await control.evaluate(() => ({
      cardPresent: Boolean(document.querySelector('[data-feature="video-subtitle"]')),
      beta: document.querySelector('[data-feature="video-subtitle"] .beta-badge')?.textContent?.trim() || '',
    }));
    if (!popupFeature.cardPresent || popupFeature.beta !== 'Beta 测试') {
      throw new Error(`Popup 视频字幕 Beta 徽标校验失败：${JSON.stringify(popupFeature)}`);
    }
    await control.locator('[data-feature="video-subtitle"]').click();
    await control.waitForFunction(() => Boolean([...document.querySelectorAll('.drawer-content')].find((node) => node.textContent?.includes('视频翻译服务'))), null, { timeout: 10000 });
    const popupDrawerBeta = await control.locator('.video-beta-banner small').textContent();
    if (!popupDrawerBeta?.startsWith('Beta 测试')) {
      throw new Error(`Popup 视频字幕抽屉 Beta 徽标校验失败：${popupDrawerBeta}`);
    }
    const popupVideoServiceOptions = await control.locator('.drawer-content .select-row select option').allTextContents();
    if (!popupVideoServiceOptions.includes('OpenAI') || !popupVideoServiceOptions.includes('微软翻译')) {
      throw new Error(`Popup 视频翻译服务没有同时提供机器翻译和 AI 服务：${JSON.stringify(popupVideoServiceOptions)}`);
    }
    const popupVideoFontSizeOptions = await control.locator('.drawer-content select[aria-label="视频字幕字号"] option').allTextContents();
    if (!popupVideoFontSizeOptions.includes('默认') || !popupVideoFontSizeOptions.includes('80%') || !popupVideoFontSizeOptions.includes('160%')) {
      throw new Error(`Popup 视频字幕字号选项不完整：${JSON.stringify(popupVideoFontSizeOptions)}`);
    }
    await control.locator('.drawer-content select[aria-label="视频字幕字号"]').selectOption('140');
    await control.waitForTimeout(350);
    const popupVideoFontSizePersisted = await control.evaluate(async () => {
      const stored = await chrome.storage.local.get('config');
      return stored.config?.videoSubtitleFontSize;
    });
    if (popupVideoFontSizePersisted !== 140) {
      throw new Error(`Popup 视频字幕字号没有持久化：${JSON.stringify({ popupVideoFontSizePersisted })}`);
    }
    await control.screenshot({ path: path.join(artifactsDir, 'popup-video-beta-test.png'), fullPage: true });

    let page = await context.newPage();
    const pageErrors = [];
    const collectPageError = (error) => pageErrors.push(error.stack || error.message);
    page.on('pageerror', collectPageError);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|ERR_FAILED|chrome-error|interrupted by another navigation/.test(message)) throw error;
      navigationMode = 'offline-youtube-fixture';
      await page.close();
      page = await context.newPage();
      page.on('pageerror', collectPageError);
      await page.route(url, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: OFFLINE_YOUTUBE_FIXTURE_HTML,
      }), { times: 1 });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const description = document.querySelector('meta[name="description"]') || document.createElement('meta');
      description.setAttribute('name', 'description');
      description.setAttribute('content', 'FluentRead fixture context: this video explains orbital habitat economics and launch terminology.');
      if (!description.isConnected) document.head.append(description);
    });

    await page.evaluate((videoDataUrl) => {
      const player = document.querySelector('#movie_player, .html5-video-player');
      if (!(player instanceof HTMLElement)) throw new Error('找不到 YouTube 播放器容器');

      player.style.cssText += [
        'display:block !important',
        'visibility:visible !important',
        'opacity:1 !important',
        'position:fixed !important',
        'left:24px !important',
        'top:24px !important',
        'width:960px !important',
        'height:540px !important',
        'z-index:2147483000 !important',
        'background:#111 !important',
        'overflow:hidden !important',
      ].join(';');
      player.replaceChildren();

      const surface = document.createElement('div');
      surface.style.cssText = 'position:absolute;inset:0;background:linear-gradient(135deg,#111827,#020617);';
      const label = document.createElement('div');
      label.textContent = 'FluentRead 视频字幕翻译 Fixture';
      label.style.cssText = 'position:absolute;left:28px;top:24px;color:#94a3b8;font:600 18px/1.4 Arial,sans-serif;';
      surface.appendChild(label);

      const video = document.createElement('video');
      video.className = 'html5-main-video';
      video.muted = true;
      video.preload = 'auto';
      video.src = videoDataUrl;
      video.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      video.load();

      const container = document.createElement('div');
      container.id = 'ytp-caption-window-container';
      container.style.cssText = 'position:absolute;left:0;right:0;top:66%;height:18%;z-index:4;text-align:center;color:#fff;font:600 30px/1.35 Arial,sans-serif;';
      const segment = document.createElement('span');
      segment.className = 'ytp-caption-segment';
      segment.textContent = '';
      container.appendChild(segment);

      const controls = document.createElement('div');
      controls.className = 'ytp-right-controls';
      controls.style.cssText = 'position:absolute;right:20px;bottom:18px;display:flex;align-items:center;gap:8px;width:auto;height:52px;z-index:8;';
      const existingTranslationButton = document.createElement('button');
      existingTranslationButton.type = 'button';
      existingTranslationButton.className = 'fixture-existing-translation-button';
      existingTranslationButton.textContent = '其他翻译';
      existingTranslationButton.style.cssText = 'width:64px;height:40px;color:#fff;background:#334155;border:0;border-radius:8px;font-size:12px;';
      const settings = document.createElement('button');
      settings.type = 'button';
      settings.className = 'ytp-settings-button';
      settings.textContent = '⚙';
      settings.style.cssText = 'width:40px;height:40px;color:#fff;background:#334155;border:0;border-radius:8px;font-size:20px;';
      controls.append(existingTranslationButton, settings);

      player.append(surface, video, container, controls);
    }, FIXTURE_NATIVE_VIDEO_DATA_URL);

    await page.waitForFunction(() => {
      const video = document.querySelector('video.html5-main-video');
      return Boolean(video && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration >= 5);
    }, null, { timeout: 15000 });

    await page.waitForFunction(() => {
      const button = document.querySelector('#fluent-read-video-subtitle-button');
      return Boolean(button?.closest('.ytp-right-controls'));
    }, null, { timeout: 15000 });

    const playerUi = await page.evaluate(() => {
      const button = document.querySelector('#fluent-read-video-subtitle-button');
      const icon = document.querySelector('#fluent-read-video-subtitle-button .fluent-read-video-subtitle-button-icon');
      const buttonRect = button?.getBoundingClientRect();
      const iconRect = icon?.getBoundingClientRect();
      return {
        buttonPresent: Boolean(button),
        buttonInControls: Boolean(button?.closest('.ytp-right-controls')),
        buttonEnabled: button?.getAttribute('aria-pressed') === 'true',
        buttonRect: buttonRect?.toJSON() || null,
        iconRect: iconRect?.toJSON() || null,
        iconTag: icon?.tagName || '',
        iconSrc: icon instanceof HTMLImageElement ? icon.src : '',
        buttonIsLeftmost: button?.parentElement?.firstElementChild === button,
        iconCenterDelta: buttonRect && iconRect
          ? Math.abs((buttonRect.top + buttonRect.height / 2) - (iconRect.top + iconRect.height / 2))
          : null,
      };
    });
    if (!playerUi.buttonPresent || !playerUi.buttonInControls || !playerUi.buttonIsLeftmost || playerUi.iconTag !== 'IMG' || !playerUi.iconSrc.includes('/icon/128.png') || playerUi.iconCenterDelta === null || playerUi.iconCenterDelta > 2) {
      throw new Error(`播放器入口布局校验失败：${JSON.stringify(playerUi)}`);
    }

    await page.evaluate(() => document.querySelector('#fluent-read-video-subtitle-button')?.click());
    await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle-menu')?.hidden === false, null, { timeout: 10000 });
    const menu = await page.evaluate(() => ({
      brand: document.querySelector('#fluent-read-video-subtitle-menu .fluent-read-video-menu-brand')?.textContent || '',
      beta: document.querySelector('#fluent-read-video-subtitle-menu .fluent-read-video-menu-beta')?.textContent || '',
      service: document.querySelector('#fluent-read-video-subtitle-menu [data-service-label]')?.textContent || '',
      bilingual: document.querySelector('#fluent-read-video-subtitle-menu [data-mode="bilingual"]')?.getAttribute('aria-checked') === 'true',
      enableAction: document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]')?.className || '',
      enableActionState: document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"] [data-state]')?.textContent || '',
      enableActionBackground: document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]')
        ? getComputedStyle(document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]')).backgroundImage
        : '',
      enableActionBackgroundColor: document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]')
        ? getComputedStyle(document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]')).backgroundColor
        : '',
      enableActionBorder: document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]')
        ? getComputedStyle(document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]')).borderTopColor
        : '',
      enableActionMinHeight: document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]')
        ? getComputedStyle(document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]')).minHeight
        : '',
      rect: document.querySelector('#fluent-read-video-subtitle-menu')?.getBoundingClientRect().toJSON() || null,
    }));
    if (menu.brand !== '流畅阅读' || menu.beta !== 'Beta 测试' || menu.service !== '微软翻译' || !menu.bilingual
      || !menu.enableAction.includes('fluent-read-video-menu-primary-action') || menu.enableActionState !== '已开启'
      || menu.enableActionMinHeight !== '42px' || menu.enableActionBorder === 'rgba(0, 0, 0, 0)'
      || !menu.rect || menu.rect.width <= 0 || menu.rect.height <= 0) {
      throw new Error(`播放器菜单校验失败：${JSON.stringify(menu)}`);
    }
    await page.evaluate(() => {
      const action = document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]');
      if (action instanceof HTMLElement) action.click();
    });
    await page.waitForFunction(() => {
      const action = document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]');
      return action?.getAttribute('aria-checked') === 'false'
        && action.querySelector('[data-state]')?.textContent === '立即开启';
    }, null, { timeout: 10000 });
    const disabledMenu = await page.evaluate(() => {
      const action = document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]');
      const style = action ? getComputedStyle(action) : null;
      return {
        className: action?.className || '',
        state: action?.querySelector('[data-state]')?.textContent || '',
        backgroundColor: style?.backgroundColor || '',
        border: style?.borderTopColor || '',
        minHeight: style?.minHeight || '',
      };
    });
    if (!disabledMenu.className.includes('fluent-read-video-menu-primary-action') || disabledMenu.state !== '立即开启'
      || disabledMenu.minHeight !== '42px' || disabledMenu.border === 'rgba(0, 0, 0, 0)') {
      throw new Error(`关闭状态的字幕翻译入口不够醒目：${JSON.stringify(disabledMenu)}`);
    }
    await page.locator('#fluent-read-video-subtitle-menu').screenshot({ path: path.join(artifactsDir, 'video-subtitle-fixture-menu-disabled.png') });
    await page.evaluate(() => {
      const action = document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]');
      if (action instanceof HTMLElement) action.click();
    });
    await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"] [data-state]')?.textContent === '已开启', null, { timeout: 10000 });
    await page.locator('#fluent-read-video-subtitle-menu').screenshot({ path: path.join(artifactsDir, 'video-subtitle-fixture-menu.png') });

    const overlaySelector = '#fluent-read-video-subtitle';
    const normalizedCaptionSelector = '#fluent-read-video-subtitle-original';
    const progressiveSource = 'understand from [music] the axioms and the basics.';
    const progressiveExpectedTranslation = '从音乐中理解公理和基础。';
    const progressiveRequestStart = translationSources.filter((source) => source === progressiveSource).length;
    await page.evaluate((source) => {
      const video = document.querySelector('video.html5-main-video');
      if (video) {
        try { video.currentTime = 0; } catch {}
        video.dispatchEvent(new Event('timeupdate'));
      }
      window.postMessage({
        source: 'fluent-read',
        type: 'fluent-read-youtube-timedtext',
        url: 'https://www.youtube.com/api/timedtext?v=fixture-progressive&lang=en',
        responseText: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 5000, segs: [{ utf8: source }] }] }),
      }, window.location.origin);
    }, progressiveSource);
    const pretranslationDeadline = Date.now() + 10000;
    while (translationSources.filter((source) => source === progressiveSource).length < 1 && Date.now() < pretranslationDeadline) {
      await page.waitForTimeout(100);
    }
    if (translationSources.filter((source) => source === progressiveSource).length !== 1) {
      throw new Error(`渐进字幕没有在播放前完成一次完整 cue 翻译：${JSON.stringify({ translationSources })}`);
    }

    const progressiveTexts = [
      'understand',
      'understand from',
      'understand from [music]',
      'understand from [music] the axioms and',
    ];
    const progressiveVisibleTexts = [];
    for (const text of progressiveTexts) {
      await page.evaluate((value) => {
        const segment = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
        if (segment) segment.textContent = value;
      }, text);
      await page.waitForFunction(({ expected, expectedTranslation }) => {
        const original = document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() || '';
        const translated = document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() || '';
        const native = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
        return original === expected
          && translated === expectedTranslation
          && native instanceof HTMLElement
          && getComputedStyle(native).visibility === 'hidden'
          && document.querySelector('#ytp-caption-window-container')?.classList.contains('fluent-read-video-normalized-caption');
      }, { expected: progressiveSource, expectedTranslation: progressiveExpectedTranslation }, { timeout: 10000 });
      const partialState = await page.evaluate(() => ({
        original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() || '',
        translation: document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() || '',
        nativeVisibility: document.querySelector('#ytp-caption-window-container .ytp-caption-segment')
          ? getComputedStyle(document.querySelector('#ytp-caption-window-container .ytp-caption-segment')).visibility
          : '',
        panelRect: document.querySelector('#fluent-read-video-subtitle-panel')?.getBoundingClientRect().toJSON() || null,
      }));
      progressiveVisibleTexts.push({
        source: text,
        original: partialState.original,
        translation: partialState.translation,
        nativeVisibility: partialState.nativeVisibility,
        panelRect: partialState.panelRect,
      });
    }
    if (progressiveVisibleTexts.some(({ original, translation, nativeVisibility }) => original !== progressiveSource || translation !== progressiveExpectedTranslation || nativeVisibility !== 'hidden')) {
      throw new Error(`逐词字幕没有被合并为完整原文并保留黄色译文：${JSON.stringify({ progressiveVisibleTexts })}`);
    }
    const panelBottoms = progressiveVisibleTexts
      .map(({ panelRect }) => panelRect?.bottom)
      .filter((bottom) => typeof bottom === 'number');
    const panelBottomRange = panelBottoms.length > 1
      ? Math.max(...panelBottoms) - Math.min(...panelBottoms)
      : Number.POSITIVE_INFINITY;
    if (panelBottomRange > 1.5) {
      throw new Error(`字幕面板底部随逐词输出发生跳动：${JSON.stringify({ panelBottomRange, progressiveVisibleTexts })}`);
    }
    await page.evaluate((value) => {
      const segment = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
      if (segment) segment.textContent = value;
    }, progressiveSource);
    await page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.textContent?.trim() === expected, { selector: overlaySelector, expected: progressiveExpectedTranslation }, { timeout: 20000 });
    const progressiveTranslation = await page.locator(overlaySelector).textContent();
    const translationPlacement = await page.evaluate(() => {
      const native = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
      const normalized = document.querySelector('#fluent-read-video-subtitle-original');
      const overlay = document.querySelector('#fluent-read-video-subtitle');
      const panel = document.querySelector('#fluent-read-video-subtitle-panel');
      const player = document.querySelector('#movie_player, .html5-video-player');
      const nativeRect = native?.getBoundingClientRect();
      const normalizedRect = normalized?.getBoundingClientRect();
      const overlayRect = overlay?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      const playerRect = player?.getBoundingClientRect();
      const style = overlay ? getComputedStyle(overlay) : null;
      const panelStyle = panel ? getComputedStyle(panel) : null;
      return {
        nativeTop: nativeRect?.top ?? null,
        normalizedTop: normalizedRect?.top ?? null,
        overlayBottom: overlayRect?.bottom ?? null,
        gap: normalizedRect && overlayRect ? normalizedRect.top - overlayRect.bottom : null,
        panelTop: panelRect?.top ?? null,
        panelBottom: panelRect?.bottom ?? null,
        panelBottomGap: panelRect && playerRect ? playerRect.bottom - panelRect.bottom : null,
        panelWidth: panelRect?.width ?? null,
        playerWidth: playerRect?.width ?? null,
        panelBottomStyle: panelStyle?.bottom || '',
        panelBackground: panelStyle?.backgroundColor || '',
        panelShadow: panelStyle?.boxShadow || '',
        panelRadius: panelStyle?.borderRadius || '',
        fontFamily: style?.fontFamily || '',
        color: style?.color || '',
        strokeWidth: style?.webkitTextStrokeWidth || '',
        textShadow: style?.textShadow || '',
        fontSize: style?.fontSize || '',
      };
    });
    if (translationPlacement.gap === null || translationPlacement.gap < 4 || !translationPlacement.fontFamily.includes('PingFang SC')
      || translationPlacement.color !== 'rgb(255, 228, 92)' || translationPlacement.strokeWidth === '0px'
      || translationPlacement.panelWidth <= 0 || translationPlacement.panelBackground === 'rgba(0, 0, 0, 0)'
      || translationPlacement.playerWidth === null || translationPlacement.panelWidth >= translationPlacement.playerWidth - 24
      || translationPlacement.panelShadow === 'none' || translationPlacement.panelRadius === '0px'
      || translationPlacement.panelBottomGap === null || translationPlacement.panelBottomGap < 48
      || translationPlacement.panelBottomGap > 100 || translationPlacement.panelBottomStyle === 'auto'
      || Number.parseFloat(translationPlacement.fontSize) <= 24) {
      throw new Error(`译文没有稳定显示在原字幕上方或字体清晰度样式未生效：${JSON.stringify(translationPlacement)}`);
    }
    const progressiveRequests = translationSources.filter((source) => source === progressiveSource).length - progressiveRequestStart;
    if (progressiveRequests !== 1) {
      throw new Error(`渐进字幕没有合并为单次完整 cue 翻译请求：${JSON.stringify({ progressiveRequests, translationSources })}`);
    }

    await page.evaluate(() => {
      const segment = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
      if (segment) segment.textContent = 'and the housing market took a hit.';
    });
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === '房地产市场受到了冲击。', overlaySelector, { timeout: 20000 });
    const nativeCaptionPlacement = await page.evaluate(() => {
      const native = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
      const panel = document.querySelector('#fluent-read-video-subtitle-panel');
      const player = document.querySelector('#movie_player, .html5-video-player');
      const nativeRect = native?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      const playerRect = player?.getBoundingClientRect();
      return {
        nativeTop: nativeRect?.top ?? null,
        panelBottom: panelRect?.bottom ?? null,
        panelNativeGap: nativeRect && panelRect ? nativeRect.top - panelRect.bottom : null,
        playerBottom: playerRect?.bottom ?? null,
        panelBottomStyle: panel ? getComputedStyle(panel).bottom : '',
      };
    });
    if (nativeCaptionPlacement.panelNativeGap === null || nativeCaptionPlacement.panelNativeGap < 4) {
      throw new Error(`整段原生字幕被译文面板覆盖：${JSON.stringify(nativeCaptionPlacement)}`);
    }
    const beforeRedraw = await page.locator(overlaySelector).textContent();

    await page.evaluate(() => {
      const container = document.querySelector('#ytp-caption-window-container');
      if (!container) return;
      container.style.top = '0';
      container.style.height = '0';
      container.replaceChildren();
    });
    await page.waitForTimeout(180);
    const duringRedraw = await page.evaluate(() => ({
      nativeCaptionEmpty: !(document.querySelector('#ytp-caption-window-container')?.textContent || '').trim(),
      overlay: document.querySelector('#fluent-read-video-subtitle')?.textContent || '',
      overlayTop: document.querySelector('#fluent-read-video-subtitle')?.style.top || '',
    }));
    if (!duringRedraw.nativeCaptionEmpty || !duringRedraw.overlay.trim() || Number.parseFloat(duringRedraw.overlayTop) <= 8) {
      throw new Error(`字幕重绘保留校验失败：${JSON.stringify(duringRedraw)}`);
    }

    await page.evaluate(() => {
      const container = document.querySelector('#ytp-caption-window-container');
      if (!container) return;
      container.style.top = '66%';
      container.style.height = '18%';
      const segment = document.createElement('span');
      segment.className = 'ytp-caption-segment';
      segment.textContent = 'and the housing market took a hit.';
      container.appendChild(segment);
    });
    await page.waitForTimeout(600);
    const afterRedraw = await page.locator(overlaySelector).textContent();
    if (!afterRedraw?.trim()) throw new Error('字幕节点重建后译文没有恢复');

    await page.evaluate(() => {
      const container = document.querySelector('#ytp-caption-window-container');
      if (!container) return;
      container.style.top = '0';
      container.style.height = '0';
      container.replaceChildren();
    });
    await page.waitForTimeout(700);
    const afterDisappearance = await page.evaluate(() => ({
      nativeCaptionEmpty: !(document.querySelector('#ytp-caption-window-container')?.textContent || '').trim(),
      overlay: document.querySelector('#fluent-read-video-subtitle')?.textContent || '',
      overlayTop: document.querySelector('#fluent-read-video-subtitle')?.style.top || '',
    }));
    if (!afterDisappearance.nativeCaptionEmpty || afterDisappearance.overlay.trim() || Number.parseFloat(afterDisappearance.overlayTop) <= 8) {
      throw new Error(`字幕完全消失后的译文清理或位置校验失败：${JSON.stringify(afterDisappearance)}`);
    }

    await page.evaluate(() => {
      const container = document.querySelector('#ytp-caption-window-container');
      if (!container) return;
      container.style.top = '66%';
      container.style.height = '18%';
      const segment = document.createElement('span');
      segment.className = 'ytp-caption-segment';
      segment.textContent = 'and the housing market took a hit.';
      container.appendChild(segment);
    });
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === '房地产市场受到了冲击。', overlaySelector, { timeout: 20000 });

    await page.evaluate(() => {
      const segment = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
      if (segment) segment.textContent = 'This is a FluentRead fixture subtitle.';
    });
    await page.waitForFunction((previous) => {
      const text = document.querySelector('#fluent-read-video-subtitle')?.textContent || '';
      return Boolean(text.trim() && text !== previous);
    }, afterRedraw, { timeout: 20000 });
    const secondTranslation = await page.locator(overlaySelector).textContent();

    const pretranslatedSource = 'This subtitle was translated in advance.';
    const prefetchRequestStart = translationSources.filter((source) => source === pretranslatedSource).length;
    await page.evaluate((source) => {
      const video = document.querySelector('video.html5-main-video');
      if (video) {
        try { video.currentTime = 0; } catch {}
        video.dispatchEvent(new Event('timeupdate'));
      }
      window.postMessage({
        source: 'fluent-read',
        type: 'fluent-read-youtube-timedtext',
        url: 'https://www.youtube.com/api/timedtext?v=fixture&lang=en',
        responseText: JSON.stringify({ events: [{ tStartMs: 8000, dDurationMs: 2000, segs: [{ utf8: source }] }] }),
      }, window.location.origin);
    }, pretranslatedSource);
    await page.waitForTimeout(1200);
    const prefetchRequests = translationSources.filter((source) => source === pretranslatedSource).length - prefetchRequestStart;
    if (prefetchRequests !== 1) {
      throw new Error(`时间轴前置翻译没有提前请求一次：${JSON.stringify({ prefetchRequests, translationSources })}`);
    }
    await page.evaluate((source) => {
      const segment = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
      if (segment) segment.textContent = source;
    }, pretranslatedSource);
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === '预先翻译的字幕。', overlaySelector, { timeout: 20000 });
    const displayedPrefetchTranslation = await page.locator(overlaySelector).textContent();
    const displayedPrefetchRequests = translationSources.filter((source) => source === pretranslatedSource).length;
    if (displayedPrefetchRequests - prefetchRequestStart !== 1) {
      throw new Error(`已前置翻译的字幕再次显示时重复请求：${JSON.stringify({ prefetchRequestStart, displayedPrefetchRequests, translationSources })}`);
    }

    await control.evaluate(async () => {
      const stored = await chrome.storage.local.get('config');
      await chrome.storage.local.set({ config: {
        ...(stored.config || {}),
        videoService: 'openai',
        videoServiceDefaultMigrated: true,
        enableAIContext: true,
        useCache: false,
        token: { ...(stored.config?.token || {}), openai: 'fixture-token' },
        model: { ...(stored.config?.model || {}), openai: 'fixture-model' },
      }});
    });
    await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle-menu [data-service-label]')?.textContent === 'OpenAI', null, { timeout: 10000 });
    const aiPretranslatedSource = 'This AI subtitle was translated in advance.';
    await page.evaluate((source) => {
      const video = document.querySelector('video.html5-main-video');
      if (video) {
        try { video.currentTime = 0; } catch {}
        video.dispatchEvent(new Event('timeupdate'));
      }
      window.postMessage({
        source: 'fluent-read',
        type: 'fluent-read-youtube-timedtext',
        url: 'https://www.youtube.com/api/timedtext?v=fixture-ai&lang=en',
        responseText: JSON.stringify({ events: [{ tStartMs: 20000, dDurationMs: 2000, segs: [{ utf8: source }] }] }),
      }, window.location.origin);
    }, aiPretranslatedSource);
    await page.waitForTimeout(1500);
    const aiPrefetchRequests = aiTranslationSources.filter((source) => source.includes(aiPretranslatedSource));
    if (aiPrefetchRequests.length !== 1) {
      throw new Error(`AI 字幕没有按 30 秒窗口前置翻译：${JSON.stringify({ aiTranslationSources })}`);
    }
    const aiContextRequests = aiTranslationSources.filter((source) => source.includes('FluentRead fixture context: this video explains orbital habitat economics and launch terminology.'));
    if (aiContextRequests.length === 0) {
      throw new Error(`AI 字幕请求没有注入页面上下文：${JSON.stringify({ aiTranslationSources })}`);
    }
    await page.evaluate((source) => {
      const segment = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
      if (segment) segment.textContent = source;
    }, aiPretranslatedSource);
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === 'AI预先翻译的字幕。', overlaySelector, { timeout: 20000 });
    const aiDisplayedPrefetchTranslation = await page.locator(overlaySelector).textContent();
    if (aiTranslationSources.filter((source) => source.includes(aiPretranslatedSource)).length !== 1) {
      throw new Error(`AI 已前置翻译的字幕再次显示时重复请求：${JSON.stringify({ aiTranslationSources })}`);
    }

    // 模拟 YouTube 原生字幕 DOM 仍停在上一句，但播放器时间已经进入下一条 cue。
    // 翻译层应按时间轴立即追上，并用整段原文覆盖短暂落后的原生字幕。
    await control.evaluate(async () => {
      const stored = await chrome.storage.local.get('config');
      await chrome.storage.local.set({ config: {
        ...(stored.config || {}),
        videoService: 'microsoft',
        videoServiceDefaultMigrated: true,
        useCache: false,
      }});
    });
    await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle-menu [data-service-label]')?.textContent === '微软翻译', null, { timeout: 10000 });
    const timelineOldSource = 'Timeline subtitle is still visible.';
    const timelineNextSource = 'Timeline subtitle catches up.';
    await page.evaluate(({ oldSource, nextSource }) => {
      const video = document.querySelector('video.html5-main-video');
      if (video) {
        video.currentTime = 0;
        video.dispatchEvent(new Event('timeupdate'));
      }
      const segment = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
      if (segment) segment.textContent = oldSource;
      window.postMessage({
        source: 'fluent-read',
        type: 'fluent-read-youtube-timedtext',
        url: 'https://www.youtube.com/api/timedtext?v=fixture-timeline&lang=en',
        responseText: JSON.stringify({ events: [
          { tStartMs: 0, dDurationMs: 1800, segs: [{ utf8: oldSource }] },
          { tStartMs: 2000, dDurationMs: 3000, segs: [{ utf8: nextSource }] },
        ] }),
      }, window.location.origin);
    }, { oldSource: timelineOldSource, nextSource: timelineNextSource });
    await page.waitForFunction((expected) => document.querySelector('#fluent-read-video-subtitle')?.textContent === `【译文】${expected}`, timelineOldSource, { timeout: 20000 });
    await page.evaluate(() => {
      const video = document.querySelector('video.html5-main-video');
      if (video) {
        video.currentTime = 2.2;
        video.dispatchEvent(new Event('timeupdate'));
      }
    });
    try {
      await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent === '时间轴已追上字幕。'
        && document.querySelector('#fluent-read-video-subtitle-original')?.textContent === 'Timeline subtitle catches up.', null, { timeout: 20000 });
    } catch (error) {
      await page.evaluate(() => {
        const segment = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
        if (segment) segment.textContent = `${segment.textContent || ''} `;
      });
      await page.waitForTimeout(500);
      const timelineDebug = await page.evaluate((recentTranslationSources) => {
        const video = document.querySelector('video.html5-main-video');
        const overlay = document.querySelector('#fluent-read-video-subtitle');
        const normalized = document.querySelector('#fluent-read-video-subtitle-original');
        const container = document.querySelector('#ytp-caption-window-container');
        return {
          currentTime: video?.currentTime,
          native: container?.textContent || '',
          overlay: overlay?.textContent || '',
          normalized: normalized?.textContent || '',
          normalizedActive: document.querySelector('#fluent-read-video-subtitle-layer')?.classList.contains('fluent-read-video-normalized-caption-active'),
          nativeHidden: container?.classList.contains('fluent-read-video-normalized-caption'),
          recoveredAfterNativeMutation: document.querySelector('#fluent-read-video-subtitle')?.textContent === '时间轴已追上字幕。',
          recentTranslationSources,
        };
      }, translationSources.slice(-8));
      throw new Error(`时间轴字幕追赶断言失败：${JSON.stringify(timelineDebug)}`);
    }
    const timelineCatchUp = await page.evaluate(() => ({
      translation: document.querySelector('#fluent-read-video-subtitle')?.textContent || '',
      normalized: document.querySelector('#fluent-read-video-subtitle-original')?.textContent || '',
      native: document.querySelector('#ytp-caption-window-container .ytp-caption-segment')?.textContent || '',
    }));

    await page.locator('#fluent-read-video-subtitle-panel').screenshot({ path: path.join(artifactsDir, 'video-subtitle-panel.png') });
    await page.screenshot({ path: path.join(artifactsDir, 'video-subtitle-fixture-player.png'), fullPage: false });
    console.log(JSON.stringify({
      ok: pageErrors.length === 0,
      url,
      navigationMode,
      playerUi,
      menu,
      disabledMenu,
      popupFeature,
      initialPopupVideoState,
      popupDrawerBeta,
      popupVideoServiceOptions,
      popupVideoFontSizeOptions,
      popupVideoFontSizePersisted,
      beforeRedraw,
      nativeCaptionPlacement,
      duringRedraw,
      afterRedraw,
      afterDisappearance,
      progressiveTranslation,
      progressiveVisibleTexts,
      panelBottomRange,
      normalizedCaptionSelector,
      translationPlacement,
      progressiveRequests,
      secondTranslation,
      prefetchRequests,
      displayedPrefetchTranslation,
      displayedPrefetchRequests,
      aiDisplayedPrefetchTranslation,
      aiTranslationRequests: aiPrefetchRequests.length,
      aiContextRequests: aiContextRequests.length,
      timelineCatchUp,
      translationRequests,
      translationSources,
      pageErrors,
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

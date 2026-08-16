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
  await context.route('https://edge.microsoft.com/translate/translatetext**', async (route) => {
    translationRequests += 1;
    const body = route.request().postDataJSON();
    const source = Array.isArray(body) ? String(body[0] || '') : '';
    translationSources.push(source);
    const translated = source === 'and the housing market took a hit.'
      ? '房地产市场受到了冲击。'
      : source === 'understand from [music] the axioms and the basics.'
        ? '从音乐中理解公理和基础。'
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
    await control.screenshot({ path: path.join(artifactsDir, 'popup-video-beta-test.png'), fullPage: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    await page.evaluate(() => {
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
      video.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';

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
    });

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
      rect: document.querySelector('#fluent-read-video-subtitle-menu')?.getBoundingClientRect().toJSON() || null,
    }));
    if (menu.brand !== '流畅阅读' || menu.beta !== 'Beta 测试' || menu.service !== '微软翻译' || !menu.bilingual || !menu.rect || menu.rect.width <= 0 || menu.rect.height <= 0) {
      throw new Error(`播放器菜单校验失败：${JSON.stringify(menu)}`);
    }
    await page.screenshot({ path: path.join(artifactsDir, 'video-subtitle-fixture-menu.png'), fullPage: false });

    const overlaySelector = '#fluent-read-video-subtitle';
    const progressiveTexts = [
      'understand',
      'understand from',
      'understand from [music]',
      'understand from [music] the axioms and',
      'understand from [music] the axioms and the basics.',
    ];
    const progressiveRequestStart = translationRequests;
    for (const text of progressiveTexts) {
      await page.evaluate((value) => {
        const segment = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
        if (segment) segment.textContent = value;
      }, text);
      await page.waitForTimeout(180);
      const partialOverlay = await page.locator(overlaySelector).textContent();
      if (partialOverlay?.trim()) {
        throw new Error(`渐进字幕在稳定前提前显示译文：${JSON.stringify({ text, partialOverlay })}`);
      }
    }
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === '从音乐中理解公理和基础。', overlaySelector, { timeout: 20000 });
    const progressiveTranslation = await page.locator(overlaySelector).textContent();
    const translationPlacement = await page.evaluate(() => {
      const native = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
      const overlay = document.querySelector('#fluent-read-video-subtitle');
      const nativeRect = native?.getBoundingClientRect();
      const overlayRect = overlay?.getBoundingClientRect();
      const style = overlay ? getComputedStyle(overlay) : null;
      return {
        nativeTop: nativeRect?.top ?? null,
        overlayBottom: overlayRect?.bottom ?? null,
        gap: nativeRect && overlayRect ? nativeRect.top - overlayRect.bottom : null,
        fontFamily: style?.fontFamily || '',
        strokeWidth: style?.webkitTextStrokeWidth || '',
        textShadow: style?.textShadow || '',
      };
    });
    if (translationPlacement.gap === null || translationPlacement.gap < 4 || !translationPlacement.fontFamily.includes('PingFang SC') || translationPlacement.strokeWidth === '0px') {
      throw new Error(`译文没有稳定显示在原字幕上方或字体清晰度样式未生效：${JSON.stringify(translationPlacement)}`);
    }
    const progressiveRequests = translationRequests - progressiveRequestStart;
    if (progressiveRequests !== 1) {
      throw new Error(`渐进字幕没有合并为单次翻译请求：${JSON.stringify({ progressiveRequests, translationRequests })}`);
    }

    await page.evaluate(() => {
      const segment = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
      if (segment) segment.textContent = 'and the housing market took a hit.';
    });
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === '房地产市场受到了冲击。', overlaySelector, { timeout: 20000 });
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
    await page.evaluate((source) => {
      const segment = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
      if (segment) segment.textContent = source;
    }, aiPretranslatedSource);
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === 'AI预先翻译的字幕。', overlaySelector, { timeout: 20000 });
    const aiDisplayedPrefetchTranslation = await page.locator(overlaySelector).textContent();
    if (aiTranslationSources.filter((source) => source.includes(aiPretranslatedSource)).length !== 1) {
      throw new Error(`AI 已前置翻译的字幕再次显示时重复请求：${JSON.stringify({ aiTranslationSources })}`);
    }

    await page.screenshot({ path: path.join(artifactsDir, 'video-subtitle-fixture-player.png'), fullPage: false });
    console.log(JSON.stringify({
      ok: pageErrors.length === 0,
      url,
      playerUi,
      menu,
      popupFeature,
      initialPopupVideoState,
      popupDrawerBeta,
      popupVideoServiceOptions,
      beforeRedraw,
      duringRedraw,
      afterRedraw,
      afterDisappearance,
      progressiveTranslation,
      translationPlacement,
      progressiveRequests,
      secondTranslation,
      prefetchRequests,
      displayedPrefetchTranslation,
      displayedPrefetchRequests,
      aiDisplayedPrefetchTranslation,
      aiTranslationRequests: aiPrefetchRequests.length,
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

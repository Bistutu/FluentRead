#!/usr/bin/env node

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function loadPlaywright(root) {
  try {
    return require('playwright');
  } catch {
    const runtimeRequire = createRequire(path.join(path.resolve(root), '__fluentread_x_fixture_test__.cjs'));
    return runtimeRequire('playwright');
  }
}

const X_URL = 'https://x.com/cerebras/status/2089870131291943228';
const X_FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Cerebras on X fixture</title></head>
<body><main id="root"></main></body></html>`;

async function main() {
  const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
  const playwrightRoot = arg('playwright-root', process.env.PLAYWRIGHT_ROOT);
  const artifactsDir = path.resolve(arg('artifacts-dir', path.join(os.tmpdir(), 'fluentread-x-video-subtitle-fixture')));
  const browserPath = arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  const headless = arg('headless', 'false') === 'true';
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-edge-x-video-fixture-'));
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error(`找不到扩展构建：${extensionDir}`);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const mediaPath = path.join(profileDir, 'fixture.webm');
  const speechPath = path.join(profileDir, 'fixture.aiff');
  const speechResult = spawnSync('say', [
    '-v', 'Samantha',
    '-r', '160',
    '-o', speechPath,
    'Hello from the X video. Hello from the X video. Hello from the X video. Hello from the X video.',
  ]);
  const hasSpeechFixture = speechResult.status === 0 && fs.existsSync(speechPath);
  const mediaResult = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=30',
    ...(hasSpeechFixture ? ['-i', speechPath] : ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000']),
    '-t', '12', '-af', 'apad', '-c:v', 'libvpx', '-c:a', 'libopus', '-b:a', '64k', mediaPath,
  ]);
  if (mediaResult.status !== 0) throw new Error(`无法生成 X fixture 音视频：${mediaResult.stderr?.toString() || mediaResult.status}`);
  const fixtureVideoDataUrl = `data:video/webm;base64,${fs.readFileSync(mediaPath).toString('base64')}`;

  const requestLog = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestLog.push({ method: request.method, url: request.url, bytes: Buffer.concat(chunks).length });
    response.statusCode = 200;
    response.setHeader('content-type', 'application/json');
    if (request.url?.endsWith('/chat/completions')) {
      response.end(JSON.stringify({ choices: [{ message: { content: 'X 视频 AI 字幕。' } }] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const { chromium } = loadPlaywright(playwrightRoot);
  const pageErrors = [];
  const pageConsole = [];
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: browserPath,
    headless,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--disable-crash-reporter',
      '--disable-features=Crashpad',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--start-minimized',
      '--window-position=-10000,-10000',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1280, height: 900 },
  });

    context.on('page', (extensionPage) => {
      extensionPage.on('pageerror', (error) => pageErrors.push(`${extensionPage.url()}: ${error.stack || error.message}`));
      extensionPage.on('console', (message) => pageConsole.push(`${extensionPage.url()} ${message.type()}: ${message.text()}`));
    });
  try {
    const worker = context.serviceWorkers()[0]
      || await context.waitForEvent('serviceworker', { timeout: 30000 });
    const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)/)?.[1];
    if (!extensionId) throw new Error(`无法取得扩展 ID：${worker.url()}`);

    const control = await context.newPage();
    await control.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await control.waitForTimeout(500);
    await control.evaluate(async (customUrl) => {
      const stored = await chrome.storage.local.get('config');
      const previous = stored.config || {};
      await chrome.storage.local.set({ config: {
        ...previous,
        on: true,
        from: 'en',
        to: 'zh-Hans',
        videoTranslationEnabled: true,
        videoLocalModel: 'tiny',
        videoService: 'custom',
        videoServiceDefaultMigrated: true,
        videoSubtitleVisible: true,
        videoSubtitleDisplayMode: 'bilingual',
        useCache: false,
        custom: customUrl,
        model: { ...(previous.model || {}), custom: 'fixture-model' },
        customModel: { ...(previous.customModel || {}), custom: 'fixture-model' },
        token: { ...(previous.token || {}), custom: '' },
        requireApiKey: { ...(previous.requireApiKey || {}), 'custom:fixture-model': false },
      }, fluentReadVideoLocalTranscriptionModels: ['tiny'] });
    }, `http://127.0.0.1:${port}/v1/chat/completions`);

    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
    page.on('console', (message) => pageConsole.push(`${message.type()}: ${message.text()}`));
    await page.route(X_URL, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: X_FIXTURE_HTML,
    }), { times: 1 });
    await page.goto(X_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);

    await page.evaluate((videoDataUrl) => {
      const player = document.createElement('div');
      player.dataset.testid = 'videoPlayer';
      player.style.cssText = 'display:block;position:fixed;left:24px;top:24px;width:960px;height:540px;z-index:2147483000;background:linear-gradient(135deg,#111827,#020617);overflow:hidden;';

      const label = document.createElement('div');
      label.textContent = 'X 视频字幕 fixture（无原生字幕）';
      label.style.cssText = 'position:absolute;left:28px;top:24px;color:#94a3b8;font:600 18px/1.4 Arial,sans-serif;';

      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = false;
      video.autoplay = true;
      video.playsInline = true;
      video.src = videoDataUrl;
      video.style.cssText = 'position:absolute;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
      video.load();

      // 模拟 X 播放器右下角的原生控制组：FluentRead 应插入设置齿轮左侧，
      // 而不是再创建一个偏大的独立浮层。
      const controls = document.createElement('div');
      controls.style.cssText = 'position:absolute;right:8px;bottom:8px;z-index:2;display:flex;align-items:center;gap:2px;padding:2px;border-radius:6px;background:rgba(0,0,0,.28);';
      const play = document.createElement('button');
      play.type = 'button';
      play.textContent = '▶';
      play.setAttribute('aria-label', 'Play');
      const settings = document.createElement('button');
      settings.type = 'button';
      settings.textContent = '⚙';
      settings.setAttribute('aria-label', 'Settings');
      const fullscreen = document.createElement('button');
      fullscreen.type = 'button';
      fullscreen.textContent = '⛶';
      fullscreen.setAttribute('aria-label', 'Fullscreen');
      [play, settings, fullscreen].forEach((button) => {
        button.style.cssText = 'width:28px;height:28px;padding:0;border:0;color:#fff;background:transparent;font:16px/1 Arial;';
      });
      controls.append(play, settings, fullscreen);
      player.append(label, video, controls);
      document.body.appendChild(player);
      void video.play().catch(() => undefined);
    }, fixtureVideoDataUrl);

    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return Boolean(video && video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 5);
    }, null, { timeout: 15000 });
    await page.evaluate(() => document.querySelector('video')?.play().catch(() => undefined));
    await page.waitForFunction(() => Boolean(document.querySelector('#fluent-read-video-subtitle-button')), null, { timeout: 15000 });
    const buttonState = await page.evaluate(() => ({
      host: document.querySelector('#fluent-read-video-subtitle-button')?.closest('[data-testid="videoPlayer"]')?.getAttribute('data-testid') || '',
      controlClass: document.querySelector('#fluent-read-video-subtitle-button')?.parentElement?.className || '',
      buttonWidth: document.querySelector('#fluent-read-video-subtitle-button')?.getBoundingClientRect().width || 0,
      iconWidth: document.querySelector('#fluent-read-video-subtitle-button-icon')?.getBoundingClientRect().width || document.querySelector('#fluent-read-video-subtitle-button .fluent-read-video-subtitle-button-icon')?.getBoundingClientRect().width || 0,
      settingsWidth: document.querySelector('[data-testid="videoPlayer"] button[aria-label="Settings"]')?.getBoundingClientRect().width || 0,
      buttonBeforeSettings: (() => {
        const button = document.querySelector('#fluent-read-video-subtitle-button');
        const settings = document.querySelector('[data-testid="videoPlayer"] button[aria-label="Settings"]');
        return Boolean(button && settings && button.parentElement === settings.parentElement
          && button.nextElementSibling === settings);
      })(),
      pageUrl: location.href,
    }));
    if (buttonState.host !== 'videoPlayer' || !buttonState.buttonBeforeSettings
      || buttonState.buttonWidth > 32.5 || buttonState.iconWidth > 20.5
      || Math.abs(buttonState.buttonWidth - buttonState.settingsWidth) > 6) {
      throw new Error(`X 播放器设置齿轮旁控件校验失败：${JSON.stringify(buttonState)}`);
    }

    await page.locator('#fluent-read-video-subtitle-button').click();
    await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle-menu')?.hidden === false, null, { timeout: 10000 });
    const menuState = await page.evaluate(() => {
      const ai = document.querySelector('[data-action="toggle-ai-subtitle"]');
      const player = document.querySelector('[data-testid="videoPlayer"]');
      const menu = document.querySelector('#fluent-read-video-subtitle-menu');
      const menuRect = menu instanceof HTMLElement ? menu.getBoundingClientRect() : { width: 0, height: 0 };
      const originalHeight = player instanceof HTMLElement ? player.style.height : '';
      if (player instanceof HTMLElement) player.style.height = '180px';
      const responsiveHeight = menu instanceof HTMLElement ? menu.getBoundingClientRect().height : 0;
      if (player instanceof HTMLElement) player.style.height = originalHeight;
      return {
        brand: document.querySelector('.fluent-read-video-menu-brand')?.textContent || '',
        aiLabel: ai?.querySelector('.fluent-read-video-menu-label')?.textContent || '',
        aiState: ai?.querySelector('[data-state]')?.textContent || '',
        aiDisabled: ai instanceof HTMLButtonElement ? ai.disabled : true,
        width: menuRect.width,
        height: menuRect.height,
        responsiveHeight,
      };
    });
    if (menuState.brand !== '流畅阅读' || menuState.aiLabel !== '请求 AI 字幕' || menuState.aiDisabled || menuState.aiState !== '点击请求'
      || menuState.width > 236.5 || menuState.height > 244.5 || menuState.responsiveHeight > 136) {
      throw new Error(`X AI 字幕菜单校验失败：${JSON.stringify(menuState)}`);
    }

    // 首次使用未下载模型时，应给出可执行的设置引导，而不是把底层解码
    // 异常直接展示给用户；随后恢复已下载状态，继续验证真实本地推理链路。
    await control.evaluate(() => chrome.storage.local.remove('fluentReadVideoLocalTranscriptionModels'));
    const settingsPagePromise = context.waitForEvent('page', { timeout: 10000 });
    await page.locator('[data-action="toggle-ai-subtitle"]').click();
    await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent === '请先下载模型', null, { timeout: 10000 });
    const settingsPage = await settingsPagePromise;
    await settingsPage.close();
    await page.screenshot({ path: path.join(artifactsDir, 'x-video-subtitle-model-prompt.png'), fullPage: true });
    const modelPromptState = await page.locator('[data-action="toggle-ai-subtitle"] [data-state]').textContent();
    await control.evaluate(() => chrome.storage.local.set({ fluentReadVideoLocalTranscriptionModels: ['tiny'] }));

    await page.locator('[data-action="toggle-ai-subtitle"]').click();
    // 让首个 5 秒音频分片完整落盘后暂停播放。这样断言的是当前 cue，
    // 不会因为 fixture 视频先自然播放到结尾而把严格时间轴误判成空字幕。
    await page.waitForTimeout(5200);
    await page.evaluate(() => {
      const video = document.querySelector('video');
      video?.pause();
      video?.dispatchEvent(new Event('timeupdate'));
    });
    try {
      await page.waitForFunction(() => {
        const container = document.querySelector('#fluent-read-video-ai-caption-container');
        const segment = container?.querySelector('.ytp-caption-segment');
        return container?.getAttribute('data-fluent-read-caption-source') === 'ai'
          && Boolean(segment?.textContent?.trim());
      }, null, { timeout: 180000 });
    } catch (error) {
      const localAiDiagnostic = await page.evaluate(() => ({
        video: (() => {
          const video = document.querySelector('video');
          const capture = video && (video.captureStream || video.mozCaptureStream);
          return {
            currentTime: video?.currentTime ?? -1,
            duration: video?.duration ?? -1,
            paused: video?.paused ?? true,
            readyState: video?.readyState ?? -1,
            audioTracks: capture ? capture.call(video).getAudioTracks().length : -1,
          };
        })(),
        buttonState: document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '',
        source: document.querySelector('#fluent-read-video-ai-caption-container')?.getAttribute('data-fluent-read-caption-source') || '',
        original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() || '',
        translation: document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() || '',
      }));
      console.error(JSON.stringify({ localAiDiagnostic, pageErrors, pageConsole }, null, 2));
      throw error;
    }
    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) return;
      // 本地模型可能在原始采集片段结束后才返回；暂停在刚刚识别出的
      // cue 上，让译文断言与后续时间轴推进解耦。
      video.pause();
      video.dispatchEvent(new Event('timeupdate'));
    });
    await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() === 'X 视频 AI 字幕。', null, { timeout: 60000 });
    const localAiResult = await page.evaluate(() => ({
      original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() || '',
      translation: document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() || '',
      model: document.querySelector('[data-local-model-label]')?.textContent?.trim() || '',
    }));
    if (!localAiResult.original || localAiResult.translation !== 'X 视频 AI 字幕。') {
      throw new Error(`扩展内本地 AI 字幕校验失败：${JSON.stringify(localAiResult)}`);
    }

    await page.locator('[data-action="toggle-ai-subtitle"]').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) throw new Error('找不到 X fixture 视频');
      const track = document.createElement('track');
      track.kind = 'captions';
      track.label = 'English';
      track.srclang = 'en';
      track.src = URL.createObjectURL(new Blob(['WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nHello from the X video.'], { type: 'text/vtt' }));
      track.default = true;
      video.appendChild(track);
      video.currentTime = 1;
      video.dispatchEvent(new Event('timeupdate'));
    });
    try {
      await page.waitForFunction(() => {
        const track = document.querySelector('video')?.textTracks[0];
        return Boolean(track?.cues && track.cues.length > 0);
      }, null, { timeout: 10000 });
    } catch (error) {
      const trackDiagnostic = await page.evaluate(() => {
        const video = document.querySelector('video');
        const track = video?.textTracks[0];
        return {
          elementTracks: video?.querySelectorAll('track').length || 0,
          textTracks: video?.textTracks.length || 0,
          mode: track?.mode || '',
          readyState: track?.readyState ?? -1,
          cues: track?.cues?.length || 0,
          src: video?.querySelector('track')?.src || '',
        };
      });
      console.error(JSON.stringify({ trackDiagnostic, pageErrors }, null, 2));
      throw error;
    }
    await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() === 'Hello from the X video.', null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() === 'X 视频 AI 字幕。', null, { timeout: 20000 });

    const result = await page.evaluate(() => ({
      localAiResult: null,
      modelPromptState: '',
      localAiSource: document.querySelector('#fluent-read-video-ai-caption-container')?.getAttribute('data-fluent-read-caption-source') || '',
      original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() || '',
      translation: document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() || '',
      syntheticSource: document.querySelector('#fluent-read-video-ai-caption-container')?.getAttribute('data-fluent-read-caption-source') || '',
      menuState: document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '',
    }));
    result.localAiResult = localAiResult;
    result.modelPromptState = modelPromptState;
    await page.screenshot({ path: path.join(artifactsDir, 'x-video-subtitle-fixture.png'), fullPage: true });
    if (pageErrors.length > 0) throw new Error(`X fixture 页面异常：${JSON.stringify(pageErrors)}`);
    if (requestLog.some((entry) => entry.url?.endsWith('/audio/transcriptions'))
      || requestLog.filter((entry) => entry.url?.endsWith('/chat/completions')).length < 1) {
      throw new Error(`本地 AI 字幕不应请求云端转写：${JSON.stringify(requestLog)}`);
    }
    console.log(JSON.stringify({ result, requestLog, pageErrors, artifactsDir }, null, 2));
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

function loadPlaywright(root) {
  try { return require('playwright'); } catch {
    const runtimeRequire = createRequire(path.join(path.resolve(root), '__fluentread_video_performance_test__.cjs'));
    return runtimeRequire('playwright');
  }
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function metricsMap(payload) {
  return new Map((payload.metrics || []).map((metric) => [metric.name, metric.value]));
}

async function measurePage(chromium, { label, extensionDir, url, browserPath, playwrightArgs }) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), `fluentread-video-performance-${label}-`));
  const args = [
    '--start-minimized',
    '--window-position=-10000,-10000',
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (extensionDir) {
    args.push(`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`);
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: browserPath,
    headless: false,
    args,
    viewport: { width: 1280, height: 900 },
  });

  try {
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message || String(error)));
    const client = await context.newCDPSession(page);
    await client.send('Performance.enable');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
    await page.waitForTimeout(5000);
    const before = metricsMap(await client.send('Performance.getMetrics'));
    const wallStart = before.get('Timestamp') || 0;
    await page.waitForTimeout(8000);
    const after = metricsMap(await client.send('Performance.getMetrics'));
    const wallSeconds = Math.max(0, (after.get('Timestamp') || 0) - wallStart);
    const taskSeconds = Math.max(0, (after.get('TaskDuration') || 0) - (before.get('TaskDuration') || 0));
    const scriptSeconds = Math.max(0, (after.get('ScriptDuration') || 0) - (before.get('ScriptDuration') || 0));
    const layoutSeconds = Math.max(0, (after.get('LayoutDuration') || 0) - (before.get('LayoutDuration') || 0));

    return {
      label,
      wallSeconds: Number(wallSeconds.toFixed(2)),
      taskSeconds: Number(taskSeconds.toFixed(2)),
      taskShare: Number((wallSeconds > 0 ? taskSeconds / wallSeconds : 0).toFixed(3)),
      scriptSeconds: Number(scriptSeconds.toFixed(2)),
      layoutSeconds: Number(layoutSeconds.toFixed(2)),
      extensionButtonPresent: Boolean(await page.locator('#fluent-read-video-subtitle-button').count()),
      pageErrorCount: pageErrors.length,
    };
  } finally {
    await context.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

async function main() {
  const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
  const playwrightRoot = arg('playwright-root', process.env.PLAYWRIGHT_ROOT);
  const url = arg('url', 'https://www.youtube.com/watch?v=dqONk48l5vY');
  const browserPath = arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error(`找不到扩展构建：${extensionDir}`);

  const { chromium } = loadPlaywright(playwrightRoot);
  const enabled = await measurePage(chromium, { label: 'extension-on', extensionDir, url, browserPath });
  const baseline = await measurePage(chromium, { label: 'extension-off', extensionDir: null, url, browserPath });
  console.log(JSON.stringify({
    ok: enabled.pageErrorCount === 0 && baseline.pageErrorCount === 0,
    url,
    enabled,
    baseline,
    taskShareDelta: Number((enabled.taskShare - baseline.taskShare).toFixed(3)),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

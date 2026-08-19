#!/usr/bin/env node

// 使用临时 Edge profile 验证划词翻译的完整触发矩阵。
// 该脚本只操作本次创建的隔离 profile，不连接用户正在使用的浏览器。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const TARGET_TEXT = 'When switching between different filaments, the printer flushes residual material before printing.';

function readArg(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
}

function parseArgs(argv) {
  const args = {
    extensionDir: readArg(argv, 'extension-dir', '.output/chrome-mv3'),
    playwrightRoot: readArg(argv, 'playwright-root', process.env.PLAYWRIGHT_ROOT),
    artifactsDir: readArg(argv, 'artifacts-dir', path.join(os.tmpdir(), 'fluentread-selection-trigger-test')),
    browserPath: readArg(argv, 'browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    headed: argv.includes('--headed'),
  };
  if (!args.playwrightRoot) throw new Error('必须传入 --playwright-root，或设置 PLAYWRIGHT_ROOT');
  args.extensionDir = path.resolve(args.extensionDir);
  args.artifactsDir = path.resolve(args.artifactsDir);
  if (!fs.existsSync(path.join(args.extensionDir, 'manifest.json'))) {
    throw new Error(`找不到扩展构建产物：${args.extensionDir}`);
  }
  return args;
}

function loadPlaywright(root) {
  try {
    return require('playwright');
  } catch {
    const runtimeRequire = createRequire(path.join(path.resolve(root), '__fluentread_selection_trigger_test__.cjs'));
    return runtimeRequire('playwright');
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDedicatedProfile(profileDir) {
  const resolved = path.resolve(profileDir);
  const home = os.homedir();
  const forbiddenRoots = [
    path.join(home, 'Library/Application Support/Google/Chrome'),
    path.join(home, 'Library/Application Support/Microsoft Edge'),
    path.join(home, '.config/google-chrome'),
    path.join(home, '.config/microsoft-edge'),
  ];
  for (const root of forbiddenRoots) {
    const relative = path.relative(root, resolved);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error(`拒绝使用日常浏览器 profile：${resolved}`);
    }
  }
}

async function waitForWorker(context) {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 30000 });
  const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)/)?.[1];
  assert(extensionId, `无法获取扩展 ID：${worker.url()}`);
  return { worker, extensionId };
}

async function readStoredConfig(worker) {
  return worker.evaluate(async () => (await chrome.storage.local.get('config')).config || {});
}

async function patchStoredConfig(worker, patch) {
  await worker.evaluate(async (nextPatch) => {
    const stored = await chrome.storage.local.get('config');
    await chrome.storage.local.set({ config: { ...(stored.config || {}), ...nextPatch } });
  }, patch);
}

async function waitForContentScript(page) {
  await page.locator('#fluent-read-page-styles').waitFor({ state: 'attached', timeout: 60000 });
  await page.waitForTimeout(700);
}

async function openSelectionDrawer(popup) {
  await popup.locator('.feature-card').filter({ hasText: '划词翻译' }).first().click();
  const drawer = popup.locator('.popup-drawer:visible').last();
  await drawer.getByText('触发方式', { exact: true }).waitFor({ state: 'visible', timeout: 60000 });
  return drawer;
}

async function setSelectionEnabled(popup, drawer, enabled) {
  const toggle = drawer.getByRole('switch', { name: '启用或关闭划词翻译' });
  const current = (await toggle.getAttribute('aria-checked')) === 'true';
  if (current !== enabled) {
    await toggle.click();
    await popup.waitForTimeout(500);
  }
  assert((await toggle.getAttribute('aria-checked')) === String(enabled), `划词翻译启用状态错误：${enabled}`);
}

async function setSelectionMode(popup, drawer, label) {
  await drawer.locator('.chips.two button').filter({ hasText: label }).click();
  await popup.waitForTimeout(450);
  const selected = await drawer.locator('.chips.two button.selected').textContent();
  assert(selected?.includes(label), `显示方式没有选中 ${label}：${selected}`);
}

async function setSelectionTrigger(popup, drawer, worker, label) {
  await drawer.locator('.selection-trigger-chips button').filter({ hasText: label }).click();
  await popup.waitForTimeout(500);

  if (label === '自定义') {
    let dialog = popup.locator('.el-dialog:visible').last();
    if (await dialog.count() === 0) {
      const recordButton = drawer.getByRole('button', { name: /录制自定义快捷键|当前：/ });
      await recordButton.click();
      dialog = popup.locator('.el-dialog:visible').last();
    }
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    await dialog.locator('.preset-button').filter({ hasText: 'F9' }).click();
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await popup.waitForTimeout(600);
  }

  const selected = await drawer.locator('.selection-trigger-chips button.selected').textContent();
  assert(selected?.includes(label), `触发方式没有选中 ${label}：${selected}`);
  const config = await readStoredConfig(worker);
  const expected = label === '直接弹出'
    ? { trigger: 'direct', hotkey: 'none' }
    : label === '显示图标'
      ? { trigger: 'icon', hotkey: 'none' }
      : label === '显示小点'
        ? { trigger: 'dot', hotkey: 'none' }
        : label === 'Ctrl'
          ? { trigger: 'Control', hotkey: 'Control' }
          : label === 'Alt / Option'
            ? { trigger: 'Alt', hotkey: 'Alt' }
            : label === 'Shift'
              ? { trigger: 'Shift', hotkey: 'Shift' }
              : { trigger: 'custom', hotkey: 'custom' };
  assert(config.selectionTranslatorTrigger === expected.trigger && config.selectionTranslatorHotkey === expected.hotkey,
    `选择 ${label} 后配置错误：${JSON.stringify({ trigger: config.selectionTranslatorTrigger, hotkey: config.selectionTranslatorHotkey })}`);
  if (label === '自定义') {
    assert(config.customSelectionTranslatorHotkey === 'F9', `自定义快捷键没有保存：${config.customSelectionTranslatorHotkey}`);
  }
  return { label, trigger: config.selectionTranslatorTrigger, hotkey: config.selectionTranslatorHotkey, customHotkey: config.customSelectionTranslatorHotkey || '' };
}

async function resetFixture(page) {
  await page.evaluate((targetText) => {
    document.querySelector('#selection-test-fixture')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <main id="selection-test-fixture" style="padding: 80px; font: 24px/1.7 Arial, sans-serif;">
        <p id="target" style="max-width: 900px;">${targetText}</p>
        <p id="neighbor">This neighboring paragraph must remain untouched.</p>
      </main>`);
  }, TARGET_TEXT);
  await page.waitForTimeout(200);
}

async function selectTarget(page) {
  await page.bringToFront();
  const target = page.locator('#target');
  const box = await target.boundingBox();
  assert(box, '目标段落没有可用几何位置');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 8, y);
  await page.mouse.down();
  await page.mouse.move(Math.min(box.x + box.width - 8, box.x + 520), y, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  let selectedText = await page.evaluate(() => window.getSelection()?.toString().trim() || '');
  let method = 'mouse';
  // 屏幕外窗口在部分 macOS 图形会话中不会把鼠标拖拽交给网页；
  // 使用同一个真实 DOM Range 事件继续验证扩展的选区处理，不跳过后续触发矩阵。
  if (!selectedText) {
    method = 'dom-range-fallback';
    await page.evaluate(() => {
      const target = document.querySelector('#target');
      const textNode = target?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(textNode.textContent?.length || 0, 72));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.waitForTimeout(500);
    selectedText = await page.evaluate(() => window.getSelection()?.toString().trim() || '');
  }
  assert(selectedText.length > 0, '划词测试没有产生选区');
  return { text: selectedText, method };
}

async function readSelectionUi(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#fluent-read-selection-translator-container');
    const root = host?.shadowRoot;
    const indicator = root?.querySelector('.fr-selection-indicator');
    const tooltip = root?.querySelector('.fr-translation-tooltip');
    return {
      host: Boolean(host),
      indicator: Boolean(indicator),
      indicatorClass: indicator?.className || '',
      tooltip: Boolean(tooltip),
      original: Boolean(root?.querySelector('.fr-original-text')),
      translation: Boolean(root?.querySelector('.fr-translation-result')),
      resultText: root?.querySelector('.fr-translation-result pre')?.textContent?.trim() || '',
      selectionText: window.getSelection()?.toString().trim() || '',
      targetText: document.querySelector('#target')?.textContent || '',
    };
  });
}

async function waitForSelectionUi(page, expected, description) {
  await page.waitForFunction((expectedState) => {
    const host = document.querySelector('#fluent-read-selection-translator-container');
    const root = host?.shadowRoot;
    const indicator = root?.querySelector('.fr-selection-indicator');
    const tooltip = root?.querySelector('.fr-translation-tooltip');
    const state = {
      host: Boolean(host),
      indicator: Boolean(indicator),
      indicatorClass: indicator?.className || '',
      tooltip: Boolean(tooltip),
      original: Boolean(root?.querySelector('.fr-original-text')),
      translation: Boolean(root?.querySelector('.fr-translation-result')),
      resultText: root?.querySelector('.fr-translation-result pre')?.textContent?.trim() || '',
    };
    return Object.entries(expectedState).every(([key, value]) => key === 'resultPrefix'
      ? state.resultText.startsWith(String(value))
      : state[key] === value);
  }, expected, { timeout: 10000 }).catch((error) => {
    throw new Error(`${description}：${error.message}`);
  });
}

async function clickSelectionIndicator(page) {
  await page.evaluate(() => {
    const host = document.querySelector('#fluent-read-selection-translator-container');
    const indicator = host?.shadowRoot?.querySelector('.fr-selection-indicator');
    if (!(indicator instanceof HTMLElement)) throw new Error('找不到划词翻译入口');
    indicator.click();
  });
}

async function closeSelectionUi(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
}

async function triggerShortcut(page, label) {
  if (label === 'Ctrl') await page.keyboard.press('Control');
  else if (label === 'Alt / Option') await page.keyboard.press('Alt');
  else if (label === 'Shift') await page.keyboard.press('Shift');
  else await page.keyboard.press('F9');
  await page.waitForTimeout(450);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.artifactsDir, { recursive: true });
  const { chromium } = loadPlaywright(args.playwrightRoot);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-selection-trigger-edge-'));
  assertDedicatedProfile(profileDir);
  let context;
  const result = {
    ok: false,
    extensionDir: args.extensionDir,
    browser: 'Microsoft Edge',
    windowMode: args.headed ? 'headed-dedicated-profile' : 'background-screen-off',
    cases: [],
    screenshots: [],
    consoleErrors: [],
  };

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: args.browserPath,
      headless: false,
      args: [
        `--disable-extensions-except=${args.extensionDir}`,
        `--load-extension=${args.extensionDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        ...(args.headed ? [] : ['--start-minimized', '--window-position=-10000,-10000']),
      ],
      viewport: { width: 1280, height: 900 },
    });
    const { worker, extensionId } = await waitForWorker(context);
    result.extensionId = extensionId;

    await context.route('https://example.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FluentRead selection fixture</title></head><body><main></main></body></html>',
      });
    });
    await context.route('https://edge.microsoft.com/translate/translatetext**', async (route) => {
      let source = '';
      try {
        const body = route.request().postDataJSON();
        source = Array.isArray(body) ? String(body[0] || '') : String(body?.[0] || body?.text || '');
      } catch {
        source = '';
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ translations: [{ text: `测试译文：${source}` }] }]),
      });
    });

    const popup = await context.newPage();
    popup.on('pageerror', (error) => result.consoleErrors.push(`popup pageerror: ${error.message}`));
    popup.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(`popup console: ${message.text()}`); });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await popup.locator('.popup-shell').waitFor({ state: 'visible', timeout: 60000 });

    const page = await context.newPage();
    page.on('pageerror', (error) => result.consoleErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => { if (message.type() === 'error') result.consoleErrors.push(`console: ${message.text()}`); });
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForContentScript(page);

    const drawer = await openSelectionDrawer(popup);
    await setSelectionEnabled(popup, drawer, true);
    await page.locator('#fluent-read-selection-translator-container').waitFor({ state: 'attached', timeout: 10000 });
    await setSelectionMode(popup, drawer, '双语显示');

    // 视觉触发方式：Popup 改设置后不刷新页面，真实鼠标划词仍应即时反映新模式。
    for (const mode of [
      { label: '显示图标', className: 'fr-selection-indicator fr-selection-indicator--icon' },
      { label: '显示小点', className: 'fr-selection-indicator fr-selection-indicator--dot' },
    ]) {
      await closeSelectionUi(page);
      const popupState = await setSelectionTrigger(popup, drawer, worker, mode.label);
      await resetFixture(page);
      const selection = await selectTarget(page);
      await waitForSelectionUi(page, { indicator: true, tooltip: false, indicatorClass: mode.className }, `${mode.label} 显示入口`);
      const beforeClick = await readSelectionUi(page);
      assert(beforeClick.selectionText === selection.text, `${mode.label} 选区文本不一致`);
      await clickSelectionIndicator(page);
      await waitForSelectionUi(page, { tooltip: true, translation: true, resultPrefix: '测试译文：' }, `${mode.label} 点击后显示翻译`);
      const afterClick = await readSelectionUi(page);
      assert(afterClick.targetText === TARGET_TEXT, `${mode.label} 点击后改写了页面正文`);
      const screenshot = path.join(args.artifactsDir, `selection-${mode.label === '显示图标' ? 'icon' : 'dot'}.png`);
      await page.screenshot({ path: screenshot });
      result.screenshots.push(screenshot);
      result.cases.push({ id: `visual.${mode.label}`, status: 'passed', popupState, selection, beforeClick, afterClick });
    }

    await closeSelectionUi(page);
    const directPopupState = await setSelectionTrigger(popup, drawer, worker, '直接弹出');
    await resetFixture(page);
    const directSelection = await selectTarget(page);
    await waitForSelectionUi(page, { tooltip: true, indicator: false, translation: true, resultPrefix: '测试译文：' }, '直接弹出翻译框');
    const directUi = await readSelectionUi(page);
    assert(directUi.selectionText === directSelection.text && !directUi.indicator && directUi.targetText === TARGET_TEXT, '直接弹出改变了入口或页面正文');
    const directScreenshot = path.join(args.artifactsDir, 'selection-direct.png');
    await page.screenshot({ path: directScreenshot });
    result.screenshots.push(directScreenshot);
    result.cases.push({ id: 'visual.直接弹出', status: 'passed', popupState: directPopupState, selection: directSelection, ui: directUi });

    // 显示方式：双语和仅译文应分别渲染对应内容。
    await closeSelectionUi(page);
    await setSelectionMode(popup, drawer, '仅译文');
    await setSelectionTrigger(popup, drawer, worker, '直接弹出');
    await resetFixture(page);
    await selectTarget(page);
    await waitForSelectionUi(page, { tooltip: true, original: false, translation: true, resultPrefix: '测试译文：' }, '仅译文模式');
    const translationOnlyUi = await readSelectionUi(page);
    assert(translationOnlyUi.targetText === TARGET_TEXT && translationOnlyUi.translation && !translationOnlyUi.original && translationOnlyUi.resultText.startsWith('测试译文：'), '仅译文模式渲染不完整或改写了页面正文');
    result.cases.push({ id: 'display.translation-only', status: 'passed', ui: translationOnlyUi });

    await closeSelectionUi(page);
    await setSelectionMode(popup, drawer, '双语显示');
    await resetFixture(page);
    await selectTarget(page);
    await waitForSelectionUi(page, { tooltip: true, original: true, translation: true, resultPrefix: '测试译文：' }, '双语显示模式');
    const bilingualUi = await readSelectionUi(page);
    assert(bilingualUi.targetText === TARGET_TEXT && bilingualUi.original && bilingualUi.translation && bilingualUi.resultText.startsWith('测试译文：'), '双语模式渲染不完整或改写了页面正文');
    result.cases.push({ id: 'display.bilingual', status: 'passed', ui: bilingualUi });

    // 关闭/重新启用：关闭后不再挂载划词 UI，重新启用后恢复。
    await closeSelectionUi(page);
    await setSelectionEnabled(popup, drawer, false);
    await page.locator('#fluent-read-selection-translator-container').waitFor({ state: 'detached', timeout: 10000 });
    result.cases.push({ id: 'selection.disabled', status: 'passed' });
    await setSelectionEnabled(popup, drawer, true);
    await page.locator('#fluent-read-selection-translator-container').waitFor({ state: 'attached', timeout: 10000 });
    result.cases.push({ id: 'selection.re-enabled', status: 'passed' });

    // 预设快捷键：选区旁不显示图标/小点，按对应键后直接打开翻译框。
    for (const label of ['Ctrl', 'Alt / Option', 'Shift']) {
      await closeSelectionUi(page);
      const popupState = await setSelectionTrigger(popup, drawer, worker, label);
      await resetFixture(page);
      await selectTarget(page);
      await page.waitForTimeout(350);
      const beforeShortcut = await readSelectionUi(page);
      assert(!beforeShortcut.indicator && !beforeShortcut.tooltip, `${label} 模式仍显示了图标或翻译框`);
      await triggerShortcut(page, label);
      await waitForSelectionUi(page, { tooltip: true, indicator: false, translation: true }, `${label} 快捷键触发翻译`);
      const afterShortcut = await readSelectionUi(page);
      assert(afterShortcut.targetText === TARGET_TEXT, `${label} 快捷键改写了页面正文`);
      const screenshot = path.join(args.artifactsDir, `selection-${label === 'Ctrl' ? 'control' : label === 'Alt / Option' ? 'alt' : 'shift'}.png`);
      await page.screenshot({ path: screenshot });
      result.screenshots.push(screenshot);
      result.cases.push({ id: `shortcut.${label}`, status: 'passed', popupState, beforeShortcut, afterShortcut });
    }

    await closeSelectionUi(page);
    const customPopupState = await setSelectionTrigger(popup, drawer, worker, '自定义');
    await resetFixture(page);
    await selectTarget(page);
    await page.waitForTimeout(350);
    const beforeCustom = await readSelectionUi(page);
    assert(!beforeCustom.indicator && !beforeCustom.tooltip, '自定义快捷键模式仍显示了图标或翻译框');
    await triggerShortcut(page, '自定义');
    await waitForSelectionUi(page, { tooltip: true, indicator: false, translation: true }, '自定义快捷键触发翻译');
    const afterCustom = await readSelectionUi(page);
    assert(afterCustom.targetText === TARGET_TEXT, '自定义快捷键改写了页面正文');
    const customScreenshot = path.join(args.artifactsDir, 'selection-custom.png');
    await page.screenshot({ path: customScreenshot });
    result.screenshots.push(customScreenshot);
    result.cases.push({ id: 'shortcut.custom', status: 'passed', popupState: customPopupState, beforeShortcut: beforeCustom, afterShortcut: afterCustom });

    result.finalConfig = await readStoredConfig(worker);
    result.ok = result.cases.every(item => item.status === 'passed') && result.consoleErrors.length === 0;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    result.error = error.stack || error.message || String(error);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
  } finally {
    if (context) await context.close().catch(() => {});
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

'use strict';
/**
 * @file scripts/testing/run-settings-layout-polish-test.cjs
 * 文件职责：验证设置样式整理所涉及的真实交互、配置保留与响应式布局。
 * 主要内容：检查阅读预览、学习程度、请求限额、统一下拉、可选中提示、识图反馈去重、朗读来源及当前/备用识别资源层级；模型请求仅连接本机图片响应夹具，语言包交互用临时页内消息夹具。
 * 模块边界：只使用临时 Edge profile 和不抢焦点 helper，不读取用户配置、不调用真实供应商、不下载模型、不代表 Firefox 实机表现。
 */
const {waitForAsyncCondition} = require('./wait-for-async-condition.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const arg = (key, fallback) => { const i = process.argv.indexOf(`--${key}`); return i < 0 ? fallback : process.argv[i + 1]; };
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-settings-layout-polish-production'));
const packages = arg('playwright-root');
const {chromium} = require(path.join(packages, 'playwright'));
const sharp = require(path.join(packages, 'sharp'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper'));
const glyphs = fs.readFileSync(path.resolve(__dirname, '../../src/core/translation/visionProbeImage.ts'), 'utf8').match(/'[01]{35}'/g).map(s => s.slice(1, -1));
let responseMode = 'success', delay = 0;
const report = {ok: false, artifact: 'production', extensionDir, caseCoverage: [], layouts: [], screenshots: [], consoleErrors: [], modelRequests: [], persistenceCases: []};
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', async () => {
    try {
      const payload = JSON.parse(body);
      const match = JSON.stringify(payload).match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
      assert(match, 'probe sends an image');
      report.modelRequests.push({mode: responseMode, model: payload.model, image: true});
      const mode = responseMode;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (mode === 'failure') { response.writeHead(401, {'content-type': 'application/json'}); response.end(JSON.stringify({error: {message: 'fixture auth failure'}})); return; }
      const {data, info} = await sharp(Buffer.from(match[1], 'base64')).raw().toBuffer({resolveWithObject: true});
      let answer = '';
      for (let i = 0; i < 6; i++) {
        let cells = '';
        for (let c = 0; c < 35; c++) cells += data[((16 + Math.floor(c / 5) * 5) * info.width + 24 + i * 30 + c % 5 * 5) * info.channels] < 128 ? '1' : '0';
        const value = glyphs.indexOf(cells); assert(value >= 0); answer += value.toString(16).toUpperCase();
      }
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({id: 'fixture', object: 'chat.completion', created: 1, model: payload.model, choices: [{index: 0, message: {role: 'assistant', content: answer}, finish_reason: 'stop'}], usage: {prompt_tokens: 10, completion_tokens: 6, total_tokens: 16}}));
    } catch (error) { report.fixtureError = error.message; response.writeHead(500); response.end(error.message); }
  });
});
let session, page, worker, origin;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-settings-polish-'));
fs.mkdirSync(artifacts, {recursive: true});
async function read() {
  return page.evaluate(async () => { const r = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}); const credentials = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:credentials'}); if (!r.success || !credentials.success) throw new Error(r.error || credentials.error); return {...(typeof r.value === 'string' ? JSON.parse(r.value) : r.value), ...credentials.value}; });
}
async function patch(values) {
  const current = await read();
  const result = await page.evaluate(({values, expected}) => chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: values, expected, clientId: 'settings-polish-fixture', sequence: Date.now()}), {values, expected: Object.fromEntries(Object.keys(values).map(key => [key, current[key]]))});
  assert(result.success, result.error);
}
async function go(section) {
  await page.goto(`${origin}/options.html#${section}`);
  await page.locator('.settings-app').waitFor();
  await page.locator(`#${section}`).waitFor({state: 'visible'});
}
async function choose(name, label, root = page) {
  const input = root.getByRole('combobox', {name, exact: true});
  await input.scrollIntoViewIfNeeded(); await input.press('Enter');
  await page.getByRole('option', {name: label, exact: true}).click();
}
async function shot(locator, name) {
  await locator.scrollIntoViewIfNeeded();
  const file = path.join(artifacts, `${name}.png`); await locator.screenshot({path: file, animations: 'disabled'}); report.screenshots.push(file);
}
async function layout(label, locator) {
  const data = await locator.evaluate(el => ({width: el.clientWidth, scroll: el.scrollWidth, document: document.documentElement.scrollWidth, viewport: innerWidth}));
  assert(data.scroll <= data.width + 1 && data.document <= data.viewport + 1, `${label}: overflow ${JSON.stringify(data)}`);
  report.layouts.push({label, ...data});
}
const record = id => { report.caseCoverage.push({id, status: 'passed'}); console.log(id); };
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    session = await launchFocusSafePersistentContext({chromium, profileDir: profile, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', background: true, headless: false, viewport: {width: 1440, height: 1100}, timeout: 30000, browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(report.windowPlacement.browserFrontmost, false);
    worker = session.context.serviceWorkers()[0] || await session.context.waitForEvent('serviceworker', {timeout: 30000});
    origin = new URL(worker.url()).origin;
    if (origin === 'null') origin = worker.url().match(/^chrome-extension:\/\/[^/]+/)[0];
    page = await newPageWithoutForeground(session.context, 30000); page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    await go('settings-general');
    await patch({uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, theme: 'light', animations: false, display: 1, bilingualSentenceHighlightEnabled: true, disableImageTranslator: false, imageTranslationMangaEnabled: true, useCache: true, selectionTtsVoices: ['en-US-JennyNeural', 'zh-CN-XiaoxiaoMultilingualNeural']});
    await go('settings-translation');
    const reading = page.locator('.reading-assistance-settings');
    let a = await reading.locator('.reading-assistance-example').boundingBox(), b = await reading.locator('.reading-assistance-controls').boundingBox();
    assert(a.x + a.width < b.x && Math.abs(a.y - b.y) < 2);
    await reading.getByTestId('bilingual-highlight-preview-source').locator('span').nth(1).hover();
    assert.equal(await reading.locator('.is-sentence-highlighted').count(), 2);
    await reading.locator('.el-switch').click(); assert.equal(await reading.locator('.is-sentence-highlighted').count(), 0);
    await reading.locator('.el-switch').click();
    await reading.getByTestId('bilingual-highlight-preview-source').locator('span').first().focus(); assert.equal(await reading.locator('.is-sentence-highlighted').count(), 2);
    await reading.getByRole('radio', {name: '深色网页', exact: true}).click();
    assert.equal(await reading.locator('.translation-style-preview').getAttribute('data-page-theme'), 'dark');
    await shot(reading, 'reading-desktop');
    await reading.getByTestId('open-sentence-highlight-styles').click(); await page.locator('#translation-sentence-highlight-style').waitFor();
    record('reading preview left, toggle, keyboard, webpage theme and style navigation');

    await go('settings-selection');
    const learning = page.getByRole('radiogroup', {name: '学习程度', exact: true});
    await learning.scrollIntoViewIfNeeded();
    const row = learning.locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," settings-item ")][1]');
    const copy = await row.locator('.settings-item-copy').boundingBox(), control = await learning.boundingBox();
    assert(Math.abs(copy.x - control.x) < 2 && Math.abs(control.width - copy.width) < 2);
    await learning.getByRole('radio', {name: '高级', exact: true}).click();
    await page.reload(); await page.getByRole('radiogroup', {name: '学习程度', exact: true}).waitFor();
    assert.equal((await read()).harness.learningLevel, 'advanced');
    await shot(page.locator('.harness-preferences'), 'learning-level'); record('learning level aligned and saved');
    const speech = page.getByTestId('speech-settings');
    assert.equal(await speech.count(), 1); assert(!/重新下载一次/.test(await speech.innerText()));
    const initial = await read();
    await speech.getByRole('radio', {name: '仅本地', exact: true}).click();
    assert.equal(await speech.getByTestId('speech-online-voices').count(), 0);
    assert.equal(await speech.getByTestId('speech-local-voice').count(), 1);
    await choose('本地音色', '中文女声 001 · zh-CN', speech);
    await speech.getByRole('radio', {name: '仅在线', exact: true}).click();
    assert.equal(await speech.getByTestId('speech-local-voice').count(), 0);
    assert.equal(await speech.getByTestId('local-tts-model-row').count(), 0);
    assert.equal(await speech.getByTestId('speech-online-voices').count(), 1);
    await speech.getByRole('radio', {name: '在线优先', exact: true}).click();
    await page.reload(); await page.getByTestId('speech-settings').waitFor();
    const saved = await read(); assert.equal(saved.selectionTtsLocalVoice, 'zf_001'); assert.deepEqual(saved.selectionTtsVoices, initial.selectionTtsVoices);
    assert.equal(initial.selectionTtsVoices.length, 2);
    report.persistenceCases.push({id: 'speech-source', mode: saved.selectionTtsMode, localVoice: saved.selectionTtsLocalVoice, onlineVoices: saved.selectionTtsVoices, onlineVoicesPreserved: true});
    await shot(speech, 'speech-unified'); record('speech one group, relevant fields, retained preferences and no migration note');

    await go('settings-services'); await page.locator('[data-service-value="openai"]').first().click();
    await page.locator('[data-service-configuration-service="openai"]').waitFor();
    await page.getByTestId('model-picker-trigger').click();
    await page.locator('[data-model-id="gpt-4.1-mini"] .model-picker-option').click();
    // 密钥要求是接口兼容层面的二选一，使用与其他页签一致的分段按钮。
    assert.equal(await page.locator('[data-api-key-list] [data-api-key-auth-policy]').count(), 0);
    await page.getByRole('tab', {name: '接口兼容', exact: true}).click();
    const policy = page.locator('[data-api-key-requirement-row] [data-api-key-auth-policy]');
    assert.equal(await policy.getAttribute('role'), 'radiogroup');
    await policy.getByRole('radio', {name: '允许留空', exact: true}).click();
    await waitForAsyncCondition(() => page.evaluate(async () => (await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'})).value.requireApiKey['v2:["openai","gpt-4.1-mini"]'] === false), {timeoutMs: 10000, message: "gpt-4.1-mini 允许留空密钥策略未持久化"});
    assert.equal(await policy.getByRole('radio', {name: '允许留空', exact: true}).getAttribute('aria-checked'), 'true');
    await shot(page.locator('[data-api-key-requirement-row]'), 'key-policy');
    await shot(page.locator('.api-key-list'), 'key-list');
    await page.getByRole('tab', {name: '请求限制', exact: true}).click();
    const limits = page.getByTestId('request-limit-settings');
    const mode = limits.locator('[data-request-limit-mode]');
    await mode.getByRole('radio', {name: '自定义', exact: true}).click();
    await limits.getByRole('spinbutton', {name: '每秒最多请求数', exact: true}).fill('4');
    await limits.getByRole('spinbutton', {name: '每秒最多请求数', exact: true}).press('Tab');
    // 三项数值逐行排列：同一列、等宽，并与限制方式的控件左对齐。
    const boxes = await limits.locator('.request-limit-number').evaluateAll(nodes => nodes.map(el => {const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width};}));
    const modeBox = await mode.boundingBox();
    assert.equal(boxes.length, 3); assert(boxes.every(box => Math.abs(box.x - boxes[0].x) < 2 && Math.abs(box.width - boxes[0].width) < 2));
    assert(boxes[1].y > boxes[0].y && boxes[2].y > boxes[1].y && Math.abs(boxes[0].x - modeBox.x) < 2);
    await mode.getByRole('radio', {name: '跟随全局设置', exact: true}).click();
    assert.equal(await limits.locator('.el-input-number.is-disabled').count(), 3);
    await mode.getByRole('radio', {name: '自定义', exact: true}).click(); assert.equal(await limits.getByRole('spinbutton', {name: '每秒最多请求数', exact: true}).inputValue(), '4');
    await mode.getByRole('radio', {name: '跟随全局设置', exact: true}).click();
    await shot(limits, 'request-limits'); record('key requirement in compatibility, row-aligned limits, custom values and inherited disable state');

    const cfg = await read();
    await patch({proxy: {...cfg.proxy, openai: `http://127.0.0.1:${server.address().port}/v1`}, modelVision: {}});
    await page.reload(); await page.locator('[data-service-value="openai"]').first().click();
    assert.equal((await read()).model.openai, 'gpt-4.1-mini');
    assert.equal((await read()).requireApiKey['v2:["openai","gpt-4.1-mini"]'], false);
    assert((await page.getByTestId('model-picker-trigger').innerText()).includes('gpt-4.1-mini'));
    await page.getByRole('tab', {name: '模型偏好', exact: true}).click();
    const vision = page.getByTestId('model-vision-control');
    // “尚未确认”的说明收在标签旁的提示里，不再常驻一行；能力用三选一分段按钮指定。
    assert.equal(await vision.locator('.model-vision-setting').getByText('首次圈选时会自动检测').count(), 0);
    assert.equal(await vision.getByTestId('model-vision-capability').getByRole('radio').count(), 3);
    await vision.locator('button.field-help').hover();
    await page.locator('.fluentread-field-help-popper:visible').filter({hasText: '首次圈选时会自动检测'}).waitFor();
    await page.locator('.detail-hero').hover();
    await vision.getByTestId('model-vision-probe').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="model-vision-status"]')?.textContent.includes('已通过图片读取测试'));
    assert.equal(await vision.getByText('已通过图片读取测试', {exact: true}).count(), 1);
    assert.equal(await vision.getByTestId('model-vision-probe-feedback').count(), 0);
    await shot(vision, 'vision-single-result');
    responseMode = 'failure'; await vision.getByTestId('model-vision-probe').click();
    await vision.getByTestId('model-vision-probe-feedback').filter({hasText: '检测失败'}).waitFor();
    responseMode = 'success'; delay = 1800; await vision.getByTestId('model-vision-probe').click();
    await vision.getByTestId('model-vision-probe').filter({hasText: '取消'}).click();
    await vision.getByTestId('model-vision-probe-feedback').filter({hasText: '已取消'}).waitFor(); delay = 0;
    record('vision success shown once, failure and cancel retained');

    await page.locator('[data-service-value="aliyunTranslation"]').first().click();
    const region = page.locator('[data-cloud-region]'); await region.waitFor();
    await page.evaluate(() => {window.__frTooltipEvents = []; for (const type of ['focus', 'blur', 'mouseenter', 'mouseleave']) document.addEventListener(type, event => {if (event.target.matches?.('.field-help, .fluentread-field-help-popper')) window.__frTooltipEvents.push({type, at: Math.round(performance.now()), target: event.target.className, related: event.relatedTarget?.className});}, true);});
    const help = region.locator('.field-help'); await help.hover();
    const tooltip = page.locator('.fluentread-field-help-popper:visible').filter({hasText: 'mt.cn-hangzhou.aliyuncs.com'}); await tooltip.waitFor();
    await page.mouse.move(15, 15); await page.waitForTimeout(250); assert(await tooltip.isVisible());
    await tooltip.hover(); await page.waitForTimeout(750); assert(await tooltip.isVisible());
    assert.equal(await tooltip.evaluate(el => getComputedStyle(el).userSelect), 'text');
    const code = tooltip.locator('code');
    await code.dblclick(); assert((await page.evaluate(() => getSelection().toString())).length > 0);
    await shot(tooltip, 'tooltip-selectable');
    await page.mouse.move(15, 15); await tooltip.waitFor({state: 'hidden'});
    await help.focus(); await tooltip.waitFor(); await code.hover(); await code.dblclick(); await page.waitForTimeout(750); assert(await tooltip.isVisible());
    await page.mouse.move(15, 15); await tooltip.waitFor({state: 'hidden'});
    await help.evaluate(el => el.blur()); await help.focus(); await tooltip.waitFor();
    await help.press('Escape'); await tooltip.waitFor({state: 'hidden'});
    record('tooltip delayed close, pointer entry, native text selection and keyboard focus/Escape');

    await go('settings-image-translation');
    const image = page.locator('.image-recognition-settings'), manga = page.locator('[data-settings-anchor="manga"]'), resources = page.locator('[data-settings-anchor="resources"]');
    assert.equal(await image.locator('.settings-preview-controls .el-switch').count(), 2);
    assert.equal(await manga.locator('.settings-preview-controls .el-switch').count(), 1);
    assert.equal(await manga.getByRole('combobox', {name: '快速缓存图片数量', exact: true}).count(), 1);
    for (const selector of ['.manga-model-settings', '.image-ocr-section']) {
      assert.equal(await resources.locator(selector).evaluate(el => getComputedStyle(el).borderLeftWidth), '0px');
      assert.equal(await resources.locator(`${selector} .settings-card-heading`).count(), 0);
    }
    const engineDetails = resources.locator('.image-ocr-engine-details'), languageDetails = resources.locator('.image-ocr-language-details');
    assert.equal(await engineDetails.getAttribute('open'), null);
    assert.equal(await resources.locator('.image-ocr-pack-list').isVisible(), false);
    assert.equal(await resources.locator('.manga-download-settings').getAttribute('open'), null);
    assert.equal(await resources.getByRole('button', {name: '清除已下载资源', exact: true}).count(), 0);
    assert((await resources.boundingBox()).height < 600, 'default resources are compact');
    await shot(resources, 'resources-current');
    await resources.locator('.manga-download-settings > summary').click();
    const modelManagement = resources.locator('.manga-download-settings');
    assert.equal(await modelManagement.getByRole('combobox', {name: '模型下载来源', exact: true}).count(), 0);
    assert.equal(await modelManagement.locator('a[href*="huggingface"],a[href*="hf-mirror"],a[href*="modelscope"]').count(), 0);
    assert.doesNotMatch(await modelManagement.innerText(), /下载来源|官方源优先|备用镜像优先|Hugging Face|HF Mirror|ModelScope/iu);
    assert(await modelManagement.getByRole('button', {name: '导入已下载文件', exact: true}).isVisible());
    assert.equal(await resources.locator('.manga-download-settings > summary').evaluate(el => getComputedStyle(el).borderLeftWidth), '0px');
    await shot(resources.locator('.manga-download-settings'), 'resources-management');
    await resources.locator('.manga-download-settings > summary').click();
    record('model management keeps offline import and hides download source details');
    await choose('图片识别方式', 'Tesseract（轻量模型）', image);
    assert.equal(await engineDetails.getAttribute('open'), '');
    assert.equal(await languageDetails.getAttribute('open'), null);
    assert.equal((await read()).imageTranslationOcrEngine, 'tesseract');
    await shot(resources, 'resources-tesseract');
    await languageDetails.locator('summary').click();
    assert(await resources.locator('[data-language="eng"]').isVisible());
    await choose('图片识别方式', 'PaddleOCR（标准模型）', image);
    assert.equal(await engineDetails.getAttribute('open'), null);
    // 仅本次临时设置文档拦截语言包消息，不下载真实资产；验证折叠时收到任务、失败和就绪反馈。
    await page.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      window.__frOcrFixture = {languages: [], states: {}, failDownload: true, requests: []};
      chrome.runtime.sendMessage = function(message, ...args) {
        if (!['fluentReadImageOcrStatus', 'fluentReadImageOcrDownload', 'fluentReadImageOcrRemove'].includes(message?.type)) return original(message, ...args);
        const fixture = window.__frOcrFixture;
        const result = (async () => {
          if (message.type === 'fluentReadImageOcrDownload') {
            fixture.requests.push({type: message.type, languages: message.languages});
            for (const code of message.languages) fixture.states[code] = {phase: 'downloading'};
            await new Promise(resolve => setTimeout(resolve, 400));
            for (const code of message.languages) {
              if (fixture.failDownload) fixture.states[code] = {phase: 'error', error: '语言包下载失败'};
              else {delete fixture.states[code]; if (!fixture.languages.includes(code)) fixture.languages.push(code);}
            }
            if (fixture.failDownload) return {success: false, error: '语言包下载失败'};
          } else if (message.type === 'fluentReadImageOcrRemove') {
            fixture.requests.push({type: message.type, languages: message.languages});
            fixture.languages = fixture.languages.filter(code => !message.languages.includes(code));
          }
          return {success: true, languages: [...fixture.languages], states: structuredClone(fixture.states)};
        })();
        const callback = args.at(-1);
        if (typeof callback === 'function') {void result.then(callback); return;}
        return result;
      };
      window.__frOcrFixture.states.eng = {phase: 'queued'};
    });
    await engineDetails.waitFor({state: 'visible'});
    await page.waitForFunction(() => document.querySelector('.image-ocr-engine-details')?.open && document.querySelector('[data-language="eng"]')?.dataset.state === 'queued');
    assert.equal(await languageDetails.getAttribute('open'), '');
    await page.evaluate(() => {window.__frOcrFixture.states.eng = {phase: 'error', error: '语言包下载失败'};});
    const englishPack = resources.locator('[data-language="eng"]');
    await englishPack.getByRole('alert').waitFor();
    await englishPack.getByRole('button', {name: '下载 English 语言包', exact: true}).click();
    await englishPack.getByRole('button', {name: '下载 English 语言包', exact: true}).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-language="eng"]')?.dataset.state === 'error');
    await page.evaluate(() => {window.__frOcrFixture.failDownload = false;});
    await englishPack.getByRole('button', {name: '下载 English 语言包', exact: true}).click();
    await englishPack.getByRole('button', {name: '移除 English 语言包', exact: true}).waitFor();
    assert.equal(await englishPack.getByRole('alert').count(), 0);
    await englishPack.getByRole('button', {name: '移除 English 语言包', exact: true}).click();
    await englishPack.getByRole('button', {name: '下载 English 语言包', exact: true}).waitFor();
    report.resourceFixtureRequests = await page.evaluate(() => window.__frOcrFixture.requests);
    assert.equal(report.resourceFixtureRequests.filter(item => item.type === 'fluentReadImageOcrDownload').length, 2);
    assert.equal(report.resourceFixtureRequests.filter(item => item.type === 'fluentReadImageOcrRemove').length, 1);
    record('complete image/manga controls, compact current resources, folded alternatives, unified source selector; fixture task/error/retry/remove');

    await go('settings-sites');
    await choose('初始偏好', '隐藏悬浮球');
    await page.getByRole('combobox', {name: '初始偏好', exact: true}).press('Enter'); await shot(page.locator('.el-popper.fluentread-select-popper:visible'), 'site-preference-menu'); await page.getByRole('combobox', {name: '初始偏好', exact: true}).press('Escape');
    await shot(page.locator('.preference-add'), 'site-preference-selector'); record('site preference uses shared keyboard-enabled menu');
    for (const locale of ['zh-CN', 'en-US']) {
      await patch({uiLanguage: locale});
      for (const theme of ['light', 'dark']) {
        await patch({theme});
        for (const width of [1440, 1024, 820, 390]) {
          await page.setViewportSize({width, height: 1200});
          for (const section of ['settings-translation', 'settings-selection', 'settings-image-translation', 'settings-services', 'settings-sites']) {
            await go(section); await layout(`${locale} ${theme} ${width} ${section}`, page.locator('.settings-card'));
            if (section === 'settings-translation') {
              a = await reading.locator('.reading-assistance-example').boundingBox(); b = await reading.locator('.reading-assistance-controls').boundingBox();
              if (width > 850) assert(a.x + a.width < b.x); else assert(a.y + a.height < b.y);
            }
            if (locale === 'zh-CN' && [1440, 390].includes(width) && ['settings-translation', 'settings-selection', 'settings-image-translation'].includes(section)) {
              const target = section === 'settings-translation' ? reading : section === 'settings-selection' ? page.getByTestId('speech-settings') : page.locator('[data-settings-anchor="manga"]');
              await shot(target, `${section}-${theme}-${width}`);
            }
          }
        }
      }
    }
    assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors)); assert(!report.fixtureError, report.fixtureError); report.ok = true;
  } catch (error) {
    report.failure = error.stack; process.exitCode = 1;
    if (page && !page.isClosed()) report.tooltipEvents = await page.evaluate(() => window.__frTooltipEvents).catch(() => undefined);
    if (page && !page.isClosed()) await page.screenshot({path: path.join(artifacts, 'failure.png')}).catch(() => {});
  } finally {
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    await session?.close(); fs.rmSync(profile, {recursive: true, force: true}); server.close();
    console.log(JSON.stringify({ok: report.ok, cases: report.caseCoverage, failure: report.failure, report: path.join(artifacts, 'report.json')}, null, 2));
  }
})();

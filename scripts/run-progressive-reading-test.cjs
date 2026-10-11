#!/usr/bin/env node
'use strict';

// 在自有临时 Edge profile 与第二屏可见后台窗口中验证渐进阅读辅助。网页和翻译响应使用命名的本机确定性 HTTP 夹具，不声明真人理解率、在线供应商或 Firefox 实机验收。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {guardBrowserClose, getGuardedBrowserPid} = require('./testing/owned-browser-close.cjs');
const {SOURCE, TRANSLATION, UPDATED_SOURCE, UPDATED_TRANSLATION, ROUTE_SOURCE, createProgressiveReadingFixture} = require('./testing/progressive-reading-fixture.cjs');
const execFileAsync = promisify(execFile);
const arg = (name, fallback) => {const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-progressive-reading'));
const playwrightRoot = arg('playwright-root', process.env.PLAYWRIGHT_ROOT);
const popupOnly = process.argv.includes('--popup-only');
if (!playwrightRoot) throw new Error('Pass --playwright-root with the bundled Node package directory');
if (process.argv.includes('--headed') || process.argv.includes('--headless')) throw new Error('This targeted runner requires --background and does not authorize a foreground or headless fallback');
if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error(`Missing production extension manifest: ${extensionDir}`);
const {chromium} = createRequire(path.join(path.resolve(playwrightRoot), '__progressive_reading_runner__.cjs'))('playwright');
const helper = require(path.resolve(arg('focus-safe-helper', path.join(__dirname, 'testing/focus-safe-browser.cjs'))));
const browserPath = arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
const fixture = createProgressiveReadingFixture();
const profileDir = fs.mkdtempSync('/private/tmp/fluentread-progressive-reading-profile-');
fs.mkdirSync(artifactsDir, {recursive: true});
const report = {ok: false, extensionDir, browserPath, profileMode: 'fresh-mkdtemp-owned', profileDir, artifact: 'production', cases: [], screenshots: [], consoleErrors: [], focusSamples: [],
    executionScope: popupOnly ? 'popup-entry-only' : 'progressive-reading-targeted-flow',
    evidenceBoundary: 'Real production extension, real selection, DOM, trusted CDP keyboard/mouse and Vue Shadow UI in an isolated Edge browser. Local deterministic HTTP translation transport, Popup active-tab lookup and toolbar-close capture are fixtures. No live-provider, Firefox runtime, native-toolbar or human-comprehension claim.',
    reuseBoundary: 'This browser run verifies reuse of a translation already obtained within the same reading session. Reuse of a preexisting bilingual webpage artifact is outside this runner; its pure excerpt matcher is covered separately by unit tests.',
    ownedBrowserClosed: false, profileRemoved: false};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const record = (name, details = {}) => {report.cases.push({...details, name}); console.log(`PASS ${name}`);};
let session, context, control, popup, page, origin, fixtureInfo, browserPid, tabId;
let launchAttempted = false, monitor, monitorTask, monitorBusy = false, stopping = false, focusError;
const cdpSessions = new WeakMap(), ownedCdpSessions = new Set();

async function until(predicate, label, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (focusError) throw focusError;
        if (await predicate()) return;
        await wait(80);
    }
    throw new Error(`${label}: timeout`);
}
async function focusSample(label) {
    const {stdout} = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
        "ObjC.import('AppKit'); const app=$.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify({pid:Number(app.processIdentifier),name:ObjC.unwrap(app.localizedName)});"], {timeout: 5000});
    const foreground = JSON.parse(stdout.trim());
    report.focusSamples.push({label, ...foreground});
    assert(Number.isSafeInteger(browserPid) && browserPid > 0 && Number.isSafeInteger(foreground.pid) && foreground.pid > 0, 'Missing browser ownership or foreground PID');
    assert.notEqual(foreground.pid, browserPid, `${label}: owned test browser became the foreground app`);
}
function monitorFocus() {
    monitor = setInterval(() => {
        if (monitorBusy || stopping) return;
        monitorBusy = true;
        monitorTask = focusSample('continuous').catch(async error => {
            focusError = error; report.windowPlacement.browserFrontmost = true;
            clearInterval(monitor);
            await session.close().catch(closeError => {report.focusCloseError = closeError.message;});
        }).finally(() => {monitorBusy = false;});
    }, 750);
}
function observe(target) {
    target.on('pageerror', error => report.consoleErrors.push({url: target.url(), message: error.message}));
    target.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({url: target.url(), message: message.text()});});
}
async function open(url, viewport) {
    const target = await helper.newPageWithoutForeground(context, 30000); observe(target);
    if (viewport) await target.setViewportSize(viewport);
    await target.goto(url, {waitUntil: 'domcontentloaded'}); return target;
}
async function send(message) {return control.evaluate(message => chrome.runtime.sendMessage(message), message);}
async function readConfig() {
    const response = await send({type: 'configStorageRead', key: 'local:config'});
    assert(response?.success && response.value, 'Production configStorageRead failed'); return response.value;
}
async function patch(values) {
    const current = await readConfig(), initial = Object.hasOwn(values, 'token');
    const response = await send({type: 'persistConfig', mode: initial ? 'replace' : 'patch', config: initial ? {...current, ...values} : values,
        expected: Object.fromEntries(Object.keys(values).map(key => [key, current[key]])), baseRevision: initial ? current.__fluentConfigRevision || 0 : undefined,
        clientId: `progressive-reading-fixture-${Date.now()}`, sequence: 1});
    assert.equal(response?.success, true, response?.error);
    await until(async () => {const config = await readConfig(); return Object.keys(values).filter(key => key !== 'token').every(key => JSON.stringify(config[key]) === JSON.stringify(values[key]));}, 'config update');
    await wait(200);
}
async function vocabulary(action, values = {}) {
    const response = await send({type: 'fluentReadVocabularyBook', action, ...values});
    assert.equal(response?.success, true, JSON.stringify(response?.error)); return response.data;
}
function children(node) {return [...(node?.children || []), ...(node?.shadowRoots || []), ...(node?.contentDocument ? [node.contentDocument] : [])];}
function attr(node, name) {const list = node?.attributes || []; for (let index = 0; index < list.length; index += 2) if (list[index] === name) return list[index + 1] || ''; return undefined;}
function find(node, predicate) {if (!node) return null; if (predicate(node)) return node; for (const child of children(node)) {const result = find(child, predicate); if (result) return result;} return null;}
function findAll(node, predicate, found = []) {if (!node) return found; if (predicate(node)) found.push(node); for (const child of children(node)) findAll(child, predicate, found); return found;}
function text(node) {return !node ? '' : node.nodeName === '#text' ? node.nodeValue || '' : children(node).map(text).join('');}
const has = attribute => node => attr(node, attribute) !== undefined;
const mode = value => node => attr(node, 'data-reading-mode') === value;
async function snapshot() {
    let cdp = cdpSessions.get(page);
    if (!cdp) {cdp = await context.newCDPSession(page); cdpSessions.set(page, cdp); ownedCdpSessions.add(cdp);}
    const {root} = await cdp.send('DOM.getDocument', {depth: -1, pierce: true});
    const host = find(root, node => attr(node, 'id') === 'fluent-read-progressive-reading');
    return {cdp, host, panel: find(host, node => attr(node, 'data-reading-panel') !== undefined || (attr(node, 'class') || '').split(' ').includes('fr-reading'))};
}
async function ui(fn, value) {
    const state = await snapshot(); assert(state.panel?.nodeId, 'Missing progressive reading panel');
    const {object} = await state.cdp.send('DOM.resolveNode', {nodeId: state.panel.nodeId});
    try {
        const response = await state.cdp.send('Runtime.callFunctionOn', {objectId: object.objectId, functionDeclaration: fn.toString(), arguments: [{value}], returnByValue: true});
        if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
        return response.result.value;
    } finally {await state.cdp.send('Runtime.releaseObject', {objectId: object.objectId});}
}
async function click(predicate, label) {
    const state = await snapshot(), node = find(state.panel, predicate); assert(node?.nodeId, `Missing reading control: ${label}`);
    // 与 Playwright 普通 click 的自动滚动等价：只滚动面板现有容器，不改变布局或把裁切控件移到新位置。
    await state.cdp.send('DOM.scrollIntoViewIfNeeded', {nodeId: node.nodeId});
    const {model} = await state.cdp.send('DOM.getBoxModel', {nodeId: node.nodeId});
    const quad = model.content; assert(quad?.length === 8, `No clickable geometry: ${label}`);
    await page.mouse.click((quad[0] + quad[2] + quad[4] + quad[6]) / 4, (quad[1] + quad[3] + quad[5] + quad[7]) / 4);
}
async function focus(predicate, label) {
    const state = await snapshot(), node = find(state.panel, predicate); assert(node?.nodeId, `Missing keyboard control: ${label}`);
    await state.cdp.send('DOM.focus', {nodeId: node.nodeId});
}
async function queryPhrase(term) {
    const state = await snapshot();
    const hint = find(state.panel, node => has('data-reading-phrase')(node) && (attr(node, 'data-reading-term') || '').toLowerCase() === term);
    const button = find(hint, node => node.nodeName === 'BUTTON'); assert(button?.nodeId, `Missing phrase translation control for ${term}`);
    await state.cdp.send('DOM.scrollIntoViewIfNeeded', {nodeId: button.nodeId});
    const {model} = await state.cdp.send('DOM.getBoxModel', {nodeId: button.nodeId});
    const quad = model.content;
    await page.mouse.click((quad[0] + quad[2] + quad[4] + quad[6]) / 4, (quad[1] + quad[3] + quad[5] + quad[7]) / 4);
}
async function selectedMode() {return ui(function() {return this.querySelector('[data-reading-mode][aria-pressed="true"]')?.getAttribute('data-reading-mode');});}
async function sourceText() {return ui(function() {return this.querySelector('[data-reading-source]')?.textContent?.trim() || '';});}
async function translationText() {return ui(function() {return this.querySelector('[data-reading-translation]')?.textContent?.trim() || '';});}
async function phraseTerms() {const state = await snapshot(); return findAll(state.panel, has('data-reading-phrase')).map(node => ({term: attr(node, 'data-reading-term') || attr(node, 'data-reading-phrase') || text(node).trim(), text: text(node).trim()}));}
async function selectPrimary(expected) {
    await helper.activateExtensionTabWithoutForeground(context, page);
    await page.locator('#primary').scrollIntoViewIfNeeded();
    // 先结束前一次 Shadow UI 的焦点/选区，再用可信鼠标重新开始宿主选择；准备步骤不伪造 selectionchange 或键盘事件。
    await page.mouse.click(20, 20);
    await page.evaluate(() => getSelection()?.removeAllRanges());
    const points = await page.evaluate(() => {
        const node = document.querySelector('#primary').firstChild, range = document.createRange();
        range.setStart(node, 0); range.setEnd(node, 1); const first = range.getBoundingClientRect();
        range.setStart(node, node.length - 1); range.setEnd(node, node.length); const last = range.getBoundingClientRect();
        return {first: {x: first.left + 0.5, y: first.top + first.height / 2}, last: {x: last.right + 2, y: last.top + last.height / 2}};
    });
    await page.mouse.move(points.first.x, points.first.y); await page.mouse.down();
    await page.mouse.move(points.last.x, points.last.y, {steps: 18}); await page.mouse.up();
    assert.equal(await page.evaluate(() => getSelection()?.toString().trim()), expected, 'Trusted mouse did not select the entire original source');
}
async function capture(expected) {
    await selectPrimary(expected); await click(has('data-reading-use-selection'), 'use selected webpage text');
    await until(async () => (await sourceText()) === expected, 'selected source snapshot');
    assert.equal(await selectedMode(), 'original', 'Explicitly recapturing a source must restore original mode for this session');
}
async function openPopup() {
    const target = await helper.newPageWithoutForeground(context, 30000); observe(target);
    await target.setViewportSize({width: 400, height: 650});
    await target.addInitScript(({fixtureTabId}) => {
        // 工具栏 Popup 不创建 tab；测试页面会。夹具仅将 active-tab 查询指向实际本地正文页，保留 Promise 与 callback 契约。
        const query = chrome.tabs.query.bind(chrome.tabs);
        chrome.tabs.query = (info, callback) => {
            if (!info.active) return query(info, callback);
            const {active: _active, ...rest} = info;
            const matching = tabs => tabs.filter(tab => tab.id === fixtureTabId);
            return typeof callback === 'function' ? query(rest, tabs => callback(matching(tabs))) : query(rest).then(matching);
        };
        // 捕获工具栏关闭意图，避免把普通测试 tab 的 window.close 当作原生 Popup 关闭；它可能触发 macOS 窗口前台变化。
        window.__progressivePopupCloseInvocations = 0;
        window.close = () => {window.__progressivePopupCloseInvocations += 1;};
    }, {fixtureTabId: tabId});
    await target.goto(`${origin}/popup.html`, {waitUntil: 'domcontentloaded'});
    await target.locator('.popup-shell[data-config-ready="true"]').waitFor();
    return target;
}
async function openReading() {
    await popup.reload({waitUntil: 'domcontentloaded'});
    await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
    await helper.activateExtensionTabWithoutForeground(context, page);
    await popup.locator('[data-testid="progressive-reading"]').click();
    await until(async () => Boolean((await snapshot()).panel), 'Popup opens progressive reading');
    assert.equal(await page.locator('#fluent-read-progressive-reading').count(), 1, 'Reopening must not duplicate the Shadow host');
    assert.equal(await popup.evaluate(() => window.__progressivePopupCloseInvocations), 1, 'Successful reading action must request Popup closure');
    assert.equal(findAll((await snapshot()).host, node => attr(node, 'data-reading-mode') !== undefined).length, 4, 'The panel must offer four direct help modes');
}
async function popupEntryVariant(width, label) {
    await popup.setViewportSize({width, height: 650});
    const metrics = await popup.evaluate(() => {
        const shell = document.querySelector('.popup-shell'), shellBox = shell.getBoundingClientRect(), row = document.querySelector('.translate-action');
        const shortcut = row.querySelector('.translate-hotkey'), shortcutBox = shortcut?.getBoundingClientRect(), fullBox = row.querySelector('[data-testid="page-translation"]').getBoundingClientRect();
        return {viewportWidth: innerWidth, shellWidth: shellBox.width, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 || shell.scrollWidth > shell.clientWidth + 1 || row.scrollWidth > row.clientWidth + 1,
            hotkey: shortcut && {text: shortcut.textContent.trim(), clipped: shortcut.scrollWidth > shortcut.clientWidth + 1 || shortcutBox.left < fullBox.left - 1 || shortcutBox.right > fullBox.right + 1 || shortcutBox.bottom > fullBox.bottom + 1},
            buttons: [...row.querySelectorAll('button')].map(button => {
                const box = button.getBoundingClientRect(), label = button.querySelector('.translate-label') || [...button.querySelectorAll('span')].at(-1), text = label.getBoundingClientRect();
                return {id: button.dataset.testid, text: label.textContent.trim(), left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width,
                    clipped: button.scrollWidth > button.clientWidth + 1 || label.scrollWidth > label.clientWidth + 1 || text.left < box.left - 1 || text.right > box.right + 1,
                    withinShell: box.left >= shellBox.left - 1 && box.right <= shellBox.right + 1, visible: box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight};
            })};
    });
    await focusSample(`${label}:before-screenshot`);
    const file = path.join(artifactsDir, `${label}.png`); await popup.screenshot({path: file}); report.screenshots.push(file);
    await focusSample(`${label}:after-screenshot`); report.popupLayout ||= []; report.popupLayout.push({...metrics, label});
    assert.equal(metrics.viewportWidth, width); assert.equal(metrics.buttons.length, 3, 'Popup must expose exactly the full-page, local-section and progressive-reading actions');
    assert.equal(metrics.horizontalOverflow, false, `${label} Popup overflows: ${JSON.stringify(metrics)}`);
    assert(metrics.buttons.every(button => button.text && button.visible && button.withinShell && !button.clipped), `${label} Popup action text is clipped or outside the shell: ${JSON.stringify(metrics)}`);
    assert(metrics.hotkey?.text && !metrics.hotkey.clipped, `${label} Popup hotkey is missing or clipped: ${JSON.stringify(metrics)}`);
    const [full, section, reading] = metrics.buttons;
    assert(full.bottom <= section.top + 1 && Math.abs(section.top - reading.top) <= 1 && Math.abs(full.left - section.left) <= 1 && Math.abs(full.right - reading.right) <= 1,
        `${label}: full-page action must occupy the first row and two help actions the second: ${JSON.stringify(metrics)}`);
    return metrics;
}
async function popupEntryGeometry() {
    await popupEntryVariant(400, 'popup-400-progressive-entry');
    await popupEntryVariant(320, 'popup-320-progressive-entry');
    const previous = await readConfig();
    await patch({floatingBallHotkey: 'custom', customFloatingBallHotkey: 'Control+Alt+Shift+PageDown'});
    await popup.reload({waitUntil: 'domcontentloaded'}); await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
    const long = await popupEntryVariant(320, 'popup-320-long-hotkey');
    assert(long.hotkey.text.length >= 12, 'The long-shortcut fixture did not render enough modifiers to exercise wrapping');
    await popupEntryVariant(400, 'popup-400-long-hotkey');
    await patch({floatingBallHotkey: previous.floatingBallHotkey, customFloatingBallHotkey: previous.customFloatingBallHotkey});
    await popup.setViewportSize({width: 400, height: 650});
    record('320px and 400px real Popup documents expose full-page, local-section and reading actions in two rows with complete labels and a visible long hotkey', {variants: report.popupLayout});
}
async function shot(name) {
    await focusSample(`${name}:before-screenshot`);
    const file = path.join(artifactsDir, `${name}.png`);
    await page.screenshot({path: file}); report.screenshots.push(file);
    await focusSample(`${name}:after-screenshot`);
}
async function geometry(label) {
    const metrics = await ui(function() {
        const rect = this.getBoundingClientRect();
        return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight,
            horizontalOverflow: this.scrollWidth > this.clientWidth + 1, controls: [...this.querySelectorAll('button')].filter(node => node.getClientRects().length).map(node => {
                const box = node.getBoundingClientRect(); return {text: node.getAttribute('aria-label') || node.textContent.trim(), left: box.left, right: box.right, width: box.width, height: box.height};
            })};
    });
    assert(metrics.left >= -1 && metrics.right <= metrics.viewportWidth + 1 && metrics.top >= -1 && metrics.bottom <= metrics.viewportHeight + 1 && !metrics.horizontalOverflow, `${label}: overflowing reading panel ${JSON.stringify(metrics)}`);
    assert(metrics.controls.every(control => control.left >= metrics.left - 1 && control.right <= metrics.right + 1), `${label}: horizontally clipped control`);
    report.layout ||= {}; report.layout[label] = metrics;
}
async function narrowKeyboardFull() {
    await focus(mode('original'), 'narrow keyboard start');
    for (let index = 0; index < 30; index += 1) {
        await page.keyboard.press('Tab');
        const focused = await ui(function() {
            const active = this.getRootNode().activeElement, panel = this.getBoundingClientRect(), rect = active?.getBoundingClientRect();
            return {full: !!active?.hasAttribute('data-reading-full'), visible: !!rect && rect.top >= panel.top - 1 && rect.bottom <= panel.bottom + 1 && rect.left >= panel.left - 1 && rect.right <= panel.right + 1,
                name: active?.getAttribute('aria-label') || active?.textContent?.trim(), scrollTop: this.scrollTop};
        });
        if (!focused.full) continue;
        assert(focused.visible, `The narrow full-translation action is keyboard-focused but clipped: ${JSON.stringify(focused)}`);
        assert(focused.scrollTop > 0, 'The test must reach the action through the actual scrollable narrow panel');
        await page.keyboard.press('Enter'); await until(async () => (await selectedMode()) === 'bilingual', 'narrow full-translation keyboard action');
        record('390px trusted Tab scrolls the long phrase list to a visible full-translation action; Enter activates it', {steps: index + 1, ...focused});
        return;
    }
    throw new Error('Narrow keyboard navigation never reached the complete-translation action');
}

async function main() {
    try {
        fixtureInfo = await fixture.start();
        const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json')));
        launchAttempted = true;
        session = await helper.launchFocusSafePersistentContext({chromium, profileDir, browserPath, background: true, headless: false,
            viewport: {width: 1280, height: 900}, displayTarget: arg('display', 'secondary'), timeout: 30000,
            browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
        guardBrowserClose(session, profileDir); context = session.context; browserPid = await getGuardedBrowserPid(session);
        Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
        assert.equal(report.launchMode, 'macos-background-cdp'); assert.equal(report.focusPolicy, 'launchservices-no-foreground');
        assert.equal(report.windowPlacement.mode, 'background-visible-no-focus'); assert.equal(report.windowPlacement.browserFrontmost, false);
        await focusSample('launch'); monitorFocus();
        let worker;
        await until(async () => {
            for (const candidate of context.serviceWorkers()) {
                if (!candidate.url().startsWith('chrome-extension://') || !candidate.url().endsWith(`/${manifest.background.service_worker}`)) continue;
                const actual = await candidate.evaluate(() => {const value = chrome.runtime.getManifest(); return {name: value.name, version: value.version};}).catch(() => null);
                if (actual?.name === manifest.name && actual?.version === manifest.version) {worker = candidate; report.manifest = actual; return true;}
            }
            return false;
        }, 'production FluentRead worker', 30000);
        origin = `chrome-extension://${new URL(worker.url()).host}`;
        control = await open(`${origin}/${manifest.action.default_popup}`);
        const config = await readConfig(), service = 'custom:progressive-reading-fixture';
        await patch({on: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, theme: 'light', animations: false,
            service, from: 'en', to: 'zh-Hans', display: 1, autoTranslate: false, alwaysTranslateDomains: [], disabledExtensionDomains: [], useCache: false,
            customOpenAIProviders: [{id: service, name: '本机确定性阅读测试', endpoint: fixtureInfo.endpoint, models: ['progressive-reading-fixture']}],
            token: {[service]: 'synthetic-local-fixture-not-a-secret'}, model: {...config.model, [service]: 'progressive-reading-fixture'},
            user_role: {...config.user_role, [service]: 'SOURCE_BEGIN{{origin}}SOURCE_END'},
            enableAIContext: false, enableAIMultiSegment: false, glossaryEnabled: false, disableFloatingBall: true, disableSelectionTranslator: true,
            selectionTranslatorMode: 'disabled', vocabularyBookEnabled: true, vocabularyReencounterEnabled: false});
        const seeded = await readConfig();
        report.configSummary = Object.fromEntries(['on', 'service', 'from', 'to', 'display', 'autoTranslate', 'vocabularyBookEnabled', 'vocabularyReencounterEnabled', 'disableSelectionTranslator'].map(key => [key, seeded[key]]));
        const unmastered = await vocabulary('upsert', {input: {sourceLanguage: 'en', targetLanguage: 'zh-Hans', term: 'take into account', translation: '考虑；把……计入', kind: 'expression', context: {text: SOURCE}}});
        const mastered = await vocabulary('upsert', {input: {sourceLanguage: 'en', targetLanguage: 'zh-Hans', term: 'by and large', translation: '总体而言', kind: 'expression', context: {text: SOURCE}}});
        const otherSense = await vocabulary('upsert', {input: {sourceLanguage: 'en', targetLanguage: 'zh-Hans', term: 'bank', translation: '河岸', kind: 'expression', context: {text: 'They sat on the bank of the river.'}}});
        await vocabulary('setMastery', {entryId: mastered.id}); await vocabulary('setMastery', {entryId: otherSense.id});
        const entriesBefore = await vocabulary('list');
        page = await open(fixtureInfo.url, {width: 1200, height: 850});
        await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
        tabId = await control.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, fixtureInfo.url);
        const originalHtml = await page.locator('article').innerHTML();
        popup = await openPopup(); await popupEntryGeometry();
        if (popupOnly) {assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors)); await focusSample('popup-only-completed'); report.ok = true; return;}
        await openReading();
        assert.equal(await sourceText(), ''); assert.equal(fixture.requests.length, 0);
        assert(await ui(function() {return [...this.querySelectorAll('[data-reading-mode]')].every(button => button.disabled);}), 'Help modes must wait for an explicitly selected source');
        record('Popup entry opens four modes without fabricating a source or requesting translation');
        await capture(SOURCE); await click(mode('original'), 'original'); assert.equal(await selectedMode(), 'original');
        assert.equal(fixture.requests.length, 0); assert.equal(await page.locator('article').innerHTML(), originalHtml);
        assert.equal(await ui(function() {return getComputedStyle(this.querySelector('[data-reading-source]')).userSelect;}), 'text');
        record('Original source remains readable, selectable and unchanged, with no automatic provider call');
        await click(mode('phrases'), 'phrases');
        await until(async () => (await phraseTerms()).some(item => item.term.toLowerCase() === 'bank'), 'saved learning hints including the unfamiliar bank usage');
        let terms = await phraseTerms();
        assert(terms.some(item => item.term.toLowerCase() === 'take into account'), 'Saved multiword expression must remain eligible for help');
        assert(terms.some(item => item.term.toLowerCase() === 'bank'), 'A mastered word in a different meaning must remain eligible for help');
        assert(!terms.some(item => item.term.toLowerCase() === 'by and large'), 'An explicitly mastered matching expression should retreat');
        assert(find((await snapshot()).panel, has('data-reading-hidden-hints')), 'The reader needs an explicit way to recover omitted known hints');
        assert(/\d+/u.test(text(find((await snapshot()).panel, has('data-reading-hidden-hints')))), 'Known-hint status must state a recoverable omitted count');
        record('Multiword hints use the learning library, matching manual mastery retreats and unfamiliar senses remain available', {terms});
        await queryPhrase('bank');
        await until(async () => Boolean(await ui(function() {return this.querySelector('[data-reading-phrase-answer]')?.textContent.includes('银行（本机确定性测试响应');})), 'explicit phrase translation response');
        assert.equal(fixture.requests.filter(request => request.source === 'bank').length, 1);
        record('A familiar word in a different saved context can explicitly request its translation without changing mastery', {qualityBoundary: 'The bank response is a deterministic transport fixture; this verifies the requested text and rendering, not word-sense accuracy.'});
        await click(has('data-reading-show-known'), 'show familiar usages');
        await until(async () => (await phraseTerms()).some(item => item.term.toLowerCase() === 'by and large'), 'recover mastered hint');
        record('The reader can request a mastered expression again without relearning or feedback');
        const beforeLogic = fixture.requests.length;
        await click(mode('logic'), 'logic');
        const clues = findAll((await snapshot()).panel, has('data-reading-logic')).map(node => text(node).trim());
        const logicText = clues.join('\n').toLowerCase();
        assert(logicText.includes('not') && logicText.includes('may') && logicText.includes('if') && logicText.includes('only'), 'Actual clue nodes must quote source words for negation, possibility, condition and scope');
        assert.equal(fixture.requests.length, beforeLogic);
        record('Logic mode grounds clues in source words and does not make an additional AI request', {clues});
        await click(has('data-reading-full'), 'one-step complete bilingual');
        await until(async () => (await translationText()).includes(TRANSLATION), 'full bilingual translation');
        assert.equal(fixture.requests.filter(request => request.source === SOURCE).length, 1);
        const afterFull = fixture.requests.length;
        await click(mode('original'), 'original'); await click(mode('bilingual'), 'bilingual');
        await until(async () => (await translationText()).includes(TRANSLATION), 'reuse complete translation');
        assert.equal(fixture.requests.length, afterFull);
        record('One click reaches complete bilingual from logic and mode switches reuse the same reading-session translation', {requests: fixture.requests.slice()});
        await geometry('desktop'); await shot('desktop-bilingual');
        await focus(mode('original'), 'original keyboard start'); await page.keyboard.press('Enter');
        assert.equal(await selectedMode(), 'original'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
        assert.equal(await selectedMode(), 'phrases');
        record('Trusted keyboard Tab and Enter choose a help mode');
        await vocabulary('setMastery', {entryId: unmastered.id});
        // 清除显式“查看熟悉用法”覆盖，再重新捕获同一原句；生产变更广播必须读取最新掌握状态。
        await capture(SOURCE); await click(mode('phrases'), 'updated mastery phrases');
        await until(async () => !(await phraseTerms()).some(item => item.term.toLowerCase() === 'take into account'), 'mastery update retires phrase');
        await vocabulary('relearn', {entryId: unmastered.id});
        await until(async () => (await phraseTerms()).some(item => item.term.toLowerCase() === 'take into account'), 'relearn restores phrase');
        record('Existing explicit mastery and relearn updates refresh help without a parallel learning state');
        await page.setViewportSize({width: 390, height: 800}); await geometry('390-light'); await shot('390-light-phrases');
        await patch({theme: 'dark'}); await geometry('390-dark'); await shot('390-dark-phrases');
        await patch({theme: 'light'});
        const modesBeforeResize = await selectedMode(); assert.equal(modesBeforeResize, 'phrases');
        record('390px panel keeps controls inside the viewport under light and dark theme configuration', {visualPalette: 'Current progressive panel uses its own light palette; this case validates layout under both configurations.'});
        await narrowKeyboardFull(); await shot('390-keyboard-bilingual');
        await page.setViewportSize({width: 1200, height: 850});
        await page.locator('#host-link').click(); assert.equal(new URL(page.url()).hash, '#guide');
        await page.locator('#host-action').click(); assert.equal(await page.locator('#host-action').getAttribute('data-clicks'), '1');
        await until(async () => !(await snapshot()).host, 'host link route change releases its old reading panel');
        await openReading(); await capture(SOURCE); await click(has('data-reading-full'), 'full translation before DOM replacement');
        await until(async () => (await translationText()).includes(TRANSLATION), 'existing original-source translation before replacement');
        await page.evaluate(source => {const old = document.querySelector('#primary'), next = document.createElement('p'); next.id = 'primary'; next.textContent = source; old.replaceWith(next);}, UPDATED_SOURCE);
        await until(async () => (await sourceText()) === '' && (await translationText()) === '', 'host mutation clears stale source and translation');
        assert(text((await snapshot()).panel).includes('网页原文已变化'), 'Source invalidation must explain why help was cleared');
        await capture(UPDATED_SOURCE); await click(mode('logic'), 'logic after host mutation');
        assert.equal(await sourceText(), UPDATED_SOURCE); assert.equal(await translationText(), '', 'New source must never display the old translation');
        fixture.setResponseDelay(700);
        await click(mode('bilingual'), 'bilingual after host mutation');
        await until(() => fixture.requests.some(request => request.source === UPDATED_SOURCE), 'new source pending translation');
        await click(has('data-reading-close'), 'close during translation');
        await until(async () => !(await snapshot()).host, 'close during translation removes host');
        await openReading(); await capture(UPDATED_SOURCE);
        await wait(850); assert.equal(await selectedMode(), 'original'); assert.equal(await translationText(), '', 'An old pending answer must not appear after close and reopen');
        fixture.setResponseDelay(120); await click(has('data-reading-full'), 'complete bilingual after cancellation');
        await until(async () => (await translationText()).includes(UPDATED_TRANSLATION), 'mutated source translation');
        assert.equal(await page.locator('#primary').textContent(), UPDATED_SOURCE);
        record('Host links and buttons remain usable; replacing a selected DOM node permits explicit recapture with the new source');
        record('Closing during a deterministic delayed request prevents its old answer from appearing after reopening');
        await click(has('data-reading-close'), 'close'); await until(async () => !(await snapshot()).host, 'close removes mounted host');
        await openReading();
        assert.equal(findAll((await snapshot()).host, node => attr(node, 'data-reading-mode') !== undefined).length, 4);
        await focus(has('data-reading-close'), 'Escape from the panel'); await page.keyboard.press('Escape');
        await until(async () => !(await snapshot()).host, 'Escape closes panel');
        record('Close, reopen and trusted Escape remove the panel without duplicate hosts');
        await openReading();
        await page.evaluate(source => {document.querySelector('#primary').textContent = source;}, ROUTE_SOURCE);
        await capture(ROUTE_SOURCE); fixture.setResponseDelay(750);
        await click(has('data-reading-full'), 'pending full translation before route change');
        await until(() => fixture.requests.some(request => request.source === ROUTE_SOURCE), 'pending route-owned translation');
        const sourceBeforeRoute = await page.locator('#primary').innerHTML();
        // 调用真实 MAIN world 的 history 方法，依赖生产 bridge 自己派发路由通知，不合成 fluentread-route-change。
        await page.evaluate(() => history.pushState({readingFixture: true}, '', '/article?route=reading'));
        assert.equal(await page.locator('#primary').innerHTML(), sourceBeforeRoute, 'The route fixture must leave the host DOM unchanged');
        await until(async () => !(await snapshot()).host, 'pure pushState route change releases reading UI');
        await wait(900); assert.equal(Boolean((await snapshot()).host), false, 'A delayed answer must not resurrect the route-owned panel');
        fixture.setResponseDelay(120); await openReading(); await capture(ROUTE_SOURCE);
        assert.equal(await translationText(), '', 'Reopening after a route change must not display the old pending answer');
        record('Pure history.pushState with unchanged host DOM cancels the old request through the real MAIN bridge, closes help and permits reopening', {source: ROUTE_SOURCE, route: page.url()});
        await patch({on: false}); await until(async () => !(await snapshot()).host, 'global disable unmounts reading UI');
        const disabledResponse = await control.evaluate(id => chrome.tabs.sendMessage(id, {type: 'openProgressiveReading'}), tabId);
        await wait(250); assert.equal(Boolean((await snapshot()).host), false);
        await patch({on: true}); await wait(300); await openReading();
        const beforeNavigation = fixture.lifecycle.length;
        await page.goto(`${fixtureInfo.url}?reload=1`, {waitUntil: 'domcontentloaded'});
        await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
        await until(() => fixture.lifecycle.slice(beforeNavigation).some(item => item.event === 'pagehide'), 'real document unload');
        assert.equal(Boolean((await snapshot()).host), false);
        record('Global disable cleans the mount and blocks reopen; reenable works and actual navigation leaves no orphaned panel', {disabledResponse});
        const entriesAfter = await vocabulary('list');
        const mutable = new Set([unmastered.id]);
        for (const previous of entriesBefore.filter(entry => !mutable.has(entry.id))) {
            const latest = entriesAfter.find(entry => entry.id === previous.id);
            assert.deepEqual(latest, previous, 'Reading must not infer mastery, encounters or review state from passive behavior');
        }
        record('Opening, mode switches, scrolling and reading do not update learning records');
        assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors));
        await focusSample('completed'); report.ok = true;
    } catch (error) {
        report.error = {message: error.message, stack: error.stack};
        if (page && !page.isClosed() && !focusError) {
            await snapshot().then(state => {report.failureUi = {text: text(state.panel), phrases: findAll(state.panel, has('data-reading-phrase')).map(node => attr(node, 'data-reading-term'))};}).catch(() => {});
        }
        if (page && !page.isClosed() && !focusError) await shot('failure').catch(screenshotError => {report.screenshotError = screenshotError.message;});
        process.exitCode = 1;
    } finally {
        stopping = true; clearInterval(monitor); if (monitorTask) await monitorTask.catch(() => {});
        for (const cdp of ownedCdpSessions) await cdp.detach().catch(() => {});
        let closed = false;
        if (session) {
            try {await session.close(); closed = true; report.ownedBrowserClosed = true;}
            catch (error) {report.closeError = {message: error.message, code: error.code}; report.ok = false; process.exitCode = 1;}
        }
        // 只清理本脚本 mkdtemp 的 profile；无法确认自有浏览器已退出时保留目录用于诊断。
        if (closed || !launchAttempted) {fs.rmSync(profileDir, {recursive: true, force: true}); report.profileRemoved = true;}
        await fixture.close(); report.requests = fixture.requests; report.hostLifecycle = fixture.lifecycle;
        fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ok: report.ok, cases: report.cases.length, error: report.error?.message, artifactsDir, launchMode: report.launchMode, focusPolicy: report.focusPolicy, windowPlacement: report.windowPlacement,
            ownedBrowserClosed: report.ownedBrowserClosed, profileRemoved: report.profileRemoved}, null, 2));
    }
}
void main();

#!/usr/bin/env node
'use strict';

// 原生 PDF 右键专项：真实在线 PDF 保持原生查看器，受控分发浏览器菜单选文，复用生产卡片与本机翻译夹具。
// 仅给临时扩展副本加监听捕获 hook；popup 创建映射到预建后台标签，防止测试抢占 macOS 前台。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const support = require('./run-selection-trigger-test.cjs');
const helper = require('./testing/focus-safe-browser.cjs');
const {guardBrowserClose, getGuardedBrowserPid} = require('./testing/owned-browser-close.cjs');
const execFileAsync = promisify(execFile);
const arg = (name, fallback) => {const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1];};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const SOURCES = [
    'Time series databases (TSDBs) are crucial for performance',
    'scale of time series grows, the storage overhead of metadata',
    'spite of prior efforts in hybrid storage to reduce storage costs,',
    'storage devices to deliver superior performance.',
    'We propose PromTCS, which introduces two novel tech-',
    'monitoring in Internet applications and infrastructure. As the',
    '(labels) and data points (samples) increases significantly. In',
    'A'.repeat(4097),
];

async function until(predicate, message, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {if (await predicate()) return; await wait(80);}
    throw new Error(message);
}

function installTestHook() {
    const state = globalThis.__nativePdfTest = {clickedListeners: [], windowRequests: [], targetTabs: [], fetches: []};
    const clicked = chrome.contextMenus.onClicked, add = clicked.addListener.bind(clicked);
    clicked.addListener = listener => {state.clickedListeners.push(listener); return add(listener);};
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = (...args) => {
        const input = args[0]; state.fetches.push({url: typeof input === 'string' ? input : input?.url, method: args[1]?.method || 'GET'});
        return Reflect.apply(nativeFetch, globalThis, args);
    };
}

async function main() {
    const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
    const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-native-pdf-selection'));
    const packages = arg('playwright-root', process.env.PLAYWRIGHT_ROOT);
    const sourceUrl = arg('pdf-url', 'https://www.usenix.org/system/files/conference/fast27/fast27spring_prepub-kong.pdf');
    assert(packages, '需要 --playwright-root 或 PLAYWRIGHT_ROOT');
    assert(fs.existsSync(path.join(extensionDir, 'selection.html')), '请先构建包含 selection.html 的生产扩展');
    const {chromium} = createRequire(path.join(path.resolve(packages), 'native-pdf-selection-runner.cjs'))('playwright');
    fs.mkdirSync(artifactsDir, {recursive: true});
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-native-pdf-selection-'));
    const instrumentedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-native-pdf-extension-'));
    fs.cpSync(extensionDir, instrumentedDir, {recursive: true});
    const manifest = JSON.parse(fs.readFileSync(path.join(instrumentedDir, 'manifest.json'), 'utf8'));
    const workerPath = path.join(instrumentedDir, manifest.background.service_worker);
    const hook = `;(${installTestHook.toString()})();\n`;
    fs.writeFileSync(workerPath, hook + fs.readFileSync(workerPath, 'utf8'));
    fs.writeFileSync(path.join(artifactsDir, 'background-test-hook.js'), hook);
    const report = {ok: false, extensionDir, artifactsDir, sourceUrl, profileMode: 'new temporary profile', cases: [], requests: [], screenshots: [], consoleErrors: [], downloads: [], pdfRequests: [],
        inputEvidence: 'Real browser-registered contextMenus.onClicked listener, controlled selectionText from the referenced PDF. Native OS menu click and native-viewer selection capture are not automated.',
        windowEvidence: 'Production windows.create popup arguments captured; test adapter uses real tabs.update(active:false) and windows.get on precreated background tabs. Native popup creation/foreground behavior is not proven.',
        providerEvidence: 'Production selection card and translation runtime; deterministic loopback provider, not semantic/live-provider acceptance',
        instrumentation: 'Only temporary production-artifact copy: prepend context-menu listener capture and fetch observation; no product source or original build changed'};
    let launched, server, activeWorker, activeContext, closed = false;
    try {
        server = http.createServer(async (request, response) => {
            response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', '*');
            if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
            if (request.url !== '/v1/chat/completions') {response.writeHead(404); response.end(); return;}
            try {
                const chunks = []; for await (const chunk of request) chunks.push(chunk);
                const body = JSON.parse(Buffer.concat(chunks));
                const prompt = body.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
                const source = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1];
                assert.equal(typeof source, 'string', '夹具需要明确原文边界');
                const translation = `测试译文：${source}`, entry = {source, translation, model: body.model, startedAt: Date.now()};
                report.requests.push(entry);
                response.once('close', () => {if (!response.writableFinished) entry.canceledAt = Date.now();});
                await wait(source === SOURCES[4] ? 5000 : source === SOURCES[2] ? 1800 : 25); entry.completedAt = Date.now();
                if (response.destroyed) return;
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify({id: 'native-pdf-fixture', object: 'chat.completion', created: 1, model: body.model,
                    choices: [{index: 0, message: {role: 'assistant', content: translation}, finish_reason: 'stop'}], usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20}}));
            } catch (error) {response.writeHead(400); response.end(JSON.stringify({error: {message: error.message}}));}
        });
        await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
        const base = `http://127.0.0.1:${server.address().port}`;
        launched = await helper.launchFocusSafePersistentContext({chromium, profileDir, background: true, headless: false,
            browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
            viewport: {width: 1440, height: 960}, displayTarget: 'secondary', timeout: 30000,
            browserArgs: [`--disable-extensions-except=${instrumentedDir}`, `--load-extension=${instrumentedDir}`, '--no-first-run', '--no-default-browser-check']});
        guardBrowserClose(launched, profileDir);
        Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
        assert.equal(launched.windowPlacement.browserFrontmost, false);
        const context = activeContext = launched.context, browserPid = await getGuardedBrowserPid(launched);
        const checkFocus = async stage => {
            if (process.platform !== 'darwin') return;
            const {stdout} = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', "ObjC.import('AppKit');const app=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({pid:Number(app.processIdentifier),name:ObjC.unwrap(app.localizedName)||''});"], {timeout: 5000});
            const state = JSON.parse(stdout.trim()); (report.focusChecks ||= []).push({stage, ...state, browserFrontmost: state.pid === browserPid});
            assert.notEqual(state.pid, browserPid, '隔离测试浏览器成为前台，停止');
        };
        const newPage = async () => {
            const page = await helper.newPageWithoutForeground(context, 30000); page.setDefaultTimeout(30000);
            page.on('pageerror', error => report.consoleErrors.push({url: page.url(), error: error.message}));
            page.on('download', download => {report.downloads.push({url: download.url(), filename: download.suggestedFilename()}); void download.cancel();});
            return page;
        };
        const {worker, extensionId} = await support.waitForWorker(context), origin = `chrome-extension://${extensionId}`; activeWorker = worker;
        context.on('request', request => {
            if (request.url() !== sourceUrl) return;
            let frameUrl; try {frameUrl = request.frame()?.url();} catch {frameUrl = request.serviceWorker()?.url();}
            report.pdfRequests.push({url: request.url(), method: request.method(), frameUrl, at: Date.now()});
        });
        await until(() => worker.evaluate(() => globalThis.__nativePdfTest.clickedListeners.length > 0), '后台菜单点击监听未注册');
        const configPage = await newPage(); await configPage.goto(`${origin}/document.html`); await configPage.locator('.file-drop-zone').waitFor();
        const current = await support.readStoredConfig(configPage), service = 'custom:native-pdf-fixture';
        await support.patchStoredConfig(configPage, {on: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, service, from: 'en', to: 'zh-Hans',
            selectionTranslationService: service, model: {...current.model, [service]: 'native-pdf-fixture'},
            user_role: {...current.user_role, [service]: 'SOURCE_BEGIN{{origin}}SOURCE_END'},
            customOpenAIProviders: [{id: service, name: 'PDF 本机确定性测试', endpoint: `${base}/v1/chat/completions`, models: ['native-pdf-fixture']}],
            requireApiKey: {[`v2:${JSON.stringify([service, 'native-pdf-fixture'])}`]: false}, token: {...current.token, [service]: 'fixture-token'},
            selectionTranslatorMode: 'bilingual', disableSelectionTranslator: false, selectionTranslatorPresentation: 'card',
            selectionTranslatorTrigger: 'contextMenu', selectionTranslatorAutoDismiss: false, disabledExtensionDomains: [],
            useCache: false, hotkey: 'none', floatingBallHotkey: 'none', enableAIContext: false, enableAIMultiSegment: false});
        await wait(500);
        const targets = [];
        for (let index = 0; index < SOURCES.length; index++) {
            const page = await newPage();
            await page.setViewportSize({width: 520, height: 680});
            await page.goto(`${origin}/popup.html#native-pdf-test-target-${index}`);
            const id = await page.evaluate(async () => (await chrome.tabs.getCurrent()).id);
            assert(Number.isInteger(id)); targets.push({page, id});
        }
        await worker.evaluate(ids => {
            const state = globalThis.__nativePdfTest; state.targetTabs = [...ids];
            chrome.windows.create = (properties, callback) => {
                const targetId = state.targetTabs.shift(); state.windowRequests.push({properties, targetId});
                const result = Promise.resolve().then(async () => {
                    if (!Number.isInteger(targetId)) throw new Error('No owned background destination');
                    const tab = await chrome.tabs.update(targetId, {url: properties.url, active: false});
                    const window = await chrome.windows.get(tab.windowId); return {...window, tabs: [tab]};
                });
                if (typeof callback === 'function') {result.then(callback); return undefined;}
                return result;
            };
        }, targets.map(target => target.id));
        const native = await newPage();
        await native.goto(sourceUrl, {waitUntil: 'domcontentloaded', timeout: 45000}); await wait(1500); await checkFocus('native PDF loaded');
        const nativeTabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, sourceUrl);
        assert(Number.isInteger(nativeTabId));
        report.nativePdf = await native.evaluate(() => ({url: location.href, contentType: document.contentType, embed: [...document.querySelectorAll('embed')].map(element => ({type: element.type, src: element.src})), text: document.body?.innerText || ''}));
        assert.equal(report.nativePdf.contentType, 'application/pdf'); assert.equal(native.url(), sourceUrl); assert.equal(report.nativePdf.text, '');
        const pdfRequestsBefore = report.pdfRequests.length;
        const shot = async (page, name) => {await checkFocus(name); const file = path.join(artifactsDir, `${name}.png`); await page.screenshot({path: file, animations: 'disabled'}); report.screenshots.push(file);};
        await shot(native, 'native-pdf-retained');
        const record = (name, proof) => {report.cases.push({name, ...proof}); process.stdout.write(`PASS ${name}\n`);};
        const ui = async (page, name) => support.findCdpNode((await support.getSelectionUiTree(page)).root, node => support.hasCdpClass(node, name));
        const cardText = async page => support.cdpText(await ui(page, 'fr-translation-tooltip'));
        const dispatch = async index => {
            await helper.activateExtensionTabWithoutForeground(context, native); await checkFocus(`before menu handoff ${index}`);
            const source = SOURCES[index], destination = targets[index].page;
            await worker.evaluate(async ({selectionText, tabId, url, destinationId}) => {
                const state = globalThis.__nativePdfTest, targetIndex = state.targetTabs.indexOf(destinationId);
                if (targetIndex < 0) throw new Error('Owned destination was already used');
                state.targetTabs.splice(targetIndex, 1); state.targetTabs.unshift(destinationId);
                const tab = await chrome.tabs.get(tabId);
                const info = {menuItemId: 'fluent-read:selection:translateSelection', selectionText, pageUrl: url, frameUrl: url, frameId: 0};
                for (const listener of globalThis.__nativePdfTest.clickedListeners) listener(info, tab);
            }, {selectionText: source, tabId: nativeTabId, url: sourceUrl, destinationId: targets[index].id});
            await destination.waitForURL(url => url.href.startsWith(`${origin}/selection.html`));
            const request = await worker.evaluate(targetId => globalThis.__nativePdfTest.windowRequests.find(entry => entry.targetId === targetId), targets[index].id);
            const popupUrl = request.properties.url, parameters = new URLSearchParams(new URL(popupUrl).hash.slice(1));
            if (index === SOURCES.length - 1) {assert.deepEqual([...parameters.keys()], ['error']); assert.equal(parameters.get('error'), 'too-long');}
            else {assert.deepEqual([...parameters.keys()], ['token']); assert.match(parameters.get('token'), /^[a-f0-9]{32}$/u);}
            assert(!decodeURIComponent(popupUrl).includes(source)); assert(!popupUrl.includes(encodeURIComponent(sourceUrl)));
            return {source, destination, popupUrl};
        };
        const completed = async proof => {
            await until(async () => (await cardText(proof.destination)).includes(`测试译文：${proof.source}`), 'PDF 结果卡片未显示本次选文译文');
            const card = await cardText(proof.destination); assert(card.includes(proof.source));
            assert.equal(report.requests.filter(entry => entry.source === proof.source).length, 1, '每次选文只发一个服务请求');
            assert.equal(native.url(), sourceUrl, '原生 PDF 标签不得跳转');
            return card;
        };
        const first = await dispatch(0), firstCard = await completed(first); await shot(first.destination, 'first-native-pdf-selection-result');
        record('native PDF menu selection opens current text without opening a reader', {selection: first.source, card: firstCard, tokenUrl: first.popupUrl});
        const beforeHeaderClicks = report.requests.length;
        await first.destination.locator('.native-pdf-selection-source small').click(); await wait(150);
        assert((await cardText(first.destination)).includes(`测试译文：${first.source}`), '点击来源标题不得清空已有卡片');
        await first.destination.locator('.native-pdf-selection-source p').click(); await wait(150);
        assert((await cardText(first.destination)).includes(`测试译文：${first.source}`), '点击只读原文不得清空已有卡片');
        assert.equal(report.requests.length, beforeHeaderClicks, '点击来源不应重新翻译'); await shot(first.destination, 'source-header-keeps-result');
        record('clicking source title and original text keeps the current result', {requestCount: report.requests.length});
        await first.destination.locator('.fr-close-btn').click();
        await until(() => first.destination.isClosed(), '关闭结果卡片未关闭其结果标签');
        const second = await dispatch(1), secondCard = await completed(second); assert(!secondCard.includes(first.source));
        await shot(second.destination, 'second-native-pdf-selection-result');
        record('closing and selecting another passage does not reuse the old result', {selection: second.source, card: secondCard});
        const pending = await dispatch(4);
        await until(() => report.requests.some(entry => entry.source === pending.source), '取消夹具请求未开始');
        await support.patchStoredConfig(configPage, {disableSelectionTranslator: true, selectionTranslatorMode: 'disabled'});
        await until(async () => !(await ui(pending.destination, 'fr-translation-tooltip')), '关闭划词配置后卡片未卸载');
        await until(() => Boolean(report.requests.find(entry => entry.source === pending.source)?.canceledAt), '关闭划词配置后原服务请求未取消', 3500);
        assert((await pending.destination.locator('body').innerText()).includes('划词翻译已关闭'));
        await shot(pending.destination, 'disabled-selection-cancels-pending-result');
        await pending.destination.getByRole('button', {name: '关闭窗口', exact: true}).click(); await until(() => pending.destination.isClosed(), '关闭停用状态页失败');
        await support.patchStoredConfig(configPage, {disableSelectionTranslator: false, selectionTranslatorMode: 'bilingual'}); await wait(200);
        assert(!await ui(second.destination, 'fr-translation-tooltip'), '恢复划词配置不应重新打开已失效的旧选文');
        record('disabling selection unloads cards and cancels the pending provider request', {source: pending.source, canceledAt: report.requests.find(entry => entry.source === pending.source).canceledAt});
        const slow = await dispatch(2), fast = await dispatch(3);
        const fastCard = await completed(fast), slowCard = await completed(slow);
        assert(!slowCard.includes(fast.source)); assert(!fastCard.includes(slow.source));
        assert(report.requests.find(entry => entry.source === SOURCES[3]).completedAt < report.requests.find(entry => entry.source === SOURCES[2]).completedAt, '并发夹具需要确实让后请求先完成');
        await shot(slow.destination, 'concurrent-slow-native-pdf-result'); await shot(fast.destination, 'concurrent-fast-native-pdf-result');
        record('concurrent result pages keep their own selection after reversed completion', {slow: {selection: slow.source, card: slowCard}, fast: {selection: fast.source, card: fastCard}});
        const triggerDismissals = [];
        for (const [index, trigger] of [[5, 'Control'], [6, 'contextMenu']]) {
            await support.patchStoredConfig(configPage, {selectionTranslatorTrigger: 'icon'}); await wait(150);
            const proof = await dispatch(index); await completed(proof);
            await shot(proof.destination, `trigger-icon-result-before-${trigger}`);
            const requestsBeforeTrigger = report.requests.length;
            await support.patchStoredConfig(configPage, {selectionTranslatorTrigger: trigger});
            await until(() => proof.destination.isClosed(), `切换触发方式至 ${trigger} 后结果窗口未关闭，仍可能留下来源摘要空窗`, 5000);
            assert.equal(report.requests.length, requestsBeforeTrigger, '更换触发方式不应重新请求译文');
            assert.equal(native.isClosed(), false, '更换划词触发方式不得关闭原生 PDF');
            assert.equal(native.url(), sourceUrl, '更换划词触发方式不得导航原生 PDF');
            await checkFocus(`trigger ${trigger} closes standalone result`);
            triggerDismissals.push({from: 'icon', to: trigger, closed: true, nativePdfRetained: true});
        }
        await support.patchStoredConfig(configPage, {selectionTranslatorTrigger: 'contextMenu'}); await wait(150);
        record('changing selection trigger closes standalone result windows without a blank source shell', {transitions: triggerDismissals});
        const requestsBeforeLong = report.requests.length, tooLong = await dispatch(SOURCES.length - 1);
        await until(async () => (await tooLong.destination.locator('body').innerText()).includes('4096'), '超长选区缺少4096字符限制提示');
        await wait(200); assert.equal(report.requests.length, requestsBeforeLong); assert(!await ui(tooLong.destination, 'fr-translation-tooltip'));
        await shot(tooLong.destination, 'too-long-selection-visible-feedback');
        record('4097-character menu selection shows the limit without a provider request', {length: tooLong.source.length, message: await tooLong.destination.locator('body').innerText()});
        await tooLong.destination.getByRole('button', {name: '关闭窗口', exact: true}).click(); await until(() => tooLong.destination.isClosed(), '关闭超长选区提示失败');
        report.popupRequests = await worker.evaluate(() => globalThis.__nativePdfTest.windowRequests);
        assert.equal(report.popupRequests.length, SOURCES.length);
        for (const request of report.popupRequests) {assert.equal(request.properties.type, 'popup'); assert.equal(request.properties.width, 520); assert.equal(request.properties.height, 680);}
        report.backgroundPdfFetches = await worker.evaluate(url => globalThis.__nativePdfTest.fetches.filter(entry => entry.url === url), sourceUrl);
        assert.equal(report.backgroundPdfFetches.length, 0, '右键划词不得从后台下载原 PDF');
        report.extensionPdfRequests = report.pdfRequests.slice(pdfRequestsBefore).filter(entry => entry.frameUrl?.startsWith(origin));
        assert.equal(report.extensionPdfRequests.length, 0, '结果页面不得下载原 PDF');
        assert.equal(report.downloads.length, 0, '右键划词不得产生下载');
        report.storageProbe = await configPage.evaluate(async sources => {
            const local = JSON.stringify(await chrome.storage.local.get(null));
            const session = chrome.storage.session ? JSON.stringify(await chrome.storage.session.get(null)) : '';
            return {localContainsSelection: sources.some(source => local.includes(source)), sessionContainsSelection: sources.some(source => session.includes(source))};
        }, SOURCES);
        assert.equal(report.storageProbe.localContainsSelection, false); assert.equal(report.storageProbe.sessionContainsSelection, false);
        assert.equal(context.pages().filter(page => page.url().startsWith(`${origin}/document.html#pdf=`)).length, 0);
        assert.equal(native.url(), sourceUrl); assert.equal(report.requests.length, SOURCES.length - 1); await checkFocus('complete'); report.ok = true;
    } catch (error) {
        report.error = error.stack || String(error); process.exitCode = 1;
        try {
            if (activeWorker) report.popupRequests = await activeWorker.evaluate(() => globalThis.__nativePdfTest.windowRequests);
            report.failurePages = [];
            for (const page of activeContext?.pages() || []) {
                if (!/\/selection\.html/u.test(page.url())) continue;
                const file = path.join(artifactsDir, `failed-result-${report.failurePages.length}.png`);
                report.failurePages.push({url: page.url(), text: await page.locator('body').innerText()});
                await page.screenshot({path: file}); report.screenshots.push(file);
            }
        } catch (diagnosticError) {report.diagnosticError = diagnosticError.message;}
    }
    finally {
        if (launched) {try {await launched.close(); closed = true;} catch (error) {report.cleanupError = error.stack || String(error); process.exitCode = 1;}}
        if (!launched || closed) {fs.rmSync(profileDir, {recursive: true, force: true}); fs.rmSync(instrumentedDir, {recursive: true, force: true});}
        else {report.retainedProfile = profileDir; report.retainedInstrumentedExtension = instrumentedDir;}
        if (server) await new Promise(resolve => {server.close(resolve); server.closeAllConnections();});
        fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
        process.stdout.write(JSON.stringify({ok: report.ok, cases: report.cases, error: report.error, cleanupError: report.cleanupError, artifactsDir, launchMode: report.launchMode, focusPolicy: report.focusPolicy, windowPlacement: report.windowPlacement}, null, 2) + '\n');
    }
}

main().catch(error => {process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1;});

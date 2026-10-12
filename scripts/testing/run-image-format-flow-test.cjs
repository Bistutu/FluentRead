'use strict';
/**
 * @file scripts/testing/run-image-format-flow-test.cjs
 * 文件职责：在临时后台 Edge 中验证跨域 WebP、GIF、BMP、AVIF 和 ICO 的真实图片翻译链路。
 * 主要内容：核对原始 MIME、真实 Paddle/Tesseract OCR 和线上翻译，检查 PNG 译图、透明区域、可信点击切换、缓存及原图所有权，保存各格式证据。
 * 模块边界：仅读取指定生产构建和图片夹具，使用显式 focus-safe helper；模型可从已验证文件预置到临时缓存，OCR 与翻译响应始终不模拟。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execFileAsync = promisify(execFile);
const arg = (name, fallback) => {const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-image-format-flow'));
const manifestPath = path.resolve(arg('fixture-manifest', path.join(__dirname, 'image-format-fixtures/manifest.json')));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const fixtureSelector = arg('fixtures', 'baseline');
const fixtures = manifest.fixtures.filter(fixture => fixtureSelector === 'all' || fixture.tag === fixtureSelector || fixture.tags?.includes(fixtureSelector) || fixtureSelector.split(',').includes(fixture.name));
const engines = arg('engines', 'paddle,tesseract').split(',');
const pathModes = arg('path-modes', 'cross-origin').split(',');
const service = arg('service', 'google');
const modelsDir = arg('models-dir', null);
const languageDir = arg('language-dir', null);
const timeout = Number(arg('timeout-ms', '240000'));
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper'));
assert.ok(fixtures.length, 'No fixtures selected');
assert.ok(engines.every(engine => ['paddle', 'tesseract'].includes(engine)), 'Unsupported OCR engine');
assert.ok(pathModes.every(mode => ['cross-origin', 'canvas'].includes(mode)), 'Unsupported image read path');
fs.mkdirSync(artifacts, {recursive: true});
const profile = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fluentread-image-format-flow-profile-'));
const report = {extensionDir, manifestPath, engines, pathModes, service, scope: 'Real production OCR and live translation provider on binary fixtures; cross-origin preserves MIME, same-origin exercises page Canvas. No simulated OCR or translation responses.', profileMode: 'automatically-created-temporary-profile', cases: [], errors: []};
const persist = () => fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const files = [];
const collect = directory => {for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {const file = path.join(directory, entry.name); if (entry.isDirectory()) collect(file); else if (file.endsWith('.js')) files.push(file);}};
collect(extensionDir);
const assetHash = crypto.createHash('sha256');
for (const file of files.sort()) assetHash.update(path.relative(extensionDir, file)).update('\0').update(fs.readFileSync(file));
report.javascriptAssetsSha256 = assetHash.digest('hex');
let session, page;
let browserPid;
let sequence = 0;
const normalized = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

async function assertBackground(result) {
    try {
        const {stdout} = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', "ObjC.import('AppKit');const app=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({pid:Number(app.processIdentifier),name:ObjC.unwrap(app.localizedName)||''});"], {timeout: 5000});
        const application = JSON.parse(stdout.trim());
        assert.ok(Number.isInteger(application.pid) && application.pid > 0, 'Could not read macOS foreground application');
        report.foregroundChecks = (report.foregroundChecks || 0) + 1;
        if (application.pid === browserPid) {report.focusViolation = {...application, at: new Date().toISOString()}; report.windowPlacement.browserFrontmost = true; throw new Error(`Focus guard: temporary test Edge ${browserPid} became foreground`);}
        if (result) result.frontmostAfter = application;
        report.frontmostAfter = application;
    } catch (error) {error.fatalFocus = true; throw error;}
}

async function patchConfig(popup, engine) {
    return popup.evaluate(async ({engine, service, sequence}) => {
        const current = (await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'})).value;
        const patch = {on: true, disableImageTranslator: false, from: 'en', to: 'zh-Hans', service, imageTranslationService: service, imageTranslationOcrEngine: engine, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true};
        const response = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: patch,
            expected: Object.fromEntries(Object.keys(patch).map(key => [key, current[key]])), clientId: 'image-format-flow', sequence, baseRevision: current.__fluentConfigRevision || 0});
        if (!response.success) throw new Error(response.error);
        return patch;
    }, {engine, service, sequence: ++sequence});
}

async function seedPaddle(popup) {
    if (!modelsDir) return;
    const metadata = fs.readFileSync(path.resolve(__dirname, '../../src/features/image-translation/services/mangaOcrAssets.ts'), 'utf8');
    const root = /const ROOT = '([^']+)'/.exec(metadata)?.[1];
    const assets = [...metadata.matchAll(/path: '([^']+)', bytes: (\d+),\s*sha256: '([a-f0-9]{64})'/g)].map(match => ({path: match[1], bytes: Number(match[2]), sha256: match[3]}));
    assert.ok(root); assert.equal(assets.length, 3);
    report.modelSeed = {mode: 'Node and browser SHA-256 verified real Paddle model bytes; inference remains real', files: []};
    for (const asset of assets) {
        const file = path.resolve(modelsDir, path.basename(asset.path));
        const bytes = fs.readFileSync(file); assert.equal(bytes.length, asset.bytes); assert.equal(sha256(bytes), asset.sha256);
        await popup.evaluate(async ({url, base64, expected}) => {
            const binary = atob(base64), bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
            if (actual !== expected) throw new Error('Temporary model cache seed hash mismatch');
            await (await caches.open('fluent-read-manga-ocr-v1')).put(url, new Response(bytes));
        }, {url: root + asset.path, base64: bytes.toString('base64'), expected: asset.sha256});
        report.modelSeed.files.push({file, bytes: bytes.length, sha256: asset.sha256});
    }
}

async function seedTesseract(popup) {
    if (!languageDir) return;
    const file = path.resolve(languageDir, 'eng.traineddata');
    const bytes = fs.readFileSync(file), expected = sha256(bytes);
    await popup.evaluate(async ({base64, expected}) => {
        const binary = atob(base64), bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (actual !== expected) throw new Error('Temporary Tesseract cache seed hash mismatch');
        const database = await new Promise((resolve, reject) => {const request = indexedDB.open('keyval-store'); request.onupgradeneeded = () => request.result.createObjectStore('keyval'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
        await new Promise((resolve, reject) => {const transaction = database.transaction('keyval', 'readwrite'); transaction.objectStore('keyval').put(bytes, 'fluent-read-image-ocr/eng.traineddata'); transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);});
        database.close();
    }, {base64: bytes.toString('base64'), expected});
    report.languageSeed = {mode: 'Real unpacked English traineddata in isolated Tesseract IndexedDB; inference remains real', file, bytes: bytes.length, sha256: expected};
}

async function instrument(worker) {
    await worker.evaluate(() => {
        if (globalThis.__imageFormatFlow) return;
        const realFetch = globalThis.fetch.bind(globalThis);
        globalThis.__imageFormatFlow = {currentCase: '', records: {}};
        const record = () => globalThis.__imageFormatFlow.records[globalThis.__imageFormatFlow.currentCase];
        chrome.runtime.onMessage.addListener(message => {
            const data = record(); if (!data) return false;
            if (message?.type === 'fluentReadImageTranslate') data.inputMimes.push(/^data:([^;,]+)/i.exec(message.image || '')?.[1] || 'unknown');
            if (message?.type === 'fluentReadImageTranslateTexts') data.ocrBatches.push(message.texts);
            return false;
        });
        globalThis.fetch = async (input, options) => {
            const url = new URL(String(typeof input === 'string' ? input : input.url || input));
            const data = record();
            const isProvider = /google|doubao|microsoft|bing|deepl|youdao|baidu|tencent/.test(url.hostname);
            const request = isProvider && data ? {host: url.hostname, path: url.pathname, startedAt: new Date().toISOString()} : null;
            if (request) data.providerRequests.push(request);
            try {const response = await realFetch(input, options); if (request) request.status = response.status; return response;}
            catch (error) {if (request) request.error = String(error); throw error;}
        };
    });
}

async function runCase(context, worker, fixture, engine, pathMode) {
    const id = `${engine}-${fixture.name}-${pathMode}`;
    const outputDir = path.join(artifacts, id); fs.mkdirSync(outputDir, {recursive: true});
    const result = {id, format: fixture.format, engine, pathMode, service, screenshots: [], errors: []};
    report.cases.push(result); persist();
    const file = path.resolve(path.dirname(manifestPath), fixture.file), bytes = fs.readFileSync(file);
    assert.equal(sha256(bytes), fixture.sha256, `Changed fixture ${fixture.name}`);
    const sourceUrl = `https://${pathMode === 'cross-origin' ? 'image-format-assets' : 'image-format-flow'}.fluentread.org/assets/${fixture.file}`;
    const pageUrl = `https://image-format-flow.fluentread.org/${id}`;
    await context.route(pageUrl, route => route.fulfill({contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><title>${id}</title><style>body{margin:60px;font:16px system-ui;background:#ced5df}img{display:block;margin-top:70px;max-width:100%}</style><h1>Image translation · ${fixture.format} · ${engine}</h1><p>Cross-origin original binary fixture, live translation.</p><img id="format-source" src="${sourceUrl}" alt="Image format OCR regression">`}));
    await context.route(sourceUrl, route => route.fulfill({contentType: fixture.mime, headers: {'access-control-allow-origin': '*'}, body: bytes}));
    await worker.evaluate(id => {globalThis.__imageFormatFlow.currentCase = id; globalThis.__imageFormatFlow.records[id] = {inputMimes: [], ocrBatches: [], providerRequests: []};}, id);
    await assertBackground(result);
    page.removeAllListeners('pageerror');
    page.on('pageerror', error => result.errors.push(error.message));
    let ui;
    try {
        await page.goto(pageUrl, {waitUntil: 'domcontentloaded'});
        await page.waitForSelector('#fluent-read-page-styles', {state: 'attached'});
        const image = page.locator('#format-source');
        await image.evaluate(image => image.decode());
        result.source = await image.evaluate(image => ({src: image.getAttribute('src'), currentSrc: image.currentSrc, dimensions: [image.naturalWidth, image.naturalHeight], complete: image.complete, opacity: getComputedStyle(image).opacity}));
        assert.deepEqual(result.source.dimensions, [fixture.width, fixture.height]);
        result.canvasReadable = await image.evaluate(image => {const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; canvas.getContext('2d').drawImage(image, 0, 0, 2, 2); try {canvas.toDataURL(); return true;} catch (error) {if (error.name === 'SecurityError') return false; throw error;} });
        assert.equal(result.canvasReadable, pathMode === 'canvas', 'Cross-origin taint and same-origin Canvas must exercise distinct read paths');
        const cdp = await context.newCDPSession(page);
        ui = async code => {
            const tree = await cdp.send('DOM.getDocument', {depth: -1, pierce: true}); let host;
            const visit = node => {const attrs = node.attributes || []; for (let index = 0; index < attrs.length; index += 2) if (attrs[index] === 'id' && attrs[index + 1] === 'fluent-read-image-translation-root') host = node; for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) visit(child);};
            visit(tree.root); const root = host?.shadowRoots?.[0]; if (!root) return null;
            const objectId = (await cdp.send('DOM.resolveNode', {nodeId: root.nodeId})).object.objectId;
            try {const response = await cdp.send('Runtime.callFunctionOn', {objectId, functionDeclaration: `function(){${code}}`, returnByValue: true}); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text); return response.result.value;}
            finally {await cdp.send('Runtime.releaseObject', {objectId});}
        };
        const state = () => ui("return {phase:this.querySelector('.fr-image-controls')?.dataset.phase,text:[...this.querySelectorAll('.fr-image-status,.fr-image-error-details p')].map(element=>element.textContent).join(' '),overlayCount:this.querySelectorAll('.fluent-read-image-translation-overlay img').length,preparation:this.querySelector('.fr-image-feedback')?.dataset.preparation}");
        const wait = async (predicate, limit = 30000) => {const deadline = Date.now() + limit; let last, checkedAt = 0; while (Date.now() < deadline) {if (Date.now() - checkedAt >= 1000) {await assertBackground(result); checkedAt = Date.now();} last = await state(); if (await predicate(last)) return last; await page.waitForTimeout(250);} throw new Error(`Image state timeout: ${JSON.stringify(last)}`);};
        const click = async text => {await assertBackground(result); const box = await image.boundingBox(); assert.ok(box); await page.mouse.move(box.x + 5, box.y + 5); const point = await ui(`const button=[...this.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(text)}&&!button.hidden&&button.getBoundingClientRect().width>0);if(!button)return null;const rect=button.getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2};`); assert.ok(point, `Missing button ${text}`); await page.mouse.click(point.x, point.y); await assertBackground(result);};
        const shot = async name => {const file = path.join(outputDir, `${name}.png`); await page.screenshot({path: file}); result.screenshots.push(file);};
        await image.hover(); await wait(state => !!state?.phase); await shot('01-original'); await click('翻译');
        let final = await wait(state => ['error', 'translated'].includes(state?.phase), timeout);
        if (final.phase === 'error' && final.preparation === 'true') {result.preparation = final; persist(); await click('下载语言包并翻译'); final = await wait(state => ['error', 'translated'].includes(state?.phase), timeout);}
        result.firstResult = final; assert.equal(final.phase, 'translated', final.text); assert.equal(final.overlayCount, 1); await shot('02-translated');
        const output = await ui("const image=this.querySelector('.fluent-read-image-translation-overlay img');return {src:image.src,complete:image.complete,dimensions:[image.naturalWidth,image.naturalHeight]}");
        assert.equal(output.complete, true); assert.deepEqual(output.dimensions, result.source.dimensions); assert.match(output.src, /^data:image\/png;base64,/);
        const bitmap = Buffer.from(output.src.split(',')[1], 'base64'); fs.writeFileSync(path.join(outputDir, 'translated-bitmap.png'), bitmap);
        result.output = {dimensions: output.dimensions, mime: 'image/png', bytes: bitmap.length, sha256: sha256(bitmap)};
        result.pixels = await page.evaluate(async ({source, translated}) => {
            const decode = async src => {const image = new Image(); image.src = src; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); return context.getImageData(0, 0, canvas.width, canvas.height).data;};
            const original = await decode(source), output = await decode(translated);
            let changedPixels = 0; for (let index = 0; index < output.length; index += 4) if (output[index] !== original[index] || output[index + 1] !== original[index + 1] || output[index + 2] !== original[index + 2] || output[index + 3] !== original[index + 3]) changedPixels++;
            const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
            return {sourceRgbaSha256: await hash(original), outputRgbaSha256: await hash(output), changedPixels, totalPixels: output.length / 4};
        }, {source: `data:${fixture.mime};base64,${bytes.toString('base64')}`, translated: output.src});
        assert.ok(result.pixels.changedPixels > 10, 'Rendered PNG must change source pixels rather than display the original bitmap');
        const probe = fixture.transparentProbe || fixture.firstFrameProbe;
        if (probe) {
            result.outputProbe = await page.evaluate(async ({src, x, y}) => {const image = new Image(); image.src = src; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); return Array.from(context.getImageData(x, y, 1, 1).data);}, {src: output.src, ...probe});
            if (fixture.transparentProbe) assert.equal(result.outputProbe[3], 0, 'Untouched transparent background must remain transparent');
            if (fixture.firstFrameProbe?.rgba) assert.deepEqual(result.outputProbe, fixture.firstFrameProbe.rgba, 'Animated source must render OCR frame consistently');
        }
        assert.equal(await image.evaluate(image => getComputedStyle(image).opacity), '0', 'Translated bitmap must hide original text beneath transparent regions');
        await click('文字'); await click('原文对照');
        result.reader = await ui("return {source:[...this.querySelectorAll('.fr-image-reader-source')].map(element=>element.textContent),translations:[...this.querySelectorAll('.fr-image-reader-body article')].map(article=>[...article.querySelectorAll('pre')].at(-1)?.textContent),text:this.querySelector('.fr-image-reader')?.textContent}");
        const actualSource = normalized(result.reader.source.join(' '));
        for (const expected of fixture.expectedSource) assert.ok(actualSource.includes(normalized(expected)), `OCR expected ${expected}; got ${result.reader.source.join(' | ')}`);
        assert.equal(result.reader.translations.length, result.reader.source.length, 'Each recognized source paragraph must have a corresponding translated paragraph');
        assert.ok(result.reader.translations.length > 0 && result.reader.translations.every(text => /[\u3400-\u9fff]/u.test(text)), 'Each recognized fixture sentence must have a CJK translation');
        assert.ok(result.reader.translations.every((text, index) => normalized(text) !== normalized(result.reader.source[index] || '')), 'Each fixture sentence must change from its English source');
        await shot('03-text-comparison'); await click('文字');
        result.transport = await worker.evaluate(id => globalThis.__imageFormatFlow.records[id], id);
        assert.ok(result.transport.inputMimes.includes(pathMode === 'canvas' ? 'image/png' : fixture.mime), 'OCR backend must receive expected read-path MIME');
        assert.ok(result.transport.ocrBatches.length > 0, 'Real OCR must provide nonempty texts');
        if (!result.transport.providerRequests.some(request => request.status >= 200 && request.status < 300)) {
            const cached = result.transport.ocrBatches.flat().map(text => report.cases.find(previous => previous !== result && previous.ok && previous.transport?.ocrBatches?.flat().includes(text)));
            assert.ok(cached.length > 0 && cached.every(Boolean), 'Each newly recognized text requires a successful live provider request or an exact text cache match');
            result.brokerCachedTranslationsFrom = [...new Set(cached.map(previous => previous.id))];
        }
        const before = JSON.stringify(result.transport);
        await click('原图'); await wait(state => state?.phase === 'idle');
        assert.equal(await ui("return this.querySelectorAll('.fluent-read-image-translation-overlay img').length"), 0);
        assert.deepEqual(await image.evaluate(image => ({src: image.getAttribute('src'), currentSrc: image.currentSrc, dimensions: [image.naturalWidth, image.naturalHeight], complete: image.complete, opacity: getComputedStyle(image).opacity})), result.source);
        await shot('04-restored'); await click('翻译'); await wait(state => state?.phase === 'translated');
        assert.equal(await ui("return this.querySelectorAll('.fluent-read-image-translation-overlay img').length"), 1);
        assert.equal(JSON.stringify(await worker.evaluate(id => globalThis.__imageFormatFlow.records[id], id)), before, 'Cached redisplay must avoid both OCR and translation dispatch');
        assert.equal(page.url(), pageUrl); assert.equal(await image.getAttribute('src'), result.source.src); assert.equal(await image.evaluate(image => image.currentSrc), result.source.currentSrc);
        assert.deepEqual(result.errors, []); await shot('05-redisplayed'); await assertBackground(result); result.switchCounts = [1, 0, 1]; result.ok = true;
    } catch (error) {
        result.ok = false; result.failure = error.stack || String(error);
        if (ui) result.failureUi = await ui("return [...this.querySelectorAll('.fr-image-status,.fr-image-error-details p')].map(element=>element.textContent).join(' ')").catch(() => null);
        result.transport = await worker.evaluate(id => globalThis.__imageFormatFlow?.records[id], id).catch(() => null);
        await page.screenshot({path: path.join(outputDir, 'failure.png')}).catch(() => {});
        console.error(`${id}: ${error.message}`);
        if (error.fatalFocus) throw error;
    } finally {persist();}
}

(async () => {try {
    session = await launchFocusSafePersistentContext({chromium, profileDir: profile, browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: false, background: true, viewport: {width: 1280, height: 900}, browserArgs: ['--no-first-run', '--no-default-browser-check', `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(session.launchMode, 'macos-background-cdp'); assert.equal(session.focusPolicy, 'launchservices-no-foreground'); assert.equal(session.windowPlacement.browserFrontmost, false);
    const {context} = session;
    report.browserVersion = context.browser()?.version() || 'unavailable';
    const browserCdp = await context.browser().newBrowserCDPSession();
    browserPid = (await browserCdp.send('SystemInfo.getProcessInfo')).processInfo.find(process => process.type === 'browser')?.id;
    await browserCdp.detach(); assert.ok(browserPid); report.browserPid = browserPid;
    const worker = context.serviceWorkers().find(worker => worker.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', {timeout: 30000});
    const popup = await newPageWithoutForeground(context); await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    report.userAgent = await popup.evaluate(() => navigator.userAgent);
    report.defaultOcrEngine = await popup.evaluate(async () => (await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'})).value.imageTranslationOcrEngine);
    assert.equal(report.defaultOcrEngine, 'paddle');
    await instrument(worker); await seedPaddle(popup); await seedTesseract(popup);
    page = await newPageWithoutForeground(context);
    for (const engine of engines) {report.config = await patchConfig(popup, engine); for (const fixture of fixtures) {for (const pathMode of pathModes) {if (fixture.frames > 1 && pathMode === 'canvas') continue; console.log(`Starting ${engine}-${fixture.name}-${pathMode}`); await runCase(context, worker, fixture, engine, pathMode);}}}
    report.ok = report.cases.every(result => result.ok); if (!report.ok) process.exitCode = 1;
} catch (error) {report.ok = false; report.failure = error.stack || String(error); process.exitCode = 1; console.error(error);}
finally {let closed = !session; if (session) {try {await session.close(); closed = true;} catch (error) {report.cleanupError = String(error); report.ok = false; process.exitCode = 1;}} if (closed) fs.rmSync(profile, {recursive: true, force: true}); else report.retainedProfile = profile; persist(); console.log(JSON.stringify({ok: report.ok, cases: report.cases.map(result => ({id: result.id, ok: result.ok, failure: result.failure})), report: path.join(artifacts, 'report.json')}, null, 2));}
})();

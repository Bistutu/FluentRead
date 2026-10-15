#!/usr/bin/env node
// Focus-safe production behavior and standalone report review. Uses only a synthetic local page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const arg = name => {const index = process.argv.indexOf(`--${name}`); if (index < 0) throw new Error(`Missing --${name}`); return process.argv[index + 1];};
const extension = path.resolve(arg('extension-dir'));
const reportFile = path.resolve(arg('report'));
const output = path.resolve(arg('out'));
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(arg('focus-safe-helper'));
const emojiSource = 'The scientist 👩🏽‍🔬 arrives by 🚚 at Gate1️⃣.';
const source = 'Calibration is complete. '.repeat(39) + 'The electroencephalography measurement must not exceed 3.5 kg. Dr. Smith verified the reading.';
fs.mkdirSync(output, {recursive: true});
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const server = http.createServer((request, response) => {
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(request.url === '/report' ? fs.readFileSync(reportFile) : `<!doctype html><html lang="en"><head><title>Quality boundary fixture</title><style>body{font:18px/1.7 system-ui;margin:40px auto;max-width:900px;padding:20px}p{margin:20px 0}#primary{font-size:16px}</style></head><body><h1>Translation boundary review</h1><p id="primary">${escape(source)}</p><p id="neighbor">The neighboring paragraph must remain unchanged.</p><p id="emoji">${escape(emojiSource)}</p><p id="failure">The failed request must remain retryable after its source is preserved.</p><p id="pending">This pending request must stop when the reader cancels translation.</p></body></html>`);
});
const evidence = {ok: false, extension, reportFile, synthetic: true, screenshots: [], cases: {}, pageErrors: []};
let session;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-quality-ui-'));
let launchAttempted = false;
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        launchAttempted = true;
        session = await launchFocusSafePersistentContext({chromium, profileDir, background: true, headless: false,
            browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', viewport: {width: 1280, height: 900}, timeout: 30000,
            browserArgs: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check']});
        Object.assign(evidence, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
        assert.equal(session.launchMode, 'macos-background-cdp');
        assert.equal(session.windowPlacement.browserFrontmost, false);
        const context = session.context;
        evidence.browser = context.browser().version();
        const newPage = async url => {const page = await newPageWithoutForeground(context, 30000); page.on('pageerror', error => evidence.pageErrors.push(error.message)); await page.goto(url); return page;};
        const shot = async (page, name) => {const file = path.join(output, `${name}.png`); await page.screenshot({path: file, animations: 'disabled'}); evidence.screenshots.push(file);};
        const review = await newPage(`${base}/report`);
        await review.locator('h1').filter({hasText: '翻译质量审阅'}).waitFor();
        await shot(review, 'report-desktop');
        await review.locator('#filter-disclosure summary').click();
        await review.locator('#status').selectOption('flagged');
        evidence.cases.flagged = await review.locator('[data-run-index]:visible').count();
        assert(evidence.cases.flagged > 0);
        assert(await review.locator('[data-run-index]:visible .source').first().isVisible(), 'Original text must be visible before expanding provenance');
        await review.locator('.source-details:visible summary').first().click();
        await shot(review, 'report-issue-source');
        await review.locator('#search').fill('no-matching-synthetic-value');
        assert(await review.locator('#empty-state').isVisible());
        await shot(review, 'report-empty');
        await review.locator('#empty-state [data-reset]').click();
        await review.locator('#provider').selectOption('microsoft');
        await review.reload();
        await review.locator('#filter-disclosure summary').click();
        assert.equal(await review.locator('#provider').inputValue(), 'microsoft');
        evidence.cases.refresh = true;
        await review.locator('h1').click();
        await review.keyboard.press('/');
        assert(await review.locator('#search').evaluate(element => element === document.activeElement));
        await review.keyboard.press('Escape');
        evidence.cases.keyboard = true;
        const downloadPromise = review.waitForEvent('download');
        await review.locator('#download-review').click();
        const download = await downloadPromise;
        await download.saveAs(path.join(output, 'pending-review.json'));
        const pending = JSON.parse(fs.readFileSync(path.join(output, 'pending-review.json'), 'utf8'));
        assert.equal(pending.status, 'pending');
        assert(pending.entries.length > 0 && pending.entries.every(entry => entry.providerId === 'microsoft'));
        assert(pending.entries.every(entry => entry.review.requirements.every(requirement => requirement.verdict === null)));
        evidence.cases.export = pending.entries.length;
        await review.locator('#filter-disclosure summary').click();
        await review.setViewportSize({width: 390, height: 844});
        await review.evaluate(() => scrollTo(0, 0));
        assert.equal(await review.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await shot(review, 'report-narrow');
        await review.emulateMedia({colorScheme: 'dark'});
        await shot(review, 'report-narrow-dark');
        evidence.cases.narrowOverflow = false;
        await review.close();
        evidence.cases.reportUnload = true;

        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const origin = /^chrome-extension:\/\/[^/]+/u.exec(worker.url())[0];
        const popup = await newPage(`${origin}/popup.html`);
        const config = await popup.evaluate(async () => {const result = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'}); return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;});
        const patch = {uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, on: true, from: 'en', to: 'zh-Hans',
            service: 'freeTranslation', freeTranslationOrder: ['youdaoFree', 'transmart'], freeTranslationMode: 'sequential', freeTranslationTimeoutMs: 5000,
            useCache: false, glossaryEnabled: false, autoTranslate: false, hotkey: 'Control', mouseHoverTranslationDelay: 0,
            display: 1, selectionTranslatorMode: 'disabled', disableSelectionTranslator: true, floatingBall: false};
        const saved = await popup.evaluate(({patch, config}) => chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: patch,
            expected: Object.fromEntries(Object.keys(patch).map(key => [key, config[key]])), clientId: crypto.randomUUID(), sequence: 1}), {patch, config});
        assert.equal(saved.success, true);
        await worker.evaluate(() => {
            const original = globalThis.fetch.bind(globalThis);
            globalThis.__quality = {calls: [], routes: [], scenario: 'success', cancelled: 0};
            globalThis.fetch = async (input, init) => {
                if (String(input).startsWith('https://dict.youdao.com/jsonapi_s')) {
                    globalThis.__quality.routes.push('youdaoFree');
                    return Response.json({fanyi: {type: 'zh-CHS2en', tran: 'This deliberately reversed English result must never be displayed.'}});
                }
                if (!String(input).startsWith('https://transmart.qq.com/api/imt')) return original(input, init);
                globalThis.__quality.routes.push('transmart');
                const text = JSON.parse(init.body).source.text_list[0];
                globalThis.__quality.calls.push(text);
                if (globalThis.__quality.scenario === 'failure') return new Response('{}', {status: 400});
                if (globalThis.__quality.scenario === 'pending') return new Promise((_, reject) => {
                    const abort = () => {globalThis.__quality.cancelled++; reject(new DOMException('Cancelled fixture', 'AbortError'));};
                    if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, {once: true});
                });
                const emojiTokens = text.match(/__FRTERM_[a-z0-9_]+?__/giu);
                const translated = emojiTokens?.length ? '字素保护的生产验证。' + emojiTokens.join(' ') : text.includes('electroencephalography') ? '脑电图测量结果不得超过 3.5 kg，Smith 博士核对了读数。'
                    : text.startsWith('Calibration') ? '校准步骤已完成（受控测试响应）。' : '请求失败后仍可重试，原文保持完整。';
                return Response.json({header: {ret_code: 'succ'}, auto_translation: [translated]});
            };
        });
        const article = await newPage(`${base}/article`);
        await article.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
        const trigger = async selector => {await activateExtensionTabWithoutForeground(context, article, 30000); await article.locator(selector).click(); await article.locator(selector).hover(); await article.keyboard.down('Control'); await article.keyboard.up('Control');};
        evidence.cases.toggle = [];
        for (const count of [1, 0, 1]) {
            await trigger('#primary');
            await article.waitForFunction(count => document.querySelectorAll('#primary .fluent-read-bilingual-content').length === count, count);
            evidence.cases.toggle.push(await article.locator('#primary .fluent-read-bilingual-content').count());
            assert.equal(await article.locator('#neighbor .fluent-read-bilingual-content').count(), 0);
        }
        evidence.cases.requests = await worker.evaluate(() => globalThis.__quality.calls);
        // Restoring the same source may replay the existing translation without new HTTP.
        assert(evidence.cases.requests.length >= 2);
        assert(evidence.cases.requests.every(text => !/electroencephalograph$/u.test(text) && !/^y\b/u.test(text)));
        assert(evidence.cases.requests.some(text => text.includes('electroencephalography')));
        evidence.cases.routes = await worker.evaluate(() => globalThis.__quality.routes);
        assert.equal(evidence.cases.routes[0], 'youdaoFree');
        assert(evidence.cases.routes.includes('transmart'));
        assert(!(await article.locator('#primary .fluent-read-bilingual-content').innerText()).includes('deliberately reversed'));
        evidence.cases.directionFallback = true;
        await shot(article, 'production-boundaries');
        await trigger('#emoji');
        await article.locator('#emoji .fluent-read-bilingual-content').waitFor();
        const emojiTranslation = await article.locator('#emoji .fluent-read-bilingual-content').innerText();
        for (const literal of ['👩🏽‍🔬', '🚚', '1️⃣']) assert.equal(emojiTranslation.split(literal).length - 1, 1, 'Complete literal must occur exactly once: ' + literal);
        assert(!emojiTranslation.includes('__FRTERM_'));
        evidence.cases.emojiLiteralRoundTrip = {source: emojiSource, translation: emojiTranslation,
            providerResponse: 'Controlled response retains protection markers but contains no emoji; production broker must restore each complete literal.'};
        await trigger('#emoji');
        await article.waitForFunction(() => !document.querySelector('#emoji .fluent-read-bilingual-content'));
        assert.equal((await article.locator('#emoji').innerText()).trim(), emojiSource);
        await shot(article, 'production-emoji-restored-source');
        await worker.evaluate(() => {globalThis.__quality.scenario = 'failure';});
        await trigger('#failure');
        await article.locator('#failure .fluent-read-retry-wrapper').waitFor();
        await shot(article, 'production-failure');
        await worker.evaluate(() => {globalThis.__quality.scenario = 'success';});
        const retry = article.locator('#failure .fluent-read-retry');
        await retry.click();
        await article.locator('#failure .fluent-read-bilingual-content').waitFor();
        evidence.cases.retry = true;
        await shot(article, 'production-retry');
        await worker.evaluate(() => {globalThis.__quality.scenario = 'pending';});
        await trigger('#pending');
        await article.locator('#pending .fluent-read-loading').waitFor({state: 'attached'});
        evidence.cases.loading = true;
        await shot(article, 'production-loading');
        await trigger('#pending');
        await article.waitForFunction(() => !document.querySelector('#pending .fluent-read-loading'));
        assert.equal(await article.locator('#pending .fluent-read-bilingual-content').count(), 0);
        for (let attempt = 0; attempt < 20 && !(await worker.evaluate(() => globalThis.__quality.cancelled)); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
        evidence.cases.cancelledRequests = await worker.evaluate(() => globalThis.__quality.cancelled);
        assert(evidence.cases.cancelledRequests > 0);
        await worker.evaluate(() => {globalThis.__quality.scenario = 'success';});
        await article.reload();
        await article.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
        assert.equal(await article.locator('.fluent-read-bilingual-content').count(), 0);
        evidence.cases.pageRefresh = true;
        await article.close();
        evidence.cases.pageUnload = true;
        assert.deepEqual(evidence.pageErrors, []);
        evidence.ok = true;
    } catch (error) {evidence.error = error.stack || String(error); process.exitCode = 1;}
    finally {
        try {await session?.close(); evidence.cleanupConfirmed = Boolean(session); if (session) fs.rmSync(profileDir, {recursive: true, force: true}); else if (!launchAttempted) fs.rmdirSync(profileDir);}
        catch (error) {evidence.cleanupError = String(error); process.exitCode = 1;}
        await new Promise(resolve => server.close(resolve));
        fs.writeFileSync(path.join(output, 'review.json'), JSON.stringify(evidence, null, 2));
        console.log(JSON.stringify(evidence, null, 2));
    }
})();

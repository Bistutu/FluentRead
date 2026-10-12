'use strict';
/**
 * @file scripts/testing/run-svg-image-translation-test.cjs
 * 文件职责：在不抢焦点的临时 Edge 配置中验证原始 SVG 的图片识别、译图和原图切换。
 * 主要内容：真实默认 Paddle OCR、确定性 Google transport、可信点击和关闭 Shadow DOM 的 DOM 断言；可用相同 SVG 的跨域页面夹具规避站点临时不可用，并明确记录证据边界。
 * 模块边界：仅操作指定生产扩展与自动创建的临时 profile，不修改用户配置、不模拟 OCR、不会验证在线翻译服务质量。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const arg = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1]; };
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-svg-image-flow'));
const svgFixture = arg('fixture-svg', null);
const pageUrl = svgFixture ? 'https://svg-flow.fluentread.org/' : arg('page-url', 'https://github.com/morluto/rea/blob/main/README_zh.md');
const selector = arg('image-selector', 'img[src*="rea-investigation-flow"]');
const expectFailure = process.argv.includes('--expect-decode-failure');
const engine = arg('engine', 'paddle');
const modelsDir = arg('models-dir', null);
const { chromium } = require(path.join(arg('playwright-root'), 'playwright'));
const { launchFocusSafePersistentContext, newPageWithoutForeground } = require(arg('focus-safe-helper'));
fs.mkdirSync(artifacts, {recursive: true});
const profile = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fluentread-svg-image-flow-profile-'));
const report = {extensionDir, engine, pageUrl, scope: 'Real packaged OCR and original SVG with deterministic translation transport; no live translation provider validation.', profileMode: 'automatically-created-temporary-profile', cases: [], screenshots: [], errors: []};
const javascriptFiles = [];
const collectJavaScript = directory => {for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {const file=path.join(directory,entry.name);if(entry.isDirectory())collectJavaScript(file);else if(file.endsWith('.js'))javascriptFiles.push(file);}};
collectJavaScript(extensionDir);
const javascriptHash = crypto.createHash('sha256');
for(const file of javascriptFiles.sort())javascriptHash.update(path.relative(extensionDir,file)).update('\0').update(fs.readFileSync(file));
report.javascriptAssetsSha256 = javascriptHash.digest('hex');
const persist = () => fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
let session, page, readUi;
(async () => { try {
    session = await launchFocusSafePersistentContext({chromium, profileDir: profile,
        browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: false, background: true,
        viewport: {width: 1280, height: 900}, browserArgs: ['--no-first-run', '--no-default-browser-check', `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]});
    Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
    assert.equal(session.launchMode, 'macos-background-cdp'); assert.equal(session.windowPlacement.browserFrontmost, false);
    const {context} = session;
    const worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', {timeout: 30000});
    const popup = await newPageWithoutForeground(context);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    report.config = await popup.evaluate(async engine => {
        const current = (await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'})).value;
        const defaults = {ocrEngine: current.imageTranslationOcrEngine};
        const patch = {on: true, disableImageTranslator: false, from: 'en', to: 'zh-Hans', service: 'google', imageTranslationService: 'google', imageTranslationOcrEngine: engine, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true};
        const response = await chrome.runtime.sendMessage({type: 'persistConfig', mode: 'patch', config: patch,
            expected: Object.fromEntries(Object.keys(patch).map(key => [key, current[key]])), clientId: 'svg-image-flow', sequence: 1, baseRevision: current.__fluentConfigRevision || 0});
        if (!response.success) throw new Error(response.error);
        return {defaults, patch};
    }, engine);
    assert.equal(report.config.defaults.ocrEngine, 'paddle', 'Fresh configuration must exercise default Paddle engine');
    if (modelsDir) {
        const metadataSource = fs.readFileSync(path.resolve(__dirname, '../../src/features/image-translation/services/mangaOcrAssets.ts'), 'utf8');
        const root = /const ROOT = '([^']+)'/.exec(metadataSource)?.[1];
        const assets = [...metadataSource.matchAll(/path: '([^']+)', bytes: (\d+),\s*sha256: '([a-f0-9]{64})'/g)].map(match => ({path:match[1],bytes:Number(match[2]),sha256:match[3]}));
        assert.ok(root); assert.equal(assets.length, 3);
        report.modelSeed = {mode:'SHA-256-verified real model files in isolated extension CacheStorage; OCR inference remains real', files:[]};
        for (const asset of assets) {
            const file = path.resolve(modelsDir, path.basename(asset.path)); const bytes = fs.readFileSync(file);
            const sha256 = crypto.createHash('sha256').update(bytes).digest('hex'); assert.equal(bytes.length, asset.bytes); assert.equal(sha256, asset.sha256);
            await popup.evaluate(async ({url,base64,expected}) => {
                const binary=atob(base64),bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
                const digest=await crypto.subtle.digest('SHA-256',bytes);const actual=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
                if(actual!==expected)throw new Error('Temporary OCR cache seed hash mismatch');
                await (await caches.open('fluent-read-manga-ocr-v1')).put(url,new Response(bytes));
            }, {url:root+asset.path,base64:bytes.toString('base64'),expected:sha256});
            report.modelSeed.files.push({file,bytes:bytes.length,sha256});
        }
    }
    await worker.evaluate(() => {
        const realFetch = globalThis.fetch.bind(globalThis);
        globalThis.__svgFlow = {texts: [], hosts: [], outputs: [], inputMimes: []};
        chrome.runtime.onMessage.addListener(message => {if(message?.type==='fluentReadImageTranslate')globalThis.__svgFlow.inputMimes.push(/^data:([^;,]+)/i.exec(message.image||'')?.[1]||'unknown'); return false;});
        const translate = source => {
            const normalized = source.toLowerCase();
            if (normalized.includes('investigation flow')) return 'REA 调查流程';
            if (normalized.includes('inspect')) return '检查与追踪';
            if (normalized.includes('ask')) return '提出问题';
            if (normalized.includes('read the evidence')) return '阅读证据';
            if (normalized.includes('use what')) return '应用所学';
            if (normalized.includes('analysis tools')) return '分析工具';
            if (normalized.includes('follow')) return '追问';
            if (normalized.includes('local analysis')) return '本地分析适配器';
            if (normalized.includes('explain')) return '解释、实现、测试';
            if (normalized === 'rea' || normalized === 'cli/mcp') return source;
            if (normalized === 'your agent') return '你的智能体';
            if (normalized.includes('your agent + local target')) return '你的智能体与本地目标';
            if (normalized.includes('code / references')) return '代码、引用与未知项';
            if (normalized.includes('app / binary / browser')) return '应用、二进制与浏览器';
            return '测试译文';
        };
        globalThis.fetch = async (input, options = {}) => {
            const url = String(typeof input === 'string' ? input : input.url || input);
            const host = new URL(url).hostname;
            const html = host === 'translate-pa.googleapis.com';
            const list = host === 'translate.googleapis.com';
            const rpc = url.includes('/_/TranslateWebserverUi/data/batchexecute');
            if (html || list || rpc) {
                const records = rpc ? JSON.parse(new URLSearchParams(options.body).get('f.req'))[0] : null;
                const decodeText = text => text.replace(/&(amp|lt|gt|quot|#39);/g, (_entity, code) => ({amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'"})[code]);
                const sources = html ? JSON.parse(options.body)[0][0].map(text => decodeText(text.replace(/^<pre>([\s\S]*)<\/pre>$/, '$1')))
                    : list ? new URLSearchParams(options.body).getAll('q') : records.map(record => JSON.parse(record[1])[0][0]);
                if (!sources.length || sources.some(source => typeof source !== 'string')) throw new Error('Unexpected translation batch payload');
                const outputs = sources.map(translate);
                globalThis.__svgFlow.texts.push(...sources); globalThis.__svgFlow.hosts.push(host); globalThis.__svgFlow.outputs.push(...outputs);
                if (html) return new Response(JSON.stringify([outputs]), {status: 200});
                if (list) return new Response(JSON.stringify(outputs), {status: 200});
                const responses = outputs.map((text, index) => ['wrb.fr', 'MkEWBc', JSON.stringify([null, [[[null, null, null, null, null, [[text]]]]]]), null, null, null, records[index][3]]);
                return new Response(JSON.stringify(responses), {status: 200});
            }
            if (/^translate(?:-pa)?\.google(?:apis)?\./.test(host)) throw new Error('Unexpected live translation endpoint');
            return realFetch(input, options);
        };
    });
    if (svgFixture) {
        const svg = fs.readFileSync(path.resolve(svgFixture));
        const sourceUrl = 'https://raw.githubusercontent.com/morluto/rea/main/website/public/assets/figures/rea-investigation-flow.svg';
        await context.route(pageUrl, route => route.fulfill({contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><title>Original REA SVG regression fixture</title><style>body{margin:40px;font:16px system-ui;background:#eef1f6}img{display:block;width:1050px;max-width:100%}</style><h1>Original REA SVG · targeted regression</h1><img src="${sourceUrl}" alt="REA investigation flow">`}));
        await context.route(sourceUrl, route => route.fulfill({contentType: 'image/svg+xml', headers:{'access-control-allow-origin':'*'}, body: svg}));
        report.fixture = {file: path.resolve(svgFixture), bytes: svg.length, sourceUrl, scope: 'Original downloaded SVG bytes on a synthetic cross-origin page; no live GitHub page claim.'};
    }
    page = await newPageWithoutForeground(context);
    page.on('pageerror', error => report.errors.push(error.message));
    const image = page.locator(selector).first();
    for (let attempt = 1; attempt <= 3; attempt++) {
        const response = await page.goto(pageUrl, {waitUntil: 'domcontentloaded', timeout: 60000});
        try {await image.waitFor({timeout: 15000}); break;} catch(error) {
            (report.siteRetries ||= []).push({attempt,status:response?.status(),url:page.url()});
            if(attempt===3)throw error;
        }
    }
    await image.scrollIntoViewIfNeeded();
    report.source = await image.evaluate(image => ({url: image.currentSrc || image.src, src: image.getAttribute('src'), dimensions: [image.naturalWidth, image.naturalHeight], complete: image.complete}));
    report.canvasReadable = await image.evaluate(image=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=2;canvas.getContext('2d').drawImage(image,0,0,2,2);try{canvas.toDataURL();return true;}catch(error){if(error.name==='SecurityError')return false;throw error;}});
    const originalUrl = page.url();
    assert.deepEqual(report.source.dimensions, [1774, 887]);
    const cdp = await context.newCDPSession(page);
    async function rootObject() {
        const tree = await cdp.send('DOM.getDocument', {depth: -1, pierce: true}); let host;
        const visit = node => { const attrs = node.attributes || []; for (let index = 0; index < attrs.length; index += 2) if (attrs[index] === 'id' && attrs[index + 1] === 'fluent-read-image-translation-root') host = node; for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) visit(child); };
        visit(tree.root); const root = host?.shadowRoots?.[0]; return root ? (await cdp.send('DOM.resolveNode', {nodeId: root.nodeId})).object.objectId : null;
    }
    async function ui(code) {
        const objectId = await rootObject(); if (!objectId) return null;
        try { const response = await cdp.send('Runtime.callFunctionOn', {objectId, functionDeclaration: `function(){${code}}`, returnByValue: true}); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text); return response.result.value; }
        finally {await cdp.send('Runtime.releaseObject', {objectId});}
    }
    readUi = ui;
    const state = () => ui("return {phase:this.querySelector('.fr-image-controls')?.dataset.phase, text:[...this.querySelectorAll('.fr-image-status,.fr-image-error-details p')].map(element=>element.textContent).join(' '), overlayCount:this.querySelectorAll('.fluent-read-image-translation-overlay img').length, preparation:this.querySelector('.fr-image-feedback')?.dataset.preparation}");
    async function wait(predicate, timeout = 30000) { const deadline = Date.now() + timeout; let last;
        while (Date.now() < deadline) {last = await state(); if (await predicate(last)) return last; await page.waitForTimeout(250);} throw new Error(`SVG state timeout: ${JSON.stringify(last)}`); }
    async function click(text) { const point = await ui(`const button=[...this.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(text)}&&!button.hidden);if(!button)return null;const r=button.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};`); assert.ok(point, `Missing button ${text}`); await page.mouse.click(point.x, point.y); }
    async function shot(name) { const file = path.join(artifacts, `${name}.png`); await page.screenshot({path: file}); report.screenshots.push(file); }
    await image.hover(); await wait(state => !!state?.phase); await shot('01-original');
    await click('翻译');
    let final = await wait(state => ['error', 'translated'].includes(state?.phase), 300000);
    if (final.phase === 'error' && final.preparation === 'true') { report.preparation = final; persist(); await click('下载语言包并翻译'); final = await wait(state => ['error', 'translated'].includes(state?.phase), 300000); }
    report.firstResult = final; persist();
    if (expectFailure) { assert.equal(final.phase, 'error'); assert.match(final.text, /source image could not be decoded|图片数据无法解码/i); await shot('02-decode-failure'); report.cases.push('Original SVG fails in baseline Paddle worker with native decode error'); }
    else {
        assert.equal(final.phase, 'translated', final.text); assert.equal(final.overlayCount, 1); await shot('02-translated');
        const output = await ui("const image=this.querySelector('.fluent-read-image-translation-overlay img');return {src:image.src,complete:image.complete,dimensions:[image.naturalWidth,image.naturalHeight]}");
        assert.equal(output.complete, true); assert.deepEqual(output.dimensions, [1774, 887]); assert.match(output.src, /^data:image\/png;base64,/);
        fs.writeFileSync(path.join(artifacts, 'translated-bitmap.png'), Buffer.from(output.src.split(',')[1], 'base64')); report.output = {...output, src: undefined};
        await click('文字'); await click('原文对照');
        report.reader = await ui("return {source:[...this.querySelectorAll('.fr-image-reader-source')].map(p=>p.textContent),text:this.querySelector('.fr-image-reader')?.textContent}");
        assert.match(report.reader.text, /REA 调查流程/); await shot('03-text-comparison'); await click('文字');
        report.translationTransport = await worker.evaluate(() => globalThis.__svgFlow); assert.ok(report.translationTransport.texts.length > 5); assert.ok(report.translationTransport.inputMimes.includes('image/svg+xml'), 'OCR must receive original SVG through cross-origin image fallback');
        const before = report.translationTransport.texts.length; await click('原图'); await wait(state => state?.phase === 'idle');
        assert.equal(await image.getAttribute('src'), report.source.src); assert.equal(await ui("return this.querySelectorAll('.fluent-read-image-translation-overlay img').length"), 0); await shot('04-restored');
        await click('翻译'); await wait(state => state?.phase === 'translated'); assert.equal(await ui("return this.querySelectorAll('.fluent-read-image-translation-overlay img').length"), 1);
        assert.equal(await worker.evaluate(() => globalThis.__svgFlow.texts.length), before); assert.equal(page.url(), originalUrl); await shot('05-redisplayed');
        report.switchCounts = [1, 0, 1]; report.cases.push('Original SVG reaches real OCR and PNG rendering', 'Original/translated cached switch preserves source and leaves one overlay');
    }
    report.ok = true;
} catch (error) {report.ok = false; report.failure = error.stack || String(error); if (readUi) report.failureUi = await readUi("return [...this.querySelectorAll('.fr-image-status,.fr-image-error-details p')].map(element=>element.textContent).join(' ')").catch(() => null); if (page) await page.screenshot({path:path.join(artifacts, 'failure.png')}).catch(() => {}); process.exitCode = 1; console.error(error);}
finally {let closed = !session; if (session) {try {await session.close(); closed = true;} catch (error) {report.cleanupError = String(error); report.ok = false; process.exitCode = 1;}} if (closed) fs.rmSync(profile, {recursive:true, force:true}); else report.retainedProfile = profile; persist(); console.log(JSON.stringify(report, null, 2));}
})();

#!/usr/bin/env node
/**
 * @file scripts/run-bilibili-reading-test.cjs
 * 文件职责：在临时 Edge profile 中验证 B站匿名 AI 讲解的真实生产链路。
 * 主要内容：通过焦点安全 CDP 操作闭合 Shadow 卡片；默认 basic-only 验证免费读懂/用法、显式启用、配置保留、缓存复用及通用 AI 界面恢复，最多七次真实请求；--ui-only 使用空 Key 普通服务预检，只补配置切换和未激活 UI，任何供应商请求即停止；仅显式 --full-diagnostic 或 --quality-only 针对旧产物运行历史诊断；保存真实响应、渲染文本、耗时及截图。
 * 模块边界：本地 HTTP 仅提供公开样句，不拦截或模拟供应商响应；不读取用户配置或密钥，不构建、不上传，不测试音频。
 */
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const {execFileSync} = require('node:child_process');

function arg(name, fallback) {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];}
function assert(ok, message) {if (!ok) throw new Error(message);}
function digestTree(directory) {
    const files = [];
    const collect = folder => {for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {const file = path.join(folder, entry.name); if (entry.isDirectory()) collect(file); else if (entry.isFile()) files.push({path: path.relative(directory, file), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}};
    collect(directory); files.sort((a, b) => a.path.localeCompare(b.path));
    return {digest: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'), files};
}
const args = {
    extensionDir: path.resolve(arg('extension-dir', '.output/chrome-mv3')),
    playwrightRoot: arg('playwright-root', process.env.PLAYWRIGHT_ROOT),
    artifactsDir: path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-bilibili-reading-test')),
    browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    focusSafeHelper: path.resolve(arg('focus-safe-helper', 'scripts/testing/focus-safe-browser.cjs')),
    qualityOnly: process.argv.includes('--quality-only'),
    uiOnly: process.argv.includes('--ui-only'),
    fullDiagnostic: process.argv.includes('--full-diagnostic'),
    basicOnly: process.argv.includes('--basic-only') || (!process.argv.includes('--quality-only') && !process.argv.includes('--full-diagnostic') && !process.argv.includes('--ui-only')),
};
if (process.argv.includes('--help')) {
    process.stdout.write('Usage: node scripts/run-bilibili-reading-test.cjs [--basic-only] --playwright-root PATH [--extension-dir PATH] [--artifacts-dir PATH]\nDefault: basic-only, seven real anonymous requests maximum.\n--ui-only: missing-key preflight and configuration DOM only; no supplier model request or mock response.\nHistorical builds only: --full-diagnostic (ten requests), --quality-only (five requests); unsupported on current basic-scope builds.\n');
    process.exit(0);
}
assert([args.basicOnly, args.qualityOnly, args.fullDiagnostic, args.uiOnly].filter(Boolean).length === 1, '只能选择 basic-only、ui-only、full-diagnostic 或 quality-only 其中一种范围');
const sentences = {
    fr: 'Ceci est une phrase française complète.',
    en: 'Despite the delay, we managed to break the ice and get the ball rolling.',
    ja: '雨が降っていたので、家で本を読みました。',
};
const BILIBILI_URL = 'https://index-translate.bilibili.com/v1/chat/completions';
const BILIBILI_MODEL = 'Index-Translate-35B-A3B';
const REQUEST_BUDGET = args.uiOnly ? 0 : args.basicOnly ? 7 : args.qualityOnly ? 5 : 10;
const result = {ok: false, startedAt: new Date().toISOString(), browser: 'Microsoft Edge', actualModelResponses: !args.uiOnly,
    modelFixture: false, pageFixture: 'Local public French, English and Japanese sentences', cases: [], screenshots: [],
    requests: [], otherAiRequests: [], consoleErrors: [], requestFailures: [], networkStatuses: [], renderedAnswers: [], capabilityLimitations: [], listeningVerified: false};
result.requestedScope = args.uiOnly ? 'UI only: missing-key ordinary translation preflight, service switching and settings; no model quality proof'
    : args.basicOnly ? 'Bilibili basic meaning and usage only, preserved preferences and generic AI UI restoration'
    : args.qualityOnly ? 'French grammar and practice followup focused recheck' : 'French four actions, English idioms and Japanese grammar';
const pendingCaptures = new Set();
const sessions = new Set();
const shadowSessions = new WeakMap();
const requestStarts = new WeakMap();
const requestItems = new WeakMap();

function saveProgress(stage) {
    result.stage = stage;
    if (fs.existsSync(args.artifactsDir)) fs.writeFileSync(path.join(args.artifactsDir, 'progress.json'), `${JSON.stringify(result, null, 2)}\n`);
}
function record(id, details = {}) {const item = {id, status: 'passed', ...details}; result.cases.push(item); saveProgress(id); process.stdout.write(`${id}: ${item.status}\n`);}
function phase(name) {saveProgress(name); process.stdout.write(`phase: ${name}\n`);}
function parseStored(value) {if (typeof value !== 'string') return value || {}; try {return JSON.parse(value) || {};} catch {return {};}}
async function send(page, message) {
    return page.evaluate(request => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`配置消息超时: ${request.type}`)), 10000);
        chrome.runtime.sendMessage(request, response => {clearTimeout(timer); const error = chrome.runtime.lastError?.message; error ? reject(new Error(error)) : resolve(response);});
    }), message);
}
async function readConfig(page) {
    const [settings, credentials] = await Promise.all([send(page, {type: 'configStorageRead', key: 'local:config'}), send(page, {type: 'configStorageRead', key: 'local:credentials'})]);
    assert(settings?.success && credentials?.success, '隔离配置读取失败');
    return {...parseStored(settings.value), ...parseStored(credentials.value)};
}
async function persistConfig(page, patch) {
    const config = await readConfig(page);
    const response = await send(page, {type: 'persistConfig', config: {...config, ...patch}, clientId: `bilibili-reading-${process.pid}`, sequence: Date.now(), baseRevision: config.__fluentConfigRevision});
    assert(response?.success, '隔离配置保存失败');
    await page.waitForTimeout(350);
    return readConfig(page);
}
function children(node) {return [...(node?.children || []), ...(node?.shadowRoots || []), ...(node?.contentDocument ? [node.contentDocument] : [])];}
function attr(node, name) {const a = node?.attributes || []; for (let i = 0; i < a.length; i += 2) if (a[i] === name) return a[i + 1] || ''; return '';}
function text(node) {return !node || ['STYLE', 'SCRIPT'].includes(node.nodeName) ? '' : node.nodeName === '#text' ? node.nodeValue || '' : children(node).map(text).join('');}
function find(node, predicate) {if (!node) return null; if (predicate(node)) return node; for (const child of children(node)) {const hit = find(child, predicate); if (hit) return hit;} return null;}
function findAll(node, predicate, out = []) {if (!node) return out; if (predicate(node)) out.push(node); for (const child of children(node)) findAll(child, predicate, out); return out;}
function hasClass(node, name) {return attr(node, 'class').split(' ').includes(name);}
async function bounded(operation, message, timeout = 10000) {
    let timer;
    try {return await Promise.race([operation, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error(message)), timeout);})]);}
    finally {clearTimeout(timer);}
}
async function shadowSnapshot(page) {
    let session = shadowSessions.get(page);
    if (!session) {
        const actual = await page.context().newCDPSession(page);
        session = {send: (method, parameters) => bounded(actual.send(method, parameters), `隔离浏览器 CDP 无响应: ${method}`),
            detach: () => bounded(actual.detach(), '隔离浏览器 CDP detach 无响应')};
        shadowSessions.set(page, session); sessions.add(session);
    }
    const {root} = await session.send('DOM.getDocument', {depth: -1, pierce: true});
    const host = find(root, n => attr(n, 'id') === 'fluent-read-selection-translator-container');
    return {host, text: text(host), session};
}
async function waitUntil(predicate, message, timeout = 10000) {
    const start = Date.now(); let last;
    while (Date.now() - start < timeout) {last = await predicate(); if (last) return last; await new Promise(resolve => setTimeout(resolve, 100));}
    throw new Error(message);
}
async function clickNode(session, node, label) {
    assert(node?.nodeId, `没有找到可点击节点: ${label}`);
    await session.send('DOM.scrollIntoViewIfNeeded', {nodeId: node.nodeId});
    // 初次卡片挂载与 requestAnimationFrame 定位会改变几何；等真实目标连续帧稳定再发原生点击。
    const {object} = await session.send('DOM.resolveNode', {nodeId: node.nodeId});
    const diagnostic = {label, stage: result.stage, at: new Date().toISOString(), samples: []};
    const stablePoint = async () => waitUntil(async () => {
        const response = await session.send('Runtime.callFunctionOn', {objectId: object.objectId, returnByValue: true, awaitPromise:true,
            functionDeclaration: `async function() {
                const sample=()=>{
                    const r=this.getBoundingClientRect(),root=this.getRootNode(),x=r.left+r.width/2,y=r.top+r.height/2;
                    const hit=root.elementFromPoint?.(x,y),style=getComputedStyle(this);
                    return {x,y,width:r.width,height:r.height,visible:this.isConnected&&r.width>0&&r.height>0&&style.visibility==='visible'&&style.display!=='none',
                        matches:hit===this||this.contains(hit),hitTag:hit?.tagName,hitLabel:hit?.getAttribute('aria-label'),hitText:hit?.textContent?.trim().slice(0,80)};
                };
                const samples=[sample()];
                for(let i=0;i<2;i++){await new Promise(resolve=>requestAnimationFrame(resolve));samples.push(sample());}
                const value=samples[2];
                const stable=samples.every(point=>point.visible&&point.matches&&['x','y','width','height'].every(key=>Math.abs(point[key]-value[key])<=0.25));
                return {value,stable,samples};
            }`});
        const measured=response.result.value;
        diagnostic.samples.push(measured);
        return measured.stable ? measured.value : null;
    }, `可点击目标尚未可见、命中或连续帧稳定: ${label}`);
    try {
        const hovered=await stablePoint();
        await session.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:hovered.x,y:hovered.y,button:'none'});
        const point=await stablePoint();
        diagnostic.point=point;
        (result.nativeClickDiagnostics ||= []).push(diagnostic);
        fs.writeFileSync(path.join(args.artifactsDir,'native-click-diagnostics.json'),JSON.stringify(result.nativeClickDiagnostics,null,2)+'\n');
        await session.send('Input.dispatchMouseEvent', {type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
        await session.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
    } finally {await session.send('Runtime.releaseObject',{objectId:object.objectId});}
}

async function clickButton(page, label) {
    const {host, session} = await shadowSnapshot(page);
    const node = find(host, n => n.nodeName === 'BUTTON' && (attr(n, 'aria-label') === label || text(n).trim() === label));
    await clickNode(session, node, label);
}
async function fillQuestion(page, question) {
    const {host, session} = await shadowSnapshot(page);
    const input = find(host, n => n.nodeName === 'INPUT' && attr(n, 'aria-label') === '继续追问');
    assert(input?.nodeId, '没有找到追问输入框');
    await session.send('DOM.focus', {nodeId: input.nodeId});
    await page.keyboard.insertText(question);
}
async function selectSentence(page, lang) {
    const box = await page.locator('#selected-sentence').boundingBox(); assert(box, '原文没有可选择的几何位置');
    await page.mouse.move(box.x + 1, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, {steps: 12}); await page.mouse.up();
    await page.waitForTimeout(450);
    const selection = await page.evaluate(() => getSelection()?.toString().trim() || '');
    assert(selection === sentences[lang], `真实选区不完整: ${selection}`);
    await waitUntil(async () => find((await shadowSnapshot(page)).host, n => n.nodeName === 'BUTTON' && attr(n, 'aria-label') === '打开划词翻译'), '没有显示划词入口');
    await clickButton(page, '打开划词翻译');
    await waitUntil(async () => find((await shadowSnapshot(page)).host, n => hasClass(n, 'fr-translation-tooltip')), '没有打开翻译卡片');
    return selection;
}
async function capture(page, name) {
    const file = path.join(args.artifactsDir, `${name}.png`); await page.screenshot({path: file}); result.screenshots.push(file); return file;
}
async function captureCard(page, name) {
    const {host, session} = await shadowSnapshot(page);
    const card = find(host, node => hasClass(node, 'fr-translation-tooltip'));
    assert(card?.nodeId, '没有卡片可截取真实元素截图');
    const {object} = await session.send('DOM.resolveNode', {nodeId: card.nodeId});
    let handle;
    try {
        // CDP 只暂存同一个真实 DOM 节点引用，让 Playwright 对 closed Shadow 元素截图；不复制或改写 UI。
        await session.send('Runtime.callFunctionOn', {objectId: object.objectId, functionDeclaration: 'function() {globalThis.__fluentReadBilibiliCaptureNode = this;}'});
        handle = await page.evaluateHandle(() => globalThis.__fluentReadBilibiliCaptureNode);
        const element = handle.asElement(); assert(element, '闭合 Shadow 卡片没有转换为真实元素');
        const file = path.join(args.artifactsDir, `${name}-card.png`); await element.screenshot({path: file}); result.screenshots.push(file); return file;
    } finally {
        await handle?.dispose(); await page.evaluate(() => {delete globalThis.__fluentReadBilibiliCaptureNode;});
        await session.send('Runtime.releaseObject', {objectId: object.objectId});
    }
}
async function completeAnswer(page, name, started, source) {
    let snapshot;
    await waitUntil(async () => {
        snapshot = await shadowSnapshot(page);
        const error = find(snapshot.host, n => hasClass(n, 'fr-reading-error'));
        if (error && text(error).trim()) throw new Error(`真实讲解失败: ${text(error)}`);
        const answer = find(snapshot.host, n => hasClass(n, 'fr-reading-answer'));
        return answer && text(answer).trim() && attr(answer, 'aria-busy') !== 'true';
    }, `真实 B站讲解没有在 90 秒内完成: ${name}`, 90000);
    const answerNode = find(snapshot.host, n => hasClass(n, 'fr-reading-answer'));
    const {object} = await snapshot.session.send('DOM.resolveNode', {nodeId: answerNode.nodeId});
    let rendered;
    try {const r = await snapshot.session.send('Runtime.callFunctionOn', {objectId: object.objectId, returnByValue: true, functionDeclaration: 'function() {return this.innerText;}'}); rendered = r.result.value.trim();}
    finally {await snapshot.session.send('Runtime.releaseObject', {objectId: object.objectId});}
    assert(/[\u3400-\u9fff]/u.test(rendered), `${name} 没有中文讲解`);
    const annotations = findAll(answerNode, n => n.nodeName === 'BUTTON' && attr(n, 'data-pos'))
        .map(n => ({text: text(n).trim(), label: attr(n, 'aria-label'), pos: attr(n, 'data-pos'), role: attr(n, 'data-role')}));
    const verifiedEvidence = findAll(answerNode, n => n.nodeName === 'BUTTON' && hasClass(n, 'fr-reading-evidence'))
        .map(n => ({quote: attr(n, 'data-evidence-quote'), state: attr(n, 'data-evidence-state')}));
    const item = {name, source, renderedText: rendered, elapsedMs: Date.now() - started, annotations, verifiedEvidence};
    result.renderedAnswers.push(item);
    fs.writeFileSync(path.join(args.artifactsDir, `${name}-answer.txt`), `${rendered}\n`);
    fs.writeFileSync(path.join(args.artifactsDir, `${name}-shadow.json`), JSON.stringify(answerNode, null, 2));
    await capture(page, name);
    await captureCard(page, name);
    return item;
}
async function action(page, label, name, source) {
    const before = result.requests.length; const started = Date.now();
    assert(before < REQUEST_BUDGET, `真实请求 ${REQUEST_BUDGET} 次预算已用完，不再触发新的学习动作`);
    await clickButton(page, label);
    await waitUntil(() => result.requests.length > before, `${name} 未发出真实 B站请求`, 15000);
    const answer = await completeAnswer(page, name, started, source);
    record(name, {elapsedMs: answer.elapsedMs, requestDelta: result.requests.length - before, answerChars: answer.renderedText.length});
    return answer;
}
async function cardGeometry(page) {
    const {host, session} = await shadowSnapshot(page); const card = find(host, n => hasClass(n, 'fr-translation-tooltip'));
    assert(card?.nodeId, '没有卡片可验证布局');
    const {object} = await session.send('DOM.resolveNode', {nodeId: card.nodeId});
    try {
        const r = await session.send('Runtime.callFunctionOn', {objectId: object.objectId, returnByValue: true,
            functionDeclaration: `function() { const r=this.getBoundingClientRect(); const body=this.querySelector('.fr-reading-result'); const nav=this.querySelector('.fr-study-navigation'); return {x:r.x,y:r.y,width:r.width,height:r.height,viewport:{width:innerWidth,height:innerHeight},dark:this.classList.contains('fr-dark-theme'),scrollWidth:body?.scrollWidth,clientWidth:body?.clientWidth,navScrollWidth:nav?.scrollWidth,navClientWidth:nav?.clientWidth}; }`});
        return r.result.value;
    } finally {await session.send('Runtime.releaseObject', {objectId: object.objectId});}
}
async function verifyCompactBrandNavigation(page, name) {
    const {host, session} = await shadowSnapshot(page);
    const card = find(host, node => hasClass(node, 'fr-translation-tooltip'));
    assert(card?.nodeId, '没有划词卡片可验证品牌导航');
    const {object} = await session.send('DOM.resolveNode', {nodeId: card.nodeId});
    let geometry;
    try {
        const response = await session.send('Runtime.callFunctionOn', {objectId: object.objectId, returnByValue: true,
            functionDeclaration: `function() {
                const nav=this.querySelector('.fr-study-navigation');
                const brand=nav?.querySelector('.fr-tooltip-brand-icon');
                const translate=[...(nav?.querySelectorAll('.fr-study-toolbar > button') || [])].find(button=>button.textContent.trim()==='翻译');
                const rect=element=>{if(!element)return null;const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
                const style=brand?getComputedStyle(brand):null;
                return {brand:rect(brand),translate:rect(translate),navigation:rect(nav),dark:this.classList.contains('fr-dark-theme'),
                    imageLoaded:brand?.tagName==='IMG' && brand.complete && brand.naturalWidth>0,
                    imagePath:brand?.getAttribute('src'),visibility:style?.visibility,display:style?.display,opacity:style?.opacity,
                    languageHeaderPresent:!!this.querySelector('.fr-tooltip-header, .fr-language-header, .fr-language-selector'),
                    navigationText:nav?.innerText || '', languageControlPresent:!!nav?.querySelector('select,[role="combobox"]')};
            }`});
        geometry = response.result.value;
    } finally {await session.send('Runtime.releaseObject', {objectId: object.objectId});}
    assert(geometry.brand?.width > 0 && geometry.brand?.height > 0 && geometry.imageLoaded, `品牌图标不可见或资产未加载: ${JSON.stringify(geometry)}`);
    assert(Math.abs(geometry.brand.width - 18) <= 1 && Math.abs(geometry.brand.height - 18) <= 1 && Number(geometry.opacity) === 1, `品牌图标没有保持最终18px及明暗一致可见度: ${JSON.stringify(geometry)}`);
    assert(geometry.brand.right <= geometry.translate.x + 1, `品牌图标没有位于翻译按钮左侧: ${JSON.stringify(geometry)}`);
    assert(Math.abs((geometry.brand.y + geometry.brand.height / 2) - (geometry.translate.y + geometry.translate.height / 2)) <= 2, `品牌图标与翻译按钮没有保持同一行: ${JSON.stringify(geometry)}`);
    assert(geometry.visibility === 'visible' && geometry.display !== 'none' && Number(geometry.opacity) > 0, `品牌图标被隐藏: ${JSON.stringify(geometry)}`);
    assert(!geometry.languageHeaderPresent && !geometry.languageControlPresent && !/English|简体中文/u.test(geometry.navigationText), `旧语言栏仍出现在划词卡片: ${JSON.stringify(geometry)}`);
    record(name, geometry);
    return geometry;
}
async function assertBasicUi(page) {
    const snapshot = await shadowSnapshot(page);
    const toolbar = find(snapshot.host, node => hasClass(node, 'fr-study-toolbar'));
    const labels = findAll(toolbar, node => node.nodeName === 'BUTTON').map(node => text(node).trim());
    assert(labels.includes('读懂') && labels.includes('用法'), `免费基础模式缺少读懂或用法: ${labels}`);
    assert(!labels.includes('词性与句法') && !labels.includes('练习'), `B站仍显示未通过验证的句法或练习入口: ${labels}`);
    assert(!find(snapshot.host, node => hasClass(node, 'fr-reading-followup')), 'B站仍显示未通过验证的多轮追问表单');
    return {snapshot, labels};
}
async function verifyRealRequests(maximum = 10) {
    await Promise.allSettled([...pendingCaptures]);
    assert(result.requests.length <= maximum, `真实请求超出 ${maximum} 次限制`);
    assert(result.requests.every(item => !item.authHeaderPresent && !item.cookieHeaderPresent && item.status === 200), '匿名真实请求包含认证或没有全部成功');
    assert(result.requests.every(item => JSON.parse(item.body).model === BILIBILI_MODEL), '真实请求没有固定 Index-Translate 模型');
    record('real-anonymous-api-responses', {requestCount: result.requests.length, statuses: result.networkStatuses});
    result.transportOk = result.consoleErrors.length === 0 && result.requestFailures.length === 0;
    result.integrationOk = result.transportOk && result.cases.every(item => item.status === 'passed' || item.status === 'limited');
    result.ok = result.transportOk && result.capabilityLimitations.length === 0;
}
async function verifyConfigurationUiOnly({page, configPage, lang}) {
    const before = result.requests.length;
    phase('ui-configure-empty-key-ordinary-service');
    const saved = await readConfig(configPage);
    await persistConfig(configPage, {selectionTranslationService: 'openai', token: {...saved.token, openai: ''}});
    const missingKeyCard = async () => {
        phase('ui-select-and-open-empty-key-card');
        // 偏好变更会关闭旧选区并保留原生 pointer/selection 状态；重新载入公开fixture后再用真实拖选，避免复用被关闭的手势。
        await page.reload({waitUntil: 'domcontentloaded'}); await page.waitForTimeout(650);
        await selectSentence(page, lang);
        const snapshot = await waitUntil(async () => {
            const value = await shadowSnapshot(page);
            const error = find(value.host, node => hasClass(node, 'fr-error-state'));
            return error && text(error).trim() ? value : null;
        }, '普通空 Key 服务没有显示失败状态');
        assert(result.requests.length === before && result.otherAiRequests.length === 0, '凭据预检 UI 检查触发了供应商请求');
        const errorText = text(find(snapshot.host, node => hasClass(node, 'fr-error-state'))).trim();
        result.preflightErrorText ||= [];
        result.preflightErrorText.push(errorText);
        if (!errorText.includes('API Key')) result.preflightReasonVisibility = 'Actual empty-key card shows generic failure, not a detailed missing-key reason';
        return snapshot;
    };
    const mountBasicRecordsThenHide = async () => {
        // B站仅打开本地记录并立即切翻译，禁止“返回当前阅读”：其父子 watcher 会恢复真实学习动作。
        phase('ui-open-local-records'); await clickButton(page, '记录');
        await waitUntil(async () => find((await shadowSnapshot(page)).host, node => hasClass(node, 'fr-reading-records')), '没有打开本地记录');
        phase('ui-hide-mounted-panel-with-translation'); await clickButton(page, '翻译'); await page.waitForTimeout(350);
    };
    await missingKeyCard(); await assertBasicUi(page); await mountBasicRecordsThenHide(); await assertBasicUi(page);
    await verifyCompactBrandNavigation(page, 'ui-basic-brand-no-language-header');
    await captureCard(page, 'ui-basic-missing-key-no-followup'); record('ui-basic-two-actions-no-followup-no-model');
    phase('ui-switch-to-generic-ai');
    await persistConfig(configPage, {harness: {...saved.harness, service: 'openai', model: ''}});
    assert(!find((await shadowSnapshot(page)).host, node => hasClass(node, 'fr-translation-tooltip')), '服务偏好变化没有关闭旧选区卡片');
    record('ui-preference-change-invalidates-old-card');
    const generic = await missingKeyCard();
    const toolbar = find(generic.host, node => hasClass(node, 'fr-study-toolbar'));
    const labels = findAll(toolbar, node => node.nodeName === 'BUTTON').map(node => text(node).trim());
    assert(['读懂', '词性与句法', '用法', '练习'].every(label => labels.includes(label)), `重新打开后通用 AI 没有恢复完整动作: ${labels}`);
    const genericConfig = await readConfig(configPage);
    assert(genericConfig.harness.service === 'openai' && genericConfig.selectionTranslationService === 'openai' && !genericConfig.token?.openai?.trim(), 'generic 预检前没有确认独立OpenAI及空Key，停止以免发出供应商请求');
    record('ui-generic-empty-key-confirmed-before-runtime-preflight', {service: genericConfig.harness.service, keyPresent: false});
    phase('ui-generic-grammar-runtime-credential-preflight');
    await clickButton(page, '词性与句法');
    await waitUntil(async () => {
        const readingError = find((await shadowSnapshot(page)).host, node => hasClass(node, 'fr-reading-error'));
        return readingError && text(readingError).includes('API Key');
    }, 'generic 语法没有显示后台缺Key预检错误');
    assert(result.requests.length === before && result.otherAiRequests.length === 0, 'generic 后台凭据预检触发了供应商请求');
    await captureCard(page, 'ui-generic-runtime-missing-key-visible-form');
    // 改变隔离profile中的已有OpenAI模型偏好，让真实模型输入变化反馈渲染；空Key保持不变，不生成答案。
    const nextModel = genericConfig.model.openai === 'gpt-5.6-sol' ? 'gpt-5.6-luna' : 'gpt-5.6-sol';
    await persistConfig(configPage, {model: {...genericConfig.model, openai: nextModel}});
    const feedbackSnapshot = await waitUntil(async () => {
        const value = await shadowSnapshot(page);
        const feedbackNode = find(value.host, node => node.nodeName === 'P' && hasClass(node, 'fr-reading-feedback') && text(node).includes('设置已更新'));
        return feedbackNode ? {...value, feedbackNode} : null;
    }, 'generic 模型偏好变化没有渲染真实反馈');
    const {object: feedbackObject} = await feedbackSnapshot.session.send('DOM.resolveNode', {nodeId: feedbackSnapshot.feedbackNode.nodeId});
    let feedbackStyles;
    try {
        const response = await feedbackSnapshot.session.send('Runtime.callFunctionOn', {objectId: feedbackObject.objectId, returnByValue: true,
            functionDeclaration: `function() {const style=getComputedStyle(this); return {text:this.innerText,fontSize:style.fontSize,color:style.color,scopeAttributes:this.getAttributeNames().filter(name=>name.startsWith('data-v-')),count:this.parentElement.querySelectorAll(':scope > .fr-reading-feedback').length};}`});
        feedbackStyles = response.result.value;
    } finally {await feedbackSnapshot.session.send('Runtime.releaseObject', {objectId: feedbackObject.objectId});}
    assert(feedbackStyles.count === 1 && feedbackStyles.scopeAttributes.length > 0 && feedbackStyles.fontSize === '12px', `generic 反馈提示唯一性或CSS scope异常: ${JSON.stringify(feedbackStyles)}`);
    record('ui-generic-feedback-unique-actual-style-scope', feedbackStyles);
    await captureCard(page, 'ui-generic-real-model-change-feedback');
    await fillQuestion(page, '这个短语如何用？');
    const filled = await shadowSnapshot(page);
    const submit = find(filled.host, node => node.nodeName === 'BUTTON' && attr(node, 'aria-label') === '发送追问');
    assert(submit && !submit.attributes.includes('disabled'), 'generic 实际 v-model 输入后发送按钮仍未启用');
    record('ui-generic-native-input-updates-v-model-without-submit');
    await captureCard(page, 'ui-generic-form-feedback-scope');
    await clickButton(page, '翻译'); await page.waitForTimeout(350);
    const snapshot = await shadowSnapshot(page);
    const form = find(snapshot.host, node => hasClass(node, 'fr-reading-followup'));
    assert(form?.nodeId, '空Key后台预检挂载面板后，通用 AI 未恢复追问表单');
    const {object} = await snapshot.session.send('DOM.resolveNode', {nodeId: form.nodeId});
    let followup;
    try {
        const response = await snapshot.session.send('Runtime.callFunctionOn', {objectId: object.objectId, returnByValue: true,
            functionDeclaration: `function() {const input=this.querySelector('input'); const style=getComputedStyle(this); const inputStyle=input?getComputedStyle(input):null; return {hidden:this.getClientRects().length===0,display:style.display,gap:style.gap,inputCount:this.querySelectorAll('input[aria-label="继续追问"]').length,inputMinWidth:inputStyle?.minWidth,inputFlexGrow:inputStyle?.flexGrow,scopeAttributes:this.getAttributeNames().filter(name=>name.startsWith('data-v-')),inputScopeAttributes:input?.getAttributeNames().filter(name=>name.startsWith('data-v-')),feedbackCount:this.parentElement.querySelectorAll(':scope > .fr-reading-feedback').length};}`});
        followup = response.result.value;
    }
    finally {await snapshot.session.send('Runtime.releaseObject', {objectId: object.objectId});}
    assert(followup.hidden, '切回翻译后通用 AI 追问表单仍然可见');
    assert(followup.inputCount === 1 && followup.display === 'flex' && followup.gap === '6px' && followup.inputFlexGrow === '1', `通用 AI 追问 form/input 唯一性或实际样式错误: ${JSON.stringify(followup)}`);
    assert(followup.scopeAttributes.length > 0 && followup.inputScopeAttributes.length > 0 && followup.inputMinWidth === '0px', `通用 AI 追问 Fragment 子节点没有正确CSS scope: ${JSON.stringify(followup)}`);
    assert(result.requests.length === before && result.otherAiRequests.length === 0, '通用 AI DOM 检查触发了模型');
    await captureCard(page, 'ui-generic-four-actions-inactive-followup');
    record('generic-ai-restores-four-actions-and-inactive-followup-no-request', {labels, followupMounted: true, followupVisible: false, computedStyles: followup, modelRequestTriggered: false});
    phase('ui-restore-bilibili-preferences');
    await persistConfig(configPage, {harness: {...saved.harness}, model: {...genericConfig.model}});
    await missingKeyCard(); await mountBasicRecordsThenHide(); await assertBasicUi(page);
    const restored = await readConfig(configPage);
    assert(restored.harness.defaultAction === 'grammar' && restored.harness.actions.join(',') === 'meaning,grammar,usage,practice', '服务切换丢失保存的动作偏好');
    await captureCard(page, 'ui-basic-restored-saved-preferences'); record('ui-basic-restored-saved-grammar-actions');
    phase('ui-inspect-fixed-model-settings');
    await configPage.reload({waitUntil: 'domcontentloaded'}); await configPage.waitForTimeout(650);
    const settingsText = await configPage.locator('body').innerText();
    assert(settingsText.includes('B站翻译 · 免费') && settingsText.includes('无需 API Key') && settingsText.includes('Index-Translate'), '基础设置没有免费服务或固定模型说明');
    assert(settingsText.includes('免费基础读懂/用法') && settingsText.includes('完整语法、练习和追问可切换 AI 服务'), '设置没有说明B站基础范围及完整动作需要其他 AI 服务');
    assert(await configPage.getByRole('combobox', {name: '学习讲解模型'}).count() === 0, 'B站固定模型仍可编辑');
    await configPage.getByLabel('学习讲解模型', {exact: true}).scrollIntoViewIfNeeded(); await capture(configPage, 'settings-basic-fixed-free-model');
    // 普通服务恢复前先关闭卡片，防止已完成七次真实 API 后重新发起普通翻译。
    await clickButton(page, '关闭翻译结果');
    await persistConfig(configPage, {selectionTranslationService: saved.selectionTranslationService});
    assert(result.requests.length === before && result.otherAiRequests.length === 0, '服务或设置 UI 验证发出了额外模型请求');
    record('basic-settings-scope-fixed-model-no-extra-request');
    result.uiOnlyBoundary = {ordinaryTranslation: 'Empty-key OpenAI configuration, actual failure text and zero provider requests recorded; no successful provider response',
        panelMount: 'Bilibili local records then translation only; generic empty-key OpenAI grammar invokes runtime credential preflight, not a supplier request',
        genericAiRestoration: 'Real DOM form/input/feedback and hidden followup form after translation; no supplier response or quality claim',
        modelResponses: 0};
}
async function verifyBasicOnly({page, configPage, fixture, enabled}) {
    const initial = await assertBasicUi(page);
    const current = find(find(initial.snapshot.host, node => hasClass(node, 'fr-study-toolbar')), node => node.nodeName === 'BUTTON' && attr(node, 'aria-pressed') === 'true');
    assert(text(current).trim() === '读懂', 'B站没有将已保存 grammar 默认动作临时回退到读懂');
    assert(enabled.harness.defaultAction === 'grammar' && enabled.harness.actions.join(',') === 'meaning,grammar,usage,practice', '免费基础模式破坏了已保存动作偏好');
    record('basic-only-entrypoints-preserve-saved-grammar-default', {labels: initial.labels, savedDefault: enabled.harness.defaultAction, savedActions: enabled.harness.actions});
    await verifyCompactBrandNavigation(page, 'basic-brand-icon-left-of-translation-no-language-header');
    await action(page, '用法', 'french-basic-usage', sentences.fr);
    await assertBasicUi(page);
    const beforeReuse = result.requests.length;
    for (const label of ['用法', '翻译', '读懂', '用法']) {await clickButton(page, label); await page.waitForTimeout(450);}
    assert(result.requests.length === beforeReuse, '同动作或翻译/已完成基础讲解切换触发了多余真实请求');
    await captureCard(page, 'french-basic-usage-reused'); record('basic-action-cache-and-translation-switch-no-extra-request');
    const beforeTheme = result.requests.length;
    await page.setViewportSize({width: 390, height: 844}); await page.waitForTimeout(350);
    let geometry = await cardGeometry(page);
    assert(geometry.width <= 390 && geometry.x >= -1 && geometry.x + geometry.width <= 391, `390px 基础卡片横向越界: ${JSON.stringify(geometry)}`);
    await verifyCompactBrandNavigation(page, 'basic-brand-navigation-narrow-light');
    await capture(page, 'basic-usage-narrow-light'); await captureCard(page, 'basic-usage-narrow-light'); record('basic-narrow-light-layout', geometry);
    await persistConfig(configPage, {theme: 'dark'}); await page.waitForTimeout(350);
    geometry = await cardGeometry(page); assert(geometry.dark, '基础卡片没有切换深色');
    await verifyCompactBrandNavigation(page, 'basic-brand-navigation-narrow-dark');
    await capture(page, 'basic-usage-narrow-dark'); await captureCard(page, 'basic-usage-narrow-dark'); record('basic-narrow-dark-layout', geometry);
    await page.setViewportSize({width: 1280, height: 900}); await persistConfig(configPage, {theme: 'light'}); await page.waitForTimeout(350);
    await verifyCompactBrandNavigation(page, 'basic-brand-navigation-restored-light');
    assert(result.requests.length === beforeTheme, '基础模式的主题或视窗变化触发了额外模型请求'); record('basic-theme-and-viewport-no-extra-request');
    for (const [lang, label, name] of [['en', '用法', 'english-basic-idiom-usage'], ['ja', '读懂', 'japanese-basic-meaning']]) {
        await page.goto(`${fixture}?lang=${lang}`, {waitUntil: 'domcontentloaded'}); await page.waitForTimeout(650); await selectSentence(page, lang);
        await waitUntil(async () => !(await shadowSnapshot(page)).text.includes('正在查询…'), `${lang} 真实翻译未完成`, 60000);
        await verifyCompactBrandNavigation(page, `${lang}-translation-brand-navigation-no-language-header`);
        await captureCard(page, `${lang}-ordinary-translation`);
        const answer = await action(page, label, name, sentences[lang]); await assertBasicUi(page);
        if (lang === 'en') assert(/break the ice/u.test(answer.renderedText) && /get the ball rolling/u.test(answer.renderedText), '英语基础用法未讨论两个原文惯用语');
        if (lang === 'ja') assert(/雨|下雨|阅读|读书|读了/u.test(answer.renderedText), '日语基础读懂未说明样句含义');
        const beforeCached = result.requests.length; await clickButton(page, label); await clickButton(page, '翻译'); await clickButton(page, label); await page.waitForTimeout(400);
        assert(result.requests.length === beforeCached, `${lang} 已完成基础动作切换没有复用缓存`);
        record(`${lang}-basic-action-cache-reuse`);
    }
    await clickButton(page, '翻译');
    await verifyConfigurationUiOnly({page, configPage, lang: 'ja'});
    result.basicCapabilityBoundary = {allowed: ['meaning', 'usage'], unsupported: ['grammar', 'practice', 'followup'], genericAiRestoration: 'DOM only; no paid model request or credentials'};
    assert(result.requests.length === 7 && result.requests.filter(item => JSON.parse(item.body).stream === false).length === 3, '基础矩阵没有完成三次普通翻译及四次流式基础讲解');
    record('three-real-translations-four-real-basic-explanations', {translations: 3, explanations: 4});
    await verifyRealRequests(7);
}

async function main() {
    assert(args.playwrightRoot, '必须传入 --playwright-root');
    assert(fs.existsSync(path.join(args.extensionDir, 'manifest.json')), '缺少生产构建');
    assert(fs.existsSync(args.focusSafeHelper), '缺少焦点安全 helper');
    fs.mkdirSync(args.artifactsDir, {recursive: true});
    result.head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: path.resolve(__dirname, '..'), encoding: 'utf8'}).trim();
    result.manifestSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(args.extensionDir, 'manifest.json'))).digest('hex');
    result.extensionProvenance = digestTree(args.extensionDir);
    result.sourceProvenance = {src: digestTree(path.resolve(__dirname, '../src')).digest, entrypoints: digestTree(path.resolve(__dirname, '../entrypoints')).digest,
        diffSha256: crypto.createHash('sha256').update(execFileSync('git', ['diff', '--binary', 'HEAD'], {cwd: path.resolve(__dirname, '..')})).digest('hex')};
    const {chromium} = createRequire(path.join(path.resolve(args.playwrightRoot), '__bilibili_reading_runner__.cjs'))('playwright');
    const helper = require(args.focusSafeHelper);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-bilibili-reading-profile-'));
    let context, close = async () => {}, configPage, page;
    const server = http.createServer((request, response) => {
        const lang = new URL(request.url, 'http://127.0.0.1').searchParams.get('lang') || 'fr';
        if (request.url.startsWith('/favicon')) {response.writeHead(204); response.end(); return;}
        response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        response.end(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>B站免费讲解验证</title><style>body{margin:0;background:#fff;color:#192232;font:18px/1.65 Arial,sans-serif}main{padding:170px 32px 700px;max-width:980px;margin:auto}h1{font-size:15px;color:#87909c;font-weight:400;margin:0 0 25px}p{margin:0 0 28px}#selected-sentence{white-space:nowrap}aside{font-size:13px;color:#98a0ab}</style></head><body><main><h1>FluentRead · 公开样句 · 真实 B站 API</h1><p><span id="selected-sentence">${sentences[lang]}</span></p><aside>这张页面仅提供固定原文；翻译与学习回答来自真实服务。</aside></main></body></html>`);
    });
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);})
        .catch(error => {fs.rmSync(profile, {recursive: true, force: true}); throw error;});
    const fixture = `http://127.0.0.1:${server.address().port}/fixture`;
    try {
        const session = await helper.launchFocusSafePersistentContext({chromium, profileDir: profile, browserPath: args.browserPath,
            headless: false, background: true, viewport: {width: 1280, height: 900}, browserArgs: [`--disable-extensions-except=${args.extensionDir}`, `--load-extension=${args.extensionDir}`, '--no-first-run', '--no-default-browser-check', '--mute-audio']});
        context = session.context; close = session.close;
        context.setDefaultTimeout(10000);
        Object.assign(result, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement, profileMode: 'temporary-isolated'});
        context.on('page', target => {target.on('pageerror', error => result.consoleErrors.push(error.message)); target.on('console', message => {if (message.type() === 'error' && !message.text().includes('favicon.ico')) result.consoleErrors.push(message.text());});});
        context.on('request', request => {
            if (request.url() !== BILIBILI_URL && /\/chat\/completions|\/messages(?:\?|$)|generateContent/u.test(request.url())) {
                result.otherAiRequests.push({url: request.url(), method: request.method()});
                saveProgress('unexpected-or-observed-other-ai-request');
                if (args.uiOnly) {result.unexpectedSupplierRequest = true; void close().catch(() => {});}
            }
            if (request.url() !== BILIBILI_URL) return;
            if (result.requests.length >= REQUEST_BUDGET) result.requestBudgetExceeded = true;
            const item = {id: result.requests.length + 1, url: request.url(), method: request.method(), startedAt: new Date().toISOString(), body: request.postData(), authHeaderPresent: Boolean(request.headers().authorization), cookieHeaderPresent: Boolean(request.headers().cookie)};
            requestStarts.set(request, Date.now()); requestItems.set(request, item); result.requests.push(item);
            saveProgress('unexpected-or-observed-bilibili-request');
            if (args.uiOnly) {result.unexpectedSupplierRequest = true; void close().catch(() => {});}
        });
        context.on('requestfailed', request => {if (request.url() === BILIBILI_URL) result.requestFailures.push({url: request.url(), error: request.failure()?.errorText});});
        context.on('response', response => {
            if (response.url() !== BILIBILI_URL) return;
            const task = (async () => {
                const request = response.request(); const item = requestItems.get(request); const responseText = await response.text();
                const id = item?.id || result.networkStatuses.length + 1;
                if (item) Object.assign(item, {status: response.status(), elapsedMs: Date.now() - requestStarts.get(request), responseText});
                result.networkStatuses.push({id, status: response.status()});
                fs.writeFileSync(path.join(args.artifactsDir, `api-response-${id}.txt`), responseText);
            })().catch(error => result.requestFailures.push({url: response.url(), captureError: error.message}));
            pendingCaptures.add(task); task.finally(() => pendingCaptures.delete(task));
        });
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 30000});
        const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)/)[1]; result.extensionId = extensionId;
        configPage = await helper.newPageWithoutForeground(context);
        await configPage.goto(`chrome-extension://${extensionId}/options.html#settings-harness`, {waitUntil: 'domcontentloaded'}); await configPage.waitForTimeout(1100);
        const initial = await readConfig(configPage);
        assert(initial.harness.enabled === false, 'AI 讲解默认未关闭');
        record('default-ai-disabled');
        await persistConfig(configPage, {on: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, service: 'bilibili', selectionTranslationService: args.uiOnly ? 'openai' : 'bilibili', from: 'auto', to: 'zh-Hans', theme: 'light', selectionTranslatorMode: 'bilingual', selectionTranslatorPresentation: 'card', disableSelectionTranslator: false, selectionTranslatorTrigger: 'icon', selectionTranslatorDelay: 0, selectionTranslatorAutoDismiss: false, useCache: false, hotkey: 'none', floatingBallHotkey: 'none', ...(args.basicOnly || args.uiOnly ? {harness: {...initial.harness, defaultAction: 'grammar', actions: ['meaning', 'grammar', 'usage', 'practice'], ...(args.uiOnly ? {enabled: true, service: 'bilibili', model: ''} : {})}} : {})});
        page = await helper.newPageWithoutForeground(context);
        await page.goto(`${fixture}?lang=fr`, {waitUntil: 'domcontentloaded'}); await helper.activateExtensionTabWithoutForeground(context, page); await page.waitForTimeout(700);
        if (args.uiOnly) {
            await verifyConfigurationUiOnly({page, configPage, lang: 'fr'});
            assert(result.requests.length === 0 && result.otherAiRequests.length === 0 && !result.unexpectedSupplierRequest, 'UI-only 产生了供应商请求');
            record('ui-only-no-supplier-request-or-model-response', {requests: 0, modelResponses: 0});
            result.transportOk = true; result.integrationOk = true; result.ok = true;
            return;
        }
        await selectSentence(page, 'fr');
        let snapshot = await shadowSnapshot(page);
        assert(snapshot.text.includes('免费 AI 讲解') && !snapshot.text.includes('配置 AI 讲解'), '默认卡片没有显示免费入口');
        const entry = find(snapshot.host, n => n.nodeName === 'BUTTON' && text(n).trim() === '免费 AI 讲解');
        assert(attr(entry, 'title').includes('无需 API Key'), '免费入口没有免密钥说明');
        await waitUntil(async () => !(await shadowSnapshot(page)).text.includes('正在查询…'), '真实翻译未完成', 60000);
        if (args.basicOnly) assert(result.requests.length === 1 && JSON.parse(result.requests[0].body).stream === false, '默认免费入口已触发了未经点击的 AI 讲解请求');
        if (args.basicOnly) await verifyCompactBrandNavigation(page, 'default-brand-icon-left-of-translation-no-language-header');
        await capture(page, 'default-free-entry'); await captureCard(page, 'default-free-entry'); record('default-card-free-entry-no-ai-request', {totalRequests: result.requests.length});
        const start = Date.now(); const beforeEnable = result.requests.length;
        await clickButton(page, '免费 AI 讲解');
        await waitUntil(() => result.requests.length > beforeEnable, '显式启用后没有真实讲解请求', 15000);
        const meaning = await completeAnswer(page, 'french-meaning', start, sentences.fr);
        const enabled = await readConfig(configPage);
        assert(enabled.harness.enabled && enabled.harness.service === 'bilibili' && !enabled.harness.model, '一键启用没有保存免费服务或固定模型策略');
        assert(!enabled.token?.bilibili, '隔离配置产生了 B站 Key');
        record('explicit-enable-real-meaning-no-key', {elapsedMs: meaning.elapsedMs});
        if (/指代前文|前文提(?:到|及)/u.test(meaning.renderedText) && !/无法确定|不能确定|未提供|不确定|缺少上下文/u.test(meaning.renderedText)) {
            const limitation = {id: 'french-meaning-unsupported-reference', status: 'limited', description: '选区及授权段落只有当前句，模型仍确定声称 Ceci 指代前文，依据不足', renderedText: meaning.renderedText};
            result.capabilityLimitations.push(limitation); record(limitation.id, limitation);
        }
        if (args.basicOnly) {await verifyBasicOnly({page, configPage, fixture, enabled}); return;}
        const grammar = await action(page, '词性与句法', 'french-grammar', sentences.fr);
        if (grammar.annotations.length === 0) {
            const limitation = {id: 'french-grammar-source-anchored', status: 'limited', description: '真实模型返回普通列表，没有遵循固定句法表格格式；不能宣称原文 token 锚定通过', renderedText: grammar.renderedText};
            result.capabilityLimitations.push(limitation); record(limitation.id, limitation);
        } else {
            assert(grammar.annotations.every(annotation => sentences.fr.includes(annotation.label.split(' · ')[0])), '法语句法标注含非原文片段');
            record('french-grammar-source-anchored', {annotations: grammar.annotations});
        }
        if (grammar.annotations.some(annotation => annotation.role === 'object' && annotation.label.startsWith('une phrase française complète ·'))
            || /une phrase française complète[\s\S]{0,40}宾语/u.test(grammar.renderedText)) {
            const limitation = {id: 'french-grammar-copular-complement', status: 'limited', description: '模型把法语 être 后的表语错误标为宾语；原文片段锚定成功不等于语法分类正确'};
            result.capabilityLimitations.push(limitation); record(limitation.id, limitation);
        }
        const beforeTheme = result.requests.length;
        await page.setViewportSize({width: 390, height: 844}); await page.waitForTimeout(400);
        let geometry = await cardGeometry(page);
        assert(geometry.width <= 390 && geometry.x >= -1 && geometry.x + geometry.width <= 391, `390px 卡片横向越界: ${JSON.stringify(geometry)}`);
        await capture(page, 'french-grammar-narrow-light'); record('narrow-light-layout', geometry);
        await persistConfig(configPage, {theme: 'dark'}); await page.waitForTimeout(400);
        geometry = await cardGeometry(page); assert(geometry.dark, '卡片没有切换深色');
        await capture(page, 'french-grammar-narrow-dark'); record('narrow-dark-layout', geometry);
        await page.setViewportSize({width: 1280, height: 900}); await persistConfig(configPage, {theme: 'light'}); await page.waitForTimeout(350);
        assert(result.requests.length === beforeTheme, '主题与屏宽变化触发了额外模型请求'); record('theme-and-viewport-no-extra-request');
        if (!args.qualityOnly) await action(page, '用法', 'french-usage', sentences.fr);
        const practice = await action(page, '练习', 'french-practice', sentences.fr);
        const beforeQuestion = result.requests.length; const questionStart = Date.now();
        await fillQuestion(page, '我的答案是：Ceci est une phrase complète. 请按你刚才的练习给出简短反馈，并说明 française 的位置。'); await clickButton(page, '发送追问');
        await waitUntil(() => result.requests.length > beforeQuestion, '练习追问没有经过真实模型');
        const feedback = await completeAnswer(page, 'french-practice-feedback', questionStart, sentences.fr);
        if (feedback.renderedText === practice.renderedText) {
            const limitation = {id: 'practice-followup-feedback', status: 'limited', description: '真实模型收到用户作答后重复上一道练习，没有提供作答反馈', elapsedMs: feedback.elapsedMs, answerChars: feedback.renderedText.length};
            result.capabilityLimitations.push(limitation); record(limitation.id, limitation);
        } else if (!/你的|你提交|作答|答案|回答|正确|错误|符合|不符|点评|判断/u.test(feedback.renderedText)) {
            const limitation = {id: 'practice-followup-feedback', status: 'failed', description: '模型仍在重复或改写练习题，未对用户作答给出判断或反馈', elapsedMs: feedback.elapsedMs, renderedText: feedback.renderedText};
            result.capabilityLimitations.push(limitation); record(limitation.id, limitation);
        } else if (/英语|英文/u.test(practice.renderedText) && !/英语|英文|English/u.test(feedback.renderedText)) {
            const limitation = {id: 'practice-followup-feedback', status: 'limited', description: '练习要求改写英语，反馈没有说明法语作答未满足该要求', elapsedMs: feedback.elapsedMs, renderedText: feedback.renderedText};
            result.capabilityLimitations.push(limitation); record(limitation.id, limitation);
        } else record('practice-followup-feedback', {elapsedMs: feedback.elapsedMs, answerChars: feedback.renderedText.length, actualFeedback: feedback.renderedText});
        const beforeTranslation = result.requests.length; await clickButton(page, '翻译'); await page.waitForTimeout(500);
        snapshot = await shadowSnapshot(page); assert(!attr(find(snapshot.host, n => hasClass(n, 'fr-translation-tooltip')), 'class').includes('fr-reading-tooltip'), '切回翻译未退出学习视图');
        assert(result.requests.length === beforeTranslation, '切回已完成翻译发出了额外网络请求'); await capture(page, 'back-to-real-translation'); record('back-to-translation-no-extra-request');
        for (const [lang, label, name] of args.qualityOnly ? [] : [['en', '用法', 'english-idiom-usage'], ['ja', '词性与句法', 'japanese-phrase-grammar']]) {
            await page.goto(`${fixture}?lang=${lang}`, {waitUntil: 'domcontentloaded'}); await page.waitForTimeout(650); await selectSentence(page, lang);
            await waitUntil(async () => !(await shadowSnapshot(page)).text.includes('正在查询…'), `${lang} 真实翻译未完成`, 60000);
            const answer = await action(page, label, name, sentences[lang]);
            if (lang === 'en') assert(/break|ball/u.test(answer.renderedText), '英语用法未讨论原文惯用语');
            if (lang === 'ja') assert(/雨|ので|読み/u.test(answer.renderedText), '日语回答未讨论原文词组');
        }
        const beforeSettings = result.requests.length;
        await configPage.reload({waitUntil: 'domcontentloaded'}); await configPage.waitForTimeout(650);
        const settingsText = await configPage.locator('body').innerText();
        assert(settingsText.includes('B站翻译 · 免费') && settingsText.includes('无需 API Key') && settingsText.includes('Index-Translate'), '学习设置没有免费服务或固定模型说明');
        assert(await configPage.getByRole('combobox', {name: '学习讲解模型'}).count() === 0, 'B站固定模型仍可随意编辑');
        await configPage.getByLabel('学习讲解模型', {exact: true}).scrollIntoViewIfNeeded(); await capture(configPage, 'settings-fixed-free-model');
        assert(result.requests.length === beforeSettings, '学习设置预览发送了额外模型请求'); record('settings-free-fixed-model-no-extra-request');
        await Promise.allSettled([...pendingCaptures]);
        assert(result.requests.length <= 10, '真实请求超出 10 次限制');
        assert(result.requests.every(item => !item.authHeaderPresent && !item.cookieHeaderPresent && item.status === 200), '匿名真实请求包含认证或没有全部成功');
        assert(result.requests.every(item => JSON.parse(item.body).model === BILIBILI_MODEL), '真实请求没有固定 Index-Translate 模型');
        record('real-anonymous-api-responses', {requestCount: result.requests.length, statuses: result.networkStatuses});
        if (result.renderedAnswers.every(answer => answer.verifiedEvidence.length === 0)) {
            const limitation = {id: 'answer-citation-protocol', status: 'limited', description: '真实回答没有按已有 cite 协议生成可核对引用；不能宣称讲解事实已有引用保障'};
            result.capabilityLimitations.push(limitation); record(limitation.id, limitation);
        }
        result.transportOk = result.consoleErrors.length === 0 && result.requestFailures.length === 0;
        result.ok = result.transportOk && result.capabilityLimitations.length === 0;
    } catch (error) {
        result.error = error.stack || error.message;
        result.failureClass = /真实讲解失败|真实.*未完成|匿名真实请求|真实请求没有/u.test(error.message) ? 'provider-or-runtime' : 'automation-or-ui';
        if (page && !page.isClosed()) {try {await capture(page, 'failure'); fs.writeFileSync(path.join(args.artifactsDir, 'failure-shadow.json'), JSON.stringify((await shadowSnapshot(page)).host, null, 2));} catch {}}
    } finally {
        await Promise.allSettled([...pendingCaptures]);
        result.finishedAt = new Date().toISOString();
        fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), `${JSON.stringify(result, null, 2)}\n`);
        for (const session of sessions) await session.detach().catch(() => {});
        let closeFailed = false;
        try {await close(); result.ownedBrowserClosed = true;}
        catch (error) {closeFailed = true; result.ok = false; result.browserCleanupError = error.message; result.retainedProfile = profile;}
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        if (!closeFailed) {fs.rmSync(profile, {recursive: true, force: true}); result.ownedProfileRemoved = true;}
        fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), `${JSON.stringify(result, null, 2)}\n`);
        process.stdout.write(`${JSON.stringify({ok: result.ok, cases: result.cases.length, requests: result.requests.length, error: result.error, report: path.join(args.artifactsDir, 'report.json')}, null, 2)}\n`);
        if (!result.ok) process.exitCode = 1;
    }
}
main().catch(error => {process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1;});

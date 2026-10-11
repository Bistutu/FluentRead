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
const speechMode = process.argv.includes('--speech');
const demoIndex = process.argv.indexOf('--record-demo'), demoMode = demoIndex >= 0;
const demoArgument = demoMode && process.argv[demoIndex + 1];
const demoDir = path.resolve(demoArgument && !demoArgument.startsWith('--') ? demoArgument : path.join(artifactsDir, 'demo'));
if (demoMode && popupOnly) throw new Error('--record-demo and --popup-only are separate execution scopes');
if (speechMode && (demoMode || popupOnly)) throw new Error('--speech adds production audio assertions to the complete targeted flow; it cannot be combined with demo or Popup-only mode');
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
    executionScope: demoMode ? 'progressive-reading-recorded-demo' : popupOnly ? 'popup-entry-only' : speechMode ? 'progressive-reading-targeted-flow-with-speech' : 'progressive-reading-targeted-flow',
    evidenceBoundary: 'Real production extension, real selection, DOM, trusted CDP keyboard/mouse and Vue Shadow UI in an isolated Edge browser. Local deterministic HTTP translation transport, Popup active-tab lookup and toolbar-close capture are fixtures. No live-provider, Firefox runtime, native-toolbar or human-comprehension claim.',
    reuseBoundary: 'This browser run verifies reuse of a translation already obtained within the same reading session. Reuse of a preexisting bilingual webpage artifact is outside this runner; its pure excerpt matcher is covered separately by unit tests.',
    ownedBrowserClosed: false, profileRemoved: false};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const record = (name, details = {}) => {report.cases.push({...details, name}); console.log(`PASS ${name}`);};
let session, context, control, popup, page, origin, fixtureInfo, browserPid, tabId, speechWorker;
let launchAttempted = false, monitor, monitorTask, monitorBusy = false, stopping = false, focusError;
let demoTarget, demoSurface, demoStepLabel, demoCaptureTask, demoCaptureError, demoCapturing = false;
const cdpSessions = new WeakMap(), ownedCdpSessions = new Set();
const speechContexts = new WeakMap();

// 只生成零 PCM 采样；真实浏览器仍负责解码、媒体时钟和所有播放控制。
function silentSpeechWav(seconds) {
    const rate = 8000, count = Math.round(rate * seconds), buffer = Buffer.alloc(44 + count * 2);
    buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
    buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(count * 2, 40);
    return buffer.toString('base64');
}
async function installSpeechFixture(worker) {
    speechWorker = worker;
    report.speech = {cases: [], samples: [], cleanup: [],
        evidenceBoundary: 'Silent zero-PCM WAV response fixture at the Microsoft token/synthesis transport boundary. Production selectionTts playback:page routing and native page Audio decode, clock, pause/resume, rate, seek and loop remain real. Audio output is muted; no human audition, live TTS provider, voice quality or exact word alignment claim.',
        progressBoundary: 'The fr-speech-current mark is estimated follow text, not an exact word timestamp.'};
    await worker.evaluate(() => {
        const nativeFetch = globalThis.fetch.bind(globalThis);
        globalThis.__readingSpeechFixture = {generation: 0, delayMs: 120, audioBase64: '', error: false, calls: []};
        globalThis.fetch = async (input, init) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.startsWith('https://dev.microsofttranslator.com/apps/endpoint')) {
                return new Response(JSON.stringify({t: 'synthetic-reading-speech-token', r: 'reading-fixture'}), {headers: {'content-type': 'application/json'}});
            }
            if (/^https:\/\/[^/]+\.tts\.speech\.microsoft\.com\/cognitiveservices\/v1(?:\?|$)/u.test(url)) {
                const fixture = globalThis.__readingSpeechFixture, generation = fixture.generation;
                const body = String(init?.body || ''), encoded = /<prosody\b[^>]*>([\s\S]*?)<\/prosody>/u.exec(body)?.[1] || '';
                const source = encoded.replace(/&(amp|lt|gt|quot|apos);/gu, (_, entity) => ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"})[entity]);
                const call = {generation, source, language: /xml:lang="([^"]+)"/u.exec(body)?.[1] || '', at: Date.now(), delayMs: fixture.delayMs, failed: fixture.error, aborted: false};
                fixture.calls.push(call);
                const {audioBase64, error, delayMs} = fixture;
                // 故意让传输晚返回，验证生产 cancellation/generation，而不是夹具替组件吞掉旧结果。
                if (init?.signal?.aborted) call.aborted = true;
                init?.signal?.addEventListener('abort', () => {call.aborted = true;}, {once: true});
                await new Promise(resolve => setTimeout(resolve, delayMs)); call.completedAt = Date.now();
                if (error) return new Response('Controlled silent-WAV synthesis failure', {status: 503});
                return new Response(Uint8Array.from(atob(audioBase64), char => char.charCodeAt(0)), {headers: {'content-type': 'audio/wav'}});
            }
            return nativeFetch(input, init);
        };
    });
    await setSpeechFixture(worker);
}
async function setSpeechFixture(worker, values = {}) {
    const {duration = 20, delayMs = 120, error = false} = values;
    return worker.evaluate(values => {
        const fixture = globalThis.__readingSpeechFixture;
        Object.assign(fixture, values); fixture.generation += 1; return fixture.generation;
    }, {audioBase64: silentSpeechWav(duration), delayMs, error});
}
async function speechCalls(worker) {return worker.evaluate(() => globalThis.__readingSpeechFixture.calls.map(call => ({...call})));}
async function speechUi() {
    return ui(function() {
        const root = this.querySelector('[data-reading-speech]');
        return {status: root?.getAttribute('data-status'), time: this.querySelector('[data-reading-audio-time]')?.textContent?.trim() || '',
            error: this.querySelector('[data-reading-audio-error]')?.textContent?.trim() || '',
            source: this.querySelector('[data-reading-source]')?.textContent?.trim() || '',
            currentMarks: this.querySelectorAll('[data-reading-source] .fr-speech-current').length};
    });
}
async function nativeSpeechAudio() {
    const {cdp} = await snapshot();
    let contexts = speechContexts.get(cdp);
    if (!contexts) {
        contexts = new Map(); speechContexts.set(cdp, contexts);
        cdp.on('Runtime.executionContextCreated', ({context}) => contexts.set(context.id, context));
        cdp.on('Runtime.executionContextDestroyed', ({executionContextId}) => contexts.delete(executionContextId));
        cdp.on('Runtime.executionContextsCleared', () => contexts.clear());
        await cdp.send('Runtime.enable');
    }
    const extensionId = new URL(origin).host;
    const candidates = [...contexts.values()].filter(value => value.auxData?.type === 'isolated'
        && (value.origin?.startsWith(origin) || value.name?.includes(extensionId)));
    assert(candidates.length, `No production content isolated world available for native Audio inspection: ${JSON.stringify([...contexts.values()].map(value => ({name: value.name, origin: value.origin, type: value.auxData?.type})))}`);
    const audios = [];
    for (const candidate of candidates) {
        const objectGroup = `reading-speech-probe-${candidate.id}`;
        try {
            const prototype = await cdp.send('Runtime.evaluate', {expression: 'HTMLAudioElement.prototype', contextId: candidate.id, objectGroup});
            assert(!prototype.exceptionDetails && prototype.result.objectId, 'Native Audio prototype unavailable in the production content world');
            const objects = await cdp.send('Runtime.queryObjects', {prototypeObjectId: prototype.result.objectId, objectGroup});
            const result = await cdp.send('Runtime.callFunctionOn', {objectId: objects.objects.objectId, returnByValue: true,
                functionDeclaration: 'function(){return this.filter(audio => !!audio.getAttribute("src")).map(audio => ({src:audio.src,currentTime:audio.currentTime,duration:Number.isFinite(audio.duration)?audio.duration:null,paused:audio.paused,ended:audio.ended,readyState:audio.readyState,rate:audio.playbackRate,loop:audio.loop,error:audio.error?.code||null}));}'});
            assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
            audios.push(...result.result.value.map(audio => ({...audio, contextId: candidate.id})));
        } finally {await cdp.send('Runtime.releaseObjectGroup', {objectGroup});}
    }
    assert(audios.length <= 1, `The reading page must retain at most one sourced native Audio: ${JSON.stringify(audios)}`);
    return audios;
}
async function speechSample(label) {
    const audio = await nativeSpeechAudio(), panel = (await snapshot()).panel;
    const sample = {label, at: Date.now(), audio, ui: panel ? await speechUi() : null};
    report.speech.samples.push(sample); return sample;
}
async function awaitSpeech(status, label) {await until(async () => (await speechUi()).status === status, label);}
async function activeSpeech(label) {
    await until(async () => {const audio = (await nativeSpeechAudio())[0]; return audio?.duration > 0 && audio.readyState >= 2 && !audio.paused && audio.currentTime > .1;}, label);
    return (await speechSample(label)).audio[0];
}
async function noSpeech(label, settlingMs = 0) {
    if (settlingMs) await wait(settlingMs);
    await until(async () => (await nativeSpeechAudio()).length === 0, label);
    report.speech.cleanup.push(await speechSample(label));
}
async function stoppedSpeech(label) {
    await awaitSpeech('idle', label);
    const sample = await speechSample(label);
    assert(sample.audio.every(audio => audio.paused && audio.currentTime < .08), 'Stop must silence and rewind any retained cached Audio');
    assert.equal(sample.ui.currentMarks, 0, 'Stop must clear estimated follow text');
    return sample;
}
async function speechSource(value) {
    await page.evaluate(value => {document.querySelector('#primary').textContent = value;}, value);
    await capture(value);
}
async function speechRate(value) {
    assert([.75, 1, 1.25, 1.5].includes(value));
    // macOS 原生下拉菜单依赖前台窗口；后台 CDP 仅操作实际 select 的选项和 Vue change 绑定。
    // 这与 WebDriver selectOption 的边界相同，不宣称操作了系统菜单或可信快捷键。
    await ui(function(rate) {
        const select = this.querySelector('[data-reading-rate]');
        if (!select || select.disabled || ![...select.options].some(option => option.value === String(rate))) throw new Error('Missing enabled native rate option');
        select.value = String(rate); select.dispatchEvent(new Event('change', {bubbles: true}));
    }, value);
    report.speech.rateSelections ||= [];
    report.speech.rateSelectionBoundary = 'DOM select value/change through the actual Vue/native-select binding; OS picker and trusted keyboard selection are not tested.';
    report.speech.rateSelections.push({requested: value, selected: await ui(function() {return this.querySelector('[data-reading-rate]').value;})});
    await until(async () => (await nativeSpeechAudio())[0]?.rate === value, `Native playback rate ${value}`);
}
function speechRecord(name, details = {}) {
    report.speech.cases.push({...details, name}); record(name, {scope: 'speech', ...details});
}
async function runSpeechFlow(worker) {
    await installSpeechFixture(worker); await patch({selectionTtsMode: 'online-only'});
    const learningBefore = await vocabulary('list');
    await openReading();
    assert.equal(await ui(function() {return this.querySelector('[data-reading-speech]');}), null, 'No speech controls may fabricate an empty original');
    assert.equal((await speechCalls(worker)).length, 0); await noSpeech('No selected source creates no Audio');
    await capture(SOURCE); assert.equal((await speechCalls(worker)).length, 0, 'Capturing text must not start TTS');
    assert.equal((await speechUi()).status, 'idle');
    assert(await ui(function() {return this.querySelector('[data-reading-listen="translation"]').disabled;}), 'Translation speech must wait for an actual translation');
    const htmlBefore = await page.locator('article').innerHTML();
    await click(has('data-reading-play'), 'explicitly play selected original'); await awaitSpeech('playing', 'Speech enters playing after decoding');
    const decoded = await activeSpeech('native silent WAV decode');
    assert.equal(decoded.duration, 20); assert.equal(decoded.error, null);
    await until(async () => (await speechUi()).currentMarks === 1, 'Estimated follow mark advances on the original');
    assert.equal(await sourceText(), SOURCE); assert.equal(await page.locator('article').innerHTML(), htmlBefore);
    assert.equal((await speechCalls(worker)).length, 1); assert.equal((await speechCalls(worker))[0].source, SOURCE);
    await shot('speech-original-playing', true);
    await click(mode('logic'), 'reading logic during original speech'); await click(mode('original'), 'return to original during speech');
    const afterModeChange = (await speechSample('Help-mode changes preserve original Audio')).audio[0];
    assert(afterModeChange && !afterModeChange.paused && afterModeChange.src === decoded.src, 'Changing reading help must not replace or pause the current original Audio');
    speechRecord('Speech stays inactive until an explicit play gesture; silent WAV decodes and the native media clock advances with estimated follow text', {decoded});

    const callsBeforePause = (await speechCalls(worker)).length;
    await click(has('data-reading-play'), 'pause native playback'); await awaitSpeech('paused', 'Pause status');
    const paused = (await speechSample('paused')).audio[0]; assert(paused?.paused);
    await wait(650); const stillPaused = (await speechSample('pause remains frozen')).audio[0];
    assert(stillPaused?.paused); assert.equal(stillPaused.src, paused.src); assert(Math.abs(stillPaused.currentTime - paused.currentTime) < .08, 'Pause must freeze the actual Audio clock');
    await shot('speech-original-paused', true);
    await click(has('data-reading-play'), 'continue native playback'); await awaitSpeech('playing', 'Continue status');
    await until(async () => {const audio = (await nativeSpeechAudio())[0]; return audio && !audio.paused && audio.src === paused.src && audio.currentTime > paused.currentTime + .2;}, 'Continue from the same native Audio position');
    assert.equal((await speechCalls(worker)).length, callsBeforePause);
    speechRecord('Pause freezes native Audio and continue resumes its existing position without synthesizing again', {paused, stillPaused});

    await click(has('data-reading-play'), 'pause before precise seek assertions'); await awaitSpeech('paused', 'Paused controls');
    for (const rate of [.75, 1, 1.25, 1.5]) {await speechRate(rate); assert((await nativeSpeechAudio())[0].paused);}
    await speechRate(1);
    const beforeSeek = (await speechSample('before seek')).audio[0];
    await click(node => attr(node, 'data-reading-seek') === '5', 'forward five seconds');
    const forward = (await speechSample('forward five seconds')).audio[0]; assert(Math.abs(forward.currentTime - Math.min(beforeSeek.duration, beforeSeek.currentTime + 5)) < .08);
    await click(node => attr(node, 'data-reading-seek') === '-5', 'rewind five seconds');
    const backward = (await speechSample('rewind five seconds')).audio[0]; assert(Math.abs(backward.currentTime - Math.max(0, forward.currentTime - 5)) < .08);
    await click(has('data-reading-restart'), 'restart cached original');
    await until(async () => (await nativeSpeechAudio())[0]?.currentTime < 1.5, 'Restart resets the real audio position');
    await click(has('data-reading-stop'), 'stop before listening to cached original again'); await stoppedSpeech('Cached relisten preparation is quiet');
    await click(node => attr(node, 'data-reading-listen') === 'source', 'listen to cached original again');
    assert.equal((await speechUi()).status, 'idle'); await click(has('data-reading-play'), 'explicit cached relisten');
    await activeSpeech('relisten cached original'); assert.equal((await speechCalls(worker)).length, callsBeforePause);
    speechRecord('Native rate, five-second seeks, restart and listening to the same original reuse synthesized audio', {beforeSeek, forward, backward});

    await click(has('data-reading-stop'), 'stop before loop fixture'); await stoppedSpeech('Explicit stop silences native Audio');
    const loopGeneration = await setSpeechFixture(worker, {duration: 3}); await speechSource('This selected sentence is the silent loop fixture.');
    await click(has('data-reading-loop'), 'enable repeat'); await click(has('data-reading-play'), 'play repeating silent WAV');
    const loopStart = await activeSpeech('loop playback begins'); assert.equal(loopStart.duration, 3);
    await until(async () => (await nativeSpeechAudio())[0]?.currentTime > 2.15, 'Loop reaches the actual media end', 8000);
    await until(async () => {const audio = (await nativeSpeechAudio())[0]; return audio && !audio.paused && audio.currentTime < .9;}, 'Native playback crosses the end and loops to the beginning', 8000);
    const looped = (await speechSample('loop crossed native end')).audio[0];
    assert.equal((await speechCalls(worker)).filter(call => call.generation === loopGeneration).length, 1, 'Repeating native Audio must not synthesize again');
    await click(has('data-reading-loop'), 'disable repeat');
    await until(async () => (await nativeSpeechAudio()).length === 0 || (await nativeSpeechAudio())[0]?.ended, 'Disabling repeat permits the real next media end', 8000);
    speechRecord('Repeat crosses the real WAV end and returns to the beginning without another synthesis', {loopStart, looped});

    await setSpeechFixture(worker); await speechSource(SOURCE);
    await click(has('data-reading-full'), 'prepare the actual translation for speech'); await until(async () => (await translationText()).includes(TRANSLATION), 'Speech translation source');
    await click(node => attr(node, 'data-reading-listen') === 'source', 'select original speech');
    assert.equal((await speechUi()).status, 'idle'); await click(has('data-reading-play'), 'explicitly play original'); await activeSpeech('original playback before kind switch');
    await click(node => attr(node, 'data-reading-listen') === 'translation', 'select translation speech');
    assert.equal((await speechUi()).status, 'idle'); await noSpeech('Selecting the translation is quiet and releases original Audio');
    await click(has('data-reading-play'), 'explicitly play translation'); await activeSpeech('translation replaces original Audio');
    await shot('speech-translation-playing', true);
    const translatedCalls = await speechCalls(worker); assert(translatedCalls.some(call => call.source === TRANSLATION), 'Translation speech must synthesize the displayed translation');
    await click(node => attr(node, 'data-reading-listen') === 'source', 'switch back to original');
    assert.equal((await speechUi()).status, 'idle'); await noSpeech('Selecting original is quiet');
    await click(has('data-reading-play'), 'explicitly replay original'); await activeSpeech('source replaces translation Audio');
    await patch({from: 'fr'}); await noSpeech('Language change cancels the current Audio'); await patch({from: 'en'});
    await setSpeechFixture(worker, {error: true}); await speechSource('This controlled synthesis must fail before a successful retry.');
    await click(has('data-reading-play'), 'controlled synthesis error'); await awaitSpeech('error', 'Speech exposes controlled provider failure');
    assert((await speechUi()).error, 'Speech error must be visible'); await noSpeech('Failed synthesis does not retain Audio');
    await setSpeechFixture(worker); await click(has('data-reading-play'), 'retry controlled synthesis'); await activeSpeech('retry succeeds with real decoder');
    await click(has('data-reading-stop'), 'stop retry'); await stoppedSpeech('Retry stop silences Audio');

    const cancelCases = [
        {name: 'preparing cancel', text: 'Cancel this preparing silent speech request.'},
        {name: 'close', text: 'Close this delayed silent speech request.'},
        {name: 'source change', text: 'Replace this delayed silent speech source.'},
        {name: 'route', text: 'Route away from this delayed silent speech request.'},
        {name: 'disable', text: 'Disable this delayed silent speech request.'},
    ];
    for (const scenario of cancelCases) {
        const generation = await setSpeechFixture(worker, {delayMs: 850});
        await speechSource(scenario.text); await click(has('data-reading-play'), `start delayed ${scenario.name}`);
        await until(async () => (await speechCalls(worker)).some(call => call.generation === generation), `${scenario.name}: synthesis entered fixture`);
        assert.equal((await speechUi()).status, 'preparing');
        if (scenario.name === 'preparing cancel') await click(has('data-reading-play'), 'cancel preparation through the play control');
        else if (scenario.name === 'close') {await click(has('data-reading-close'), 'close delayed speech'); await until(async () => !(await snapshot()).host, 'Delayed speech panel closes');}
        else if (scenario.name === 'source change') await speechSource('This replacement must not inherit the previous silent audio.');
        else if (scenario.name === 'route') {
            await page.evaluate(() => history.pushState({}, '', '/article?speech=route'));
            await until(async () => !(await snapshot()).host, 'Speech route change closes the panel');
        } else {await patch({on: false}); await until(async () => !(await snapshot()).host, 'Speech disable closes the panel');}
        await noSpeech(`${scenario.name}: delayed response cannot create or revive Audio`, 1050);
        if ((await snapshot()).panel) assert.equal((await speechUi()).status, 'idle');
        if (scenario.name === 'disable') {await patch({on: true}); await wait(300);}
        if (!(await snapshot()).panel) await openReading();
    }
    // 活跃音频清理也要覆盖，不能只证明 pending 请求从未创建媒体。
    await setSpeechFixture(worker); await speechSource('Active silent speech must be released when its source changes.');
    await click(has('data-reading-play'), 'start active cleanup source'); await activeSpeech('active cleanup Audio');
    await speechSource('The latest source has no automatic speech.'); await noSpeech('Active source replacement releases Audio');
    speechRecord('Original and translation selection stays quiet until play; failure retry and delayed preparation, close, source, route, disable and language cleanup reject stale playback', {cancellationScenarios: cancelCases.map(item => item.name)});

    await page.setViewportSize({width: 390, height: 800}); await geometry('speech-390');
    await focus(node => attr(node, 'data-reading-listen') === 'source', 'keyboard original speech entry');
    let reachedPlay = false;
    for (let index = 0; index < 12; index += 1) {
        await page.keyboard.press('Tab');
        const focused = await ui(function() {
            const active = this.getRootNode().activeElement, panel = this.getBoundingClientRect(), rect = active?.getBoundingClientRect();
            return {play: !!active?.hasAttribute('data-reading-play'), visible: !!rect && rect.top >= panel.top - 1 && rect.bottom <= panel.bottom + 1 && rect.left >= panel.left - 1 && rect.right <= panel.right + 1};
        });
        if (!focused.play) continue;
        assert(focused.visible, 'The keyboard speech action must scroll fully inside the narrow panel'); reachedPlay = true; break;
    }
    assert(reachedPlay, 'Trusted Tab must reach the speech play control');
    await page.keyboard.press('Enter'); await activeSpeech('390px trusted keyboard starts Audio');
    await page.keyboard.press('Enter'); await awaitSpeech('paused', '390px trusted keyboard pauses Audio'); assert((await nativeSpeechAudio())[0].paused);
    const narrow = await ui(function() {
        const root = this.querySelector('[data-reading-speech]'), box = root.getBoundingClientRect();
        return {width: box.width, horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
            controls: [...root.querySelectorAll('button,select,input')].filter(node => node.getClientRects().length).map(node => {const rect = node.getBoundingClientRect(); return {label: node.getAttribute('aria-label') || node.textContent.trim(), left: rect.left, right: rect.right};}),
            left: box.left, right: box.right, viewportWidth: innerWidth};
    });
    await shot('speech-390-paused', true);
    assert(!narrow.horizontalOverflow && narrow.left >= 0 && narrow.right <= 391, 'The 390px speech group must fit the viewport');
    assert(narrow.controls.every(item => item.left >= narrow.left - 1 && item.right <= narrow.right + 1), 'Speech controls must not be horizontally clipped');
    await click(has('data-reading-stop'), 'stop after keyboard pause'); await stoppedSpeech('Keyboard stop silences cached Audio');
    await click(has('data-reading-close'), 'close speech final panel'); await until(async () => !(await snapshot()).host, 'Speech final panel removed');
    await noSpeech('Final close releases cached Audio');
    assert.deepEqual(await vocabulary('list'), learningBefore, 'Speech listening and controls must not alter learning records');
    report.speech.fixtureRequests = await speechCalls(worker); report.speech.layout = narrow;
    speechRecord('390px speech controls fit without horizontal overflow and trusted Tab/Enter start and pause real Audio without modifying learning records', {narrow});
    await page.setViewportSize({width: 1200, height: 850});
}

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
async function selectPrimary(expected, slowDrag = false) {
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
    if (slowDrag) {
        for (let step = 1; step <= 24; step += 1) {
            await page.mouse.move(points.first.x + (points.last.x - points.first.x) * step / 24, points.first.y + (points.last.y - points.first.y) * step / 24);
            await wait(60);
        }
    } else await page.mouse.move(points.last.x, points.last.y, {steps: 18});
    await page.mouse.up();
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
    // 先激活夹具页再装载 Popup，避免真实 tabs.onActivated 与首个操作争用水合归属。
    await helper.activateExtensionTabWithoutForeground(context, page);
    await popup.reload({waitUntil: 'domcontentloaded'});
    await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
    await popup.locator('[data-testid="progressive-reading"]').click();
    await until(async () => Boolean((await snapshot()).panel), 'Popup opens progressive reading');
    await until(async () => await popup.evaluate(() => window.__progressivePopupCloseInvocations) === 1, 'Successful reading reply requests Popup closure');
    assert.equal(await page.locator('#fluent-read-progressive-reading').count(), 1, 'Reopening must not duplicate the Shadow host');
    assert.equal(await popup.evaluate(() => window.__progressivePopupCloseInvocations), 1, 'Successful reading action must request Popup closure');
    assert.equal(findAll((await snapshot()).host, node => attr(node, 'data-reading-mode') !== undefined).length, 4, 'The panel must offer four direct help modes');
}
async function popupEntryVariant(width, label, longShortcut = false) {
    await popup.setViewportSize({width, height: 650});
    const metrics = await popup.evaluate(() => {
        const shell = document.querySelector('.popup-shell'), shellBox = shell.getBoundingClientRect(), row = document.querySelector('.translate-action');
        return {viewportWidth: innerWidth, platform: navigator.platform, shellWidth: shellBox.width, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 || shell.scrollWidth > shell.clientWidth + 1 || row.scrollWidth > row.clientWidth + 1,
            shortcutChips: row.querySelectorAll('kbd, .translate-hotkey').length,
            legacyTranslationGlyph: !!row.querySelector('.translate-glyph') || row.textContent.includes('A↔译'),
            siteRuleRows: [...document.querySelectorAll('.site-rule-row')].map(rule => {const style = getComputedStyle(rule); return {
                borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
                background: style.backgroundColor, backgroundImage: style.backgroundImage, shadow: style.boxShadow,
            };}),
            buttons: [...row.querySelectorAll('[data-testid="page-translation"], [data-testid="section-translation"], [data-testid="progressive-reading"]')].map(button => {
                const box = button.getBoundingClientRect(), label = button.querySelector('.translate-label') || [...button.querySelectorAll('span')].at(-1), text = label.getBoundingClientRect();
                const captionRange = document.createRange(); captionRange.selectNodeContents(label);
                return {id: button.dataset.testid, text: label.textContent.trim(), title: button.title, ariaLabel: button.getAttribute('aria-label'), captionLines: captionRange.getClientRects().length,
                    left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height,
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
    assert.equal(metrics.shortcutChips, 0, `${label}: shortcuts must share the action caption without a separate kbd chip`);
    assert.equal(metrics.legacyTranslationGlyph, false, `${label}: the legacy A↔译 glyph must be absent`);
    assert(metrics.siteRuleRows.length && metrics.siteRuleRows.every(rule => rule.borderWidths.every(width => parseFloat(width) === 0)
        && ['transparent', 'rgba(0, 0, 0, 0)'].includes(rule.background) && rule.backgroundImage === 'none' && rule.shadow === 'none'),
        `${label}: site rules must have no enclosing border, background or shadow: ${JSON.stringify(metrics.siteRuleRows)}`);
    const [full, section, reading] = metrics.buttons;
    const mac = /Mac|iPod|iPhone|iPad/u.test(metrics.platform), shortcut = longShortcut ? (mac ? '⌃+⌥+⇧+Arrowright' : 'Ctrl+Alt+Shift+Arrowright') : (mac ? '⌥+T' : 'Alt+T');
    assert.equal(full.text, longShortcut ? '翻译' : `翻译（${shortcut}）`, `${label}: compact action caption must retain the default shortcut and use a short label for long combinations`);
    assert.equal(full.title, `翻译当前网页 · ${shortcut}`, `${label}: the real title attribute must retain the complete configured shortcut`);
    assert.equal(full.ariaLabel, '翻译当前网页'); assert.equal(full.captionLines, 1, `${label}: the main caption must remain on one line`);
    assert.equal(reading.text, '学习', `${label}: the reading entry must use the short learning label`);
    assert(metrics.buttons.every(button => button.height <= 44), `${label}: default-skin actions must stay compact at no more than 44px: ${JSON.stringify(metrics.buttons)}`);
    assert.equal([full.id, section.id, reading.id].join(','), 'page-translation,section-translation,progressive-reading');
    assert(Math.abs(full.top - section.top) <= 1 && Math.abs(section.top - reading.top) <= 1 && Math.abs(full.bottom - section.bottom) <= 1
        && Math.abs(section.bottom - reading.bottom) <= 1 && full.right <= section.left + 1 && section.right <= reading.left + 1,
        `${label}: all three actions must share one row, with reading to the right of section: ${JSON.stringify(metrics)}`);
    return metrics;
}
async function popupEntryGeometry() {
    await popupEntryVariant(400, 'popup-400-progressive-entry');
    await popupEntryVariant(320, 'popup-320-progressive-entry');
    const previous = await readConfig();
    await patch({floatingBallHotkey: 'custom', customFloatingBallHotkey: 'Control+Alt+Shift+ArrowRight'});
    await popup.reload({waitUntil: 'domcontentloaded'}); await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
    await popupEntryVariant(320, 'popup-320-long-hotkey', true);
    await popupEntryVariant(400, 'popup-400-long-hotkey', true);
    await patch({floatingBallHotkey: previous.floatingBallHotkey, customFloatingBallHotkey: previous.customFloatingBallHotkey});
    await popup.setViewportSize({width: 400, height: 650});
    record('320px and 400px real Popup documents expose three compact actions in one row, with an inline default shortcut and complete long shortcuts in real title attributes, without separate keycaps, a legacy glyph or site-rule frame', {variants: report.popupLayout});
}
async function learningShortcutFlow(entriesBefore) {
    const initial = await readConfig();
    assert.equal(initial.progressiveReadingHotkey, 'none', 'The fresh profile must have no default learning shortcut');
    assert.equal(initial.customProgressiveReadingHotkey, '', 'The fresh profile must not contain a hidden learning binding');
    // 明确停用夹具悬浮组合，避免把既有 Control 前缀的让行误当作默认关闭的证明。
    await patch({hotkey: 'none'});
    await helper.activateExtensionTabWithoutForeground(context, page);
    await page.mouse.click(5, 5); await page.keyboard.press('Control+Alt+L'); await wait(250);
    assert.equal(Boolean((await snapshot()).host), false, 'The default click-only preference must not open a panel');
    const entry = popup.locator('[data-testid="progressive-reading"]'), help = popup.locator('[data-testid="learning-help"]'), settings = popup.locator('[data-testid="learning-shortcut-settings"]');
    await helper.activateExtensionTabWithoutForeground(context, popup);
    await entry.hover(); await help.waitFor({state: 'visible'});
    assert.equal((await popup.locator('#learning-entry-shortcut').textContent()).trim(), '未设置快捷键 · 点击开启');
    await focusSample('popup-learning-help:before-screenshot');
    const helpScreenshot = path.join(artifactsDir, 'popup-learning-help.png'); await popup.screenshot({path: helpScreenshot}); report.screenshots.push(helpScreenshot);
    await focusSample('popup-learning-help:after-screenshot');
    await popup.mouse.move(5, 5); await help.waitFor({state: 'hidden'});
    await entry.focus(); await help.waitFor({state: 'visible'}); await popup.keyboard.press('Tab');
    assert.equal(await popup.evaluate(() => document.activeElement?.dataset.testid), 'learning-shortcut-settings', 'The settings link must be keyboard reachable inside the help');
    await popup.mouse.move(5, 5); await help.waitFor({state: 'visible'});
    await settings.hover(); await help.waitFor({state: 'visible'});
    await popup.mouse.move(5, 5); await help.waitFor({state: 'visible'});
    await popup.keyboard.press('Escape'); await help.waitFor({state: 'hidden'});
    await popup.mouse.move(5, 5); await entry.hover(); await help.waitFor({state: 'visible'});
    const created = context.waitForEvent('page'); await settings.click(); let options = await created; observe(options);
    await options.setViewportSize({width: 1200, height: 900}); await options.waitForLoadState('domcontentloaded');
    await options.locator('[data-testid="progressive-reading-hotkey"]').waitFor({state: 'visible'});
    await focusSample('learning-settings-default:before-screenshot');
    const settingsScreenshot = path.join(artifactsDir, 'learning-settings-default.png'); await options.screenshot({path: settingsScreenshot}); report.screenshots.push(settingsScreenshot);
    await focusSample('learning-settings-default:after-screenshot');
    const optionsUrl = options.url(); assert.equal(new URL(optionsUrl).searchParams.get('target'), 'progressive-reading'); assert.equal(new URL(optionsUrl).hash, '#settings-translation');
    assert.equal(Boolean((await snapshot()).host), false, 'Opening shortcut settings must not open reading');
    record('Learning defaults to no binding; real hover, keyboard focus, settings-link travel, Escape and reentry reveal help and open its dedicated settings panel', {optionsUrl, helpScreenshot});

    await helper.activateExtensionTabWithoutForeground(context, options);
    await options.locator('[data-testid="progressive-reading-hotkey"]').click();
    await options.locator('.el-select-dropdown:visible').getByRole('option').nth(1).click();
    const dialog = options.locator('.custom-hotkey-dialog'); await dialog.waitFor({state: 'visible'});
    await dialog.locator('.hotkey-input-field').click(); await options.keyboard.press('Control+Alt+L');
    await until(async () => await dialog.locator('.hotkey-display').count() === 1 && await dialog.locator('.primary-button').isEnabled(), 'the real recorder produces an available custom shortcut');
    await dialog.locator('.primary-button').click(); await dialog.waitFor({state: 'hidden'});
    await until(async () => {const config = await readConfig(); return config.progressiveReadingHotkey === 'custom' && config.customProgressiveReadingHotkey === 'Ctrl+Alt+L';}, 'options persists the recorded learning shortcut');
    await options.close(); options = await open(optionsUrl, {width: 1200, height: 900});
    await options.locator('[data-testid="progressive-reading-hotkey-edit"]').waitFor({state: 'visible'});
    await options.locator('[data-testid="progressive-reading-hotkey-edit"]').click(); await options.locator('.custom-hotkey-dialog').waitFor({state: 'visible'});
    const recorded = (await options.locator('.custom-hotkey-dialog .hotkey-display').textContent()).trim();
    assert(/(?:Control|Ctrl)\+(?:Option|Alt)\+L/u.test(recorded), `Reopened settings lost the complete shortcut: ${recorded}`);
    await options.locator('.custom-hotkey-dialog .secondary-button').click();
    await popup.reload({waitUntil: 'domcontentloaded'}); await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
    await entry.hover(); await help.waitFor({state: 'visible'});
    const hint = (await popup.locator('#learning-entry-shortcut').textContent()).trim(); assert(hint.includes(recorded), `Popup shortcut hint is stale: ${hint}`);
    record('A real custom-key recording persists across closing and reopening options and is reflected in the Popup help', {shortcut: 'Ctrl+Alt+L', recorded, hint});

    await helper.activateExtensionTabWithoutForeground(context, page); await page.mouse.click(5, 5);
    await page.keyboard.press('Control+Alt+L'); await until(async () => Boolean((await snapshot()).panel), 'configured shortcut opens the existing reading panel');
    await page.mouse.click(5, 5); await page.keyboard.press('Control+Alt+L');
    assert.equal(await page.locator('#fluent-read-progressive-reading').count(), 1, 'Repeated shortcut opens must share one panel');
    await click(has('data-reading-close'), 'close the shortcut-opened panel'); await until(async () => !(await snapshot()).host, 'close shortcut panel');
    await page.evaluate(() => {const targets = document.createElement('div'); targets.id = 'learning-keyboard-fixture'; targets.innerHTML = '<input aria-label="Keyboard fixture input"><div contenteditable="true" role="textbox" aria-label="Keyboard fixture editor">Editable fixture</div>'; document.body.append(targets);});
    for (const selector of ['input', '[contenteditable]']) {
        await page.locator(`#learning-keyboard-fixture ${selector}`).click(); await page.keyboard.press('Control+Alt+L'); await wait(200);
        assert.equal(Boolean((await snapshot()).host), false, `Learning shortcut must leave ${selector} editing alone`);
    }
    await helper.activateExtensionTabWithoutForeground(context, options); await options.locator('[data-testid="progressive-reading-hotkey-edit"]').click();
    await options.locator('.custom-hotkey-dialog .clear-button').click(); await options.locator('.custom-hotkey-dialog .primary-button').click();
    await until(async () => {const config = await readConfig(); return config.progressiveReadingHotkey === 'none' && config.customProgressiveReadingHotkey === '';}, 'clearing the recorder persists click-only preference');
    await options.close(); await helper.activateExtensionTabWithoutForeground(context, page); await page.mouse.click(5, 5);
    await page.keyboard.press('Control+Alt+L'); await wait(250); assert.equal(Boolean((await snapshot()).host), false, 'Clearing the shortcut must take effect without reloading the article');
    await page.evaluate(() => document.querySelector('#learning-keyboard-fixture').remove());
    await patch({hotkey: initial.hotkey, customHotkey: initial.customHotkey});
    assert.equal(fixture.requests.length, 0, 'Shortcut setup and opening original mode must not call a translation provider');
    assert.deepEqual(await vocabulary('list'), entriesBefore, 'Shortcut setup and use must not write learning records');
    record('The configured shortcut opens one panel, yields to real input and contenteditable focus, and stops responding immediately after the real clear-and-confirm action');
}

// 演示装饰只存在于本机夹具：字幕放在留白，指针跟随真实 CDP 鼠标事件，不替换生产 UI。
async function prepareDemoSurface(target, surface) {
    await target.setViewportSize({width: 660, height: 720});
    await target.evaluate(surface => {
        const caption = document.createElement('div'), cursor = document.createElement('div');
        caption.id = 'progressive-demo-caption'; caption.dataset.fluentReadUi = 'demo-caption';
        caption.style.cssText = `position:fixed;${surface === 'popup' ? 'top:12px;right:16px;width:290px' : 'bottom:16px;left:16px;width:196px'};z-index:2147483647;pointer-events:none;font:600 14px/1.6 system-ui;color:#273347;white-space:pre-wrap`;
        cursor.dataset.fluentReadUi = 'demo-cursor';
        cursor.style.cssText = 'position:fixed;left:0;top:0;width:14px;height:14px;border:2px solid #ef4776;border-radius:50%;background:transparent;z-index:2147483647;pointer-events:none;display:none;transform:translate(-50%,-50%)';
        document.body.append(caption, cursor);
        document.addEventListener('mousemove', event => {document.documentElement.append(cursor); cursor.style.display = 'block'; cursor.style.left = `${event.clientX}px`; cursor.style.top = `${event.clientY}px`;});
        document.addEventListener('mousedown', () => {cursor.style.borderWidth = '4px';});
        document.addEventListener('mouseup', () => {cursor.style.borderWidth = '2px';});
    }, surface);
}
async function demoStep(target, surface, caption, action, pause = 2000) {
    if (focusError || demoCaptureError) throw focusError || demoCaptureError;
    demoTarget = target; demoSurface = surface; demoStepLabel = caption;
    const step = {caption, surface, startedAtMs: Date.now() - report.demo.startedAt, completedAtMs: null}; report.demo.steps.push(step);
    await target.evaluate(caption => {document.querySelector('#progressive-demo-caption').textContent = caption;}, caption);
    if (action) await action();
    await wait(pause); step.completedAtMs = Date.now() - report.demo.startedAt;
    if (focusError || demoCaptureError) throw focusError || demoCaptureError;
}
async function stopDemoCapture() {
    demoCapturing = false;
    if (demoCaptureTask) await demoCaptureTask;
    if (!report.demo) return;
    report.demo.durationMs ??= Date.now() - report.demo.startedAt;
    report.demo.encodedDurationMs = report.demo.frames.length * report.demo.frameDurationMs;
    if (demoCaptureError) report.demo.captureError = demoCaptureError.message;
    fs.writeFileSync(report.demo.timingPath, JSON.stringify(report.demo, null, 2));
}
async function recordDemo(entriesBefore) {
    const framesDir = path.join(demoDir, 'frames'); fs.mkdirSync(framesDir, {recursive: true});
    assert.equal(fs.readdirSync(framesDir).length, 0, `Use an empty demo frame directory: ${framesDir}`);
    report.demo = {startedAt: Date.now(), viewport: {width: 660, height: 720}, fps: 5, frameDurationMs: 200,
        framesDir, framePattern: 'frame-%06d.png', timingPath: path.join(demoDir, 'timing.json'), steps: [], frames: [],
        boundary: 'Separate recorded demonstration, not the 18-case assertion run. Real Popup is rendered in an independent extension test tab at its production width on a 660x720 canvas. Local captions/cursor are presentation aids; responses and active-tab/close handling use the existing deterministic fixtures.'};
    await prepareDemoSurface(popup, 'popup'); await prepareDemoSurface(page, 'webpage');
    demoTarget = popup; demoSurface = 'popup'; demoStepLabel = '1 · Popup 的学习入口'; demoCapturing = true;
    demoCaptureTask = (async () => {
        while (demoCapturing) {
            if (focusError) throw focusError;
            const started = Date.now(), target = demoTarget, surface = demoSurface, step = demoStepLabel;
            const file = path.join(framesDir, `frame-${String(report.demo.frames.length).padStart(6, '0')}.png`);
            await target.screenshot({path: file, timeout: 5000});
            report.demo.frames.push({file, surface, step, atMs: started - report.demo.startedAt});
            await wait(Math.max(0, report.demo.frameDurationMs - (Date.now() - started)));
        }
    })().catch(error => {demoCaptureError = error; demoCapturing = false;});
    try {
        await helper.activateExtensionTabWithoutForeground(context, popup);
        await demoStep(popup, 'popup', '1 · Popup 的学习入口', () => popup.locator('[data-testid="progressive-reading"]').hover());
        await helper.activateExtensionTabWithoutForeground(context, page);
        await popup.locator('[data-testid="progressive-reading"]').click();
        await until(async () => Boolean((await snapshot()).panel), 'demo opens the real reading panel');
        assert.equal(await sourceText(), '');
        await demoStep(page, 'webpage', '2 · 先打开面板\n等待选择正文');
        await demoStep(page, 'webpage', '3 · 在网页中拖选正文', () => selectPrimary(SOURCE, true));
        await demoStep(page, 'webpage', '4 · 点击读取\n默认只读原文', async () => {
            await click(has('data-reading-use-selection'), 'demo reads the selected source');
            await until(async () => (await sourceText()) === SOURCE, 'demo source');
        });
        await demoStep(page, 'webpage', '5 · 短语提示\n按需查看表达', () => click(mode('phrases'), 'demo phrase hints'));
        await demoStep(page, 'webpage', '6 · 逻辑线索\n留意条件、否定与范围', () => click(mode('logic'), 'demo logic clues'));
        await demoStep(page, 'webpage', '7 · 完整双语\n随时直接查看译文', async () => {
            await click(has('data-reading-full'), 'demo complete bilingual');
            await until(async () => (await translationText()).includes(TRANSLATION), 'demo translation');
        });
        await demoStep(page, 'webpage', '8 · 关闭辅助\n继续阅读原网页', async () => {
            await click(has('data-reading-close'), 'demo close');
            await until(async () => !(await snapshot()).host, 'demo closes the real panel');
        });
        assert.deepEqual(await vocabulary('list'), entriesBefore, 'The demo must not change learning records');
        report.demo.learningRecordsUnchanged = true;
    } finally {await stopDemoCapture();}
    if (demoCaptureError) throw demoCaptureError;
}
async function shot(name, panelOnly = false) {
    await focusSample(`${name}:before-screenshot`);
    const file = path.join(artifactsDir, `${name}.png`);
    const clip = panelOnly ? await ui(function() {
        const bounds = this.getBoundingClientRect();
        return {x: Math.max(0, bounds.left), y: Math.max(0, bounds.top), width: Math.min(bounds.width, innerWidth - bounds.left), height: Math.min(bounds.height, innerHeight - bounds.top)};
    }) : undefined;
    await page.screenshot({path: file, ...(clip ? {clip} : {})}); report.screenshots.push(file);
    await focusSample(`${name}:after-screenshot`);
}
async function palette(label, expectedScheme) {
    await until(async () => (await ui(function() {return getComputedStyle(this).colorScheme;})) === expectedScheme, `${label}: applied color scheme`);
    const values = await ui(function() {
        const panel = getComputedStyle(this), selected = getComputedStyle(this.querySelector('[aria-pressed="true"]'));
        return {scheme: panel.colorScheme, background: panel.backgroundColor, ink: panel.color, selectedBackground: selected.backgroundColor, selectedInk: selected.color};
    });
    const luminance = color => {
        const channels = color.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
        assert(channels?.length === 3, `Unrecognized computed color: ${color}`);
        const linear = channels.map(value => {const normalized = value / 255; return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;});
        return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    };
    const background = luminance(values.background), ink = luminance(values.ink);
    values.textContrast = (Math.max(background, ink) + .05) / (Math.min(background, ink) + .05);
    assert(values.textContrast >= 4.5, `${label}: unreadable panel text contrast ${values.textContrast}`);
    assert(expectedScheme === 'dark' ? background < .1 : background > .8, `${label}: theme does not change the actual panel surface`);
    report.palette ||= {}; report.palette[label] = values;
    return values;
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
            browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check', ...(speechMode ? ['--mute-audio'] : [])]});
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
        // 不同义项的收藏专用于验收；操作演示只保留本段相关参考，避免把测试样本误解为当前释义。
        const otherSense = demoMode ? undefined : await vocabulary('upsert', {input: {sourceLanguage: 'en', targetLanguage: 'zh-Hans', term: 'bank', translation: '河岸', kind: 'expression', context: {text: 'They sat on the bank of the river.'}}});
        await vocabulary('setMastery', {entryId: mastered.id});
        if (otherSense) await vocabulary('setMastery', {entryId: otherSense.id});
        const entriesBefore = await vocabulary('list');
        page = await open(fixtureInfo.url, {width: 1200, height: 850});
        await page.locator('#fluent-read-page-styles').waitFor({state: 'attached'});
        tabId = await control.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, fixtureInfo.url);
        const originalHtml = await page.locator('article').innerHTML();
        popup = await openPopup();
        if (demoMode) {
            await recordDemo(entriesBefore);
            assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors));
            await focusSample('demo-completed'); report.ok = true; return;
        }
        await popupEntryGeometry();
        if (popupOnly) {assert.equal(report.consoleErrors.length, 0, JSON.stringify(report.consoleErrors)); await focusSample('popup-only-completed'); report.ok = true; return;}
        await learningShortcutFlow(entriesBefore);
        await openReading();
        assert.equal(await sourceText(), ''); assert.equal(fixture.requests.length, 0);
        assert(await ui(function() {return [...this.querySelectorAll('[data-reading-mode]')].every(button => button.disabled);}), 'Help modes must wait for an explicitly selected source');
        record('Popup entry opens four modes without fabricating a source or requesting translation');
        await capture(SOURCE); await click(mode('original'), 'original'); assert.equal(await selectedMode(), 'original');
        assert.equal(fixture.requests.length, 0); assert.equal(await page.locator('article').innerHTML(), originalHtml);
        assert.equal(await ui(function() {return getComputedStyle(this.querySelector('[data-reading-source]')).userSelect;}), 'text');
        record('Original source remains readable, selectable and unchanged, with no automatic provider call');
        await shot('panel-original', true);
        await click(mode('phrases'), 'phrases');
        await until(async () => (await phraseTerms()).some(item => item.term.toLowerCase() === 'bank'), 'saved learning hints including the unfamiliar bank usage');
        let terms = await phraseTerms();
        assert(terms.some(item => item.term.toLowerCase() === 'take into account'), 'Saved multiword expression must remain eligible for help');
        assert(terms.some(item => item.term.toLowerCase() === 'bank'), 'A mastered word in a different meaning must remain eligible for help');
        assert(!terms.some(item => item.term.toLowerCase() === 'by and large'), 'An explicitly mastered matching expression should retreat');
        assert(find((await snapshot()).panel, has('data-reading-hidden-hints')), 'The reader needs an explicit way to recover omitted known hints');
        assert(/\d+/u.test(text(find((await snapshot()).panel, has('data-reading-hidden-hints')))), 'Known-hint status must state a recoverable omitted count');
        record('Multiword hints use the learning library, matching manual mastery retreats and unfamiliar senses remain available', {terms});
        await shot('panel-phrases', true);
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
        await focus(node => node.nodeName === 'SUMMARY' && (attr(node, 'aria-label') || '').includes('逻辑线索说明'), 'logic explanation keyboard focus');
        await page.keyboard.press('Enter');
        assert(await ui(function() {return this.querySelector('.fr-reading-help').open;}), 'Keyboard Enter must expose the logic-boundary explanation');
        await page.keyboard.press('Enter');
        assert.equal(await ui(function() {return this.querySelector('.fr-reading-help').open;}), false);
        await focus(node => node.nodeName === 'SUMMARY' && (attr(node, 'aria-label') || '').toLowerCase().startsWith('查看 if '), 'conditional clue keyboard focus');
        await page.keyboard.press('Enter');
        assert(await ui(function() {return [...this.querySelectorAll('[data-reading-logic] details')].some(detail => detail.open);}), 'Keyboard Enter must expose the condition-clue explanation');
        record('Logic mode grounds clues in source words, exposes explanations through trusted keyboard input and does not make an additional AI request', {clues});
        await shot('panel-logic', true);
        await page.keyboard.press('Enter');
        await click(has('data-reading-full'), 'one-step complete bilingual');
        await until(async () => (await translationText()).includes(TRANSLATION), 'full bilingual translation');
        assert.equal(fixture.requests.filter(request => request.source === SOURCE).length, 1);
        const afterFull = fixture.requests.length;
        await click(mode('original'), 'original'); await click(mode('bilingual'), 'bilingual');
        await until(async () => (await translationText()).includes(TRANSLATION), 'reuse complete translation');
        assert.equal(fixture.requests.length, afterFull);
        record('One click reaches complete bilingual from logic and mode switches reuse the same reading-session translation', {requests: fixture.requests.slice()});
        await geometry('desktop'); await shot('desktop-bilingual'); await shot('panel-bilingual', true);
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
        await page.setViewportSize({width: 390, height: 800}); await geometry('390-light'); const light = await palette('390-light', 'light'); await shot('390-light-phrases');
        await patch({theme: 'dark'}); await palette('390-dark', 'dark'); await geometry('390-dark'); await shot('390-dark-phrases');
        await patch({theme: 'auto'}); await page.emulateMedia({colorScheme: 'dark'}); await palette('auto-dark', 'dark');
        await page.emulateMedia({colorScheme: 'light'}); const autoLight = await palette('auto-light', 'light');
        assert.equal(autoLight.background, light.background, 'Automatic light mode must use the same reading surface as explicit light mode');
        await patch({theme: 'light'}); await page.emulateMedia({colorScheme: null});
        const modesBeforeResize = await selectedMode(); assert.equal(modesBeforeResize, 'phrases');
        record('390px panel keeps controls inside the viewport, uses readable FluentRead light/dark palettes and follows automatic system-theme changes', {palette: report.palette});
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
        if (speechMode) await runSpeechFlow(worker);
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
        await stopDemoCapture().catch(error => {report.demoStopError = error.message; report.ok = false; process.exitCode = 1;});
        if (speechWorker && report.speech) report.speech.fixtureRequests = await speechCalls(speechWorker).catch(error => ({readError: error.message}));
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
            executionScope: report.executionScope, demo: report.demo && {framesDir: report.demo.framesDir, frames: report.demo.frames.length, frameDurationMs: report.demo.frameDurationMs, viewport: report.demo.viewport},
            ownedBrowserClosed: report.ownedBrowserClosed, profileRemoved: report.profileRemoved}, null, 2));
    }
}
void main();

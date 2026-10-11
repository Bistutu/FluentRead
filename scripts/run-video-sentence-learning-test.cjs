#!/usr/bin/env node
/*
 * Production-extension sentence-learning regression. Fixture cases use a real
 * decoded MP4 and original timed captions, with deterministic HTTP translation.
 * Optional live probes never inject captions or replace platform HTML/media.
 * Every page belongs to a disposable profile, created through focus-safe CDP.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {createRequire} = require('node:module');
const {spawnSync} = require('node:child_process');
const {guardBrowserClose, getGuardedBrowserPid} = require('./testing/owned-browser-close.cjs');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-video-sentence-learning'));
const playwrightRoot = arg('playwright-root', process.env.PLAYWRIGHT_ROOT);
const helperPath = path.resolve(arg('focus-safe-helper', path.join(__dirname, 'testing/focus-safe-browser.cjs')));
const platforms = arg('platforms', 'youtube,x').split(',');
const liveOnly = process.argv.includes('--live-only');
const liveUrls = [
  ...String(arg('live-youtube-urls', arg('live-youtube-url', ''))).split(',').filter(Boolean).map(url => ({platform: 'youtube', url})),
  ...(arg('live-x-url') ? [{platform: 'x', url: arg('live-x-url')}] : []),
];
assert.ok(playwrightRoot, 'Pass --playwright-root');
assert.ok(fs.existsSync(path.join(extensionDir, 'manifest.json')), 'Build the production extension first');
assert.ok(platforms.every(platform => ['youtube', 'x'].includes(platform)), '--platforms accepts youtube,x');
assert.ok(!liveOnly || liveUrls.length, '--live-only requires a live URL');
const helper = require(helperPath);
const {chromium} = createRequire(path.join(playwrightRoot, 'video-sentence-proof.cjs'))('playwright');
fs.mkdirSync(artifacts, {recursive: true});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-sentence-learning-'));
const report = {
  success: false,
  evidence: 'Production extension; real local MP4 clock; original timed-caption fixtures; deterministic translation; actual live probes reported separately',
  fixtureCases: [], liveCases: [], pageErrors: [], cleanup: {},
};
const cues = [
  {startMs: 0, durationMs: 1000, text: 'Sea otters'},
  {startMs: 1000, durationMs: 1500, text: 'have strong teeth.'},
  {startMs: 3000, durationMs: 1000, text: 'They use'},
  {startMs: 4000, durationMs: 1500, text: 'rocks to open shells.'},
  {startMs: 6000, durationMs: 1000, text: '它们生活在海洋里。'},
  {startMs: 8000, durationMs: 1000, text: 'A quiet final sentence.'},
];
const translations = {
  'Sea otters': '海獭',
  'have strong teeth.': '有强有力的牙齿。',
  'They use': '它们使用',
  'rocks to open shells.': '石头打开贝壳。',
  'Sea otters have strong teeth.': '海獭有强有力的牙齿。',
  'They use rocks to open shells.': '它们用石头打开贝壳。',
  'A quiet final sentence.': '安静的最后一句。',
};
let session;
let context;
let worker;
let control;
let page;
let extensionId;
let configSequence = 0;
let focusMonitor;
let browserPid;
let focusFailure;
let explanationServer;
const explanationRequests = [];
const pendingExplanations = [];
let currentPhase = 'initializing';
const check = (result, name, details) => {
  currentPhase = `${result.platform}: ${name}`;
  result.checks.push({name, pass: true, ...(details ? {details} : {})});
  process.stdout.write(`${currentPhase}\n`);
};
const action = name => page.locator(`#fluent-read-video-learning-panel [data-learning-action="${name}"]`);
const fieldDisplay = kind => page.locator(`#fluent-read-video-learning-panel [data-learning-${kind}-display]`);
async function editField(kind, value) {
  await action(`edit-${kind}`).click();
  await page.locator(`[data-learning-${kind}]`).fill(value);
  await action(`done-${kind}`).click();
}
const current = () => page.evaluate(() => {
  const panel = document.querySelector('#fluent-read-video-learning-panel');
  const sentence = panel?.querySelector('[data-learning-sentence-id]');
  const video = document.querySelector('video');
  return {text: sentence?.textContent?.replace(/\s+/g, ' ').trim(), sentenceId: sentence?.dataset.learningSentenceId,
    index: sentence?.dataset.learningSentenceIndex, startMs: sentence?.dataset.startMs, endMs: sentence?.dataset.endMs,
    paused: video?.paused, time: video?.currentTime, rate: video?.playbackRate, seeking: video?.seeking,
    loop: panel?.querySelector('[data-learning-action="loop"]')?.getAttribute('aria-pressed'),
    pauseAtEnd: panel?.querySelector('[data-learning-action="pause-at-end"]')?.getAttribute('aria-pressed'),
    pinned: sentence?.dataset.learningPinned,
    translation: panel?.querySelector('[data-learning-translation]')?.value ?? panel?.querySelector('[data-learning-translation-display]')?.textContent?.trim(),
    sourceStatus: document.querySelector('[data-source-status]')?.textContent};
});
const seek = async time => {
  await page.evaluate(time => {document.querySelector('video').currentTime = time;}, time);
  await page.waitForFunction(() => !document.querySelector('video').seeking);
};
async function patchConfig(patch) {
  const result = await control.evaluate(async ({patch, sequence}) => {
    const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!read.success) throw new Error('Cannot read test profile configuration');
    const current = typeof read.value === 'string' ? JSON.parse(read.value) : read.value || {};
    return chrome.runtime.sendMessage({type: 'persistConfig', clientId: 'sentence-learning-proof', sequence,
      config: {...current, ...patch}, ...(Number.isSafeInteger(current.__fluentConfigRevision) ? {baseRevision: current.__fluentConfigRevision} : {})});
  }, {patch, sequence: ++configSequence});
  assert.equal(result.success, true, JSON.stringify(result));
}
async function incrementCount(label) {
  const result = await control.evaluate(label => chrome.runtime.sendMessage({type: 'incrementConfigCount', delta: 1,
    operationId: `sentence-count-${label}-${crypto.randomUUID()}`}), label);
  assert.equal(result.success, true, JSON.stringify(result));
}
async function capture(name, result) {
  const screenshot = path.join(artifacts, `${name}.png`);
  const dom = path.join(artifacts, `${name}.html`);
  await page.screenshot({path: screenshot});
  fs.writeFileSync(dom, await page.content());
  (result.captures ||= []).push({screenshot, dom});
}
async function openLearning() {
  if (await page.locator('#fluent-read-video-learning-panel').isVisible().catch(() => false)) return;
  await page.locator('#fluent-read-video-subtitle-button').click();
  await page.locator('[data-action="open-sentence-learning"]').click();
  await page.locator('#fluent-read-video-learning-panel').waitFor({state: 'visible'});
}
function fixtureHtml(platform, mediaData) {
  const video = `<video ${platform === 'youtube' ? 'class="html5-main-video"' : ''} muted src="data:video/mp4;base64,${mediaData}" style="width:100%;height:100%"></video>`;
  const controls = platform === 'youtube'
    ? '<div id="ytp-caption-window-container"><span class="ytp-caption-segment">Sea otters</span></div><div class="ytp-right-controls"><button aria-label="Settings">⚙</button><button aria-label="Full screen">⛶</button></div>'
    : '<div class="fixture-controls"><button aria-label="Play">▶</button><span style="flex:1">0:00 / 0:18</span><div class="fixture-actions"><button aria-label="Captions">▣</button><button aria-label="Settings">⚙</button><div id="fixture-pip"><button aria-label="Picture in picture">▣</button></div><div id="fixture-fullscreen"><button aria-label="Full screen">⛶</button></div></div></div>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sentence learning ${platform} fixture</title><style>
    body{margin:24px;background:#eef2f8;font:18px Arial}#movie_player,[data-testid=videoPlayer]{position:relative;width:960px;height:540px;overflow:hidden;background:#153047;color:white}
    #movie_player:fullscreen,[data-testid=videoPlayer]:fullscreen{width:100vw;height:100vh}.ytp-right-controls,.fixture-controls{position:absolute;bottom:4px;left:12px;right:12px;display:flex;align-items:center;justify-content:flex-end;height:36px;z-index:30}.fixture-actions{display:flex}.ytp-right-controls button,.fixture-controls button{width:32px;height:32px;padding:0;border:0;background:#243a50;color:white}
    #ytp-caption-window-container{position:absolute;left:0;right:0;bottom:56px;text-align:center;font-size:26px}
    </style></head><body><h1>视频句子学习验收</h1><article>${platform === 'x' ? '<a class="fixture-source" href="/fluentread/status/424243">原帖子</a>' : ''}<div ${platform === 'youtube' ? 'id="movie_player" class="html5-video-player"' : 'data-testid="videoPlayer"'}>${video}${controls}</div></article></body></html>`;
}
async function injectCaptions(platform, captionCues, mediaId) {
  await page.evaluate(({platform, captionCues, mediaId}) => {
    if (platform === 'youtube') {
      window.postMessage({source: 'fluent-read', type: 'fluent-read-youtube-timedtext',
        url: `https://www.youtube.com/api/timedtext?v=${mediaId}&lang=en`,
        responseText: JSON.stringify({events: captionCues.map(cue => ({tStartMs: cue.startMs, dDurationMs: cue.durationMs, segs: [{utf8: cue.text}]}))})}, location.origin);
    } else {
      const stamp = ms => {const date = new Date(ms);return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;};
      window.postMessage({source: 'fluent-read', type: 'fluent-read-x-video-subtitle-resource', pageHref: location.href,
        url: `https://video.twimg.com/ext_tw_video/${mediaId}/pu/captions/en.vtt`,
        responseText: `WEBVTT\n\n${captionCues.map(cue => `${stamp(cue.startMs)} --> ${stamp(cue.startMs + cue.durationMs)}\n${cue.text}`).join('\n\n')}\n`}, location.origin);
    }
  }, {platform, captionCues, mediaId});
}
async function runFixture(platform, mediaData) {
  currentPhase = `${platform}: creating fixture`;
  const result = {platform, source: 'controlled platform HTML, original timed captions and real local media; deterministic translation', checks: []};
  report.fixtureCases.push(result);
  const mediaId = platform === 'youtube' ? 'frSentence1' : '424243';
  const url = platform === 'youtube' ? `https://www.youtube.com/watch?v=${mediaId}` : `https://x.com/fluentread/status/${mediaId}`;
  await context.route(url, route => route.fulfill({contentType: 'text/html', body: fixtureHtml(platform, mediaData)}));
  page = await helper.newPageWithoutForeground(context);
  await page.goto(url);
  await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.locator('#fluent-read-video-subtitle-button').waitFor();
  await injectCaptions(platform, cues, mediaId);
  await openLearning();
  await page.waitForFunction(() => document.querySelector('[data-learning-sentence-id]')?.textContent.includes('Sea otters have strong teeth.'));
  await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.textContent.trim() === '海獭有强有力的牙齿。');
  let state = await current();
  const style = await page.locator('#fluent-read-video-learning-panel section').evaluate(element => {
    const computed = getComputedStyle(element);
    return {fontSize: computed.fontSize, background: computed.backgroundColor, borderRadius: computed.borderRadius,
      translationDisplay: getComputedStyle(element.querySelector('[data-learning-translation-display]')).display,
      editors: element.querySelectorAll('[data-learning-translation], [data-learning-explanation]').length};
  });
  assert.equal(style.fontSize, '13px');
  assert.notEqual(style.background, 'rgba(0, 0, 0, 0)');
  assert.equal(style.translationDisplay, 'block');
  assert.equal(style.editors, 0, 'Translation and explanation start in reading mode');
  check(result, 'Production content-script styles keep the learning panel readable independently of host CSS', style);
  assert.equal(Number(state.startMs), 0);
  assert.equal(Number(state.endMs), 2500);
  assert.equal(state.paused, true);
  check(result, 'Two source cues become one complete sentence with original 0–2500 ms timing and preserve paused playback', state);
  if (platform === 'youtube') {
    await injectCaptions(platform, [{startMs: 0, durationMs: 2000, text: 'A stale video must not own this sentence.'}], 'frSentence9');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-learning-original]').textContent(), 'Sea otters have strong teeth.');
    assert.equal(Number((await current()).endMs), 2500);
    check(result, 'A late timed-caption response from a different YouTube video cannot replace the current original timeline');
  }
  await page.evaluate(() => {
    window.fixturePlayerKeys = 0;
    document.querySelector('#movie_player, [data-testid=videoPlayer]').addEventListener('keydown', () => window.fixturePlayerKeys++);
    document.querySelector('#fluent-read-video-learning-panel section').focus();
  });
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[data-learning-sentence-id]')?.textContent.includes('They use rocks to open shells.'));
  state = await current();
  assert.equal(Number(state.startMs), 3000);
  assert.equal(Number(state.endMs), 5500);
  assert.equal(state.paused, true);
  assert.equal(await page.evaluate(() => window.fixturePlayerKeys), 0);
  check(result, 'Next complete sentence retains source interval and nearby context without implicitly playing', state);
  await action('next').click();
  await page.waitForFunction(() => document.querySelector('[data-learning-original]')?.textContent === '它们生活在海洋里。');
  await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.textContent.trim() === '它们生活在海洋里。');
  assert.equal(await worker.evaluate(() => globalThis.sentenceFixtureRequests.includes('它们生活在海洋里。')), false);
  check(result, 'A Chinese source sentence keeps its own original timing and avoids a same-target provider call', await current());
  await action('previous').click();
  await action('previous').click();
  await action('loop').click();
  assert.equal(await action('loop').getAttribute('aria-pressed'), 'true');
  await incrementCount(`${platform}-loop`);
  await page.waitForTimeout(300);
  assert.equal(await action('loop').getAttribute('aria-pressed'), 'true');
  check(result, 'Unrelated translation-count broadcasts do not release the user loop');
  await page.evaluate(() => {document.querySelector('video').playbackRate = 2;});
  await action('play').click();
  await page.waitForFunction(() => document.querySelector('video').currentTime > 2, null, {timeout: 8000});
  await page.waitForFunction(() => document.querySelector('video').currentTime < .6, null, {timeout: 8000});
  state = await current();
  assert.equal(state.rate, 2);
  assert.equal(state.paused, false);
  assert.equal(state.pinned, 'true', 'Replay-owned seeking must retain the explicit sentence selection');
  check(result, 'A real media clock crosses the sentence end and loops to its original start, retaining user playback rate', state);
  await page.evaluate(() => document.querySelector('video').pause());
  const pausedAt = (await current()).time;
  await page.waitForTimeout(450);
  state = await current();
  assert.equal(state.paused, true);
  assert.ok(Math.abs(state.time - pausedAt) < .08);
  check(result, 'User pause remains authoritative while a loop is armed', state);
  await action('normal').click();
  state = await current();
  assert.equal(state.loop, 'false');
  assert.equal(state.pauseAtEnd, 'false');
  assert.equal(state.paused, true);
  assert.ok(Math.abs(state.time - pausedAt) < .08);
  check(result, 'Closing playback assistance clears its mode without implicitly playing a user-paused video', state);
  await action('loop').click();
  await seek(7.4);
  await page.waitForTimeout(350);
  state = await current();
  assert.equal(state.loop, 'false');
  assert.ok(Math.abs(state.time - 7.4) < .08);
  check(result, 'User seek outside the active sentence releases repeat control', state);
  // A user seek into a silent gap may retain the selected sentence.
  for (let count = 0; count < 8 && Number((await current()).startMs) !== 0; count++) await action('previous').click();
  await action('pause-at-end').click();
  assert.equal(await action('pause-at-end').getAttribute('aria-pressed'), 'true');
  await action('play').click();
  await page.waitForFunction(() => document.querySelector('video').paused && document.querySelector('video').currentTime >= 2.45, null, {timeout: 8000});
  state = await current();
  assert.ok(state.time <= 2.65, JSON.stringify(state));
  check(result, 'Sentence-end pause stops the real media clock at the source boundary', state);
  await action('pause-at-end').click();
  await action('play').click();
  await page.waitForFunction(() => document.querySelector('video').currentTime > 2.8, null, {timeout: 8000});
  check(result, 'Turning off end pause restores uninterrupted playback', await current());
  await page.evaluate(() => document.querySelector('video').pause());
  for (let count = 0; count < 8 && Number((await current()).startMs) !== 0; count++) await action('previous').click();
  const explanationsBefore = explanationRequests.length;
  await action('explain').click();
  await page.waitForFunction(() => document.querySelector('[data-learning-explanation-display]')?.textContent.includes('strong teeth'));
  if (await fieldDisplay('explanation').getAttribute('aria-busy') === 'true') {
    await incrementCount(`${platform}-explanation`);
    await page.waitForTimeout(300);
    assert.equal(await fieldDisplay('explanation').getAttribute('aria-busy'), 'true', 'Count broadcast must not cancel an in-flight explanation');
    check(result, 'Unrelated translation-count broadcasts leave an in-flight explanation owned by the current sentence');
    pendingExplanations.splice(0).forEach(resolve => resolve());
  }
  await page.waitForFunction(() => document.querySelector('[data-learning-explanation-display]')?.textContent.includes('strong teeth') && document.querySelector('[data-learning-explanation-display]').getAttribute('aria-busy') !== 'true');
  assert.ok(explanationRequests.length >= 1 && explanationRequests.length <= explanationsBefore + 1, 'Explanation may reuse the existing cache but must not duplicate provider calls');
  assert.ok(JSON.stringify(explanationRequests.at(-1).messages).includes('Sea otters have strong teeth.'));
  assert.ok(JSON.stringify(explanationRequests.at(-1).messages).includes('They use rocks to open shells.'));
  check(result, 'The existing reading service explains the complete source sentence with permitted neighboring caption context', {transport: 'local deterministic OpenAI-compatible SSE', explanation: await fieldDisplay('explanation').textContent()});
  await seek(1.8);
  await action('edit-translation').click();
  assert.equal((await current()).pinned, 'true', 'Entering edit mode pins the sentence before the first keystroke');
  await page.waitForFunction(() => document.activeElement === document.querySelector('[data-learning-translation]'));
  const editorStyle = await page.locator('[data-learning-translation]').evaluate(element => ({display: getComputedStyle(element).display, fontSize: getComputedStyle(element).fontSize}));
  assert.equal(editorStyle.display, 'block');
  assert.equal(editorStyle.fontSize, '13px');
  await page.evaluate(() => document.querySelector('video').play());
  await page.waitForFunction(() => document.querySelector('video').currentTime > 3.2, null, {timeout: 8000});
  await page.evaluate(() => document.querySelector('video').pause());
  assert.equal(Number((await current()).startMs), 0);
  assert.equal(await page.locator('[data-learning-translation]').evaluate(element => document.activeElement === element), true);
  check(result, 'Editing pins the complete sentence before typing and preserves editor focus when real playback reaches the next sentence', {...await current(), editorStyle});
  await page.locator('[data-learning-translation]').fill('海獭有坚硬的牙齿（已确认）。');
  await action('done-translation').click();
  await editField('explanation', 'strong teeth 描述用于咬开食物的坚硬牙齿（已确认）。');
  await action('follow').click();
  await page.waitForFunction(() => document.querySelector('[data-learning-original]')?.textContent === 'They use rocks to open shells.');
  assert.equal((await current()).pinned, 'false');
  check(result, 'Following playback returns the learning selection to the current media sentence', await current());
  await action('previous').click();
  await action('next').click();
  await action('previous').click();
  assert.equal((await current()).pinned, 'true');
  assert.equal((await current()).translation, '海獭有坚硬的牙齿（已确认）。');
  assert.equal((await fieldDisplay('explanation').textContent()).trim(), 'strong teeth 描述用于咬开食物的坚硬牙齿（已确认）。');
  check(result, 'Explicit stepping preserves its selection and returns to the same sentence translation/explanation drafts');
  await action('collapse').click();
  assert.equal(await page.locator('[data-learning-original]').isVisible().catch(() => false), false);
  assert.equal(await action('collapse').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#fluent-read-video-learning-panel').evaluate(host => {
    const rect = host.getBoundingClientRect();
    return host.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 4));
  }), false, 'The transparent area below the collapsed card must not intercept media input');
  await action('collapse').click();
  await page.locator('[data-learning-original]').waitFor({state: 'visible'});
  assert.equal((await current()).translation, '海獭有坚硬的牙齿（已确认）。');
  assert.equal((await fieldDisplay('explanation').textContent()).trim(), 'strong teeth 描述用于咬开食物的坚硬牙齿（已确认）。');
  check(result, 'Collapsing and expanding the learning body preserves the selected sentence and confirmed drafts');
  await action('save').click();
  const readEntry = () => control.evaluate(() => chrome.runtime.sendMessage({type: 'fluentReadVocabularyBook', action: 'getByTerm', sourceLanguage: 'en', term: 'Sea otters have strong teeth.'}));
  let saved;
  for (let attempt = 0; attempt < 50; attempt++) {
    saved = await readEntry();
    if (saved.success && saved.data) break;
    await page.waitForTimeout(50);
  }
  assert.ok(saved.success && saved.data, JSON.stringify(saved));
  const entry = saved.data;
  assert.equal(entry.kind, 'sentence');
  assert.equal(entry.sourceLanguage, 'en', 'The stored source language follows the actual English caption track instead of the auto setting');
  assert.equal(entry.note, 'strong teeth 描述用于咬开食物的坚硬牙齿（已确认）。');
  assert.ok(JSON.stringify(entry.translations).includes('海獭有坚硬的牙齿（已确认）。'));
  assert.ok(entry.contexts.some(context => context.pageTitle.includes('Sentence learning') && context.text.includes('They use rocks')));
  assert.ok(entry.contexts.some(context => context.video?.platform === platform && context.video.startMs === 0 && context.video.endMs === 2500 && context.sourceUrl === url));
  await action('save').click();
  await page.waitForTimeout(100);
  const repeated = await readEntry();
  assert.equal(repeated.data.id, entry.id);
  assert.equal(repeated.data.contexts.length, entry.contexts.length);
  check(result, 'An explicit save preserves confirmed translation, title, neighboring context and stable deduplication identity', repeated.data);
  const originalRequests = await worker.evaluate(() => globalThis.sentenceFixtureRequests.filter(text => text === 'Sea otters have strong teeth.').length);
  await editField('translation', '');
  assert.equal(await action('save').isDisabled(), true, 'A blank translation must not be saved');
  await action('next').click();
  await action('previous').click();
  await page.waitForTimeout(300);
  assert.equal((await current()).translation, '');
  assert.equal(await fieldDisplay('translation').getAttribute('aria-busy'), 'false');
  assert.equal(await worker.evaluate(() => globalThis.sentenceFixtureRequests.filter(text => text === 'Sea otters have strong teeth.').length), originalRequests);
  check(result, 'A blank edited translation disables collection and remains an intentional draft after stepping away and back');
  await editField('translation', '海獭有坚硬的牙齿（已确认）。');
  await action('edit-explanation').click();
  await page.locator('[data-learning-explanation]').fill('');
  assert.equal(await page.locator('[data-learning-explanation]').isVisible(), true);
  assert.equal(await page.locator('[data-learning-explanation]').evaluate(element => document.activeElement === element), true);
  await action('save').click();
  let cleared;
  for (let attempt = 0; attempt < 50; attempt++) {
    cleared = await readEntry();
    if (cleared.success && cleared.data?.note === '') break;
    await page.waitForTimeout(50);
  }
  assert.equal(cleared.data?.note, '');
  assert.equal(await page.locator('[data-learning-explanation]').isVisible(), true);
  check(result, 'Clearing explanation keeps its focused editor mounted and an explicit save removes the existing persisted note');
  await page.locator('[data-learning-explanation]').fill('strong teeth 描述用于咬开食物的坚硬牙齿（已确认）。');
  await action('done-explanation').click();
  await action('save').click();
  for (let attempt = 0; attempt < 50; attempt++) {
    const restored = await readEntry();
    if (restored.success && restored.data?.note === 'strong teeth 描述用于咬开食物的坚硬牙齿（已确认）。') break;
    await page.waitForTimeout(50);
  }
  const player = page.locator('#movie_player, [data-testid=videoPlayer]');
  const previousStyle = await player.getAttribute('style');
  await player.evaluate(element => {element.style.width = '390px';element.style.height = '260px';});
  await page.locator('[data-learning-original]').scrollIntoViewIfNeeded();
  await action('play-compact').waitFor({state: 'visible'});
  await action('play-compact').click();
  await page.waitForFunction(() => !document.querySelector('video').paused && document.querySelector('video').currentTime > .1);
  await page.evaluate(() => document.querySelector('video').pause());
  await action('save').scrollIntoViewIfNeeded();
  const compact = await page.evaluate(() => {
    const host = document.querySelector('#fluent-read-video-learning-panel');
    const player = document.querySelector('#movie_player, [data-testid=videoPlayer]');
    const button = host.querySelector('[data-learning-action="save"]');
    const body = host.querySelector('.fr-video-learning-body');
    const original = host.querySelector('[data-learning-original]');
    const rect = element => element.getBoundingClientRect().toJSON();
    const point = button.getBoundingClientRect();
    return {panel: rect(host), player: rect(player), body: rect(body), original: rect(original), overflowX: host.scrollWidth > host.clientWidth + 1,
      overflowY: getComputedStyle(host).overflowY, saveVisible: host.contains(document.elementFromPoint(point.left + point.width / 2, point.top + point.height / 2))};
  });
  assert.ok(compact.panel.left >= compact.player.left && compact.panel.right <= compact.player.right + 1);
  assert.ok(compact.panel.bottom <= compact.player.bottom - 48 && !compact.overflowX && compact.saveVisible, JSON.stringify(compact));
  assert.equal(compact.overflowY, 'auto');
  assert.ok(compact.original.top >= compact.body.top && compact.original.bottom <= compact.body.bottom + 1, 'The complete original sentence must fit the visible compact reading body');
  const compactScreenshot = path.join(artifacts, `${platform}-learning-compact.png`);
  await player.screenshot({path: compactScreenshot});
  check(result, 'A 390px player keeps learning inside its bounds with scrollable content, reachable saving and space for native controls', {...compact, screenshot: compactScreenshot});
  await player.evaluate((element, saved) => saved === null ? element.removeAttribute('style') : element.setAttribute('style', saved), previousStyle);
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Runtime.evaluate', {expression: 'document.querySelector("#movie_player, [data-testid=videoPlayer]").requestFullscreen()', userGesture: true, awaitPromise: true});
  } finally {await cdp.detach();}
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  assert.equal(await page.locator('#fluent-read-video-learning-panel').isVisible(), true);
  await capture(`${platform}-fullscreen`, result);
  check(result, 'Learning remains accessible in real browser fullscreen');
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await capture(`${platform}-learning`, result);
  await fieldDisplay('explanation').scrollIntoViewIfNeeded();
  await capture(`${platform}-learning-explanation`, result);
  await action('loop').click();
  await action('close').click();
  await page.locator('#fluent-read-video-learning-panel').waitFor({state: 'detached'});
  await page.waitForFunction(() => document.activeElement === document.querySelector('#fluent-read-video-subtitle-button'));
  check(result, 'Closing learning restores keyboard focus to the FluentRead video entry');
  await seek(1.8);
  await page.evaluate(() => document.querySelector('video').play());
  await page.waitForFunction(() => document.querySelector('video').currentTime > 3, null, {timeout: 8000});
  check(result, 'Closing learning removes repeat/end-pause ownership so normal playback crosses the old boundary', await current());
  await page.evaluate(() => document.querySelector('video').pause());
  await openLearning();
  for (let count = 0; count < 8 && Number((await current()).startMs) !== 3000; count++) {
    await action(Number((await current()).startMs) < 3000 ? 'next' : 'previous').click();
  }
  await editField('translation', '它们用石头打开贝壳（已确认）。');
  await action('save').click();
  await page.waitForTimeout(100);
  const learning = await helper.newPageWithoutForeground(context);
  await learning.goto(`chrome-extension://${extensionId}/options.html#settings-vocabulary`);
  await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, learning);
  await learning.locator('.entry-open').filter({hasText: 'They use rocks to open shells.'}).click();
  const expectedHref = platform === 'youtube' ? `${url}&t=3s` : `${url}#fluentread-video=3000,5500`;
  const link = learning.locator(`.vocabulary-source a[href="${expectedHref}"]`);
  await link.waitFor({state: 'visible'});
  assert.ok((await link.textContent()).includes('00:03–00:05'));
  const sourceScreenshot = path.join(artifacts, `${platform}-learning-center-source.png`);
  await learning.screenshot({path: sourceScreenshot});
  check(result, 'The existing learning center renders the reliable source link with the original sentence interval', {href: await link.getAttribute('href'), screenshot: sourceScreenshot});
  const unavailable = await control.evaluate(platform => chrome.runtime.sendMessage({type: 'fluentReadVocabularyBook', action: 'upsert',
    input: {sourceLanguage: 'en', targetLanguage: 'zh-Hans', term: 'A sentence from an unavailable source.', kind: 'sentence', translation: '来源暂不可恢复。',
      context: {text: 'A sentence from an unavailable source.', pageTitle: 'Local source fixture', video: {platform, startMs: 4000, endMs: 6500}}}}), platform);
  assert.equal(unavailable.success, true);
  await learning.reload();
  await learning.locator('.entry-open').filter({hasText: 'A sentence from an unavailable source.'}).click();
  await learning.waitForFunction(() => document.querySelector('.word-study .vocabulary-source')?.textContent.includes('没有可跳转的原始地址'));
  assert.equal(await learning.locator('.word-study .vocabulary-source a').count(), 0);
  check(result, 'A source without a reliable URL preserves title/time and gives a recovery state without fabricating a link', {text: await learning.locator('.word-study .vocabulary-source').textContent()});
  await learning.close();
  await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
  if (platform === 'x') {
    await page.goto(expectedHref);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('video').seeking && Math.abs(document.querySelector('video').currentTime - 3) < .08);
    check(result, 'Returning from the X learning source restores the saved start using production fragment recovery', await current());
    await injectCaptions(platform, cues, mediaId);
    await openLearning();
  }
  await action('loop').click();
  await page.evaluate(() => {
    const video = document.querySelector('video');
    window.fixtureDetachedVideo = video;
    video.replaceWith(video.cloneNode(true));
  });
  await page.locator('#fluent-read-video-learning-panel').waitFor({state: 'detached'});
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert.equal(await page.locator('#fluent-read-video-subtitle-button').count(), 1);
  await seek(1.8);
  await page.evaluate(() => document.querySelector('video').play());
  await page.waitForFunction(() => document.querySelector('video').currentTime > 3, null, {timeout: 8000});
  check(result, 'Rebuilding the player detaches learning ownership and keeps one video control; the replacement plays through the old range', await current());
  await page.evaluate(() => document.querySelector('video').pause());
  await injectCaptions(platform, cues, mediaId);
  await openLearning();
  await action('loop').click();
  const nextMediaId = platform === 'youtube' ? 'frSentence2' : '424244';
  const nextUrl = platform === 'youtube' ? `https://www.youtube.com/watch?v=${nextMediaId}` : `https://x.com/fluentread/status/${nextMediaId}`;
  const nextText = `New ${platform} video owns this sentence.`;
  await worker.evaluate(nextText => {globalThis.sentenceFixtureHoldText = nextText;}, nextText);
  await page.evaluate(({nextUrl, mediaData, nextText}) => {
    history.pushState({}, '', nextUrl);
    const source = document.querySelector('.fixture-source');
    if (source) source.href = nextUrl;
    const video = document.querySelector('video');
    video.src = `data:video/mp4;name=next;base64,${mediaData}`;
    const native = document.querySelector('.ytp-caption-segment');
    if (native) native.textContent = nextText;
    document.dispatchEvent(new Event('yt-navigate-finish'));
  }, {nextUrl, mediaData, nextText});
  await page.locator('#fluent-read-video-learning-panel').waitFor({state: 'detached'});
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await injectCaptions(platform, [{startMs: 0, durationMs: 2000, text: nextText}], nextMediaId);
  await openLearning();
  await page.waitForFunction(nextText => document.querySelector('[data-learning-original]')?.textContent === nextText, nextText);
  assert.equal((await current()).loop, 'false');
  assert.equal((await current()).pauseAtEnd, 'false');
  check(result, 'Changing video identity closes old learning and shows only the new original timeline with controls off', await current());
  for (let attempt = 0; attempt < 50 && !await worker.evaluate(() => globalThis.sentenceFixtureHeld.length); attempt++) await page.waitForTimeout(50);
  assert.ok(await worker.evaluate(() => globalThis.sentenceFixtureHeld.length), 'The deterministic provider must hold the new original sentence request');
  assert.equal(await action('save').isDisabled(), true, 'The unconfirmed translation must not be saved while its request is pending');
  await action('edit-translation').click();
  await page.locator('[data-learning-translation]').fill('新视频中的句子（用户确认）。');
  assert.equal(await action('save').isEnabled(), true, 'A user-confirmed translation can be saved while the provider is pending');
  await worker.evaluate(() => {
    globalThis.sentenceFixtureHoldText = undefined;
    globalThis.sentenceFixtureHeld.splice(0).forEach(resolve => resolve());
  });
  await page.waitForTimeout(350);
  assert.equal(await page.locator('[data-learning-translation]').inputValue(), '新视频中的句子（用户确认）。');
  await action('done-translation').click();
  await action('save').click();
  let confirmed;
  for (let attempt = 0; attempt < 50; attempt++) {
    confirmed = await control.evaluate(nextText => chrome.runtime.sendMessage({type: 'fluentReadVocabularyBook', action: 'getByTerm', sourceLanguage: 'en', term: nextText}), nextText);
    if (confirmed.success && confirmed.data) break;
    await page.waitForTimeout(50);
  }
  assert.ok(confirmed.success && JSON.stringify(confirmed.data?.translations).includes('新视频中的句子（用户确认）。'));
  check(result, 'Saving waits for translation or explicit user confirmation, and a delayed provider response preserves the edited translation');
  await page.close();
  page = null;
  await context.unroute(url);
  result.success = true;
}
async function runXSourceIdentityFixtures(mediaData) {
  const cases = [
    {name: 'multiple-videos-without-index', path: '/fluentread/status/525250', duplicateVideo: true},
    {name: 'multiple-videos-wrong-index', path: '/fluentread/status/525251/video/2', duplicateVideo: true},
    {name: 'unassigned-quoted-status', path: '/fluentread/status/525252', quotedStatus: true, noTrackLanguage: true},
    {name: 'multiple-videos-explicit-index', path: '/fluentread/status/525253/video/1', duplicateVideo: true, explicitSource: true},
    {name: 'single-dom-video-with-unproven-index', path: '/fluentread/status/525254/video/2'},
  ];
  for (const scenario of cases) {
    currentPhase = `x: ambiguous source ${scenario.name}`;
    const baseUrl = `https://x.com${scenario.path}`;
    const url = `${baseUrl}#fluentread-video=3000,5500`;
    const original = `The ${scenario.name.replaceAll('-', ' ')} source ${scenario.explicitSource ? 'has an explicit identity' : 'stays unavailable'}.`;
    const result = {platform: 'x', scenario: scenario.name,
      source: 'controlled X article/video identity and real local media; deterministic translation', checks: []};
    report.fixtureCases.push(result);
    let html = fixtureHtml('x', mediaData).replace('/fluentread/status/424243', scenario.path.split('/video/')[0]);
    if (scenario.explicitSource) html = html.replace('<video ', `<a href="${scenario.path}" style="display:block;width:100%;height:100%"><video `).replace('</video>', '</video></a>');
    if (scenario.duplicateVideo) html = html.replace('</article>', `<div style="display:none"><video muted src="data:video/mp4;base64,${mediaData}"></video></div></article>`);
    if (scenario.quotedStatus) html = html.replace('</article>', '<div data-testid="quoteTweet"><a href="/quoted/status/525299">引用帖子</a></div></article>');
    await context.route(baseUrl, route => route.fulfill({contentType: 'text/html', body: html}));
    page = await helper.newPageWithoutForeground(context);
    await page.goto(url);
    await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.waitForTimeout(500);
    const time = await page.locator('video').first().evaluate(video => ({time: video.currentTime, paused: video.paused}));
    assert.equal(time.paused, true);
    assert.ok(scenario.explicitSource ? Math.abs(time.time - 3) < .08 : time.time < .1, JSON.stringify(time));
    check(result, scenario.explicitSource ? 'An explicit local X video/N ancestor restores the matching media source fragment' : 'An unproven X video/status correspondence does not restore a source fragment onto the active media', time);
    await page.locator('#fluent-read-video-subtitle-button').waitFor();
    await page.locator('video').first().evaluate((video, {original, noTrackLanguage}) => {
      const track = noTrackLanguage ? video.addTextTrack('captions', 'Unlabeled fixture') : video.addTextTrack('captions', 'English fixture', 'en');
      track.mode = 'hidden';
      track.addCue(new VTTCue(0, 2, original));
    }, {original, noTrackLanguage: scenario.noTrackLanguage});
    await openLearning();
    await page.waitForFunction(original => document.querySelector('[data-learning-original]')?.textContent === original, original);
    await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.getAttribute('aria-busy') !== 'true');
    const providerLanguages = await worker.evaluate(original => globalThis.sentenceFixtureRequestLanguages.filter(request => request.sources.includes(original)).map(request => request.from), original);
    assert.ok(providerLanguages.length && providerLanguages.every(language => language === 'en'), 'Native original-track metadata or configured English fallback must reach the translation provider');
    await editField('translation', '无法确认来源的句子。');
    await action('save').click();
    let saved;
    for (let attempt = 0; attempt < 50; attempt++) {
      saved = await control.evaluate(term => chrome.runtime.sendMessage({type: 'fluentReadVocabularyBook', action: 'getByTerm', sourceLanguage: 'en', term}), original);
      if (saved.success && saved.data) break;
      await page.waitForTimeout(50);
    }
    assert.ok(saved.success && saved.data, JSON.stringify(saved));
    assert.equal(saved.data.sourceLanguage, 'en', 'The saved source language follows the video native TextTrack metadata');
    assert.ok(saved.data.contexts.some(context => context.video?.platform === 'x' && context.video.startMs === 0 && context.video.endMs === 2000));
    assert.ok(saved.data.contexts.every(context => scenario.explicitSource ? context.sourceUrl === baseUrl : !context.sourceUrl), JSON.stringify(saved.data.contexts));
    check(result, scenario.explicitSource ? 'Explicit collection retains the locally proven X video/N source identity' : 'Explicit collection preserves sentence/title/time while omitting an unproven X source URL', {contexts: saved.data.contexts, providerLanguages, trackLanguage: scenario.noTrackLanguage ? '(unlabeled; configured en fallback)' : 'en'});
    await capture(`x-${scenario.name}`, result);
    await page.close();
    page = null;
    await context.unroute(baseUrl);
    result.success = true;
  }
}
async function runTranslatedOnlyYoutubeFixture(mediaData) {
  currentPhase = 'youtube: translated-only caption track';
  const mediaId = 'frMachine01';
  const url = `https://www.youtube.com/watch?v=${mediaId}`;
  const result = {platform: 'youtube', scenario: 'translated-only-track',
    source: 'controlled YouTube translated timed-caption track and real local media; no original track until the explicit second stage', checks: []};
  report.fixtureCases.push(result);
  const html = fixtureHtml('youtube', mediaData).replace('<span class="ytp-caption-segment">Sea otters</span>', '<span class="ytp-caption-segment"></span>');
  await context.route(url, route => route.fulfill({contentType: 'text/html', body: html}));
  page = await helper.newPageWithoutForeground(context);
  await page.goto(url);
  await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.locator('#fluent-read-video-subtitle-button').waitFor();
  await page.evaluate(mediaId => window.postMessage({source: 'fluent-read', type: 'fluent-read-youtube-timedtext',
    url: `https://www.youtube.com/api/timedtext?v=${mediaId}&lang=en&tlang=zh-Hans`,
    responseText: JSON.stringify({events: [{tStartMs: 0, dDurationMs: 2500, segs: [{utf8: '这是机器翻译轨道中的句子。'}]}]})}, location.origin), mediaId);
  await openLearning();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-learning-original]').count(), 0);
  assert.equal(await action('save').count(), 0);
  assert.equal(await action('loop').count(), 0);
  assert.equal((await current()).paused, true);
  check(result, 'A translated-only YouTube timed-caption track is not exposed as an original sentence, repeat range or collectible source');
  await injectCaptions('youtube', [{startMs: 0, durationMs: 2500, text: 'An original source track can now be learned.'}], mediaId);
  await page.waitForFunction(() => document.querySelector('[data-learning-original]')?.textContent === 'An original source track can now be learned.');
  assert.equal(Number((await current()).endMs), 2500);
  check(result, 'The same empty learning panel becomes available only when an original timed-caption track arrives', await current());
  await capture('youtube-translated-only-track', result);
  await page.close();
  page = null;
  await context.unroute(url);
  result.success = true;
}
async function probeLive({platform, url}) {
  currentPhase = `${platform}: unmodified live platform probe`;
  const sampleId = (new URL(url).searchParams.get('v') || new URL(url).pathname.split('/').at(-1)).replace(/[^a-z0-9_-]/gi, '');
  const result = {platform, url, source: 'unmodified actual platform HTML, media and original-caption transport; deterministic Microsoft translation; no fixture caption injection', checks: [], success: false};
  report.liveCases.push(result);
  page = await helper.newPageWithoutForeground(context);
  const captionResponses = [];
  page.on('response', async response => {
    if (/timedtext|captions?[^/]*\.(?:vtt|srt)|\/captions\//i.test(response.url())) {
      const body = await response.text().catch(() => '');
      captionResponses.push({url: response.url().split('?')[0], status: response.status(), bytes: body.length, sample: body.slice(0, 500)});
    }
  });
  try {
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 45000});
    await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
    await page.waitForTimeout(5000);
    result.initialState = await page.evaluate(() => ({url: location.href, title: document.title,
      body: document.body.innerText.slice(0, 1200), videoCount: document.querySelectorAll('video').length,
      nativeCaptions: [...document.querySelectorAll('.ytp-caption-segment')].map(node => node.textContent).join(' '),
      captionButton: document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed'),
      captionTracks: (document.querySelector('#movie_player')?.getPlayerResponse?.()?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []).map(track => ({language: track.languageCode, kind: track.kind, name: track.name?.simpleText || track.name?.runs?.map(run => run.text).join('')})),
      sourceStatus: document.querySelector('[data-source-status]')?.textContent,
      videos: [...document.querySelectorAll('video')].map(video => ({time: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : null, readyState: video.readyState, tracks: [...video.textTracks].map(track => ({language: track.language, cues: track.cues?.length, mode: track.mode}))}))}));
    const captionButton = page.locator('.ytp-subtitles-button');
    if (platform === 'youtube' && await captionButton.count() && await captionButton.isVisible()) {
      if (await captionButton.getAttribute('aria-pressed') !== 'true') await captionButton.click();
      const playButton = page.locator('.ytp-play-button');
      if (await playButton.count() && await playButton.isVisible()) await playButton.click();
      await page.waitForTimeout(5000);
    }
    const firstVideo = page.locator('video').first();
    if (await firstVideo.isVisible().catch(() => false)) await firstVideo.hover({force: true}).catch(() => {});
    if (await page.locator('#fluent-read-video-subtitle-button').isVisible().catch(() => false)) {
      await page.locator('#fluent-read-video-subtitle-button').click();
      result.menuStatus = await page.locator('[data-source-status]').textContent().catch(() => null);
      const learn = page.locator('[data-action="open-sentence-learning"]');
      result.learningAvailable = await learn.isVisible().catch(() => false) && !(await learn.isDisabled());
      if (result.learningAvailable) {
        await learn.click();
        await page.waitForTimeout(500);
        result.learningState = await current();
        result.success = Boolean(result.learningState.sentenceId && result.learningState.text);
      }
    }
    result.captionResponses = captionResponses;
    result.finalCaptionState = await page.evaluate(() => ({native: [...document.querySelectorAll('.ytp-caption-segment')].map(node => node.textContent).join(' '),
      captionButton: document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed'), sourceStatus: document.querySelector('[data-source-status]')?.textContent}));
    if (!result.success) result.limitation = 'Actual page did not supply a usable original timed-caption learning sentence in this isolated session. See DOM, platform text and response evidence; fixture success is separate.';
    await capture(`live-${platform}-${sampleId}`, result);
  } catch (error) {
    result.failure = error.message;
    result.captionResponses = captionResponses;
    await capture(`live-${platform}-${sampleId}-failure`, result).catch(() => {});
  } finally {
    await page.close();
    page = null;
  }
}
async function main() {
  explanationServer = http.createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {response.writeHead(404).end();return;}
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    explanationRequests.push(body);
    response.writeHead(200, {'content-type': 'text/event-stream; charset=utf-8', 'access-control-allow-origin': '*'});
    const answer = 'strong teeth 描述海獭用于咬开食物的坚硬牙齿。后一句讲到用石头打开贝壳。';
    response.write(`data: ${JSON.stringify({id: 'sentence-explanation-fixture', choices: [{index: 0, delta: {content: answer}, finish_reason: null}]})}\n\n`);
    await new Promise(resolve => pendingExplanations.push(resolve));
    response.end(`data: ${JSON.stringify({id: 'sentence-explanation-fixture', choices: [{index: 0, delta: {}, finish_reason: 'stop'}]})}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((resolve, reject) => {explanationServer.once('error', reject);explanationServer.listen(0, '127.0.0.1', resolve);});
  const stopForFocus = error => {
    focusFailure ||= error;
    if (session) void session.close().catch(() => {});
  };
  focusMonitor = helper.startFocusEventMonitor({onEvent: event => {
    if (event.pid === browserPid) stopForFocus(new Error('The isolated browser became foreground; stop the test'));
  }, onError: stopForFocus});
  report.focusObserver = await focusMonitor.ready;
  session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
    browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    headless: false, background: true, displayTarget: 'secondary', viewport: {width: 1280, height: 900},
    browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
  });
  guardBrowserClose(session, profileDir);
  browserPid = await getGuardedBrowserPid(session);
  assert.ok(!focusMonitor.events.some(event => event.pid === browserPid), 'Owned browser activated during launch');
  context = session.context;
  Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
  assert.equal(report.windowPlacement.browserFrontmost, false, 'Focus-safe browser must stay in background');
  context.on('page', candidate => candidate.on('pageerror', error => report.pageErrors.push({message: error.message, stack: error.stack, url: candidate.url(), phase: currentPhase})));
  worker = context.serviceWorkers().find(candidate => candidate.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', {predicate: candidate => candidate.url().endsWith('/background.js')});
  extensionId = new URL(worker.url()).host;
  await worker.evaluate(mapping => {
    const originalFetch = globalThis.fetch;
    globalThis.sentenceFixtureRequests = [];
    globalThis.sentenceFixtureRequestLanguages = [];
    globalThis.sentenceFixtureHeld = [];
    globalThis.fetch = async (input, init) => {
      const requestUrl = String(input?.url || input);
      if (!requestUrl.startsWith('https://edge.microsoft.com/translate/translatetext')) return originalFetch(input, init);
      const body = JSON.parse(init?.body || '[]');
      const sources = body.map(item => String(item?.Text ?? item ?? ''));
      globalThis.sentenceFixtureRequests.push(...sources);
      globalThis.sentenceFixtureRequestLanguages.push({sources, from: new URL(requestUrl).searchParams.get('from')});
      if (sources.includes(globalThis.sentenceFixtureHoldText)) await new Promise(resolve => globalThis.sentenceFixtureHeld.push(resolve));
      return new Response(JSON.stringify(sources.map(source => ({translations: [{text: mapping[source] || `固定译文：${source}`}]}))), {status: 200, headers: {'content-type': 'application/json'}});
    };
  }, translations);
  control = await helper.newPageWithoutForeground(context);
  await control.goto(`chrome-extension://${extensionId}/popup.html`);
  await patchConfig({on: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, from: 'auto', to: 'zh-Hans',
    videoTranslationEnabled: true, videoSubtitleVisible: true, videoSubtitleDisplayMode: 'bilingual',
    vocabularyBookEnabled: true, videoSourceLanguage: 'en', videoService: 'microsoft', videoServiceDefaultMigrated: true,
    customOpenAIProviders: [{id: 'custom:sentence-fixture', name: 'Sentence fixture', endpoint: `http://127.0.0.1:${explanationServer.address().port}/v1/chat/completions`, models: ['sentence-fixture']}],
    token: {'custom:sentence-fixture': 'fixture-token'}, model: {'custom:sentence-fixture': 'sentence-fixture'},
    harness: {enabled: true, service: 'custom:sentence-fixture', model: 'sentence-fixture', defaultAction: 'usage',
      actions: ['meaning', 'grammar', 'usage', 'practice'], contextMode: 'paragraph', maxContextChars: 1500,
      explanationDepth: 'concise', learningLevel: 'intermediate'}});
  if (!liveOnly) {
    const mediaFile = path.join(artifacts, 'fixture.mp4');
    const media = spawnSync(arg('ffmpeg', '/opt/homebrew/bin/ffmpeg'), ['-y', '-f', 'lavfi', '-i', 'color=c=0x123044:s=960x540:r=20', '-t', '18', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaFile], {encoding: 'utf8', timeout: 30000});
    assert.equal(media.status, 0, media.stderr);
    const mediaData = fs.readFileSync(mediaFile).toString('base64');
    for (const platform of platforms) await runFixture(platform, mediaData);
    if (platforms.includes('youtube')) await runTranslatedOnlyYoutubeFixture(mediaData);
    if (platforms.includes('x')) await runXSourceIdentityFixtures(mediaData);
    report.fixturePageErrors = [...report.pageErrors];
    assert.deepEqual(report.fixturePageErrors, [], 'Controlled fixture pages must not emit runtime errors');
  }
  for (const live of liveUrls) await probeLive(live);
  if (focusFailure || focusMonitor.error) throw focusFailure || focusMonitor.error;
  const foreground = await helper.queryMacFrontmostApplication();
  assert.ok(foreground && foreground.pid !== browserPid, 'Owned browser must stay in background');
  report.finalBrowserFrontmost = false;
  report.success = liveOnly ? report.liveCases.every(result => result.success) : report.fixtureCases.every(result => result.success);
  if (!report.success) process.exitCode = 1;
}
main().catch(async error => {
  report.failure = error.stack || String(error);
  if (page && !page.isClosed()) {
    report.failureState = await current().catch(() => null);
    await capture('failure', report).catch(() => {});
  }
  process.exitCode = 1;
}).finally(async () => {
  pendingExplanations.splice(0).forEach(resolve => resolve());
  try {
    if (session) {await session.close(); report.cleanup.browserClosed = true;}
  } catch (error) {report.cleanup.error = error.stack || String(error);report.success = false;process.exitCode = 1;}
  if (focusMonitor) {
    try {await focusMonitor.stop();report.focusEvents = {nativeObserver: true, browserActivations: focusMonitor.events.filter(event => event.pid === browserPid).length, observerClosed: true};}
    catch (error) {report.focusObserverError = String(error);report.success = false;process.exitCode = 1;}
    if (focusMonitor.error || focusFailure || report.focusEvents?.browserActivations) {report.success = false;process.exitCode = 1;}
  }
  if (explanationServer) await new Promise(resolve => explanationServer.close(resolve));
  if (report.cleanup.browserClosed) {
    fs.rmSync(profileDir, {recursive: true, force: true});
    report.cleanup.profileRemoved = true;
  } else report.cleanup.retainedProfile = profileDir;
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({success: report.success,
    fixtureCases: report.fixtureCases.map(result => ({platform: result.platform, ...(result.scenario ? {scenario: result.scenario} : {}), success: Boolean(result.success), checks: result.checks.length})),
    liveCases: report.liveCases.map(result => ({platform: result.platform, url: result.url, success: result.success,
      captionResponses: result.captionResponses?.length, limitation: result.limitation, failure: result.failure})),
    failure: report.failure?.split('\n')[0], focusEvents: report.focusEvents, cleanup: report.cleanup,
    report: path.join(artifacts, 'report.json')}, null, 2)}\n`);
});

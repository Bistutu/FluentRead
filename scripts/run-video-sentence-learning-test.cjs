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
const performanceOnly = process.argv.includes('--performance-only');
const runtimePerformanceOnly = process.argv.includes('--runtime-performance-only');
const reliabilityOnly = process.argv.includes('--reliability-only');
const compactProbeOnly = process.argv.includes('--compact-probe-only');
const fullscreenEscapeProbeOnly = process.argv.includes('--fullscreen-escape-probe-only');
const appearanceOnly = process.argv.includes('--appearance-only');
const liveUrls = [
  ...String(arg('live-youtube-urls', arg('live-youtube-url', ''))).split(',').filter(Boolean).map(url => ({platform: 'youtube', url})),
  ...(arg('live-x-url') ? [{platform: 'x', url: arg('live-x-url')}] : []),
];
assert.ok(playwrightRoot, 'Pass --playwright-root');
assert.ok(fs.existsSync(path.join(extensionDir, 'manifest.json')), 'Build the production extension first');
assert.ok(platforms.every(platform => ['youtube', 'x'].includes(platform)), '--platforms accepts youtube,x');
assert.ok(!liveOnly || liveUrls.length, '--live-only requires a live URL');
assert.ok(!performanceOnly || !liveOnly && !liveUrls.length, '--performance-only cannot include live probes');
assert.ok(!runtimePerformanceOnly || !liveOnly && !liveUrls.length && !performanceOnly && !reliabilityOnly,
  '--runtime-performance-only is a scoped controlled measurement');
assert.ok(!runtimePerformanceOnly || platforms.every(platform => platform === 'youtube'),
  '--runtime-performance-only measures the scoped YouTube native-DOM protocol; pass --platforms youtube');
assert.ok(!reliabilityOnly || !liveOnly && !liveUrls.length && !performanceOnly, '--reliability-only cannot include live or older performance cases');
assert.ok(!compactProbeOnly || !liveOnly && !liveUrls.length && !performanceOnly && !runtimePerformanceOnly && !reliabilityOnly,
  '--compact-probe-only is a separate controlled geometry diagnosis');
assert.ok(!fullscreenEscapeProbeOnly || !liveOnly && !liveUrls.length && !performanceOnly && !runtimePerformanceOnly && !reliabilityOnly && !compactProbeOnly,
  '--fullscreen-escape-probe-only is a separate controlled input diagnosis');
assert.ok(!appearanceOnly || !liveOnly && !liveUrls.length && !performanceOnly && !runtimePerformanceOnly && !reliabilityOnly && !compactProbeOnly && !fullscreenEscapeProbeOnly
  && platforms.every(platform => platform === 'youtube'), '--appearance-only is a scoped YouTube setup/settings persistence check');
const helper = require(helperPath);
const {chromium} = createRequire(path.join(playwrightRoot, 'video-sentence-proof.cjs'))('playwright');
fs.mkdirSync(artifacts, {recursive: true});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-sentence-learning-'));
const report = {
  success: false,
  startedAt: new Date().toISOString(),
  evidence: 'Production extension; real local MP4 clock; original timed-caption fixtures; deterministic translation; actual live probes reported separately',
  fixtureCases: [], liveCases: [], pageErrors: [], cleanup: {},
};
process.stdout.write(`Video sentence validation started at ${report.startedAt}\n`);
if (performanceOnly || runtimePerformanceOnly) {
  const crypto = require('node:crypto');
  report.performanceCases = [];
  report.performance = {tag: arg('performance-tag', 'baseline'), deterministicProviderDelayMs: 120,
    artifact: {version: JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'))).version,
      contentSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir, 'content-scripts/content.js'))).digest('hex')},
    scope: 'Production UI; decoded MP4; synthetic timeupdate pressure reported separately from natural media clock; local deterministic transport, not provider latency or website acceptance'};
}
const crypto = require('node:crypto');
report.artifact = {contentSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir, 'content-scripts/content.js'))).digest('hex'),
  version: JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'))).version};
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
let rejectBrowserDisconnected;
let stopDisconnectObservation;
const browserDisconnected = new Promise((_, reject) => {rejectBrowserDisconnected = reject;});
void browserDisconnected.catch(() => {});
async function withDeadline(operation, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds} ms`)), milliseconds);
    })]);
  } finally {clearTimeout(timer);}
}
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
async function waitForLearningGeometry() {
  await page.waitForFunction(() => {
    const host = document.querySelector('#fluent-read-video-learning-panel');
    const player = document.querySelector('#movie_player, [data-testid=videoPlayer]');
    if (!host || !player) return false;
    const a = host.getBoundingClientRect(), b = player.getBoundingClientRect();
    return a.width > 0 && a.height > 0 && a.left >= b.left + 7 && a.right <= b.right - 7
      && a.top >= b.top + 7 && a.bottom <= b.bottom - 55;
  }, null, {timeout: 5000});
}
async function patchConfig(patch) {
  const result = await control.evaluate(async ({patch, sequence}) => {
    const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
    if (!read.success) throw new Error('Cannot read test profile configuration');
    const current = typeof read.value === 'string' ? JSON.parse(read.value) : read.value || {};
    return chrome.runtime.sendMessage({type: 'persistConfig', clientId: 'sentence-learning-proof', sequence,
      // This disposable profile only has our known placeholder credential. Public
      // local:config omits separately stored credentials; a full fixture write
      // must retain that placeholder without reading any user credential record.
      config: {...current, ...patch, token: {'custom:sentence-fixture': 'fixture-token'}},
      ...(Number.isSafeInteger(current.__fluentConfigRevision) ? {baseRevision: current.__fluentConfigRevision} : {})});
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
  if (!await page.locator('#fluent-read-video-subtitle-menu').isVisible().catch(() => false)) {
    await page.locator('#fluent-read-video-subtitle-button').click();
  }
  await page.locator('[data-action="open-sentence-learning"]').click();
  await page.locator('#fluent-read-video-learning-panel').waitFor({state: 'visible'});
}
function fixtureHtml(platform, mediaData) {
  const video = `<video ${platform === 'youtube' ? 'class="html5-main-video"' : ''} muted src="data:video/mp4;base64,${mediaData}" style="width:100%;height:100%"></video>`;
  const controls = platform === 'youtube'
    ? '<div id="ytp-caption-window-container"><span class="ytp-caption-segment">Sea otters</span></div><div class="ytp-right-controls"><button aria-label="Settings">⚙</button><button aria-label="Full screen">⛶</button></div>'
    : '<div class="fixture-controls"><button aria-label="Play">▶</button><span style="flex:1">0:00 / 0:18</span><div class="fixture-actions"><button aria-label="Captions">▣</button><button aria-label="Settings">⚙</button><div id="fixture-pip"><button aria-label="Picture in picture">▣</button></div><div id="fixture-fullscreen"><button aria-label="Full screen">⛶</button></div></div></div>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sentence learning ${platform} fixture</title><style>
    body{margin:24px;background:#eef2f8;font:18px Arial;--el-text-color-regular:#00ff00;--el-color-primary-light-5:#00ff00}#movie_player,[data-testid=videoPlayer]{position:relative;width:960px;height:540px;overflow:hidden;background:#153047;color:white}
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
async function createPerformancePage(platform, mediaData, captionCues, label) {
  currentPhase = `${platform}: performance ${label}`;
  const mediaId = platform === 'youtube' ? 'frPerfVid01' : '424260';
  const url = platform === 'youtube' ? `https://www.youtube.com/watch?v=${mediaId}` : `https://x.com/fluentread/status/${mediaId}`;
  await context.route(url, route => route.fulfill({contentType: 'text/html', body: fixtureHtml(platform, mediaData)}));
  page = await helper.newPageWithoutForeground(context);
  await page.goto(url);
  await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.locator('#fluent-read-video-subtitle-button').waitFor();
  await injectCaptions(platform, captionCues, mediaId);
  await page.evaluate(() => {
    const state = window.__sentencePerformance = {phase: 'opening', actions: [], pending: [], mutations: 0, panelMutations: 0, longTasks: [], nativeTicks: 0};
    new MutationObserver(records => {
      state.mutations += records.length;
      const panel = document.querySelector('#fluent-read-video-learning-panel');
      if (panel) state.panelMutations += records.filter(record => panel.contains(record.target)).length;
      const index = panel?.querySelector('[data-learning-sentence-index]')?.dataset.learningSentenceIndex;
      for (const item of state.pending) {
        if (!item.done && ((item.action === 'open' && index !== undefined)
          || ((item.action === 'next' || item.action === 'previous') && index !== item.before)
          || (item.action === 'close' && !panel))) {
          item.done = true; item.durationMs = performance.now() - item.start; item.after = index ?? null;
          state.actions.push({...item});
        }
      }
      state.pending = state.pending.filter(item => !item.done);
    }).observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true});
    document.addEventListener('click', event => {
      const target = event.target.closest?.('[data-learning-action], [data-action="open-sentence-learning"]');
      if (!target) return;
      const action = target.dataset.learningAction || 'open';
      if (!['open', 'next', 'previous', 'close'].includes(action)) return;
      state.pending.push({phase: state.phase, action, start: performance.now(),
        before: document.querySelector('[data-learning-sentence-index]')?.dataset.learningSentenceIndex ?? null});
    }, true);
    try { new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(item => ({phase: state.phase, durationMs: item.duration})))).observe({entryTypes: ['longtask']}); } catch {}
    document.querySelector('video').addEventListener('timeupdate', event => {if (event.isTrusted) state.nativeTicks++;});
  });
}
const providerCount = () => worker.evaluate(() => globalThis.sentenceFixtureRequests.length);
const performanceStats = () => page.evaluate(() => ({...window.__sentencePerformance, pending: undefined}));
async function dispatchTimeupdatePressure() {
  return page.evaluate(async () => {
    const video = document.querySelector('video'); const batchesMs = [];
    for (let batch = 0; batch < 10; batch++) {
      const start = performance.now();
      for (let event = 0; event < 100; event++) video.dispatchEvent(new Event('timeupdate'));
      batchesMs.push(performance.now() - start);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return {events: 1000, batchesMs, totalDispatchMs: batchesMs.reduce((sum, time) => sum + time, 0),
      actualPaused: video.paused, actualTime: video.currentTime, selectedIndex: document.querySelector('[data-learning-sentence-index]')?.dataset.learningSentenceIndex};
  });
}
async function runPerformanceFixtures(platform, mediaData) {
  for (const size of platform === 'youtube' ? [120, 2400, 12000] : [120, 2400, 4000]) {
    const captionCues = Array.from({length: size}, (_, index) => ({startMs: index, durationMs: 1, text: `Pressure ${platform} sentence ${String(index).padStart(5, '0')}.`}));
    const result = {platform, scenario: `dense-timeline-${size}`, sentenceCount: size, checks: [], measurements: []};
    report.performanceCases.push(result);
    await createPerformancePage(platform, mediaData, captionCues, result.scenario);
    await seek(.0005);
    result.closedDispatch = await dispatchTimeupdatePressure();
    await openLearning();
    await page.waitForFunction(size => document.querySelector('.fr-video-learning-position')?.textContent.includes(`/ ${size}`), size);
    result.opening = (await performanceStats()).actions.filter(item => item.action === 'open');
    for (const [position, time, expected] of [['first', .0005, 0], ['tail', (size - .5) / 1000, size - 1]]) {
      await seek(time);
      await page.waitForFunction(index => Number(document.querySelector('[data-learning-sentence-index]')?.dataset.learningSentenceIndex) === index, expected);
      await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.getAttribute('aria-busy') === 'false');
      const before = await performanceStats(); const requests = await providerCount();
      await page.evaluate(position => {window.__sentencePerformance.phase = `same-sentence-${position}`;}, position);
      const pressure = await dispatchTimeupdatePressure();
      const after = await performanceStats();
      result.measurements.push({position, ...pressure, pageDomMutations: after.mutations - before.mutations,
        panelDomMutations: after.panelMutations - before.panelMutations, providerRequests: await providerCount() - requests});
      assert.equal(pressure.selectedIndex, String(expected));
      assert.equal(await providerCount(), requests, 'Same-sentence timeupdate pressure must not restart translation');
    }
    await action('close').click();
    assert.equal(await page.locator('#fluent-read-video-learning-panel').count(), 0);
    result.success = true; process.stdout.write(`${platform}: measured ${size} sentences at first/tail\n`);
    await page.close(); page = null; await context.unrouteAll({behavior: 'wait'});
  }
  const captionCues = Array.from({length: 120}, (_, index) => ({startMs: index * 500, durationMs: 450, text: `Operation ${platform} sentence ${String(index).padStart(5, '0')}.`}));
  const result = {platform, scenario: 'operations', checks: [], measurements: {}}; report.performanceCases.push(result);
  await createPerformancePage(platform, mediaData, captionCues, 'operations');
  await openLearning();
  await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.getAttribute('aria-busy') === 'false');
  result.measurements.opening = (await performanceStats()).actions.filter(item => item.action === 'open');
  let startRequests = await providerCount();
  await page.evaluate(() => {window.__sentencePerformance.phase = 'rapid-next-12-target-30ms';});
  for (let index = 0; index < 12; index++) {await action('next').click({force: true});await page.waitForTimeout(30);}
  await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.textContent.includes('sentence 00012.'));
  result.measurements.rapid = {requests: await providerCount() - startRequests, final: await current(),
    actions: (await performanceStats()).actions.filter(item => item.phase === 'rapid-next-12-target-30ms')};
  assert.equal(result.measurements.rapid.final.index, '12');
  startRequests = await providerCount();
  result.measurements.burst = await page.evaluate(async () => {
    window.__sentencePerformance.phase = 'synchronous-next-12-microtask-settlement';
    const start = performance.now();
    for (let index = 0; index < 12; index++) document.querySelector('[data-learning-action="next"]').click();
    await Promise.resolve(); await Promise.resolve();
    return {kind: 'explicit synthetic click burst, not a trusted-user gesture', clicks: 12, domSettlementMs: performance.now() - start,
      index: document.querySelector('[data-learning-sentence-index]')?.dataset.learningSentenceIndex,
      original: document.querySelector('[data-learning-original]')?.textContent};
  });
  await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.textContent.includes('sentence 00024.'));
  Object.assign(result.measurements.burst, {requests: await providerCount() - startRequests, final: await current()});
  assert.equal(result.measurements.burst.final.index, '24');
  await action('previous').click();
  await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.textContent.includes('sentence 00023.'));
  await action('next').click();
  startRequests = await providerCount();
  for (let index = 0; index < 6; index++) {await action('previous').click({force: true}); await action('next').click({force: true});}
  await page.waitForTimeout(250);
  result.measurements.warmRevisit = {requests: await providerCount() - startRequests, final: await current()};
  assert.equal(result.measurements.warmRevisit.requests, 0, 'Completed in-session drafts should not start duplicate translation requests');
  const player = page.locator('#movie_player, [data-testid=videoPlayer]');
  await player.evaluate(element => {element.style.width = '390px'; element.style.height = '260px';});
  await waitForLearningGeometry();
  await page.locator('[data-learning-original]').scrollIntoViewIfNeeded();
  result.measurements.compact = await page.evaluate(() => {
    const visible = action => {
      const button = document.querySelector(`[data-learning-action="${action}"]`); if (!button) return false;
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    };
    return {atOriginal: Object.fromEntries(['previous', 'next', 'play', 'loop', 'pause-at-end', 'save', 'library', 'close'].map(action => [action, visible(action)])),
      bodyScrollTop: document.querySelector('.fr-video-learning-body').scrollTop};
  });
  await action('next').scrollIntoViewIfNeeded();
  result.measurements.compact.nextReachableAfterScroll = await action('next').isVisible();
  await player.screenshot({path: path.join(artifacts, `${platform}-performance-compact.png`)});
  await player.evaluate(element => {element.style.width = '960px'; element.style.height = '540px';});
  await waitForLearningGeometry();
  await action('close').click();
  await page.close(); page = null; await context.unrouteAll({behavior: 'wait'});
  await createPerformancePage(platform, mediaData, [{startMs: 0, durationMs: 6000, text: `Natural ${platform} clock stays on this complete sentence.`},
    ...captionCues.slice(1).map((cue, index) => ({...cue, startMs: 7000 + index * 1000, durationMs: 850}))], 'natural-clock');
  await seek(.1); await openLearning();
  await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.getAttribute('aria-busy') === 'false');
  await page.evaluate(() => {window.__sentencePerformance.phase = 'natural-first-sentence-5s';});
  const beforeNatural = await performanceStats(); startRequests = await providerCount();
  await page.evaluate(() => document.querySelector('video').play());
  await page.waitForTimeout(5000);
  await page.evaluate(() => document.querySelector('video').pause());
  const afterNatural = await performanceStats();
  result.measurements.naturalClock = {durationMs: 5000, final: await current(), nativeTicks: afterNatural.nativeTicks - beforeNatural.nativeTicks,
    pageDomMutations: afterNatural.mutations - beforeNatural.mutations, panelDomMutations: afterNatural.panelMutations - beforeNatural.panelMutations,
    requests: await providerCount() - startRequests,
    longTasks: afterNatural.longTasks.filter(item => item.phase === 'natural-first-sentence-5s')};
  await action('loop').click(); await action('play').click(); await action('close').click();
  startRequests = await providerCount();
  await page.waitForFunction(() => document.querySelector('video').currentTime > 6.1, null, {timeout: 10000});
  result.measurements.closed = {afterOldBoundary: await current(), requests: await providerCount() - startRequests,
    panelCount: await page.locator('#fluent-read-video-learning-panel').count()};
  assert.equal(result.measurements.closed.panelCount, 0);
  await page.evaluate(() => document.querySelector('video').pause());
  result.success = true; process.stdout.write(`${platform}: measured rapid/burst/revisit/compact/natural/close\n`);
  await page.close(); page = null; await context.unrouteAll({behavior: 'wait'});
}

/** Natural media remains authoritative; DOM churn is labelled separately from native clock ticks. */
async function runRuntimePerformanceFixtures(platform, mediaData) {
  const durationMs = Number(arg('measurement-ms', '6000'));
  const trials = Number(arg('trials', '2'));
  assert.ok(durationMs >= 3000 && durationMs <= 15000 && Number.isInteger(trials) && trials >= 1 && trials <= 3,
    'Scoped measurements require 3000–15000 ms and 1–3 trials');
  report.performance.protocol = {durationMs, trials, platform,
    media: '18 s decoded local MP4, 20 fps; natural currentTime and native timeupdate, no dispatched media events',
    transport: 'deterministic local Microsoft response; warm first sentence, original-only subtitle mode',
    cases: ['runtime-closed-static', 'learning-open-static', 'learning-open-native-caption-churn', 'learning-open-native-control-churn'],
    churn: '20 Hz controlled replacement of one native caption span or native control icon; media clock remains natural',
    metrics: 'Renderer CDP Performance counters, browser long-task entries, DOM mutation records, transport request count and media event log',
    limitation: 'Controlled platform DOM tests the extension runtime. It does not measure YouTube network/provider latency or all-site CPU, and background scheduling can vary.'};
  const source = `Natural ${platform} playback keeps one complete sentence across the measurement.`;
  for (let trial = 0; trial < trials; trial += 1) {
    for (const scenario of report.performance.protocol.cases) {
      const result = {platform, scenario, trial: trial + 1, checks: [], measurements: {}};
      report.performanceCases.push(result);
      await createPerformancePage(platform, mediaData, [{startMs: 0, durationMs: 16500, text: source}], scenario);
      await page.evaluate(source => {
        const native = document.querySelector('.ytp-caption-segment'); if (native) native.textContent = source;
        const media = document.querySelector('video');
        const observation = window.__runtimeMediaObservation = {events: [], churns: 0};
        for (const type of ['seeking', 'seeked', 'ratechange', 'play', 'pause', 'ended']) {
          media.addEventListener(type, () => observation.events.push({type, time: media.currentTime, rate: media.playbackRate, wallMs: performance.now()}));
        }
      }, source);
      await seek(.1);
      if (scenario !== 'runtime-closed-static') {
        await openLearning();
        await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.getAttribute('aria-busy') === 'false');
      }
      await page.waitForTimeout(300);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const beforeDom = await performanceStats(); const requests = await providerCount();
      await page.evaluate(({source, scenario}) => {
        const observation = window.__runtimeMediaObservation; observation.events.length = 0;
        window.__sentencePerformance.phase = scenario;
        if (scenario.includes('churn')) {
          const target = scenario.includes('caption') ? document.querySelector('#ytp-caption-window-container')
            : document.querySelector('.ytp-right-controls button');
          observation.timer = setInterval(() => {
            const span = document.createElement('span');
            if (scenario.includes('caption')) {span.className = 'ytp-caption-segment'; span.textContent = source;}
            else {span.textContent = observation.churns % 2 ? '⚙' : '◉';}
            target.replaceChildren(span); observation.churns++;
          }, 50);
        }
        observation.startWallMs = performance.now(); observation.startTime = document.querySelector('video').currentTime;
      }, {source, scenario});
      const start = new Map((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
      await page.evaluate(() => document.querySelector('video').play());
      await page.waitForTimeout(durationMs);
      const end = new Map((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
      const media = await page.evaluate(() => {
        const state = window.__runtimeMediaObservation; clearInterval(state.timer);
        const media = document.querySelector('video');
        const result = {currentTime: media.currentTime, playbackRate: media.playbackRate, paused: media.paused,
          elapsedMediaSeconds: media.currentTime - state.startTime, elapsedWallMs: performance.now() - state.startWallMs,
          events: state.events, nativeDomChurns: state.churns}; media.pause(); return result;
      });
      const afterDom = await performanceStats();
      const metric = name => Math.max(0, (end.get(name) || 0) - (start.get(name) || 0));
      result.measurements = {wallSeconds: metric('Timestamp'), taskMs: metric('TaskDuration') * 1000,
        scriptMs: metric('ScriptDuration') * 1000, layoutMs: metric('LayoutDuration') * 1000,
        recalcStyleMs: metric('RecalcStyleDuration') * 1000, layouts: metric('LayoutCount'), recalcStyles: metric('RecalcStyleCount'),
        nativeTimeupdateTicks: afterDom.nativeTicks - beforeDom.nativeTicks,
        pageDomMutations: afterDom.mutations - beforeDom.mutations, panelDomMutations: afterDom.panelMutations - beforeDom.panelMutations,
        translationRequests: await providerCount() - requests,
        longTasks: afterDom.longTasks.filter(item => item.phase === scenario), media};
      assert.equal(media.playbackRate, 1); assert.equal(media.paused, false);
      assert.ok(media.elapsedMediaSeconds > durationMs / 1000 * .75 && media.elapsedMediaSeconds < durationMs / 1000 * 1.3,
        `Natural media/wall clock drift: ${JSON.stringify(media)}`);
      assert.equal(media.events.filter(event => ['seeking', 'ratechange'].includes(event.type)).length, 0);
      assert.equal(result.measurements.translationRequests, 0, 'Warm same-sentence playback must not request translations again');
      check(result, 'Natural 1x media advances without extension seeks, speed changes or same-sentence translation requests', result.measurements);
      await cdp.detach();
      result.success = true;
      await page.close(); page = null; await context.unrouteAll({behavior: 'wait'});
    }
  }
}

async function actualFullscreen() {
  currentPhase = 'requesting actual browser fullscreen';
  const cdp = await context.newCDPSession(page);
  try {
    await withDeadline(cdp.send('Runtime.evaluate', {expression: 'document.querySelector("#movie_player, [data-testid=videoPlayer]").requestFullscreen()',
      userGesture: true, awaitPromise: true}), 15000, 'Actual fullscreen request');
  } finally {if (context.browser()?.isConnected()) await withDeadline(cdp.detach(), 1500, 'Fullscreen CDP detach');}
  await page.waitForFunction(() => Boolean(document.fullscreenElement), null, {timeout: 15000});
}

async function runAppearanceReliability(result, mediaId) {
  await seek(3.2); await openLearning();
  await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.getAttribute('aria-busy') === 'false');
  await editField('translation', '调整样式时保留的草稿。');
  const requests = await providerCount();
  const existingPages = new Set(context.pages());
  const opened = context.waitForEvent('page', {predicate: candidate => !existingPages.has(candidate), timeout: 15000});
  await action('appearance').click(); const settings = await opened;
  await settings.waitForURL(/options\.html\?target=video-sentence-learning-appearance#settings-interface/);
  await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, settings);
  const section = settings.locator('[data-video-sentence-learning-appearance]'); await section.waitFor({state: 'visible'});
  const layout = await section.evaluate(element => {
    const example = element.querySelector('.settings-preview-example').getBoundingClientRect();
    const controls = element.querySelector('.settings-preview-controls').getBoundingClientRect();
    return {example: example.toJSON(), controls: controls.toJSON()};
  });
  assert.ok(layout.controls.x > layout.example.x + layout.example.width - 1, 'Desktop settings place preview left and controls right');
  check(result, 'The panel style entry opens the dedicated interface-center section with preview left and controls right', {url: settings.url(), layout});
  await section.locator('[data-video-learning-layout] button').nth(1).click();
  async function setRange(selector, steps) {
    await section.locator(selector).focus(); await settings.keyboard.press('Home');
    for (let step = 0; step < steps; step += 1) await settings.keyboard.press('ArrowRight');
  }
  await setRange('[data-video-learning-opacity]', 12);
  await setRange('[data-video-learning-font-scale]', 20);
  await setRange('[data-video-learning-width]', 10);
  await section.locator('[data-video-learning-position="bottom-left"]').click();
  const expected = {layout: 'comfortable', backgroundOpacity: 72, fontScale: 110, width: 400, position: 'bottom-left'};
  await settings.waitForFunction(expected => {
    const preview = document.querySelector('[data-video-learning-preview]');
    return preview?.dataset.layout === expected.layout && preview.style.getPropertyValue('--fluent-read-video-learning-background') === 'rgba(24,24,28,0.72)'
      && preview.style.getPropertyValue('--fluent-read-video-learning-width') === '400px';
  }, expected);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const appearance = await control.evaluate(async () => {
      const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const config = typeof read.value === 'string' ? JSON.parse(read.value) : read.value;
      return config.videoSentenceLearningAppearance;
    });
    if (JSON.stringify(appearance) === JSON.stringify(expected)) break;
    if (attempt === 39) assert.deepEqual(appearance, expected, 'Settings UI must persist its exact appearance via the existing configuration channel');
    await settings.waitForTimeout(50);
  }
  const screenshot = path.join(artifacts, 'learning-appearance-settings.png'); await section.screenshot({path: screenshot});
  await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
  await page.waitForFunction(() => document.querySelector('[data-learning-layout]')?.dataset.learningLayout === 'comfortable');
  assert.equal((await current()).translation, '调整样式时保留的草稿。');
  assert.equal(await providerCount(), requests);
  check(result, 'Trusted style controls persist layout, opacity, font scale, width and position without losing an open draft or reissuing translation', {appearance: expected, screenshot});
  await capture('youtube-reliability-comfortable', result);
  await page.reload(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await injectCaptions('youtube', cues, mediaId); await openLearning();
  await page.waitForFunction(() => {
    const host = document.querySelector('#fluent-read-video-learning-panel'); if (!host) return false;
    const a = host.getBoundingClientRect(), b = host.parentElement.getBoundingClientRect();
    return Math.abs(a.width - 400) < 1 && Math.abs(a.bottom - b.bottom + 56) < 2;
  });
  const fresh = await page.locator('#fluent-read-video-learning-panel').evaluate(host => {
    const panel = host.querySelector('section'); const player = host.parentElement;
    return {host: host.getBoundingClientRect().toJSON(), player: player.getBoundingClientRect().toJSON(),
      layout: panel.dataset.learningLayout, background: getComputedStyle(panel).backgroundColor,
      originalFontSize: getComputedStyle(panel.querySelector('[data-learning-original]')).fontSize,
      translationFontSize: getComputedStyle(panel.querySelector('[data-learning-translation-display]')).fontSize};
  });
  assert.equal(fresh.layout, 'comfortable'); assert.equal(fresh.background, 'rgba(24, 24, 28, 0.72)');
  assert.ok(Math.abs(fresh.host.width - 400) < 1); assert.ok(Math.abs(fresh.host.x - fresh.player.x - 8) < 1);
  assert.ok(Math.abs(fresh.host.y + fresh.host.height - fresh.player.y - fresh.player.height + 56) < 2);
  assert.ok(Math.abs(parseFloat(fresh.originalFontSize) - 20.9) < .1);
  assert.ok(Math.abs(parseFloat(fresh.translationFontSize) - 14.3) < .1);
  check(result, 'A fresh video document restores the saved appearance and default bottom-left position while session drag stays local', fresh);
  await section.locator('[data-video-learning-reset]').click();
  const defaults = {layout: 'compact', backgroundOpacity: 94, fontScale: 100, width: 360, position: 'top-right'};
  await settings.waitForFunction(() => document.querySelector('[data-video-learning-preview]')?.dataset.layout === 'compact');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const appearance = await control.evaluate(async () => {
      const read = await chrome.runtime.sendMessage({type: 'configStorageRead', key: 'local:config'});
      const config = typeof read.value === 'string' ? JSON.parse(read.value) : read.value;
      return config.videoSentenceLearningAppearance;
    });
    if (JSON.stringify(appearance) === JSON.stringify(defaults)) break;
    if (attempt === 39) assert.deepEqual(appearance, defaults, 'Restore defaults must persist before the settings tab closes');
    await settings.waitForTimeout(50);
  }
  await page.waitForFunction(() => document.querySelector('[data-learning-layout]')?.dataset.learningLayout === 'compact');
  await settings.close();
  await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
}

async function runAppearanceFixture(mediaData) {
  const result = {platform: 'youtube', scenario: 'appearance-entry-ui-and-persistence', checks: []};
  report.fixtureCases.push(result);
  await createPerformancePage('youtube', mediaData, cues, 'appearance-persistence');
  await runAppearanceReliability(result, 'frPerfVid01');
  result.success = true;
  await page.close(); await context.unrouteAll({behavior: 'wait'});
}
async function runFullscreenEscapeProbe(platform, mediaData) {
  const result = {platform, scenario: 'background-cdp-fullscreen-escape-control', checks: [], controls: []};
  report.fixtureCases.push(result);
  for (const enabled of [false, true]) {
    await patchConfig({on: enabled});
    const mediaId = enabled ? 'frEscProbe1' : 'frEscProbe0';
    const url = platform === 'youtube' ? `https://www.youtube.com/watch?v=${mediaId}` : `https://x.com/fluentread/status/${mediaId}`;
    await context.route(url, route => route.fulfill({contentType: 'text/html', body: fixtureHtml(platform, mediaData)}));
    page = await helper.newPageWithoutForeground(context); await page.goto(url);
    await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.evaluate(() => {
      const player = document.querySelector('#movie_player, [data-testid=videoPlayer]'); player.tabIndex = 0;
      player.addEventListener('click', event => {if (event.target === document.querySelector('video')) player.focus();});
      window.__escapeProbeEvents = [];
      window.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const entry = {trusted: event.isTrusted, target: event.target.tagName, fullscreenBefore: !!document.fullscreenElement};
        window.__escapeProbeEvents.push(entry);
        queueMicrotask(() => {entry.defaultPrevented = event.defaultPrevented;});
      }, true);
    });
    if (enabled) {
      await page.locator('#fluent-read-video-subtitle-button').waitFor();
      await injectCaptions(platform, cues, mediaId); await openLearning();
      await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.textContent?.trim());
    }
    await actualFullscreen();
    await page.locator('video').click({position: {x: 24, y: 24}}); await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => ({events: window.__escapeProbeEvents,
      fullscreenAfter: document.fullscreenElement?.id ?? null,
      panelAfter: !!document.querySelector('#fluent-read-video-learning-panel')}));
    result.controls.push({extensionConfigurationEnabled: enabled, ...state});
    check(result, `Observed trusted Escape in fullscreen with extension configuration ${enabled ? 'enabled and learning open' : 'disabled'}`, result.controls.at(-1));
    await capture(`${platform}-fullscreen-escape-${enabled ? 'learning' : 'disabled'}`, result);
    await page.close(); await context.unrouteAll({behavior: 'wait'});
  }
  result.success = true;
}
async function runCompactPlayerProbe(platform, mediaData) {
  const result = {platform, scenario: 'small-player-controls-bounds-probe', checks: [], sizes: []};
  report.fixtureCases.push(result);
  await createPerformancePage(platform, mediaData, cues, 'small-player-controls-bounds');
  await seek(3.2); await openLearning();
  await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.textContent?.trim());
  const player = page.locator('#movie_player, [data-testid=videoPlayer]');
  for (const size of [{width: 390, height: 260}, {width: 320, height: 180}]) {
    await player.evaluate((element, size) => {element.style.width = `${size.width}px`; element.style.height = `${size.height}px`;}, size);
    await waitForLearningGeometry();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bounds = await page.evaluate(() => {
      const panel = document.querySelector('#fluent-read-video-learning-panel');
      const card = panel.querySelector('.fr-video-learning');
      const rect = element => element?.getBoundingClientRect().toJSON();
      const cardBounds = card.getBoundingClientRect();
      const controls = [...panel.querySelectorAll('.fr-video-learning-header button, .fr-video-learning-navigation button, .fr-video-learning-footer button')].map(button => {
        const bounds = button.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return {action: button.dataset.learningAction, bounds: bounds.toJSON(), disabled: button.disabled,
          withinCard: bounds.left >= cardBounds.left - .5 && bounds.right <= cardBounds.right + .5
            && bounds.top >= cardBounds.top - .5 && bounds.bottom <= cardBounds.bottom + .5,
          hitTest: hit === button || button.contains(hit), hitTag: hit?.tagName,
          hitAction: hit?.closest?.('[data-learning-action]')?.dataset.learningAction};
      });
      const body = panel.querySelector('.fr-video-learning-body');
      const original = panel.querySelector('[data-learning-original]');
      const range = document.createRange(); range.selectNodeContents(original);
      const textRects = [...range.getClientRects()].map(bounds => bounds.toJSON());
      const bodyBounds = body.getBoundingClientRect();
      const first = textRects[0];
      const firstLineVisibleHeight = first ? Math.max(0, Math.min(first.bottom, bodyBounds.bottom) - Math.max(first.top, bodyBounds.top)) : 0;
      const originalStyle = getComputedStyle(original);
      return {player: rect(document.querySelector('#movie_player, [data-testid=videoPlayer]')), panel: rect(panel), card: rect(card),
        header: rect(panel.querySelector('.fr-video-learning-header')), body: rect(body),
        bodyScrollHeight: body.scrollHeight, bodyClientHeight: body.clientHeight, bodyOverflow: getComputedStyle(body).overflowY,
        original: {text: original.textContent.trim(), bounds: rect(original), fontSize: originalStyle.fontSize,
          lineHeight: originalStyle.lineHeight, textRects, firstLineVisibleHeight,
          readableFirstLine: !!first && firstLineVisibleHeight >= first.height - .5 && original.textContent.trim().length > 0},
        navigation: rect(panel.querySelector('.fr-video-learning-navigation')), footer: rect(panel.querySelector('.fr-video-learning-footer')), controls};
    });
    const screenshot = path.join(artifacts, `${platform}-small-player-${size.width}x${size.height}.png`);
    await player.screenshot({path: screenshot});
    result.sizes.push({...size, ...bounds, screenshot,
      allControlsReachable: bounds.controls.every(control => control.withinCard && control.hitTest)});
    check(result, `Measured actual ${size.width}×${size.height} control bounds and hit tests`, result.sizes.at(-1));
  }
  result.success = result.sizes.every(size => size.allControlsReachable && size.original.readableFirstLine);
  await page.close(); await context.unrouteAll({behavior: 'wait'});
}
async function runReliabilityFixture(platform, mediaData) {
  const result = {platform, scenario: 'reported-keyboard-fullscreen-layout-reliability', checks: []};
  report.fixtureCases.push(result);
  const mediaId = platform === 'youtube' ? 'frReliable1' : '424271';
  const url = platform === 'youtube' ? `https://www.youtube.com/watch?v=${mediaId}` : `https://x.com/fluentread/status/${mediaId}`;
  await context.route(url, route => route.fulfill({contentType: 'text/html', body: fixtureHtml(platform, mediaData)}));
  page = await helper.newPageWithoutForeground(context); await page.goto(url);
  await helper.activateExtensionTabWithoutForeground({serviceWorkers: () => [worker]}, page);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.locator('#fluent-read-video-subtitle-button').waitFor();
  await injectCaptions(platform, cues, mediaId);
  await page.evaluate(() => {
    const player = document.querySelector('#movie_player, [data-testid=videoPlayer]'); player.tabIndex = 0;
    player.addEventListener('click', event => {if (event.target === document.querySelector('video')) player.focus();});
    window.__nativeFixtureKeys = [];
    document.addEventListener('keydown', event => {
      if (event.target.closest?.('textarea,input,select,[contenteditable="true"]')) return;
      if (event.target.closest?.('#fluent-read-video-subtitle-menu')) return;
      if (!['r', 'q', 'ArrowRight', 'ArrowLeft'].includes(event.key)) return;
      window.__nativeFixtureKeys.push(event.key);
      // A conflicting host shortcut has a material effect, so propagation failures are observable.
      const video = document.querySelector('video');
      if (event.key === 'r') video.playbackRate = 1.5;
      else if (event.key === 'q') video.currentTime = 0;
      else video.currentTime = Math.max(0, video.currentTime + (event.key === 'ArrowRight' ? 5 : -5));
    }, true);
  });
  await seek(3.2); await page.locator('#fluent-read-video-subtitle-button').click();
  await page.locator('#fluent-read-video-subtitle-menu').waitFor({state: 'visible'});
  const entry = await page.locator('[data-action="open-sentence-learning"]').evaluate(button => {
    const style = getComputedStyle(button); return {text: button.textContent.trim(), role: button.tagName,
      border: style.borderStyle, background: style.backgroundColor, width: button.getBoundingClientRect().width};
  });
  assert.equal(entry.role, 'BUTTON'); assert.ok(entry.width > 150);
  check(result, 'Sentence learning is a labelled button with an evident interactive affordance', entry);
  await capture(`${platform}-reliability-video-menu`, result);
  await openLearning();
  await page.waitForFunction(() => document.querySelector('[data-learning-original]')?.textContent === 'They use rocks to open shells.');
  if (platform === 'youtube') {
    await page.waitForFunction(() => {
      const translation = document.querySelector('[data-learning-translation-display]');
      return translation?.getAttribute('aria-busy') === 'false' && translation.textContent.trim();
    });
    assert.equal(await action('save').getAttribute('data-learning-saved'), 'false');
    const screenshot = path.join(artifacts, 'youtube-learning-default-panel.png');
    await page.locator('#fluent-read-video-learning-panel section').screenshot({path: screenshot});
    (result.captures ||= []).push({screenshot, scope: 'Initially opened default panel; original and translation; unedited and unsaved'});
  }
  await page.locator('video').click({position: {x: 24, y: 24}});
  await page.keyboard.press('r'); assert.equal((await current()).loop, 'true');
  await page.keyboard.press('q'); assert.equal((await current()).pauseAtEnd, 'true');
  let state = await current(); assert.equal(state.rate, 1); assert.ok(state.time >= 3.15 && state.time < 3.3);
  await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => document.querySelector('[data-learning-original]')?.textContent === '它们生活在海洋里。');
  state = await current(); assert.ok(state.time >= 5.95 && state.time < 6.15);
  assert.deepEqual(await page.evaluate(() => window.__nativeFixtureKeys), []);
  check(result, 'Trusted shortcuts after clicking the video control learning without host speed changes or jumps to video zero', state);
  await page.keyboard.press('ArrowLeft'); await page.waitForFunction(() => document.querySelector('[data-learning-original]')?.textContent === 'They use rocks to open shells.');
  await action('edit-translation').click();
  const input = page.locator('[data-learning-translation]'); await input.fill('普通输入');
  const inputMode = await current(); await page.keyboard.press('r'); await page.keyboard.press('q');
  assert.equal(await input.inputValue(), '普通输入rq');
  assert.equal((await current()).loop, inputMode.loop); assert.equal((await current()).pauseAtEnd, inputMode.pauseAtEnd);
  assert.equal((await current()).rate, 1); await action('done-translation').click();
  check(result, 'Editing text keeps ordinary letter keys in the editor without changing playback assistance or speed');
  await editField('translation', '操作回归草稿。');
  await action('help').click();
  const help = await page.evaluate(() => {
    const help = document.querySelector('[data-learning-help]'); const original = document.querySelector('[data-learning-original]');
    const a = help.getBoundingClientRect(), b = original.getBoundingClientRect();
    return {help: a.toJSON(), original: b.toJSON(), overlap: Math.min(a.right,b.right) > Math.max(a.left,b.left)
      && Math.min(a.bottom,b.bottom) > Math.max(a.top,b.top)};
  });
  assert.equal(help.overlap, false);
  check(result, 'Help is in normal document flow and leaves the original sentence readable', help);
  await action('help').click();
  const player = page.locator('#movie_player, [data-testid=videoPlayer]');
  await player.evaluate(element => {element.style.width = '390px'; element.style.height = '260px';});
  await waitForLearningGeometry();
  await page.waitForFunction(() => document.querySelector('#fluent-read-video-learning-panel')?.dataset.compact === 'true');
  assert.equal(await action('next').isVisible(), true);
  const compactBounds = await page.evaluate(() => {
    const panel = document.querySelector('#fluent-read-video-learning-panel');
    const card = panel.querySelector('.fr-video-learning').getBoundingClientRect();
    const body = panel.querySelector('.fr-video-learning-body');
    return {bodyHeight: body.clientHeight, bodyScrollable: getComputedStyle(body).overflowY === 'auto',
      headerNavigationCount: panel.querySelectorAll('header [data-learning-action="previous"],header [data-learning-action="play"],header [data-learning-action="next"]').length,
      controls: ['previous', 'play', 'next', 'explain', 'save'].map(action => {
        const matches = panel.querySelectorAll(`[data-learning-action="${action}"]`);
        const button = matches[0]; const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {action, count: matches.length, bounds: rect.toJSON(),
          withinCard: rect.top >= card.top && rect.bottom <= card.bottom,
          hitTest: hit === button || button.contains(hit)};
      })};
  });
  assert.equal(compactBounds.headerNavigationCount, 0);
  assert.ok(compactBounds.bodyHeight > 0 && compactBounds.bodyScrollable);
  assert.ok(compactBounds.controls.every(control => control.count === 1 && control.withinCard && control.hitTest),
    `Compact navigation and footer must remain uniquely reachable: ${JSON.stringify(compactBounds)}`);
  const compactCapture = path.join(artifacts, `${platform}-reliability-compact.png`); await player.screenshot({path: compactCapture});
  await player.evaluate(element => {element.style.width = '960px'; element.style.height = '540px';});
  await waitForLearningGeometry();
  await page.waitForTimeout(120); assert.equal(await page.locator('#fluent-read-video-learning-panel').isVisible(), true);
  assert.equal((await current()).translation, '操作回归草稿。');
  check(result, 'Opening at compact player size and enlarging preserves reachable navigation, the panel and current edited draft', {screenshot: compactCapture, compactBounds, state: await current()});
  const heading = page.locator('[data-learning-drag-handle]');
  const before = await heading.boundingBox();
  await page.mouse.move(before.x + 20, before.y + before.height / 2); await page.mouse.down();
  await page.mouse.move(before.x - 220, before.y + 110, {steps: 8}); await page.mouse.up();
  await page.waitForTimeout(100);
  const dragged = await page.locator('#fluent-read-video-learning-panel').boundingBox();
  assert.ok(dragged.x < before.x - 140, `Panel did not move to user position: ${JSON.stringify({before, dragged})}`);
  await actualFullscreen();
  assert.equal(await page.locator('#fluent-read-video-learning-panel').isVisible(), true);
  assert.equal((await current()).translation, '操作回归草稿。');
  const beforeMenu = await current();
  await page.locator('#fluent-read-video-subtitle-button').click();
  const fullscreenMenu = page.locator('#fluent-read-video-subtitle-menu'); await fullscreenMenu.waitFor({state: 'visible'});
  assert.equal(await page.locator('#fluent-read-video-learning-panel').isVisible(), true,
    'Opening the subtitle menu must keep the learning panel mounted in fullscreen');
  assert.equal((await current()).translation, '操作回归草稿。');
  await fullscreenMenu.locator('[data-mode="original-only"]').focus();
  await fullscreenMenu.evaluate(menu => {
    window.__menuFixtureArrowKeys = [];
    menu.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      window.__menuFixtureArrowKeys.push(event.key);
    });
  });
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
  assert.deepEqual(await page.evaluate(() => window.__menuFixtureArrowKeys), ['ArrowLeft', 'ArrowRight'],
    'Menu-focused arrow keys reach the menu instead of being consumed by the learning window listener');
  assert.equal((await current()).sentenceId, beforeMenu.sentenceId);
  assert.equal((await current()).translation, '操作回归草稿。');
  assert.ok(Math.abs((await current()).time - beforeMenu.time) < .05);
  check(result, 'Arrow keys focused inside the subtitle menu keep menu ownership without stepping the learning sentence or changing its draft');
  await fullscreenMenu.locator('[data-mode="translation-only"]').click();
  await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle-menu [data-mode="translation-only"]')?.getAttribute('aria-checked') === 'true');
  assert.equal((await current()).translation, '操作回归草稿。');
  assert.equal((await current()).sentenceId, beforeMenu.sentenceId);
  assert.equal((await current()).startMs, beforeMenu.startMs); assert.equal((await current()).endMs, beforeMenu.endMs);
  assert.equal((await current()).loop, beforeMenu.loop); assert.equal((await current()).pauseAtEnd, beforeMenu.pauseAtEnd);
  assert.equal((await current()).rate, beforeMenu.rate);
  await fullscreenMenu.locator('[data-mode="original-only"]').click();
  await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle-menu [data-mode="original-only"]')?.getAttribute('aria-checked') === 'true');
  await fullscreenMenu.locator('[data-action="close-menu"]').click();
  await fullscreenMenu.waitFor({state: 'hidden'});
  check(result, 'The subtitle menu opens and switches display mode in actual fullscreen without changing the selected source range or draft', await current());
  await page.evaluate(() => document.activeElement?.blur());
  assert.equal(await page.evaluate(() => document.activeElement === document.body || document.activeElement === document.documentElement), true);
  await page.keyboard.press('r'); assert.equal((await current()).loop, 'true');
  await page.keyboard.press('q'); assert.equal((await current()).pauseAtEnd, 'true');
  assert.equal((await current()).rate, 1); assert.deepEqual(await page.evaluate(() => window.__nativeFixtureKeys), []);
  assert.equal((await current()).translation, '操作回归草稿。');
  check(result, 'Body focus during fullscreen keeps learning shortcuts scoped to its fullscreen media without reaching conflicting host shortcuts');
  await capture(`${platform}-reliability-fullscreen`, result);
  await page.locator('video').click({position: {x: 24, y: 24}});
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.fullscreenElement, null, {timeout: 15000});
  await waitForLearningGeometry();
  assert.equal(await page.locator('#fluent-read-video-learning-panel').isVisible(), true);
  assert.equal((await current()).translation, '操作回归草稿。');
  const afterFullscreen = await page.locator('#fluent-read-video-learning-panel').boundingBox();
  assert.ok(Math.abs(afterFullscreen.x - dragged.x) < 3 && Math.abs(afterFullscreen.y - dragged.y) < 3,
    `Session drag position must recover after fullscreen: ${JSON.stringify({dragged, afterFullscreen})}`);
  check(result, 'Actual fullscreen preserves the draft and drag position; trusted Escape exits fullscreen before closing learning', {dragged, afterFullscreen});
  await page.locator('#fluent-read-video-subtitle-button').click();
  await fullscreenMenu.waitFor({state: 'visible'});
  await page.keyboard.press('Escape'); await fullscreenMenu.waitFor({state: 'hidden'});
  assert.equal(await page.locator('#fluent-read-video-learning-panel').isVisible(), true);
  assert.equal((await current()).translation, '操作回归草稿。');
  check(result, 'Outside fullscreen Escape closes the open subtitle menu first and keeps the learning panel and draft');
  // Keep the exact media node/source while creating the inner fullscreen host used by site player transitions.
  await page.evaluate(() => {
    const video = document.querySelector('video'); const current = video.parentElement;
    const inner = document.createElement('div'); inner.id = 'fixture-inner-media'; inner.style.cssText = 'width:100%;height:100%;position:relative';
    current.insertBefore(inner, video); inner.appendChild(video);
  });
  const cdp = await context.newCDPSession(page);
  try {await withDeadline(cdp.send('Runtime.evaluate', {expression: 'document.querySelector("#fixture-inner-media").requestFullscreen()', userGesture: true, awaitPromise: true}), 15000, 'Inner fullscreen request');}
  finally {if (context.browser()?.isConnected()) await withDeadline(cdp.detach(), 1500, 'Inner fullscreen detach');}
  await page.waitForFunction(() => document.fullscreenElement?.id === 'fixture-inner-media');
  await page.waitForFunction(() => document.querySelector('#fluent-read-video-learning-panel')?.parentElement?.id === 'fixture-inner-media');
  assert.equal((await current()).translation, '操作回归草稿。');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.waitForFunction(() => document.querySelector('#fluent-read-video-learning-panel')?.parentElement === document.querySelector('#movie_player, [data-testid=videoPlayer]'));
  check(result, 'A same-media inner fullscreen host reparents the existing learning instance and keeps drafts');
  await page.locator('video').click({position: {x: 24, y: 24}}); await page.keyboard.press('Escape');
  await page.locator('#fluent-read-video-learning-panel').waitFor({state: 'detached'});
  await page.keyboard.press('r'); assert.deepEqual(await page.evaluate(() => window.__nativeFixtureKeys), ['r']);
  assert.equal((await current()).rate, 1.5); await page.evaluate(() => {document.querySelector('video').playbackRate = 1;});
  check(result, 'Outside fullscreen Escape closes learning and releases host keyboard ownership');
  await seek(8.3); await openLearning();
  await page.waitForFunction(() => document.querySelector('[data-learning-original]')?.textContent === 'A quiet final sentence.');
  await page.locator('video').click({position: {x: 24, y: 24}}); await page.keyboard.press('r');
  state = await current(); assert.ok(state.time >= 8.25 && state.time < 8.4); assert.equal(state.rate, 1);
  await page.keyboard.press('q'); state = await current(); assert.ok(state.time >= 8.25 && state.time < 8.4);
  check(result, 'Selecting loop or end pause arms the current original range without seeking to time zero', state);
  await action('normal').click(); await action('play').click();
  await page.waitForFunction(() => !document.querySelector('video').paused && document.querySelector('video').currentTime > 8.25);
  await action('close').click(); await page.waitForFunction(() => document.querySelector('video').currentTime > 9.2, null, {timeout: 4000});
  assert.equal((await current()).rate, 1);
  check(result, 'Closing learning cancels range ownership and leaves normal 1x playback advancing', await current());
  await page.evaluate(() => document.querySelector('video').pause());
  if (platform === 'youtube') await runAppearanceReliability(result, mediaId);
  result.success = true; await page.close(); page = null; await context.unrouteAll({behavior: 'wait'});
}
async function runOperationImprovementFixture(platform, mediaData) {
  const result = {platform, scenario: 'operation-improvements', source: 'controlled UI operation timeline, actual production inputs and real decoded media', checks: []};
  report.fixtureCases.push(result);
  await patchConfig({videoSubtitleDisplayMode: 'original-only'});
  const text = index => `UX ${platform} original sentence ${String(index).padStart(5, '0')}.`;
  const captionCues = Array.from({length: 40}, (_, index) => ({startMs: index * 350, durationMs: 320, text: text(index)}));
  await createPerformancePage(platform, mediaData, captionCues, 'operation-improvements');
  await openLearning();
  const translated = async index => page.waitForFunction(source => document.querySelector('[data-learning-translation-display]')?.textContent.includes(source), text(index));
  await translated(0);
  let requests = await providerCount();
  await page.evaluate(() => {
    window.__trustedSteppingEvents = [];
    document.addEventListener('click', event => {
      if (event.target.closest?.('[data-learning-action="next"]')) {
        window.__trustedSteppingEvents.push({trusted: event.isTrusted, time: performance.now()});
      }
    }, true);
  });
  const stepTimes = [];
  for (let index = 0; index < 12; index++) {stepTimes.push(Date.now());await action('next').click({force: true});await page.waitForTimeout(30);}
  await translated(12);
  assert.equal((await current()).index, '12');
  result.rapidStepping = {requestCount: await providerCount() - requests,
    commandIntervalsMs: stepTimes.slice(1).map((time, index) => time - stepTimes[index]),
    events: await page.evaluate(() => window.__trustedSteppingEvents)};
  result.rapidStepping.trustedEventIntervalsMs = result.rapidStepping.events.slice(1)
    .map((event, index) => event.time - result.rapidStepping.events[index].time);
  assert.equal(result.rapidStepping.events.length, 12);
  assert.ok(result.rapidStepping.events.every(event => event.trusted), 'The coalescing sequence uses actual trusted clicks');
  assert.equal(result.rapidStepping.requestCount, 1, 'Rapid stepping starts only the final confirmed source translation');
  requests = await providerCount();
  await page.evaluate(async () => {for (let index = 0; index < 12; index++) document.querySelector('[data-learning-action="next"]').click();await Promise.resolve();await Promise.resolve();});
  await translated(24);
  assert.equal((await current()).index, '24');
  assert.equal(await providerCount() - requests, 1, 'The synchronous click burst preserves the last selection and makes one request');
  check(result, 'Rapid trusted stepping and a synchronous microtask burst immediately select the final source and coalesce translation transport');
  requests = await providerCount();
  await action('next').click({force: true});
  await action('collapse').click({force: true});
  await page.waitForTimeout(250);
  assert.equal(await providerCount(), requests, 'Collapsing cancels the queued translation before it starts');
  await page.locator('#fluent-read-video-learning-panel section').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  assert.equal((await current()).index, '26');
  assert.equal(await providerCount(), requests, 'A hidden automatic selection does not start a new translation');
  await action('collapse').click({force: true});
  await translated(26);
  assert.equal(await providerCount() - requests, 1, 'Expanding translates only the current empty source once');
  requests = await providerCount();
  await action('next').click({force: true});
  await action('close').click({force: true});
  await page.waitForTimeout(250);
  assert.equal(await providerCount(), requests, 'Closing cancels the pending step timer');
  assert.equal(await page.locator('#fluent-read-video-learning-panel').count(), 0);
  check(result, 'Collapsed and closed panels release queued translation; hidden stepping waits until expansion to translate the current source');
  await openLearning();
  await translated(27);
  const player = page.locator('#movie_player, [data-testid=videoPlayer]');
  await player.evaluate(element => {element.style.width = '390px';element.style.height = '260px';});
  await waitForLearningGeometry();
  for (const name of ['previous', 'next', 'play', 'close']) {
    assert.equal(await action(name).isVisible(), true);
    assert.equal(await action(name).evaluate(element => {
      const rect = element.getBoundingClientRect();return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    }), true, `Compact ${name} remains directly reachable`);
  }
  await page.locator('.fr-video-learning-body').evaluate(element => {element.scrollTop = element.scrollHeight;});
  assert.ok(await page.locator('.fr-video-learning-body').evaluate(element => element.scrollTop) > 0);
  await action('next').click({force: true});
  await page.waitForFunction(() => document.querySelector('[data-learning-sentence-index]')?.dataset.learningSentenceIndex === '28');
  assert.equal(await page.locator('.fr-video-learning-body').evaluate(element => element.scrollTop), 0, 'New source starts at the top of its reading body');
  const originalVisible = await page.locator('[data-learning-original]').evaluate(element => {
    const rect = element.getBoundingClientRect();const body = element.closest('.fr-video-learning-body').getBoundingClientRect();return rect.top >= body.top && rect.bottom <= body.bottom + 1;
  });
  assert.equal(originalVisible, true);
  await action('previous').click({force: true});
  await page.waitForFunction(() => document.querySelector('[data-learning-sentence-index]')?.dataset.learningSentenceIndex === '27');
  await page.locator('#fluent-read-video-learning-panel section').focus();
  await page.keyboard.press('r');assert.equal((await current()).loop, 'true');
  await page.keyboard.press('q');assert.equal((await current()).pauseAtEnd, 'true');
  await page.keyboard.press('ArrowRight');assert.equal((await current()).index, '28');
  assert.equal((await current()).paused, true);
  check(result, 'Compact previous/next controls stay reachable, reset the reading scroll to the complete source and preserve keyboard playback assistance');
  await action('close').click();
  result.success = true;
  await page.close();page = null;await context.unrouteAll({behavior: 'wait'});
  await patchConfig({videoSubtitleDisplayMode: 'bilingual'});
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
  await page.locator('#fluent-read-video-subtitle-button').click();
  await page.locator('#fluent-read-video-subtitle-menu').waitFor({state: 'visible'});
  const menuStyle = await page.locator('#fluent-read-video-subtitle-menu').evaluate(element => {
    const computed = getComputedStyle(element);
    const names = ['brand', 'brand-strong', 'brand-strong-hover', 'brand-text', 'brand-soft', 'surface', 'border', 'radius', 'shadow', 'text', 'muted', 'control', 'control-hover'];
    return {background: computed.backgroundColor, borderColor: computed.borderColor, borderRadius: computed.borderRadius,
      boxShadow: computed.boxShadow, fontFamily: computed.fontFamily, color: computed.color,
      tokens: Object.fromEntries(names.map(name => [name, computed.getPropertyValue(`--fr-video-menu-${name}`).trim()]))};
  });
  await capture(`${platform}-video-menu`, result);
  await openLearning();
  await page.waitForFunction(() => document.querySelector('[data-learning-sentence-id]')?.textContent.includes('Sea otters have strong teeth.'));
  await page.waitForFunction(() => document.querySelector('[data-learning-translation-display]')?.textContent.trim() === '海獭有强有力的牙齿。');
  let state = await current();
  await page.mouse.move(4, 4);
  await page.waitForFunction(() => {
    const save = document.querySelector('[data-learning-action="save"]');
    return save && !save.matches(':hover') && getComputedStyle(save).backgroundColor === 'rgb(220, 49, 95)';
  }, null, {timeout: 5000});
  const style = await page.locator('#fluent-read-video-learning-panel section').evaluate(element => {
    const computed = getComputedStyle(element);
    const names = ['brand', 'brand-strong', 'brand-strong-hover', 'brand-text', 'brand-soft', 'surface', 'border', 'radius', 'shadow', 'text', 'muted', 'control', 'control-hover'];
    const save = getComputedStyle(element.querySelector('[data-learning-action="save"]'));
    const replayButton = element.querySelector('[data-learning-action="play"]');
    const replay = getComputedStyle(replayButton);
    const nav = element.querySelector('.fr-video-learning-navigation').getBoundingClientRect();
    const body = element.querySelector('.fr-video-learning-body').getBoundingClientRect();
    const footer = element.querySelector('footer').getBoundingClientRect();
    return {fontSize: computed.fontSize, background: computed.backgroundColor, borderColor: computed.borderColor,
      borderRadius: computed.borderRadius, boxShadow: computed.boxShadow, fontFamily: computed.fontFamily, color: computed.color,
      saveBackground: save.backgroundColor, saveColor: save.color, replayColor: replay.color,
      tokens: Object.fromEntries(names.map(name => [name, computed.getPropertyValue(`--fr-video-menu-${name}`).trim()])),
      modeLabel: element.querySelector('.fr-video-learning-mode[role="group"]')?.getAttribute('aria-label'),
      footerActions: Array.from(element.querySelectorAll('.fr-video-learning-footer-actions [data-learning-action]')).map(button => button.dataset.learningAction),
      navigation: {top: nav.top, bottom: nav.bottom, bodyBottom: body.bottom, footerTop: footer.top,
        headerButtons: element.querySelectorAll('header [data-learning-action="previous"], header [data-learning-action="play"], header [data-learning-action="next"]').length},
      translationDisplay: getComputedStyle(element.querySelector('[data-learning-translation-display]')).display,
      editors: element.querySelectorAll('[data-learning-translation], [data-learning-explanation]').length};
  });
  assert.equal(style.fontSize, '13px');
  assert.notEqual(style.background, 'rgba(0, 0, 0, 0)');
  assert.equal(style.translationDisplay, 'block');
  assert.equal(style.editors, 0, 'Translation and explanation start in reading mode');
  assert.equal(style.modeLabel, '播放辅助');
  assert.deepEqual(style.footerActions, ['explain', 'save'], 'The persistent footer exposes only explanation and collection');
  assert.equal(style.navigation.headerButtons, 0, 'Previous, replay and next belong below the content instead of the title bar');
  assert.ok(style.navigation.top >= style.navigation.bodyBottom - 1 && style.navigation.bottom <= style.navigation.footerTop + 1,
    'The unique visible navigation row sits after the reading content and before the two footer actions');
  assert.equal(await page.locator('.fr-video-learning-mode[role="group"]').isVisible(), true);
  check(result, 'Production content-script styles keep the learning panel readable independently of host CSS', style);
  assert.deepEqual(style.tokens, menuStyle.tokens, 'Learning inherits the existing video menu local appearance tokens');
  assert.equal(style.background, 'rgba(24, 24, 28, 0.94)', 'The learning-specific default opacity keeps the established video surface hue');
  for (const name of ['borderColor', 'borderRadius', 'boxShadow', 'fontFamily', 'color']) {
    assert.equal(style[name], menuStyle[name], `Learning and the existing video menu share ${name}`);
  }
  assert.equal(style.tokens.brand, '#ef4776');
  assert.equal(style.tokens.surface, '#18181c');
  assert.equal(style.saveBackground, 'rgb(220, 49, 95)');
  assert.equal(style.saveColor, 'rgb(255, 255, 255)');
  assert.equal(style.replayColor, 'rgb(255, 173, 194)');
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
  const originalExplanation = await fieldDisplay('explanation').textContent();
  await editField('explanation', `> ${originalExplanation.trim()}`);
  const quoteStyle = await fieldDisplay('explanation').locator('blockquote').evaluate(element => {
    const computed = getComputedStyle(element);
    const panel = getComputedStyle(document.querySelector('#fluent-read-video-learning-panel section'));
    return {fontSize: computed.fontSize, color: computed.color, borderColor: computed.borderInlineStartColor,
      borderWidth: computed.borderInlineStartWidth, hostTextVariable: getComputedStyle(document.body).getPropertyValue('--el-text-color-regular').trim(),
      panelTextVariable: panel.getPropertyValue('--el-text-color-regular').trim(), panelQuoteBorderVariable: panel.getPropertyValue('--el-color-primary-light-5').trim()};
  });
  result.appearance = {menu: menuStyle, learning: style, quote: quoteStyle};
  assert.equal(quoteStyle.fontSize, '13px');
  assert.equal(quoteStyle.color, style.color, 'The actual rendered quote keeps local readable text despite hostile host Element variables');
  assert.equal(quoteStyle.borderColor, 'rgb(255, 173, 194)');
  assert.equal(quoteStyle.borderWidth, '3px');
  assert.notEqual(quoteStyle.hostTextVariable, quoteStyle.panelTextVariable);
  await editField('explanation', originalExplanation);
  check(result, 'Learning and the existing video menu share FluentRead appearance and readable quotes independently of host Element variables', {menu: menuStyle, learning: style, quote: quoteStyle});
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
    const card = host.querySelector('section').getBoundingClientRect();
    return host.contains(document.elementFromPoint(card.left + card.width / 2, card.bottom + 4));
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
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-learning-action="save"]');
    return button?.disabled && button.textContent.includes('已收藏');
  });
  assert.equal(await action('save').isDisabled(), true, 'An unchanged collected sentence cannot start a redundant save');
  assert.equal(await action('library').isVisible(), true, 'A successfully saved sentence exposes its learning-center follow-up');
  assert.equal(await action('library').evaluate(button => button.closest('footer') === null), true,
    'The learning-center follow-up belongs to the saved status, leaving two persistent footer actions');
  await page.waitForTimeout(100);
  const repeated = await readEntry();
  assert.deepEqual(repeated.data, entry, 'The unchanged collected sentence does not modify its persisted record');
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
  await waitForLearningGeometry();
  await page.locator('[data-learning-original]').scrollIntoViewIfNeeded();
  await action('play').waitFor({state: 'visible'});
  await action('play').click();
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
      hostOverflowY: getComputedStyle(host).overflowY, overflowY: getComputedStyle(body).overflowY,
      saveVisible: host.contains(document.elementFromPoint(point.left + point.width / 2, point.top + point.height / 2))};
  });
  assert.ok(compact.panel.left >= compact.player.left && compact.panel.right <= compact.player.right + 1);
  assert.ok(compact.panel.bottom <= compact.player.bottom - 48 && !compact.overflowX && compact.saveVisible, JSON.stringify(compact));
  assert.equal(compact.overflowY, 'auto');
  assert.ok(compact.original.top >= compact.body.top && compact.original.bottom <= compact.body.bottom + 1, 'The complete original sentence must fit the visible compact reading body');
  const compactScreenshot = path.join(artifacts, `${platform}-learning-compact.png`);
  await player.screenshot({path: compactScreenshot});
  check(result, 'A 390px player keeps learning inside its bounds with scrollable content, reachable saving and space for native controls', {...compact, screenshot: compactScreenshot});
  await player.evaluate((element, saved) => saved === null ? element.removeAttribute('style') : element.setAttribute('style', saved), previousStyle);
  currentPhase = `${platform}: requesting actual browser fullscreen`;
  process.stdout.write(`${currentPhase}\n`);
  const cdp = await context.newCDPSession(page);
  try {
    await withDeadline(cdp.send('Runtime.evaluate', {expression: 'document.querySelector("#movie_player, [data-testid=videoPlayer]").requestFullscreen()', userGesture: true, awaitPromise: true}), 15000, 'Actual browser fullscreen request');
  } finally {
    if (context.browser()?.isConnected()) await withDeadline(cdp.detach(), 1500, 'Fullscreen CDP detach');
  }
  await page.waitForFunction(() => Boolean(document.fullscreenElement), null, {timeout: 15000});
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
      videos: [...document.querySelectorAll('video')].map(video => ({time: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : null, paused: video.paused, networkState: video.networkState, readyState: video.readyState, tracks: [...video.textTracks].map(track => ({language: track.language, cues: track.cues?.length, mode: track.mode}))}))}));
    const firstVideo = page.locator('video').first();
    const captionButton = page.locator('.ytp-subtitles-button');
    if (platform === 'youtube' && await captionButton.count() && await captionButton.isVisible()) {
      if (await captionButton.getAttribute('aria-pressed') !== 'true') await captionButton.click();
      const playButton = page.locator('.ytp-play-button');
      if (await firstVideo.count() && await firstVideo.evaluate(video => video.paused)
          && await playButton.count() && await playButton.isVisible()) await playButton.click();
      await page.waitForTimeout(5000);
    }
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
      captionButton: document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed'), sourceStatus: document.querySelector('[data-source-status]')?.textContent,
      videos: [...document.querySelectorAll('video')].map(video => ({time: video.currentTime, paused: video.paused, readyState: video.readyState, networkState: video.networkState}))}));
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
  const browser = context.browser();
  const onDisconnected = () => {
    report.browserDisconnected = {unexpected: true, phase: currentPhase, time: new Date().toISOString()};
    rejectBrowserDisconnected(focusFailure || new Error(`Owned browser disconnected during ${currentPhase}`));
  };
  browser.once('disconnected', onDisconnected);
  stopDisconnectObservation = () => browser.off('disconnected', onDisconnected);
  if (performanceOnly || runtimePerformanceOnly) report.performance.browserVersion = context.browser()?.version() || 'CDP Edge';
  Object.assign(report, {launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement});
  assert.equal(report.windowPlacement.browserFrontmost, false, 'Focus-safe browser must stay in background');
  context.on('page', candidate => candidate.on('pageerror', error => report.pageErrors.push({message: error.message, stack: error.stack, url: candidate.url(), phase: currentPhase})));
  worker = context.serviceWorkers().find(candidate => candidate.url().endsWith('/background.js'))
    || await context.waitForEvent('serviceworker', {predicate: candidate => candidate.url().endsWith('/background.js')});
  extensionId = new URL(worker.url()).host;
  await worker.evaluate(({mapping, performanceOnly}) => {
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
      if (performanceOnly) await new Promise(resolve => setTimeout(resolve, 120));
      if (sources.includes(globalThis.sentenceFixtureHoldText)) await new Promise(resolve => globalThis.sentenceFixtureHeld.push(resolve));
      return new Response(JSON.stringify(sources.map(source => ({translations: [{text: mapping[source] || `固定译文：${source}`}]}))), {status: 200, headers: {'content-type': 'application/json'}});
    };
  }, {mapping: translations, performanceOnly: performanceOnly || runtimePerformanceOnly});
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
    if (runtimePerformanceOnly) {
      await patchConfig({videoSubtitleDisplayMode: 'original-only'});
      for (const platform of platforms) await runRuntimePerformanceFixtures(platform, mediaData);
    } else if (appearanceOnly) {
      await runAppearanceFixture(mediaData);
    } else if (fullscreenEscapeProbeOnly) {
      for (const platform of platforms) await runFullscreenEscapeProbe(platform, mediaData);
    } else if (compactProbeOnly) {
      for (const platform of platforms) await runCompactPlayerProbe(platform, mediaData);
    } else if (reliabilityOnly) {
      for (const platform of platforms) await runReliabilityFixture(platform, mediaData);
    } else if (performanceOnly) {
      await patchConfig({videoSubtitleDisplayMode: 'original-only'});
      for (const platform of platforms) await runPerformanceFixtures(platform, mediaData);
    } else {
      for (const platform of platforms) {await runFixture(platform, mediaData);await runOperationImprovementFixture(platform, mediaData);}
      if (platforms.includes('youtube')) await runTranslatedOnlyYoutubeFixture(mediaData);
      if (platforms.includes('x')) await runXSourceIdentityFixtures(mediaData);
    }
    report.fixturePageErrors = [...report.pageErrors];
    assert.deepEqual(report.fixturePageErrors, [], 'Controlled fixture pages must not emit runtime errors');
  }
  for (const live of liveUrls) await probeLive(live);
  if (focusFailure || focusMonitor.error) throw focusFailure || focusMonitor.error;
  const foreground = await helper.queryMacFrontmostApplication();
  assert.ok(foreground && foreground.pid !== browserPid, 'Owned browser must stay in background');
  report.finalBrowserFrontmost = false;
  report.success = performanceOnly || runtimePerformanceOnly ? report.performanceCases.every(result => result.success) : liveOnly ? report.liveCases.every(result => result.success) : report.fixtureCases.every(result => result.success);
  if (!report.success) process.exitCode = 1;
}
Promise.race([main(), browserDisconnected]).catch(async error => {
  report.failure = error.stack || String(error);
  if ('actual' in error && 'expected' in error) report.failureComparison = {actual: error.actual, expected: error.expected, operator: error.operator};
  if (page && !page.isClosed() && context?.browser()?.isConnected()) {
    report.failureState = await current().catch(() => null);
    await capture('failure', report).catch(() => {});
  }
  process.exitCode = 1;
}).finally(async () => {
  stopDisconnectObservation?.();
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
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({success: report.success,
    ...(performanceOnly || runtimePerformanceOnly ? {performanceCases: report.performanceCases.map(result => ({platform: result.platform, scenario: result.scenario, success: Boolean(result.success)}))} : {}),
    fixtureCases: report.fixtureCases.map(result => ({platform: result.platform, ...(result.scenario ? {scenario: result.scenario} : {}), success: Boolean(result.success), checks: result.checks.length})),
    liveCases: report.liveCases.map(result => ({platform: result.platform, url: result.url, success: result.success,
      captionResponses: result.captionResponses?.length, limitation: result.limitation, failure: result.failure})),
    failure: report.failure?.split('\n')[0], focusEvents: report.focusEvents, cleanup: report.cleanup,
    report: path.join(artifacts, 'report.json')}, null, 2)}\n`);
});

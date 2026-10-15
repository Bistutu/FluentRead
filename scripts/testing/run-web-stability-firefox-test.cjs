#!/usr/bin/env node
/**
 * @file scripts/testing/run-web-stability-firefox-test.cjs
 * 文件职责：使用真实 Firefox MV2 生产扩展验证网页翻译生命周期，并保留可审核的窗口与协议证据。
 * 主要内容：独立临时 profile、后台第二屏窗口、原生焦点事件监控、有界 Marionette RPC、受控本地供应商、翻译恢复重译、动态正文、取消、窄屏深色及可选实站。
 * 模块边界：只安装传入产物、只写本次临时配置；不触碰日常 Firefox，不把确定性译文当供应商质量、不把桌面窄屏当移动真机。
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {createHash} = require('node:crypto');
const {startFocusEventMonitor, queryMacFrontmostApplication} = require('./focus-safe-browser.cjs');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
const execute = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const unbox = result => result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result;

/** Mozilla protocol v3: byte-length-prefixed UTF-8, IDs associate out-of-order responses. */
class MarionetteClient {
  constructor(socket, timeout = 30000) {
    this.socket = socket; this.timeout = timeout; this.pending = new Map(); this.sequence = 0; this.buffer = Buffer.alloc(0);
    this.closed = false;
    socket.on('data', chunk => this.receive(chunk));
    socket.on('error', error => this.fail(error));
    socket.on('close', () => this.fail(new Error('Marionette transport closed')));
  }
  fail(error) {
    this.closed = true;
    for (const entry of this.pending.values()) {clearTimeout(entry.timer); entry.reject(error);}
    this.pending.clear();
  }
  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 32 * 1024 * 1024) {this.fail(new Error('Marionette frame exceeded 32 MiB')); this.socket.destroy(); return;}
    while (this.buffer.length) {
      const colon = this.buffer.indexOf(':');
      if (colon < 0) return;
      const prefix = this.buffer.subarray(0, colon).toString('ascii');
      if (!/^\d{1,9}$/u.test(prefix)) {this.fail(new Error('Malformed Marionette frame prefix')); this.socket.destroy(); return;}
      const length = Number(prefix);
      if (length > 32 * 1024 * 1024) {this.fail(new Error('Marionette frame too large')); this.socket.destroy(); return;}
      if (this.buffer.length < colon + 1 + length) return;
      const bytes = this.buffer.subarray(colon + 1, colon + 1 + length);
      this.buffer = this.buffer.subarray(colon + 1 + length);
      let packet;
      try {packet = JSON.parse(bytes.toString('utf8'));}
      catch (error) {this.fail(error); this.socket.destroy(); return;}
      if (!Array.isArray(packet)) {this.greeting = packet; continue;}
      if (packet[0] !== 1) continue;
      const entry = this.pending.get(packet[1]);
      if (!entry) continue;
      this.pending.delete(packet[1]); clearTimeout(entry.timer);
      if (packet[2]) entry.reject(new Error(`${entry.command}: ${JSON.stringify(packet[2])}`));
      else entry.resolve(packet[3]);
    }
  }
  send(command, parameters = {}, timeout = this.timeout) {
    if (this.closed) return Promise.reject(new Error('Marionette transport is closed'));
    const id = ++this.sequence;
    const body = JSON.stringify([0, id, command, parameters]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error(`Marionette command timed out: ${command} (${timeout}ms)`));
      }, timeout);
      this.pending.set(id, {resolve, reject, timer, command});
      this.socket.write(`${Buffer.byteLength(body)}:${body}`, error => {
        if (!error) return;
        const entry = this.pending.get(id); if (!entry) return;
        this.pending.delete(id); clearTimeout(timer); reject(error);
      });
    });
  }
  close() {this.fail(new Error('Marionette client disposed')); this.socket.destroy();}
}

function parseArgs(argv) {
  const args = {live: false, timeout: 45000, firefoxApp: '/Applications/Firefox.app', liveUrl: 'https://www.postgresql.org/docs/current/tutorial-sql-intro.html',
    liveSelector: '#docContent h2.title, #docContent p', liveProtected: '#docContent pre, #docContent code'};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (token === '--help') return {...args, help: true};
    if (token === '--live') {args.live = true; continue;}
    if (token === '--headed' || token === '--headless') throw new Error('Only visible background Firefox is supported');
    const value = argv[++index];
    assert.ok(token.startsWith('--') && value && !value.startsWith('--'), `Missing value: ${token}`);
    args[token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  args.timeout = Number(args.timeout);
  assert.ok(Number.isFinite(args.timeout) && args.timeout >= 5000 && args.timeout <= 180000, 'timeout must be 5000–180000');
  assert.ok(args.extensionDir && args.artifactsDir, '--extension-dir and --artifacts-dir are required');
  return args;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
async function connect(port, timeout) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    const socket = await new Promise(resolve => {
      const candidate = net.connect({host: '127.0.0.1', port});
      candidate.setTimeout(1000);
      candidate.once('connect', () => {candidate.setTimeout(0); resolve(candidate);});
      candidate.once('timeout', () => {candidate.destroy(); resolve(null);});
      candidate.once('error', error => {lastError = error; candidate.destroy(); resolve(null);});
    });
    if (socket) return new MarionetteClient(socket, timeout);
    await delay(200);
  }
  throw new Error(`Firefox Marionette did not start: ${String(lastError || '')}`);
}

async function secondaryDisplay() {
  const {stdout} = await execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
    "ObjC.import('AppKit'); const all=$.NSScreen.screens; const main=all.objectAtIndex(0).frame; const screens=[]; for(let i=0;i<Number(all.count);i++){ const r=all.objectAtIndex(i).visibleFrame; screens.push({index:i,left:Number(r.origin.x),top:Number(main.origin.y+main.size.height-r.origin.y-r.size.height),width:Number(r.size.width),height:Number(r.size.height)}); } JSON.stringify(screens);"], {timeout: 5000});
  const screens = JSON.parse(stdout.trim());
  assert.ok(screens.length >= 2, 'A secondary display is required; no foreground fallback');
  return screens[1];
}

async function processIdentity(pid, profile, executable) {
  let stdout;
  try {
    ({stdout} = await execute('/bin/ps', ['-ww', '-p', String(pid), '-o', 'pid=', '-o', 'lstart=', '-o', 'command='],
      {timeout: 2000, env: {...process.env, LC_ALL: 'C'}}));
  } catch (error) {if (error.code === 1 && !error.stdout && !error.stderr) return null; throw error;}
  const match = stdout.trim().match(/^(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/u);
  assert.ok(match && Number(match[1]) === pid, 'Unable to read exact Firefox process identity');
  assert.ok(match[3].startsWith(`${executable} `), 'Process is not the requested Firefox main executable');
  const tokens = match[3].split(/\s+/u), index = tokens.indexOf('-profile');
  assert.ok(index >= 0 && fs.realpathSync(tokens[index + 1]) === profile && tokens.filter(value => value === tokens[index + 1]).length === 1,
    'Firefox process does not own the exact temporary profile');
  return {pid, started: match[2].replace(/\s+/g, ' '), command: match[3]};
}
async function profileProcesses(profile) {
  const {stdout} = await execute('/bin/ps', ['-axww', '-o', 'pid=', '-o', 'command='], {timeout: 2000});
  return stdout.split('\n').map(line => line.trim().match(/^(\d+)\s+(.+)$/u)).filter(match => {
    if (!match) return false;
    const tokens = match[2].split(/\s+/u), index = tokens.indexOf('-profile');
    if (index < 0 || !tokens[index + 1]) return false;
    try {return fs.realpathSync(tokens[index + 1]) === profile;} catch {return false;}
  }).map(match => ({pid: Number(match[1]), command: match[2]}));
}
async function captureLaunchedOwner(profile, executable, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const matches = (await profileProcesses(profile)).filter(process => process.command.startsWith(`${executable} `));
    assert.ok(matches.length <= 1, 'Multiple processes claim the new temporary profile; refusing ambiguous ownership');
    if (matches.length === 1) return processIdentity(matches[0].pid, profile, executable);
    await delay(100);
  }
  throw new Error('The Firefox process for the exact temporary profile could not be identified');
}
async function captureListenerOwner(port, profile, executable, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    let stdout = '';
    try {({stdout} = await execute('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {timeout: 2000}));}
    catch (error) {if (error.code !== 1 || error.stderr) throw error;}
    const pids = [...new Set(stdout.trim().split(/\s+/u).filter(Boolean).map(Number))];
    assert.ok(pids.length <= 1, 'Marionette port has ambiguous listener ownership');
    if (pids.length === 1) {
      assert.ok(Number.isSafeInteger(pids[0]) && pids[0] > 0, 'Invalid listener PID');
      return processIdentity(pids[0], profile, executable);
    }
    await delay(100);
  }
  throw new Error('No exact-profile Firefox owns the Marionette listening port');
}
async function stopOwnedFirefox(owner, profile, executable) {
  if (!owner) return false;
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    const current = await processIdentity(owner.pid, profile, executable);
    if (!current) return true;
    assert.deepEqual(current, owner, 'Firefox process identity changed; refusing to signal it');
    try {process.kill(owner.pid, signal);} catch (error) {if (error.code !== 'ESRCH') throw error;}
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await delay(100);
      if (!await processIdentity(owner.pid, profile, executable)) return true;
    }
  }
  throw new Error('Owned Firefox did not exit; its profile is retained');
}

function fixtureHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Firefox reading stability</title><style>
  :root{color-scheme:light dark}body{max-width:860px;margin:30px auto;padding:0 20px;font:18px/1.65 system-ui;background:#fff;color:#222}p{margin:22px 0}pre{white-space:pre-wrap}a{color:#0670c5}@media(prefers-color-scheme:dark){body{background:#15191f;color:#ecf0f5}a{color:#8ac4ff}}
  </style></head><body><main><article id="article"><h1 data-stability-source="title">Reliable reading across changing web pages</h1>
  ${Array.from({length: 12}, (_, index) => `<p data-stability-source="p${index}">Reading passage ${index + 1} describes how a browser preserves the original document while showing a translated paragraph. Readers can return to the source text, follow a <a href="#reference">reference link</a>, and keep the inline <code>document.querySelector()</code> example intact.</p>`).join('')}
  <pre id="protected-code"><code>const state = document.querySelector("article");</code></pre><button id="protected-button" translate="no">Save this example</button><input id="protected-input" value="Original field value"><footer id="reference">Reference notes are available below.</footer></article></main></body></html>`;
}

/** 每个来源节点逐项验收；保护内容保留原节点与原字节，不依赖总 wrapper 数。 */
function installPageContract({selector, protectedSelector}) {
  const owned = '.fluent-read-bilingual-content,.fluent-read-loading,.fluent-read-retry-wrapper,[data-fr-translation-owned="true"]';
  const clean = node => {const clone = node.cloneNode(true); clone.querySelectorAll(owned).forEach(item => item.remove());
    clone.querySelectorAll('[data-fr-translation-segment="true"]').forEach(item => item.replaceWith(...item.childNodes)); return clone.innerHTML;};
  const nodes = [...document.querySelectorAll(selector)].filter(node => node.textContent.trim());
  if (nodes.length < 3) throw new Error('Page source contract contains fewer than three blocks');
  const records = nodes.map(node => ({node, html: clean(node)}));
  const protectedNodes = [...document.querySelectorAll(protectedSelector)].map(node => ({node, html: node.outerHTML}));
  if (!protectedNodes.length) throw new Error('Page protected-content contract matched no elements');
  const keys = [];
  const keyListener = event => {if (event.altKey && event.key.toLowerCase() === 't') keys.push({key: event.key, trusted: event.isTrusted});};
  document.addEventListener('keydown', keyListener, true);
  window.__firefoxStability = {
    records, protectedNodes, keys,
    add: (id, text) => {
      const node = document.createElement('p'); node.id = id; node.textContent = text;
      const parent = records[0].node.parentElement;
      parent.append(node); records.push({node, html: node.innerHTML}); node.scrollIntoView({block: 'center'});
      return node.outerHTML;
    },
    snapshot: () => {
      const wrappers = [...document.querySelectorAll('.fluent-read-bilingual-content')];
      return {blocks: records.map(({node, html}) => ({connected: node.isConnected, original: html, current: clean(node),
        translations: [...node.querySelectorAll('.fluent-read-bilingual-content')].map(item => item.textContent),
        pending: node.querySelectorAll('.fluent-read-loading,.fluent-read-retry-wrapper').length})),
      protectedIntact: protectedNodes.every(({node, html}) => node.isConnected && node.outerHTML === html),
      protectedCount: protectedNodes.length, wrappers: wrappers.length,
      nested: document.querySelectorAll('.fluent-read-bilingual-content .fluent-read-bilingual-content').length,
      duplicateParents: wrappers.length - new Set(wrappers.map(node => node.parentElement)).size,
      pending: document.querySelectorAll('.fluent-read-loading,.fluent-read-retry-wrapper').length,
      loading: document.querySelectorAll('.fluent-read-loading').length,
      retries: document.querySelectorAll('.fluent-read-retry-wrapper').length,
      keys: [...keys], url: location.href, title: document.title,
      viewport: {width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth, dark: matchMedia('(prefers-color-scheme: dark)').matches}};
    },
    dispose: () => {document.removeEventListener('keydown', keyListener, true); delete window.__firefoxStability;},
  };
  return window.__firefoxStability.snapshot();
}
function assertPageSnapshot(snapshot, translated, label) {
  assert.ok(snapshot.blocks.length >= 3, `${label}: not enough source blocks`);
  assert.ok(snapshot.protectedCount > 0, `${label}: protected-content contract is empty`);
  assert.equal(snapshot.protectedIntact, true, `${label}: protected source changed`);
  assert.equal(snapshot.nested, 0, `${label}: nested translations`);
  assert.equal(snapshot.duplicateParents, 0, `${label}: duplicated translation parents`);
  assert.equal(snapshot.pending, 0, `${label}: pending/error artifacts remain`);
  snapshot.blocks.forEach((block, index) => {
    assert.equal(block.connected, true, `${label}/${index}: source detached`);
    assert.equal(block.current, block.original, `${label}/${index}: source changed`);
    if (translated) {
      assert.equal(block.translations.length, 1, `${label}/${index}: expected exactly one translation`);
      assert.match(block.translations[0], /[\u3400-\u9fff]/u, `${label}/${index}: controlled translation missing`);
    } else assert.equal(block.translations.length, 0, `${label}/${index}: translation remains`);
  });
  if (!translated) assert.equal(snapshot.wrappers, 0, `${label}: page wrappers remain after restore`);
  assert.ok(snapshot.keys.length && snapshot.keys.every(key => key.trusted), `${label}: trusted full-page shortcut not observed`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {console.log('node scripts/testing/run-web-stability-firefox-test.cjs --extension-dir .output/firefox-mv2 --artifacts-dir PATH [--live] [--live-url URL --live-selector CSS --live-protected CSS]'); return;}
  assert.equal(process.platform, 'darwin', 'This runner requires macOS background launch and focus observation');
  const extensionDir = path.resolve(args.extensionDir), artifactsDir = path.resolve(args.artifactsDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 2, 'Use the production Firefox MV2 artifact');
  assert.ok(manifest.browser_specific_settings?.gecko?.id, 'Firefox gecko identity is missing');
  const freshness = assertFreshProductionExtension(extensionDir);
  fs.mkdirSync(artifactsDir, {recursive: true});
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-web-firefox-')));
  const executable = path.join(path.resolve(args.firefoxApp), 'Contents', 'MacOS', 'firefox');
  const profileIdentity = fs.statSync(profile);
  const report = {ok: false, live: args.live, extensionDir, profile, freshness, version: manifest.version,
    contentSha256: createHash('sha256').update(fs.readFileSync(path.join(extensionDir, 'content-scripts/content.js'))).digest('hex'),
    launchMode: 'macos-launchservices-background-marionette', focusPolicy: 'no-foreground-native-events-and-pid-checks',
    launchEnvironment: {MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1', scope: 'this LaunchServices instance only'},
    provider: 'loopback-controlled-openai-protocol', cases: [], requests: [], focusChecks: [], tabSelections: [],
    limits: ['Controlled provider text does not validate live translation quality or availability.',
      'Desktop narrow viewport is not mobile Firefox, Safari or physical touch input.',
      'Fixture DOM changes do not prove native live-site SPA navigation or infinite scroll.']};
  const persist = () => fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
  let client, owner, monitor, server, primaryError, focusError, interrupted, launchAttempted = false;
  const ownedPids = new Set();
  let delaySource = '', responseDelay = 0, sequence = 0, extensionHandle, pageHandle;
  const responseTimers = new Set();
  const ensureFocus = async label => {
    if (interrupted) throw interrupted;
    if (monitor?.error) throw monitor.error;
    if (focusError) throw focusError;
    const frontmost = await queryMacFrontmostApplication();
    assert.ok(frontmost, 'Cannot observe the frontmost application');
    assert.equal(ownedPids.has(frontmost.pid), false, `Test Firefox became foreground at ${label}`);
    report.focusChecks.push({label, frontmostPid: frontmost.pid, browserPid: owner?.pid || null});
  };
  const script = async (source, values = []) => unbox(await client.send('WebDriver:ExecuteScript', {script: source, args: values}));
  const evaluate = (fn, arg) => script(`return (${fn.toString()})(arguments[0]);`, [arg]);
  const asyncScript = async (source, values = []) => {
    const result = unbox(await client.send('WebDriver:ExecuteAsyncScript', {script: source, args: values}));
    if (result?.__error) throw new Error(result.__error); return result;
  };
  const switchTo = async handle => {
    await ensureFocus('before-tab-selection');
    await client.send('WebDriver:SwitchToWindow', {handle, focus: false});
    // Firefox 159's focus:false switches only Marionette's target; a hidden tab
    // can retain its old viewport after the native window has resized. Select
    // the exact browser tab without TabManager.selectTab(), which also focuses
    // its OS window. Native activation monitoring remains authoritative.
    await client.send('Marionette:SetContext', {value: 'chrome'});
    let selection;
    try {
      selection = await script(`const {NavigableManager}=ChromeUtils.importESModule('chrome://remote/content/shared/NavigableManager.sys.mjs');
        const handle=arguments[0], tabs=[...window.gBrowser.tabs];
        const tab=tabs.find(tab=>NavigableManager.getIdForBrowser(tab.linkedBrowser)===handle);
        if(!tab) throw new Error('The exact Marionette tab is not in the current owned window');
        const changed=window.gBrowser.selectedTab!==tab;
        if(changed) window.gBrowser.selectedTab=tab;
        const browser=window.gBrowser.selectedBrowser, rect=browser.getBoundingClientRect();
        return {handle,selectedHandle:NavigableManager.getIdForBrowser(browser),changed,
          browserRect:{width:rect.width,height:rect.height},outerWidth:window.outerWidth,outerHeight:window.outerHeight};`, [handle]);
    } finally {await client.send('Marionette:SetContext', {value: 'content'});}
    assert.equal(selection.selectedHandle, handle, 'Firefox did not select the exact requested tab');
    report.tabSelections.push(selection);
    await ensureFocus('after-tab-selection');
  };
  const wait = async (fn, label, timeout = args.timeout) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {if (interrupted) throw interrupted; if (focusError) throw focusError; if (await fn()) return; await delay(100);}
    throw new Error(`Timed out waiting for ${label}`);
  };
  const fullToggle = async () => {
    await switchTo(pageHandle); await ensureFocus('before-shortcut');
    await client.send('WebDriver:PerformActions', {actions: [{type: 'key', id: 'full-page-keyboard', actions: [
      {type: 'keyDown', value: '\uE00A'}, {type: 'keyDown', value: 't'}, {type: 'keyUp', value: 't'}, {type: 'keyUp', value: '\uE00A'},
    ]}]});
    await client.send('WebDriver:ReleaseActions'); await ensureFocus('after-shortcut');
  };
  const snapshot = () => evaluate(() => window.__firefoxStability.snapshot());
  const waitTranslated = async () => {
    const observation = {startedAt: Date.now(), stableForMs: 1000, completed: false};
    (report.translationWaits ??= []).push(observation);
    let stableSince = 0, previousKey;
    // The source contract covers the article, while full-page translation can
    // still be committing headings or other eligible text outside that set.
    // Match capture's whole-page contract and wait past the deferred spinner /
    // dispatch window; retries remain failures rather than accepted completion.
    await wait(async () => {
      const current = await snapshot();
      const activeRequests = report.requests.filter(request => !request.completed && !request.aborted).length;
      const translatedBlocks = current.blocks.filter(block => block.translations.length === 1 && !block.pending).length;
      const ready = translatedBlocks === current.blocks.length && current.pending === 0 && activeRequests === 0;
      const key = JSON.stringify([current.wrappers, translatedBlocks, report.requests.length]);
      if (!ready || key !== previousKey) stableSince = ready ? Date.now() : 0;
      previousKey = key;
      observation.last = {blocks: current.blocks.length, translatedBlocks, wrappers: current.wrappers,
        pending: current.pending, loading: current.loading, retries: current.retries, activeRequests,
        requests: report.requests.length, quietForMs: stableSince ? Date.now() - stableSince : 0};
      return ready && observation.last.quietForMs >= observation.stableForMs;
    }, 'all source blocks translated and the whole page settled without pending/error artifacts');
    observation.completed = true; observation.completedAt = Date.now();
  };
  const waitRestored = () => wait(async () => {const current = await snapshot(); return current.wrappers === 0 && current.pending === 0;}, 'all translations restored');
  const screenshot = async name => fs.writeFileSync(path.join(artifactsDir, `${name}.png`), Buffer.from(unbox(await client.send('WebDriver:TakeScreenshot', {full: false})), 'base64'));
  const capture = async (name, translated) => {
    await ensureFocus(name); const state = await snapshot(); report.cases.push({name, ...state}); persist();
    assertPageSnapshot(state, translated, name); await screenshot(name);
    fs.writeFileSync(path.join(artifactsDir, `${name}.html`), await script('return document.documentElement.outerHTML;'));
    return state;
  };
  const patchConfig = async values => {
    await switchTo(extensionHandle);
    const saved = await asyncScript(`const done=arguments[arguments.length-1]; const values=arguments[0], sequence=arguments[1];
      (async()=>{const api=window.browser||window.chrome; const read=await api.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
      if(!read.success) throw new Error(read.error); const current=typeof read.value==='string'?JSON.parse(read.value):read.value;
      const response=await api.runtime.sendMessage({type:'persistConfig',mode:'patch',config:values,
      expected:Object.fromEntries(Object.keys(values).map(key=>[key,current[key]])),clientId:'firefox-web-stability',sequence,baseRevision:current.__fluentConfigRevision});
      if(!response.success) throw new Error(response.error); return true;})().then(done,error=>done({__error:String(error)}));`, [values, ++sequence]);
    assert.equal(saved, true, 'Temporary config write failed');
  };
  const setRect = async (width, height, display) => {
    const requested = {x: Math.round(display.left + (display.width - width) / 2), y: Math.round(display.top + (display.height - height) / 2), width, height};
    await client.send('WebDriver:SetWindowRect', requested);
    const actual = unbox(await client.send('WebDriver:GetWindowRect'));
    assert.ok(actual.x >= display.left - 2 && actual.y >= display.top - 2 && actual.x + actual.width <= display.left + display.width + 2 &&
      actual.y + actual.height <= display.top + display.height + 2, 'Firefox window is outside the secondary display');
    const handle = unbox(await client.send('WebDriver:GetWindowHandle'));
    const samples = [];
    const sampleGeometry = async () => {
      await client.send('Marionette:SetContext', {value: 'chrome'});
      let chrome;
      try {
        chrome = await script(`const {NavigableManager}=ChromeUtils.importESModule('chrome://remote/content/shared/NavigableManager.sys.mjs');
          const browser=window.gBrowser.selectedBrowser, rect=browser.getBoundingClientRect();
          return {windowState:window.windowState, selectedHandle:NavigableManager.getIdForBrowser(browser),
            browserRect:{width:rect.width,height:rect.height},outerWidth:window.outerWidth,outerHeight:window.outerHeight};`);
      } finally {await client.send('Marionette:SetContext', {value: 'content'});}
      const content = await script('return {width:innerWidth,height:innerHeight,visibility:document.visibilityState,devicePixelRatio};');
      const sample = {chrome, content}; samples.push(sample);
      assert.equal(chrome.windowState, 3, 'Firefox window must remain normal, not minimized or fullscreen');
      assert.equal(chrome.selectedHandle, handle, 'Resized window is displaying a different tab');
      return chrome.browserRect.width > 0 && chrome.browserRect.height > 0 && content.visibility === 'visible' &&
        Math.abs(content.width - chrome.browserRect.width) <= 2 && Math.abs(content.height - chrome.browserRect.height) <= 2 &&
        content.width <= actual.width + 2 && content.height < actual.height;
    };
    try {await wait(sampleGeometry, 'selected content viewport to match the resized native window', Math.min(args.timeout, 10000));}
    catch (error) {report.geometryFailure = {requested, actual, handle, samples}; throw error;}
    await ensureFocus('window-placement');
    return {requested, actual, windowState: 'normal', display, selectedHandle: handle,
      contentViewport: samples.at(-1).content, geometrySamples: samples};
  };
  const onSignal = signal => {interrupted ||= new Error(`Firefox test interrupted by ${signal}`); client?.close();};
  const onSigint = () => onSignal('SIGINT'), onSigterm = () => onSignal('SIGTERM');
  process.on('SIGINT', onSigint); process.on('SIGTERM', onSigterm);
  try {
    const display = await secondaryDisplay();
    const port = await freePort();
    const prefs = {'marionette.port': port, 'focusmanager.testmode': true, 'browser.shell.checkDefaultBrowser': false,
      'browser.startup.homepage': 'about:blank', 'browser.startup.page': 0, 'browser.startup.homepage_override.mstone': 'ignore',
      'browser.aboutwelcome.enabled': false,
      'startup.homepage_welcome_url': 'about:blank', 'startup.homepage_welcome_url.additional': '', 'datareporting.policy.dataSubmissionEnabled': false,
      'browser.translations.enable': false, 'browser.tabs.warnOnClose': false, 'layout.css.prefers-color-scheme.content-override': 1,
      'app.update.disabledForTesting': true};
    fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs).map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`).join('\n'));
    const initialWidth = Math.min(1280, display.width), initialHeight = Math.min(900, display.height);
    // Firefox reads this before its first visible window is created; confirm with WebDriver afterwards.
    fs.writeFileSync(path.join(profile, 'xulstore.json'), JSON.stringify({'chrome://browser/content/browser.xhtml': {'main-window': {
      screenX: String(Math.round(display.left + (display.width - initialWidth) / 2)), screenY: String(Math.round(display.top + (display.height - initialHeight) / 2)),
      width: String(initialWidth), height: String(initialHeight), sizemode: 'normal'}}}));
    monitor = startFocusEventMonitor({onEvent: event => {if (ownedPids.has(event.pid)) focusError = new Error('Native activation event: test Firefox became foreground');}});
    report.focusMonitor = await monitor.ready;
    report.frontmostBefore = await queryMacFrontmostApplication();
    assert.ok(report.frontmostBefore, 'Unable to observe foreground before launching Firefox');
    if (interrupted) throw interrupted;
    launchAttempted = true;
    // Firefox 159 requires the environment flag; open --env applies it only to
    // this new instance. Never set a user/session-wide launchctl environment.
    await execute('/usr/bin/open', ['-g', '-n', '--env', 'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1', '-a', path.resolve(args.firefoxApp),
      '--args', '-no-remote', '-profile', profile, '--marionette'], {timeout: 10000});
    owner = await captureLaunchedOwner(profile, executable, args.timeout);
    assert.ok(owner, 'Owned Firefox process disappeared before transport setup');
    ownedPids.add(owner.pid); report.launchOwner = owner;
    report.browser = {pid: owner.pid};
    if (monitor.events.some(event => event.pid === owner.pid)) focusError = new Error('Native activation event recorded during Firefox launch');
    await ensureFocus('process-started');
    const listener = await captureListenerOwner(port, profile, executable, args.timeout);
    assert.ok(listener, 'Marionette listener disappeared');
    if (listener.pid !== owner.pid) {
      assert.equal(await processIdentity(owner.pid, profile, executable), null, 'Both startup and listener processes remain active; ownership handoff is ambiguous');
      report.startupHandoff = {from: owner, to: listener, evidence: 'original process exited; exact newly created profile and listener port match'};
      owner = listener; ownedPids.add(owner.pid);
    } else assert.deepEqual(listener, owner, 'Firefox listener process identity changed');
    report.listenerOwner = listener;
    if (monitor.events.some(event => ownedPids.has(event.pid))) focusError = new Error('Native activation event recorded during Firefox startup');
    await ensureFocus('listener-confirmed');
    client = await connect(port, args.timeout);
    assert.deepEqual(await captureListenerOwner(port, profile, executable, 2000), owner, 'Marionette listener changed before NewSession');
    const created = await client.send('WebDriver:NewSession', {capabilities: {alwaysMatch: {acceptInsecureCerts: false, pageLoadStrategy: 'eager'}}});
    const capabilities = unbox(created).capabilities;
    const pid = capabilities?.['moz:processID'];
    assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Firefox did not return its process ID');
    assert.equal(fs.realpathSync(capabilities['moz:profile']), fs.realpathSync(profile), 'Firefox attached to an unexpected profile');
    assert.equal(pid, owner.pid, 'Marionette process differs from the newly launched Firefox');
    assert.deepEqual(await processIdentity(pid, profile, executable), owner, 'Owned Firefox process identity changed during session setup');
    report.browser = {name: capabilities.browserName, version: capabilities.browserVersion, pid};
    if (monitor.events.some(event => event.pid === pid)) focusError = new Error('Native activation event recorded during Firefox startup');
    await ensureFocus('session-created');
    await client.send('WebDriver:SetTimeouts', {script: args.timeout, pageLoad: args.timeout, implicit: 0});
    const startupHandles = unbox(await client.send('WebDriver:GetWindowHandles'));
    report.startupUrls = [];
    for (const handle of startupHandles) {
      await switchTo(handle); const url = await script('return location.href;'); report.startupUrls.push(url);
      assert.ok(!/^about:(?:welcome|firefoxview)/u.test(url), 'Firefox first-run welcome appeared; stop without interacting with it');
    }
    report.windowPlacement = await setRect(initialWidth, initialHeight, display);
    report.addonId = unbox(await client.send('Addon:Install', {path: extensionDir, temporary: true}));
    assert.equal(report.addonId, manifest.browser_specific_settings.gecko.id, 'Unexpected installed extension ID');
    await client.send('Marionette:SetContext', {value: 'chrome'});
    const extensionHost = await script('return WebExtensionPolicy.getByID(arguments[0]).mozExtensionHostname;', [report.addonId]);
    await client.send('Marionette:SetContext', {value: 'content'});
    extensionHandle = unbox(await client.send('WebDriver:NewWindow', {type: 'tab', focus: false})).handle;
    await switchTo(extensionHandle);
    await client.send('WebDriver:Navigate', {url: `moz-extension://${extensionHost}/popup.html`});
    await wait(() => script('return Boolean((window.browser||window.chrome)?.runtime?.sendMessage);'), 'extension configuration page');
    server = http.createServer(async (request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', '*');
      if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        try {
          const chunks = []; let bytes = 0;
          for await (const chunk of request) {bytes += chunk.length; if (bytes > 2 * 1024 * 1024) throw new Error('Fixture request exceeds 2 MiB'); chunks.push(chunk);}
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const prompt = body.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
          const source = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1];
          assert.ok(source, 'Fixture provider did not receive the source markers');
          const record = {source, receivedAt: Date.now(), completed: false, aborted: false}; report.requests.push(record);
          response.on('close', () => {if (!record.completed) record.aborted = true;});
          const respond = () => {if (response.destroyed) return;
            response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({id: `firefox-${report.requests.length}`,
              object: 'chat.completion', model: 'firefox-fixture', choices: [{index: 0, message: {role: 'assistant', content: `测试译文：${source}`}, finish_reason: 'stop'}]}));
            record.completed = true; record.completedAt = Date.now();};
          if (delaySource && source.includes(delaySource)) {
            const timer = setTimeout(() => {responseTimers.delete(timer); respond();}, responseDelay); responseTimers.add(timer);
          } else respond();
        } catch (error) {response.writeHead(400); response.end(JSON.stringify({error: {message: String(error)}}));}
        return;
      }
      response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(fixtureHtml());
    });
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const base = `http://127.0.0.1:${server.address().port}`, service = 'custom:firefox-stability';
    await patchConfig({on: true, service, from: 'en', to: 'zh-Hans', display: 1, autoTranslate: false, fullPageTranslationMode: 'all',
      hotkey: 'Control', floatingBallHotkey: 'Alt+T', uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, theme: 'light',
      enableAIContext: false, enableAIMultiSegment: false, useCache: false,
      customOpenAIProviders: [{id: service, name: 'Firefox local regression', endpoint: `${base}/v1`, models: ['firefox-fixture']}],
      model: {[service]: 'firefox-fixture'}, requireApiKey: {[`v2:${JSON.stringify([service, 'firefox-fixture'])}`]: false},
      user_role: {[service]: 'Translate into {{to}}. Return only the translation. SOURCE_BEGIN{{origin}}SOURCE_END'}});
    pageHandle = unbox(await client.send('WebDriver:NewWindow', {type: 'tab', focus: false})).handle;
    await switchTo(pageHandle); await client.send('WebDriver:Navigate', {url: `${base}/article`});
    await wait(() => script('return Boolean(document.querySelector("#fluent-read-page-styles"));'), 'production Firefox content script');
    report.fixtureBaseline = await evaluate(installPageContract, {selector: '[data-stability-source]', protectedSelector: '#protected-code,#protected-button,#protected-input,article a,article p code'});
    await fullToggle(); await waitTranslated(); await capture('fixture-translated', true);
    await fullToggle(); await waitRestored(); await capture('fixture-restored', false);
    await fullToggle(); await waitTranslated(); await capture('fixture-retranslated', true);
    await evaluate(() => window.__firefoxStability.add('dynamic-source', 'This newly appended paragraph must receive a translation while the full page session remains active.'));
    await waitTranslated(); await capture('fixture-dynamic', true);
    await fullToggle(); await waitRestored(); await capture('fixture-dynamic-restored', false);
    // Delay a new source after an already-completed session; cancellation must reject the late result.
    await fullToggle(); await waitTranslated();
    delaySource = 'Cancellation marker paragraph'; responseDelay = 2500;
    const requestsBeforeCancel = report.requests.length;
    await evaluate(() => window.__firefoxStability.add('cancel-source', 'Cancellation marker paragraph verifies that restoring the original page rejects a late translation response.'));
    await wait(() => report.requests.slice(requestsBeforeCancel).some(request => request.source.includes(delaySource)), 'delayed request received by local provider');
    await fullToggle(); await waitRestored(); await delay(responseDelay + 500);
    await capture('fixture-cancelled-late-response', false); delaySource = ''; responseDelay = 0;
    const stoppedBefore = report.requests.length;
    await evaluate(() => window.__firefoxStability.add('stopped-source', 'Content added after the full page session stops must remain in its original language.'));
    await delay(1500); await capture('fixture-stopped-session', false);
    assert.equal(report.requests.length, stoppedBefore, 'Stopped session sent a new translation request');
    await patchConfig({theme: 'dark'}); await switchTo(pageHandle);
    await client.send('Marionette:SetContext', {value: 'chrome'});
    await script('Services.prefs.setIntPref("layout.css.prefers-color-scheme.content-override", 0); return true;');
    await client.send('Marionette:SetContext', {value: 'content'});
    report.narrowPlacement = await setRect(480, Math.min(850, display.height), display);
    await fullToggle(); await waitTranslated();
    await script('window.scrollTo(0,0); return true;');
    const narrow = await capture('fixture-narrow-dark', true);
    assert.ok(narrow.viewport.width <= 520, `Native Firefox narrow viewport is wider than 520px: ${narrow.viewport.width}`);
    assert.equal(narrow.viewport.dark, true, 'Firefox did not adopt the dark media query');
    assert.ok(narrow.viewport.scrollWidth <= narrow.viewport.clientWidth + 1, 'Narrow page has horizontal overflow');
    await fullToggle(); await waitRestored();
    await evaluate(() => window.__firefoxStability.dispose()); report.fixtureProbeDisposed = true;
    if (args.live) {
      report.liveResult = {ok: false, url: args.liveUrl, provider: 'loopback-controlled-openai-protocol'};
      await patchConfig({theme: 'light'}); await switchTo(pageHandle);
      await client.send('Marionette:SetContext', {value: 'chrome'});
      await script('Services.prefs.setIntPref("layout.css.prefers-color-scheme.content-override", 1); return true;');
      await client.send('Marionette:SetContext', {value: 'content'});
      await setRect(initialWidth, initialHeight, display);
      await client.send('WebDriver:Navigate', {url: args.liveUrl});
      await wait(() => script('return Boolean(document.querySelector(arguments[0]) && document.querySelector("#fluent-read-page-styles"));', [args.liveSelector]), 'live source contract');
      report.liveResult.baseline = await evaluate(installPageContract, {selector: args.liveSelector, protectedSelector: args.liveProtected});
      await fullToggle(); await waitTranslated(); await capture('live-translated', true);
      await fullToggle(); await waitRestored(); await capture('live-restored', false);
      await fullToggle(); await waitTranslated(); await capture('live-retranslated', true);
      await fullToggle(); await waitRestored(); await evaluate(() => window.__firefoxStability.dispose());
      report.liveResult.ok = true;
    }
    await ensureFocus('completed'); report.ok = true;
  } catch (error) {
    primaryError = error; report.error = error.stack || String(error);
    if (client && !client.closed) {
      try {report.failurePage = await script('return {url:location.href,title:document.title,body:(document.body?.innerText||"").slice(0,2500)};'); await screenshot('failure');}
      catch (captureError) {report.failureCaptureError = String(captureError);}
    }
  } finally {
    client?.close();
    try {
      // Startup may restart the same freshly-created profile before any protocol
      // is available. Revalidate that sole main process instead of trusting a stale PID.
      const remainingMain = (await profileProcesses(profile)).filter(process => process.command.startsWith(`${executable} `));
      assert.ok(remainingMain.length <= 1, 'Multiple Firefox main processes own the temporary profile; retain it');
      if (remainingMain.length) {
        const cleanupOwner = await processIdentity(remainingMain[0].pid, profile, executable);
        ownedPids.add(cleanupOwner.pid); report.cleanupOwner = cleanupOwner;
        await stopOwnedFirefox(cleanupOwner, profile, executable);
      }
      let remaining = await profileProcesses(profile);
      for (let attempt = 0; remaining.length && attempt < 50; attempt += 1) {await delay(100); remaining = await profileProcesses(profile);}
      if (!remaining.length) {
        report.browserClosed = true; report.profileProcessesGone = true;
        const currentProfile = fs.statSync(profile);
        assert.equal(currentProfile.dev, profileIdentity.dev); assert.equal(currentProfile.ino, profileIdentity.ino);
        fs.rmSync(profile, {recursive: true, force: true, maxRetries: 10, retryDelay: 200}); report.profileRemoved = true;
      } else {report.remainingProfileProcesses = remaining; report.retainedProfile = profile; report.ok = false;}
    } catch (error) {report.cleanupError = String(error); report.retainedProfile = profile; report.ok = false; primaryError ||= error;}
    if (monitor) await monitor.stop().catch(error => {report.focusCleanupError = String(error); report.ok = false; primaryError ||= error;});
    if (monitor) {
      report.focusEvents = [...monitor.events]; report.ownedPids = [...ownedPids];
      if (monitor.error) {report.focusMonitorError = String(monitor.error); report.ok = false; primaryError ||= monitor.error;}
      if (monitor.events.some(event => ownedPids.has(event.pid))) {report.ok = false; report.focusFailure = true; primaryError ||= new Error('Firefox activation detected');}
    }
    for (const timer of responseTimers) clearTimeout(timer);
    if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
    process.removeListener('SIGINT', onSigint); process.removeListener('SIGTERM', onSigterm);
    persist();
  }
  console.log(JSON.stringify({ok: report.ok, report: path.join(artifactsDir, 'report.json'), browser: report.browser,
    cases: report.cases.map(item => item.name), live: report.liveResult || null, profileRemoved: report.profileRemoved || false}, null, 2));
  if (primaryError) throw primaryError;
  assert.equal(report.ok, true, 'Firefox verification did not complete');
}

module.exports = {MarionetteClient, parseArgs, fixtureHtml, installPageContract, assertPageSnapshot, main};
if (require.main === module) main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});

'use strict';
/**
 * @file scripts/testing/mac-focus-event-monitor.cjs
 * 文件职责：管理独立 macOS 激活事件观察器的就绪、消息与进程生命周期。
 * 主要内容：编译只读 Swift 观察器到本次临时目录，校验 JSON 行和观察器 PID；保存事件与永久错误，只停止本模块 spawn 的子进程。
 * 模块边界：不启动或操纵测试浏览器，不修复桌面焦点，不读取应用内容；调用者用已确认的浏览器 PID 判断激活事件，不得把采样替代本事件证据。
 */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const {promisify} = require('node:util');
const {StringDecoder} = require('node:string_decoder');
const execFile = promisify(cp.execFile);
const SOURCE = path.join(__dirname, 'mac-focus-event-observer.swift');

function failure(code, message) {const error = new Error(message); error.code = code; return error;}
function createFocusEventMonitor({onEvent = () => {}, onError = () => {}, readinessTimeoutMs = 30000} = {}, ports) {
  if (typeof onEvent !== 'function' || typeof onError !== 'function' || !Number.isFinite(readinessTimeoutMs) || readinessTimeoutMs <= 0) throw new TypeError('Invalid focus event monitor options');
  const events = [];
  const decoder = new StringDecoder('utf8');
  let child, stopped = false, stopPromise, exitObserved = false, settled = false, lastMonotonic = -1, buffered = '', permanentError;
  let resolveReady, rejectReady, resolveClosed;
  const closed = new Promise(resolve => {resolveClosed = resolve;});
  const ready = new Promise((resolve, reject) => {resolveReady = resolve; rejectReady = reject;});
  // stop 可先于 await ready；调用者仍能读取原始拒绝，避免清理路径产生未处理拒绝。
  void ready.catch(() => {});
  function fail(error) {
    if (!permanentError) {permanentError = error instanceof Error ? error : new Error(String(error)); try {onError(permanentError);} catch {}}
    if (!settled) {settled = true; clearTimeout(readinessTimer); rejectReady(permanentError);}
  }
  const readinessTimer = setTimeout(() => {fail(failure('FOCUS_OBSERVER_READY_TIMEOUT', 'Focus event observer did not become ready')); void stop().catch(() => {});}, readinessTimeoutMs);
  function record(line) {
    let event;
    try {event = JSON.parse(line);} catch {fail(failure('FOCUS_OBSERVER_PROTOCOL', 'Invalid observer JSON line')); return;}
    if (!event || !['ready', 'activation'].includes(event.kind) || !Number.isSafeInteger(event.pid) || event.pid <= 0
      || !Number.isFinite(event.time) || event.time < 0 || !Number.isFinite(event.monotonicMs) || event.monotonicMs < 0 || event.monotonicMs < lastMonotonic
      || (event.kind === 'activation' && (typeof event.name !== 'string' || event.name.length > 1024))) {
      fail(failure('FOCUS_OBSERVER_PROTOCOL', 'Invalid observer event')); return;
    }
    lastMonotonic = event.monotonicMs;
    if (event.kind === 'ready') {
      if (settled || event.pid !== child.pid) {fail(failure('FOCUS_OBSERVER_IDENTITY', 'Unexpected observer ready PID or duplicate ready')); return;}
      settled = true; clearTimeout(readinessTimer); resolveReady({monitorPid: event.pid, time: event.time, monotonicMs: event.monotonicMs});
    } else {
      const activation = Object.freeze({kind: 'activation', pid: event.pid, name: event.name, time: event.time, monotonicMs: event.monotonicMs});
      events.push(activation);
      try {onEvent(activation);} catch (error) {fail(error);}
    }
  }
  function data(chunk) {
    buffered += decoder.write(chunk);
    if (buffered.length > 65536) {fail(failure('FOCUS_OBSERVER_PROTOCOL', 'Observer line buffer exceeded its bound')); return;}
    let end;
    while ((end = buffered.indexOf('\n')) !== -1) {const line = buffered.slice(0, end); buffered = buffered.slice(end + 1); if (line.trim()) record(line);}
  }
  const setup = Promise.resolve().then(async () => {
    const executable = await ports.compile();
    if (stopped) return;
    child = ports.spawn(executable, [], {stdio: ['pipe', 'pipe', 'pipe']});
    if (!child) throw failure('FOCUS_OBSERVER_SPAWN', 'No owned observer process');
    child.on('error', error => {fail(error);});
    child.stdout.on('data', data);
    child.stderr.on('data', chunk => {if (String(chunk).trim()) fail(failure('FOCUS_OBSERVER_STDERR', String(chunk).slice(0, 2048)));});
    child.stdin.on('error', error => {if (!stopped) fail(error);});
    child.on('close', (code, signal) => {
      exitObserved = true; resolveClosed({code, signal});
      if (!stopped) fail(failure('FOCUS_OBSERVER_EXIT', `Observer exited before stop (${code ?? signal})`));
      else if (!settled) fail(failure('FOCUS_OBSERVER_STOPPED', 'Observer stopped before ready'));
    });
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw failure('FOCUS_OBSERVER_SPAWN', 'No owned observer process');
  }).catch(error => {fail(error);});
  async function waitClosed(milliseconds) {
    if (exitObserved) return true;
    let timer;
    try {return await Promise.race([closed.then(() => true), new Promise(resolve => {timer = setTimeout(() => resolve(false), milliseconds);})]);}
    finally {clearTimeout(timer);}
  }
  function stop() {
    if (stopPromise) return stopPromise;
    stopped = true; clearTimeout(readinessTimer);
    if (!settled) fail(failure('FOCUS_OBSERVER_STOPPED', 'Observer stopped before ready'));
    stopPromise = (async () => {
      await setup;
      if (child && !exitObserved) {
        try {child.stdin.end('stop\n');} catch {}
        if (!await waitClosed(1000)) {child.kill('SIGTERM'); if (!await waitClosed(1000)) {child.kill('SIGKILL'); if (!await waitClosed(1500)) throw failure('FOCUS_OBSERVER_CLOSE_TIMEOUT', 'Owned observer did not close; retain its temporary executable');}}
      }
      await ports.cleanup();
    })();
    return stopPromise;
  }
  return {ready, stop, events, get error() {return permanentError;}, get monitorPid() {return child?.pid ?? null;}};
}
function startFocusEventMonitor(options) {
  if (process.platform !== 'darwin') throw failure('FOCUS_OBSERVER_PLATFORM', 'Native focus event observation requires macOS');
  let directory;
  return createFocusEventMonitor(options, {
    compile: async () => {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fluentread-focus-observer-'));
      const executable = path.join(directory, 'observer');
      await execFile('/usr/bin/swiftc', [SOURCE, '-module-cache-path', path.join(directory, 'module-cache'), '-o', executable], {timeout: 25000, maxBuffer: 1024 * 1024});
      return executable;
    },
    spawn: cp.spawn,
    cleanup: async () => {if (directory) await fs.rm(directory, {recursive: true, force: true});},
  });
}
module.exports = {startFocusEventMonitor, createFocusEventMonitor};

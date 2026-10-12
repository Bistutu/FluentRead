/**
 * @file tests/focusSafeBrowserBackgroundSignal.test.mjs
 * 验证后台 session 的信号生命周期：VM 暴露既有 private factory，用受控
 * guarded delegate 分阶段检查 native disconnect 与 owned cleanup；真实
 * parent-owned Node IPC 子进程验证信号交付及退出，不启动浏览器或网络请求。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fork} from 'node:child_process';
import {Script} from 'node:vm';

const fixturePath = fileURLToPath(import.meta.url);
const helperPath = resolve(process.env.FLUENTREAD_CLOSE_HELPER ||
  fileURLToPath(new URL('../scripts/testing/focus-safe-browser.cjs', import.meta.url)));
const options = {timeout: 10000, concurrency: false};

function deferred() {
  let resolveTask, rejectTask;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolveTask = resolveValue; rejectTask = rejectValue;
  });
  return {promise, resolve: resolveTask, reject: rejectTask};
}

class FakeProcess extends EventEmitter {
  platform = 'darwin';
  exits = [];
  defaultSignals = [];
  firstExit = deferred();
  exit(code) {
    this.exits.push(code);
    this.firstExit.resolve(code);
  }
  signal(name) {
    const handled = this.emit(name);
    if (!handled) this.defaultSignals.push(name);
    return handled;
  }
  kill() { assert.fail('VM fixture must never signal an OS process'); }
}

function loadFactory(processPort, errors = []) {
  const source = readFileSync(helperPath, 'utf8');
  const realRequire = createRequire(helperPath);
  const forbidden = () => { throw new Error('Native/browser operation is forbidden in this fixture'); };
  const requirePort = specifier => {
    if (specifier === 'node:child_process') return {execFile: forbidden};
    if (specifier === './owned-browser-close.cjs') return {
      guardBrowserClose: forbidden, getGuardedBrowserPid: forbidden,
    };
    return realRequire(specifier);
  };
  const module = {exports: {}};
  // Test seam only: append a reference to the original factory; do not alter
  // any source statement, branch, listener or close implementation.
  new Script(source + '\nmodule.exports.__evidenceFactory = createMacBackgroundSession;\n',
    {filename: helperPath}).runInNewContext({module, exports: module.exports,
    require: requirePort, process: processPort, setTimeout, clearTimeout,
    console: {error: (...args) => errors.push(args), log() {}},
  });
  assert.equal(typeof module.exports.__evidenceFactory, 'function');
  return module.exports.__evidenceFactory;
}

function makeHarness(t, {nativeFailure, synchronousNativeFailure = false} = {}) {
  const processPort = new FakeProcess();
  const errors = [];
  const native = deferred(), nativeEntered = deferred();
  const owned = deferred(), ownedEntered = deferred();
  const calls = {native: 0, owned: 0, delegate: 0};
  const receipt = {ownedCleanupCompleted: false};
  const token = Object.freeze({kind: 'complete-owned-close'});
  const browser = {close() {
    calls.native += 1;
    nativeEntered.resolve();
    if (synchronousNativeFailure) throw nativeFailure;
    return native.promise;
  }};
  const session = loadFactory(processPort, errors)(browser, {kind: 'fake-context'}, {kind: 'fake-placement'});
  let guardedPromise;
  const guardedDelegate = () => {
    calls.delegate += 1;
    guardedPromise ||= (async () => {
      let primaryError;
      try { await session.closeBrowserConnection(); } catch (error) { primaryError = error; }
      calls.owned += 1;
      ownedEntered.resolve();
      await owned.promise;
      receipt.ownedCleanupCompleted = true;
      if (primaryError) throw primaryError;
      return token;
    })();
    guardedPromise.catch(() => {});
    return guardedPromise;
  };
  session.useGuardedClose(guardedDelegate);
  const tracked = [];
  function close() {
    const promise = session.close();
    tracked.push(Promise.resolve(promise).catch(() => {}));
    return promise;
  }
  t.after(async () => {
    // Settle only our port promises; no delay, OS signal, profile or UI action.
    native.resolve(); owned.resolve();
    await Promise.allSettled(tracked);
    if (guardedPromise) await Promise.allSettled([guardedPromise]);
  });
  return {processPort, session, native, nativeEntered, owned, ownedEntered, calls,
    receipt, errors, token, guardedDelegate, close};
}

function assertRouting(processPort, label) {
  assert.equal(processPort.listenerCount('SIGTERM'), 1, label + ': SIGTERM listener retained');
  assert.equal(processPort.listenerCount('SIGINT'), 1, label + ': SIGINT listener retained');
}
function assertReleased(processPort) {
  assert.equal(processPort.listenerCount('SIGTERM'), 0, 'Release own SIGTERM listener after whole guarded close');
  assert.equal(processPort.listenerCount('SIGINT'), 0, 'Release own SIGINT listener after whole guarded close');
}

async function runWorker() {
  const wrapped = new WeakMap();
  const send = value => new Promise((resolveSend, rejectSend) => process.send(value,
    error => error ? rejectSend(error) : resolveSend()));
  // Observability decorates the helper's registered callbacks only. There is
  // no extra SIGTERM/SIGINT watcher that could mask candidate default death.
  const realProcessPort = {
    platform: process.platform,
    on(name, handler) {
      const decorated = (...args) => {
        process.send({kind: 'signal-routed', name});
        return handler(...args);
      };
      wrapped.set(handler, decorated); process.on(name, decorated); return this;
    },
    once(name, handler) {
      const decorated = (...args) => {
        process.send({kind: 'signal-routed', name});
        return handler(...args);
      };
      wrapped.set(handler, decorated); process.once(name, decorated); return this;
    },
    off(name, handler) { process.off(name, wrapped.get(handler) || handler); return this; },
    exit: code => process.exit(code),
  };
  const native = deferred(), owned = deferred();
  process.on('message', message => {
    if (message === 'release-native') native.resolve();
    if (message === 'release-owned') owned.resolve();
  });
  const session = loadFactory(realProcessPort)(
    {close() { process.send({kind: 'stage', stage: 'native'}); return native.promise; }}, {}, {});
  let closing;
  session.useGuardedClose(() => {
    closing ||= (async () => {
      await session.closeBrowserConnection();
      await send({kind: 'stage', stage: 'owned'});
      await owned.promise;
      await send({kind: 'cleanup-completed', pid: process.pid});
    })();
    return closing;
  });
  await send({kind: 'ready', pid: process.pid, nativeSignalListeners: {
    SIGTERM: process.listenerCount('SIGTERM'), SIGINT: process.listenerCount('SIGINT'),
  }});
  session.close().catch(async error => {
    await send({kind: 'close-error', error: String(error)});
    process.exit(1);
  });
}

if (process.argv.includes('--owned-worker')) {
  await runWorker();
} else {
  const source = readFileSync(helperPath);
  console.log(JSON.stringify({evidence: 'controlled-background-close', helperPath,
    helperSha256: createHash('sha256').update(source).digest('hex'),
    fixtureSha256: createHash('sha256').update(readFileSync(fixturePath)).digest('hex'),
    scope: 'Pure Node/VM and exact parent-owned Node IPC children; no browser/network/macOS activation'}));

  test('manual close keeps both signals through transport AND owned cleanup, then releases them', options, async t => {
    const h = makeHarness(t);
    const first = h.close(), second = h.close();
    assert.strictEqual(first, second, 'Whole guarded close returns the same Promise');
    await h.nativeEntered.promise;
    assertRouting(h.processPort, 'native pending');
    assert.equal(h.receipt.ownedCleanupCompleted, false);
    h.native.resolve(); await h.ownedEntered.promise;
    assertRouting(h.processPort, 'owned pending');
    assert.deepEqual(h.processPort.exits, []);
    h.owned.resolve(); assert.strictEqual(await first, h.token);
    assertReleased(h.processPort);
    assert.deepEqual(h.calls, {native: 1, owned: 1, delegate: 1});
  });

  test('transport close is separately idempotent and does not release guarded signals', options, async t => {
    const h = makeHarness(t);
    const first = h.session.closeBrowserConnection(), second = h.session.closeBrowserConnection();
    assert.strictEqual(first, second, 'Transport close returns the same Promise');
    await h.nativeEntered.promise;
    assert.equal(h.calls.native, 1); assertRouting(h.processPort, 'transport-only pending');
    h.native.resolve(); await first;
    assertRouting(h.processPort, 'transport settled, guard has not started');
    const whole = h.close(); await h.ownedEntered.promise;
    h.owned.resolve(); await whole; assertReleased(h.processPort);
  });

  for (const signal of ['SIGTERM', 'SIGINT']) for (const stage of ['native', 'owned']) {
    test(signal + ' in ' + stage + ' pending waits for completed owned cleanup before exit', options, async t => {
      const h = makeHarness(t), close = h.close();
      await h.nativeEntered.promise;
      if (stage === 'owned') {h.native.resolve(); await h.ownedEntered.promise;}
      assert.equal(h.processPort.signal(signal), true, 'Signal must route to guarded close');
      assertRouting(h.processPort, stage + ' after signal');
      assert.deepEqual(h.processPort.exits, []);
      assert.deepEqual(h.processPort.defaultSignals, []);
      if (stage === 'native') {h.native.resolve(); await h.ownedEntered.promise;}
      assert.equal(h.receipt.ownedCleanupCompleted, false);
      assert.deepEqual(h.processPort.exits, []);
      h.owned.resolve(); await close; await h.processPort.firstExit.promise;
      assert.equal(h.receipt.ownedCleanupCompleted, true);
      assert.deepEqual(h.processPort.exits, [signal === 'SIGTERM' ? 143 : 130]);
      assertReleased(h.processPort);
      assert.deepEqual(h.calls, {native: 1, owned: 1, delegate: 1});
    });
  }

  for (const sequence of [['SIGTERM', 'SIGTERM', 'SIGTERM'], ['SIGINT', 'SIGTERM', 'SIGINT']]) {
    test('repeated signals ' + sequence.join('/') + ' share one close and one first-signal exit', options, async t => {
      const h = makeHarness(t), close = h.close();
      await h.nativeEntered.promise;
      assert.equal(h.processPort.signal(sequence[0]), true);
      assert.equal(h.processPort.signal(sequence[1]), true);
      h.native.resolve(); await h.ownedEntered.promise;
      assert.equal(h.processPort.signal(sequence[2]), true);
      assertRouting(h.processPort, 'repeat signals during owned cleanup');
      assert.deepEqual(h.processPort.exits, []);
      assert.deepEqual(h.processPort.defaultSignals, []);
      h.owned.resolve(); await close; await h.processPort.firstExit.promise;
      assert.deepEqual(h.processPort.exits, [sequence[0] === 'SIGTERM' ? 143 : 130]);
      assert.deepEqual(h.calls, {native: 1, owned: 1, delegate: 1});
      assertReleased(h.processPort);
    });
  }

  test('delegate replacement before first signal uses latest delegate without duplicating listeners', options, async t => {
    const h = makeHarness(t); let oldCalls = 0;
    h.session.useGuardedClose(() => {oldCalls += 1; assert.fail('Obsolete delegate must not run');});
    h.session.useGuardedClose(h.guardedDelegate);
    assertRouting(h.processPort, 'multiple registrations');
    assert.equal(h.processPort.signal('SIGTERM'), true);
    await h.nativeEntered.promise;
    assert.equal(oldCalls, 0); assert.deepEqual(h.processPort.exits, []);
    h.native.resolve(); await h.ownedEntered.promise; h.owned.resolve();
    await h.processPort.firstExit.promise;
    assert.deepEqual(h.calls, {native: 1, owned: 1, delegate: 1});
    assert.deepEqual(h.processPort.exits, [143]); assertReleased(h.processPort);
  });

  test('delegate replacement after close starts cannot replace the existing whole-close Promise', options, async t => {
    const h = makeHarness(t), first = h.close(); let replacementCalls = 0;
    await h.nativeEntered.promise;
    h.session.useGuardedClose(() => {replacementCalls += 1; return Promise.resolve('wrong-new-close');});
    assert.strictEqual(h.close(), first);
    assert.equal(h.processPort.signal('SIGINT'), true);
    assert.equal(replacementCalls, 0); assert.deepEqual(h.processPort.exits, []);
    h.native.resolve(); await h.ownedEntered.promise; h.owned.resolve();
    await first; await h.processPort.firstExit.promise;
    assert.equal(replacementCalls, 0); assert.deepEqual(h.processPort.exits, [130]);
    assertReleased(h.processPort);
  });

  test('listener release removes only this session listeners, retaining unrelated listeners', options, async t => {
    const h = makeHarness(t); const observer = () => {};
    h.processPort.on('SIGTERM', observer); h.processPort.on('SIGINT', observer);
    const close = h.close(); await h.nativeEntered.promise;
    h.native.resolve(); await h.ownedEntered.promise; h.owned.resolve(); await close;
    assert.deepEqual(h.processPort.listeners('SIGTERM'), [observer]);
    assert.deepEqual(h.processPort.listeners('SIGINT'), [observer]);
  });

  for (const synchronous of [true, false]) {
    test((synchronous ? 'synchronous' : 'asynchronous') + ' transport failure still routes signals through owned cleanup and preserves original error', options, async t => {
      const failure = new Error('native transport failure');
      const h = makeHarness(t, {nativeFailure: failure, synchronousNativeFailure: synchronous});
      const close = h.close(); const rejected = assert.rejects(close, error => error === failure);
      await h.nativeEntered.promise;
      if (!synchronous) h.native.reject(failure);
      await h.ownedEntered.promise;
      assertRouting(h.processPort, 'native failed but owned cleanup pending');
      assert.equal(h.processPort.signal('SIGTERM'), true);
      assert.deepEqual(h.processPort.exits, []);
      h.owned.resolve(); await rejected; await h.processPort.firstExit.promise;
      assert.equal(h.receipt.ownedCleanupCompleted, true);
      assertReleased(h.processPort); assert.deepEqual(h.processPort.exits, [143]);
      assert.equal(h.errors.length, 1);
      assert.strictEqual(h.errors[0][1], failure);
    });
  }

  for (const synchronous of [true, false]) {
    test((synchronous ? 'synchronous' : 'asynchronous') + ' guarded delegate rejection is cached and releases both listeners', options, async t => {
      const h = makeHarness(t); const pending = deferred(); const failure = new Error('owned cleanup failed');
      let calls = 0;
      h.session.useGuardedClose(() => {
        calls += 1;
        if (synchronous) throw failure;
        return pending.promise;
      });
      let first;
      assert.doesNotThrow(() => {first = h.close();}, 'Sync delegate throws must become the shared rejection');
      const rejected = assert.rejects(first, error => error === failure);
      assert.strictEqual(h.close(), first);
      if (!synchronous) {
        assertRouting(h.processPort, 'pending failing delegate');
        pending.reject(failure);
      }
      await rejected; assertReleased(h.processPort);
      assert.equal(calls, 1); assert.deepEqual(h.processPort.exits, []);
    });
  }

  test('invalid replacement rejects without destroying the registered working delegate', options, async t => {
    const h = makeHarness(t);
    assert.throws(() => h.session.useGuardedClose(null), error => error.name === 'TypeError');
    assertRouting(h.processPort, 'after invalid replacement');
    const close = h.close(); await h.nativeEntered.promise;
    h.native.resolve(); await h.ownedEntered.promise; h.owned.resolve(); await close;
    assertReleased(h.processPort);
  });

  for (const signal of ['SIGTERM', 'SIGINT']) for (const stage of ['native', 'owned']) {
    test('actual parent-owned Node child: ' + signal + ' during ' + stage + ' pending completes cleanup before real exit', options, async t => {
      const child = fork(fixturePath, ['--owned-worker'], {env: {...process.env, FLUENTREAD_CLOSE_HELPER: helperPath},
        execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
      const messages = []; const waiting = [];
      let stderr = '', closed = false, exit;
      child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => {stderr += chunk;});
      const closeTask = new Promise(resolveClose => child.once('close', (code, actualSignal) => {
        closed = true; exit = {code, signal: actualSignal}; resolveClose(exit);
        for (const waiter of waiting.splice(0)) waiter.reject(new Error('Owned child exited before ' + waiter.label + ': ' + JSON.stringify(exit) + stderr));
      }));
      child.on('message', value => {
        messages.push(value);
        for (const waiter of [...waiting]) if (waiter.match(value)) {
          waiting.splice(waiting.indexOf(waiter), 1); waiter.resolve(value);
        }
      });
      const waitFor = (match, label) => {
        const existing = messages.find(match); if (existing) return Promise.resolve(existing);
        if (closed) return Promise.reject(new Error('Owned child already exited before ' + label + ': ' + JSON.stringify(exit)));
        return new Promise((resolveMessage, reject) => waiting.push({match, label, resolve: resolveMessage, reject}));
      };
      t.after(async () => {
        // Only the exact ChildProcess created here is ever signalled.
        if (!closed) child.kill('SIGKILL');
        await closeTask;
      });
      const ready = await waitFor(value => value.kind === 'ready', 'ready');
      assert.equal(ready.pid, child.pid);
      assert.deepEqual(ready.nativeSignalListeners, {SIGTERM: 1, SIGINT: 1});
      await waitFor(value => value.kind === 'stage' && value.stage === 'native', 'native pending');
      if (stage === 'owned') {
        child.send('release-native');
        await waitFor(value => value.kind === 'stage' && value.stage === 'owned', 'owned pending');
      }
      assert.equal(child.kill(signal), true, 'Send real signal only to this spawned child');
      await waitFor(value => value.kind === 'signal-routed' && value.name === signal, 'actual helper signal callback');
      assert.equal(closed, false); assert.equal(child.exitCode, null);
      assert.equal(messages.some(value => value.kind === 'cleanup-completed'), false);
      if (stage === 'native') {
        child.send('release-native');
        await waitFor(value => value.kind === 'stage' && value.stage === 'owned', 'owned pending after native release');
      }
      assert.equal(closed, false, 'Actual child must remain alive until owned cleanup is released');
      child.send('release-owned');
      const receipt = await waitFor(value => value.kind === 'cleanup-completed', 'complete owned cleanup receipt');
      assert.equal(receipt.pid, child.pid);
      assert.deepEqual(await closeTask, {code: signal === 'SIGTERM' ? 143 : 130, signal: null});
      assert.equal(messages.filter(value => value.kind === 'cleanup-completed').length, 1);
      assert.equal(stderr, '');
    });
  }
}

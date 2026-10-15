import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {describe, expect, it, vi} from 'vitest';

// Every child and signal source is fake; these tests do not launch browsers or Node children.
const require = createRequire(import.meta.url);
type Job = {name: string; mode: string; tier: string};
type Result = {
  ok: boolean;
  timedOut: boolean;
  aborted?: boolean;
  notStarted?: boolean;
  error?: string | null;
  exitCode?: number | null;
  signal?: string | null;
  attempts?: Result[];
};
type Child = EventEmitter & {pid: number};
const {
  MAX_CONCURRENT_JOBS,
  runChildWithWatchdog,
  runJobAttempts,
  runJobsWithBoundedConcurrency,
} = require('../scripts/run-site-translation-matrix.cjs') as {
  MAX_CONCURRENT_JOBS: number;
  runChildWithWatchdog: (command: string, values: string[], options: {
    timeoutMs: number;
    signal?: AbortSignal;
    spawnImpl: () => Child;
    killProcessGroupImpl: (child: Child, signal: string) => boolean;
  }) => Promise<Result>;
  runJobAttempts: (
    runAttempt: (attempt: number) => Promise<Result>, maxAttempts: number, options?: {signal?: AbortSignal},
  ) => Promise<Result>;
  runJobsWithBoundedConcurrency: (
    jobs: Job[], runJob: (job: Job, signal: AbortSignal) => Promise<Result>, options: {signalSource: EventEmitter},
  ) => Promise<{results: Array<Job & Result>; aborted: boolean; abortSignal: string | null}>;
};

const jobs = Array.from({length: 4}, (_, index) => ({name: `required-${index}`, mode: 'hover', tier: 'required'}));

function fakeMatrix(input = jobs) {
  const signalSource = new EventEmitter();
  const children: Array<{child: Child; name: string; attempt: number}> = [];
  const signals: Array<{pid: number; signal: string}> = [];
  let active = 0;
  let peak = 0;
  const pending = runJobsWithBoundedConcurrency(input, (job, signal) => runJobAttempts((attempt) =>
    runChildWithWatchdog('fake-runner', [], {
      timeoutMs: 60_000,
      signal,
      spawnImpl: () => {
        const child = Object.assign(new EventEmitter(), {pid: 10_000 + children.length});
        children.push({child, name: job.name, attempt});
        active += 1;
        peak = Math.max(peak, active);
        child.once('close', () => { active -= 1; });
        return child;
      },
      killProcessGroupImpl: (child, sent) => {
        signals.push({pid: child.pid, signal: sent});
        return true;
      },
    }), job.tier === 'required' ? 2 : 1, {signal}), {signalSource});
  const close = (index: number, code = 0, signal: string | null = null) => {
    children[index].child.emit('exit', code, signal);
    children[index].child.emit('close', code, signal);
  };
  return {pending, signalSource, children, signals, close, active: () => active, peak: () => peak};
}

describe('bounded real-site matrix scheduling', () => {
  it('runs at most two owned fake children, preserves job order and continues required jobs after FAIL', async () => {
    vi.useFakeTimers();
    try {
      expect(MAX_CONCURRENT_JOBS).toBe(2);
      const matrix = fakeMatrix();
      expect(matrix.children.map(({name}) => name)).toEqual(['required-0', 'required-1']);
      matrix.close(1); // Complete later job first, then dispatch required-2.
      await vi.advanceTimersByTimeAsync(0);
      expect(matrix.children[2].name).toBe('required-2');
      matrix.close(0, 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(matrix.children[3]).toMatchObject({name: 'required-0', attempt: 2});
      matrix.close(3, 1); // FAIL must not cancel required-3.
      await vi.advanceTimersByTimeAsync(0);
      expect(matrix.children[4].name).toBe('required-3');
      matrix.close(4);
      matrix.close(2);
      const result = await matrix.pending;
      expect(matrix.peak()).toBe(2);
      expect(matrix.active()).toBe(0);
      expect(result).toMatchObject({aborted: false, abortSignal: null});
      expect(result.results.map(({name}) => name)).toEqual(jobs.map(({name}) => name));
      expect(result.results.map(({ok}) => ok)).toEqual([false, true, true, true]);
      expect(result.results[0].attempts?.map(({exitCode}) => exitCode)).toEqual([1, 1]);
      expect(matrix.signals).toEqual([]);
      expect(matrix.signalSource.listenerCount('SIGINT')).toBe(0);
      expect(matrix.signalSource.listenerCount('SIGTERM')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['SIGINT', 'SIGTERM'])('stops dispatch on %s, retains the tail and joins both owned children after KILL', async (signal) => {
    vi.useFakeTimers();
    try {
      const matrix = fakeMatrix();
      let joined = false;
      void matrix.pending.then(() => { joined = true; });
      matrix.signalSource.emit(signal);
      matrix.signalSource.emit(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT');
      expect(matrix.children).toHaveLength(2);
      expect(matrix.signals).toEqual([
        {pid: 10_000, signal: 'SIGTERM'}, {pid: 10_001, signal: 'SIGTERM'},
      ]);
      matrix.close(0, 0, 'SIGTERM'); // Even a zero exit after abort cannot pass.
      await vi.advanceTimersByTimeAsync(4999);
      expect(joined).toBe(false);
      expect(matrix.signals).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(matrix.signals).toEqual([
        {pid: 10_000, signal: 'SIGTERM'}, {pid: 10_001, signal: 'SIGTERM'},
        {pid: 10_000, signal: 'SIGKILL'}, {pid: 10_001, signal: 'SIGKILL'},
      ]);
      await vi.advanceTimersByTimeAsync(60_000); // KILL alone cannot synthesize close.
      expect(joined).toBe(false);
      expect(matrix.children).toHaveLength(2);
      matrix.close(1, 0, 'SIGKILL');
      const result = await matrix.pending;
      expect(result).toMatchObject({aborted: true, abortSignal: signal});
      expect(result.results.map(({name}) => name)).toEqual(jobs.map(({name}) => name));
      expect(result.results.every(({ok}) => !ok)).toBe(true);
      expect(result.results.slice(0, 2)).toMatchObject([
        {aborted: true, attempts: [{signal: 'SIGTERM'}]},
        {aborted: true, attempts: [{signal: 'SIGKILL'}]},
      ]);
      expect(result.results.slice(2)).toMatchObject([
        {notStarted: true, aborted: true, attempts: []},
        {notStarted: true, aborted: true, attempts: []},
      ]);
      expect(matrix.signalSource.listenerCount('SIGINT')).toBe(0);
      expect(matrix.signalSource.listenerCount('SIGTERM')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an owned child error until its real close and saves every required retry outcome', async () => {
    vi.useFakeTimers();
    try {
      const matrix = fakeMatrix([jobs[0]]);
      let joined = false;
      void matrix.pending.then(() => { joined = true; });
      matrix.children[0].child.emit('error', new Error('owned child error'));
      await vi.advanceTimersByTimeAsync(0);
      expect(joined).toBe(false);
      expect(matrix.children).toHaveLength(1);
      matrix.close(0, 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(matrix.children).toHaveLength(2);
      matrix.close(1);
      const result = await matrix.pending;
      expect(result.results[0]).toMatchObject({ok: true, attempts: [
        {ok: false, exitCode: 1, error: 'owned child error'}, {ok: true, exitCode: 0},
      ]});
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves thrown spawn errors and rejected attempts instead of dropping required jobs', async () => {
    const result = await runJobAttempts((attempt) => {
      if (attempt === 1) return runChildWithWatchdog('fake', [], {
        timeoutMs: 100,
        spawnImpl: () => { throw new Error('spawn denied'); },
        killProcessGroupImpl: () => { throw new Error('must never signal an unspawned child'); },
      });
      return Promise.reject('attempt rejected');
    }, 2);
    expect(result).toMatchObject({ok: false, error: 'attempt rejected', attempts: [
      {ok: false, error: 'spawn denied'}, {ok: false, error: 'attempt rejected'},
    ]});

    const signalSource = new EventEmitter();
    const runJob = vi.fn((job: Job) => {
      if (job.name === jobs[0].name) throw new Error('job threw');
      if (job.name === jobs[1].name) return Promise.reject('job rejected');
      return Promise.resolve({ok: true, timedOut: false});
    });
    const scheduled = await runJobsWithBoundedConcurrency(jobs, runJob, {signalSource});
    expect(runJob.mock.calls.map(([job]) => job.name)).toEqual(jobs.map(({name}) => name));
    expect(scheduled.results).toMatchObject([
      {ok: false, error: 'job threw'}, {ok: false, error: 'job rejected'}, {ok: true}, {ok: true},
    ]);
    expect(signalSource.listenerCount('SIGINT')).toBe(0);
    expect(signalSource.listenerCount('SIGTERM')).toBe(0);
  });

  it('keeps the original timeout and no-retry policy while waiting for real close after KILL', async () => {
    vi.useFakeTimers();
    try {
      const matrix = fakeMatrix([jobs[0]]);
      let joined = false;
      void matrix.pending.then(() => { joined = true; });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(matrix.signals).toEqual([{pid: 10_000, signal: 'SIGTERM'}]);
      await vi.advanceTimersByTimeAsync(5000);
      expect(matrix.signals).toEqual([
        {pid: 10_000, signal: 'SIGTERM'}, {pid: 10_000, signal: 'SIGKILL'},
      ]);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(joined).toBe(false);
      matrix.close(0, 0, 'SIGKILL');
      const result = await matrix.pending;
      expect(result.results[0]).toMatchObject({ok: false, timedOut: true, exitCode: 0, attempts: [{timedOut: true}]});
      expect(matrix.children).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not signal a completed sibling or an exited child that is still waiting for close', async () => {
    vi.useFakeTimers();
    try {
      const matrix = fakeMatrix(jobs.slice(0, 2));
      matrix.close(0);
      await vi.advanceTimersByTimeAsync(0);
      matrix.children[1].child.emit('exit', 0, null);
      matrix.signalSource.emit('SIGTERM');
      expect(matrix.signals).toEqual([]);
      let joined = false;
      void matrix.pending.then(() => { joined = true; });
      await vi.advanceTimersByTimeAsync(70_000);
      expect(joined).toBe(false);
      matrix.children[1].child.emit('close', 0, null);
      const result = await matrix.pending;
      expect(result.aborted).toBe(true);
      expect(result.results).toMatchObject([{ok: true}, {ok: false, aborted: true}]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles abort during spawn without losing the owned child or starting another job', async () => {
    vi.useFakeTimers();
    try {
      const signalSource = new EventEmitter();
      const child = Object.assign(new EventEmitter(), {pid: 12345});
      const sent: string[] = [];
      const runJob = vi.fn((_job: Job, signal: AbortSignal) => runChildWithWatchdog('fake', [], {
        timeoutMs: 100,
        signal,
        spawnImpl: () => {
          signalSource.emit('SIGINT');
          return child;
        },
        killProcessGroupImpl: (_target, signal) => { sent.push(signal); return true; },
      }));
      const pending = runJobsWithBoundedConcurrency(jobs, runJob, {signalSource});
      expect(runJob).toHaveBeenCalledTimes(1);
      expect(sent).toEqual(['SIGTERM']);
      child.emit('close', null, 'SIGTERM');
      await vi.advanceTimersByTimeAsync(5000);
      const result = await pending;
      expect(result).toMatchObject({aborted: true, abortSignal: 'SIGINT'});
      expect(sent).toEqual(['SIGTERM', 'SIGKILL']);
      expect(result.results.slice(1).every(({notStarted}) => notStarted)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not spawn after cancellation and does not retry when abort lands between attempts', async () => {
    const controller = new AbortController();
    controller.abort('SIGTERM');
    const spawnImpl = vi.fn(() => Object.assign(new EventEmitter(), {pid: 54321}));
    expect(await runChildWithWatchdog('fake', [], {
      timeoutMs: 100, signal: controller.signal, spawnImpl, killProcessGroupImpl: vi.fn(() => true),
    })).toMatchObject({ok: false, aborted: true, notStarted: true});
    expect(spawnImpl).not.toHaveBeenCalled();

    const between = new AbortController();
    const runAttempt = vi.fn(async () => {
      between.abort('SIGTERM');
      return {ok: false, timedOut: false, error: 'first failure before abort'};
    });
    expect(await runJobAttempts(runAttempt, 2, {signal: between.signal})).toMatchObject({
      ok: false, attempts: [{error: 'first failure before abort'}],
    });
    expect(runAttempt).toHaveBeenCalledTimes(1);
  });
});

describe('maintained compatibility profile', () => {
  const {parseArgs, selectedEntries, childArgs} = require('../scripts/run-site-translation-matrix.cjs');
  const {parseArgs: parseCase} = require('../scripts/run-site-translation-test.cjs');
  const cases = require('./browser-translation-cases.json');
  const profile = require('../scripts/site-translation/maintenance-cases.json');
  const args = ['--extension-dir', '/temporary/production', '--playwright-root', '/runtime',
    '--focus-safe-helper', '/helper', '--allow-network', '--mode', 'full'];

  it('selects ten independent real required hosts and all requested content categories', () => {
    const parsed = parseArgs([...args, '--profile', 'maintenance']);
    const entries = selectedEntries(parsed, Object.entries(cases)) as Array<[string, {url: string; tier: string}]>;
    expect(entries).toHaveLength(10);
    expect(new Set(entries.map(([, value]) => new URL(value.url).hostname)).size).toBe(10);
    expect(entries.every(([, value]) => value.tier === 'required')).toBe(true);
    expect(profile.cases.map((entry: {category: string}) => entry.category))
      .toEqual(expect.arrayContaining(['news', 'long-article', 'github', 'discussion', 'dynamic-documentation']));
    expect(() => selectedEntries({...parsed, cases: ['example-com']}, Object.entries(cases))).toThrow('cannot be combined');
    expect(() => selectedEntries({...parsed, profile: 'unknown'}, Object.entries(cases))).toThrow('Unknown profile');
  });

  it('forwards explicit controlled-provider and lifecycle scope to each child without changing default live-provider mode', () => {
    const parsed = parseArgs([...args, '--controlled-provider', '--stability-probes']);
    const child = childArgs(parsed, 'index-luke-preface', 'full');
    expect(child).toEqual(expect.arrayContaining(['--controlled-provider', '--stability-probes']));
    expect(parseCase(child.slice(1))).toMatchObject({controlledProvider: true, stabilityProbes: true, service: 'microsoft'});
    expect(parseCase(childArgs(parseArgs(args), 'index-luke-preface', 'full').slice(1)).service).toBe('freeTranslation');
    expect(() => parseArgs([...args, '--mode', 'both', '--stability-probes'])).toThrow('requires --mode full');
    expect(() => parseCase([...child.slice(1), '--mode', 'hover'])).toThrow('requires --mode full');
  });
});

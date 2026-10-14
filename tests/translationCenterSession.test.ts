import {describe, expect, it, vi} from 'vitest';
import {createComparisonSession, isComparisonStale, MAX_COMPARISON_TEXT_LENGTH, type ComparisonCard, type ComparisonInput, type ComparisonState} from '@/src/features/translation-center/model/comparison';

const input = (text = 'Original'): ComparisonInput => ({text, sourceLanguage: 'en', targetLanguage: 'zh-Hans', model: 'model-a'});
const deferred = () => {
  let resolve!: (value: string) => void, reject!: (value: unknown) => void;
  const promise = new Promise<string>((done, fail) => {resolve = done; reject = fail;});
  return {promise, resolve, reject};
};
function setup() {
  const state: ComparisonState = {cards: [], run: 0};
  const calls: Array<{service: string; input: ComparisonInput; signal: AbortSignal; task: ReturnType<typeof deferred>}> = [];
  const translate = vi.fn((service: string, snapshot: ComparisonInput, signal: AbortSignal) => {
    const task = deferred(); calls.push({service, input: snapshot, signal, task}); return task.promise;
  });
  const session = createComparisonSession(state, translate, () => 100);
  session.syncServices(['a', 'b']);
  return {state, calls, session, translate};
}
describe('translation center independent comparison sessions', () => {
  it('captures separate immutable input snapshots and commits progressive results', async () => {
    const {state, session, calls} = setup();
    const source = input('  Original  ');
    const run = session.run(['a', 'b', 'a'], () => source);
    source.text = 'Changed'; source.targetLanguage = 'ja';
    expect(calls[0].input).toEqual(input());
    expect(state.cards.map(card => card.status)).toEqual(['loading', 'loading']);
    calls[0].task.resolve('  Translation A  '); await Promise.resolve(); await Promise.resolve();
    expect(state.cards[0]).toMatchObject({status: 'success', result: 'Translation A', duration: 1});
    expect(state.cards[1].status).toBe('loading');
    calls[1].task.reject(new Error('unavailable')); await run;
    expect(state.cards[1]).toMatchObject({status: 'error', error: 'unavailable'});
    expect(state.run).toBe(1);
  });
  it('marks blank responses as errors and supports non-Error failures', async () => {
    const {state, session, calls} = setup();
    const run = session.run(['a', 'b'], () => input());
    calls[0].task.resolve(' \n '); calls[1].task.reject('rate limit'); await run;
    expect(state.cards[0]).toMatchObject({status: 'error', error: 'empty-result', result: ''});
    expect(state.cards[1].error).toBe('rate limit');
  });
  it('preserves completed results on reorder and cancels removed services', async () => {
    const {state, session, calls} = setup();
    const run = session.run(['a', 'b'], () => input());
    calls[0].task.resolve('keep'); await Promise.resolve(); await Promise.resolve();
    const card = state.cards[0]; session.syncServices(['b', 'a', 'b']);
    expect(state.cards[1]).toBe(card);
    session.syncServices(['a', 'c']);
    expect(calls[1].signal.aborted).toBe(true);
    calls[1].task.resolve('late'); await run;
    expect(state.cards[0].result).toBe('keep'); expect(state.cards[1].status).toBe('idle');
  });
  it('stops unfinished items without clearing successes or accepting late responses', async () => {
    const {state, session, calls} = setup();
    const run = session.run(['a', 'b'], () => input());
    calls[0].task.resolve('done'); await Promise.resolve(); await Promise.resolve();
    session.stop(); session.stopService('unknown');
    expect(state.cards.map(card => card.status)).toEqual(['success', 'cancelled']);
    calls[1].task.resolve('late'); await run;
    expect(state.cards[0].result).toBe('done'); expect(state.cards[1].result).toBe('');
  });
  it('retries a stopped service while another service is running and rejects superseded failures', async () => {
    const {state, session, calls, translate} = setup();
    const first = session.run(['a', 'b'], () => input());
    await session.run(['a', 'missing'], () => input());
    expect(translate).toHaveBeenCalledTimes(2);
    session.stopService('a');
    const retry = session.run(['a'], () => input('new'));
    calls[0].task.reject(new Error('late error')); calls[2].task.resolve('new result'); calls[1].task.resolve('b result');
    await Promise.all([first, retry]);
    expect(state.cards[0]).toMatchObject({status: 'success', result: 'new result', run: 2});
    expect(state.cards[1]).toMatchObject({status: 'success', result: 'b result', run: 1});
  });
  it('never starts empty, oversized or same-language tasks', async () => {
    const {state, session, translate} = setup();
    for (const snapshot of [input('  '), input('x'.repeat(MAX_COMPARISON_TEXT_LENGTH + 1)), {...input(), targetLanguage: 'en'}]) {
      await session.run(['a'], () => snapshot);
    }
    await session.run([], () => input());
    expect(translate).not.toHaveBeenCalled(); expect(state.run).toBe(0);
  });
  it('recognizes upstream AbortError as stopped, not failed', async () => {
    const {state, session, calls} = setup();
    const run = session.run(['a'], () => input());
    const error = new Error('stopped'); error.name = 'AbortError'; calls[0].task.reject(error); await run;
    expect(state.cards[0].status).toBe('cancelled');
  });
  it('can stop after a card has already disappeared and dispose rejects all future work', async () => {
    const {state, session, calls, translate} = setup();
    const run = session.run(['a'], () => input()); state.cards = [];
    session.dispose(); calls[0].task.resolve('late'); await run;
    session.syncServices(['b']); await session.run(['b'], () => input());
    expect(translate).toHaveBeenCalledOnce(); expect(calls[0].signal.aborted).toBe(true);
  });
  it('uses a monotonic clock by default', async () => {
    const state: ComparisonState = {cards: [], run: 0};
    const session = createComparisonSession(state, async () => 'result'); session.syncServices(['a']);
    await session.run(['a'], () => input()); expect(state.cards[0].duration).toBeGreaterThanOrEqual(1);
  });
  it('detects stale input, language or model but ignores harmless surrounding whitespace', () => {
    const card: ComparisonCard = {service: 'a', status: 'idle', result: '', error: '', duration: 0, run: 0, input: null};
    expect(isComparisonStale(card, input())).toBe(false);
    card.input = input();
    expect(isComparisonStale(card, input('  Original '))).toBe(false);
    for (const change of [{text: 'new'}, {sourceLanguage: 'auto'}, {targetLanguage: 'ja'}, {model: 'b'}, {connectionFingerprint: 'composite-v1:changed'}]) {
      expect(isComparisonStale(card, {...input(), ...change})).toBe(true);
    }
  });
});

import {afterEach, expect, it, vi} from 'vitest';
import {createFreeFallbackRunner} from '@/src/services/translation/freeFallback';

afterEach(() => {vi.useRealTimers();});

it('reports an exhausted pool before an unrelated transport consumes its remaining deadline', async () => {
    vi.useFakeTimers();
    const run = createFreeFallbackRunner(1, {random: () => 0});
    const settings = {mode: 'sequential' as const, timeoutMs: 5_000, cooldownMs: 1_000};
    const failed = vi.fn(async () => {throw Object.assign(new Error('busy'), {statusCode: 429});});
    const cooling = {identity: 'cooling', label: 'cooling', translate: failed};
    await expect(run([cooling], settings)).rejects.toMatchObject({kind: 'rate-limit', retryable: false,
        code: 'FREE_TRANSLATION_TEMPORARILY_UNAVAILABLE'});
    let finish!: (text: string) => void;
    let signal!: AbortSignal;
    const held = run([{identity: 'held', label: 'held', translate: current => {
        signal = current;
        return new Promise<string>(resolve => {finish = resolve;});
    }}], settings);
    await vi.advanceTimersByTimeAsync(0);
    const attempted = vi.fn();
    const unavailable = run([cooling], {...settings, deadline: Date.now() + 100, onAttempt: attempted})
        .then(value => ({value}), error => ({error}));
    try {
        await vi.advanceTimersByTimeAsync(100);
        await expect(unavailable).resolves.toMatchObject({error: {kind: 'rate-limit', retryable: false,
            code: 'FREE_TRANSLATION_TEMPORARILY_UNAVAILABLE'}});
        expect(failed).toHaveBeenCalledOnce();
        expect(attempted).not.toHaveBeenCalled();
        expect(signal.aborted).toBe(false);
    } finally {
        finish('held result');
        await expect(held).resolves.toBe('held result');
    }
    await expect(run([{identity: 'ready', label: 'ready', translate: async () => 'ready result'}], settings))
        .resolves.toBe('ready result');
    expect(vi.getTimerCount()).toBe(0);
});

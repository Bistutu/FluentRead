import {describe, expect, it} from 'vitest';
import {createCompositeTranslationRoutingState} from '@/src/services/translation/compositeRouting';
import type {CompositeTranslationProvider} from '@/src/core/config/compositeTranslation';

const profile = (strategy: CompositeTranslationProvider['strategy']): CompositeTranslationProvider => ({
    id: 'composite:sample', name: '组合', strategy, services: ['google', 'microsoft', 'deepL'], timeoutMs: 12_000,
});

describe('composite routing observations', () => {
    it('preserves priority and shuffles random members without mutating configuration', () => {
        const state = createCompositeTranslationRoutingState({random: () => 0});
        const sequential = profile('sequential');
        expect(state.order(sequential)).toEqual(sequential.services);
        expect(state.order(profile('random'))).toEqual(['microsoft', 'deepL', 'google']);
        expect(sequential.services).toEqual(['google', 'microsoft', 'deepL']);
        expect(state.order({...sequential, strategy: 'random', services: []})).toEqual([]);
    });

    it('learns speed and success, cools failures, and keeps observations isolated by group', () => {
        let time = 0;
        const state = createCompositeTranslationRoutingState({now: () => time});
        const smart = profile('smart');
        expect(state.order(smart)).toEqual(smart.services);
        state.record(smart.id, 'google', true, 200);
        state.record(smart.id, 'microsoft', true, 100);
        expect(state.order(smart)[0]).toBe('microsoft');
        state.record(smart.id, 'microsoft', false, 100);
        expect(state.order(smart)[0]).toBe('google');
        expect(state.order({...smart, id: 'composite:other'})).toEqual(smart.services);
        time = 30_001;
        expect(state.order(smart)[0]).toBe('microsoft');
        state.record(smart.id, 'microsoft', true, 150);
        expect(state.order(smart)[0]).toBe('microsoft');
    });

    it('bounds health entries and handles zero or nonfinite duration', () => {
        const state = createCompositeTranslationRoutingState();
        const smart = profile('smart');
        state.record(smart.id, 'google', false, Number.NaN);
        state.record(smart.id, 'microsoft', true, 0);
        expect(state.order(smart)[0]).toBe('microsoft');
        for (let index = 0; index < 201; index += 1) state.record(`composite:${index}`, 'google', true, 100);
        expect(state.order(smart)).toEqual(smart.services);
    });
});

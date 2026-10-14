import {describe, expect, it} from 'vitest';
import {
    DEFAULT_AI_REQUEST_TIMEOUT_MS,
    MIN_AI_REQUEST_TIMEOUT_MS,
    MAX_AI_REQUEST_TIMEOUT_MS,
    normalizeAiRequestTimeoutMs,
} from '@/src/core/config/aiRequestTimeout';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {prepareConfigForExport, prepareConfigForImport} from '@/src/core/config/transfer';
import {normalizeUserscriptConfig} from '@/userscript/initialize';

describe('AI request timeout configuration', () => {
    it('defaults old and new configurations to two minutes', () => {
        expect(DEFAULT_AI_REQUEST_TIMEOUT_MS).toBe(120_000);
        expect(MIN_AI_REQUEST_TIMEOUT_MS).toBe(10_000);
        expect(MAX_AI_REQUEST_TIMEOUT_MS).toBe(600_000);
        expect(new Config().aiRequestTimeoutMs).toBe(DEFAULT_AI_REQUEST_TIMEOUT_MS);
        expect(normalizeConfig({service: 'openai'}).aiRequestTimeoutMs).toBe(DEFAULT_AI_REQUEST_TIMEOUT_MS);
    });

    it.each([undefined, null, '', '300000', true, {}, [], Number.NaN, Infinity, -Infinity])(
        'rejects non-numeric or non-finite stored timeout %j', value => {
            expect(normalizeAiRequestTimeoutMs(value)).toBe(DEFAULT_AI_REQUEST_TIMEOUT_MS);
            expect(normalizeConfig({aiRequestTimeoutMs: value}).aiRequestTimeoutMs).toBe(DEFAULT_AI_REQUEST_TIMEOUT_MS);
        },
    );

    it.each([
        [-1, 10_000], [0, 10_000], [9_999, 10_000], [10_000, 10_000],
        [120_000.4, 120_000], [300_000.6, 300_001], [600_000, 600_000], [900_000, 600_000],
    ])('rounds and bounds finite milliseconds %s to %s', (value, expected) => {
        expect(normalizeAiRequestTimeoutMs(value)).toBe(expected);
        expect(normalizeConfig({aiRequestTimeoutMs: value}).aiRequestTimeoutMs).toBe(expected);
    });

    it('preserves a custom timeout across exports, imports and userscript normalization', () => {
        const current = normalizeConfig({...new Config(), service: 'openai', aiRequestTimeoutMs: 300_000});
        const exported = prepareConfigForExport(current);
        expect(exported.aiRequestTimeoutMs).toBe(300_000);
        const imported = prepareConfigForImport(exported, new Config());
        expect(imported.aiRequestTimeoutMs).toBe(300_000);
        expect(normalizeUserscriptConfig(imported).aiRequestTimeoutMs).toBe(300_000);
        const {aiRequestTimeoutMs: _removed, ...legacy} = exported;
        expect(prepareConfigForImport(legacy, current).aiRequestTimeoutMs).toBe(120_000);
        expect(normalizeUserscriptConfig({...legacy, aiRequestTimeoutMs: '300000'}).aiRequestTimeoutMs).toBe(120_000);
        expect(normalizeUserscriptConfig({...imported, aiRequestTimeoutMs: 900_000}).aiRequestTimeoutMs).toBe(600_000);
    });
});

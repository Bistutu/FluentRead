import { describe, expect, it } from 'vitest';
import { Config, normalizeConfig } from '@/entrypoints/utils/model';
import {
    applyResolutions,
    configValuesEqual,
    detectConflicts,
} from '@/entrypoints/utils/google-drive/conflict-merge';

function makeConfig(): Config {
    const config = new Config();
    config.from = 'en';
    config.to = 'zh-CN';
    config.service = 'microsoft';
    return normalizeConfig(config);
}

describe('Google Drive three-way config merge', () => {
    it('compares object key order by value rather than serialization order', () => {
        expect(configValuesEqual({a: 1, b: {c: 2}}, {b: {c: 2}, a: 1})).toBe(true);
        expect(configValuesEqual({a: [1, 2]}, {a: [2, 1]})).toBe(false);
    });

    it('reports local-only and remote-only changes as choices', () => {
        const base = makeConfig();
        const local = normalizeConfig({...base, to: 'ja'});
        const remote = normalizeConfig({...base, service: 'google'});

        const result = detectConflicts(base, local, remote);

        expect(result.conflicts.map((conflict) => conflict.path.join('.'))).toEqual(['to', 'service']);
        expect(result.draft.to).toBe(base.to);
        expect(result.draft.service).toBe(base.service);
    });

    it('auto-applies a value when both sides made the same change', () => {
        const base = makeConfig();
        const local = normalizeConfig({...base, to: 'ja'});
        const remote = normalizeConfig({...base, to: 'ja'});

        const result = detectConflicts(base, local, remote);

        expect(result.conflicts).toHaveLength(0);
        expect(result.draft.to).toBe('ja');
    });

    it('applies selected values and keeps the other fields from the draft', () => {
        const base = makeConfig();
        const local = normalizeConfig({...base, to: 'ja'});
        const remote = normalizeConfig({...base, service: 'google'});
        const diff = detectConflicts(base, local, remote);

        const resolved = applyResolutions(diff, {
            to: 'local',
            service: 'remote',
        });

        expect(resolved.validationError).toBeNull();
        expect(resolved.config.to).toBe('ja');
        expect(resolved.config.service).toBe('google');
    });
});

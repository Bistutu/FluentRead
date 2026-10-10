import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Config, normalizeConfig} from '@/src/core/config/model';

const source = readFileSync(resolve(process.cwd(), 'userscript/SettingsPanel.vue'), 'utf8');

describe('userscript free translation settings', () => {
    it('exposes mode controls, with ordering controls limited to sequential mode', () => {
        expect(source).toContain('v-model="draft.freeTranslationMode"');
        expect(source).toContain('value="balanced">智能加速');
        expect(source).toContain('value="sequential">优先顺序');
        expect(source).not.toContain('freeTranslationWeights');
        expect(source).toContain('优先使用快且稳定的服务');
        expect(source).toContain('v-if="draft.freeTranslationMode === \'sequential\'"');
        expect(source).not.toContain('draft.freeTranslationCooldownMs');
    });

    it('keeps narrow-screen fallback rows bounded and wrapped', () => {
        expect(source).toContain('.fallback-order-row { flex-wrap: wrap; }');
        expect(source).toContain('.fallback-order-row input[type=\'number\'] { flex: 1 1 96px; width: auto; }');
    });

    it('normalizes saved mode and selected fallback order without accepting user weights', () => {
        const normalized = normalizeConfig({
            service: 'freeTranslation',
            freeTranslationMode: 'unexpected',
            freeTranslationOrder: ['sogouFree', 'sogouFree', 'unknown'],
            freeTranslationWeights: {sogouFree: 99},
            // 旧配置首次升级会插入 B站；这里验证的是已升级配置的去重与过滤。
            freeTranslationBilibiliDefaultApplied: true,
        });
        expect(normalized.freeTranslationMode).toBe('balanced');
        expect(normalized.freeTranslationOrder).toEqual(['bilibiliFree', 'sogouFree']);
        expect(normalized.freeTranslationBilibiliDefaultApplied).toBe(true);
        expect(normalized).not.toHaveProperty('freeTranslationWeights');
        expect(new Config().freeTranslationMode).toBe('balanced');

        const saved = normalizeConfig({
            ...normalized,
            freeTranslationOrder: ['unknown', 'sogouFree', null, 'sogouFree', 42],
        });
        expect(saved.freeTranslationOrder).toEqual(['sogouFree']);
    });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/entrypoints/utils/config', () => ({
    config: {
        from: 'auto',
        to: 'zh-Hans',
    },
}));

import { getTranslationLanguages } from '@/entrypoints/utils/translationLanguage';

describe('翻译请求语言隔离', () => {
    it('优先使用请求级语言而不需要改写默认配置', () => {
        expect(getTranslationLanguages({
            sourceLanguage: 'en',
            targetLanguage: 'ja',
        })).toEqual({
            sourceLanguage: 'en',
            targetLanguage: 'ja',
        });
    });

    it('缺少或为空的请求级语言会回退到默认配置', () => {
        expect(getTranslationLanguages({
            sourceLanguage: ' ',
        })).toEqual({
            sourceLanguage: 'auto',
            targetLanguage: 'zh-Hans',
        });
    });
});

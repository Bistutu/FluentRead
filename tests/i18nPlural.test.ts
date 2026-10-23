import {describe, expect, it} from 'vitest';
import {registerUiLanguageBundle, translate, type TranslationParams} from '@/src/core/i18n';
import {registerAllUiLanguageBundles, UI_LANGUAGE_BUNDLES} from './helpers/uiLanguageBundles';
import {zhCNMessages} from '@/src/core/i18n/messages/zh-CN';
registerAllUiLanguageBundles();

describe('按界面语言选择数量文案', () => {
    it('所有数量变体都有基础资源，并保留相同的命名参数', () => {
        const parameters = (text: string) => [...new Set([...text.matchAll(/\{([a-zA-Z0-9_]+)\}/gu)].map(match => match[1]))].sort();
        for (const catalog of [zhCNMessages, ...Object.values(UI_LANGUAGE_BUNDLES).map(bundle => bundle.messages)] as Readonly<Record<string, string>>[]) {
            for (const [key, value] of Object.entries(catalog)) {
                const match = /^(.*)\.plural\.(zero|one|two|few|many|other)$/u.exec(key);
                if (!match) continue;
                expect(Object.hasOwn(catalog, match[1]), key).toBe(true);
                expect(parameters(value), key).toEqual(parameters(catalog[match[1]]));
            }
        }
    });
    it('英语和俄语按实际数量使用单数、复数和小数词形，其他语言保留完整数量', () => {
        expect(translate('popup.translationCount', 'en-US', {count: 1})).toBe('1 translation');
        expect(translate('popup.translationCount', 'en-US', {count: 0})).toBe('0 translations');
        expect(translate('common.itemCount', 'en-US', {count: 2})).toBe('2 items');
        expect(translate('glossary.entryCount', 'fr-FR', {count: 1})).toBe('1 entrée');
        expect(translate('glossary.entryCount', 'es-ES', {count: 1})).toBe('1 entrada');
        for (const [count, ending] of [[1, 'перевод'], [2, 'перевода'], [5, 'переводов'], [11, 'переводов'], [21, 'перевод'], [1.5, 'перевода']] as const) {
            expect(translate('popup.translationCount', 'ru-RU', {count})).toBe(`${count} ${ending}`);
        }
        for (const language of ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const) {
            for (const count of [0, 1, 2, 5, 21]) {
                for (const key of ['popup.translationCount', 'common.itemCount', 'glossary.entryCount']) {
                    const result = translate(key, language, {count});
                    expect(result).toContain(String(count));
                    expect(result).not.toContain('{count}');
                    expect(result).not.toBe(key);
                }
            }
        }
    });

    it('没有变体时保持原有参数与中文回退，格式化数量不猜测词形', () => {
        expect(translate('settings.sites.count', 'en-US', {count: 1})).toBe('Websites: 1');
        expect(translate('common.itemCount', 'en-US', {count: '1,000'})).toBe('1,000 items');
        expect(translate('unknown.key', 'en-US', {count: 1})).toBe('unknown.key');
        expect(translate('common.itemCount', 'en-US', {count: NaN})).toBe('NaN items');
        expect(translate('common.itemCount', 'en-US', Object.create({count: 1}) as TranslationParams)).toBe('{count} items');
        const original = UI_LANGUAGE_BUNDLES['en-US'];
        try {
            registerUiLanguageBundle('en-US', {...original, messages: {base: 'Base {count}', 'base.plural.other': 'Other {count}'}});
            expect(translate('base', 'en-US', {count: 1})).toBe('Other 1');
            expect(translate('popup.translationCount', 'en-US', {count: 1})).toBe('1 次翻译');
        } finally {registerUiLanguageBundle('en-US', original);}
    });
});

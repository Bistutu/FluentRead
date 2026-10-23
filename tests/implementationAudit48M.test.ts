/**
 * @file tests/implementationAudit48M.test.ts
 * 文件职责：通过配置差异公共入口验证深层预览摘要的真实本地化和敏感字段边界。
 * 主要内容：覆盖六种非中文语言、对象与数组和 JSON 嵌套、精确深度边界、映射格式化及脱敏。
 * 模块边界：只调用生产 buildConfigDiff 和真实语言资源注册、翻译函数，不复制私有算法或访问浏览器。
 */
import {beforeAll, describe, expect, it} from 'vitest';
import {buildConfigDiff} from '@/src/core/config/diff';
import {translateLegacyText, type RegisteredUiLanguage} from '@/src/core/i18n';
import {registerAllUiLanguageBundles} from './helpers/uiLanguageBundles';

const summarized = '已配置（内容已摘要）';
const localeCases: Array<[RegisteredUiLanguage, string]> = [
    ['en-US', 'Configured (content summarized)'],
    ['ja-JP', '設定済み（内容は要約）'],
    ['ko-KR', '설정됨(내용 요약)'],
    ['fr-FR', 'Configuré (contenu résumé)'],
    ['ru-RU', 'Настроено (содержимое сокращено)'],
    ['es-ES', 'Configurado (contenido resumido)'],
];

// These are input fixtures, not an alternate implementation of preview or comparison.
function nested(kind: 'object' | 'array' | 'mixed', depth: number, leaf: unknown): unknown {
    let value = leaf;
    for (let index = 0; index < depth; index += 1) {
        value = kind === 'array' || (kind === 'mixed' && index % 2 === 0) ? [value] : {child: value};
    }
    return value;
}

beforeAll(() => registerAllUiLanguageBundles());

describe('48M public config preview localization', () => {
    for (const [locale, expected] of localeCases) {
        it.each(['object', 'array', 'mixed', 'json'] as const)(`${locale} localizes the complete bounded %s preview`, kind => {
            const input = (leaf: string) => kind === 'json'
                ? JSON.stringify(nested('mixed', 32, {visible: leaf, apiToken: 'fixture-hidden-token'}))
                : nested(kind, 32, {visible: leaf, password: 'fixture-hidden-password'});
            const diff = buildConfigDiff({serviceRequestLimits: input('before')}, {serviceRequestLimits: input('after')});
            expect(diff.changeCount).toBe(1);
            const change = diff.groups[0].changes[0];
            expect(change.key).toBe('serviceRequestLimits');
            expect(change.before).toBe(summarized);
            expect(change.after).toBe(summarized);
            // ConfigManagement renders precisely this public result through translateLegacyText.
            expect(translateLegacyText(change.before, locale)).toBe(expected);
            expect(translateLegacyText(change.after, locale)).toBe(expected);
            expect(JSON.stringify(diff)).not.toContain('fixture-hidden');
        });
    }

    it.each(['object', 'array', 'mixed'] as const)('keeps the depth limit at exactly 32 for %s values', kind => {
        const visible = buildConfigDiff({}, {futurePreview: nested(kind, 31, 'visible-leaf')});
        expect(visible.groups[0].changes[0].after).toContain('visible-leaf');
        expect(visible.groups[0].changes[0].after).not.toContain(summarized);
        const bounded = buildConfigDiff({}, {futurePreview: nested(kind, 32, 'hidden-leaf')});
        expect(bounded.groups[0].changes[0].after).toBe(summarized);
        expect(JSON.stringify(bounded)).not.toContain('hidden-leaf');
    });

    it('redacts shallow object, array, JSON and credential values while retaining public content', () => {
        const diff = buildConfigDiff({}, {
            token: {openai: 'fixture-credential'},
            futureObject: {name: 'safe-object', apiKey: 'fixture-object-secret'},
            futureArray: [{name: 'safe-array', password: 'fixture-array-secret'}],
            futureJson: JSON.stringify({name: 'safe-json', secret: 'fixture-json-secret'}),
            futureText: 'Authorization: Bearer fixture-text-secret',
        });
        expect(diff.changeCount).toBe(4);
        const text = JSON.stringify(diff);
        expect(text).toContain('safe-object');
        expect(text).toContain('safe-array');
        expect(text).toContain('safe-json');
        expect(text).toContain('敏感内容已隐藏');
        expect(text).not.toContain('fixture-');
        expect(text).not.toContain(summarized);
    });

    it('bypasses model, request-body, prompt and list formatters only for an actual depth bailout', () => {
        const diff = buildConfigDiff({}, {
            model: {openai: nested('object', 32, 'model-leaf')},
            customBody: {openai: JSON.stringify(nested('array', 32, 'body-leaf'))},
            system_role: {openai: nested('mixed', 32, 'prompt-leaf')},
            customOpenAIProviders: nested('array', 32, 'provider-leaf'),
            quickTranslationProfiles: nested('array', 32, 'profile-leaf'),
        });
        expect(diff.changeCount).toBe(5);
        expect(diff.groups.flatMap(group => group.changes).map(change => change.after)).toEqual(Array(5).fill(summarized));
        expect(JSON.stringify(diff)).not.toContain('-leaf');
        const ordinary = buildConfigDiff({}, {system_role: {openai: summarized}});
        expect(ordinary.groups[0].changes[0].after).toBe(`已配置（${summarized.length} 字符）`);
    });

    it('compares 12000-level input while returning finite complete summaries without mutating snapshots', () => {
        const before = nested('mixed', 12_000, 'before-leaf');
        const after = nested('mixed', 12_000, 'after-leaf');
        expect(buildConfigDiff({futurePreview: before}, {futurePreview: before}).changeCount).toBe(0);
        const diff = buildConfigDiff({futurePreview: before}, {futurePreview: after});
        expect(diff.changeCount).toBe(1);
        expect(diff.groups[0].changes[0].before).toBe(summarized);
        expect(diff.groups[0].changes[0].after).toBe(summarized);
        expect(JSON.stringify(diff).length).toBeLessThan(500);
        let original = after;
        for (let index = 0; index < 12_000; index += 1) {
            original = Array.isArray(original) ? original[0] : (original as {child: unknown}).child;
        }
        expect(original).toBe('after-leaf');
    });

    it.each(['glossaryLibraries', 'bilingualSentenceHighlightProfiles', 'activeSentenceHighlightProfileId'] as const)('keeps the bounded %s summary localizable without an update suffix', field => {
        const diff = buildConfigDiff({[field]: nested('mixed', 32, 'old')}, {[field]: nested('mixed', 32, 'new')});
        expect(diff.changeCount).toBe(1);
        const change = diff.groups[0].changes[0];
        expect(change.before).toBe(summarized);
        expect(change.after).toBe(summarized);
        for (const [locale, expected] of localeCases) expect(translateLegacyText(change.after, locale)).toBe(expected);
    });

    it('does not summarize public siblings because excluded credentials contain a deep value', () => {
        const diff = buildConfigDiff({}, {futurePreview: {name: 'visible-sibling', apiKey: nested('mixed', 100, 'fixture-secret')}});
        expect(diff.changeCount).toBe(1);
        expect(diff.groups[0].changes[0].after).toBe('name：visible-sibling');
        expect(JSON.stringify(diff)).not.toContain('fixture-secret');
    });
});

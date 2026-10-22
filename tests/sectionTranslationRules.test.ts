import {describe, expect, it} from 'vitest';
import {
    MAX_SECTION_TRANSLATION_RULES,
    isValidSectionLocatorPath,
    isValidSectionSelector,
    matchesSectionTranslationRule,
    normalizeSectionRuleSite,
    normalizeSectionTranslationRules,
    validateSectionTranslationRule,
    type SectionTranslationRule,
} from '@/src/core/config/sectionTranslationRules';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {sanitizeConfigCredentials} from '@/src/core/config/credentials';
import {prepareConfigForExport, prepareConfigForImport} from '@/src/core/config/transfer';
import {projectDriveSyncConfig, restoreDriveSyncSettings} from '@/src/core/config/driveSync';
import {buildConfigDiff} from '@/src/core/config/diff';

const rule = (patch: Partial<SectionTranslationRule> = {}): SectionTranslationRule => ({
    id: 'reader-comments', enabled: true, site: 'example.com/docs/', selectors: [['[id="comments"]']], mode: 'remind', ...patch,
});

describe('记住局部翻译的规则作用域', () => {
    it('主机与路径有精确边界，不把相似域或相似前缀算作同一站点', () => {
        for (const url of ['https://example.com/docs', 'https://example.com/docs/article?token=private#comment', 'http://example.com/docs/']) {
            expect(matchesSectionTranslationRule(rule(), url)).toBe(true);
        }
        for (const url of ['https://sub.example.com/docs/', 'https://example.com.evil.test/docs/', 'https://example.com/docs-old/', 'https://example.com/doc/', 'file:///docs/', 'not a url']) {
            expect(matchesSectionTranslationRule(rule(), url)).toBe(false);
        }
        expect(matchesSectionTranslationRule(rule({site: 'example.com'}), new URL('https://example.com/any/path'))).toBe(true);
        expect(matchesSectionTranslationRule(rule({enabled: false}), 'https://example.com/docs/')).toBe(false);
        expect(matchesSectionTranslationRule(rule({site: 'https://example.com'}), 'https://example.com')).toBe(false);
    });

    it('子域通配不会命中根域，私有后缀和本地测试端口仍明确隔离', () => {
        const wildcard = rule({site: '*.example.com/docs/'});
        expect(matchesSectionTranslationRule(wildcard, 'https://a.b.example.com/docs/read')).toBe(true);
        expect(matchesSectionTranslationRule(wildcard, 'https://example.com/docs/read')).toBe(false);
        expect(matchesSectionTranslationRule(wildcard, 'https://notexample.com/docs/read')).toBe(false);
        expect(matchesSectionTranslationRule(rule({site: 'localhost:4321'}), 'http://localhost:4321/')).toBe(true);
        expect(matchesSectionTranslationRule(rule({site: 'localhost:4321'}), 'http://localhost:4322/')).toBe(false);
        expect(matchesSectionTranslationRule(rule({site: 'a.github.io'}), 'https://b.github.io/')).toBe(false);
    });

    it('规范化大小写和点路径，拒绝凭据、令牌、协议和全站通配', () => {
        expect(normalizeSectionRuleSite(' Example.COM./a/../docs/// ')).toBe('example.com/docs/');
        expect(normalizeSectionRuleSite('例子.公司.cn')).toMatch(/^xn--/u);
        expect(normalizeSectionRuleSite('127.0.0.1:1234')).toBe('127.0.0.1:1234');
        expect(normalizeSectionRuleSite('[::1]:1234')).toBe('[::1]:1234');
        for (const value of [null, '', '*', '*.com', '*.localhost', '*.127.0.0.1', '*.[::1]', '*.example.com:1234', 'https://example.com', 'a@example.com', 'example.com?q=secret', 'example.com#secret', 'example.com/path/*', 'a\\b.example.com', 'example.com:', '-bad.example.com', 'example.com:99999', 'x'.repeat(513), 'com', 'github.io', 'bad domain']) {
            expect(normalizeSectionRuleSite(value), String(value)).toBeNull();
        }
    });
});

describe('局部区域规则的输入与迁移边界', () => {
    it('拒绝宽泛/昂贵选择器，保留生成器使用的有限定位和开放 Shadow 路径', () => {
        for (const value of ['[id="comments"]', 'article.entry > p:nth-of-type(2)', 'main[data-testid="article"]', '[data-label="a:b"]', "section[role='main']"]) expect(isValidSectionSelector(value)).toBe(true);
        for (const value of [null, '', ' ', 'body', 'html > main', 'head.title', '*', 'main, aside', ':root', 'div:has(p)', 'p:nth-child(1)', 'div:nth-of-type(0)', 'div:nth-of-type(100000)', 'div::before', 'p + p', 'p ~ p', 'script', 'iframe.frame', 'x\u0000y', 'x'.repeat(513), Array(17).fill('main').join(' > ')]) expect(isValidSectionSelector(value), String(value)).toBe(false);
        expect(isValidSectionLocatorPath(['#host', '#content'])).toBe(true);
        for (const value of [null, [], ['body'], Array(9).fill('#host')]) expect(isValidSectionLocatorPath(value)).toBe(false);
    });

    it('校验返回字段位置，不修正错误自动模式或损坏定位', () => {
        expect(validateSectionTranslationRule(rule())).toBe('');
        expect(validateSectionTranslationRule(rule({profileId: 'quick-1'}))).toBe('');
        for (const [patch, field] of [[null, 'id'], [{id: ''}, 'id'], [{enabled: 'true'}, 'enabled'], [{site: '*.com'}, 'site'], [{selectors: []}, 'selectors'], [{selectors: Array(17).fill(['#a'])}, 'selectors'], [{selectors: [['body']]}, 'selectors'], [{mode: 'sometimes'}, 'mode'], [{profileId: ''}, 'profile']] as const) {
            expect(validateSectionTranslationRule(patch === null ? null : {...rule(), ...patch})).toBe(field);
        }
    });

    it('只保留白名单、去重规则和路径，克隆数组并限制数量', () => {
        const input = {...rule({site: 'EXAMPLE.com/docs///', profileId: 'quick-1'}), token: 'hidden', request: {apiKey: 'hidden'}, selectors: [[' #comments '], [' #comments ']]};
        const normalized = normalizeSectionTranslationRules([null, input, {...rule(), site: 'example.com/other/'}]);
        expect(normalized).toEqual([rule({site: 'example.com/docs/', profileId: 'quick-1', selectors: [['#comments']]})]);
        normalized[0].selectors[0][0] = '#changed';
        expect(input.selectors[0][0]).toBe(' #comments ');
        expect(normalizeSectionTranslationRules({})).toEqual([]);
        const many = Array.from({length: 250}, (_, index) => rule({id: `rule-${index}`}));
        expect(normalizeSectionTranslationRules(many)).toHaveLength(MAX_SECTION_TRANSLATION_RULES);
    });

    it('配置默认不记忆，完整导入、公开凭据清理和普通云备份保留规则且不携带秘密', () => {
        expect(new Config().sectionTranslationRules).toEqual([]);
        expect(normalizeConfig({sectionTranslationRules: 'broken'}).sectionTranslationRules).toEqual([]);
        const config = normalizeConfig({...new Config(), sectionTranslationRules: [{...rule(), token: 'hidden'}]});
        for (const snapshot of [prepareConfigForExport(config), sanitizeConfigCredentials(config)]) {
            expect(prepareConfigForImport(snapshot, new Config()).sectionTranslationRules).toEqual([rule()]);
        }
        const sanitized = sanitizeConfigCredentials({sectionTranslationRules: [{...rule(), request: {secret: 'private'}}]});
        expect(sanitized.sectionTranslationRules).toEqual([rule()]);
        expect(projectDriveSyncConfig(config as unknown as Record<string, unknown>).sectionTranslationRules).toEqual([rule()]);
        const unknown = {...rule(), request: {apiKey: 'private'}};
        expect(projectDriveSyncConfig({sectionTranslationRules: [unknown]})).not.toHaveProperty('sectionTranslationRules');
        const restored = restoreDriveSyncSettings({sectionTranslationRules: [rule()]}, {on: true});
        expect(restored.sectionTranslationRules).toEqual([rule()]);
        expect(restoreDriveSyncSettings({sectionTranslationRules: [rule()]}, {sectionTranslationRules: []}).sectionTranslationRules).toEqual([]);
        expect(JSON.stringify(buildConfigDiff(new Config(), config))).toContain('记住的翻译区域');
        expect(JSON.stringify(buildConfigDiff(new Config(), config))).toContain('提醒');
    });
});

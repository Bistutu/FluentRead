/**
 * @file src/features/section-translation/content/save.ts
 * 文件职责：将用户明确确认的网页区域转换为可保存规则，不采集正文、查询参数或请求凭据。
 * 主要内容：按当前网站或所在路径构建默认范围，验证全部区域都能唯一定位，合并相同范围和选区的重复保存，限制规则数量；持久化端口由内容入口注入，提交前检查所属选择仍然有效。
 * 模块边界：本模块复用规则模型和 DOM 定位器，不读写全局配置、不执行翻译、不渲染提示，也不管理选择器生命周期。
 */
import {MAX_SECTION_RULE_REGIONS, MAX_SECTION_TRANSLATION_RULES, normalizeSectionRuleSite, normalizeSectionTranslationRules, validateSectionTranslationRule, type SectionTranslationRule} from '@/src/core/config/sectionTranslationRules';
import {createSectionLocator} from '../locator';
import type {SectionRememberChoice} from './picker';

export function sectionRememberScopes(href: string): {site: string; path: string} | undefined {
    try {
        const url = new URL(href);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
        const site = normalizeSectionRuleSite(url.host);
        const directory = url.pathname.endsWith('/') ? url.pathname : url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
        const path = normalizeSectionRuleSite(`${url.host}${directory}`);
        return site && path ? {site, path} : undefined;
    } catch { return undefined; }
}

export class SectionRuleSaveError extends Error {
    constructor(readonly reason: 'unsupported' | 'limit' | 'saveFailed') { super(reason); }
}

export async function saveRememberedSection(selection: Element | readonly Element[], choice: SectionRememberChoice, ports: {
    rules(): readonly SectionTranslationRule[];
    profileId?: string;
    current(): boolean;
    persist(rules: SectionTranslationRule[]): Promise<void>;
}): Promise<boolean> {
    if (!ports.current()) return false;
    const elements = [...new Set(Array.isArray(selection) ? selection : [selection as Element])];
    if (!elements.length || elements.length > MAX_SECTION_RULE_REGIONS) throw new SectionRuleSaveError('unsupported');
    const paths = elements.map(createSectionLocator);
    if (paths.some(path => !path)) throw new SectionRuleSaveError('unsupported');
    const selectors = paths as string[][];
    const rules = normalizeSectionTranslationRules(ports.rules());
    const site = normalizeSectionRuleSite(choice.site) ?? '';
    const selectionKey = (paths: readonly string[][]): string => JSON.stringify([...new Set(paths.map(path => JSON.stringify(path)))].sort());
    const same = rules.find(rule => rule.site === site && selectionKey(rule.selectors) === selectionKey(selectors));
    if (!same && rules.length >= MAX_SECTION_TRANSLATION_RULES) throw new SectionRuleSaveError('limit');
    const rule: SectionTranslationRule = {id: same?.id ?? `section-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`, enabled: true, site, selectors, mode: choice.mode,
        ...(ports.profileId ? {profileId: ports.profileId} : {})};
    if (validateSectionTranslationRule(rule)) throw new SectionRuleSaveError('unsupported');
    if (!ports.current()) return false;
    await ports.persist(same ? rules.map(item => item.id === same.id ? rule : item) : [...rules, rule]);
    return ports.current();
}

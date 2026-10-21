/**
 * @file src/core/config/sectionTranslationRules.ts
 * 文件职责：定义用户显式保存的局部翻译区域规则，统一网站与路径匹配、有限选择器路径和配置校验。
 * 主要内容：规则只保存作用域、区域定位和自动/提醒模式，可引用既有快捷方案；归一化移除未知字段和损坏条目，限制规则、选区与开放 Shadow DOM 深度，以精确主机和路径段边界匹配页面。
 * 模块边界：本文件为无副作用的配置领域模型，不查询网页 DOM、不保存凭据、不监听导航，也不启动翻译；定位与生命周期由 section-translation feature 拥有。
 */
import {getSiteBaseDomain} from '@/src/core/site-rules/domain';

export interface SectionTranslationRule {
    id: string;
    enabled: boolean;
    site: string;
    selectors: string[][];
    mode: 'auto' | 'remind';
    profileId?: string;
}

export const MAX_SECTION_TRANSLATION_RULES = 100;
export const MAX_SECTION_RULE_REGIONS = 16;
export const MAX_SECTION_LOCATOR_DEPTH = 8;
export const MAX_SECTION_SELECTOR_LENGTH = 512;
export type SectionTranslationRuleError = '' | 'id' | 'enabled' | 'site' | 'selectors' | 'mode' | 'profile';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,128}$/u.test(value);

interface RuleSite {
    host: string;
    wildcard: boolean;
    path: string;
    site: string;
}

function parseRuleSite(value: unknown): RuleSite | null {
    if (typeof value !== 'string') return null;
    const input = value.trim();
    // 作用域不是任意 URL：不保存凭据、查询、锚点或通配路径，避免访问令牌意外进入配置。
    if (!input || input.length > 512 || /[\s\\?#@]/u.test(input) || /^[a-z][a-z\d+.-]*:\/\//iu.test(input)) return null;
    const wildcard = input.startsWith('*.');
    const rest = wildcard ? input.slice(2) : input;
    if (rest.includes('*')) return null;
    try {
        const url = new URL(`https://${rest}`);
        const hostname = url.hostname.replace(/\.+$/u, '').toLowerCase();
        if (!hostname || !getSiteBaseDomain(hostname) || wildcard && (hostname === 'localhost' || hostname.startsWith('[') || /^[\d.]+$/u.test(hostname) || Boolean(url.port))) return null;
        // URL 会规范化点路径、默认端口及国际域名；拒绝空端口和非十进制端口等歧义输入。
        const authority = rest.split('/')[0];
        if (authority.endsWith(':') || authority.startsWith('-')) return null;
        const host = hostname + (url.port ? `:${url.port}` : '');
        const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/u, '');
        const site = `${wildcard ? '*.' : ''}${host}${path ? `${path}/` : ''}`;
        return {host, wildcard, path, site};
    } catch {
        return null;
    }
}

/** 返回用于配置展示与匹配的规范作用域；裸域名覆盖该精确主机的全部路径。 */
export function normalizeSectionRuleSite(value: unknown): string | null {
    return parseRuleSite(value)?.site ?? null;
}

/** 选择器只接受有限的定位语法；完整 CSS 语法再由浏览器查询安全拒绝。 */
export function isValidSectionSelector(value: unknown): value is string {
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_SECTION_SELECTOR_LENGTH) return false;
    // 不允许无界通配、选择器列表、关系伪类、兄弟扫描和页面根节点；nth-of-type 是唯一后备定位伪类。
    if (/[\u0000-\u001f\u007f]/u.test(value) || /(?:^|[\s>])(?:html|body|head)(?=[\s>#.[:]|$)/iu.test(value)) return false;
    const withoutAttributes = value.replace(/\[(?:[\w-]+)~?=(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\]/gu, 'x');
    if (/[,*+~{};\[\]]/u.test(withoutAttributes)) return false;
    const withoutPosition = withoutAttributes.replace(/:nth-of-type\([1-9]\d{0,4}\)/gu, '');
    if (withoutPosition.includes(':') || withoutPosition.includes('(') || withoutPosition.includes(')') || value.split('>').length > 16) return false;
    return !/(?:^|[\s>])(?:script|style|template|iframe|object|embed)(?=[\s>#.[:]|$)/iu.test(value);
}

export function isValidSectionLocatorPath(value: unknown): value is string[] {
    return Array.isArray(value) && value.length > 0 && value.length <= MAX_SECTION_LOCATOR_DEPTH && value.every(isValidSectionSelector);
}

/** 返回首个有问题的字段；设置页据此显示翻译后的字段提示。 */
export function validateSectionTranslationRule(value: unknown): SectionTranslationRuleError {
    if (!record(value) || !identity(value.id)) return 'id';
    if (typeof value.enabled !== 'boolean') return 'enabled';
    if (!parseRuleSite(value.site)) return 'site';
    if (!Array.isArray(value.selectors) || value.selectors.length === 0 || value.selectors.length > MAX_SECTION_RULE_REGIONS || !value.selectors.every(isValidSectionLocatorPath)) return 'selectors';
    if (value.mode !== 'auto' && value.mode !== 'remind') return 'mode';
    if (value.profileId !== undefined && !identity(value.profileId)) return 'profile';
    return '';
}

/** 保存/导入共用白名单投影，不保留未知请求配置或嵌套凭据。 */
export function normalizeSectionTranslationRules(value: unknown): SectionTranslationRule[] {
    if (!Array.isArray(value)) return [];
    const result: SectionTranslationRule[] = [];
    const ids = new Set<string>();
    for (const raw of value.slice(0, MAX_SECTION_TRANSLATION_RULES * 2)) {
        if (validateSectionTranslationRule(raw) || !record(raw) || ids.has(raw.id as string)) continue;
        const rule = raw as unknown as SectionTranslationRule;
        ids.add(rule.id);
        result.push({id: rule.id, enabled: rule.enabled, site: normalizeSectionRuleSite(rule.site)!,
            selectors: [...new Map(rule.selectors.map(path => {const clean = path.map(selector => selector.trim()); return [JSON.stringify(clean), clean] as const;})).values()],
            mode: rule.mode, ...(rule.profileId ? {profileId: rule.profileId} : {})});
        if (result.length === MAX_SECTION_TRANSLATION_RULES) break;
    }
    return result;
}

/** 通配主机只覆盖真正的子域；路径前缀按段匹配，/docs/ 不会匹配 /docs-old。 */
export function matchesSectionTranslationRule(rule: SectionTranslationRule, href: string | URL): boolean {
    if (!rule.enabled) return false;
    const site = parseRuleSite(rule.site);
    if (!site) return false;
    try {
        const url = href instanceof URL ? href : new URL(href);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
        const host = url.hostname.replace(/\.+$/u, '').toLowerCase() + (url.port ? `:${url.port}` : '');
        const hostMatches = site.wildcard ? host.endsWith(`.${site.host}`) : host === site.host;
        return hostMatches && (!site.path || url.pathname === site.path || url.pathname.startsWith(`${site.path}/`));
    } catch {
        return false;
    }
}

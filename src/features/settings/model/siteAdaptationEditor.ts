/**
 * @file src/features/settings/model/siteAdaptationEditor.ts
 * 文件职责：提供网站适配编辑器的草稿校验、内置规则复制、开关和网址匹配预览。
 * 主要内容：组合有效规则目录、无损可视化表单、导入合并与草稿冲突保护；所有编辑先生成草稿，合法规则才可替换持久配置，预览复用运行时编译器。
 * 模块边界：不读写配置、不访问网络或文件；调用方传入浏览器 document 以校验 CSS 支持。
 */

import {composeSiteAdapters, resolveSiteRule} from '@/src/core/site-adaptation/compiler';
import {parseSiteRulePack, SITE_RULE_LIMITS, validateSelectors} from '@/src/core/site-adaptation/schema';
import type {SiteAdaptationSettings, SiteRule, SiteRuleIssue, SiteRulePack, SiteRulePackParseResult} from '@/src/core/site-adaptation/types';

export const SITE_ADAPTATION_EXAMPLE: SiteRulePack = {
    version: 1,
    rules: [{
        id: 'my-article-site', name: '我的文章网站',
        match: {hosts: ['example.com', '*.example.com'], paths: ['/articles/*']},
        mode: 'focus', content: [{css: ['article h1', 'article p', 'article li'], atomic: true}],
        protect: ['code', 'pre', 'button', '[data-no-translate]'],
        exclude: ['article nav', '.advertisement'],
    }],
};

export function formatSiteRulePack(pack: SiteRulePack): string {
    return JSON.stringify(pack, null, 2);
}

/** 文本边界限制先于 JSON.parse，避免巨大导入文件占用解析器。 */
export function parseSiteAdaptationDraft(text: string, document: Document): SiteRulePackParseResult {
    if (new TextEncoder().encode(text).byteLength > SITE_RULE_LIMITS.bytes) {
        return {ok: false, issues: [{path: '$', message: '规则包不能超过 2 MB'}]};
    }
    let value: unknown;
    try { value = JSON.parse(text); }
    catch {
        return {ok: false, issues: [{path: '$', message: 'JSON 格式无效，请检查引号、逗号和括号。'}]};
    }
    const result = parseSiteRulePack(value);
    if (!result.ok) return result;
    const issues = validateSelectors(result.pack, document);
    return issues.length ? {ok: false, issues} : result;
}

export function searchSiteRules(rules: readonly SiteRule[], query: string): SiteRule[] {
    const term = query.trim().toLocaleLowerCase();
    return rules.filter((rule) => [rule.id, rule.name, ...rule.match.hosts]
        .some((value) => value.toLocaleLowerCase().includes(term)));
}

export interface SiteRuleCatalogItem {
    rule: SiteRule;
    pack: SiteRulePack;
    source: 'builtin' | 'custom';
    overridesBuiltin: boolean;
    enabled: boolean;
}

/** 与运行时一样同 ID 整条覆盖，目录不重复显示已被替换的内置版本。 */
export function listSiteRuleCatalog(builtin: SiteRulePack, settings: SiteAdaptationSettings): SiteRuleCatalogItem[] {
    const builtinIds = new Set(builtin.rules.map(rule => rule.id));
    const disabled = new Set(settings.disabledRuleIds);
    const items = new Map<string, SiteRuleCatalogItem>(builtin.rules.map(rule => [rule.id, {rule, pack: builtin, source: 'builtin' as const,
        overridesBuiltin: false, enabled: !disabled.has(rule.id)}]));
    for (const rule of settings.custom.rules) items.set(rule.id, {rule, pack: settings.custom, source: 'custom',
        overridesBuiltin: builtinIds.has(rule.id), enabled: !disabled.has(rule.id)});
    return [...items.values()];
}

export interface SiteRuleForm {
    id: string; name: string; hosts: string; paths: string; excludePaths: string;
    mode: 'augment' | 'focus'; priority: number;
    content: {css: string; atomic: boolean; resolve: 'self' | 'closest'; splitOnBr: boolean; key?: string}[];
    protect: string; exclude: string; watchIgnore: string;
}
const lines = (text: string): string[] => text.split(/\r?\n/u).map(value => value.trim()).filter(Boolean);

/** 每行一个选择器，不按逗号拆分，避免破坏 :is()、属性值与合法 CSS 组合。 */
export function createSiteRuleForm(rule?: SiteRule): SiteRuleForm {
    return {
        id: rule?.id ?? '', name: rule?.name ?? '', hosts: rule?.match.hosts.join('\n') ?? '',
        paths: rule?.match.paths?.join('\n') ?? '', excludePaths: rule?.match.excludePaths?.join('\n') ?? '',
        mode: rule?.mode ?? 'augment', priority: rule?.priority ?? 0,
        content: (rule?.content ?? []).map(item => ({css: item.css.join('\n'), atomic: item.atomic !== false,
            resolve: item.resolve ?? 'self', splitOnBr: item.splitOnBr === true, key: item.key})),
        protect: rule?.protect?.join('\n') ?? '', exclude: rule?.exclude?.join('\n') ?? '', watchIgnore: rule?.watchIgnore?.join('\n') ?? '',
    };
}

/** 表单编辑保留未暴露的高级属性；模板在编辑前展开，不丢失 omit/literal/allScopes 等行为。 */
export function buildSiteRuleFromForm(form: SiteRuleForm, original?: SiteRule): SiteRule {
    const rule: SiteRule = {...original, id: form.id.trim(), name: form.name.trim(), mode: form.mode,
        priority: form.priority, match: {hosts: lines(form.hosts)}};
    delete rule.profile;
    for (const key of ['paths', 'excludePaths'] as const) {
        const value = lines(form[key]);
        if (value.length) rule.match[key] = value;
    }
    const content = form.content.map(item => {
        const result = {...item, css: lines(item.css)};
        if (result.key?.trim()) result.key = result.key.trim();
        else delete result.key;
        return result;
    });
    if (content.length) rule.content = content;
    else delete rule.content;
    for (const key of ['protect', 'exclude', 'watchIgnore'] as const) {
        const value = lines(form[key]);
        if (value.length) rule[key] = value;
        else delete rule[key];
    }
    return rule;
}

/** 保存单条可视化规则进入现有 JSON 草稿；标识碰撞不静默覆盖。 */
export function upsertSiteRuleDraft(draft: string, rule: SiteRule, originalId: string | null, document: Document): SiteRuleDraftUpdate & SiteRulePackParseResult {
    const parsed = parseSiteAdaptationDraft(draft, document);
    if (!parsed.ok) return parsed;
    if (parsed.pack.rules.some(item => item.id === rule.id && item.id !== originalId)) {
        return {ok: false, issues: [{path: '$.id', message: '规则标识已存在，请使用其他标识。'}]};
    }
    const index = parsed.pack.rules.findIndex(item => item.id === originalId);
    if (index < 0) parsed.pack.rules.push(rule);
    else parsed.pack.rules[index] = rule;
    const next = formatSiteRulePack(parsed.pack);
    const result = parseSiteAdaptationDraft(next, document);
    return result.ok ? {ok: true, draft: formatSiteRulePack(result.pack), pack: result.pack} : result;
}

/** 安全合并导入包，模板重名且内容不同则拒绝，避免改变既有规则的隐式引用。 */
export function mergeSiteRuleDraft(draft: string, incoming: SiteRulePack, document: Document): SiteRuleDraftUpdate {
    const parsed = parseSiteAdaptationDraft(draft, document);
    if (!parsed.ok) return parsed;
    const profiles = {...parsed.pack.profiles};
    for (const [id, profile] of Object.entries(incoming.profiles ?? {})) {
        if (Object.hasOwn(profiles, id) && JSON.stringify(profiles[id]) !== JSON.stringify(profile)) {
            return {ok: false, issues: [{path: `$.profiles.${id}`, message: '导入模板与现有模板冲突，请重命名后再导入。'}]};
        }
        profiles[id] = profile;
    }
    const rules = new Map(parsed.pack.rules.map(rule => [rule.id, rule]));
    incoming.rules.forEach(rule => rules.set(rule.id, rule));
    const result: SiteRulePack = {version: 1, rules: [...rules.values()]};
    if (Object.keys(profiles).length) result.profiles = profiles;
    const text = formatSiteRulePack(result);
    const validated = parseSiteAdaptationDraft(text, document);
    return validated.ok ? {ok: true, draft: text} : validated;
}

/** 只更改目标开关，保留已保存的自定义包及其他禁用项。 */
export function setSiteRuleEnabled(
    settings: SiteAdaptationSettings, id: string, enabled: boolean,
): SiteAdaptationSettings {
    const disabled = new Set(settings.disabledRuleIds);
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    return {...settings, disabledRuleIds: [...disabled]};
}

/** 草稿有未保存修改时保留用户文本，外部存储更新不能覆盖正在编辑的内容。 */
export function reconcileSiteRuleDraft(
    draft: string, previous: SiteRulePack, incoming: SiteRulePack, preserveDraft = false,
): string {
    if (preserveDraft) return draft;
    return draft === formatSiteRulePack(previous) ? formatSiteRulePack(incoming) : draft;
}

/** 后台确认只完成本次提交的文本，不消费等待期间新输入的草稿及撤销记录。 */
export function completeSiteRuleDraftSave(draft: string, submitted: string, pack: SiteRulePack): {
    draft: string; clearUndo: boolean;
} {
    return draft === submitted
        ? {draft: formatSiteRulePack(pack), clearUndo: true}
        : {draft, clearUndo: false};
}

/** 显式等待持久化端口，阻止重复提交，错误留给 UI 提示而不是假报成功。 */
export function createSiteAdaptationCommitter(persist: (settings: SiteAdaptationSettings) => Promise<void>): {
    commit(settings: SiteAdaptationSettings): Promise<'saved' | 'failed' | 'busy'>;
} {
    let pending = false;
    return {
        async commit(settings) {
            if (pending) return 'busy';
            pending = true;
            try {
                await persist(JSON.parse(JSON.stringify(settings)) as SiteAdaptationSettings);
            } catch {
                pending = false;
                return 'failed';
            }
            pending = false;
            return 'saved';
        },
    };
}

interface SiteRuleDraftImportTicket {
    sequence: number;
    draft: string;
}

/** 文件读取只能替换发起时的草稿；后发导入及用户新输入均优先于迟到结果。 */
export function createSiteRuleDraftImportGuard(): {
    begin(draft: string): SiteRuleDraftImportTicket;
    check(ticket: SiteRuleDraftImportTicket, draft: string): 'current' | 'superseded' | 'edited';
} {
    let sequence = 0;
    return {
        begin(draft) { return {sequence: ++sequence, draft}; },
        check(ticket, draft) {
            if (ticket.sequence !== sequence) return 'superseded';
            return ticket.draft === draft ? 'current' : 'edited';
        },
    };
}

export type SiteRuleDraftUpdate = {ok: true; draft: string} | {ok: false; issues: SiteRuleIssue[]};

/** 同 ID 替换单条草稿，其他规则及模板保持不变，展开模板后不依赖内置包。 */
export function copySiteRuleToDraft(
    draft: string, source: SiteRulePack, rule: SiteRule, document: Document,
): SiteRuleDraftUpdate {
    const parsed = parseSiteAdaptationDraft(draft, document);
    if (!parsed.ok) return parsed;
    const standalone = resolveSiteRule(source, rule);
    const index = parsed.pack.rules.findIndex((item) => item.id === rule.id);
    if (index < 0) parsed.pack.rules.push(standalone);
    else parsed.pack.rules[index] = standalone;
    const nextDraft = formatSiteRulePack(parsed.pack);
    const validation = parseSiteAdaptationDraft(nextDraft, document);
    return validation.ok ? {ok: true, draft: nextDraft} : validation;
}

export interface SiteRulePreviewItem {
    rule: SiteRule;
    source: 'builtin' | 'custom';
    enabled: boolean;
    applicable: boolean;
}
export type SiteRulePreview = {ok: true; url: string; rules: SiteRulePreviewItem[]} | {ok: false};

/** 只解析网址，不打开或请求该网站。停用规则仍显示，以解释未生效原因。 */
export function previewSiteRules(
    input: string, builtin: SiteRulePack, settings: SiteAdaptationSettings, scope: 'content' | 'all' = 'content',
): SiteRulePreview {
    let url: URL;
    try { url = new URL(input.trim()); }
    catch { return {ok: false}; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return {ok: false};
    const ruleMap = new Map(builtin.rules.map((rule) => [rule.id, {rule, source: 'builtin' as const}]));
    const customRules = new Map(settings.custom.rules.map((rule) => [rule.id, rule]));
    const adapters = composeSiteAdapters(builtin, {...settings, enabled: true, disabledRuleIds: []});
    const rules = adapters.filter((adapter) => adapter.matches(url))
        .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
        .map((adapter): SiteRulePreviewItem => {
            const custom = customRules.get(adapter.id);
            const selected = custom ? {rule: custom, source: 'custom' as const} : ruleMap.get(adapter.id)!;
            const applicable = scope !== 'all' || selected.rule.allScopes === true;
            return {...selected, applicable, enabled: applicable && settings.enabled && !settings.disabledRuleIds.includes(adapter.id)};
        });
    return {ok: true, url: url.href, rules};
}

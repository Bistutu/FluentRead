/**
 * @file src/core/personal-corrections/matching.ts
 * 文件职责：按明确范围、语言和语境查找个人校订，不让相似句自动替换。
 * 主要内容：材料地址只保留 SHA-256 摘要，精确原句保留大小写和数字；冲突译法要求审阅，近似匹配限制候选数与计算量，同一查询的分词集合只计算一次。
 * 模块边界：纯算法只消费传入状态，不读浏览器或写公共翻译缓存。
 */
import {sha256Hex} from '@/src/shared/function/sha256';
import {PersonalCorrectionError, validateCorrectionQuery, type PersonalCorrectionLookup, type PersonalCorrectionState, type CorrectionQuery} from './model';
export function createMaterialId(address: string): string {
    let url: URL;
    try {url = new URL(address);} catch {throw new PersonalCorrectionError('材料地址无效');}
    if (!['https:', 'http:', 'file:'].includes(url.protocol)) throw new PersonalCorrectionError('材料地址无效');
    url.username = ''; url.password = '';
    return `material-${sha256Hex(url.href)}`;
}
function tokens(value: string): Set<string> {return new Set(value.slice(0, 2000).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);}
function similarity(left: string, b: ReadonlySet<string>): number {
    if (!b.size) return 0;
    const a = tokens(left);
    let overlap = 0; for (const token of a) if (b.has(token)) overlap++;
    return a.size ? 2 * overlap / (a.size + b.size) : 0;
}
export function lookupPersonalCorrection(state: PersonalCorrectionState, value: CorrectionQuery): PersonalCorrectionLookup {
    const query = validateCorrectionQuery(value);
    const projectId = state.memberships.find(membership => membership.materialId === query.materialId)?.projectId;
    const eligible = state.entries.filter(entry => entry.sourceLanguage === query.sourceLanguage && entry.targetLanguage === query.targetLanguage
        && entry.context === query.context && (entry.scope.kind === 'material' ? entry.scope.id === query.materialId : entry.scope.id === projectId));
    const exact = eligible.filter(entry => entry.source === query.source);
    const conflicts = new Set(exact.map(entry => entry.translation)).size > 1 ? exact : [];
    let queryTokens: ReadonlySet<string> | undefined;
    const suggestions = eligible.filter(entry => entry.source !== query.source).map(entry => ({entry, score: similarity(entry.source, queryTokens ??= tokens(query.source))}))
        .filter(candidate => candidate.score >= 0.68).sort((a, b) => b.score - a.score || b.entry.revision - a.entry.revision).slice(0, 5).map(candidate => candidate.entry);
    const selected = conflicts.length ? undefined : exact.find(entry => entry.scope.kind === 'material') || exact[0];
    return {exact: selected, suggestions, conflicts};
}

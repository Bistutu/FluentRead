/**
 * @file src/core/personal-corrections/model.ts
 * 文件职责：定义用户主动确认的校订记忆及严格输入边界。
 * 主要内容：限定原文、译文、语言、语境、材料摘要和轻量项目；只复制白名单字段，拒绝截断和非法版本。
 * 模块边界：不读取网页、配置或存储；个人记忆独立于术语库、阅读历史和供应商缓存。
 */
export const PERSONAL_CORRECTION_LIMIT = 1000;
export const PERSONAL_CORRECTION_PROJECT_LIMIT = 100;
export const PERSONAL_CORRECTION_UNDO_LIMIT = 30;
export const PERSONAL_CORRECTION_BYTES_LIMIT = 4 * 1024 * 1024;
export interface CorrectionQuery {
    source: string;
    sourceLanguage: string;
    targetLanguage: string;
    context: string;
    materialId: string;
}
export interface PersonalCorrectionScope {kind: 'material' | 'project'; id: string; label: string}
export interface PersonalCorrectionProject {id: string; label: string}
export interface PersonalCorrectionRecord {
    id: string;
    scope: PersonalCorrectionScope;
    source: string;
    translation: string;
    sourceLanguage: string;
    targetLanguage: string;
    context: string;
    revision: number;
}
export type PersonalCorrectionInput = Omit<PersonalCorrectionRecord, 'id' | 'revision'> & {id?: string; expectedRevision?: number};
export interface PersonalCorrectionState {
    version: 1;
    revision: number;
    entries: PersonalCorrectionRecord[];
    projects: PersonalCorrectionProject[];
    memberships: Array<{materialId: string; projectId: string}>;
}
export interface PersonalCorrectionLookup {exact?: PersonalCorrectionRecord; suggestions: PersonalCorrectionRecord[]; conflicts: PersonalCorrectionRecord[]}
export interface PersonalCorrectionSaveResult {record: PersonalCorrectionRecord; undoToken: string}
export class PersonalCorrectionError extends Error {
    constructor(message: string) {super(message); this.name = 'PersonalCorrectionError';}
}
export function correctionObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PersonalCorrectionError('校订内容无效');
    return value as Record<string, unknown>;
}
export function correctionText(value: unknown, label: string, max: number, allowEmpty = false): string {
    if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
        throw new PersonalCorrectionError(`${label}须为${allowEmpty ? '不超过' : '非空且不超过'} ${max} 个字符`);
    }
    return value;
}
export function correctionId(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) {
        throw new PersonalCorrectionError('校订标识无效');
    }
    return value.toLowerCase();
}
export function correctionMaterialId(value: unknown): string {
    if (typeof value !== 'string' || !/^material-[a-f0-9]{64}$/.test(value)) throw new PersonalCorrectionError('材料标识无效');
    return value;
}
export function correctionRevision(value: unknown, allowZero = false): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new PersonalCorrectionError('校订版本无效');
    return value;
}
function language(value: unknown): string {
    if (typeof value !== 'string' || !/^(?:auto|[a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})*)$/.test(value)) throw new PersonalCorrectionError('校订语言无效');
    return value;
}
export function validateCorrectionQuery(value: unknown): CorrectionQuery {
    const input = correctionObject(value);
    return {source: correctionText(input.source, '原文', 20000), sourceLanguage: language(input.sourceLanguage), targetLanguage: language(input.targetLanguage),
        context: correctionText(input.context, '语境', 4000, true), materialId: correctionMaterialId(input.materialId)};
}
export function validateCorrectionScope(value: unknown): PersonalCorrectionScope {
    const scope = correctionObject(value);
    if (scope.kind !== 'material' && scope.kind !== 'project') throw new PersonalCorrectionError('校订范围无效');
    return {kind: scope.kind, id: scope.kind === 'material' ? correctionMaterialId(scope.id) : correctionId(scope.id), label: correctionText(scope.label, '范围名称', 80)};
}
export function validateCorrectionInput(value: unknown): PersonalCorrectionInput {
    const input = correctionObject(value);
    const valid: PersonalCorrectionInput = {scope: validateCorrectionScope(input.scope), source: correctionText(input.source, '原文', 20000),
        translation: correctionText(input.translation, '译文', 20000), sourceLanguage: language(input.sourceLanguage), targetLanguage: language(input.targetLanguage),
        context: correctionText(input.context, '语境', 4000, true)};
    if (input.id !== undefined) {valid.id = correctionId(input.id); valid.expectedRevision = correctionRevision(input.expectedRevision);}
    else if (input.expectedRevision !== undefined) throw new PersonalCorrectionError('新校订不应指定旧版本');
    return valid;
}
export function validateCorrectionRecord(value: unknown): PersonalCorrectionRecord {
    const raw = correctionObject(value);
    const {expectedRevision: _expected, ...input} = validateCorrectionInput({...raw, expectedRevision: raw.revision});
    return {...input, id: correctionId(raw.id), revision: correctionRevision(raw.revision)};
}
export function emptyCorrectionState(): PersonalCorrectionState {return {version: 1, revision: 0, entries: [], projects: [], memberships: []};}
export function validateCorrectionState(value: unknown): PersonalCorrectionState {
    const raw = correctionObject(value);
    if (raw.version !== 1 || !Array.isArray(raw.entries) || raw.entries.length > PERSONAL_CORRECTION_LIMIT
        || !Array.isArray(raw.projects) || raw.projects.length > PERSONAL_CORRECTION_PROJECT_LIMIT
        || !Array.isArray(raw.memberships) || raw.memberships.length > PERSONAL_CORRECTION_LIMIT) throw new PersonalCorrectionError('校订存储格式无效');
    const state: PersonalCorrectionState = {version: 1, revision: correctionRevision(raw.revision, true), entries: raw.entries.map(validateCorrectionRecord),
        projects: raw.projects.map(value => {const project = correctionObject(value); return {id: correctionId(project.id), label: correctionText(project.label, '项目名称', 80)};}),
        memberships: raw.memberships.map(value => {const membership = correctionObject(value); return {materialId: correctionMaterialId(membership.materialId), projectId: correctionId(membership.projectId)};})};
    const projects = new Set(state.projects.map(project => project.id));
    if (new Set(state.entries.map(entry => entry.id)).size !== state.entries.length || projects.size !== state.projects.length
        || new Set(state.memberships.map(membership => membership.materialId)).size !== state.memberships.length
        || state.memberships.some(membership => !projects.has(membership.projectId))
        || state.entries.some(entry => entry.revision > state.revision || (entry.scope.kind === 'project' && !projects.has(entry.scope.id)))) {
        throw new PersonalCorrectionError('校订存储关系无效');
    }
    return state;
}

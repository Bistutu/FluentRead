/**
 * @file src/services/personal-corrections/service.ts
 * 文件职责：编排用户确认的个人校订、显式项目范围和可安全撤销的存储变更。
 * 主要内容：串行化后台操作、原子竞争重试、记录版本比较、重复确认幂等、冲突保留及有限持久撤销。
 * 模块边界：只消费纯领域和可注入仓库；不读取网页、不调用 provider、不混入公共翻译缓存。
 */
import {correctionId, correctionMaterialId, correctionRevision, correctionText, lookupPersonalCorrection, PERSONAL_CORRECTION_LIMIT,
    PERSONAL_CORRECTION_PROJECT_LIMIT, PERSONAL_CORRECTION_UNDO_LIMIT, PersonalCorrectionError, validateCorrectionInput,
    type CorrectionQuery, type PersonalCorrectionInput, type PersonalCorrectionRecord, type PersonalCorrectionSaveResult} from '@/src/core/personal-corrections/public';
import type {PersonalCorrectionSnapshot, PersonalCorrectionStore} from './store';
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export class PersonalCorrectionService {
    private queue: Promise<unknown> = Promise.resolve();
    constructor(private readonly store: PersonalCorrectionStore, private readonly id: () => string = () => crypto.randomUUID()) {}
    private mutate<T>(operation: (snapshot: PersonalCorrectionSnapshot) => {changed: boolean; result: T}): Promise<T> {
        const result = this.queue.then(async () => {
            for (let attempt = 0; attempt < 4; attempt++) {
                const {value, expected} = await this.store.read();
                const change = operation(value);
                if (!change.changed || await this.store.write(expected, value)) return change.result;
            }
            throw new PersonalCorrectionError('校订正在其他窗口变更，请重新操作');
        });
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }
    private nextRevision(snapshot: PersonalCorrectionSnapshot): number {
        snapshot.state.revision = correctionRevision(snapshot.state.revision + 1);
        return snapshot.state.revision;
    }
    private addUndo(snapshot: PersonalCorrectionSnapshot, before: PersonalCorrectionRecord | null, after: PersonalCorrectionRecord | null): string {
        const token = correctionId(this.id());
        if (snapshot.undo.some(entry => entry.token === token)) throw new PersonalCorrectionError('撤销标识冲突，请重新操作');
        snapshot.undo.push({token, id: (after || before)!.id, before, after});
        snapshot.undo = snapshot.undo.slice(-PERSONAL_CORRECTION_UNDO_LIMIT);
        return token;
    }
    async lookup(query: CorrectionQuery) {return lookupPersonalCorrection((await this.store.read()).value.state, query);}
    async list() {return (await this.store.read()).value.state;}
    async save(value: PersonalCorrectionInput): Promise<PersonalCorrectionSaveResult> {
        const input = validateCorrectionInput(value);
        return this.mutate(snapshot => {
            const {state} = snapshot;
            const existing = input.id ? state.entries.find(entry => entry.id === input.id) : undefined;
            if (input.id && (!existing || existing.revision !== input.expectedRevision)) throw new PersonalCorrectionError('校订已变更或被删除，请重新打开');
            const project = input.scope.kind === 'project' ? state.projects.find(project => project.id === input.scope.id) : undefined;
            if (input.scope.kind === 'project' && !project) throw new PersonalCorrectionError('校订项目不存在');
            const body = {scope: project ? {...input.scope, label: project.label} : input.scope, source: input.source, translation: input.translation, sourceLanguage: input.sourceLanguage, targetLanguage: input.targetLanguage, context: input.context};
            const identity = {...body, scope: {kind: body.scope.kind, id: body.scope.id}};
            const duplicate = state.entries.find(entry => same({scope: {kind: entry.scope.kind, id: entry.scope.id}, source: entry.source, translation: entry.translation, sourceLanguage: entry.sourceLanguage, targetLanguage: entry.targetLanguage, context: entry.context}, identity));
            if (duplicate) {
                if (!input.id || duplicate.id === input.id) return {changed: false, result: {record: duplicate, undoToken: ''}};
                throw new PersonalCorrectionError('已有相同的校订，请保留其中一条');
            }
            if (!existing && state.entries.length >= PERSONAL_CORRECTION_LIMIT) throw new PersonalCorrectionError(`最多保存 ${PERSONAL_CORRECTION_LIMIT} 条校订`);
            const id = input.id || correctionId(this.id());
            if (!existing && state.entries.some(entry => entry.id === id)) throw new PersonalCorrectionError('校订标识冲突，请重新操作');
            const record: PersonalCorrectionRecord = {...body, id, revision: this.nextRevision(snapshot)};
            state.entries = [...state.entries.filter(entry => entry.id !== id), record];
            const undoToken = this.addUndo(snapshot, existing || null, record);
            return {changed: true, result: {record, undoToken}};
        });
    }
    async remove(value: string, expectedRevision: number): Promise<{undoToken: string}> {
        const id = correctionId(value); const revision = correctionRevision(expectedRevision);
        return this.mutate(snapshot => {
            const record = snapshot.state.entries.find(entry => entry.id === id);
            if (!record || record.revision !== revision) throw new PersonalCorrectionError('校订已变更或被删除，请重新打开');
            snapshot.state.entries = snapshot.state.entries.filter(entry => entry.id !== id);
            this.nextRevision(snapshot);
            return {changed: true, result: {undoToken: this.addUndo(snapshot, record, null)}};
        });
    }
    async undo(value: string): Promise<void> {
        const token = correctionId(value);
        return this.mutate(snapshot => {
            const operation = snapshot.undo.find(entry => entry.token === token);
            if (!operation) throw new PersonalCorrectionError('这次撤销已失效');
            const latest = snapshot.undo.filter(entry => entry.id === operation.id).at(-1);
            const current = snapshot.state.entries.find(entry => entry.id === operation.id) || null;
            if (latest !== operation || !same(current, operation.after)) throw new PersonalCorrectionError('校订已有后续变更，无法撤销旧操作');
            if (operation.before && !current && snapshot.state.entries.length >= PERSONAL_CORRECTION_LIMIT) throw new PersonalCorrectionError('校订容量已满，无法恢复');
            const revision = this.nextRevision(snapshot);
            snapshot.state.entries = snapshot.state.entries.filter(entry => entry.id !== operation.id);
            if (operation.before) snapshot.state.entries.push({...operation.before, revision});
            snapshot.undo = snapshot.undo.filter(entry => entry.id !== operation.id);
            return {changed: true, result: undefined};
        });
    }
    async createProject(value: string) {
        const label = correctionText(value, '项目名称', 80).trim();
        return this.mutate(snapshot => {
            const existing = snapshot.state.projects.find(project => project.label === label);
            if (existing) return {changed: false, result: existing};
            if (snapshot.state.projects.length >= PERSONAL_CORRECTION_PROJECT_LIMIT) throw new PersonalCorrectionError(`最多保存 ${PERSONAL_CORRECTION_PROJECT_LIMIT} 个校订项目`);
            const project = {id: correctionId(this.id()), label};
            if (snapshot.state.projects.some(entry => entry.id === project.id)) throw new PersonalCorrectionError('项目标识冲突，请重新操作');
            snapshot.state.projects.push(project); this.nextRevision(snapshot);
            return {changed: true, result: project};
        });
    }
    async selectProject(material: string, selected: string | null): Promise<void> {
        const materialId = correctionMaterialId(material); const projectId = selected === null ? null : correctionId(selected);
        return this.mutate(snapshot => {
            const current = snapshot.state.memberships.find(entry => entry.materialId === materialId)?.projectId || null;
            if (projectId && !snapshot.state.projects.some(entry => entry.id === projectId)) throw new PersonalCorrectionError('校订项目不存在');
            if (current === projectId) return {changed: false, result: undefined};
            if (projectId && !current && snapshot.state.memberships.length >= PERSONAL_CORRECTION_LIMIT) throw new PersonalCorrectionError('项目材料数量已满');
            snapshot.state.memberships = snapshot.state.memberships.filter(entry => entry.materialId !== materialId);
            if (projectId) snapshot.state.memberships.push({materialId, projectId});
            this.nextRevision(snapshot); return {changed: true, result: undefined};
        });
    }
}

/**
 * @file src/services/personal-corrections/store.ts
 * 文件职责：定义后台个人校订仓库端口和有限撤销快照。
 * 主要内容：校订及其前后状态共同提交，最多保留最近 30 次显式操作；撤销不依赖易丢失的 service worker 内存。
 * 模块边界：只有持久化端口合同，不读取配置、浏览器或页面。
 */
import {correctionId, correctionObject, emptyCorrectionState, PERSONAL_CORRECTION_UNDO_LIMIT, PersonalCorrectionError, validateCorrectionRecord, validateCorrectionState,
    type PersonalCorrectionRecord, type PersonalCorrectionState} from '@/src/core/personal-corrections/public';
export interface PersonalCorrectionUndo {token: string; id: string; before: PersonalCorrectionRecord | null; after: PersonalCorrectionRecord | null}
export interface PersonalCorrectionSnapshot {state: PersonalCorrectionState; undo: PersonalCorrectionUndo[]}
export interface PersonalCorrectionStore {
    read(): Promise<{value: PersonalCorrectionSnapshot; expected: unknown}>;
    write(expected: unknown, value: PersonalCorrectionSnapshot): Promise<boolean>;
}
export function emptyCorrectionSnapshot(): PersonalCorrectionSnapshot {return {state: emptyCorrectionState(), undo: []};}
export function validateCorrectionSnapshot(value: unknown): PersonalCorrectionSnapshot {
    const raw = correctionObject(value);
    if (!Array.isArray(raw.undo) || raw.undo.length > PERSONAL_CORRECTION_UNDO_LIMIT) throw new PersonalCorrectionError('校订撤销格式无效');
    const snapshot = {state: validateCorrectionState(raw.state), undo: raw.undo.map(value => {
        const entry = correctionObject(value);
        const id = correctionId(entry.id);
        const before = entry.before === null ? null : validateCorrectionRecord(entry.before);
        const after = entry.after === null ? null : validateCorrectionRecord(entry.after);
        if ((!before && !after) || (before && before.id !== id) || (after && after.id !== id)) throw new PersonalCorrectionError('校订撤销关系无效');
        return {token: correctionId(entry.token), id, before, after};
    })};
    if (new Set(snapshot.undo.map(entry => entry.token)).size !== snapshot.undo.length) throw new PersonalCorrectionError('校订撤销标识重复');
    return snapshot;
}

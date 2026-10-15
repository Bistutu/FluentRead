/**
 * @file src/features/vocabulary/materialCapture.ts
 * 文件职责：在已有收藏、问答和笔记真实写入后，将引用关联到用户选择的材料。
 * 主要内容：捕获持久代次，异步完成后校验操作所有权和隐私状态，材料关联失败不撤销已保存的学习记录。
 * 模块边界：只使用材料消息客户端，不绕过后台来源与隐私检查，不把选区来源送入模型或同步配置。
 */
import {materialCapture, materialGeneration} from './materialClient';
import type {MaterialCaptureInput, MaterialReference} from './materialProtocol';

export type MaterialSelection = Pick<MaterialCaptureInput, 'source' | 'locator'>;
export async function beginMaterialCapture(selection: MaterialSelection | undefined, privateContext: boolean): Promise<{selection: MaterialSelection; generation: number; capturedAt: number} | undefined> {
    if (privateContext || !selection) return;
    const capturedAt = Date.now();
    try {return {selection: JSON.parse(JSON.stringify(selection)) as MaterialSelection, generation: await materialGeneration(), capturedAt};} catch {return;}
}
export async function completeMaterialCapture(operation: Awaited<ReturnType<typeof beginMaterialCapture>>, reference: MaterialReference, isCurrent: () => boolean = () => true): Promise<boolean> {
    if (!operation || !isCurrent()) return false;
    try {const record = await materialCapture({...operation.selection, reference, generation: operation.generation, capturedAt: operation.capturedAt});
        if (isCurrent() && typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('fluentread-material-captured', {detail: record.id}));
        return true;} catch {return false;}
}

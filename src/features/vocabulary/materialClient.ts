/**
 * @file src/features/vocabulary/materialClient.ts
 * 文件职责：提供界面与采集器共用的类型化学习材料后台客户端。
 * 主要内容：列表、采集、位置更新、主题、归档、恢复、引用删除和清空；在发送消息前拒绝无痕扩展页面，错误只携带公开协议码。
 * 模块边界：客户端不直接访问 IndexedDB 或配置同步；生命周期与迟到结果由调用者 guard 和持久化世代共同约束。
 */
import browser from 'webextension-polyfill';
import {MATERIAL_MESSAGE, type MaterialOperationGuard, type MaterialBackup, type MaterialImportResult, type MaterialCaptureInput, type MaterialListOptions, type MaterialPatch, type MaterialRecord, type MaterialReference, type MaterialRequest, type MaterialResponse} from './materialProtocol';
export class MaterialClientError extends Error {
    constructor(readonly code: string, message: string) {super(message); this.name = 'MaterialClientError';}
}
async function request<T>(message: MaterialRequest): Promise<T> {
    if (browser.extension?.inIncognitoContext === true) throw new MaterialClientError('privacy-disabled', '无痕窗口不读取或保存学习材料');
    const response = await browser.runtime.sendMessage(message) as MaterialResponse<T>;
    if (!response || response.success !== true) throw new MaterialClientError(response?.success === false ? response.error.code : 'storage-error', response?.success === false ? response.error.message : '本地学习材料暂时不可用');
    return response.data;
}
export const materialList = (options?: MaterialListOptions) => request<MaterialRecord[]>({type: MATERIAL_MESSAGE, action: 'list', options});
export const materialGeneration = () => request<number>({type: MATERIAL_MESSAGE, action: 'generation'});
export const materialGet = (id: string) => request<MaterialRecord | null>({type: MATERIAL_MESSAGE, action: 'get', id});
export const materialResolve = (id: string) => request<MaterialRecord | null>({type: MATERIAL_MESSAGE, action: 'resolve', id});
export const materialCapture = (input: MaterialCaptureInput) => request<MaterialRecord>({type: MATERIAL_MESSAGE, action: 'capture', input});
export const materialUpdate = (id: string, patch: MaterialPatch) => request<MaterialRecord>({type: MATERIAL_MESSAGE, action: 'update', id, patch});
export const materialRemoveReference = (id: string, kind: MaterialReference['kind'], referenceId: string) => request<MaterialRecord>({type: MATERIAL_MESSAGE, action: 'removeReference', id, kind, referenceId});
export const materialArchive = (id: string) => request<MaterialRecord>({type: MATERIAL_MESSAGE, action: 'archive', id});
export const materialRestore = (id: string) => request<MaterialRecord>({type: MATERIAL_MESSAGE, action: 'restore', id});
export const materialClear = () => request<boolean>({type: MATERIAL_MESSAGE, action: 'clear'});

/** 主动下载的私密本地备份包含来源、原文与笔记，不属于配置同步。 */
export const materialExport = () => request<MaterialBackup>({type: MATERIAL_MESSAGE, action: 'exportData'});
export const materialImport = (data: unknown, guard?: MaterialOperationGuard) => request<MaterialImportResult>({type: MATERIAL_MESSAGE, action: 'importData', data, guard});

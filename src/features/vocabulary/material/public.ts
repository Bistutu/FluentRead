/**
 * @file src/features/vocabulary/material/public.ts
 * 文件职责：公开学习材料的来源采集和继续阅读合同，供划词、阅读助手、视频与文档组合根调用。
 * 主要内容：重导出来源快照、材料引用、显式采集生命周期、原段落恢复与继续阅读链接。
 * 模块边界：不加载学习中心 UI；客户端仅在用户主动保存或继续阅读时访问后台，来源不会进入模型请求。
 */
export {materialResumeLink, captureMaterialSelection, MATERIAL_RESUME_PARAMETER} from '../materialSource';
export {beginMaterialCapture, completeMaterialCapture} from '../materialCapture';
export type {MaterialSelection, MaterialCaptureInput, MaterialSource, MaterialLocator, MaterialReference, MaterialRecord} from './protocol';
export {materialCapture, materialGeneration, materialGet} from '../materialClient';

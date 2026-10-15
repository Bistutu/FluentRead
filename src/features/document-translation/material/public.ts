/**
 * @file src/features/document-translation/material/public.ts
 * 文件职责：为材料库与文档组合根提供仅含纯定位算法的公共入口。
 * 主要内容：导出版本化文件原文引用、预算验证、采集和解析后定位，不加载文档阅读器、解析器或翻译服务。
 * 模块边界：跨 feature 的材料持久化只依赖本入口；原文保留在本地，不启动任何浏览器或文件操作。
 */
export {createDocumentMaterialReference, resolveDocumentMaterialReference, normalizeDocumentMaterialReference, DOCUMENT_MATERIAL_REFERENCE_LIMITS} from '../core/materialLocator';
export type {DocumentMaterialReference, DocumentSourceLocator} from '../core/materialLocator';

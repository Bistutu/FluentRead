/**
 * @file src/features/vocabulary/material/protocol.ts
 * 文件职责：公开材料的可序列化类型，让阅读选区无需导入浏览器运行时。
 * 主要内容：公开文章、文档和视频的来源、定位、学习引用和本地材料快照合同，供各采集入口描述同一份材料。
 * 模块边界：仅类型，无浏览器、DOM、Vue 或存储副作用。
 */
import type {MaterialCaptureInput} from '../materialProtocol';
export type MaterialSelection = Pick<MaterialCaptureInput, 'source' | 'locator'>;
export type {MaterialCaptureInput, MaterialSource, MaterialLocator, MaterialReference, MaterialRecord} from '../materialProtocol';

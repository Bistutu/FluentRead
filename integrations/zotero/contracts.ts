/**
 * @file integrations/zotero/contracts.ts
 * 文件职责：定义 Zotero 原生端口、任务快照和文档引擎的交接契约。
 * 主要内容：以附件身份与内容摘要约束恢复和写回；任务不包含服务密钥，凭据只由设置端口提供。
 * 模块边界：不依赖 Zotero 全局、浏览器扩展或 UI，供原生适配、任务调度与测试共同使用。
 */
import type {ParsedDocument} from '../../src/features/document-translation/core/document';
import type {ZoteroFontCacheOptions} from './fontCache';

export interface TranslationSettings {
    sourceLanguage: string;
    targetLanguage: string;
    service: 'microsoft' | 'compatible';
    endpoint: string;
    model: string;
    apiKey: string;
    glossary: string;
    output: 'bilingual' | 'translated';
    autoOpen: boolean;
}
export type TaskSettings = Omit<TranslationSettings, 'apiKey' | 'autoOpen'>;
export type TaskState = 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'canceled';
export interface TranslationTask {
    id: string;
    attachmentID: number;
    libraryID: number;
    attachmentKey: string;
    title: string;
    state: TaskState;
    phase: string;
    createdAt: number;
    updatedAt: number;
    settings: TaskSettings;
    fingerprint?: string;
    translations: string[];
    total: number;
    completed: number;
    outputAttachmentID?: number;
    noteID?: number;
    error?: string;
}
export interface AttachmentSource {
    id: number;
    libraryID: number;
    key: string;
    title: string;
    fileName: string;
    bytes: Uint8Array;
    fingerprint: string;
    sourceURI?: string;
}
export interface ZoteroHost {
    loadSettings(): Promise<TranslationSettings>;
    saveSettings(settings: TranslationSettings): Promise<void>;
    loadTasks(): Promise<unknown>;
    saveTasks(tasks: readonly TranslationTask[]): Promise<void>;
    fontCache?: ZoteroFontCacheOptions;
    selectedAttachments(): Promise<Array<Pick<AttachmentSource, 'id' | 'libraryID' | 'key' | 'title'>>>;
    readAttachment(id: number, signal: AbortSignal, purpose?: 'pdf' | 'selection' | 'note'): Promise<AttachmentSource>;
    saveOutput(source: AttachmentSource, task: TranslationTask, bytes: Uint8Array, signal: AbortSignal): Promise<number>;
    saveNote(source: AttachmentSource, task: TranslationTask, html: string, signal: AbortSignal): Promise<number>;
    openAttachment(id: number): Promise<void>;
    openSource(id: number, page?: number): Promise<void>;
    notify(message: string): void;
}
export interface EngineProgress {phase: string; completed?: number; total?: number}
export interface ZoteroEngine {
    parse(source: AttachmentSource, signal: AbortSignal, progress: (value: EngineProgress) => void): Promise<ParsedDocument>;
    translate(document: ParsedDocument, settings: TranslationSettings, signal: AbortSignal,
        initial: readonly string[], segment: (id: number, text: string) => void,
        progress: (value: EngineProgress) => void): Promise<string[]>;
    export(document: ParsedDocument, translations: readonly string[], settings: TranslationSettings,
        signal: AbortSignal, progress: (value: EngineProgress) => void): Promise<Uint8Array>;
    selection(text: string, settings: TranslationSettings, signal: AbortSignal): Promise<string>;
    release(document: ParsedDocument): void;
}

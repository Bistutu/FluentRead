/**
 * @file integrations/zotero/queue.ts
 * 文件职责：调度 Zotero 文献翻译的持久队列，按附件内容校验续译并保留已完成片段。
 * 主要内容：串行处理文档以限制 PDF 内存；暂停、取消、重试和卸载均切断迟到提交；输出和笔记通过宿主幂等写回。
 * 模块边界：只依赖显式宿主与引擎端口，不访问 Zotero 全局、DOM 或浏览器扩展配置。
 */
import type {ParsedDocument} from '../../src/features/document-translation/core/document';
import type {AttachmentSource, TaskSettings, TranslationSettings, TranslationTask, ZoteroEngine, ZoteroHost} from './contracts';

export function taskSettings(settings: TranslationSettings): TaskSettings {
    const {apiKey: _key, autoOpen: _open, ...snapshot} = settings;
    return snapshot;
}
function settingsKey(settings: TaskSettings): string {
    return JSON.stringify([settings.sourceLanguage, settings.targetLanguage, settings.service,
        settings.endpoint, settings.model, settings.glossary, settings.output]);
}
function storedTask(value: unknown): value is TranslationTask {
    if (!value || typeof value !== 'object') return false;
    const task = value as TranslationTask;
    return typeof task.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/u.test(task.id)
        && Number.isSafeInteger(task.attachmentID) && task.attachmentID > 0
        && Number.isSafeInteger(task.libraryID) && typeof task.attachmentKey === 'string'
        && typeof task.title === 'string' && Number.isFinite(task.createdAt)
        && Number.isFinite(task.updatedAt) && Array.isArray(task.translations)
        && task.translations.every(text => typeof text === 'string')
        && ['queued', 'running', 'paused', 'failed', 'completed', 'canceled'].includes(task.state)
        && !!task.settings && ['microsoft', 'compatible'].includes(task.settings.service)
        && typeof task.settings.sourceLanguage === 'string' && typeof task.settings.targetLanguage === 'string'
        && typeof task.settings.endpoint === 'string' && typeof task.settings.model === 'string'
        && typeof task.settings.glossary === 'string' && ['bilingual', 'translated'].includes(task.settings.output);
}
export function restoreTasks(stored: unknown): TranslationTask[] {
    if (!Array.isArray(stored)) return [];
    const seen = new Set<string>();
    return stored.filter(storedTask).filter(task => {
        if (seen.has(task.id)) return false;
        seen.add(task.id); return true;
    }).map(task => ({
        ...task,
        // Explicitly reconstruct the snapshot: an older or damaged record must never retain credentials.
        settings: taskSettings({...task.settings, apiKey: '', autoOpen: false}),
        state: task.state === 'running' || task.state === 'queued' ? 'paused' : task.state,
        phase: task.state === 'running' || task.state === 'queued' ? '可继续上次翻译' : String(task.phase || ''),
        completed: task.translations.filter(text => text.trim()).length,
        total: Number.isSafeInteger(task.total) && task.total >= 0 ? task.total : 0,
    }));
}
export function escapeNoteHtml(text: string): string {
    return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
}
export function bilingualNote(document: ParsedDocument, translations: readonly string[], sourceURI?: string): string {
    let page = 1;
    const parts = document.segments.map(segment => {
        const match = segment.contextLabel?.match(/(?:第\s*)?(\d+)\s*(?:页|$)/u);
        if (match) page = Number(match[1]);
        const label = `第 ${page} 页`;
        const link = sourceURI ? `<a href="${escapeNoteHtml(`${sourceURI}?page=${page}`)}">${label}</a>` : label;
        return `<p>${link}</p><blockquote><p>${escapeNoteHtml(segment.source).replace(/\n/gu, '<br/>')}</p></blockquote>`
            + `<p>${escapeNoteHtml(translations[segment.id] || segment.source).replace(/\n/gu, '<br/>')}</p>`;
    });
    return `<div data-schema-version="9"><h1>${escapeNoteHtml(document.fileName)} · 双语笔记</h1>${parts.join('')}</div>`;
}

export class ZoteroTaskQueue {
    readonly tasks: TranslationTask[] = [];
    private listeners = new Set<() => void>();
    private active?: {task: TranslationTask; controller: AbortController};
    private writes: Promise<void> = Promise.resolve();
    private checkpointTimer?: ReturnType<typeof setTimeout>;
    private stopped = false;
    private pumping = false;
    private storageError = false;
    private counter = 0;
    private noteControllers = new Set<AbortController>();

    constructor(private host: ZoteroHost, private engine: ZoteroEngine,
        private getSettings: () => TranslationSettings) {}

    async initialize(): Promise<void> {
        this.tasks.splice(0, this.tasks.length, ...restoreTasks(await this.host.loadTasks()));
        this.emit();
    }
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener); return () => this.listeners.delete(listener);
    }
    private emit(): void {for (const listener of this.listeners) listener();}
    private update(task: TranslationTask, phase?: string): void {
        task.updatedAt = Date.now();
        if (phase) task.phase = phase;
        this.emit();
    }
    private async persist(): Promise<void> {
        clearTimeout(this.checkpointTimer); this.checkpointTimer = undefined;
        const snapshot = JSON.parse(JSON.stringify(this.tasks)) as TranslationTask[];
        const save = this.writes.catch(() => undefined).then(() => this.host.saveTasks(snapshot));
        this.writes = save;
        try {await save; this.storageError = false;}
        catch (error) {
            this.storageError = true;
            this.active?.controller.abort(new Error('无法保存翻译进度，请检查资料目录是否可写'));
            throw error;
        }
    }
    private checkpoint(): void {
        if (this.checkpointTimer || this.stopped) return;
        this.checkpointTimer = setTimeout(() => {
            this.checkpointTimer = undefined;
            void this.persist().catch(() => this.host.notify('无法保存翻译进度，队列已停止。请检查资料目录后继续。'));
        }, 150);
    }
    async enqueue(attachments?: Array<Pick<AttachmentSource, 'id' | 'libraryID' | 'key' | 'title'>>): Promise<number> {
        if (this.stopped) return 0;
        const selected = attachments ?? await this.host.selectedAttachments();
        if (this.stopped) return 0;
        const snapshot = taskSettings(this.getSettings());
        let added = 0;
        for (const source of selected) {
            if (this.tasks.some(task => task.attachmentID === source.id
                && ['queued', 'running', 'paused'].includes(task.state)
                && settingsKey(task.settings) === settingsKey(snapshot))) continue;
            const now = Date.now();
            this.tasks.push({id: `fr-${now.toString(36)}-${(++this.counter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                attachmentID: source.id, libraryID: source.libraryID, attachmentKey: source.key, title: source.title,
                state: 'queued', phase: '等待翻译', createdAt: now, updatedAt: now, settings: {...snapshot},
                translations: [], completed: 0, total: 0});
            added++;
        }
        await this.persist(); this.emit();
        if (added) void this.pump();
        else this.host.notify(selected.length ? '所选文献已在队列中，可继续已有任务' : '请先选择有本地 PDF 附件的文献');
        return added;
    }
    async pause(id: string): Promise<void> {
        const task = this.tasks.find(task => task.id === id);
        if (!task || !['queued', 'running'].includes(task.state)) return;
        task.state = 'paused'; this.update(task, '已暂停，保留已完成译文');
        if (this.active?.task === task) this.active.controller.abort();
        await this.persist();
    }
    async cancel(id: string): Promise<void> {
        const task = this.tasks.find(task => task.id === id);
        if (!task || task.state === 'completed') return;
        task.state = 'canceled'; this.update(task, '已取消');
        if (this.active?.task === task) this.active.controller.abort();
        await this.persist();
    }
    async resume(id: string): Promise<void> {
        if (this.stopped) return;
        const task = this.tasks.find(task => task.id === id);
        if (!task || !['paused', 'failed'].includes(task.state)) return;
        task.state = 'queued'; task.error = undefined; this.update(task, '等待继续');
        await this.persist(); void this.pump();
    }
    async clearFinished(): Promise<void> {
        for (let index = this.tasks.length - 1; index >= 0; index--) {
            if (['completed', 'canceled'].includes(this.tasks[index].state)) this.tasks.splice(index, 1);
        }
        await this.persist(); this.emit();
    }
    private async pump(): Promise<void> {
        if (this.pumping || this.stopped || this.storageError) return;
        this.pumping = true;
        try {
            while (!this.stopped && !this.storageError) {
                const task = this.tasks.find(task => task.state === 'queued');
                if (!task) break;
                await this.run(task);
            }
        } finally {this.pumping = false;}
    }
    private async run(task: TranslationTask): Promise<void> {
        const controller = new AbortController();
        const {signal} = controller;
        this.active = {task, controller};
        const current = () => !this.stopped && !signal.aborted && task.state === 'running';
        let document: ParsedDocument | undefined;
        const settings = {...this.getSettings(), ...task.settings};
        task.state = 'running'; task.error = undefined; this.update(task, '读取本地 PDF');
        try {
            await this.persist(); signal.throwIfAborted();
            // Never send a captured document to a newly configured endpoint with another endpoint's key.
            if (settings.service === 'compatible' && settings.endpoint !== this.getSettings().endpoint) {
                throw new Error('此任务使用的模型服务地址已变更，请恢复原地址或新建任务');
            }
            const source = await this.host.readAttachment(task.attachmentID, signal);
            signal.throwIfAborted();
            if (source.libraryID !== task.libraryID || source.key !== task.attachmentKey) throw new Error('原附件身份已变化，请重新选择文献');
            if (task.fingerprint && task.fingerprint !== source.fingerprint) throw new Error('原 PDF 内容已变化，请新建翻译任务，已有译文不会混入新文件');
            task.fingerprint = source.fingerprint;
            const progress = (value: {phase: string; completed?: number; total?: number}) => {
                if (!current()) return;
                if (value.completed !== undefined && value.total !== undefined) {
                    this.update(task, `${value.phase} · ${value.completed}/${value.total}`);
                } else this.update(task, value.phase);
            };
            document = await this.engine.parse(source, signal, progress);
            signal.throwIfAborted();
            if (!document.segments.length) throw new Error('该 PDF 没有可提取的正文，请先为扫描件添加 OCR 文字层');
            task.total = document.segments.length;
            // Parallel batches may finish out of order. Dense strings survive JSON checkpoints without null holes.
            task.translations = Array.from({length: task.total}, (_, index) => task.translations[index] || '');
            const translations = await this.engine.translate(document, settings, signal, [...task.translations],
                (id, text) => {
                    if (!current()) return;
                    task.translations[id] = text;
                    task.completed = task.translations.filter(text => text?.trim()).length;
                    this.update(task); this.checkpoint();
                }, progress);
            signal.throwIfAborted(); task.translations = translations;
            await this.persist(); signal.throwIfAborted();
            const bytes = await this.engine.export(document, translations, settings, signal, progress);
            signal.throwIfAborted(); this.update(task, '保存为文献的新附件');
            task.outputAttachmentID = await this.host.saveOutput(source, task, bytes, signal);
            signal.throwIfAborted(); task.state = 'completed'; task.completed = task.total;
            this.update(task, '翻译完成'); await this.persist();
            if (!this.stopped && this.getSettings().autoOpen) {
                await this.host.openAttachment(task.outputAttachmentID).catch(() => this.host.notify('译文已保存，可从任务列表打开'));
            }
        } catch (error) {
            if (task.state === 'running') {
                task.state = signal.aborted ? 'paused' : 'failed';
                const message = error instanceof Error ? error.message : '翻译失败，请重试';
                task.error = settings.apiKey ? message.replaceAll(settings.apiKey, '[已隐藏]') : message;
                task.error = task.error.slice(0, 600);
                this.update(task, signal.aborted ? '已暂停，保留已完成译文' : '翻译失败，可重试');
            }
            // A closed workspace already committed its paused snapshot. Its late work must not overwrite a new queue.
            if (!this.stopped) await this.persist().catch(() => undefined);
        } finally {
            if (document) this.engine.release(document);
            if (this.active?.task === task) this.active = undefined;
        }
    }
    async saveBilingualNote(id: string): Promise<void> {
        const task = this.tasks.find(task => task.id === id);
        if (!task || task.state !== 'completed' || this.stopped) return;
        const controller = new AbortController();
        this.noteControllers.add(controller);
        let document: ParsedDocument | undefined;
        try {
            const source = await this.host.readAttachment(task.attachmentID, controller.signal, 'note');
            controller.signal.throwIfAborted();
            if (source.fingerprint !== task.fingerprint) throw new Error('原文件已变化，无法将旧译文关联到新原文');
            document = await this.engine.parse(source, controller.signal, () => {});
            controller.signal.throwIfAborted();
            if (this.stopped) return;
            task.noteID = await this.host.saveNote(source, task,
                bilingualNote(document, task.translations, source.sourceURI), controller.signal);
            controller.signal.throwIfAborted();
            if (this.stopped) return;
            await this.persist(); this.emit(); this.host.notify('双语笔记已保存到原文献');
        } finally {this.noteControllers.delete(controller); if (document) this.engine.release(document);}
    }
    async dispose(): Promise<void> {
        this.stopped = true;
        clearTimeout(this.checkpointTimer);
        for (const task of this.tasks) {
            if (task.state === 'running' || task.state === 'queued') {
                task.state = 'paused'; task.phase = '可继续上次翻译';
            }
        }
        this.active?.controller.abort();
        for (const controller of this.noteControllers) controller.abort();
        await this.persist(); this.listeners.clear();
    }
}

/**
 * @file integrations/zotero/platform.ts
 * 文件职责：将 Zotero 文献、文件和笔记 API 适配为工作台使用的原生端口。
 * 主要内容：凭据与任务分离存储、原子任务写入、内容摘要校验、译文幂等回存及安全笔记。
 * 模块边界：不发起翻译请求，不访问用户默认资料库路径；所有宿主能力由环境显式注入。
 */
import {sha256} from '@noble/hashes/sha256';
import {getDocumentMaxBytes} from '../../src/features/document-translation/core/document';
import type {AttachmentSource, TranslationSettings, TranslationTask, ZoteroHost} from './contracts';
import {defaultSettings, normalizeSettings} from './settings';

export interface NativeIO {
    readJSON(path: string): Promise<unknown>;
    writeJSON(path: string, value: unknown, options?: Record<string, unknown>): Promise<unknown>;
    read(path: string): Promise<Uint8Array>;
    write(path: string, bytes: Uint8Array, options?: Record<string, unknown>): Promise<unknown>;
    exists(path: string): Promise<boolean>;
    stat?(path: string): Promise<{size: number}>;
    makeDirectory(path: string, options?: Record<string, unknown>): Promise<unknown>;
    remove(path: string, options?: Record<string, unknown>): Promise<unknown>;
    setPermissions?(path: string, permissions: number): Promise<unknown>;
}
export interface NativeEnvironment {
    // Zotero 的动态宿主 API 由适配边界接收，测试注入相同的最小接口。
    Zotero: any;
    IOUtils: NativeIO;
    PathUtils: {join(...parts: string[]): string};
    profileDirectory: string;
    DOMParser: typeof DOMParser;
    notify?: (message: string) => void;
}

export function contentFingerprint(bytes: Uint8Array): string {
    return Array.from(sha256(bytes), value => value.toString(16).padStart(2, '0')).join('');
}
export function escapeHTML(value: string): string {
    return value.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]!));
}
function checkAbort(signal: AbortSignal): void {
    if (signal.aborted) {const error = new Error('操作已取消'); error.name = 'AbortError'; throw error;}
}
function taskMarker(task: TranslationTask): string {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(task.id)) throw new Error('无效的翻译任务标识');
    return `fluentread:task:${task.id}`;
}
function missingFile(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'name' in error && ['NotFoundError', 'NS_ERROR_FILE_NOT_FOUND'].includes(String(error.name));
}

/** 只保留阅读排版标签；译文提供的链接、属性和活动内容不能进入 Zotero 笔记。 */
export function sanitizeNoteHTML(html: string, Parser: typeof DOMParser, allowedSourceURI?: string): string {
    const doc = new Parser().parseFromString(html, 'text/html');
    const allowed = new Set(['P', 'DIV', 'BR', 'H1', 'H2', 'H3', 'H4', 'STRONG', 'EM', 'B', 'I', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'CODE', 'PRE', 'SPAN']);
    const discard = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT']);
    const clean = (node: Node): string => {
        if (node.nodeType === 3) return escapeHTML(node.textContent || '');
        if (node.nodeType !== 1) return '';
        const element = node as Element;
        const tagName = element.tagName.toUpperCase();
        if (discard.has(tagName)) return '';
        const children = Array.from(element.childNodes, clean).join('');
        if (tagName === 'A' && allowedSourceURI) {
            const href = element.getAttribute('href') || '';
            const suffix = href.startsWith(allowedSourceURI) ? href.slice(allowedSourceURI.length) : 'invalid';
            if (suffix === '' || /^\?page=[1-9]\d{0,6}(?:&annotation=[A-Z0-9]{8})?$/.test(suffix)) return `<a href="${escapeHTML(href)}">${children}</a>`;
        }
        if (!allowed.has(tagName)) return children;
        const name = tagName.toLowerCase();
        return name === 'br' ? '<br>' : `<${name}>${children}</${name}>`;
    };
    return Array.from(doc.body.childNodes, clean).join('');
}

export function createZoteroHost(environment: NativeEnvironment): ZoteroHost {
    const {Zotero: zotero, IOUtils: io, PathUtils: paths} = environment;
    const directory = paths.join(environment.profileDirectory, 'fluentread');
    const settingsPath = paths.join(directory, 'settings.json');
    const credentialsPath = paths.join(directory, 'credentials.json');
    const tasksPath = paths.join(directory, 'tasks.json');
    const locations = new WeakMap<AttachmentSource, {path: string; parentID: number | false}>();
    const commits = new Map<string, Promise<number>>();
    let storageChain: Promise<unknown> = Promise.resolve();
    let currentAPIKey = '';
    const storage = <T>(operation: () => Promise<T>): Promise<T> => {
        const result = storageChain.then(operation, operation);
        storageChain = result.catch(() => undefined);
        return result;
    };
    const readJSON = async (path: string, fallback: unknown): Promise<unknown> => {
        try {return await io.readJSON(path);} catch (error) {
            if (missingFile(error)) return fallback;
            throw error;
        }
    };
    const writeJSON = async (path: string, value: unknown): Promise<void> => {
        await io.makeDirectory(directory, {ignoreExisting: true, permissions: 0o700});
        await io.writeJSON(path, value, {tmpPath: `${path}.tmp`, flush: true});
        await io.setPermissions?.(path, 0o600);
    };
    const readPDF = async (path: string, fileName: string): Promise<Uint8Array> => {
        const maximum = getDocumentMaxBytes(fileName);
        const info = await io.stat?.(path);
        if (info && info.size > maximum) throw new Error('PDF 超过文档翻译允许的大小，请先拆分文件');
        const bytes = await io.read(path);
        if (bytes.byteLength > maximum) throw new Error('PDF 超过文档翻译允许的大小，请先拆分文件');
        return bytes;
    };
    const attachment = async (id: number): Promise<any> => {
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error('无效的 PDF 附件');
        const item = await zotero.Items.getAsync(id);
        if (!item || item.deleted || !item.isPDFAttachment()) throw new Error('原 PDF 附件已删除或不可用');
        return item;
    };
    const sourceURI = (item: any): string => {
        const library = zotero.Libraries.get(item.libraryID);
        if (library?.libraryType === 'group') {
            const groupID = zotero.Groups.getGroupIDFromLibraryID(item.libraryID);
            return `zotero://open-pdf/groups/${groupID}/items/${encodeURIComponent(item.key)}`;
        }
        return `zotero://open-pdf/library/items/${encodeURIComponent(item.key)}`;
    };
    const writable = (item: any, files: boolean): void => {
        const library = zotero.Libraries.get(item.libraryID);
        if (!library?.editable || (files && library.filesEditable === false)) throw new Error('此文献库为只读，无法保存译文；请复制到可编辑的文献库');
        if (item.parentID) {
            const parent = zotero.Items.get(item.parentID);
            if (!parent || parent.deleted || parent.libraryID !== item.libraryID || !parent.isRegularItem()) throw new Error('原文献父条目已改变或不可写');
        }
    };
    const verifySource = async (source: AttachmentSource, task: TranslationTask, signal: AbortSignal, files: boolean): Promise<any> => {
        checkAbort(signal);
        const item = await attachment(source.id);
        if (item.libraryID !== source.libraryID || item.key !== source.key || task.attachmentID !== source.id || task.libraryID !== source.libraryID || task.attachmentKey !== source.key) throw new Error('原 PDF 身份已改变，请重新建立翻译任务');
        const path = await item.getFilePathAsync();
        const location = locations.get(source);
        if (!path || (location && (path !== location.path || (item.parentID || false) !== location.parentID))) throw new Error('原 PDF 文件位置或父条目已改变，请重新建立翻译任务');
        const bytes = await readPDF(path, item.attachmentFilename);
        checkAbort(signal);
        if (contentFingerprint(bytes) !== source.fingerprint || (task.fingerprint && task.fingerprint !== source.fingerprint)) throw new Error('原 PDF 内容已改变，请重新建立翻译任务');
        writable(item, files);
        return item;
    };
    const existingResult = async (item: any, task: TranslationTask, kind: 'pdf' | 'note'): Promise<number | undefined> => {
        const marker = taskMarker(task);
        const candidates = item.parentID
            ? await zotero.Items.getAsync(zotero.Items.get(item.parentID).getAttachments().concat(kind === 'note' ? zotero.Items.get(item.parentID).getNotes() : []))
            : await zotero.Items.getAll(item.libraryID, true, false);
        const filename = `fluentread-${task.id}-${task.settings.output}.pdf`;
        return candidates.find((candidate: any) => !candidate.deleted && candidate.id !== item.id && candidate.libraryID === item.libraryID
            && (candidate.parentID || false) === (item.parentID || false)
            && (kind === 'pdf' ? candidate.isPDFAttachment() && candidate.attachmentFilename === filename : candidate.isNote() && candidate.hasTag(marker)))?.id;
    };
    const exclusive = (key: string, operation: () => Promise<number>): Promise<number> => {
        const pending = commits.get(key);
        if (pending) return pending;
        const result = operation().finally(() => commits.delete(key));
        commits.set(key, result);
        return result;
    };
    return {
        fontCache: {io, directory: paths.join(directory, 'fonts')},
        loadSettings() {return storage(async () => {
            const settings = await readJSON(settingsPath, defaultSettings);
            const credentials = await readJSON(credentialsPath, {});
            const normalized = normalizeSettings(settings);
            const saved = credentials && typeof credentials === 'object' ? credentials as Record<string, unknown> : {};
            const bindingMatches = saved.endpoint === normalized.endpoint && saved.service === normalized.service;
            const key = bindingMatches && typeof saved.apiKey === 'string' ? saved.apiKey : '';
            if (!bindingMatches && typeof saved.apiKey === 'string' && saved.apiKey) environment.notify?.('翻译服务配置未完整保存，请重新填写 API 密钥；旧密钥没有发送给其他服务。');
            currentAPIKey = key;
            return {...normalized, apiKey: key};
        });},
        saveSettings(settings: TranslationSettings) {
            const normalized = normalizeSettings(settings);
            const {apiKey, ...publicSettings} = normalized;
            return storage(async () => {
                await writeJSON(credentialsPath, {apiKey, endpoint: normalized.endpoint, service: normalized.service});
                await writeJSON(settingsPath, publicSettings);
                currentAPIKey = apiKey;
            });
        },
        loadTasks() {return storage(() => readJSON(tasksPath, []));},
        saveTasks(tasks) {
            // 白名单复制，避免未来对象扩展意外把凭据或宿主对象序列化进任务。
            const snapshot = tasks.map(task => ({
                id: task.id, attachmentID: task.attachmentID, libraryID: task.libraryID, attachmentKey: task.attachmentKey,
                title: task.title, state: task.state, phase: task.phase, createdAt: task.createdAt, updatedAt: task.updatedAt,
                settings: {sourceLanguage: task.settings.sourceLanguage, targetLanguage: task.settings.targetLanguage, service: task.settings.service,
                    endpoint: task.settings.endpoint, model: task.settings.model, glossary: task.settings.glossary, output: task.settings.output},
                fingerprint: task.fingerprint, translations: [...task.translations], total: task.total, completed: task.completed,
                outputAttachmentID: task.outputAttachmentID, noteID: task.noteID,
                error: currentAPIKey ? task.error?.split(currentAPIKey).join('[已隐藏凭据]') : task.error,
            }));
            return storage(() => writeJSON(tasksPath, snapshot));
        },
        async selectedAttachments() {
            const pane = zotero.getActiveZoteroPane?.() || zotero.getMainWindow?.()?.ZoteroPane;
            const selected = pane?.getSelectedItems() || [];
            const result = new Map<number, Pick<AttachmentSource, 'id' | 'libraryID' | 'key' | 'title'>>();
            for (const selectedItem of selected) {
                const items = selectedItem.isRegularItem() ? await zotero.Items.getAsync(selectedItem.getAttachments()) : [selectedItem];
                for (const item of items) if (item && !item.deleted && item.isPDFAttachment()
                    && !(selectedItem.isRegularItem() && /^fluentread-.*\.pdf$/i.test(item.attachmentFilename || ''))) {
                    result.set(item.id, {id: item.id, libraryID: item.libraryID, key: item.key, title: item.getField('title') || item.attachmentFilename});
                }
            }
            return [...result.values()];
        },
        async readAttachment(id, signal, purpose = 'pdf') {
            checkAbort(signal);
            const item = await attachment(id);
            // 全文翻译在首次请求前检查回存能力，避免只读库消耗翻译额度后才失败。
            if (purpose !== 'selection') writable(item, purpose === 'pdf');
            const path = await item.getFilePathAsync();
            if (!path || !await io.exists(path)) throw new Error('找不到 PDF 文件，请先在 Zotero 中下载或重新定位附件');
            const bytes = await readPDF(path, item.attachmentFilename);
            checkAbort(signal);
            const source: AttachmentSource = {id: item.id, libraryID: item.libraryID, key: item.key,
                title: item.getField('title') || item.attachmentFilename, fileName: item.attachmentFilename,
                bytes, fingerprint: contentFingerprint(bytes), sourceURI: sourceURI(item)};
            locations.set(source, {path, parentID: item.parentID || false});
            return source;
        },
        saveOutput(source, task, bytes, signal) {
            return exclusive(`${task.id}:pdf`, async () => {
                const item = await verifySource(source, task, signal, true);
                const existing = await existingResult(item, task, 'pdf');
                if (existing) return existing;
                if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('译文输出不是有效的 PDF 文件');
                const filename = `fluentread-${task.id}-${task.settings.output}.pdf`;
                const path = paths.join(directory, filename);
                await io.makeDirectory(directory, {ignoreExisting: true, permissions: 0o700});
                await io.write(path, bytes, {tmpPath: `${path}.tmp`, flush: true});
                try {
                    await verifySource(source, task, signal, true);
                    const imported = await zotero.Attachments.importFromFile({file: path, libraryID: item.libraryID,
                        parentItemID: item.parentID || undefined,
                        collections: item.parentID ? undefined : item.getCollections(),
                        title: `${source.title} · ${task.settings.targetLanguage} · ${task.settings.output === 'bilingual' ? '双语' : '译文'}`,
                        contentType: 'application/pdf', fileBaseName: filename.slice(0, -4)});
                    // 取消不能让迟到的提交留下未登记附件；仅回滚本次新建项。
                    if (signal.aborted) {await imported.eraseTx(); checkAbort(signal);}
                    // 文件名在 importFromFile 的数据库事务中提交；即使在此之后崩溃，重试也能找回附件。
                    return imported.id;
                } finally {await io.remove(path, {ignoreAbsent: true});}
            });
        },
        saveNote(source, task, html, signal) {
            return exclusive(`${task.id}:note`, async () => {
                const item = await verifySource(source, task, signal, false);
                const existing = await existingResult(item, task, 'note');
                if (existing) return existing;
                const note = new zotero.Item('note');
                note.libraryID = item.libraryID;
                note.parentID = item.parentID || false;
                if (!item.parentID) note.setCollections(item.getCollections());
                note.addTag(taskMarker(task), 1);
                const safe = sanitizeNoteHTML(html, environment.DOMParser, sourceURI(item));
                note.setNote(`<div class="zotero-note znv1"><h2>${escapeHTML(source.title)} · 流畅阅读</h2>${safe}<p><a href="${escapeHTML(sourceURI(item))}">返回原 PDF</a></p></div>`);
                checkAbort(signal);
                await note.saveTx();
                if (signal.aborted) {await note.eraseTx(); checkAbort(signal);}
                return note.id;
            });
        },
        async openAttachment(id) {await zotero.Reader.open(id);},
        async openSource(id, page) {
            await attachment(id);
            await zotero.Reader.open(id, Number.isSafeInteger(page) && page! > 0 ? {pageIndex: page! - 1} : undefined);
        },
        notify(message) {environment.notify?.(message);},
    };
}

/**
 * @file src/features/document-translation/services/history.ts
 * 文件职责：在浏览器本地保存最近翻译过的文档及其译文，使文档翻译首页可以列出记录并一键恢复阅读。
 * 主要内容：以文件内容摘要为稳定标识，在独立的 IndexedDB 库中保存原始文件字节、解析结果快照、译文、进度与设置指纹；解析规则变化后按原文与双向唯一的原生位置或邻文恢复未变化片段的独立校订，歧义校订独立保留，复用同文件中页号、展示尺寸与旋转一致的已识别扫描页；原文件、逐行及逐项稳定几何均一致时，保留因字体指标修正而合并的连续普通文字段，使用新字形重建边界而不拼接译文；其余文字页保持新解析结果，统一重编号全文片段；本次复用的旧索引保留独立校订与空槽并从原文匹配池排除，不写入解析快照；列表只返回不含文件字节的摘要并按最近更新时间排序；超过条数或总字节上限时淘汰最旧的记录；数据库不可用、被其他标签页占用而超时或读写失败时安静降级为“没有记录”，并在其他标签页需要升级或删除时让出连接，不影响打开和翻译文档。
 * 保存生命周期：超时撤销后续写入资格并取消活跃写事务，只有真实事务提交后才确认保存成功，避免迟到打开数据库的旧修订覆盖新校订；重译跳过缓存只接受并保存显式 true，刷新后继续当前重译不会恢复旧缓存。
 * 模块边界：只负责本地存取与已有译文匹配，不解析文档、不发起翻译、不读取配置，也不把任何内容发送到网络；页面状态、解析版本与何时保存由文档页面组合根决定。
 */
import {documentSourceLocators, matchDocumentSourceLocators} from '../core/materialLocator';
import type {DocumentSegment, ParsedDocument, PdfDocumentBlock, PdfDocumentLine, PdfDocumentPage, PdfDocumentRun} from '../core/document';

export const DOCUMENT_HISTORY_MAX_ENTRIES = 20;
export const DOCUMENT_HISTORY_MAX_BYTES = 80 * 1024 * 1024;
const DATABASE = 'FluentReadDocumentHistory';
const STORE = 'documents';

export interface DocumentHistorySummary {
    id: string;
    name: string;
    format: string;
    size: number;
    sourceUrl?: string;
    /** 片段总数与已有译文的片段数，用于在首页显示进度。 */
    total: number;
    completed: number;
    updatedAt: number;
}
export interface DocumentHistoryRecord extends DocumentHistorySummary {
    bytes: Uint8Array;
    mimeType: string;
    translations: string[];
    /** 生成这些译文时的语言、服务与术语设置；恢复后据此判断设置是否已经改变。 */
    fingerprint: string;
    /** 用户确认重译后持续跳过旧译文缓存；旧记录和未开启的任务不保存该字段。 */
    bypassCache?: boolean;
    /** 解析结果的快照与产生它的解析版本：版本一致时刷新可以直接还原，不必重新解析文件。 */
    parsed?: unknown;
    parsedVersion?: number;
    /** 解析变化后无法安全套用的旧校订，只作为可复制资料保留，不计入当前译文或进度。 */
    retainedRevisions?: DocumentRetainedRevision[];
}
export interface DocumentRetainedRevision {source: string; translation: string; contextLabel?: string;}
export interface DocumentHistory {
    list(): Promise<DocumentHistorySummary[]>;
    load(id: string): Promise<DocumentHistoryRecord | null>;
    save(record: DocumentHistoryRecord): Promise<boolean>;
    remove(id: string): Promise<void>;
    clear(): Promise<void>;
}

/**
 * 重新解析时只复用原文完全相同且位置明确的片段；重复原文不猜测出现次序，空译文也占据自己的已确认位置。
 * 没有原文快照的旧记录仅在解析版本已知且一致、片段总数一致时按索引恢复。
 */
export function restoreDocumentHistoryTranslations(
    record: Pick<DocumentHistoryRecord, 'parsed' | 'parsedVersion' | 'total' | 'translations'>,
    document: ParsedDocument,
    currentVersion: number,
    segmentOrigins?: readonly (number | undefined)[],
): string[] {
    return matchDocumentHistoryTranslations(record, document, currentVersion, segmentOrigins).translations;
}

function matchDocumentHistoryTranslations(
    record: Pick<DocumentHistoryRecord, 'parsed' | 'parsedVersion' | 'total' | 'translations'>,
    document: ParsedDocument,
    currentVersion: number,
    segmentOrigins?: readonly (number | undefined)[],
): {translations: string[]; consumed: Set<number>} {
    const consumed = new Set<number>();
    const snapshot = record.parsed && typeof record.parsed === 'object'
        ? record.parsed as {segments?: unknown} : undefined;
    const previous = Array.isArray(snapshot?.segments) ? snapshot.segments : [];
    const slots = new Map<number, string>();
    previous.forEach((segment: unknown, index: number) => {
        if (!segment || typeof segment !== 'object') return;
        const candidate = segment as {source?: unknown; id?: unknown};
        if (typeof candidate.source !== 'string') return;
        const slot = typeof candidate.id === 'number' && Number.isInteger(candidate.id) && candidate.id >= 0 ? candidate.id : index;
        slots.set(index, typeof record.translations[slot] === 'string' ? record.translations[slot] : '');
    });
    if (slots.size) {
        const origins = matchDocumentSourceLocators(documentSourceLocators(snapshot!), documentSourceLocators(document), segmentOrigins,
            record.parsed === document || Number.isInteger(currentVersion) && currentVersion >= 0 && record.parsedVersion === currentVersion);
        return {translations: origins.map(origin => {
            if (origin === undefined) return '';
            consumed.add(origin);
            // matcher 只返回已归一的旧槽索引；IndexedDB 快照是稳定的普通数据。
            return slots.get(origin)!;
        }), consumed};
    }
    const compatible = Number.isInteger(currentVersion) && currentVersion >= 0
        && record.parsedVersion === currentVersion && record.total === document.segments.length;
    const translations = document.segments.map((_segment, index) => {
        const translation = compatible ? record.translations[index] : undefined;
        return typeof translation === 'string' ? translation : '';
    });
    return {translations, consumed};
}

/** 对已存资料和本次未消费的旧校订统一校验、复制并去重，不丢弃有效原文或译文中的空白。 */
function retainedDocumentRevisions(values: readonly unknown[]): DocumentRetainedRevision[] {
    const retained: DocumentRetainedRevision[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        if (!value || typeof value !== 'object') continue;
        const revision = value as Partial<DocumentRetainedRevision>;
        if (typeof revision.source !== 'string' || !revision.source.trim()
            || typeof revision.translation !== 'string' || !revision.translation.trim()) continue;
        const contextLabel = typeof revision.contextLabel === 'string' ? revision.contextLabel.trim() : '';
        const key = JSON.stringify([revision.source, revision.translation, contextLabel]);
        if (seen.has(key)) continue;
        seen.add(key);
        retained.push({source: revision.source, translation: revision.translation, ...(contextLabel ? {contextLabel} : {})});
    }
    return retained;
}

/** 调用方先按文件身份选中历史记录；沿用安全匹配，并保留无法消费的独立旧校订供用户查看。 */
export function restoreDocumentHistoryRevisions(
    record: Pick<DocumentHistoryRecord, 'parsed' | 'parsedVersion' | 'total' | 'translations' | 'retainedRevisions'>,
    document: ParsedDocument,
    currentVersion: number,
    segmentOrigins?: readonly (number | undefined)[],
): {translations: string[]; retainedRevisions: DocumentRetainedRevision[]} {
    const normalized = {...record, translations: Array.isArray(record.translations) ? record.translations : []};
    const {translations, consumed} = matchDocumentHistoryTranslations(normalized, document, currentVersion, segmentOrigins);
    const snapshot = record.parsed && typeof record.parsed === 'object' ? record.parsed as {segments?: unknown} : undefined;
    const previous = Array.isArray(snapshot?.segments) ? snapshot.segments : [];
    const unused = previous.flatMap((value, index) => {
        if (consumed.has(index) || !value || typeof value !== 'object') return [];
        const segment = value as {id?: unknown; source?: unknown; contextLabel?: unknown};
        const slot = typeof segment.id === 'number' && Number.isInteger(segment.id) && segment.id >= 0 ? segment.id : index;
        return [{source: segment.source, translation: normalized.translations[slot], contextLabel: segment.contextLabel}];
    });
    return {translations, retainedRevisions: retainedDocumentRevisions([...(Array.isArray(record.retainedRevisions) ? record.retainedRevisions : []), ...unused])};
}

export interface DocumentHistoryPdfOcrRestore {
    document: ParsedDocument;
    /** 本次恢复的 OCR 或几何迁移段所对应的旧片段数组位置；不得写入解析快照。 */
    segmentOrigins?: readonly (number | undefined)[];
}

/** 只比较不受字体 ascent/descent 修正影响的文字和几何，缺少逐字项证据时拒绝迁移。 */
function stablePdfLine(line: PdfDocumentLine): string | undefined {
    const key = (run: PdfDocumentRun) => run && typeof run.text === 'string' && run.text.trim()
        && [run.x, run.width, run.baseline, run.fontSize, run.y, run.height].every(value => typeof value === 'number' && Number.isFinite(value))
        && run.width > 0 && run.height > 0 && run.fontSize! > 0
        ? [run.text, run.x, run.width, run.baseline, run.fontSize, run.fontFamily] : undefined;
    const geometry = key(line);
    if (!geometry || !Array.isArray(line.runs) || !line.runs.length) return undefined;
    const runs = line.runs.map(key);
    return runs.every(Boolean) ? JSON.stringify([geometry, runs]) : undefined;
}

/**
 * 同一 PDF 的字体度量修正可能把相邻普通段落合法合并。只在旧块连续、全部行/run
 * 与新块逐项匹配且原文以单个空格精确相连时保留旧分段；不猜测断词、公式或表格。
 * 译文仍逐槽恢复，矩形和字形必须全部取自新解析，旧的错误 y/height 不能带回来。
 */
function restorePdfTextSplits(page: PdfDocumentPage, cached: PdfDocumentPage, oldSegments: readonly DocumentSegment[], freshSegments: readonly DocumentSegment[]): {page: PdfDocumentPage; origins: Array<number | undefined>} | undefined {
    const ordinary = (block: PdfDocumentBlock) => block?.kind === 'text' && !block.preserveSource && !block.cellBounds
        && Number.isInteger(block.segmentIndex) && block.segmentIndex >= 0 && Array.isArray(block.lines)
        && block.lines.length > 0 && block.lineCount === block.lines.length;
    const sameStyle = (old: PdfDocumentBlock, fresh: PdfDocumentBlock) => old.fontSize === fresh.fontSize
        && old.fontFamily === fresh.fontFamily && old.fontWeight === fresh.fontWeight && old.textAlign === fresh.textAlign && old.column === fresh.column;
    const signatures = new WeakMap<PdfDocumentLine, string | undefined>();
    const signature = (line: PdfDocumentLine) => {
        if (!line || typeof line !== 'object') return undefined;
        if (!signatures.has(line)) signatures.set(line, stablePdfLine(line));
        return signatures.get(line);
    };
    const starts = new Map<string, number[]>();
    cached.blocks.forEach((block, index) => {
        if (!ordinary(block)) return;
        const first = signature(block.lines![0]);
        if (first) {const indexes = starts.get(first) ?? []; indexes.push(index); starts.set(first, indexes);}
    });
    const claimed = new Set<number>();
    const origins: Array<number | undefined> = [];
    let changed = false;
    const blocks = page.blocks.flatMap(fresh => {
        const keep = () => {origins.push(undefined); return [fresh];};
        if (!ordinary(fresh) || freshSegments[fresh.segmentIndex]?.id !== fresh.segmentIndex) return keep();
        const keys = fresh.lines!.map(signature);
        if (!keys.every(Boolean) || fresh.lines!.some((line, index) => index > 0 && line.baseline! <= fresh.lines![index - 1].baseline!)) return keep();
        const matches: Array<Array<{block: PdfDocumentBlock; index: number; start: number}>> = [];
        for (const start of starts.get(keys[0]!) ?? []) {
            const parts: Array<{block: PdfDocumentBlock; index: number; start: number}> = [];
            let at = 0;
            for (let index = start; index < cached.blocks.length && at < keys.length; index += 1) {
                const block = cached.blocks[index];
                if (!ordinary(block) || claimed.has(index) || !sameStyle(block, fresh)
                    || oldSegments[block.segmentIndex]?.id !== block.segmentIndex
                    || block.lines!.length + at > keys.length
                    || block.lines!.some((line, offset) => signature(line) !== keys[at + offset])) break;
                parts.push({block, index, start: at});
                at += block.lines!.length;
            }
            if (at === keys.length && parts.length > 1 && new Set(parts.map(({block}) => block.segmentIndex)).size === parts.length
                && parts.map(({block}) => oldSegments[block.segmentIndex].source).join(' ') === freshSegments[fresh.segmentIndex].source) matches.push(parts);
        }
        if (matches.length !== 1) return keep();
        changed = true;
        return matches[0].map(({block, index, start}, part) => {
            claimed.add(index);
            origins.push(block.segmentIndex);
            const lines = fresh.lines!.slice(start, start + block.lines!.length);
            let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
            for (const line of lines) {x = Math.min(x, line.x); y = Math.min(y, line.y); right = Math.max(right, line.x + line.width); bottom = Math.max(bottom, line.y + line.height);}
            const leading = lines.slice(1).map((line, position) => line.baseline! - lines[position].baseline!).sort((a, b) => a - b);
            return {...fresh, x, y, width: right - x, height: bottom - y,
                lines, lineCount: lines.length, lineHeight: leading[Math.floor(leading.length / 2)] || lines[0].fontSize!,
                ...(fresh.readingOrder === undefined ? {} : {readingOrder: fresh.readingOrder + part / matches[0].length})};
        });
    });
    return changed ? {page: {...page, blocks}, origins} : undefined;
}

/** 同文件重解析时复用已识别扫描页，受限保留只因字体几何修正而合并的普通段落，重新编号全文。 */
export function restoreDocumentHistoryPdfOcr(
    record: Pick<DocumentHistoryRecord, 'parsed' | 'bytes'>,
    document: ParsedDocument,
): DocumentHistoryPdfOcrRestore {
    const binary = document.binary;
    if (binary?.kind !== 'pdf') return {document};
    const snapshot = record.parsed && typeof record.parsed === 'object'
        ? record.parsed as Partial<ParsedDocument> : undefined;
    const previous = snapshot?.binary;
    if (previous?.kind !== 'pdf' || !Array.isArray(previous.pages) || !Array.isArray(snapshot?.segments)) return {document};
    // 历史条目的原始字节与快照都必须属于当前文件，不能把另一份文件的识别框搬过来。
    if (record.bytes?.length !== binary.bytes.length || previous.bytes?.length !== binary.bytes.length
        || binary.bytes.some((byte, index) => byte !== record.bytes[index] || byte !== previous.bytes[index])) return {document};
    const oldSegments = snapshot.segments;
    const restored = binary.pages.map(page => {
        if (![page.width, page.height].every(value => Number.isFinite(value) && value > 0)) return undefined;
        const cached = previous.pages.find(candidate => candidate && typeof candidate === 'object' && candidate.pageNumber === page.pageNumber);
        if (!cached || cached.width !== page.width || cached.height !== page.height
            || (cached.sourceRotation ?? cached.rotation ?? 0) !== (page.rotation ?? page.sourceRotation ?? 0)
            || !Array.isArray(cached.blocks) || !cached.blocks.every(block => block && typeof block === 'object'
                && Number.isInteger(block.segmentIndex) && (block.segmentIndex < 0 || typeof oldSegments[block.segmentIndex]?.source === 'string'))) return undefined;
        if (page.scanned) return cached.scanned === false ? {page: cached, origins: cached.blocks.map(block => block.segmentIndex >= 0 ? block.segmentIndex : undefined)} : undefined;
        return cached.scanned ? undefined : restorePdfTextSplits(page, cached, oldSegments, document.segments);
    });
    if (!restored.some(Boolean)) return {document};
    const segments: DocumentSegment[] = [];
    const segmentOrigins: Array<number | undefined> = [];
    const pages = binary.pages.map((page, index) => {
        const selected = restored[index]?.page ?? page;
        const segmentIndexes: number[] = [];
        const blocks = selected.blocks.map((block, blockIndex) => {
            if (block.segmentIndex < 0) return block;
            const origin = restored[index]?.origins[blockIndex];
            const source = origin === undefined ? document.segments[block.segmentIndex] : oldSegments[origin];
            const id = segments.length;
            segments.push({...source, id});
            segmentOrigins.push(origin);
            segmentIndexes.push(id);
            return {...block, segmentIndex: id};
        });
        return {...selected, blocks, segmentIndexes};
    });
    return {document: {...document, segments, binary: {...binary, pages}}, segmentOrigins};
}

/** 文件名可以重复，内容摘要不会；同一份文件再次打开时接着上次的译文继续。 */
export async function documentHistoryId(bytes: Uint8Array, subtle: Pick<SubtleCrypto, 'digest'> | undefined = globalThis.crypto?.subtle): Promise<string> {
    if (!subtle) return '';
    try {
        const digest = new Uint8Array(await subtle.digest('SHA-256', bytes.slice()));
        return Array.from(digest.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
    } catch {return '';}
}

function request<T>(target: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        target.onsuccess = () => resolve(target.result);
        target.onerror = () => reject(target.error);
    });
}

function summary(record: DocumentHistoryRecord): DocumentHistorySummary {
    const {id, name, format, size, sourceUrl, total, completed, updatedAt} = record;
    return {id, name, format, size, ...(sourceUrl ? {sourceUrl} : {}), total, completed, updatedAt};
}

/** 兼容旧记录；不把字符串、数字或其它 truthy 值当作用户确认的重译策略。 */
function normalizeDocumentHistoryCachePolicy(record: DocumentHistoryRecord): DocumentHistoryRecord {
    const {bypassCache, ...snapshot} = record;
    return bypassCache === true ? {...snapshot, bypassCache: true} : snapshot;
}

export function createDocumentHistory(factory: IDBFactory | undefined = globalThis.indexedDB, timeoutMs = 3000): DocumentHistory {
    let opening: Promise<IDBDatabase> | undefined;
    const open = () => opening ??= new Promise<IDBDatabase>((resolve, reject) => {
        const opened = factory!.open(DATABASE, 1);
        opened.onupgradeneeded = () => {opened.result.createObjectStore(STORE, {keyPath: 'id'});};
        opened.onsuccess = () => {
            const database = opened.result;
            // 其他标签页要升级或删除这个库时主动让出连接，下次使用再重新打开。
            database.onversionchange = () => {database.close(); opening = undefined;};
            resolve(database);
        };
        opened.onerror = () => reject(opened.error);
        opened.onblocked = () => reject(new Error('blocked'));
    }).catch(error => {opening = undefined; throw error;});
    const readStore = async (signal: AbortSignal) => {
        const database = await open();
        signal.throwIfAborted();
        return database.transaction(STORE, 'readonly').objectStore(STORE);
    };
    /** 撤销资格贯穿数据库打开等待与真实事务；请求成功还不代表事务已经提交。 */
    const write = async (signal: AbortSignal, enqueue: (target: IDBObjectStore) => void): Promise<void> => {
        const database = await open();
        signal.throwIfAborted();
        const transaction = database.transaction(STORE, 'readwrite');
        const settled = new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error);
        });
        const abort = () => {
            try {transaction.abort();} catch { /* 已提交事务无法撤销，也不会在稍后覆盖新写入。 */ }
        };
        signal.addEventListener('abort', abort, {once: true});
        try {
            try {enqueue(transaction.objectStore(STORE));} catch {abort();}
            await settled;
        } finally {signal.removeEventListener('abort', abort);}
    };
    /** 历史记录是锦上添花：任何存储错误都退化为默认值，绝不打断文档流程。 */
    const guarded = async <T>(fallback: T, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
        if (!factory) return fallback;
        // 被其他标签页占用的数据库可能迟迟不响应；超过时限同样按“没有记录”处理，不能卡住打开文件。
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<T>(resolve => {timer = setTimeout(() => {controller.abort(); opening = undefined; resolve(fallback);}, timeoutMs);});
        const result = await Promise.race([work(controller.signal).catch(() => fallback), expired]);
        clearTimeout(timer);
        return result;
    };
    const all = async (signal: AbortSignal) => (await request((await readStore(signal)).getAll()) as DocumentHistoryRecord[]).sort((left, right) => right.updatedAt - left.updatedAt);
    return {
        list: () => guarded<DocumentHistorySummary[]>([], async signal => (await all(signal)).map(summary)),
        load: id => guarded<DocumentHistoryRecord | null>(null, async signal => {
            const record = await request((await readStore(signal)).get(id)) as DocumentHistoryRecord | undefined;
            return record ? normalizeDocumentHistoryCachePolicy(record) : null;
        }),
        save: record => guarded(false, async signal => {
            if (!record.id || record.bytes.byteLength > DOCUMENT_HISTORY_MAX_BYTES) return false;
            const saved = {...normalizeDocumentHistoryCachePolicy(record), bytes: record.bytes.slice(), translations: [...record.translations],
                retainedRevisions: retainedDocumentRevisions(Array.isArray(record.retainedRevisions) ? record.retainedRevisions : [])};
            await write(signal, target => {target.put(saved);});
            // 先写入再淘汰：保留最近的记录，直到条数与总字节都回到上限以内。
            let bytes = 0;
            const stale = (await all(signal)).filter((entry, index) => {bytes += entry.bytes.byteLength; return index >= DOCUMENT_HISTORY_MAX_ENTRIES || bytes > DOCUMENT_HISTORY_MAX_BYTES;});
            if (stale.length) await write(signal, target => {stale.forEach(entry => target.delete(entry.id));});
            return true;
        }),
        remove: id => guarded(undefined, signal => write(signal, target => {target.delete(id);})),
        clear: () => guarded(undefined, signal => write(signal, target => {target.clear();})),
    };
}

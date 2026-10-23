/**
 * @file src/features/vocabulary/materialParagraphScan.ts
 * 文件职责：按有界同步 slice 扫描整份材料页面，恢复原文位置或采集当前可见原文。
 * 主要内容：候选游标持续到文档和开放 Shadow DOM 末尾，各根共用变更观察器，同 slice 共享样式和祖先缓存；预算耗尽让出执行而不截断候选，DOM/视口变更与取消使整轮结果失效。
 * 模块边界：只读 DOM，不滚动、不写 locator、不管理材料仓库；调用方只有在明确 matched 且所有权仍有效时才能提交。
 */
import {createMaterialOriginalTextReadSession, MATERIAL_ORIGINAL_TEXT_LIMITS} from './materialOriginalText';
import type {MaterialLocator} from './materialProtocol';

export const MATERIAL_SCAN_LIMITS = Object.freeze({nodesPerSlice: 8192, stylesPerSlice: 4096, candidatesPerSlice: 64,
    charactersPerSlice: 96000, traversalPerSlice: 512, millisecondsPerSlice: 4, workPerBatch: 32768, batchPauseMs: 32});
export interface MaterialScanMetrics {
    slices: number; candidates: number; traversalNodes: number; projectedNodes: number; projectedCharacters: number; ancestorVisits: number; styleReads: number;
    maxStylesPerSlice: number; maxCharactersPerSlice: number; maxWorkPerSlice: number; maxCandidatesPerSlice: number; maxSliceMs: number; batchPauses: number; unreadableCandidates: number;
}
export type MaterialParagraphScanResult = {
    status: 'matched' | 'not-found' | 'ambiguous' | 'incomplete' | 'cancelled' | 'stale' | 'invalidated';
    metrics: MaterialScanMetrics;
    node?: HTMLElement;
    locator?: MaterialLocator;
};
export interface MaterialParagraphScanOptions {
    signal?: AbortSignal;
    isCurrent?: () => boolean;
    /** 测试或宿主可注入任务调度；返回撤销函数，不能同步调用 callback。 */
    schedule?: (callback: () => void, delayMs: number) => () => void;
    now?: () => number;
}
type ScanRequest = {kind: 'locate'; locator: MaterialLocator} | {kind: 'viewport'};
const PROSE = /^(?:P|LI|BLOCKQUOTE|DD|DT|FIGCAPTION|H[1-6])$/u;
const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();
// 包括失败前多访问的一个节点、祖先边界节点和本次候选游标；预留最坏开销后才开始单块投影。
const RESERVE = MATERIAL_ORIGINAL_TEXT_LIMITS.nodes + MATERIAL_ORIGINAL_TEXT_LIMITS.ancestors + 3;

/** 避免 querySelectorAll 的全页数组分配；每次继续均沿原游标前进，DOM 变化会废弃整轮。 */
function* elements(root: Element, observeShadow: (shadow: ShadowRoot) => void): Generator<HTMLElement> {
    const stack: Array<{next: Element | null}> = [{next: root}];
    while (stack.length) {
        const frame = stack[stack.length - 1];
        const node = frame.next;
        if (!node) {stack.pop(); continue;}
        frame.next = stack.length === 1 ? null : node.nextElementSibling;
        yield node as HTMLElement;
        const shadow = node.shadowRoot;
        if (shadow) {observeShadow(shadow); stack.push({next: shadow.firstElementChild});}
        if (node.firstElementChild) stack.push({next: node.firstElementChild});
    }
}
function occurrences(text: string, quote: string, locator: MaterialLocator): number {
    let matches = 0;
    for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) {
        if ((!locator.prefix || normalize(text.slice(0, at)).endsWith(normalize(locator.prefix)))
            && (!locator.suffix || normalize(text.slice(at + quote.length)).startsWith(normalize(locator.suffix)))) matches++;
        if (matches > 1) break;
    }
    return matches;
}

/** matched 是完整稳定扫描（或已验证可见位置）的结果；incomplete/invalidated 等状态不得写入空定位。 */
export function scanMaterialParagraphs(doc: Document, request: ScanRequest, options: MaterialParagraphScanOptions = {}): Promise<MaterialParagraphScanResult> {
    const view = doc.defaultView;
    const root = doc.documentElement;
    const metrics: MaterialScanMetrics = {slices: 0, candidates: 0, traversalNodes: 0, projectedNodes: 0, projectedCharacters: 0, ancestorVisits: 0, styleReads: 0,
        maxStylesPerSlice: 0, maxCharactersPerSlice: 0, maxWorkPerSlice: 0, maxCandidatesPerSlice: 0, maxSliceMs: 0, batchPauses: 0, unreadableCandidates: 0};
    const quote = request.kind === 'locate' ? normalize(request.locator.quote || '') : '';
    if (!view || !root) return Promise.resolve({status: 'stale', metrics});
    if (request.kind === 'locate' && !quote) return Promise.resolve({status: 'not-found', metrics});
    const now = options.now ?? (() => view.performance.now());
    const schedule = options.schedule ?? ((callback: () => void, delay: number) => {const timer = view.setTimeout(callback, delay); return () => view.clearTimeout(timer);});
    return new Promise(resolve => {
        let settled = false, cancelScheduled: (() => void) | undefined, batchWork = 0;
        let pending: IteratorResult<HTMLElement> | undefined;
        let idCount = 0, idMatch: HTMLElement | undefined, ambiguousWithinCandidate = false;
        const matches: HTMLElement[] = [];
        const iterator = elements(root, shadow => observer.observe(shadow, {childList: true, characterData: true, attributes: true, subtree: true}));
        const observer = new view.MutationObserver(() => finish('invalidated'));
        const current = () => !settled && !options.signal?.aborted && root === doc.documentElement && root.isConnected && (options.isCurrent?.() ?? true);
        const invalidate = () => finish('invalidated');
        const cancelled = () => finish('cancelled');
        const finish = (status: MaterialParagraphScanResult['status'], node?: HTMLElement, locator?: MaterialLocator) => {
            if (settled) return;
            if (status === 'matched' && (!current() || !node?.isConnected)) status = 'stale';
            if (status === 'matched' && observer.takeRecords().length) status = 'invalidated';
            settled = true; cancelScheduled?.(); observer.disconnect();
            options.signal?.removeEventListener('abort', cancelled);
            view.removeEventListener('resize', invalidate);
            doc.removeEventListener('load', invalidate, true);
            doc.removeEventListener('transitionrun', invalidate, true);
            doc.removeEventListener('animationstart', invalidate, true);
            doc.fonts?.removeEventListener('loadingdone', invalidate);
            if (request.kind === 'viewport') doc.removeEventListener('scroll', invalidate, true);
            // slice 的 finally 先归并计数，结果才带上最后一个 slice 的完整预算证据。
            void Promise.resolve().then(() => resolve({status, metrics: {...metrics}, ...(status === 'matched' ? {node, locator} : {})}));
        };
        const complete = () => {
            // 此处紧接同步 slice；matched 的最终所有权仍由 finish 核对。
            if (observer.takeRecords().length) {finish('invalidated'); return;}
            if (idCount === 1 && idMatch) {finish('matched', idMatch); return;}
            if (metrics.unreadableCandidates) {finish('incomplete'); return;}
            if (ambiguousWithinCandidate || matches.length > 1) {finish('ambiguous'); return;}
            finish(matches.length ? 'matched' : 'not-found', matches[0]);
        };
        const addMatch = (node: HTMLElement) => {
            // 父块与其唯一子块是同一位置；以后出现的兄弟块仍必须保留，不能被父块 contains 吞掉。
            for (let index = matches.length - 1; index >= 0; index--) {
                if (matches[index].contains(node)) matches.splice(index, 1);
            }
            matches.push(node);
        };
        const step = () => {
            cancelScheduled = undefined;
            if (!current()) {finish('stale'); return;}
            if (observer.takeRecords().length) {finish('invalidated'); return;}
            const started = now();
            let traversed = 0, candidates = 0, done = false;
            const session = createMaterialOriginalTextReadSession(doc, {isCurrent: current});
            const available = () => {
                const used = session.metrics;
                return traversed + used.nodeVisits + used.ancestorVisits + RESERVE <= MATERIAL_SCAN_LIMITS.nodesPerSlice
                    && used.styleReads + RESERVE <= MATERIAL_SCAN_LIMITS.stylesPerSlice
                    && used.characters + MATERIAL_ORIGINAL_TEXT_LIMITS.characters <= MATERIAL_SCAN_LIMITS.charactersPerSlice
                    && candidates < MATERIAL_SCAN_LIMITS.candidatesPerSlice && traversed < MATERIAL_SCAN_LIMITS.traversalPerSlice
                    && (traversed === 0 || now() - started < MATERIAL_SCAN_LIMITS.millisecondsPerSlice);
            };
            try {
                while (available() && current()) {
                    pending ??= iterator.next();
                    if (pending.done) {done = true; break;}
                    const node = pending.value; pending = undefined; traversed++;
                    if (request.kind === 'locate' && request.locator.paragraphId && node.id === request.locator.paragraphId) idCount++;
                    if (!PROSE.test(node.tagName)) continue;
                    if (request.kind === 'viewport') {
                        const rect = node.getBoundingClientRect();
                        if (rect.bottom <= 0 || rect.top >= view.innerHeight) continue;
                    }
                    candidates++;
                    const projection = session.project(node);
                    if (!projection) {
                        if (session.status === 'budget-exceeded' || session.status === 'unavailable') metrics.unreadableCandidates++;
                        if (session.status === 'stale') {finish('stale'); break;}
                        continue;
                    }
                    if (request.kind === 'viewport') {
                        if (projection.text.length < 20) continue;
                        const rect = node.getBoundingClientRect();
                        if (rect.bottom <= 0 || rect.top >= view.innerHeight) {finish('invalidated'); break;}
                        finish('matched', node, {kind: 'text', quote: projection.text.slice(0, 6000), ...(node.id ? {paragraphId: node.id} : {})});
                        break;
                    }
                    const count = occurrences(projection.text, quote, request.locator);
                    if (!count) continue;
                    if (count > 1) ambiguousWithinCandidate = true;
                    else if (node.id === request.locator.paragraphId) idMatch = node;
                    addMatch(node);
                    if (!request.locator.paragraphId && (ambiguousWithinCandidate || matches.length > 1)) {finish('ambiguous'); break;}
                }
            } catch {
                // 原生节点或布局在页面销毁期间不可读时保留旧位置，不让异步任务悬空。
                finish('incomplete');
            } finally {
                const used = session.metrics;
                session.close();
                const work = traversed + used.nodeVisits + used.ancestorVisits;
                metrics.slices++; metrics.candidates += candidates; metrics.traversalNodes += traversed;
                metrics.projectedNodes += used.nodeVisits; metrics.ancestorVisits += used.ancestorVisits; metrics.styleReads += used.styleReads;
                metrics.projectedCharacters += used.characters;
                metrics.maxStylesPerSlice = Math.max(metrics.maxStylesPerSlice, used.styleReads);
                metrics.maxCharactersPerSlice = Math.max(metrics.maxCharactersPerSlice, used.characters);
                metrics.maxWorkPerSlice = Math.max(metrics.maxWorkPerSlice, work);
                metrics.maxCandidatesPerSlice = Math.max(metrics.maxCandidatesPerSlice, candidates);
                metrics.maxSliceMs = Math.max(metrics.maxSliceMs, now() - started);
                batchWork += work + Math.ceil(used.characters / 64);
            }
            if (settled) return;
            if (done) {complete(); return;}
            const pause = batchWork >= MATERIAL_SCAN_LIMITS.workPerBatch;
            if (pause) {batchWork = 0; metrics.batchPauses++;}
            cancelScheduled = schedule(step, pause ? MATERIAL_SCAN_LIMITS.batchPauseMs : 0);
        };
        observer.observe(root, {childList: true, characterData: true, attributes: true, subtree: true});
        options.signal?.addEventListener('abort', cancelled, {once: true});
        view.addEventListener('resize', invalidate);
        doc.addEventListener('load', invalidate, true);
        doc.addEventListener('transitionrun', invalidate, true);
        doc.addEventListener('animationstart', invalidate, true);
        doc.fonts?.addEventListener('loadingdone', invalidate);
        if (request.kind === 'viewport') doc.addEventListener('scroll', invalidate, true);
        if (options.signal?.aborted) {finish('cancelled'); return;}
        cancelScheduled = schedule(step, 0);
    });
}

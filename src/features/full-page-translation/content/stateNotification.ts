/**
 * @file src/features/full-page-translation/content/stateNotification.ts
 * 文件职责：向当前文档和后台发布全文会话开始及恢复状态。
 * 主要内容：为每个文档实例生成不含页面数据的随机标识，随既有页面状态查询和通知隔离同 URL 重载前后的消息；发布页面事件、后台会话、工具栏状态及脱敏诊断，开始或恢复清理旧诊断；同步结果订阅按队列交付最新值、隔离异常并截断写入者的当轮回声，页面回调或订阅者改变会话后不再发送旧状态。
 * 模块边界：不拥有全文会话、不接收页面事件作为命令，也不修改标签页状态；后台决定发送 frame 的权限。
 */
import {type TranslationToolbarStatus} from '../toolbarStatus';
import {normalizeDiagnostic, type Diagnostic} from '@/src/services/diagnostics';
let toolbarStatus: TranslationToolbarStatus = 'idle';
let translationActive = false;
let diagnostic: Diagnostic | undefined;
let diagnosticRetryDeadline: number | undefined;
// 仅作实例身份而非授权凭据；不读取 URL、配置、正文或持久化状态。
const documentToken = `fr-document-${Array.from({length: 4}, () => Math.random().toString(36).slice(2)).join('-')}`;
export function getFullPageTranslationDocumentToken(): string { return documentToken; }

/** 只读副本避免界面或调用方更改当前文档的诊断。 */
export function getFullPageTranslationDiagnostic(): Diagnostic | undefined {
    if (!diagnostic) return undefined;
    const remaining = diagnosticRetryDeadline === undefined ? 0 : Math.max(0, diagnosticRetryDeadline - Date.now());
    return {code: diagnostic.code, titleKey: diagnostic.titleKey, detailKey: diagnostic.detailKey,
        actions: [...diagnostic.actions], ...(remaining > 0 ? {retryAfterMs: remaining} : {})};
}

/** 只保留分类后的公共字段，不保存调用方附带的正文或原始错误。 */
export function notifyFullPageTranslationDiagnostic(value: Diagnostic | undefined): void {
    const next = normalizeDiagnostic(value);
    const deadline = next?.retryAfterMs === undefined ? undefined : Date.now() + next.retryAfterMs;
    if (JSON.stringify(diagnostic) === JSON.stringify(next) && diagnosticRetryDeadline === deadline) return;
    diagnostic = next;
    diagnosticRetryDeadline = deadline;
    sendState(translationActive);
}
let toolbarRevision = 0;
const toolbarListeners = new Set<(status: TranslationToolbarStatus) => void>();
const pendingToolbarListeners = new Set<(status: TranslationToolbarStatus) => void>();
const toolbarPublishingListeners = new Set<(status: TranslationToolbarStatus) => void>();
const deliveredToolbarRevisions = new Map<(status: TranslationToolbarStatus) => void, number>();
let notifyingToolbar = false;
let currentToolbarListener: ((status: TranslationToolbarStatus) => void) | null = null;

function deliverToolbarStatus(listener: (status: TranslationToolbarStatus) => void): void {
    try { listener(toolbarStatus); }
    catch (error) { console.error('[FluentRead] 全文翻译结果订阅者执行失败', error); }
}

function flushToolbarListeners(): void {
    if (notifyingToolbar) return;
    notifyingToolbar = true;
    try {
        while (pendingToolbarListeners.size > 0) {
            const listener = pendingToolbarListeners.values().next().value!;
            pendingToolbarListeners.delete(listener);
            currentToolbarListener = listener;
            deliveredToolbarRevisions.set(listener, toolbarRevision);
            deliverToolbarStatus(listener);
            currentToolbarListener = null;
        }
    } finally {
        currentToolbarListener = null;
        pendingToolbarListeners.clear();
        toolbarPublishingListeners.clear();
        deliveredToolbarRevisions.clear();
        notifyingToolbar = false;
    }
}

function publishToolbarStatus(): void {
    // 与 progress.ts 一致：同步写入仍更新权威值，但当前轮次不向写入者回送回声。
    if (currentToolbarListener) toolbarPublishingListeners.add(currentToolbarListener);
    for (const listener of toolbarListeners) {
        if (!toolbarPublishingListeners.has(listener) && deliveredToolbarRevisions.get(listener) !== toolbarRevision) pendingToolbarListeners.add(listener);
    }
    flushToolbarListeners();
}

export function subscribeTranslationToolbarStatus(listener: (status: TranslationToolbarStatus) => void): () => void {
    toolbarListeners.add(listener);
    if (deliveredToolbarRevisions.get(listener) !== toolbarRevision && !toolbarPublishingListeners.has(listener)) pendingToolbarListeners.add(listener);
    flushToolbarListeners();
    return () => { toolbarListeners.delete(listener); pendingToolbarListeners.delete(listener); };
}

export function getTranslationToolbarStatus(): TranslationToolbarStatus { return toolbarStatus; }
export function notifyTranslationToolbarStatus(status: TranslationToolbarStatus): void {
    if (!translationActive || toolbarStatus === status) return;
    toolbarStatus = status;
    const publicationRevision = ++toolbarRevision;
    publishToolbarStatus();
    if (publicationRevision === toolbarRevision) sendState(true);
}
function sendState(isTranslated: boolean): void {
    try {
        if (typeof browser === 'undefined' || !browser.runtime?.sendMessage) return;
        void Promise.resolve(browser.runtime.sendMessage({type: 'fullPageTranslationState', isTranslated, toolbarStatus, documentToken,
            ...(diagnostic ? {diagnostic: getFullPageTranslationDiagnostic()} : {})})).catch(() => undefined);
    } catch { /* 扩展重载时不影响页面。 */ }
}
let revision = 0;
export function getFullPageTranslationStateRevision(): number { return revision; }

export function notifyFullPageTranslationState(isTranslated: boolean): void {
    const notificationRevision = ++revision;
    diagnostic = undefined;
    diagnosticRetryDeadline = undefined;
    translationActive = isTranslated;
    toolbarStatus = isTranslated ? 'translating' : 'idle';
    const publicationRevision = ++toolbarRevision;
    publishToolbarStatus();
    // 同步结果订阅者也可能恢复原文；已经过期的生命周期不再派发页面事件。
    if (notificationRevision !== revision) return;
    try {
        if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
            const CustomEventConstructor = document.defaultView?.CustomEvent ??
                (typeof CustomEvent !== "undefined" ? CustomEvent : null);
            if (CustomEventConstructor) {
                document.dispatchEvent(new CustomEventConstructor(
                    isTranslated ? "fluentread-translation-started" : "fluentread-translation-ended",
                ));
            }
        }
    } catch { /* 页面事件失败不能阻断后台同步。 */ }
    if (revision === notificationRevision && toolbarRevision === publicationRevision) sendState(isTranslated);
}

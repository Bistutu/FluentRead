/**
 * @file src/features/local-translation/offscreen/translation.ts
 *
 * 文件职责：在 Offscreen Document 中管理本地翻译 Worker、模型缓存和请求取消。
 * 主要内容：串行复用模型 Worker，按设备内存保温并保护排队请求，显式释放使旧队列失效；按模型切换时终止旧实例，隔离旧实例的迟到错误，并提供下载、状态、清除和文本翻译能力。
 * 模块边界：不读取配置、不访问宿主网页 DOM；模型目录由 core 配置模块维护，指定与自动语言码解析由 core 语言模块负责。
 */
import {withLocalInferenceBudget} from '@/src/shared/onnx/resources';
import {localModelIdleMs} from '@/src/shared/onnx/modelResidency';
import {
    LOCAL_TRANSLATION_MODELS,
    normalizeLocalTranslationModel,
    type LocalTranslationModelId,
} from '@/src/core/config/localTranslation';
import {resolveLocalTranslationLanguageCode} from '@/src/core/language/localTranslation';
import {createLocalTranslationDownloadManager} from './downloads';
import type {LocalTranslationDownloadSnapshot} from '@/src/core/config/localTranslation';

interface WorkerRequest {
    readonly requestId: number;
    readonly singleThread?: boolean;
    readonly type: 'prepare' | 'translate' | 'dispose';
    readonly model?: LocalTranslationModelId;
    readonly text?: string;
    readonly sourceLanguage?: string;
    readonly targetLanguage?: string;
}

interface WorkerResponse {
    readonly requestId: number;
    readonly retrySingleThread?: boolean;
    readonly success: boolean;
    readonly model?: string;
    readonly result?: string;
    readonly error?: string;
    readonly dtype?: string;
}

interface PendingWorkerRequest {
    readonly resolve: (response: WorkerResponse) => void;
    readonly reject: (error: unknown) => void;
    readonly timeout: number;
    readonly signal?: AbortSignal;
    readonly onAbort?: () => void;
}

export interface LocalTranslationRequest {
    readonly model?: unknown;
    readonly text: string;
    readonly sourceLanguage?: unknown;
    readonly targetLanguage?: unknown;
    readonly sourceLanguageDetectionText?: unknown;
}

const TRANSLATION_TIMEOUT_MS = 120_000;

let translationWorker: Worker | null = null;
let workerGeneration = 0;
let translationWorkerModel: LocalTranslationModelId | '' = '';
let workerRequestId = 0;
const pendingWorkerRequests = new Map<number, PendingWorkerRequest>();
let translationTaskQueue: Promise<void> = Promise.resolve();
let cancellationGeneration = 0;
let activeTranslations = 0;
let idleDisposeTimer: number | undefined;
let notifyDownloads: ((state: LocalTranslationDownloadSnapshot) => Promise<void>) | undefined;
const downloads = createLocalTranslationDownloadManager({
    onChange: (state) => notifyDownloads?.(state) || Promise.resolve(),
    beforeRemove: (model) => {
        if (translationWorkerModel === model) {
            clearIdleDispose();
            terminateWorker(new Error('LOCAL_TRANSLATION_MODEL_REMOVED'));
        }
    },
});

export function configureLocalTranslationDownloadNotifications(notify: (state: LocalTranslationDownloadSnapshot) => Promise<void>): void {
    notifyDownloads = notify;
}

function createAbortError(): Error {
    const error = new Error('本地翻译请求已取消');
    error.name = 'AbortError';
    return error;
}

function toError(value: unknown, fallback: string): Error {
    return value instanceof Error ? value : new Error(typeof value === 'string' ? value : fallback);
}

function clearIdleDispose(): void {
    if (idleDisposeTimer === undefined) return;
    window.clearTimeout(idleDisposeTimer);
    idleDisposeTimer = undefined;
}

function rejectPending(error: Error): void {
    const pending = [...pendingWorkerRequests.values()];
    pendingWorkerRequests.clear();
    pending.forEach((item) => {
        window.clearTimeout(item.timeout);
        if (item.signal && item.onAbort) item.signal.removeEventListener('abort', item.onAbort);
        item.reject(error);
    });
}

function terminateWorker(error?: Error): void {
    workerGeneration++;
    clearIdleDispose();
    const current = translationWorker;
    translationWorker = null;
    translationWorkerModel = '';
    current?.terminate();
    if (error) rejectPending(error);
}

function scheduleIdleDispose(): void {
    clearIdleDispose();
    if (!translationWorker || activeTranslations > 0) return;
    idleDisposeTimer = window.setTimeout(() => {
        idleDisposeTimer = undefined;
        if (pendingWorkerRequests.size === 0 && activeTranslations === 0) terminateWorker();
    }, localModelIdleMs());
}

function getWorker(): Worker {
    if (translationWorker) return translationWorker;
    const getUrl = (globalThis as typeof globalThis & {
        chrome?: {runtime?: {getURL?: (value: string) => string}};
    }).chrome?.runtime?.getURL;
    const workerUrl = getUrl?.('localTranslationWorker.js')
        || new URL('localTranslationWorker.js', window.location.href).toString();
    const worker = new Worker(workerUrl, {type: 'module'});
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        const pending = response && pendingWorkerRequests.get(response.requestId);
        if (!pending) return;
        pendingWorkerRequests.delete(response.requestId);
        window.clearTimeout(pending.timeout);
        if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort);
        if (response.success || response.retrySingleThread) pending.resolve(response);
        else pending.reject(new Error(response.error || '本地翻译 Worker 失败'));
    };
    worker.onerror = (event) => {
        if (translationWorker !== worker) return;
        terminateWorker(new Error(event.message || '本地翻译 Worker 已停止'));
    };
    translationWorker = worker;
    return worker;
}

function requestWorker(message: Omit<WorkerRequest, 'requestId'>, timeoutMs: number, signal?: AbortSignal): Promise<WorkerResponse> {
    clearIdleDispose();
    const generation = workerGeneration;
    const cancellation = cancellationGeneration;
    return withLocalInferenceBudget(async () => {
        if (generation !== workerGeneration) throw createAbortError();
        const deadline=Date.now()+timeoutMs;
        const response=await requestWorkerNow(message,timeoutMs,signal);
        if (cancellation !== cancellationGeneration || signal?.aborted) throw createAbortError();
        if (!response.retrySingleThread || message.singleThread || signal?.aborted) return response;
        terminateWorker();
        return requestWorkerNow({...message,singleThread:true},Math.max(1,deadline-Date.now()),signal);
    }, signal);
}

function requestWorkerNow(
    message: Omit<WorkerRequest, 'requestId'>,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<WorkerResponse> {
    clearIdleDispose();
    const requestedModel = normalizeLocalTranslationModel(message.model);
    if (translationWorker && translationWorkerModel && translationWorkerModel !== requestedModel) {
        terminateWorker(new Error('本地翻译模型已切换'));
    }

    const worker = getWorker();
    translationWorkerModel = requestedModel;
    const requestId = ++workerRequestId;
    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            terminateWorker(new Error(`本地翻译 Worker 超过 ${timeoutMs / 1000} 秒，已终止以保护浏览器性能`));
        }, timeoutMs);
        const onAbort = () => terminateWorker(createAbortError());
        const pending: PendingWorkerRequest = {resolve, reject, timeout, signal, onAbort};
        pendingWorkerRequests.set(requestId, pending);
        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener('abort', onAbort, {once: true});
        try {
            worker.postMessage({
                ...message,
                requestId,
                model: requestedModel,
            });
        } catch (error) {
            window.clearTimeout(timeout);
            if (signal) signal.removeEventListener('abort', onAbort);
            pendingWorkerRequests.delete(requestId);
            const workerError = toError(error, '无法启动本地翻译 Worker');
            terminateWorker(workerError);
            reject(workerError);
        }
    });
}

function modelResult(response: WorkerResponse, fallback: string): string {
    if (!response.success || typeof response.result !== 'string' || !response.result.trim()) {
        throw new Error(response.error || fallback);
    }
    return response.result;
}

export async function translateLocalText(
    request: LocalTranslationRequest,
    signal?: AbortSignal,
): Promise<string> {
    if (signal?.aborted) throw createAbortError();
    const generation = cancellationGeneration;
    activeTranslations++;
    clearIdleDispose();
    const run = async (): Promise<string> => {
        if (generation !== cancellationGeneration || signal?.aborted) throw createAbortError();
        if (typeof request.text !== 'string' || !request.text.trim()) return request.text || '';
        if (signal?.aborted) throw createAbortError();
        const model = normalizeLocalTranslationModel(request.model);
        const detectionText = typeof request.sourceLanguageDetectionText === 'string'
            && request.sourceLanguageDetectionText.trim() ? request.sourceLanguageDetectionText : request.text;
        const sourceLanguage = resolveLocalTranslationLanguageCode(model, request.sourceLanguage, detectionText);
        const targetLanguage = resolveLocalTranslationLanguageCode(model, request.targetLanguage);
        if (sourceLanguage === targetLanguage) return request.text;
        const state = await downloads.status();
        if (generation !== cancellationGeneration || signal?.aborted) throw createAbortError();
        if (state.tasks.find((task) => task.model === model)?.phase !== 'ready') {
            throw new Error('LOCAL_TRANSLATION_NOT_DOWNLOADED');
        }

        const response = await requestWorker({
            type: 'translate', model, text: request.text, sourceLanguage, targetLanguage,
        }, TRANSLATION_TIMEOUT_MS, signal);
        if (generation !== cancellationGeneration || signal?.aborted) throw createAbortError();
        return modelResult(response, '本地翻译未返回有效译文');
    };
    const task = translationTaskQueue.then(run, run);
    translationTaskQueue = task.then(() => undefined, () => undefined);
    try { return await task; }
    finally { activeTranslations--; scheduleIdleDispose(); }
}

export async function prepareLocalTranslationModel(modelValue: unknown): Promise<LocalTranslationDownloadSnapshot> {
    return downloads.start(modelValue);
}

export async function getLocalTranslationModelStatus(): Promise<{
    models: Array<{model: LocalTranslationModelId; downloaded: boolean; downloadSizeMb: number}>;
} & LocalTranslationDownloadSnapshot> {
    const state = await downloads.status();
    return {
        ...state,
        models: LOCAL_TRANSLATION_MODELS.map((item) => ({
            model: item.value,
            downloaded: state.tasks.some((task) => task.model === item.value && task.phase === 'ready'),
            downloadSizeMb: item.downloadSizeMb,
        })),
    };
}

export async function removeLocalTranslationModel(modelValue: unknown): Promise<void> {
    await downloads.remove(modelValue);
}

export async function pauseLocalTranslationModelDownload(modelValue: unknown): Promise<LocalTranslationDownloadSnapshot> {
    return downloads.pause(modelValue);
}

export function disposeLocalTranslationWorker(): void {
    cancellationGeneration++;
    clearIdleDispose();
    terminateWorker(createAbortError());
}

/**
 * @file src/features/local-tts/offscreen/modelCache.ts
 * 文件职责：下载、检查和清除 Kokoro 本地 TTS 模型及少量默认音色文件。
 * 主要内容：固定版本与文件清单，验证固定缓存及旧 main 别名来源；保留精确固定版本的历史镜像缓存而不再访问该旧下载源；仅显式准备时迁移已验证旧别名，合并真实字节进度并管理下载与清除互斥。
 * 模块边界：只负责缓存文件，不初始化推理 Worker，不决定朗读策略，也不访问网页。
 */

import {isModelCacheSource, withModelDownload} from '@/src/platform/http/modelDownloads';
import {
    createDownloadProgressTracker,
    type DownloadFileProgress,
    type DownloadProgress,
} from '@/src/core/download/progress';

import {
    LOCAL_TTS_MODEL,
    LOCAL_TTS_MODEL_CACHE_NAME,
    LOCAL_TTS_MODEL_ID,
    LOCAL_TTS_MODEL_REPOSITORY,
    LOCAL_TTS_MODEL_REVISION,
    LOCAL_TTS_MODEL_STATE_KEY,
    LOCAL_TTS_VOICE_CACHE_NAME,
    LOCAL_TTS_VOICE_PATH,
    type LocalTtsVoiceId,
} from '@/src/core/config/localTts';

export const LOCAL_TTS_MODEL_REMOTE_HOST = 'https://huggingface.co/' as const;

/** @remarks fp32 模型的实际推理只需要这组文件；README 和其他量化版本不进入缓存。 */
export const LOCAL_TTS_MODEL_FILES = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model.onnx',
] as const;

/** 早期版本的缓存文件只在显式清除时处理，避免升级检查误删用户资源。 */
export const LOCAL_TTS_LEGACY_MODEL_FILES = [
    'onnx/model_q4f16.onnx',
] as const;

export const LOCAL_TTS_VOICES: readonly LocalTtsVoiceId[] = [
    'zf_001',
    'zm_009',
    'af_maple',
    'bf_vale',
];

const MODEL_FILE_DOWNLOAD_TIMEOUT_MS = 300_000;
const pendingDownloads = new Map<string, Promise<void>>();
let removingFiles = false;

function usableCachedResponse(response: Response | undefined, sourceUrl: string, allowUnmarked: boolean): boolean {
    if (!response?.ok) return false;
    const source = response.headers.get('X-FluentRead-Model-Source');
    return (source !== null && isModelCacheSource(sourceUrl, source)) || (allowUnmarked && source === null);
}

export function getLocalTtsModelFileUrl(file: string): string {
    return `${LOCAL_TTS_MODEL_REMOTE_HOST}${LOCAL_TTS_MODEL_REPOSITORY}/resolve/${LOCAL_TTS_MODEL_REVISION}/${file}`;
}

/** Transformers.js 默认用 main 作为 Cache Storage key；固定版本仍作为真实下载源。 */
export function getLocalTtsModelLoaderUrl(file: string): string {
    return `${LOCAL_TTS_MODEL_REMOTE_HOST}${LOCAL_TTS_MODEL_REPOSITORY}/resolve/main/${file}`;
}

export function getLocalTtsVoiceRemoteUrl(voice: LocalTtsVoiceId): string {
    return `${LOCAL_TTS_VOICE_PATH}/${voice}.bin`;
}

export function getLocalTtsVoiceCacheUrl(voice: LocalTtsVoiceId): string {
    return getLocalTtsVoiceRemoteUrl(voice);
}

async function fetchIntoCache(
    cache: Cache,
    sourceUrl: string,
    cacheUrls: readonly string[],
    progress: DownloadFileProgress,
): Promise<void> {
    const existing = await (async (): Promise<Response | undefined> => {
        for (const cacheUrl of cacheUrls) {
            const response = await cache.match(cacheUrl);
            if (usableCachedResponse(response, sourceUrl, cacheUrl === sourceUrl)) return response;
        }
        return undefined;
    })();
    if (existing) {
        progress.cached(Number(existing.headers.get('Content-Length')));
        // 显式准备才迁移已验证旧 main 副本；状态查询不改变文件缓存。
        if (!usableCachedResponse(await cache.match(sourceUrl), sourceUrl, true)) {
            await cache.put(sourceUrl, existing.clone());
        }
        for (const cacheUrl of cacheUrls) {
            if (cacheUrl !== sourceUrl && usableCachedResponse(await cache.match(cacheUrl), sourceUrl, false)) {
                await cache.delete(cacheUrl);
            }
        }
        return;
    }
    await withModelDownload(sourceUrl, async (response, source) => {
        const headers = new Headers(response.headers);
        headers.set('X-FluentRead-Model-Source', source);
        await cache.put(sourceUrl, new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        }));
    }, {timeoutMs: MODEL_FILE_DOWNLOAD_TIMEOUT_MS, onProgress: progress.advance});
    progress.complete();
}

async function cacheLocalTtsModelNow(onProgress?: (progress: DownloadProgress) => void): Promise<void> {
    if (typeof caches === 'undefined') throw new Error('当前浏览器不支持本地 TTS 模型缓存');
    // 模型权重占绝大部分体积；各文件的真实大小在开始接收后才知道，此前按声明的下载体积计算。
    const tracker = createDownloadProgressTracker(
        LOCAL_TTS_MODEL_FILES.length + LOCAL_TTS_VOICES.length,
        LOCAL_TTS_MODEL.downloadSizeMb * 1_000_000,
        progress => onProgress?.(progress),
    );
    const cache = await caches.open(LOCAL_TTS_MODEL_CACHE_NAME);
    for (const file of LOCAL_TTS_MODEL_FILES) {
        const pinnedUrl = getLocalTtsModelFileUrl(file);
        await fetchIntoCache(cache, pinnedUrl, [pinnedUrl, getLocalTtsModelLoaderUrl(file)], tracker.file());
    }

    const voiceCache = await caches.open(LOCAL_TTS_VOICE_CACHE_NAME);
    for (const voice of LOCAL_TTS_VOICES) {
        await fetchIntoCache(voiceCache, getLocalTtsVoiceRemoteUrl(voice), [getLocalTtsVoiceCacheUrl(voice)], tracker.file());
    }
}

/** 对同一版本的并发下载只保留一个网络任务；进度由首个发起者的回调统一发布。 */
export function cacheLocalTtsModelFiles(onProgress?: (progress: DownloadProgress) => void): Promise<void> {
    if (removingFiles) return Promise.reject(new Error('正在清除本地 TTS 模型，请稍后重试'));
    const existing = pendingDownloads.get(LOCAL_TTS_MODEL_ID);
    if (existing) return existing;
    const pending = cacheLocalTtsModelNow(onProgress).finally(() => {
        if (pendingDownloads.get(LOCAL_TTS_MODEL_ID) === pending) pendingDownloads.delete(LOCAL_TTS_MODEL_ID);
    });
    pendingDownloads.set(LOCAL_TTS_MODEL_ID, pending);
    return pending;
}

export async function isLocalTtsModelCached(): Promise<boolean> {
    if (typeof caches === 'undefined' || removingFiles) return false;
    const modelCache = await caches.open(LOCAL_TTS_MODEL_CACHE_NAME);
    const voiceCache = await caches.open(LOCAL_TTS_VOICE_CACHE_NAME);
    const modelFiles = await Promise.all(LOCAL_TTS_MODEL_FILES.map(async (file) => {
        const pinnedUrl = getLocalTtsModelFileUrl(file);
        const loaderUrl = getLocalTtsModelLoaderUrl(file);
        const pinned = await modelCache.match(pinnedUrl);
        const loader = await modelCache.match(loaderUrl);
        return usableCachedResponse(pinned, pinnedUrl, true) || usableCachedResponse(loader, pinnedUrl, false);
    }));
    const voiceFiles = await Promise.all(LOCAL_TTS_VOICES.map(async (voice) => {
        const url = getLocalTtsVoiceCacheUrl(voice);
        return usableCachedResponse(await voiceCache.match(url), url, true);
    }));
    return modelFiles.every(Boolean) && voiceFiles.every(Boolean);
}

export async function removeLocalTtsModelFiles(): Promise<void> {
    if (typeof caches === 'undefined') throw new Error('当前浏览器不支持本地 TTS 模型缓存');
    if (pendingDownloads.size) throw new Error('本地 TTS 模型正在下载，请完成后再清除模型');
    if (removingFiles) throw new Error('正在清除本地 TTS 模型，请稍后重试');
    removingFiles = true;
    try {
        const modelCache = await caches.open(LOCAL_TTS_MODEL_CACHE_NAME);
        const voiceCache = await caches.open(LOCAL_TTS_VOICE_CACHE_NAME);
        const removableModelFiles = [...LOCAL_TTS_MODEL_FILES, ...LOCAL_TTS_LEGACY_MODEL_FILES];
        const deletions = await Promise.allSettled([
            ...removableModelFiles.flatMap((file) => [
                modelCache.delete(getLocalTtsModelFileUrl(file)),
                modelCache.delete(getLocalTtsModelLoaderUrl(file)),
            ]),
            ...LOCAL_TTS_VOICES.map((voice) => voiceCache.delete(getLocalTtsVoiceCacheUrl(voice))),
        ]);
        const failed = deletions.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
    } finally {
        removingFiles = false;
    }
}

export {LOCAL_TTS_MODEL_STATE_KEY};

/**
 * @file src/features/video-subtitle/offscreen/modelCache.ts
 * 文件职责：维护 Transformers.js Whisper 模型文件的远程地址、q4/q8 清单与 Cache Storage 下载。
 * 主要内容：只读缓存键核对已登记模型的完整七文件精度清单；按模型选择 Tiny/Base 的 q4/q8 或 Small 的 FP32 编码器加 q4 解码器，流式接收并在国内源、官方与镜像间有界回退，限制单文件大小、下载与断流等待，把完整文件清单合并成真实字节进度；下载失败展示统一重试提示，将来源诊断保留在错误原因中。
 * 模块边界：只处理模型文件缓存，不创建 Worker、不初始化 ONNX session，也不参与后台 owner 生命周期。
 */
import {withModelDownload, type ModelSourcePreference} from '@/src/platform/http/modelDownloads';
import {createDownloadProgressTracker, type DownloadProgress} from '@/src/core/download/progress';
import {
  getVideoLocalTranscriptionDownloadBytes,
  getVideoLocalTranscriptionModelId,
  normalizeVideoLocalTranscriptionModel,
  normalizeVideoLocalTranscriptionModels,
  VIDEO_LOCAL_TRANSCRIPTION_MODELS,
  type VideoLocalTranscriptionModel,
} from '@/src/features/video-subtitle/transcription';

export const VIDEO_AI_MODEL_REMOTE_HOST = 'https://modelscope.cn/models/';
export const VIDEO_AI_MODEL_REVISION = 'master';
export const VIDEO_AI_MODEL_REMOTE_PATH_TEMPLATE = '{model}/resolve/{revision}/';

// Transformers.js 的 Tiny/Base Whisper q4 pipeline 实际读取这 7 个文件。固定清单既能
// 避免设置页为了“下载”而初始化 ONNX session，也不会把整个仓库无关文件
// 拉进浏览器。模型推理仍由 transcription.worker.ts 独立完成。
export const VIDEO_AI_Q4_MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_q4.onnx',
  'onnx/decoder_model_merged_q4.onnx',
] as const;
export const VIDEO_AI_Q8_MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
] as const;
/** Small 编码器保留 FP32；完整预下载与实际 Worker 必须使用同一份混合精度清单。 */
export const VIDEO_AI_SMALL_MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged_q4.onnx',
] as const;

const TRANSFORMERS_CACHE_NAME = 'transformers-cache';
const MODEL_FILE_DOWNLOAD_TIMEOUT_MS = 120_000;

export function getVideoAiModelFileUrl(model: unknown, file: string): string {
  const modelId = getVideoLocalTranscriptionModelId(normalizeVideoLocalTranscriptionModel(model));
  return `${VIDEO_AI_MODEL_REMOTE_HOST}${modelId}/resolve/${VIDEO_AI_MODEL_REVISION}/${file}`;
}

/**
 * 下载登记只代表过去成功；可用状态还需同一精度清单的全部精确缓存键。
 * Tiny/Base 保留实际 Worker 支持的完整 q4 或 q8，Small 仅 FP32 encoder/q4 decoder。
 * 后台可直接读取同扩展 origin 的 Request 元数据，不读取模型响应体、
 * 不创建缺失缓存，也不删除登记或 q8 回退文件，避免与进行中的下载竞态。
 */
export async function readCachedVideoAiModels(receipts: unknown): Promise<VideoLocalTranscriptionModel[]> {
  const models = normalizeVideoLocalTranscriptionModels(receipts);
  if (!models.length) return [];
  if (typeof caches === 'undefined') throw new Error('当前浏览器不支持本地模型缓存');
  try {
    if (!await caches.has(TRANSFORMERS_CACHE_NAME)) return [];
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    const urls = new Set((await cache.keys()).map(request => request.url));
    return models.filter(model => {
      const complete = (files: readonly string[]) => files.every(file => urls.has(getVideoAiModelFileUrl(model, file)));
      return complete(model === 'small' ? VIDEO_AI_SMALL_MODEL_FILES : VIDEO_AI_Q4_MODEL_FILES)
        || model !== 'small' && complete(VIDEO_AI_Q8_MODEL_FILES);
    });
  } catch (error) {
    throw new Error('无法读取模型缓存，请重试', {cause: error});
  }
}

/**
 * 顺序下载并写入 Transformers.js 使用的同一个 Cache Storage。cache.put 会
 * 直接消费 Response，不在 JS 堆中再构造一份几十 MB 的 ONNX ArrayBuffer。
 */
export async function cacheVideoAiModelFiles(
  model: unknown,
  dtype: 'q4' | 'q8' = 'q4',
  onProgress?: (progress: DownloadProgress) => void,
  options: {preference?: ModelSourcePreference} = {},
): Promise<void> {
  const normalizedModel = normalizeVideoLocalTranscriptionModel(model);
  if (normalizedModel === 'small' && dtype === 'q8') throw new Error('Small 模型只支持 FP32 编码器与 q4 解码器');
  if (typeof caches === 'undefined') throw new Error('当前浏览器不支持本地模型缓存');
  const cache = await caches.open(TRANSFORMERS_CACHE_NAME);

  const files = normalizedModel === 'small' ? VIDEO_AI_SMALL_MODEL_FILES
    : dtype === 'q8' ? VIDEO_AI_Q8_MODEL_FILES : VIDEO_AI_Q4_MODEL_FILES;
  // 界面体积按各模型的默认清单统计；q8 回退没有预计总量，各文件报出大小后才给百分比。
  const tracker = createDownloadProgressTracker(
    files.length,
    dtype === 'q4' ? getVideoLocalTranscriptionDownloadBytes(model) : 0,
    progress => onProgress?.(progress),
  );
  // 所有模型允许慢速持续接收，但全部来源与文件共用十分钟总准备预算。
  const controller = new AbortController();
  const totalTimeout = setTimeout(() => controller.abort(), 600_000);
  try {
    for (const file of files) {
      const url = getVideoAiModelFileUrl(model, file);
      const progress = tracker.file();
      const cached = await cache.match(url);
      if (cached) {
        progress.cached(Number(cached.headers.get('Content-Length')));
        continue;
      }

      await withModelDownload(url, response => cache.put(url, response), {
        timeoutMs: normalizedModel === 'small' ? 300_000 : MODEL_FILE_DOWNLOAD_TIMEOUT_MS,
        maxBytes: (normalizedModel === 'small' && file === 'onnx/encoder_model.onnx' ? 384 : 256) * 1024 * 1024,
        signal: controller.signal,
        onProgress: progress.advance,
        onSourceStatus: tracker.transfer,
        preference: options.preference,
      });
      progress.complete();
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('模型下载超过总等待时限', {cause: error});
    throw new Error('模型下载失败，请检查网络后重试', {cause: error});
  } finally {
    clearTimeout(totalTimeout);
  }
}

export function cacheVideoAiQ4ModelFiles(model: unknown, onProgress?: (progress: DownloadProgress) => void, options?: {preference?: ModelSourcePreference}): Promise<void> {
  return cacheVideoAiModelFiles(model, 'q4', onProgress, options);
}

export function cacheVideoAiQ8ModelFiles(model: unknown, onProgress?: (progress: DownloadProgress) => void, options?: {preference?: ModelSourcePreference}): Promise<void> {
  return cacheVideoAiModelFiles(model, 'q8', onProgress, options);
}

/** 只清除指定 Whisper 模型的缓存文件，保留其他模型及字幕结果。 */
export async function removeVideoAiModelFiles(model: unknown): Promise<void> {
  if (!VIDEO_LOCAL_TRANSCRIPTION_MODELS.some(item => item.value === model)) throw new Error('无效的本地字幕模型');
  const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
  const prefix = getVideoAiModelFileUrl(model, '');
  for (const request of await cache.keys()) {
    if (request.url.startsWith(prefix)) await cache.delete(request);
  }
}

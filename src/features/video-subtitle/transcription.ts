/**
 * @file src/features/video-subtitle/transcription.ts
 * 文件职责：定义本地 Whisper 模型选项与音频转换的公共契约，统一界面和识别端使用的默认值。
 * 主要内容：规范化模型配置、实际语言与分模块精度诊断，统一生成停止、Worker 墙钟终止和请求预算，给出预计下载体积，拦截异常重复，把多声道 PCM 混音重采样并保守移除外侧数字静音。
 * 模块边界：只处理传入数据，不读取配置仓库、不调用浏览器音频设备，也不下载或初始化模型。
 */

export const VIDEO_LOCAL_TRANSCRIPTION_MODELS = [
  {
    value: 'tiny',
    label: 'Whisper Tiny（轻量模型）',
    modelId: 'onnx-community/whisper-tiny',
    // q4 下载清单共约 98.5 MB，向上取整；不代表运行内存占用。
    downloadSizeMb: 100,
    description: '识别速度较快、内存占用较低，适合快速生成字幕。',
  },
  {
    value: 'base',
    label: 'Whisper Base（标准模型）',
    modelId: 'onnx-community/whisper-base',
    // q4 下载清单共约 145.6 MB，向上取整。
    downloadSizeMb: 150,
    description: '侧重识别质量，所需内存更多、处理时间更长。',
  },
  {
    value: 'small',
    label: 'Whisper Small（质量模型）',
    modelId: 'onnx-community/whisper-small',
    // FP32 encoder + q4 decoder 下载清单共约 588.7 MB；不代表运行内存占用。
    downloadSizeMb: 590,
    description: '推荐用于多语种字幕，识别质量更高，下载、内存和处理开销更大。',
  },
] as const;

export type VideoLocalTranscriptionModel = typeof VIDEO_LOCAL_TRANSCRIPTION_MODELS[number]['value'];
export type VideoAiModelDtype = 'fp32' | 'q4' | 'q8';

/** 实际模型调用的诊断；语言 token 概率不能解释为字幕准确率。 */
export interface VideoAiRecognitionMetadata {
  detectedLanguage?: string;
  languageConfidence?: number;
  languageDetectionMs?: number;
  encoderReuse?: boolean;
  encoderDtype?: VideoAiModelDtype;
  decoderDtype?: VideoAiModelDtype;
}

/** 消息边界只保留真实、有限的诊断值；缺失字段不补造检测结果。 */
export function normalizeVideoAiRecognitionMetadata(value: unknown): VideoAiRecognitionMetadata {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>;
  const result: VideoAiRecognitionMetadata = {};
  if (typeof input.detectedLanguage === 'string' && /^[a-z]{2,3}$/u.test(input.detectedLanguage)) {
    result.detectedLanguage = input.detectedLanguage;
    if (typeof input.languageConfidence === 'number' && Number.isFinite(input.languageConfidence)
      && input.languageConfidence >= 0 && input.languageConfidence <= 1) {
      result.languageConfidence = input.languageConfidence;
    }
  }
  if (typeof input.languageDetectionMs === 'number' && Number.isFinite(input.languageDetectionMs)
    && input.languageDetectionMs >= 0) result.languageDetectionMs = input.languageDetectionMs;
  if (typeof input.encoderReuse === 'boolean') result.encoderReuse = input.encoderReuse;
  if (input.encoderDtype === 'fp32' || input.encoderDtype === 'q4' || input.encoderDtype === 'q8') result.encoderDtype = input.encoderDtype;
  if (input.decoderDtype === 'fp32' || input.decoderDtype === 'q4' || input.decoderDtype === 'q8') result.decoderDtype = input.decoderDtype;
  return result;
}

/**
 * 只记录“模型所需文件已经完整写入浏览器缓存”的状态；真正的 ONNX
 * session 在用户播放并请求字幕时才创建，避免设置页下载模型就长期占用
 * 数百 MB 到 GB 内存。状态用于在 X 播放器里给出清晰的操作引导。
 */
export const VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY = 'fluentReadVideoLocalTranscriptionModels';
export const VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE = 'fluentReadGetLocalVideoModelState' as const;

export function normalizeVideoLocalTranscriptionModels(value: unknown): VideoLocalTranscriptionModel[] {
  if (!Array.isArray(value)) return [];
  const supported = new Set(VIDEO_LOCAL_TRANSCRIPTION_MODELS.map((item) => item.value));
  return [...new Set(value.filter((model): model is VideoLocalTranscriptionModel =>
    typeof model === 'string' && supported.has(model as VideoLocalTranscriptionModel)))];
}

export function normalizeVideoLocalTranscriptionModel(value: unknown): VideoLocalTranscriptionModel {
  return VIDEO_LOCAL_TRANSCRIPTION_MODELS.some((item) => item.value === value)
    ? value as VideoLocalTranscriptionModel
    : 'small';
}

/**
 * 缺失或非法配置默认使用多语种质量更好的 Small；用户已选的有效模型继续保留。
 */
export const VIDEO_LOCAL_TRANSCRIPTION_RECOMMENDED_MODEL: VideoLocalTranscriptionModel = 'small';

export function getVideoLocalTranscriptionModelId(value: unknown): string {
  const model = normalizeVideoLocalTranscriptionModel(value);
  return VIDEO_LOCAL_TRANSCRIPTION_MODELS.find((item) => item.value === model)!.modelId;
}

/** 下载进度在各文件报出真实大小之前，以界面标注的模型体积作为预计总量。 */
export function getVideoLocalTranscriptionDownloadBytes(value: unknown): number {
  const model = normalizeVideoLocalTranscriptionModel(value);
  return VIDEO_LOCAL_TRANSCRIPTION_MODELS.find((item) => item.value === model)!.downloadSizeMb * 1_000_000;
}

/** 生成循环的协作停止上限；实际墙钟终止由独立的 Offscreen Worker owner 执行。 */
export function getVideoLocalTranscriptionInferenceTimeoutMs(value: unknown): number {
  return normalizeVideoLocalTranscriptionModel(value) === 'small' ? 60_000 : 15_000;
}

/** Worker 请求含自动语言检测；首轮分配一半预算，超时后由 owner 终止线程。 */
export function getVideoLocalTranscriptionWorkerTimeoutMs(value: unknown): number {
  return normalizeVideoLocalTranscriptionModel(value) === 'small' ? 180_000 : 32_000;
}

/** 外层消息请求的最终墙钟预算；留出 Worker 调度和失败恢复的余量。 */
export function getVideoLocalTranscriptionRequestTimeoutMs(value: unknown): number {
  return normalizeVideoLocalTranscriptionModel(value) === 'small' ? 200_000 : 40_000;
}

/** 拒绝解码循环产生的长串重复字/短语；正常叠词、强调和短句重复仍可保留。 */
export function isDegenerateVideoTranscript(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const compact = value.replace(/<\|[^|]+\|>/gu, '').replace(/[\s\p{P}\p{S}]/gu, '');
  // 元音/重音等附着标记属于同一个书写字符，不能让带标记的循环绕过保护。
  if (/([\p{L}\p{N}]\p{M}*)\1{15,}/u.test(compact)) return true;
  const repeated = compact.match(/([\p{L}\p{N}\p{M}]{2,24})\1{5,}/u);
  return Boolean(repeated && repeated[0].length >= 48);
}

export interface WhisperAudioWindow {
  audio: Float32Array;
  /** 裁剪后的首采样在原窗口中的位置；识别时间戳必须加回这个偏移。 */
  offsetMs: number;
  sourceDurationMs: number;
}

/** PCM16 一个量化步长内的采样仅视为数字静音；采集门与 Worker 输入共用此契约。 */
export const WHISPER_DIGITAL_SILENCE_PEAK = 1 / 32_768;

/**
 * 只处理接近一个 PCM16 量化步长的数字静音，不把音乐、底噪或轻声当成
 * 无语音。保留 160 ms 外侧余量，且仅裁剪至少 600 ms 的静音边缘；
 * 不压缩句子间的停顿。静音窗直接返回空输入，避免模型编造片尾字幕。
 */
export function prepareWhisperAudioWindow(audio: Float32Array): WhisperAudioWindow {
  const frameSamples = 320;
  const contextSamples = 160 * 16;
  const minimumSilenceSamples = 600 * 16;
  let firstActive = -1;
  let lastActiveEnd = 0;
  let hasInvalidSample = false;
  for (let start = 0; start < audio.length; start += frameSamples) {
    const end = Math.min(audio.length, start + frameSamples);
    let active = false;
    for (let index = start; index < end; index += 1) {
      const sample = audio[index];
      if (!Number.isFinite(sample)) hasInvalidSample = true;
      else if (Math.abs(sample) > WHISPER_DIGITAL_SILENCE_PEAK) active = true;
    }
    if (!active) continue;
    if (firstActive < 0) firstActive = start;
    lastActiveEnd = end;
  }
  const sourceDurationMs = audio.length / 16;
  if (firstActive < 0) return {audio: new Float32Array(), offsetMs: 0, sourceDurationMs};
  const start = firstActive >= minimumSilenceSamples ? Math.max(0, firstActive - contextSamples) : 0;
  const end = audio.length - lastActiveEnd >= minimumSilenceSamples
    ? Math.min(audio.length, lastActiveEnd + contextSamples)
    : audio.length;
  let prepared = audio.subarray(start, end);
  if (hasInvalidSample) prepared = prepared.map(sample => Number.isFinite(sample) ? sample : 0);
  return {audio: prepared, offsetMs: start / 16, sourceDurationMs};
}

/** 将解码后的多声道音频重采样为 Whisper 使用的单声道 PCM。 */
export function resampleToWhisperAudio(
  channels: readonly Float32Array[],
  sourceSampleRate: number,
  targetSampleRate = 16_000,
): Float32Array {
  const channelCount = channels.length;
  const sourceLength = channels.reduce((longest, channel) => Math.max(longest, channel.length), 0);
  if (channelCount === 0 || sourceLength === 0) return new Float32Array();

  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0 || sourceSampleRate === targetSampleRate) {
    if (channelCount === 1 && channels[0].length === sourceLength) return channels[0].slice();
    const mono = new Float32Array(sourceLength);
    for (let index = 0; index < sourceLength; index += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] || 0;
      mono[index] = sample / channelCount;
    }
    return mono;
  }

  const outputLength = Math.max(1, Math.round(sourceLength * targetSampleRate / sourceSampleRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceSampleRate / targetSampleRate;
  for (let index = 0; index < output.length; index += 1) {
    const sourcePosition = index * ratio;
    const leftIndex = Math.min(Math.floor(sourcePosition), sourceLength - 1);
    const rightIndex = Math.min(leftIndex + 1, sourceLength - 1);
    const fraction = sourcePosition - leftIndex;
    let leftSample = 0;
    let rightSample = 0;
    for (const channel of channels) {
      leftSample += channel[leftIndex] || 0;
      rightSample += channel[rightIndex] || 0;
    }
    leftSample /= channelCount;
    rightSample /= channelCount;
    output[index] = leftSample + (rightSample - leftSample) * fraction;
  }
  return output;
}

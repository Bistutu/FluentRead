/**
 * @file src/features/video-subtitle/workerProtocol.ts
 * 文件职责：定义视频 Whisper Worker 与离屏拥有者共用的请求、回复及边界校验。
 * 主要内容：关联正整数请求身份、模型和 PCM 载荷，校验成功结果与 CPU 重试提示，复用公共推理 DTO 并保守清洗可选诊断。
 * 模块边界：只处理传入消息，不创建 Worker、不加载模型、不拥有字幕或资源生命周期；旧 dispose 控制消息保持独立无回复语义。
 */
import {isVideoPreparationResult, isVideoTranscriptionResult, type VideoTranscriptionModel, type VideoTranscriptionResult} from '@/src/core/messaging/video';
import {isBoolean, isFiniteNumber, isMessageRecord, isPositiveSafeInteger, isString, oneOf, optional, parseMessage, shape, type Validator} from '@/src/core/messaging/validation';
import {normalizeVideoAiRecognitionMetadata} from './transcription';

export interface VideoWorkerRequest {
    requestId: number;
    type: 'prepare' | 'transcribe';
    model?: VideoTranscriptionModel;
    sourceLanguage?: string;
    languageSessionKey?: string;
    audio?: Float32Array;
    device?: 'wasm';
}
export interface VideoWorkerResponse extends Partial<VideoTranscriptionResult> {
    requestId: number;
    success: boolean;
    retryWithCpu?: boolean;
    error?: string;
}
const audio: Validator<Float32Array> = (value): value is Float32Array => value instanceof Float32Array;
const request = shape<VideoWorkerRequest>({
    requestId: isPositiveSafeInteger, type: oneOf('prepare', 'transcribe'), model: optional(oneOf('tiny', 'base', 'small')),
    sourceLanguage: optional(isString), languageSessionKey: optional(isString), audio: optional(audio), device: optional(oneOf('wasm')),
});
const envelope = shape<Pick<VideoWorkerResponse, 'requestId' | 'success' | 'retryWithCpu' | 'error'>>({
    requestId: isPositiveSafeInteger, success: isBoolean, retryWithCpu: optional(isBoolean), error: optional(isString),
});
export const isVideoWorkerDisposal = shape<{type: 'dispose'}>({type: oneOf('dispose')});

export function parseVideoWorkerRequest(value: unknown): VideoWorkerRequest {
    return parseMessage(value, request, '视频 Worker请求');
}

export function parseVideoWorkerResponse(value: unknown, operation: VideoWorkerRequest['type']): VideoWorkerResponse {
    if (!isMessageRecord(value)) throw new TypeError('视频 Worker响应消息格式无效');
    // 无效的语言/精度诊断不使有效字幕失败；先移除旧值，再附加既有规范化器接受的字段。
    const {detectedLanguage, languageConfidence, languageDetectionMs, encoderReuse, encoderDtype, decoderDtype,
        backend, gpuInfo, decodeMs, inferenceMs, audioDurationMs, threads, dtype, ...payload} = value;
    const finite = (item: unknown) => isFiniteNumber(item) && item >= 0 ? item : undefined;
    const result = {...payload,
        backend: backend === 'webgpu' || backend === 'wasm' ? backend : undefined,
        gpuInfo: typeof gpuInfo === 'string' ? gpuInfo : undefined,
        decodeMs: finite(decodeMs), inferenceMs: finite(inferenceMs), audioDurationMs: finite(audioDurationMs), threads: finite(threads),
        dtype: dtype === 'q4' || dtype === 'q8' ? dtype : undefined,
        ...normalizeVideoAiRecognitionMetadata({detectedLanguage, languageConfidence, languageDetectionMs, encoderReuse, encoderDtype, decoderDtype})};
    const response = parseMessage(result, envelope, '视频 Worker响应');
    if (!response.success) return response;
    if (operation === 'prepare') return {...response, ...parseMessage(result, isVideoPreparationResult, '视频 Worker准备响应')};
    return {...response, ...parseMessage(result, isVideoTranscriptionResult, '视频 Worker转写响应')};
}

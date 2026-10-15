/**
 * @file src/features/local-tts/protocol.ts
 * 文件职责：定义本地 TTS 跨后台、Offscreen 与其他 feature 共享的公开契约。
 * 主要内容：稳定错误码、合成音频结果，以及离屏拥有者和 Worker 共用的请求、回复与载荷校验；无效时间标记沿用既有规范化规则。
 * 模块边界：只包含可序列化数据和纯判定，不创建 Worker、不访问 Cache Storage；错误穿过 runtime 消息后只保留 code，
 * 调用方必须按错误码判断，不能依赖 instanceof。
 */

import {parseSpeechCues, type SpeechCue} from '@/src/core/tts/speechProgress';
import type {InferenceBackend} from '@/src/core/messaging/inference';
import {isBoolean, isFiniteNumber, isMessageRecord, isPositiveSafeInteger, isString, oneOf, optional, parseMessage, shape, type Validator} from '@/src/core/messaging/validation';

export const LOCAL_TTS_MODEL_NOT_DOWNLOADED_CODE = 'local-tts-model-not-downloaded' as const;
export const LOCAL_TTS_LANGUAGE_UNSUPPORTED_CODE = 'local-tts-language-unsupported' as const;

export class LocalTtsModelNotDownloadedError extends Error {
    readonly code = LOCAL_TTS_MODEL_NOT_DOWNLOADED_CODE;

    constructor() {
        super('本地 TTS 模型尚未下载，请先在设置中的朗读与语音里下载模型');
        this.name = 'LocalTtsModelNotDownloadedError';
    }
}

export class LocalTtsLanguageUnsupportedError extends Error {
    readonly code = LOCAL_TTS_LANGUAGE_UNSUPPORTED_CODE;

    constructor(language: string) {
        super(`本地 TTS 暂不支持语言：${language || '未知语言'}`);
        this.name = 'LocalTtsLanguageUnsupportedError';
    }
}


export interface LocalTtsAudio {
    readonly audio: ArrayBuffer;
    readonly timings?: SpeechCue[];
    readonly contentType: 'audio/wav';
    readonly voice: string;
    readonly backend?: InferenceBackend;
}

export interface LocalTtsWorkerRequest {
    requestId: number;
    type: 'prepare' | 'synthesize' | 'dispose';
    device?: 'wasm';
    text?: string;
    voice?: string;
    speed?: number;
}
export interface LocalTtsWorkerResponse extends Partial<Pick<LocalTtsAudio, 'audio' | 'timings' | 'backend'>> {
    requestId: number;
    success: boolean;
    samplingRate?: number;
    retryWithCpu?: boolean;
    error?: string;
}
const workerRequest = shape<LocalTtsWorkerRequest>({
    requestId: isPositiveSafeInteger, type: oneOf('prepare', 'synthesize', 'dispose'), device: optional(oneOf('wasm')),
    text: optional(isString), voice: optional(isString), speed: optional(isFiniteNumber),
});
const buffer: Validator<ArrayBuffer> = (value): value is ArrayBuffer => value instanceof ArrayBuffer;
// timings 单独交给既有规范化器产生类型安全的新数组；其余每个 DTO 字段仍由完整字段表检查。
const workerResponse = shape<Omit<LocalTtsWorkerResponse, 'timings'>>({
    requestId: isPositiveSafeInteger, success: isBoolean, audio: optional(buffer), samplingRate: optional(isFiniteNumber),
    backend: optional(oneOf('wasm', 'webgpu')), retryWithCpu: optional(isBoolean), error: optional(isString),
});
export function parseLocalTtsWorkerRequest(value: unknown): LocalTtsWorkerRequest {
    return parseMessage(value, workerRequest, '本地 TTS Worker请求');
}
export function parseLocalTtsWorkerResponse(value: unknown): LocalTtsWorkerResponse {
    const timings = isMessageRecord(value) ? value.timings : undefined;
    return {...parseMessage(value, workerResponse, '本地 TTS Worker响应'),
        ...(timings === undefined ? {} : {timings: parseSpeechCues(timings)})};
}

/** 读取本地错误类实例或 Offscreen 响应重建的普通 Error 上的稳定错误码。 */
export function localTtsErrorCode(error: unknown): string | undefined {
    return error && typeof error === 'object' && typeof (error as {code?: unknown}).code === 'string'
        ? (error as {code: string}).code
        : undefined;
}

/**
 * @file src/features/local-translation/workerProtocol.ts
 * 文件职责：定义本地翻译 Worker 与离屏拥有者共用的消息契约。
 * 主要内容：关联翻译或释放请求、模型及语言字段，验证成功译文、单线程重试提示和有限性能诊断。
 * 模块边界：只验证序列化边界，不初始化模型、不下载资源、不改变队列或取消状态；模型准备由下载管理器负责，不伪造 Worker prepare 操作。
 */
import {isLocalTranslationModel, type LocalTranslationModelId} from '@/src/core/config/localTranslation';
import type {InferenceBackend} from '@/src/core/messaging/inference';
import {isBoolean, isFiniteNumber, isNonEmptyString, isPositiveSafeInteger, isString, oneOf, optional, parseMessage, shape, type Validator} from '@/src/core/messaging/validation';

interface TranslationRequest {
    requestId: number;
    type: 'translate';
    model: LocalTranslationModelId;
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
    singleThread?: boolean;
}
interface DisposalRequest {requestId: number; type: 'dispose'; model?: LocalTranslationModelId; singleThread?: boolean}
export type LocalTranslationWorkerRequest = TranslationRequest | DisposalRequest;
export type LocalTranslationWorkerCommand = Omit<TranslationRequest, 'requestId'> | Omit<DisposalRequest, 'requestId'>;
export interface LocalTranslationWorkerResponse {
    requestId: number;
    success: boolean;
    model?: string;
    result?: string;
    error?: string;
    dtype?: string;
    backend?: InferenceBackend;
    elapsedMs?: number;
    retrySingleThread?: boolean;
}
const envelope = {requestId: isPositiveSafeInteger, singleThread: optional(isBoolean)};
const translation = shape<TranslationRequest>({...envelope, type: oneOf('translate'), model: isLocalTranslationModel,
    text: isNonEmptyString, sourceLanguage: isNonEmptyString, targetLanguage: isNonEmptyString});
const disposal = shape<DisposalRequest>({...envelope, type: oneOf('dispose'), model: optional(isLocalTranslationModel)});
const request: Validator<LocalTranslationWorkerRequest> = (value): value is LocalTranslationWorkerRequest => translation(value) || disposal(value);
const response = shape<LocalTranslationWorkerResponse>({
    requestId: isPositiveSafeInteger, success: isBoolean, model: optional(isString), result: optional(isString), error: optional(isString),
    dtype: optional(isString), backend: optional(oneOf('wasm', 'webgpu')), elapsedMs: optional(isFiniteNumber), retrySingleThread: optional(isBoolean),
});
export function parseLocalTranslationWorkerRequest(value: unknown): LocalTranslationWorkerRequest {
    return parseMessage(value, request, '本地翻译 Worker请求');
}
export function parseLocalTranslationWorkerResponse(value: unknown): LocalTranslationWorkerResponse {
    const result = parseMessage(value, response, '本地翻译 Worker响应');
    if (result.success && result.retrySingleThread) throw new TypeError('本地翻译 Worker响应不能同时成功并要求重试');
    return result;
}

/**
 * @file src/core/messaging/inference.ts
 * 文件职责：定义本地推理消息共用的成功、失败与后端标识契约。
 * 主要内容：集中可序列化的失败字段和判定器，让各能力组合自身成功结果而不复制错误形状。
 * 模块边界：仅包含纯类型和守卫，不认识具体模型、Worker、配置或平台 API。
 */
import {isString, oneOf, optional, shape, type Validator} from './validation';
export type InferenceBackend = 'webgpu' | 'wasm';
export interface InferenceFailure {success: false; error: string; errorCode?: string; requestId?: string}
export type InferenceSuccess<T extends object = object> = {success: true} & T;
export type InferenceResponse<T extends object = object> = InferenceSuccess<T> | InferenceFailure;

const failure = shape<InferenceFailure>({success: oneOf(false), error: isString, errorCode: optional(isString), requestId: optional(isString)});
export function inferenceResponse<T extends object>(validator: Validator<T>): Validator<InferenceResponse<T>> {
    const success = shape<{success: true}>({success: oneOf(true)});
    return (value): value is InferenceResponse<T> => failure(value) || (success(value) && validator(value));
}

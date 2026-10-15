/**
 * @file src/providers/translation/ai-sdk/errors.ts
 * 文件职责：识别真实 SDK 的 APICallError 和 RetryError，并转交共享 transport 错误归一层。
 * 主要内容：仅按 SDK 官方身份检测解包最后一次重试异常，原位重新导出同一 LlmTransportError 类与类型，保持现有调用方身份和诊断字段。
 * 模块边界：此模块是扩展和标准脚本的 SDK 适配出口；standalone 使用轻量 transport-errors，不引入 SDK 或 gateway。
 */
import {APICallError, RetryError} from 'ai';
import {normalizeLlmTransportError, type LlmTransportError} from './transport-errors';
export {LlmTransportError, type LlmTransportErrorOptions} from './transport-errors';

export function normalizeAiSdkError(
  service: string,
  error: unknown,
  apiKey?: string | readonly string[],
  callerAborted = false,
): LlmTransportError {
  const candidate = RetryError.isInstance(error) ? error.lastError : error;
  return normalizeLlmTransportError(service, candidate, apiKey, callerAborted,
    APICallError.isInstance(candidate) ? candidate : undefined);
}

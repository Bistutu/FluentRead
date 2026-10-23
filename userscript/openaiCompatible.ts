/**
 * @file userscript/openaiCompatible.ts
 * 文件职责：为普通与 standalone 脚本选择 FluentRead 自有的非流式 OpenAI 兼容执行端口。
 * 主要内容：复用完整共享请求准备、响应归一、用量、租约与预算；保留 provider registry 既有入口名称和类型。
 * 模块边界：只在直接安装脚本的构建精确别名接入，不替换 SDK API；扩展与 Greasy Fork 继续使用原 SDK。
 */
import {translateOpenAICompatible, type AiSdkTranslationRequest} from '@/src/providers/translation/ai-sdk/openai-transport';
import {standaloneOpenAIExecution} from '@/src/providers/translation/ai-sdk/openai-http';
export {AI_SDK_MAX_RETRIES, AI_SDK_REQUEST_TIMEOUT_MS, type AiSdkTranslationRequest} from '@/src/providers/translation/ai-sdk/openai-transport';

export function translateWithOpenAICompatibleAiSdk(request: AiSdkTranslationRequest): Promise<string | string[]> {
  return translateOpenAICompatible(request, standaloneOpenAIExecution);
}

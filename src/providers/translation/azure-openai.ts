/**
 * @file src/providers/translation/azure-openai.ts
 *
 * 文件职责：适配 Azure 翻译服务，校验凭据后复用支持 v1 与旧部署端点的 OpenAI 兼容 AI SDK transport。
 * 主要内容：从请求快照读取 service 和 token，执行 API Key 必需性判断，并将消息交给 translateWithOpenAICompatibleAiSdk 统一验证端点与最终请求中的部署名称。可核对的公开符号包括 default:azureOpenai。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {isApiKeyRequired} from "@/src/core/config/validation";
import {translateWithOpenAICompatibleAiSdk} from './ai-sdk/openai-compatible';
import {requireTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';
import type {TranslationProviderRequest} from '@/src/services/translation/types';

async function azureOpenai(message: TranslationProviderRequest) {
    const current = requireTranslationProviderConfig(message);
    const service = message.serviceOverride || current.service;
    const apiKey = current.token[service];
    if ((!apiKey || apiKey.trim() === '') && isApiKeyRequired(service, current)) {
        throw new Error('Azure API Key 未配置，请在设置中输入有效的 API Key');
    }

    return translateWithOpenAICompatibleAiSdk({...message, serviceOverride: service});
}

export default azureOpenai;

/**
 * @file src/providers/translation/doubao.ts
 *
 * 文件职责：按当前生效的模型把字节豆包（火山方舟）翻译请求分流到对应协议，避免翻译专用模型被发往它并不支持的 chat/completions。
 * 主要内容：从请求快照解析实际模型编号，命中 Doubao-Seed-Translation 系列时调用 Responses API 适配器，其余模型继续走共享的 OpenAI 兼容 AI SDK transport。 可核对的公开符号包括 default:doubao。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {services} from '@/src/core/config/catalog';
import {isDoubaoSeedTranslationModel} from '@/src/core/config/doubaoSeedTranslation';
import {currentConfiguredModel} from '@/src/services/translation/templates';
import {requireTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';
import type {TranslationProviderRequest} from '@/src/services/translation/types';
import {translateWithOpenAICompatibleAiSdk} from './ai-sdk/openai-compatible';
import doubaoSeedTranslation from './doubao-seed-translation';

async function doubao(
    message: TranslationProviderRequest<string | string[]>,
): Promise<string | string[]> {
    const current = requireTranslationProviderConfig(message);
    const service = message.serviceOverride || services.doubao;
    const model = currentConfiguredModel(current, service, message.modelOverride);

    return isDoubaoSeedTranslationModel(model)
        ? doubaoSeedTranslation(message)
        : translateWithOpenAICompatibleAiSdk(message);
}

export default doubao;

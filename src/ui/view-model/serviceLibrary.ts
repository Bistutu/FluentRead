/**
 * @file src/ui/view-model/serviceLibrary.ts
 * 文件职责：识别翻译服务是否存在用户保存的配置，避免把预置模型误认为用户已配置。
 * 主要内容：识别用户保存的凭据、端点、模型及自定义服务；组合即使因成员删除变空，也作为已保存配置保留以便修复。
 * 模块边界：只返回服务 ID ，不输出凭据、不检测连接、不写入配置或调整默认服务。
 */
import { Config } from '@/src/core/config/model'
import { defaultModels, services, servicesType } from '@/src/core/config/catalog'
import { getCustomOpenAIProvider, isCustomOpenAIProviderId } from '@/src/core/config/customOpenAI'
import { getCompositeTranslationProvider, isCompositeTranslationProviderId } from '@/src/core/config/compositeTranslation'
import { getApiKeyRequirementKey } from '@/src/core/config/validation'

const defaults = new Config()

/** 已保存只表示存在用户配置，不能据此推断凭据有效或连接正常。 */
export function hasSavedServiceConfiguration(service: string, config: Config): boolean {
  if (isCompositeTranslationProviderId(service)) return Boolean(getCompositeTranslationProvider(config.compositeTranslationProviders, service))
  if (isCustomOpenAIProviderId(service)) return Boolean(getCustomOpenAIProvider(config.customOpenAIProviders, service))
  if ([config.token[service], config.secret[service], config.proxy[service], config.customBody[service],
    config.customHeaders[service], config.customModel[service]].some(value => Boolean(value?.trim()))) return true
  if (config.customModels[service]?.length) return true
  if (config.model[service] && config.model[service] !== defaultModels.get(service)) return true
  if (config.requireApiKey[getApiKeyRequirementKey(service, config)] === false) return true
  if (servicesType.isTencent(service)) return Boolean(config.tencentSecretId.trim() || config.tencentSecretKey.trim())
  if (service === services.youdao) return Boolean(config.youdaoAppKey.trim() || config.youdaoAppSecret.trim())
  if (service === services.azureOpenai) return Boolean(config.azureOpenaiEndpoint.trim())
  if (service === services.newapi) return config.newApiUrl !== defaults.newApiUrl && Boolean(config.newApiUrl.trim())
  return false
}

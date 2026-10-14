/**
 * @file src/core/config/modelEditing.ts
 * 文件职责：统一扩展与精简脚本的自定义模型删除规则，维护网页、文档和模型附属配置的一致性。
 * 主要内容：删除指定模型，按剩余自定义或内置模型恢复选择，同时清理密钥要求、思考偏好与请求限制；只修改调用方明确提供的配置草稿。
 * 模块边界：本文件属于纯配置领域，不访问 Vue、全局配置、存储或浏览器，不决定 UI 确认与持久化。
 */
import type {Config} from './model';
import {customModelString} from './catalog';
import {getCustomOpenAIProvider, normalizeCustomOpenAIProviders} from './customOpenAI';
import {createApiKeyRequirementKey, getLegacyApiKeyRequirementKey} from './validation';
import {withoutModelThinkingPreference} from './modelThinking';
import {withoutModelRequestLimit} from './requestLimits';

export function removeConfiguredModel(config: Config, service: string, model: string, fallbackBuiltIn: string): void {
    const provider = getCustomOpenAIProvider(config.customOpenAIProviders, service);
    if (provider) {
        const remaining = provider.models.filter(item => item !== model);
        config.customOpenAIProviders = normalizeCustomOpenAIProviders(config.customOpenAIProviders.map(item =>
            item.id === service ? {...item, models: remaining} : item,
        ));
        for (const mapping of [config.model, config.documentModel]) {
            if (mapping[service] !== model) continue;
            if (remaining.length) mapping[service] = remaining[0];
            else delete mapping[service];
        }
    } else {
        const remaining = (config.customModels[service] || []).filter(item => item !== model);
        if (remaining.length) config.customModels[service] = remaining;
        else delete config.customModels[service];
        for (const [mapping, custom] of [[config.model, config.customModel], [config.documentModel, config.documentCustomModel]]) {
            if (custom[service] !== model) continue;
            if (mapping[service] !== customModelString) delete custom[service];
            else if (remaining.length) {
                custom[service] = remaining[0];
                mapping[service] = customModelString;
            } else {
                delete custom[service];
                mapping[service] = fallbackBuiltIn;
            }
        }
    }
    delete config.requireApiKey[createApiKeyRequirementKey(service, model)];
    delete config.requireApiKey[getLegacyApiKeyRequirementKey(service, model)];
    config.modelThinking = withoutModelThinkingPreference(config.modelThinking, service, model);
    config.modelRequestLimits = withoutModelRequestLimit(config.modelRequestLimits, service, model);
}

/**
 * @file src/core/config/requestModel.ts
 *
 * 文件职责：统一解析翻译请求最终使用的模型身份，让设置页的当前模型限额与后台调度使用同一模型编号。
 * 主要内容：兼容自定义模型、旧模型编号和展示后缀；读取合法自定义请求体中的静态 model 或腾讯 Model 覆盖，保留 Gemini 的 URL 模型规则及请求体中模板字符串的字面语义。
 * 模块边界：本文件属于 core 配置领域层，只处理配置与纯模型规则，不读取存储、不生成原文提示词、不启动 provider 或调度器；设置页与翻译服务分别消费同一解析结果。
 */

import {currentModelIds, customModelString, services, servicesType} from './catalog';
import {parseCustomBody} from './customBody';
import {migrateModelIdentifier} from './model';

export interface TranslationRequestModelConfig {
    readonly model: Readonly<Record<string, string>>;
    readonly customModel: Readonly<Record<string, string>>;
    readonly customBody?: Readonly<Record<string, string>>;
}

export function resolveTranslationRequestModel(
    current: TranslationRequestModelConfig,
    service: string,
    modelOverride?: string,
    isAiSdk: (service: string) => boolean = servicesType.isAiSdk,
    isAI: (service: string) => boolean = servicesType.isAI,
): string {
    const configured = current.model[service] === customModelString
        ? current.customModel[service] || ''
        : current.model[service] || '';
    let selected: string;
    if (service === services.gemini) {
        selected = modelOverride || configured;
    } else {
        selected = modelOverride?.trim()
            ? migrateModelIdentifier(service, modelOverride)
            : current.model[service] === customModelString ? configured : migrateModelIdentifier(service, configured);
        if (service === services.deepseek || isAiSdk(service)) selected = selected.replace(/（.*）/g, '');
        if (service === services.deepseek && (selected === 'deepseek-chat' || selected === 'deepseek-reasoner')) {
            selected = currentModelIds.deepseek;
        }
    }
    selected = selected.trim();
    if (!isAI(service) || service === services.gemini || service === services.chatgptPlan) return selected;
    const body = parseCustomBody(current.customBody?.[service]);
    const requestedModel = service === services.huanYuanTranslation ? body?.Model : body?.model;
    // 请求体不会替换 model 中的 {{变量}}；与传输层一致把非空字符串作为模型字面值。
    return typeof requestedModel === 'string' && requestedModel.trim() ? requestedModel.trim() : selected;
}

import { customModelString, options, services, servicesType } from './option';

export interface CredentialConfig {
    token?: Record<string, string | undefined>;
    model?: Record<string, string | undefined>;
    customModel?: Record<string, string | undefined>;
    requireApiKey?: Record<string, boolean | undefined>;
    youdaoAppKey?: string;
    youdaoAppSecret?: string;
    tencentSecretId?: string;
    tencentSecretKey?: string;
}

function getServiceLabel(service: string): string {
    return options.services.find((item) => item.value === service)?.label || service;
}

/** 使用服务和实际模型共同定位开关，避免切换模型时误用另一模型的设置。 */
export function getApiKeyRequirementKey(service: string, config: CredentialConfig): string {
    const selectedModel = config.model?.[service] || '';
    const actualModel = selectedModel === customModelString
        ? config.customModel?.[service] || selectedModel
        : selectedModel;
    return `${service}:${actualModel}`;
}

export function isApiKeyRequired(service: string, config: CredentialConfig): boolean {
    if (!servicesType.isAI(service)) return true;
    return config.requireApiKey?.[getApiKeyRequirementKey(service, config)] !== false;
}

/** 返回设置页和翻译前校验共用的凭据提示；返回 null 表示当前服务不缺凭据。 */
export function getMissingCredentialMessage(
    service: string,
    config: CredentialConfig,
): string | null {
    const serviceLabel = getServiceLabel(service);

    if (servicesType.isUseToken(service) && service !== services.deeplx && isApiKeyRequired(service, config)) {
        if (!config.token?.[service]?.trim()) {
            return `${serviceLabel} 需要 API Key（访问令牌），当前尚未配置；请先在设置中填写，再开始翻译。`;
        }
    }

    if (service === services.youdao
        && (!config.youdaoAppKey?.trim() || !config.youdaoAppSecret?.trim())) {
        return `${serviceLabel} 需要 App Key 和 App Secret，当前尚未完整配置；请先在设置中填写，再开始翻译。`;
    }

    if (service === services.tencent
        && (!config.tencentSecretId?.trim() || !config.tencentSecretKey?.trim())) {
        return `${serviceLabel} 需要 SecretId 和 SecretKey，当前尚未完整配置；请先在设置中填写，再开始翻译。`;
    }

    return null;
}

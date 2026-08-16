import { services, servicesType } from './option';

export interface CredentialConfig {
    token?: Record<string, string | undefined>;
    youdaoAppKey?: string;
    youdaoAppSecret?: string;
    tencentSecretId?: string;
    tencentSecretKey?: string;
}

/** 返回设置页和翻译前校验共用的凭据提示；返回 null 表示当前服务不缺凭据。 */
export function getMissingCredentialMessage(
    service: string,
    config: CredentialConfig,
): string | null {
    if (servicesType.isUseToken(service) && service !== services.deeplx) {
        if (!config.token?.[service]?.trim()) {
            return '该服务需要 API Key（访问令牌），当前尚未配置；翻译前请先填写。';
        }
    }

    if (service === services.youdao
        && (!config.youdaoAppKey?.trim() || !config.youdaoAppSecret?.trim())) {
        return '该服务需要 App Key 和 App Secret，当前尚未完整配置；翻译前请先填写。';
    }

    if (service === services.tencent
        && (!config.tencentSecretId?.trim() || !config.tencentSecretKey?.trim())) {
        return '该服务需要 SecretId 和 SecretKey，当前尚未完整配置；翻译前请先填写。';
    }

    return null;
}

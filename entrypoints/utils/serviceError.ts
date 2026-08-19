import {services} from './option';

export function getServiceErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 将供应商常见鉴权错误转换为可执行的设置提示，同时不暴露用户凭据。 */
export function formatServiceError(service: string, error: unknown): string {
    const message = getServiceErrorMessage(error).trim() || '未知错误';

    if (service === services.minimax && (message.includes('2049') || /invalid api key/i.test(message))) {
        return 'MiniMax API Key 无效（错误码 2049）。如果 Key 以 sk-cp- 开头，它是 Token Plan Key：请确认订阅仍有效，并选择与 Key 来源匹配的区域；中国版使用 api.minimaxi.com，全球版使用 api.minimax.io。Token Plan Key 与按量付费 API Key 不能互换。';
    }

    if (/failed to fetch|networkerror|网络错误|请求超时/i.test(message)) {
        return `网络连接失败：${message}`;
    }

    return message;
}

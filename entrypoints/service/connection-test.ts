import {_service} from './_service';
import {formatServiceError} from '@/entrypoints/utils/serviceError';

export const CONNECTION_TEST_ORIGIN = 'Hello from FluentRead.';

function isNonEmptyText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** 通过现有服务适配器发出真实的最小翻译请求，覆盖鉴权、端点、模型和响应解析。 */
export async function runTranslationServiceConnectionTest(service: string): Promise<{durationMs: number}> {
    const adapter = _service[service];
    if (!adapter) {
        throw new Error(`未找到翻译服务适配器: ${service}`);
    }

    const startedAt = Date.now();
    const result = await adapter({
        origin: CONNECTION_TEST_ORIGIN,
        context: '',
        pageContext: '',
        summaryPrompt: '',
        summarySystemPrompt: '',
        serviceOverride: service,
        useCache: false,
    });

    if (!isNonEmptyText(result)) {
        throw new Error('服务已响应，但没有返回有效译文');
    }

    return {durationMs: Math.max(0, Date.now() - startedAt)};
}

export function formatConnectionTestError(service: string, error: unknown): string {
    return formatServiceError(service, error);
}

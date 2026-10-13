/**
 * @file src/core/config/aiRequestTimeout.ts
 * 文件职责：定义所有 AI 翻译请求共用的默认等待时间和用户可调整范围。
 * 主要内容：默认等待 120 秒，允许 10 至 600 秒；仅接受有限数字毫秒，四舍五入为整数后限制范围，缺失或非法配置回到默认值。
 * 模块边界：只提供纯配置规则，不启动计时器、不发送请求、不持久化设置；请求链路和设置界面共用此处的规范化结果。
 */
export const DEFAULT_AI_REQUEST_TIMEOUT_MS = 120_000;
export const MIN_AI_REQUEST_TIMEOUT_MS = 10_000;
export const MAX_AI_REQUEST_TIMEOUT_MS = 600_000;

export function normalizeAiRequestTimeoutMs(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_AI_REQUEST_TIMEOUT_MS;
    return Math.min(MAX_AI_REQUEST_TIMEOUT_MS, Math.max(MIN_AI_REQUEST_TIMEOUT_MS, Math.round(value)));
}

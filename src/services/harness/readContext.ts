/**
 * @file src/services/harness/readContext.ts
 * 文件职责：定义阅读助手只读上下文工具的输入协议，确保不同运行环境采用相同的授权边界。
 * 主要内容：导出可发送给模型的 JSON Schema，并以独立校验函数拒绝额外字段、非对象值以及超过二百字符的读取理由。
 * 模块边界：仅验证工具参数，不读取网页、不执行工具，也不引入模式编译器；上下文读取与访问许可仍由阅读运行时判断。
 */
export const READ_CONTEXT_INPUT_SCHEMA = {
    type: 'object',
    properties: {reason: {type: 'string', maxLength: 200}},
    additionalProperties: false,
} as const;

/** Match the native strict schema without pulling a schema compiler into userscripts. */
export function isReadContextInput(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    if (value instanceof Date || value instanceof Map || value instanceof Set) return false;
    const input = value as {reason?: unknown; then?: unknown; catch?: unknown};
    if (typeof input.then === 'function' && typeof input.catch === 'function') return false;
    for (const key in input) if (key !== 'reason') return false;
    return input.reason === undefined || typeof input.reason === 'string' && input.reason.length <= 200;
}

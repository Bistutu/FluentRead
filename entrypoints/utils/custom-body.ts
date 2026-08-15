export type CustomBody = Record<string, unknown>;

// 留空表示不启用自定义请求体；非空值必须是 JSON 对象。
export function parseCustomBody(raw?: unknown): CustomBody | undefined {
    if (raw === undefined || raw === null || raw === '') return {};
    if (typeof raw !== 'string') return undefined;
    if (!raw.trim()) return {};

    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as CustomBody;
        }
    } catch {
        // 由调用方决定如何提示非法配置。
    }

    return undefined;
}

export function isValidCustomBody(raw?: unknown): boolean {
    return parseCustomBody(raw) !== undefined;
}

// 顶层浅合并，用户字段优先；返回新对象以避免修改原始 payload。
export function mergeCustomBody<T extends Record<string, unknown>>(payload: T, raw?: unknown): T {
    const customBody = parseCustomBody(raw);
    if (customBody === undefined) {
        console.warn('[FluentRead] 自定义请求体必须是合法的 JSON 对象，已忽略');
        return payload;
    }

    return {...payload, ...customBody};
}

export function isCustomBodyMapping(value: unknown): value is Record<string, string> {
    return value !== null
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.values(value).every(item => typeof item === 'string');
}

// 兼容旧配置以及存储中可能存在的异常值，只保留字符串配置项。
export function normalizeCustomBodyMapping(value: unknown): Record<string, string> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};

    return Object.fromEntries(
        Object.entries(value).filter(([, item]) => typeof item === 'string')
    ) as Record<string, string>;
}

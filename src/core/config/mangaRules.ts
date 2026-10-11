/**
 * @file src/core/config/mangaRules.ts
 * 文件职责：归一化持久漫画偏好与用户站点规则，供完整 Config 和漫画阅读器共享。
 * 主要内容：保留规则 URL/选择器校验、精确路径去重、二十项上限、提前翻译窗口与缓存张数边界。
 * 模块边界：不导入网站目录、正文适配或 UI，不请求图片，也不创建配置实例。
 */
export interface MangaSiteRule {hostname: string; pathPrefix: string; selector: string}

/** 旧配置默认提前三页；限制窗口，避免整章推理、内存和服务请求失控。 */
export function normalizeMangaPrefetchPages(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(5, Math.max(0, Math.floor(value))) : 3;
}

export function createMangaSiteRule(href: string, selector: string): MangaSiteRule | null {
    try {
        const url = new URL(href);
        const query = selector.trim();
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
            || !query || query.length > 256 || query.includes(':has(')) return null;
        return {hostname: url.hostname, pathPrefix: url.pathname, selector: query};
    } catch { return null; }
}

export function normalizeMangaSiteRules(value: unknown): MangaSiteRule[] {
    if (!Array.isArray(value)) return [];
    const result: MangaSiteRule[] = [];
    const seen = new Set<string>();
    for (const item of value.slice(0, 20)) {
        if (!item || typeof item !== 'object' || typeof item.hostname !== 'string'
            || typeof item.pathPrefix !== 'string' || !item.pathPrefix.startsWith('/')
            || typeof item.selector !== 'string') continue;
        const rule = createMangaSiteRule(`https://${item.hostname}${item.pathPrefix}`, item.selector);
        if (!rule || rule.hostname !== item.hostname || rule.pathPrefix !== item.pathPrefix) continue;
        const key = `${rule.hostname}${rule.pathPrefix}`;
        if (seen.has(key)) continue;
        seen.add(key); result.push(rule);
    }
    return result;
}

/** 正常页快速复用的容量；总像素预算另行约束超长、超大图片。 */
export function normalizeMangaCachePages(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(24, Math.floor(value))) : 12;
}

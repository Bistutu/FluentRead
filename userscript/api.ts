/**
 * 脚本管理器 API 边界。Tampermonkey/Via 常用 GM_*，Safari Userscripts
 * 把存储和请求放在异步 GM.* 命名空间；调用方只取实际存在的能力。
 */
export type UserscriptMethod = (...args: any[]) => any;

export function getUserscriptFunction(
    legacyName?: string,
    modernName?: string,
): UserscriptMethod | undefined {
    const legacy = legacyName ? (globalThis as Record<string, unknown>)[legacyName] : undefined;
    if (typeof legacy === 'function') return legacy as UserscriptMethod;

    // 有的脚本管理器将授权 API 注入为词法绑定，而非 window 属性。
    const modernNamespace = typeof GM === 'undefined' ? undefined : GM;
    const modern = modernName ? modernNamespace?.[modernName as keyof typeof modernNamespace] : undefined;
    return typeof modern === 'function'
        ? (modern as UserscriptMethod).bind(modernNamespace)
        : undefined;
}

/** 只读取管理器签发的隐私标记；不以网页 URL 或公开消息推断私密窗口。 */
export function isUserscriptPrivateContext(): boolean {
    const info = typeof GM_info !== 'undefined' ? GM_info : typeof GM !== 'undefined' ? GM?.info : undefined;
    return info?.isIncognito === true || info?.isPrivate === true;
}

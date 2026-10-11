/**
 * @file userscript/interfaceFontPreviews.ts
 * 文件职责：为油猴设置页的 Shadow DOM 注册随包字体预览。
 * 主要内容：仅解析内置 CSS 中 FluentRead Preview 的 400/700 WOFF2 data URL，以字节注册 FontFace；卸载后取消迟到注册并只删除本轮字体。
 * 模块边界：不请求网络、不注入宿主样式、不参与完整字体下载缓存；缺少字体 API 或字库失效时保留系统字体回退。
 */

export interface UserscriptInterfaceFontPreviewMount {
    ready: Promise<void>;
    dispose(): void;
}

function declaration(rule: string, name: string): string | undefined {
    // data URL 自带分号，只有后接 CSS 属性或规则结尾的分号才分隔声明。
    return new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([\\s\\S]*?)(?=;\\s*[-\\w]+\\s*:|;?\\s*$)`, 'i')
        .exec(rule)?.[1].trim();
}

/** 仅在设置页挂载时调用；字体实例属于返回句柄，不复用其他挂载的实例。 */
export function installUserscriptInterfaceFontPreviews(
    css = globalThis.__fluentReadUserscriptCss || '',
): UserscriptInterfaceFontPreviewMount {
    let disposed = false;
    const installed: FontFace[] = [];
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    const dispose = () => {
        disposed = true;
        for (const face of installed) {
            try { fonts?.delete(face); } catch { /* 旧内核清理失败不阻止设置页卸载。 */ }
        }
        installed.length = 0;
    };
    if (!fonts || typeof fonts.add !== 'function' || typeof fonts.delete !== 'function'
        || typeof FontFace !== 'function' || typeof atob !== 'function') {
        return {ready: Promise.resolve(), dispose};
    }

    const jobs: Promise<void>[] = [];
    const rules = /@font-face\s*\{([^}]+)\}/gi;
    let match: RegExpExecArray | null;
    while ((match = rules.exec(css))) {
        const rule = match[1];
        const family = declaration(rule, 'font-family')?.replace(/^(['"])(.*)\1$/, '$2');
        const weight = declaration(rule, 'font-weight');
        if (!family || !/^FluentRead Preview [A-Za-z0-9 ]+$/.test(family)
            || (weight !== '400' && weight !== '700')) continue;
        const source = declaration(rule, 'src')?.match(
            /^url\(\s*(?:'([^']+)'|"([^"]+)"|([^\s)]+))\s*\)\s*(?:format\(\s*(?:'woff2'|"woff2"|woff2)\s*\))?$/i,
        );
        const url = source && (source[1] || source[2] || source[3]);
        if (!url?.startsWith('data:font/woff2;base64,')) continue;
        const encoded = url.slice('data:font/woff2;base64,'.length);
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0
            || encoded.length > 700_000) continue;
        try {
            const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
            if (bytes.length < 4 || bytes[0] !== 0x77 || bytes[1] !== 0x4f
                || bytes[2] !== 0x46 || bytes[3] !== 0x32) continue;
            // BufferSource 避开宿主 CSP 对 data: 字体 URL 的拦截。
            const face = new FontFace(family, bytes, {weight, style: 'normal'});
            jobs.push((async () => {
                try {
                    await face.load();
                    if (disposed) return;
                    fonts.add(face);
                    installed.push(face);
                } catch { /* 单个预览失效时继续使用系统字体。 */ }
            })());
        } catch { /* 非法 base64 或不支持的 FontFace 构造参数保留系统回退。 */ }
    }
    return {ready: Promise.all(jobs).then(() => {}), dispose};
}

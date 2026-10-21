/**
 * @file src/features/full-page-translation/content/fontStyleRoots.ts
 * 文件职责：登记译文实际使用的样式树，让当前页临时字体覆盖同时到达文档、开放组件和自有闭合仅译文根。
 * 主要内容：通过弱引用保留可回放的根登记，向字体安装器同步交付既有及后续根，定期回收已卸载组件的登记。
 * 模块边界：只有渲染器登记真实译文根，不扫描宿主 DOM、不拦截 attachShadow、不创建 CSS，也不向调用方暴露闭合根的内容。
 */
export type TranslationFontStyleRoot = Document | ShadowRoot;

const roots = new Set<WeakRef<TranslationFontStyleRoot>>();
const knownRoots = new WeakSet<TranslationFontStyleRoot>();
const listeners = new Set<(root: TranslationFontStyleRoot) => void>();
let registrations = 0;

/** 接受 renderer 已拥有的真实根，闭合根只允许从自有仅译文槽显式登记。 */
export function prepareTranslationFontStyleRoot(root: TranslationFontStyleRoot): void {
    if (!knownRoots.has(root)) {
        knownRoots.add(root);
        roots.add(new WeakRef(root));
        if (++registrations % 64 === 0) {
            for (const reference of roots) if (!reference.deref()) roots.delete(reference);
        }
    }
    for (const listener of listeners) listener(root);
}

/** 回放已有弱登记，保证用户翻译完成后首次启用也能立即覆盖所有译文。 */
export function subscribeTranslationFontStyleRoots(listener: (root: TranslationFontStyleRoot) => void): () => void {
    listeners.add(listener);
    for (const reference of roots) {
        const root = reference.deref();
        if (root) listener(root);
        else roots.delete(reference);
    }
    return () => { listeners.delete(listener); };
}

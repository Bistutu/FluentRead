/**
 * @file src/app/content/pageTranslationFont.ts
 * 文件职责：为当前文档提供不持久化的浏览器默认译文字体开关，并立即同步已有及后续译文的独立样式树。
 * 主要内容：按 renderer 的弱根登记安装专属样式，以 CSS initial 恢复浏览器标准字族，覆盖内联 CJK 字体与全局译文外观；关闭、页面停用或离开时仅撤销自有样式。
 * 模块边界：不读取或写入配置、storage、原文或译文 DOM，不重新请求翻译、不扫描页面；运行时负责授权及生命周期，代码与公式子树继续使用自身字体。
 */
import {
    subscribeTranslationFontStyleRoots,
    releaseDocumentBilingualRenderingContainment,
    type TranslationFontStyleRoot,
} from '@/src/features/full-page-translation/content/public';

export const PAGE_TRANSLATION_FONT_STYLE_ID = 'fluent-read-page-translation-font';
const translated = ':is(.fluent-read-bilingual-content,.fluent-read-single-content)[data-fr-translation-owned="true"][data-fr-translation-owned="true"]';
const protectedFont = ':is(code,pre,kbd,samp,var,math,mjx-container,[class*="MathJax"],.katex,.mwe-math-element,.ltx_Math)';
// 直接指定后代，避免网页对子元素或字体预设单独设置的字族继续盖过浏览器标准字体。
export const PAGE_TRANSLATION_FONT_CSS = `${translated},\n${translated} *:not(${protectedFont},${protectedFont} *) { font-family: initial !important; }\n`;

export interface PageTranslationFontRuntime {
    read(): boolean;
    set(browserDefault: boolean): boolean;
    reset(): void;
    dispose(): void;
}

/** document 是唯一作用域；frame 组合根可在自己的授权桥中创建同一控制器。 */
export function createPageTranslationFontRuntime(options: {
    document: Document;
    onChange?(browserDefault: boolean): void;
}): PageTranslationFontRuntime {
    let browserDefault = false;
    let disposed = false;
    let installedRoots = 0;
    const styles = new Set<WeakRef<HTMLStyleElement>>();
    let rootStyles = new WeakMap<TranslationFontStyleRoot, HTMLStyleElement>();
    const install = (root: TranslationFontStyleRoot): void => {
        if (!browserDefault || disposed || (root !== options.document && root.ownerDocument !== options.document)) return;
        let style = rootStyles.get(root);
        if (!style) {
            style = options.document.createElement('style');
            style.id = PAGE_TRANSLATION_FONT_STYLE_ID;
            style.setAttribute('data-fr-translation-owned', 'true');
            style.textContent = PAGE_TRANSLATION_FONT_CSS;
            rootStyles.set(root, style);
            styles.add(new WeakRef(style));
            // 无限滚动可能持续卸载闭合译文槽；只周期检查弱引用，不扫描宿主页面。
            if (++installedRoots % 64 === 0) {
                for (const reference of styles) if (!reference.deref()) styles.delete(reference);
            }
        }
        const parent = root === options.document ? options.document.head ?? options.document.documentElement : root;
        if (style.parentNode !== parent) parent.appendChild(style);
    };
    const remove = (): void => {
        for (const reference of styles) reference.deref()?.remove();
        styles.clear();
        rootStyles = new WeakMap();
    };
    // 只在启用时订阅，既能回放旧根，也不会为常规翻译额外创建样式。
    let unsubscribe: (() => void) | undefined;
    const set = (value: boolean): boolean => {
        if (disposed) return false;
        if (browserDefault === value) return true;
        releaseDocumentBilingualRenderingContainment(options.document);
        browserDefault = value;
        if (value) {
            install(options.document);
            unsubscribe = subscribeTranslationFontStyleRoots(install);
        } else {
            unsubscribe?.(); unsubscribe = undefined;
            remove();
        }
        options.onChange?.(value);
        return true;
    };
    return {
        read: () => browserDefault,
        set,
        reset: () => { set(false); },
        dispose: () => {
            if (disposed) return;
            set(false);
            disposed = true;
        },
    };
}

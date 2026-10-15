/**
 * @file src/app/content/pageStyles.ts
 * 文件职责：为当前顶层文档或受支持邮件子页面安装公共翻译样式，并让用户的译文外观微调随页面样式一起生效与移除。
 * 主要内容：合并双语译文、页面状态和专属范围样式，让词书绘制复用已安装规则而无需再次使整页样式失效；复用唯一样式标识，按需为开放 ShadowRoot 安装同一份公共样式，以弱引用登记并同步外观，避免持有已卸载组件；
 * 移除函数退订并删除 document 和开放根内自己的样式，且绑定 WXT context 失效，供各内容组合根在停用、往返缓存暂停和卸载时清理。
 * 模块边界：仅绑定内联 CSS、配置订阅与文档生命周期，不发现候选、不挂载 UI，也不修改宿主样式表；外观 CSS 的生成与节点管理由 translationAppearance 负责。
 */
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import {config, subscribeConfig} from '@/src/services/config/store';
import translationDisplayStyles from '@/src/ui/styles/translation-display.css?inline';
import pageStyles from './page.css?inline';
import sentenceHighlightStyles from '@/src/ui/styles/bilingual-sentence-highlight.css?inline';
import reencounterStyles from '@/src/ui/styles/vocabulary-reencounter.css?inline';
import {syncTranslationAppearanceStyles} from './translationAppearance';
import {buildTranslationAppearanceCss} from '@/src/core/config/translationAppearance';
import {subscribeTranslationStyleRoots} from '@/src/features/full-page-translation/content/public';

export function installPageStyles(ctx: ContentScriptContext): () => void {
    const existing = document.getElementById('fluent-read-page-styles');
    if (existing) return () => undefined;
    const style = document.createElement('style');
    style.id = 'fluent-read-page-styles';
    style.textContent = `${translationDisplayStyles}\n${pageStyles}\n${sentenceHighlightStyles}\n${reencounterStyles}`;
    (document.head ?? document.documentElement).appendChild(style);
    // CSS 不穿过 ShadowRoot；只向实际翻译 owner 所在的开放根复制既有 fluent 专属规则。
    // WeakMap 和 WeakRef 都不延长根的生命周期，关闭时仍可枚举尚存的自有 style。
    let shadowStyles = new WeakMap<ShadowRoot, HTMLStyleElement>();
    const liveStyles = new Set<WeakRef<HTMLStyleElement>>();
    let appearanceCss = buildTranslationAppearanceCss(config.translationAppearance);
    let shadowCss = `${style.textContent}\n${appearanceCss}`;
    const unsubscribeRoots = subscribeTranslationStyleRoots(root => {
        if (root.ownerDocument !== style.ownerDocument) return;
        let shadowStyle = shadowStyles.get(root);
        if (!shadowStyle) {
            // 无限滚动会不断创建组件；即使用户没有修改外观，也回收死亡登记项。
            // 这里只读弱引用，不遍历宿主 DOM 或保留已卸载根。
            liveStyles.forEach(reference => {if (!reference.deref()) liveStyles.delete(reference);});
            shadowStyle = root.ownerDocument.createElement('style');
            shadowStyle.id = 'fluent-read-shadow-translation-styles';
            shadowStyle.setAttribute('data-fr-translation-owned', 'true');
            shadowStyles.set(root, shadowStyle);
            liveStyles.add(new WeakRef(shadowStyle));
        }
        if (shadowStyle.textContent !== shadowCss) shadowStyle.textContent = shadowCss;
        if (shadowStyle.parentNode !== root) root.appendChild(shadowStyle);
    });
    // 外观与页面样式同生共灭：配置变化时已显示和后续出现的译文一起更新，无需重新翻译。
    syncTranslationAppearanceStyles(document, config.translationAppearance);
    const unsubscribe = subscribeConfig((nextConfig) => {
        syncTranslationAppearanceStyles(document, nextConfig.translationAppearance);
        const nextAppearanceCss = buildTranslationAppearanceCss(nextConfig.translationAppearance);
        if (nextAppearanceCss === appearanceCss) return;
        appearanceCss = nextAppearanceCss;
        shadowCss = `${style.textContent}\n${appearanceCss}`;
        liveStyles.forEach(reference => {
            const shadowStyle = reference.deref();
            if (shadowStyle) shadowStyle.textContent = shadowCss;
            else liveStyles.delete(reference);
        });
    });
    let removed = false;
    let detachInvalidation: (() => void) | undefined;
    const remove = () => {
        if (removed) return;
        removed = true;
        detachInvalidation?.();
        detachInvalidation = undefined;
        unsubscribe();
        unsubscribeRoots();
        liveStyles.forEach(reference => reference.deref()?.remove());
        liveStyles.clear();
        shadowStyles = new WeakMap();
        style.remove();
        syncTranslationAppearanceStyles(document, null);
    };
    const detach = ctx.onInvalidated(remove);
    // WXT 返回撤销函数；脚本端旧适配器可返回 void，同步失效时也立即撤销。
    if (typeof detach === 'function') {
        if (removed) detach();
        else detachInvalidation = detach;
    }
    return remove;
}

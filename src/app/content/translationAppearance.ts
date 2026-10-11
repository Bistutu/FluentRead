/**
 * @file src/app/content/translationAppearance.ts
 * 文件职责：把用户的译文外观微调同步为当前文档中唯一的 FluentRead 样式节点，让已显示和后续出现的双语译文即时生效。
 * 主要内容：按 Document 幂等创建、更新或移除固定标识的 style 节点；规则实际变化前撤下本页译文的旧尺寸隔离，默认外观、页面功能停用或卸载时移除节点，不留下空规则。
 * 模块边界：只负责页面级样式接线；外观归一化与 CSS 文本来自 core/config/translationAppearance，调用时机由 content composition root 决定，
 * 译文渲染属性和可信快照交由全文翻译受控端口同步，不改写文字、类名或请求代次。
 */
import {buildTranslationAppearanceCss} from '@/src/core/config/translationAppearance';
import {releaseDocumentBilingualRenderingContainment} from '@/src/features/full-page-translation/content/public';

export const TRANSLATION_APPEARANCE_STYLE_ID = 'fluent-read-translation-appearance';

/** appearance 传 null 表示页面功能停用；默认外观同样移除节点，让预设保持原样。 */
export function syncTranslationAppearanceStyles(document: Document, appearance: unknown): void {
    const css = appearance === null ? '' : buildTranslationAppearanceCss(appearance);
    const existing = document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID);
    if ((existing?.textContent ?? '') !== css) releaseDocumentBilingualRenderingContainment(document);
    if (!css) {
        existing?.remove();
        return;
    }
    const style = existing ?? document.createElement('style');
    style.id = TRANSLATION_APPEARANCE_STYLE_ID;
    if (style.textContent !== css) style.textContent = css;
    if (!style.isConnected) (document.head ?? document.documentElement).appendChild(style);
}

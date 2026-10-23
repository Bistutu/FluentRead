/**
 * @file userscript/languageBundles.ts
 * 文件职责：构建 userscript 的中英内嵌词典并引用已发布的五种固定远程词典。
 * 主要内容：按脚本能力裁剪当前中英文案；远程资源直接使用固定提交中的原始 JSON，避免扩展文案增删后产生尚未发布的摘要。新增远程文案仍由 uiLanguageBundles 注册时补齐。
 * 发布兼容：扩展已删除的旧说明仅保留在五份已发布远程 JSON 中；中英内嵌词典使用当前扩展文案，不恢复退役说明。
 * 模块边界：只供构建期和资源验证使用；不将远程 JSON 打进脚本，不改扩展词典或运行时语言装载协议。
 */
import {UI_LANGUAGE_BUNDLES as extensionBundles} from '../src/core/i18n/bundles';
import {zhCNMessages as extensionChinese} from '../src/core/i18n/messages/zh-CN';
import {learningMaterialLegacyText, learningMaterialPatterns} from '../src/core/i18n/messages/learningMaterials';
import {mimoRetirementSource} from '../src/core/i18n/messages/mimoRetirement';
import type {UiLanguageBundle} from '../src/core/i18n/types';
import japanese from './languages/ja-JP.b81984c57e32c317.json';
import korean from './languages/ko-KR.f9dd4e317a3ccbac.json';
import french from './languages/fr-FR.fcc79905550b3705.json';
import russian from './languages/ru-RU.83347fe7c1e5f5da.json';
import spanish from './languages/es-ES.ccf366fbe218633c.json';

export function userscriptMessages<T extends Record<string, string>>(messages: T): T {
    return Object.fromEntries(Object.entries(messages).filter(([key]) => !key.startsWith('informationHighlight.')
        && !key.startsWith('contextMenu.notice.') && !key.startsWith('video.learning.')
        && !key.startsWith('video.readingAnnotation.')
        && key !== 'video.nativeFullscreenHint'
        && !key.startsWith('diagnostics.')
        && !['waitingTranslation', 'crossPageContext', 'fullPassage', 'closePassage'].some(name => key === `document.pdfReading.${name}`)
        && !key.startsWith('safari.freePool.')
        && !key.startsWith('popup.compact.') && !key.startsWith('popup.displayMode.') && !key.startsWith('popup.pageFont.') && !key.startsWith('document.config.')
        && !key.startsWith('document.translationRecovery.')
        && !key.startsWith('document.retainedRevisions.') && !key.startsWith('document.translationProgress.'))) as T;
}
export const zhCNMessages = userscriptMessages(extensionChinese);

const english = extensionBundles['en-US'];
const materialSources = new Set(Object.keys(learningMaterialLegacyText['en-US']));
const materialPatternSources = new Set(learningMaterialPatterns.map(({pattern}) => pattern));
const embeddedEnglish: UiLanguageBundle = {
    ...english,
    messages: userscriptMessages(english.messages),
    legacyText: Object.fromEntries(Object.entries(english.legacyText).filter(([source]) =>
        !materialSources.has(source) && source !== mimoRetirementSource && source !== '移动端 / X 自动贴底')),
    legacyPatterns: {
        early: english.legacyPatterns.early.filter(([source]) => !materialPatternSources.has(source)),
        late: english.legacyPatterns.late.filter(([source]) => !materialPatternSources.has(source)),
    },
};

// 五份 JSON 的内容摘要和固定提交由发布配置测试逐字节验证；更新远程词典需要一起发布资源和提交 pin。
export const UI_LANGUAGE_BUNDLES = {
    'en-US': embeddedEnglish,
    'ja-JP': japanese as unknown as UiLanguageBundle,
    'ko-KR': korean as unknown as UiLanguageBundle,
    'fr-FR': french as unknown as UiLanguageBundle,
    'ru-RU': russian as unknown as UiLanguageBundle,
    'es-ES': spanish as unknown as UiLanguageBundle,
};

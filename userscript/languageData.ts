/**
 * @file userscript/languageData.ts
 * 文件职责：无损编码脚本本地内嵌的英文语言数据，让新增多语文案继续满足既有单文件预算。
 * 主要内容：词典按有序键和值分列，模板按正则、译文和可选捕获组分列，减少 gzip 中不同语言文本交错的开销；解码恢复原字典和模板次序。旧对象资源直接通过，不改变固定远程 JSON 或 Greasy Fork DATA。
 * 模块边界：只转换静态数据表示，不执行模板、不加载完整词典、不压缩可执行逻辑。
 */
import type {LegacyPatternEntry, MessageCatalog, UiLanguageBundle} from '@/src/core/i18n/types';

type CatalogColumns = readonly [readonly string[], readonly string[]];
type PatternColumns = readonly [readonly string[], readonly string[], readonly (readonly number[] | null)[]];
type LanguageColumns = readonly [keys: CatalogColumns, texts: CatalogColumns, early: PatternColumns, late: PatternColumns];

/** 只供构建使用；按键排序使输出不受导入和对象展开次序影响。 */
export function packUiLanguageBundle(bundle: UiLanguageBundle): LanguageColumns {
    const catalog = (value: MessageCatalog): CatalogColumns => {
        const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1);
        return [entries.map(([key]) => key), entries.map(([, text]) => text)];
    };
    const patterns = (entries: readonly LegacyPatternEntry[]): PatternColumns => [
        entries.map(([source]) => source), entries.map(([, text]) => text), entries.map(([, , captures]) => captures ?? null),
    ];
    const messages = catalog(bundle.messages), legacy = catalog(bundle.legacyText);
    // 先集中资源键，再集中译文，使同一种文字在 gzip 窗口内相邻。
    return [[messages[0], legacy[0]], [messages[1], legacy[1]], patterns(bundle.legacyPatterns.early), patterns(bundle.legacyPatterns.late)];
}

/** 恢复本地分列资源；发布过的原始对象格式保持兼容。资源形状继续由加载器统一校验。 */
export function unpackUiLanguageBundle(value: UiLanguageBundle | LanguageColumns): UiLanguageBundle {
    if (!Array.isArray(value)) return value as UiLanguageBundle;
    const catalog = ([keys, texts]: CatalogColumns): MessageCatalog => Object.fromEntries(keys.map((key, index) => [key, texts[index]]));
    const patterns = ([sources, texts, captures]: PatternColumns): LegacyPatternEntry[] => sources.map((source, index) =>
        captures[index] === null ? [source, texts[index]] : [source, texts[index], captures[index]!]);
    return {messages: catalog([value[0][0], value[1][0]]), legacyText: catalog([value[0][1], value[1][1]]),
        legacyPatterns: {early: patterns(value[2]), late: patterns(value[3])}};
}

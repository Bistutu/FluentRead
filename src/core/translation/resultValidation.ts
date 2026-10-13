/**
 * @file src/core/translation/resultValidation.ts
 * 文件职责：识别翻译服务误返原文或明显错语种的响应，避免将其当成成功译文。
 * 主要内容：复用语言识别副本排除纯符号、数字和技术标识，仅在既有外语证据下识别标点边界或 U+200B 包装的原文回显，保留字词、大小写和符号差异，补足中文目标下短标签列表、运算符标签丢词或大小写回显和整段日文结果的保守判定；文档行内正文可在完整原句的既有外语证据下识别普通多词标签原样返回，专名和单词仍保持保守。
 * 模块边界：仅做保守的纯文本判定；不读取配置或缓存、不请求服务，也不改写原文与译文。
 */
import {getChineseScript} from '@/src/core/language/chinese';
import {isLanguageCodeMatch} from '@/src/core/language/codes';
import {identifyTextLanguage} from '@/src/core/language/identify';
import {createLanguageDetectionCopy} from '@/src/core/language/technicalTokens';

/** 网址、版本、模型编号和纯符号保持原文；旁边有正文的整行仍参与翻译。 */
export function hasTranslatableText(text: string): boolean {
    return /\p{L}/u.test(createLanguageDetectionCopy(text).text);
}

function comparable(value: string): string {
    // 免费服务有时只把英文标题的冒号换成全角并删去后面的空格。
    return value.normalize('NFKC').replace(/\s*:\s*/gu, ':').replace(/\s+/gu, ' ').trim();
}

/** 标点只作为分词边界，不能把 a-b 与 ab 合并；U+200B 不改变字词内容。
 * 保留大小写、组合音标、运算符及可能改变字形的 ZWJ/ZWNJ，最终仍由原文的既有外语证据决定是否拒绝。
 */
function echoComparable(value: string): string {
    return value.normalize('NFKC').replace(/\u200b/gu, '')
        .replace(/(?:(?![-*/\\_%&#@:]|!(?=[\p{L}\p{N}_=!(])|\?(?=\s*[\p{L}\p{N}_?.=]))\p{P})+/gu, ' ')
        .replace(/\s+/gu, ' ').trim();
}

/** 标签列表缺少功能词，统计语言识别通常只能给出不可信的猜测。 */
function isLatinKeywordList(value: string): boolean {
    const tags = value.split(',');
    if (tags.length < 6) return false;
    let readableTags = 0;
    let words = 0;
    for (const tag of tags) {
        const trimmed = tag.trim();
        if (!/^[a-z][a-z_ ]{2,}$/u.test(trimmed)) continue;
        const parts = trimmed.match(/[a-z]{3,}/gu) ?? [];
        if (parts.length === 0) continue;
        readableTags += 1;
        words += parts.length;
    }
    return readableTags >= 6 && words >= 6;
}

/** 职业标题常被语言检测视为不确定；只对明确的通用职位词判定原文回显。 */
function isLatinShortHeading(value: string): boolean {
    const words = value.trim().split(/\s+/u);
    return words.length === 2 && words.every(word => /^[A-Za-z][a-z]{3,}[.!?]?$/u.test(word))
        && /^(?:developer|engineer|designer|manager|analyst|architect|administrator|scientist|researcher|specialist|consultant|programmer|translator|editor|writer|teacher|student|operator|technician)$/iu.test(words[1]);
}

/** 两个首字母大写的词可能是人名、地名或品牌；不能因原样保留就使整段失败。 */
function isPossiblyProperName(value: string): boolean {
    const words = value.trim().split(/\s+/u);
    return words.length === 2 && words.every(word => /^[A-Z][a-z]{2,}$/u.test(word))
        && !isLatinShortHeading(value);
}

/** 运算符是普通可译概念；只补足完整标签及 code 前的开括号槽，不猜测任意英文短语。 */
function isLatinOperatorLabel(value: string): boolean {
    return /^(?:addition|subtraction|multiplication|division|remainder|(?:logical|bitwise) (?:not|and|or|xor))(?:\s+\(\s*\)?)?$/iu.test(value);
}

/** 拒绝外语正文及英文标题的原文回显；缩写、代码与部分专名保持保守判定。 */
export function isLikelyUntranslatedResponse(origin: string, result: string, targetLanguage: string): boolean {
    // 受保护的 inline code 不进入 provider 槽，标签经常以开括号结尾。
    // 中文目标下只剩括号或只改英文大小写不算完成，交由既有免费线路降级；
    // 不扩大 hasDistinctTranslation 的展示比较，也不把任意品牌当成漏译。
    const source = comparable(origin);
    const translated = comparable(result);
    if (getChineseScript(targetLanguage) && isLatinOperatorLabel(source) && hasTranslatableText(origin) && (
        source.toLowerCase() === translated.toLowerCase() || /^[\p{P}\p{S}\s]+$/u.test(translated)
    )) return true;
    if (!origin.trim() || (source !== translated && echoComparable(origin) !== echoComparable(result))) return false;
    if (!hasTranslatableText(origin)) return false;
    if (getChineseScript(targetLanguage) && isPossiblyProperName(origin)) return false;
    const identification = identifyTextLanguage(origin);
    if (identification.status === 'identified') {
        return !identification.languages.some(language => isLanguageCodeMatch(language, targetLanguage));
    }
    return Boolean(getChineseScript(targetLanguage)) && !/[\u3400-\u9fff]/u.test(result) && (
        isLatinKeywordList(origin) || isLatinShortHeading(origin) ||
        (createLanguageDetectionCopy(origin).text.match(/\b[a-z]{3,}\b/gu) ?? []).length >= 3
    );
}

/** 仅文档行内节点使用完整原句的真实外语证据，不改变其他入口的单段判定。 */
export function isLikelyUntranslatedInlineResponse(origin: string, result: string, targetLanguage: string, sourceContext: string): boolean {
    if (isLikelyUntranslatedResponse(origin, result, targetLanguage)) return true;
    // 短英文节点缺乏独立语言证据；中文目标和完整外语原句均明确时才补足，英文目标不误拒已是英文的标签。
    if (!getChineseScript(targetLanguage) || comparable(origin) !== comparable(result)
        || !isLikelyUntranslatedResponse(sourceContext, sourceContext, targetLanguage)) return false;
    const words = createLanguageDetectionCopy(origin).text.match(/\b[A-Za-z]{3,}\b/gu) ?? [];
    return words.length >= 2 && words.some(word => /^[a-z]+$/u.test(word))
        && words.slice(1).every(word => !/^[A-Z][a-z]/u.test(word));
}

/** 假名与汉字共同构成日文正文；少量日语名称、短引用和不确定的混合段落照常展示。 */
export function isClearlyWrongLanguageResponse(origin: string, result: string, targetLanguage: string): boolean {
    if (!origin.trim() || !result.trim() || !getChineseScript(targetLanguage)) return false;
    const kanaCount = (result.match(/[\p{Script=Hiragana}\p{Script=Katakana}ーｰ]/gu) ?? []).length;
    if (kanaCount < 16) return false;
    const hanCount = (result.match(/\p{Script=Han}/gu) ?? []).length;
    if (kanaCount * 2 < hanCount) return false;
    const identification = identifyTextLanguage(result);
    return identification.status === 'identified' && identification.languages.includes('ja');
}

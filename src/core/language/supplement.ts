/**
 * @file src/core/language/supplement.ts
 * 文件职责：为本地未知正文定义可补充语言证据的资格与采纳规则，防止平台检测掩盖混合语言、字形转换和技术原子。
 * 主要内容：仅接受最多一千零二十四字符的完整、单一统计文字长正文及其本地最佳猜测；按完整规范文本在内存复用一百二十八项资格结果，含未入选文本；排除引语但保留词内撇号，逐子句和重叠词窗检查其他语言反证；平台须明确可靠、全部非零占比均属于同一个规范语言且合计为百分之百，才可补充这一猜测。
 * 模块边界：本文件是纯算法，不访问浏览器、页面语言、配置、计时器或网络；不改变原文、手动源语言和目标语言，也不把平台占比解释为识别概率。
 */

import {normalizeDetectedLanguageCode} from './codes';
import {identifyTextLanguage, normalizeLanguageEvidenceText} from './identify';
import {STATISTICAL_SCRIPT_LANGUAGES, type StatisticalScript} from './lexicon';
import {segmentScriptWords} from './scripts';
import {assessStatisticalLanguage} from './statistical';
import {createLanguageDetectionCopy} from './technicalTokens';

const MIN_WORDS = 12;
const MIN_LETTERS = 80;
const MAX_TEXT_LENGTH = 1024;
const CANDIDATE_CACHE_LIMIT = 128;
const candidateCache = new Map<string, string | undefined>();
const WINDOW_WORDS = 8;
const WINDOW_STEP = 4;
const SCRIPTS = new Set(['Latin', 'Cyrillic', 'Arabic', 'Devanagari']);
const CLAUSE_BOUNDARY = /[.!?;:。！？；：\n\u061F\u061B\u06D4\u0964\u0965]/u;
// 成对引语可能包含需要翻译的短外语；don't、don’t 等词内撇号不构成引语。
const SINGLE_QUOTED_TEXT = /(?<![\p{L}\p{M}\p{N}])(?:'[\s\S]*?'|‘[\s\S]*?’)(?![\p{L}\p{M}\p{N}])/u;

/** 返回可由独立平台证据确认的本地猜测；未入选的未知文本继续翻译。 */
export function getSupplementalLanguageCandidate(text: string): string | undefined {
    const value = normalizeLanguageEvidenceText(text);
    // 超限文本始终保留翻译机会，也不让大 key 占用资格缓存。
    if (value.length > MAX_TEXT_LENGTH) return undefined;
    if (candidateCache.has(value)) {
        const cached = candidateCache.get(value);
        candidateCache.delete(value);
        candidateCache.set(value, cached);
        return cached;
    }
    const candidate = evaluateSupplementalCandidate(value);
    candidateCache.set(value, candidate);
    if (candidateCache.size > CANDIDATE_CACHE_LIMIT) candidateCache.delete(candidateCache.keys().next().value!);
    return candidate;
}

/** 缓存缺失时检查完整原文，不截断尾部或放宽任何反证。 */
function evaluateSupplementalCandidate(value: string): string | undefined {
    if (/["“”«»「」『』\uFFFC\uFFFD]/u.test(value) || SINGLE_QUOTED_TEXT.test(value)) return undefined;
    const local = identifyTextLanguage(value);
    if (local.status !== 'unknown' || !local.bestGuess) return undefined;
    const copy = createLanguageDetectionCopy(value);
    if (copy.identifiers || copy.versionedNames) return undefined;
    const words = segmentScriptWords(copy.text);
    const script = words[0]?.script;
    if (!script || !SCRIPTS.has(script) || words.some(word => word.script !== script)) return undefined;
    if (words.length < MIN_WORDS || words.reduce((sum, word) => sum + word.letters, 0) < MIN_LETTERS) return undefined;
    const language = normalizeDetectedLanguageCode(local.bestGuess);
    const statisticalScript = script as StatisticalScript;
    if (!STATISTICAL_SCRIPT_LANGUAGES[statisticalScript].includes(language)) return undefined;

    const conflicts = (assessment: ReturnType<typeof assessStatisticalLanguage>): boolean => {
        const evidence = assessment.language ?? assessment.functionWordLeader;
        return evidence !== undefined && evidence !== language;
    };
    // 不把已被正字法或功能词反证否决的猜测重新提升为可信。
    const whole = assessStatisticalLanguage(statisticalScript, words.map(word => word.text));
    if (whole.reason === 'orthography' || conflicts(whole)) return undefined;
    for (const clause of copy.text.split(CLAUSE_BOUNDARY)) {
        if (conflicts(assessStatisticalLanguage(statisticalScript, segmentScriptWords(clause).map(word => word.text)))) return undefined;
    }
    // 同一长句里的外语也有否决机会，不依赖网页是否用了句号或正确语言标签。
    for (let start = 0; start < words.length; start += WINDOW_STEP) {
        if (conflicts(assessStatisticalLanguage(statisticalScript, words.slice(start, start + WINDOW_WORDS).map(word => word.text)))) return undefined;
    }
    return language;
}

/** 严格验证不可信平台返回值，只输出与本地候选一致的规范语言。 */
export function acceptSupplementalLanguage(candidate: string, result: unknown): string | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const evidence = result as {isReliable?: unknown; languages?: unknown};
    if (evidence.isReliable !== true || !Array.isArray(evidence.languages) || evidence.languages.length === 0) return undefined;
    let total = 0;
    for (const item of evidence.languages) {
        if (!item || typeof item !== 'object') return undefined;
        const {language, percentage} = item as {language?: unknown; percentage?: unknown};
        if (typeof percentage !== 'number' || !Number.isInteger(percentage) || percentage < 0 || percentage > 100) return undefined;
        if (percentage > 0 && normalizeDetectedLanguageCode(language as string) !== candidate) return undefined;
        total += percentage;
    }
    return total === 100 ? candidate : undefined;
}

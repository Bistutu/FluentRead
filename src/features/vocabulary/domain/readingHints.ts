/**
 * @file src/features/vocabulary/domain/readingHints.ts
 * 文件职责：从主动收藏中生成渐进阅读可以安全消费的表达坐标和掌握提示快照。
 * 主要内容：复用完整表达匹配并限制为 24 次命中，只提供请求目标语言已有译文；跨源语言的同一规范表达视为歧义，仅无此歧义且最新时间的学习日志均为手动掌握并对应当前学习状态时认可明确掌握，仅规范化后的相同原文认可同一保存语境。
 * 模块边界：不访问存储、网页或模型，不新增义项、不改写掌握度；后台负责读取已命中收藏的日志，消费方必须保留主动请求帮助的入口。
 */
import {isVocabularySentence, type VocabularyEntry, type VocabularyReviewLog} from '../learningModel';
import type {VocabularyReadingHint} from '../protocol';
import {createExpressionIndex, matchExpressions} from './expressionMatcher';

export const VOCABULARY_READING_HINT_MAX_MATCHES = 24;
export interface VocabularyReadingHintMatch {entry: VocabularyEntry; start: number; end: number; ambiguous: boolean}

/** 只匹配完整收藏表达，保留最长不重叠匹配及精确原文坐标。 */
export function matchVocabularyReadingHints(text: string, entries: readonly VocabularyEntry[]): VocabularyReadingHintMatch[] {
    const expressions = entries.filter(entry => !isVocabularySentence(entry));
    const byId = new Map(expressions.map(entry => [entry.id, entry]));
    const languages = new Map<string, Set<string>>();
    for (const entry of expressions) {
        const sources = languages.get(entry.normalizedTerm) ?? new Set<string>();
        sources.add(entry.sourceLanguage); languages.set(entry.normalizedTerm, sources);
    }
    return matchExpressions(text, createExpressionIndex(expressions), VOCABULARY_READING_HINT_MAX_MATCHES)
        .map(match => {
            const entry = byId.get(match.entryId)!;
            return {entry, start: match.start, end: match.end, ambiguous: languages.get(entry.normalizedTerm)!.size > 1};
        });
}

const comparableContext = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

/** 掌握和相同语境是独立证据；熟词的新语境不能因词面相同自动隐藏。 */
export function vocabularyReadingHintSnapshot(
    text: string,
    targetLanguage: string,
    match: VocabularyReadingHintMatch,
    logs: readonly VocabularyReviewLog[],
): VocabularyReadingHint {
    const {entry, start, end, ambiguous} = match;
    // 日志 UUID 不代表操作顺序：同一毫秒出现不同学习操作时，不能据此推断最后手动掌握。
    const latestReviewedAt = Math.max(...logs.map(log => log.reviewedAt));
    const explicitMastered = !ambiguous && entry.status === 'mastered' && latestReviewedAt === entry.lastReviewedAt
        && logs.filter(log => log.reviewedAt === latestReviewedAt).every(log => log.rating === 'manual-mastered');
    return {
        id: entry.id, term: entry.term, sourceLanguage: entry.sourceLanguage,
        reference: entry.translations[targetLanguage]?.text || '', start, end, explicitMastered,
        sameContext: entry.contexts.some(context => comparableContext(context.text) === comparableContext(text)),
    };
}

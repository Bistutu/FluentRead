/**
 * @file src/features/progressive-reading/hints.ts
 * 文件职责：从读者正在阅读的原文构造有界的短语提示和逻辑词线索。
 * 主要内容：提供四档帮助类型、少量明确多词表达的本地释义，以及否定、模态、条件和范围标记；合并主动读取的收藏提示，保守收起同语境的明确掌握表达。
 * 模块边界：纯规则不分析完整句法、不推断作者意图，不读取 DOM、保存学习状态或调用模型；实际翻译与学习库读取由会话端口提供。
 */
import type {VocabularyReadingHint} from '@/src/features/vocabulary/protocol';

export type ReadingMode = 'original' | 'phrases' | 'logic' | 'bilingual';
export interface PhraseHint {term: string; reference: string; start: number; end: number; hidden: boolean; saved: boolean}
export interface LogicClue {term: string; label: string; detail: string; start: number; end: number}
export const normalizeReadingText = (text: string): string => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

const EXPRESSIONS: ReadonlyArray<readonly [string, string]> = [
  ['take into account', '考虑到；把……纳入考虑'], ['rule out', '排除某种可能'],
  ['in spite of', '尽管'], ['as long as', '只要；也可能表示持续时间，需看上下文'],
  ['by and large', '总体而言'], ['in terms of', '就……而言'],
  ['give rise to', '引起；导致'], ['carry out', '执行；开展'], ['rather than', '而非'],
];
const CLUES: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/(?<![\p{L}\p{M}\p{N}_])(?:not|never|no|neither|cannot|can't|won't|doesn't|don't|isn't|aren't|without|unless)(?![\p{L}\p{M}\p{N}_])|不(?:能|会|是)?|并非|没有|除非/giu, '否定 / 例外', '检查这里否定或排除的对象；此标记不确定否定覆盖整句还是局部。'],
  [/(?<![\p{L}\p{M}\p{N}_])(?:may|might|could|possibly|perhaps|likely)(?![\p{L}\p{M}\p{N}_])|可能|也许|或许/giu, '可能性', '保留原文的不确定程度，不能直接读成确定事实。'],
  [/(?<![\p{L}\p{M}\p{N}_])(?:if|unless|provided that|as long as|only if)(?![\p{L}\p{M}\p{N}_])|如果|只要|除非|仅当/giu, '条件', '检查结论成立需要什么条件；此标记不判断条件是否已满足。'],
  [/(?<![\p{L}\p{M}\p{N}_])(?:only|some|most|all|generally|usually|in this case)(?![\p{L}\p{M}\p{N}_])|仅(?:限|在)?|部分|通常|所有|在这种情况/giu, '适用范围', '检查对象、数量或适用场景，避免把有限范围读成普遍结论。'],
];

/** 全段选择保留完整双语入口；只有短表达或段内片段进入定向词义查询。 */
function requestedExpression(text: string, selected: string): string {
  const expression = normalizeReadingText(selected);
  return expression.length <= 160 && (expression !== text
    || !/[.!?。！？]["'”’）)]*$/u.test(expression) && expression.split(' ').length <= 12) ? expression : '';
}

/** 本地表达必须完整命中词界；收藏坐标与同语境掌握标记由权威后台提供。 */
export function readingPhraseHints(text: string, saved: readonly VocabularyReadingHint[], selected = ''): PhraseHint[] {
  const result: PhraseHint[] = saved.map(hint => ({term: text.slice(hint.start, hint.end), reference: hint.reference, start: hint.start, end: hint.end,
    hidden: hint.explicitMastered && hint.sameContext, saved: true}));
  for (const [term, reference] of EXPRESSIONS) {
    for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${term.replaceAll(' ', '\\s+')}(?![\\p{L}\\p{M}\\p{N}_])`, 'giu'))) {
      const start = match.index, end = start + match[0].length;
      if (!result.some(hint => hint.start === start && hint.end === end)) result.push({term: match[0], reference, start, end, hidden: false, saved: false});
    }
  }
  const expression = requestedExpression(text, selected);
  const start = text.indexOf(expression);
  if (expression && start >= 0 && !result.some(hint => hint.start === start && hint.end === start + expression.length)) {
    result.unshift({term: expression, reference: '', start, end: start + expression.length, hidden: false, saved: false});
  }
  const ordered = result.sort((a, b) => a.start - b.start || b.end - a.end);
  const bounded = ordered.slice(0, 24);
  // 主动选中的表达始终保留查询入口；前面的自动提示不能占满其有界预算。
  const requested = expression ? ordered.find(hint => hint.start === start && hint.end === start + expression.length) : undefined;
  if (requested && !bounded.includes(requested)) bounded[23] = requested;
  return bounded;
}

/** 引用真实原文位置，明确说明这是词面线索而非完整逻辑分析。 */
export function readingLogicClues(text: string): LogicClue[] {
  const result: LogicClue[] = [];
  for (const [pattern, label, detail] of CLUES) {
    for (const match of text.matchAll(pattern)) result.push({term: match[0], label, detail, start: match.index, end: match.index + match[0].length});
  }
  return result.sort((a, b) => a.start - b.start).slice(0, 32);
}

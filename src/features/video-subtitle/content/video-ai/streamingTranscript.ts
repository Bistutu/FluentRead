/**
 * @file src/features/video-subtitle/content/video-ai/streamingTranscript.ts
 * 文件职责：把 Whisper 滑动窗口文本归并为可读、可修正且身份稳定的实时或完整字幕 cue。
 * 主要内容：处理跨窗重叠、边界重复、否定语义保护、实时短片段暂存、完整音频段提交和原位校正。
 * 模块边界：只处理转写文本与 spoken 时间，不调用模型、不管理音频节点或翻译服务。
 */
import type { VideoSubtitleCue } from '../youtubeSubtitleData';

export interface VideoAiTranscriptSegment {
  startMs?: number;
  endMs?: number;
  text?: string;
}

export interface VideoAiTranscriptWindow {
  startMs: number;
  durationMs: number;
  availableAtMs: number;
  text?: string;
  segments?: VideoAiTranscriptSegment[];
}

export interface VideoAiStabilizedCue extends VideoSubtitleCue {
  /** 稳定提交后的身份不随显示时长变化，翻译层可据此避免重复请求。 */
  cueId?: string;
  /** 首个短窗口先显示的可修正前缀；后续窗口会沿用同一 cue 原位更新。 */
  partial?: boolean;
  /** 播放器时间轴上，推理结果真正可用的时刻。 */
  availableAtMs: number;
  spokenEndMs: number;
}

export interface VideoAiTranscriptStabilizerOptions {
  /** 完整模式的输入音频段已经读完；短句可提交，实时模式仍等待跨窗确认。 */
  mode?: 'realtime' | 'complete';
}

interface TranscriptPhrase {
  startMs: number;
  endMs: number;
  text: string;
  firstSeenAtMs: number;
  cueId?: string;
  partial?: boolean;
}

export const VIDEO_AI_MIN_READABLE_CUE_MS = 1_800;
export const VIDEO_AI_MAX_CUE_MS = 6_500;
export const VIDEO_AI_SHORT_FRAGMENT_HOLD_MS = 1_700;
const VIDEO_AI_PARTIAL_MIN_AUDIO_MS = 900;
const VIDEO_AI_SEGMENT_JOIN_GAP_MS = 760;
const VIDEO_AI_MAX_PHRASE_SPAN_MS = 6_200;
const VIDEO_AI_CUE_CONTINUATION_GAP_MS = 760;
const VIDEO_AI_CONTINUATION_WORDS = new Set([
  'and', 'as', 'at', 'because', 'but', 'by', 'for', 'from', 'in', 'of', 'on',
  'or', 'so', 'that', 'to', 'when', 'where', 'which', 'while', 'who', 'why', 'with', 'yet',
  'clearly',
]);

export function normalizeVideoAiTranscriptText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/<\|[^|]+\|>/g, '').replace(/[\s\u3000]+/g, ' ').trim()
    : '';
}

function foldTranscriptText(value: string): string {
  return normalizeVideoAiTranscriptText(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function transcriptTokens(value: string): string[] {
  const folded = foldTranscriptText(value);
  if (!folded) return [];
  if (/\s/.test(folded)) return folded.split(' ').filter(Boolean);
  return Array.from(folded);
}

function longestTokenOverlap(left: string[], right: string[]): number {
  const limit = Math.min(left.length, right.length);
  for (let size = limit; size >= 1; size -= 1) {
    let matches = true;
    for (let index = 0; index < size; index += 1) {
      if (left[left.length - size + index] !== right[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return size;
  }
  return 0;
}

function areApproximateTranscriptTokensEqual(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  const lengthDifference = Math.abs(left.length - right.length);
  // Whisper 边界最常见的是时态/单复数尾缀漂移：matter/mattered、
  // move/moved、window/windows。只接受共同前缀且长度差很小，不做泛化
  // 拼写纠错，避免把语义不同的短词误判为同一个 token。
  return lengthDifference <= 3 && (left.startsWith(right) || right.startsWith(left));
}

function longestApproximateTokenOverlap(left: string[], right: string[]): number {
  const limit = Math.min(left.length, right.length);
  for (let size = limit; size >= 1; size -= 1) {
    let matches = true;
    for (let index = 0; index < size; index += 1) {
      if (!areApproximateTranscriptTokensEqual(left[left.length - size + index], right[index])) {
        matches = false;
        break;
      }
    }
    if (matches) return size;
  }
  return 0;
}

function longestApproximateSharedTokenSuffix(left: string[], right: string[]): number {
  const limit = Math.min(left.length, right.length);
  for (let size = limit; size >= 1; size -= 1) {
    let matches = true;
    for (let index = 0; index < size; index += 1) {
      if (!areApproximateTranscriptTokensEqual(
        left[left.length - size + index],
        right[right.length - size + index],
      )) {
        matches = false;
        break;
      }
    }
    if (matches) return size;
  }
  return 0;
}

/**
 * Whisper 有时把上一句尾巴放到下一窗口首句的末尾，甚至顺序颠倒：
 * “Back ... afternoon rain covered the windows.”。如果首句的结尾已经由
 * 上一 cue 完整展示，整段首句先丢弃；后续完整句仍保留。
 */
function stripRepeatedBoundarySentence(previous: string, current: string): string | undefined {
  if (!/\s/.test(previous) || !/\s/.test(current)) return undefined;
  const match = current.trim().match(/^(.+?[.!?。！？][”’"']?)(?:\s+|$)([\s\S]*)$/u);
  if (!match) return undefined;
  if (hasTranscriptNegation(previous) !== hasTranscriptNegation(match[1])) return undefined;
  const previousNumbers = transcriptTokens(previous).filter((token) => /^\d+(?:[.,]\d+)?$/.test(token));
  const currentNumbers = transcriptTokens(match[1]).filter((token) => /^\d+(?:[.,]\d+)?$/.test(token));
  if (previousNumbers.length > 0 && currentNumbers.length > 0
    && previousNumbers.join('|') !== currentNumbers.join('|')) return undefined;
  const previousTokens = transcriptTokens(previous);
  const firstSentenceTokens = transcriptTokens(match[1]);
  const overlap = longestApproximateSharedTokenSuffix(previousTokens, firstSentenceTokens);
  const overlapTokens = firstSentenceTokens.slice(-overlap);
  const meaningfulTwoWordTail = overlap === 2
    && overlapTokens.every((token) => token.length >= 5);
  if (overlap < 3 && !meaningfulTwoWordTail) return undefined;
  return normalizeVideoAiTranscriptText(match[2]);
}

function findTokenSequence(haystack: string[], needle: string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matches = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return start;
  }
  return -1;
}

function longestCommonTokenSubsequenceLength(left: string[], right: string[]): number {
  // 不在另一侧出现的 token 不可能贡献共同子序列，删去它们不改变 LCS。
  const rightVocabulary = new Set(right);
  let first = left.filter((token) => rightVocabulary.has(token));
  const leftVocabulary = new Set(first);
  let second = right.filter((token) => leftVocabulary.has(token));
  if (first.length === 0) return 0;
  if (first.length < second.length) [first, second] = [second, first];

  // 小网格保留简单的精确递推；此预算仅选择算法，不限制输入或结果。
  if (first.length * second.length <= 4_096) {
    let previous = new Uint16Array(second.length + 1);
    let current = new Uint16Array(second.length + 1);
    for (const token of first) {
      current[0] = 0;
      for (let index = 0; index < second.length; index += 1) {
        current[index + 1] = token === second[index]
          ? previous[index] + 1
          : Math.max(previous[index + 1], current[index]);
      }
      [previous, current] = [current, previous];
    }
    return previous[second.length];
  }

  const positions = new Map<string, number[]>();
  for (let index = 0; index < second.length; index += 1) {
    const indices = positions.get(second[index]);
    if (indices) indices.push(index);
    else positions.set(second[index], [index]);
  }
  let matchingPairs = 0;
  for (const token of first) matchingPairs += positions.get(token)!.length;
  const wordCount = Math.ceil(second.length / 32);
  const searchCost = Math.ceil(Math.log2(second.length + 1));
  if (matchingPairs * searchCost <= first.length * wordCount) {
    // 逐个左 token 逆序访问其右位置，再求严格递增序列；逆序确保同一个
    // 左 token 不被重复使用。重复匹配太多时不用此路线，避免 r 的爆炸。
    const tails: number[] = [];
    for (const token of first) {
      const indices = positions.get(token)!;
      for (let index = indices.length - 1; index >= 0; index -= 1) {
        const position = indices[index];
        let low = 0;
        let high = tails.length;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (tails[middle] < position) low = middle + 1;
          else high = middle;
        }
        tails[low] = position;
      }
    }
    return tails.length;
  }

  // 位 s[j] 表示相邻 LCS 列值之差（只能为 0/1）。一行精确更新为
  // x=s|matches，y=(s<<1)|1，s'=x&~(x-y)。用无符号 32-bit 字逐字
  // 移位/借位，不需要 BigInt，兼容现有 ES2018 构建目标。
  // 每块最多 2048 位：即使每个 token 都不同，活跃 mask 也最多 512KiB。
  // 块间按左行保存移位/借位，列块外循环与逐行循环是同一依赖图的不同
  // 拓扑顺序；既不切断子序列，也不把未匹配输入当成 false。
  const blockWords = 64;
  const boundaries = new Uint8Array(first.length);
  let shared = 0;
  for (let start = 0; start < second.length; start += blockWords * 32) {
    const end = Math.min(second.length, start + blockWords * 32);
    const width = Math.ceil((end - start) / 32);
    const masks = new Map<string, Uint32Array>();
    for (let index = start; index < end; index += 1) {
      let mask = masks.get(second[index]);
      if (!mask) {
        mask = new Uint32Array(width);
        masks.set(second[index], mask);
      }
      const offset = index - start;
      mask[offset >>> 5] |= 1 << (offset & 31);
    }
    const row = new Uint32Array(width);
    for (let index = 0; index < first.length; index += 1) {
      const mask = masks.get(first[index]);
      let shift = start === 0 ? 1 : boundaries[index] & 1;
      let borrow = start === 0 ? 0 : boundaries[index] >>> 1;
      for (let word = 0; word < width; word += 1) {
        const previous = row[word];
        const x = (previous | (mask ? mask[word] : 0)) >>> 0;
        const y = ((previous << 1) | shift) >>> 0;
        const difference = x - y - borrow;
        row[word] = x & ~difference;
        shift = previous >>> 31;
        borrow = difference < 0 ? 1 : 0;
      }
      boundaries[index] = shift | (borrow << 1);
    }
    for (const bits of row) {
      let count = bits - ((bits >>> 1) & 0x55555555);
      count = (count & 0x33333333) + ((count >>> 2) & 0x33333333);
      shared += (((count + (count >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
    }
  }
  return shared;
}

function hasTranscriptNegation(value: string): boolean {
  const folded = foldTranscriptText(value);
  // don't / won't / isn't 等缩约形式同样改变极性；在去标点前辨认直/弯撇号。
  return /\b[a-z]+n['’]t\b/iu.test(value)
    || /(^|\s)(?:no|not|never|cannot|neither|nor)(?:\s|$)|(^|\s)can\s+t(?:\s|$)|[不没無无未非勿莫]/u.test(folded);
}

/**
 * Whisper 重叠窗口可能先输出粗识别、后输出校正版。仅在绝大多数 token
 * 保持一致且否定极性不变时把它们视为同一句校正，避免把 can/cannot 等
 * 语义相反的句子误吞。
 */
export function areVideoAiTranscriptCorrectionVariants(left: string, right: string): boolean {
  if (hasTranscriptNegation(left) !== hasTranscriptNegation(right)) return false;
  const firstTokens = transcriptTokens(left);
  const secondTokens = transcriptTokens(right);
  const firstNumbers = firstTokens.filter((token) => /^\d+(?:[.,]\d+)?$/.test(token));
  const secondNumbers = secondTokens.filter((token) => /^\d+(?:[.,]\d+)?$/.test(token));
  if (firstNumbers.length > 0 && secondNumbers.length > 0
    && firstNumbers.join('|') !== secondNumbers.join('|')) return false;
  const shorterLength = Math.min(firstTokens.length, secondTokens.length);
  if (shorterLength < 4) return false;
  let prefix = 0;
  while (prefix < shorterLength && firstTokens[prefix] === secondTokens[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < shorterLength - prefix
    && firstTokens[firstTokens.length - 1 - suffix] === secondTokens[secondTokens.length - 1 - suffix]) {
    suffix += 1;
  }
  // 共同前缀和不重叠后缀可按序组成共同子序列，是实际 LCS 的下界。
  // 只在下界已满足原阈值时跳过 DP；不足时继续尝试中间的接受下界。
  if ((prefix + suffix) / shorterLength >= 0.72) return true;
  const positions = new Map<string, {indices: number[]; next: number}>();
  for (let index = prefix; index < secondTokens.length - suffix; index += 1) {
    const token = secondTokens[index];
    const entry = positions.get(token);
    if (entry) entry.indices.push(index);
    else positions.set(token, {indices: [index], next: 0});
  }
  let lastMatched = prefix - 1;
  let matched = 0;
  for (let index = prefix; index < firstTokens.length - suffix; index += 1) {
    const entry = positions.get(firstTokens[index]);
    if (!entry) continue;
    while (entry.next < entry.indices.length && entry.indices[entry.next] <= lastMatched) entry.next += 1;
    if (entry.next === entry.indices.length) continue;
    lastMatched = entry.indices[entry.next];
    entry.next += 1;
    matched += 1;
    // 中间匹配的左右位置都严格递增，且与已知边缘不重叠。
    // 每个位置游标最多前进一次；这只是接受下界，失败仍走精确 DP。
    if ((prefix + matched + suffix) / shorterLength >= 0.72) return true;
  }
  const shared = longestCommonTokenSubsequenceLength(firstTokens, secondTokens);
  return shared / shorterLength >= 0.72;
}

/** 取滚动窗口相对已提交文本真正新增的后缀，避免整句重复上屏。 */
export function getVideoAiTranscriptNovelSuffix(committed: string, current: string): string {
  const previous = normalizeVideoAiTranscriptText(committed);
  const next = normalizeVideoAiTranscriptText(current);
  if (!previous) return next;
  if (!next) return '';
  const previousFolded = foldTranscriptText(previous);
  const nextFolded = foldTranscriptText(next);
  if (!previousFolded || previousFolded === nextFolded || previousFolded.includes(nextFolded)) return '';

  if (!/\s/.test(previous) && !/\s/.test(next)) {
    const previousUnits = Array.from(previousFolded.replace(/\s+/g, ''));
    const nextDisplay = next.replace(/^[\p{P}\p{S}]+/u, '');
    const nextUnits = Array.from(foldTranscriptText(nextDisplay).replace(/\s+/g, ''));
    const containedAt = findTokenSequence(nextUnits, previousUnits);
    if (containedAt >= 0) {
      return Array.from(nextDisplay).slice(containedAt + previousUnits.length).join('').trim();
    }
    const overlap = longestTokenOverlap(previousUnits, nextUnits);
    return overlap > 0 ? Array.from(nextDisplay).slice(overlap).join('').trim() : next;
  }

  const previousTokens = previous.split(/\s+/).filter(Boolean);
  const nextTokens = next.split(/\s+/).filter(Boolean);
  const previousComparable = previousTokens.map(foldTranscriptText).filter(Boolean);
  const nextComparable = nextTokens.map(foldTranscriptText).filter(Boolean);
  const containedAt = findTokenSequence(nextComparable, previousComparable);
  if (containedAt >= 0) return nextTokens.slice(containedAt + previousComparable.length).join(' ').trim();
    const overlap = Math.max(
      longestTokenOverlap(previousComparable, nextComparable),
      longestApproximateTokenOverlap(previousComparable, nextComparable),
    );
  return overlap > 0 ? nextTokens.slice(overlap).join(' ').trim() : next;
}

export function areVideoAiTranscriptTextsRelated(left: string, right: string): boolean {
  const first = foldTranscriptText(left);
  const second = foldTranscriptText(right);
  if (!first || !second) return false;
  if (first === second) return true;

  const firstTokens = transcriptTokens(first);
  const secondTokens = transcriptTokens(second);
  const shorterLength = Math.min(firstTokens.length, secondTokens.length);
  const contained = findTokenSequence(firstTokens, secondTokens) >= 0
    || findTokenSequence(secondTokens, firstTokens) >= 0;
  if (contained && shorterLength >= 2) return true;
  const overlap = Math.max(
    longestTokenOverlap(firstTokens, secondTokens),
    longestTokenOverlap(secondTokens, firstTokens),
    longestApproximateTokenOverlap(firstTokens, secondTokens),
    longestApproximateTokenOverlap(secondTokens, firstTokens),
  );
  if (shorterLength === 1) return overlap === 1;
  if (overlap === 2 && !endsWithStrongPunctuation(left)) {
    const sharedTail = firstTokens.slice(-2);
    const sharedHead = secondTokens.slice(0, 2);
    if (sharedTail.every((token, index) => token.length >= 4 && token === sharedHead[index])) return true;
  }
  const absoluteBoundaryMatch = /\s/.test(first) || /\s/.test(second)
    ? overlap >= 3
    : overlap >= 4;
  return absoluteBoundaryMatch || (overlap >= 2 && overlap / shorterLength >= 0.5);
}

export function mergeVideoAiTranscriptText(left: string, right: string): string {
  const first = normalizeVideoAiTranscriptText(left);
  const second = normalizeVideoAiTranscriptText(right);
  if (!first) return second;
  if (!second) return first;

  const firstFolded = foldTranscriptText(first);
  const secondFolded = foldTranscriptText(second);
  if (firstFolded === secondFolded) return second.length >= first.length ? second : first;
  if (secondFolded.includes(firstFolded)) return second;
  if (firstFolded.includes(secondFolded)) return first;

  const firstTokens = first.split(/\s+/).filter(Boolean);
  const secondTokens = second.split(/\s+/).filter(Boolean);
  const foldedFirstTokens = firstTokens.map(foldTranscriptText);
  const foldedSecondTokens = secondTokens.map(foldTranscriptText);
  const exactOverlap = longestTokenOverlap(foldedFirstTokens, foldedSecondTokens);
  const approximateOverlap = longestApproximateTokenOverlap(foldedFirstTokens, foldedSecondTokens);
  const overlap = Math.max(exactOverlap, approximateOverlap);
  if (overlap > 0) {
    if (approximateOverlap > exactOverlap) {
      return [...firstTokens.slice(0, -overlap), ...secondTokens]
        .join(' ')
        .replace(/\s+([,.;!?，。；！？])/g, '$1')
        .trim();
    }
    const prefixTokens = [...firstTokens];
    const firstBoundary = prefixTokens[prefixTokens.length - 1];
    const secondBoundary = secondTokens[overlap - 1];
    // 旧窗口可能把尚未说完的尾部误判成句号；新窗口在相同重叠词上没有
    // 该标点时，以新窗口为准，避免得到 “fences. every day”。
    if (/[.!?。！？][”’"']?$/.test(firstBoundary)
      && !/[.!?。！？][”’"']?$/.test(secondBoundary)) {
      prefixTokens[prefixTokens.length - 1] = firstBoundary.replace(/[.!?。！？]+([”’"']?)$/, '$1');
    }
    return [...prefixTokens, ...secondTokens.slice(overlap)]
      .join(' ')
      .replace(/\s+([,.;!?，。；！？])/g, '$1')
      .trim();
  }

  // 没有空格的语言按字符消除滑窗重叠。
  if (!/\s/.test(first) && !/\s/.test(second)) {
    const firstWithoutTentativePunctuation = first.replace(/[.!?。！？]+([”’"']?)$/, '$1');
    const firstCharacters = Array.from(firstWithoutTentativePunctuation);
    const secondCharacters = Array.from(second);
    const characterOverlap = longestTokenOverlap(
      firstCharacters.map((character) => character.toLocaleLowerCase()),
      secondCharacters.map((character) => character.toLocaleLowerCase()),
    );
    if (characterOverlap > 0) return [...firstCharacters, ...secondCharacters.slice(characterOverlap)].join('');
  }

  return `${first} ${second}`.replace(/\s+([,.;!?，。；！？])/g, '$1').trim();
}

function endsWithStrongPunctuation(value: string): boolean {
  const text = value.trim();
  // Whisper 用省略号表示仍在推测的切片尾部，不能把 “Outside, traffic...”
  // 当成完整句立即提交。
  if (/(?:\.{2,}|…+)[”’"']?$/.test(text)) return false;
  return /[.!?。！？][”’"']?$/.test(text);
}

function hasMeaningfulSingleWordBoundaryOverlap(left: string, right: string): boolean {
  const first = foldTranscriptText(left);
  const second = foldTranscriptText(right);
  if (!/\s/.test(first) || !/\s/.test(second)) return false;
  const firstTokens = transcriptTokens(first);
  const secondTokens = transcriptTokens(second);
  if (longestTokenOverlap(firstTokens, secondTokens) === 1) {
    return firstTokens[firstTokens.length - 1].length >= 5;
  }
  if (longestTokenOverlap(secondTokens, firstTokens) === 1) {
    return secondTokens[secondTokens.length - 1].length >= 5;
  }
  return false;
}

function hasMeaningfulPartialBoundaryOverlap(left: string, right: string): boolean {
  const first = transcriptTokens(left);
  const second = transcriptTokens(right);
  const overlaps = [
    [first, second],
    [second, first],
  ] as const;
  return overlaps.some(([from, to]) => {
    const overlap = longestApproximateTokenOverlap(from, to);
    if (overlap < 2) return false;
    const boundary = from.slice(from.length - overlap);
    return boundary.every((token) => token.length >= 4);
  });
}

function getPhraseUnits(phrase: TranscriptPhrase): {
  words: string[];
  cjkCount: number;
  visibleUnits: number;
} {
  const text = phrase.text.trim();
  const words = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
  const cjkCount = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
  const visibleUnits = Array.from(text.replace(/[\s\p{P}\p{S}]/gu, '')).length;
  return { words, cjkCount, visibleUnits };
}

function isReadablePhrase(phrase: TranscriptPhrase): boolean {
  const { words, cjkCount, visibleUnits } = getPhraseUnits(phrase);
  if (words.length >= 4 || cjkCount >= 6 || visibleUnits >= 20) return true;
  if (endsWithStrongPunctuation(phrase.text) && (words.length >= 4 || cjkCount >= 2)) return true;
  return phrase.endMs - phrase.startMs >= 2_800 && (words.length >= 3 || cjkCount >= 4);
}

function isConfirmedReadablePhrase(phrase: TranscriptPhrase): boolean {
  const { words, cjkCount, visibleUnits } = getPhraseUnits(phrase);
  return words.length >= 3 || cjkCount >= 4 || visibleUnits >= 14;
}

function isConfirmedShortSentence(phrase: TranscriptPhrase): boolean {
  const { words, cjkCount } = getPhraseUnits(phrase);
  return endsWithStrongPunctuation(phrase.text) && (words.length >= 2 || cjkCount >= 2);
}

function isCompletedShortPhrase(phrase: TranscriptPhrase): boolean {
  const {words, cjkCount} = getPhraseUnits(phrase);
  return phrase.endMs - phrase.startMs >= 300 && (words.length >= 2 || cjkCount >= 2);
}

/**
 * 首个短窗口不要等下一次完整确认才上屏。只放行至少四个英文词、六个
 * CJK 字符或足够长的可读前缀；“uh”“The screen.” 这类短片段仍由原来的
 * 跨窗确认规则处理。
 */
function isPreviewablePhrase(phrase: TranscriptPhrase): boolean {
  if (phrase.endMs - phrase.startMs < VIDEO_AI_PARTIAL_MIN_AUDIO_MS) return false;
  const { words, cjkCount, visibleUnits } = getPhraseUnits(phrase);
  return words.length >= 4 || cjkCount >= 6 || visibleUnits >= 20;
}

function temporalDistance(left: TranscriptPhrase, right: TranscriptPhrase): number {
  if (left.endMs < right.startMs) return right.startMs - left.endMs;
  if (right.endMs < left.startMs) return left.startMs - right.endMs;
  return 0;
}

function combinePhrases(left: TranscriptPhrase, right: TranscriptPhrase): TranscriptPhrase {
  // 重叠窗口常会先给出粗识别，下一窗再从同一句开头给出更完整的校正版。
  // 这不是相邻句，直接采用较新的结果；否则普通拼接会得到
  // “Back inside ... wheels Back inside ... recorded ...” 这类重复长句。
  const text = areVideoAiTranscriptCorrectionVariants(left.text, right.text)
    ? right.text
    : mergeVideoAiTranscriptText(left.text, right.text);
  return {
    startMs: Math.min(left.startMs, right.startMs),
    endMs: Math.max(left.endMs, right.endMs),
    text,
    firstSeenAtMs: Math.min(left.firstSeenAtMs, right.firstSeenAtMs),
    partial: right.partial,
  };
}

function normalizeWindowPhrases(window: VideoAiTranscriptWindow): TranscriptPhrase[] {
  const windowEndMs = window.startMs + Math.max(0, window.durationMs);
  const sourceSegments = Array.isArray(window.segments) ? window.segments : [];
  const segments = sourceSegments
    .map((segment) => {
      const text = normalizeVideoAiTranscriptText(segment.text);
      const relativeStartMs = typeof segment.startMs === 'number' && Number.isFinite(segment.startMs)
        ? Math.max(0, Math.min(window.durationMs, segment.startMs))
        : 0;
      const relativeEndMs = typeof segment.endMs === 'number' && Number.isFinite(segment.endMs)
        ? Math.max(relativeStartMs + 120, Math.min(window.durationMs, segment.endMs))
        : window.durationMs;
      return {
        startMs: window.startMs + relativeStartMs,
        endMs: Math.min(windowEndMs, window.startMs + relativeEndMs),
        text,
        firstSeenAtMs: window.availableAtMs,
      };
    })
    .filter((segment) => segment.text && segment.endMs > segment.startMs)
    .sort((left, right) => left.startMs - right.startMs);

  if (segments.length === 0) {
    const text = normalizeVideoAiTranscriptText(window.text);
    return text ? [{
      startMs: window.startMs,
      endMs: windowEndMs,
      text,
      firstSeenAtMs: window.availableAtMs,
    }] : [];
  }

  const phrases: TranscriptPhrase[] = [];
  for (const segment of segments) {
    const previous = phrases[phrases.length - 1];
    if (!previous) {
      phrases.push(segment);
      continue;
    }
    const gapMs = segment.startMs - previous.endMs;
    const combinedSpanMs = Math.max(previous.endMs, segment.endMs) - Math.min(previous.startMs, segment.startMs);
    const shouldJoin = gapMs <= VIDEO_AI_SEGMENT_JOIN_GAP_MS
      && combinedSpanMs <= VIDEO_AI_MAX_PHRASE_SPAN_MS
      // 已经完整结束的可读句应立即成为独立 cue。把后面的短片段黏上去
      // 只会制造 “完整句 + Outside, traffic” 这类半句尾巴；短片段由 held
      // 状态等下一滚动窗口确认即可。
      && !(endsWithStrongPunctuation(previous.text) && isReadablePhrase(previous));
    if (shouldJoin) phrases[phrases.length - 1] = combinePhrases(previous, segment);
    else phrases.push(segment);
  }
  return phrases;
}

function toCue(
  phrase: TranscriptPhrase,
  availableAtMs: number,
  cueId?: string,
  partial = false,
): VideoAiStabilizedCue {
  const spokenDurationMs = Math.max(0, phrase.endMs - phrase.startMs);
  return {
    startMs: Math.max(0, phrase.startMs),
    durationMs: Math.min(
      VIDEO_AI_MAX_CUE_MS,
      Math.max(VIDEO_AI_MIN_READABLE_CUE_MS, spokenDurationMs + 700),
    ),
    text: phrase.text,
    cueId,
    partial,
    availableAtMs: Math.max(0, availableAtMs),
    spokenEndMs: Math.max(phrase.startMs, phrase.endMs),
  };
}

/**
 * 把重叠 Whisper 窗口变成稳定、可读的 cue。短词先保留为候选，只有下一
 * 个窗口确认、与后文组成可读短语，或等待达到上限后才提交。完整音频段
 * 必须显式传入 complete 模式，不能由 availableAtMs 推断提交策略。
 */
export class VideoAiTranscriptStabilizer {
  private previousPhrases: TranscriptPhrase[] = [];
  private heldPhrase: TranscriptPhrase | null = null;
  private committedPhrases: TranscriptPhrase[] = [];
  private cueSequence = 0;

  constructor(private readonly options: VideoAiTranscriptStabilizerOptions = {}) {}

  reset(keepCueSequence = false): void {
    this.previousPhrases = [];
    this.heldPhrase = null;
    this.committedPhrases = [];
    if (!keepCueSequence) this.cueSequence = 0;
  }

  private prepareNovelPhrase(phrase: TranscriptPhrase): TranscriptPhrase | null {
    for (const committed of [...this.committedPhrases].reverse()) {
      // 新窗口有时把上一 cue 的完整尾句重新放在窗口开头，但时间戳只会
      // 轻微错开；限制在 1.2 秒邻域内即可消掉重复，不影响真正的新句。
      if (temporalDistance(committed, phrase) > 1_200) continue;
      const stripped = stripRepeatedBoundarySentence(committed.text, phrase.text);
      if (stripped === undefined) continue;
      if (!stripped) return null;
      return {
        startMs: Math.max(phrase.startMs, committed.endMs - 220),
        endMs: Math.max(committed.endMs + 120, phrase.endMs),
        text: stripped,
        firstSeenAtMs: phrase.firstSeenAtMs,
      };
    }

    const existing = [...this.committedPhrases].reverse().find((committed) => {
      const distance = temporalDistance(committed, phrase);
      return distance <= 1_200
        && (areVideoAiTranscriptTextsRelated(committed.text, phrase.text)
          // 同一重叠时间段偶尔只剩一个较长边界词（windows -> Windows）。
          // 只在 spoken range 确实重叠时消掉它，避免普通相邻句被误吞。
          || (distance === 0 && hasMeaningfulSingleWordBoundaryOverlap(committed.text, phrase.text)));
    });
    if (!existing) return phrase;

    const suffix = getVideoAiTranscriptNovelSuffix(existing.text, phrase.text);
    if (!suffix) {
      existing.endMs = Math.max(existing.endMs, phrase.endMs);
      return null;
    }
    return {
      startMs: Math.max(phrase.startMs, existing.endMs - 220),
      endMs: Math.max(existing.endMs + 120, phrase.endMs),
      text: suffix,
      firstSeenAtMs: phrase.firstSeenAtMs,
    };
  }

  private commit(
    phrase: TranscriptPhrase,
    availableAtMs: number,
    partial = false,
  ): VideoAiStabilizedCue {
    phrase.cueId ||= `ai-${++this.cueSequence}`;
    phrase.partial = partial;
    this.committedPhrases.push(phrase);
    const keepAfterMs = phrase.endMs - 30_000;
    this.committedPhrases = this.committedPhrases
      .filter((candidate) => candidate.endMs >= keepAfterMs)
      .slice(-64);
    return toCue(phrase, availableAtMs, phrase.cueId, partial);
  }

  private extendCommittedPrefix(
    phrase: TranscriptPhrase,
    availableAtMs: number,
  ): VideoAiStabilizedCue | null {
    const nextFolded = foldTranscriptText(phrase.text);
    if (!nextFolded) return null;
    const previous = [...this.committedPhrases].reverse().find((candidate) => {
      const previousFolded = foldTranscriptText(candidate.text);
      if (!previousFolded || previousFolded === nextFolded) return false;
      return temporalDistance(candidate, phrase) <= VIDEO_AI_SEGMENT_JOIN_GAP_MS
        && nextFolded.startsWith(previousFolded);
    });
    if (!previous?.cueId) return null;

    // 首窗先显示 “The speaker reviewed the”；下一窗返回更长前缀时，
    // 原位替换同一 cue，避免临时字幕和完整字幕同时留在时间轴里。
    previous.text = phrase.text;
    previous.endMs = Math.max(previous.endMs, phrase.endMs);
    previous.firstSeenAtMs = Math.min(previous.firstSeenAtMs, phrase.firstSeenAtMs);
    previous.partial = !endsWithStrongPunctuation(phrase.text);
    return toCue(previous, availableAtMs, previous.cueId, previous.partial);
  }

  private extendCommittedContinuation(
    phrase: TranscriptPhrase,
    availableAtMs: number,
  ): VideoAiStabilizedCue | null {
    const previous = this.committedPhrases[this.committedPhrases.length - 1];
    if (!previous?.cueId || temporalDistance(previous, phrase) > VIDEO_AI_CUE_CONTINUATION_GAP_MS) return null;
    const firstWord = foldTranscriptText(phrase.text).split(' ', 1)[0] || '';
    const startsLowercase = /^\p{Ll}/u.test(phrase.text.trim());
    // 连接词即使上一窗口误加句号也应继续；上一条本来就没有完整句末时，
    // 任意小写开头都更可能是同一句的后半段（afternoon + rain...）。
    if (!startsLowercase
      || (endsWithStrongPunctuation(previous.text)
        && !previous.partial
        && !VIDEO_AI_CONTINUATION_WORDS.has(firstWord))) return null;
    const combinedSpanMs = Math.max(previous.endMs, phrase.endMs) - Math.min(previous.startMs, phrase.startMs);
    if (combinedSpanMs > VIDEO_AI_MAX_CUE_MS) return null;

    const previousWithoutFalseStop = previous.text.replace(/[.!?。！？]+([”’"']?)$/, '$1');
    // prepareNovelPhrase 已经剥离重叠前缀。不能再拿新增后缀在完整前文里
    // 做 contains 去重，否则前文出现过的合法句尾词会被第二次吞掉。
    const continuation = phrase.text;
    previous.text = `${previousWithoutFalseStop} ${continuation}`
      .replace(/\s+([,.;!?，。；！？])/g, '$1')
      .trim();
    previous.endMs = Math.max(previous.endMs, phrase.endMs);
    previous.firstSeenAtMs = Math.min(previous.firstSeenAtMs, phrase.firstSeenAtMs);
    previous.partial = !endsWithStrongPunctuation(phrase.text);
    return toCue(previous, availableAtMs, previous.cueId, previous.partial);
  }

  private correctCommittedPhrase(
    phrase: TranscriptPhrase,
    availableAtMs: number,
  ): VideoAiStabilizedCue | null {
    const existing = [...this.committedPhrases].reverse().find((candidate) => {
      if (!candidate.cueId || temporalDistance(candidate, phrase) !== 0) return false;
      const combinedSpanMs = Math.max(candidate.endMs, phrase.endMs)
        - Math.min(candidate.startMs, phrase.startMs);
      return combinedSpanMs <= VIDEO_AI_MAX_CUE_MS
        && !areVideoAiTranscriptTextsRelated(candidate.text, phrase.text)
        && areVideoAiTranscriptCorrectionVariants(candidate.text, phrase.text);
    });
    if (!existing?.cueId) return null;
    existing.startMs = Math.min(existing.startMs, phrase.startMs);
    existing.endMs = Math.max(existing.endMs, phrase.endMs);
    existing.text = phrase.text;
    existing.firstSeenAtMs = Math.min(existing.firstSeenAtMs, phrase.firstSeenAtMs);
    existing.partial = !endsWithStrongPunctuation(phrase.text);
    return toCue(existing, availableAtMs, existing.cueId, existing.partial);
  }

  private correctPartialCommittedPhrase(
    phrase: TranscriptPhrase,
    availableAtMs: number,
  ): VideoAiStabilizedCue | null {
    const incomingText = normalizeVideoAiTranscriptText(phrase.text);
    const incomingTokens = transcriptTokens(incomingText);
    if (incomingTokens.length < 3) return null;
    const existing = [...this.committedPhrases].reverse().find((candidate) => {
      if (!candidate.cueId || !candidate.partial || temporalDistance(candidate, phrase) > 1_200) return false;
      if (hasTranscriptNegation(candidate.text) !== hasTranscriptNegation(incomingText)) return false;
      const candidateNumbers = transcriptTokens(candidate.text).filter((token) => /^\d+(?:[.,]\d+)?$/.test(token));
      const incomingNumbers = incomingTokens.filter((token) => /^\d+(?:[.,]\d+)?$/.test(token));
      if (candidateNumbers.length > 0 && incomingNumbers.length > 0
        && candidateNumbers.join('|') !== incomingNumbers.join('|')) return false;
      // 只处理短窗误加句号后又在同一边界得到新长句的情况。没有句号的
      // 临时前缀仍交给原有 novel-suffix/continuation 逻辑，避免把正常的
      // “The subtitle system works” + “subtitle system works every day”
      // 误替换成整句。
      return endsWithStrongPunctuation(candidate.text)
        && (areVideoAiTranscriptCorrectionVariants(candidate.text, incomingText)
          || hasMeaningfulPartialBoundaryOverlap(candidate.text, incomingText));
    });
    if (!existing?.cueId) return null;
    const existingUnits = getPhraseUnits(existing);
    const incomingUnits = getPhraseUnits(phrase);
    const incomingIsMoreInformative = incomingUnits.words.length > existingUnits.words.length
      || incomingUnits.cjkCount > existingUnits.cjkCount
      || incomingUnits.visibleUnits > existingUnits.visibleUnits
      || endsWithStrongPunctuation(incomingText) && !endsWithStrongPunctuation(existing.text);
    if (!incomingIsMoreInformative) return null;

    // 短窗 cue 已经展示给用户，但仍处于可修正状态。沿用原 cueId，避免
    // 翻译层和时间轴同时保留错误前缀与完整长窗结果。
    existing.startMs = Math.min(existing.startMs, phrase.startMs);
    existing.endMs = Math.max(existing.endMs, phrase.endMs);
    existing.text = incomingText;
    existing.firstSeenAtMs = Math.min(existing.firstSeenAtMs, phrase.firstSeenAtMs);
    existing.partial = !endsWithStrongPunctuation(incomingText);
    return toCue(existing, availableAtMs, existing.cueId, existing.partial);
  }

  ingest(window: VideoAiTranscriptWindow): VideoAiStabilizedCue[] {
    const phrases = normalizeWindowPhrases(window);
    const output: VideoAiStabilizedCue[] = [];
    const shortWindow = window.durationMs < 2_000 && this.committedPhrases.length === 0
      && this.options.mode !== 'complete';

    if (phrases.length === 0 && this.heldPhrase
      && window.availableAtMs - this.heldPhrase.firstSeenAtMs >= VIDEO_AI_SHORT_FRAGMENT_HOLD_MS) {
      // 静音窗口确认没有后文时，孤立短词更可能是幻觉；不要让它一直占内存。
      this.heldPhrase = null;
    }

    for (let phrase of phrases) {
      const confirmed = this.previousPhrases.some((previous) =>
        temporalDistance(previous, phrase) <= 900
        && areVideoAiTranscriptTextsRelated(previous.text, phrase.text));

      if (this.heldPhrase) {
        const related = areVideoAiTranscriptTextsRelated(this.heldPhrase.text, phrase.text);
        const phrasePrecedesHeld = phrase.endMs <= this.heldPhrase.startMs + 220;
        const adjacent = !phrasePrecedesHeld
          && temporalDistance(this.heldPhrase, phrase) <= VIDEO_AI_SEGMENT_JOIN_GAP_MS;
        if (related || adjacent) {
          phrase = combinePhrases(this.heldPhrase, phrase);
          this.heldPhrase = null;
        } else if (phrasePrecedesHeld) {
          // 新滚动窗口可能先重放已经提交的上一句，再到达 held 的后半句。
          // 不能让这个更早的短语冲掉未来时间点上的候选片段。
        } else if (window.availableAtMs - this.heldPhrase.firstSeenAtMs >= VIDEO_AI_SHORT_FRAGMENT_HOLD_MS
          && isReadablePhrase(this.heldPhrase)) {
          output.push(this.commit(this.heldPhrase, window.availableAtMs));
          this.heldPhrase = null;
        } else {
          // 未经第二个窗口确认的孤立短词更可能是切片边界或幻觉，直接替换。
          this.heldPhrase = null;
        }
      }

      const correctedPartialPhrase = this.correctPartialCommittedPhrase(phrase, window.availableAtMs);
      if (correctedPartialPhrase) {
        output.push(correctedPartialPhrase);
        continue;
      }
      const correctedPhrase = this.correctCommittedPhrase(phrase, window.availableAtMs);
      if (correctedPhrase) {
        output.push(correctedPhrase);
        continue;
      }
      const extendedPrefix = this.extendCommittedPrefix(phrase, window.availableAtMs);
      if (extendedPrefix) {
        output.push(extendedPrefix);
        continue;
      }
      const novelPhrase = this.prepareNovelPhrase(phrase);
      if (!novelPhrase) continue;
      const extendedContinuation = this.extendCommittedContinuation(novelPhrase, window.availableAtMs);
      if (extendedContinuation) {
        output.push(extendedContinuation);
        continue;
      }
      // 明确句末可以立即提交；无标点的长片段至少需要连续两个窗口确认。
      const ready = (endsWithStrongPunctuation(novelPhrase.text) && isReadablePhrase(novelPhrase))
        || (confirmed && (isReadablePhrase(novelPhrase)
          || isConfirmedReadablePhrase(novelPhrase)
          || isConfirmedShortSentence(novelPhrase)))
        || (this.options.mode === 'complete' && isCompletedShortPhrase(novelPhrase));
      if (ready) {
        output.push(this.commit(novelPhrase, window.availableAtMs, shortWindow));
      } else if (isPreviewablePhrase(novelPhrase)) {
        // 先给用户一个可读的临时前缀；同一 cue 后续会被完整结果原位更新。
        output.push(this.commit(novelPhrase, window.availableAtMs, true));
      } else {
        this.heldPhrase = novelPhrase;
      }
    }

    this.previousPhrases = phrases;
    return output;
  }

  flush(availableAtMs: number, allowShortSentence = false): VideoAiStabilizedCue[] {
    const phrase = this.heldPhrase;
    this.heldPhrase = null;
    if (!phrase || (!isReadablePhrase(phrase)
      && !(allowShortSentence
        && isConfirmedShortSentence(phrase)
        && phrase.endMs - phrase.startMs >= 300))) return [];
    const novelPhrase = this.prepareNovelPhrase(phrase);
    return [novelPhrase]
      .filter((candidate): candidate is TranscriptPhrase => candidate !== null)
      .map((candidate) => this.commit(candidate, availableAtMs));
  }
}

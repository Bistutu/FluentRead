/**
 * @file src/features/video-subtitle/content/sentenceTimeline.ts
 * 文件职责：把已有视频字幕的原文 cue 聚合为带可靠音频范围的句子学习材料。
 * 主要内容：仅在原始 cue 边界识别多语言句末标点，并以时间、长度、数量和静音间隔限制无标点连续段；保留原 cue 索引、前后句语境和未完成边界。
 * 模块边界：不解析或生成译文，不切分单个 cue 的音频时间，不调用播放器、网络或存储；YouTube 与具备真实时间轴的 X 适配共用该纯规则。
 */
import type {VideoSubtitleCue} from './youtubeSubtitleData';

export type VideoSentenceBoundary = 'punctuation' | 'gap' | 'limit' | 'end';

export interface VideoSentence {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  /** 原始输入数组索引，译文必须按该映射取值，不能按翻译返回顺序推断时间。 */
  cueIndices: number[];
  previousText: string;
  nextText: string;
  boundary: VideoSentenceBoundary;
  complete: boolean;
}

export interface VideoSentenceTimelineOptions {
  maxDurationMs: number;
  maxCharacters: number;
  maxCues: number;
  maxGapMs: number;
}

const DEFAULT_LIMITS: VideoSentenceTimelineOptions = {
  maxDurationMs: 20_000,
  maxCharacters: 420,
  maxCues: 24,
  maxGapMs: 1_500,
};

function normalizedLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function hasSentenceEnd(text: string): boolean {
  const withoutClosingQuotes = text.replace(/[\s"'”’»」』）)\]]+$/u, '');
  // 字幕只给出了整 cue 时间；一个 cue 即使包含多句也不能杜撰词级时间。
  if (!/[.!?。！？؟۔।॥]$/u.test(withoutClosingQuotes)) return false;
  // 常见称谓/缩写和孤立首字母的点不能证明完整句，等后续 cue 再闭合。
  return !/(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|vs|etc|e\.g|i\.e)|\b[A-Za-z])\.$/iu.test(withoutClosingQuotes);
}

function joinCueText(left: string, right: string): string {
  // 无空格文字保留正常连写；其余文字用空格接回字幕换行。
  const separator = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(left)
    && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(right) ? '' : ' ';
  return left + separator + right;
}

/** 保守聚合原字幕；超长单 cue 保持原子材料，不伪造它的内部时间点。 */
export function buildVideoSentenceTimeline(
  cues: readonly VideoSubtitleCue[],
  options: Partial<VideoSentenceTimelineOptions> = {},
): VideoSentence[] {
  const limits = {
    maxDurationMs: normalizedLimit(options.maxDurationMs, DEFAULT_LIMITS.maxDurationMs),
    maxCharacters: normalizedLimit(options.maxCharacters, DEFAULT_LIMITS.maxCharacters),
    maxCues: normalizedLimit(options.maxCues, DEFAULT_LIMITS.maxCues),
    maxGapMs: normalizedLimit(options.maxGapMs, DEFAULT_LIMITS.maxGapMs),
  };
  const ordered = cues.map((cue, index) => ({...cue, index, text: cue.text.replace(/\s+/gu, ' ').trim()}))
    .filter(cue => cue.text && Number.isFinite(cue.startMs) && cue.startMs >= 0
      && Number.isFinite(cue.durationMs) && cue.durationMs > 0 && Number.isFinite(cue.startMs + cue.durationMs))
    .sort((left, right) => left.startMs - right.startMs || left.index - right.index);
  const result: VideoSentence[] = [];
  let current: VideoSentence | null = null;
  const flush = (boundary: VideoSentenceBoundary): void => {
    if (!current) return;
    let fingerprint = 2166136261;
    for (const character of current.text) fingerprint = Math.imul(fingerprint ^ character.codePointAt(0)!, 16777619);
    current.id = `sentence:${current.cueIndices.join(',')}:${current.startMs}:${current.endMs}:${(fingerprint >>> 0).toString(36)}`;
    current.boundary = boundary;
    current.complete = boundary === 'punctuation';
    result.push(current);
    current = null;
  };
  for (const cue of ordered) {
    const endMs = cue.startMs + cue.durationMs;
    if (current) {
      const joined = joinCueText(current.text, cue.text);
      if (cue.startMs - current.endMs > limits.maxGapMs) flush('gap');
      else if (Math.max(current.endMs, endMs) - current.startMs > limits.maxDurationMs
        || joined.length > limits.maxCharacters || current.cueIndices.length >= limits.maxCues) flush('limit');
    }
    if (!current) {
      current = {
        id: '',
        text: cue.text,
        startMs: cue.startMs,
        endMs,
        cueIndices: [cue.index],
        previousText: '',
        nextText: '',
        boundary: 'end',
        complete: false,
      };
    } else {
      current.text = joinCueText(current.text, cue.text);
      current.endMs = Math.max(current.endMs, endMs);
      current.cueIndices.push(cue.index);
    }
    if (current.endMs - current.startMs > limits.maxDurationMs || current.text.length > limits.maxCharacters
      || current.cueIndices.length > limits.maxCues) flush('limit');
    else if (hasSentenceEnd(cue.text)) flush('punctuation');
  }
  flush('end');
  result.forEach((sentence, index) => {
    sentence.previousText = result[index - 1]?.text || '';
    sentence.nextText = result[index + 1]?.text || '';
  });
  return result;
}

/** 重叠字幕按最近开始的原文材料选中，字幕间隙不猜测仍在发音的句子。 */
export function findVideoSentenceAtTime(sentences: readonly VideoSentence[], currentMs: number): VideoSentence | null {
  let active: VideoSentence | null = null;
  for (const sentence of sentences) {
    if (currentMs >= sentence.startMs && currentMs < sentence.endMs
      && (!active || sentence.startMs >= active.startMs)) active = sentence;
  }
  return active;
}

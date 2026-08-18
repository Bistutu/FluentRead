export interface YoutubeCaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: string;
}

export interface VideoSubtitleCue {
  startMs: number;
  durationMs: number;
  text: string;
}

interface YoutubeTimedTextSegment {
  utf8?: unknown;
}

interface YoutubeTimedTextEvent {
  tStartMs?: unknown;
  dDurationMs?: unknown;
  segs?: YoutubeTimedTextSegment[];
}

function extractBalancedJson(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      depth += 1;
    } else if (character === '}' && --depth === 0) {
      return source.slice(start, index + 1);
    }
  }

  return null;
}

/** 从 YouTube 页面初始化脚本中读取 captionTracks，不依赖页面私有全局变量。 */
export function extractYoutubeCaptionTracks(root: ParentNode = document): YoutubeCaptionTrack[] {
  const scripts = Array.from(root.querySelectorAll('script'));
  for (const script of scripts) {
    const source = script.textContent || '';
    if (!source.includes('playerCaptionsTracklistRenderer')) continue;

    const markerIndex = source.indexOf('ytInitialPlayerResponse');
    const objectStart = source.indexOf('{', markerIndex >= 0 ? markerIndex : 0);
    const jsonSource = extractBalancedJson(source, objectStart);
    if (!jsonSource) continue;

    try {
      const response = JSON.parse(jsonSource) as {
        captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Array<Record<string, unknown>> } };
      };
      const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!Array.isArray(tracks)) continue;

      return tracks.flatMap((track) => {
        const baseUrl = typeof track.baseUrl === 'string' ? track.baseUrl : '';
        const languageCode = typeof track.languageCode === 'string' ? track.languageCode : '';
        if (!baseUrl || !languageCode) return [];
        const nameValue = track.name;
        const name = nameValue && typeof nameValue === 'object'
          ? (nameValue as { simpleText?: unknown }).simpleText
          : undefined;
        return [{
          baseUrl,
          languageCode,
          kind: typeof track.kind === 'string' ? track.kind : undefined,
          name: typeof name === 'string' ? name : undefined,
        }];
      });
    } catch {
      // YouTube 页面上的脚本可能被截断或包裹在其他数据中，继续尝试下一个脚本。
    }
  }

  return [];
}

/** 选择原始字幕轨：优先指定语言的人工作品，再回退到人工轨和自动轨。 */
export function chooseYoutubeCaptionTrack(
  tracks: YoutubeCaptionTrack[],
  preferredLanguage?: string,
): YoutubeCaptionTrack | null {
  if (tracks.length === 0) return null;
  const language = preferredLanguage && preferredLanguage !== 'auto'
    ? preferredLanguage.toLowerCase()
    : '';
  const exact = tracks.find((track) => language && track.languageCode.toLowerCase() === language && track.kind !== 'asr');
  if (exact) return exact;
  const human = tracks.find((track) => track.kind !== 'asr');
  return human || tracks.find((track) => track.kind === 'asr') || tracks[0] || null;
}

/** 按 YouTube 当前 timedtext 接口约定补充 JSON3 参数；若需要 POT，调用方可再追加。 */
export function buildYoutubeTimedTextUrl(track: YoutubeCaptionTrack): string {
  const url = new URL(track.baseUrl);
  const parameters: Record<string, string> = {
    fmt: 'json3',
    xorb: '2',
    xobt: '3',
    xovt: '3',
    c: 'WEB',
    cplayer: 'UNIPLAYER',
  };
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

function decodeHtmlEntities(value: string): string {
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
  }
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanCueText(value: string): string {
  return decodeHtmlEntities(value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u200b\ufeff]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .trim());
}

function numericValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

const WORD_STREAM_JOIN_GAP_MS = 700;
const WORD_STREAM_MAX_CUE_SPAN_MS = 8000;
const WORD_STREAM_MAX_WORDS = 14;

function normalizeCueComparisonText(value: string): string {
  return value.replace(/[\s\u3000]+/g, ' ').trim();
}

function countCueWords(value: string): number {
  const normalized = normalizeCueComparisonText(value);
  if (!normalized) return 0;
  return normalized.split(' ').filter(Boolean).length;
}

function hasCueTerminalPunctuation(value: string): boolean {
  return /[.!?。！？；;：:…]$/.test(normalizeCueComparisonText(value));
}

/** 自动字幕逐词流通常以短词、短间隔事件连续写入 timedtext。 */
function isWordStreamCue(cue: VideoSubtitleCue): boolean {
  const text = normalizeCueComparisonText(cue.text);
  return text.length > 0
    && text.length <= 32
    && countCueWords(text) <= 2
    && !hasCueTerminalPunctuation(text);
}

function cueGapMs(previous: VideoSubtitleCue, next: VideoSubtitleCue): number {
  return next.startMs - (previous.startMs + Math.max(previous.durationMs, 500));
}

function canJoinWordStreamCues(previous: VideoSubtitleCue, next: VideoSubtitleCue): boolean {
  return next.startMs >= previous.startMs
    && next.startMs - previous.startMs <= 1800
    && cueGapMs(previous, next) <= WORD_STREAM_JOIN_GAP_MS;
}

function joinCueText(previous: string, next: string): string {
  const left = previous.trim();
  const right = next.trim();
  if (!left) return right;
  if (!right) return left;
  const needsSpace = /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
  return `${left}${needsSpace ? ' ' : ''}${right}`;
}

function isPrefixPair(left: string, right: string): boolean {
  const first = normalizeCueComparisonText(left).toLocaleLowerCase();
  const second = normalizeCueComparisonText(right).toLocaleLowerCase();
  return first === second || first.startsWith(second) || second.startsWith(first);
}

/** 同一时间点的增量 cue 只保留最长版本，避免短词抢先命中并阻断完整句预翻译。 */
function collapseIncrementalCues(cues: VideoSubtitleCue[]): VideoSubtitleCue[] {
  const result: VideoSubtitleCue[] = [];
  cues.forEach((cue) => {
    const previous = result[result.length - 1];
    const sameStart = previous && Math.abs(previous.startMs - cue.startMs) <= 120;
    if (!previous || !sameStart || !isPrefixPair(previous.text, cue.text)) {
      result.push(cue);
      return;
    }

    const previousTextLength = Array.from(normalizeCueComparisonText(previous.text)).length;
    const currentTextLength = Array.from(normalizeCueComparisonText(cue.text)).length;
    const winner = currentTextLength >= previousTextLength ? cue : previous;
    const endMs = Math.max(
      previous.startMs + previous.durationMs,
      cue.startMs + cue.durationMs,
    );
    result[result.length - 1] = {
      ...winner,
      durationMs: Math.max(winner.durationMs, endMs - winner.startMs),
    };
  });
  return result;
}

function hasWordStreamRun(cues: VideoSubtitleCue[], startIndex: number): boolean {
  let wordCueCount = 0;
  let previous: VideoSubtitleCue | undefined;
  for (let index = startIndex; index < Math.min(cues.length, startIndex + 4); index += 1) {
    const cue = cues[index];
    if (previous && !canJoinWordStreamCues(previous, cue)) return false;
    if (isWordStreamCue(cue)) {
      wordCueCount += 1;
    } else if (!previous || !hasCueTerminalPunctuation(cue.text)) {
      return false;
    }
    previous = cue;
    if (wordCueCount >= 3) return true;
  }
  return false;
}

/** 将明确的逐词 timedtext 合并为播放器可直接显示的短句，普通整段 cue 保持原样。 */
function mergeWordStreamCues(cues: VideoSubtitleCue[]): VideoSubtitleCue[] {
  const result: VideoSubtitleCue[] = [];
  let index = 0;
  while (index < cues.length) {
    if (!hasWordStreamRun(cues, index)) {
      result.push(cues[index]);
      index += 1;
      continue;
    }

    const first = cues[index];
    let last = first;
    let endIndex = index;
    let text = first.text;
    let wordCount = countCueWords(text);
    let endMs = first.startMs + Math.max(first.durationMs, 500);

    while (endIndex + 1 < cues.length) {
      const next = cues[endIndex + 1];
      if (!canJoinWordStreamCues(last, next)) break;
      const nextIsWordCue = isWordStreamCue(next);
      if (!nextIsWordCue && !hasCueTerminalPunctuation(next.text)) break;

      const nextWordCount = countCueWords(next.text);
      const nextEndMs = next.startMs + Math.max(next.durationMs, 500);
      if (wordCount + nextWordCount > WORD_STREAM_MAX_WORDS || nextEndMs - first.startMs > WORD_STREAM_MAX_CUE_SPAN_MS) break;

      text = joinCueText(text, next.text);
      wordCount += nextWordCount;
      endMs = Math.max(endMs, nextEndMs);
      last = next;
      endIndex += 1;
      if (hasCueTerminalPunctuation(next.text)) break;
    }

    result.push({
      startMs: first.startMs,
      durationMs: Math.max(500, endMs - first.startMs),
      text: normalizeCueComparisonText(text),
    });
    index = endIndex + 1;
  }
  return result;
}

function parseJson3Events(value: unknown): VideoSubtitleCue[] {
  if (!value || typeof value !== 'object') return [];
  const events = (value as { events?: YoutubeTimedTextEvent[] }).events;
  if (!Array.isArray(events)) return [];

  return events.flatMap((event) => {
    const startMs = numericValue(event.tStartMs);
    if (startMs === null || !Array.isArray(event.segs)) return [];
    const text = cleanCueText(event.segs
      .map((segment) => typeof segment.utf8 === 'string' ? segment.utf8 : '')
      .join(''));
    if (!text) return [];
    const durationMs = numericValue(event.dDurationMs) || 0;
    return [{ startMs, durationMs, text }];
  });
}

function parseXmlEvents(source: string): VideoSubtitleCue[] {
  if (typeof DOMParser !== 'undefined') {
    const documentRoot = new DOMParser().parseFromString(source, 'text/xml');
    const nodes = Array.from(documentRoot.querySelectorAll('text'));
    if (nodes.length > 0) {
      return nodes.flatMap((node) => {
        const startMs = Number(node.getAttribute('start') || 0) * 1000;
        if (!Number.isFinite(startMs)) return [];
        const durationMs = Number(node.getAttribute('dur') || 0) * 1000;
        const text = cleanCueText(node.textContent || '');
        return text ? [{ startMs, durationMs, text }] : [];
      });
    }
  }

  return Array.from(source.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)).flatMap((match) => {
    const attributes = match[1] || '';
    const start = attributes.match(/\bstart\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!start) return [];
    const duration = attributes.match(/\bdur\s*=\s*["']([^"']+)["']/i)?.[1] || '0';
    const startMs = Number(start) * 1000;
    const durationMs = Number(duration) * 1000;
    const text = cleanCueText(match[2]);
    return Number.isFinite(startMs) && text ? [{ startMs, durationMs, text }] : [];
  });
}

/** 解析 YouTube JSON3 或 XML timedtext 响应为统一时间轴。 */
export function parseYoutubeTimedTextResponse(source: string): VideoSubtitleCue[] {
  const trimmed = source.trim();
  if (!trimmed) return [];
  try {
    const json = JSON.parse(trimmed);
    const cues = parseJson3Events(json);
    if (cues.length > 0) return cues;
  } catch {
    // 尝试 XML/VTT 回退。
  }
  return parseXmlEvents(trimmed);
}

export function finalizeVideoSubtitleCues(cues: VideoSubtitleCue[]): VideoSubtitleCue[] {
  const ordered = [...cues]
    .filter((cue) => Number.isFinite(cue.startMs) && cue.text.trim())
    .sort((left, right) => left.startMs - right.startMs);
  const withDurations: VideoSubtitleCue[] = [];
  ordered.forEach((cue, index) => {
    const nextStart = ordered[index + 1]?.startMs;
    const inferredDuration = nextStart !== undefined ? nextStart - cue.startMs : 2000;
    const durationMs = cue.durationMs > 0 ? cue.durationMs : Math.max(500, Math.min(8000, inferredDuration));
    withDurations.push({ ...cue, durationMs });
  });
  const collapsed = collapseIncrementalCues(withDurations).filter((cue, index, all) => {
    const previous = all[index - 1];
    return !previous || previous.startMs !== cue.startMs || previous.text !== cue.text;
  });
  return mergeWordStreamCues(collapsed);
}

function formatSrtTimestamp(milliseconds: number): string {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const millis = value % 1000;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':') + `,${String(millis).padStart(3, '0')}`;
}

export function cuesToSrt(cues: VideoSubtitleCue[]): string {
  return finalizeVideoSubtitleCues(cues).map((cue, index) => {
    const endMs = cue.startMs + cue.durationMs;
    return `${index + 1}\n${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(endMs)}\n${cue.text}\n`;
  }).join('\n');
}

export function getYoutubeVideoId(locationLike: Pick<Location, 'hostname' | 'pathname' | 'search'> = window.location): string {
  try {
    const url = new URL(locationLike.pathname + locationLike.search, `https://${locationLike.hostname}`);
    return url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    return '';
  }
}

export function sanitizeSubtitleFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'youtube-subtitles';
}

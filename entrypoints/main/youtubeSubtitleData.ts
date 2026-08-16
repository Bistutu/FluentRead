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
  const result: VideoSubtitleCue[] = [];
  ordered.forEach((cue, index) => {
    const nextStart = ordered[index + 1]?.startMs;
    const inferredDuration = nextStart !== undefined ? nextStart - cue.startMs : 2000;
    const durationMs = cue.durationMs > 0 ? cue.durationMs : Math.max(500, Math.min(8000, inferredDuration));
    const previous = result[result.length - 1];
    if (previous && previous.startMs === cue.startMs && previous.text === cue.text) return;
    result.push({ ...cue, durationMs });
  });
  return result;
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

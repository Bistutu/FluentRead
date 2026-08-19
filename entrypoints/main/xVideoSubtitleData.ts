import type { VideoSubtitleCue } from './youtubeSubtitleData';

export interface XSubtitleResource {
  url: string;
  offsetMs: number;
  languageCode?: string;
}

export interface ParsedXSubtitleResource {
  cues: VideoSubtitleCue[];
  resources: XSubtitleResource[];
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

function cleanSubtitleText(value: string): string {
  return decodeHtmlEntities(value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u200b\ufeff]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .trim());
}

function parseTimestamp(value: string): number | null {
  const parts = value.trim().replace(',', '.').split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length === 1 ? Number(parts[0]) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return (hours * 3_600 + minutes * 60 + seconds) * 1000;
}

/** 解析 X 原生字幕常见的 WebVTT sidecar；时间偏移用于 HLS 分片字幕。 */
export function parseWebVttSubtitleResponse(source: string, offsetMs = 0): VideoSubtitleCue[] {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
  const cues: VideoSubtitleCue[] = [];
  let index = 0;

  while (index < lines.length) {
    const current = lines[index].trim();
    if (!current || current.startsWith('NOTE') || current === 'STYLE' || current === 'REGION') {
      index += 1;
      continue;
    }

    let timing = current;
    if (!timing.includes('-->') && lines[index + 1]?.includes('-->')) {
      timing = lines[index + 1].trim();
      index += 1;
    }

    const match = timing.match(/^([^ ]+)\s+-->\s+([^ ]+)/);
    if (!match) {
      index += 1;
      continue;
    }

    const startMs = parseTimestamp(match[1]);
    const endMs = parseTimestamp(match[2]);
    if (startMs === null || endMs === null || endMs <= startMs) {
      index += 1;
      continue;
    }

    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && lines[index].trim() !== '') {
      if (lines[index].includes('-->') && textLines.length === 0) break;
      textLines.push(lines[index]);
      index += 1;
    }

    const text = cleanSubtitleText(textLines.join('\n'));
    if (text) {
      cues.push({
        startMs: offsetMs + startMs,
        durationMs: endMs - startMs,
        text,
      });
    }
  }

  return cues;
}

function readAttribute(line: string, name: string): string | undefined {
  const match = line.match(new RegExp(`${name}=(?:"([^"]*)"|([^,]*))`, 'i'));
  return (match?.[1] || match?.[2] || '').trim() || undefined;
}

function resolveResourceUrl(value: string, baseUrl: string): string | null {
  try {
    return new URL(value.trim().replace(/^"|"$/g, ''), baseUrl).toString();
  } catch {
    return null;
  }
}

function languageCodeFromUrl(url: string): string | undefined {
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)?)\.(?:m3u8|vtt|webvtt|srt)$/i);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * 解析 X 的字幕 master/media playlist。master playlist 通常通过
 * #EXT-X-MEDIA:TYPE=SUBTITLES 指向语言 playlist，media playlist 再列出
 * 带时间偏移的 WebVTT 分片。
 */
export function parseXSubtitleResource(source: string, baseUrl: string): ParsedXSubtitleResource {
  const trimmed = source.trim();
  if (/^WEBVTT(?:\s|$)/i.test(trimmed)) {
    return { cues: parseWebVttSubtitleResponse(trimmed), resources: [] };
  }

  const resources: XSubtitleResource[] = [];
  const lines = trimmed.replace(/\r/g, '').split('\n');
  const hasSubtitleMediaTag = lines.some((line) => /#EXT-X-MEDIA:/i.test(line) && /TYPE=SUBTITLES/i.test(line));
  let pendingDurationMs = 0;
  let offsetMs = 0;

  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized) continue;

    if (normalized.startsWith('#EXT-X-MEDIA:') && /TYPE=SUBTITLES/i.test(normalized)) {
      const resourceUrl = readAttribute(normalized, 'URI');
      const resolvedUrl = resourceUrl ? resolveResourceUrl(resourceUrl, baseUrl) : null;
      if (resolvedUrl) {
        resources.push({
          url: resolvedUrl,
          offsetMs: 0,
          languageCode: readAttribute(normalized, 'LANGUAGE') || languageCodeFromUrl(resolvedUrl),
        });
      }
      continue;
    }

    const duration = normalized.match(/^#EXTINF:([\d.]+)/i);
    if (duration) {
      pendingDurationMs = Number(duration[1]) * 1000;
      continue;
    }

    if (normalized.startsWith('#') || hasSubtitleMediaTag) continue;
    const resolvedUrl = resolveResourceUrl(normalized, baseUrl);
    if (!resolvedUrl) continue;

    resources.push({
      url: resolvedUrl,
      offsetMs,
      languageCode: languageCodeFromUrl(resolvedUrl),
    });
    offsetMs += Number.isFinite(pendingDurationMs) ? pendingDurationMs : 0;
    pendingDurationMs = 0;
  }

  return { cues: [], resources };
}

export function isXSubtitleResourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (host === 'video.twimg.com' || host.endsWith('.twimg.com'))
      && /(?:\.m3u8|\.vtt|\.webvtt|\/captions\/|\/subtitles?\/)/i.test(url.pathname);
  } catch {
    return false;
  }
}

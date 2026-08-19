import { describe, expect, it } from 'vitest';
import {
  isXSubtitleResourceUrl,
  parseWebVttSubtitleResponse,
  parseXSubtitleResource,
} from '@/entrypoints/main/xVideoSubtitleData';

describe('X 视频字幕资源', () => {
  it('解析 WebVTT sidecar，并解码 HTML 文本', () => {
    const cues = parseWebVttSubtitleResponse(`WEBVTT\n\n1\n00:00:01.200 --> 00:00:03.400\nHello &amp; welcome<br>to X\n`);
    expect(cues).toEqual([{
      startMs: 1200,
      durationMs: 2200,
      text: 'Hello & welcome\nto X',
    }]);
  });

  it('解析 HLS 字幕语言 playlist 和分片偏移', () => {
    const master = parseXSubtitleResource(`#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",URI="captions/en.m3u8"`, 'https://video.twimg.com/ext/pl/master.m3u8');
    expect(master.resources).toEqual([{
      url: 'https://video.twimg.com/ext/pl/captions/en.m3u8',
      offsetMs: 0,
      languageCode: 'en',
    }]);

    const media = parseXSubtitleResource(`#EXTM3U\n#EXTINF:2.5,\npart-0.vtt\n#EXTINF:3.5,\npart-1.vtt`, 'https://video.twimg.com/ext/pl/captions/en.m3u8');
    expect(media.resources).toEqual([
      { url: 'https://video.twimg.com/ext/pl/captions/part-0.vtt', offsetMs: 0, languageCode: undefined },
      { url: 'https://video.twimg.com/ext/pl/captions/part-1.vtt', offsetMs: 2500, languageCode: undefined },
    ]);
  });

  it('只把 video.twimg.com 的字幕或 HLS 地址交给资源桥', () => {
    expect(isXSubtitleResourceUrl('https://video.twimg.com/ext/pl/captions/en.m3u8')).toBe(true);
    expect(isXSubtitleResourceUrl('https://video.twimg.com/ext/vid/playlist.m3u8')).toBe(true);
    expect(isXSubtitleResourceUrl('https://video.twimg.com/ext/vid/720x720/video.mp4')).toBe(false);
    expect(isXSubtitleResourceUrl('https://example.com/captions/en.vtt')).toBe(false);
  });
});

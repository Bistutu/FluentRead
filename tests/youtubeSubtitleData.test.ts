import { describe, expect, it } from 'vitest';
import {
  buildYoutubeTimedTextUrl,
  chooseYoutubeCaptionTrack,
  cuesToSrt,
  extractYoutubeCaptionTracks,
  finalizeVideoSubtitleCues,
  parseYoutubeTimedTextResponse,
} from '@/entrypoints/main/youtubeSubtitleData';

describe('YouTube 字幕轨道数据', () => {
  it('从初始化脚本提取字幕轨道并优先选择指定语言的人工作品', () => {
    const playerResponse = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?lang=en', languageCode: 'en', kind: 'asr' },
            { baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh-CN', languageCode: 'zh-CN', name: { simpleText: '中文' } },
          ],
        },
      },
    };
    const script = { textContent: `var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};` };
    const root = { querySelectorAll: () => [script] } as unknown as ParentNode;

    const tracks = extractYoutubeCaptionTracks(root);

    expect(tracks).toHaveLength(2);
    expect(chooseYoutubeCaptionTrack(tracks, 'zh-CN')).toMatchObject({ languageCode: 'zh-CN', name: '中文' });
    expect(chooseYoutubeCaptionTrack(tracks, 'auto')).toMatchObject({ languageCode: 'zh-CN' });
  });

  it('解析 JSON3 和 XML timedtext，并补齐缺失的结束时间', () => {
    const json3 = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 900, segs: [{ utf8: 'Hello &amp; welcome' }] },
        { tStartMs: 1200, segs: [{ utf8: 'Next<br>line' }] },
      ],
    });
    const jsonCues = finalizeVideoSubtitleCues(parseYoutubeTimedTextResponse(json3));
    expect(jsonCues).toEqual([
      { startMs: 0, durationMs: 900, text: 'Hello & welcome' },
      { startMs: 1200, durationMs: 2000, text: 'Next\nline' },
    ]);

    const xmlCues = parseYoutubeTimedTextResponse('<transcript><text start="1.5" dur="2">&lt;hello&gt;</text></transcript>');
    expect(xmlCues).toEqual([{ startMs: 1500, durationMs: 2000, text: '<hello>' }]);
  });

  it('合并同一时间点逐步增长的 cue，只保留完整版本', () => {
    const cues = finalizeVideoSubtitleCues([
      { startMs: 0, durationMs: 600, text: 'I' },
      { startMs: 0, durationMs: 1200, text: 'I think' },
      { startMs: 0, durationMs: 2200, text: 'I think this works.' },
    ]);

    expect(cues).toEqual([{ startMs: 0, durationMs: 2200, text: 'I think this works.' }]);
  });

  it('把连续逐词 cue 合并成一段短句，避免播放器按单词闪动', () => {
    const cues = finalizeVideoSubtitleCues([
      { startMs: 0, durationMs: 650, text: 'This' },
      { startMs: 600, durationMs: 650, text: 'is' },
      { startMs: 1200, durationMs: 650, text: 'a' },
      { startMs: 1800, durationMs: 900, text: 'test.' },
      { startMs: 4000, durationMs: 1200, text: 'Next sentence.' },
    ]);

    expect(cues).toEqual([
      { startMs: 0, durationMs: 2700, text: 'This is a test.' },
      { startMs: 4000, durationMs: 1200, text: 'Next sentence.' },
    ]);
  });

  it('生成可被播放器使用的 SRT 时间轴和 timedtext URL', () => {
    const srt = cuesToSrt([{ startMs: 0, durationMs: 1250, text: '第一句' }]);
    expect(srt).toContain('00:00:00,000 --> 00:00:01,250');
    expect(srt).toContain('第一句');

    const url = buildYoutubeTimedTextUrl({
      baseUrl: 'https://www.youtube.com/api/timedtext?v=video-1&lang=en',
      languageCode: 'en',
    });
    expect(url).toContain('fmt=json3');
    expect(url).toContain('xorb=2');
    expect(url).toContain('cplayer=UNIPLAYER');
  });
});

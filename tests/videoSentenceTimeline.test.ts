import {describe, expect, it} from 'vitest';
import {buildVideoSentenceTimeline, findVideoSentenceAtTime} from '@/src/features/video-subtitle/content/sentenceTimeline';
import type {VideoSubtitleCue} from '@/src/features/video-subtitle/content/youtubeSubtitleData';

const cue = (text: string, startMs: number, durationMs = 1000): VideoSubtitleCue => ({text, startMs, durationMs});

describe('原字幕完整句学习时间轴', () => {
  it('按原始时间聚合跨 cue 完整句，保留源索引与前后句语境', () => {
    const input = [cue('The end!', 4000), cue('  Hello\n', 0), cue('world.', 1000), cue('Next sentence?', 2500)];
    const sentences = buildVideoSentenceTimeline(input);
    expect(sentences.map(item => [item.text, item.startMs, item.endMs, item.cueIndices, item.complete, item.boundary])).toEqual([
      ['Hello world.', 0, 2000, [1, 2], true, 'punctuation'],
      ['Next sentence?', 2500, 3500, [3], true, 'punctuation'],
      ['The end!', 4000, 5000, [0], true, 'punctuation'],
    ]);
    expect(sentences[0]).toMatchObject({previousText: '', nextText: 'Next sentence?'});
    expect(sentences[0].id).toMatch(/^sentence:1,2:0:2000:/);
    expect(sentences[1]).toMatchObject({previousText: 'Hello world.', nextText: 'The end!'});
    expect(sentences[2]).toMatchObject({previousText: 'Next sentence?', nextText: ''});
    expect(input[1].text).toBe('  Hello\n');
  });

  it('保持同一个 cue 内多句的真实整段范围，绝不生成精确子句时间', () => {
    const sentences = buildVideoSentenceTimeline([cue('First. Second! Third?', 10, 9000)]);
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toMatchObject({text: 'First. Second! Third?', startMs: 10, endMs: 9010, cueIndices: [0]});
  });

  it('识别中日文、阿拉伯文和印度文字句末；保留称谓、缩写和引号', () => {
    const sentences = buildVideoSentenceTimeline([
      cue('Dr.', 0), cue('Smith said', 1000), cue('“Hello!”', 2000),
      cue('这是', 3000), cue('例句。', 4000), cue('これは文です。', 5000),
      cue('كيف حالك؟', 6000), cue('یہ جملہ ہے۔', 7000), cue('यह वाक्य है।', 8000), cue('दूसरा॥', 9000),
    ]);
    expect(sentences.map(item => item.text)).toEqual([
      'Dr. Smith said “Hello!”', '这是例句。', 'これは文です。', 'كيف حالك؟', 'یہ جملہ ہے۔', 'यह वाक्य है।', 'दूसरा॥',
    ]);
    expect(buildVideoSentenceTimeline([cue('E.g.', 0), cue('A.', 1000), cue('example.', 2000)]).map(item => item.text))
      .toEqual(['E.g. A. example.']);
  });

  it('无标点字幕以间隙和数量/时间/长度上限分段，分段不会被标记成完整句', () => {
    const gaps = buildVideoSentenceTimeline([cue('before gap', 0), cue('after gap', 4000)]);
    expect(gaps.map(item => [item.boundary, item.complete])).toEqual([['gap', false], ['end', false]]);
    expect(buildVideoSentenceTimeline([cue('one', 0), cue('two', 1000)], {maxCues: 1}).map(item => item.boundary))
      .toEqual(['limit', 'end']);
    expect(buildVideoSentenceTimeline([cue('one', 0), cue('two', 1000)], {maxDurationMs: 1500}).map(item => item.boundary))
      .toEqual(['limit', 'end']);
    expect(buildVideoSentenceTimeline([cue('one', 0), cue('two', 1000)], {maxCharacters: 6}).map(item => item.boundary))
      .toEqual(['limit', 'end']);
    expect(buildVideoSentenceTimeline([cue('one', 0), cue('two', 1100)], {maxGapMs: 50}).map(item => item.boundary))
      .toEqual(['gap', 'end']);
    const long = buildVideoSentenceTimeline(Array.from({length: 70}, (_, i) => cue('unpunctuated', i * 1000)));
    expect(long.length).toBeGreaterThan(1);
    expect(long.every(item => item.endMs - item.startMs <= 20_000 && item.cueIndices.length <= 24)).toBe(true);
    const atomic = buildVideoSentenceTimeline([cue('x'.repeat(1000), 0, 30_000)]);
    expect(atomic).toHaveLength(1);
    expect(atomic[0]).toMatchObject({startMs: 0, endMs: 30_000, complete: false, boundary: 'limit'});
    expect(buildVideoSentenceTimeline([cue('A long sentence.', 0, 30_000)])[0]).toMatchObject({complete: false, boundary: 'limit'});
    expect(buildVideoSentenceTimeline([cue('x'.repeat(500) + '.', 0)])[0]).toMatchObject({complete: false, boundary: 'limit'});
    expect(buildVideoSentenceTimeline([cue('A.', 0)], {maxCues: 0.5})[0]).toMatchObject({complete: false, boundary: 'limit'});
  });

  it('重叠 cue 保留最长原始范围；同起点保持原序；不接受无可靠时间的 cue', () => {
    const invalid = [cue('', 0), cue(' ', 0), cue('negative', -1), cue('nan', NaN), cue('nan duration', 0, NaN),
      cue('zero', 0, 0), cue('negative duration', 0, -1), cue('overflow', Number.MAX_VALUE, Number.MAX_VALUE)];
    expect(buildVideoSentenceTimeline(invalid)).toEqual([]);
    const sentences = buildVideoSentenceTimeline([cue('one', 0, 5000), cue('two', 0, 500), cue('three.', 800, 500)]);
    expect(sentences[0]).toMatchObject({text: 'one two three.', startMs: 0, endMs: 5000, cueIndices: [0, 1, 2]});
    expect(buildVideoSentenceTimeline([])).toEqual([]);
  });

  it('非法可选上限回退到有限默认值', () => {
    const input = [cue('one', 0), cue('two', 1000)];
    expect(buildVideoSentenceTimeline(input, {maxDurationMs: Infinity, maxCharacters: 0, maxCues: -2, maxGapMs: NaN}))
      .toEqual(buildVideoSentenceTimeline(input));
  });

  it('同起点增量补句、时间更正和文字修正都改变材料身份，不复用旧解释或播放终点', () => {
    const initial = buildVideoSentenceTimeline([cue('A first draft.', 0, 1000)])[0];
    const corrected = buildVideoSentenceTimeline([cue('A corrected draft.', 0, 1000)])[0];
    const extended = buildVideoSentenceTimeline([cue('A first draft.', 0, 1500)])[0];
    expect(initial.id).not.toBe(corrected.id);
    expect(initial.id).not.toBe(extended.id);
    expect(initial.id).toBe(buildVideoSentenceTimeline([cue('A first draft.', 0, 1000)])[0].id);
  });

  it('当前句采用最近开始的重叠范围；间隙、结束和非有限时钟不猜测', () => {
    const sentences = buildVideoSentenceTimeline([cue('First.', 0, 5000), cue('Second.', 2000, 1000), cue('Third.', 2000, 500)]);
    expect(findVideoSentenceAtTime(sentences, 0)).toBe(sentences[0]);
    expect(findVideoSentenceAtTime(sentences, 2200)).toBe(sentences[2]);
    expect(findVideoSentenceAtTime([sentences[2], sentences[0]], 2200)).toBe(sentences[2]);
    expect(findVideoSentenceAtTime(sentences, 2900)).toBe(sentences[1]);
    expect(findVideoSentenceAtTime(sentences, 4000)).toBe(sentences[0]);
    expect(findVideoSentenceAtTime(sentences, 5000)).toBeNull();
    expect(findVideoSentenceAtTime(sentences, -1)).toBeNull();
    expect(findVideoSentenceAtTime(sentences, NaN)).toBeNull();
    expect(findVideoSentenceAtTime([], 0)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import {
  VideoAiStreamingResampler,
  measureVideoAiSpeechActivity,
} from '@/src/features/video-subtitle/content/video-ai/audioWindow';
import {
  getVisibleVideoAiCue,
  mergeVideoAiSubtitleCues,
} from '@/src/features/video-subtitle/content/video-ai/cueTimeline';
import {
  VideoAiTranscriptStabilizer,
  areVideoAiTranscriptCorrectionVariants,
  areVideoAiTranscriptTextsRelated,
  getVideoAiTranscriptNovelSuffix,
  mergeVideoAiTranscriptText,
  normalizeVideoAiTranscriptText,
  type VideoAiStabilizedCue,
} from '@/src/features/video-subtitle/content/video-ai/streamingTranscript';

describe('Video AI algorithm boundary coverage', () => {
  it('handles empty and malformed audio while preserving resampler phase', () => {
    expect(measureVideoAiSpeechActivity(new Float32Array())).toEqual({
      active: false,
      peak: 0,
      rms: 0,
      activeFrameRatio: 0,
    });
    const sparse = new Float32Array(10_000);
    sparse[0] = 0.01;
    sparse[1] = Number.NaN;
    const activity = measureVideoAiSpeechActivity(sparse, 1_000);
    expect(activity.peak).toBeCloseTo(0.01, 6);
    expect(activity.active).toBe(true);

    const resampler = new VideoAiStreamingResampler();
    expect(Array.from(resampler.process([new Float32Array([1])], 8_000, 16_000))).toEqual([1]);
    expect(Array.from(resampler.process([new Float32Array([0])], 8_000, 16_000))).toEqual([0.5, 0]);
  });

  it('uses all timeline metadata fallbacks and chooses the newest available cue', () => {
    const merged = mergeVideoAiSubtitleCues([
      {
        startMs: 0,
        durationMs: 1_000,
        text: 'The research team opened the lab.',
        availableAtMs: Number.NaN,
        spokenEndMs: Number.NaN,
        translationAvailableAtMs: Number.NaN,
      } as VideoAiStabilizedCue & { translationAvailableAtMs?: number },
      {
        startMs: 200,
        durationMs: 1_000,
        text: 'The research team opened the laboratory and checked the system.',
        availableAtMs: 700,
        spokenEndMs: 1_800,
        translationAvailableAtMs: 1_200,
      } as VideoAiStabilizedCue & { translationAvailableAtMs?: number },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ availableAtMs: 700, spokenEndMs: 1_800 });

    const sameStart = [
      { startMs: 1_000, durationMs: 1_000, text: 'older', availableAtMs: 2_000 },
      { startMs: 1_000, durationMs: 1_000, text: 'newer', availableAtMs: 3_000 },
    ] as VideoAiStabilizedCue[];
    expect(getVisibleVideoAiCue(sameStart, Number.NaN)).toBeNull();
    expect(getVisibleVideoAiCue(sameStart, 1_000)?.text).toBe('newer');
    expect(getVisibleVideoAiCue([
      ...sameStart,
      { startMs: 3_000, durationMs: 1_000, text: 'future' },
      { startMs: 0, durationMs: 500, text: 'past' },
    ], 1_500)?.text).toBe('newer');
  });

  it('covers empty, CJK, contained, approximate, and disjoint text suffixes', () => {
    expect(normalizeVideoAiTranscriptText(undefined)).toBe('');
    expect(getVideoAiTranscriptNovelSuffix('', 'new words')).toBe('new words');
    expect(getVideoAiTranscriptNovelSuffix('old words', '')).toBe('');
    expect(getVideoAiTranscriptNovelSuffix('天气', '今天天气很好')).toBe('很好');
    expect(getVideoAiTranscriptNovelSuffix('今天天气', '，天气很好')).toBe('很好');
    expect(getVideoAiTranscriptNovelSuffix('今天天气', '世界和平')).toBe('世界和平');
    expect(getVideoAiTranscriptNovelSuffix('the quick', 'now the quick brown')).toBe('brown');
    expect(getVideoAiTranscriptNovelSuffix('traffic move', 'traffic moved slowly')).toBe('slowly');
    expect(getVideoAiTranscriptNovelSuffix('alpha beta', 'gamma delta')).toBe('gamma delta');

    expect(areVideoAiTranscriptTextsRelated('', 'hello')).toBe(false);
    expect(areVideoAiTranscriptCorrectionVariants('!!!', 'hello')).toBe(false);
    expect(areVideoAiTranscriptTextsRelated('hello', 'hello')).toBe(true);
    expect(areVideoAiTranscriptTextsRelated('a', 'a')).toBe(true);
    expect(areVideoAiTranscriptTextsRelated('a', 'b')).toBe(false);
    expect(mergeVideoAiTranscriptText('', 'right')).toBe('right');
    expect(mergeVideoAiTranscriptText('left', '')).toBe('left');
    expect(mergeVideoAiTranscriptText('Same words', 'same words')).toBe('same words');
    expect(mergeVideoAiTranscriptText('same words', 'SAME WORDS')).toBe('SAME WORDS');
    expect(mergeVideoAiTranscriptText('Same words!', 'same words')).toBe('Same words!');
    expect(mergeVideoAiTranscriptText('今天天气', '天气很好')).toBe('今天天气很好');
    expect(mergeVideoAiTranscriptText('first', 'second')).toBe('first second');

    const reverseBoundary = new VideoAiTranscriptStabilizer();
    expect(reverseBoundary.ingest({ startMs: 0, durationMs: 2_000, availableAtMs: 2_100, text: 'gamma delta alpha beta' })).toHaveLength(1);
    expect(reverseBoundary.ingest({ startMs: 1_000, durationMs: 1_000, availableAtMs: 3_100, text: 'omega theta gamma' })).toHaveLength(1);
    const shortBoundary = new VideoAiTranscriptStabilizer();
    expect(shortBoundary.ingest({ startMs: 0, durationMs: 2_000, availableAtMs: 2_100, text: 'gamma delta x beta' })).toHaveLength(1);
    expect(shortBoundary.ingest({ startMs: 1_000, durationMs: 1_000, availableAtMs: 3_100, text: 'x omega theta' })).toHaveLength(1);
  });

  it('protects correction variants from numeric and short phrase mismatches', () => {
    expect(areVideoAiTranscriptCorrectionVariants('Opened 11 windows today', 'Opened 12 windows today')).toBe(false);
    expect(areVideoAiTranscriptCorrectionVariants('Opened 11 windows today', 'Opened 11 windows now')).toBe(true);
    expect(areVideoAiTranscriptCorrectionVariants('one two', 'one two')).toBe(false);
  });

  it('normalizes segment timing fallbacks and empty window text', () => {
    const stabilizer = new VideoAiTranscriptStabilizer();
    expect(stabilizer.ingest({
      startMs: 0,
      durationMs: 1_000,
      availableAtMs: 1_200,
      segments: [
        { startMs: Number.NaN, endMs: Number.NaN, text: 'hello from the model' },
        { startMs: 900, endMs: 100, text: 'discarded' },
      ],
    })).toHaveLength(1);
    expect(stabilizer.ingest({ startMs: 2_000, durationMs: 1_000, availableAtMs: 3_200 })).toEqual([]);

    const cjk = new VideoAiTranscriptStabilizer();
    expect(cjk.ingest({ startMs: 0, durationMs: 1_500, availableAtMs: 1_700, text: '今天天气很好我们出去' })).toHaveLength(1);

    const cjkBoundary = new VideoAiTranscriptStabilizer();
    expect(cjkBoundary.ingest({ startMs: 0, durationMs: 2_000, availableAtMs: 2_100, text: '今天天气很好我们' })).toHaveLength(1);
    expect(cjkBoundary.ingest({ startMs: 1_000, durationMs: 1_000, availableAtMs: 3_100, text: '新的 句子' })).toEqual([]);

    const punctuation = new VideoAiTranscriptStabilizer();
    expect(punctuation.ingest({ startMs: 0, durationMs: 1_000, availableAtMs: 1_200, text: 'Hello world.' })).toEqual([]);
    expect(punctuation.ingest({ startMs: 200, durationMs: 1_000, availableAtMs: 1_800, text: 'Hello world.' })).toHaveLength(1);
    expect(punctuation.ingest({ startMs: 2_000, durationMs: 3_000, availableAtMs: 5_200, text: 'long phrase' })).toEqual([]);
    expect(punctuation.ingest({ startMs: 6_000, durationMs: 1_000, availableAtMs: 7_200, text: '!!!' })).toEqual([]);
    expect(punctuation.ingest({ startMs: 8_000, durationMs: 1_000, availableAtMs: 9_200, text: '你好。' })).toHaveLength(1);
    expect(punctuation.ingest({ startMs: 10_000, durationMs: 1_000, availableAtMs: 11_200, text: 'Hello.' })).toEqual([]);
    expect(punctuation.ingest({ startMs: 10_200, durationMs: 1_000, availableAtMs: 11_800, text: 'Hello.' })).toEqual([]);
  });

  it('exercises held phrase replacement, earlier replay, prefix extension, and flush', () => {
    const held = new VideoAiTranscriptStabilizer();
    expect(held.ingest({ startMs: 10_000, durationMs: 400, availableAtMs: 10_500, text: 'maybe' })).toEqual([]);
    expect(held.ingest({ startMs: 9_000, durationMs: 400, availableAtMs: 11_000, text: 'earlier' })).toEqual([]);
    expect(held.ingest({ startMs: 12_000, durationMs: 2_000, availableAtMs: 12_300, text: 'This is a complete sentence.' })).toHaveLength(1);

    const clearHeld = new VideoAiTranscriptStabilizer();
    expect(clearHeld.ingest({ startMs: 0, durationMs: 400, availableAtMs: 500, text: 'maybe' })).toEqual([]);
    expect(clearHeld.ingest({ startMs: 1_000, durationMs: 0, availableAtMs: 1_000 })).toEqual([]);
    expect(clearHeld.ingest({ startMs: 2_000, durationMs: 0, availableAtMs: 2_300 })).toEqual([]);

    const delayedCommit = new VideoAiTranscriptStabilizer();
    expect(delayedCommit.ingest({ startMs: 0, durationMs: 3_000, availableAtMs: 500, text: 'a readable phrase' })).toEqual([]);
    expect(delayedCommit.ingest({ startMs: 4_000, durationMs: 2_000, availableAtMs: 2_300, text: 'Another complete sentence.' })).toMatchObject([
      { text: 'a readable phrase', partial: false },
      { text: 'Another complete sentence.' },
    ]);

    const prefix = new VideoAiTranscriptStabilizer();
    const first = prefix.ingest({ startMs: 0, durationMs: 1_600, availableAtMs: 1_700, text: 'The speaker reviewed the' });
    expect(first).toHaveLength(1);
    const expanded = prefix.ingest({ startMs: 500, durationMs: 2_600, availableAtMs: 3_500, text: 'The speaker reviewed the numbers and explained why.' });
    expect(expanded).toMatchObject([{ cueId: first[0].cueId, text: 'The speaker reviewed the numbers and explained why.' }]);

    const emptyFirstWord = new VideoAiTranscriptStabilizer();
    expect(emptyFirstWord.ingest({ startMs: 0, durationMs: 2_000, availableAtMs: 2_100, text: 'A complete sentence appears here.' })).toHaveLength(1);
    expect(emptyFirstWord.ingest({ startMs: 1_000, durationMs: 1_000, availableAtMs: 3_100, text: '!!!' })).toEqual([]);

    const emptyContinuation = new VideoAiTranscriptStabilizer();
    expect(emptyContinuation.ingest({ startMs: 0, durationMs: 1_600, availableAtMs: 1_700, text: 'Outside traffic moved slowly' })).toHaveLength(1);
    expect(emptyContinuation.ingest({ startMs: 300, durationMs: 1_000, availableAtMs: 2_300, text: 'traffic moved' })).toEqual([]);

    const flush = new VideoAiTranscriptStabilizer();
    expect(flush.ingest({ startMs: 0, durationMs: 3_000, availableAtMs: 1_500, text: 'a readable phrase' })).toEqual([]);
    expect(flush.flush(3_000)).toMatchObject([{ text: 'a readable phrase' }]);
  });

  it('covers continuation rejection and partial correction guards', () => {
    const tooLong = new VideoAiTranscriptStabilizer();
    expect(tooLong.ingest({ startMs: 0, durationMs: 5_900, availableAtMs: 6_000, text: 'The first sentence has enough words to display now.' })).toHaveLength(1);
    expect(tooLong.ingest({ startMs: 5_000, durationMs: 2_000, availableAtMs: 8_000, text: 'and rain falls' })).toEqual([]);

    const duplicate = new VideoAiTranscriptStabilizer();
    const first = duplicate.ingest({ startMs: 0, durationMs: 1_600, availableAtMs: 1_700, text: 'The subtitle system works.' });
    expect(first).toHaveLength(1);
    expect(duplicate.ingest({ startMs: 200, durationMs: 1_600, availableAtMs: 2_000, text: 'The subtitle system works.' })).toEqual([]);

    const partial = new VideoAiTranscriptStabilizer();
    const preview = partial.ingest({ startMs: 0, durationMs: 1_600, availableAtMs: 1_700, text: 'We opened the lab.' });
    expect(preview[0]?.partial).toBe(true);
    expect(partial.ingest({ startMs: 200, durationMs: 1_600, availableAtMs: 2_000, text: 'We opened the lab.' })).toEqual([]);
    expect(partial.ingest({ startMs: 300, durationMs: 1_600, availableAtMs: 2_200, text: 'We opened the lab every morning.' })).toMatchObject([{ text: 'We opened the lab every morning.' }]);

    const partialBoundary = new VideoAiTranscriptStabilizer();
    expect(partialBoundary.ingest({ startMs: 0, durationMs: 1_600, availableAtMs: 1_700, text: 'Alpha beta gamma delta.' })).toHaveLength(1);
    expect(partialBoundary.ingest({ startMs: 300, durationMs: 1_600, availableAtMs: 2_200, text: 'Omega betas theta' })).toEqual([]);

    const negation = new VideoAiTranscriptStabilizer();
    expect(negation.ingest({ startMs: 0, durationMs: 1_600, availableAtMs: 1_700, text: 'We can release the model.' })).toHaveLength(1);
    expect(negation.ingest({ startMs: 300, durationMs: 1_600, availableAtMs: 2_200, text: 'We cannot release the model today.' })).toMatchObject([{ text: 'We cannot release the model today.' }]);

    const numbers = new VideoAiTranscriptStabilizer();
    expect(numbers.ingest({ startMs: 0, durationMs: 1_600, availableAtMs: 1_700, text: 'We opened 11 windows today.' })).toHaveLength(1);
    expect(numbers.ingest({ startMs: 300, durationMs: 1_600, availableAtMs: 2_200, text: 'We opened 12 windows today.' })).toMatchObject([{ text: 'We opened 12 windows today.' }]);

    const sequence = new VideoAiTranscriptStabilizer();
    const firstCue = sequence.ingest({ startMs: 0, durationMs: 2_000, availableAtMs: 2_100, text: 'The first sequence stays monotonic.' });
    expect(firstCue[0]?.cueId).toBe('ai-1');
    sequence.reset(true);
    const retainedCue = sequence.ingest({ startMs: 3_000, durationMs: 2_000, availableAtMs: 5_100, text: 'The second sequence stays monotonic.' });
    expect(retainedCue[0]?.cueId).toBe('ai-2');
    sequence.reset();
    expect(sequence.ingest({ startMs: 6_000, durationMs: 2_000, availableAtMs: 8_100, text: 'The reset sequence starts over.' })[0]?.cueId).toBe('ai-1');
  });
});

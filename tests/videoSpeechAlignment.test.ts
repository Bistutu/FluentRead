import {describe, expect, it} from 'vitest';
import {alignVideoAiSegmentsToSpeech, findVideoAiPauseBoundary} from '@/src/features/video-subtitle/content/video-ai/speechAlignment';

function pcm(durationMs: number, ranges: [number, number][]): Float32Array {
  const audio = new Float32Array(durationMs * 16);
  for (const [start, end] of ranges) audio.fill(0.1, start * 16, end * 16);
  return audio;
}
describe('音频停顿与完整字幕对齐', () => {
  it('从句级时间戳两侧去掉明显静音，保留轻声边界余量及文字', () => {
    const audio = pcm(6000, [[0, 1800], [3200, 5000]]);
    expect(alignVideoAiSegmentsToSpeech(audio, [
      {startMs: 0, endMs: 2400, text: 'First sentence.'},
      {startMs: 2400, endMs: 6000, text: 'Second sentence.'},
    ])).toEqual([
      {startMs: 0, endMs: 1840, text: 'First sentence.'},
      {startMs: 3160, endMs: 5040, text: 'Second sentence.'},
    ]);
  });
  it('短停顿与连续背景声音不改变模型给定边界', () => {
    const audio = pcm(1000, [[80, 920]]);
    expect(alignVideoAiSegmentsToSpeech(audio, [{startMs: 0, endMs: 1000, text: 'quiet edges'}]))
      .toEqual([{startMs: 0, endMs: 1000, text: 'quiet edges'}]);
    const short = new Float32Array(50).fill(0.01);
    expect(alignVideoAiSegmentsToSpeech(short, [{text: 'tiny'}])).toEqual([{text: 'tiny', startMs: 0, endMs: 3.125}]);
  });
  it('空音频、静音及非有限采样不捏造新的时间戳', () => {
    const segments = [{startMs: 0, endMs: 1000, text: 'low volume'}];
    const audio = new Float32Array(16000);audio[0] = NaN;audio[1] = Infinity;
    expect(alignVideoAiSegmentsToSpeech(audio, segments)).toEqual(segments);
    expect(alignVideoAiSegmentsToSpeech(new Float32Array(), segments)).toEqual(segments);
    expect(alignVideoAiSegmentsToSpeech(audio, [])).toEqual([]);
    expect(alignVideoAiSegmentsToSpeech(pcm(1000, [[0, 1000]]), [{startMs: NaN, endMs: NaN}]))
      .toEqual([{startMs: 0, endMs: 1000}]);
  });
  it('长窗优先从后半段自然停顿切开，连续语音仍保留重叠窗口', () => {
    expect(findVideoAiPauseBoundary(pcm(10000, [[0, 3900], [5200, 9000]]))).toBe(9500);
    expect(findVideoAiPauseBoundary(pcm(10000, [[0, 3000], [4000, 10000]]))).toBe(0);
    expect(findVideoAiPauseBoundary(pcm(10000, [[0, 6100], [7500, 10000]]))).toBe(6800);
    expect(findVideoAiPauseBoundary(pcm(10000, [[0, 9750]]))).toBe(0);
    expect(findVideoAiPauseBoundary(pcm(10000, [[0, 10000]]))).toBe(0);
    expect(findVideoAiPauseBoundary(new Float32Array())).toBe(0);
  });
  it('模型提前截断词尾时补齐到邻近停顿，不越过下一句或连续背景声', () => {
    const audio=pcm(4000,[[0,2400],[3200,4000]]);
    expect(alignVideoAiSegmentsToSpeech(audio,[{startMs:0,endMs:1900,text:'complete the word'}])[0].endMs).toBe(2440);
    expect(alignVideoAiSegmentsToSpeech(audio,[{startMs:0,endMs:1900},{startMs:2100,endMs:2400}])[0].endMs).toBe(1900);
    expect(alignVideoAiSegmentsToSpeech(pcm(4000,[[0,4000]]),[{startMs:0,endMs:1900}])[0].endMs).toBe(1900);
    expect(alignVideoAiSegmentsToSpeech(audio,[{startMs:0,endMs:2400}])[0].endMs).toBe(2440);
  });

  it('下一句已在静音后起声但模型句尾越界时，收紧到长停顿前', () => {
    const audio = pcm(9000, [[0, 1340], [2750, 5020], [6420, 8650]]);
    const aligned = alignVideoAiSegmentsToSpeech(audio, [
      {startMs: 0, endMs: 1400, text: '첫 문장.'},
      {startMs: 2740, endMs: 6460, text: '둘째 문장.'},
      {startMs: 6460, endMs: 8800, text: '셋째 문장.'},
    ]);
    expect(aligned[1].endMs).toBe(5060);
    expect(alignVideoAiSegmentsToSpeech(audio, [
      {startMs: 2740, endMs: 6800, text: '모델 경계가 이미 정지 구간을 넘음.'},
      {startMs: 6460, endMs: 8800, text: '다음 문장.'},
    ])[0].endMs).toBe(6800);
    expect(alignVideoAiSegmentsToSpeech(audio, [
      {startMs: 2740, endMs: 6460, text: '下一句起点过早.'},
      {startMs: 6300, endMs: 8800, text: '实际起声稍晚.'},
    ])[0].endMs).toBe(5060);
  });

  it('稳定背景底噪上方仍能找到语音停顿，连续音量变化不猜测停顿', () => {
    const noisy = new Float32Array(6000 * 16).fill(0.008);
    noisy.fill(0.1, 0, 1800 * 16);
    noisy.fill(0.1, 3200 * 16, 5000 * 16);
    expect(alignVideoAiSegmentsToSpeech(noisy, [
      {startMs: 0, endMs: 2400, text: 'First.'},
      {startMs: 2400, endMs: 6000, text: 'Second.'},
    ])).toEqual([
      {startMs: 0, endMs: 1840, text: 'First.'},
      {startMs: 3160, endMs: 5040, text: 'Second.'},
    ]);
    expect(findVideoAiPauseBoundary(noisy)).toBe(5500);
    const continuous = new Float32Array(6000 * 16);
    // 能量在多个等级持续变化，没有稳定底噪平台，不能据此裁剪语音。
    for (let i = 0; i < continuous.length; i += 1) continuous[i] = 0.005 * (1 + Math.floor(i / (600 * 16))) ** 2;
    expect(alignVideoAiSegmentsToSpeech(continuous, [{startMs: 0, endMs: 6000}]))
      .toEqual([{startMs: 0, endMs: 6000}]);
    expect(findVideoAiPauseBoundary(new Float32Array(6000 * 16).fill(0.008))).toBe(0);
  });

  it('变化的背景声不会触发自适应切窗而切断模型上下文', () => {
    const audio = new Float32Array(10000 * 16).fill(0.1);
    for (let i = 5000 * 16; i < 7500 * 16; i += 1) {
      audio[i] = 0.008 + 0.004 * (i - 5000 * 16) / (2500 * 16);
    }
    expect(findVideoAiPauseBoundary(audio)).toBe(0);
  });

  it('低音量词尾与原幅一样保留边界，数字停顿仍可作为分窗边界', () => {
    const audio = pcm(10000, [[0, 6100], [7500, 10000]]);
    const quiet = audio.map(sample => sample * 0.003);
    expect(findVideoAiPauseBoundary(quiet)).toBe(findVideoAiPauseBoundary(audio));
    const segments = [{startMs: 0, endMs: 6800, text: 'First original sentence.'},
      {startMs: 6800, endMs: 10000, text: 'Quiet final word.'}];
    expect(alignVideoAiSegmentsToSpeech(quiet, segments)).toEqual(alignVideoAiSegmentsToSpeech(audio, segments));
    const quietTail = pcm(10400, [[0, 9200]]);
    quietTail.fill(0.0001, 9700 * 16);
    expect(findVideoAiPauseBoundary(quietTail.subarray(0, 10000 * 16))).toBe(9450);
    expect(alignVideoAiSegmentsToSpeech(quietTail, [{startMs: 0, endMs: 10400, text: 'Keep the final word.'}])[0].endMs).toBe(10400);
  });

  it('稳定低量底噪有明显语音差距时仍自适应，恒定弱声不猜测停顿', () => {
    const audio = new Float32Array(6000 * 16).fill(0.00008);
    audio.fill(0.0008, 0, 1800 * 16);
    audio.fill(0.0008, 3200 * 16, 5000 * 16);
    expect(findVideoAiPauseBoundary(audio)).toBe(5500);
    const constant = new Float32Array(6000 * 16).fill(0.00008);
    expect(findVideoAiPauseBoundary(constant)).toBe(0);
    const spike = new Float32Array(320);
    spike[0] = 2 / 32768;
    expect(alignVideoAiSegmentsToSpeech(spike, [{startMs: 0, endMs: 20}])).toEqual([{startMs: 0, endMs: 20}]);
    expect(findVideoAiPauseBoundary(new Float32Array(10000 * 16).fill(1 / 32768))).toBe(0);
  });

  it('重叠窗口开头残留的前句词尾不算本句起声，从其后的长停顿之后对齐', () => {
    // 窗口从上一句结束前 190 ms 开始，模型把下一句从窗口起点计时。
    const audio = pcm(4940, [[0, 190], [1610, 4900]]);
    const segments = [{startMs: 0, endMs: 4940, text: 'The speaker reviewed the numbers.'}];
    expect(alignVideoAiSegmentsToSpeech(audio, segments)).toEqual(segments);
    expect(alignVideoAiSegmentsToSpeech(audio, segments, 280))
      .toEqual([{startMs: 1560, endMs: 4940, text: 'The speaker reviewed the numbers.'}]);
    // 已归属终点仍在连续语音内、之后只有短停顿、或落在句子之外时保持模型边界。
    expect(alignVideoAiSegmentsToSpeech(audio, segments, 100)).toEqual(segments);
    expect(alignVideoAiSegmentsToSpeech(pcm(4940, [[0, 190], [500, 4900]]), segments, 280)).toEqual(segments);
    expect(alignVideoAiSegmentsToSpeech(audio, segments, 6000)).toEqual(segments);
    expect(alignVideoAiSegmentsToSpeech(audio, segments, -8800)).toEqual(segments);
    expect(alignVideoAiSegmentsToSpeech(audio, segments, NaN)).toEqual(segments);
    // 停顿从句首就开始时沿用原有的句首静音修剪；之后没有语音则不改时间戳。
    expect(alignVideoAiSegmentsToSpeech(pcm(4940, [[1610, 4900]]), segments, 280)[0].startMs).toBe(1560);
    expect(alignVideoAiSegmentsToSpeech(pcm(4940, [[0, 190]]), segments, 280)).toEqual(segments);
    // 只调整跨过已归属终点的句子，后续句子不受影响。
    expect(alignVideoAiSegmentsToSpeech(pcm(6000, [[0, 190], [1610, 3000], [4000, 5900]]), [
      {startMs: 0, endMs: 3400, text: 'Second.'},
      {startMs: 3400, endMs: 6000, text: 'Third.'},
    ], 280)).toEqual([
      {startMs: 1560, endMs: 3040, text: 'Second.'},
      {startMs: 3960, endMs: 6000, text: 'Third.'},
    ]);
  });

  it('编码后缓慢漂移的极低底噪仍按停顿处理，语音与底噪差距不足时不放宽', () => {
    // 取自 X 夹具第二个识别窗口的形态：停顿内 RMS 在 54e-6 到 114e-6 间漂移，
    // 10%/20% 分位之比超过 1.5，旧规则会退回峰值判定并把整段停顿当成语音。
    const drifting = (scale: number) => {
      const audio = new Float32Array(4940 * 16);
      for (let frame = 0; frame * 320 < audio.length; frame += 1) {
        audio.fill(scale * (frame < 30 || frame > 55 ? 0.000055 : 0.00011), frame * 320, (frame + 1) * 320);
      }
      audio.fill(0.2, 0, 200 * 16);
      audio.fill(0.2, 1620 * 16, 4900 * 16);
      return audio;
    };
    const segments = [{startMs: 0, endMs: 4940, text: 'The speaker reviewed the numbers.'}];
    expect(alignVideoAiSegmentsToSpeech(drifting(1), segments, 280))
      .toEqual([{startMs: 1580, endMs: 4940, text: 'The speaker reviewed the numbers.'}]);
    expect(alignVideoAiSegmentsToSpeech(drifting(1), [{startMs: 200, endMs: 4940}])[0].startMs).toBe(1580);
    // 低能量帧只比语音低约 26 dB 时可能是配乐或环境声，保持模型边界。
    expect(alignVideoAiSegmentsToSpeech(drifting(100), segments, 280)).toEqual(segments);
    // 分窗边界仍只接受几乎恒定的底噪，漂移底噪不触发自适应切窗。
    expect(findVideoAiPauseBoundary(drifting(1))).toBe(0);
  });

});

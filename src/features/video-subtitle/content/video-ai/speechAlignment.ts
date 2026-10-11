/**
 * @file src/features/video-subtitle/content/video-ai/speechAlignment.ts
 * 文件职责：使用已经采集的 PCM 声音边界校准 Whisper 句级时间戳，避免将明显停顿显示为下一句。
 * 主要内容：计算二十毫秒音频活动帧、估计稳定底噪，保守收紧句子外侧停顿、跳过重叠窗口开头已归属上一句的残留语音并选择完整识别窗口边界。
 * 模块边界：只读音频和相对时间戳，不改变文本或全局播放头，不进行推理；仅在稳定低噪声平台与语音能量有明显差距时估计底噪；无法区分的连续声音保留模型边界。
 */
import type {VideoAiTranscriptSegment} from './streamingTranscript';
import {WHISPER_DIGITAL_SILENCE_PEAK} from '@/src/features/video-subtitle/transcription';

const FRAME_SAMPLES = 320;
const FRAME_MS = 20;
const TRAILING_SILENCE_MIN_MS = 160;
const TRAILING_SILENCE_EDGE_TOLERANCE_MS = 200;
const ATTRIBUTED_SPEECH_PAUSE_MIN_MS = 360;
const CLEAN_SPEECH_FLOOR_RATIO = 100;
function activeFrames(audio: Float32Array, maximumNoiseVariation = 1.5, cleanSpeechFloorRatio = CLEAN_SPEECH_FLOOR_RATIO): boolean[] {
  const energies: number[] = [];
  const peaks: number[] = [];
  for (let start = 0; start < audio.length; start += FRAME_SAMPLES) {
    const end = Math.min(audio.length, start + FRAME_SAMPLES);
    let energy = 0;
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const value = Number.isFinite(audio[index]) ? audio[index] : 0;
      energy += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    energies.push(Math.sqrt(energy / (end - start)));
    peaks.push(peak);
  }
  // 固定绝对阈值会把持续风声/低背景音当成语音。只有至少一秒音频中
  // 较低能量帧形成稳定平台，且高能量语音明显高于它时才提高门槛。
  // 不对纯音乐、匀速变化的声音或不足以估计底噪的短片段猜测停顿。
  // 未确证稳定底噪时只按数字静音峰值判停顿，低音量词尾不能被 RMS 门切掉。
  let threshold: number | null = null;
  if (energies.length >= 50) {
    const ordered = [...energies].sort((left, right) => left - right);
    const floor = ordered[Math.floor(ordered.length * 0.1)];
    const plateau = ordered[Math.floor(ordered.length * 0.2)];
    const speech = ordered[Math.floor(ordered.length * 0.8)];
    if (floor > WHISPER_DIGITAL_SILENCE_PEAK && plateau <= floor * maximumNoiseVariation && speech >= floor * 4) {
      threshold = floor * 1.8;
    } else if (floor > WHISPER_DIGITAL_SILENCE_PEAK && speech >= plateau * cleanSpeechFloorRatio) {
      // 有损编码把停顿变成缓慢漂移的极低噪声，短窗口里 10%/20% 分位之比会
      // 略超稳定平台上限。语音高出低能量帧 40 dB 以上时这些帧不可能是配乐或
      // 人声，按较高的分位定门槛，避免漂移的停顿被逐帧误判成语音。
      threshold = plateau * 1.8;
    }
  }
  return energies.map((energy, index) => threshold === null
    ? peaks[index] > WHISPER_DIGITAL_SILENCE_PEAK : energy >= threshold);
}

/**
 * 仅修剪模型边界内的外侧静音；保留一小段余量，避免吞掉轻声辅音。
 * attributedSpeechEndMs 是上一个识别窗口已经归属给前句的语音终点（相对本窗口）。
 * 重叠窗口会重新带上前句的词尾，模型常把下一句从窗口起点开始计时；只有该终点
 * 落在一段自然停顿内时，才从停顿之后寻找本句起声，否则保留原有判断。
 */
export function alignVideoAiSegmentsToSpeech(
  audio: Float32Array,
  segments: readonly VideoAiTranscriptSegment[],
  attributedSpeechEndMs = 0,
): VideoAiTranscriptSegment[] {
  const frames = activeFrames(audio);
  const durationMs = audio.length / 16;
  return segments.map((segment, segmentIndex) => {
    const start = Math.max(0, Number.isFinite(segment.startMs) ? segment.startMs! : 0);
    let end = Math.min(durationMs, Number.isFinite(segment.endMs) ? segment.endMs! : durationMs);
    // 句级模型有时在最后一个词尚未说完时提前结束。仅当这个边界仍位于
    // 活动语音内、且 800 ms 内出现明确停顿时，补齐到停顿前；连续背景声不扩展。
    const endFrame = Math.floor(end / FRAME_MS);
    const nextStart = segments[segmentIndex + 1]?.startMs;
    if (Number.isFinite(nextStart)) {
      // Whisper can end a sentence just after the next sentence starts. In
      // that shape, the current end frame is active, so the old forward scan
      // treated the following sentence as the tail of the current one. When a
      // long silent run immediately precedes that active tail, snap to the
      // first sentence's side of the pause. The edge tolerance keeps short
      // intra-sentence hesitations and model jitter untouched.
      const nextFrameStart = Math.min(frames.length - 1, Math.max(0, Math.floor(nextStart! / FRAME_MS)));
      let nextFrame = nextFrameStart;
      // Whisper may announce the next sentence slightly before its first
      // active frame. Look through that short lead-in so the preceding long
      // silence is still recognized without treating a distant pause as a
      // sentence boundary.
      while (nextFrame < frames.length && nextFrame - nextFrameStart <= TRAILING_SILENCE_EDGE_TOLERANCE_MS / FRAME_MS && !frames[nextFrame]) {
        nextFrame += 1;
      }
      if (nextFrame < frames.length && frames[nextFrame]) {
        let activeTailStart = nextFrame;
        while (activeTailStart > 0 && frames[activeTailStart - 1]) activeTailStart -= 1;
        let silenceStart = activeTailStart;
        while (silenceStart > 0 && !frames[silenceStart - 1]) silenceStart -= 1;
        const silenceStartMs = silenceStart * FRAME_MS;
        const silenceEndMs = activeTailStart * FRAME_MS;
        if (silenceEndMs - silenceStartMs >= TRAILING_SILENCE_MIN_MS
          && end - silenceEndMs <= TRAILING_SILENCE_EDGE_TOLERANCE_MS
          && nextStart! - silenceEndMs <= TRAILING_SILENCE_EDGE_TOLERANCE_MS) {
          end = Math.min(end, silenceStartMs + 40);
        }
      }
    }
    if (frames[endFrame] || frames[endFrame - 1]) {
      const nextStart = segments[segmentIndex + 1]?.startMs;
      const limit = Math.floor(Math.min(durationMs, end + 800,
        Number.isFinite(nextStart) ? nextStart! : durationMs) / FRAME_MS);
      let lastActive = endFrame - 1;
      for (let index = endFrame; index < limit; index += 1) {
        if (frames[index]) lastActive = index;
        else if (index - lastActive >= 8) {
          end = Math.max(end, (lastActive + 1) * FRAME_MS + 40);
          break;
        }
      }
    }
    let firstFrame = Math.max(0, Math.floor(start / FRAME_MS));
    const lastFrame = Math.min(frames.length, Math.ceil(end / FRAME_MS));
    const attributedFrame = Math.floor(attributedSpeechEndMs / FRAME_MS);
    if (attributedFrame > firstFrame && attributedFrame < lastFrame && !frames[attributedFrame]) {
      let pauseStart = attributedFrame;
      while (pauseStart > firstFrame && !frames[pauseStart - 1]) pauseStart -= 1;
      let pauseEnd = attributedFrame;
      while (pauseEnd < lastFrame && !frames[pauseEnd]) pauseEnd += 1;
      if ((pauseEnd - pauseStart) * FRAME_MS >= ATTRIBUTED_SPEECH_PAUSE_MIN_MS) firstFrame = pauseEnd;
    }
    let first = -1;
    let last = -1;
    for (let index = firstFrame; index < lastFrame; index += 1) {
      if (!frames[index]) continue;
      if (first < 0) first = index;
      last = index;
    }
    if (first < 0) return {...segment};
    const spokenStart = Math.max(start, first * FRAME_MS - 40);
    const spokenEnd = Math.min(end, (last + 1) * FRAME_MS + 40);
    return {...segment,
      startMs: spokenStart - start >= 160 ? spokenStart : start,
      endMs: end - spokenEnd >= 160 ? spokenEnd : end,
    };
  });
}

/** 在窗口后半段选择足够长的自然停顿，避免把半句话切进相邻识别窗口。 */
export function findVideoAiPauseBoundary(audio: Float32Array): number {
  // 切割模型输入比微调输出边界更敏感：只有几乎恒定的背景噪声才允许
  // 自适应切窗，动态音乐继续保留重叠上下文，避免切断轻声词尾。
  const frames = activeFrames(audio, 1.08, Infinity);
  const minimumBoundary = audio.length / 16 * 0.55;
  let silenceStart = 0;
  let boundary = 0;
  for (let index = 0; index <= frames.length; index += 1) {
    if (frames[index] || index === frames.length) {
      const middleMs = (silenceStart + index) * FRAME_MS / 2;
      if ((index - silenceStart) * FRAME_MS >= 360 && middleMs >= minimumBoundary) boundary = middleMs;
      silenceStart = index + 1;
    }
  }
  return boundary;
}

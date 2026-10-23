/**
 * @file src/features/video-subtitle/content/video-ai/audioWindow.ts
 * 文件职责：维护 16 kHz 音频窗口、流式重采样、语音活动检测与 PCM 编码。
 * 主要内容：保证跨 AudioContext 回调的采样相位连续，并为完整识别及其隐藏扫描回退提供统一音频契约。
 * 模块边界：只处理音频数值与窗口策略，不创建播放器节点，也不发起识别请求。
 */
import { WHISPER_DIGITAL_SILENCE_PEAK } from '@/src/features/video-subtitle/transcription';

export const VIDEO_AI_SAMPLE_RATE = 16_000;

export interface VideoAiSpeechActivity {
  active: boolean;
  peak: number;
  rms: number;
  activeFrameRatio: number;
}

/**
 * 有状态线性重采样器。与逐块从相位 0 开始不同，它保存下一输出采样点的
 * 全局小数位置和上一块尾样本，避免长视频累计四舍五入漂移及块边界断裂。
 */
export class VideoAiStreamingResampler {
  private sourceSampleRate = 0;
  private totalInputSamples = 0;
  private nextOutputSourcePosition = 0;
  private previousSample = 0;

  reset(): void {
    this.sourceSampleRate = 0;
    this.totalInputSamples = 0;
    this.nextOutputSourcePosition = 0;
    this.previousSample = 0;
  }

  process(
    channels: readonly Float32Array[],
    sourceSampleRate: number,
    targetSampleRate = VIDEO_AI_SAMPLE_RATE,
  ): Float32Array {
    const sourceLength = channels.reduce((longest, channel) => Math.max(longest, channel.length), 0);
    if (channels.length === 0 || sourceLength === 0) return new Float32Array();
    const normalizedSourceRate = Number.isFinite(sourceSampleRate) && sourceSampleRate > 0
      ? sourceSampleRate
      : targetSampleRate;
    if (this.sourceSampleRate !== normalizedSourceRate) {
      this.reset();
      this.sourceSampleRate = normalizedSourceRate;
    }

    const mono = new Float32Array(sourceLength);
    for (let index = 0; index < sourceLength; index += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] || 0;
      mono[index] = sample / channels.length;
    }

    if (normalizedSourceRate === targetSampleRate) {
      this.totalInputSamples += sourceLength;
      this.previousSample = mono[sourceLength - 1];
      this.nextOutputSourcePosition = this.totalInputSamples;
      return mono;
    }

    const chunkStart = this.totalInputSamples;
    const chunkEnd = chunkStart + sourceLength - 1;
    const ratio = normalizedSourceRate / targetSampleRate;
    const estimatedLength = this.nextOutputSourcePosition <= chunkEnd
      ? Math.floor((chunkEnd - this.nextOutputSourcePosition) / ratio) + 1
      : 0;
    const output = new Float32Array(Math.max(0, estimatedLength));
    let outputLength = 0;

    const readSample = (globalIndex: number): number => {
      if (globalIndex < chunkStart) return this.previousSample;
      return mono[Math.min(sourceLength - 1, Math.max(0, globalIndex - chunkStart))];
    };

    while (this.nextOutputSourcePosition <= chunkEnd + 1e-7 && outputLength < output.length) {
      const leftIndex = Math.floor(this.nextOutputSourcePosition);
      const rightIndex = Math.min(leftIndex + 1, chunkEnd);
      const fraction = this.nextOutputSourcePosition - leftIndex;
      const left = readSample(leftIndex);
      const right = readSample(rightIndex);
      output[outputLength] = left + (right - left) * fraction;
      outputLength += 1;
      this.nextOutputSourcePosition += ratio;
    }

    this.totalInputSamples += sourceLength;
    this.previousSample = mono[sourceLength - 1];
    return output.subarray(0, outputLength);
  }
}

/**
 * 与 Worker 输入共用数字静音门；非零声音交由模型识别，不能以固定音量
 * 推断没有人声。RMS 与活动帧比例仅作统计，不因长停顿稀释整片语音。
 */
export function measureVideoAiSpeechActivity(
  audio: Float32Array,
  sampleRate = VIDEO_AI_SAMPLE_RATE,
): VideoAiSpeechActivity {
  if (audio.length === 0) return { active: false, peak: 0, rms: 0, activeFrameRatio: 0 };

  let peak = 0;
  let energy = 0;
  const frameSize = Math.max(1, Math.round(sampleRate * 0.02));
  let activeFrames = 0;
  let frameCount = 0;

  for (let frameStart = 0; frameStart < audio.length; frameStart += frameSize) {
    const frameEnd = Math.min(audio.length, frameStart + frameSize);
    let frameEnergy = 0;
    for (let index = frameStart; index < frameEnd; index += 1) {
      const sample = Number.isFinite(audio[index]) ? audio[index] : 0;
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
      const squared = sample * sample;
      frameEnergy += squared;
      energy += squared;
    }
    const frameRms = Math.sqrt(frameEnergy / Math.max(1, frameEnd - frameStart));
    if (frameRms > WHISPER_DIGITAL_SILENCE_PEAK) activeFrames += 1;
    frameCount += 1;
  }

  const rms = Math.sqrt(energy / audio.length);
  const activeFrameRatio = activeFrames / frameCount;
  return {
    active: peak > WHISPER_DIGITAL_SILENCE_PEAK,
    peak,
    rms,
    activeFrameRatio,
  };
}

/** 将 Float32 PCM 压成 16-bit little-endian，减少扩展消息约一半体积。 */
export function encodeVideoAiPcm16Base64(audio: Float32Array): string {
  if (audio.length === 0) return '';
  const bytes = new Uint8Array(audio.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < audio.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, Number.isFinite(audio[index]) ? audio[index] : 0));
    const value = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    view.setInt16(index * 2, value, true);
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

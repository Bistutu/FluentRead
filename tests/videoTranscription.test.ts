import { describe, expect, it } from 'vitest';
import {
  buildVideoTranscriptionEndpoint,
  getVideoLocalTranscriptionModelId,
  getVideoLocalTranscriptionModelLabel,
  getVideoLocalTranscriptionModelDescription,
  getVideoTranscriptionModel,
  normalizeVideoTranscriptionLanguage,
  normalizeVideoLocalTranscriptionModel,
  normalizeVideoLocalTranscriptionModels,
  resampleToWhisperAudio,
  supportsVideoTranscription,
} from '@/entrypoints/utils/videoTranscription';

describe('视频 AI 字幕转写配置', () => {
  it('只允许 OpenAI-compatible 转写服务', () => {
    expect(supportsVideoTranscription('openai')).toBe(true);
    expect(supportsVideoTranscription('groq')).toBe(true);
    expect(supportsVideoTranscription('custom')).toBe(true);
    expect(supportsVideoTranscription('microsoft')).toBe(false);
  });

  it('把聊天补全地址映射到 audio/transcriptions', () => {
    expect(buildVideoTranscriptionEndpoint('openai')).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(buildVideoTranscriptionEndpoint('groq')).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(buildVideoTranscriptionEndpoint('custom', { custom: 'http://127.0.0.1:11434/v1/chat/completions' }))
      .toBe('http://127.0.0.1:11434/v1/audio/transcriptions');
    expect(buildVideoTranscriptionEndpoint('newapi', { newApiUrl: 'https://api.example.com' }))
      .toBe('https://api.example.com/v1/audio/transcriptions');
  });

  it('规范化识别语言和默认模型', () => {
    expect(normalizeVideoTranscriptionLanguage('zh-CN')).toBe('zh');
    expect(normalizeVideoTranscriptionLanguage('auto')).toBeUndefined();
    expect(getVideoTranscriptionModel('openai')).toBe('whisper-1');
    expect(getVideoTranscriptionModel('groq')).toBe('whisper-large-v3-turbo');
  });

  it('使用扩展内本地 Whisper 模型，并对非法选择回退到 Tiny', () => {
    expect(normalizeVideoLocalTranscriptionModel('base')).toBe('base');
    expect(normalizeVideoLocalTranscriptionModel('unknown')).toBe('tiny');
    expect(getVideoLocalTranscriptionModelId('base')).toBe('onnx-community/whisper-base');
    expect(getVideoLocalTranscriptionModelLabel('tiny')).toContain('本地');
    expect(getVideoLocalTranscriptionModelDescription('base')).toContain('更稳');
    expect(normalizeVideoLocalTranscriptionModels(['tiny', 'base', 'unknown', 'tiny'])).toEqual(['tiny', 'base']);
  });

  it('将多声道音频重采样为单声道 PCM', () => {
    const result = resampleToWhisperAudio([
      new Float32Array([1, 1, 1, 1]),
      new Float32Array([-1, -1, -1, -1]),
    ], 8, 4);

    expect(result).toHaveLength(2);
    expect(Array.from(result)).toEqual([0, 0]);
  });
});

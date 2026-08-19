import { env, pipeline } from '@huggingface/transformers';
import {
  getVideoLocalTranscriptionModelId,
  normalizeVideoLocalTranscriptionModel,
  resampleToWhisperAudio,
} from '@/entrypoints/utils/videoTranscription';

type LocalTranscriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<unknown>;

export interface LocalVideoTranscriptionSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface LocalVideoTranscriptionResult {
  text: string;
  segments: LocalVideoTranscriptionSegment[];
  model: string;
}

let transcriberPromise: Promise<LocalTranscriber> | null = null;
let transcriberModelId = '';

// 模型通过 Transformers.js 下载到浏览器 Cache API；推理始终在扩展 offscreen 页面中完成。
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
// Hugging Face 的 resolve 地址会对部分浏览器扩展请求触发 WAF 405；
// ModelScope 提供同名 ONNX 模型的公开镜像，并允许扩展跨域读取。
env.remoteHost = 'https://modelscope.cn/models/';
env.remotePathTemplate = '{model}/resolve/{revision}/';
if (env.backends.onnx.wasm) {
  // 多个 X 视频分片会排队转写，单线程更容易控制内存，也避免抢占页面主线程。
  env.backends.onnx.wasm.numThreads = 1;
  // 把 ONNX Runtime 的 WASM loader 和二进制随扩展打包，避免首次识别
  // 还要从 jsDelivr 拉取执行引擎；模型文件仍按需下载并缓存。
  env.backends.onnx.wasm.wasmPaths = {
    mjs: chrome.runtime.getURL('fluent-read-ai/ort-wasm-simd-threaded.jsep.mjs'),
    wasm: chrome.runtime.getURL('fluent-read-ai/ort-wasm-simd-threaded.jsep.wasm'),
  };
}

function decodeBase64(value: string): ArrayBuffer {
  const encoded = value.startsWith('data:') ? value.slice(value.indexOf(',') + 1) : value;
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer;
}

async function decodeAudioToWhisperAudio(audio: ArrayBuffer): Promise<Float32Array> {
  const AudioContextConstructor = window.AudioContext
    || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('当前浏览器没有可用的 Web Audio 解码器');
  }

  const audioContext = new AudioContextConstructor();
  try {
    const decoded = await audioContext.decodeAudioData(audio.slice(0));
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    return resampleToWhisperAudio(channels, decoded.sampleRate);
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

async function getLocalTranscriber(model: unknown): Promise<LocalTranscriber> {
  const modelId = getVideoLocalTranscriptionModelId(normalizeVideoLocalTranscriptionModel(model));
  if (transcriberPromise && transcriberModelId === modelId) return transcriberPromise;

  transcriberModelId = modelId;
  transcriberPromise = pipeline('automatic-speech-recognition', modelId, {
    // 不依赖本机服务；WASM 是所有桌面 Chromium 都能用的本地后端。
    device: 'wasm',
    dtype: 'q8',
    revision: 'master',
  }).then((transcriber) => transcriber as unknown as LocalTranscriber).catch((error) => {
    transcriberPromise = null;
    transcriberModelId = '';
    throw error;
  });
  return transcriberPromise;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function cleanTranscriptText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^\[(?:blank_audio|silence)\]$/i.test(text) ? '' : text;
}

export async function transcribeLocalVideoAudio(request: {
  audioBase64: string;
  model?: unknown;
  sourceLanguage?: string;
}): Promise<LocalVideoTranscriptionResult> {
  if (!request.audioBase64) throw new Error('没有捕获到视频音频');

  const audio = await decodeAudioToWhisperAudio(decodeBase64(request.audioBase64));
  if (audio.length === 0) return { text: '', segments: [], model: normalizeVideoLocalTranscriptionModel(request.model) };

  const transcriber = await getLocalTranscriber(request.model);
  const sourceLanguage = typeof request.sourceLanguage === 'string'
    ? request.sourceLanguage.trim().toLowerCase().split(/[-_]/, 1)[0]
    : '';
  const output = await transcriber(audio, {
    return_timestamps: true,
    ...(sourceLanguage && sourceLanguage !== 'auto' ? { language: sourceLanguage } : {}),
    task: 'transcribe',
  }) as { text?: unknown; chunks?: unknown };

  const text = cleanTranscriptText(output?.text);
  const segments = Array.isArray(output?.chunks)
    ? output.chunks.map((chunk: any) => {
        const timestamp = Array.isArray(chunk?.timestamp) ? chunk.timestamp : [];
        const startMs = Math.max(0, normalizeTimestamp(timestamp[0], 0) * 1000);
        const endMs = Math.max(startMs + 400, normalizeTimestamp(timestamp[1], startMs / 1000 + 1) * 1000);
        return {
          startMs,
          endMs,
          text: cleanTranscriptText(chunk?.text),
        };
      }).filter((segment) => segment.text) as LocalVideoTranscriptionSegment[]
    : [];

  return {
    text,
    segments,
    model: normalizeVideoLocalTranscriptionModel(request.model),
  };
}

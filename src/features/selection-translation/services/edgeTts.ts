/**
 * @file src/features/selection-translation/services/edgeTts.ts
 * 文件职责：实现 Microsoft Edge 在线语音合成协议客户端，获取短期 endpoint token、签名并按分段 SSML 请求音频，最后拼接为单一播放结果。
 * 主要内容：包含端点签名常量、随机请求编号、Base64/字节转换、token 缓存与过期判断，调用 runtimeFetch 和错误读取工具，并导出 synthesizeEdgeTts 及策略层相关类型。
 * 模块边界：该服务只负责远程合成，不播放 Audio、不处理 tab 路由也不写配置；分段和 voice 选择来自 edgeTtsPolicy，播放编排由后台 handler 与 Offscreen 适配器承担。
 */
/**
 * FluentRead 的轻量 Edge TTS 适配器。
 *
 * 只在扩展后台调用 Microsoft 的公开 consumer TTS endpoint。音色按用户
 * 选择和当前语言形成有序候选链；播放端优先交给扩展 Offscreen 文档，
 * 避免把 Blob 音频交给宿主网页的 CSP。
 */

import {readJsonResponse} from '@/src/platform/http/errors';
import {cancelUnreadResponseBody, runtimeFetch} from '@/src/platform/http/runtime';
import {
  buildEdgeTtsSsml,
  concatEdgeTtsAudio,
  edgeTtsTokenExpiry,
  edgeTtsVoiceCandidatesForLanguage,
  splitEdgeTtsText,
} from './edgeTtsPolicy';

export {
  buildEdgeTtsSsml,
  edgeTtsVoiceCandidatesForLanguage,
} from './edgeTtsPolicy';

export interface EdgeTtsAudio {
  audio: ArrayBuffer;
  contentType: string;
  voice: string;
}

const SIGNATURE_SECRET_BASE64 = 'oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==';
const SIGNATURE_APP_ID = 'MSTranslatorAndroidApp';
const ENDPOINT_URL = 'https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0';
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0';
interface EndpointToken {
  region: string;
  token: string;
  expiresAt: number;
}

let endpointToken: EndpointToken | null = null;

function createAbortError(): Error {
  try {
    return new DOMException('语音合成已取消', 'AbortError');
  } catch {
    const error = new Error('语音合成已取消');
    error.name = 'AbortError';
    return error;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function randomId(): string {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/gu, '');
}

async function createSignature(): Promise<string> {
  const formattedDate = `${new Date().toUTCString().replace('GMT', '').trim().toLowerCase()} GMT`;
  const encodedUrl = encodeURIComponent(ENDPOINT_URL.split('://')[1]!);
  const requestId = randomId();
  const payload = `${SIGNATURE_APP_ID}${encodedUrl}${formattedDate}${requestId}`.toLowerCase();
  const key = base64ToBytes(SIGNATURE_SECRET_BASE64);
  const keyBuffer = new ArrayBuffer(key.byteLength);
  new Uint8Array(keyBuffer).set(key);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(payload));
  return `${SIGNATURE_APP_ID}::${bytesToBase64(new Uint8Array(signature))}::${formattedDate}::${requestId}`;
}

async function getEndpointToken(signal?: AbortSignal): Promise<EndpointToken> {
  throwIfAborted(signal);
  if (endpointToken && Date.now() < endpointToken.expiresAt - 3 * 60 * 1000) return endpointToken;

  const signature = await createSignature();
  throwIfAborted(signal);
  const response = await runtimeFetch(ENDPOINT_URL, {
    method: 'POST',
    headers: {
      'Accept-Language': 'zh-Hans',
      'X-ClientVersion': '4.0.530a 5fe1dc6c',
      'X-UserId': '0f04d16a175c411e',
      'X-HomeGeographicRegion': 'zh-Hans-CN',
      'X-ClientTraceId': randomId(),
      'X-MT-Signature': signature,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: '',
    signal,
  });
  if (!response.ok) {
    cancelUnreadResponseBody(response);
    throw new Error(`Edge TTS endpoint failed: ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
  }
  const payload = await readJsonResponse<{ t?: unknown; r?: unknown } | null>(
    response,
    'Edge TTS endpoint returned invalid JSON',
  );
  throwIfAborted(signal);
  // region 只能形成 Microsoft 的单个区域子域；异常 JSON 不得进入缓存，
  // 更不能把 endpoint token 发送到由斜杠等字符改写的主机。
  if (!payload || typeof payload.t !== 'string' || !payload.t.trim()
    || typeof payload.r !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/iu.test(payload.r)) {
    throw new Error('Edge TTS endpoint returned an invalid token');
  }
  endpointToken = { token: payload.t, region: payload.r, expiresAt: edgeTtsTokenExpiry(payload.t) };
  return endpointToken;
}

async function synthesizeWithVoice(voice: string, endpoint: EndpointToken, chunks: string[], signal?: AbortSignal): Promise<EdgeTtsAudio> {
  const audioBuffers: ArrayBuffer[] = [];
  for (const chunk of chunks) {
    throwIfAborted(signal);
    const response = await runtimeFetch(`https://${endpoint.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        Authorization: endpoint.token,
        'Content-Type': 'application/ssml+xml',
        'User-Agent': USER_AGENT,
        'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
      },
      body: buildEdgeTtsSsml(chunk, voice),
      signal,
    });
    if (!response.ok) {
      cancelUnreadResponseBody(response);
      throw new Error(`Edge TTS synthesis failed (${voice}): ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
    }
    audioBuffers.push(await response.arrayBuffer());
  }
  throwIfAborted(signal);
  return { audio: concatEdgeTtsAudio(audioBuffers), contentType: 'audio/mpeg', voice };
}

export async function synthesizeEdgeTts(text: string, language: string, preferredVoices: unknown = [], signal?: AbortSignal): Promise<EdgeTtsAudio> {
  throwIfAborted(signal);
  if (!text.trim()) throw new Error('Edge TTS 文本为空');
  const voices = edgeTtsVoiceCandidatesForLanguage(language, preferredVoices);
  if (voices.length === 0) throw new Error('Edge TTS voice is unavailable for this language');

  const endpoint = await getEndpointToken(signal);
  const chunks = splitEdgeTtsText(text);
  const failures: string[] = [];
  for (const voice of voices) {
    try {
      return await synthesizeWithVoice(voice, endpoint, chunks, signal);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw createAbortError();
      failures.push(`${voice}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Edge TTS 音色均不可用（${failures.join('；')}）`);
}

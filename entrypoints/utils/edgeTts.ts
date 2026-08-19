/**
 * FluentRead 的轻量 Edge TTS 适配器。
 *
 * 只在扩展后台调用 Microsoft 的公开 consumer TTS endpoint。音色按用户
 * 选择和当前语言形成有序候选链；播放端优先交给扩展 Offscreen 文档，
 * 避免把 Blob 音频交给宿主网页的 CSP。
 */

import { normalizeSelectionTtsVoiceOrder, selectionTtsVoiceLocale } from './selectionTtsConfig';

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
const MAX_CHUNK_BYTES = 1800;
const MAX_CHUNKS = 8;

const VOICE_CANDIDATES_BY_LANGUAGE: Record<string, string[]> = {
  'en-US': ['en-US-AvaMultilingualNeural', 'en-US-AriaNeural', 'en-US-JennyNeural', 'en-US-GuyNeural'],
  'en-GB': ['en-GB-SoniaNeural', 'en-GB-RyanNeural'],
  'zh-CN': ['zh-CN-XiaoxiaoMultilingualNeural', 'zh-CN-XiaoyiNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunyangNeural'],
  'zh-TW': ['zh-TW-YunJheMultilingualNeural', 'zh-TW-HsiaoChenNeural', 'zh-TW-HsiaoYuNeural'],
  'ja-JP': ['ja-JP-MasaruMultilingualNeural', 'ja-JP-NanamiNeural'],
  'ko-KR': ['ko-KR-HyunsuMultilingualNeural', 'ko-KR-SunHiNeural'],
  'fr-FR': ['fr-FR-RemyMultilingualNeural'],
  'de-DE': ['de-DE-FlorianMultilingualNeural'],
  'es-ES': ['es-ES-TristanMultilingualNeural'],
  'it-IT': ['it-IT-AlessioMultilingualNeural'],
  'pt-BR': ['pt-BR-MacerioMultilingualNeural'],
};

interface EndpointToken {
  region: string;
  token: string;
  expiresAt: number;
}

let endpointToken: EndpointToken | null = null;

function normalizeLanguage(language: string): string {
  const normalized = String(language || '').replaceAll('_', '-').trim();
  if (!normalized || normalized === 'auto' || normalized === 'detect') return 'en-US';
  if (normalized.toLowerCase() === 'zh-hans') return 'zh-CN';
  if (normalized.toLowerCase() === 'zh-hant') return 'zh-TW';
  if (normalized.toLowerCase() === 'en') return 'en-US';
  return normalized;
}

export function edgeTtsVoiceCandidatesForLanguage(language: string, preferredVoices: unknown = []): string[] {
  const normalized = normalizeLanguage(language);
  const base = normalized.split('-')[0];
  const automatic = VOICE_CANDIDATES_BY_LANGUAGE[normalized]
    || Object.entries(VOICE_CANDIDATES_BY_LANGUAGE).find(([locale]) => locale.startsWith(`${base}-`))?.[1]
    || [];
  const preferred = normalizeSelectionTtsVoiceOrder(preferredVoices)
    .filter((voice) => selectionTtsVoiceLocale(voice) === normalized);
  return [...new Set([...preferred, ...automatic])];
}

export function edgeTtsVoiceForLanguage(language: string): string | null {
  return edgeTtsVoiceCandidatesForLanguage(language)[0] ?? null;
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
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replaceAll('-', '');
}

async function createSignature(url: string): Promise<string> {
  const formattedDate = `${new Date().toUTCString().replace('GMT', '').trim().toLowerCase()} GMT`;
  const encodedUrl = encodeURIComponent(url.split('://')[1] ?? '');
  const requestId = randomId();
  const payload = `${SIGNATURE_APP_ID}${encodedUrl}${formattedDate}${requestId}`.toLowerCase();
  const key = base64ToBytes(SIGNATURE_SECRET_BASE64);
  const keyBuffer = new ArrayBuffer(key.byteLength);
  new Uint8Array(keyBuffer).set(key);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(payload));
  return `${SIGNATURE_APP_ID}::${bytesToBase64(new Uint8Array(signature))}::${formattedDate}::${requestId}`;
}

function tokenExpiry(token: string): number {
  try {
    const payload = token.split('.')[1];
    if (!payload) return Date.now() + 8 * 60 * 1000;
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')));
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : Date.now() + 8 * 60 * 1000;
  } catch {
    return Date.now() + 8 * 60 * 1000;
  }
}

async function getEndpointToken(): Promise<EndpointToken> {
  if (endpointToken && Date.now() < endpointToken.expiresAt - 3 * 60 * 1000) return endpointToken;

  const signature = await createSignature(ENDPOINT_URL);
  const response = await fetch(ENDPOINT_URL, {
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
  });
  if (!response.ok) throw new Error(`Edge TTS endpoint failed: ${response.status}`);
  const payload = await response.json() as { t?: string; r?: string };
  if (!payload.t || !payload.r) throw new Error('Edge TTS endpoint returned an invalid token');
  endpointToken = { token: payload.t, region: payload.r, expiresAt: tokenExpiry(payload.t) };
  return endpointToken;
}

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export function buildEdgeTtsSsml(text: string, voice: string, rate = '+0%', pitch = '+0Hz', volume = '+0%'): string {
  const locale = voice.split('-').slice(0, 2).join('-') || 'en-US';
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(locale)}"><voice name="${escapeXml(voice)}"><prosody rate="${escapeXml(rate)}" pitch="${escapeXml(pitch)}" volume="${escapeXml(volume)}">${escapeXml(text.trim())}</prosody></voice></speak>`;
}

function splitText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining) {
    const bytes = new TextEncoder().encode(remaining);
    if (bytes.byteLength <= MAX_CHUNK_BYTES) {
      chunks.push(remaining);
      break;
    }
    let end = Math.min(remaining.length, MAX_CHUNK_BYTES);
    while (end > 1 && new TextEncoder().encode(remaining.slice(0, end)).byteLength > MAX_CHUNK_BYTES) end -= 1;
    const boundary = Math.max(remaining.lastIndexOf(' ', end), remaining.lastIndexOf('。', end), remaining.lastIndexOf('.', end));
    if (boundary > Math.floor(end * .6)) end = boundary + 1;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
    if (chunks.length > MAX_CHUNKS) throw new Error('Edge TTS text is too long');
  }
  return chunks;
}

function concatBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const total = buffers.reduce((size, buffer) => size + buffer.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const buffer of buffers) {
    output.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  return output.buffer;
}

async function synthesizeWithVoice(voice: string, endpoint: EndpointToken, chunks: string[]): Promise<EdgeTtsAudio> {
  const audioBuffers: ArrayBuffer[] = [];
  for (const chunk of chunks) {
    const response = await fetch(`https://${endpoint.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        Authorization: endpoint.token,
        'Content-Type': 'application/ssml+xml',
        'User-Agent': USER_AGENT,
        'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
      },
      body: buildEdgeTtsSsml(chunk, voice),
    });
    if (!response.ok) throw new Error(`Edge TTS synthesis failed: ${response.status}`);
    audioBuffers.push(await response.arrayBuffer());
  }
  return { audio: concatBuffers(audioBuffers), contentType: 'audio/mpeg', voice };
}

export async function synthesizeEdgeTts(text: string, language: string, preferredVoices: unknown = []): Promise<EdgeTtsAudio> {
  if (!text.trim()) throw new Error('Edge TTS 文本为空');
  const voices = edgeTtsVoiceCandidatesForLanguage(language, preferredVoices);
  if (voices.length === 0) throw new Error('Edge TTS voice is unavailable for this language');

  const endpoint = await getEndpointToken();
  const chunks = splitText(text);
  const failures: string[] = [];
  for (const voice of voices) {
    try {
      return await synthesizeWithVoice(voice, endpoint, chunks);
    } catch (error) {
      failures.push(`${voice}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Edge TTS 音色均不可用（${failures.join('；')}）`);
}

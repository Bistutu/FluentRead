/**
 * @file src/features/progressive-reading/speech.ts
 * 文件职责：管理学习面板的单份页面朗读音频及可取消的合成请求。
 * 主要内容：注入音频创建与释放，复用相同文本和语言的音频，提供暂停续播、停止、重播、五秒跳转、变速和原生循环；按真实媒体事件更新时间及估算跟读，隔离迟到结果。
 * 模块边界：不访问浏览器、网络、DOM 或 Vue，不自动朗读，也不创建定时器；后台语音策略、音频 URL 和界面生命周期由调用方负责。
 */
import {audioSpeechProgress, parseSpeechCues, parseSpeechPlaybackPosition, seekSpeechTime, speechTextTokens, type SpeechCue, type SpeechPlaybackPosition, type SpeechProgress, type SpeechTextToken} from '@/src/core/tts/speechProgress';

export type ReadingSpeechStatus = 'idle' | 'preparing' | 'playing' | 'paused' | 'error';
export type ReadingSpeechRate = .75 | 1 | 1.25 | 1.5;
export interface ReadingSpeechState {
  status: ReadingSpeechStatus;
  error: string;
  position: SpeechPlaybackPosition | null;
  progress: SpeechProgress | null;
  rate: ReadingSpeechRate;
  loop: boolean;
  text: string;
}
export interface ReadingSpeechAudio {
  currentTime: number;
  readonly duration: number;
  playbackRate: number;
  loop: boolean;
  play(): Promise<void>;
  pause(): void;
  onended: ((event: Event) => void) | null;
  onerror: ((event: Event | string) => void) | null;
  ontimeupdate: ((event: Event) => void) | null;
  onseeked: ((event: Event) => void) | null;
  onloadedmetadata: ((event: Event) => void) | null;
  ondurationchange: ((event: Event) => void) | null;
}
export interface ReadingSpeechResponse {
  success?: boolean;
  audioBase64?: string;
  contentType?: string;
  timings?: unknown;
  error?: string;
  errorCode?: string;
}
export interface ReadingSpeechDependencies {
  createId(): string;
  synthesize(text: string, language: string, id: string): Promise<ReadingSpeechResponse>;
  cancel(id: string): void | Promise<unknown>;
  createAudio(base64: string, contentType: string): ReadingSpeechAudio;
  releaseAudio(audio: ReadingSpeechAudio): void;
}
interface CachedSpeech {
  text: string;
  language: string;
  id?: string;
  response: ReadingSpeechResponse | null;
  audio: ReadingSpeechAudio | null;
  cues: SpeechCue[];
  tokens: SpeechTextToken[];
}

export function createReadingSpeechState(): ReadingSpeechState {
  return {status: 'idle', error: '', position: null, progress: null, rate: 1, loop: false, text: ''};
}

export function createReadingSpeechController(state: ReadingSpeechState, deps: ReadingSpeechDependencies) {
  let cached: CachedSpeech | null = null;
  let generation = 0;
  let disposed = false;
  let pending: Promise<void> | null = null;
  const current = (owner: CachedSpeech, version: number) => !disposed && cached === owner && generation === version;
  const cancel = (owner: CachedSpeech) => {
    const id = owner.id;
    if (id) void Promise.resolve().then(() => deps.cancel(id)).catch(() => undefined);
  };
  const publish = (owner: CachedSpeech) => {
    const audio = owner.audio!;
    state.position = parseSpeechPlaybackPosition({currentTime: audio.currentTime, duration: audio.duration});
    state.progress = state.status === 'playing' || state.status === 'paused'
      ? audioSpeechProgress(owner.text, audio.currentTime, audio.duration, owner.cues, owner.tokens) : null;
  };
  const fail = (error: unknown, fallback: string) => {
    state.status = 'error';
    state.error = error instanceof Error && error.message ? error.message : fallback;
    state.progress = null;
  };
  const releaseAudio = (audio: ReadingSpeechAudio) => {
    audio.onended = audio.onerror = audio.ontimeupdate = audio.onseeked = audio.onloadedmetadata = audio.ondurationchange = null;
    deps.releaseAudio(audio);
  };
  const bind = (owner: CachedSpeech, version: number) => {
    const audio = owner.audio!;
    const tick = () => {if (current(owner, version)) publish(owner);};
    audio.ontimeupdate = audio.onseeked = audio.onloadedmetadata = audio.ondurationchange = tick;
    audio.onended = () => {
      if (!current(owner, version) || state.status !== 'playing') return;
      state.status = 'idle';
      state.progress = null;
      state.position = parseSpeechPlaybackPosition({currentTime: audio.currentTime, duration: audio.duration});
    };
    audio.onerror = () => {
      if (!current(owner, version)) return;
      generation += 1;
      pending = null;
      cancel(owner);
      owner.audio = owner.response = null;
      owner.cues = [];
      state.position = null;
      fail(null, '语音播放失败，请重试');
      releaseAudio(audio);
    };
  };
  const release = () => {
    generation += 1;
    pending = null;
    const owner = cached;
    cached = null;
    if (!owner) return;
    cancel(owner);
    if (!owner.audio) return;
    releaseAudio(owner.audio);
  };
  const start = (owner: CachedSpeech): Promise<void> => {
    const version = ++generation;
    state.status = 'preparing';
    state.error = '';
    state.progress = null;
    const work = (async () => {
      try {
        if (!owner.response) {
          owner.id = deps.createId();
          const response = await deps.synthesize(owner.text, owner.language, owner.id);
          if (!current(owner, version)) return;
          if (response.success !== true || !response.audioBase64?.trim()) throw new Error(response.error || response.errorCode || '语音合成失败，请重试');
          owner.response = response;
          owner.cues = parseSpeechCues(response.timings);
        }
        if (!owner.audio) owner.audio = deps.createAudio(owner.response.audioBase64!, owner.response.contentType || 'audio/mpeg');
        const audio = owner.audio;
        audio.playbackRate = state.rate;
        audio.loop = state.loop;
        bind(owner, version);
        publish(owner);
        await audio.play();
        if (!current(owner, version)) return;
        state.status = 'playing';
        publish(owner);
      } catch (error) {
        if (current(owner, version)) fail(error, '语音播放失败，请重试');
      }
    })();
    pending = work;
    void work.then(() => {if (pending === work) pending = null;});
    return work;
  };
  const play = (text: string, language: string): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (!text.trim()) {
      clear();
      fail(null, '朗读文本为空');
      return Promise.resolve();
    }
    if (!cached || cached.text !== text || cached.language !== language) {
      release();
      cached = {text, language, response: null, audio: null, cues: [], tokens: speechTextTokens(text)};
      state.text = text;
      state.position = null;
    } else {
      if (state.status === 'preparing') return pending!;
      if (state.status === 'playing') return Promise.resolve();
      if (state.status === 'idle' && cached.audio) {
        try {cached.audio.currentTime = 0;}
        catch (error) {fail(error, '语音跳转失败，请重试'); return Promise.resolve();}
      }
    }
    return start(cached);
  };
  const pause = () => {
    if (disposed || !cached || (state.status !== 'playing' && state.status !== 'preparing')) return;
    generation += 1;
    pending = null;
    if (!cached.audio) {
      cancel(cached);
      state.status = 'idle';
      return;
    }
    cached.audio.pause();
    state.status = 'paused';
    bind(cached, generation);
    publish(cached);
  };
  const stop = () => {
    if (disposed) return;
    generation += 1;
    pending = null;
    state.status = 'idle';
    state.error = '';
    state.progress = null;
    if (!cached?.audio) {
      if (cached) cancel(cached);
      state.position = null;
      return;
    }
    const audio = cached.audio;
    audio.pause();
    bind(cached, generation);
    try {audio.currentTime = 0; publish(cached);}
    catch (error) {fail(error, '语音跳转失败，请重试');}
  };
  const seek = (offset: -5 | 5): boolean => {
    if (disposed || !cached?.audio || (state.status !== 'playing' && state.status !== 'paused') || (offset !== -5 && offset !== 5)) return false;
    const audio = cached.audio;
    const time = seekSpeechTime(audio.currentTime, audio.duration, offset);
    if (time === null) return false;
    try {audio.currentTime = time; publish(cached); return true;}
    catch (error) {audio.pause(); fail(error, '语音跳转失败，请重试'); return false;}
  };
  const restart = (): Promise<void> => {
    if (disposed || !cached?.response) return Promise.resolve();
    if (state.status === 'preparing') return pending!;
    if (cached.audio) {
      cached.audio.pause();
      try {cached.audio.currentTime = 0;}
      catch (error) {fail(error, '语音跳转失败，请重试'); return Promise.resolve();}
    }
    return start(cached);
  };
  const setRate = (rate: ReadingSpeechRate) => {
    if (disposed || ![.75, 1, 1.25, 1.5].includes(rate)) return;
    state.rate = rate;
    if (cached?.audio) cached.audio.playbackRate = rate;
  };
  const setLoop = (loop: boolean) => {
    if (disposed) return;
    state.loop = loop;
    if (cached?.audio) cached.audio.loop = loop;
  };
  function clear(): void {
    if (disposed) return;
    release();
    state.status = 'idle';
    state.error = '';
    state.position = state.progress = null;
    state.text = '';
  }
  const dispose = () => {clear(); disposed = true;};
  return {play, pause, stop, seek, restart, setRate, setLoop, clear, dispose};
}

/**
 * @file src/features/video-subtitle/content/nativeFullscreen.ts
 * 文件职责：将已有 YouTube 字幕时间轴映射到 Safari 系统视频全屏可选择的原生 TextTrack。
 * 主要内容：页面内预备原生轨道，按显示方式组合已缓存译文、原文与可选读音；读音按原文索引只更新对应 cue，缓存和模式变化保留用户选择，退出、禁用、换视频和卸载时仅保守恢复最近可证明让位的站点原轨道；不重启网络翻译，也不承诺系统播放器显示网页覆盖层。
 * 模块边界：只持有自己创建的 track 节点与 cue，运行时注入媒体、配置和缓存读取；系统字幕样式和后台脚本调度由浏览器负责。
 */
import type {VideoSubtitleCue} from './youtubeSubtitleData';
import type {VideoSubtitleDisplayMode} from '@/src/core/config/model';

export interface NativeFullscreenSubtitleState {
  video: HTMLVideoElement | null;
  enabled: boolean;
  cues: readonly VideoSubtitleCue[];
  mode: VideoSubtitleDisplayMode;
  offsetMs: number;
  language: string;
  /** 提供时必须随 translation 的可见缓存变化；省略时每轮重读。 */
  revision?: string | number;
  /** 仅提供当前句结果；空读音是等待态，不能删除同媒体已经完成的读音。 */
  reading?: {enabled: boolean; source: string; text: string};
  translation: (source: string, cue: VideoSubtitleCue) => string | undefined;
}

type NativeVideo = HTMLVideoElement & {webkitDisplayingFullscreen?: boolean; webkitEnterFullscreen?: () => void};
const escapeCueText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const readingKey = (text: string) => text.replace(/[\s\u3000]+/g, ' ').trim();

function nativeCue(state: NativeFullscreenSubtitleState, cue: VideoSubtitleCue) {
  const original = cue.text.trim();
  const translated = state.mode === 'original-only' ? '' : state.translation(original, cue)?.trim() || '';
  const base = state.mode === 'translation-only' ? translated
    : state.mode === 'original-only' || !translated || translated === original ? original : `${original}\n${translated}`;
  const startMs = Math.max(0, cue.startMs + state.offsetMs);
  const endMs = cue.startMs + cue.durationMs + state.offsetMs;
  if (!base || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return {source: original, cue: {startMs, durationMs: endMs - startMs, text: escapeCueText(base)}};
}

function withReading(base: string, original: string, reading: string): string {
  const escapedOriginal = escapeCueText(original);
  return `${escapedOriginal}\n${escapeCueText(reading)}${base.slice(escapedOriginal.length)}`;
}

export function supportsNativeVideoFullscreen(video: HTMLVideoElement | null): boolean {
  return Boolean(video && typeof (video as NativeVideo).webkitEnterFullscreen === 'function');
}

/** VTTCue 接受 WebVTT 标记，正文必须按文字转义，不能把网站的尖括号解释成标签。 */
export function buildNativeFullscreenCues(state: NativeFullscreenSubtitleState): VideoSubtitleCue[] {
  return state.cues.flatMap(cue => {
    const item = nativeCue(state, cue);
    if (!item) return [];
    const reading = state.reading;
    if (reading?.enabled && state.mode !== 'translation-only' && readingKey(reading.source) === readingKey(item.source) && reading.text.trim()) {
      item.cue.text = withReading(item.cue.text, item.source, reading.text.trim());
    }
    return [item.cue];
  });
}

export function createNativeFullscreenSubtitles(read: () => NativeFullscreenSubtitleState) {
  let video: NativeVideo | null = null;
  let node: HTMLTrackElement | null = null;
  let trackList: TextTrackList | null = null;
  let active = false;
  let disposed = false;
  let syncing = false;
  let fingerprint = '';
  let prepared: VideoSubtitleCue[] = [];
  let preparedCues: readonly VideoSubtitleCue[] | undefined;
  let preparedKey = '';
  let preparedFingerprint = '';
  let baseTexts: string[] = [];
  let preparedSources: string[] = [];
  const sourceIndices = new Map<string, number[]>();
  const readings = new Map<string, string>();
  const dirtyReadings = new Set<string>();
  let readingCharacters = 0;
  const previousShowing = new Set<TextTrack>();
  const onTrackResource = () => sync();
  const onTrackChange = () => {
    // 只由当前列表的选择变化更新归属；内部 cue/模式写入不重新认领用户源轨。
    if (active && !syncing) {
      const sources = showingSources();
      if (ownedMode() !== 'showing' || sources.length) {
        previousShowing.clear();
        for (const source of sources) previousShowing.add(source);
      }
    }
    sync();
  };
  const tracks = (): TextTrack[] => {
    try { return Array.from(trackList || []); } catch { return []; }
  };
  const ownedMode = () => {
    try { return node?.track.mode; } catch { return undefined; }
  };
  const showingSources = (): TextTrack[] => tracks().filter(track => {
    try { return track !== node?.track && ['subtitles', 'captions'].includes(track.kind) && track.mode === 'showing'; }
    catch { return false; }
  });
  const snapshotSources = () => {
    previousShowing.clear();
    for (const track of showingSources()) previousShowing.add(track);
  };
  const restoreSources = () => {
    const current = tracks();
    // 用户另选的站点轨优先；不能把之前观察到的源轨叠加到新选择上。
    const anotherShowing = showingSources().length > 0;
    if (anotherShowing) return;
    for (const track of previousShowing) {
      try { if (current.includes(track) && track.mode === 'disabled') track.mode = 'showing'; }
      catch { /* 单条宿主轨道失效不能中断其余清理。 */ }
    }
  };
  const removeTrackNode = () => {
    const previous = node;
    node = null;
    if (!previous) return;
    previous.removeEventListener('load', onTrackResource);
    previous.removeEventListener('error', onTrackResource);
    try { previous.track.mode = 'disabled'; } catch { /* 失效的 TextTrack 不能阻止 DOM 回收。 */ }
    previous.remove();
  };
  const leave = () => {
    // Off 或用户另选源轨后不恢复旧源，避免退出再进入时重新开启字幕。
    const restore = active && ownedMode() === 'showing';
    active = false;
    try { if (node) node.track.mode = 'hidden'; } catch { /* 原生轨道可能已销毁。 */ }
    if (restore) restoreSources();
    previousShowing.clear();
  };
  const enter = () => {
    if (!active) {
      snapshotSources();
      active = true;
    }
    sync();
  };
  const detach = () => {
    leave();
    video?.removeEventListener('webkitbeginfullscreen', enter);
    video?.removeEventListener('webkitendfullscreen', leave);
    trackList?.removeEventListener('change', onTrackChange);
    trackList = null;
    removeTrackNode();
    video = null;
    fingerprint = '';
    prepared = [];
    preparedCues = undefined;
    preparedKey = '';
    baseTexts = []; preparedSources = []; sourceIndices.clear(); readings.clear(); dirtyReadings.clear(); readingCharacters = 0;
  };
  const sync = () => {
    if (disposed || syncing) return;
    syncing = true;
    try {
      const state = read();
      const next = state.enabled && supportsNativeVideoFullscreen(state.video) ? state.video as NativeVideo : null;
      if (video !== next) {
        detach();
        video = next;
        video?.addEventListener('webkitbeginfullscreen', enter);
        video?.addEventListener('webkitendfullscreen', leave);
        try { trackList = video?.textTracks || null; } catch { trackList = null; }
        trackList?.addEventListener('change', onTrackChange);
        // 已在全屏才挂载时没有进入前快照，不能猜测并恢复过去的源轨选择。
        active = video?.webkitDisplayingFullscreen === true;
      }
      if (!video) return;
      const Cue = (video.ownerDocument.defaultView as (Window & {VTTCue?: typeof VTTCue}) | null)?.VTTCue;
      if (typeof Cue !== 'function') return;
      const readingEnabled = state.reading?.enabled === true;
      if (state.cues !== preparedCues) { readings.clear(); dirtyReadings.clear(); readingCharacters = 0; fingerprint = ''; }
      else if (!readingEnabled) { readings.clear(); dirtyReadings.clear(); readingCharacters = 0; }
      const readingSource = readingKey(state.reading?.source || ''), readingText = state.reading?.text.trim() || '';
      if (readingEnabled && readingSource && readingText && readings.get(readingSource) !== readingText) {
        const previous = readings.get(readingSource);
        if (previous) readingCharacters -= readingSource.length + previous.length;
        readings.delete(readingSource); readings.set(readingSource, readingText);
        readingCharacters += readingSource.length + readingText.length; dirtyReadings.add(readingSource);
        while (readings.size > 160 || readingCharacters > 64_000) {
          const oldest = readings.keys().next().value!;
          readingCharacters -= oldest.length + readings.get(oldest)!.length;
          readings.delete(oldest); dirtyReadings.add(oldest);
        }
      }
      const preparationKey = JSON.stringify([state.revision, state.mode, state.offsetMs, state.language, readingEnabled]);
      if (state.revision === undefined || state.cues !== preparedCues || preparationKey !== preparedKey) {
        prepared = []; baseTexts = []; preparedSources = [];
        sourceIndices.clear();
        for (const cue of state.cues) {
          const item = nativeCue(state, cue);
          if (!item) continue;
          const index = prepared.push(item.cue) - 1;
          // 默认关闭时不建立读音索引或原文副本，保留原轨道准备的线性开销。
          if (readingEnabled) {
            baseTexts.push(item.cue.text); preparedSources.push(item.source);
            const key = readingKey(item.source);
            const indices = sourceIndices.get(key) || []; indices.push(index); sourceIndices.set(key, indices);
          }
        }
        for (const source of readings.keys()) dirtyReadings.add(source);
        preparedFingerprint = JSON.stringify([readingEnabled, prepared]);
        preparedCues = state.cues;
        preparedKey = preparationKey;
      }
      for (const source of dirtyReadings) for (const index of sourceIndices.get(source) || []) {
        const reading = state.mode === 'translation-only' ? '' : readings.get(source);
        prepared[index].text = reading ? withReading(baseTexts[index], preparedSources[index], reading) : baseTexts[index];
      }
      if (node && node.parentElement !== video) { removeTrackNode(); fingerprint = ''; }
      if (!node) {
        // 首次没有内容不占用系统菜单；已有轨暂时无译文则保留身份和用户选择。
        if (!prepared.length) return;
        node = video.ownerDocument.createElement('track');
        node.kind = 'subtitles';
        node.label = 'FluentRead';
        node.setAttribute('data-fluent-read-native-subtitles', 'true');
        node.srclang = state.language;
        node.addEventListener('load', onTrackResource);
        node.addEventListener('error', onTrackResource);
        video.appendChild(node);
        node.track.mode = 'hidden';
        fingerprint = '';
      }
      const track = node.track;
      // disabled.cues 为 null 是系统 Off；只准备缓存，不借补 cue 之名改写用户选择。
      if (track.mode === 'disabled') return;
      if (node.srclang !== state.language) node.srclang = state.language;
      // 资源任务可能清空动态 cue；只有模式允许时恢复，不切换轨道、不重置选中状态。
      if (preparedFingerprint === fingerprint && track.cues?.length === prepared.length) {
        for (const source of dirtyReadings) for (const index of sourceIndices.get(source) || []) {
          const cue = track.cues[index] as VTTCue;
          if (cue.text !== prepared[index].text) cue.text = prepared[index].text;
        }
        dirtyReadings.clear(); return;
      }
      for (const cue of Array.from(track.cues || [])) track.removeCue(cue);
      for (const cue of prepared) track.addCue(new Cue(cue.startMs / 1000, (cue.startMs + cue.durationMs) / 1000, cue.text));
      fingerprint = preparedFingerprint;
      dirtyReadings.clear();
    } catch {
      // 动态 cue 失败只等待下一次补齐，不能暗改用户模式或替其重新选择站点轨。
      fingerprint = '';
    } finally {
      syncing = false;
    }
  };
  return {sync, destroy: () => { disposed = true; detach(); }};
}

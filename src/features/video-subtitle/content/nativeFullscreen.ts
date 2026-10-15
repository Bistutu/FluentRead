/**
 * @file src/features/video-subtitle/content/nativeFullscreen.ts
 * 文件职责：将已有 YouTube 字幕时间轴映射到 Safari 系统视频全屏可选择的原生 TextTrack。
 * 主要内容：页面内预备原生轨道，按显示方式组合已缓存译文与原文，进入系统全屏时切换并在退出、禁用、换视频和卸载时恢复站点原轨道；不重启网络翻译，也不承诺系统播放器显示网页覆盖层。
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
  translation: (source: string, cue: VideoSubtitleCue) => string | undefined;
}

type NativeVideo = HTMLVideoElement & {webkitDisplayingFullscreen?: boolean; webkitEnterFullscreen?: () => void};

export function supportsNativeVideoFullscreen(video: HTMLVideoElement | null): boolean {
  return Boolean(video && typeof (video as NativeVideo).webkitEnterFullscreen === 'function');
}

/** VTTCue 接受 WebVTT 标记，正文必须按文字转义，不能把网站的尖括号解释成标签。 */
export function buildNativeFullscreenCues(state: NativeFullscreenSubtitleState): VideoSubtitleCue[] {
  return state.cues.flatMap(cue => {
    const original = cue.text.trim();
    const translated = state.mode === 'original-only' ? '' : state.translation(original, cue)?.trim() || '';
    const text = state.mode === 'translation-only' ? translated
      : state.mode === 'original-only' || !translated || translated === original ? original : `${original}\n${translated}`;
    const startMs = Math.max(0, cue.startMs + state.offsetMs);
    const endMs = cue.startMs + cue.durationMs + state.offsetMs;
    if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
    return [{startMs, durationMs: endMs - startMs,
      text: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}];
  });
}

export function createNativeFullscreenSubtitles(read: () => NativeFullscreenSubtitleState) {
  let video: NativeVideo | null = null;
  let node: HTMLTrackElement | null = null;
  let active = false;
  let disposed = false;
  let claimed = false;
  let fingerprint = '';
  let prepared: VideoSubtitleCue[] = [];
  let preparedCues: readonly VideoSubtitleCue[] | undefined;
  let preparedKey = '';
  let preparedFingerprint = '';
  const previousModes = new Map<TextTrack, TextTrackMode>();
  const onTrackResource = () => sync();
  const removeTrackNode = () => {
    if (!node) return;
    node.removeEventListener('load', onTrackResource);
    node.removeEventListener('error', onTrackResource);
    node.track.mode = 'disabled';
    node.remove();
    node = null;
  };
  const restoreModes = () => {
    for (const [track, mode] of previousModes) {
      try { if (track.mode === 'disabled') track.mode = mode; } catch { /* 已销毁的媒体轨道无需恢复。 */ }
    }
    previousModes.clear();
  };
  const leave = () => {
    active = false;
    claimed = false;
    if (node?.track) node.track.mode = 'hidden';
    restoreModes();
  };
  const enter = () => {
    active = true;
    claimed = false;
    sync();
  };
  const detach = () => {
    leave();
    video?.removeEventListener('webkitbeginfullscreen', enter);
    video?.removeEventListener('webkitendfullscreen', leave);
    removeTrackNode();
    video = null;
    fingerprint = '';
    prepared = [];
    preparedCues = undefined;
    preparedKey = '';
  };
  const sync = () => {
    if (disposed) return;
    const state = read();
    const next = state.enabled && supportsNativeVideoFullscreen(state.video) ? state.video as NativeVideo : null;
    if (video !== next) {
      detach();
      video = next;
      video?.addEventListener('webkitbeginfullscreen', enter);
      video?.addEventListener('webkitendfullscreen', leave);
      active = video?.webkitDisplayingFullscreen === true;
    }
    if (!video) return;
    const Cue = (video.ownerDocument.defaultView as (Window & {VTTCue?: typeof VTTCue}) | null)?.VTTCue;
    if (typeof Cue !== 'function') return;
    const preparationKey = JSON.stringify([state.revision, state.mode, state.offsetMs, state.language]);
    if (state.revision === undefined || state.cues !== preparedCues || preparationKey !== preparedKey) {
      prepared = buildNativeFullscreenCues(state);
      preparedFingerprint = JSON.stringify(prepared);
      preparedCues = state.cues;
      preparedKey = preparationKey;
    }
    // 标准规定 disabled 时 cues 返回 null；这是用户在系统菜单选择 Off，不能当作丢失时间轴反复 addCue。
    if (active && claimed && node?.track.mode === 'disabled') return;
    if (node?.track.mode === 'disabled') node.track.mode = 'hidden';
    if (!prepared.length) {
      // 空轨会出现在系统字幕菜单中，用户选中后反而看不到网站字幕。
      removeTrackNode();
      claimed = false;
      fingerprint = '';
      restoreModes();
      return;
    }
    if (!node || node.parentElement !== video) {
      removeTrackNode();
      node = video.ownerDocument.createElement('track');
      node.kind = 'subtitles';
      node.label = 'FluentRead';
      node.setAttribute('data-fluent-read-native-subtitles', 'true');
      node.srclang = state.language;
      // 资源任务清空cue后会派发error/load；在可能进入系统全屏前立即恢复，不等待后台轮询。
      node.addEventListener('load', onTrackResource);
      node.addEventListener('error', onTrackResource);
      video.appendChild(node);
      node.track.mode = 'hidden';
      claimed = false;
      fingerprint = '';
    }
    if (node.srclang !== state.language) node.srclang = state.language;
    const nextFingerprint = preparedFingerprint;
    // HTMLTrackElement 首次资源选择（无外部src）可能在脚本任务结束后清空动态cue。
    // 指纹相同也要确认浏览器仍持有时间轴，下一轮恢复后不重复重写完整轨道。
    if (nextFingerprint === fingerprint && node.track.cues?.length === prepared.length && (!active || claimed)) return;
    try {
      const track = node.track;
      for (const cue of Array.from(track.cues || [])) track.removeCue(cue);
      for (const cue of prepared) track.addCue(new Cue(cue.startMs / 1000, (cue.startMs + cue.durationMs) / 1000, cue.text));
      fingerprint = nextFingerprint;
      // 没有可显示的译文时不把原生字幕关掉；稍后译文到达时首次接管。
      if (active && !claimed) {
        for (const original of Array.from(video.textTracks || [])) {
          if (original !== track && ['subtitles', 'captions'].includes(original.kind) && original.mode === 'showing') {
            previousModes.set(original, original.mode);
            original.mode = 'disabled';
          }
        }
        track.mode = 'showing';
        claimed = true;
      }
    } catch {
      // 平台拒绝动态 cue 时保留站点字幕；菜单提供退出系统全屏的可行路径。
      node.track.mode = 'hidden';
      claimed = false;
      restoreModes();
      fingerprint = '';
    }
  };
  return {sync, destroy: () => { disposed = true; detach(); }};
}

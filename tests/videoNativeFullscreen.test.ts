/**
 * @file tests/videoNativeFullscreen.test.ts
 * 文件职责：验证 Safari 系统全屏字幕桥接的数据、轨道所有权与退出恢复契约。
 * 主要内容：覆盖显示模式、缓存空缺、转义与校时，系统全屏事件、手动关闭、迟到译文、失败、切视频和卸载。
 * 模块边界：以可控 TextTrack API 验证产品代码，不将 DOM 夹具当作 iOS AVKit 实机渲染验收。
 */
import {describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {buildNativeFullscreenCues, createNativeFullscreenSubtitles, supportsNativeVideoFullscreen, type NativeFullscreenSubtitleState} from '@/src/features/video-subtitle/content/nativeFullscreen';

function setup() {
  const {document, window} = parseHTML('<html><body><video></video><video></video></body></html>');
  class Cue {
    constructor(public startTime: number, public endTime: number, public text: string) {}
  }
  Object.defineProperty(window, 'VTTCue', {value: Cue, configurable: true});
  const create = document.createElement.bind(document);
  const tracks: Array<{mode: string; kind: string; cues: Cue[]; addCue: (cue: Cue) => void; removeCue: (cue: Cue) => void}> = [];
  document.createElement = ((name: string) => {
    const node = create(name);
    if (name === 'track') {
      const track = {mode: 'disabled', kind: 'subtitles', cues: [] as Cue[], addCue(cue: Cue) { this.cues.push(cue); }, removeCue(cue: Cue) { this.cues.splice(this.cues.indexOf(cue), 1); }};
      tracks.push(track);
      Object.defineProperty(node, 'track', {value: track});
    }
    return node;
  }) as typeof document.createElement;
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
  const original = {kind: 'captions', mode: 'showing'};
  for (const video of videos) {
    Object.defineProperty(video, 'webkitEnterFullscreen', {value() {}, configurable: true});
    Object.defineProperty(video, 'textTracks', {configurable: true, get: () => [original, ...Array.from(video.querySelectorAll('track')).map(node => node.track)]});
  }
  const state: NativeFullscreenSubtitleState = {video: videos[0], enabled: true, cues: [{startMs: 1000, durationMs: 2000, text: 'Original'}], mode: 'bilingual', offsetMs: 0, language: 'zh-Hans', translation: () => '译文'};
  const bridge = createNativeFullscreenSubtitles(() => state);
  return {document, window, videos, original, tracks, state, bridge,
    enter: () => state.video!.dispatchEvent(new window.Event('webkitbeginfullscreen')),
    leave: () => state.video!.dispatchEvent(new window.Event('webkitendfullscreen'))};
}

describe('native fullscreen subtitles', () => {
  it('uses the chosen display mode without pretending missing translations exist', () => {
    const {state} = setup();
    expect(buildNativeFullscreenCues(state)[0].text).toBe('Original\n译文');
    state.mode = 'translation-only'; expect(buildNativeFullscreenCues(state)[0].text).toBe('译文');
    state.translation = () => undefined; expect(buildNativeFullscreenCues(state)).toEqual([]);
    state.mode = 'bilingual'; expect(buildNativeFullscreenCues(state)[0].text).toBe('Original');
    state.mode = 'original-only'; state.translation = () => { throw Error('must not translate'); };
    expect(buildNativeFullscreenCues(state)[0].text).toBe('Original');
    state.mode = 'bilingual'; state.translation = () => 'Original'; expect(buildNativeFullscreenCues(state)[0].text).toBe('Original');
  });

  it('escapes WebVTT markup, clips a shifted start, and removes invalid or expired cues', () => {
    const {state} = setup();
    state.mode = 'original-only'; state.offsetMs = -1500;
    state.cues = [{startMs: 1000, durationMs: 2000, text: '<b>A & B</b>'}, {startMs: 0, durationMs: 500, text: 'expired'}, {startMs: NaN, durationMs: 3, text: 'invalid'}, {startMs: 2000, durationMs: 1000, text: ' '}];
    expect(buildNativeFullscreenCues(state)).toEqual([{startMs: 0, durationMs: 1500, text: '&lt;b&gt;A &amp; B&lt;/b&gt;'}]);
  });

  it('prepares inline, shows in native fullscreen, respects manual off, and restores site tracks', () => {
    const fixture = setup(); const {bridge, tracks, original, document} = fixture;
    bridge.sync(); const track = tracks[0];
    expect(track.mode).toBe('hidden'); expect(track.cues[0].text).toBe('Original\n译文');
    fixture.enter(); expect(track.mode).toBe('showing'); expect(original.mode).toBe('disabled');
    track.mode = 'disabled'; fixture.state.translation = () => 'new'; bridge.sync();
    expect(track.mode).toBe('disabled'); // 用户在系统菜单关闭后不能每秒重新开启。
    fixture.leave(); expect(track.mode).toBe('hidden'); expect(original.mode).toBe('showing');
    bridge.destroy(); expect(document.querySelector('track')).toBeNull();
    bridge.sync(); expect(document.querySelector('track')).toBeNull();
  });

  it('leaves originals visible until a translation arrives, then restores if translations disappear', () => {
    const fixture = setup(); const {state, bridge, original, tracks} = fixture;
    state.mode = 'translation-only'; state.translation = () => undefined;
    bridge.sync(); fixture.enter(); expect(original.mode).toBe('showing'); expect(fixture.document.querySelector('track')).toBeNull();
    state.translation = () => 'ready'; bridge.sync(); expect(tracks[0].mode).toBe('showing'); expect(original.mode).toBe('disabled');
    state.translation = () => undefined; bridge.sync(); expect(original.mode).toBe('showing'); expect(tracks[0].mode).toBe('disabled'); expect(fixture.document.querySelector('track')).toBeNull();
    bridge.destroy();
  });

  it('cleans detached tracks, switch, disabled state, missing APIs, and entry into an already fullscreen video', () => {
    const fixture = setup(); const {state, bridge, original, videos, document, tracks} = fixture;
    expect(supportsNativeVideoFullscreen(null)).toBe(false);
    delete (videos[1] as unknown as Record<string, unknown>).webkitEnterFullscreen;
    expect(supportsNativeVideoFullscreen(videos[1])).toBe(false);
    bridge.sync(); fixture.enter(); document.querySelector('track')!.remove(); bridge.sync();
    expect(tracks[0].mode).toBe('disabled');
    expect(tracks.at(-1)?.mode).toBe('showing');
    state.video = videos[1]; bridge.sync(); expect(original.mode).toBe('showing'); expect(document.querySelector('track')).toBeNull();
    state.video = videos[0]; Object.defineProperty(videos[0], 'webkitDisplayingFullscreen', {value: true});
    bridge.sync(); expect(tracks.at(-1)?.mode).toBe('showing');
    original.mode = 'hidden'; state.enabled = false; bridge.sync(); expect(original.mode).toBe('hidden');
    expect(document.querySelector('track')).toBeNull();
    state.enabled = true; Object.defineProperty(fixture.window, 'VTTCue', {value: undefined, configurable: true}); bridge.sync();
    expect(document.querySelector('track')).toBeNull(); bridge.destroy();
  });

  it('tolerates platform track lists becoming unavailable and a destroyed original track during restore', () => {
    const fixture = setup(); const {bridge, state, tracks} = fixture;
    bridge.sync();
    Object.defineProperty(state.video, 'textTracks', {get: () => undefined});
    Object.defineProperty(tracks[0], 'cues', {value: undefined, writable: true});
    tracks[0].addCue = function(cue) { this.cues ||= []; this.cues.push(cue); };
    fixture.enter(); expect(tracks[0].mode).toBe('showing'); bridge.destroy();
    const another = setup(); another.bridge.sync(); another.enter();
    Object.defineProperty(another.original, 'mode', {get: () => { throw Error('destroyed native track'); }});
    expect(() => another.leave()).not.toThrow(); another.bridge.destroy();
  });

  it('keeps a user-disabled track intact when the native cues getter returns null and refreshes after re-enabling', () => {
    const fixture = setup(); fixture.bridge.sync(); fixture.enter();
    const track = fixture.tracks[0], cues = track.cues;
    Object.defineProperty(track, 'cues', {configurable: true, get: () => track.mode === 'disabled' ? null : cues});
    track.mode = 'disabled'; fixture.state.translation = () => 'updated';
    fixture.bridge.sync(); fixture.bridge.sync();
    expect(track.mode).toBe('disabled'); expect(cues).toHaveLength(1); expect(cues[0].text).toBe('Original\n译文');
    track.mode = 'showing'; fixture.bridge.sync();
    expect(cues).toHaveLength(1); expect(cues[0].text).toBe('Original\nupdated');
    fixture.leave(); track.mode = 'disabled'; fixture.bridge.sync();
    expect(track.mode).toBe('hidden'); fixture.bridge.destroy();
  });

  it('restores immediately on owned load/error events without reloading unchanged tracks or writing after destroy', () => {
    const fixture = setup(); fixture.state.revision = 1; fixture.bridge.sync();
    const node = fixture.document.querySelector('track')!;
    const add = vi.spyOn(fixture.tracks[0], 'addCue');
    const removeListener = vi.spyOn(node, 'removeEventListener');
    fixture.tracks[0].cues.length = 0;
    node.dispatchEvent(new fixture.window.Event('error'));
    expect(fixture.tracks[0].cues).toHaveLength(1); expect(add).toHaveBeenCalledTimes(1);
    fixture.tracks[0].cues.length = 0; node.dispatchEvent(new fixture.window.Event('load'));
    expect(fixture.tracks[0].cues).toHaveLength(1); expect(add).toHaveBeenCalledTimes(2);
    node.dispatchEvent(new fixture.window.Event('error')); expect(add).toHaveBeenCalledTimes(2);
    fixture.bridge.destroy();
    expect(removeListener).toHaveBeenCalledWith('load', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('error', expect.any(Function));
    node.dispatchEvent(new fixture.window.Event('error'));
    expect(fixture.document.querySelector('track')).toBeNull(); expect(add).toHaveBeenCalledTimes(2);
  });

  it('restores cues cleared by the browser initial track resource task even when the cached timeline is unchanged', () => {
    const fixture = setup(); fixture.state.revision = 1; fixture.bridge.sync();
    fixture.tracks[0].cues.length = 0; // 与真实浏览器首次HTMLTrackElement资源任务后的空列表一致。
    fixture.bridge.sync(); expect(fixture.tracks[0].cues[0].text).toBe('Original\n译文');
    fixture.state.language = 'en'; fixture.bridge.sync();
    expect(fixture.document.querySelector('track')?.srclang).toBe('en');
    fixture.bridge.destroy();
  });

  it('skips unchanged long timelines and recomputes only when the visible cache revision changes', () => {
    const fixture = setup(); let reads = 0;
    fixture.state.cues = Array.from({length: 2000}, (_, index) => ({startMs: index * 2000, durationMs: 1800, text: `Sentence ${index}`}));
    fixture.state.revision = 1; fixture.state.translation = () => { reads += 1; return 'ready'; };
    fixture.bridge.sync(); fixture.bridge.sync(); fixture.enter();
    expect(reads).toBe(2000);
    fixture.state.revision = 2; fixture.bridge.sync(); expect(reads).toBe(4000);
    fixture.bridge.destroy();
  });

  it('preserves site tracks if the browser rejects dynamic native cues', () => {
    const fixture = setup(); fixture.bridge.sync();
    fixture.enter();
    const add = fixture.tracks[0].addCue;
    fixture.tracks[0].addCue = () => { throw Error('platform rejected cue'); };
    fixture.state.translation = () => 'another'; fixture.enter();
    expect(fixture.original.mode).toBe('showing'); expect(fixture.tracks[0].mode).toBe('hidden');
    fixture.tracks[0].addCue = add; fixture.bridge.sync();
    expect(fixture.tracks[0].mode).toBe('showing'); expect(fixture.original.mode).toBe('disabled');
    fixture.bridge.destroy();
  });
});

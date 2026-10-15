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
  const tracks: Array<{mode: TextTrackMode; kind: string; cues: Cue[] | null; stored: Cue[]; addCue: (cue: Cue) => void; removeCue: (cue: Cue) => void}> = [];
  document.createElement = ((name: string) => {
    const node = create(name);
    if (name === 'track') {
      let mode: TextTrackMode = 'disabled';
      const stored: Cue[] = [];
      const track = {get mode() { return mode; }, set mode(value: TextTrackMode) { mode = value; },
        kind: 'subtitles', get cues() { return mode === 'disabled' ? null : stored; }, stored,
        addCue(cue: Cue) { stored.push(cue); }, removeCue(cue: Cue) { stored.splice(stored.indexOf(cue), 1); }};
      tracks.push(track);
      Object.defineProperty(node, 'track', {value: track, configurable: true});
    }
    return node;
  }) as typeof document.createElement;
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
  const original = {kind: 'captions', mode: 'showing' as TextTrackMode};
  const sources = [original];
  const lists = videos.map(video => {
    const list = create('div');
    const current = () => [...sources, ...Array.from(video.querySelectorAll('track')).map(node => node.track)];
    Object.defineProperty(list, Symbol.iterator, {value: () => current()[Symbol.iterator](), configurable: true});
    Object.defineProperty(video, 'webkitEnterFullscreen', {value() {}, configurable: true});
    Object.defineProperty(video, 'webkitDisplayingFullscreen', {value: false, writable: true, configurable: true});
    Object.defineProperty(video, 'textTracks', {configurable: true, get: () => list});
    return list;
  });
  const state: NativeFullscreenSubtitleState = {video: videos[0], enabled: true, cues: [{startMs: 1000, durationMs: 2000, text: 'Original'}], mode: 'bilingual', offsetMs: 0, language: 'zh-Hans', translation: () => '译文'};
  const bridge = createNativeFullscreenSubtitles(() => state);
  const change = () => lists[videos.indexOf(state.video!)]?.dispatchEvent(new window.Event('change'));
  return {document, window, videos, original, sources, lists, tracks, state, bridge, change,
    select: (selected: typeof tracks[number] | typeof original | null) => {
      for (const track of [...sources, ...tracks]) track.mode = track === selected ? 'showing' : 'disabled';
      change();
    },
    enter: () => {
      Object.defineProperty(state.video!, 'webkitDisplayingFullscreen', {value: true, writable: true, configurable: true});
      state.video!.dispatchEvent(new window.Event('webkitbeginfullscreen'));
    },
    leave: () => {
      Object.defineProperty(state.video!, 'webkitDisplayingFullscreen', {value: false, writable: true, configurable: true});
      state.video!.dispatchEvent(new window.Event('webkitendfullscreen'));
    }};
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

  it('prepares hidden, waits for system selection, and restores the observed source only when leaving with FluentRead selected', () => {
    const f = setup(); f.bridge.sync(); const track = f.tracks[0];
    expect(track.mode).toBe('hidden'); expect(track.cues![0].text).toBe('Original\n译文');
    f.enter(); expect(track.mode).toBe('hidden'); expect(f.original.mode).toBe('showing');
    f.select(track); expect(track.mode).toBe('showing'); expect(f.original.mode).toBe('disabled');
    f.leave(); expect(track.mode).toBe('hidden'); expect(f.original.mode).toBe('showing');
    f.bridge.destroy(); expect(f.document.querySelector('track')).toBeNull();
    f.bridge.sync(); expect(f.document.querySelector('track')).toBeNull();
  });

  it('does not reopen Off after late cache changes, duplicate begin, leave and reentry', () => {
    const f = setup(); f.bridge.sync(); const track = f.tracks[0]; f.enter(); f.select(track); f.select(null);
    const add = vi.spyOn(track, 'addCue'), remove = vi.spyOn(track, 'removeCue'), mode = vi.spyOn(track, 'mode', 'set');
    f.state.translation = () => 'new'; f.state.offsetMs = 500; f.state.mode = 'translation-only';
    f.bridge.sync(); f.enter();
    const node = f.document.querySelector('track')!;
    node.dispatchEvent(new f.window.Event('error')); f.change();
    expect(track.mode).toBe('disabled'); expect(mode).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    f.leave(); expect(f.original.mode).toBe('disabled');
    f.enter(); expect(track.mode).toBe('hidden'); expect(f.original.mode).toBe('disabled');
    f.select(track); expect(track.cues![0].text).toBe('new'); expect(track.cues![0].startTime).toBe(1.5);
    f.bridge.destroy();
  });

  it('does not restore the previous source over another source selected in the system menu', () => {
    const f = setup(); const other = {kind: 'subtitles', mode: 'hidden' as TextTrackMode}; f.sources.push(other);
    f.bridge.sync(); f.enter(); f.select(f.tracks[0]); f.select(other); f.leave();
    expect(other.mode).toBe('showing'); expect(f.original.mode).toBe('disabled'); f.bridge.destroy();
  });

  it('freezes the source snapshot across duplicate begin and preserves a track already selected before entry', () => {
    const f = setup(); f.bridge.sync(); const track = f.tracks[0];
    track.mode = 'showing'; f.enter(); expect(track.mode).toBe('showing');
    f.original.mode = 'disabled'; f.enter(); f.leave();
    expect(f.original.mode).toBe('showing'); f.bridge.destroy();
  });

  it('keeps an existing track identity and selection while translations become empty and later return', () => {
    const f = setup(); f.state.mode = 'translation-only'; f.state.translation = () => undefined;
    f.bridge.sync(); f.enter(); expect(f.document.querySelector('track')).toBeNull(); expect(f.original.mode).toBe('showing');
    f.state.translation = () => 'ready'; f.bridge.sync(); const node = f.document.querySelector('track')!, track = f.tracks[0];
    expect(track.mode).toBe('hidden'); f.select(track);
    f.state.translation = () => undefined; f.bridge.sync();
    expect(f.document.querySelector('track')).toBe(node); expect(track.mode).toBe('showing'); expect(track.cues).toHaveLength(0);
    expect(f.original.mode).toBe('disabled');
    f.state.translation = () => 'returned'; f.bridge.sync();
    expect(f.document.querySelector('track')).toBe(node); expect(track.cues![0].text).toBe('returned');
    f.bridge.destroy(); expect(f.original.mode).toBe('showing');
  });

  it.each(['disable', 'switch', 'destroy'] as const)('restores the observed showing source on %s when FluentRead is still selected', action => {
    const f = setup(); f.bridge.sync(); f.enter(); f.select(f.tracks[0]);
    if (action === 'disable') { f.state.enabled = false; f.bridge.sync(); }
    else if (action === 'switch') { f.state.video = f.videos[1]; f.bridge.sync(); }
    else f.bridge.destroy();
    expect(f.original.mode).toBe('showing'); expect(f.tracks[0].mode).toBe('disabled');
    f.bridge.destroy();
  });

  it('does not invent an entry snapshot when attaching to an already fullscreen video', () => {
    const f = setup(); Object.defineProperty(f.videos[0], 'webkitDisplayingFullscreen', {value: true, configurable: true});
    f.bridge.sync(); expect(f.tracks[0].mode).toBe('hidden');
    f.select(f.tracks[0]); f.leave(); expect(f.original.mode).toBe('disabled'); f.bridge.destroy();
  });

  it('does not restore sources observed hidden or disabled and ignores metadata', () => {
    const f = setup(); f.original.mode = 'hidden';
    const disabled = {kind: 'captions', mode: 'disabled' as TextTrackMode};
    const metadata = {kind: 'metadata', mode: 'showing' as TextTrackMode}; f.sources.push(disabled, metadata);
    f.bridge.sync(); f.enter(); f.select(f.tracks[0]); f.leave();
    expect(f.original.mode).toBe('disabled'); expect(disabled.mode).toBe('disabled'); expect(metadata.mode).toBe('disabled');
    f.bridge.destroy();
  });

  it('ignores removed source tracks and does not add the old source beside a still showing source', () => {
    const f = setup(); f.bridge.sync(); f.enter(); f.select(f.tracks[0]);
    const other = {kind: 'captions', mode: 'showing' as TextTrackMode}; f.sources.push(other);
    f.leave(); expect(f.original.mode).toBe('disabled'); expect(other.mode).toBe('showing');
    f.enter(); f.select(f.tracks[0]); f.sources.splice(f.sources.indexOf(other), 1);
    f.leave(); expect(other.mode).toBe('disabled'); f.bridge.destroy();
  });

  it('refreshes prepared cues immediately on system selection after Off without writing disabled cues', () => {
    const f = setup(); f.bridge.sync(); f.enter(); const track = f.tracks[0]; f.select(track); f.select(null);
    const old = track.stored[0]; f.state.revision = 2; f.state.translation = () => 'updated'; f.bridge.sync();
    expect(track.cues).toBeNull(); expect(track.stored[0]).toBe(old);
    f.select(track); expect(track.cues).toHaveLength(1); expect(track.cues![0].text).toBe('Original\nupdated');
    f.bridge.destroy();
  });

  it('keeps the same disabled track across empty translation-only cache and fills only the latest cues on reselection', () => {
    const f = setup(); f.state.mode = 'translation-only'; f.bridge.sync(); f.enter();
    const node = f.document.querySelector('track')!, track = f.tracks[0]; f.select(track); f.select(null);
    const add = vi.spyOn(track, 'addCue'), remove = vi.spyOn(track, 'removeCue');
    f.state.translation = () => undefined; f.bridge.sync();
    expect(f.document.querySelector('track')).toBe(node); expect(track.mode).toBe('disabled');
    f.state.translation = () => 'latest'; f.bridge.sync();
    expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    f.select(track); expect(f.document.querySelector('track')).toBe(node);
    expect(track.cues).toHaveLength(1); expect(track.cues![0].text).toBe('latest'); f.bridge.destroy();
  });

  it('repairs browser-cleared cues on load and error without changing the selected mode or writing after destroy', () => {
    const f = setup(); f.state.revision = 1; f.bridge.sync(); const node = f.document.querySelector('track')!, track = f.tracks[0];
    const add = vi.spyOn(track, 'addCue'), remove = vi.spyOn(node, 'removeEventListener');
    f.enter(); f.select(track); track.stored.length = 0; node.dispatchEvent(new f.window.Event('error'));
    expect(track.cues).toHaveLength(1); expect(track.mode).toBe('showing');
    track.stored.length = 0; node.dispatchEvent(new f.window.Event('load')); expect(add).toHaveBeenCalledTimes(2);
    node.dispatchEvent(new f.window.Event('error')); expect(add).toHaveBeenCalledTimes(2);
    f.bridge.destroy(); expect(remove).toHaveBeenCalledWith('load', expect.any(Function)); expect(remove).toHaveBeenCalledWith('error', expect.any(Function));
    node.dispatchEvent(new f.window.Event('error')); f.change(); expect(add).toHaveBeenCalledTimes(2);
  });

  it('does not reenter sync on synchronous track-list change during cue writes and keeps its guard usable after a failure', () => {
    const f = setup(); f.bridge.sync(); const track = f.tracks[0], add = track.addCue;
    track.addCue = cue => { f.change(); add(cue); };
    f.state.translation = () => 'changed'; f.bridge.sync(); expect(track.cues).toHaveLength(1);
    track.addCue = () => { throw Error('platform rejected cue'); };
    f.enter(); f.select(track); f.state.translation = () => 'retry'; f.bridge.sync();
    expect(track.mode).toBe('showing'); expect(f.original.mode).toBe('disabled');
    track.addCue = add; f.bridge.sync(); expect(track.cues![0].text).toBe('Original\nretry'); f.bridge.destroy();
  });

  it('cleans a detached owned node, handles missing APIs, and attaches track-list listeners only to the current video', () => {
    const f = setup(); expect(supportsNativeVideoFullscreen(null)).toBe(false);
    delete (f.videos[1] as unknown as Record<string, unknown>).webkitEnterFullscreen;
    expect(supportsNativeVideoFullscreen(f.videos[1])).toBe(false);
    f.bridge.sync(); const old = f.document.querySelector('track')!; old.remove(); f.bridge.sync();
    expect(f.tracks[0].mode).toBe('disabled'); expect(f.tracks[1].mode).toBe('hidden');
    f.state.video = f.videos[1]; f.bridge.sync(); expect(f.document.querySelector('track')).toBeNull();
    const remove = vi.spyOn(f.lists[0], 'removeEventListener');
    f.state.video = f.videos[0]; f.bridge.sync(); f.state.enabled = false; f.bridge.sync();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
    f.state.enabled = true; Object.defineProperty(f.window, 'VTTCue', {value: undefined, configurable: true}); f.bridge.sync();
    expect(f.document.querySelector('track')).toBeNull(); f.bridge.destroy();
  });

  it('tolerates unavailable track lists and destroyed source getters without skipping cleanup', () => {
    const f = setup(); Object.defineProperty(f.videos[0], 'textTracks', {get: () => undefined});
    f.bridge.sync(); f.enter(); expect(f.tracks[0].mode).toBe('hidden'); f.bridge.destroy();
    const g = setup(); g.bridge.sync(); g.enter(); g.select(g.tracks[0]);
    Object.defineProperty(g.original, 'mode', {get: () => { throw Error('destroyed source'); }});
    expect(() => g.leave()).not.toThrow(); g.bridge.destroy();
    const h = setup(); Object.defineProperty(h.videos[0], 'textTracks', {get: () => { throw Error('destroyed list'); }});
    expect(() => { h.bridge.sync(); h.enter(); h.bridge.destroy(); }).not.toThrow();
  });

  it('ignores an invalid track-list iterator and an unreadable source at entry', () => {
    const f = setup(); f.bridge.sync();
    Object.defineProperty(f.lists[0], Symbol.iterator, {value: () => { throw Error('expired track list'); }, configurable: true});
    expect(() => f.enter()).not.toThrow(); f.bridge.destroy();
    const g = setup(); g.bridge.sync();
    Object.defineProperty(g.original, 'mode', {get: () => { throw Error('expired source'); }});
    expect(() => g.enter()).not.toThrow(); g.bridge.destroy();
  });

  it('repairs a temporarily unavailable cue list without changing the mode', () => {
    const f = setup(); f.bridge.sync(); const track = f.tracks[0];
    track.stored.length = 0; Object.defineProperty(track, 'cues', {configurable: true, get: () => null});
    f.bridge.sync(); expect(track.mode).toBe('hidden'); expect(track.stored[0].text).toBe('Original\n译文');
    f.bridge.destroy();
  });

  it('removes the node and all listeners even if its track getter or mode setter has become invalid', () => {
    for (const failingPart of ['getter', 'setter']) {
      const f = setup(); f.bridge.sync(); f.enter(); const node = f.document.querySelector('track')!, track = f.tracks[0];
      if (failingPart === 'getter') Object.defineProperty(node, 'track', {get: () => { throw Error('destroyed track'); }});
      else Object.defineProperty(track, 'mode', {set: () => { throw Error('destroyed setter'); }});
      const remove = vi.spyOn(f.lists[0], 'removeEventListener');
      expect(() => f.bridge.destroy()).not.toThrow(); expect(node.isConnected).toBe(false);
      expect(remove).toHaveBeenCalledWith('change', expect.any(Function)); f.bridge.destroy();
    }
  });

  it('does not rebuild unchanged long timelines and responds to language, display mode and cache revision changes', () => {
    const f = setup(); let reads = 0;
    f.state.cues = Array.from({length: 2000}, (_, index) => ({startMs: index * 2000, durationMs: 1800, text: `Sentence ${index}`}));
    f.state.revision = 1; f.state.translation = () => { reads += 1; return 'ready'; };
    f.bridge.sync(); f.bridge.sync(); f.enter(); f.select(f.tracks[0]); expect(reads).toBe(2000);
    f.state.revision = 2; f.bridge.sync(); expect(reads).toBe(4000);
    f.state.language = 'en'; f.bridge.sync(); expect(f.document.querySelector('track')?.srclang).toBe('en');
    f.bridge.destroy();
  });
});

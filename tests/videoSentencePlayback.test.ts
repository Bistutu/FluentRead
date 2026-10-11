import {afterEach, describe, expect, it, vi} from 'vitest';
import {SentencePlaybackController, type SentencePlaybackScheduler, type SentencePlaybackState} from '@/src/features/video-subtitle/content/sentencePlayback';
import {buildVideoSentenceTimeline} from '@/src/features/video-subtitle/content/sentenceTimeline';

class MediaFixture extends EventTarget {
  private time = 0;
  paused = false;
  seeking = false;
  ended = false;
  isConnected = true;
  playbackRate = 1.75;
  failSeek = false;
  synchronousSeek = false;
  get currentTime(): number { return this.time; }
  set currentTime(value: number) {
    if (this.failSeek) throw new Error('media unavailable');
    this.time = value;
    if (this.synchronousSeek) {
      this.seeking = true;
      this.dispatchEvent(new Event('seeking'));
      this.seeking = false;
      this.dispatchEvent(new Event('seeked'));
    }
  }
  play = vi.fn(async () => {
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event('play'));
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
}

function harness() {
  const media = new MediaFixture();
  const callbacks = new Map<number, () => void>();
  let sequence = 0;
  const scheduler: SentencePlaybackScheduler = {
    request: vi.fn(callback => { callbacks.set(++sequence, callback); return sequence; }),
    cancel: vi.fn(id => { callbacks.delete(id); }),
  };
  const state = vi.fn<(state: SentencePlaybackState) => void>();
  const controller = new SentencePlaybackController(media, scheduler, state);
  const sentence = buildVideoSentenceTimeline([{text: 'A complete sentence.', startMs: 1000, durationMs: 2000}])[0];
  const frame = () => {
    const first = [...callbacks.entries()][0];
    if (!first) throw new Error('no queued frame');
    callbacks.delete(first[0]);
    first[1]();
  };
  return {media, scheduler, callbacks, state, controller, sentence, frame};
}

afterEach(() => vi.unstubAllGlobals());

describe('视频单句播放器控制器', () => {
  it('未选句及停止后的播放事件不读取媒体状态或重复通知，已有选句仍在脱离页面时解除', () => {
    const h = harness();
    const connected = vi.fn(() => false);
    Object.defineProperty(h.media, 'isConnected', {get: connected});
    for (let i = 0; i < 100; i += 1) h.media.dispatchEvent(new Event('timeupdate'));
    expect(connected).not.toHaveBeenCalled();
    expect(h.state).not.toHaveBeenCalled();
    h.controller.select(h.sentence, 'off', false);
    h.media.dispatchEvent(new Event('timeupdate'));
    expect(connected).toHaveBeenCalledOnce();
    expect(h.controller.getState().sentence).toBeNull();
    expect(h.state).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 100; i += 1) h.media.dispatchEvent(new Event('timeupdate'));
    expect(connected).toHaveBeenCalledOnce();
    expect(h.state).toHaveBeenCalledTimes(2);
    h.controller.destroy();
  });

  it('只在用户明确播放的原媒体上循环原始范围，保持倍速；外部 seek 立即解除', async () => {
    const h = harness();
    h.media.synchronousSeek = true;
    h.controller.select(h.sentence, 'loop');
    expect(h.media.currentTime).toBe(1);
    expect(h.media.play).not.toHaveBeenCalled();
    expect(h.controller.getState()).toEqual({mode: 'loop', sentence: h.sentence, pausedAtEnd: false});
    h.media.synchronousSeek = false;
    h.media.currentTime = 2.9;
    h.frame();
    expect(h.media.currentTime).toBe(2.9);
    h.media.currentTime = 3.04;
    h.frame();
    expect(h.media.currentTime).toBe(1);
    expect(h.media.playbackRate).toBe(1.75);
    h.media.seeking = true;
    h.media.dispatchEvent(new Event('seeking'));
    expect(h.controller.getState().mode).toBe('loop');
    expect(h.callbacks.size).toBe(0);
    h.media.seeking = false;
    h.media.dispatchEvent(new Event('seeked'));
    expect(h.callbacks.size).toBe(1);
    h.media.currentTime = 10;
    h.media.dispatchEvent(new Event('seeking'));
    expect(h.controller.getState().mode).toBe('off');
    expect(h.callbacks.size).toBe(0);
    h.controller.destroy();
  });

  it('用户暂停取消帧且不会自动播放，恢复后继续同一句循环', async () => {
    const h = harness();
    h.controller.select(h.sentence, 'loop');
    h.media.pause();
    expect(h.callbacks.size).toBe(0);
    h.media.currentTime = 4;
    h.media.dispatchEvent(new Event('timeupdate'));
    expect(h.media.currentTime).toBe(4);
    expect(h.media.play).not.toHaveBeenCalled();
    expect(h.controller.getState().mode).toBe('loop');
    await h.media.play();
    h.frame();
    expect(h.media.currentTime).toBe(1);
    expect(h.media.play).toHaveBeenCalledTimes(1);
    h.controller.destroy();
  });

  it('句末暂停停在真实终点，主动恢复播放后解除句末暂停', async () => {
    const h = harness();
    h.controller.select(h.sentence, 'pause');
    h.media.currentTime = 3.1;
    h.frame();
    expect(h.media.pause).toHaveBeenCalledOnce();
    expect(h.media.currentTime).toBe(3);
    expect(h.controller.getState().pausedAtEnd).toBe(true);
    expect(h.callbacks.size).toBe(0);
    h.media.paused = false;
    h.media.dispatchEvent(new Event('timeupdate'));
    expect(h.media.pause).toHaveBeenCalledOnce();
    await h.media.play();
    expect(h.controller.getState()).toEqual({mode: 'off', sentence: null, pausedAtEnd: false});
    h.media.currentTime = 4;
    h.media.dispatchEvent(new Event('timeupdate'));
    expect(h.media.currentTime).toBe(4);
    h.controller.destroy();
  });

  it('选句可以保持当前时间；关闭控制不暂停视频；无选句时模式保持关闭', () => {
    const h = harness();
    h.controller.setMode('loop');
    expect(h.controller.getState().mode).toBe('off');
    h.media.currentTime = 2;
    h.controller.select(h.sentence, 'off', false);
    expect(h.media.currentTime).toBe(2);
    expect(h.callbacks.size).toBe(0);
    h.controller.setMode('loop');
    expect(h.callbacks.size).toBe(1);
    h.controller.setMode('off');
    expect(h.callbacks.size).toBe(0);
    expect(h.media.pause).not.toHaveBeenCalled();
    h.controller.stop();
    h.media.dispatchEvent(new Event('seeking'));
    expect(h.controller.getState().sentence).toBeNull();
    h.controller.destroy();
  });

  it('用户原生 seek 期间不执行边界；无 seeking 事件的明显倒退也解除', () => {
    const h = harness();
    h.controller.select(h.sentence, 'loop');
    h.media.currentTime = 5;
    h.media.seeking = true;
    h.media.dispatchEvent(new Event('timeupdate'));
    expect(h.media.currentTime).toBe(5);
    h.media.dispatchEvent(new Event('seeking'));
    expect(h.controller.getState().mode).toBe('off');
    h.media.seeking = false;
    h.controller.select(h.sentence, 'loop');
    h.media.currentTime = 0.5;
    h.frame();
    expect(h.controller.getState().mode).toBe('off');
    h.controller.select(h.sentence, 'loop');
    h.media.currentTime = NaN;
    h.frame();
    expect(h.controller.getState().mode).toBe('off');
    h.controller.destroy();
  });

  it('重载、资源中止和播放器断开释放控制；销毁移除全部监听且后续调用无效', () => {
    const h = harness();
    for (const name of ['emptied', 'abort', 'loadstart']) {
      h.controller.select(h.sentence, 'loop');
      h.media.dispatchEvent(new Event(name));
      expect(h.controller.getState().mode).toBe('off');
      expect(h.callbacks.size).toBe(0);
    }
    h.controller.select(h.sentence, 'loop');
    h.media.isConnected = false;
    h.frame();
    expect(h.controller.getState().mode).toBe('off');
    const remove = vi.spyOn(h.media, 'removeEventListener');
    h.controller.destroy();
    expect(remove).toHaveBeenCalledTimes(9);
    const calls = h.state.mock.calls.length;
    h.controller.destroy();
    h.controller.select(h.sentence, 'loop');
    h.controller.setMode('pause');
    h.media.dispatchEvent(new Event('play'));
    h.media.dispatchEvent(new Event('timeupdate'));
    expect(h.state.mock.calls).toHaveLength(calls);
    expect(h.callbacks.size).toBe(0);
  });

  it('不接受伪造或损坏的时间；媒体拒绝跳转时解除并取消循环', () => {
    const h = harness();
    for (const invalid of [
      {...h.sentence, startMs: NaN}, {...h.sentence, endMs: Infinity},
      {...h.sentence, startMs: -1}, {...h.sentence, endMs: h.sentence.startMs},
    ]) {
      h.controller.select(invalid, 'loop');
      expect(h.controller.getState().mode).toBe('off');
    }
    h.media.failSeek = true;
    h.controller.select(h.sentence, 'loop');
    expect(h.controller.getState().mode).toBe('off');
    h.media.failSeek = false;
    h.controller.select(h.sentence, 'loop');
    h.media.currentTime = 3;
    h.media.failSeek = true;
    h.frame();
    expect(h.controller.getState().mode).toBe('off');
    h.media.failSeek = false;
    h.media.paused = false;
    h.controller.select(h.sentence, 'pause');
    h.media.currentTime = 3;
    h.media.failSeek = true;
    h.frame();
    expect(h.controller.getState().mode).toBe('off');
    h.controller.destroy();
  });

  it('自然视频结束可继续单句循环，但结束后的播放器失败不会重试', async () => {
    const h = harness();
    h.controller.select(h.sentence, 'loop');
    h.media.currentTime = 3;
    h.media.paused = true;
    h.media.ended = true;
    h.media.dispatchEvent(new Event('ended'));
    await Promise.resolve();
    expect(h.media.currentTime).toBe(1);
    expect(h.media.play).toHaveBeenCalledOnce();
    expect(h.controller.getState().mode).toBe('loop');
    h.media.play.mockRejectedValueOnce(new Error('not allowed'));
    h.media.currentTime = 3;
    h.media.dispatchEvent(new Event('ended'));
    await Promise.resolve();
    expect(h.controller.getState().mode).toBe('off');
    h.controller.destroy();
  });

  it('旧播放失败不覆盖新选择；结尾 seek 失败直接解除', async () => {
    const h = harness();
    let reject!: (reason: Error) => void;
    h.media.play.mockImplementationOnce(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }));
    h.controller.select(h.sentence, 'loop');
    h.media.currentTime = 3;
    h.media.dispatchEvent(new Event('ended'));
    h.controller.select(h.sentence, 'pause');
    reject(new Error('old play'));
    await Promise.resolve();
    expect(h.controller.getState().mode).toBe('pause');
    h.controller.setMode('loop');
    h.media.currentTime = 3;
    h.media.failSeek = true;
    h.media.dispatchEvent(new Event('ended'));
    expect(h.controller.getState().mode).toBe('off');
    h.controller.destroy();
  });

  it('普通视频结束和句末暂停均不强制播放；提前 ended 不循环', () => {
    const h = harness();
    h.controller.select(h.sentence, 'pause');
    h.media.currentTime = 3;
    h.media.dispatchEvent(new Event('ended'));
    expect(h.controller.getState().pausedAtEnd).toBe(true);
    h.controller.setMode('loop');
    h.media.currentTime = 2;
    h.media.dispatchEvent(new Event('ended'));
    expect(h.controller.getState().mode).toBe('off');
    h.media.dispatchEvent(new Event('ended'));
    expect(h.media.play).not.toHaveBeenCalled();
    h.controller.destroy();
  });

  it('默认使用真实页面动画帧 API，暂停中选句不会创建循环帧', () => {
    const request = vi.fn(() => 19);
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const media = new MediaFixture();
    const sentence = buildVideoSentenceTimeline([{text: 'Sentence.', startMs: 0, durationMs: 1000}])[0];
    const controller = new SentencePlaybackController(media);
    media.paused = true;
    controller.select(sentence, 'loop');
    expect(request).not.toHaveBeenCalled();
    media.paused = false;
    media.dispatchEvent(new Event('play'));
    expect(request).toHaveBeenCalledOnce();
    controller.destroy();
    expect(cancel).toHaveBeenCalledWith(19);
  });
});

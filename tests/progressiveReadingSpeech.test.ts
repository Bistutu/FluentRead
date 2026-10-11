import {describe, expect, it, vi} from 'vitest';
import {createReadingSpeechController, createReadingSpeechState, type ReadingSpeechAudio, type ReadingSpeechDependencies, type ReadingSpeechResponse} from '@/src/features/progressive-reading/speech';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
class TestAudio implements ReadingSpeechAudio {
  private time = 0;
  seekError: unknown = null;
  get currentTime() {return this.time;}
  set currentTime(value: number) {if (this.seekError) throw this.seekError; this.time = value;}
  duration = 12;
  playbackRate = 1;
  loop = false;
  onended: ReadingSpeechAudio['onended'] = null;
  onerror: ReadingSpeechAudio['onerror'] = null;
  ontimeupdate: ReadingSpeechAudio['ontimeupdate'] = null;
  onseeked: ReadingSpeechAudio['onseeked'] = null;
  onloadedmetadata: ReadingSpeechAudio['onloadedmetadata'] = null;
  ondurationchange: ReadingSpeechAudio['ondurationchange'] = null;
  play = vi.fn(async (): Promise<void> => undefined);
  pause = vi.fn();
}
const response = (): ReadingSpeechResponse => ({success: true, audioBase64: 'AQID'});
const event = new Event('timeupdate');
function fixture(overrides: Partial<ReadingSpeechDependencies> = {}) {
  let serial = 0;
  const audios: TestAudio[] = [];
  const deps = {
    createId: vi.fn(() => `speech-${++serial}`),
    synthesize: vi.fn(async (_text: string, _language: string, _id: string) => response()),
    cancel: vi.fn(async (_id: string) => undefined),
    createAudio: vi.fn((_base64: string, _contentType: string) => {const audio = new TestAudio(); audios.push(audio); return audio;}),
    releaseAudio: vi.fn((audio: ReadingSpeechAudio) => audio.pause()),
    ...overrides,
  };
  const state = createReadingSpeechState();
  const controller = createReadingSpeechController(state, deps);
  return {state, deps, controller, audios};
}
async function flush() {await Promise.resolve(); await Promise.resolve();}

describe('学习朗读的页面音频与请求所有权', () => {
  it('默认不自动朗读，无缓存控制不产生合成或媒体资源', async () => {
    const f = fixture();
    expect(f.state).toEqual({status: 'idle', error: '', position: null, progress: null, rate: 1, loop: false, text: ''});
    f.controller.pause(); f.controller.stop(); f.controller.clear();
    expect(f.controller.seek(5)).toBe(false);
    await f.controller.restart();
    expect(f.deps.synthesize).not.toHaveBeenCalled();
    expect(f.deps.createAudio).not.toHaveBeenCalled();
    f.controller.setRate(.75); f.controller.setLoop(true);
    expect(f.state).toMatchObject({rate: .75, loop: true, status: 'idle'});
  });

  it('实际媒体事件更新时钟与估算词高亮，元数据未加载时不虚构秒数', async () => {
    const audio = new TestAudio(); audio.duration = NaN;
    const timer = vi.spyOn(globalThis, 'setInterval');
    const f = fixture({createAudio: vi.fn(() => audio)});
    try {
      await f.controller.play('Hello world', 'en');
      expect(f.deps.synthesize).toHaveBeenCalledWith('Hello world', 'en', 'speech-1');
      expect(f.deps.createAudio).toHaveBeenCalledWith('AQID', 'audio/mpeg');
      expect(f.state.position).toBeNull(); expect(f.state.progress).toBeNull();
      expect(f.controller.seek(5)).toBe(false);
      audio.duration = 12; audio.onloadedmetadata!(event);
      expect(f.state.position).toEqual({currentTime: 0, duration: 12});
      audio.currentTime = 3; audio.ontimeupdate!(event);
      expect(f.state.progress).toEqual({start: 0, end: 5, fraction: .55, estimated: true});
      audio.currentTime = 6; audio.onseeked!(event);
      expect(f.state.progress).toMatchObject({start: 6, end: 11, estimated: true});
      audio.duration = 24; audio.ondurationchange!(event);
      expect(f.state.position).toEqual({currentTime: 6, duration: 24});
      expect(timer).not.toHaveBeenCalled();
    } finally {timer.mockRestore(); f.controller.dispose();}
  });

  it('保留源文本及本地句段索引，使用返回的 MIME 和句段时间而非墙钟', async () => {
    const f = fixture({synthesize: vi.fn(async () => ({...response(), contentType: 'audio/wav', timings: [{startChar: 6, endChar: 11, startTime: 1, endTime: 3}]}))});
    await f.controller.play('Hello world', 'en');
    expect(f.deps.createAudio).toHaveBeenCalledWith('AQID', 'audio/wav');
    f.audios[0].currentTime = 2; f.audios[0].ontimeupdate!(event);
    expect(f.state.progress).toEqual({start: 6, end: 11, fraction: .5, estimated: true});
    expect(f.state.text).toBe('Hello world');
    f.controller.dispose();
  });

  it('同文同语言 preparing 复用同一个请求，playing 不重复启动', async () => {
    const request = deferred<ReadingSpeechResponse>();
    const f = fixture({synthesize: vi.fn(() => request.promise)});
    const first = f.controller.play('Hello world', 'en');
    expect(f.state.status).toBe('preparing');
    expect(f.controller.play('Hello world', 'en')).toBe(first);
    await f.controller.restart();
    expect(f.deps.synthesize).toHaveBeenCalledTimes(1);
    request.resolve(response()); await first;
    await f.controller.play('Hello world', 'en');
    expect(f.audios[0].play).toHaveBeenCalledTimes(1);
    expect(f.state.status).toBe('playing');
    f.controller.dispose();
  });

  it('预先选择的语速与循环用于首次播放，所有控制复用唯一音频', async () => {
    const f = fixture();
    f.controller.setRate(1.25); f.controller.setLoop(true);
    await f.controller.play('Hello world', 'en');
    const audio = f.audios[0];
    expect(audio.playbackRate).toBe(1.25); expect(audio.loop).toBe(true);
    audio.currentTime = 2;
    f.controller.pause();
    expect(audio.pause).toHaveBeenCalledOnce(); expect(f.state.status).toBe('paused');
    expect(f.controller.seek(5)).toBe(true); expect(audio.currentTime).toBe(7);
    expect(f.state.position).toEqual({currentTime: 7, duration: 12});
    expect(f.state.progress?.start).toBe(6);
    await f.controller.play('Hello world', 'en');
    expect(audio.currentTime).toBe(7);
    expect(f.state.status).toBe('playing');
    for (const rate of [.75, 1, 1.25, 1.5] as const) {f.controller.setRate(rate); expect(audio.playbackRate).toBe(rate);}
    f.controller.setRate(2 as never); expect(f.state.rate).toBe(1.5);
    f.controller.setLoop(false); expect(audio.loop).toBe(false);
    expect(f.controller.seek(5)).toBe(true); expect(audio.currentTime).toBe(12);
    expect(f.controller.seek(5)).toBe(true); expect(audio.currentTime).toBe(12);
    expect(f.controller.seek(-5)).toBe(true); expect(audio.currentTime).toBe(7);
    f.controller.seek(-5); f.controller.seek(-5); expect(audio.currentTime).toBe(0);
    expect(f.controller.seek(15 as never)).toBe(false);
    audio.currentTime = 8; await f.controller.restart();
    expect(audio.currentTime).toBe(0); expect(f.state.status).toBe('playing');
    audio.currentTime = 9; f.controller.stop();
    expect(audio.currentTime).toBe(0); expect(f.state).toMatchObject({status: 'idle', text: 'Hello world', progress: null, error: ''});
    audio.ontimeupdate!(event); expect(f.state.progress).toBeNull();
    f.controller.pause(); expect(f.state.status).toBe('idle');
    expect(f.controller.seek(5)).toBe(false);
    await f.controller.play('Hello world', 'en');
    expect(f.deps.synthesize).toHaveBeenCalledOnce(); expect(f.deps.createAudio).toHaveBeenCalledOnce();
    f.controller.dispose();
  });

  it('原生 loop 不手动重合成或调用 play，正常结束清高亮后可重播缓存', async () => {
    const f = fixture(); await f.controller.play('Hello world', 'en');
    const audio = f.audios[0]; f.controller.setLoop(true);
    audio.currentTime = 11; audio.ontimeupdate!(event);
    audio.currentTime = 0; audio.ontimeupdate!(event);
    expect(f.state.progress?.start).toBe(0); expect(audio.loop).toBe(true);
    expect(audio.play).toHaveBeenCalledOnce();
    f.controller.setLoop(false); audio.currentTime = 12; audio.onended!(event);
    expect(f.state).toMatchObject({status: 'idle', progress: null, position: {currentTime: 12, duration: 12}});
    audio.onended!(event); expect(f.state.status).toBe('idle');
    await f.controller.play('Hello world', 'en');
    expect(audio.currentTime).toBe(0); expect(f.deps.synthesize).toHaveBeenCalledOnce();
    f.controller.dispose();
  });

  it.each(['text', 'language'] as const)('更改 %s 释放旧音频并拒绝旧媒体回调', async (change) => {
    const f = fixture(); await f.controller.play('Hello world', 'en');
    const old = f.audios[0];
    const callbacks = [old.ontimeupdate!, old.onseeked!, old.onloadedmetadata!, old.ondurationchange!, old.onended!, old.onerror!];
    await f.controller.play(change === 'text' ? 'Next sentence' : 'Hello world', change === 'language' ? 'fr' : 'en');
    await flush();
    expect(f.deps.cancel).toHaveBeenCalledWith('speech-1');
    expect(f.deps.releaseAudio).toHaveBeenCalledWith(old);
    expect(old.onended).toBeNull(); expect(old.onerror).toBeNull(); expect(old.ontimeupdate).toBeNull();
    const snapshot = structuredClone(f.state);
    old.currentTime = 10; for (const callback of callbacks) callback(event);
    expect(f.state).toEqual(snapshot); expect(f.audios).toHaveLength(2);
    f.controller.dispose();
  });

  it.each(['resolve', 'reject'] as const)('切句拒绝迟到的合成 %s', async terminal => {
    const old = deferred<ReadingSpeechResponse>();
    const synthesize = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(response());
    const f = fixture({synthesize});
    const pending = f.controller.play('Old sentence', 'en');
    await f.controller.play('New sentence', 'en');
    if (terminal === 'resolve') old.resolve(response()); else old.reject(new Error('old failure'));
    await pending; await flush();
    expect(f.state).toMatchObject({status: 'playing', text: 'New sentence', error: ''});
    expect(f.deps.createAudio).toHaveBeenCalledOnce();
    expect(f.deps.cancel).toHaveBeenCalledWith('speech-1');
    f.controller.dispose();
  });

  it.each(['pause', 'stop'] as const)('%s preparing 后立即同文重试，只取消旧 A 请求', async action => {
    const old = deferred<ReadingSpeechResponse>(); const next = deferred<ReadingSpeechResponse>();
    const synthesize = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const f = fixture({synthesize});
    const first = f.controller.play('Hello world', 'en');
    f.controller[action]();
    expect(f.state.status).toBe('idle');
    const second = f.controller.play('Hello world', 'en');
    await flush();
    expect(f.deps.cancel).toHaveBeenCalledOnce(); expect(f.deps.cancel).toHaveBeenCalledWith('speech-1');
    expect(synthesize).toHaveBeenLastCalledWith('Hello world', 'en', 'speech-2');
    old.resolve(response()); await first;
    expect(f.deps.createAudio).not.toHaveBeenCalled();
    expect(f.state.status).toBe('preparing');
    next.resolve(response()); await second;
    expect(f.state.status).toBe('playing'); expect(f.deps.createAudio).toHaveBeenCalledOnce();
    f.controller.dispose();
  });

  it.each(['pause', 'stop', 'clear', 'dispose', 'replace'] as const)('音频 play 等待期间 %s，迟到成功不得恢复旧播放状态', async action => {
    const started = deferred<void>();
    const firstAudio = new TestAudio(); firstAudio.play.mockReturnValueOnce(started.promise);
    const secondAudio = new TestAudio();
    const createAudio = vi.fn().mockReturnValueOnce(firstAudio).mockReturnValue(secondAudio);
    const f = fixture({createAudio});
    const playing = f.controller.play('First sentence', 'en'); await flush();
    expect(f.state.status).toBe('preparing');
    const oldTick = firstAudio.ontimeupdate!;
    const oldEnd = firstAudio.onended!;
    if (action === 'replace') await f.controller.play('Second sentence', 'en'); else f.controller[action]();
    const snapshot = structuredClone(f.state);
    started.resolve(); await playing;
    oldTick(event); oldEnd(event);
    expect(f.state).toEqual(snapshot);
    expect(firstAudio.pause).toHaveBeenCalled();
    f.controller.dispose();
  });

  it('迟到 play 拒绝不污染下一句，当前拒绝可重试同份音频', async () => {
    const wait = deferred<void>();
    const audio = new TestAudio(); audio.play.mockReturnValueOnce(wait.promise).mockRejectedValueOnce(new Error('play blocked'));
    const f = fixture({createAudio: vi.fn(() => audio)});
    const pending = f.controller.play('Hello world', 'en'); await flush();
    f.controller.pause(); wait.reject(new Error('old error')); await pending;
    expect(f.state.status).toBe('paused'); expect(f.state.error).toBe('');
    await f.controller.play('Hello world', 'en'); expect(f.state).toMatchObject({status: 'error', error: 'play blocked'});
    f.controller.pause(); expect(f.state.status).toBe('error');
    await f.controller.play('Hello world', 'en'); expect(f.state).toMatchObject({status: 'playing', error: ''});
    expect(f.deps.synthesize).toHaveBeenCalledOnce(); expect(f.deps.createAudio).toHaveBeenCalledOnce();
    f.controller.dispose();
  });

  it('restart 在已有音频等待启动时复用原 Promise', async () => {
    const wait = deferred<void>(); const audio = new TestAudio(); audio.play.mockReturnValueOnce(wait.promise);
    const f = fixture({createAudio: vi.fn(() => audio)});
    const playing = f.controller.play('Hello world', 'en'); await flush();
    expect(f.controller.restart()).toBe(playing);
    wait.resolve(); await playing; f.controller.dispose();
  });

  it.each([
    {success: false, error: 'model missing'},
    {success: false, errorCode: 'local-model-not-ready'},
    {success: true},
    {success: true, audioBase64: '   '},
    {success: false, audioBase64: 'AQID'},
  ] as ReadingSpeechResponse[])('合成失败不会创建媒体，并能显式重试：%j', async failed => {
    const synthesize = vi.fn().mockResolvedValueOnce(failed).mockResolvedValue(response());
    const f = fixture({synthesize}); await f.controller.play('Hello world', 'en');
    expect(f.state.status).toBe('error');
    expect(f.state.error).toBe(failed.error || failed.errorCode || '语音合成失败，请重试');
    expect(f.deps.createAudio).not.toHaveBeenCalled();
    await f.controller.play('Hello world', 'en'); expect(f.state.status).toBe('playing');
    expect(synthesize).toHaveBeenCalledTimes(2); f.controller.dispose();
  });

  it.each([new Error('network down'), new Error(''), 'untyped failure'])('合成异常展示可恢复错误：%j', async error => {
    const f = fixture({synthesize: vi.fn().mockRejectedValueOnce(error).mockResolvedValue(response())});
    await f.controller.play('Hello world', 'en');
    expect(f.state.error).toBe(error instanceof Error && error.message ? error.message : '语音播放失败，请重试');
    await f.controller.play('Hello world', 'en'); expect(f.state.status).toBe('playing');
    f.controller.dispose();
  });

  it('音频构造失败保留合成结果，restart 重试创建而不重新合成', async () => {
    const audio = new TestAudio();
    const createAudio = vi.fn().mockImplementationOnce(() => {throw new Error('decode failed');}).mockReturnValue(audio);
    const f = fixture({createAudio}); await f.controller.play('Hello world', 'en');
    expect(f.state).toMatchObject({status: 'error', error: 'decode failed'});
    await f.controller.restart(); expect(f.state.status).toBe('playing');
    expect(f.deps.synthesize).toHaveBeenCalledOnce(); expect(createAudio).toHaveBeenCalledTimes(2);
    f.controller.dispose();
  });

  it('当前解码错误释放损坏音频，重试获取新音频且旧回调不污染新句', async () => {
    const f = fixture(); await f.controller.play('Hello world', 'en'); const audio = f.audios[0];
    const oldTick = audio.ontimeupdate!; const oldError = audio.onerror!;
    audio.onerror!('decode error'); expect(f.state).toMatchObject({status: 'error', error: '语音播放失败，请重试', progress: null});
    expect(f.deps.releaseAudio).toHaveBeenCalledWith(audio); expect(audio.onerror).toBeNull();
    await f.controller.play('Hello world', 'en');
    const snapshot = structuredClone(f.state); oldTick(event); oldError(event); expect(f.state).toEqual(snapshot);
    f.controller.pause(); f.audios[1].onended!(event);
    expect(f.state.status).toBe('paused'); expect(f.deps.synthesize).toHaveBeenCalledTimes(2); expect(f.audios).toHaveLength(2);
    f.controller.dispose();
  });

  it.each(['seek', 'stop', 'restart', 'play'] as const)('%s 媒体跳转异常成为可恢复错误', async action => {
    const f = fixture(); await f.controller.play('Hello world', 'en'); const audio = f.audios[0];
    audio.pause.mockClear();
    if (action === 'play') f.controller.stop();
    audio.seekError = new Error('seek denied');
    if (action === 'seek') expect(f.controller.seek(5)).toBe(false);
    else if (action === 'stop') f.controller.stop();
    else if (action === 'restart') await f.controller.restart();
    else await f.controller.play('Hello world', 'en');
    expect(f.state).toMatchObject({status: 'error', error: 'seek denied', progress: null});
    expect(audio.pause).toHaveBeenCalledOnce();
    audio.seekError = null; await f.controller.play('Hello world', 'en');
    expect(f.state.status).toBe('playing'); expect(f.deps.synthesize).toHaveBeenCalledOnce();
    f.controller.dispose();
  });

  it('clear 释放音频并清空界面，保留当前面板语速和循环偏好', async () => {
    const f = fixture(); await f.controller.play('Hello world', 'en'); const audio = f.audios[0];
    f.controller.setRate(1.5); f.controller.setLoop(true); f.controller.clear(); await flush();
    expect(f.state).toEqual({status: 'idle', error: '', position: null, progress: null, rate: 1.5, loop: true, text: ''});
    expect(f.deps.releaseAudio).toHaveBeenCalledOnce(); expect(f.deps.releaseAudio).toHaveBeenCalledWith(audio);
    expect(f.deps.cancel).toHaveBeenCalledOnce(); expect(f.deps.cancel).toHaveBeenCalledWith('speech-1');
    expect(audio.onended).toBeNull(); expect(audio.onerror).toBeNull(); expect(audio.ontimeupdate).toBeNull();
    expect(audio.onseeked).toBeNull(); expect(audio.onloadedmetadata).toBeNull(); expect(audio.ondurationchange).toBeNull();
    await f.controller.play('Hello world', 'en'); expect(f.deps.synthesize).toHaveBeenCalledTimes(2);
    f.controller.dispose();
  });

  it.each(['clear', 'dispose'] as const)('%s preparing 后迟到结果不创建音频', async action => {
    const wait = deferred<ReadingSpeechResponse>(); const f = fixture({synthesize: vi.fn(() => wait.promise)});
    const request = f.controller.play('Hello world', 'en'); f.controller[action]();
    wait.resolve(response()); await request; await flush();
    expect(f.state).toMatchObject({status: 'idle', text: '', error: '', position: null, progress: null});
    expect(f.deps.createAudio).not.toHaveBeenCalled(); expect(f.deps.cancel).toHaveBeenCalledWith('speech-1');
    f.controller.dispose();
  });

  it('dispose 后所有入口保持安静，重复销毁不重新释放', async () => {
    const f = fixture(); await f.controller.play('Hello world', 'en'); const audio = f.audios[0];
    f.controller.dispose(); const snapshot = structuredClone(f.state);
    f.controller.setRate(1.5); f.controller.setLoop(true); f.controller.pause(); f.controller.stop(); f.controller.clear();
    expect(f.controller.seek(5)).toBe(false); await f.controller.restart(); await f.controller.play('Other', 'fr'); f.controller.dispose();
    expect(f.state).toEqual(snapshot); expect(audio.playbackRate).toBe(1); expect(audio.loop).toBe(false);
    expect(f.deps.releaseAudio).toHaveBeenCalledOnce(); expect(f.deps.synthesize).toHaveBeenCalledOnce();
  });

  it('空白文本停止当前音频并给出输入错误，空文本不请求语音', async () => {
    const f = fixture(); await f.controller.play('Hello world', 'en');
    await f.controller.play(' \n ', 'en');
    expect(f.state).toMatchObject({status: 'error', error: '朗读文本为空', text: '', progress: null});
    expect(f.deps.releaseAudio).toHaveBeenCalledOnce(); expect(f.deps.synthesize).toHaveBeenCalledOnce();
    await f.controller.play('Hello world', 'en'); expect(f.state.status).toBe('playing'); f.controller.dispose();
  });

  it.each(['async', 'sync'] as const)('取消 %s 失败不污染当前播放', async mode => {
    const cancel = vi.fn((_id: string) => {
      if (mode === 'sync') throw new Error('stop disconnected');
      return Promise.reject(new Error('stop disconnected'));
    });
    const f = fixture({cancel}); await f.controller.play('Hello world', 'en');
    await f.controller.play('New sentence', 'en'); await flush();
    expect(f.state).toMatchObject({status: 'playing', error: '', text: 'New sentence'});
    f.controller.dispose(); await flush();
  });

  it('编号创建失败没有可取消 ID，清理也不影响下一次显式请求', async () => {
    const createId = vi.fn().mockImplementationOnce(() => {throw new Error('random unavailable');}).mockReturnValue('recovered');
    const f = fixture({createId}); await f.controller.play('Hello world', 'en');
    expect(f.state.error).toBe('random unavailable'); f.controller.clear(); await flush();
    expect(f.deps.cancel).not.toHaveBeenCalled(); await f.controller.play('Hello world', 'en');
    expect(f.state.status).toBe('playing'); f.controller.dispose();
  });
});

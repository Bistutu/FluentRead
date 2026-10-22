import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {Config} from '@/src/core/config/model';
import {createVideoReadingPlayer} from '@/src/features/video-subtitle/content/readingAnnotationPlayer';
import type {VideoSubtitleCue} from '@/src/features/video-subtitle/content/youtubeSubtitleData';

const mocks = vi.hoisted(() => ({config: {} as Config, capabilities: {extensionDom: true}, youtube: true,
  annotate: vi.fn(), patch: vi.fn(), send: vi.fn(), choose: vi.fn(), caption: vi.fn(), reading: vi.fn()}));
vi.mock('@/src/services/config/store', () => ({config: mocks.config, requestConfigPatch: mocks.patch}));
vi.mock('@/src/platform/browser/capabilities', () => ({browserCapabilities: mocks.capabilities}));
vi.mock('@/src/platform/browser/runtimeMessages', () => ({sendRuntimeMessage: mocks.send}));
vi.mock('@/src/features/video-subtitle/content/readingAnnotationClient', () => ({annotateVideoReading: mocks.annotate}));
vi.mock('@/src/features/video-subtitle/content/youtubeSubtitleData', () => ({chooseYoutubeCaptionTrackForLocation: mocks.choose}));
vi.mock('@/src/features/video-subtitle/content/ui', () => ({
  isYouTubeVideoPage: () => mocks.youtube, isOriginalTimedTextUrl: (url: string) => !new URL(url).searchParams.has('tlang'),
  normalizeVideoSubtitleDisplayMode: (value: string) => ['original-only', 'translation-only'].includes(value) ? value : 'bilingual',
  renderHumanVideoCaption: mocks.caption, renderVideoReadingAnnotation: mocks.reading, videoUi: (key: string) => key,
}));

const flush = async () => {for (let index = 0; index < 12; index += 1) await Promise.resolve();};
const result = {text: 'konnichiwa', language: 'ja', scheme: 'fixture'};
const instances: Array<ReturnType<typeof createVideoReadingPlayer>> = [];
beforeEach(() => {
  Object.assign(mocks.config, new Config(), {on: true, videoTranslationEnabled: true, videoSubtitleVisible: true, from: 'ja'});
  mocks.capabilities.extensionDom = true; mocks.youtube = true;
  mocks.annotate.mockReset().mockResolvedValue(result); mocks.patch.mockReset().mockResolvedValue(undefined);
  mocks.choose.mockReset().mockReturnValue({languageCode: 'ja'}); mocks.caption.mockReset(); mocks.reading.mockReset().mockReturnValue(true);
});
afterEach(() => {instances.splice(0).forEach(instance => instance.destroy()); vi.unstubAllGlobals(); vi.restoreAllMocks();});

function fixture() {
  const {document, window} = parseHTML('<html><body><div id="player"></div><div id="caption"></div></body></html>');
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=reading'));
  let visibility = 'visible'; Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => visibility});
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  const player = document.getElementById('player')!, caption = document.getElementById('caption')!;
  const context: {key: string; captured?: {url: string}; cues: VideoSubtitleCue[]} = {key: 'track', cues: [{startMs: 0, durationMs: 1000, text: 'こんにちは'}]};
  const ports = {getPlayer: vi.fn((): HTMLElement | null => player), canRead: vi.fn(() => true), getSourceContext: vi.fn(() => context),
    nativeSync: vi.fn(), scheduleLayout: vi.fn(), updateMenu: vi.fn(), updateCaption: vi.fn(), resetCaption: vi.fn()};
  const reading = createVideoReadingPlayer(ports); instances.push(reading);
  const render = (text = 'こんにちは') => reading.renderCaption(player, caption, text, '译文');
  const menu = document.createElement('div');
  menu.innerHTML = '<button data-action="toggle-reading-annotation"><span data-reading-label></span></button><span data-reading-status></span><button data-action="retry-reading-annotation"></button>';
  return {document, window, player, caption, context, ports, reading, render, menu,
    visibility(value: string) {visibility = value; document.dispatchEvent(new window.Event('visibilitychange'));}};
}

describe('播放器读音与原轨上下文所有权', () => {
  it('默认关闭仅渲染原字幕，不读取语言脚本或启动读音，空句及不可见状态也提前结束', async () => {
    const f = fixture(); expect(f.reading.enabled()).toBe(false); f.render();
    expect(mocks.caption).toHaveBeenCalledWith(f.player, f.caption, 'こんにちは', '译文');
    expect(f.ports.getSourceContext).not.toHaveBeenCalled(); expect(mocks.choose).not.toHaveBeenCalled();
    mocks.config.videoSubtitleAppearance.readingAnnotation = true; f.render('');
    f.ports.canRead.mockReturnValue(false); f.render(); f.ports.canRead.mockReturnValue(true);
    mocks.config.videoSubtitleDisplayMode = 'translation-only'; f.render(); mocks.config.videoSubtitleDisplayMode = 'bilingual';
    f.visibility('hidden'); f.render(); await flush();
    expect(mocks.annotate).not.toHaveBeenCalled(); expect(f.ports.getSourceContext).not.toHaveBeenCalled();
    f.reading.clear(); f.reading.reset(); expect(f.reading.state.status).toBe('idle');
  });

  it('只在来源上下文变化时重新解析语言，状态变动按需布局，缺播放器不写DOM', async () => {
    const f = fixture(); mocks.config.videoSubtitleAppearance.readingAnnotation = true;
    mocks.reading.mockReturnValueOnce(false); f.render(); await flush();
    expect(mocks.choose).toHaveBeenCalledOnce(); expect(f.reading.state.result).toEqual(result);
    expect(f.ports.scheduleLayout).toHaveBeenCalledOnce(); expect(f.ports.nativeSync).toHaveBeenCalledTimes(2);
    f.render(); await flush(); expect(mocks.choose).toHaveBeenCalledOnce(); expect(mocks.annotate).toHaveBeenCalledOnce();
    f.context.key = 'another-track'; f.render(); expect(mocks.choose).toHaveBeenCalledTimes(2);
    mocks.config.from = 'auto'; f.render(); expect(mocks.choose).toHaveBeenCalledTimes(3);
    f.ports.getPlayer.mockReturnValue(null); f.reading.clear();
    expect(mocks.reading).toHaveBeenLastCalledWith(f.player, 'konnichiwa', 'ja');
    expect(f.ports.updateMenu).toHaveBeenCalledTimes(3);
  });

  it('学习上下文在读音关闭时仍可读取，翻译轨被排除，语言尊重原轨并提供元数据回退', () => {
    const f = fixture(); expect(f.reading.sourceContext.getCues()).toBe(f.context.cues);
    f.context.captured = {url: 'https://www.youtube.com/api/timedtext?lang=ja&tlang=en'};
    expect(f.reading.sourceContext.getCues()).toEqual([]); expect(f.reading.sourceContext.getLanguage()).toBe('ja');
    f.context.captured.url = 'https://www.youtube.com/api/timedtext?lang=ko';
    expect(f.reading.sourceContext.getCues()).toBe(f.context.cues); expect(f.reading.sourceContext.getLanguage()).toBe('ko');
    f.context.captured = undefined; mocks.choose.mockReturnValue(null); expect(f.reading.sourceContext.getLanguage()).toBe('ja');
    mocks.youtube = false; f.context.key = 'x:native:ru'; expect(f.reading.sourceContext.getLanguage()).toBe('ru');
    mocks.config.videoSourceLanguage = 'th'; f.context.key = 'x:native:original'; expect(f.reading.sourceContext.getLanguage()).toBe('th');
    f.context.key = 'x:captions'; expect(f.reading.sourceContext.getLanguage()).toBe('th');
    expect(mocks.annotate).not.toHaveBeenCalled();
  });

  it('菜单反映等待、失败、语言、模式与能力；重试只交回当前句，开关保留所有外观字段', async () => {
    const f = fixture(), toggle = f.menu.querySelector<HTMLButtonElement>('[data-action="toggle-reading-annotation"]')!;
    const status = f.menu.querySelector<HTMLElement>('[data-reading-status]')!, retry = f.menu.querySelector<HTMLButtonElement>('[data-action="retry-reading-annotation"]')!;
    f.reading.syncMenu(f.menu, false, 'bilingual'); expect(toggle.disabled).toBe(true); expect(status.hidden).toBe(true);
    expect(toggle.textContent).toBe('video.readingAnnotation.label');
    mocks.config.videoSubtitleAppearance.readingAnnotation = true;
    let reject!: (error: Error) => void; mocks.annotate.mockImplementationOnce(() => new Promise((_, no) => {reject = no;}));
    f.render(); await flush(); f.reading.syncMenu(f.menu, true, 'bilingual');
    expect(toggle.disabled).toBe(false); expect(toggle.getAttribute('aria-checked')).toBe('true'); expect(toggle.textContent).toBe('video.readingAnnotation.ja');
    expect(status.textContent).toBe('video.readingAnnotation.loading'); expect(retry.hidden).toBe(true);
    reject(new Error('failed')); await flush(); f.reading.syncMenu(f.menu, true, 'bilingual');
    expect(status.textContent).toBe('video.readingAnnotation.error'); expect(retry.hidden).toBe(false);
    expect(f.reading.handleAction('retry-reading-annotation')).toBe(true); expect(f.ports.updateCaption).toHaveBeenCalledOnce();
    f.render(); await flush(); f.reading.syncMenu(f.menu, true, 'bilingual'); expect(status.hidden).toBe(true);
    f.reading.syncMenu(f.menu, true, 'translation-only'); expect(status.textContent).toBe('video.readingAnnotation.originalRequired');
    mocks.capabilities.extensionDom = false; f.reading.syncMenu(f.menu, true, 'bilingual');
    expect(toggle.disabled).toBe(true); expect(status.textContent).toBe('video.readingAnnotation.unavailable');
    expect(f.reading.handleAction(undefined)).toBe(false);
    const appearance = {...mocks.config.videoSubtitleAppearance}; expect(f.reading.handleAction('toggle-reading-annotation')).toBe(true);
    expect(mocks.patch).toHaveBeenCalledWith({videoSubtitleAppearance: {...appearance, readingAnnotation: false}}, mocks.send);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined); mocks.patch.mockRejectedValueOnce(new Error('offline'));
    f.reading.handleAction('toggle-reading-annotation'); await flush(); expect(warning).toHaveBeenCalledWith('[FluentRead] 视频字幕设置保存失败', expect.any(Error));
    f.reading.syncMenu(f.document.createElement('div'), true, 'bilingual'); toggle.replaceChildren(); f.reading.syncMenu(f.menu, true, 'bilingual');
  });

  it('开启后无适用语言或读音仅提示原因，空句和关闭清除提示且没有重试按钮', async () => {
    const f = fixture(), status = f.menu.querySelector<HTMLElement>('[data-reading-status]')!, retry = f.menu.querySelector<HTMLButtonElement>('[data-action="retry-reading-annotation"]')!;
    mocks.config.videoSubtitleAppearance.readingAnnotation = true;
    mocks.choose.mockReturnValue({languageCode: 'en'}); f.render('Hello'); await flush(); f.reading.syncMenu(f.menu, true, 'bilingual');
    expect(f.reading.state.status).toBe('no-reading'); expect(status.textContent).toBe('video.readingAnnotation.noReading');
    expect(status.hidden).toBe(false); expect(retry.hidden).toBe(true); expect(mocks.annotate).not.toHaveBeenCalled();
    f.render(''); f.reading.syncMenu(f.menu, true, 'bilingual'); expect(status.hidden).toBe(true);
    mocks.choose.mockReturnValue({languageCode: 'ja'}); mocks.annotate.mockResolvedValueOnce(null);
    f.render(); await flush(); f.reading.syncMenu(f.menu, true, 'bilingual');
    expect(status.textContent).toBe('video.readingAnnotation.noReading'); expect(retry.hidden).toBe(true); expect(mocks.annotate).toHaveBeenCalledOnce();
    f.render(); await flush(); expect(mocks.annotate).toHaveBeenCalledOnce();
    mocks.config.videoSubtitleAppearance.readingAnnotation = false; f.reading.syncConfig(mocks.config); f.reading.syncMenu(f.menu, true, 'bilingual');
    expect(status.hidden).toBe(true); expect(retry.hidden).toBe(true);
  });

  it('模式变化重新授予同句翻译资格，关闭与隐藏取消在途，销毁后移除页面监听', async () => {
    const f = fixture(); mocks.config.videoSubtitleAppearance.readingAnnotation = true;
    mocks.annotate.mockImplementation(() => new Promise(() => undefined));
    f.render(); await flush(); const signal = mocks.annotate.mock.calls[0][2] as AbortSignal;
    f.visibility('visible'); expect(signal.aborted).toBe(false); f.visibility('hidden'); expect(signal.aborted).toBe(true);
    f.visibility('visible'); f.render(); await flush();
    f.reading.syncConfig(mocks.config); expect(f.ports.resetCaption).not.toHaveBeenCalled();
    mocks.config.videoSubtitleDisplayMode = 'translation-only'; f.reading.syncConfig(mocks.config);
    expect(f.ports.resetCaption).toHaveBeenCalledOnce(); expect(f.reading.state.status).toBe('idle');
    mocks.config.videoSubtitleDisplayMode = 'bilingual';
    for (const key of ['on', 'videoTranslationEnabled', 'videoSubtitleVisible'] as const) {
      mocks.config[key] = false; f.reading.syncConfig(mocks.config); mocks.config[key] = true;
    }
    mocks.config.videoSubtitleAppearance.readingAnnotation = false; f.reading.syncConfig(mocks.config);
    const remove = vi.spyOn(f.document, 'removeEventListener'); f.reading.destroy();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});

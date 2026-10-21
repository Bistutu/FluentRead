/**
 * @file src/features/video-subtitle/content/readingAnnotationPlayer.ts
 * 文件职责：拥有播放器当前原句的读音显示、菜单交互与配置切换生命周期。
 * 主要内容：装配独立读音控制器和本地请求端，关闭时跳过语言解析，按原句及轨道上下文缓存语言元数据；为完整句学习提供始终可用的原轨上下文，更新稳定读音节点和菜单状态，保留仅译文语义，并在显示模式切换时请求宿主重置当前句翻译资格，隐藏及销毁时清理自有任务与监听。
 * 模块边界：只操作视频 feature 自有 UI 并通过既有入口读写共享配置；播放器定位、翻译状态与字幕布局由宿主注入，原轨上下文不依赖读音开关，不访问词典、创建 Worker 或管理视频采集。
 */
import type {Config} from '@/src/core/config/model';
import {config, requestConfigPatch} from '@/src/services/config/store';
import {browserCapabilities} from '@/src/platform/browser/capabilities';
import {sendRuntimeMessage} from '@/src/platform/browser/runtimeMessages';
import {createVideoReadingController} from './readingAnnotationController';
import {annotateVideoReading} from './readingAnnotationClient';
import {isOriginalTimedTextUrl, isYouTubeVideoPage, normalizeVideoSubtitleDisplayMode, renderHumanVideoCaption, renderVideoReadingAnnotation, videoUi} from './ui';
import {chooseYoutubeCaptionTrackForLocation, type VideoSubtitleCue} from './youtubeSubtitleData';

interface ReadingPlayerPorts {
  getPlayer(): HTMLElement | null;
  canRead(): boolean;
  getSourceContext(): {key: string; captured?: {url: string}; cues: VideoSubtitleCue[]};
  nativeSync(): void;
  scheduleLayout(): void;
  updateMenu(): void;
  updateCaption(): void;
  resetCaption(): void;
}

export function createVideoReadingPlayer(ports: ReadingPlayerPorts) {
  let languageKey = '', sourceLanguage = '';
  let displayMode = normalizeVideoSubtitleDisplayMode(config.videoSubtitleDisplayMode);
  const enabled = () => browserCapabilities.extensionDom && config.videoSubtitleAppearance.readingAnnotation === true;
  const controller = createVideoReadingController(annotateVideoReading, state => {
    const player = ports.getPlayer();
    if (player && renderVideoReadingAnnotation(player, state.result?.text || '', state.language)) ports.scheduleLayout();
    ports.nativeSync();
    ports.updateMenu();
  });
  // 播放器读音与完整句学习读取同一原轨元数据，不能把自动翻译轨当作原句学习材料。
  const getLearningCues = () => {
    const {captured, cues} = ports.getSourceContext();
    return isYouTubeVideoPage() && captured && !isOriginalTimedTextUrl(captured.url) ? [] : cues;
  };
  const getSourceLanguage = () => {
    const {key, captured} = ports.getSourceContext();
    if (isYouTubeVideoPage()) return new URL(captured?.url || window.location.href).searchParams.get('lang')
      || chooseYoutubeCaptionTrackForLocation(document, window.location, config.from)?.languageCode || config.from;
    const native = key.startsWith('x:native:') ? key.slice('x:native:'.length) : '';
    return native && native !== 'original' ? native : config.videoSourceLanguage;
  };
  const onVisibility = () => {if (document.visibilityState === 'hidden') controller.clear();};
  document.addEventListener('visibilitychange', onVisibility);
  return {
    enabled,
    sourceContext: {getCues: getLearningCues, getLanguage: getSourceLanguage},
    get state() {return controller.state;},
    clear: controller.clear,
    reset: controller.reset,
    destroy() {document.removeEventListener('visibilitychange', onVisibility); controller.destroy();},
    renderCaption(player: HTMLElement, container: HTMLElement, source: string, translation: string): void {
      renderHumanVideoCaption(player, container, source, translation);
      if (!source || !enabled() || !ports.canRead() || normalizeVideoSubtitleDisplayMode(config.videoSubtitleDisplayMode) === 'translation-only'
        || document.visibilityState === 'hidden') {controller.clear(); return;}
      // DOM 回退可逐帧刷新；大型 YouTube 脚本中的语言元数据只在实际上下文变化后解析。
      const nextKey = JSON.stringify([source, ports.getSourceContext().key, config.from, config.videoSourceLanguage, window.location.href]);
      if (nextKey !== languageKey) {languageKey = nextKey; sourceLanguage = getSourceLanguage();}
      controller.sync(source, sourceLanguage, true);
    },
    syncMenu(menu: HTMLElement, subtitlesEnabled: boolean, selectedMode: string): void {
      const toggle = menu.querySelector<HTMLButtonElement>('[data-action="toggle-reading-annotation"]');
      if (toggle) {
        toggle.setAttribute('aria-checked', String(config.videoSubtitleAppearance.readingAnnotation === true));
        toggle.disabled = !browserCapabilities.extensionDom || !subtitlesEnabled;
        const label = toggle.querySelector<HTMLElement>('[data-reading-label]');
        if (label) label.textContent = videoUi(`video.readingAnnotation.${controller.state.language || 'label'}`);
      }
      const status = menu.querySelector<HTMLElement>('[data-reading-status]');
      if (status) {
        status.textContent = !browserCapabilities.extensionDom ? videoUi('video.readingAnnotation.unavailable')
          : selectedMode === 'translation-only' && enabled() ? videoUi('video.readingAnnotation.originalRequired')
            : controller.state.status === 'loading' ? videoUi('video.readingAnnotation.loading')
              : controller.state.status === 'error' ? videoUi('video.readingAnnotation.error') : '';
        status.hidden = !status.textContent;
      }
      const retry = menu.querySelector<HTMLButtonElement>('[data-action="retry-reading-annotation"]');
      if (retry) retry.hidden = controller.state.status !== 'error';
    },
    handleAction(action: string | undefined): boolean {
      if (action === 'toggle-reading-annotation') {
        void requestConfigPatch({videoSubtitleAppearance: {...config.videoSubtitleAppearance, readingAnnotation: !config.videoSubtitleAppearance.readingAnnotation}}, sendRuntimeMessage)
          .catch(error => {console.warn('[FluentRead] 视频字幕设置保存失败', error);});
        return true;
      }
      if (action === 'retry-reading-annotation') {controller.retry(); ports.updateCaption(); return true;}
      return false;
    },
    syncConfig(nextConfig: Config): void {
      const nextMode = normalizeVideoSubtitleDisplayMode(nextConfig.videoSubtitleDisplayMode);
      if (nextMode !== displayMode) {displayMode = nextMode; ports.resetCaption();}
      if (!enabled() || !nextConfig.on || !nextConfig.videoTranslationEnabled || nextConfig.videoSubtitleVisible === false
        || nextMode === 'translation-only') controller.clear();
    },
  };
}

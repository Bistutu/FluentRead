/**
 * @file src/features/video-subtitle/content/serviceProfile.ts
 * 文件职责：为视频字幕内容运行时提供翻译服务标签与预翻译窗口的纯判定。
 * 主要内容：识别内置、动态 OpenAI-compatible 及组合服务，用保存的 profile 名称生成标签，并为 AI 服务及含 AI 成员的组合选择较长预取窗口。
 * 模块边界：本文件只读取传入的服务 profile 和配置快照，不访问 DOM、播放器、网络或持久化；字幕生命周期仍由同目录 runtime 编排。
 */
import {options, servicesType} from '@/src/core/config/catalog';
import {
  getCustomOpenAIProviderLabel,
  isConfiguredCustomOpenAIProvider,
  type CustomOpenAIProvider,
} from '@/src/core/config/customOpenAI';
import {getCompositeTranslationProvider, type CompositeTranslationProvider} from '@/src/core/config/compositeTranslation';
import {config} from '@/src/services/config/store';

export const VIDEO_PRETRANSLATION_MACHINE_WINDOW_MS = 10_000;
export const VIDEO_PRETRANSLATION_AI_WINDOW_MS = 30_000;

export function getVideoPretranslationWindowMs(
  service: string,
  providers: readonly CustomOpenAIProvider[] = config.customOpenAIProviders,
  composites: readonly CompositeTranslationProvider[] = config.compositeTranslationProviders,
): number {
  const composite = getCompositeTranslationProvider(composites, service);
  return servicesType.isAI(service) || isConfiguredCustomOpenAIProvider(providers, service)
    || composite?.services.some(member => servicesType.isAI(member) || isConfiguredCustomOpenAIProvider(providers, member))
    ? VIDEO_PRETRANSLATION_AI_WINDOW_MS
    : VIDEO_PRETRANSLATION_MACHINE_WINDOW_MS;
}

export function getVideoServiceLabel(
  service: string,
  providers: readonly CustomOpenAIProvider[] = config.customOpenAIProviders,
  composites: readonly CompositeTranslationProvider[] = config.compositeTranslationProviders,
): string {
  const item = options.services.find((candidate: any) => candidate.value === service);
  return item?.label || getCompositeTranslationProvider(composites, service)?.name || getCustomOpenAIProviderLabel(providers, service);
}

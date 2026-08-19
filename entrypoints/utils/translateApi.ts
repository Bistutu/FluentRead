/**
 * 翻译API代理模块
 * 整合翻译队列管理，作为翻译函数和后台翻译服务之间的中间层
 */

import {
  enqueueTranslation,
  clearTranslationQueue,
  type TranslationQueueLease,
  type TranslationQueueSession,
} from './translateQueue';
import browser from 'webextension-polyfill';
import { config, saveConfig } from './config';
import { detectlang } from './common';
import { resolveConfiguredModel, servicesType } from './option';
import { getPageTranslationContext } from './pageContext';
import { getMissingCredentialMessage } from './configValidation';

// 调试相关
const isDev = process.env.NODE_ENV === 'development';
const VIDEO_COUNT_SAVE_INTERVAL = 10_000;
const TRANSLATION_COUNT_SAVE_INTERVAL = 500;
let videoCountSaveTimer: ReturnType<typeof setTimeout> | undefined;
let translationCountSaveTimer: ReturnType<typeof setTimeout> | undefined;

function createAbortError(): Error {
  const error = new Error('翻译已取消');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function waitForDelay(delay: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

function waitForRequest<T>(
  request: PromiseLike<T>,
  timeout: number,
  signal?: AbortSignal,
  lease?: TranslationQueueLease,
): Promise<T> {
  throwIfAborted(signal);
  const transportSettlement = new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('翻译请求超时'))), timeout);
    Promise.resolve(request).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });

  // Aborting a DOM attempt cannot cancel an already-dispatched extension
  // message. Keep the queue slot leased until that transport settles or its
  // timeout fires, while allowing the caller to stop waiting immediately.
  lease?.holdUntil(transportSettlement);
  if (!signal) return transportSettlement;

  return new Promise<T>((resolve, reject) => {
    let callerSettled = false;
    const finishCaller = (callback: () => void) => {
      if (callerSettled) return;
      callerSettled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finishCaller(() => reject(createAbortError()));
    signal.addEventListener('abort', onAbort, {once: true});
    if (signal.aborted) {
      onAbort();
      return;
    }
    transportSettlement.then(
      (value) => finishCaller(() => resolve(value)),
      (error) => finishCaller(() => reject(error)),
    );
  });
}

function scheduleTranslationCountSave(): void {
  config.count++;
  if (translationCountSaveTimer) return;
  translationCountSaveTimer = setTimeout(() => {
    translationCountSaveTimer = undefined;
    void saveConfig().catch((error) => console.error('[FluentRead] 保存翻译计数失败:', error));
  }, TRANSLATION_COUNT_SAVE_INTERVAL);
}

function flushTranslationCountSave(): void {
  if (!translationCountSaveTimer) return;
  clearTimeout(translationCountSaveTimer);
  translationCountSaveTimer = undefined;
  void saveConfig().catch((error) => console.error('[FluentRead] 保存翻译计数失败:', error));
}

function scheduleVideoCountSave(): void {
  config.count++;
  if (videoCountSaveTimer) return;

  videoCountSaveTimer = setTimeout(() => {
    videoCountSaveTimer = undefined;
    void saveConfig().catch((error) => console.error('[FluentRead] 保存视频翻译计数失败:', error));
  }, VIDEO_COUNT_SAVE_INTERVAL);
}

/**
 * 翻译API的统一入口
 * 所有翻译请求都应该通过此函数发送，以便集中管理队列和重试逻辑
 * 
 * @param origin 原始文本
 * @param context 上下文信息，通常是页面标题
 * @param options 翻译选项
 * @returns 翻译结果的Promise
 */
export async function translateText(origin: string, context: string = document.title, options: TranslateOptions = {}): Promise<string> {
  const {
    maxRetries = 3, 
    retryDelay = 1000, 
    timeout = 45000,
    useCache = config.useCache,
    skipLanguageDetection = false,
    signal,
    queueSession,
  } = options;
  throwIfAborted(signal);
  // 检查 origin 是否为空或只有空白字符
  const cleanedOrigin = origin?.replace(/[\s\u3000]/g, '') || '';
  if (!cleanedOrigin || cleanedOrigin.length === 0) {
    return origin || '';
  }

  assertTranslationCredentials();

  // 如果目标语言与当前文本语言相同，直接返回原文
  if (!skipLanguageDetection && detectlang(origin.replace(/[\s\u3000]/g, '')) === config.to) {
    return origin;
  }

  const pageContext = await resolvePageContext(options.pageContext);
  throwIfAborted(signal);

  // 同一富文本回退可能产生多个短请求；合并持久化写入，避免每个 slot
  // 都触发 storage watcher 和页面配置刷新。
  scheduleTranslationCountSave();

  // 使用队列处理翻译请求
  return enqueueTranslation(async (lease) => {
    // 创建翻译任务
    const translationTask = async (retryCount: number = 0): Promise<string> => {
      throwIfAborted(signal);
      try {
        // 发送翻译请求给background脚本处理
        const result = await waitForRequest(
          browser.runtime.sendMessage({ context, pageContext, origin, useCache }),
          timeout,
          signal,
          lease,
        ) as string;

        // 如果翻译结果为空或与原文完全相同，直接返回原文
        if (!result || result === origin) {
          return origin;
        }

        return result;
      } catch (error) {
        if (isAbortError(error)) throw error;
        // 处理错误，根据重试策略决定是否重试
        if (retryCount < maxRetries) {
          if (isDev) {
            console.log(`[翻译API] 翻译失败，${retryCount + 1}/${maxRetries} 次重试，原因:`, error);
          }
          
          // 等待一段时间后重试
          await waitForDelay(retryDelay, signal);
          return translationTask(retryCount + 1);
        }
        
        // 超过最大重试次数，抛出异常
        throw error;
      }
    };

    // 开始执行翻译任务
    return translationTask();
  }, queueSession);
}

/**
 * 批量翻译纯文本片段。用于仅译文模式保留原始 DOM 结构，避免机器翻译接口修改标签和属性。
 */
export async function translateTextBatch(
  origins: string[],
  context: string = document.title,
  options: TranslateOptions = {},
): Promise<string[]> {
  if (origins.length === 0) return [];

  assertTranslationCredentials();

  const {
    maxRetries = 3,
    retryDelay = 1000,
    timeout = 45000,
    useCache = config.useCache,
    signal,
    queueSession,
  } = options;
  throwIfAborted(signal);
  const pageContext = await resolvePageContext(options.pageContext);
  throwIfAborted(signal);

  scheduleTranslationCountSave();

  return enqueueTranslation(async (lease) => {
    const translationTask = async (retryCount: number = 0): Promise<string[]> => {
      throwIfAborted(signal);
      try {
        const result = await waitForRequest(
          browser.runtime.sendMessage({ context, pageContext, origin: origins, useCache }),
          timeout,
          signal,
          lease,
        );

        if (!Array.isArray(result) || result.length !== origins.length || result.some(item => typeof item !== 'string')) {
          throw new Error('批量翻译返回格式异常');
        }

        return result as string[];
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (retryCount < maxRetries) {
          await waitForDelay(retryDelay, signal);
          return translationTask(retryCount + 1);
        }
        throw error;
      }
    };

    return translationTask();
  }, queueSession);
}

/**
 * 翻译视频字幕。视频字幕使用独立的服务配置，但仍通过 background
 * 统一请求、缓存和错误边界；只发送 YouTube 已提供的纯文本字幕内容。
 */
export async function translateVideoText(origin: string): Promise<string> {
  const cleanedOrigin = origin?.replace(/[\s\u3000]/g, '') || '';
  if (!cleanedOrigin) return origin || '';

  const service = config.videoService;
  const pageContext = await resolvePageContext(undefined, service);

  // 视频字幕是高频、短文本请求。计数保留在内存中，并合并为低频写入，避免
  // storage 写入和配置订阅回调把播放器主线程拖入高频循环。
  scheduleVideoCountSave();
  return enqueueTranslation(async (lease) => {
    return waitForRequest(browser.runtime.sendMessage({
        context: `YouTube 视频字幕：${typeof document === 'undefined' ? '' : document.title}`,
        pageContext,
        origin,
        useCache: config.useCache,
        serviceOverride: service,
      }), 20_000, undefined, lease) as Promise<string>;
  });
}

/**
 * 当用户离开页面或主动取消翻译时，清空翻译队列
 */
export function cancelAllTranslations() {
  if (isDev) {
    console.log('[翻译API] 取消所有等待中的翻译任务');
  }
  clearTranslationQueue();
  flushTranslationCountSave();
}

/**
 * 翻译参数接口
 */
export interface TranslateOptions {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试间隔(毫秒) */
  retryDelay?: number;
  /** 超时时间(毫秒) */
  timeout?: number;
  /** 是否使用缓存 */
  useCache?: boolean;
  /** 发送给 LLM 的网页参考上下文；未提供时按当前页面自动提取。 */
  pageContext?: string;
  /** Internal structured packets contain ASCII sentinels that must not affect source-language detection. */
  skipLanguageDetection?: boolean;
  /** Cancel retry delays and ignore a late runtime response after the DOM attempt is restored. */
  signal?: AbortSignal;
  /** Queue scope used to reject work that has not started when one DOM attempt is cancelled. */
  queueSession?: TranslationQueueSession;
}

function assertTranslationCredentials(): void {
  const message = getMissingCredentialMessage(config.service, config);
  if (message) throw new Error(message);
}

async function resolvePageContext(suppliedContext?: string, serviceOverride = config.service): Promise<string | undefined> {
  const service = serviceOverride || config.service;
  const selectedModel = resolveConfiguredModel(config.model[service], config.customModel[service]);
  if (!config.enableAIContext || !servicesType.isUseAIContext(service, selectedModel)) return undefined;
  return suppliedContext?.trim().slice(0, 4000) || await getPageTranslationContext() || undefined;
}

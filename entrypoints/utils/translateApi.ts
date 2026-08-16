/**
 * 翻译API代理模块
 * 整合翻译队列管理，作为翻译函数和后台翻译服务之间的中间层
 */

import { enqueueTranslation, clearTranslationQueue } from './translateQueue';
import browser from 'webextension-polyfill';
import { config, saveConfig } from './config';
import { detectlang } from './common';
import { resolveConfiguredModel, servicesType } from './option';
import { getPageTranslationContext } from './pageContext';
import { getMissingCredentialMessage } from './configValidation';

// 调试相关
const isDev = process.env.NODE_ENV === 'development';

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
  } = options;
  // 检查 origin 是否为空或只有空白字符
  const cleanedOrigin = origin?.replace(/[\s\u3000]/g, '') || '';
  if (!cleanedOrigin || cleanedOrigin.length === 0) {
    return origin || '';
  }

  assertTranslationCredentials();

  // 如果目标语言与当前文本语言相同，直接返回原文
  if (detectlang(origin.replace(/[\s\u3000]/g, '')) === config.to) {
    return origin;
  }

  const pageContext = await resolvePageContext(options.pageContext);

  // 增加翻译计数
  config.count++;
  // 保存配置以确保计数持久化
  void saveConfig().catch((error) => console.error('[FluentRead] 保存翻译计数失败:', error));

  // 使用队列处理翻译请求
  return enqueueTranslation(async () => {
    // 创建翻译任务
    const translationTask = async (retryCount: number = 0): Promise<string> => {
      try {
        // 发送翻译请求给background脚本处理
        const result = await Promise.race([
          browser.runtime.sendMessage({ context, pageContext, origin, useCache }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('翻译请求超时')), timeout)
          )
        ]) as string;

        // 如果翻译结果为空或与原文完全相同，直接返回原文
        if (!result || result === origin) {
          return origin;
        }

        return result;
      } catch (error) {
        // 处理错误，根据重试策略决定是否重试
        if (retryCount < maxRetries) {
          if (isDev) {
            console.log(`[翻译API] 翻译失败，${retryCount + 1}/${maxRetries} 次重试，原因:`, error);
          }
          
          // 等待一段时间后重试
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          return translationTask(retryCount + 1);
        }
        
        // 超过最大重试次数，抛出异常
        throw error;
      }
    };

    // 开始执行翻译任务
    return translationTask();
  });
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
  } = options;
  const pageContext = await resolvePageContext(options.pageContext);

  config.count++;
  void saveConfig().catch((error) => console.error('[FluentRead] 保存翻译计数失败:', error));

  return enqueueTranslation(async () => {
    const translationTask = async (retryCount: number = 0): Promise<string[]> => {
      try {
        const result = await Promise.race([
          browser.runtime.sendMessage({ context, pageContext, origin: origins, useCache }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('翻译请求超时')), timeout)
          )
        ]);

        if (!Array.isArray(result) || result.length !== origins.length || result.some(item => typeof item !== 'string')) {
          throw new Error('批量翻译返回格式异常');
        }

        return result as string[];
      } catch (error) {
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          return translationTask(retryCount + 1);
        }
        throw error;
      }
    };

    return translationTask();
  });
}

/**
 * 翻译视频字幕。视频字幕使用独立的服务配置，但仍通过 background
 * 统一请求、缓存和错误边界；只发送 YouTube 已提供的纯文本字幕内容。
 */
export async function translateVideoText(origin: string): Promise<string> {
  const cleanedOrigin = origin?.replace(/[\s\u3000]/g, '') || '';
  if (!cleanedOrigin) return origin || '';

  config.count++;
  void saveConfig().catch((error) => console.error('[FluentRead] 保存视频翻译计数失败:', error));

  return enqueueTranslation(async () => {
    return Promise.race([
      browser.runtime.sendMessage({
        context: `YouTube 视频字幕：${document.title}`,
        origin,
        useCache: config.useCache,
        serviceOverride: config.videoService,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('视频字幕翻译请求超时')), 20000)),
    ]) as Promise<string>;
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
}

function assertTranslationCredentials(): void {
  const message = getMissingCredentialMessage(config.service, config);
  if (message) throw new Error(message);
}

async function resolvePageContext(suppliedContext?: string): Promise<string | undefined> {
  const selectedModel = resolveConfiguredModel(config.model[config.service], config.customModel[config.service]);
  if (!config.enableAIContext || !servicesType.isUseAIContext(config.service, selectedModel)) return undefined;
  return suppliedContext?.trim().slice(0, 4000) || await getPageTranslationContext() || undefined;
}

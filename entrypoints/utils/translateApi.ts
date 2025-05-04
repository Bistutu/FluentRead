/**
 * 翻译API代理模块
 * 整合翻译队列管理，作为翻译函数和后台翻译服务之间的中间层
 */

import { enqueueTranslation, clearTranslationQueue, getQueueStatus } from './translateQueue';
import browser from 'webextension-polyfill';
import { config } from './config';
import { cache } from './cache';
import { detectlang } from './common';
import { storage } from '@wxt-dev/storage';

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

  // 如果目标语言与当前文本语言相同，直接返回原文
  if (detectlang(origin.replace(/[\s\u3000]/g, '')) === config.to) {
    return origin;
  }

  // 检查缓存
  if (useCache) {
    const cachedResult = cache.localGet(origin);
    if (cachedResult) {
      if (isDev) {
        console.log('[翻译API] 命中缓存，直接返回缓存结果');
      }
      return cachedResult;
    }
  }

  // 增加翻译计数
  config.count++;
  // 保存配置以确保计数持久化
  storage.setItem('local:config', JSON.stringify(config));

  // 使用队列处理翻译请求
  return enqueueTranslation(async () => {
    // 创建翻译任务
    const translationTask = async (retryCount: number = 0): Promise<string> => {
      try {
        // 发送翻译请求给background脚本处理
        const result = await Promise.race([
          browser.runtime.sendMessage({ context, origin }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('翻译请求超时')), timeout)
          )
        ]) as string;

        // 如果翻译结果为空或与原文完全相同，直接返回原文
        if (!result || result === origin) {
          return origin;
        }

        // 缓存翻译结果
        if (useCache) {
          cache.localSet(origin, result);
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
 * 当用户离开页面或主动取消翻译时，清空翻译队列
 */
export function cancelAllTranslations() {
  if (isDev) {
    console.log('[翻译API] 取消所有等待中的翻译任务');
  }
  clearTranslationQueue();
}

/**
 * 获取当前翻译队列的状态
 * 可用于UI显示翻译进度等
 */
export function getTranslationStatus() {
  return getQueueStatus();
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
} 
/**
 * 翻译队列管理模块
 * 控制并发翻译任务的数量，避免同时进行过多翻译请求
 */

import { config } from './config';

// 获取当前最大并发数
function getMaxConcurrentTranslations(): number {
  return config.maxConcurrentTranslations || 6; // 默认值为6
}

// 队列状态
let activeTranslations = 0; // 当前活跃的翻译任务数量
let pendingTranslations: Array<() => Promise<any>> = []; // 等待执行的翻译任务队列

// 调试相关
const isDev = process.env.NODE_ENV === 'development';

/**
 * 添加翻译任务到队列
 * @param translationTask 翻译任务函数, 需要返回Promise
 * @returns 返回一个Promise，当任务执行完成时resolve
 */
export function enqueueTranslation<T>(translationTask: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    // 创建任务包装器，在任务完成后处理队列状态
    const taskWrapper = async () => {
      
      try {
        // 执行实际的翻译任务
        const result = await translationTask();
        resolve(result);
        return result;
      } catch (error) {
        reject(error);
        throw error;
      } finally {
        // 无论成功失败，都需要减少活跃任务计数并处理队列
        activeTranslations--;
        processQueue();
        
      }
    };

    // 将任务添加到队列
    if (activeTranslations < getMaxConcurrentTranslations()) {
      // 直接执行任务
      activeTranslations++;
      taskWrapper();
    } else {
      pendingTranslations.push(taskWrapper);
    }
  });
}

/**
 * 处理队列中的下一个任务
 */
function processQueue() {
  // 如果有等待的任务，并且活跃任务数量未达到上限，执行下一个任务
  if (pendingTranslations.length > 0 && activeTranslations < getMaxConcurrentTranslations()) {
    const nextTask = pendingTranslations.shift();
    if (nextTask) {
      activeTranslations++;
      nextTask().catch(() => {
        // 错误已在任务内部处理，这里仅防止未捕获的Promise异常
      });
    }
  }
}

/**
 * 清空翻译队列
 * 当页面切换或用户手动停止翻译时调用
 */
export function clearTranslationQueue() {
  
  pendingTranslations = [];
  // 不重置activeTranslations，让活跃的翻译任务自然完成
}

/**
 * 获取队列状态
 * @returns 返回当前队列状态对象
 */
export function getQueueStatus() {
  const maxConcurrent = getMaxConcurrentTranslations();
  return {
    activeTranslations,
    pendingTranslations: pendingTranslations.length,
    maxConcurrent,
    isQueueFull: activeTranslations >= maxConcurrent,
    totalTasksInProcess: activeTranslations + pendingTranslations.length
  };
}

/**
 * 检查是否可以添加更多任务
 * 当快速扫描页面，判断是否需要暂停扫描时使用
 */
export function canAcceptMoreTasks(): boolean {
  // 如果等待队列太长，返回false表示需要暂停扫描
  const MAX_QUEUE_LENGTH = getMaxConcurrentTranslations() * 3;
  return pendingTranslations.length < MAX_QUEUE_LENGTH;
} 
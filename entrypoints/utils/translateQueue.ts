/**
 * 翻译队列管理模块
 * 控制并发翻译任务的数量，避免同时进行过多翻译请求
 */

// 队列配置
const MAX_CONCURRENT_TRANSLATIONS = 6; // 最大并发翻译数量

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
      if (isDev) {
        console.log(`[翻译队列] 开始执行翻译任务，当前活跃任务: ${activeTranslations}/${MAX_CONCURRENT_TRANSLATIONS}`);
      }
      
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
        
        if (isDev) {
          console.log(`[翻译队列] 翻译任务完成，剩余任务: ${pendingTranslations.length}, 活跃任务: ${activeTranslations}`);
        }
      }
    };

    // 将任务添加到队列
    if (activeTranslations < MAX_CONCURRENT_TRANSLATIONS) {
      // 直接执行任务
      activeTranslations++;
      taskWrapper();
    } else {
      // 将任务加入等待队列
      if (isDev) {
        console.log(`[翻译队列] 队列已满，任务进入等待状态。等待任务数: ${pendingTranslations.length + 1}`);
      }
      pendingTranslations.push(taskWrapper);
    }
  });
}

/**
 * 处理队列中的下一个任务
 */
function processQueue() {
  // 如果有等待的任务，并且活跃任务数量未达到上限，执行下一个任务
  if (pendingTranslations.length > 0 && activeTranslations < MAX_CONCURRENT_TRANSLATIONS) {
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
  if (isDev && pendingTranslations.length > 0) {
    console.log(`[翻译队列] 清空翻译队列，取消 ${pendingTranslations.length} 个待处理任务`);
  }
  
  pendingTranslations = [];
  // 不重置activeTranslations，让活跃的翻译任务自然完成
}

/**
 * 获取队列状态
 * @returns 返回当前队列状态对象
 */
export function getQueueStatus() {
  return {
    activeTranslations,
    pendingTranslations: pendingTranslations.length,
    maxConcurrent: MAX_CONCURRENT_TRANSLATIONS,
    isQueueFull: activeTranslations >= MAX_CONCURRENT_TRANSLATIONS,
    totalTasksInProcess: activeTranslations + pendingTranslations.length
  };
}

/**
 * 检查是否可以添加更多任务
 * 当快速扫描页面，判断是否需要暂停扫描时使用
 */
export function canAcceptMoreTasks(): boolean {
  // 如果等待队列太长，返回false表示需要暂停扫描
  const MAX_QUEUE_LENGTH = MAX_CONCURRENT_TRANSLATIONS * 3;
  return pendingTranslations.length < MAX_QUEUE_LENGTH;
} 
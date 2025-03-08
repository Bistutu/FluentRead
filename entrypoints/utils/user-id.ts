/**
 * 用户标识工具
 * 用于生成和获取用户的永久标识
 */

import { storage } from '@wxt-dev/storage';

// 用户标识的存储键名
const USER_ID_KEY = 'local:user_id';

/**
 * 生成随机的用户标识
 * 使用时间戳和随机数组合生成，确保唯一性
 */
function generateUserId(): string {
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `fr_${timestamp}_${randomPart}`;
}

/**
 * 获取用户标识
 * 如果本地存储中不存在，则生成一个新的并保存
 */
export async function getUserId(): Promise<string> {
  try {
    let userId = await storage.getItem(USER_ID_KEY);
    if (!userId) {
      userId = generateUserId();
      await storage.setItem(USER_ID_KEY, userId);
    }
    return String(userId);
  } catch (error) {
    console.error('获取用户标识失败:', error);
    // 出错时返回一个临时标识
    return generateUserId();
  }
} 
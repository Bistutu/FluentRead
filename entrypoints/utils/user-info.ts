/**
 * 用户标识工具
 * 用于生成和获取用户的永久标识
 */

import {storage} from '@wxt-dev/storage';

const USER_ID_KEY = 'local:user_id';
const LAST_REPORT_TIME_KEY = 'local:last_report_time';

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
 * get user id
 * if not exist, generate a new one and save it
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
        console.error('get user id failed:', error);
        return generateUserId();
    }
}

/**
 * get last report time
 */
export async function getLastReportTime(): Promise<number> {
    try {
        const lastReportTimeStr = await storage.getItem(LAST_REPORT_TIME_KEY);
        return parseInt(typeof lastReportTimeStr === "string" ? lastReportTimeStr : "0");
    } catch (error) {
        console.error('get last report time failed:', error);
        return 0;
    }
}

/**
 * set last report time
 */
export async function setLastReportTime(time: number): Promise<void> {
    await storage.setItem(LAST_REPORT_TIME_KEY, time.toString());
}
/**
 * InfluxDB 数据上报服务
 * 用于将用户使用数据上报到 InfluxDB
 */

import {config} from './config';
import {getUserId} from './user-id';

// InfluxDB 配置
const INFLUX_CONFIG = {
    url: 'http://124.221.238.116:8086',
    token: 'VE4xd1lzRDU5QUtWSzZJM0hpNjJ5YkhoMUZCVGsyZkZ0RGlLRUlWdEFfY3c0dWNQMlMxSVBpTjNyeS1hNFZPdEp6dnFhVVVkRFJRa2R5LUxxTDdzM0E9PQ==',
    org: 'TK',
    bucket: 'FR',
};

// 上次上报时间的存储键名
const LAST_REPORT_TIME_KEY = 'last_report_time';

/**
 * 上报翻译次数到 InfluxDB
 * 每小时上报一次
 */
export async function reportTranslationCount(): Promise<void> {
    try {
        // 检查是否需要上报（每小时上报一次）
        const shouldReport = await checkShouldReport();
        if (!shouldReport) {
            return;
        }

        // 获取用户标识
        const userId = await getUserId();
        // 获取当前翻译次数
        const count = config.count || 0;
        if (count <= 0) {
            return; // don't report
        }

        // 构建上报数据
        const data = `total-times,user_id=${userId} count=${count}`;

        // send
        await sendToInfluxDB(data);

        // 更新上次上报时间
        await browser.storage.local.set({[LAST_REPORT_TIME_KEY]: Date.now().toString()});
    } catch (error) {
        // console.error('上报失败:', error);
    }
}

/**
 * 检查是否需要上报数据
 * 每小时上报一次
 */
async function checkShouldReport(): Promise<boolean> {
    try {
        // 获取上次上报时间
        const result = await browser.storage.local.get(LAST_REPORT_TIME_KEY);
        const lastReportTimeStr = result[LAST_REPORT_TIME_KEY];

        // 如果没有上报过，则需要上报
        if (!lastReportTimeStr) {
            return true;
        }

        // 计算距离上次上报的时间（毫秒）
        const lastReportTime = parseInt(lastReportTimeStr);
        const currentTime = Date.now();
        const timeDiff = currentTime - lastReportTime;

        // 如果距离上次上报超过 x，需要上报
        // return timeDiff >= 3600000;
        return timeDiff >=  30000;
    } catch (error) {
        console.error('检查是否需要上报失败:', error);
        return false;
    }
}

/**
 * 发送数据到 InfluxDB
 * @param data 上报的数据，使用 Line Protocol 格式
 */
async function sendToInfluxDB(data: string): Promise<void> {
    const {url, token, org, bucket} = INFLUX_CONFIG;
    const decodedToken = atob(token);
    const apiUrl = `${url}/api/v2/write?org=${org}&bucket=${bucket}&precision=ms`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${decodedToken}`,
                'Content-Type': 'text/plain',
            },
            body: data,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`error: ${response.status} ${errorText}`);
        }
    } catch (error) {
        throw error;
    }
} 
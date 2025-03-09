import {config} from './config';
import {getLastReportTime, setLastReportTime,getUserId} from './user-info';

const INFLUX_CONFIG = {
    url: 'aHR0cDovLzEyNC4yMjEuMjM4LjExNjo4MDg2',
    token: 'TFZLRS1PVTY4eWtiUFM2QlRKdGt6SnpvSkw2Tk84NlNkUE9TdTFWWGJhUHE5WFRnbHU2N1pjRklpOUR6UXY5Zm02akdHTXhXaHhKQ3E2ekRTczZhX3c9PQo=',
    org: 'com.fluent-read',
    bucket: 'FluentRead',
};

/**
 * Plan：汇总+改进翻译体验
 */
export async function reportTranslationCount(): Promise<void> {
    try {
        // check if should report
        const shouldReport = await checkShouldReport();
        if (!shouldReport) {
            return;
        }
        // get user id
        const userId = await getUserId();
        // get count
        const count = config.count || 0;
        if (count <= 0) {
            return; // don't report
        }

        // generate data
        const data = `total-times,user_id=${userId} count=${count}`;

        // send
        await sendToInfluxDB(data);

        // update last report time
        await setLastReportTime(Date.now());
    } catch (error) {
        console.error('report failed:', error);
    }
}

async function checkShouldReport(): Promise<boolean> {
    try {
        const lastReportTime = await getLastReportTime();
        if (lastReportTime === 0) {
            return true;
        }

        // calculate time diff
        const currentTime = Date.now();
        const timeDiff = currentTime - lastReportTime;

        // check if should report
        return timeDiff >= 600000;
    } catch (error) {
        console.error('check should report failed:', error);
        return false;
    }
}

async function sendToInfluxDB(data: string): Promise<void> {
    const {url, token, org, bucket} = INFLUX_CONFIG;
    const decodedUrl = atob(url);
    const decodedToken = atob(token);
    const apiUrl = `${decodedUrl}/api/v2/write?org=${org}&bucket=${bucket}&precision=ms`;

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
        console.error('report failed:', error);
        throw error;
    }
} 
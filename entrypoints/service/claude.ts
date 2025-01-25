import {services} from "../utils/option";
import {method, urls} from "../utils/constant";
import {claudeMsgTemplate} from "../utils/template";
import {config} from "@/entrypoints/utils/config";

async function claude(message: any) {
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('x-api-key', config.token[services.claude]);
    headers.append('anthropic-version', '2023-06-01');
    headers.append('anthropic-dangerous-direct-browser-access', 'true');

    const url = config.proxy[config.service] || urls[services.claude];

    try {
        const resp = await fetch(url, {
            method: method.POST,
            headers,
            body: claudeMsgTemplate(message.origin)
        });

        if (!resp.ok) {
            throw new Error(`请求失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
        }

        const result = await resp.json();
        return result.content[0].text;
    } catch (error) {
        console.error('Claude API 调用失败:', error);
        throw error;
    }
}

export default claude;

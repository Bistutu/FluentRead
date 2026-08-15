import { method, urls } from "../utils/constant";
import { deepseekMsgTemplate } from "../utils/template";
import { config } from "@/entrypoints/utils/config";
import { contentPostHandler } from "@/entrypoints/utils/check";

async function deepseek(message: any) {
    try {
        const headers = new Headers({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.token[config.service]}`
        });

        const url = config.proxy[config.service] || urls[config.service];

        const resp = await fetch(url, {
            method: method.POST,
            headers,
            body: deepseekMsgTemplate(message.origin)
        });

        if (!resp.ok) {
            throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
        }

        const result = await resp.json();
        return extractDeepSeekContent(result);
    } catch (error) {
        console.error('API调用失败:', error);
        throw error;
    }
}

function extractDeepSeekContent(result: any): string {
    const content = result?.choices?.[0]?.message?.content;

    if (typeof content !== 'string') {
        throw new Error('DeepSeek 返回数据格式异常：缺少 choices[0].message.content');
    }

    // Only final message.content is rendered. DeepSeek thinking fields such as
    // reasoning_content are intentionally ignored and must never reach the page.
    return contentPostHandler(content);
}

export default deepseek;

import {method, urls} from "../utils/constant";
import {commonMsgTemplate} from "../utils/template";
import {config} from "@/entrypoints/utils/config";
import {contentPostHandler} from "@/entrypoints/utils/check";
import { services } from "../utils/option";
import { appendOptionalBearer } from './auth';

async function common(message: any) {
    try {
        const service = message.serviceOverride || config.service;

        const headers = new Headers({'Content-Type': 'application/json'});
        appendOptionalBearer(headers, config.token[service]);

        if(service === services.openrouter){
            headers.append('HTTP-Referer', 'https://fluent.thinkstu.com');
            headers.append('X-Title', 'FluentRead');
        }
                
        const url = config.proxy[service] || urls[service];

        const resp = await fetch(url, {
            method: method.POST,
            headers,
            body: commonMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service)
        });

        if (!resp.ok) {
            throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
        }

        const result = await resp.json();
        return contentPostHandler(result.choices[0].message.content);
    } catch (error) {
        console.error('API调用失败:', error);
        throw error;
    }
}

export default common;

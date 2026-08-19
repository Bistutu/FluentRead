import {commonMsgTemplate} from "../utils/template";
import {method} from "../utils/constant";
import {services} from "@/entrypoints/utils/option";
import {config} from "@/entrypoints/utils/config";
import {contentPostHandler} from "@/entrypoints/utils/check";
import {appendOptionalBearer} from './auth';

async function custom(message: any) {
    const service = message.serviceOverride || services.custom;
    const url = config.proxy[service] || config.custom;

    if (!url?.trim()) {
        throw new Error('自定义接口地址未配置');
    }

    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    appendOptionalBearer(headers, config.token[service]);

    const resp = await fetch(url, {
        method: method.POST,
        headers: headers,
        body: commonMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service)
    });

    if (resp.ok) {
        let result = await resp.json();
        return  contentPostHandler(result.choices[0].message.content);
    } else {
        console.log("翻译失败：", resp);
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default custom;

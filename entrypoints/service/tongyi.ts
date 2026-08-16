import {currentModelIds, services} from "../utils/option";
import {method, tongyiTokenPlanUrl, urls} from "../utils/constant";
import {tongyiMsgTemplate} from "../utils/template";
import {config} from "@/entrypoints/utils/config";
import {appendOptionalBearer} from './auth';

// 文档：https://help.aliyun.com/zh/dashscope/developer-reference/tongyi-thousand-questions-metering-and-billing
async function tongyi(message: any) {
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    appendOptionalBearer(headers, config.token[services.tongyi]);

    // 判断是否使用代理
    const selectedModel = config.model[services.tongyi];
    const officialUrl = selectedModel === currentModelIds.tongyiTokenPlan
        ? tongyiTokenPlanUrl
        : urls[services.tongyi];
    const url: string = config.proxy[config.service] || officialUrl;

    const resp = await fetch(url, {
        method: method.POST,
        headers: headers,
        body: tongyiMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt)
    });

    if (resp.ok) {
        let result = await resp.json();
        return result.choices[0].message.content;
    } else {
        console.log(resp)
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default tongyi;


//

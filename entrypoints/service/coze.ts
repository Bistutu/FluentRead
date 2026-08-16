import {method, urls} from "../utils/constant";
import {cozeTemplate} from "@/entrypoints/utils/template";
import {config} from "@/entrypoints/utils/config";
import {appendOptionalBearer} from './auth';

async function coze( message: any) {
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    appendOptionalBearer(headers, config.token[config.service]);

    // 判断是否使用代理
    let url: string = config.proxy[config.service] ? config.proxy[config.service] : urls[config.service];

    // 发起 fetch 请求
    const resp = await fetch(url, {
        method: method.POST,
        headers: headers,
        body: cozeTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt)
    });

    if (resp.ok) {
        let result = await resp.json();
        if (result.code === 0 && result.msg === "success") {
            console.log(result.messages[0])
            return result.messages[0].content;
        } else {
            throw new Error(`请求失败: ${result.msg}`);
        }
    } else {
        console.log(resp);
        throw new Error(`请求失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default coze;

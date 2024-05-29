import {method, urls} from "../utils/constant";
import {commonMsgTemplate} from "../utils/template";
import {config} from "@/entrypoints/utils/config";

async function common(message: any) {
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Authorization', `Bearer ${config.token[config.service]}`);

    // 判断是否使用代理
    let url: string = config.proxy[config.service] ? config.proxy[config.service] : urls[config.service]

    // 发起 fetch 请求
    const resp = await fetch(url, {
        method: method.POST,
        headers: headers,
        body: commonMsgTemplate(message.origin)
    })
    if (resp.ok) {
        let result = await resp.json();
        return result.choices[0].message.content
    } else {
        console.log(resp)
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}


export default common;
import {services} from "../utils/option";
import {method} from "../utils/constant";
import {minimaxTemplate} from "../utils/template";
import {config} from "@/entrypoints/utils/config";

async function minimax(message: any) {
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Authorization', `Bearer ${config.token[services.minimax]}`);

    let url = "https://api.minimax.chat/v1/text/" + config.model[services.minimax];

    console.log(url)

    // 发起 fetch 请求
    const resp = await fetch(url, {
        method: method.POST,
        headers: headers,
        body: minimaxTemplate(message.origin)
    })
    if (resp.ok) {
        let result = await resp.json();
        console.log(JSON.stringify(result))
        return result.choices[0].message.content
    } else {
        console.log(resp)
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}


export default minimax;
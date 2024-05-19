import {Config} from "../utils/model";
import {services} from "../utils/option";
import {method, urls} from "../utils/constant";
import {openaiMsgTemplate} from "../utils/template";

async function baichuan(config: Config, message: any) {
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Authorization', `Bearer ${config.token[services.baichuan]}`);

    // 判断是否使用代理
    let url: string = config.proxy[config.service] ? config.proxy[config.service] : urls[services.baichuan]

    // 发起 fetch 请求
    const resp = await fetch(url, {
        method: method.POST,
        headers: headers,
        body: openaiMsgTemplate(config, message.origin)
    })
    if (resp.ok) {
        let result = await resp.json();
        return result.choices[0].message.content
    } else {
        console.log(resp)
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}


export default baichuan;
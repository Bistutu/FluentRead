import {Config} from "../utils/model";
import {services} from "../utils/option";
import {method, urls} from "../utils/constant";
import {claudeMsgTemplate} from "../utils/template";

async function claude(config: Config, message: any) {
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('x-api-key', config.token[services.claude]);
    headers.append('anthropic-version', '2023-06-01');

    // 判断是否使用代理
    let url: string = config.proxy[config.service] ? config.proxy[config.service] : urls[services.claude]

    // 发起 fetch 请求
    const resp = await fetch(url, {
        method: method.POST,
        headers: headers,
        body: claudeMsgTemplate(config, message.origin)
    })
    if (resp.ok) {
        let result = await resp.json();
        return result.content[0].text;
    } else {
        console.log(resp)
        throw new Error(`请求失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default claude;

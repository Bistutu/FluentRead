import {Config} from "../utils/model";
import {services} from "../utils/option";
import {method, urls} from "../utils/constant";
import {tongyiMsgTemplate} from "../utils/template";

// 文档：https://help.aliyun.com/zh/dashscope/developer-reference/tongyi-thousand-questions-metering-and-billing
async function tongyi(config: Config, message: any) {
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Authorization', `Bearer ${config.token[services.tongyi]}`);

    // 判断是否使用代理
    let url: string = config.proxy[config.service] ? config.proxy[config.service] : urls[services.tongyi]

    const resp = await fetch(url, {
        method: method.POST,
        headers: headers,
        body: tongyiMsgTemplate(config, message.origin)
    });

    if (resp.ok) {
        let result = await resp.json();
        return result.output.text
    } else {
        console.log(resp)
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default tongyi;

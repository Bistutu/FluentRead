// 引入所需模块
import {customModelString, services} from "../utils/option";
import {method} from "../utils/constant";
import {commonMsgTemplate} from "@/entrypoints/utils/template";
import {config} from "@/entrypoints/utils/config";

async function infini(message: any) {
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Authorization', `Bearer ${config.token[services.infini]}`);

    let model = config.model[services.infini] === customModelString ? config.customModel[services.infini] : config.model[services.infini]

    // 发起 fetch 请求
    const resp = await fetch(`https://cloud.infini-ai.com/maas/${model}/nvidia/chat/completions`, {
        method: method.POST,
        headers: headers,
        body: commonMsgTemplate(message.origin)
    });

    if (resp.ok) {
        let result = await resp.json();
        return result.choices[0].message.content
    } else {
        console.error(resp);
        throw new Error(`请求失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default infini;

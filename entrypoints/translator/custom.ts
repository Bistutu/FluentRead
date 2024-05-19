import {Config} from "../utils/model";
import {customMsgTemplate} from "../utils/template";
import {method} from "../utils/constant";
import {services} from "@/entrypoints/utils/option";

async function custom(config: Config, message: any) {

    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    headers.append('Authorization', `Bearer ${config.token[services.custom]}`);

    const resp = await fetch(config.custom, {
        method: method.POST,
        headers: headers,
        body: customMsgTemplate(config, message.origin)
    });

    if (resp.ok) {
        let result = await resp.json();
        return result.choices[0].message.content
    } else {
        console.log("翻译失败：", resp);
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default custom;
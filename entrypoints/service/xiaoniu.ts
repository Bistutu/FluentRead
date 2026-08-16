import {method, urls} from "../utils/constant";
import {services} from "../utils/option";
import {config} from "@/entrypoints/utils/config";

async function xiaoniu(message: any) {
    const service = message.serviceOverride || config.service;
    // 根据需要调整目标语言
    let targetLang = config.to === 'zh-Hans' ? 'zh' : config.to;

    // 判断是否使用代理
    let url: string = config.proxy[service] ? config.proxy[service] : urls[services.xiaoniu]

    const resp = await fetch(url, {
        method: method.POST,
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `from=auto&to=${targetLang}&apikey=${config.token[service]}&src_text=${encodeURIComponent(message.origin)}`
    });

    if (resp.ok) {
        let result = await resp.json();
        return result.tgt_text
    } else {
        console.log(resp)
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default xiaoniu;

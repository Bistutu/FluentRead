import {method, urls} from "../utils/constant";
import {config} from "@/entrypoints/utils/config";

async function deeplx(message: any) {
    // deepl 不支持 zh-Hans，需要转换为 zh
    let targetLang = config.to === 'zh-Hans' ? 'zh' : config.to;

    // 判断是否使用代理
    let url: string = config.proxy[config.service] ? config.proxy[config.service] : urls[config.service]

    const resp = await fetch(url, {
        method: method.POST,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            text: message.origin,
            target_lang: targetLang,
        })
    });
    if (resp.ok) {
        let result = await resp.json();
        return result.data
    } else {
        console.log(resp)
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} 请检查 token 是否正确`);
    }
}

export default deeplx;


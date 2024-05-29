import {method, urls} from "../utils/constant";
import {config} from "@/entrypoints/utils/config";

async function transmart(message: any) {
    // 判断是否使用代理
    let url: string = config.proxy[config.service] ? config.proxy[config.service] : urls[config.service];

    let target = config.to === 'zh-Hans' ? 'zh' : config.to;

    const resp = await fetch(url, {
        method: method.POST,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            header: {fn: "auto_translation_block"},
            source: {text_block: message.origin},
            target: {lang: target}
        })
    });

    if (resp.ok) {
        let result = await resp.json();
        return result.auto_translation;  // 返回翻译后的文本
    } else {
        console.log(resp);
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText}`);
    }
}

export default transmart;

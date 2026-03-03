import {method, urls} from "../utils/constant";
import {services} from "../utils/option";
import {config} from "@/entrypoints/utils/config";

async function deepl(message: any) {
    // deepl 不支持 zh-Hans，需要转换为 zh；zh-Hant 转换为 zh-Hant（DeepL 不原生支持繁体中文，可能返回错误）
    let targetLang = config.to === 'zh-Hans' ? 'zh' : config.to;

    // 判断是否使用代理
    let url: string = config.proxy[config.service] ? config.proxy[config.service] : urls[services.deepL]

    const resp = await fetch(url, {
        method: method.POST,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'DeepL-Auth-Key ' + config.token[services.deepL]
        },
        body: JSON.stringify({
            text: [message.origin],
            target_lang: targetLang,
            tag_handling: 'html',
            context: message.context,  // 添加上下文辅助信息
            preserve_formatting: true
        })
    });

    if (resp.ok) {
        let result = await resp.json();
        return result.translations[0].text
    } else {
        console.log(resp)
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} 请检查 token 是否正确`);
    }
}

export default deepl;


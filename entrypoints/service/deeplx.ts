import {method} from "../utils/constant";
import {services} from "../utils/option";
import {config} from "@/entrypoints/utils/config";

async function deeplx(message: any) {
    // deeplx 不支持 zh-Hans，需要转换为 zh
    let targetLang = config.to === 'zh-Hans' ? 'zh' : config.to;
    let sourceLang = config.from === 'auto' ? 'auto' : config.from;
    
    // 判断是否使用代理或自定义URL
    let url: string = config.proxy[config.service] ? config.proxy[config.service] : config.deeplx || 'http://localhost:1188/translate';

    // 构建请求头
    let headers: HeadersInit = {
        'Content-Type': 'application/json'
    };

    // 如果有 token，则添加 Authorization 头
    if (config.token[services.deeplx] && config.token[services.deeplx].trim() !== '') {
        headers['Authorization'] = `Bearer ${config.token[services.deeplx]}`;
    }

    const resp = await fetch(url, {
        method: method.POST,
        headers: headers,
        body: JSON.stringify({
            text: message.origin,
            source_lang: sourceLang.toUpperCase(),
            target_lang: targetLang.toUpperCase()
        })
    });

    if (resp.ok) {
        let result = await resp.json();
        // DeepLX 返回格式通常是 { code: 200, data: "translated text" }
        if (result.code === 200) {
            return result.data;
        } else {
            throw new Error(`DeepLX 翻译失败: ${result.message || '未知错误'}`);
        }
    } else {
        console.log("DeepLX 翻译失败：", resp);
        throw new Error(`DeepLX 翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default deeplx;
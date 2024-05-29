import {method, urls} from "../utils/constant";
import {config} from "@/entrypoints/utils/config";

async function baidufree(message: any) {
    // 百度翻译 API URL
    let url = config.proxy[config.service] ? config.proxy[config.service] : urls[config.service];

    let target = config.to;
    switch (config.to) {
        case "zh-Hans":
            target = "zh";
            break;
        case "ja":
            target = "jp";
            break;
        case "ko":
            target = "kor";
            break;
        case "fr":
            target = "fra";
            break;
    }

    // 请求体数据
    const body = new URLSearchParams({
        from: 'auto',
        to: target,
        query: message.origin,
        source: 'txt'
    });

    // 发送请求
    const resp = await fetch(url, {
        method: method.POST,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        body: body.toString()
    });

    // 处理响应
    if (resp.ok) {
        let result = await resp.json();
        console.log(JSON.stringify(result));
        if (result.status === 0) {
            return result.data[0].dst;
        } else {
            throw new Error(`翻译失败: ${result.status} ${result.message}`);
        }
    } else {
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText}`);
    }
}

export default baidufree;



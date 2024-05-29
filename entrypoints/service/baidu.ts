import CryptoJS from 'crypto-js';
import {urls} from "@/entrypoints/utils/constant";
import {services} from "@/entrypoints/utils/option";
import {config} from "@/entrypoints/utils/config";

async function baidu(message: any) {
    const salt = Math.floor(Math.random() * 10000);
    const query = message.origin;

    const signStr = config.appid + query + salt + config.key;
    const sign = CryptoJS.MD5(signStr).toString(CryptoJS.enc.Hex);

    let to: string = "";
    if (config.to === "zh-Hans") to = "zh";
    else if (config.to === "ko") to = "kor";
    else if (config.to === "fr") to = "fra";
    else to = config.to;

    const resp = await fetch(urls[services.baidu], {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({
            q: query,
            from: config.from,
            to: to,
            appid: config.appid,
            salt: salt.toString(),
            sign: sign
        })
    });

    if (resp.ok) {
        const result = await resp.json();
        console.log(result)

        // 初始化一个数组用于收集翻译结果
        const translatedParts: string[] = [];

        // 循环 result.trans_result，获取每个翻译结果的 dst 字段，并做一些针对百度的适配（全角符号换半角）
        for (let i = 0; i < result.trans_result.length; i++) {
            translatedParts.push(result.trans_result[i].dst
                .replace(/“/g, '"').replace(/”/g, '"')
                .replace(/＜/g, "<").replace(/＞/g, ">"));
        }

        return translatedParts.join('');
    } else {
        console.log(resp)
        throw new Error(`请求失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default baidu;

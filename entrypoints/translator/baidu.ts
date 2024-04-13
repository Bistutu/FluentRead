import {Config} from "@/entrypoints/utils/model";
import CryptoJS from 'crypto-js';
import {urls} from "@/entrypoints/utils/constant";
import {services} from "@/entrypoints/utils/option";

async function baidu(config: Config, message: any) {
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
        // 百度翻译结果需替换中文引号为英文引号
        return result.trans_result[0].dst.replace(/“/g, '"').replace(/”/g, '"');
    } else {
        console.log(resp)
        throw new Error(`请求失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default baidu;

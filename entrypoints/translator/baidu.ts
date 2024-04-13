import {Config} from "@/entrypoints/utils/model";
import CryptoJS from 'crypto-js';
import {urls} from "@/entrypoints/utils/constant";
import {services} from "@/entrypoints/utils/option";

async function baidu(config: Config, message: any) {
    const appid = '';
    const key = '';
    const salt = Math.floor(Math.random() * 10000);
    const query = message.origin;

    // UTF-8 encoding and generation of the MD5 signature using crypto-js
    const signStr = appid + query + salt + key;
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
            appid: appid,
            salt: salt.toString(),
            sign: sign
        })
    });

    if (resp.ok) {
        const result = await resp.json();
        console.log(result)
        return result.trans_result.map((item: any) => item.dst).join(' ');
    } else {
        console.log(resp)
        throw new Error(`请求失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default baidu;

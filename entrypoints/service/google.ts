import {Config} from "../utils/model";
import {method} from "../utils/constant";

async function google(config: Config, message: any) {
    let params: any = {
        client: 'gtx', sl: config.from, tl: config.to, dt: 't', strip: 1, nonced: 1,
        'q': encodeURIComponent(message.origin),
    };
    let queryString = Object.keys(params).map((key: string) => key + '=' + params[key]).join('&');

    const resp = await fetch('https://translate.googleapis.com/translate_a/single?' + queryString, {
        method: method.GET,
    });

    if (resp.ok) {
        let result = await resp.json();
        let sentence = '';
        result[0].forEach((e: any) => sentence += e[0]);
        return sentence;
    } else {
        console.log(resp);
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default google;